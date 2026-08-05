/**
 * 아군 부족 유닛 — 마을에서 골드로 뽑아 내보내는 소모품 전력. 결정론 100%(rng 미사용).
 *
 * ── 행동 규칙 (확정) ───────────────────────────────────────────────────────
 * 1) **경로 역주행. 이탈 없음.**
 *    아군은 기지(경로 끝)에서 나와 적이 오는 방향으로 **같은 폴리라인을 거꾸로** 걷는다.
 *    dist 파라미터화는 적과 완전히 동일하고(0 = 스폰, totalLength = 기지) 아군만 감소한다.
 *
 *    자유 이동(스티어링)을 버린 이유는 셋이다.
 *     · **규칙 대칭** — 적은 절대 경로를 벗어나지 않는다(siege.ts 규칙 1). 아군만 들판을
 *       가로지르면 "왜 쟤들은 길로만 다니지"라는 설명 불가능한 비대칭이 생긴다.
 *     · **읽히는 그림** — 둘 다 길 위에 있으니 반드시 길목에서 맞붙는다. 어디서 싸움이
 *       날지 플레이어가 내보내기 전에 안다. 자유 이동은 어디서 만날지 예측이 안 된다.
 *     · **공짜 정확도** — 위치·방향·보행 위상이 전부 BattlePath.sample 하나로 나온다.
 *       충돌 회피도, 지형 통과 판정도, 경로 재계산도 필요 없다(이 게임엔 그런 게 없다).
 *    잃는 것은 "타워 옆에 세워 두기" 같은 배치 자유인데, 그건 타워가 할 일이다.
 *
 *    어느 경로로 나가는가: 커맨드가 pathIndex를 지정하지 않으면 **기지에 가장 가까운
 *    적이 있는 지상 경로**를 고른다(동점/적 없음 → 0번). 상태만 보고 정하므로 결정론이고,
 *    "제일 급한 쪽으로 달려간다"는 기대와도 맞는다. 공중 경로로는 나가지 않는다 —
 *    아군은 걷는다.
 *
 * 2) **출격 한계선 — 마을 앞까지만 나간다.**
 *    holdDist = max(0, totalLength - ALLY_SORTIE_RANGE). 여기 닿으면 멈춰 선다.
 *    없으면 아군이 적 스폰 지점까지 걸어가 입구에서 웨이브를 요격해 버려 타워가
 *    무의미해진다. 한계선이 있으면 아군은 "마지막 방어선"이고 타워는 여전히 "길목"이다.
 *    (2단계 홈타운 레벨업이 이 값을 늘릴 수 있게 balance 상수로 분리해 뒀다)
 *
 *    **대가는 명시적으로 받아들인다**: 경로 초입에 지은 타워가 습격대에게 두들겨 맞으면
 *    아군은 그걸 구하러 갈 수 없다. 실측으로 잠가 뒀다(tests/sim/allies.test.ts
 *    "출격 한계선 밖(경로 초입)의 타워는 아군이 구하지 못한다" — 아군 유무로 타워 피해가
 *    1의 자리까지 동일). 이건 버그가 아니라 규칙 2가 사려는 것의 뒷면이다:
 *    아군이 맵 전체의 소방수가 되면 "타워를 어디에 짓는가"가 의미를 잃는다.
 *
 * 3) **수명이 있다 — 영구 유닛은 없다.**
 *    lifeTicks(20초)가 다하면 마을로 돌아간다(allyRetired). 영구로 두면 골드가 쌓일수록
 *    무한 누적되어 후반이 무의미해지고, 동시 상한을 걸면 이번엔 "한 번 뽑으면 끝"이라
 *    골드를 쓸 곳이 사라진다. 시간제는 **지금 이 웨이브를 넘기려고 지르는** 긴급 자원이다.
 *    수명은 prep에서도 흐른다 — 미리 뽑아 두는 플레이를 막고, 조기 웨이브 호출
 *    (earlyCallBonus)과 "뽑았으면 바로 부른다"로 자연스럽게 엮인다.
 *
 * 4) **동시 상한 ALLY_MAX_ACTIVE + 지수 비용.**
 *    상한은 렌더 정원과 밸런스를 동시에 지킨다(balance.ts 주석). 비용은 **나가 있는
 *    인원수**로 오르므로 죽거나 돌아가면 되돌아온다 — 소모품다운 경제다.
 *
 * 5) **충돌은 없다. 대신 "봉쇄"다.**
 *    이 게임은 유닛 충돌이 없다(적끼리 겹친다). 아군에게만 충돌을 주면 규칙이 어긋나고,
 *    밀어내기 물리가 없는 상태에서 겹침 금지를 넣으면 좁은 코너에서 유닛이 낀다.
 *    그래서 위치는 그대로 겹치되 **상태**로 표현한다:
 *      · 근접 아군(blocks)이 사거리 안의 **지상** 적을 타깃으로 잡으면
 *        그 적의 blockerAllyId가 서고 → 적의 전진이 멈춘다.
 *      · 봉쇄된 적은 **타워도 때리지 않는다**(siege가 건너뛴다). 눈앞의 사람을 놔두고
 *        멀리 있는 움막을 두들기는 그림은 설명이 안 되고, 무엇보다 이게 아군 유닛의
 *        존재 이유다 — 골드를 내고 **타워의 수명을 산다**.
 *      · 봉쇄된 적은 자기를 막은 아군 중 **가장 낮은 id 하나**를 난투로 반격한다.
 *        전원에게 동시에 반격하게 하면 아군을 여럿 붙일수록 손해가 되어 상한이 무의미해진다.
 *    공중 적은 절대 봉쇄되지 않는다 — 날아서 지나간다. 그래서 아군은 대공 대책이 아니다.
 *
 * 6) **타게팅** — 사거리 내 최근접, 동점은 낮은 적 id. 유효한 동안 갈아타지 않는다
 *    (타워·습격대의 lockedTarget 규약과 동일). 근접형(canTargetAir=false)은 공중을 무시한다.
 *    적 쪽 타게팅은 **바뀌지 않는다** — 기지로 직행하는 적은 여전히 직행하고, 습격대는
 *    여전히 타워를 노린다. 적이 아군을 '찾아다니는' 행동은 넣지 않았다:
 *    넣으면 아군 한 명으로 웨이브 전체를 낚아 세울 수 있어 그 순간 게임이 끝난다.
 *    적이 아군을 때리는 유일한 경로는 **자기가 봉쇄당했을 때의 반격**이다.
 *
 * 7) **아군에게는 상태이상이 없다.** 적에게 상태 부여 능력이 없으므로 받을 일이 없고,
 *    없는 쪽이 규칙이 하나 적다. 아군은 타워 스플래시/오라에도 맞지 않는다(아군 오사 없음).
 *
 * 8) **환불 없음.** 죽어도 수명이 다해도 골드는 돌아오지 않는다.
 *
 * ── 교착(스톨) 안전성 ──────────────────────────────────────────────────────
 * 봉쇄는 웨이브 완료 조건(전원 스폰 + 생존 0)을 막을 수 있다. 무한 교착이 나지 않는 근거:
 *  · 봉쇄는 아군이 살아 있는 동안만 유지되고, 아군의 수명은 lifeTicks로 유한하다.
 *  · 난투 피해는 항상 1 이상이다(damageAlly의 최소 1 + enemyBrawlDmgFor의 최소 2).
 *  · 아군은 동시 ALLY_MAX_ACTIVE명이고 비용이 지수로 오른다 — 무한 릴레이가 불가능하다.
 * 즉 최악의 경우에도 봉쇄는 lifeTicks 안에 반드시 풀린다.
 *
 * three/DOM 임포트 금지.
 */
import { TICK_DT } from '@/data/types';
import type { AllyDef, AllyId } from '@/data/types';
import {
  ALLY_HOLD_SPACING,
  ALLY_MAX_ACTIVE,
  ALLY_SORTIE_RANGE,
  BRAWL_COOLDOWN_TICKS,
  allyCostFor,
  enemyBrawlDmgFor,
} from '@/data/balance';
import { dist2 } from '@/core/mathx';
import { addGold, damageAlly, damageEnemy } from './combat';
import type { AllySim, EnemySim, SimCtx } from './entities';
import { isStunned } from './status';

/** 지금 이 종을 한 명 더 내보내는 실비용 (나가 있는 인원 수에 따라 오른다) */
export function allyTrainCost(ctx: SimCtx, def: AllyDef): number {
  return allyCostFor(def.cost, ctx.world.allies.length);
}

/** 지금 출동이 가능한가 (상한 + 골드) — UI 비활성 표시와 커맨드 거부가 같은 판정을 쓴다 */
export function canTrainAlly(ctx: SimCtx, def: AllyDef): boolean {
  if (ctx.world.allies.length >= ALLY_MAX_ACTIVE) return false;
  return ctx.view.gold >= allyTrainCost(ctx, def);
}

/**
 * 규칙 2) 대기 줄의 빈 자리 — 같은 경로 위 아군이 쓰지 않는 가장 작은 슬롯 번호.
 * 앞줄이 죽으면 다음 출동이 그 자리를 메우므로 줄에 구멍이 남지 않는다.
 */
function freeSlot(ctx: SimCtx, pathIndex: number): number {
  const used = new Set<number>();
  for (const a of ctx.world.allies.items) {
    if (a.alive && a.pathIndex === pathIndex) used.add(a.slot);
  }
  for (let s = 0; s < ALLY_MAX_ACTIVE; s++) if (!used.has(s)) return s;
  return ALLY_MAX_ACTIVE - 1;
}

/**
 * 규칙 1) 경로 자동 선택 — 기지에 가장 가까운 **지상** 적이 있는 경로.
 * 동점이나 적이 없으면 0번. 상태만 보고 정하므로 완전 결정론이다.
 */
function autoPathIndex(ctx: SimCtx): number {
  const paths = ctx.groundPaths;
  let best = 0;
  let bestRemain = Infinity;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive || e.flying) continue;
    const idx = e.pathIndex < paths.length ? e.pathIndex : 0;
    const path = paths[idx];
    if (!path) continue;
    const remain = path.totalLength - e.dist;
    if (remain < bestRemain || (remain === bestRemain && idx < best)) {
      best = idx;
      bestRemain = remain;
    }
  }
  return best;
}

/**
 * 출동 커맨드 본체 — 성공하면 골드를 깎고 기지에서 스폰시킨다.
 * 거부 조건: 정의 없음 / 상한 도달 / 골드 부족 / 지상 경로 없음.
 */
export function trainAlly(ctx: SimCtx, defId: AllyId, pathIndex?: number): boolean {
  const def = ctx.opts.allyDefs[defId];
  if (!def) return false;
  if (!canTrainAlly(ctx, def)) return false;
  const cost = allyTrainCost(ctx, def);
  const paths = ctx.groundPaths;
  const idx =
    pathIndex !== undefined && pathIndex >= 0 && pathIndex < paths.length
      ? pathIndex
      : autoPathIndex(ctx);
  const path = paths[idx];
  if (!path) return false;

  // 규칙 2) 대기 줄 자리는 **acquire 전에** 정한다 — 새 유닛은 이미 리스트에 들어가
  // 있으므로 나중에 부르면 자기 자신(풀에서 나온 slot 0)을 사용 중으로 세어 한 칸씩 밀린다
  const slot = freeSlot(ctx, idx);

  addGold(ctx, -cost);
  const a = ctx.world.acquireAlly();
  a.defId = defId;
  a.def = def;
  a.hp = def.hp;
  a.maxHp = def.hp;
  a.pathIndex = idx;
  a.dist = path.totalLength; // 기지에서 출발
  a.slot = slot;
  a.holdDist = Math.min(
    path.totalLength,
    Math.max(0, path.totalLength - ALLY_SORTIE_RANGE) + slot * ALLY_HOLD_SPACING,
  );
  a.lifeLeft = Math.max(1, Math.round(def.lifeTicks));
  path.sample(a.dist, a);
  a.heading += Math.PI; // 역주행 — 진행 방향의 반대를 본다
  a.prevX = a.x;
  a.prevZ = a.z;
  ctx.events.push({
    type: 'allyTrained',
    allyId: a.id,
    defId,
    cost,
    pathIndex: idx,
    x: a.x,
    z: a.z,
  });
  return true;
}

/** 규칙 6) 현재 고정 타깃이 여전히 유효하면 반환, 아니면 null (재조준 필요) */
function lockedEnemy(ctx: SimCtx, a: AllySim, r2: number): EnemySim | null {
  if (a.targetId < 0) return null;
  const e = ctx.world.findEnemy(a.targetId);
  if (!e || !e.alive) return null;
  if (!a.def.canTargetAir && e.flying) return null;
  return dist2(a.x, a.z, e.x, e.z) <= r2 ? e : null;
}

/** 규칙 6) 사거리 내 최근접 적 (동점은 낮은 id — 완전 결정론) */
function nearestEnemy(ctx: SimCtx, a: AllySim, r2: number): EnemySim | null {
  let best: EnemySim | null = null;
  let bestD2 = Infinity;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive) continue;
    if (!a.def.canTargetAir && e.flying) continue;
    const d2 = dist2(a.x, a.z, e.x, e.z);
    if (d2 > r2) continue;
    if (d2 < bestD2 || (d2 === bestD2 && best !== null && e.id < best.id)) {
      best = e;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * 매 틱 — 아군 조준/타격 + 봉쇄 지정 + 적의 난투 반격.
 *
 * **틱 순서에서 여기가 맨 앞인 이유** (battle.ts 참조):
 *  · 이동보다 앞 — 봉쇄(blockerAllyId)를 이동 단계가 읽어야 적이 멈춘다.
 *    적 습격대가 updateSiege를 이동보다 앞에 두는 것과 정확히 같은 이유다(siege.ts 규칙 4).
 *  · updateSiege보다 앞 — 봉쇄된 적은 타워를 때리지 않는다(규칙 5). 그 판정을 siege가
 *    읽으려면 봉쇄가 먼저 서 있어야 한다.
 * 즉 "봉쇄 확정 → 공성 → 이동"이 한 틱 안의 인과 순서다.
 */
export function updateAllies(ctx: SimCtx): void {
  const allies = ctx.world.allies.items;
  const enemies = ctx.world.enemies.items;
  // 봉쇄는 매 틱 새로 세운다 — 지난 틱의 값이 남으면 아군이 죽은 뒤에도 적이 굳는다
  for (const e of enemies) e.blockerAllyId = -1;

  // 1단계: 아군의 조준/타격 + 봉쇄 지정
  for (const a of allies) {
    if (!a.alive) continue;
    if (a.attackCdLeft > 0) a.attackCdLeft--;
    const def = a.def;
    const r2 = def.range * def.range;
    const target = lockedEnemy(ctx, a, r2) ?? nearestEnemy(ctx, a, r2);
    a.targetId = target ? target.id : -1;
    if (!target) continue;
    // 규칙 5) 근접형만 봉쇄한다. 공중은 봉쇄되지 않는다
    if (def.blocks && !target.flying) {
      // 여럿이 붙으면 가장 낮은 아군 id가 반격 대상이 된다 (결정론 + 상한 무력화 방지)
      if (target.blockerAllyId < 0 || a.id < target.blockerAllyId) target.blockerAllyId = a.id;
    }
    if (a.attackCdLeft > 0) continue;
    ctx.events.push({
      type: 'allyAttacked',
      allyId: a.id,
      defId: a.defId,
      targetId: target.id,
      x: a.x,
      z: a.z,
      targetX: target.x,
      targetZ: target.z,
      ranged: !def.blocks,
    });
    damageEnemy(ctx, target, def.dmg, a.defId);
    a.attackCdLeft = Math.max(1, Math.round(def.cooldownTicks));
  }

  // 2단계: 봉쇄된 적의 난투 반격 (규칙 5)
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.blockerAllyId < 0) {
      e.brawlCdLeft = 0; // 붙잡히지 않은 적은 다음 교전에서 즉시 한 대 친다
      continue;
    }
    if (isStunned(e)) {
      // 스턴은 공성과 마찬가지로 완전 무력화 — 쿨다운도 흐르지 않는다 (siege.ts 규칙 5)
      continue;
    }
    if (e.brawlCdLeft > 0) {
      e.brawlCdLeft--;
      continue;
    }
    const blocker = ctx.world.findAlly(e.blockerAllyId);
    if (!blocker || !blocker.alive) continue;
    const spec = e.def.brawl;
    const dmg = spec ? spec.dmg : enemyBrawlDmgFor(e.def.cost);
    damageAlly(ctx, blocker, dmg, e);
    e.brawlCdLeft = Math.max(1, Math.round(spec ? spec.cooldownTicks : BRAWL_COOLDOWN_TICKS));
  }
}

/**
 * 매 틱 — 아군 이동(역주행) + 수명 감소. moveEnemies **직후**에 돈다:
 * 교전 판정은 이미 updateAllies에서 끝났고, 여기서는 그 결과대로 걷거나 멈추기만 한다.
 * (적과 아군을 같은 틱 안에서 같은 스냅샷으로 움직여야 사거리 판정이 한쪽으로 기울지 않는다)
 */
export function moveAllies(ctx: SimCtx): void {
  for (const a of ctx.world.allies.items) {
    if (!a.alive) continue;
    a.prevX = a.x;
    a.prevZ = a.z;
    // 규칙 3) 수명 — prep에서도 흐른다
    if (a.lifeLeft > 0) a.lifeLeft--;
    if (a.lifeLeft <= 0) {
      a.alive = false;
      ctx.events.push({ type: 'allyRetired', allyId: a.id, defId: a.defId, x: a.x, z: a.z });
      continue;
    }
    // 규칙 5) 근접형은 교전 중이면 그 자리에 선다. 원거리는 걸으며 쏜다
    if (a.def.blocks && a.targetId >= 0) continue;
    if (a.dist <= a.holdDist) continue; // 규칙 2) 출격 한계선
    const path = ctx.groundPaths[a.pathIndex] ?? ctx.groundPaths[0];
    if (!path) continue;
    a.dist = Math.max(a.holdDist, a.dist - a.def.speed * TICK_DT);
    path.sample(a.dist, a);
    a.heading += Math.PI; // 역주행
  }
}

/** 사망/귀환한 아군 회수 — battle의 사망 처리 단계에서 역순으로 호출한다 */
export function sweepDeadAllies(ctx: SimCtx): void {
  const items = ctx.world.allies.items;
  for (let i = items.length - 1; i >= 0; i--) {
    if (!(items[i] as AllySim).alive) ctx.world.removeAllyAt(i);
  }
}
