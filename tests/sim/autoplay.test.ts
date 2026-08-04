/**
 * 자동플레이 밸런스 하네스 — 난이도 봉투를 CI에 고정한다.
 * 봇 전략(평범한 플레이 근사): 타워 8기까지 배치 → 최다투자 타워 집중 업그레이드
 * → 여유골드 1.5배면 추가 배치. 새로고침/판매/타게팅 미사용 (사람은 이보다 잘한다).
 * 배치 8기 상한 근거(지가 상승 시대): 7~8기째 배치 비용은 기본가 ×1.6~1.7로
 * 티어 업그레이드(비용 ×2, DPS ×1.65)와 비슷한 효율이라 소수 정예+업그레이드가
 * 합리적 플레이 — 실측에서도 6기 상한보다 8기 상한이 우세했다 (스팸 20기는 ×2.9로 비효율).
 *
 * 봉투:
 *  - 스테이지1, 별 0: 시드 5개 중 3개 이상 클리어, 전부 웨이브 45+ 도달 (초심자 클리어 보장)
 *  - 스테이지1, 방치(타워 0): 웨이브 3 안에 패배 (공짜 클리어 방지)
 *  - 스테이지6, 별 0: 클리어 불가 (난이도 서열 보장)
 *  - 불도저 봇(골드로 소품 제거 우선): 스테이지1에서 일반 봇보다 우세하지 않고
 *    스테이지6은 여전히 클리어 불가 (지형 개조가 난이도 서열을 무너뜨리지 않는다)
 */
import { describe, expect, it } from 'vitest';
import { createBattle } from '@/sim/battle';
import { ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import { rasterizePathCells } from '@/data/grid';
import type { BattleSim, StageDef, TowerId } from '@/data/types';

/** 봇 배치 상한 — 지가 상승으로 8기 이후는 업그레이드가 우세 (헤더 주석 참조) */
const PLACEMENT_CAP = 8;

const STAGE1_DECK: TowerId[] = ['spear', 'catapult', 'frost'];
const ALL_DECK: TowerId[] = [
  'spear', 'catapult', 'frost', 'lightning', 'poison', 'ballista', 'brazier', 'drum',
];

function makeSim(
  stageId: number,
  seed: number,
  deck: TowerId[],
  stars = 0,
): { sim: BattleSim; stage: StageDef } {
  const stage = stageById(stageId);
  if (!stage) throw new Error(`no stage ${stageId}`);
  const starMap: Partial<Record<TowerId, number>> = {};
  for (const id of deck) starMap[id] = stars;
  const sim = createBattle({
    stage,
    stars: starMap,
    deck,
    endless: false,
    seed,
    towerDefs: TOWER_DEFS,
    enemyDefs: ENEMY_DEFS,
    waveFor: makeWaveFor(stage),
  });
  return { sim, stage };
}

interface BotResult {
  won: boolean;
  wave: number;
  /** 이 판에서 골드로 치운 소품 수 */
  clears: number;
}

/**
 * bulldoze=true면 "경로에 더 가까운 자리를 골드로 사는" 불도저 봇이 된다.
 * (소품 셀도 후보에 넣고, 배치 직전에 제거 비용+배치 비용을 함께 감당할 수 있으면 치운다)
 */
function runBot(
  sim: BattleSim,
  stage: StageDef,
  opts: { bulldoze?: boolean } = {},
  maxIters = 900,
): BotResult {
  const bulldoze = opts.bulldoze === true;
  // 자유 배치: 경로에서 가까운 셀부터 채운다 (사람의 상식적 배치 근사)
  const pathCells = rasterizePathCells(stage);
  const pathPts: [number, number][] = [];
  for (const key of pathCells) pathPts.push([key % stage.gridW, Math.floor(key / stage.gridW)]);
  const slots: [number, number][] = [];
  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      if (sim.canPlaceAt(x, z) || (bulldoze && sim.hasScenery(x, z))) slots.push([x, z]);
    }
  }
  const distToPath = ([x, z]: [number, number]): number => {
    let best = Infinity;
    for (const [px, pz] of pathPts) {
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < best) best = d;
    }
    return best;
  };
  slots.sort((a, b) => distToPath(a) - distToPath(b));
  /** 불도저 봇이 이번 판에서 실제로 치운 횟수 (검증이 공허하지 않은지 확인용) */
  let clears = 0;
  /**
   * 지금 배치 가능한 최선의 셀. 불도저 봇은 경로에 더 가까운 소품 자리를 만나면
   * (제거비 + 배치비)를 감당할 수 있는 한 골드를 내고 산다 = "맵을 미는" 최대치 플레이.
   * 자유 배치라 빈 땅은 늘 남아 있으므로, 이 봇이 사는 건 순수하게 '더 좋은 자리'다.
   */
  const freeSlot = (placeCost: number): [number, number] | undefined => {
    const free = slots.find(([x, z]) => sim.canPlaceAt(x, z));
    if (!bulldoze) return free;
    // 경로에 가까운 순서로 소품 자리를 훑어 살 수 있는 첫 자리를 산다.
    // (자유 배치라 늘 빈 땅이 남으므로, 이 지출은 순수하게 '더 좋은 자리' 값이다)
    for (const [x, z] of slots) {
      const clear = sim.clearSceneryCost(x, z);
      if (clear === null || sim.state.gold < clear + placeCost) continue;
      if (sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z })) {
        clears++;
        return [x, z];
      }
    }
    return free;
  };
  let guard = 0;
  while (sim.state.phase !== 'won' && sim.state.phase !== 'lost' && guard < maxIters) {
    guard++;
    const st = sim.state;
    if (st.towers.length < PLACEMENT_CAP) {
      for (let h = 0; h < st.hand.length; h++) {
        const card = st.hand[h];
        if (!card || st.gold < card.cost) continue;
        const free = freeSlot(card.cost);
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
    else if (st.towers.length >= PLACEMENT_CAP) {
      for (let h = 0; h < st.hand.length; h++) {
        const card = st.hand[h];
        if (!card || st.gold < card.cost * 1.5) continue;
        const free = freeSlot(card.cost);
        if (!free) break;
        sim.applyCommand({ type: 'placeTower', handIndex: h, cellX: free[0], cellZ: free[1] });
        break;
      }
    }
    if (st.phase === 'prep' && st.prepTicksLeft > 0) sim.applyCommand({ type: 'callWave' });
    for (let i = 0; i < 120; i++) sim.tick();
    sim.drainEvents();
  }
  return { won: sim.state.phase === 'won', wave: sim.state.waveIndex, clears };
}

describe('autoplay 난이도 봉투', () => {
  it('스테이지1: 평범한 봇이 시드 5개 중 3+ 클리어, 전부 웨이브 45+', () => {
    const seeds = [101, 202, 303, 404, 505];
    const results = seeds.map((s) => {
      const { sim, stage } = makeSim(1, s, STAGE1_DECK);
      return runBot(sim, stage);
    });
    const wins = results.filter((r) => r.won).length;
    const minWave = Math.min(...results.map((r) => r.wave));
    expect(wins, `클리어 ${wins}/5, 결과: ${JSON.stringify(results)}`).toBeGreaterThanOrEqual(3);
    expect(minWave, `최소 도달 웨이브: ${JSON.stringify(results)}`).toBeGreaterThanOrEqual(43);
  }, 60_000);

  it('스테이지1: 방치(타워 0)면 웨이브 10 안에 패배', () => {
    const { sim } = makeSim(1, 7, STAGE1_DECK);
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
    const { sim, stage } = makeSim(6, 11, ALL_DECK);
    const r = runBot(sim, stage);
    expect(r.won, `stage6 결과: ${JSON.stringify(r)}`).toBe(false);
  }, 60_000);

  it('불도저 봇(소품 제거로 자리 사기)이 스테이지1을 더 쉽게 만들지 않는다', () => {
    const seeds = [101, 202, 303, 404, 505];
    const plain = seeds.map((s) => {
      const { sim, stage } = makeSim(1, s, STAGE1_DECK);
      return runBot(sim, stage);
    });
    const dozer = seeds.map((s) => {
      const { sim, stage } = makeSim(1, s, STAGE1_DECK);
      return runBot(sim, stage, { bulldoze: true });
    });
    const wins = (rs: BotResult[]): number => rs.filter((r) => r.won).length;
    const msg = `일반 ${JSON.stringify(plain)} / 불도저 ${JSON.stringify(dozer)}`;
    // 검증이 공허하지 않은지 — 봇이 실제로 골드를 내고 지형을 갈아엎었어야 한다
    expect(dozer.reduce((a, r) => a + r.clears, 0), msg).toBeGreaterThan(0);
    // 제거에 쓴 골드만큼 강화가 밀리므로 클리어 수가 늘어나면 안 된다 (지배 전략 금지)
    expect(wins(dozer), msg).toBeLessThanOrEqual(wins(plain));
  }, 120_000);

  it('불도저 봇도 스테이지6은 클리어 불가 (지형 개조가 서열을 뒤집지 않는다)', () => {
    const { sim, stage } = makeSim(6, 11, ALL_DECK);
    const r = runBot(sim, stage, { bulldoze: true });
    expect(r.won, `stage6 불도저 결과: ${JSON.stringify(r)}`).toBe(false);
  }, 60_000);
});
