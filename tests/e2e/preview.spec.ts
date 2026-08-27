/**
 * **도감 액션 미리보기** — 사용자 요구로 생긴 화면:
 *   > "도감 메뉴에서 각 레벨별로 액션 미리 볼수 있는 기능 만들어줘.
 *   >  게임 플레이 하기 전에 어떤 모양으로 던지고 터지는지 볼수 있는 메뉴 말이야"
 *
 * 이 계약이 잠그는 것 넷. 전부 **sim 계약으로는 못 잡는 것**이다:
 *  ① 캔버스가 실제로 붙고 **그린다** (WebGL 컨텍스트가 살아 있다)
 *  ② 레벨 버튼이 티어 수만큼 있고, 누르면 **숫자도 같이 간다**
 *     — 처음엔 스탯이 Lv1 에 멈춰 있어서 화면이 두 가지를 동시에 말했다
 *  ③ **콘솔 에러 0** — 셰이더·재질을 새 컨텍스트에서 다시 컴파일하는 자리라
 *     여기서 깨지면 화면이 까맣게 뜨고 vitest 는 아무것도 모른다
 *  ④ ⚠⚠ **컨텍스트가 안 샌다** — 여닫을 때마다 캔버스가 쌓이면 브라우저 상한(8~16)에
 *     걸리고, 그때 죽는 것은 **가장 오래된 캔버스** = 게임 본 화면이다. 증상이 원인에서
 *     한참 떨어져 나타나는 종류라 반드시 계약으로 잡아야 한다.
 */
import { expect, test, type Page } from '@playwright/test';

const openCodex = async (page: Page): Promise<void> => {
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300); // 타이틀 → 로비
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /도감/ }).first().click();
  await page.waitForTimeout(500);
};

test('도감 미리보기: 레벨을 고르면 동작과 숫자가 같이 간다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await openCodex(page);
  await page.locator('.coll-cell').first().click();
  await page.waitForTimeout(1200);

  // ① 캔버스가 붙고 크기를 가졌다 (0×0 이면 위젯이 리사이즈를 못 해 아무것도 안 그린다)
  const canvas = page.locator('.tower-preview .tp-canvas');
  await expect(canvas, '미리보기 캔버스가 없다').toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0, '캔버스 폭이 0 이다').toBeGreaterThan(80);
  expect(box?.height ?? 0, '캔버스 높이가 0 이다').toBeGreaterThan(60);

  // ② 레벨 버튼 다섯 · 누르면 스탯이 따라간다
  const lv = page.locator('.tp-lv-btn');
  await expect(lv, '레벨 버튼 수').toHaveCount(5);
  const statsAt = async (): Promise<string[]> =>
    page.locator('.sheet-stat-v').allInnerTexts();
  const at1 = await statsAt();
  await lv.last().click();
  await page.waitForTimeout(400);
  const at5 = await statsAt();
  expect(at5, `Lv1 ${at1.join('/')} 와 Lv5 ${at5.join('/')} 의 숫자가 같다 — 레벨을 안 따라간다`)
    .not.toEqual(at1);
  await expect(lv.last(), 'Lv5 버튼이 켜진 표시가 없다').toHaveClass(/is-on/);

  // ③ 콘솔 에러 0 (새 컨텍스트에서 셰이더가 다시 컴파일되는 자리다)
  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

/**
 * **잠긴 타워도 미리 볼 수 있다** — 사용자가 물린 자리:
 *   > "스테이지 안 열린것은 못 보내?"
 * 처음 판본은 해금한 타워에만 미리보기를 붙였다. 도감의 뜻이 **아직 못 쓰는 것을
 * 미리 보는 것**이므로 정확히 거꾸로였다. 해금 조건 안내(`.sheet-hint`)는 그대로 뜬다 —
 * 둘은 다른 정보라 겹치지 않는다.
 */
test('도감 미리보기: 스테이지 잠금 타워도 동작을 보여 준다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await openCodex(page);
  const locked = page.locator('.coll-cell.is-locked');
  const n = await locked.count();
  expect(n, '잠긴 타워가 하나도 없다 — 이 계약이 공허하다').toBeGreaterThan(0);

  await locked.first().click();
  await page.waitForTimeout(1000);
  const canvas = page.locator('.tower-preview .tp-canvas');
  await expect(canvas, '잠긴 타워에 미리보기가 없다').toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0, '캔버스 폭이 0 이다').toBeGreaterThan(80);
  await expect(page.locator('.tp-lv-btn'), '잠긴 타워에도 레벨 선택기가 있어야 한다').toHaveCount(5);
  // 해금 조건 안내는 여전히 뜬다 (미리보기가 그것을 밀어내면 안 된다)
  await expect(page.locator('.sheet-hint, .sheet-action').first(), '해금 안내가 사라졌다').toBeVisible();

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

test('도감 미리보기: 여닫아도 WebGL 컨텍스트가 안 샌다', async ({ page }) => {
  const errors: string[] = [];
  const warns: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warns.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  /*
   * ⚠⚠ **DOM 의 캔버스 수를 세면 안 된다.** 시트를 닫으면 캔버스 엘리먼트는 DOM 에서
   *   사라지지만 **WebGL 컨텍스트는 그대로 살아 있다**(`dispose()`/`forceContextLoss()`
   *   를 안 부르면). 그래서 캔버스 수는 언제나 0 으로 돌아가고 누수가 안 잡힌다 —
   *   실제로 이 계약의 첫 판본이 그 꼴이라 사보타주(dispose 제거)에서 초록이었다.
   *
   * 그래서 **피해를 직접 잰다**: 컨텍스트 상한(크로미움 기본 16)을 넘기면 브라우저가
   *   **가장 오래된 컨텍스트를 강제로 잃는다** — 그 희생자가 게임 본 캔버스다.
   *   본 캔버스에 `webglcontextlost` 리스너를 걸고 도감을 상한보다 많이 여닫는다.
   */
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const w = window as unknown as { __lost: number };
    w.__lost = 0;
    for (const c of Array.from(document.querySelectorAll('canvas'))) {
      c.addEventListener('webglcontextlost', () => { w.__lost++; });
    }
  });
  await page.mouse.click(100, 300);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /도감/ }).first().click();
  await page.waitForTimeout(500);

  const cells = page.locator('.coll-cell');
  expect(await cells.count(), '도감에 타워가 없다 — 이 계약이 공허하다').toBeGreaterThan(2);

  // 상한(16)보다 넉넉히 많이 — 안 버리면 여기서 반드시 터진다
  const ROUNDS = 20;
  for (let i = 0; i < ROUNDS; i++) {
    await cells.nth(0).click();
    await page.waitForTimeout(90);
    // 닫는 길 둘을 번갈아 지난다 (✕ · 배경 탭) — 어느 쪽이 새도 잡힌다
    if (i % 2 === 0) await page.locator('.sheet-close').click();
    else await page.locator('.sheet-backdrop').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(90);
  }

  const lost = await page.evaluate(() => (window as unknown as { __lost: number }).__lost);
  expect(lost, `게임 캔버스가 컨텍스트를 ${lost}번 잃었다 — 미리보기가 컨텍스트를 안 버린다`).toBe(0);
  const tooMany = warns.filter((w) => /too many active webgl/i.test(w));
  expect(tooMany, `브라우저 경고: ${tooMany.join(' / ')}`).toHaveLength(0);
  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});
