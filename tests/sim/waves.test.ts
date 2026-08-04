/** 웨이브 — 스폰 스케줄, 조기 호출 보너스, 웨이브 완료→prep, 최종 승리, endless 지속/체력 성장 */
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { enemyDefs, eventsOf, options, stageDef, wave } from './fixtures';

describe('waves', () => {
  it('스폰 스케줄 — delay + n×interval 틱에 스폰', () => {
    const sim = createBattle(
      options({
        stage: stageDef({ waveCount: 1, baseHp: 100 }),
        waves: [wave([{ count: 3, delayTicks: 30, intervalTicks: 10 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' }); // 다음 틱(1)에 웨이브 시작
    const spawnTicks: number[] = [];
    for (let i = 0; i < 60; i++) {
      sim.tick();
      for (const e of sim.drainEvents()) {
        if (e.type === 'enemySpawned') spawnTicks.push(sim.state.tick);
      }
    }
    expect(spawnTicks).toEqual([31, 41, 51]); // 웨이브 시작 틱(1) + 30/40/50
  });

  it('조기 호출 — 남은 prep틱 × 0.15 골드 보너스 (내림)', () => {
    const sim = createBattle(options());
    expect(sim.state.prepTicksLeft).toBe(150); // 웨이브1 전 150틱
    expect(sim.applyCommand({ type: 'callWave' })).toBe(true);
    const ev = sim.drainEvents();
    const bonus = eventsOf(ev, 'earlyCallBonus');
    expect(bonus[0]?.gold).toBe(Math.floor(150 * 0.15)); // 22
    expect(sim.state.gold).toBe(1022);
    expect(sim.applyCommand({ type: 'callWave' })).toBe(false); // prep 아님 → 거부
  });

  it('웨이브 완료 — 보상 골드/앰버, 다음 prep은 90틱', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { speed: 3 } }),
        stage: stageDef({ waveCount: 2, baseHp: 100 }),
        waves: [wave([{ count: 1 }], 10), wave([{ count: 1 }], 10)],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 150; i++) {
      sim.tick();
      ev.push(...sim.drainEvents());
    }
    const cleared = eventsOf(ev, 'waveCleared');
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ wave: 1, goldReward: 10, amber: 1 });
    expect(sim.state.amberEarned).toBe(1);
    expect(sim.state.phase).toBe('prep');
    expect(sim.state.waveIndex).toBe(2);
    expect(sim.state.prepTicksLeft).toBeGreaterThan(0);
    expect(sim.state.prepTicksLeft).toBeLessThanOrEqual(90); // 이후 prep은 90틱
  });

  it('마지막 웨이브 클리어 → 승리', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { speed: 3 } }),
        stage: stageDef({ waveCount: 2, baseHp: 100 }),
        waves: [wave([{ count: 1 }]), wave([{ count: 1 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 500 && sim.state.phase !== 'won'; i++) {
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      sim.tick();
      ev.push(...sim.drainEvents());
    }
    expect(sim.state.phase).toBe('won');
    const ended = eventsOf(ev, 'battleEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ won: true, wave: 2 });
    expect(sim.state.amberEarned).toBe(2);
    // 종료 후 커맨드/틱 동결
    expect(sim.applyCommand({ type: 'callWave' })).toBe(false);
    const t = sim.state.tick;
    sim.tick();
    expect(sim.state.tick).toBe(t);
  });

  it('endless — waveCount 초과 웨이브 hp × 1.06^n, 승리 없이 지속', () => {
    const sim = createBattle(
      options({
        endless: true,
        enemyDefs: enemyDefs({ raptor: { speed: 3, hp: 10 } }),
        stage: stageDef({ waveCount: 1, baseHp: 100 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    const seenMaxHp: number[] = []; // 웨이브별 스폰 시 maxHp
    for (let i = 0; i < 700 && seenMaxHp.length < 3; i++) {
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      sim.tick();
      for (const e of sim.drainEvents()) {
        if (e.type === 'enemySpawned') {
          expect(e.type).toBe('enemySpawned');
          seenMaxHp.push(sim.state.enemies[0]?.maxHp as number);
        }
        if (e.type === 'battleEnded') throw new Error('endless는 승리로 끝나지 않아야 함');
      }
    }
    expect(seenMaxHp).toEqual([
      10, // 웨이브1: 기본
      Math.round(10 * 1.06), // 웨이브2: waveCount 초과 1 → 11
      Math.round(10 * 1.06 ** 2), // 웨이브3 → 11
    ]);
    expect(sim.state.phase === 'wave' || sim.state.phase === 'prep').toBe(true);
  });
});
