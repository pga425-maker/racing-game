import * as THREE from 'three';
import type { CameraView, CameraViewContext } from './CameraView';

/**
 * 시점 관리. 등록된 시점을 Tab으로 순환하고, 현재 시점의 결과를 실제 카메라에 적용.
 * 1-2단계에서 이곳에 0.4초 전환 블렌딩(위치·방향·FOV 보간)과 실내/외부 모델 표시 전환이 들어감.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly views: CameraView[] = [];
  private index = 0;
  private needsReset = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  }

  addView(view: CameraView): void {
    this.views.push(view);
  }

  get active(): CameraView {
    return this.views[this.index];
  }

  /** Tab: 다음 시점으로 (지금은 3인칭 하나뿐이라 그대로) */
  cycle(): void {
    if (this.views.length < 2) return;
    this.index = (this.index + 1) % this.views.length;
    this.needsReset = true;
  }

  /** 차를 순간이동시킨 뒤(R 키 등) 호출: 스무딩 없이 바로 맞춤 */
  snap(): void {
    this.needsReset = true;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(ctx: CameraViewContext): void {
    const v = this.active;
    if (this.needsReset) {
      v.reset(ctx);
      this.needsReset = false;
    } else {
      v.update(ctx);
    }
    const cam = this.camera;
    cam.position.copy(v.position);
    cam.quaternion.copy(v.quaternion);
    if (cam.fov !== v.fov || cam.near !== v.near) {
      cam.fov = v.fov;
      cam.near = v.near;
      cam.updateProjectionMatrix();
    }
  }
}
