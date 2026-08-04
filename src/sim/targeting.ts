/**
 * 타게팅 — first/last/strongest/nearest + canTargetAir/Ground 필터.
 * first/last는 "기지까지 남은 거리" 기준 (경로 길이가 달라도 일관).
 * 타겟은 고정되며 사거리 이탈/사망 시에만 재조준한다 (battle/attack에서 검증 호출).
 * 적 리스트는 battle이 dist 오름차순 정렬을 유지한다.
 */
import type { TowerDef, TowerState } from '@/data/types';
import { dist2 } from '@/core/mathx';
import { pathFor, type EnemySim, type SimCtx } from './entities';

export function canTarget(def: TowerDef, e: EnemySim): boolean {
  return e.flying ? def.canTargetAir : def.canTargetGround;
}

/** 기지까지 남은 호장 거리 */
export function remainingToBase(ctx: SimCtx, e: EnemySim): number {
  return pathFor(ctx, e).totalLength - e.dist;
}

/** 현재 고정 타겟이 여전히 유효하면 반환, 아니면 null (재조준 필요) */
export function lockedTarget(
  ctx: SimCtx,
  tower: TowerState,
  def: TowerDef,
  range: number,
): EnemySim | null {
  if (tower.targetId < 0) return null;
  const e = ctx.world.findEnemy(tower.targetId);
  if (!e || !e.alive || !canTarget(def, e)) return null;
  if (dist2(tower.cellX, tower.cellZ, e.x, e.z) > range * range) return null;
  return e;
}

/** 모드에 따라 사거리 내 최적 타겟 선택 (동점은 낮은 id — 결정론 보장) */
export function selectTarget(
  ctx: SimCtx,
  tower: TowerState,
  def: TowerDef,
  range: number,
): EnemySim | null {
  const r2 = range * range;
  let best: EnemySim | null = null;
  let bestKey = -Infinity;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive || !canTarget(def, e)) continue;
    const d2 = dist2(tower.cellX, tower.cellZ, e.x, e.z);
    if (d2 > r2) continue;
    let key: number;
    switch (tower.targeting) {
      case 'first':
        key = -remainingToBase(ctx, e);
        break;
      case 'last':
        key = remainingToBase(ctx, e);
        break;
      case 'strongest':
        key = e.hp;
        break;
      case 'nearest':
        key = -d2;
        break;
    }
    if (!best || key > bestKey || (key === bestKey && e.id < best.id)) {
      best = e;
      bestKey = key;
    }
  }
  return best;
}
