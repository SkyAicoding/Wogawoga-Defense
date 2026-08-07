/** 타워/적/전역 상수 데이터 검증 — 밸런스 수치를 계약으로 잠근다. */
import { describe, expect, it } from 'vitest';
import type { EnemyId, TowerId } from '@/data/types';
import * as balance from '@/data/balance';
import { SIEGE_ADVANCE_TICKS, SIEGE_ENGAGE_RANGE } from '@/data/balance';
import { ALL_ENEMY_IDS, BOUNTY_PER_COST, ENEMY_DEFS } from '@/data/enemies';
import { ALL_TOWER_IDS, TOWER_DEFS } from '@/data/towers';

const EXPECTED_TOWERS: TowerId[] = [
  'spear', 'catapult', 'lightning', 'brazier', 'frost', 'poison', 'ballista', 'drum',
];
const EXPECTED_ENEMIES: EnemyId[] = [
  'raptor', 'compy', 'trike', 'ptera', 'ankylo', 'boar',
  'warrior', 'shaman', 'blade', 'lancer', 'archer', 'hexer',
  'mammoth', 'spino', 'trex', 'golem',
];
/** 부족 습격대 — 타워를 부수러 오는 사람 무리 (기지로 직행하는 warrior/shaman과 역할이 다르다) */
const RAIDERS: EnemyId[] = ['blade', 'lancer', 'archer', 'hexer'];

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
  it('16종 전부 존재, bounty/cost/hp 양수', () => {
    expect(ALL_ENEMY_IDS.length).toBe(16);
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

  /**
   * towerAttack을 가진 적 = 사람 부족뿐이다 (공룡/짐승은 기지로 직행).
   * 1단계는 warrior 하나로 메커니즘을 증명했고, 2단계가 습격대 4종을 추가했다.
   */
  it('towerAttack은 부족(사람)에만 있고 스펙이 정합적이다', () => {
    const attackers: EnemyId[] = ['warrior', ...RAIDERS];
    for (const id of EXPECTED_ENEMIES) {
      expect(!!ENEMY_DEFS[id].towerAttack, id).toBe(attackers.includes(id));
    }
    for (const id of attackers) {
      const atk = ENEMY_DEFS[id].towerAttack!;
      expect(atk.dmg, id).toBeGreaterThan(0);
      expect(atk.cooldownTicks, id).toBeGreaterThanOrEqual(1);
      // 타워를 때리는 종은 **전부 원거리이고 전부 멈춰 선다** (siege.ts 규칙 4).
      // 근접(옛 규약)은 경로 이격 두 칸으로 영구 무력화돼 기능이 존재하지 않았다.
      expect(atk.ranged, id).toBe(true);
      expect(atk.stopToAttack, id).toBe(true);
      // 정지 규칙이 물리려면 사거리가 정지 판정 거리보다 커야 한다 — 짧으면
      // "닿지도 않는 거리에 멈춰 선다"가 되어 규칙 4-a의 min()이 조용히 무력화된다
      expect(atk.range, id).toBeGreaterThan(SIEGE_ENGAGE_RANGE);
      // 그리고 유한 정지(규칙 4-b)의 상한이 반드시 있어야 한다 — 0이면 아예 안 서고,
      // 상한 없이 크면 옛 규칙 4가 경고한 전선 영구 정체로 되돌아간다
      expect(atk.holdTicks, id).toBeGreaterThan(0);
      expect(atk.holdTicks, id).toBeLessThan(SIEGE_ADVANCE_TICKS);
    }
  });

  /**
   * 역할 분리의 축이 바뀌었다. 옛 축은 "근접 2 / 원거리 2"였는데, 전원이 원거리가 된
   * 지금은 **사거리 · 버티는 시간 · 한 방 대 연사 · 특수** 넷으로 가른다.
   * 앞의 둘은 네 종이 전부 서로 다른 값이어야 한다 — 같아지는 순간 두 종이
   * 화면에서 구분되지 않는다("왜 둘 다 있는가"에 답할 수 없다).
   */
  it('습격대 역할 분리: 어느 두 종도 네 축에서 겹치지 않고, 침묵은 hexer 전용', () => {
    const ranges = RAIDERS.map((id) => ENEMY_DEFS[id].towerAttack!.range);
    const holds = RAIDERS.map((id) => ENEMY_DEFS[id].towerAttack!.holdTicks);
    // 사거리는 4종이 전부 다르다 — 이 축 하나만으로도 종이 갈린다
    expect(new Set(ranges).size, `사거리 ${ranges.join()}`).toBe(RAIDERS.length);
    // 버티는 시간은 **세 단(90 / 75 / 60)** 이다. 넷을 다 벌리면 상·하한이 무의미해질
    // 만큼 촘촘해지므로, 같은 단을 쓰는 두 종은 다른 축(사거리·연사)이 가른다
    expect(new Set(holds).size, `정지 상한 ${holds.join()}`).toBeGreaterThanOrEqual(3);
    // 같은 정지 상한을 쓰는 종끼리는 반드시 연사 간격이 달라야 한다 (한 방 대 연사 축)
    for (const a of RAIDERS) {
      for (const b of RAIDERS) {
        if (a === b) continue;
        const x = ENEMY_DEFS[a].towerAttack!;
        const y = ENEMY_DEFS[b].towerAttack!;
        if (x.holdTicks !== y.holdTicks) continue;
        expect(x.cooldownTicks, `${a}/${b} 정지 상한이 같으면 연사가 달라야 한다`).not.toBe(
          y.cooldownTicks,
        );
      }
    }
    // 사거리 서열: 투창병 < 큰창잡이 < 궁수 < 저주사 (뒤로 갈수록 멀리서 시작한다)
    expect(ranges).toEqual([...ranges].sort((a, b) => a - b));
    // 가장 멀리 닿는 종이 가장 오래 버티면 "안전한 자리에서 눌러앉기"가 최적해가 된다
    expect(ENEMY_DEFS.hexer.towerAttack!.holdTicks).toBeLessThan(
      ENEMY_DEFS.lancer.towerAttack!.holdTicks,
    );
    // 침묵은 주술사 하나만 — 여럿이 가지면 타워가 영구 봉쇄된다
    for (const id of EXPECTED_ENEMIES) {
      const s = ENEMY_DEFS[id].towerAttack?.silenceTicks;
      expect(!!s, id).toBe(id === 'hexer');
    }
    const hex = ENEMY_DEFS.hexer.towerAttack!;
    // 침묵 시간 < 쿨다운 — 한 명으로는 100% 봉쇄가 안 된다 (회복 창이 반드시 열린다)
    expect(hex.silenceTicks!).toBeLessThan(hex.cooldownTicks);
    // 주술사의 직접 피해는 습격대 최저 — 부수는 건 칼과 창이다
    const dps = (id: EnemyId): number => {
      const a = ENEMY_DEFS[id].towerAttack!;
      return a.dmg / a.cooldownTicks;
    };
    for (const id of RAIDERS) {
      if (id !== 'hexer') expect(dps('hexer'), id).toBeLessThan(dps(id));
    }
  });

  it('습격대는 기존 부족 2종과 능력이 겹치지 않는다 (역할 중복 금지)', () => {
    for (const id of RAIDERS) {
      const def = ENEMY_DEFS[id];
      expect(def.shieldHits, `${id} 방패는 warrior 것`).toBeUndefined();
      expect(def.healAura, `${id} 힐 오라는 shaman 것`).toBeUndefined();
      expect(def.boss, id).toBeUndefined();
      expect(def.flying, id).toBe(false);
      // 체력이 아니라 타워 파괴력에 값을 지불한 종 — hp/cost 효율이 공룡보다 낮아야 한다
      expect(def.hp / def.cost, `${id} hp/cost`).toBeLessThan(ENEMY_DEFS.raptor.hp / ENEMY_DEFS.raptor.cost);
    }
  });
});

describe('타워 구조물 체력', () => {
  it('toughness는 전 타워에 정의돼 있고 0.5~1.5 범위', () => {
    for (const id of EXPECTED_TOWERS) {
      const v = TOWER_DEFS[id].toughness;
      expect(v, id).toBeDefined();
      expect(v as number, id).toBeGreaterThanOrEqual(0.5);
      expect(v as number, id).toBeLessThanOrEqual(1.5);
    }
  });

  it('최대 HP는 티어 단조 증가하고 성장률은 cost 성장률보다 완만하다', () => {
    // "비싼 타워일수록 HP 효율은 나쁘다" — 고티어 몰빵이 부족 무리에 더 취약해야 한다
    for (const id of EXPECTED_TOWERS) {
      const tough = TOWER_DEFS[id].toughness;
      for (let t = 1; t < 5; t++) {
        const prev = balance.towerMaxHpFor(t - 1, 0, tough);
        const cur = balance.towerMaxHpFor(t, 0, tough);
        expect(cur, `${id} T${t}`).toBeGreaterThan(prev);
        expect(cur / prev).toBeCloseTo(balance.TOWER_HP_TIER_GROWTH, 1);
      }
      expect(balance.TOWER_HP_TIER_GROWTH).toBeLessThan(1.9); // cost 성장 하한
    }
  });

  it('별 보너스는 화력 보너스보다 얕다 (별은 맷집을 사는 게 아니다)', () => {
    for (const id of EXPECTED_TOWERS) {
      if (id === 'drum') continue; // 버프 전용 — dmgPct가 0이라 비교 대상이 아니다
      expect(balance.TOWER_HP_PER_STAR, id).toBeLessThanOrEqual(TOWER_DEFS[id].starBonus.dmgPct);
    }
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
