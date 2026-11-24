import * as THREE from 'three';

export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
export const QUALITY_LABEL: Record<QualityLevel, string> = { low: '낮음', medium: '중간', high: '높음' };

export interface QualitySettings {
  /** 해상도 배율 상한 (기기 배율보다 높이지 않음) */
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** true면 MeshStandardMaterial, false면 MeshLambertMaterial */
  standardMaterials: boolean;
  fogNear: number;
  fogFar: number;
  /** 1-2단계 거울 기능용 (높음에서만 작동) */
  mirrors: boolean;
}

export const QUALITY_SETTINGS: Record<QualityLevel, QualitySettings> = {
  low: { maxPixelRatio: 1.0, shadows: false, shadowMapSize: 1024, standardMaterials: false, fogNear: 90, fogFar: 320, mirrors: false },
  medium: { maxPixelRatio: 1.25, shadows: true, shadowMapSize: 1024, standardMaterials: true, fogNear: 120, fogFar: 450, mirrors: false },
  high: { maxPixelRatio: 1.5, shadows: true, shadowMapSize: 1024, standardMaterials: true, fogNear: 160, fogFar: 600, mirrors: true },
};

/** 재질 사양. 품질에 따라 Lambert/Standard 중 하나로 만들어짐 */
export interface MatSpec {
  color: number;
  map?: THREE.Texture;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** 바닥 위에 겹쳐 그리는 표시(차선 등)의 깊이 다툼 방지 */
  polygonOffset?: boolean;
  /** true면 공유하지 않고 이 메시 전용 재질 (브레이크등처럼 값이 바뀌는 재질) */
  unique?: boolean;
}

type AnyMat = THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;

/**
 * 재질 관리. 메시를 등록해 두면 품질 변경 시 Lambert ↔ Standard로 한꺼번에 교체.
 * 같은 사양은 하나의 재질을 공유해서 draw 상태 전환을 줄임.
 */
export class MaterialLibrary {
  private readonly entries: { mesh: THREE.Mesh; spec: MatSpec }[] = [];
  private cache = new Map<string, AnyMat>();
  private readonly texIds = new WeakMap<THREE.Texture, number>();
  private nextTexId = 1;

  constructor(private standard: boolean) {}

  /** 메시에 재질을 입히고 등록 */
  apply<T extends THREE.Mesh>(mesh: T, spec: MatSpec): T {
    mesh.material = this.build(spec);
    this.entries.push({ mesh, spec });
    return mesh;
  }

  setStandard(standard: boolean): void {
    if (standard === this.standard) return;
    this.standard = standard;
    const old = this.cache;
    this.cache = new Map();
    for (const e of this.entries) {
      const prev = e.mesh.material as AnyMat;
      // 실행 중 바뀐 발광 세기 유지
      const ei = prev.emissiveIntensity;
      e.mesh.material = this.build(e.spec);
      (e.mesh.material as AnyMat).emissiveIntensity = ei;
      if (e.spec.unique) prev.dispose();
    }
    for (const m of old.values()) m.dispose();
  }

  /** 그림자 켜고 끌 때 셰이더 재컴파일 요청 */
  invalidate(): void {
    for (const m of this.cache.values()) m.needsUpdate = true;
    for (const e of this.entries) if (e.spec.unique) (e.mesh.material as AnyMat).needsUpdate = true;
  }

  private build(spec: MatSpec): AnyMat {
    if (spec.unique) return this.create(spec);
    const key = this.key(spec);
    let m = this.cache.get(key);
    if (!m) {
      m = this.create(spec);
      this.cache.set(key, m);
    }
    return m;
  }

  private create(spec: MatSpec): AnyMat {
    const common = {
      color: spec.color,
      map: spec.map ?? null,
      emissive: spec.emissive ?? 0x000000,
      emissiveIntensity: spec.emissiveIntensity ?? 1,
      transparent: spec.transparent ?? false,
      opacity: spec.opacity ?? 1,
      side: spec.side ?? THREE.FrontSide,
      polygonOffset: spec.polygonOffset ?? false,
      polygonOffsetFactor: spec.polygonOffset ? -2 : 0,
      polygonOffsetUnits: spec.polygonOffset ? -4 : 0,
    };
    if (this.standard) {
      return new THREE.MeshStandardMaterial({
        ...common,
        roughness: spec.roughness ?? 0.8,
        metalness: spec.metalness ?? 0,
      });
    }
    return new THREE.MeshLambertMaterial(common);
  }

  private key(s: MatSpec): string {
    let texId = 0;
    if (s.map) {
      texId = this.texIds.get(s.map) ?? 0;
      if (!texId) {
        texId = this.nextTexId++;
        this.texIds.set(s.map, texId);
      }
    }
    return [s.color, texId, s.roughness, s.metalness, s.emissive, s.emissiveIntensity, s.transparent, s.opacity, s.side, s.polygonOffset].join('|');
  }
}

/**
 * 렌더러 + 품질 설정 + FPS 측정 + 자동 품질 하향.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly materials: MaterialLibrary;
  quality: QualityLevel;
  /** 품질이 바뀔 때 (자동 하향이면 auto=true) */
  onQualityChange: ((q: QualityLevel, auto: boolean) => void) | null = null;

  /** 최근 0.5초 평균 FPS (HUD 표시용) */
  fps = 60;

  private fpsFrames = 0;
  private fpsTime = 0;
  // 자동 하향: 1초 단위 평균 FPS가 연속으로 40 미만이면 한 단계 낮춤
  private secFrames = 0;
  private secTime = 0;
  private lowSeconds = 0;
  private graceTime = 4; // 시작 직후와 품질 변경 직후에는 판단 보류 (초)
  private static readonly AUTO_FPS_THRESHOLD = 40;
  private static readonly AUTO_LOW_SECONDS = 4;

  constructor(container: HTMLElement, initial: QualityLevel = 'medium') {
    this.quality = initial;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.materials = new MaterialLibrary(QUALITY_SETTINGS[initial].standardMaterials);
    this.applyRendererSettings();
  }

  get settings(): QualitySettings {
    return QUALITY_SETTINGS[this.quality];
  }

  setQuality(q: QualityLevel, auto = false): void {
    if (q === this.quality) return;
    const prevShadows = this.settings.shadows;
    this.quality = q;
    this.applyRendererSettings();
    this.materials.setStandard(this.settings.standardMaterials);
    if (prevShadows !== this.settings.shadows) this.materials.invalidate();
    this.graceTime = 5;
    this.lowSeconds = 0;
    this.onQualityChange?.(q, auto);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  /** 매 렌더 프레임마다 호출 (일시정지 중이면 자동 하향 판단 제외) */
  sampleFrame(dt: number, paused: boolean): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    if (paused || document.hidden) {
      this.secFrames = 0;
      this.secTime = 0;
      return;
    }
    if (this.graceTime > 0) {
      this.graceTime -= dt;
      return;
    }
    this.secFrames++;
    this.secTime += dt;
    if (this.secTime >= 1) {
      const avg = this.secFrames / this.secTime;
      this.secFrames = 0;
      this.secTime = 0;
      this.lowSeconds = avg < Graphics.AUTO_FPS_THRESHOLD ? this.lowSeconds + 1 : 0;
      if (this.lowSeconds >= Graphics.AUTO_LOW_SECONDS) {
        const i = QUALITY_LEVELS.indexOf(this.quality);
        if (i > 0) this.setQuality(QUALITY_LEVELS[i - 1], true);
        this.lowSeconds = 0;
      }
    }
  }

  private applyRendererSettings(): void {
    const s = this.settings;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.maxPixelRatio));
    this.renderer.shadowMap.enabled = s.shadows;
  }
}
