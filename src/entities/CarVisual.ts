import type * as THREE from 'three';
import type { VehiclePose } from '../physics/VehiclePhysics';
import type { VehicleState } from '../physics/types';

/**
 * 차량 렌더링 인터페이스. 물리 상태를 읽어서 그리기만 함.
 * 지금은 PrototypeCarVisual(기본 도형), 나중에 GlbCarVisual(.glb 모델)로 교체 가능.
 */
export interface CarVisual {
  /** 씬에 추가할 최상위 객체 (월드 위치·yaw) */
  readonly root: THREE.Object3D;
  /** 운전자 눈 위치 기준점 (차체에 붙어 피치·롤을 같이 따라감). 1-2단계 1인칭 시점에서 사용 */
  readonly driverEye: THREE.Object3D;
  /** 1인칭에서 숨길 외부 부품 (지붕 등). 1-2단계에서 사용 */
  readonly exteriorOccluders: readonly THREE.Object3D[];
  /** 보간된 자세 + 현재 상태로 갱신 (렌더 프레임마다) */
  update(pose: VehiclePose, state: VehicleState): void;
}
