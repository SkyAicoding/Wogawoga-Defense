/**
 * 엔티티 저장소 — DenseList + Pool 기반 풀 관리, id 발급.
 * EnemySim은 EnemyState에 def 참조/스턴 면역 등 내부 필드를 더한 확장이며
 * BattleStateView에는 EnemyState로 그대로 노출된다 (매 틱 새 객체 생성 금지).
 */
import { DenseList, Pool } from '@/core/pool';
import type { Rng } from '@/core/rng';
import type {
  AllyDef,
  AllyState,
  BattleOptions,
  BattleStateView,
  EnemyDef,
  EnemyState,
  ProjectileState,
  SimEvent,
  TowerState,
} from '@/data/types';
import type { BattlePath } from './path';
import type { HometownSim } from './hometown';

export interface EnemySim extends EnemyState {
  def: EnemyDef;
  /** 보스 스턴 종료 후 면역이 끝나는 틱 */
  stunImmuneUntil: number;
  /**
   * 난투(아군 반격) 쿨다운 잔여 틱. **towerAttack의 attackCdLeft와 일부러 분리한다** —
   * 하나로 합치면 "타워를 때리다 아군에게 붙잡히면 반격이 한 박자 빨라지거나 늦어지는"
   * 숨은 결합이 생기고, 두 행동은 서로 배타(봉쇄되면 타워를 안 때린다)라 공유할 이유도 없다.
   */
  brawlCdLeft: number;
  /**
   * 규칙 4-b의 **전진 의무** 잔여 틱. 0보다 크면 어떤 타워 앞에서도 멈추지 못한다.
   * 한 번 멈춘 뒤 SIEGE_ADVANCE_TICKS로 채워지고, **실제로 전진한 틱에만** 준다
   * (봉쇄·스턴으로 못 걷는 틱에는 줄지 않는다 — 의무는 시간이 아니라 전진이다).
   *
   * **공개 상태가 아니다.** siegeHoldLeft가 "지금 서 있는가"를 이미 말해 주므로
   * 렌더가 볼 이유가 없고, 노출하면 "왜 사거리 안인데 안 멈추지"를 연출이 흉내 내려
   * 들 수 있다. 그 판단은 시뮬레이션 혼자 한다.
   */
  siegeWalkLeft: number;
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
  /**
   * 살점 값의 **몫 수 K** — 이 개체가 이번 웨이브의 표준 사냥감 몇 마리분인가.
   * 스폰 시 `balance.bountyChunksFor`로 굳는다. **1이면 오늘과 완전히 같다**(사망 시 한 번).
   *
   * 공개 `EnemyState`에 안 올린다: 렌더가 알아야 할 것은 "방금 얼마 들어왔나"뿐이고
   * 그건 `bountyChunk` 이벤트가 말한다. 여기 두면 UI가 몫 게이지를 그리려 들고,
   * 그 순간 연출이 지급 판정을 흉내 내기 시작한다 (`siegeWalkLeft`와 같은 논거).
   */
  bountyChunks: number;
  /**
   * 이 개체에게 **이미 지급한** 골드 누계(정수). 사망 지급은 `bounty − 이 값`이다.
   *
   * ⚠ **이 한 필드가 정확성의 뿌리다.** 지급은 언제나
   * `floor(bounty × k / K) − bountyPaid`이고 **양수일 때만** 나가므로 이 값은 절대 안 줄고,
   * 곧 "그 개체가 **도달한 최저 HP**"를 골드 단위로 기록한 것과 같다:
   *  · 주술사(`status.processHealAuras`)가 hp를 되돌리면 k가 내려가 지급이 음수 → 0.
   *    같은 구간을 다시 깎아도 0. **더 아래로** 내려가야 비로소 다음 몫이 나온다.
   *    곧 "회복시킨 적을 반복해 때려 골드 무한 파밍"이 **자료구조로** 불가능하다.
   *  · 오버킬로 hp가 −99,999가 되어도 총 지급은 bounty를 못 넘는다(k ≤ K).
   * 되돌림 방어를 규칙으로 따로 적지 않은 이유가 이것이다 — 규칙은 잊히지만 표현은
   * 안 잊힌다. 별도의 `lowHp` 필드를 두지 **않은** 이유이기도 하다: 두 필드가 동시에
   * 정확해야 안전한 설계는 리셋 누락 하나가 곧 골드 누수다.
   *
   * **정수다.** 분수 골드를 float로 누적하면 `hash()`의 `v.gold`가 흔들린다 —
   * 스폰의 `bounty` 자체를 정수로 굳혀 둔 것(`waves.spawn`)과 같은 이유다.
   */
  bountyPaid: number;
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
    siegeHoldLeft: 0,
    attackAnimLeft: 0,
    attackAnimTicks: 0,
    blockerAllyId: -1,
    gateTicks: 0,
    gateBiteCdLeft: 0,
    def: null as unknown as EnemyDef, // 스폰 시 반드시 채워짐
    stunImmuneUntil: -1,
    siegeMul: 1,
    brawlCdLeft: 0,
    siegeWalkLeft: 0,
    bountyChunks: 1,
    bountyPaid: 0,
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
  e.siegeHoldLeft = 0;
  e.siegeWalkLeft = 0;
  e.attackAnimLeft = 0;
  e.attackAnimTicks = 0;
  e.siegeMul = 1;
  e.blockerAllyId = -1;
  e.brawlCdLeft = 0;
  // **문간 상태 — 리셋 누락이 곧 결정론 파괴다** (gate.ts).
  // gateTicks 가 남아 있으면 새로 스폰된 개체가 태어나자마자 "문간에 서 있는 것"이 되어
  // moveEnemies 가 첫 틱부터 그 개체를 붙잡고(두 번 다시 안 걷는다) updateGate 가
  // 스폰 지점에서 마을을 물기 시작한다. 그 감소량이 풀 재사용 순서를 타므로 시드마다
  // 갈리고, 곧 hash() 가 갈린다 — bountyPaid 가 당한 것과 **정확히 같은 모양**의 사고다.
  // (전례가 있어서 여기 상수로 못박는다. tests/sim/gate.test.ts 가 이 성질을 잠근다)
  e.gateTicks = 0;
  e.gateBiteCdLeft = 0;
  // 살점 값의 **지급 이력**도 같다 — 안 지우면 trex(bountyPaid 480)를 죽인 슬롯을
  // 물려받은 compy가 "이미 480을 받은 적"으로 취급돼 평생 한 푼도 못 받는다.
  // 그 감소량이 풀 재사용 순서를 타므로 시드마다 갈리고, 곧 hash()가 갈린다.
  //
  // 기본값 1/0 은 **안전한 쪽으로 고장 난다**: bountyChunks 가 1이면 combat 의
  // 진행 지급 분기가 통째로 꺼져 오늘과 똑같이 "사망 시 한 번"이 된다.
  // (0 이면 나눗셈이 Infinity 로 터지고, 이전 개체의 큰 값이 남으면 첫 타격에
  //  여러 몫이 한꺼번에 나간다 — 둘 다 조용히 골드를 새게 하는 방향이다.)
  //
  // ⚠ 여기서 `e.maxHp` 를 읽어 감시값을 만들면 안 된다. resetEnemy 는 Pool.acquire
  // 시점에 돌아 **그 시점의 maxHp 는 아직 이전 개체 것**이고, waves.spawn 이 그 뒤에
  // 새 값을 넣는다. 상수 1/0 은 그 순서에 의존하지 않는다.
  e.bountyChunks = 1;
  e.bountyPaid = 0;
}

/** 아군 유닛 내부 확장 — 정의 참조만 더한다 (상태이상이 없어 EnemySim보다 얇다) */
export interface AllySim extends AllyState {
  def: AllyDef;
}

function makeAlly(): AllySim {
  return {
    id: 0,
    defId: 'clubber',
    hp: 1,
    maxHp: 1,
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    tgtX: 0,
    tgtZ: 0,
    walked: 0,
    heading: 0,
    attackCdLeft: 0,
    targetId: -1,
    alive: true,
    def: null as unknown as AllyDef, // 출동 시 반드시 채워짐
  };
}

function resetAlly(a: AllySim): void {
  a.alive = true;
  a.attackCdLeft = 0;
  a.targetId = -1;
  // 걸은 거리는 **반드시** 0으로 되돌린다 — 풀 재사용이라 안 지우면 새 부족원이
  // 앞사람의 보행 위상을 물려받아 태어나자마자 다리가 엉뚱한 각도에서 시작한다
  a.walked = 0;
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
    fromBase: false,
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
  // 풀 재사용 시 이전 화살의 출처가 새어 나가면 타워 피해가 'hometown'으로 집계된다
  p.fromBase = false;
}

export class World {
  readonly enemies = new DenseList<EnemySim>();
  readonly towers = new DenseList<TowerState>();
  readonly projectiles = new DenseList<ProjectileSim>();
  readonly allies = new DenseList<AllySim>();
  private readonly enemyById = new Map<number, EnemySim>();
  private readonly allyById = new Map<number, AllySim>();
  private nextId = 1;
  private readonly enemyPool = new Pool<EnemySim>(makeEnemy, resetEnemy, 32);
  private readonly projPool = new Pool<ProjectileSim>(makeProjectile, resetProjectile, 32);
  // 동시 상한(ALLY_MAX_ACTIVE)이 한 자리 수라 프리웜도 그만큼만
  private readonly allyPool = new Pool<AllySim>(makeAlly, resetAlly, 8);

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

  acquireAlly(): AllySim {
    const a = this.allyPool.acquire();
    a.id = this.newId();
    this.allies.add(a);
    this.allyById.set(a.id, a);
    return a;
  }

  removeAllyAt(index: number): void {
    const a = this.allies.removeAt(index);
    this.allyById.delete(a.id);
    this.allyPool.release(a);
  }

  findAlly(id: number): AllySim | undefined {
    return this.allyById.get(id);
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
  /**
   * 홈타운의 비공개 상태(발사 쿨다운·고정 타깃). 레벨은 공개 상태(view.baseLevel)가
   * 갖는다 — 한 값을 두 곳에 두지 않기 위해 소유를 이렇게 갈랐다.
   */
  readonly hometown: HometownSim;
}

/** 적이 따라가는 경로 (공중이면 airPaths, 인덱스 초과 시 0번 폴백) */
export function pathFor(ctx: SimCtx, e: EnemySim): BattlePath {
  const list = e.flying ? ctx.airPaths : ctx.groundPaths;
  return (list[e.pathIndex] ?? list[0]) as BattlePath;
}
