/**
 * previewWave — **미리보기가 실제 웨이브와 같은 것을 말하는지** 잠근다.
 *
 * 이 파일이 지키는 계약은 둘이다:
 *  1. **일치** — previewWave(n)의 종별 마릿수/체력 합계가, 그 웨이브를 실제로 돌렸을 때
 *     스폰된 종별 합계와 **한 자리도 다르지 않다.** 미리보기와 스포너는 서로 다른 두 식
 *     (battle.previewWave / waves.spawn)이라, 한쪽만 고치면 화면이 조용히 거짓말을 한다.
 *  2. **순수** — 조회가 상태·해시·이벤트를 한 톨도 건드리지 않는다. 이게 참이어야
 *     "밸런스를 한 자리도 바꾸지 않는다"는 Phase 1의 합격 조건이 구조적으로 보장된다.
 */
import { describe, expect, it } from 'vitest';
import type { BattleOptions, EnemyId, StageDef, WaveDef } from '@/data/types';
import { ALLY_DEFS, BASE_LEVELS, ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import { createBattle } from '@/sim/battle';
import { baseLevels, options, stageDef, wave } from './fixtures';

const stage1 = (): StageDef => {
  const s = stageById(1);
  if (!s) throw new Error('no stage 1');
  return s;
};

/** 실제 스테이지 정의로 만든 전투 (기지 체력만 크게 — 누수로 판이 끝나면 스폰이 끊긴다) */
function realSim(stage: StageDef, waveFor: (w: number) => WaveDef, endless = false) {
  const opts: BattleOptions = {
    stage: { ...stage, baseHp: 1_000_000 },
    stars: {},
    deck: ['spear', 'catapult', 'frost'],
    endless,
    seed: 7,
    towerDefs: TOWER_DEFS,
    enemyDefs: ENEMY_DEFS,
    allyDefs: ALLY_DEFS,
    baseLevels: BASE_LEVELS,
    waveFor,
  };
  return createBattle(opts);
}

interface Tally {
  count: Map<EnemyId, number>;
  hp: Map<EnemyId, number>;
}

/** 한 판을 끝까지 돌리며 **스폰된 개체**를 종별로 센다 (id는 재사용되지 않는다) */
function spawned(sim: ReturnType<typeof realSim>, ticks = 6000): Tally {
  const seen = new Set<number>();
  const count = new Map<EnemyId, number>();
  const hp = new Map<EnemyId, number>();
  sim.applyCommand({ type: 'callWave' });
  // **한 웨이브만** 센다 — waveFor가 같은 편성을 계속 주므로, 웨이브가 끝나고
  // 다음 prep이 시작되면 같은 무리가 또 나온다(그러면 3배로 세게 된다)
  let started = false;
  for (let i = 0; i < ticks; i++) {
    sim.tick();
    for (const e of sim.state.enemies) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      count.set(e.defId, (count.get(e.defId) ?? 0) + 1);
      hp.set(e.defId, (hp.get(e.defId) ?? 0) + e.maxHp);
    }
    if (sim.state.phase === 'wave') started = true;
    else if (started) break;
  }
  expect(started, '웨이브가 실제로 시작됐다').toBe(true);
  return { count, hp };
}

describe('previewWave — 미리보기와 실제 웨이브가 같다', () => {
  /**
   * 표본에 무엇이 들어 있는가: w1(도입) · w10/20/30/40/50(보스 오버라이드) ·
   * w22/38(하늘길) · w25/31(스웜) · w33(엘리트). 곧 편성 템플릿 전부를 한 번씩 지난다.
   */
  const WAVES = [1, 5, 10, 20, 22, 25, 30, 31, 33, 38, 40, 50];

  it.each(WAVES)('w%i — 종별 마릿수와 체력 합계가 실제 스폰과 일치한다', (w) => {
    const stage = stage1();
    const waveFor = makeWaveFor(stage);
    const def = waveFor(w);
    // 웨이브 1의 자리에 w의 편성을 놓는다 — 50웨이브를 실제로 다 돌지 않고 그 웨이브만 잰다
    const sim = realSim(stage, () => def);
    const p = sim.previewWave(1);
    const got = spawned(sim);

    const ids = [...new Set([...p.entries.map((e) => e.defId), ...got.count.keys()])].sort();
    for (const id of ids) {
      const e = p.entries.find((x) => x.defId === id);
      expect(e?.count ?? 0, `${id} 마릿수`).toBe(got.count.get(id) ?? 0);
      expect(e?.totalHp ?? 0, `${id} 체력 합계`).toBe(got.hp.get(id) ?? 0);
    }
    expect(p.totalCount, '총 마릿수').toBe([...got.count.values()].reduce((a, b) => a + b, 0));
    expect(p.totalHp, '총 체력').toBe([...got.hp.values()].reduce((a, b) => a + b, 0));
    expect(p.goldReward).toBe(def.goldReward);
  });

  /**
   * 무한 모드의 초과분(ENDLESS_HP_GROWTH^(wave−waveCount))은 스포너가 startWave에서
   * 곱하는 값이라 **미리보기가 따로 곱해야** 한다. 두 곱셈이 어긋나면 후반 무한 모드에서
   * 미리보기가 조용히 작아진다 — 실제로 돌려서 확인한다.
   */
  it('무한 모드 초과분(1.06^n)도 스폰과 같은 식을 쓴다', () => {
    const sim = createBattle(
      options({
        endless: true,
        /*
         * ⚠⚠ **마을을 무장시킨다 (2026-08-27)** — 없으면 웨이브 5 까지 못 간다.
         *   사용자 지시로 문간 체류 상한이 없어져(`src/sim/gate.ts`) 문 앞에 선 적은
         *   **죽어야만** 사라진다. 목 표의 마을은 기본이 무장 해제라, `baseHp` 100만인
         *   이 판에서는 첫 마리가 문 앞에 선 순간 웨이브가 영영 안 끝났다(실측: 웨이브 5
         *   도달 0마리). 사거리 1 은 문간 정지선(1.95)보다 짧아 `atGate` 인 적만 쏜다
         *   (hometown 규칙 2-b) — 접근 구간은 손대지 않는다.
         *   이 항목이 재는 것은 **미리보기와 실제 스폰이 같은 식을 쓰는가**이지 문간이 아니다.
         */
        baseLevels: baseLevels([{ dmg: 1_000, cooldownTicks: 5, range: 1 }]),
        stage: stageDef({ baseHp: 1_000_000, waveCount: 2 }),
        waves: [wave([{ enemyId: 'boar', count: 3, hpMul: 1.3, intervalTicks: 4 }])],
      }),
    );
    const TARGET = 5; // waveCount 2 → 초과분 1.06^3
    const p = sim.previewWave(TARGET);
    const seen = new Set<number>();
    let hp = 0;
    let n = 0;
    for (let i = 0; i < 8000 && sim.state.waveIndex <= TARGET; i++) {
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      sim.tick();
      if (sim.state.waveIndex !== TARGET) continue;
      for (const e of sim.state.enemies) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        hp += e.maxHp;
        n++;
      }
    }
    expect(n, '마릿수').toBe(p.totalCount);
    expect(hp, '체력 합계').toBe(p.totalHp);
    // 그리고 정규 웨이브보다 실제로 크다 (배율이 0이 아니라 붙었다는 증거)
    expect(p.totalHp).toBeGreaterThan(sim.previewWave(2).totalHp);
  });

  it('보스·공중 정보가 실려 나온다', () => {
    const stage = stage1();
    const sim = realSim(stage, makeWaveFor(stage));
    expect(sim.previewWave(50).boss, 'w50에는 보스가 있다').toBe(true);
    expect(sim.previewWave(1).boss, 'w1에는 보스가 없다').toBe(false);
    expect(sim.previewWave(22).hasAir, 'w22는 하늘길이다').toBe(true);
    expect(sim.previewWave(21).hasAir, 'w21은 지상뿐이다').toBe(false);
  });

  it('종별 합산은 총 HP 내림차순이고 동점은 종 id 사전순이다 (완전 결정론)', () => {
    const stage = stage1();
    const sim = realSim(stage, makeWaveFor(stage));
    for (let w = 1; w <= 50; w++) {
      const es = sim.previewWave(w).entries;
      for (let i = 1; i < es.length; i++) {
        const a = es[i - 1]!;
        const b = es[i]!;
        expect(a.totalHp >= b.totalHp, `w${w} 정렬`).toBe(true);
        if (a.totalHp === b.totalHp) expect(a.defId < b.defId, `w${w} 동점 정렬`).toBe(true);
      }
    }
  });
});

describe('previewWave — 순수 조회다', () => {
  it('상태·해시·이벤트를 한 톨도 건드리지 않는다', () => {
    const sim = createBattle(
      options({
        waves: [
          wave([{ enemyId: 'raptor', count: 3 }]),
          wave([{ enemyId: 'boar', count: 2, hpMul: 2 }]),
        ],
      }),
    );
    for (let i = 0; i < 40; i++) sim.tick();
    sim.drainEvents();
    const before = sim.hash();
    const tick = sim.state.tick;
    const gold = sim.state.gold;
    for (let w = 1; w <= 30; w++) sim.previewWave(w);
    sim.previewWave();
    expect(sim.hash(), '해시').toBe(before);
    expect(sim.drainEvents(), '이벤트').toEqual([]);
    expect(sim.state.tick).toBe(tick);
    expect(sim.state.gold).toBe(gold);
  });

  it('같은 웨이브를 몇 번 물어도 같은 답이다', () => {
    const sim = createBattle(options({ waves: [wave([{ enemyId: 'raptor', count: 3 }])] }));
    expect(sim.previewWave(1)).toEqual(sim.previewWave(1));
  });

  it('기본 인자는 "다음에 올 웨이브"다 — prep이면 지금 번호, 전투 중이면 +1', () => {
    const sim = createBattle(
      options({
        waves: [wave([{ enemyId: 'raptor', count: 1 }]), wave([{ enemyId: 'boar', count: 1 }])],
      }),
    );
    // prep: waveIndex(1)가 이미 "다음" 웨이브다
    expect(sim.state.phase).toBe('prep');
    expect(sim.previewWave().wave).toBe(1);
    sim.applyCommand({ type: 'callWave' });
    sim.tick();
    expect(sim.state.phase).toBe('wave');
    // 전투 중: 지금이 1이므로 다음은 2
    expect(sim.previewWave().wave).toBe(2);
  });

  it('임의 웨이브를 조회할 수 있다 (계량기의 사용 방식)', () => {
    const stage = stage1();
    const sim = realSim(stage, makeWaveFor(stage));
    let total = 0;
    for (let w = 1; w <= stage.waveCount; w++) total += sim.previewWave(w).totalHp;
    // 스테이지1 50웨이브 총 HP (계량기 실측값 — 웨이브 곡선이 움직이면 여기서 걸린다)
    expect(total).toBe(345232);
    expect(sim.state.waveIndex, '조회가 진행 상태를 안 건드린다').toBe(1);
  });
});
