/* 리뷰 전용 — 누수 개체가 낳는 '총량 팽창' 계측 + 방치 봉투 + 결정론. 커밋하지 않는다. */
import { describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import type { BattleSim, SimEvent, TowerId } from '@/data/types';
import { makeBotSimFor, runBot, STRONG_BOT, type BotOptions } from './botharness';
import { STAGES } from '@/data/stages/index';

const LOG = process.env['LEAK_OUT'] ?? '/tmp/leak.log';
const say = (m: string): void => appendFileSync(LOG, m + '\n');
const stageById = (id: number) => STAGES.find((s) => s.id === id)!;
const S1: TowerId[] = ['spear', 'catapult', 'frost'];
const ALL: TowerId[] = [
  'spear',
  'catapult',
  'frost',
  'lightning',
  'poison',
  'ballista',
  'brazier',
  'drum',
];
const SEEDS40 = Array.from({ length: 40 }, (_, i) => 1000 + 37 * i);

/** 개체별 지급을 추적해 '죽은 적 수입' 대 '누수 적 수입'을 가른다 */
function split(stageId: number, seed: number, deck: TowerId[], opts: BotOptions, stars: number) {
  const stage = stageById(stageId);
  const sim = makeBotSimFor(stage, seed, deck, stars);
  const paid = new Map<number, number>();
  let died = 0;
  let leakedGold = 0;
  let deadGold = 0;
  let neverResolved = 0;
  let pending: number | null = null;
  const onEvent = (ev: SimEvent): void => {
    if (pending !== null) {
      const e = ev as { type: string; enemyId?: number };
      if (e.type === 'enemyDied' || e.type === 'bountyChunk') {
        paid.set(e.enemyId as number, (paid.get(e.enemyId as number) ?? 0) + pending);
      }
      pending = null;
    }
    if (ev.type === 'goldChanged' && ev.delta > 0) pending = ev.delta;
    else if (ev.type === 'enemyDied') {
      deadGold += paid.get(ev.enemyId) ?? 0;
      paid.delete(ev.enemyId);
      died++;
    } else if (ev.type === 'enemyLeaked') {
      leakedGold += paid.get(ev.enemyId) ?? 0;
      paid.delete(ev.enemyId);
    }
  };
  const res = runBot(sim as BattleSim, stage, { ...opts, onEvent });
  for (const [, g] of paid) neverResolved += g;
  return { res, died, deadGold, leakedGold, neverResolved };
}

describe('[리뷰] 누수 수입 · 방치 · 결정론', () => {
  it('누수 개체가 버는 골드 비중 (s1 기준선 / s1 STRONG / s6 별5 STRONG)', () => {
    const arms: [string, number, TowerId[], BotOptions, number][] = [
      ['s1-base', 1, S1, {}, 0],
      ['s1-strong', 1, S1, STRONG_BOT, 0],
      ['s6-star5-strong', 6, ALL, STRONG_BOT, 5],
    ];
    for (const [tag, st, deck, opts, stars] of arms) {
      let dead = 0;
      let leak = 0;
      let unres = 0;
      let earned = 0;
      let wins = 0;
      for (const sd of SEEDS40) {
        const r = split(st, sd, deck, opts, stars);
        dead += r.deadGold;
        leak += r.leakedGold;
        unres += r.neverResolved;
        earned += r.res.goldEarned;
        if (r.res.won) wins++;
      }
      const combat = dead + leak + unres;
      say(
        `[누수수입] ${tag} 승=${wins}/40 총획득=${earned} 전투수입=${combat} ` +
          `사망분=${dead} 누수분=${leak} (${((leak / Math.max(1, combat)) * 100).toFixed(2)}%) 미해결=${unres}`,
      );
    }
    expect(true).toBe(true);
  }, 1_800_000);

  it('방치(타워 0)면 여전히 진다 — 12시드 전수', () => {
    for (const seed of [7, 11, 23, 41, 59, 101, 233, 401, 777, 1000, 2024, 9999]) {
      const stage = stageById(1);
      const sim = makeBotSimFor(stage, seed, S1, 0);
      for (let i = 0; i < 60000; i++) {
        if (sim.state.phase === 'prep' && sim.state.prepTicksLeft > 0) {
          sim.applyCommand({ type: 'callWave' });
        }
        sim.tick();
        sim.drainEvents();
        if (sim.state.phase === 'lost' || sim.state.phase === 'won') break;
      }
      say(
        `[방치] seed=${seed} phase=${sim.state.phase} wave=${sim.state.waveIndex} gold=${sim.state.gold}`,
      );
      expect(sim.state.phase, `seed ${seed}`).toBe('lost');
      expect(sim.state.waveIndex).toBeLessThanOrEqual(5);
      expect(sim.state.gold, `seed ${seed} 골드 ${sim.state.gold}`).toBeLessThanOrEqual(500);
    }
  }, 600_000);

  it('결정론 — 같은 시드/같은 커맨드로 두 번 돌려 해시 비교 (2000틱 + 전체 판)', () => {
    for (const seed of [1000, 1481, 2024]) {
      const run = (): { h: string; gold: number } => {
        const stage = stageById(1);
        const sim = makeBotSimFor(stage, seed, S1, 0);
        sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 3 });
        sim.applyCommand({ type: 'placeTower', handIndex: 1, cellX: 5, cellZ: 5 });
        for (let i = 0; i < 2000; i++) {
          if (i === 300) sim.applyCommand({ type: 'callWave' });
          if (i === 900) sim.applyCommand({ type: 'placeTower', handIndex: 2, cellX: 7, cellZ: 4 });
          sim.tick();
          sim.drainEvents();
        }
        return { h: String(sim.hash()), gold: sim.state.gold };
      };
      const a = run();
      const b = run();
      say(`[결정론] seed=${seed} hashA=${a.h} hashB=${b.h} goldA=${a.gold} goldB=${b.gold}`);
      expect(a.h).toBe(b.h);
      expect(a.gold).toBe(b.gold);
    }
    // 봇 전체 판도 두 번 — 골드/승패/누수까지 일치해야 한다
    for (const seed of [1000, 1481]) {
      const one = () => {
        const stage = stageById(1);
        return runBot(makeBotSimFor(stage, seed, S1, 0), stage, {});
      };
      const a = one();
      const b = one();
      say(
        `[결정론-봇] seed=${seed} A(won=${a.won},wave=${a.wave},earned=${a.goldEarned},leaked=${a.leaked}) B(won=${b.won},wave=${b.wave},earned=${b.goldEarned},leaked=${b.leaked})`,
      );
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  }, 600_000);
});
