/**
 * 채집으로 **사라지고 다시 자라는** 소품 — 그림 쪽 계약 (gather-spec R1·R2·R3).
 *
 * ── 이 파일이 잠그는 것 ─────────────────────────────────────────────────────
 * 사용자 요구는 두 문장이었다: "채집하고 나면 그 자리에 없어져야 한다", "일정 시간이
 * 지나면 다시 자라야 한다". 그림 쪽에서 그 둘을 만드는 방법은 두 가지뿐이고,
 * **어느 쪽을 골랐는지가 프레임에서 그대로 읽힌다**:
 *
 *   (A) 셀을 지우고 남은 것을 다시 병합한다  ← `removeCell`(골드 제거가 쓰는 길)
 *   (B) 전 셀을 늘 병합해 둔 채 **셀별 정점 구간의 성장률만 쓴다** ← `setCellTaken`
 *
 * (A)는 판당 0.09회짜리 사건(골드 제거)에는 맞는 값이다. 그런데 채집+재생은 판당
 * **104회**(수확 72 + 재생 32), 13초에 한 번이다. 실측으로 (A)는 셀 하나당 1~2.4ms 이고
 * (데스크톱 Node, s1 9.5k 삼각형) 그때마다 남은 지오메트리를 통째로 새로 할당한다 —
 * 60fps 프레임 예산(16.7ms)의 6~14%를 한 사건이 먹고, 모바일에서는 배수로 늘어난다.
 * 게다가 (A)는 **dispose 한다**: 되살릴 방법이 아예 없어서 재생과는 애초에 안 맞는다.
 *
 * 그래서 아래 테스트는 "보이나 안 보이나"만 보지 않는다. **(B)로 만들었다는 것**을
 * 관측 가능한 사실 셋으로 잠근다:
 *   ① 지오메트리 **객체가 그대로다** (재병합이면 새 객체로 갈린다)
 *   ② 삼각형 수가 안 변한다 (재병합이면 그 셀만큼 준다)
 *   ③ 메시가 안 는다 = 드로우콜 그대로 1
 * ①이 깨지면 성능 회귀이고, ②③이 깨지면 예산 회귀다.
 *
 * WebGL 없이 THREE 오브젝트 상태만 본다 — 셰이더가 aGrow 를 실제로 곱하는지는
 * 여기서 못 보므로, 대신 **셰이더가 읽는 바로 그 두 속성**(aGrow·aBase)을 CPU에서
 * 같은 식으로 섞어(mix) 결과를 확인한다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PROP_REGROW_SECONDS,
  PROP_TAKE_SECONDS,
  buildProps,
  type PropsBuild,
} from '@/render/meshlib/props';
import { flatMat } from '@/render/palette';
import { buildStage } from '@/render/meshlib/terrain';
import { cellKey, sceneryCells } from '@/data/grid';
import { isLandmarkCell, resourceKindOf } from '@/data/resources';
import { STAGES } from '@/data/stages';
import type { StageDef, Vec2 } from '@/data/types';

function stageOf(id: number): StageDef {
  const s = STAGES.find((x) => x.id === id);
  if (!s) throw new Error(`stage ${id}`);
  return s;
}

/** 실제 판과 **같은 셀 목록·같은 자원 종류**로 굽는다 (stage3d 가 부르는 그대로) */
function make(stageId = 1): { props: PropsBuild; cells: Vec2[]; dispose(): void } {
  const stage = stageOf(stageId);
  const terrain = buildStage(stage);
  const cells = [...sceneryCells(stage, terrain.pathCells)].map((k) => ({
    x: k % stage.gridW,
    z: Math.floor(k / stage.gridW),
  }));
  const props = buildProps(stage.biome, cells, terrain.cellToWorld, stage.id, (x, z) => {
    const key = cellKey(stage, x, z);
    const kind = resourceKindOf(stage, key);
    return { kind, landmark: isLandmarkCell(stage, key, kind) };
  });
  return {
    props,
    cells,
    dispose(): void {
      props.dispose();
      terrain.dispose();
    },
  };
}

function propsMesh(build: PropsBuild): THREE.Mesh {
  const m = build.group.children.find((o) => o.name === 'propsMesh');
  if (!m) throw new Error('propsMesh 가 없다');
  return m as THREE.Mesh;
}

function triCount(mesh: THREE.Mesh): number {
  return mesh.geometry.getAttribute('position').count / 3;
}

/** 메시 수 = 드로우콜 (소품은 언제나 하나여야 한다) */
function meshCount(g: THREE.Object3D): number {
  let n = 0;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

/**
 * 셰이더가 하는 일을 CPU에서 그대로 한다: `transformed = mix(aBase, position, aGrow)`.
 * 그 정점 색인들의 바운딩 박스를 돌려준다 — 크기가 0 이면 한 점으로 접혔다 = 안 보인다.
 */
function boxOf(mesh: THREE.Mesh, idx: readonly number[]): THREE.Box3 {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const grow = geo.getAttribute('aGrow') as THREE.BufferAttribute;
  const base = geo.getAttribute('aBase') as THREE.BufferAttribute;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const i of idx) {
    const g = grow.getX(i);
    v.set(
      base.getX(i) + (pos.getX(i) - base.getX(i)) * g,
      base.getY(i) + (pos.getY(i) - base.getY(i)) * g,
      base.getZ(i) + (pos.getZ(i) - base.getZ(i)) * g,
    );
    box.expandByPoint(v);
  }
  return box;
}

/** 그 셀에 속한 정점 색인 — 병합 순서 그대로다 (앞쪽이 머리, 뒤쪽이 3층 꼬리) */
function cellIdx(mesh: THREE.Mesh, centerX: number, centerZ: number): number[] {
  const base = mesh.geometry.getAttribute('aBase') as THREE.BufferAttribute;
  const out: number[] = [];
  for (let i = 0; i < base.count; i++) {
    if (Math.abs(base.getX(i) - centerX) > 1e-6 || Math.abs(base.getZ(i) - centerZ) > 1e-6) continue;
    out.push(i);
  }
  return out;
}

/**
 * 그 셀에서 **캐 가는 부분**(머리)의 aGrow 값들.
 * 머리는 셀 구간의 **앞쪽 연속 구간**이고, 꼬리(3층 지피)는 언제나 1로 남는다 —
 * 그래서 완전히 텄을 때 값이 0인 정점들이 곧 머리다. 그 길이를 밖에서 넘겨받는다.
 */
function growValues(mesh: THREE.Mesh, centerX: number, centerZ: number, headLen: number): number[] {
  const grow = mesh.geometry.getAttribute('aGrow') as THREE.BufferAttribute;
  return cellIdx(mesh, centerX, centerZ)
    .slice(0, headLen)
    .map((i) => grow.getX(i));
}

/** 완전히 텄은 상태에서 머리 길이를 잰다 (앞쪽 0 의 연속 길이) */
function headLenOf(mesh: THREE.Mesh, centerX: number, centerZ: number): number {
  const grow = mesh.geometry.getAttribute('aGrow') as THREE.BufferAttribute;
  const idx = cellIdx(mesh, centerX, centerZ);
  let n = 0;
  while (n < idx.length && grow.getX(idx[n] as number) === 0) n++;
  return n;
}

describe('소품 채집/재생 (그림)', () => {
  it('다 캔 칸은 화면에서 사라진다 — 그리고 그 방법이 재병합이 아니다', () => {
    const { props, cells, dispose } = make(1);
    const mesh = propsMesh(props);
    const cell = cells[0] as Vec2;
    const geoBefore = mesh.geometry;
    const triBefore = triCount(mesh);
    const meshBefore = meshCount(props.group);

    expect(props.cellGrow(cell.x, cell.z), '판 시작에는 다 자라 있다').toBe(1);
    expect(props.setCellTaken(cell.x, cell.z, true, true), '소품 칸인데 못 텄다').toBe(true);
    expect(props.cellGrow(cell.x, cell.z), '텄는데 성장률이 안 0이다').toBe(0);

    // ① 지오메트리 객체가 그대로다 — 재병합이면 여기서 갈린다
    expect(mesh.geometry, '재병합이 일어났다 (판당 104회면 13초마다 프레임이 튄다)').toBe(geoBefore);
    // ② 삼각형이 안 줄었다 = 버퍼를 다시 안 만들었다. 예산은 언제나 만석 기준이므로
    //    이 값이 안 변하는 편이 오히려 안전하다(최악이 곧 평상이다)
    expect(triCount(mesh), '삼각형 수가 변했다 = 버퍼를 새로 만들었다').toBe(triBefore);
    // ③ 드로우콜 그대로
    expect(meshCount(props.group), '메시가 늘었다 = 드로우콜이 늘었다').toBe(meshBefore);
    expect(mesh.visible, '소품이 남았는데 메시를 숨겼다').toBe(true);
    dispose();
  });

  it('텄은 칸의 정점은 밑동 한 점으로 접힌다 = 실제로 안 보인다', () => {
    const { props, cells, dispose } = make(1);
    const mesh = propsMesh(props);
    const cell = cells[3] as Vec2;
    // 이 셀의 중심을 aBase 에서 읽어 온다 (그 값이 곧 접히는 목표점이다)
    const base = mesh.geometry.getAttribute('aBase') as THREE.BufferAttribute;
    const grow = mesh.geometry.getAttribute('aGrow') as THREE.BufferAttribute;
    // 아직 아무것도 안 텄으므로 전부 1이다
    for (let i = 0; i < grow.count; i++) expect(grow.getX(i)).toBe(1);

    props.setCellTaken(cell.x, cell.z, true, true);
    // 접힌 정점을 세어 본다: 값이 0인 정점의 aBase 는 전부 같은 한 점이어야 한다
    let n = 0;
    let bx = NaN;
    let bz = NaN;
    for (let i = 0; i < grow.count; i++) {
      if (grow.getX(i) !== 0) continue;
      n++;
      if (Number.isNaN(bx)) {
        bx = base.getX(i);
        bz = base.getZ(i);
      }
      expect(base.getX(i), '한 셀의 밑동이 여러 점이다').toBe(bx);
      expect(base.getZ(i)).toBe(bz);
    }
    expect(n, '접힌 정점이 하나도 없다').toBeGreaterThan(0);

    /*
     * 셰이더와 같은 식으로 섞어 보면 **머리는 부피가 0**이고 **꼬리(3층 지피)는 남는다**.
     * 남기는 것이 이 설계의 판단이다: 소품 셀이 통째로 비면 그 칸만 대머리 타일이 되어
     * "캐 갔다"가 아니라 렌더 버그로 보인다. 남은 것이 정말 지피인지는 **높이**로 잰다 —
     * 나무가 남았다면 이 상자는 지면을 한참 벗어난다.
     */
    const idx = cellIdx(mesh, bx, bz);
    const headLen = headLenOf(mesh, bx, bz);
    const head = boxOf(mesh, idx.slice(0, headLen));
    expect(head.getSize(new THREE.Vector3()).length(), '캐 갔는데 부피가 남았다').toBeCloseTo(0, 6);

    const tail = boxOf(mesh, idx.slice(headLen));
    expect(idx.length - headLen, '3층 지피가 아예 없다').toBeGreaterThan(0);
    expect(tail.getSize(new THREE.Vector3()).length(), '남은 것이 없다 = 대머리 칸이다')
      .toBeGreaterThan(0.05);
    // 3층 지피의 실측 최고 높이는 6판 전부에서 0.15~0.42 이고, 1층은 0.17~2.32 다.
    // 0.6 은 그 사이의 빈 구간이라 "지피만 남았다"와 "나무가 남았다"를 확실히 가른다.
    expect(tail.max.y, '남은 것이 지피가 아니다 (나무가 통째로 남았다)').toBeLessThan(0.6);
    // 그리고 캐기 전의 이 칸은 그보다 한참 높았다 — 실제로 무언가가 사라졌다는 확인
    props.setCellTaken(cell.x, cell.z, false, true);
    expect(boxOf(mesh, idx).max.y, '캐기 전후의 높이가 같다 = 아무것도 안 사라졌다')
      .toBeGreaterThan(tail.max.y + 0.3);
    props.setCellTaken(cell.x, cell.z, true, true);

    // 다른 셀은 한 톨도 안 건드렸다 — 이웃 칸이 같이 사라지면 그림이 통째로 틀린다
    const other = cells.find((c) => c.x !== cell.x || c.z !== cell.z) as Vec2;
    expect(props.cellGrow(other.x, other.z), '옆 칸까지 텄다').toBe(1);
    dispose();
  });

  it('다시 자란다 — 작게 시작해 커지고, 되튐으로 한 번 넘겼다 정확히 1로 끝난다', () => {
    const { props, cells, dispose } = make(1);
    const mesh = propsMesh(props);
    const cell = cells[5] as Vec2;
    const base = mesh.geometry.getAttribute('aBase') as THREE.BufferAttribute;

    props.setCellTaken(cell.x, cell.z, true, true);
    // 접힌 셀의 중심을 찾아 둔다
    const grow = mesh.geometry.getAttribute('aGrow') as THREE.BufferAttribute;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < grow.count; i++) {
      if (grow.getX(i) === 0) {
        cx = base.getX(i);
        cz = base.getZ(i);
        break;
      }
    }
    const headLen = headLenOf(mesh, cx, cz);
    expect(headLen, '캐 가는 부분이 하나도 없다').toBeGreaterThan(0);

    props.setCellTaken(cell.x, cell.z, false);
    expect(props.animCount(), '재생 연출이 안 걸렸다').toBe(1);

    const seen: number[] = [];
    const step = PROP_REGROW_SECONDS / 20;
    for (let i = 0; i < 20; i++) {
      props.tick(step);
      const vals = growValues(mesh, cx, cz, headLen);
      expect(new Set(vals).size, '한 셀의 정점이 서로 다른 배율을 갖는다').toBe(1);
      seen.push(vals[0] as number);
    }
    // 작게 시작한다 — 첫 표본이 이미 다 자란 크기면 "자라는 것이 보인다"가 거짓이다
    expect(seen[0] as number, '첫 프레임부터 다 자라 있다').toBeLessThan(0.35);
    // 단조 증가 구간이 있고, 되튐으로 1을 한 번 넘긴다 (없으면 그냥 페이드로 보인다)
    expect(Math.max(...seen), '되튐이 없다 — 0.85초가 페이드처럼 보인다').toBeGreaterThan(1);
    expect(Math.max(...seen), '되튐이 과하다 — 소품이 부풀었다 줄어든다').toBeLessThan(1.12);
    // 끝나면 정확히 1이고 연출이 목록에서 빠진다 (안 빠지면 매 프레임 헛돈다)
    props.tick(PROP_REGROW_SECONDS);
    expect(props.animCount(), '끝난 연출이 목록에 남았다').toBe(0);
    expect(props.cellGrow(cell.x, cell.z)).toBe(1);
    expect(growValues(mesh, cx, cz, headLen).every((v) => v === 1), '다 자랐는데 1이 아니다').toBe(true);
    // 재생도 재병합을 안 했다
    expect(triCount(mesh)).toBe(triCount(mesh));
    dispose();
  });

  it('사라질 때는 되튐을 안 쓴다 — 캤는데 한 번 커지면 "터졌다"로 보인다', () => {
    const { props, cells, dispose } = make(1);
    const mesh = propsMesh(props);
    const cell = cells[7] as Vec2;
    const base = mesh.geometry.getAttribute('aBase') as THREE.BufferAttribute;
    // 셀 중심을 미리 알아 둔다 (아직 안 텄으므로 값으로는 못 찾는다 — 먼저 텄다가 되돌린다)
    props.setCellTaken(cell.x, cell.z, true, true);
    const grow = mesh.geometry.getAttribute('aGrow') as THREE.BufferAttribute;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < grow.count; i++) {
      if (grow.getX(i) === 0) {
        cx = base.getX(i);
        cz = base.getZ(i);
        break;
      }
    }
    const headLen = headLenOf(mesh, cx, cz);
    expect(headLen, '캐 가는 부분이 하나도 없다').toBeGreaterThan(0);
    props.setCellTaken(cell.x, cell.z, false, true);

    props.setCellTaken(cell.x, cell.z, true);
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      props.tick(PROP_TAKE_SECONDS / 8);
      seen.push(growValues(mesh, cx, cz, headLen)[0] as number);
    }
    expect(Math.max(...seen), '사라지는 도중에 원래보다 커졌다').toBeLessThanOrEqual(1);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i] as number, '사라지는 중에 다시 커진 프레임이 있다').toBeLessThanOrEqual(seen[i - 1] as number);
    }
    expect(seen[seen.length - 1] as number).toBe(0);
    dispose();
  });

  it('연출 도중에 반대 사건이 오면 **지금 값에서** 이어 간다 (튀지 않는다)', () => {
    const { props, cells, dispose } = make(1);
    const mesh = propsMesh(props);
    const cell = cells[9] as Vec2;
    const base = mesh.geometry.getAttribute('aBase') as THREE.BufferAttribute;
    props.setCellTaken(cell.x, cell.z, true, true);
    const grow = mesh.geometry.getAttribute('aGrow') as THREE.BufferAttribute;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < grow.count; i++) {
      if (grow.getX(i) === 0) {
        cx = base.getX(i);
        cz = base.getZ(i);
        break;
      }
    }
    const headLen = headLenOf(mesh, cx, cz);
    expect(headLen, '캐 가는 부분이 하나도 없다').toBeGreaterThan(0);
    props.setCellTaken(cell.x, cell.z, false, true);

    /*
     * ── ① 사라지는 도중에 다시 자란다 ──
     * 이 방향이 진짜 시험대다. 사라짐은 선형이라 중간값이 명확하고, **논리값에서 이으면
     * 0 으로 튄다**(논리값은 그 시점에 이미 목표인 0이다). 되튐이 가려 주지 않는다.
     */
    props.setCellTaken(cell.x, cell.z, true);
    props.tick(PROP_TAKE_SECONDS * 0.5);
    const mid = growValues(mesh, cx, cz, headLen)[0] as number;
    expect(mid, '절반쯤 사라져 있어야 한다').toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);

    props.setCellTaken(cell.x, cell.z, false);
    props.tick(1e-4);
    const after = growValues(mesh, cx, cz, headLen)[0] as number;
    // 0 으로 떨어졌다가 다시 자라는 것이 아니라 mid 에서 이어져야 한다
    expect(after, '반대 사건에서 소품이 한 번 사라졌다 다시 나타났다').toBeGreaterThan(mid - 0.05);

    // ── ② 자라는 도중에 다시 캔다 (4배속에서 실제로 나는 순서다) ──
    props.setCellTaken(cell.x, cell.z, false, true);
    props.setCellTaken(cell.x, cell.z, true);
    props.tick(PROP_TAKE_SECONDS * 0.4);
    const mid2 = growValues(mesh, cx, cz, headLen)[0] as number;
    props.setCellTaken(cell.x, cell.z, false);
    props.tick(1e-4);
    expect(growValues(mesh, cx, cz, headLen)[0] as number, '두 번째 반전에서 튀었다').toBeGreaterThan(
      mid2 - 0.05,
    );
    dispose();
  });

  it('flatMat 싱글턴을 안 건드린다 — 건드리면 판 전체가 원점으로 접힌다', () => {
    const shared = flatMat();
    const before = shared.onBeforeCompile;
    const { props, dispose } = make(1);
    const mesh = propsMesh(props);
    expect(mesh.material, '소품이 공유 싱글턴을 그대로 쓴다').not.toBe(shared);
    expect(flatMat().onBeforeCompile, '싱글턴에 셰이더 패치가 걸렸다').toBe(before);
    // 패치는 소품 재질에만 있다
    expect((mesh.material as THREE.Material).customProgramCacheKey()).toBe('props:grow');
    dispose();
  });

  /**
   * 셰이더 패치가 **실제로 붙었는지**를 본다.
   *
   * `String.replace` 는 찾는 문자열이 없으면 **조용히 아무것도 안 한다**. 곧 three 를
   * 올려 청크 이름이나 본문이 바뀌는 날, 이 기능은 타입 오류 0건 · 테스트 초록인 채로
   * **그냥 안 동작한다**(소품이 영영 안 사라진다). 그 실패는 사람이 판을 켜 봐야만
   * 보이는 종류라 여기서 잡는다.
   */
  it('셰이더 훅이 실제로 붙는다 — three 를 올려 청크가 바뀌면 여기서 걸린다', () => {
    const { props, dispose } = make(1);
    const mat = propsMesh(props).material as THREE.Material;
    expect(mat.onBeforeCompile, '패치가 아예 없다').toBeTruthy();
    // three 가 실제로 넘겨주는 것과 같은 모양의 소스를 만들어 통과시켜 본다
    const src = THREE.ShaderLib.lambert.vertexShader;
    expect(src, '기준 셰이더에 <common> 훅이 없다').toContain('#include <common>');
    expect(src, '기준 셰이더에 <begin_vertex> 훅이 없다').toContain('#include <begin_vertex>');
    const shader = {
      vertexShader: src,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
      uniforms: {},
      name: '',
      defines: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader, 'aGrow 선언이 안 들어갔다').toContain('attribute float aGrow;');
    expect(shader.vertexShader, 'aBase 선언이 안 들어갔다').toContain('attribute vec3 aBase;');
    expect(shader.vertexShader, '성장률을 곱하는 줄이 안 들어갔다').toContain(
      'transformed = mix( aBase, transformed, aGrow );',
    );
    // 원래 청크는 살아 있어야 한다 — 덮어쓰면 그 안의 USE_ALPHAHASH 분기가 통째로 날아간다
    // (three 는 #include 를 컴파일 시점에 푼다 — 여기서는 아직 지시자 그대로다)
    expect(shader.vertexShader, 'begin_vertex 청크를 덮어썼다').toContain('#include <begin_vertex>');
    // 그리고 성장률 줄은 그 **뒤**에 온다 (앞에 오면 transformed 가 아직 없어 컴파일이 깨진다)
    expect(
      shader.vertexShader.indexOf('transformed = mix( aBase'),
      '성장률 줄이 begin_vertex 앞에 있다',
    ).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
    dispose();
  });

  it('골드 제거(removeCell)는 그대로 재병합하고, 진행 중인 다른 칸의 상태를 안 잃는다', () => {
    const { props, cells, dispose } = make(1);
    const mesh = propsMesh(props);
    const taken = cells[2] as Vec2;
    const cleared = cells[4] as Vec2;
    props.setCellTaken(taken.x, taken.z, true, true);
    const triBefore = triCount(mesh);

    expect(props.removeCell(cleared.x, cleared.z), '골드 제거가 실패했다').toBe(true);
    // 이쪽은 재병합이 맞다 — 영구 제거라 삼각형을 실제로 돌려받는다
    expect(triCount(mesh), 'removeCell 이 삼각형을 안 돌려줬다').toBeLessThan(triBefore);
    expect(meshCount(props.group), 'removeCell 이 메시를 늘렸다').toBe(1);
    // 재병합 뒤에도 텄은 칸은 여전히 텄다 (grow Map 이 진실이고 버퍼는 사본이다)
    expect(props.cellGrow(taken.x, taken.z), '재병합에서 텄음 상태가 날아갔다').toBe(0);
    // 그리고 치운 칸은 이제 이 빌드에 없다 — 재생 요청이 와도 조용히 false 다
    expect(props.setCellTaken(cleared.x, cleared.z, false), '치운 칸이 되살아났다').toBe(false);
    expect(props.cellGrow(cleared.x, cleared.z)).toBe(0);
    dispose();
  });

  /**
   * 6판 전수 — **어느 판에서도 캐 가는 부분이 완전히 접히고, 남는 것은 지면에 붙어 있다.**
   *
   * 스테이지1만 보면 바이옴 키트마다 층 구성이 달라 생기는 회귀를 놓친다(사막은 3층이
   * 거의 없고 늪은 덩굴이 길다). 여기서 잠그는 명제 둘:
   *  ① 접힌 부분의 최고 높이가 **정확히 0** — 하나라도 안 접히면 캔 자리에 조각이 뜬다
   *  ② 남은 부분의 최고 높이가 0.6 아래 — 1층이 꼬리에 섞여 들어가면 여기서 걸린다
   *    (산포 순서를 바꿔 3층이 더 이상 마지막이 아니게 되는 것이 그 실패의 모양이다)
   */
  it('6판 전부에서 캐 가는 부분만 접히고 남는 것은 지면에 붙어 있다', () => {
    for (const id of [1, 2, 3, 4, 5, 6]) {
      const { props, cells, dispose } = make(id);
      const mesh = propsMesh(props);
      for (const c of cells) props.setCellTaken(c.x, c.z, true, true);
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const grow = mesh.geometry.getAttribute('aGrow') as THREE.BufferAttribute;
      const base = mesh.geometry.getAttribute('aBase') as THREE.BufferAttribute;
      let leftY = 0;
      let goneY = 0;
      for (let i = 0; i < pos.count; i++) {
        const g = grow.getX(i);
        const y = base.getY(i) + (pos.getY(i) - base.getY(i)) * g;
        if (g > 0) leftY = Math.max(leftY, y);
        else goneY = Math.max(goneY, y);
      }
      expect(goneY, `s${id}: 캐 간 부분이 안 접혔다`).toBe(0);
      expect(leftY, `s${id}: 남은 것이 지피가 아니다`).toBeLessThan(0.6);
      expect(leftY, `s${id}: 남은 것이 아예 없다 = 대머리 판이다`).toBeGreaterThan(0);
      dispose();
    }
  });

  it('없는 칸(경로·빈 칸)에는 아무 일도 안 일어난다', () => {
    const { props, dispose } = make(1);
    expect(props.setCellTaken(-1, -1, true)).toBe(false);
    expect(props.animCount()).toBe(0);
    dispose();
  });

  /**
   * 재병합 비용 실측 — **판정이 아니라 기록이다**(느린 CI에서 흔들리면 안 되므로 여유가 크다).
   * 잠그는 명제는 하나: **채집 경로가 골드 제거 경로보다 자릿수로 싸다.**
   * 이것이 깨졌다면 setCellTaken 안에서 재병합이 다시 살아난 것이다.
   */
  it('[실측] 채집 경로가 재병합 경로보다 자릿수로 싸다', () => {
    const a = make(1);
    const cells = a.cells;
    // 워밍업 (JIT)
    for (let i = 0; i < 200; i++) {
      const c = cells[i % cells.length] as Vec2;
      a.props.setCellTaken(c.x, c.z, i % 2 === 0, true);
    }
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const c = cells[i % cells.length] as Vec2;
      a.props.setCellTaken(c.x, c.z, i % 2 === 0, true);
    }
    const perToggle = (performance.now() - t0) / N;
    a.dispose();

    const b = make(1);
    const t1 = performance.now();
    let removed = 0;
    for (const c of b.cells) if (b.props.removeCell(c.x, c.z)) removed++;
    const perRemove = (performance.now() - t1) / removed;
    b.dispose();

    // eslint-disable-next-line no-console
    console.log(
      `[props] setCellTaken ${perToggle.toFixed(4)}ms/회 · removeCell ${perRemove.toFixed(3)}ms/회 ` +
        `· 배율 ${(perRemove / Math.max(perToggle, 1e-6)).toFixed(0)}배 ` +
        `(판당 104회 기준: ${(perToggle * 104).toFixed(2)}ms vs ${(perRemove * 104).toFixed(0)}ms)`,
    );
    expect(perToggle, '채집 경로가 0.05ms 를 넘었다 — 재병합이 되살아났나?').toBeLessThan(0.05);
    expect(perRemove / Math.max(perToggle, 1e-6), '두 경로의 차이가 사라졌다').toBeGreaterThan(10);
  });
});
