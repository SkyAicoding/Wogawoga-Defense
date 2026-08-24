/** 같은 시드+같은 커맨드 → 해시 완전 일치, 다른 시드 → 상이 */
import { describe, expect, it } from 'vitest';
import type { BattleCommand, BattleSim, EnemyState } from '@/data/types';
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
          towerAttack: { dmg: 45, range: 1.6, cooldownTicks: 20, stopToAttack: true, holdTicks: 60, ranged: false },
        },
        shaman: {
          hp: 3000,
          speed: 0.4,
          towerAttack: { dmg: 18, range: 2.6, cooldownTicks: 25, stopToAttack: false, holdTicks: 0, ranged: true },
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

function makeRaidSim(seed: number): BattleSim {
  return createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear', 'frost', 'catapult'],
      stage: stageDef({ waveCount: 2, baseHp: 9999, startGold: 100000 }),
      enemyDefs: enemyDefs({
        // 전원 원거리 + 정지 사격 — siegeHoldLeft/siegeWalkLeft/attackAnimLeft가 실제로 도는 시나리오다
        blade: { hp: 2500, speed: 0.4, towerAttack: { dmg: 30, range: 2.4, cooldownTicks: 20, stopToAttack: true, holdTicks: 75, ranged: true } },
        lancer: { hp: 3000, speed: 0.35, towerAttack: { dmg: 40, range: 2.8, cooldownTicks: 36, stopToAttack: true, holdTicks: 90, ranged: true } },
        archer: { hp: 1800, speed: 0.5, towerAttack: { dmg: 12, range: 3.2, cooldownTicks: 40, stopToAttack: true, holdTicks: 75, ranged: true } },
        hexer: {
          hp: 2000,
          speed: 0.3,
          towerAttack: { dmg: 8, range: 3.6, cooldownTicks: 60, stopToAttack: true, holdTicks: 60, ranged: true, silenceTicks: 30 },
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
}

/**
 * **살점 값 시나리오** — 몫 지급(`bountyPaid > 0`)이 실제로 일어나는 유일한 판.
 *
 * 왜 습격대 판을 못 쓰는가: `fixtures.enemyDef`의 기본 bounty가 5라 골드 상한
 * `floor(5/4)` = 1 이고, `bountyChunksFor`가 K=1을 주면 `settleBounty`가 생전 지급을
 * 통째로 막는다. 곧 그 판에서는 사망 전까지 지급이 **원리상 불가능**하다.
 * 여기서는 잡몹(hp 20) 여섯에 큰 적(hp 1,200 · bounty 480) 하나를 섞는다 —
 * 중앙 HP(refHp)가 20이 되어 큰 적의 K가 `min(round(1200/20), floor(480/4), 24)` = **24**다.
 * 실측: 틱 522에 `bountyPaid` = **13**(첫 몫), 판 전체에서 몫 이벤트 3건.
 */
const BOUNTY_SCRIPT: [number, BattleCommand][] = [
  [2, { type: 'placeTower', handIndex: 0, cellX: 1, cellZ: 1 }],
  [3, { type: 'placeTower', handIndex: 1, cellX: 4, cellZ: 1 }],
  [4, { type: 'placeTower', handIndex: 2, cellX: 7, cellZ: 3 }],
  [6, { type: 'callWave' }],
];

function makeBountySim(seed: number): BattleSim {
  return createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear', 'frost', 'catapult'],
      stage: stageDef({ waveCount: 2, baseHp: 9999, startGold: 100000 }),
      enemyDefs: enemyDefs({
        raptor: { hp: 20, speed: 0.5, bounty: 5 },
        trex: { hp: 1200, speed: 0.18, bounty: 480 },
      }),
      towerDefs: towerDefs(),
      waves: [
        wave([
          { enemyId: 'raptor', count: 6, intervalTicks: 10 },
          { enemyId: 'trex', count: 1, intervalTicks: 10, delayTicks: 5 },
        ]),
        wave([{ enemyId: 'raptor', count: 4, intervalTicks: 10 }]),
      ],
    }),
  );
}

/** bountyPaid는 EnemyState에 없는 내부 필드다 (의도된 비공개) — 읽기만 하는 좁은 창 */
const paidOf = (e: EnemyState): number => (e as unknown as { bountyPaid?: number }).bountyPaid ?? 0;

function runRaid(seed: number): { hashes: number[]; destroyed: number; silenced: number } {
  const sim = makeRaidSim(seed);
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
 * 아군 시나리오 — 마을에서 주민을 뽑아 **길목으로 내보내고**, 봉쇄가 서고, 반격에 쓰러지는
 * 구간까지 전부 한 스크립트에 넣는다. 아군 위치/체력/목표/걸은 거리/쿨다운/타깃 +
 * 적의 봉쇄·난투 쿨다운이 hash()에 들어가 있는지를 잠근다.
 *
 * ── 9단계: 수명이 사라지고 **이동 명령**이 들어왔다 ──────────────────────────
 * 8단계 스크립트는 trainAlly만 여덟 줄이었다. 그래도 시나리오가 성립했던 이유는
 * 아군이 스스로 한계선까지 걸어 나가 알아서 교전했기 때문이고, 20초 수명이 알아서
 * 자리를 비워 줬기 때문이다. 그 둘이 다 없어졌으므로 이제 **뽑기만 하면 아군은 홈타운 앞
 * 1.4타일에 붙박여 있고**(집결 지점), 정원이 차면 그 뒤로는 아무 일도 일어나지 않는다.
 *
 * 그래서 moveAlly를 스크립트에 넣는다. 회귀 잠금으로서 이게 필수인 이유:
 *  · **새 커맨드가 해시 커버리지에 없으면 결정론 회귀를 못 잡는다.** tgtX/tgtZ/walked는
 *    9단계에 새로 hash()에 들어간 필드인데, 명령을 한 번도 안 내리면 tgt는 스폰 값
 *    그대로고 walked는 영원히 0이라 세 필드가 전부 상수가 된다.
 *  · 전원 이동(allyId −1)과 개별 지정(allyId ≥ 0)은 **다른 분기**다. 둘 다 밟는다.
 *  · 앞으로 보냈다 뒤로 물리면 좌표는 왕복하지만 walked는 단조 증가한다 — 그 비대칭이
 *    해시에 남는지가 여기서 갈린다(렌더의 보행 위상이 그 값에 걸려 있다).
 *
 * ── 규칙 8: `autoHold`도 이 스크립트가 밟는다 ───────────────────────────────
 * 자동 행동 스위치는 **위치에서 유도되지 않는 비트**라 hash()가 따로 접어야 한다.
 * 이 스크립트는 세 값을 다 지나간다:
 *  · t=20·150 — **빈 칸**(3,2)·(5,2) 명령 = `autoHold` **true**("여기 지켜")
 *  · t=1000   — **기지 셀** 명령 = 다시 **false**(자동 켜짐). 이 한 줄이 없으면 스크립트가
 *    비트를 한 방향으로만 밀어 "true로 굳는 회귀"를 못 잡는다
 *  · t=300 이후에 뽑힌 부족원 — 명령을 한 번도 안 받아 기본값 **false**
 * (이 판의 아군 셋은 전부 `gatherPct` 기본값 100이라 **일꾼이 아니다** — 곧 비트만 갈리고
 *  행동은 한 글자도 안 바뀐다. 해시가 그 비트를 정말 접는지만 순수하게 잰다.)
 */
const ALLY_SCRIPT: [number, BattleCommand][] = [
  [2, { type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 }],
  [3, { type: 'trainAlly', defId: 'clubber' }],
  [4, { type: 'callWave' }],
  [20, { type: 'moveAlly', allyId: -1, cellX: 3, cellZ: 2 }], // 전원 전진 — 길목으로
  [40, { type: 'trainAlly', defId: 'guardian' }],
  [120, { type: 'trainAlly', defId: 'slinger' }],
  [150, { type: 'moveAlly', allyId: -1, cellX: 5, cellZ: 2 }], // 전원 후퇴 (walked는 계속 쌓인다)
  [300, { type: 'trainAlly', defId: 'clubber' }],
  [560, { type: 'trainAlly', defId: 'clubber' }], // 앞선 유닛이 빠진 자리에 보충
  [900, { type: 'trainAlly', defId: 'guardian' }],
  // 규칙 8-b) 기지 셀 = "돌아와서 내려놓고 다시 일해" — autoHold를 false로 되돌리는 유일한
  // 칸이다. 비트가 한 방향으로만 움직이면 해시 커버리지가 반쪽이다 (위 머리말 참조).
  [1000, { type: 'moveAlly', allyId: -1, cellX: 9, cellZ: 2 }],
];

/**
 * 개별 지정(allyId ≥ 0) 분기를 밟기 시작하는 틱.
 *
 * 스크립트에 상수로 못 적는 이유가 둘이다: ① 아군 id는 적·타워와 한 카운터를 쓰므로
 * 몇 번이 될지 여기서 알 수 없고, ② 아군이 영구가 된 대신 **정말로 죽으므로** 특정 틱에
 * 누가 살아 있다는 보장이 없다 — 실측(25틱 간격 표본)으로 이 시나리오는 대략 t 400~560과
 * 570~900에 생존자가 0이라, t=420에 고정하면 명령이 아예 안 나간다(그렇게 짜서 한 번 헛돌렸다).
 * 그래서 "이 틱 **이후 처음으로** 살아 있는 아군"에게 한 번 보낸다 — 상태가 결정론이라
 * 누구를 고르는지도 결정론이다. 실측 발동 시점은 t=560(막 보충된 곤봉잡이 id 23).
 */
const SOLO_ORDER_TICK = 420;

/**
 * SOLO 명령이 찍는 셀. **`(2,2)`에서 `(3,2)`로 옮겼다.**
 *
 * 이유: 채집이 들어오면서 `moveAlly`의 도착지에 뜻이 하나 붙었다(D7) — 찍은 칸이 자원
 * 칸이면 그 아군은 **거기 서는 대신 캐기 시작한다.** 그러면 이 스크립트가 잠그던 것
 * (`walked`·`tgtX/tgtZ`가 해시에 반영되는가)이 더 이상 그것이 아니게 된다. 두 판이
 * 똑같이 바뀌므로 A/B 비교는 그대로 통과하고, **그래서 조용히 커버리지만 사라진다.**
 * 실측: 배포본 스테이지1에서 `(2,2)`는 실제 자원 칸이다(fruit, 마을거리 13.04).
 *
 * ⚠ 옮긴 이유를 **어서션으로 굳힌다** — 아래 `expectNotResource`가 이 스크립트가 찍는
 *   네 칸이 전부 자원 칸이 아님을 매 실행마다 직접 검사한다. 주석만 남기면 스테이지나
 *   소품 시드가 바뀐 날 같은 사고가 말없이 되돌아온다.
 */
const SOLO_CELL = { x: 3, z: 2 };

/** 이 스크립트가 찍는 칸이 **자원 칸이 아님**을 그 자리에서 못 박는다 (위 SOLO_CELL 주석) */
function expectNotResource(sim: BattleSim, cells: readonly { x: number; z: number }[]): void {
  for (const c of cells) {
    expect(
      sim.state.resources.some((r) => r.cellX === c.x && r.cellZ === c.z),
      `(${c.x},${c.z})는 자원 칸이 아니어야 한다 — 자원 칸이면 이 스크립트는 이동이 아니라 채집을 잰다`,
    ).toBe(false);
    expect(sim.resourceAt(c.x, c.z), `(${c.x},${c.z}) resourceAt`).toBeNull();
  }
}

function runAllies(seed: number): {
  hashes: number[];
  trained: number;
  died: number;
  ordered: number;
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
          towerAttack: { dmg: 30, range: 1.6, cooldownTicks: 20, stopToAttack: true, holdTicks: 60, ranged: false },
        },
        raptor: { hp: 300, speed: 0.9, cost: 25 },
      }),
      allyDefs: allyDefs({
        clubber: { hp: 90, dmg: 12, cooldownTicks: 22 },
        guardian: { hp: 260, dmg: 7, cooldownTicks: 30, armor: 2, speed: 0.8 },
        slinger: { hp: 60, dmg: 9, range: 2.6, blocks: false, canTargetAir: true },
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
  // ⚠ **먼저** 못 박는다 — 이 스크립트가 찍는 네 칸이 자원 칸이면 잠그는 대상이 바뀐다
  expectNotResource(sim, [SOLO_CELL, { x: 3, z: 2 }, { x: 4, z: 2 }, { x: 5, z: 2 }]);
  const hashes: number[] = [];
  let trained = 0;
  let died = 0;
  let ordered = 0;
  let soloSent = false;
  for (let t = 0; t < 1500; t++) {
    for (const [at, cmd] of ALLY_SCRIPT) if (at === t) sim.applyCommand(cmd);
    // 개별 지정 분기 (SOLO_ORDER_TICK 주석 참조) — 살아 있는 첫 부족원에게 딱 한 번
    if (!soloSent && t >= SOLO_ORDER_TICK) {
      const solo = sim.state.allies[0];
      if (solo) {
        soloSent = sim.applyCommand({
          type: 'moveAlly',
          allyId: solo.id,
          cellX: SOLO_CELL.x,
          cellZ: SOLO_CELL.z,
        });
      }
    }
    sim.tick();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'allyTrained') trained++;
      else if (ev.type === 'allyDied') died++;
      else if (ev.type === 'allyOrdered') ordered++;
    }
    if (t % 50 === 49) hashes.push(sim.hash());
  }
  return { hashes, trained, died, ordered };
}

/** 이동 명령의 목표 셀 — 도달 여부를 나중에 같은 좌표로 검산한다 */
const ORDER_CELL = { x: 4, z: 2 };

/**
 * 6단계) 아군 출동 + 마을 레벨업을 **섞은** 시나리오.
 *
 * ── 9단계: 레벨이 파는 물건이 한계선에서 **정원**으로 바뀌었다 ────────────────
 * 8단계에는 마을 레벨이 출격 한계선을 정했고, 그래서 레벨업 순간 이미 나가 있던 아군이
 * 앞으로 더 걸어 나갔다 — 이 시나리오가 잠근 것은 그 **위치 발산**이었다.
 * 지금 마을이 정하는 것은 BaseLevelDef.allyCap(정원)이라, 레벨업은 이미 나가 있는
 * 아군에게 아무 일도 하지 않는다. 대신 **그 시점부터 몇 명을 더 뽑을 수 있는지**를 바꾼다.
 *
 * 그래서 발산이 생기는 자리도 옮겨졌다: 같은 trainAlly 커맨드가 레벨업 **전에는 거부되고
 * 후에는 통과한다**. 판별력은 그대로다 — 정원이 레벨에서 유도되지 않으면(예: 상수로
 * 굳거나 지금 레벨 대신 다음 레벨을 읽으면) 그 성패가 뒤집혀 해시가 갈라진다.
 * 그리고 8단계와 마찬가지로 **새 상태가 하나도 늘지 않는다**: 정원은 표에서 읽는
 * 유도값이라 저장할 것이 없다(allyCapFor).
 */
const MIXED_SCRIPT: [number, BattleCommand][] = [
  [2, { type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 }],
  [3, { type: 'trainAlly', defId: 'clubber' }],
  [5, { type: 'trainAlly', defId: 'guardian' }], // 여기서 Lv1 정원 2명이 찬다
  [6, { type: 'callWave' }],
  [30, { type: 'moveAlly', allyId: -1, cellX: ORDER_CELL.x, cellZ: ORDER_CELL.z }],
  [200, { type: 'upgradeBase' }], // 정원 2 → 4
  [260, { type: 'trainAlly', defId: 'clubber' }],
  [520, { type: 'upgradeBase' }], // 정원 4 → 6
  [700, { type: 'trainAlly', defId: 'slinger' }],
  [900, { type: 'upgradeBase' }], // 3레벨 테이블이라 거부된다
];

/** 정원 관측용 탐침 — 레벨업 **직전**과 **직후**에 같은 커맨드를 쏴 성패를 비교한다 */
const CAP_PROBE_BEFORE = 8; // 정원 2명이 찬 뒤 (거부되어야 한다)
const CAP_PROBE_AFTER = 205; // 첫 레벨업(200) 뒤 (통과해야 한다)

function runMixed(seed: number): {
  hashes: number[];
  upgrades: number;
  trained: number;
  /** 관측: 정원이 레벨에서 유도되는가 — 같은 커맨드가 레벨업 전엔 거부, 후엔 통과 */
  capBefore: boolean;
  capAfter: boolean;
  /** 관측: 명령을 받은 아군이 실제로 그 칸에 도달했는가 */
  reachedOrder: boolean;
} {
  const sim = createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear'],
      stage: stageDef({ waveCount: 3, baseHp: 9999, startGold: 100000 }),
      // 목 기본 표는 정원을 전 레벨 절대 상한(6)으로 준다(fixtures 주석) — 여기서는
      // 레벨이 정원을 판다는 것 자체가 관측 대상이라 2/4/6으로 벌려 덮어쓴다
      baseLevels: baseLevels([
        { dmg: 6, cooldownTicks: 24, range: 2, allyCap: 2 },
        { cost: 100, dmg: 14, cooldownTicks: 20, range: 3, allyCap: 4 },
        { cost: 200, dmg: 30, cooldownTicks: 16, range: 4, allyCap: 6 },
      ]),
      enemyDefs: enemyDefs({
        warrior: {
          hp: 900,
          speed: 0.5,
          cost: 40,
          towerAttack: { dmg: 30, range: 1.6, cooldownTicks: 20, stopToAttack: true, holdTicks: 60, ranged: false },
        },
        raptor: { hp: 300, speed: 0.9, cost: 25 },
      }),
      allyDefs: allyDefs({
        clubber: { hp: 90, dmg: 12, cooldownTicks: 22 },
        guardian: { hp: 260, dmg: 7, cooldownTicks: 30, armor: 2, speed: 0.8 },
        slinger: { hp: 60, dmg: 9, range: 2.6, blocks: false, canTargetAir: true },
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
  let upgrades = 0;
  let trained = 0;
  // 초기값은 **기대와 반대**로 둔다 — 탐침이 아예 안 돌면(틱 상수를 잘못 고치면) 통과가 아니라 실패다
  let capBefore = true;
  let capAfter = false;
  let reachedOrder = false;
  // 정원 탐침 — 레벨업 전/후에 **똑같은** 커맨드를 한 번씩 쏘고 성패만 본다.
  // (성공하면 아군이 하나 늘어 그 뒤 판이 통째로 갈리는데, 그것도 관측의 일부다:
  //  거부/통과가 뒤집히면 해시가 어긋나므로 위의 전 구간 일치 검사가 함께 잡는다)
  const probe: BattleCommand = { type: 'trainAlly', defId: 'slinger' };
  for (let t = 0; t < 1200; t++) {
    for (const [at, cmd] of MIXED_SCRIPT) if (at === t) sim.applyCommand(cmd);
    if (t === CAP_PROBE_BEFORE) capBefore = sim.applyCommand(probe);
    if (t === CAP_PROBE_AFTER) capAfter = sim.applyCommand(probe);
    sim.tick();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'baseUpgraded') upgrades++;
      else if (ev.type === 'allyTrained') trained++;
    }
    /**
     * 9단계) 예전 이 자리에는 "아군이 Lv1 한계선(경로 끝 − 4.0)보다 앞으로 나갔는가"가
     * 있었다. 한계선이 폐기됐으므로 개념 자체가 없어졌고, 임계값을 손보는 것으로는
     * 되살릴 수 없다. 같은 자리에서 **이동 명령이 실제로 먹혔는가**를 대신 확인한다:
     * 명령을 받은 아군이 찍은 칸에 실제로 도달한다(도착 판정 ARRIVE_EPS2 안으로 든다).
     * 판별력도 같은 종류다 — 목표가 저장되지 않거나 이동이 목표를 향하지 않거나
     * 도착에서 멈추지 않으면 이 관측이 곧바로 false가 된다.
     */
    for (const a of sim.state.allies) {
      if (Math.hypot(a.x - ORDER_CELL.x, a.z - ORDER_CELL.z) < 1e-3) reachedOrder = true;
    }
    if (t % 40 === 39) hashes.push(sim.hash());
  }
  return { hashes, upgrades, trained, capBefore, capAfter, reachedOrder };
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

// ---------------------------------------------------------------------------
// 채집 시나리오 (docs/gather-spec.md §9-2) — **밟아야 할 분기 여덟 개**를 한 판에 넣는다.
//  ① 개체 지정(allyId >= 0)과 종족 지정(-1) 둘 다
//  ② 같은 칸에 둘 → 예약 배타성 (E-8·E-9)
//  ③ 채집 중 다른 칸으로 moveAlly (E-3)
//  ④ carryCap 2로 두 칸 → 자동 귀환 → 배달 (D6·D3)
//  ⑤ 텄음 칸에 타워 배치 시도 → 실패 (D1)
//  ⑥ 안 턴 칸을 골드로 치우기 (E-14)
//  ⑦ 적이 붙어 진행분이 깨졌다 다시 캐기 (E-11)
//  ⑧ 운반 중 사망 (E-10)
// 잠그는 것: 아군 다섯 필드(gatherKey/gatherTicks/carryGold/carryCount/gatherHpMark)와
// 자원 밭(taken)이 hash()에 들어가는가. 하나라도 빠지면 "언제 누가 무엇을 캐는가"의
// 발산을 해시가 놓친다.
//
// ⚠ **짐값 기준을 6으로 주입해 돌린다**(createBattle의 BattleTuning). 배포본 상수는 아직
//   0이라(T6이 켠다) 주입 없이는 carryGold·v.gold가 **영원히 0**이고, 그러면 이 시나리오가
//   "0을 0과 비교하는" 실패 불가능한 계약이 된다.
// ---------------------------------------------------------------------------
const GATHER_SCRIPT: [number, BattleCommand][] = [
  // 넷을 뽑는다. **callWave보다 먼저** 뽑아야 아군 id가 1~4로 굳는다 — id 카운터를
  // 적·투사체와 공유하므로 웨이브가 시작된 뒤에 뽑으면 개체 지정 명령이 헛나간다.
  [2, { type: 'trainAlly', defId: 'gatherer' }], // #1 A — 왕복 배달을 완주하는 사람
  [3, { type: 'trainAlly', defId: 'gatherer' }], // #2 B — 전선 옆에서 맞으며 캔다
  [4, { type: 'trainAlly', defId: 'clubber' }], // #3 C — hp 12. **짐을 진 채 죽는다**
  [5, { type: 'trainAlly', defId: 'guardian' }], // #4 D — 캐던 칸이 치워진다
  [6, { type: 'callWave' }],
  // ① 종족 지정 — 자원 칸이므로 sim이 **한 사람만** 고른다(E-9). 나머지는 자리도 안 바꾼다
  [8, { type: 'moveAlly', allyId: -1, defId: 'gatherer', cellX: 0, cellZ: 4 }],
  // ②·① 개체 지정으로 **같은 칸**에 한 명 더 — 걸어는 가되 예약은 못 붙인다(배타성)
  [10, { type: 'moveAlly', allyId: 2, cellX: 0, cellZ: 4 }],
  [100, { type: 'moveAlly', allyId: 2, cellX: 7, cellZ: 0 }], // B 캐기 시작
  // ③ 캐던 도중 **다른 자원 칸**으로 — 예약 취소('moved') + 진행분 폐기. 앞 칸은 살아 돌아온다
  [250, { type: 'moveAlly', allyId: 2, cellX: 3, cellZ: 0 }],
  [320, { type: 'moveAlly', allyId: 3, cellX: 2, cellZ: 0 }], // C: 안전한 칸에서 한 짐
  [322, { type: 'moveAlly', allyId: 4, cellX: 0, cellZ: 1 }], // D: 곧 치워질 칸
  // ④ A는 첫 칸을 다 캔 뒤 옆칸으로 → 짐 2개 → 자동 귀환 → 배달
  [560, { type: 'moveAlly', allyId: 1, cellX: 1, cellZ: 4 }],
  // ⑥ D가 캐던 칸을 골드로 치운다 → cancelGatherersOf('cleared'). **치운 사람이 그 짐을 버린 것**
  [620, { type: 'clearScenery', cellX: 0, cellZ: 1 }],
  // ⑦ B를 **전선 옆 칸**으로 — 지나가는 적이 스칠 때마다 진행분이 0으로 돌아간다(E-11).
  //   hp가 커서 죽지는 않는다: ⑧(운반 중 사망)은 hp 12짜리 C가 자동 귀환길에 맡는다
  [700, { type: 'moveAlly', allyId: 2, cellX: 7, cellZ: 3 }],
];

/** ⑤·⑥의 관측 지점 — 텄음 칸을 확인하는 틱(A가 (0,4)를 다 캔 뒤) */
const TAKEN_PROBE_TICK = 520;

interface GatherRun {
  hashes: number[];
  started: number;
  gathered: number;
  delivered: number;
  deliveredGold: number;
  lost: Record<'hit' | 'moved' | 'cleared' | 'died', number>;
  finalGold: number;
  takenCells: number;
  /** ⑤ 텄음 칸이 여전히 건설 불가인가 (D1의 직접 증거) */
  takenStillBlocked: boolean;
  /** ⑤ 텄음 칸의 유료 제거 비용이 그대로인가 — 채집은 제거 지수를 한 톨도 안 건드린다 */
  clearCostUnchanged: boolean;
}

function runGather(seed: number): GatherRun {
  const sim = createBattle(
    options({
      seed,
      endless: true,
      deck: ['spear', 'frost', 'catapult'],
      stage: stageDef({ waveCount: 3, baseHp: 9999, startGold: 100000 }),
      enemyDefs: enemyDefs({
        // 길(z=2)을 느리게 걸어가며 **옆칸의 채집꾼을 스친다**(규칙 5-c brushTarget).
        // 난투 피해를 3으로 낮춘 것이 핵심이다: 기본값(cost 40 → 13)이면 채집꾼이
        // 첫 뭉치에 즉사해 **E-11('맞으면 진행분만 0')이 한 번도 안 밟힌다** —
        // 죽는 판정(E-10)이 맞는 판정을 통째로 가린다.
        warrior: { hp: 1200, speed: 0.25, cost: 40, brawl: { dmg: 3, cooldownTicks: 30 } },
        raptor: { hp: 400, speed: 0.35, cost: 25, brawl: { dmg: 3, cooldownTicks: 30 } },
      }),
      // 넷 다 채집을 할 줄 알게 만든다 — 종을 나눈 이유는 **hp를 따로 주기 위해서**다.
      // 목 표는 종당 하나뿐이라, "죽는 사람"과 "맞으면서도 버티는 사람"을 같은 판에
      // 넣으려면 종을 갈라야 한다. 넷 다 blocks:false다 — 봉쇄가 끼면 이 시나리오가
      // 재는 것이 채집인지 봉쇄인지 알 수 없게 된다.
      allyDefs: allyDefs({
        gatherer: { hp: 300, dmg: 1, range: 0.9, speed: 1.3, blocks: false, gatherPct: 300, carryCap: 2 },
        // hp 12 = 난투 4대. 안전한 칸에서 한 짐을 지고 **자동 귀환길에 길을 건너다 죽는다**
        clubber: { hp: 12, dmg: 1, range: 0.9, speed: 1.3, blocks: false, gatherPct: 300, carryCap: 1 },
        guardian: { hp: 300, dmg: 1, range: 0.9, speed: 1.3, blocks: false, gatherPct: 300, carryCap: 1 },
      }),
      waves: [
        wave([
          { enemyId: 'warrior', count: 6, intervalTicks: 60 },
          { enemyId: 'raptor', count: 6, intervalTicks: 40, delayTicks: 300 },
        ]),
        wave([{ enemyId: 'warrior', count: 6, intervalTicks: 50 }]),
        wave([{ enemyId: 'raptor', count: 8, intervalTicks: 40, hpMul: 1.5 }]),
      ],
    }),
    // ⚠ 짐값 기준 주입 — 배포본 상수(0)로는 이 시나리오가 아무것도 안 잰다
    { gatherBaseValue: 6 },
  );
  const hashes: number[] = [];
  const lost = { hit: 0, moved: 0, cleared: 0, died: 0 };
  let started = 0;
  let gathered = 0;
  let delivered = 0;
  let deliveredGold = 0;
  // 초기값은 **기대와 반대**로 둔다 — 탐침이 아예 안 돌면 통과가 아니라 실패다
  let takenStillBlocked = true;
  let clearCostUnchanged = false;
  const clearCost0 = sim.clearSceneryCost(0, 4);
  for (let t = 0; t < 1400; t++) {
    for (const [at, cmd] of GATHER_SCRIPT) if (at === t) sim.applyCommand(cmd);
    sim.tick();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'gatherStarted') started++;
      else if (ev.type === 'gathered') gathered++;
      else if (ev.type === 'gatherDelivered') {
        delivered++;
        deliveredGold += ev.gold;
      } else if (ev.type === 'gatherLost') lost[ev.reason]++;
    }
    if (t === TAKEN_PROBE_TICK) {
      // ⑤ 다 캔 칸은 **그루터기로 남는다** — 소품 Set에서 빠지지 않으므로 계속 건설 불가이고
      //    유료 제거 비용도 그대로다(채집은 clearedScenery 지수를 안 올린다)
      takenStillBlocked = !sim.canPlaceAt(0, 4);
      clearCostUnchanged = sim.clearSceneryCost(0, 4) === clearCost0;
    }
    if (t % 50 === 49) hashes.push(sim.hash());
  }
  return {
    hashes,
    started,
    gathered,
    delivered,
    deliveredGold,
    lost,
    finalGold: sim.state.gold,
    takenCells: sim.state.resources.filter((r) => r.taken).length,
    takenStillBlocked,
    clearCostUnchanged,
  };
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

  /**
   * 정지 사격이 들여온 상태 셋(siege.ts 규칙 4)이 **각각** 해시에 반영되는지.
   * 한꺼번에 흔들면 하나만 들어가 있어도 통과하므로 반드시 하나씩 흔든다.
   *  · siegeHoldLeft  — 지금 서 있는가 (이동 여부를 직접 바꾼다)
   *  · siegeWalkLeft  — 언제 다시 멈출 수 있는가 (앞으로의 정지 시점 전부를 바꾼다)
   *  · attackAnimLeft — 연출 전용이지만 타격 시점의 파생값이라, 갈리면 "언제 쐈는가"가 갈렸다는 뜻
   */
  /**
   * 살점 값의 지급 이력(`bountyPaid`)이 hash()에 들어가는지.
   *
   * 왜 `hp`만으로는 못 잡는가: 이 값은 **hp에서 유도되지 않는다.** 주술사 힐로 hp가
   * 되돌아온 적은 hp가 같아도 bountyPaid가 다르고, 곧 앞으로 받을 돈이 다르다.
   * 그리고 `resetEnemy`의 리셋 누락(풀 재사용 누출)은 `v.gold`로도 결국 갈리지만
   * 그 발산은 **몇 백 틱 뒤**에나 드러난다 — 여기 있어야 새는 그 틱에 잡힌다.
   *
   * ⚠ **이 테스트는 주석이 주장하는 것을 안 하고 있었다 (실측으로 확인하고 고쳤다).**
   * 옛 판본은 `makeRaidSim` 위에서 `enemies.length > 0`이 되는 즉시 루프를 빠져나왔다.
   * 계측하니 **틱 7**(첫 적이 나온 그 틱)에 끊겼고 `bountyPaid` = **0**이었다. 게다가
   * 그 시나리오의 적은 fixtures 기본 bounty가 5라 `bountyChunks` = **1**이고,
   * `settleBounty`가 `if (e.bountyChunks <= 1) return 0;`으로 생전 경로를 즉시 막으므로
   * **그 판에서는 사망 전까지 bountyPaid가 영원히 0**이었다. 곧 옛 테스트는 정확히
   * "0을 1로 바꾸는 것"만 하고 있었고, 주석은 그걸 피했다고 적고 있었다.
   * 지금은 **K ≥ 2인 큰 적이 실제로 몫을 받을 때까지** 돌리고(아래 `bountyPaid > 0`
   * 어서션이 그것을 못 박는다) 그 뒤에 흔든다 — 회복으로 hp가 되돌아온 적을 구분하는
   * 성질이 여기서 처음으로 실제로 실행된다.
   */
  it('살점 값의 지급 이력(bountyPaid)이 hash()에 들어간다', () => {
    const sim = makeBountySim(2024);
    let target: EnemyState | undefined;
    // **실제로 지급이 일어난 뒤에** 흔든다 — 0을 1로 바꾸는 것과 구분되게
    for (let t = 0; t < 1500 && !target; t++) {
      for (const [at, cmd] of BOUNTY_SCRIPT) if (at === t) sim.applyCommand(cmd);
      sim.tick();
      sim.drainEvents();
      target = sim.state.enemies.find((e) => paidOf(e) > 0);
    }
    expect(target, '몫을 실제로 받은 적이 있다').toBeDefined();
    // 이 줄이 이 테스트의 전제다 — 0 → 1 을 흔드는 판으로 되돌아가면 여기서 걸린다
    expect(paidOf(target as EnemyState), '흔들기 전에 이미 지급이 있었다').toBeGreaterThan(0);
    const h0 = sim.hash();
    // bountyPaid는 EnemyState에 없는 내부 필드라 캐스트로 흔든다 (의도된 비공개)
    const obj = target as unknown as Record<string, number>;
    obj['bountyPaid'] = (obj['bountyPaid'] ?? 0) + 1;
    expect(sim.hash(), 'bountyPaid가 해시에 없다').not.toBe(h0);
  });

  it('정지 사격 상태 셋이 각각 hash()에 들어간다', () => {
    const fields = ['siegeHoldLeft', 'siegeWalkLeft', 'attackAnimLeft'] as const;
    for (const f of fields) {
      const sim = makeRaidSim(2024);
      let ticked = 0;
      // 정지가 실제로 서 있는 순간까지 돌린다 — 0을 1로 바꾸는 것과 구분되게
      while (ticked++ < 1200) {
        for (const [at, cmd] of RAID_SCRIPT) if (at === ticked - 1) sim.applyCommand(cmd);
        sim.tick();
        sim.drainEvents();
        if (sim.state.enemies.some((e: EnemyState) => e.siegeHoldLeft > 0)) break;
      }
      const target = sim.state.enemies[0];
      expect(target, `${f}: 관측할 적이 있다`).toBeDefined();
      const h0 = sim.hash();
      // siegeWalkLeft는 EnemyState에 없는 내부 필드라 캐스트로 흔든다 (의도된 비공개)
      const obj = target as unknown as Record<string, number>;
      obj[f] = (obj[f] ?? 0) + 1;
      expect(sim.hash(), `${f}가 해시에 없다`).not.toBe(h0);
    }
  });

  it('아군을 뽑아 내보내고 싸우다 죽는 시나리오도 해시 전 구간 일치', () => {
    const a = runAllies(31337);
    const b = runAllies(31337);
    // 시나리오가 실제로 출동·이동 명령·사망을 전부 포함하는지 먼저 확인 (검증이 헛돌지 않게).
    // 귀환(retired)은 9단계에 개념째 사라졌고, 그 자리를 이동 명령이 물려받았다 —
    // 새 커맨드가 한 번도 안 불리면 tgtX/tgtZ/walked가 상수라 해시가 헛돈다
    // 실측: trained 6 · died 6 · ordered 3 (여섯 명 전원이 맞아 죽는다 — 수명은 없다)
    expect(a.trained).toBeGreaterThan(3);
    expect(a.died).toBeGreaterThan(0);
    // 전원 이동 두 번 + 개별 지정 한 번 = 최소 세 번의 allyOrdered
    expect(a.ordered).toBeGreaterThanOrEqual(3);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.hashes.length).toBe(30);
    expect(b.died).toBe(a.died);
    expect(b.ordered).toBe(a.ordered);
  });

  it('채집(캐기·운반·배달·사망·제거)이 섞인 시나리오도 해시 전 구간 일치', () => {
    const a = runGather(9090);
    const b = runGather(9090);
    // ── 시나리오가 실제로 여덟 분기를 밟았는지 먼저 확인 (검증이 헛돌지 않게) ──────
    expect(a.started, '캐기를 시작했다').toBeGreaterThan(0);
    expect(a.gathered, '짐을 실제로 졌다').toBeGreaterThan(0);
    expect(a.delivered, '마을까지 지고 와 지급됐다').toBeGreaterThan(0);
    // 배달이 골드를 내는 **유일한** 사건이다 — 짐값 기준 6 주입이 실제로 먹혔다는 증거
    expect(a.deliveredGold, '지급액이 0이 아니다').toBeGreaterThan(0);
    expect(a.lost.moved, 'E-3 채집 중 다른 칸으로').toBeGreaterThan(0);
    expect(a.lost.cleared, 'E-14 캐던 칸이 골드로 치워졌다').toBeGreaterThan(0);
    expect(a.lost.hit, 'E-11 맞아서 진행분이 0으로').toBeGreaterThan(0);
    expect(a.lost.died, 'E-10 운반 중 사망').toBeGreaterThan(0);
    // ⑤ D1 — 다 캔 칸은 그루터기로 남아 **여전히 건설 불가**이고 제거 비용도 그대로다
    expect(a.takenStillBlocked, '텄음 칸은 여전히 건설 불가다(D1)').toBe(true);
    expect(a.clearCostUnchanged, '채집은 유료 제거 지수를 한 톨도 안 올린다').toBe(true);
    // ── 본론: 전 구간 해시 일치 ────────────────────────────────────────────────
    expect(a.hashes).toEqual(b.hashes);
    expect(a.hashes.length).toBe(28);
    expect(b.finalGold).toBe(a.finalGold);
    expect(b.takenCells).toBe(a.takenCells);
    expect(b.lost).toEqual(a.lost);
  });

  /**
   * 채집 상태 다섯이 **각각** hash()에 반영되는지. 한꺼번에 흔들면 하나만 들어가 있어도
   * 통과하므로 반드시 하나씩 흔든다. 다섯 다 다른 것을 잡는다:
   *  · gatherKey    — 다음 틱에 이 사람이 무엇을 하는가 자체
   *  · gatherTicks  — 순수 누적기. x/z로도 walked로도 복원할 수 없다
   *  · carryGold    — 앞으로 발행될 골드 (v.gold로도 갈리지만 그건 배달 뒤에나 보인다)
   *  · carryCount   — 언제 자동 귀환이 걸리는가 = 앞으로의 동선 전부
   *  · gatherHpMark — 같은 hp라도 시도 시작 시점이 다르면 중단 여부가 갈린다
   * ⚠ `carryGold`/`carryCount`/`gatherHpMark`는 **채집이 실제로 돈 뒤에** 흔든다 —
   *   0을 1로 바꾸는 것과 구분되게(bountyPaid 테스트가 겪은 그 함정이다).
   */
  it('채집 상태 다섯이 각각 hash()에 들어간다', () => {
    const fields = ['gatherKey', 'gatherTicks', 'carryGold', 'carryCount', 'gatherHpMark'] as const;
    for (const f of fields) {
      const sim = createBattle(
        options({
          seed: 5,
          deck: ['spear'],
          // ⚠ **endless가 필수다.** 목 스테이지는 waveCount 2에 빈 웨이브라
          //   240틱 남짓이면 'won'이 되고 tick()이 즉시 return해 **채집도 함께 언다**
          //   (E-12). 그러면 아래 900틱 루프가 짐을 한 번도 못 지고 조용히 실패한다.
          endless: true,
          stage: stageDef({ startGold: 100000 }),
          allyDefs: allyDefs({
            gatherer: { speed: 1.3, blocks: false, gatherPct: 300, carryCap: 2 },
          }),
          waves: [wave([{ count: 0 }])],
        }),
        { gatherBaseValue: 6 },
      );
      expect(sim.applyCommand({ type: 'trainAlly', defId: 'gatherer' })).toBe(true);
      // 가장 가까운 자원 칸으로 보내 **실제로 한 짐을 지고 걸어오는** 상태까지 돌린다
      const cell = sim.state.resources[0];
      expect(cell, '목 스테이지에 자원 칸이 있다').toBeDefined();
      expect(
        sim.applyCommand({
          type: 'moveAlly',
          allyId: -1,
          cellX: (cell as { cellX: number }).cellX,
          cellZ: (cell as { cellZ: number }).cellZ,
        }),
      ).toBe(true);
      let carried = false;
      for (let t = 0; t < 900 && !carried; t++) {
        sim.tick();
        sim.drainEvents();
        carried = sim.state.allies.some((x) => x.carryCount > 0);
      }
      expect(carried, `${f}: 짐을 실제로 진 뒤에 흔든다`).toBe(true);
      const target = sim.state.allies[0];
      expect(target, `${f}: 관측할 아군이 있다`).toBeDefined();
      const h0 = sim.hash();
      // gatherHpMark는 AllyState에 없는 내부 필드라 캐스트로 흔든다 (의도된 비공개)
      const obj = target as unknown as Record<string, number>;
      obj[f] = (obj[f] ?? 0) + 1;
      expect(sim.hash(), `${f}가 해시에 없다`).not.toBe(h0);
    }
  });

  /**
   * 규칙 8) 자동 행동 스위치가 hash()에 들어가는지.
   *
   * **위치로 유도되지 않는 유일한 비트**다: 같은 자리에 같은 짐으로 서 있어도 이 값이
   * 다르면 다음 틱에 일하러 가느냐 서 있느냐가 갈린다. 그리고 `entities.resetAlly`가
   * 이 필드를 안 지우는 회귀는 **여기가 접혀 있을 때만** 결정론 검사에 걸린다.
   */
  it('자동 행동 스위치(autoHold)가 hash()에 들어간다', () => {
    const sim = createBattle(
      options({
        seed: 5,
        deck: ['spear'],
        stage: stageDef({ startGold: 100000 }),
        allyDefs: allyDefs({ gatherer: { speed: 1.3, blocks: false, gatherPct: 300, carryCap: 2 } }),
        waves: [wave([{ count: 0 }])],
      }),
      { gatherBaseValue: 6 },
    );
    expect(sim.applyCommand({ type: 'trainAlly', defId: 'gatherer' })).toBe(true);
    const a = sim.state.allies[0];
    expect(a, '관측할 아군이 있다').toBeDefined();
    const h0 = sim.hash();
    (a as { autoHold: boolean }).autoHold = true;
    expect(sim.hash(), 'autoHold가 해시에 없다').not.toBe(h0);
  });

  /**
   * 자원 밭의 `taken`이 hash()에 들어가는지 — **텄다는 사실 자체**가 상태다.
   * 아군 다섯 필드만 접으면 "짐을 다 진 뒤 그 사람이 죽어 사라진" 판에서 텄음 여부가
   * 해시에서 통째로 빠진다(그 칸은 영영 다시 못 캐는데도).
   */
  it('자원 칸의 taken이 hash()에 들어간다', () => {
    const mk = (): ReturnType<typeof createBattle> =>
      createBattle(
        options({ seed: 5, deck: ['spear'], stage: stageDef({ startGold: 100000 }), waves: [wave([{ count: 0 }])] }),
        { gatherBaseValue: 6 },
      );
    const a = mk();
    const b = mk();
    expect(a.hash()).toBe(b.hash());
    const cell = b.state.resources[0];
    expect(cell, '목 스테이지에 자원 칸이 있다').toBeDefined();
    (cell as { taken: boolean }).taken = true;
    expect(a.hash(), '자원 칸의 taken이 해시에 없다').not.toBe(b.hash());
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

  it('아군 이동·출동과 마을 레벨업을 섞어도 해시 전 구간 일치 (정원이 유도값이라 새 상태가 없다)', () => {
    const a = runMixed(4242);
    const b = runMixed(4242);
    // 시나리오가 실제로 레벨업·출동을 포함하는지 확인
    expect(a.upgrades).toBe(2); // 3레벨 테이블이라 세 번째 호출은 거부된다
    expect(a.trained).toBeGreaterThan(2);
    // 레벨업이 실제로 **정원**을 팔았는지 — 같은 커맨드의 성패가 레벨업을 사이에 두고 뒤집힌다
    expect(a.capBefore, 'Lv1 정원(2명)이 찼으면 출동은 거부돼야 한다').toBe(false);
    expect(a.capAfter, '레벨업(정원 4명) 뒤에는 같은 출동이 통과해야 한다').toBe(true);
    // 이동 명령이 실제로 먹혔는지 — 찍은 칸에 도달한 아군이 있어야 한다
    expect(a.reachedOrder, '명령을 받은 아군이 그 칸에 도달했어야 한다').toBe(true);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.hashes.length).toBe(30);
    expect(b.capBefore).toBe(a.capBefore);
    expect(b.capAfter).toBe(a.capAfter);
  });

  /**
   * 9단계 새 커맨드) **이동 명령 하나만 달라도 해시가 갈라진다.**
   *
   * 위의 섞은 시나리오는 명령을 넣은 채로 돌리므로 "같은 입력 → 같은 해시"만 본다.
   * 그것만으로는 tgtX/tgtZ가 hash()에서 빠져도 통과한다 — 두 판이 똑같이 빠뜨리기 때문이다.
   * 그래서 여기서는 **입력을 하나만 다르게** 해서 갈라지는지를 본다. 아직 한 걸음도
   * 걷지 않은 틱(명령 직후)을 잡는 것이 핵심이다: 그 시점에는 x/z도 walked도 아직
   * 그대로이고 **오직 목표만 다르다**. 목표가 해시에 없으면 이 검사가 곧바로 빨개진다.
   */
  it('이동 명령이 해시에 반영된다 (걷기 전에도 목표만으로 갈라진다)', () => {
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
    for (const s of [a, b]) expect(s.applyCommand({ type: 'trainAlly', defId: 'clubber' })).toBe(true);
    expect(a.hash()).toBe(b.hash());
    // 한 판에만 명령을 준다. 아직 tick()을 돌리지 않았으므로 위치도 walked도 동일하다
    expect(b.applyCommand({ type: 'moveAlly', allyId: -1, cellX: 1, cellZ: 1 })).toBe(true);
    expect(a.hash()).not.toBe(b.hash());
    // 살아 있는 아군이 하나도 없으면 명령은 거부된다 (연출도 나가지 않는다)
    const empty = mk();
    expect(empty.applyCommand({ type: 'moveAlly', allyId: -1, cellX: 1, cellZ: 1 })).toBe(false);
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
