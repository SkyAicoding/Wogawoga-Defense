/**
 * createBattle — BattleSim 구현. 틱 순서:
 * 웨이브 스폰 → 적 이동/누수 → 상태이상 → 버프 재계산(5틱마다) → 타워 조준/발사
 * → 투사체 이동/명중 → 사망 처리 → 승패 판정.
 * prep: 웨이브1 전 150틱, 이후 90틱. callWave 스킵 시 남은틱×0.15 골드(내림).
 * three/DOM 임포트 금지 — @/data/types + @/core/* 만 사용.
 */
import { TICK_DT, STATUS_TICK_INTERVAL } from '@/data/types';
import type {
  BattleCommand,
  BattleOptions,
  BattleSim,
  BattleStateView,
  CardState,
  SimEvent,
  TowerState,
  WaveDef,
} from '@/data/types';
import { Rng } from '@/core/rng';
import { isBuildableCell, rasterizePathCells } from '@/data/grid';
import { recomputeBuffs, updateProjectiles, updateTowers } from './attack';
import { addGold, leakEnemy } from './combat';
import { Economy, sellRefundFor } from './economy';
import { pathFor, World, type EnemySim, type SimCtx } from './entities';
import { buildPath, buildStraight } from './path';
import { effectiveSpeed, processHealAuras, tickEnemyStatuses } from './status';
import { WaveSpawner } from './waves';

const PREP_TICKS_FIRST = 150;
const PREP_TICKS_LATER = 90;
const EARLY_CALL_RATE = 0.15;
const BUFF_INTERVAL = 5;
const ENDLESS_HP_GROWTH = 1.06;
const MAX_TIER = 4;

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

  constructor(opts: BattleOptions) {
    const stage = opts.stage;
    const groundPaths = stage.paths.map((w) => buildPath(w));
    const airPaths =
      stage.airPaths && stage.airPaths.length > 0
        ? stage.airPaths.map((w) => buildPath(w))
        : stage.paths.map((w) => buildStraight(w[0] ?? stage.baseCell, stage.baseCell));
    const world = new World();
    const hand: CardState[] = [];
    const view: BattleStateView = {
      tick: 0,
      phase: 'prep',
      waveIndex: 1,
      waveCount: stage.waveCount,
      gold: stage.startGold,
      baseHp: stage.baseHp,
      baseHpMax: stage.baseHp,
      prepTicksLeft: PREP_TICKS_FIRST,
      earlyCallBonusGold: Math.floor(PREP_TICKS_FIRST * EARLY_CALL_RATE),
      hand,
      refreshCost: 0,
      enemies: world.enemies.items,
      towers: world.towers.items,
      projectiles: world.projectiles.items,
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
    };
    this.pathCells = rasterizePathCells(stage);
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
      if (v.prepTicksLeft > 0) v.prepTicksLeft--;
      v.earlyCallBonusGold = Math.floor(v.prepTicksLeft * EARLY_CALL_RATE);
      if (v.prepTicksLeft <= 0) this.startWave();
    }
    if (v.phase === 'wave') this.spawner.update(ctx);
    // 2) 적 이동/누수
    this.moveEnemies();
    // 3) 상태이상 틱 + 힐 오라
    const enemies = ctx.world.enemies.items;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i] as EnemySim;
      if (e.alive) tickEnemyStatuses(ctx, e);
    }
    if (v.tick % STATUS_TICK_INTERVAL === 0) processHealAuras(ctx);
    // 4) 버프 재계산 (5틱마다)
    if (v.tick % BUFF_INTERVAL === 0) recomputeBuffs(ctx);
    // 5) 타워 조준/발사
    updateTowers(ctx);
    // 6) 투사체 이동/명중
    updateProjectiles(ctx);
    // 7) 사망 처리 (이벤트는 피해 시점에 발생, 여기서는 회수만)
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!(enemies[i] as EnemySim).alive) ctx.world.removeEnemyAt(i);
    }
    // 8) 승패/웨이브 완료 판정
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
      const sp = effectiveSpeed(e);
      if (sp <= 0) continue;
      e.dist += sp * TICK_DT;
      const path = pathFor(ctx, e);
      if (e.dist >= path.totalLength) {
        e.dist = path.totalLength;
        leakEnemy(ctx, e); // 회수는 사망 처리 단계에서
        continue;
      }
      path.sample(e.dist, e);
    }
    // 진행거리 오름차순 정렬 유지 (타게팅 규약, 동점은 id — 완전 결정론)
    items.sort((a, b) => a.dist - b.dist || a.id - b.id);
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
    const t: TowerState = {
      id: ctx.world.newId(),
      defId: card.towerId,
      tier: 0,
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
    for (const e of ctx.world.enemies.items) {
      h = mix(h, e.id);
      h = mix(h, Math.round(e.x * 1000));
      h = mix(h, Math.round(e.z * 1000));
      h = mix(h, e.hp);
    }
    for (const t of ctx.world.towers.items) {
      h = mix(h, t.id);
      h = mix(h, t.cellX * 1000);
      h = mix(h, t.cellZ * 1000);
      h = mix(h, t.tier * 1000 + t.cooldownLeft);
    }
    for (const p of ctx.world.projectiles.items) {
      h = mix(h, p.id);
      h = mix(h, Math.round(p.x * 1000));
      h = mix(h, Math.round(p.z * 1000));
      h = mix(h, p.dmg);
    }
    return h;
  }

  canPlaceAt(cellX: number, cellZ: number): boolean {
    const stage = this.ctx.opts.stage;
    if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) return false;
    // 자유 배치: 경로/물/장식('#')이 아닌 빈 땅 어디든
    if (!isBuildableCell(stage, this.pathCells, cellX, cellZ)) return false;
    return this.towerAt(cellX, cellZ) === null;
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
