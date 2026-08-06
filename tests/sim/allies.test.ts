/**
 * 아군 부족 유닛 — 마을에서 골드로 뽑아 내보내는 소모품 전력 (src/sim/allies.ts 규칙 1~8).
 * 경제(비용/상한) · 역주행/출격 한계선 · 수명 · 봉쇄(충돌 없는 발 묶기) · 반격 · 타게팅.
 *
 * 목 스테이지: 경로는 z=2 가로줄(x 0→9, 길이 9), 기지 (9,2).
 * ALLY_SORTIE_RANGE 6.0이라 아군의 출격 한계선은 dist 3 = 셀 (3,2)이다.
 */
import { describe, expect, it } from 'vitest';
import type { AllyId, BattleSim, EnemyDef, TowerAttackSpec } from '@/data/types';
import {
  ALLY_BLOCK_CAPACITY,
  ALLY_MAX_ACTIVE,
  ALLY_SORTIE_RANGE,
  allyCostFor,
  enemyBrawlDmgFor,
} from '@/data/balance';
import { createBattle } from '@/sim/battle';
import {
  allyDefs,
  baseLevels,
  enemyDefs,
  eventsOf,
  options,
  runTicks,
  stageDef,
  towerDefs,
  wave,
} from './fixtures';

/** 적을 죽이지 못하는 타워 — 관찰 대상(공성/봉쇄)만 남기려고 화력을 지운다 */
function tinyTier(): { dmg: number; cooldownTicks: number; range: number; cost: number } {
  return { dmg: 0.0001, cooldownTicks: 600, range: 0.2, cost: 50 };
}

interface Opts {
  /** 적 정의 덮어쓰기 (raptor 하나만 쓴다) */
  enemy?: Partial<EnemyDef>;
  /** 적 마릿수 */
  count?: number;
  /** 아군 정의 덮어쓰기 */
  ally?: Partial<Parameters<typeof allyDefs>[0]>;
  gold?: number;
}

function allySim(o: Opts = {}): BattleSim {
  return createBattle(
    options({
      deck: ['spear'],
      stage: stageDef({ startGold: o.gold ?? 100000, baseHp: 9999, waveCount: 3 }),
      enemyDefs: enemyDefs({ raptor: { hp: 1_000_000, ...o.enemy } }),
      towerDefs: towerDefs({ spear: { tiers: Array.from({ length: 5 }, () => tinyTier()) } }),
      allyDefs: allyDefs(o.ally),
      waves: [
        wave([{ enemyId: 'raptor', count: o.count ?? 1, intervalTicks: 0 }]),
        wave([{ enemyId: 'raptor', count: 1, intervalTicks: 0 }]),
      ],
    }),
  );
}

function train(sim: BattleSim, defId: AllyId = 'clubber'): boolean {
  return sim.applyCommand({ type: 'trainAlly', defId });
}

/** 목 스테이지의 소품이 걸리면 먼저 치우고 배치 */
function place(sim: BattleSim, x: number, z: number, handIndex = 0): void {
  if (sim.hasScenery(x, z)) {
    expect(sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z })).toBe(true);
  }
  expect(sim.applyCommand({ type: 'placeTower', handIndex, cellX: x, cellZ: z })).toBe(true);
}

// ---------------------------------------------------------------------------
describe('출동 경제 (규칙 4·8)', () => {
  it('골드가 실제로 빠지고 allyTrained가 나간다', () => {
    const sim = allySim({ gold: 1000 });
    const before = sim.state.gold;
    const cost = sim.allyCost('clubber');
    expect(cost).toBe(50); // 목 정의 기본가, 나가 있는 인원 0
    expect(train(sim)).toBe(true);
    expect(sim.state.gold).toBe(before - cost);
    const ev = eventsOf(sim.drainEvents(), 'allyTrained');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.defId).toBe('clubber');
    expect(ev[0]!.cost).toBe(cost);
    expect(sim.state.allies).toHaveLength(1);
  });

  it('골드가 모자라면 거부되고 아무것도 소비하지 않는다', () => {
    const sim = allySim({ gold: 10 });
    expect(sim.canTrainAlly('clubber')).toBe(false);
    expect(train(sim)).toBe(false);
    expect(sim.state.gold).toBe(10);
    expect(sim.state.allies).toHaveLength(0);
  });

  it('비용은 나가 있는 인원 수에 따라 오르고, 줄면 되돌아온다', () => {
    const sim = allySim();
    const base = sim.allyCost('clubber');
    expect(train(sim)).toBe(true);
    expect(sim.allyCost('clubber')).toBe(allyCostFor(base, 1));
    expect(sim.allyCost('clubber')).toBeGreaterThan(base);
    expect(train(sim)).toBe(true);
    expect(sim.allyCost('clubber')).toBe(allyCostFor(base, 2));
    // 인원이 줄면(수명 만료) 비용도 되돌아온다 — 소모품다운 경제
    runTicks(sim, 700);
    expect(sim.state.allies).toHaveLength(0);
    expect(sim.allyCost('clubber')).toBe(base);
  });

  it('동시 상한에서 생산이 막힌다 (골드가 남아도)', () => {
    const sim = allySim();
    for (let i = 0; i < ALLY_MAX_ACTIVE; i++) expect(train(sim)).toBe(true);
    expect(sim.state.allies).toHaveLength(ALLY_MAX_ACTIVE);
    expect(sim.state.allyCap).toBe(ALLY_MAX_ACTIVE);
    expect(sim.state.gold).toBeGreaterThan(sim.allyCost('clubber')); // 돈은 남아 있다
    expect(sim.canTrainAlly('clubber')).toBe(false);
    expect(train(sim)).toBe(false);
    expect(sim.state.allies).toHaveLength(ALLY_MAX_ACTIVE);
  });

  it('상한이 풀리면 (한 명이 돌아가면) 다시 뽑을 수 있다', () => {
    const sim = allySim({ ally: { clubber: { lifeTicks: 60 } } });
    for (let i = 0; i < ALLY_MAX_ACTIVE; i++) expect(train(sim)).toBe(true);
    expect(train(sim)).toBe(false);
    runTicks(sim, 61);
    expect(sim.state.allies).toHaveLength(0);
    expect(train(sim)).toBe(true);
  });

  it('전투가 끝나면 출동할 수 없다', () => {
    const sim = allySim();
    (sim.state as { phase: string }).phase = 'lost';
    expect(sim.canTrainAlly('clubber')).toBe(false);
    expect(train(sim)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('역주행과 출격 한계선 (규칙 1·2)', () => {
  it('기지에서 스폰해 경로를 거꾸로 걷는다', () => {
    const sim = allySim();
    train(sim);
    const a0 = sim.state.allies[0]!;
    // 기지 = (9,2) = 경로 끝
    expect(a0.x).toBeCloseTo(9, 5);
    expect(a0.z).toBeCloseTo(2, 5);
    const start = a0.dist;
    runTicks(sim, 60);
    const a1 = sim.state.allies[0]!;
    expect(a1.dist).toBeLessThan(start); // 거꾸로
    expect(a1.x).toBeLessThan(9);
    expect(a1.z).toBeCloseTo(2, 5); // 경로 위를 벗어나지 않는다
  });

  it('출격 한계선에서 멈춰 선다 (적 스폰까지 걸어가지 않는다)', () => {
    const sim = allySim();
    train(sim);
    const total = 9; // 목 경로 길이
    runTicks(sim, 400); // 6타일을 걷는 데 180틱이면 충분하고도 남는다
    const a = sim.state.allies[0]!;
    expect(a.dist).toBeCloseTo(total - ALLY_SORTIE_RANGE, 5);
    expect(a.holdDist).toBeCloseTo(total - ALLY_SORTIE_RANGE, 5);
    expect(a.x).toBeCloseTo(3, 5);
  });

  it('여럿이 나가면 한 점에 겹치지 않고 줄을 선다 (충돌 없는 게임의 대안)', () => {
    const sim = allySim();
    for (let i = 0; i < ALLY_MAX_ACTIVE; i++) expect(train(sim)).toBe(true);
    // 슬롯은 0..cap-1이 정확히 한 번씩
    expect(sim.state.allies.map((a) => a.slot).sort((p, q) => p - q)).toEqual(
      Array.from({ length: ALLY_MAX_ACTIVE }, (_, i) => i),
    );
    runTicks(sim, 400);
    const xs = sim.state.allies.map((a) => Math.round(a.x * 1000) / 1000);
    expect(new Set(xs).size).toBe(ALLY_MAX_ACTIVE); // 좌표가 전부 다르다
    // 맨 앞은 한계선, 뒤로 갈수록 기지 쪽 (경로가 +x 방향이라 x가 커진다)
    const sorted = [...sim.state.allies].sort((p, q) => p.slot - q.slot);
    expect(sorted[0]!.holdDist).toBeCloseTo(9 - ALLY_SORTIE_RANGE, 5);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.holdDist).toBeGreaterThan(sorted[i - 1]!.holdDist);
    }
  });

  /**
   * 규칙 2) 한계선은 마을 레벨의 함수다 — 이 묶음이 **6단계에서 산 것**을 잠근다.
   * 목 테이블의 sortie를 Lv1 6.0 / Lv2 8.0으로 두고 잰다 (실제 곡선 값과 무관하게
   * "레벨이 올라가면 더 나간다"만 본다 — 곡선의 실제 다섯 숫자는 여기 박지 않는다).
   *
   * 경로를 20타일로 늘린 이유(기본 픽스처는 9타일): 규칙 2-c의 경로 길이 상한이
   * `max(6.0, 경로×0.5)`라 9타일 경로에서는 상한이 6.0에 걸려 Lv2의 8.0이 6.0으로 깎인다.
   * 그러면 이 묶음이 재려던 "레벨업하면 더 나간다"가 아니라 상한 규칙을 재게 된다.
   * 20타일이면 상한이 10.0이라 6.0도 8.0도 깎이지 않는다 — 상한 자체는 아래
   * '경로가 짧으면…' 항목에서 따로 잰다.
   */
  const LEVEL_PATH_LEN = 20;

  function levelSim(spawnDelay = 100000): BattleSim {
    return createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({
          startGold: 100000,
          baseHp: 9999,
          waveCount: 3,
          gridW: LEVEL_PATH_LEN + 1,
          layout: Array.from({ length: 5 }, () => 'o'.repeat(LEVEL_PATH_LEN + 1)),
          paths: [[{ x: 0, z: 2 }, { x: LEVEL_PATH_LEN, z: 2 }]],
          baseCell: { x: LEVEL_PATH_LEN, z: 2 },
        }),
        enemyDefs: enemyDefs({ raptor: { hp: 1_000_000 } }),
        towerDefs: towerDefs({ spear: { tiers: Array.from({ length: 5 }, () => tinyTier()) } }),
        allyDefs: allyDefs(),
        baseLevels: baseLevels([{ sortie: 6 }, { sortie: 8 }, { sortie: 8 }]),
        // 기본은 적을 내보내지 않는다(delay가 크다) — 걷는 거리만 재는 실험이라
        // prep이 저절로 끝나 스폰된 적이 아군을 붙잡으면 무엇을 쟀는지 알 수 없어진다
        waves: [
          wave([{ enemyId: 'raptor', count: 1, intervalTicks: 0, delayTicks: spawnDelay }]),
        ],
      }),
    );
  }

  it('마을 레벨이 오르면 한계선이 멀어진다 (다음 출동)', () => {
    const sim = levelSim();
    expect(sim.allySortieRange()).toBe(6);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(sim.allySortieRange()).toBe(8);
    train(sim);
    runTicks(sim, 300); // 8타일 = 240틱 (수명 600틱 안)
    // 목 경로 길이 20 — Lv2면 dist 12 = 셀 (12,2)까지 나간다 (Lv1이면 14)
    expect(sim.state.allies[0]!.dist).toBeCloseTo(LEVEL_PATH_LEN - 8, 5);
    expect(sim.state.allies[0]!.x).toBeCloseTo(12, 5);
  });

  it('규칙 2-b) 이미 나가 있는 아군도 레벨업 즉시 더 나아간다', () => {
    const sim = levelSim();
    train(sim);
    runTicks(sim, 200);
    const a = sim.state.allies[0]!;
    expect(a.dist).toBeCloseTo(LEVEL_PATH_LEN - 6, 5); // Lv1 한계선에 멈춰 있다
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    // 레벨업 그 틱에 목표가 갱신되고(유도값), 이후 계속 걸어 나간다
    runTicks(sim, 1);
    expect(sim.state.allies[0]!.holdDist).toBeCloseTo(LEVEL_PATH_LEN - 8, 5);
    runTicks(sim, 100);
    expect(sim.state.allies[0]!.dist).toBeCloseTo(LEVEL_PATH_LEN - 8, 5);
    expect(sim.state.allies[0]!.x).toBeCloseTo(12, 5);
  });

  it('규칙 2-b) 대기 슬롯 간격은 새 한계선을 기준으로 다시 깔린다', () => {
    const sim = levelSim();
    for (let i = 0; i < ALLY_MAX_ACTIVE; i++) expect(train(sim)).toBe(true);
    runTicks(sim, 200);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    runTicks(sim, 100);
    const sorted = [...sim.state.allies].sort((p, q) => p.slot - q.slot);
    // 줄 전체가 통째로 앞으로 옮겨졌고, 줄 모양(0.5타일 간격)은 그대로다
    expect(sorted[0]!.dist).toBeCloseTo(LEVEL_PATH_LEN - 8, 5);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.dist - (sorted[i - 1] as { dist: number }).dist).toBeCloseTo(0.5, 5);
    }
  });

  it('교전 중인 근접 아군은 레벨업으로도 앞으로 가지 않는다 (붙잡은 적을 놓지 않는다)', () => {
    const sim = levelSim(0);
    sim.applyCommand({ type: 'callWave' });
    train(sim);
    runTicks(sim, 400); // 한계선에서 적을 붙잡고 교전 중
    const a = sim.state.allies[0]!;
    expect(a.targetId).toBeGreaterThanOrEqual(0);
    const held = a.dist;
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    runTicks(sim, 60);
    const after = sim.state.allies[0]!;
    expect(after.targetId).toBeGreaterThanOrEqual(0);
    expect(after.dist).toBeCloseTo(held, 5); // 그 자리에 그대로 서 있다
  });

  it('출격 지점 조회가 경로마다 실제 정지 지점을 준다 (화면 표식의 출처)', () => {
    const sim = levelSim();
    const p0 = sim.allySortiePoints();
    expect(p0).toHaveLength(1);
    expect(p0[0]!.x).toBeCloseTo(LEVEL_PATH_LEN - 6, 5);
    expect(p0[0]!.z).toBeCloseTo(2, 5);
    sim.applyCommand({ type: 'upgradeBase' });
    expect(sim.allySortiePoints()[0]!.x).toBeCloseTo(LEVEL_PATH_LEN - 8, 5);
    // 실제로 걸어간 아군이 그 지점에 선다 — 표식과 규칙이 같은 출처를 쓴다
    train(sim);
    runTicks(sim, 300);
    expect(sim.state.allies[0]!.x).toBeCloseTo(sim.allySortiePoints()[0]!.x, 5);
  });

  /**
   * 규칙 2-c) 경로가 짧으면 표의 값을 다 쓰지 못한다 (balance.ALLY_SORTIE_PATH_LIMIT).
   * 표의 값이 절대 타일 수라, 상한이 없으면 짧은 경로에서 만렙 아군이 스폰 앞까지 걸어가
   * 규칙 2가 막으려던 입구 요격이 그대로 일어난다.
   */
  function limitSim(pathLen: number, sortie: number): BattleSim {
    return createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({
          startGold: 100000,
          baseHp: 9999,
          waveCount: 3,
          gridW: pathLen + 1,
          layout: Array.from({ length: 5 }, () => 'o'.repeat(pathLen + 1)),
          paths: [[{ x: 0, z: 2 }, { x: pathLen, z: 2 }]],
          baseCell: { x: pathLen, z: 2 },
        }),
        enemyDefs: enemyDefs({ raptor: { hp: 1_000_000 } }),
        towerDefs: towerDefs({ spear: { tiers: Array.from({ length: 5 }, () => tinyTier()) } }),
        allyDefs: allyDefs(),
        baseLevels: baseLevels([{ sortie }, { sortie }, { sortie }]),
        waves: [wave([{ enemyId: 'raptor', count: 1, intervalTicks: 0, delayTicks: 100000 }])],
      }),
    );
  }

  it('규칙 2-c) 경로가 짧으면 한계선이 경로 절반으로 깎인다 (입구 요격 금지)', () => {
    // 경로 24 → 상한 12.0이라 표의 20이 12로 깎인다. 아군은 경로의 마을 쪽 절반 안에 선다
    const sim = limitSim(24, 20);
    expect(sim.allySortieRange()).toBeCloseTo(12, 5);
    train(sim);
    runTicks(sim, 500); // 12타일 = 313틱 (수명 600틱 안)
    const a = sim.state.allies[0]!;
    expect(a.dist).toBeCloseTo(12, 5); // 스폰까지 절반이 남는다
    // 표식도 같은 값을 쓴다 — 화면과 규칙이 갈라질 자리가 없다
    expect(sim.allySortiePoints()[0]!.x).toBeCloseTo(12, 5);
  });

  it('규칙 2-c) 상한은 표의 값보다 크면 아무 일도 하지 않는다', () => {
    // 경로 40 → 상한 20.0. 표의 12는 그대로 나간다 (긴 경로 스테이지)
    const sim = limitSim(40, 12);
    expect(sim.allySortieRange()).toBeCloseTo(12, 5);
  });

  it('규칙 2-c) Lv1 6.0은 어떤 경로에서도 깎이지 않는다 (모든 기준선의 원점)', () => {
    // 경로 9 → 절반은 4.5지만 하한 ALLY_SORTIE_RANGE가 6.0을 지킨다
    const sim = limitSim(9, ALLY_SORTIE_RANGE);
    expect(sim.allySortieRange()).toBeCloseTo(ALLY_SORTIE_RANGE, 5);
  });

  it('앞줄이 빠지면 다음 출동이 그 자리를 메운다 (줄에 구멍이 남지 않는다)', () => {
    const sim = allySim();
    for (let i = 0; i < 3; i++) expect(train(sim)).toBe(true);
    const front = sim.state.allies.find((a) => a.slot === 0)!;
    (front as { hp: number }).hp = 0;
    (front as { alive: boolean }).alive = false;
    runTicks(sim, 1); // 사망 회수
    expect(sim.state.allies.some((a) => a.slot === 0)).toBe(false);
    expect(train(sim)).toBe(true);
    expect(sim.state.allies.filter((a) => a.slot === 0)).toHaveLength(1);
  });

  it('진행 방향(heading)이 적과 반대다', () => {
    const sim = allySim();
    train(sim);
    runTicks(sim, 30);
    const a = sim.state.allies[0]!;
    // 경로는 +x 방향(heading 0)이라 아군은 π를 본다
    expect(Math.cos(a.heading)).toBeCloseTo(-1, 5);
  });

  it('경로가 여럿이면 기지에 가장 가까운 적이 있는 쪽으로 나간다', () => {
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({
          startGold: 100000,
          baseHp: 9999,
          paths: [
            [
              { x: 0, z: 1 },
              { x: 9, z: 1 },
            ],
            [
              { x: 0, z: 3 },
              { x: 9, z: 3 },
            ],
          ],
        }),
        enemyDefs: enemyDefs({ raptor: { hp: 1_000_000, speed: 1 } }),
        towerDefs: towerDefs({ spear: { tiers: Array.from({ length: 5 }, () => tinyTier()) } }),
        // 1번 경로 적이 먼저(delay 0), 0번 경로 적은 한참 뒤에 나온다 → 1번이 더 급하다
        waves: [
          wave([
            { enemyId: 'raptor', count: 1, intervalTicks: 0, pathIndex: 1 },
            { enemyId: 'raptor', count: 1, intervalTicks: 0, pathIndex: 0, delayTicks: 600 },
          ]),
        ],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 60);
    expect(train(sim)).toBe(true);
    expect(sim.state.allies[0]!.pathIndex).toBe(1);
  });

  it('경로를 명시하면 그 경로로 나간다', () => {
    const sim = allySim();
    expect(sim.applyCommand({ type: 'trainAlly', defId: 'clubber', pathIndex: 0 })).toBe(true);
    expect(sim.state.allies[0]!.pathIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('수명 (규칙 3)', () => {
  it('수명이 다하면 마을로 돌아간다 (allyRetired, 사망 아님)', () => {
    const sim = allySim({ ally: { clubber: { lifeTicks: 45 } } });
    train(sim);
    const evs = runTicks(sim, 60);
    const retired = eventsOf(evs, 'allyRetired');
    expect(retired).toHaveLength(1);
    expect(retired[0]!.defId).toBe('clubber');
    expect(eventsOf(evs, 'allyDied')).toHaveLength(0);
    expect(sim.state.allies).toHaveLength(0);
  });

  it('수명은 prep에서도 흐른다 (미리 쟁여 둘 수 없다)', () => {
    const sim = allySim();
    train(sim);
    expect(sim.state.phase).toBe('prep');
    const life0 = sim.state.allies[0]!.lifeLeft;
    runTicks(sim, 30);
    expect(sim.state.phase).toBe('prep');
    expect(sim.state.allies[0]!.lifeLeft).toBe(life0 - 30);
  });
});

// ---------------------------------------------------------------------------
describe('봉쇄 — 충돌 없이 발을 묶는다 (규칙 5)', () => {
  it('근접 아군이 적의 전진을 멈춘다', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200); // 두 유닛이 마주쳐 교전에 들어가고도 남는 시간
    const e = sim.state.enemies[0]!;
    expect(e.blockerAllyId).toBeGreaterThanOrEqual(0);
    const stuckAt = e.dist;
    runTicks(sim, 60);
    expect(sim.state.enemies[0]!.dist).toBe(stuckAt); // 2초가 지나도 그 자리
  });

  it('아군이 사라지면 봉쇄가 풀리고 적이 다시 전진한다', () => {
    const sim = allySim({ enemy: { speed: 1 }, ally: { clubber: { lifeTicks: 240 } } });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200);
    expect(sim.state.enemies[0]!.blockerAllyId).toBeGreaterThanOrEqual(0);
    const stuckAt = sim.state.enemies[0]!.dist;
    runTicks(sim, 120); // 수명 만료
    expect(sim.state.allies).toHaveLength(0);
    expect(sim.state.enemies[0]!.blockerAllyId).toBe(-1);
    expect(sim.state.enemies[0]!.dist).toBeGreaterThan(stuckAt);
  });

  it('원거리 아군은 아무도 막지 못하고 걸으면서 쏜다', () => {
    const sim = allySim({
      enemy: { speed: 1 },
      ally: { slinger: { blocks: false, range: 3, dmg: 1 } },
    });
    train(sim, 'slinger');
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 200);
    expect(eventsOf(evs, 'allyAttacked').length).toBeGreaterThan(0);
    const e = sim.state.enemies[0]!;
    expect(e.blockerAllyId).toBe(-1);
    const d0 = e.dist;
    runTicks(sim, 30);
    expect(sim.state.enemies[0]!.dist).toBeGreaterThan(d0); // 계속 전진한다
  });

  it('공중 적은 봉쇄되지 않는다 (근접 아군은 아예 조준도 못 한다)', () => {
    const sim = allySim({ enemy: { speed: 1, flying: true } });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 250);
    // 공중 레인은 스폰→기지 직선이라 경로 위를 그대로 지난다 — 그래도 잡히지 않아야 한다
    for (const e of sim.state.enemies) expect(e.blockerAllyId).toBe(-1);
    expect(sim.state.allies[0]!.targetId).toBe(-1);
  });

  /**
   * 규칙 5-b) 한 명이 여러 마리를 막는다 — 단, ALLY_BLOCK_CAPACITY까지만.
   * 1마리 고정이던 시절 아군이 왜 어떤 수치로도 무의미했는지는 balance.ALLY_BLOCK_CAPACITY 주석.
   * 여기서는 **상한이 실제로 걸리는지**를 본다: 정원보다 많은 적을 붙여도 초과분은 통과한다.
   */
  it('근접 아군 하나가 정원만큼 붙잡고, 그 이상은 못 붙잡는다', () => {
    const over = ALLY_BLOCK_CAPACITY + 2;
    // hp를 크게 준다 — 정원만큼 붙잡으면 그만큼 난투를 겹쳐 맞아 기본 체력으로는
    // 관측 전에 쓰러진다(그 자체가 규칙 5-b의 대가이고, 아래 별도 항목으로 잠근다)
    const sim = allySim({ enemy: { speed: 1 }, count: over, ally: { clubber: { hp: 1_000_000 } } });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200);
    const id = sim.state.allies[0]!.id;
    const held = sim.state.enemies.filter((e) => e.blockerAllyId === id).length;
    expect(held).toBe(ALLY_BLOCK_CAPACITY);
    // 초과분은 붙잡히지 않았다 = 한 명이 웨이브 전체를 세우지 못한다
    expect(sim.state.enemies.filter((e) => e.blockerAllyId < 0).length).toBeGreaterThan(0);
  });

  /**
   * 규칙 6-b) 앞줄이 맡은 적을 뒷줄이 또 고르지 않는다.
   * 이 단서가 없으면 최근접+고정 타깃 규약이 반대로 작동해 여섯이 한 마리에 달라붙는다
   * (실측: 6명 봉쇄 효율 0.63 → 0.27로 붕괴 — src/sim/allies.ts 규칙 6-b 주석).
   */
  it('아군 둘은 서로 다른 적을 맡는다 (겹쳐 잡지 않는다)', () => {
    const sim = allySim({ enemy: { speed: 1 }, count: 4, ally: { clubber: { hp: 1_000_000 } } });
    train(sim);
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200);
    const ids = sim.state.allies.map((a) => a.id);
    expect(ids).toHaveLength(2);
    const held = ids.map((id) => sim.state.enemies.filter((e) => e.blockerAllyId === id).length);
    // 둘 다 제 몫을 잡고 있다 — 한쪽이 0이면 겹쳐 잡았다는 뜻
    for (const h of held) expect(h).toBeGreaterThan(0);
    // 한 적이 두 아군에게 동시에 걸리는 일은 없다 (blockerAllyId는 하나뿐)
    const blocked = sim.state.enemies.filter((e) => e.blockerAllyId >= 0);
    expect(blocked.length).toBe(held[0]! + held[1]!);
  });

  /**
   * 규칙 5-b의 대가 — 넓게 막을수록 빨리 죽는다. 이게 없으면 정원 확대가 순이득이라
   * "많이 붙잡는다"가 공짜가 된다(무제한 봉쇄 실험에서 한 명이 웨이브를 영구히 세웠다).
   */
  it('많이 붙잡을수록 난투를 겹쳐 맞아 빨리 쓰러진다', () => {
    const hpAfter = (count: number): number => {
      const sim = allySim({ enemy: { speed: 1 }, count, ally: { clubber: { hp: 1_000_000 } } });
      train(sim);
      sim.applyCommand({ type: 'callWave' });
      runTicks(sim, 400);
      return sim.state.allies[0]!.hp;
    };
    // 정원(3)만큼 붙으면 한 마리일 때보다 확실히 더 깎여 있다
    expect(1_000_000 - hpAfter(ALLY_BLOCK_CAPACITY)).toBeGreaterThan(1_000_000 - hpAfter(1));
  });

  it('여럿이 붙어도 반격 대상은 가장 낮은 id 하나뿐이다', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    train(sim);
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 220);
    const e = sim.state.enemies[0]!;
    expect(e.blockerAllyId).toBeGreaterThanOrEqual(0);
    const ids = sim.state.allies.map((a) => a.id).sort((p, q) => p - q);
    expect(e.blockerAllyId).toBe(ids[0]);
  });
});

// ---------------------------------------------------------------------------
describe('전투 (규칙 5·6)', () => {
  it('아군이 적을 때리고 enemyDamaged의 출처가 아군 종이다', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 220);
    const hits = eventsOf(evs, 'allyAttacked');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.ranged).toBe(false);
    const dmg = eventsOf(evs, 'enemyDamaged').filter((d) => d.source === 'clubber');
    expect(dmg.length).toBeGreaterThan(0);
  });

  it('발이 묶인 적은 아군을 반격한다 (난투)', () => {
    const sim = allySim({ enemy: { speed: 1, cost: 20 } });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 260);
    const hurt = eventsOf(evs, 'allyDamaged');
    expect(hurt.length).toBeGreaterThan(0);
    expect(hurt[0]!.amount).toBe(enemyBrawlDmgFor(20));
    expect(hurt[0]!.attackerDefId).toBe('raptor');
    expect(sim.state.allies[0]!.hp).toBeLessThan(sim.state.allies[0]!.maxHp);
  });

  it('EnemyDef.brawl이 있으면 유도값 대신 그 수치를 쓴다', () => {
    const sim = allySim({ enemy: { speed: 1, brawl: { dmg: 7, cooldownTicks: 30 } } });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    const hurt = eventsOf(runTicks(sim, 260), 'allyDamaged');
    expect(hurt.length).toBeGreaterThan(0);
    for (const h of hurt) expect(h.amount).toBe(7);
  });

  it('아군은 죽을 수 있다 (allyDied → 회수 → 상한 복구)', () => {
    const sim = allySim({
      enemy: { speed: 1, brawl: { dmg: 500, cooldownTicks: 10 } },
      ally: { clubber: { hp: 60 } },
    });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    const evs = runTicks(sim, 300);
    expect(eventsOf(evs, 'allyDied')).toHaveLength(1);
    expect(eventsOf(evs, 'allyRetired')).toHaveLength(0);
    expect(sim.state.allies).toHaveLength(0);
  });

  it('아군의 armor가 난투 피해를 깎는다 (최소 1은 들어간다)', () => {
    const sim = allySim({
      enemy: { speed: 1, brawl: { dmg: 10, cooldownTicks: 30 } },
      ally: { clubber: { armor: 4 } },
    });
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    const hurt = eventsOf(runTicks(sim, 260), 'allyDamaged');
    expect(hurt.length).toBeGreaterThan(0);
    for (const h of hurt) expect(h.amount).toBe(6);
  });

  it('스턴에 걸린 적은 반격하지 못한다', () => {
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ startGold: 100000, baseHp: 9999 }),
        enemyDefs: enemyDefs({
          raptor: { hp: 1_000_000, speed: 1, brawl: { dmg: 20, cooldownTicks: 10 } },
        }),
        // 경로 전체를 덮는 100% 스턴기 — 피해는 없고 붙잡아 두기만 한다
        towerDefs: towerDefs({
          spear: {
            tiers: Array.from({ length: 5 }, () => ({
              dmg: 0.0001,
              cooldownTicks: 10,
              range: 9,
              cost: 50,
              projectileSpeed: 30,
              status: { kind: 'stun' as const, magnitude: 0, durationTicks: 90, chance: 1 },
            })),
          },
        }),
        allyDefs: allyDefs(),
        waves: [wave([{ enemyId: 'raptor', count: 1, intervalTicks: 0 }])],
      }),
    );
    place(sim, 5, 0);
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    // 스턴 때문에 적이 전진하지 못하므로 아군이 걸어와 붙는다
    const evs = runTicks(sim, 400);
    expect(eventsOf(evs, 'allyDamaged')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('봉쇄된 적은 타워를 때리지 않는다 (siege.ts 규칙 1-b)', () => {
  /** 근접 습격대 — 붙잡히지 않으면 타워를 두들긴다 */
  const RAID: TowerAttackSpec = {
    dmg: 20,
    range: 1.6,
    cooldownTicks: 20,
    stopToAttack: true,
    ranged: false,
  };

  /**
   * 아군을 낼지 말지만 다른 통제 실험.
   * total = 타워가 받은 총 피해, whileBlocked = **봉쇄가 서 있던 틱에** 받은 피해,
   * blockedTicks = 봉쇄가 유지된 틱 수.
   */
  function towerDamageWith(
    useAlly: boolean,
    towerX: number,
  ): { total: number; whileBlocked: number; blockedTicks: number; destroyTick: number } {
    const sim = allySim({ enemy: { speed: 1, towerAttack: RAID, cost: 20 } });
    place(sim, towerX, 1);
    if (useAlly) expect(train(sim)).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    let total = 0;
    let whileBlocked = 0;
    let blockedTicks = 0;
    let destroyTick = -1;
    for (let i = 0; i < 900; i++) {
      sim.tick();
      let tickDmg = 0;
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'towerDamaged') tickDmg += ev.amount;
        else if (ev.type === 'towerDestroyed' && destroyTick < 0) destroyTick = i;
      }
      total += tickDmg;
      // blockerAllyId는 이번 틱의 updateAllies가 세운 값이고 다음 틱까지 유지된다 —
      // 즉 "이번 틱에 봉쇄되어 있었는가"를 그대로 읽을 수 있다
      if (sim.state.enemies.some((e) => e.blockerAllyId >= 0)) {
        blockedTicks++;
        whileBlocked += tickDmg;
      }
    }
    return { total, whileBlocked, blockedTicks, destroyTick };
  }

  it('봉쇄가 서 있는 동안 타워는 한 대도 맞지 않는다', () => {
    const guarded = towerDamageWith(true, 5);
    expect(guarded.blockedTicks).toBeGreaterThan(30); // 봉쇄가 실제로 성립했다
    expect(guarded.whileBlocked).toBe(0); // 그동안 타워는 정확히 무사하다
  });

  /**
   * 아군이 파는 것은 **피해량이 아니라 시간**이다.
   * 습격대의 총 화력이 타워 HP를 넘는 이상 타워는 결국 부서진다(둘 다 260을 다 맞는다).
   * 아군 한 명이 바꾸는 건 "언제 부서지는가"이고, 그 시간이 곧 타워가 더 쏜 시간이다.
   */
  it('아군은 타워의 수명을 산다 (파괴 시점이 뒤로 밀린다)', () => {
    const alone = towerDamageWith(false, 5);
    const guarded = towerDamageWith(true, 5);
    expect(alone.destroyTick).toBeGreaterThan(0); // 통제군은 실제로 타워를 부순다
    expect(guarded.destroyTick).toBeGreaterThan(alone.destroyTick);
    // 목 아군(hp 100) 하나가 난투(11/1초)에 버티는 시간만큼이 그대로 이득이다
    expect(guarded.destroyTick - alone.destroyTick).toBeGreaterThan(200);
  });

  /**
   * 봉쇄는 **영구가 아니다** — 아군이 쓰러지면 적은 하던 일로 돌아간다.
   * 이게 스톨(무한 교착)이 나지 않는다는 실증이기도 하다 (allies.ts 헤더 참조).
   */
  it('아군이 쓰러지면 적은 다시 타워를 때린다', () => {
    const guarded = towerDamageWith(true, 5);
    // 900틱 중 봉쇄는 일부 구간뿐 — 아군(hp 100)이 난투(11/1초)에 쓰러진 뒤가 있다
    expect(guarded.blockedTicks).toBeLessThan(900);
    expect(guarded.destroyTick).toBeGreaterThan(0);
  });

  /**
   * 출격 한계선(규칙 2)의 대가를 명시적으로 잠근다.
   * 경로 초입에 지은 타워는 아군이 **닿지 못하는** 곳에서 두들겨 맞는다.
   * 이건 버그가 아니라 규칙 2가 사려는 것의 뒷면이다 — 아군은 마을 앞을 지키는 전력이지
   * 맵 전체의 소방수가 아니고, 그래야 "타워를 어디에 짓는가"가 계속 의미를 갖는다.
   */
  it('출격 한계선 밖(경로 초입)의 타워는 아군이 구하지 못한다', () => {
    const alone = towerDamageWith(false, 1);
    const guarded = towerDamageWith(true, 1);
    expect(alone.total).toBeGreaterThan(0);
    expect(guarded.total).toBe(alone.total); // 아군이 있으나 없으나 똑같이 맞는다
  });

  it('봉쇄 중에는 towerTargetId가 풀린다', () => {
    const sim = allySim({ enemy: { speed: 1, towerAttack: RAID, cost: 20 } });
    place(sim, 4, 1);
    train(sim);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 220);
    const e = sim.state.enemies[0]!;
    expect(e.blockerAllyId).toBeGreaterThanOrEqual(0);
    expect(e.towerTargetId).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
describe('해시 반영', () => {
  it('아군 상태가 hash()에 들어간다 (체력·수명·타깃 각각)', () => {
    const mk = (): BattleSim => {
      const s = allySim();
      expect(s.applyCommand({ type: 'trainAlly', defId: 'clubber' })).toBe(true);
      runTicks(s, 30);
      return s;
    };
    const a = mk();
    const b = mk();
    expect(a.hash()).toBe(b.hash());

    const mutate = (fn: (x: { hp: number; lifeLeft: number; targetId: number }) => void): number => {
      const s = mk();
      fn(s.state.allies[0] as unknown as { hp: number; lifeLeft: number; targetId: number });
      return s.hash();
    };
    expect(mutate((x) => (x.hp -= 1))).not.toBe(a.hash());
    expect(mutate((x) => (x.lifeLeft -= 1))).not.toBe(a.hash());
    expect(mutate((x) => (x.targetId = 99))).not.toBe(a.hash());
  });

  it('적의 봉쇄 상태가 hash()에 들어간다', () => {
    const sim = allySim({ enemy: { speed: 1 } });
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 30);
    const h0 = sim.hash();
    (sim.state.enemies[0] as { blockerAllyId: number }).blockerAllyId = 7;
    expect(sim.hash()).not.toBe(h0);
  });
});
