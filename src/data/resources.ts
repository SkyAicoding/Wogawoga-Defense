/**
 * 채집 자원 표 — 종류 8종의 수치, 바이옴별 등장 가중치, 셀→종류 배정.
 *
 * **three/DOM 의존이 없는 sim/render 공용 모듈이다** — `grid.ts`와 같은 급.
 * sim(`sim/gather.ts`의 ResourceField)과 render(`render/stage3d.ts`의 소품 배치)가
 * **같은 함수**를 불러야 같은 값을 뽑는다. 한쪽이 자기 rng 스트림에서 종류를 뽑는 순간
 * 자원표를 한 줄만 고쳐도 소품 배치가 통째로 밀린다(gather-spec §5-3).
 *
 * ⚠ **`@/sim`을 임포트하지 않는다.** 렌더가 이 파일을 쓰기 때문이다 —
 *   `render/views/enemyview.ts` 헤더가 "sim 상태는 EnemyState/AllyState 배열로만 받는다
 *   (sim 모듈 임포트 금지)"를 선언했고 실제로 `src/render/**`·`src/ui/**`에 `@/sim`
 *   임포트가 0건이다. 그래서 isGathering의 인자도 `AllySim`이 아니라 **`AllyState`**다
 *   (`AllySim extends AllyState`이므로 sim 쪽도 그대로 통한다).
 *
 * ── 이 표가 정하는 것은 두 열뿐이다 (gather-spec D2) ─────────────────────────
 * 한 칸은 한 짐이고(`units` 폐기), 종류가 가르는 것은 **캐는 시간(ticks)** 과
 * **짐 값 배수(kindMul)** 둘뿐이다. 짐의 실제 값은 여기가 아니라 마을거리가 정한다
 * (`balance.ts gatherValueFor`) — 곧 이 파일은 총액에 대해 **배수만** 낸다.
 */
import { Rng, hashSeed } from '@/core/rng';
import type { BiomeId, ResourceDef, ResourceId, StageDef } from './types';
import type { AllyDef, AllyState } from './types';

/**
 * 8종 정의.
 *
 * ── `ticks`는 어떻게 정했나 — **8초 저울을 채집꾼에 건다** (gather-spec §1-2) ──
 * 실측 라운드가 못 박은 저울: "채집 중 + 운반 중은 전투 불능이다. 8.0초는 3초면 공짜에
 * 가깝고 15초면 전선이 무너지는 그 사이에서 고른 값이다."
 * **그 8초는 실제로 캐는 사람 = 채집꾼의 시계여야 한다.** 8초를 전투 3종에 걸면
 * `gatherPct 300`인 채집꾼의 캐기가 2.7초가 되어 정확히 "공짜에 가까운" 구간으로 떨어지고,
 * 채집꾼 하나가 판 시작 349초 만에 맵 40칸을 전부 턴다(w1-10 채집 몫 56% = 목표의 1.4배).
 * 그래서 기준을 뒤집었다:
 *   채집꾼의 기준 캐기 = 8.0초  ⇒  flint(기준종) ticks = 8.0 × 30 × 3 = 720
 * 부수 효과가 이 표의 값이다 — **전투 3종의 채집은 주 경로가 아니라 비상 수단이 된다**:
 * 딸기는 전투원도 딸 만하고(12.0초) 돌은 못 딴다(33.0초). 웨이브 하나가 17.3~36.9초이므로
 * 전투원의 채집은 **웨이브 하나를 통째로 비우는 일**이고 채집꾼의 채집은 그렇지 않다.
 *
 * 간격은 **90틱(3.0초, 전투 3종 기준)** 단위로 끊었다 — 표를 읽는 사람이 암산할 수 있고
 * 채집꾼 기준으로는 정확히 1.0초 단위가 된다(`gatherPct 300`이라 ticks/3이 항상 정수).
 * `stone`·`obsidian`만 180틱씩 벌려 "느리게-많이" 끝을 눈에 띄게 했다.
 *
 * ── `kindMul`은 어떻게 정했나 — **초당 벌이를 평평하게** (gather-spec §1-3) ──
 * 실측이 거리 축에서 얻은 원리를 종류 축에 그대로 적용한다: "초당 골드는 거의 평평하고
 * 명령당 골드는 3.0배다. 이 게임에서 희소한 것은 시간이 아니라 **손가락**이기 때문이다
 * (판당 커맨드 82.93회 = 15.9초에 한 번)." 곧 종류는 초당 벌이를 바꾸면 안 되고,
 * **탭 한 번의 크기와 전선 이탈의 덩어리 크기**만 바꿔야 한다.
 *
 * 기준 상황: 채집꾼(speed 1.30 · carryCap 2 · gatherPct 300)이 중앙값 칸(마을거리 8.06)에서
 * 이웃 칸(소품 최근접 거리 중앙값 1.00 — 실측)과 짝지어 두 짐을 지고 온다.
 *   짐 하나에 드는 시간 = (2 × 8.06 + 1.00) / (2 × 1.30) + ticks초/3 = 6.585 + ticks초/3
 *   kindMul(k) = (6.585 + ticks초(k)/3) / (6.585 + 8.0)     ← flint(8.0초)를 1.00으로
 * 결과: **채집꾼 초당 1.038~1.072(폭 3.3%) · 몽둥이꾼 0.378~0.423(폭 12%)**.
 * 종류가 바꾸는 것은 **탭 한 번의 값(11 → 20, 1.82배)** 과 한 번에 전선을 비우는 시간
 * (4.0 → 13.0초)뿐이다. 축은 그대로 살아 있다 — 빠르게-적게(berry) ↔ 느리게-많이(stone).
 * ⚠ 평평함 3.3%는 kindMul 식이 아니라 **정수 반올림** 때문이다(짐값이 11~20이라 한 자리
 *   반올림이 크게 먹는다). 더 평평하게 만들려면 짐값을 실수로 두어야 하는데 계약 B(골드 정수)가
 *   금지한다. 식 자체는 한 줄도 안 바꿨다.
 *
 * **랜드마크는 시각 전용이다 — 짐값에 안 붙는다**(`landmarkBonus` 필드 없음). 값이 붙으면
 * 총액이 `isLandmarkCell`의 rng에 의존하게 되어 "총액은 계산이 아니라 사실이다"가 무너지고,
 * `props.test.ts`의 "랜드마크급 ≥ 2/판" 계약을 손대는 순간 경제 총액이 따라 움직인다.
 */
export const RESOURCE_DEFS: Readonly<Record<ResourceId, ResourceDef>> = {
  // 360틱 = 채집꾼 4.0초 / 전투 3종 12.0초. **전투원도 딸 만한 유일한 종**이라
  // "채집꾼이 없어도 굶지는 않는다"의 자리를 이 한 종이 진다. 값은 최저(0.73).
  berry: { id: 'berry', nameKey: 'res.berry.name', tagKey: 'res.berry.tag', ticks: 360, kindMul: 0.73 },
  // 450틱 = 5.0초 / 15.0초. (6.585 + 5.0) / 14.585 = 0.794
  mushroom: {
    id: 'mushroom',
    nameKey: 'res.mushroom.name',
    tagKey: 'res.mushroom.tag',
    ticks: 450,
    kindMul: 0.79,
  },
  // 540틱 = 6.0초 / 18.0초. (6.585 + 6.0) / 14.585 = 0.863
  honey: { id: 'honey', nameKey: 'res.honey.name', tagKey: 'res.honey.tag', ticks: 540, kindMul: 0.86 },
  // 630틱 = 7.0초 / 21.0초. (6.585 + 7.0) / 14.585 = 0.931
  fruit: { id: 'fruit', nameKey: 'res.fruit.name', tagKey: 'res.fruit.tag', ticks: 630, kindMul: 0.93 },
  // 720틱 = **기준종**. 채집꾼 8.0초 = 위 저울 그 자체이고 kindMul이 정확히 1.00이다.
  // 이 한 줄이 나머지 일곱의 분모다 — 옮기면 표 전체가 따라 움직인다.
  flint: { id: 'flint', nameKey: 'res.flint.name', tagKey: 'res.flint.tag', ticks: 720, kindMul: 1.0 },
  // 810틱 = 9.0초 / 27.0초. (6.585 + 9.0) / 14.585 = 1.069
  wood: { id: 'wood', nameKey: 'res.wood.name', tagKey: 'res.wood.tag', ticks: 810, kindMul: 1.07 },
  // 990틱 = 11.0초 / 33.0초. 여기서부터 180틱씩 벌린다 — "느리게-많이" 끝을 눈에 띄게.
  // 전투 3종에게는 33.0초 = 웨이브 하나를 통째로 비우는 값이라 **못 딴다**가 성립한다.
  stone: { id: 'stone', nameKey: 'res.stone.name', tagKey: 'res.stone.tag', ticks: 990, kindMul: 1.21 },
  // 1170틱 = 13.0초 / 39.0초. 화산 전용 · 최고 단가. 화산에 식량이 0인 것의 보상이다.
  obsidian: {
    id: 'obsidian',
    nameKey: 'res.obsidian.name',
    tagKey: 'res.obsidian.tag',
    ticks: 1170,
    kindMul: 1.34,
  },
};

/**
 * 바이옴별 등장 가중치. **합이 100인 정수**로 적는다 — 실수 가중치는 읽는 사람이 비중을
 * 암산할 수 없고, 합이 1에서 미세하게 어긋나도 아무도 모른다.
 * 없는 종류는 **항목을 뺀다**(0을 적지 않는다). 0짜리 행은 표만 읽기 어렵게 한다.
 *
 * ⚠ `as` 캐스트 금지. 6바이옴을 전부 채운 순수 Record<BiomeId, ...>여야 BiomeId 누락을
 *    `tsc --noEmit`이 잡는다 (계약 D).
 *
 * 편성의 근거 둘:
 *  · 설원 `mushroom 10`(얼어붙은 버섯)은 사용자 요구 "과일 종류를 늘려라" 때문이다 —
 *    안 넣으면 설원의 식량이 berry 하나뿐이다.
 *  · **화산에 식량이 0인 것은 의도다.** 마지막 스테이지의 대가이고, 그 보상이 obsidian 34%다.
 *
 * 바이옴별 kindMul 가중평균(스테이지 총액 추정에 쓴다) — **손계산으로 재검산한 값이다**:
 *   grassland 0.9540 · jungle 0.9340 · desert 0.9994 · snow 0.9952 · swamp 0.9532 · volcano 1.1898
 * ⚠ 명세 §1-4 표의 jungle 0.938 · desert 1.000 · snow 0.997 은 **틀렸다**(§1-7 이 맞다).
 *   여기 값이 옳다 — 가중치×배수÷100 을 세 사람이 독립으로 다시 계산해 일치시켰다.
 *   주석 전용이라 코드는 안 움직이지만, 이 저장소에서 틀린 근거는 다음 사람을 잘못 인도한다.
 */
export const RESOURCE_WEIGHTS: Readonly<
  Record<BiomeId, readonly (readonly [ResourceId, number])[]>
> = {
  grassland: [
    ['berry', 30],
    ['honey', 8],
    ['fruit', 16],
    ['wood', 28],
    ['stone', 18],
  ],
  jungle: [
    ['berry', 26],
    ['honey', 8],
    ['fruit', 14],
    ['mushroom', 12],
    ['wood', 24],
    ['stone', 16],
  ],
  desert: [
    ['berry', 22],
    ['fruit', 14],
    ['flint', 18],
    ['wood', 20],
    ['stone', 26],
  ],
  snow: [
    ['berry', 22],
    ['mushroom', 10],
    ['flint', 16],
    ['wood', 24],
    ['stone', 28],
  ],
  swamp: [
    ['berry', 22],
    ['honey', 8],
    ['mushroom', 20],
    ['wood', 28],
    ['stone', 22],
  ],
  volcano: [
    ['flint', 20],
    ['wood', 16],
    ['stone', 30],
    ['obsidian', 34],
  ],
};

/** 랜드마크가 붙는 종 — **시각 전용이다. 짐값에 안 닿는다**(위 RESOURCE_DEFS 주석) */
export const LANDMARK_KINDS: ReadonlySet<ResourceId> = new Set<ResourceId>(['wood', 'stone']);

/**
 * 셀 → 자원 종류. **셀 하나만 보고 정한다** — 순회 순서·목록 길이·다른 셀의 값에
 * 전혀 의존하지 않는다. `sceneryCells`(grid.ts)의 스트림 방식과 다르게 만든 이유가 셋:
 *  ① sim은 Set을 정렬해 쓰고(ResourceField) 렌더는 `[...scenery].map(...)`으로 쓴다.
 *     오늘은 두 순서가 같지만 **그렇다는 보장은 어디에도 없다.**
 *  ② 렌더의 소품 rng는 셀마다 뽑는 횟수가 다르다(랜드마크·부 소품·2·3층 개수). 곧 sim이
 *     그 스트림을 재현하는 것은 원리적으로 불가능하고, 종류는 그 **바깥**에서 와야 한다.
 *  ③ 스테이지 배치를 한 칸만 고쳐도 스트림 방식은 그 뒤 모든 셀의 종류가 한 칸씩 밀린다.
 * 시드 문자열에 stage.id를 넣는 규약은 sceneryCells(`scenery:${stage.id}`)와 같다.
 *
 * ⚠ **ctx.rng를 절대 쓰지 않는다** — 전투 rng를 한 번이라도 당기면 economy.fillHand의
 *   드로우가 밀려 6판의 봉투 원장(tests/sim/__ledger__/autoplay.json)이 통째로 빨개진다.
 *
 * ⚠ hashSeed는 FNV-1a, Rng는 mulberry32다. 인접 키(`resource:1:5` vs `:6`)는 문자열 1바이트
 *   차이라 아발란치에 기대는데 **표본이 40~51개뿐**이라 가중치 충실도가 눈에 띄게 어긋난다
 *   (s1은 기대 berry 30%에 대해 실측 27.5% = 11/40). 그래서 분포 다리의 문턱은 ±20%p다 —
 *   6스테이지 전수 최악 편차가 12.6%p이고, 그보다 느슨하면 실패 불가능한 계약이 된다.
 */
export function resourceKindOf(stage: StageDef, key: number): ResourceId {
  const rng = new Rng(hashSeed(`resource:${stage.id}:${key}`));
  const table = RESOURCE_WEIGHTS[stage.biome];
  let total = 0;
  for (const row of table) total += row[1];
  let roll = rng.next() * total;
  let last: ResourceId = 'wood';
  for (const row of table) {
    last = row[0];
    roll -= row[1];
    if (roll < 0) return row[0];
  }
  return last; // 부동소수 꼬리 — 마지막 항목으로 닫는다 (noUncheckedIndexedAccess 안전)
}

/**
 * 랜드마크 비율 0.24 — 랜드마크가 wood/stone 셀에만 붙어 전체 대비 9.6~13.9%가 되고,
 * `props.test.ts`의 "랜드마크급 ≥ 2/판"(판당 4.2~6.7개)과 "≤ 20%" 사이 한가운데다.
 */
export const LANDMARK_RATE = 0.24;

/**
 * 그 셀이 랜드마크인가 — **sim과 render가 같은 답을 봐야 한다.**
 * ⚠ 다만 sim이 이 값을 쓰는 곳은 **한 군데도 없다**(랜드마크는 시각 전용).
 *   그런데도 여기 두는 이유: 렌더가 자기 rng 스트림에서 랜드마크를 뽑으면 스트림 분리가
 *   다시 깨지고, 그때 자원표 편집이 배치를 흔든다. 판정을 셀 단독 해시로 못 박아
 *   **어느 쪽도 스트림에 손대지 않게** 한다.
 */
export function isLandmarkCell(stage: StageDef, key: number, kind: ResourceId): boolean {
  if (!LANDMARK_KINDS.has(kind)) return false;
  return new Rng(hashSeed(`landmark:${stage.id}:${key}`)).next() < LANDMARK_RATE;
}

/**
 * 도착 판정의 제곱 오차 — sim(`sim/allies.ts`)과 렌더가 **같은 상수**를 본다.
 * 도착을 두 곳에서 각자 판정하면 "가는 중"과 "캐는 중"이 한 틱 어긋나는 날이 온다.
 */
export const ARRIVE_EPS2 = 1e-6;

/**
 * 지금 캐고 있는가 — 상태 플래그를 저장하지 않으므로 여기서 유도한다.
 * (유도할 수 있는 것을 저장하면 "두 필드가 동시에 정확해야 안전한 설계"가 된다.)
 * `sim/allies.ts`(전투 불능) · `sim/gather.ts`(진행) · `render/views/enemyview.ts`(채집 자세)가
 * **같은 함수**를 쓴다. 셋이 각자 도착 판정을 다시 쓰면 언젠가 한 곳만 어긋난다.
 *
 * 인자가 `AllyState`인 것이 핵심이다 — `AllySim extends AllyState`이므로 sim 쪽도 그대로
 * 통하고, 렌더는 **자기가 가진 것을 그대로 넣는다**(렌더는 `@/sim`을 못 읽는다).
 */
export function isGathering(a: AllyState): boolean {
  // ⚠ `a.gatherKey < 0` 이 아니라 `!(a.gatherKey >= 0)` 이다 — 한 글자가 아니라 방향의 문제다.
  // 아군은 **풀에서 재사용**된다(entities.ts resetAlly). tsc 가 강제하는 것은 `makeAlly` 리터럴
  // 하나뿐이라, 누가 resetAlly 에서 gatherKey 초기화를 빠뜨리면 이 함수가 `undefined` 를 받는다.
  // 그때 `undefined < 0` 은 false → **"캐는 중"으로 읽힌다.** 이 함수는 §4-4 에서 **전투 불능**
  // 판정에 쓰이므로, 그 순간 목표(=집결 지점)에 서 있는 부족원이 조준도 봉쇄도 안 하는 사람이
  // 되고 봉투가 통째로 조용히 흔들린다 — **타입 오류는 0건이다.**
  // `undefined >= 0` 은 false 이므로 이 형태는 안전한 쪽으로 닫힌다.
  // resetAlly 다섯 줄이 첫째 방어선이고 이것은 둘째 방어선이다.
  if (!(a.gatherKey >= 0)) return false;
  const dx = a.x - a.tgtX;
  const dz = a.z - a.tgtZ;
  return dx * dx + dz * dz <= ARRIVE_EPS2;
}

/**
 * 이 사람이 이 종을 캐는 데 걸리는 틱 — 렌더가 게이지 **분모**로도 쓴다.
 * `gatherPct`는 속도에만 곱한다(D8). max(1, ...)은 gatherPct가 아주 커도 0틱 캐기가
 * 생기지 않게 하는 바닥이다. `gatherPct 0`이면 Infinity가 아니라 **못 캔다**로 다루는 것은
 * 호출부(sim/gather.ts)의 몫이다 — 여기서 0을 나누면 안 되므로 그쪽이 먼저 걸러야 한다.
 */
export function gatherTicksFor(def: AllyDef, kind: ResourceId): number {
  const pct = def.gatherPct ?? 100;
  return Math.max(1, Math.round((RESOURCE_DEFS[kind].ticks * 100) / pct));
}
