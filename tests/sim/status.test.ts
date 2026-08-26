/** 상태이상 — slow 최대값 우선, poison 3스택/armor 무시, burn은 armor 적용, stun 보스 저항, 힐 오라 */
import { describe, expect, it } from 'vitest';
import { Rng } from '@/core/rng';
import type { BattleStateView, EnemyDef } from '@/data/types';
import { World, type EnemySim, type SimCtx } from '@/sim/entities';
import { createHometown } from '@/sim/hometown';
import { ResourceField } from '@/sim/gather';
import {
  effectiveSpeed,
  isStunned,
  processHealAuras,
  processPurgeAuras,
  slowFactor,
  tickEnemyStatuses,
  tickShields,
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
    baseLevel: 1,
    baseLevelMax: 1,
    prepTicksLeft: 0,
    earlyCallBonusGold: 0,
    hand: [],
    deck: [],
    refreshCost: 0,
    enemies: world.enemies.items,
    allies: world.allies.items,
    allyCap: 6,
    towers: world.towers.items,
    projectiles: world.projectiles.items,
    amberEarned: 0,
    endless: false,
    // 이 랩이 재는 것은 상태이상뿐이라 자원 칸이 없다 (아래 ctx.resources와 짝)
    resources: [],
  };
  const opts = options();
  return {
    opts,
    rng: new Rng(seed),
    world,
    events: [],
    view,
    groundPaths: [],
    airPaths: [],
    hometown: createHometown(),
    // 소품이 하나도 없는 밭 — view.resources(빈 배열)와 **같은 답**이어야 한다
    resources: new ResourceField(opts.stage, new Set<number>()),
  };
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

  it('poison — 같은 소스 재적용은 자기 스택 갱신 (스택 수 불변)', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('raptor', { hp: 100 }));
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 2, durationTicks: 100, chance: 1 }, 7);
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 3, durationTicks: 80, chance: 1 }, 7);
    const stacks = e.statuses.filter((s) => s.kind === 'poison');
    expect(stacks).toHaveLength(1); // 같은 소스 → 새 스택 없음
    expect(stacks[0]?.magnitude).toBe(3); // 갱신됨
    expect(stacks[0]?.remainingTicks).toBe(80);
    expect(stacks[0]?.sourceId).toBe(7);
  });

  it('poison — 다른 소스는 별도 스택으로 병존, armor 무시 합산', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('raptor', { armor: 50, hp: 100 }));
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 2, durationTicks: 100, chance: 1 }, 1);
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 4, durationTicks: 100, chance: 1 }, 2);
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 6, durationTicks: 100, chance: 1 }, 3);
    expect(e.statuses.filter((s) => s.kind === 'poison')).toHaveLength(3); // 소스별 병존
    tickN(ctx, e, 15); // STATUS_TICK_INTERVAL 경계 도달
    expect(e.hp).toBeCloseTo(100 - (2 + 4 + 6)); // armor 50 무시하고 3스택 합산
  });

  it('poison — 소스별 3스택 캡: 4번째 소스는 가장 오래된 스택 교체', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('raptor', { hp: 100 }));
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 2, durationTicks: 30, chance: 1 }, 1);
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 2, durationTicks: 100, chance: 1 }, 2);
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 2, durationTicks: 100, chance: 1 }, 3);
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 9, durationTicks: 40, chance: 1 }, 4);
    const stacks = e.statuses.filter((s) => s.kind === 'poison');
    expect(stacks).toHaveLength(3); // 초과 스택 없음
    expect(stacks.some((s) => s.sourceId === 1)).toBe(false); // 잔여 최소(가장 오래된) 소스1 교체
    const replaced = stacks.find((s) => s.sourceId === 4);
    expect(replaced?.magnitude).toBe(9);
    expect(replaced?.remainingTicks).toBe(40);
    // 캡 상태에서 기존 소스 재적용은 여전히 자기 스택 갱신
    tryApplyStatus(ctx, e, { kind: 'poison', magnitude: 5, durationTicks: 60, chance: 1 }, 2);
    const s2 = e.statuses.filter((s) => s.kind === 'poison').find((s) => s.sourceId === 2);
    expect(e.statuses.filter((s) => s.kind === 'poison')).toHaveLength(3);
    expect(s2?.magnitude).toBe(5);
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

  /*
   * ── 정화 ✧ (counter-plan 단계 6) ───────────────────────────────────────
   * 규칙의 근거는 types.ts 의 `EnemyDef.purge` 주석이다. 여기서 잠그는 것은 네 가지:
   * 반경 · 자기 제외 · **가장 오래된 스택부터** · 보스 스턴 면역.
   */
  it('purge — 반경 안의 다른 적에게서 스택을 벗기고, 자신과 반경 밖은 안 건드린다', () => {
    const ctx = miniCtx();
    const caster = spawn(ctx, enemyDef('shaman', { hp: 10, purge: { radius: 2, stacksPerTick: 1 } }));
    const near = spawn(ctx, enemyDef('raptor', { hp: 10 }), { x: 1 });
    const far = spawn(ctx, enemyDef('raptor', { hp: 10 }), { x: 5 });
    for (const e of [caster, near, far]) {
      tryApplyStatus(ctx, e, { kind: 'slow', magnitude: 0.5, durationTicks: 300, chance: 1 });
    }
    expect(caster.statuses).toHaveLength(1);
    processPurgeAuras(ctx);
    expect(near.statuses, '반경 안 — 벗겨진다').toHaveLength(0);
    expect(far.statuses, '반경 밖 — 그대로').toHaveLength(1);
    expect(caster.statuses, '시전자 자신은 제외 (healAura 와 대칭)').toHaveLength(1);
    expect(ctx.events.filter((e) => e.type === 'statusPurged')).toHaveLength(1);
  });

  it('purge — 한 번에 stacksPerTick 개만, **가장 오래 걸린 것부터** 벗긴다', () => {
    const ctx = miniCtx();
    spawn(ctx, enemyDef('shaman', { hp: 10, purge: { radius: 2, stacksPerTick: 1 } }));
    const victim = spawn(ctx, enemyDef('raptor', { hp: 10 }), { x: 1 });
    // 적용 순서: slow → burn → poison. statuses 는 적용 순서 배열이다.
    tryApplyStatus(ctx, victim, { kind: 'slow', magnitude: 0.5, durationTicks: 300, chance: 1 });
    tryApplyStatus(ctx, victim, { kind: 'burn', magnitude: 3, durationTicks: 300, chance: 1 }, 1);
    tryApplyStatus(ctx, victim, { kind: 'poison', magnitude: 3, durationTicks: 300, chance: 1 }, 2);
    expect(victim.statuses.map((x) => x.kind)).toEqual(['slow', 'burn', 'poison']);
    processPurgeAuras(ctx);
    expect(victim.statuses.map((x) => x.kind), '가장 오래된 slow 하나만 빠진다').toEqual([
      'burn',
      'poison',
    ]);
    processPurgeAuras(ctx);
    expect(victim.statuses.map((x) => x.kind)).toEqual(['poison']);
  });

  it('purge — 보스의 stun 을 벗길 때도 만료와 **똑같이** 면역이 걸린다', () => {
    const ctx = miniCtx();
    spawn(ctx, enemyDef('shaman', { hp: 10, purge: { radius: 2, stacksPerTick: 1 } }));
    const boss = spawn(ctx, enemyDef('trex', { hp: 100, boss: true }), { x: 1 });
    tryApplyStatus(ctx, boss, { kind: 'stun', magnitude: 1, durationTicks: 300, chance: 1 });
    expect(isStunned(boss)).toBe(true);
    processPurgeAuras(ctx);
    expect(boss.statuses).toHaveLength(0);
    /*
     * 면역이 안 걸리면 정화가 **플레이어를 돕는다** — 보스를 즉시 다시 얼릴 수 있게
     * 되기 때문이다. 적 편 능력이 플레이어에게 유리해지면 뜻이 뒤집힌 것이다.
     */
    expect(boss.stunImmuneUntil, '보스 스턴 면역이 시작돼야 한다').toBeGreaterThan(ctx.view.tick);
    tryApplyStatus(ctx, boss, { kind: 'stun', magnitude: 1, durationTicks: 300, chance: 1 });
    expect(boss.statuses, '면역 중에는 다시 안 걸린다').toHaveLength(0);
  });

  /*
   * ── 재충전형 방패 🔶 (counter-plan 단계 5) ─────────────────────────────
   * 잠그는 것: 잔량이 최대 미만이면 카운트다운이 돌고 rate 틱마다 1장씩, 상한까지만.
   * 이 규칙이 곧 "차단율 = 발사 간격 ÷ 재충전"의 근거다 (types.ts shieldRecharge).
   */
  it('shieldRecharge — 깎이면 rate 틱마다 1장씩 상한까지 되돌아온다', () => {
    const ctx = miniCtx();
    const def = enemyDef('warrior', { hp: 100, shieldHits: 2, shieldRecharge: 10 });
    const e = spawn(ctx, def, { shieldHitsLeft: 0 });
    for (let i = 0; i < 9; i++) tickShields(ctx, e);
    expect(e.shieldHitsLeft, '9틱째까지는 아직 0').toBe(0);
    tickShields(ctx, e);
    expect(e.shieldHitsLeft, '10틱째에 1장').toBe(1);
    for (let i = 0; i < 9; i++) tickShields(ctx, e);
    expect(e.shieldHitsLeft).toBe(1);
    tickShields(ctx, e);
    expect(e.shieldHitsLeft, '20틱째에 2장 = 상한').toBe(2);
    for (let i = 0; i < 50; i++) tickShields(ctx, e);
    expect(e.shieldHitsLeft, '상한을 넘지 않는다').toBe(2);
    expect(e.shieldRechargeLeft, '가득 차면 타이머는 멈춘다').toBe(0);
  });

  it('shieldRecharge — 값이 없는 종은 한 장도 안 되돌아온다 (기본 동작 보존)', () => {
    const ctx = miniCtx();
    const e = spawn(ctx, enemyDef('warrior', { hp: 100, shieldHits: 2 }), { shieldHitsLeft: 0 });
    for (let i = 0; i < 500; i++) tickShields(ctx, e);
    expect(e.shieldHitsLeft).toBe(0);
  });

  it('healAura — 회복량이 시전자 hpMul로 스케일 (중반 이후 힐러 유효)', () => {
    const ctx = miniCtx();
    spawn(
      ctx,
      enemyDef('shaman', { hp: 100, healAura: { radius: 2, hpPerStatusTick: 8 } }),
      { hpMul: 4 },
    );
    const ally = spawn(ctx, enemyDef('raptor', { hp: 100 }), { x: 1, hp: 10, maxHp: 100 });
    processHealAuras(ctx);
    expect(ally.hp).toBe(10 + 8 * 4); // 8 × hpMul(4) = 32 회복
  });
});
