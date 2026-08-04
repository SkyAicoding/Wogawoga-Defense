/**
 * 웨이브젠 검증 — 결정론, 유효성, 난이도 단조 증가.
 * 총 HP 곡선: 보스 웨이브(10배수)는 스파이크라 제외하고 3웨이브 이동평균이 단조 증가해야 한다.
 */
import { describe, expect, it } from 'vitest';
import type { EnemyId, WaveDef } from '@/data/types';
import { WAVE_GOLD_BASE, WAVE_GOLD_PER_WAVE, WAVE_MAX_SPAWNS } from '@/data/balance';
import { ENEMY_DEFS } from '@/data/enemies';
import { STAGES } from '@/data/stages';
import { makeWaveFor } from '@/data/wavegen';

const BOSS_IDS: EnemyId[] = ['spino', 'trex'];

function totalHp(def: WaveDef): number {
  let sum = 0;
  for (const g of def.groups) sum += ENEMY_DEFS[g.enemyId].hp * g.hpMul * g.count;
  return sum;
}

function totalSpawns(def: WaveDef): number {
  let sum = 0;
  for (const g of def.groups) sum += g.count;
  return sum;
}

describe('wavegen', () => {
  for (const stage of STAGES) {
    describe(`stage ${stage.id}`, () => {
      const waveFor = makeWaveFor(stage);
      const airLanes = stage.airPaths?.length ?? stage.paths.length;
      const allowedSet = new Set<EnemyId>([...stage.wavePlan.allowedEnemies, ...BOSS_IDS]);

      it('웨이브 1~50 전부 생성 가능하고 유효', () => {
        for (let wave = 1; wave <= 50; wave++) {
          const def = waveFor(wave);
          expect(def.groups.length, `w${wave} 그룹 없음`).toBeGreaterThan(0);
          expect(def.goldReward).toBe(WAVE_GOLD_BASE + wave * WAVE_GOLD_PER_WAVE);
          for (const g of def.groups) {
            expect(allowedSet.has(g.enemyId), `w${wave} 미허용 적 ${g.enemyId}`).toBe(true);
            expect(g.count).toBeGreaterThanOrEqual(1);
            expect(g.intervalTicks).toBeGreaterThanOrEqual(0);
            expect(g.delayTicks).toBeGreaterThanOrEqual(0);
            expect(g.hpMul).toBeGreaterThan(0);
            const lanes = ENEMY_DEFS[g.enemyId].flying ? airLanes : stage.paths.length;
            expect(g.pathIndex).toBeGreaterThanOrEqual(0);
            expect(g.pathIndex, `w${wave} pathIndex`).toBeLessThan(lanes);
          }
          if (wave % 10 !== 0) {
            expect(totalSpawns(def), `w${wave} 스폰 수 캡`).toBeLessThanOrEqual(WAVE_MAX_SPAWNS);
          }
        }
      });

      it('결정론: 같은 인자 → deepEqual (호출 순서 무관)', () => {
        const again = makeWaveFor(stage);
        // 역순 호출로도 동일해야 한다 (웨이브별 fresh Rng)
        const reversed = new Map<number, WaveDef>();
        for (let wave = 50; wave >= 1; wave--) reversed.set(wave, again(wave));
        for (let wave = 1; wave <= 50; wave++) {
          const a = waveFor(wave);
          const b = waveFor(wave);
          expect(a, `w${wave} 재호출`).toEqual(b);
          expect(reversed.get(wave), `w${wave} 역순 호출`).toEqual(a);
        }
      });

      it('보스 웨이브(10/20/30/40/50)에 boss 포함', () => {
        for (const wave of [10, 20, 30, 40, 50]) {
          const def = waveFor(wave);
          const hasBoss = def.groups.some((g) => ENEMY_DEFS[g.enemyId].boss);
          expect(hasBoss, `w${wave}`).toBe(true);
        }
      });

      it('보스 웨이브가 직전 웨이브보다 약하지 않음 (클라이맥스 보장)', () => {
        for (const wave of [10, 20, 30, 40, 50]) {
          const ratio = totalHp(waveFor(wave)) / totalHp(waveFor(wave - 1));
          expect(ratio, `w${wave} 보스/직전 HP비`).toBeGreaterThan(0.95);
        }
      });

      it('총 HP가 웨이브 단조 증가 (보스 웨이브 제외, 3웨이브 이동평균)', () => {
        const series: number[] = [];
        for (let wave = 1; wave <= 50; wave++) {
          if (wave % 10 === 0) continue;
          series.push(totalHp(waveFor(wave)));
        }
        for (let i = 0; i + 3 < series.length; i++) {
          const a = (series[i]! + series[i + 1]! + series[i + 2]!) / 3;
          const b = (series[i + 1]! + series[i + 2]! + series[i + 3]!) / 3;
          expect(b, `이동평균 ${i}`).toBeGreaterThan(a);
        }
      });

      it('endless: 50 초과 웨이브도 생성되고 10배수에 보스 자동 주입', () => {
        for (let wave = 51; wave <= 62; wave++) {
          const def = waveFor(wave);
          expect(def.groups.length).toBeGreaterThan(0);
          for (const g of def.groups) expect(allowedSet.has(g.enemyId)).toBe(true);
        }
        const w60 = waveFor(60);
        expect(w60.groups.some((g) => ENEMY_DEFS[g.enemyId].boss)).toBe(true);
        const w100 = waveFor(100);
        expect(w100.groups.some((g) => g.enemyId === 'trex')).toBe(true);
      });
    });
  }

  it('보스 오버라이드에도 웨이브 hpMul이 적용된다', () => {
    const stage = STAGES[0]!;
    const waveFor = makeWaveFor(stage);
    const plan = stage.wavePlan;
    const w10 = waveFor(10);
    const relative = plan.bossOverrides[10]!.groups[0]!.hpMul;
    const waveMul = plan.hpBase * plan.hpGrowth ** 9;
    const spino = w10.groups.find((g) => g.enemyId === 'spino')!;
    expect(spino.hpMul).toBeCloseTo(relative * waveMul, 2);
  });
});
