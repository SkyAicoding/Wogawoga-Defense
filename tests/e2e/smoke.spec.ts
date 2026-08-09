/**
 * E2E 스모크 — 실제 빌드에서 타이틀→로비→전투 플로우, 테스트 훅(?test=1)으로
 * 배치/웨이브 빨리감기, 콘솔 에러 0 + 드로우콜 예산(≤60) 어서션.
 */
import { expect, test, type Page } from '@playwright/test';

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
          enemies: { blockerAllyId: number }[];
          towers: readonly unknown[];
          allies: { id: number; defId: string; targetId: number; hp: number }[];
          allyCap: number;
          baseLevel: number;
          baseLevelMax: number;
          baseHpMax: number;
          projectiles: { fromBase?: boolean; towerDefId: string }[];
        };
        allyCost(defId: string): number;
        canTrainAlly(defId: string): boolean;
        allySortieRange(): number;
        allySortiePoints(): { x: number; z: number }[];
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
      trainAlly(defId: string): boolean;
      allyCost(defId: string): number;
      canTrainAlly(defId: string): boolean;
      allies(): { id: number; defId: string; hp: number; x: number; z: number; targetId: number }[];
      baseInfo(): {
        level: number;
        levelMax: number;
        hp: number;
        hpMax: number;
        range: number;
        cost: number | null;
        can: boolean;
        cell: { x: number; z: number };
      };
      upgradeBase(): boolean;
      selectedBase(): boolean;
      damageBase(n: number): void;
    };
  }
}


/**
 * 마을(기지 셀)을 화면에서 탭한다 — 6단계부터 출동/레벨업이 전부 이 패널 안에 있다.
 * cellToScreen은 실제 카메라 투영을 쓰므로 "그 셀이 정말 탭할 수 있는 자리인가"까지 함께 잰다.
 */
async function tapBase(page: Page): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(() => {
    const c = window.__wgd!.baseInfo().cell;
    return window.__wgd!.cellToScreen(c.x, c.z);
  });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
  return p;
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
  // 선택 해제는 sceneryCleared 이벤트를 battlecontroller.processEvents()가 받아
  // refreshScenerySelection()을 부를 때 일어나고, 그건 **rAF 프레임 안에서** 돈다.
  // 고정 대기(600ms)로 재면 워커 둘이 SwiftShader를 나눠 쓰는 전체 실행에서
  // 프레임 하나를 제때 못 받아 간헐 실패한다(실측: 단독 6/6 통과, 전체 병렬에서 3/11 실패).
  // 시간이 아니라 **조건**을 기다린다.
  await page.waitForFunction(() => (window.__wgd?.selectedScenery() ?? null) === null, null, {
    timeout: 10_000,
  });
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

/**
 * 아군 부족원 출동 — 마을에서 주민을 뽑아 길목에서 적을 막아 세운다.
 *
 * **드로우콜이 이 테스트의 핵심이다.** 아군은 적 습격대와 같은 InstancedMesh,
 * 같은 오버레이 메시를 쓰므로(구조 검증은 tests/render/allies.test.ts) 두 메시가
 * 이미 켜져 있는 프레임 — 즉 실측 최악 프레임의 조건 — 에서는 **한 콜도 늘면 안 된다**.
 */
test('아군 출동: 골드 소모 · 상한 · 봉쇄 · 드로우콜 증가 0', async ({ page }) => {
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

  // --- 6단계: 상시 출동 바는 없어졌고, 마을 패널 안에만 있다 ----------------
  // 사용자 요청("마을을 선택했을때 아군을 선택하거나 마을을 업그레이드")대로
  // 마을을 고르기 전에는 출동 버튼이 화면에 **보이지 않아야** 한다.
  const btns = page.locator('.ally-btn');
  await expect(btns).toHaveCount(3); // DOM에는 있다 (패널이 display:none일 뿐)
  await expect(btns.first()).toBeHidden();

  // 마을(기지 셀) 탭 → 한 패널에서 출동과 레벨업이 둘 다 열린다
  const homePanel = page.locator('.tower-panel--home');
  await tapBase(page);
  await expect(homePanel).toBeVisible();
  await expect(homePanel.locator('.ally-btn')).toHaveCount(3);
  await expect(homePanel.locator('.tp-btn--up')).toBeVisible();
  await homePanel.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  for (let i = 0; i < 3; i++) {
    const box = await btns.nth(i).boundingBox();
    expect(box, `출동 버튼 ${i} 박스`).not.toBeNull();
    expect(box!.height, `출동 버튼 ${i} 높이`).toBeGreaterThanOrEqual(44);
  }

  // --- 연속 출동: 패널이 닫히지 않고 세 명을 잇달아 내보낼 수 있는가 --------
  // 상시 바(1탭)를 잃은 대가를 여기서 갚는다 — 열어 두면 이후는 여전히 1탭이다
  await page.evaluate(() => window.__wgd!.setGold(5000));
  for (let i = 0; i < 3; i++) {
    await btns.nth(i).click();
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.__wgd!.selectedBase()), `${i + 1}번째 출동 뒤 마을 선택`)
      .toBe(true);
    await expect(homePanel).toBeVisible();
  }
  expect(await page.evaluate(() => window.__wgd!.allies().length), '연속 3회 출동').toBe(3);
  // 인원 표시가 실제 인원을 따라간다
  await expect(page.locator('.ally-count-num')).toHaveText(/^3\//);

  // --- 전투 중에도 열리고 출동된다 -----------------------------------------
  await page.evaluate(() => {
    const g = window.__wgd!;
    g.callWave();
    g.ff(30);
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__wgd!.sim.state.phase)).toBe('wave');
  await expect(homePanel).toBeVisible();
  const beforeWaveTrain = await page.evaluate(() => window.__wgd!.allies().length);
  await btns.nth(0).click();
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => window.__wgd!.allies().length),
    '웨이브 중에도 출동이 된다',
  ).toBe(beforeWaveTrain + 1);

  // 마을을 다시 탭하면 닫힌다 (선택 규칙은 그대로)
  await tapBase(page);
  await expect(homePanel).toBeHidden();
  await page.evaluate(() => {
    const g = window.__wgd!;
    for (const a of g.sim.state.allies as unknown as { alive: boolean }[]) a.alive = false;
    g.ff(2);
  });

  // --- 골드가 실제로 빠지고, 비용이 인원수에 따라 오른다 --------------------
  const econ = await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(5000);
    const steps: { cost: number; ok: boolean; spent: number; alive: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const cost = g.allyCost('clubber');
      const before = g.sim.state.gold;
      const ok = g.trainAlly('clubber');
      steps.push({ cost, ok, spent: before - g.sim.state.gold, alive: g.allies().length });
    }
    return { steps, cap: g.sim.state.allyCap, gold: g.sim.state.gold };
  });
  const cap = econ.cap;
  for (let i = 0; i < cap; i++) {
    expect(econ.steps[i]!.ok, `${i}번째 출동`).toBe(true);
    expect(econ.steps[i]!.spent).toBe(econ.steps[i]!.cost);
  }
  // 비용은 단조 증가
  for (let i = 1; i < cap; i++) {
    expect(econ.steps[i]!.cost).toBeGreaterThan(econ.steps[i - 1]!.cost);
  }
  // 상한 초과분은 거부되고 골드도 안 빠진다 (돈이 남아 있는데도)
  expect(econ.steps[cap]!.ok).toBe(false);
  expect(econ.steps[cap]!.spent).toBe(0);
  expect(econ.gold).toBeGreaterThan(econ.steps[cap]!.cost);

  // 골드가 모자라면 막힌다
  const poor = await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(1);
    return { can: g.canTrainAlly('guardian'), ok: g.trainAlly('guardian') };
  });
  expect(poor.can).toBe(false);
  expect(poor.ok).toBe(false);

  // --- 최악 프레임 조건에서 드로우콜 증가 0 ---------------------------------
  // 습격대 공유 메시 + 오버레이 메시를 켜 둔 정지 장면에서 아군만 넣고 뺀다.
  const maxCalls = (): Promise<number> =>
    page.evaluate(
      () =>
        new Promise<number>((res) => {
          const g = window.__wgd!;
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

  await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(999999);
    g.place(0, 6, 6);
    g.callWave();
    g.ff(180);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const g = window.__wgd!;
    g.pause(true);
    const st = g.sim.state as unknown as {
      enemies: { defId: string; hp: number; maxHp: number }[];
      towers: { hp: number; maxHp: number }[];
    };
    // 습격대 메시 ON + 오버레이 메시 ON (실측 최악 프레임의 조건)
    if (st.enemies[0]) {
      st.enemies[0].defId = 'blade';
      st.enemies[0].hp = Math.max(1, Math.round(st.enemies[0].maxHp * 0.5));
    }
    if (st.towers[0]) st.towers[0].hp = Math.round(st.towers[0].maxHp * 0.6);
    // 아군은 전부 비워 둔 상태에서 먼저 잰다
    for (const a of g.sim.state.allies as unknown as { alive: boolean }[]) a.alive = false;
    g.ff(1);
  });
  await page.waitForTimeout(400);
  const callsNoAlly = await maxCalls();

  const trained = await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(999999);
    let n = 0;
    for (const id of ['clubber', 'slinger', 'guardian', 'clubber', 'slinger', 'guardian']) {
      if (g.trainAlly(id)) n++;
    }
    return n;
  });
  expect(trained).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  const callsWithAlly = await maxCalls();

  /**
   * 5단계: 아군은 **자기 InstancedMesh 하나**를 쓴다 — 그래서 Δ는 0이 아니라 정확히 1이다.
   * 3단계까지는 습격대 메시에 얹어 Δ=0이었는데, 변형 마스킹은 자기 것이 아닌 장비 정점을
   * 원점으로 접을 뿐이라 **인스턴스 하나가 장비 7벌 전부의 정점 비용을 냈다**. 습격대만
   * 56마리가 사는 편성에서 그게 프레임을 지배해(170,341 삼각형 = 예산 150,000의 114%)
   * 드로우콜 1개로 삼각형 3만을 사는 쪽으로 바꿨다(meshlib/enemies.ts RAIDER_KITS).
   * 여기서 잠그는 것은 "**종이 셋이어도 메시는 하나**"다 — 종마다 만들면 Δ가 3이 된다.
   */
  expect(
    callsWithAlly - callsNoAlly,
    `아군 0명 ${callsNoAlly} → ${trained}명 ${callsWithAlly} (종마다 메시를 만들면 3이 된다)`,
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.__wgd?.pause(false));

  // --- 실제로 적을 막아 세우는가 -------------------------------------------
  // 타워를 전부 판다: 남겨 두면 적이 출격 한계선(기지 앞 6타일)에 닿기 전에 죽어
  // 봉쇄를 관찰할 수 없다 — 여기서 보려는 건 "주민만으로 막아 세운다"이다.
  await page.evaluate(() => {
    const g = window.__wgd!;
    const st = g.sim.state as unknown as { towers: { id: number }[] };
    for (const t of [...st.towers]) g.sim.applyCommand({ type: 'sellTower', towerId: t.id });
  });

  let blocked = 0;
  for (let k = 0; k < 300; k++) {
    const r = await page.evaluate(() => {
      const g = window.__wgd!;
      const st = g.sim.state;
      if (st.enemies.length === 0 && st.phase === 'prep') g.callWave();
      g.setGold(999999);
      for (const id of ['clubber', 'guardian', 'clubber', 'slinger', 'clubber', 'guardian']) {
        if (g.canTrainAlly(id)) g.trainAlly(id);
      }
      g.ff(4);
      return st.enemies.filter((e) => e.blockerAllyId >= 0).length;
    });
    if (r > 0) {
      blocked = r;
      break;
    }
  }
  expect(blocked, '아군이 적을 한 번도 막아 세우지 못했다').toBeGreaterThan(0);

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

test('홈타운: 기지가 쏜다 · 레벨업 2단 확인 · 골드/최대레벨 거부 · HP 정책', async ({ page }) => {
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

  // --- 시작은 움막 하나 (Lv1) ----------------------------------------------
  const init = await page.evaluate(() => window.__wgd!.baseInfo());
  expect(init.level).toBe(1);
  expect(init.levelMax).toBeGreaterThan(1);
  expect(init.cost).not.toBeNull();
  // 사거리는 가장 짧은 공격 타워(frost T1 2.4)보다도 안쪽이어야 한다 — 최후 방어선
  expect(init.range).toBeLessThan(2.4);

  // --- 골드가 모자라면 막힌다 (한 푼도 안 빠진다) ---------------------------
  const poor = await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(1);
    const ok = g.upgradeBase();
    return { can: g.baseInfo().can, ok, gold: g.sim.state.gold, level: g.baseInfo().level };
  });
  expect(poor.can).toBe(false);
  expect(poor.ok).toBe(false);
  expect(poor.gold).toBe(1);
  expect(poor.level).toBe(1);

  // --- 기지 셀 탭 → 레벨업 패널 --------------------------------------------
  await page.evaluate(() => window.__wgd!.setGold(100000));
  const cell = await page.evaluate(() => {
    const c = window.__wgd!.baseInfo().cell;
    return window.__wgd!.cellToScreen(c.x, c.z);
  });
  await page.mouse.click(cell.x, cell.y);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__wgd!.selectedBase())).toBe(true);
  const sortie1 = await page.evaluate(() => ({
    now: window.__wgd!.sim.allySortieRange(),
    pts: window.__wgd!.sim.allySortiePoints(),
  }));
  const panel = page.locator('.tower-panel--home');
  await expect(panel).toBeVisible();
  const upBtn = panel.locator('.tp-btn--up');
  // 패널은 250ms 팝인(card-pop, scale 0.85 → 1) 애니메이션을 탄다.
  // click()은 요소가 멈출 때까지 알아서 기다리지만 boundingBox()는 안 기다리므로
  // 여기서 명시적으로 끝낸다 — 안 그러면 애니메이션 중간 크기(46×0.85=39px)를 잰다
  await panel.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  // 터치 타깃 — 되돌릴 수 없는 결제 버튼이므로 더더욱 오탭이 나면 안 된다
  const box = await upBtn.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // --- 2단 확인: 첫 탭은 무장만, 두 번째 탭이 결제 -------------------------
  const goldBefore = await page.evaluate(() => window.__wgd!.sim.state.gold);
  await upBtn.click();
  await page.waitForTimeout(200);
  const afterFirst = await page.evaluate(() => ({
    gold: window.__wgd!.sim.state.gold,
    level: window.__wgd!.baseInfo().level,
  }));
  expect(afterFirst.gold, '1탭은 결제가 아니다').toBe(goldBefore);
  expect(afterFirst.level).toBe(1);
  await expect(upBtn).toHaveClass(/is-armed/);

  await upBtn.click();
  await page.waitForTimeout(250);
  const afterSecond = await page.evaluate(() => ({
    gold: window.__wgd!.sim.state.gold,
    ...window.__wgd!.baseInfo(),
  }));
  expect(afterSecond.level).toBe(2);
  expect(goldBefore - afterSecond.gold).toBe(init.cost);
  expect(afterSecond.hpMax).toBeGreaterThan(init.hpMax);
  expect(afterSecond.range).toBeGreaterThan(init.range);

  /*
   * 6단계) 마을이 파는 네 번째 물건 — **아군 출격 한계선**.
   * 레벨업으로 실제로 늘어야 하고, 그 사실이 패널에 숫자로 떠 있어야 한다
   * (안 뜨면 "이 결제가 아군까지 강화한다"를 플레이어가 알 방법이 없다).
   */
  const reach2 = await page.evaluate(() => ({
    now: window.__wgd!.sim.allySortieRange(),
    pts: window.__wgd!.sim.allySortiePoints(),
  }));
  expect(reach2.now, `Lv2 출격 한계선 (Lv1은 ${sortie1.now})`).toBeGreaterThan(sortie1.now);
  expect(reach2.pts.length, '경로마다 정지 지점이 하나씩').toBe(sortie1.pts.length);
  // 정지 지점이 실제로 기지에서 멀어졌다 (표식이 규칙을 따라 움직인다)
  const moved = reach2.pts.some(
    (p, i) => Math.abs(p.x - sortie1.pts[i]!.x) + Math.abs(p.z - sortie1.pts[i]!.z) > 0.5,
  );
  expect(moved, `정지 지점 ${JSON.stringify(sortie1.pts)} → ${JSON.stringify(reach2.pts)}`).toBe(true);
  // 현재 성능 줄과 다음 레벨 미리보기 줄 둘 다에 출격 거리가 있다.
  // (패널 문자열은 rAF 폴링으로 갱신되므로 재시도 어서션을 쓴다 — 한 번 읽고 끝내면
  //  결제 직후 한 프레임을 앞질러 읽어 옛 값을 보는 경합이 생긴다)
  await expect(panel.locator('.tp-sub--stats')).toContainText(`출격거리 ${reach2.now.toFixed(1)}`);
  await expect(panel.locator('.tp-sub').nth(1)).toContainText(/출격거리 \d/);

  // --- HP 정책: 누적 피해 절대량 보존 (레벨업은 회복 수단이 아니다) --------
  const hp = await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(1000000);
    g.damageBase(10);
    const before = g.baseInfo();
    g.upgradeBase();
    const after = g.baseInfo();
    return {
      takenBefore: before.hpMax - before.hp,
      takenAfter: after.hpMax - after.hp,
      hp: after.hp,
      hpMax: after.hpMax,
    };
  });
  expect(hp.takenAfter).toBe(hp.takenBefore);
  expect(hp.hp, '전량 회복이 아니다').toBeLessThan(hp.hpMax);

  // --- 최대 레벨에서는 골드가 남아도 거부 -----------------------------------
  const maxed = await page.evaluate(() => {
    const g = window.__wgd!;
    for (let i = 0; i < 10; i++) g.upgradeBase();
    const b = g.baseInfo();
    const gold = g.sim.state.gold;
    const ok = g.upgradeBase();
    return { level: b.level, levelMax: b.levelMax, cost: b.cost, can: b.can, ok, gold, after: g.sim.state.gold };
  });
  expect(maxed.level).toBe(maxed.levelMax);
  expect(maxed.cost).toBeNull();
  expect(maxed.can).toBe(false);
  expect(maxed.ok).toBe(false);
  expect(maxed.after).toBe(maxed.gold);
  await expect(upBtn).toHaveClass(/is-disabled/);

  // --- 기지가 실제로 화살을 쏜다 -------------------------------------------
  const fired = await page.evaluate(() => {
    const g = window.__wgd!;
    let frames = 0;
    for (let i = 0; i < 3000; i++) {
      g.callWave();
      g.ff(1);
      if (g.sim.state.projectiles.some((p) => p.fromBase === true)) frames++;
      if (frames >= 3) break;
    }
    return frames;
  });
  expect(fired, '기지 화살이 실제로 날아간다').toBeGreaterThanOrEqual(3);

  expect(errors).toEqual([]);
});

/**
 * **최악 프레임 예산** — 이 파일에서 가장 중요한 성능 테스트.
 *
 * 5단계 이전의 드로우콜 검사는 **타워를 1기만 짓고** ≤60을 어서션했다. 최악 프레임을
 * 만들지 않으므로 구조적으로 통과할 수밖에 없었고, 그래서 "합성 최대 프레임 = 60콜,
 * 여유 0"이라는 전제가 코드 곳곳에 근거로 인용되는 동안 아무도 그걸 재지 않았다.
 * 실제로 재 보면 그 전제는 틀렸다:
 *
 *   타워 수 스윕 (적 0·아군 0·마을 Lv1, swiftshader 900×1000)
 *     0기 11콜 · 4기 23 · 8기 36 · 12기 47 · 15기 56   → **타워 1기당 약 3콜**
 *
 * 즉 드로우콜 천장을 만드는 것은 오버레이도 아군도 마을도 아니라 **타워 수**이고,
 * 타워 수에는 상한이 없다(sim/battle.ts cmdPlace는 골드와 건설 가능 셀만 본다).
 *
 * 진짜로 깨져 있던 것은 삼각형이었다. 개정 전 최악 프레임은 **170,341 삼각형**으로
 * 예산 150,000의 114%였고, 원인 둘을 5단계에서 고쳤다:
 *   1) 인스턴스 유닛의 그림자 패스 제거 (views/enemyview.ts UNIT_SHADOW)
 *   2) 아군 장비를 별도 지오메트리로 분리 (meshlib/enemies.ts RAIDER_KITS)
 *
 * 이 테스트는 **실제 최악 프레임을 만들어** 두 예산을 함께 잰다.
 * 구성: 후반 웨이브를 불러 동시 생존을 최대로(스테이지1 웨이브 49 = 56마리) 채우고,
 * 종을 전 종으로 흩어 메시 수를 최대화하고, 만렙 T5 타워 12기 + 마을 만렙 + 아군 정원,
 * 전부 반피로 깎아 오버레이까지 켠 뒤 얼린다.
 */
test('최악 프레임 예산 — 삼각형 150,000 / 드로우콜 상한', async ({ page }) => {
  /*
   * ⚠ **이 예산은 스테이지1에서만 검증된다** (8단계 검증에서 확인, 미해결).
   * 진입 동선이 `goto → click(100,300) → 전투`라 언제나 s1이다. 같은 레시피를 다른
   * 스테이지에 적용해 재면(1280×800 · swiftshader · 배치 가능한 칸을 전부 채운 구성):
   *    s1 143,601 / s2 144,469 / s3 **160,212** / s4 **151,959** / s5 **154,598** / s6 **150,360**
   * 즉 s3~s6은 이 레시피에서 삼각형 예산(150,000)을 넘는다. **아군 기능 탓이 아니다** —
   * 아군 0명 통제에서도 s3은 152,880으로 이미 넘고, 아군 6명의 몫은 5,800~7,700으로
   * 스테이지에 무관하다(5단계 아군 기능 자체의 값). 출격 한계선이 어디든 몫은 0이다
   * (아군은 항상 그려진다 — render/views/enemyview.ts frustumCulled = false).
   * 완화 요인: 이 초과는 아래 '16종 흩기'라는 **합성 최악**에서만 난다 — 자연 편성이면
   * s3·s5도 예산 안이다. 고치려면 프레임 구성이 아니라 지오메트리(스테이지 소품/타워
   * LOD) 쪽을 손대야 해서 이번 작업 범위 밖에 뒀다.
   *
   * 기본 60초로는 모자란다 — **문턱이 아니라 시간의 문제**다.
   * 이 테스트는 표본을 3개(worst / withAlly / noAlly) 뽑고 표본 하나가 rAF 30프레임인데,
   * 적 60마리를 얼린 상태의 swiftshader는 1~3fps라 표본 하나가 12~25초다.
   * 실측: 이 컨테이너에서 46.0s(mobile-portrait) · 48.2s(desktop)로 **예산의 77%**를
   * 쓰고 통과한다. 검증 환경에서는 같은 자리에서 60초를 넘겨 2/2 실패했고,
   * --timeout=240000으로만 올리면 통과했다(58.6s · 1.1m). 즉 머신 속도에 따라
   * 초록/빨강이 갈리는 상태였다. 예산 수치(150,000 · 90콜 · 델타 1)는 한 톨도
   * 건드리지 않고 **시간만** 넉넉히 준다.
   */
  test.setTimeout(240_000);
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

  /**
   * rAF 2회 뒤부터 n프레임 관측한 최대치 (renderInfo는 매 프레임 리셋된다).
   * 비행 중인 투사체 수도 같이 낸다 — 아래 통제 A/B가 두 표본의 조건이 같았음을
   * 이 값으로 증명한다(그게 안 맞으면 델타 1이 아군이 아니라 화살 한 발의 몫이다).
   */
  const sample = (): Promise<{ calls: number; tris: number; proj: number }> =>
    page.evaluate(
      () =>
        new Promise<{ calls: number; tris: number; proj: number }>((res) => {
          const g = window.__wgd!;
          let calls = 0;
          let tris = 0;
          let i = 0;
          const step = (): void => {
            const r = g.renderInfo();
            calls = Math.max(calls, r.calls);
            tris = Math.max(tris, r.triangles);
            if (++i >= 30) res({ calls, tris, proj: g.sim.state.projectiles.length });
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(() => requestAnimationFrame(step));
        }),
    );

  const built = await page.evaluate(() => {
    const g = window.__wgd!;
    const sim = g.sim;
    const st = sim.state as unknown as {
      gold: number;
      baseHp: number;
      baseHpMax: number;
      waveIndex: number;
      hand: readonly unknown[];
      towers: { id: number; hp: number; maxHp: number }[];
      enemies: { defId: string; hp: number; maxHp: number; dist: number }[];
      allies: { hp: number; maxHp: number }[];
    };
    // 1) 만렙 T5 타워 12기
    let n = 0;
    outer: for (let z = 0; z < 40 && n < 12; z++) {
      for (let x = 0; x < 40 && n < 12; x++) {
        if (!sim.canPlaceAt(x, z)) continue;
        st.gold = 99_999_999;
        for (let h = 0; h < st.hand.length; h++) {
          if (g.place(h, x, z)) {
            n++;
            continue outer;
          }
        }
      }
    }
    for (let round = 0; round < 6; round++) {
      st.gold = 99_999_999;
      for (const t of st.towers) sim.applyCommand({ type: 'upgradeTower', towerId: t.id });
    }
    // 2) 마을 만렙
    for (let i = 0; i < 8; i++) {
      st.gold = 99_999_999;
      g.upgradeBase();
    }
    // 3) 적 — 후반 웨이브를 불러 놓고 죽지도 새지도 않게 붙잡아 둔다
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
    // 4) 종을 전부 흩어 메시 수를 최대화 (종마다 InstancedMesh가 따로다)
    const IDS = [
      'raptor', 'compy', 'trike', 'ptera', 'ankylo', 'boar', 'warrior', 'shaman',
      'blade', 'lancer', 'archer', 'hexer', 'mammoth', 'spino', 'trex', 'golem',
    ];
    st.enemies.forEach((e, i) => {
      e.defId = IDS[i % IDS.length]!;
    });
    // 5) 아군 정원
    for (let i = 0; i < 6; i++) {
      st.gold = 99_999_999;
      g.trainAlly((['clubber', 'slinger', 'guardian'] as const)[i % 3]!);
    }
    return { towers: st.towers.length, enemies: st.enemies.length, allies: st.allies.length };
  });
  expect(built.towers, '타워 12기').toBeGreaterThanOrEqual(10);
  expect(built.enemies, '동시 생존 적').toBeGreaterThanOrEqual(40);
  expect(built.allies, '아군 정원').toBeGreaterThanOrEqual(6);

  // 스폰 팝(0.28초)이 끝나도록 실시간을 흘린 뒤 얼린다 — 팝 중에는 스케일이 0에 가깝다
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const g = window.__wgd!;
    const st = g.sim.state as unknown as {
      enemies: { hp: number; maxHp: number }[];
      towers: { hp: number; maxHp: number }[];
      allies: { hp: number; maxHp: number }[];
    };
    g.pause(true);
    // 반피로 깎아 오버레이(체력바)까지 켠다
    for (const e of st.enemies) e.hp = Math.max(1, Math.round(e.maxHp * 0.5));
    for (const t of st.towers) t.hp = Math.max(1, Math.round(t.maxHp * 0.5));
    for (const a of st.allies) a.hp = Math.max(1, Math.round(a.maxHp * 0.5));
    g.ff(1);
  });
  await page.waitForTimeout(500);
  const worst = await sample();
  const msg = `최악 프레임 ${JSON.stringify(worst)} 구성 ${JSON.stringify(built)}`;

  // 삼각형 예산 — 이게 5단계에서 실제로 깨져 있던 축이다 (개정 전 170,341)
  expect(worst.tris, msg).toBeGreaterThan(50_000); // 실험이 공허하지 않은지
  expect(worst.tris, msg).toBeLessThanOrEqual(150_000);

  /**
   * 드로우콜 상한 90. 60이 아닌 이유는 위 주석대로 **60이 최악 프레임 값이었던 적이
   * 없기 때문**이다(개정 전에도 이 구성에서 80~93콜이었다). 90은 실측 73~81에
   * "타워 세 기어치" 남짓의 여유를 준 값이고, 메시를 새로 만들면(종당 +1) 바로 걸린다.
   * 이 숫자를 올리려면 타워 인스턴싱처럼 **구조를 고치는 쪽**을 먼저 검토하라.
   */
  expect(worst.calls, msg).toBeLessThanOrEqual(90);

  /**
   * 아군 정원이 예산에서 차지하는 몫 — 6명을 빼도 프레임이 크게 달라지지 않아야 한다.
   *
   * ── 여기부터는 **통제 구간**이다: 먼저 비행 중인 투사체를 비운다 ──────────
   * 위 `worst`는 "최악 프레임"이라 투사체가 들어 있는 게 맞다(절대 예산은 그걸로 잰다).
   * 그런데 아군 몫은 **두 표본의 차**라, 한쪽 표본에만 화살이 한 발 떠 있으면 그 1콜이
   * 그대로 아군 탓으로 청구된다. 실측(같은 빌드 9회): 두 표본의 투사체 수가 같으면
   * 델타는 **항상 1**이고, 한쪽만 1발 더 떠 있던 1회에서만 2가 나왔다
   * (worst proj 1 · noAlly proj 0 → 델타 2). 즉 이 항목의 원래 flakiness는
   * 아군이 아니라 **통제되지 않은 투사체**였다.
   *
   * 비우는 방법은 침묵(hexer의 저주와 같은 상태)이다 — 타워가 발사를 멈추면
   * 이미 떠 있던 것들이 몇 틱 안에 착탄한다. 기지는 사거리(4.6) 안에 적이 없어
   * (적을 경로 초입 dist 4에 묶어 뒀다) 애초에 쏘지 않는다.
   * **문턱은 한 톨도 바꾸지 않았다** — 통제만 더했다.
   */
  const drained = await page.evaluate(() => {
    const g = window.__wgd!;
    const st = g.sim.state as unknown as {
      towers: { silenceLeft: number }[];
      projectiles: readonly unknown[];
    };
    for (const t of st.towers) t.silenceLeft = 100_000;
    for (let i = 0; i < 120 && st.projectiles.length > 0; i++) g.ff(1);
    return st.projectiles.length;
  });
  expect(drained, '통제 A/B 전에 투사체가 비워졌다').toBe(0);
  await page.waitForTimeout(400);
  const withAlly = await sample();

  await page.evaluate(() => {
    const g = window.__wgd!;
    for (const a of g.sim.state.allies as unknown as { alive: boolean }[]) a.alive = false;
    g.ff(1);
  });
  await page.waitForTimeout(400);
  const noAlly = await sample();
  const dmsg = `아군 6명의 드로우콜 몫: ${noAlly.calls} → ${withAlly.calls} (투사체 ${withAlly.proj}/${noAlly.proj})`;
  // 통제가 실제로 유지됐는지 — 둘 다 투사체 0이어야 델타가 아군의 몫이다
  expect(withAlly.proj, dmsg).toBe(0);
  expect(noAlly.proj, dmsg).toBe(0);
  expect(withAlly.calls - noAlly.calls, dmsg).toBeLessThanOrEqual(1);
  expect(
    withAlly.tris - noAlly.tris,
    `아군 6명의 삼각형 몫: ${noAlly.tris} → ${withAlly.tris}`,
  ).toBeLessThanOrEqual(15_000);

  await page.evaluate(() => window.__wgd?.pause(false));
  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

/**
 * **하늘길이 실제로 화면에 나온다** (15단계).
 *
 * 스테이지1에 처음으로 비행 적이 생겼다(stage01.airPaths + wavePlan.airFromWave).
 * 시뮬레이션 쪽은 봉투가 잠그지만, 렌더는 별개다 — 익룡 메시가 없거나 공중 레인이
 * 지상 경로로 잘못 물리면 시뮬레이션은 멀쩡한데 **화면에는 아무 일도 안 일어난다**.
 * 그래서 여기서는 세 가지를 눈으로 확인할 수 있는 형태로 잰다:
 *  (a) w22부터 실제로 비행 적이 스폰된다 (그 전 웨이브에는 한 마리도 없다 = 온보딩)
 *  (b) 그 적이 **지상 경로가 아니라 하늘길** 위에 있다 (x가 지상 S자가 아니라 4 근처)
 *  (c) 그리는 동안 예산(드로우콜 90 / 삼각형 150,000)을 넘지 않고 콘솔 에러가 없다
 */
test('하늘길: w22부터 익룡이 공중 레인으로 온다 (렌더 + 예산)', async ({ page }) => {
  test.setTimeout(180_000);
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

  /**
   * 이 웨이브를 돌려 보고 나온 비행 적의 좌표를 모은다.
   * `freezeOnFlyer`면 익룡이 화면에 떠 있는 **그 순간 멈춘다** — 예산은 반드시
   * 익룡이 살아 있는 프레임에서 재야 의미가 있다(다 죽은 뒤에 재면 빈 화면을 잰다).
   */
  const runWave = (
    wave: number,
    freezeOnFlyer: boolean,
  ): Promise<{ flyers: number; xs: number[]; zs: number[]; alive: number }> =>
    page.evaluate(
      ([w, freeze]) => {
        const g = window.__wgd!;
        const st = g.sim.state as unknown as {
          waveIndex: number;
          baseHp: number;
          baseHpMax: number;
          phase: string;
          enemies: { defId: string; x: number; z: number }[];
        };
        st.baseHp = 1e9;
        st.baseHpMax = 1e9;
        st.waveIndex = w as number;
        g.callWave();
        const xs: number[] = [];
        const zs: number[] = [];
        let flyers = 0;
        for (let i = 0; i < 4000; i++) {
          g.ff(1);
          let live = 0;
          for (const e of st.enemies) {
            if (e.defId !== 'ptera') continue;
            live++;
            flyers++;
            // 기지 근처는 지상·공중이 만나므로 레인 판정에서 뺀다
            if (e.z < 11) {
              xs.push(e.x);
              zs.push(e.z);
            }
          }
          // 익룡이 마을 쪽으로 충분히 내려온 시점에서 얼린다 (하늘길 중간 = 볼 만한 프레임)
          if (freeze && live > 0 && zs.length > 0 && (zs[zs.length - 1] as number) > 6) {
            g.pause(true);
            return { flyers, xs, zs, alive: live };
          }
          if (st.phase !== 'wave' && i > 60) break;
        }
        return { flyers, xs, zs, alive: 0 };
      },
      [wave, freezeOnFlyer] as [number, boolean],
    );

  // (a) 게이트 이전 웨이브에는 비행이 한 마리도 없다
  const before = await runWave(21, false);
  expect(before.flyers, `w21 비행 적 ${before.flyers}마리 (게이트 이전인데 나왔다)`).toBe(0);

  // (a) w22 = 첫 하늘길 웨이브
  const at22 = await runWave(22, false);
  expect(at22.flyers, 'w22에 익룡이 한 마리도 안 나왔다').toBeGreaterThan(0);

  // (b) 하늘길(x=4 직선) 위에 있다 — 지상 S자는 같은 z에서 x가 1이나 9다
  const maxDx = Math.max(...at22.xs.map((x) => Math.abs(x - 4)));
  expect(
    maxDx,
    `익룡이 하늘길(x=4)에서 최대 ${maxDx.toFixed(2)}타일 벗어났다 — 지상 경로를 타고 있다`,
  ).toBeLessThan(1.0);
  expect(Math.min(...at22.zs), '익룡이 스폰(z=0) 근처에서 관측되지 않았다').toBeLessThan(3);
  expect(Math.max(...at22.zs), '익룡이 마을 쪽으로 내려오지 않았다').toBeGreaterThan(8);

  // (c) 익룡이 **화면에 떠 있는 프레임**에서 예산을 잰다
  const frozen = await runWave(22, true);
  expect(frozen.alive, '익룡이 떠 있는 프레임을 못 잡았다').toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const info = await page.evaluate(
    () =>
      new Promise<{ calls: number; tris: number; flyers: number }>((res) => {
        const g = window.__wgd!;
        let calls = 0;
        let tris = 0;
        let i = 0;
        const step = (): void => {
          const r = g.renderInfo();
          calls = Math.max(calls, r.calls);
          tris = Math.max(tris, r.triangles);
          if (++i >= 20) {
            const st = g.sim.state as unknown as { enemies: { defId: string }[] };
            res({ calls, tris, flyers: st.enemies.filter((e) => e.defId === 'ptera').length });
          } else requestAnimationFrame(step);
        };
        requestAnimationFrame(() => requestAnimationFrame(step));
      }),
  );
  const msg = `w22 렌더 ${JSON.stringify(info)} (관측 좌표 ${at22.xs.length}개)`;
  // 검증이 공허하지 않은지 — 익룡이 실제로 그려지는 중이어야 한다
  expect(info.flyers, msg).toBeGreaterThan(0);
  expect(info.calls, msg).toBeGreaterThan(0);
  expect(info.calls, msg).toBeLessThanOrEqual(90);
  expect(info.tris, msg).toBeLessThanOrEqual(150_000);
  await page.evaluate(() => window.__wgd?.pause(false));
  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});
