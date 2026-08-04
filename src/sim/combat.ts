/**
 * 데미지 파이프라인 — 방패 소진(피해 무효) → armor 고정 감산(최소 1) → hp 감소
 * → 사망 시 bounty 골드. 기지 누수는 baseDamaged로 이어진다.
 * 상태이상 부여는 attack/status 쪽에서 담당 (순환 임포트 방지).
 */
import type { StatusKind, TowerId } from '@/data/types';
import type { EnemySim, SimCtx } from './entities';

export function addGold(ctx: SimCtx, delta: number): void {
  ctx.view.gold += delta;
  ctx.events.push({ type: 'goldChanged', gold: ctx.view.gold, delta });
}

/**
 * 피해 적용. 반환값 = 실제 피해량 (방패에 막히면 0).
 * ignoreArmor는 poison DoT 전용 (armor 무시).
 */
export function damageEnemy(
  ctx: SimCtx,
  e: EnemySim,
  amount: number,
  source: TowerId | StatusKind,
  ignoreArmor = false,
): number {
  if (!e.alive) return 0;
  if (e.shieldHitsLeft > 0) {
    e.shieldHitsLeft--;
    ctx.events.push({
      type: 'enemyDamaged',
      enemyId: e.id,
      amount: 0,
      x: e.x,
      z: e.z,
      source,
      shielded: true,
    });
    return 0;
  }
  const dealt = ignoreArmor ? amount : Math.max(1, amount - e.def.armor);
  e.hp -= dealt;
  ctx.events.push({
    type: 'enemyDamaged',
    enemyId: e.id,
    amount: dealt,
    x: e.x,
    z: e.z,
    source,
    shielded: false,
  });
  if (e.hp <= 0) {
    e.alive = false;
    addGold(ctx, e.bounty);
    ctx.events.push({
      type: 'enemyDied',
      enemyId: e.id,
      defId: e.defId,
      x: e.x,
      z: e.z,
      bounty: e.bounty,
      maxHp: e.maxHp,
    });
  }
  return dealt;
}

/** 기지 도달 — 사망 이벤트 없이 제거 표시, 기지 피해. 패배 판정은 battle.checkEnd에서. */
export function leakEnemy(ctx: SimCtx, e: EnemySim): void {
  if (!e.alive) return;
  e.alive = false;
  ctx.events.push({ type: 'enemyLeaked', enemyId: e.id, defId: e.defId, baseDamage: e.baseDamage });
  ctx.view.baseHp = Math.max(0, ctx.view.baseHp - e.baseDamage);
  ctx.events.push({ type: 'baseDamaged', amount: e.baseDamage, hpLeft: ctx.view.baseHp });
}
