/**
 * **웨이브 미리보기 띠는 없앴고, 손패의 상성 경고는 살렸다** — 사용자 요구:
 *   > "이렇게 하단 메뉴위에 나오는 스테이지 안내는 없어도 될거 같아.
 *   >  있어도 잘 보이지 않고, 본다해도 너무 짧게 보여서 의미가 없어. 그냥 없애도 되"
 *
 * ⚠ 이 계약이 진짜로 지키는 것은 **두 번째 줄**이다. 띠와 카드 경고는 같은 자료
 *   (`sim.previewWave`)를 쓰던 **다른 표시**라, 띠를 지우다가 조회까지 같이 지우면
 *   카드의 회색 오버레이·특성 아이콘이 **조용히 죽는다** — 화면 어디에도 에러가 안 나고
 *   타입도 통과한다(`entries`가 빈 배열이 될 뿐이다). 그래서 "없어진 것"과 "남은 것"을
 *   한 계약 안에서 같이 잰다: 없어진 쪽만 재면 전투에 못 들어가도 초록이 된다.
 *
 * 계량 근거(실측, `previewWave` × 시작 덱 spear/catapult/frost, T1 기준):
 *   스테이지1 **웨이브 1** 에서 `catapult → splash` 가 걸린다. 곧 첫 준비 단계에
 *   투석기 카드가 손에 있으면 반드시 회색이 되어야 한다. (s1 전체로는 21건)
 */
import { expect, test, type Page } from '@playwright/test';

interface Hooks {
  sim: {
    state: {
      phase: string;
      waveIndex: number;
      prepTicksLeft: number;
      gold: number;
      hand: { towerId: string; cost: number }[];
    };
  };
}
const W = (page: Page): Promise<Hooks> => page.evaluate(() => (window as unknown as { __wgd: Hooks }).__wgd) as never;

test('전투 준비 단계: 미리보기 띠는 없고, 손패 상성 경고는 그대로 뜬다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  void W;

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => '__wgd' in window);

  // 준비 단계를 얼린다 — 띠가 살아 있던 유일한 국면이 prep 이므로, 여기서 재야 한다
  await page.evaluate(() => {
    const g = (window as unknown as { __wgd: Hooks }).__wgd;
    g.sim.state.prepTicksLeft = 1e9;
  });

  /*
   * ⚠⚠ **고정 대기(waitForTimeout)를 쓰면 안 된다.** HUD 는 rAF 루프가 미는 폴링이라
   *   상태를 넣은 것과 DOM 이 그것을 그리는 것 사이에 정해진 시간이 없다. 전투 첫
   *   프레임들은 셰이더 컴파일로 멈칫하고(headless swiftshader 에서 특히), 그 멈칫이
   *   대기 시간을 넘긴 판에서는 **낡은 DOM 을 세게 된다.**
   *   실측: 이 파일이 `waitForTimeout(500)` 을 쓰던 판본은 4회 중 2회 빨갰다
   *   (게임 쪽은 멀쩡했다 — 순전히 계기가 흔들린 것이다).
   *   그래서 아래는 전부 **조건으로** 기다린다(자동 재시도 expect / expect.poll).
   */

  // ── 통제: 정말 준비 단계이고 손패가 그려져 있다 ─────────────────────────────
  // 이 줄이 없으면 아래 '띠가 없다'가 **전투에 못 들어가도** 초록이 된다.
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __wgd: Hooks }).__wgd.sim.state.phase),
      { message: '통제 실패: 준비 단계가 아니다' },
    )
    .toBe('prep');
  await expect(page.locator('.callwave'), '웨이브 시작 버튼이 없다 = prep HUD 가 아니다').toBeVisible();
  await expect(page.locator('.tcard'), '손패 카드가 안 그려졌다').toHaveCount(3);
  const st = await page.evaluate(() => {
    const g = (window as unknown as { __wgd: Hooks }).__wgd;
    return { phase: g.sim.state.phase, wave: g.sim.state.waveIndex };
  });

  // ── ① 미리보기 띠가 없다 ────────────────────────────────────────────────────
  expect(await page.locator('.wave-preview').count(), '미리보기 띠가 아직 있다').toBe(0);
  expect(await page.locator('.wp-chip, .wp-toggle, .wp-bar').count(), '띠 조각이 남았다').toBe(0);

  // ── ② 손패 상성 경고는 살아 있다 ────────────────────────────────────────────
  // 웨이브 1(실측: catapult → splash)에 투석기를 손에 쥐여 준다. 손패 서명이 바뀌므로
  // 다음 프레임에 카드가 새로 그려지고, 그 자리에서 preview 를 다시 읽는다.
  expect(st.wave, '통제 실패: 실측한 웨이브(1)가 아니다').toBe(1);
  await page.evaluate(() => {
    const g = (window as unknown as { __wgd: Hooks }).__wgd;
    g.sim.state.gold = 9999; // 회색은 상성이지 잔고가 아니다 — is-disabled 와 섞이지 않게
    g.sim.state.hand = [
      { towerId: 'catapult', cost: 60 },
      { towerId: 'spear', cost: 50 },
      { towerId: 'spear', cost: 50 },
    ];
  });
  // 손패 서명이 바뀌면 카드가 새로 그려지고, 그 프레임에 preview 를 다시 읽는다.
  // 몇 프레임 뒤가 될지는 모르므로 **회색이 될 때까지** 기다린다.
  await expect
    .poll(() => page.locator('.tcard.is-countered').count(), {
      message: '투석기가 웨이브1(흩어짐)에 회색으로 안 뜬다 — previewWave 배선이 끊겼다',
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  // ⚠ `.tcard-warn` 은 상성이 없어도 **DOM 에는 있다**(display:none 으로만 감춘다).
  //   그래서 여기서도 **보이는 것**만 센다 — 개수로 재면 항상 3이라 아무 말도 못 한다.
  await expect(
    page.locator('.tcard-warn:visible'),
    '회색은 됐는데 특성 아이콘이 안 보인다 — 표시 절반만 살았다',
  ).toHaveCount(1);

  expect(errors, '콘솔 에러').toEqual([]);
});
