/**
 * 채집 — 부족원을 자원 칸에 붙여 캐게 하고, **마을까지 지고 오면** 코인을 준다.
 * **결정론 100% (rng 미사용).** 규칙 전문은 docs/gather-spec.md §4, 자원 표는 data/resources.ts.
 *
 * three/DOM 임포트 금지 — `@/data/*` + `./{combat,entities}` 만 쓴다.
 * (`isGathering`·`gatherTicksFor`·`ARRIVE_EPS2`는 **여기 없다** — 렌더가 같은 함수를 써야
 *  하므로 `@/data/resources`에 있다. 렌더는 `@/sim`을 임포트할 수 없다.)
 *
 * ── 상태 흐름 ──────────────────────────────────────────────────────────────
 *   가는 중 → 캐는 중 → **지고 오는 중** → 마을 배달 → (자동) 다음 칸
 * ⚠ **D4("자동 이웃 이동은 없다")는 규칙 8이 뒤집었다.** 이 파일은 여전히 다음 칸을
 *   고르지 않는다 — 배달 뒤 `tgt`를 지금 자리에 박고 **서는 것까지**가 이 파일의 일이고,
 *   그 자리에서 다음 칸을 잡는 것은 같은 틱의 8-c(`allies.ts updateAllyAuto`)다.
 *   곧 채집의 진행 규칙과 "다음에 무엇을 할까"가 파일 단위로 갈려 있다.
 * 셋 중 어느 것도 열거값으로 저장하지 않는다. 넷(+1)의 필드에서 전부 유도된다:
 *   가는 중   = gatherKey >= 0 && 목표에 아직 도착 안 함
 *   캐는 중   = gatherKey >= 0 && 목표에 도착함        ← isGathering(a)
 *   짐을 졌다 = carryCount > 0                        ← 운반 중이든 서 있든 같은 값
 *   전투 불능 = 캐는 중 || carryCount > 0             (D5, allies.ts updateAllies)
 *
 * ── 이 파일이 지키는 계약 셋 ────────────────────────────────────────────────
 *  A) **사람이 없으면 코인도 없다.** (규칙 8 이전에는 "탭이 없으면"이었다 — 자동 행동이
 *     들어오면서 **철회**됐다.) `gatherKey`를 0 이상으로 만드는 코드는 여전히
 *     `setGatherTarget` 하나뿐이지만, 그것을 부르는 곳은 이제 **둘**이다:
 *     `allies.ts moveAlly`(사람의 명령)와 `allies.ts updateAllyAuto`(규칙 8의 자동).
 *     **둘 다 살아 있는 아군을 순회한다** — 곧 `trainAlly`를 한 번도 안 낸 판은 순회가
 *     0번 돌아 수입 경로가 **존재하지 않는다**(봉투 [5]·`18.idleZero`의 새 근거).
 *     `trainAlly`의 집결 이동은 `a.tgtX/tgtZ`를 직접 대입하므로 이 통로를 **안 탄다**.
 *  B) **자료구조의 순회 순서에 결정론을 걸지 않는다.** `ResourceField.list`는 생성 시
 *     셀 키 오름차순으로 굳고 그 뒤로 재정렬도 삭제도 추가도 없다 — **재생이 들어와도
 *     그대로다**(칸은 사라지지 않고 `taken` 이 false 로 돌아올 뿐이다).
 *     ⚠ **재고 게이트가 들어오면서 `updateRegrow` 의 이벤트 순서가 옮겨졌다.** 셀 키
 *     오름차순이 아니라 **`(regrowAt 오름차순, 셀 키 오름차순)`** 이다(= 자격을 먼저 얻은
 *     칸부터). 그 순서는 `updateRegrow` 가 `list` 안에서 최솟값을 **훑어서** 고르므로
 *     여전히 자료구조 구현과 무관하고, 동률이 셀 키로 닫히는 것은 `list` 자체가 셀 키
 *     오름차순이고 비교가 **엄격 부등호**라서다. 그 정렬은 이제 **결정론의 일부다** —
 *     비교식을 고치면 이벤트 순서와 해시 궤적이 함께 움직인다.
 *     아군 순회는 언제나 id 오름차순(`fillAllAllyIds`)이다.
 *  C) **`combat.ts`를 한 줄도 안 고친다.** 맞았는지는 `AllySim.gatherHpMark` 비교로 안다 —
 *     `damageAlly`가 채집을 끊어 주게 만들면 `combat ↔ gather` 값 순환이 생긴다.
 *
 * ── ⚠ 다 캔 칸은 **사라지고 건설 가능해진다** (D1 뒤집힘) ────────────────────
 * 옛 규칙은 "다 캔 칸은 그루터기로 남고 건설 불가를 유지한다"(D1)였다. **사용자가 그
 * 판정을 뒤집었다** — *"채집을 하고 나면 그자리에 없어져야 하는데 그대로 남아 있어"*.
 * 그러므로 짐이 확정되는 순간 그 칸은 비고, `battle.ts grown()` 이 그 사실을 읽어
 * `canPlaceAt`/`hasScenery` 를 함께 연다. 안 그러면 **화면에 아무것도 없는데 못 짓는 칸**이
 * 되고 그건 설명할 방법이 없다.
 *
 * 이 파일은 여전히 `battle.ts` 의 `scenery` Set 에 **한 글자도 안 닿는다** — 그 집합의 뜻은
 * "유료로 치우지 않았다" 하나로 남고(유료 제거 지수 `clearedScenery` 도 채집이 한 톨도
 * 안 올린다), 건설 가능은 그 집합과 `taken` 의 **곱**이 정한다. 카운터 둘이 서로를 안 보는
 * 것이 유일하게 안전한 배치다.
 *
 * ── 재생 (R1~R6) ───────────────────────────────────────────────────────────
 * 다 캔 칸은 영구가 아니다. **같은 종·같은 값**으로 돌아온다(`updateRegrow`, 8-a).
 * 그것이 D1을 뒤집은 대가의 완화 장치다 — 채집이 여는 칸은 공짜 영구 건설칸이 아니라
 * **언젠가 닫히는 창**이다.
 *
 * ⚠⚠ **방아쇠가 시간에서 재고 비율로 옮겨졌다** (사용자 요구: *"전체적으로 자원의 일정
 *   비율 이하가 되면 자원이 다시 생성되도록"*). 규칙은 둘로 갈린다:
 *     **언제 켜지는가** = 밭의 재고가 문턱 아래인가 (`GATHER_REGROW_STOCK_FRAC`)
 *     **누가 자격이 있는가** = `regrowsLeft > 0` 그리고 텄던 뒤 최소 지연이 지났는가
 *                              (`GATHER_REGROW_TICKS`, 웨이브마다 조금씩 짧아진다)
 *   켜지면 자격 있는 칸을 **재고가 문턱에 닿을 때까지만** 되살린다.
 * ⚠⚠ **횟수는 안 건드린다.** 게이트는 "언제 자라는가"만 바꾸고 "몇 번 자라는가"는 그대로
 *   `regrowsLeft` 가 정한다. 그래서 판당 총액 항등식 Σ value × (1 + regrowsLeft@생성) 이
 *   한 자리도 안 움직이고 봉투 `18.rateCap` 이 그 자리에 그대로 선다.
 * 그 창을 영구로 바꾸는 유일한 수단이 **그 자리에 타워를 짓는 것**이고(`burnRegrow`),
 * 그것이 이 기능이 만드는 진짜 선택이다: *지금 지을까(칸을 영구히 얻고 그 자원을 태운다),
 * 두고 계속 캘까(수입은 계속되지만 T틱마다 그 칸이 다시 막힌다).*
 * 예외 둘: **광물은 안 자란다**(R4, `REGROWABLE_KINDS`) · **유료로 치운 칸은 안 자란다**
 * (R-f, `takeCell(burn = true)`) — 돈 내고 치운 칸이 다시 막히면 그건 사기다.
 */
import {
  GATHER_BASE_VALUE,
  GATHER_DELIVER_RANGE,
  GATHER_REGROW_DELAY_MIN_MUL,
  GATHER_REGROW_MAX,
  GATHER_REGROW_STOCK_FRAC,
  GATHER_REGROW_TICKS,
  GATHER_REGROW_WAVE_SPEEDUP,
  gatherValueFor,
} from '@/data/balance';
import {
  REGROWABLE_KINDS,
  RESOURCE_DEFS,
  gatherTicksFor,
  isGathering,
  resourceKindOf,
} from '@/data/resources';
import type { ResourceCellState, StageDef } from '@/data/types';
import { addGold } from './combat';
import { fillAllAllyIds, type AllySim, type SimCtx } from './entities';

/**
 * 자원 칸 밭 — 판이 시작될 때 목록이 굳고 **상태 셋(`taken`·`regrowAt`·`regrowsLeft`)만
 * 변한다.** `kind`·`value` 는 생성 시 굳어 절대 안 변한다(재생도 그 둘을 다시 뽑지 않는다).
 * `SimCtx`가 소유한다.
 *
 * 목록과 색인을 함께 드는 이유: 조회는 키 하나로 끝나야 하고(`at`), 순회는 **언제나
 * 배열**이어야 한다(계약 B). Map을 순회하면 그날부터 결정론이 자료구조 구현에 의존한다.
 */
export class ResourceField {
  /** 순회는 **언제나 이것**. 셀 키 오름차순 고정, 원소가 빠지는 일이 없다 */
  readonly list: readonly ResourceCellState[];
  /** 조회 전용. **절대 순회하지 않는다** */
  private readonly index = new Map<number, ResourceCellState>();

  /**
   * 자격을 얻기까지의 **최소 지연**(웨이브 1 기준). `delayAt` 이 읽는다. 밭이 들고 있는
   * 이유는 주입구가 여기 하나로 모여야 "되돌리는 손잡이는 하나"가 유지되기 때문이다.
   * 기본값은 `GATHER_REGROW_TICKS`.
   */
  readonly regrowTicks: number;

  /**
   * **재생 가능 총량 기준값** = 판 시작 시점 재생종 칸의 value 합. 재고 비율의 **분모**다.
   *
   * ⚠ **좌표만의 함수다** — `resourceKindOf` 는 셀 단독 해시이고 `REGROWABLE_KINDS` 는
   *   상수이며 `gatherValueFor` 는 마을거리의 함수다. 곧 시드에도 판 진행에도 안 걸리고,
   *   그래서 재고는 계산이 아니라 **사실**이다(`18.rateCap` 의 총액과 같은 성질).
   * ⚠ **광물은 분자에도 분모에도 없다.** 광물은 재생에 영영 응답하지 못하는데 분모에 넣으면
   *   재고 천장이 영구히 내려앉는다 — s6(화산)은 재생종이 총액의 17.2%뿐이라 게이트가
   *   **상시 켜짐**으로 굳는다. 유도 전문은 `balance.GATHER_REGROW_STOCK_FRAC` 주석.
   * ⚠ **영구 소멸한 재생종 칸은 여기서 안 빠진다**(생성 시 굳는 값이므로 뺄 수도 없다).
   *   그 선택의 근거 셋도 같은 주석에 있다.
   */
  readonly regrowDenom: number;

  /**
   * 재생을 켜는 **재고 하한을 value 단위로 옮긴 값** = `문턱 × regrowDenom`.
   * 비율이 아니라 절대값으로 들고 있는 이유는 `updateRegrow` 가 매 틱 나눗셈을 안 하게
   * 하려는 것이고, 그 덕에 되살릴 때마다 `standing += value` 만으로 비교가 이어진다.
   *
   * ⚠ `regrowDenom === 0`(재생종이 하나도 없거나 짐값이 전부 0인 밭)이면 비율이 정의되지
   *   않는다. 그때는 `Infinity` 를 넣어 **옛 규칙(순수 타이머)** 으로 닫는다 — 게이트를
   *   0으로 닫아 버리면 "재생이 있어야 할 밭인데 영영 안 자란다"가 되어 더 나쁘다.
   */
  readonly regrowNeed: number;

  /** 웨이브마다 최소 지연이 줄어드는 비율 (0 = 웨이브 의존 없음). `delayAt` 이 읽는다 */
  readonly regrowWaveSpeedup: number;

  /**
   * @param scenery `battle.ts`가 들고 있는 소품 셀 집합. **읽기만 한다** — 채집은
   *   이 집합을 절대 안 바꾼다(건설 가능은 그 집합과 `taken` 의 곱이 정한다).
   * @param baseValue 짐값의 기준 크기. 기본값이 `GATHER_BASE_VALUE` 하나라 "되돌리는
   *   손잡이는 하나"(D9)가 그대로 지켜진다.
   *   ⚠ **그래도 옵션이어야 한다**: 주입구가 없으면 봉투가 짐값 축을 A/B할 수 없어
   *   대조군 `gather-x4`를 못 만들고, 그러면 채집 다리들이 전부 UNPROVEN으로 태어난다
   *   (`tests/sim/controls.ts`가 `SCENERY_CLEAR_BASE_COST`에 대해 겪은 그대로다).
   *   게임 코드에서 이 인자를 넘기는 곳은 **한 군데도 없다.**
   * @param regrowMax 칸당 재생 횟수 상한 (기본 `GATHER_REGROW_MAX`).
   *   ⚠ **판당 총액을 닫는 값이 이것이다** — 곧 대조군 `gather-regrow-x3`(총액 폭주)와
   *   `gather-regrow-off`(재생 없는 세계 복원)가 이 인자 하나로 성립한다. 주입구가
   *   없으면 재생 축의 새 다리가 전부 UNPROVEN으로 태어난다.
   * @param regrowTicks 자격까지의 최소 지연, 웨이브 1 기준
   *   (기본 `stage.gather?.regrowTicks` → `GATHER_REGROW_TICKS`). 총액이 아니라 **모양**만 바꾼다.
   * @param regrowStockFrac 재생이 켜지는 재고 문턱
   *   (기본 `stage.gather?.regrowStockFrac` → `GATHER_REGROW_STOCK_FRAC`).
   *   ⚠ **1 이면 재고 게이트가 통째로 꺼져 배포본 이전의 순수 타이머와 완전히 같아진다** —
   *   그것이 이 축의 되돌리기이고, 새 계약들이 실제로 빨개지는지 확인하는 손잡이이기도 하다.
   * @param regrowWaveSpeedup 웨이브당 지연 감쇠율
   *   (기본 `stage.gather?.regrowWaveSpeedup` → `GATHER_REGROW_WAVE_SPEEDUP`, 0 = 끔).
   */
  constructor(
    stage: StageDef,
    scenery: ReadonlySet<number>,
    {
      baseValue = GATHER_BASE_VALUE,
      regrowMax = GATHER_REGROW_MAX,
      // ⚠ 스테이지 주입구가 여기서 모듈 상수보다 **먼저** 읽힌다. 그리고 호출부가 값을
      //   넘기면(= BattleTuning) 그것이 다시 앞선다 — 우선순위 tuning > stage > 상수.
      regrowTicks = stage.gather?.regrowTicks ?? GATHER_REGROW_TICKS,
      regrowStockFrac = stage.gather?.regrowStockFrac ?? GATHER_REGROW_STOCK_FRAC,
      regrowWaveSpeedup = stage.gather?.regrowWaveSpeedup ?? GATHER_REGROW_WAVE_SPEEDUP,
    }: {
      baseValue?: number;
      regrowMax?: number;
      regrowTicks?: number;
      regrowStockFrac?: number;
      regrowWaveSpeedup?: number;
    } = {},
  ) {
    this.regrowTicks = Math.max(1, Math.round(regrowTicks));
    this.regrowWaveSpeedup = Math.max(0, regrowWaveSpeedup);
    const frac = Math.min(1, Math.max(0, regrowStockFrac));
    const rmax = Math.max(0, Math.round(regrowMax));
    // ⚠ Set 순회 순서에 안 기댄다 — 정렬해서 목록의 신원을 셀 키가 정하게 한다(계약 B)
    const keys = [...scenery].sort((p, q) => p - q);
    const out: ResourceCellState[] = [];
    for (const key of keys) {
      const cellX = key % stage.gridW;
      const cellZ = Math.floor(key / stage.gridW);
      const kind = resourceKindOf(stage, key); // 셀 단독 해시, 시드 무관
      const dx = cellX - stage.baseCell.x;
      const dz = cellZ - stage.baseCell.z;
      // ⚠ Math.hypot 금지 — 정밀도가 구현 정의라 **골드를 만드는 식**에는 안 쓴다(balance.ts)
      const dist = Math.sqrt(dx * dx + dz * dz);
      const cell: ResourceCellState = {
        cellX,
        cellZ,
        kind,
        value: gatherValueFor(baseValue, RESOURCE_DEFS[kind].kindMul, dist),
        taken: false,
        regrowAt: 0,
        // R4) 광물(stone·flint·obsidian)은 안 자란다. `resourceKindOf` 가 셀 단독 해시라
        //     이 값도 **좌표만의 함수**이고, 그래서 판당 총액이 시드와 무관하게 닫힌다:
        //     총액 = Σ value × (1 + regrowsLeft). 그 항등식이 `18.rateCap` 을 살린다.
        regrowsLeft: REGROWABLE_KINDS.has(kind) ? rmax : 0,
      };
      out.push(cell);
      this.index.set(key, cell);
    }
    this.list = out;
    // 재고의 분모 — **판 시작 시점의 재생종 value 합**. `regrowsLeft` 가 아니라 `kind` 로
    // 재는 이유: `regrowMax` 는 실험 손잡이라 0으로도 오는데, 그때도 분모가 흔들리면
    // "밭이 얼마나 비었나"의 뜻이 손잡이마다 달라진다. `REGROWABLE_KINDS` 는 상수다.
    let denom = 0;
    for (const cell of out) if (REGROWABLE_KINDS.has(cell.kind)) denom += cell.value;
    this.regrowDenom = denom;
    this.regrowNeed = denom > 0 ? frac * denom : Infinity;
  }

  /**
   * 이 웨이브에서 **자격을 얻기까지의 최소 지연**(틱) — `takeCell` 이 텄던 그 틱에 부른다.
   *
   * ⚠ **`updateRegrow` 는 이 함수를 안 부른다.** 웨이브 의존을 매 틱 다시 읽으면 이미 텄던
   *   칸의 자격 시점이 판 도중에 앞뒤로 움직이고, 그러면 `regrowAt` 이 더 이상 그 칸의
   *   사실이 아니게 된다. 텄던 틱에 한 번 굳혀 `regrowAt` 에 넣는 이 배치가
   *   **결정론 해시를 안 넓히고도** 웨이브 의존을 싣는 유일한 방법이기도 하다
   *   (`view.waveIndex` 는 `battle.ts hash()` 에 안 접혀 있고 `regrowAt` 은 접혀 있다).
   * ⚠ rng 없음 · 정수 반올림 하나. 유도는 `balance.GATHER_REGROW_WAVE_SPEEDUP` 주석.
   */
  delayAt(waveIndex: number): number {
    const w = Math.max(1, Math.floor(waveIndex));
    const mul = Math.max(GATHER_REGROW_DELAY_MIN_MUL, 1 - this.regrowWaveSpeedup * (w - 1));
    return Math.max(1, Math.round(this.regrowTicks * mul));
  }

  /** 조회 — 그 셀에 소품이 없으면 null. **순회하지 않는다** */
  at(key: number): ResourceCellState | null {
    return this.index.get(key) ?? null;
  }
}

/**
 * **칸을 턴다** — 소품이 사라지고(R1) 재생 타이머가 걸린다(R2).
 *
 * ⚠⚠ **`taken`/`regrowAt`/`regrowsLeft` 셋을 함께 쓰는 자리는 이 함수 하나뿐이다.**
 *   저장소 전체에 `cell.taken = true` 직접 대입이 **0건**이어야 한다. 셋이 갈리는 실패는
 *   조용하다 — 타입 오류 0건이고, 짧은 판에서는 T가 안 지나 아무 일도 안 일어난다.
 *   그 실패가 드러나는 유일한 통로는 **원장 재기록**이다(§8 위험 3).
 *
 * 부르는 곳은 정확히 둘이고, 갈리는 것은 인자 하나뿐이다:
 *  · `updateGather` ② 짐 확정          → `burn = false` (T틱 뒤 다시 자란다)
 *  · `battle.cmdClearScenery` 유료 제거 → `burn = true`  (**영영 안 자란다**, R-f)
 *
 * @param burn 재생권을 태운다. **돈 내고 치운 칸이 T틱 뒤 다시 막히면 그건 사기다** —
 *   그리고 그 회귀는 `dozer` 팔이 오늘과 다른 판을 밟게 해 봉투 [6]을 통째로 가른다.
 */
export function takeCell(ctx: SimCtx, cell: ResourceCellState, burn: boolean): void {
  cell.taken = true;
  if (burn || cell.regrowsLeft <= 0) {
    // 광물(R4)·유료 제거(R-f)·재생권 소진 — 셋 다 **영구**다. 되돌리는 코드는 없다.
    cell.regrowsLeft = 0;
    cell.regrowAt = 0;
    return;
  }
  cell.regrowsLeft--;
  // ⚠ **절대 틱**이다(잔여 틱이 아니다). `view.tick` 하나에만 걸려 있어 어긋날 자리가 없다.
  // ⚠⚠ **이 값은 "자라는 틱"이 아니라 "자랄 수 있게 되는 틱"이다** — 실제로 자라는 것은
  //   밭의 재고가 문턱 아래로 내려간 뒤이고, 그 판정은 `updateRegrow` 가 한다.
  // ⚠ 웨이브 의존이 **여기서 한 번** 굳는다(`delayAt`). 매 틱 다시 읽지 않는 이유와
  //   그 배치가 해시를 안 넓히는 이유는 `delayAt` 주석에 있다.
  cell.regrowAt = ctx.view.tick + ctx.resources.delayAt(ctx.view.waveIndex);
}

/**
 * **재생권 소각** — 그 칸에 타워가 섰다 (R3). `battle.cmdPlace` 가 배치 성공 직후 부른다.
 *
 * ⚠ **되돌리는 코드는 저장소 어디에도 없다 — 타워를 팔아도 다시 안 자란다.** 근거 셋:
 *  ① R3의 문언이 그것이다("타워를 지으면 영영 안 자란다").
 *  ② **`regrowsLeft` 의 단조 감소가 종료 증명의 뼈대다**(`updateAllyAuto` 헤더 참조).
 *     재생이 들어오면서 `taken` 은 이미 단조가 아니게 됐고, "판 전체의 수확 횟수가 유한하다"를
 *     떠받치는 값이 이것 하나로 남았다. 이 값을 **늘리는** 간선이 하나라도 생기면 그 증명을
 *     통째로 다시 써야 하고, 해시도 그만큼 복잡해진다.
 *  ③ 짓고-팔기로 재생권을 무한 재활용하는 경로가 **원리적으로** 사라진다.
 * 대가는 정직하게: 판 자리는 영영 맨땅으로 남는다. AoE 에서 숲 위에 지은 건물을 지워도
 * 숲이 안 돌아오는 것과 같은 관습이라 설명이 필요 없다.
 */
export function burnRegrow(cell: ResourceCellState): void {
  cell.regrowsLeft = 0;
  cell.regrowAt = 0;
}

/**
 * 8-a) **재생** — 밭이 **문턱보다 비면** 자격 있는 칸이 **같은 종·같은 값**으로 돌아온다 (R2).
 *
 * ── 규칙 (사용자 요구: "전체적으로 자원의 일정 비율 이하가 되면 다시 생성") ──────
 *   ① **재고를 잰다** = 지금 서 있는 **재생종** 칸의 value 합 (`standing`).
 *      분모는 판 시작 시점의 재생종 value 합(`regrowDenom`)이고 **좌표만의 함수**다.
 *      광물이 분자·분모 어디에도 없는 이유는 `regrowDenom` 주석에 있다.
 *   ② **문턱 위면 한 칸도 안 자란다** — `standing >= regrowNeed` 면 즉시 반환.
 *      이 이른 반환이 방치 판을 **첫 줄에서** 닫는다(아무것도 안 텄으면 재고가 1.0이다).
 *   ③ 아래면 자격 있는 칸을 **재고가 문턱에 닿을 때까지만** 되살린다.
 *      자격 = `regrowAt !== 0`(= `regrowsLeft` 를 아직 한 장 들고 있다) **그리고**
 *             `tick >= regrowAt`(= 텄던 뒤 최소 지연이 지났다).
 *
 * ⚠⚠ **횟수는 안 건드린다.** 이 함수는 `regrowsLeft` 에 한 글자도 안 쓴다 — 한 칸이 자랄
 *   수 있는 횟수를 정하는 것은 `takeCell` 의 감산 하나뿐이다. 그래서 판당 총액 항등식
 *   Σ value × (1 + regrowsLeft@생성) 이 게이트가 들어와도 그대로다(`18.rateCap`).
 *   재고가 낮게 눌린 판에서 자원이 무한히 나오지 않는 것이 이 한 줄이다.
 *
 * ⚠⚠ **선택 순서가 결정론의 일부다** — `(regrowAt 오름차순, 셀 키 오름차순)`, 곧 **자격을
 *   먼저 얻은 칸부터**. `list` 를 훑어 최솟값을 고르므로 Map/Set 순회가 끼지 않고, 동률이
 *   셀 키로 닫히는 것은 `list` 가 셀 키 오름차순이고 비교가 **엄격 부등호**(`<`)라서다.
 *   ⚠ 이 비교식을 고치면 **이벤트 순서와 판의 궤적이 함께 움직인다**(자란 칸을 같은 틱에
 *     일꾼이 잡으므로 — 아래 "틱 안의 자리" 참조). 정렬을 바꾸려면 그 사실을 알고 바꿔라.
 *
 * ⚠ **rng를 한 톨도 안 쓴다**(R5). `resourceKindOf` 를 다시 부르지 **않는다** — 부르는 순간
 *   재생이 셀 해시가 아니라 **호출 횟수**에 걸리고, 그러면 같은 칸이 판마다 다른 종으로
 *   돌아온다. 종도 값도 생성 시 굳은 것을 그대로 되쓴다(그래서 이 함수는 `value` 와 `kind` 에
 *   한 글자도 안 쓴다).
 *
 * **틱 안의 자리는 8-a — `updateGather`(8-b) 바로 앞이다.** 이유 셋:
 *  · 8-c(`updateAllyAuto`) 앞 → 이 틱에 자란 칸을 **같은 틱에** 일꾼이 잡는다(지연 0).
 *    뒤에 두면 자란 칸이 언제나 한 틱 늦게 후보에 들어온다.
 *  · 8-b 앞 → 예약은 **안 텄은 칸에만** 붙으므로(E-6) 자라는 칸에는 애초에 예약이 없다.
 *    곧 `updateGather` ②의 "칸이 사라졌다" 가지와 이 함수는 서로를 못 본다. 방어선이
 *    아니라 **순서**로 그것을 보장한다.
 *  · `applyCommand` 는 `tick()` **밖**에서 돈다 → "지으려는 순간 발밑에서 나무가 자라는"
 *    경합이 구조적으로 존재하지 않는다.
 *
 * ⚠ 이 함수는 **방치 판에서도 매 틱 돈다**(재고 합을 한 번 세고 ②에서 반환할 뿐). 곧
 *   [5]·`18.idleZero` 의 근거가 "코드 경로의 부재"에서 "돌지만 아무 일도 안 한다"로 한 겹
 *   약해졌다 — 그래서 이벤트 이름을 **`gatherRegrown`** 으로 못 박아 `runIdle` 의
 *   `startsWith('gather')` 카운터가 그 사실을 **실행으로** 확인하게 한다.
 *   ⚠ 방치 판에서 ②가 참인 것은 우연이 아니다: 아무 칸도 안 텄으면 `standing` 이 분모와
 *     같으므로 재고가 정확히 1.0 이고, 문턱은 1 이하로 잘려 있다(생성자의 `frac` 클램프).
 */
export function updateRegrow(ctx: SimCtx): void {
  const tick = ctx.view.tick;
  const field = ctx.resources;
  const list = field.list;
  // ── ① 재고 — 지금 서 있는 **재생종** 칸의 value 합 ─────────────────────────
  // ⚠ `list` 순회다(계약 B). 종 판정은 **멤버십 검사**라 Set 순회가 아니다(계약 B 안전).
  let standing = 0;
  for (const cell of list) {
    if (!cell.taken && REGROWABLE_KINDS.has(cell.kind)) standing += cell.value;
  }
  // ── ② 문턱 위면 한 칸도 안 자란다 ─────────────────────────────────────────
  if (standing >= field.regrowNeed) return;

  // ── ③ 재고가 문턱에 닿을 때까지, 자격을 먼저 얻은 칸부터 되살린다 ──────────
  // ⚠ 되살아난 칸은 반드시 재생종이다(`regrowAt > 0` 은 `takeCell` 이 `regrowsLeft > 0`
  //   인 칸에만 붙인다 = 광물은 원천적으로 0). 그래서 `standing += value` 가 ①의 정의와
  //   같은 집합 위에서 이어진다 — 재생종 판정을 여기서 다시 하지 않는 근거다.
  while (standing < field.regrowNeed) {
    let best: ResourceCellState | null = null;
    for (const cell of list) {
      if (cell.regrowAt === 0) continue; // 안 텄거나 · 영영 안 자란다 (광물·유료 제거·타워)
      if (tick < cell.regrowAt) continue; // 아직 최소 지연이 안 지났다
      // 엄격 부등호 = 동률이면 **앞사람(작은 셀 키)** 이 이긴다. `pickAutoCell` 과 같은 규약.
      if (best === null || cell.regrowAt < best.regrowAt) best = cell;
    }
    if (best === null) return; // 자격 있는 칸이 없다 — 재고가 모자라도 여기서 끝이다
    best.taken = false;
    best.regrowAt = 0;
    standing += best.value;
    ctx.events.push({
      type: 'gatherRegrown',
      cellX: best.cellX,
      cellZ: best.cellZ,
      kind: best.kind,
      value: best.value,
    });
  }
}

/**
 * 채집 목표를 박는다 — **`sim/allies.ts moveAlly()`만** 호출한다 (계약 A의 유일한 통로).
 *
 * 자원이 없거나 이미 텄거나 남이 예약했거나 짐이 가득 찼으면 **조용히 기존 명령만 푼다** —
 * 곧 `moveAlly`의 바깥 계약(반환값·이벤트)은 한 글자도 안 바뀐다. "거기로 가라"는 언제나
 * 유효한 명령이고, 헛걸음을 막는 것은 sim이 아니라 UI의 몫이다(E-5).
 */
export function setGatherTarget(ctx: SimCtx, a: AllySim, key: number): void {
  if (key < 0) {
    // 정수 셀이 아니거나 격자 밖 — 채집이 아닌 평범한 이동이다. 앞 예약은 푼다.
    if (a.gatherKey >= 0) cancelGather(ctx, a, 'moved');
    return;
  }
  // E-1) 같은 칸 재명령 = 진행분 **유지**. 연타가 진행을 0으로 만들면 "빨리 캐려고 연타"가
  //      손해가 된다 — 손가락이 게임을 벌하면 안 된다.
  if (a.gatherKey === key) return;
  // E-2/E-3) 앞 예약을 푼다. 진행분은 폐기되고 **짐은 그대로 진다**.
  if (a.gatherKey >= 0) cancelGather(ctx, a, 'moved');

  const cell = ctx.resources.at(key);
  if (!cell || cell.taken) return; // E-6) 자원 없음 / 이미 텀 → 그냥 이동
  // E-7) 못 캐는 종. ⚠ **이 한 줄이 gatherTicksFor의 Infinity를 막는 방벽이다** —
  //      gatherPct 0이면 실제 틱이 Infinity라 updateGather가 영원히 안 끝나는 캐기를 돈다.
  //      "못 캔다"는 판정을 호출부가 **먼저** 거른다(위약 아군이 정확히 그 값이다).
  if ((a.def.gatherPct ?? 100) <= 0) return;
  if (a.carryCount >= (a.def.carryCap ?? 1)) return; // E-5) 짐이 가득 → 그냥 이동
  // E-9) 예약은 **배타적**이다 — 한 칸에 한 짐이므로(D2) 둘을 보내면 한 명은 반드시
  //      헛걸음한다. 살아 있는 누군가가 이미 이 칸을 들고 있으면 안 붙인다.
  //      멤버십 검사뿐이라 items 순회 순서에 결과가 안 걸린다(계약 B).
  for (const o of ctx.world.allies.items) {
    if (o.alive && o !== a && o.gatherKey === key) return;
  }
  a.gatherKey = key;
  a.gatherTicks = 0;
  a.gatherHpMark = 0; // "이번 예약에서 아직 시작 안 함" 센티널
}

/**
 * 채집 명령을 푼다 (진행분 폐기 + `gatherLost`). **짐은 안 건드린다** —
 * 등에 진 것은 명령을 바꿔도 사라지지 않는다(D3). 그래서 비상 소집이 공짜다(E-4).
 */
export function cancelGather(ctx: SimCtx, a: AllySim, reason: 'moved' | 'cleared'): void {
  if (a.gatherKey < 0) return;
  const cell = ctx.resources.at(a.gatherKey);
  ctx.events.push({
    type: 'gatherLost',
    allyId: a.id,
    defId: a.defId,
    cellX: cell ? cell.cellX : -1,
    cellZ: cell ? cell.cellZ : -1,
    reason,
    gold: 0,
  });
  a.gatherKey = -1;
  a.gatherTicks = 0;
  a.gatherHpMark = 0;
}

/**
 * 그 칸을 예약한 사람의 명령을 푼다 — `battle.cmdClearScenery`가 부른다(E-14).
 * 치운 사람이 그 짐을 버린 것이고, 그것이 D1이 만든 `clearScenery`의 기회비용이다.
 */
export function cancelGatherersOf(ctx: SimCtx, key: number): void {
  // 예약이 배타적이라 최대 한 명이다. **그 불변식을 코드로 표현한다** — break가 없으면
  // 이벤트 순서가 items(풀 swap-remove) 순서를 타고, 그건 이 파일의 다른 모든 순회가
  // 지키는 id 오름차순 규약에서 이것 하나만 빠지는 형태다.
  for (const a of ctx.world.allies.items) {
    if (a.alive && a.gatherKey === key) {
      cancelGather(ctx, a, 'cleared');
      break;
    }
  }
}

/**
 * 전용 스크래치 버퍼 — `allies.ts`의 `pickOrder`·`orderOrder`와 **공유하지 않는다.**
 * 지금은 `applyCommand`가 `tick()` 밖에서 도는 덕에 충돌이 없지만, 그 성질은 언제든
 * 한 줄로 깨진다. 버퍼를 빌려 쓰면 "루프 도중에 같은 버퍼를 다시 채우는" 재진입 지뢰가 선다.
 */
const gatherOrder: AllySim[] = [];

/**
 * 매 틱 — 사망 정산 → 캐기 진행 → 짐 확정 → 자동 귀환 → 배달 (아군 id 오름차순).
 *
 * **틱 안의 자리는 8-b(`sweepDeadAllies` 바로 앞)다.** 한 자리가 네 조건을 동시에 만족한다:
 *  · 4) `moveAllies` 뒤  → **같은 틱의 도착**과 **같은 틱의 배달 진입**을 읽는다(한 틱 지연 없음)
 *  · 2) `updateAllies` 뒤 → 난투는 아군 피해의 **유일한** 발생지다. **이 틱의 피해**로
 *       중단 판정(D5)이 선다. 앞에 두면 언제나 한 틱 늦게 끊긴다
 *  · 9) `sweepDeadAllies` 앞 → **죽은 사람의 짐**을 흘릴 수 있다(E-10). 뒤로 가면 시체가
 *       이미 회수돼 `gatherLost{'died'}`가 영영 안 나간다
 *  · 10) `checkEnd` 앞 → **승패를 선언하는 틱에도 마을에 닿아 있으면 지급된다**(E-12)
 */
export function updateGather(ctx: SimCtx): void {
  const base = ctx.opts.stage.baseCell;
  const range2 = GATHER_DELIVER_RANGE * GATHER_DELIVER_RANGE;
  // ⚠ **`fillAllAllyIds`다 — 죽은 아군까지 넣는다.** 아래 ①이 시체의 짐을 정산해야 하고,
  //   `fillAliveAllyIds`(updateAllies·moveAlly용)를 쓰면 E-10이 도달 불가 코드가 된다.
  fillAllAllyIds(ctx.world.allies.items, gatherOrder);

  for (const a of gatherOrder) {
    // ── ① 죽었다 (E-10) ─────────────────────────────────────────────────────
    // `sweepDeadAllies`(9단계)는 이 아래에 있으므로 시체가 아직 배열에 있다.
    // 짐은 **전액 소멸한다** — 지고 오는 길이 위험하다는 것이 이 설계의 값이다.
    // 이 가드가 없으면 시체가 마을에 닿아 ③에서 지급받는다.
    if (!a.alive) {
      if (a.carryCount > 0) {
        ctx.events.push({
          type: 'gatherLost',
          allyId: a.id,
          defId: a.defId,
          cellX: Math.round(a.x),
          cellZ: Math.round(a.z),
          reason: 'died',
          gold: a.carryGold,
        });
      }
      a.carryGold = 0;
      a.carryCount = 0;
      a.gatherKey = -1; // 예약을 즉시 푼다 — 남이 그 칸을 다시 찍을 수 있어야 한다
      a.gatherTicks = 0;
      a.gatherHpMark = 0;
      continue;
    }

    // ── ② 캐기 ──────────────────────────────────────────────────────────────
    if (a.gatherKey >= 0) {
      const cell = ctx.resources.at(a.gatherKey);
      if (!cell || cell.taken) {
        // 골드로 치워졌거나(cmdClearScenery가 이미 cancelGatherersOf를 부르므로 여기까지
        // 오는 경우는 방어선이다) 어쩌다 무효해졌다 → 예약만 푼다.
        // **계속 걸어가 그 자리에 선다**(tgt 유지) — 명령의 절반("거기로 가라")은 여전히 유효하다.
        a.gatherKey = -1;
        a.gatherTicks = 0;
        a.gatherHpMark = 0;
      } else if (isGathering(a)) {
        // 도착해 있다 = **캐는 중**
        const need = gatherTicksFor(a.def, cell.kind);
        if (a.gatherHpMark === 0) {
          // 이번 **예약**의 첫 도착 — hp를 마크하고 화면에 게이지를 켠다.
          // ⚠ 조건이 `gatherTicks === 0`이 **아니다**: 맞아서 0으로 되돌아갈 때마다
          //   gatherStarted가 다시 나가면 전선 옆 칸(s1 40칸 중 22칸)에서 난투 쿨다운
          //   간격으로 `gatherLost{'hit'}` + `gatherStarted`가 쌍으로 뿜어진다.
          a.gatherHpMark = a.hp;
          ctx.events.push({
            type: 'gatherStarted',
            allyId: a.id,
            defId: a.defId,
            cellX: cell.cellX,
            cellZ: cell.cellZ,
            kind: cell.kind,
            value: cell.value,
            ticks: need,
          });
        } else if (a.hp < a.gatherHpMark) {
          // D5) 맞으면 **손이 멈춘다.** 진행분이 0으로 돌아간다.
          // 예약도 짐도 안 건드린다 — 적이 지나가면 그 자리에서 처음부터 다시 캔다.
          // 이벤트는 진행분이 있었을 때만 낸다(초당 여러 건을 뿜지 않게).
          if (a.gatherTicks > 0) {
            ctx.events.push({
              type: 'gatherLost',
              allyId: a.id,
              defId: a.defId,
              cellX: cell.cellX,
              cellZ: cell.cellZ,
              reason: 'hit',
              gold: 0,
            });
          }
          a.gatherTicks = 0;
          a.gatherHpMark = a.hp; // 새 시도의 시작 (0이 아니므로 gatherStarted는 다시 안 나간다)
          // 이 틱은 진행 없음 — 아래 ++를 건너뛴다.
          // ⚠ 배달 판정(③)도 함께 건너뛴다. 배달 반경 0.7 안에는 자원 칸이 하나도 없으므로
          //   (E-13) "캐는 중이면서 마을 안"인 상태가 **구조적으로 존재하지 않는다.**
          continue;
        }
        a.gatherTicks++;
        if (a.gatherTicks >= need) {
          // 짐 하나 완성 = **이 순간 칸이 텄다** (한 칸 한 짐, D2)
          // ⚠ R-a) **타이머는 캔 순간에 시작한다 — 배달 순간이 아니다.** 근거 둘:
          //   ① 칸이 화면에서 비는 것도 이 틱이다. 두 사실이 같은 틱이 아니면
          //      **"없는데 아직 못 짓는 칸"** 이 생기고, 그게 D1을 뒤집은 이유 그 자체다.
          //   ② 배달 시점으로 미루면 **짐을 진 채 죽은 사람의 칸이 영영 안 자란다**
          //      (E-10과 결합) — 총액이 사람의 사망률로 새는 자리가 생긴다.
          takeCell(ctx, cell, false);
          a.carryGold += cell.value; // 값이 여기서 굳는다 — 칸을 다시 조회하지 않는다
          a.carryCount++;
          a.gatherKey = -1;
          a.gatherTicks = 0;
          a.gatherHpMark = 0; // 다음 예약을 위한 센티널 복구
          const cap = a.def.carryCap ?? 1;
          ctx.events.push({
            type: 'gathered',
            allyId: a.id,
            defId: a.defId,
            cellX: cell.cellX,
            cellZ: cell.cellZ,
            kind: cell.kind,
            value: cell.value,
            carried: a.carryCount,
            carryCap: cap,
          });
          if (a.carryCount >= cap) {
            // 가득 찼다 → **자동 귀환**(D6). 다음 칸은 배달 뒤 8-c가 잡는다(규칙 8).
            // 목표는 집결 지점이 아니라 **기지 셀 자체**다 — 집결 지점은 배달 반경 0.7
            // 밖이라(ALLY_MUSTER_FORWARD 1.4) 거기 서면 영영 지급이 안 된다.
            a.tgtX = base.x;
            a.tgtZ = base.z;
          }
          // 가득 안 찼으면 **그 자리에 선다** — 이 파일은 다음 칸을 안 고른다.
          //   자동이 켜져 있으면 같은 틱의 8-c가 그 자리에서 다음 칸을 잡고,
          //   "여기 지켜"(autoHold)면 정말로 선다 — 그 갈림이 이 파일 밖에 있는 것이 요점이다.
        }
      }
      // 도착 전이면 아무것도 안 한다 (걷는 중)
    }

    // ── ③ 배달 (D3) — **상태가 아니라 위치 판정이다** ────────────────────────
    // 짐을 진 채 마을 반경에 들어오면 **어디로 가던 중이든** 지급된다. 그래서 비상
    // 소집이 공짜다(E-4): 짐 진 사람을 불러도 돈이 사라지지 않고 늦어질 뿐이다.
    if (a.carryCount > 0) {
      const dx = a.x - base.x;
      const dz = a.z - base.z;
      if (dx * dx + dz * dz <= range2) {
        // ⚠ 채집이 골드를 내는 **유일한** 자리다. 수입 addGold 호출부는 이것으로 넷이 된다
        //   (combat.leakEnemy 경로 · battle.checkEnd 웨이브 보상 · battle 조기 호출 · 여기).
        addGold(ctx, a.carryGold);
        ctx.events.push({
          type: 'gatherDelivered',
          allyId: a.id,
          defId: a.defId,
          gold: a.carryGold,
          loads: a.carryCount,
          x: a.x,
          z: a.z,
        });
        a.carryGold = 0;
        a.carryCount = 0;
        // **그 자리에 선다** — tgt를 지금 위치로 박아 마을 안으로 더 걸어 들어가지 않게 한다.
        // ⚠ 이 한 줄이 규칙 8의 "다시 나간다"를 **한 틱 지연 없이** 성립시킨다:
        //   같은 틱의 8-c가 이 사람을 "도착해 있고 빈손"으로 읽어 다음 칸을 준다.
        a.tgtX = a.x;
        a.tgtZ = a.z;
      }
    }
  }
}
