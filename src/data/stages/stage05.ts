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
    // 습격대 4종(스테이지3 완성) 유지 — 여기서는 매머드·힐러와 겹쳐 밀도가 올라간다
    allowedEnemies: [
      'raptor', 'compy', 'boar', 'trike', 'ptera', 'warrior', 'shaman', 'ankylo', 'mammoth',
      'blade', 'lancer', 'archer', 'hexer',
    ],
    bossOverrides: {
      // w10 첫 보스 벽 완화: 전체 ×0.65 (w9 대비 총 HP ~5.9배 → ~3.8배)
      10: bossWave(
        g('spino', 1, 0, 30, 0.59),
        g('shaman', 3, 45, 120, 0.65),
        g('boar', 8, 15, 180, 0.65),
      ),
      20: bossWave(g('spino', 1, 0, 30, 1.15), g('mammoth', 2, 90, 120), g('shaman', 3, 45, 240)),
      // 클라이맥스 보정: 직전 웨이브 대비 총 HP ≥1.15×
      30: bossWave(
        g('spino', 2, 240, 30, 1.56),
        g('ankylo', 4, 50, 150, 1.2),
        g('shaman', 3, 45, 300, 1.2),
      ),
      40: bossWave(
        g('trex', 1, 0, 30, 1.56),
        g('mammoth', 3, 90, 240, 1.2),
        g('shaman', 4, 45, 180, 1.2),
        g('warrior', 8, 20, 120, 1.2),
      ),
      50: bossWave(
        g('trex', 1, 0, 30, 1.5),
        g('spino', 1, 0, 420, 1.15),
        g('mammoth', 2, 90, 240, 1.15),
      ),
    },
  },
  firstClearAmber: 320,
  perWaveAmber: 3,
};
