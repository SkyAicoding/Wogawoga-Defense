/** 자유 배치 규칙 — 지상 OK, 경로/물/장식/소품/중복 거부 (render와 동일 판정) */
import { describe, expect, it } from 'vitest';
import { createBattle } from '@/sim/battle';
import { ALLY_DEFS, BASE_LEVELS, ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import { cellKey, charAt, rasterizePathCells, sceneryCells } from '@/data/grid';
import type { StageDef } from '@/data/types';

function simFor(stage: StageDef) {
  return createBattle({
    stage,
    stars: {},
    deck: ['spear'],
    endless: false,
    seed: 1,
    towerDefs: TOWER_DEFS,
    enemyDefs: ENEMY_DEFS,
    allyDefs: ALLY_DEFS,
    baseLevels: BASE_LEVELS,
    waveFor: makeWaveFor(stage),
  });
}

describe('자유 배치 판정', () => {
  const stage = stageById(1) as StageDef;
  const path = rasterizePathCells(stage);
  const scenery = sceneryCells(stage, path);

  it('소품(나무/바위) 셀은 건설 불가', () => {
    const sim = simFor(stage);
    expect(scenery.size).toBeGreaterThan(0);
    for (const key of scenery) {
      const x = key % stage.gridW;
      const z = Math.floor(key / stage.gridW);
      expect(sim.canPlaceAt(x, z), `소품 셀 (${x},${z})`).toBe(false);
    }
  });

  it('경로 셀은 건설 불가, 소품 없는 지상 셀은 가능', () => {
    const sim = simFor(stage);
    let groundOk = 0;
    for (let z = 0; z < stage.gridH; z++) {
      for (let x = 0; x < stage.gridW; x++) {
        const key = cellKey(stage, x, z);
        const ch = charAt(stage, x, z);
        if (path.has(key)) {
          expect(sim.canPlaceAt(x, z), `경로 셀 (${x},${z})`).toBe(false);
        } else if ((ch === '.' || ch === 'o') && !scenery.has(key)) {
          expect(sim.canPlaceAt(x, z), `지상 셀 (${x},${z})`).toBe(true);
          groundOk++;
        } else if (ch === '~' || ch === '#') {
          expect(sim.canPlaceAt(x, z), `불가 셀 (${x},${z})`).toBe(false);
        }
      }
    }
    // 자유 배치가 실제로 넉넉한 공간을 주는지
    expect(groundOk).toBeGreaterThanOrEqual(30);
  });

  it('배치 후 같은 셀은 불가', () => {
    const sim = simFor(stage);
    let cell: { x: number; z: number } | null = null;
    outer: for (let z = 0; z < stage.gridH; z++) {
      for (let x = 0; x < stage.gridW; x++) {
        if (sim.canPlaceAt(x, z)) {
          cell = { x, z };
          break outer;
        }
      }
    }
    expect(cell).not.toBeNull();
    if (!cell) return;
    expect(
      sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: cell.x, cellZ: cell.z }),
    ).toBe(true);
    expect(sim.canPlaceAt(cell.x, cell.z)).toBe(false);
  });
});
