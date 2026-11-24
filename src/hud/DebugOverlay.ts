import type { VehicleState } from '../physics/types';

const NAMES = ['앞왼', '앞오', '뒤왼', '뒤오'];
const RAD2DEG = 180 / Math.PI;

/** P 키 개발용 디버그 표시: 바퀴별 하중, 슬립각, 서스펜션, FPS. 초당 10번만 갱신 */
export class DebugOverlay {
  private readonly el: HTMLPreElement;
  private visible = false;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'debug';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    this.timer = 0;
  }

  update(s: VehicleState, fps: number, quality: string, dt: number): void {
    if (!this.visible) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const lines: string[] = [];
    lines.push(`FPS ${fps.toFixed(0)}  품질 ${quality}`);
    lines.push(`속도 ${s.speedKmh.toFixed(1)} km/h  전진 ${(s.speedForward * 3.6).toFixed(1)}`);
    lines.push(`RPM ${s.rpm.toFixed(0)}  기어 ${s.gear}  ${s.mode}${s.shifting ? ' 변속중' : ''}${s.limiterActive ? ' 리미터' : ''}`);
    lines.push(`스로틀 ${s.throttle.toFixed(2)}  브레이크 ${s.brake.toFixed(0)}  핸드브레이크 ${s.handbrake ? 'ON' : '-'}`);
    lines.push(`조향 ${(s.steerAngle * RAD2DEG).toFixed(1)}°  차체 미끄럼각 ${(s.bodySlip * RAD2DEG).toFixed(1)}°  yaw ${s.yawRate.toFixed(2)} rad/s`);
    lines.push(`G 앞뒤 ${(s.accelLong / 9.81).toFixed(2)}  좌우 ${(s.accelLat / 9.81).toFixed(2)}`);
    lines.push(`피치 ${(s.pitch * RAD2DEG).toFixed(2)}°  롤 ${(s.roll * RAD2DEG).toFixed(2)}°  상하 ${(s.heave * 1000).toFixed(0)}mm`);
    lines.push('');
    lines.push('바퀴   하중N  압축mm  슬립각°  그립요구  노면');
    s.wheels.forEach((w, i) => {
      lines.push(
        `${NAMES[i]}  ${w.load.toFixed(0).padStart(6)}  ${(w.compression * 1000).toFixed(0).padStart(6)}  ${(w.slipAngle * RAD2DEG).toFixed(1).padStart(7)}  ${(w.gripUsage * 100).toFixed(0).padStart(6)}%  ${w.surface.kind === 'asphalt' ? '아스팔트' : '잔디'}`,
      );
    });
    this.el.textContent = lines.join('\n');
  }
}
