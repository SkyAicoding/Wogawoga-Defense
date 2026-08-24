/**
 * 봉투 기반 시설 — **표본 정책 · 짝 통계 · 캐시 신원 · 원장**을 한 곳에 둔다.
 *
 * 이 파일이 생긴 이유는 하나다. 옛 봉투(autoplay.test.ts)는 시드 상수를 세 개 들고 있었고
 *   SEEDS   = 1000 + 37i (20개)
 *   SEEDS40 = 1000 + 37i (40개)
 *   SEEDS80 = 1000 + 37i (80개)
 * **셋이 한 수열의 앞부분**이라 `SEEDS ⊂ SEEDS40 ⊂ SEEDS80`이었다. 곧 "20시드 항목"과
 * "80시드 항목"이 문자 그대로 **같은 판**을 봤다. 표본을 20 → 80으로 늘려도 독립성은
 * 한 톨도 늘지 않고 같은 판을 더 오래 볼 뿐이며, 한 항목을 고치려고 게임을 만지면
 * 같은 시드를 보는 다른 항목이 함께 흔들린다. 17개 중 15개가 시작점 1000 한 블록
 * 안에서만 살았다.
 *
 * 그래서 시드 상수를 항목마다 손으로 만드는 구조 자체를 없앤다. 항목은 **창(Win)** 이름
 * 하나만 고르고, 실제 시드는 여기서만 만들어진다.
 *
 * ── 규약 (WINDOWS 표와 tests/sim/autoplay.test.ts 의 메타 it 이 강제한다) ──────────
 *  1. 시드는 **독립 블록 4벌** 1000 / 2000 / 5000 / 9000 에서 공차 37로 뽑는다.
 *     항목 14가 이미 쓰던 축이라 새 숫자를 고르지 않았다 — 고를 여지가 없어야 표본이 정직하다.
 *  2. 각 스윕은 **창(시작 인덱스 off, 블록당 개수 per)** 을 독점한다. 창이 다르면 시드가
 *     겹치지 않고, 창이 같으면(= `pairOf`) 그건 **짝 비교라서 공유가 필수인 자리**다.
 *  3. 접두 중첩(같은 통계량을 서로 다른 크기로 재는 것)은 **금지**다. 메타 it 이 검사한다.
 *  4. 캐시 키는 시드 집합의 **신원**(길이·양끝·롤링 해시)과 **데이터 패치 id** 를 들고 있다.
 *     옛 키는 `n${seeds.length}` 로 길이만 봤다 — "같은 길이 ⇒ 같은 시드"가 접두 구조
 *     덕에 우연히 참이었기 때문에 안 터졌을 뿐이고, 이 재설계는 같은 길이의 서로 다른
 *     창(unit 80 · base600 80 · l2 80)을 반드시 만든다. 키를 안 고치면 두 번째 호출이
 *     첫 번째 결과를 조용히 돌려받아 **전 항목이 남의 표본으로 초록**이 된다.
 *
 * ── 왜 네 블록이 절대 겹치지 않는가 (증명) ──────────────────────────────────────
 * 두 시작점 차 d ∈ {1000, 3000, 4000, 7000, 8000} 중 37의 배수가 하나도 없다
 * (1000 = 37·27+1 · 3000 = 37·81+3 · 4000 = 37·108+4 · 7000 = 37·189+7 · 8000 = 37·216+8).
 * 곧 b + 37i = b′ + 37j 는 해가 없다. 이 증명의 실행판이 메타 it 에 있다.
 *
 * ── 왜 인접 시작점(1000/1001/1002/1003)을 폐기했는가 ────────────────────────────
 * 옛 11번(정원 곡선)이 그 4벌을 썼는데, 실측이 그 설계를 반증한다: 같은 항목의 봉쇄비가
 * 1000벌 1.6511 대 1001벌 1.0516 으로 **이웃 시드 하나 차이에 0.60이 갈린다**(옛 구조의
 * 실측이라 이 트리에서는 재현할 창이 없다 — 그래서 원장이 아니라 여기 이력으로만 남긴다).
 * 곧 분산의 근원은 블록이 아니라 몇 개의 극단 시드이고, 인접 4벌 합산은 분산을 줄이지
 * 못하면서 좁아 보이게만 만든다(합산 1.264 = 문턱 1.25 위로 여유 0.014).
 * 독립 4블록으로 흩으면 같은 문턱에서 ⟦원장 11b.blocked = 1.4720⟧ — **문턱을 한 자리도
 * 안 건드리고 여유가 0.014 → 0.222 로 자릿수가 달라진다**.
 * ⚠ 여기 적힌 `⟦원장 …⟧` 는 장식이 아니라 **검사되는 인용**이다. 원장 값과 어긋나면
 *   autoplay.test.ts 의 '기록 인용' 메타 it 이 빨개진다(이 파일이 반복해서 걸린 병의 처방).
 */
import type {
  AllyDef,
  AllyId,
  BaseLevelDef,
  BattleSim,
  EnemyDef,
  EnemyId,
  StageDef,
  TowerDef,
  TowerId,
} from '@/data/types';
import { ALLY_DEFS, BASE_LEVELS, ENEMY_DEFS, TOWER_DEFS, stageById } from '@/data';
import { makeBotSimFor, runBot, type BotOptions, type BotResult } from './botharness';

// ═══════════════════════════════════════════════════════════════════════════
// 1. 표본 정책 — 블록과 창
// ═══════════════════════════════════════════════════════════════════════════

/** 독립 블록의 시작점. 항목 14가 이미 쓰던 축을 전 항목의 표준으로 승격했다 */
export const BLOCKS = [1000, 2000, 5000, 9000] as const;
/** 공차 — 고를 여지가 없어야 표본이 정직하다 (옛 봉투부터 이어지는 값) */
export const STRIDE = 37;

export interface Win {
  /** 블록 안에서의 시작 인덱스 — 창끼리 이 구간이 겹치면 접두 중첩이다 */
  readonly off: number;
  /** 블록당 시드 수 */
  readonly per: number;
  /** 쓰는 항목 (메타 it 의 실패 메시지에 그대로 실린다) */
  readonly use: string;
  /**
   * **짝**: 이 창은 다른 창과 같은 시드를 일부러 공유한다. 짝지음이 블록 간·시드 간
   * 분산을 통째로 소거하는 것이 이 설계의 검출력 원천이라, 두 팔을 비교하는 자리에서는
   * 공유가 금지가 아니라 **필수**다. 여기 적힌 것만 허용되고 나머지는 메타 it 이 막는다.
   */
  readonly pairOf?: string;
  /** 쓰는 블록 수 (기본 4). 자기완결 다리처럼 판별력이 표본에 안 걸리는 자리만 줄인다 */
  readonly blocks?: number;
}

/**
 * **창 대장** — 접두 중첩을 규약이 아니라 구조로 막는다.
 *
 * 읽는 법: `off` 는 블록 안의 시작 인덱스, `per` 는 블록당 개수다. 곧 이 창의 시드는
 * 각 블록 b 에 대해 `b + 37·(off .. off+per-1)` 이다. `pairOf` 가 있으면 그 창의
 * 구간 안에 들어 있어야 하고(= 같은 판을 밟는다), 없으면 다른 어떤 창과도 겹치면 안 된다.
 */
export const WINDOWS = {
  // ── 기준선 실험대 (한 실험의 세 축이라 시드를 공유한다. 아래 SHARED_NOTE 참조) ──
  base1: { off: 0, per: 40, use: '[1-a] 완주 하한 · [2] 습격대 파괴 · [3] 죽음의 나선' },
  cal: { off: 0, per: 20, pairOf: 'base1', use: '교정 팔(stars 1) — 술어의 검출력을 매 실행 증명' },
  collapse: { off: 0, per: 20, pairOf: 'base1', use: '붕괴 팔(밀착+수리포기) — [1-a][2][3] 판별력' },
  hug: { off: 0, per: 20, pairOf: 'base1', use: '[4] 밀착 배치 (기준선 팔과 짝)' },
  // ── 최강 팔 ──
  strong: { off: 40, per: 40, use: '[1-b] 난이도 상한 · [4] 최강 대조' },
  /**
   * ⚠ **off 40 → 60 으로 옮겼다** (2026-08 · 짝 서로소 검사 신설). 옛 자리에서는
   * `strongCal`(40..49) 이 `strongHug`(40..59) 의 **앞부분**이었다 — 크기가 다른 두 창이
   * 같은 시작점에서 겹치는 것은 이 파일이 없애려는 접두 중첩(`SEEDS ⊂ SEEDS40`)의
   * 정확한 재발인데, 짝 검사가 "짝 상대(strong) 안에 들어 있는가"만 보느라 통과하고 있었다.
   * 이제 메타 it 이 **같은 짝 상대를 공유하는 창끼리도** 서로소이거나 완전히 같기를 요구한다.
   */
  strongCal: { off: 60, per: 10, pairOf: 'strong', use: '[1-b] 대조 팔(최강 + stars 1)' },
  strongHug: { off: 40, per: 20, pairOf: 'strong', use: '[4] 최강 + 밀착' },
  // ── 갈래 실험대 (공통 대조군 = Dunnett 형. 짝이라 시드를 공유한다) ──
  l2: { off: 80, per: 20, use: '[6][7][10] 공통 대조 벤치(타워 기준선)' },
  dozer: { off: 80, per: 20, pairOf: 'l2', use: '[6] 불도저 = [7] 지형 갈래' },
  unit: { off: 80, per: 20, pairOf: 'l2', use: '[7] 유닛 갈래' },
  base600: { off: 80, per: 20, pairOf: 'l2', use: '[7] 기지 갈래(예비비 600)' },
  baseNat: { off: 80, per: 20, pairOf: 'l2', use: '[7] 기지 갈래(자연)' },
  tribe: { off: 80, per: 20, pairOf: 'l2', use: '[10] 부족 갈래' },
  allIn: { off: 100, per: 5, use: '[7] 몰빵 두 팔' },
  // ── 아군 실험 ──
  ally: { off: 110, per: 20, use: '[8] 진짜/위약 아군' },
  tribeSelf: { off: 130, per: 20, blocks: 1, use: '[8] 부족 팔 자기완결 다리(구조적 참)' },
  town: { off: 150, per: 15, use: '[9] 마을 화력 진짜/위약' },
  /**
   * ⚠ 이 창이 이 파일에서 **가장 커야 하는 창**이다. 봉쇄비는 "그 판이 얼마나 위급했는지"를
   * 주로 재므로 꼬리가 두껍고, 같은 문턱에서 창을 옮기면 값이 크게 흔들린다. 실측:
   *   블록당 16 → 봉쇄비 1.242 / 1.532 / 1.503 (창 off 160 / 220 / 300)
   *   블록당 40 → 봉쇄비 **1.329 / 1.395 / 1.534** — 세 창 모두 문턱 1.25 위
   * 곧 필요한 것은 **창을 고르는 것이 아니라 표본을 넓히는 것**이다. 창은 처음 선언한
   * 자리에 그대로 두고 per 만 16 → 40 으로 올렸다(창을 결과 보고 고르면 그게 곧 이 파일이
   * 없애려는 병이다). 여기서 줄이면 판정이 다시 창 운에 걸린다.
   */
  cap: { off: 170, per: 40, use: '[11-b] 정원 2 / 정원 6' },
  stance: { off: 210, per: 20, use: '[12] home / front' },
  endless: { off: 230, per: 6, use: '[13] 무한 모드 3팔' },
  marginal: { off: 240, per: 30, use: '[14] 아군의 한계 가치' },
  s6: { off: 270, per: 3, use: '[5-b] 스테이지6 · [17] 불도저 s6 · 서열 대조' },
  idle: { off: 280, per: 3, use: '[5] 방치' },
  capDet: { off: 290, per: 1, use: '[11-a] 결정론 정원 곡선' },
} as const satisfies Record<string, Win>;

export type WinName = keyof typeof WINDOWS;

/**
 * **선언된 공유** — 서로 다른 항목이 같은 창을 읽는 자리. 메타 it 이 이 목록과
 * 실제 사용을 대조한다. 여기 없는 공유가 생기면 그건 사고다.
 *
 * 허용 규칙(1안에서 가져왔다):
 *  · 허용1 — **같은 it 안의 두 팔**: 짝지음이 필수인 자리.
 *  · 허용2 — 같은 정책·같은 창을 여러 it 이 **서로 다른 통계량**으로 읽기
 *    ([1-a] 완주율 · [2] 판당 파괴 · [3] minTowers 분위). 코드에서 하나의 창 이름을
 *    명시 참조한다 — 캐시가 우연히 맞아떨어지는 형태는 금지.
 *  · 허용3 — 공통 대조군(Dunnett 형): [6][7][10] 이 벤치 하나를 공유한다.
 *  · **금지** — 같은 통계량을 서로 다른 크기로 재는 접두 중첩(옛 SEEDS ⊂ SEEDS40 ⊂ SEEDS80).
 */
export const SHARED_NOTE: Readonly<Record<string, string>> = {
  base1: '[1-a][2][3] — 같은 스윕의 서로 다른 축(허용2). 게임을 만지면 셋이 함께 흔들린다',
  l2: '[6][7][10][18] — 공통 대조 벤치(허용3). Bonferroni 가 그 상관을 보수적으로 흡수한다. [18] 의 채집 갈래도 같은 벤치에 붙는다 — 갈래마다 벤치를 새로 뽑으면 갈래끼리 비교가 안 된다',
  strong: '[1-b][4][18] — 최강 팔 하나를 상한 항목·밀착 대조·채집 최악 팔이 함께 읽는다(허용2). [18] 은 같은 판에 채집을 얹어 짝으로 잰다',
  allIn: '[7][18] — 몰빵 팔들이 창 하나를 나눠 쓴다(허용2). "한 갈래에 전부 태우면 무너진다"를 갈래마다 같은 판에서 묻는다',
  idle: '[5][18] — 방치 팔 하나를 방치 계약과 **채집 수입 0** 전제가 함께 읽는다(허용2). 같은 12판이라 [5] 의 골드 다리와 [18] 의 0 전제가 같은 사실의 두 면이 된다',
  s6: '[5-b][17] — 스테이지6 팔 하나를 별0 서열과 불도저 서열이 함께 읽는다(허용1: 17번이 5-b 의 팔을 짝 상대로 쓴다)',
};

/** 실행 프로파일 — 봉투는 FULL, 대조군 스위트는 표본을 줄여 옵트인으로 돈다 */
export interface Profile {
  readonly name: string;
  /** 쓸 블록 수 상한 */
  readonly blocks: number;
  /** 블록당 개수 배율 */
  readonly scale: number;
}
export const FULL: Profile = { name: 'full', blocks: 4, scale: 1 };
/**
 * 대조군 fast 등급 — **블록 둘, 블록당 개수는 그대로**.
 * 왜 블록당 개수를 안 줄이는가: 방향 다리는 짝 부호검정이라 검출력이 시드 수가 아니라
 * **불일치 쌍 수**에서 나온다. 개수를 반으로 줄이면 불일치 쌍도 반이 되어 α = 0.05/L
 * 을 못 넘고, 그러면 되돌리기가 실제로 지배 전략인데도 **다리가 발화하지 않는다**
 * (= 판별력 스위트가 스스로 거짓 음성을 만든다). 그래서 줄이는 것은 블록 수뿐이다.
 */
export const FAST: Profile = { name: 'fast', blocks: 2, scale: 1 };

const winOf = (name: WinName): Win => WINDOWS[name];

/**
 * **창 사용 계측** — `WINDOW_USE` 표를 손으로 맞추지 않고 **실제 사용에서 강제**한다.
 *
 * 옛 구조에서 `WINDOW_USE` 는 사람이 적는 표였고, 항목이 창을 하나 더 읽어도(또는 안 읽어도)
 * 아무도 몰랐다 — 곧 "선언된 공유와 실제 공유가 같다"는 메타 it 이 **선언끼리** 비교하는
 * 셈이었다. 이제 봉투가 항목을 이 컨텍스트 안에서 돌리고, 메타 it 이 관측된 집합과 표를
 * 정확 일치로 대조한다. 표를 안 고치고 창을 하나 더 읽으면 빨개진다.
 */
let activeItem: string | null = null;
const observed = new Map<string, Set<WinName>>();
export function withItem<T>(id: string, f: () => T): T {
  const prev = activeItem;
  activeItem = id;
  try {
    return f();
  } finally {
    activeItem = prev;
  }
}
/** 그 항목이 실제로 읽은 창 (정렬) — 관측이 없으면 빈 배열 */
export function observedWindows(id: string): WinName[] {
  return [...(observed.get(id) ?? [])].sort();
}
export function observedItems(): string[] {
  return [...observed.keys()].sort();
}

/** 창 × 프로파일 → 블록별 시드 배열 */
export function seedBlocks(name: WinName, prof: Profile = FULL): number[][] {
  if (activeItem !== null) {
    const set = observed.get(activeItem) ?? new Set<WinName>();
    set.add(name);
    observed.set(activeItem, set);
  }
  const w = winOf(name);
  const nb = Math.min(w.blocks ?? BLOCKS.length, prof.blocks);
  const per = Math.max(1, Math.round(w.per * prof.scale));
  return BLOCKS.slice(0, nb).map((b) =>
    Array.from({ length: per }, (_, i) => b + STRIDE * (w.off + i)),
  );
}

/** 창 × 프로파일 → 합산 시드 (항목이 실제로 부르는 것은 대부분 이쪽이다) */
export function seedsOf(name: WinName, prof: Profile = FULL): number[] {
  return seedBlocks(name, prof).flat();
}

/**
 * **짝 정렬** — 큰 창의 스윕에서 작은 짝 창의 시드에 해당하는 판만 뽑는다.
 *
 * ⚠ 이걸 `slice(0, n)` 으로 하면 **조용히 틀린다**: 시드는 블록 우선으로 늘어서 있어
 * (blk1000 전부 → blk2000 전부 → …) 앞에서 n 개를 자르면 앞 블록만 두 번 세는 꼴이 된다.
 * 곧 "짝"이라고 부르면서 실제로는 다른 판을 비교하게 되고, 그건 이 재설계가 없애려는
 * 병(같은 이름이 다른 표본을 가리킨다)의 정확한 재발이다. 그래서 **시드 값으로** 맞춘다.
 */
export function alignPair<T>(rs: readonly T[], host: WinName, sub: WinName, prof: Profile = FULL): T[] {
  const hostSeeds = seedsOf(host, prof);
  if (rs.length !== hostSeeds.length) {
    throw new Error(`짝 정렬: ${host} 스윕 길이 ${rs.length} 가 창 크기 ${hostSeeds.length} 와 다르다`);
  }
  const pos = new Map(hostSeeds.map((s, i) => [s, i]));
  return seedsOf(sub, prof).map((s) => {
    const i = pos.get(s);
    if (i === undefined) throw new Error(`짝 정렬: 창 ${sub} 의 시드 ${s} 가 ${host} 에 없다 — pairOf 선언이 거짓이다`);
    return rs[i]!;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 데이터 패치 — 되돌리기 대조군의 신원
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **테스트 전용 데이터 패치.** `makeBotSimFor`가 baseLevels · allyDefs · enemyDefs ·
 * towerDefs 네 표와 스테이지 객체를 전부 주입받으므로, 되돌리기 대조군을 `src/**` 를
 * 한 줄도 건드리지 않고 만들 수 있다. 카탈로그는 tests/sim/controls.ts.
 *
 * ⚠ `id` 는 캐시 키에 들어간다. 같은 시드·같은 opts 로 서로 다른 표를 돌리는 것이
 * 대조군의 정의라, id 가 키에 없으면 **대조군이 배포본 결과를 조용히 돌려받는다**.
 */
export interface DataPatch {
  readonly id: string;
  /** 무엇을 깨뜨리는가 (한국어 한 줄) */
  readonly why?: string;
  readonly stage?: (s: StageDef) => StageDef;
  readonly baseLevels?: (t: readonly BaseLevelDef[]) => readonly BaseLevelDef[];
  readonly allies?: (t: Readonly<Record<AllyId, AllyDef>>) => Readonly<Record<AllyId, AllyDef>>;
  readonly enemies?: (t: Readonly<Record<EnemyId, EnemyDef>>) => Readonly<Record<EnemyId, EnemyDef>>;
  readonly towers?: (t: Readonly<Record<TowerId, TowerDef>>) => Readonly<Record<TowerId, TowerDef>>;
  /**
   * **채집 짐값의 기준 크기**를 갈아 끼운다 (`createBattle`의 `BattleTuning`으로 들어간다).
   *
   * ⚠ 이 훅이 없으면 채집 축은 봉투에서 **측정 불가**가 된다. 위 네 표는 전부
   * `BattleOptions`의 주입 필드라 패치가 그냥 얹히는데, 짐값 기준은 `balance.ts`의
   * 모듈 상수라 같은 방법이 안 통한다 — 곧 대조군 `gather-x4`(짐값 네 배 = **반드시
   * 빨개져야 하는 팔**)를 만들 수 없고, 그러면 채집 다리들이 전부 UNPROVEN으로 태어난다.
   * `controls.ts`가 `SCENERY_CLEAR_BASE_COST`에 대해 이미 적어 둔 처지 그대로다.
   *
   * 함수가 아니라 값인 이유: 배포본 값이 상수 하나라 "곱하기"가 아니라 "이 값으로 놓기"가
   * 읽기 쉽고, 대조군의 신원(`id`)이 곧 그 숫자를 설명한다.
   */
  readonly gather?: { readonly baseValue: number };
}

/** 배포본 그대로 */
export const BASE: DataPatch = { id: 'BASE', why: '배포본 그대로' };

// ═══════════════════════════════════════════════════════════════════════════
// 3. 스윕 실행 + 캐시 (키가 시드 집합의 신원을 들고 있다)
// ═══════════════════════════════════════════════════════════════════════════

/** 항목이 스스로 갈아 끼우는 표 (패치와 달리 '실험 팔' 그 자체다. 패치가 이 위에 얹힌다) */
export interface Tables {
  readonly id: string;
  readonly baseLevels?: readonly BaseLevelDef[];
  readonly allies?: Readonly<Record<AllyId, AllyDef>>;
}

export interface PlaySpec {
  readonly stageId: number;
  readonly deck: TowerId[];
  readonly seeds: readonly number[];
  readonly opts?: BotOptions;
  readonly stars?: number;
  readonly endless?: boolean;
  readonly tables?: Tables;
  readonly patch?: DataPatch;
}

/** 시드 집합의 신원 — 길이만으로는 절대 식별하지 않는다 (옛 키의 병) */
export function seedIdent(seeds: readonly number[]): string {
  let h = 2166136261 >>> 0;
  for (const s of seeds) h = (Math.imul(h ^ (s >>> 0), 16777619) >>> 0);
  return `${seeds.length}:${seeds[0] ?? -1}:${seeds[seeds.length - 1] ?? -1}:${h.toString(36)}`;
}

export function playKey(spec: PlaySpec): string {
  return [
    `s${spec.stageId}`,
    spec.deck.join('+'),
    JSON.stringify(spec.opts ?? {}),
    `star${spec.stars ?? 0}`,
    spec.endless ? 'E' : '-',
    `t:${spec.tables?.id ?? 'DEFAULT'}`,
    `d:${spec.patch?.id ?? BASE.id}`,
    `q:${seedIdent(spec.seeds)}`,
  ].join('|');
}

const cache = new Map<string, BotResult[]>();
/** 캐시가 실제로 아낀 판 수 / 돌린 판 수 — 메타 it 과 보고에 쓴다 */
export const playStats = { runs: 0, hits: 0, games: 0 };

/**
 * 패치·팔 표를 얹은 시뮬레이션 하나. `play` 와 방치 루프([5])가 같은 통로를 쓴다 —
 * 통로가 둘이면 대조군 패치가 한쪽에만 걸린다.
 */
export function makeSim(
  spec: Omit<PlaySpec, 'seeds'> & { seed: number },
): { sim: BattleSim; stage: StageDef } {
  const stage0 = stageById(spec.stageId);
  if (!stage0) throw new Error(`no stage ${spec.stageId}`);
  const p = spec.patch ?? BASE;
  const stage = p.stage ? p.stage(stage0) : stage0;
  const levels = p.baseLevels
    ? p.baseLevels(spec.tables?.baseLevels ?? BASE_LEVELS)
    : (spec.tables?.baseLevels ?? BASE_LEVELS);
  const allies = p.allies
    ? p.allies(spec.tables?.allies ?? ALLY_DEFS)
    : (spec.tables?.allies ?? ALLY_DEFS);
  const enemies = p.enemies ? p.enemies(ENEMY_DEFS) : ENEMY_DEFS;
  const towers = p.towers ? p.towers(TOWER_DEFS) : TOWER_DEFS;
  const sim = makeBotSimFor(
    stage,
    spec.seed,
    spec.deck,
    spec.stars ?? 0,
    spec.endless ?? false,
    levels,
    allies,
    enemies,
    towers,
    // 짐값 기준 — 패치가 없으면 undefined 를 넘겨 **배포본 상수 하나**가 그대로 읽힌다
    // (D9: 되돌리는 손잡이는 GATHER_BASE_VALUE 하나여야 한다)
    p.gather ? { gatherBaseValue: p.gather.baseValue } : undefined,
  );
  return { sim, stage };
}

export function play(spec: PlaySpec): BotResult[] {
  const key = playKey(spec);
  const hit = cache.get(key);
  playStats.runs++;
  if (hit) {
    playStats.hits++;
    return hit;
  }
  const rs = spec.seeds.map((seed) => {
    const { sim, stage } = makeSim({ ...spec, seed });
    return runBot(sim, stage, spec.opts ?? {});
  });
  playStats.games += rs.length;
  cache.set(key, rs);
  return rs;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 지표 — 집계와 분포 위치
// ═══════════════════════════════════════════════════════════════════════════

export const wins = (rs: readonly BotResult[]): number => rs.filter((r) => r.won).length;
export const sum = (rs: readonly BotResult[], f: (r: BotResult) => number): number =>
  rs.reduce((a, r) => a + f(r), 0);
export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
export const rate = (rs: readonly BotResult[]): number => (rs.length ? wins(rs) / rs.length : 0);
export const avgWave = (rs: readonly BotResult[]): number => mean(rs.map((r) => r.wave));
/** 합산 여유 — 분모가 같은 팔(마을을 안 사는 팔)에서만 쓴다 */
export const slack = (rs: readonly BotResult[]): number =>
  sum(rs, (r) => r.baseHpMax) === 0 ? 0 : sum(rs, (r) => r.baseHpLeft) / sum(rs, (r) => r.baseHpMax);
/** 판당 여유 — 마을을 산 팔은 baseHpMax 가 1.7배까지 커지므로 갈래 비교는 반드시 이쪽 */
export const slackOf = (r: BotResult): number =>
  r.baseHpMax > 0 ? r.baseHpLeft / r.baseHpMax : 0;
export const slackAvg = (rs: readonly BotResult[]): number => mean(rs.map(slackOf));

/**
 * **판당 국면 점수** — 이진 승패를 대체하는 연속량. `slack ∈ [0,1)` 이므로 사전식
 * (승패 → 도달 웨이브 → 여유)이 정확히 보존된다: 스테이지1 실측에서 패배는 41~48,
 * 승리는 50.00~51.00 에 앉는다. 곧 승리는 어떤 패배보다 항상 위이고, 승리끼리는 여유가,
 * 패배끼리는 도달 웨이브가 순서를 준다 — 승수·웨평·여유 셋을 **하나의 눈금**으로 합친 것이다.
 *
 * ⚠ 이 눈금은 스테이지1(웨이브 상한 50)에 맞춰 유도했다. 패배가 훨씬 이른 웨이브에
 * 몰리는 스테이지(s6은 6~7)나 무한 모드에서는 승/패 간 간격이 다르므로 그 항목들은
 * 일부러 이 함수를 쓰지 않고 웨이브 자체로 잰다.
 */
export const outcome = (r: BotResult): number => r.wave + slackOf(r);

/** 분위수 — 선형보간 없이 정수 눈금을 보존한다 (minTowers 처럼 계단인 지표가 있다) */
export function quantile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)));
  return a[i]!;
}
export const median = (xs: readonly number[]): number => quantile(xs, 0.5);
/** 하위 p 꼬리 평균 (CVaR) — 극값 하나가 아니라 '나쁜 쪽 전체'를 잰다 */
export function cvar(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y).slice(0, Math.max(1, Math.ceil(xs.length * p)));
  return mean(a);
}
/** 조건을 만족하는 판의 비율 */
export function share<T>(xs: readonly T[], f: (x: T) => boolean): number {
  return xs.length === 0 ? 0 : xs.filter(f).length / xs.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 짝 통계 — 동률을 방벽으로 쓰지 않는다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 한쪽 꼬리 이항검정 `P(X ≥ k | n, ½)` — 결정론(부트스트랩·순열 없음, 난수 0회).
 * 위에서부터 누적하고 `C(n,i−1) = C(n,i)·i/(n−i+1)` 로 내려온다. n ≤ 1000 에서 정확하다.
 */
export function signP(k: number, n: number): number {
  if (n <= 0) return 1;
  const need = Math.max(0, Math.min(k, n));
  let term = Math.pow(2, -n); // i = n
  let acc = 0;
  for (let i = n; i >= 0; i--) {
    if (i >= need) acc += term;
    if (i > 0) term = (term * i) / (n - i + 1);
  }
  return Math.min(1, acc);
}

/**
 * **두 팔의 짝 비교.** 두 팔은 같은 창(같은 시드)을 밟아야 한다 — 짝지음이 블록 간·
 * 시드 간 분산을 통째로 소거하는 것이 이 설계의 검출력 원천이다.
 *
 * 왜 집계 비교를 버렸는가: 옛 봉투의 '지배 전략' 연언은 두 팔을 **짝짓지 않고** 두 집계로
 * 비교해서, 두 팔이 사실상 같은 판을 만들 때 판정이 소수점 동률에 걸렸다. 실측이 그것을
 * 증명한다 — 배포본 불도저 항목은 독립 320시드 집계로는 255 대 256(적색 후보)이지만
 * 판별로 짝지으면 **불일치 8쌍(4:4) · 승패가 갈린 시드 1:0 · Δ̄ −0.00175** 다.
 * 곧 "지배"의 근거 전체가 320판 중 한 판이었다.
 */
export interface Duel {
  /** 짝 수 */
  n: number;
  winsA: number;
  winsB: number;
  /** McNemar 불일치 쌍 — 승패가 갈린 시드 수 */
  onlyA: number;
  onlyB: number;
  /** 판당 여유 차의 부호 (동률은 양쪽 다 아님) */
  slackPos: number;
  slackNeg: number;
  /**
   * 두 팔의 국면이 조금이라도 다른 판 수. **이 값이 곧 검출력의 상한**이다 —
   * 부호검정은 시드 수가 아니라 불일치 쌍 수에서 힘을 얻으므로, 이 값이 작으면
   * 표본을 늘려도 검출력이 거의 안 는다(= 그 갈래가 아무 일도 안 일으키고 있다).
   */
  discord: number;
  /** 한쪽 꼬리 p — "A 가 승수에서 앞선다"는 증거의 세기 */
  winsP: number;
  /** 한쪽 꼬리 p — "A 가 여유에서 앞선다" */
  slackP: number;
  /** 판당 국면 차 평균 (A − B) */
  meanDelta: number;
  /** 블록별 승수 차 (A − B) */
  blockWinDiff: number[];
  /** 블록별 국면 평균 차 */
  blockDelta: number[];
  /** 블록별 **판당 여유** 평균 차 (A − B). 블록 일관성은 이 축에서 본다 — 아래 유도 참조 */
  blockSlack: number[];
}

/**
 * 짝지은 부호검정 — `duel` 이 못 쓰는 국면(무한 모드처럼 승패가 없는 자리)에서 쓴다.
 * 반환은 A 가 앞선 판 수 · B 가 앞선 판 수 · 한쪽 꼬리 p(A 가 앞선다는 증거).
 */
export function pairedSign(
  a: readonly number[],
  b: readonly number[],
  eps = 1e-9,
): { pos: number; neg: number; p: number; meanDelta: number } {
  if (a.length !== b.length) throw new Error(`짝이 안 맞는다: ${a.length} 대 ${b.length}`);
  let pos = 0;
  let neg = 0;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    acc += d;
    if (d > eps) pos++;
    else if (d < -eps) neg++;
  }
  return { pos, neg, p: signP(pos, pos + neg), meanDelta: a.length ? acc / a.length : 0 };
}

export function duel(A: readonly BotResult[], B: readonly BotResult[], nBlocks: number = BLOCKS.length): Duel {
  if (A.length !== B.length) throw new Error(`짝이 안 맞는다: ${A.length} 대 ${B.length}`);
  const n = A.length;
  let onlyA = 0;
  let onlyB = 0;
  let slackPos = 0;
  let slackNeg = 0;
  let discord = 0;
  let deltaSum = 0;
  for (let i = 0; i < n; i++) {
    const a = A[i]!;
    const b = B[i]!;
    if (a.won && !b.won) onlyA++;
    if (!a.won && b.won) onlyB++;
    const ds = slackOf(a) - slackOf(b);
    if (ds > 1e-9) slackPos++;
    else if (ds < -1e-9) slackNeg++;
    const d = outcome(a) - outcome(b);
    if (Math.abs(d) > 1e-9) discord++;
    deltaSum += d;
  }
  const per = Math.max(1, Math.ceil(n / Math.max(1, nBlocks)));
  const blockWinDiff: number[] = [];
  const blockDelta: number[] = [];
  const blockSlack: number[] = [];
  for (let s = 0; s < n; s += per) {
    const ai = A.slice(s, s + per);
    const bi = B.slice(s, s + per);
    blockWinDiff.push(wins(ai) - wins(bi));
    blockDelta.push(mean(ai.map(outcome)) - mean(bi.map(outcome)));
    blockSlack.push(mean(ai.map(slackOf)) - mean(bi.map(slackOf)));
  }
  return {
    n,
    winsA: wins(A),
    winsB: wins(B),
    onlyA,
    onlyB,
    slackPos,
    slackNeg,
    discord,
    winsP: signP(onlyA, onlyA + onlyB),
    slackP: signP(slackPos, slackPos + slackNeg),
    meanDelta: n ? deltaSum / n : 0,
    blockWinDiff,
    blockDelta,
    blockSlack,
  };
}

/**
 * **방향 다리의 목록** — 짝 부호검정으로 판정하는 자리 전부. **두 갈래로 나눠 둔다.**
 *
 * ── ⚠ 왜 나누는가: 같은 α 가 두 갈래에 **정반대로 작용한다** ────────────────────
 * 옛 구조는 열두 다리 전부에 `α = 0.05/12` 하나를 썼고, 주석은 "다리를 더하면 α 가
 * 자동으로 좁아진다(사후선택 방지)"라며 그것을 보수적이라 적었다. 절반은 맞고 **절반은
 * 정확히 거꾸로였다.**
 *
 *  · **발견용**(`X 가 Y 를 이긴다`, FIND_LEGS): 통과하려면 `p ≤ α` 여야 한다.
 *    α 가 작아지면 통과가 **어려워진다** → Bonferroni 가 실제로 보수적이다. 그대로 둔다.
 *  · **방어용**(`X 는 지배 전략이 아니다`, GUARD_LEGS): 계약이 `!dominant(...)` 라
 *    통과하려면 `p > α` 면 된다. α 가 작아지면 통과가 **쉬워진다** → Bonferroni 를
 *    그대로 쓰면 다리를 더할수록 방어가 **약해진다**. 방향이 반대다.
 *
 * 실증(옛 α = 4.167e-3): 방어용이 빨개지려면 같은 방향 불일치 쌍이 **8개**(2⁻⁸ = 3.9e-3)
 * 필요했다. α 를 0.05 로 되돌리면 **5개**(2⁻⁵ = 3.1e-2)면 된다 — 곧 옛 보정은 여섯 계약의
 * 최소 검출 효과크기를 **1.6배로 부풀리고 있었다**.
 *
 * ── 그래서 어떻게 했는가 ─────────────────────────────────────────────────────
 *  · 발견용 α 는 **한 자리도 안 바꿨다**: 여전히 `0.05 / 열두 다리` 다. 발견용 가족이
 *    여섯뿐이라 `0.05/6` 으로 느슨하게 할 여지가 있지만 그건 완화라 하지 않는다
 *    (Bonferroni 는 가족 크기 이상의 나눗수면 언제나 타당하다 — 12로 나누는 것은 6으로
 *    나누는 것보다 **더 보수적**이고, "다리를 더하면 자동으로 좁아진다"는 성질도 남는다).
 *  · 방어용 α 는 **보정하지 않는다**(`0.05`). 방어용의 다중성은 "전부 통과해야 한다"는
 *    교집합이라 거짓 통과가 개수에 비례해 부풀지 않는다. 곧 보정할 이유가 없고,
 *    보정하면 방향만 틀린다. 이 변경은 여섯 계약 전부에 대해 **순 강화**다.
 *  · 그리고 α 만으로는 "실패 불가능한 계약"이 안 없어진다. 방어용 다리마다 **최소 검출
 *    효과크기**(mdeGuard)를 계산해 다리 값에 싣고, 메타 it 이 그 값이 표본 안에서
 *    도달 가능한지를 계약으로 검사한다.
 *
 * ── 최소 검출 효과크기 표 (얼마나 나빠지면 빨개지는가) ──────────────────────────
 * 읽는 법: "N판" = 지금 실측에서 **몇 판이 더 갈래 쪽으로 뒤집히면** 계약이 깨지는가.
 * 숫자는 매 실행 계산돼 다리 값에 실리고 원장이 잠근다(주석에 손으로 베끼지 않으려고
 * 아래도 인용으로 적는다 — 어긋나면 '기록 인용' 메타 it 이 빨개진다).
 *
 *   [6]  불도저     ⟦원장 6.dozer.notDominant = MDE 3판/80⟧
 *   [7]  유닛       ⟦원장 7.unit.notDominant = MDE 18판/80⟧
 *   [7]  기지600    ⟦원장 7.base600.notDominant = MDE 22판/80⟧
 *   [7]  기지자연   ⟦원장 7.baseNat.notDominant = MDE 1판/80⟧
 *   [10] 부족       ⟦원장 10.tribe.notDominant = MDE 9판/80⟧
 *   [13] 무한 부족  ⟦원장 13.tribe.notAhead = MDE 11판/24⟧
 *
 * 이 표가 말하는 것 셋:
 *  · **여섯 다 유한하다.** 옛 α 에서도 여섯 다 유한했다(6 / 18 / 22 / 1 / 10 / 13판) —
 *    한때 [6]을 두고 "어떤 값이 나와도 실패할 수 없다"고 적었으나 거짓이었고, 실제 효과는
 *    6판 → 3판이다. 셋(`7.unit` · `7.base600` · `7.baseNat`)은 한 자리도 안 변했다.
 *    (그때 8쌍이 필요했고 국면이 갈린 판이 2뿐이라 산술적으로 불가능했다. 지금은 5쌍이면 되고
 *     이미 2:0 이 같은 방향이라 세 판이면 닿는다.)
 *  · **여유의 크기가 다리마다 다르다** — 기지(자연)은 1판, 유닛은 18판이다. 곧 [7] 안에서도
 *    자연 갈래는 칼끝에 서 있고 유닛 갈래는 매우 헐겁다. 이건 문턱의 문제가 아니라 **게임의
 *    사실**이고, 헐거운 쪽은 되돌리기 사다리가 그 헐거움을 재확인한다(controls.godAlly 주석).
 *  · **표본을 줄이면 이 숫자가 커진다.** 창의 per 를 깎는 결정은 곧 이 여섯 계약을 조용히
 *    완화하는 결정이다 — 메타 it 이 그 순간을 잡도록 값이 원장에 박혀 있다.
 */
export const FIND_LEGS = [
  'cal.dominates',
  '4.hug.dominated',
  '8.real.dominates',
  '9.real.dominates',
  '12.home.dominates',
  '14.real.dominates',
] as const;
export const GUARD_LEGS = [
  '6.dozer.notDominant',
  '7.unit.notDominant',
  '7.base600.notDominant',
  '7.baseNat.notDominant',
  '10.tribe.notDominant',
  '13.tribe.notAhead',
  // [18] 채집 갈래 둘 — [7]·[10] 과 **같은 형식**이다(갈래 대 공통 타워 벤치).
  // ⚠ 여기 더하면 발견용 α 의 나눗수가 12 → 14 로 늘어 발견용 다리가 **좁아진다**(= 강화).
  //   배포본 실측에서 발견용 여섯의 p 는 전부 6.10e-5 이하라 그 조임에 여유가 있다.
  '18.g1.notDominant',
  '18.g2.notDominant',
] as const;
export const DIRECTIONAL_LEGS = [...FIND_LEGS, ...GUARD_LEGS] as const;

/**
 * **발견용 α** — Bonferroni. 나눗수는 방향 다리 **전체 수**다(가족 크기 6 이상이라 타당하고
 * 6으로 나누는 것보다 보수적이다). 다리를 더하면 자동으로 좁아지는 성질은 그대로다.
 */
export const ALPHA = 0.05 / DIRECTIONAL_LEGS.length;
/**
 * **방어용 α** — 보정하지 않는다. 위 유도 참조: 이 자리에서 α 를 줄이는 것은 완화다.
 * 옛 값(4.167e-3) 대비 최소 검출 효과크기가 같은 방향 쌍 8개 → **5개**로 내려간다.
 */
export const ALPHA_GUARD = 0.05;

/**
 * **금지 방향**("X 는 지배 전략이 아니다")에 쓰는 형태.
 *
 * 뜻: A 가 **두 축 모두에서 뒤지지 않고**(옛 연언의 점추정 조건 그대로) 그중 **적어도 한
 * 축에서 그 우위가 잡음이 아니다**. 문턱은 여전히 "우위 0"이고 마진은 한 톨도 없다.
 *
 * ⚠ **처음에는 `winsP ≤ α && slackP ≤ α`(두 축 모두 유의)로 썼다가 고쳤다. 교정 팔이
 *   그것을 잡아냈다** — 별 1개(화력 +8~10%)를 준 팔조차 승수 축의 McNemar p 가 3.27e-2 라
 *   α 를 못 넘었고, 술어가 **거짓**이 됐다. 그 팔이 절대 문턱을 얼마나 옮기는지는
 *   ⟦원장 cal.slope = 완주율 80.00% → 93.75%⟧ · ⟦원장 cal.slope = 여유 22.95% → 47.95%⟧.
 *   곧 그 형태에서는 "지배가 아니다" 계약들이 **아무것도 못 잡는 채로 초록**이었다.
 *   승수는 80시드에서 불일치 쌍이 10 남짓이라 어떤 실제 우위도 유의해지기 어렵고,
 *   판별력을 내는 것은 여유 축이다(같은 팔에서 7.77e-11). 이 교정이 없었으면 이 재설계는
 *   옛 봉투와 같은 병("초록인데 아무 일도 안 한다")을 다른 형태로 재현했을 것이다.
 */
export const dominant = (d: Duel, alpha = ALPHA_GUARD): boolean =>
  d.onlyA >= d.onlyB && d.slackPos >= d.slackNeg && Math.min(d.winsP, d.slackP) <= alpha;

// ═══════════════════════════════════════════════════════════════════════════
// 5-b. 최소 검출 효과크기 (MDE) — "얼마나 나빠지면 이 계약이 빨개지는가"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **왜 이 계산이 계약의 일부인가.**
 * 방어용 다리는 "증거가 없다"를 통과 조건으로 삼는다. 그런 계약은 **표본이 힘을 잃으면
 * 조용히 무해해진다** — 아무 일도 안 하는 채로 영원히 초록이고, 아무도 모른다.
 * 적대적 리뷰가 실제로 그것을 지적했다: `6.dozer` 는 국면이 갈린 판이 두 판뿐이라
 * 옛 α 에서 같은 계산은 6판이었다(불가능이 아니라 두 배로 둔했다).
 *
 * 그래서 다리마다 두 숫자를 계산해 값에 싣고 원장이 잠근다:
 *  · `pairs` — 같은 방향 불일치 쌍이 최소 몇 개여야 α 를 넘는가 (표본과 무관한 성질).
 *  · `flips` — **지금 실측에서** 몇 판이 A 쪽으로 더 뒤집히면 이 계약이 빨개지는가.
 *    이게 곧 "얼마나 나빠지면 빨개지는가"의 판 단위 답이고, `∞` 면 **실패 불가능한 계약**이다.
 * 메타 it 이 `flips` 가 유한하고 표본 크기 이하인지를 **계약으로** 검사한다.
 *
 * 뒤집기의 정의: 한 판이 B 우세에서 A 우세로 넘어가면 승수 축은 (onlyA+1, onlyB−1),
 * 여유 축은 (slackPos+1, slackNeg−1) 로 움직인다. B 우세 판이 바닥나면 동률 판이
 * A 우세로 넘어간다(onlyA+1, onlyB 유지). 곧 **A 에게 가장 유리한 경로**를 세므로
 * 나오는 값은 하한이다.
 *
 * ⚠ **하한이라는 것은 계약이 광고된 MDE 보다 덜 민감할 수 있다는 뜻이다.** "MDE 3판"은
 * "3판이면 반드시 빨개진다"가 아니라 **"3판으로 빨개질 수 있는 배치가 존재한다"** 이다.
 * 실제 악화가 어느 판에 떨어지느냐에 따라 더 많이 필요할 수 있다. 한때 이 자리에
 * "계약에 유리하게 반올림하지 않는다"고 적혀 있었으나 방향이 뒤집힌 서술이었다 —
 * 하한은 계약을 실제보다 **민감해 보이게** 만든다. 이 값은 "이보다 적게 나빠지면 절대
 * 안 빨개진다"는 하한 보증으로만 읽어라.
 */
export interface Mde {
  /** α 를 넘기는 데 필요한 같은 방향 불일치 쌍의 최소 개수 */
  readonly pairs: number;
  /** 지금 실측에서 몇 판이 더 뒤집히면 빨개지는가 (Infinity = 실패 불가능) */
  readonly flips: number;
  /** 뒤집을 수 있는 판의 상한 = 짝 수 */
  readonly n: number;
  /** 판정에 쓴 α */
  readonly alpha: number;
}

/** `signP(k,k) ≤ α` 를 만족하는 최소 k — 한쪽으로만 쏠린 쌍이 몇 개여야 유의한가 */
export function minPairs(alpha: number): number {
  for (let k = 1; k <= 64; k++) if (signP(k, k) <= alpha) return k;
  return Infinity;
}

/** 방어용(지배 금지) 다리의 MDE */
export function mdeGuard(d: Duel, alpha = ALPHA_GUARD): Mde {
  const pairs = minPairs(alpha);
  for (let m = 0; m <= d.n; m++) {
    const onlyA = Math.min(d.n, d.onlyA + m);
    const onlyB = Math.max(0, d.onlyB - m);
    const sPos = Math.min(d.n, d.slackPos + m);
    const sNeg = Math.max(0, d.slackNeg - m);
    const red =
      onlyA >= onlyB &&
      sPos >= sNeg &&
      Math.min(signP(onlyA, onlyA + onlyB), signP(sPos, sPos + sNeg)) <= alpha;
    if (red) return { pairs, flips: m, n: d.n, alpha };
  }
  return { pairs, flips: Infinity, n: d.n, alpha };
}

/** `pairedSign` 으로 판정하는 방어용 다리([13])의 MDE */
export function mdeSign(pos: number, neg: number, n: number, alpha = ALPHA_GUARD): Mde {
  const pairs = minPairs(alpha);
  for (let m = 0; m <= n; m++) {
    const p = Math.min(n, pos + m);
    const q = Math.max(0, neg - m);
    if (signP(p, p + q) <= alpha) return { pairs, flips: m, n, alpha };
  }
  return { pairs, flips: Infinity, n, alpha };
}

/** MDE 등록부 — 메타 it 이 "실패 불가능한 계약이 없다"를 검사할 때 읽는다 */
const mdes = new Map<string, Mde>();
export function recordMde(id: string, m: Mde): void {
  mdes.set(id, m);
}
export function mdeSnapshot(): ReadonlyMap<string, Mde> {
  return mdes;
}
export const mdeMsg = (m: Mde): string =>
  `MDE ${Number.isFinite(m.flips) ? `${m.flips}판/${m.n}` : '∞(실패 불가능)'}·쌍 ${m.pairs}`;

/**
 * 방어용 다리 하나 — 판정·MDE 계산·등록·값 문자열을 한 자리에 묶는다.
 * 이걸 거치지 않고 `!dominant(...)` 를 손으로 쓰면 MDE 가 등록되지 않아 메타 it 이 빨개진다.
 */
export function guard(id: string, name: string, d: Duel, what: string): Leg {
  const m = mdeGuard(d, ALPHA_GUARD);
  recordMde(id, m);
  return contract(id, !dominant(d, ALPHA_GUARD), what, `${duelMsg(name, d)} · ${mdeMsg(m)}`);
}

/**
 * **요구 방향**("진짜가 위약을 이긴다")에 쓰는 안정 형태. 세 다리다:
 *  ① 합산 승수에서 뒤지지 않는다 — **옛 문턱 그대로**. `strictWins` 로 옛 부등호를 고른다.
 *  ② 판당 여유의 짝 부호검정이 유의하다 — 신설(강화).
 *  ③ 그 여유 우위의 부호가 **블록 4벌 중 3벌 이상에서 같다** — 신설(강화).
 *
 * ⚠ **`strictWins` 를 왜 두는가**(적대적 리뷰가 잡은 조용한 완화):
 *   옛 봉투의 승수 부등호는 항목마다 달랐다 — [4] `wins(hug) < wins(safe)` 와
 *   [9] `wins(real) > wins(sham)` 은 **strict** 였고, [8]·[14] 는 `>=` 였다.
 *   재설계가 넷 모두를 `winsA >= winsB` 하나로 합치면서 [4]·[9] 가 조용히 완화됐는데
 *   주석에는 "옛 단순 부등식에서 강화"라고 적혀 있었다. 두 항목은 실측 여유가 자릿수로
 *   크므로(원장 `4.hug.dominated` 64:0 · `9.real.dominates` 14:0) 옛 부등호를 **복원**한다.
 *   [8]·[14] 는 옛 문턱이 원래 `>=` 라 그대로 둔다 — [14] 는 실측 승수가 정확히 동률이라
 *   여기서 strict 를 쓰면 그건 복원이 아니라 **없던 문턱을 새로 만드는 것**이다.
 *
 * ⚠ **블록 일관성을 승수가 아니라 여유 축에 거는 이유**(한 번 틀렸다가 고쳤다):
 *   처음에는 ③을 블록별 **승수** 차에 걸었는데, [14]가 실측 100 대 100 · 블록 승수차
 *   [2 −1 0 −1] 로 빨개졌다. 그런데 같은 표본의 여유 부호는 53:9(p 5.25e-9)로 압도적이다.
 *   곧 문제는 게임이 아니라 **잣대**였다 — 승수는 이 국면에서 판당 정보가 1비트뿐이라
 *   블록 30판에서 부호가 그냥 흔들린다(교정 팔이 가르쳐 준 것과 같은 사실).
 *   일관성은 **분산이 작은 축**에서 물어야 뜻이 있다. ①이 승수 축의 옛 문턱을 그대로
 *   들고 있으므로 잠그는 내용은 줄지 않는다.
 */
export const dominatesStable = (d: Duel, alpha = ALPHA, strictWins = false): boolean =>
  (strictWins ? d.winsA > d.winsB : d.winsA >= d.winsB) &&
  d.slackP <= alpha &&
  d.blockSlack.filter((x) => x >= 0).length >= Math.max(1, d.blockSlack.length - 1);

export function duelMsg(name: string, d: Duel): string {
  return (
    `${name}: 승 ${d.winsA}/${d.n} 대 ${d.winsB}/${d.n} · 불일치쌍 ${d.onlyA}:${d.onlyB}(p ${d.winsP.toExponential(2)}) · ` +
    `여유부호 ${d.slackPos}:${d.slackNeg}(p ${d.slackP.toExponential(2)}) · Δ̄ ${d.meanDelta.toFixed(5)} · ` +
    `국면 다른 판 ${d.discord}/${d.n} · 블록승수차 [${d.blockWinDiff.join(' ')}] · ` +
    `블록여유차 [${d.blockSlack.map((x) => x.toFixed(3)).join(' ')}]`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. 다리(Leg) · 원장(Ledger)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 다리의 등급. 옛 봉투는 62개 어서션이 한 줄에 섞여 있어 **구조적으로 항상 참인 것**
 * (`Σ lostGold > 0`)과 **여유 0인 계약**(`minTowers ≥ 7`)이 같은 무게로 보였다.
 *  · contract     — 봉투가 잠그는 것. 깨지면 빨강.
 *  · precondition — 실험이 공허하지 않은지. 깨지면 빨강이지만 **문턱 유도 대상이 아니다**.
 *  · monitor      — 비차단. 값을 원장에 적고 사람에게 보고한다(판별력 미증명, 밸런스 관찰).
 */
export type LegKind = 'contract' | 'precondition' | 'monitor';

export interface Leg {
  readonly id: string;
  readonly kind: LegKind;
  readonly ok: boolean;
  /** 한 줄 선언 — "무엇을 잠그는가" */
  readonly what: string;
  /** 실측 표현. **이 문자열이 그대로 원장에 들어간다** (주석에 손으로 베끼지 않는다) */
  readonly value: string;
}

export function leg(id: string, kind: LegKind, ok: boolean, what: string, value: string): Leg {
  recordLedger(id, value);
  return { id, kind, ok, what, value };
}
export const contract = (id: string, ok: boolean, what: string, value: string): Leg =>
  leg(id, 'contract', ok, what, value);
export const precondition = (id: string, ok: boolean, what: string, value: string): Leg =>
  leg(id, 'precondition', ok, what, value);
export const monitor = (id: string, what: string, value: string): Leg =>
  leg(id, 'monitor', true, what, value);

export const failures = (legs: readonly Leg[]): Leg[] =>
  legs.filter((l) => l.kind !== 'monitor' && !l.ok);

export function legReport(legs: readonly Leg[]): string {
  return legs
    .map((l) => `${l.ok ? '○' : '✗'} [${l.kind[0]}] ${l.id} — ${l.what} :: ${l.value}`)
    .join('\n');
}

/**
 * **원장** — 실측값을 주석에 손으로 베끼는 구조 자체를 없앤다.
 *
 * 이 파일이 반복해서 걸린 병이 그것이다: 배포본 d9864c0 에서 다시 재니 주석 기록이
 * **17개 중 12개**가 낡아 있었고(1-a 15→16 · 1-b 54.3%→46.70% · 3번 최소 7→8 ·
 * 6번 60/60→66/67 · 12번 57.5%→60.0% …), 낡은 값의 공통점은 전부 "다른 트리에서 잰
 * 숫자를 손으로 합쳤다"였다. 그래서 숫자는 주석이 아니라 다리의 `value` 가 들고,
 * 시뮬이 결정론이므로 **정확 일치**로 검사한다. 갱신은 명령 한 줄이다:
 *
 *     AUTOPLAY_LEDGER=1 npx vitest run tests/sim/autoplay.test.ts
 */
const ledger = new Map<string, string>();
export function recordLedger(id: string, value: string): void {
  ledger.set(id, value);
}
export function ledgerSnapshot(): Record<string, string> {
  return Object.fromEntries([...ledger.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}
