import type { VehicleConfig } from './vehicleConfig';
import type { TransmissionMode, VehicleControls } from './types';

const RPM_PER_RAD_S = 60 / (2 * Math.PI);
const STOP_SPEED = 0.35; // m/s 이하면 '정지'로 봄 (약 1.3km/h)

/** 엔진 + 변속기. 페달 해석(후진 전환 포함)도 여기서 함 */
export class Drivetrain {
  gear = 1; // -1=R, 0=N, 1~6
  mode: TransmissionMode = 'auto';
  rpm: number;
  throttle = 0; // 엔진에 실제로 들어가는 스로틀 (부드럽게 처리됨)
  brake = 0; // 0~1
  shifting = false;
  limiterActive = false;
  /** 이번 스텝 구동력 (뒷바퀴 2개 합, 차 앞방향 +, N) */
  driveForce = 0;

  private shiftTimer = 0;
  private shiftCooldown = 0;
  private directionHoldTimer = 0;
  private readonly maxTorque: number;

  constructor(private readonly cfg: VehicleConfig) {
    this.rpm = cfg.idleRpm;
    let max = 0;
    for (const [, t] of cfg.torqueCurve) max = Math.max(max, t);
    this.maxTorque = max;
  }

  get gearCount(): number {
    return this.cfg.gearRatios.length;
  }

  toggleMode(): void {
    this.mode = this.mode === 'auto' ? 'manual' : 'auto';
    if (this.mode === 'auto' && this.gear === 0) this.gear = 1;
  }

  reset(): void {
    this.gear = 1;
    this.rpm = this.cfg.idleRpm;
    this.throttle = 0;
    this.brake = 0;
    this.shifting = false;
    this.shiftTimer = 0;
    this.limiterActive = false;
    this.driveForce = 0;
    this.directionHoldTimer = 0;
  }

  torqueAt(rpm: number): number {
    const c = this.cfg.torqueCurve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const [r0, t0] = c[i - 1];
        const [r1, t1] = c[i];
        return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
      }
    }
    return c[c.length - 1][1];
  }

  totalRatio(gear: number): number {
    if (gear === 0) return 0;
    const r = gear < 0 ? this.cfg.reverseRatio : this.cfg.gearRatios[gear - 1];
    return r * this.cfg.finalDrive;
  }

  /** 바퀴 속도로 계산한 엔진 RPM (클러치가 붙어 있다고 가정) */
  wheelRpm(gear: number, speed: number): number {
    return (Math.abs(speed) / this.cfg.wheelRadius) * RPM_PER_RAD_S * this.totalRatio(gear);
  }

  /**
   * 한 물리 스텝 갱신
   * @param speedForward 차의 앞방향 속도 (m/s, 후진이면 음수)
   * @param sliding 차가 옆으로 미끄러지는 중이면 자동 변속을 멈춤 (드리프트 중 기어 유지)
   */
  update(dt: number, c: VehicleControls, speedForward: number, sliding: boolean): void {
    const cfg = this.cfg;
    const stopped = Math.abs(speedForward) < STOP_SPEED;

    // ── 1) 페달 해석과 자동 후진 전환 ──
    // 전진 기어(N 포함): W=가속, S=브레이크 / 후진 기어: S=가속, W=브레이크
    const inReverse = this.gear === -1;
    const throttlePedal = inReverse ? c.brake : c.accel;
    const brakePedal = inReverse ? c.accel : c.brake;

    // 정지 상태에서 '브레이크 페달'만 계속 누르고 있으면 반대 방향 기어로 전환
    if (stopped && brakePedal && !throttlePedal) {
      this.directionHoldTimer += dt;
      if (this.directionHoldTimer >= cfg.reverseEngageDelay) {
        this.directionHoldTimer = 0;
        this.setGear(inReverse ? 1 : -1, false);
      }
    } else {
      this.directionHoldTimer = 0;
    }

    // 기어가 바뀌었을 수 있으니 페달을 다시 해석
    const rev = this.gear === -1;
    let throttleTarget = (rev ? c.brake : c.accel) ? 1 : 0;
    // 방금 전환된 경우 브레이크 키를 그대로 누르고 있으면 그게 곧 가속
    const brakeNow = (rev ? c.accel : c.brake) ? 1 : 0;

    // ── 2) 수동 변속 ──
    if (this.mode === 'manual') {
      if (c.shiftUp && this.gear < this.gearCount) {
        this.setGear(this.gear === -1 ? 0 : this.gear + 1, true);
      }
      if (c.shiftDown && this.gear > 0) {
        const next = this.gear - 1;
        // 과회전 방지: 내렸을 때 리미터를 크게 넘으면 무시
        if (next === 0 || this.wheelRpm(next, speedForward) < cfg.limiterRpm + 300) {
          this.setGear(next, true);
        }
      }
    }

    // ── 3) 자동 변속 ──
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    if (this.mode === 'auto' && this.gear >= 1 && !this.shifting && this.shiftCooldown <= 0 && !sliding) {
      const pureRpm = this.wheelRpm(this.gear, speedForward);
      if (pureRpm >= cfg.shiftUpRpm && this.gear < this.gearCount && speedForward > 0) {
        this.setGear(this.gear + 1, true);
      } else if (this.gear > 1) {
        // 엑셀을 밟고 있으면 조금 더 높은 RPM에서 미리 내림 (킥다운)
        const downRpm = cfg.shiftDownRpm + throttleTarget * 900;
        if (pureRpm < downRpm && this.wheelRpm(this.gear - 1, speedForward) < cfg.shiftUpRpm - 600) {
          this.setGear(this.gear - 1, true);
        }
      }
    }

    // ── 4) 변속 중 구동력 차단 ──
    if (this.shifting) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) this.shifting = false;
    }

    // 후진 속도 제한 (약 30km/h 근처에서 스로틀을 서서히 줄임)
    if (this.gear === -1) {
      const kmh = Math.abs(speedForward) * 3.6;
      const fade = Math.min(1, Math.max(0, (cfg.reverseMaxKmh - kmh) / 6));
      throttleTarget *= fade;
    }

    // 스로틀은 부드럽게 증가/감소
    const rate = throttleTarget > this.throttle ? cfg.throttleRiseSpeed : cfg.throttleFallSpeed;
    this.throttle = approach(this.throttle, throttleTarget, rate * dt);
    this.brake = brakeNow;

    // ── 5) 엔진 RPM ──
    const freeTarget = cfg.idleRpm + this.throttle * (cfg.limiterRpm - cfg.idleRpm);
    if (this.gear === 0) {
      // 중립: 공회전/공회전 가속
      this.rpm = approach(this.rpm, freeTarget, (this.throttle > 0 ? 9000 : 5000) * dt);
    } else {
      const coupled = this.wheelRpm(this.gear, speedForward);
      // 저속 출발: 클러치가 미끄러지며 RPM을 받쳐 줌
      const clutchFloor = cfg.idleRpm + this.throttle * (cfg.launchRpm - cfg.idleRpm);
      const target = Math.max(coupled, clutchFloor);
      if (this.shifting) {
        this.rpm = approach(this.rpm, target, 14000 * dt);
      } else {
        // 결합 상태는 즉시 따라가되, 클러치 구간만 살짝 부드럽게
        this.rpm = coupled >= clutchFloor ? coupled : approach(this.rpm, target, 8000 * dt);
      }
    }

    // ── 6) 리미터 ──
    if (this.rpm >= cfg.limiterRpm) this.limiterActive = true;
    else if (this.rpm < cfg.limiterRpm - 250) this.limiterActive = false;
    if (this.rpm > cfg.limiterRpm + 200) this.rpm = cfg.limiterRpm + 200;

    // ── 7) 구동력 ──
    this.driveForce = 0;
    if (this.gear !== 0 && !this.shifting) {
      const dir = this.gear === -1 ? -1 : 1;
      let torque = 0;
      if (!this.limiterActive) torque += this.throttle * this.torqueAt(this.rpm);
      // 엔진 브레이크: 기어 방향으로 굴러가는 중에만
      const movingWithGear = speedForward * dir > 1;
      if (movingWithGear) {
        torque -= (1 - this.throttle) * cfg.engineBrakeRatio * this.maxTorque * (this.rpm / cfg.limiterRpm);
      }
      this.driveForce =
        (dir * torque * this.totalRatio(this.gear) * cfg.drivetrainEfficiency) / cfg.wheelRadius;
    }
  }

  private setGear(gear: number, withShiftTime: boolean): void {
    if (gear === this.gear) return;
    this.gear = gear;
    if (withShiftTime && gear > 0) {
      this.shifting = true;
      this.shiftTimer = this.cfg.shiftTime;
    }
    this.shiftCooldown = 0.45;
  }
}

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(target, v + maxDelta);
  return Math.max(target, v - maxDelta);
}
