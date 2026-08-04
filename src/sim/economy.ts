/**
 * 경제 — 핸드 3장 유지(덱에서 rng 드로우, 배치 시 즉시 보충),
 * 새로고침(웨이브당 1회 무료, 이후 20×1.6^n 반올림, 웨이브 시작 시 무료 리셋),
 * 판매 환급 = invested의 60% 내림.
 * 배치 지가 상승: 배치 비용 = round(tiers[0].cost × (1 + PLACEMENT_TAX × 배치된 타워 수)).
 * 핸드 CardState.cost는 항상 '지금 배치 시 실비용' — 드로우/새로고침 시 계산하고
 * 타워 배치/판매 후 전 핸드를 재계산한다.
 */
import type { CardState, TowerId } from '@/data/types';
import { PLACEMENT_TAX } from '@/data/balance';
import { addGold } from './combat';
import type { SimCtx } from './entities';

export const HAND_SIZE = 3;
const REFRESH_BASE = 20;
const REFRESH_GROWTH = 1.6;
const SELL_RATE = 0.6;

export function sellRefundFor(invested: number): number {
  return Math.floor(invested * SELL_RATE);
}

/** 배치 지가 — 현재 배치된 타워 수 기준 실비용 */
export function placementCostFor(baseCost: number, towerCount: number): number {
  return Math.round(baseCost * (1 + PLACEMENT_TAX * towerCount));
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
    return { towerId: id, cost: placementCostFor(base, ctx.world.towers.items.length) };
  }

  /** 배치/판매로 타워 수가 바뀐 후 — 전 핸드 실비용 재계산 (handChanged 발행) */
  recalcCosts(ctx: SimCtx): void {
    const count = ctx.world.towers.items.length;
    for (const c of ctx.view.hand) {
      const tier0 = ctx.opts.towerDefs[c.towerId].tiers[0];
      c.cost = placementCostFor(tier0 ? tier0.cost : 0, count);
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
