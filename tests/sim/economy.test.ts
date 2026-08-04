/** 경제 — 핸드 유지/보충, 무료→증가 새로고침, 배치/업그레이드/판매 환급, 골드 부족 거부 */
import { describe, expect, it } from 'vitest';
import { createBattle } from '@/sim/battle';
import { options, stageDef } from './fixtures';

describe('economy', () => {
  it('초기 핸드 3장 + 배치 시 즉시 보충', () => {
    const sim = createBattle(options());
    expect(sim.state.hand).toHaveLength(3);
    for (const c of sim.state.hand) {
      expect(c.towerId).toBe('spear'); // 덱이 spear 뿐
      expect(c.cost).toBe(50); // tiers[0].cost
    }
    expect(
      sim.applyCommand({ type: 'placeTower', handIndex: 1, cellX: 3, cellZ: 1 }),
    ).toBe(true);
    expect(sim.state.hand).toHaveLength(3); // 즉시 보충
    expect(sim.state.gold).toBe(950);
  });

  it('새로고침 — 웨이브당 1회 무료, 이후 20×1.6^n 반올림', () => {
    const sim = createBattle(options());
    expect(sim.state.refreshCost).toBe(0);
    expect(sim.applyCommand({ type: 'refreshHand' })).toBe(true); // 무료
    expect(sim.state.gold).toBe(1000);
    expect(sim.state.refreshCost).toBe(20);
    expect(sim.applyCommand({ type: 'refreshHand' })).toBe(true);
    expect(sim.state.gold).toBe(980);
    expect(sim.state.refreshCost).toBe(32); // 20×1.6
    expect(sim.applyCommand({ type: 'refreshHand' })).toBe(true);
    expect(sim.state.gold).toBe(948);
    expect(sim.state.refreshCost).toBe(51); // round(20×1.6²=51.2)
  });

  it('새로고침 — 웨이브 시작 시 무료 리셋', () => {
    const sim = createBattle(options());
    sim.applyCommand({ type: 'refreshHand' });
    expect(sim.state.refreshCost).toBe(20);
    sim.applyCommand({ type: 'callWave' });
    sim.tick(); // 웨이브 시작
    expect(sim.state.phase).toBe('wave');
    expect(sim.state.refreshCost).toBe(0);
  });

  it('업그레이드 비용 = tiers[t+1].cost, 판매 환급 = invested 60% 내림', () => {
    const sim = createBattle(options());
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 });
    const towerId = sim.state.towers[0]?.id as number;
    expect(sim.upgradeCost(towerId)).toBe(40); // tiers[1].cost
    expect(sim.applyCommand({ type: 'upgradeTower', towerId })).toBe(true);
    expect(sim.state.gold).toBe(1000 - 50 - 40);
    expect(sim.state.towers[0]?.tier).toBe(1);
    expect(sim.upgradeCost(towerId)).toBe(60); // tiers[2].cost
    expect(sim.sellRefund(towerId)).toBe(Math.floor(90 * 0.6)); // invested 90 → 54
    expect(sim.applyCommand({ type: 'sellTower', towerId })).toBe(true);
    expect(sim.state.gold).toBe(910 + 54);
    expect(sim.towerAt(3, 1)).toBeNull();
  });

  it('최대 티어에서 업그레이드 불가', () => {
    const sim = createBattle(options());
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 });
    const towerId = sim.state.towers[0]?.id as number;
    for (let i = 0; i < 4; i++) {
      expect(sim.applyCommand({ type: 'upgradeTower', towerId })).toBe(true);
    }
    expect(sim.state.towers[0]?.tier).toBe(4);
    expect(sim.upgradeCost(towerId)).toBeNull();
    expect(sim.applyCommand({ type: 'upgradeTower', towerId })).toBe(false);
  });

  it('골드 부족 — 배치/새로고침 거부', () => {
    const sim = createBattle(options({ stage: stageDef({ startGold: 10 }) }));
    expect(
      sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 }),
    ).toBe(false);
    expect(sim.state.gold).toBe(10);
    expect(sim.state.towers).toHaveLength(0);
    expect(sim.applyCommand({ type: 'refreshHand' })).toBe(true); // 무료는 가능
    expect(sim.applyCommand({ type: 'refreshHand' })).toBe(false); // 20 > 10
  });

  it('점유 셀/범위 밖 배치 거부', () => {
    const sim = createBattle(options());
    expect(sim.canPlaceAt(3, 1)).toBe(true);
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 });
    expect(sim.canPlaceAt(3, 1)).toBe(false); // 점유됨
    expect(sim.canPlaceAt(-1, 0)).toBe(false);
    expect(sim.canPlaceAt(99, 0)).toBe(false);
  });
});
