import type { VehicleConfig } from '../physics/vehicleConfig';
import type { VehicleState } from '../physics/types';

/**
 * 3인칭 HUD와 1인칭 운전석 계기판(1-2)이 함께 쓰는 표시 데이터.
 * 값 계산은 여기서 한 번만 하고, 각 계기판은 그리기만 함.
 * version은 표시되는 값이 바뀔 때만 올라가므로, 계기판은 version이 바뀔 때만 다시 그리면 됨.
 */
export class DisplayData {
  version = 0;

  speedKmh = 0; // 정수
  rpm = 0; // 25 단위
  gear = 1; // -1=R, 0=N, 1~6
  gearLabel = '1';
  /** 'A' 자동 / 'M' 수동 */
  modeLabel: 'A' | 'M' = 'A';
  /** 시프트 라이트 진행도 0~1 (시작 RPM → 업시프트 RPM) */
  shiftProgress = 0;
  /** 업시프트 RPM 도달 → 시프트 라이트 전체 깜빡임 */
  shiftFlash = false;
  /** 깜빡임 위상 (모든 계기판이 같은 박자로 깜빡이도록) */
  blinkOn = false;
  /** 레드라인 이상 (1인칭 계기판의 기어 숫자 깜빡임용) */
  atRedline = false;

  // 랩 정보 (1-3단계에서 채움. 지금은 null = 표시 안 함 / 빈 값)
  lapNumber: number | null = null;
  lapTimeMs: number | null = null;
  bestLapMs: number | null = null;
  /** 베스트 대비 차이 (ms, 음수=빠름) */
  deltaMs: number | null = null;

  // 게이지 눈금용 상수
  readonly rpmMax: number;
  readonly redlineRpm: number;

  private static readonly BLINK_HZ = 10;

  constructor(private readonly cfg: VehicleConfig) {
    this.rpmMax = Math.ceil(cfg.limiterRpm / 1000) * 1000;
    this.redlineRpm = cfg.redlineRpm;
  }

  /** 렌더 프레임마다 호출 (time: 초) */
  update(s: VehicleState, time: number): void {
    const cfg = this.cfg;
    let changed = false;

    const speed = Math.round(s.speedKmh);
    if (speed !== this.speedKmh) {
      this.speedKmh = speed;
      changed = true;
    }
    const rpm = Math.round(s.rpm / 25) * 25;
    if (rpm !== this.rpm) {
      this.rpm = rpm;
      changed = true;
    }
    if (s.gear !== this.gear) {
      this.gear = s.gear;
      this.gearLabel = s.gear === -1 ? 'R' : s.gear === 0 ? 'N' : String(s.gear);
      changed = true;
    }
    const mode = s.mode === 'auto' ? 'A' : 'M';
    if (mode !== this.modeLabel) {
      this.modeLabel = mode;
      changed = true;
    }

    const prog = Math.min(1, Math.max(0, (s.rpm - cfg.shiftLightStartRpm) / (cfg.shiftUpRpm - cfg.shiftLightStartRpm)));
    const progQ = Math.round(prog * 20) / 20;
    if (progQ !== this.shiftProgress) {
      this.shiftProgress = progQ;
      changed = true;
    }
    const topGear = s.gear >= cfg.gearRatios.length;
    const flash = s.gear !== 0 && ((s.rpm >= cfg.shiftUpRpm && !topGear && s.gear > 0) || s.limiterActive);
    if (flash !== this.shiftFlash) {
      this.shiftFlash = flash;
      changed = true;
    }
    const blink = Math.floor(time * DisplayData.BLINK_HZ * 2) % 2 === 0;
    if (blink !== this.blinkOn) {
      this.blinkOn = blink;
      if (this.shiftFlash || this.atRedline) changed = true;
    }
    const red = s.rpm >= cfg.redlineRpm;
    if (red !== this.atRedline) {
      this.atRedline = red;
      changed = true;
    }

    if (changed) this.version++;
  }
}
