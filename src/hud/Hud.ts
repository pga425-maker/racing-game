import { QUALITY_LABEL, QUALITY_LEVELS, type QualityLevel } from '../core/Graphics';
import type { DisplayData } from './DisplayData';
import { RpmGauge } from './RpmGauge';

const LED_COLORS = ['g', 'g', 'g', 'y', 'r'] as const;
const GAUGE_SIZE = 172;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.appendChild(e);
  return e;
}

/**
 * 3인칭 화면 HUD.
 * - 아래 가운데: 원형 RPM 게이지 + 시프트 라이트 5개 + 기어 + A/M + 속도
 * - 오른쪽 위: 그래픽 옵션과 FPS
 * - 왼쪽 위(랩, 1-3) / 위 가운데(드리프트, 1-4): 자리만
 * DisplayData.version이 바뀔 때만 DOM과 캔버스를 갱신.
 */
export class Hud {
  readonly root: HTMLDivElement;
  /** 1-3단계 랩 정보 패널 자리 */
  readonly lapSlot: HTMLDivElement;
  /** 1-4단계 드리프트 점수 패널 자리 */
  readonly driftSlot: HTMLDivElement;

  private readonly gaugeBox: HTMLDivElement;
  private readonly gauge = new RpmGauge(GAUGE_SIZE);
  private readonly leds: HTMLSpanElement[] = [];
  private readonly gearEl: HTMLDivElement;
  private readonly modeEl: HTMLDivElement;
  private readonly speedEl: HTMLSpanElement;
  private readonly fpsEl: HTMLSpanElement;
  private readonly qualityBtns = new Map<QualityLevel, HTMLButtonElement>();
  private readonly toastEl: HTMLDivElement;

  private lastVersion = -1;
  private lastGear = '';
  private lastSpeed = -1;
  private lastMode = '';
  private lastLedMask = -1;
  private lastFps = -1;
  private toastTimer = 0;

  constructor(parent: HTMLElement, onQualitySelect: (q: QualityLevel) => void) {
    this.root = el('div', 'hud', parent);

    this.lapSlot = el('div', 'panel hud-lap', this.root);
    this.lapSlot.hidden = true;
    this.driftSlot = el('div', 'panel hud-drift', this.root);
    this.driftSlot.hidden = true;

    // 오른쪽 위: 그래픽 옵션 + FPS
    const gfx = el('div', 'panel hud-gfx', this.root);
    el('span', 'gfx-label', gfx).textContent = '그래픽';
    for (const q of QUALITY_LEVELS) {
      const b = el('button', 'gfx-btn', gfx);
      b.type = 'button';
      b.tabIndex = -1;
      b.textContent = QUALITY_LABEL[q];
      // 클릭해도 포커스를 가져가지 않게 (키 입력이 버튼으로 가지 않도록)
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => onQualitySelect(q));
      this.qualityBtns.set(q, b);
    }
    this.fpsEl = el('span', 'gfx-fps', gfx);

    // 아래 가운데: 게이지
    this.gaugeBox = el('div', 'hud-gauge', this.root);
    const ledRow = el('div', 'shift-lights', this.gaugeBox);
    for (const c of LED_COLORS) this.leds.push(el('span', `led led-${c}`, ledRow));
    const wrap = el('div', 'gauge-wrap', this.gaugeBox);
    wrap.style.width = wrap.style.height = `${GAUGE_SIZE}px`;
    wrap.appendChild(this.gauge.canvas);
    this.gearEl = el('div', 'gear', wrap);
    this.modeEl = el('div', 'mode', wrap);
    const speedBox = el('div', 'speed', wrap);
    this.speedEl = el('span', 'speed-num', speedBox);
    el('span', 'speed-unit', speedBox).textContent = 'km/h';

    this.toastEl = el('div', 'toast', this.root);
  }

  /** 3인칭 계기판 표시 여부 (1-2단계 1인칭에서 숨김) */
  setGaugeVisible(v: boolean): void {
    this.gaugeBox.style.display = v ? '' : 'none';
  }

  setQuality(q: QualityLevel): void {
    for (const [level, b] of this.qualityBtns) b.classList.toggle('active', level === q);
  }

  showToast(text: string, seconds = 3): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  onResize(): void {
    this.gauge.resize();
    this.lastVersion = -1;
  }

  update(d: DisplayData, fps: number, dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }

    const f = Math.round(fps);
    if (f !== this.lastFps) {
      this.lastFps = f;
      this.fpsEl.textContent = `${f} FPS`;
    }

    if (d.version === this.lastVersion) return;
    this.lastVersion = d.version;

    this.gauge.draw(d);

    if (d.gearLabel !== this.lastGear) {
      const first = this.lastGear === '';
      this.lastGear = d.gearLabel;
      this.gearEl.textContent = d.gearLabel;
      this.gearEl.classList.toggle('gear-r', d.gear === -1);
      if (!first) {
        // 기어가 바뀌는 순간 살짝 커졌다 돌아옴
        this.gearEl.animate(
          [{ transform: 'translate(-50%, -50%) scale(1.35)' }, { transform: 'translate(-50%, -50%) scale(1)' }],
          { duration: 220, easing: 'cubic-bezier(.2,.8,.3,1)' },
        );
      }
    }
    if (d.modeLabel !== this.lastMode) {
      this.lastMode = d.modeLabel;
      this.modeEl.textContent = d.modeLabel;
      this.modeEl.classList.toggle('mode-m', d.modeLabel === 'M');
    }
    if (d.speedKmh !== this.lastSpeed) {
      this.lastSpeed = d.speedKmh;
      this.speedEl.textContent = String(d.speedKmh);
    }

    // 시프트 라이트: 진행도만큼 왼쪽부터 켜짐, 업시프트 RPM이면 전체 깜빡임
    let mask = 0;
    if (d.shiftFlash) {
      mask = d.blinkOn ? 0b11111 : 0;
    } else {
      const lit = Math.floor(d.shiftProgress * LED_COLORS.length + 1e-6);
      mask = (1 << lit) - 1;
    }
    if (mask !== this.lastLedMask) {
      this.lastLedMask = mask;
      for (let i = 0; i < this.leds.length; i++) this.leds[i].classList.toggle('on', (mask & (1 << i)) !== 0);
    }
  }
}
