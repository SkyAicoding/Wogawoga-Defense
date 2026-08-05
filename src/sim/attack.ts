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
import { pathFor, type EnemySim, type ProjectileSim, type SimCtx } from './entities';
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

/** 오라 반경(drum/brazier) — 별 rangePct 보너스 적용 */
export function effAuraRadius(ctx: SimCtx, def: TowerDef, radius: number): number {
  return radius * (1 + starsOf(ctx, def) * (def.starBonus.rangePct ?? 0));
}

export function effCooldown(ctx: SimCtx, t: TowerState, def: TowerDef, tier: TowerTier): number {
  const mul = (1 + starsOf(ctx, def) * def.starBonus.ratePct) * (1 + t.buffRatePct);
  return Math.max(1, Math.round(tier.cooldownTicks / mul));
}

/** 감쇠 배율: 중심 1.0 → 가장자리 falloff (선형) */
function splashScale(d: number, splash: SplashSpec): number {
  return 1 - (1 - splash.falloff) * clamp01(d / splash.radius);
}

/**
 * 스플래시 피해 — 지상 적 전용 (공중 면제), excludeId는 직격 대상 제외용.
 * 반환값은 실제로 가한 피해 합 (연출 강도 산정용, 밸런스에는 영향 없음).
 */
function applyArea(
  ctx: SimCtx,
  x: number,
  z: number,
  dmg: number,
  splash: SplashSpec,
  source: TowerDef['id'],
  sourceTowerId: number,
  status: StatusApplySpec | undefined,
  excludeId: number,
): number {
  let dealt = 0;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive || e.flying || e.id === excludeId) continue;
    const d = dist(x, z, e.x, e.z);
    if (d > splash.radius + e.radius) continue;
    dealt += damageEnemy(ctx, e, dmg * splashScale(d, splash), source);
    if (status && e.alive) tryApplyStatus(ctx, e, status, sourceTowerId);
  }
  return dealt;
}

/** drum 버프 — 5틱마다 호출. 반경 내 타워의 buff%를 갱신 (중첩 시 최대값만, 자신 제외). */
export function recomputeBuffs(ctx: SimCtx): void {
  const towers = ctx.world.towers.items;
  for (const t of towers) {
    t.buffDmgPct = 0;
    t.buffRatePct = 0;
  }
  for (const d of towers) {
    // 침묵한 전쟁북은 버프도 멈춘다 — "입을 막는다"가 화력에만 적용되면 규칙이 반쪽이다.
    // (5틱 주기라 저주가 걸린 뒤 최대 5틱 늦게 반영되지만 drum 버프는 원래 그 지연을 갖는다)
    if (d.silenceLeft > 0) continue;
    const def = ctx.opts.towerDefs[d.defId];
    const tier = def.tiers[d.tier] as TowerTier;
    const aura = tier.aura;
    if (!aura || (aura.dmgPct === undefined && aura.ratePct === undefined)) continue;
    const r = effAuraRadius(ctx, def, aura.radius); // 별 rangePct 반영
    const r2 = r * r;
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
    /**
     * 침묵(hexer의 저주) — 발사·오라 피해가 멈추고 **쿨다운도 함께 얼어붙는다**.
     * 쿨다운만 계속 돌게 하면 타워가 침묵 중에 재장전을 끝내 놓고 풀리는 순간
     * 곧바로 쏘기 때문에, 장기 발사 횟수가 거의 줄지 않아 저주가 "발사 지연"밖에 안 된다
     * (실측: 300틱에 10발 → 10발). 함께 얼려야 잃는 화력이 곧 침묵 시간과 같아져
     * "주술사가 붙어 있으면 그 타워는 절반만 일한다"가 계산으로도 화면으로도 성립한다.
     */
    if (t.silenceLeft > 0) {
      t.silenceLeft--;
      continue;
    }
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
  const r = effAuraRadius(ctx, def, aura.radius); // 별 rangePct 반영
  for (const e of ctx.world.enemies.items) {
    if (!e.alive || e.flying) continue;
    if (dist2(t.cellX, t.cellZ, e.x, e.z) > r * r) continue;
    damageEnemy(ctx, e, dmg, def.id);
    if (status && e.alive) tryApplyStatus(ctx, e, status, t.id);
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
  p.sourceTowerId = t.id;
  p.tier = t.tier;
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
  p.sourceTowerId = t.id;
  p.tier = t.tier;
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
  let chainDmg = 0;
  while (cur) {
    chainDmg += damageEnemy(ctx, cur, baseDmg * mult, def.id);
    if (tier.status && cur.alive) tryApplyStatus(ctx, cur, tier.status, t.id);
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
  ctx.events.push({
    type: 'beamFired',
    towerId: t.id,
    defId: def.id,
    points,
    // 방패에 전부 막혀도 연출은 무기 위력을 반영해야 한다 — baseDmg를 하한으로
    dmg: Math.max(baseDmg, chainDmg),
    tier: t.tier,
  });
}

/** 투사체 이동/명중 — 역순 순회로 제거 안전 */
export function updateProjectiles(ctx: SimCtx): void {
  const list = ctx.world.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list.items[i] as ProjectileSim;
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

/**
 * 착탄 이벤트 — 연출 강도용 dmg/tier/splashRadius를 실어 보낸다.
 * dmg는 "무기 1발 위력(p.dmg)"을 하한으로 두고 스플래시 부가 피해를 더한 근사값이다.
 * (빗나가거나 방패에 막혀도 폭발이 사라지지 않게)
 */
function pushHit(ctx: SimCtx, p: ProjectileSim, extraDmg: number): void {
  ctx.events.push({
    type: 'projectileHit',
    towerDefId: p.towerDefId,
    x: p.x,
    z: p.z,
    splash: !!p.splash,
    dmg: p.dmg + extraDmg,
    tier: p.tier,
    ...(p.splash ? { splashRadius: p.splash.radius } : {}),
  });
}

function impactHoming(ctx: SimCtx, p: ProjectileSim, primary: EnemySim | null): void {
  if (primary) {
    // 홈타운의 화살은 발리스타 지오메트리를 빌려 쓸 뿐 발리스타가 쏜 게 아니다
    // (hometown.ts 규칙 6) — 피해 출처만 여기서 갈라진다.
    damageEnemy(ctx, primary, p.dmg, p.fromBase ? 'hometown' : p.towerDefId);
    if (p.status && primary.alive) tryApplyStatus(ctx, primary, p.status, p.sourceTowerId);
  }
  let area = 0;
  if (p.splash) {
    area = applyArea(
      ctx, p.x, p.z, p.dmg, p.splash, p.towerDefId, p.sourceTowerId, p.status,
      primary ? primary.id : -1,
    );
  }
  pushHit(ctx, p, area);
}

function impactBallistic(ctx: SimCtx, p: ProjectileSim): void {
  let area = 0;
  if (p.splash) {
    area = applyArea(ctx, p.x, p.z, p.dmg, p.splash, p.towerDefId, p.sourceTowerId, p.status, -1);
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
      if (p.status && hit.alive) tryApplyStatus(ctx, hit, p.status, p.sourceTowerId);
    }
  }
  pushHit(ctx, p, area);
}
