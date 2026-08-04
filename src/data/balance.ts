/**
 * 전역 밸런스 상수 — 데이터/메타/UI가 공유하는 규범 수치.
 *
 * ⚠ 아래 값들은 sim 쪽 하드코딩과 반드시 일치해야 한다 (통합 시 교차 검증):
 *  - SELL_REFUND_RATE       ↔ src/sim/economy.ts SELL_RATE      = 0.6
 *  - REFRESH_BASE_COST      ↔ src/sim/economy.ts REFRESH_BASE   = 20
 *  - REFRESH_COST_GROWTH    ↔ src/sim/economy.ts REFRESH_GROWTH = 1.6
 *  - HAND_SIZE              ↔ src/sim/economy.ts HAND_SIZE      = 3
 *  - PREP_TICKS_FIRST/LATER ↔ src/sim/battle.ts                 = 150 / 90
 *  - EARLY_CALL_RATE        ↔ src/sim/battle.ts                 = 0.15
 *  - ENDLESS_HP_GROWTH      ↔ src/sim/battle.ts                 = 1.06
 */

/** 판매 환급률 (invested × 0.6 내림) */
export const SELL_REFUND_RATE = 0.6;
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
