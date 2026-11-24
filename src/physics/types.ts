/** 물리에 들어가는 조작 입력 (키 상태를 그대로 담음. 후진 판단 등 해석은 물리가 함) */
export interface VehicleControls {
  /** W */
  accel: boolean;
  /** S */
  brake: boolean;
  /** -1(오른쪽) ~ 1(왼쪽). 키보드면 -1, 0, 1 */
  steer: number;
  /** Space */
  handbrake: boolean;
  /** E (이번 스텝에 한 번 눌림) */
  shiftUp: boolean;
  /** Q (이번 스텝에 한 번 눌림) */
  shiftDown: boolean;
}

export type SurfaceKind = 'asphalt' | 'grass';

export interface SurfaceInfo {
  kind: SurfaceKind;
  gripScale: number;
  rollingResistance: number;
  dragPerWheel: number;
}

/** 축 정렬 벽 하나: 차체 모서리가 이 선을 넘으면 normal 방향으로 밀어냄 */
export interface WallPlane {
  /** 벽 바깥에서 안쪽(주행 가능 구역)으로 향하는 수평 단위 벡터 */
  nx: number;
  nz: number;
  /** 벽면 위치: nx*x + nz*z >= d 가 안쪽 */
  d: number;
}

/** 트랙이 물리에 제공하는 정보 */
export interface TrackQuery {
  surfaceAt(x: number, z: number, out: SurfaceInfo): void;
  readonly walls: readonly WallPlane[];
  /** R 키: 가장 가까운 트랙 위 지점 */
  getResetPose(x: number, z: number, yaw: number, out: { x: number; z: number; yaw: number }): void;
}

/** 바퀴 순서: 0=앞왼, 1=앞오른, 2=뒤왼, 3=뒤오른 */
export interface WheelState {
  /** 차체 로컬 위치 */
  readonly localX: number;
  readonly localZ: number;
  readonly isFront: boolean;
  /** 수직 하중 (N) */
  load: number;
  /** 스프링 압축량 (m, 정적 상태 기준 절대값) */
  compression: number;
  /** 바퀴 중심 높이 (지면 기준, m) */
  centerY: number;
  /** 슬립각 (rad) */
  slipAngle: number;
  /** 타이어가 낸 힘 (바퀴 기준 앞뒤/옆, N) */
  forceLong: number;
  forceLat: number;
  /** 그립 한계 대비 사용률 0~1+ */
  gripUsage: number;
  /** 바퀴 회전 각도 (렌더링용, rad) */
  spinAngle: number;
  surface: SurfaceInfo;
}

export type TransmissionMode = 'auto' | 'manual';

/** 렌더링·HUD가 읽는 차량 상태 (물리가 쓰고, 나머지는 읽기만) */
export interface VehicleState {
  // 평면 운동
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  yawRate: number;
  // 차체 3자유도 (서스펜션)
  heave: number;
  pitch: number;
  roll: number;
  // 파생 값
  speedForward: number; // m/s, 앞(+) 뒤(-)
  speedKmh: number; // 절대값
  accelLong: number; // m/s², 로컬
  accelLat: number;
  /** 차체 미끄럼각 (rad, 진행 방향과 앞방향 차이) */
  bodySlip: number;
  steerAngle: number; // 앞바퀴 조향각 (rad, +왼쪽)
  steerInput: number; // 부드럽게 처리된 조향 입력 -1~1
  throttle: number; // 0~1 (실제 엔진에 들어간 값)
  brake: number; // 0~1
  handbrake: boolean;
  // 파워트레인
  rpm: number;
  gear: number; // -1=R, 0=N, 1~6
  mode: TransmissionMode;
  shifting: boolean;
  limiterActive: boolean;
  // 라이트
  brakeLight: boolean;
  reverseLight: boolean;
  wheels: WheelState[];
}
