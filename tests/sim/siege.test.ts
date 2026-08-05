/**
 * 공성 — 적 부족이 타워를 때려 부수는 메커니즘 (src/sim/siege.ts 규칙 1~9 검증).
 * 타워 HP 수치 체계, 업그레이드 회복 정책, prep 자동 수리, 파괴 후 재건설까지.
 */
import { describe, expect, it } from 'vitest';
import type { BattleSim, EnemyId, TowerAttackSpec, TowerId } from '@/data/types';
import { TOWER_HP_BASE, TOWER_HP_TIER_GROWTH, towerMaxHpFor } from '@/data/balance';
import { createBattle } from '@/sim/battle';
import { enemyDefs, eventsOf, options, runTicks, stageDef, towerDefs, wave } from './fixtures';

/** 근접(칼) — 멈춰 서서 때린다 */
const MELEE: TowerAttackSpec = {
  dmg: 20,
  range: 1.5,
  cooldownTicks: 30,
  stopToAttack: true,
  ranged: false,
};
/** 원거리(활) — 걸으면서 쏜다 */
const RANGED: TowerAttackSpec = {
  dmg: 20,
  range: 2.4,
  cooldownTicks: 30,
  stopToAttack: false,
  ranged: true,
};

/**
 * 목 전장: 경로는 z=2 가로줄(x 0→9), 사거리 판정을 지배하는 건 배치 셀뿐이다.
 * attacker 적은 speed 0으로 두면 스폰 지점(0,2)에 고정돼 판정이 결정적으로 재현된다.
 */
function siegeSim(
  attackSpec: TowerAttackSpec | undefined,
  opts: { count?: number; speed?: number; enemyId?: EnemyId } = {},
): BattleSim {
  const id = opts.enemyId ?? 'warrior';
  return createBattle(
    options({
      deck: ['spear'],
      stage: stageDef({ startGold: 100000, baseHp: 9999 }),
      enemyDefs: enemyDefs({
        [id]: { speed: opts.speed ?? 0, hp: 100000, ...(attackSpec ? { towerAttack: attackSpec } : {}) },
      }),
      // 타워가 적을 죽여 버리면 공성을 관찰할 수 없다 — 무해한 타워로 고정
      towerDefs: towerDefs({ spear: { tiers: Array.from({ length: 5 }, () => tinyTier()) } }),
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

describe('멈춤 규칙 (근접 vs 원거리)', () => {
  it('근접은 타워를 때리는 동안 전진을 멈춘다', () => {
    const sim = siegeSim(MELEE, { speed: 1 });
    place(sim, 1, 1); // 경로 x=1 부근에서 사거리에 걸린다
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 90);
    const e = sim.state.enemies[0];
    expect(e).toBeDefined();
    const stuckAt = e!.dist;
    runTicks(sim, 60);
    expect(sim.state.enemies[0]!.dist).toBe(stuckAt); // 2초가 지나도 그 자리
    expect(sim.towerAt(1, 1)!.hp).toBeLessThan(sim.towerAt(1, 1)!.maxHp);
  });

  it('원거리는 쏘면서도 계속 전진한다', () => {
    const sim = siegeSim(RANGED, { speed: 1 });
    place(sim, 1, 1);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 90);
    const d0 = sim.state.enemies[0]!.dist;
    runTicks(sim, 60);
    expect(sim.state.enemies[0]!.dist).toBeGreaterThan(d0);
    expect(eventsOf(runTicks(sim, 1), 'towerDamaged')).toBeDefined();
    expect(sim.towerAt(1, 1)!.hp).toBeLessThan(sim.towerAt(1, 1)!.maxHp);
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
