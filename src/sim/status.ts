/**
 * 상태이상 — slow(최대 magnitude 우선)/burn·poison(3스택, 초과 시 가장 오래된 것 갱신)/
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

/** 확률 판정 포함 상태 부여. 성공 시 statusApplied 이벤트. */
export function tryApplyStatus(ctx: SimCtx, e: EnemySim, spec: StatusApplySpec): boolean {
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
    let count = 0;
    let oldest: StatusInstance | null = null;
    for (const s of st) {
      if (s.kind !== spec.kind) continue;
      count++;
      if (!oldest || s.remainingTicks < oldest.remainingTicks) oldest = s;
    }
    if (count < MAX_DOT_STACKS) {
      st.push({ kind: spec.kind, magnitude: spec.magnitude, remainingTicks: spec.durationTicks, acc: 0 });
    } else if (oldest) {
      oldest.magnitude = spec.magnitude;
      oldest.remainingTicks = spec.durationTicks;
      oldest.acc = 0;
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

/** 주술사 힐 오라 — STATUS_TICK_INTERVAL 경계마다 호출. 회복은 이벤트 없이 hp만 (자신 제외). */
export function processHealAuras(ctx: SimCtx): void {
  const items = ctx.world.enemies.items;
  for (let i = 0; i < items.length; i++) {
    const healer = items[i] as EnemySim;
    if (!healer.alive) continue;
    const aura = healer.def.healAura;
    if (!aura || isStunned(healer)) continue;
    const r2 = aura.radius * aura.radius;
    for (let j = 0; j < items.length; j++) {
      if (j === i) continue;
      const ally = items[j] as EnemySim;
      if (!ally.alive || ally.hp >= ally.maxHp) continue;
      if (dist2(healer.x, healer.z, ally.x, ally.z) > r2) continue;
      ally.hp = Math.min(ally.maxHp, ally.hp + aura.hpPerStatusTick);
    }
  }
}
