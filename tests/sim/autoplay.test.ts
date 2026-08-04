/**
 * 자동플레이 밸런스 하네스 — 난이도 봉투를 CI에 고정한다.
 * 봇 전략(평범한 플레이 근사): 슬롯 6개까지 배치 → 최다투자 타워 집중 업그레이드
 * → 여유골드 1.5배면 추가 배치. 새로고침/판매/타게팅 미사용 (사람은 이보다 잘한다).
 *
 * 봉투:
 *  - 스테이지1, 별 0: 시드 5개 중 3개 이상 클리어, 전부 웨이브 45+ 도달 (초심자 클리어 보장)
 *  - 스테이지1, 방치(타워 0): 웨이브 3 안에 패배 (공짜 클리어 방지)
 *  - 스테이지6, 별 0: 클리어 불가 (난이도 서열 보장)
 */
import { describe, expect, it } from 'vitest';
import { createBattle } from '@/sim/battle';
import { ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import type { BattleSim, TowerId } from '@/data/types';

const STAGE1_DECK: TowerId[] = ['spear', 'catapult', 'frost'];
const ALL_DECK: TowerId[] = [
  'spear', 'catapult', 'frost', 'lightning', 'poison', 'ballista', 'brazier', 'drum',
];

function makeSim(stageId: number, seed: number, deck: TowerId[], stars = 0): BattleSim {
  const stage = stageById(stageId);
  if (!stage) throw new Error(`no stage ${stageId}`);
  const starMap: Partial<Record<TowerId, number>> = {};
  for (const id of deck) starMap[id] = stars;
  return createBattle({
    stage,
    stars: starMap,
    deck,
    endless: false,
    seed,
    towerDefs: TOWER_DEFS,
    enemyDefs: ENEMY_DEFS,
    waveFor: makeWaveFor(stage),
  });
}

interface BotResult {
  won: boolean;
  wave: number;
}

function runBot(sim: BattleSim, maxIters = 900): BotResult {
  const stage = { w: 40, h: 40 };
  const slots: [number, number][] = [];
  for (let z = 0; z < stage.h; z++) {
    for (let x = 0; x < stage.w; x++) if (sim.canPlaceAt(x, z)) slots.push([x, z]);
  }
  let guard = 0;
  while (sim.state.phase !== 'won' && sim.state.phase !== 'lost' && guard < maxIters) {
    guard++;
    const st = sim.state;
    if (st.towers.length < 6) {
      for (let h = 0; h < st.hand.length; h++) {
        const card = st.hand[h];
        if (!card || st.gold < card.cost) continue;
        const free = slots.find(([x, z]) => sim.canPlaceAt(x, z));
        if (!free) break;
        sim.applyCommand({ type: 'placeTower', handIndex: h, cellX: free[0], cellZ: free[1] });
        break;
      }
    }
    let best: { id: number; inv: number } | null = null;
    for (const t of st.towers) {
      const c = sim.upgradeCost(t.id);
      if (c !== null && st.gold >= c && (!best || t.invested > best.inv)) {
        best = { id: t.id, inv: t.invested };
      }
    }
    if (best) sim.applyCommand({ type: 'upgradeTower', towerId: best.id });
    else if (st.towers.length >= 6) {
      for (let h = 0; h < st.hand.length; h++) {
        const card = st.hand[h];
        if (!card || st.gold < card.cost * 1.5) continue;
        const free = slots.find(([x, z]) => sim.canPlaceAt(x, z));
        if (!free) break;
        sim.applyCommand({ type: 'placeTower', handIndex: h, cellX: free[0], cellZ: free[1] });
        break;
      }
    }
    if (st.phase === 'prep' && st.prepTicksLeft > 0) sim.applyCommand({ type: 'callWave' });
    for (let i = 0; i < 120; i++) sim.tick();
    sim.drainEvents();
  }
  return { won: sim.state.phase === 'won', wave: sim.state.waveIndex };
}

describe('autoplay 난이도 봉투', () => {
  it('스테이지1: 평범한 봇이 시드 5개 중 3+ 클리어, 전부 웨이브 45+', () => {
    const seeds = [101, 202, 303, 404, 505];
    const results = seeds.map((s) => runBot(makeSim(1, s, STAGE1_DECK)));
    const wins = results.filter((r) => r.won).length;
    const minWave = Math.min(...results.map((r) => r.wave));
    expect(wins, `클리어 ${wins}/5, 결과: ${JSON.stringify(results)}`).toBeGreaterThanOrEqual(3);
    expect(minWave, `최소 도달 웨이브: ${JSON.stringify(results)}`).toBeGreaterThanOrEqual(43);
  }, 60_000);

  it('스테이지1: 방치(타워 0)면 웨이브 10 안에 패배', () => {
    const sim = makeSim(1, 7, STAGE1_DECK);
    sim.applyCommand({ type: 'callWave' });
    for (let i = 0; i < 30 * 60 * 8 && sim.state.phase !== 'lost'; i++) {
      sim.tick();
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      sim.drainEvents();
    }
    expect(sim.state.phase).toBe('lost');
    expect(sim.state.waveIndex).toBeLessThanOrEqual(10);
  }, 30_000);

  it('스테이지6: 별 0 봇은 클리어 불가 (난이도 서열)', () => {
    const r = runBot(makeSim(6, 11, ALL_DECK));
    expect(r.won, `stage6 결과: ${JSON.stringify(r)}`).toBe(false);
  }, 60_000);
});
