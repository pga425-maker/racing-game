/**
 * 차량 튜닝 수치는 전부 여기에 모은다.
 * 좌표 규칙: 차량 로컬 +Z = 앞, +X = 왼쪽, +Y = 위 (CLAUDE.md 6번)
 * 단위: m, kg, N, N·m, 초, rad (이름에 Deg/Kmh가 붙은 값만 예외)
 */
export interface VehicleConfig {
  // ── 차체 ──
  mass: number;
  /** 무게중심 높이 (m). 높을수록 하중 이동과 피치·롤이 커짐 */
  cgHeight: number;
  /** 앞바퀴 축의 Z 위치 (무게중심 기준, m) */
  frontAxleZ: number;
  /** 뒷바퀴 축의 Z 위치 (음수, m) */
  rearAxleZ: number;
  /** 바퀴 좌우 간격의 절반 (m) */
  halfTrack: number;
  wheelRadius: number;
  yawInertia: number;
  pitchInertia: number;
  rollInertia: number;
  /** 벽 충돌용 차체 크기의 절반 (m) */
  bodyHalfWidth: number;
  bodyHalfLength: number;

  // ── 서스펜션 ──
  springFront: number; // N/m
  springRear: number;
  damperFront: number; // N·s/m
  damperRear: number;
  antiRollFront: number; // N/m (좌우 압축 차이에 대한 힘)
  antiRollRear: number;
  /** 최대 압축 (정적 압축 기준 추가로 더 눌릴 수 있는 양, m). 넘으면 범프스톱 */
  maxExtraCompression: number;

  // ── 타이어 ──
  /** 기본 마찰계수 */
  tireGrip: number;
  /** 하중 민감도 지수 (1 미만: 하중이 늘수록 그립은 비례보다 덜 늘어남) */
  loadSensitivity: number;
  /** 슬립각 곡선 강성 B (클수록 작은 슬립각에서 힘이 빨리 올라감) */
  tireStiffnessB: number;
  /** 슬립각 곡선 모양 C (클수록 최고점 뒤 그립이 빨리 떨어짐) */
  tireShapeC: number;
  /** 앞/뒤 타이어 그립 배율 (앞 > 뒤면 오버스티어 성향) */
  frontGripScale: number;
  rearGripScale: number;
  /** 슬립각 계산 시 저속 떨림 방지용 최소 속도 (m/s) */
  slipMinSpeed: number;
  rollingResistance: number; // Fz 대비 계수

  // ── 조향 ──
  maxSteerDeg: number;
  /** 이 속도(km/h)에서 최대 조향각이 절반이 됨 */
  steerHalfAtKmh: number;
  minSteerDeg: number;
  /** 조향 입력이 0→1로 증가하는 속도 (1/초) */
  steerSpeed: number;
  /** 손을 놓았을 때 0으로 돌아오는 속도 (1/초) */
  steerReturnSpeed: number;
  /** 미끄러질 때 속도 제한을 풀어 카운터 스티어 각도를 더 허용하는 정도 (0=끔, 1=최대) */
  counterSteerAssist: number;

  // ── 드리프트 보조 (키보드 조작용, 0이면 끔) ──
  /** 차체 미끄럼각이 이 각도를 넘으면 되돌리는 힘이 생김 (스핀 방지) */
  driftAngleLimitDeg: number;
  /** 한계 초과 1rad당 복원 토크 (N·m) */
  driftAssistTorque: number;

  // ── 엔진 ──
  /** [RPM, 토크(N·m)] 점들. 사이는 선형 보간 */
  torqueCurve: ReadonlyArray<readonly [number, number]>;
  idleRpm: number;
  /** 레드라인 시작 (게이지 빨간 구간 시작) */
  redlineRpm: number;
  /** 리미터 (이 RPM에서 연료 차단) */
  limiterRpm: number;
  /** 저속 출발 시 클러치가 미끄러지며 받쳐 주는 RPM */
  launchRpm: number;
  /** 엑셀을 뗐을 때 엔진 브레이크 토크 (최대 토크 대비 비율) */
  engineBrakeRatio: number;
  /** 엑셀 입력 증가 속도 (1/초) */
  throttleRiseSpeed: number;
  throttleFallSpeed: number;

  // ── 변속기 ──
  gearRatios: readonly number[]; // 1~6단
  reverseRatio: number;
  finalDrive: number;
  drivetrainEfficiency: number;
  /** 자동 변속 업시프트 RPM = 시프트 라이트 전체 깜빡임 RPM */
  shiftUpRpm: number;
  /** 자동 변속 다운시프트 RPM */
  shiftDownRpm: number;
  /** 변속에 걸리는 시간 (이동안 구동력 차단, 초) */
  shiftTime: number;
  /** 시프트 라이트가 켜지기 시작하는 RPM */
  shiftLightStartRpm: number;
  reverseMaxKmh: number;
  /** 정지 후 S를 이만큼 더 누르고 있으면 R로 전환 (초) */
  reverseEngageDelay: number;

  // ── 제동 ──
  maxBrakeForce: number; // 4바퀴 합 (N)
  brakeBiasFront: number; // 0~1
  handbrakeForce: number; // 뒷바퀴 2개 합 (N)
  /** 핸드브레이크(Space) 시 뒷바퀴 그립 배율 */
  handbrakeRearGrip: number;
  /** Space를 놓은 뒤 뒷그립이 돌아오는 속도 (1/초) */
  handbrakeRecoverSpeed: number;
  /** 트랙션 컨트롤: 구동력을 그립 한계의 이 비율까지만 허용 (1 이상이면 사실상 끔) */
  tractionControlLimit: number;

  // ── 공기역학 ──
  dragCoefficient: number; // 0.5·ρ·Cd·A 를 합친 값
  downforceCoefficient: number; // 속도² 대비 다운포스

  // ── 노면 ──
  grassGrip: number; // 잔디 그립 배율
  grassRollingResistance: number;
  grassDragPerWheel: number; // N/(m/s)

  // ── 벽 ──
  wallRestitution: number;
  wallFriction: number;

  // ── 적분 ──
  subSteps: number;
}

export const vehicleConfig: VehicleConfig = {
  mass: 1300,
  cgHeight: 0.5,
  frontAxleZ: 1.33,
  rearAxleZ: -1.3,
  halfTrack: 0.8,
  wheelRadius: 0.33,
  yawInertia: 2100,
  pitchInertia: 1900,
  rollInertia: 450,
  bodyHalfWidth: 0.97,
  bodyHalfLength: 2.2,

  springFront: 30000,
  springRear: 32000,
  damperFront: 2600,
  damperRear: 2800,
  antiRollFront: 14000,
  antiRollRear: 9000,
  maxExtraCompression: 0.09,

  tireGrip: 1.15,
  loadSensitivity: 0.85,
  tireStiffnessB: 12,
  tireShapeC: 1.45,
  frontGripScale: 1.0,
  rearGripScale: 1.06,
  slipMinSpeed: 4,
  rollingResistance: 0.012,

  maxSteerDeg: 33,
  steerHalfAtKmh: 60,
  minSteerDeg: 5,
  steerSpeed: 3.2,
  steerReturnSpeed: 5.0,
  counterSteerAssist: 1.0,

  driftAngleLimitDeg: 45,
  driftAssistTorque: 28000,

  torqueCurve: [
    [800, 170],
    [2000, 250],
    [3000, 300],
    [4000, 330],
    [5000, 345],
    [6000, 340],
    [7000, 315],
    [7800, 280],
    [8200, 240],
  ],
  idleRpm: 900,
  redlineRpm: 7200,
  limiterRpm: 7800,
  launchRpm: 3200,
  engineBrakeRatio: 0.12,
  throttleRiseSpeed: 6,
  throttleFallSpeed: 10,

  gearRatios: [3.3, 2.2, 1.65, 1.3, 1.06, 0.88],
  reverseRatio: 3.1,
  finalDrive: 3.9,
  drivetrainEfficiency: 0.86,
  shiftUpRpm: 7300,
  shiftDownRpm: 3000,
  shiftTime: 0.16,
  shiftLightStartRpm: 5000,
  reverseMaxKmh: 30,
  reverseEngageDelay: 0.25,

  maxBrakeForce: 15000,
  brakeBiasFront: 0.64,
  handbrakeForce: 2600,
  handbrakeRearGrip: 0.42,
  handbrakeRecoverSpeed: 2.5,
  tractionControlLimit: 0.8,

  dragCoefficient: 0.4,
  downforceCoefficient: 0.6,

  grassGrip: 0.62,
  grassRollingResistance: 0.06,
  grassDragPerWheel: 30,

  wallRestitution: 0.35,
  wallFriction: 0.4,

  subSteps: 2,
};
