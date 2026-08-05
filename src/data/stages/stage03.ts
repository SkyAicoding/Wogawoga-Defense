/**
 * 스테이지 3 — 사막 (desert). 긴 U자 경로: 좌측 열로 내려가 하단을 돌아 우측 열로 올라온다.
 * 중앙 오아시스(~)가 양쪽 열을 동시에 커버하는 자리를 제한. 힐러(shaman)/장갑(ankylo) 등장.
 */
import type { StageDef } from '../types';
import { bossWave, g, v } from './helpers';

export const stage03: StageDef = {
  id: 3,
  nameKey: 'stage.3.name',
  biome: 'desert',
  gridW: 12,
  gridH: 16,
  layout: [
    '...........#',
    '............',
    '............',
    '.o..........',
    '...o....o...',
    '.....~~...o.',
    '.....~~.....',
    '.o..........',
    '...o....o...',
    '............',
    '..........o.',
    '............',
    '....o.o.....',
    '............',
    '#...........',
    '......#.....',
  ],
  paths: [
    [v(2, 0), v(2, 13), v(9, 13), v(9, 1)],
  ],
  baseCell: v(9, 1),
  baseHp: 25,
  startGold: 250,
  waveCount: 50,
  wavePlan: {
    budgetBase: 28,
    budgetGrowth: 1.125,
    hpBase: 1.4,
    hpGrowth: 1.05,
    seed: 3041,
    // 주술사(hexer) 합류 = **습격대 4종 완성**. '침묵 → 두들김' 콤보가 여기서 데뷔하고
    // 이후 스테이지(4~6)는 이 해금을 그대로 유지한다 (해금 사다리는 역행하지 않는다)
    allowedEnemies: [
      'raptor', 'compy', 'boar', 'trike', 'ptera', 'warrior', 'shaman', 'ankylo',
      'blade', 'lancer', 'archer', 'hexer',
    ],
    bossOverrides: {
      // w10 첫 보스 벽 완화: 전체 ×0.6 (w9 대비 총 HP ~6.8배 → ~4.1배)
      10: bossWave(
        g('spino', 1, 0, 30, 0.48),
        g('shaman', 2, 45, 120, 0.6),
        g('warrior', 4, 25, 180, 0.6),
      ),
      20: bossWave(g('spino', 1, 0, 30, 1.1), g('ankylo', 3, 55, 150), g('shaman', 2, 45, 240)),
      30: bossWave(g('spino', 2, 240, 30, 1.0), g('shaman', 3, 45, 150), g('boar', 8, 15, 120)),
      // 클라이맥스 보정: 직전 웨이브 대비 총 HP ≥1.15×
      40: bossWave(
        g('spino', 2, 240, 30, 1.63),
        g('ankylo', 4, 50, 150, 1.25),
        g('shaman', 3, 45, 330, 1.25),
      ),
      50: bossWave(
        g('trex', 1, 0, 30, 1.5),
        g('shaman', 3, 45, 240, 1.15),
        g('warrior', 6, 22, 150, 1.15),
      ),
    },
  },
  firstClearAmber: 200,
  perWaveAmber: 2,
  unlockTowers: ['ballista'],
};
