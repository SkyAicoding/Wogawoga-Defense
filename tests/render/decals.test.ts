/**
 * 부족 선택 표시 회귀 테스트 — **바운더리는 그리고, 기둥은 없앤다**.
 *
 * 사용자 지시가 둘이라 잠그는 것도 둘이다:
 *  ① "우리 부족을 선택하면 공격 가능한 바운더리를 표시해 줘"
 *     → 부족원 **각자의** 발밑에 자기 사거리 원이 서고, 원의 바깥 테두리가 곧 사거리다.
 *  ② "선택했을 때 하늘로 올라가는 선은 없애 줘"
 *     → 선택 표시의 정점은 전부 지면에 붙어 있다.
 * 그리고 ②의 짝도 함께 잠근다: **이동 목표 표식도 기둥이 없되 표식 자체는 남아야 한다**.
 * 사용자가 뒤에 "그것도 지워줘"로 목표 표식의 기둥까지 없애라고 했다. 대가는 알고 받는다 —
 * 그쪽은 빈 길 위의 한 점이라 하단 패널에 덮이면 안 보인다. 그래서 이 항목은 기둥이
 * 없다는 것과 **링은 살아 있다**는 것을 같이 본다: 지우기가 표식 전체로 번지면 걸린다.
 *
 * 예산도 함께 잠근다: 부족원이 몇 명이든 **메시는 하나**여야 한다(드로우콜 1).
 * WebGL 없이 THREE 오브젝트 상태만 본다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ALLY_DEFS } from '@/data';
import { Decals } from '@/render/views/decals';

/** 셀 좌표 = 월드 좌표로 두면(실제 cellToWorld도 중심 이동만 한다) 반경을 그대로 잴 수 있다 */
const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

function make(): { scene: THREE.Scene; decals: Decals } {
  const scene = new THREE.Scene();
  return { scene, decals: new Decals(scene, cellToWorld) };
}

/** 지금 실제로 그려지는 메시들 = 드로우콜의 수 (init을 부르지 않으면 정적 데칼은 없다) */
function visibleMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible && (m.parent?.visible ?? true)) out.push(m);
  });
  return out;
}

function positions(mesh: THREE.Mesh): Float32Array {
  return mesh.geometry.getAttribute('position').array as Float32Array;
}

/** 정점들의 (중심 기준) 반경 최대·최소와 y 최대 */
function stats(mesh: THREE.Mesh, cx: number, cz: number): { rMax: number; rMin: number; yMax: number } {
  const p = positions(mesh);
  let rMax = 0;
  let rMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const r = Math.hypot(p[i]! - cx, p[i + 2]! - cz);
    if (r > rMax) rMax = r;
    if (r < rMin) rMin = r;
    if (p[i + 1]! > yMax) yMax = p[i + 1]!;
  }
  return { rMax, rMin, yMax };
}

describe('Decals — 부족 공격 사거리 바운더리', () => {
  it('선택하면 원이 하나 뜨고, 그 원의 바깥 테두리가 곧 사거리다', () => {
    const { scene, decals } = make();
    expect(visibleMeshes(scene), '아무것도 안 골랐으면 그릴 것도 없다').toHaveLength(0);

    decals.showAllyRanges([{ x: 3, z: 4 }], 1.0);
    const meshes = visibleMeshes(scene);
    expect(meshes).toHaveLength(1);
    const s = stats(meshes[0]!, 3, 4);
    // 바깥 테두리 = 사거리. 안쪽으로만 띠를 칠하므로 이 값을 넘는 정점이 없어야 한다
    expect(s.rMax).toBeCloseTo(1.0, 6);
  });

  it('종족마다 자기 사거리로 그린다 (몽둥이꾼 1.0 · 파수꾼 1.15 · 돌팔매꾼 2.8)', () => {
    const { scene, decals } = make();
    for (const id of ['clubber', 'guardian', 'slinger'] as const) {
      decals.showAllyRanges([{ x: 0, z: 0 }], ALLY_DEFS[id].range);
      const s = stats(visibleMeshes(scene)[0]!, 0, 0);
      expect(s.rMax, `${id} 바깥 테두리`).toBeCloseTo(ALLY_DEFS[id].range, 6);
    }
  });

  it('② 선택 표시에는 하늘로 올라가는 기둥이 없다 — 정점이 전부 지면에 붙어 있다', () => {
    const { scene, decals } = make();
    decals.showAllyRanges([{ x: 2, z: 2 }, { x: 5, z: 6 }], 2.8);
    const p = positions(visibleMeshes(scene)[0]!);
    let yMax = -Infinity;
    let yMin = Infinity;
    for (let i = 1; i < p.length; i += 3) {
      if (p[i]! > yMax) yMax = p[i]!;
      if (p[i]! < yMin) yMin = p[i]!;
    }
    // 데칼 높이(0.03) 한 겹 — 기둥(2.2)이 있으면 여기서 걸린다
    expect(yMax).toBeLessThan(0.1);
    expect(yMin).toBeGreaterThanOrEqual(0);
  });

  /*
   * ②의 짝 — **이동 목표 표식에도 기둥이 없다.**
   *
   * 이 항목은 원래 정반대였다("목표 표식의 기둥은 남아야 한다"). 사용자가 그 판단을
   * 뒤집었으므로("그것도 지워줘") 선언을 다시 유도한다. 임계값을 낮춘 것이 아니라
   * **재는 대상이 바뀐 것**이고, 판별력은 오히려 늘었다: 예전 항목은 기둥의 존재만 봤는데
   * 지금은 "기둥은 없되 **표식 자체는 살아 있다**"를 함께 잠근다. 곧 '기둥을 없애라'가
   * '표식을 지워라'로 미끄러지면 두 번째 어서션이 잡는다.
   */
  it('②의 짝 — 이동 목표 표식에도 기둥이 없다 (단, 표식 자체는 남는다)', () => {
    const { scene, decals } = make();
    decals.showSortieMarker([{ x: 4, z: 4 }]);
    const mesh = visibleMeshes(scene)[0];
    expect(mesh, '목표 표식이 아예 안 보인다').toBeDefined();
    const s = stats(mesh!, 4, 4);
    expect(s.yMax, '목표 표식에 아직 기둥이 있다').toBeLessThan(0.1);
    // 지면에 붙은 링이 실제로 그려져 있어야 한다 — 기둥을 지우면서 표식까지 비우면 여기서 걸린다
    expect(s.rMax, '표식이 비었다 — 기둥과 함께 링까지 지웠다').toBeGreaterThan(0.2);
  });

  it('발밑 링이 함께 선다 — 사거리 2.8에서는 원이 멀어 "누가 골렸는지"가 안 읽힌다', () => {
    const { scene, decals } = make();
    decals.showAllyRanges([{ x: 0, z: 0 }], 2.8);
    const s = stats(visibleMeshes(scene)[0]!, 0, 0);
    // 발밑 링 안쪽 반경 0.3 — 사거리 띠(2.68~2.8)만 있었다면 이 값이 2.68이 된다
    expect(s.rMin).toBeCloseTo(0.3, 6);
  });

  it('여럿을 골라도 메시는 하나 (드로우콜 1) — 삼각형만 인원수만큼 는다', () => {
    const { scene, decals } = make();
    decals.showAllyRanges([{ x: 1, z: 1 }], 1.0);
    const one = positions(visibleMeshes(scene)[0]!).length;

    decals.showAllyRanges([{ x: 1, z: 1 }, { x: 3, z: 1 }, { x: 5, z: 1 }], 1.0);
    const meshes = visibleMeshes(scene);
    expect(meshes, '사람마다 메시를 만들면 여기서 3이 된다').toHaveLength(1);
    expect(positions(meshes[0]!).length).toBe(one * 3);

    // 세 사람 각자의 원이 자기 자리에 있다 (한 곳에 겹쳐 그리지 않았다)
    for (const cx of [1, 3, 5]) {
      const s = stats(meshes[0]!, cx, 1);
      expect(s.rMin, `(${cx},1)에 발밑 링이 없다`).toBeCloseTo(0.3, 6);
    }
  });

  it('지점·반경이 그대로면 다시 굽지 않는다 (매 프레임 호출된다)', () => {
    const { scene, decals } = make();
    decals.showAllyRanges([{ x: 1, z: 1 }], 1.0);
    const geo = visibleMeshes(scene)[0]!.geometry;
    decals.showAllyRanges([{ x: 1, z: 1 }], 1.0);
    expect(visibleMeshes(scene)[0]!.geometry, '가만히 서 있는데 다시 구웠다').toBe(geo);

    // 한 걸음 움직이면 다시 굽는다 — 안 그러면 표식만 제자리에 남는다
    decals.showAllyRanges([{ x: 1.2, z: 1 }], 1.0);
    expect(visibleMeshes(scene)[0]!.geometry).not.toBe(geo);
  });

  it('해제하면 사라진다 (빈 목록·죽어서 0명이 된 경우 포함)', () => {
    const { scene, decals } = make();
    decals.showAllyRanges([{ x: 1, z: 1 }], 1.0);
    decals.hideAllyRanges();
    expect(visibleMeshes(scene)).toHaveLength(0);

    decals.showAllyRanges([], 1.0);
    expect(visibleMeshes(scene)).toHaveLength(0);
  });

  it('앞면이 위(+y)를 본다 — 뒤집혀 있으면 카메라에서 안 보인다', () => {
    const { scene, decals } = make();
    decals.showAllyRanges([{ x: 0, z: 0 }], 1.0);
    const p = positions(visibleMeshes(scene)[0]!);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    let checked = 0;
    for (let i = 0; i < p.length; i += 9) {
      a.set(p[i]!, p[i + 1]!, p[i + 2]!);
      b.set(p[i + 3]!, p[i + 4]!, p[i + 5]!);
      c.set(p[i + 6]!, p[i + 7]!, p[i + 8]!);
      n.copy(b).sub(a).cross(c.sub(a));
      expect(n.y, `삼각형 ${i / 9}의 노멀이 아래를 본다`).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
});

/**
 * 배치 하이라이트(슬롯 디스크) — **여닫이가 재병합을 안 부른다** (§D / gather-spec R1·R2).
 *
 * 개정 전 `addSlotCell` 은 셀이 늘 때마다 CircleGeometry 124개를 새로 굽고 메시를 갈았다.
 * 그 값은 "셀 추가는 드물다"(골드 제거 판당 0.09회) 위에 서 있었고, 채집이 칸을
 * 여닫기 시작하면서 그 전제가 깨졌다 — 수확 72 + 재생 32 = **판당 104회**다.
 * 그래서 지금은 소품 칸까지 **꺼진 채로 미리 구워** 두고 정점만 접었다 편다.
 *
 * 잠그는 것 셋:
 *  ① 여닫아도 지오메트리 객체가 그대로다 (재병합이면 갈린다)
 *  ② 껐다 켜면 **정점이 원본과 비트 단위로 같다** (되돌리기가 근사면 원이 찌그러진다)
 *  ③ 끄는 길이 실제로 있다 — 개정 전에는 addSlotCell 하나뿐이라 자란 칸에 하이라이트가
 *    남아 "빛나는데 못 짓는 칸"이 될 참이었다
 */
describe('Decals — 배치 하이라이트 여닫이', () => {
  const bare = [
    { x: 1, z: 1 },
    { x: 2, z: 1 },
  ];
  const scenery = [
    { x: 5, z: 5 },
    { x: 6, z: 5 },
  ];

  function slotMesh(scene: THREE.Scene): THREE.Mesh {
    const found = scene.getObjectByName('slotHighlight') as THREE.Mesh | undefined;
    if (!found) throw new Error('슬롯 메시를 못 찾았다');
    return found;
  }
  /** 셀 하나의 정점 수 — 네 칸을 같은 원으로 구웠으므로 균등하다 */
  function per(mesh: THREE.Mesh): number {
    return mesh.geometry.getAttribute('position').count / 4;
  }

  it('소품 칸은 꺼진 채로 미리 구워 둔다 — 열고 닫아도 재병합이 없다', () => {
    const { scene, decals } = make();
    decals.init(bare, [], scenery);
    const mesh = slotMesh(scene);
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const home = new Float32Array(pos.array as Float32Array);

    // 맨 셀은 켜져 있고 소품 칸은 꺼져 있다
    expect(decals.slotCellOn(1, 1), '맨 셀이 꺼져 있다').toBe(true);
    expect(decals.slotCellOn(5, 5), '소품 칸이 처음부터 켜져 있다').toBe(false);

    const p2 = per(mesh);
    // 꺼진 칸은 판이 시작될 때 이미 한 점으로 접혀 있다
    const s0 = 2 * p2 * 3;
    for (let i = 0; i < p2; i++) expect(home[s0 + i * 3]).toBe(home[s0]);

    // 채집으로 칸이 열린다 — 정점이 실제 원으로 펴진다
    decals.setSlotCell(5, 5, true);
    expect(decals.slotCellOn(5, 5)).toBe(true);
    expect(mesh.geometry, '재병합이 일어났다').toBe(geo);
    const opened = new Float32Array(geo.getAttribute('position').array as Float32Array);
    expect(new Set(Array.from(opened.subarray(s0, s0 + p2 * 3))).size, '열었는데 안 펴졌다')
      .toBeGreaterThan(3);

    // 닫았다 다시 열면 **비트 단위로 같은 원**이어야 한다 (근사로 되돌리면 원이 찌그러진다)
    decals.setSlotCell(5, 5, false);
    decals.setSlotCell(5, 5, true);
    const reopened = geo.getAttribute('position').array as Float32Array;
    for (let i = s0; i < s0 + p2 * 3; i++) {
      expect(reopened[i], `정점 ${i} 가 원본과 다르다`).toBe(opened[i]);
    }

    // 재생으로 다시 닫힌다 — **이 길이 이번 개정에서 생겼다**
    decals.setSlotCell(5, 5, false);
    expect(decals.slotCellOn(5, 5), '닫히지 않았다 = "빛나는데 못 짓는 칸"').toBe(false);
    expect(mesh.geometry, '재병합이 일어났다').toBe(geo);
    // 접힌 셀은 한 점이다 = 삼각형이 퇴화해 안 보인다
    const off = geo.getAttribute('position').array as Float32Array;
    const s = 2 * p2 * 3;
    for (let i = 0; i < p2; i++) {
      expect(off[s + i * 3]).toBe(off[s]);
      expect(off[s + i * 3 + 2]).toBe(off[s + 2]);
    }
    // 이웃 칸(6,5)은 한 톨도 안 건드렸다
    const t = 3 * p2 * 3;
    for (let i = t; i < t + p2 * 3; i++) expect(off[i]).toBe(home[i]);
    decals.dispose();
  });

  it('맨 셀은 여닫이의 영향을 안 받는다 — 원래 지을 수 있던 칸이 사라지면 안 된다', () => {
    const { scene, decals } = make();
    decals.init(bare, [], scenery);
    const mesh = slotMesh(scene);
    const home = new Float32Array(mesh.geometry.getAttribute('position').array as Float32Array);
    decals.setSlotCell(5, 5, true);
    decals.setSlotCell(6, 5, true);
    decals.setSlotCell(5, 5, false);
    const now = mesh.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < 2 * per(mesh) * 3; i++) expect(now[i], '맨 셀 정점이 변했다').toBe(home[i]);
    expect(decals.slotCellOn(1, 1)).toBe(true);
    expect(decals.slotCellOn(2, 1)).toBe(true);
    decals.dispose();
  });

  it('없는 칸을 여닫아도 아무 일도 안 일어난다', () => {
    const { scene, decals } = make();
    decals.init(bare, [], scenery);
    const mesh = slotMesh(scene);
    const home = new Float32Array(mesh.geometry.getAttribute('position').array as Float32Array);
    decals.setSlotCell(99, 99, true);
    expect(decals.slotCellOn(99, 99)).toBe(false);
    const now = mesh.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < home.length; i++) expect(now[i]).toBe(home[i]);
    decals.dispose();
  });
});
