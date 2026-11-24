import * as THREE from 'three';
import type { QualitySettings } from '../core/Graphics';

const SKY_ZENITH = new THREE.Color(0x3d8fe0);
const SKY_HORIZON = new THREE.Color(0xcfe6f7);
const SHADOW_HALF = 32; // 그림자 카메라 반경 (m), 차 주변만

/**
 * 밝은 자연광: 하늘 그라데이션, 반구광, 태양광 1개(그림자), 안개.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly sunDir = new THREE.Vector3(-0.45, 0.8, -0.4).normalize();
  private readonly fog: THREE.Fog;

  constructor(scene: THREE.Scene) {
    scene.background = SKY_HORIZON.clone();
    this.fog = new THREE.Fog(SKY_HORIZON.getHex(), 120, 450);
    scene.fog = this.fog;

    // 하늘 돔 (안개 영향 없음)
    const skyGeo = new THREE.SphereGeometry(900, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: SKY_ZENITH },
        horizon: { value: SKY_HORIZON },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // 항상 가장 먼 깊이
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith;
        uniform vec3 horizon;
        varying vec3 vDir;
        void main() {
          float t = clamp(vDir.y * 1.6, 0.0, 1.0);
          gl_FragColor = vec4(mix(horizon, zenith, pow(t, 0.7)), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    sky.name = 'sky';
    scene.add(sky);
    this.sky = sky;

    const hemi = new THREE.HemisphereLight(0xdcefff, 0x6d8a4c, 1.15);
    scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.7);
    const sh = this.sun.shadow;
    sh.camera.left = -SHADOW_HALF;
    sh.camera.right = SHADOW_HALF;
    sh.camera.top = SHADOW_HALF;
    sh.camera.bottom = -SHADOW_HALF;
    sh.camera.near = 1;
    sh.camera.far = 220;
    sh.bias = -0.0004;
    sh.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  private readonly sky: THREE.Mesh;

  applyQuality(s: QualitySettings): void {
    this.fog.near = s.fogNear;
    this.fog.far = s.fogFar;
    this.sun.castShadow = s.shadows;
    if (this.sun.shadow.mapSize.x !== s.shadowMapSize) {
      this.sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** 그림자 영역과 하늘을 차(카메라) 주변으로 이동. 텍셀 단위로 맞춰 그림자 떨림 방지 */
  follow(x: number, z: number, camera: THREE.Camera): void {
    const texel = (SHADOW_HALF * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round(z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunDir.x * 100, this.sunDir.y * 100, sz + this.sunDir.z * 100);
    this.sky.position.copy(camera.position);
  }
}
