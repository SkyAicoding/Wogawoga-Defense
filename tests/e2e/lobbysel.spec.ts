/**
 * **로비가 보여 주는 스테이지 = 전투 시작이 들어가는 스테이지** — 사용자 제보로 생긴 계약:
 *   > "스테이지2,3,4,5,6 등을 선택해서 플레이 하다가 중단하고 홈으로 나오면 보이는 화면은
 *   >  무조건 스테이지1 화면이 보여. 이때 다시 전투시작을 누르면 자동으로 했던 스테이지로
 *   >  들어가버려. 즉 화면에 보이는 스테이지 이미지와 전투시작시 들어가는 스테이지가 다르게
 *   >  나와. … 다음 스테이지 버튼을 누르면 스테이지1로 보이던 화면이 갑자기 스테이지 6으로
 *   >  바뀌어 버려."
 *
 * 원인: `createLobbyScreen()` 의 `selectedIdx` 는 화면을 나갔다 와도 **닫힘 변수라 남는데**,
 * 캐러셀 DOM 은 `enter()` 마다 새로 만들어져 **스크롤이 0으로 돌아간다**. 곧 상태는 6인데
 * 화면은 1이고, 점(dots)·전투 시작·화살표는 전부 6을 따른다.
 *
 * 잣대는 **화면에 보이는 것**이다 — 캐러셀 중앙에 온 카드가 진실이고, 그것이
 *  ① 켜진 점(dots)과 같아야 하고
 *  ② 전투 시작이 실제로 들어가는 스테이지와 같아야 한다.
 * 둘 다 DOM/sim 에서 되읽는다(내부 `selectedIdx` 를 훔쳐보지 않는다 — 그러면 화면이 아니라
 * 구현을 재게 되고, 화면만 어긋나는 바로 이 버그를 놓친다).
 */
import { expect, test, type Page } from '@playwright/test';

/** 캐러셀 중앙에 가장 가까운 카드의 인덱스 — **사용자가 보고 있는 것** */
const centeredCard = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const car = document.querySelector('.carousel') as HTMLElement;
    const cards = [...car.querySelectorAll<HTMLElement>('.stage-card')];
    const mid = car.scrollLeft + car.clientWidth / 2;
    let best = 0;
    let bestD = Infinity;
    cards.forEach((c, i) => {
      const d = Math.abs(c.offsetLeft - car.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  });

/** 켜진 점의 인덱스 — 로비가 "고른 것"이라고 말하는 값 */
const activeDot = (page: Page): Promise<number> =>
  page.evaluate(() => [...document.querySelectorAll('.dots > *')].findIndex((d) => d.classList.contains('is-on')));

const enteredStage = (page: Page): Promise<number | null> =>
  page.evaluate(
    () =>
      (
        (window as unknown as { __wgd: { sim: { ctx?: { opts?: { stage?: { id?: number } } } } } })
          .__wgd.sim as { ctx?: { opts?: { stage?: { id?: number } } } }
      ).ctx?.opts?.stage?.id ?? null,
  );

test('뒤 스테이지를 하다 홈으로 나와도, 보이는 카드와 들어가는 스테이지가 같다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300); // 타이틀 → 로비
  await page.waitForTimeout(400);

  // 모든 스테이지 열기 (뒤 스테이지를 골라야 이 계약이 성립한다)
  await page.locator('.topbar .icon-btn').last().click();
  const sw = page.locator('.set-row', { hasText: '모든 스테이지 열기' }).getByRole('switch');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.locator('.topbar .icon-btn').first().click();
  await page.waitForTimeout(400);

  // 스테이지 6 카드로 옮긴다 (로비는 **스크롤 위치**로만 선택을 정한다)
  await page.evaluate(() => {
    const car = document.querySelector('.carousel') as HTMLElement;
    const card = car.querySelectorAll<HTMLElement>('.stage-card')[5]!;
    car.scrollLeft = card.offsetLeft - car.offsetLeft;
  });
  await page.waitForTimeout(500);
  expect(await centeredCard(page), '스테이지 6 카드로 못 옮겼다 — 이 계약이 성립하지 않는다').toBe(5);

  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => '__wgd' in window);
  await page.waitForTimeout(800);
  expect(await enteredStage(page), '스테이지 6 으로 안 들어갔다').toBe(6);

  // 중단하고 홈으로 — 일시정지 → 포기
  await page.locator('.hud-pause, .btn--pause, [aria-label="일시정지"]').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /포기|로비|나가기/ }).first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('.screen--lobby'), '로비로 안 나왔다').toBeVisible();

  // ── 여기가 제보된 자리 ──────────────────────────────────────────────────
  const seen = await centeredCard(page);
  const dot = await activeDot(page);
  expect(dot, `보이는 카드 s${seen + 1} 인데 켜진 점은 s${dot + 1} — 화면과 선택이 어긋난다`)
    .toBe(seen);

  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => '__wgd' in window);
  await page.waitForTimeout(800);
  expect(await enteredStage(page), `보이던 카드는 s${seen + 1} 인데 다른 스테이지로 들어갔다`)
    .toBe(seen + 1);

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});
