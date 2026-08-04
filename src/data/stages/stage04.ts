/**
 * 스테이지 4 — 설원 (snow). 첫 이중 갈래: 좌/우 스폰이 중앙 z7에서 합류해 하단 화덕으로.
 * 합류점 이후 공용 구간이 핵심 방어선. 매머드 등장, 얼어붙은 호수(~)가 하단 배치를 제한.
 */
import type { StageDef } from '../types';
import { bossWave, g, v } from './helpers';

export const stage04: StageDef = {
  id: 4,
  nameKey: 'stage.4.name',
  biome: 'snow',
  gridW: 12,
  gridH: 16,
  layout: [
    '............',
    '............',
    '.o.......o..',
    '....o.......',
    '.......o....',
    '..o.........',
    '.........o..',
    '............',
    '....o.......',
    '......o.....',
    '............',
    '....o.....~~',
    '~~....o...~~',
    '~~........~~',
    '~~........~~',
    '~~..#.....~~',
  ],
  paths: [
    [v(0, 1), v(3, 1), v(3, 7), v(5, 7), v(5, 14)],
    [v(11, 1), v(8, 1), v(8, 7), v(5, 7), v(5, 14)],
  ],
  baseCell: v(5, 14),
  baseHp: 25,
  startGold: 260,
  waveCount: 50,
  wavePlan: {
    budgetBase: 33,
    budgetGrowth: 1.13,
    hpBase: 1.65,
    hpGrowth: 1.052,
    seed: 4057,
    allowedEnemies: [
      'raptor', 'compy', 'boar', 'trike', 'ptera', 'warrior', 'shaman', 'ankylo', 'mammoth',
    ],
    bossOverrides: {
      // w10 첫 보스 벽 완화: 전체 ×0.6 (w9 대비 총 HP ~6.9배 → ~4.2배)
      10: bossWave(
        g('spino', 1, 0, 30, 0.51, 0),
        g('mammoth', 1, 0, 90, 0.6, 1),
        g('warrior', 5, 25, 150, 0.6, 0),
      ),
      20: bossWave(
        g('spino', 1, 0, 30, 1.1, 1),
        g('mammoth', 2, 90, 120, 1, 0),
        g('ptera', 6, 20, 180, 1, 0),
      ),
      30: bossWave(
        g('spino', 1, 0, 30, 1.05, 0),
        g('spino', 1, 0, 90, 1.05, 1),
        g('shaman', 3, 45, 150, 1, 0),
        g('trike', 5, 45, 210, 1, 1),
      ),
      // 클라이맥스 보정: 직전 웨이브 대비 총 HP ≥1.15×
      40: bossWave(
        g('spino', 2, 240, 30, 2.0, 0),
        g('mammoth', 3, 90, 150, 1.25, 1),
        g('shaman', 3, 45, 300, 1.25, 0),
      ),
      50: bossWave(
        g('trex', 1, 0, 30, 1.62, 0),
        g('spino', 1, 0, 420, 1.32, 1),
        g('ptera', 8, 18, 240, 1.2, 0),
      ),
    },
  },
  firstClearAmber: 250,
  perWaveAmber: 2,
};
