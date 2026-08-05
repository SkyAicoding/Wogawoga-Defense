/**
 * 전역 밸런스 상수 — 데이터/메타/UI가 공유하는 규범 수치.
 *
 * ⚠ 아래 값들은 sim 쪽 하드코딩과 반드시 일치해야 한다 (통합 시 교차 검증):
 *  - SELL_REFUND_RATE       ↔ src/sim/economy.ts SELL_RATE      = 0.6
 *  - SCENERY_CLEAR_*        ↔ src/sim/economy.ts sceneryClearCostFor
 *  - REFRESH_BASE_COST      ↔ src/sim/economy.ts REFRESH_BASE   = 20
 *  - REFRESH_COST_GROWTH    ↔ src/sim/economy.ts REFRESH_GROWTH = 1.6
 *  - HAND_SIZE              ↔ src/sim/economy.ts HAND_SIZE      = 3
 *  - PREP_TICKS_FIRST/LATER ↔ src/sim/battle.ts                 = 150 / 90
 *  - EARLY_CALL_RATE        ↔ src/sim/battle.ts                 = 0.15
 *  - ENDLESS_HP_GROWTH      ↔ src/sim/battle.ts                 = 1.06
 */

/** 판매 환급률 (invested × 0.6 내림) */
export const SELL_REFUND_RATE = 0.6;
/**
 * 배치 지가 상승 — 타워 n기 배치 상태에서 새 배치 비용
 * = round(tiers[0].cost × (1 + PLACEMENT_TAX × n)).
 * T1 도배가 업그레이드를 지배하지 않도록 스팸 20기째 비용을 ≈3배로 올린다.
 * (sim/economy.ts가 임포트해 적용 — 핸드 CardState.cost는 항상 '지금 배치 시 실비용')
 */
export const PLACEMENT_TAX = 0.1;
/**
 * 방해 지형지물(나무·바위) 제거 비용 — n번째 제거(n은 0-base 누적 제거 수)에
 * = min(round(BASE × GROWTH^n), MAX). 환불 없음.
 * (sim/economy.ts sceneryClearCostFor가 임포트해 적용)
 *
 * 튜닝 근거:
 *  · BASE 300 ≈ **T2 업그레이드 한 번**(spear 200 / catapult 240 / lightning 280) 값.
 *    "자리를 하나 사려면 타워 한 기를 한 단계 올릴 돈을 포기한다"가 이 값의 이야기다.
 *
 *    80 → 120 (3단계) → 300 (4단계). 부족 습격대가 들어오면서 **칸의 가치가 올랐다**:
 *    예전에는 소품을 치워 사는 것이 '경로를 더 잘 덮는 자리'뿐이었지만, 이제는
 *    '근접이 닿지 않는 자리'(경로에서 2칸 이상, siege.ts 규칙 1)까지 산다 —
 *    즉 화력뿐 아니라 **타워 수명**을 사는 것이라 같은 값이면 이득이 훨씬 크다.
 *
 *    3단계의 120은 시드 5개로 검증돼 있었고, 넓은 시드에서는 여전히 지배 전략이었다.
 *    재실측(스테이지1, 시드 20개, 덱 spear+catapult+frost, 별 0 — 일반 봇 15/20승·
 *    기지HP합 171·손실골드 131,414 기준):
 *      BASE 120 → 불도저 17/20승·166·제거 20회 (승수 우위 +2 = 지배)
 *      BASE 300 → 불도저 16/20승·164·제거 12회 (승수 +1, 여유는 오히려 감소 = 맞교환)
 *      BASE 470 → 불도저 15/20승·171·제거  0회 (선택지 자체가 죽는다)
 *    300이 "값을 치르면 자리를 살 수 있지만, 사도 결과가 좋아지지는 않는" 지점이다.
 *
 *  · GROWTH 1.6 = 새로고침 곡선과 같은 기울기. 개별가 300/480/768/1229/1966/3146…,
 *    누적 300/780/1548/2777/4743/7889…로 **2회째 누적이 스테이지1 웨이브 1~20 총 보상
 *    (1,860골드)에 육박**한다. 스테이지1 소품은 40칸이라 '맵을 민다'는 선택지가 없다.
 *    → 지형 개조는 타워 강화를 포기해야만 가능해 배치세(PLACEMENT_TAX) 밸런스가 유지된다.
 *      실측: 불도저 봇(제거 우선)이 스테이지1에서 일반 봇보다 우세하지 않고
 *      스테이지6은 여전히 클리어 불가 (tests/sim/autoplay.test.ts).
 *  · MAX 4000 = 무한 모드 후반 골드 인플레에서도 지수가 오버플로하지 않게 하는 상한.
 *    (T5 업그레이드 1600~2400보다 비싸 후반에도 '도배'가 이득이 되지 않는다)
 */
export const SCENERY_CLEAR_BASE_COST = 300;
export const SCENERY_CLEAR_GROWTH = 1.6;
export const SCENERY_CLEAR_MAX_COST = 4000;

/** 핸드 새로고침: 웨이브당 1회 무료, 이후 20 × 1.6^n 반올림 */
export const REFRESH_BASE_COST = 20;
export const REFRESH_COST_GROWTH = 1.6;
/** 핸드 크기 (카드 3장 유지) */
export const HAND_SIZE = 3;
/** 준비 단계 카운트다운 (웨이브1 전 / 이후) */
export const PREP_TICKS_FIRST = 150;
export const PREP_TICKS_LATER = 90;
/** 조기 웨이브 호출 보너스: 남은 prep 틱 × 0.15 골드 (내림) */
export const EARLY_CALL_RATE = 0.15;
/** 무한 모드: waveCount 초과 웨이브당 추가 HP 성장 */
export const ENDLESS_HP_GROWTH = 1.06;

// ---------------------------------------------------------------------------
// 타워 구조물 체력 — 적 부족(사람)의 공격 대상 (sim/siege.ts가 소비)
//
// 수치 체계 (toughness 1.0 기준):
//   T1 260 / T2 390 / T3 585 / T4 878 / T5 1316
//   = TOWER_HP_BASE × TOWER_HP_TIER_GROWTH^tier, 별 1개당 +6%.
//
// 튜닝 근거:
//  · 260 = 근접 부족원(dmg 10 / 1초)이 혼자 26초를 두들겨야 T1 하나를 부수는 값.
//    한 명은 위협이 아니고 **무리**여야 위협이 된다는 게 이 메커니즘의 핵심이다
//    (6명이 붙으면 4.3초 — 플레이어가 반응할 시간은 있지만 방치하면 잃는다).
//  · 성장률 1.5는 티어 cost 성장(약 2.0)보다 낮다. 즉 "비싼 타워일수록 HP 효율은 나쁘다" —
//    고티어 한 기 몰빵이 부족 무리에게 더 취약해져, 분산 배치가 대안으로 남는다.
//  · 별(메타 진행) 보너스는 dmg/rate(8~10%)보다 얕은 6%다. 별은 화력을 사는 것이지
//    맷집을 사는 것이 아니며, 별 5개(+30%)로도 무리 앞에서는 결국 부서진다.
// ---------------------------------------------------------------------------
/** T1 기준 최대 HP (toughness 1.0) */
export const TOWER_HP_BASE = 260;
/** 티어당 최대 HP 배율 */
export const TOWER_HP_TIER_GROWTH = 1.5;
/** 별 1개당 최대 HP 증가율 */
export const TOWER_HP_PER_STAR = 0.06;
/**
 * 준비 단계(prep) 자동 수리 — STATUS_TICK_INTERVAL(0.5초)마다 maxHp의 이 비율만큼 회복.
 * 4% × 초당 2회 = 초당 8%. 웨이브 사이 prep 90틱(3초)에서 24%가 돌아온다.
 * prep에는 살아 있는 적이 0마리인 것이 시뮬레이션상 보장되므로(웨이브 완료 조건)
 * "수리 중 두들겨 맞는" 애매한 상태가 생기지 않는다.
 * 이 회복이 없으면 타워는 웨이브를 거듭할수록 무조건 죽는 소모품이 되어
 * 업그레이드 투자가 무의미해진다 — 수리는 손실을 되돌리는 게 아니라 늦추는 장치다.
 */
export const TOWER_REPAIR_PER_STATUS_TICK = 0.04;

/** 티어/별/내구도 배율 → 타워 최대 HP (정수). sim과 UI가 같은 함수를 쓴다. */
export function towerMaxHpFor(tier: number, stars = 0, toughness = 1): number {
  const t = Math.max(0, Math.floor(tier));
  return Math.max(
    1,
    Math.round(TOWER_HP_BASE * TOWER_HP_TIER_GROWTH ** t * (1 + stars * TOWER_HP_PER_STAR) * toughness),
  );
}

// ---------------------------------------------------------------------------
// 홈타운(기지) — 싸우고 성장하는 최후 방어선 (sim/hometown.ts가 소비)
//
// 레벨 테이블 자체와 수치 근거는 src/data/hometown.ts에 있다. 여기 있는 건
// **최대 HP를 정수로 확정하는 한 줄**뿐이다 — sim과 UI가 같은 함수를 써야
// 패널에 뜬 숫자와 실제 체력바가 어긋나지 않는다 (towerMaxHpFor와 같은 이유).
// ---------------------------------------------------------------------------
/**
 * 홈타운 최대 HP = round(스테이지 baseHp × 레벨 hpMul), 최소 1.
 * 정수로 확정하는 이유는 타워 수리와 같다 — hp가 부동소수가 되면 hash()가
 * 마지막 자리에서 흔들려 결정론 검증이 무의미해진다.
 */
export function baseMaxHpFor(stageBaseHp: number, hpMul: number): number {
  return Math.max(1, Math.round(stageBaseHp * hpMul));
}

// ---------------------------------------------------------------------------
// 아군 부족 유닛 — 마을에서 골드로 출동시키는 소모품 전력 (sim/allies.ts가 소비)
//
// 설계 근거 전문은 src/sim/allies.ts 헤더에 있다. 여기 있는 건 **경제 손잡이**뿐이다.
// ---------------------------------------------------------------------------
/**
 * 동시 출동 상한. 이 수에 도달하면 trainAlly가 거부된다(골드가 남아도).
 *
 * 왜 상한이 필요한가:
 *  · 렌더 — 아군은 적 습격대와 **같은 InstancedMesh**를 공유하므로 드로우콜은 안 늘지만
 *    인스턴스 정원(CAPACITY 100)을 적과 나눠 쓴다. 웨이브 최대 스폰이 60이라 여유는 있지만
 *    무제한이면 정원이 곧 밸런스가 되어 버린다.
 *  · 밸런스 — 상한이 없으면 후반 골드 인플레가 그대로 무한 방벽이 된다. 6명은
 *    "한 길목을 잠깐 막는다"는 크기이지 "전선을 만든다"는 크기가 아니다.
 */
export const ALLY_MAX_ACTIVE = 6;
/**
 * 출동 비용 성장 — 실비용 = round(def.cost × ALLY_COST_GROWTH^(현재 나가 있는 인원)).
 * 배치 지가(PLACEMENT_TAX)가 선형인 것과 달리 지수인 이유: 아군은 죽거나 수명이 다하면
 * 인원이 줄어 비용이 **되돌아온다**. 되돌아오는 세금이 선형이면 6명 유지가 너무 싸다.
 * 1.35면 몽둥이꾼(55) 기준 55/74/100/135/183/247 — 6명 한 세트가 794골드로
 * 스테이지1 시작 골드(300)의 2.6배, T2 업그레이드 두어 번 값이다.
 */
export const ALLY_COST_GROWTH = 1.35;
/**
 * 출격 한계선 — 기지에서 이 호장(타일) 이상은 나아가지 못한다.
 * 없으면 아군이 적 스폰 지점까지 걸어가 웨이브를 입구에서 요격해 버린다(타워가 무의미).
 * 6.0은 스테이지1 경로 길이(약 30타일)의 1/5로, "마을 앞 길목"이라는 그림이 유지되는 값이다.
 * 2단계(홈타운 레벨업)가 이 값을 마을 레벨로 늘릴 수 있게 상수로 분리해 둔다.
 */
export const ALLY_SORTIE_RANGE = 6.0;
/**
 * 출격 한계선에서 대기할 때 아군끼리 벌어지는 간격 (타일, 경로 호장 기준).
 *
 * 왜 필요한가: 이 게임은 유닛 충돌이 없어서(allies.ts 규칙 5) 한계선을 공유하면
 * 6명이 **정확히 같은 좌표에 겹쳐 선다**. 실측 캡처에서 6명이 한 점(4.86, 11)에
 * 포개져 한 명처럼 보였다 — 몇 명이 나가 있는지가 화면에서 사라진다.
 * 충돌을 넣는 대신(규칙이 어긋난다) 대기 지점만 슬롯으로 어긋내면
 * **길목에 줄을 선 모양**이 되고, 앞에서부터 차례로 교전에 들어간다.
 * 0.5면 6명이 2.5타일 = 셀 두 칸 반에 걸친 줄이 된다 (경로 폭 안에 들어온다).
 */
export const ALLY_HOLD_SPACING = 0.5;
/**
 * 적의 난투(반격) 피해 유도 계수 — EnemyDef.brawl이 없을 때 cost에서 유도한다.
 * cost는 이미 이 게임의 전투력 지표(웨이브젠 예산 단가)라 종별 서열이 그대로 옮겨 온다:
 * compy(5)→2 · raptor(10)→6 · blade(20)→11 · trike(45)→25 · trex는 그 이상.
 * 0.55는 "몽둥이꾼(hp 140)이 랩터 한 마리를 4초 정도 붙잡고 버틴다"를 만드는 값이다.
 */
export const BRAWL_DMG_PER_COST = 0.55;
/** 난투 타격 간격 (틱). 타워 공격 쿨다운과 **따로** 돈다 */
export const BRAWL_COOLDOWN_TICKS = 30;

/** 지금 한 명 더 내보내는 실비용 (aliveCount = 현재 나가 있는 인원) */
export function allyCostFor(baseCost: number, aliveCount: number): number {
  return Math.round(baseCost * ALLY_COST_GROWTH ** Math.max(0, aliveCount));
}

/** EnemyDef.brawl 생략 시의 난투 피해 (최소 2 — 아무도 무해하지 않다) */
export function enemyBrawlDmgFor(cost: number): number {
  return Math.max(2, Math.round(cost * BRAWL_DMG_PER_COST));
}

// ---------------------------------------------------------------------------
// 웨이브 보상 — 웨이브젠이 goldReward = WAVE_GOLD_BASE + wave × WAVE_GOLD_PER_WAVE 로 계산
// (보스 오버라이드 웨이브 포함, 스테이지 데이터의 goldReward 필드는 무시된다)
// ---------------------------------------------------------------------------
export const WAVE_GOLD_BASE = 30;
export const WAVE_GOLD_PER_WAVE = 6;

// ---------------------------------------------------------------------------
// 웨이브젠 형태 제약 — 성능 예산(인스턴싱/풀)과 난이도 곡선 안정화용
// ---------------------------------------------------------------------------
/** 한 SpawnGroup의 최대 마릿수 */
export const GROUP_MAX_COUNT = 25;
/** 한 웨이브의 최대 총 스폰 수 (초과 예산은 hpMul 보정으로 흡수) */
export const WAVE_MAX_SPAWNS = 60;
/** elite 템플릿: 마릿수를 줄이는 대신 개체 HP 배율 */
export const ELITE_HP_BONUS = 1.8;
/**
 * 총 HP 정규화 보정 한계 — 웨이브 총 HP를 예산 곡선(budget × 평균 hp/cost × hpMul)에
 * 맞추기 위한 그룹 hpMul 보정 배율의 클램프. 상한 40은 endless 후반 스폰 캡 흡수용.
 */
export const HP_CORR_MIN = 0.25;
export const HP_CORR_MAX = 40;

// ---------------------------------------------------------------------------
// 메타 진행 — 스테이지/조각 보상 규칙 (meta 트랙 참조용)
// ---------------------------------------------------------------------------
/** 보스 처치 시 타워 조각 드랍 수 (결과 화면 정산) */
export const SHARDS_PER_BOSS_KILL = 2;
/** 무한 모드 해금 조건: 스테이지 3 클리어 */
export const ENDLESS_UNLOCK_STAGE = 3;
