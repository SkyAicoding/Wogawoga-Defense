/**
 * zz 임시 계측 — 예산(드로우콜 90 / 삼각형 150,000)이 **몇 기에서 깨지는가**를
 * 최악 프레임 레시피 위에서 이분법으로 찾는다. 재고 나면 지운다.
 * 어서션 없음에 가깝다: 값을 고치지 않고 재기만 한다.
 */
import { expect, test, type Page } from '@playwright/test';

type Frame = { calls: number; tris: number; proj: number };

function maxFrame(page: Page, frames = 30): Promise<Frame> {
  return page.evaluate(
    (n) =>
      new Promise<Frame>((res) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const g = (window as any).__wgd;
        let calls = 0;
        let tris = 0;
        let i = 0;
        const step = (): void => {
          const r = g.renderInfo();
          calls = Math.max(calls, r.calls);
          tris = Math.max(tris, r.triangles);
          if (++i >= n) res({ calls, tris, proj: g.sim.state.projectiles.length });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(() => requestAnimationFrame(step));
      }),
    frames,
  );
}

async function turnOnUnlockAll(page: Page): Promise<void> {
  await page.locator('.topbar .icon-btn').last().click();
  const sw = page.locator('.set-row', { hasText: '모든 스테이지 열기' }).getByRole('switch');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.locator('.topbar .icon-btn').first().click();
  await page.waitForTimeout(300);
}

async function enterStage(page: Page, stageId: number): Promise<number | null> {
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.waitForTimeout(400);
  await page.evaluate((idx) => {
    const car = document.querySelector('.carousel') as HTMLElement;
    const card = car.querySelectorAll<HTMLElement>('.stage-card')[idx]!;
    car.scrollLeft = card.offsetLeft - car.offsetLeft;
  }, stageId - 1);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => (window as never as { __wgd?: unknown }).__wgd !== undefined);
  await page.waitForTimeout(900);
  return page.evaluate(
    () => (window as never as { __wgd: any }).__wgd.sim.ctx?.opts?.stage?.id ?? null,
  );
}

/**
 * smoke.spec.ts 의 buildWorstFrame 과 **같은 레시피**, 타워 기수만 매개변수다.
 * 종은 8종 순환(인스턴싱에 가장 불리) · 전부 T5 · 적 60 · 아군 정원 · 마을 만렙 · 전원 반피.
 */
async function buildWorst(
  page: Page,
  towerTarget: number,
): Promise<{ towers: number; enemies: number; allies: number; free: number }> {
  const built = await page.evaluate((target) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const g = (window as any).__wgd;
    const sim = g.sim;
    const st = sim.state;
    const stage = sim.ctx.opts.stage;
    let free = 0;
    for (let z = 0; z < stage.gridH; z++)
      for (let x = 0; x < stage.gridW; x++) if (sim.canPlaceAt(x, z)) free++;
    const IDS = ['spear', 'catapult', 'lightning', 'brazier', 'frost', 'poison', 'ballista', 'drum'];
    let n = 0;
    for (let z = 0; z < stage.gridH && n < target; z++) {
      for (let x = 0; x < stage.gridW && n < target; x++) {
        if (!sim.canPlaceAt(x, z)) continue;
        st.gold = 99_999_999;
        const card = { towerId: IDS[n % IDS.length], cost: 0 };
        if (st.hand.length === 0) st.hand.push(card);
        else st.hand[0] = card;
        if (g.place(0, x, z)) n++;
      }
    }
    for (let r = 0; r < 6; r++) {
      st.gold = 99_999_999;
      for (const t of st.towers) sim.applyCommand({ type: 'upgradeTower', towerId: t.id });
    }
    for (let i = 0; i < 8; i++) {
      st.gold = 99_999_999;
      g.upgradeBase();
    }
    st.baseHp = 1e9;
    st.baseHpMax = 1e9;
    st.waveIndex = 48;
    g.callWave();
    for (let k = 0; k < 3000 && st.enemies.length < 60; k++) {
      g.ff(1);
      for (const e of st.enemies) {
        e.maxHp = 1e7;
        e.hp = 1e7;
        if (e.dist > 4) e.dist = 4;
      }
      for (const t of st.towers) t.hp = t.maxHp;
      st.baseHp = 1e9;
    }
    const EIDS = ['raptor','compy','trike','ptera','ankylo','boar','warrior','shaman','blade','lancer','archer','hexer','mammoth','spino','trex','golem'];
    st.enemies.forEach((e: any, i: number) => {
      e.defId = EIDS[i % EIDS.length];
    });
    for (let i = 0; i < 6; i++) {
      st.gold = 99_999_999;
      g.trainAlly((['clubber', 'slinger', 'guardian'] as const)[i % 3]);
    }
    return { towers: st.towers.length, enemies: st.enemies.length, allies: st.allies.length, free };
  }, towerTarget);

  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const g = (window as any).__wgd;
    const st = g.sim.state;
    g.pause(true);
    for (const e of st.enemies) e.hp = Math.max(1, Math.round(e.maxHp * 0.5));
    for (const t of st.towers) t.hp = Math.max(1, Math.round(t.maxHp * 0.5));
    for (const a of st.allies) a.hp = Math.max(1, Math.round(a.maxHp * 0.5));
    g.ff(1);
  });
  await page.waitForTimeout(500);
  return built;
}

const OVER = (f: Frame): boolean => f.calls > 90 || f.tris > 150_000;

for (const stageId of [1, 3]) {
  test(`zz 예산 파괴점 s${stageId} — 이분법`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop 1280x800 에서만');
    test.setTimeout(900_000);
    await page.goto('/?test=1', { waitUntil: 'networkidle' });
    await page.mouse.click(100, 300);
    await page.waitForTimeout(400);
    await turnOnUnlockAll(page);

    const log: string[] = [];
    const probe = async (n: number): Promise<Frame> => {
      const entered = await enterStage(page, stageId);
      expect(entered).toBe(stageId);
      const b = await buildWorst(page, n);
      const f = await maxFrame(page, 30);
      log.push(
        `${b.towers}기(요청${n}) ${f.calls}콜 ${f.tris}삼각형 적${b.enemies} 아군${b.allies} 투사체${f.proj} 빈칸${b.free}`,
      );
      // eslint-disable-next-line no-console
      console.log(`ZZPROBE s${stageId} ${log[log.length - 1]}`);
      return f;
    };

    // 하한 = 12 (기존 레시피), 상한 = 판의 빈칸 전부
    const lo0 = await probe(12);
    const hiN = 200; // canPlaceAt 이 알아서 잘라 준다 (판의 빈칸 = 상한)
    const hi0 = await probe(hiN);

    let answer = '';
    if (!OVER(hi0)) {
      answer = `판을 전부(${hiN} 요청) 채워도 예산 안 — 깨지지 않는다`;
    } else if (OVER(lo0)) {
      answer = `12기에서 이미 예산 초과`;
    } else {
      let lo = 12; // 안전 확인됨
      let hi = hiN; // 초과 확인됨
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const f = await probe(mid);
        if (OVER(f)) hi = mid;
        else lo = mid;
      }
      answer = `안전 최대 ${lo}기 · 최초 초과 ${hi}기`;
    }
    // eslint-disable-next-line no-console
    console.log(`ZZANSWER s${stageId} ${answer}\n  ${log.join('\n  ')}`);
    expect(log.length).toBeGreaterThan(1);
  });
}
