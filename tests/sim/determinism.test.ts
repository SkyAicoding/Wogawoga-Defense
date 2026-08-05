/** 같은 시드+같은 커맨드 → 해시 완전 일치, 다른 시드 → 상이 */
import { describe, expect, it } from 'vitest';
import type { BattleCommand } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { allyDefs, baseLevels, enemyDefs, options, stageDef, towerDefs, wave } from './fixtures';

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

/**
 * 아군 시나리오 — 마을에서 주민을 뽑아 내보내고, 봉쇄가 서고, 반격에 쓰러지고,
 * 수명이 다해 돌아가는 구간까지 전부 한 스크립트에 넣는다.
 * 아군 위치/체력/수명/쿨다운/타깃 + 적의 봉쇄·난투 쿨다운이 hash()에 들어가 있는지를 잠근다.
 */
const ALLY_SCRIPT: [number, BattleCommand][] = [
  [2, { type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 }],
  [3, { type: 'trainAlly', defId: 'clubber' }],
  [4, { type: 'callWave' }],
  [40, { type: 'trainAlly', defId: 'guardian' }],
  [120, { type: 'trainAlly', defId: 'slinger' }],
  [300, { type: 'trainAlly', defId: 'clubber' }],
  [560, { type: 'trainAlly', defId: 'clubber' }], // 앞선 유닛이 빠진 자리에 보충
  [900, { type: 'trainAlly', defId: 'guardian' }],
];

function runAllies(seed: number): {
  hashes: number[];
  trained: number;
  died: number;
  retired: number;
} {
  const sim = createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear', 'frost', 'catapult'],
      stage: stageDef({ waveCount: 3, baseHp: 9999, startGold: 100000 }),
      enemyDefs: enemyDefs({
        // 아군을 확실히 죽이는 난투력 + 타워도 노리는 습격대 (봉쇄 규칙까지 함께 밟는다)
        warrior: {
          hp: 900,
          speed: 0.5,
          cost: 40,
          towerAttack: { dmg: 30, range: 1.6, cooldownTicks: 20, stopToAttack: true, ranged: false },
        },
        raptor: { hp: 300, speed: 0.9, cost: 25 },
      }),
      allyDefs: allyDefs({
        clubber: { hp: 90, dmg: 12, cooldownTicks: 22, lifeTicks: 420 },
        guardian: { hp: 260, dmg: 7, cooldownTicks: 30, armor: 2, speed: 0.8, lifeTicks: 500 },
        slinger: { hp: 60, dmg: 9, range: 2.6, blocks: false, canTargetAir: true, lifeTicks: 400 },
      }),
      waves: [
        wave([
          { enemyId: 'warrior', count: 5, intervalTicks: 25 },
          { enemyId: 'raptor', count: 6, intervalTicks: 18, delayTicks: 60 },
        ]),
        wave([{ enemyId: 'warrior', count: 6, intervalTicks: 20 }]),
        wave([{ enemyId: 'raptor', count: 8, intervalTicks: 15, hpMul: 1.5 }]),
      ],
    }),
  );
  const hashes: number[] = [];
  let trained = 0;
  let died = 0;
  let retired = 0;
  for (let t = 0; t < 1500; t++) {
    for (const [at, cmd] of ALLY_SCRIPT) if (at === t) sim.applyCommand(cmd);
    sim.tick();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'allyTrained') trained++;
      else if (ev.type === 'allyDied') died++;
      else if (ev.type === 'allyRetired') retired++;
    }
    if (t % 50 === 49) hashes.push(sim.hash());
  }
  return { hashes, trained, died, retired };
}

// ---------------------------------------------------------------------------
// 홈타운 시나리오 — 기지가 실제로 쏘고 도중에 레벨업까지 하는 구간.
// 레벨(공격력·사거리·최대HP)·발사 쿨다운·고정 타깃이 hash()에 들어가 있는지를 잠근다.
// ---------------------------------------------------------------------------
const HOME_SCRIPT: [number, BattleCommand][] = [
  [2, { type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 0 }],
  [4, { type: 'callWave' }],
  [300, { type: 'upgradeBase' }], // 교전 도중 레벨업 — 사거리/공격력이 그 자리에서 바뀐다
  [700, { type: 'upgradeBase' }],
  [1100, { type: 'upgradeBase' }], // 최대 레벨 도달 (거부되는 호출까지 포함)
];

function runHometown(seed: number): { hashes: number[]; shots: number; upgrades: number } {
  const sim = createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear'],
      stage: stageDef({ waveCount: 3, baseHp: 9999, startGold: 100000 }),
      // 기지 화력을 켠다 (fixtures 기본은 무장 해제)
      baseLevels: baseLevels([
        { dmg: 6, cooldownTicks: 24, range: 2 },
        { dmg: 14, cooldownTicks: 20, range: 3 },
        { dmg: 30, cooldownTicks: 16, range: 4 },
      ]),
      enemyDefs: enemyDefs({
        raptor: { hp: 260, speed: 0.8 },
        ptera: { hp: 200, speed: 1.1, flying: true }, // 공중까지 쏘는 규칙 3도 밟는다
      }),
      waves: [
        wave([
          { enemyId: 'raptor', count: 6, intervalTicks: 22 },
          { enemyId: 'ptera', count: 4, intervalTicks: 30, delayTicks: 90 },
        ]),
        wave([{ enemyId: 'raptor', count: 8, intervalTicks: 18 }]),
        wave([{ enemyId: 'ptera', count: 6, intervalTicks: 20, hpMul: 1.4 }]),
      ],
    }),
  );
  const hashes: number[] = [];
  let shots = 0;
  let upgrades = 0;
  for (let t = 0; t < 1500; t++) {
    for (const [at, cmd] of HOME_SCRIPT) if (at === t) sim.applyCommand(cmd);
    sim.tick();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'baseFired') shots++;
      else if (ev.type === 'baseUpgraded') upgrades++;
    }
    if (t % 50 === 49) hashes.push(sim.hash());
  }
  return { hashes, shots, upgrades };
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

  it('아군을 뽑아 싸우다 죽는 시나리오도 해시 전 구간 일치', () => {
    const a = runAllies(31337);
    const b = runAllies(31337);
    // 시나리오가 실제로 출동·사망·귀환을 전부 포함하는지 먼저 확인 (검증이 헛돌지 않게)
    expect(a.trained).toBeGreaterThan(3);
    expect(a.died).toBeGreaterThan(0);
    expect(a.retired).toBeGreaterThan(0);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.hashes.length).toBe(30);
    expect(b.died).toBe(a.died);
    expect(b.retired).toBe(a.retired);
  });

  it('기지가 쏘고 레벨업하는 시나리오도 해시 전 구간 일치', () => {
    const a = runHometown(8181);
    const b = runHometown(8181);
    // 시나리오가 실제로 사격과 레벨업을 포함하는지 먼저 확인 (검증이 헛돌지 않게)
    expect(a.shots).toBeGreaterThan(10);
    expect(a.upgrades).toBe(2); // 3레벨 테이블이라 세 번째 호출은 거부된다
    expect(a.hashes).toEqual(b.hashes);
    expect(a.hashes.length).toBe(30);
    expect(b.shots).toBe(a.shots);
  });

  it('홈타운 레벨이 해시에 반영된다 (레벨업만 달라도 갈라진다)', () => {
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
    expect(a.hash()).toBe(b.hash());
    expect(b.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(a.hash()).not.toBe(b.hash());
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
