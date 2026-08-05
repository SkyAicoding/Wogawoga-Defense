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
  | 'blade' // 칼잡이 (근접 속공)
  | 'lancer' // 창잡이 (한 칸 밖에서 찌르는 방어형)
  | 'archer' // 궁수 (뒤에서 쏘는 유리대포)
  | 'hexer' // 주술사 (저주로 타워를 침묵시킨다)
  | 'mammoth' // 매머드 (대형 탱커)
  | 'spino' // 스피노사우루스 (미니보스)
  | 'trex' // 티라노사우루스 (보스)
  | 'golem'; // 화산 골렘 (화산 전용)

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
   * 때리는 동안 전진을 멈추는가.
   * 규약: 근접(칼·창)은 true — 멈춰 서서 두들긴다. 원거리(활·주술)는 false — 걸으며 쏜다.
   */
  stopToAttack: boolean;
  /**
   * 원거리 공격인가 (연출 분기용 — 투척물/주문 궤적 유무).
   * 시뮬레이션 판정에는 쓰이지 않고 towerDamaged 이벤트에 그대로 실려 나간다.
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
  /** 웨이브젠 예산 비용 (전투력 지표) */
  cost: number;
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
   * 지금 때리고 있는 타워 id (-1 = 없음). 렌더가 공격 모션/방향에 쓴다.
   * stopToAttack 유닛은 이 값이 0 이상인 동안 전진을 멈춘다.
   */
  towerTargetId: number;
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
  /** prep 카운트다운 남은 틱 */
  prepTicksLeft: number;
  /** 지금 callWave 시 받을 조기 호출 보너스 골드 (prep 아닐 땐 0) */
  earlyCallBonusGold: number;
  hand: CardState[];
  refreshCost: number; // 0이면 무료
  enemies: readonly EnemyState[];
  towers: readonly TowerState[];
  projectiles: readonly ProjectileState[];
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
      source: TowerId | StatusKind;
      shielded: boolean;
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
  /** 선택된 소품 셀 제거 요청 (골드 부족/미선택이면 무시) */
  requestClearScenery(): void;
  /**
   * 선택(타워/소품)을 해제한다 — 패널의 닫기 버튼용.
   * 패널이 그 셀을 덮으면 "같은 셀 재탭으로 닫기"가 물리적으로 불가능하므로
   * UI 쪽에 명시적인 해제 경로가 필요하다.
   */
  clearSelection(): void;
  requestSetTargeting(mode: TargetingMode): void;
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
