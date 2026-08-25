import { describe, it } from 'vitest';
import { STAGES } from '@/data/stages';
import { REGROWABLE_KINDS } from '@/data/resources';
import type { BattleTuning } from '@/sim/battle';
import type { TowerId } from '@/data/types';
import { makeBotSimFor, runBot, STRONG_BOT, type BotOptions } from './botharness';

const BLOCKS = [1000, 2000, 5000, 9000];
const DECK: TowerId[] = ['spear', 'catapult', 'frost'];
const ALL_DECK: TowerId[] = DECK;
const BRANCH: BotOptions = { towerReserve: 600, gather: { count: 1 } };
const STRONG_G: BotOptions = { ...STRONG_BOT, gather: { count: 2 } };

/** 배포본 이전 규칙 = 재고 게이트 없음(frac 1) + 웨이브 의존 없음 */
const OLD: BattleTuning = { gatherRegrowStockFrac: 1, gatherRegrowWaveSpeedup: 0 };

function sweep(stageIdx: number, deck: TowerId[], opts: BotOptions, tuning?: BattleTuning) {
  let gold = 0, harv = 0, reg = 0, lost = 0, wave = 0, won = 0, hp = 0;
  const bands = [0, 0, 0, 0, 0];
  for (const seed of BLOCKS) {
    const st = STAGES[stageIdx]!;
    const sim = makeBotSimFor(st, seed, deck, 0, false, undefined, undefined, undefined, undefined, tuning);
    const r = runBot(sim, st, opts);
    gold += r.gatherGold; harv += r.harvests; reg += r.regrows; lost += r.gatherLostGold;
    wave += r.wave; won += r.won ? 1 : 0; hp += r.baseHpLeft / r.baseHpMax;
    r.gatherGoldByBand.forEach((v, i) => { bands[i]! += v; });
  }
  const n = BLOCKS.length;
  return {
    gold: gold / n, harv: harv / n, reg: reg / n, lost: lost / n,
    wave: wave / n, won, slack: (hp / n) * 100, bands: bands.map((b) => b / n),
  };
}

describe('zz 배포본 영향', () => {
  it('옛 규칙 대 새 규칙 — s1', () => {
    for (const [label, opts] of [['gatherBranch', BRANCH], ['strongGather', STRONG_G]] as const) {
      for (const [rule, t] of [['옛(frac1,가속0)', OLD], ['새(배포본)', undefined]] as const) {
        const r = sweep(0, DECK, opts, t);
        console.log(
          `[s1 ${label} ${rule}] 채집골드 ${r.gold.toFixed(1)} · 사망손실 ${r.lost.toFixed(1)} · 합 ${(r.gold + r.lost).toFixed(1)} · 수확 ${r.harv.toFixed(1)} · 재생 ${r.reg.toFixed(1)} · 웨평 ${r.wave.toFixed(2)} · 승 ${r.won}/4 · 여유 ${r.slack.toFixed(2)}% · 밴드 ${r.bands.map((b) => b.toFixed(0)).join(' ')}`,
        );
      }
    }
  }, 900000);

  it('옛 규칙 대 새 규칙 — s6 (재생종이 총액의 17%뿐인 판)', () => {
    for (const [rule, t] of [['옛(frac1,가속0)', OLD], ['새(배포본)', undefined]] as const) {
      const r = sweep(5, ALL_DECK, STRONG_G, t);
      console.log(
        `[s6 strongGather ${rule}] 채집골드 ${r.gold.toFixed(1)} · 수확 ${r.harv.toFixed(1)} · 재생 ${r.reg.toFixed(1)} · 웨평 ${r.wave.toFixed(2)} · 승 ${r.won}/4 · 여유 ${r.slack.toFixed(2)}%`,
      );
    }
  }, 900000);

  it('문턱 스윕 (s1 · 새 규칙에서 frac 만 갈아 끼운다)', () => {
    for (const frac of [0.35, 0.5, 0.65, 0.75, 1]) {
      const b = sweep(0, DECK, BRANCH, { gatherRegrowStockFrac: frac });
      const g = sweep(0, DECK, STRONG_G, { gatherRegrowStockFrac: frac });
      console.log(
        `[frac ${frac}] 갈래 골드 ${b.gold.toFixed(1)} 밴드 ${b.bands.map((x) => x.toFixed(0)).join(' ')} · 최강 골드 ${g.gold.toFixed(1)} 여유 ${g.slack.toFixed(2)}% 밴드 ${g.bands.map((x) => x.toFixed(0)).join(' ')}`,
      );
    }
  }, 900000);

  it('총액 상한 대조 — 판당 총액과 실제 수취', () => {
    for (const i of [0, 5]) {
      const st = STAGES[i]!;
      const sim = makeBotSimFor(st, 1000, ALL_DECK, 0, false);
      let cap = 0, grow = 0;
      for (const r of sim.state.resources) {
        cap += r.value * (1 + r.regrowsLeft);
        if (REGROWABLE_KINDS.has(r.kind)) grow += r.value;
      }
      console.log(`s${st.id} 판당총액 ${cap} · 재생종Σv(분모) ${grow} · 문턱값 ${0.5 * grow}`);
    }
  }, 900000);
});
