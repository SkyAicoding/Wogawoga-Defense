/**
 * 스테이지 1 — 초원 (grassland). 초심자용: 단일 S자 경로(길이 ~37타일)로 화력 집중이 쉽다.
 * 경로: 좌상단 스폰 → 좌우로 세 번 접히며 하강 → 우하단 화덕.
 */
import type { StageDef } from '../types';
import { bossWave, g, v } from './helpers';

export const stage01: StageDef = {
  id: 1,
  nameKey: 'stage.1.name',
  biome: 'grassland',
  gridW: 11,
  gridH: 15,
  // '.' 지상  'o' 슬롯  '#' 장식 (경로 셀은 paths에서 래스터라이즈)
  layout: [
    '..........#',
    '...........',
    'o.o........',
    '...........',
    '...o..o....',
    '........o..',
    '.....o.....',
    '...........',
    '.....o.....',
    'o..........',
    '.....o.....',
    '...........',
    '........o..',
    '...........',
    '#.........#',
  ],
  paths: [
    [v(1, 0), v(1, 3), v(9, 3), v(9, 7), v(1, 7), v(1, 11), v(9, 11), v(9, 13)],
  ],
  baseCell: v(9, 13),
  baseHp: 25,
  startGold: 300,
  waveCount: 50,
  wavePlan: {
    budgetBase: 20,
    budgetGrowth: 1.1,
    hpBase: 1.0,
    hpGrowth: 1.022,
    seed: 1013,
    allowedEnemies: ['raptor', 'compy', 'boar', 'trike'],
    bossOverrides: {
      10: bossWave(g('spino', 1, 0, 30, 0.6), g('raptor', 6, 20, 150)),
      20: bossWave(g('spino', 1, 0, 30, 0.85), g('trike', 3, 60, 180), g('boar', 6, 18, 90)),
      30: bossWave(g('spino', 1, 0, 30, 1.1), g('trike', 3, 50, 150), g('boar', 6, 16, 240)),
      40: bossWave(
        g('spino', 2, 240, 30, 1.2),
        g('boar', 8, 15, 120),
        g('raptor', 8, 12, 330),
      ),
      50: bossWave(g('trex', 1, 0, 30, 1.15), g('raptor', 16, 13, 210)),
    },
  },
  firstClearAmber: 120,
  perWaveAmber: 1,
  unlockTowers: ['lightning'],
};
