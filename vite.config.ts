import { defineConfig } from 'vite';

// base: './' → GitHub Pages 하위 경로(https://<user>.github.io/<repo>/)에서도 상대 경로로 파일을 찾음
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
});
