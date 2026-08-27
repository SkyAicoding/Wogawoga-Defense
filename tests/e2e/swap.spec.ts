/**
 * **자리 교환 e2e** — 배선이 통째로 새것이라 sim 계약만으로는 못 잡는 자리를 잡는다.
 *
 * `tests/sim/economy.test.ts` 가 sim 쪽(자리만 바뀐다 · 내용물이 안 섞인다 · 거부 경로)을
 * 이미 잠근다. 여기서 잠그는 것은 그 커맨드까지 **손가락이 닿는가**다:
 *   버튼이 패널에 있는가 → 누르면 무장 표시가 붙는가 → 다음 탭이 결제가 되는가.
 * 셋 중 하나만 끊겨도 화면에서는 "눌러도 아무 일이 없다"로 보이고, sim 테스트는 전부 초록이다.
 *
 * ⚠ 이 파일이 `smoke.spec.ts` 와 따로인 이유: 저쪽은 드로우콜 예산과 플로우를 재는 무거운
 *   파일이고, 이 계약은 조작 배선 하나만 본다. 섞으면 예산 실패가 배선 실패로 읽힌다.
 */
import { expect, test, type Page } from '@playwright/test';

interface TowerRow { id: number; x: number; z: number }

/** 준비 단계를 얼린다 — 적이 나오면 "안 바뀌었다"와 "부서졌다"가 안 갈린다 */
const holdPrep = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as unknown as { __wgd: { sim: { state: { prepTicksLeft: number } } } }).__wgd
      .sim.state.prepTicksLeft = 1e9;
  });

const towers = (page: Page): Promise<TowerRow[]> =>
  page.evaluate(() =>
    (window as unknown as {
      __wgd: { sim: { state: { towers: { id: number; cellX: number; cellZ: number }[] } } };
    }).__wgd.sim.state.towers.map((t) => ({ id: t.id, x: t.cellX, z: t.cellZ })),
  );

test('자리 교환: 패널 버튼 → 무장 → 다음 탭이 결제된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => (window as unknown as { __wgd?: unknown }).__wgd !== undefined);
  await holdPrep(page);
  // 커튼/인트로 카메라가 끝나야 캔버스 탭이 판에 닿는다(smoke.spec.ts 와 같은 실측)
  await page.waitForTimeout(1_200);

  // 타워 둘을 **커맨드로** 세운다 — 이 계약이 재려는 것은 배치가 아니라 교환이다
  const cells = await page.evaluate(() => {
    const g = (window as unknown as {
      __wgd: {
        setGold(n: number): void;
        sim: {
          canPlaceAt(x: number, z: number): boolean;
          applyCommand(c: { type: string; handIndex: number; cellX: number; cellZ: number }): boolean;
        };
      };
    }).__wgd;
    g.setGold(999_999);
    const out: { x: number; z: number }[] = [];
    for (let z = 0; z < 40 && out.length < 2; z++) {
      for (let x = 0; x < 40 && out.length < 2; x++) {
        if (!g.sim.canPlaceAt(x, z)) continue;
        if (g.sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ: z })) {
          out.push({ x, z });
        }
      }
    }
    return out;
  });
  expect(cells.length, '타워 둘을 못 세웠다 — 이 계약이 성립하지 않는다').toBe(2);
  const before = await towers(page);

  const screenOf = (c: { x: number; z: number }): Promise<{ x: number; y: number }> =>
    page.evaluate(
      (cc) =>
        (window as unknown as { __wgd: { cellToScreen(x: number, z: number): { x: number; y: number } } })
          .__wgd.cellToScreen(cc.x, cc.z),
      c,
    );

  // ① 첫 타워를 탭 → 패널이 뜬다
  const p0 = await screenOf(cells[0]!);
  await page.mouse.click(p0.x, p0.y);
  await page.waitForTimeout(250);
  const swapBtn = page.locator('.tp-btn--swap');
  await expect(swapBtn, '타워 패널에 교환 버튼이 없다').toBeVisible();

  // ② 버튼을 누르면 **무장 표시**가 붙는다. 안 붙으면 화면이 상태를 말하지 않는 것이고,
  //    그러면 사용자에게는 "눌렀는데 아무 일도 안 일어난다"로 보인다.
  await swapBtn.click();
  await page.waitForTimeout(200);
  await expect(swapBtn, '무장 표시(is-armed)가 안 붙었다').toHaveClass(/is-armed/);

  // ③ 다음 탭이 **결제**다 — 두 타워의 자리가 정확히 맞바뀐다
  const p1 = await screenOf(cells[1]!);
  await page.mouse.click(p1.x, p1.y);
  await page.waitForTimeout(300);
  const after = await towers(page);
  const a = after.find((t) => t.id === before[0]!.id)!;
  const b = after.find((t) => t.id === before[1]!.id)!;
  expect([a.x, a.z], `첫 타워가 안 옮겨졌다 (전 ${JSON.stringify(before)} / 후 ${JSON.stringify(after)})`)
    .toEqual([before[1]!.x, before[1]!.z]);
  expect([b.x, b.z], '둘째 타워가 안 옮겨졌다').toEqual([before[0]!.x, before[0]!.z]);
  // 결제가 끝나면 무장은 스스로 풀린다 — 안 풀리면 다음 탭이 또 결제된다
  await expect(swapBtn, '결제 뒤에도 무장이 남아 있다').not.toHaveClass(/is-armed/);

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});
