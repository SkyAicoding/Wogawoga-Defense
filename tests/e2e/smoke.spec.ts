/**
 * E2E 스모크 — 실제 빌드에서 타이틀→로비→전투 플로우, 테스트 훅(?test=1)으로
 * 배치/웨이브 빨리감기, 콘솔 에러 0 + 드로우콜 예산(≤60) 어서션.
 */
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __wgd?: {
      sim: {
        state: {
          phase: string;
          waveIndex: number;
          gold: number;
          baseHp: number;
          hand: { towerId: string; cost: number }[];
          enemies: readonly unknown[];
          towers: readonly unknown[];
        };
        canPlaceAt(x: number, z: number): boolean;
        hasScenery(x: number, z: number): boolean;
        towerAt(x: number, z: number): unknown | null;
        applyCommand(cmd: unknown): boolean;
      };
      ff(n: number): void;
      place(handIndex: number, x: number, z: number): boolean;
      callWave(): boolean;
      drawCalls(): number;
      renderInfo(): { calls: number; triangles: number };
      selectCard(i: number | null): void;
      pause(v: boolean): void;
      selectedScenery(): { x: number; z: number } | null;
      sceneryList(): { x: number; z: number }[];
      clearSceneryCost(x: number, z: number): number | null;
      clearScenery(x: number, z: number): boolean;
      setGold(g: number): void;
      cellToScreen(x: number, z: number): { x: number; y: number };
    };
  }
}

test('타이틀 → 로비 → 전투 → 웨이브 진행 (콘솔 에러 0, 드로우콜 예산)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await expect(page.getByText('탭하여 시작')).toBeVisible();

  // 타이틀 탭 → 로비
  await page.mouse.click(100, 300);
  await expect(page.getByRole('button', { name: /전투/ }).first()).toBeVisible();

  // 전투 시작
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => window.__wgd !== undefined);

  // 슬롯에 타워 배치
  const placed = await page.evaluate(() => {
    const w = window.__wgd;
    if (!w) return false;
    for (let z = 0; z < 40; z++) {
      for (let x = 0; x < 40; x++) {
        if (w.sim.canPlaceAt(x, z)) return w.place(0, x, z);
      }
    }
    return false;
  });
  expect(placed).toBe(true);

  // 웨이브 시작 + 20초 빨리감기 → 전투가 실제로 굴러간다
  const after = await page.evaluate(() => {
    const w = window.__wgd;
    if (!w) return null;
    w.callWave();
    w.ff(600);
    return {
      wave: w.sim.state.waveIndex,
      towers: w.sim.state.towers.length,
      gold: w.sim.state.gold,
      phase: w.sim.state.phase,
    };
  });
  expect(after).not.toBeNull();
  expect(after?.towers).toBe(1);
  expect(['prep', 'wave']).toContain(after?.phase ?? '');

  // 렌더 한 프레임 이상 돈 뒤 드로우콜 예산 확인
  await page.waitForTimeout(500);
  const drawCalls = await page.evaluate(() => window.__wgd?.drawCalls() ?? -1);
  expect(drawCalls).toBeGreaterThan(0);
  expect(drawCalls).toBeLessThanOrEqual(60);

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

test('저장 후 새로고침해도 진행 유지', async ({ page }) => {
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.mouse.click(100, 300); // 로비
  // 설정 진입 → 음악 볼륨 변경 → 저장 유발
  await page.getByRole('button', { name: '설정' }).first().click();
  const slider = page.locator('input[type="range"]').first();
  await slider.fill('30'); // 0~100 스케일 → 0.3
  await page.reload({ waitUntil: 'networkidle' });
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('wogawoga.save');
    if (!raw) return null;
    const env = JSON.parse(raw) as { data: { profile: { settings: { music: number } } } };
    return env.data.profile.settings.music;
  });
  expect(saved).toBeCloseTo(0.3, 1);
});

test('방해 지형지물: 탭 → 골드로 제거 → 그 자리에 타워 건설 (드로우콜 증가 없음)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => window.__wgd !== undefined);
  await page.waitForTimeout(900);

  const size = page.viewportSize() ?? { width: 800, height: 600 };
  // 화면 안쪽(HUD에 가리지 않는) 소품 셀을 하나 고른다
  const target = await page.evaluate(
    ([w, h]) => {
      const g = window.__wgd;
      if (!g) return null;
      let best: { cell: { x: number; z: number }; px: number; py: number; d: number } | null = null;
      for (const c of g.sceneryList()) {
        const p = g.cellToScreen(c.x, c.z);
        if (p.y < h * 0.25 || p.y > h * 0.6 || p.x < w * 0.15 || p.x > w * 0.85) continue;
        const d = Math.hypot(p.x - w / 2, p.y - h * 0.42);
        if (!best || d < best.d) best = { cell: c, px: p.x, py: p.y, d };
      }
      return best;
    },
    [size.width, size.height],
  );
  expect(target, '화면 안쪽 소품 셀을 찾지 못함').not.toBeNull();
  if (!target) return;

  const callsBefore = await page.evaluate(() => window.__wgd?.drawCalls() ?? -1);

  // 소품 셀 탭 → 제거 패널
  await page.mouse.click(target.px, target.py);
  await page.waitForTimeout(400);
  const sel = await page.evaluate(() => window.__wgd?.selectedScenery() ?? null);
  expect(sel).toEqual(target.cell);
  const clearBtn = page.locator('.tp-btn--clear');
  await expect(clearBtn).toBeVisible();
  // 패널 등장 애니메이션(card-pop)이 끝난 뒤에 재야 실제 터치 타깃이 나온다
  await page.waitForFunction(() => {
    const b = document.querySelector('.tp-btn--clear');
    if (!b) return false;
    const tr = getComputedStyle(b.closest('.tower-panel') as Element).transform;
    return tr === 'none' || tr === 'matrix(1, 0, 0, 1, 0, 0)';
  });
  // 모바일 터치 타깃 44px 이상
  const box = await clearBtn.boundingBox();
  expect(box?.height ?? 0, `치우기 버튼 높이 ${box?.height}`).toBeGreaterThanOrEqual(44);

  // 패널 배경은 포인터를 삼키면 안 된다 — 가려진 셀 탭이 죽는 걸 막는 가드.
  // (버튼만 hud-item, 패널 컨테이너는 캔버스로 흘려보낸다)
  const panelPass = await page.evaluate(() => {
    const p = document.querySelector('.tp-btn--clear')?.closest('.tower-panel');
    return p ? getComputedStyle(p).pointerEvents : null;
  });
  expect(panelPass, '제거 패널 배경이 포인터를 삼킨다').toBe('none');

  // 골드 부족이면 비활성 + 눌러도 제거되지 않는다. 비활성 버튼은 포인터도 넘겨야 한다
  await page.evaluate(() => window.__wgd?.setGold(1));
  await page.waitForTimeout(300);
  await expect(clearBtn).toHaveClass(/is-disabled/);
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('.tp-btn--clear') as Element).pointerEvents),
    '비활성 제거 버튼이 탭을 삼킨다',
  ).toBe('none');
  // 비활성 버튼은 포인터를 흘려보내므로 클릭이 캔버스로 떨어져 선택이 바뀔 수 있다.
  // 어느 쪽이든 골드/소품은 그대로여야 한다
  await clearBtn.click({ force: true });
  await page.waitForTimeout(200);
  expect(
    await page.evaluate((c) => window.__wgd?.sim.hasScenery(c.x, c.z), target.cell),
    '골드 부족인데 제거됨',
  ).toBe(true);
  expect(await page.evaluate(() => window.__wgd?.sim.state.gold), '골드 부족인데 차감됨').toBe(1);

  // 골드 충전 후 제거 → **두 번 눌러야** 나간다.
  // 첫 탭은 확인 무장만 하고 골드를 건드리지 않는다 (패널이 방금 탭한 지점을
  // 덮기 때문에 "같은 셀 재탭 = 닫기" 제스처가 결제로 이어지던 경로를 막는 가드)
  await page.evaluate(() => window.__wgd?.setGold(1000));
  // 위 클릭이 캔버스로 떨어져 선택이 풀렸으면 다시 고른다
  const stillSelected = await page.evaluate(
    (c) => {
      const s = window.__wgd?.selectedScenery() ?? null;
      return s !== null && s.x === c.x && s.z === c.z;
    },
    target.cell,
  );
  if (!stillSelected) {
    await page.evaluate((c) => window.__wgd?.selectCard(null), target.cell);
    await page.mouse.click(target.px, target.py);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__wgd?.selectedScenery() ?? null)).toEqual(target.cell);
  }
  await page.waitForTimeout(300);
  await expect(clearBtn).not.toHaveClass(/is-disabled/);
  const cost = await page.evaluate(
    (c) => window.__wgd?.clearSceneryCost(c.x, c.z) ?? null,
    target.cell,
  );
  await clearBtn.click();
  await expect(clearBtn, '첫 탭에서 확인 상태로 바뀌지 않음').toHaveClass(/is-armed/);
  const armed = await page.evaluate(
    (c) => ({
      gold: window.__wgd?.sim.state.gold ?? -1,
      scenery: window.__wgd?.sim.hasScenery(c.x, c.z),
    }),
    target.cell,
  );
  expect(armed.gold, '확인 전 첫 탭에서 골드가 빠졌다').toBe(1000);
  expect(armed.scenery, '확인 전 첫 탭에서 제거됐다').toBe(true);
  await clearBtn.click();
  await page.waitForTimeout(600);
  const afterClear = await page.evaluate(
    (c) => ({
      gold: window.__wgd?.sim.state.gold ?? -1,
      scenery: window.__wgd?.sim.hasScenery(c.x, c.z),
      canPlace: window.__wgd?.sim.canPlaceAt(c.x, c.z),
      sel: window.__wgd?.selectedScenery() ?? null,
    }),
    target.cell,
  );
  expect(afterClear.gold).toBe(1000 - (cost ?? 0));
  expect(afterClear.scenery).toBe(false);
  expect(afterClear.canPlace).toBe(true);
  expect(afterClear.sel, '제거 후 선택이 남아있음').toBeNull();

  // 같은 셀 재제거는 골드가 두 번 빠지지 않는다
  const again = await page.evaluate(
    (c) => ({
      ok: window.__wgd?.clearScenery(c.x, c.z),
      gold: window.__wgd?.sim.state.gold,
    }),
    target.cell,
  );
  expect(again.ok).toBe(false);
  expect(again.gold).toBe(afterClear.gold);

  // 소품은 셀별 지오메트리를 하나로 병합한 메시 1개다 — 제거해도 드로우콜이 늘면 안 된다.
  // 적/파티클이 계측을 흔들지 않도록 루프를 멈추고 정적 장면에서 잰다.
  const staticCalls = async (): Promise<number> =>
    page.evaluate(
      () =>
        new Promise<number>((res) => {
          const g = window.__wgd;
          if (!g) return res(-1);
          const seen: number[] = [];
          let i = 0;
          const step = (): void => {
            seen.push(g.renderInfo().calls);
            if (++i >= 20) res(Math.max(...seen));
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(() => requestAnimationFrame(step));
        }),
    );
  await page.evaluate(() => window.__wgd?.pause(true));
  await page.waitForTimeout(2500);
  const callsSomeProps = await staticCalls();
  // 남은 소품 전부 제거 (최악의 재병합 횟수)
  await page.evaluate(() => {
    const g = window.__wgd;
    if (!g) return;
    g.setGold(9_999_999);
    for (const c of g.sceneryList()) g.clearScenery(c.x, c.z);
  });
  await page.waitForTimeout(2500);
  const callsNoProps = await staticCalls();
  expect(
    callsNoProps,
    `소품 있음 ${callsSomeProps} → 전부 제거 ${callsNoProps} (늘어나면 병합이 깨진 것)`,
  ).toBeLessThanOrEqual(callsSomeProps);
  expect(callsBefore).toBeGreaterThan(0);
  await page.evaluate(() => window.__wgd?.pause(false));

  // 치운 자리에 실제로 타워를 짓는다
  await page.evaluate(() => window.__wgd?.selectCard(0));
  await page.waitForTimeout(250);
  await page.mouse.click(target.px, target.py);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate((c) => window.__wgd?.sim.towerAt(c.x, c.z) !== null, target.cell),
    '치운 자리에 타워가 지어지지 않음',
  ).toBe(true);

  // 전체 예산 (60 드로우콜)
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__wgd?.drawCalls() ?? -1)).toBeLessThanOrEqual(60);

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});
