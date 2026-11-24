import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary, MatSpec } from '../core/Graphics';
import type { VehiclePose } from '../physics/VehiclePhysics';
import type { VehicleConfig } from '../physics/vehicleConfig';
import type { VehicleState } from '../physics/types';
import type { CarVisual } from './CarVisual';

// 오리지널 디자인 프로토타입 스포츠카 (낮고 넓은 웨지형, 풀폭 테일라이트 바, 리어 윙)
// 좌표: +Z 앞, +X 왼쪽, +Y 위. 차체 부품 높이는 '정지 상태 지면 기준'으로 적음.

const PAINT: MatSpec = { color: 0x1c63d6, roughness: 0.32, metalness: 0.45 };
const BLACK: MatSpec = { color: 0x141619, roughness: 0.6, metalness: 0.1 };
const CARBON: MatSpec = { color: 0x24272c, roughness: 0.45, metalness: 0.3 };
const GLASS: MatSpec = { color: 0x111a24, roughness: 0.08, metalness: 0.6 };
const TIRE: MatSpec = { color: 0x1b1b1d, roughness: 0.92 };
const RIM: MatSpec = { color: 0xc9ccd1, roughness: 0.3, metalness: 0.85 };
const SPOKE: MatSpec = { color: 0x8d9198, roughness: 0.35, metalness: 0.8 };
const CALIPER: MatSpec = { color: 0xf2c418, roughness: 0.4, metalness: 0.2 };
const ACCENT: MatSpec = { color: 0xf4f4f2, roughness: 0.4, metalness: 0.1 };

type Profile = ReadonlyArray<readonly [number, number]>; // [z, y]

/** 옆모습 단면(z, y)을 x 방향(xMin~xMax)으로 밀어 낸 지오메트리 */
function extrudeSide(profile: Profile, xMin: number, xMax: number, bevel = 0.02): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  profile.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const depth = xMax - xMin - bevel * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  // 단면 x → 차 z, 밀어 낸 방향 z → 차 -x
  geo.rotateY(-Math.PI / 2);
  geo.translate(xMin + bevel + depth, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/** 위로 갈수록 안쪽으로 좁힘 (둥근 어깨선). x가 기준선 바깥인 꼭짓점만 */
function taper(geo: THREE.BufferGeometry, fromY: number, perMeter: number, xThreshold: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i);
    if (y > fromY && Math.abs(x) > xThreshold) {
      const shrink = (y - fromY) * perMeter;
      pos.setX(i, x - Math.sign(x) * shrink);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** 원호 점들 (바퀴 아치용) */
function arc(cz: number, cy: number, r: number, from: number, to: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    out.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

interface WheelParts {
  holder: THREE.Object3D; // 위치 (서스펜션 높이)
  steer: THREE.Object3D; // 조향 회전
  spin: THREE.Object3D; // 구름 회전
}

export class PrototypeCarVisual implements CarVisual {
  readonly root = new THREE.Group();
  readonly driverEye = new THREE.Object3D();
  readonly exteriorOccluders: THREE.Object3D[] = [];

  private readonly bodyPivot = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly wheels: WheelParts[] = [];
  private readonly tailLight: THREE.Mesh;
  private readonly reverseLights: THREE.Mesh;
  private readonly cg: number;

  constructor(
    private readonly materials: MaterialLibrary,
    cfg: VehicleConfig,
  ) {
    this.root.name = 'car';
    this.cg = cfg.cgHeight;
    this.bodyPivot.position.y = cfg.cgHeight;
    this.body.position.y = -cfg.cgHeight;
    this.bodyPivot.add(this.body);
    this.root.add(this.bodyPivot);

    this.buildBody();
    this.tailLight = this.buildTailLight();
    this.reverseLights = this.buildReverseLights();
    this.buildWheels(cfg);

    // 1-2단계 1인칭 시점 기준점: 왼쪽 운전석, 눈높이
    this.driverEye.name = 'driverEye';
    this.driverEye.position.set(0.36, 1.03, -0.32);
    this.body.add(this.driverEye);
  }

  update(pose: VehiclePose, s: VehicleState): void {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.yaw;
    this.bodyPivot.position.y = this.cg + pose.heave;
    this.bodyPivot.rotation.set(-pose.pitch, 0, pose.roll);

    for (let i = 0; i < 4; i++) {
      const w = s.wheels[i];
      const p = this.wheels[i];
      p.holder.position.y = w.centerY;
      p.spin.rotation.x = w.spinAngle;
      if (w.isFront) p.steer.rotation.y = s.steerAngle;
    }

    setEmissive(this.tailLight, s.brakeLight ? 3.2 : 0.55);
    setEmissive(this.reverseLights, s.reverseLight ? 2.4 : 0);
  }

  // ───────────────────── 만들기 ─────────────────────

  private mesh(geo: THREE.BufferGeometry, spec: MatSpec, parent: THREE.Object3D = this.body, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo);
    m.castShadow = shadow;
    this.materials.apply(m, spec);
    parent.add(m);
    return m;
  }

  private box(sx: number, sy: number, sz: number, x: number, y: number, z: number, spec: MatSpec): THREE.Mesh {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    return this.mesh(g, spec);
  }

  private buildBody(): void {
    // 중앙 차체 (바퀴 안쪽 폭): 낮은 노즈 → 보닛 → 카울 → 리어 데크 → 덕테일
    const tub: Profile = [
      [2.26, 0.34], [2.2, 0.5], [1.95, 0.6], [1.45, 0.67], [0.95, 0.76],
      [-1.4, 0.86], [-2.02, 0.93], [-2.2, 0.88], [-2.21, 0.55], [-2.12, 0.27],
      [-1.0, 0.17], [1.6, 0.17], [2.12, 0.24],
    ];
    const tubGeo = extrudeSide(tub, -0.68, 0.68, 0.04);
    taper(tubGeo, 0.55, 0.35, 0.4);
    this.mesh(tubGeo, PAINT);

    // 좌우 옆판: 펜더와 문, 바퀴 아치 두 개를 파낸 단면
    const fz = 1.33;
    const rz = -1.3;
    const ar = 0.41;
    const ac = 0.33;
    const side: Profile = [
      [2.16, 0.27], [2.22, 0.48],
      [1.9, 0.62], [1.33, 0.76], [0.75, 0.72], [0.0, 0.73], [-0.7, 0.8], [-1.3, 0.9], [-1.9, 0.9], [-2.2, 0.84],
      [-2.22, 0.52], [-2.14, 0.27], [rz - ar - 0.02, 0.27], [rz - ar, ac],
      ...arc(rz, ac, ar, Math.PI, 0, 10),
      [rz + ar, 0.24], [fz - ar - 0.02, 0.24], [fz - ar, ac],
      ...arc(fz, ac, ar, Math.PI, 0, 10),
      [fz + ar, 0.27],
    ];
    for (const sgn of [1, -1]) {
      const g = extrudeSide(side, 0.62, 0.99, 0.03);
      if (sgn < 0) g.translate(-1.61, 0, 0);
      taper(g, 0.5, 0.55, 0.8);
      this.mesh(g, PAINT);
      // 사이드 스커트 (검정)
      this.box(0.06, 0.08, 1.5, sgn * 0.97, 0.26, 0.0, BLACK);
      // 사이드 미러
      this.box(0.16, 0.08, 0.12, sgn * 1.02, 0.93, 0.62, PAINT);
      this.box(0.03, 0.03, 0.1, sgn * 0.93, 0.89, 0.62, BLACK);
      // 문 뒤 공기 흡입구
      this.box(0.02, 0.12, 0.38, sgn * 0.985, 0.6, -0.72, BLACK);
    }

    // 캐빈 유리 (좁아지는 그린하우스)
    const glass: Profile = [
      [1.02, 0.75], [0.3, 1.16], [-0.6, 1.2], [-1.5, 0.88], [-1.42, 0.8], [0.95, 0.72],
    ];
    const glassGeo = extrudeSide(glass, -0.66, 0.66, 0.03);
    taper(glassGeo, 0.78, 0.38, 0.3);
    const glassMesh = this.mesh(glassGeo, GLASS);
    glassMesh.name = 'cabinGlass';

    // 지붕 패널 (1인칭에서 숨김 대상)
    const roof: Profile = [[0.28, 1.17], [-0.58, 1.215], [-0.9, 1.15], [-0.85, 1.13], [-0.58, 1.19], [0.26, 1.15]];
    const roofGeo = extrudeSide(roof, -0.52, 0.52, 0.01);
    const roofMesh = this.mesh(roofGeo, PAINT);
    roofMesh.name = 'roof';
    this.exteriorOccluders.push(roofMesh);

    // 센터 스트라이프 (보닛, 리어 데크)
    const hoodStripe = this.box(0.24, 0.012, 1.04, 0, 0, 0, ACCENT);
    hoodStripe.position.set(0, 0.69, 1.45);
    hoodStripe.rotation.x = 0.16;
    const deckStripe = this.box(0.24, 0.012, 0.64, 0, 0, 0, ACCENT);
    deckStripe.position.set(0, 0.905, -1.71);
    deckStripe.rotation.x = 0.11;

    // 앞: 스플리터, 흡입구, 헤드라이트
    this.box(1.86, 0.04, 0.4, 0, 0.19, 2.08, CARBON);
    this.box(1.2, 0.13, 0.06, 0, 0.36, 2.22, BLACK);
    for (const sgn of [1, -1]) {
      const hl = this.box(0.46, 0.05, 0.22, sgn * 0.6, 0.555, 2.02, { color: 0xe8eef5, roughness: 0.2, emissive: 0xdde8ff, emissiveIntensity: 0.6 });
      hl.rotation.x = 0.22;
    }

    // 뒤: 디퓨저, 윙
    this.box(1.5, 0.1, 0.35, 0, 0.24, -2.05, CARBON);
    for (const sgn of [1, -1]) this.box(0.04, 0.3, 0.14, sgn * 0.5, 1.07, -1.98, CARBON);
    const wing = this.box(1.8, 0.035, 0.34, 0, 1.23, -2.02, CARBON);
    wing.rotation.x = -0.08;
    for (const sgn of [1, -1]) this.box(0.02, 0.16, 0.4, sgn * 0.9, 1.21, -2.02, CARBON);

    // 바닥 (속이 비어 보이지 않게)
    this.box(1.6, 0.02, 3.9, 0, 0.17, 0.05, BLACK);
  }

  private buildTailLight(): THREE.Mesh {
    // 풀폭 테일라이트 바 (브레이크 시 밝아짐)
    const g = new THREE.BoxGeometry(1.66, 0.075, 0.04);
    g.translate(0, 0.79, -2.235);
    const m = this.mesh(g, { color: 0x5a0d0d, roughness: 0.3, emissive: 0xff1a12, emissiveIntensity: 0.55, unique: true }, this.body, false);
    m.name = 'tailLight';
    return m;
  }

  private buildReverseLights(): THREE.Mesh {
    const a = new THREE.BoxGeometry(0.2, 0.06, 0.04);
    a.translate(0.32, 0.62, -2.228);
    const b = new THREE.BoxGeometry(0.2, 0.06, 0.04);
    b.translate(-0.32, 0.62, -2.228);
    const m = this.mesh(mergeGeometries([a, b]), { color: 0x9a9a9a, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0, unique: true }, this.body, false);
    m.name = 'reverseLights';
    return m;
  }

  private buildWheels(cfg: VehicleConfig): void {
    const r = cfg.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      const isLeft = i % 2 === 0;
      const width = isFront ? 0.25 : 0.29;
      const out = isLeft ? 1 : -1; // 바깥쪽 방향 (x)

      const holder = new THREE.Group();
      holder.position.set(out * cfg.halfTrack, r, isFront ? cfg.frontAxleZ : cfg.rearAxleZ);
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      holder.add(steer);
      steer.add(spin);
      this.root.add(holder);

      // 타이어 (트레드 + 양쪽 사이드월)
      const tread = new THREE.CylinderGeometry(r, r, width, 22, 1, true);
      tread.rotateZ(Math.PI / 2);
      this.mesh(tread, { ...TIRE, side: THREE.DoubleSide }, spin);
      for (const face of [1, -1]) {
        const wall = new THREE.RingGeometry(r * 0.66, r, 22);
        wall.rotateY((face * Math.PI) / 2);
        wall.translate((face * width) / 2, 0, 0);
        this.mesh(wall, { ...TIRE, side: THREE.DoubleSide }, spin);
      }
      // 휠 (바깥면 쪽에 림, 스포크 5개, 허브)
      const faceX = out * (width / 2 - 0.035);
      const rim = new THREE.RingGeometry(r * 0.6, r * 0.67, 22);
      rim.rotateY((out * Math.PI) / 2);
      rim.translate(faceX + out * 0.005, 0, 0);
      this.mesh(rim, { ...RIM, side: THREE.DoubleSide }, spin, false);
      const dish = new THREE.CircleGeometry(r * 0.6, 20);
      dish.rotateY((out * Math.PI) / 2);
      dish.translate(faceX - out * 0.05, 0, 0);
      this.mesh(dish, { color: 0x2a2c30, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }, spin, false);
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.BoxGeometry(0.03, r * 0.56, 0.055);
        sp.translate(0, r * 0.32, 0);
        sp.rotateX((k / 5) * Math.PI * 2);
        sp.translate(faceX - out * 0.015, 0, 0);
        this.mesh(sp, SPOKE, spin, false);
      }
      const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10);
      hub.rotateZ(Math.PI / 2);
      hub.translate(faceX, 0, 0);
      this.mesh(hub, RIM, spin, false);

      // 브레이크 캘리퍼 (조향은 따라가고 회전은 안 함)
      const cal = new THREE.BoxGeometry(0.06, 0.16, 0.1);
      cal.translate(faceX - out * 0.08, r * 0.38, isFront ? -0.08 : 0.08);
      this.mesh(cal, CALIPER, steer, false);

      this.wheels.push({ holder, steer, spin });
    }
  }
}

function setEmissive(mesh: THREE.Mesh, intensity: number): void {
  const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  m.emissiveIntensity = intensity;
}
