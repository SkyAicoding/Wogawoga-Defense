/**
 * 웨이브 스포너 — SpawnGroup 스케줄 소비, 스폰 틱 계산, 전원 스폰 감지.
 * 스폰 틱: 웨이브 시작 후 delayTicks + n*intervalTicks. interval 0이면 일괄 스폰.
 * endless 추가 hpMul(1.06^초과웨이브)은 start()에서 주입받아 스폰 시 적용.
 */
import type { SpawnGroup, WaveDef } from '@/data/types';
import { pathFor, type SimCtx } from './entities';

interface GroupProgress {
  g: SpawnGroup;
  spawned: number;
}

export class WaveSpawner {
  private entries: GroupProgress[] = [];
  /** 웨이브 시작 이후 경과 틱 */
  private t = 0;
  private extraHpMul = 1;

  start(def: WaveDef, extraHpMul: number): void {
    this.entries = def.groups.map((g) => ({ g, spawned: 0 }));
    this.t = 0;
    this.extraHpMul = extraHpMul;
  }

  /** 매 틱 (phase==='wave'일 때만) — 스폰 예정 도달분을 모두 스폰 */
  update(ctx: SimCtx): void {
    for (const en of this.entries) {
      const g = en.g;
      const interval = Math.max(0, g.intervalTicks);
      // interval 0이면 조건이 계속 참이라 일괄 스폰된다
      while (en.spawned < g.count && this.t >= g.delayTicks + en.spawned * interval) {
        this.spawn(ctx, g);
        en.spawned++;
      }
    }
    this.t++;
  }

  allSpawned(): boolean {
    for (const en of this.entries) if (en.spawned < en.g.count) return false;
    return true;
  }

  private spawn(ctx: SimCtx, g: SpawnGroup): void {
    const def = ctx.opts.enemyDefs[g.enemyId];
    const e = ctx.world.acquireEnemy();
    e.defId = def.id;
    e.def = def;
    const mul = g.hpMul * this.extraHpMul;
    const hp = Math.max(1, Math.round(def.hp * mul));
    e.hp = hp;
    e.maxHp = hp;
    e.hpMul = mul;
    // 공성 피해는 **무한 모드 초과분만** 따라간다 (정규 웨이브에서는 항상 1)
    e.siegeMul = this.extraHpMul;
    e.shieldHitsLeft = def.shieldHits ?? 0;
    e.dist = 0;
    e.pathIndex = g.pathIndex;
    e.flying = def.flying;
    e.statuses.length = 0;
    e.stunImmuneUntil = -1;
    // 사거리에 들어서는 즉시 첫 타격 (siege.ts 규칙 6)
    e.attackCdLeft = 0;
    e.towerTargetId = -1;
    e.alive = true;
    e.boss = def.boss ?? false;
    // 보상 배율 — 예산을 넘겨 부푼 편성(습격대 최소 인원)에서만 1 미만이다.
    // 정수로 굳혀 두면 처치 시점 계산이 없고 해시가 부동소수에 흔들리지 않는다.
    e.bounty = Math.max(1, Math.round(def.bounty * (g.bountyMul ?? 1)));
    // 스테이지별 누수 피해 덮어쓰기 — 없으면 종의 기본값 그대로 (StageDef.leakDamage 주석)
    e.baseDamage = ctx.opts.stage.leakDamage?.[def.id] ?? def.baseDamage;
    e.radius = def.radius;
    pathFor(ctx, e).sample(0, e);
    e.prevX = e.x;
    e.prevZ = e.z;
    ctx.events.push({ type: 'enemySpawned', enemyId: e.id, defId: def.id });
    if (def.boss) ctx.events.push({ type: 'bossSpawned', enemyId: e.id, defId: def.id });
  }
}
