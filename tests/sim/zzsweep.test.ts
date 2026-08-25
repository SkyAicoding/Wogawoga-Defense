/** 임시 스윕 — §A 재유도용. 끝나면 지운다. */
import { describe, it } from 'vitest';
import { ALLY_MAX_ACTIVE, ALLY_BLOCK_CAPACITY } from '@/data/balance';
import { BASE_LEVELS } from '@/data';
import type { AllyDef, AllyId, BaseLevelDef } from '@/data/types';
import { play, seedsOf, FULL, FAST, type DataPatch, type Profile, type BotResult } from './envelope';
import type { BotOptions } from './botharness';

const ALLY_OPTS: BotOptions = { towerReserve: 600, allies: { minNear: 1 } };
const DECK = ['spear', 'catapult', 'frost'] as const;
const sum = (rs: BotResult[], f: (r: BotResult) => number): number => rs.reduce((a, r) => a + f(r), 0);
const W = (s: string): void => { process.stderr.write(s + '\n'); };

function arm(cap: number, prof: Profile, patch: DataPatch): BotResult[] {
  const only: readonly BaseLevelDef[] = [{ ...BASE_LEVELS[0]!, cost: 0, allyCap: cap }];
  return play({
    stageId: 1, deck: [...DECK], seeds: seedsOf('cap', prof), opts: ALLY_OPTS,
    tables: { id: `cap${cap}`, baseLevels: only }, patch,
  });
}

/** 사거리/비용 손잡이만 돌리는 패치 */
function tune(id: string, o: { rng?: Partial<Record<AllyId, number>>; cost?: Partial<Record<AllyId, number>>; hp?: Partial<Record<AllyId, number>> }): DataPatch {
  return {
    id,
    allies: (t) => {
      const out = { ...t } as Record<AllyId, AllyDef>;
      for (const k of Object.keys(out) as AllyId[]) {
        const d = out[k];
        out[k] = {
          ...d,
          ...(o.rng?.[k] !== undefined ? { range: o.rng[k]! } : {}),
          ...(o.cost?.[k] !== undefined ? { cost: o.cost[k]! } : {}),
          ...(o.hp?.[k] !== undefined ? { hp: o.hp[k]! } : {}),
        };
      }
      return out;
    },
  };
}

const CONFIGS: Record<string, DataPatch> = {
  base: { id: 'BASE' },
  r15: tune('r15', { rng: { clubber: 1.5, guardian: 1.7 } }),
  r20: tune('r20', { rng: { clubber: 2.0, guardian: 2.3 } }),
  r28: tune('r28', { rng: { clubber: 2.8, guardian: 3.2 } }),
  r40: tune('r40', { rng: { clubber: 4.0, guardian: 4.6 } }),
  r20c: tune('r20c', { rng: { clubber: 2.0, guardian: 2.3 }, cost: { clubber: 60, guardian: 110, slinger: 75 } }),
};

describe('zz 스윕', () => {
  const names = (process.env.ZZ_CFG ?? 'base').split(',');
  for (const name of names) {
    it(`11b ${name}`, () => {
      const prof = process.env.ZZ_PROF === 'fast' ? FAST : FULL;
      const patch = CONFIGS[name];
      if (!patch) throw new Error(`no config ${name}`);
      const few = arm(2, prof, patch);
      const many = arm(ALLY_MAX_ACTIVE, prof, patch);
      const t = (rs: BotResult[]): number => sum(rs, (r) => r.alliesTrained);
      const b = (rs: BotResult[]): number => sum(rs, (r) => r.allyBlockTicks);
      const at = (rs: BotResult[]): number => sum(rs, (r) => r.allyTicks);
      const eb = (rs: BotResult[]): number => sum(rs, (r) => r.enemyBlockedTicks);
      const tt = (rs: BotResult[]): number => sum(rs, (r) => r.totalTicks);
      W(`[${name} · BLOCK_CAP=${ALLY_BLOCK_CAPACITY} · ${prof.name} ${few.length}판]`);
      W(`  정원2 trained ${t(few)} block ${b(few)} 가동률 ${((b(few) / at(few)) * 100).toFixed(2)}% 승 ${few.filter((r) => r.won).length} | 정원6 trained ${t(many)} block ${b(many)} 가동률 ${((b(many) / at(many)) * 100).toFixed(2)}% 승 ${many.filter((r) => r.won).length}`);
      W(`  적봉쇄틱 ${eb(few)} → ${eb(many)} · 평균 교전 아군 ${(b(few) / tt(few)).toFixed(4)} → ${(b(many) / tt(many)).toFixed(4)}`);
      W(`>>> ${name}: 생산비 ${(t(many) / t(few)).toFixed(4)} (>1.10) · 봉쇄비 ${(b(many) / b(few)).toFixed(4)} (>1.25)`);
    }, 1_800_000);
  }
});
