/**
 * 문간 공성 — 보스는 마을 문 앞에서 **살아서 선 채** 마을을 문다. 결정론 100%(rng 미사용).
 *
 * ── 왜 만들었나 (사용자 불만 ③) ───────────────────────────────────────────────
 * "보스가 마을 앞에서 안 싸우고 그냥 들어가서 hp만 깎는다."
 * 정확한 진단이었다. 종전의 보스는 경로 끝(`dist >= totalLength`)에 닿는 **그 틱에**
 * `leakEnemy`로 사라지고 마을 HP만 한 번 깎였다 — 곧 이 게임에서 가장 큰 몸이
 * 화면에 서 있는 시간이 **0틱**이었다. 실측: 기준선 봇 스테이지1 w50 trex 의
 * 문간 체류 틱 중앙값이 정확히 **0**이다(오늘 값).
 *
 * 고친 방식은 새 전투 계산을 만드는 것이 **아니다**. 보스를 경로 끝에 살려 세우기만
 * 하면 이미 만들어 둔 세 부품이 코드 0줄로 동시에 켜진다:
 *  · 문간은 `stage.baseCell`과 거리 0이라 **홈타운 사격이 100% 사거리 안**이다
 *    (hometown.ts 규칙 1 — Lv1 사거리 2.0으로도 닿는다).
 *  · 아군은 `baseCell` 앞에서 스폰하므로(allies.ts 규칙 1) **첫 틱에 봉쇄가 성립**한다.
 *  · 문간을 덮는 사거리의 타워가 계속 때린다(공성과 달리 표적이 안 움직인다).
 * 곧 "소극적이면 더 아프고 적극적이면 더 편하다"가 **배치의 결과로** 나온다.
 *
 * ── 행동 규칙 (확정) ───────────────────────────────────────────────────────
 * 1) **보스만 선다. 그 외는 한 글자도 안 바뀐다.**
 *    `def.boss !== true`인 적은 종전대로 `leakEnemy`로 사라지고 `enemyLeaked`가 나간다.
 *    보스에게는 `enemyLeaked`가 **아예 안 나간다** — 대신 `bossAtGate`가 나간다.
 *    이 선택의 근거는 이벤트의 뜻이다: `enemyLeaked`는 "제거 표시 + 남은 현상금 몰수"인데
 *    (combat.ts 헤더) 문간의 보스는 **제거되지도 몰수되지도 않는다**. 여전히 죽일 수 있고,
 *    죽이면 살점 값 잔액이 전부 나온다. 곧 누수 이벤트를 보내면 그건 거짓말이다.
 *    ⚠ 기존 소비자 셋은 전부 이 결정과 맞는다:
 *      · `game/fx.ts`는 `enemyLeaked`에서 `foeDef` 표의 항목을 지운다 — 살아 있는 보스의
 *        항목을 지우면 그 뒤의 피격 연출이 종을 잃는다. **안 보내는 쪽이 맞다.**
 *      · `tests/sim/combat.test.ts` · `hometown.test.ts`는 보스가 아닌 적으로 잰다.
 *      · `tests/sim/siege.test.ts`는 습격대 4종(전부 보스 아님)으로 잰다.
 *
 * 2) **봉쇄·스턴이면 안 문다** — siege.ts 규칙 1-b·5를 글자 그대로 상속한다.
 *    · 봉쇄(`blockerAllyId >= 0`): 눈앞의 사람을 놔두고 마을을 무는 그림은 설명이 안 되고,
 *      무엇보다 **그게 아군 유닛을 사는 이유다**(allies.ts 규칙 5). 스턴과 달리
 *      **쿨다운은 그대로 흐른다** — 무력화가 아니라 표적 전환이기 때문이다.
 *    · 스턴: 완전 무력화라 **쿨다운도 안 흐른다**(siege.ts 규칙 5).
 *    두 규칙이 siege와 다르면 플레이어가 배울 것이 하나 더 생긴다. 같으면 0이다.
 *
 * 3) **첫 한 입은 도착 즉시가 아니라 한 주기 뒤다** (GATE_BITE_TICKS = 1초).
 *    ⚠ 이것만은 siege.ts 규칙 6("첫 타격은 사거리 진입 즉시")과 **반대**다. 의도적이다:
 *    사용자가 승인한 계약이 "첫 1초에 죽이거나 봉쇄하면 피해 **0**"이라, 도착 틱에 물면
 *    그 약속이 코드에서 성립하지 않는다. 습격대의 규칙 6은 스폰이 intervalTicks로
 *    어긋나 있어 스파이크가 저절로 분산된다는 근거 위에 서 있는데(siege.ts 규칙 6),
 *    문간의 보스는 마릿수가 1이라 그 근거가 통째로 없다.
 *
 * 4) **한 입 = `ceil(baseDamage / GATE_BITE_DIVISOR)`.**
 *    `e.baseDamage`는 스테이지 덮어쓰기(`StageDef.leakDamage`)가 이미 반영된 값이라
 *    (waves.spawn) 문간이 누수와 **같은 표**를 읽는다. 곧 종의 서열이 그대로 상속되고,
 *    **적 데이터는 한 값도 안 바뀐다**. 올림이라 하한이 언제나 1이다(규칙 7이 이걸 쓴다).
 *
 * 5) **감속(얼음)은 문간 피해를 깎는다** — siege.ts 규칙 9 그대로. 피해 × slowFactor.
 *    ⚠ 이 규칙이 siege.ts 규칙 9 본문의 한 문장을 **거짓으로 만들었다**. 그 문장은
 *    "기지 피해(누수)는 공격이 아니라 도달로 계산되므로 이 규칙과 무관하다"였는데,
 *    문간의 한 입은 도달이 아니라 **주기적인 공격**이다. 그 자리는 이미 뒤집어 다시 썼다.
 *    얼어붙은 팔에는 힘이 실리지 않는다 — 마을을 물 때도 타워를 칠 때와 같아야 한다.
 *
 * 6) **무한 모드 배율(`siegeMul`)은 안 건다** — siege.ts 규칙 10과 갈리는 자리다.
 *    규칙 10이 배율을 거는 이유는 "towerAttack.dmg는 상수인데 적 HP만 1.06^n으로 커져
 *    타워를 부수는 적이 사라진다"는 것인데, 문간의 분모는 `baseDamage`이고 **마을 HP도
 *    안 커진다**. 곧 규칙 10이 고치려던 비대칭이 여기에는 존재하지 않는다.
 *    (배율을 걸면 무한 모드 후반 한 입이 마을을 통째로 지워 축이 사라진다)
 *
 * ── 교착(스톨) 불가능성 — 증명 ──────────────────────────────────────────────
 * 문간의 보스는 **영원히 서 있을 수 있는 상태**를 새로 만든다. `checkEnd`의 웨이브 완료
 * 조건이 `enemies.length === 0`이므로, 이 상태가 영구히 지속되면 판이 끝나지 않는다.
 * 그래서 allies.ts '교착 안전성' 절과 같은 형식으로 두 카운트다운을 적어 둔다.
 * **둘은 서로 독립이고, 어느 하나만으로도 유한 시간 종료가 나온다.**
 *
 *  ① **마을 화살 카운트다운 (보스 HP → 0).**
 *     문간의 보스는 `dist = totalLength`, 곧 경로 끝점이다. 경로는 정의상 `baseCell`에서
 *     끝나므로 보스와 기지 셀의 거리는 0이고, 무장한 어떤 레벨 표에서도(범위 ≥ 2.0)
 *     **영구히 사거리 안**이다. `updateHometown`은 봉쇄·스턴·침묵 어느 것에도 막히지
 *     않고(hometown.ts 규칙 5: 홈타운은 침묵하지 않는다) `cooldownTicks`마다 한 발 쏜다.
 *     `damageEnemy`는 `Math.max(1, raw − armor)`라 **한 발이 최소 1**을 깎는다.
 *     방패는 `shieldHitsLeft`가 단조 감소라 유한하고, 회복(healAura)을 가진 종은 보스가
 *     아니므로 문간에 설 수 없다 — 걸어와서 누수로 사라진다(규칙 1). 곧 보스 HP는
 *     `cooldownTicks + 화살 비행` 마다 최소 1씩 단조 감소하고, 유한 HP에서 시작하므로
 *     반드시 0에 닿는다.
 *  ② **마을 HP 카운트다운 (baseHp → 0 → phase='lost').**
 *     봉쇄도 스턴도 아닌 틱에는 GATE_BITE_TICKS 마다 반드시 문고, 한 입은 규칙 4의 올림
 *     때문에 **언제나 1 이상**이다. `view.baseHp`는 이 경로에서만 줄고 절대 회복되지
 *     않는다(hometown.ts 규칙 4: 홈타운은 회복되지 않는다). 곧 `baseHp`는 단조 감소해
 *     0에 닿고, `checkEnd`가 `phase='lost'`로 얼려 `tick()`이 즉시 반환한다.
 *  ③ **①·② 를 동시에 멈추는 상태는 없다.** ②를 멈추는 것은 봉쇄와 스턴뿐인데,
 *     · 봉쇄는 유한하다 — allies.ts '교착 안전성'이 이미 증명한다(난투 피해 ≥ 1 ·
 *       아군 회복 수단 없음 · 정원 유한 · 비용 지수). 게다가 웨이브가 안 끝나므로
 *       `waveCleared` 보상이 안 들어와 새 부족원을 살 골드도 유한하다.
 *     · 스턴은 유한하다 — `remainingTicks`가 매 틱 준다(status.ts). 보스에게는
 *       `stunImmuneUntil` 면역까지 붙어 있어 연쇄 스턴으로 잠글 수도 없다.
 *     그리고 ①은 봉쇄·스턴에 **전혀 영향받지 않는다** — 곧 ②가 멈춰 있는 동안에도
 *     ①은 계속 돈다. 두 카운트다운이 동시에 정지하는 상태가 존재하지 않는다.
 *  ④ **무장 해제 표(NO_DEFENSE / 목 테이블)에서도 성립한다.** ①이 꺼지면 ②만 남는데,
 *     ②를 멈추는 봉쇄·스턴이 ③에 의해 유한하므로 결론은 그대로다. 곧 이 증명은
 *     "마을이 쏜다"는 전제에 **의존하지 않는다** — 그 전제가 필요했다면
 *     `tests/sim/arena.ts`의 통제 실험이 조용히 무한 루프가 됐을 것이다.
 * 상한: `min(홈타운 쿨다운 × 보스 HP, GATE_BITE_TICKS × baseHp + 봉쇄·스턴 유한분)`.
 * ⚠ 이 성질은 **마을 HP 회복**이나 **보스 회복**을 넣는 순간 깨진다. 넣으려면
 *   `gateTicks` 상한 가드를 함께 넣어라(allies.ts의 같은 경고와 짝이다).
 *
 * ⚠⚠ **그 경고가 이미 한 번 발화했다 — `tests/sim/wavetermination.test.ts` 여섯 개 전부.**
 *   그 테스트는 패배로 조기 종료되지 않게 **매 틱 `baseHp = baseHpMax` 를 다시 쓴다**.
 *   곧 위 증명의 전제 ②를 손으로 껐고, 남은 ① 하나로 상한(30,000틱)을 못 지킨다:
 *   s1 은 웨이브 30 에서 30,000틱을 넘겼는데, 그 웨이브의 spino 실HP 는 5,000 대이고
 *   Lv1 마을은 `max(1, 8 − armor 4)` = **초당 4** 라 혼자 부수는 데 38,000틱이 걸린다.
 *   곧 ①은 **참이지만 느리다**. 종전에는 보스가 경로 끝에서 사라져 웨이브 길이가
 *   "가장 느린 적의 보행 시간"으로 닫혀 있었는데, 지금은 **"둘 중 하나가 죽는 시간"** 이다.
 *   이것이 문간이 실제로 치른 구조적 대가이고, 위 실측 표와 같은 무게로 읽어야 한다.
 *
 * ══ ⚠ 실측 — 이 기능은 지금 봉투를 통째로 깬다. 읽지 않고 만지지 마라 ══════════
 * (tests/sim/gatemeasure.test.ts · 창 base1 = 4블록 × 40 = 160판 · 배포 데이터 그대로)
 *
 *  ── 기준선 봇(부족원 안 뽑음) · [1-a] 가 읽는 바로 그 판들 ──
 *   팔                완주율            블록          trex 대치(중앙/처치)   spino 대치(중앙/처치)
 *   gate-off(오늘)    80.63% (129/160)  [34 34 31 30]  n=0                   n=0
 *   divisor 4         **1.25%** (2/160) [ 0  2  0  0]  n=79 181틱 / **0**    n=145 391틱 / 0
 *   divisor 6         1.88%  (3/160)    [ 0  3  0  0]  n=92 301틱 / 1        n=150 476틱 / 0
 *   divisor 8         1.88%  (3/160)    [ 0  3  0  0]  n=92 301틱 / 1        n=150 476틱 / 0
 *   divisor 16        1.88%  (3/160)    [ 0  3  0  0]  n=92 541틱 / 1        n=150 476틱 / 0
 *   divisor 32        1.88%  (3/160)    [ 0  3  0  0]  n=92 541틱 / 1        n=150 476틱 / 0
 *
 *  ── 최강 봇 · [1-b] 가 읽는 판들 ──
 *   gate-off  100.00% · 여유 49.33% · 꼬리CVaR10 38.25%
 *   divisor 4   8.75% · 여유  7.85% · 꼬리CVaR10  0.00% · trex 대치 n=147 241틱 / 처치 **1**
 *   divisor 8   8.75% · 여유  7.98% · 꼬리CVaR10  0.00% · trex 대치 n=147 361틱 / 처치 1
 *
 *  ── 설계가 말한 반격 수단(아군 봉쇄)을 실제로 쓰는 팔 ──
 *   gate-off  69.38% (111/160) · 아군 2,269명
 *   divisor 4  0.00% (  0/160) · 아군   803명 · spino 처치 **71/183** · trex 처치 0/46
 *   divisor 8  0.00% (  0/160) · 아군 1,065명 · spino 처치 109/200 · trex 처치 0/63
 *
 * ── 무엇이 이 표의 결론인가 (세 줄) ────────────────────────────────────────
 *  ① **범인은 w50 trex 가 아니라 w10 spino 다.** 판당 spino 대치가 145~200건이다 —
 *     방어선이 아직 얇은 웨이브 10에 미니보스가 문간에 서고, 마을 25HP 가 그 자리에서 끝난다.
 *     곧 판이 웨이브 10 언저리에서 죽고 그래서 완주율이 1%대다.
 *  ② **divisor 는 이걸 못 고친다.** 문간의 결말은 "보스가 죽거나 마을이 죽거나" 둘뿐이고,
 *     divisor 는 **언제**를 바꿀 뿐 **어느 쪽**을 안 바꾼다. 4 → 32 로 8배를 올려도
 *     완주율이 1.25% → 1.88% 로 0.6%p 움직이고 멈춘다(대치 틱만 181 → 541 로 는다).
 *     곧 승인된 손잡이 (b) `GATE_BITE_DIVISOR` 상향은 **이 축에서 판별력이 없다**.
 *  ③ **설계가 약속한 반격은 절반만 듣는다.** 아군 봉쇄를 실제로 쓰면 spino 는 문간에서
 *     실제로 죽는다(71/183 · divisor 8 에서 109/200) — 기전 자체는 옳다. 그런데 trex 는
 *     **0/46 · 0/63** 으로 한 마리도 안 죽는다. w50 trex 의 실HP 는 38,000 대인데
 *     문간 체류는 길어야 541틱(18초)이다.
 *
 * ⚠ 다음 사람에게: 봉투가 빨간 것을 **문턱 탓으로 돌리지 마라**. 위 표는 문턱 근처가
 *   아니라 80.63% → 1.25% 다. 되돌릴 곳은 계약이 아니라 설계이고, 후보는 셋이다 —
 *   (a) 문간 총량 상한(개체당 누적 한 입 합계를 `baseDamage` 로 닫는다. "누수 한 번의 값"이
 *       유지되고 대치 시간만 늘어난다. 다만 "보스를 못 막으면 마을이 통째로 죽는다"는
 *       사용자 승인 계약 1-A 를 정면으로 되돌린다),
 *   (b) 보스가 문간에서 **떠나는** 길을 준다(한 입 총량이 baseDamage 에 닿으면 누수 처리),
 *   (c) 문간을 보스가 아니라 **잡몹**에게만 걸거나 스테이지별로 켠다.
 *   어느 쪽도 이 라운드의 승인 범위 밖이라 고르지 않았다. `gate-off` 대조군이
 *   tests/sim/controls.ts 에 있으므로 A/B 는 코드 0줄로 된다.
 *
 * three/DOM 임포트 금지.
 */
import { GATE_BITE_DIVISOR, GATE_BITE_TICKS } from '@/data/balance';
import type { EnemySim, SimCtx } from './entities';
import { isStunned, slowFactor } from './status';

/** 문간 기능이 켜져 있는가 — 생략은 켜짐이다 (`gate-off` 되돌리기 대조군의 스위치) */
export function gateEnabled(ctx: SimCtx): boolean {
  return ctx.opts.stage.gate?.enabled !== false;
}

/** 한 입의 주기(틱). 하한 1 — 0이면 규칙 3의 "한 주기 뒤"가 뜻을 잃는다 */
function biteTicks(ctx: SimCtx): number {
  return Math.max(1, Math.round(ctx.opts.stage.gate?.biteTicks ?? GATE_BITE_TICKS));
}

/** 한 입의 분모. 하한 1 — 0이면 나눗셈이 Infinity가 되어 조용히 마을을 지운다 */
function biteDivisor(ctx: SimCtx): number {
  return Math.max(1, ctx.opts.stage.gate?.divisor ?? GATE_BITE_DIVISOR);
}

/**
 * 규칙 4) 이 개체의 한 입 크기 (정수, ≥1). 감속은 여기 안 들어간다 —
 * 이 값은 "이 종이 무는 크기"라 `bossAtGate`가 미리 알려 주는 상수이고,
 * 감속(규칙 5)은 그때그때의 상태라 실제로 물 때 곱한다.
 */
export function gateBiteFor(ctx: SimCtx, e: EnemySim): number {
  return Math.max(1, Math.ceil(e.baseDamage / biteDivisor(ctx)));
}

/** 이 적이 경로 끝에서 사라지는 대신 **문간에 서는가** (규칙 1) */
export function isGateBoss(ctx: SimCtx, e: EnemySim): boolean {
  return e.def.boss === true && gateEnabled(ctx);
}

/** 지금 문간에 서 있는가 — 이동 단계가 묻는다 (`isSieging`과 같은 꼴의 얇은 접근자) */
export function atGate(e: EnemySim): boolean {
  return e.gateTicks > 0;
}

/**
 * 문간 입장 — `moveEnemies`가 경로 끝에 닿힌 그 틱에 한 번만 부른다.
 * **멱등이다**: 이미 서 있으면 아무 일도 하지 않는다. 이동 단계가 클램프 뒤에도
 * 같은 분기를 다시 밟을 수 있어서(dist가 계속 totalLength 이상이다) 방어선이 필요하다.
 */
export function enterGate(ctx: SimCtx, e: EnemySim): void {
  if (e.gateTicks > 0) return;
  // 도착한 이 틱부터 세기 시작한다 — 0은 "문간이 아니다"라 쓸 수 없다
  e.gateTicks = 1;
  // 규칙 3) 첫 한 입은 한 주기 뒤다 (도착 즉시가 아니다)
  e.gateBiteCdLeft = biteTicks(ctx);
  ctx.events.push({
    type: 'bossAtGate',
    enemyId: e.id,
    defId: e.defId,
    x: e.x,
    z: e.z,
    bite: gateBiteFor(ctx, e),
  });
}

/**
 * 한 입 — 무는 것(gateBite)이 먼저, 깎이는 것(baseDamaged)이 나중.
 * siege.ts `fireAtTower`의 raidAttack → towerDamaged 규약과 같은 순서다.
 */
function bite(ctx: SimCtx, e: EnemySim): void {
  const v = ctx.view;
  // 규칙 5) 감속은 문간 피해를 깎는다 (siege.ts 규칙 9)
  const amount = Math.max(1, Math.round(gateBiteFor(ctx, e) * slowFactor(e)));
  e.gateBiteCdLeft = biteTicks(ctx);
  ctx.events.push({
    type: 'gateBite',
    enemyId: e.id,
    defId: e.defId,
    amount,
    x: e.x,
    z: e.z,
    gateTicks: e.gateTicks,
  });
  v.baseHp = Math.max(0, v.baseHp - amount);
  ctx.events.push({ type: 'baseDamaged', amount, hpLeft: v.baseHp });
}

/**
 * 매 틱 — 문간 판정. 틱 순서상 `updateSiege` **직후**, `moveEnemies` **직전**이다.
 *
 * 왜 그 자리인가(battle.ts 헤더의 "결정을 읽는 쪽이 뒤"와 같은 규칙):
 *  · 공성 **뒤** — 두 단계는 같은 `blockerAllyId`를 읽는데, 봉쇄는 그보다 앞선
 *    `updateAllies`가 확정한다. 공성과 문간이 같은 스냅샷을 봐야 "봉쇄된 보스는
 *    타워도 안 때리고 마을도 안 문다"가 한 틱 안에서 일관된다.
 *  · 이동 **앞** — 이동이 `gateTicks`를 읽어 전진을 멈추기 때문이다(`isSieging`과 같은 꼴).
 *    이동 뒤에 두면 도착한 틱의 판정이 한 틱 밀려 첫 한 입이 1틱씩 흔들린다.
 */
export function updateGate(ctx: SimCtx): void {
  for (const e of ctx.world.enemies.items) {
    if (!e.alive || e.gateTicks <= 0) continue;
    // 버틴 시간은 무는 것과 무관하게 흐른다 — 봉쇄·스턴으로 못 무는 시간도 대치다.
    // (이 값이 곧 "보스가 마을 앞에서 실제로 싸운 시간"이라 불만 ③의 계측 단위다)
    e.gateTicks++;
    if (isStunned(e)) continue; // 규칙 2) 완전 무력화 — 쿨다운도 안 흐른다
    if (e.gateBiteCdLeft > 0) e.gateBiteCdLeft--;
    if (e.blockerAllyId >= 0) continue; // 규칙 2) 표적 전환 — 쿨다운은 그대로 흘렀다
    if (e.gateBiteCdLeft > 0) continue;
    bite(ctx, e);
  }
}
