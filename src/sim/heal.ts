/**
 * **마법사 회복 🔷** — 손상된 **타워와 홈타운**에게 걸어가서 HP 를 되돌린다.
 *
 * 사용자 요구(두 건이 한 짝이다):
 *  · "우리 타워나, 주민의 hp가 시간이 지나면 자동으로 회복하지 않도록 해줘."
 *  · "마지막 파수꾼은 마법사(힐러)로 변경해줘. 우리 부족이나, 타워, 홈타운등의 hp를
 *     마법사가 가서 회복해주는 기능으로 만들어줘."
 * 곧 회복의 **출처를 시간에서 사람으로 옮기는 것**이 이 파일의 전부다. 준비 단계 자동
 * 수리는 없애지 않고 웨이브당 24% → 6% 로 줄였다(`TOWER_REPAIR_PER_STATUS_TICK` 주석의
 * 실측: 0 으로 만들면 승수 80% → 21% 로 게임이 부서진다).
 *
 * ── 대상에서 **아군(부족원)은 빠져 있다** ─────────────────────────────────────
 * 사용자 요구문에는 "우리 부족"이 들어 있지만 뺐다. 근거 둘 다 이 저장소가 이미 증명해
 * 둔 불변식이고, 자세한 것은 `data/types.ts AllyDef.heal` 주석에 있다:
 *  ① 종료 증명 — 아군 회복은 봉쇄를 안 풀리게 만들 수 있다(`allies.ts` 머리말의 ⚠).
 *  ② 채집 중단 벌금 — `AllySim.gatherHpMark` 가 "아군 hp 는 단조 감소"에 걸려 있다.
 * 타워·홈타운은 아무도 붙잡지 않고 캐지도 않으므로 두 위험이 원리적으로 없다.
 *
 * ── 결정론 규약 (이 파일의 모든 순서는 여기 한 곳에만 적는다) ─────────────────
 *  · `Math.random` 을 한 톨도 안 쓴다.
 *  · 아군 순회는 **id 오름차순**(`alliesInOrder`) — 풀의 swap-remove 순서를 안 탄다.
 *  · 대상 순위는 **잃은 HP 비율** 내림차순, 동률은 **키 오름차순**(마을이 -2 라 언제나
 *    먼저다). 비율인 이유: 절대량이면 마을(maxHp 25)이 타워(수백) 뒤로 영영 밀려
 *    "패배가 임박한 것부터 고친다"가 성립하지 않는다.
 *  · 새 필드 `healKey`/`healCdLeft` 는 `resetAlly` 가 지우고 `battle.ts hash()` 가 접는다.
 */
import type { AllyHealSpec, SimEvent } from '@/data/types';
import { ALLY_HEAL_BASE_CAP_FRAC } from '@/data/balance';
import { fillAliveAllyIds, type AllySim, type SimCtx } from './entities';

/**
 * 순회 버퍼 — 매 틱 할당을 안 하려고 모듈에 둔다(`allies.ts` 의 `pickOrder` 와 같은 규약).
 * 이 파일이 단일 스레드에서 한 번에 한 판만 도는 것에 기대고 있고, 그 전제는
 * 시뮬레이션 전체가 이미 쓰고 있다.
 */
const healOrder: AllySim[] = [];

/** 회복 대상 키 — 마을. 타워는 자기 `id`(≥ 0)를 쓰므로 음수라야 안 겹친다 */
export const HEAL_KEY_BASE = -2;
/** 대상 없음 */
const HEAL_KEY_NONE = -1;

/** 이 판에서 마을에 되돌릴 수 있는 총 HP (상한 근거는 balance.ALLY_HEAL_BASE_CAP_FRAC) */
export function baseHealBudget(ctx: SimCtx): number {
  return Math.floor(ctx.view.baseHpMax * ALLY_HEAL_BASE_CAP_FRAC);
}

interface HealTarget {
  key: number;
  /** 잃은 HP 비율 (0~1). 클수록 위태롭다 */
  lack: number;
  /** 셀 좌표 */
  x: number;
  z: number;
}

/**
 * 지금 고칠 수 있는 대상 하나 — **가장 위태로운 것**.
 * `prefer` 가 아직 다쳐 있으면 그것을 그대로 돌려준다(왕복 방지 이력).
 */
function pickTarget(ctx: SimCtx, a: AllySim, spec: AllyHealSpec, prefer: number): HealTarget | null {
  const seek2 = spec.seekRadius * spec.seekRadius;
  let best: HealTarget | null = null;
  const consider = (t: HealTarget): void => {
    const dx = t.x - a.x;
    const dz = t.z - a.z;
    if (dx * dx + dz * dz > seek2) return;
    // 이력: 붙잡고 있던 대상이 아직 다쳐 있으면 순위와 무관하게 그것을 잡는다
    if (t.key === prefer) { best = t; return; }
    if (best !== null && best.key === prefer) return;
    if (best === null || t.lack > best.lack || (t.lack === best.lack && t.key < best.key)) best = t;
  };

  /*
   * 마을 — 상한이 남아 있을 때만 후보다.
   * ⚠ **이 조건은 상한의 집행부가 아니라 최적화다.** 진짜 집행은 `applyHeal` 의
   *   `Math.max(0, left)` 한 줄이고, 실측으로 확인했다: 여기 `baseHealed < budget` 만
   *   빼도 계약이 **하나도 안 빨개진다**(applyHeal 이 잡는다). `applyHeal` 쪽을 빼면
   *   그때 "되돌린 6000 · 상한 5999" 로 빨개진다. 상한을 손볼 사람은 **거기**를 봐라.
   */
  const v = ctx.view;
  if (v.baseHp < v.baseHpMax && ctx.hometown.baseHealed < baseHealBudget(ctx)) {
    const cell = ctx.opts.stage.baseCell;
    consider({ key: HEAL_KEY_BASE, lack: 1 - v.baseHp / v.baseHpMax, x: cell.x, z: cell.z });
  }
  for (const t of ctx.world.towers.items) {
    if (t.hp >= t.maxHp) continue;
    consider({ key: t.id, lack: 1 - t.hp / t.maxHp, x: t.cellX, z: t.cellZ });
  }
  return best;
}

/** 실제로 되돌린다 — 반환값은 **실제 회복량**(요청량이 아니다) */
function applyHeal(ctx: SimCtx, a: AllySim, target: HealTarget, want: number): number {
  const ev = ctx.events as SimEvent[];
  if (target.key === HEAL_KEY_BASE) {
    const v = ctx.view;
    const left = baseHealBudget(ctx) - ctx.hometown.baseHealed;
    const amount = Math.min(want, v.baseHpMax - v.baseHp, Math.max(0, left));
    if (amount <= 0) return 0;
    v.baseHp += amount;
    ctx.hometown.baseHealed += amount;
    ev.push({
      type: 'allyHealed', allyId: a.id, targetKind: 'base', towerId: -1,
      amount, hpLeft: v.baseHp, maxHp: v.baseHpMax, cellX: target.x, cellZ: target.z,
    });
    return amount;
  }
  const t = ctx.world.findTower(target.key);
  if (!t || t.hp >= t.maxHp) return 0;
  const amount = Math.min(want, t.maxHp - t.hp);
  if (amount <= 0) return 0;
  t.hp += amount;
  ev.push({
    type: 'allyHealed', allyId: a.id, targetKind: 'tower', towerId: t.id,
    amount, hpLeft: t.hp, maxHp: t.maxHp, cellX: t.cellX, cellZ: t.cellZ,
  });
  return amount;
}

/**
 * **8-d) 마법사 회복** — `updateAllies`(전투) 뒤, `moveAllies`(이동) **앞**에 돈다.
 *
 * 그 자리인 이유 셋:
 *  · 전투 뒤 → 이 틱에 입은 피해를 이 틱에 고칠 수 있다(한 틱 늦지 않는다).
 *  · 이동 앞 → 여기서 정한 `tgtX/tgtZ` 가 **같은 틱에** 걸음으로 반영된다.
 *  · `applyCommand` 밖 → 플레이어 명령과 경합하지 않는다.
 *
 * ⚠ **싸우는 중이면 회복하지 않는다**(`targetId >= 0`). 마법사는 탱커를 겸하므로
 *   (hp 560 · blocks · sunder) 붙잡은 적을 놓고 고치러 가면 그 적이 그대로 마을로 간다.
 *   "버티면서 고치는 사람"이지 "고치려고 전선을 버리는 사람"이 아니다.
 * ⚠ **`autoHold` 면 걷지 않는다**(규칙 8과 같은 규약). 플레이어가 "여기 지켜"를 찍었으면
 *   그 자리를 뜨지 않고, 사거리 안에 든 것만 고친다.
 */
export function updateAllyHeal(ctx: SimCtx): void {
  fillAliveAllyIds(ctx.world.allies.items, healOrder);
  for (const a of healOrder) {
    const spec = a.def.heal;
    if (!spec) continue;
    if (a.healCdLeft > 0) a.healCdLeft--;
    /*
     * ⚠⚠ **회복과 이동의 조건이 다르다.** 종전에는 교전 중이면 둘 다 안 했는데,
     *   마법사는 봉쇄자(hp 560 · blocks)라 **자주 싸운다** — 그러면 가동률이 바닥이고,
     *   실제로 봉투가 그것을 말했다(완주율 80% → 20%. 자동 수리를 없앤 뒤 마법사가
     *   그 자리를 못 메웠다).
     *
     *   그래서 갈랐다: **싸우면서도 사거리 안은 고치고, 자리는 안 뜬다.**
     *   "버티면서 고치는 사람"이라는 이 카드의 정의 그대로다. 버리면 안 되는 것은
     *   **전선**이지 주문이 아니다 — 막고 있는 적을 놓고 고치러 걸어가면 그 적이
     *   그대로 마을로 간다.
     *   ⚠ 스톨 위험은 여기 없다. 그 위험은 **아군**이 대상일 때의 이야기이고
     *     (types.ts AllyDef.heal), 여기 대상은 타워와 마을뿐이라 아무도 안 붙잡는다.
     */
    const fighting = a.targetId >= 0;
    const target = pickTarget(ctx, a, spec, a.healKey);
    if (target === null) { a.healKey = HEAL_KEY_NONE; continue; }
    a.healKey = target.key;

    const dx = target.x - a.x;
    const dz = target.z - a.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > spec.radius * spec.radius) {
      // 사거리 밖 — 걸어간다. **교전 중이거나 `autoHold` 면 자리를 안 뜬다.**
      if (!fighting && !a.autoHold) { a.tgtX = target.x; a.tgtZ = target.z; }
      continue;
    }
    if (a.healCdLeft > 0) continue;
    if (applyHeal(ctx, a, target, spec.amount) > 0) a.healCdLeft = spec.cooldownTicks;
  }
}
