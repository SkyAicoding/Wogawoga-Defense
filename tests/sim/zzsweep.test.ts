// @ts-nocheck
/** 임시 스윕 스크립트 — 4단계 튜닝용. 작업 끝나면 삭제한다. */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { ALLY_DEFS, BASE_LEVELS, stageById } from '@/data';
import type { AllyDef, AllyId, BaseLevelDef, TowerId } from '@/data/types';
import { makeBotSimFor, runBot, type BotOptions, type BotResult } from './botharness';

const OUT = '/tmp/claude-0/-home-user/f4d1ce61-6230-58b9-8a9c-fa813cf20c21/scratchpad/sweep.txt';
const N = Number(process.env.NSEEDS ?? 40);
const SEEDS = Array.from({ length: N }, (_, i) => 1000 + 37 * i);
const DECK: TowerId[] = ['spear', 'catapult', 'frost'];

type Variant = Partial<Record<AllyId, Partial<AllyDef>>>;
function allyTable(v: Variant): Record<AllyId, AllyDef> {
  const out = {} as Record<AllyId, AllyDef>;
  for (const k of Object.keys(ALLY_DEFS) as AllyId[]) out[k] = { ...ALLY_DEFS[k], ...(v[k] ?? {}) };
  return out;
}

interface Case {
  name: string;
  opts: BotOptions;
  ally?: Variant;
  base?: readonly BaseLevelDef[];
  stage?: number;
  endless?: boolean;
  deck?: TowerId[];
}

function play(c: Case): BotResult[] {
  const stage = stageById(c.stage ?? 1)!;
  return SEEDS.map((seed) => {
    const sim = makeBotSimFor(
      stage, seed, c.deck ?? DECK, 0, c.endless ?? false,
      c.base ?? BASE_LEVELS, allyTable(c.ally ?? {}),
    );
    return runBot(sim, stage, c.opts);
  });
}

const wins = (rs: BotResult[]): number => rs.filter((r) => r.won).length;
const sum = (rs: BotResult[], f: (r: BotResult) => number): number => rs.reduce((a, r) => a + f(r), 0);
const avg = (rs: BotResult[], f: (r: BotResult) => number): string => (sum(rs, f) / rs.length).toFixed(1);

function row(name: string, rs: BotResult[]): string {
  const earned = sum(rs, (r) => r.goldEarned);
  const pct = (n: number): string => ((100 * n) / Math.max(1, earned)).toFixed(1);
  return [
    name.padEnd(24),
    `승 ${String(wins(rs)).padStart(2)}/${N}`,
    `minW ${String(Math.min(...rs.map((r) => r.wave))).padStart(2)}`,
    `avgW ${avg(rs, (r) => r.wave).padStart(5)}`,
    `HP합 ${String(sum(rs, (r) => r.baseHpLeft)).padStart(4)}`,
    `파괴 ${String(sum(rs, (r) => r.destroyed)).padStart(3)}`,
    `누수 ${String(sum(rs, (r) => r.leaked)).padStart(4)}/${String(sum(rs, (r) => r.leaks)).padStart(4)}마리`,
    `minT ${String(sum(rs, (r) => r.minTowers)).padStart(3)}`,
    `유닛 ${String(sum(rs, (r) => r.alliesTrained)).padStart(4)}`,
    `Lv ${avg(rs, (r) => r.baseLevel)}`,
    `골드 ${String(sum(rs, (r) => r.goldEarned)).padStart(6)}`,
    `타워${pct(sum(rs, (r) => r.goldTowers)).padStart(5)}%`,
    `유닛${pct(sum(rs, (r) => r.goldAllies)).padStart(5)}%`,
    `기지${pct(sum(rs, (r) => r.goldBase)).padStart(5)}%`,
    `지형${pct(sum(rs, (r) => r.goldScenery)).padStart(5)}%`,
  ].join(' ');
}

const CASES: Case[] = [
  { name: 'A 타워(기준)', opts: {} },
  { name: 'K clubber c55', opts: { allies: { pick: 'clubber' } } },
  { name: 'K clubber c80', opts: { allies: { pick: 'clubber' } }, ally: { clubber: { cost: 80 } } },
  { name: 'K clubber c90', opts: { allies: { pick: 'clubber' } }, ally: { clubber: { cost: 90 } } },
  { name: 'K clubber c110', opts: { allies: { pick: 'clubber' } }, ally: { clubber: { cost: 110 } } },
  { name: 'K guardian c110', opts: { allies: { pick: 'guardian' } } },
  { name: 'K slinger c80', opts: { allies: { pick: 'slinger' } } },
  { name: 'L 기지 최우선', opts: { base: {} } },
  { name: 'L 기지 res600', opts: { base: { reserve: 600 } } },
  { name: 'L 기지 res1500', opts: { base: { reserve: 1500 } } },
  { name: 'L 기지 upTo2', opts: { base: { upTo: 2 } } },
  { name: 'L 기지 upTo3', opts: { base: { upTo: 3 } } },
  { name: 'M 지형(불도저)', opts: { bulldoze: true } },
];

/** 패배 판이 '아슬아슬'인지 '붕괴'인지 — 시드별 도달 웨이브/잔여HP */
function perSeed(c: Case): string {
  const rs = play(c);
  const cells = rs.map((r, i) => `${SEEDS[i]}:${r.won ? 'O' : 'X'}w${r.wave}h${r.baseHpLeft}`);
  return c.name.padEnd(18) + cells.join(' ');
}

describe('sweep', () => {
  it('stage1', () => {
    const lines: string[] = [];
    for (const c of CASES) lines.push(row(c.name, play(c)));

    writeFileSync(OUT, lines.join('\n') + '\n');
  }, 900_000);
});
