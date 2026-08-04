/**
 * 타워 공격 — 조준/발사(homing/ballistic/beam), 브레이저 펄스, 드럼 버프 재계산,
 * 투사체 이동/명중, 스플래시(지상 전용, falloff 선형 감쇠).
 * 별 보너스: dmg×(1+stars·dmgPct), cooldown÷(1+stars·ratePct), range×(1+stars·rangePct).
 */
import { STATUS_TICK_INTERVAL, TICK_DT } from '@/data/types';
import type {
  ProjectileState,
  SplashSpec,
  StatusApplySpec,
  TowerDef,
  TowerState,
  TowerTier,
} from '@/data/types';
import { clamp01, dist, dist2, lerp, parabola } from '@/core/mathx';
import { damageEnemy } from './combat';
import { pathFor, type EnemySim, type SimCtx } from './entities';
import type { PathPoint } from './path';
import { effectiveSpeed, tryApplyStatus } from './status';
import { canTarget, lockedTarget, selectTarget } from './targeting';

const DEFAULT_PROJECTILE_SPEED = 8;
const IMPACT_TOLERANCE = 0.45; // 스플래시 없는 착탄의 단일 타격 허용 반경

function starsOf(ctx: SimCtx, def: TowerDef): number {
  return ctx.opts.stars[def.id] ?? 0;
}

export function effDmg(ctx: SimCtx, t: TowerState, def: TowerDef, tier: TowerTier): number {
  return tier.dmg * (1 + starsOf(ctx, def) * def.starBonus.dmgPct) * (1 + t.buffDmgPct);
}

export function effRange(ctx: SimCtx, def: TowerDef, tier: TowerTier): number {
  return tier.range * (1 + starsOf(ctx, def) * (def.starBonus.rangePct ?? 0));
}

export function effCooldown(ctx: SimCtx, t: TowerState, def: TowerDef, tier: TowerTier): number {
  const mul = (1 + starsOf(ctx, def) * def.starBonus.ratePct) * (1 + t.buffRatePct);
  return Math.max(1, Math.round(tier.cooldownTicks / mul));
}

/** 감쇠 배율: 중심 1.0 → 가장자리 falloff (선형) */
function splashScale(d: number, splash: SplashSpec): number {
  return 1 - (1 - splash.falloff) * clamp01(d / splash.radius);
}

/** 스플래시 피해 — 지상 적 전용 (공중 면제), excludeId는 직격 대상 제외용 */
function applyArea(
  ctx: SimCtx,
  x: number,
  z: number,
  dmg: number,
  splash: SplashSpec,
  source: TowerDef['id'],
  status: StatusApplySpec | undefined,
  excludeId: number,
): void {
  for (const e of ctx.world.enemies.items) {
    if (!e.alive || e.flying || e.id === excludeId) continue;
    const d = dist(x, z, e.x, e.z);
    if (d > splash.radius + e.radius) continue;
    damageEnemy(ctx, e, dmg * splashScale(d, splash), source);
    if (status && e.alive) tryApplyStatus(ctx, e, status);
  }
}

/** drum 버프 — 5틱마다 호출. 반경 내 타워의 buff%를 갱신 (중첩 시 최대값만, 자신 제외). */
export function recomputeBuffs(ctx: SimCtx): void {
  const towers = ctx.world.towers.items;
  for (const t of towers) {
    t.buffDmgPct = 0;
    t.buffRatePct = 0;
  }
  for (const d of towers) {
    const def = ctx.opts.towerDefs[d.defId];
    const tier = def.tiers[d.tier] as TowerTier;
    const aura = tier.aura;
    if (!aura || (aura.dmgPct === undefined && aura.ratePct === undefined)) continue;
    const r2 = aura.radius * aura.radius;
    for (const t of towers) {
      if (t === d) continue;
      if (dist2(d.cellX, d.cellZ, t.cellX, t.cellZ) > r2) continue;
      if (aura.dmgPct !== undefined) t.buffDmgPct = Math.max(t.buffDmgPct, aura.dmgPct);
      if (aura.ratePct !== undefined) t.buffRatePct = Math.max(t.buffRatePct, aura.ratePct);
    }
  }
}

/** 타워 조준/발사 — 타겟 고정 유지, 사거리 이탈/사망 시에만 재조준 */
export function updateTowers(ctx: SimCtx): void {
  for (const t of ctx.world.towers.items) {
    const def = ctx.opts.towerDefs[t.defId];
    const tier = def.tiers[t.tier] as TowerTier;
    if (t.cooldownLeft > 0) t.cooldownLeft--;
    if (def.attackKind === 'pulse' || def.attackKind === 'aura') {
      pulseTick(ctx, t, def, tier);
      continue;
    }
    const range = effRange(ctx, def, tier);
    let target = lockedTarget(ctx, t, def, range);
    if (!target) {
      target = selectTarget(ctx, t, def, range);
      t.targetId = target ? target.id : -1;
    }
    if (!target || t.cooldownLeft > 0) continue;
    if (def.attackKind === 'beam') fireBeam(ctx, t, def, tier, target);
    else if (def.attackKind === 'ballistic') fireBallistic(ctx, t, def, tier, target);
    else fireHoming(ctx, t, def, tier, target);
    t.cooldownLeft = effCooldown(ctx, t, def, tier);
  }
}

/** brazier: STATUS_TICK_INTERVAL마다 반경 내 지상 적 전체 피해 + 상태 부여 */
function pulseTick(ctx: SimCtx, t: TowerState, def: TowerDef, tier: TowerTier): void {
  if (ctx.view.tick % STATUS_TICK_INTERVAL !== 0) return;
  const aura = tier.aura;
  if (!aura || aura.dmgPerStatusTick === undefined) return; // drum류는 버프 전용
  const dmg =
    aura.dmgPerStatusTick * (1 + starsOf(ctx, def) * def.starBonus.dmgPct) * (1 + t.buffDmgPct);
  const status = aura.status ?? tier.status;
  const r = aura.radius;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive || e.flying) continue;
    if (dist2(t.cellX, t.cellZ, e.x, e.z) > r * r) continue;
    damageEnemy(ctx, e, dmg, def.id);
    if (status && e.alive) tryApplyStatus(ctx, e, status);
  }
}

function fireHoming(
  ctx: SimCtx,
  t: TowerState,
  def: TowerDef,
  tier: TowerTier,
  target: EnemySim,
): void {
  const p = ctx.world.acquireProjectile();
  p.kind = 'homing';
  p.towerDefId = def.id;
  p.x = p.prevX = p.startX = t.cellX;
  p.z = p.prevZ = p.startZ = t.cellZ;
  p.y = p.prevY = 0.6;
  p.targetId = target.id;
  p.targetX = target.x;
  p.targetZ = target.z;
  p.flightTicks = 0;
  p.elapsedTicks = 0;
  p.arcHeight = 0;
  p.speed = tier.projectileSpeed ?? DEFAULT_PROJECTILE_SPEED;
  p.dmg = effDmg(ctx, t, def, tier);
  p.splash = tier.splash;
  p.status = tier.status;
  p.targetFlying = target.flying;
  ctx.events.push({ type: 'towerFired', towerId: t.id, defId: def.id, targetId: target.id });
}

const scratch: PathPoint = { x: 0, z: 0, heading: 0 };

/** ballistic: 현재 속도로 flightTicks 후의 경로 위치를 조준 (착탄 시 스플래시) */
function fireBallistic(
  ctx: SimCtx,
  t: TowerState,
  def: TowerDef,
  tier: TowerTier,
  target: EnemySim,
): void {
  const d = dist(t.cellX, t.cellZ, target.x, target.z);
  const speed = tier.projectileSpeed ?? DEFAULT_PROJECTILE_SPEED;
  const flight = Math.max(1, Math.round(d / (speed * TICK_DT)));
  const path = pathFor(ctx, target);
  const lead = Math.min(target.dist + effectiveSpeed(target) * flight * TICK_DT, path.totalLength);
  path.sample(lead, scratch);
  const p = ctx.world.acquireProjectile();
  p.kind = 'ballistic';
  p.towerDefId = def.id;
  p.x = p.prevX = p.startX = t.cellX;
  p.z = p.prevZ = p.startZ = t.cellZ;
  p.y = p.prevY = 0.6;
  p.targetId = target.id;
  p.targetX = scratch.x;
  p.targetZ = scratch.z;
  p.flightTicks = flight;
  p.elapsedTicks = 0;
  p.arcHeight = 0.5 + 0.12 * d;
  p.speed = speed;
  p.dmg = effDmg(ctx, t, def, tier);
  p.splash = tier.splash;
  p.status = tier.status;
  p.targetFlying = target.flying;
  ctx.events.push({ type: 'towerFired', towerId: t.id, defId: def.id, targetId: target.id });
}

/** lightning: 즉시 판정, jumpRange 내 미피격 최근접으로 jumps회 점프, 점프당 dmg×decay^n */
function fireBeam(
  ctx: SimCtx,
  t: TowerState,
  def: TowerDef,
  tier: TowerTier,
  target: EnemySim,
): void {
  const chain = tier.chain;
  const jumps = chain ? chain.jumps : 0;
  const decay = chain ? chain.decay : 1;
  const jumpR2 = chain ? chain.jumpRange * chain.jumpRange : 0;
  const baseDmg = effDmg(ctx, t, def, tier);
  const points: { x: number; z: number; flying: boolean }[] = [
    { x: t.cellX, z: t.cellZ, flying: false },
  ];
  const hitIds: number[] = [];
  let cur: EnemySim | null = target;
  let mult = 1;
  while (cur) {
    damageEnemy(ctx, cur, baseDmg * mult, def.id);
    if (tier.status && cur.alive) tryApplyStatus(ctx, cur, tier.status);
    points.push({ x: cur.x, z: cur.z, flying: cur.flying });
    hitIds.push(cur.id);
    if (hitIds.length > jumps) break;
    let next: EnemySim | null = null;
    let bestD2 = Infinity;
    for (const e of ctx.world.enemies.items) {
      if (!e.alive || !canTarget(def, e) || hitIds.includes(e.id)) continue;
      const d2 = dist2(cur.x, cur.z, e.x, e.z);
      if (d2 > jumpR2) continue;
      if (d2 < bestD2 || (d2 === bestD2 && next && e.id < next.id)) {
        next = e;
        bestD2 = d2;
      }
    }
    mult *= decay;
    cur = next;
  }
  ctx.events.push({ type: 'towerFired', towerId: t.id, defId: def.id, targetId: target.id });
  ctx.events.push({ type: 'beamFired', towerId: t.id, defId: def.id, points });
}

/** 투사체 이동/명중 — 역순 순회로 제거 안전 */
export function updateProjectiles(ctx: SimCtx): void {
  const list = ctx.world.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list.items[i] as ProjectileState;
    p.prevX = p.x;
    p.prevY = p.y;
    p.prevZ = p.z;
    if (p.kind === 'ballistic') {
      p.elapsedTicks++;
      const t01 = p.elapsedTicks / p.flightTicks;
      p.x = lerp(p.startX, p.targetX, t01);
      p.z = lerp(p.startZ, p.targetZ, t01);
      p.y = lerp(0.6, 0, t01) + parabola(t01, p.arcHeight);
      if (p.elapsedTicks >= p.flightTicks) {
        impactBallistic(ctx, p);
        ctx.world.removeProjectileAt(i);
      }
    } else {
      // homing: 살아있는 타겟 추적, 죽으면 마지막 좌표로 직진 후 소멸(스플래시 있으면 폭발)
      const tgt = ctx.world.findEnemy(p.targetId);
      const tracking = tgt !== undefined && tgt.alive;
      if (tracking) {
        p.targetX = (tgt as EnemySim).x;
        p.targetZ = (tgt as EnemySim).z;
      }
      const dx = p.targetX - p.x;
      const dz = p.targetZ - p.z;
      const d = Math.hypot(dx, dz);
      const step = p.speed * TICK_DT;
      if (d <= step) {
        p.x = p.targetX;
        p.z = p.targetZ;
        p.y = 0.3;
        impactHoming(ctx, p, tracking ? (tgt as EnemySim) : null);
        ctx.world.removeProjectileAt(i);
      } else {
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        p.y = Math.max(0.3, p.y - 0.02);
      }
    }
  }
}

function impactHoming(ctx: SimCtx, p: ProjectileState, primary: EnemySim | null): void {
  if (primary) {
    damageEnemy(ctx, primary, p.dmg, p.towerDefId);
    if (p.status && primary.alive) tryApplyStatus(ctx, primary, p.status);
  }
  if (p.splash) {
    applyArea(ctx, p.x, p.z, p.dmg, p.splash, p.towerDefId, p.status, primary ? primary.id : -1);
  }
  ctx.events.push({ type: 'projectileHit', towerDefId: p.towerDefId, x: p.x, z: p.z, splash: !!p.splash });
}

function impactBallistic(ctx: SimCtx, p: ProjectileState): void {
  if (p.splash) {
    applyArea(ctx, p.x, p.z, p.dmg, p.splash, p.towerDefId, p.status, -1);
  } else {
    // 스플래시가 없으면 착탄점 최근접 단일 타격
    let hit: EnemySim | null = null;
    let bestD = Infinity;
    for (const e of ctx.world.enemies.items) {
      if (!e.alive || e.flying !== p.targetFlying) continue;
      const d = dist(p.x, p.z, e.x, e.z);
      if (d <= IMPACT_TOLERANCE + e.radius && d < bestD) {
        hit = e;
        bestD = d;
      }
    }
    if (hit) {
      damageEnemy(ctx, hit, p.dmg, p.towerDefId);
      if (p.status && hit.alive) tryApplyStatus(ctx, hit, p.status);
    }
  }
  ctx.events.push({ type: 'projectileHit', towerDefId: p.towerDefId, x: p.x, z: p.z, splash: !!p.splash });
}
