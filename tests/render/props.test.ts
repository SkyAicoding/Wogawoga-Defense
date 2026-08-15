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
  PROP_ELEMENTS,
  PROP_KITS,
  PROTO_TRI_BUDGET,
  buildProps,
  elementHeight,
  elementTriCount,
} from '@/render/meshlib/props';
import { rasterizePathCells, sceneryCells } from '@/data/grid';
import { STAGES } from '@/data/stages';
import type { StageDef, Vec2 } from '@/data/types';

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
 */
const STAGE_CAP: Record<number, number> = {
  1: 9_200,
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

  it('셀 채우기 예산은 셀 상한 안에 있다 (구조적으로 초과 불가)', () => {
    expect(CELL_SOFT_BUDGET).toBeLessThan(CELL_TRI_BUDGET);
    expect(CELL_SOFT_BUDGET).toBeGreaterThan(CELL_TRI_BUDGET * 0.9);
  });
});

describe('스테이지별 소품 예산', () => {
  it('6개 스테이지 전부 상한 안이고, 개정 전 프레임 청구액보다 적다', () => {
    const rows: string[] = [];
    for (const stage of STAGES) {
      const { list, cellToWorld } = sceneryOf(stage);
      const props = buildProps(stage.biome, list, cellToWorld, stage.id);
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
      const { list, cellToWorld } = sceneryOf(stage);
      const props = buildProps(stage.biome, list, cellToWorld, stage.id);
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
      const { list, cellToWorld } = sceneryOf(stage);
      const props = buildProps(stage.biome, list, cellToWorld, stage.id);
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
    const { list, cellToWorld } = sceneryOf(stage);
    const props = buildProps(stage.biome, list, cellToWorld, stage.id);
    const mesh = propsMeshOf(props.group);
    expect(mesh.castShadow, '소품이 섀도 캐스터로 되돌아가면 프레임 삼각형이 2배가 된다').toBe(false);
    expect(mesh.receiveShadow, '타워/유닛 그림자는 소품 위에 떨어져야 한다').toBe(true);
    props.dispose();
  });

  it('그림자 판이 셀(1×1) 밖으로 새지 않는다 — 섬 가장자리에서 허공에 뜨면 안 된다', () => {
    const stage = STAGES[0] as StageDef;
    const { list, cellToWorld } = sceneryOf(stage);
    const props = buildProps(stage.biome, list, cellToWorld, stage.id);
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
    const pa = buildProps(stage.biome, a.list, a.cellToWorld, stage.id);
    const pb = buildProps(stage.biome, b.list, b.cellToWorld, stage.id);
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
    const { list, cellToWorld } = sceneryOf(stage);
    const props = buildProps(stage.biome, list, cellToWorld, stage.id);
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
