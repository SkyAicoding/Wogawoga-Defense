/**
 * zz 임시 계측 — 비전투 씬(타이틀 배경 · 로비 배경)의 프레임당 실제 GL 드로우콜/삼각형.
 * 이 화면들에는 __wgd 훅이 없다(전투 컨트롤러만 심는다) → gl.draw* 를 직접 후킹한다.
 * 재고 나면 지운다.
 */
import { expect, test, type Page } from '@playwright/test';

const HOOK = `
(() => {
  const S = { calls: 0, tris: 0 };
  window.__zz = S;
  const triFor = (mode, count, inst) => (mode === 4 ? (count / 3) * (inst || 1) : 0);
  const wrap = (obj, name, triArgs) => {
    const orig = obj && obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (...a) {
      S.calls++;
      S.tris += triArgs(a);
      return orig.apply(this, a);
    };
  };
  const protos = [
    typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null,
    typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null,
  ].filter(Boolean);
  for (const p of protos) {
    wrap(p, 'drawArrays', (a) => triFor(a[0], a[2], 1));
    wrap(p, 'drawElements', (a) => triFor(a[0], a[1], 1));
    wrap(p, 'drawArraysInstanced', (a) => triFor(a[0], a[2], a[3]));
    wrap(p, 'drawElementsInstanced', (a) => triFor(a[0], a[1], a[4]));
    wrap(p, 'drawRangeElements', (a) => triFor(a[0], a[3], 1));
    // BatchedMesh 는 확장 객체의 multiDraw* 를 쓴다 — getExtension 을 통해 감싼다
    const ge = p.getExtension;
    p.getExtension = function (n) {
      const ext = ge.call(this, n);
      if (ext && n === 'WEBGL_multi_draw' && !ext.__zzWrapped) {
        ext.__zzWrapped = true;
        const mdA = ext.multiDrawArraysWEBGL;
        const mdE = ext.multiDrawElementsWEBGL;
        if (mdA) ext.multiDrawArraysWEBGL = function (mode, f, fo, c, co, n) {
          S.calls++;
          for (let i = 0; i < n; i++) S.tris += triFor(mode, c[co + i], 1);
          return mdA.call(this, mode, f, fo, c, co, n);
        };
        if (mdE) ext.multiDrawElementsWEBGL = function (mode, c, co, t, o, oo, n) {
          S.calls++;
          for (let i = 0; i < n; i++) S.tris += triFor(mode, c[co + i], 1);
          return mdE.call(this, mode, c, co, t, o, oo, n);
        };
      }
      return ext;
    };
  }
})();
`;

/** rAF 사이의 델타 = 그 프레임의 드로우콜/삼각형. n프레임 관측 최댓값 + 최빈 정지값. */
function zzFrames(page: Page, frames = 30): Promise<{ calls: number; tris: number; last: number[] }> {
  return page.evaluate(
    (n) =>
      new Promise<{ calls: number; tris: number; last: number[] }>((res) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const S = (window as any).__zz;
        let pc = S.calls;
        let pt = S.tris;
        let calls = 0;
        let tris = 0;
        const last: number[] = [];
        let i = 0;
        const step = (): void => {
          const dc = S.calls - pc;
          const dt = S.tris - pt;
          pc = S.calls;
          pt = S.tris;
          if (i > 1) {
            calls = Math.max(calls, dc);
            tris = Math.max(tris, dt);
            last.push(dc);
          }
          if (++i >= n) res({ calls, tris: Math.round(tris), last });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    frames,
  );
}

test('zz 비전투 씬 — 타이틀 배경 / 로비 배경', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop 1280x800 에서만');
  test.setTimeout(120_000);
  await page.addInitScript(HOOK);
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await expect(page.getByText('탭하여 시작')).toBeVisible();
  await page.waitForTimeout(1200);
  const title = await zzFrames(page, 30);
  // eslint-disable-next-line no-console
  console.log(`ZZBD 타이틀 배경 ${title.calls}콜 / ${title.tris}삼각형 (프레임열 ${title.last.slice(0, 12).join(',')})`);

  await page.mouse.click(100, 300);
  await expect(page.getByRole('button', { name: /전투/ }).first()).toBeVisible();
  await page.waitForTimeout(1200);
  const lobby = await zzFrames(page, 30);
  // eslint-disable-next-line no-console
  console.log(`ZZBD 로비 배경 ${lobby.calls}콜 / ${lobby.tris}삼각형 (프레임열 ${lobby.last.slice(0, 12).join(',')})`);

  expect(title.calls).toBeGreaterThan(0);
  expect(lobby.calls).toBeGreaterThan(0);
});
