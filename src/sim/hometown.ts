/**
 * 홈타운(기지) — 가만히 맞기만 하던 거점이 **쏘고 성장한다**. 결정론 100%(rng 미사용).
 *
 * ── 행동 규칙 (확정) ───────────────────────────────────────────────────────
 * 1) **자기 셀에 고정된 사수다.**
 *    기지는 stage.baseCell에 서서 사거리 안에 들어온 적에게 화살을 쏜다. 움직이지 않고,
 *    부서지지 않으며, 팔 수도 없다. 사거리 판정은 타워와 완전히 같은 규약을 쓴다
 *    (셀 중심 ↔ 적 중심, dist2). 즉 홈타운은 "칸을 먹지 않는 타워 한 기"가 아니라
 *    **경로 끝에 붙박인 마지막 한 겹**이다.
 *
 *    사거리를 모든 공격 타워보다 짧게(2.0 → 3.0, frost T1이 2.4) 둔 것이 이 규칙의
 *    핵심이다. 홈타운이 타워보다 멀리 보면 "기지 근처에만 짓는" 단일해가 생기고
 *    배치 판단이 죽는다. 수치 근거 전문은 src/data/hometown.ts.
 *
 * 2) **타깃 = 사거리 내 최근접, 동점은 낮은 적 id. 유효한 동안 고정.**
 *    타워의 targeting 모드(first/last/strongest/nearest)를 주지 않았다.
 *    기지는 점 하나이고 그 점에서 사거리 안이면 이미 문간이라, "누가 더 앞섰나"가
 *    사실상 "누가 더 가까운가"와 같아진다 — 모드를 줘 봐야 네 개가 같은 답을 낸다.
 *    선택지를 없애는 대신 UI에서 타게팅 버튼 한 줄이 사라진다.
 *    고정(lock) 규약은 타워·습격대·아군과 동일하다: 살아 있고 사거리 안이면 안 바꾼다.
 *
 * 3) **공중도 쏜다.**
 *    아군 부족원은 근접이라 공중을 절대 막지 못하고(allies.ts 규칙 5), 공중 전용 레인은
 *    기지로 직행한다. 홈타운마저 지상 전용이면 이 기능은 프테라노돈 앞에서 통째로
 *    존재하지 않는 것이 된다. 화살은 원래 대공 무기이기도 하다.
 *    → 세 겹의 역할이 이것으로 갈린다: 아군 = 지상 전용 봉쇄, 홈타운 = 지상+공중 사격.
 *
 * 4) **레벨업 시 최대 HP가 오르면 현재 HP도 그 증가분만큼만 오른다.**
 *    hp += (newMax − oldMax). 즉 **누적 피해 절대량(maxHp − hp)이 보존된다** —
 *    한 번 새어 들어온 피해는 어떤 레벨업으로도 되돌릴 수 없다.
 *
 *    다른 두 안을 버린 이유:
 *     · 전량 회복 → 레벨업이 곧 완전 수리가 되어 이 게임의 유일한 회복 수단이 된다.
 *       그러면 최적해는 항상 "HP가 바닥날 때까지 버티다 레벨업"이고, 누수의 값이
 *       골드로 환산돼 패배 조건이 사라진다.
 *     · 비율 유지(hp = newMax × hp/oldMax) → 다친 만큼 덜 회복돼서 "다치기 전에 사라"는
 *       결 자체는 같은데, 같은 값을 내고 받는 HP가 그때그때 달라져 패널에 적을 숫자가
 *       없어진다("+15"라고 못 쓴다).
 *    절대 보존은 타워 업그레이드(battle.ts cmdUpgrade)가 이미 쓰는 규칙이라
 *    게임 전체에 규칙이 하나만 존재하게 된다. **패널에 적힌 +N이 곧 받는 N이다.**
 *
 *    다만 타워와 결정적으로 다른 점이 하나 있다: 타워는 prep마다 자동 수리되지만
 *    (siege.ts repairTowers) 홈타운은 **절대 회복되지 않는다**. 그래서 레벨업이
 *    주는 +N은 "잃은 것을 되찾는 것"이 아니라 순수한 증축이고, 늦게 살수록
 *    남은 웨이브가 짧아 값어치가 떨어진다 — 미리 사는 쪽이 이득이 되는 자연 감가다.
 *
 * 5) **침묵도 버프도 없다.**
 *    부족 주술사의 저주(applySilence)는 TowerState만 받는다 — 홈타운은 침묵하지 않는다.
 *    전쟁북(drum)의 버프도 world.towers만 순회하므로 닿지 않는다.
 *    둘 다 **의도적**이다: 저주가 걸리면 "최후 방어선이 침묵당해 손도 못 쓰고 지는" 판이
 *    생기고, 북이 닿으면 "기지 옆 북"이 사실상 강제 배치가 된다.
 *    대신 홈타운은 화력 단가에서 언제나 손해를 본다(hometown.ts 참조) — 그게 대가다.
 *
 * 6) **화살은 기존 투사체 파이프라인을 그대로 쓴다.**
 *    kind 'homing'으로 acquireProjectile 하고, 지오메트리는 **발리스타(뼈 볼트)를
 *    빌린다**(towerDefId = 'ballista'). 전용 InstancedMesh를 만드는 순간
 *    드로우콜 예산(합성 최대 프레임 60/60)이 깨지기 때문이다 — 아군 유닛이
 *    습격대 메시를 빌려 쓴 것과 같은 이유다. 피해 출처만 fromBase 플래그로 갈라져
 *    enemyDamaged.source가 'hometown'으로 나간다(attack.ts impactHoming).
 *
 * 7) **틱 순서: 타워 발사 직후, 투사체 이동 직전.**
 *    사수는 사수끼리 같은 스냅샷에서 쏴야 사거리 판정이 한쪽으로 기울지 않고,
 *    같은 틱의 투사체 단계에 실려야 화살의 비행 시간이 타워 것과 같은 규칙을 탄다.
 *
 * three/DOM 임포트 금지.
 */
import type { BaseLevelDef, TowerId } from '@/data/types';
import { baseMaxHpFor } from '@/data/balance';
import { dist2 } from '@/core/mathx';
import { addGold } from './combat';
import type { EnemySim, SimCtx } from './entities';

/**
 * 화살이 빌려 쓰는 투사체 지오메트리 (규칙 6). 발리스타 볼트 = 뼈촉 화살이라
 * 그림이 그대로 맞고, 이 메시는 ProjectileView가 항상 만들어 두므로 추가 비용이 0이다.
 */
const ARROW_MESH: TowerId = 'ballista';
/** 화살 속도 (타일/초). 사거리가 2~3타일이라 0.13~0.19초에 꽂힌다 */
const ARROW_SPEED = 16;
/** 발사 높이 — 타워와 같은 값(attack.ts) */
const ARROW_Y = 0.6;

/**
 * 레벨 테이블이 비었을 때의 폴백 — 피해 0이면 규칙 1이 통째로 꺼진다.
 * 통제 실험(tests/sim/arena.ts)이 기지 화력을 끄고 타워만 격리해 재는 경로이기도 하다.
 */
const NO_DEFENSE: BaseLevelDef = { cost: 0, hpMul: 1, dmg: 0, cooldownTicks: 30, range: 0 };

/** 홈타운의 시뮬레이션 전용 상태 (레벨은 공개 상태 view.baseLevel이 갖는다) */
export interface HometownSim {
  /** 발사 쿨다운 잔여 틱 */
  attackCdLeft: number;
  /** 조준 중인 적 id (-1 = 없음) — 규칙 2의 고정 타깃 */
  targetId: number;
}

export function createHometown(): HometownSim {
  return { attackCdLeft: 0, targetId: -1 };
}

/** level(1-base)의 정의. 범위를 벗어나면 무장 해제 폴백 */
export function levelDefAt(ctx: SimCtx, level: number): BaseLevelDef {
  return ctx.opts.baseLevels[level - 1] ?? NO_DEFENSE;
}

/** 지금 레벨의 정의 */
export function currentLevelDef(ctx: SimCtx): BaseLevelDef {
  return levelDefAt(ctx, ctx.view.baseLevel);
}

/** 전투 시작 시 Lv1 기준 최대 HP 확정 (hpMul이 1이 아닌 테이블도 지원) */
export function initialBaseHp(stageBaseHp: number, levels: readonly BaseLevelDef[]): number {
  const lv1 = levels[0];
  return baseMaxHpFor(stageBaseHp, lv1 ? lv1.hpMul : 1);
}

/** 한 단계 올리는 비용 (최대 레벨이면 null) */
export function baseUpgradeCost(ctx: SimCtx): number | null {
  // view.baseLevel이 1-base라 배열 인덱스 [baseLevel]이 곧 '다음 레벨'이다
  const next = ctx.opts.baseLevels[ctx.view.baseLevel];
  return next ? next.cost : null;
}

/** 지금 올릴 수 있는가 (최대 레벨 + 골드) — UI 비활성과 커맨드 거부가 같은 판정을 쓴다 */
export function canUpgradeBase(ctx: SimCtx): boolean {
  const cost = baseUpgradeCost(ctx);
  return cost !== null && ctx.view.gold >= cost;
}

/**
 * 다음 레벨이 주는 성능 (최대 레벨이면 null).
 * **되돌릴 수 없는 결제**라 무엇을 사는지가 결제 전에 화면에 있어야 한다 — 확인 단계와
 * 짝을 이루는 정보다("정말?"만 묻고 무엇을 사는지 안 알려주면 확인이 아니라 관문이다).
 * 최대 HP는 sim이 확정한 정수를 그대로 준다 — UI가 배율을 다시 곱하면 반올림이 갈린다.
 */
export function baseNextStats(
  ctx: SimCtx,
): { hpMax: number; dmg: number; range: number } | null {
  const next = ctx.opts.baseLevels[ctx.view.baseLevel];
  if (!next) return null;
  return {
    hpMax: baseMaxHpFor(ctx.opts.stage.baseHp, next.hpMul),
    dmg: next.dmg,
    range: next.range,
  };
}

/**
 * 레벨업 본체 — 규칙 4. 성공하면 골드를 깎고 최대 HP·현재 HP·공격력·사거리가 함께 오른다.
 * 거부 조건: 최대 레벨 / 골드 부족. (환불은 없다 — 되돌리는 경로 자체가 없다)
 */
export function upgradeBase(ctx: SimCtx): boolean {
  const v = ctx.view;
  const next = ctx.opts.baseLevels[v.baseLevel];
  if (!next) return false; // 최대 레벨
  if (v.gold < next.cost) return false;
  addGold(ctx, -next.cost);
  const oldMax = v.baseHpMax;
  const newMax = baseMaxHpFor(ctx.opts.stage.baseHp, next.hpMul);
  v.baseLevel++;
  v.baseHpMax = newMax;
  // 규칙 4) 늘어난 최대치만큼만 즉시 증축 — 누적 피해(maxHp − hp)는 그대로 남는다.
  // clamp는 hpMul이 줄어드는 비정상 테이블에서도 상태가 깨지지 않게 하는 방어선이다.
  v.baseHp = Math.min(newMax, Math.max(1, v.baseHp + (newMax - oldMax)));
  ctx.events.push({
    type: 'baseUpgraded',
    level: v.baseLevel,
    cost: next.cost,
    hp: v.baseHp,
    hpMax: newMax,
    dmg: next.dmg,
    range: next.range,
  });
  return true;
}

/** 규칙 2) 고정 타깃이 여전히 유효하면 반환, 아니면 null (재조준 필요) */
function lockedEnemy(ctx: SimCtx, ht: HometownSim, bx: number, bz: number, r2: number): EnemySim | null {
  if (ht.targetId < 0) return null;
  const e = ctx.world.findEnemy(ht.targetId);
  if (!e || !e.alive) return null;
  return dist2(bx, bz, e.x, e.z) <= r2 ? e : null;
}

/** 규칙 2) 사거리 내 최근접 적 (동점은 낮은 id — 완전 결정론). 규칙 3) 공중도 센다 */
function nearestEnemy(ctx: SimCtx, bx: number, bz: number, r2: number): EnemySim | null {
  let best: EnemySim | null = null;
  let bestD2 = Infinity;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive) continue;
    const d2 = dist2(bx, bz, e.x, e.z);
    if (d2 > r2) continue;
    if (d2 < bestD2 || (d2 === bestD2 && best !== null && e.id < best.id)) {
      best = e;
      bestD2 = d2;
    }
  }
  return best;
}

/** 규칙 6) 화살 한 발 — 타워의 fireHoming과 같은 구조, fromBase만 다르다 */
function fireArrow(ctx: SimCtx, def: BaseLevelDef, target: EnemySim, bx: number, bz: number): void {
  const p = ctx.world.acquireProjectile();
  p.kind = 'homing';
  p.towerDefId = ARROW_MESH;
  p.fromBase = true;
  p.sourceTowerId = -1; // 상태이상을 걸지 않으므로 스택 소스가 필요 없다
  p.tier = 0;
  p.x = p.prevX = p.startX = bx;
  p.z = p.prevZ = p.startZ = bz;
  p.y = p.prevY = ARROW_Y;
  p.targetId = target.id;
  p.targetX = target.x;
  p.targetZ = target.z;
  p.flightTicks = 0;
  p.elapsedTicks = 0;
  p.arcHeight = 0;
  p.speed = ARROW_SPEED;
  p.dmg = def.dmg;
  p.splash = undefined;
  p.status = undefined;
  p.targetFlying = target.flying;
  ctx.events.push({
    type: 'baseFired',
    targetId: target.id,
    x: bx,
    z: bz,
    level: ctx.view.baseLevel,
  });
}

/**
 * 매 틱 — 홈타운 조준/발사 (규칙 1·2·3).
 * 틱 순서상 updateTowers 직후, updateProjectiles 직전이다 (규칙 7).
 * prep 단계에는 살아 있는 적이 0마리임이 보장되므로 자연히 아무 일도 하지 않는다.
 */
export function updateHometown(ctx: SimCtx): void {
  const ht = ctx.hometown;
  if (ht.attackCdLeft > 0) ht.attackCdLeft--;
  const def = currentLevelDef(ctx);
  if (def.dmg <= 0 || def.range <= 0) {
    ht.targetId = -1; // 무장 해제 테이블 (통제 실험용)
    return;
  }
  const cell = ctx.opts.stage.baseCell;
  const r2 = def.range * def.range;
  const target = lockedEnemy(ctx, ht, cell.x, cell.z, r2) ?? nearestEnemy(ctx, cell.x, cell.z, r2);
  ht.targetId = target ? target.id : -1;
  if (!target || ht.attackCdLeft > 0) return;
  fireArrow(ctx, def, target, cell.x, cell.z);
  ht.attackCdLeft = Math.max(1, Math.round(def.cooldownTicks));
}
