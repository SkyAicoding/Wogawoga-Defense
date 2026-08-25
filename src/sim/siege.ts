/**
 * 공성 — 적 부족(사람) 유닛이 우리 타워를 때려 부수는 행동. 결정론 100%(rng 미사용).
 *
 * ── 행동 규칙 (확정) ───────────────────────────────────────────────────────
 * 1) 경로 이탈 없음.
 *    적은 항상 경로 폴리라인 위를 걷는다. 타워를 향해 다가가지 않는다.
 *    "걷다 보니 사거리에 들어온 타워"만 때린다. 경로 구조(path.ts의 호장 파라미터화)를
 *    건드리지 않으므로 기존 이동/타게팅/누수 로직이 전부 그대로 유효하다.
 *    → 결과적으로 **경로에서 얼마나 떨어뜨렸는가가 곧 위험도**다. 읽기 쉬운 규칙이
 *      생기고, 플레이어에게 "안전하게 멀리 vs 강하게 가까이"라는 실제 선택지를 준다.
 *      **선이 둘이라는 점에 주의한다.**
 *       · **정지선** SIEGE_ENGAGE_RANGE(1.7) — 이 밖이면 그 앞에 **멈춰 설 수 없다**.
 *         격자에서 이격 2칸이면 어떤 종도 못 선다(피해의 대부분이 여기서 빠진다).
 *       · **사거리선** 종별 towerAttack.range — 이 밖이면 **아예 닿지 않는다**.
 *       둘은 다른 값이고 대가도 다르다: 2칸은 커버 −31%로 정지 사격을 지우고,
 *       3·4칸은 대부분의 타워가 경로를 못 덮는 값을 치르고 사격 자체를 지운다.
 *       (전원 원거리 개편의 부수 효과: **전위(blade·lancer)의 사거리선이 2칸 → 3칸**으로
 *       밀렸다. 근접 시절 1.5/1.95라 두 칸(2.0)이면 영구 무력화였는데 2.4/2.8이
 *       두 칸에 닿기 때문이다. 전원에 대한 완전 안전선은 4칸으로 그대로다
 *       — 최장 hexer 3.6은 3칸(3.0)에 닿고 4칸(4.0)에는 못 닿는다.
 *       tests/sim/raiddefense.test.ts가 두 선을 다 잠근다)
 *
 * 1-b) **발이 묶이면 타워를 때리지 않는다.**
 *    아군 부족원이 봉쇄한 적(blockerAllyId >= 0)은 이 단계를 통째로 건너뛴다.
 *    자세한 근거는 src/sim/allies.ts 규칙 5 — 요약하면 "눈앞의 사람을 놔두고 멀리 있는
 *    움막을 두들기는 그림은 설명이 안 되고, 무엇보다 그게 아군 유닛을 사는 이유다".
 *    그래서 updateAllies가 updateSiege보다 **먼저** 돈다(battle.ts 틱 순서).
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
 * 4) **공격 가능 지점에서 멈춰 서서 쏜다** — 습격대 전원이 원거리 정지 사격을 한다.
 *
 *    ── 옛 규칙 4 (전문 보존, 지우지 않는다) ─────────────────────────────────
 *    "멈춤 여부는 근접/원거리로 갈린다 (TowerAttackSpec.stopToAttack).
 *     · 근접(칼·창, 사거리 ~1.5): 멈춰 서서 두들긴다. 멈추지 않으면 짧은 사거리 탓에
 *       스쳐 지나가며 1~2대만 때리고 사라져 위협이 없다. 멈춤은 플레이어에게
 *       보상이기도 하다 — 타워가 방벽이 되어 적의 기지 도달이 늦어진다(타워를 잃는
 *       대신 시간을 번다). 유닛 간 충돌이 없는 게임이라(경로 위 겹침 허용) '뒤 유닛이
 *       밀린다' 문제는 발생하지 않고 그 자리에 겹쳐 함께 두들긴다.
 *     · 원거리(활·주술, 사거리 ~2.2+): 걸으면서 쏜다. 멈추게 하면 긴 사거리 탓에
 *       경로 초입에서부터 정지해 전선이 영구 정체되고, 최악의 경우 아무도 기지에
 *       도달하지 않는 스톨(무한 교착)이 난다. '지나가며 갉아먹는' 압박이 원거리의
 *       정체성이다."
 *    ─────────────────────────────────────────────────────────────────────────
 *    옛 규칙의 **위험 진단은 지금도 옳다**(그래서 지우지 않았다). 바뀐 것은 그 위험을
 *    "원거리는 멈추지 않는다"로 피하지 않고 4-a·4-b 두 규칙으로 **막았다**는 점이다.
 *    근접을 버린 이유는 밸런스가 아니라 기능 부재다: 근접(칼 1.5 / 창 1.95)은 경로에서
 *    두 칸 떨어뜨리는 것만으로 영구 무력화되어, 3단계 실측에서 **칼잡이 108명의 타워
 *    피해 총합이 0**이었다(enemies.ts archer 주석). 잘 두는 플레이어에게 존재하지 않는
 *    기능이라면 그건 위협이 아니라 장식이다.
 *
 *  4-a) **멈추는 거리 = 반격당할 수 있는 거리.**
 *    정지 거리 = min(자기 사거리, SIEGE_ENGAGE_RANGE, towerReach(대상)).
 *    멈춰 선 습격대는 **언제나 자기가 때리는 타워의 사거리 안**에 있다
 *    → "적이 타워 사거리 밖에 자리 잡고 일방적으로 두들긴다"가 규칙 차원에서 불가능하다.
 *    반격하지 못하는 타워(화력 0인 전쟁북)의 towerReach는 0이라 그 앞에는 서지 않는다 —
 *    쏘긴 쏘되 걸으면서 쏜다. **걸으며 쏘는 사격은 이 규칙 밖**이다(사거리 안에
 *    들어온 순간부터 쏜다). 즉 정지는 '더 쏘기 위해 위험을 사는' 거래이고,
 *    그 대가가 규칙으로 보장된다.
 *
 *    SIEGE_ENGAGE_RANGE(1.7)가 종별 취향이 아니라 공통값인 이유는 balance.ts 주석 참조 —
 *    요약하면 이 값이 정하는 것은 '얼마나 자주 멈추나'가 아니라 **어느 칸에 지은
 *    타워가 붙잡히나**이고, 1.7은 이격 1칸(폭 2.75타일의 정지 구간)만 붙잡고
 *    이격 2칸은 붙잡지 않는다 — 그래서 규칙 1의 '거리 = 위험도'가 데이터로 성립한다.
 *    (9단계의 2.1은 두 칸까지 붙잡아 그 축을 지웠다. 실측 정지 사격 비율
 *     이격2 43.6% → 1.2% · 이격1 43.1% → 42.4%)
 *
 *  4-b) **유한 정지 — 한 번 멈추면 반드시 전진 의무를 진다.**
 *    정지는 holdTicks(종별)까지만이고, 끝나는 사유(상한 소진 / 대상 파괴 / 사거리 이탈 /
 *    스턴 / 아군 봉쇄) **무관하게** 그 뒤 SIEGE_ADVANCE_TICKS(120틱) 동안은 어떤 타워
 *    앞에서도 다시 멈추지 못한다. 예외가 **0개**라는 것이 이 규칙의 전부다 —
 *    "정지 → 전진 → 정지"의 전진 몫이 상수로 보장되므로 전진 이동 틱 비율이
 *    W/(H+W) 아래로 내려갈 수 없다(최장 hold 90 → 57%). 스톨은 가능한 상태가 아니다.
 *    전진 의무 잔여는 **실제로 전진한 틱에만** 준다(entities.ts siegeWalkLeft) —
 *    봉쇄·스턴으로 못 걷는 시간이 의무를 갉아먹으면 "묶여 있다 풀리자마자 또 멈춤"이
 *    가능해져 보장이 깨진다.
 *    tests/sim/siege.test.ts의 '불멸 타워 도배' 넷이 이 성질을 잠근다.
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
 *    35% 감속이면 그 대상이 타워에 넣는 피해도 35% 준다. 기지 피해는 공격이 아니라
 *    **도달**로 계산되므로 이 규칙과 무관하다 — 일관성 문제도 생기지 않는다.
 *
 *    ⚠ 11단계(문간 교전) 정정 — 위 문장의 **범위만** 다시 쓴다. 적은 이제 경로 끝에서
 *      사라지지 않고 마을 문 앞에 서서 `GATE_BITE_TICKS` 마다 마을을 문다(src/sim/gate.ts).
 *      그래도 이 규칙은 **여전히 걸리지 않는다**: 한 입은 휘두름이 아니라 *도착이 확정한
 *      총액(`baseDamage`)의 분납*이고, 총액은 도달이 정하기 때문이다. 곧 깎을 '한 대의
 *      위력'이 없다.
 *      실무적으로도 그래야 한다 — 한 입이 1 로 고정이라 `max(1, round(1 × 0.65))` = **1** 이다.
 *      감속을 곱하면 규칙이 화면에 아무 차이도 못 만들면서 주석만 거짓이 된다.
 *      (`claude/gate-wip` 이 이 문단을 뒤집었다가 정확히 그 상태가 됐다. 되돌려 놓는다)
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
import type { TowerAttackSpec, TowerId, TowerState } from '@/data/types';
import {
  RAID_ATTACK_ANIM_TICKS,
  SIEGE_ADVANCE_TICKS,
  SIEGE_ENGAGE_RANGE,
  TOWER_REPAIR_PER_STATUS_TICK,
  towerMaxHpFor,
} from '@/data/balance';
import { dist, dist2 } from '@/core/mathx';
import { effAuraRadius, effRange } from './attack';
import { damageTower } from './combat';
import type { EnemySim, SimCtx } from './entities';
import { isStunned, slowFactor } from './status';
import { atGate } from './gate';

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
 * 규칙 4-a) 이 타워가 **이 적에게 반격할 수 있는 반경** (타일). 0 = 반격 불가.
 * 정지 거리의 상한이라, 여기가 0이면 그 타워 앞에서는 절대 멈추지 않는다.
 * 타워의 실제 사격 판정과 같은 함수(effRange/effAuraRadius)를 써야
 * "멈춰 섰는데 타워가 못 쏜다"는 어긋남이 생기지 않는다.
 */
function towerReach(ctx: SimCtx, t: TowerState, e: EnemySim): number {
  const def = ctx.opts.towerDefs[t.defId];
  const tier = def.tiers[t.tier];
  if (tier === undefined) return 0;
  // 지상/공중 표적 제한 — 못 겨누는 적에게는 반격이 없다
  if (e.flying ? !def.canTargetAir : !def.canTargetGround) return 0;
  if (def.attackKind === 'aura' || def.attackKind === 'pulse') {
    const aura = tier.aura;
    // 버프 전용(drum)은 화력이 0이다 — 반격하지 못하는 타워 앞에는 서지 않는다
    if (!aura || aura.dmgPerStatusTick === undefined || aura.dmgPerStatusTick <= 0) return 0;
    return effAuraRadius(ctx, def, aura.radius);
  }
  return tier.dmg > 0 ? effRange(ctx, def, tier) : 0;
}

/** 규칙 4-a) 이 적이 이 타워 앞에서 멈춰 설 수 있는 거리 (0이면 멈추지 않는다) */
function stopDistFor(ctx: SimCtx, e: EnemySim, spec: TowerAttackSpec, t: TowerState): number {
  // 자기 사거리도 상한이다 — 데이터가 SIEGE_ENGAGE_RANGE보다 짧은 사거리를 주면
  // 정지선에 멈춰 서서 닿지도 않는 타워를 겨누는 그림이 된다
  return Math.min(spec.range, SIEGE_ENGAGE_RANGE, towerReach(ctx, t, e));
}

/**
 * 규칙 4-b) 전진 의무 부과 — **정지가 끝나는 모든 경로가 반드시 여기를 지난다.**
 * 상한 소진도 예외가 아니다(그 사유만 빠뜨리면 무리가 타워를 옮겨 다니며 영구히
 * 서 있게 되어 스톨이 그대로 재현된다 — 실제로 한 번 그렇게 짰다가 정지 듀티 97% ·
 * 8마리 전원 기지 미도달로 잡혔다).
 */
function requireAdvance(e: EnemySim): void {
  e.siegeHoldLeft = 0;
  e.siegeWalkLeft = SIEGE_ADVANCE_TICKS;
}

/**
 * 정지 종료 — 서 있었다면 전진 의무를 지운다.
 * 걷던 적에게는 아무 일도 하지 않는다(의무를 씌우면 사거리 밖을 걷던 적까지 묶인다).
 */
function endHold(e: EnemySim): void {
  if (e.siegeHoldLeft > 0) requireAdvance(e);
}

/** 규칙 4) 이번 틱의 정지 판정 — 멈춰 설 수 있으면 서고, 조건이 깨지면 즉시 전진 의무 */
function updateHold(
  ctx: SimCtx,
  e: EnemySim,
  spec: TowerAttackSpec,
  target: TowerState | null,
): void {
  const canHold =
    spec.stopToAttack &&
    target !== null &&
    e.siegeWalkLeft <= 0 && // 4-b) 전진 의무 중에는 어떤 타워 앞에서도 못 선다
    dist2(target.cellX, target.cellZ, e.x, e.z) <= stopDistFor(ctx, e, spec, target) ** 2;
  if (e.siegeHoldLeft > 0) {
    // 상한 소진(--가 0 이하) 또는 조건 이탈 — 어느 쪽이든 **같은** 의무를 진다
    if (!canHold || --e.siegeHoldLeft <= 0) requireAdvance(e);
    return;
  }
  if (!canHold) return;
  const hold = Math.max(0, Math.round(spec.holdTicks));
  if (hold > 0) e.siegeHoldLeft = hold;
}

/**
 * 한 발 — 무기를 놓고(raidAttack), 피해를 넣고(towerDamaged), 쿨다운을 건다.
 * raidAttack을 **먼저** 보내는 이유는 인과 순서 그대로다: 던지는 것이 먼저이고
 * 맞는 것이 나중이다. 연출이 두 사건을 순서대로 읽을 수 있어야 한다.
 */
function fireAtTower(ctx: SimCtx, e: EnemySim, spec: TowerAttackSpec, t: TowerState): void {
  // 규칙 9) 감속(얼음)은 **타워를 부수는 힘**을 그만큼 깎는다 (헤더 참조).
  // siegeMul은 무한 모드 초과분(1.06^n)뿐이라 정규 스테이지에서는 항상 1이다 (규칙 10).
  const raw = spec.dmg * slowFactor(e) * e.siegeMul;
  // damageTower와 **같은 식**으로 미리 확정한다 — 이벤트의 amount가 실제 피해와
  // 어긋나면 연출 강도와 화면의 숫자가 갈라진다
  const amount = Math.max(1, Math.round(raw));
  const animTicks = Math.max(1, Math.min(RAID_ATTACK_ANIM_TICKS, Math.round(spec.cooldownTicks)));
  e.attackAnimTicks = animTicks;
  e.attackAnimLeft = animTicks;
  ctx.events.push({
    type: 'raidAttack',
    attackerId: e.id,
    attackerDefId: e.defId,
    x: e.x,
    z: e.z,
    towerId: t.id,
    towerDefId: t.defId,
    cellX: t.cellX,
    cellZ: t.cellZ,
    aim: Math.atan2(t.cellZ - e.z, t.cellX - e.x),
    dist: dist(t.cellX, t.cellZ, e.x, e.z),
    ranged: spec.ranged,
    planted: e.siegeHoldLeft > 0,
    amount,
    animTicks,
  });
  // damageTower가 round + 최소 1을 보장하므로 소수를 그대로 넘긴다
  damageTower(ctx, t, raw, e, spec.ranged);
  // 저주(hexer)는 **살아남은** 타워에만 건다 — 이번 타격에 부서졌으면 의미가 없다
  if (spec.silenceTicks !== undefined && spec.silenceTicks > 0 && t.hp > 0) {
    applySilence(ctx, t, spec.silenceTicks, e);
  }
  e.attackCdLeft = Math.max(1, Math.round(spec.cooldownTicks));
}

/**
 * 매 틱 — 적의 타워 공격 판정. moveEnemies보다 **먼저** 돌아야 한다:
 * 여기서 정한 siegeHoldLeft를 보고 이동 단계가 전진 정지를 결정하기 때문이다.
 */
export function updateSiege(ctx: SimCtx): void {
  const towers = ctx.world.towers.items;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive) continue;
    // 공격 동작은 판정과 무관하게 흘러간다 — 연출 전용 상태라 여기서만 준다.
    // (스턴에도 멈추지 않는다: 최대 12틱짜리 '던지는 팔'이라 얼려 봐야 자세만 굳는다)
    if (e.attackAnimLeft > 0) e.attackAnimLeft--;
    const spec = e.def.towerAttack;
    if (spec === undefined) continue; // 타워를 무시하는 적 (공룡·짐승 11종)
    if (isStunned(e)) {
      // 규칙 5) 스턴 = 완전 무력화. 쿨다운도 멈춘다. 서 있었다면 규칙 4-b가 걸린다
      endHold(e);
      e.towerTargetId = -1;
      continue;
    }
    if (atGate(e)) {
      // **문 앞에 섰다 — 타워를 때리지 않는다** (gate.ts 규칙 4). 봉쇄 분기와 **같은 모양**이고
      // 근거도 아래와 같다: 눈앞의 것을 놔두고 멀리 있는 것을 때리는 그림은 설명이 안 된다.
      // 문 앞에서 눈앞의 것은 마을이다. 쿨다운은 흐른다 — 무력화가 아니라 표적 전환이다.
      // (스턴 분기 **뒤**인 이유: 문 앞에서 스턴에 걸린 적의 쿨다운이 얼어야 규칙이 하나다)
      endHold(e);
      if (e.attackCdLeft > 0) e.attackCdLeft--;
      e.towerTargetId = -1;
      continue;
    }
    if (e.blockerAllyId >= 0) {
      // 아군 부족원에게 발이 묶였다 — 눈앞의 사람을 놔두고 멀리 있는 움막을 때리지 않는다.
      // (allies.ts 규칙 5) 아군 유닛이 **타워의 수명을 사는** 카드가 되는 지점이다.
      // 스턴과 달리 쿨다운은 그대로 흐른다 — 무력화가 아니라 표적 전환이기 때문이다.
      endHold(e);
      if (e.attackCdLeft > 0) e.attackCdLeft--;
      e.towerTargetId = -1;
      continue;
    }
    if (e.attackCdLeft > 0) e.attackCdLeft--;
    if (towers.length === 0) {
      endHold(e);
      e.towerTargetId = -1;
      continue;
    }
    const r2 = spec.range * spec.range;
    const target = lockedTower(ctx, e, r2) ?? nearestTower(ctx, e, r2);
    e.towerTargetId = target ? target.id : -1;
    // 규칙 4) 정지 판정을 **사격보다 먼저** — 이번 틱에 새로 멈춰 섰다면
    // 그 첫 발도 정지 사격(planted)으로 나가야 화면과 계약이 어긋나지 않는다
    updateHold(ctx, e, spec, target);
    if (!target || e.attackCdLeft > 0) continue;
    fireAtTower(ctx, e, spec, target);
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

/**
 * 규칙 4) 이 적이 지금 타워를 쏘느라 멈춰 서 있는가 (이동 단계가 묻는다).
 *
 * **towerTargetId가 아니라 siegeHoldLeft로 판정한다.** 사거리 안에 타워가 있다는 것과
 * 멈춰 섰다는 것은 이제 다른 사건이기 때문이다 — 사거리(2.4~3.6)에 들어오면 조준하고
 * 걸으며 쏘다가, 정지 거리(4-a) 안에 들어와야 비로소 선다. towerTargetId로 판정하면
 * 사거리에 들어온 순간부터 멈춰 서서 옛 규칙 4가 경고한 스톨이 그대로 재현된다.
 */
export function isSieging(e: EnemySim): boolean {
  return e.siegeHoldLeft > 0;
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
