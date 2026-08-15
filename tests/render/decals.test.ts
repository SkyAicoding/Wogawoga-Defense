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
