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
  /** 메타 별 1개당 보너스 (별 0~5) */
  starBonus: { dmgPct: number; ratePct: number; rangePct?: number };
  unlock: TowerUnlock;
  /** 별 업그레이드 비용: 별 n(1~5)이 되기 위한 [조각, 호박] */
  starCosts: [shards: number, amber: number][];
}

// ---------------------------------------------------------------------------
// 적 정의
// ---------------------------------------------------------------------------
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
}

export interface TowerState {
  id: number;
  defId: TowerId;
  /** 0-base 티어 (0~4) */
  tier: number;
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
  | { type: 'enemyDied'; enemyId: number; defId: EnemyId; x: number; z: number; bounty: number }
  | { type: 'enemyLeaked'; enemyId: number; defId: EnemyId; baseDamage: number }
  | { type: 'bossSpawned'; enemyId: number; defId: EnemyId }
  | { type: 'towerPlaced'; towerId: number; defId: TowerId; cellX: number; cellZ: number }
  | { type: 'towerUpgraded'; towerId: number; defId: TowerId; tier: number }
  | { type: 'towerSold'; towerId: number; refund: number }
  | { type: 'towerFired'; towerId: number; defId: TowerId; targetId: number }
  | {
      type: 'projectileHit';
      towerDefId: TowerId;
      x: number;
      z: number;
      splash: boolean;
    }
  | {
      type: 'beamFired';
      towerId: number;
      defId: TowerId;
      /** 체인 경유점 (타워 → 적1 → 적2 ...) */
      points: { x: number; z: number; flying: boolean }[];
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
  version: string;
}
