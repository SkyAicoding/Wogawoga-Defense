/**
 * 개발 하네스 — ?scene=<이름> 으로 격리 실행되는 랩 라우트.
 * 각 트랙은 src/debug/labs/<이름>.ts 에 `export function run(): void` 를 만들면
 * 자동으로 라우팅된다 (공유 파일 수정 불필요).
 * 예: ?scene=meshlab, ?scene=uilab, ?scene=audiolab, ?scene=battlelab
 */
const labs = import.meta.glob('./labs/*.ts');

export function tryRunLab(): boolean {
  const scene = new URLSearchParams(location.search).get('scene');
  if (!scene || !/^[a-z0-9_-]+$/i.test(scene)) return false;
  const key = `./labs/${scene}.ts`;
  const loader = labs[key];
  if (!loader) {
    console.warn(`[harness] 랩 없음: ${scene} (사용 가능: ${Object.keys(labs).join(', ')})`);
    return false;
  }
  void loader().then((mod) => {
    const m = mod as { run?: () => void };
    if (typeof m.run === 'function') m.run();
    else console.error(`[harness] ${key} 에 run() export가 없음`);
  });
  return true;
}

export function isDebugOverlayEnabled(): boolean {
  return new URLSearchParams(location.search).has('debug');
}

/** Playwright 테스트 훅 노출 여부 */
export function isTestMode(): boolean {
  return new URLSearchParams(location.search).has('test');
}
