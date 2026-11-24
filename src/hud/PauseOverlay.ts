const CONTROLS: [string, string][] = [
  ['W', '가속'],
  ['S', '브레이크 · 정지 후 계속 누르면 후진'],
  ['A / D', '조향'],
  ['Space', '드리프트 (핸드브레이크)'],
  ['E / Q', '기어 올림 / 내림 (수동 모드)'],
  ['M', '자동 / 수동 변속 전환'],
  ['Tab', '시점 전환'],
  ['R', '트랙으로 되돌리기'],
  ['Esc', '일시정지'],
];

/** Esc 일시정지 화면 (조작법 표시) */
export class PauseOverlay {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, debugKey: boolean) {
    this.root = document.createElement('div');
    this.root.className = 'pause';
    this.root.hidden = true;
    const box = document.createElement('div');
    box.className = 'pause-box';
    const title = document.createElement('h1');
    title.textContent = '일시정지';
    box.appendChild(title);
    const table = document.createElement('table');
    const rows = debugKey ? [...CONTROLS, ['P', '디버그 표시 (개발용)'] as [string, string]] : CONTROLS;
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      th.appendChild(kbd);
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(th, td);
      table.appendChild(tr);
    }
    box.appendChild(table);
    const hint = document.createElement('p');
    hint.textContent = 'Esc를 누르면 계속합니다';
    box.appendChild(hint);
    this.root.appendChild(box);
    parent.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }
}
