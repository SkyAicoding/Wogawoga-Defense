/**
 * E2E 스모크 — 실제 빌드에서 타이틀→로비→전투 플로우, 테스트 훅(?test=1)으로
 * 배치/웨이브 빨리감기, 콘솔 에러 0 + 드로우콜 예산(≤60) 어서션.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

declare global {
  interface Window {
    __wgd?: {
      sim: {
        state: {
          phase: string;
          waveIndex: number;
          /** 준비 단계 잔여 틱 — 크게 박아 두면 웨이브가 스스로 시작하지 않는다(적 0 통제) */
          prepTicksLeft: number;
          gold: number;
          baseHp: number;
          hand: { towerId: string; cost: number }[];
          enemies: { blockerAllyId: number; x: number; z: number }[];
          towers: readonly unknown[];
          /**
           * 9단계) dist/pathIndex/slot/holdDist 가 사라지고 tgtX/tgtZ/walked 가 생겼다 —
           * 아군은 경로가 아니라 **찍은 칸으로 직선**으로 간다 (sim/allies.ts 규칙 2).
           */
          allies: {
            id: number;
            defId: string;
            targetId: number;
            hp: number;
            alive: boolean;
            x: number;
            z: number;
            tgtX: number;
            tgtZ: number;
            walked: number;
          }[];
          /**
           * 지금 마을 레벨이 허용하는 정원. 9단계 검증 중에는 이 칸이 **절대 상한 6에
           * 박혀 갱신되지 않는 버그**가 있었고(HUD가 Lv1에서 '0/6'을 띄웠다) 그래서 이
           * 파일은 어서션에 안 썼다. 지금은 생성·레벨업 두 곳에서 갱신되어 옳다.
           * 그래도 상한 판정에는 `sim.allyCap()`을 쓴다 — 규칙의 출처가 그쪽이다.
           */
          allyCap: number;
          baseLevel: number;
          baseLevelMax: number;
          baseHpMax: number;
          projectiles: { fromBase?: boolean; towerDefId: string }[];
        };
        allyCost(defId: string): number;
        canTrainAlly(defId: string): boolean;
        /** 지금 마을 레벨이 허용하는 부족원 정원 (9단계에 allySortieRange를 대신한다) */
        allyCap(): number;
        baseNextStats(): { hpMax: number; dmg: number; range: number; allyCap: number } | null;
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
      /**
       * 지금 고른 부족 종족 (없으면 null). 9단계 후반에 '이동 명령' 버튼을 걷어내고
       * 조작을 전부 판 위로 옮기면서 생겼다 — 선택 상태가 DOM에 없으므로
       * 이 훅이 아니면 "탭이 먹혔는가"를 관찰할 방법이 없다.
       */
      selectedAlly(): string | null;
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

/**
 * 마을 패널 한 줄의 **마지막 숫자**를 읽는다 — 그 자리가 정원 칸이다.
 *
 * 왜 라벨 문자열('부족원 N')이 아니라 위치로 읽는가: 라벨은 ko/en 두 벌이고 카피는
 * 계약이 아니다. 라벨을 어서션하면 문구를 다듬는 것만으로 테스트가 빨개져, 이 테스트가
 * **옳은 수정을 막는 물건**이 된다. (9단계 검증에서 실제로 그 일이 났다: 라벨이
 * '출격거리'로 남아 화면이 거짓말을 하고 있었는데, 고치자 '{s}명'의 '명' 때문에
 * 이 추출이 깨졌다. 지금은 두 언어 모두 정원이 **줄의 마지막 숫자**다.)
 * 그래서 잠그는 것은 "이 줄의 마지막 숫자가 sim이 말하는 정원과 같은가"다 —
 * 값이 틀리거나 사라지면 그대로 빨개진다.
 */
async function tailNumber(loc: Locator): Promise<number | null> {
  const text = ((await loc.textContent()) ?? '').trim();
  const m = /(\d+)\s*$/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * 판(캔버스)까지 탭이 **실제로 닿는** 셀 중 기준점에서 가장 먼 칸.
 *
 * 마을 패널이 열려 있으면 판의 절반쯤이 HUD에 덮인다(패널 배경은 포인터를 통과시키지만
 * 버튼·출동 구역은 hud-item이라 삼킨다). 그래서 좌표만 계산해 찍으면 탭이 패널에 먹혀
 * **아무 일도 일어나지 않고** 테스트는 "이동이 안 된다"고 잘못 말한다(실측으로 겪었다).
 * elementFromPoint로 캔버스인지 확인하고 고른다.
 *
 * 격자 크기는 훅으로 알 수 없으므로 **배치 가능 셀의 경계 상자**를 격자의 보수적 근사로
 * 쓴다(판 밖 칸을 찍으면 moveAlly가 거부한다 — sim/allies.ts 규칙 2의 격자 밖 거부).
 */
async function pickBoardCell(
  page: Page,
  from: { x: number; z: number },
): Promise<{ x: number; z: number; px: number; py: number; d: number }> {
  const cell = await page.evaluate((origin) => {
    const g = window.__wgd!;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let z = 0; z < 40; z++) {
      for (let x = 0; x < 40; x++) {
        if (!g.sim.canPlaceAt(x, z)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    let best: { x: number; z: number; px: number; py: number; d: number } | null = null;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const p = g.cellToScreen(x, z);
        if (p.x < 4 || p.y < 4 || p.x > window.innerWidth - 4 || p.y > window.innerHeight - 4) {
          continue;
        }
        const el = document.elementFromPoint(p.x, p.y);
        if (!el || el.tagName !== 'CANVAS') continue;
        const d = Math.hypot(x - origin.x, z - origin.z);
        if (!best || d > best.d) best = { x, z, px: p.x, py: p.y, d };
      }
    }
    return best;
  }, from);
  expect(cell, '판 위에서 탭할 수 있는 칸을 하나도 찾지 못했다').not.toBeNull();
  return cell as { x: number; z: number; px: number; py: number; d: number };
}

/**
 * rAF 2회 뒤부터 n프레임 관측한 드로우콜/삼각형 최대치 (renderInfo는 매 프레임 리셋된다).
 * 아래 테스트들이 같은 잣대를 써야 여러 곳의 실측값을 나란히 읽을 수 있다.
 *
 * 비행 중인 투사체 수(proj)도 같이 낸다 — 통제 A/B가 두 표본의 조건이 같았음을 이 값으로
 * 증명한다(그게 안 맞으면 델타 1이 아군이 아니라 화살 한 발의 몫이다).
 */
function maxFrame(page: Page, frames = 20): Promise<{ calls: number; tris: number; proj: number }> {
  return page.evaluate(
    (n) =>
      new Promise<{ calls: number; tris: number; proj: number }>((res) => {
        const g = window.__wgd!;
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

/**
 * **합성 최악 프레임 레시피** — 아래 두 예산 테스트가 공유한다.
 * 후반 웨이브를 불러 동시 생존을 최대로 채우고(스테이지1 웨이브 49 = 56마리), 종을 16종으로
 * 흩어 메시 수를 최대화하고, 만렙 T5 타워 12기 + 마을 만렙 + 아군 정원을 세운 뒤
 * 전원 반피로 깎아 오버레이(체력바)까지 켜고 얼린다.
 *
 * 두 테스트가 **같은 함수**를 써야 s1 값과 s2~s6 값을 나란히 읽을 수 있다 — 레시피가
 * 한쪽에서만 흘러가면 표가 통째로 거짓이 된다(이 파일이 실제로 겪은 사고다).
 * 호출 전제: 이미 전투 화면이고 `window.__wgd`가 준비됐을 것.
 */
async function buildWorstFrame(
  page: Page,
): Promise<{ towers: number; enemies: number; allies: number }> {
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
  return built;
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
 * 아군 부족원 출동 — 마을에서 주민을 뽑아 적을 막아 세운다.
 *
 * **드로우콜이 이 테스트의 핵심이다.** 아군은 적 습격대와 같은 InstancedMesh,
 * 같은 오버레이 메시를 쓰므로(구조 검증은 tests/render/allies.test.ts) 두 메시가
 * 이미 켜져 있는 프레임 — 즉 실측 최악 프레임의 조건 — 에서는 **한 콜도 늘면 안 된다**.
 *
 * ── 9단계에 이 테스트에서 바뀐 것 ──────────────────────────────────────────
 * 상한이 상수(ALLY_MAX_ACTIVE 6)에서 **마을 레벨의 함수**로 옮겨갔다(Lv1 2명 → Lv5 6명).
 * 그래서 "세 명을 잇달아"처럼 **머릿수를 박아 둔 문장이 전부 거짓**이 됐고, 전부
 * `sim.allyCap()`에 물어보는 형태로 다시 유도했다. 문턱을 낮춘 것이 아니라 재는 대상이
 * 옮겨간 것이다 — 그 대신 이 테스트는 옛 판본이 잴 수 없던 것을 새로 잠근다:
 * **정원이 차면 골드가 남아도 회색이고, 마을을 올리면 그 자리에서 한 명이 더 나간다.**
 * 이동 명령(규칙 2)은 분량이 커서 아래 별도 테스트로 뺐다.
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
  // ⚠ 부족이 **넷**이 됐다 (채집꾼 — docs/gather-spec.md T1의 ALL_ALLY_IDS).
  //   순서는 싼 값 순이라 0번이 채집꾼이다. 이 테스트가 재는 것(출동·상한·정원)은
  //   종과 무관하므로 개수만 따라 올린다.
  const btns = page.locator('.ally-btn');
  await expect(btns).toHaveCount(4); // DOM에는 있다 (패널이 display:none일 뿐)
  await expect(btns.first()).toBeHidden();

  // 마을(기지 셀) 탭 → 한 패널에서 출동과 레벨업이 둘 다 열린다
  const homePanel = page.locator('.tower-panel--home');
  await tapBase(page);
  await expect(homePanel).toBeVisible();
  await expect(homePanel.locator('.ally-btn')).toHaveCount(4);
  await expect(homePanel.locator('.tp-btn--up')).toBeVisible();
  await homePanel.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  for (let i = 0; i < 4; i++) {
    const box = await btns.nth(i).boundingBox();
    expect(box, `출동 버튼 ${i} 박스`).not.toBeNull();
    expect(box!.height, `출동 버튼 ${i} 높이`).toBeGreaterThanOrEqual(44);
    // 버튼이 셋에서 넷이 되면서 **가로**가 좁아졌다 — 세로만 재면 계약이 반쪽이다
    expect(box!.width, `출동 버튼 ${i} 폭`).toBeGreaterThanOrEqual(44);
  }

  /*
   * --- 연속 출동: 패널이 닫히지 않고 **정원만큼** 잇달아 내보낼 수 있는가 --------
   * 상시 바(1탭)를 잃은 대가를 여기서 갚는다 — 열어 두면 이후는 여전히 1탭이다.
   *
   * 9단계) 몇 번 누를 수 있는지를 **상수로 적을 수 없게 됐다.** 상한이
   * ALLY_MAX_ACTIVE(6) 고정에서 **마을 레벨의 함수**로 옮겨갔기 때문이다
   * (BaseLevelDef.allyCap — Lv1 2명 → Lv5 6명). 그래서 sim에게 지금 정원을 묻고
   * 그만큼 누른다. 3을 박아 두면 Lv1에서 세 번째가 거부돼 빨개지는데(실측),
   * 그건 기능이 깨진 게 아니라 **테스트가 옛 상수를 들고 있는 것**이다.
   */
  await page.evaluate(() => window.__wgd!.setGold(5000));
  const cap1 = await page.evaluate(() => window.__wgd!.sim.allyCap());
  expect(cap1, 'Lv1 정원').toBeGreaterThanOrEqual(1);
  for (let i = 0; i < cap1; i++) {
    await btns.nth(i % 4).click();
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.__wgd!.selectedBase()), `${i + 1}번째 출동 뒤 마을 선택`)
      .toBe(true);
    await expect(homePanel).toBeVisible();
  }
  expect(
    await page.evaluate(() => window.__wgd!.allies().length),
    `정원(${cap1})만큼 연속 출동`,
  ).toBe(cap1);
  /*
   * 인원 표시가 실제 인원을 따라간다 — **분자만** 잰다.
   * ⚠ 분모는 state.allyCap(절대 상한 6)이라 Lv1에서 "2/6"으로 뜬다. 마을이 2명까지만
   * 허용하는데 화면은 6명까지 갈 수 있다고 말하는 셈이고, `is-full`도 그래서 안 붙는다.
   * 이건 이 파일이 고칠 수 있는 자리가 아니라 **src 쪽 결함**이라 보고했다 —
   * 여기서 분모까지 어서션하면 지금 빨간 줄이 되고, 6을 기대값으로 박으면 그 결함을
   * 계약으로 굳힌다. 그래서 분자만 잠근다.
   */
  await expect(page.locator('.ally-count-num')).toHaveText(new RegExp(`^${cap1}/`));

  /*
   * --- 정원이 정말 **마을 레벨의 함수**인가 (9단계의 새 억제 장치) -------------
   * 출격 한계선이 사라진 자리를 정원이 물려받았다(sim/allies.ts "억제 장치가 자리를
   * 옮겼다"). 그 계약이 화면에서 참이려면 둘이 함께 성립해야 한다:
   *   · 정원이 차면 **골드가 남아도** 세 버튼이 전부 회색이다(canTrainAlly 그대로), 그리고
   *   · 마을을 한 단 올리면 **그 자리에서** 다시 살아나 한 명이 더 나간다.
   * 상한이 다시 상수로 굳거나 레벨과의 연결이 끊기면 둘 중 하나가 바로 빨개진다.
   */
  for (let i = 0; i < 4; i++) {
    await expect(btns.nth(i), `정원이 찼는데 출동 버튼 ${i}가 살아 있다`).toHaveClass(/is-disabled/);
  }
  const grown = await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(100_000);
    const before = g.sim.allyCap();
    g.upgradeBase();
    return { before, after: g.sim.allyCap(), level: g.baseInfo().level };
  });
  expect(grown.after, `Lv${grown.level} 정원 (Lv1은 ${grown.before})`).toBeGreaterThan(grown.before);
  await expect(btns.nth(0), '레벨업했는데 출동 버튼이 회색인 채다').not.toHaveClass(/is-disabled/);
  await btns.nth(0).click();
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => window.__wgd!.allies().length),
    '레벨업이 연 자리에 한 명이 더 들어간다',
  ).toBe(cap1 + 1);

  /*
   * --- 전투 중에도 열리고 출동된다 -----------------------------------------
   * 9단계) 수명이 사라져 **자리를 비우는 길은 쓰러지는 것뿐**이다(규칙 3 — 귀환도
   * 환급도 없다). 그래서 여기서 한 명을 쓰러뜨려 자리를 만든 뒤 웨이브 도중에 그 자리를
   * 다시 채운다. 죽음이 정원을 돌려주지 않으면 이 블록이 그대로 빨개진다.
   */
  await page.evaluate(() => {
    const g = window.__wgd!;
    g.callWave();
    g.ff(30);
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__wgd!.sim.state.phase)).toBe('wave');
  await expect(homePanel).toBeVisible();
  const beforeWaveTrain = await page.evaluate(() => {
    const g = window.__wgd!;
    const first = g.sim.state.allies[0];
    if (first) first.alive = false; // 한 명 전사 → 자리 하나가 빈다
    g.ff(2); // 사망 회수(sweepDeadAllies)
    return g.allies().length;
  });
  expect(beforeWaveTrain, '전사한 자리가 실제로 비었다').toBe(cap1);
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
    for (const a of g.sim.state.allies) a.alive = false;
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
    // 9단계) 상한은 state.allyCap(절대 상한)이 아니라 **지금 마을 레벨의 정원**이다
    return { steps, cap: g.sim.allyCap(), gold: g.sim.state.gold };
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
  const maxCalls = async (): Promise<number> => (await maxFrame(page)).calls;

  await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(999999);
    g.place(0, 6, 6);
    g.callWave();
    g.ff(180);
    // 9단계) 아래 A/B는 **세 종이 다 나가야** "종이 셋이어도 메시는 하나"를 잰다.
    // 정원이 마을 레벨의 함수가 됐으므로 여기서 마을을 만렙까지 올려 정원을 연다 —
    // Lv1(2명)에서 재면 두 종만 나가 종별 메시 회귀를 놓친다.
    for (let i = 0; i < 8; i++) {
      g.setGold(999999);
      g.upgradeBase();
    }
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
    for (const a of g.sim.state.allies) a.alive = false;
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
    return { n, cap: g.sim.allyCap() };
  });
  // 만렙 정원을 다 채웠는가 — 못 채우면 아래 델타가 무엇의 몫인지 알 수 없다
  expect(trained.n, `만렙 정원 ${trained.cap}명을 다 못 채웠다`).toBe(trained.cap);
  expect(trained.cap, '만렙 정원이 세 종을 다 내보낼 만큼은 된다').toBeGreaterThanOrEqual(3);
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
    `아군 0명 ${callsNoAlly} → ${trained.n}명 ${callsWithAlly} (종마다 메시를 만들면 3이 된다)`,
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.__wgd?.pause(false));

  /*
   * --- 실제로 적을 막아 세우는가 -------------------------------------------
   * 타워를 전부 판다: 남겨 두면 적이 부족원에게 닿기 전에 죽어 봉쇄를 관찰할 수 없다 —
   * 여기서 보려는 건 "주민만으로 막아 세운다"이다.
   *
   * 9단계) 옛 주석은 "적이 출격 한계선(기지 앞 6타일)에 닿기 전에"라고 적었는데
   * **그 선은 사라졌다.** 지금 부족원은 명령이 없으면 홈타운 앞 집결 지점
   * (ALLY_MUSTER_FORWARD 1.4타일 · 뒷줄 2.0)에 서 있고, 봉쇄는 거기서 사거리(1.0~1.15)
   * 안에 든 적에게 걸린다 — 앞줄 2.40~2.55 · 뒷줄 3.00~3.15 가 문간선(`GATE_STANDOFF_EDGE`
   * + `restReach` = **1.85~2.99**)을 앞뒤로 덮는다. 즉 만나는 자리가 앞에서 문 앞으로
   * 당겨졌을 뿐, 재는 것은 같다.
   */
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
      /*
       * 9단계) **부족원을 적 쪽으로 내보낸다.** 위 A/B 블록이 마을을 만렙으로 올려 뒀는데
       * (사거리 4.6 · 168dps), 집결 지점은 그 사거리 **안**이라 적이 부족원에게 닿기 전에
       * 마을이 먼저 죽인다 — 그 상태로 재면 300회를 돌려도 봉쇄가 한 번도 안 걸린다(실측 0).
       * 옛 판본에서 이 자리를 지켜 주던 것은 출격 한계선(기지 앞 6타일)이었고, 그게
       * 사라진 지금 같은 조건을 만드는 방법이 **이동 명령**이다. 마침 그것이 9단계가
       * 산 물건이다: 어디서 붙을지를 플레이어가 정한다.
       */
      const head = st.enemies[0];
      if (head) {
        g.sim.applyCommand({
          type: 'moveAlly',
          allyId: -1,
          cellX: Math.round(head.x),
          cellZ: Math.round(head.z),
        });
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

/**
 * **이동 명령** — 9단계에 부족이 얻은 유일한 새 조작 (sim/allies.ts 규칙 2).
 *
 * 사용자 지시는 "부족을 선택해서 원하는 위치를 블럭을 찍으면 거기까지 이동"이었다.
 * 그 문장이 화면에서 참인지는 sim 테스트로는 알 수 없다 — 커맨드는 멀쩡한데 마을 패널의
 * '이동 명령' 버튼이 모드를 안 켜거나, 켜도 판 탭이 HUD에 먹히면 **플레이어에게는 기능이
 * 없는 것**이다. 그래서 여기서는 손가락이 하는 일만 한다: 버튼을 누르고, 판을 찍고,
 * 그 결과를 **sim 상태로** 확인한다(DOM만 보면 "버튼이 켜졌다"까지밖에 모른다).
 *
 * 잠그는 것 넷:
 *  ① 인원 0이면 버튼이 회색이다 (보낼 사람이 없는데 모드가 켜지면 다음 탭이 사라진다)
 *  ② 버튼 → 판 탭이 **살아 있는 전원**의 목표를 그 칸으로 박는다 (커맨드의 allyId −1)
 *  ③ 실제로 그 칸으로 걸어가 **도착해서 선다** (규칙 2의 도착 판정)
 *  ④ 흩어져도 드로우콜이 늘지 않는다 — 자유 이동이 예산에 지불하는 값이 0인가
 *
 * 적을 한 마리도 내보내지 않는다(준비 단계를 얼려 둔다). 근접 아군은 교전 중이면 그
 * 자리에 서므로(규칙 5) 적이 있으면 "안 걸어간 것"과 "붙잡혀 선 것"이 구분되지 않고,
 * ④의 A/B도 적·투사체·연출이 흔들어 놓는다(실측: 통제 없이 재면 델타가 −1~+1로 튄다).
 */
test('아군 이동 명령: 판 위 셀을 찍으면 전원이 그 칸으로 걸어간다 (드로우콜 증가 0)', async ({
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

  /**
   * 준비 단계를 얼린다 — prepTicksLeft가 0이 되면 웨이브가 **스스로** 시작한다
   * (PREP_TICKS_FIRST 150틱 = 5초라 이 테스트의 준비 동작보다 짧다). 크게 박아 두면
   * 적이 한 마리도 나오지 않아 위 문단의 통제가 성립한다. ff()로 시간을 밀 때마다
   * 다시 박아야 한다.
   */
  const holdPrep = (): Promise<void> =>
    page.evaluate(() => {
      window.__wgd!.sim.state.prepTicksLeft = 1e9;
    });
  await holdPrep();
  await page.waitForTimeout(900);
  const quiet = await page.evaluate(() => ({
    phase: window.__wgd!.sim.state.phase,
    enemies: window.__wgd!.sim.state.enemies.length,
  }));
  expect(quiet, '통제 실패: 적이 없는 준비 단계여야 한다').toEqual({ phase: 'prep', enemies: 0 });

  const homePanel = page.locator('.tower-panel--home');
  await tapBase(page);
  await expect(homePanel).toBeVisible();

  // 마을을 만렙까지 올려 정원을 열고(9단계: 정원 = 마을 레벨) 세 종을 둘씩 내보낸다.
  // **종족별로 둘씩**인 것이 이 테스트의 핵심이다 — 한 종을 고르면 그 둘만 움직이고
  // 나머지 넷은 제자리여야 한다(사용자 지시: "같은 종류는 모두 선택").
  const squad = await page.evaluate(() => {
    const g = window.__wgd!;
    for (let i = 0; i < 8; i++) {
      g.setGold(999_999);
      g.upgradeBase();
    }
    g.setGold(999_999);
    let n = 0;
    for (const id of ['clubber', 'slinger', 'guardian', 'clubber', 'slinger', 'guardian']) {
      if (g.trainAlly(id)) n++;
    }
    g.sim.state.prepTicksLeft = 1e9;
    return { n, cap: g.sim.allyCap() };
  });
  expect(squad.n, '만렙 정원을 다 채웠다').toBe(squad.cap);
  expect(squad.cap, '종족당 둘씩 나와야 이 테스트가 뜻이 있다').toBeGreaterThanOrEqual(6);

  /*
   * ④의 통제 A: **모여 있는** 상태의 프레임. 패널을 닫고 잰다 —
   * 열어 두면 사거리 링(+메시)과 표식이 한쪽 표본에만 끼어 그 몫이 그대로 아군 탓으로
   * 청구된다. 출동 먼지가 사라질 때까지 실시간을 흘린 뒤 얼린다.
   */
  await tapBase(page);
  await expect(homePanel).toBeHidden();
  await page.waitForTimeout(2500);
  await holdPrep();
  await page.evaluate(() => window.__wgd!.pause(true));
  await page.waitForTimeout(300);
  const clustered = await maxFrame(page);
  await page.evaluate(() => window.__wgd!.pause(false));

  /*
   * ② 판 위의 부족원을 탭 → **그 종족 전체** 선택 → 갈 칸을 탭.
   * 9단계 후반에 '이동 명령' 버튼을 걷어내고 조작을 전부 판 위로 옮겼다(사용자 지시).
   * 그래서 이 테스트도 DOM 버튼이 아니라 **캔버스 탭**으로만 조작한다 — 그것이
   * 플레이어가 실제로 하는 동작이고, 버튼이 없어졌으므로 다른 경로도 없다.
   */
  const before = await page.evaluate(() => window.__wgd!.allies());
  const mover = before.find((a) => a.defId === 'clubber');
  if (!mover) throw new Error('몽둥이꾼이 없다 — 편성이 깨졌다');
  const movers = before.filter((a) => a.defId === 'clubber').map((a) => a.id).sort((x, y) => x - y);
  const others = before.filter((a) => a.defId !== 'clubber').map((a) => a.id).sort((x, y) => x - y);
  expect(movers.length, '몽둥이꾼이 둘이어야 "종족 전체"가 검증된다').toBeGreaterThanOrEqual(2);
  expect(others.length, '안 움직여야 할 대조군').toBeGreaterThanOrEqual(2);

  const pick = await page.evaluate((p) => window.__wgd!.cellToScreen(p.x, p.z), {
    x: mover.x,
    z: mover.z,
  });
  await page.mouse.click(pick.x, pick.y);
  await page.waitForTimeout(200);
  const picked = await page.evaluate(() => window.__wgd!.selectedAlly());
  expect(picked, '부족원을 탭했는데 그 종족이 선택되지 않았다').toBe('clubber');

  const target = await pickBoardCell(page, before[0] as { x: number; z: number });
  expect(target.d, '집결 지점과 너무 가까운 칸을 골랐다 (이동을 관찰할 수 없다)').toBeGreaterThan(3);

  /*
   * ②-a **음성 케이스: 좌클릭은 이동시키지 않는다** (10단계 입력 모델).
   * 사용자 지시 ①("좌 선택 · 우 명령")의 절반은 '좌클릭이 더 이상 명령이 아니다'이고,
   * 그쪽은 어서션이 없으면 회귀해도 아무도 모른다 — 옛 코드도 이 클릭 뒤에는 유닛이
   * 움직이므로 아래 ③이 그대로 초록이기 때문이다. 그래서 여기서 먼저 못을 박는다.
   * 겸해서 **좌클릭 = 선택 해제**도 확인한다(찍는 칸은 pickBoardCell이 고른 건설 가능
   * 칸이라 타워·소품·기지가 없다 = 다른 선택이 대신 켜지지 않는다).
   */
  const beforeTargets = await page.evaluate(() =>
    window.__wgd!.sim.state.allies.map((a) => ({ id: a.id, tgtX: a.tgtX, tgtZ: a.tgtZ })),
  );
  await page.mouse.click(target.px, target.py);
  await page.waitForTimeout(250);
  const afterLeft = await page.evaluate(() => ({
    sel: window.__wgd!.selectedAlly(),
    tgts: window.__wgd!.sim.state.allies.map((a) => ({ id: a.id, tgtX: a.tgtX, tgtZ: a.tgtZ })),
  }));
  expect(afterLeft.sel, '좌클릭은 선택 전용이므로 빈 칸을 찍으면 선택이 풀린다').toBeNull();
  expect(afterLeft.tgts, '좌클릭이 이동 명령으로 샜다 (우클릭 모델이 깨졌다)').toEqual(beforeTargets);

  // ②-b 다시 고르고, 이번엔 **우클릭**으로 명령한다
  await page.mouse.click(pick.x, pick.y);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__wgd!.selectedAlly())).toBe('clubber');
  await page.mouse.click(target.px, target.py, { button: 'right' });
  await page.waitForTimeout(250);
  /*
   * **데스크톱은 명령 뒤에도 선택이 남는다** — 골라 놓고 여러 번 시키는 것이 우클릭
   * 모델의 전부다(placement.ts onCommand). 9단계까지는 여기서 null이었다.
   * (터치는 여전히 풀린다 — 아래 '터치 조작' 계약이 그쪽을 잠근다)
   */
  const kept = await page.evaluate(() => window.__wgd!.selectedAlly());
  expect(kept, '우클릭 명령 뒤에 선택이 사라졌다 (연속 지시가 불가능해진다)').toBe('clubber');

  /*
   * ②-c 선택을 내려놓는다 — **아래 ④의 표본 조건을 표본 A와 같게 맞추기 위해서다.**
   * 선택이 켜져 있으면 사거리 바운더리 메시(decals.showAllyRanges)가 목표 표식과
   * **동시에** 살아 델타가 하나 더 붙는다. 그건 이동의 값이 아니라 '고르고 있음'의 값이라
   * 이 계약이 청구할 항목이 아니다(그 +1은 placement.onCommand 주석이 이름 대서 받는다).
   * 지금 찍어도 안전한 이유: 위 우클릭 뒤 250ms만 흘러 부족원은 아직 집결 지점 근처이고,
   * 목표 칸과는 3타일 넘게 떨어져 있다 = 이 좌클릭이 사람을 집지 않는다.
   */
  await page.mouse.click(target.px, target.py);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__wgd!.selectedAlly()), '선택이 안 풀렸다').toBeNull();

  const ordered = await page.evaluate(() =>
    window.__wgd!.sim.state.allies.map((a) => ({ id: a.id, tgtX: a.tgtX, tgtZ: a.tgtZ })),
  );
  expect(ordered.length, '판 위의 부족원 전원').toBe(squad.n);
  /*
   * **선택한 종만 움직인다.** 이것이 이 조작의 계약이다 — 몽둥이꾼 하나를 탭했으니
   * 몽둥이꾼 전원이 목표를 받고, 돌팔매꾼·파수꾼은 집결 지점을 그대로 지켜야 한다.
   * toEqual이 아니라 축별 근사인 이유: 셀 좌표는 placement가 Math.round로 만들고,
   * 가장자리 칸에서는 그 결과가 **-0**이라 toEqual(0)이 Object.is로 갈라진다(실측).
   */
  for (const a of ordered) {
    const isMover = movers.includes(a.id);
    if (isMover) {
      expect(a.tgtX, `#${a.id} 몽둥이꾼 목표 x`).toBeCloseTo(target.x, 5);
      expect(a.tgtZ, `#${a.id} 몽둥이꾼 목표 z`).toBeCloseTo(target.z, 5);
    } else {
      const moved =
        Math.abs(a.tgtX - target.x) < 1e-5 && Math.abs(a.tgtZ - target.z) < 1e-5;
      expect(moved, `#${a.id}(다른 종족)이 같이 끌려갔다`).toBe(false);
    }
  }
  // 명령이 먹혔으면 선택은 스스로 풀린다(위에서 확인). 그리고 부족원을 탭하는 순간
  // 마을 선택은 **풀린다** — 판 위의 선택 셋(타워·소품·기지)과 상호 배타이기 때문이다
  // (탭 하나가 두 가지를 동시에 고르면 어느 패널을 띄울지 정할 수 없다).
  expect(
    await page.evaluate(() => window.__wgd!.selectedBase()),
    '부족을 골랐는데 마을 선택이 남아 있다',
  ).toBe(false);

  // ③ 정말 걸어가고, 도착해서 선다
  const walked = await page.evaluate(() => {
    const g = window.__wgd!;
    g.ff(120); // 4초 — 도착 전 중간 지점
    const mid = g.allies().map((a) => ({ id: a.id, x: a.x, z: a.z }));
    g.ff(900); // 30초 — 가장 느린 파수꾼(0.85타일/초)도 판을 가로지르고 남는다
    g.sim.state.prepTicksLeft = 1e9;
    return {
      mid,
      end: g.sim.state.allies.map((a) => ({ id: a.id, x: a.x, z: a.z, walked: a.walked })),
      enemies: g.sim.state.enemies.length,
    };
  });
  expect(walked.enemies, '통제가 유지됐다 (적이 끼면 근접 아군은 멈춰 선다)').toBe(0);
  const distTo = (p: { x: number; z: number }): number => Math.hypot(p.x - target.x, p.z - target.z);
  for (const a of before) {
    const mid = walked.mid.find((m) => m.id === a.id)!;
    const end = walked.end.find((m) => m.id === a.id)!;
    if (movers.includes(a.id)) {
      expect(distTo(mid), `#${a.id} 4초 뒤 남은 거리`).toBeLessThan(distTo(a) - 1);
      // 도착 판정(ARRIVE_EPS2)은 제곱거리 1e-6 — 눈금 하나 안쪽이면 선 것이다
      expect(distTo(end), `#${a.id} 도착`).toBeLessThan(0.01);
      expect(end.walked, `#${a.id} 걸은 거리`).toBeGreaterThan(0);
    } else {
      // 명령을 안 받은 종족은 **한 걸음도** 안 걷는다 (집결 지점이 곧 목표라 walked 0)
      expect(end.walked, `#${a.id}(다른 종족)이 걸었다`).toBe(0);
    }
  }

  /*
   * ④ 흩어진 프레임의 예산. 위 명령은 전원을 **한 칸**에 모으므로 판 전체로 벌려
   * 다시 잰다(각자 다른 칸 = 커맨드의 allyId ≥ 0 경로). 자유 이동이 산 것이
   * 드로우콜을 물어야 하는가가 이 항목의 질문이다.
   *
   * 실측(desktop 1280×800 · swiftshader · 적 0 · 마을 만렙 · 6명):
   *   아군 0명   11콜 / 30,497삼각형
   *   모여 있음  12콜 / 38,285      ← 아군의 몫은 1콜 (자기 InstancedMesh 하나)
   *   흩어짐     12콜 / 38,441      ← **흩어짐의 몫은 0콜 · +156삼각형**
   * 10단계 재실측: 모임 12 → 흩어짐 14. 늘어난 둘은 아래 어서션이 이름 대서 받는다
   * (목표 표식 1 + 대기 말뚝이 켠 오버레이 메시 1). 흩어짐의 몫은 그대로 0콜이다.
   * 곧 자유 이동은 예산을 사지 않는다. 인스턴스는 위치만 바뀌고 개수가 그대로이며,
   * 아군은 애초에 절두체 컬링을 끄고 언제나 그린다(render/views/enemyview.ts).
   * 종마다·개체마다 메시를 만드는 회귀가 들어오면 여기서 5콜씩 튄다.
   * 삼각형 여유 2,000은 같은 장면을 반복해 재도 ±300쯤 흔들리기 때문이고(애니메이션),
   * 그 폭은 아군 하나 몫(약 1,300)보다 작다.
   */
  await page.evaluate(() => {
    const g = window.__wgd!;
    // 판의 네 귀퉁이 + 한가운데 — 격자 크기를 훅으로 알 수 없으므로 배치 가능 셀의
    // 경계 상자로 잡는다 (pickBoardCell과 같은 근사)
    /*
     * ⚠ **찍는 칸은 반드시 건설 가능 칸이어야 한다** — 자원 칸을 찍으면 이 테스트가
     * 재려는 것이 바뀐다.
     *
     * 예전에는 바운딩 박스의 **모서리 좌표**를 그대로 찍었는데(`{x: minX, z: minZ}`),
     * 그 좌표가 건설 가능 칸이라는 보장이 없었다. 실제로 스테이지1에서 `(0,7)`이
     * 소품(바위) 칸이라, 채집이 들어온 뒤로는 거기 도착한 부족원이 **저절로 캐기
     * 시작**했다(`moveAlly`는 자원 칸에서 채집이 된다 — 설계다). 그 발밑 게이지가
     * 체력바 인스턴스 메시를 `count 0 → 1`로 켜서 드로우콜이 하나 늘고,
     * "**이동**은 드로우콜을 안 늘린다"는 이 계약이 이동과 무관한 이유로 빨개졌다.
     *
     * 곧 문턱(≤ 1)이 틀린 게 아니라 **표본이 틀렸다.** 건설 가능 칸만 고르면
     * 자원 칸이 구조적으로 배제된다(자원 칸 ⊂ 소품 칸이고 소품 칸은 건설 불가다).
     * 채집 자체의 드로우콜 값은 이 테스트가 아니라 **아래 전용 계약**이 잰다.
     */
    const free: { x: number; z: number }[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let z = 0; z < 40; z++) {
      for (let x = 0; x < 40; x++) {
        if (!g.sim.canPlaceAt(x, z)) continue;
        free.push({ x, z });
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    const midX = Math.round((minX + maxX) / 2);
    const midZ = Math.round((minZ + maxZ) / 2);
    /** 원하는 모서리에 **가장 가까운 실제 건설 가능 칸**. 동점은 x→z 순으로 결정론이다 */
    const near = (tx: number, tz: number): { x: number; z: number } => {
      let best = free[0]!;
      let bd = Infinity;
      for (const c of free) {
        const d = (c.x - tx) * (c.x - tx) + (c.z - tz) * (c.z - tz);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    };
    const pts = [
      near(minX, minZ),
      near(maxX, minZ),
      near(minX, maxZ),
      near(maxX, maxZ),
      near(midX, midZ),
      near(minX, midZ),
    ];
    g.sim.state.allies.forEach((a, i) => {
      const p = pts[i % pts.length]!;
      g.sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: p.x, cellZ: p.z });
    });
    g.ff(900);
    g.sim.state.prepTicksLeft = 1e9;
  });
  /*
   * 패널을 닫아 표본 A와 같은 조건으로 되돌린다.
   * ⚠ 무조건 tapBase를 부르면 안 된다 — 그건 **토글**이고, 위에서 부족원을 탭하는 순간
   * 마을 선택이 이미 풀렸다(선택 셋은 상호 배타다). 지금 상태를 보고 열려 있을 때만 닫는다.
   */
  if (await page.evaluate(() => window.__wgd!.selectedBase())) await tapBase(page);
  await expect(homePanel).toBeHidden();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__wgd!.pause(true));
  await page.waitForTimeout(300);
  const scattered = await maxFrame(page);
  const spread = await page.evaluate(() => {
    const xs = window.__wgd!.allies();
    let far = 0;
    for (const a of xs) {
      for (const b of xs) far = Math.max(far, Math.hypot(a.x - b.x, a.z - b.z));
    }
    return far;
  });
  const msg = `모임 ${JSON.stringify(clustered)} → 흩어짐 ${JSON.stringify(scattered)} (최대 간격 ${spread.toFixed(1)}타일)`;
  expect(spread, '흩어지지 않았다 (통제가 성립하지 않는다)').toBeGreaterThan(6);
  /*
   * 델타의 정체를 **이름 대서 적는다** — 둘 다 '흩어짐'의 값이 아니다.
   *  (1) 목표 표식 메시 (decals의 봉수대) — ②의 우클릭이 세웠고 표본 A에는 없었다.
   *      9단계에도 이 몫이 있었고 그래서 문턱이 0이 아니라 1이었다.
   *  (2) 오버레이 인스턴스 메시 (views/healthbars) — 10단계에 **대기 말뚝**(kind 8)이
   *      얹히면서 켜졌다. ④는 부족원 전원을 빈 칸으로 보내므로 여섯이 전부
   *      `autoHold = true`가 된다(sim/allies.ts 규칙 8-b: 빈 칸 = "여기 지켜").
   *      곧 이 +1은 **새 메시가 아니라 count 0 → 6**이고, 말뚝을 따로 그렸다면
   *      여기서 +1이 아니라 +6이 떴을 것이다 — 그 사실이 이 숫자로 잠긴다.
   * 실측(desktop 1280×800 · swiftshader): 모임 12콜 → 흩어짐 14콜 / 삼각형 +240.
   * 흩어짐 자체의 몫은 여전히 **0콜**이다.
   */
  expect(scattered.calls - clustered.calls, msg).toBeLessThanOrEqual(2);
  expect(scattered.tris - clustered.tris, msg).toBeLessThanOrEqual(2_000);
  await page.evaluate(() => window.__wgd!.pause(false));

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

/*
 * ── 터치 조작 (P1의 나머지 절반) ────────────────────────────────────────────
 * 데스크톱은 좌 선택·우 명령으로 갈렸지만 **폰은 흐름을 그대로 둔다**: 버튼이 하나뿐이라
 * 좌탭이 선택과 명령을 겸하고, 명령이 나가면 선택이 풀린다(placement.ts 헤더).
 *
 * 이 계약이 없으면 그 절반이 **아무 데서도 검증되지 않는다** — 나머지 e2e는 전부
 * `page.mouse.click`이라 `pointerType`이 언제나 'mouse'이고, 판정이 어긋나 폰에서
 * 부족원을 못 움직이게 돼도 CI는 초록이다. `touchscreen.tap`은 CDP로 진짜 터치
 * 포인터를 만든다 = `pointerType 'touch'`가 실제로 흐르는 유일한 경로다.
 * (tests/ui/input.test.ts가 이벤트 층을 잠그고, 여기가 게임 층을 잠근다)
 */
test('터치 조작: 탭으로 고르고 탭으로 보낸다 · 명령 뒤 선택이 풀린다', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait', '터치 포인터가 있는 프로젝트에서만 뜻이 있다');
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => window.__wgd !== undefined);

  // 적 없는 준비 단계로 얼린다 — 교전이 끼면 "안 갔다"와 "붙잡혔다"가 구분되지 않는다
  const holdPrep = (): Promise<void> =>
    page.evaluate(() => {
      window.__wgd!.sim.state.prepTicksLeft = 1e9;
    });
  await holdPrep();
  // 화면 전환(커튼/인트로 카메라)이 끝날 때까지 기다린다 — 그 전에는 캔버스 위에
  // 오버레이가 덮여 있어 pickBoardCell의 elementFromPoint가 판을 못 찾는다(실측).
  await page.waitForTimeout(1_200);

  /*
   * 부족원을 **판이 보이는 칸에 미리 세운다.** 집결 지점은 마을 앞이라 390×844에서는
   * 하단 HUD에 덮일 수 있고, 그러면 탭이 패널에 먹혀 "터치가 안 먹는다"고 잘못 말한다.
   * 세우는 것은 sim 커맨드로 한다 — 이 테스트가 재려는 것은 **탭의 해석**이지 이동이 아니다.
   */
  const staged = await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(999_999);
    let n = 0;
    while (n < 2 && g.trainAlly('clubber')) n++;
    return n;
  });
  expect(staged, '몽둥이꾼을 못 뽑았다 (이 계약이 성립하지 않는다)').toBeGreaterThan(0);

  /*
   * 탭할 칸을 **탭 직전에** 고른다. `pickBoardCell`을 쓰지 않는 이유는 그것이 '기준점에서
   * 가장 먼 칸'을 고르기 때문이다 — 390×664에서 가장 먼 칸은 판 가장자리이고, 거기는
   * HUD 사이드 버튼이 나중에 떠올라 덮을 수 있다(실측: elementFromPoint는 캔버스라고
   * 답했는데 300ms 뒤 탭은 `.side-btn`이 먹었다). 여기서는 **캔버스가 확실히 보이는 칸들**을
   * 모아 두고, 설 곳은 그 한가운데를, 보낼 곳은 거기서 가장 먼 곳을 쓴다.
   */
  const visibleCells = (): Promise<{ x: number; z: number; px: number; py: number }[]> =>
    page.evaluate(() => {
      const g = window.__wgd!;
      const out: { x: number; z: number; px: number; py: number }[] = [];
      for (let z = 0; z < 40; z++) {
        for (let x = 0; x < 40; x++) {
          if (!g.sim.canPlaceAt(x, z)) continue;
          const p = g.cellToScreen(x, z);
          // 가장자리 24px은 버린다 — HUD 버튼이 붙는 띠다
          if (p.x < 24 || p.y < 24 || p.x > window.innerWidth - 24 || p.y > window.innerHeight - 24) {
            continue;
          }
          const el = document.elementFromPoint(p.x, p.y);
          if (!el || el.tagName !== 'CANVAS') continue;
          out.push({ x, z, px: p.x, py: p.y });
        }
      }
      return out;
    });
  const cells = await visibleCells();
  expect(cells.length, '판 위에서 탭할 수 있는 칸이 없다').toBeGreaterThan(4);
  const cx = cells.reduce((n, c) => n + c.x, 0) / cells.length;
  const cz = cells.reduce((n, c) => n + c.z, 0) / cells.length;
  const near = (ax: number, az: number): (typeof cells)[number] =>
    cells.reduce((b, c) =>
      Math.hypot(c.x - ax, c.z - az) < Math.hypot(b.x - ax, b.z - az) ? c : b,
    );
  const stand = near(cx, cz);
  await page.evaluate((c) => {
    const g = window.__wgd!;
    for (const a of g.sim.state.allies) {
      g.sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: c.x, cellZ: c.z });
    }
    g.ff(900);
    g.sim.state.prepTicksLeft = 1e9;
  }, { x: stand.x, z: stand.z });
  await page.waitForTimeout(200);

  /** 탭 직전 확인 — 그 점이 아직 판인가. 없으면 "터치가 안 먹는다"와 "HUD가 먹었다"가 안 갈린다 */
  const onCanvas = (px: number, py: number): Promise<string> =>
    page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.tagName ?? 'NONE', { x: px, y: py });

  // ① 탭 = 선택 (그 종족 전체)
  expect(await onCanvas(stand.px, stand.py), '설 칸이 HUD에 덮였다').toBe('CANVAS');
  await page.touchscreen.tap(stand.px, stand.py);
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => window.__wgd!.selectedAlly()),
    '터치로 부족원을 탭했는데 선택되지 않았다 (폰에서 조작 불능이다)',
  ).toBe('clubber');

  // ② 선택 중의 탭 = 명령. 그리고 **선택이 풀린다** — 안 풀리면 폰에서는 빈 곳 탭이
  //    전부 명령이라 선택을 풀 방법이 사라진다(placement.ts onCommand).
  const target = cells.reduce((b, c) =>
    Math.hypot(c.x - stand.x, c.z - stand.z) > Math.hypot(b.x - stand.x, b.z - stand.z) ? c : b,
  );
  expect(
    Math.hypot(target.x - stand.x, target.z - stand.z),
    '지금 서 있는 칸과 너무 가깝다 (명령을 관찰할 수 없다)',
  ).toBeGreaterThan(3);
  expect(await onCanvas(target.px, target.py), '보낼 칸이 HUD에 덮였다').toBe('CANVAS');
  await page.touchscreen.tap(target.px, target.py);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    sel: window.__wgd!.selectedAlly(),
    tgts: window.__wgd!.sim.state.allies.map((a) => ({ tgtX: a.tgtX, tgtZ: a.tgtZ })),
  }));
  expect(after.sel, '터치는 명령 뒤에 선택이 풀려야 한다').toBeNull();
  for (const g of after.tgts) {
    expect(g.tgtX, '터치 탭이 명령으로 해석되지 않았다').toBeCloseTo(target.x, 5);
    expect(g.tgtZ, '터치 탭이 명령으로 해석되지 않았다').toBeCloseTo(target.z, 5);
  }

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

/*
 * 채집이 그림에 무는 값을 **숨기지 않고 명시한다**.
 *
 * 왜 별도 계약인가: 바로 위 '아군 이동' 계약이 재는 것은 **이동**이고, 채집은 다른 기능이다.
 * 그런데 채집 게이지가 체력바 인스턴스 메시를 `count 0 → 1`로 켜므로, 아무것도 안 깎이는
 * **한가한 프레임**에서는 드로우콜이 하나 는다. 그 값을 이동 계약에 섞어 넣으면
 * (a) 이동 계약이 이동과 무관한 이유로 빨개지고 (b) 채집의 값은 **아무 데도 안 적힌다**.
 * 그래서 표본을 가르고 여기서 정면으로 잰다.
 *
 * ⚠ **정착값과 버스트를 반드시 갈라 재야 한다.** 처음 이 계약을 `maxFrame`(20프레임 최댓값)
 * 하나로 쓰자 Δ가 3으로 나왔고, 그 3을 그대로 문턱에 적었으면 **틀린 값이 계약이 될 뻔했다.**
 * 단발 측정과 60프레임 측정을 갈라 실측한 정체는 이렇다(desktop, 스테이지1):
 *   아무것도 없음 11 → 채집꾼 세워만 둠 12(+1 = **유닛 메시**, 채집과 무관)
 *   → 캐는 중 정착 **13(+1 = 채집 게이지)** → 캐기 시작 직후 최댓값 15(+2)
 * 마지막 +2는 새 층이 아니라 **이미 있는 연출 층**(파티클·숫자 스프라이트)이 잠깐 켜진 것이고,
 * 2.5초 뒤면 13으로 되돌아온다. 곧 채집이 무는 **영구 비용은 +1 하나**다.
 *
 * 잠그는 것 셋:
 *  · **정착 Δ ≤ 1** — 게이지 하나가 메시를 켜는 값. 이게 채집의 진짜 값이다.
 *    1을 넘으면 층이 는 것이므로 설계가 바뀐 것이고 반드시 다시 봐야 한다.
 *    ⚠ 표본 A는 **채집꾼을 이미 세워 둔 상태**여야 한다 — 안 그러면 유닛 메시 +1이
 *      채집 몫으로 잘못 적힌다(위 11 → 12가 그 함정이다).
 *  · **버스트도 예산 안** — 연출이 겹쳐도 90콜/150,000삼각형을 안 넘는다.
 *  · **최악 프레임(웨이브 중)이 예산 안** — 예산이 실제로 걸리는 자리다.
 */
test('채집: 영구 그림 값은 +1 (버스트와 갈라 잰다) · 전 구간 예산 안', async ({ page }) => {
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

  /*
   * ⚠ **통제**: 두 표본에서 부족원의 **자리가 같아야 한다.**
   * 처음 이 계약을 쓸 때 표본 A를 집결 지점(뭉쳐 있음), B를 자원 칸(흩어짐)으로 잡았다가
   * Δ 3을 얻었는데, 그 3에는 **자리가 달라서 생긴 몫**(그림자 패스·컬링)이 섞여 있었다.
   * 코드로 확인한 사실: 이번 변경이 더한 렌더 층은 `healthbars`의 InstancedMesh **하나**뿐이고
   * `decals`·`enemyview`는 새 메시가 0이다. 곧 Δ 3은 층 수가 아니라 통제 실패였다.
   * ⇒ 두 표본 다 **같은 자원 칸으로 흩어 보내고**, 캐느냐 아니냐만 가른다.
   *   (A는 `gatherPct`가 0인 종 = 못 캐는 사람을 같은 칸에 세운다)
   */
  await page.evaluate(() => window.__wgd!.setGold(99_999));

  // ── 표본 A: 같은 자리에 흩어져 있지만 **안 캔다** (전투 부족을 자원 칸에 세운다) ──
  const nA = await page.evaluate(() => {
    const g = window.__wgd!;
    let n = 0;
    while (g.canTrainAlly('clubber') && n < 6) {
      if (!g.trainAlly('clubber')) break;
      n++;
    }
    const cells = g.sceneryList();
    g.allies().forEach((a, i) => {
      const c = cells[i % cells.length]!;
      g.sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: c.x, cellZ: c.z });
    });
    g.ff(600);
    return n;
  });
  expect(nA, '부족원을 한 명도 못 뽑았다 (표본이 성립하지 않는다)').toBeGreaterThan(0);
  await page.evaluate(() => window.__wgd!.pause(true));
  await page.waitForTimeout(2_500); // 연출이 꺼질 시간 — 정착값을 잰다
  const idleOff = await maxFrame(page);
  await page.evaluate(() => window.__wgd!.pause(false));

  // 같은 판을 새로 시작해 표본 B를 같은 자리에서 잡는다
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => window.__wgd !== undefined);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__wgd!.setGold(99_999));
  const nGather = await page.evaluate(() => {
    const g = window.__wgd!;
    let n = 0;
    while (g.canTrainAlly('gatherer') && n < 6) {
      if (!g.trainAlly('gatherer')) break;
      n++;
    }
    return n;
  });
  expect(nGather, '채집꾼을 한 명도 못 뽑았다').toBeGreaterThan(0);

  // ── 표본 B: 같은 사람들이 실제로 캐는 중 ────────────────────────────────────
  const gathering = await page.evaluate(() => {
    const g = window.__wgd!;
    const cells = g.sceneryList();
    const xs = g.allies();
    xs.forEach((a, i) => {
      const c = cells[i % cells.length]!;
      g.sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: c.x, cellZ: c.z });
    });
    g.ff(600); // 걸어가서 캐기 시작할 시간
    return g.sim.state.allies.filter((a) => a.gatherKey >= 0).length;
  });
  expect(gathering, '아무도 안 캔다 (표본 B가 성립하지 않는다)').toBeGreaterThan(0);

  // 버스트 먼저 — 캐기 시작 연출이 켜져 있는 동안
  await page.evaluate(() => window.__wgd!.pause(true));
  await page.waitForTimeout(300);
  const burst = await maxFrame(page);
  const burstMsg = `버스트 ${JSON.stringify(burst)} (예산 90콜 / 150,000삼각형)`;
  expect(burst.calls, burstMsg).toBeLessThanOrEqual(90);
  expect(burst.tris, burstMsg).toBeLessThanOrEqual(150_000);

  // 그리고 **정착**을 기다려 진짜 영구 비용을 잰다 (연출이 꺼질 시간)
  await page.waitForTimeout(2_500);
  const idleOn = await maxFrame(page);
  await page.evaluate(() => window.__wgd!.pause(false));

  const idleMsg =
    `정착 프레임(자리 통제됨): 안 캠 ${nA}명 ${JSON.stringify(idleOff)}` +
    ` → 캐는 중 ${gathering}명 ${JSON.stringify(idleOn)} / 버스트 최댓값 ${burst.calls}콜`;
  expect(idleOn.calls - idleOff.calls, idleMsg).toBeLessThanOrEqual(1);

  // ── 표본 C: 최악 프레임 (웨이브 진행 중 = 체력바가 어차피 켜져 있다) ─────────
  await page.evaluate(() => {
    const g = window.__wgd!;
    g.callWave();
    g.ff(600);
  });
  await page.evaluate(() => window.__wgd!.pause(true));
  await page.waitForTimeout(300);
  const busy = await maxFrame(page);
  await page.evaluate(() => window.__wgd!.pause(false));

  const busyMsg = `최악 프레임 ${JSON.stringify(busy)} (예산 90콜 / 150,000삼각형)`;
  expect(busy.calls, busyMsg).toBeLessThanOrEqual(90);
  expect(busy.tris, busyMsg).toBeLessThanOrEqual(150_000);
  // 최악 프레임은 한가한 쪽보다 당연히 크다(적·투사체·체력바). 여기서 재는 것은
  // "채집이 그 위에 층을 더 얹지 않는다"이고, 그 증거는 위 **정착 Δ ≤ 1** 하나다.

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

/*
 * 채집이 **실제 빌드에서 돈다**는 것을 잠근다 — 여기까지 와야 기능이 산다.
 *
 * 왜 지금 생겼나: T6 이전에는 `GATHER_BASE_VALUE = 0` 이라 "골드가 늘었다"를 재는 어떤
 * 어서션도 **0과 0을 비교하는 실패 불가능한 계약**이었다. 값이 8로 켜진 지금이 이 계약이
 * 처음으로 뜻을 갖는 시점이다. 그 전까지 e2e 의 채집 항목은 드로우콜만 쟀다.
 *
 * 잠그는 것 넷 — 각각이 다른 것을 지킨다:
 *  ① **한 사이클이 실제로 돈다** — 보내면 걸어가 캐고 지고 와서 **골드가 는다**.
 *     단위 테스트는 목 스테이지에서 이걸 잠그지만, 실제 스테이지·실제 렌더·실제 번들에서
 *     같은 일이 나는지는 여기서만 안다.
 *  ② **탭이 없으면 코인도 없다** — 부족원을 뽑아만 두고 방치하면 골드가 한 톨도 안 는다.
 *     "방치하면 진다"(봉투 [5])의 e2e 쪽 거울이다. sim 테스트가 이미 잠그지만, 그 계약은
 *     **UI 가 자동 명령을 내지 않는다**까지는 못 본다 — 그건 실제 화면에서만 드러난다.
 *  ③ **다 캔 칸은 여전히 건설 불가**(D1) — 이 한 줄이 밸런스 전체를 떠받친다. 칸이 열리면
 *     `SCENERY_DENSITY 0.3` 이 정하는 건설 가능 칸 수가 바뀌어 봉투가 통째로 흔들린다.
 *  ④ **유료 제거 비용이 안 변한다** — 채집과 `clearScenery` 는 같은 칸에 붙는 별개의 동사다.
 */
test('채집: 한 사이클이 실제로 돈다 · 사람 없으면 0 · 캔 자리는 비고 다시 자란다', async ({ page }) => {
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

  // 자원 칸이 실제 스테이지에 있는가 (없으면 이 계약 전체가 무의미하다)
  const nRes = await page.evaluate(() => window.__wgd!.sim.state.resources.length);
  expect(nRes, '실제 스테이지에 자원 칸이 하나도 없다').toBeGreaterThan(0);

  // ── ② 먼저: 뽑아만 두고 방치하면 골드가 안 는다 ─────────────────────────────
  /*
   * ⚠ **골드 총액으로 재면 안 된다.** 60초를 굴리면 웨이브가 돌아 처치·웨이브 클리어
   * 수입이 들어온다 — 그건 채집과 무관한 돈이고, 실제로 처음 이 어서션을 총액으로 썼다가
   * +78 을 채집으로 오인했다. 채집만 골라 재는 관측량은 **텄음 칸 수**다:
   * 한 칸이 텄다는 것은 누군가 거기서 한 짐을 캤다는 것과 정확히 같고(gather.ts 의 유일한
   * `taken = true` 자리), 명령이 없으면 그 자리에 절대 도달할 수 없다.
   */
  /*
   * ⚠⚠ **이 계약은 자동 채집 도입으로 한 번 다시 쓰였다. 무엇이 바뀌었는지 정확히 적는다.**
   *
   * 예전 문장: "부족원을 **뽑아만 두고** 방치하면 한 칸도 안 텄다" (= 탭이 없으면 코인도 없다).
   * 그 문장은 이제 **거짓이고, 거짓인 것이 사양이다** — 사용자가 AoE 식 자동 일꾼을 요구했고
   * 일꾼은 명령 없이 스스로 캐러 나간다. 실제로 이 어서션이 자동을 정확히 잡아 빨개졌다.
   *
   * ⚠ 그래서 이 자리에서 어서션을 **지우거나 느슨하게 하면 안 된다.** 방치 안전성은 여전히
   * 게임의 뿌리 계약이고, 바뀐 것은 그 근거다:
   *      예전 근거: **탭이 없으면** 코인도 없다   (자동이 생겨 철회됐다)
   *      지금 근거: **사람이 없으면** 코인도 없다 (자동은 존재하는 아군에게만 붙는다)
   * 봉투 [5]("방치하면 웨이브 5 안에 진다")가 여전히 통과하는 이유가 정확히 이것이고,
   * `runIdle` 은 `callWave` 말고 어떤 커맨드도 안 내므로 아군이 판 내내 0명이다.
   * 아래 ⓐ 가 그 새 근거를 **e2e 에서 직접** 잠근다 — 더 약한 문장이 아니라 참인 문장이다.
   *
   * 그리고 ⓑ 로 **자동이 실제로 돈다**는 것도 같이 잠근다. ⓐ 만 두면 "자동을 통째로 지워도
   * 초록"인 실패 불가능한 계약이 되기 때문이다(이 저장소가 금지하는 형태다).
   */

  // ── ⓐ 사람을 한 명도 안 뽑으면 채집 수입은 정확히 0 (봉투 [5]의 e2e 거울) ──────
  const noAlly = await page.evaluate(() => {
    const g = window.__wgd!;
    g.setGold(5_000);
    // ⚠ trainAlly 를 **한 번도 부르지 않는다.** 이것이 이 표본의 전부다.
    g.sim.state.prepTicksLeft = 1e9; // 웨이브를 얼려 전투 수입을 차단한다
    const start = g.sim.state.gold;
    g.ff(1_800); // 60초
    return {
      start,
      gold: g.sim.state.gold,
      allies: g.sim.state.allies.length,
      taken: g.sim.state.resources.filter((r) => r.taken).length,
    };
  });
  expect(noAlly.allies, '아무도 안 뽑았는데 아군이 생겼다').toBe(0);
  expect(noAlly.taken, `사람이 없는데 ${noAlly.taken}칸이 텄다`).toBe(0);
  expect(noAlly.gold, `사람이 없는데 골드가 움직였다: ${noAlly.start} → ${noAlly.gold}`).toBe(noAlly.start);

  // ── ⓑ 사람을 뽑으면 **명령 없이도** 스스로 캔다 (사용자 항목 2·4) ──────────────
  const idle = await page.evaluate(() => {
    const g = window.__wgd!;
    g.trainAlly('gatherer');
    g.trainAlly('gatherer');
    const start = g.sim.state.gold;
    g.ff(1_800); // 60초 — 왕복이 두 번 넘게 들어가는 시간
    return {
      start,
      gold: g.sim.state.gold,
      allies: g.sim.state.allies.length,
      taken: g.sim.state.resources.filter((r) => r.taken).length,
      claimed: g.sim.state.allies.filter((a) => a.gatherKey >= 0).length,
    };
  });
  expect(idle.allies, '채집꾼이 안 뽑혔다').toBeGreaterThan(0);
  expect(idle.taken, '명령 없이 60초를 뒀는데 한 칸도 안 텄다 — 자동이 안 돈다').toBeGreaterThan(0);
  expect(idle.claimed + idle.taken, '아무도 칸을 잡지 않았다').toBeGreaterThan(0);
  expect(
    idle.gold,
    `자동으로 캤는데 배달이 없다: ${idle.start} → ${idle.gold} · 텄음 ${idle.taken}칸`,
  ).toBeGreaterThan(idle.start);

  // ── ① 보내면 한 사이클이 돈다 ──────────────────────────────────────────────
  const cycle = await page.evaluate(() => {
    const g = window.__wgd!;
    const cells = g.sim.state.resources.filter((r) => !r.taken);
    const before = g.sim.state.gold;
    // ⚠ **이미 텄던 칸의 값을 기준선으로 뺀다.** 위 ⓑ 에서 자동이 이미 여러 칸을 캐고
    //   지급까지 끝냈으므로, 마지막에 `taken` 전체를 세면 그 몫이 이 구간의 지급액과
    //   비교되어 언제나 어긋난다(실측: 텄음 24칸 값 285 대 지급 217 — 차 68이 ⓑ 몫이었다).
    //   재려는 것은 **이 구간에서 새로 턴 칸**이다.
    const beforeTakenValue = g.sim.state.resources
      .filter((r) => r.taken)
      .reduce((n, r) => n + r.value, 0);
    // 그리고 **지금 등에 지고 있는 짐**도 기준선이다 — ⓑ 에서 캐 놓고 아직 안 낸 몫이
    //   이 구간에 배달되면 그것도 지급액에 들어온다.
    const carriedBefore = g.sim.state.allies.reduce((n, a) => n + a.carryGold, 0);
    // 채집꾼 전원을 서로 다른 칸으로. carryCap 2 라 각자 두 칸을 채워야 귀환한다.
    const sent: { x: number; z: number }[] = [];
    g.sim.state.allies.forEach((a, i) => {
      const c = cells[i]!;
      sent.push({ x: c.cellX, z: c.cellZ });
      g.sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: c.cellX, cellZ: c.cellZ });
    });
    g.ff(1_200);
    // 짐을 채우러 두 번째 칸으로
    const rest = g.sim.state.resources.filter((r) => !r.taken);
    g.sim.state.allies.forEach((a, i) => {
      const c = rest[i];
      if (!c) return;
      sent.push({ x: c.cellX, z: c.cellZ });
      g.sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: c.cellX, cellZ: c.cellZ });
    });
    g.ff(2_400);
    const taken = g.sim.state.resources.filter((r) => r.taken);
    return {
      before,
      after: g.sim.state.gold,
      taken: taken.map((r) => ({ x: r.cellX, z: r.cellZ })),
      takenValue: taken.reduce((n, r) => n + r.value, 0) - beforeTakenValue,
      carriedBefore,
      carriedAfter: g.sim.state.allies.reduce((n, a) => n + a.carryGold, 0),
      carriedLeft: g.sim.state.allies.reduce((n, a) => n + a.carryCount, 0),
      sent,
    };
  });
  expect(cycle.taken.length, `아무 칸도 안 텄다 (보낸 칸 ${JSON.stringify(cycle.sent)})`).toBeGreaterThan(0);
  /*
   * 웨이브가 얼어 있으므로 골드 변화는 **전액 채집**이다. 그러면 이 구간에는 보존식이 선다:
   *
   *      지급액 = (이 구간에 새로 턴 칸의 값) + (시작 시 지고 있던 짐) − (끝에 지고 있는 짐)
   *
   * 등호로 잠그는 이유: 부등호(`> before`)로 두면 "조금이라도 늘었다"만 재고, 캔 값과
   * 지급액이 어긋나는 사고(중복 지급·누락·짐 증발)를 하나도 못 잡는다.
   * ⚠ 이 식을 두 번 틀렸다가 실측으로 고쳤다 — 처음엔 ⓑ 에서 이미 **지급까지 끝난** 칸을
   *   같이 세서 285 대 217 로 어긋났고(왼쪽이 큼), 그것만 빼자 이번엔 ⓑ 에서 **등에 지고
   *   있던** 짐이 이 구간에 배달되어 182 대 217 로 어긋났다(오른쪽이 큼). 두 기준선을
   *   모두 빼야 식이 닫힌다.
   */
  const paid = cycle.after - cycle.before;
  const expected = cycle.takenValue + cycle.carriedBefore - cycle.carriedAfter;
  expect(cycle.takenValue, '이 구간에 새로 턴 칸이 없다').toBeGreaterThan(0);
  expect(
    paid,
    `새로 턴 ${cycle.taken.length}칸 값 ${cycle.takenValue}` +
      ` + 시작 짐 ${cycle.carriedBefore} − 끝 짐 ${cycle.carriedAfter} = ${expected}` +
      ` 인데 지급은 ${paid} (${cycle.before} → ${cycle.after})`,
  ).toBe(expected);

  /*
   * ── ③ **캔 자리는 비고 건설 가능해진다** ─────────────────────────────────────
   *
   * ⚠⚠ **이 절은 정확히 뒤집혔다. 무엇이 왜 바뀌었는지 적는다.**
   *   옛 계약(D1): "다 캔 칸은 **그루터기로 남고 건설 불가**를 유지한다."
   *     근거는 `SCENERY_DENSITY = 0.3` 이 정하는 건설 가능 칸 수가 밸런스라는 것이었고,
   *     그 판정으로 봉투 [6](불도저)의 [치명] 위험을 없앴다.
   *   지금(사용자 재정의): "채집 후 있던 자원은 **사라져야 해**."
   *     소품이 사라지는데 못 짓게 두면 **안 보이는 장애물**이 된다 — 그게 더 나쁘다.
   *
   * ⚠ 그래서 이 어서션들을 **지우지 않고 부호를 뒤집었다.** 재는 대상은 같다
   *   ("캔 칸이 어떤 상태가 되는가"), 참인 답이 반대가 되었을 뿐이다.
   *   뒤집힌 대가는 감추지 않고 원장이 숫자로 든다 — `18.opened` 순열림 40.00.
   *
   * 그리고 **재생이 그 대가의 완화 장치**다: 열린 칸은 영구가 아니다(④).
   */
  const after = await page.evaluate((taken) => {
    const g = window.__wgd!;
    const c = taken[0]!;
    return {
      canPlace: g.sim.canPlaceAt(c.x, c.z),
      hasScenery: g.sim.hasScenery(c.x, c.z),
      cell: c,
    };
  }, cycle.taken);
  expect(after.canPlace, `캔 자리인데 아직 못 짓는다 (${JSON.stringify(after.cell)})`).toBe(true);
  expect(after.hasScenery, '캔 자리인데 소품이 그대로 있다 — 사라져야 한다').toBe(false);

  /*
   * ── ④ **다시 자란다. 단 타워를 지으면 영영 안 자란다** ──────────────────────
   * 이 두 줄이 이 기능이 만드는 **진짜 선택**이다: 지금 지을까(칸을 영구히 얻고 그 자원을
   * 태운다), 두고 계속 캘까(수입은 이어지지만 그 칸이 주기마다 다시 막힌다).
   * ⚠ 재생을 안 재면 "캔 자리가 빈다"만 남아 **자원이 유한하다는 성질만 확인**하게 된다.
   */
  const regrow = await page.evaluate((taken) => {
    const g = window.__wgd!;
    const wait = g.sim.state.resources.filter((r) => r.taken && r.regrowAt > 0);
    if (wait.length === 0) return { ok: false as const };
    const target = wait[0]!;
    // 다른 칸 하나에는 타워를 세워 재생권을 태운다 (R3)
    const burn = wait.length > 1 ? wait[1]! : null;
    let burnBuilt = false;
    if (burn) {
      g.setGold(99_999);
      burnBuilt = g.place(0, burn.cellX, burn.cellZ);
    }
    const need = target.regrowAt - g.sim.state.tick;
    g.ff(Math.max(1, need + 60));
    const t2 = g.sim.state.resources.find((r) => r.cellX === target.cellX && r.cellZ === target.cellZ)!;
    const b2 = burn
      ? g.sim.state.resources.find((r) => r.cellX === burn.cellX && r.cellZ === burn.cellZ)!
      : null;
    return {
      ok: true as const,
      grewBack: !t2.taken,
      canPlaceAfterRegrow: g.sim.canPlaceAt(target.cellX, target.cellZ),
      burnBuilt,
      burnedStillTaken: b2 ? b2.taken : null,
      burnedRegrowAt: b2 ? b2.regrowAt : null,
    };
  }, cycle.taken);
  expect(regrow.ok, '재생을 기다리는 칸이 하나도 없다 (표본이 성립하지 않는다)').toBe(true);
  if (regrow.ok) {
    expect(regrow.grewBack, '주기가 지났는데 다시 안 자랐다').toBe(true);
    expect(regrow.canPlaceAfterRegrow, '다시 자랐는데 아직 지을 수 있다 — 막혀야 한다').toBe(false);
    if (regrow.burnBuilt) {
      expect(regrow.burnedStillTaken, '타워를 지은 칸이 다시 자랐다 (R3 위반)').toBe(true);
      expect(regrow.burnedRegrowAt, '타워를 지은 칸의 재생권이 안 탔다 (R3 위반)').toBe(0);
    }
  }

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
  const cap1 = await page.evaluate(() => window.__wgd!.sim.allyCap());
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
   * 마을이 파는 네 번째 물건 — 9단계에 **출격 한계선에서 부족원 정원으로 바뀌었다.**
   *
   * 옛 판본은 `sim.allySortieRange()`가 커지고 `allySortiePoints()`의 정지 지점이
   * 기지에서 멀어지는 것을 쟀는데, 그 둘은 **함수째로 삭제됐다**(사용자가 "반경 제한 없이
   * 맵 어디든"으로 재정의 → sim/allies.ts 재정의 ④). 그러니 문턱을 낮출 것이 아니라
   * **선언을 다시 유도해야 한다**: 마을 레벨 칸이 파는 물건이 바뀌었을 뿐, "레벨업이
   * 아군을 실제로 키우고 그 사실이 결제 전에 화면에 숫자로 떠 있다"는 계약은 그대로다.
   * 새 선언은 셋이다 —
   *   ① 레벨업으로 정원이 실제로 커진다(sim이 확정한 값으로),
   *   ② 지금 성능 줄이 그 정원을 띄운다,
   *   ③ 미리보기 줄이 **다음 레벨의** 정원을 띄운다(지금 값도, 상수도 아니다).
   * ③이 있어야 옛 판본과 같은 판별력이 남는다: 패널이 정원 칸을 잃거나, 지금 값을
   * 다음 값이라고 우기면 그 자리에서 빨개진다.
   * (패널 문자열은 rAF 폴링으로 갱신되므로 재시도 어서션을 쓴다 — 한 번 읽고 끝내면
   *  결제 직후 한 프레임을 앞질러 읽어 옛 값을 보는 경합이 생긴다)
   */
  const cap2 = await page.evaluate(() => ({
    now: window.__wgd!.sim.allyCap(),
    next: window.__wgd!.sim.baseNextStats(),
  }));
  expect(cap2.now, `Lv2 정원 (Lv1은 ${cap1})`).toBeGreaterThan(cap1);
  expect(cap2.next, 'Lv2는 만렙이 아니므로 미리보기가 있다').not.toBeNull();
  expect(cap2.next!.allyCap, '미리보기 정원은 지금보다 크다').toBeGreaterThan(cap2.now);
  await expect
    .poll(() => tailNumber(panel.locator('.tp-sub--stats')), {
      message: '현재 성능 줄에 지금 정원이 없다',
    })
    .toBe(cap2.now);
  await expect
    .poll(() => tailNumber(panel.locator('.tp-sub').nth(1)), {
      message: '미리보기 줄이 다음 레벨 정원을 띄우지 않는다',
    })
    .toBe(cap2.next!.allyCap);

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
 *
 * ── 9단계(자유 이동 · 영구 아군) 뒤 재확인 ────────────────────────────────
 * 아군이 맵 어디로든 갈 수 있게 됐으니 **흩어진 부대가 새 최악 프레임 아닌가**를 먼저
 * 의심해야 한다. 같은 레시피(desktop 1280×800 · swiftshader · 타워 12기 · 적 56마리)로
 * 재면 아니다:
 *   집결 지점에 6명   **74콜 / 138,031삼각형**  (예산 90 / 150,000의 82% · 92%)
 *   판 전체로 흩뿌림   60콜 / 124,347           (아래로 내려간다)
 * 흩어짐이 예산을 사지 않는 이유는 아군이 애초에 절두체 컬링을 끄고 언제나 그려지고
 * (render/views/enemyview.ts) 인스턴스 개수도 그대로이기 때문이다 — 위치만 바뀐다.
 * 적 0·타워 0으로 통제한 깨끗한 A/B에서도 **0콜 / +156삼각형**이었다
 * (아래 '아군 이동 명령' 테스트 ④의 실측). 곧 이 개정으로 넘친 예산은 없다.
 * ⚠ 다만 흩어진 쪽 60콜은 **더 낮다고 믿을 수 있는 수가 아니다**: 걸어가는 900틱 동안
 * 습격대가 타워 몇 기를 부수므로(타워 1기당 약 3콜) 같은 구성이 아니다. 두 수의 비교가
 * 아니라 "흩어져도 74를 넘지 않는다"만 읽어야 한다.
 */
test('최악 프레임 예산 — 삼각형 150,000 / 드로우콜 상한', async ({ page }) => {
  /*
   * 이 테스트가 실제로 재는 것은 **스테이지1**이다 — 진입 동선이
   * `goto → click(100,300) → 전투`라 언제나 s1이다. s2~s6은 바로 아래
   * '스테이지별 최악 프레임 예산' 테스트가 같은 레시피(buildWorstFrame)로 따로 잰다.
   *
   * ── 스테이지별 실측 (desktop 1280×800 · swiftshader · 같은 레시피 · 3회 반복 중 최댓값) ──
   *    s1 76콜 / 131,483   s2 73콜 / 122,971   s3 76콜 / 137,991
   *    s4 75콜 / 134,380   s5 75콜 / 135,887   s6 73콜 / 134,069
   * **6판 전부 예산 안**이다. 최악은 s3으로 삼각형 150,000의 92.0%(여유 12,009),
   * 드로우콜 90의 84%(여유 14). 반복 간 흔들림은 삼각형 ±1,500 · 콜 ±2 남짓인데
   * 대부분 **비행 중인 투사체 몇 발**의 몫이다(레시피가 그걸 통제하지 않는다 — 통제하는
   * 것은 아래 아군 A/B 구간뿐이다). s2가 유독 낮은 것은 이 판에서 동시 생존이 49마리까지만
   * 차기 때문이다(다른 판은 60) — 스테이지가 가벼워서가 아니라 표본이 작다.
   *
   * ⚠ 이 표는 예전에 "s3~s6은 예산을 넘는다(160,212 / 151,959 / 154,598 / 150,360)"였다.
   * 그 값들은 **798d7ad 소품 개편 이전**이고 지금은 거짓이다 — 그 개편이 소품을 섀도
   * 캐스터에서 빼면서(propsMesh.castShadow = false) 스테이지당 1.6~2.7만 삼각형이
   * 회수됐다. 존재하지 않는 초과를 고치려 들지 마라. 다만 아래 사실은 여전히 유효하다:
   * 아군 6명의 몫은 5,800~7,700으로 스테이지에 무관하고(아군은 절두체 컬링을 꺼서 항상
   * 그려진다 — render/views/enemyview.ts frustumCulled = false), 이 구성은 '16종 흩기'라는
   * **합성 최악**이라 자연 편성보다 늘 무겁다.
   *
   * ── 재측정하는 법 ─────────────────────────────────────────────────────────
   * 예전 주석은 "진입 동선이 언제나 s1이라 s2~s6은 재측정하지 못했다"고 적어 두었지만,
   * 지금은 설정의 '모든 스테이지 열기'(settings.unlockAll)가 그 벽을 없앴다.
   * 동선은 아래 enterStageWithUnlockAll()이 그대로 보여 준다:
   *   로비 ⚙ → '모든 스테이지 열기' 스위치 → ← 로 로비 복귀 → 캐러셀 scrollLeft로 카드 이동 → 전투
   * 세이브를 손으로 심을 필요가 없다 — 심으려면 crc 봉투(core/save.ts)를 테스트가 다시
   * 구현해야 하고, 그 사본은 세이브 포맷이 바뀌는 날 조용히 틀려진다.
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

  const sample = (): Promise<{ calls: number; tris: number; proj: number }> => maxFrame(page, 30);

  const built = await buildWorstFrame(page);
  expect(built.towers, '타워 12기').toBeGreaterThanOrEqual(10);
  expect(built.enemies, '동시 생존 적').toBeGreaterThanOrEqual(40);
  expect(built.allies, '아군 정원').toBeGreaterThanOrEqual(6);

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
 * 설정의 '모든 스테이지 열기'를 **UI 그대로** 켠다 (로비 ⚙ → 스위치 → ← 로 복귀).
 *
 * localStorage에 세이브를 직접 심지 않는 이유: 그러려면 crc 봉투(core/save.ts)를 테스트가
 * 다시 구현해야 하고, 그 사본은 세이브 포맷이 바뀌는 날 조용히 틀려진다(테스트는 계속
 * 초록인 채로). 여기서는 실제 사용자가 누르는 경로를 그대로 밟으므로, 토글이 사라지거나
 * 라벨이 바뀌면 이 테스트가 먼저 빨개진다.
 * 호출 전제: 로비 화면일 것. 끝나면 다시 로비다.
 */
async function turnOnUnlockAll(page: Page): Promise<void> {
  await page.locator('.topbar .icon-btn').last().click(); // ⚙
  const sw = page.locator('.set-row', { hasText: '모든 스테이지 열기' }).getByRole('switch');
  await expect(sw, '설정에 「모든 스테이지 열기」 스위치가 없다').toHaveCount(1);
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.locator('.topbar .icon-btn').first().click(); // ← 로비로
  await page.waitForTimeout(300);
}

/**
 * 로비 캐러셀을 stageId 카드로 옮기고 전투에 들어간다.
 * 카드를 클릭해도 선택이 바뀌지 않는다 — 로비는 **캐러셀 스크롤 위치**로만 선택을 정한다
 * (ui/screens/lobby.ts의 scroll 리스너). 그래서 scrollLeft를 직접 세운다.
 * 화살표(◀▶)를 연타하는 방법도 있지만 smooth 스크롤이라 대기 시간이 기계 속도에 얹힌다.
 */
async function enterStageWithUnlockAll(page: Page, stageId: number): Promise<number | null> {
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300); // 타이틀 → 로비
  await page.waitForTimeout(400);
  await page.evaluate((idx) => {
    const car = document.querySelector('.carousel') as HTMLElement;
    const card = car.querySelectorAll<HTMLElement>('.stage-card')[idx]!;
    car.scrollLeft = card.offsetLeft - car.offsetLeft;
  }, stageId - 1);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => window.__wgd !== undefined);
  await page.waitForTimeout(900);
  // 정말 그 스테이지에 들어왔는지 — 캐러셀이 밀리면 조용히 s1을 6번 재게 된다
  return page.evaluate(
    () =>
      (window.__wgd!.sim as unknown as { ctx?: { opts?: { stage?: { id?: number } } } }).ctx?.opts
        ?.stage?.id ?? null,
  );
}

/**
 * **스테이지별 최악 프레임 예산** — 위 테스트가 s1만 재던 구멍을 메운다.
 *
 * 예전에는 "진입 동선이 언제나 s1이라 s2~s6은 잴 수 없다"고 주석에만 적혀 있었고, 그동안
 * 낡은 초과 목록(s3 160,212 …)이 근거처럼 인용됐다. 설정의 '모든 스테이지 열기'가 생기면서
 * 그 벽이 없어졌으므로 여기서 **실제로** 6판을 전부 잰다.
 *
 * 실측(desktop 1280×800 · swiftshader · 3회 반복 중 최댓값):
 *   s1 76콜 / 131,483   s2 73 / 122,971   s3 76 / 137,991
 *   s4 75 / 134,380     s5 75 / 135,887   s6 73 / 134,069
 * 최악 s3이 삼각형 예산의 92.0%. 한 판이 약 13초라 6판 + 로딩까지 **1.3분**이다
 * (이 컨테이너 실측). 매 판 실측값은 testInfo 애노테이션 '실측'으로 남는다 —
 * `--reporter=json` 으로 뽑으면 표를 다시 재지 않고도 그대로 읽을 수 있다.
 *
 * desktop에서만 돈다. 레시피의 뷰포트(1280×800)가 위 표의 전제이고, mobile-portrait에서
 * 한 벌 더 돌리면 **같은 판정을 2분 더 주고 사는 것**이라서다. 뷰포트가 바뀌면 컬링되는
 * 소품이 달라져 표와 나란히 읽을 수도 없다. 모바일 프레임 예산은 위 '최악 프레임 예산'
 * 테스트가 두 프로젝트 모두에서 계속 지킨다.
 */
test('스테이지별 최악 프레임 예산 — s1~s6 전부 삼각형 150,000 / 드로우콜 90', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '표의 전제인 1280×800에서만 잰다');
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.mouse.click(100, 300); // 타이틀 → 로비
  await page.waitForTimeout(400);
  await turnOnUnlockAll(page);

  const table: string[] = [];
  for (const stageId of [1, 2, 3, 4, 5, 6]) {
    const entered = await enterStageWithUnlockAll(page, stageId);
    expect(entered, `s${stageId}에 들어가려 했는데 s${entered}에 들어왔다`).toBe(stageId);

    const built = await buildWorstFrame(page);
    const worst = await maxFrame(page, 30);
    const msg = `s${stageId} ${JSON.stringify(worst)} 구성 ${JSON.stringify(built)}`;
    table.push(`s${stageId} ${worst.calls}콜 / ${worst.tris}`);

    // 구성이 실제로 서 있었는지 — 빈 판을 재고 초록이 뜨면 이 테스트는 공허하다
    expect(built.towers, msg).toBeGreaterThanOrEqual(10);
    expect(built.enemies, msg).toBeGreaterThanOrEqual(40);
    expect(built.allies, msg).toBeGreaterThanOrEqual(6);
    expect(worst.tris, msg).toBeGreaterThan(50_000);

    expect(worst.tris, msg).toBeLessThanOrEqual(150_000);
    expect(worst.calls, msg).toBeLessThanOrEqual(90);
    await page.evaluate(() => window.__wgd?.pause(false));
  }
  testInfo.annotations.push({ type: '실측', description: table.join(' · ') });
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
