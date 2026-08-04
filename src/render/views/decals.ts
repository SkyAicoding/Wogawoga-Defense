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
  private chevrons: THREE.Mesh | null = null;
  private chevronMat: THREE.MeshBasicMaterial;
  private chevronPulse = 0;
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
    this.disposables.push(fillGeo, edgeGeo, softGeo, fillMat, edgeMat, softMat, this.slotMat, this.chevronMat);
  }

  /** 스테이지 데이터 준비 — 슬롯 위치/경로에 종속된 정적 데칼 생성 */
  init(slotCells: readonly Vec2[], paths: readonly Vec2[][]): void {
    // 슬롯 하이라이트: 병합된 디스크들 (배치 모드에서만 표시)
    const slotGeos: THREE.BufferGeometry[] = [];
    const v = new THREE.Vector3();
    for (const cell of slotCells) {
      const g = new THREE.CircleGeometry(0.34, 20);
      g.rotateX(-Math.PI / 2);
      this.cellToWorld(cell.x, cell.z, v);
      g.translate(v.x, DECAL_Y + 0.06, v.z);
      slotGeos.push(g);
    }
    if (slotGeos.length > 0) {
      const merged = mergeGeos(slotGeos);
      this.slots = new THREE.Mesh(merged, this.slotMat);
      this.slots.renderOrder = 2;
      this.slots.visible = false;
      this.group.add(this.slots);
      this.disposables.push(merged);
    }

    // 경로 셰브런: 1.1 간격으로 진행방향 삼각형
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
      const merged = mergeGeos(chevGeos);
      this.chevrons = new THREE.Mesh(merged, this.chevronMat);
      this.chevrons.renderOrder = 2;
      this.group.add(this.chevrons);
      this.disposables.push(merged);
    }
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
    // 슬롯 하이라이트 호흡
    if (this.slots?.visible) {
      this.slotMat.opacity = 0.4 + Math.sin(this.time * 5) * 0.18;
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
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
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
