/**
 * 웨이브 스포너 — SpawnGroup 스케줄 소비, 스폰 틱 계산, 전원 스폰 감지.
 * 스폰 틱: 웨이브 시작 후 delayTicks + n*intervalTicks. interval 0이면 일괄 스폰.
 * endless 추가 hpMul(1.06^초과웨이브)은 start()에서 주입받아 스폰 시 적용.
 */
import type { SpawnGroup, WaveDef } from '@/data/types';
import { bountyChunksFor } from '@/data/balance';
import { pathFor, type SimCtx } from './entities';

interface GroupProgress {
  g: SpawnGroup;
  spawned: number;
}

/**
 * 이번 웨이브의 **표준 사냥감 한 마리 HP** — 마릿수 가중 중앙값. 살점 값의 몫 수 K가
 * 여기에 걸린다(`balance.bountyChunksFor`).
 *
 * 왜 종의 `def.hp`가 아니라 웨이브인가: 스테이지6 warrior 는 `def.hp` 120 이지만 실제
 * 개체는 **813HP**다(실측 처치 18.9초). 종으로 재면 K=1 이 되어 스테이지6이 하나도
 * 안 고쳐진다 — 실측이 "스테이지6은 잡몹 compy 조차 9.8초"라고 말한 그 현상이,
 * 기준이 웨이브이기 때문에 종 데이터를 한 줄도 안 고치고 따라온다.
 *
 * 왜 평균이 아니라 중앙값인가: 평균은 보스 자신에게 끌려 올라가 w50에서 통째로
 * 망가진다(총 HP 44,806 중 **84.8%가 trex 한 마리**다 — 평균을 쓰면 그 trex 가 기준이
 * 되어 자기 자신을 K=1 로 만든다). 보스는 마릿수 1~4, 잡몹은 10~25라 마릿수 가중
 * 중앙값은 사실상 언제나 잡몹을 고른다.
 *
 * 그룹이 전부 보스인 웨이브(현 데이터에 없다)에서는 기준이 보스 자신이 되어 K=1 —
 * 곧 **오늘과 같은 동작으로 퇴화**한다. 조용히 망가지지 않고 조용히 원래대로 돌아간다.
 *
 * 순수 함수다: 웨이브 정의와 배율만 읽고 rng·시간에 닿지 않는다(결정론).
 */
function medianSpawnHp(ctx: SimCtx, def: WaveDef, extraHpMul: number): number {
  const rows: { hp: number; n: number }[] = [];
  let total = 0;
  for (const g of def.groups) {
    if (g.count <= 0) continue;
    const eDef = ctx.opts.enemyDefs[g.enemyId];
    // 스폰과 **정확히 같은 식**이어야 한다 (spawn()의 hp 계산과 한 글자도 다르면
    // 기준이 실제 개체와 어긋나 K가 통째로 밀린다)
    rows.push({ hp: Math.max(1, Math.round(eDef.hp * g.hpMul * extraHpMul)), n: g.count });
    total += g.count;
  }
  if (total === 0) return 1;
  // 동점끼리는 원순서를 유지한다 — 정렬이 안정적이라야 결정론이 성립한다
  rows.sort((a, b) => a.hp - b.hp);
  let acc = 0;
  for (const r of rows) {
    acc += r.n;
    if (acc * 2 >= total) return r.hp;
  }
  return (rows[rows.length - 1] as { hp: number }).hp;
}

export class WaveSpawner {
  private entries: GroupProgress[] = [];
  /** 웨이브 시작 이후 경과 틱 */
  private t = 0;
  private extraHpMul = 1;
  /** 살점 값의 기준 HP — 웨이브당 한 번 굳는다 (medianSpawnHp 주석) */
  private refHp = 1;

  start(ctx: SimCtx, def: WaveDef, extraHpMul: number): void {
    this.entries = def.groups.map((g) => ({ g, spawned: 0 }));
    this.t = 0;
    this.extraHpMul = extraHpMul;
    this.refHp = medianSpawnHp(ctx, def, extraHpMul);
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
    // resetEnemy 가 이미 0으로 못 박지만 여기서도 명시한다 (shieldHitsLeft·attackCdLeft 와 같은 관행)
    e.shieldRechargeLeft = 0;
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
    // 살점 값 — 몫 수는 **스폰 시 굳힌다**. 웨이브 중에 바뀌면 이미 지급한 몫과 어긋난다.
    // (지급 이력은 resetEnemy가 0으로 못박지만, 여기서도 명시한다 — shieldHitsLeft·
    //  attackCdLeft가 이미 reset/spawn 양쪽에 적혀 있는 것과 같은 관행이다)
    e.bountyChunks = bountyChunksFor(hp, e.bounty, this.refHp);
    e.bountyPaid = 0;
    // 스테이지별 누수 피해 덮어쓰기 — 없으면 종의 기본값 그대로 (StageDef.leakDamage 주석)
    e.baseDamage = ctx.opts.stage.leakDamage?.[def.id] ?? def.baseDamage;
    // ── 문간 상태 셋 (gate.ts) ─────────────────────────────────────────────────
    // resetEnemy 가 이미 0 으로 못박지만 여기서도 명시한다 (shieldHitsLeft·attackCdLeft 가
    // 양쪽에 적혀 있는 것과 같은 관행). **gateOwed 만은 여기가 유일한 진짜 초기화다** —
    // 값이 baseDamage 라 resetEnemy 시점(Pool.acquire)에는 아직 알 수 없다.
    // ⚠ 반드시 위 baseDamage 대입 **뒤**여야 한다. 앞에 두면 이전 개체의 값을 청구한다.
    e.gateTicks = 0;
    e.gateBiteCdLeft = 0;
    e.gateOwed = e.baseDamage;
    e.radius = def.radius;
    pathFor(ctx, e).sample(0, e);
    e.prevX = e.x;
    e.prevZ = e.z;
    ctx.events.push({ type: 'enemySpawned', enemyId: e.id, defId: def.id });
    if (def.boss) ctx.events.push({ type: 'bossSpawned', enemyId: e.id, defId: def.id });
  }
}
