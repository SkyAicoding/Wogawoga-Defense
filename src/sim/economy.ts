/**
 * 경제 — 핸드 3장 유지(덱에서 rng 드로우, 배치 시 즉시 보충),
 * 새로고침(웨이브당 1회 무료, 이후 20×1.6^n 반올림, 웨이브 시작 시 무료 리셋),
 * 판매 환급 = invested의 60% 내림.
 * 배치 비용 = round(tiers[0].cost × 스테이지 배수 × min(PLACEMENT_GROWTH^타워 수, 상한)).
 * 지금 PLACEMENT_GROWTH 는 1(동결)이라 **한 스테이지 안에서는 한 가격**이고,
 * 스테이지가 오를 때만 오른다 (balance.PLACEMENT_STAGE_STEP).
 * 핸드 CardState.cost는 항상 '지금 배치 시 실비용' — 드로우/새로고침 시 계산하고
 * 타워 배치/판매 후 전 핸드를 재계산한다.
 */
import type { CardState, TowerId } from '@/data/types';
import {
  PLACEMENT_GROWTH,
  PLACEMENT_MAX_MUL,
  PLACEMENT_STAGE_MAX_STEP,
  PLACEMENT_STAGE_STEP,
  SCENERY_CLEAR_BASE_COST,
  SCENERY_CLEAR_GROWTH,
  SCENERY_CLEAR_MAX_COST,
} from '@/data/balance';
import { addGold } from './combat';
import type { SimCtx } from './entities';

export const HAND_SIZE = 3;
const REFRESH_BASE = 20;
const REFRESH_GROWTH = 1.6;
const SELL_RATE = 0.6;

export function sellRefundFor(invested: number): number {
  return Math.floor(invested * SELL_RATE);
}

/**
 * **스테이지 배수** — 스테이지 s 의 배치 기본가 배수 = `PLACEMENT_STAGE_STEP^(s−1)`.
 * s1 이 1 이므로 스테이지1의 고정가는 `tiers[0].cost` 그대로다.
 * (표는 balance.PLACEMENT_STAGE_STEP 주석에 있다 — 여기 복사해 두면 반드시 낡는다)
 */
export function placementStageMul(stageId: number): number {
  const steps = Math.min(PLACEMENT_STAGE_MAX_STEP, Math.max(0, stageId - 1));
  return PLACEMENT_STAGE_STEP ** steps;
}

/**
 * 배치 실비용 — **한 스테이지 안에서는 고정**, 스테이지가 오르면 오른다.
 *
 * 두 축이 곱해진다:
 *  · 스테이지 축 `placementStageMul(stageId)` — 사용자가 요구한 단조 증가.
 *  · 판 축 `PLACEMENT_GROWTH^n` — **지금 1(동결)이라 항등원이다**. 상수를 1에서
 *    올리면 옛 '판이 찰수록 오르는' 규칙이 그대로 되살아난다. 곧 동결은 특수 분기가
 *    아니라 **같은 식의 한 점**이라 코드 경로가 갈리지 않는다.
 *
 * `towerCount` 를 계속 받는 이유가 그것이다 — 지금 결과에 안 쓰인다고 인자를 빼면
 * 동결을 되돌릴 때 호출부 전체를 다시 짜야 한다(그리고 그 사실이 잊힌다).
 */
export function placementCostFor(baseCost: number, towerCount: number, stageId: number): number {
  const n = Math.max(0, towerCount);
  const mul = Math.min(PLACEMENT_GROWTH ** n, PLACEMENT_MAX_MUL);
  return Math.round(baseCost * placementStageMul(stageId) * mul);
}

/**
 * 소품 제거 비용 — 이미 치운 개수(0-base)에 따라 지수적으로 오른다.
 * 곡선은 balance.SCENERY_CLEAR_{BASE_COST,GROWTH,MAX_COST}가 유일한 출처다
 * (여기에 수치를 복사해 두면 반드시 낡는다 — 실제로 BASE 80→120 상향 때 낡았다).
 * 현재 값 기준 개별가는 balance.ts SCENERY_CLEAR_BASE_COST 주석에 적혀 있다.
 */
export function sceneryClearCostFor(clearedCount: number): number {
  const raw = SCENERY_CLEAR_BASE_COST * SCENERY_CLEAR_GROWTH ** Math.max(0, clearedCount);
  return Math.min(SCENERY_CLEAR_MAX_COST, Math.round(raw));
}

export class Economy {
  private freeUsed = false;
  private paidCount = 0;

  refreshCost(): number {
    if (!this.freeUsed) return 0;
    return Math.round(REFRESH_BASE * REFRESH_GROWTH ** this.paidCount);
  }

  private draw(ctx: SimCtx): CardState | null {
    const deck = ctx.opts.deck;
    if (deck.length === 0) return null;
    const id = deck[ctx.rng.int(0, deck.length - 1)] as TowerId;
    const tier0 = ctx.opts.towerDefs[id].tiers[0];
    const base = tier0 ? tier0.cost : 0;
    return {
      towerId: id,
      cost: placementCostFor(base, ctx.world.towers.items.length, ctx.opts.stage.id),
    };
  }

  /** 배치/판매로 타워 수가 바뀐 후 — 전 핸드 실비용 재계산 (handChanged 발행) */
  recalcCosts(ctx: SimCtx): void {
    const count = ctx.world.towers.items.length;
    for (const c of ctx.view.hand) {
      const tier0 = ctx.opts.towerDefs[c.towerId].tiers[0];
      c.cost = placementCostFor(tier0 ? tier0.cost : 0, count, ctx.opts.stage.id);
    }
    ctx.events.push({ type: 'handChanged' });
  }

  /** 전투 시작 시 초기 핸드 채우기 */
  fillHand(ctx: SimCtx): void {
    while (ctx.view.hand.length < HAND_SIZE) {
      const c = this.draw(ctx);
      if (!c) break;
      ctx.view.hand.push(c);
    }
    this.sync(ctx);
  }

  /** 웨이브 시작 — 무료 새로고침 리셋 */
  onWaveStart(ctx: SimCtx): void {
    this.freeUsed = false;
    this.paidCount = 0;
    this.sync(ctx);
  }

  /** 카드 배치 직후 해당 슬롯 보충 + 전 핸드 실비용 재계산 */
  onPlaced(ctx: SimCtx, handIndex: number): void {
    const c = this.draw(ctx);
    if (c) ctx.view.hand[handIndex] = c;
    else ctx.view.hand.splice(handIndex, 1);
    this.recalcCosts(ctx);
  }

  tryRefresh(ctx: SimCtx): boolean {
    const cost = this.refreshCost();
    if (cost > ctx.view.gold) return false;
    if (cost > 0) {
      addGold(ctx, -cost);
      this.paidCount++;
    } else {
      this.freeUsed = true;
    }
    const hand = ctx.view.hand;
    for (let i = 0; i < hand.length; i++) {
      const c = this.draw(ctx);
      if (c) hand[i] = c;
    }
    this.sync(ctx);
    ctx.events.push({ type: 'handChanged' });
    return true;
  }

  private sync(ctx: SimCtx): void {
    ctx.view.refreshCost = this.refreshCost();
  }
}
