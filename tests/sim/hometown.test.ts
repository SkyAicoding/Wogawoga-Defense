/**
 * 홈타운 — 반격(사거리/타깃/공중/고정)과 레벨업(경제/상한/HP 정책).
 * 규칙 전문은 src/sim/hometown.ts 헤더, 수치 근거는 src/data/hometown.ts.
 */
import { describe, expect, it } from 'vitest';
import type { BaseLevelDef, BattleSim, SimEvent, TowerTier } from '@/data/types';
import { TICK_RATE } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { BASE_LEVELS } from '@/data/hometown';
import { ALLY_SORTIE_RANGE } from '@/data/balance';
import { ALLY_DEFS, ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import { baseLevels, enemyDefs, eventsOf, options, runTicks, stageDef, wave } from './fixtures';

/**
 * 기본 실험 판: 10×5, 경로 (0,2)→(9,2) 직선, 기지 (9,2).
 * 적 속도 1타일/초라 dist가 곧 x좌표이고, 사거리 2면 x ≥ 7 구간에서 맞는다.
 */
function armedSim(over?: {
  levels?: Partial<BaseLevelDef>[];
  enemy?: Parameters<typeof enemyDefs>[0];
  gold?: number;
  baseHp?: number;
  count?: number;
}): BattleSim {
  return createBattle(
    options({
      // waveCount를 넉넉히 둔다 — 웨이브 1이 끝나자마자 'won'이 되면
      // 그 뒤의 커맨드(레벨업)가 전부 거부되어 무엇을 재는지 알 수 없게 된다
      stage: stageDef({
        startGold: over?.gold ?? 1000,
        baseHp: over?.baseHp ?? 10,
        waveCount: 9,
      }),
      baseLevels: baseLevels(
        over?.levels ?? [
          { dmg: 5, cooldownTicks: 30, range: 2 },
          { dmg: 20, cooldownTicks: 30, range: 3 },
          { dmg: 40, cooldownTicks: 30, range: 4 },
        ],
      ),
      enemyDefs: enemyDefs(over?.enemy),
      waves: [wave([{ count: over?.count ?? 1 }])],
    }),
  );
}

/** 웨이브를 즉시 시작하고 n틱 진행 */
function play(sim: BattleSim, ticks: number): SimEvent[] {
  sim.applyCommand({ type: 'callWave' });
  return runTicks(sim, ticks);
}

describe('홈타운 반격', () => {
  it('사거리 안에 든 적에게만 쏜다 (규칙 1)', () => {
    // 적 hp를 크게 잡아 사거리 안에서 죽지 않게 — "언제부터 쏘는가"만 본다
    const sim = armedSim({ enemy: { raptor: { hp: 500, speed: 1 } } });
    const ev = play(sim, 400);
    const shots = eventsOf(ev, 'baseFired');
    expect(shots.length).toBeGreaterThan(0);
    // 첫 발이 나가는 순간 적은 기지에서 사거리(2.0) 안에 있어야 한다
    const dmg = eventsOf(ev, 'enemyDamaged').filter((d) => d.source === 'hometown');
    expect(dmg.length).toBeGreaterThan(0);
    for (const d of dmg) {
      // 기지 셀 (9,2) 기준. 화살 비행 중 적이 더 다가오므로 사거리보다 가까울 수만 있다
      expect(Math.hypot(d.x - 9, d.z - 2)).toBeLessThanOrEqual(2.0 + 1e-6);
    }
  });

  it('사거리 0(무장 해제) 테이블이면 한 발도 쏘지 않는다 — 통제 실험 경로', () => {
    const sim = armedSim({ levels: [{ dmg: 0, range: 0 }] });
    const ev = play(sim, 400);
    expect(eventsOf(ev, 'baseFired')).toHaveLength(0);
    expect(eventsOf(ev, 'enemyDamaged').filter((d) => d.source === 'hometown')).toHaveLength(0);
  });

  it('화살은 armor를 거쳐 실제 피해를 넣고 출처가 hometown이다', () => {
    const sim = armedSim({ enemy: { raptor: { hp: 500, speed: 1, armor: 2 } } });
    const ev = play(sim, 400);
    const hits = eventsOf(ev, 'enemyDamaged').filter((d) => d.source === 'hometown');
    expect(hits.length).toBeGreaterThan(0);
    // dmg 5 − armor 2 = 3 (damageEnemy의 고정 감산 규약을 그대로 탄다)
    for (const hit of hits) expect(hit.amount).toBe(3);
  });

  it('공중 적도 쏜다 (규칙 3 — 아군 부족원과 갈리는 지점)', () => {
    const sim = armedSim({ enemy: { raptor: { hp: 500, speed: 1, flying: true } } });
    const ev = play(sim, 400);
    expect(eventsOf(ev, 'baseFired').length).toBeGreaterThan(0);
  });

  it('타깃은 유효한 동안 고정된다 — 더 가까운 적이 나타나도 갈아타지 않는다 (규칙 2)', () => {
    // 느린 놈이 먼저 사거리에 들고, 빠른 놈이 뒤늦게 출발해 **추월한다**.
    // 매 틱 최근접을 재평가하면 추월 시점에 타깃이 바뀐다 — 고정이면 안 바뀐다.
    //   느린 놈(0.5타일/초): t=420틱에 dist 7(사거리 진입), t=540틱에 누수
    //   빠른 놈(1.5타일/초, 300틱 지연): t=450틱에 느린 놈을 따라잡고 그 뒤로 더 가깝다
    const sim = createBattle(
      options({
        stage: stageDef({ startGold: 1000, baseHp: 999, waveCount: 9 }),
        baseLevels: baseLevels([{ dmg: 5, cooldownTicks: 30, range: 2 }]),
        enemyDefs: enemyDefs({
          raptor: { hp: 100000, speed: 0.5 },
          compy: { hp: 100000, speed: 1.5 },
        }),
        waves: [
          wave([
            { enemyId: 'raptor', count: 1 },
            { enemyId: 'compy', count: 1, delayTicks: 300 },
          ]),
        ],
      }),
    );
    const ev = play(sim, 530);
    const shots = eventsOf(ev, 'baseFired');
    expect(shots.length).toBeGreaterThan(3);
    const slowId = eventsOf(ev, 'enemySpawned')[0]?.enemyId;
    // 느린 놈이 살아 있고 사거리 안인 내내 화살은 전부 그놈에게 간다
    expect(shots.every((s) => s.targetId === slowId)).toBe(true);
    // 추월이 실제로 일어났는지 못 박는다 — 빠른 놈이 먼저 기지에 닿았다는 것은
    // 사거리 안에서 한동안 **더 가까웠다**는 뜻이다. 이게 없으면 이 테스트는 공허해진다
    const leaks = eventsOf(ev, 'enemyLeaked');
    expect(leaks[0]?.defId).toBe('compy');
  });

  it('타워가 전부 침묵해도 홈타운은 계속 쏜다 (규칙 5)', () => {
    // hexer는 타워만 침묵시킨다 — 기지에는 침묵 개념 자체가 없다
    const sim = armedSim({ enemy: { raptor: { hp: 500, speed: 1 } } });
    const ev = play(sim, 400);
    expect(eventsOf(ev, 'towerSilenced')).toHaveLength(0);
    expect(eventsOf(ev, 'baseFired').length).toBeGreaterThan(0);
  });

  it('레벨이 오르면 같은 시나리오에서 더 아프게, 더 멀리서 쏜다', () => {
    const shotsAt = (level: number): { shots: number; total: number } => {
      const sim = armedSim({ enemy: { raptor: { hp: 5000, speed: 1 } } });
      for (let i = 1; i < level; i++) expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
      const ev = play(sim, 400);
      const hits = eventsOf(ev, 'enemyDamaged').filter((d) => d.source === 'hometown');
      return { shots: hits.length, total: hits.reduce((a, h) => a + h.amount, 0) };
    };
    const lv1 = shotsAt(1);
    const lv3 = shotsAt(3);
    // 사거리 2 → 4라 체류 시간이 두 배, 피해도 5 → 40이라 총량은 훨씬 크다
    expect(lv3.shots).toBeGreaterThan(lv1.shots);
    expect(lv3.total).toBeGreaterThan(lv1.total * 2);
  });
});

describe('홈타운 레벨업', () => {
  it('골드를 정확히 깎고 레벨·최대HP·공격력·사거리를 함께 올린다', () => {
    const sim = armedSim({ gold: 1000 });
    const s = sim.state;
    expect(s.baseLevel).toBe(1);
    expect(s.baseLevelMax).toBe(3);
    expect(s.baseHpMax).toBe(10); // hpMul 1
    expect(sim.baseRange()).toBe(2);
    expect(sim.baseUpgradeCost()).toBe(100);

    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(s.gold).toBe(900);
    expect(s.baseLevel).toBe(2);
    expect(s.baseHpMax).toBe(20); // hpMul 2
    expect(sim.baseRange()).toBe(3);
    expect(sim.baseUpgradeCost()).toBe(200);

    const ev = sim.drainEvents();
    const up = eventsOf(ev, 'baseUpgraded');
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ level: 2, cost: 100, hpMax: 20, dmg: 20, range: 3 });
  });

  it('HP 정책: 누적 피해 절대량이 보존된다 (전량 회복이 아니다)', () => {
    // 적 하나를 흘려보내 기지에 상처를 낸 뒤 레벨업한다
    const sim = armedSim({ levels: [{ dmg: 0, range: 0 }], baseHp: 10, gold: 1000 });
    play(sim, 400);
    const s = sim.state;
    expect(s.baseHp).toBe(9); // baseDamage 1 누수 1회
    expect(s.baseHpMax).toBe(10);
    const takenBefore = s.baseHpMax - s.baseHp;

    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    // 늘어난 최대치(+10)만큼만 즉시 증축 → 19/20. 상처(1)는 그대로 남는다
    expect(s.baseHpMax).toBe(20);
    expect(s.baseHp).toBe(19);
    expect(s.baseHpMax - s.baseHp).toBe(takenBefore);
    // 전량 회복이었다면 20/20이 됐어야 한다 — 회복 수단이 되지 않는다는 잠금
    expect(s.baseHp).toBeLessThan(s.baseHpMax);

    // 한 단계 더 올려도 상처는 계속 따라온다 (hpMul 3 → 30)
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(s.baseHpMax).toBe(30);
    expect(s.baseHp).toBe(29);
    expect(s.baseHpMax - s.baseHp).toBe(takenBefore);
  });

  it('골드가 모자라면 거부하고 한 푼도 쓰지 않는다', () => {
    const sim = armedSim({ gold: 99 }); // Lv2 비용 100
    const s = sim.state;
    expect(sim.canUpgradeBase()).toBe(false);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(false);
    expect(s.gold).toBe(99);
    expect(s.baseLevel).toBe(1);
    expect(s.baseHpMax).toBe(10);
    expect(sim.drainEvents().filter((e) => e.type === 'baseUpgraded')).toHaveLength(0);
  });

  it('최대 레벨에서는 골드가 남아도 거부한다', () => {
    const sim = armedSim({ gold: 100000 });
    const s = sim.state;
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(s.baseLevel).toBe(3);
    expect(sim.baseUpgradeCost()).toBeNull();
    expect(sim.canUpgradeBase()).toBe(false);
    const goldBefore = s.gold;
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(false);
    expect(s.gold).toBe(goldBefore);
    expect(s.baseLevel).toBe(3);
  });

  it('전투가 끝나면 레벨업 커맨드를 받지 않는다', () => {
    const sim = armedSim({ gold: 100000, baseHp: 1, levels: [{ dmg: 0, range: 0 }] });
    play(sim, 400);
    expect(sim.state.phase).toBe('lost');
    expect(sim.canUpgradeBase()).toBe(false);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(false);
  });
});

describe('실제 밸런스 데이터', () => {
  it('레벨 곡선이 단조 증가한다 (비용·HP·사거리·DPS)', () => {
    expect(BASE_LEVELS.length).toBeGreaterThanOrEqual(2);
    expect(BASE_LEVELS[0]?.cost).toBe(0); // Lv1은 시작 상태라 값을 치르지 않는다
    for (let i = 1; i < BASE_LEVELS.length; i++) {
      const prev = BASE_LEVELS[i - 1] as BaseLevelDef;
      const cur = BASE_LEVELS[i] as BaseLevelDef;
      expect(cur.cost, `Lv${i + 1} 비용`).toBeGreaterThan(prev.cost);
      expect(cur.hpMul, `Lv${i + 1} HP`).toBeGreaterThan(prev.hpMul);
      expect(cur.range, `Lv${i + 1} 사거리`).toBeGreaterThan(prev.range);
      expect(cur.dmg / cur.cooldownTicks, `Lv${i + 1} DPS`).toBeGreaterThan(
        prev.dmg / prev.cooldownTicks,
      );
    }
  });

  it('Lv1 사거리는 쏘는 타워 전부보다 짧다 (홈타운이 타워를 대체하지 못한다)', () => {
    // 오라형(brazier 1.8 / drum 2.0)은 조준 사거리가 아니라 장판/버프 반경이라 제외한다
    const shooterMin = Math.min(
      ...Object.values(TOWER_DEFS)
        .filter((d) => d.attackKind !== 'aura' && d.attackKind !== 'pulse')
        .map((d) => (d.tiers[0] as TowerTier).range),
    );
    expect(shooterMin).toBe(2.4); // frost T1 — 이 값이 바뀌면 아래 주장도 다시 봐야 한다
    expect(BASE_LEVELS[0]?.range).toBeLessThan(shooterMin);
  });

  /**
   * 만렙 사거리의 상한을 **발리스타**가 잡는다.
   *
   * 5단계 개정 전에는 `≤ 3.0`(창움막 만렙과 동일)이었다. 그 잣대는 실측으로 무너졌다:
   * 사거리가 곧 체류 시간이고, 체류 시간이 짧으면 공격력을 아무리 올려도 한 마리를
   * 못 죽이며, **죽이지 못한 피해는 누수 앞에서 아무 흔적도 남기지 않는다**
   * (근거 전문 src/data/hometown.ts). 그래서 상한을 "들판 타워보다 짧다"가 아니라
   * "가장 멀리 보는 타워보다 짧다"로 옮겼다 — 홈타운이 **최장 사거리 자리를 빼앗지
   * 않는다**가 지켜야 할 선이고, 그건 여전히 지켜진다.
   */
  it('만렙 사거리도 최장 타워(발리스타)보다 짧다 — 원거리 자리를 빼앗지 않는다', () => {
    const max = BASE_LEVELS[BASE_LEVELS.length - 1] as BaseLevelDef;
    const ballistaMin = (TOWER_DEFS.ballista.tiers[0] as TowerTier).range;
    expect(ballistaMin).toBe(5.5); // 이 값이 바뀌면 아래 주장도 다시 봐야 한다
    expect(max.range).toBeLessThan(ballistaMin);
  });

  it('화력 단가는 언제나 타워보다 나쁘다 (홈타운은 화력이 아니라 보험이다)', () => {
    const spear = TOWER_DEFS.spear;
    const t1 = spear.tiers[0] as TowerTier;
    const lv1 = BASE_LEVELS[0] as BaseLevelDef;
    const lv5 = BASE_LEVELS[BASE_LEVELS.length - 1] as BaseLevelDef;
    const dps = (d: { dmg: number; cooldownTicks: number }): number =>
      (d.dmg / d.cooldownTicks) * TICK_RATE;
    // Lv1은 가장 싼 공격 타워 T1의 절반 미만 — 혼자서는 아무것도 못 잡는다
    expect(dps(lv1)).toBeLessThan(dps(t1) * 0.5);
    /**
     * 만렙은 **단가**로 잠근다(개정 전에는 절대 dps로 잠갔다).
     * 절대 dps 상한은 "죽이지 못하는 화력 = 0"이라는 기전을 몰랐던 잣대라, 지키는 순간
     * 이 상품이 존재하지 않게 된다. 값을 매기는 올바른 단위는 골드당 dps다:
     * 홈타운 누적 4,500골드에 168dps = 26.8골드/dps, 창움막 만렙 3,100골드에 177dps =
     * 17.5골드/dps — 홈타운이 1.5배 비싸다. 칸을 안 먹고 부서지지 않는 값이 그 웃돈이다.
     */
    const baseTotal = BASE_LEVELS.reduce((a, lv) => a + lv.cost, 0);
    const spearTotal = spear.tiers.reduce((a, tr) => a + tr.cost, 0);
    const t5 = spear.tiers[4] as TowerTier;
    const baseGoldPerDps = baseTotal / dps(lv5);
    const spearGoldPerDps = spearTotal / dps(t5);
    expect(baseGoldPerDps).toBeGreaterThan(spearGoldPerDps * 1.2);
  });

  /**
   * 5단계 개정의 핵심 잣대 — **HP는 얕게 판다.**
   * hpMul 3.2(스테이지1에서 25→80)일 때 Lv2 하나가 승수와 여유를 동시에 이기는
   * 지배 전략이었다(봉투 시드 40에서 36/40·8.3 → 38/40·16.1). 완충 25뿐인 게임에서
   * 최대 HP 배증은 어떤 값을 매겨도 싸다 — 그래서 이 상품이 파는 물건을 화력으로 옮기고
   * HP 성장은 상한을 걸어 둔다. 실효는 난이도 봉투 7번(지배 전략 금지)이 잰다.
   */
  it('HP 성장은 얕다 — 최대 HP 배율 상한 (지배 전략 방지)', () => {
    const max = BASE_LEVELS[BASE_LEVELS.length - 1] as BaseLevelDef;
    expect(max.hpMul).toBeLessThanOrEqual(1.6);
    // 레벨당 증가폭도 고르게 — 한 칸에 몰아주면 그 칸이 다시 지배 전략이 된다
    for (let i = 1; i < BASE_LEVELS.length; i++) {
      const d = (BASE_LEVELS[i] as BaseLevelDef).hpMul - (BASE_LEVELS[i - 1] as BaseLevelDef).hpMul;
      expect(d, `Lv${i + 1} hpMul 증가폭`).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('다음 레벨 미리보기 (비가역 결제 전 정보)', () => {
  it('다음 레벨의 최대HP·공격력·사거리·출격 한계선을 sim이 확정한 값으로 준다', () => {
    const sim = armedSim({ gold: 1000, baseHp: 10 });
    // 목 테이블: Lv2 = hpMul 2 · dmg 20 · range 3 · sortie는 목 기본값(6.0)
    expect(sim.baseNextStats()).toEqual({
      hpMax: 20,
      dmg: 20,
      range: 3,
      sortie: ALLY_SORTIE_RANGE,
    });
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    // Lv3 = hpMul 3 · dmg 40 · range 4
    expect(sim.baseNextStats()).toEqual({
      hpMax: 30,
      dmg: 40,
      range: 4,
      sortie: ALLY_SORTIE_RANGE,
    });
  });

  it('미리보기 최대HP가 실제 레벨업 결과와 정확히 일치한다 (반올림이 갈리지 않는다)', () => {
    // hpMul 1.9 × baseHp 25 = 47.5 — UI가 따로 곱하면 47/48이 갈릴 수 있는 자리다
    const sim = armedSim({ gold: 100000, baseHp: 25, levels: [{}, { hpMul: 1.9 }, {}] });
    const preview = sim.baseNextStats();
    expect(preview).not.toBeNull();
    sim.applyCommand({ type: 'upgradeBase' });
    expect(sim.state.baseHpMax).toBe(preview?.hpMax);
  });

  it('최대 레벨에서는 null이다', () => {
    const sim = armedSim({ gold: 100000 });
    sim.applyCommand({ type: 'upgradeBase' });
    sim.applyCommand({ type: 'upgradeBase' });
    expect(sim.state.baseLevel).toBe(sim.state.baseLevelMax);
    expect(sim.baseNextStats()).toBeNull();
  });
});

/**
 * 아군과 함께 쓸 때의 사거리 관계 — 5단계 검증에서 나온 결함의 회귀 잠금.
 *
 * 아군은 기지에서 ALLY_SORTIE_RANGE(6.0타일) 앞에 줄을 서서 적을 붙잡아 죽인다.
 * 홈타운 Lv1의 사거리는 2.0이라 **그 줄을 넘어오는 적이 없으면 한 발도 못 쏜다** —
 * 4단계 문서가 "세 겹(타워 → 아군 6.0 → 홈타운 ≤3.0)"이라고 쓴 것은 겹을 더한 게
 * 아니라 한 겹을 가린 것이었다(실측: 6,000틱 baseFired = 0).
 *
 * 그래서 잠그는 것은 "**레벨을 올리면 그 상황에서도 마을이 싸운다**"이다.
 * Lv1이 0이라는 사실 자체는 어서션하지 않는다 — 출격 한계선을 줄이면 개선되는
 * 방향이고, 그 개선을 이 테스트가 막아서는 안 된다.
 */
describe('아군과 함께 있을 때의 홈타운 사격', () => {
  function noTowerRun(upgradeToMax: boolean): { fired: number; trained: number } {
    const stage = stageById(1);
    if (!stage) throw new Error('no stage 1');
    const sim = createBattle({
      stage,
      stars: {},
      deck: ['spear'],
      endless: true,
      seed: 4242,
      towerDefs: TOWER_DEFS,
      enemyDefs: ENEMY_DEFS,
      allyDefs: ALLY_DEFS,
      baseLevels: BASE_LEVELS,
      waveFor: makeWaveFor(stage),
    });
    const mut = sim.state as unknown as { baseHp: number; gold: number };
    let fired = 0;
    let trained = 0;
    for (let i = 0; i < 6000; i++) {
      // 타워 0기로 6,000틱을 버티게 하려면 기지를 계속 되돌려야 한다 (사격만 재는 실험)
      mut.baseHp = sim.state.baseHpMax;
      mut.gold = 999_999;
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      if (i % 53 === 0 && sim.applyCommand({ type: 'trainAlly', defId: 'clubber' })) trained++;
      if (upgradeToMax && i % 601 === 0) sim.applyCommand({ type: 'upgradeBase' });
      sim.tick();
      for (const ev of sim.drainEvents()) if (ev.type === 'baseFired') fired++;
    }
    return { fired, trained };
  }

  it('만렙 마을은 아군이 길목을 잡고 있어도 화살을 쏜다', () => {
    const maxed = noTowerRun(true);
    expect(maxed.trained, '아군이 실제로 나가 있어야 실험이 성립한다').toBeGreaterThan(10);
    expect(maxed.fired, `만렙 마을 발사 수: ${JSON.stringify(maxed)}`).toBeGreaterThan(0);
  }, 60_000);
});
