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

  // --- 출동 바가 실제로 있고 터치 타깃을 지키는가 ---------------------------
  const btns = page.locator('.ally-btn');
  await expect(btns).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const box = await btns.nth(i).boundingBox();
    expect(box, `출동 버튼 ${i} 박스`).not.toBeNull();
    expect(box!.height, `출동 버튼 ${i} 높이`).toBeGreaterThanOrEqual(44);
  }

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

  /** rAF 2회 뒤부터 n프레임 관측한 최대치 (renderInfo는 매 프레임 리셋된다) */
  const sample = (): Promise<{ calls: number; tris: number }> =>
    page.evaluate(
      () =>
        new Promise<{ calls: number; tris: number }>((res) => {
          const g = window.__wgd!;
          let calls = 0;
          let tris = 0;
          let i = 0;
          const step = (): void => {
            const r = g.renderInfo();
            calls = Math.max(calls, r.calls);
            tris = Math.max(tris, r.triangles);
            if (++i >= 30) res({ calls, tris });
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

  // 아군 정원이 예산에서 차지하는 몫 — 6명을 빼도 프레임이 크게 달라지지 않아야 한다
  await page.evaluate(() => {
    const g = window.__wgd!;
    for (const a of g.sim.state.allies as unknown as { alive: boolean }[]) a.alive = false;
    g.ff(1);
  });
  await page.waitForTimeout(400);
  const noAlly = await sample();
  expect(
    worst.calls - noAlly.calls,
    `아군 6명의 드로우콜 몫: ${noAlly.calls} → ${worst.calls}`,
  ).toBeLessThanOrEqual(1);
  expect(
    worst.tris - noAlly.tris,
    `아군 6명의 삼각형 몫: ${noAlly.tris} → ${worst.tris}`,
  ).toBeLessThanOrEqual(15_000);

  await page.evaluate(() => window.__wgd?.pause(false));
  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});
