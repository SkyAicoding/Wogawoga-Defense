/**
 * 웨이브젠 검증 — 결정론, 유효성, 난이도 단조 증가.
 * 총 HP 곡선: 보스 웨이브(10배수)는 스파이크라 제외하고 3웨이브 이동평균이 단조 증가해야 한다.
 */
import { describe, expect, it } from 'vitest';
import type { EnemyId, WaveDef } from '@/data/types';
import { WAVE_GOLD_BASE, WAVE_GOLD_PER_WAVE, WAVE_MAX_SPAWNS } from '@/data/balance';
import { BOUNTY_PER_COST, ENEMY_DEFS } from '@/data/enemies';
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

      it('보스 웨이브가 직전 웨이브보다 확실히 강함 (클라이맥스 보장, 앤티클라이맥스 방지)', () => {
        for (const wave of [10, 20, 30, 40, 50]) {
          const ratio = totalHp(waveFor(wave)) / totalHp(waveFor(wave - 1));
          expect(ratio, `w${wave} 보스/직전 HP비`).toBeGreaterThan(1.1);
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

  /**
   * 습격대 편성 — "무리지어 몰려온다"가 데이터로 보장되는지.
   * 간격 5~9틱은 raid 템플릿 전위 전용 값이라(mixed 10~26, elite 30~50)
   * 이 조건을 만족하는 그룹이 있으면 raid 편성이 실제로 나왔다는 뜻이다.
   */
  describe('부족 습격대 편성', () => {
    const RAIDERS: EnemyId[] = ['blade', 'lancer', 'archer', 'hexer'];
    for (const stage of STAGES) {
      const allowed = stage.wavePlan.allowedEnemies;
      if (!allowed.includes('blade')) continue;
      it(`stage ${stage.id}: 습격대가 무리로 몰려나오는 웨이브가 있다`, () => {
        const waveFor = makeWaveFor(stage);
        let packs = 0;
        let firstRaidWave = Infinity;
        for (let wave = 1; wave <= 50; wave++) {
          for (const g of waveFor(wave).groups) {
            if (!RAIDERS.includes(g.enemyId)) continue;
            if (g.intervalTicks <= 9 && g.count >= 3) {
              packs++;
              firstRaidWave = Math.min(firstRaidWave, wave);
            }
          }
        }
        expect(packs, '촘촘한 습격대 무리').toBeGreaterThan(0);
        // 초반 웨이브에는 나오지 않는다 (타워 한두 기뿐일 때 나오면 그냥 학살이다)
        expect(firstRaidWave).toBeGreaterThanOrEqual(8);
      });

      /**
       * raid 템플릿이 나왔다면 **예외 없이** 무리여야 한다.
       * 예산이 작은 초반 웨이브에서 count 가 1로 떨어지면 "낙오병 1명"이 되어
       * 습격대의 정체성이 죽는다 — RAID_MIN_FRONT/BACK 이 이걸 막는다.
       *
       * 판별: 간격 ≤9틱 + 습격대 종 = raid 편성 (mixed 10~26, elite 30~50,
       * swarm 6~12 은 풀에 습격대가 없다). 전위/후위는 종으로 갈린다 —
       * blade·lancer 는 RAID_FRONT 에만, archer·hexer 는 RAID_BACK 에만 들어 있다.
       */
      it(`stage ${stage.id}: raid 편성의 모든 무리가 최소 인원을 채운다`, () => {
        const waveFor = makeWaveFor(stage);
        let seen = 0;
        for (let wave = 1; wave <= 60; wave++) {
          for (const g of waveFor(wave).groups) {
            if (!RAIDERS.includes(g.enemyId) || g.intervalTicks > 9) continue;
            const front = g.enemyId === 'blade' || g.enemyId === 'lancer';
            seen++;
            expect(g.count, `w${wave} ${g.enemyId} ${front ? '전위' : '후위'} 인원`)
              .toBeGreaterThanOrEqual(front ? 3 : 2);
          }
        }
        expect(seen, 'raid 무리 표본').toBeGreaterThan(0);
      });
    }

    it('후위(궁수/주술사)는 전위보다 늦게 출발한다', () => {
      const stage = STAGES.find((s) => s.wavePlan.allowedEnemies.includes('hexer'));
      expect(stage, '주술사가 있는 스테이지').toBeTruthy();
      const waveFor = makeWaveFor(stage!);
      let checked = 0;
      for (let wave = 6; wave <= 50; wave++) {
        const groups = waveFor(wave).groups;
        const front = groups.filter((g) => g.enemyId === 'blade' || g.enemyId === 'lancer');
        const back = groups.filter((g) => g.enemyId === 'archer' || g.enemyId === 'hexer');
        if (front.length !== 2 || back.length !== 1) continue; // raid 템플릿의 형태
        if (front.some((g) => g.intervalTicks > 9)) continue;
        checked++;
        const lead = Math.max(...front.map((g) => g.delayTicks));
        expect(back[0]!.delayTicks, `w${wave} 후위 지연`).toBeGreaterThan(lead);
      }
      expect(checked, 'raid 편성 표본').toBeGreaterThan(0);
    });
  });

  /**
   * **웨이브 보상은 예산이 산 것을 넘지 않는다** (wavegen.capBounty).
   *
   * 이 불변식이 깨졌을 때 무슨 일이 났는지: 습격대 최소 인원 보장(RAID_MIN_*)이
   * 예산보다 많은 마릿수를 뽑으면 총 HP는 normalize()가 곡선으로 되돌리는데
   * 보상만 마릿수에 비례해 부풀었다. 스테이지1 w12는 습격대 유/무의 총 HP가 503으로
   * 같은데 보상이 138 대 16(8.6배)이었고, w1~50 총계로 총 HP +1.3%에 총수입 +18.7%.
   * 결과적으로 **습격대를 넣으면 게임이 쉬워졌다**(봇 24시드 17승 대 15승).
   */
  describe('보상 상한 — 웨이브 수입이 예산 곡선을 넘지 않는다', () => {
    for (const stage of STAGES) {
      it(`stage ${stage.id}: 전 웨이브에서 처치 보상 합 <= 예산 × ${BOUNTY_PER_COST}`, () => {
        const plan = stage.wavePlan;
        const waveFor = makeWaveFor(stage);
        const maxSpend =
          WAVE_MAX_SPAWNS *
          (plan.allowedEnemies.reduce((a, id) => a + ENEMY_DEFS[id].cost, 0) /
            plan.allowedEnemies.length);
        for (let wave = 1; wave <= 50; wave++) {
          if (plan.bossOverrides[wave]) continue; // 보스 보상은 수동 설계다
          const budget = Math.min(plan.budgetBase * plan.budgetGrowth ** (wave - 1), maxSpend);
          const def = waveFor(wave);
          let bounty = 0;
          for (const g of def.groups) {
            bounty += Math.max(1, Math.round(ENEMY_DEFS[g.enemyId].bounty * (g.bountyMul ?? 1))) * g.count;
          }
          // 정수 반올림(개체당 최대 +0.5)만큼의 여유를 준다
          const slack = totalSpawns(def) * 0.5;
          expect(bounty, `w${wave} 보상 ${bounty} / 예산 ${budget.toFixed(1)}`)
            .toBeLessThanOrEqual(budget * BOUNTY_PER_COST + slack);
        }
      });
    }

    it('상한이 실제로 물리는 웨이브가 있다 (검증이 공허하지 않다)', () => {
      let capped = 0;
      for (const stage of STAGES) {
        const waveFor = makeWaveFor(stage);
        for (let wave = 1; wave <= 50; wave++) {
          if (waveFor(wave).groups.some((g) => g.bountyMul !== undefined && g.bountyMul < 1)) capped++;
        }
      }
      expect(capped, '보상 상한이 걸린 웨이브 수').toBeGreaterThan(0);
    });

    it('상한이 안 걸린 웨이브는 bountyMul을 붙이지 않는다 (기존 편성 무변화)', () => {
      const stage = STAGES[0]!;
      const waveFor = makeWaveFor(stage);
      // w1~7 은 swarm/mixed 뿐이라(raid 는 w8부터) 상한이 물릴 수 없다
      for (let wave = 1; wave <= 7; wave++) {
        for (const g of waveFor(wave).groups) {
          expect(g.bountyMul, `w${wave} ${g.enemyId}`).toBeUndefined();
        }
      }
    });
  });

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
