/**
 * 그리드 공유 유틸 — sim과 render가 동일한 경로 셀/건설 가능/소품 셀 판정을
 * 쓰도록 단일화. (three/DOM 의존 없음)
 */
import { Rng, hashSeed } from '@/core/rng';
import type { StageDef, Vec2 } from './types';

export function cellKey(stage: StageDef, x: number, z: number): number {
  return z * stage.gridW + x;
}

export function charAt(stage: StageDef, x: number, z: number): string {
  if (x < 0 || x >= stage.gridW || z < 0 || z >= stage.gridH) return '~';
  const row = stage.layout[z];
  return row ? (row[x] ?? '~') : '~';
}

/** paths(+airPaths 제외) 웨이포인트를 0.25 간격 샘플링해 지나는 셀 집합 */
export function rasterizePathCells(stage: StageDef): Set<number> {
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

/**
 * 건설 가능 셀 — 지상('.'/'o')이면서 경로가 아닌 곳.
 * 자유 배치: 미리 정한 슬롯이 아니어도 빈 땅이면 어디든 지을 수 있다.
 */
export function isBuildableCell(
  stage: StageDef,
  pathCells: ReadonlySet<number>,
  x: number,
  z: number,
): boolean {
  if (x < 0 || x >= stage.gridW || z < 0 || z >= stage.gridH) return false;
  const ch = charAt(stage, x, z);
  if (ch !== '.' && ch !== 'o') return false;
  return !pathCells.has(cellKey(stage, x, z));
}

/** 스테이지의 모든 건설 가능 셀 목록 (소품 미고려 — sceneryCells로 추가 제외) */
export function buildableCells(stage: StageDef, pathCells: ReadonlySet<number>): Vec2[] {
  const out: Vec2[] = [];
  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      if (isBuildableCell(stage, pathCells, x, z)) out.push({ x, z });
    }
  }
  return out;
}

/** 소품 산포 밀도 (건설 가능 셀 대비) */
export const SCENERY_DENSITY = 0.3;

/**
 * 소품(나무/바위 등)이 놓이는 셀 — 시드 고정이라 sim/render가 항상 일치한다.
 * 이 셀에는 타워를 지을 수 없고, 렌더는 정확히 이 셀에만 큰 소품을 배치한다.
 */
export function sceneryCells(stage: StageDef, pathCells: ReadonlySet<number>): Set<number> {
  const rng = new Rng(hashSeed(`scenery:${stage.id}`));
  const out = new Set<number>();
  for (const c of buildableCells(stage, pathCells)) {
    if (rng.chance(SCENERY_DENSITY)) out.add(cellKey(stage, c.x, c.z));
  }
  return out;
}
