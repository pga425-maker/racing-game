import './style.css';
import { Game } from './core/Game';

const app = document.getElementById('app')!;

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  app.innerHTML = '<div class="fatal">이 브라우저에서 WebGL을 사용할 수 없습니다.<br>Chrome 설정에서 하드웨어 가속을 켜 주세요.</div>';
} else {
  new Game(app).start();
}
