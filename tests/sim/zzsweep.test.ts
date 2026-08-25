/** 임시 스윕 — §A 재유도용. 끝나면 지운다. */
import { describe, it } from 'vitest';
import { ALLY_MAX_ACTIVE, ALLY_BLOCK_CAPACITY, ALLY_MUSTER_FORWARD } from '@/data/balance';
import { BASE_LEVELS } from '@/data';
import type { AllyDef, AllyId, BaseLevelDef } from '@/data/types';
import { play, seedsOf, FULL, FAST, type DataPatch, type Profile } from './envelope';
import type { BotOptions, BotResult } from './botharness';

const G = globalThis as unknown as {
  process: { stderr: { write(x: string): void }; env: Record<string, string | undefined> };
};
const W = (s: string): void => { G.process.stderr.write(s + '\n'); };
const ENV = G.process.env;

const ALLY_OPTS: BotOptions = { towerReserve: 600, allies: { minNear: 1 } };
const DECK = ['spear', 'catapult', 'frost'] as const;
const sum = (rs: BotResult[], f: (r: BotResult) => number): number => rs.reduce((a, r) => a + f(r), 0);

function arm(cap: number, prof: Profile, patch: DataPatch): BotResult[] {
  const only: readonly BaseLevelDef[] = [{ ...BASE_LEVELS[0]!, cost: 0, allyCap: cap }];
  return play({
    stageId: 1, deck: [...DECK], seeds: seedsOf('cap', prof), opts: ALLY_OPTS,
    tables: { id: `cap${cap}`, baseLevels: only }, patch,
  });
}

function tune(
  id: string,
  o: { rng?: Partial<Record<AllyId, number>>; cost?: Partial<Record<AllyId, number>>; hp?: Partial<Record<AllyId, number>> },
): DataPatch {
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
  r13: tune('r13', { rng: { clubber: 1.3, guardian: 1.5 } }),
  r15: tune('r15', { rng: { clubber: 1.5, guardian: 1.7 } }),
  r18: tune('r18', { rng: { clubber: 1.8, guardian: 2.0 } }),
  r20: tune('r20', { rng: { clubber: 2.0, guardian: 2.3 } }),
  r24: tune('r24', { rng: { clubber: 2.4, guardian: 2.7 } }),
  r28: tune('r28', { rng: { clubber: 2.8, guardian: 3.2 } }),
  r34: tune('r34', { rng: { clubber: 3.4, guardian: 3.8 } }),
  r40: tune('r40', { rng: { clubber: 4.0, guardian: 4.6 } }),
  r20s: tune('r20s', { rng: { clubber: 2.0, guardian: 2.3, slinger: 3.4 } }),
  r24s: tune('r24s', { rng: { clubber: 2.4, guardian: 2.7, slinger: 3.6 } }),
};

describe('zz 스윕', () => {
  const names = (ENV.ZZ_CFG ?? 'base').split(',');
  for (const name of names) {
    it(`11b ${name}`, () => {
      const prof = ENV.ZZ_PROF === 'fast' ? FAST : FULL;
      const patch = CONFIGS[name];
      if (!patch) throw new Error(`no config ${name}`);
      const few = arm(2, prof, patch);
      const many = arm(ALLY_MAX_ACTIVE, prof, patch);
      const t = (rs: BotResult[]): number => sum(rs, (r) => r.alliesTrained);
      const b = (rs: BotResult[]): number => sum(rs, (r) => r.allyBlockTicks);
      const at = (rs: BotResult[]): number => sum(rs, (r) => r.allyTicks);
      const eb = (rs: BotResult[]): number => sum(rs, (r) => r.enemyBlockedTicks);
      const tt = (rs: BotResult[]): number => sum(rs, (r) => r.totalTicks);
      W(`[${name} · CAP=${ALLY_BLOCK_CAPACITY} · FWD=${ALLY_MUSTER_FORWARD} · ${prof.name} ${few.length}판]`);
      W(`  정원2 t${t(few)} b${b(few)} 가동${((b(few) / at(few)) * 100).toFixed(2)}% 승${few.filter((r) => r.won).length}` +
        ` | 정원6 t${t(many)} b${b(many)} 가동${((b(many) / at(many)) * 100).toFixed(2)}% 승${many.filter((r) => r.won).length}`);
      W(`  적봉쇄틱 ${eb(few)} → ${eb(many)} · 교전아군/틱 ${(b(few) / tt(few)).toFixed(4)} → ${(b(many) / tt(many)).toFixed(4)}`);
      W(`>>> ${name}: 생산비 ${(t(many) / t(few)).toFixed(4)} (>1.10) · 봉쇄비 ${(b(many) / b(few)).toFixed(4)} (>1.25)`);
    }, 1_800_000);
  }
});
