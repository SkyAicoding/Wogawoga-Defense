/** 데미지 파이프라인 — armor 최소1, shield 소진, 처치 골드, 기지 누수/패배 */
import { describe, expect, it } from 'vitest';
import type { BattleSim } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { enemyDefs, eventsOf, options, runTicks, stageDef, wave } from './fixtures';

function place(sim: BattleSim, x: number, z: number): void {
  expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ: z })).toBe(true);
}

describe('combat', () => {
  it('armor 고정 감산 — 최소 1 데미지 보장', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { armor: 999, hp: 3 } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1); // 경로(z=2) 인접, 사거리 3
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const hits = eventsOf(ev, 'enemyDamaged').filter((e) => !e.shielded);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (const h of hits) expect(h.amount).toBe(1); // dmg 5 - armor 999 → 최소 1
    expect(eventsOf(ev, 'enemyDied')).toHaveLength(1);
  });

  it('처치 시 bounty 골드 지급', () => {
    const sim = createBattle(
      options({
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const died = eventsOf(ev, 'enemyDied');
    expect(died).toHaveLength(1);
    expect(died[0]?.bounty).toBe(5);
    // 처치 직후 +5 goldChanged 존재
    expect(eventsOf(ev, 'goldChanged').some((g) => g.delta === 5)).toBe(true);
  });

  it('shield — 피해 무효 2회(shielded 이벤트) 후 실피해', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ warrior: { shieldHits: 2, hp: 10 } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ enemyId: 'warrior', count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const hits = eventsOf(ev, 'enemyDamaged');
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits[0]?.shielded).toBe(true);
    expect(hits[0]?.amount).toBe(0);
    expect(hits[1]?.shielded).toBe(true);
    expect(hits[2]?.shielded).toBe(false);
    expect(hits[2]?.amount).toBe(5); // armor 0 → 원래 데미지
    expect(eventsOf(ev, 'enemyDied')).toHaveLength(1);
  });

  it('기지 누수 — baseDamaged 누적, 0 이하면 패배', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { speed: 3 } }),
        stage: stageDef({ waveCount: 1, baseHp: 3 }),
        waves: [wave([{ count: 3, intervalTicks: 10 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' }); // 타워 없음 → 전부 누수
    const ev = runTicks(sim, 300);
    const leaks = eventsOf(ev, 'enemyLeaked');
    expect(leaks).toHaveLength(3);
    const base = eventsOf(ev, 'baseDamaged');
    expect(base.map((b) => b.hpLeft)).toEqual([2, 1, 0]);
    const ended = eventsOf(ev, 'battleEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.won).toBe(false);
    expect(sim.state.phase).toBe('lost');
  });
});
