/**
 * 지면 데칼 — 사거리 링, 슬롯 하이라이트, 경로 셰브런.
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

    this.disposables.push(
      fillGeo, edgeGeo, softGeo, fillMat, edgeMat, softMat,
      this.slotMat, this.chevronMat, markerGeo, this.markerMat,
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
        geos.push(buildMarkerGeo(v));
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
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.slots?.geometry.dispose();
    this.chevrons?.geometry.dispose();
    this.sortieGeo?.dispose();
    this.sortieGeo = null;
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
