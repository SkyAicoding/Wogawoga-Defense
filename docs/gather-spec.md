# 채집 시스템 구현 명세 (Gather Spec)

> 다섯 설계안 + 적대적 검토 2편을 합친 **단일 구현 명세**다. 이 문서만 읽고 구현할 수 있어야 한다.
> 근거가 코드에 있으면 `file:line`을 붙였다. 실측을 인용한 곳은 출처를 적었고,
> 추측은 **[추측]**으로 표시했다. 숫자는 전부 확정값이다 — "초기값, 튜닝 대상"이라 적힌 것도
> 값은 박혀 있다.

---

## §0. 한 문단 요약

맵의 소품 칸(지금은 `380 × 1.6ⁿ` 골드를 내고 치우는 장애물, `src/sim/battle.ts:417~433`)에
**자원의 뜻을 붙인다.** 셀 개수는 한 칸도 안 바뀐다(`SCENERY_DENSITY = 0.3` 불변,
`src/data/grid.ts:71`). 각 칸은 8종의 자원 중 하나이고 정해진 **몫 수**를 품는다. 플레이어가
부족원을 탭하고 자원 칸을 탭하면(기존 `moveAlly` 흐름 그대로, 새 커맨드 없음) 그 부족원이
걸어가 시간이 지나며 한 몫씩 캐서 코인을 낸다. 다 캐면 소품이 사라지고 **그 칸이 건설
가능한 빈 땅이 된다** — 그리고 그 칸을 판 부족원은 인접 8칸에 남은 자원이 있으면 자동으로
옮겨 간다(탭 세금 절감). 네 번째 부족 **채집꾼(`gatherer`)** 을 추가한다: 캐는 속도가
전투 3종의 3배이고 전투력은 최하다. **이 기능이 파는 물건은 코인이 아니라 「칸」이다** —
칸당 코인은 평균 12.6골드지만, 같은 칸을 골드로 치우면 380~4,000골드다. 코인은 "진행이
보인다"는 되먹임이고, 상품은 부지 개방이다. 방치하면 부족원이 0명이라 채집 수입이
**구조적으로 0**이므로 난이도 봉투 [5](`5.gold = 487 ≤ 500`)는 한 자리도 안 움직인다.

---

## §1. 자원 종류 표

**8종.** 분류학·실루엣은 렌즈 1(6바이옴 91개 원형 재고 실측)에서, 값의 크기는 렌즈 3(봇 A/B
주입 실측)에서 왔다. 타입 이름은 `ResourceId`(저장소의 `TowerId`/`EnemyId`/`AllyId`/
`HometownSourceId` 규약, `src/data/types.ts:17,27,50,59`), 나무는 `wood`(원형 이름
`fallenLog`/`mossyLog`/`swampLog`/`snowLog`와 충돌 회피).

시간은 **전투 3종 기준**이다. 채집꾼은 `gatherPct 300`이라 **틱이 1/3**이다(§2).

| id | 한글명 | 채집 틱/몫 (전투 → 채집꾼) | 회당 코인 | 총 몫 | **총액** | 채집꾼 총 소요 | 바이옴 | 시각(1층 원형) |
|---|---|---|---|---|---|---|---|---|
| `berry` | 딸기덤불 | 60 → **20** (0.67s) | **2** | 2 | **4** | 1.3초 | 초원·정글·사막·설원·늪 | `berryBush`(신규) / 사막 `cactusFruit`(신규) |
| `honey` | 벌집 | 240 → **80** (2.7s) | **5** | 1 | **5** | 2.7초 | 초원·정글·늪 | `honeycomb`(신규) |
| `mushroom` | 버섯밭 | 75 → **25** (0.83s) | **2** | 3 | **6** | 2.5초 | 정글·늪·설원 | `glowMushroom`(색 인자화) |
| `fruit` | 열매나무 | 105 → **35** (1.17s) | **4** | 2 | **8** | 2.3초 | 초원·정글·사막 | `fruitTree`(신규) / 사막 `datePalm`(신규) |
| `flint` | 부싯돌 | 135 → **45** (1.5s) | **5** | 2 | **10** | 3.0초 | 사막·설원·화산 | `flintNodule`(신규) |
| `wood` | 통나무 | 150 → **50** (1.67s) | **5** | 3 (랜드마크 **5**) | **15** (랜드마크 **25**) | 5.0초 | 전 바이옴 | 기존 나무 16종 + 랜드마크 |
| `stone` | 돌무더기 | 195 → **65** (2.17s) | **6** | 4 (랜드마크 **6**) | **24** (랜드마크 **36**) | 8.7초 | 전 바이옴 | 기존 바위 12종 + 랜드마크 |
| `obsidian` | 흑요석 | 225 → **75** (2.5s) | **8** | 4 | **32** | 10.0초 | 화산 전용 | `obsidianSpike`/`ventCrater`/`fumarole` |

**랜드마크 규칙**: 랜드마크가 붙는 종은 `wood`·`stone` **둘뿐**이고, 그 셀은 몫이 **+2**다
(`wood` 3→5, `stone` 4→6). 곱하기가 아니라 더하기인 이유는 표를 읽는 사람이 암산할 수
있어야 하기 때문이다. 랜드마크는 그림에서 먼저 보이는 "큰 광맥"이 된다.

### 왜 이 값인가 (축)

| 축 | 한쪽 끝 | 반대쪽 끝 |
|---|---|---|
| 빠르게-적게 ↔ 느리게-많이 | `berry` 1.3초 / 4골드 | `stone` 8.7초 / 24골드 |
| 잘게 ↔ 통째로 | `mushroom` 3몫 | `honey` 1몫 |
| 공통 ↔ 전용 | `wood`·`stone`(6바이옴) | `obsidian`(화산만) |
| 식량 ↔ 자재 | `berry`·`honey`·`mushroom`·`fruit` | `flint`·`wood`·`stone`·`obsidian` |

- **`berry`가 표의 바닥이자 튜토리얼 자원이다.** 채집꾼 기준 1.3초 — 웨이브 하나 안에
  확실히 끝나는 유일한 종이고, 곧 **가장 빨리 건설 부지를 여는 도구**다. 사용자가 콕 집은 종.
- **`honey`만 `units = 1`이다.** 이동 시간이 값을 깎는 유일한 종 — "가는 길목에 있으면 줍고
  아니면 무시"를 만든다.
- **회당 코인의 하한은 2다.** 1이면 `+1` 팝업이 여러 번 뜨는데, 그건 `fx.ts:518~519`가
  `bountyChunk`에서 이미 내린 판단("초당 1건이라도 붙으면 그 순간 배경음이 된다")의 시각판
  재발이다. 이 하한이 총액을 밑에서 받친다.
- **`fruit`은 반드시 1.4급 이상 「나무」다.** 식량 4종이 전부 낮은 실루엣이면
  `tests/render/props.test.ts:462`의 "큰것(1.4+) ≥ 25%"가 깨진다(§6-4 검산).

### 바이옴별 등장 가중치 (합 100 정수)

```
grassland: berry 30 · honey  8 · fruit 16 · wood 28 · stone 18
jungle   : berry 26 · honey  8 · fruit 14 · mushroom 12 · wood 24 · stone 16
desert   : berry 22 · fruit 14 · flint 18 · wood 20 · stone 26
snow     : berry 22 · mushroom 10 · flint 16 · wood 24 · stone 28
swamp    : berry 22 · honey  8 · mushroom 20 · wood 28 · stone 22
volcano  : flint 20 · wood 16 · stone 30 · obsidian 34
```

- **없는 종은 항목을 뺀다**(0을 적지 않는다). 0짜리 행은 표만 읽기 어렵게 한다.
- 설원 `mushroom 10`(얼어붙은 버섯)은 사용자 요구 (3)("과일 종류를 늘려라") 때문에 넣었다 —
  안 넣으면 설원의 식량이 `berry` 하나뿐이다.
- 화산에 식량이 0인 것은 의도다. 마지막 스테이지의 대가이고, 그 보상이 `obsidian` 34%다.
  **[추측]** 사용자가 이 대비를 문제 삼지 않을 것으로 본다.

### 맵 총량 (s1 초원, 소품 40칸 — 렌즈 1·5가 독립 실측)

```
berry  .30 × 4                              = 1.20
honey  .08 × 5                              = 0.40
fruit  .16 × 8                              = 1.28
wood   .28 × [0.76×15 + 0.24×25]            = 4.87
stone  .18 × [0.76×24 + 0.24×36]            = 4.84
                              G_avg (칸당)  = 12.59 골드
맵 gross = 40 × 12.59 = 503.6  →  채집꾼 2명 확보비 144(70+74) 차감 = 순증 약 360골드
```
판당 총수입 실측 **22,166골드**(렌즈 3, rolldown 번들 실행) 대비 **1.6%**. 렌즈 3의 설계
밴드(순증 330~450) 한가운데다. 상세 검산은 §8.

---

## §2. 채집꾼 AllyDef 확정 수치 + 기존 3종의 채집 배수

### 2-1. `gatherer` 전 필드

| 필드 | 값 | 근거 |
|---|---|---|
| `id` | `'gatherer'` | `TowerId`(`types.ts:17~25`) · `EnemyId`(`:27~`) · `StatusKind`(`:62`) · `HometownSourceId`(`:59`) 어디와도 안 겹친다(확인함). `enemyDamaged.source` 유니온 계약 안전 |
| `nameKey` / `descKey` | `'ally.gatherer.name'` / `'ally.gatherer.desc'` | `tests/ui/i18n.test.ts:51`이 `ALL_ALLY_IDS` 순회로 ko/en 양쪽 존재를 강제한다 |
| `hp` | **120** | 몽둥이꾼 240의 절반. ⚠ **이 값은 밸런스 손잡이가 아니라 표시용 숫자다** — 자원 칸은 `buildableCells`(경로가 아닌 칸, `grid.ts:46~55`)에서 뽑히고, 스치는 타격은 봉쇄자가 아예 없을 때만 켜지므로(`allies.ts:390`) **경로에서 두 칸 이상 떨어진 칸의 채집꾼은 한 대도 안 맞는다.** 무릿매 `hp 80`이 8단계까지 앓은 병과 같은 자리다(`data/allies.ts` 헤더). 120이 하는 일은 하나 — **전선 인접 칸을 캐면 랩터 3마리(18dps) 앞에서 6.7초 만에 쓰러진다**는 벌금 |
| `speed` | **1.30** | 넷 중 최고(clubber 1.15 · slinger 1.05 · guardian 0.85). 판을 가로질러 칸을 도는 것이 본업이라 이동 시간이 곧 생산성이다. 전투로 전용될 걱정이 없는 이유는 `range 0.9` · `dmg 3` |
| `armor` | **0** | armor는 파수꾼의 정체성("떼에는 강하고 큰 놈에게는 약하다", `data/allies.ts`)이다. 침식 금지 |
| `radius` | **0.24** | 무릿매와 같은 값 = 넷 중 가장 작은 몸. "무장하지 않은 사람" |
| `cost` | **70** | 하한이 코드에 있다: `tests/data/validate.test.ts:385~395`가 `cost > 45`(가장 싼 T1 frost 90의 절반)를 잠근다. 70의 유도: clubber 90의 78%. 2명 실비용 = 70 + round(70×1.05) = **144골드**, s1 시작 골드 300의 48% — 첫 타워(100~150)와 정면으로 다투는 크기다. ⚠ **guardian급 160은 기각한다**: 160 + 168 = 328 > 300이라 Lv1 정원 2를 첫 판에 못 채운다 = 기능이 도달 불가가 된다 |
| `dmg` | **3** | **0을 쓰면 안 된다**: `combat.ts:130` `Math.max(1, raw - armor)`이라 `dmg 0`은 "공격 없음"이 아니라 **매 타격 1피해 + 살점 값 지급**이다. 곧 0은 크래시가 아니라 **읽히지 않는 값**이 된다 |
| `cooldownTicks` | **40** | 1.33초. 3/1.33 = **2.25 dps** = clubber(17.5)의 12.9% |
| `range` | **0.9** | 넷 중 최단. **0으로 두면 안 된다** — 위약 아군(`autoplay.probes.ts:96`)이 쓰는 값이고, 조준이 안 서서 공격 연출이 영영 안 나며, `placement.ts:335`의 사거리 원이 반지름 0이 된다 |
| `canTargetAir` | **false** | 대공은 무릿매의 유일한 정체성 |
| `blocks` | **false** | `blocks:true`면 "정원 6을 전부 채집꾼"이 612골드 대신 약 470골드로 같은 봉쇄 폭을 사서 `ALLY_BLOCK_CAPACITY 3`에 맞춰 다시 잡은 clubber `hp 240`의 유도를 통째로 우회한다. 부수효과 하나 명시: `moveAllies`의 `if (a.def.blocks && a.targetId >= 0) continue`(`allies.ts:463`)를 안 타므로 **걸으면서 때린다** — 무릿매와 같은 규약, 새 규칙 아님 |
| `sunder` | (없음) | 파수꾼 전용 |
| `gatherPct` | **300** | §2-2 |

### 2-2. `gatherPct` — 속도 배수, **정수 퍼센트**

```
실제 틱/몫 = max(1, Math.round(RESOURCE_DEFS[kind].ticks * 100 / def.gatherPct))
```

| 종 | `gatherPct` | 근거 |
|---|---|---|
| **gatherer** | **300** | 사용자 요구 (2)의 실체. 200이면 "채집 2배 대 전투 전부"라 70골드가 90골드를 못 이긴다(전투력 차 100%인데 이득 100%뿐). 500이면 정원 2에서 "채집꾼1+전투1"이 유일해 선택이 사라지고, §8의 총액 예산에 맞추려면 칸당 값을 내려야 해 §1의 "회당 ≥ 2" 하한이 깨진다 |
| clubber | **100** | 기준 = "한 사람 몫" |
| slinger | **100** | |
| guardian | **60** | 넷 중 가장 느리다(`speed 0.85`, 방패). "파수꾼을 채집에 돌리면 손해"라는 판단을 만든다 |

⚠⚠ **`gatherPct`는 속도에만 곱한다. 수확량에는 절대 안 곱한다.** 칸의 총액 `G`를 고정하면
맵 전체 채집 총액이 `소품 셀 수 × G`로 **닫힌다** — `SCENERY_DENSITY 0.3`이 정하는 셀 수와
§1의 표만으로 감사 가능한 한 숫자가 된다. 수확 배율이 붙는 순간 그 상한이 부족 구성에 따라
3배까지 열려 §8의 실측 예산이 무의미해진다. 그리고 그 대가는 0이다 — 렌즈 3 실측:
같은 800골드를 w1~10에 몰아넣든 w1~40에 펴든 `1b.slack`이 56.40% 대 56.10%다.
**"빨리 캐는 것"은 봉투가 거의 못 느낀다.**

**전투 3종이 0이면 안 되는 이유**: Lv1 정원이 2다(`hometown.ts:300~311`). 전투 종이 아예
못 캐면 웨이브 1의 선택지가 "채집꾼2=방어0" 또는 "전투2=채집0" 이분법뿐이고 실제 정답은
항상 그 중간이라 선택이 사라진다. 100을 두면 정원 2에서 (채집꾼2 = 600) / (채집꾼1+전투1 =
400) / (전투2 = 200)이 전부 다른 답이 된다.

---

## §3. 타입 변경 — `src/data/types.ts`

### 3-1. 식별자 절 (`AllyId` 아래, 현재 :53 근처)

```ts
export type AllyId =
  | 'clubber' // 몽둥이꾼 (근접, 적의 발을 묶는다)
  | 'slinger' // 돌팔매꾼 (원거리, 걸으며 쏜다, 공중도 친다)
  | 'guardian' // 방패 파수꾼 (근접 탱커, 오래 묶는다)
  | 'gatherer'; // 채집꾼 (순수 일꾼 — 캐는 속도가 3배, 전투력은 최하)

/**
 * 채집 자원 — 맵의 소품 칸(나무·바위)이 이제 **자원 칸**이다.
 * 칸 수는 안 바뀐다(SCENERY_DENSITY 0.3 고정, data/grid.ts:71). 바뀌는 것은 그 칸의 **뜻**뿐이다.
 * 종류별 값/몫 수는 data/resources.ts, 셀→종류 배정은 같은 파일 resourceKindOf.
 *
 * 바이옴 제약(화산에 딸기 없음 등)은 종류를 유니온에서 빼는 것이 아니라
 * **가중치 표에서 항목을 빼는 것**으로 표현한다 — 유니온이 바이옴마다 갈라지면
 * Record<ResourceId, ...> 전수 매핑이 전부 부분 매핑이 된다.
 */
export type ResourceId =
  | 'berry' // 딸기덤불 (사용자 지시 — 가장 싸고 가장 빨리 칸을 연다)
  | 'honey' // 벌집 (유일한 1몫 — 통째로)
  | 'mushroom' // 버섯밭 (가장 잘게 쪼개진다 — 중단 비용이 낮다)
  | 'fruit' // 열매나무 (식량인데 **키가 큰** 유일한 종 — §6-4 계약)
  | 'flint' // 부싯돌 (식량 없는 바이옴의 빠른 선택지)
  | 'wood' // 통나무 (전 바이옴 · 랜드마크 보유 · 표의 기준점)
  | 'stone' // 돌무더기 (가장 느리게 가장 많이 · 랜드마크 보유)
  | 'obsidian'; // 흑요석 (화산 전용 · 최고 단가)
```

### 3-2. 자원 정의/상태

```ts
export interface ResourceDef {
  id: ResourceId;
  nameKey: string;
  /** 설명 한 줄 — 자원 패널의 부제 */
  tagKey: string;
  /** 한 칸이 품은 **몫 수**(정수). 이 칸의 총 골드 = units × gold (수확 배율은 없다 — §2-2) */
  units: number;
  /** 한 몫의 골드(정수). **하한 2** — 1이면 +1 팝업이 배경음이 된다(fx.ts:518 판단의 시각판) */
  gold: number;
  /** 한 몫에 드는 틱, **전투 3종 기준**(30 = 1초). 정수만 — 부분 틱은 이 게임에 없다 */
  ticks: number;
  /** 랜드마크 셀에서 몫이 몇 개 더 붙는가. wood/stone만 2, 나머지는 0 */
  landmarkBonus: number;
}

/**
 * 공개 자원 칸 상태 — 판이 시작될 때 목록이 굳고 **left만 변한다**.
 * 다 캔 칸도 배열에서 빠지지 않는다(left = 0으로 남는다): 배열 순서가 곧 해시 접기
 * 순서라, 원소가 빠지면 그 순간 결정론이 자료구조 구현에 의존하기 시작한다.
 */
export interface ResourceCellState {
  cellX: number;
  cellZ: number;
  kind: ResourceId;
  /** 남은 몫 (0 = 다 캤다 = 그 칸은 이제 빈 땅) */
  left: number;
  /** 처음 몫 수 (랜드마크면 units + landmarkBonus) */
  total: number;
}
```

### 3-3. `AllyDef`에 한 필드 (`sunder?` 바로 아래 = 현재 :295)

```ts
  /**
   * 채집 **속도** 배수, 정수 퍼센트 (생략 = 100 = 기준 속도, 0 = 못 캔다).
   * 실제 틱 = max(1, round(자원.ticks × 100 / gatherPct)).
   *
   * ⚠ **수확량에는 절대 안 곱한다.** 칸의 총액을 자원 쪽에 고정해야 맵 전체 채집 총액이
   * `셀 수 × G`로 닫히고, 그 상한이 감사 가능한 한 숫자가 된다. 배율을 수확에 곱하면
   * 부족 구성에 따라 상한이 3배까지 열려 docs/gather-spec.md §8의 예산이 무의미해진다.
   *
   * balance.ts 상수가 아니라 여기 있는 이유: (a) sunder가 같은 형태의 선례이고,
   * (b) 봉투가 이 축을 A/B할 수 있어야 한다 — makeBotSimFor의 allyDefTable 주입구
   * (tests/sim/botharness.ts:506)와 DataPatch.allies가 그대로 손잡이가 된다.
   * 모듈 상수로 두면 그 통로가 없어 채집 축이 봉투에서 **측정 불가**가 된다.
   */
  gatherPct?: number;
```

### 3-4. `AllyState`에 두 필드 (현재 :582~ 블록)

**두 개만 넣는다.** "걸어가는 중 / 캐는 중"을 세 번째 파생 플래그로 두지 않는다 — 유도할 수
있는 것을 저장하면 "두 필드가 동시에 정확해야 안전한 설계"가 된다(`entities.ts:73~75`가
`lowHp`를 거부한 그 논거).

```ts
  /**
   * 캐고 있는(또는 캐러 가는) 자원 칸의 셀 키 `z * gridW + x`. **−1 = 채집 명령 없음.**
   * 좌표 둘이 아니라 키 하나인 이유: 잔량 조회가 키 하나로 끝나고(ResourceField.at)
   * 해시에 그대로 한 줄로 접힌다. −1 센티널은 targetId(:604~605)와 같은 규약이다.
   *
   * ⚠ 이 값을 ≥ 0으로 만드는 코드는 **sim/allies.ts moveAlly() 안 한 곳뿐**이다.
   *   trainAlly의 집결 이동(a.tgtX/tgtZ 직접 대입)은 절대 건드리지 않는다.
   *   그것이 "탭이 없으면 코인도 없다"(봉투 [5], IDLE_GOLD_CAP 500 대비 실측 487)를
   *   지키는 유일한 방벽이다.
   */
  gatherKey: number;
  /**
   * 이번 **한 몫**에 쌓인 틱 (0 ~ 실제틱−1). 부분 진행분의 유일한 표현이다.
   * **정수다** — 분수를 float로 누적하면 hash()의 v.gold가 흔들린다(entities.ts:77~79의
   * bountyPaid와 같은 사고). 걸어가는 중에는 안 오른다. 진행 비율(0~1)은 **렌더가**
   * gatherTicks / 실제틱으로 만든다 — sim은 비율을 저장하지 않는다.
   */
  gatherTicks: number;
```

### 3-5. `BattleStateView`에 한 줄 (현재 :686~)

```ts
  /** 자원 칸 — **셀 키 오름차순 고정**. 목록은 안 변하고 left만 변한다 */
  resources: readonly ResourceCellState[];
```

### 3-6. `BattleSim` 인터페이스에 한 메서드

```ts
  /** 자원 칸 조회 — 없거나 격자 밖이면 null. HUD 패널과 e2e 훅이 쓴다 */
  resourceAt(cellX: number, cellZ: number): ResourceCellState | null;
```

### 3-7. `BattleCommand` — **추가하지 않는다**

채집은 **기존 `moveAlly`를 그대로 쓴다.** `moveAlly` 주석(현재 `:757~763`, "찍을 수 있는
칸에 제한은 없다")에 계약 한 조항을 덧붙인다:

```ts
       * ── 채집 (docs/gather-spec.md) ────────────────────────────────────────
       * 찍은 칸에 **남은 자원이 있으면** 대상은 그 칸으로 걸어가 도착 후 **캔다**.
       * 자원이 없으면 지금까지와 똑같이 그냥 가서 선다. 곧 이 커맨드의 의미는
       * 한 글자도 안 바뀌었고 **도착지에 뜻이 하나 붙었을 뿐**이다.
       *
       * 왜 gatherAlly라는 새 커맨드를 안 만들었나:
       *  · 잃는 능력이 없다 — 자원 칸에 파수꾼을 세워 길목을 막는 수는 그대로다.
       *    캐면서 서 있고, 교전이 붙으면 캐기를 멈춘다(규칙 G-5). claimBlockade는
       *    채집 여부를 보지 않는다.
       *  · 거부 사유가 안 늘어난다 — 이 커맨드는 격자 안이면 늘 성공한다. "채집꾼이
       *    없다"는 커맨드 반환값이 아니라 **탭 전 패널**이 말한다(battle.res.sendNone).
       *  · 커맨드 유니온이 안 늘어 determinism.test.ts의 SCRIPT와 e2e 훅이 그대로다.
       * 대신 자동화 방벽은 타입이 아니라 **테스트**가 진다 — 5.gatherZero 다리와
       * GATHER_SCRIPT 시나리오(docs/gather-spec.md §9).
```

### 3-8. `SimEvent` 추가 3종

```ts
  | {
      /**
       * **한 몫을 캤다** = 채집이 골드를 내는 유일한 사건. bountyChunk와 같은 모양이다 —
       * 부분 진행은 이벤트를 안 내고 **경계를 넘는 틱에만** 한 번 나간다.
       * 발행 빈도 상한은 정원 6 × (30 / 최소 실제틱 20) = 초당 9건이라 enemyDamaged보다
       * 두 자릿수 적다 → sim 쪽 스로틀 불필요(bountyChunk와 같은 논거).
       */
      type: 'gathered';
      allyId: number;
      defId: AllyId;
      cellX: number;
      cellZ: number;
      kind: ResourceId;
      /** 이번에 들어온 골드 (정수, ≥ 2) */
      gold: number;
      /** 지급 후 남은 몫 / 처음 몫 수 */
      left: number;
      total: number;
    }
  | {
      /**
       * 자원 칸이 바닥났다 — 렌더가 소품을 지우고(PropsBuild.markCellDead) 그 칸이
       * 건설 가능해진다.
       *
       * ⚠ **sceneryCleared와 일부러 다른 이벤트다**: 저쪽은 골드를 낸 사건이라
       * clearedCount(= 다음 유료 제거값의 지수)를 싣지만, 이쪽은 그 지수를 한 톨도
       * 안 건드린다. 한 이벤트로 합치면 그 차이가 소비처에서 사라지고, 곧 누가 실수로
       * 지수를 올린다 — 그건 "새 기능을 쓸수록 헌 기능이 비싸진다"이고 벌금이다.
       */
      type: 'resourceDepleted';
      cellX: number;
      cellZ: number;
      kind: ResourceId;
      /** 마지막 몫을 캔 부족원 */
      allyId: number;
      /**
       * 그 부족원이 자동으로 옮겨 간 이웃 칸의 셀 키. **−1 = 옮길 데가 없어 그 자리에 선다.**
       * 자동 이동은 인접 8칸으로 **한 칸씩만** 번진다(§4 규칙 G-14).
       */
      nextKey: number;
    }
  | {
      /**
       * 채집이 **명령 없이** 끝났다 — 쌓아 둔 진행분은 버려진다. 사유는 둘뿐:
       *  · 'moved' — 그 부족원에게 다른 칸으로 가는 moveAlly가 왔다
       *  · 'gone'  — 목표 칸이 사라졌다(남이 먼저 다 캤거나, 골드로 치웠다)
       * **'died'와 'threat'는 일부러 없다.** 사망은 allyDied가 이미 그 사람을 말하고
       * (둘이 겹치면 fx가 두 번 뜬다), 적이 붙어 멈추는 것은 '끝'이 아니라 **일시정지**라
       * (규칙 G-5, 진행분 유지) AllyState.targetId가 매 프레임 그 사실을 말한다 —
       * 30Hz로 쏟아질 이벤트를 안 만든다.
       */
      type: 'gatherStopped';
      allyId: number;
      defId: AllyId;
      cellX: number;
      cellZ: number;
      reason: 'moved' | 'gone';
    }
```

> `gatherOrdered`는 **만들지 않는다.** `moveAlly`가 이미 `allyOrdered`를 낸다 — 목표 표식은
> 그 이벤트가 그대로 세우고, 색만 자원 칸이면 바꾼다(§7).

---

## §4. sim 설계

### 4-1. 신규 파일 `src/sim/gather.ts` — 공개 표면

```ts
/**
 * 채집 — 부족원을 자원 칸에 붙여 시간이 지나면 코인을 얻고, 다 캐면 그 칸이 빈 땅이 된다.
 * **결정론 100% (rng 미사용).** 규칙 전문은 docs/gather-spec.md §4, 자원 표는 data/resources.ts.
 * three/DOM 임포트 금지 — @/data/* + @/core/* + ./{combat,entities} 만.
 */

/** 자원 칸 밭 — 생성 시 셀 키 오름차순으로 굳는 목록 + 조회 색인. SimCtx가 소유한다 */
export class ResourceField {
  /** 순회는 **언제나 이것**. 재정렬도 삭제도 추가도 없다 (다 캔 칸은 left = 0으로 남는다) */
  readonly list: readonly ResourceCellState[];
  constructor(stage: StageDef, scenery: ReadonlySet<number>, landmarks: ReadonlySet<number>);
  /** 조회 전용. **절대 순회하지 않는다** */
  at(key: number): ResourceCellState | null;
}

/** 채집 목표를 박는다 — **sim/allies.ts moveAlly()만** 호출한다 (봉투 [5] 방벽) */
export function setGatherTarget(ctx: SimCtx, a: AllySim, cellX: number, cellZ: number): void;

/** 채집 명령을 푼다 (진행분 폐기 + gatherStopped) */
export function cancelGather(ctx: SimCtx, a: AllySim, reason: 'moved' | 'gone'): void;

/** 그 칸을 향하던/캐던 **전원**의 명령을 푼다 — cmdClearScenery가 부른다 */
export function cancelGatherersOf(ctx: SimCtx, key: number): void;

/** 매 틱 — 도착 판정 → 진행 → 한 몫 지급 → 고갈 → 이웃 자동 이동 (아군 id 오름차순) */
export function updateGather(ctx: SimCtx): void;
```

`setGatherTarget` 본문:
```ts
export function setGatherTarget(ctx: SimCtx, a: AllySim, cellX: number, cellZ: number): void {
  const key = cellZ * ctx.opts.stage.gridW + cellX;
  if (a.gatherKey === key) return;                   // G-1: 같은 칸 재명령 = 진행분 유지
  if (a.gatherKey >= 0) cancelGather(ctx, a, 'moved'); // G-2/G-3
  const cell = ctx.resources.at(key);
  const pct = a.def.gatherPct ?? 100;
  if (!cell || cell.left <= 0 || pct <= 0) return;    // G-12/G-13: 조용히 건너뛴다
  a.gatherKey = key;
  a.gatherTicks = 0;
}
```

`updateGather` 본문(요지):
```ts
/** G-8 전용 버퍼 — allies.ts의 pickOrder 버퍼와 **공유하지 않는다** */
const gatherOrder: AllySim[] = [];

export function updateGather(ctx: SimCtx): void {
  fillAllyIdOrder(ctx.world.allies.items, gatherOrder); // entities.ts로 이관한 공용 헬퍼
  for (const a of gatherOrder) {
    if (!a.alive) continue;                                   // G-6 (⚠ 4-4 참조)
    if (a.gatherKey < 0) continue;
    const cell = ctx.resources.at(a.gatherKey);
    if (!cell || cell.left <= 0) { cancelGather(ctx, a, 'gone'); continue; }   // G-4
    if (a.targetId >= 0) continue;                            // G-5 — 진행분 유지
    const dx = a.x - a.tgtX, dz = a.z - a.tgtZ;
    if (dx * dx + dz * dz > ARRIVE_EPS2) continue;            // 아직 걷는 중
    const need = gatherTicksFor(a.def, cell.kind);            // max(1, round(ticks*100/pct))
    a.gatherTicks++;
    if (a.gatherTicks < need) continue;
    a.gatherTicks -= need;                                    // = 0 이 아니라 뺄셈 (T-2)
    const gold = RESOURCE_DEFS[cell.kind].gold;               // 정수 그대로, 배율 없음
    cell.left--;
    addGold(ctx, gold);
    ctx.events.push({ type: 'gathered', allyId: a.id, defId: a.defId,
                      cellX: cell.cellX, cellZ: cell.cellZ, kind: cell.kind,
                      gold, left: cell.left, total: cell.total });
    if (cell.left > 0) continue;
    const next = pickNeighborNode(ctx, cell.cellX, cell.cellZ); // G-14
    ctx.events.push({ type: 'resourceDepleted', cellX: cell.cellX, cellZ: cell.cellZ,
                      kind: cell.kind, allyId: a.id, nextKey: next });
    a.gatherTicks = 0;
    if (next < 0) { a.gatherKey = -1; continue; }
    a.gatherKey = next;
    a.tgtX = next % ctx.opts.stage.gridW;
    a.tgtZ = Math.floor(next / ctx.opts.stage.gridW);
  }
}

/**
 * G-14) 다 캔 칸의 **인접 8칸** 중 아직 잔량이 있는 칸 — 동점은 **셀 키 오름차순**.
 * 자동 이동을 여기까지만 허용하는 이유는 §8-3.
 */
function pickNeighborNode(ctx: SimCtx, x: number, z: number): number { /* 고정 순서 스캔 */ }
```

**도착 판정을 새로 만들지 않는다.** `ARRIVE_EPS2 = 1e-6`(현재 `allies.ts:124`)를
**`src/sim/entities.ts`로 옮기고** 거기서 export한다. 이유 둘:
1. `allies.ts → gather.ts`(값: `setGatherTarget`/`cancelGather`)와 `gather.ts → allies.ts`
   (값: `ARRIVE_EPS2`)가 되면 **값 순환**이다. 렌즈 2의 순환 분석이 이 간선을 빠뜨렸다.
2. "도착 규약은 엔티티의 관심사"라는 논거가 `fillAllyIdOrder` 이관과 같다.
   결과 그래프: `allies.ts → gather.ts` · `gather.ts → entities.ts` · `entities.ts → gather.ts`
   **(타입만: `ResourceField`)** — 값 순환 없음. `hometown.ts`가 이미 같은 모양이다(`entities.ts:20`).

### 4-2. `battle.ts` `tick()` 삽입 위치 — 4-b, `moveAllies` **직후**

```ts
    // 4) 적 이동/누수 → 아군 이동 (같은 스냅샷으로 양쪽을 움직인다)
    this.moveEnemies();
    moveAllies(ctx);
    // 4-b) 채집 — 이동 **직후**. 이 파일의 규칙 그대로 **결정을 읽는 쪽이 뒤**다.
    //      채집은 두 결정을 읽는다: 교전 여부(a.targetId)는 2) updateAllies가 정하고,
    //      도착 여부(a.x/z)는 바로 위 moveAllies가 정한다. 둘이 **동시에 확정된 첫 지점**이 여기다.
    //       · 앞이면 이번 틱에 막 도착한 부족원이 한 틱을 놀거나, 도착하지도 않은 자리에서 캔다.
    //       · 뒤로 밀 이유는 없다 — 골드는 이 틱의 어떤 판정에도 되먹이지 않는다.
    //       · checkEnd(10)보다 **앞이어야 한다** — 승리를 선언하는 틱의 마지막 한 몫은 지급된다(G-11).
    updateGather(ctx);
```

### 4-3. `entities.ts` 변경

```ts
// makeAlly() 리터럴에 두 줄
  gatherKey: -1,
  gatherTicks: 0,

// resetAlly() 전문 (현재 :189~196)
function resetAlly(a: AllySim): void {
  a.alive = true;
  a.attackCdLeft = 0;
  a.targetId = -1;
  // 걸은 거리는 **반드시** 0으로 되돌린다 — 풀 재사용이라 안 지우면 새 부족원이
  // 앞사람의 보행 위상을 물려받아 태어나자마자 다리가 엉뚱한 각도에서 시작한다
  a.walked = 0;
  // 채집 상태도 같다. 안 지우면 **탭 없이 골드가 들어온다** — 앞사람이 캐던 칸을
  // 물려받은 새 부족원은 집결 지점이 곧 자기 tgt라 "도착해 있는" 상태이고, 그 칸이
  // 우연히 집결 지점이면 명령을 한 번도 안 받았는데 gatherTicks를 이어 채운다.
  // 그건 봉투 [5](방치는 웨이브 5 안에 패배, 최종 골드 ≤ 500 — 실측 487, 여유 13골드)를
  // **정면으로** 깬다. 그리고 그 골드가 풀 재사용 순서를 타므로 시드마다 갈려
  // hash()도 함께 갈라진다. (resetEnemy의 bountyPaid와 같은 사고다)
  a.gatherKey = -1;
  a.gatherTicks = 0;
}
```

`SimCtx`에 한 필드 — `hometown`과 정확히 같은 패턴(비공개는 ctx, 공개는 view):
```ts
  /**
   * 자원 칸 밭. 공개 목록(view.resources)과 **같은 객체 배열**을 들고 있고,
   * 조회 색인(Map)은 여기만 안다 — 순회는 언제나 배열이다.
   */
  readonly resources: ResourceField;
```

`fillPickOrder`(`allies.ts:326~337`)의 삽입 정렬을 `entities.ts`의
**`fillAllyIdOrder(items, out)`** 로 이관한다(풀 순서 문제는 원래 그 파일의 관심사다).
버퍼는 **두 개**를 유지한다 — 지금은 한 틱 안에서 두 순회가 안 겹치지만, 겹치게 만드는 것은
한 줄 이동이다.

### 4-4. 해시 접기 — 정확한 위치와 코드

**아군 루프 안**(현재 `battle.ts:481~490`, `h = mix(h, a.targetId);` 다음):
```ts
      // 채집 — 둘 다 어디서도 유도되지 않는다.
      //  · gatherKey  : 다음 틱에 이 사람이 무엇을 하는가 자체다
      //  · gatherTicks: 순수 누적기다. x/z로도 walked로도 복원할 수 없고,
      //    resetAlly 누락(풀 재사용)이 그 틱에 드러나는 유일한 자리다.
      h = mix(h, a.gatherKey);
      h = mix(h, a.gatherTicks);
```

**`clearedScenery` 접기 바로 뒤**(현재 `:514~516` 다음, `return h;` 앞):
```ts
    // 자원 잔량 — **자료구조의 순회 순서에 결정론을 걸지 않는다.**
    // ctx.resources.list는 생성 시 셀 키 오름차순으로 굳고 그 뒤로 재정렬도 삭제도 없다
    // (다 캔 칸도 left = 0으로 남는다). 곧 접는 순서가 Map/Set 구현과 완전히 무관하다.
    // 셀 좌표를 함께 접는 이유: 잔량만 접으면 **목록 자체가 잘못 만들어진 회귀**
    // (resourceKindOf가 갈리거나 정렬이 빠진 경우)를 못 잡는다. 40~51칸이라 값이 싸다.
    // kind는 안 접는다 — 생성 시 굳어 절대 안 변하므로 **상태가 아니고**, 종류가 갈리면
    // 지급 골드(v.gold)와 잔량 감소가 반드시 먼저 갈린다(bountyChunks를 안 접는 것과 같은 논거).
    for (const r of ctx.resources.list) {
      h = mix(h, r.cellX * 1000 + r.cellZ);
      h = mix(h, r.left);
    }
```

### 4-5. `battle.ts` 나머지 변경

| 위치 | 변경 |
|---|---|
| 생성자 `:113~169` | `pathCells`/`scenery`를 ctx 리터럴 **앞에서** 계산하고, `new ResourceField(stage, scenery, landmarkKeysOf(stage, scenery))`를 만들어 `ctx.resources`와 `view.resources`에 **같은 배열**을 넣는다 |
| `applyCommand` | **변경 없음** (새 커맨드 없음) |
| `cmdClearScenery` `:417~433` | `this.clearedScenery.push(key)` 뒤에 두 줄: `const r = this.ctx.resources.at(key); if (r) r.left = 0;` + `cancelGatherersOf(this.ctx, key);` — 안 하면 뷰가 없는 자원의 잔량을 그리고 그 칸을 다시 채집 대상으로 찍을 수 있다 |
| `hasScenery` `:601~606` | 마지막 줄을 `if (!this.scenery.has(key)) return false; return (this.ctx.resources.at(key)?.left ?? 0) > 0;` 로. **장애물로 남아 있는가 = 아직 안 치웠고(골드) 아직 안 바닥났다(채집)** — 두 소멸 경로가 다른 자료에 기록되므로 여기서 and로 합친다 |
| `canPlaceAt` `:591~599` | `if (this.scenery.has(...)) return false;` → `if (this.hasScenery(cellX, cellZ)) return false;` |
| `clearSceneryCost` `:608~611` | **변경 없음** — 이미 `hasScenery`를 타므로 다 캔 칸에 자동으로 `null`을 돌려준다 |
| 신규 `resourceAt` | `at(key)`를 격자 검사와 함께 감싼 공개 메서드 |

`scenery` Set은 **채집이 한 번도 안 건드린다.** "골드로 치웠다"와 "다 캤다"는 그래서 계속
구별된다 — 전자만 `clearedScenery`에 키가 남고, 그 배열은 이미 해시에 접힌다.

### 4-6. `allies.ts` 변경 — `moveAlly` 루프 안 두 줄

```ts
    a.tgtX = cellX;
    a.tgtZ = cellZ;
    // 채집 — **이 한 곳이 gatherKey를 ≥ 0으로 만드는 유일한 코드 경로다**(봉투 [5]).
    // 자원이 없는 칸이면 setGatherTarget이 조용히 기존 명령만 푼다.
    setGatherTarget(ctx, a, cellX, cellZ);
    count++;
```

### 4-7. 엣지 케이스 — 전체 목록

| # | 상황 | 규칙 | 근거 |
|---|---|---|---|
| **G-1** | 채집 중 **같은 칸**으로 재명령 | 진행분 **유지**(`gatherTicks` 불변), `tgt`만 다시 박음 | 연타가 진행을 0으로 만들면 "빨리 캐려고 연타"가 손해다. 손가락이 게임을 벌하면 안 된다 |
| **G-2** | 채집 중 **자원 없는 칸**으로 `moveAlly` | 명령 해제(`'moved'`), 진행분 **폐기**, 목표만 이동 | 부분 지급을 인정하면 "찍었다 뺐다"의 이득을 따져야 하고 상태를 칸에 옮겨 저장해야 한다. 잃는 값은 최대 한 몫(0.7~2.5초) |
| **G-3** | 채집 중 **다른 자원 칸**으로 | 이전 취소(`'moved'`) → 새 칸, 진행분 0 | G-2와 같은 규칙 하나 |
| **G-4** | 걸어가는 중 그 칸이 사라짐 | 명령만 푼다(`'gone'`). **계속 걸어가 그 자리에 선다**(`tgt` 유지) | 명령의 절반("거기로 가라")은 여전히 유효하다. 도중에 세우면 "왜 여기서 섰지"가 화면에서 설명되지 않는다 — 길찾기가 없다는 것과 같은 논거(`allies.ts:40~41`) |
| **G-5** | 채집 중 **적이 사거리 안** | **교전 중이면 캐지 않는다. 그뿐이다.** `a.targetId >= 0`인 틱은 `gatherTicks`가 안 오르고 **리셋도 안 된다**(적이 지나가면 이어서 캔다). `gatherKey` 유지. **자동 후퇴 없음, 새 상수 없음** | `updateAllies`가 이미 매 틱 사거리 안 적을 `a.targetId`에 넣는다(`allies.ts:363~364`) → **사거리가 곧 중단 반경**이다: clubber 1.0 / guardian 1.15 / slinger 2.8 / gatherer 0.9. 자동 후퇴는 금지 — sim이 스스로 `tgt`를 옮기면 화면의 목표 표식(`placement.ts:275~277`)이 거짓말을 시작한다 |
| **G-6** | 채집 중 **사망** | `updateGather` 첫 줄 `if (!a.alive) continue;`. 진행 중이던 한 몫은 **소멸(지급 없음)** | ⚠ **이 가드는 필수다.** 아군이 죽는 자리는 단계 2 `updateAllies`(`allies.ts:401`)이고 `sweepDeadAllies`는 단계 9다 — 채집(4-b)이 그 사이에 있어 **가드가 없으면 시체가 마지막 한 몫을 받는다.** 그러면 "전선 근처 자원 칸은 위험"이라는 값이 사라진다. 이벤트는 `allyDied` 하나만(겹치면 fx가 두 번 뜬다) |
| **G-7** | 한 칸에 **여러 명** | 허용, **상한 없음**. 속도는 각자 타이머라 자연히 합해진다 | ① 총량이 칸의 잔량으로 이미 닫혀 있다 — 인원을 늘리면 같은 골드를 더 빨리 받을 뿐 총액이 안 는다(시간만 산다). ② `ALLY_BLOCK_CAPACITY` 같은 상한은 "하나가 여럿을 막는" 비대칭 때문인데 여기엔 그 비대칭이 없다. ③ 규칙이 하나 적다 |
| **G-8** | 같은 틱에 둘이 **마지막 몫** 완성 | **아군 id 오름차순 처리** → 낮은 id가 가져간다. 늦은 쪽은 지급 없이 `'gone'` | `fillPickOrder`(`allies.ts:326~337`)와 같은 이유: 풀은 swap-remove라 `items` 순서가 사망으로 섞이고, 그 순서에 결과를 걸면 결정론은 유지돼도 **규칙을 말로 적을 수 없다** |
| **G-9** | 채집 중 웨이브 경계 | 아무 일도 안 일어난다. **채집은 `phase`를 보지 않는다** | prep(90틱 = **3초**, `balance.ts:209`)는 채집을 시작하기에도 짧다. phase를 보면 웨이브 경계 틱에 진행이 끊겨 "언제 캤나"가 웨이브 길이에 결합된다. ⚠ 채집은 구조적으로 **웨이브 중 활동**이다 |
| **G-10** | 다 캔 칸 | **즉시 건설 가능**(`hasScenery`가 `left > 0`을 보므로 자동). `clearedScenery`에는 **절대 안 넣는다** | `sceneryClearCostFor(n) = round(380 × 1.6ⁿ)`, 상한 4000. 여섯 칸만 캐면 유료 제거가 영구히 4,000에 붙는다 = **플레이어를 채집으로 벌하는 것**이다. 반대 방향(카운터를 내린다)은 무한 할인이라 더 나쁘다. 두 카운터가 서로를 안 보는 것이 유일하게 안전한 배치다. 대가는 §8-4와 §11 |
| **G-11** | 승리/패배 후 | 추가 코드 **없음**. `tick()`이 `:178`에서 즉시 return하므로 채집도 함께 언다. 승리를 선언하는 틱의 마지막 한 몫은 **지급된다**(4-b가 checkEnd 10보다 앞) | 순서를 뒤집으면 "이겼는데 캐던 한 몫이 사라졌다"가 된다. 승리 골드는 결과 화면에 안 쓰인다(호박만 쓴다) |
| **G-12** | `gatherPct 0`인 종에게 명령 | 그 사람만 **조용히 건너뛴다**(전원 명령의 부분 적용). `moveAlly` 자체는 성공 | `moveAlly`는 어차피 격자 안이면 늘 성공한다 |
| **G-13** | 자원 없는 칸 / 격자 밖 | `moveAlly`의 기존 규칙 그대로(격자 밖만 false). 채집 상태는 안 붙는다 | |
| **G-14** | **고갈 후 자동 이동** | 마지막 몫을 캔 **그 사람만**, 인접 **8칸** 중 잔량이 남은 칸으로 옮겨 간다. 동점은 **셀 키 오름차순**. 없으면 `gatherKey = -1`로 그 자리에 선다. 같은 칸을 향하던 다른 사람들은 G-4대로 `'gone'` | **탭 세금을 줄이는 유일한 장치**다(§8-3). 봉투 [5]는 안 깨진다 — 첫 `moveAlly`가 없으면 `gatherKey`가 영원히 −1이고 방치 봇은 부족원이 0명이다. 8-이웃 확산은 셀 밀도 0.3에서 **유한한 작은 군집**에 갇힌다(8-이웃 사이트 퍼콜레이션 임계 ≈ 0.407 > 0.3) — 군집 크기는 §9의 신규 테스트가 실측으로 잠근다 |

### 4-8. 틱 단위 계산

- **T-1.** `TICK_RATE = 30`(`types.ts:9`). 매 틱 `a.gatherTicks++` 한 번. **`TICK_DT`를 곱하지
  않는다** — 채집은 이동(`allies.ts:470`)과 달리 연속량이 아니라 **횟수**다.
- **T-2.** 지급 후 `= 0`이 아니라 **`-= need`** 로 깎는다. 지금은 1씩 올리므로 둘이 같지만,
  "한 틱에 2 진행" 같은 것이 붙는 날에도 규칙이 안 바뀌는 형태가 뺄셈이다.
- **T-3.** 골드는 `RESOURCE_DEFS[kind].gold` **정수 그대로**다. 곱셈도 나눗셈도 없다(§2-2).
- **T-4. 배속 x2/x4에서 결과가 같은 이유**: `sim.tick()`은 실제 경과 시간을 한 번도 읽지
  않는다. `FixedStepLoop.update`는 배속을 누적기에만 곱하고 정수 `ticks`를 돌려주며
  (`core/time.ts:26~33`), `battlecontroller.frame`은 그 수만큼 `sim.tick()`을 반복할 뿐이다
  (`:325`). 채집은 그 안에서 정수 카운터만 만진다. 유일하게 배속이 바꾸는 것은 커맨드가
  들어가는 해상도(x4면 최대 4틱 늦게)인데 이건 기존 모든 커맨드가 이미 그렇고, 결정론
  테스트는 커맨드를 **틱 번호로** 넣는다(`determinism.test.ts:34`).

---

## §5. 자원 배정 결정론

### 5-1. 신규 파일 `src/data/resources.ts` (three/DOM 의존 없음 — `grid.ts`와 같은 급의 공용 모듈)

```ts
import { Rng, hashSeed } from '@/core/rng';
import type { BiomeId, ResourceDef, ResourceId, StageDef } from './types';

export const RESOURCE_DEFS: Readonly<Record<ResourceId, ResourceDef>> = { /* §1 표 그대로 */ };

/**
 * 바이옴별 등장 가중치. **합이 100인 정수**로 적는다 — 실수 가중치는 읽는 사람이 비중을
 * 암산할 수 없고, 합이 1에서 미세하게 어긋나도 아무도 모른다.
 * 없는 종류는 **항목을 뺀다**(0을 적지 않는다).
 * ⚠ `as` 캐스트 금지. 6바이옴 전부 채운 순수 Record<BiomeId, ...>여야 BiomeId 누락을
 *    tsc --noEmit이 잡는다 (계약 G).
 */
export const RESOURCE_WEIGHTS: Readonly<
  Record<BiomeId, readonly (readonly [ResourceId, number])[]>
> = { /* §1 편성표 6줄 */ };

/** 랜드마크가 붙는 종 — 이 둘만 landmarkBonus > 0이고 BiomeKit.landmark를 쓴다 */
export const LANDMARK_KINDS: ReadonlySet<ResourceId> = new Set<ResourceId>(['wood', 'stone']);

/**
 * 셀 → 자원 종류. **셀 하나만 보고 정한다** — 순회 순서·목록 길이·다른 셀의 값에
 * 전혀 의존하지 않는다. sceneryCells(grid.ts:77~84)의 스트림 방식과 다르게 만든 이유가 셋:
 *  ① sim은 Set을 정렬해 쓰고(ResourceField) 렌더는 `[...scenery].map(...)`으로 쓴다
 *     (render/stage3d.ts:83~85). 오늘은 두 순서가 같지만 **그렇다는 보장은 어디에도 없다.**
 *  ② 렌더의 소품 rng는 셀마다 뽑는 횟수가 다르다(랜드마크·부 소품·2·3층 개수). 곧 sim이
 *     그 스트림을 재현하는 것은 원리적으로 불가능하고, 종류는 그 **바깥**에서 와야 한다.
 *  ③ 스테이지 배치를 한 칸만 고쳐도 스트림 방식은 그 뒤 모든 셀의 종류가 한 칸씩 밀린다.
 * 시드 문자열에 stage.id를 넣는 규약은 sceneryCells(`scenery:${stage.id}`)와 같다.
 * **ctx.rng를 절대 쓰지 않는다** — 전투 rng를 한 번이라도 당기면 economy.fillHand의
 * 드로우가 밀려 6판의 봉투 원장(tests/sim/__ledger__/autoplay.json)이 통째로 빨개진다.
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
 * 그 셀이 랜드마크인가 — **sim(몫 +2)과 render(큰 실루엣)가 같은 답을 봐야 한다.**
 * 그래서 소품 rng 스트림이 아니라 여기서, 셀 단독 해시로 정한다.
 * LANDMARK_RATE 0.24: 랜드마크가 wood/stone 셀에만 붙게 되어 전체 셀 대비 비율이
 * 0.11 → 약 0.11로 반토막 나므로, props.test.ts:459의 "랜드마크급 ≥ 2/판"을 지키려면
 * 종 안에서의 비율을 올려야 한다. 0.24 × (wood+stone 비중 40~58%) = 전체의 9.6~13.9%로,
 * 하한 2개(판당 4.2~6.7개)와 상한 20% 사이 한가운데다.
 */
export const LANDMARK_RATE = 0.24;
export function isLandmarkCell(stage: StageDef, key: number, kind: ResourceId): boolean {
  if (!LANDMARK_KINDS.has(kind)) return false;
  return new Rng(hashSeed(`landmark:${stage.id}:${key}`)).next() < LANDMARK_RATE;
}
```

### 5-2. sim과 render가 같은 값을 뽑는 것을 무엇이 보장하는가 — 세 다리

1. **구현이 하나다.** `src/data/resources.ts`는 three/DOM을 안 쓰므로 sim(`battle.ts` 생성자)과
   render(`stage3d.ts:83~85`)가 **같은 함수**를 부른다. `grid.ts` 헤더가 선언한 단일화 규약과
   같은 자리다.
2. **렌더가 자기 스트림에서 종류를 뽑는 길을 막는다.** `buildProps`는 인자를 하나 더 받는다:
   `kindOf: (cellX: number, cellZ: number) => { kind: ResourceId; landmark: boolean }`.
   종류/랜드마크 여부는 hero 후보 풀을 고르는 데만 쓰고, 크기·회전·산포는 props rng가
   정한다(그건 sim이 몰라도 되는 값이다).
3. **테스트가 잠근다** — §9의 `tests/data/resources.test.ts`.

### 5-3. ⚠ 소품 rng를 **셀 단위로 가른다** (이번 개정의 필수 항목)

현재 `buildProps`는 스테이지 전체에 **하나의 rng 스트림**을 쓴다(`props.ts:2712`).
그 위에 자원별 hero 풀 / 자원별 랜드마크 분기를 얹으면 **셀마다 뽑는 횟수가 종류에 따라
달라져**, 자원표를 한 줄만 고쳐도 그 뒤 모든 셀의 배치가 밀린다 → `STAGE_CAP` 6개와
"배치 실측" 계약(`props.test.ts:430~465`)의 실측 잠금이 매 커밋 리셋된다. 그러면 §6의
삼각형 검산을 **영영 못 한다.**

**처방**: 셀마다 `new Rng(hashSeed(\`props:${biome}:${seed}:${key}\`))`를 만든다. 접촉 그림자가
이미 같은 함수 안에서 `hashSeed('sh:${x},${z}')`로 셀 단위 시드를 쓰고 있으므로 선례가 있다.
`Rng` 생성 비용은 무시할 수준이다(`core/rng.ts:10~15` mulberry32).

**대가**: 6개 스테이지의 소품 배치가 **한 번** 통째로 바뀐다 → `STAGE_CAP`과 "배치 실측"을
한 번 재측정해야 한다. 그 한 번의 대가로 **자원표 편집과 소품 배치의 결합이 영구히 끊긴다.**

⚠ `hashSeed`는 FNV-1a(`rng.ts:46~52`), `Rng`는 mulberry32다. 인접 키(`resource:1:5` vs `:6`)는
문자열 1바이트 차이라 아발란치에 기대는데, **표본이 40~51개뿐**이라 가중치 충실도가 눈에
띄게 어긋날 수 있다. §9의 분포 테스트가 이걸 잡는다.

---

## §6. 렌더 설계

### 6-1. 무엇을 만들고 무엇을 만들지 않는가 (결론 먼저)

| 표시 | 채택 | 드로우콜 Δ | 삼각형 Δ |
|---|---|---|---|
| **자원 종류 = 1층 실루엣** | ✅ | **+0** | −8 ~ +3 /셀 (§6-5) |
| **고갈 = 소품이 사라진다** | ✅ | +0 | 감소 |
| **한 몫 = 금색 `+4` 팝업** | ✅ (`spawnDamageNumber(..., 'gold', 0.55)`) | +0 | +0 (기존 층) |
| **채집 중인 칸의 잔량 막대** (`barKind` 6) | ✅ (≤ 6개) | **+0** | **+12** |
| ~~자원 종류 빌보드 아이콘 51개~~ | ❌ | — | — |
| ~~지면 데칼 링 레이어~~ | ❌ | — | — |

**아이콘/링을 둘 다 뺀 이유:**
1. **모든 소품 칸이 자원 칸이다**(계약 E: 셀 개수 불변, 의미만 변경). 곧 "어느 칸이
   자원인가"를 표시할 필요가 **없다** — "왜 이 나무는 되고 저 나무는 안 되나"가 발생하지 않는다.
2. 지면 링은 소품이 가린다. `props.test.ts`의 1층 가림 실측 최악이 **0.20~0.58 셀²**이고,
   그건 링(외경 0.44) 면적을 상당 부분 먹는다. 게다가 소품은 셀 중심에서 흩어져 있어
   (`placement.ts:249~250`이 `sceneryOffset`으로 보정하는 그 사실) 셀 중심 고정 링은 밑동과
   어긋난다.
3. 드로우콜 상한이 **90이 아니라 두 겹**이다: `smoke.spec.ts:360`·`:584`가 일반 전투 상태에서
   **≤ 60**을, `:1429`·`:1707`이 합성 최악 프레임에서 ≤ 90을 잰다. 새 메시 1개는 60짜리
   계약 쪽에 들어간다.
4. `HealthBarView`의 `CAPACITY`는 **160 그대로 둔다**(`healthbars.ts:63`). 잔량 막대는 채집
   중인 칸(≤ 정원 6)만이라 최악 프레임(적 56 + 타워 12 + 아군 6 + 기지 1 = 75)에 6을 더해도
   81 < 160이다.

**잔량의 연속적 표현은 공짜다**: `barKind` 6의 프래그먼트는 kind 1(내 편 청록→호박→적색,
`healthbars.ts:218~219`)을 그대로 쓴다 — 이 게임에서 "줄어드는 청록 바 = 내 것이 줄고 있다"는
이미 학습된 신호다.

### 6-2. `props.ts` 변경

**(a) `BiomeKit`에 한 필드 — `hero` 배열의 모양은 안 바꾼다.**
```ts
export interface BiomeKit {
  hero: Element[];        // ← 그대로. props.test.ts:169/:400이 이 배열을 훑는다
  landmark: Element[];    // ← 그대로 (wood/stone 셀만 여기서 뽑는다)
  heroScale: [number, number];
  companion: Element[];
  /**
   * 자원 종류 → **hero 배열의 인덱스 목록**. 자원 종류가 곧 1층 실루엣이다.
   * 배열 자체가 아니라 인덱스를 담는 이유: kit.hero의 모양을 안 바꿔야
   * "이름 없는 요소 금지"(props.test.ts:169)·가림 실측(:400)·heroPoolsOf 캐시가
   * 전부 손대지 않고 산다.
   */
  heroByKind: Readonly<Partial<Record<ResourceId, readonly number[]>>>;
}
```

**(b) `buildProps` 시그니처**
```ts
export function buildProps(
  biome: BiomeId,
  propCellList: readonly Vec2[],
  cellToWorld: (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3,
  seed: number,
  /** 셀 → 자원 종류/랜드마크 여부. sim과 **같은 함수**(data/resources.ts)에서 온다 */
  kindOf: (cellX: number, cellZ: number) => { kind: ResourceId; landmark: boolean },
): PropsBuild;
```

**(c) 셀 루프 머리 — 스트림을 셀 단위로 가르고 랜드마크 분기를 자원이 정한다**
```ts
  for (const cell of propCellList) {
    // 셀 단위 rng — 자원표를 고쳐도 **그 셀만** 바뀐다 (docs/gather-spec.md §5-3)
    const rng = new Rng(hashSeed(`props:${biome}:${seed}:${cell.z * 1000 + cell.x}`));
    const { kind, landmark } = kindOf(cell.x, cell.z);
    ...
    const isLandmark = landmark && kit.landmark.length > 0;
```
> ⚠ 현재 `:2749`의 `kit.landmark.length > 0 && rng.next() < LANDMARK_RATE`는 **`&&`가 단락
> 평가**해서 조건에 따라 `rng.next()`가 건너뛰어진다. 그 형태 위에 자원별 분기를 얹으면
> 스트림이 조용히 밀린다. 위 구조는 rng에서 랜드마크 판정을 **아예 뺐으므로**(자원 모듈이
> 결정한다) 그 함정이 원천 소멸한다.

**(d) 계층 추첨을 종류에 따라 가른다** — 이것이 §6-4 계약을 지키는 장치다
```ts
/**
 * 자원 종류별 1층 계층 가중치 [작은, 보통, 큰] (HERO_TIERS와 같은 순서).
 * 기존 26/46/28은 "모든 셀이 같은 분포"였다. 이제 종류가 실루엣이므로
 * **낮은 종은 절대 큰 계층에 안 가고, 큰 종은 절대 작은 계층에 안 간다.**
 * 안 그러면 2.0급 딸기덤불이 서고, 동시에 "큰것(1.4+) ≥ 25%"(props.test.ts:462)가
 * 설원(큰 종 52%)·늪(50%)에서 깨진다 — §6-4 검산.
 */
const KIND_TIER_W: Readonly<Record<ResourceId, readonly [number, number, number]>> = {
  berry:    [70, 30, 0],
  honey:    [70, 30, 0],
  mushroom: [60, 40, 0],
  flint:    [80, 20, 0],
  fruit:    [0, 40, 60],
  wood:     [0, 40, 60],
  stone:    [0, 40, 60],
  obsidian: [0, 40, 60],
};
```
`drawHero(rng, envelope, pools, tierW, kindPool)`: 계층은 `tierW`로 뽑고, 원형 인덱스는
**`pools[tier] ∩ kindPool`** 에서 뽑는다(교집합이 비면 `kindPool` 전체로 폴백).
**rng 소비 횟수는 지금과 똑같이 3회**(계층 range · 배율 range · 인덱스 int)다.

**(e) `removeCell` 재병합 코얼레싱** — 실측 기반 필수 변경
```ts
export interface PropsBuild {
  ...
  /** 셀을 죽은 것으로 표시만 한다 (재병합 안 함). 프레임 끝에 flushRemovals()를 불러라 */
  markCellDead(cellX: number, cellZ: number): boolean;
  /** 이번 프레임에 죽은 셀들을 한 번에 반영한다. 죽은 셀이 없으면 아무 일도 안 한다 */
  flushRemovals(): boolean;
  /** 기존 API 유지 — markCellDead + flushRemovals 를 즉시 부른다 (테스트/에디터용) */
  removeCell(cellX: number, cellZ: number): boolean;
}
```
근거(렌즈 5 실측): `remerge()`가 `[...parts.values()]` 전체를 `mergeGeometries`에 통째로
넘긴다(`props.ts:2875~2882`). s3 기준 1회당 **CPU 0.3~1.4ms + 1.21MB 버퍼 재할당 + GPU
재업로드**. 지금은 유료 제거가 판당 0.09회라 안전했지만, 채집은 40~51칸 전부를 고갈
가능하게 만든다. 정원 6명이 같은 프레임에 고갈시키면 최악 8.6ms/7.2MB → 코얼레싱으로
**1.4ms/1.21MB**. `stage3d`가 `processEvents` 끝에서 `flushRemovals()`를 한 번 부른다.
`props.test.ts:487`("전부 지우면 0")은 `removeCell`을 그대로 쓰므로 통과한다.

### 6-3. 신규 Element 스펙 — 6개

프리미티브 원가(`props.ts:60` 헤더): `box=12 · cyl(seg n)=4n · cone(seg n)=2n · ico=20 ·
판(n각형)=n−2`. 전부 `PROTO_TRI_BUDGET = 140`(`props.ts:73`) 이하다.

#### `berryBush` — 딸기덤불 (**76 tri**, 높이 0.42)
```ts
/** 딸기덤불 — 잎 덩이 3(옆으로) + 열매 송이 4(실루엣 밖) (76 tri, 높이 0.42) */
function berryBush(leaf: number, berry: number): Element {
  return {
    ao: 0.16,
    solids: [
      // ⚠ bushRound(:1504)는 큰 것 **위에** 작은 것 = 수직 적층이다. 딸기는 셋이
      //    **옆으로 나란히** 앉는다 — 같은 ico 두 개로 실루엣을 가르는 유일한 수단이
      //    배치 축이고, 화면 20px에서 "낮고 넓다"가 남는다.
      { kind: 'ico', pos: [-0.15, 0.17,  0.04], rot: [0.35, 0.6, 0.15], scale: [0.34, 0.30, 0.32], color: leaf,              hueJitter: 0.04 }, // 20
      { kind: 'ico', pos: [ 0.14, 0.19, -0.06], rot: [0.90, 0.2, 0.50], scale: [0.32, 0.32, 0.30], color: shade(leaf, 0.86), hueJitter: 0.04 }, // 20
      { kind: 'ico', pos: [ 0.02, 0.30,  0.10], rot: [0.20, 1.1, 0.80], scale: [0.26, 0.24, 0.26], color: shade(leaf, 1.10), hueJitter: 0.04 }, // 20
    ],
    // 열매 = 6각 판 4장. **blossom()을 쓰지 않는다** — 그 헬퍼는 수평·꼭대기 전용이고
    // 여기서 필요한 것은 "옆구리에 매달려 실루엣 밖으로 나온" 배치다(아래 표).
    // sides:6 은 blossom 주석 ①과 같은 이유. hueJitter 0.05 가 6각 판 하나를 색이
    // 조금씩 다른 삼각형 4개로 갈라 "여러 알"로 만든다.
    flats: [
      { pos: [-0.27, 0.15,  0.09], rot: [0.72, 0.4, 0], scale: [0.17, 0.16], color: berry,              sides: 6, hueJitter: 0.05 }, // 4
      { pos: [ 0.26, 0.19, -0.11], rot: [0.80, 2.1, 0], scale: [0.18, 0.17], color: shade(berry, 0.86), sides: 6, hueJitter: 0.05 }, // 4
      { pos: [ 0.06, 0.11,  0.28], rot: [0.62, 3.4, 0], scale: [0.16, 0.15], color: shade(berry, 1.10), sides: 6, hueJitter: 0.05 }, // 4
      { pos: [-0.09, 0.24, -0.25], rot: [0.88, 4.7, 0], scale: [0.15, 0.14], color: berry,              sides: 6, hueJitter: 0.05 }, // 4
    ],
  };
}
```

#### 나머지 5개

| 원형 | 구성 | tri | 높이 | 쓰임 |
|---|---|---|---|---|
| `fruitTree` | cyl seg5 줄기 20 · `flare()` cone seg5 10 · ico 잎 2덩이 40 · 6각 열매 판 4장 16 | **86** | 1.45 | 초원·정글 `fruit` |
| `datePalm` | `palmTall()`(92) 재사용 + 6각 대추 송이 3장 12 (잎 밑동에 매달림) | **104** | 1.62 | 사막 `fruit` |
| `honeycomb` | cyl seg4 마른 가지 16 · ico 벌집 덩이 20 · cone seg6 아래턱 12 · 6각 벌 3점 12 | **60** | 0.88 | 초원·정글·늪 `honey` |
| `flintNodule` | ico 모암 20 · cone seg4 깨진 면 2개 16 · 6각 규석 파단면 3장 12 | **48** | 0.34 | 사막·설원·화산 `flint` |
| `cactusFruit` | `barrelCactus()`(44) 재사용 + 6각 열매 3장 12 (정수리 링) | **56** | 0.51 | 사막 `berry` |

**색 인자화만 하는 것(신규 삼각형 0)**: `glowMushroom(cap, stem)` — 정글은 붉은 갓 `0xd4442a`,
늪은 기존 `P.glowCap`, 설원은 `P.frozenPale`. `boulder(color)`는 이미 인자를 받는다.

**신규 팔레트 항목**(`props.ts` `P`, :127~):
```ts
berryRed: 0xd6203c,  berryDeep: 0x9b1528,     // 딸기·월귤
berryBlue: 0x4356c4, berryBlueDeep: 0x2c3a92, // 블루베리(늪)
fruitGold: 0xf0a52a,                          // 열매나무
fruitDate: 0xa8622c,                          // 대추야자
cactusPear: 0xe0447a,                         // 선인장 열매(자홍 — 사막 주황 지면 위 유일한 냉색)
honeyWax: 0xd8a33e, honeyGold: 0xf5c65a,      // 벌집
flintPale: 0xe6e2d4,                          // 규석 파단면
```

**꽃과 열매를 가르는 진짜 장치는 색이 아니라 「위치」다.** `P.flowerRed = 0xd8412e`(H≈6°)와
`berryRed = 0xd6203c`(H≈350°)는 4px에서 구분되지 않는다.

| | y | 반경 | 기울임 | 개수 |
|---|---|---|---|---|
| 꽃 (`flowerBush` :1551, `wildflowerBunch`) | 0.31~0.34 (덤불 **꼭대기**) | ≤ 0.12 (실루엣 **안**) | 수평 | 2 |
| **열매 (`berryBush`)** | 0.10~0.24 (덤불 **아래·옆구리**) | 0.24~0.30 (실루엣 **밖**) | rot.x 0.5~0.9 | 4 |

보험 하나 더: **`berry` 셀의 2층(mid) 후보에서 `flowerBush`(정글)·`wildflowerBunch`/
`flowerPatch`(초원)를 뺀다.** 삼각형 비용 0, 리스트 필터 한 줄이다.

### 6-4. 배치 계약 검산 (`props.test.ts:430~465`)

| 계약 | 계산 | 판정 |
|---|---|---|
| **랜드마크급(2.5+) ≥ 2/판** | wood+stone 비중 × 0.24 × 셀 수: 초원 .46×.24×40 = **4.4** · 정글 .40×.24×44 = **4.2** · 사막 .46×.24×51 = **5.6** · 설원 .52×.24×48 = **6.0** · 늪 .50×.24×42 = **5.0** · 화산 .46×.24×40 = **4.4** | ✓ 전부 |
| **랜드마크 ≤ 20%** | 9.6% ~ 13.9% | ✓ (여유 6.1pp 이상) |
| **큰것(1.4+) ≥ 25%** | 큰 종(fruit/wood/stone/obsidian) 비중 × P(1.4+ \| 큰 종). `KIND_TIER_W`가 큰 종을 [0,40,60]으로 두므로 P ≈ 0.7 **[추정]**: 초원 .62×.7 = 35% · 정글 .54×.7 = 38% · 사막 .60×.7 = 42% · 설원 .52×.7 = **36%** · 늪 .50×.7 = **35%** · 화산 .80×.7 = 56% | ✓ 예측. **⚠ 가장 얇은 곳** — 설원·늪. 구현 후 실측 필수 |
| **낮은칸(0.9 미만) ≥ 15%** | 낮은 종 비중(전부 <0.9): 초원 38% · 정글 46% · 사막 40% · 설원 48% · 늪 50% · 화산 **20%** | ✓ (화산 여유 5pp) |
| **1층 실루엣 3종 이상** | `kit.hero`가 자원별 풀의 합집합 | ✓ |
| **높이 폭 ≥ 5배** | 합집합 0.17~2.29 = 13.5배 | ✓ |

⚠ `KIND_TIER_W`를 [0,40,60]에서 손대면 "큰것 ≥ 25%"가 설원·늪에서 먼저 깨진다.
그리고 **`fruit`을 낮은 실루엣으로 바꾸면 안 된다** — 초원의 큰 종이 44%로 떨어져 31% → 여유 6pp가 된다.

### 6-5. 삼각형 / 드로우콜 예산

**현재 실측**(렌즈 1·5 독립 측정, `npx vitest run tests/render/props.test.ts`):

| 스테이지 | 셀 | 현재 tri | `STAGE_CAP` | 여유 | 셀당 여유 |
|---|---|---|---|---|---|
| s1 grassland | 40 | 8,993 | 9,200 | 207 | 5.2 |
| s2 jungle | 44 | 8,725 | 9,200 | 475 | 10.8 |
| s3 desert | 51 | 11,233 | 11,700 | 467 | 9.2 |
| s4 snow | 48 | 8,681 | 9,300 | 619 | 12.9 |
| s5 swamp | 42 | 9,749 | 10,400 | 651 | 15.5 |
| s6 volcano | 40 | 8,066 | 8,400 | 334 | 8.4 |

**Δ 추산**(hero 기대 원가 변화 + 부 소품 빈도 변화):
식량류 신규 원형(48~104 tri)이 그것들이 대체하는 나무 원형(84~134)보다 **싸다.** 반대로
낮은 hero가 늘어(47% → 약 60%) `heroH < 0.6 → 부 소품 무조건` 분기(`props.ts:2782`)가 더
자주 걸린다(+5 tri/셀 [추정]).

| 스테이지 | Δ hero | Δ 부소품 | **Δ/셀** | **신규 총 tri (추산)** | `STAGE_CAP` |
|---|---|---|---|---|---|
| s1 | −7.7 | +5.2 | −2.5 | 8,893 | 9,200 ✓ |
| s2 | −4.3 | +5.0 | +0.7 | 8,756 | 9,200 ✓ |
| s3 | −13.5 | +5.0 | −8.5 | 10,800 | 11,700 ✓ |
| s4 | −2.5 | +5.0 | +2.5 | 8,801 | 9,300 ✓ |
| s5 | −9.6 | +5.0 | −4.6 | 9,556 | 10,400 ✓ |
| s6 | −5.6 | +5.0 | −0.6 | 8,042 | 8,400 ✓ |

⚠ **이 표는 실측이 아니라 모델이다.** 실제 분산원은 Δ가 아니라 **셀 구성의 시드 추첨**이고,
§5-3의 rng 재편으로 6판이 통째로 한 번 바뀐다. 그래서 §10의 구현 순서를 **"원형을 먼저 굽고
`props.test.ts`를 돌려 실측한 뒤 편성 가중치를 조정"** 으로 못 박았다. `STAGE_CAP` 갱신은
그 파일 규약대로 **실측 + 6%** 로만 한다. `CELL_TRI_BUDGET = 300`은 **유지**한다 —
`buildProps`가 굽기 전에 세어 가며 채우므로(`props.ts:2741` `left`) 초과는 구조적으로 불가능하다.

**프레임 예산** (e2e 최악 프레임 실측, `props.test.ts:56~59`):

| | 소품 Δ | 잔량 막대 Δ | **드로우콜 Δ** | 신규 최악 프레임 | 150,000 여유 |
|---|---|---|---|---|---|
| s3 (최악, 74콜/137,157) | −435 | +12 | **+0** | 136,734 | 8.8% |
| s4 (75콜/134,184) | +120 | +12 | **+0** | 134,316 | 10.4% |

**드로우콜은 한 개도 안 는다.** 실루엣은 기존 병합 소품 메시 안(`props.ts:2870`), 잔량 막대는
기존 `HealthBarView` 인스턴스 메시 안(`healthbars.ts:270`), 팝업은 기존 damage-number 층이다.
**60짜리 계약(`smoke.spec.ts:360`·`:584`)도 안 건드린다.**

### 6-6. 채집꾼 메시

`ALLY_KITS`(`enemies.ts:1573`)에 `kitGatherer`를 **4번째**로, `ALLY_ATTACKS`(`:1457`)에도
같은 순서로 4번째 포즈를, `ALLY_VARIANTS`(`:2010`)에 `gatherer: 4`를 등록한다
(`allyShared`가 `forEach((poses,i) => rig.attack(i+1, poses))`로 짝짓는다, `:1600`).

**실루엣의 요점은 부피가 어디 붙는가다.** 기존 셋은 전부 무기가 손·머리 위에 있다
(몽둥이꾼 = 어깨 위 돌혹 / 무릿매 = 머리 위 끈과 돌 / 파수꾼 = 몸 앞 큰 방패). 채집꾼은
**무기가 없고 등에 큰 광주리**를 진다 — 55° 부감 카메라에서 위에서 본 덩어리가 셋 중
어느 것과도 안 겹치는 유일한 자리이고, "손이 비어 있다"가 그대로 "싸우지 않는 사람"이다.
색은 `ALLY_TINT [0.86, 0.98, 1.16]`(`:2035`)을 그대로 받되 광주리만 **마른 풀색(따뜻한 갈)**
으로 구워 한랭 톤 위에 한 점만 따뜻하게 남긴다. 머리는 두건 대신 **낮은 띠 하나**만 둘러
실루엣 높이를 넷 중 가장 낮게 유지한다.

**공격 포즈**는 내려치기(clubber `back 0.85 / fwd −1.35`)도 던지기(slinger `back 0.45 /
fwd −2.3`)도 아닌 **캐기**: `ATK_ROLE_MAIN`을 `back 0.35 / fwd −1.6`으로 얕고 낮게 잡아
팔이 몸 앞 지면을 훑고, `ATK_ROLE_HEAD`를 `fwd −0.4`로 크게 숙여 "땅을 본다"가 되게 한다.

⚠ **채집 자세는 이 공격 포즈로 재생하지 않는다.** 채집 중에는 `attackCdLeft`가 안 돌기
때문에(G-5: 교전 중이면 안 캐고, 안 교전 중이면 안 때린다) `allyAttackProgress`가 0으로
얼어붙는다. `enemyview.ts`의 아군 루프에서 **별도 위상**을 만든다:

```ts
// 채집 중인가 — 세 값에서 유도한다(sim은 파생 플래그를 저장하지 않는다)
const dx = a.x - a.tgtX, dz = a.z - a.tgtZ;
const gathering = a.gatherKey >= 0 && a.targetId < 0 && dx * dx + dz * dz <= ARRIVE_EPS2;
```
`ARRIVE_EPS2`는 §4-1에서 `entities.ts`로 옮겨 export한다 — **sim과 렌더가 같은 상수를 본다.**
위상은 `a.gatherTicks / gatherTicksFor(def, kind)`(0~1)로, 같은 리그의 `attack(4, ...)` 포즈를
그 위상으로 직접 구동한다(공격 쿨다운 경로를 거치지 않는다).

**삼각형 예산이 이 아트를 실제로 묶는다.** 실측: 아군 공유본 **1,080**(단품 clubber 578 /
slinger 610 / guardian 588, 합 1,776) → 몸통 **348**, 장비 3벌 **732**(평균 244).
`tests/render/raiders.test.ts:196` `expect(ally).toBeLessThan(1250)`이므로 새 장비 K는:
```
1,080 + K < 1,250            → K ≤ 169
단품 = 348 + K ∈ [400, 700]  → K ∈ [52, 352]
소계 K ∈ [52, 169]           ← K = 169면 여유가 **삼각형 1개**다
```
**K ≤ 140으로 굽는다**(공유본 1,220, 여유 30). 부품: 광주리 8각 테이퍼 링 + 바닥 ≈ 40 ·
멜빵 2줄 ≈ 24 · 머리띠 링 ≈ 16 · 짧은 뒤지개 ≈ 12 · 광주리 속 열매 서넛 ≈ 40 = **약 132**.
`raiders.test.ts:174`의 `n < soloSum × 0.7` 다리도 검산: soloSum = 578+610+588+488 = 2,264,
0.7 × 2,264 = 1,585 > 1,220 ✓.

---

## §7. UX

### 7-1. 탭 상태 기계 — 변경 후

**변경은 한 줄뿐이다.** `placement.ts:180~194`의 `moveAlly` 분기에서, 성공 후 표식 색을 가른다.

```
[탭 (px,py)]
 ① pickAllyAt (반경 0.7타일)  HIT → selectAllyDef(defId)           ==> S_ALLY   [변경 없음]
 ② S_ALLY + 셀 탭 → applyCommand{moveAlly, allyId:-1, defId, cell}  [변경 없음]
      성공 → clearAllySelection()
             + this.sim.resourceAt(cell) ? showGatherOrder(cell) : showAllyOrder(cell)  ← 신규 1줄
                                                                    ==> S_IDLE
 ④ selectAt(cell) — 타워 > 마을 > 소품 > 해제                        [변경 없음]
      hasScenery(cell) 분기가 그대로 자원 패널을 연다
      (hasScenery는 이제 left > 0을 함께 보므로 다 캔 칸은 자동으로 여기서 빠진다)
 ⑤ 카드 모드                                                        [변경 없음]
```

**탭 수는 안 늘어난다**(부족원 탭 → 칸 탭 = 2탭, 계약 F). e2e가 잠근 `S_IDLE` 소품 탭 경로
(`smoke.spec.ts:423~428`)도 그대로다.

**보조 입구 — 자원 패널의 `[🧺 채집 보내기]`(1탭).** 이쪽이 **웨이브 중의 주 경로**다:
`ALLY_PICK_RADIUS = 0.7`타일 × 1셀 ≈ 20.5px = **직경 28.7px**로 계약 F(44px)를 이미 밑도는
반면(기존 부채), 자원 칸은 **정지한 큰 타깃**(1셀 ≈ 20.5px, 밑동 보정 포함)이라 겨냥이 쉽다.

### 7-2. 데칼 / 피드백

| 층 | 재활용 | 드로우콜 Δ |
|---|---|---|
| 목표 표식 | `decals.marker`(`decals.ts:99`, 3용도 돌려쓰기)를 그대로 쓰고 **색만** 바꾼다. `MARKER_COLOR_GATHER = 0xffcf3a`(진한 금색) 추가, `showGatherOrder(x,z)`가 `markerMat.color.setHex()`만 갈아 끼운다. 기존 이동 표식(하늘색 0x9fdcf7)과 색으로 갈린다 | **+0** |
| 아군 사거리/발밑 링 | 손대지 않는다 | +0 |
| 소품 선택 링 | 손대지 않는다 (`sceneryOffset` 밑동 보정 포함) | +0 |

**fx 4층**:
1. **동작(연속)** — §6-6의 채집 포즈.
2. **발밑 먼지(연속, 저비용)** — `s3.particles.burst(...)`, `allyTrained`가 쓰는 것 그대로
   (`fx.ts:778~783`).
3. **수확 팝업(이산)** — `spawnDamageNumber(sx, sy, '+4', 'gold', 0.55)`. `DamageKind`에
   `'gold'`가 이미 있다(`damagenumbers.ts:11`) — **새 kind 불필요.**
4. **고갈(1회)** — `sceneryCleared` 핸들러(`fx.ts:681~706`) 통째 재사용. `debris` 색만 자원
   종류로 바꾼다(딸기 `0xc02a3a` 등).

**소리는 안 붙인다.** `fx.ts:518~519`가 `bountyChunk`에서 이미 그 판단을 적었다 —
*"초당 1건이라도 코인 소리가 붙으면 그 순간 배경음이 된다."* 채집은 그보다 잦다.
고갈에만 1회(`audio.play('boulderImpact')` 재사용).

**배치당 상한** — `fx.ts` 모듈 상수에 기존 규약대로:
```ts
const GATHER_FX_MAX = 4;   // TOWER_HIT_FX_MAX 4 (:46) / BOUNTY_CHUNK_FX_MAX 4 (:71) 와 같은 자리
```
`FxRouter`에 `private gathers = 0;`을 두고 `handle()` 진입부(`:406~412`)에서 0으로 리셋한다 —
`bountyChunks`(`:361`, `:521`)와 완전히 같은 패턴.

**이벤트 구독** (`battlecontroller.ts:426~442`):
```
processEvents()
  ├─ this.fx.handle(events)  →  case 'gathered' / case 'resourceDepleted'
  └─ for (const ev of events)
       ├─ ev.type === 'resourceDepleted'
       │    → this.stage3d.markSceneryDead(ev.cellX, ev.cellZ)     ← 재병합 안 함
       │    → this.placement.refreshScenerySelection()             ← 없으면 사라진 자원 위에 패널이 남는다
       └─ (루프 끝) this.stage3d.flushSceneryRemovals()             ← 프레임당 1회 재병합
```

### 7-3. HUD

**(a) 부족 카드 4개** — `.ally-row`가 flex 균등(`style.css:465`), `.ally-btn { flex:1;
min-height:48px }`(`:470~471`). 실측 폭:

| 화면 | 패널 내부 폭 | 4개일 때 버튼 폭 | 높이 | 44px 계약 |
|---|---|---|---|---|
| 390px | 342 | **79.5px** | 48px | ✅ |
| 360px | 312 | **72.0px** | 48px | ✅ |
| 320px | 272 | **62.0px** | 48px | ✅ |

내용물 폭(아이콘 24 + gap 6 + 비용 3자리 ≈ 26 + 패딩) ≈ 62px이라 320px에서 딱 맞는다.
안전 마진 두 줄 추가:
```css
@media (max-width: 360px) {
  .ally-btn { gap: 4px; padding-left: 4px; padding-right: 4px; }
  .ally-btn-ico { width: 21px; height: 21px; }
  .ally-btn-cost { font-size: 0.76rem; }
}
```
**2×2 그리드는 안 쓴다** — 세로 +56px이고, 마을 패널은 이미 하단을 많이 먹어 카메라가
`setLift`로 판을 비켜세우는 중이다(`battlecontroller.ts:371~391`). 세로 픽셀이 이 화면에서
가장 비싼 자원이다.

**(b) 순서 — 맨 앞**
```ts
export const ALL_ALLY_IDS: readonly AllyId[] = ['gatherer', 'clubber', 'slinger', 'guardian'];
```
근거: (a) 기존 주석이 "싼 것부터"라는 규약을 적어 뒀고 채집꾼이 가장 싸다, (b) 채집은
준비 국면의 첫 행동이라 손이 먼저 닿는 자리가 맞다.
**결정론 안전 확인(실측)**: `grep -rn "ALL_ALLY_IDS" src/sim/` → **0건**. 참조처는
`data/allies.ts` · `data/index.ts` · `debug/labs/meshlab.ts` · `ui/screens/battlehud.ts` ·
`ui/widgets/wavepreview.ts` 뿐이다. `raiders.test.ts:120`의 `new Set(allyVars)`도 Set이라
순서 무관.

**(c) 배지 일반화** — `battlehud.ts:465`의 하드코딩을 데이터 기반으로:
```ts
const badge: 'sunder' | 'gather' | null =
  ALLY_DEFS[defId].sunder === true ? 'sunder'
  : (ALLY_DEFS[defId].gatherPct ?? 100) > 100 ? 'gather'
  : null;
```
`.ally-btn-sunder`는 그대로 두고 `.ally-btn-badge--gather { background: linear-gradient(180deg,#b8e06a,#6fa03a) }` 추가.

**(d) 채집 중 인원** — `battlehud.ts:786`의 서명을 늘린다:
```ts
const gathering = s.allies.reduce((n, a) => n + (a.gatherKey >= 0 ? 1 : 0), 0);
const allySig = `${s.allies.length}/${s.allyCap}|${gathering}`;
```
새 span `.ally-gather-num`을 `.home-ally-head`의 `allyCountEl` 뒤에. 그 컨테이너는
`flex-wrap: wrap`(`style.css:458`)이라 폭이 모자라면 줄바꿈된다.

**(e) 자원 패널** — 지금의 `scPanel`(`battlehud.ts:410~417`) 개편
```
┌────────────────────────────────────────────┐
│ [🍓]  딸기 덤불                              │  ← tp-head (아이콘/이름 = 자원 종류)
│ 남은 몫 2/2 · 한 번에 골드 2 · 0.7초마다      │  ← scDesc (.tp-sub)
│ [🧺 채집 보내기] [⛏ 치우기 380] [ ✕ ]        │  ← tp-btns
└────────────────────────────────────────────┘
```
- **`.tp-btn--clear` 클래스와 2단 확인 규약은 그대로 둔다** — e2e `smoke.spec.ts:427/438/451/490`이
  전부 이걸 잡는다.
- 신규 `.tp-btn--gather { background: linear-gradient(180deg,#b8e06a,#6fa03a); }`
- **폭 검산**: `.tp-btn { min-width: 90px }` × 2 + `.tp-btn--close { min-width: 48px }` +
  gap 8 × 2 = **244px ≤ 342px** → `flex-wrap: wrap`(`:708`)이 있지만 줄바꿈 안 난다.
  `min-height: 46px`(`:710`) → 44px 계약 ✅
- **1탭, 확인 없음** (골드를 안 쓴다). `moveAlly{allyId:-1, defId:'gatherer', cellX, cellZ}` →
  성공하면 `clearSelection()` + `showGatherOrder(cell)`.
- 채집꾼이 0명이면 `is-disabled` + `scDesc`에 `battle.res.sendNone`. **이게 채집꾼의 존재를
  알리는 두 번째 자리다.**
- **`battle.scenery.desc`("치우면 이 자리에 타워를 지을 수 있어요")를 `battle.res.desc`로
  바꾼다** — 이 기능이 파는 물건이 「칸」이므로 그 문장이 부제가 아니라 주제여야 한다.

**(f) 첫 사용자 안내 — 배너 1회**
`battlehud.ts:57`의 `pushBanner(className, text)`가 이미 모듈 스코프에 있다.
`showHintBanner(text)` 하나만 더 export하면 끝난다.
```css
.banner--hint { background: linear-gradient(180deg,#b8e06a,#6fa03a); color: var(--ink);
                box-shadow: 0 6px 0 rgba(0,0,0,0.3); font-size: 0.86rem; }
```
**발동 조건**: prep · 웨이브 1 · `profile.data.stats.wavesCleared === 0`.
**새 프로필 플래그를 안 만드는 이유**: `ProfileData`(`types.ts:1127`)에 필드를 늘리면 세이브
스키마가 바뀌고 마이그레이션이 따라온다. `stats.wavesCleared === 0`은 이미 있는 값이고,
대가는 "웨이브를 한 번도 못 깬 사람에게 다시 보인다"뿐이다 — 그건 손해가 아니다.
`.banner-host`는 `pointer-events: none`이라 탭을 하나도 안 먹는다.

### 7-4. i18n — 추가 키 전부 (31키 × 2언어)

⚠ `tests/ui/i18n.test.ts`가 (1) ko/en 키 셋 완전 일치, (2) 빈 문자열 금지,
(3) **`{자리표시자}` 집합 일치**, (4) `ALL_ALLY_IDS` 순회 `nameKey`/`descKey` 존재를 어서션한다.
테스트 제목 "아군 **3종**의 nameKey/descKey"도 **4종**으로 고칠 것.

#### `src/ui/strings/ko.ts`
```ts
  // --- 채집꾼 (4번째 부족) ---------------------------------------------------
  'ally.gatherer.name': '채집꾼',
  // {g} = 채집 배수(전투 3종 대비). battlehud의 allyDesc가 주입한다.
  'ally.gatherer.desc': '캐는 손이 {g}배 빨라요. 대신 싸움에는 못 나서요',

  // --- 자원 8종 --------------------------------------------------------------
  'res.berry.name': '딸기 덤불',      'res.berry.tag': '금세 캐요. 대신 금세 떨어져요',
  'res.honey.name': '벌집',           'res.honey.tag': '한 번에 통째로 나와요',
  'res.mushroom.name': '버섯 무리',   'res.mushroom.tag': '잘게 나와서 언제 그만둬도 손해가 적어요',
  'res.fruit.name': '열매나무',       'res.fruit.tag': '나무 하나에 열매가 잔뜩 달렸어요',
  'res.flint.name': '부싯돌',         'res.flint.tag': '돌치고는 빨리 캐져요',
  'res.wood.name': '통나무',          'res.wood.tag': '무난해요. 어디서나 나요',
  'res.stone.name': '돌무더기',       'res.stone.tag': '오래 걸려요. 대신 많이 나와요',
  'res.obsidian.name': '흑요석',      'res.obsidian.tag': '가장 오래 걸리고 가장 값나가요',

  // --- 자원 패널 -------------------------------------------------------------
  'battle.res.desc': '다 캐면 이 자리가 빈 땅이 돼서 타워를 지을 수 있어요',
  'battle.res.left': '남은 몫 {n}/{m}',
  'battle.res.yield': '한 번에 골드 {g} · {s}초마다',
  'battle.res.send': '채집 보내기',
  'battle.res.sendNone': '채집꾼이 없어요 — 마을에서 뽑으세요',
  'battle.res.busy': '{n}명이 캐는 중',
  'battle.res.depleted': '다 캤어요 — 이제 여기에 지을 수 있어요',
  'battle.res.fightFirst': '적이 가까우면 캐다 말고 싸워요',

  // --- 부족 패널 -------------------------------------------------------------
  'battle.ally.gather': '채집 특화',
  'battle.ally.gatherHint': '자원 칸을 찍으면 다른 부족원보다 {g}배 빨리 캐요',
  'battle.ally.gathering': '⛏ {n}명 채집 중',
  'battle.ally.rulesGather': '자원 칸을 찍으면 캐요',

  // --- 첫 사용자 안내 --------------------------------------------------------
  'battle.hint.gather': '🍓 딸기·나무·돌은 캘 수 있어요 — 부족원을 탭하고 그 칸을 찍어 보세요',
```

#### `src/ui/strings/en.ts`
```ts
  'ally.gatherer.name': 'Gatherer',
  'ally.gatherer.desc': 'Harvests {g}× faster. Useless in a fight',

  'res.berry.name': 'Berry Bush',       'res.berry.tag': 'Quick to pick, quick to run out',
  'res.honey.name': 'Honeycomb',        'res.honey.tag': 'Comes out all at once',
  'res.mushroom.name': 'Mushroom Patch','res.mushroom.tag': 'Comes in small bites — quitting costs little',
  'res.fruit.name': 'Fruit Tree',       'res.fruit.tag': 'One tree, a whole crop',
  'res.flint.name': 'Flint',            'res.flint.tag': 'Fast, for a rock',
  'res.wood.name': 'Timber',            'res.wood.tag': 'Steady. Grows everywhere',
  'res.stone.name': 'Stone Pile',       'res.stone.tag': 'Slow going — but there is a lot of it',
  'res.obsidian.name': 'Obsidian',      'res.obsidian.tag': 'The slowest and the richest',

  'battle.res.desc': 'Gather it out and the tile becomes open ground you can build on',
  'battle.res.left': 'Left {n}/{m}',
  'battle.res.yield': '{g} gold every {s}s',
  'battle.res.send': 'Send gatherers',
  'battle.res.sendNone': 'No gatherers — train one in the village',
  'battle.res.busy': '{n} gathering',
  'battle.res.depleted': 'Emptied — you can build here now',
  'battle.res.fightFirst': 'They drop the work to fight when enemies close in',

  'battle.ally.gather': 'Gathers fast',
  'battle.ally.gatherHint': 'Sent to a resource tile, gathers {g}× faster than the others',
  'battle.ally.gathering': '⛏ {n} gathering',
  'battle.ally.rulesGather': 'tap a resource tile and they gather it',

  'battle.hint.gather': '🍓 Berries, timber and stone can be gathered — tap a tribesman, then tap the tile',
```

⚠ `allyDesc` 헬퍼(`battlehud.ts:189~190`)가 지금 `{ n: ALLY_BLOCK_CAPACITY }`만 넘긴다 →
`{ n: ALLY_BLOCK_CAPACITY, g: 3 }`으로 늘려야 `ally.gatherer.desc`의 `{g}`가 채워진다.
쓰이지 않는 키는 무시되므로 나머지 3종에 영향이 없다.

---

## §8. 밸런스

### 8-1. 실측 기준선 (원장 직접 조회, `tests/sim/__ledger__/autoplay.json`)

| 다리 | 실측 | 문턱 | 여유 |
|---|---|---|---|
| `5.gold` (방치 최종 골드) | **487** | ≤ 500 | **13골드** ← 저장소에서 가장 얇은 골드 문턱 |
| `1b.slack` (최강 팔 여유) | **49.33%** | ≤ 55% | 5.67%p |
| `1b.slackMedian` | 48.00% | ≤ 55% | 7.00%p |
| `2.perGame` (판당 파괴) | **5.725** | ≥ 5.0 | 0.725 |
| `1a.clearRate` | **80.63% (129/160)** | ≥ 65% | 15.6%p |
| `6.discord` | **2/80 (2.50%)** | — | — |
| `6.dozer.notDominant` | 승 67/80 대 65/80 | — | **MDE 3판/80** ← 저장소에서 가장 얇은 다리 |
| `8.perHead` | 53.33 | — | — |

> ⚠ 렌즈 3이 "기준선 재현값이 원장과 정확히 일치한다"고 적었으나 **두 다리가 다르다**:
> `1a.clearRate` 80.00%(80시드) vs 원장 **80.63%(160시드)**, `2.perGame` 5.688 vs 원장
> **5.725**. 상한 유도는 `1b.slack`(160시드로 일치) 쪽 근거만으로도 서지만,
> "두 독립 다리가 같은 구간에서 함께 무너진다"는 주장은 반쪽 표본에 기댄다.
> **§10 트랙 T0에서 원장과 같은 창·같은 시드 수로 다시 잰다.**

### 8-2. 채집 상한 — 렌즈 3의 수입 주입 A/B 실측

| 주입 (판당 순증) | `1b.slack` | `2.perGame` | 판정 |
|---|---|---|---|
| 0 (기준선) | 49.33% | 5.725 | ✓ |
| 총 300 (w1~10 분납) | **49.20%** | — | ✓ 기준선과 **구분 불가** |
| 총 450 | 44.85% | 5.400 | ✓ |
| 총 600 | 54.52% | 5.275 | ✓ (여유 0.48%p) |
| **총 800** | **56.40%** | 5.100 | **✗ 빨강** |
| 총 800 (w1~**40** 분산) | **56.10%** | — | **✗ 빨강** |
| 총 1,200 | 60.55% | **4.713** | ✗✗ |

**두 발견:**
① **타이밍은 거의 무관하다.** 같은 800골드를 몰든 펴든 56.40% 대 56.10%. "후반으로 미루면
   안전하다"는 완화를 실측이 부정한다 — 상한은 **총액**에 걸린다.
② 상한은 **판당 순증 700~800골드 ≈ 총수입(22,166)의 3.0~3.4%**.

### 8-3. 정량 목표와 설계값

| | 값 | 유도 |
|---|---|---|
| **하한 (할 게 생겼다)** | w1~10 창 안에 **≥ 220골드** = 그 창 수입(1,110골드 실측)의 20% | 창움막 T1 배치 실비용이 90~150이다. 220골드면 초반에 타워 1~2기를 앞당긴다 = 화면에서 읽히는 크기 |
| **상한 (타워가 무의미해진다)** | 판당 순증 **> 700골드** | §8-2 실측 |
| **설계값** | 판당 순증 **360골드 = 총수입의 1.6%** (gross 504) | 300에서 `1b.slack`이 기준선과 구분 불가, 450에서 `2.perGame` 5.400. 문턱 대비 여유 4~5%p |
| **절대 상한 (넘기면 즉시 되돌린다)** | 칸당 평균 `G_avg` **≤ 18** (맵 720) | 22 = 금지선 |

**설계값 `G_avg = 12.59`** (§1 검산). 칸당 12.59는 s1 40칸 기준이고 s2~s6은 40~51칸이지만
후반 스테이지는 총수입이 훨씬 커서 **비율은 더 작다** — s1이 가장 빡빡한 자리다.

### 8-4. 지배 전략 억제 장치

| 시나리오 | 억제 |
|---|---|
| **① 채집꾼 도배 → 코인 폭발** | (a) **정원을 나누지 않는다** — `BASE_LEVELS`(`hometown.ts:300~311`)를 한 자도 안 건드리고 `allyCapFor`도 그대로다. 채집꾼 1명 = 전투 아군 1명 포기가 진짜 대가다. (b) 총액이 `셀 수 × G`로 **닫혀 있다** — 인원을 늘리면 같은 골드를 더 빨리 받을 뿐 총액이 안 는다. (c) 채집꾼은 `blocks:false`라 `allyBlockTicks`에 **구조적으로 0**을 기여하므로 정원을 채집꾼으로 채우면 봉투 [11-b](봉쇄비 ≥ 1.25)가 재는 양이 오히려 준다 |
| **② 안전한 뒤쪽 칸만 캐서 무위험 수입** | **막지 않는다. 대신 그 이득을 코인에서 「칸」으로 옮긴다**(§8-5). 자원 칸은 `buildableCells`(경로가 아닌 칸)에서 뽑히고 스치는 타격은 봉쇄자가 없을 때만 켜지므로(`allies.ts:390`) 경로에서 두 칸 떨어진 채집꾼은 애초에 안 맞는다 — 이건 `hp`로 못 고친다. 새 축("경로 거리에 따른 채집 속도")을 만들지 않는 이유: `siege.ts` 규칙 1이 이미 "경로에서 2~3칸"을 실력 축으로 쓰고 있어 겹치고, 규칙이 하나 는다 |
| **③ prep 무한 파밍** | **존재하지 않는다.** `battle.ts:181~187`이 매 틱 `prepTicksLeft--` 후 `<= 0`이면 `startWave()`를 부른다 — `PREP_TICKS_LATER = 90`(**3.0초**), 플레이어가 연장할 수단이 없다. 채집은 구조적으로 웨이브 중 활동이다(G-9) |
| **④ 자동 이동(G-14)이 무한 루프가 된다** | 8-이웃으로 **한 칸씩만** 번지고, 셀 밀도 0.3은 8-이웃 사이트 퍼콜레이션 임계(≈0.407) **아래**라 군집이 유한하고 작다. 맵 전체가 40~51칸이라 상한도 그것이다. §9의 테스트가 스테이지별 최대 군집 크기를 실측으로 잠근다 |
| **⑤ 첫 탭 없이 수입** | 구조적으로 불가능 — §8-6 |

### 8-5. ⚠ 이 기능이 파는 물건은 「칸」이지 코인이 아니다

산수를 먼저 보자. `EARLY_CALL_RATE = 0.15`(`balance.ts:211`), 50웨이브:
```
조기 호출 50회 = 150×0.15 + 49×(90×0.15) = 22 + 661 = 683골드,  탭 50회 = 13.7골드/탭
```
채집 gross 504골드를 칸당 2탭으로 캐면 80탭 = **6.0골드/탭**으로 **조기 호출에 진다.**
이 부등식이 이 기능의 가장 큰 함정이고, 세 가지로 푼다:

1. **둘은 배타적이지 않다.** 채집꾼은 웨이브 중에도 계속 캔다(G-9: `phase`를 안 본다).
   조기 호출을 누르면서 동시에 캘 수 있다. 실제로 잃는 것은 **명령을 내리는 데 쓴 prep 초**
   뿐이다 — 약 1.5초(45틱) × 명령 횟수 ≈ 10회 = **약 60골드**. 683 + 504 − 60이 답이다.
2. **G-14 자동 이동이 탭을 4~6배 줄인다.** 8-이웃 군집 평균 4칸이면 **[추정]** 40칸을
   약 10번의 명령(20탭)으로 캔다 → **24골드/탭**으로 조기 호출을 넘는다.
3. **진짜 상품은 칸이다.** 같은 칸을 골드로 치우면 `sceneryClearCostFor(n) = round(380 × 1.6ⁿ)`:
   `380 → 608 → 973 → 1,556 → 2,490 → 3,985 → 4,000(상한)`.
   **세 칸만 캐도 1,961골드어치**다. 코인 12.59는 그 옆에서 되먹임 신호이지 수입이 아니다.
   → **UI 문구가 이 순서를 그대로 말해야 한다**(§7-3(e): `battle.res.desc`를 "다 캐면 이
   자리가 빈 땅이 돼서 타워를 지을 수 있어요"로).

### 8-6. 방치 안전성 — 채집 수입이 정확히 0인가

**가장 강한 증명**: `runIdle`(`autoplay.probes.ts:562~571`)은 `callWave` 말고 **어떤 커맨드도
안 낸다.** `trainAlly`가 없으므로 `ctx.world.allies`가 항상 비어 있고, `updateGather`의
`for (const a of gatherOrder)`는 **0번 돈다.** → 채집 수입 = 0. 실측 방치 골드 **487**은
한 자리도 안 움직이고, `5.wave`(≤5)·`5.lost`·`5.seedFree`도 함께 안 움직인다.

**그래도 막아야 할 경로 3개**:

| 경로 | 처방 |
|---|---|
| (a) **스폰 시 기본 명령** — `trainAlly`가 `a.tgtX = spot.x` 를 직접 대입한다. "칸 위에 서 있으면 자동 채집"으로 설계하면 집결 지점이 우연히 자원 칸일 때 뽑기만 해도 수입이 생긴다 | `gatherKey`를 ≥ 0으로 만드는 코드는 **`moveAlly` 안 한 줄(§4-6)뿐**이다. `trainAlly`는 `setGatherTarget`을 부르지 않는다 |
| (b) **채집 완료 후 자동 재개** | G-14로 **인접 8칸까지만** 허용한다. 첫 탭이 없으면 여전히 0이고, 확산은 유한한 군집에 갇힌다 |
| (c) **웨이브 클리어 채집 보너스 / 미채집 자원 정산** | 금지. `addGold` 수입 호출부는 지금 정확히 3곳(`combat.ts:74` · `battle.ts:285` · `battle.ts:339`)이고 **4번째는 `gather.ts`의 한 몫 확정 지점 하나뿐**이어야 한다 |

**신설 다리 `5.gatherZero`**: 창 `idle` 12시드 전부에서 **채집으로 지급된 골드 합 === 0**.
극값 선언 금지 규칙의 예외인 이유는 [13]과 같다 — 여기서 q는 통계가 아니라 **구조적으로 0**
(아군이 0명)이고, 표본을 늘려도 통과 확률이 안 내려간다.

### 8-7. 봉투 [6]과 `clearScenery` — 상품 교체 선언

`6.discord = 2/80 (2.50%)`: 소품 제거가 결과를 바꾸는 판이 80판 중 **2판**이다. 그 상품은
**이미 죽어 있다.** 채집이 같은 결과를 시간으로 사는 경로를 만들면 그 상품의 뜻이
**"시간 대신 골드로 즉시"** 로 바뀐다.

이것은 문턱을 낮추는 것이 아니라 **측정 대상을 교체하는 것**이므로 봉투 규칙에 걸리지
않는다. **다만 그 판단을 코드보다 먼저 명시적으로 내려야 한다** — `6.dozer.notDominant`의
MDE가 **3판/80**이고, 불도저 팔은 "무료 대안이 생긴 세계"를 아직 모른다.
→ §10 **트랙 T0**이 이 재유도를 선행 의무로 못 박는다. 그 결과는 `balance.ts:145~192`의
"다음 사람이 할 일 셋"에 기록한다. 미해결 위험으로 §11에 남긴다.

---

## §9. 테스트 계획

### 9-1. 신규 테스트 파일

| 파일 | 잠그는 것 |
|---|---|
| **`tests/data/resources.test.ts`** (신규) | ① `RESOURCE_WEIGHTS` 6바이옴 전부 존재, 각 표의 합 = 100 정수 ② 모든 `ResourceDef.gold ≥ 2` · `units ≥ 1` · `ticks ≥ 20` ③ `resourceKindOf`가 같은 인자에 늘 같은 값 ④ 6스테이지 전수: `sim.state.resources[i].kind === resourceKindOf(stage, key_i)` ⑤ `sceneryCells` 키 집합 == `sim.state.resources`의 셀 집합 ⑥ **분포 충실도**: 실제 분포가 가중치 대비 **±40%p** 안이고 **어떤 종도 0개가 아니다**(FNV-1a + mulberry32의 인접 시드 품질을 40~51 표본에서 검증) ⑦ **군집 실측**: 8-이웃 자원 군집의 최대 크기를 스테이지별로 기록하고 `≤ 12`를 어서션(G-14의 확산 상한) |
| **`tests/sim/gather.test.ts`** (신규) | G-1~G-14 전 규칙. 특히 ① `dmg`도 `hp`도 아닌 **부분 지급 없음**(G-6: 죽는 틱에 지급 0) ② 한 칸 총 지급 = `total × gold` **정확히**(초과도 미달도 없다) ③ 다 캔 칸이 `canPlaceAt === true`가 된다 ④ 다 캔 칸이 `clearedScenery`에 **안 들어간다**(`clearSceneryCost`가 그 뒤에도 380) ⑤ `gatherPct 0`인 종은 못 캔다 ⑥ 두 명이 같은 틱에 마지막 몫 → 낮은 id가 가져간다 |
| **`tests/sim/gather.idle.test.ts`** (신규, 또는 `autoplay.probes.ts`에 다리 추가) | **`5.gatherZero`** — 창 `idle` 12시드 전부에서 채집 지급 골드 합 === 0 |
| **`tests/render/gatherprops.test.ts`** (신규, 또는 `props.test.ts`에 it 추가) | ① `heroByKind`의 모든 인덱스가 `kit.hero` 범위 안 ② 그 바이옴의 `RESOURCE_WEIGHTS`에 나오는 **모든 종**에 `heroByKind` 항목이 있다(빠지면 런타임에 폴백으로 조용히 넘어간다) ③ `KIND_TIER_W` 각 행의 합 > 0 |

### 9-2. 기존 테스트 중 손봐야 할 것

| 파일 | 변경 | 종류 |
|---|---|---|
| **`tests/sim/determinism.test.ts`** | **`GATHER_SCRIPT` 신설이 필수다** — 이 파일이 스스로 적은 규칙 그대로다("새 커맨드가 해시 커버리지에 없으면 결정론 회귀를 못 잡는다", `:211~217`). 밟아야 할 분기 8개: ① 전원 지정(`allyId −1`)과 개별 ② 한 칸에 둘(G-7·G-8) ③ 채집 중 다른 칸으로 `moveAlly`(G-2) ④ 칸을 끝까지 캐서 고갈 + **자동 이동 발생**(G-14) ⑤ 고갈된 칸에 타워 배치 성공 ⑥ 자원 칸을 골드로 치우기(§4-5) ⑦ 적이 붙어 멈췄다 다시 캐기(G-5) ⑧ 채집 중 사망(G-6) | **신설** |
| `tests/sim/fixtures.ts:114,141` | `ALL_ALLY_IDS`에 `gatherer` 추가. ⚠ **`out = {} as Record<AllyId, AllyDef>` 캐스트를 제거**해 컴파일러가 누락을 잡게 한다 — 지금은 **테스트가 빨개지지 않고 커버리지만 사라지는 유일한 구멍**이다 | 부채 상환 |
| `tests/sim/autoplay.probes.ts:96~103` `PLACEBO_ALLIES` | `gatherer` 행 추가. **`gatherPct`도 0으로 지운다** — 안 지우면 나중에 봇에 채집을 가르쳤을 때 [8]의 골드비 전제가 깨진다. (객체 리터럴이라 `tsc`가 누락을 잡아 준다 — 좋은 소식) | 확장 |
| `tests/sim/botharness.ts:955~958` | ⚠ **`allyOrder`의 하드코딩 `['clubber','slinger','guardian']`을 절대 `ALL_ALLY_IDS`로 "정리"하지 마라.** 그 순간 봉투 [7]·[8]·[10]·[11-b]·[12]·[13]·[14] 일곱 항목이 동시에 흔들린다. 대신 **새 `BotOptions.gather` 팔을 추가**한다(정책은 9-3) | 신설 |
| `tests/render/raiders.test.ts:120` | `new Set([1,2,3])` → `new Set([1,2,3,4])` | 실측 갱신 |
| 같은 파일 `:124` | 변형 어트리뷰트 `new Set([0,1,2,3])` → `new Set([0,1,2,3,4])` | 실측 갱신 |
| 같은 파일 `:190~200` | 채집꾼 단품이 `[400,700]`, 공유본 `< 1250`을 지키는지 — **K ≤ 140을 먼저 확인하라**(§6-6) | 검증만 |
| `tests/render/allies.test.ts:409,541` · `gait.test.ts:83~84` | `ALL_ALLY_IDS` 순회라 4번째 포즈/리그가 없으면 빨강 | 게임 쪽 구현 |
| **`tests/render/props.test.ts:61~70` `STAGE_CAP`** | §5-3의 rng 재편으로 6판이 한 번 바뀐다. **실측 재측정 후 「실측 + 6%」 규약으로 갱신.** `CELL_TRI_BUDGET = 300`은 **유지** | 실측 갱신 |
| 같은 파일 `:430~465` "배치 실측" | 같은 이유로 재측정. **어서션은 한 자리도 안 바꾼다**(≥2 · ≤20% · ≥25% · ≥15%) — §6-4가 통과를 예측한다 | 재측정만 |
| 같은 파일 `:258` 꽃 6각 `FLOWER` 집합 | `berryRed 0xd6203c` · `berryBlue 0x4356c4` · `fruitGold 0xf0a52a` · `cactusPear 0xe0447a` · `honeyGold 0xf5c65a` 추가. 안 넣으면 나중에 누가 열매를 5각으로 바꿔도 테스트가 초록이다 — 그 구멍은 이 파일이 이미 한 번 겪고 막은 것이다 | 확장 |
| `tests/ui/i18n.test.ts:51` | 제목 "아군 **3종**" → **4종**. 키는 자동 강제 | 문구 |
| **`tests/e2e/smoke.spec.ts`** | 소품 제거 테스트(`:394~500`)를 복제해 채집 경로를 잠근다(9-4). **`.tp-btn--clear` 셀렉터·2단 확인은 그대로 둔다** | 신설 |

### 9-3. 봇 `gather` 팔 — 정책 명세 (없으면 봉투가 아무것도 안 잰다)

`botharness.ts:955`의 `allyOrder` 하드코딩 덕에 채집을 넣어도 봉투 7개 항목이 초록인 채로
**아무것도 안 재게 된다.** 그건 `autoplay.test.ts` 헤더가 스스로 금지한 "실패 불가능한
계약"이다. 그래서 **새 팔을 첫 커밋에 넣는다.**

```
BotOptions.gather?: { defId: AllyId; count: number }
정책: 매 prep 시작 시, 아직 잔량이 있는 자원 칸 중
      **마을(baseCell)에서 유클리드 거리가 가장 가까운 칸**을 고른다.
      동점은 **셀 키 오름차순**. 그 칸으로 moveAlly{allyId:-1, defId} 한 번.
      이미 그 종이 채집 중이면 아무것도 안 한다(G-14가 이어받는다).
근거: 사람이 실제로 하는 것(안전 + 가까움)에 가장 가깝고, 동시에 §8-4-②가 걱정한
      "뒤쪽 무위험 파밍"의 **상한 경우**다 — 봉투가 최악을 재게 된다.
```
`envelope.ts`의 `DataPatch`에도 `gather` 훅을 만든다. 안 만들면 `controls.ts:449`가
`SCENERY_CLEAR_BASE_COST`에 대해 적어 둔 처지("주입구가 없다 → UNPROVEN 행")가 반복된다.

**신설 다리 `7.gather.*`** — [7]의 형식(`autoplay.probes.ts:772~788`)을 그대로 쓴다:
`7.gather.notDominant`(채집 팔이 기준선을 지배하지 않는다) · `7.gather.rateCap`(채집 골드가
총수입의 3.0% 이하) 두 개.

### 9-4. e2e 신설 케이스

1. 전투 진입 → `resourceList()`로 화면 안쪽 자원 칸 하나 선택
2. 탭 → `selectedScenery()`가 그 칸 · `.tp-btn--gather` 가시 + `boundingBox().height >= 44`
3. 채집꾼 0명 → `.tp-btn--gather`에 `is-disabled`, `pointerEvents === 'none'`
4. `requestTrainAlly('gatherer')` 후 → 활성화 → 클릭 → `__wgd.allies()`에서 그 개체의
   `tgtX/tgtZ`가 목표 칸 중심
5. `ff(N)` → `sim.state.gold` 증가 + 해당 칸 `left` 감소 → 0이 되면 `canPlaceAt === true`
6. **`ff`를 커맨드 없이 돌리면 골드가 안 는다** (봉투 A의 e2e 쪽 짝)
7. 그 프레임 전후 드로우콜이 **안 늘어난다**(≤ 60 유지)

`__wgd` 훅(`battlecontroller.ts:492~620`)에 2개 추가:
```ts
resourceList: (): { x: number; z: number; kind: ResourceId; left: number; total: number }[] => ...,
sendGatherers: (x: number, z: number): boolean =>
  this.sim.applyCommand({ type: 'moveAlly', allyId: -1, defId: 'gatherer', cellX: x, cellZ: z }),
```

---

## §10. 구현 순서 — 병렬 트랙

파일 소유권이 **겹치지 않는다.** 같은 파일을 두 트랙이 만지는 곳은 없다.

### T0 — 봉투 재유도 (**단독 선행. 이게 끝나기 전에는 아무도 `gold`를 켜지 않는다**)
- **파일**: `tests/sim/autoplay.test.ts` · `tests/sim/__ledger__/autoplay.json` ·
  `src/data/balance.ts`(주석만)
- **선행**: 없음
- **할 일**: ① `6.dozer.notDominant`·`6.discord`를 원장과 **같은 창·같은 시드 수**로 다시 재고,
  §8-7의 "상품 교체" 판단을 `balance.ts:145~192`에 기록한다. ② `1a.clearRate`(160시드)와
  `2.perGame`(5.725) 기준선을 재확인하고 §8-2의 상한 곡선을 그 표본으로 다시 유도한다.
- **완료 판정**: 재유도 결과가 원장에 기록되고, 채집 순증 상한(현재 700~800골드)이
  **160시드 표본으로** 확정된다.

### T1 — 데이터/타입 (모든 트랙의 뿌리)
- **파일**: `src/data/types.ts` · **`src/data/resources.ts`(신규)** · `src/data/allies.ts` ·
  `src/data/index.ts`
- **선행**: 없음 (T0과 병행 가능)
- **할 일**: §3 전부 · §5-1 전부 · §1 표 · §2 `gatherer` AllyDef + 3종 `gatherPct` ·
  `ALL_ALLY_IDS` 순서 변경
- **완료 판정**: `npm run typecheck`가 **의도한 곳에서만** 터진다 —
  `PLACEBO_ALLIES`(`Record<AllyId,...>` 리터럴) · `ALLY_ICON_SVG` · `ALLY_VARIANTS` ·
  `ALLY_ATTACKS`. `tests/data/resources.test.ts`(§9-1) 초록.
  ⚠ **`RESOURCE_DEFS[*].gold`를 전부 0으로 두고 시작한다** — T6까지 켜지 않는다.

### T2 — sim
- **파일**: **`src/sim/gather.ts`(신규)** · `src/sim/battle.ts` · `src/sim/entities.ts` ·
  `src/sim/allies.ts`
- **선행**: T1
- **할 일**: §4 전부 (ResourceField · updateGather · 삽입 위치 4-b · resetAlly 2줄 ·
  해시 접기 2자리 · hasScenery/canPlaceAt · cmdClearScenery 2줄 · moveAlly 1줄 ·
  `ARRIVE_EPS2`와 `fillAllyIdOrder`를 `entities.ts`로 이관)
- **완료 판정**: `tests/sim/gather.test.ts` + `GATHER_SCRIPT` 8분기 초록.
  **`gold: 0` 상태에서 `tests/sim/__ledger__/autoplay.json`이 한 자리도 안 움직인다** —
  움직이면 채집이 커맨드 밖으로 샌 것이고, 그건 계약 A의 사전 경보다.

### T3 — 렌더: 소품/자원
- **파일**: `src/render/meshlib/props.ts` · `src/render/stage3d.ts`
- **선행**: T1 (`ResourceId` + `resourceKindOf`)
- **할 일**: §6-2 (BiomeKit.heroByKind · buildProps 시그니처 · 셀 단위 rng · KIND_TIER_W ·
  markCellDead/flushRemovals) · §6-3 신규 원형 6개 + 팔레트 7색 + `PROP_ELEMENTS` 등록
- **⚠ 순서를 뒤집어라**: 자원표 확정 → 원형 굽기가 아니라, **원형 6개를 먼저 굽고
  `npx vitest run tests/render/props.test.ts`를 돌려 실측한 뒤** 바이옴 편성 가중치와
  `KIND_TIER_W`를 그 실측에 맞춘다(§6-5의 표는 실측이 아니라 모델이다).
- **완료 판정**: `props.test.ts` 6개 스테이지 전부 초록 —
  **어서션 상수(≥2 · ≤20% · ≥25% · ≥15% · `CELL_TRI_BUDGET 300` · `PROTO_TRI_BUDGET 140`)는
  한 자리도 안 바꾸고**, `STAGE_CAP`만 실측 + 6%로 갱신.

### T4 — 렌더: 채집꾼 유닛
- **파일**: `src/render/meshlib/enemies.ts` · `src/ui/widgets/card.ts`
- **선행**: T1 (`AllyId`)
- **할 일**: §6-6 (`kitGatherer` **K ≤ 140** · `ALLY_ATTACKS` 4번째 포즈 ·
  `ALLY_VARIANTS.gatherer = 4` · `ALLY_ICON_SVG.gatherer` SVG 1개)
- **완료 판정**: `tests/render/raiders.test.ts`(`{1,2,3,4}` 갱신 후) · `allies.test.ts` ·
  `gait.test.ts` 초록. **아군 공유본 삼각형 실측을 로그에 남기고 1,250 대비 여유를 적는다.**

### T5 — UX / UI / 연출
- **파일**: `src/game/placement.ts` · `src/game/battlecontroller.ts` ·
  `src/ui/screens/battlehud.ts` · `src/ui/strings/{ko,en}.ts` ·
  `src/render/views/{decals,healthbars,fx,enemyview}.ts` · `src/style.css`
- **선행**: T2 (이벤트 3종) · T1 (i18n 키가 참조할 `AllyId`/`ResourceId`)
- **할 일**: §7 전부 (탭 1줄 · `showGatherOrder` · `barKind 6` 잔량 막대 · 팝업 ·
  `GATHER_FX_MAX 4` · 4번째 카드 + CSS · 자원 패널 · `showHintBanner` · i18n 62문자열 ·
  `enemyview`의 채집 위상 · `flushSceneryRemovals` 호출)
- **완료 판정**: `tests/ui/i18n.test.ts` 초록 · 320/360/390px 실측 스크린샷에서 버튼 높이
  48px · `.tp-btn--gather` 44px 이상 · e2e 드로우콜 **≤ 60 유지**.

### T6 — 밸런스 켜기 + 검증
- **파일**: `tests/**` 전부 · `src/data/resources.ts`의 `gold` 열만
- **선행**: **T0 · T1 · T2 · T3 · T4 · T5 전부**
- **할 일**: ① 봇 `gather` 팔 + `DataPatch.gather` 훅(§9-3) + `7.gather.*` 다리 2개 +
  `5.gatherZero` ② `gold`를 §1 표 값으로 **켠다** ③ 4블록 스윕으로 순증을 확인한다 —
  목표 **360골드**, 절대 상한 `G_avg 18`(맵 720)
- **완료 판정**: `npm test` 전체 초록 · `npm run typecheck` 초록 · e2e 6스테이지에서
  드로우콜 ≤ 90 / 삼각형 ≤ 150,000 · 원장 재측정 결과가 **어떤 문턱도 낮추지 않고** 통과.

**병렬 그래프**
```
T0 ─────────────────────────────────────────────┐
T1 ─┬─ T2 ─┬────────────────────────────── T5 ─┼─ T6
    ├─ T3 ─┤                                    │
    └─ T4 ─┘                                    │
```

---

## §11. 미해결 위험

정직하게 적는다.

1. **[치명, 부분 해결] 봉투 [6]의 상품 교체.** `6.dozer.notDominant`의 MDE가 **3판/80**으로
   저장소에서 가장 얇고, 채집은 `clearScenery`에 무료 대안을 만든다. §8-7에서 "이건 문턱을
   낮추는 것이 아니라 측정 대상을 교체하는 것"이라 판단했고 T0을 선행 의무로 못 박았지만,
   **T0의 재유도 결과가 어떻게 나올지는 아직 모른다.** 세 판만 갈리면 빨개진다. T0에서
   빨개지면 이 설계가 아니라 **[6] 다리의 정의**를 다시 써야 하고, 그 판단은 이 문서 밖이다.

2. **[치명, 미해결] G-14 자동 이동은 계약 A의 문언을 넓힌다.** 봉투의 요구는 "방치하면
   진다"이고 그건 구조적으로 안전하다(부족원 0명). 그러나 사용자가 이 봉투에 적은 문장은
   **"플레이어가 탭을 해야만 코인이 들어와야 한다"** 이고, G-14는 **탭 1회로 평균 4칸**을
   캔다. 이건 "탭 없이 코인"이 아니라 "탭 하나가 더 많은 코인"이지만, **문언의 해석을 넓힌
   것은 사실이다.** G-14 없이는 §8-5의 조기 호출 부등식(6.0 대 13.7 골드/탭)을 못 넘으므로
   기능이 손해 보는 잡일이 된다 — 그래서 넣었다. **사용자 확인이 필요한 유일한 항목이다.**
   되돌리는 값은 작다: `pickNeighborNode`가 항상 −1을 돌려주게 하면 끝난다.

3. **[중] §6-4의 "큰것(1.4+) ≥ 25%"는 예측이지 실측이 아니다.** `KIND_TIER_W`의
   `P(1.4+ | 큰 종) ≈ 0.7`이 **[추정]**이고, 설원(52%)·늪(50%)이 가장 얇다. 0.48 아래로
   내려가면 깨진다. T3의 "원형을 먼저 굽고 실측한 뒤 가중치를 맞춘다" 순서가 유일한 방어다.

4. **[중] §6-5의 삼각형 Δ 표는 모델이고, §5-3의 rng 재편이 6판을 통째로 한 번 바꾼다.**
   실제 분산원은 Δ가 아니라 셀 구성의 시드 추첨이다. s1(여유 207)·s6(여유 334)이 가장
   빡빡하고, 부호가 뒤집히면 `STAGE_CAP`을 실측 + 6%로 올려야 한다. 그건 문턱이 아니라
   실측 잠금이므로 규칙 위반은 아니지만, **얼마나 올려야 하는지는 아직 모른다.**

5. **[중] 상한 700~800골드는 반쪽 표본에 기댄 부분이 있다.** `1b.slack`(160시드)은 원장과
   일치하지만 `2.perGame`(렌즈 3 5.688 vs 원장 5.725)은 다르다. "두 독립 다리가 같은 구간에서
   함께 무너진다"는 주장의 절반이 재측정 대상이다. T0에서 다시 잰다.

6. **[중] 채집꾼 `hp 120`은 밸런스 손잡이가 아니다.** 경로에서 두 칸 이상 떨어진 자원 칸의
   채집꾼은 **한 대도 안 맞는다**(`allies.ts:390`: 봉쇄자가 있으면 `brushTarget`이 아예 호출
   안 된다 + 자원 칸은 정의상 경로 밖). 무릿매 `hp 80`이 8단계까지 앓은 병과 같은 형태다.
   §8-4-②에서 "이득을 코인에서 칸으로 옮긴다"로 무해화했지만, **그 무해화는 §8-5의 축 전환이
   실제로 플레이어에게 그렇게 읽힐 때만 성립한다.**

7. **[경] 첫 웨이브의 수지가 여전히 마이너스다.** 채집꾼 70골드 + prep 3초 중 1.5초를 명령에
   쓰면(조기 호출 −6골드) 첫 두 웨이브의 채집 수입(약 8~15골드)으로는 회수가 안 된다.
   회수 지점은 **첫 칸이 열리는 순간**(= 380골드어치 부지)이고, 그것이 화면에서 "타워를
   지을 자리가 생겼다"로 읽혀야 한다. §7-3(e)의 문구 변경이 그 전부다. **[추측]** 첫 칸이
   길목 옆이면 읽히고, 구석이면 안 읽힌다 — 자원 배정은 위치를 안 본다.

8. **[경] `props.ts`의 셀 단위 rng 전환은 시각적 회귀 검증이 없다.** 테스트가 잠그는 것은
   삼각형 수와 높이 분포이지 "판이 예쁜가"가 아니다. T3 완료 시 6스테이지 캡처를 눈으로
   비교해야 한다.

9. **[경] 모바일 실기기 성능 미측정.** `flushRemovals` 코얼레싱 후 최악 1.4ms/1.21MB는
   **데스크톱 node 실측**이다. 모바일이 그 3~5배라는 것은 **[추측]**이고 실기기 측정이 없다.

10. **[경] 8-이웃 군집 크기 평균 4칸은 [추정]이다.** 퍼콜레이션 임계 아래라 유한하다는 것은
    확실하지만, 실제 평균과 최대는 §9-1의 신규 테스트가 처음 잰다. 최대가 12를 넘으면
    G-14의 확산 상한을 다시 정해야 한다(그때는 홉 카운터를 도입한다).
