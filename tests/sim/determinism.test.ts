/** 같은 시드+같은 커맨드 → 해시 완전 일치, 다른 시드 → 상이 */
import { describe, expect, it } from 'vitest';
import type { BattleCommand } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { options, stageDef, wave } from './fixtures';

const SCRIPT: [number, BattleCommand][] = [
  [3, { type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 }],
  [6, { type: 'placeTower', handIndex: 1, cellX: 5, cellZ: 3 }],
  [8, { type: 'refreshHand' }],
  [10, { type: 'setTargeting', towerId: 1, mode: 'strongest' }],
  [12, { type: 'callWave' }],
  [500, { type: 'upgradeTower', towerId: 1 }],
  [800, { type: 'sellTower', towerId: 2 }],
  [900, { type: 'placeTower', handIndex: 0, cellX: 6, cellZ: 1 }],
];

function runScripted(seed: number): number[] {
  const sim = createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear', 'frost', 'catapult'],
      stage: stageDef({ waveCount: 3, baseHp: 999 }),
      waves: [
        wave([{ count: 4, intervalTicks: 20 }]),
        wave([{ count: 6, intervalTicks: 15 }]),
        wave([{ count: 8, intervalTicks: 10, hpMul: 1.5 }]),
      ],
    }),
  );
  const hashes: number[] = [];
  for (let t = 0; t < 2000; t++) {
    for (const [at, cmd] of SCRIPT) if (at === t) sim.applyCommand(cmd);
    sim.tick();
    sim.drainEvents();
    if (t % 100 === 99) hashes.push(sim.hash());
  }
  return hashes;
}

describe('결정론', () => {
  it('같은 시드 + 같은 스크립트 → 2000틱 해시 전 구간 일치', () => {
    const a = runScripted(123);
    const b = runScripted(123);
    expect(a).toEqual(b);
    expect(a.length).toBe(20);
  });

  it('다른 시드 → 해시 상이', () => {
    const a = runScripted(123);
    const b = runScripted(456);
    expect(a[a.length - 1]).not.toBe(b[b.length - 1]);
  });
});
