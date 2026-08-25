/** zz — 임시: 재생 규칙 화면 확인용 캡처. 끝나면 지운다. */
import { expect, test } from '@playwright/test';

const OUT = '/tmp/claude-0/-home-user/f4d1ce61-6230-58b9-8a9c-fa813cf20c21/scratchpad/shots';
const REG = ['berry', 'honey', 'mushroom', 'fruit', 'wood'];

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
  await page.evaluate((reg: string[]) => {
    const g = window.__wgd!;
    const sim: any = g.sim;
    window.__zz = [];
    const orig = sim.drainEvents.bind(sim);
    sim.drainEvents = () => {
      const ev = orig();
      for (const e of ev) window.__zz!.push({ t: g.sim.state.tick, ...e });
      return ev;
    };
    const reg2 = new Set(reg);
    (window as any).__stock = () => {
      let s = 0;
      let d = 0;
      for (const r of g.sim.state.resources) {
        if (reg2.has(r.kind)) {
          d += r.value;
          if (!r.taken) s += r.value;
        }
      }
      return { standing: s, denom: d, frac: s / d, need: d * 0.5 };
    };
    (window as any).__snap = () =>
      g.sim.state.resources
        .filter((r: any) => !r.taken)
        .map((r: any) => `${r.cellX},${r.cellZ}`)
        .sort()
        .join('|');
    (window as any).__nRegrown = () => window.__zz!.filter((e) => e.type === 'gatherRegrown').length;
    g.pause(true); // 시각의 유일한 출처를 ff()/stepFx() 로 (결정론적 계측)
  }, REG);
}

test.describe.configure({ mode: 'serial' });

for (const zoomIn of [false, true]) {
  const tag = zoomIn ? 'near' : 'wide';

  test(`zz 캡처(${tag}): 문턱 위/아래 대조`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    let clip: any = null;
    const shot = async (name: string): Promise<void> => {
      await page.waitForTimeout(140);
      await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
      if (clip) await page.screenshot({ path: `${OUT}/${tag}-${name}-crop.png`, clip });
    };

    await enterBattle(page);

    const field = await page.evaluate(() => {
      const g = window.__wgd!;
      return {
        n: g.sim.state.resources.length,
        ...(window as any).__stock(),
        wave: g.sim.state.waveIndex,
      };
    });
    console.log(`[zz:${tag}] FIELD ` + JSON.stringify(field));

    // ── 1) 웨이브 얼리고 채집꾼 2명 — **실제로 캔다** ───────────────────────
    await page.evaluate(() => {
      const g = window.__wgd!;
      g.sim.state.prepTicksLeft = 1e9;
      g.setGold(50_000);
      g.trainAlly('gatherer');
      g.trainAlly('gatherer');
    });

    const reach = await page.evaluate(() => {
      const g = window.__wgd!;
      const S = (window as any).__stock;
      for (let i = 0; i < 4000; i++) {
        g.ff(15);
        g.stepFx(0.5);
        const f = S().frac;
        if (f <= 0.58) return { sec: g.sim.state.tick / 30, frac: f, ok: f > 0.5 };
      }
      return { sec: g.sim.state.tick / 30, frac: S().frac, ok: false };
    });
    console.log(`[zz:${tag}] REACHED ` + JSON.stringify(reach));
    expect(reach.ok).toBe(true);

    // ── 2) "여기 지켜" — 빈 칸을 찍으면 자동 채집이 꺼진다 (게임 안의 명령) ─
    const held = await page.evaluate(() => {
      const g = window.__wgd!;
      const base = g.baseInfo().cell;
      let hold: { x: number; z: number } | null = null;
      for (let z = 0; z < 24 && !hold; z++) {
        for (let x = 0; x < 24; x++) {
          if (x === base.x && z === base.z) continue;
          if (g.sim.canPlaceAt(x, z) && !g.sim.hasScenery(x, z)) {
            hold = { x, z };
            break;
          }
        }
      }
      for (const a of g.sim.state.allies) {
        g.sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: hold!.x, cellZ: hold!.z });
      }
      g.ff(90);
      g.stepFx(3);
      return { hold, autoHold: g.sim.state.allies.map((a: any) => a.autoHold) };
    });
    console.log(`[zz:${tag}] HOLD ` + JSON.stringify(held));
    expect(held.autoHold.every((h: boolean) => h === true)).toBe(true);

    // ── 3) 자격이 다 익을 때까지 (재고는 그대로 문턱 위) ────────────────────
    const ripe = await page.evaluate(() => {
      const g = window.__wgd!;
      let maxAt = 0;
      for (const r of g.sim.state.resources) if (r.regrowAt > maxAt) maxAt = r.regrowAt;
      const need = maxAt - g.sim.state.tick + 60;
      if (need > 0) {
        g.ff(need);
        g.stepFx(2);
      }
      const st = g.sim.state;
      let elig = 0;
      let wait = 0;
      for (const r of st.resources) {
        if (r.regrowAt > 0) {
          wait++;
          if (st.tick >= r.regrowAt) elig++;
        }
      }
      return { sec: st.tick / 30, ...(window as any).__stock(), elig, wait, regrown: (window as any).__nRegrown() };
    });
    console.log(`[zz:${tag}] RIPE ` + JSON.stringify(ripe));
    expect(ripe.frac).toBeGreaterThan(0.5);
    expect(ripe.elig).toBeGreaterThan(0);
    expect(ripe.regrown).toBe(0);

    const firstCell = await page.evaluate(() => {
      const st = window.__wgd!.sim.state;
      let best: any = null;
      for (const r of st.resources) {
        if (r.regrowAt === 0 || st.tick < r.regrowAt) continue;
        if (best === null || r.regrowAt < best.regrowAt) best = r;
      }
      return best ? { x: best.cellX, z: best.cellZ, kind: best.kind, at: best.regrowAt, v: best.value } : null;
    });
    console.log(`[zz:${tag}] NEXT-CELL ` + JSON.stringify(firstCell));

    if (zoomIn) {
      await page.mouse.move(640, 380);
      for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
      await page.waitForTimeout(200);
      for (let k = 0; k < 5; k++) {
        const p = await page.evaluate((c: any) => window.__wgd!.cellToScreen(c.x, c.z), firstCell);
        const dx = 640 - p.x;
        const dy = 340 - p.y;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) break;
        await page.mouse.move(640, 380);
        await page.mouse.down();
        await page.mouse.move(640 + dx * 0.9, 380 + dy * 0.9, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(120);
      }
      console.log(`[zz:${tag}] CAM ` + JSON.stringify(await page.evaluate(() => window.__wgd!.camState())));
      const pt = await page.evaluate((c: any) => window.__wgd!.cellToScreen(c.x, c.z), firstCell);
      clip = {
        x: Math.max(0, Math.round(pt.x - 130)),
        y: Math.max(0, Math.round(pt.y - 130)),
        width: 260,
        height: 260,
      };
      console.log(`[zz:${tag}] CLIP ` + JSON.stringify({ pt, clip }));
    }

    // 안내 배너(CSS 애니메이션 = 벽시계)가 스스로 사라지게 둔다. 루프가 멈춰 sim 시각은 안 간다
    await page.waitForTimeout(4500);

    await shot('C1-above-before');

    // ── 4) 같은 창(30초) — 문턱 위라 한 칸도 안 자라야 한다 ────────────────
    const W = 900;
    const above = await page.evaluate((w: number) => {
      const g = window.__wgd!;
      const before = (window as any).__nRegrown();
      const snap0 = (window as any).__snap();
      for (let i = 0; i < w; i++) {
        g.ff(1);
        g.stepFx(1 / 30);
      }
      return {
        sec: g.sim.state.tick / 30,
        ...(window as any).__stock(),
        regrownInWindow: (window as any).__nRegrown() - before,
        snapSame: snap0 === (window as any).__snap(),
      };
    }, W);
    console.log(`[zz:${tag}] ABOVE-WINDOW ` + JSON.stringify(above));
    await shot('C2-above-after-30s');
    expect(above.regrownInWindow, '문턱 위인데 자랐다').toBe(0);
    expect(above.snapSame, '문턱 위인데 서 있는 칸 집합이 변했다').toBe(true);

    // ── 5) 한 명을 풀어 **실제로 더 캐게** 한다 → 재고가 문턱 아래로 ────────
    const crossed = await page.evaluate(() => {
      const g = window.__wgd!;
      const base = g.baseInfo().cell;
      const a = g.sim.state.allies[0];
      g.sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: base.x, cellZ: base.z });
      const S = (window as any).__stock;
      const before = (window as any).__nRegrown();
      for (let i = 0; i < 9000; i++) {
        g.ff(1);
        g.stepFx(1 / 30);
        const s = S();
        if (s.standing < s.need) {
          return { sec: g.sim.state.tick / 30, waited: i + 1, ...s, regrownSoFar: (window as any).__nRegrown() - before };
        }
      }
      return { sec: g.sim.state.tick / 30, waited: -1, ...S(), regrownSoFar: -1 };
    });
    console.log(`[zz:${tag}] CROSSED ` + JSON.stringify(crossed));
    expect(crossed.waited).toBeGreaterThan(0);
    expect(crossed.regrownSoFar, '문턱을 깬 그 틱에 이미 자랐다').toBe(0);
    await shot('A-below-not-yet');

    // ── 6) 다음 틱 — 자란다 ────────────────────────────────────────────────
    const burst = await page.evaluate(() => {
      const g = window.__wgd!;
      const before = (window as any).__nRegrown();
      const p0 = g.particlesSpawned();
      g.ff(1);
      const n = (window as any).__nRegrown() - before;
      const evs = window.__zz!.filter((e) => e.type === 'gatherRegrown').slice(-n);
      const pAfterSim = g.particlesSpawned();
      g.stepFx(0.06);
      return {
        sec: g.sim.state.tick / 30,
        countThisTick: n,
        cells: evs.map((e) => ({ x: e.cellX, z: e.cellZ, kind: e.kind, v: e.value })),
        particlesFromEvents: pAfterSim - p0,
        live: g.particleCount(),
        ...(window as any).__stock(),
        render: g.renderInfo(),
      };
    });
    console.log(`[zz:${tag}] BURST ` + JSON.stringify(burst));
    await shot('B0-spark');

    await page.evaluate(() => window.__wgd!.stepFx(0.2));
    await shot('B1-regrow-mid');

    const settled = await page.evaluate(() => {
      const g = window.__wgd!;
      g.stepFx(1.4);
      return { live: g.particleCount(), render: g.renderInfo() };
    });
    console.log(`[zz:${tag}] SETTLED ` + JSON.stringify(settled));
    await shot('B2-regrow-settled');

    const below = await page.evaluate((w: number) => {
      const g = window.__wgd!;
      const before = (window as any).__nRegrown();
      for (let i = 0; i < w - 1; i++) {
        g.ff(1);
        g.stepFx(1 / 30);
      }
      return {
        sec: g.sim.state.tick / 30,
        ...(window as any).__stock(),
        regrownInWindow: (window as any).__nRegrown() - before,
        render: g.renderInfo(),
      };
    }, W);
    console.log(`[zz:${tag}] BELOW-WINDOW ` + JSON.stringify(below));
    await shot('B3-below-after-30s');

    console.log(`[zz:${tag}] ERRORS ` + JSON.stringify(errors));
    expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
  });
}
