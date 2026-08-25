/** zz — 임시: 판당 채집/재생 사건 수 실측 (소리·파티클 빈도). 끝나면 지운다. */
import { expect, test } from '@playwright/test';

const REG = ['berry', 'honey', 'mushroom', 'fruit', 'wood'];

declare global {
  interface Window {
    __wgd?: any;
    __zz?: any[];
  }
}

test('zz 계수: 판당 gatherRegrown / gatherDelivered', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => window.__wgd !== undefined);
  await page.waitForTimeout(900);

  const out = await page.evaluate((reg: string[]) => {
    const g = window.__wgd!;
    const sim: any = g.sim;
    const log: any[] = [];
    const orig = sim.drainEvents.bind(sim);
    sim.drainEvents = () => {
      const ev = orig();
      for (const e of ev) log.push({ t: g.sim.state.tick, type: e.type });
      return ev;
    };
    g.pause(true);
    g.sim.state.prepTicksLeft = 1e9; // 웨이브 정지 — 채집만 재려고
    g.setGold(9_999_999);
    // 마을을 올려 정원을 최대로 (= 채집이 가장 빠른 판 = 사건이 가장 잦은 판)
    for (let i = 0; i < 10; i++) if (!g.upgradeBase()) break;
    let trained = 0;
    for (let i = 0; i < 12; i++) {
      g.setGold(9_999_999);
      if (!g.trainAlly('gatherer')) break;
      trained++;
    }
    const regSet = new Set(reg);
    const startTri = g.renderInfo();
    let maxTri = startTri.triangles;
    let maxCalls = startTri.calls;
    // 밭이 완전히 마를 때까지 (= 재생권 소진 + 전부 텄음) 또는 3000초
    let exhausted = -1;
    for (let s = 0; s < 900; s++) {
      for (let i = 0; i < 100; i++) g.ff(1);
      g.stepFx(100 / 30);
      const ri = g.renderInfo();
      if (ri.triangles > maxTri) maxTri = ri.triangles;
      if (ri.calls > maxCalls) maxCalls = ri.calls;
      const st = g.sim.state;
      const anyLeft = st.resources.some((r: any) => !r.taken || r.regrowsLeft > 0 || r.regrowAt > 0);
      if (!anyLeft) {
        exhausted = st.tick;
        break;
      }
    }
    // 사건 집계
    const count = (t: string): number => log.filter((e) => e.type === t).length;
    // 같은 틱에 몰린 재생 수의 최댓값
    const perTick = new Map<number, number>();
    for (const e of log) {
      if (e.type !== 'gatherRegrown') continue;
      perTick.set(e.t, (perTick.get(e.t) ?? 0) + 1);
    }
    let maxBatch = 0;
    for (const v of perTick.values()) if (v > maxBatch) maxBatch = v;
    // 배달 간격 (소리가 배경음이 되는가)
    const dTicks = log.filter((e) => e.type === 'gatherDelivered').map((e) => e.t);
    const gaps: number[] = [];
    for (let i = 1; i < dTicks.length; i++) gaps.push(dTicks[i]! - dTicks[i - 1]!);
    gaps.sort((a, b) => a - b);
    const rTicks = log.filter((e) => e.type === 'gatherRegrown').map((e) => e.t);
    const rgaps: number[] = [];
    for (let i = 1; i < rTicks.length; i++) rgaps.push(rTicks[i]! - rTicks[i - 1]!);
    rgaps.sort((a, b) => a - b);
    let denom = 0;
    for (const r of g.sim.state.resources) if (regSet.has(r.kind)) denom += r.value;
    return {
      allies: trained,
      allyCap: g.sim.allyCap(),
      cells: g.sim.state.resources.length,
      regrowableCells: g.sim.state.resources.filter((r: any) => regSet.has(r.kind)).length,
      denom,
      sec: g.sim.state.tick / 30,
      exhaustedSec: exhausted > 0 ? exhausted / 30 : -1,
      gathered: count('gathered'),
      delivered: count('gatherDelivered'),
      regrown: count('gatherRegrown'),
      lost: count('gatherLost'),
      maxRegrowInOneTick: maxBatch,
      deliveryGapMedianSec: gaps.length ? gaps[Math.floor(gaps.length / 2)]! / 30 : -1,
      deliveryGapMinSec: gaps.length ? gaps[0]! / 30 : -1,
      regrowGapMedianSec: rgaps.length ? rgaps[Math.floor(rgaps.length / 2)]! / 30 : -1,
      regrowGapMinSec: rgaps.length ? rgaps[0]! / 30 : -1,
      startTri,
      maxTri,
      maxCalls,
      endTri: g.renderInfo(),
    };
  }, REG);
  console.log('[zz] COUNTS ' + JSON.stringify(out, null, 1));
  expect(out.cells).toBeGreaterThan(0);
});
