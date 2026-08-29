/**
 * **부족 칩은 토글이다** — 사용자 요구 (2026-08-29):
 *   > "이 버튼을 토글로 해줘 한번 하면 나오고 한번더 누르면 사라지게"
 *
 * ⚠ 이 계약이 잡는 회귀는 **두 번째 누름이 아무 일도 안 하는 것**이다. 전에 그랬다:
 *   `placement.selectBase()` 는 이미 골라져 있으면 그냥 돌아가므로, 버튼을 몇 번을
 *   눌러도 패널이 열린 채였다. vitest 로는 못 잡는다 — sim 상태가 아니라 **DOM 과
 *   placement 선택 상태**의 문제이고, 타입도 통과한다.
 *
 * 그래서 **세 번** 누른다. 두 번만 재면 "여는 것과 닫는 것이 각각 한 번씩 되는가"까지만
 * 잠기고, 세 번째가 다시 열리는지는 아무도 안 본다 — 토글은 **되풀이되는 것**이다.
 */
import { expect, test, type Page } from '@playwright/test';

interface Hooks {
  sim: { state: { phase: string; prepTicksLeft: number } };
}

const PANEL = '.tower-panel--home';
const PILL = '.pill--ally';

test('부족 칩: 누를 때마다 마을 패널이 열리고 닫힌다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => '__wgd' in window);
  await page.evaluate(() => {
    (window as unknown as { __wgd: Hooks }).__wgd.sim.state.prepTicksLeft = 1e9;
  });

  // 통제: 전투 HUD 가 떴고 칩이 눌리는 자리에 있다 (조건 대기 — 고정 대기는 흔들린다)
  const pill = page.locator(PILL);
  await expect(pill, '부족 칩이 없다 — 전투 HUD 가 아니다').toBeVisible();
  const panel = page.locator(PANEL);
  await expect(panel, '시작부터 마을 패널이 떠 있다').toBeHidden();
  await expect(pill).toHaveAttribute('aria-expanded', 'false');

  // 세 번 눌러 열림 → 닫힘 → 열림 이 **되풀이되는지** 본다
  const states: boolean[] = [];
  for (let i = 1; i <= 3; i++) {
    await pill.click();
    // 열림/닫힘 중 하나로 **가라앉을 때까지** 기다린 뒤에 읽는다
    await expect
      .poll(() => panel.isVisible(), { message: `${i}번째 누름 뒤 패널 상태가 안 잡힌다` })
      .toBe(i % 2 === 1);
    states.push(await panel.isVisible());
    // 버튼이 자기 상태를 말하는가 — 토글은 눌린 꼴이 보여야 다음 누름을 예상할 수 있다
    await expect(pill, `${i}번째 누름 뒤 aria-expanded 가 패널과 어긋난다`)
      .toHaveAttribute('aria-expanded', i % 2 === 1 ? 'true' : 'false');
    expect(await pill.evaluate((el) => el.classList.contains('is-open')), `${i}번째 누름 뒤 is-open`)
      .toBe(i % 2 === 1);
  }
  expect(states, '열림 → 닫힘 → 열림 이 아니다 (두 번째 누름이 안 닫았다)').toEqual([true, false, true]);

  expect(errors, '콘솔 에러').toEqual([]);
});
