/** 같은 시드+같은 커맨드 → 해시 완전 일치, 다른 시드 → 상이 */
import { describe, expect, it } from 'vitest';
import type { BattleCommand } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { enemyDefs, options, stageDef, towerDefs, wave } from './fixtures';

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

// ---------------------------------------------------------------------------
// 공성 시나리오 — 적 부족이 타워를 실제로 부수는 구간까지 해시가 일치해야 한다.
// 타워 HP/파괴 시점/적의 공격 쿨다운·타깃이 hash()에 들어가 있는지를 잠근다.
// ---------------------------------------------------------------------------
const SIEGE_SCRIPT: [number, BattleCommand][] = [
  [2, { type: 'placeTower', handIndex: 0, cellX: 1, cellZ: 1 }],
  [3, { type: 'placeTower', handIndex: 1, cellX: 3, cellZ: 1 }],
  [4, { type: 'placeTower', handIndex: 2, cellX: 5, cellZ: 3 }],
  [6, { type: 'callWave' }],
  [400, { type: 'upgradeTower', towerId: 2 }],
  [700, { type: 'placeTower', handIndex: 0, cellX: 1, cellZ: 1 }], // 부서진 자리에 재건설
];

function runSiege(seed: number): { hashes: number[]; destroyed: number } {
  const sim = createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear', 'frost', 'catapult'],
      stage: stageDef({ waveCount: 3, baseHp: 9999, startGold: 100000 }),
      // 부족 전사: 근접·멈춰서 공격. 타워를 확실히 부수도록 화력을 올려 둔다
      enemyDefs: enemyDefs({
        warrior: {
          hp: 4000,
          speed: 0.35,
          towerAttack: { dmg: 45, range: 1.6, cooldownTicks: 20, stopToAttack: true, ranged: false },
        },
        shaman: {
          hp: 3000,
          speed: 0.4,
          towerAttack: { dmg: 18, range: 2.6, cooldownTicks: 25, stopToAttack: false, ranged: true },
        },
      }),
      towerDefs: towerDefs(),
      waves: [
        wave([
          { enemyId: 'warrior', count: 5, intervalTicks: 25 },
          { enemyId: 'shaman', count: 3, intervalTicks: 40, delayTicks: 60 },
        ]),
        wave([{ enemyId: 'warrior', count: 6, intervalTicks: 20 }]),
        wave([{ enemyId: 'warrior', count: 8, intervalTicks: 15, hpMul: 1.5 }]),
      ],
    }),
  );
  const hashes: number[] = [];
  let destroyed = 0;
  for (let t = 0; t < 1500; t++) {
    for (const [at, cmd] of SIEGE_SCRIPT) if (at === t) sim.applyCommand(cmd);
    sim.tick();
    for (const ev of sim.drainEvents()) if (ev.type === 'towerDestroyed') destroyed++;
    if (t % 50 === 49) hashes.push(sim.hash());
  }
  return { hashes, destroyed };
}

/**
 * 습격대 시나리오 — 칼/창/궁수/주술사가 한 웨이브에 섞여 나오고, 저주(침묵)가 걸린 채로
 * 타워가 부서진다. 침묵 잔여 틱이 hash()에 들어가 있는지까지 잠근다.
 */
const RAID_SCRIPT: [number, BattleCommand][] = [
  [2, { type: 'placeTower', handIndex: 0, cellX: 1, cellZ: 1 }],
  [3, { type: 'placeTower', handIndex: 1, cellX: 4, cellZ: 1 }],
  [4, { type: 'placeTower', handIndex: 2, cellX: 7, cellZ: 3 }],
  [6, { type: 'callWave' }],
];

function runRaid(seed: number): { hashes: number[]; destroyed: number; silenced: number } {
  const sim = createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear', 'frost', 'catapult'],
      stage: stageDef({ waveCount: 2, baseHp: 9999, startGold: 100000 }),
      enemyDefs: enemyDefs({
        blade: { hp: 2500, speed: 0.4, towerAttack: { dmg: 30, range: 1.6, cooldownTicks: 20, stopToAttack: true, ranged: false } },
        lancer: { hp: 3000, speed: 0.35, towerAttack: { dmg: 40, range: 2.0, cooldownTicks: 36, stopToAttack: true, ranged: false } },
        archer: { hp: 1800, speed: 0.5, towerAttack: { dmg: 12, range: 3.2, cooldownTicks: 40, stopToAttack: false, ranged: true } },
        hexer: {
          hp: 2000,
          speed: 0.3,
          towerAttack: { dmg: 8, range: 3.6, cooldownTicks: 60, stopToAttack: false, ranged: true, silenceTicks: 30 },
        },
      }),
      towerDefs: towerDefs(),
      waves: [
        wave([
          { enemyId: 'blade', count: 6, intervalTicks: 7 },
          { enemyId: 'lancer', count: 4, intervalTicks: 9, delayTicks: 30 },
          { enemyId: 'archer', count: 4, intervalTicks: 12, delayTicks: 80 },
          { enemyId: 'hexer', count: 3, intervalTicks: 12, delayTicks: 90 },
        ]),
        wave([{ enemyId: 'blade', count: 8, intervalTicks: 6 }]),
      ],
    }),
  );
  const hashes: number[] = [];
  let destroyed = 0;
  let silenced = 0;
  for (let t = 0; t < 1200; t++) {
    for (const [at, cmd] of RAID_SCRIPT) if (at === t) sim.applyCommand(cmd);
    sim.tick();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'towerDestroyed') destroyed++;
      if (ev.type === 'towerSilenced') silenced++;
    }
    if (t % 50 === 49) hashes.push(sim.hash());
  }
  return { hashes, destroyed, silenced };
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

  it('타워가 부서지는 시나리오도 해시 전 구간 일치', () => {
    const a = runSiege(777);
    const b = runSiege(777);
    // 시나리오가 실제로 파괴를 포함하는지 먼저 확인 (검증이 헛돌지 않게)
    expect(a.destroyed).toBeGreaterThan(0);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.hashes.length).toBe(30);
    expect(b.destroyed).toBe(a.destroyed);
  });

  it('습격대 4종(저주 포함)이 섞인 웨이브도 해시 전 구간 일치', () => {
    const a = runRaid(2024);
    const b = runRaid(2024);
    // 시나리오가 실제로 침묵과 파괴를 포함하는지 먼저 확인 (검증이 헛돌지 않게)
    expect(a.silenced).toBeGreaterThan(0);
    expect(a.destroyed).toBeGreaterThan(0);
    expect(a.hashes).toEqual(b.hashes);
    expect(b.silenced).toBe(a.silenced);
  });

  it('타워 HP가 해시에 반영된다 (같은 배치·같은 틱에서 HP만 달라도 갈라진다)', () => {
    const mk = (): ReturnType<typeof createBattle> =>
      createBattle(
        options({
          seed: 5,
          deck: ['spear'],
          stage: stageDef({ startGold: 100000 }),
          waves: [wave([{ count: 0 }])],
        }),
      );
    const a = mk();
    const b = mk();
    for (const s of [a, b]) s.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 0 });
    expect(a.hash()).toBe(b.hash());
    const t = b.towerAt(4, 0);
    expect(t).not.toBeNull();
    t!.hp -= 1;
    expect(a.hash()).not.toBe(b.hash());
  });
});
