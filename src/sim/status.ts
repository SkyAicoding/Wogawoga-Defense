/**
 * 상태이상 — slow(최대 magnitude 우선)/burn·poison(소스(타워 id)별 스택: 같은 소스 재적용은
 * 자기 스택 갱신, 다른 소스는 새 스택, kind당 최대 3스택 — 초과 시 가장 오래된 것 교체)/
 * stun(보스는 지속 1/5 + 종료 후 60틱 면역). DoT는 인스턴스별 acc가 STATUS_TICK_INTERVAL에
 * 도달할 때마다 적용되며 poison은 armor를 무시한다.
 */
import { STATUS_TICK_INTERVAL } from '@/data/types';
import type { StatusApplySpec, StatusInstance } from '@/data/types';
import { dist2 } from '@/core/mathx';
import { damageEnemy } from './combat';
import type { EnemySim, SimCtx } from './entities';

const MAX_DOT_STACKS = 3;
const BOSS_STUN_DIVISOR = 5;
const BOSS_STUN_IMMUNE_TICKS = 60;

/**
 * 확률 판정 포함 상태 부여. 성공 시 statusApplied 이벤트.
 * sourceId = 부여한 타워 id — burn/poison은 소스별 스택 (다중 타워 유효화).
 * sourceId 미지정 적용은 항상 새 스택으로 취급한다.
 */
export function tryApplyStatus(
  ctx: SimCtx,
  e: EnemySim,
  spec: StatusApplySpec,
  sourceId?: number,
): boolean {
  if (!e.alive) return false;
  if (spec.chance < 1 && !ctx.rng.chance(spec.chance)) return false;
  let applied = false;
  const st = e.statuses;
  if (spec.kind === 'slow') {
    let cur: StatusInstance | null = null;
    for (const s of st) if (s.kind === 'slow') cur = s;
    if (!cur) {
      st.push({ kind: 'slow', magnitude: spec.magnitude, remainingTicks: spec.durationTicks, acc: 0 });
      applied = true;
    } else if (spec.magnitude > cur.magnitude) {
      cur.magnitude = spec.magnitude;
      cur.remainingTicks = spec.durationTicks;
      applied = true;
    } else if (spec.magnitude === cur.magnitude) {
      cur.remainingTicks = Math.max(cur.remainingTicks, spec.durationTicks); // 지속 갱신
      applied = true;
    } // 더 약한 감속은 무시
  } else if (spec.kind === 'burn' || spec.kind === 'poison') {
    // 소스별 스택 — 같은 소스는 자기 스택 갱신, 다른 소스는 새 스택 (kind당 최대 3)
    let count = 0;
    let own: StatusInstance | null = null;
    let oldest: StatusInstance | null = null;
    for (const s of st) {
      if (s.kind !== spec.kind) continue;
      count++;
      if (sourceId !== undefined && s.sourceId === sourceId) own = s;
      if (!oldest || s.remainingTicks < oldest.remainingTicks) oldest = s;
    }
    if (own) {
      // 같은 소스 재적용 — 갱신 (acc 유지: DoT 리듬은 끊기지 않는다)
      own.magnitude = spec.magnitude;
      own.remainingTicks = spec.durationTicks;
    } else if (count < MAX_DOT_STACKS) {
      st.push({
        kind: spec.kind,
        magnitude: spec.magnitude,
        remainingTicks: spec.durationTicks,
        acc: 0,
        sourceId,
      });
    } else if (oldest) {
      // 캡 초과 — 가장 오래된(잔여 최소) 스택을 새 소스로 교체
      oldest.magnitude = spec.magnitude;
      oldest.remainingTicks = spec.durationTicks;
      oldest.acc = 0;
      oldest.sourceId = sourceId;
    }
    applied = true;
  } else {
    // stun — 보스 저항: 지속 1/5, 종료 후 면역
    if (e.def.boss && ctx.view.tick < e.stunImmuneUntil) return false;
    const dur = e.def.boss
      ? Math.max(1, Math.floor(spec.durationTicks / BOSS_STUN_DIVISOR))
      : spec.durationTicks;
    let cur: StatusInstance | null = null;
    for (const s of st) if (s.kind === 'stun') cur = s;
    if (cur) cur.remainingTicks = Math.max(cur.remainingTicks, dur);
    else st.push({ kind: 'stun', magnitude: 0, remainingTicks: dur, acc: 0 });
    applied = true;
  }
  if (applied) ctx.events.push({ type: 'statusApplied', enemyId: e.id, kind: spec.kind });
  return applied;
}

export function isStunned(e: EnemySim): boolean {
  for (const s of e.statuses) if (s.kind === 'stun') return true;
  return false;
}

/** 감속 배율 (1 = 정상). slow는 단일 인스턴스 유지라 첫 매치만 본다. */
export function slowFactor(e: EnemySim): number {
  for (const s of e.statuses) if (s.kind === 'slow') return 1 - s.magnitude;
  return 1;
}

/** 현재 유효 이동 속도 (타일/초): 스턴 0, 격노/감속 반영 */
export function effectiveSpeed(e: EnemySim): number {
  if (isStunned(e)) return 0;
  let sp = e.def.speed;
  const enrage = e.def.enrage;
  if (enrage && e.hp <= e.maxHp * enrage.hpPct) sp *= enrage.speedMul;
  return sp * slowFactor(e);
}

/** 매 틱: DoT 누적/적용 + 만료 제거 (+보스 스턴 면역 시작) */
export function tickEnemyStatuses(ctx: SimCtx, e: EnemySim): void {
  const st = e.statuses;
  for (let i = st.length - 1; i >= 0; i--) {
    const s = st[i] as StatusInstance;
    if (s.kind === 'burn' || s.kind === 'poison') {
      s.acc++;
      if (s.acc >= STATUS_TICK_INTERVAL) {
        s.acc = 0;
        damageEnemy(ctx, e, s.magnitude, s.kind, s.kind === 'poison');
        if (!e.alive) return; // DoT로 사망 — 나머지는 의미 없음
      }
    }
    s.remainingTicks--;
    if (s.remainingTicks <= 0) {
      if (s.kind === 'stun' && e.def.boss) {
        e.stunImmuneUntil = ctx.view.tick + BOSS_STUN_IMMUNE_TICKS;
      }
      st.splice(i, 1); // 역순 순회라 안전
    }
  }
}

/**
 * **재충전형 방패** — 매 틱 호출(`EnemyDef.shieldRecharge`).
 *
 * 규칙: 잔량이 최대 미만이면 카운트다운이 돌고, 0에 닿으면 **1장** 회복하고 재장전한다.
 * 상한은 `def.shieldHits`. 곧 긴 교전에서 이 적은 `shieldRecharge` 틱마다 정확히 한 발을
 * 무효화하므로 차단율 = **발사 간격 ÷ 재충전**이다 (types.ts 의 유도·역산 참조).
 *
 * ⚠ `ctx.rng` 를 **쓰지 않는다.** rng 스트림을 한 칸도 안 밀어야 이 변경이 없는 판
 * (스테이지1 — warrior 가 없다)의 봉투가 비트 단위로 같게 유지된다.
 */
export function tickShields(ctx: SimCtx, e: EnemySim): void {
  const rate = e.def.shieldRecharge;
  if (rate === undefined) return;
  const max = e.def.shieldHits ?? 0;
  if (e.shieldHitsLeft >= max) {
    // 가득 차 있으면 타이머는 안 돈다 — 다음에 깎이는 순간 rate 부터 새로 센다
    e.shieldRechargeLeft = 0;
    return;
  }
  if (e.shieldRechargeLeft <= 0) e.shieldRechargeLeft = rate;
  e.shieldRechargeLeft--;
  if (e.shieldRechargeLeft <= 0) {
    e.shieldHitsLeft++;
    e.shieldRechargeLeft = e.shieldHitsLeft >= max ? 0 : rate;
  }
}

/**
 * **정화 오라** ✧ — STATUS_TICK_INTERVAL 경계마다 호출(`EnemyDef.purge`).
 * `processHealAuras` 의 이중 루프를 그대로 따른다 — 반경/alive/스턴/자기 제외까지 같다.
 *
 * 벗기는 스택은 `statuses[0]` = **가장 오래 걸린 것**부터다. 근거는 types.ts 의 purge 주석.
 * stun 을 벗길 때는 만료와 **똑같이** 보스 면역을 건다 — 안 그러면 적 편 능력인 정화가
 * 보스를 즉시 재스턴 가능하게 만들어 플레이어를 돕는다.
 */
export function processPurgeAuras(ctx: SimCtx): void {
  const items = ctx.world.enemies.items;
  for (let i = 0; i < items.length; i++) {
    const caster = items[i] as EnemySim;
    if (!caster.alive) continue;
    const aura = caster.def.purge;
    if (!aura || isStunned(caster)) continue;
    const r2 = aura.radius * aura.radius;
    for (let j = 0; j < items.length; j++) {
      if (j === i) continue;
      const ally = items[j] as EnemySim;
      if (!ally.alive || ally.statuses.length === 0) continue;
      if (dist2(caster.x, caster.z, ally.x, ally.z) > r2) continue;
      for (let k = 0; k < aura.stacksPerTick && ally.statuses.length > 0; k++) {
        const s = ally.statuses.shift() as StatusInstance;
        if (s.kind === 'stun' && ally.def.boss) {
          ally.stunImmuneUntil = ctx.view.tick + BOSS_STUN_IMMUNE_TICKS;
        }
        ctx.events.push({ type: 'statusPurged', enemyId: ally.id, kind: s.kind });
      }
    }
  }
}

/**
 * 주술사 힐 오라 — STATUS_TICK_INTERVAL 경계마다 호출. 회복은 이벤트 없이 hp만 (자신 제외).
 * 회복량은 시전자의 hpMul로 스케일 — 중후반 웨이브에서도 힐러 메커니크가 유효하다.
 */
export function processHealAuras(ctx: SimCtx): void {
  const items = ctx.world.enemies.items;
  for (let i = 0; i < items.length; i++) {
    const healer = items[i] as EnemySim;
    if (!healer.alive) continue;
    const aura = healer.def.healAura;
    if (!aura || isStunned(healer)) continue;
    const heal = aura.hpPerStatusTick * healer.hpMul;
    const r2 = aura.radius * aura.radius;
    for (let j = 0; j < items.length; j++) {
      if (j === i) continue;
      const ally = items[j] as EnemySim;
      if (!ally.alive || ally.hp >= ally.maxHp) continue;
      if (dist2(healer.x, healer.z, ally.x, ally.z) > r2) continue;
      // ⚠ **여기서 살점 값의 지급 이력(`ally.bountyPaid`)을 절대 건드리지 마라.**
      // 회복은 hp만 올린다. 지급은 `floor(bounty × k / K) − bountyPaid`이고 bountyPaid는
      // 단조 증가라, 되살린 체력을 다시 깎아도 **예전 최저점 아래로 내려가기 전까지**
      // 골드가 한 톨도 안 나간다. 이 줄이 bountyPaid를 되돌리거나 지급 기준이 "누적
      // 피해량"으로 바뀌는 순간, 주술사 옆의 적을 반복해 때려 **골드를 무한 파밍**할 수 있다.
      // 회귀 테스트는 반드시 스테이지3~6에서 해야 한다 — shaman 등장 웨이브 수 실측:
      // s1 **0** · s2 **0** · s3 6 · s4 3 · s5 5 · s6 4. 스테이지1 봉투는 이걸 절대 못 잡는다.
      ally.hp = Math.min(ally.maxHp, ally.hp + heal);
    }
  }
}
