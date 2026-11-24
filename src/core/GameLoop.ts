export const PHYSICS_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

/**
 * 고정 간격 물리 + 가변 렌더링 루프.
 * 누적 시간 방식으로 1/60초씩 물리를 돌리고, 한 프레임에 최대 5번까지만 따라잡음.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = -1;
  private running = false;

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    /** alpha: 직전 물리 스텝과 현재 스텝 사이 보간 비율, frameDt: 실제 프레임 시간 */
    private readonly render: (alpha: number, frameDt: number) => void,
    private readonly isPaused: () => boolean,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);
    const t = now / 1000;
    let frameDt = this.lastTime < 0 ? PHYSICS_DT : t - this.lastTime;
    this.lastTime = t;
    if (frameDt > 0.25) frameDt = 0.25; // 탭 전환 뒤 큰 점프 방지

    if (this.isPaused()) {
      this.accumulator = 0;
      this.render(1, frameDt);
      return;
    }

    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
      this.fixedUpdate(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      steps++;
    }
    // 따라잡지 못한 시간은 버림 (느린 기기에서 '죽음의 나선' 방지)
    if (steps >= MAX_STEPS_PER_FRAME && this.accumulator >= PHYSICS_DT) this.accumulator = 0;

    this.render(this.accumulator / PHYSICS_DT, frameDt);
  };
}
