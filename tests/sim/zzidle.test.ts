/** 임시 — [5] 방치 판 재유도 계측. 끝나면 지운다. */
import { describe, it } from 'vitest';
import { STAGES } from '@/data/stages';
import { makeBotSimFor } from './botharness';

const G = globalThis as unknown as { process: { stderr: { write(x: string): void } } };
const W = (s: string): void => { G.process.stderr.write(s + '\n'); };

describe('zz 방치', () => {
  it('문 앞 사망 명세', () => {
    const sim = makeBotSimFor(STAGES[0]!, 20260825, ['spear']);
    let lostWave = -1;
    const kills: string[] = [];
    const arrivals = new Map<string, number>();
    const leaked: string[] = [];
    const hpAt: string[] = [];
    for (let w = 0; w < 8 && lostWave < 0; w++) {
      hpAt.push(`w${w + 1}시작 HP ${sim.state.baseHp}/${sim.state.baseHpMax}`);
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      for (let t = 0; t < 6_000; t++) {
        sim.tick();
        for (const x of sim.drainEvents()) {
          if (x.type === 'enemyAtGate') arrivals.set(x.defId, (arrivals.get(x.defId) ?? 0) + 1);
          if (x.type === 'enemyDied' && x.gateTicks !== undefined) {
            kills.push(`w${sim.state.waveIndex} ${x.defId} gateTicks=${x.gateTicks}`);
          }
          if (x.type === 'battleEnded' && !x.won) lostWave = x.wave;
          if (x.type === 'enemyLeaked') leaked.push(`w${sim.state.waveIndex}:${x.defId}:${x.baseDamage}`);
        }
        if (lostWave >= 0) break;
        if (t > 2 && sim.state.phase === 'prep') break;
      }
    }
    W(`패배 웨이브 ${lostWave} · 문앞도착 ${[...arrivals].map(([k, v]) => `${k}:${v}`).join(' ')}`);
    W(`문앞 사망 ${kills.length}건 — ${kills.join(' | ')}`);
    W(hpAt.join(' | '));
    const per = new Map<string, number>();
    for (const l of leaked) { const [w, , d] = l.split(':'); per.set(w!, (per.get(w!) ?? 0) + Number(d)); }
    W(`웨이브별 누수총액 ${[...per].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }, 120_000);
});
