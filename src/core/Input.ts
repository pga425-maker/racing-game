/** 게임에서 쓰는 키 (KeyboardEvent.code) */
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'Space', 'KeyE', 'KeyQ', 'Tab', 'KeyM', 'KeyR', 'Escape', 'KeyP',
]);

/**
 * 키보드 입력. 누르고 있는 상태(isDown)와 이번에 새로 눌림(consumePress)을 구분.
 * 게임 키는 브라우저 기본 동작(Space 스크롤, Tab 포커스 이동)을 막음.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressed.add(e.code);
      }
    });
    target.addEventListener('keyup', (e) => {
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      this.down.delete(e.code);
    });
    // 창이 포커스를 잃으면 키가 눌린 채로 남지 않게
    target.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** 마지막 확인 이후 새로 눌렸으면 true를 돌려주고 기록을 지움 */
  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  clear(): void {
    this.down.clear();
    this.pressed.clear();
  }
}
