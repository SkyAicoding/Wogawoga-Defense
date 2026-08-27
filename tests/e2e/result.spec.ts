/**
 * **결과 화면은 판 위에 뜬다** — 사용자 요구로 생긴 계약:
 *   > "게임 엔딩 팝업이 게임 화면을 약간 어둡게 하고 바로 나오도록 해줘.
 *   >  지금은 그냥 빈 화면에 별도로 나오고 있어"
 *
 * 옛 흐름은 전투가 끝나는 순간 판을 **버리고**(`disposeBattle`) 로비 디오라마를 세운 뒤
 * 그 위에 **불투명** 결과 화면을 덮었다. 사용자에게는 그것이 "빈 화면에 별도로"였다.
 *
 * 여기서 잠그는 것 셋. 전부 **vitest 로는 못 잡는 것**이다 — 판이 살아 있는지, 그것이
 * 화면에 비치는지, 떠날 때 버려지는지는 브라우저에 합성된 픽셀에만 있다:
 *  ① 결과가 뜬 뒤에도 **전투 판이 살아 있다** (`__wgd` 훅이 남아 있다)
 *  ② 그 판이 결과 화면 **뒤로 비친다** — 캔버스가 보이는 점들에 가로 대비가 살아 있고,
 *    같은 점들이 전투 때보다 **어둡다**. 불투명 커튼이면 가로 대비가 무너진다.
 *  ③ 결과를 **떠나면 판을 버린다** — 안 버리면 전투 씬이 로비까지 따라가고 GPU 자원이 샌다
 *
 * ⚠ 계기 주의: 표본은 **`elementFromPoint` 로 고른다**. 좌표를 손으로 박으면 화면 비율이
 *   바뀌는 순간 HUD·패널 위를 재게 되고, 그때 이 계약은 "판이 안 보인다"가 아니라
 *   "패널이 보인다"를 재게 된다 — 이 저장소의 지병이 정확히 그 형태다.
 */
import { expect, test, type Page } from '@playwright/test';

/** 표본 격자 간격 (CSS px) — 흐림(1.5px)보다 충분히 크게 */
const STEP = 10;
/** 한 행에서 이만큼은 잡혀야 가로 대비를 말할 수 있다 */
const MIN_PER_ROW = 16;

type Pt = { x: number; y: number };

/** 지금 화면에서 **캔버스가 실제로 보이는** 격자점 — 위에 덮은 것이 없거나, 덮은 것이 투명한 곳 */
async function visiblePoints(page: Page, allow: readonly string[]): Promise<Pt[]> {
  return page.evaluate(
    ({ step, allow }) => {
      const out: { x: number; y: number }[] = [];
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {
          const el = document.elementFromPoint(x, y);
          if (!el) continue;
          // 맨 위 요소가 허용 목록에 있어야 한다 = 그 점을 가리는 **자식이 없다**
          const ok = allow.some((sel) => el.matches(sel));
          if (ok) out.push({ x, y });
        }
      }
      return out;
    },
    { step: STEP, allow: [...allow] },
  );
}

/** 화면을 찍어 주어진 점들의 밝기(0~255)를 읽는다 — DOM 오버레이까지 **합성된** 픽셀이다 */
async function lumaAt(page: Page, pts: readonly Pt[]): Promise<number[]> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, pts }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      if (!g) throw new Error('2d 컨텍스트 없음');
      g.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth;
      const sy = img.height / window.innerHeight;
      return pts.map((p) => {
        const d = g.getImageData(Math.round(p.x * sx), Math.round(p.y * sy), 1, 1).data;
        return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
      });
    },
    { png, pts: [...pts] },
  );
}

const stdev = (v: readonly number[]): number => {
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / (v.length || 1);

/** 행별 가로 대비의 최댓값 — 불투명 커튼(세로 그라디언트)은 **행 안에서** 거의 평평하다 */
function maxRowContrast(pts: readonly Pt[], luma: readonly number[]): number {
  const rows = new Map<number, number[]>();
  pts.forEach((p, i) => {
    const r = rows.get(p.y) ?? [];
    r.push(luma[i]);
    rows.set(p.y, r);
  });
  let best = 0;
  for (const [, vals] of rows) {
    if (vals.length < MIN_PER_ROW) continue;
    best = Math.max(best, stdev(vals));
  }
  return best;
}

test('결과 팝업은 전투 화면을 어둡게 덮고, 떠날 때 판을 버린다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300); // 타이틀 → 로비
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => '__wgd' in window);
  await page.waitForTimeout(1400); // 안내 배너·카드가 자리 잡을 때까지

  // --- 전투 중 기준선 ---------------------------------------------------------
  const beforePts = await visiblePoints(page, ['#game-canvas']);
  expect(beforePts.length, '전투 중에 캔버스가 보이는 점이 너무 적다 — 계기가 판을 못 본다')
    .toBeGreaterThan(400);
  const beforeLuma = await lumaAt(page, beforePts);

  // --- 패배시킨다 -------------------------------------------------------------
  await page.evaluate(() => {
    const g = (window as unknown as { __wgd: { sim: { state: Record<string, number> } } }).__wgd;
    g.sim.state['prepTicksLeft'] = 0;
  });
  await page.evaluate(() => {
    const g = (window as unknown as {
      __wgd: { sim: { state: Record<string, number> }; ff: (n: number) => void };
    }).__wgd;
    g.sim.state['baseHp'] = 1;
    g.ff(1200);
  });
  await expect(page.locator('.screen--result')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(900); // 페이드 인이 끝난 뒤에 잰다

  // ① 판이 살아 있다 — dispose 는 훅을 같이 지운다(battlecontroller.dispose)
  const alive = await page.evaluate(() => {
    const w = window as unknown as { __wgd?: { sim: { state: { phase: string } } } };
    return w.__wgd ? w.__wgd.sim.state.phase : null;
  });
  expect(alive, '결과가 뜬 뒤 전투 판이 사라졌다 — 결과가 빈 화면에 뜬다').toBe('lost');

  // ② 그 판이 결과 화면 뒤로 비친다
  //    표본은 **결과 오버레이의 빈 자리**(패널·버튼·별이 안 덮은 곳)에서만 고른다
  const afterPts = await visiblePoints(page, ['.screen--result', '.res-col']);
  expect(afterPts.length, '결과 화면에서 덮이지 않은 점이 너무 적다 — 잴 자리가 없다')
    .toBeGreaterThan(200);
  const afterLuma = await lumaAt(page, afterPts);
  const beforeAtSame = await (async (): Promise<number[]> => {
    // 같은 자리를 전투 기준선에서도 읽어야 "어두워졌다"를 말할 수 있다
    const idx = new Map(beforePts.map((p, i) => [`${p.x},${p.y}`, i]));
    const both = afterPts.map((p) => idx.get(`${p.x},${p.y}`)).filter((i): i is number => i !== undefined);
    expect(both.length, '전투 때와 결과 때 **같은 점**이 너무 적다').toBeGreaterThan(150);
    return both.map((i) => beforeLuma[i]);
  })();
  const afterAtBoth = ((): { pts: Pt[]; luma: number[] } => {
    const have = new Set(beforePts.map((p) => `${p.x},${p.y}`));
    const pts: Pt[] = [];
    const luma: number[] = [];
    afterPts.forEach((p, i) => {
      if (!have.has(`${p.x},${p.y}`)) return;
      pts.push(p);
      luma.push(afterLuma[i]);
    });
    return { pts, luma };
  })();

  const contrast = maxRowContrast(afterAtBoth.pts, afterAtBoth.luma);
  // 실측을 남긴다 — 문턱과 실제 사이의 여유를 다음 사람이 눈으로 본다
  console.log(
    `[결과 오버레이] 표본 ${afterAtBoth.pts.length} · 행 대비 ${contrast.toFixed(1)} ` +
      `· 밝기 ${mean(beforeAtSame).toFixed(1)} → ${mean(afterAtBoth.luma).toFixed(1)}`,
  );
  expect(
    contrast,
    `결과 화면 뒤가 평평하다(행 대비 ${contrast.toFixed(1)}) — 판이 안 비친다(불투명 커튼)`,
  ).toBeGreaterThan(6);

  const mBefore = mean(beforeAtSame);
  const mAfter = mean(afterAtBoth.luma);
  expect(mAfter, `결과가 판을 안 어둡게 한다 (전투 ${mBefore.toFixed(1)} → 결과 ${mAfter.toFixed(1)})`)
    .toBeLessThan(mBefore - 8);
  expect(mAfter, `결과 뒤가 새까맣다 (${mAfter.toFixed(1)}) — "약간 어둡게"가 아니다`)
    .toBeGreaterThan(6);

  // ③ 결과를 떠나면 판을 버린다
  await page.getByRole('button', { name: /로비/ }).first().click();
  await page.waitForTimeout(700);
  const leaked = await page.evaluate(() => '__wgd' in window);
  expect(leaked, '로비로 나갔는데 전투 판이 살아 있다 — 씬과 GPU 자원이 샌다').toBe(false);

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});
