import type { VehicleConfig } from './vehicleConfig';
import { Drivetrain } from './Drivetrain';
import type { SurfaceInfo, TrackQuery, VehicleControls, VehicleState, WheelState } from './types';

const G = 9.81;
const DEG = Math.PI / 180;

/** 렌더링 보간용 자세 */
export interface VehiclePose {
  x: number;
  z: number;
  yaw: number;
  heave: number;
  pitch: number;
  roll: number;
}

/**
 * 차량 물리. 숫자 상태(VehicleState)만 계산하고 Three.js는 전혀 모름.
 * 평면(x, z, yaw) 강체 + 차체 상하·피치·롤 3자유도 + 바퀴 4개 스프링-댐퍼.
 */
export class VehiclePhysics {
  readonly state: VehicleState;
  readonly drivetrain: Drivetrain;

  private readonly prev: VehiclePose = { x: 0, z: 0, yaw: 0, heave: 0, pitch: 0, roll: 0 };
  private heaveVel = 0;
  private pitchVel = 0;
  private rollVel = 0;
  private rearGripFactor = 1;

  // 바퀴별 상수 (미리 계산)
  private readonly staticComp: number[] = [];
  private readonly springK: number[] = [];
  private readonly damperC: number[] = [];
  private readonly nominalLoad: number;
  private readonly springForce = [0, 0, 0, 0];
  private readonly compressionRaw = [0, 0, 0, 0];
  private readonly resetOut = { x: 0, z: 0, yaw: 0 };

  constructor(
    private readonly cfg: VehicleConfig,
    private readonly track: TrackQuery,
  ) {
    this.drivetrain = new Drivetrain(cfg);
    const wb = cfg.frontAxleZ - cfg.rearAxleZ;
    const frontAxleLoad = (cfg.mass * G * -cfg.rearAxleZ) / wb;
    const rearAxleLoad = cfg.mass * G - frontAxleLoad;
    this.nominalLoad = (cfg.mass * G) / 4;

    const wheels: WheelState[] = [];
    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      const isLeft = i % 2 === 0;
      const k = isFront ? cfg.springFront : cfg.springRear;
      const load = (isFront ? frontAxleLoad : rearAxleLoad) / 2;
      this.springK.push(k);
      this.damperC.push(isFront ? cfg.damperFront : cfg.damperRear);
      this.staticComp.push(load / k);
      wheels.push({
        localX: isLeft ? cfg.halfTrack : -cfg.halfTrack,
        localZ: isFront ? cfg.frontAxleZ : cfg.rearAxleZ,
        isFront,
        load,
        compression: load / k,
        centerY: cfg.wheelRadius,
        slipAngle: 0,
        forceLong: 0,
        forceLat: 0,
        gripUsage: 0,
        spinAngle: 0,
        surface: { kind: 'asphalt', gripScale: 1, rollingResistance: 0, dragPerWheel: 0 },
      });
    }

    this.state = {
      x: 0,
      z: 0,
      yaw: 0,
      vx: 0,
      vz: 0,
      yawRate: 0,
      heave: 0,
      pitch: 0,
      roll: 0,
      speedForward: 0,
      speedKmh: 0,
      accelLong: 0,
      accelLat: 0,
      bodySlip: 0,
      steerAngle: 0,
      steerInput: 0,
      throttle: 0,
      brake: 0,
      handbrake: false,
      rpm: cfg.idleRpm,
      gear: 1,
      mode: 'auto',
      shifting: false,
      limiterActive: false,
      brakeLight: false,
      reverseLight: false,
      wheels,
    };
  }

  /** 위치를 지정하고 모든 움직임을 멈춤 */
  place(x: number, z: number, yaw: number): void {
    const s = this.state;
    s.x = x;
    s.z = z;
    s.yaw = yaw;
    s.vx = s.vz = s.yawRate = 0;
    s.heave = s.pitch = s.roll = 0;
    this.heaveVel = this.pitchVel = this.rollVel = 0;
    s.steerInput = 0;
    s.steerAngle = 0;
    this.rearGripFactor = 1;
    this.drivetrain.reset();
    this.savePrev();
    this.syncDerived(0, 0);
  }

  /** R 키: 트랙 위 가장 가까운 지점으로 되돌리기 */
  resetToTrack(): void {
    const s = this.state;
    this.track.getResetPose(s.x, s.z, s.yaw, this.resetOut);
    this.place(this.resetOut.x, this.resetOut.z, this.resetOut.yaw);
  }

  /** 보간된 자세 (alpha: 0=직전 스텝, 1=현재 스텝) */
  getPose(alpha: number, out: VehiclePose): VehiclePose {
    const s = this.state;
    const p = this.prev;
    out.x = p.x + (s.x - p.x) * alpha;
    out.z = p.z + (s.z - p.z) * alpha;
    out.yaw = p.yaw + (s.yaw - p.yaw) * alpha;
    out.heave = p.heave + (s.heave - p.heave) * alpha;
    out.pitch = p.pitch + (s.pitch - p.pitch) * alpha;
    out.roll = p.roll + (s.roll - p.roll) * alpha;
    return out;
  }

  /** 고정 간격 한 스텝 (dt = 1/60) */
  step(dt: number, c: VehicleControls): void {
    const s = this.state;
    const cfg = this.cfg;
    this.savePrev();

    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    const vLong = s.vx * sinY + s.vz * cosY;
    const vLat = s.vx * cosY - s.vz * sinY;
    const planarSpeed = Math.hypot(vLong, vLat);
    // 차체 미끄럼각 (진행 방향과 차 앞방향의 차이)
    const bodySlip = planarSpeed > 5 ? Math.atan2(vLat, Math.abs(vLong)) : 0;
    s.bodySlip = bodySlip;
    const sliding = Math.abs(bodySlip) > 10 * DEG;

    // 파워트레인 (스텝당 한 번)
    const dtr = this.drivetrain;
    dtr.update(dt, c, vLong, sliding);

    // 조향: 키보드 입력을 부드럽게 증가·복귀
    const target = Math.max(-1, Math.min(1, c.steer));
    let rate: number;
    if (target === 0) rate = cfg.steerReturnSpeed;
    else if (target * s.steerInput < 0) rate = cfg.steerReturnSpeed + cfg.steerSpeed; // 반대로 꺾을 때는 빠르게
    else rate = cfg.steerSpeed;
    s.steerInput = approach(s.steerInput, target, rate * dt);
    const speedKmh = planarSpeed * 3.6;
    const speedLimited = Math.max(cfg.minSteerDeg, cfg.maxSteerDeg / (1 + speedKmh / cfg.steerHalfAtKmh));
    // 미끄러지는 중 카운터 스티어(미끄러지는 쪽으로 꺾음)일 때만 조향 한계를 풀어 줌
    const counterSteering = s.steerInput * bodySlip > 0 && vLong > 0;
    const slideFactor = counterSteering
      ? Math.min(1, Math.max(0, (Math.abs(bodySlip) - 6 * DEG) / (14 * DEG)))
      : 0;
    const maxSteer = speedLimited + (cfg.maxSteerDeg - speedLimited) * slideFactor * cfg.counterSteerAssist;
    s.steerAngle = s.steerInput * maxSteer * DEG;

    // 핸드브레이크: 뒷바퀴 그립 감소, 놓으면 서서히 회복
    s.handbrake = c.handbrake;
    if (c.handbrake) this.rearGripFactor = cfg.handbrakeRearGrip;
    else this.rearGripFactor = approach(this.rearGripFactor, 1, cfg.handbrakeRecoverSpeed * dt);

    const n = Math.max(1, cfg.subSteps | 0);
    const h = dt / n;
    let aLong = 0;
    let aLat = 0;
    for (let i = 0; i < n; i++) {
      this.integrate(h);
      aLong += this.lastALong;
      aLat += this.lastALat;
    }
    this.collideWalls();
    this.syncDerived(aLong / n, aLat / n);
  }

  // ───────────────────────────── 내부 ─────────────────────────────

  private lastALong = 0;
  private lastALat = 0;

  private integrate(h: number): void {
    const s = this.state;
    const cfg = this.cfg;
    const dtr = this.drivetrain;
    const wheels = s.wheels;
    const m = cfg.mass;

    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    // 앞방향 (sinY, cosY), 왼쪽 (cosY, -sinY)
    const vLong = s.vx * sinY + s.vz * cosY;
    const vLat = s.vx * cosY - s.vz * sinY;
    const speed = Math.hypot(vLong, vLat);

    // ── 서스펜션: 바퀴별 스프링·댐퍼 힘 ──
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const dy = s.heave + w.localZ * s.pitch + w.localX * s.roll;
      const dyVel = this.heaveVel + w.localZ * this.pitchVel + w.localX * this.rollVel;
      const x = this.staticComp[i] - dy;
      this.compressionRaw[i] = x;
      let f = 0;
      if (x > 0) {
        f = this.springK[i] * x - this.damperC[i] * dyVel;
        const over = x - (this.staticComp[i] + cfg.maxExtraCompression);
        if (over > 0) f += this.springK[i] * 8 * over; // 범프스톱
      }
      this.springForce[i] = f;
    }
    // 안티롤바: 좌우 압축 차이를 줄이는 방향
    const cr = this.compressionRaw;
    const sf = this.springForce;
    const dF = cfg.antiRollFront * (Math.max(0, cr[0]) - Math.max(0, cr[1]));
    const dR = cfg.antiRollRear * (Math.max(0, cr[2]) - Math.max(0, cr[3]));
    if (cr[0] > 0) sf[0] += dF;
    if (cr[1] > 0) sf[1] -= dF;
    if (cr[2] > 0) sf[2] += dR;
    if (cr[3] > 0) sf[3] -= dR;

    // ── 타이어 ──
    const massPerWheel = m / 4;
    const fz0 = this.nominalLoad;
    let tireLong = 0;
    let tireLat = 0;
    let yawTorque = 0;
    const tcLimit = s.handbrake || this.rearGripFactor < 0.98 ? 10 : cfg.tractionControlLimit;

    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const load = Math.max(0, sf[i]);
      w.load = load;
      w.compression = Math.max(0, cr[i]);
      w.centerY = cfg.wheelRadius + Math.max(0, -cr[i]);

      // 바퀴 위치의 노면
      const wx = s.x + cosY * w.localX + sinY * w.localZ;
      const wz = s.z - sinY * w.localX + cosY * w.localZ;
      this.track.surfaceAt(wx, wz, w.surface);
      const surf: SurfaceInfo = w.surface;

      // 바퀴 접지점 속도 (차 로컬)
      const pvLong = vLong - s.yawRate * w.localX;
      const pvLat = vLat + s.yawRate * w.localZ;
      const delta = w.isFront ? s.steerAngle : 0;
      const sn = Math.sin(delta);
      const cs = Math.cos(delta);
      const wl = pvLat * sn + pvLong * cs; // 바퀴 앞방향 속도
      const wlat = pvLat * cs - pvLong * sn; // 바퀴 옆방향 속도

      // 슬립각
      const alpha = Math.atan2(wlat, Math.max(Math.abs(wl), cfg.slipMinSpeed));
      w.slipAngle = alpha;

      // 그립 한계 (하중 민감도: 비례보다 덜 증가)
      const axleScale = w.isFront ? cfg.frontGripScale : cfg.rearGripScale * this.rearGripFactor;
      const mu = cfg.tireGrip * surf.gripScale * axleScale;
      const fMax = load > 0 ? mu * fz0 * Math.pow(load / fz0, cfg.loadSensitivity) : 0;

      // 횡력: 단순화한 매직 포뮬러
      let fy = -fMax * Math.sin(cfg.tireShapeC * Math.atan(cfg.tireStiffnessB * alpha));

      // 종방향: 구동 + 제동 + 구름저항
      let fx = 0;
      if (!w.isFront) {
        const drive = dtr.driveForce * 0.5;
        const lim = tcLimit * fMax;
        fx += Math.max(-lim, Math.min(lim, drive));
      }
      let resist =
        dtr.brake * cfg.maxBrakeForce * 0.5 * (w.isFront ? cfg.brakeBiasFront : 1 - cfg.brakeBiasFront);
      if (!w.isFront && s.handbrake) resist += cfg.handbrakeForce * 0.5;
      resist += (cfg.rollingResistance + surf.rollingResistance) * load;
      // 바퀴 속도를 0 넘어 반대로 밀지 않도록 한 스텝에 멈출 수 있는 만큼만
      const stopForce = (wl * massPerWheel) / h;
      fx -= Math.max(-resist, Math.min(resist, stopForce * 0.9));
      fx -= surf.dragPerWheel * wl;

      // 마찰원: 합력이 그립 한계를 넘지 않게
      const total = Math.hypot(fx, fy);
      if (total > fMax && total > 0) {
        const k = fMax / total;
        fx *= k;
        fy *= k;
      }
      w.gripUsage = fMax > 0 ? total / fMax : 0;
      w.forceLong = fx;
      w.forceLat = fy;

      // 차 로컬로 변환
      const fLat = fx * sn + fy * cs;
      const fLong = fx * cs - fy * sn;
      tireLong += fLong;
      tireLat += fLat;
      yawTorque += fLat * w.localZ - fLong * w.localX;

      w.spinAngle += (wl / cfg.wheelRadius) * h;
    }

    // ── 공기저항 ──
    const dragLong = -cfg.dragCoefficient * vLong * speed;
    const dragLat = -cfg.dragCoefficient * vLat * speed;
    const downforce = cfg.downforceCoefficient * speed * speed;

    // 드리프트 보조: 미끄럼각이 한계를 넘으면 진행 방향 쪽으로 되돌리는 토크
    if (cfg.driftAssistTorque > 0 && speed > 5) {
      const beta = Math.atan2(vLat, Math.abs(vLong));
      const lim = cfg.driftAngleLimitDeg * DEG;
      const excess = beta > lim ? beta - lim : beta < -lim ? beta + lim : 0;
      if (excess !== 0) yawTorque += cfg.driftAssistTorque * excess * Math.sign(vLong || 1);
    }

    const fLongTotal = tireLong + dragLong;
    const fLatTotal = tireLat + dragLat;
    this.lastALong = fLongTotal / m;
    this.lastALat = fLatTotal / m;

    // ── 평면 운동 적분 (반암시적 오일러) ──
    const ax = (sinY * fLongTotal + cosY * fLatTotal) / m;
    const az = (cosY * fLongTotal - sinY * fLatTotal) / m;
    s.vx += ax * h;
    s.vz += az * h;
    s.yawRate += (yawTorque / cfg.yawInertia) * h;
    s.x += s.vx * h;
    s.z += s.vz * h;
    s.yaw += s.yawRate * h;

    // ── 차체 상하·피치·롤 ──
    let sumF = 0;
    let pitchT = 0;
    let rollT = 0;
    for (let i = 0; i < 4; i++) {
      const f = sf[i] > 0 ? sf[i] : 0;
      sumF += f;
      pitchT += f * wheels[i].localZ;
      rollT += f * wheels[i].localX;
    }
    // 타이어 힘이 무게중심 아래(지면)에서 작용 → 가속 시 앞이 들리고, 코너에서 바깥으로 기움
    pitchT += tireLong * cfg.cgHeight;
    rollT += tireLat * cfg.cgHeight;

    this.heaveVel += ((sumF - m * G - downforce) / m) * h;
    this.pitchVel += (pitchT / cfg.pitchInertia) * h;
    this.rollVel += (rollT / cfg.rollInertia) * h;
    s.heave += this.heaveVel * h;
    s.pitch += this.pitchVel * h;
    s.roll += this.rollVel * h;
  }

  private collideWalls(): void {
    const s = this.state;
    const cfg = this.cfg;
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    const hw = cfg.bodyHalfWidth;
    const hl = cfg.bodyHalfLength;
    const m = cfg.mass;
    const I = cfg.yawInertia;

    for (const wall of this.track.walls) {
      // 가장 깊이 파고든 모서리 찾기
      let depth = 0;
      let rx = 0;
      let rz = 0;
      for (let k = 0; k < 4; k++) {
        const lx = k & 1 ? hw : -hw;
        const lz = k & 2 ? hl : -hl;
        const ox = cosY * lx + sinY * lz;
        const oz = -sinY * lx + cosY * lz;
        const d = wall.d - (wall.nx * (s.x + ox) + wall.nz * (s.z + oz));
        if (d > depth) {
          depth = d;
          rx = ox;
          rz = oz;
        }
      }
      if (depth <= 0) continue;

      // 위치 보정
      s.x += wall.nx * depth;
      s.z += wall.nz * depth;

      // 충돌점 속도 = v + ω×r  (ω×r = (ω·rz, -ω·rx))
      const pvx = s.vx + s.yawRate * rz;
      const pvz = s.vz - s.yawRate * rx;
      const vn = pvx * wall.nx + pvz * wall.nz;
      if (vn >= 0) continue;

      const rn = wall.nx * rz - wall.nz * rx;
      const j = (-(1 + cfg.wallRestitution) * vn) / (1 / m + (rn * rn) / I);
      // 접선 마찰
      const tx = -wall.nz;
      const tz = wall.nx;
      const vt = pvx * tx + pvz * tz;
      const rt = tx * rz - tz * rx;
      let jt = -vt / (1 / m + (rt * rt) / I);
      const maxJt = cfg.wallFriction * j;
      jt = Math.max(-maxJt, Math.min(maxJt, jt));

      const jx = wall.nx * j + tx * jt;
      const jz = wall.nz * j + tz * jt;
      s.vx += jx / m;
      s.vz += jz / m;
      s.yawRate += (jx * rz - jz * rx) / I;
    }
  }

  private syncDerived(aLong: number, aLat: number): void {
    const s = this.state;
    const d = this.drivetrain;
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    s.speedForward = s.vx * sinY + s.vz * cosY;
    s.speedKmh = Math.hypot(s.vx, s.vz) * 3.6;
    s.accelLong = aLong;
    s.accelLat = aLat;
    s.throttle = d.throttle;
    s.brake = d.brake;
    s.rpm = d.rpm;
    s.gear = d.gear;
    s.mode = d.mode;
    s.shifting = d.shifting;
    s.limiterActive = d.limiterActive;
    s.brakeLight = d.brake > 0;
    s.reverseLight = d.gear === -1;
  }

  private savePrev(): void {
    const s = this.state;
    const p = this.prev;
    p.x = s.x;
    p.z = s.z;
    p.yaw = s.yaw;
    p.heave = s.heave;
    p.pitch = s.pitch;
    p.roll = s.roll;
  }
}

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(target, v + maxDelta);
  return Math.max(target, v - maxDelta);
}
