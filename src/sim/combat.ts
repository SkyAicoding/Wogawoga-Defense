/**
 * 데미지 파이프라인 — 방패 소진(피해 무효) → 흩어짐 비율 감산(폭발 한정) → armor 고정
 * 감산(최소 1) → 가죽 타격당 상한(최소 1) → hp 감소
 * → 사망 시 bounty 골드. 기지 누수는 baseDamaged로 이어진다.
 * 타워 피해(적 부족의 공격)도 여기 있다 — 감쇠/방어 없이 정수 피해가 그대로 들어간다.
 * 상태이상 부여는 attack/status 쪽에서 담당 (순환 임포트 방지).
 */
import type { AllyId, HometownSourceId, StatusKind, TowerId, TowerState } from '@/data/types';
import { MITIGATED_MIN_SHARE, hideCapFor } from '@/data/balance';
import type { AllySim, EnemySim, SimCtx } from './entities';

export function addGold(ctx: SimCtx, delta: number): void {
  ctx.view.gold += delta;
  ctx.events.push({ type: 'goldChanged', gold: ctx.view.gold, delta });
}

/**
 * 급소가 열려 있는가 — **지금 이 적을 붙잡고 있는 아군이 `sunder`인가**.
 *
 * 붙잡힘(`blockerAllyId`)은 매 틱 `updateAllies`가 처음에 전부 지우고 다시 채우므로
 * 이 판정은 "이번 틱에 실제로 발이 묶여 있다"와 정확히 같다 — 곧 파수꾼이 죽거나
 * 수명이 다해 사라지면 같은 틱에 가죽이 다시 닫힌다. 상태를 새로 들고 있지 않으므로
 * `hash()`에 넣을 것도 없다(`blockerAllyId`는 이미 들어 있다).
 */
function isSundered(ctx: SimCtx, e: EnemySim): boolean {
  if (e.blockerAllyId < 0) return false;
  return ctx.world.findAlly(e.blockerAllyId)?.def.sunder === true;
}

/**
 * 피해 적용. 반환값 = 실제 피해량 (방패에 막히면 0).
 * ignoreArmor는 poison DoT 전용 (armor 무시).
 * splash는 **폭발 부가 피해 전용**(attack.applyArea 한 곳) — 흩어짐〽이 여기에만 걸린다.
 *
 * ── 세 감산의 순서와 그 이유 (docs/counter-plan.md 2단계) ────────────────────
 *  0. 방패 — 최우선. 아예 "맞지 않은" 것이라 뒤의 계산이 존재하지 않는다.
 *  1. 흩어짐 〽 — 폭발이면 먼저 비율로 깎는다. **감산 전**이라야 armor와 곱셈이 아니라
 *     덧셈으로 겹치지 않는다(둘 다 곱셈이면 작은 타격이 두 번 벌받아 0으로 눌린다).
 *  2. 장갑 🛡 — 고정 감산, 최소 1. **작은 타격**을 벌한다.
 *  3. 가죽 🟫 — 타격당 상한, 최소 1. **큰 한 방**을 벌한다. armor의 거울이라 마지막이다:
 *     상한은 "얼마가 들어오든 이 이상은 안 된다"이므로 모든 감산 뒤에 걸려야 뜻이 산다.
 *     단계 3부터 **파수꾼이 붙잡은 적에게는 이 상한이 없다**(isSundered) — 아군이 타워
 *     화력의 곱셈 인자가 되는 유일한 자리다.
 */
export function damageEnemy(
  ctx: SimCtx,
  e: EnemySim,
  amount: number,
  source: TowerId | StatusKind | AllyId | HometownSourceId,
  ignoreArmor = false,
  splash = false,
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
  const resist = splash ? (e.def.splashResist ?? 0) : 0;
  const raw = resist > 0 ? amount * (1 - resist) : amount;
  const afterArmor = ignoreArmor ? raw : Math.max(1, raw - e.def.armor);
  // 가죽 — 대상별 상한. maxHp 비율이라 티어를 올려도 최소 타격 횟수가 그대로다.
  // 급소 열기 🟫🔓 — 붙잡은 아군이 sunder면 그 적에게는 상한이 없다 (단계 3).
  const cap =
    e.def.hide !== undefined && !isSundered(ctx, e) ? hideCapFor(e.maxHp, e.def.hide) : Infinity;
  const dealt = Math.min(afterArmor, cap);
  // 축별로 못 넣은 몫. ignoreArmor면 afterArmor === raw라 lostArmor가 저절로 0이 된다
  const lostSplash = amount - raw;
  const lostArmor = raw - afterArmor;
  const lostHide = afterArmor - dealt;
  // 가장 크게 깎은 축 하나만 — 그리고 그 손실이 **눈에 띌 때만** 싣는다
  const worst = Math.max(lostHide, lostArmor, lostSplash);
  let mitigated: 'armor' | 'hide' | 'splash' | undefined;
  if (worst > 0 && worst / (dealt + worst) >= MITIGATED_MIN_SHARE) {
    mitigated =
      lostHide >= lostArmor && lostHide >= lostSplash
        ? 'hide'
        : lostArmor >= lostSplash
          ? 'armor'
          : 'splash';
  }
  e.hp -= dealt;
  ctx.events.push({
    type: 'enemyDamaged',
    enemyId: e.id,
    amount: dealt,
    x: e.x,
    z: e.z,
    source,
    shielded: false,
    ...(mitigated ? { mitigated } : {}),
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

/**
 * 아군 피해 — 발이 묶인 적의 난투 반격. 반환값 = 실제로 깎인 체력.
 * 적과 같은 armor 규칙(고정 감산, 최소 1)을 쓴다 — 두 진영의 계산이 다르면
 * 화면에 뜨는 숫자를 서로 비교할 수 없어진다.
 * 사망해도 **여기서 리스트에서 빼지 않는다**(순회 중 제거 금지) — 회수는 battle의 사망 처리.
 */
export function damageAlly(ctx: SimCtx, a: AllySim, amount: number, attacker: EnemySim): number {
  if (!a.alive) return 0;
  const dealt = Math.max(1, Math.round(amount) - a.def.armor);
  a.hp -= dealt;
  ctx.events.push({
    type: 'allyDamaged',
    allyId: a.id,
    defId: a.defId,
    amount: dealt,
    hpLeft: Math.max(0, a.hp),
    maxHp: a.maxHp,
    x: a.x,
    z: a.z,
    attackerId: attacker.id,
    attackerDefId: attacker.defId,
  });
  if (a.hp <= 0) {
    a.hp = 0;
    a.alive = false;
    ctx.events.push({ type: 'allyDied', allyId: a.id, defId: a.defId, x: a.x, z: a.z });
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
