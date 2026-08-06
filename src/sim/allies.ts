/**
 * 아군 부족 유닛 — 마을에서 골드로 뽑아 내보내는 소모품 전력. 결정론 100%(rng 미사용).
 *
 * ── 행동 규칙 (확정) ───────────────────────────────────────────────────────
 * 1) **경로 역주행. 이탈 없음.**
 *    아군은 기지(경로 끝)에서 나와 적이 오는 방향으로 **같은 폴리라인을 거꾸로** 걷는다.
 *    dist 파라미터화는 적과 완전히 동일하고(0 = 스폰, totalLength = 기지) 아군만 감소한다.
 *
 *    자유 이동(스티어링)을 버린 이유는 셋이다.
 *     · **규칙 대칭** — 적은 절대 경로를 벗어나지 않는다(siege.ts 규칙 1). 아군만 들판을
 *       가로지르면 "왜 쟤들은 길로만 다니지"라는 설명 불가능한 비대칭이 생긴다.
 *     · **읽히는 그림** — 둘 다 길 위에 있으니 반드시 길목에서 맞붙는다. 어디서 싸움이
 *       날지 플레이어가 내보내기 전에 안다. 자유 이동은 어디서 만날지 예측이 안 된다.
 *     · **공짜 정확도** — 위치·방향·보행 위상이 전부 BattlePath.sample 하나로 나온다.
 *       충돌 회피도, 지형 통과 판정도, 경로 재계산도 필요 없다(이 게임엔 그런 게 없다).
 *    잃는 것은 "타워 옆에 세워 두기" 같은 배치 자유인데, 그건 타워가 할 일이다.
 *
 *    어느 경로로 나가는가: 커맨드가 pathIndex를 지정하지 않으면 **기지에 가장 가까운
 *    적이 있는 지상 경로**를 고른다(동점/적 없음 → 0번). 상태만 보고 정하므로 결정론이고,
 *    "제일 급한 쪽으로 달려간다"는 기대와도 맞는다. 공중 경로로는 나가지 않는다 —
 *    아군은 걷는다.
 *
 * 2) **출격 한계선 — 마을 앞까지만 나간다. 얼마나 앞까지인지는 마을이 정한다.**
 *    holdDist = max(0, totalLength - reach) + slot × ALLY_HOLD_SPACING. 여기 닿으면 멈춰 선다.
 *    없으면 아군이 적 스폰 지점까지 걸어가 입구에서 웨이브를 요격해 버려 타워가
 *    무의미해진다. 한계선이 있으면 아군은 "마지막 방어선"이고 타워는 여전히 "길목"이다.
 *
 *    reach는 **마을 레벨의 함수**다: BASE_LEVELS[baseLevel-1].sortie
 *    (Lv1 6.0 → Lv5 12.0, hometown.baseSortieRange). 즉 마을 레벨업은 체력·화력·사거리에
 *    더해 **"우리 부족이 더 멀리 나간다"**를 판다. 이걸 마을에 묶은 이유는 셋이다:
 *     · 아군의 병목은 화력이 아니라 **가동률**이다(살아 있는 시간의 1.1%만 교전 — 5단계
 *       실측, balance.ALLY_RETIRE_REFUND 주석). 한계선을 늘리는 것은 화력을 더 주는 게
 *       아니라 **일할 자리를 주는 것**이라 이 병목에 직접 닿는다.
 *     · 지금까지 아군과 마을은 같은 골드를 두고 경쟁만 했다. 이제 서로를 강화한다.
 *     · Lv1은 6.0 그대로라 **초반 입구 요격 붕괴는 막힌 채로 남는다** — 억제가 필요한
 *       것은 초반이고, 마을에 값을 치른 만큼만 풀린다.
 *
 *    2-c) **경로가 짧으면 표의 값을 다 쓰지 못한다** (7단계, balance.ALLY_SORTIE_PATH_LIMIT).
 *    상한 cap = max(6.0, 최단 지상경로 × 0.5) — **경로의 마을 쪽 절반까지가 부족의 몫**이고
 *    스폰 쪽 절반은 언제나 타워의 몫으로 남는다. 표의 값이 절대 타일 수인데 경로 길이가
 *    s4 17.59 ~ s1 36.19로 두 배 넘게 차이 나서, 상한이 없으면 만렙 12.0이 s4에서 경로의
 *    68%가 되어 규칙 2가 막으려던 입구 요격이 그대로 일어난다.
 *    **8단계: 자르지 않고 곡선을 cap에 맞춰 압축한다** — 잘라내면 s4의 Lv3·4·5가 전부
 *    8.80으로 같아져 가장 비싼 세 칸이 아무것도 팔지 않았다(누적 3,600골드에 +0.00타일).
 *    실효값 s4 6.00/7.17/7.86/8.33/8.80 · s6 6.00/8.15/9.44/10.30/11.16이고 나머지 넷은
 *    표 그대로다. Lv1 6.0은 어디서도 깎이지 않는다.
 *    상한은 hometown.baseSortieRange **한 곳**에서만 걸리므로 화면 표식(allySortiePoints)·
 *    패널 숫자·실제 정지 지점이 자동으로 같은 값을 쓴다.
 *
 *    2-b) **레벨업은 이미 나가 있는 아군에게도 즉시 적용된다.**
 *    holdDist는 출동 때 박아 두는 값이 아니라 **매 틱 마을 레벨에서 다시 유도**한다
 *    (moveAllies). 그래서 마을을 키우는 순간 길목에 서 있던 부족원들이 그 자리에서
 *    앞으로 걸어 나간다. 다음 출동부터 적용하는 안을 버린 이유:
 *     · 아군 수명은 20초뿐이다. "다음 출동부터"면 되돌릴 수 없는 큰 결제를 하고도
 *       화면에서 20초 동안 아무 일도 일어나지 않아, **이 업그레이드가 아군을 강화한다는
 *       사실 자체가 보이지 않는다**. 설계 의도가 전달되지 않으면 없는 기능과 같다.
 *     · 이 게임의 업그레이드는 전부 즉시 반영이다 — 마을 레벨업의 HP/공격력/사거리도
 *       (hometown.ts 규칙 4), 타워 업그레이드도 그 자리에서 바뀐다. 아군만 예약 배송이면
 *       규칙이 하나 더 생긴다.
 *     · 상태가 줄어든다. 유도값이면 저장할 것이 없고, baseLevel은 이미 hash()에 있어
 *       결정론에 새로 낼 비용이 0이다.
 *    **교전 중인 아군은 그 자리에 남는다** — 붙잡고 있는 적을 놓고 앞으로 가지 않는다
 *    (규칙 5의 "근접형은 교전 중이면 선다"가 한계선 판정보다 먼저다). 즉 레벨업은
 *    "지금 싸우는 사람"이 아니라 "서서 기다리는 사람"만 앞으로 보낸다.
 *
 *    **대가는 명시적으로 받아들인다**: 경로 초입에 지은 타워가 습격대에게 두들겨 맞으면
 *    아군은 그걸 구하러 갈 수 없다. 실측으로 잠가 뒀다(tests/sim/allies.test.ts
 *    "출격 한계선 밖(경로 초입)의 타워는 아군이 구하지 못한다" — 아군 유무로 타워 피해가
 *    1의 자리까지 동일). 이건 버그가 아니라 규칙 2가 사려는 것의 뒷면이다:
 *    아군이 맵 전체의 소방수가 되면 "타워를 어디에 짓는가"가 의미를 잃는다.
 *    만렙 12.0도 스테이지1 경로 36.19타일의 33%라 **이 대가는 만렙에서도 남는다**.
 *    (경로가 짧은 스테이지4에서는 이 비율이 68%까지 올라간다 — hometown.ts의 경고 참조)
 *
 * 3) **수명이 있다 — 영구 유닛은 없다.**
 *    lifeTicks(20초)가 다하면 마을로 돌아간다(allyRetired). 영구로 두면 골드가 쌓일수록
 *    무한 누적되어 후반이 무의미해지고, 동시 상한을 걸면 이번엔 "한 번 뽑으면 끝"이라
 *    골드를 쓸 곳이 사라진다. 시간제는 **지금 이 웨이브를 넘기려고 지르는** 긴급 자원이다.
 *    수명은 prep에서도 흐른다 — 미리 뽑아 두는 플레이를 막고, 조기 웨이브 호출
 *    (earlyCallBonus)과 "뽑았으면 바로 부른다"로 자연스럽게 엮인다.
 *
 * 4) **동시 상한 ALLY_MAX_ACTIVE + 지수 비용.**
 *    상한은 렌더 정원과 밸런스를 동시에 지킨다(balance.ts 주석). 비용은 **나가 있는
 *    인원수**로 오르므로 죽거나 돌아가면 되돌아온다 — 소모품다운 경제다.
 *
 * 5) **충돌은 없다. 대신 "봉쇄"다.**
 *    이 게임은 유닛 충돌이 없다(적끼리 겹친다). 아군에게만 충돌을 주면 규칙이 어긋나고,
 *    밀어내기 물리가 없는 상태에서 겹침 금지를 넣으면 좁은 코너에서 유닛이 낀다.
 *    그래서 위치는 그대로 겹치되 **상태**로 표현한다:
 *      · 근접 아군(blocks)이 사거리 안의 **지상** 적을 타깃으로 잡으면
 *        그 적의 blockerAllyId가 서고 → 적의 전진이 멈춘다.
 *      · 봉쇄된 적은 **타워도 때리지 않는다**(siege가 건너뛴다). 눈앞의 사람을 놔두고
 *        멀리 있는 움막을 두들기는 그림은 설명이 안 되고, 무엇보다 이게 아군 유닛의
 *        존재 이유다 — 골드를 내고 **타워의 수명을 산다**.
 *      · 봉쇄된 적은 자기를 막은 아군 중 **가장 낮은 id 하나**를 난투로 반격한다.
 *        전원에게 동시에 반격하게 하면 아군을 여럿 붙일수록 손해가 되어 상한이 무의미해진다.
 *    공중 적은 절대 봉쇄되지 않는다 — 날아서 지나간다. 그래서 아군은 대공 대책이 아니다.
 *
 * 6) **타게팅** — 사거리 내 최근접, 동점은 낮은 적 id. 유효한 동안 갈아타지 않는다
 *    (타워·습격대의 lockedTarget 규약과 동일). 근접형(canTargetAir=false)은 공중을 무시한다.
 *
 *    6-b) **한 아군은 이미 다른 아군이 붙잡은 적을 골라잡지 않는다** (근접형 한정).
 *    이 단서가 없으면 최근접 + 고정 타깃 규약이 정확히 반대로 작동한다: 맨 앞 아군이
 *    선두의 적을 세우면 그 적은 **그 자리에 멈추므로** 뒤에 선 아군 전원에게도 계속
 *    최근접이 되어(대기 간격 0.5 < 근접 사거리 1.0~1.15) 여섯이 한 마리에 달라붙고
 *    나머지 웨이브는 그 옆을 그냥 지나간다.
 *
 *    4단계 실측 — 직선 경로, 랩터 24마리, 인원을 계속 채우며 잰 (봉쇄된 적틱 / 아군틱).
 *    **아래 숫자는 전부 규칙 5-b(정원 봉쇄) 도입 전, 1인당 1마리 시절의 값이다**
 *    (5-b가 들어간 뒤의 값은 balance.ALLY_BLOCK_CAPACITY 주석에 따로 있다):
 *      1명 0.63 · 2명 0.48 · 3명 0.38 · 4명 0.32 · 5명 0.28 · 6명 0.27
 *    즉 골드를 14배(110 → 1,588) 써도 봉쇄량은 2.5배(512 → 1,280)밖에 안 늘었다.
 *    난이도 스윕에서도 그대로 나타났다 — 아군에 골드의 11%를 쓰면 위약(효과 0인 같은
 *    비용의 유닛) 대비 +3승이지만 19%를 쓰면 **+0승**이었다. 상한 6명과 지수 비용이
 *    사는 것이 아무것도 없었다는 뜻이다.
 *
 *    6-b만 적용한 직후(여전히 1인당 1마리): 1명 0.63 · 2명 0.61 · 3명 0.56 · 4명 0.51 ·
 *    5명 0.46 · 6명 0.41.
 *    총 봉쇄틱은 6명에서 1,280 → **2,044(+60%)**, 누수는 3 → 0이 됐다. 6명에서 여전히
 *    0.41까지 처지는 건 **줄 안에 적이 여섯 마리가 늘 있지는 않기 때문**이라 정상이다
 *    (같은 실험을 밀도가 낮은 blade×16으로 하면 0.36까지 더 내려간다) — 남은 체감은
 *    "인원이 웨이브 밀도를 넘어서면 남는다"는 올바른 신호다.
 *
 *    대가도 같이 생긴다. 예전에는 여섯이 한 마리를 둘러싸도 반격은 **가장 낮은 id 하나**만
 *    받아 나머지 다섯이 무상이었는데, 이제는 각자 자기 적에게 맞으므로 여섯 명 모두가
 *    피를 흘린다. "많이 낼수록 많이 막고 많이 죽는다"가 되어 인원이 실제 판단이 된다.
 *
 *    처리 순서는 **아군 id 오름차순**이다(pickOrder). 풀은 swap-remove라 items 순서가
 *    섞이는데, 그 순서에 따라 누가 먼저 적을 고르는지가 갈리면 규칙을 말로 적을 수 없다.
 *    id 오름차순이면 대체로 먼저 출동한 = 앞줄(slot이 작은) 아군부터 고르게 되어
 *    "앞줄부터 차례로 상대를 맡는다"가 그대로 성립한다.
 *
 *    (규칙 6 계속) 적 쪽 타게팅은 **바뀌지 않는다** — 기지로 직행하는 적은 여전히 직행하고, 습격대는
 *    여전히 타워를 노린다. 적이 아군을 '찾아다니는' 행동은 넣지 않았다:
 *    넣으면 아군 한 명으로 웨이브 전체를 낚아 세울 수 있어 그 순간 게임이 끝난다.
 *    적이 아군을 때리는 유일한 경로는 **자기가 봉쇄당했을 때의 반격**이다.
 *
 * 7) **아군에게는 상태이상이 없다.** 적에게 상태 부여 능력이 없으므로 받을 일이 없고,
 *    없는 쪽이 규칙이 하나 적다. 아군은 타워 스플래시/오라에도 맞지 않는다(아군 오사 없음).
 *
 * 8) **쓰러지면 환불 없음. 살아 돌아오면 기본 삯의 절반**(ALLY_RETIRE_REFUND).
 *    3단계까지는 무조건 환불 없음이었는데, 그러면 "혹시 몰라 미리 내보낸다"가 언제나
 *    손해라 플레이어가 **뚫린 뒤에** 부르게 된다 — 걸어 나가는 데만 5초가 걸리는 유닛에게
 *    그건 이미 늦은 시점이다. 아군의 실측 가동률이 이기는 판 1.1% · 밀리는 판 3.5%로
 *    위험도에 정비례하므로(balance.ALLY_RETIRE_REFUND 주석), 보험료는 **안 쓰였을 때
 *    싸야** 한다. 되돌아오는 것은 정가의 절반뿐이고 지수 웃돈은 돌아오지 않으며,
 *    싸우다 쓰러진 아군은 한 푼도 돌려주지 않는다 — 즉 값은 **실제로 싸운 만큼** 치른다.
 *
 * ── 교착(스톨) 안전성 ──────────────────────────────────────────────────────
 * 봉쇄는 웨이브 완료 조건(전원 스폰 + 생존 0)을 막을 수 있다. 무한 교착이 나지 않는 근거:
 *  · 봉쇄는 아군이 살아 있는 동안만 유지되고, 아군의 수명은 lifeTicks로 유한하다.
 *  · 난투 피해는 항상 1 이상이다(damageAlly의 최소 1 + enemyBrawlDmgFor의 최소 2).
 *  · 아군은 동시 ALLY_MAX_ACTIVE명이고 비용이 지수로 오른다 — 무한 릴레이가 불가능하다.
 * 즉 최악의 경우에도 봉쇄는 lifeTicks 안에 반드시 풀린다.
 *
 * three/DOM 임포트 금지.
 */
import { TICK_DT } from '@/data/types';
import type { AllyDef, AllyId, Vec2 } from '@/data/types';
import {
  ALLY_BLOCK_CAPACITY,
  ALLY_HOLD_SPACING,
  ALLY_MAX_ACTIVE,
  ALLY_RETIRE_REFUND,
  BRAWL_COOLDOWN_TICKS,
  allyCostFor,
  enemyBrawlDmgFor,
} from '@/data/balance';
import { dist2 } from '@/core/mathx';
import { addGold, damageAlly, damageEnemy } from './combat';
import type { AllySim, EnemySim, SimCtx } from './entities';
import { baseSortieRange } from './hometown';
import { isStunned } from './status';

/** 지금 이 종을 한 명 더 내보내는 실비용 (나가 있는 인원 수에 따라 오른다) */
export function allyTrainCost(ctx: SimCtx, def: AllyDef): number {
  return allyCostFor(def.cost, ctx.world.allies.length);
}

/** 지금 출동이 가능한가 (상한 + 골드) — UI 비활성 표시와 커맨드 거부가 같은 판정을 쓴다 */
export function canTrainAlly(ctx: SimCtx, def: AllyDef): boolean {
  if (ctx.world.allies.length >= ALLY_MAX_ACTIVE) return false;
  return ctx.view.gold >= allyTrainCost(ctx, def);
}

/**
 * 규칙 2) 이 슬롯이 서야 할 대기 지점 (경로 호장).
 *
 * **저장하지 않고 매 틱 다시 부르는 함수**다 (규칙 2-b): 한계선이 마을 레벨에서 나오므로
 * 레벨업이 이미 나가 있는 아군에게도 그 틱에 바로 반영된다. 대기 슬롯 간격
 * (ALLY_HOLD_SPACING)도 당연히 **새** 한계선을 기준으로 다시 깔린다 — 줄만 앞으로
 * 통째로 옮겨지고 줄 모양(0.5타일 간격)은 그대로다.
 */
function holdDistFor(ctx: SimCtx, totalLength: number, slot: number): number {
  const reach = baseSortieRange(ctx);
  return Math.min(totalLength, Math.max(0, totalLength - reach) + slot * ALLY_HOLD_SPACING);
}

/**
 * 규칙 2) **지금 아군이 멈춰 서는 지점** — 지상 경로마다 하나 (셀 연속 좌표).
 * 줄 맨 앞(slot 0) 기준이다. UI가 마을 패널에서 한계선을 화면에 그릴 때 쓴다.
 *
 * 왜 UI가 직접 계산하지 않는가: 한계선은 **경로 호장** 기준이라 기지 중심의 원이 아니다.
 * 굽은 경로에서는 원과 실제 정지 지점이 눈에 띄게 어긋나고, 경로가 둘인 스테이지
 * (4·6)에서는 갈래마다 지점이 다르다. 표식이 규칙과 어긋나면 없느니만 못하다.
 *
 * **경로 수와 표식 수는 1:1이 아니다** (8단계). 갈래가 마을 쪽에서 합류하는 스테이지에서
 * 한계선이 합류 지점보다 안쪽이면 두 경로가 **같은 좌표**를 낸다 — 실측 s4 Lv1에서
 * 두 원소가 (5, 8)로 완전히 일치했다. 그대로 두면 표식이 같은 자리에 두 벌 구워져
 * (a) 삼각형 64개가 낭비되고 (b) 반투명 머티리얼이 두 번 블렌딩되어(depthTest 없음)
 * 그 스테이지의 봉수대만 유독 진해진다. 그림이 규칙("정지 지점의 집합")과 어긋난다.
 */
/** 같은 정지 지점으로 볼 좌표 차 (셀 단위). 부동소수 오차만 접고 실제 갈래는 남긴다 */
const SORTIE_POINT_EPS = 1e-3;

export function allySortiePoints(ctx: SimCtx): Vec2[] {
  const out: Vec2[] = [];
  const p = { x: 0, z: 0, heading: 0 };
  for (const path of ctx.groundPaths) {
    path.sample(holdDistFor(ctx, path.totalLength, 0), p);
    let dup = false;
    for (const q of out) {
      if (Math.abs(q.x - p.x) < SORTIE_POINT_EPS && Math.abs(q.z - p.z) < SORTIE_POINT_EPS) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push({ x: p.x, z: p.z });
  }
  return out;
}

/**
 * 규칙 2) 대기 줄의 빈 자리 — 같은 경로 위 아군이 쓰지 않는 가장 작은 슬롯 번호.
 * 앞줄이 죽으면 다음 출동이 그 자리를 메우므로 줄에 구멍이 남지 않는다.
 */
function freeSlot(ctx: SimCtx, pathIndex: number): number {
  const used = new Set<number>();
  for (const a of ctx.world.allies.items) {
    if (a.alive && a.pathIndex === pathIndex) used.add(a.slot);
  }
  for (let s = 0; s < ALLY_MAX_ACTIVE; s++) if (!used.has(s)) return s;
  return ALLY_MAX_ACTIVE - 1;
}

/**
 * 규칙 1) 경로 자동 선택 — 기지에 가장 가까운 **지상** 적이 있는 경로.
 * 동점이나 적이 없으면 0번. 상태만 보고 정하므로 완전 결정론이다.
 */
function autoPathIndex(ctx: SimCtx): number {
  const paths = ctx.groundPaths;
  let best = 0;
  let bestRemain = Infinity;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive || e.flying) continue;
    const idx = e.pathIndex < paths.length ? e.pathIndex : 0;
    const path = paths[idx];
    if (!path) continue;
    const remain = path.totalLength - e.dist;
    if (remain < bestRemain || (remain === bestRemain && idx < best)) {
      best = idx;
      bestRemain = remain;
    }
  }
  return best;
}

/**
 * 출동 커맨드 본체 — 성공하면 골드를 깎고 기지에서 스폰시킨다.
 * 거부 조건: 정의 없음 / 상한 도달 / 골드 부족 / 지상 경로 없음.
 */
export function trainAlly(ctx: SimCtx, defId: AllyId, pathIndex?: number): boolean {
  const def = ctx.opts.allyDefs[defId];
  if (!def) return false;
  if (!canTrainAlly(ctx, def)) return false;
  const cost = allyTrainCost(ctx, def);
  const paths = ctx.groundPaths;
  const idx =
    pathIndex !== undefined && pathIndex >= 0 && pathIndex < paths.length
      ? pathIndex
      : autoPathIndex(ctx);
  const path = paths[idx];
  if (!path) return false;

  // 규칙 2) 대기 줄 자리는 **acquire 전에** 정한다 — 새 유닛은 이미 리스트에 들어가
  // 있으므로 나중에 부르면 자기 자신(풀에서 나온 slot 0)을 사용 중으로 세어 한 칸씩 밀린다
  const slot = freeSlot(ctx, idx);

  addGold(ctx, -cost);
  const a = ctx.world.acquireAlly();
  a.defId = defId;
  a.def = def;
  a.hp = def.hp;
  a.maxHp = def.hp;
  a.pathIndex = idx;
  a.dist = path.totalLength; // 기지에서 출발
  a.slot = slot;
  a.holdDist = holdDistFor(ctx, path.totalLength, slot);
  a.lifeLeft = Math.max(1, Math.round(def.lifeTicks));
  path.sample(a.dist, a);
  a.heading += Math.PI; // 역주행 — 진행 방향의 반대를 본다
  a.prevX = a.x;
  a.prevZ = a.z;
  ctx.events.push({
    type: 'allyTrained',
    allyId: a.id,
    defId,
    cost,
    pathIndex: idx,
    x: a.x,
    z: a.z,
  });
  return true;
}

/**
 * 규칙 6-b) 이 적은 **다른** 아군이 이미 붙잡았는가.
 * blockerAllyId는 매 틱 처음에 전부 -1로 지워지고 이 틱의 아군 루프가 순서대로 채우므로,
 * 여기서 읽히는 값은 "나보다 앞 순서(=낮은 id)의 아군이 이미 맡았다"는 뜻이다.
 */
function claimedByOther(a: AllySim, e: EnemySim): boolean {
  return e.blockerAllyId >= 0 && e.blockerAllyId !== a.id;
}

/** 규칙 6) 현재 고정 타깃이 여전히 유효하면 반환, 아니면 null (재조준 필요) */
function lockedEnemy(ctx: SimCtx, a: AllySim, r2: number): EnemySim | null {
  if (a.targetId < 0) return null;
  const e = ctx.world.findEnemy(a.targetId);
  if (!e || !e.alive) return null;
  if (!a.def.canTargetAir && e.flying) return null;
  // 규칙 6-b) 앞줄이 이미 맡은 적이면 고정을 풀고 다른 상대를 찾는다
  if (a.def.blocks && claimedByOther(a, e)) return null;
  return dist2(a.x, a.z, e.x, e.z) <= r2 ? e : null;
}

/**
 * 규칙 6 + 6-b) 사거리 내에서 고를 적.
 * 우선순위: (근접형만) **아무도 안 맡은 적** → 최근접 → 동점은 낮은 적 id.
 * 원거리형(blocks=false)은 봉쇄를 하지 않으므로 이 우선순위를 쓰지 않는다 —
 * 막지 못하는 유닛이 상대를 갈라 서면 화력만 흩어진다(집중사격이 낫다).
 */
function pickEnemy(ctx: SimCtx, a: AllySim, r2: number): EnemySim | null {
  const avoidClaimed = a.def.blocks;
  let best: EnemySim | null = null;
  let bestD2 = Infinity;
  let bestClaimed = true;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive) continue;
    if (!a.def.canTargetAir && e.flying) continue;
    const d2 = dist2(a.x, a.z, e.x, e.z);
    if (d2 > r2) continue;
    const claimed = avoidClaimed && claimedByOther(a, e);
    if (best === null || (bestClaimed && !claimed)) {
      best = e;
      bestD2 = d2;
      bestClaimed = claimed;
    } else if (claimed === bestClaimed && (d2 < bestD2 || (d2 === bestD2 && e.id < best.id))) {
      best = e;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * 규칙 5-b) 봉쇄 지정 — 사거리 안의 **가까운 지상 적부터 최대 ALLY_BLOCK_CAPACITY마리**를
 * 이 아군에게 묶는다. 이미 다른 아군이 잡은 적은 건너뛴다(이중 봉쇄 없음).
 *
 * 1마리 고정이었을 때 왜 안 됐는지, 무제한이면 왜 안 되는지는 balance.ALLY_BLOCK_CAPACITY 주석.
 */
function claimBlockade(ctx: SimCtx, a: AllySim, r2: number): void {
  for (let k = 0; k < ALLY_BLOCK_CAPACITY; k++) {
    let best: EnemySim | null = null;
    let bestD2 = Infinity;
    for (const e of ctx.world.enemies.items) {
      if (!e.alive || e.flying || e.blockerAllyId >= 0) continue;
      const d2 = dist2(a.x, a.z, e.x, e.z);
      if (d2 > r2) continue;
      if (d2 < bestD2 || (d2 === bestD2 && best !== null && e.id < best.id)) {
        best = e;
        bestD2 = d2;
      }
    }
    if (!best) return;
    best.blockerAllyId = a.id;
  }
}

/**
 * 규칙 6-b) 아군을 **id 오름차순**으로 늘어놓는 스크래치 버퍼.
 * 풀(DenseList)은 swap-remove라 items 순서가 사망/귀환으로 섞인다. 그 순서대로 적을
 * 고르게 두면 결정론은 유지되지만(같은 시드면 같은 순서) 규칙을 말로 적을 수 없다.
 * 정원이 ALLY_MAX_ACTIVE(6)라 삽입 정렬이면 충분하고, 버퍼를 재사용해 매 틱 할당이 없다.
 */
const pickOrder: AllySim[] = [];

function fillPickOrder(items: readonly AllySim[]): void {
  pickOrder.length = 0;
  for (const a of items) {
    if (!a.alive) continue;
    let i = pickOrder.length;
    pickOrder.push(a);
    for (; i > 0 && (pickOrder[i - 1] as AllySim).id > a.id; i--) {
      pickOrder[i] = pickOrder[i - 1] as AllySim;
    }
    pickOrder[i] = a;
  }
}

/**
 * 매 틱 — 아군 조준/타격 + 봉쇄 지정 + 적의 난투 반격.
 *
 * **틱 순서에서 여기가 맨 앞인 이유** (battle.ts 참조):
 *  · 이동보다 앞 — 봉쇄(blockerAllyId)를 이동 단계가 읽어야 적이 멈춘다.
 *    적 습격대가 updateSiege를 이동보다 앞에 두는 것과 정확히 같은 이유다(siege.ts 규칙 4).
 *  · updateSiege보다 앞 — 봉쇄된 적은 타워를 때리지 않는다(규칙 5). 그 판정을 siege가
 *    읽으려면 봉쇄가 먼저 서 있어야 한다.
 * 즉 "봉쇄 확정 → 공성 → 이동"이 한 틱 안의 인과 순서다.
 */
export function updateAllies(ctx: SimCtx): void {
  const allies = ctx.world.allies.items;
  const enemies = ctx.world.enemies.items;
  // 봉쇄는 매 틱 새로 세운다 — 지난 틱의 값이 남으면 아군이 죽은 뒤에도 적이 굳는다
  for (const e of enemies) e.blockerAllyId = -1;

  // 1단계: 아군의 조준/타격 + 봉쇄 지정 — 규칙 6-b) id 오름차순(=대체로 앞줄부터)
  fillPickOrder(allies);
  for (const a of pickOrder) {
    if (a.attackCdLeft > 0) a.attackCdLeft--;
    const def = a.def;
    const r2 = def.range * def.range;
    // 규칙 5-b) 몸으로 막는다 — 사거리 안의 가까운 적부터 ALLY_BLOCK_CAPACITY마리까지
    if (def.blocks) claimBlockade(ctx, a, r2);
    const target = lockedEnemy(ctx, a, r2) ?? pickEnemy(ctx, a, r2);
    a.targetId = target ? target.id : -1;
    if (!target) continue;
    if (a.attackCdLeft > 0) continue;
    ctx.events.push({
      type: 'allyAttacked',
      allyId: a.id,
      defId: a.defId,
      targetId: target.id,
      x: a.x,
      z: a.z,
      targetX: target.x,
      targetZ: target.z,
      ranged: !def.blocks,
    });
    damageEnemy(ctx, target, def.dmg, a.defId);
    a.attackCdLeft = Math.max(1, Math.round(def.cooldownTicks));
  }

  // 2단계: 봉쇄된 적의 난투 반격 (규칙 5)
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.blockerAllyId < 0) {
      e.brawlCdLeft = 0; // 붙잡히지 않은 적은 다음 교전에서 즉시 한 대 친다
      continue;
    }
    if (isStunned(e)) {
      // 스턴은 공성과 마찬가지로 완전 무력화 — 쿨다운도 흐르지 않는다 (siege.ts 규칙 5)
      continue;
    }
    if (e.brawlCdLeft > 0) {
      e.brawlCdLeft--;
      continue;
    }
    const blocker = ctx.world.findAlly(e.blockerAllyId);
    if (!blocker || !blocker.alive) continue;
    const spec = e.def.brawl;
    const dmg = spec ? spec.dmg : enemyBrawlDmgFor(e.def.cost);
    damageAlly(ctx, blocker, dmg, e);
    e.brawlCdLeft = Math.max(1, Math.round(spec ? spec.cooldownTicks : BRAWL_COOLDOWN_TICKS));
  }
}

/**
 * 매 틱 — 아군 이동(역주행) + 수명 감소. moveEnemies **직후**에 돈다:
 * 교전 판정은 이미 updateAllies에서 끝났고, 여기서는 그 결과대로 걷거나 멈추기만 한다.
 * (적과 아군을 같은 틱 안에서 같은 스냅샷으로 움직여야 사거리 판정이 한쪽으로 기울지 않는다)
 */
export function moveAllies(ctx: SimCtx): void {
  for (const a of ctx.world.allies.items) {
    if (!a.alive) continue;
    a.prevX = a.x;
    a.prevZ = a.z;
    // 규칙 3) 수명 — prep에서도 흐른다
    if (a.lifeLeft > 0) a.lifeLeft--;
    if (a.lifeLeft <= 0) {
      a.alive = false;
      // 규칙 8) 살아 돌아온 사람만 **기본 삯의 일부**를 되돌려준다 (balance.ALLY_RETIRE_REFUND).
      // 쓰러진 아군은 damageAlly 쪽에서 처리되므로 여기 오지 않는다 = 환급 없음.
      const refund = Math.round(a.def.cost * ALLY_RETIRE_REFUND);
      if (refund > 0) addGold(ctx, refund);
      ctx.events.push({ type: 'allyRetired', allyId: a.id, defId: a.defId, x: a.x, z: a.z, refund });
      continue;
    }
    const path = ctx.groundPaths[a.pathIndex] ?? ctx.groundPaths[0];
    if (!path) continue;
    // 규칙 2-b) 한계선은 저장값이 아니라 **매 틱 마을 레벨에서 유도**한다.
    // 교전 중인 아군에게도 갱신해 둔다 — 저장된 값이 지금 규칙과 어긋난 채 남으면
    // 화면 표식(마을 패널의 출격선)과 실제가 갈라진다
    a.holdDist = holdDistFor(ctx, path.totalLength, a.slot);
    // 규칙 5) 근접형은 교전 중이면 그 자리에 선다. 원거리는 걸으며 쏜다
    if (a.def.blocks && a.targetId >= 0) continue;
    if (a.dist <= a.holdDist) continue; // 규칙 2) 출격 한계선
    a.dist = Math.max(a.holdDist, a.dist - a.def.speed * TICK_DT);
    path.sample(a.dist, a);
    a.heading += Math.PI; // 역주행
  }
}

/** 사망/귀환한 아군 회수 — battle의 사망 처리 단계에서 역순으로 호출한다 */
export function sweepDeadAllies(ctx: SimCtx): void {
  const items = ctx.world.allies.items;
  for (let i = items.length - 1; i >= 0; i--) {
    if (!(items[i] as AllySim).alive) ctx.world.removeAllyAt(i);
  }
}
