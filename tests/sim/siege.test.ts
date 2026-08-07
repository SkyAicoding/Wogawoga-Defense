/**
 * 공성 — 적 부족이 타워를 때려 부수는 메커니즘 (src/sim/siege.ts 규칙 1~9 검증).
 * 타워 HP 수치 체계, 업그레이드 회복 정책, prep 자동 수리, 파괴 후 재건설까지.
 */
import { describe, expect, it } from 'vitest';
import type { BattleSim, EnemyId, TowerAttackSpec, TowerId } from '@/data/types';
import {
  RAID_ATTACK_ANIM_TICKS,
  SIEGE_ADVANCE_TICKS,
  TOWER_HP_BASE,
  TOWER_HP_TIER_GROWTH,
  towerMaxHpFor,
} from '@/data/balance';
import { ENEMY_DEFS } from '@/data/enemies';
import { createBattle } from '@/sim/battle';
import { enemyDefs, eventsOf, options, runTicks, stageDef, towerDefs, wave } from './fixtures';

/**
 * 짧은 사거리 목 — 정지 판정 거리(SIEGE_ENGAGE_RANGE 2.1)보다 짧아서 규칙 4-a의
 * min()이 자기 사거리에 걸리는 경우다. 이름이 MELEE인 것은 역사적 이유이고,
 * 지금 이 스펙이 검증하는 것은 "사거리가 정지 거리보다 짧아도 규칙이 무너지지 않는다"이다.
 */
const MELEE: TowerAttackSpec = {
  dmg: 20,
  range: 1.5,
  cooldownTicks: 30,
  stopToAttack: true,
  holdTicks: 60,
  ranged: false,
};
/** 순수 '걸으며 쏘기' 대조군 — 절대 멈추지 않는다 (규칙 4를 끈 상태) */
const RANGED: TowerAttackSpec = {
  dmg: 20,
  range: 2.4,
  cooldownTicks: 30,
  stopToAttack: false,
  holdTicks: 0,
  ranged: true,
};
/** 정지 사격 목 — 사거리가 정지 거리보다 길어 "걸으며 쏘다가 멈춰 선다"가 전부 나온다 */
const PLANTER: TowerAttackSpec = {
  dmg: 20,
  range: 3.0,
  cooldownTicks: 30,
  stopToAttack: true,
  holdTicks: 60,
  ranged: true,
};

/**
 * 목 전장: 경로는 z=2 가로줄(x 0→9), 사거리 판정을 지배하는 건 배치 셀뿐이다.
 * attacker 적은 speed 0으로 두면 스폰 지점(0,2)에 고정돼 판정이 결정적으로 재현된다.
 */
function siegeSim(
  attackSpec: TowerAttackSpec | undefined,
  opts: {
    count?: number;
    speed?: number;
    enemyId?: EnemyId;
    /**
     * 목 타워의 사거리 = **반격 반경**(towerReach). 기본 0.2는 "사실상 반격 못 함"이라
     * 규칙 4-a에 따라 습격대가 그 앞에 서지 않는다 — 정지를 관찰하려면 반드시 올려야 한다.
     */
    towerRange?: number;
    toughness?: number;
  } = {},
): BattleSim {
  const id = opts.enemyId ?? 'warrior';
  const range = opts.towerRange ?? 0.2;
  return createBattle(
    options({
      deck: ['spear'],
      stage: stageDef({ startGold: 100000, baseHp: 9999 }),
      enemyDefs: enemyDefs({
        [id]: { speed: opts.speed ?? 0, hp: 100000, ...(attackSpec ? { towerAttack: attackSpec } : {}) },
      }),
      // 타워가 적을 죽여 버리면 공성을 관찰할 수 없다 — 무해한 타워로 고정
      towerDefs: towerDefs({
        spear: {
          ...(opts.toughness !== undefined ? { toughness: opts.toughness } : {}),
          tiers: Array.from({ length: 5 }, () => ({ ...tinyTier(), range })),
        },
      }),
      waves: [wave([{ enemyId: id, count: opts.count ?? 1, intervalTicks: 0 }])],
    }),
  );
}

function tinyTier(): { dmg: number; cooldownTicks: number; range: number; cost: number } {
  return { dmg: 0.0001, cooldownTicks: 600, range: 0.2, cost: 50 };
}

/** 타워 배치 — 목 스테이지의 소품(시드 산포)이 걸리면 먼저 치운다 */
function place(sim: BattleSim, x: number, z: number, handIndex = 0): void {
  if (sim.hasScenery(x, z)) {
    expect(sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z })).toBe(true);
  }
  expect(sim.applyCommand({ type: 'placeTower', handIndex, cellX: x, cellZ: z })).toBe(true);
}

describe('타워 HP 수치 체계', () => {
  it('T1 = TOWER_HP_BASE, 티어당 TOWER_HP_TIER_GROWTH배', () => {
    expect(towerMaxHpFor(0)).toBe(TOWER_HP_BASE);
    expect(towerMaxHpFor(1)).toBe(Math.round(TOWER_HP_BASE * TOWER_HP_TIER_GROWTH));
    expect(towerMaxHpFor(4)).toBe(Math.round(TOWER_HP_BASE * TOWER_HP_TIER_GROWTH ** 4));
  });

  it('별/내구도 배율이 곱해진다', () => {
    expect(towerMaxHpFor(0, 5)).toBe(Math.round(TOWER_HP_BASE * 1.3));
    expect(towerMaxHpFor(0, 0, 1.25)).toBe(Math.round(TOWER_HP_BASE * 1.25));
  });

  it('배치 직후 타워는 만피이고 hp/maxHp가 노출된다', () => {
    const sim = siegeSim(undefined);
    place(sim, 4, 1);
    const t = sim.towerAt(4, 1);
    expect(t).not.toBeNull();
    expect(t?.maxHp).toBe(towerMaxHpFor(0));
    expect(t?.hp).toBe(t?.maxHp);
    // BattleStateView.towers 로도 같은 객체가 보인다 (체력바 렌더용 조회 경로)
    expect(sim.state.towers[0]?.hp).toBe(t?.hp);
  });
});

describe('적의 타워 공격', () => {
  it('사거리 안의 타워를 때려 체력을 깎고 towerDamaged를 발행한다', () => {
    const sim = siegeSim(MELEE);
    place(sim, 0, 1); // 스폰 지점(0,2)에서 거리 1.0 → 사거리 1.5 안
    sim.applyCommand({ type: 'callWave' });
    const ev = eventsOf(runTicks(sim, 120), 'towerDamaged');
    expect(ev.length).toBeGreaterThan(0);
    const first = ev[0]!;
    expect(first.amount).toBe(MELEE.dmg);
    expect(first.cellX).toBe(0);
    expect(first.cellZ).toBe(1);
    expect(first.attackerDefId).toBe('warrior');
    expect(first.ranged).toBe(false);
    expect(first.maxHp).toBe(towerMaxHpFor(0));
    const t = sim.towerAt(0, 1);
    expect(t!.hp).toBeLessThan(t!.maxHp);
  });

  it('사거리 밖 타워는 건드리지 않는다 (경로에서 멀면 안전)', () => {
    const sim = siegeSim(MELEE);
    place(sim, 4, 0); // 스폰 지점에서 멀다
    place(sim, 9, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    expect(eventsOf(runTicks(sim, 300), 'towerDamaged')).toHaveLength(0);
    for (const t of sim.state.towers) expect(t.hp).toBe(t.maxHp);
  });

  it('towerAttack이 없는 적은 타워를 완전히 무시한다 (기존 12종 동작 유지)', () => {
    const sim = siegeSim(undefined);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    expect(eventsOf(runTicks(sim, 300), 'towerDamaged')).toHaveLength(0);
  });

  it('쿨다운 간격대로만 때린다 (30틱 = 1초에 1대)', () => {
    const sim = siegeSim(MELEE);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 2); // 웨이브 시작 + 스폰
    const hits = eventsOf(runTicks(sim, 90), 'towerDamaged').length;
    expect(hits).toBeGreaterThanOrEqual(3);
    expect(hits).toBeLessThanOrEqual(4);
  });

  it('가장 가까운 타워를 고르고, 그 타워가 부서질 때까지 갈아타지 않는다', () => {
    const sim = siegeSim(MELEE);
    place(sim, 0, 1); // 거리 1.0 (id 1)
    place(sim, 1, 1, 1); // 거리 √2 ≈ 1.414 (id 2) — 둘 다 사거리 안
    sim.applyCommand({ type: 'callWave' });
    const ev = eventsOf(runTicks(sim, 200), 'towerDamaged');
    expect(ev.length).toBeGreaterThan(3);
    expect(new Set(ev.map((e) => e.towerId)).size).toBe(1);
    expect(sim.towerAt(1, 1)!.hp).toBe(sim.towerAt(1, 1)!.maxHp); // 먼 쪽은 무사
  });

  it('스턴 중에는 때리지 못한다 (완전 무력화)', () => {
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ startGold: 100000, baseHp: 9999 }),
        enemyDefs: enemyDefs({ warrior: { speed: 0, hp: 100000, towerAttack: MELEE } }),
        // frost 타워가 100% 확률 스턴을 계속 건다
        towerDefs: towerDefs({
          spear: {
            tiers: Array.from({ length: 5 }, () => ({
              ...tinyTier(),
              range: 3,
              cooldownTicks: 10,
              status: { kind: 'stun' as const, magnitude: 0, durationTicks: 40, chance: 1 },
            })),
          },
        }),
        waves: [wave([{ enemyId: 'warrior', count: 1, intervalTicks: 0 }])],
      }),
    );
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    // 스폰 틱에는 아직 스턴이 걸리기 전이라 규칙 6(진입 즉시 1타)이 먼저 성립한다.
    // 그 다음부터는 스턴이 유지되는 한 영원히 때리지 못해야 한다.
    const opening = eventsOf(runTicks(sim, 30), 'towerDamaged').length;
    expect(opening).toBeLessThanOrEqual(1);
    expect(eventsOf(runTicks(sim, 300), 'towerDamaged')).toHaveLength(0);
    for (const e of sim.state.enemies) expect(e.towerTargetId).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 감속과 공성 — siege.ts 규칙 9 (얼음이 습격대 앞에서 죽은 카드가 되지 않게 하는 축)
// ---------------------------------------------------------------------------

/**
 * 감속 관찰용 전장 — 공격자는 (0,2)에 고정, 피해자 타워는 근접 사거리 안,
 * 그리고 **피해는 없고 감속만 거는** 타워를 따로 세운다.
 * 감속 외의 변수를 전부 없애야 "한 대의 위력이 줄었다"를 단독으로 읽을 수 있다.
 */
function slowSiegeSim(slowMagnitude: number | null): BattleSim {
  const harmless = { dmg: 0.0001, cooldownTicks: 600, range: 0.2, cost: 50 };
  const chiller = {
    dmg: 0.0001,
    cooldownTicks: 10,
    range: 3,
    cost: 50,
    projectileSpeed: 20,
    ...(slowMagnitude === null
      ? {}
      : {
          status: {
            kind: 'slow' as const,
            magnitude: slowMagnitude,
            durationTicks: 300,
            chance: 1,
          },
        }),
  };
  return createBattle(
    options({
      deck: ['spear', 'frost'],
      stage: stageDef({ startGold: 100000, baseHp: 9999 }),
      enemyDefs: enemyDefs({ warrior: { speed: 0, hp: 1_000_000, towerAttack: MELEE } }),
      towerDefs: towerDefs({
        spear: { tiers: Array.from({ length: 5 }, () => harmless) },
        frost: { tiers: Array.from({ length: 5 }, () => chiller) },
      }),
      waves: [wave([{ enemyId: 'warrior', count: 1, intervalTicks: 0 }])],
    }),
  );
}

/** 핸드는 덱에서 무작위 3장이라 종류를 지정해 배치하려면 카드를 찾아야 한다 */
function placeById(sim: BattleSim, towerId: TowerId, x: number, z: number): void {
  let h = sim.state.hand.findIndex((c) => c.towerId === towerId);
  for (let guard = 0; h < 0 && guard < 20; guard++) {
    expect(sim.applyCommand({ type: 'refreshHand' })).toBe(true);
    h = sim.state.hand.findIndex((c) => c.towerId === towerId);
  }
  expect(h, `핸드에 ${towerId}`).toBeGreaterThanOrEqual(0);
  place(sim, x, z, h);
}

describe('감속과 공성 (규칙 9)', () => {
  /**
   * 얼음이 없으면 모든 타격이 정가다 — 대조군이자, 아래 테스트가 공허하지 않다는 증거.
   */
  it('감속이 없으면 타격은 항상 정가다', () => {
    const sim = slowSiegeSim(null);
    placeById(sim, 'spear', 0, 1); // 피해자 (스폰에서 거리 1.0)
    placeById(sim, 'frost', 2, 1); // 감속 없는 '얼음' (거리 2.24 — 근접 사거리 1.5 밖이라 맞지 않는다)
    sim.applyCommand({ type: 'callWave' });
    const ev = eventsOf(runTicks(sim, 300), 'towerDamaged');
    expect(ev.length).toBeGreaterThan(3);
    for (const e of ev) expect(e.amount).toBe(MELEE.dmg);
  });

  it('얼어붙은 습격대는 타워를 약하게 친다 (피해 × 감속배율)', () => {
    const sim = slowSiegeSim(0.5);
    placeById(sim, 'spear', 0, 1);
    placeById(sim, 'frost', 2, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = eventsOf(runTicks(sim, 300), 'towerDamaged');
    expect(ev.length).toBeGreaterThan(3);
    // 첫 타격은 감속이 붙기 전이라 정가일 수 있다 — 마지막 타격은 반드시 감속가다
    expect(ev[ev.length - 1]!.amount).toBe(MELEE.dmg * 0.5);
    expect(ev.some((e) => e.amount < MELEE.dmg)).toBe(true);
  });

  it('감속이 세질수록 타워가 받는 피해가 준다 (단조)', () => {
    const total = (mag: number | null): number => {
      const sim = slowSiegeSim(mag);
      placeById(sim, 'spear', 0, 1);
      placeById(sim, 'frost', 2, 1);
      sim.applyCommand({ type: 'callWave' });
      return eventsOf(runTicks(sim, 300), 'towerDamaged').reduce((a, e) => a + e.amount, 0);
    };
    const none = total(null);
    const mid = total(0.35);
    const strong = total(0.55);
    expect(mid).toBeLessThan(none);
    expect(strong).toBeLessThan(mid);
  });
});

// ---------------------------------------------------------------------------
// 정지 사격 — siege.ts 규칙 4 (4-a 멈추는 거리 = 반격당할 거리 / 4-b 유한 정지)
// ---------------------------------------------------------------------------

/** 한 웨이브를 끝까지 돌리며 정지/전진/도달을 집계한다 */
function runPlanting(
  sim: BattleSim,
  ticks: number,
): { holdTicks: number; enemyTicks: number; planted: number; walking: number; leaked: number } {
  const out = { holdTicks: 0, enemyTicks: 0, planted: 0, walking: 0, leaked: 0 };
  for (let i = 0; i < ticks; i++) {
    sim.tick();
    for (const e of sim.state.enemies) {
      out.enemyTicks++;
      if (e.siegeHoldLeft > 0) out.holdTicks++;
    }
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'raidAttack') {
        if (ev.planted) out.planted++;
        else out.walking++;
      } else if (ev.type === 'enemyLeaked') out.leaked++;
    }
  }
  return out;
}

describe('정지 사격 (규칙 4)', () => {
  it('사거리에 들어오면 걸으며 쏘다가, 정지 거리에서 멈춰 선다', () => {
    const sim = siegeSim(PLANTER, { speed: 1, towerRange: 3, toughness: 60 });
    place(sim, 4, 1); // 경로 z=2에서 한 칸 위 — 사거리 3.0에도 정지 거리 2.1에도 걸린다
    sim.applyCommand({ type: 'callWave' });
    const r = runPlanting(sim, 400);
    // 두 국면이 **모두** 나와야 한다. 하나라도 0이면 규칙이 반쪽만 도는 것이다
    expect(r.walking, '걸으며 쏘기').toBeGreaterThan(0);
    expect(r.planted, '정지 사격').toBeGreaterThan(0);
  });

  it('멈춰 선 동안에는 한 발짝도 나아가지 않는다', () => {
    const sim = siegeSim(PLANTER, { speed: 1, towerRange: 3, toughness: 60 });
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    let held = 0;
    let moved = 0;
    for (let i = 0; i < 400; i++) {
      const before = sim.state.enemies[0]?.dist ?? -1;
      sim.tick();
      sim.drainEvents();
      const e = sim.state.enemies[0];
      if (!e || before < 0) continue;
      // 이동 단계는 공성 판정 **뒤**에 돈다 — 틱이 끝난 시점에 서 있으면
      // 그 틱에는 한 발짝도 나아가지 않았어야 한다
      if (e.siegeHoldLeft > 0) {
        expect(e.dist, `정지 중인데 전진했다 (틱 ${i})`).toBe(before);
        held++;
      } else if (e.dist > before) moved++;
    }
    expect(held, '정지 구간이 관측됐다').toBeGreaterThan(10);
    expect(moved, '전진 구간도 관측됐다').toBeGreaterThan(10);
  });

  it('holdTicks가 다하면 놓고 전진한다 (규칙 4-b)', () => {
    const sim = siegeSim({ ...PLANTER, holdTicks: 40 }, { speed: 1, towerRange: 3, toughness: 60 });
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    // 정지가 시작될 때까지 돌린다
    let guard = 0;
    while ((sim.state.enemies[0]?.siegeHoldLeft ?? 0) <= 0 && guard++ < 400) {
      sim.tick();
      sim.drainEvents();
    }
    const e = sim.state.enemies[0];
    expect(e, '정지가 시작됐다').toBeDefined();
    expect(e!.siegeHoldLeft).toBe(40);
    const stuckAt = e!.dist;
    // 상한 40틱 동안은 그 자리, 그 뒤에는 반드시 움직인다
    runTicks(sim, 39);
    expect(sim.state.enemies[0]!.dist, '상한 안에서는 정지').toBe(stuckAt);
    runTicks(sim, 5);
    expect(sim.state.enemies[0]!.siegeHoldLeft, '상한이 다했다').toBe(0);
    expect(sim.state.enemies[0]!.dist, '놓고 전진한다').toBeGreaterThan(stuckAt);
  });

  it('한 번 멈추면 SIEGE_ADVANCE_TICKS를 걷기 전에는 다시 멈추지 못한다 (규칙 4-b)', () => {
    const sim = siegeSim({ ...PLANTER, holdTicks: 20, range: 9 }, { speed: 0.2, towerRange: 6, toughness: 200 });
    // 경로를 따라 타워를 촘촘히 세워 "멈출 구실"이 항상 있게 만든다
    for (let x = 0; x <= 8; x += 2) place(sim, x, 1, 0);
    sim.applyCommand({ type: 'callWave' });
    // 의무는 시간이 아니라 **전진**이므로 실제로 나아간 틱만 센다
    let advancedSinceRelease = Infinity;
    let released = 0;
    let replanted = 0;
    for (let i = 0; i < 1800; i++) {
      const e0 = sim.state.enemies[0];
      const wasHolding = e0 !== undefined && e0.siegeHoldLeft > 0;
      const before = e0?.dist ?? -1;
      sim.tick();
      sim.drainEvents();
      const e = sim.state.enemies[0];
      if (!e) break;
      const nowHolding = e.siegeHoldLeft > 0;
      if (wasHolding && !nowHolding) {
        advancedSinceRelease = e.dist > before ? 1 : 0;
        released++;
      } else if (!wasHolding && nowHolding && advancedSinceRelease !== Infinity) {
        expect(
          advancedSinceRelease,
          `전진 ${advancedSinceRelease}틱 만에 다시 멈췄다 (틱 ${i})`,
        ).toBeGreaterThanOrEqual(SIEGE_ADVANCE_TICKS);
        replanted++;
      } else if (!nowHolding && e.dist > before && advancedSinceRelease !== Infinity) {
        advancedSinceRelease++;
      }
    }
    // 공허하지 않은 검증: 정지→해제→재정지가 실제로 여러 번 일어났다
    expect(released, '정지가 여러 번 끝났다').toBeGreaterThan(1);
    expect(replanted, '다시 멈춘 적이 있다').toBeGreaterThan(0);
  });

  it('정지 듀티가 100%가 되지 않는다 — 타워를 도배해도 전선이 흐른다', () => {
    const sim = siegeSim({ ...PLANTER, range: 9 }, { speed: 1, count: 4, towerRange: 6, toughness: 200 });
    for (let x = 0; x <= 9; x++) place(sim, x, 1, 0);
    sim.applyCommand({ type: 'callWave' });
    const r = runPlanting(sim, 1200);
    expect(r.enemyTicks, '적이 실제로 있었다').toBeGreaterThan(0);
    // 최장 정지 60 + 의무 전진 120 ⇒ 정지 몫은 60/180 = 33% 언저리가 상한이다.
    // 50%는 "어떤 배치로도 절반을 넘지 않는다"는 넉넉한 잣대 — 규칙 4-b가 통째로
    // 빠지면 여기가 97%로 튄다(실제로 구현 중 그렇게 잡혔다).
    expect(r.holdTicks / r.enemyTicks, `정지 듀티 ${r.holdTicks}/${r.enemyTicks}`).toBeLessThan(0.5);
    expect(r.leaked, '전원 기지에 도달했다').toBeGreaterThanOrEqual(4);
  });

  it('죽일 수 없는 타워 40기로 경로를 도배해도 웨이브는 끝난다 (스톨 금지)', () => {
    // 화력 0·사거리 6 = 부술 수도 없고 반격도 못 하는 타워. 규칙 4-a에 따라
    // towerReach가 0이므로 습격대는 그 앞에 서지 않고 걸으며 쏘기만 한다.
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ startGold: 100000, baseHp: 9999 }),
        enemyDefs: enemyDefs({ warrior: { speed: 0.8, hp: 1_000_000, towerAttack: { ...PLANTER, range: 9 } } }),
        towerDefs: towerDefs({
          spear: {
            toughness: 1.5,
            tiers: Array.from({ length: 5 }, () => ({ dmg: 0, cooldownTicks: 600, range: 6, cost: 10 })),
          },
        }),
        waves: [wave([{ enemyId: 'warrior', count: 4, intervalTicks: 5 }])],
      }),
    );
    let placed = 0;
    for (let z = 0; z <= 4 && placed < 40; z++) {
      for (let x = 0; x <= 9 && placed < 40; x++) {
        if (z === 2) continue; // 경로 행
        if (!sim.canPlaceAt(x, z)) {
          if (sim.hasScenery(x, z)) sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z });
        }
        if (sim.canPlaceAt(x, z) && sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ: z })) placed++;
      }
    }
    expect(placed, '도배 기수').toBeGreaterThanOrEqual(30);
    sim.applyCommand({ type: 'callWave' });
    const r = runPlanting(sim, 3000);
    expect(r.leaked, '전원이 기지에 도달한다').toBeGreaterThanOrEqual(4);
    expect(sim.state.phase, '웨이브가 끝난다').not.toBe('wave');
  });

  it('실제 4종 + 도배에서도 웨이브는 끝난다', () => {
    const raiders: EnemyId[] = ['blade', 'lancer', 'archer', 'hexer'];
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ startGold: 100000, baseHp: 999999 }),
        // 실제 스펙 그대로 — hp만 올려 타워에 죽지 않게 한다(스톨만 본다)
        enemyDefs: enemyDefs(
          Object.fromEntries(
            raiders.map((id) => [id, { hp: 200000, towerAttack: ENEMY_DEFS[id].towerAttack }]),
          ),
        ),
        towerDefs: towerDefs({
          spear: {
            toughness: 40,
            tiers: Array.from({ length: 5 }, () => ({ dmg: 0.0001, cooldownTicks: 600, range: 6, cost: 10 })),
          },
        }),
        waves: [wave(raiders.map((id) => ({ enemyId: id, count: 2, intervalTicks: 5 })))],
      }),
    );
    for (let z of [0, 1, 3, 4]) {
      for (let x = 0; x <= 9; x++) {
        if (sim.hasScenery(x, z)) sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z });
        sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ: z });
      }
    }
    expect(sim.state.towers.length).toBeGreaterThanOrEqual(30);
    sim.applyCommand({ type: 'callWave' });
    const r = runPlanting(sim, 6000);
    expect(r.leaked, '8마리 전원 도달').toBeGreaterThanOrEqual(8);
    expect(r.planted, '실제로 멈춰 서서 쐈다').toBeGreaterThan(0);
  });

  /**
   * SIEGE_ENGAGE_RANGE가 **1칸과 2칸을 가른다**는 것을 잠근다 — 이 게임에서
   * "경로에서 얼마나 떨어뜨렸는가가 곧 위험도"(siege.ts 규칙 1)라는 약속의 실체다.
   *
   * ⚠ 10단계에서 **두 칸 → 한 칸**으로 옮겼다. 9단계까지는 정지선이 2.1이라 두 칸에
   * 세운 타워도 붙잡혔고, 이 검증이 "칼날 위가 아니다"만 보느라 그 사실을 통과시켰다.
   * 정지선이 1.7이 된 지금은 **두 칸이 정지 사격을 완전히 막는다**는 쪽이 잠글 값이라
   * 대조군으로 함께 건다 — 한쪽만 보면 정지선을 0으로 만들어도 초록이 된다.
   * (밀착 배치가 실제로 벌을 받는지는 autoplay.test.ts 4번이 판 단위로 잠근다)
   */
  it('한 칸에 붙이면 5종 전부 멈춰 서고, 두 칸이면 아무도 멈추지 않는다', () => {
    const runAt = (id: EnemyId, cellZ: number): { planted: number; walking: number } => {
      const sim = createBattle(
        options({
          deck: ['spear'],
          stage: stageDef({ startGold: 100000, baseHp: 99999 }),
          enemyDefs: enemyDefs({ [id]: { hp: 100000, towerAttack: ENEMY_DEFS[id].towerAttack } }),
          towerDefs: towerDefs({
            spear: {
              toughness: 200,
              tiers: Array.from({ length: 5 }, () => ({ dmg: 0.0001, cooldownTicks: 600, range: 4, cost: 50 })),
            },
          }),
          waves: [wave([{ enemyId: id, count: 2, intervalTicks: 5 }])],
        }),
      );
      for (const x of [3, 6]) {
        if (sim.hasScenery(x, cellZ)) sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ });
        sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ });
      }
      sim.applyCommand({ type: 'callWave' });
      return runPlanting(sim, 900);
    };
    // 경로는 z=2 직선이므로 z=1이 한 칸(1.0), z=0이 두 칸(2.0)이다
    for (const id of ['blade', 'lancer', 'archer', 'hexer', 'warrior'] as EnemyId[]) {
      const near = runAt(id, 1);
      expect(near.planted, `${id} 한 칸 — 정지 사격`).toBeGreaterThan(0);
      expect(near.walking, `${id} 한 칸 — 걸으며 쏘기`).toBeGreaterThan(0);
      const far = runAt(id, 0);
      expect(far.planted, `${id} 두 칸 — 아무도 멈추지 못한다`).toBe(0);
      // 그래도 사거리 안이라 지나가며 쏘긴 쏜다 (전원 원거리 = 거리로 지워지지 않는다)
      expect(far.walking, `${id} 두 칸 — 지나가며 쏘기`).toBeGreaterThan(0);
    }
  });

  it('정지 거리는 대상 타워의 반격 반경을 넘지 못한다 (규칙 4-a)', () => {
    // 화력 0(전쟁북 같은 지원 타워)은 반격하지 못한다 → 그 앞에는 절대 서지 않는다.
    // 같은 배치에서 화력만 켜면 선다 — 대조가 있어야 이 명제가 공허하지 않다.
    const mk = (dmg: number): BattleSim =>
      createBattle(
        options({
          deck: ['spear'],
          stage: stageDef({ startGold: 100000, baseHp: 9999 }),
          enemyDefs: enemyDefs({ warrior: { speed: 1, hp: 100000, towerAttack: PLANTER } }),
          towerDefs: towerDefs({
            spear: {
              toughness: 100,
              tiers: Array.from({ length: 5 }, () => ({ dmg, cooldownTicks: 600, range: 0.5, cost: 50 })),
            },
          }),
          waves: [wave([{ enemyId: 'warrior', count: 1, intervalTicks: 0 }])],
        }),
      );
    // 타워 사거리 0.5 < 정지 거리 2.1 → 규칙 4-a의 min()이 0.5로 깎는다.
    // 경로(z=2)에서 한 칸 위(z=1)라 최소 거리가 1.0 > 0.5 — 즉 절대 사거리 안에 못 들어온다
    const armed = mk(5);
    place(armed, 4, 1);
    armed.applyCommand({ type: 'callWave' });
    const ra = runPlanting(armed, 400);
    expect(ra.walking, '쏘긴 쏜다').toBeGreaterThan(0);
    expect(ra.planted, '반격 반경 밖이라 멈추지 않는다').toBe(0);

    // 반격 반경을 정지 거리 위로 올리면 같은 자리에서 선다
    const wide = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ startGold: 100000, baseHp: 9999 }),
        enemyDefs: enemyDefs({ warrior: { speed: 1, hp: 100000, towerAttack: PLANTER } }),
        towerDefs: towerDefs({
          spear: {
            toughness: 100,
            tiers: Array.from({ length: 5 }, () => ({ dmg: 5, cooldownTicks: 600, range: 3, cost: 50 })),
          },
        }),
        waves: [wave([{ enemyId: 'warrior', count: 1, intervalTicks: 0 }])],
      }),
    );
    place(wide, 4, 1);
    wide.applyCommand({ type: 'callWave' });
    expect(runPlanting(wide, 400).planted, '반격 반경 안이면 선다').toBeGreaterThan(0);
  });

  it('순수 걸으며 쏘기(stopToAttack=false)는 쏘면서도 계속 전진한다', () => {
    const sim = siegeSim(RANGED, { speed: 1 });
    place(sim, 1, 1);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 90);
    const d0 = sim.state.enemies[0]!.dist;
    runTicks(sim, 60);
    expect(sim.state.enemies[0]!.dist).toBeGreaterThan(d0);
    expect(sim.state.enemies[0]!.siegeHoldLeft).toBe(0);
    expect(sim.towerAt(1, 1)!.hp).toBeLessThan(sim.towerAt(1, 1)!.maxHp);
  });
});

// ---------------------------------------------------------------------------
// 연출 계약 — raidAttack 이벤트 + EnemyState 의 per-frame 상태
// ---------------------------------------------------------------------------
describe('연출 계약 (raidAttack / attackAnim)', () => {
  it('타격마다 raidAttack이 towerDamaged **앞에** 나가고 두 amount가 같다', () => {
    const sim = siegeSim(PLANTER, { speed: 1, towerRange: 3, toughness: 60 });
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 400);
    const iAtk = evs.findIndex((e) => e.type === 'raidAttack');
    const iDmg = evs.findIndex((e) => e.type === 'towerDamaged');
    expect(iAtk).toBeGreaterThanOrEqual(0);
    expect(iAtk, '던지는 것이 먼저, 맞는 것이 나중').toBeLessThan(iDmg);
    expect(eventsOf(evs, 'raidAttack')).toHaveLength(eventsOf(evs, 'towerDamaged').length);
    const a = eventsOf(evs, 'raidAttack')[0]!;
    const d = eventsOf(evs, 'towerDamaged')[0]!;
    expect(a.amount).toBe(d.amount);
    expect(a.towerId).toBe(d.towerId);
    expect(a.attackerId).toBe(d.attackerId);
    expect(a.ranged).toBe(true);
    expect(a.animTicks).toBe(Math.min(RAID_ATTACK_ANIM_TICKS, PLANTER.cooldownTicks));
  });

  it('aim/dist가 발사 시점의 공격자→타워 기하와 일치한다', () => {
    const sim = siegeSim(PLANTER, { speed: 1, towerRange: 3, toughness: 60 });
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    for (const ev of runTicks(sim, 400)) {
      if (ev.type !== 'raidAttack') continue;
      const dx = ev.cellX - ev.x;
      const dz = ev.cellZ - ev.z;
      expect(ev.aim).toBeCloseTo(Math.atan2(dz, dx), 10);
      expect(ev.dist).toBeCloseTo(Math.hypot(dx, dz), 10);
      expect(ev.dist).toBeLessThanOrEqual(PLANTER.range + 1e-9);
    }
  });

  it('attackAnimLeft가 타격 순간 채워지고 매 틱 1씩 준다', () => {
    const sim = siegeSim(PLANTER, { speed: 1, towerRange: 3, toughness: 60 });
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    let seen = false;
    for (let i = 0; i < 400; i++) {
      const before = sim.state.enemies[0]?.attackAnimLeft ?? 0;
      sim.tick();
      const e = sim.state.enemies[0];
      const fired = sim.drainEvents().some((ev) => ev.type === 'raidAttack');
      if (!e) break;
      if (fired) {
        expect(e.attackAnimLeft).toBe(e.attackAnimTicks);
        expect(e.attackAnimTicks).toBe(Math.min(RAID_ATTACK_ANIM_TICKS, PLANTER.cooldownTicks));
        seen = true;
      } else if (before > 0) {
        expect(e.attackAnimLeft).toBe(before - 1);
      }
    }
    expect(seen).toBe(true);
  });

  it('planted 플래그가 그 순간의 siegeHoldLeft와 일치한다', () => {
    const sim = siegeSim(PLANTER, { speed: 1, towerRange: 3, toughness: 60 });
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    let both = 0;
    for (let i = 0; i < 400; i++) {
      sim.tick();
      const e = sim.state.enemies[0];
      for (const ev of sim.drainEvents()) {
        if (ev.type !== 'raidAttack' || !e) continue;
        expect(ev.planted).toBe(e.siegeHoldLeft > 0);
        both |= ev.planted ? 1 : 2;
      }
    }
    expect(both, '정지 사격과 걸으며 쏘기가 둘 다 관측됐다').toBe(3);
  });
});

describe('타워 파괴', () => {
  /** 한 방에 부수는 스펙 — 파괴 경로만 검증한다 */
  const CRUSH: TowerAttackSpec = { ...MELEE, dmg: 100000 };

  it('hp 0 → 즉시 제거, towerDestroyed 발행, 그 칸은 다시 건설 가능', () => {
    const sim = siegeSim(CRUSH);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' }); // 조기 호출 보너스가 먼저 정산되게 둔다
    const goldBefore = sim.state.gold;
    const evs = runTicks(sim, 60);
    const dead = eventsOf(evs, 'towerDestroyed');
    expect(dead).toHaveLength(1);
    expect(dead[0]!.cellX).toBe(0);
    expect(dead[0]!.cellZ).toBe(1);
    expect(dead[0]!.tier).toBe(0);
    expect(dead[0]!.killerId).toBeGreaterThan(0);
    // 제거됨 + 칸이 빔
    expect(sim.towerAt(0, 1)).toBeNull();
    expect(sim.state.towers).toHaveLength(0);
    expect(sim.canPlaceAt(0, 1)).toBe(true);
    // 환불 없음 (판매와 구분) — 골드는 오히려 배치 비용만큼 줄어 있어야 한다
    expect(sim.state.gold).toBe(goldBefore);
    expect(eventsOf(evs, 'towerSold')).toHaveLength(0);
    // 같은 칸에 다시 지을 수 있다
    place(sim, 0, 1, 0);
    expect(sim.towerAt(0, 1)).not.toBeNull();
  });

  it('부서진 타워는 그 틱에 발사하지 못한다 (회수가 발사보다 먼저)', () => {
    const sim = siegeSim(CRUSH);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 60);
    const destroyIdx = evs.findIndex((e) => e.type === 'towerDestroyed');
    expect(destroyIdx).toBeGreaterThanOrEqual(0);
    const firedAfter = evs.slice(destroyIdx).filter((e) => e.type === 'towerFired');
    expect(firedAfter).toHaveLength(0);
  });

  it('오버킬이 와도 towerDestroyed는 한 번만 나간다', () => {
    const sim = siegeSim(CRUSH, { count: 5 });
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    expect(eventsOf(runTicks(sim, 90), 'towerDestroyed')).toHaveLength(1);
  });
});

describe('업그레이드 / 수리 정책', () => {
  it('업그레이드는 늘어난 최대치만큼만 회복한다 (누적 피해는 유지)', () => {
    const sim = siegeSim(MELEE);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 120);
    const t = sim.towerAt(0, 1)!;
    const lost = t.maxHp - t.hp;
    expect(lost).toBeGreaterThan(0);
    const prevMax = t.maxHp;
    expect(sim.applyCommand({ type: 'upgradeTower', towerId: t.id })).toBe(true);
    expect(t.maxHp).toBe(towerMaxHpFor(1));
    expect(t.maxHp).toBeGreaterThan(prevMax);
    expect(t.maxHp - t.hp).toBe(lost); // 상처는 그대로
  });

  it('준비 단계에는 자동 수리된다', () => {
    const sim = siegeSim(MELEE);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 120);
    const t = sim.towerAt(0, 1)!;
    const damaged = t.hp;
    expect(damaged).toBeLessThan(t.maxHp);
    // 웨이브 중에는 회복하지 않는다
    runTicks(sim, 1);
    expect(t.hp).toBeLessThanOrEqual(damaged);
  });

  it('prep 페이즈에서 실제로 체력이 돌아온다', () => {
    // 적 없이 prep 상태를 유지하며 타워만 인위적으로 깎는다
    const sim = siegeSim(undefined);
    place(sim, 0, 1);
    const t = sim.towerAt(0, 1)!;
    t.hp = 10;
    runTicks(sim, 30); // prep 1초 = 회복 2회
    expect(t.hp).toBeGreaterThan(10);
    expect(t.hp).toBeLessThanOrEqual(t.maxHp);
  });
});

// ---------------------------------------------------------------------------
// 침묵 (부족 주술사 hexer 의 저주) — siege.ts 규칙 8
// ---------------------------------------------------------------------------

/** 저주 = 원거리 타격 + 침묵. 피해는 작게 둬 "부수는 것과 다른 축"임을 드러낸다 */
const HEX: TowerAttackSpec = {
  dmg: 1,
  range: 3,
  cooldownTicks: 60,
  stopToAttack: false,
  holdTicks: 0,
  ranged: true,
  silenceTicks: 20,
};

/**
 * 저주 관찰용 전장 — siegeSim 과 달리 타워가 **실제로 쏜다**(침묵 여부를 발사로 읽는다).
 * 적은 speed 0 + 초대형 hp 라 죽지도 움직이지도 않는다.
 */
function hexSim(spec: TowerAttackSpec | undefined): BattleSim {
  return createBattle(
    options({
      deck: ['spear'],
      stage: stageDef({ startGold: 100000, baseHp: 9999 }),
      enemyDefs: enemyDefs({
        hexer: { speed: 0, hp: 100000, ...(spec ? { towerAttack: spec } : {}) },
      }),
      waves: [wave([{ enemyId: 'hexer', count: 1, intervalTicks: 0 }])],
    }),
  );
}

describe('침묵 (주술사의 저주)', () => {
  it('저주가 걸린 타워는 쏘지 못한다 (같은 조건에서 발사 횟수가 준다)', () => {
    const withHex = hexSim(HEX);
    place(withHex, 0, 1);
    withHex.applyCommand({ type: 'callWave' });
    const hexed = eventsOf(runTicks(withHex, 300), 'towerFired').length;

    const plain = hexSim(undefined); // 같은 적, 저주만 없음
    place(plain, 0, 1);
    plain.applyCommand({ type: 'callWave' });
    const free = eventsOf(runTicks(plain, 300), 'towerFired').length;

    expect(free).toBeGreaterThan(0);
    // 침묵 중에는 쿨다운도 멈추므로 잃는 발사 수가 침묵 시간에 비례한다 (지연이 아니라 손실)
    expect(hexed).toBeLessThan(free);
    expect(hexed).toBeLessThanOrEqual(Math.ceil(free * 0.8));
  });

  it('towerSilenced 이벤트가 나가고 잔여 틱이 매 틱 준다', () => {
    const sim = hexSim(HEX);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = eventsOf(runTicks(sim, 40), 'towerSilenced');
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0]!.casterDefId).toBe('hexer');
    expect(ev[0]!.ticksLeft).toBe(HEX.silenceTicks);
    const t = sim.towerAt(0, 1)!;
    const before = t.silenceLeft;
    sim.tick();
    // 같은 틱에 재적용되지 않는 한 1씩 준다 (쿨다운 60 > 침묵 20이라 창이 열린다)
    expect(t.silenceLeft).toBe(Math.max(0, before - 1));
  });

  it('저주는 반드시 풀린다 — 침묵 시간 < 쿨다운이라 발사 창이 열린다', () => {
    const sim = hexSim(HEX);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 300);
    const t = sim.towerAt(0, 1)!;
    expect(t.silenceLeft).toBeLessThanOrEqual(HEX.silenceTicks!);
    // 침묵 20 < 쿨다운 60 이라 매 주기마다 발사 창이 열린다
    expect(eventsOf(runTicks(sim, 120), 'towerFired').length).toBeGreaterThan(0);
  });

  it('여러 주술사가 겹쳐도 침묵은 누적되지 않는다 (max 갱신)', () => {
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ startGold: 100000, baseHp: 9999 }),
        enemyDefs: enemyDefs({ hexer: { speed: 0, hp: 100000, towerAttack: HEX } }),
        waves: [wave([{ enemyId: 'hexer', count: 5, intervalTicks: 0 }])],
      }),
    );
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    const t = sim.towerAt(0, 1)!;
    for (let i = 0; i < 300; i++) {
      sim.tick();
      sim.drainEvents();
      // 5명이 동시에 걸어도 잔여 시간은 절대 1회분을 넘지 않는다 (영구 봉쇄 금지)
      expect(t.silenceLeft).toBeLessThanOrEqual(HEX.silenceTicks!);
    }
  });

  it('그 타격으로 부서진 타워에는 저주를 걸지 않는다', () => {
    const kill: TowerAttackSpec = { ...HEX, dmg: 100000, cooldownTicks: 30 };
    const sim = hexSim(kill);
    place(sim, 0, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 60);
    expect(eventsOf(ev, 'towerDestroyed').length).toBe(1);
    expect(eventsOf(ev, 'towerSilenced').length).toBe(0);
  });

  it('침묵 상태가 해시에 반영된다 (1틱만 어긋나도 갈라진다)', () => {
    const a = hexSim(HEX);
    place(a, 0, 1);
    a.applyCommand({ type: 'callWave' });
    runTicks(a, 45);
    const h0 = a.hash();
    a.state.towers[0]!.silenceLeft += 1; // 다른 건 전부 동일
    expect(a.hash()).not.toBe(h0);
  });
});
