// ============================================================================
// Age of Wogawoga (와가와가의 시대) — 전역 타입 계약 (모든 트랙이 이 파일 기준으로 작업한다)
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
  | 'drum' // 전쟁북 (버프)
  // ── 2라운드 2-c — counter-plan (B) 표의 빈틈에서 나온 셋 ──────────────
  | 'hushtotem' // 주술 방해 토템 — ✧정화 축의 답 (적 오라를 잠재운다)
  | 'rattletrap' // 연타 함정 — 🔶재충전 방패 축의 답 (발사 간격이 가장 짧다)
  | 'shockstake'; // 충격 말뚝 — 저장소 최초의 stun 타워 (제어)

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
  | 'guardian' // 방패 파수꾼 (근접 탱커, 오래 묶는다)
  | 'gatherer'; // 채집꾼 (순수 일꾼 — 캐는 속도 3배, 짐 2개, 전투력 최하)

/**
 * 채집 자원 — 맵의 소품 칸(나무·바위)이 이제 **자원 칸**이다.
 * 칸 수도, 칸이 건설을 막는다는 사실도 **안 바뀐다**(SCENERY_DENSITY 0.3 고정, data/grid.ts:71).
 * 다 캔 칸도 그루터기로 남아 계속 건설 불가다(docs/gather-spec.md D1).
 * 바뀌는 것은 그 칸의 **뜻**뿐이다: 걸어가 캐서 마을로 지고 오면 코인이 된다.
 *
 * 종류가 정하는 것은 **두 가지뿐**이다 — 캐는 데 걸리는 시간(ticks)과 짐 값 배수(kindMul).
 * 셀→종류 배정은 data/resources.ts resourceKindOf(셀 단독 해시, 시드 무관).
 *
 * 바이옴 제약(화산에 딸기 없음 등)은 종류를 유니온에서 빼는 것이 아니라
 * **가중치 표에서 항목을 빼는 것**으로 표현한다 — 유니온이 바이옴마다 갈라지면
 * Record<ResourceId, ...> 전수 매핑이 전부 부분 매핑이 된다.
 */
export type ResourceId =
  | 'berry' // 딸기덤불 (가장 빨리 캔다 — 전투원도 딸 만한 유일한 종)
  | 'mushroom' // 버섯 무리
  | 'honey' // 벌집
  | 'fruit' // 열매나무 (식량인데 **키가 큰** 유일한 종 — gather-spec §6-4 계약)
  | 'flint' // 부싯돌 (기준종 — kindMul 1.00)
  | 'wood' // 통나무 (전 바이옴 · 랜드마크 보유)
  | 'stone' // 돌무더기 (느리게 많이 · 랜드마크 보유)
  | 'obsidian'; // 흑요석 (화산 전용 · 최고 단가)

/**
 * 홈타운(기지)이 낸 피해의 출처 태그. 타워도 아군 유닛도 아니므로 고유 값을 쓴다 —
 * TowerId/StatusKind/AllyId 어느 집합과도 이름이 겹치지 않는다.
 */
export type HometownSourceId = 'hometown';

export type BiomeId = 'grassland' | 'jungle' | 'desert' | 'snow' | 'swamp' | 'volcano';
export type StatusKind = 'slow' | 'burn' | 'poison' | 'stun';
/**
 * `StatusKind` 의 **고정 순서** — `battle.hash()` 가 상태이상을 접을 때 kind 를 숫자로
 * 바꾸는 데 쓴다. 문자열을 그대로 접을 수 없어서다.
 * ⚠ 이 배열의 **순서를 바꾸면 해시가 바뀐다.** 결정론 테스트는 같은 시드 두 판을 비교할
 *   뿐이라(골든 해시가 없다) 순서 변경 자체는 안 잡히지만, 원소를 **빠뜨리면**
 *   indexOf 가 −1 이 되어 서로 다른 두 상태가 같은 값으로 접힌다. 아래 두 줄이 같이 산다.
 */
export const STATUS_KIND_ORDER: readonly StatusKind[] = ['slow', 'burn', 'poison', 'stun'];
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
  /**
   * **적의 오라를 이 반경 안에서 잠재운다** — 주술 방해 토템(hushtotem).
   * 대상은 적의 `healAura` 와 `purge` 둘 다이고, 반경 안에 **시전자가 서 있으면**
   * 그 시전자의 오라가 그 틱에 통째로 안 돈다(스턴과 같은 취급).
   *
   * ⚠ 왜 스턴으로 대신하지 않는가: 스턴은 이동까지 멈추고 보스 면역·저항이 붙어
   *   "주술사를 침묵시킨다"는 뜻이 다른 축들과 섞인다. 그리고 정화(purge)는
   *   상태이상을 벗기므로 **스턴으로 주술사를 막으려 하면 주술사가 그 스턴을 벗긴다** —
   *   답이 순환한다. 잠재우기는 상태이상이 아니라 **자리(위치)** 로 판정하므로
   *   벗겨질 수 없다. 그것이 이 축이 ✧정화의 답인 이유다.
   *
   * ⚠ 적에게 상태를 심지 않으므로 `EnemySim` 에 필드가 늘지 않는다 =
   *   `battle.hash()` 접기를 넓힐 필요가 없다. 판정은 매 틱 타워 위치로 다시 계산된다.
   */
  suppressEnemyAuras?: boolean;
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
   * **재충전형 방패** 🔶 — 방패가 깎였을 때 이 틱수마다 **1장** 되돌아온다.
   * 생략하면 재충전 없음(= 지금까지의 동작: 한 번 벗기면 끝).
   *
   * ⚠ **차단율의 차원이 "타격 크기"가 아니라 "발사 간격"이다.** 잔량이 최대 미만이면
   * 언제나 카운트다운이 돌므로, 긴 교전에서 이 적은 `shieldRecharge` 틱마다 정확히
   * 한 발을 무효화한다. 곧 차단율 = **발사 간격 ÷ 재충전**이고, 이것이
   * docs/counter-plan.md (B) 표의 유도다 — 그 표를 역산해 확인했다:
   *   창던지기 T3 13틱 ÷ 75 = 0.173 → 배율 0.827 ≒ 표의 **0.83**
   *   상아 발리스타 T3 56틱 ÷ 75 = 0.747 → 배율 0.253 ≒ 표의 **0.25**
   * 두 칸이 소수 둘째 자리까지 맞는다.
   *
   * ⚠ "**소진된 뒤**(잔량 0)에만 카운트다운"으로 읽으면 위 표가 재현되지 않는다.
   *   그리고 "잔량이 최대 미만이면 항상"이 방패를 상시 유지시킨다는 걱정도 성립하지
   *   않는다 — 빠른 타워 앞에서는 소모가 회복보다 빨라 잔량이 대부분 0이다.
   *   티어로는 못 빠져나간다: 쿨다운은 티어당 45→40틱뿐이다.
   */
  shieldRecharge?: number;
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
  /**
   * **정지 자세에서 몸 앞끝이 개체 중심에서 앞으로 뻗는 거리** (타일, 렌더 스케일 포함).
   * 곧 `buildEnemy(id).boundingBox.max.x × (보스 1.15 : 1)` 이다 —
   * `tests/render/gatepose.test.ts` §1 이 16종 전부를 메시와 대조해 잠근다.
   *
   * ── ⚠⚠ 왜 `radius` 로는 안 되는가 (이 필드가 생긴 이유) ────────────────────
   * 문간 정지선은 "몸 앞끝이 마을 바깥끝에 선다"로 정의되는데(gate.ts 규칙 2),
   * 옛 구현은 그 앞끝을 `radius` 로 쟀다. `radius` 는 **충돌 반지름**이라 메시가 앞으로
   * 뻗는 길이의 비가 **0.96~2.51배로 흩어진다**(golem 0.50 대 0.48 · ptera 0.32 대 0.80 ·
   * raptor 0.30 대 0.72) — 일정하지 않으니 상수를 곱해 대신할 수도 없다.
   * 그래서 "앞끝 ≥ 1.45" 계약은 초록인데 화면에서는 랩터 주둥이가 움막에 박혀 있었다.
   * **잣대가 틀렸던 것이지 값이 틀렸던 것이 아니다.**
   *
   * ⚠ `radius` 를 이 값으로 바꾸면 안 된다 — 충돌·타게팅·체력바·스플래시가 전부
   *   그 위에 서 있고, 그쪽은 "몸통이 차지하는 폭"이 맞는 잣대다. 두 잣대는 서로
   *   다른 것을 재므로 **둘 다 있어야 한다**.
   *
   * ⚠ 이 값은 sim(three 임포트 금지)이 읽으므로 **손으로 베낀 숫자**다. 소수 4자리로
   *   적는다(반올림 오차 ≤ 5e-5). 메시를 고치면 §1 계약이 먼저 빨개진다.
   */
  restReach: number;
  /** 저체력 격노: hp 비율 이하에서 속도 배율 */
  enrage?: { hpPct: number; speedMul: number };
  /** 주변 힐: 반경 내 아군에게 0.5초마다 회복 */
  healAura?: { radius: number; hpPerStatusTick: number };
  /**
   * **정화** ✧ — `STATUS_TICK_INTERVAL`(15틱)마다 반경 내 **다른** 적에게서
   * 상태이상 스택을 `stacksPerTick`개 벗긴다. 상태이상에 기대는 답을 벌한다.
   *
   * 확정한 세부 규칙(사양에 없어 여기서 못 박는다 — 없으면 구현자마다 답이 갈린다):
   *  · **어느 스택**: `statuses[0]` = **가장 오래 걸린 것**부터. 결정적이어야 하고
   *    (src/sim 에서 Math.random 금지) 만료가 임박한 것부터라 새 축을 가장 약하게 들인다.
   *    더 가혹한 변형(가장 최근 것 / 남은 지속이 가장 긴 것)은 한 줄 차이다 — 밸런스다.
   *  · **시전자 자신**: 제외. `processHealAuras`의 `if (j === i) continue`와 대칭이고,
   *    주술사 본인은 여전히 얼려서 잡을 수 있어 대응이 남는다.
   *  · **보스 스턴 면역**: 정화가 stun 스택을 벗길 때도 만료와 **똑같이** 면역을 건다.
   *    안 그러면 보스가 "면역 없이 즉시 다시 스턴 가능"이 되어 정화가 플레이어에게
   *    유리해진다 — 적 편 능력이 플레이어를 돕는 것은 뜻이 뒤집힌 것이다.
   */
  purge?: { radius: number; stacksPerTick: number };
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
/**
 * 아군 회복 능력 — `AllyDef.heal`. 대상은 **타워와 홈타운뿐**이다(아군 제외 근거는 그 필드 주석).
 *
 * 동작(sim/heal.ts): 매 틱 가장 위태로운 대상(**잃은 HP 비율**이 큰 쪽)을 고르고,
 * 사거리 밖이면 걸어가고, 안이면 쿨다운마다 `amount` 만큼 되돌린다.
 * 순서·동률이 전부 결정론이어야 하므로 규칙은 그 파일 한 곳에만 적혀 있다.
 */
export interface AllyHealSpec {
  /** 한 번에 되돌리는 HP (절대값·정수). 정수라야 hash 가 부동소수에 안 흔들린다 */
  amount: number;
  /** 이 거리 안이면 회복한다 (타일) */
  radius: number;
  /** 회복 주기 (틱) */
  cooldownTicks: number;
  /**
   * 대상을 찾아 **걸어가는** 최대 거리 (타일). 이보다 먼 대상은 못 본 척한다 —
   * 없으면 마법사가 판 끝까지 쫓아다녀 전선에서 이탈한다.
   */
  seekRadius: number;
}

export interface AllyDef {
  id: AllyId;
  nameKey: string;
  descKey: string;
  hp: number;
  /** 타일/초 — 지정한 목표 지점으로 **직선 이동**하는 속도 */
  speed: number;
  /** 타격당 고정 피해 감소 */
  armor: number;
  /** 충돌/연출 반경 (타일) */
  radius: number;
  /** 기본 출동 비용 — 실비용은 balance.allyCostFor(base, 생존 수)가 올린다 */
  cost: number;
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
  /**
   * **급소 열기 🟫🔓** — 이 아군에게 붙잡힌 적(`e.blockerAllyId === a.id`)은 가죽 상한이
   * 무효가 된다. `armor`는 건드리지 않는다 — 한 규칙, 한 수업.
   *
   * 왜 이 필드가 아군 쪽에 있는가: 아군의 값이 지금까지 **덧셈**(자기 피해 + 붙잡는 시간)이라
   * 타워 화력에 비해 무시할 만했다(botharness STRONG_BOT 주석 12단계 실측 = 한계가치 정확히 0).
   * 이것은 **곱셈 인자**다 — 파수꾼 하나가 투석기·발리스타의 큰 한 방을 되살린다.
   * 그리고 타워가 없는 갈래에서는 값이 **정확히 0**이라(아군 자신의 dmg 9~14는 어떤 웨이브의
   * 가죽 상한보다도 작다) 봉투 9·12의 유닛/부족 지배를 구조적으로 안 민다.
   * 전문: docs/counter-plan.md 단계 3.
   */
  sunder?: boolean;
  /**
   * **회복 🔷** — 이 아군은 손상된 **타워와 홈타운**에게 걸어가서 HP 를 되돌린다.
   * 없으면(생략) 회복 능력이 없다.
   *
   * ── 왜 아군(부족원)은 회복 대상이 아닌가 (설계상 반드시 그래야 한다) ──────────
   * 사용자 요구는 "우리 부족이나, 타워, 홈타운등의 hp"였지만 **부족원은 뺐다.** 근거 둘,
   * 둘 다 이 저장소가 이미 증명해 둔 불변식이다:
   *  ① **종료 증명** — `sim/allies.ts` 머리말이 못 박아 뒀다: "아군은 회복 수단이 없다 …
   *     ⚠ 이 성질은 아군 회복/부활을 넣는 순간 깨진다. 넣으려면 스톨 가드를 함께 넣어라."
   *     회복량이 난투 피해 이상이면 봉쇄가 영원히 안 풀려 **웨이브가 안 끝난다**(봉투
   *     13.terminates). 타워·홈타운은 아무도 붙잡지 않으므로 이 위험이 원리적으로 없다.
   *  ② **채집 중단 벌금** — `entities.ts AllySim.gatherHpMark` 가 "아군 hp 는 단조 감소"를
   *     전제로 `hp < gatherHpMark` 하나로 "이 시도 중에 맞았다"를 판정한다. 맞은 뒤
   *     회복되면 그 등가가 깨져 벌금이 **조용히** 사라진다 — tsc 도 봉투도 못 잡는다.
   * 부족원 회복을 넣으려면 위 둘을 먼저 다시 짜야 한다. 지금은 안 넣는다.
   */
  heal?: AllyHealSpec;
  /**
   * 채집 **속도** 배수, 정수 퍼센트 (생략 = 100 = 기준 속도, 0 = 못 캔다).
   * 실제 틱 = max(1, round(자원.ticks × 100 / gatherPct)) — data/resources.ts gatherTicksFor.
   *
   * ⚠ **수확량에는 절대 안 곱한다**(gather-spec D8). 칸의 짐값을 셀에 고정해야 맵 전체
   * 채집 총액이 `Σ(칸별 짐값)`으로 닫히고, 그 상한이 감사 가능한 한 숫자가 된다
   * (스테이지1 = 559골드). 수확 배율이 붙는 순간 그 상한이 부족 구성에 따라 3배까지 열린다.
   *
   * balance.ts 상수가 아니라 여기 있는 이유: (a) sunder가 같은 형태의 선례이고,
   * (b) 봉투가 이 축을 A/B할 수 있어야 한다 — makeBotSimFor의 allyDefTable 주입구
   * (tests/sim/botharness.ts)와 DataPatch.allies가 그대로 손잡이가 된다.
   * 모듈 상수로 두면 그 통로가 없어 채집 축이 봉투에서 **측정 불가**가 된다.
   */
  gatherPct?: number;
  /**
   * 짐을 몇 개까지 지는가 (생략 = 1). 전투 3종 1, 채집꾼 2. (gather-spec D6)
   *
   * ⚠ **수확 배율이 아니다.** 맵 총액은 칸의 짐값 합으로 그대로 닫힌다.
   *   이 값이 바꾸는 것은 **마을 왕복 횟수**뿐이다 — 두 칸을 연달아 털고 한 번에 배달한다.
   *   짐이 가득 차면 sim이 자동으로 마을로 향한다. 자동으로 **캐지는 않는다**(D4).
   *
   * gatherPct와 같은 자리에 두는 이유도 같다: 봉투가 이 축만 따로 끌 수 있어야 한다.
   */
  carryCap?: number;
}

// ---------------------------------------------------------------------------
// 채집 자원 — 칸의 정의와 칸의 상태 (수치·가중치는 src/data/resources.ts)
// ---------------------------------------------------------------------------
export interface ResourceDef {
  id: ResourceId;
  nameKey: string;
  /** 설명 한 줄 — 자원 패널의 부제 */
  tagKey: string;
  /**
   * 짐 하나를 캐는 데 드는 틱, **전투 3종 기준**(30 = 1초). 정수만.
   * 실제 틱 = max(1, round(ticks × 100 / (AllyDef.gatherPct ?? 100))) — 속도만 곱한다(D8).
   * 값의 유도는 docs/gather-spec.md §1-2 (채집꾼 기준 4.0~13.0초).
   */
  ticks: number;
  /**
   * **짐 값 배수** — 이 종의 한 짐이 기준종(flint = 1.00) 대비 몇 배인가.
   * 짐값 = round(GATHER_BASE_VALUE × kindMul × (1 + GATHER_DIST_GAIN × 마을거리)).
   *
   * ⚠ **units는 폐기했다(D2).** 한 칸은 한 짐이다. "몫 수"가 있으면 한 칸의 총액이
   *   units × gold로 갈라져 (a) 부분 수확이라는 상태가 생기고 (b) 중단·재개·양보의
   *   규칙이 전부 두 배가 되며 (c) 배달(D3)이 "몇 몫째를 지고 가는가"로 오염된다.
   *
   * 실수인 이유: 정수로 만들려면 기준값을 100배로 두어야 하는데, 그러면 GATHER_BASE_VALUE
   * 하나로 총액을 되돌린다는 D9의 성질이 두 상수로 갈라진다. 곱셈 결과에는 Math.round가
   * **정확히 한 번**만 닿고 누적이 없으므로 결정론에 안전하다.
   */
  kindMul: number;
}

/**
 * 공개 자원 칸 상태 — 판이 시작될 때 목록이 굳고 **taken만 변한다**.
 * 텄든 안 텄든 배열에서 빠지지 않는다: 배열 순서가 곧 해시 접기 순서라,
 * 원소가 빠지면 그 순간 결정론이 자료구조 구현에 의존하기 시작한다.
 */
export interface ResourceCellState {
  cellX: number;
  cellZ: number;
  kind: ResourceId;
  /**
   * 이 칸의 짐값 (정수). **생성 시 한 번 계산하고 그 뒤로 안 변한다.**
   * 마을거리의 함수라 판마다 같다. UI 배지가 이것 하나만 읽는다(매 프레임 계산 없음).
   */
  value: number;
  /**
   * **텄는가 = 지금 이 칸에 소품이 서 있지 않다.** false = 다 자라 있다 / true = 비었다.
   *
   * ⚠⚠ **D1이 뒤집혔다(사용자 재정의).** 옛 규칙은 "다 캔 칸은 그루터기로 남고 건설
   *   불가를 유지한다"였다. 사용자가 그 판정을 뒤집었다 — *"채집을 하고 나면 그자리에
   *   없어져야 하는데 그대로 남아 있어, 이걸 없애줘"*. 그러므로 이제 이 값이 true 면
   *   **소품 메시가 사라지고 그 칸에 지을 수 있다**(battle.ts `grown()` 이 유일한 판정이다).
   *   안 그러면 화면에 아무것도 없는데 못 짓는 칸이 되고, 그건 설명할 방법이 없다.
   *   ⇒ 이 불린은 이제 **건설 가능 여부를 함께 말한다.** 유료 제거(`clearScenery`)도
   *     이 값을 true 로 만들고, 화면에서 두 상태는 구별되지 않는다.
   *
   * ⚠ **`regrowAt` 에서 유도되지 않는다.** *다 자란 칸*(taken=false, regrowAt=0)과
   *   *타워가 태운 칸*(taken=true, regrowAt=0)이 같은 `regrowAt` 을 갖는다.
   */
  taken: boolean;
  /**
   * **재생 자격을 얻는 절대 틱.** `0` = 이 칸은 다시 안 자란다.
   *
   * ⚠⚠ **뜻이 한 번 옮겨졌다 — "자라는 틱"이 아니라 "자랄 수 있게 되는 틱"이다.**
   *   재생의 방아쇠는 시간이 아니라 **밭 전체의 재고 비율**이다
   *   (`balance.GATHER_REGROW_STOCK_FRAC` · `sim/gather.ts updateRegrow`). 이 값은 그
   *   방아쇠가 당겨졌을 때 후보에 들어갈 자격만 정한다:
   *     자격 = `regrowsLeft > 0`(생성 시 이미 반영) **그리고** `tick >= regrowAt`.
   *   곧 `tick >= regrowAt` 인 칸이 **그 틱에 자란다는 보장은 없다** — 재고가 문턱 위면
   *   얼마든지 기다린다. 반대로 재고가 문턱 아래여도 이 틱 전에는 절대 안 자란다.
   *   **저장 형태는 안 바뀌었다**(필드가 안 늘었다) — 그래서 `battle.ts hash()` 의 접기도
   *   그대로이고, 웨이브별 지연 차이도 이 값 하나에 굳어 해시에 실린다.
   *
   * 잔여 틱이 아니라 절대 틱인 이유 둘:
   *  ① 매 틱 40칸을 감산하지 않는다 — `tick >= regrowAt` 비교 하나로 끝난다.
   *  ② 잔여 틱은 "감산을 건너뛴 틱"이 생기는 순간 조용히 어긋난다. 절대 틱은 `view.tick`
   *     하나에만 걸려 있어 어긋날 자리가 없다 (R5: rng 금지 · 틱 결정론).
   *
   * 불변식: `regrowAt > 0` ⇒ `taken === true`. `taken === false` ⇒ `regrowAt === 0`.
   * 곧 `regrowAt > 0` 은 **"아직 한 번 더 설 수 있다"** 와 같은 말이다(재생 대기 중).
   * 쓰는 자리는 `sim/gather.ts` 의 `takeCell`/`burnRegrow`/`updateRegrow` **셋뿐이다**.
   */
  regrowAt: number;
  /**
   * **앞으로 몇 번 더 자랄 수 있는가.** 광물(stone·flint·obsidian)은 0으로 태어난다(R4).
   *
   * ⚠ 유도할 수 없다. 그리고 **판당 총액을 닫는 것이 재생 주기 T가 아니라 이 값이다**:
   *     판당 최대 채집액 = Σ value × (1 + regrowsLeft@생성)
   *   이 식은 판 길이·일꾼 수·재생 주기와 **무관하다.** 그래서 `18.rateCap` 이 재생이
   *   들어온 뒤에도 항등식으로 살아남고, 무한 모드에서도 총액이 유한하다.
   */
  regrowsLeft: number;
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
   * **부족원 정원** — 이 마을이 동시에 내보낼 수 있는 사람 수.
   *
   * 9단계까지 이 자리에는 출격 한계선(sortie)이 있었다. 사용자가 "반경 제한 없이 맵 어디든"
   * 으로 재정의하면서 그 값이 팔 것이 없어졌고, 마을이 파는 네 번째 물건 자리를 정원이 받았다.
   * 바꿔 끼운 것이지 없앤 것이 아니다 — 이유는 셋이다:
   *  · **없앨 수 없다.** 한계선이 하던 억제(아군이 맵 전체를 덮지 못하게)를 무엇이든 대신해야
   *    한다. 자리를 어디든 고를 수 있게 된 순간 **몇 명이냐**가 유일하게 남은 손잡이다.
   *  · **마을 레벨이 계속 무언가를 판다.** 안 그러면 Lv4→5가 2,400골드에 +3 HP와 +0.4 사거리만
   *    파는 죽은 칸이 된다.
   *  · **말이 된다.** 마을이 커지면 사람이 많아진다 — 설명이 필요 없다.
   * 소비처는 src/sim/hometown.ts allyCapFor(), 수치 근거는 src/data/hometown.ts.
   */
  allyCap: number;
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
  | 'purge' // 정화 — purge (반경 내 상태이상을 벗긴다)
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
  /**
   * **목표 HP 곡선의 계수를 재는 풀**을 명시한다 (`wavegen.curvePoolOf`).
   *
   * `ref`(평균 hp/cost)와 `maxSpend`(평균 cost × 스폰 캡)는 **전 웨이브의 목표 HP
   * 곡선**을 정하는 계수다. 생략하면 `airFromWave` 유무로 유도한다 — 게이트가 있으면
   * 지상 풀, 없으면 전체 풀. 스테이지1이 그 옛 규칙을 쓴다.
   *
   * ⚠ **왜 명시 손잡이가 필요한가**: 그 유도 규칙 때문에 `airFromWave`를 켜는 것만으로
   * 곡선이 통째로 움직인다. 실측(s2~s6에 게이트를 걸었을 때 w1~50 총 HP):
   * s2 +6.39% · s3 +4.45% · s4 +5.39% · s5 +5.56% · s6 +5.59% — 익룡이 한 마리도
   * 없는 w1까지 오른다. 그리고 보스는 `bossOverrides`라 안 오르므로 보스/직전 비가
   * s2 w50 1.1684→1.0791 · s3 w40 1.1493→1.0853 · s3 w50 1.1295→1.0667 로 떨어져
   * `tests/data/wavegen.test.ts`의 `> 1.1`을 깬다. 게이트 값과는 무관하다 —
   * `22/2`·`22/무제한`·`6/4` 세 변형의 w1 HP가 소수점까지 같다.
   *
   * ⇒ s2~s6은 `'all'`로 **곡선을 지금 그대로 못 박고** 게이트만 얻는다.
   *   밸런스는 사용자가 정한다(CLAUDE.md「밸런스는 사용자가 직접 한다」).
   *   곡선까지 옮기고 싶으면 이 줄을 지우고 보스 hpMul을 함께 올려야 한다.
   */
  curvePool?: 'all' | 'ground';
  /** 웨이브 번호(1-base) → 수동 보스 웨이브 오버라이드 */
  bossOverrides: Record<number, WaveDef>;
}

/**
 * layout 범례(행 문자열, 길이 = gridW):
 *   '.' 지상  '~' 물/공허  'o' 건설 슬롯  '#' 장식(바위 등, 건설 불가)
 * 경로 셀은 paths 웨이포인트에서 래스터라이즈되어 지형에 표시된다.
 */
/**
 * 문간 교전의 스테이지별 덮어쓰기 — 세 항목 전부 **생략 가능**이고, 생략하면 balance.ts 의
 * `GATE_BITE_TICKS` / `GATE_HOLD_MIN_TICKS` 와 "켜짐"이 그대로 쓰인다.
 * 배포 데이터는 한 스테이지도 이 필드를 적지 않는다(= 기본값 그대로).
 */
export interface GateSpec {
  /**
   * `false` 면 적이 문 앞에 서지 않고 **종전대로 누수한다**(문간 기능 전체가 꺼진다).
   * `gate-off` 되돌리기 대조군(tests/sim/controls.ts)이 쓰는 유일한 스위치다.
   */
  enabled?: boolean;
  /** 한 입의 주기(틱). 기본 GATE_BITE_TICKS */
  biteTicks?: number;
  /**
   * 체류의 하한(틱). 기본 GATE_HOLD_MIN_TICKS.
   *
   * ⚠ `claude/gate-wip` 의 `divisor`(한 입 = ceil(baseDamage/divisor))를 **여기로 교체했다**.
   *   그 손잡이는 판별력이 0이었다 — 4 → 32 로 8배를 올려도 완주율이 1.25% → 1.88% 로
   *   0.6%p 움직이고 멈췄다. 문간의 결말을 divisor 가 **언제**만 바꾸고 **어느 쪽**을 안
   *   바꾸기 때문이다. 이번 설계에서 총액은 `baseDamage` 로 고정이라 divisor 가 뜻을 잃고,
   *   실제로 움직일 것이 남은 유일한 축이 **잡졸의 체류 하한**이다.
   */
  holdMinTicks?: number;
}

/**
 * **스테이지별 채집 재생 손잡이.** 적은 항목만 덮어쓰고 나머지는 `balance.ts` 기본값이다.
 * 우선순위는 `BattleTuning`(실험 손잡이) > 이것(게임 데이터) > 모듈 상수 순이다.
 */
export interface GatherSpec {
  /**
   * 재생이 켜지는 재고 문턱 (기본 `GATHER_REGROW_STOCK_FRAC`). 0 = 재생 없음 ·
   * 1 = 재고 게이트가 없는 순수 타이머(배포본 이전 규칙과 완전히 같다).
   * ⚠ **이 값은 `regrowsLeft` 에 안 닿는다** — 판당 총액 항등식은 어떤 값에서도 그대로다.
   */
  regrowStockFrac?: number;
  /** 자격을 얻기까지의 최소 지연 틱, 웨이브 1 기준 (기본 `GATHER_REGROW_TICKS`) */
  regrowTicks?: number;
  /** 웨이브마다 최소 지연이 줄어드는 비율 (기본 `GATHER_REGROW_WAVE_SPEEDUP`, 0 = 끔) */
  regrowWaveSpeedup?: number;
}

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
  /**
   * **문간 교전 손잡이** (src/sim/gate.ts). 생략하면 전부 기본값이다 — 곧 이 필드를
   * 안 적은 여섯 스테이지의 동작은 balance.ts 상수가 정한다.
   *
   * 왜 스테이지에 두는가(= 왜 모듈 상수만으로 두지 않는가): `leakDamage` 와 **정확히 같은
   * 이유**다. 되돌리기 대조군(tests/sim/controls.ts)은 데이터 주입구로만 만들어질 수 있는데,
   * 문간을 모듈 상수로만 두면 `SIEGE_ENGAGE_RANGE` 처럼 **주입구 없는 되돌리기**가 되어
   * 항목이 통째로 UNPROVEN 으로 태어난다(controls.UNREACHABLE 참조).
   */
  gate?: GateSpec;
  /**
   * **채집 재생 손잡이** (src/sim/gather.ts). 생략하면 전부 `balance.ts` 기본값이다 —
   * 곧 이 필드를 안 적은 여섯 스테이지의 동작은 모듈 상수가 정한다.
   *
   * 왜 스테이지에 두는가: `gate`·`leakDamage` 와 **정확히 같은 이유**다(그 둘의 주석 참조).
   * 되돌리기 대조군은 데이터 주입구로만 만들어질 수 있고, 모듈 상수로만 두면 그 축의
   * 항목이 통째로 UNPROVEN 으로 태어난다.
   *
   * ⚠⚠ **배포 스테이지 여섯에는 한 값도 안 적었다 — 주입구만 열었다.** 근거는 실측이다:
   *   문턱을 바이옴별로 흔들 이유가 "척박한 바이옴"이라면 그것은 **분모가 이미 흡수한다.**
   *   재고의 분모가 *재생종만의 value 합*이라 바이옴이 아무리 척박해도 시작 재고는 언제나
   *   1.0 이고 문턱의 뜻이 여섯 판에서 같다(재생종 비중은 s6 17.2% ~ s1 75.8% 로 4.4배
   *   차이인데, 그 차이가 재고 비율에는 **한 자리도** 안 들어온다).
   *   여기에 스테이지 문턱을 더 얹으면 같은 사실을 두 번 세는 것이고, 그 값을 유도할 근거가
   *   없다. **근거를 댈 수 있게 되면 그때 적어라** — 그때 필요한 자리는 이미 여기 있다.
   */
  gather?: GatherSpec;
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
  /**
   * **문 앞에 서서 버틴 누적 틱** (0 = 문간이 아니다). src/sim/gate.ts.
   *
   * 이 한 필드가 "문간에 있는가"와 "얼마나 오래 있었는가"를 **동시에** 나타낸다.
   * 별도의 bool 을 두지 않은 이유는 두 값이 동시에 정확해야 안전한 설계를 피하려는
   * 것이다(entities.ts `bountyPaid` 주석의 논거와 같다) — 상태가 하나면 풀 재사용
   * 리셋 누락이 한 곳에서만 일어난다.
   *
   * ⚠⚠ **어떤 분기보다 앞에서 무조건 증가한다.** 스턴·감속·힐·방패·아군 봉쇄·마을 화력
   *   그 무엇도 이 값을 멈추지 못한다. 그것이 종료 증명의 전부다(gate.ts §종료 증명).
   *   조건부로 증가시키는 순간 판이 영영 안 끝나는 상태가 생긴다.
   *
   * 0에서 1이 되는 순간은 `moveEnemies` 가 정지선에 도달시킨 그 틱이고, 그 뒤로는
   * **두 번 다시 걷지 않는다**. 곧 이 값이 0보다 크면 좌표가 영구히 고정이다.
   * 공개 상태다 — HUD 가 '문 앞에 선 수'를, 연출이 대치 링을 여기서 읽는다.
   */
  gateTicks: number;
  /**
   * 다음 한 입까지 남은 틱 (문간이 아니면 항상 0). gate.ts 규칙 5.
   *
   * `attackCdLeft`(타워 타격)와 **일부러 분리한다** — 같은 이유다(entities.ts
   * `brawlCdLeft` 주석): 두 행동은 서로 배타이고(문 앞의 적은 타워를 안 때린다·규칙 4)
   * 합치면 "문 앞에 서는 순간 타워 쿨다운이 한 박자 밀리는" 숨은 결합이 생긴다.
   * 공개 상태인 이유는 HUD 가 '다음 한 입까지 남은 시간'을 그대로 그리기 때문이다.
   */
  gateBiteCdLeft: number;
  /**
   * **도착이 청구하는 총액 중 아직 안 낸 잔액.** 스폰 시 `baseDamage` 로 굳고, 한 입마다
   * `GATE_BITE_AMOUNT` 씩 줄고, 0이면 더 못 문다. gate.ts 규칙 6.
   *
   * ⚠⚠ **`leakEnemy` 가 청구하는 값이 `baseDamage` 가 아니라 이 필드다.** 그 한 줄이
   *   총량 항등식을 **자료구조로** 보장한다:
   *     Σ(한 입) + (뚫고 들어갈 때의 잔액 한 방) = e.baseDamage — 언제나, 정확히.
   *   곧 문간이 켜지든 꺼지든 한 마리가 마을에 넣는 총 피해가 **한 자리도 안 바뀐다**.
   *   문간이 꺼진 판에서는 이 값이 스폰 뒤 한 번도 안 줄어 `baseDamage` 그대로이므로
   *   `leakEnemy` 의 동작이 **비트 단위로 종전과 같다**.
   *
   * 공개 상태인 이유는 HUD 가 "앞으로 N 입 남음"을 그리기 때문이다.
   */
  gateOwed: number;
}

/**
 * 아군 유닛 상태.
 *
 * **9단계에서 경로 구속을 걷어냈다** (사용자 재정의). 아군은 더 이상 폴리라인 위를 걷지 않고
 * 판 위 아무 셀로나 직선으로 간다. 그래서 경로 4필드(dist·pathIndex·slot·holdDist)와
 * 수명(lifeLeft)이 통째로 사라지고, 그 자리를 **목표 좌표 + 걸은 거리** 둘이 대신한다.
 * 규칙 전문은 src/sim/allies.ts 헤더.
 */
export interface AllyState {
  id: number;
  defId: AllyId;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  /**
   * 이동 명령의 목표 (연속 셀 좌표). 스폰 직후에는 홈타운 앞 집결 지점이고,
   * 플레이어가 셀을 찍으면 그 셀 중심으로 바뀐다. 도착하면 x/z와 같아진다.
   */
  tgtX: number;
  tgtZ: number;
  /**
   * 태어나서 지금까지 **걸은 총 거리** (타일). 렌더의 보행 위상이 이 값에서 나온다.
   *
   * 예전에는 경로 호장 `dist`가 그 일을 했는데(역주행이라 부호를 뒤집어 썼다), 자유 이동에는
   * 단조 증가하는 진행량이 없다 — 앞뒤로 오가면 dist가 늘었다 줄었다 해서 다리가 얼거나
   * 거꾸로 돈다. 걸은 거리는 방향과 무관하게 **언제나 증가**하므로 그 문제가 없다.
   */
  walked: number;
  /** 바라보는 방향 라디안 = 실제 이동 방향 atan2(dz, dx) */
  heading: number;
  /** 타격 쿨다운 잔여 틱 */
  attackCdLeft: number;
  /** 교전 중인 적 id (-1 = 없음). 렌더가 공격 모션에 쓴다 */
  targetId: number;
  /**
   * **자동 행동을 껐는가** (수동 대기). `false` = 자동 켜짐 = **기본값**.
   *
   * 명령이 없는 일꾼은 스스로 가장 가까운 자원 칸으로 간다(sim/allies.ts 규칙 8).
   * 사람이 **자원도 적도 없는 빈 칸**을 찍으면 그것이 "여기 지켜"이고, 그때만 이 값이
   * true가 되어 자동이 꺼진다. 다시 켜는 방법은 일감(자원 칸·적이 선 칸)이나
   * **기지 셀**을 찍는 것이다.
   *
   * ⚠ 이것 하나만 저장하는 이유 — 나머지는 전부 유도된다:
   *   캐는 중 = isGathering(a) · 짐 = carryCount > 0 · 교전 = targetId >= 0 ·
   *   걷는 중 = (x,z) ≠ (tgtX,tgtZ). 그런데 **"빈 칸을 지정받아 그 자리를 지키는 중"과
   *   "명령이 없어 서 있는 중"은 위치로 구별할 수 없다** — 둘 다 x == tgt다.
   *   유도 불가능한 것이 정확히 이 한 비트뿐이라 필드도 하나다.
   *
   * 값을 쓰는 곳은 `sim/allies.ts moveAlly()` **한 곳뿐**이다(자동 코드는 읽기만 한다) —
   * `gatherKey`가 `setGatherTarget` 하나만 쓰던 것과 같은 규약이다.
   *
   * ⚠⚠ `entities.ts resetAlly`가 반드시 **false로** 되돌린다. 안 지우면 새 부족원이
   *   앞사람의 대기 상태를 물려받아 **명령을 한 번도 안 받았는데 자동이 꺼진 채** 태어나고,
   *   그 갈림이 풀 재사용 순서(= 시드)를 타므로 hash()가 시드마다 갈린다
   *   (resetEnemy의 bountyPaid · resetAlly의 carryGold와 정확히 같은 사고다).
   */
  autoHold: boolean;
  /**
   * 예약한 자원 칸의 셀 키 `z * gridW + x`. **−1 = 채집 명령 없음.**
   *
   * 왜 필요한가 (셋 다 이 필드 하나가 한다):
   *  ① **예약** — 같은 칸을 두 사람이 캐지 못하게 한다. 한 칸에 한 짐이므로(D2)
   *     둘을 보내면 한 명은 반드시 헛걸음한다. 명령 시점에 살아 있는 아군의 gatherKey를
   *     훑어 중복이면 예약을 안 붙인다. 순회는 멤버십 검사뿐이라 순서에 무관하다(계약 B).
   *  ② **도착 판정 대상** — 이 키가 가리키는 칸이 곧 tgtX/tgtZ다.
   *  ③ **렌더 표식** — 누가 어느 칸으로 가고 있는지(반투명 배지).
   * 좌표 둘이 아니라 키 하나인 이유: 조회가 키 하나로 끝나고(ResourceField.at) 해시에
   * 한 줄로 접힌다. −1 센티널은 targetId와 같은 규약이다.
   *
   * ⚠ 이 값을 ≥ 0으로 만드는 코드는 **`sim/allies.ts` 안 두 곳뿐이다** —
   *   `moveAlly()`(사람의 명령)와 `updateAllyAuto()`(규칙 8의 자동 행동).
   *   trainAlly의 집결 이동(a.tgtX/tgtZ 직접 대입)은 여전히 절대 건드리지 않는다.
   *   ⚠ 규칙 8이 들어오면서 계약 A("탭이 없으면 코인도 없다")가 **철회됐다.** 봉투 [5]의
   *   근거는 이제 "탭이 없으면"이 아니라 **"사람이 없으면"** 이다: 두 통로 모두 살아 있는
   *   아군을 순회하므로, `trainAlly`를 한 번도 안 낸 방치 판은 순회가 0번 돌아 수입이 0이다.
   */
  gatherKey: number;
  /**
   * 이번 짐에 쌓인 캐기 틱 (0 ~ 실제틱−1). 부분 진행분의 유일한 표현이다.
   *
   * 왜 필요한가: 캐기는 여러 틱에 걸치고, 맞으면 **0으로 되돌아간다**(D5). 곧 이 값은
   * "얼마나 진행했나"이자 "이번에 맞으면 얼마를 잃나"다. 렌더의 채집 게이지도 이것을 읽는다
   * (비율 0~1은 **렌더가** gatherTicks / gatherTicksFor로 만든다 — sim은 비율을 저장하지 않는다).
   * **정수다** — 분수를 float로 누적하면 hash()의 v.gold가 흔들린다(bountyPaid와 같은 사고).
   * 걸어가는 중에는 안 오른다.
   */
  gatherTicks: number;
  /**
   * 지금 지고 있는 골드 합 (정수). 0 = 빈손.
   *
   * 왜 필요한가: 배달은 **마을에 닿는 순간**이고(D3), 그때 지급할 액수는 어느 칸에서 캤는지가
   * 아니라 **이미 확정된 합**이어야 한다. 칸을 다시 조회하는 설계면 그 사이에 칸이
   * clearScenery로 사라졌을 때 지급액이 없어진다 — 이미 등에 진 짐이 사라지는 규칙은
   * 화면에서 설명되지 않는다. 짐은 캐는 순간 **값이 굳는다.**
   */
  carryGold: number;
  /**
   * 지금 지고 있는 짐의 **개수**. carryCap과 비교하는 값은 골드가 아니라 이것이다.
   *
   * 왜 골드로 못 대신하나: 짐값이 5~25로 제각각이라 골드로는 "몇 개 졌는가"를 복원할 수
   * 없다. 그리고 UI가 머리 위에 그리는 것도 개수(칩 1개/2개)다.
   */
  carryCount: number;
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
  /** 자원 칸 — **셀 키 오름차순 고정**. 목록은 안 변하고 taken만 변한다 */
  resources: readonly ResourceCellState[];
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
  /**
   * **두 타워의 자리를 맞바꾼다** (골드 소모). 사용자 요구로 '선두 우선' 버튼을 걷어내고
   * 그 자리에 들어온 조작이다:
   *   > "선두 우선 버튼은 별 필요 없는것 같아. 대신이 서로 위치 교환 할수 있도록 해줘.
   *   >  물론 비용을 내고 교환 해야지"
   *
   * 판 위의 자리는 이 게임에서 **되돌릴 수 없는 결정**이었다 — 잘못 놓으면 팔고(60% 환급)
   * 다시 세우는 길뿐이라 티어가 통째로 날아간다. 교환은 그 손실 없이 자리만 바꾼다.
   * ⚠ 종·티어가 달라도 된다. 바뀌는 것은 `cellX/cellZ` 둘뿐이고 HP·티어·투자금은
   *   **각자 따라간다**(타워가 이사하는 것이지 내용물이 바뀌는 것이 아니다).
   */
  | { type: 'swapTowers'; aId: number; bId: number }
  | { type: 'clearScenery'; cellX: number; cellZ: number } // 골드로 나무/바위 치우기
  | {
      /**
       * 마을에서 부족원 한 명을 뽑는다 (골드 소모, 정원 상한 있음).
       * 홈타운 **바로 앞** 집결 지점에 선다 — 어디로 보낼지는 moveAlly가 따로 정한다.
       * (9단계까지 있던 pathIndex는 사라졌다: 아군이 더 이상 경로 위를 걷지 않는다.)
       */
      type: 'trainAlly';
      defId: AllyId;
    }
  | {
      /**
       * 부족원에게 갈 곳을 지정한다 — 찍은 셀까지 **직선으로** 걸어가고,
       * 가는 길에 사거리에 든 적과 교전한다 (src/sim/allies.ts 규칙 2).
       *
       * 대상 고르는 법 세 가지:
       *  · allyId >= 0        → 그 한 명만
       *  · allyId -1 + defId  → **그 종족 전원** (판 위의 부족원을 탭했을 때의 동선)
       *  · allyId -1, defId 없음 → 살아 있는 전원
       *
       * 종족 단위가 기본인 이유(사용자 지시): "마을 부족을 아무나 선택하면 같은 종류는
       * 모두 선택되게 해서 원하는 블록을 찍으면 그곳으로 이동". 한 명씩 찍게 하면 급할 때
       * 여섯 번을 눌러야 하고, 전원 이동은 역할이 다른 종(몸으로 막는 근접과 뒤에서 쏘는
       * 원거리)을 같은 자리로 보내 버린다. **종족이 곧 역할**이라 그 단위가 맞다.
       *
       * 셀 범위 밖이거나 대상이 하나도 없으면 false. **찍을 수 있는 칸에 제한은 없다** —
       * 건설 불가 셀도, 경로 셀도, 적 스폰 지점도 지정할 수 있다(사용자 재정의).
       *
       * ── 채집 (docs/gather-spec.md) ────────────────────────────────────────
       * 찍은 칸에 **아직 안 턴 자원이 있으면** 대상은 그 칸으로 걸어가 도착 후 **캔다**.
       * 자원이 없거나 이미 텄으면 지금까지와 똑같이 그냥 가서 선다. 곧 이 커맨드의 의미는
       * 한 글자도 안 바뀌었고 **도착지에 뜻이 하나 붙었을 뿐**이다.
       *
       * ⚠ **자원 칸을 찍을 때 UI는 반드시 `allyId >= 0`(한 사람)으로 보낸다.**
       *   한 칸에 한 짐이라 종족 전원을 보내면 나머지가 헛걸음한다. 이 커맨드는 이미
       *   개체 지정을 지원하므로 새 커맨드가 필요 없다(placement.ts의 pickAllyAt이
       *   개체를 돌려준다). 빈 칸·경로를 찍으면 지금처럼 `allyId: -1 + defId`(종족 전원)다.
       *   sim은 그래도 방어한다 — 전원 명령이 자원 칸에 오면 **가장 낮은 id 한 명만**
       *   예약하고 나머지는 그냥 이동한다(규칙 E-9).
       *
       * 왜 gatherAlly라는 새 커맨드를 안 만들었나:
       *  · 잃는 능력이 없다 — 자원 칸에 파수꾼을 세워 길목을 막는 수는 그대로다.
       *  · 거부 사유가 안 늘어난다 — 이 커맨드는 격자 안이면 늘 성공한다. "채집꾼이 없다"는
       *    커맨드 반환값이 아니라 **탭 전 패널**이 말한다(battle.res.sendNone).
       *  · 커맨드 유니온이 안 늘어 determinism.test.ts의 SCRIPT와 e2e 훅이 그대로다.
       * 대신 자동화 방벽은 타입이 아니라 **테스트**가 진다 — 5.noGather 다리와
       * GATHER_SCRIPT 시나리오(docs/gather-spec.md §9).
       */
      type: 'moveAlly';
      allyId: number;
      cellX: number;
      cellZ: number;
      /** allyId가 -1일 때만 의미가 있다 — 이 종족만 움직인다 */
      defId?: AllyId;
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
      /** 이 개체의 **전체** 현상금. 도감·통계의 뜻은 그대로다 */
      bounty: number;
      /**
       * **이번 사망으로 실제로 들어온 골드** = 잔액. 살점 값이라 `bounty`와 다르다.
       * 생전 지급에는 할인이 걸려 있어(`BOUNTY_CHUNK_LIVE_NUM/DEN` = 2/3) 잔액이 크다 —
       * K=24인 trex(bounty 480)는 생전 상한이 `floor(480 × 2 × 23 / (3 × 24))` = **306**,
       * 곧 여기 오는 것은 **174**다. spino(240)는 153/87, mammoth(72·K=18)는 45/27이다.
       * (⚠ 이 주석은 폐기된 1/1 설계의 값 "20 / 460"을 적고 있었다. 배포되는 값은 2/3이고
       *  실측은 위와 같다 — 8.7배 틀린 숫자였다. 언제 밀렸는지는 불명이다)
       * 연출이 `+bounty`를 그리면 화면 합계가 실제 골드보다 커진다 = 플레이어에게 거짓말이다.
       */
      goldNow: number;
      /** 최대 체력 (웨이브 스케일 포함) — 대형/후반 적일수록 사망 폭발을 크게 */
      maxHp: number;
      /**
       * **문 앞에서 죽었다면** 그 자리에서 버틴 틱 수 (문간이 아니었으면 생략).
       * 여기 싣는 이유: 개체는 이 이벤트 뒤 같은 틱에 풀로 회수되므로 계측이 나중에
       * `gateTicks` 를 읽을 방법이 없다. 곧 이 필드가 문간 체류의 **유일한 확정 기록**이다.
       */
      gateTicks?: number;
    }
  | {
      /**
       * **뚫고 들어갔다** — 개체의 퇴장 사건(전원 공통). 문간이 켜져도 이 사건의 자리는
       * 그대로다: 문 앞에 선 적도 체류 상한에 닿으면 여기로 나간다(gate.ts 규칙 7).
       * 곧 `fx.ts` 의 `foeDef` 정리·오디오·계측이 종전 그대로 전원을 덮는다.
       */
      type: 'enemyLeaked';
      enemyId: number;
      defId: EnemyId;
      /**
       * 이 퇴장이 **실제로 청구한** 마을 HP = `EnemyState.gateOwed` 의 잔액.
       * 문간을 한 번도 안 거쳤으면 `baseDamage` 그대로이고(종전과 동일),
       * 문 앞에서 전액을 다 물었으면 **0** 이다(그때는 `baseDamaged` 가 따라오지 않는다).
       */
      baseDamage: number;
      /**
       * 누수로 **몰수된** 미지급 현상금. 살점 값에서 총 지급액이 움직이는 유일한 자리가
       * "이미 받은 몫"이므로, 그 반대편인 이 값이 계측의 잣대다
       * (`Σgold − Σ처치bounty − 웨이브보상 − 조기호출 = Σ(bounty − forfeited)`).
       */
      forfeited: number;
    }
  | { type: 'bossSpawned'; enemyId: number; defId: EnemyId }
  | {
      /**
       * **적이 문 앞에 섰다** — 정지선에 도달해 걸음을 멈추고 마을과 마주 본다.
       * 개체당 정확히 한 번 나간다. **종을 안 가린다** — 보스도 잡졸도 공중도 같다
       * (gate.ts 규칙 1·9. 사용자 요구 "모두 통일"). 이름이 `bossAtGate` 가 아닌 이유다.
       *
       * 끝나는 사건은 둘이다: `enemyDied`(죽었다) 또는 `enemyLeaked`(뚫고 들어갔다).
       * HUD 의 문간 띠와 연출의 대치 링이 켜지는 신호다.
       */
      type: 'enemyAtGate';
      enemyId: number;
      defId: EnemyId;
      /** 문 앞 좌표 (마을 중심에서 `GATE_STANDOFF_EDGE + radius`) */
      x: number;
      z: number;
      /** 이 개체가 앞으로 물 총액 = 남은 입 수. HUD 가 "N 입 남음"을 미리 그린다 */
      owed: number;
      /** 이 개체의 체류 상한(틱) — HUD 가 "언제 뚫고 들어오나"를 그릴 수 있다 */
      holdTicks: number;
    }
  | {
      /**
       * **한 입** — 문 앞의 적이 마을을 물었다. 바로 뒤에 `baseDamaged` 가 따라온다.
       * 순서는 `raidAttack` → `towerDamaged` 와 같은 규약이다(siege.ts fireAtTower):
       * **무는 것이 먼저이고 깎이는 것이 나중**이라야 연출이 인과대로 읽는다.
       *
       * `baseDamaged` 만으로는 누수와 구분할 수 없어 따로 둔다 — 누수는 적이 사라지지만
       * 한 입은 무는 자가 그대로 서 있어서 연출(지붕 파편·마을 흔들림)이 달라야 한다.
       */
      type: 'gateBite';
      enemyId: number;
      defId: EnemyId;
      /** 실제로 깎은 마을 HP — 언제나 `GATE_BITE_AMOUNT`(=1)다 */
      amount: number;
      x: number;
      z: number;
      /** 이 한 입 뒤 남은 잔액 (0이면 이 개체는 더 안 문다) */
      owed: number;
      /** 이 한 입 시점의 누적 문간 체류 틱 */
      gateTicks: number;
    }
  | { type: 'towerPlaced'; towerId: number; defId: TowerId; cellX: number; cellZ: number }
  | { type: 'towerUpgraded'; towerId: number; defId: TowerId; tier: number }
  /**
   * 두 타워가 자리를 맞바꿨다. 좌표는 **바꾼 뒤**의 값이다 —
   * 연출(render/game/fx.ts)이 그대로 다시 심으면 된다.
   */
  | {
      type: 'towersSwapped';
      aId: number; aDefId: TowerId; aTier: number; aCellX: number; aCellZ: number;
      bId: number; bDefId: TowerId; bTier: number; bCellX: number; bCellZ: number;
      cost: number;
    }
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
      /** 마을에서 부족원이 나왔다 — 홈타운 바로 앞 집결 지점에서 스폰 */
      type: 'allyTrained';
      allyId: number;
      defId: AllyId;
      /** 실제로 지불한 골드 */
      cost: number;
      /** 스폰 위치 (= 홈타운 앞 집결 지점) */
      x: number;
      z: number;
    }
  | {
      /** 부족원에게 갈 곳을 지정했다 — 목표 표식 연출용 */
      type: 'allyOrdered';
      /** 명령을 받은 인원 수 (전원 이동이면 2 이상일 수 있다) */
      count: number;
      /** 목표 셀 */
      cellX: number;
      cellZ: number;
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
      /**
       * **마법사가 고쳤다** (`AllyDef.heal`, src/sim/heal.ts).
       * 연출이 "누가 무엇을 얼마나" 를 이 하나로 다 읽을 수 있게 싣는다.
       *
       * ⚠ `amount` 는 **실제로 되돌아간 양**이다(요청한 양이 아니다). 만피 근처거나
       *   마을 상한(ALLY_HEAL_BASE_CAP_FRAC)에 걸리면 요청보다 작다 — 화면에 뜨는
       *   "+N" 이 실제 회복량과 어긋나면 그건 화면이 거짓말을 하는 것이다.
       *   (enemyDied 의 goldNow 가 bounty 가 아닌 것과 같은 논거)
       */
      type: 'allyHealed';
      allyId: number;
      /** 무엇을 고쳤나 — 마을이면 'base', 타워면 'tower' */
      targetKind: 'tower' | 'base';
      /** 타워면 그 타워 id, 마을이면 -1 */
      towerId: number;
      amount: number;
      hpLeft: number;
      maxHp: number;
      /** 고쳐진 것의 자리 (셀 좌표) */
      cellX: number;
      cellZ: number;
    }
  // --- 채집 (src/sim/gather.ts) ----------------------------------------------
  | {
      /**
       * 도착해서 캐기 시작 — 발밑 채집 게이지가 여기서 켜진다.
       * 골드는 안 낸다(D3: 지급은 배달뿐).
       *
       * ⚠ **이번 예약에서 딱 한 번만 나간다.** 순진하게 짜면 `gatherTicks === 0`마다
       *   나가는데, 전선 옆 칸(s1 40칸 중 22칸)에서는 맞을 때마다 진행분이 0으로
       *   돌아가므로(D5) `BRAWL_COOLDOWN_TICKS = 30` 간격으로
       *   **`gatherLost{'hit'}` + `gatherStarted`가 쌍으로** 나간다 — 적 셋이 붙으면 초당 6건이다.
       *   센티널: `a.gatherHpMark === 0`이면 "이번 예약에서 아직 시작 안 함"이다
       *   (중단 시에는 gatherHpMark를 새 hp로 다시 채우므로 0이 아니다). 필드가 안 는다.
       */
      type: 'gatherStarted';
      allyId: number;
      defId: AllyId;
      cellX: number;
      cellZ: number;
      kind: ResourceId;
      /** 이 칸의 짐값 (배지와 같은 숫자) */
      value: number;
      /** 이 사람이 이 칸을 캐는 데 걸리는 총 틱 — 렌더가 게이지 분모로 쓴다 */
      ticks: number;
    }
  | {
      /**
       * **짐 하나를 등에 졌다** = 칸이 텄다. 두 사건이 같은 순간이라 한 이벤트다.
       * ⚠ **여기서 골드가 나가지 않는다.** 마을까지 지고 와야 지급된다(D3).
       *   fx는 이 이벤트에 "짐을 짊어지는" 연출만 붙이고 코인 팝업은 안 띄운다 —
       *   안 그러면 배달 전에 죽었을 때 화면이 거짓말을 한 것이 된다.
       *
       * 발행 빈도 상한 = 정원 6 × (30 / 최소 실제틱 120) = 초당 1.5건. sim 쪽 스로틀 불필요.
       * (gatherStarted는 다르다 — 위 각주의 스로틀이 **필수**다.)
       */
      type: 'gathered';
      allyId: number;
      defId: AllyId;
      cellX: number;
      cellZ: number;
      kind: ResourceId;
      /** 이번에 진 짐의 값 */
      value: number;
      /** 진 뒤의 짐 개수 / 이 사람의 상한 — 가득 찼으면 자동 귀환이 시작된 것이다 */
      carried: number;
      carryCap: number;
    }
  | {
      /**
       * **마을에 닿아 지급됐다** — 채집이 골드를 내는 **유일한** 사건.
       * addGold 수입 호출부가 이것으로 정확히 4곳이 된다
       * (combat.ts · battle.ts 둘 · gather.ts). 5번째를 만들지 마라.
       */
      type: 'gatherDelivered';
      allyId: number;
      defId: AllyId;
      /** 지급액 (정수) = 지고 있던 짐값의 합 */
      gold: number;
      /** 몇 짐이었나 (1 또는 carryCap) */
      loads: number;
      x: number;
      z: number;
    }
  | {
      /**
       * 채집이 **명령 없이** 어긋났다. 사유는 넷:
       *  · 'hit'     — 맞아서 캐던 진행분이 0으로 돌아갔다 (D5). 짐과 예약은 **유지된다**
       *  · 'moved'   — 다른 칸으로 가는 moveAlly가 왔다 (예약 해제, 진행분 폐기)
       *  · 'cleared' — 그 칸이 골드로 치워졌다 (clearScenery)
       *  · 'died'    — 짐을 진 채 죽었다. gold에 잃은 액수가 실린다
       * **'gone'(남이 먼저 캤다)는 없다** — 예약이 배타적이라 구조적으로 일어나지 않는다.
       *
       * ⚠ 'hit'는 맞을 때마다 나가지 않는다 — **진행분이 0보다 컸을 때만** 나간다.
       *   그래야 전선에 세워 둔 사람이 초당 여러 건을 뿜지 않는다.
       */
      type: 'gatherLost';
      allyId: number;
      defId: AllyId;
      cellX: number;
      cellZ: number;
      reason: 'hit' | 'moved' | 'cleared' | 'died';
      /** 'died'면 잃은 골드, 아니면 0 */
      gold: number;
    }
  | {
      /**
       * **다 캔 칸이 다시 자랐다** (R2). 소품 메시가 그 자리에 되살아나고 그 칸은 다시
       * 건설 불가가 된다. 골드는 한 톨도 안 낸다 — 이건 수입이 아니라 지형 사건이다.
       *
       * ⚠ **이름이 `gather` 로 시작해야 한다.** `tests/sim/botharness.ts` 의 방치 계측이
       *   `ev.type.startsWith('gather')` 로 채집 이벤트를 세고, 봉투 `18.idleZero` 가
       *   "방치 판은 채집 이벤트 0건"을 그 카운터로 계약한다. 이름을 `resourceRegrown`
       *   으로 지으면 **"방치 판은 재생도 0건"이라는 확인이 조용히 사라진다** —
       *   재생이 방치 판에서 도는지 여부가 아무 다리에도 안 걸리게 된다.
       *
       * 종·값은 생성 시 굳은 것 그대로다(R2: 종을 다시 뽑지 않는다). fx 는 한 틱에
       * 여러 건이 올 수 있으므로 소리를 합쳐야 한다 — 같은 틱에 캔 칸들은 같은 틱에 자란다.
       */
      type: 'gatherRegrown';
      cellX: number;
      cellZ: number;
      kind: ResourceId;
      /** 이 칸의 짐값 — 재생해도 **같은 값**이다(R2) */
      value: number;
    }
  /*
   * ── gatherOrdered 는 **만들지 않는다** ────────────────────────────────────
   * moveAlly가 이미 allyOrdered를 낸다 — 목표 표식은 그 이벤트가 그대로 세우고,
   * 찍은 칸이 자원 칸이면 색만 바꾼다(gather-spec §7-2).
   */
  /*
   * ── allyRetired 는 삭제됐다 (9단계) ────────────────────────────────────────
   * 수명이 사라져 "돌아가는" 사건 자체가 없다. 부족원이 사라지는 길은 이제 하나뿐이다:
   * 맞아 죽는 것(allyDied). 귀환 환급(ALLY_RETIRE_REFUND)도 같이 없어졌다 —
   * 돌아오지 않는 사람에게 삯을 돌려줄 수 없다.
   */
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
  | {
      /**
       * **살점 값** — 큰 적이 죽기 전에 낸 한 몫. bounty의 일부이지 덤이 아니다
       * (몫 합계 + `enemyDied.goldNow` = 정확히 bounty). 사망 지급은 이 이벤트가
       * 아니라 `enemyDied.goldNow`가 나른다 — 한 사건에 둘을 겹치면 팝업이 두 번 뜬다.
       *
       * 발행 빈도는 틱이 아니라 **몫 경계**가 정한다: 개체당 최대 `chunks−1` = 23회다.
       * 잡몹이 이 이벤트를 내는지는 **골드 상한 `floor(bounty / BOUNTY_CHUNK_MIN_GOLD)`가
       * 아니라 덩치 상한이 정한다** — 실측 골드 상한은 compy 1 · raptor 2 · blade 4 ·
       * archer 5이고(bounty 4 / 8 / **16** / **21**), 그중 K=1이 확정인 것은 **compy뿐**이다.
       * 나머지 셋은 같은 웨이브의 중앙 HP보다 덩치가 두 배 이상일 때만 몫이 생긴다
       * (제 무리와 함께 나오면 `round(maxHp/refHp)` = 1이라 오늘과 같은 경로를 탄다).
       * (⚠ 이 주석은 "잡몹은 K=1이라 평생 한 번도 안 낸다 · blade 15"라고 적고 있었다 —
       *  bounty 값도 틀렸고(blade 16 · archer 21) K의 근거도 틀렸다. 언제 밀렸는지는 불명)
       * 최악(w50, 동시 30마리)에도 초당 약 6건으로 `enemyDamaged`보다 두 자릿수 적다 —
       * sim 쪽 스로틀이 필요 없는 이유다.
       */
      type: 'bountyChunk';
      enemyId: number;
      defId: EnemyId;
      x: number;
      z: number;
      /** 이번에 들어온 골드 (정수, ≥1) */
      gold: number;
      /** 지금까지 뗀 몫 / 전체 몫 — 마지막 몫일수록 크게 그리는 연출 강도에 쓴다 */
      chunk: number;
      chunks: number;
    }
  | { type: 'statusApplied'; enemyId: number; kind: StatusKind }
  /**
   * 정화가 상태이상을 벗겼다 (`EnemyDef.purge`). **연출이 필요해서 내는 이벤트다** —
   * 회복(healAura)은 이벤트 없이 hp만 올리지만, 정화는 화면에 안 보이면
   * "주술사를 먼저 잡아라"가 영영 학습되지 않는다. 이 축의 존재 이유가 가독성이다.
   */
  | { type: 'statusPurged'; enemyId: number; kind: StatusKind }
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
  /**
   * 잠금 무시하고 6개 스테이지 + 무한 모드를 전부 연다 (기본 false).
   * **진행도는 건드리지 않는다** — stages[].cleared/bestWave는 그대로 두고
   * isStageUnlocked/isEndlessUnlocked의 판정만 우회한다. 그래서 껐다 켜도
   * 클리어 기록이 손상되지 않는다.
   * 옛 세이브에는 이 키가 아예 없다 → profile.normalize()가 false로 못박는다.
   */
  unlockAll: boolean;
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
  /** 타워 두 기의 자리를 맞바꾸는 값 (정액 — balance.TOWER_SWAP_COST) */
  swapCost(): number;
  /** 그 셀에 아직 치우지 않은 소품(나무/바위)이 있는가 */
  hasScenery(cellX: number, cellZ: number): boolean;
  /** 자원 칸 조회 — 소품이 없거나 격자 밖이면 null. HUD 패널과 e2e 훅이 쓴다 */
  resourceAt(cellX: number, cellZ: number): ResourceCellState | null;
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
  /**
   * 지금 마을이 허용하는 부족원 정원 — 마을 패널 표기와 출동 버튼 비활성 판정이 같은 값을 쓴다.
   * 9단계에 allySortieRange()/allySortiePoints()를 대신해 들어왔다: 아군이 판 위 아무 데나
   * 갈 수 있게 되면서 "얼마나 멀리"가 팔 것이 없어졌고 "몇 명"이 그 자리를 받았다.
   */
  allyCap(): number;
  /**
   * 다음 레벨이 주는 최대 HP/공격력/사거리/부족원 정원 (최대 레벨이면 null).
   * 비가역 결제라 "무엇을 사는가"가 확인 단계 **전에** 보여야 한다.
   */
  baseNextStats(): { hpMax: number; dmg: number; range: number; allyCap: number } | null;
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
  /**
   * 지금 고른 부족 종족 (없으면 null). 판 위의 부족원을 탭하면 **그 종 전체**가 고르고,
   * 다음 셀 탭이 이동 명령이 된다 — 사용자 지시로 9단계의 '이동 명령 버튼'을 대신한다.
   * HUD는 이 값으로 "누구를 고르고 있는지"만 표시한다(조작은 전부 판 위에서 일어난다).
   */
  selectedAlly?(): AllyId | null;
  /** 부족 선택 해제 — 패널을 닫거나 다른 것을 고를 때 */
  clearAllySelection?(): void;
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
