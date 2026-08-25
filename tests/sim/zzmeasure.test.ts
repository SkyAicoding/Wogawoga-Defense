/** 임시 계측 — §A 재유도용. 끝나면 지운다. */
import { describe, it } from 'vitest';
import { ALLY_MAX_ACTIVE, ALLY_BLOCK_CAPACITY } from '@/data/balance';
import { BASE_LEVELS } from '@/data';
import type { BaseLevelDef } from '@/data/types';
import { play, seedsOf, FULL, FAST, type Profile, type BotResult } from './envelope';
import type { BotOptions } from './botharness';

const ALLY_OPTS: BotOptions = { towerReserve: 600, allies: { minNear: 1 } };
const DECK = ['spear', 'catapult', 'frost'] as const;
const sum = (rs: BotResult[], f: (r: BotResult) => number): number => rs.reduce((a, r) => a + f(r), 0);
const W = (s: string): void => { process.stderr.write(s + '\n'); };

function arm(cap: number, prof: Profile): BotResult[] {
  const only: readonly BaseLevelDef[] = [{ ...BASE_LEVELS[0]!, cost: 0, allyCap: cap }];
  return play({
    stageId: 1, deck: [...DECK], seeds: seedsOf('cap', prof), opts: ALLY_OPTS,
    tables: { id: `cap${cap}`, baseLevels: only },
  });
}

describe('zz 계측', () => {
  it('11b', () => {
    const prof = process.env.ZZ_PROF === 'fast' ? FAST : FULL;
    const few = arm(2, prof);
    const many = arm(ALLY_MAX_ACTIVE, prof);
    const t = (rs: BotResult[]): number => sum(rs, (r) => r.alliesTrained);
    const b = (rs: BotResult[]): number => sum(rs, (r) => r.allyBlockTicks);
    const at = (rs: BotResult[]): number => sum(rs, (r) => r.allyTicks);
    const eb = (rs: BotResult[]): number => sum(rs, (r) => r.enemyBlockedTicks);
    const gt = (rs: BotResult[]): number => sum(rs, (r) => r.gateTicks);
    const tt = (rs: BotResult[]): number => sum(rs, (r) => r.totalTicks);
    W(`[BLOCK_CAP=${ALLY_BLOCK_CAPACITY}] 판수 ${few.length} (${prof.name})`);
    W(`  정원2: trained ${t(few)} block ${b(few)} allyTicks ${at(few)} 가동률 ${((b(few) / at(few)) * 100).toFixed(2)}% 승 ${few.filter((r) => r.won).length}`);
    W(`  정원6: trained ${t(many)} block ${b(many)} allyTicks ${at(many)} 가동률 ${((b(many) / at(many)) * 100).toFixed(2)}% 승 ${many.filter((r) => r.won).length}`);
    W(`  적봉쇄틱 ${eb(few)} → ${eb(many)} (비 ${(eb(many) / eb(few)).toFixed(3)}) · 평균 문앞 인원 ${(gt(few) / tt(few)).toFixed(2)} → ${(gt(many) / tt(many)).toFixed(2)}`);
    W(`  평균 동시 아군 ${(at(few) / tt(few)).toFixed(2)} → ${(at(many) / tt(many)).toFixed(2)} · 평균 교전 아군 ${(b(few) / tt(few)).toFixed(3)} → ${(b(many) / tt(many)).toFixed(3)}`);
    W(`>>> 생산비 ${(t(many) / t(few)).toFixed(4)} (>1.10) · 봉쇄비 ${(b(many) / b(few)).toFixed(4)} (>1.25)`);
  }, 1_800_000);
});
