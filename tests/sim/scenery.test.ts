/**
 * 골드로 방해 지형지물(나무·바위) 제거 — 규칙/경제/결정론.
 * sim이 진실의 원천이므로 여기서 막힌 것은 렌더에서도 절대 일어나면 안 된다.
 */
import { describe, expect, it } from 'vitest';
import { createBattle } from '@/sim/battle';
import { ALLY_DEFS, BASE_LEVELS, ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import { cellKey, charAt, rasterizePathCells, sceneryCells } from '@/data/grid';
import { sceneryClearCostFor } from '@/sim/economy';
import {
  SCENERY_CLEAR_BASE_COST,
  SCENERY_CLEAR_GROWTH,
  SCENERY_CLEAR_MAX_COST,
} from '@/data/balance';
import type { BattleCommand, BattleSim, SimEvent, StageDef } from '@/data/types';

const stage = stageById(1) as StageDef;
const pathCells = rasterizePathCells(stage);
const scenery = [...sceneryCells(stage, pathCells)].map((k) => ({
  x: k % stage.gridW,
  z: Math.floor(k / stage.gridW),
}));

function simFor(gold = 100_000): BattleSim {
  const sim = createBattle({
    stage,
    stars: {},
    deck: ['spear'],
    endless: false,
    seed: 42,
    towerDefs: TOWER_DEFS,
    enemyDefs: ENEMY_DEFS,
    allyDefs: ALLY_DEFS,
    baseLevels: BASE_LEVELS,
    waveFor: makeWaveFor(stage),
  });
  (sim.state as { gold: number }).gold = gold;
  return sim;
}

/** 테스트 편의 — 첫 n개 소품 셀 */
function cell(i: number): { x: number; z: number } {
  const c = scenery[i];
  if (!c) throw new Error(`소품 셀 ${i} 없음 (총 ${scenery.length}개)`);
  return c;
}

describe('소품 제거 — 비용 곡선', () => {
  it('제거 횟수에 따라 지수적으로 오르고 상한에서 멈춘다', () => {
    expect(sceneryClearCostFor(0)).toBe(SCENERY_CLEAR_BASE_COST);
    // 상한에 닿기 전에는 GROWTH배로 오르고, 닿은 뒤에는 평평하다.
    // (BASE가 오르면 8회 안에 상한에 닿을 수 있으므로 '항상 증가'로 잠그지 않는다)
    let capped = false;
    for (let n = 0; n < 8; n++) {
      const cur = sceneryClearCostFor(n);
      const next = sceneryClearCostFor(n + 1);
      expect(next, `${n}→${n + 1}번째는 줄어들면 안 된다`).toBeGreaterThanOrEqual(cur);
      if (next >= SCENERY_CLEAR_MAX_COST) capped = true;
      if (capped) {
        expect(next, `상한 후 ${n + 1}번째`).toBe(SCENERY_CLEAR_MAX_COST);
      } else {
        expect(next, `${n}→${n + 1}번째는 올라야 한다`).toBeGreaterThan(cur);
        expect(next / cur).toBeCloseTo(SCENERY_CLEAR_GROWTH, 1);
      }
    }
    expect(sceneryClearCostFor(50)).toBe(SCENERY_CLEAR_MAX_COST);
  });

  it('공짜에 가깝지 않다 — 첫 제거가 최저가 타워 배치와 같은 급', () => {
    // 가장 싼 타워(frost 90)에 준하는 값이어야 "자리를 산다"는 의사결정이 성립한다
    const cheapest = Math.min(...Object.values(TOWER_DEFS).map((d) => d.tiers[0]?.cost ?? 0));
    expect(sceneryClearCostFor(0)).toBeGreaterThan(cheapest * 0.5);
  });

  it('6회 누적 비용이 스테이지1 웨이브 1~20 총 보상을 넘는다 (맵 밀기 방지)', () => {
    let cum = 0;
    for (let n = 0; n < 6; n++) cum += sceneryClearCostFor(n);
    let reward = 0;
    for (let w = 1; w <= 20; w++) reward += makeWaveFor(stage)(w).goldReward;
    expect(cum).toBeGreaterThan(reward);
  });
});

describe('소품 제거 — 커맨드 규칙', () => {
  it('제거하면 그 셀이 건설 가능해지고 골드가 빠진다', () => {
    const sim = simFor(500);
    const c = cell(0);
    expect(sim.hasScenery(c.x, c.z)).toBe(true);
    expect(sim.canPlaceAt(c.x, c.z)).toBe(false);
    const cost = sim.clearSceneryCost(c.x, c.z);
    expect(cost).toBe(sceneryClearCostFor(0));

    expect(sim.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z })).toBe(true);
    expect(sim.state.gold).toBe(500 - (cost as number));
    expect(sim.hasScenery(c.x, c.z)).toBe(false);
    expect(sim.canPlaceAt(c.x, c.z)).toBe(true);
    // 실제로 그 자리에 지어진다
    expect(
      sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: c.x, cellZ: c.z }),
    ).toBe(true);
    expect(sim.towerAt(c.x, c.z)).not.toBeNull();
  });

  it('같은 셀을 두 번 제거해도 골드는 한 번만 빠진다', () => {
    const sim = simFor(1000);
    const c = cell(0);
    expect(sim.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z })).toBe(true);
    const after = sim.state.gold;
    expect(sim.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z })).toBe(false);
    expect(sim.state.gold).toBe(after);
    expect(sim.clearSceneryCost(c.x, c.z)).toBeNull();
    // 다음 셀 비용은 1회 제거분만 반영 (실패한 제거는 카운트되지 않는다)
    const c2 = cell(1);
    expect(sim.clearSceneryCost(c2.x, c2.z)).toBe(sceneryClearCostFor(1));
  });

  it('골드가 모자라면 거부된다 (골드/소품 모두 그대로)', () => {
    const sim = simFor(sceneryClearCostFor(0) - 1);
    const c = cell(0);
    expect(sim.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z })).toBe(false);
    expect(sim.state.gold).toBe(sceneryClearCostFor(0) - 1);
    expect(sim.hasScenery(c.x, c.z)).toBe(true);
    expect(sim.canPlaceAt(c.x, c.z)).toBe(false);
  });

  it('경로/물/장식/빈 지상 셀에는 소품이 없다고 답한다 (패널 미표시 근거)', () => {
    const sim = simFor();
    let checkedPath = 0;
    let checkedGround = 0;
    for (let z = 0; z < stage.gridH; z++) {
      for (let x = 0; x < stage.gridW; x++) {
        const key = cellKey(stage, x, z);
        const ch = charAt(stage, x, z);
        const isScenery = sceneryCells(stage, pathCells).has(key);
        if (pathCells.has(key)) {
          expect(sim.hasScenery(x, z), `경로 (${x},${z})`).toBe(false);
          checkedPath++;
        } else if (ch === '~' || ch === '#') {
          expect(sim.hasScenery(x, z), `물/장식 (${x},${z})`).toBe(false);
        } else if (!isScenery) {
          expect(sim.hasScenery(x, z), `빈 지상 (${x},${z})`).toBe(false);
          expect(sim.clearSceneryCost(x, z), `빈 지상 비용 (${x},${z})`).toBeNull();
          checkedGround++;
        }
      }
    }
    expect(checkedPath).toBeGreaterThan(0);
    expect(checkedGround).toBeGreaterThan(0);
  });

  it('격자 밖/소수 좌표는 거부', () => {
    const sim = simFor();
    for (const [x, z] of [[-1, 0], [999, 0], [0, -3], [1.5, 2]] as [number, number][]) {
      expect(sim.hasScenery(x, z), `(${x},${z})`).toBe(false);
      expect(sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z })).toBe(false);
    }
  });

  it('제거 성공 시 셀 좌표와 비용을 담은 이벤트를 발행한다', () => {
    const sim = simFor(1000);
    const c = cell(0);
    sim.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z });
    const ev = sim.drainEvents().find((e: SimEvent) => e.type === 'sceneryCleared');
    expect(ev).toEqual({
      type: 'sceneryCleared',
      cellX: c.x,
      cellZ: c.z,
      cost: sceneryClearCostFor(0),
      clearedCount: 1,
    });
  });

  it('전투 종료 후에는 제거할 수 없다', () => {
    const sim = simFor(1000);
    (sim.state as { phase: string }).phase = 'lost';
    const c = cell(0);
    expect(sim.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z })).toBe(false);
  });
});

describe('소품 제거 — 결정론', () => {
  const SCRIPT: [number, BattleCommand][] = [
    [2, { type: 'clearScenery', cellX: cell(0).x, cellZ: cell(0).z }],
    [4, { type: 'placeTower', handIndex: 0, cellX: cell(0).x, cellZ: cell(0).z }],
    [6, { type: 'clearScenery', cellX: cell(1).x, cellZ: cell(1).z }],
    // 실패하는 제거(중복)도 스크립트에 섞어 상태가 어긋나지 않는지 본다
    [7, { type: 'clearScenery', cellX: cell(1).x, cellZ: cell(1).z }],
    [9, { type: 'clearScenery', cellX: cell(2).x, cellZ: cell(2).z }],
    [12, { type: 'callWave' }],
  ];

  function run(script: [number, BattleCommand][]): number[] {
    const sim = simFor(20_000);
    const hashes: number[] = [];
    for (let t = 0; t < 600; t++) {
      for (const [at, cmd] of script) if (at === t) sim.applyCommand(cmd);
      sim.tick();
      sim.drainEvents();
      if (t % 100 === 99) hashes.push(sim.hash());
    }
    return hashes;
  }

  it('같은 시드 + 제거 포함 커맨드열 → 해시 전 구간 일치', () => {
    expect(run(SCRIPT)).toEqual(run(SCRIPT));
  });

  it('hash()가 제거 상태를 반영한다 — 제거만 다르면 해시가 갈린다', () => {
    const a = simFor(20_000);
    const b = simFor(20_000);
    const c = cell(0);
    expect(a.hash()).toBe(b.hash());
    expect(a.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z })).toBe(true);
    // 골드까지 맞춰도(같은 금액을 b에서 직접 차감) 지형 상태 차이로 해시가 달라야 한다
    (b.state as { gold: number }).gold = a.state.gold;
    expect(a.hash()).not.toBe(b.hash());
  });

  it('어느 셀을 치웠는지가 해시에 반영된다', () => {
    const a = simFor(20_000);
    const b = simFor(20_000);
    a.applyCommand({ type: 'clearScenery', cellX: cell(0).x, cellZ: cell(0).z });
    b.applyCommand({ type: 'clearScenery', cellX: cell(1).x, cellZ: cell(1).z });
    expect(a.state.gold).toBe(b.state.gold);
    expect(a.hash()).not.toBe(b.hash());
  });
});
