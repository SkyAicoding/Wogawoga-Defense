/* 리뷰 전용 계측 — A/B. 커밋하지 않는다. */
import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import type { BattleSim, SimEvent, TowerId } from '@/data/types';
import { makeBotSimFor, runBot, STRONG_BOT, type BotOptions } from './botharness';
import { STAGES } from '@/data/stages/index';

const stageById = (id: number) => STAGES.find((s) => s.id === id)!;
const STAGE1_DECK: TowerId[] = ['spear', 'catapult', 'frost'];
const SEEDS40 = Array.from({ length: 40 }, (_, i) => 1000 + 37 * i);

interface M {
  seed: number;
  won: boolean;
  wave: number;
  goldEarned: number;
  combatGold: number;
  chunkGold: number;
  deathGold: number;
  maxGapTicks: number;
  maxGapWave: number;
  waveTicks: number;
  ticksInBigGap: number;
  gapW50: number;
  gapW20: number;
  gapW10: number;
  leaked: number;
  destroyed: number;
  minTowers: number;
  baseHpLeft: number;
  baseHpMax: number;
}

function measure(stageId: number, seed: number, opts: BotOptions, stars = 0): M {
  const stage = stageById(stageId);
  const raw = makeBotSimFor(stage, seed, STAGE1_DECK, stars);
  let tick = 0;
  const proxy = new Proxy(raw, {
    get(t, p, r) {
      if (p === 'tick') {
        return () => {
          tick++;
          t.tick();
        };
      }
      const v = Reflect.get(t, p, r);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as BattleSim;

  // 전투 수입 시각 기록: goldChanged 바로 뒤가 enemyDied/bountyChunk 인 것만
  const incomeTicks: { t: number; w: number; g: number; kind: string }[] = [];
  let pending: { t: number; d: number } | null = null;
  let chunkGold = 0;
  let deathGold = 0;
  // 웨이브 페이즈 틱 구간
  const wavePhaseTicks: { t: number; w: number }[] = [];

  const onEvent = (ev: SimEvent, wave: number): void => {
    if (pending) {
      const e = ev as { type: string };
      if (e.type === 'enemyDied' || e.type === 'bountyChunk') {
        incomeTicks.push({ t: pending.t, w: wave, g: pending.d, kind: e.type });
        if (e.type === 'bountyChunk') chunkGold += pending.d;
        else deathGold += pending.d;
      }
      pending = null;
    }
    if (ev.type === 'goldChanged' && ev.delta > 0) pending = { t: tick, d: ev.delta };
  };

  // 매 틱 phase/wave 기록을 위해 tick 프록시 안에서 push
  const proxy2 = new Proxy(raw, {
    get(t, p, r) {
      if (p === 'tick') {
        return () => {
          tick++;
          t.tick();
          if (t.state.phase === 'wave') wavePhaseTicks.push({ t: tick, w: t.state.waveIndex });
        };
      }
      const v = Reflect.get(t, p, r);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as BattleSim;
  void proxy;

  const res = runBot(proxy2, stage, { ...opts, onEvent });

  // 웨이브 페이즈 안에서의 무수입 구간 계산
  const incomeSet = new Map<number, number>();
  for (const i of incomeTicks) incomeSet.set(i.t, (incomeSet.get(i.t) ?? 0) + i.g);

  let maxGap = 0;
  let maxGapWave = 0;
  let ticksInBigGap = 0;
  const perWaveGap = new Map<number, number>();
  let run = 0;
  let runWave = 0;
  let prevTick = -99;
  for (const { t, w } of wavePhaseTicks) {
    if (t !== prevTick + 1) {
      // 페이즈 끊김 -> 구간 종료
      if (run > 0) {
        perWaveGap.set(runWave, Math.max(perWaveGap.get(runWave) ?? 0, run));
        if (run > maxGap) {
          maxGap = run;
          maxGapWave = runWave;
        }
        if (run > 300) ticksInBigGap += run;
      }
      run = 0;
    }
    prevTick = t;
    if (incomeSet.has(t)) {
      if (run > 0) {
        perWaveGap.set(runWave, Math.max(perWaveGap.get(runWave) ?? 0, run));
        if (run > maxGap) {
          maxGap = run;
          maxGapWave = runWave;
        }
        if (run > 300) ticksInBigGap += run;
      }
      run = 0;
    } else {
      run++;
      runWave = w;
    }
  }
  if (run > 0) {
    perWaveGap.set(runWave, Math.max(perWaveGap.get(runWave) ?? 0, run));
    if (run > maxGap) {
      maxGap = run;
      maxGapWave = runWave;
    }
    if (run > 300) ticksInBigGap += run;
  }

  return {
    seed,
    won: res.won,
    wave: res.wave,
    goldEarned: res.goldEarned,
    combatGold: chunkGold + deathGold,
    chunkGold,
    deathGold,
    maxGapTicks: maxGap,
    maxGapWave,
    waveTicks: wavePhaseTicks.length,
    ticksInBigGap,
    gapW50: perWaveGap.get(50) ?? 0,
    gapW20: perWaveGap.get(20) ?? 0,
    gapW10: perWaveGap.get(10) ?? 0,
    leaked: res.leaked,
    destroyed: res.destroyed,
    minTowers: res.minTowers,
    baseHpLeft: res.baseHpLeft,
    baseHpMax: res.baseHpMax,
  };
}

function report(tag: string, ms: M[]): void {
  const n = ms.length;
  const s = (f: (m: M) => number) => ms.reduce((a, m) => a + f(m), 0);
  const out = {
    tag,
    seeds: n,
    wins: ms.filter((m) => m.won).length,
    goldEarnedSum: s((m) => m.goldEarned),
    combatGoldSum: s((m) => m.combatGold),
    chunkGoldSum: s((m) => m.chunkGold),
    deathGoldSum: s((m) => m.deathGold),
    maxGapSec_avg: +(s((m) => m.maxGapTicks) / n / 30).toFixed(2),
    maxGapSec_worst: +(Math.max(...ms.map((m) => m.maxGapTicks)) / 30).toFixed(2),
    gapW10_avgSec: +(s((m) => m.gapW10) / n / 30).toFixed(2),
    gapW20_avgSec: +(s((m) => m.gapW20) / n / 30).toFixed(2),
    gapW50_avgSec: +(s((m) => m.gapW50) / n / 30).toFixed(2),
    pctTicksInGapOver10s: +((s((m) => m.ticksInBigGap) / s((m) => m.waveTicks)) * 100).toFixed(2),
    leakedSum: s((m) => m.leaked),
    destroyedSum: s((m) => m.destroyed),
    minTowersMin: Math.min(...ms.map((m) => m.minTowers)),
    slackPct: +((s((m) => (m.baseHpMax > 0 ? m.baseHpLeft / m.baseHpMax : 0)) / n) * 100).toFixed(2),
  };
  appendFileSync(process.env['AB_OUT'] ?? '/tmp/ab.jsonl', JSON.stringify(out) + '\n');
}

describe('리뷰 A/B', () => {
  it('스테이지1 기준선 봇 40시드', () => {
    report(
      's1-base',
      SEEDS40.map((sd) => measure(1, sd, {})),
    );
  }, 1_800_000);

  it('스테이지1 STRONG 40시드', () => {
    report(
      's1-strong',
      SEEDS40.map((sd) => measure(1, sd, STRONG_BOT)),
    );
  }, 1_800_000);
});
