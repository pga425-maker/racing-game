import type * as THREE from 'three';
import type { CarVisual } from '../entities/CarVisual';
import type { VehiclePose } from '../physics/VehiclePhysics';
import type { VehicleState } from '../physics/types';

export interface CameraViewContext {
  /** 보간된 차 자세 */
  pose: VehiclePose;
  state: VehicleState;
  car: CarVisual;
  /** 렌더 프레임 시간 (초) */
  dt: number;
}

/**
 * 시점 하나. 매 프레임 원하는 카메라 위치·방향·FOV를 계산만 하고,
 * 실제 카메라에 적용(그리고 1-2단계의 전환 블렌딩)은 CameraRig가 함.
 */
export interface CameraView {
  readonly id: string;
  readonly label: string;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  fov: number;
  near: number;
  /** 이 시점에서 화면 HUD 계기판을 보일지 */
  readonly showHud: boolean;
  update(ctx: CameraViewContext): void;
  /** 시점에 들어올 때 내부 스무딩 상태를 현재 차 위치로 맞춤 */
  reset(ctx: CameraViewContext): void;
}
