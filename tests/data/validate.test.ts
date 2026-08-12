/** 타워/적/전역 상수 데이터 검증 — 밸런스 수치를 계약으로 잠근다. */
import { describe, expect, it } from 'vitest';
import type { BaseLevelDef, EnemyId, TowerId, TowerTier } from '@/data/types';
import * as balance from '@/data/balance';
import { SIEGE_ADVANCE_TICKS, SIEGE_ENGAGE_RANGE } from '@/data/balance';
import { ALL_ALLY_IDS, ALLY_DEFS } from '@/data/allies';
import { ALL_ENEMY_IDS, BOUNTY_PER_COST, ENEMY_DEFS } from '@/data/enemies';
import { BASE_LEVELS } from '@/data/hometown';
import { ALL_TOWER_IDS, TOWER_DEFS } from '@/data/towers';
import { STAGES } from '@/data/stages';
import { makeBotSimFor } from '../sim/botharness';

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
    /*
     * trex 12 (11단계, 10에서 올렸다 — 근거 전문은 src/data/enemies.ts trex 주석).
     * 여기서 **정확한 값**으로 못 박는 이유는 난이도 문턱이라서가 아니라, 이 값이
     * 기지 HP가 가장 낮은 스테이지2(20)에서 60%를 한 번에 가져가기 때문이다.
     * 서열의 계약: 어떤 스테이지에서도 **한 마리가 판을 끝내지는 않는다**(< baseHp).
     */
    expect(ENEMY_DEFS.trex.baseDamage).toBe(12);
    expect(ENEMY_DEFS.spino.baseDamage).toBeGreaterThanOrEqual(5);
    for (const s of STAGES) {
      expect(ENEMY_DEFS.trex.baseDamage, `s${s.id} 기지 HP ${s.baseHp}`).toBeLessThan(s.baseHp);
    }
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 아군 부족 유닛 — 9단계 재정의가 데이터에 남긴 계약
 * ═══════════════════════════════════════════════════════════════════════════
 * 사용자가 부족을 다시 정의하면서 **수명·출격 한계선이 통째로 사라졌고**, 그 자리에
 * 두 가지가 들어왔다: 마을 레벨이 파는 **정원(BaseLevelDef.allyCap)**과, 소모품이
 * 아니라 **영구 유닛**이 된 값(cost). 규칙 전문은 src/sim/allies.ts 헤더.
 *
 * 여기(tests/data)가 잠그는 것은 **표 자체의 무결성**이다 — 봇도 시뮬레이션도 타지 않아
 * 분산이 0이고 밀리초에 끝난다. 행동(정원이 실제로 커맨드를 거부하는가, 미리보기가
 * 다음 레벨을 읽는가)은 tests/sim/hometown.test.ts가 따로 맡는다. 둘은 서로를 대신하지
 * 못한다: 표가 옳아도 sim이 안 읽으면 소용없고, sim이 옳아도 표가 무너지면 팔 물건이 없다.
 *
 * ⚠ **AllyDef.lifeTicks는 삭제됐다.** 이 파일에는 그것을 검사하던 항목이 없었으므로
 * 지울 것도 없었고, 되살아나는 것은 컴파일러가 막는다 — ALLY_DEFS는 객체 리터럴을
 * `Record<AllyId, AllyDef>`에 대입하므로 잉여 속성 검사에 걸린다. 그래서 여기에
 * "lifeTicks가 없다"는 런타임 어서션을 따로 두지 않았다(tsc가 이미 하는 일이다).
 */
describe('아군 정원 (BaseLevelDef.allyCap)', () => {
  it('레벨마다 엄격 증가하고, 한 칸이 정확히 한 자리씩 판다', () => {
    expect(BASE_LEVELS.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < BASE_LEVELS.length; i++) {
      const prev = (BASE_LEVELS[i - 1] as BaseLevelDef).allyCap;
      const cur = (BASE_LEVELS[i] as BaseLevelDef).allyCap;
      /*
       * 엄격 증가가 필요한 이유: 자유 이동이 되면서 마을이 아군에게 파는 손잡이가
       * **이 열 하나뿐**이다. 두 레벨이 같은 정원을 팔면 그 사이 칸은 HP·화력만 남고
       * 아군에게는 0을 파는 칸이 된다 — 8단계의 출격 한계선이 경로가 짧은 스테이지에서
       * 겪었던 바로 그 함정이다(src/data/hometown.ts "자르기에서 곡선 압축으로").
       */
      expect(cur, `Lv${i + 1} 정원`).toBeGreaterThan(prev);
      /*
       * 그리고 증분은 1이다. 한 칸에 +2를 몰아주면 나머지 칸이 다시 0을 파는 칸이 되고,
       * 정원은 사람 수라 반올림으로 얼버무릴 수 없다(0.5명은 없다).
       * 실측 표: 2 · 3 · 4 · 5 · 6 (레벨당 +1).
       */
      expect(cur - prev, `Lv${i + 1} 정원 증가폭`).toBe(1);
    }
  });

  it('전 레벨이 정수이고 Lv1이 1명 이상이다', () => {
    for (let i = 0; i < BASE_LEVELS.length; i++) {
      const cap = (BASE_LEVELS[i] as BaseLevelDef).allyCap;
      // sim이 Math.round로 받으므로(hometown.ts allyCapFor) 소수를 넣으면 표와 실제가
      // 조용히 갈린다 — 표 쪽에서 막는다
      expect(Number.isInteger(cap), `Lv${i + 1} 정원 ${cap}`).toBe(true);
    }
    // Lv1이 0이면 이 상품이 **시작 시점에 통째로 존재하지 않는다** (출동 버튼이 늘 회색).
    // 방치 난이도의 하한이기도 하다 — 아무것도 안 사면 Lv1 정원이 부족의 전부다.
    expect((BASE_LEVELS[0] as BaseLevelDef).allyCap).toBeGreaterThanOrEqual(1);
  });

  it('만렙 정원 = balance.ALLY_MAX_ACTIVE (표와 절대 상한이 갈리지 않는다)', () => {
    const max = (BASE_LEVELS[BASE_LEVELS.length - 1] as BaseLevelDef).allyCap;
    /*
     * 두 숫자가 갈리면 조용히 둘 중 하나가 죽는다:
     *  · 표 < 상한이면 표의 마지막 칸이 절대 상한에 닿지 못해 **살 수 없는 여유**가 남고,
     *  · 표 > 상한이면 allyCapFor의 min()이 그 초과분을 먹어 **돈을 내고 아무것도 못 산다**
     *    (렌더 인스턴스 정원이기도 하다 — 넘기면 버퍼가 잘린다).
     */
    expect(max).toBe(balance.ALLY_MAX_ACTIVE);
  });
});

describe('아군 값 (영구 유닛이 된 뒤의 하한)', () => {
  /**
   * **cost 하한 — 아군은 가장 싼 타워 T1의 절반보다는 비싸야 한다.**
   *
   * 8단계까지 아군은 20초짜리 소모품이었고, 그래서 값도 "타워 T1의 절반 이하"에 맞춰
   * 있었다(clubber 40 · slinger 60 · guardian 85 — src/data/allies.ts 4단계 튜닝 기록).
   * 9단계에 수명이 사라지면서 그 근거가 통째로 무너졌다: **되돌아오지 않는 20초**가
   * 아니라 **쓰러질 때까지 남는 영구 전력**이므로, 같은 영구 구조물인 타워와 같은
   * 값대에 있어야 한다. 아래 실측이 그 자리를 보여 준다:
   *   가장 싼 타워 T1 = frost 90  →  하한 45
   *   아군 실비용    = clubber 90 · slinger 110 · guardian 160  (전부 하한의 2배 이상)
   * 곧 지금 값은 하한에 붙어 있지 않다 — 이 문턱은 "적정값"이 아니라 **소모품 시절의
   * 가격표로 되돌아가는 것**을 막는 난간이다(40은 45 아래라 즉시 빨개진다).
   *
   * 왜 상한은 두지 않는가: 위쪽은 이미 balance.allyCostFor의 지수 인상(1.2^인원)과
   * 정원이 함께 잡는다. 아래쪽만 데이터에 난간이 없었다.
   */
  it('아군 cost는 가장 싼 타워 T1 cost의 절반보다 크다', () => {
    const cheapestT1 = Math.min(
      ...EXPECTED_TOWERS.map((id) => (TOWER_DEFS[id].tiers[0] as TowerTier).cost),
    );
    expect(cheapestT1).toBe(90); // frost — 이 값이 바뀌면 위 유도도 다시 봐야 한다
    const floor = cheapestT1 / 2;
    for (const id of ALL_ALLY_IDS) {
      const def = ALLY_DEFS[id];
      expect(def.cost, `${id} cost ${def.cost} ≤ 하한 ${floor}`).toBeGreaterThan(floor);
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

// ---------------------------------------------------------------------------
// 상성 축 불변식 I-1 ~ I-3 (docs/counter-plan.md 2단계)
//
// ⚠ **I-4(신설 특성 보유 종의 HP 비중 ≤ 25%)는 폐기됐다.** 폐기 근거는 아래
//    '옛 I-4가 왜 죽었는가' 테스트가 직접 실행해서 보여준다 — 문서만이 아니라 코드가
//    그 지표의 무력함을 잠근다. 대체 판정선은 counter-plan.md §단계 2에 있다.
// ---------------------------------------------------------------------------

/** 이 스테이지에서 손에 들어올 수 있는 타워 (해금이 'start'이거나 이 스테이지 이하) */
function startingDeckFor(stageId: number): TowerId[] {
  return EXPECTED_TOWERS.filter((id) => {
    const u = TOWER_DEFS[id].unlock;
    return u.type === 'start' || (u.type === 'stage' && u.stage <= stageId);
  });
}

/** 쿨다운이 가장 짧은 = **연사** 타워 (T1 기준) */
function fastestOf(ids: readonly TowerId[]): TowerId {
  return [...ids].sort(
    (a, b) =>
      (TOWER_DEFS[a].tiers[0]?.cooldownTicks ?? 0) - (TOWER_DEFS[b].tiers[0]?.cooldownTicks ?? 0) ||
      (a < b ? -1 : 1),
  )[0] as TowerId;
}

describe('상성 축 (I-1 ~ I-3)', () => {
  it('I-1 배지 하나 — armor/hide/splashResist/shieldHits 중 둘 이상을 가진 종은 없다', () => {
    for (const id of EXPECTED_ENEMIES) {
      const d = ENEMY_DEFS[id];
      const axes = [
        d.armor > 0 ? 'armor' : null,
        d.hide !== undefined ? 'hide' : null,
        d.splashResist !== undefined ? 'splash' : null,
        (d.shieldHits ?? 0) > 0 ? 'shield' : null,
      ].filter(Boolean);
      expect(axes.length, `${id}: ${axes.join('+')}`).toBeLessThanOrEqual(1);
      // 배지 계산도 같은 답을 내야 한다 — 화면과 데이터가 갈라지지 않게
      const badges = balance
        .enemyTraitsOf(d)
        .filter((t) => t === 'armor' || t === 'hide' || t === 'splash' || t === 'shield');
      expect(badges.length, `${id} 배지 ${badges.join('+')}`).toBeLessThanOrEqual(1);
    }
  });

  it('I-1b 값의 범위 — hide/splashResist는 0 초과 1 미만 (0이면 무의미, 1이면 무적)', () => {
    for (const id of EXPECTED_ENEMIES) {
      const d = ENEMY_DEFS[id];
      if (d.hide !== undefined) {
        expect(d.hide, `${id}.hide`).toBeGreaterThan(0);
        expect(d.hide, `${id}.hide`).toBeLessThan(1);
      }
      if (d.splashResist !== undefined) {
        expect(d.splashResist, `${id}.splashResist`).toBeGreaterThan(0);
        expect(d.splashResist, `${id}.splashResist`).toBeLessThan(1);
      }
    }
  });

  /**
   * **I-2 거울 보증 — 연사 타워는 가죽에 걸리지 않는다.**
   *
   * 계획서 초안은 `cap ≥ 시작 덱 최속 타워의 **T4** dmg`였고 그건 **거짓이다**:
   * boar가 나오는 스테이지1 w20의 cap은 39인데 spear T4는 43이라 이미 걸린다.
   * 문턱을 T4에 두면 boar.hide를 0.20보다 크게(= 최소 타격 5회 미만으로) 밀어야 하는데,
   * 그러면 "큰 한 방을 벌한다"는 축 자체가 무의미해진다.
   *
   * **실측으로 다시 유도한 문턱은 T3다.** 근거(hide 0.18 · 스테이지1, boar 등장 8개 웨이브):
   *   cap 범위 39 ~ 146   ·   spear T1 12 / T2 18 / T3 28 / T4 43
   *   → T3(28)까지는 **어느 웨이브에서도 무손실**, 걸리기 시작하는 것은 T4부터다.
   *
   * ⚠ 상한을 `hp × hide`(hpMul 1)로 잡으면 **실제보다 낮게** 나온다(27). boar는 hpMul 1로
   *   나오는 웨이브가 없기 때문이다 — 가장 약한 개체가 w20의 219(cap 39)다. 그래서 이
   *   테스트는 **그 종이 실제로 등장하는 웨이브**를 previewWave로 훑어 진짜 최소 상한을
   *   쓴다(1단계 계량기. 40시드 스윕이 아니라 밀리초다).
   * 이 선이 뜻하는 계약: *"연사 타워는 자기 정체성(작게 자주)을 유지하는 한 가죽을
   * 신경 쓸 필요가 없다. T4·T5로 올려 **한 방이 커진 순간**부터만 값을 치른다."*
   * 곧 가죽은 업그레이드 세금이 아니라 **큰 한 방에 매기는 값**이라는 설계가
   * 데이터로 참이 된다 — 티어를 올려서 '빠져나가는' 것이 아니라, 올릴수록 이 축에
   * 다가가는 쪽이 정상이다.
   */
  it('I-2 거울 보증 — 가죽 상한은 시작 덱 연사 타워의 T3 dmg 이상이다', () => {
    for (const stage of STAGES) {
      const deck = startingDeckFor(stage.id);
      const fast = fastestOf(deck);
      const t3 = TOWER_DEFS[fast].tiers[2]?.dmg ?? 0;
      const hidden = stage.wavePlan.allowedEnemies.filter(
        (eid) => ENEMY_DEFS[eid].hide !== undefined,
      );
      if (hidden.length === 0) continue;
      // 이 스테이지가 실제로 내보내는 편성을 훑어 **진짜 최소 상한**을 찾는다
      const sim = makeBotSimFor(stage, 1, deck, 0, false);
      const minCap = new Map<EnemyId, number>();
      for (let w = 1; w <= stage.waveCount; w++) {
        for (const e of sim.previewWave(w).entries) {
          if (e.hideCap === undefined) continue;
          const cur = minCap.get(e.defId);
          if (cur === undefined || e.hideCap < cur) minCap.set(e.defId, e.hideCap);
        }
      }
      for (const eid of hidden) {
        const cap = minCap.get(eid);
        if (cap === undefined) continue; // 이 스테이지 편성에 실제로는 안 나온다
        expect(
          cap,
          `스테이지${stage.id} ${eid}: 최소 cap ${cap} < ${fast} T3 ${t3}`,
        ).toBeGreaterThanOrEqual(t3);
      }
    }
  });

  /**
   * **I-3 해결 가능성** — "내가 가진 답 전부를 무력화하는 적"은 만들 수 없다.
   * 각 스테이지의 전 종에 대해, 그 스테이지 시작 덱 중 유효 배율 ≥ 0.8인 타워가
   * 최소 하나 있어야 한다. T3 기준(플레이어가 실제로 도달하는 티어)으로 잰다.
   */
  it('I-3 해결 가능성 — 전 종에 대해 시작 덱 중 배율 ≥0.8인 타워가 하나는 있다', () => {
    for (const stage of STAGES) {
      const deck = startingDeckFor(stage.id).filter((id) => balance.isAttackTower(TOWER_DEFS[id]));
      for (const eid of stage.wavePlan.allowedEnemies) {
        const d = ENEMY_DEFS[eid];
        const e = {
          defId: eid,
          count: 1,
          maxHp: d.hp,
          totalHp: d.hp,
          armor: d.armor,
          ...(d.hide !== undefined ? { hideCap: balance.hideCapFor(d.hp, d.hide) } : {}),
          ...(d.splashResist !== undefined ? { splashResist: d.splashResist } : {}),
          flying: d.flying,
          boss: d.boss ?? false,
          traits: balance.enemyTraitsOf(d),
        };
        const best = Math.max(...deck.map((id) => balance.towerEffVs(TOWER_DEFS[id], 2, e)));
        const detail = deck
          .map((id) => `${id} ${balance.towerEffVs(TOWER_DEFS[id], 2, e).toFixed(2)}`)
          .join(' · ');
        expect(best, `스테이지${stage.id} ${eid}: ${detail}`).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  /**
   * **옛 I-4가 왜 죽었는가 — 이 테스트가 그 이유다.**
   *
   * 폐기된 I-4는 "신설 특성 보유 종의 웨이브 총 HP 비중 ≤ 25%"였다. 그런데 그 지표는
   * **어느 종이 특성을 갖는가**만 보고 **그 특성이 얼마나 센가**는 안 본다. 곧 hide를
   * 0.20으로 두든 0.02로 두든(= 최소 타격 5회든 50회든) 비중은 **한 자리도 안 움직인다.**
   * 온보딩이 실제로 깨지는지는 후자가 정하는데, 지표는 전자만 재는 것이다.
   *
   * 아래가 그것을 실행해서 보인다. 이 성질 때문에 I-4는 투여량 판단에 **원리적으로**
   * 쓸 수 없고, 그래서 폐기하고 실측(하한 팔)으로 옮겼다.
   * 대체 판정선과 그 유도는 docs/counter-plan.md §단계 2에 있다.
   */
  it('폐기 근거 — HP 비중 지표는 투여량에 완전히 둔감하다 (그래서 안전선이 될 수 없다)', () => {
    const share = (hide: number, splash: number): number => {
      // 비중은 hp와 편성만으로 정해진다 — 방어 수치는 분자·분모 어디에도 안 들어간다
      const defs = { ...ENEMY_DEFS, boar: { ...ENEMY_DEFS.boar, hide }, raptor: { ...ENEMY_DEFS.raptor, splashResist: splash } };
      const ids = STAGES[0]?.wavePlan.allowedEnemies ?? [];
      let axis = 0;
      let total = 0;
      for (const id of ids) {
        const d = defs[id];
        total += d.hp;
        if (d.hide !== undefined || d.splashResist !== undefined) axis += d.hp;
      }
      return axis / total;
    };
    // 투여량을 10배 차이로 벌려도 지표는 완전히 같다
    expect(share(0.2, 0.6)).toBe(share(0.02, 0.06));
  });
});
