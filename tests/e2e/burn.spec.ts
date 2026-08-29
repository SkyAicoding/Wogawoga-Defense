/**
 * **마을이 불타고 무너진다** — 사용자 요구로 생긴 계약:
 *   > "홈타운이 공격을 받을수록 더 부서진 모습이나 불타는 모습이 있어야 하고, 마지막에
 *   >  끝날때는 폭발 하는 애니메이션이 있어야되, 완전히 불타서 마을이 망하는 모습을
 *   >  더 추가해줘"
 *
 * `tests/render/basecamp.test.ts` 가 **모델**(불 면적 · 숯 색 · 잿더미)을 잠근다.
 * 여기서 잠그는 것은 그 모델까지 **배선이 실제로 닿는가**다 — 셋 다 vitest 로는 못 잡는다:
 *  ① 판이 시작할 때 마을은 **온전하다**(앞 판의 폐허가 안 샌다)
 *  ② HP 가 깎이면 피해 단계가 **올라간다** (`baseDamageStage` 가 실제로 불린다)
 *  ③ 패배하면 **전소(3)** 가 되고 그 순간 **폭발 파티클이 터진다**
 *
 * ⚠ 파티클은 `liveCount` 가 아니라 **누계**(`particlesSpawned`)로 잰다. 폭발은 몇 프레임이면
 *   죽어 사라지므로 "지금 살아 있나"를 물으면 타이밍에 걸려 흔들린다 — 물어야 하는 것은
 *   "그때 났나"다.
 */
import { expect, test, type Page } from '@playwright/test';

interface Hooks {
  baseDamage(): number;
  particlesSpawned(): number;
  ff(n: number): void;
  sim: { state: { baseHp: number; baseHpMax: number; prepTicksLeft: number; phase: string } };
}
const hooks = (page: Page): Promise<Hooks> => page.evaluate(() => (window as unknown as { __wgd: Hooks }).__wgd) as never;

async function enterBattle(page: Page): Promise<void> {
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => '__wgd' in window);
  await page.waitForTimeout(1200);
}
const read = <T>(page: Page, f: (g: Hooks) => T): Promise<T> =>
  page.evaluate(f as never, undefined as never) as never;

test('마을은 온전히 시작해 · 맞을수록 무너지고 · 패배하면 불타 무너진다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  void hooks;
  void read;

  await enterBattle(page);

  // ① 시작은 온전하다
  const at0 = await page.evaluate(() => (window as never as { __wgd: Hooks }).__wgd.baseDamage());
  expect(at0, '판이 시작하는데 마을이 이미 상해 있다 — 앞 판의 상태가 샌다').toBe(0);

  // ② HP 를 깎으면 단계가 오른다. 한 대 물려야 `baseDamaged` 가 나가므로 웨이브를 돌린다
  await page.evaluate(() => {
    const g = (window as never as { __wgd: Hooks }).__wgd;
    g.sim.state.prepTicksLeft = 0;
  });
  await page.evaluate(() => {
    const g = (window as never as { __wgd: Hooks }).__wgd;
    // 절반 조금 아래로 — `baseDamageStage` 의 0.6 문턱을 넘겨 1 이 되는 자리
    g.sim.state.baseHp = Math.floor(g.sim.state.baseHpMax * 0.45);
    g.ff(900);
  });
  const mid = await page.evaluate(() => (window as never as { __wgd: Hooks }).__wgd.baseDamage());
  expect(mid, `HP 45% 인데 피해 단계가 ${mid} — 맞아도 안 무너진다`).toBeGreaterThan(0);
  expect(mid, `HP 45% 인데 벌써 전소(${mid}) — 단계가 너무 빨리 간다`).toBeLessThan(3);

  // ③ 패배 — 전소 + 폭발
  const before = await page.evaluate(() => (window as never as { __wgd: Hooks }).__wgd.particlesSpawned());
  await page.evaluate(() => {
    const g = (window as never as { __wgd: Hooks }).__wgd;
    g.sim.state.baseHp = 1;
    g.ff(600);
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => (window as never as { __wgd: Hooks }).__wgd.particlesSpawned());
  const dmg = await page.evaluate(() => (window as never as { __wgd: Hooks }).__wgd.baseDamage());

  expect(dmg, `패배했는데 마을 피해 단계가 ${dmg} — 전소가 안 됐다`).toBe(3);
  /*
   * 폭발 규모의 문턱 150 의 유도: 이 한 번의 호출이 내는 파티클은 `explosion(strength 3.2)`
   * + 링 셋(22+26+30) + 잔해 22 이고, 링과 잔해만 **100발 고정**이다(품질 예산을 안 탄다).
   * 폭발 자체가 최저 품질에서도 그만큼은 더 얹으므로 150 은 저사양에서도 안전한 하한이고,
   * 연출을 지우면(패배 훅 제거) 같은 구간의 증가가 두 자릿수로 떨어진다.
   */
  expect(after - before, `패배 순간 파티클 ${after - before}발 — 폭발이 안 터졌다`).toBeGreaterThan(150);

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});
