/**
 * zz 임시 계측 — 타워 수 스윕 곡선. 재고 나면 지운다.
 *
 * ⚠ 이 파일이 존재하는 이유의 절반은 **품질 자동 강등**이다. renderer.ts 는 프레임이
 *   계속 느리면(해상도 스케일 바닥 0.7 + 4초) app.ts 의 qm.degrade() 를 부르고,
 *   low 티어는 `shadows:false` 라 **그림자 패스가 통째로 사라진다**(콜 −3, 삼각형 −만).
 *   한 세션에서 타워를 계속 늘리며 재면 swiftshader 가 20기 언저리에서 강등되어
 *   "타워를 늘렸는데 드로우콜이 줄어드는" 거짓 곡선이 나온다(실제로 겪었다).
 *   → 측정점마다 **페이지를 새로 열어** 느린 프레임 누적을 리셋하고,
 *     `gl.viewport` 를 후킹해 **그 표본에서 그림자 패스가 정말 돌았는지**를 함께 남긴다.
 */
import { expect, test, type Page } from '@playwright/test';

/** 프레임마다 어떤 뷰포트 크기로 그렸는지 — 정사각 2048/1024/512 가 보이면 그림자 패스가 돈 것 */
const VP_HOOK = `
(() => {
  const S = { sizes: {} };
  window.__zzvp = S;
  for (const p of [
    typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null,
    typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null,
  ]) {
    if (!p || !p.viewport) continue;
    const ov = p.viewport;
    p.viewport = function (x, y, w, h) {
      const k = w + 'x' + h;
      S.sizes[k] = (S.sizes[k] || 0) + 1;
      return ov.call(this, x, y, w, h);
    };
  }
})();
`;

type Sample = { calls: number; tris: number; shadow: string };

/** rAF 2회 건너뛰고 n프레임 최댓값 — smoke.spec.ts 의 maxFrame 과 같은 잣대 */
function sample(page: Page, frames = 20): Promise<Sample> {
  return page.evaluate(
    (n) =>
      new Promise<Sample>((res) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const g = (window as any).__wgd;
        const vp = (window as any).__zzvp;
        let calls = 0;
        let tris = 0;
        let i = 0;
        const step = (): void => {
          const r = g.renderInfo();
          calls = Math.max(calls, r.calls);
          tris = Math.max(tris, r.triangles);
          if (++i >= n) {
            const sq = Object.keys(vp.sizes).filter((k) => {
              const [a, b] = k.split('x');
              return a === b && Number(a) >= 512;
            });
            res({ calls, tris, shadow: sq.join(',') || 'none' });
          } else requestAnimationFrame(step);
        };
        requestAnimationFrame(() => {
          vp.sizes = {}; // 표본 구간만 센다
          requestAnimationFrame(step);
        });
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
    /* eslint-disable @typescript-eslint/no-explicit-any */
    () => (window as any).__wgd.sim.ctx?.opts?.stage?.id ?? null,
  );
}

/**
 * 타워를 target 기까지 **실제로 지을 수 있는 칸에만**(canPlaceAt 이 유일한 출처) 채운다.
 * 8종을 순환한다 — (종,티어) 조합이 갈릴수록 인스턴싱에 불리하므로 이쪽이 최악이다.
 * maxTier면 전부 T5로 올린다. 준비 단계 잔여 틱을 크게 박아 웨이브가 스스로 시작하지 않게 한다.
 */
function fill(
  page: Page,
  target: number,
  maxTier: boolean,
): Promise<{ towers: number; free: number }> {
  return page.evaluate(
    ({ target, maxTier }) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = (window as any).__wgd;
      const sim = g.sim;
      const st = sim.state;
      const stage = sim.ctx.opts.stage;
      let free = 0;
      for (let z = 0; z < stage.gridH; z++)
        for (let x = 0; x < stage.gridW; x++) if (sim.canPlaceAt(x, z)) free++;
      const IDS = [
        'spear',
        'catapult',
        'lightning',
        'brazier',
        'frost',
        'poison',
        'ballista',
        'drum',
      ];
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
      if (maxTier) {
        for (let r = 0; r < 6; r++) {
          st.gold = 99_999_999;
          for (const t of st.towers) sim.applyCommand({ type: 'upgradeTower', towerId: t.id });
        }
      }
      st.prepTicksLeft = 1e9;
      g.ff(1);
      st.prepTicksLeft = 1e9;
      return { towers: st.towers.length, free };
    },
    { target, maxTier },
  );
}

const POINTS = [0, 4, 8, 12, 16, 20, 24, 32];

for (const stageId of [1, 3]) {
  test(`zz 스윕 s${stageId} — 타워 0~32기 (적0·아군0·마을Lv1)`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop 1280x800 에서만');
    test.setTimeout(900_000);
    await page.addInitScript(VP_HOOK);
    await page.goto('/?test=1', { waitUntil: 'networkidle' });
    await page.mouse.click(100, 300);
    await page.waitForTimeout(400);
    await turnOnUnlockAll(page);

    for (const maxTier of [false, true]) {
      const rows: string[] = [];
      let free = 0;
      for (const n of POINTS) {
        // 측정점마다 새 세션 — 느린 프레임 누적(=품질 강등)을 리셋한다
        const entered = await enterStage(page, stageId);
        expect(entered, `s${stageId} 진입`).toBe(stageId);
        const built = await fill(page, n, maxTier);
        free = built.free;
        await page.waitForTimeout(800); // 배치 팝(0.28초)이 끝나도록 실시간을 흘린다
        const s = await sample(page, 20);
        rows.push(`${built.towers}기 ${s.calls}콜 ${s.tris}삼각형 [그림자 ${s.shadow}]`);
        // eslint-disable-next-line no-console
        console.log(`ZZPT s${stageId} ${maxTier ? 'T5' : 'T1'} ${rows[rows.length - 1]}`);
      }
      // eslint-disable-next-line no-console
      console.log(`ZZROW s${stageId} ${maxTier ? 'T5' : 'T1'} 빈칸 ${free} | ${rows.join(' | ')}`);
      expect(free).toBeGreaterThan(32);
    }
  });
}
