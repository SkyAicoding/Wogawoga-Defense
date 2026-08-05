/**
 * 공성 — 적 부족(사람) 유닛이 우리 타워를 때려 부수는 행동. 결정론 100%(rng 미사용).
 *
 * ── 행동 규칙 (확정) ───────────────────────────────────────────────────────
 * 1) 경로 이탈 없음.
 *    적은 항상 경로 폴리라인 위를 걷는다. 타워를 향해 다가가지 않는다.
 *    "걷다 보니 사거리에 들어온 타워"만 때린다. 경로 구조(path.ts의 호장 파라미터화)를
 *    건드리지 않으므로 기존 이동/타게팅/누수 로직이 전부 그대로 유효하다.
 *    → 결과적으로 **경로에 붙여 지은 타워만 위험하다**. 배치 거리가 곧 위험도라는
 *      읽기 쉬운 규칙이 생기고, 플레이어에게 "안전하게 멀리 vs 강하게 가까이"라는
 *      실제 선택지를 준다.
 *
 * 2) 타깃 선택 = 사거리 내 최근접, 동점은 낮은 towerId.
 *    가장 약한(hp 최소) 타워를 고르는 안도 검토했으나 버렸다 — 무리 전체가 한 타워에
 *    집중돼 순삭이 나고, 무엇보다 "눈앞의 움막을 놔두고 저 멀리를 때린다"는 그림이
 *    설명 불가능하다. 최근접은 화면에서 이유가 보인다.
 *    타이브레이크를 id로 고정해 부동소수 동률에서도 결정론이 깨지지 않는다.
 *
 * 3) 타깃 고정 — 유효한 동안 갈아타지 않는다.
 *    유효 = 타워가 살아 있고 여전히 사거리 안. (타워의 lockedTarget 규약과 대칭)
 *    매 틱 최근접을 재평가하면 무리가 지나가며 타깃을 계속 바꿔 아무것도 부수지 못한다.
 *
 * 4) 멈춤 여부는 근접/원거리로 갈린다 (TowerAttackSpec.stopToAttack).
 *    · 근접(칼·창, 사거리 ~1.5): 멈춰 서서 두들긴다.
 *      멈추지 않으면 짧은 사거리 탓에 스쳐 지나가며 1~2대만 때리고 사라져 위협이 없다.
 *      멈춤은 플레이어에게 보상이기도 하다 — 타워가 방벽이 되어 적의 기지 도달이 늦어진다
 *      (타워를 잃는 대신 시간을 번다). 유닛 간 충돌이 없는 게임이라(경로 위 겹침 허용)
 *      "뒤 유닛이 밀린다" 문제는 발생하지 않고 그 자리에 겹쳐 함께 두들긴다.
 *    · 원거리(활·주술, 사거리 ~2.2+): 걸으면서 쏜다.
 *      멈추게 하면 긴 사거리 탓에 경로 초입에서부터 정지해 전선이 영구 정체되고,
 *      최악의 경우 아무도 기지에 도달하지 않는 스톨(무한 교착)이 난다.
 *      "지나가며 갉아먹는" 압박이 원거리의 정체성이다.
 *
 * 5) 스턴은 완전 무력화 — 타깃을 놓고 쿨다운도 흐르지 않는다.
 *    (이동이 0인데 공격만 되는 그림은 설명이 안 된다)
 *
 * 6) 첫 타격은 사거리 진입 즉시(스폰 시 쿨다운 0), 이후 cooldownTicks 간격.
 *    무리가 통째로 동시 타격하는 스파이크가 걱정되지만, 스폰이 intervalTicks로
 *    어긋나 있어 실제로는 자연스럽게 분산된다.
 *
 * 7) 파괴는 환불 없음. 판매(sellTower, 60% 환급)와 명확히 구분된다 —
 *    "부서지기 전에 팔 것인가"라는 판단이 생긴다.
 *
 * 8) 침묵(hexer의 저주)은 피해와 같은 타격에 실려 나간다.
 *    타워는 살아 있지만 발사·오라·버프 방출이 멈춘다(조준 상태는 유지).
 *    부수는 것과 다른 축의 압박이라 "먼저 주술사를 잡을 것인가"라는 표적 선택이 생긴다.
 *
 * 9) **감속(얼음)은 타워를 부수는 힘도 깎는다** — 피해 × slowFactor.
 *    3단계에 추가한 규칙이고, 이유는 밸런스가 아니라 **빌드 다양성**이다.
 *
 *    도입 전 실측(tests/sim/arena.ts 통제 실험): 얼음은 습격대에 **아무 효과가 없었다**.
 *    이 게임의 감속은 이동만 늦추는데,
 *     · 근접은 멈춰 서서 때리므로 이동 감속이 애초에 닿지 않고,
 *     · 걸으며 쏘는 원거리는 더 고약하다 — 느려지면 사거리 안에 머무는 시간이
 *       1/s배로 늘어 **오히려 더 쏜다**(사거리 구간 L, 속도 v·s, 간격 C
 *       ⇒ 발사 수 = L/(v·s·C)). 그렇다고 쿨다운까지 s배로 늦추면 간격이 C/s가 되어
 *       발사 수 = L·s/(v·s·C) = L/(v·C) — s가 **완전히 소거**된다.
 *    실제로 쿨다운 감속안을 넣어 재봤더니 모든 배치에서 타워 피해가 1의 자리까지
 *    동일했다(catapult×3+frost 192 대 catapult×4 192 등). 즉 "습격대의 답은 화력뿐"이
 *    데이터였고, 그러면 얼음·북 같은 통제 계열이 습격대 앞에서 죽은 카드가 된다.
 *
 *    그래서 **피해량**에 감속률을 건다. 상쇄가 원리적으로 불가능한 축이고
 *    (체류 시간이 늘어도 한 대의 위력은 그대로 줄어든다), 근접·원거리에 똑같이 걸리며,
 *    화면에서 그대로 읽힌다 — 얼어붙은 팔에는 힘이 실리지 않아 피해 숫자가 작아진다.
 *    35% 감속이면 그 대상이 타워에 넣는 피해도 35% 준다. 기지 피해(누수)는 공격이 아니라
 *    도달로 계산되므로 이 규칙과 무관하다 — 일관성 문제도 생기지 않는다.
 *
 *    **과대평가 금지**: 이걸로 얼음이 습격대의 '정답'이 되지는 않는다. 같은 골드에서
 *    화력 타워 한 기를 얼음으로 바꾸면 통제 실험의 모든 배치에서 손해였다 —
 *    얼음은 단일 대상·20틱 주기라 무리 전체를 얼릴 수 없기 때문이고, 그건 피해 감소율을
 *    아무리 키워도 안 바뀐다(병목이 효과 크기가 아니라 적용 빈도다).
 *    이 규칙이 하는 일은 얼음이 습격대 앞에서 **죽은 카드가 되는 것을 막는** 것이다.
 *    같은 덱에서 규칙 9만 켜고 끈 A/B (스테이지1, 시드 40개, 덱 spear+catapult+frost,
 *    보상 상한 도입 이후 재측정):
 *      규칙 9 ON  → 28/40승 · 기지HP합 196 · 판당 파괴 9.3기 · 손실골드 6,958
 *      규칙 9 OFF → 27/40승 · 186 · 10.0기 · 7,523
 *    **주의 — 이 A/B를 '덱에 frost를 넣는 것이 이득이다'로 읽으면 안 된다.**
 *    덱 슬롯을 두고 비교하면 frost는 어느 조합에서든 손해다(catapult 단독 24/24승 대
 *    catapult+frost 19/24승). 그건 규칙 9가 아니라 타워 간 화력 격차(catapult 지배)
 *    문제이고 습격대 이전부터 있던 것이다 — 습격대를 빼도 순위가 같다(실측 확인).
 *
 * 10) **무한 모드에서는 공성 피해도 초과분만큼 커진다** (EnemySim.siegeMul).
 *    towerAttack.dmg는 상수인데 적 HP만 1.06^n으로 커지면, 무한 모드 후반에는
 *    "타워를 부수는 적"이 사실상 사라진다 — w100에서 archer 실HP 24,740 대
 *    타워 피해 11(만렙 T5 1,316을 혼자 부수는 데 159.5초)이라, 실측에서 습격대 유무의
 *    도달 웨이브 차이가 0.3%였다. 웨이브 곡선(hpMul)까지 곱하면 정규 6스테이지가
 *    통째로 흔들리므로(stage6은 hpBase만 2.2다) **초과분에만** 건다 —
 *    정규 웨이브에서는 siegeMul이 정확히 1이라 이 규칙은 아무 영향이 없다.
 *
 * three/DOM 임포트 금지.
 */
import { STATUS_TICK_INTERVAL } from '@/data/types';
import type { TowerId, TowerState } from '@/data/types';
import { TOWER_REPAIR_PER_STATUS_TICK, towerMaxHpFor } from '@/data/balance';
import { dist2 } from '@/core/mathx';
import { damageTower } from './combat';
import type { EnemySim, SimCtx } from './entities';
import { isStunned, slowFactor } from './status';

/** 타워 최대 HP — 티어 + 메타 별 + 타워별 내구도(toughness) */
export function maxHpFor(ctx: SimCtx, defId: TowerId, tier: number): number {
  const def = ctx.opts.towerDefs[defId];
  return towerMaxHpFor(tier, ctx.opts.stars[defId] ?? 0, def.toughness ?? 1);
}

/** 현재 고정 타깃이 여전히 유효하면 반환, 아니면 null (재조준 필요) */
function lockedTower(ctx: SimCtx, e: EnemySim, r2: number): TowerState | null {
  if (e.towerTargetId < 0) return null;
  for (const t of ctx.world.towers.items) {
    if (t.id !== e.towerTargetId) continue;
    if (t.hp <= 0) return null;
    return dist2(t.cellX, t.cellZ, e.x, e.z) <= r2 ? t : null;
  }
  return null;
}

/** 사거리 내 최근접 타워 (동점은 낮은 id — 완전 결정론) */
function nearestTower(ctx: SimCtx, e: EnemySim, r2: number): TowerState | null {
  let best: TowerState | null = null;
  let bestD2 = Infinity;
  for (const t of ctx.world.towers.items) {
    if (t.hp <= 0) continue;
    const d2 = dist2(t.cellX, t.cellZ, e.x, e.z);
    if (d2 > r2) continue;
    if (d2 < bestD2 || (d2 === bestD2 && best !== null && t.id < best.id)) {
      best = t;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * 매 틱 — 적의 타워 공격 판정. moveEnemies보다 **먼저** 돌아야 한다:
 * 여기서 정한 towerTargetId를 보고 이동 단계가 전진 정지를 결정하기 때문이다.
 */
export function updateSiege(ctx: SimCtx): void {
  const towers = ctx.world.towers.items;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive) continue;
    const spec = e.def.towerAttack;
    if (spec === undefined) continue; // 타워를 무시하는 적 (기존 12종 대부분)
    if (isStunned(e)) {
      // 규칙 5) 스턴 = 완전 무력화. 쿨다운도 멈춘다
      e.towerTargetId = -1;
      continue;
    }
    if (e.attackCdLeft > 0) e.attackCdLeft--;
    if (towers.length === 0) {
      e.towerTargetId = -1;
      continue;
    }
    const r2 = spec.range * spec.range;
    const target = lockedTower(ctx, e, r2) ?? nearestTower(ctx, e, r2);
    e.towerTargetId = target ? target.id : -1;
    if (!target || e.attackCdLeft > 0) continue;
    // 규칙 9) 감속(얼음)은 **타워를 부수는 힘**을 그만큼 깎는다 (헤더 참조).
    // siegeMul은 무한 모드 초과분(1.06^n)뿐이라 정규 스테이지에서는 항상 1이다 (규칙 10).
    // damageTower가 round + 최소 1을 보장하므로 소수를 그대로 넘긴다.
    damageTower(ctx, target, spec.dmg * slowFactor(e) * e.siegeMul, e, spec.ranged);
    // 저주(hexer)는 **살아남은** 타워에만 건다 — 이번 타격에 부서졌으면 의미가 없다
    if (spec.silenceTicks !== undefined && spec.silenceTicks > 0 && target.hp > 0) {
      applySilence(ctx, target, spec.silenceTicks, e);
    }
    e.attackCdLeft = Math.max(1, Math.round(spec.cooldownTicks));
  }
}

/**
 * 침묵 부여 — **중첩이 아니라 max 갱신**.
 * 합산으로 하면 주술사 서넛이 모인 순간 타워가 웨이브 내내 영구 봉쇄되어
 * "처리하면 풀린다"는 회복 경로가 사라진다. max 갱신이면 여럿이 와도
 * 잠기는 시간은 같고, 대신 저주가 끊기지 않을 뿐이다.
 */
export function applySilence(ctx: SimCtx, t: TowerState, ticks: number, caster: EnemySim): void {
  const n = Math.max(1, Math.round(ticks));
  if (n > t.silenceLeft) t.silenceLeft = n;
  ctx.events.push({
    type: 'towerSilenced',
    towerId: t.id,
    defId: t.defId,
    cellX: t.cellX,
    cellZ: t.cellZ,
    ticksLeft: t.silenceLeft,
    casterId: caster.id,
    casterDefId: caster.defId,
  });
}

/** 규칙 4) 이 적이 지금 타워를 때리느라 멈춰 서 있는가 (이동 단계가 묻는다) */
export function isSieging(e: EnemySim): boolean {
  return e.towerTargetId >= 0 && e.def.towerAttack?.stopToAttack === true;
}

/**
 * 부서진 타워 회수 — updateSiege 직후, 타워 발사 단계보다 먼저 호출한다
 * (이번 틱에 부서진 타워는 이번 틱에 쏘지 못한다).
 * 반환값 true면 호출자가 배치 지가/버프 캐시를 재계산해야 한다.
 */
export function sweepDestroyedTowers(ctx: SimCtx): boolean {
  const items = ctx.world.towers.items;
  let removed = false;
  for (let i = items.length - 1; i >= 0; i--) {
    if ((items[i] as TowerState).hp > 0) continue;
    ctx.world.towers.removeAt(i);
    removed = true;
  }
  return removed;
}

/**
 * 준비 단계 자동 수리 — STATUS_TICK_INTERVAL(0.5초) 경계에서만 호출.
 * 정수 회복(올림)이라 hp가 항상 정수로 유지된다 → 해시가 부동소수에 흔들리지 않는다.
 */
export function repairTowers(ctx: SimCtx): void {
  for (const t of ctx.world.towers.items) {
    if (t.hp >= t.maxHp) continue;
    t.hp = Math.min(t.maxHp, t.hp + Math.ceil(t.maxHp * TOWER_REPAIR_PER_STATUS_TICK));
  }
}

/** prep 수리 주기 판정 — battle.ts와 상수를 공유하기 위한 얇은 래퍼 */
export function isRepairTick(tick: number): boolean {
  return tick % STATUS_TICK_INTERVAL === 0;
}
