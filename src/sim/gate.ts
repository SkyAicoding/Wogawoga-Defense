/**
 * 문간 교전 — 적은 마을 문 앞에 **살아서 서서** 마을을 물고, 마을은 그 적을 쏜다.
 * 종을 안 가린다: 보스도 잡졸도 습격대도 공중도 같은 규칙이다. 결정론 100%(rng 미사용).
 *
 * ── 왜 만들었나 (사용자 요구 원문) ─────────────────────────────────────────────
 * "보스 말고 나머지 공룡이나 적 부족도 우리 홈타운 앞에서 바로 돌진 하지 말고 앞에서
 *  공격을 하도록 해줘. 그래서 홈 타운은 적을 공격하고, 적도 우리 홈타운을 공격하면서
 *  서로 hp 를 소모시키는 걸로 모두 통일 해줘"
 *
 * 종전에는 경로 끝(`dist >= totalLength`)에 닿는 **그 틱에** `leakEnemy` 로 사라지고
 * 마을 HP 만 한 번 깎였다 — 곧 이 게임에서 가장 큰 몸이 화면에 서 있는 시간이 **0틱**이고,
 * 마을이 쏘는 시간은 적이 사거리 2.0 을 지나가는 0.3~2초뿐이었다.
 *
 * ── 결론 한 줄 ────────────────────────────────────────────────────────────────
 * **`baseDamage` 의 뜻을 "도착 시 한 방"에서 "도착이 청구하는 총액"으로 바꾸고,
 *   그 총액을 초당 1씩 분납시킨다.** 총량이 불변이라 밸런스가 정의상 보존되고,
 *   체류는 개체 상태와 **무관하게** 감소하는 카운터로 닫아 종료를 상수로 증명한다.
 *
 * ── ⚠⚠ 왜 `claude/gate-wip`(10e1187)이 무너졌나 — 추측이 아니라 코드에서 ──────────
 * 그 가지는 이 장면을 만드는 데 성공하고 완주율 **80.63% → 1.25%** 로 무너졌다.
 * 원인은 손잡이도 문턱도 아니다. 그쪽 `gate.ts` 의 `bite()`/`updateGate()` 에는
 * **개체당 총량도, 체류 상한도 없었다**:
 *   · 한 입 = `ceil(baseDamage / 4)` 를 **무한히** 반복 → `baseDamage` 가 "총액"에서
 *     "초당 요율"로 바뀌었다. s1 w10 spino 는 초당 2 라 마을 25HP 가 12.5초에 0 이다.
 *   · `gateTicks` 는 **증가만 하고 어떤 분기도 읽지 않았다** → 결말이 "보스가 죽거나
 *     마을이 죽거나" 둘뿐인데, 그 자리의 방어선 화력 19.8dps 로 spino 실HP 1,864 를
 *     94초에 깎는 동안 마을은 12.5초에 죽는다. 언제나 마을이 먼저 진다.
 *   · 그래서 `divisor` 를 4 → 32(8배)로 올려도 완주율이 1.25% → 1.88% 로 0.6%p 움직이고
 *     멈췄다 — divisor 는 **언제**만 바꾸고 **어느 쪽**을 안 바꾸기 때문이다.
 * 이 파일이 그 자리를 고치는 방식은 divisor 를 조정하는 것이 아니라 **총량과 상한을
 * 도입하는 것**이다(규칙 6·7). 그 둘이 없는 어떤 변형도 같은 자리로 돌아간다.
 *
 * ── 행동 규칙 (확정 · 구현자는 해석 없이 따를 것) ─────────────────────────────
 * 1) **종을 안 가린다.** 보스 분기도, 공중 분기도, 습격대 분기도 없다.
 *    갈림은 **이동 단계 한 곳**(battle.moveEnemies)에만 둔다 — `leakEnemy` 안이 아니다.
 *    gate-wip 은 `leakEnemy` 안에서 갈랐고 그 대가가 `combat → gate → status → combat`
 *    순환 참조였다. `leakEnemy` 는 손대지 않고 **뚫고 들어가는 순간의 경로**로만 남는다.
 *
 * 2) **멈추는 자리 = 몸 앞끝이 마을 중심에서 `GATE_STANDOFF_EDGE`(1.15).**
 *    곧 개체 중심은 마을 중심에서 정확히 `1.15 + e.radius` 다.
 *    반경을 더하는 이유는 **몸 앞끝을 한 선에 세우기 위해서**다. 이 한 줄이 셋을 산다:
 *      · 앞끝 1.15 → 마을 바닥판(반경 1.45) 안, 구조물 고리(반경 1.0) 밖.
 *        **어떤 메시도 움막을 관통하지 않는다.**
 *      · 최대 중심거리 1.95(trex, radius 0.80) < **마을 Lv1 사거리 2.0** →
 *        16종 전부가 첫 레벨 마을의 사거리 안이다. "홈타운이 적을 공격한다"가 성립한다.
 *      · 종별 반경 차 0.22~0.80 이 그대로 0.58타일의 깊이 층이 된다(작은 놈이 앞).
 *
 *    ⚠ **접근 방향은 경로에서, 거리는 마을에서 잰다.** 정지선의 호장(`totalLength − 정지거리`)
 *      에서 경로를 한 번 샘플해 "어느 쪽에서 왔는가"만 얻고, 최종 좌표는 **마을 중심을
 *      원점으로 다시 그린다**. 왜 호장을 그대로 쓰지 않는가: 코너 라운딩 때문에 호장과
 *      유클리드가 어긋난다(실측 s1·s2 지상 경로에서 호장 −1.95 지점의 유클리드는 1.924다).
 *      원점을 마을로 옮기면 그 어긋남이 **원리적으로 0** 이 되어, 위 세 성질이 경로 모양에
 *      의존하지 않는 **정리**가 된다. "마지막 1.5타일이 직진이다"라는 데이터 성질에
 *      기대지 않아도 된다는 뜻이다(그 성질은 지금 참이지만, 경로를 고치는 사람이 그걸
 *      알 방법이 없다).
 *
 * 2-b) **가로 부채 — 마을 중심 원 위에서 벌린다.**
 *    `lat = (e.id % GATE_FAN_COLS − 1) × GATE_FAN_SPACING` (−0.6·0·+0.6) 만큼 옆으로
 *    옮기되, 앞뒤로 `sqrt(stand² − lat²)` 만 나가 **중심거리 `stand` 를 정확히 보존**한다.
 *    ⚠⚠ 접선 방향으로 그냥 밀면 안 된다: trex 는 `hypot(1.95, 0.6)` = **2.04** 가 되어
 *      Lv1 사거리 2.0 **밖**으로 나간다 — 규칙 2 가 산 세 성질 중 둘째가 그 자리에서
 *      깨진다. (설계 문서 §2-b 가 이 곱셈을 빠뜨렸다. 원 위에서 벌리면 공짜로 닫힌다)
 *    자리를 **개체의 id** 가 정하므로 결정론이 순회 순서에 안 걸린다(절대 규칙).
 *    결과 좌표는 `[0.5, gridW−0.5] × [0.5, gridH−0.5]` 로 클램프한다 — s2 마을이 x=1 이라
 *    클램프가 없으면 맵 밖으로 나간다. **클램프는 중심거리를 절대 늘리지 않는다**:
 *    마을 좌표가 언제나 구간 안이므로 클램프는 좌표를 마을 쪽으로만 민다. 곧 규칙 2 의
 *    "Lv1 사거리 안" 성질이 클램프 뒤에도 그대로 성립한다.
 *
 * 3) **문 앞에 선 적은 두 번 다시 걷지 않는다.** `moveEnemies` 의 첫 분기(봉쇄·정지
 *    판정보다 앞)다. 좌표는 진입 틱에 한 번 확정하고 영구 고정한다.
 *
 * 4) **무엇을 때리나 — 마을만.** 문 앞의 적은 타워를 때리지 않는다(`updateSiege` 가
 *    봉쇄 분기와 **같은 모양**으로 조기 반환한다). 근거는 siege.ts 규칙 1-b 그대로다 —
 *    "눈앞의 것을 놔두고 멀리 있는 것을 때리는 그림은 설명이 안 된다". 문 앞에서 눈앞의
 *    것은 마을이다. 부수 효과로 `siegeHoldLeft`/`siegeWalkLeft` 회계와 새 결합이 0개다.
 *
 * 5) **한 입 = 마을 HP 정확히 1(`GATE_BITE_AMOUNT`), 주기 `GATE_BITE_TICKS`(1초).
 *    첫 입은 도착 틱에 즉시.**
 *    · 크기를 1 로 고정하는 이유: 종의 서열은 **크기가 아니라 횟수와 체류**가 진다.
 *      화면에는 언제나 "−1"만 뜨므로 마을 HP 25 가 "앞으로 25번 물리면 진다"로 읽힌다.
 *    · 첫 입을 즉시 주는 이유: **첫 1 HP 가 오늘과 정확히 같은 틱에 떨어진다.** 곧 피해
 *      일정의 앞머리가 오늘과 동일하고 뒤쪽만 늦춰진다 — `baseDamage` 가 1 인 11종은
 *      **피해 시점이 오늘과 한 틱도 안 다르다**. 진입 틱의 개체는 구조적으로 봉쇄도
 *      스턴도 아니다(둘 다 `moveEnemies` 가 그 앞에서 걸러 전진 자체를 막는다).
 *    · **감속(얼음)은 한 입에도 주기에도 안 걸린다.** 한 입은 휘두름이 아니라 도착이
 *      확정한 총액의 **분납**이라 깎을 '한 대의 위력'이 없다. siege.ts 규칙 9 원문
 *      ("기지 피해는 도달로 계산되므로 무관하다")을 되살리고 범위만 다시 썼다.
 *      (gate-wip 은 이 문단을 뒤집었는데, 한 입이 1 로 고정되면 `max(1, round(1×0.65))`
 *       = 1 이라 **규칙이 거짓말이 된다** — 화면에 아무 차이도 안 나타난다)
 *
 * 6) **총액(`gateOwed`) = `e.baseDamage`. 물 때마다 1씩 줄고, 0이면 더 못 문다.**
 *    `e.baseDamage` 는 `StageDef.leakDamage` 덮어쓰기가 이미 반영된 값이라(waves.spawn)
 *    문간이 누수와 **같은 표**를 읽는다. **적 데이터는 한 값도 안 바꾼다.**
 *
 * 7) **체류 상한 = `clamp(GATE_HOLD_MIN_TICKS, GATE_HOLD_MAX_TICKS, baseDamage × 주기)`.
 *    거기 닿으면 뚫고 들어간다.** 그때 남은 잔액은 `leakEnemy` 가 한 방에 청구한다 —
 *    곧 **오늘의 누수가 잔액으로 그대로 실행된다.**
 *
 * 8) **아군 봉쇄 — 유예이지 면제가 아니다.**
 *    `blockerAllyId >= 0` 이면 안 문다(쿨다운은 흐른다 — 무력화가 아니라 표적 전환).
 *    스턴이면 안 물고 **쿨다운도 안 흐른다**. 둘 다 siege.ts 규칙 1-b·5 를 글자 그대로
 *    상속한다 — 규칙이 다르면 플레이어가 배울 것이 하나 더 생긴다.
 *    그동안에도 `gateTicks` 는 흐르므로 봉쇄가 산 것은 **잔액이 뒤로 밀린 것뿐**이고,
 *    상한에서 한 방에 떨어진다. **면제는 처치 하나뿐이다** — 봉쇄가 총액을 지우면
 *    몽둥이꾼 여섯이 누수를 0으로 만드는 착취가 생긴다.
 *    ⚠ 실전에서 이 분기는 거의 안 걸리고, 걸릴 때는 값을 한다: 집결점이 마을 앞
 *      `ALLY_MUSTER_FORWARD` 1.4(뒷줄 0.8)·가로 ±0.6 이고 문간선이 1.37~1.95 라,
 *      **출동시킨 부족원이 걸어 나갈 필요 없이 태어난 자리에서 문 앞의 적을 붙잡는다.**
 *
 * 9) **공중(ptera)도 같은 규칙 — 예외 없다.** 근거 넷:
 *    ① 사용자가 "모두 통일"이라 했다.
 *    ② **공중은 위험이 가장 낮은 종이다.** 아군은 공중을 절대 붙잡지 않고(allies.ts
 *      규칙 5) 스치는 타격도 안 간다. 곧 규칙 8 의 유예 경로가 **원리적으로 없어**
 *      체류가 `baseDamage 1 → 90틱` 으로 결정론적 상수다.
 *    ③ 마을은 공중을 쏜다(hometown 규칙 3). **문간은 그 능력이 화면에 나타나는 유일한
 *      자리다** — 지금은 프테라가 스쳐 지나가 마을 사격이 대공인지 보이지 않는다.
 *    ④ 렌더가 `flying` 을 y 오프셋으로 그리므로 **하늘에 떠서 마을을 쪼는 그림**이 되고,
 *      지상 종과 메시 간섭이 원천적으로 없다.
 *
 * 10) **마을이 무엇을 우선 쏘는지는 바꾸지 않는다** (hometown 규칙 2 그대로).
 *    결과: 정지거리가 반경에 비례하므로 **마을은 문 앞의 작은 놈부터 쏜다**. 의도적이다 —
 *    마을 화력은 보스를 절대 못 죽이므로(§화력 표) 마을이 잡을 수 있는 것을 잡고 보스는
 *    타워가 맡는 분업이 데이터와 일치한다.
 *
 * 11) **무한 모드 배율(`siegeMul`)은 안 건다.** `gateOwed` 의 분모가 `baseDamage` 이고
 *    마을 HP 도 안 커진다 — siege 규칙 10 이 고치려던 비대칭이 여기엔 없다. 부수 효과로
 *    **무한 모드에서도 체류 ≤ `GATE_HOLD_MAX_TICKS`** 라 종료 증명이 무한 모드까지 덮는다.
 *
 * ══ ⚠⚠ 종료 증명 — 이 파일의 1순위 ═══════════════════════════════════════════
 * `checkEnd` 의 웨이브 완료 조건은 "전원 스폰 + 생존 0"이다. 적이 문 앞에 서고 양쪽 다
 * 못 죽이면 판이 영영 안 끝난다. 지금 숫자로 실제로 그렇다 — 기지 Lv1 은 8dps 인데
 * ankylo 는 armor 10 이라 `max(1, 8−10)` = **1 dps**, trex 는 hp 6,000 → 6,000초.
 * 그래서 체류를 **전투 결과가 아니라 상수**로 닫는다.
 *
 * 【명제】 `phase` 가 `wave` 에 머무는 시간은 **오늘의 웨이브 길이 + GATE_HOLD_MAX_TICKS**
 *         를 절대 넘지 않는다.
 *
 * 【보조정리 A — 체류는 상수로 닫힌다】
 *   `updateGate` 의 첫 줄에서 `gateTicks` 가 **`!e.alive` 말고는 어떤 분기보다도 앞에서**
 *   무조건 1씩 는다. 곧 진입 후 정확히 `holdTicksFor(e)` 틱에 상한이 걸리고,
 *   `clamp` 의 상한이 `GATE_HOLD_MAX_TICKS` 이므로
 *     **모든 적의 문간 체류 ≤ GATE_HOLD_MAX_TICKS 틱.**
 *   HP·armor·hide·shield·스턴·감속·힐 오라·아군 봉쇄·마을 화력·타워 유무 그 무엇에도
 *   의존하지 않는다. gate-wip 증명과의 결정적 차이가 이것이다 — 그쪽의 "마을 화살
 *   카운트다운"은 **참이지만 느렸고**(s1 w30 spino 38,000틱) 그래서 wavetermination
 *   6건이 터졌다. 이번 증명은 속도가 아니라 상수다.
 *
 * 【보조정리 B — 상한이 안 걸리는 경우를 전부 뒤졌다】
 *   | 후보 | 왜 못 막나 |
 *   | 스턴 | `isStunned` 검사는 `gateTicks++` **뒤**다. 보스는 면역까지 있다 |
 *   | 감속 | 규칙 5 로 문간에 아예 안 닿는다. 닿아도 `gateTicks` 는 이동이 아니다 |
 *   | 주술사 힐 오라 | ⚠ 문간 좌표가 1.37~1.95 라 `healAura.radius = 2` 안에 **서로가 다
 *     든다**. 오늘의 규칙이면 주술사 둘이 서로를 살려 HP 카운트다운이 영영 안 끝난다 —
 *     **체류를 HP 로 닫는 설계였다면 여기서 죽었다.** 상한은 HP 를 안 보므로 무해하다 |
 *   | 방패 | 단조 감소이자, 애초에 HP 를 안 본다 |
 *   | 격노(boar) | 속도만 바꾼다. 문간에서는 이동이 없다 |
 *   | 아군 봉쇄 | 규칙 8 — 무는 것만 멈추고 `gateTicks` 는 흐른다 |
 *   | 마을 무장 해제(NO_DEFENSE · arena 통제 실험) | 증명이 "마을이 쏜다"에 **전혀
 *     의존하지 않는다** |
 *   | 무한 모드 | `siegeMul` 을 안 거니 `baseDamage` 가 안 커진다 → 상한 불변 |
 *   | `StageDef.leakDamage` 덮어쓰기 | clamp 상한이 값과 무관하게 자른다. 추가로
 *     `tests/data/validate.test.ts` 가 `leakDamage ≤ 12` 를 계약으로 잠근다 |
 *
 * 【보조정리 C — 판 위 시간은 ≤ +GATE_HOLD_MAX_TICKS】
 *   문간은 이동 속도를 안 바꾸고 문간 앞의 경로 길이도 안 바꾼다. 개체의 판 위 시간 =
 *   (스폰→정지선, 오늘과 동일) + (체류 ≤ 상한) − (오늘 마지막 1.15~1.95타일을 걷던 시간).
 *   곧 개체별 증분 ≤ 상한이고, 웨이브 종료는 개체 퇴장의 최댓값이므로 웨이브 길이 증분도
 *   ≤ 상한이다. ∎
 *
 * 【계량】 `wavetermination.test.ts` 실측 최장 웨이브 2,772틱, 상한 6,000.
 *   새 상계 = 2,772 + 360 = **3,132틱** → 여유 1.92배.
 *
 * 【뚫고 들어갈 때】 **지금의 `leakEnemy` 그대로다.** `alive = false` → `enemyLeaked`
 *   → `baseHp -= 잔액` → `baseDamaged` → 사망 처리 단계에서 회수. `checkEnd` 는 한 글자도
 *   안 바뀐다. **기존 종료 증명 위에 순수하게 얹힌다.**
 *
 * ⚠ **절대 하지 말 것**: `gateTicks` 를 조건부로 증가시키는 것 · 체류 상한을 HP 나 전투
 *   결과로 닫는 것(주술사 힐 오라가 그 자리에서 판을 얼린다) · 총량 상한 없이 무는 것 ·
 *   한 입을 1 이 아닌 값으로 두는 것.
 *   `tests/sim/gate.test.ts` 가 이 넷을 전부 실행 가능한 형태로 잠근다.
 *
 * three/DOM 임포트 금지.
 */
import {
  GATE_BITE_AMOUNT,
  GATE_BITE_TICKS,
  GATE_FAN_COLS,
  GATE_FAN_SPACING,
  GATE_HOLD_MAX_TICKS,
  GATE_HOLD_MIN_TICKS,
  GATE_STANDOFF_EDGE,
} from '@/data/balance';
import { clamp } from '@/core/mathx';
import { leakEnemy } from './combat';
import type { EnemySim, SimCtx } from './entities';
import type { BattlePath } from './path';
import { isStunned } from './status';

/** 방향 벡터가 퇴화했는지 판정하는 하한 (타일). 경로 끝점이 마을과 정확히 겹칠 때의 방어선 */
const DIR_EPS = 1e-6;

/** 문간 기능이 켜져 있는가 — 생략은 켜짐이다 (`gate-off` 되돌리기 대조군의 스위치) */
export function gateEnabled(ctx: SimCtx): boolean {
  return ctx.opts.stage.gate?.enabled !== false;
}

/** 한 입의 주기(틱). 하한 1 — 0이면 같은 틱에 무한히 문다 */
function biteTicks(ctx: SimCtx): number {
  return Math.max(1, Math.round(ctx.opts.stage.gate?.biteTicks ?? GATE_BITE_TICKS));
}

/**
 * 체류의 하한(틱). 하한 1 — 0이면 진입 틱에 곧바로 상한이 걸려 문간이 통째로 사라진다.
 * ⚠ 상향 허용 구간은 [60, 120] 이다 (balance.GATE_HOLD_MIN_TICKS 주석의 유도).
 */
function holdMinTicks(ctx: SimCtx): number {
  return Math.max(1, Math.round(ctx.opts.stage.gate?.holdMinTicks ?? GATE_HOLD_MIN_TICKS));
}

/**
 * 규칙 7) 이 개체의 **체류 상한**(틱). `gateTicks` 가 여기 닿으면 뚫고 들어간다.
 *
 * `baseDamage × 주기` 는 "총액을 전부 물어낼 만큼의 시간"이라 정확히 `baseDamage` 번
 * 물고 나간다(첫 입이 진입 틱이므로 마지막 입이 `30n − 29 ≤ 30n` 에 든다).
 * 하한은 잡졸(총액 1)이 화면에 한 순간도 안 서 있는 것을 막고, 상한은 종료를 닫는다.
 *
 * **순수 함수다** — 개체의 HP·상태·위치를 한 개도 안 읽는다. 그것이 보조정리 A 다.
 */
export function holdTicksFor(ctx: SimCtx, e: EnemySim): number {
  return clamp(e.baseDamage * biteTicks(ctx), holdMinTicks(ctx), GATE_HOLD_MAX_TICKS);
}

/**
 * 규칙 2) 이 개체의 **정지 중심거리** — 마을 중심에서 이만큼 떨어진 곳에 선다.
 * 앞끝이 `GATE_STANDOFF_EDGE` 에 서도록 반경을 더한 값이다.
 */
export function standoffFor(e: EnemySim): number {
  return GATE_STANDOFF_EDGE + e.radius;
}

/**
 * 규칙 2) 이 개체가 **걸음을 멈추는 경로 호장**. 문간이 꺼져 있으면 경로 끝(= 종전)이다.
 * `moveEnemies` 가 매 틱 이 값과 `e.dist` 를 견준다.
 */
export function stopDistFor(ctx: SimCtx, e: EnemySim, path: BattlePath): number {
  if (!gateEnabled(ctx)) return path.totalLength;
  return Math.max(0, path.totalLength - standoffFor(e));
}

/** 지금 문 앞에 서 있는가 — 이동 단계가 묻는다 (`isSieging` 과 같은 꼴의 얇은 접근자) */
export function atGate(e: EnemySim): boolean {
  return e.gateTicks > 0;
}

/**
 * 규칙 2·2-b) 문 앞 좌표를 확정한다. **진입 틱에 한 번만** 부르고 그 뒤로 영구 고정이다.
 *
 * ① 정지선 호장에서 경로를 한 번 샘플해 **접근 방향**만 얻는다(경로만이 "적이 어느 쪽에서
 *    왔는가"를 안다). ② 그 방향을 마을 중심 기준 단위벡터로 정규화한다. ③ 마을 중심에서
 *    반지름 `stand` 인 원 위에 부채를 벌려 놓는다. ④ 맵 밖으로 나가지 않게 클램프한다.
 *
 * ③이 원 위인 이유는 헤더 규칙 2-b 에 있다 — 접선으로 밀면 trex 가 Lv1 사거리 밖이 된다.
 */
function standAt(ctx: SimCtx, e: EnemySim, path: BattlePath, stopDist: number): void {
  const stage = ctx.opts.stage;
  const base = stage.baseCell;
  const stand = standoffFor(e);
  // ① 접근 방향의 근거 — e.x/e.z/e.heading 에 쓰고 곧바로 다시 읽는다(할당 없음)
  path.sample(stopDist, e);
  let dx = e.x - base.x;
  let dz = e.z - base.z;
  let len = Math.hypot(dx, dz);
  if (len < DIR_EPS) {
    // 퇴화 — 경로가 마을 위에서 끝나 방향을 못 얻었다. 진행 방향의 **반대**를 쓴다
    // (뒤로 물러서는 것이 곧 "왔던 쪽"이다). 현 데이터에서는 도달 불가능한 가지다.
    dx = -Math.cos(e.heading);
    dz = -Math.sin(e.heading);
    len = Math.hypot(dx, dz) || 1;
  }
  dx /= len;
  dz /= len;
  // ③ 마을 중심 원 위의 부채 — 앞뒤 성분을 줄여 중심거리 stand 를 정확히 보존한다
  const lat = ((e.id % GATE_FAN_COLS) - 1) * GATE_FAN_SPACING;
  const fwd = Math.sqrt(Math.max(0, stand * stand - lat * lat));
  const x = base.x + dx * fwd - dz * lat;
  const z = base.z + dz * fwd + dx * lat;
  // ④ 맵 밖 방지. 마을 좌표가 언제나 구간 안이라 **클램프는 마을 쪽으로만 민다** —
  //    곧 중심거리를 절대 늘리지 않고, 규칙 2 의 "Lv1 사거리 안"이 클램프 뒤에도 산다.
  e.x = clamp(x, 0.5, stage.gridW - 0.5);
  e.z = clamp(z, 0.5, stage.gridH - 0.5);
  e.prevX = e.x;
  e.prevZ = e.z;
  // 마을을 **바라본다** — 걷던 방향이 아니라 무는 방향이다(연출이 이 값으로 몸을 돌린다)
  e.heading = Math.atan2(base.z - e.z, base.x - e.x);
  e.dist = stopDist;
}

/**
 * 규칙 5) 한 입 — 무는 것(gateBite)이 먼저, 깎이는 것(baseDamaged)이 나중.
 * siege.ts `fireAtTower` 의 raidAttack → towerDamaged 규약과 같은 순서다.
 *
 * 크기는 `min(GATE_BITE_AMOUNT, 잔액)` 이라 **총액을 절대 넘지 않는다**(규칙 6).
 * 감속은 안 걸린다(규칙 5의 셋째 항).
 */
function bite(ctx: SimCtx, e: EnemySim): void {
  const v = ctx.view;
  const amount = Math.min(GATE_BITE_AMOUNT, e.gateOwed);
  if (amount <= 0) return;
  e.gateOwed -= amount;
  e.gateBiteCdLeft = biteTicks(ctx);
  ctx.events.push({
    type: 'gateBite',
    enemyId: e.id,
    defId: e.defId,
    amount,
    x: e.x,
    z: e.z,
    owed: e.gateOwed,
    gateTicks: e.gateTicks,
  });
  v.baseHp = Math.max(0, v.baseHp - amount);
  ctx.events.push({ type: 'baseDamaged', amount, hpLeft: v.baseHp });
}

/**
 * 문간 진입 — `moveEnemies` 가 정지선에 닿은 그 틱에 한 번만 부른다.
 * **멱등이다**: 이미 서 있으면 아무 일도 하지 않는다.
 *
 * 규칙 5) 첫 입은 **도착 틱에 즉시** 나간다. 진입하는 개체는 구조적으로 봉쇄도 스턴도
 * 아니다 — `moveEnemies` 가 그 둘을 자기 앞 분기에서 걸러 전진 자체를 막기 때문이다.
 * 곧 여기서 규칙 8 을 다시 검사할 필요가 없고, 검사하면 오히려 죽은 분기가 하나 생긴다.
 */
export function enterGate(ctx: SimCtx, e: EnemySim, path: BattlePath, stopDist: number): void {
  if (e.gateTicks > 0) return;
  standAt(ctx, e, path, stopDist);
  // 도착한 이 틱부터 센다 — 0 은 "문간이 아니다"라 쓸 수 없다
  e.gateTicks = 1;
  e.gateBiteCdLeft = 0;
  ctx.events.push({
    type: 'enemyAtGate',
    enemyId: e.id,
    defId: e.defId,
    x: e.x,
    z: e.z,
    owed: e.gateOwed,
    holdTicks: holdTicksFor(ctx, e),
  });
  bite(ctx, e);
}

/**
 * 매 틱 — 문간 판정. 틱 순서상 `updateSiege` **직후**, `moveEnemies` **직전**이다.
 *
 * 왜 그 자리인가(battle.ts 헤더의 "결정을 읽는 쪽이 뒤"와 같은 규칙):
 *  · 공성 **뒤** — 두 단계가 같은 `blockerAllyId` 스냅샷을 봐야 "봉쇄된 적은 타워도 안
 *    때리고 마을도 안 문다"가 한 틱 안에서 일관된다.
 *  · 이동 **앞** — 이동이 `atGate` 를 읽어 전진을 멈추기 때문이다(`isSieging` 과 같은 꼴).
 *
 * ⚠⚠ 첫 두 줄의 순서가 **종료 증명 그 자체**다. `gateTicks++` 앞에 조건을 하나라도
 *   더 놓으면 보조정리 A 가 무너지고 판이 영영 안 끝나는 상태가 생긴다.
 *   `tests/sim/gate.test.ts` 의 '불사 적' 계약이 그것을 잠근다.
 */
export function updateGate(ctx: SimCtx): void {
  for (const e of ctx.world.enemies.items) {
    if (!e.alive) continue;
    if (e.gateTicks <= 0) continue;
    // ── 보조정리 A ── 무조건이다. 여기 앞에 아무 분기도 놓지 마라.
    e.gateTicks++;
    // 규칙 7) 상한 — 뚫고 들어간다. 남은 잔액은 leakEnemy 가 한 방에 청구한다
    if (e.gateTicks >= holdTicksFor(ctx, e)) {
      leakEnemy(ctx, e); // 회수는 사망 처리 단계에서
      continue;
    }
    // 규칙 6) 총액을 다 물었다 — 상한까지 그냥 서서 맞는다(마을·타워에게는 정지 표적이다)
    if (e.gateOwed <= 0) continue;
    // 규칙 8) 스턴 = 완전 무력화. 쿨다운도 안 흐른다 (siege.ts 규칙 5 그대로)
    if (isStunned(e)) continue;
    // 규칙 8) 봉쇄 = 표적 전환. 눈앞의 사람을 놔두고 마을을 물지 않는다.
    //   스턴과 달리 **쿨다운은 흐른다** — 무력화가 아니기 때문이다 (siege.ts 규칙 1-b)
    if (e.blockerAllyId >= 0) {
      if (e.gateBiteCdLeft > 0) e.gateBiteCdLeft--;
      continue;
    }
    // 감산 뒤에 0 을 검사한다 — siege 의 `attackCdLeft` 규약과 같은 꼴이라야 주기가
    // 정확히 biteTicks 다(감산 전에 검사하면 한 틱씩 밀려 주기가 31 이 된다)
    if (e.gateBiteCdLeft > 0) e.gateBiteCdLeft--;
    if (e.gateBiteCdLeft > 0) continue;
    bite(ctx, e);
  }
}

/**
 * 지금 문 앞에 선 개체 수 — HUD 띠와 계측이 읽는다. 순회만 하고 아무것도 안 바꾼다.
 * (`ctx.world.enemies.items` 를 밖에서 돌게 하면 그 순회가 곧 결정론 표면이 된다)
 */
export function gateCount(ctx: SimCtx): number {
  let n = 0;
  for (const e of ctx.world.enemies.items) if (e.alive && e.gateTicks > 0) n++;
  return n;
}
