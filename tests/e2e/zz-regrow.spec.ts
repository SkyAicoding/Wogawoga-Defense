/** zz — 임시 계측: 재생 게이트의 실제 시각표. 끝나면 지운다. */
import { expect, test } from '@playwright/test';

const OUT = '/tmp/claude-0/-home-user/f4d1ce61-6230-58b9-8a9c-fa813cf20c21/scratchpad/shots';

declare global {
  interface Window {
    __wgd?: any;
    __zz?: any[];
  }
}

async function enterBattle(page: any): Promise<void> {
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => window.__wgd !== undefined);
  await page.waitForTimeout(900);
}

test('zz 계측: 재고 궤적', async ({ page }) => {
  test.setTimeout(180_000);
  await enterBattle(page);

  const info = await page.evaluate(() => {
    const g = window.__wgd!;
    const REG = new Set(['berry', 'honey', 'mushroom', 'fruit', 'wood']);
    const rs = g.sim.state.resources as any[];
    let denom = 0;
    let all = 0;
    for (const r of rs) {
      all += r.value;
      if (REG.has(r.kind)) denom += r.value;
    }
    return { n: rs.length, denom, all, kinds: [...new Set(rs.map((r) => r.kind))] };
  });
  console.log('[zz] field', JSON.stringify(info));

  for (const nGather of [1, 2, 3]) {
    const traj = await page.evaluate(async (n: number) => {
      const g = window.__wgd!;
      const REG = new Set(['berry', 'honey', 'mushroom', 'fruit', 'wood']);
      // 새 판처럼 쓰기 위해 매번 goto 하지 않고, 첫 회차만 쓴다면 의미가 없으니
      // 여기서는 한 판에서 한 값만 잰다 (호출자가 회차마다 새로 goto 한다).
      g.sim.state.prepTicksLeft = 1e9;
      g.setGold(50_000);
      for (let i = 0; i < n; i++) g.trainAlly('gatherer');
      // 이벤트 도청 (fx 로는 그대로 흘려보낸다)
      const sim: any = g.sim;
      if (!window.__zz) {
        window.__zz = [];
        const orig = sim.drainEvents.bind(sim);
        sim.drainEvents = () => {
          const ev = orig();
          for (const e of ev) window.__zz!.push({ t: g.sim.state.tick, ...e });
          return ev;
        };
      }
      const rows: any[] = [];
      let denom = 0;
      for (const r of g.sim.state.resources) if (REG.has(r.kind)) denom += r.value;
      for (let step = 0; step < 80; step++) {
        g.ff(150); // 5초
        const st = g.sim.state;
        let standing = 0;
        let waiting = 0;
        let eligible = 0;
        for (const r of st.resources) {
          if (!r.taken && REG.has(r.kind)) standing += r.value;
          if (r.regrowAt > 0) {
            waiting++;
            if (st.tick >= r.regrowAt) eligible++;
          }
        }
        const regrown = window.__zz!.filter((e) => e.type === 'gatherRegrown').length;
        const delivered = window.__zz!.filter((e) => e.type === 'gatherDelivered').length;
        const gathered = window.__zz!.filter((e) => e.type === 'gathered').length;
        rows.push({
          sec: +(st.tick / 30).toFixed(1),
          frac: +(standing / denom).toFixed(3),
          waiting,
          eligible,
          regrown,
          delivered,
          gathered,
        });
      }
      return { denom, rows };
    }, nGather);
    console.log(`[zz] gatherers=${nGather} denom=${traj.denom}`);
    for (const r of traj.rows) {
      console.log(
        `[zz] n=${nGather} t=${r.sec}s frac=${r.frac} wait=${r.waiting} elig=${r.eligible} regrown=${r.regrown} deliv=${r.delivered} gath=${r.gathered}`,
      );
    }
    if (nGather !== 3) await enterBattle(page);
  }
  expect(true).toBe(true);
});
