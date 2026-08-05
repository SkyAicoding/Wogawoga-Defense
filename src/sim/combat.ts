/**
 * 데미지 파이프라인 — 방패 소진(피해 무효) → armor 고정 감산(최소 1) → hp 감소
 * → 사망 시 bounty 골드. 기지 누수는 baseDamaged로 이어진다.
 * 타워 피해(적 부족의 공격)도 여기 있다 — 감쇠/방어 없이 정수 피해가 그대로 들어간다.
 * 상태이상 부여는 attack/status 쪽에서 담당 (순환 임포트 방지).
 */
import type { StatusKind, TowerId, TowerState } from '@/data/types';
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

/**
 * 타워 피해 — 적 부족의 타격. 반환값 = 실제로 깎인 체력.
 * hp가 0 이하가 되면 towerDestroyed를 즉시 발행하지만 **리스트에서 빼지는 않는다**
 * (순회 중 제거 금지). 실제 회수는 같은 틱의 siege.sweepDestroyedTowers가 한다.
 * 감쇠·방어·확률이 없는 이유: 타워는 움직이지 않는 고정 표적이라 명중/회피 개념이 없고,
 * "몇 초 버티는가"가 곧 밸런스 손잡이여서 계산이 눈에 보여야 한다.
 */
export function damageTower(
  ctx: SimCtx,
  t: TowerState,
  amount: number,
  attacker: EnemySim,
  ranged: boolean,
): number {
  if (t.hp <= 0) return 0; // 이미 이번 틱에 부서짐 — 오버킬은 무시
  const dealt = Math.max(1, Math.round(amount));
  t.hp -= dealt;
  ctx.events.push({
    type: 'towerDamaged',
    towerId: t.id,
    defId: t.defId,
    cellX: t.cellX,
    cellZ: t.cellZ,
    amount: dealt,
    hpLeft: Math.max(0, t.hp),
    maxHp: t.maxHp,
    attackerId: attacker.id,
    attackerDefId: attacker.defId,
    attackerX: attacker.x,
    attackerZ: attacker.z,
    ranged,
  });
  if (t.hp <= 0) {
    t.hp = 0;
    ctx.events.push({
      type: 'towerDestroyed',
      towerId: t.id,
      defId: t.defId,
      cellX: t.cellX,
      cellZ: t.cellZ,
      tier: t.tier,
      killerId: attacker.id,
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
