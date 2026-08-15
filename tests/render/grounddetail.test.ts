/**
 * 맨 셀 바닥 결 레이어의 **예산·불변식 계약**.
 *
 * 이 레이어는 화면의 70%(건설 가능 셀 중 소품이 없는 칸)를 덮으므로, 셀 하나의
 * 값이 조금만 커져도 스테이지 총량이 곧장 수천 삼각형이 된다. 그래서 여기서
 * 잠그는 것은 그림이 아니라 **경계 조건 다섯**이다.
 *   ① 요소 하나의 원가 (GD_ELEMENT_TRI_BUDGET)
 *   ② 셀 하나의 합계 (GD_CELL_TRI_BUDGET) — 구조적으로 초과 불가여야 한다
 *   ③ 스테이지 총량 (GD_STAGE_CAP) 과 "너무 비지도 않았는가"
 *   ④ y 스택 — 사거리 링(0.030)·소품 접촉 그림자(0.035)를 절대 침범하지 않는다
 *   ⑤ 셀(1×1) 안 — 이웃 칸과 붙어 카펫이 되면 타일 격자가 지워진다
 * 그리고 이것이 **순수 시각 레이어**임을 잠근다: 건설 가능 셀 판정에 아무 영향도
 * 주지 않아야 한다 (sceneryCells/isBuildableCell 이 이 레이어 전후로 동일).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GD_CELL_TRI_BUDGET,
  GD_ELEMENTS,
  GD_ELEMENT_TRI_BUDGET,
  GD_STAGE_CAP,
  GD_ZONES,
  buildGroundDetail,
  flatsTriCount,
  gdKit,
} from '@/render/meshlib/grounddetail';
import {
  buildableCells,
  cellKey,
  isBuildableCell,
  rasterizePathCells,
  sceneryCells,
} from '@/data/grid';
import { STAGES } from '@/data/stages';
import type { StageDef, Vec2 } from '@/data/types';

/**
 * stage3d.build 가 이 레이어에 넘기는 것과 **똑같은** 인자를 만든다.
 * (props.test.ts:sceneryOf 와 같은 이유로 terrain.buildStage 를 부르지 않는다 —
 *  cellToWorld 는 격자 중심 정렬 한 줄이라 여기 복제해도 어긋날 여지가 없다)
 */
function inputsOf(stage: StageDef): {
  pathCells: Set<number>;
  bare: Vec2[];
  cellToWorld: (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3;
} {
  const pathCells = rasterizePathCells(stage);
  const scenery = sceneryCells(stage, pathCells);
  const bare = buildableCells(stage, pathCells).filter((c) => !scenery.has(cellKey(stage, c.x, c.z)));
  const halfW = (stage.gridW - 1) / 2;
  const halfH = (stage.gridH - 1) / 2;
  return {
    pathCells,
    bare,
    cellToWorld: (x, z, out) => (out ?? new THREE.Vector3()).set(x - halfW, 0, z - halfH),
  };
}

function meshOf(root: THREE.Object3D): THREE.Mesh {
  const m = root.getObjectByName('groundDetailMesh');
  expect(m, 'groundDetailMesh 가 있어야 한다').toBeTruthy();
  return m as THREE.Mesh;
}

function triCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible) {
      const pos = m.geometry.getAttribute('position');
      if (pos) n += pos.count / 3;
    }
  });
  return n;
}

describe('바닥 결 원가표', () => {
  it(`요소 하나는 ${GD_ELEMENT_TRI_BUDGET} 삼각형을 넘지 않는다`, () => {
    const rows: string[] = [];
    for (const [name, flats] of Object.entries(GD_ELEMENTS)) {
      const n = flatsTriCount(flats);
      rows.push(`${name} ${n}`);
      expect(n, `${name} 원가 초과`).toBeLessThanOrEqual(GD_ELEMENT_TRI_BUDGET);
      expect(n, `${name} 가 비어 있다`).toBeGreaterThan(0);
    }
    // eslint-disable-next-line no-console
    console.log('바닥 결 원가표:', rows.join(' · '));
  });

  it('모든 요소가 완전 수평이고 y 스택 안에 있다 (링·원판을 뚫지 않는다)', () => {
    // 기울인 판은 끝이 y≈0.042 까지 올라가 사거리 링(0.030)을 뚫는다.
    // 그래서 설계도 단계에서 x/z 기울임 자체를 금지한다.
    for (const [name, flats] of Object.entries(GD_ELEMENTS)) {
      for (const f of flats) {
        const [rx, , rz] = f.rot ?? [0, 0, 0];
        expect(rx, `${name}: 판이 x축으로 기울었다`).toBe(0);
        expect(rz, `${name}: 판이 z축으로 기울었다`).toBe(0);
        expect(f.pos[1], `${name}: y 가 스택 아래로 내려갔다`).toBeGreaterThanOrEqual(0.015);
        // 0.030 = DECAL_Y(사거리 링·경로 셰브런), 0.035 = 소품 접촉 그림자
        expect(f.pos[1], `${name}: y 가 데칼 층을 침범했다`).toBeLessThan(0.030);
      }
    }
  });

  it('바이옴마다 밀도가 다르다 — 정글이 가장 빽빽하고 사막이 가장 성기다', () => {
    const rows: string[] = [];
    const innerMax: Record<string, number> = {};
    for (const biome of ['grassland', 'jungle', 'desert', 'snow', 'swamp', 'volcano'] as const) {
      const kit = gdKit(biome);
      for (const zone of GD_ZONES) {
        expect(kit.accent[zone].length, `${biome}/${zone} 액센트 후보 없음`).toBeGreaterThanOrEqual(2);
        expect(kit.soil[zone].length, `${biome}/${zone} 바닥 얼룩 색 없음`).toBeGreaterThanOrEqual(2);
        const [lo, hi] = kit.count[zone];
        expect(hi, `${biome}/${zone} 개수 범위가 뒤집혔다`).toBeGreaterThanOrEqual(lo);
      }
      innerMax[biome] = kit.count.inner[1];
      rows.push(`${biome} 내부 ${kit.count.inner.join('~')} · 길가 ${kit.count.trail.join('~')} · 물가 ${kit.count.shore.join('~')} · 경로 ${kit.count.path.join('~')}`);
    }
    expect(innerMax['jungle'], '정글이 가장 빽빽해야 한다').toBeGreaterThan(innerMax['desert'] as number);
    // eslint-disable-next-line no-console
    console.log('바이옴 밀도:\n  ' + rows.join('\n  '));
  });
});

describe('스테이지별 바닥 결 예산', () => {
  it('6개 스테이지 전부 상한 안이고, 셀이 비어 있지 않다', () => {
    const rows: string[] = [];
    for (const stage of STAGES) {
      const { pathCells, bare, cellToWorld } = inputsOf(stage);
      const gd = buildGroundDetail(stage, pathCells, bare, cellToWorld);
      const tris = triCount(gd.group);
      // 경로 셀 중 지상인 것 (경로는 판 밖 물에서 시작하므로 '~' 가 섞여 있다)
      const cells = bare.length + [...pathCells].length;
      rows.push(`s${stage.id}(${stage.biome}) 맨셀 ${bare.length} + 경로 ${pathCells.size} · ${tris} tri · 셀당 ${(tris / cells).toFixed(1)}`);
      expect(tris, `s${stage.id} 바닥 결 삼각형 상한 초과`).toBeLessThanOrEqual(GD_STAGE_CAP);
      // 셀 하나에 얼룩 1장(3) + 액센트 최소 1개(4)는 있어야 "결"이 된다
      expect(tris / bare.length, `s${stage.id} 셀이 너무 비었다 — 다시 민무늬 판이다`).toBeGreaterThanOrEqual(7);
      gd.dispose();
    }
    // eslint-disable-next-line no-console
    console.log('바닥 결 실측:\n  ' + rows.join('\n  '));
  });

  it(`셀 하나는 ${GD_CELL_TRI_BUDGET} 삼각형을 넘지 않는다`, () => {
    // 셀 단위 델타를 재려면 셀을 하나씩 넣어 봐야 한다 — bareCells 를 비운 채 지어
    // addCell 로 한 칸씩 채우면서 증가분을 잰다.
    let worst = 0;
    let worstAt = '';
    for (const stage of STAGES) {
      const { pathCells, bare, cellToWorld } = inputsOf(stage);
      const gd = buildGroundDetail(stage, pathCells, [], cellToWorld);
      let prev = triCount(gd.group);
      for (const c of bare) {
        expect(gd.addCell(c.x, c.z), `s${stage.id} (${c.x},${c.z}) 추가 실패`).toBe(true);
        const now = triCount(gd.group);
        const used = now - prev;
        if (used > worst) {
          worst = used;
          worstAt = `s${stage.id} (${c.x},${c.z})`;
        }
        prev = now;
      }
      gd.dispose();
    }
    // eslint-disable-next-line no-console
    console.log(`셀 최댓값 ${worst} tri @ ${worstAt}`);
    expect(worst).toBeLessThanOrEqual(GD_CELL_TRI_BUDGET);
  });

  it('드로우콜은 스테이지와 무관하게 1개다 (캐스터 아님 · 그림자 받음)', () => {
    for (const stage of STAGES) {
      const { pathCells, bare, cellToWorld } = inputsOf(stage);
      const gd = buildGroundDetail(stage, pathCells, bare, cellToWorld);
      let meshes = 0;
      gd.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.visible) meshes++;
      });
      expect(meshes, `s${stage.id} 바닥 결 메시 수`).toBe(1);
      const mesh = meshOf(gd.group);
      expect(mesh.castShadow, '캐스터가 되면 프레임 청구가 2배가 된다').toBe(false);
      expect(mesh.receiveShadow, '타워/유닛 그림자가 장식 위에 떨어져야 한다').toBe(true);
      gd.dispose();
    }
  });

  it('저사양 티어 밀도를 낮추면 삼각형이 줄지만 0이 되지는 않는다', () => {
    const stage = STAGES[5] as StageDef; // s6 = 맨 셀이 가장 많은 판
    const { pathCells, bare, cellToWorld } = inputsOf(stage);
    const hi = buildGroundDetail(stage, pathCells, bare, cellToWorld, 1);
    const lo = buildGroundDetail(stage, pathCells, bare, cellToWorld, 0.5);
    const a = triCount(hi.group);
    const b = triCount(lo.group);
    expect(b, '저사양에서 오히려 늘었다').toBeLessThan(a);
    // 얼룩 1장(3) + 액센트 최소 1개는 남아야 한다 — low 에서 판이 더 허전해지면 안 된다
    expect(b / bare.length, '저사양 셀이 통째로 비었다').toBeGreaterThanOrEqual(6);
    // eslint-disable-next-line no-console
    console.log(`s6 밀도 1.0 → ${a} tri / 0.5 → ${b} tri`);
    hi.dispose();
    lo.dispose();
  });
});

describe('공간 계약', () => {
  it('모든 정점이 자기 셀(1×1) 안에 있다 — 이웃과 붙어 카펫이 되면 안 된다', () => {
    for (const stage of STAGES) {
      const { pathCells, bare, cellToWorld } = inputsOf(stage);
      const gd = buildGroundDetail(stage, pathCells, bare, cellToWorld);
      const pos = meshOf(gd.group).geometry.getAttribute('position');
      const halfW = (stage.gridW - 1) / 2;
      const halfH = (stage.gridH - 1) / 2;
      let worst = 0;
      for (let i = 0; i < pos.count; i++) {
        const gx = pos.getX(i) + halfW;
        const gz = pos.getZ(i) + halfH;
        const d = Math.max(Math.abs(gx - Math.round(gx)), Math.abs(gz - Math.round(gz)));
        if (d > worst) worst = d;
      }
      expect(worst, `s${stage.id} 장식이 셀 밖으로 샜다 (${worst.toFixed(3)})`).toBeLessThanOrEqual(0.5);
      gd.dispose();
    }
  });

  it('모든 정점 y 가 [0.015, 0.030) 안이다 — 데칼/그림자 층을 침범하지 않는다', () => {
    const stage = STAGES[0] as StageDef;
    const { pathCells, bare, cellToWorld } = inputsOf(stage);
    const gd = buildGroundDetail(stage, pathCells, bare, cellToWorld);
    const pos = meshOf(gd.group).geometry.getAttribute('position');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    expect(lo).toBeGreaterThanOrEqual(0.015);
    expect(hi, '사거리 링(0.030)·소품 접촉 그림자(0.035) 층을 침범했다').toBeLessThan(0.030);
    gd.dispose();
  });

  /**
   * 셀 중앙 비우기 — **밀도 계약**이지 절대 금지가 아니다.
   *
   * 액센트 앵커는 반경 [0.24, 0.38] 고리 위에만 놓지만, 요소 자체가 폭 0.2~0.3 이라
   * 안쪽 자락이 중앙 근처까지 닿는 것까지 막을 수는 없다(막으려면 요소를 점으로
   * 줄여야 한다). 실제로 지켜야 하는 것은 "배치 슬롯 원판(반경 0.34)이 얹히는 자리가
   * **어지럽지 않다**"이고, 그건 중앙 부근 정점의 **비율**로 재는 게 맞다.
   * 이 테스트가 잡는 회귀는 ACC_R0 를 0으로 내리거나 고리 규칙을 없애는 변경이다
   * (그러면 아래 비율이 즉시 20%를 넘는다).
   */
  it('액센트가 셀 중앙에 몰리지 않는다 — 배치 슬롯 원판 자리를 비운다', () => {
    for (const stage of STAGES) {
      const { pathCells, bare, cellToWorld } = inputsOf(stage);
      const gd = buildGroundDetail(stage, pathCells, bare, cellToWorld);
      const pos = meshOf(gd.group).geometry.getAttribute('position');
      const halfW = (stage.gridW - 1) / 2;
      const halfH = (stage.gridH - 1) / 2;
      let acc = 0;
      let inner = 0;
      for (let i = 0; i < pos.count; i++) {
          // 얼룩 층(중앙 0.018 · 가장자리 0.020)은 중앙에 있어도 된다 — "면"이라 어지럽지 않다
        if (pos.getY(i) < 0.0225) continue;
        const gx = pos.getX(i) + halfW;
        const gz = pos.getZ(i) + halfH;
        acc++;
        if (Math.hypot(gx - Math.round(gx), gz - Math.round(gz)) < 0.12) inner++;
      }
      expect(acc, `s${stage.id} 액센트를 하나도 못 찾았다`).toBeGreaterThan(bare.length);
      // 균등하게 흩었다면 이 비율은 0.12²π ≈ 4.5% 지만, 고리 배치라 그보다 낮아야 한다
      expect(inner / acc, `s${stage.id} 액센트가 중앙에 몰렸다`).toBeLessThan(0.05);
      gd.dispose();
    }
  });
});

describe('결정론 · 게임플레이 불변', () => {
  it('같은 스테이지를 두 번 지으면 정점이 완전히 같다', () => {
    const stage = STAGES[2] as StageDef;
    const a = inputsOf(stage);
    const b = inputsOf(stage);
    const ga = buildGroundDetail(stage, a.pathCells, a.bare, a.cellToWorld);
    const gb = buildGroundDetail(stage, b.pathCells, b.bare, b.cellToWorld);
    const pa = meshOf(ga.group).geometry.getAttribute('position');
    const pb = meshOf(gb.group).geometry.getAttribute('position');
    expect(pb.count).toBe(pa.count);
    let diff = 0;
    for (let i = 0; i < pa.count; i++) {
      if (Math.abs(pa.getX(i) - pb.getX(i)) > 1e-9 || Math.abs(pa.getZ(i) - pb.getZ(i)) > 1e-9) diff++;
    }
    expect(diff, '시드 고정이 깨졌다').toBe(0);
    ga.dispose();
    gb.dispose();
  });

  it('addCell 은 순서와 무관하다 — 셀 좌표 전용 시드', () => {
    // 공용 rng 를 순회하면 소품을 치우는 순서에 따라 같은 칸의 그림이 달라진다.
    const stage = STAGES[0] as StageDef;
    const { pathCells, bare, cellToWorld } = inputsOf(stage);
    const fwd = buildGroundDetail(stage, pathCells, [], cellToWorld);
    const rev = buildGroundDetail(stage, pathCells, [], cellToWorld);
    for (const c of bare) fwd.addCell(c.x, c.z);
    for (const c of [...bare].reverse()) rev.addCell(c.x, c.z);
    // 병합 순서가 다르므로 정점 배열 순서는 다르다 — 정점 **집합**을 비교한다
    const setOf = (root: THREE.Object3D): Set<string> => {
      const pos = meshOf(root).geometry.getAttribute('position');
      const s = new Set<string>();
      for (let i = 0; i < pos.count; i++) {
        s.add(`${pos.getX(i).toFixed(6)},${pos.getY(i).toFixed(6)},${pos.getZ(i).toFixed(6)}`);
      }
      return s;
    };
    const sf = setOf(fwd.group);
    const sr = setOf(rev.group);
    expect(sr.size).toBe(sf.size);
    for (const k of sf) expect(sr.has(k), `순서에 따라 그림이 달라졌다: ${k}`).toBe(true);
    fwd.dispose();
    rev.dispose();
  });

  it('addCell: 없던 칸이면 true, 두 번이면 false, 물 칸이면 false', () => {
    const stage = STAGES[0] as StageDef;
    const { pathCells, bare, cellToWorld } = inputsOf(stage);
    const gd = buildGroundDetail(stage, pathCells, bare, cellToWorld);
    // 이미 결이 깔린 맨 셀 — 두 번 얹지 않는다
    const first = bare[0] as Vec2;
    expect(gd.addCell(first.x, first.z), '이미 결이 있는 칸').toBe(false);
    // 소품 셀(= 골드로 치우면 맨 셀이 된다) 하나를 찾아 얹어 본다
    const scenery = sceneryCells(stage, pathCells);
    const propCell = [...scenery][0] as number;
    const px = propCell % stage.gridW;
    const pz = Math.floor(propCell / stage.gridW);
    const before = triCount(gd.group);
    expect(gd.addCell(px, pz), '소품을 치운 칸에는 결이 얹혀야 한다').toBe(true);
    expect(triCount(gd.group), '삼각형이 늘어야 한다').toBeGreaterThan(before);
    expect(gd.addCell(px, pz), '두 번이면 false').toBe(false);
    // 판 밖
    expect(gd.addCell(-1, -1)).toBe(false);
    gd.dispose();
  });

  it('건설 가능 셀 판정에 아무 영향도 주지 않는다 (순수 시각 레이어)', () => {
    for (const stage of STAGES) {
      const pathCells = rasterizePathCells(stage);
      const before = buildableCells(stage, pathCells).map((c) => `${c.x},${c.z}`).join('|');
      const sceneryBefore = [...sceneryCells(stage, pathCells)].sort((a, b) => a - b).join(',');
      const { bare, cellToWorld } = inputsOf(stage);
      const gd = buildGroundDetail(stage, pathCells, bare, cellToWorld);
      // 소품을 치운 뒤에도(= addCell 이 돈 뒤에도) 판정이 흔들리면 안 된다
      const first = [...sceneryCells(stage, pathCells)][0] as number;
      gd.addCell(first % stage.gridW, Math.floor(first / stage.gridW));
      const after = buildableCells(stage, pathCells).map((c) => `${c.x},${c.z}`).join('|');
      const sceneryAfter = [...sceneryCells(stage, pathCells)].sort((a, b) => a - b).join(',');
      expect(after, `s${stage.id} 건설 가능 셀이 바뀌었다`).toBe(before);
      expect(sceneryAfter, `s${stage.id} 소품 셀이 바뀌었다`).toBe(sceneryBefore);
      // 맨 셀은 전부 건설 가능해야 한다 — 장식은 판정에 관여하지 않는다
      for (const c of bare) {
        expect(isBuildableCell(stage, pathCells, c.x, c.z), `s${stage.id} (${c.x},${c.z})`).toBe(true);
      }
      gd.dispose();
    }
  });

  it('dispose 후 지오메트리가 남지 않는다', () => {
    const stage = STAGES[0] as StageDef;
    const { pathCells, bare, cellToWorld } = inputsOf(stage);
    const gd = buildGroundDetail(stage, pathCells, bare, cellToWorld);
    const mesh = meshOf(gd.group);
    const geo = mesh.geometry;
    let disposed = false;
    geo.addEventListener('dispose', () => {
      disposed = true;
    });
    gd.dispose();
    expect(disposed, '병합 지오메트리가 반납되지 않았다').toBe(true);
    // 공유 머티리얼(flatMat 싱글턴)은 버리면 안 된다 — 다른 메시가 계속 쓴다
    expect(mesh.material, '공유 머티리얼이 사라졌다').toBeTruthy();
  });
});
