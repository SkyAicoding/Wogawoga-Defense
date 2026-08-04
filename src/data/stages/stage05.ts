/**
 * 스테이지 5 — 늪지 (swamp). 가장 긴 사행 경로(~36타일)지만 물(~)이 사방을 침식해
 * 슬롯 위치가 까다롭다. 전 적군 등장(골렘 제외), 40웨이브에 이른 트렉스 기습.
 */
import type { StageDef } from '../types';
import { bossWave, g, v } from './helpers';

export const stage05: StageDef = {
  id: 5,
  nameKey: 'stage.5.name',
  biome: 'swamp',
  gridW: 13,
  gridH: 17,
  layout: [
    '~~.........~~',
    '~~......~~.~~',
    '~~...o..~~.~~',
    '...........~~',
    '...o.......~~',
    '.o...........',
    '...o....o....',
    '.............',
    '.....o.......',
    '~~.........o.',
    '~~.......o...',
    '~~...........',
    '~~....o.....~',
    '~~.o........~',
    '~~..........~',
    '~~.....o....~',
    '~~....#.....~',
  ],
  paths: [
    [v(6, 0), v(6, 3), v(2, 3), v(2, 7), v(10, 7), v(10, 11), v(4, 11), v(4, 14), v(8, 14)],
  ],
  baseCell: v(8, 14),
  baseHp: 30,
  startGold: 280,
  waveCount: 50,
  wavePlan: {
    budgetBase: 39,
    budgetGrowth: 1.135,
    hpBase: 1.9,
    hpGrowth: 1.055,
    seed: 5077,
    allowedEnemies: [
      'raptor', 'compy', 'boar', 'trike', 'ptera', 'warrior', 'shaman', 'ankylo', 'mammoth',
    ],
    bossOverrides: {
      10: bossWave(g('spino', 1, 0, 30, 0.9), g('shaman', 3, 45, 120), g('boar', 8, 15, 180)),
      20: bossWave(g('spino', 1, 0, 30, 1.15), g('mammoth', 2, 90, 120), g('shaman', 3, 45, 240)),
      30: bossWave(
        g('spino', 2, 240, 30, 1.3),
        g('ankylo', 4, 50, 150),
        g('shaman', 3, 45, 300),
      ),
      40: bossWave(
        g('trex', 1, 0, 30, 1.3),
        g('mammoth', 3, 90, 240),
        g('shaman', 4, 45, 180),
        g('warrior', 8, 20, 120),
      ),
      50: bossWave(
        g('trex', 1, 0, 30, 1.3),
        g('spino', 1, 0, 420, 1.0),
        g('mammoth', 2, 90, 240),
      ),
    },
  },
  firstClearAmber: 320,
  perWaveAmber: 3,
};
