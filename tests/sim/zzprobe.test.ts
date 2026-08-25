/** 임시 — 실패 다리 넷만 다시 잰다. 끝나면 지운다. */
import { describe, it } from 'vitest';
import { GATE_HOLD_MIN_TICKS } from '@/data/balance';
import { BASE, FULL, legReport } from './envelope';
import { judgeCollapse, judge1a, judge8, judge11b } from './autoplay.probes';

const G = globalThis as unknown as { process: { stderr: { write(x: string): void } } };
const W = (s: string): void => { G.process.stderr.write(s + '\n'); };

describe('zz 다리', () => {
  it('넷', () => {
    W(`### GATE_HOLD_MIN_TICKS=${GATE_HOLD_MIN_TICKS}`);
    for (const [name, j] of [
      ['collapse', judgeCollapse],
      ['1a', judge1a],
      ['8', judge8],
      ['11b', judge11b],
    ] as const) {
      const r = j(BASE, FULL);
      W(`--- [${name}] ${r.msg}`);
      W(legReport(r.legs));
    }
  }, 2_400_000);
});
