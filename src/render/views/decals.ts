/**
 * 지면 데칼 — 사거리 링, 슬롯 하이라이트, 경로 셰브런, 부족 사거리 바운더리.
 * 전부 polygonOffset으로 지형 z-파이팅 방지, 애디티브/반투명.
 */
import * as THREE from 'three';
import type { Vec2 } from '@/data/types';
import { pathArcTable, samplePath, type CellToWorld } from '../meshlib/terrain';

const DECAL_Y = 0.03;

function groundMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    toneMapped: false,
  });
}

export class Decals {
  private group = new THREE.Group();
  private rangeFill: THREE.Mesh;
  private rangeEdge: THREE.Mesh;
  private rangeSoft: THREE.Mesh;
  private slots: THREE.Mesh | null = null;
  private slotMat: THREE.MeshBasicMaterial;
  /** 슬롯 디스크 원본 셀 — 소품 제거로 셀이 추가되면 재병합한다 */
  private slotCells: Vec2[] = [];
  private chevrons: THREE.Mesh | null = null;
  private chevronMat: THREE.MeshBasicMaterial;
  private chevronPulse = 0;
  /**
   * 표식 봉수대 (메시 1개 = 드로우콜 1, 평소엔 숨김).
   * **두 가지 표시가 이 메시 하나를 돌려 쓴다** — 탭한 소품 셀, 그리고 아군 출격 한계선.
   * 둘은 placement에서 상호배타라(소품 선택과 마을 선택은 서로를 해제한다) 한 프레임에
   * 같이 보일 일이 없다. 새 메시를 만들면 그만큼 드로우콜이 늘어나므로 돌려 쓴다.
   */
  private marker: THREE.Mesh;
  private markerMat: THREE.MeshBasicMaterial;
  /** 소품용 봉수대 지오메트리 (원점 기준 1개) */
  private cellMarkerGeo: THREE.BufferGeometry;
  /** 출격선용 지오메트리 (월드 좌표에 경로 수만큼 박아 병합) — 지점이 바뀔 때만 다시 만든다 */
  private sortieGeo: THREE.BufferGeometry | null = null;
  private sortieSig = '';
  /**
   * 선택한 부족의 **공격 사거리 바운더리** (메시 1개 = 드로우콜 1, 평소엔 숨김).
   * 부족원 여럿의 원을 하나로 병합해 굽는다 — 아래 showAllyRanges 참조.
   */
  private allyRange: THREE.Mesh;
  private allyRangeMat: THREE.MeshBasicMaterial;
  private allyRangeGeo: THREE.BufferGeometry | null = null;
  private allyRangeSig = '';
  /** 지금 마커가 무엇을 가리키는가 — 호흡 애니메이션 규칙이 갈린다 */
  private markerMode: 'cell' | 'sortie' | 'tower' = 'cell';
  /** 모드별 링 기본 배율 (호흡 스케일이 이 위에 곱해진다) */
  private markerBaseScale = 1;
  private time = 0;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(
    scene: THREE.Scene,
    private cellToWorld: CellToWorld,
  ) {
    this.group.name = 'decals';
    scene.add(this.group);

    // 사거리 링: 안쪽 채움(희미) + 경계선 + 소프트 엣지(넓고 더 희미한 링)
    const fillGeo = new THREE.CircleGeometry(1, 40);
    const edgeGeo = new THREE.RingGeometry(0.965, 1, 48);
    const softGeo = new THREE.RingGeometry(0.86, 0.965, 48);
    for (const g of [fillGeo, edgeGeo, softGeo]) g.rotateX(-Math.PI / 2);
    const fillMat = groundMat(0x7ae8c0, 0.1);
    const edgeMat = groundMat(0xa8ffe0, 0.85);
    const softMat = groundMat(0x8af2cc, 0.28);
    this.rangeFill = new THREE.Mesh(fillGeo, fillMat);
    this.rangeEdge = new THREE.Mesh(edgeGeo, edgeMat);
    this.rangeSoft = new THREE.Mesh(softGeo, softMat);
    for (const m of [this.rangeFill, this.rangeSoft, this.rangeEdge]) {
      m.visible = false;
      m.renderOrder = 3;
      this.group.add(m);
    }
    this.slotMat = groundMat(0xffe084, 0.0);
    this.chevronMat = groundMat(0xfff2c0, 0.0);

    // 선택 마커 — 사거리 링과 구분되게 주황 계열.
    // 소품/타워 선택은 **지면 링만** 쓴다. 예전에는 수직 기둥+정수리 다이아를 얹어
    // "패널이 셀을 덮어도 위로 솟게" 했는데, 지금은 패널이 열리면 카메라가 판을 위로
    // 밀어(camera.setLift) 가림 자체가 없어졌다. 기둥은 목적을 잃고 시야만 어지럽힌다.
    // (출격 한계선 봉수대는 여전히 기둥을 쓴다 — 빈 길 위 한 점이라 링만으로는 안 보인다)
    const markerGeo = buildMarkerGeo(undefined, false);
    this.cellMarkerGeo = markerGeo;
    this.markerMat = groundMat(MARKER_COLOR_CELL, 0.9);
    // 소품·지형에 가려지면 선택 표시로서 쓸모가 없다 — 항상 위에 그린다
    this.markerMat.depthTest = false;
    this.marker = new THREE.Mesh(markerGeo, this.markerMat);
    this.marker.visible = false;
    this.marker.renderOrder = 5;
    this.group.add(this.marker);

    // 부족 사거리 바운더리 — 지오메트리는 선택할 때 굽는다(메시는 미리 만들어 둔다).
    // 색은 ALLY_RANGE_COLOR 주석 참조. renderOrder 4 = 타워 사거리 링(3)보다 위,
    // 선택 마커(5)보다 아래.
    this.allyRangeMat = groundMat(ALLY_RANGE_COLOR, 0.7);
    this.allyRange = new THREE.Mesh(new THREE.BufferGeometry(), this.allyRangeMat);
    this.allyRange.visible = false;
    this.allyRange.renderOrder = 4;
    // 좌표를 지오메트리에 구워 넣으므로 메시는 언제나 원점에 있다 — 그러면 바운딩
    // 스피어가 판 한쪽에 치우쳐 절두체 컬링이 오판할 여지가 없도록 컬링을 끈다
    // (아군은 애초에 컬링을 끄고 그린다 — enemyview와 같은 규약)
    this.allyRange.frustumCulled = false;
    this.group.add(this.allyRange);

    this.disposables.push(
      fillGeo, edgeGeo, softGeo, fillMat, edgeMat, softMat,
      this.slotMat, this.chevronMat, markerGeo, this.markerMat, this.allyRangeMat,
    );
  }

  /** 스테이지 데이터 준비 — 슬롯 위치/경로에 종속된 정적 데칼 생성 */
  init(slotCells: readonly Vec2[], paths: readonly Vec2[][]): void {
    // 슬롯 하이라이트: 병합된 디스크들 (배치 모드에서만 표시)
    this.slotCells = slotCells.map((c) => ({ x: c.x, z: c.z }));
    this.rebuildSlots();

    // 경로 셰브런: 1.1 간격으로 진행방향 삼각형
    const v = new THREE.Vector3();
    const chevGeos: THREE.BufferGeometry[] = [];
    const sample = { x: 0, z: 0, heading: 0 };
    for (const path of paths) {
      const table = pathArcTable(path);
      for (let d = 0.8; d < table.total - 0.5; d += 1.1) {
        samplePath(table, d, sample);
        const g = new THREE.BufferGeometry();
        // 진행방향(+x 기준) 화살촉 삼각형
        // 반시계 감김(위에서 볼 때) — 노멀 +y
        g.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(
            [0.3, 0, 0, -0.14, 0, -0.22, -0.14, 0, 0.22],
            3,
          ),
        );
        const m = new THREE.Matrix4()
          .makeRotationY(-sample.heading);
        this.cellToWorld(sample.x, sample.z, v);
        m.setPosition(v.x, DECAL_Y, v.z);
        g.applyMatrix4(m);
        chevGeos.push(g);
      }
    }
    if (chevGeos.length > 0) {
      this.chevrons = new THREE.Mesh(mergeGeos(chevGeos), this.chevronMat);
      this.chevrons.renderOrder = 2;
      this.group.add(this.chevrons);
    }
  }

  /** slotCells → 병합 디스크 메시 1개 재생성 (셀 추가는 드물어 통째로 다시 만든다) */
  private rebuildSlots(): void {
    const visible = this.slots?.visible ?? false;
    if (this.slots) {
      this.group.remove(this.slots);
      this.slots.geometry.dispose();
      this.slots = null;
    }
    if (this.slotCells.length === 0) return;
    const geos: THREE.BufferGeometry[] = [];
    const v = new THREE.Vector3();
    for (const cell of this.slotCells) {
      const g = new THREE.CircleGeometry(0.34, 20);
      g.rotateX(-Math.PI / 2);
      this.cellToWorld(cell.x, cell.z, v);
      g.translate(v.x, DECAL_Y + 0.06, v.z);
      geos.push(g);
    }
    this.slots = new THREE.Mesh(mergeGeos(geos), this.slotMat);
    this.slots.renderOrder = 2;
    this.slots.visible = visible;
    this.group.add(this.slots);
  }

  /** 소품을 치워 새로 건설 가능해진 셀을 슬롯 하이라이트에 편입 */
  addSlotCell(cellX: number, cellZ: number): void {
    if (this.slotCells.some((c) => c.x === cellX && c.z === cellZ)) return;
    this.slotCells.push({ x: cellX, z: cellZ });
    this.rebuildSlots();
  }

  /**
   * 탭한 소품 셀 하이라이트 표시.
   * offset은 소품이 셀 중심에서 흩어진 양(props.offsetOf) — 링이 실제 밑동을 감싼다.
   */
  showCellMarker(cellX: number, cellZ: number, offsetX = 0, offsetZ = 0): void {
    const v = this.cellToWorld(cellX, cellZ);
    this.marker.geometry = this.cellMarkerGeo;
    this.markerMat.color.setHex(MARKER_COLOR_CELL);
    this.markerMode = 'cell';
    this.markerBaseScale = 1;
    this.marker.position.set(v.x + offsetX, DECAL_Y + 0.04, v.z + offsetZ);
    this.marker.visible = true;
  }

  /**
   * 선택한 타워 발밑 링.
   *
   * 사거리 링만으로는 **어느 타워를 골랐는지**가 안 읽힌다 — 타워가 붙어 있으면
   * 큰 원 하나가 여러 기를 함께 감싸 중심이 어디인지 모호해진다(사용자 피드백).
   * 그래서 사거리 링(무엇에 영향을 주는가)과 별개로 발밑 링(무엇을 골랐는가)을 둔다.
   * 소품 마커와 같은 메시를 돌려 쓰므로 드로우콜은 늘지 않는다(선택은 상호배타).
   */
  showTowerMarker(cellX: number, cellZ: number): void {
    const v = this.cellToWorld(cellX, cellZ);
    this.marker.geometry = this.cellMarkerGeo;
    this.markerMat.color.setHex(MARKER_COLOR_TOWER);
    this.markerMode = 'tower';
    this.markerBaseScale = MARKER_SCALE_TOWER;
    this.marker.position.set(v.x, DECAL_Y + 0.04, v.z);
    this.marker.visible = true;
  }

  /**
   * 부족원 **이동 명령 목표** 표식 — "여기로 간다"를 그 칸에 세운다.
   * points는 명령을 내린 셀이다(9단계 전에는 출격 한계선의 정지 지점이었다 — 한계선이
   * 없어지면서 같은 메시가 목표 표식으로 넘어왔다. 이름은 호환을 위해 남는다).
   *
   * 왜 원이 아니라 봉수대인가: 목표는 **바닥의 한 칸**이라 원으로 그리면 사거리 링과
   * 구분이 안 된다. 봉수대는 기둥이 솟아 하단 HUD 패널이 그 자리를 덮어도 위로 보인다.
   *
   * **드로우콜 증가 0** — 소품 선택 마커와 같은 메시를 쓰고(둘은 상호배타), 경로가 여럿이면
   * 봉수대를 **하나로 병합**해 여전히 메시 한 개다. 색만 아군 톤(한랭색)으로 바꿔
   * "이건 선택 표시가 아니라 우리 편 이야기"임을 구분한다.
   */
  /** 이동 명령 표식 지우기 — 모드를 끄거나 명령이 무효일 때 */
  hideSortieMarker(): void {
    this.hideCellMarker();
  }

  showSortieMarker(points: readonly { x: number; z: number }[]): void {
    if (points.length === 0) {
      this.hideCellMarker();
      return;
    }
    // 지점이 그대로면 지오메트리를 다시 만들지 않는다 (레벨업/선택 때만 바뀐다)
    const sig = points.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(';');
    if (sig !== this.sortieSig || !this.sortieGeo) {
      this.sortieSig = sig;
      this.sortieGeo?.dispose();
      const v = new THREE.Vector3();
      const geos: THREE.BufferGeometry[] = [];
      for (const p of points) {
        this.cellToWorld(p.x, p.z, v);
        // 기둥 없이 — 사용자 지시로 **목표 표식에서도** 하늘로 솟는 선을 없앴다.
        // 대가는 알고 받는다: 명령한 칸이 하단 HUD 패널에 덮이면 표식이 안 보인다.
        // 그래도 이쪽을 고른 이유는 화면이 조용한 편이 낫다는 판단이 사용자 것이기 때문이고,
        // 실제로 가려지는 경우가 좁다 — 목표는 대개 전선(판 가운데~위쪽)이고 패널은 아래에 있다.
        geos.push(buildMarkerGeo(v, false));
      }
      this.sortieGeo = mergeGeos(geos);
    }
    this.marker.geometry = this.sortieGeo;
    this.markerMat.color.setHex(MARKER_COLOR_SORTIE);
    this.markerMode = 'sortie';
    // 좌표는 지오메트리에 구워 넣었다 — 메시는 원점에 둔다(호흡 스케일도 쓰지 않는다)
    this.marker.position.set(0, 0, 0);
    this.marker.scale.set(1, 1, 1);
    this.marker.visible = true;
  }

  hideCellMarker(): void {
    this.marker.visible = false;
  }

  /**
   * 부족 선택 표시 = **각자의 공격 사거리 바운더리** (사용자 지시 ①).
   *
   * 왜 봉수대(showSortieMarker)를 재사용하지 않고 새로 만드는가:
   *  · 사용자가 "선택했을 때 하늘로 올라가는 선은 없애 달라"고 했다. 그 선은 봉수대의
   *    기둥이다. 그런데 기둥은 **이동 목표 표식**에서는 여전히 값을 한다(빈 길 위의 한
   *    점이라 링만으로는 안 보이고, 하단 패널이 그 칸을 덮어도 위로 솟는다). 그래서
   *    봉수대를 지우는 대신 **선택 경로만** 이 지면 링으로 갈아 끼웠다.
   *  · 그리고 선택 표시가 해야 할 일이 하나 늘었다: "이 사람이 어디까지 때리는가".
   *    기존 showRange는 메시 세 개를 **한 곳으로 옮겨** 쓰는 구조라 원을 하나밖에 못
   *    그린다. 종족 전체가 선택되므로 원은 언제나 여럿이다.
   *
   * points는 **셀 좌표**(부족원의 연속 위치), radius는 타일 단위 사거리다.
   * 원 여럿을 좌표째 구워 **하나로 병합**하므로 몇 명을 골라도 드로우콜은 1이다.
   * 게다가 선택 중에는 소품/타워 마커가 내려가 있으므로(placement가 상호배타로 관리한다)
   * 실측 드로우콜 증가는 0이다 — 봉수대 메시 하나가 이 메시 하나로 바뀔 뿐이다.
   *
   * 걸어가는 사람을 따라가야 하므로 매 프레임 호출된다. 지점·반경이 그대로면
   * 서명 비교로 걸러 다시 굽지 않는다(집결해 서 있는 동안이 그 경우다).
   */
  showAllyRanges(points: readonly { x: number; z: number }[], radius: number): void {
    if (points.length === 0 || radius <= 0) {
      this.hideAllyRanges();
      return;
    }
    const sig = `${radius.toFixed(3)}|${points.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(';')}`;
    if (sig !== this.allyRangeSig || !this.allyRangeGeo) {
      this.allyRangeSig = sig;
      this.allyRangeGeo?.dispose();
      const v = new THREE.Vector3();
      const centers: { x: number; z: number }[] = [];
      for (const p of points) {
        this.cellToWorld(p.x, p.z, v);
        centers.push({ x: v.x, z: v.z });
      }
      this.allyRangeGeo = buildAllyRangeGeo(centers, radius);
      this.allyRange.geometry = this.allyRangeGeo;
    }
    this.allyRange.visible = true;
  }

  hideAllyRanges(): void {
    this.allyRange.visible = false;
  }

  /** 사거리 링 표시 (셀 좌표 + 타일 단위 반경) */
  showRange(cellX: number, cellZ: number, radius: number): void {
    const v = this.cellToWorld(cellX, cellZ);
    for (const m of [this.rangeFill, this.rangeEdge, this.rangeSoft]) {
      m.position.set(v.x, DECAL_Y, v.z);
      m.scale.setScalar(radius);
      m.visible = true;
    }
  }

  hideRange(): void {
    this.rangeFill.visible = false;
    this.rangeEdge.visible = false;
    this.rangeSoft.visible = false;
  }

  /** 배치 모드 — 전체 슬롯 발광 표시 */
  setSlotsVisible(visible: boolean): void {
    if (this.slots) this.slots.visible = visible;
  }

  /** 웨이브 시작 전 경로 셰브런 펄스 (durationSec 동안 흐르는 하이라이트) */
  pulseChevrons(durationSec = 2.2): void {
    this.chevronPulse = durationSec;
  }

  update(dt: number): void {
    this.time += dt;
    // 배치 가능 영역 하이라이트 호흡
    if (this.slots?.visible) {
      this.slotMat.opacity = 0.34 + Math.sin(this.time * 5) * 0.12;
    }
    // 셰브런: 평상시 은은하게, 펄스 중 강하게 점멸
    if (this.chevrons) {
      if (this.chevronPulse > 0) {
        this.chevronPulse = Math.max(0, this.chevronPulse - dt);
        this.chevronMat.opacity = 0.45 + Math.abs(Math.sin(this.time * 7)) * 0.5;
      } else {
        this.chevronMat.opacity = 0.3 + Math.sin(this.time * 1.8) * 0.08;
      }
    }
    // 사거리 링 은은한 회전감 (엣지 펄스)
    if (this.rangeEdge.visible) {
      (this.rangeEdge.material as THREE.MeshBasicMaterial).opacity =
        0.7 + Math.sin(this.time * 4) * 0.15;
    }
    // 선택 마커 — 살짝 커졌다 작아지며 "여기다" 하고 알린다.
    // 기둥까지 같이 늘리면 다이아가 출렁이므로 수평만 호흡시킨다.
    // 출격선 모드는 좌표가 지오메트리에 구워져 있어 스케일이 곧 원점 기준 확대다
    // (봉수대가 판 위를 미끄러진다) — 그래서 밝기만 호흡시킨다.
    if (this.marker.visible) {
      if (this.markerMode !== 'sortie') {
        const s = this.markerBaseScale * (1 + Math.sin(this.time * 6) * 0.09);
        this.marker.scale.set(s, 1, s);
      }
      this.markerMat.opacity = 0.72 + Math.sin(this.time * 6) * 0.22;
    }
    // 부족 사거리 바운더리 — 좌표가 지오메트리에 구워져 있어(스케일을 못 쓴다) 밝기만
    // 호흡시킨다. 선택 마커(6 rad/s)보다 **느리게** 둔 이유: 이건 "여기다" 하고 부르는
    // 표식이 아니라 계속 읽는 **눈금**이다. 빠르게 깜빡이면 사거리를 가늠하기 어렵다.
    if (this.allyRange.visible) {
      this.allyRangeMat.opacity = 0.62 + Math.sin(this.time * 3.2) * 0.16;
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.slots?.geometry.dispose();
    this.chevrons?.geometry.dispose();
    this.sortieGeo?.dispose();
    this.sortieGeo = null;
    this.allyRangeGeo?.dispose();
    this.allyRangeGeo = null;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

/**
 * 선택 마커 지오메트리 — 지면 링 + 수직 기둥 + 정수리 다이아를 하나로 병합.
 * 기둥 높이 2.2 월드는 하단 HUD 패널이 그 셀을 덮었을 때 패널 위로 솟아나오는 최소치다
 * (기본 줌 세로/가로 실측 기준). 총 92 삼각형 / 드로우콜 1.
 *
 * at을 받는 이유는 출격선 표식 때문이다 — 경로가 여럿이면 봉수대도 여럿인데, 메시를
 * 늘리면 드로우콜이 늘어난다. 그래서 월드 좌표를 지오메트리에 구워 하나로 병합한다.
 * 생략하면 원점 기준이고, 그때 위치는 mesh.position이 옮긴다(소품 마커가 이 경로다).
 */
const MARKER_BEACON_H = 2.2;
/**
 * 소품 선택 = 주황(사거리 링과 구분) / 출격 한계선 = 한랭색(아군 톤과 같은 축)
 * 타워 선택 = 노랑. 사거리 링(청록)과 색으로 갈리고, 소품 선택(주황)과도 갈린다 —
 * 셋이 한 화면에 동시에 뜨진 않지만 "지금 고른 게 뭐냐"가 색만으로 읽혀야 한다.
 */
const MARKER_COLOR_CELL = 0xffa63c;
const MARKER_COLOR_SORTIE = 0x9fdcf7;
const MARKER_COLOR_TOWER = 0xffe45c;
/**
 * 타워 링 배율 — 타워 실루엣은 T1 0.9 ~ T5 1.4셀이라 소품용 링(외경 0.46)은
 * 받침 밑에 깔려 안 보인다. 1.6배면 외경 0.74로 만렙 받침(반경 약 0.69) 바깥에 선다.
 */
const MARKER_SCALE_TOWER = 1.6;

function buildMarkerGeo(at?: THREE.Vector3, withBeacon = true): THREE.BufferGeometry {
  const ring = new THREE.RingGeometry(0.3, 0.46, 24);
  ring.rotateX(-Math.PI / 2);
  const parts: THREE.BufferGeometry[] = [ring];
  if (withBeacon) {
    const shaft = new THREE.CylinderGeometry(0.028, 0.05, MARKER_BEACON_H, 4, 1, true);
    shaft.translate(0, MARKER_BEACON_H / 2, 0);
    const tip = new THREE.OctahedronGeometry(0.13);
    tip.translate(0, MARKER_BEACON_H + 0.12, 0);
    parts.push(shaft, tip);
  }
  const merged = mergeGeos(parts);
  if (at) merged.translate(at.x, DECAL_Y + 0.04, at.z);
  return merged;
}

/**
 * 부족 사거리 바운더리 색 — 하늘빛 파랑.
 *
 * 왜 이 색인가 (두 갈래를 다 만족해야 한다):
 *  1) **타워 사거리 링과 갈려야 한다.** 타워 쪽은 청록(0x7ae8c0/0xa8ffe0)이고 여기는
 *     파랑이다. 게다가 결정적인 차이는 색이 아니라 **꼴**이다 — 타워 링은 안이 채워진
 *     원반 + 이어진 테두리이고, 이쪽은 **채움이 없는 파선**이다. 한 화면에 둘이 같이 뜨는
 *     일은 없지만(선택은 상호배타), 그래도 "이건 타워 게 아니다"가 한눈에 읽혀야 한다.
 *     파선을 고른 이유가 하나 더 있다: 부족원이 여럿이면 원도 여럿이라 채움을 쓰면
 *     겹친 자리가 얼룩덜룩해져 정작 **경계**가 안 보인다.
 *  2) **우리 편으로 읽혀야 한다.** 이 게임에서 아군은 한랭색이다(ALLY_TINT = [0.86,0.98,1.16]
 *     — 파랑이 가장 높다) 그리고 이동 목표 표식도 같은 축의 하늘색(0x9fdcf7)이다.
 *     그보다 채도를 올려(초록기를 빼) 청록과의 거리를 벌렸다.
 */
const ALLY_RANGE_COLOR = 0x86c8ff;
/**
 * 파선 띠의 폭 (월드=타일). 띠의 **바깥 테두리가 곧 실제 사거리**다 — 안쪽으로만
 * 칠한다. 밖으로 넘치게 그리면 "여기까지 닿는다"가 사거리보다 넓어져 거짓말이 된다.
 */
const ALLY_RANGE_BAND = 0.12;
/**
 * 파선 한 칸 + 빈칸의 목표 호 길이 (월드). 반경으로 나눠 개수를 정하므로 몽둥이꾼(1.0)과
 * 돌팔매꾼(2.8)의 눈금이 **같은 크기**로 읽힌다 (개수를 고정하면 큰 원의 눈금만 길어진다).
 */
const ALLY_RANGE_DASH_ARC = 0.34;
/** 파선이 차지하는 비율 (나머지는 빈칸) */
const ALLY_RANGE_DUTY = 0.62;
/** 발밑 링 반경 — 선택 마커 링(0.3~0.46)과 같은 크기로 둔다. 같은 뜻("이걸 골랐다")이다 */
const ALLY_FOOT_IN = 0.3;
const ALLY_FOOT_OUT = 0.46;
const ALLY_FOOT_SEGS = 14;

/**
 * 선택된 부족원 각자의 [발밑 링 + 사거리 파선 원]을 **하나의 버퍼**로 굽는다.
 *
 * 왜 mergeGeos(RingGeometry 여러 개)가 아니라 직접 굽는가: 이 지오메트리는 부족원이
 * 걸어가는 동안 **매 프레임 다시 만들어진다**(위치가 매 프레임 바뀌니 서명이 안 맞는다).
 * 파선 하나당 RingGeometry 객체를 만들면 프레임마다 수백 개가 태어났다 죽는다.
 * 여기서는 Float32Array 하나에 삼각형을 바로 써 넣어 그 쓰레기를 없앤다.
 *
 * 감김: RingGeometry(...).rotateX(-π/2)와 같은 규약 — 위(+y)를 보는 앞면.
 * 그 회전이 XY의 각 a를 (cos a, 0, -sin a)로 보내므로 z에 마이너스가 붙는다.
 *
 * 삼각형 수: 부족원 1명당 (파선 수 + 발밑 14) × 2. 돌팔매꾼(2.8) 기준 약 128개이고
 * 정원이 6명이라 최대 800개 남짓 — 예산(150,000)에서 0.5%다.
 */
function buildAllyRangeGeo(
  centers: readonly { x: number; z: number }[],
  radius: number,
): THREE.BufferGeometry {
  const dashes = Math.max(12, Math.min(56, Math.round((2 * Math.PI * radius) / ALLY_RANGE_DASH_ARC)));
  const rIn = Math.max(0.02, radius - ALLY_RANGE_BAND);
  const rOut = radius;
  const triCount = (dashes + ALLY_FOOT_SEGS) * 2;
  const out = new Float32Array(centers.length * triCount * 9);
  let off = 0;

  /** 한 칸(반경 rIn~rOut, 각 a0~a1)을 두 삼각형으로 써 넣는다 */
  const quad = (cx: number, cz: number, ri: number, ro: number, a0: number, a1: number): void => {
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const oX0 = cx + ro * c0, oZ0 = cz - ro * s0;
    const oX1 = cx + ro * c1, oZ1 = cz - ro * s1;
    const iX0 = cx + ri * c0, iZ0 = cz - ri * s0;
    const iX1 = cx + ri * c1, iZ1 = cz - ri * s1;
    // (rOut,a0) → (rIn,a1) → (rIn,a0)
    out[off++] = oX0; out[off++] = DECAL_Y; out[off++] = oZ0;
    out[off++] = iX1; out[off++] = DECAL_Y; out[off++] = iZ1;
    out[off++] = iX0; out[off++] = DECAL_Y; out[off++] = iZ0;
    // (rOut,a0) → (rOut,a1) → (rIn,a1)
    out[off++] = oX0; out[off++] = DECAL_Y; out[off++] = oZ0;
    out[off++] = oX1; out[off++] = DECAL_Y; out[off++] = oZ1;
    out[off++] = iX1; out[off++] = DECAL_Y; out[off++] = iZ1;
  };

  const slot = (2 * Math.PI) / dashes;
  const footSlot = (2 * Math.PI) / ALLY_FOOT_SEGS;
  for (const c of centers) {
    for (let i = 0; i < dashes; i++) {
      const a0 = i * slot;
      quad(c.x, c.z, rIn, rOut, a0, a0 + slot * ALLY_RANGE_DUTY);
    }
    // 발밑 링 — 사거리 원만 그리면 **누가 선택됐는지**가 안 읽힌다. 돌팔매꾼은 반경이
    // 2.8이라 원이 저 멀리 있고, 정작 사람 발밑에는 아무 표시도 없게 된다.
    for (let i = 0; i < ALLY_FOOT_SEGS; i++) {
      const a0 = i * footSlot;
      quad(c.x, c.z, ALLY_FOOT_IN, ALLY_FOOT_OUT, a0, a0 + footSlot);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** 소규모 병합 헬퍼 (BufferGeometryUtils 의존 없이 non-indexed 위치만) */
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of geos) total += g.index ? g.index.count : g.getAttribute('position').count;
  const out = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    const pos = g.getAttribute('position');
    const arr = pos.array as Float32Array;
    // 인덱스 지오메트리(CircleGeometry)는 풀어서 복사
    const idx = g.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        const vi = idx.getX(i);
        out[off++] = pos.getX(vi);
        out[off++] = pos.getY(vi);
        out[off++] = pos.getZ(vi);
      }
    } else {
      out.set(arr, off);
      off += arr.length;
    }
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(out.subarray(0, off), 3));
  merged.computeBoundingSphere();
  return merged;
}
