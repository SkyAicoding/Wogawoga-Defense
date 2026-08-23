/**
 * 채집 자원 데이터 검증 — docs/gather-spec.md §9-1 ①~⑧.
 *
 * 이 파일이 잠그는 것은 하나로 요약된다: **총액은 계산이 아니라 사실이다.**
 * 소품 좌표는 `hashSeed('scenery:'+stage.id)` 고정이고(grid.ts) 종류는 셀 단독 해시
 * (`resource:${id}:${key}`)라 **시드와 무관**하므로, 6스테이지의 짐값 합은 모든 판에서
 * 같은 한 숫자다. 그 숫자를 어서션 한 줄로 박아 두는 것이 D9(손잡이 하나)의 감사 가능성 전부다.
 *
 * ⚠ **`GATHER_BASE_VALUE`는 착수 기간 동안 0이다**(T6이 켠다). 그래서 여기서는 상수를 읽지
 *   않고 `gatherValueFor(6, …)`로 **기준값을 인자로 넣어** B = 6에서의 총액을 검증한다.
 *   곧 이 파일은 지금도, 값을 켠 뒤에도, 같은 숫자를 잠근다.
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
import { gatherValueFor, GATHER_DIST_GAIN, GATHER_DELIVER_RANGE } from '@/data/balance';
import {
  RESOURCE_DEFS,
  RESOURCE_WEIGHTS,
  gatherTicksFor,
  isGathering,
  resourceKindOf,
} from '@/data/resources';

/** T6이 켤 값. 상수가 0인 동안에도 총액 표를 검증할 수 있게 여기서 못 박는다 (gather-spec §1-5-C) */
const B = 6;

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
  it('6스테이지 총액을 인쇄하고 **스테이지1 === 559**를 잠근다', () => {
    const totals: number[] = [];
    console.log('[resources] 스테이지별 채집 총액 (GATHER_BASE_VALUE = 6 기준)');
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

    // 스테이지1 = 559골드. 부록 A의 검산 상수와 함께 잠근다.
    const s1 = fieldOf(STAGES[0] as StageDef, B);
    expect((STAGES[0] as StageDef).id).toBe(1);
    expect(s1.length).toBe(40);
    expect(s1.reduce((n, c) => n + c.dist, 0)).toBeCloseTo(306.4476, 4);
    expect(totals[0]).toBe(559);
    // 종류 배정도 사실이다 — wood 15 · berry 11 · stone 8 · fruit 4 · honey 2
    const s1kinds: Record<string, number> = {};
    for (const c of s1) s1kinds[c.kind] = (s1kinds[c.kind] ?? 0) + 1;
    expect(s1kinds).toEqual({ wood: 15, berry: 11, stone: 8, fruit: 4, honey: 2 });
    const s1vals = s1.map((c) => c.value).sort((a, b) => a - b);
    expect([s1vals[0], median(s1vals), s1vals[s1vals.length - 1]]).toEqual([5, 14, 25]);

    // ⚠ 아래 벽 (§1-5-B): 조기 호출 완벽 연타가 13.66골드/탭이다. 채집의 탭당 값은 짐값
    //   그 자체이므로(1탭 = 짐 하나), 평균이 그 아래로 내려가면 **아무도 안 누른다**.
    expect(559 / 40).toBeGreaterThan(13.66);
  });

  it('`resources.stageSpread` — 나머지 다섯이 s1의 **1.5배 이하**다', () => {
    // ⚠ 봉투는 s1에만 걸려 있어서 s3의 824는 지금 어떤 계약도 안 깬다. 그래도 이건 설계
    //   결함이다 — 손잡이 하나(D9)가 s1만 맞추면 나머지 다섯은 아무도 안 잠근다.
    //   처방은 상수를 늘리는 것이 아니라 **다리를 늘리는 것**이고, 이 다리가 그것이다.
    //   현재 최악이 s3 = 1.474배라 여유가 0.026배뿐이다 — 실측에 붙인 문턱이라는 뜻이다.
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
    // GATHER_BASE_VALUE = 0으로 시작한다(T6이 켠다). 그동안 채집은 코드로는 돌지만
    // **한 푼도 안 낸다** — 봉투가 재는 것이 카드 자체의 몫뿐이 되게 하려는 것이다.
    for (const stage of STAGES) {
      expect(fieldOf(stage, 0).reduce((n, c) => n + c.value, 0)).toBe(0);
    }
  });
});

describe('gatherValueFor — round는 정확히 한 번만 닿는다', () => {
  it('마을 셀(거리 0)의 값은 기준값 × 배수의 반올림이다', () => {
    expect(gatherValueFor(B, 1, 0)).toBe(6);
    expect(gatherValueFor(B, RESOURCE_DEFS.berry.kindMul, 0)).toBe(Math.round(6 * 0.73));
  });

  it('거리 이득이 1타일당 정확히 GATHER_DIST_GAIN이다', () => {
    // 반올림 전 값으로 비교한다 — 정수 반올림이 걸리면 비율이 아니라 계단이 보인다
    const raw = (d: number): number => 100 * 1 * (1 + GATHER_DIST_GAIN * d);
    expect(raw(1) - raw(0)).toBeCloseTo(100 * GATHER_DIST_GAIN, 10);
    expect(gatherValueFor(100, 1, 10)).toBe(280); // 100 × (1 + 0.18 × 10)
  });

  it('명령당 값의 폭이 5.0배다 (s1 최소 5 → 최대 25)', () => {
    const vals = fieldOf(STAGES[0] as StageDef, B).map((c) => c.value);
    expect(Math.max(...vals) / Math.min(...vals)).toBe(5);
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
