// ============================================================================
// 와가와가 디펜스 — 전역 타입 계약 (모든 트랙이 이 파일 기준으로 작업한다)
// 이 파일 수정은 통합 담당만 한다. 병렬 트랙에서 타입 변경이 필요하면 보고할 것.
// ============================================================================

// ---------------------------------------------------------------------------
// 시뮬레이션 상수
// ---------------------------------------------------------------------------
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
/** 상태이상 DoT는 15틱(0.5초)마다 적용 */
export const STATUS_TICK_INTERVAL = 15;

// ---------------------------------------------------------------------------
// 식별자
// ---------------------------------------------------------------------------
export type TowerId =
  | 'spear' // 창던지기 움막
  | 'catapult' // 돌 투석기
  | 'lightning' // 번개 주술 토템
  | 'brazier' // 화염 모닥불
  | 'frost' // 얼음 크리스탈
  | 'poison' // 독가시 식물
  | 'ballista' // 상아 발리스타
  | 'drum'; // 전쟁북 (버프)

export type EnemyId =
  | 'raptor' // 랩터 (고속)
  | 'compy' // 콤피 떼 (스웜)
  | 'trike' // 트리케라톱스 (탱커)
  | 'ptera' // 프테라노돈 (공중)
  | 'ankylo' // 안킬로사우루스 (장갑)
  | 'boar' // 원시 멧돼지 (격노)
  | 'warrior' // 적 부족 전사 (방패)
  | 'shaman' // 적 부족 주술사 (힐러)
  // --- 부족 습격대 (작고 귀여운 사람 무리 — 타워를 부수러 온다) -------------
  | 'blade' // 투창병 (최단 사거리 2.4 · 발 빠름 · 연투)
  | 'lancer' // 큰창잡이 (2.8 · 장갑 3 · 최장 정지 90틱 · 최대 단발)
  | 'archer' // 궁수 (3.2 · 유리몸)
  | 'hexer' // 저주사 (3.6 · 침묵 · 최단 정지)
  | 'mammoth' // 매머드 (대형 탱커)
  | 'spino' // 스피노사우루스 (미니보스)
  | 'trex' // 티라노사우루스 (보스)
  | 'golem'; // 화산 골렘 (화산 전용)

/**
 * 아군 부족 유닛 — 마을에서 골드로 뽑아 경로로 내보내는 **소모품** 전력.
 * 행동 규칙 전문은 src/sim/allies.ts 헤더 주석 참조.
 */
export type AllyId =
  | 'clubber' // 몽둥이꾼 (근접, 적의 발을 묶는다)
  | 'slinger' // 돌팔매꾼 (원거리, 걸으며 쏜다, 공중도 친다)
  | 'guardian'; // 방패 파수꾼 (근접 탱커, 오래 묶는다)

/**
 * 홈타운(기지)이 낸 피해의 출처 태그. 타워도 아군 유닛도 아니므로 고유 값을 쓴다 —
 * TowerId/StatusKind/AllyId 어느 집합과도 이름이 겹치지 않는다.
 */
export type HometownSourceId = 'hometown';

export type BiomeId = 'grassland' | 'jungle' | 'desert' | 'snow' | 'swamp' | 'volcano';
export type StatusKind = 'slow' | 'burn' | 'poison' | 'stun';
export type TargetingMode = 'first' | 'last' | 'strongest' | 'nearest';
export type AttackKind = 'homing' | 'ballistic' | 'beam' | 'pulse' | 'aura';

// ---------------------------------------------------------------------------
// 기하
// ---------------------------------------------------------------------------
/** 그리드 셀 좌표(정수) 또는 월드 평면 좌표(타일 단위 실수). y(높이)는 렌더 전용. */
export interface Vec2 {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------
// 타워 정의
// ---------------------------------------------------------------------------
export interface SplashSpec {
  radius: number;
  /** 가장자리 데미지 비율 0~1 (중심 1.0에서 선형 감쇠) */
  falloff: number;
}

export interface ChainSpec {
  jumps: number;
  /** 점프당 데미지 배율 (예: 0.7 = 점프마다 30% 감소) */
  decay: number;
  jumpRange: number;
}

export interface StatusApplySpec {
  kind: StatusKind;
  /** slow: 감속 비율 0~1, burn/poison: 틱당 데미지, stun: 무시됨 */
  magnitude: number;
  durationTicks: number;
  /** 적용 확률 0~1 */
  chance: number;
}

export interface AuraSpec {
  radius: number;
  /** brazier: 0.5초마다 데미지 */
  dmgPerStatusTick?: number;
  /** drum: 주변 타워 데미지 증가 비율 */
  dmgPct?: number;
  /** drum: 주변 타워 공속 증가 비율 */
  ratePct?: number;
  status?: StatusApplySpec;
}

export interface TowerTier {
  dmg: number;
  cooldownTicks: number;
  /** 사거리 (타일 단위) */
  range: number;
  /** 배치/업그레이드 비용 (티어0 = 카드 배치 비용) */
  cost: number;
  /** homing/ballistic 전용: 타일/초 */
  projectileSpeed?: number;
  splash?: SplashSpec;
  chain?: ChainSpec;
  status?: StatusApplySpec;
  aura?: AuraSpec;
}

export type TowerUnlock =
  | { type: 'start' }
  | { type: 'stage'; stage: number }
  | { type: 'amber'; cost: number };

export interface TowerDef {
  id: TowerId;
  nameKey: string;
  descKey: string;
  attackKind: AttackKind;
  canTargetGround: boolean;
  canTargetAir: boolean;
  /** 정확히 5개 티어 (전투 내 Lv1~5) */
  tiers: TowerTier[];
  /**
   * 구조물 내구도 배율 (생략 = 1). 최대 HP = towerMaxHpFor(tier, stars) × toughness.
   * 돌·통나무로 짠 구조는 단단하게, 크리스탈·식물은 무르게 — 적 부족의 공격 대상 선호를
   * 데이터로 조절하는 유일한 손잡이다 (@/data/balance.ts towerMaxHpFor).
   */
  toughness?: number;
  /** 메타 별 1개당 보너스 (별 0~5) */
  starBonus: { dmgPct: number; ratePct: number; rangePct?: number };
  unlock: TowerUnlock;
  /** 별 업그레이드 비용: 별 n(1~5)이 되기 위한 [조각, 호박] */
  starCosts: [shards: number, amber: number][];
}

// ---------------------------------------------------------------------------
// 적 정의
// ---------------------------------------------------------------------------
/**
 * 적의 타워 공격 능력 (적 부족 유닛 전용). 이 필드가 없는 적은 타워를 완전히 무시하고
 * 기지로 직행한다 — 기존 공룡/짐승 12종의 동작은 그대로다.
 * 행동 규칙 전문은 src/sim/siege.ts 헤더 주석 참조.
 */
export interface TowerAttackSpec {
  /** 1회 타격 피해 (타워 HP 기준, 감쇠·방어 없음) */
  dmg: number;
  /** 타격 사거리 (타일) — 적 중심 ↔ 타워 셀 중심 거리로 판정 */
  range: number;
  /** 타격 간격 틱 (30 = 1초) */
  cooldownTicks: number;
  /**
   * 공격 가능 지점에서 **멈춰 서는가**.
   * 규약: 타워를 때리는 종은 전부 true — 사거리 안이라도 걸으며 쏘다가,
   * SIEGE_ENGAGE_RANGE 안으로 들어오면 발을 멈추고 조준 사격한다(siege.ts 규칙 4).
   * false면 절대 멈추지 않는 순수 '걸으며 쏘기'다 — 현재 데이터에는 없고,
   * 규칙 4를 끄고 무엇이 달라지는지 재는 대조군(테스트)으로만 남아 있다.
   */
  stopToAttack: boolean;
  /**
   * 한 번 멈춰 서면 **몇 틱까지 버티는가** (stopToAttack이 false면 무시).
   * 종을 가르는 네 축 중 '버티는 시간'이다 — 길수록 한 자리에서 더 많이 쏘지만
   * 그만큼 기지 도달이 늦고 타워 사거리 안에 오래 노출된다(규칙 4-a).
   * 상한이 끝나면 사유와 무관하게 SIEGE_ADVANCE_TICKS 동안 전진 의무를 진다(규칙 4-b).
   */
  holdTicks: number;
  /**
   * 원거리 공격인가 (연출 분기용 — 투척물/주문 궤적 유무).
   * 시뮬레이션 판정에는 쓰이지 않고 raidAttack/towerDamaged 이벤트에 그대로 실려 나간다.
   */
  ranged: boolean;
  /**
   * 타격이 대상 타워를 이만큼 **침묵**시킨다 (틱). 생략/0 = 침묵 없음.
   * 침묵한 타워는 발사·오라 피해·버프 방출을 전부 멈춘다(조준은 유지).
   * 중첩되지 않고 남은 시간을 max로 갱신한다 — 무리로 몰려와도 영구 봉쇄가 되지 않게.
   * 부족 주술사(hexer) 전용 능력이며, "부수기 전에 입을 막는다"가 습격대의 조합이다.
   */
  silenceTicks?: number;
}

export interface EnemyDef {
  id: EnemyId;
  nameKey: string;
  /** 스테이지1 웨이브1 기준 체력 (웨이브젠이 배율 적용) */
  hp: number;
  /** 타일/초 */
  speed: number;
  /** 타격당 고정 피해 감소 */
  armor: number;
  /** 방패: 피해 무시 횟수 */
  shieldHits?: number;
  /**
   * **가죽** 🟫 — 한 번의 damageEnemy가 넣을 수 있는 최대치 = `round(maxHp × hide)` (0~1).
   *
   * `armor`의 정확한 거울이다: armor가 "유효한 최소 **타격 크기**"를 못 박는다면 hide는
   * "죽이는 데 필요한 최소 **타격 횟수**"(= 1/hide)를 못 박는다. 두 규칙이 같은 함수의
   * 연속된 두 줄이라 플레이어가 배울 것은 하나뿐이다.
   *
   * **절대값이 아니라 비율인 이유** — 절대값이면 cap이 고정인데 타워 dmg는 티어당 ×1.6로
   * 자라서, 업그레이드할수록 잘리는 비율이 커진다(= 반업그레이드 세금). 비율로 두면 cap이
   * maxHp와 함께 자라 최소 타격 횟수가 **티어·웨이브 불변의 약속**이 된다.
   *
   * 광역을 자르지 않는다: `applyArea`가 적마다 damageEnemy를 따로 부르므로 cap은
   * **대상별**로 걸린다. 곧 가죽은 "한 방"만 자르고 "여러 마리"는 splashResist가 맡는다.
   */
  hide?: number;
  /**
   * **흩어짐** 〽 — `applyArea`(폭발 부가 피해)만 `×(1 − 값)` (0~1).
   * 오라(pulseTick)·체인(fireBeam)·직격·아군·기지 화살은 전부 면제다. 곧 이 축이 벌하는
   * 것은 "광역"이 아니라 **폭발**이고, 그래서 티어로 빠져나갈 수 없다.
   */
  splashResist?: number;
  flying: boolean;
  boss?: boolean;
  /** 처치 골드 */
  bounty: number;
  /** 기지 도달 시 기지 피해 */
  baseDamage: number;
  /** 충돌/스플래시 반경 (타일) */
  radius: number;
  /** 저체력 격노: hp 비율 이하에서 속도 배율 */
  enrage?: { hpPct: number; speedMul: number };
  /** 주변 힐: 반경 내 아군에게 0.5초마다 회복 */
  healAura?: { radius: number; hpPerStatusTick: number };
  /** 타워 공격 능력 (없으면 타워를 무시하고 기지로 직행) */
  towerAttack?: TowerAttackSpec;
  /**
   * 아군 유닛에게 발이 묶였을 때의 **맞붙기(난투)** 능력.
   * 생략하면 balance.enemyBrawlFor(cost)가 유도한다 — 16종 전부에 수치를 적지 않아도
   * 모든 적이 반격할 수 있게 하되, 특정 종만 예외적으로 세게/약하게 하고 싶을 때
   * 데이터로 덮어쓸 수 있는 손잡이를 남긴다. 타워 공격(towerAttack)과는 완전히 별개다
   * (쿨다운도 따로 돈다) — "타워를 부수던 손을 멈추고 눈앞의 사람을 친다"가 규칙이다.
   */
  brawl?: { dmg: number; cooldownTicks: number };
  /** 웨이브젠 예산 비용 (전투력 지표) */
  cost: number;
}

// ---------------------------------------------------------------------------
// 아군 유닛 정의 (마을에서 출동시키는 부족원)
// ---------------------------------------------------------------------------
export interface AllyDef {
  id: AllyId;
  nameKey: string;
  descKey: string;
  hp: number;
  /** 타일/초 — 경로를 **역주행**하는 속도 */
  speed: number;
  /** 타격당 고정 피해 감소 */
  armor: number;
  /** 충돌/연출 반경 (타일) */
  radius: number;
  /** 기본 출동 비용 — 실비용은 balance.allyCostFor(base, 생존 수)가 올린다 */
  cost: number;
  /** 수명 틱 (다 되면 마을로 돌아간다 = allyRetired). 영구 유닛은 존재하지 않는다 */
  lifeTicks: number;
  dmg: number;
  cooldownTicks: number;
  /** 타격 사거리 (타일) */
  range: number;
  /** 공중 적을 때릴 수 있는가 (근접형은 false) */
  canTargetAir: boolean;
  /**
   * 근접 교전형인가.
   * true  = 타깃이 사거리에 들면 멈춰 서서 때리고 **지상 타깃의 전진을 묶는다**.
   * false = 걸으면서 쏘고 아무도 묶지 못한다 (원거리).
   * 규약은 적 습격대의 TowerAttackSpec.stopToAttack와 정확히 대칭이다.
   */
  blocks: boolean;
}

// ---------------------------------------------------------------------------
// 홈타운(기지) 레벨 정의
// ---------------------------------------------------------------------------
/**
 * 홈타운 한 레벨의 성능. 배열 인덱스 0 = Lv1(움막 하나, 전투 시작 상태)이고,
 * 인덱스 n의 cost는 **Lv(n)에서 Lv(n+1)로 올리는 값**이다(따라서 [0].cost는 항상 0).
 * 수치와 근거 전문은 src/data/hometown.ts, 행동 규칙은 src/sim/hometown.ts 헤더.
 */
export interface BaseLevelDef {
  /** 이 레벨로 올리는 데 드는 골드 (Lv1 = 시작 레벨이라 0) */
  cost: number;
  /** 최대 HP 배율 — 실제 최대 HP = round(stage.baseHp × hpMul) */
  hpMul: number;
  /** 화살 1발 피해 (적 armor 감산은 damageEnemy가 적용) */
  dmg: number;
  /** 발사 간격 틱 (30 = 1초) */
  cooldownTicks: number;
  /** 사거리 (타일) — 기지 셀 중심 ↔ 적 중심 */
  range: number;
  /**
   * **아군 부족원 출격 한계선** (타일, 경로 호장 기준) — 기지에서 이만큼 앞까지만 나간다.
   * 마을이 파는 네 번째 물건이다: 체력·공격력·사거리는 마을 자신을 키우지만
   * 이 값은 **마을 밖으로 나가는 부족원**을 키운다 (src/sim/allies.ts 규칙 2).
   * 왜 이 표에 있는지는 src/data/hometown.ts, 소비처는 src/sim/allies.ts.
   */
  sortie: number;
}

// ---------------------------------------------------------------------------
// 웨이브 / 스테이지 정의
// ---------------------------------------------------------------------------
export interface SpawnGroup {
  enemyId: EnemyId;
  count: number;
  intervalTicks: number;
  delayTicks: number;
  /** StageDef.paths 인덱스 (공중 유닛은 airPaths 인덱스) */
  pathIndex: number;
  /** 웨이브 스케일 후 추가 배율 */
  hpMul: number;
  /**
   * 처치 보상 배율 (생략 = 1). **웨이브가 예산이 산 것보다 많은 골드를 주지 않게** 하는
   * 유일한 손잡이다 — 근거는 wavegen.ts capBounty 주석.
   * 마릿수가 예산을 넘겨 부풀 때(습격대 최소 인원 보장)만 1 미만이 된다.
   */
  bountyMul?: number;
}

export interface WaveDef {
  groups: SpawnGroup[];
  /** 웨이브 클리어 보너스 골드 */
  goldReward: number;
}

// ---------------------------------------------------------------------------
// 웨이브 미리보기 (읽기 전용 조회 — 상태를 건드리지 않고 hash()에도 안 들어간다)
// ---------------------------------------------------------------------------
/**
 * 적의 **방어 특성 태그** — 지금은 전부 기존 필드에서 유도한다(신설 필드 0개).
 * 유도 규칙은 src/data/balance.ts enemyTraitsOf 한 곳에만 있다.
 *
 * ⚠ 이 목록은 자리다. 상성 개편(docs/counter-plan.md)의 신설 축
 * — 가죽🟫 · 흩어짐〽 · 정화✧ — 은 여기에 태그를 더하는 것으로 들어오고,
 * 그때도 배지·막대·데미지 표기는 같은 규약을 그대로 쓴다.
 */
export type TraitTag =
  | 'air' // 하늘 — flying (대공만이 닿는다)
  | 'shield' // 방패 — shieldHits (앞의 N타를 통째로 무시)
  | 'armor' // 장갑 — armor (타격당 고정 감산 → 작은 타격을 벌한다)
  | 'hide' // 가죽 — hide (타격당 상한 → **큰 한 방**을 벌한다. armor의 거울)
  | 'splash' // 흩어짐 — splashResist (폭발 부가 피해만 깎는다)
  | 'heal' // 치유 — healAura (주변을 되살린다)
  | 'raid' // 습격 — towerAttack (기지가 아니라 내 타워를 부순다)
  | 'enrage'; // 격노 — enrage (저체력에서 빨라진다)

/** 한 웨이브에 나오는 **한 종**의 요약 (그 종의 모든 SpawnGroup을 합산한 것) */
export interface WavePreviewEntry {
  defId: EnemyId;
  /** 이 웨이브에 나오는 총 마릿수 */
  count: number;
  /**
   * 개체 최대 HP = max(1, round(def.hp × hpMul)) — 웨이브 스케일이 반영된 실제 값이고
   * 스폰 시점의 EnemyState.maxHp와 **정확히 같은 식**이다(sim/waves.ts spawn).
   * 같은 종이 hpMul이 다른 그룹으로 나뉘면 **가장 단단한 개체**의 값이다
   * (배지는 "한 마리를 죽이려면 얼마가 드는가"를 말하므로 최악을 보여야 한다).
   */
  maxHp: number;
  /** 이 종이 이 웨이브에 들고 오는 체력 총합 (그룹별 정확 합산) */
  totalHp: number;
  /** 타격당 고정 감산 (EnemyDef.armor 그대로) */
  armor: number;
  /**
   * **가죽 상한의 절대값** = `round(maxHp × def.hide)` — 이번 웨이브에 실제로 걸리는 타격당
   * 상한이다. 필드는 비율인데 여기만 절대값인 이유: 배지(`🟫가죽37`)와 데미지 숫자(`(37)`)가
   * **같은 자를 써야** 화면에서 직접 비교된다. 가죽이 없는 종은 undefined.
   */
  hideCap?: number;
  /** 폭발 부가 피해 감산 비율 (EnemyDef.splashResist 그대로). 없으면 undefined */
  splashResist?: number;
  flying: boolean;
  boss: boolean;
  /** 특성 태그 (우선순위 정렬 — [0]이 칩에 그릴 배지 하나다) */
  traits: TraitTag[];
}

/**
 * 웨이브 미리보기 — **순수 조회**다. 시뮬레이션 상태를 한 톨도 건드리지 않고,
 * 이벤트를 내지 않으며, hash()에 들어가지 않는다. 임의 웨이브를 조회할 수 있어
 * 밸런스 계량기로도 쓴다(docs/counter-plan.md "계량기" 문단).
 */
export interface WavePreview {
  /** 1-base 웨이브 번호 */
  wave: number;
  /** 종별 합산. **총 HP 내림차순**(동점은 종 id 사전순) — 칩 순서가 곧 위협 순서다 */
  entries: WavePreviewEntry[];
  totalHp: number;
  totalCount: number;
  goldReward: number;
  /** 공중 적이 하나라도 있는가 (대공이 없는 덱에 대한 즉답) */
  hasAir: boolean;
  /** 보스가 있는가 */
  boss: boolean;
}

export interface WavePlanParams {
  /** 웨이브1 예산 */
  budgetBase: number;
  /** 웨이브당 예산 성장률 (예: 1.14) */
  budgetGrowth: number;
  /** 적 체력 글로벌 배율 커브: hpMul = hpBase * hpGrowth^(wave-1) */
  hpBase: number;
  hpGrowth: number;
  seed: number;
  allowedEnemies: EnemyId[];
  /**
   * **공중 해금 웨이브** — 이 웨이브 전에는 `allowedEnemies`의 비행 종이 편성에서
   * 통째로 빠진다(추첨 풀에서도 빠지므로 mixed·swarm에도 섞이지 않는다).
   * 생략하면 게이트가 없다 = 지금까지의 동작 그대로.
   *
   * 왜 `allowedEnemies`에서 빼는 것으로는 안 되는가: 그러면 그 스테이지에 공중이
   * **영원히** 없다. 이 손잡이는 "언제부터 하늘이 열리는가"를 온보딩과 분리해서
   * 정하기 위한 것이다 — 스테이지1은 w1~20이 온보딩 약속이라 그 뒤여야 한다.
   */
  airFromWave?: number;
  /**
   * 한 웨이브의 **비행 마릿수 상한**. 생략하면 상한 없음(지금까지의 동작 그대로).
   * 상한이 거절한 예산은 버리지 않고 **지상 호위가 받는다** — 안 그러면 공중을
   * 넣을수록 그 웨이브의 실질 예산이 줄어 난이도가 **내려간다**(wavegen.genAirRaid 주석).
   */
  airMaxCount?: number;
  /** 웨이브 번호(1-base) → 수동 보스 웨이브 오버라이드 */
  bossOverrides: Record<number, WaveDef>;
}

/**
 * layout 범례(행 문자열, 길이 = gridW):
 *   '.' 지상  '~' 물/공허  'o' 건설 슬롯  '#' 장식(바위 등, 건설 불가)
 * 경로 셀은 paths 웨이포인트에서 래스터라이즈되어 지형에 표시된다.
 */
export interface StageDef {
  id: number;
  nameKey: string;
  biome: BiomeId;
  gridW: number;
  gridH: number;
  layout: string[];
  /** 지상 경로들: 셀 좌표 웨이포인트 순열 (스폰 → 기지) */
  paths: Vec2[][];
  /** 공중 레인 (없으면 paths[0] 직선화 사용) */
  airPaths?: Vec2[][];
  /**
   * **이 스테이지에서만** 해당 종의 누수 피해(기지에 닿았을 때 깎는 HP)를 덮어쓴다.
   * 생략하거나 종이 빠져 있으면 `EnemyDef.baseDamage` 그대로다.
   *
   * 왜 종 데이터가 아니라 스테이지에 두는가: `compy`·`raptor`는 전 스테이지의 스웜 풀이라
   * (wavegen.SWARMERS) 종 값을 올리면 여섯 판이 통째로 움직인다. 실측 — compy를 1 → 2로
   * 올렸을 때 스테이지1의 방치 패배는 8 → 6웨이브로 의도대로 당겨졌지만, 같은 변경이
   * **s4의 평균 도달 웨이브를 8.60 → 4.39로 반토막** 내고 s4/s5 사다리를 뒤집었다
   * (80시드에서도 뒤집혀 표본 문제가 아니었다). 튜토리얼 한 판의 도입부를 고치려고
   * 다섯 판의 난이도를 옮기는 것은 대가가 맞지 않는다.
   *
   * 왜 균일 배율(`leakDamageMul`)이 아닌가: 균일하게 곱하면 trex(12)까지 24가 되어
   * 웨이브 50에서 한 마리가 기지(25)를 거의 끝낸다. 실제로 필요한 것은 **도입부를 채우는
   * 스웜 종**뿐이라 종을 지정해서 덮어쓴다.
   */
  leakDamage?: Partial<Record<EnemyId, number>>;
  baseCell: Vec2;
  baseHp: number;
  startGold: number;
  waveCount: number;
  wavePlan: WavePlanParams;
  firstClearAmber: number;
  perWaveAmber: number;
  /** 이 스테이지 클리어 시 해금되는 타워 */
  unlockTowers?: TowerId[];
}

// ---------------------------------------------------------------------------
// 전투 시뮬레이션 — 엔티티 상태 (순수 데이터, three/DOM 참조 금지)
// ---------------------------------------------------------------------------
export interface StatusInstance {
  kind: StatusKind;
  magnitude: number;
  remainingTicks: number;
  /** DoT 누적기 */
  acc: number;
  /** 부여한 타워 id — 같은 소스는 자기 스택 갱신, 다른 소스는 별도 스택 (독 다중 타워 유효화) */
  sourceId?: number;
}

export interface EnemyState {
  id: number;
  defId: EnemyId;
  hp: number;
  maxHp: number;
  shieldHitsLeft: number;
  /** 경로 진행 거리 (타일 단위 호장) */
  dist: number;
  pathIndex: number;
  flying: boolean;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  /** 진행 방향 라디안 (렌더용) */
  heading: number;
  statuses: StatusInstance[];
  bounty: number;
  baseDamage: number;
  radius: number;
  alive: boolean;
  hpMul: number;
  /** 보스 여부 (연출 강조용, def.boss 복사) */
  boss?: boolean;
  /**
   * 타워 타격 쿨다운 잔여 틱. towerAttack이 없는 적은 항상 0.
   * 스턴 중에는 감소하지 않는다(스턴 = 완전 무력화).
   */
  attackCdLeft: number;
  /**
   * 지금 조준하고 있는 타워 id (-1 = 없음). 렌더가 공격 방향에 쓴다.
   * **정지 여부는 이 값이 아니라 siegeHoldLeft가 정한다** — 사거리 안이라도
   * 아직 정지 거리(SIEGE_ENGAGE_RANGE)에 못 들어왔으면 걸으며 쏘기 때문이다.
   */
  towerTargetId: number;
  /**
   * 타워를 쏘려고 **멈춰 서 있는** 잔여 틱 (0 = 걷는 중). siege.ts 규칙 4.
   * 0보다 크면 이동이 멈추고, 렌더는 보행 위상을 정지시킨 채 조준 포즈를 잡는다.
   * 0이 되는 순간 규칙 4-b의 전진 의무가 걸린다.
   */
  siegeHoldLeft: number;
  /**
   * 공격 동작 잔여 틱 (0 = 동작 없음). 타격 순간
   * min(RAID_ATTACK_ANIM_TICKS, cooldownTicks)로 채워지고 매 틱 1씩 준다.
   * 렌더의 동작 진행도 = 1 − attackAnimLeft / attackAnimTicks (0 → 1).
   * **raidAttack 이벤트와 짝**이다: 이벤트는 발사 순간 하나만 알리고(놓치면 끝),
   * 이 값은 매 프레임 "지금 어디까지 던졌는가"를 알려 준다.
   */
  attackAnimLeft: number;
  /** 지금 재생 중인 공격 동작의 전체 길이 (틱). attackAnimLeft의 분모. */
  attackAnimTicks: number;
  /**
   * 지금 나를 막고 있는 아군 유닛 id (-1 = 없음). 매 틱 아군 단계가 다시 계산한다.
   * 0 이상이면 **전진이 멈추고**(유닛 충돌 대신 쓰는 봉쇄 표현) 타워 공격도 중단하며,
   * 그 아군을 난투(brawl)로 반격한다. 공중 적에게는 절대 붙지 않는다 — 날아서 지나간다.
   */
  blockerAllyId: number;
}

/**
 * 아군 유닛 상태. 경로 파라미터화는 적과 **완전히 동일**하고(dist 0 = 스폰, totalLength = 기지)
 * 아군만 dist가 감소한다 — 즉 같은 폴리라인을 거꾸로 걷는다.
 */
export interface AllyState {
  id: number;
  defId: AllyId;
  hp: number;
  maxHp: number;
  /** 경로 진행 거리 (기지 = totalLength에서 출발해 감소) */
  dist: number;
  /** 어느 지상 경로로 나갔는가 (StageDef.paths 인덱스) */
  pathIndex: number;
  /**
   * 같은 경로 위 대기 줄에서의 자리 (0 = 맨 앞).
   * 유닛 충돌이 없어 한계선을 공유하면 전원이 한 점에 겹치므로, 슬롯만큼 뒤로 물려 세운다.
   * 비어 있는 가장 작은 번호를 받는다 — 앞줄이 죽으면 다음 출동이 그 자리를 메운다.
   */
  slot: number;
  /** 이 유닛이 더 나아갈 수 없는 하한 dist (출격 한계선 + 슬롯 간격 — allies.ts 규칙 2) */
  holdDist: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  /** 진행 방향 라디안 (경로 진행 방향의 반대) */
  heading: number;
  /** 남은 수명 틱. 0이 되면 마을로 귀환(allyRetired) */
  lifeLeft: number;
  /** 타격 쿨다운 잔여 틱 */
  attackCdLeft: number;
  /** 교전 중인 적 id (-1 = 없음). 렌더가 공격 모션에 쓴다 */
  targetId: number;
  alive: boolean;
}

export interface TowerState {
  id: number;
  defId: TowerId;
  /** 0-base 티어 (0~4) */
  tier: number;
  /**
   * 구조물 체력 — 적 부족의 공격으로 깎이고 0이 되면 타워가 파괴되어 칸이 빈다(환불 없음).
   * 준비 단계(prep)에는 자동 수리된다. 업그레이드는 늘어난 최대치만큼만 즉시 회복한다.
   */
  hp: number;
  maxHp: number;
  /**
   * 침묵 잔여 틱 (0 = 정상). 부족 주술사(hexer)의 저주로 붙고 매 틱 1씩 준다.
   * 0보다 크면 발사/오라/버프 방출이 멈춘다 — 파괴와 달리 되돌아온다.
   */
  silenceLeft: number;
  cellX: number;
  cellZ: number;
  cooldownLeft: number;
  targetId: number;
  targeting: TargetingMode;
  /** 판매 환급 계산용 누적 투자 골드 */
  invested: number;
  /** drum 버프 반영 캐시 (매 5틱 재계산) */
  buffDmgPct: number;
  buffRatePct: number;
}

export type ProjectileKind = 'homing' | 'ballistic';

export interface ProjectileState {
  id: number;
  kind: ProjectileKind;
  towerDefId: TowerId;
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  /** homing: 추적 대상 (죽으면 마지막 위치로) */
  targetId: number;
  targetX: number;
  targetZ: number;
  /** ballistic: 총 비행 틱과 경과 틱 */
  flightTicks: number;
  elapsedTicks: number;
  startX: number;
  startZ: number;
  /** 발사 높이/포물선 정점 높이 */
  arcHeight: number;
  speed: number;
  dmg: number;
  splash?: SplashSpec;
  status?: StatusApplySpec;
  targetFlying: boolean;
  /**
   * 홈타운(기지)이 쏜 화살인가. 렌더는 towerDefId의 지오메트리를 **그대로 빌려 쓰고**
   * (전용 InstancedMesh를 만드는 순간 드로우콜 예산이 깨진다 — AGENTS.md 성능 예산)
   * 갈라지는 것은 피해 출처뿐이다: true면 enemyDamaged.source가 'hometown'이 된다.
   */
  fromBase?: boolean;
  alive: boolean;
}

export type BattlePhase = 'prep' | 'wave' | 'won' | 'lost';

export interface CardState {
  towerId: TowerId;
  cost: number;
}

export interface BattleStateView {
  tick: number;
  phase: BattlePhase;
  waveIndex: number; // 1-base, prep 중이면 다음 웨이브 번호
  waveCount: number;
  gold: number;
  baseHp: number;
  baseHpMax: number;
  /**
   * 홈타운 레벨 (1-base). 1 = 움막 하나로 시작하는 상태.
   * 레벨이 오르면 baseHpMax·공격력·사거리가 함께 오른다 (src/sim/hometown.ts).
   */
  baseLevel: number;
  /** 홈타운 최대 레벨 — 도달하면 upgradeBase가 거부된다 */
  baseLevelMax: number;
  /** prep 카운트다운 남은 틱 */
  prepTicksLeft: number;
  /** 지금 callWave 시 받을 조기 호출 보너스 골드 (prep 아닐 땐 0) */
  earlyCallBonusGold: number;
  hand: CardState[];
  /**
   * 이 판의 **카드 덱** (BattleOptions.deck 그대로, 읽기 전용).
   * 손패는 여기서 뽑히므로 손패만 보면 "내가 쓸 수 있는 타워"의 부분집합만 보이고,
   * 그것도 새로고침마다 바뀐다. 웨이브 미리보기의 수요 막대는 **내 덱에 있는 타워만**
   * 그려야 하므로(없는 답을 알려주는 것은 정보가 아니라 좌절이다) 전체 목록이 필요하다.
   * 시뮬레이션은 이 배열을 절대 수정하지 않는다 — hash()에도 들어가지 않는다.
   */
  deck: readonly TowerId[];
  refreshCost: number; // 0이면 무료
  enemies: readonly EnemyState[];
  towers: readonly TowerState[];
  projectiles: readonly ProjectileState[];
  /** 지금 나가 있는 아군 부족원 (동시 상한 = allyCap) */
  allies: readonly AllyState[];
  /** 동시 출동 상한 — 이 수에 도달하면 trainAlly가 거부된다 */
  allyCap: number;
  /** 이번 전투에서 얻은 호박 (결과 화면 표시용) */
  amberEarned: number;
  /** 무한 모드 여부 */
  endless: boolean;
}

// ---------------------------------------------------------------------------
// 커맨드 (입력 → 시뮬레이션, 틱 경계에 적용)
// ---------------------------------------------------------------------------
export type BattleCommand =
  | { type: 'placeTower'; handIndex: number; cellX: number; cellZ: number }
  | { type: 'upgradeTower'; towerId: number }
  | { type: 'sellTower'; towerId: number }
  | { type: 'refreshHand' }
  | { type: 'setTargeting'; towerId: number; mode: TargetingMode }
  | { type: 'clearScenery'; cellX: number; cellZ: number } // 골드로 나무/바위 치우기
  | {
      /**
       * 마을에서 부족원 한 명을 출동시킨다 (골드 소모, 동시 상한 있음).
       * pathIndex 생략 시 sim이 **결정론적으로** 고른다 — 기지에 가장 가까운 적이
       * 있는 지상 경로, 동점/적 없음이면 0번 (src/sim/allies.ts 규칙 1).
       * UI가 경로를 고르게 하지 않는 이유: 탭 하나로 즉시 나가야 하는 긴급 자원이라
       * 선택지를 늘리면 반응 속도만 깎인다.
       */
      type: 'trainAlly';
      defId: AllyId;
      pathIndex?: number;
    }
  | {
      /**
       * 홈타운을 한 레벨 올린다 (골드 소모, 환불 없음, 최대 레벨에서 거부).
       * 레벨을 지정하지 않는 이유: 건너뛰기가 없으므로 "다음 한 칸"이 유일한 선택지다.
       * 비가역 결제이므로 UI는 2단 확인(is-armed)을 거쳐야 한다 — battlehud.ts 참조.
       */
      type: 'upgradeBase';
    }
  | { type: 'callWave' }; // prep 스킵 (조기 호출 보너스)

// ---------------------------------------------------------------------------
// SimEvent (시뮬레이션 → 연출/사운드/UI)
// ---------------------------------------------------------------------------
export type SimEvent =
  | { type: 'waveStarted'; wave: number }
  | { type: 'waveCleared'; wave: number; goldReward: number; amber: number }
  | { type: 'enemySpawned'; enemyId: number; defId: EnemyId }
  | {
      type: 'enemyDamaged';
      enemyId: number;
      amount: number;
      x: number;
      z: number;
      /**
       * 피해 출처 — 타워 / 상태이상 / **아군 부족원**(AllyId) / **홈타운**('hometown').
       * 네 집합은 이름이 겹치지 않는다.
       */
      source: TowerId | StatusKind | AllyId | HometownSourceId;
      shielded: boolean;
      /**
       * **무엇이 이 숫자를 깎았는가** — 데미지 숫자가 `(37)`처럼 괄호를 그릴 근거.
       * 감산이 실제로 일어났을 때만 실린다(없으면 undefined = 온전히 들어갔다).
       * 둘 이상 겹치면 **가장 크게 깎은 것** 하나만 싣는다 — 칩과 같은 규칙(배지 하나)이고,
       * 15~20px 화면에서 두 부호를 겹쳐 그릴 자리가 없다.
       */
      mitigated?: 'armor' | 'hide' | 'splash';
    }
  | {
      type: 'enemyDied';
      enemyId: number;
      defId: EnemyId;
      x: number;
      z: number;
      bounty: number;
      /** 최대 체력 (웨이브 스케일 포함) — 대형/후반 적일수록 사망 폭발을 크게 */
      maxHp: number;
    }
  | { type: 'enemyLeaked'; enemyId: number; defId: EnemyId; baseDamage: number }
  | { type: 'bossSpawned'; enemyId: number; defId: EnemyId }
  | { type: 'towerPlaced'; towerId: number; defId: TowerId; cellX: number; cellZ: number }
  | { type: 'towerUpgraded'; towerId: number; defId: TowerId; tier: number }
  | { type: 'towerSold'; towerId: number; refund: number }
  | {
      /** 적 부족이 타워를 때렸다 — 체력바/피격 연출 */
      type: 'towerDamaged';
      towerId: number;
      defId: TowerId;
      /** 타워 셀 (연출 위치) */
      cellX: number;
      cellZ: number;
      /** 실제로 깎인 체력 */
      amount: number;
      /** 타격 후 남은 체력 (0 하한) */
      hpLeft: number;
      maxHp: number;
      /** 때린 적 — 공격 모션 트리거용 */
      attackerId: number;
      attackerDefId: EnemyId;
      /** 때린 적의 위치 (타격선/투척물 궤적 연출용) */
      attackerX: number;
      attackerZ: number;
      /** 원거리 공격 여부 (TowerAttackSpec.ranged 그대로) */
      ranged: boolean;
    }
  | {
      /**
       * 습격대가 무기를 **놓은 순간** (창을 던지고/화살을 놓고/주문을 쏜 시점).
       * towerDamaged와 같은 틱에, 바로 **앞서** 나간다.
       *
       * 왜 towerDamaged로 부족한가: towerDamaged는 '타워가 맞았다'는 **피격자 쪽**
       * 사건이라 fx가 TOWER_HIT_FX_MAX(배치당 4건)로 솎아 낸다 — 무리가 두들기면
       * 절반 이상이 버려져 공격 동작이 시작도 못 한 채 팔만 흔드는 그림이 된다.
       * raidAttack은 **공격자 쪽** 사건이라 상한을 공유하지 않고, 착탄이 아니라
       * 발사 시점을 실어 궤적/포물선의 출발점이 정확해진다.
       *
       * 윈드업(던지기 전 준비)은 사건으로 미리 알릴 수 없고(발사보다 앞선다),
       * 착탄은 렌더가 dist로 계산할 수 있다 — 그래서 **놓는 순간 하나만** 보낸다.
       * 이벤트를 놓쳐도 EnemyState.attackAnimLeft로 매 프레임 복구할 수 있다.
       */
      type: 'raidAttack';
      attackerId: number;
      attackerDefId: EnemyId;
      /** 발사 시점의 공격자 위치 (셀 연속 좌표) */
      x: number;
      z: number;
      towerId: number;
      towerDefId: TowerId;
      /** 대상 타워 셀 */
      cellX: number;
      cellZ: number;
      /** 조준 방향 atan2(dz, dx) — EnemyState.heading과 같은 규약 */
      aim: number;
      /** 공격자 ↔ 타워 거리 (타일). 투척물 비행 시간 산정용 */
      dist: number;
      /** TowerAttackSpec.ranged 그대로 */
      ranged: boolean;
      /** 멈춰 서서 쏜 것인가 (false = 걸으며 쏘기) */
      planted: boolean;
      /** 이 타격이 넣을 피해 (towerDamaged.amount와 같은 값) */
      amount: number;
      /** 이 동작의 길이 (틱) = min(RAID_ATTACK_ANIM_TICKS, cooldownTicks) */
      animTicks: number;
    }
  | {
      /** 부족 주술사의 저주 — 타워가 잠시 침묵한다 (재적용 시마다 발행) */
      type: 'towerSilenced';
      towerId: number;
      defId: TowerId;
      cellX: number;
      cellZ: number;
      /** 이번 적용 후 남은 침묵 틱 */
      ticksLeft: number;
      /** 저주를 건 적 */
      casterId: number;
      casterDefId: EnemyId;
    }
  | {
      /** 타워가 부서져 칸이 비었다 — 환불 없음(towerSold와 구분) */
      type: 'towerDestroyed';
      towerId: number;
      defId: TowerId;
      cellX: number;
      cellZ: number;
      /** 파괴 시점 티어 (0~4) — 잔해 연출 크기 */
      tier: number;
      /** 마지막 일격을 넣은 적 (없으면 -1) */
      killerId: number;
    }
  | {
      /** 소품(나무/바위) 제거 성공 — 연출/사운드 + 렌더 소품 병합 갱신 */
      type: 'sceneryCleared';
      cellX: number;
      cellZ: number;
      /** 실제로 지불한 골드 */
      cost: number;
      /** 이 제거를 포함한 누적 제거 횟수 (1-base) */
      clearedCount: number;
    }
  | { type: 'towerFired'; towerId: number; defId: TowerId; targetId: number }
  | {
      type: 'projectileHit';
      towerDefId: TowerId;
      x: number;
      z: number;
      splash: boolean;
      /** 이번 착탄으로 가한 총 피해 근사 (직격 + 스플래시 합) */
      dmg: number;
      /** 발사 타워 티어 (0~4) */
      tier: number;
      /** 스플래시면 실제 반경 (타일) */
      splashRadius?: number;
    }
  | {
      type: 'beamFired';
      towerId: number;
      defId: TowerId;
      /** 체인 경유점 (타워 → 적1 → 적2 ...) */
      points: { x: number; z: number; flying: boolean }[];
      /** 체인 전체 피해 합 근사 */
      dmg: number;
      /** 발사 타워 티어 (0~4) */
      tier: number;
    }
  // --- 아군 부족원 (src/sim/allies.ts) ---------------------------------------
  | {
      /** 마을에서 부족원이 출동했다 — 기지에서 스폰 */
      type: 'allyTrained';
      allyId: number;
      defId: AllyId;
      /** 실제로 지불한 골드 */
      cost: number;
      pathIndex: number;
      /** 스폰 위치 (= 기지 셀) */
      x: number;
      z: number;
    }
  | {
      /** 아군이 적을 때렸다 — 타격 연출/사운드. 적 피해 자체는 enemyDamaged가 따로 나간다 */
      type: 'allyAttacked';
      allyId: number;
      defId: AllyId;
      targetId: number;
      /** 때린 아군 위치 */
      x: number;
      z: number;
      /** 맞은 적 위치 (투척 궤적 연출용) */
      targetX: number;
      targetZ: number;
      /** 원거리 타격인가 (AllyDef.blocks === false) */
      ranged: boolean;
    }
  | {
      /** 아군이 맞았다 — 발이 묶인 적의 난투 반격 */
      type: 'allyDamaged';
      allyId: number;
      defId: AllyId;
      amount: number;
      /** 타격 후 남은 체력 (0 하한) */
      hpLeft: number;
      maxHp: number;
      x: number;
      z: number;
      attackerId: number;
      attackerDefId: EnemyId;
    }
  | {
      /** 아군이 쓰러졌다 (hp 0) */
      type: 'allyDied';
      allyId: number;
      defId: AllyId;
      x: number;
      z: number;
    }
  | {
      /** 수명이 다해 마을로 돌아갔다 — 사망과 구분한다(연출/사운드가 달라야 한다) */
      type: 'allyRetired';
      allyId: number;
      defId: AllyId;
      x: number;
      z: number;
      /**
       * 귀환 환급 골드 (balance.ALLY_RETIRE_REFUND × def.cost, 내림 없는 반올림).
       * 쓰러진 아군(allyDied)에는 없다 — 살아 돌아온 사람만 삯을 되돌려준다.
       */
      refund: number;
    }
  // --- 홈타운 (src/sim/hometown.ts) ------------------------------------------
  | {
      /**
       * 홈타운이 화살을 쐈다 — 발사음/반동 연출용. 피해는 화살이 꽂힐 때
       * projectileHit + enemyDamaged로 따로 나간다 (타워의 towerFired와 같은 구조).
       */
      type: 'baseFired';
      targetId: number;
      /** 기지 셀 (발사 위치) */
      x: number;
      z: number;
      /** 발사 시점 홈타운 레벨 (1-base) — 연출 강도 */
      level: number;
    }
  | {
      /** 홈타운이 한 단계 커졌다 — 마을 외형/체력바/사운드 */
      type: 'baseUpgraded';
      /** 올라간 뒤 레벨 (2 이상) */
      level: number;
      /** 실제로 지불한 골드 */
      cost: number;
      /** 갱신 후 현재/최대 HP (누적 피해량은 보존된다 — hometown.ts 규칙 4) */
      hp: number;
      hpMax: number;
      /** 갱신 후 화살 1발 피해 / 사거리 (패널 표시·사거리 링) */
      dmg: number;
      range: number;
    }
  | { type: 'statusApplied'; enemyId: number; kind: StatusKind }
  | { type: 'baseDamaged'; amount: number; hpLeft: number }
  | { type: 'goldChanged'; gold: number; delta: number }
  | { type: 'handChanged' }
  | { type: 'earlyCallBonus'; gold: number }
  | { type: 'battleEnded'; won: boolean; wave: number; amberEarned: number };

// ---------------------------------------------------------------------------
// 세이브 파일
// ---------------------------------------------------------------------------
export interface TowerProgress {
  unlocked: boolean;
  stars: number; // 0~5
  shards: number;
}

export interface StageProgress {
  bestWave: number;
  cleared: boolean;
  endlessBest: number;
}

export interface Settings {
  lang: 'ko' | 'en';
  music: number; // 0~1
  sfx: number; // 0~1
  vibration: boolean;
  quality: 'auto' | 'low' | 'med' | 'high';
}

export interface ProfileData {
  amber: number;
  towers: Record<TowerId, TowerProgress>;
  stages: Record<number, StageProgress>;
  /** 수령한 마일스톤 보상 id */
  milestones: number[];
  settings: Settings;
  stats: { kills: number; wavesCleared: number; playMs: number; bossKills: number };
}

export interface SaveFileV1 {
  version: 1;
  createdAt: number;
  updatedAt: number;
  profile: ProfileData;
}

export type SaveFile = SaveFileV1;

// ---------------------------------------------------------------------------
// 전투 시뮬레이션 공개 API (sim 트랙이 구현)
// ---------------------------------------------------------------------------
export interface BattleOptions {
  stage: StageDef;
  /** 타워별 메타 별 수 (스타 보너스 적용) */
  stars: Partial<Record<TowerId, number>>;
  /** 사용 가능한 타워 풀 (카드 덱) */
  deck: TowerId[];
  endless: boolean;
  seed: number;
  /**
   * 정의 테이블 주입 — sim은 data 구현 모듈을 임포트하지 않는다 (테스트 시 목 주입).
   * waveFor는 반드시 결정론적이어야 한다 (같은 wave → 같은 WaveDef).
   */
  towerDefs: Readonly<Record<TowerId, TowerDef>>;
  enemyDefs: Readonly<Record<EnemyId, EnemyDef>>;
  allyDefs: Readonly<Record<AllyId, AllyDef>>;
  /**
   * 홈타운 레벨 테이블 — 인덱스 0 = Lv1(시작). 길이가 곧 최대 레벨이다.
   * 주입식이라 통제 실험(tests/sim/arena.ts)이 기지 화력을 0으로 꺼서
   * "타워와 습격대의 교환비"만 격리해 잴 수 있다.
   */
  baseLevels: readonly BaseLevelDef[];
  waveFor(wave: number): WaveDef;
}

export interface BattleSim {
  readonly state: BattleStateView;
  applyCommand(cmd: BattleCommand): boolean;
  /** 1틱 진행. 발생 이벤트는 내부 큐에 쌓인다 */
  tick(): void;
  /** 큐에 쌓인 이벤트를 비우며 반환 (매 프레임 호출) */
  drainEvents(): SimEvent[];
  /** 결정론 검증용 상태 해시 */
  hash(): number;
  /**
   * **웨이브 미리보기** (읽기 전용). 인자를 생략하면 "다음에 올 웨이브"다 —
   * prep 중에는 state.waveIndex가 이미 다음 웨이브 번호이므로 그대로,
   * 전투 중이면 waveIndex + 1이다.
   *
   * 상태를 안 건드리고 이벤트를 안 내며 hash()에 안 들어간다. 임의 웨이브를
   * 조회할 수 있는 것이 계약의 일부다 — 그래야 봇을 한 판도 안 돌리고
   * 스테이지의 종별 HP 비중을 뽑는 계량기로 쓸 수 있다.
   */
  previewWave(wave?: number): WavePreview;
  /** 배치 가능 여부 (슬롯이고 비어있는가) */
  canPlaceAt(cellX: number, cellZ: number): boolean;
  /** 현재 배치/업그레이드 비용 조회 등 UI 헬퍼 */
  towerAt(cellX: number, cellZ: number): TowerState | null;
  upgradeCost(towerId: number): number | null;
  sellRefund(towerId: number): number | null;
  /** 그 셀에 아직 치우지 않은 소품(나무/바위)이 있는가 */
  hasScenery(cellX: number, cellZ: number): boolean;
  /** 지금 그 셀을 치우는 데 드는 골드 (소품이 없으면 null) — 제거 횟수에 따라 오른다 */
  clearSceneryCost(cellX: number, cellZ: number): number | null;
  /** 지금 이 부족원을 출동시키는 데 드는 골드 (나가 있는 인원 수에 따라 오른다) */
  allyCost(defId: AllyId): number;
  /** 지금 출동이 가능한가 (상한 미만 + 골드 충분 + 전투 진행 중) */
  canTrainAlly(defId: AllyId): boolean;
  /** 홈타운을 한 단계 올리는 비용 (최대 레벨이면 null) */
  baseUpgradeCost(): number | null;
  /** 지금 홈타운을 올릴 수 있는가 (최대 레벨 아님 + 골드 충분 + 전투 진행 중) */
  canUpgradeBase(): boolean;
  /** 현재 홈타운 사거리 (타일) — 선택 시 사거리 링 표시용 */
  baseRange(): number;
  /** 현재 마을 레벨의 아군 출격 한계선 (타일) — 마을 패널 표기용 */
  allySortieRange(): number;
  /**
   * 지금 아군이 멈춰 서는 지점 (지상 경로마다 하나, 셀 연속 좌표).
   * 한계선은 **경로 호장** 기준이라 기지 중심의 원이 아니다 — 화면 표식은 반드시
   * sim이 실제로 쓰는 경로에서 뽑아야 그림과 규칙이 어긋나지 않는다.
   */
  allySortiePoints(): Vec2[];
  /**
   * 다음 레벨이 주는 최대 HP/공격력/사거리/출격 한계선 (최대 레벨이면 null).
   * 비가역 결제라 "무엇을 사는가"가 확인 단계 **전에** 보여야 한다.
   */
  baseNextStats(): { hpMax: number; dmg: number; range: number; sortie: number } | null;
}

// ---------------------------------------------------------------------------
// GameFacade (UI 트랙은 이 인터페이스만 사용; game 트랙이 구현)
// ---------------------------------------------------------------------------
export type ScreenId = 'title' | 'lobby' | 'collection' | 'settings' | 'battle' | 'result';

export interface ResultSummary {
  won: boolean;
  stageId: number;
  wave: number;
  waveCount: number;
  amberEarned: number;
  shardsEarned: Partial<Record<TowerId, number>>;
  firstClear: boolean;
  endless: boolean;
  kills: number;
}

export interface ProfileApi {
  readonly data: ProfileData;
  spendAmber(n: number): boolean;
  addAmber(n: number): void;
  starUp(towerId: TowerId): boolean; // 비용 검증 포함
  unlockTower(towerId: TowerId): boolean;
  stageProgress(stageId: number): StageProgress;
  isStageUnlocked(stageId: number): boolean;
  isEndlessUnlocked(): boolean;
  updateSettings(patch: Partial<Settings>): void;
  /** 세이브 삭제 + 새 프로필 (설정 화면 2단 확인 후) */
  resetData(): void;
  save(): void;
}

export interface BattleUiApi {
  readonly sim: BattleSim;
  paused: boolean;
  speed: 1 | 2 | 4;
  autoWave: boolean;
  /** 셀 선택/타워 선택 상태는 game/placement가 관리, UI는 콜백만 받는다 */
  selectCard(handIndex: number | null): void;
  selectedCard(): number | null;
  /** 현재 선택된 배치 타워 id (없으면 null) */
  selectedTower(): number | null;
  /** 현재 선택된 소품 셀 (없으면 null) — 제거 패널 표시용 */
  selectedScenery(): Vec2 | null;
  /** 홈타운(기지 셀)이 선택되어 있는가 — 레벨업 패널 표시용 */
  selectedBase(): boolean;
  /**
   * 마을을 고른다 (= 판 위의 움막을 탭한 것과 같다). HUD의 부족 칩이 부른다 —
   * 마을 패널이 출동의 유일한 입구인데 판 위에는 아무 표시도 없어서, 상시 HUD에
   * "여기 있다"고 알리는 자리가 필요하다 (8단계 검증 지적). 선택 사항이다.
   */
  selectBase?(): void;
  /** 홈타운 레벨업 요청 (최대 레벨/골드 부족이면 무시) */
  requestUpgradeBase(): void;
  /**
   * **하단 패널이 판을 어디부터 덮는지** 알린다 (화면 y, 닫혔으면 null).
   *
   * 마을 패널은 레벨업과 출동을 한 패널에 담아 하단 HUD 예약을 넘어서므로,
   * 그대로 두면 마을 셀과 출격 봉수대가 자기 패널 뒤로 숨는다(8단계 검증 실측:
   * 15개 뷰포트 조합 중 마을 12개·표식 8개, 좁은 폰은 전부). 게임 쪽은 이 값을 받아
   * 카메라를 그만큼 위로 비켜세운다(render/camera.ts setLift).
   * UI가 스스로 카메라를 만지지 않는 이유는 "얼마나 비켜야 하는가"가 마을 셀의
   * 투영 좌표에 달려 있어 게임 쪽만 알 수 있기 때문이다.
   * 선택 사항이다 — 목 UI(debug/labs/uilab)처럼 판이 없는 구현은 안 넣어도 된다.
   */
  reportPanelTop?(screenY: number | null): void;
  /** 선택된 소품 셀 제거 요청 (골드 부족/미선택이면 무시) */
  requestClearScenery(): void;
  /**
   * 선택(타워/소품)을 해제한다 — 패널의 닫기 버튼용.
   * 패널이 그 셀을 덮으면 "같은 셀 재탭으로 닫기"가 물리적으로 불가능하므로
   * UI 쪽에 명시적인 해제 경로가 필요하다.
   */
  clearSelection(): void;
  requestSetTargeting(mode: TargetingMode): void;
  /** 마을에서 부족원 출동 (골드 부족/상한이면 무시) */
  requestTrainAlly(defId: AllyId): void;
  requestRefresh(): void;
  requestCallWave(): void;
  requestUpgradeSelected(): void;
  requestSellSelected(): void;
  quitToLobby(): void;
  retry(): void;
}

export interface GameFacade {
  profile: ProfileApi;
  goto(screen: ScreenId, params?: unknown): void;
  currentScreen(): ScreenId;
  startBattle(stageId: number, endless: boolean): void;
  /** battle 화면에서만 존재 */
  battle: BattleUiApi | null;
  /** 결과 화면 데이터 */
  lastResult: ResultSummary | null;
  /** 표시용 실데이터 (로비/도감) */
  stages: readonly StageDef[];
  towerDefs: Readonly<Record<TowerId, TowerDef>>;
  version: string;
}
