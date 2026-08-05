/**
 * 스테이지 6 — 화산 (volcano). 최종장: 좌우 대칭 이중 경로가 z10에서 합류, 용암(~)이
 * 중앙 상단과 하단 코너를 차지. 화산 골렘(고장갑) 등장 — 독/체인 없이는 뚫기 어렵다.
 * 별 업그레이드 없이는 어려운 난이도 (hpBase 2.2, budgetBase 45).
 */
import type { StageDef } from '../types';
import { bossWave, g, v } from './helpers';

export const stage06: StageDef = {
  id: 6,
  nameKey: 'stage.6.name',
  biome: 'volcano',
  gridW: 13,
  gridH: 17,
  layout: [
    '.....~~~.....',
    '.o...~~~.o...',
    '.....~~~.....',
    '...o.~~~.....',
    '.............',
    '.o...o.o...o.',
    '.............',
    '.............',
    '#...........#',
    '...o.....o...',
    '.............',
    '.....o.o.....',
    '~...........~',
    '~......o....~',
    '~~.........~~',
    '~~.........~~',
    '~~....#....~~',
  ],
  paths: [
    [v(0, 2), v(4, 2), v(4, 6), v(2, 6), v(2, 10), v(6, 10), v(6, 15)],
    [v(12, 2), v(8, 2), v(8, 6), v(10, 6), v(10, 10), v(6, 10), v(6, 15)],
  ],
  baseCell: v(6, 15),
  baseHp: 30,
  startGold: 300,
  waveCount: 50,
  wavePlan: {
    budgetBase: 45,
    budgetGrowth: 1.14,
    hpBase: 2.2,
    hpGrowth: 1.06,
    seed: 6091,
    allowedEnemies: [
      'raptor', 'compy', 'boar', 'trike', 'ptera', 'warrior', 'shaman', 'ankylo', 'mammoth', 'golem',
      'blade', 'lancer', 'archer', 'hexer',
    ],
    bossOverrides: {
      10: bossWave(
        g('spino', 1, 0, 30, 1.0, 0),
        g('golem', 2, 90, 120, 1, 1),
        g('shaman', 3, 45, 180, 1, 0),
      ),
      20: bossWave(
        g('spino', 1, 0, 30, 1.0, 0),
        g('spino', 1, 0, 90, 1.0, 1),
        g('golem', 3, 75, 150, 1, 0),
        g('ptera', 8, 18, 210, 1, 1),
      ),
      // 클라이맥스 보정: 직전 웨이브 대비 총 HP ≥1.15×
      30: bossWave(
        g('trex', 1, 0, 30, 1.32, 0),
        g('golem', 5, 70, 150, 1.2, 1),
        g('shaman', 4, 45, 240, 1.2, 0),
      ),
      40: bossWave(
        g('trex', 1, 0, 30, 1.68, 1),
        g('spino', 1, 0, 300, 1.2, 0),
        g('mammoth', 4, 90, 150, 1.2, 0),
      ),
      50: bossWave(
        g('trex', 2, 420, 30, 1.1, 0),
        g('spino', 1, 0, 240, 1.0, 1),
        g('golem', 4, 70, 360, 1, 1),
        g('shaman', 4, 45, 480, 1, 0),
      ),
    },
  },
  firstClearAmber: 400,
  perWaveAmber: 3,
};
