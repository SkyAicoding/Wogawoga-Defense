/**
 * 아군 부족 유닛 — 마을에서 골드로 뽑아 판 위에 세우는 **영구** 전력 (src/sim/allies.ts 규칙 1~7).
 * 경제(비용/정원) · 집결과 자유 이동 · "수명으로는 죽지 않는다" · 봉쇄 · 스치는 타격 · 반격 · 타게팅.
 *
 * ══ 9단계에서 이 파일의 절반이 다시 쓰였다 ═════════════════════════════════
 * 사용자가 부족을 다시 정의하면서 8단계의 뼈대 셋(**경로 역주행 · 출격 한계선 · 20초 수명**)이
 * 통째로 없어졌다. 그것들을 잠그던 항목을 **지우지 않고 같은 층위의 새 선언으로 갈아 끼웠다** —
 * 규칙이 폐기됐다고 판별력까지 반납하면, 그 자리에 무엇이 잘못 들어와도 아무도 모른다.
 *  · 한계선 12건 → **자유 이동의 성질**: 집결 위치 / 목표 확정 / 직선 / 도착 정지 / 전원 이동 /
 *    격자 밖 거부 / 교전 중 정지 / **맵 어디든 간다**(사용자 지시 ④ — 이건 반드시 빨개져야 한다).
 *  · 수명 2건   → **대우 명제**: 빈 판에서 수천 틱을 살아 있고, 사라지는 길은 난투 하나뿐이다.
 *  · 상한 판정  → ALLY_MAX_ACTIVE 상수가 아니라 **마을 레벨의 함수**(hometown.allyCapFor).
 * 그리고 규칙 5-c(스치는 타격)를 재는 묶음이 통째로 새로 생겼다 — 아래 그 묶음 머리말 참조.
 *
 * ── 목 스테이지의 기하 (아래 전부의 출발점) ────────────────────────────────
 * 경로는 z=2 가로줄(x 0→9, 길이 9), 기지 (9,2), 격자 10×5.
 * 집결 지점 = 기지에서 **경로를 거슬러**(=적이 오는 -x 쪽) ALLY_MUSTER_FORWARD(1.4)만큼
 * 나온 자리 + 3열×2줄 대열(가로 간격 ALLY_MUSTER_SPACING 0.6 · 줄 간격
 * ALLY_MUSTER_ROW_GAP 0.6, **앞으로** 깊어진다). 실측 좌표는 이렇다:
 *     1번 (7.6, 2.6) · 2번 (7.6, 2.0) · 3번 (7.6, 1.4)
 *     4번 (7.0, 2.6) · 5번 (7.0, 2.0) · 6번 (7.0, 1.4)
 * 아군은 **명령을 받기 전에는 여기서 한 걸음도 움직이지 않는다**. 그래서 교전을 재는 항목은
 * 대부분 "적이 집결 지점까지 걸어온다"를 기다린다 — 속도 1이면 실측 206틱에 봉쇄가 선다.
 */
import { describe, expect, it } from 'vitest';
import type {
  AllyId,
  AllyState,
  BattleSim,
  EnemyDef,
  EnemyState,
  SimEvent,
  TowerAttackSpec,
} from '@/data/types';
import {
  ALLY_BLOCK_CAPACITY,
  ALLY_MUSTER_COLS,
  ALLY_MUSTER_FORWARD,
  ALLY_MUSTER_SPACING,
  BRAWL_BRUSH_RANGE,
  allyCostFor,
  enemyBrawlDmgFor,
} from '@/data/balance';
import { createBattle } from '@/sim/battle';
import { ALLY_HEAL_BASE_CAP_FRAC } from '@/data/balance';
import {
  allyDefs,
  baseLevels,
  enemyDefs,
  eventsOf,
  options,
  runTicks,
  stageDef,
  towerDefs,
  wave,
} from './fixtures';

/** 규칙 5-c 묶음은 **틱 단위로** 피격을 세야 해서(한 틱에 두 대인지) 손으로 모은다 */
type AllyDamagedEvent = Extract<SimEvent, { type: 'allyDamaged' }>;

/** 적을 죽이지 못하는 타워 — 관찰 대상(공성/봉쇄)만 남기려고 화력을 지운다 */
function tinyTier(): { dmg: number; cooldownTicks: number; range: number; cost: number } {
  return { dmg: 0.0001, cooldownTicks: 600, range: 0.2, cost: 50 };
}

/**
 * "적이 없는 판"을 만드는 스폰 지연. prep은 150틱이면 저절로 끝나므로, 이게 없으면
 * 걷는 거리를 재는 도중에 적이 나와 아군이 교전에 들어가고 무엇을 쟀는지 알 수 없어진다.
 */
const NO_ENEMIES = 100_000;

interface Opts {
  /** 적 정의 덮어쓰기 (raptor 하나만 쓴다) */
  enemy?: Partial<EnemyDef>;
  /** 적 마릿수 */
  count?: number;
  /** 아군 정의 덮어쓰기 */
  ally?: Partial<Parameters<typeof allyDefs>[0]>;
  gold?: number;
  /** 1번 웨이브 스폰 지연 틱 — NO_ENEMIES면 판이 계속 비어 있다 */
  delay?: number;
  /**
   * 마을 레벨별 **부족원 정원**. 목 표의 기본값은 전 레벨 절대 상한이라(fixtures.ts 주석),
   * 정원 자체를 재는 항목만 여기서 흔든다.
   */
  caps?: number[];
}

function allySim(o: Opts = {}): BattleSim {
  return createBattle(
    options({
      deck: ['spear'],
      stage: stageDef({ startGold: o.gold ?? 100000, baseHp: 9999, waveCount: 3 }),
      enemyDefs: enemyDefs({ raptor: { hp: 1_000_000, ...o.enemy } }),
      towerDefs: towerDefs({ spear: { tiers: Array.from({ length: 5 }, () => tinyTier()) } }),
      allyDefs: allyDefs(o.ally),
      ...(o.caps ? { baseLevels: baseLevels(o.caps.map((c) => ({ allyCap: c }))) } : {}),
      waves: [
        wave([
          { enemyId: 'raptor', count: o.count ?? 1, intervalTicks: 0, delayTicks: o.delay ?? 0 },
        ]),
        wave([{ enemyId: 'raptor', count: 1, intervalTicks: 0 }]),
      ],
    }),
  );
}

function train(sim: BattleSim, defId: AllyId = 'clubber'): boolean {
  return sim.applyCommand({ type: 'trainAlly', defId });
}

/** 이동 명령 — 기본은 살아 있는 **전원**(allyId -1) */
function order(sim: BattleSim, cellX: number, cellZ: number, allyId = -1): boolean {
  return sim.applyCommand({ type: 'moveAlly', allyId, cellX, cellZ });
}

/**
 * 아군 하나를 그 자리에서 쓰러뜨린다 (회수는 다음 틱의 사망 처리 단계가 한다).
 * 9단계에는 인원이 줄어드는 길이 **죽음뿐**이라, 8단계에 수명 만료로 만들던 상황을
 * 이제 이걸로 만든다. 난투로 진짜 죽이는 경로는 따로 잠근다('수명이 없다' 묶음).
 */
function kill(a: AllyState): void {
  a.hp = 0;
  a.alive = false;
}

/** 목 스테이지의 소품이 걸리면 먼저 치우고 배치 */
function place(sim: BattleSim, x: number, z: number, handIndex = 0): void {
  if (sim.hasScenery(x, z)) {
    expect(sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z })).toBe(true);
  }
  expect(sim.applyCommand({ type: 'placeTower', handIndex, cellX: x, cellZ: z })).toBe(true);
}

/** 좌표 비교용 반올림 (부동소수 꼬리 제거) */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
describe('출동 경제 (규칙 4·8)', () => {
  it('골드가 실제로 빠지고 allyTrained가 집결 지점에서 나간다', () => {
    const sim = allySim({ gold: 1000 });
    const before = sim.state.gold;
    const cost = sim.allyCost('clubber');
    expect(cost).toBe(50); // 목 정의 기본가, 나가 있는 인원 0
    expect(train(sim)).toBe(true);
    expect(sim.state.gold).toBe(before - cost);
    const ev = eventsOf(sim.drainEvents(), 'allyTrained');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.defId).toBe('clubber');
    expect(ev[0]!.cost).toBe(cost);
    // 이벤트가 실어 보내는 좌표가 곧 홈타운 앞 집결 지점이다 — 연출이 기지 셀이 아니라
    // 마을 문 앞에서 터져야 하고, 그 값의 출처가 시뮬레이션 하나뿐이어야 한다
    expect(ev[0]!.x).toBeCloseTo(7.6, 5);
    expect(ev[0]!.z).toBeCloseTo(2.6, 5);
    expect(sim.state.allies).toHaveLength(1);
  });

  it('골드가 모자라면 거부되고 아무것도 소비하지 않는다', () => {
    const sim = allySim({ gold: 10 });
    expect(sim.canTrainAlly('clubber')).toBe(false);
    expect(train(sim)).toBe(false);
    expect(sim.state.gold).toBe(10);
    expect(sim.state.allies).toHaveLength(0);
  });

  it('비용은 나가 있는 인원 수에 따라 오르고, 줄면 되돌아온다', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    const base = sim.allyCost('clubber');
    expect(train(sim)).toBe(true);
    expect(sim.allyCost('clubber')).toBe(allyCostFor(base, 1));
    expect(sim.allyCost('clubber')).toBeGreaterThan(base);
    expect(train(sim)).toBe(true);
    expect(sim.allyCost('clubber')).toBe(allyCostFor(base, 2));
    // 인원이 줄면 비용도 되돌아온다. 8단계에는 그 계기가 수명 만료였는데 이제는
    // **죽음뿐**이다 — 비용 곡선이 "지금 나가 있는 인원"만 보는 성질 자체는 그대로다
    kill(sim.state.allies[0]!);
    runTicks(sim, 1);
    expect(sim.state.allies).toHaveLength(1);
    expect(sim.allyCost('clubber')).toBe(allyCostFor(base, 1));
  });

  /**
   * 규칙 4) **정원이 마을 레벨의 함수다** — 9단계에 상한 판정이 통째로 옮겨간 자리다.
   * 8단계에는 ALLY_MAX_ACTIVE 상수 하나였고, 마을 레벨은 출격 한계선을 팔고 있었다.
   * 한계선이 없어지면서 그 칸을 정원이 물려받았으므로(BaseLevelDef.allyCap),
   * 여기서는 **레벨 표를 흔들면 상한이 따라 흔들리는가**를 본다.
   */
  it('정원은 마을 레벨이 정한다 (골드가 남아도 그 수에서 막힌다)', () => {
    const sim = allySim({ caps: [2, 4, 4] });
    expect(sim.allyCap()).toBe(2);
    expect(train(sim)).toBe(true);
    expect(train(sim)).toBe(true);
    expect(sim.state.allies).toHaveLength(2);
    expect(sim.state.gold).toBeGreaterThan(sim.allyCost('clubber')); // 돈은 남아 있다
    expect(sim.canTrainAlly('clubber')).toBe(false);
    expect(train(sim)).toBe(false);
    expect(sim.state.allies).toHaveLength(2);
  });

  it('마을을 올리면 정원이 늘어 한 명 더 나간다 (한계선이 서 있던 칸)', () => {
    const sim = allySim({ caps: [2, 4, 4] });
    // 비가역 결제라 **사기 전에** 무엇이 늘어나는지 화면에 있어야 한다
    expect(sim.baseNextStats()!.allyCap).toBe(4);
    expect(train(sim)).toBe(true);
    expect(train(sim)).toBe(true);
    expect(train(sim)).toBe(false);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(sim.allyCap()).toBe(4);
    expect(sim.canTrainAlly('clubber')).toBe(true);
    expect(train(sim)).toBe(true);
    expect(sim.state.allies).toHaveLength(3);
  });

  /**
   * 8단계에는 "수명이 다해 한 명이 돌아가면 자리가 난다"였다. 영구화로 그 계기가
   * 사라졌으므로 **자리를 비우는 유일한 길**을 대신 잠근다 — 죽는 것.
   * 이게 없으면 정원이 곧 영구 벽이 되고, 규칙 3의 "정원이 수명을 대신한다"가 거짓말이 된다.
   */
  it('정원이 차도 한 명이 쓰러지면 그 자리가 열린다', () => {
    const sim = allySim({
      caps: [1, 1, 1],
      enemy: { speed: 1, brawl: { dmg: 500, cooldownTicks: 10 } },
      ally: { clubber: { hp: 60 } },
    });
    expect(train(sim)).toBe(true);
    expect(sim.canTrainAlly('clubber')).toBe(false); // 정원 1이 찼다
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 300); // 적이 집결 지점까지 걸어와 난투로 쓰러뜨린다
    expect(eventsOf(evs, 'allyDied')).toHaveLength(1);
    expect(sim.state.allies).toHaveLength(0);
    expect(sim.canTrainAlly('clubber')).toBe(true);
  });

  /**
   * **난투에도 공격 동작이 실린다** — 사용자 지적:
   *   > "공룡 옆에 우리 주민이 가까이 가면 그냥 죽어 버리는데 닫는다고 죽으면 안되고,
   *   >  공룡이 자기를 공격하는 주민에게 공격하는 애니매이션을 하고 주민을 죽어야 해."
   *
   * 판정은 한 줄도 안 바뀌었다(피해·쿨다운·대상 선택 전부 그대로). 없던 것은
   * **화면이 그 판정을 말할 근거**다: 난투는 `towerTargetId` 도 `gateTicks` 도 안 쓰므로
   * 뷰의 어떤 채널에도 안 걸려 있었고, 그래서 공룡이 미동도 없이 서 있는데 주민만 죽었다.
   * 이제 습격대가 타워를 칠 때 쓰는 그 카운터(`attackAnimLeft`)를 난투도 채운다.
   *
   * ⚠ 이 값은 `battle.ts hash()` 가 접는다 — 연출 전용이지만 **타격 시점의 파생값**이라
   *   여기가 갈리면 판정도 갈렸다는 뜻이다. 곧 이 계약은 결정론 표면도 함께 잠근다.
   */
  it('난투로 때릴 때 공격 동작 카운터가 실린다 (주민이 소리 없이 죽지 않는다)', () => {
    const sim = allySim({
      caps: [1, 1, 1],
      enemy: { speed: 1, brawl: { dmg: 1, cooldownTicks: 20 } },
      ally: { clubber: { hp: 9999 } }, // 안 죽어야 여러 번의 난투를 관찰할 수 있다
    });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    let sawAnim = false;
    let sawHit = false;
    for (let i = 0; i < 400; i++) {
      sim.tick();
      for (const ev of sim.drainEvents()) if (ev.type === 'allyDamaged') sawHit = true;
      // 난투가 실제로 일어난 판에서, 어느 프레임에는 동작이 재생 중이어야 한다
      if (sim.state.enemies.some((e) => e.attackAnimLeft > 0)) sawAnim = true;
    }
    expect(sawHit, '난투가 한 번도 안 일어났다 — 이 계약이 공허하다').toBe(true);
    expect(sawAnim, '주민을 때리는데 공격 동작이 하나도 안 실렸다').toBe(true);
  });

  it('전투가 끝나면 출동할 수 없다', () => {
    const sim = allySim();
    (sim.state as { phase: string }).phase = 'lost';
    expect(sim.canTrainAlly('clubber')).toBe(false);
    expect(train(sim)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
/**
 * 규칙 1·2) **홈타운 앞 집결 + 자유 이동.**
 *
 * 8단계에는 이 자리에 '역주행과 출격 한계선' 12건이 있었다. 규칙이 폐기됐다고 그 12건을
 * 지우면 이 기능에서 가장 크게 바뀐 부분이 **무주공산**이 된다. 그래서 같은 층위의 질문으로
 * 갈아 끼웠다: 어디서 태어나는가 / 명령이 목표를 박는가 / 어떻게 가는가 / 도착하면 무엇을
 * 하는가 / 누구에게 가는가 / 무엇을 거부하는가 / 언제 안 움직이는가 / **어디까지 갈 수 있는가**.
 *
 * 마지막 항목("맵 어디든")은 사용자가 명시적으로 지시한 것이라 특히 못 박아 둔다 —
 * 반경 제한은 이 게임에서 두 번 사라진 적이 없고, 다시 들어오면 여기가 빨개져야 한다.
 */
describe('홈타운 앞 집결과 자유 이동 (규칙 1·2)', () => {
  it('기지 셀이 아니라 그 앞에서 태어나고, 명령 전에는 그 자리를 지킨다', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(train(sim)).toBe(true);
    const a = sim.state.allies[0]!;
    // 경로가 +x라 "앞"은 -x다. 그 방향을 경로에서 뽑는다는 것이 규칙 1의 핵심 —
    // 기지 셀 좌표만으로는 어느 쪽이 적이 오는 쪽인지 알 수 없다
    expect(a.x).toBeLessThan(9);
    expect(9 - a.x).toBeCloseTo(ALLY_MUSTER_FORWARD, 5);
    expect(a.z - 2).toBeCloseTo(ALLY_MUSTER_SPACING, 5); // 3열 대열의 한쪽 끝
    expect(Math.cos(a.heading)).toBeCloseTo(-1, 5); // 적이 오는 쪽을 본다
    // 태어난 자리가 곧 목표다 — 8단계처럼 저절로 걸어 나가지 않는다
    expect(a.tgtX).toBeCloseTo(a.x, 5);
    expect(a.tgtZ).toBeCloseTo(a.z, 5);
    runTicks(sim, 300);
    expect(a.walked).toBe(0);
    expect(a.x).toBeCloseTo(7.6, 5);
    expect(a.z).toBeCloseTo(2.6, 5);
  });

  it('여섯이 3열×2줄로 벌려 선다 (충돌이 없어 안 벌리면 한 점에 겹친다)', () => {
    const sim = allySim({ delay: NO_ENEMIES, caps: [6, 6, 6] });
    for (let i = 0; i < 6; i++) expect(train(sim)).toBe(true);
    const spots = sim.state.allies.map((a) => [r3(a.x), r3(a.z)]);
    // 실측 좌표 — 헤더의 표와 같은 값이고, 대열 규칙이 바뀌면 여기가 먼저 빨개진다
    // ⚠ 뒷줄은 마을이 아니라 **앞**으로 깊어진다 (x = 9 − (1.4 + 0.6) = 7.0).
    //   옛 표는 8.2 = 마을 쪽 0.8 이었고, 그 자리는 문간선(당시 1.67~2.25 · 지금은
    //   `edge + restReach` = 1.85~2.99)에 근접 사거리로
    //   닿지 않아 정원을 늘려도 붙잡을 것이 안 남았다 — 유도는 balance.ts
    //   `ALLY_MUSTER_ROW_GAP` 주석(봉투 [11-b] 재유도).
    expect(spots).toEqual([
      [7.6, 2.6],
      [7.6, 2],
      [7.6, 1.4],
      [7, 2.6],
      [7, 2],
      [7, 1.4],
    ]);
    // 줄(=기지에서의 거리)은 둘, 열은 ALLY_MUSTER_COLS개, 그리고 겹치는 자리는 없다
    expect(new Set(spots.map((s) => s[0])).size).toBe(2);
    expect(new Set(spots.map((s) => s[1])).size).toBe(ALLY_MUSTER_COLS);
    expect(new Set(spots.map((s) => s.join(','))).size).toBe(6);
  });

  /**
   * ⚠⚠ **이 항목의 부호가 하나 뒤집혔다.** 옛 계약은 "전원이 **셀 중심**에 목표를 박는다"
   *   였는데, 그것이 곧 사용자가 지적한 결함이었다: "한꺼번에 선택한 뒤 위치를 찍으면
   *   애들이 걸어가서 한곳에 다 멈춰. 겹쳐지잖아." 유닛 충돌이 없는 설계라 같은 점을
   *   주면 **전원이 포개져 한 명처럼 보인다.**
   *   지금은 `spreadSlot` 이 순번대로 벌린다 — 첫 사람은 찍은 자리 그대로(한 명만
   *   보내면 정확히 그 자리다), 나머지는 육각 고리로 나간다.
   *   ⚠ 이벤트(`allyOrdered`)는 **여전히 찍은 칸**을 싣는다 — 화면의 목표 표식은
   *     "여기로 가라"는 명령을 그리는 것이지 각자의 발자국이 아니다.
   */
  it('moveAlly가 전원을 보내되 **겹치지 않게** 벌린다 · allyOrdered는 찍은 칸을 싣는다', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    for (let i = 0; i < 3; i++) expect(train(sim)).toBe(true);
    sim.drainEvents();
    expect(order(sim, 4, 1)).toBe(true);
    const ev = eventsOf(sim.drainEvents(), 'allyOrdered');
    expect(ev).toHaveLength(1);
    // allyId -1 = 살아 있는 전원. 여섯을 한 명씩 찍게 하면 급할 때 여섯 번을 눌러야 한다
    expect(ev[0]!.count).toBe(3);
    expect(ev[0]!.cellX).toBe(4);
    expect(ev[0]!.cellZ).toBe(1);
    const tgts = sim.state.allies.map((a) => [r3(a.tgtX), r3(a.tgtZ)] as const);
    // ① 첫 사람은 찍은 자리 그대로 — 한 명만 보내면 정확히 그 칸이다
    expect(tgts[0]).toEqual([4, 1]);
    // ② 목표가 **전부 다르다** (이것이 이 항목의 본문이다)
    expect(new Set(tgts.map((t) => t.join(','))).size).toBe(3);
    // ③ 서로 반경 합보다 멀다 = 메시가 안 겹친다. 가장 큰 아군 반경이 0.3 이다
    for (let i = 0; i < tgts.length; i++) {
      for (let j = i + 1; j < tgts.length; j++) {
        const d = Math.hypot(tgts[i]![0] - tgts[j]![0], tgts[i]![1] - tgts[j]![1]);
        expect(d, `${i}번과 ${j}번이 겹친다`).toBeGreaterThanOrEqual(0.6);
      }
    }
    // ④ 그래도 찍은 자리 **근처**다 — 벌린다고 딴 데로 가면 명령이 아니다
    for (const t of tgts) expect(Math.hypot(t[0] - 4, t[1] - 1)).toBeLessThanOrEqual(1);
  });

  it('allyId를 찍으면 그 한 명만 움직인다', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(train(sim)).toBe(true);
    expect(train(sim)).toBe(true);
    const [a, b] = sim.state.allies;
    sim.drainEvents();
    expect(order(sim, 0, 0, a!.id)).toBe(true);
    expect(eventsOf(sim.drainEvents(), 'allyOrdered')[0]!.count).toBe(1);
    runTicks(sim, 400);
    expect(a!.x).toBeCloseTo(0, 5);
    expect(a!.z).toBeCloseTo(0, 5);
    expect(b!.walked).toBe(0); // 나머지는 제자리
  });

  it('찍은 셀까지 직선으로 간다 (경로를 따라가지 않는다)', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(train(sim)).toBe(true);
    const a = sim.state.allies[0]!;
    const sx = a.x;
    const sz = a.z;
    expect(order(sim, 1, 0)).toBe(true);
    // 매 틱 위치가 출발점→목표 선분 위에 있는가(외적 0). 경로(z=2)를 탔거나 축별로
    // 움직였다면 곧바로 벌어진다. 실측 최대 이탈 8.9e-14 = 부동소수 잡음뿐
    for (let t = 0; t < 250; t++) {
      runTicks(sim, 1);
      const cross = (a.x - sx) * (0 - sz) - (a.z - sz) * (1 - sx);
      expect(Math.abs(cross)).toBeLessThan(1e-9);
    }
    expect(a.x).toBeCloseTo(1, 5);
    expect(a.z).toBeCloseTo(0, 5);
    // 걸은 거리가 곧 직선 길이다 — 돌아가지도, 지나쳤다 되돌아오지도 않았다
    expect(a.walked).toBeCloseTo(Math.hypot(sx - 1, sz - 0), 5);
  });

  it('도착하면 선다 (목표 주위를 진동하지 않는다)', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(train(sim)).toBe(true);
    expect(order(sim, 1, 0)).toBe(true);
    runTicks(sim, 250);
    const a = sim.state.allies[0]!;
    const at = { x: a.x, z: a.z, walked: a.walked };
    runTicks(sim, 120);
    // 한 걸음도 더 걷지 않는다. walked까지 보는 이유: 좌표만 보면 목표를 사이에 두고
    // ±ε로 왕복해도 "같은 자리"로 보인다 (ARRIVE_EPS2가 사려는 것이 정확히 그것이다)
    expect(a.x).toBe(at.x);
    expect(a.z).toBe(at.z);
    expect(a.walked).toBe(at.walked);
    expect(a.prevX).toBe(a.x);
    expect(a.prevZ).toBe(a.z);
  });

  /**
   * **사용자 재정의 ④ — 반경 제한 없이 맵 어디든.**
   * 8단계라면 이 아군은 dist 3(=셀 (3,2))에서 멈춰 섰다. 지금은 적이 스폰하는 칸까지 간다.
   * 건설 불가 셀(경로)을 목표로 받는다는 것도 여기서 함께 잠근다 — 두 판정이 서로 다른
   * 질문("여기 지을 수 있나" 대 "여기로 갈 수 있나")이라는 것이 규칙 2의 명시적 결정이다.
   */
  it('맵 어디든 간다 — 적 스폰 칸도, 타워를 못 짓는 칸도 찍힌다', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(train(sim)).toBe(true);
    expect(sim.canPlaceAt(0, 2)).toBe(false); // 경로 셀 = 건설 불가
    expect(order(sim, 0, 2)).toBe(true); // 그래도 갈 수는 있다
    runTicks(sim, 400);
    const a = sim.state.allies[0]!;
    expect(a.x).toBeCloseTo(0, 5);
    expect(a.z).toBeCloseTo(2, 5);
    expect(a.walked).toBeCloseTo(Math.hypot(7.6, 0.6), 5);
  });

  it('격자 밖은 거부한다 (판 밖은 자리가 아니라 없는 칸이다)', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(train(sim)).toBe(true);
    const a = sim.state.allies[0]!;
    const tgt = { x: a.tgtX, z: a.tgtZ };
    sim.drainEvents();
    expect(order(sim, 10, 2)).toBe(false); // gridW 10 → x는 9까지
    expect(order(sim, -1, 2)).toBe(false);
    expect(order(sim, 3, 5)).toBe(false); // gridH 5 → z는 4까지
    expect(order(sim, Number.NaN, 2)).toBe(false);
    expect(eventsOf(sim.drainEvents(), 'allyOrdered')).toHaveLength(0);
    expect(a.tgtX).toBe(tgt.x); // 거부는 상태를 하나도 건드리지 않는다
    expect(a.tgtZ).toBe(tgt.z);
    expect(order(sim, 9, 4)).toBe(true); // 가장자리 셀은 통과 (경계 = 격자 그대로)
  });

  it('대상이 하나도 없으면 거부한다 (연출도 안 난다)', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(order(sim, 3, 3)).toBe(false); // 아직 아무도 안 나갔다
    expect(train(sim)).toBe(true);
    sim.drainEvents();
    expect(order(sim, 3, 3, 999)).toBe(false); // 없는 id
    expect(eventsOf(sim.drainEvents(), 'allyOrdered')).toHaveLength(0);
  });

  it('교전 중인 근접 아군은 명령을 받아도 그 자리에 선다 (붙잡은 적을 놓지 않는다)', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 250); // 실측 206틱에 봉쇄가 선다
    const a = sim.state.allies[0]!;
    expect(a.targetId).toBeGreaterThanOrEqual(0);
    expect(sim.state.enemies[0]!.blockerAllyId).toBe(a.id);
    const held = { x: a.x, z: a.z };
    // 명령 자체는 **받는다** — 거부하면 "왜 안 가지"를 화면에서 설명할 방법이 없다.
    // 목표만 갈아 끼우고, 교전이 끝나면 그때 걷기 시작한다
    expect(order(sim, 0, 2)).toBe(true);
    expect(a.tgtX).toBe(0);
    runTicks(sim, 60);
    expect(a.x).toBe(held.x);
    expect(a.z).toBe(held.z);
    expect(a.walked).toBe(0);
  });

  it('걸은 거리는 앞뒤로 오가도 줄지 않는다 (보행 위상의 출처)', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(train(sim)).toBe(true);
    const a = sim.state.allies[0]!;
    expect(order(sim, 2, 2)).toBe(true);
    runTicks(sim, 200);
    const out = a.walked;
    expect(out).toBeGreaterThan(5);
    // 왔던 길을 되짚는다. 8단계의 경로 호장 dist였다면 여기서 값이 **줄어들어**
    // 렌더의 다리가 거꾸로 돌았다 — walked는 방향과 무관하게 언제나 는다
    expect(order(sim, 8, 2)).toBe(true);
    runTicks(sim, 200);
    expect(a.walked).toBeGreaterThan(out);
    expect(a.x).toBeCloseTo(8, 5);
  });

  it('바라보는 방향이 실제 이동 방향을 따라 돈다', () => {
    const sim = allySim({ delay: NO_ENEMIES });
    expect(train(sim)).toBe(true);
    const a = sim.state.allies[0]!;
    expect(Math.cos(a.heading)).toBeCloseTo(-1, 5); // 태어날 때는 적이 오는 쪽
    expect(order(sim, 2, 2)).toBe(true);
    runTicks(sim, 200);
    expect(Math.cos(a.heading)).toBeLessThan(0); // 아직 -x 쪽으로 갔다
    expect(order(sim, 8, 2)).toBe(true); // 마을 쪽으로 되돌린다
    runTicks(sim, 30);
    expect(Math.cos(a.heading)).toBeCloseTo(1, 5); // 그대로 뒤를 본다
  });
});

// ---------------------------------------------------------------------------
/**
 * 규칙 3) **수명은 없다.**
 *
 * 8단계에는 여기에 "수명이 다하면 마을로 돌아간다(allyRetired)" 2건이 있었다. 사용자가
 * "자동으로 죽는 로직은 없애줘"로 규칙을 걷어냈으므로 그 2건을 **대우로 뒤집었다**:
 * 시간으로는 절대 안 사라지고, 사라지는 길은 hp가 0이 되는 것 하나뿐이다.
 * 이 두 항목이 없으면 수명이 다른 이름으로 되살아나도(자동 소멸·감쇠·비용 회수 타이머)
 * 아무 데서도 빨개지지 않는다.
 */
describe('수명이 없다 — HP가 다할 때만 죽는다 (규칙 3)', () => {
  it('빈 판에서 수천 틱을 돌려도 아무도 사라지지 않는다', () => {
    const sim = allySim({ delay: NO_ENEMIES, caps: [3, 3, 3] });
    const base = sim.allyCost('clubber');
    for (let i = 0; i < 3; i++) expect(train(sim)).toBe(true);
    const evs = runTicks(sim, 5000); // 8단계 수명(600틱)의 8배가 넘는다
    expect(sim.state.allies).toHaveLength(3);
    for (const a of sim.state.allies) expect(a.hp).toBe(a.maxHp);
    expect(eventsOf(evs, 'allyDied')).toHaveLength(0);
    // 비용도 그대로 = 인원이 한 명도 안 줄었다는 같은 사실의 다른 창구
    expect(sim.allyCost('clubber')).toBe(allyCostFor(base, 3));
  });

  it('사라지는 길은 난투 하나뿐이다 (그래서 봉쇄가 영원히 굳지 않는다)', () => {
    const sim = allySim({
      enemy: { speed: 1, brawl: { dmg: 30, cooldownTicks: 15 } },
      ally: { clubber: { hp: 60 } },
    });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 300);
    const died = eventsOf(evs, 'allyDied');
    expect(died).toHaveLength(1);
    expect(died[0]!.defId).toBe('clubber');
    expect(sim.state.allies).toHaveLength(0);
    // 죽기까지 받은 피해가 전부 난투다 — hp가 유일한 목숨이라는 헤더의 스톨 안전성 논거가
    // 실제로 성립한다(난투 피해 ≥ 1이고 회복 수단이 없으므로 유한 시간에 반드시 풀린다)
    const hurt = eventsOf(evs, 'allyDamaged');
    expect(hurt.length).toBeGreaterThan(0);
    for (const h of hurt) expect(h.amount).toBe(30);
  });
});

// ---------------------------------------------------------------------------
describe('봉쇄 — 충돌 없이 발을 묶는다 (규칙 5)', () => {
  it('근접 아군이 적의 전진을 멈춘다', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 250); // 적이 집결 지점까지 걸어온다 (실측 206틱에 봉쇄)
    const e = sim.state.enemies[0]!;
    expect(e.blockerAllyId).toBe(sim.state.allies[0]!.id);
    const stuckAt = e.dist;
    runTicks(sim, 60);
    expect(sim.state.enemies[0]!.dist).toBe(stuckAt); // 2초가 지나도 그 자리
  });

  it('아군이 쓰러지면 봉쇄가 풀리고 적이 다시 전진한다', () => {
    const sim = allySim({
      enemy: { speed: 1, brawl: { dmg: 30, cooldownTicks: 15 } },
      ally: { clubber: { hp: 60 } },
    });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 210);
    expect(sim.state.enemies[0]!.blockerAllyId).toBeGreaterThanOrEqual(0);
    const stuckAt = sim.state.enemies[0]!.dist;
    runTicks(sim, 40); // 난투 두 대면 hp 60이 바닥난다
    expect(sim.state.allies).toHaveLength(0);
    expect(sim.state.enemies[0]!.blockerAllyId).toBe(-1);
    expect(sim.state.enemies[0]!.dist).toBeGreaterThan(stuckAt);
  });

  it('원거리 아군은 아무도 막지 못하고 걸으면서 쏜다', () => {
    const sim = allySim({
      enemy: { speed: 1 },
      ally: { slinger: { blocks: false, range: 3, dmg: 1 } },
    });
    expect(train(sim, 'slinger')).toBe(true);
    expect(order(sim, 2, 2)).toBe(true); // 적 쪽으로 마중 나가면서 쏜다
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 200);
    const hits = eventsOf(evs, 'allyAttacked');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.ranged).toBe(true);
    // 타격 위치가 서로 다르다 = 쏘는 동안에도 걸었다 (근접형이면 첫 타격에서 멈춘다)
    expect(new Set(hits.map((h) => r3(h.x))).size).toBeGreaterThan(1);
    const e = sim.state.enemies[0]!;
    expect(e.blockerAllyId).toBe(-1);
    const d0 = e.dist;
    runTicks(sim, 30);
    expect(sim.state.enemies[0]!.dist).toBeGreaterThan(d0); // 적도 계속 전진한다
  });

  it('공중 적은 봉쇄되지 않는다 (근접 아군은 아예 조준도 못 한다)', () => {
    const sim = allySim({ enemy: { speed: 1, flying: true } });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 240); // 공중 레인은 스폰→기지 직선이라 이 틱에 아직 판 위에 있다
    expect(sim.state.enemies.length).toBeGreaterThan(0);
    for (const e of sim.state.enemies) expect(e.blockerAllyId).toBe(-1);
    expect(sim.state.allies[0]!.targetId).toBe(-1);
  });

  /**
   * 규칙 5-b) 한 명이 여러 마리를 막는다 — 단, ALLY_BLOCK_CAPACITY까지만.
   * 1마리 고정이던 시절 아군이 왜 어떤 수치로도 무의미했는지는 balance.ALLY_BLOCK_CAPACITY 주석.
   * 여기서는 **상한이 실제로 걸리는지**를 본다: 정원보다 많은 적을 붙여도 초과분은 통과한다.
   */
  it('근접 아군 하나가 정원만큼 붙잡고, 그 이상은 못 붙잡는다', () => {
    const over = ALLY_BLOCK_CAPACITY + 2;
    // hp를 크게 준다 — 정원만큼 붙잡으면 그만큼 난투를 겹쳐 맞아 기본 체력으로는
    // 관측 전에 쓰러진다(그 자체가 규칙 5-b의 대가이고, 아래 별도 항목으로 잠근다)
    const sim = allySim({ enemy: { speed: 1 }, count: over, ally: { clubber: { hp: 1_000_000 } } });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 260);
    const id = sim.state.allies[0]!.id;
    const held = sim.state.enemies.filter((e) => e.blockerAllyId === id).length;
    expect(held).toBe(ALLY_BLOCK_CAPACITY);
    // 초과분은 붙잡히지 않았다 = 한 명이 웨이브 전체를 세우지 못한다
    expect(sim.state.enemies.filter((e) => e.blockerAllyId < 0).length).toBeGreaterThan(0);
  });

  /**
   * 규칙 6-b) 앞줄이 맡은 적을 뒷줄이 또 고르지 않는다.
   * 이 단서가 없으면 최근접+고정 타깃 규약이 반대로 작동해 여섯이 한 마리에 달라붙는다
   * (실측: 6명 봉쇄 효율 0.63 → 0.27로 붕괴 — src/sim/allies.ts 규칙 6-b 주석).
   */
  it('아군 둘은 서로 다른 적을 맡는다 (겹쳐 잡지 않는다)', () => {
    const sim = allySim({ enemy: { speed: 1 }, count: 4, ally: { clubber: { hp: 1_000_000 } } });
    expect(train(sim)).toBe(true);
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 260);
    const ids = sim.state.allies.map((a) => a.id);
    expect(ids).toHaveLength(2);
    const held = ids.map((id) => sim.state.enemies.filter((e) => e.blockerAllyId === id).length);
    // 둘 다 제 몫을 잡고 있다 — 한쪽이 0이면 겹쳐 잡았다는 뜻
    for (const h of held) expect(h).toBeGreaterThan(0);
    // 한 적이 두 아군에게 동시에 걸리는 일은 없다 (blockerAllyId는 하나뿐)
    const blocked = sim.state.enemies.filter((e) => e.blockerAllyId >= 0);
    expect(blocked.length).toBe(held[0]! + held[1]!);
  });

  /**
   * 규칙 5-b의 대가 — 넓게 막을수록 빨리 죽는다. 이게 없으면 정원 확대가 순이득이라
   * "많이 붙잡는다"가 공짜가 된다(무제한 봉쇄 실험에서 한 명이 웨이브를 영구히 세웠다).
   */
  it('많이 붙잡을수록 난투를 겹쳐 맞아 빨리 쓰러진다', () => {
    const hpAfter = (count: number): number => {
      const sim = allySim({ enemy: { speed: 1 }, count, ally: { clubber: { hp: 1_000_000 } } });
      expect(train(sim)).toBe(true);
      sim.applyCommand({ type: 'callWave' });
      runTicks(sim, 500);
      return sim.state.allies[0]!.hp;
    };
    // 정원(3)만큼 붙으면 한 마리일 때보다 확실히 더 깎여 있다 (실측 20 대 60)
    expect(1_000_000 - hpAfter(ALLY_BLOCK_CAPACITY)).toBeGreaterThan(1_000_000 - hpAfter(1));
  });

  /**
   * 규칙 5) 반격은 **가장 낮은 id 하나**만 받는다.
   * 8단계에는 대기 줄이 "누가 앞이냐"를 정해 줘서 이 성질이 저절로 드러났다. 자유 이동에서는
   * 둘을 **같은 칸에 세워야** 같은 적에 동시에 닿는 상황이 만들어지고, 그때 비로소
   * pickOrder(=아군 id 오름차순)가 답을 정한다. 이게 흔들리면 아군을 여럿 붙일수록
   * 손해가 되어(전원 반격) 정원이라는 손잡이 자체가 무의미해진다.
   */
  it('둘이 같은 칸에 서면 낮은 id가 붙잡고, 반격도 그 하나만 받는다', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    expect(train(sim)).toBe(true);
    expect(train(sim)).toBe(true);
    expect(order(sim, 6, 2)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 260);
    const e = sim.state.enemies[0]!;
    const ids = sim.state.allies.map((a) => a.id).sort((p, q) => p - q);
    expect(ids).toHaveLength(2);
    expect(e.blockerAllyId).toBe(ids[0]);
    const hurt = eventsOf(evs, 'allyDamaged');
    expect(hurt.length).toBeGreaterThan(0);
    expect(new Set(hurt.map((h) => h.allyId))).toEqual(new Set([ids[0]]));
  });
});

// ---------------------------------------------------------------------------
/**
 * 규칙 5-c) **스치는 타격** — 9단계 신설. **이번 변경에서 가장 중요한 묶음이다.**
 *
 * 8단계까지 적이 아군을 때리는 경로는 봉쇄 반격 하나뿐이었고, 봉쇄는 근접형(blocks:true)만
 * 건다. 즉 원거리형 무릿매는 **어떤 적도 때릴 수 없는 유닛**이었고, 20초 수명이 그 사실을
 * 가리고 있었다. 영구화가 그 뚜껑을 열었다 — 규칙 5-c가 없으면 무릿매는 골드로 사는
 * **불멸의 포탑**이 되고, 정원만큼 쌓이는 순간 게임이 끝난다.
 *
 * 그래서 이 묶음은 넷을 함께 잠근다. 하나만 빠져도 규칙이 조용히 반대 방향으로 샌다:
 *  · 맞는다 (없으면 불멸)                       · 죽는다 (맞기만 하고 안 죽으면 같은 얘기다)
 *  · 비켜 세우면 안 맞는다 (안 그러면 위치가 판단이 아니게 된다)
 *  · 봉쇄가 있으면 안 켜진다 (겹치면 한 틱에 두 대 → 근접형이 조용히 두 배로 아파진다)
 *  · 적을 멈추지 않는다 (멈추면 그건 탐색이고, 아군 하나로 웨이브를 낚아 세울 수 있다)
 */
describe('스치는 타격 — 봉쇄가 없어도 코앞의 아군은 맞는다 (규칙 5-c)', () => {
  it('원거리 아군도 맞는다 — 이 규칙이 없으면 무릿매는 불멸이다', () => {
    const sim = allySim({
      enemy: { speed: 1, cost: 20 },
      ally: { slinger: { blocks: false, range: 3, dmg: 1 } },
    });
    expect(train(sim, 'slinger')).toBe(true);
    expect(order(sim, 5, 2)).toBe(true); // 길 한복판에 세운다
    sim.applyCommand({ type: 'callWave' });
    const hurt: AllyDamagedEvent[] = [];
    let everBlocked = false;
    for (let t = 0; t < 400; t++) {
      sim.tick();
      hurt.push(...eventsOf(sim.drainEvents(), 'allyDamaged'));
      if (sim.state.enemies.some((e) => e.blockerAllyId >= 0)) everBlocked = true;
    }
    // 아무도 봉쇄하지 않았는데 맞았다 = 맞은 경로가 반격이 아니라 스치는 타격이다
    expect(everBlocked).toBe(false);
    expect(hurt.length).toBeGreaterThan(0);
    for (const h of hurt) expect(h.defId).toBe('slinger');
    expect(hurt[0]!.amount).toBe(enemyBrawlDmgFor(20)); // 난투와 같은 유도값을 쓴다
    expect(hurt[0]!.attackerDefId).toBe('raptor');
    const a = sim.state.allies[0]!;
    expect(a.hp).toBeLessThan(a.maxHp);
  });

  it('무릿매도 죽는다 (불멸이 실제로 없어졌다)', () => {
    const sim = allySim({
      enemy: { speed: 1, brawl: { dmg: 40, cooldownTicks: 30 } },
      count: 2,
      ally: { slinger: { blocks: false, range: 3, dmg: 1 } },
    });
    expect(train(sim, 'slinger')).toBe(true);
    expect(order(sim, 4, 2)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 600);
    // 지나가는 적에게 세 대를 스쳐 맞고 쓰러진다 (hp 100, 40씩)
    expect(eventsOf(evs, 'allyDamaged').length).toBeGreaterThanOrEqual(3);
    expect(eventsOf(evs, 'allyDied')).toHaveLength(1);
    expect(sim.state.allies).toHaveLength(0);
  });

  /**
   * **위치가 처음으로 판단이 된다.** 8단계 아군은 어디에 설지 고를 수 없었고(줄을 섰다),
   * 지금은 고를 수 있다. 길에 세우면 맞고 비켜 세우면 안 맞는다는 이 대비가
   * 자유 이동이 산 것의 값을 실제로 만든다 — 없으면 "아무 데나 세워도 같다"가 된다.
   */
  it('길에서 비켜 세우면 스치지 않는다', () => {
    const hitsAt = (cellZ: number): number => {
      const sim = allySim({
        enemy: { speed: 1, cost: 20 },
        ally: { slinger: { blocks: false, range: 3, dmg: 1 } },
      });
      expect(train(sim, 'slinger')).toBe(true);
      expect(order(sim, 5, cellZ)).toBe(true);
      sim.applyCommand({ type: 'callWave' });
      return eventsOf(runTicks(sim, 400), 'allyDamaged').length;
    };
    expect(hitsAt(2)).toBeGreaterThan(0); // 경로 위 (거리 0)
    // z=0은 경로(z=2)에서 2타일 — 이 실험이 성립하는 전제가 그 2타일이 팔 길이 밖이라는 것이다.
    // 사거리 3짜리 무릿매라 그 자리에서도 **쏘기는 그대로 쏜다**: 안전한 자리가 실제로 존재한다
    expect(BRAWL_BRUSH_RANGE).toBeLessThan(2);
    expect(hitsAt(0)).toBe(0);
  });

  it('봉쇄자가 있으면 스치는 타격은 켜지지 않는다 (한 틱에 두 대는 없다)', () => {
    const sim = allySim({
      enemy: { speed: 1, cost: 20 },
      ally: {
        clubber: { hp: 100_000 }, // 관측 창이 닫히지 않게 오래 버티게 한다
        slinger: { blocks: false, range: 3, dmg: 1 },
      },
    });
    expect(train(sim, 'clubber')).toBe(true);
    expect(train(sim, 'slinger')).toBe(true);
    expect(order(sim, 5, 2)).toBe(true); // 둘을 **같은 칸**에 세운다 (무릿매도 팔 길이 안)
    sim.applyCommand({ type: 'callWave' });
    const hurt: AllyDamagedEvent[] = [];
    let maxPerTick = 0;
    for (let t = 0; t < 400; t++) {
      sim.tick();
      const h = eventsOf(sim.drainEvents(), 'allyDamaged');
      maxPerTick = Math.max(maxPerTick, h.length);
      hurt.push(...h);
    }
    expect(hurt.length).toBeGreaterThan(0);
    // 맞은 것은 봉쇄자뿐 — 무릿매는 코앞에 서 있는데도 한 대도 안 맞았다
    expect(new Set(hurt.map((h) => h.defId))).toEqual(new Set(['clubber']));
    expect(sim.state.allies.find((a) => a.defId === 'slinger')!.hp).toBe(100);
    // 적 하나가 한 틱에 두 번 때리지 않는다 (반격과 스치기가 겹치지 않는다)
    expect(maxPerTick).toBe(1);
  });

  it('적은 스치는 타격 때문에 멈추지 않는다 (탐색이 아니다)', () => {
    const sim = allySim({
      enemy: { speed: 1, cost: 20 },
      ally: { slinger: { blocks: false, range: 3, dmg: 1 } },
    });
    expect(train(sim, 'slinger')).toBe(true);
    expect(order(sim, 4, 2)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    let prev = 0;
    let brushTicks = 0;
    for (let t = 0; t < 300; t++) {
      sim.tick();
      const hurt = eventsOf(sim.drainEvents(), 'allyDamaged');
      const e = sim.state.enemies[0];
      if (!e) {
        prev = 0;
        continue;
      }
      if (hurt.length > 0) {
        brushTicks++;
        // 때린 그 틱에도 적은 걸었고, 방향도 안 바꿨다(전진 = dist 증가)
        expect(e.blockerAllyId).toBe(-1);
        expect(e.dist).toBeGreaterThan(prev);
      }
      prev = e.dist;
    }
    expect(brushTicks).toBeGreaterThanOrEqual(2); // 지나가며 실측 2대
  });
});

// ---------------------------------------------------------------------------
describe('전투 (규칙 5·6)', () => {
  it('아군이 적을 때리고 enemyDamaged의 출처가 아군 종이다', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 300);
    const hits = eventsOf(evs, 'allyAttacked');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.ranged).toBe(false);
    const dmg = eventsOf(evs, 'enemyDamaged').filter((d) => d.source === 'clubber');
    expect(dmg.length).toBeGreaterThan(0);
  });

  it('발이 묶인 적은 아군을 반격한다 (난투)', () => {
    const sim = allySim({ enemy: { speed: 1, cost: 20 } });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 300);
    const hurt = eventsOf(evs, 'allyDamaged');
    expect(hurt.length).toBeGreaterThan(0);
    expect(hurt[0]!.amount).toBe(enemyBrawlDmgFor(20));
    expect(hurt[0]!.attackerDefId).toBe('raptor');
    expect(sim.state.allies[0]!.hp).toBeLessThan(sim.state.allies[0]!.maxHp);
  });

  it('EnemyDef.brawl이 있으면 유도값 대신 그 수치를 쓴다', () => {
    const sim = allySim({ enemy: { speed: 1, brawl: { dmg: 7, cooldownTicks: 30 } } });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const hurt = eventsOf(runTicks(sim, 300), 'allyDamaged');
    expect(hurt.length).toBeGreaterThan(0);
    for (const h of hurt) expect(h.amount).toBe(7);
  });

  it('아군은 죽을 수 있다 (allyDied → 회수)', () => {
    const sim = allySim({
      enemy: { speed: 1, brawl: { dmg: 500, cooldownTicks: 10 } },
      ally: { clubber: { hp: 60 } },
    });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 300);
    const died = eventsOf(evs, 'allyDied');
    expect(died).toHaveLength(1);
    expect(died[0]!.defId).toBe('clubber');
    expect(sim.state.allies).toHaveLength(0);
  });

  it('아군의 armor가 난투 피해를 깎는다 (최소 1은 들어간다)', () => {
    const sim = allySim({
      enemy: { speed: 1, brawl: { dmg: 10, cooldownTicks: 30 } },
      ally: { clubber: { armor: 4 } },
    });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const hurt = eventsOf(runTicks(sim, 300), 'allyDamaged');
    expect(hurt.length).toBeGreaterThan(0);
    for (const h of hurt) expect(h.amount).toBe(6);
  });

  it('스턴에 걸린 적은 반격하지 못한다', () => {
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ startGold: 100000, baseHp: 9999 }),
        enemyDefs: enemyDefs({
          raptor: { hp: 1_000_000, speed: 1, brawl: { dmg: 20, cooldownTicks: 10 } },
        }),
        // 경로 전체를 덮는 100% 스턴기 — 피해는 없고 붙잡아 두기만 한다
        towerDefs: towerDefs({
          spear: {
            tiers: Array.from({ length: 5 }, () => ({
              dmg: 0.0001,
              cooldownTicks: 10,
              range: 9,
              cost: 50,
              projectileSpeed: 30,
              status: { kind: 'stun' as const, magnitude: 0, durationTicks: 90, chance: 1 },
            })),
          },
        }),
        allyDefs: allyDefs(),
        waves: [wave([{ enemyId: 'raptor', count: 1, intervalTicks: 0 }])],
      }),
    );
    place(sim, 5, 0);
    expect(train(sim)).toBe(true);
    // 적이 스턴으로 스폰 근처에 굳어 있으므로 **이쪽이 걸어가야** 붙는다.
    // (8단계에는 아군이 저절로 역주행해서 이 명령이 필요 없었다)
    expect(order(sim, 1, 2)).toBe(true);
    const evs = runTicks(sim, 400);
    expect(sim.state.enemies[0]!.blockerAllyId).toBe(sim.state.allies[0]!.id); // 붙잡긴 했다
    expect(eventsOf(evs, 'allyDamaged')).toHaveLength(0); // 그런데 한 대도 못 친다
  });
});

// ---------------------------------------------------------------------------
describe('봉쇄된 적은 타워를 때리지 않는다 (siege.ts 규칙 1-b)', () => {
  /**
   * 목 습격대 — 붙잡히지 않으면 타워를 두들긴다.
   * 여기서 재는 것은 **봉쇄가 공성을 끊는가**(규칙 1-b)뿐이므로 사거리·정지 규칙은
   * 일부러 최소로 둔다. 적 speed 0.2는 "타워 앞을 천천히 지나간다"를 만들어
   * 정지 상한(규칙 4-b)이 끝난 뒤에도 관측 창이 닫히지 않게 하는 장치다 —
   * 그렇지 않으면 봉쇄를 재기 전에 적이 사거리 밖으로 걸어 나간다.
   */
  const RAID: TowerAttackSpec = {
    dmg: 20,
    range: 1.6,
    cooldownTicks: 20,
    stopToAttack: true,
    holdTicks: 60,
    ranged: false,
  };

  /**
   * 아군을 낼지 말지만 다른 통제 실험.
   * total = 타워가 받은 총 피해, whileBlocked = **봉쇄가 서 있던 틱에** 받은 피해,
   * beforeBlock = 봉쇄가 서기 **전에** 받은 피해, blockedTicks = 봉쇄가 유지된 틱 수.
   *
   * 아군은 타워 바로 앞 경로 칸으로 보낸다. 9단계에는 이 한 줄이 실험의 절반이다 —
   * 아군은 스스로 걷지 않으므로(규칙 1) 명령이 없으면 마을 앞에 서서 아무것도 안 한다.
   * 그리고 그 칸을 고르는 것이 **beforeBlock > 0**을 만든다: 적이 먼저 타워를 때리기
   * 시작하고 그 뒤에 봉쇄가 서므로, whileBlocked == 0이 "사거리 밖이라 못 때린 것"이
   * 아니라 **붙잡혀서 못 때린 것**임이 한 판 안에서 증명된다.
   */
  function towerDamageWith(
    useAlly: boolean,
    towerX: number,
  ): {
    total: number;
    whileBlocked: number;
    beforeBlock: number;
    blockedTicks: number;
    destroyTick: number;
  } {
    const sim = allySim({ enemy: { speed: 0.2, towerAttack: RAID, cost: 20 } });
    place(sim, towerX, 1);
    if (useAlly) {
      expect(train(sim)).toBe(true);
      expect(order(sim, towerX, 2)).toBe(true);
    }
    sim.applyCommand({ type: 'callWave' });
    let total = 0;
    let whileBlocked = 0;
    let beforeBlock = 0;
    let blockedTicks = 0;
    let destroyTick = -1;
    for (let i = 0; i < 2400; i++) {
      sim.tick();
      let tickDmg = 0;
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'towerDamaged') tickDmg += ev.amount;
        else if (ev.type === 'towerDestroyed' && destroyTick < 0) destroyTick = i;
      }
      total += tickDmg;
      // blockerAllyId는 이번 틱의 updateAllies가 세운 값이고 다음 틱까지 유지된다 —
      // 즉 "이번 틱에 봉쇄되어 있었는가"를 그대로 읽을 수 있다
      if (sim.state.enemies.some((e) => e.blockerAllyId >= 0)) {
        blockedTicks++;
        whileBlocked += tickDmg;
      } else if (blockedTicks === 0) beforeBlock += tickDmg;
    }
    return { total, whileBlocked, beforeBlock, blockedTicks, destroyTick };
  }

  it('봉쇄가 서 있는 동안 타워는 한 대도 맞지 않는다', () => {
    const guarded = towerDamageWith(true, 5);
    expect(guarded.blockedTicks).toBeGreaterThan(30); // 봉쇄가 실제로 성립했다
    expect(guarded.beforeBlock).toBeGreaterThan(0); // 그 전까지는 때리고 있었다
    expect(guarded.whileBlocked).toBe(0); // 붙잡힌 뒤로는 정확히 무사하다
  });

  /**
   * 아군이 파는 것은 **피해량이 아니라 시간**이다.
   * 습격대의 총 화력이 타워 HP를 넘는 이상 타워는 결국 부서진다(둘 다 260을 다 맞는다).
   * 아군 한 명이 바꾸는 건 "언제 부서지는가"이고, 그 시간이 곧 타워가 더 쏜 시간이다.
   */
  it('아군은 타워의 수명을 산다 (파괴 시점이 뒤로 밀린다)', () => {
    const alone = towerDamageWith(false, 5);
    const guarded = towerDamageWith(true, 5);
    expect(alone.destroyTick).toBeGreaterThan(0); // 통제군은 실제로 타워를 부순다
    expect(guarded.destroyTick).toBeGreaterThan(alone.destroyTick);
    // 목 아군(hp 100) 하나가 난투(11/1초)에 버티는 시간만큼이 그대로 이득이다 (실측 +262틱)
    expect(guarded.destroyTick - alone.destroyTick).toBeGreaterThan(200);
  });

  /**
   * 봉쇄는 **영구가 아니다** — 아군이 쓰러지면 적은 하던 일로 돌아간다.
   * 이게 스톨(무한 교착)이 나지 않는다는 실증이기도 하다 (allies.ts 헤더 참조).
   */
  it('아군이 쓰러지면 적은 다시 타워를 때린다', () => {
    const guarded = towerDamageWith(true, 5);
    // 2400틱 중 봉쇄는 일부 구간뿐 — 아군(hp 100)이 난투(11/1초)에 쓰러진 뒤가 있다
    expect(guarded.blockedTicks).toBeLessThan(2400);
    expect(guarded.destroyTick).toBeGreaterThan(0);
  });

  /**
   * **사용자 재정의 ④의 뒷면 — 이 항목은 8단계에서 부호가 뒤집혔다.**
   * 8단계에는 여기에 "출격 한계선 밖(경로 초입)의 타워는 아군이 구하지 못한다"가 있었고,
   * 그것이 한계선이 사려던 것의 대가였다(아군은 마을 앞 전력이지 맵 전체의 소방수가 아니다).
   * 한계선이 사용자 지시로 없어졌으므로 그 명제도 **반대가 되어야 맞다**: 경로 초입,
   * 즉 적 스폰 코앞의 타워도 부족원이 걸어가 구한다. 반경 제한이 어떤 형태로든 되살아나면
   * (표식·비용·경로 길이 어느 쪽이든) 이 항목이 가장 먼저 빨개진다.
   */
  it('경로 초입의 타워도 아군이 구한다 (한계선이 없어졌다)', () => {
    const alone = towerDamageWith(false, 1);
    const guarded = towerDamageWith(true, 1);
    expect(alone.destroyTick).toBeGreaterThan(0);
    // 마을 앞(x 7.6)에서 스폰 코앞(x 1)까지 6.6타일을 걸어가 붙잡는다
    expect(guarded.blockedTicks).toBeGreaterThan(30);
    expect(guarded.whileBlocked).toBe(0);
    expect(guarded.destroyTick - alone.destroyTick).toBeGreaterThan(200); // 실측 +264틱
  });

  it('봉쇄 중에는 towerTargetId가 풀린다', () => {
    const sim = allySim({ enemy: { speed: 0.2, towerAttack: RAID, cost: 20 } });
    place(sim, 5, 1);
    expect(train(sim)).toBe(true);
    expect(order(sim, 5, 2)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    let blocked: EnemyState | null = null;
    for (let t = 0; t < 1200 && !blocked; t++) {
      sim.tick();
      sim.drainEvents();
      const e = sim.state.enemies[0];
      if (e && e.blockerAllyId >= 0) blocked = e;
    }
    expect(blocked).not.toBeNull();
    expect(blocked!.towerTargetId).toBe(-1);
    // 붙잡힌 자리가 타워 사거리 **안**이다 — 못 때리는 이유가 거리가 아니라 봉쇄임을
    // 이 한 줄이 못 박는다 (실측 거리 1.414 < 1.6)
    expect(Math.hypot(blocked!.x - 5, blocked!.z - 1)).toBeLessThan(RAID.range);
  });
});

// ---------------------------------------------------------------------------
describe('해시 반영', () => {
  it('아군 상태가 hash()에 들어간다 (체력·걸은 거리·목표·타깃 각각)', () => {
    const mk = (): BattleSim => {
      const s = allySim({ delay: NO_ENEMIES });
      expect(s.applyCommand({ type: 'trainAlly', defId: 'clubber' })).toBe(true);
      expect(order(s, 3, 2)).toBe(true);
      runTicks(s, 30);
      return s;
    };
    const a = mk();
    const b = mk();
    expect(a.hash()).toBe(b.hash());

    /*
     * 9단계에 흔들 항목이 바뀌었다: lifeLeft가 사라진 자리에 walked와 tgtX/tgtZ가 들어왔다.
     * 셋 다 각각 다른 발산을 잡는다 —
     *  · walked : 도착해 멈춘 뒤에도 남는 유일한 값(위치만으로는 구별되지 않는 이력)
     *  · tgtX/Z : 명령만 바꾸고 아직 한 걸음도 안 걸은 틱은 x/z가 완전히 같다
     */
    const mutate = (
      fn: (x: { hp: number; walked: number; tgtX: number; tgtZ: number; targetId: number }) => void,
    ): number => {
      const s = mk();
      fn(s.state.allies[0] as AllyState);
      return s.hash();
    };
    expect(mutate((x) => (x.hp -= 1))).not.toBe(a.hash());
    expect(mutate((x) => (x.walked -= 0.5))).not.toBe(a.hash());
    expect(mutate((x) => (x.tgtX += 1))).not.toBe(a.hash());
    expect(mutate((x) => (x.tgtZ += 1))).not.toBe(a.hash());
    expect(mutate((x) => (x.targetId = 99))).not.toBe(a.hash());
  });

  it('적의 봉쇄 상태가 hash()에 들어간다', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 30);
    const h0 = sim.hash();
    (sim.state.enemies[0] as { blockerAllyId: number }).blockerAllyId = 7;
    expect(sim.hash()).not.toBe(h0);
  });
});

// ---------------------------------------------------------------------------
/**
 * 급소 열기 🟫🔓 (`AllyDef.sunder`, docs/counter-plan.md 단계 3).
 * (9단계 전에는 이 묶음이 "규칙 5-c"로 불렸다. 그 번호는 이제 **스치는 타격**이 쓴다 —
 *  급소 열기는 규칙 번호가 아니라 필드 이름으로 부른다.)
 *
 * 이 규칙이 봉투 16번(아군의 한계 가치)에 얼마를 넣는지는 **스테이지1에서 거의 0**이다
 * (가죽을 가진 종이 boar 하나뿐이고, 640시드에서 가죽 축 전체가 +7판이다 —
 *  근거는 counter-plan.md 단계 3 착수 결과). 그래도 규칙 자체는 여기서 못 박는다:
 * 투여량이 0인 것과 규칙이 안 도는 것은 다르고, 단계 5·6이 가죽 종을 늘리면
 * 그때 이 테스트가 그 늘어난 값을 지킨다.
 */
describe('급소 열기 — 파수꾼이 붙잡은 적은 가죽이 열린다 (AllyDef.sunder)', () => {
  /** 상한 10(= round(100000 × 0.0001))인 적을 40으로 때린다 — 열렸는지가 한눈에 갈린다 */
  const hitsOf = (sunder: boolean, extra?: Partial<EnemyDef>): number[] => {
    const sim = allySim({
      enemy: { speed: 1, hp: 100_000, hide: 0.0001, ...extra },
      ally: { clubber: { dmg: 40, sunder } },
    });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 300);
    return eventsOf(evs, 'enemyDamaged')
      .filter((d) => d.source === 'clubber')
      .map((d) => d.amount);
  };

  it('sunder가 없으면 상한이 그대로 걸린다 (대조군)', () => {
    const hits = hitsOf(false);
    expect(hits.length).toBeGreaterThan(0);
    for (const a of hits) expect(a).toBe(10);
  });

  it('sunder가 있으면 상한이 사라지고 한 방이 그대로 들어간다', () => {
    const hits = hitsOf(true);
    expect(hits.length).toBeGreaterThan(0);
    for (const a of hits) expect(a).toBe(40);
  });

  /**
   * **한 규칙, 한 수업** — 여는 것은 가죽 하나뿐이고 armor는 안 건드린다.
   * 이 어서션이 없으면 "붙잡으면 무적 관통"으로 슬금슬금 자라난다.
   */
  it('armor는 열지 않는다 — 감산은 그대로 남는다', () => {
    const hits = hitsOf(true, { armor: 6 });
    expect(hits.length).toBeGreaterThan(0);
    for (const a of hits) expect(a).toBe(34); // 40 − armor 6, 상한 없음
  });

  /**
   * 판정이 **매 틱의 봉쇄 상태**를 읽으므로 파수꾼이 사라지면 같은 틱에 가죽이 닫힌다.
   * (`blockerAllyId`는 updateAllies가 매 틱 처음에 전부 지우고 다시 채운다)
   * 그래서 이 규칙은 새 상태를 하나도 안 들고, hash()에 더할 것도 없다.
   *
   * 9단계 전에는 파수꾼을 **수명으로** 퇴장시켰다. 이제 퇴장의 길이 죽음뿐이므로
   * 체력을 낮춰 난투에 쓰러뜨리고, 그 뒤를 sunder 없는 아군이 잇는다.
   */
  it('파수꾼이 쓰러지면 가죽이 다시 닫힌다', () => {
    const sim = allySim({
      enemy: { speed: 1, hp: 100_000, hide: 0.0001, brawl: { dmg: 15, cooldownTicks: 30 } },
      ally: { clubber: { dmg: 40, sunder: true, hp: 30 }, guardian: { dmg: 40 } },
    });
    expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const early = runTicks(sim, 400);
    // 붙잡고 있는 동안에는 상한이 없었다 (대조군과 같은 값)
    const opened = eventsOf(early, 'enemyDamaged')
      .filter((d) => d.source === 'clubber')
      .map((d) => d.amount);
    expect(opened.length).toBeGreaterThan(0);
    for (const a of opened) expect(a).toBe(40);
    expect(eventsOf(early, 'allyDied')).toHaveLength(1);
    expect(sim.state.allies).toHaveLength(0);

    expect(train(sim, 'guardian')).toBe(true); // sunder가 없는 아군이 뒤를 잇는다
    const evs = runTicks(sim, 400);
    expect(sim.state.allies.every((a) => a.defId === 'guardian')).toBe(true);
    const late = eventsOf(evs, 'enemyDamaged')
      .filter((d) => d.source === 'guardian')
      .map((d) => d.amount);
    expect(late.length).toBeGreaterThan(0);
    for (const a of late) expect(a).toBe(10); // 상한이 돌아왔다
  });
});

// ---------------------------------------------------------------------------
/**
 * 규칙 8) **자동 행동의 스위치 하나** — `AllyState.autoHold`.
 *
 * 자동 목표 선택 자체(어느 칸을 고르는가·언제 다시 나가는가)는 `tests/sim/gather.test.ts`가
 * 잠근다. 여기서 재는 것은 **그 스위치를 누가 언제 뒤집는가**다: 명령이 곧 온오프이고
 * (규칙 8-b), 그 비트가 **풀 재사용에서 새면 안 된다**(resetAlly).
 */
describe('자동 행동 스위치 (규칙 8-b)', () => {
  /** 이 묶음 전용 — 진짜 채집꾼과 같은 축(일꾼 판정선 위)의 목 정의 */
  const WORKER = { gatherer: { gatherPct: 300, blocks: false, speed: 1.3, carryCap: 1 } };
  /** 자원이 없는 빈 칸 (목 스테이지의 소품 칸 11개에 안 들어간다) */
  const EMPTY = { x: 5, z: 0 };
  /** 자원 칸 */
  const RES = { x: 7, z: 0 };
  /** 기지 셀 */
  const HOME = { x: 9, z: 2 };

  it('찍은 칸의 뜻이 자동의 온오프다 — 빈 칸만 "여기 지켜"다', () => {
    const sim = allySim({ ally: WORKER, delay: NO_ENEMIES });
    expect(train(sim, 'gatherer')).toBe(true);
    const a = sim.state.allies[0] as AllyState;
    expect(a.autoHold, '태어날 때는 자동이 켜져 있다').toBe(false);
    expect(sim.hasScenery(RES.x, RES.z), '전제: 그 칸에 자원이 있다').toBe(true);

    expect(order(sim, EMPTY.x, EMPTY.z, a.id)).toBe(true);
    expect(a.autoHold, '빈 칸 = 여기 지켜').toBe(true);
    expect(order(sim, RES.x, RES.z, a.id)).toBe(true);
    expect(a.autoHold, '자원 칸 = 일감이라 자동이 다시 켜진다').toBe(false);
    expect(order(sim, EMPTY.x, EMPTY.z, a.id)).toBe(true);
    expect(a.autoHold).toBe(true);
    expect(order(sim, HOME.x, HOME.z, a.id)).toBe(true);
    expect(a.autoHold, '기지 셀 = 돌아와서 내려놓고 다시 일해').toBe(false);
  });

  it('명령을 안 받은 사람의 스위치는 안 건드린다 (자원 칸은 한 사람만 간다 — E-9)', () => {
    const sim = allySim({ ally: WORKER, delay: NO_ENEMIES });
    expect(train(sim, 'gatherer')).toBe(true);
    expect(train(sim, 'gatherer')).toBe(true);
    const [a, b] = sim.state.allies as [AllyState, AllyState];
    // 둘 다 대기로 만들어 놓고 → 자원 칸 종족 명령 → 한 사람만 자동이 켜져야 한다
    expect(order(sim, EMPTY.x, EMPTY.z)).toBe(true);
    expect([a.autoHold, b.autoHold]).toEqual([true, true]);
    expect(sim.applyCommand({ type: 'moveAlly', allyId: -1, defId: 'gatherer', cellX: RES.x, cellZ: RES.z })).toBe(true);
    expect(a.autoHold, '그 칸을 맡은 사람만 자동이 켜진다').toBe(false);
    expect(b.autoHold, '루프에 안 들어온 사람은 대기 그대로다').toBe(true);
  });

  /**
   * ⚠ **resetAlly 전용 회귀** — 이 항목이 빨개지는 유일한 원인은 `entities.resetAlly`가
   * `autoHold`를 안 지우는 것이다. 안 지우면 새 부족원이 앞사람의 대기 상태를 물려받아
   * **명령을 한 번도 안 받았는데 자동이 꺼진 채** 태어나고, 그 갈림이 풀 재사용 순서
   * (= 시드)를 타므로 판마다 다른 게임이 된다. 화면에서는 "왜 얘만 안 움직이지"다.
   */
  it('풀 재사용) "여기 지켜"를 받은 채 죽어도 다음 부족원은 자동으로 일하러 나간다', () => {
    const sim = allySim({ ally: WORKER, delay: NO_ENEMIES });
    expect(train(sim, 'gatherer')).toBe(true);
    const first = sim.state.allies[0] as AllyState;
    expect(order(sim, EMPTY.x, EMPTY.z, first.id)).toBe(true);
    expect(first.autoHold).toBe(true);
    kill(first);
    runTicks(sim, 1);
    expect(sim.state.allies).toHaveLength(0);

    // 같은 슬롯을 물려받는 새 부족원
    expect(train(sim, 'gatherer')).toBe(true);
    const next = sim.state.allies[0] as AllyState;
    expect(next.autoHold, '앞사람의 대기 상태가 새면 안 된다').toBe(false);
    runTicks(sim, 2);
    expect(next.gatherKey, '명령 없이도 스스로 일감을 잡는다').toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
/**
 * **마법사 회복 🔷** (`AllyDef.heal`, src/sim/heal.ts).
 *
 * 사용자 요구 두 건이 한 짝이다: "타워나 주민의 hp가 시간이 지나면 자동으로 회복하지
 * 않도록" + "마법사가 가서 회복해주는 기능". 곧 회복의 **출처를 시간에서 사람으로**
 * 옮기는 것이고, 이 묶음이 그 옮김을 잠근다.
 *
 * ⚠ **대상에 아군은 없다.** 넣으면 두 불변식이 깨진다(`types.ts AllyDef.heal` 주석):
 *   종료 증명(봉쇄가 안 풀린다)과 채집 중단 벌금(hp 단조 감소 전제). 아래 마지막 it 이
 *   "아군은 안 고친다"를 **계약으로** 못 박아, 나중에 누가 무심코 넣으면 빨개지게 한다.
 */
describe('마법사 회복 — 타워와 마을을 고친다 (AllyDef.heal)', () => {
  /**
   * ⚠ **회복 스펙을 여기서 주입한다.** `fixtures.allyDef` 는 목 정의를 처음부터 짓기
   *   때문에 `heal` 이 없다 — 그게 옳다. 이 묶음이 재려는 것은 **규칙**이지 배포 수치가
   *   아니고, 배포 수치(`ALLY_DEFS.guardian.heal`)는 `tests/data/validate.test.ts` 가
   *   따로 잠근다. seekRadius 를 넉넉히 주는 것도 같은 이유다(목 판이 10×5 로 좁다).
   */
  const SPEC = { amount: 10, radius: 1.2, cooldownTicks: 15, seekRadius: 8 };
  function healSim(o: Opts = {}): BattleSim {
    return allySim({
      delay: NO_ENEMIES,
      ...o,
      ally: { guardian: { heal: SPEC }, ...(o.ally ?? {}) },
    });
  }
  const mage = (sim: BattleSim): AllyState => sim.state.allies[0] as AllyState;
  /**
   * ⚠ **준비 단계를 먼저 흘려보낸다.** prep 에는 `repairTowers` 가 도는데(웨이브당 6%),
   *   그걸 안 걷어내면 이 묶음이 **마법사가 아니라 자동 수리를 잰다** — 실제로 첫 판에서
   *   대조군(몽둥이꾼)이 130 → 160 으로 "고쳐져" 빨개졌다. 이 저장소가 반복해서 당한
   *   "잣대가 재려는 것과 다른 것을 잰다"의 재발이라, 손상을 **prep 이 끝난 뒤에** 준다.
   */
  function pastPrep(sim: BattleSim): void {
    for (let i = 0; i < 200; i++) sim.tick();
    expect(sim.state.phase, 'prep 이 안 끝났다 — 자동 수리가 섞인다').toBe('wave');
  }

  it('다친 타워에 **걸어가서** 고친다', () => {
    const sim = healSim();
    place(sim, 3, 3);
    expect(train(sim, 'guardian')).toBe(true);
    pastPrep(sim);
    const t = sim.state.towers[0] as { hp: number; maxHp: number };
    t.hp = Math.floor(t.maxHp / 2);
    const before = t.hp;
    const startX = mage(sim).x;
    const startZ = mage(sim).z;
    for (let i = 0; i < 600; i++) sim.tick();
    expect(t.hp, `${before} → ${t.hp}`).toBeGreaterThan(before);
    const moved = Math.hypot(mage(sim).x - startX, mage(sim).z - startZ);
    expect(moved, '제자리에서 고쳤다 — 걸어가야 한다').toBeGreaterThan(0.5);
  });

  it('만피면 아무것도 안 한다 (공허 방지)', () => {
    const sim = healSim();
    place(sim, 3, 3);
    expect(train(sim, 'guardian')).toBe(true);
    pastPrep(sim);
    const t = sim.state.towers[0] as { hp: number; maxHp: number };
    const startX = mage(sim).x;
    for (let i = 0; i < 300; i++) sim.tick();
    expect(t.hp).toBe(t.maxHp);
    expect(sim.state.baseHp).toBe(sim.state.baseHpMax);
    expect(Math.abs(mage(sim).x - startX), '고칠 것이 없는데 움직였다').toBeLessThan(0.01);
  });

  it('마을도 고치되 **판당 상한**이 있다 — 없으면 패배 조건이 사라진다', () => {
    const sim = healSim();
    expect(train(sim, 'guardian')).toBe(true);
    pastPrep(sim);
    const max = sim.state.baseHpMax;
    (sim.state as { baseHp: number }).baseHp = 1;
    const cap = Math.floor(max * ALLY_HEAL_BASE_CAP_FRAC);
    // 포화까지 충분히 돌린다 — amount 10 / 15틱이라 cap 5999 를 채우는 데 9,000틱쯤 든다.
    // ⚠ 모자라게 돌리면 "아직 덜 찬 값"을 상한으로 착각한다(첫 판이 그렇게 빨개졌다).
    for (let i = 0; i < 20_000; i++) sim.tick();
    const healed = sim.state.baseHp - 1;
    expect(healed, `되돌린 ${healed} · 상한 ${cap}`).toBe(cap);
    // 상한에 닿은 뒤에는 마을이 아직 만피가 아니어도(1 + 5999 << 9999) 더 안 고친다
    expect(sim.state.baseHp, '상한에 닿았는데 마을이 만피다 — 표본이 성립하지 않는다')
      .toBeLessThan(max);
    const settled = sim.state.baseHp;
    for (let i = 0; i < 5_000; i++) sim.tick();
    expect(sim.state.baseHp, '상한을 넘겨 계속 고쳤다').toBe(settled);
  });

  it('회복 능력이 없는 종은 아무것도 안 고친다 (대조군)', () => {
    const sim = healSim();
    place(sim, 3, 3);
    expect(train(sim, 'clubber')).toBe(true);
    pastPrep(sim);
    const t = sim.state.towers[0] as { hp: number; maxHp: number };
    t.hp = Math.floor(t.maxHp / 2);
    const before = t.hp;
    for (let i = 0; i < 600; i++) sim.tick();
    expect(t.hp, '몽둥이꾼이 타워를 고쳤다').toBe(before);
  });

  it('⚠ **아군은 안 고친다** — 종료 증명과 채집 중단 벌금이 여기 걸려 있다', () => {
    const sim = healSim();
    expect(train(sim, 'guardian')).toBe(true);
    expect(train(sim, 'clubber')).toBe(true);
    pastPrep(sim);
    const hurt = sim.state.allies.find((a) => a.defId === 'clubber') as AllyState;
    hurt.hp = 10;
    for (let i = 0; i < 900; i++) sim.tick();
    const now = sim.state.allies.find((a) => a.defId === 'clubber');
    expect(now?.hp, '아군이 회복됐다 — allies.ts 머리말의 스톨 가드 전제가 깨진다').toBe(10);
  });
});
