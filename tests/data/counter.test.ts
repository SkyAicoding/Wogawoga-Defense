/**
 * 상성 계량 — 특성 태그 · 유효 배율 · 수요 막대 · 손패 경고 · 데미지 표기.
 *
 * 이 파일의 존재 이유 하나: **화면의 식과 시뮬레이션의 식이 같은 답을 내는지** 잠근다.
 * `data/balance.towerEffVs`는 `sim/combat.damageEnemy`의 거울일 뿐이고, 둘이 어긋나는
 * 순간 미리보기 막대와 카드 경고가 조용히 거짓말을 한다 — 그건 정보가 없는 것보다 나쁘다.
 */
import { describe, expect, it } from 'vitest';
import type { BattleStateView, EnemyDef, WavePreviewEntry } from '@/data/types';
import { Rng } from '@/core/rng';
import {
  AIR_BLIND_SHARE,
  DEMAND_WEAK,
  ENEMY_DEFS,
  TOWER_DEFS,
  TRAIT_PRIORITY,
  airShareOf,
  counteredBy,
  demandFor,
  enemyTraitsOf,
  favoredAgainst,
  isAttackTower,
  towerEffVs,
} from '@/data';
import { World, type EnemySim, type SimCtx } from '@/sim/entities';
import { createHometown } from '@/sim/hometown';
import { damageEnemy } from '@/sim/combat';
import { options } from '../sim/fixtures';
import { damageText } from '@/ui/widgets/damagenumbers';

/** 미리보기 항목 하나 만들기 (마릿수·체력은 이 파일의 관심사가 아니다) */
function entry(id: EnemyDef['id'], count = 1, hpMul = 1): WavePreviewEntry {
  const d = ENEMY_DEFS[id];
  const maxHp = Math.max(1, Math.round(d.hp * hpMul));
  return {
    defId: id,
    count,
    maxHp,
    totalHp: maxHp * count,
    armor: d.armor,
    flying: d.flying,
    boss: d.boss ?? false,
    traits: enemyTraitsOf(d),
  };
}

function miniCtx(): SimCtx {
  const world = new World();
  const view: BattleStateView = {
    tick: 0, phase: 'wave', waveIndex: 1, waveCount: 1, gold: 0,
    baseHp: 10, baseHpMax: 10, baseLevel: 1, baseLevelMax: 1,
    prepTicksLeft: 0, earlyCallBonusGold: 0, hand: [], deck: [], refreshCost: 0,
    enemies: world.enemies.items, allies: world.allies.items, allyCap: 6,
    towers: world.towers.items, projectiles: world.projectiles.items,
    amberEarned: 0, endless: false,
  };
  return {
    opts: options(), rng: new Rng(1), world, events: [], view,
    groundPaths: [], airPaths: [], hometown: createHometown(),
  };
}

describe('enemyTraitsOf — 기존 필드만으로 유도한다', () => {
  it('스테이지1 7종의 태그가 데이터와 일치한다', () => {
    expect(enemyTraitsOf(ENEMY_DEFS.raptor)).toEqual([]);
    expect(enemyTraitsOf(ENEMY_DEFS.compy)).toEqual([]);
    expect(enemyTraitsOf(ENEMY_DEFS.boar)).toEqual(['enrage']);
    expect(enemyTraitsOf(ENEMY_DEFS.trike)).toEqual(['armor']);
    expect(enemyTraitsOf(ENEMY_DEFS.ptera)).toEqual(['air']);
    expect(enemyTraitsOf(ENEMY_DEFS.blade)).toEqual(['raid']);
    expect(enemyTraitsOf(ENEMY_DEFS.archer)).toEqual(['raid']);
  });

  it('둘 이상 가진 종은 우선순위대로 정렬되고 [0]이 배지가 된다', () => {
    // warrior = 방패 + 습격 → 방패가 앞 (하드한 쪽이 먼저)
    expect(enemyTraitsOf(ENEMY_DEFS.warrior)).toEqual(['shield', 'raid']);
    // lancer = 장갑 + 습격 → 장갑이 앞
    expect(enemyTraitsOf(ENEMY_DEFS.lancer)).toEqual(['armor', 'raid']);
    // shaman = 치유만
    expect(enemyTraitsOf(ENEMY_DEFS.shaman)).toEqual(['heal']);
  });

  it('16종 전부: 태그가 실제 필드와 1:1로 대응한다 (새 필드를 만들지 않았다는 증거)', () => {
    for (const d of Object.values(ENEMY_DEFS)) {
      const tags = enemyTraitsOf(d);
      expect(tags.includes('air')).toBe(d.flying);
      expect(tags.includes('armor')).toBe(d.armor > 0);
      expect(tags.includes('shield')).toBe((d.shieldHits ?? 0) > 0);
      expect(tags.includes('heal')).toBe(!!d.healAura);
      expect(tags.includes('raid')).toBe(!!d.towerAttack);
      expect(tags.includes('enrage')).toBe(!!d.enrage);
      // 우선순위 정렬 확인
      const idx = tags.map((t) => TRAIT_PRIORITY.indexOf(t));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });
});

describe('towerEffVs — sim/combat.damageEnemy의 거울이다', () => {
  it('전 타워 × 전 티어 × 전 적: 화면의 배율이 실제 피해와 같은 답을 낸다', () => {
    const ctx = miniCtx();
    for (const def of Object.values(TOWER_DEFS)) {
      if (!isAttackTower(def)) continue;
      for (let tier = 0; tier < def.tiers.length; tier++) {
        const dmg = def.tiers[tier]!.dmg;
        if (dmg <= 0) continue;
        for (const eDef of Object.values(ENEMY_DEFS)) {
          const e = ctx.world.acquireEnemy();
          Object.assign(e, {
            defId: eDef.id, def: eDef, hp: 10 ** 9, maxHp: 10 ** 9,
            shieldHitsLeft: 0, alive: true, flying: eDef.flying, statuses: [],
          });
          const dealt = damageEnemy(ctx, e, dmg, def.id);
          ctx.events.length = 0;
          const canHit = eDef.flying ? def.canTargetAir : def.canTargetGround;
          const eff = towerEffVs(def, tier, entry(eDef.id));
          if (!canHit) {
            // 못 때리는 것은 0 — 시뮬레이션에서는 애초에 조준 자체가 안 된다
            expect(eff, `${def.id} T${tier + 1} → ${eDef.id}`).toBe(0);
          } else {
            expect(Math.round(eff * dmg), `${def.id} T${tier + 1} → ${eDef.id}`).toBe(dealt);
          }
        }
      }
    }
  });

  it('배율은 0~1을 벗어나지 않는다', () => {
    for (const def of Object.values(TOWER_DEFS)) {
      for (let tier = 0; tier < 5; tier++) {
        for (const id of Object.keys(ENEMY_DEFS) as (keyof typeof ENEMY_DEFS)[]) {
          const v = towerEffVs(def, tier, entry(id));
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('수요 막대 — 못 때리는 것은 0으로 센다', () => {
  it('공중이 섞이면 대공 없는 타워의 막대가 그 몫만큼 짧아진다', () => {
    const es = [entry('raptor', 10), entry('ptera', 5)];
    const airShare = airShareOf(es);
    // 투석기는 공중을 못 때린다 → 정확히 (1 − 공중 비중)
    expect(demandFor(TOWER_DEFS.catapult, 0, es)).toBeCloseTo(1 - airShare, 9);
    // 창은 둘 다 때리고 장갑이 0이라 1.00
    expect(demandFor(TOWER_DEFS.spear, 0, es)).toBeCloseTo(1, 9);
  });

  it('장갑 앞에서는 타격이 작은 타워일수록 막대가 짧다 (서열이 뒤집히지 않는다)', () => {
    const es = [entry('trike', 4)];
    const frost = demandFor(TOWER_DEFS.frost, 0, es);
    const spear = demandFor(TOWER_DEFS.spear, 0, es);
    const cata = demandFor(TOWER_DEFS.catapult, 0, es);
    const balli = demandFor(TOWER_DEFS.ballista, 0, es);
    expect(frost).toBeLessThan(spear);
    expect(spear).toBeLessThan(cata);
    expect(cata).toBeLessThan(balli);
  });

  it('전쟁북은 막대를 그리지 않는다 (분모가 정의되지 않는다)', () => {
    expect(isAttackTower(TOWER_DEFS.drum)).toBe(false);
    expect(counteredBy(TOWER_DEFS.drum, 0, [entry('ptera', 5)])).toBeNull();
    expect(favoredAgainst(TOWER_DEFS.drum, 0, [entry('ptera', 5)])).toBe(false);
  });

  it('빈 웨이브에서 0으로 나누지 않는다', () => {
    expect(demandFor(TOWER_DEFS.spear, 0, [])).toBe(0);
    expect(airShareOf([])).toBe(0);
    expect(counteredBy(TOWER_DEFS.spear, 0, [])).toBeNull();
  });
});

describe('counteredBy — 두 축을 다른 자로 잰다', () => {
  it('공중은 하드 게이트다 — 비중이 문턱을 넘으면 수요 막대와 무관하게 잡힌다', () => {
    // 공중 비중을 문턱 부근으로 맞춘 두 웨이브
    const heavy = [entry('raptor', 40), entry('ptera', 8)]; // 공중 ≈ 23%
    const light = [entry('raptor', 200), entry('ptera', 2)]; // 공중 ≈ 1.5%
    expect(airShareOf(heavy)).toBeGreaterThan(AIR_BLIND_SHARE);
    expect(airShareOf(light)).toBeLessThan(AIR_BLIND_SHARE);
    expect(counteredBy(TOWER_DEFS.catapult, 0, heavy)).toBe('air');
    expect(counteredBy(TOWER_DEFS.catapult, 0, light)).toBeNull();
    // 대공이 되는 타워는 같은 웨이브에서 멀쩡하다
    expect(counteredBy(TOWER_DEFS.spear, 0, heavy)).toBeNull();
  });

  it('장갑은 연속이다 — 티어를 올리면 경고가 사라진다', () => {
    const es = [entry('trike', 4)];
    expect(counteredBy(TOWER_DEFS.frost, 0, es), '얼음 T1(dmg 7)').toBe('armor');
    expect(demandFor(TOWER_DEFS.frost, 0, es)).toBeLessThan(DEMAND_WEAK);
    expect(counteredBy(TOWER_DEFS.frost, 2, es), '얼음 T3(dmg 18)').toBeNull();
  });

  it('평범한 지상 웨이브에서는 아무 카드도 잡히지 않는다 (채널이 배경이 되지 않는다)', () => {
    const es = [entry('raptor', 10), entry('compy', 20)];
    for (const id of ['spear', 'catapult', 'frost', 'lightning', 'ballista'] as const) {
      expect(counteredBy(TOWER_DEFS[id], 0, es), id).toBeNull();
    }
  });

  it('유리 표시는 벌하는 축이 있을 때만 켜진다', () => {
    const plain = [entry('raptor', 10), entry('compy', 20)];
    const air = [entry('raptor', 10), entry('ptera', 6)];
    // 축이 없는 웨이브: 배율은 1.00이지만 테두리는 안 켜진다
    expect(demandFor(TOWER_DEFS.spear, 0, plain)).toBeCloseTo(1, 9);
    expect(favoredAgainst(TOWER_DEFS.spear, 0, plain)).toBe(false);
    // 하늘길: 대공이 되는 창만 켜진다
    expect(favoredAgainst(TOWER_DEFS.spear, 0, air)).toBe(true);
    expect(favoredAgainst(TOWER_DEFS.catapult, 0, air)).toBe(false);
  });
});

describe('데미지 표기 규약 — 색 말고 부호', () => {
  it('장갑이 없으면 맨 숫자다', () => {
    expect(damageText(30, 0)).toBe('30');
    expect(damageText(7.4, 0)).toBe('7');
  });

  it('많이 깎이면 괄호, 거의 안 깎이면 느낌표', () => {
    // 트리케라톱스(armor 4)를 서로 다른 타워로 때렸을 때 — 같은 적, 다른 부호
    expect(damageText(12 - 4, 4), '창 T1 12').toBe('(8)');
    expect(damageText(Math.max(1, 7 - 4), 4), '얼음 T1 7').toBe('(3)');
    expect(damageText(55 - 4, 4), '발리스타 T1 55').toBe('51!');
    // 그 사이는 부호 없음 — 부호가 늘 켜져 있으면 부호가 아니다
    expect(damageText(30 - 4, 4), '투석기 T1 30').toBe('26');
  });

  it('최소 1 하한에 걸린 타격도 괄호다 (되짚기가 판정을 뒤집지 않는다)', () => {
    // ankylo armor 10에 얼음 T1(7) → 실제 피해 1
    expect(damageText(1, 10)).toBe('(1)');
  });
});
