import * as THREE from 'three';

/** 간단한 의사 난수 (매번 같은 무늬가 나오도록 시드 고정) */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(canvas: HTMLCanvasElement, repeatX: number, repeatY: number, anisotropy: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** 아스팔트: 회색 바탕에 자잘한 골재 알갱이 */
export function makeAsphaltTexture(repeatX: number, repeatY: number, anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5b5e63';
  g.fillRect(0, 0, size, size);
  const r = rng(7);
  for (let i = 0; i < 9000; i++) {
    const v = 70 + r() * 70;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.35 + r() * 0.4})`;
    g.fillRect(r() * size, r() * size, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // 얼룩
  for (let i = 0; i < 18; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 20 + r() * 50;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(40,42,46,${0.12 + r() * 0.1})`);
    grd.addColorStop(1, 'rgba(40,42,46,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return finish(c, repeatX, repeatY, anisotropy);
}

/** 잔디: 초록 바탕에 짧은 결 */
export function makeGrassTexture(repeatX: number, repeatY: number, anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4f8a35';
  g.fillRect(0, 0, size, size);
  const r = rng(11);
  for (let i = 0; i < 7000; i++) {
    const gr = 110 + r() * 70;
    g.fillStyle = `rgba(${50 + r() * 40},${gr},${30 + r() * 25},0.5)`;
    g.fillRect(r() * size, r() * size, 1, 2 + r() * 3);
  }
  for (let i = 0; i < 14; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 25 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const light = r() > 0.5;
    grd.addColorStop(0, light ? 'rgba(150,190,80,0.18)' : 'rgba(30,70,25,0.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return finish(c, repeatX, repeatY, anisotropy);
}
