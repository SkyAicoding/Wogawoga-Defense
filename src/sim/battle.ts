/**
 * createBattle — BattleSim 구현. 틱 순서:
 * 웨이브 스폰(+prep 수리) → **아군 교전/봉쇄(+적의 난투 반격)** → 적의 타워 공격(+저주)
 * → 부서진 타워 회수 → 적 이동/누수 → **아군 이동/수명** → 상태이상
 * → 버프 재계산(5틱마다) → 타워 조준/발사(침묵 감소) → **홈타운 조준/발사**
 * → 투사체 이동/명중 → 사망 처리(적·아군) → 승패 판정.
 *
 * 세 단계의 자리는 전부 **"결정을 읽는 쪽이 뒤"** 라는 한 규칙으로 정해져 있다:
 *  · 공성이 이동보다 앞 — 근접 적의 "멈춰 서서 때린다"를 이동이 towerTargetId로 읽는다
 *    (src/sim/siege.ts 규칙 4).
 *  · **아군 교전이 공성보다 앞** — 봉쇄된 적은 타워를 때리지 않으므로(allies.ts 규칙 5)
 *    공성이 blockerAllyId를 읽으려면 봉쇄가 먼저 서 있어야 한다.
 *  · **아군 이동이 적 이동 직후** — 교전 판정은 이미 끝났고 결과대로 걷기만 한다.
 *    같은 틱의 같은 스냅샷으로 양쪽을 움직여야 사거리 판정이 한쪽으로 기울지 않는다.
 *  · **홈타운 발사가 타워 발사 직후, 투사체 단계 직전** — 사수는 사수끼리 같은
 *    스냅샷에서 쏴야 사거리 판정이 기울지 않고, 화살이 같은 틱의 투사체 단계에 실려야
 *    비행 시간 규칙이 타워 것과 같아진다 (hometown.ts 규칙 7).
 * 요약하면 한 틱의 인과는 **봉쇄 확정 → 공성 → 이동 → 사격**이다.
 *
 * prep: 웨이브1 전 150틱, 이후 90틱. callWave 스킵 시 남은틱×0.15 골드(내림).
 * three/DOM 임포트 금지 — @/data/types + @/core/* 만 사용.
 */
import { TICK_DT, STATUS_TICK_INTERVAL } from '@/data/types';
import type {
  AllyId,
  BattleCommand,
  BattleOptions,
  BattleSim,
  BattleStateView,
  CardState,
  EnemyId,
  SimEvent,
  TowerState,
  Vec2,
  WaveDef,
  WavePreview,
  WavePreviewEntry,
} from '@/data/types';
import { Rng } from '@/core/rng';
import { ALLY_MAX_ACTIVE, enemyTraitsOf, hideCapFor } from '@/data/balance';
import { isBuildableCell, rasterizePathCells, sceneryCells } from '@/data/grid';
import {
  moveAlly,
  allyTrainCost,
  canTrainAlly,
  moveAllies,
  sweepDeadAllies,
  trainAlly,
  updateAllies,
} from './allies';
import { recomputeBuffs, updateProjectiles, updateTowers } from './attack';
import { addGold, leakEnemy } from './combat';
import { Economy, sceneryClearCostFor, sellRefundFor } from './economy';
import { pathFor, World, type EnemySim, type SimCtx } from './entities';
import {
  baseNextStats,
  allyCapFor,
  baseUpgradeCost,
  canUpgradeBase,
  createHometown,
  currentLevelDef,
  initialBaseHp,
  updateHometown,
  upgradeBase,
} from './hometown';
import { buildPath, buildStraight } from './path';
import {
  isRepairTick,
  isSieging,
  maxHpFor,
  repairTowers,
  sweepDestroyedTowers,
  updateSiege,
} from './siege';
import { effectiveSpeed, processHealAuras, tickEnemyStatuses } from './status';
import { WaveSpawner } from './waves';

const PREP_TICKS_FIRST = 150;
const PREP_TICKS_LATER = 90;
const EARLY_CALL_RATE = 0.15;
const BUFF_INTERVAL = 5;
const ENDLESS_HP_GROWTH = 1.06;
const MAX_TIER = 4;

/** 진행거리 오름차순, 동점은 id (타게팅 규약, 완전 결정론) — 매 틱 클로저 생성 방지용 호이스팅 */
const byDistThenId = (a: EnemySim, b: EnemySim): number => a.dist - b.dist || a.id - b.id;

// FNV-1a — float를 비트 단위로 혼합 (결정론 해시)
const hashF64 = new Float64Array(1);
const hashU32 = new Uint32Array(hashF64.buffer);
function mix(h: number, n: number): number {
  hashF64[0] = n;
  h = Math.imul(h ^ (hashU32[0] as number), 16777619);
  h = Math.imul(h ^ (hashU32[1] as number), 16777619);
  return h >>> 0;
}

class Battle implements BattleSim {
  private readonly ctx: SimCtx;
  private readonly economy = new Economy();
  private readonly spawner = new WaveSpawner();
  private waveDef: WaveDef | null = null;
  /** 경로가 지나는 셀 — 건설 불가 (render와 동일 래스터라이즈) */
  private readonly pathCells: ReadonlySet<number>;
  /**
   * 나무/바위 등 소품 셀 — 건설 불가 (render와 동일 시드).
   * clearScenery로 치우면 여기서 빠져 그 자리에 타워를 지을 수 있게 된다.
   */
  private readonly scenery: Set<number>;
  /** 치운 소품 셀 키 — 제거 순서대로. length가 곧 다음 제거 비용의 지수 */
  private readonly clearedScenery: number[] = [];

  constructor(opts: BattleOptions) {
    const stage = opts.stage;
    const groundPaths = stage.paths.map((w) => buildPath(w));
    const airPaths =
      stage.airPaths && stage.airPaths.length > 0
        ? stage.airPaths.map((w) => buildPath(w))
        : stage.paths.map((w) => buildStraight(w[0] ?? stage.baseCell, stage.baseCell));
    const world = new World();
    const hand: CardState[] = [];
    // 홈타운은 Lv1(움막 하나)에서 시작한다 — hpMul이 1이 아닌 테이블도 여기서 흡수된다
    const baseHp0 = initialBaseHp(stage.baseHp, opts.baseLevels);
    const view: BattleStateView = {
      tick: 0,
      phase: 'prep',
      waveIndex: 1,
      waveCount: stage.waveCount,
      gold: stage.startGold,
      baseHp: baseHp0,
      baseHpMax: baseHp0,
      baseLevel: 1,
      baseLevelMax: Math.max(1, opts.baseLevels.length),
      prepTicksLeft: PREP_TICKS_FIRST,
      earlyCallBonusGold: Math.floor(PREP_TICKS_FIRST * EARLY_CALL_RATE),
      hand,
      // 읽기 전용 사본 — UI(미리보기 수요 막대)가 "내 덱"을 알아야 한다
      deck: [...opts.deck],
      refreshCost: 0,
      enemies: world.enemies.items,
      towers: world.towers.items,
      projectiles: world.projectiles.items,
      allies: world.allies.items,
      allyCap: ALLY_MAX_ACTIVE,
      amberEarned: 0,
      endless: opts.endless,
    };
    this.ctx = {
      opts,
      rng: new Rng(opts.seed),
      world,
      events: [],
      view,
      groundPaths,
      airPaths,
      hometown: createHometown(),
    };
    this.pathCells = rasterizePathCells(stage);
    this.scenery = sceneryCells(stage, this.pathCells);
    this.economy.fillHand(this.ctx);
  }

  get state(): BattleStateView {
    return this.ctx.view;
  }

  tick(): void {
    const ctx = this.ctx;
    const v = ctx.view;
    if (v.phase === 'won' || v.phase === 'lost') return; // 종료 후 동결
    v.tick++;
    // 1) prep 진행 / 웨이브 스폰
    if (v.phase === 'prep') {
      // 준비 단계 자동 수리 — 이 페이즈에는 살아 있는 적이 0마리임이 보장된다(checkEnd)
      if (isRepairTick(v.tick)) repairTowers(ctx);
      if (v.prepTicksLeft > 0) v.prepTicksLeft--;
      v.earlyCallBonusGold = Math.floor(v.prepTicksLeft * EARLY_CALL_RATE);
      if (v.prepTicksLeft <= 0) this.startWave();
    }
    if (v.phase === 'wave') this.spawner.update(ctx);
    // 2) 아군 교전/봉쇄 + 적의 난투 반격 (공성보다 **먼저** — allies.ts 규칙 5)
    updateAllies(ctx);
    // 3) 적 부족의 타워 공격 → 부서진 타워 회수 (발사 단계보다 먼저)
    updateSiege(ctx);
    if (sweepDestroyedTowers(ctx)) {
      this.economy.recalcCosts(ctx); // 타워 수 감소 → 핸드 실비용 하락
      recomputeBuffs(ctx); // drum이 부서졌을 수 있다 — 5틱 주기를 기다리지 않는다
    }
    // 4) 적 이동/누수 → 아군 이동/수명 (같은 스냅샷으로 양쪽을 움직인다)
    this.moveEnemies();
    moveAllies(ctx);
    // 5) 상태이상 틱 + 힐 오라
    const enemies = ctx.world.enemies.items;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i] as EnemySim;
      if (e.alive) tickEnemyStatuses(ctx, e);
    }
    if (v.tick % STATUS_TICK_INTERVAL === 0) processHealAuras(ctx);
    // 6) 버프 재계산 (5틱마다)
    if (v.tick % BUFF_INTERVAL === 0) recomputeBuffs(ctx);
    // 7) 타워 조준/발사 → 홈타운 조준/발사 (사수는 같은 스냅샷에서 함께 쏜다)
    updateTowers(ctx);
    updateHometown(ctx);
    // 8) 투사체 이동/명중 (타워 투사체와 홈타운 화살이 같은 단계를 탄다)
    updateProjectiles(ctx);
    // 9) 사망 처리 (이벤트는 피해/귀환 시점에 발생, 여기서는 회수만)
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!(enemies[i] as EnemySim).alive) ctx.world.removeEnemyAt(i);
    }
    sweepDeadAllies(ctx);
    // 10) 승패/웨이브 완료 판정
    this.checkEnd();
  }

  private startWave(): void {
    const ctx = this.ctx;
    const v = ctx.view;
    v.phase = 'wave';
    this.economy.onWaveStart(ctx);
    const wave = v.waveIndex;
    const def = ctx.opts.waveFor(wave);
    // endless: waveCount 초과분은 hpMul × 1.06^(wave-waveCount) 추가
    const extra = wave > v.waveCount ? ENDLESS_HP_GROWTH ** (wave - v.waveCount) : 1;
    this.waveDef = def;
    this.spawner.start(def, extra);
    ctx.events.push({ type: 'waveStarted', wave });
  }

  private moveEnemies(): void {
    const ctx = this.ctx;
    const items = ctx.world.enemies.items;
    for (const e of items) {
      if (!e.alive) continue;
      e.prevX = e.x;
      e.prevZ = e.z;
      // 아군에게 발이 묶였다 — 유닛 충돌 대신 쓰는 봉쇄 표현 (allies.ts 규칙 5)
      if (e.blockerAllyId >= 0) continue;
      // 습격대는 타워를 쏘는 동안 그 자리에 멈춰 선다 (siege.ts 규칙 4)
      if (isSieging(e)) continue;
      const sp = effectiveSpeed(e);
      if (sp <= 0) continue;
      // 규칙 4-b) 전진 의무는 **실제로 전진한 틱에만** 준다 — 봉쇄·스턴으로 서 있는
      // 시간이 의무를 갉으면 "묶였다 풀리자마자 또 정지"가 되어 보장이 깨진다
      if (e.siegeWalkLeft > 0) e.siegeWalkLeft--;
      e.dist += sp * TICK_DT;
      const path = pathFor(ctx, e);
      if (e.dist >= path.totalLength) {
        e.dist = path.totalLength;
        leakEnemy(ctx, e); // 회수는 사망 처리 단계에서
        continue;
      }
      path.sample(e.dist, e);
    }
    // 진행거리 오름차순 정렬 유지 (타게팅 규약)
    items.sort(byDistThenId);
  }

  private checkEnd(): void {
    const ctx = this.ctx;
    const v = ctx.view;
    if (v.baseHp <= 0) {
      v.phase = 'lost';
      ctx.events.push({
        type: 'battleEnded',
        won: false,
        wave: v.waveIndex,
        amberEarned: v.amberEarned,
      });
      return;
    }
    if (v.phase !== 'wave' || !this.spawner.allSpawned() || ctx.world.enemies.length > 0) return;
    // 웨이브 완료 — 전원 스폰됨 + 생존 0
    const def = this.waveDef;
    const reward = def ? def.goldReward : 0;
    if (reward > 0) addGold(ctx, reward);
    const amber = ctx.opts.stage.perWaveAmber;
    v.amberEarned += amber;
    ctx.events.push({ type: 'waveCleared', wave: v.waveIndex, goldReward: reward, amber });
    if (!v.endless && v.waveIndex >= v.waveCount) {
      v.phase = 'won';
      ctx.events.push({
        type: 'battleEnded',
        won: true,
        wave: v.waveIndex,
        amberEarned: v.amberEarned,
      });
      return;
    }
    v.waveIndex++;
    v.phase = 'prep';
    v.prepTicksLeft = PREP_TICKS_LATER;
  }

  applyCommand(cmd: BattleCommand): boolean {
    const v = this.ctx.view;
    if (v.phase === 'won' || v.phase === 'lost') return false;
    switch (cmd.type) {
      case 'placeTower':
        return this.cmdPlace(cmd.handIndex, cmd.cellX, cmd.cellZ);
      case 'upgradeTower':
        return this.cmdUpgrade(cmd.towerId);
      case 'sellTower':
        return this.cmdSell(cmd.towerId);
      case 'refreshHand':
        return this.economy.tryRefresh(this.ctx);
      case 'setTargeting': {
        const t = this.ctx.world.findTower(cmd.towerId);
        if (!t) return false;
        t.targeting = cmd.mode;
        t.targetId = -1; // 새 모드로 재조준
        return true;
      }
      case 'clearScenery':
        return this.cmdClearScenery(cmd.cellX, cmd.cellZ);
      case 'trainAlly':
        return trainAlly(this.ctx, cmd.defId);
      case 'moveAlly':
        return moveAlly(this.ctx, cmd.allyId, cmd.cellX, cmd.cellZ);
      case 'upgradeBase':
        return upgradeBase(this.ctx);
      case 'callWave': {
        // 이미 호출됨(카운트다운 0)이면 중복 호출 거부
        if (v.phase !== 'prep' || v.prepTicksLeft <= 0) return false;
        const bonus = Math.floor(v.prepTicksLeft * EARLY_CALL_RATE);
        if (bonus > 0) addGold(this.ctx, bonus);
        this.ctx.events.push({ type: 'earlyCallBonus', gold: bonus });
        v.prepTicksLeft = 0; // 다음 틱에 웨이브 시작
        v.earlyCallBonusGold = 0;
        return true;
      }
    }
  }

  private cmdPlace(handIndex: number, cellX: number, cellZ: number): boolean {
    const ctx = this.ctx;
    const card = ctx.view.hand[handIndex];
    if (!card) return false;
    if (!this.canPlaceAt(cellX, cellZ)) return false;
    if (ctx.view.gold < card.cost) return false;
    addGold(ctx, -card.cost);
    const maxHp = maxHpFor(ctx, card.towerId, 0);
    const t: TowerState = {
      id: ctx.world.newId(),
      defId: card.towerId,
      tier: 0,
      hp: maxHp,
      maxHp,
      silenceLeft: 0,
      cellX,
      cellZ,
      cooldownLeft: 0,
      targetId: -1,
      targeting: 'first',
      invested: card.cost,
      buffDmgPct: 0,
      buffRatePct: 0,
    };
    ctx.world.towers.add(t);
    ctx.events.push({ type: 'towerPlaced', towerId: t.id, defId: t.defId, cellX, cellZ });
    this.economy.onPlaced(ctx, handIndex);
    return true;
  }

  private cmdUpgrade(towerId: number): boolean {
    const ctx = this.ctx;
    const t = ctx.world.findTower(towerId);
    if (!t || t.tier >= MAX_TIER) return false;
    const next = ctx.opts.towerDefs[t.defId].tiers[t.tier + 1];
    if (!next || ctx.view.gold < next.cost) return false;
    addGold(ctx, -next.cost);
    t.tier++;
    t.invested += next.cost;
    // 업그레이드 회복 정책: **늘어난 최대치만큼만 즉시 회복** (누적 피해량은 그대로 유지).
    // 전량 회복으로 하면 업그레이드가 곧 완전 수리가 되어 "부서지기 전에 한 티어 올려 버티기"가
    // 항상 정답이 되고 파괴 위협이 사라진다. 비율 유지로 하면 반대로 절반 남은 타워를
    // 올릴 이유가 없어져 투자가 죽는다. 절대 피해 보존은 그 사이 —
    // 업그레이드가 체력을 크게 늘려주긴 하지만(T1→T2에서 +130) 상처는 남는다.
    const nextMax = maxHpFor(ctx, t.defId, t.tier);
    t.hp = Math.max(1, t.hp + (nextMax - t.maxHp));
    t.maxHp = nextMax;
    ctx.events.push({ type: 'towerUpgraded', towerId: t.id, defId: t.defId, tier: t.tier });
    return true;
  }

  private cmdSell(towerId: number): boolean {
    const ctx = this.ctx;
    const items = ctx.world.towers.items;
    const idx = items.findIndex((t) => t.id === towerId);
    if (idx < 0) return false;
    const t = items[idx] as TowerState;
    const refund = sellRefundFor(t.invested);
    ctx.world.towers.removeAt(idx);
    addGold(ctx, refund);
    ctx.events.push({ type: 'towerSold', towerId, refund });
    this.economy.recalcCosts(ctx); // 타워 수 감소 → 핸드 실비용 하락 반영
    return true;
  }

  /**
   * 골드로 소품 치우기 — 성공하면 그 셀은 즉시 건설 가능해진다.
   * 이미 치운 셀/소품 없는 셀/골드 부족이면 거부(골드 이중 차감 불가).
   */
  private cmdClearScenery(cellX: number, cellZ: number): boolean {
    const ctx = this.ctx;
    const cost = this.clearSceneryCost(cellX, cellZ);
    if (cost === null || ctx.view.gold < cost) return false;
    const key = cellZ * ctx.opts.stage.gridW + cellX;
    addGold(ctx, -cost);
    this.scenery.delete(key);
    this.clearedScenery.push(key);
    ctx.events.push({
      type: 'sceneryCleared',
      cellX,
      cellZ,
      cost,
      clearedCount: this.clearedScenery.length,
    });
    return true;
  }

  drainEvents(): SimEvent[] {
    const ev = this.ctx.events;
    return ev.splice(0, ev.length); // 배열 참조 유지 (SimCtx 공유)
  }

  hash(): number {
    const ctx = this.ctx;
    const v = ctx.view;
    let h = 2166136261 >>> 0;
    h = mix(h, ctx.rng.getState());
    h = mix(h, v.tick);
    h = mix(h, v.gold);
    h = mix(h, v.baseHp);
    // 홈타운 — 레벨은 최대 HP·공격력·사거리를 한꺼번에 바꾸고, 쿨다운/타깃은
    // "언제 누구를 쏘는가"를 바꾼다. 셋 다 빠지면 기지가 개입한 판의 발산을 해시가 놓친다
    h = mix(h, v.baseLevel);
    h = mix(h, v.baseHpMax);
    h = mix(h, ctx.hometown.attackCdLeft);
    h = mix(h, ctx.hometown.targetId);
    for (const e of ctx.world.enemies.items) {
      h = mix(h, e.id);
      h = mix(h, Math.round(e.x * 1000));
      h = mix(h, Math.round(e.z * 1000));
      h = mix(h, e.hp);
      // 공성 상태 — 이게 빠지면 "언제 누구를 때리는가"의 발산을 해시가 못 잡는다
      h = mix(h, e.attackCdLeft);
      h = mix(h, e.towerTargetId);
      // 정지 사격(siege.ts 규칙 4) — 셋이 **각각** 다른 발산을 잡는다.
      //  · siegeHoldLeft : 지금 서 있는가 = 이동 여부. 1틱만 어긋나도 위치가 갈린다
      //  · siegeWalkLeft : 언제 다시 멈출 수 있는가 = 앞으로의 정지 시점 전부
      //  · attackAnimLeft: 연출 전용이지만 타격 시점의 파생값이라, 여기가 갈리면
      //    "언제 쐈는가"가 갈린 것이다 (판정에 되먹임은 없어도 증거로는 유효하다)
      h = mix(h, e.siegeHoldLeft);
      h = mix(h, e.siegeWalkLeft);
      h = mix(h, e.attackAnimLeft);
      // 봉쇄/난투 — 봉쇄는 이동·공성·반격을 동시에 바꾸므로 1틱만 어긋나도 전부 갈라진다
      h = mix(h, e.blockerAllyId);
      h = mix(h, e.brawlCdLeft);
    }
    // 아군 부족원 — 위치/체력/수명/쿨다운/타깃 전부. 하나라도 빠지면
    // "언제 누가 죽고 언제 돌아가는가"의 발산을 해시가 놓친다.
    // (walked는 x/z에서 유도되지만 **목표에 도착해 멈춘 뒤에도 값이 남는** 유일한 항목이라
    //  따로 넣는다 — 9단계 전에는 같은 역할을 경로 호장 dist가 했다. 목표 tgtX/tgtZ도 넣는다:
    //  명령만 바꾸고 아직 한 걸음도 안 걸은 틱을 x/z만으로는 구별할 수 없다)
    for (const a of ctx.world.allies.items) {
      h = mix(h, a.id);
      h = mix(h, Math.round(a.x * 1000));
      h = mix(h, Math.round(a.z * 1000));
      h = mix(h, Math.round(a.walked * 1000));
      h = mix(h, Math.round(a.tgtX * 1000));
      h = mix(h, Math.round(a.tgtZ * 1000));
      h = mix(h, a.hp);
      h = mix(h, a.attackCdLeft);
      h = mix(h, a.targetId);
    }
    for (const t of ctx.world.towers.items) {
      h = mix(h, t.id);
      h = mix(h, t.cellX * 1000);
      h = mix(h, t.cellZ * 1000);
      h = mix(h, t.tier * 1000 + t.cooldownLeft);
      // 구조물 체력 — 파괴 시점이 1틱만 어긋나도 해시가 갈라진다
      h = mix(h, t.hp);
      h = mix(h, t.maxHp);
      // 침묵 잔여 — "언제부터 다시 쏘는가"의 발산을 잡는다 (저주는 발사 시점을 바꾼다)
      h = mix(h, t.silenceLeft);
    }
    for (const p of ctx.world.projectiles.items) {
      h = mix(h, p.id);
      h = mix(h, Math.round(p.x * 1000));
      h = mix(h, Math.round(p.z * 1000));
      h = mix(h, p.dmg);
    }
    // 지형 개조 상태 — 어떤 셀을 어떤 순서로 치웠는지까지 해시에 넣어야
    // 제거를 포함한 커맨드열의 결정론이 검증된다
    h = mix(h, this.clearedScenery.length);
    for (const key of this.clearedScenery) h = mix(h, key);
    return h;
  }

  /**
   * 웨이브 미리보기 — **순수 조회**. 상태를 안 건드리고, 이벤트를 안 내고,
   * hash()에 안 들어간다(이 메서드는 어떤 필드에도 쓰지 않는다).
   *
   * 기본값이 "다음에 올 웨이브"인 이유: prep 중에는 view.waveIndex가 **이미**
   * 다음 웨이브 번호이고(startWave가 그 값을 그대로 쓴다), 전투 중이면 지금 웨이브라
   * 다음은 +1이다. 두 국면을 하나의 식으로 쓰면 prep에서 한 웨이브 건너뛴 것을 보여준다.
   * (docs/counter-plan.md 1단계는 `waveIndex + 1`로 적혀 있는데, 그 식은 전투 중에만 맞다.)
   *
   * hpMul은 스폰과 **같은 식**을 쓴다 — sim/waves.ts spawn의
   * `max(1, round(def.hp × g.hpMul × extraHpMul))` 그대로다. 무한 모드 초과분
   * (ENDLESS_HP_GROWTH^(wave−waveCount))도 startWave와 같은 조건으로 곱한다.
   * 이 두 식이 어긋나면 미리보기가 거짓말을 하므로 tests/sim/preview.test.ts가
   * "미리보기의 종별 합계 == 실제로 돌렸을 때 스폰된 종별 합계"를 잠근다.
   */
  previewWave(wave?: number): WavePreview {
    const ctx = this.ctx;
    const v = ctx.view;
    const next = v.phase === 'prep' ? v.waveIndex : v.waveIndex + 1;
    const w = Math.max(1, Math.floor(wave ?? next));
    const def = ctx.opts.waveFor(w);
    const extra = w > v.waveCount ? ENDLESS_HP_GROWTH ** (w - v.waveCount) : 1;
    const byId = new Map<EnemyId, WavePreviewEntry>();
    for (const g of def.groups) {
      if (g.count <= 0) continue;
      const eDef = ctx.opts.enemyDefs[g.enemyId];
      if (!eDef) continue;
      const maxHp = Math.max(1, Math.round(eDef.hp * g.hpMul * extra));
      const hit = byId.get(g.enemyId);
      if (hit) {
        hit.count += g.count;
        hit.totalHp += maxHp * g.count;
        // 같은 종이 여러 hpMul로 나뉘면 배지는 **가장 단단한 개체**를 말한다
        if (maxHp > hit.maxHp) {
          hit.maxHp = maxHp;
          // 가죽 상한은 maxHp에 비례하므로 **같은 개체**를 따라가야 한다
          if (eDef.hide !== undefined) hit.hideCap = hideCapFor(maxHp, eDef.hide);
        }
      } else {
        byId.set(g.enemyId, {
          defId: g.enemyId,
          count: g.count,
          maxHp,
          totalHp: maxHp * g.count,
          armor: eDef.armor,
          ...(eDef.hide !== undefined ? { hideCap: hideCapFor(maxHp, eDef.hide) } : {}),
          ...(eDef.splashResist !== undefined ? { splashResist: eDef.splashResist } : {}),
          flying: eDef.flying,
          boss: eDef.boss ?? false,
          traits: enemyTraitsOf(eDef),
        });
      }
    }
    // 총 HP 내림차순, 동점은 종 id 사전순 (완전 결정론 — 칩 순서가 시드에 흔들리지 않는다)
    const entries = [...byId.values()].sort(
      (a, b) => b.totalHp - a.totalHp || (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0),
    );
    let totalHp = 0;
    let totalCount = 0;
    let hasAir = false;
    let boss = false;
    for (const e of entries) {
      totalHp += e.totalHp;
      totalCount += e.count;
      if (e.flying) hasAir = true;
      if (e.boss) boss = true;
    }
    return { wave: w, entries, totalHp, totalCount, goldReward: def.goldReward, hasAir, boss };
  }

  canPlaceAt(cellX: number, cellZ: number): boolean {
    const stage = this.ctx.opts.stage;
    if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) return false;
    // 자유 배치: 경로/물/장식('#')/소품(나무·바위)이 아닌 빈 땅 어디든.
    // 치운 소품 셀은 scenery에서 빠졌으므로 여기서 통과한다
    if (!isBuildableCell(stage, this.pathCells, cellX, cellZ)) return false;
    if (this.scenery.has(cellZ * stage.gridW + cellX)) return false;
    return this.towerAt(cellX, cellZ) === null;
  }

  hasScenery(cellX: number, cellZ: number): boolean {
    const stage = this.ctx.opts.stage;
    if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) return false;
    if (cellX < 0 || cellX >= stage.gridW || cellZ < 0 || cellZ >= stage.gridH) return false;
    return this.scenery.has(cellZ * stage.gridW + cellX);
  }

  clearSceneryCost(cellX: number, cellZ: number): number | null {
    if (!this.hasScenery(cellX, cellZ)) return null;
    return sceneryClearCostFor(this.clearedScenery.length);
  }

  allyCost(defId: AllyId): number {
    const def = this.ctx.opts.allyDefs[defId];
    return def ? allyTrainCost(this.ctx, def) : 0;
  }

  canTrainAlly(defId: AllyId): boolean {
    const v = this.ctx.view;
    if (v.phase === 'won' || v.phase === 'lost') return false;
    const def = this.ctx.opts.allyDefs[defId];
    return def ? canTrainAlly(this.ctx, def) : false;
  }

  baseUpgradeCost(): number | null {
    return baseUpgradeCost(this.ctx);
  }

  canUpgradeBase(): boolean {
    const v = this.ctx.view;
    if (v.phase === 'won' || v.phase === 'lost') return false;
    return canUpgradeBase(this.ctx);
  }

  baseRange(): number {
    return currentLevelDef(this.ctx).range;
  }

  /** 지금 마을이 허용하는 부족원 정원 (9단계에 allySortieRange를 대신한다) */
  allyCap(): number {
    return allyCapFor(this.ctx);
  }

  baseNextStats(): { hpMax: number; dmg: number; range: number; allyCap: number } | null {
    return baseNextStats(this.ctx);
  }

  towerAt(cellX: number, cellZ: number): TowerState | null {
    for (const t of this.ctx.world.towers.items) {
      if (t.cellX === cellX && t.cellZ === cellZ) return t;
    }
    return null;
  }

  upgradeCost(towerId: number): number | null {
    const t = this.ctx.world.findTower(towerId);
    if (!t) return null;
    const next = this.ctx.opts.towerDefs[t.defId].tiers[t.tier + 1];
    return next ? next.cost : null;
  }

  sellRefund(towerId: number): number | null {
    const t = this.ctx.world.findTower(towerId);
    return t ? sellRefundFor(t.invested) : null;
  }
}

export function createBattle(options: BattleOptions): BattleSim {
  return new Battle(options);
}
