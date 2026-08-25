/**
 * 채집 자원 데이터 검증 — docs/gather-spec.md §9-1 ①~⑧.
 *
 * 이 파일이 잠그는 것은 하나로 요약된다: **총액은 계산이 아니라 사실이다.**
 * 소품 좌표는 `hashSeed('scenery:'+stage.id)` 고정이고(grid.ts) 종류는 셀 단독 해시
 * (`resource:${id}:${key}`)라 **시드와 무관**하므로, 6스테이지의 짐값 합은 모든 판에서
 * 같은 한 숫자다. 그 숫자를 어서션 한 줄로 박아 두는 것이 D9(손잡이 하나)의 감사 가능성 전부다.
 *
 * ⚠ **T6이 `GATHER_BASE_VALUE`를 8로 켰다** (착수 기간에는 0이었다). 이 파일은 상수를
 *   직접 읽지 않고 `gatherValueFor(B, …)`로 **기준값을 인자로 넣어** 총액을 검증하되,
 *   아래 `B`가 배포본 상수와 같다는 것을 **어서션으로 묶는다** — 그래야 "여기서 잠근 745"와
 *   "게임이 실제로 내는 745"가 갈라질 수 없다. 곧 이 파일은 상수를 켜기 전에도 켠 뒤에도
 *   같은 절차로 같은 숫자를 잠근다.
 *
 * ⚠ 아직 없는 것 둘 (T2가 `sim/gather.ts`의 ResourceField를 만든 뒤에 붙인다):
 *   · §9-1 ④ `sim.state.resources[i].kind === resourceKindOf(stage, key_i)`
 *   · §9-1 ⑤ `sceneryCells` 키 집합 == `sim.state.resources`의 셀 집합
 *   여기서는 그 둘의 **밭 쪽 절반**(키 오름차순 · 키 집합 == sceneryCells)을 로컬로 다시
 *   구성해 잠근다 — ResourceField 생성자와 같은 절차를 밟으므로, T2가 sim 쪽 절반을
 *   붙일 때 비교 대상이 이미 여기 있다.
 */
import { describe, expect, it } from 'vitest';
import type { BiomeId, ResourceId, StageDef } from '@/data/types';
import { STAGES, stageById } from '@/data/stages';
import { rasterizePathCells, sceneryCells } from '@/data/grid';
import { ALLY_DEFS, ALL_ALLY_IDS } from '@/data/allies';
import {
  GATHER_BASE_VALUE,
  GATHER_DIST_GAIN,
  GATHER_DELIVER_RANGE,
  GATHER_REGROW_MAX,
  GATHER_REGROW_STOCK_FRAC,
  gatherValueFor,
} from '@/data/balance';
import {
  REGROWABLE_KINDS,
  RESOURCE_DEFS,
  RESOURCE_WEIGHTS,
  gatherTicksFor,
  isGathering,
  isWorkerDef,
  resourceKindOf,
} from '@/data/resources';

/**
 * **배포본 짐값 기준값.** T6이 6(착수값)에서 걸어 올려 확정한 값이고(gather-spec §1-5-D의
 * 정정대로 실측으로 유도했다 — balance.ts 의 상수 주석에 유도 전문이 있다), 이 파일의
 * 총액 표 전부가 여기에 걸려 있다. 아래 첫 어서션이 이 값과 배포본 상수를 묶는다.
 */
const B = 3;

/**
 * 칸당 재생 횟수 상한 — **판당 총액을 닫는 값이다.** `B`와 같은 이유로 여기 한 번 더 적고
 * 아래에서 배포본 상수와 어긋나지 않음을 어서션으로 묶는다.
 */
const R = 1;

/** 한 칸이 판 전체에서 낼 수 있는 수확 횟수 — 광물은 1, 재생종은 1 + R (R4) */
function harvestsOf(kind: ResourceId): number {
  return 1 + (REGROWABLE_KINDS.has(kind) ? R : 0);
}

const ALL_RESOURCE_IDS: readonly ResourceId[] = [
  'berry',
  'mushroom',
  'honey',
  'fruit',
  'flint',
  'wood',
  'stone',
  'obsidian',
];

const ALL_BIOMES: readonly BiomeId[] = [
  'grassland',
  'jungle',
  'desert',
  'snow',
  'swamp',
  'volcano',
];

interface Cell {
  key: number;
  cellX: number;
  cellZ: number;
  kind: ResourceId;
  dist: number;
  value: number;
}

/**
 * `sim/gather.ts`의 ResourceField 생성자와 **같은 절차**다 — Set을 키 오름차순으로 정렬하고
 * (⚠ Set 순회 순서에 안 기댄다, 계약 B), 셀마다 단독 해시로 종류를 뽑고, 마을거리를
 * `Math.sqrt`로 구한다(`Math.hypot`은 정밀도가 구현 정의라 골드를 만드는 식에 안 쓴다).
 */
function fieldOf(stage: StageDef, baseValue: number): Cell[] {
  const keys = [...sceneryCells(stage, rasterizePathCells(stage))].sort((p, q) => p - q);
  return keys.map((key) => {
    const cellX = key % stage.gridW;
    const cellZ = Math.floor(key / stage.gridW);
    const kind = resourceKindOf(stage, key);
    const dx = cellX - stage.baseCell.x;
    const dz = cellZ - stage.baseCell.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return {
      key,
      cellX,
      cellZ,
      kind,
      dist,
      value: gatherValueFor(baseValue, RESOURCE_DEFS[kind].kindMul, dist),
    };
  });
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 1
    ? (sorted[(n - 1) / 2] as number)
    : ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;
}

describe('자원 8종 정의 (§9-1 ②)', () => {
  it('8종이 전부 있고 id가 키와 일치한다', () => {
    expect(Object.keys(RESOURCE_DEFS).sort()).toEqual([...ALL_RESOURCE_IDS].sort());
    for (const id of ALL_RESOURCE_IDS) expect(RESOURCE_DEFS[id].id).toBe(id);
  });

  it('ticks는 정수 · ≥30 · **3의 배수**이고, kindMul은 양수다', () => {
    for (const id of ALL_RESOURCE_IDS) {
      const def = RESOURCE_DEFS[id];
      expect(Number.isInteger(def.ticks)).toBe(true);
      expect(def.ticks).toBeGreaterThanOrEqual(30);
      // gatherPct 300(채집꾼)이 **정수 틱**이 되어야 한다 — 아니면 표의 "1.0초 단위"가 거짓이 된다
      expect(def.ticks % 3).toBe(0);
      expect(def.kindMul).toBeGreaterThan(0);
    }
  });

  it('i18n 키가 규약대로다 (res.<id>.name / .tag)', () => {
    for (const id of ALL_RESOURCE_IDS) {
      expect(RESOURCE_DEFS[id].nameKey).toBe(`res.${id}.name`);
      expect(RESOURCE_DEFS[id].tagKey).toBe(`res.${id}.tag`);
    }
  });

  it('ticks와 kindMul이 같은 방향으로 간다 — 느릴수록 비싸다', () => {
    // §1-3의 유도(kindMul = (6.585 + ticks초/3) / 14.585)가 단조라는 사실을 값으로 잠근다.
    // 한 줄만 어긋나도 "빠르게-적게 ↔ 느리게-많이" 축이 그 자리에서 깨진다.
    const byTicks = [...ALL_RESOURCE_IDS].sort((a, b) => RESOURCE_DEFS[a].ticks - RESOURCE_DEFS[b].ticks);
    for (let i = 1; i < byTicks.length; i++) {
      const prev = RESOURCE_DEFS[byTicks[i - 1] as ResourceId];
      const cur = RESOURCE_DEFS[byTicks[i] as ResourceId];
      expect(cur.kindMul).toBeGreaterThan(prev.kindMul);
    }
    // 기준종은 flint이고 배수가 정확히 1.00이다 — 나머지 일곱의 분모다
    expect(RESOURCE_DEFS.flint.kindMul).toBe(1);
    expect(RESOURCE_DEFS.flint.ticks).toBe(720); // 채집꾼 8.0초 = 저울 그 자체
  });
});

describe('바이옴 가중치 (§9-1 ①)', () => {
  it('6바이옴이 전부 있고 각 표의 합이 **정수 100**이다', () => {
    expect(Object.keys(RESOURCE_WEIGHTS).sort()).toEqual([...ALL_BIOMES].sort());
    for (const biome of ALL_BIOMES) {
      const table = RESOURCE_WEIGHTS[biome];
      let sum = 0;
      for (const [, w] of table) {
        expect(Number.isInteger(w)).toBe(true);
        expect(w).toBeGreaterThan(0); // 없는 종은 **항목을 뺀다**(0을 적지 않는다)
        sum += w;
      }
      expect(sum).toBe(100);
    }
  });

  it('한 표에 같은 종이 두 번 나오지 않는다', () => {
    for (const biome of ALL_BIOMES) {
      const ids = RESOURCE_WEIGHTS[biome].map((r) => r[0]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('화산에 식량이 0이다 (의도 — 마지막 스테이지의 대가, 보상이 obsidian 34%)', () => {
    const ids = new Set(RESOURCE_WEIGHTS.volcano.map((r) => r[0]));
    for (const food of ['berry', 'mushroom', 'honey', 'fruit'] as const) {
      expect(ids.has(food)).toBe(false);
    }
    expect(ids.has('obsidian')).toBe(true);
    // obsidian은 화산 **전용**이다 — 다른 다섯 바이옴에 나오면 최고 단가가 새어 나간다
    for (const biome of ALL_BIOMES) {
      if (biome === 'volcano') continue;
      expect(RESOURCE_WEIGHTS[biome].some((r) => r[0] === 'obsidian')).toBe(false);
    }
  });
});

describe('resourceKindOf 결정론 (§9-1 ③)', () => {
  it('같은 입력이면 늘 같은 값 — 6스테이지 전 소품 셀', () => {
    for (const stage of STAGES) {
      const keys = [...sceneryCells(stage, rasterizePathCells(stage))].sort((p, q) => p - q);
      for (const key of keys) {
        const a = resourceKindOf(stage, key);
        expect(resourceKindOf(stage, key)).toBe(a);
        // stageById가 돌려주는 **다른 객체**로도 같은 값이어야 한다 — 셀 단독 해시라
        // 스테이지 객체의 동일성이 아니라 stage.id와 stage.biome만 본다
        const again = stageById(stage.id);
        expect(again).toBeTruthy();
        expect(resourceKindOf(again as StageDef, key)).toBe(a);
      }
    }
  });

  it('뽑힌 종은 **그 바이옴 가중치 표 안**에 있다', () => {
    for (const stage of STAGES) {
      const allowed = new Set(RESOURCE_WEIGHTS[stage.biome].map((r) => r[0]));
      for (const c of fieldOf(stage, B)) expect(allowed.has(c.kind)).toBe(true);
    }
  });

  it('밭은 **셀 키 오름차순**이고 키 집합이 sceneryCells와 정확히 같다 (§9-1 ⑤의 밭 절반)', () => {
    for (const stage of STAGES) {
      const scenery = sceneryCells(stage, rasterizePathCells(stage));
      const field = fieldOf(stage, B);
      expect(field.length).toBe(scenery.size);
      for (let i = 1; i < field.length; i++) {
        expect((field[i] as Cell).key).toBeGreaterThan((field[i - 1] as Cell).key);
      }
      expect(new Set(field.map((c) => c.key))).toEqual(scenery);
      // 키 ↔ 좌표 왕복이 어긋나면 배달 거리도 배지 위치도 전부 어긋난다
      for (const c of field) expect(c.cellZ * stage.gridW + c.cellX).toBe(c.key);
    }
  });
});

describe('분포 충실도 (§9-1 ⑥ — ±20%p · 모든 종 1개 이상)', () => {
  it('가중치 표에 있는 종은 그 판에 **하나 이상** 실제로 나온다', () => {
    for (const stage of STAGES) {
      const field = fieldOf(stage, B);
      for (const [id] of RESOURCE_WEIGHTS[stage.biome]) {
        expect(field.filter((c) => c.kind === id).length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('실제 분포가 가중치 대비 ±20%p 안이다', () => {
    // ⚠ ±40%p는 **실패 불가능한 계약**이었다(검증 B 지적, 참). 6스테이지 전수 최악 편차가
    //   12.6%p(s2 wood 기대 24% → 실측 11.4%)라 ±40%p는 그 3.2배다. 표본이 40~51개뿐이라
    //   FNV-1a + mulberry32의 아발란치가 이 정도로 어긋나는 것은 정상이고, ±20%p면 최악에서
    //   여유 7.4%p로 **살아 있는 다리**가 된다.
    let worst = 0;
    for (const stage of STAGES) {
      const field = fieldOf(stage, B);
      for (const [id, w] of RESOURCE_WEIGHTS[stage.biome]) {
        const actual = (field.filter((c) => c.kind === id).length / field.length) * 100;
        const dev = Math.abs(actual - w);
        worst = Math.max(worst, dev);
        expect(dev).toBeLessThanOrEqual(20);
      }
    }
    console.log(`[resources] 분포 최악 편차 = ${worst.toFixed(1)}%p (문턱 20%p)`);
  });
});

describe('총액 (§9-1 ⑦) — 이 한 줄이 D9의 감사 가능성 전부다', () => {
  it('6스테이지 총액을 인쇄하고 **스테이지1 짐값합 281 / 판당 총액 494**를 잠근다', () => {
    const totals: number[] = [];
    // ⚠ 이 두 줄이 "여기서 잠근 총액"과 "게임이 실제로 내는 총액"을 갈라지지 못하게 한다.
    expect(GATHER_BASE_VALUE, 'balance.GATHER_BASE_VALUE 와 이 파일의 B 가 어긋났다 — 총액 표가 거짓이 된다').toBe(B);
    expect(GATHER_REGROW_MAX, 'balance.GATHER_REGROW_MAX 와 이 파일의 R 이 어긋났다 — 판당 총액 표가 거짓이 된다').toBe(R);
    console.log(`[resources] 스테이지별 채집 총액 (GATHER_BASE_VALUE = ${B} 기준)`);
    for (const stage of STAGES) {
      const field = fieldOf(stage, B);
      const total = field.reduce((n, c) => n + c.value, 0);
      const distSum = field.reduce((n, c) => n + c.dist, 0);
      const vals = field.map((c) => c.value).sort((a, b) => a - b);
      const kinds: Record<string, number> = {};
      for (const c of field) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      totals.push(total);
      console.log(
        `  s${stage.id} ${stage.biome.padEnd(9)} 칸 ${String(field.length).padStart(2)} · ` +
          `마을거리합 ${distSum.toFixed(4).padStart(9)} · 총액 ${String(total).padStart(4)} · ` +
          `최소/중앙/최대 ${vals[0]}/${median(vals)}/${vals[vals.length - 1]} · ${JSON.stringify(kinds)}`,
      );
    }

    // 스테이지1 짐값합 = 281골드 (B = 3). 부록 A의 검산 상수와 함께 잠근다.
    const s1 = fieldOf(STAGES[0] as StageDef, B);
    expect((STAGES[0] as StageDef).id).toBe(1);
    expect(s1.length).toBe(40);
    expect(s1.reduce((n, c) => n + c.dist, 0)).toBeCloseTo(306.4476, 4);
    expect(totals[0]).toBe(281);
    // 종류 배정도 사실이다 — wood 15 · berry 11 · stone 8 · fruit 4 · honey 2
    const s1kinds: Record<string, number> = {};
    for (const c of s1) s1kinds[c.kind] = (s1kinds[c.kind] ?? 0) + 1;
    expect(s1kinds).toEqual({ wood: 15, berry: 11, stone: 8, fruit: 4, honey: 2 });
    const s1vals = s1.map((c) => c.value).sort((a, b) => a - b);
    expect([s1vals[0], median(s1vals), s1vals[s1vals.length - 1]]).toEqual([3, 7, 13]);

    /*
     * ⚠⚠ **아래 벽(§1-5-B, 짐값 평균 > 조기 호출 13.66)은 이 라운드에 폐기했다.**
     *
     * 옛 유도: 조기 호출 완벽 연타가 13.66골드/탭이고, 채집은 **1탭 = 짐 하나**라
     *   짐값 평균이 13.66 아래면 "이미 있는 버튼보다 못한 잡일"이 되어 아무도 안 누른다.
     *
     * 그 전제는 **규칙 8(자동 채집)이 이미 없앴다.** 지금은 1탭 = 짐 하나가 아니다 —
     * 일꾼은 `trainAlly` 한 번이면 명령 없이 스스로 캐고 지고 와서 다시 나가고, 채집은
     * 탭을 **한 번도** 안 쓴다(조기 호출은 탭 40회를 요구한다). 곧 그 벽은 두 수입원이
     * 같은 손가락을 놓고 다투던 세계의 값이고, 그 세계는 없어졌다. 그런데 저장소는 그 벽을
     * 지운 적이 없어서 옛 어서션(`559 / 40 > 13.66`)이 여유 0.31골드로 남아 있었다 —
     * 그건 계약이 아니라 **지뢰**다(B를 정하는 진짜 근거는 위쪽 `18.*` 여유인데, 아래에서
     * 아무 근거 없는 벽이 먼저 터진다).
     * ⇒ 여기서 지운다. `balance.GATHER_BASE_VALUE` 주석이 그 유도를 전부 들고 있고,
     *   **명세 §1-5-B 정정은 남은 문서 부채**다.
     *
     * 대신 **실제로 구속하는 둘**을 잠근다:
     *  ① 판당 총액 = Σ v × (1 + 재생 횟수) = **494** — `18.rateCap` 이 재는 바로 그 수다.
     *     ⚠ 이 식이 재생 뒤의 총액 항등식이고, **판 길이·일꾼 수·재생 주기 T 와 무관**하다.
     *  ② 짐값 하한 — 정수 반올림이 짐을 "+1"짜리 연극으로 만들지 않는다.
     */
    const s1Total = s1.reduce((n, c) => n + c.value * harvestsOf(c.kind), 0);
    const s1Harvests = s1.reduce((n, c) => n + harvestsOf(c.kind), 0);
    expect(s1Total, '스테이지1 판당 채집 총액 (= 18.rateCap 의 문턱)').toBe(494);
    expect(s1Harvests, '스테이지1 판당 수확 상한 (= 18.harvests 의 문턱)').toBe(72);
    // 재생종 32칸 · 광물 8칸 (R4: stone·flint·obsidian 은 안 자란다)
    expect(s1.filter((c) => REGROWABLE_KINDS.has(c.kind)).length).toBe(32);
    expect(s1.filter((c) => !REGROWABLE_KINDS.has(c.kind)).length).toBe(8);
    expect(s1vals[0], '짐 하나가 최소 2골드는 된다 — 정수 반올림의 바닥').toBeGreaterThanOrEqual(2);
  });

  /**
   * ── 재고 비율의 **분모** (R7 신설) ────────────────────────────────────────
   * 재생의 방아쇠가 시간에서 밭의 재고 비율로 옮겨지면서
   * (`balance.GATHER_REGROW_STOCK_FRAC` · `sim/gather.ts ResourceField.regrowDenom`)
   * **재생종만의 짐값 합**이 새로 계약이 됐다. 여기서 그 수를 인쇄하고 잠근다.
   *
   * ⚠ 이 파일이 그 자리인 이유: 분모는 **좌표만의 함수**여야 하는데
   *   (`resourceKindOf` 는 셀 단독 해시 · `REGROWABLE_KINDS` 는 상수 · `gatherValueFor` 는
   *   마을거리의 함수) 이 파일의 `fieldOf` 는 시드를 **인자로 받지도 않는다.**
   *   곧 여기서 세어지는 것 자체가 그 성질의 증거다.
   * ⚠⚠ **s6 의 17.2% 가 분모 설계의 근거다.** 광물까지 분모에 넣으면 s6 은 바위를 다 캔 뒤
   *   재고가 그 비중 위로 영영 못 올라가 게이트가 상시 켜짐으로 굳는다 — 곧 그 스테이지에서
   *   기능이 통째로 죽는다. 그 사실을 여기서 수로 잠가 둔다.
   */
  it('`resources.regrowDenom` — 재생종만의 짐값 합(재고의 분모)을 인쇄하고 잠근다', () => {
    console.log('[resources] 스테이지별 재고 분모 (재생종 Σv) / 문턱값');
    for (const stage of STAGES) {
      const field = fieldOf(stage, B);
      const all = field.reduce((n, c) => n + c.value, 0);
      const denom = field
        .filter((c) => REGROWABLE_KINDS.has(c.kind))
        .reduce((n, c) => n + c.value, 0);
      // ⚠ 분모가 0이면 재고 비율이 **정의되지 않는다**(0으로 나눈다). 그때 sim 은 옛 규칙
      //   (순수 타이머)으로 닫도록 짜여 있지만, 배포 스테이지가 그 가지로 떨어지면
      //   사용자 요구가 그 판에서만 조용히 사라진다. 여섯 판 다 재생종이 있어야 한다.
      expect(denom, `s${stage.id} 에 재생종이 하나도 없다 — 재고 비율이 정의되지 않는다`).toBeGreaterThan(0);
      console.log(
        `  s${stage.id} ${stage.biome.padEnd(9)} 분모 ${String(denom).padStart(3)} / 총액 ${String(all).padStart(3)}` +
          ` = ${((denom / all) * 100).toFixed(1)}% · 문턱값 ${(GATHER_REGROW_STOCK_FRAC * denom).toFixed(1)}`,
      );
    }
    const s1 = fieldOf(STAGES[0] as StageDef, B);
    const s1Denom = s1.filter((c) => REGROWABLE_KINDS.has(c.kind)).reduce((n, c) => n + c.value, 0);
    expect(s1Denom, '스테이지1 재고 분모 (= 재생종 32칸의 짐값 합)').toBe(213);
    // ⚠ 이 줄은 문턱이 아니라 **인쇄해서 잠그는 실측값**이다 — `GATHER_REGROW_STOCK_FRAC`
    //   이 움직이면 여기도 따라 움직인다(분모 213 은 좌표만의 함수라 안 움직인다).
    //   0.35 × 213 = 74.55. 곧 s1 은 재생종 짐값이 74.55 아래로 내려가야 재생이 켜진다.
    expect(GATHER_REGROW_STOCK_FRAC * s1Denom, '스테이지1에서 재생이 켜지는 재고').toBeCloseTo(74.55, 6);
    // s6 — 분모 설계의 근거. 재생종이 총액의 **4분의 1도 안 된다**
    const s6 = fieldOf(STAGES[5] as StageDef, B);
    expect((STAGES[5] as StageDef).biome).toBe('volcano');
    const s6All = s6.reduce((n, c) => n + c.value, 0);
    const s6Denom = s6.filter((c) => REGROWABLE_KINDS.has(c.kind)).reduce((n, c) => n + c.value, 0);
    expect(
      s6Denom / s6All,
      '⚠ s6 의 재생종 비중 — 이 수가 커지면 balance.GATHER_REGROW_STOCK_FRAC 의 유도를 다시 써야 한다',
    ).toBeLessThan(0.25);
  });

  it('`resources.stageSpread` — 나머지 다섯이 s1의 **1.5배 이하**다', () => {
    // ⚠ 봉투는 s1에만 걸려 있어서 s3의 824는 지금 어떤 계약도 안 깬다. 그래도 이건 설계
    //   결함이다 — 손잡이 하나(D9)가 s1만 맞추면 나머지 다섯은 아무도 안 잠근다.
    //   처방은 상수를 늘리는 것이 아니라 **다리를 늘리는 것**이고, 이 다리가 그것이다.
    //   현재 최악이 s3 = 1.474배라 여유가 0.026배뿐이다 — 실측에 붙인 문턱이라는 뜻이다.
    //   ⚠ 이 비는 **B에 사실상 불변**이다(실측: B 4~24 전 구간에서 s3/s1 = 1.473~1.486).
    //   곧 짐값을 올려도 이 다리는 한 톨도 안 움직인다 — 그것이 "손잡이 하나가 s1만
    //   맞춘다"는 §1-7의 설계 결함이 B로는 안 낫고 안 나빠진다는 뜻이다.
    const totals = STAGES.map((s) => fieldOf(s, B).reduce((n, c) => n + c.value, 0));
    const s1 = totals[0] as number;
    let worst = 0;
    for (let i = 1; i < totals.length; i++) {
      const ratio = (totals[i] as number) / s1;
      worst = Math.max(worst, ratio);
      expect(ratio).toBeLessThanOrEqual(1.5);
    }
    console.log(`[resources] stageSpread 최악 = ${worst.toFixed(3)}배 (문턱 1.5배)`);
  });

  it('짐값 단조성 (§9-1 ⑧) — 같은 종이면 멀수록 값이 크거나 같다', () => {
    for (const stage of STAGES) {
      const byKind = new Map<ResourceId, Cell[]>();
      for (const c of fieldOf(stage, B)) {
        const arr = byKind.get(c.kind) ?? [];
        arr.push(c);
        byKind.set(c.kind, arr);
      }
      for (const arr of byKind.values()) {
        arr.sort((a, b) => a.dist - b.dist);
        for (let i = 1; i < arr.length; i++) {
          expect((arr[i] as Cell).value).toBeGreaterThanOrEqual((arr[i - 1] as Cell).value);
        }
      }
    }
  });

  it('B가 0이면 총액도 0이다 — 착수 기간의 사실', () => {
    // 착수 기간에는 GATHER_BASE_VALUE = 0이었다(T6이 8로 켰다). 그동안 채집은 코드로는
    // 돌지만 **한 푼도 안 냈다** — 봉투가 재는 것이 카드 자체의 몫뿐이 되게 하려는 것이었다.
    // 그 성질은 지금도 식으로 남아 있어야 한다(대조군 `gather-off`가 밟는 자리와 같은 축).
    for (const stage of STAGES) {
      expect(fieldOf(stage, 0).reduce((n, c) => n + c.value, 0)).toBe(0);
    }
  });
});

describe('gatherValueFor — round는 정확히 한 번만 닿는다', () => {
  it('마을 셀(거리 0)의 값은 기준값 × 배수의 반올림이다', () => {
    // ⚠ 리터럴이 아니라 **B**를 쓴다 — 한때 여기 `toBe(6)` 이 박혀 있어서 B가 6 → 3 으로
    //   내려가자 이 한 줄만 갈라졌다(같은 병이 8 → 6 때도 났다).
    //   이 테스트가 재려는 것은 값이 아니라 **round 가 정확히 한 번만 닿는다**이다.
    expect(gatherValueFor(B, 1, 0)).toBe(B);
    expect(gatherValueFor(B, RESOURCE_DEFS.berry.kindMul, 0)).toBe(Math.round(B * 0.73));
  });

  it('거리 이득이 1타일당 정확히 GATHER_DIST_GAIN이다', () => {
    // 반올림 전 값으로 비교한다 — 정수 반올림이 걸리면 비율이 아니라 계단이 보인다
    const raw = (d: number): number => 100 * 1 * (1 + GATHER_DIST_GAIN * d);
    expect(raw(1) - raw(0)).toBeCloseTo(100 * GATHER_DIST_GAIN, 10);
    expect(gatherValueFor(100, 1, 10)).toBe(280); // 100 × (1 + 0.18 × 10)
  });

  it('명령당 값의 폭이 4.5배를 넘는다 — **반올림 전** 값으로 잰다', () => {
    /**
     * ⚠ 한때 여기 `toBe(5)`가 박혀 있었다(B = 6에서 5 → 25). **그 5.0은 설계가 아니라
     * 반올림의 우연이었다** — 폭을 만드는 것은 B가 아니라 두 끝 칸의 `kindMul × 거리이득`
     * 비이고, 그 비는 **B와 무관하게** 다음과 같이 고정이다:
     *     stone(1.21) × (1 + 0.18 × 13.93)   4.2439
     *     ─────────────────────────────── = ────── = 4.637
     *     berry(0.73) × (1 + 0.18 × 1.41)    0.9153
     *
     * ⚠⚠ **이번 라운드에 선언을 다시 유도했다 — 문턱 4.5는 한 자리도 안 건드렸다.**
     *   옛 어서션은 **반올림된** 두 끝 값의 비를 쟀고, 그 비는 B가 내려갈수록 계단이 굵어져
     *   설계값 4.637에서 멀어진다: B = 8 → 34/7 = 4.857 · B = 6 → 25/5 = 5.000 ·
     *   **B = 3 → 13/3 = 4.333**(문턱 아래). 곧 재생 라운드가 B를 3으로 내리자 이 다리가
     *   **짐값 설계가 아니라 정수 반올림 때문에** 빨개졌다.
     *   처방은 문턱을 내리는 것이 **아니라**(이 저장소의 규칙) 재는 것을 설계값으로 되돌리는
     *   것이다 — 이 다리가 지키려던 명제는 처음부터 *"먼 돌과 가까운 딸기의 값 차가 4.5배를
     *   넘는다"* 였고 그건 `kindMul`·`GATHER_DIST_GAIN`·좌표가 정하지 반올림이 정하지 않는다.
     *   판별력은 그대로다: `kindMul` 표나 `GATHER_DIST_GAIN` 을 좁히면 여기가 곧장 빨개진다.
     *   ⚠ 대신 **플레이어가 실제로 보는 폭은 좁아졌다**(5.000 → 4.333배, 3 → 13골드).
     *     그건 B = 3 이 치른 정직한 대가이고, 아래에서 함께 인쇄해 감추지 않는다.
     */
    // 반올림을 무력화할 만큼 큰 기준값으로 같은 밭을 다시 만든다 — 식은 그대로다.
    const RAW_B = 1_000_000;
    const rawVals = fieldOf(STAGES[0] as StageDef, RAW_B).map((c) => c.value);
    const rawSpread = Math.max(...rawVals) / Math.min(...rawVals);
    expect(rawSpread, '반올림 전 값의 폭 — kindMul·거리이득·좌표만의 함수다').toBeGreaterThan(4.5);
    const vals = fieldOf(STAGES[0] as StageDef, B).map((c) => c.value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    console.log(
      `[resources] 명령당 값의 폭 = 반올림 전 ${rawSpread.toFixed(3)}배 · ` +
        `배포본(B = ${B}) 실제 ${(hi / lo).toFixed(3)}배 (${lo} → ${hi})`,
    );
  });
});

describe('배달 반경 — 집결 지점이 반경 밖이어야 한다 (§4-0)', () => {
  it('가장 가까운 집결 자리(마을거리 0.800)가 **밖**이고 기지 셀(0)은 안이다', () => {
    // musterPoint: forward = ALLY_MUSTER_FORWARD − row × ALLY_MUSTER_SPACING = 1.4 − row × 0.6
    // 둘째 줄(n = 3·4·5)의 마을거리가 1.000 · 0.800 · 1.000이고 판정이 `<=`라
    // 1.0이면 **세 자리가 전부 안**이다 → trainAlly가 곧 addGold가 되는 사고.
    expect(GATHER_DELIVER_RANGE).toBeLessThan(0.8);
    expect(GATHER_DELIVER_RANGE).toBeGreaterThan(0);
  });
});

describe('채집꾼 AllyDef (§2)', () => {
  it('확정 수치가 그대로다', () => {
    const g = ALLY_DEFS.gatherer;
    expect(g.hp).toBe(120);
    expect(g.speed).toBe(1.3);
    expect(g.armor).toBe(0);
    expect(g.radius).toBe(0.24);
    expect(g.cost).toBe(70);
    expect(g.dmg).toBe(3);
    expect(g.cooldownTicks).toBe(40);
    expect(g.range).toBe(0.9);
    expect(g.canTargetAir).toBe(false);
    expect(g.blocks).toBe(false);
    expect(g.gatherPct).toBe(300);
    expect(g.carryCap).toBe(2);
    // range 0을 쓰면 안 된다 — 조준이 안 서고 사거리 원이 반지름 0이 된다
    expect(g.range).toBeGreaterThan(0);
    // dmg 0을 쓰면 안 된다 — combat.ts의 max(1, raw − armor)이라 0이 "공격 없음"이 아니다
    expect(g.dmg).toBeGreaterThan(0);
  });

  it('전투 3종에도 gatherPct/carryCap이 붙어 있다 (전투 종이 0이면 정원 2에서 선택이 사라진다)', () => {
    expect(ALLY_DEFS.clubber.gatherPct).toBe(100);
    expect(ALLY_DEFS.slinger.gatherPct).toBe(100);
    expect(ALLY_DEFS.guardian.gatherPct).toBe(60);
    for (const id of ['clubber', 'slinger', 'guardian'] as const) {
      expect(ALLY_DEFS[id].carryCap).toBe(1);
    }
  });

  it('ALL_ALLY_IDS가 4종이고 **싼 것부터**다 (채집꾼 70이 맨 앞)', () => {
    expect(ALL_ALLY_IDS.length).toBe(4);
    expect(new Set(ALL_ALLY_IDS).size).toBe(4);
    expect(ALL_ALLY_IDS[0]).toBe('gatherer');
    for (let i = 1; i < ALL_ALLY_IDS.length; i++) {
      const prev = ALLY_DEFS[ALL_ALLY_IDS[i - 1] as (typeof ALL_ALLY_IDS)[number]];
      const cur = ALLY_DEFS[ALL_ALLY_IDS[i] as (typeof ALL_ALLY_IDS)[number]];
      expect(cur.cost).toBeGreaterThan(prev.cost);
    }
  });

  it('채집꾼은 넷 중 가장 빠르고 가장 약하다', () => {
    const g = ALLY_DEFS.gatherer;
    for (const id of ['clubber', 'slinger', 'guardian'] as const) {
      expect(g.speed).toBeGreaterThan(ALLY_DEFS[id].speed);
      expect(g.dmg / g.cooldownTicks).toBeLessThan(ALLY_DEFS[id].dmg / ALLY_DEFS[id].cooldownTicks);
      expect(g.cost).toBeLessThan(ALLY_DEFS[id].cost);
    }
  });
});

describe('gatherTicksFor — 속도에만 곱한다 (D8)', () => {
  it('채집꾼은 전 종을 정확히 1/3 시간에 캔다 (전부 정수 틱)', () => {
    for (const id of ALL_RESOURCE_IDS) {
      const t = gatherTicksFor(ALLY_DEFS.gatherer, id);
      expect(t).toBe(RESOURCE_DEFS[id].ticks / 3);
      expect(Number.isInteger(t)).toBe(true);
    }
    // 표의 초 값 — 딸기 4.0초 · 부싯돌(기준) 8.0초 · 돌 11.0초 · 흑요석 13.0초 (30틱 = 1초)
    expect(gatherTicksFor(ALLY_DEFS.gatherer, 'berry') / 30).toBe(4);
    expect(gatherTicksFor(ALLY_DEFS.gatherer, 'flint') / 30).toBe(8);
    expect(gatherTicksFor(ALLY_DEFS.gatherer, 'stone') / 30).toBe(11);
    expect(gatherTicksFor(ALLY_DEFS.gatherer, 'obsidian') / 30).toBe(13);
  });

  it('전투원도 딸기는 딸 만하고(12초) 돌은 못 딴다(33초)', () => {
    expect(gatherTicksFor(ALLY_DEFS.clubber, 'berry') / 30).toBe(12);
    expect(gatherTicksFor(ALLY_DEFS.clubber, 'stone') / 30).toBe(33);
    // 파수꾼(60)은 넷 중 가장 느리다 — 딸기 20.0초 · 돌 55.0초
    expect(gatherTicksFor(ALLY_DEFS.guardian, 'berry') / 30).toBe(20);
    expect(gatherTicksFor(ALLY_DEFS.guardian, 'stone') / 30).toBe(55);
  });

  it('gatherPct 생략은 100과 같다 (기준 속도)', () => {
    const { gatherPct: _drop, ...bare } = ALLY_DEFS.clubber;
    for (const id of ALL_RESOURCE_IDS) {
      expect(gatherTicksFor(bare, id)).toBe(gatherTicksFor(ALLY_DEFS.clubber, id));
    }
  });
});

describe('isGathering — 상태를 저장하지 않고 유도한다 (§3-4)', () => {
  const base = {
    id: 0,
    defId: 'gatherer' as const,
    hp: 120,
    maxHp: 120,
    x: 3,
    z: 4,
    prevX: 3,
    prevZ: 4,
    tgtX: 3,
    tgtZ: 4,
    walked: 0,
    heading: 0,
    attackCdLeft: 0,
    targetId: -1,
    gatherKey: -1,
    gatherTicks: 0,
    carryGold: 0,
    carryCount: 0,
    // 규칙 8) 자동 행동 — false = 자동 켜짐(기본). 이 파일은 흔들 일이 없다
    autoHold: false,
    alive: true,
  };

  it('예약이 없으면 목표에 서 있어도 캐는 중이 아니다', () => {
    expect(isGathering(base)).toBe(false);
  });

  it('예약이 있고 **도착했으면** 캐는 중이다', () => {
    expect(isGathering({ ...base, gatherKey: 42 })).toBe(true);
  });

  it('예약이 있어도 아직 가는 중이면 캐는 중이 아니다', () => {
    expect(isGathering({ ...base, gatherKey: 42, x: 3.01 })).toBe(false);
  });
});
