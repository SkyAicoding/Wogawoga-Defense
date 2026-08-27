/** 웨이브 — 스폰 스케줄, 조기 호출 보너스, 웨이브 완료→prep, 최종 승리, endless 지속/체력 성장 */
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { baseLevels, enemyDefs, eventsOf, options, stageDef, wave } from './fixtures';

/*
 * ⚠⚠ **마을을 무장시킨다 (2026-08-27)** — 이 파일의 세 항목이 그것 없이는 못 돈다.
 *
 * 사용자 지시로 문간 체류 상한이 없어졌다(`src/sim/gate.ts` · 지시 원문: "hp 만큼
 * 계속해서 살아서 홈 타운을 공격 하도록 해줘"). 그래서 문 앞에 선 적은 **죽어야만**
 * 사라진다. 목 표의 마을은 기본이 무장 해제(dmg 0)라, 웨이브 완료·승리·endless 를
 * 재는 아래 항목들이 첫 마리에서 영영 멈춰 버린다(실측: `waveCleared` 0건).
 *
 * ⚠ 사거리는 **1** 이다 — 문간 정지선(1.95)보다 짧다. `updateHometown` 규칙 2-b 가
 *   `atGate` 인 적을 사거리와 무관하게 표적으로 삼으므로, 이 마을은 **문 앞에 선 적만**
 *   쏜다. 곧 접근 구간은 손대지 않은 채 "문 앞의 적이 죽어서 웨이브가 끝난다"만 켠다.
 *   (사거리 0 은 안 된다 — 그건 무장 해제로 걸러져 한 발도 안 나간다)
 * ⚠ 이 파일이 재는 것은 **웨이브 장부**(보상·승리·endless 성장)이지 문간이 아니다.
 *   문간 자체는 `tests/sim/gate.test.ts` 와 `wavetermination.test.ts` 가 잰다.
 */
const GATE_KILLER = baseLevels([{ dmg: 50, cooldownTicks: 5, range: 1 }]);

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
        baseLevels: GATE_KILLER,
        enemyDefs: enemyDefs({ raptor: { speed: 3 } }),
        stage: stageDef({ waveCount: 2, baseHp: 100 }),
        waves: [wave([{ count: 1 }], 10), wave([{ count: 1 }], 10)],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev: SimEvent[] = [];
    // ⚠ **웨이브가 끝난 그 틱에서 멈춘다.** 고정 틱 수로 돌면 안 된다 — 문간 체류가
    //   `GATE_HOLD_MIN_TICKS`·`GATE_BITE_TICKS` 의 함수라, 그 상수가 움직이면 창이
    //   prep 을 통째로 지나쳐 **다음 웨이브가 이미 시작된 상태**를 보게 된다(실측:
    //   하한 90 → 60 에서 250틱 창이 그렇게 뒤집혔다). 재는 것은 "웨이브가 끝나고
    //   prep 이 90틱으로 선다"이지 "몇 틱에 끝나나"가 아니다.
    for (let i = 0; i < 2_000; i++) {
      sim.tick();
      const now = sim.drainEvents();
      ev.push(...now);
      if (now.some((e) => e.type === 'waveCleared')) break;
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
        baseLevels: GATE_KILLER,
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
        baseLevels: GATE_KILLER,
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
