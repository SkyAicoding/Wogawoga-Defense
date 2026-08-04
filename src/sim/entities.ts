/**
 * 엔티티 저장소 — DenseList + Pool 기반 풀 관리, id 발급.
 * EnemySim은 EnemyState에 def 참조/스턴 면역 등 내부 필드를 더한 확장이며
 * BattleStateView에는 EnemyState로 그대로 노출된다 (매 틱 새 객체 생성 금지).
 */
import { DenseList, Pool } from '@/core/pool';
import type { Rng } from '@/core/rng';
import type {
  BattleOptions,
  BattleStateView,
  EnemyDef,
  EnemyState,
  ProjectileState,
  SimEvent,
  TowerState,
} from '@/data/types';
import type { BattlePath } from './path';

export interface EnemySim extends EnemyState {
  def: EnemyDef;
  /** 보스 스턴 종료 후 면역이 끝나는 틱 */
  stunImmuneUntil: number;
}

function makeEnemy(): EnemySim {
  return {
    id: 0,
    defId: 'raptor',
    hp: 1,
    maxHp: 1,
    shieldHitsLeft: 0,
    dist: 0,
    pathIndex: 0,
    flying: false,
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    heading: 0,
    statuses: [],
    bounty: 0,
    baseDamage: 0,
    radius: 0.3,
    alive: true,
    hpMul: 1,
    def: null as unknown as EnemyDef, // 스폰 시 반드시 채워짐
    stunImmuneUntil: -1,
  };
}

function resetEnemy(e: EnemySim): void {
  e.statuses.length = 0;
  e.alive = true;
  e.stunImmuneUntil = -1;
  e.dist = 0;
  e.shieldHitsLeft = 0;
}

function makeProjectile(): ProjectileState {
  return {
    id: 0,
    kind: 'homing',
    towerDefId: 'spear',
    x: 0,
    y: 0,
    z: 0,
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    targetId: -1,
    targetX: 0,
    targetZ: 0,
    flightTicks: 0,
    elapsedTicks: 0,
    startX: 0,
    startZ: 0,
    arcHeight: 0,
    speed: 0,
    dmg: 0,
    targetFlying: false,
    alive: true,
  };
}

function resetProjectile(p: ProjectileState): void {
  p.alive = true;
  p.targetId = -1;
  p.flightTicks = 0;
  p.elapsedTicks = 0;
  p.splash = undefined;
  p.status = undefined;
}

export class World {
  readonly enemies = new DenseList<EnemySim>();
  readonly towers = new DenseList<TowerState>();
  readonly projectiles = new DenseList<ProjectileState>();
  private readonly enemyById = new Map<number, EnemySim>();
  private nextId = 1;
  private readonly enemyPool = new Pool<EnemySim>(makeEnemy, resetEnemy, 32);
  private readonly projPool = new Pool<ProjectileState>(makeProjectile, resetProjectile, 32);

  newId(): number {
    return this.nextId++;
  }

  acquireEnemy(): EnemySim {
    const e = this.enemyPool.acquire();
    e.id = this.newId();
    this.enemies.add(e);
    this.enemyById.set(e.id, e);
    return e;
  }

  removeEnemyAt(index: number): void {
    const e = this.enemies.removeAt(index);
    this.enemyById.delete(e.id);
    this.enemyPool.release(e);
  }

  findEnemy(id: number): EnemySim | undefined {
    return this.enemyById.get(id);
  }

  acquireProjectile(): ProjectileState {
    const p = this.projPool.acquire();
    p.id = this.newId();
    this.projectiles.add(p);
    return p;
  }

  removeProjectileAt(index: number): void {
    this.projPool.release(this.projectiles.removeAt(index));
  }

  findTower(id: number): TowerState | undefined {
    for (const t of this.towers.items) if (t.id === id) return t;
    return undefined;
  }
}

/** 모듈 간 공유되는 시뮬레이션 컨텍스트 (battle.ts가 소유) */
export interface SimCtx {
  readonly opts: BattleOptions;
  readonly rng: Rng;
  readonly world: World;
  readonly events: SimEvent[];
  readonly view: BattleStateView;
  readonly groundPaths: readonly BattlePath[];
  readonly airPaths: readonly BattlePath[];
}

/** 적이 따라가는 경로 (공중이면 airPaths, 인덱스 초과 시 0번 폴백) */
export function pathFor(ctx: SimCtx, e: EnemySim): BattlePath {
  const list = e.flying ? ctx.airPaths : ctx.groundPaths;
  return (list[e.pathIndex] ?? list[0]) as BattlePath;
}
