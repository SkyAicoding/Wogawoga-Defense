/**
 * 타워 그리기 묶음 — **타워 수와 무관한 드로우콜**을 만드는 한 겹.
 *
 * ── 왜 InstancedMesh 가 아니라 BatchedMesh 인가 ─────────────────────────────
 * 타워는 (종 8 × 티어 5) = 40가지 지오메트리를 쓴다. InstancedMesh 는 지오메트리
 * 하나당 메시 하나라 (종,티어) 조합마다 묶음이 갈리고, 그 조합이 실제로 몇 개
 * 놓였는지에 드로우콜이 그대로 실린다 — 24기를 전부 다른 조합으로 지으면
 * 묶기 전과 똑같은 3콜/기다. 상한이 **40조합 × 3 = 120콜**이라 예산 90을 못 지킨다.
 *
 * `BatchedMesh` 는 여러 지오메트리를 한 버퍼에 이어 담고 `WEBGL_multi_draw` 로
 * **한 번에** 그린다. 그래서 조합이 몇 가지든 묶음 하나 = 드로우콜 하나다.
 * 인스턴스마다 자기 지오메트리 구간만 그리므로 **삼각형은 1개도 늘지 않는다**
 * (gait.ts 의 변형 마스킹처럼 안 쓰는 정점을 축퇴시키는 방식이 아니다 —
 *  타워는 티어마다 색·부속이 통째로 달라 마스킹으로 묶으면 정점이 5배가 된다.
 *  실측: 한 종의 5티어 합 4,612~5,956삼각형 vs 한 티어 626~1,584).
 *
 * ⚠ `WEBGL_multi_draw` 가 없는 기기에서는 three 가 **드로우콜 루프로 자동 폴백**한다
 *   (WebGLRenderer 의 isBatchedMesh 분기). 그림은 똑같이 나오고 드로우콜만 인스턴스
 *   수만큼 든다 — 즉 **최악이 지금과 같다**. 실측: e2e 크로미움(swiftshader)에는
 *   확장이 있다(`getSupportedExtensions()` 에 WEBGL_multi_draw).
 *
 * ── 그림자 규약 ────────────────────────────────────────────────────────────
 * `castShadow` 는 **묶음 단위**다. 그래서 몸체와 action 을 한 묶음에 섞으면
 * action 까지 그림자 패스에서 그려져 "타워당 그림자 캐스터 1개"(meshlib/towers.ts)가
 * 깨지고 그 지오메트리가 프레임에서 2배로 청구된다. 몸체 묶음과 action 묶음을
 * 처음부터 갈라 두는 이유가 이것이다.
 */
import * as THREE from 'three';

export interface TowerBatchOpts {
  readonly name: string;
  /** 그림자 캐스터인가 — 몸체 묶음만 true (towers.ts 의 "타워당 1개" 규약) */
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  /** 초기 정점 용량 (모자라면 2배씩 늘린다) */
  readonly verts?: number;
  /** 초기 인스턴스 용량 (모자라면 2배씩 늘린다) */
  readonly instances?: number;
}

/** 정점 용량 기본값 — 타워 몸체 하나가 1,584~4,356정점이라 대여섯 조합 분량 */
const DEF_VERTS = 16384;
/** 인스턴스 용량 기본값 — 건설 가능 칸이 판당 124~152개라 그 언저리에서 시작한다 */
const DEF_INST = 64;

/**
 * BatchedMesh 한 개 + (지오메트리 키 → id) 캐시 + 용량 자동 확장.
 *
 * 용량을 미리 크게 잡지 않는 이유: `BatchedMesh` 는 **첫 addGeometry 때** 정점 버퍼를
 * 통째로 할당한다(`_initializeGeometry`). 40조합 전부를 담을 만큼(몸체 111,240정점 ≈ 4MB)
 * 미리 잡으면 타워 한 기만 지어도 그 값을 다 낸다. 늘리는 쪽은 `setGeometrySize` 로
 * 되고 실제로 일어나는 횟수는 조합 수만큼(로그)이다.
 */
export class TowerBatch {
  readonly mesh: THREE.BatchedMesh;
  private ids = new Map<string, number>();
  private capVerts: number;
  private capInst: number;
  /** 지금 보이는 인스턴스 수 — 0이면 묶음 자체를 렌더 리스트에서 뺀다 */
  private shown = 0;

  constructor(material: THREE.Material, opts: TowerBatchOpts) {
    this.capVerts = opts.verts ?? DEF_VERTS;
    this.capInst = opts.instances ?? DEF_INST;
    // 인덱스 0 — factory.buildParts 는 비인덱스로 굽는다(플랫 셰이딩 규약)
    const mesh = new THREE.BatchedMesh(this.capInst, this.capVerts, 0, material);
    mesh.name = opts.name;
    mesh.castShadow = opts.castShadow;
    mesh.receiveShadow = opts.receiveShadow;
    // 묶음 전체의 바운딩은 타워가 늘 때마다 낡는다(three 가 한 번 계산하고 캐시한다).
    // 컬링은 인스턴스별로 하는 쪽이 정확하다 — perObjectFrustumCulled 는 기본 true 이고
    // 지오메트리마다 바운딩 박스를 들고 있어 매 프레임 현재 행렬로 다시 판정한다.
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.mesh = mesh;
  }

  /** 키로 캐시된 지오메트리 id (없으면 등록). 용량이 모자라면 먼저 늘린다 */
  geometry(key: string, geo: THREE.BufferGeometry): number {
    const hit = this.ids.get(key);
    if (hit !== undefined) return hit;
    const need = geo.getAttribute('position')?.count ?? 0;
    const used = this.capVerts - this.mesh.unusedVertexCount;
    if (used + need > this.capVerts) {
      let cap = this.capVerts;
      while (cap < used + need) cap *= 2;
      this.mesh.setGeometrySize(cap, 0);
      this.capVerts = cap;
    }
    const id = this.mesh.addGeometry(geo);
    this.ids.set(key, id);
    return id;
  }

  /** 인스턴스 발급 (보이는 상태로 시작) */
  add(geoId: number): number {
    if (this.mesh.instanceCount >= this.capInst) {
      this.capInst *= 2;
      this.mesh.setInstanceCount(this.capInst);
    }
    const id = this.mesh.addInstance(geoId);
    this.shown++;
    return id;
  }

  release(id: number): void {
    if (this.mesh.getVisibleAt(id)) this.shown--;
    this.mesh.deleteInstance(id);
  }

  matrix(id: number, m: THREE.Matrix4): void {
    this.mesh.setMatrixAt(id, m);
  }

  visible(id: number, v: boolean): void {
    if (this.mesh.getVisibleAt(id) === v) return;
    this.mesh.setVisibleAt(id, v);
    this.shown += v ? 1 : -1;
  }

  /**
   * 렌더 리스트 편입 여부 갱신 — **보이는 인스턴스가 하나도 없으면 숨긴다.**
   * three 는 그릴 게 없으면 GL 콜을 내지 않지만(멀티드로 카운트 0), 씬 그래프를 세는
   * 잣대(tests/render/drawcount.ts)와 실제 렌더러가 같은 답을 내게 하려면 여기서 끊어야 한다.
   */
  sync(): void {
    this.mesh.visible = this.shown > 0;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
    this.ids.clear();
    this.shown = 0;
  }
}
