import { describe, it } from 'vitest';
import { stageById } from '@/data';
import type { BattleTuning } from '@/sim/battle';
import { makeBotSimFor, runBot, STRONG_GATHER_BOT, type BotOptions, type BotResult } from './botharness';
import { FULL, seedsOf } from './envelope';

const DECK = ['spear', 'catapult', 'frost'] as const;
const G1: BotOptions = { towerReserve: 600, gather: { count: 1 } };
const G2: BotOptions = { towerReserve: 600, gather: { count: 2 } };

function run(win: 'l2' | 'strong', opts: BotOptions, tuning?: BattleTuning): BotResult[] {
  const stage = stageById(1)!;
  return seedsOf(win, FULL).map((seed) =>
    runBot(makeBotSimFor(stage, seed, [...DECK], 0, false, undefined, undefined, undefined, undefined, tuning), stage, opts),
  );
}
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const band = (rs: BotResult[]): string =>
  [0, 1, 2, 3, 4].map((i) => mean(rs.map((r) => r.gatherGoldByBand[i] ?? 0)).toFixed(1)).join(' ');
const line = (n: string, rs: BotResult[]): string =>
  `${n.padEnd(22)} band[${band(rs)}]  골드 ${mean(rs.map((r) => r.gatherGold)).toFixed(1)}` +
  ` 배달 ${mean(rs.map((r) => r.gatherDeliveries)).toFixed(2)}` +
  ` 수확 ${mean(rs.map((r) => r.harvests)).toFixed(2)}` +
  ` 재생 ${mean(rs.map((r) => r.regrows)).toFixed(2)}` +
  ` 승 ${rs.filter((r) => r.won).length}/${rs.length}`;

// 게이트 켬 = 배포본(stockFrac 0.5) / 게이트 끔 = 옛 순수 타이머(stockFrac 1)
const NOGATE: BattleTuning = { gatherRegrowStockFrac: 1 };
const NOWAVE: BattleTuning = { gatherRegrowWaveSpeedup: 0 };
const DEPLOY: BattleTuning = { gatherRegrowStockFrac: 1, gatherRegrowWaveSpeedup: 0 };

describe('zz 밴드 실측', () => {
  it('웨이브대별 배달 골드', () => {
    const out: string[] = [];
    for (const [w, o, nm] of [['l2', G1, 'g1'], ['l2', G2, 'g2'], ['strong', STRONG_GATHER_BOT, 'sg']] as const) {
      out.push(line(`${nm} 배포본(gate off·k0)`, run(w, o, DEPLOY)));
      out.push(line(`${nm} gate만(frac.5·k0)`, run(w, o, NOWAVE)));
      out.push(line(`${nm} wave만(frac1·k.01)`, run(w, o, NOGATE)));
      out.push(line(`${nm} 지금(frac.5·k.01)`, run(w, o)));
      out.push('');
    }
    console.log('\n' + out.join('\n'));
  }, 900_000);
});
