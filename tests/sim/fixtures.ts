/** 시뮬레이션 테스트용 최소 목 정의 생성기 — 실제 밸런스 데이터에 의존하지 않는다. */
import type {
  BattleOptions,
  BattleSim,
  EnemyDef,
  EnemyId,
  SimEvent,
  SpawnGroup,
  StageDef,
  TowerDef,
  TowerId,
  TowerTier,
  WaveDef,
} from '@/data/types';

export const ALL_TOWER_IDS: TowerId[] = [
  'spear',
  'catapult',
  'lightning',
  'brazier',
  'frost',
  'poison',
  'ballista',
  'drum',
];

export const ALL_ENEMY_IDS: EnemyId[] = [
  'raptor',
  'compy',
  'trike',
  'ptera',
  'ankylo',
  'boar',
  'warrior',
  'shaman',
  'mammoth',
  'spino',
  'trex',
  'golem',
];

export function tier(partial?: Partial<TowerTier>): TowerTier {
  return { dmg: 5, cooldownTicks: 30, range: 3, cost: 50, projectileSpeed: 10, ...partial };
}

export function towerDef(id: TowerId, partial?: Partial<TowerDef>): TowerDef {
  return {
    id,
    nameKey: id,
    descKey: id,
    attackKind: 'homing',
    canTargetGround: true,
    canTargetAir: true,
    tiers: [
      tier(),
      tier({ dmg: 8, cost: 40 }),
      tier({ dmg: 12, cost: 60 }),
      tier({ dmg: 18, cost: 90 }),
      tier({ dmg: 26, cost: 140 }),
    ],
    starBonus: { dmgPct: 0.1, ratePct: 0.05 },
    unlock: { type: 'start' },
    starCosts: [
      [10, 5],
      [20, 10],
      [30, 20],
      [40, 40],
      [50, 80],
    ],
    ...partial,
  };
}

export function towerDefs(
  overrides?: Partial<Record<TowerId, Partial<TowerDef>>>,
): Record<TowerId, TowerDef> {
  const out = {} as Record<TowerId, TowerDef>;
  for (const id of ALL_TOWER_IDS) out[id] = towerDef(id, overrides?.[id]);
  return out;
}

export function enemyDef(id: EnemyId, partial?: Partial<EnemyDef>): EnemyDef {
  return {
    id,
    nameKey: id,
    hp: 10,
    speed: 1,
    armor: 0,
    flying: false,
    bounty: 5,
    baseDamage: 1,
    radius: 0.3,
    cost: 1,
    ...partial,
  };
}

export function enemyDefs(
  overrides?: Partial<Record<EnemyId, Partial<EnemyDef>>>,
): Record<EnemyId, EnemyDef> {
  const out = {} as Record<EnemyId, EnemyDef>;
  for (const id of ALL_ENEMY_IDS) out[id] = enemyDef(id, overrides?.[id]);
  return out;
}

export function stageDef(partial?: Partial<StageDef>): StageDef {
  return {
    id: 1,
    nameKey: 's1',
    biome: 'grassland',
    gridW: 10,
    gridH: 5,
    layout: ['oooooooooo', 'oooooooooo', 'oooooooooo', 'oooooooooo', 'oooooooooo'],
    paths: [
      [
        { x: 0, z: 2 },
        { x: 9, z: 2 },
      ],
    ],
    baseCell: { x: 9, z: 2 },
    baseHp: 10,
    startGold: 1000,
    waveCount: 2,
    wavePlan: {
      budgetBase: 10,
      budgetGrowth: 1.1,
      hpBase: 1,
      hpGrowth: 1.05,
      seed: 1,
      allowedEnemies: ['raptor'],
      bossOverrides: {},
    },
    firstClearAmber: 10,
    perWaveAmber: 1,
    ...partial,
  };
}

export function wave(groups: Partial<SpawnGroup>[], goldReward = 10): WaveDef {
  return {
    goldReward,
    groups: groups.map((g) => ({
      enemyId: 'raptor' as EnemyId,
      count: 1,
      intervalTicks: 10,
      delayTicks: 0,
      pathIndex: 0,
      hpMul: 1,
      ...g,
    })),
  };
}

export interface OptionsExtra {
  waves?: WaveDef[];
}

export function options(partial?: Partial<BattleOptions> & OptionsExtra): BattleOptions {
  const waves = partial?.waves ?? [wave([{ count: 1 }])];
  const base: BattleOptions = {
    stage: stageDef(),
    stars: {},
    deck: ['spear'],
    endless: false,
    seed: 42,
    towerDefs: towerDefs(),
    enemyDefs: enemyDefs(),
    waveFor: (w) => waves[Math.min(w, waves.length) - 1] as WaveDef,
  };
  return { ...base, ...partial };
}

/** n틱 진행하며 발생 이벤트를 모두 수집 */
export function runTicks(sim: BattleSim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.tick();
    out.push(...sim.drainEvents());
  }
  return out;
}

/** 특정 타입 이벤트만 필터 */
export function eventsOf<T extends SimEvent['type']>(
  events: SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];
}
