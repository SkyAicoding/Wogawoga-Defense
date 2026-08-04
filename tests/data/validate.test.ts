/** 타워/적/전역 상수 데이터 검증 — 밸런스 수치를 계약으로 잠근다. */
import { describe, expect, it } from 'vitest';
import type { EnemyId, TowerId } from '@/data/types';
import * as balance from '@/data/balance';
import { ALL_ENEMY_IDS, BOUNTY_PER_COST, ENEMY_DEFS } from '@/data/enemies';
import { ALL_TOWER_IDS, TOWER_DEFS } from '@/data/towers';

const EXPECTED_TOWERS: TowerId[] = [
  'spear', 'catapult', 'lightning', 'brazier', 'frost', 'poison', 'ballista', 'drum',
];
const EXPECTED_ENEMIES: EnemyId[] = [
  'raptor', 'compy', 'trike', 'ptera', 'ankylo', 'boar',
  'warrior', 'shaman', 'mammoth', 'spino', 'trex', 'golem',
];

describe('towers', () => {
  it('8종 전부 존재하고 각 5티어', () => {
    expect(ALL_TOWER_IDS.length).toBe(8);
    for (const id of EXPECTED_TOWERS) {
      const def = TOWER_DEFS[id];
      expect(def, id).toBeDefined();
      expect(def.id).toBe(id);
      expect(def.tiers.length, `${id} tiers`).toBe(5);
      for (const t of def.tiers) {
        expect(t.dmg).toBeGreaterThanOrEqual(0);
        expect(t.cooldownTicks).toBeGreaterThan(0);
        expect(t.range).toBeGreaterThan(0);
        expect(t.cost).toBeGreaterThan(0);
      }
    }
  });

  it('DPS(dmg/cd)가 티어 단조 증가하며 성장률 1.55~1.75 (버프 전용 drum 제외)', () => {
    for (const id of EXPECTED_TOWERS) {
      if (id === 'drum') continue;
      const tiers = TOWER_DEFS[id].tiers;
      for (let i = 1; i < tiers.length; i++) {
        const prev = tiers[i - 1]!;
        const cur = tiers[i]!;
        const ratio = cur.dmg / cur.cooldownTicks / (prev.dmg / prev.cooldownTicks);
        expect(ratio, `${id} T${i} DPS 성장`).toBeGreaterThan(1.55);
        expect(ratio, `${id} T${i} DPS 성장`).toBeLessThan(1.75);
      }
    }
  });

  it('cost가 티어 단조 증가하며 성장률 1.9~2.1', () => {
    for (const id of EXPECTED_TOWERS) {
      const tiers = TOWER_DEFS[id].tiers;
      for (let i = 1; i < tiers.length; i++) {
        const ratio = tiers[i]!.cost / tiers[i - 1]!.cost;
        expect(ratio, `${id} T${i} cost 성장`).toBeGreaterThanOrEqual(1.9);
        expect(ratio, `${id} T${i} cost 성장`).toBeLessThanOrEqual(2.1);
      }
    }
  });

  it('starCosts는 5단계 상승 곡선', () => {
    for (const id of EXPECTED_TOWERS) {
      const costs = TOWER_DEFS[id].starCosts;
      expect(costs.length, id).toBe(5);
      for (let i = 0; i < costs.length; i++) {
        const [shards, amber] = costs[i]!;
        expect(shards).toBeGreaterThan(0);
        expect(amber).toBeGreaterThan(0);
        if (i > 0) {
          expect(shards, `${id} 조각 상승`).toBeGreaterThan(costs[i - 1]![0]);
          expect(amber, `${id} 호박 상승`).toBeGreaterThan(costs[i - 1]![1]);
        }
      }
    }
  });

  it('앵커: spear T1 = dmg12/cd15/range2.6/cost100', () => {
    const t1 = TOWER_DEFS.spear.tiers[0]!;
    expect(t1.dmg).toBe(12);
    expect(t1.cooldownTicks).toBe(15);
    expect(t1.range).toBe(2.6);
    expect(t1.cost).toBe(100);
  });

  it('해금표: spear/catapult start, frost s1, lightning s2, poison s3, ballista s4, brazier 600, drum 900', () => {
    expect(TOWER_DEFS.spear.unlock).toEqual({ type: 'start' });
    expect(TOWER_DEFS.catapult.unlock).toEqual({ type: 'start' });
    expect(TOWER_DEFS.frost.unlock).toEqual({ type: 'start' });
    expect(TOWER_DEFS.lightning.unlock).toEqual({ type: 'stage', stage: 1 });
    expect(TOWER_DEFS.poison.unlock).toEqual({ type: 'stage', stage: 2 });
    expect(TOWER_DEFS.ballista.unlock).toEqual({ type: 'stage', stage: 3 });
    expect(TOWER_DEFS.brazier.unlock).toEqual({ type: 'amber', cost: 600 });
    expect(TOWER_DEFS.drum.unlock).toEqual({ type: 'amber', cost: 900 });
  });

  it('종별 특수 스펙: 스플래시/체인/오라/상태이상 정합', () => {
    for (const t of TOWER_DEFS.catapult.tiers) {
      expect(t.splash).toBeDefined();
      expect(t.splash!.falloff).toBe(0.4);
      expect(t.splash!.radius).toBeGreaterThanOrEqual(1.2);
    }
    for (const t of TOWER_DEFS.lightning.tiers) {
      expect(t.chain).toEqual(expect.objectContaining({ jumps: 3, decay: 0.7 }));
    }
    for (const t of TOWER_DEFS.frost.tiers) {
      expect(t.status!.kind).toBe('slow');
      expect(t.status!.magnitude).toBeGreaterThanOrEqual(0.35);
      expect(t.status!.magnitude).toBeLessThanOrEqual(0.55);
    }
    for (const t of TOWER_DEFS.poison.tiers) expect(t.status!.kind).toBe('poison');
    for (const t of TOWER_DEFS.brazier.tiers) {
      expect(t.aura!.dmgPerStatusTick).toBe(t.dmg); // dmg 필드는 오라 피해 미러
      expect(t.aura!.status!.kind).toBe('burn');
    }
    expect(TOWER_DEFS.ballista.tiers[0]!.range).toBe(5.5);
    expect(TOWER_DEFS.ballista.tiers[0]!.cooldownTicks).toBe(60);
    expect(TOWER_DEFS.ballista.canTargetAir).toBe(true);
    expect(TOWER_DEFS.catapult.canTargetAir).toBe(false);
  });

  it('drum 버프가 0.15→0.4로 단조 증가', () => {
    const tiers = TOWER_DEFS.drum.tiers;
    expect(tiers[0]!.aura!.dmgPct).toBe(0.15);
    expect(tiers[4]!.aura!.dmgPct).toBe(0.4);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!.aura!.dmgPct!).toBeGreaterThan(tiers[i - 1]!.aura!.dmgPct!);
      expect(tiers[i]!.aura!.ratePct!).toBeGreaterThan(tiers[i - 1]!.aura!.ratePct!);
    }
  });
});

describe('enemies', () => {
  it('12종 전부 존재, bounty/cost/hp 양수', () => {
    expect(ALL_ENEMY_IDS.length).toBe(12);
    for (const id of EXPECTED_ENEMIES) {
      const def = ENEMY_DEFS[id];
      expect(def, id).toBeDefined();
      expect(def.id).toBe(id);
      expect(def.hp).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.bounty).toBeGreaterThan(0);
      expect(def.cost).toBeGreaterThan(0);
      expect(def.baseDamage).toBeGreaterThanOrEqual(1);
      expect(def.radius).toBeGreaterThan(0);
    }
  });

  it('bounty = round(cost × 0.8) 규칙', () => {
    for (const id of EXPECTED_ENEMIES) {
      const def = ENEMY_DEFS[id];
      expect(def.bounty, id).toBe(Math.round(def.cost * BOUNTY_PER_COST));
    }
  });

  it('보스 플래그는 spino/trex만, 특수 능력 정합', () => {
    for (const id of EXPECTED_ENEMIES) {
      const def = ENEMY_DEFS[id];
      expect(!!def.boss, id).toBe(id === 'spino' || id === 'trex');
      expect(def.flying, id).toBe(id === 'ptera');
      expect(!!def.enrage, id).toBe(id === 'boar');
      expect(!!def.shieldHits, id).toBe(id === 'warrior');
      expect(!!def.healAura, id).toBe(id === 'shaman');
    }
    expect(ENEMY_DEFS.trex.baseDamage).toBe(10);
    expect(ENEMY_DEFS.spino.baseDamage).toBeGreaterThanOrEqual(5);
  });
});

describe('balance 상수 (sim 하드코딩과 일치해야 함)', () => {
  it('경제/전투 상수', () => {
    expect(balance.SELL_REFUND_RATE).toBe(0.6);
    expect(balance.REFRESH_BASE_COST).toBe(20);
    expect(balance.REFRESH_COST_GROWTH).toBe(1.6);
    expect(balance.HAND_SIZE).toBe(3);
    expect(balance.PREP_TICKS_FIRST).toBe(150);
    expect(balance.PREP_TICKS_LATER).toBe(90);
    expect(balance.EARLY_CALL_RATE).toBe(0.15);
    expect(balance.ENDLESS_HP_GROWTH).toBe(1.06);
    expect(balance.WAVE_GOLD_BASE).toBe(30);
    expect(balance.WAVE_GOLD_PER_WAVE).toBe(6);
  });
});
