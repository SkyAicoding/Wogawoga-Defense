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
  /**
   * 공성 피해 배율 — **무한 모드 초과분(1.06^n)만** 반영한다. 6개 스테이지의
   * 정규 웨이브(wave <= waveCount)에서는 항상 정확히 1이라 밸런스가 바뀌지 않는다.
   *
   * 왜 필요한가: towerAttack.dmg는 상수인데 적 HP는 무한 모드에서 1.06^n으로 커진다.
   * w100이면 archer 실HP가 24,740인데 타워에 넣는 피해는 여전히 11이라
   * 만렙 T5(1,316)를 혼자 부수는 데 159.5초가 걸린다 — 즉 무한 모드에서는
   * "타워를 부수는 적"이라는 기능이 사실상 사라진다(실측: 도달 웨이브 차이 0.3%).
   * 웨이브 곡선 hpMul까지 곱하면 정규 스테이지가 통째로 흔들리므로
   * (stage6은 hpBase만 2.2다) **초과분에만** 건다.
   */
  siegeMul: number;
}

/**
 * 투사체 내부 확장 — 상태이상 소스별 스택을 위해 발사 타워 id를,
 * 착탄 연출 강도 산정을 위해 발사 시점의 타워 티어를 들고 다닌다.
 * (공개 ProjectileState에는 노출하지 않는다)
 */
export interface ProjectileSim extends ProjectileState {
  sourceTowerId: number;
  /** 발사 타워의 0-base 티어 (0~4) */
  tier: number;
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
    attackCdLeft: 0,
    towerTargetId: -1,
    def: null as unknown as EnemyDef, // 스폰 시 반드시 채워짐
    stunImmuneUntil: -1,
    siegeMul: 1,
  };
}

function resetEnemy(e: EnemySim): void {
  e.statuses.length = 0;
  e.alive = true;
  e.stunImmuneUntil = -1;
  e.dist = 0;
  e.shieldHitsLeft = 0;
  // 풀 재사용 시 이전 개체의 공성 상태가 새어 나가면 결정론이 깨진다
  e.attackCdLeft = 0;
  e.towerTargetId = -1;
  e.siegeMul = 1;
}

function makeProjectile(): ProjectileSim {
  return {
    id: 0,
    kind: 'homing',
    towerDefId: 'spear',
    sourceTowerId: -1,
    tier: 0,
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

function resetProjectile(p: ProjectileSim): void {
  p.alive = true;
  p.targetId = -1;
  p.sourceTowerId = -1;
  p.tier = 0;
  p.flightTicks = 0;
  p.elapsedTicks = 0;
  p.splash = undefined;
  p.status = undefined;
}

export class World {
  readonly enemies = new DenseList<EnemySim>();
  readonly towers = new DenseList<TowerState>();
  readonly projectiles = new DenseList<ProjectileSim>();
  private readonly enemyById = new Map<number, EnemySim>();
  private nextId = 1;
  private readonly enemyPool = new Pool<EnemySim>(makeEnemy, resetEnemy, 32);
  private readonly projPool = new Pool<ProjectileSim>(makeProjectile, resetProjectile, 32);

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

  acquireProjectile(): ProjectileSim {
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
