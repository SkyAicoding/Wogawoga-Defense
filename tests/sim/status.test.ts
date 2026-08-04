/** 상태이상 — slow 최대값 우선, poison 3스택/armor 무시, burn은 armor 적용, stun 보스 저항, 힐 오라 */
import { describe, expect, it } from 'vitest';
import { Rng } from '@/core/rng';
import type { BattleStateView, EnemyDef } from '@/data/types';
import { World, type EnemySim, type SimCtx } from '@/sim/entities';
import {
  effectiveSpeed,
  isStunned,
  processHealAuras,
  slowFactor,
  tickEnemyStatuses,
  tryApplyStatus,
} from '@/sim/status';
import { enemyDef, options } from './fixtures';

function miniCtx(seed = 1): SimCtx {
  const world = new World();
  const view: BattleStateView = {
    tick: 0,
    phase: 'wave',
    waveIndex: 1,
    waveCount: 1,
    gold: 0,
    baseHp: 10,
    baseHpMax: 10,
    prepTicksLeft: 0,
    hand: [],
    refreshCost: 0,
    enemies: world.enemies.items,
    towers: world.towers.items,
    projectiles: world.projectiles.items,
    amberEarned: 0,
    endless: false,
  };
  return { opts: options(), rng: new Rng(seed), world, events: [], view, groundPaths: [], airPaths: [] };
}

function spawn(ctx: SimCtx, def: EnemyDef, over?: Partial<EnemySim>): EnemySim {
  const e = ctx.world.acquireEnemy();
  Object.assign(
    e,
    {
      defId: def.id,
      hp: def.hp,
      maxHp: def.hp,
      shieldHitsLeft: def.shieldHits ?? 0,
      dist: 0,
      pathIndex: 0,
      flying: def.flying,
      x: 0,
      z: 0,
      prevX: 0,
      prevZ: 0,
      heading: 0,
      bounty: def.bounty,
      baseDamage: def.baseDamage,
      radius: def.radius,
      alive: true,
      hpMul: 1,
      def,
      stunImmuneUntil: -1,
    },
    over,
  );
  return e;
}

function tickN(ctx: SimCtx, e: EnemySim, n: number): void {
  for (let i = 0; i < n; i++) {
    ctx.view.tick++;
    tickEnemyStatuses(ctx, e);
  }
}

describe('status', () => {
  it('slow — 최대 magnitude 우선, 약한 감속 무시, 동일 값은 지속 갱신', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('raptor', { speed: 2 }));
    tryApplyStatus(ctx, e, { kind: 'slow', magnitude: 0.5, durationTicks: 10, chance: 1 });
    expect(slowFactor(e)).toBeCloseTo(0.5);
    tryApplyStatus(ctx, e, { kind: 'slow', magnitude: 0.3, durationTicks: 500, chance: 1 });
    expect(e.statuses).toHaveLength(1); // 단일 인스턴스 유지
    expect(slowFactor(e)).toBeCloseTo(0.5); // 약한 감속은 무시
    tryApplyStatus(ctx, e, { kind: 'slow', magnitude: 0.5, durationTicks: 100, chance: 1 });
    expect(e.statuses[0]?.remainingTicks).toBe(100); // 동일 값 → 지속 갱신
    tryApplyStatus(ctx, e, { kind: 'slow', magnitude: 0.7, durationTicks: 50, chance: 1 });
    expect(slowFactor(e)).toBeCloseTo(0.3);
    expect(effectiveSpeed(e)).toBeCloseTo(2 * 0.3);
  });

  it('poison — 최대 3스택, 초과 시 가장 오래된 것 갱신, armor 무시', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('raptor', { armor: 50, hp: 100 }));
    for (let i = 0; i < 3; i++) {
      tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 2, durationTicks: 100, chance: 1 });
    }
    expect(e.statuses.filter((s) => s.kind === 'poison')).toHaveLength(3);
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 9, durationTicks: 40, chance: 1 });
    const stacks = e.statuses.filter((s) => s.kind === 'poison');
    expect(stacks).toHaveLength(3); // 초과 스택 없음
    expect(stacks.filter((s) => s.magnitude === 9)).toHaveLength(1); // 가장 오래된 것이 교체됨
    tickN(ctx, e, 15); // STATUS_TICK_INTERVAL 경계 도달
    expect(e.hp).toBeCloseTo(100 - (2 + 2 + 9)); // armor 50 무시하고 원 데미지
  });

  it('burn — armor 적용(최소 1), poison과 독립 스택', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('raptor', { armor: 50, hp: 100 }));
    tryApplyStatus(ctx, e, { kind: 'burn', magnitude: 5, durationTicks: 100, chance: 1 });
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 3, durationTicks: 100, chance: 1 });
    tickN(ctx, e, 15);
    expect(e.hp).toBeCloseTo(100 - 1 - 3); // burn 5-50 → 최소1, poison 3 그대로
  });

  it('stun — 보스는 지속 1/5 + 종료 후 60틱 면역', () => {
    const ctx = miniCtx();
    const boss = spawn(ctx, enemyDef('trex', { boss: true, hp: 1000 }));
    expect(
      tryApplyStatus(ctx, boss, { kind: 'stun', magnitude: 0, durationTicks: 100, chance: 1 }),
    ).toBe(true);
    expect(boss.statuses[0]?.remainingTicks).toBe(20); // 100/5
    expect(isStunned(boss)).toBe(true);
    expect(effectiveSpeed(boss)).toBe(0);
    tickN(ctx, boss, 20); // 만료 → 면역 시작 (tick 20 + 60 = 80까지)
    expect(isStunned(boss)).toBe(false);
    ctx.view.tick = 30;
    expect(
      tryApplyStatus(ctx, boss, { kind: 'stun', magnitude: 0, durationTicks: 100, chance: 1 }),
    ).toBe(false); // 면역 중
    ctx.view.tick = 100;
    expect(
      tryApplyStatus(ctx, boss, { kind: 'stun', magnitude: 0, durationTicks: 100, chance: 1 }),
    ).toBe(true); // 면역 해제
  });

  it('stun — 일반 적은 전체 지속시간', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('raptor'));
    tryApplyStatus(ctx, e, { kind: 'stun', magnitude: 0, durationTicks: 100, chance: 1 });
    expect(e.statuses[0]?.remainingTicks).toBe(100);
  });

  it('enrage — hp 비율 이하에서 속도 배율', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('boar', { speed: 1, hp: 10, enrage: { hpPct: 0.5, speedMul: 2 } }));
    expect(effectiveSpeed(e)).toBe(1);
    e.hp = 4;
    expect(effectiveSpeed(e)).toBe(2);
  });

  it('healAura — 자신 제외 반경 내 회복, 이벤트 없음, maxHp 상한', () => {
    const ctx = miniCtx();
    const healer = spawn(
      ctx,
      enemyDef('shaman', { hp: 10, healAura: { radius: 2, hpPerStatusTick: 3 } }),
      { hp: 5, maxHp: 10 },
    );
    const near = spawn(ctx, enemyDef('raptor', { hp: 10 }), { x: 1, hp: 8, maxHp: 10 });
    const far = spawn(ctx, enemyDef('raptor', { hp: 10 }), { x: 5, hp: 4, maxHp: 10 });
    processHealAuras(ctx);
    expect(near.hp).toBe(10); // 8+3 → 상한 10
    expect(far.hp).toBe(4); // 반경 밖
    expect(healer.hp).toBe(5); // 자신 제외
    expect(ctx.events.filter((e) => e.type === 'enemyDamaged')).toHaveLength(0); // 음수 이벤트 금지
  });
});
