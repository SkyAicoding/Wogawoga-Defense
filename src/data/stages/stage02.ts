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
    // 습격대 데뷔 2단계 — 창잡이(lancer) 합류. 사거리 1.95라 칼잡이(1.5)가 못 닿던
    // 자리까지 찌른다. 경로 이격이 '한 칸으로는 부족하다'를 배우는 스테이지.
    allowedEnemies: [
      'raptor', 'compy', 'boar', 'trike', 'ptera', 'warrior', 'blade', 'archer', 'lancer',
    ],
    bossOverrides: {
      // w10 첫 보스 벽 완화: 전체 ×0.55 (w9 대비 총 HP ~7.3배 → ~4.0배)
      10: bossWave(g('spino', 1, 0, 30, 0.41), g('warrior', 5, 25, 150, 0.55)),
      20: bossWave(g('spino', 1, 0, 30, 1.05), g('ptera', 6, 20, 120), g('boar', 6, 18, 210)),
      30: bossWave(g('spino', 2, 240, 30, 1.0), g('warrior', 6, 25, 150)),
      // 습격대 종을 hp/cost 기준에서 뺀 뒤(wavegen.refHpPerCost) 일반 웨이브 총 HP가
      // 올라가 w40 보스가 w39에 1.10배 미달(1.098)이 됐다 — 클라이맥스 복원용 상향.
      40: bossWave(
        g('spino', 2, 240, 30, 1.42),
        g('ptera', 8, 18, 120, 1.1),
        g('trike', 4, 50, 300, 1.1),
      ),
      // 클라이맥스 보정: w49 대비 총 HP ≥1.15× (w40과 같은 이유로 재상향)
      50: bossWave(g('trex', 1, 0, 30, 1.5), g('raptor', 10, 15, 240, 1.25)),
    },
  },
  firstClearAmber: 160,
  perWaveAmber: 1,
  unlockTowers: ['poison'],
};
