/**
 * 스테이지 2 — 밀림 (jungle). 지그재그 단일 경로 + 첫 공중 유닛(ptera) 등장.
 * 경로: 우상단 스폰 → 좌/우로 세 번 꺾여 좌하단 화덕. 모서리 연못(~)이 배치 공간을 조인다.
 */
import type { StageDef } from '../types';
import { bossWave, g, v } from './helpers';

export const stage02: StageDef = {
  id: 2,
  nameKey: 'stage.2.name',
  biome: 'jungle',
  gridW: 11,
  gridH: 16,
  layout: [
    '~~.........',
    '~~.........',
    '..........o',
    '.....o..o..',
    '...........',
    '..o........',
    '....o......',
    '......o....',
    '...........',
    '.....o..o..',
    '...........',
    '....o......',
    '...........',
    'o........~~',
    '.........~~',
    '....#....~~',
  ],
  paths: [
    [v(9, 0), v(9, 4), v(3, 4), v(3, 8), v(7, 8), v(7, 12), v(1, 12), v(1, 14)],
  ],
  baseCell: v(1, 14),
  baseHp: 20,
  startGold: 240,
  waveCount: 50,
  wavePlan: {
    budgetBase: 24,
    budgetGrowth: 1.12,
    hpBase: 1.2,
    hpGrowth: 1.048,
    seed: 2027,
    allowedEnemies: ['raptor', 'compy', 'boar', 'trike', 'ptera', 'warrior'],
    bossOverrides: {
      10: bossWave(g('spino', 1, 0, 30, 0.75), g('warrior', 5, 25, 150)),
      20: bossWave(g('spino', 1, 0, 30, 1.05), g('ptera', 6, 20, 120), g('boar', 6, 18, 210)),
      30: bossWave(g('spino', 2, 240, 30, 1.0), g('warrior', 6, 25, 150)),
      40: bossWave(
        g('spino', 2, 240, 30, 1.3),
        g('ptera', 8, 18, 120),
        g('trike', 4, 50, 300),
      ),
      50: bossWave(g('trex', 1, 0, 30, 1.2), g('raptor', 10, 15, 240)),
    },
  },
  firstClearAmber: 160,
  perWaveAmber: 1,
  unlockTowers: ['lightning'],
};
