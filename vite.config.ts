/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * **빌드 시각을 코드에 굳힌다** — 사용자 요구: "버전 표시와 날짜 시간 같이 표시해서
 * 언제 업데이트 되었는지 알 수 있게 해줘."
 *
 * ⚠ 런타임 `new Date()` 가 아니라 **빌드 시점**이어야 뜻이 맞는다. 런타임이면 지금
 *   시각을 그리는 것이라 "언제 업데이트됐나"를 못 말한다. 이 파일은 빌드할 때 한 번
 *   평가되므로 여기서 굳히면 그 값이 곧 배포 시각이다.
 * ⚠ `src/sim/**` 의 결정론과는 무관하다 — 이 값은 UI 문자열로만 흐르고 시뮬레이션은
 *   읽지 않는다(읽으면 같은 시드가 빌드마다 다른 판을 밟는다).
 */
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    environment: 'node',
  },
});
