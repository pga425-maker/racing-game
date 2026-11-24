import type { DisplayData } from './DisplayData';

const START = Math.PI * 0.75; // 135° (왼쪽 아래)
const SWEEP = Math.PI * 1.5; // 270°

/** 원형 RPM 게이지 (캔버스). 값이 바뀔 때만 다시 그림 */
export class RpmGauge {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private lastRpm = -1;
  private dpr = 1;

  constructor(private readonly size: number) {
    this.canvas.className = 'rpm-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.size * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.lastRpm = -1;
  }

  draw(d: DisplayData): void {
    if (d.rpm === this.lastRpm) return;
    this.lastRpm = d.rpm;

    const g = this.ctx;
    const s = this.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, s, s);
    const c = s / 2;
    const rArc = s * 0.42;
    const width = s * 0.045;
    const angleOf = (rpm: number) => START + (Math.min(rpm, d.rpmMax) / d.rpmMax) * SWEEP;

    // 반투명 원판
    g.beginPath();
    g.arc(c, c, s * 0.49, 0, Math.PI * 2);
    g.fillStyle = 'rgba(8, 10, 14, 0.5)';
    g.fill();

    g.lineCap = 'butt';
    // 바탕 호
    g.lineWidth = width;
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    g.arc(c, c, rArc, START, angleOf(d.redlineRpm));
    g.stroke();
    // 레드존 바탕
    g.strokeStyle = 'rgba(255,50,40,0.38)';
    g.beginPath();
    g.arc(c, c, rArc, angleOf(d.redlineRpm), START + SWEEP);
    g.stroke();

    // 채워지는 흰색 호 + 레드존 넘으면 빨간색
    const a = angleOf(d.rpm);
    const aRed = angleOf(d.redlineRpm);
    g.strokeStyle = '#ffffff';
    g.beginPath();
    g.arc(c, c, rArc, START, Math.min(a, aRed));
    g.stroke();
    if (a > aRed) {
      g.strokeStyle = '#ff3b30';
      g.beginPath();
      g.arc(c, c, rArc, aRed, a);
      g.stroke();
    }

    // 눈금 (1000 RPM 단위)
    g.font = `600 ${Math.round(s * 0.058)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let r = 0; r <= d.rpmMax; r += 1000) {
      const ang = angleOf(r);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const red = r >= d.redlineRpm;
      g.strokeStyle = red ? 'rgba(255,90,80,0.9)' : 'rgba(255,255,255,0.7)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(c + cos * (rArc - width * 0.9), c + sin * (rArc - width * 0.9));
      g.lineTo(c + cos * (rArc - width * 1.8), c + sin * (rArc - width * 1.8));
      g.stroke();
      g.fillStyle = red ? 'rgba(255,110,100,0.95)' : 'rgba(255,255,255,0.75)';
      g.fillText(String(r / 1000), c + cos * (rArc - width * 3.0), c + sin * (rArc - width * 3.0));
    }
    // 작은 눈금 (500)
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    for (let r = 500; r < d.rpmMax; r += 1000) {
      const ang = angleOf(r);
      g.beginPath();
      g.moveTo(c + Math.cos(ang) * (rArc - width * 0.9), c + Math.sin(ang) * (rArc - width * 0.9));
      g.lineTo(c + Math.cos(ang) * (rArc - width * 1.4), c + Math.sin(ang) * (rArc - width * 1.4));
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.font = `600 ${Math.round(s * 0.045)}px system-ui, sans-serif`;
    g.fillText('x1000 rpm', c, c - s * 0.25);
  }
}
