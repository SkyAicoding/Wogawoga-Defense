/**
 * 소품(장식) 예산 계약.
 *
 * 이 파일이 잠그는 것은 그림이 아니라 **값**이다. 소품은 스테이지당 40~51개 셀에
 * 배치되고 전부 하나로 병합되므로 드로우콜은 1이지만 삼각형은 셀 수만큼 곱해진다.
 * 여기서 세 가지를 잠근다.
 *   ① 층 요소 하나의 원가 (PROTO_TRI_BUDGET)
 *   ② 소품 셀 하나의 합계 (CELL_TRI_BUDGET)
 *   ③ 스테이지별 소품 지오메트리 총량 (STAGE_CAP) — 이게 프레임 예산에 직접 들어간다
 *
 * ⚠ ③이 프레임에서 **한 번만** 청구된다는 것이 이 표의 전제다(propsMesh.castShadow=false).
 * 소품을 다시 섀도 캐스터로 되돌리면 아래 수치가 전부 2배로 청구되고, 스테이지3~6은
 * 그 즉시 e2e 삼각형 예산(150,000)을 넘는다. 그래서 castShadow 도 여기서 잠근다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CELL_SOFT_BUDGET,
  CELL_TRI_BUDGET,
  FLAT_QUAD_MIN_ASPECT,
  PROP_ELEMENTS,
  PROP_KITS,
  PROTO_TRI_BUDGET,
  buildProps,
  elementGeometry,
  elementHeight,
  elementTriCount,
} from '@/render/meshlib/props';
import type { Element } from '@/render/meshlib/props';
import { cellKey, rasterizePathCells, sceneryCells } from '@/data/grid';
import { RESOURCE_WEIGHTS, isLandmarkCell, resourceKindOf } from '@/data/resources';
import { STAGES } from '@/data/stages';
import type { BiomeId, ResourceId, StageDef, Vec2 } from '@/data/types';

/**
 * 스테이지별 소품 삼각형 상한 (실측 + 여유 ~6%).
 *
 * 개정 전 실측(같은 셀 목록)은 s1 6,076 / s2 8,980 / s3 10,584 / s4 6,948 /
 * s5 7,576 / s6 5,714 였고 **섀도 패스 때문에 프레임에서 2배로** 청구됐다.
 * 지금은 셀 하나에 4~7개(3층)가 들어가는데도 총량이 그때와 비슷하거나 적고,
 * 청구는 1배다 — 곧 스테이지마다 프레임 삼각형이 순수하게 줄었다.
 *
 * ── 소품 다양화 개정(크기 계층 + 부 소품 + 신규 33종) 후 재실측 ──────────────
 *   s1 8,635(216/셀) · s2 8,636(196) · s3 11,029(216) · s4 8,733(182) ·
 *   s5 9,712(231) · s6 7,913(198)   ← 아래 상한은 이 값 + 6~7%
 * 개정 전 대비 증가분은 s1 +1,186 / s3 +2,849 / s6 +2,111 이고, 최악 프레임
 * 실측(s1 127,378 / s3 133,110 / s6 128,740)에 그대로 더해도 예산 150,000 대비
 * 9~14% 여유가 남는다. 이 여유는 맨 셀 장식 레이어와 이후 LOD 작업의 몫이다.
 *
 * ── 랜드마크 + 꽃송이 개정 후 재실측 (상한은 **안 올렸다**) ─────────────────
 *   s1 8,993(225/셀) · s2 8,725(198) · s3 11,233(220) · s4 8,681(181) ·
 *   s5 9,749(232) · s6 8,066(202)
 * 증가분이 s1 +358 / s3 +204 로 작은 이유는 랜드마크가 **셀 아홉에 하나**뿐이고
 * (원가도 68~136으로 기존 1층과 같은 급이다), 꽃 개정은 4각 2 tri 넷을 6각 4 tri
 * 둘로 바꾼 것이라 **값이 같기 때문**이다. 곧 이 개정의 그림 값은 삼각형이 아니라
 * 배치 규칙에서 나왔다.
 * e2e 최악 프레임 실측(1280×800, 타워 10+·적 40+·아군 6+):
 *   s1 75콜/129,717 · s2 72/120,672 · s3 74/137,157 · s4 75/134,184 ·
 *   s5 75/135,112 · s6 72/131,275   ← 상한 90콜 / 150,000 대비 8~19% 여유
 *
 * ── 채집 개정(자원 종류 = 1층 실루엣 · 셀 단위 rng) 후 재실측 ────────────────
 *   s1 9,565(239/셀) · s2 8,643(196) · s3 11,056(217) · s4 8,616(180) ·
 *   s5 9,828(234) · s6 7,610(190)
 * 여섯 판 합계는 **줄었다**(56,447 → 55,318, −1,129). 신규 자원 원형 여섯이
 * 기존 1층보다 싸기 때문이다(48~104 vs 84~116) — 그래서 낮은 종(berry/honey/
 * mushroom/flint)이 많은 판일수록 값이 내려간다: s6 −456 · s3 −177 · s2 −82.
 *
 * ⚠ **s1 만 +572 로 늘었고, 그 전액이 랜드마크다.** 랜드마크 판정이 소품 rng
 * (0.11)에서 자원 모듈(`isLandmarkCell`: wood/stone 셀의 24%)로 옮겨 가면서
 * s1 의 랜드마크가 3그루 → 7그루가 됐고, elderTree 가 136 tri 다(4 × 136 = 544).
 * 곧 이 증가는 소품 편성이 아니라 **자원 배정표가 정한 값**이라 여기서 깎을 수
 * 없다. s1 상한만 실측 + 6.6% 로 올린다(9,200 → 10,200). 나머지 다섯은 실측이
 * 내려갔으므로 **상한을 한 자리도 안 건드린다** — 내리는 것도 규약이 아니다.
 *
 * 프레임 예산(계약 C: 90콜 / 150,000)에 미치는 영향:
 *   s1 129,717 + 572 = 130,289 (여유 19,711) · s3 137,157 − 177 = 136,980 (여유 13,020)
 *   e2e 집결지 6명(s1) 138,031 + 572 = 138,603 (여유 11,397)
 * 드로우콜은 **한 개도 안 늘었다** — 신규 원형 여섯이 전부 같은 병합 메시에 들어간다.
 */
const STAGE_CAP: Record<number, number> = {
  1: 10_200,
  2: 9_200,
  3: 11_700,
  4: 9_300,
  5: 10_400,
  6: 8_400,
};

/** 개정 전 소품 지오메트리 (프레임 청구액은 섀도 패스로 이 값의 2배였다) */
const BEFORE: Record<number, number> = {
  1: 6_076,
  2: 8_980,
  3: 10_584,
  4: 6_948,
  5: 7_576,
  6: 5_714,
};

/**
 * stage3d.build 가 소품에 넘기는 것과 **똑같은** 인자를 만든다.
 * (terrain.buildStage 를 부르지 않는 이유: 그쪽은 지금 다른 작업이 동시에 고치는 중이라
 *  소품 예산 테스트가 지형 변경에 끌려다니면 안 된다. cellToWorld 는 격자 중심 정렬
 *  한 줄이라 여기 복제해도 어긋날 여지가 없다 — terrain.ts:49 와 같은 식이다)
 */
function sceneryOf(stage: StageDef): {
  list: Vec2[];
  cellToWorld: (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3;
  kindOf: (cellX: number, cellZ: number) => { kind: ResourceId; landmark: boolean };
} {
  const pathCells = rasterizePathCells(stage);
  const list = [...sceneryCells(stage, pathCells)].map((k) => ({
    x: k % stage.gridW,
    z: Math.floor(k / stage.gridW),
  }));
  const halfW = (stage.gridW - 1) / 2;
  const halfH = (stage.gridH - 1) / 2;
  return {
    list,
    cellToWorld: (x, z, out) => (out ?? new THREE.Vector3()).set(x - halfW, 0, z - halfH),
    /*
     * ⚠ 여기서 종류를 **다시 굴리지 않는다** — stage3d.ts:92 와 같은 두 함수를 그대로
     * 부른다. 소품 실루엣은 이제 자원 종류가 정하므로, 테스트가 자기 배정표를 쓰면
     * 이 파일이 재는 삼각형 수는 게임이 실제로 그리는 것이 아니게 된다.
     */
    kindOf: (cellX, cellZ) => {
      const key = cellKey(stage, cellX, cellZ);
      const kind = resourceKindOf(stage, key);
      return { kind, landmark: isLandmarkCell(stage, key, kind) };
    },
  };
}

function triCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      if (!m.visible) return;
      const pos = m.geometry.getAttribute('position');
      if (pos) n += pos.count / 3;
    }
  });
  return n;
}

function propsMeshOf(root: THREE.Object3D): THREE.Mesh {
  const m = root.getObjectByName('propsMesh');
  expect(m, 'propsMesh 가 있어야 한다').toBeTruthy();
  return m as THREE.Mesh;
}

describe('층 요소 원가표', () => {
  it(`요소 하나는 ${PROTO_TRI_BUDGET} 삼각형을 넘지 않는다`, () => {
    const rows: string[] = [];
    for (const [name, el] of Object.entries(PROP_ELEMENTS)) {
      const n = elementTriCount(el);
      rows.push(`${name} ${n}`);
      expect(n, `${name} 가 원가 상한을 넘었다`).toBeLessThanOrEqual(PROTO_TRI_BUDGET);
      expect(n, `${name} 가 비어 있다`).toBeGreaterThan(0);
    }
    // eslint-disable-next-line no-console
    console.log('원가표:', rows.sort((a, b) => Number(b.split(' ')[1]) - Number(a.split(' ')[1])).join(' · '));
  });

  it('바이옴마다 1·2·3층이 모두 있고 실루엣이 2종 이상이다', () => {
    for (const [biome, kit] of Object.entries(PROP_KITS)) {
      const distinct = new Set(kit.hero.map((e) => elementTriCount(e)));
      expect(distinct.size, `${biome} 의 1층 실루엣이 너무 단조롭다`).toBeGreaterThanOrEqual(3);
      expect(kit.mid.length, `${biome} 2층 없음`).toBeGreaterThan(0);
      expect(kit.ground.length, `${biome} 3층 없음`).toBeGreaterThan(0);
      expect(kit.midCount[0], `${biome} 2층이 0개일 수 있다`).toBeGreaterThanOrEqual(1);
      expect(kit.groundCount[0], `${biome} 3층이 0개일 수 있다`).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * 사용자가 지적한 것("나무, 바위, 이것밖에 없어")의 정량적 정체는 종류 수가 아니라
   * **크기 폭**이었다. 개정 전 초원은 heroScale [0.78, 1.0](±12%)에 원형 높이도
   * 1.37~1.70 이라, 곱해도 판 위 모든 나무가 28% 밴드 안에 있었다.
   * 여기서 잠그는 것은 "그 밴드가 다시 좁아지지 않는다"이다.
   */
  it('1층에 크기 계층이 있다 — 배율 봉투와 원형 높이가 둘 다 넓다', () => {
    const rows: string[] = [];
    for (const [biome, kit] of Object.entries(PROP_KITS)) {
      const [lo, hi] = kit.heroScale;
      expect(hi / lo, `${biome} heroScale 봉투가 좁다 — 다시 한 크기로 보인다`).toBeGreaterThanOrEqual(1.7);

      // 원형 자체의 높이 폭. 배율만 넓히면 같은 실루엣이 커졌다 작아졌다 할 뿐이다.
      const heights = kit.hero.map(elementHeight);
      const minH = Math.min(...heights);
      const maxH = Math.max(...heights);
      expect(maxH, `${biome} 1층에 2.0급 큰 원형이 없다`).toBeGreaterThanOrEqual(1.4);
      expect(minH, `${biome} 1층에 0.3급 낮은 원형이 없다`).toBeLessThanOrEqual(0.5);
      // 배율까지 곱한 실제 세계 높이 폭 — 여기가 눈에 보이는 값이다
      expect((maxH * hi) / (minH * lo), `${biome} 실제 높이 폭이 좁다`).toBeGreaterThanOrEqual(5);
      rows.push(`${biome} 배율 ${lo}~${hi} · 원형 h ${minH.toFixed(2)}~${maxH.toFixed(2)} · 실제 ${(minH * lo).toFixed(2)}~${(maxH * hi).toFixed(2)}`);

      // 부 소품(밑동 옆 작은 것) — 없으면 셀당 1층이 다시 1개 고정이 된다
      expect(kit.companion.length, `${biome} 부 소품 후보 없음`).toBeGreaterThanOrEqual(2);
      for (const el of kit.companion) {
        expect(elementTriCount(el), `${biome} 부 소품이 너무 비싸다`).toBeLessThanOrEqual(80);
      }
    }
    // eslint-disable-next-line no-console
    console.log('크기 계층:\n  ' + rows.join('\n  '));
  });

  /**
   * 편성표에 **익명 인라인 요소**를 두지 않는다.
   *
   * 개정 전 설원·늪 편성표에는 `{ flats: [...] }` 가 그대로 박혀 있었고, 그래서 그
   * 판들이 아래 기하 규칙 점검(PROP_ELEMENTS 순회)을 통째로 빠져나갔다 — 설원의
   * 4각 0.24×0.20 하늘색 판 두 장이 흰 눈밭 위에서 가장 눈에 띄는 스티커였는데도
   * 테스트가 초록불이었다. 이름을 강제하는 것이 그 구멍을 막는 유일한 방법이다.
   */
  it('편성표의 모든 요소는 PROP_ELEMENTS 에 이름으로 등록돼 있다', () => {
    /**
     * 형태 서명 — **변 수와 종횡비**만 본다.
     *
     * 편성표에는 같은 함수를 인자만 바꿔 부른 것이 많고(bushRound(초록A)/
     * bushRound(초록B), groundPatch(색, 폭) …) 그건 정상이다. 여기서 막으려는 것은
     * 어느 이름 있는 함수에서도 나오지 않은 **손으로 쓴 판 뭉치**다.
     * 위 기하 규칙이 판별하는 것이 정확히 변 수와 종횡비이므로, 서명에서 색과
     * 절대 크기를 빼면 "규칙 관점에서 같은 형태"가 정확히 한 부류가 된다.
     */
    const ratio = (s?: readonly number[] | number): string => {
      if (typeof s === 'number' || s === undefined) return '1';
      const z = s[s.length - 1] as number;
      // 마지막 성분으로 나눠 절대 크기를 지운다 (판은 x:z, 입체는 x:y:z)
      return s.map((v) => (v / z).toFixed(3)).join(':');
    };
    const sig = (el: Element): string =>
      JSON.stringify([
        (el.solids ?? []).map((s) => [s.kind, s.seg ?? 6, ratio(s.scale)]),
        (el.flats ?? []).map((f) => [f.sides ?? 4, ratio(f.scale)]),
      ]);
    const known = new Set(Object.values(PROP_ELEMENTS).map(sig));
    for (const [biome, kit] of Object.entries(PROP_KITS)) {
      const lists: [string, Element[]][] = [
        ['hero', kit.hero],
        ['landmark', kit.landmark],
        ['companion', kit.companion],
        ['mid', kit.mid],
        ['ground', kit.ground],
      ];
      for (const [layer, list] of lists) {
        for (const el of list) {
          expect(known.has(sig(el)), `${biome}.${layer} 에 이름 없는 요소가 있다 — 기하 규칙 점검이 새어 나간다`).toBe(true);
        }
      }
    }
  });

  /**
   * 4각 판은 **획**일 때만 허용한다 (종횡비 ≥ FLAT_QUAD_MIN_ASPECT).
   *
   * 심판 확대 캡처에서 소품의 꽃이 마젠타·흰색·노랑·빨강 정사각형 색 견본으로
   * 읽혔다 — 초원 덤불(wildflowerBunch 4각 0.11 넷)·정글 덤불(flowerBush)·사막
   * 선인장(barrelCactus) 세 바이옴 동일. 4각형은 화면상 3~8px 에서 안티에일리어싱을
   * 거쳐도 직각이 살아남는 유일한 다각형이라 "잘라 붙인 색종이"가 지워지지 않는다.
   *
   * 바닥 결 레이어는 4각을 전면 금지했지만(grounddetail.test.ts) 소품은 그럴 수
   * 없다 — 야자 잎·덩굴·용암 줄기가 전부 4각 2 tri 이고, 그것들은 길쭉해서 도형이
   * 아니라 한 획으로 읽힌다. 그래서 여기서는 **종횡비**로 가른다.
   */
  it('4각 판은 종횡비가 충분하다 — 정사각에 가까운 4각은 색종이 조각이 된다', () => {
    const rows: string[] = [];
    for (const [name, el] of Object.entries(PROP_ELEMENTS)) {
      for (const f of el.flats ?? []) {
        const n = f.sides ?? 4;
        expect(n, `${name}: 판의 변이 3개 미만이다`).toBeGreaterThanOrEqual(3);
        if (n !== 4) continue;
        const sx = f.scale?.[0] ?? 1;
        const sz = f.scale?.[1] ?? 1;
        const asp = Math.max(sx, sz) / Math.min(sx, sz);
        rows.push(`${name} ${asp.toFixed(2)}`);
        expect(
          asp,
          `${name}: 4각 판 ${sx}×${sz} (종횡비 ${asp.toFixed(2)}) — 이 크기에서 정사각형은 스티커다. 6각으로 올리거나 더 길게 늘여라`,
        ).toBeGreaterThanOrEqual(FLAT_QUAD_MIN_ASPECT);
      }
    }
    expect(rows.length, '4각 판이 하나도 없다 — 규칙이 대상을 잃었다').toBeGreaterThan(10);
  });

  /**
   * 꽃송이는 **6각**이다. 5각도 이 크기에서는 각이 남는다 — 사막 선인장의 5각
   * 0.13/0.16 꽃이 실제로 "빨강·흰 정사각형"으로 지적됐다.
   * 색으로 판별한다: 꽃 색(P.flower*)을 쓴 판은 반드시 6각 이상이어야 한다.
   */
  it('꽃 색을 쓴 판은 6각 이상이다', () => {
    const FLOWER = new Set([0xf6f2e2, 0xf2cf4a, 0xe07a9c, 0xd8412e]);
    let seen = 0;
    for (const [name, el] of Object.entries(PROP_ELEMENTS)) {
      for (const f of el.flats ?? []) {
        if (!FLOWER.has(f.color)) continue;
        seen++;
        expect(f.sides ?? 4, `${name}: 꽃송이가 ${f.sides ?? 4}각이다 — 6각부터 이 크기에서 원으로 뭉개진다`).toBeGreaterThanOrEqual(6);
      }
    }
    expect(seen, '꽃 판을 하나도 못 찾았다').toBeGreaterThan(4);
  });

  it('셀 채우기 예산은 셀 상한 안에 있다 (구조적으로 초과 불가)', () => {
    expect(CELL_SOFT_BUDGET).toBeLessThan(CELL_TRI_BUDGET);
    expect(CELL_SOFT_BUDGET).toBeGreaterThan(CELL_TRI_BUDGET * 0.9);
  });
});

describe('크기 계층', () => {
  /**
   * 랜드마크 계약 — hero 최댓값과 **사이에 틈**이 있어야 한다.
   * 랜드마크가 hero 큰 계층과 겹치면 그건 그냥 "조금 더 큰 나무"이고, 심판이
   * "판을 지배하는 큰 실루엣이 0개"라고 한 상태로 돌아간다.
   */
  it('바이옴마다 랜드마크가 있고 hero 최댓값보다 확실히 크다', () => {
    const rows: string[] = [];
    for (const [biome, kit] of Object.entries(PROP_KITS)) {
      expect(kit.landmark.length, `${biome} 랜드마크 없음`).toBeGreaterThanOrEqual(1);
      const heroMax = Math.max(...kit.hero.map(elementHeight)) * kit.heroScale[1];
      for (const el of kit.landmark) {
        const h = elementHeight(el);
        expect(elementTriCount(el), `${biome} 랜드마크가 원가 상한을 넘었다`).toBeLessThanOrEqual(PROTO_TRI_BUDGET);
        // 랜드마크 최소 배율 0.92 를 곱해도 hero 최댓값보다 15% 이상 커야 한다
        expect(h * 0.92, `${biome} 랜드마크(${h.toFixed(2)})가 hero 최댓값(${heroMax.toFixed(2)})과 겹친다`).toBeGreaterThan(
          heroMax * 1.15,
        );
        rows.push(`${biome} 랜드마크 ${h.toFixed(2)} vs hero최대 ${heroMax.toFixed(2)} · ${elementTriCount(el)} tri`);
      }
    }
    // eslint-disable-next-line no-console
    console.log('랜드마크:\n  ' + rows.join('\n  '));
  });

  /**
   * **게임플레이 가림 실측** — 랜드마크가 기존 1층보다 지면을 더 가리면 안 된다.
   *
   * 소품이 커지면 적·타워·부족원·체력바를 가릴 수 있다. 카메라 피치가 40~65°라
   * 높이 h 인 질량은 카메라 쪽으로 h/tan(피치) 셀 떨어진 지면을 덮는다 — 3급 소품이면
   * 최악(40°)에 3.5셀 밖까지다. 그런데 **가리는 양은 높이가 아니라 실루엣이 정한다**:
   * 밑동이 빈 나무는 캐노피 두께만큼만 덮고, 밑동부터 꽉 찬 원뿔은 그 사이 전부를 덮는다.
   * 그래서 랜드마크를 "위에 질량, 아래는 비움"으로 설계했고(props.ts "신규 1층 ③" ②),
   * 여기서 그 설계가 실제로 성립하는지를 삼각형 단위로 잰다 —
   * 각 삼각형을 카메라 반대 방향으로 지면에 투영해 덮인 면적을 구한다.
   *
   * 계약: **랜드마크(최대 배율)가 그 바이옴 1층 최악(최대 배율)보다 더 가리지 않는다.**
   * 곧 판이 3급으로 높아져도 게임플레이가 보이는 정도는 개정 전과 같거나 낫다.
   */
  it('가림 실측 — 랜드마크가 기존 1층 최대보다 지면을 더 가리지 않는다', () => {
    /*
     * 재는 것은 "덮인 면적"이 아니라 **유닛 하나가 통째로 숨을 수 있는 면적**이다.
     *
     * 단순 면적은 가는 줄기를 캐노피와 같은 값으로 세어 답을 틀리게 만든다 — 실제로
     * 첫 판이 그랬다: palmColossus 가 palmTall 보다 25% 더 "가린다"고 나왔는데,
     * 초과분 전액이 폭 0.22셀짜리 **줄기 한 줄기의 띠**였다. 폭 0.22 띠는 지름 0.5인
     * 적을 통째로 가리지 못한다(반쯤 걸칠 뿐이고, 그건 오히려 깊이감을 준다).
     * 야자 잎도 마찬가지다 — 판 여덟 장이 방사형으로 벌어져 있어 면적은 넓지만
     * 사이가 다 뚫려 있다.
     *
     * 그래서 래스터 마스크를 유닛 반지름(0.25셀)만큼 **침식**한 뒤 센다. 남는 것은
     * "지름 0.5짜리 원이 완전히 들어가는 곳" = 적·부족원·체력바가 실제로 사라지는
     * 곳뿐이다. 이 정의라면 빽빽한 원뿔(pineGiant·volcanoCone)만 값을 치른다.
     */
    const UNIT_R = 0.25;
    const G = 0.05;
    const occludedArea = (el: Element, scale: number, pitchDeg: number): number => {
      const geo = elementGeometry(el);
      const pos = geo.getAttribute('position');
      // 카메라 쪽으로 y/tan(pitch) 만큼 밀면 그 정점이 가리는 지면 점이다 (요는 0으로 고정 —
      // 소품은 배치할 때 무작위 yaw 로 돌아가므로 방위별 차이는 평균에 묻힌다)
      const k = 1 / Math.tan((pitchDeg * Math.PI) / 180);
      const px: number[] = [];
      const pz: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        px.push(pos.getX(i) * scale - pos.getY(i) * scale * k);
        pz.push(pos.getZ(i) * scale);
      }
      const MIN = -6;
      const N = Math.ceil(12 / G);
      const at = (ix: number, iz: number): number => ix * N + iz;
      const mask = new Uint8Array(N * N);
      for (let t = 0; t < pos.count; t += 3) {
        const ax = px[t] as number;
        const az = pz[t] as number;
        const bx = px[t + 1] as number;
        const bz = pz[t + 1] as number;
        const cx = px[t + 2] as number;
        const cz = pz[t + 2] as number;
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(den) < 1e-12) continue;
        const i0 = Math.floor((Math.min(ax, bx, cx) - MIN) / G);
        const i1 = Math.ceil((Math.max(ax, bx, cx) - MIN) / G);
        const j0 = Math.floor((Math.min(az, bz, cz) - MIN) / G);
        const j1 = Math.ceil((Math.max(az, bz, cz) - MIN) / G);
        for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
          for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) {
            const x = MIN + i * G;
            const z = MIN + j * G;
            const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
            const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
            if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
            mask[at(i, j)] = 1;
          }
        }
      }
      geo.dispose();
      // 유닛 반지름만큼 침식 — 원판이 통째로 들어가는 자리만 남는다
      const R = Math.round(UNIT_R / G);
      const disc: [number, number][] = [];
      for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) if (di * di + dj * dj <= R * R) disc.push([di, dj]);
      let n = 0;
      for (let i = R; i < N - R; i++) {
        for (let j = R; j < N - R; j++) {
          if (!mask[at(i, j)]) continue;
          let all = true;
          for (const [di, dj] of disc) {
            if (!mask[at(i + di, j + dj)]) {
              all = false;
              break;
            }
          }
          if (all) n++;
        }
      }
      return n * G * G;
    };

    const rows: string[] = [];
    // 55° = 기본 피치, 40° = 하한(가장 많이 가리는 각)
    for (const pitch of [55, 40]) {
      for (const [biome, kit] of Object.entries(PROP_KITS)) {
        const heroWorst = Math.max(...kit.hero.map((el) => occludedArea(el, kit.heroScale[1], pitch)));
        for (const el of kit.landmark) {
          const lm = occludedArea(el, 1.12, pitch);
          rows.push(`${pitch}° ${biome} 랜드마크 ${lm.toFixed(2)} vs 1층최악 ${heroWorst.toFixed(2)} 셀²`);
          expect(
            lm,
            `${biome} 랜드마크가 피치 ${pitch}°에서 기존 1층 최악보다 지면을 더 가린다 (${lm.toFixed(2)} > ${heroWorst.toFixed(2)} 셀²) — 밑동을 더 비워라`,
          ).toBeLessThanOrEqual(heroWorst);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log('가림 실측:\n  ' + rows.join('\n  '));
  });

  /**
   * **실측**: 실제로 배치된 셀의 높이 분포. 여기가 이 개정의 핵심 계약이다.
   *
   * 개정 전에도 heroScale 봉투는 넓었고(±30%) 2.0급 원형도 있었는데 화면에서는
   * 계층이 안 보였다. 실측 히스토그램이 이유를 말해 줬다 — 초원의 분포가
   *   0.3+ 22% · 0.6+ 13% · 0.9+ 15% · 1.2+ 17% · 1.5+ 14% · 1.8+ 8% · 2.1+ 3%
   * 로 **완전히 평평했다**. 배율 계층과 원형 선택이 독립이라 두 분포를 곱하는 순간
   * 봉투의 틈이 메워졌기 때문이다. 그래서 이 테스트가 잠그는 것은 "봉투가 넓다"가
   * 아니라 **분포에 봉우리와 골이 있다**이다:
   *   · 랜드마크급(2.5+)이 스테이지마다 있고, 그러나 드물다
   *   · 큰 것(1.4+)이 4분의 1은 된다
   *   · 셀 전체가 낮은 칸(0.9 미만)도 6분의 1은 된다 — 이게 있어야 큰 것이 커 보인다
   */
  it('배치 실측 — 랜드마크는 드물고, 큰 것과 낮은 것이 둘 다 있다', () => {
    /** 그 셀에 y > t 인 정점이 있었는지 (셀을 지우기 전후의 개수 차로 잰다) */
    const countAbove = (mesh: THREE.Mesh, t: number): number => {
      const p = mesh.geometry.getAttribute('position');
      if (!p) return 0;
      let n = 0;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > t) n++;
      return n;
    };
    const rows: string[] = [];
    for (const stage of STAGES) {
      const { list, cellToWorld, kindOf } = sceneryOf(stage);
      const props = buildProps(stage.biome, list, cellToWorld, stage.id, kindOf);
      const mesh = propsMeshOf(props.group);
      const T = [0.9, 1.4, 2.5];
      let prev = T.map((t) => countAbove(mesh, t));
      const hit = [0, 0, 0];
      for (const cell of list) {
        props.removeCell(cell.x, cell.z);
        const now = T.map((t) => countAbove(mesh, t));
        for (let i = 0; i < T.length; i++) if ((now[i] as number) < (prev[i] as number)) hit[i] = (hit[i] as number) + 1;
        prev = now;
      }
      props.dispose();
      const n = list.length;
      const [tall, big, landmark] = hit as [number, number, number];
      rows.push(
        `s${stage.id}(${stage.biome}) 셀 ${n} · 랜드마크급(2.5+) ${landmark} · 큰것(1.4+) ${big} · 낮은칸(0.9미만) ${n - tall}`,
      );
      expect(landmark, `s${stage.id}: 판을 지배하는 큰 실루엣이 없다`).toBeGreaterThanOrEqual(2);
      expect(landmark / n, `s${stage.id}: 랜드마크가 흔하다 — 흔하면 그냥 새로운 균일함이다`).toBeLessThanOrEqual(0.2);
      expect(big / n, `s${stage.id}: 큰 계층이 얇다`).toBeGreaterThanOrEqual(0.25);
      expect((n - tall) / n, `s${stage.id}: 낮은 칸이 없다 — 대비가 없으면 큰 것도 커 보이지 않는다`).toBeGreaterThanOrEqual(0.15);
    }
    // eslint-disable-next-line no-console
    console.log('배치 실측:\n  ' + rows.join('\n  '));
  });
});

/**
 * 채집 개정의 새 계약 — **자원 종류가 곧 1층 실루엣이다**(gather-spec §6-1).
 *
 * 이 판정은 화면에서 눈으로 확인할 수밖에 없어 보이지만, 깨지는 방식 셋은 전부
 * 값으로 잡힌다: ① 어떤 종에 원형이 아예 없다(그 칸이 빈다) ② 어떤 hero 원형이
 * 어느 종에도 안 속한다(판에 한 번도 안 서는데 heroPoolsOf 의 절반 가르기만 밀린다)
 * ③ 낮은 종이 큰 계층으로 뽑힌다(2.0급 딸기덤불).
 */
describe('자원 종류 = 1층 실루엣', () => {
  it('바이옴의 모든 자원 종류에 원형이 있고, 모든 hero 인덱스가 어느 종엔가 속한다', () => {
    const rows: string[] = [];
    for (const [biome, kit] of Object.entries(PROP_KITS)) {
      const used = new Set<number>();
      for (const [kind] of RESOURCE_WEIGHTS[biome as BiomeId]) {
        const idx = kit.heroByKind[kind];
        expect(idx?.length ?? 0, `${biome}.${kind} 에 1층 실루엣이 없다 — 그 칸이 통째로 빈다`).toBeGreaterThan(0);
        for (const i of idx ?? []) {
          expect(kit.hero[i], `${biome}.${kind} 가 없는 hero 인덱스 ${i} 를 가리킨다`).toBeTruthy();
          used.add(i);
        }
        rows.push(`${biome}.${kind} → ${(idx ?? []).map((i) => elementHeight(kit.hero[i] as Element).toFixed(2)).join('/')}`);
      }
      kit.hero.forEach((_, i) => {
        expect(
          used.has(i),
          `${biome} hero[${i}] 가 어느 종에도 안 속한다 — 판에 한 번도 안 서면서 heroPoolsOf 의 절반 가르기만 민다`,
        ).toBe(true);
      });
    }
    // eslint-disable-next-line no-console
    console.log('종류별 1층 높이:\n  ' + rows.join('\n  '));
  });

  /**
   * 셀 단위 rng (gather-spec §5-3) — **이게 없으면 자원표 한 줄이 6판을 흔든다.**
   * 판 하나가 스트림 하나였을 때는 앞 셀에서 rng 를 한 번만 더 당겨도 그 뒤 모든 셀의
   * 소품이 밀렸다. 여기서 재는 것은 정확히 그 성질이다: **한 칸의 종류를 바꾸고
   * 그 칸을 지우면, 남은 판이 정점 하나까지 같아야 한다.**
   */
  it('셀 단위 rng — 한 칸의 자원 종류를 바꿔도 나머지 판은 정점 하나 안 움직인다', () => {
    const stage = STAGES[0] as StageDef;
    const a = sceneryOf(stage);
    const b = sceneryOf(stage);
    const target = a.list[3] as Vec2;
    // 그 한 칸만 stone 랜드마크로 바꾼다 (실루엣도 원가도 확실히 달라지는 조합)
    const swapped = (x: number, z: number): { kind: ResourceId; landmark: boolean } =>
      x === target.x && z === target.z ? { kind: 'stone', landmark: true } : b.kindOf(x, z);

    const pa = buildProps(stage.biome, a.list, a.cellToWorld, stage.id, a.kindOf);
    const pb = buildProps(stage.biome, b.list, b.cellToWorld, stage.id, swapped);
    const before = triCount(pa.group);
    expect(triCount(pb.group), '바꾼 칸이 정말 달라졌는가 (안 달라졌으면 이 테스트는 아무것도 안 잰다)').not.toBe(before);

    expect(pa.removeCell(target.x, target.z)).toBe(true);
    expect(pb.removeCell(target.x, target.z)).toBe(true);
    const ga = propsMeshOf(pa.group).geometry.getAttribute('position');
    const gb = propsMeshOf(pb.group).geometry.getAttribute('position');
    expect(gb.count, '바꾼 칸을 빼고 나면 삼각형 수가 같아야 한다').toBe(ga.count);
    let diff = 0;
    for (let i = 0; i < ga.count; i++) {
      if (Math.abs(ga.getX(i) - gb.getX(i)) > 1e-9 || Math.abs(ga.getY(i) - gb.getY(i)) > 1e-9 || Math.abs(ga.getZ(i) - gb.getZ(i)) > 1e-9) diff++;
    }
    expect(diff, '자원표 한 칸이 이웃 칸의 소품을 밀었다 — 소품 rng 가 다시 판 단위가 됐다').toBe(0);
    pa.dispose();
    pb.dispose();
  });
});

describe('스테이지별 소품 예산', () => {
  it('6개 스테이지 전부 상한 안이고, 개정 전 프레임 청구액보다 적다', () => {
    const rows: string[] = [];
    for (const stage of STAGES) {
      const { list, cellToWorld, kindOf } = sceneryOf(stage);
      const props = buildProps(stage.biome, list, cellToWorld, stage.id, kindOf);
      const tris = triCount(props.group);
      const cap = STAGE_CAP[stage.id] ?? 0;
      const before = BEFORE[stage.id] ?? 0;
      rows.push(
        `s${stage.id}(${stage.biome}) 셀 ${list.length} · ${tris} tri · 셀당 ${(tris / list.length).toFixed(0)}` +
          ` · 프레임 ${before * 2} → ${tris} (${tris - before * 2})`,
      );
      expect(tris, `${stage.id} 소품 삼각형 상한 초과`).toBeLessThanOrEqual(cap);
      // 그림이 실제로 풍성해졌는지 — 셀 하나가 4개 이상 오브젝트여야 3층이 산다
      expect(tris / list.length, `${stage.id} 셀이 너무 비었다`).toBeGreaterThan(90);
      // 섀도 패스가 사라졌으므로 프레임 청구액은 반드시 줄어야 한다
      expect(tris, `${stage.id} 프레임 청구액이 개정 전보다 늘었다`).toBeLessThan(before * 2);
      props.dispose();
    }
    // eslint-disable-next-line no-console
    console.log('스테이지 실측:\n  ' + rows.join('\n  '));
  });

  it(`소품 셀 하나는 ${CELL_TRI_BUDGET} 삼각형을 넘지 않는다`, () => {
    let worst = 0;
    let worstAt = '';
    for (const stage of STAGES) {
      const { list, cellToWorld, kindOf } = sceneryOf(stage);
      const props = buildProps(stage.biome, list, cellToWorld, stage.id, kindOf);
      let prev = triCount(props.group);
      for (const cell of list) {
        expect(props.removeCell(cell.x, cell.z)).toBe(true);
        const now = triCount(props.group);
        const used = prev - now;
        if (used > worst) {
          worst = used;
          worstAt = `s${stage.id} (${cell.x},${cell.z})`;
        }
        prev = now;
      }
      expect(prev, `${stage.id}: 셀을 전부 지우면 소품이 남지 않아야 한다`).toBe(0);
      props.dispose();
    }
    // eslint-disable-next-line no-console
    console.log(`셀 최댓값 ${worst} tri @ ${worstAt}`);
    expect(worst).toBeLessThanOrEqual(CELL_TRI_BUDGET);
  });

  it('드로우콜은 스테이지와 무관하게 1개다', () => {
    for (const stage of STAGES) {
      const { list, cellToWorld, kindOf } = sceneryOf(stage);
      const props = buildProps(stage.biome, list, cellToWorld, stage.id, kindOf);
      let meshes = 0;
      props.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.visible) meshes++;
      });
      expect(meshes, `${stage.id} 소품 메시 수`).toBe(1);
      props.dispose();
    }
  });
});

describe('접촉 그림자 계약', () => {
  it('소품은 섀도 캐스터가 아니다 (대신 지면 판을 깐다)', () => {
    const stage = STAGES[0] as StageDef;
    const { list, cellToWorld, kindOf } = sceneryOf(stage);
    const props = buildProps(stage.biome, list, cellToWorld, stage.id, kindOf);
    const mesh = propsMeshOf(props.group);
    expect(mesh.castShadow, '소품이 섀도 캐스터로 되돌아가면 프레임 삼각형이 2배가 된다').toBe(false);
    expect(mesh.receiveShadow, '타워/유닛 그림자는 소품 위에 떨어져야 한다').toBe(true);
    props.dispose();
  });

  it('그림자 판이 셀(1×1) 밖으로 새지 않는다 — 섬 가장자리에서 허공에 뜨면 안 된다', () => {
    const stage = STAGES[0] as StageDef;
    const { list, cellToWorld, kindOf } = sceneryOf(stage);
    const props = buildProps(stage.biome, list, cellToWorld, stage.id, kindOf);
    const mesh = propsMeshOf(props.group);
    const pos = mesh.geometry.getAttribute('position');
    const halfW = (stage.gridW - 1) / 2;
    const halfH = (stage.gridH - 1) / 2;
    const owner = new Set(list.map((c) => `${c.x},${c.z}`));
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      // 접촉 그림자 판만 골라 본다 (지면 바로 위 얇은 층)
      if (Math.abs(y - 0.035) > 1e-4) continue;
      const cx = Math.round(pos.getX(i) + halfW);
      const cz = Math.round(pos.getZ(i) + halfH);
      // 판의 모든 꼭짓점은 자기 셀 안에 있어야 한다
      expect(owner.has(`${cx},${cz}`), `그림자 꼭짓점이 소품 셀 밖(${cx},${cz})으로 나갔다`).toBe(true);
      checked++;
    }
    expect(checked, '그림자 판을 하나도 못 찾았다').toBeGreaterThan(list.length * 3);
    props.dispose();
  });
});

describe('결정론 · 제거 계약', () => {
  it('같은 스테이지를 두 번 지으면 정점이 완전히 같다', () => {
    const stage = STAGES[2] as StageDef;
    const a = sceneryOf(stage);
    const b = sceneryOf(stage);
    const pa = buildProps(stage.biome, a.list, a.cellToWorld, stage.id, a.kindOf);
    const pb = buildProps(stage.biome, b.list, b.cellToWorld, stage.id, b.kindOf);
    const ga = propsMeshOf(pa.group).geometry.getAttribute('position');
    const gb = propsMeshOf(pb.group).geometry.getAttribute('position');
    expect(gb.count).toBe(ga.count);
    let diff = 0;
    for (let i = 0; i < ga.count; i++) {
      if (Math.abs(ga.getX(i) - gb.getX(i)) > 1e-9 || Math.abs(ga.getY(i) - gb.getY(i)) > 1e-9) diff++;
    }
    expect(diff, '시드 고정이 깨졌다').toBe(0);
    pa.dispose();
    pb.dispose();
  });

  it('removeCell 은 그 셀의 3층 전부를 지우고 offsetOf 는 1층 밑동을 가리킨다', () => {
    const stage = STAGES[0] as StageDef;
    const { list, cellToWorld, kindOf } = sceneryOf(stage);
    const props = buildProps(stage.biome, list, cellToWorld, stage.id, kindOf);
    const cell = list[0] as Vec2;
    const off = props.offsetOf(cell.x, cell.z);
    expect(off).not.toBeNull();
    expect(Math.hypot(off!.dx, off!.dz)).toBeLessThanOrEqual(0.18 * Math.SQRT2 + 1e-9);

    const before = triCount(props.group);
    expect(props.removeCell(cell.x, cell.z)).toBe(true);
    const after = triCount(props.group);
    expect(after, '셀 하나 분량이 통째로 빠져야 한다').toBeLessThan(before);
    expect(props.offsetOf(cell.x, cell.z)).toBeNull();
    expect(props.removeCell(cell.x, cell.z), '두 번 지우면 false').toBe(false);
    // 소품이 없던 셀은 건드리지 않는다
    expect(props.removeCell(-1, -1)).toBe(false);
    props.dispose();
  });
});
