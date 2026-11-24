import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../core/Graphics';
import type { SurfaceInfo, TrackQuery, WallPlane } from '../physics/types';
import { vehicleConfig } from '../physics/vehicleConfig';
import { makeAsphaltTexture, makeGrassTexture } from './textures';

/** 아스팔트 구역 (x, z 범위, m) */
const ASPHALT = { minX: -130, maxX: 130, minZ: -150, maxZ: 150 };
/** 바깥 경계벽 위치 (정사각형 반경, m) */
const WALL = 190;
const WALL_HEIGHT = 1.1;
const WALL_THICK = 1.0;
const RESET_MARGIN = 6;

/**
 * 평지 테스트 맵: 넓은 아스팔트, 콘(슬라럼 2줄, 원 선회 2개), 잔디, 바깥 경계벽, 벽 밖 나무.
 * 물리에는 TrackQuery(노면·벽·리셋 위치)만 제공.
 */
export class TestMap implements TrackQuery {
  readonly group = new THREE.Group();
  readonly walls: readonly WallPlane[] = [
    { nx: 1, nz: 0, d: -WALL },
    { nx: -1, nz: 0, d: -WALL },
    { nx: 0, nz: 1, d: -WALL },
    { nx: 0, nz: -1, d: -WALL },
  ];
  /** 시작 위치 */
  readonly spawn = { x: 0, z: -120, yaw: 0 };

  constructor(materials: MaterialLibrary, anisotropy: number) {
    this.group.name = 'testMap';
    this.buildGround(materials, anisotropy);
    this.buildMarkings(materials);
    this.buildCones(materials);
    this.buildWalls(materials);
    this.buildTrees(materials);
  }

  // ── TrackQuery ──

  surfaceAt(x: number, z: number, out: SurfaceInfo): void {
    if (x >= ASPHALT.minX && x <= ASPHALT.maxX && z >= ASPHALT.minZ && z <= ASPHALT.maxZ) {
      out.kind = 'asphalt';
      out.gripScale = 1;
      out.rollingResistance = 0;
      out.dragPerWheel = 0;
    } else {
      out.kind = 'grass';
      out.gripScale = vehicleConfig.grassGrip;
      out.rollingResistance = vehicleConfig.grassRollingResistance;
      out.dragPerWheel = vehicleConfig.grassDragPerWheel;
    }
  }

  getResetPose(x: number, z: number, yaw: number, out: { x: number; z: number; yaw: number }): void {
    out.x = Math.min(ASPHALT.maxX - RESET_MARGIN, Math.max(ASPHALT.minX + RESET_MARGIN, x));
    out.z = Math.min(ASPHALT.maxZ - RESET_MARGIN, Math.max(ASPHALT.minZ + RESET_MARGIN, z));
    out.yaw = yaw;
  }

  // ── 지오메트리 ──

  private buildGround(materials: MaterialLibrary, anisotropy: number): void {
    // 잔디는 아스팔트를 둘러싼 4개 직사각형 (겹치지 않게 → 깊이 다툼 없음). 안개 너머까지 넉넉하게
    const far = 700;
    const { minX, maxX, minZ, maxZ } = ASPHALT;
    const grassTile = 12;
    const grass = new THREE.Mesh(
      mergeGeometries([
        groundRect(-far, far, maxZ, far, grassTile, 8),
        groundRect(-far, far, -far, minZ, grassTile, 8),
        groundRect(-far, minX, minZ, maxZ, grassTile, 8),
        groundRect(maxX, far, minZ, maxZ, grassTile, 8),
      ]),
    );
    grass.receiveShadow = true;
    materials.apply(grass, { color: 0xffffff, map: makeGrassTexture(1, 1, anisotropy), roughness: 1 });
    this.group.add(grass);

    const asphalt = new THREE.Mesh(groundRect(minX, maxX, minZ, maxZ, 9, 10));
    asphalt.receiveShadow = true;
    materials.apply(asphalt, { color: 0xffffff, map: makeAsphaltTexture(1, 1, anisotropy), roughness: 0.92 });
    this.group.add(asphalt);
  }

  /** 노면 표시: 가장자리 흰 선, 시작 박스, 직선 주행용 점선 (한 메시로 병합) */
  private buildMarkings(materials: MaterialLibrary): void {
    const geos: THREE.BufferGeometry[] = [];
    const strip = (cx: number, cz: number, sx: number, sz: number) => {
      const g = new THREE.PlaneGeometry(sx, sz);
      g.rotateX(-Math.PI / 2);
      g.translate(cx, 0.015, cz);
      geos.push(g);
    };
    const inset = 1.5;
    const lw = 0.25;
    const { minX, maxX, minZ, maxZ } = ASPHALT;
    strip((minX + maxX) / 2, minZ + inset, maxX - minX - inset * 2, lw);
    strip((minX + maxX) / 2, maxZ - inset, maxX - minX - inset * 2, lw);
    strip(minX + inset, (minZ + maxZ) / 2, lw, maxZ - minZ - inset * 2);
    strip(maxX - inset, (minZ + maxZ) / 2, lw, maxZ - minZ - inset * 2);
    // 중앙 점선 (가속·제동 테스트 직선)
    for (let z = minZ + 10; z < maxZ - 10; z += 8) strip(0, z, 0.2, 4);
    // 시작 박스
    strip(this.spawn.x, this.spawn.z - 3.5, 3.4, 0.3);
    strip(this.spawn.x - 1.6, this.spawn.z, 0.2, 7);
    strip(this.spawn.x + 1.6, this.spawn.z, 0.2, 7);
    // 100m 제동 표시 (중앙선 양옆)
    for (let i = 1; i <= 3; i++) {
      const z = maxZ - 20 - i * 25;
      strip(-4, z, 3, 0.4);
      strip(4, z, 3, 0.4);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos));
    mesh.receiveShadow = true;
    materials.apply(mesh, { color: 0xf2f2ee, roughness: 0.7, polygonOffset: true });
    this.group.add(mesh);
    for (const g of geos) g.dispose();
  }

  /** 콘: 슬라럼 2줄 + 원 선회 2개. InstancedMesh 2개(주황 몸통, 흰 띠)로 전부 그림 */
  private buildCones(materials: MaterialLibrary): void {
    const pts: [number, number][] = [];
    for (let z = -110; z <= 110; z += 18) pts.push([-70, z]); // 넓은 슬라럼
    for (let z = -100; z <= 100; z += 12) pts.push([-100, z]); // 좁은 슬라럼
    const circle = (cx: number, cz: number, r: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
    };
    circle(65, 70, 22, 22); // 작은 원 선회
    circle(65, -60, 38, 32); // 큰 원 선회 (드리프트 연습)

    const body = new THREE.ConeGeometry(0.22, 0.7, 10, 1, true);
    body.translate(0, 0.35 + 0.03, 0);
    const base = new THREE.BoxGeometry(0.5, 0.04, 0.5);
    base.translate(0, 0.02, 0);
    const bodyGeo = mergeGeometries([body.toNonIndexed(), base.toNonIndexed()]);
    const band = new THREE.CylinderGeometry(0.135, 0.165, 0.12, 10, 1, true);
    band.translate(0, 0.42, 0);

    const bodyMesh = new THREE.InstancedMesh(bodyGeo, undefined, pts.length);
    const bandMesh = new THREE.InstancedMesh(band, undefined, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, z], i) => {
      m.makeTranslation(x, 0, z);
      bodyMesh.setMatrixAt(i, m);
      bandMesh.setMatrixAt(i, m);
    });
    bodyMesh.castShadow = true;
    materials.apply(bodyMesh, { color: 0xff6a13, roughness: 0.6, side: THREE.DoubleSide });
    materials.apply(bandMesh, { color: 0xf5f5f5, roughness: 0.5, side: THREE.DoubleSide });
    this.group.add(bodyMesh, bandMesh);
  }

  /** 경계벽: 콘크리트 + 위쪽 빨강/흰색 블록 (각각 한 메시로 병합) */
  private buildWalls(materials: MaterialLibrary): void {
    const concrete: THREE.BufferGeometry[] = [];
    const red: THREE.BufferGeometry[] = [];
    const white: THREE.BufferGeometry[] = [];
    const len = WALL * 2 + WALL_THICK * 2;
    const sides: [number, number, boolean][] = [
      [WALL + WALL_THICK / 2, 0, true],
      [-WALL - WALL_THICK / 2, 0, true],
      [0, WALL + WALL_THICK / 2, false],
      [0, -WALL - WALL_THICK / 2, false],
    ];
    const block = 4;
    for (const [cx, cz, alongZ] of sides) {
      const g = alongZ ? new THREE.BoxGeometry(WALL_THICK, WALL_HEIGHT, len) : new THREE.BoxGeometry(len, WALL_HEIGHT, WALL_THICK);
      g.translate(cx, WALL_HEIGHT / 2, cz);
      concrete.push(g);
      const n = Math.floor(len / block);
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + block * (i + 0.5);
        const b = alongZ
          ? new THREE.BoxGeometry(WALL_THICK + 0.04, 0.22, block)
          : new THREE.BoxGeometry(block, 0.22, WALL_THICK + 0.04);
        b.translate(alongZ ? cx : t, WALL_HEIGHT - 0.1, alongZ ? t : cz);
        (i % 2 === 0 ? red : white).push(b);
      }
    }
    const add = (geos: THREE.BufferGeometry[], color: number) => {
      const mesh = new THREE.Mesh(mergeGeometries(geos));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      materials.apply(mesh, { color, roughness: 0.85 });
      this.group.add(mesh);
      for (const g of geos) g.dispose();
    };
    add(concrete, 0xb9bcc0);
    add(red, 0xd0302a);
    add(white, 0xf0f0f0);
  }

  /** 벽 밖 나무 (속도감 기준점). 줄기·잎 InstancedMesh 2개 */
  private buildTrees(materials: MaterialLibrary): void {
    const count = 140;
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
    trunk.translate(0, 1.2, 0);
    const leaves = new THREE.ConeGeometry(2.2, 6, 7);
    leaves.translate(0, 5, 0);
    const trunkMesh = new THREE.InstancedMesh(trunk, undefined, count);
    const leafMesh = new THREE.InstancedMesh(leaves, undefined, count);
    let s = 12345;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // 벽 바깥 띠 (205~300m) 위 임의 위치
      let x = 0;
      let z = 0;
      do {
        x = (r() * 2 - 1) * 300;
        z = (r() * 2 - 1) * 300;
      } while (Math.max(Math.abs(x), Math.abs(z)) < 205);
      const k = 0.8 + r() * 0.7;
      pos.set(x, 0, z);
      scl.set(k, k * (0.9 + r() * 0.4), k);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * Math.PI * 2);
      m.compose(pos, q, scl);
      trunkMesh.setMatrixAt(i, m);
      leafMesh.setMatrixAt(i, m);
    }
    leafMesh.castShadow = true;
    materials.apply(trunkMesh, { color: 0x6b4a2f, roughness: 1 });
    materials.apply(leafMesh, { color: 0x2f6b34, roughness: 1 });
    this.group.add(trunkMesh, leafMesh);
  }
}

/** 지면 직사각형 (y=0). 큰 삼각형의 깊이 정밀도 문제를 피하려고 잘게 나누고, UV는 월드 좌표 기준(tile m마다 반복) */
function groundRect(minX: number, maxX: number, minZ: number, maxZ: number, tile: number, segments: number): THREE.BufferGeometry {
  const w = maxX - minX;
  const d = maxZ - minZ;
  const g = new THREE.PlaneGeometry(w, d, segments, segments);
  g.rotateX(-Math.PI / 2);
  g.translate(minX + w / 2, 0, minZ + d / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
  uv.needsUpdate = true;
  return g;
}
