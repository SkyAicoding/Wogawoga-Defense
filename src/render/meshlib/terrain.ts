/**
 * 스테이지 지형 빌더.
 * layout 파싱 + paths 래스터라이즈 → 타일 상면/절벽 스커트/슬롯 패드를
 * 정적 병합 지오메트리 ≤3개로 구성. 그리드 중심 = 월드 원점, 타일 상면 y=0.
 */
import * as THREE from 'three';
import type { StageDef, Vec2 } from '@/data/types';
import { Rng, hashSeed } from '@/core/rng';
import { BIOMES } from '../palette';
import { flatMat } from '../palette';
import { buildParts, type PartSpec } from './factory';

export type CellToWorld = (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3;

export interface TerrainBuild {
  group: THREE.Group;
  cellToWorld: CellToWorld;
  aabb: THREE.Box3;
  /** 경로로 마킹된 셀 (key = z*gridW + x) */
  pathCells: Set<number>;
  /** 건설 슬롯 셀 목록 */
  slotCells: Vec2[];
  /** 소품 산포 가능한 빈 지상 셀 */
  freeCells: Vec2[];
  isGround(x: number, z: number): boolean;
  dispose(): void;
}

const TILE_H = 0.55;

/** paths 웨이포인트를 0.25 간격 샘플링해 지나는 셀을 마킹 */
export function rasterizePaths(stage: StageDef): Set<number> {
  const cells = new Set<number>();
  const mark = (x: number, z: number): void => {
    const cx = Math.round(x);
    const cz = Math.round(z);
    if (cx >= 0 && cx < stage.gridW && cz >= 0 && cz < stage.gridH) {
      cells.add(cz * stage.gridW + cx);
    }
  };
  for (const path of stage.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i] as Vec2;
      const b = path[i + 1] as Vec2;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / 0.25));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        mark(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      }
    }
  }
  return cells;
}

function charAt(stage: StageDef, x: number, z: number): string {
  if (x < 0 || x >= stage.gridW || z < 0 || z >= stage.gridH) return '~';
  const row = stage.layout[z];
  return row ? (row[x] ?? '~') : '~';
}

export function buildStage(stage: StageDef): TerrainBuild {
  const pal = BIOMES[stage.biome];
  const rng = new Rng(hashSeed(`terrain:${stage.id}`));
  const pathCells = rasterizePaths(stage);
  const slotCells: Vec2[] = [];
  const freeCells: Vec2[] = [];
  const halfW = (stage.gridW - 1) / 2;
  const halfH = (stage.gridH - 1) / 2;

  const cellToWorld: CellToWorld = (x, z, out) => {
    const v = out ?? new THREE.Vector3();
    return v.set(x - halfW, 0, z - halfH);
  };

  const tiles: PartSpec[] = [];
  const pads: PartSpec[] = [];
  const cliffTop = pal.cliff[0];
  const cliffBot = pal.cliff[1];
  const cTop = new THREE.Color(cliffTop);
  const cBot = new THREE.Color(cliffBot);
  const cTmp = new THREE.Color();

  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      const ch = charAt(stage, x, z);
      if (ch === '~') continue; // 물/공허 = 구멍
      const wx = x - halfW;
      const wz = z - halfH;
      const isPath = pathCells.has(z * stage.gridW + x);
      const ramp = isPath ? pal.path : pal.ground;
      const color = ramp[rng.int(0, ramp.length - 1)] ?? ramp[0] ?? 0x808080;
      const hJit = isPath ? 0 : rng.range(-0.015, 0.02); // 경로는 평탄하게
      // 타일 상면 박스 (상면 y≈0)
      tiles.push({
        kind: 'box',
        pos: [wx, -TILE_H / 2 + hJit, wz],
        scale: [1.001, TILE_H, 1.001],
        color,
        hueJitter: 0.008,
      });

      // 절벽 스커트: 물/그리드 밖과 접한 면이 있으면 아래로 2~3단
      const exposed =
        charAt(stage, x - 1, z) === '~' ||
        charAt(stage, x + 1, z) === '~' ||
        charAt(stage, x, z - 1) === '~' ||
        charAt(stage, x, z + 1) === '~';
      if (exposed) {
        const layers = rng.int(2, 3);
        let y = -TILE_H;
        for (let l = 0; l < layers; l++) {
          const h = rng.range(0.55, 0.95) * (1 + l * 0.25);
          const t = (l + 1) / layers;
          cTmp.copy(cTop).lerp(cBot, t);
          const inset = 0.02 + l * 0.09 + rng.range(0, 0.05);
          tiles.push({
            kind: 'box',
            pos: [wx + rng.range(-0.03, 0.03), y - h / 2, wz + rng.range(-0.03, 0.03)],
            scale: [1 - inset, h, 1 - inset],
            color: cTmp.getHex(),
            hueJitter: 0.01,
          });
          y -= h;
        }
      }

      if (ch === 'o') {
        slotCells.push({ x, z });
        // 슬롯 패드: 살짝 돌출된 원형 받침
        pads.push({
          kind: 'cyl',
          pos: [wx, 0.045, wz],
          scale: [0.86, 0.09, 0.86],
          color: 0xb9ab8e,
          seg: 8,
          hueJitter: 0.01,
        });
        pads.push({
          kind: 'cyl',
          pos: [wx, 0.085, wz],
          scale: [0.7, 0.05, 0.7],
          color: 0xcec19f,
          seg: 8,
        });
      } else if (ch === '#') {
        // 바위 장식 (건설 불가) — 타일 지오메트리에 병합
        const n = rng.int(1, 2);
        for (let i = 0; i < n; i++) {
          tiles.push({
            kind: 'ico',
            pos: [wx + rng.range(-0.22, 0.22), rng.range(0.1, 0.2), wz + rng.range(-0.22, 0.22)],
            rot: [rng.range(0, 3), rng.range(0, 3), 0],
            scale: rng.range(0.3, 0.55),
            color: cliffTop,
            hueJitter: 0.012,
          });
        }
      } else if (ch === '.' && !isPath) {
        freeCells.push({ x, z });
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'terrain';
  // 병합 지오메트리 1: 타일 + 절벽 + 바위 (AO는 절벽 하단 어둡게)
  const tileGeo = buildParts(tiles, { seed: hashSeed(`tiles:${stage.id}`), ao: 0.22, faceJitter: 0.03 });
  const tileMesh = new THREE.Mesh(tileGeo, flatMat());
  tileMesh.receiveShadow = true;
  tileMesh.castShadow = true;
  group.add(tileMesh);
  // 병합 지오메트리 2: 슬롯 패드
  let padGeo: THREE.BufferGeometry | null = null;
  if (pads.length > 0) {
    padGeo = buildParts(pads, { seed: 7, ao: 0, faceJitter: 0.02 });
    const padMesh = new THREE.Mesh(padGeo, flatMat());
    padMesh.receiveShadow = true;
    group.add(padMesh);
  }

  // 프레이밍용 AABB — y를 얕게 잡아 카메라 fit이 지면 위주로 되게 한다
  const aabb = new THREE.Box3(
    new THREE.Vector3(-halfW - 0.5, -0.25, -halfH - 0.5),
    new THREE.Vector3(halfW + 0.5, 0.75, halfH + 0.5),
  );

  return {
    group,
    cellToWorld,
    aabb,
    pathCells,
    slotCells,
    freeCells,
    isGround: (x, z) => charAt(stage, x, z) !== '~',
    dispose: () => {
      tileGeo.dispose();
      padGeo?.dispose();
    },
  };
}

/** 경로 폴리라인의 누적 호장 테이블 — 셰브런/랩 데모용 공용 헬퍼 */
export function pathArcTable(path: readonly Vec2[]): { pts: Vec2[]; cum: number[]; total: number } {
  const pts = path.slice();
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    total += Math.hypot(b.x - a.x, b.z - a.z);
    cum.push(total);
  }
  return { pts, cum, total };
}

/** 호장 거리 → 경로상 위치/방향 샘플 */
export function samplePath(
  table: { pts: Vec2[]; cum: number[]; total: number },
  dist: number,
  out: { x: number; z: number; heading: number },
): void {
  const { pts, cum, total } = table;
  const d = Math.max(0, Math.min(dist, total));
  let i = 1;
  while (i < cum.length - 1 && (cum[i] as number) < d) i++;
  const a = pts[i - 1] as Vec2;
  const b = pts[i] as Vec2;
  const c0 = cum[i - 1] as number;
  const c1 = cum[i] as number;
  const t = c1 > c0 ? (d - c0) / (c1 - c0) : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.heading = Math.atan2(b.z - a.z, b.x - a.x);
}
