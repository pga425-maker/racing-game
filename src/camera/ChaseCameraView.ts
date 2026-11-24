import * as THREE from 'three';
import type { CameraView, CameraViewContext } from './CameraView';

/** 3인칭 추격 시점 조정값 */
export const CHASE = {
  distance: 6.4, // 차 뒤 거리 (m)
  height: 2.6, // 카메라 높이 (m). HUD 계기판 위로 차가 보이게 조금 높게
  lookHeight: 0.25, // 바라보는 점 높이 (m)
  lookAhead: 0.0, // 차 앞쪽 바라보는 거리 (m)
  fov: 60,
  /** 차 방향을 따라 도는 속도 (1/초). 작을수록 코너에서 늦게 따라옴 */
  yawFollow: 5.0,
  /** 가속·제동 시 거리 변화 (m per m/s²) */
  accelStretch: 0.09,
  accelStretchMax: 0.9,
  /** 가속도 반응 속도 (1/초) */
  accelFollow: 3.0,
  /** 좌우 가속도에 따라 옆으로 밀리는 양 (m per m/s²) */
  lateralShift: 0.035,
  lateralShiftMax: 0.45,
} as const;

/** 차 뒤에서 부드럽게 따라오는 3인칭 시점. 속도에 비례해 뒤처지지 않도록 '차 기준 오프셋'에 관성을 줌 */
export class ChaseCameraView implements CameraView {
  readonly id = 'chase';
  readonly label = '3인칭';
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  fov: number = CHASE.fov;
  near = 0.1;
  readonly showHud = true;

  private camYaw = 0;
  private accLong = 0;
  private accLat = 0;
  private readonly target = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  reset(ctx: CameraViewContext): void {
    this.camYaw = ctx.pose.yaw;
    this.accLong = 0;
    this.accLat = 0;
    this.update({ ...ctx, dt: 0 });
  }

  update(ctx: CameraViewContext): void {
    const { pose, state, dt } = ctx;

    // 방향: 차 yaw를 늦게 따라감 (코너에서 차 옆면이 살짝 보임)
    let diff = pose.yaw - this.camYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.camYaw += diff * (1 - Math.exp(-CHASE.yawFollow * dt));

    // 가속도도 늦게 반영 → 가속 시 멀어지고 제동 시 가까워짐
    const ka = 1 - Math.exp(-CHASE.accelFollow * dt);
    this.accLong += (state.accelLong - this.accLong) * ka;
    this.accLat += (state.accelLat - this.accLat) * ka;

    const stretch = clamp(this.accLong * CHASE.accelStretch, -CHASE.accelStretchMax, CHASE.accelStretchMax);
    const dist = CHASE.distance + stretch;
    const side = clamp(-this.accLat * CHASE.lateralShift, -CHASE.lateralShiftMax, CHASE.lateralShiftMax);

    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    // 왼쪽 벡터 (cos, -sin)
    const lx = fz;
    const lz = -fx;

    this.position.set(pose.x - fx * dist + lx * side, CHASE.height, pose.z - fz * dist + lz * side);
    this.target.set(pose.x + fx * CHASE.lookAhead, CHASE.lookHeight, pose.z + fz * CHASE.lookAhead);
    this.m.lookAt(this.position, this.target, ChaseCameraView.UP);
    this.quaternion.setFromRotationMatrix(this.m);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
