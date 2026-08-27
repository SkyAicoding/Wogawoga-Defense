/** 경제 — 핸드 유지/보충, 무료→증가 새로고침, 배치/업그레이드/판매 환급, 골드 부족 거부 */
import { describe, expect, it } from 'vitest';
import { UPGRADE_GROWTH, UPGRADE_MAX_MUL } from '@/data/balance';
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

  /**
   * ⚠⚠ **이 계약은 2026-08-27 에 뒤집혔다** — 옛 이름은
   *   "업그레이드 비용 = tiers[t+1].cost" 였고, 그 등식이 **거짓**이 됐다.
   *   사용자 지시로 경제의 압력이 배치 축에서 업그레이드 축으로 옮겨졌다:
   *     > "타워 재생산 비용 동결, 업그레이드시 타워 비용 증가,
   *     >  다음 스테이지 시 전 스테이지보다 초기 생산값 올리기"
   *   지금 규칙: 실비용 = `round(tiers[t+1].cost × min(UPGRADE_GROWTH^m, UPGRADE_MAX_MUL))`,
   *   `m` = **이 판에서 지금까지 성사된 업그레이드 횟수**.
   *
   * 문턱을 푼 것이 아니라 **재는 성질이 늘었다**. 옛 계약이 잠그던 것(티어표를 읽는다 ·
   * 표시가와 실제 차감이 같다 · invested/환급)은 전부 그대로 두고, 세 가지를 더 잠근다:
   *   ① `m` 이 실제로 곱해진다 (둘째 업그레이드가 티어표보다 비싸다)
   *   ② **표시가와 실제 차감이 한 골드도 안 어긋난다** — 이 저장소가 반복해서 당한
   *      "화면과 실제가 다른" 꼴이 여기서 나면 안 된다
   *   ③ 상수를 원본에서 import 해서 **식을 베끼지 않는다**(CLAUDE.md 「처방」).
   *      `UPGRADE_GROWTH` 를 1 로 되돌리면 ①이 즉시 빨개진다.
   */
  it('업그레이드 실비용 = 티어표 × UPGRADE_GROWTH^(판 누적 횟수), 환급 = invested 60% 내림', () => {
    const sim = createBattle(options());
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 });
    const towerId = sim.state.towers[0]?.id as number;

    // 첫 업그레이드는 m=0 이라 티어표 그대로다 — 곧 이 축은 **옛 동작 위에 얹힌다**
    const first = sim.upgradeCost(towerId) as number;
    expect(first, 'm=0 이면 티어표 값(40) 그대로여야 한다').toBe(40);
    let gold = sim.state.gold;
    expect(sim.applyCommand({ type: 'upgradeTower', towerId })).toBe(true);
    expect(gold - sim.state.gold, '표시가와 실제 차감이 다르다').toBe(first);
    expect(sim.state.towers[0]?.tier).toBe(1);

    // 둘째는 m=1 — 식을 베끼지 않고 상수에서 유도한다
    const second = sim.upgradeCost(towerId) as number;
    const expected = Math.round(60 * Math.min(UPGRADE_GROWTH ** 1, UPGRADE_MAX_MUL));
    expect(second, `tiers[2].cost(60) × ${UPGRADE_GROWTH}^1`).toBe(expected);
    expect(second, '판 누적 횟수가 안 곱해졌다 — 상승이 죽었다').toBeGreaterThan(60);
    gold = sim.state.gold;
    expect(sim.applyCommand({ type: 'upgradeTower', towerId })).toBe(true);
    expect(gold - sim.state.gold, '표시가와 실제 차감이 다르다').toBe(second);

    // 환급은 **실제로 낸 값**을 따라간다 (티어표 합이 아니다)
    const invested = 50 + first + second;
    expect(sim.sellRefund(towerId)).toBe(Math.floor(invested * 0.6));
    gold = sim.state.gold;
    expect(sim.applyCommand({ type: 'sellTower', towerId })).toBe(true);
    expect(sim.state.gold).toBe(gold + Math.floor(invested * 0.6));
    expect(sim.towerAt(3, 1)).toBeNull();
  });

  /**
   * 세는 단위가 **판 전체**라는 것 자체가 계약이다. 타워별로 세면 배치가 동결된 지금
   * "새 타워를 세워 1티어씩만 올리는" 회피가 **공짜**가 된다(economy.ts `upgradeCostFor` ⚠).
   */
  it('업그레이드 횟수는 타워별이 아니라 판 전체로 센다', () => {
    const sim = createBattle(options({ stage: stageDef({ startGold: 100_000 }) }));
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 });
    const a = sim.state.towers[0]?.id as number;
    // ⚠ **둘째 타워를 먼저 세우고 그 값을 읽어 둔다** — 기준값을 티어표에서 베끼지 않고
    //   sim 이 실제로 답한 값(m=0)에서 가져오기 위해서다(CLAUDE.md 「식을 베끼지 마라」).
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 });
    const b = sim.state.towers[1]?.id as number;
    expect(b, '둘째 타워가 안 세워졌다 — 이 계약이 성립하지 않는다').not.toBe(a);
    const bBase = sim.upgradeCost(b) as number;

    // **다른 타워**를 한 번 올린다. b 는 아직 한 번도 안 올렸다.
    expect(sim.applyCommand({ type: 'upgradeTower', towerId: a })).toBe(true);

    const bCost = sim.upgradeCost(b) as number;
    expect(bCost, '남이 올렸는데 내 값이 그대로다 = 타워별로 세고 있다(회피 가능)').toBe(
      Math.round(bBase * Math.min(UPGRADE_GROWTH ** 1, UPGRADE_MAX_MUL)),
    );
    expect(bCost, '판 누적이 안 걸렸다').toBeGreaterThan(bBase);
  });

  /**
   * 거부된 시도는 값을 **안 올린다**. 안 그러면 골드가 모자란 채 버튼을 여러 번 누른 것만으로
   * 값이 뛰어 "누르지도 못했는데 비싸졌다"가 된다(battle.ts `onUpgraded` 는 성사 뒤에만 부른다).
   */
  it('골드가 모자라 거부된 업그레이드는 값을 안 올린다', () => {
    const sim = createBattle(options());
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 });
    const towerId = sim.state.towers[0]?.id as number;
    const before = sim.upgradeCost(towerId);
    sim.state.gold = 0;
    for (let i = 0; i < 5; i++) {
      expect(sim.applyCommand({ type: 'upgradeTower', towerId })).toBe(false);
    }
    expect(sim.upgradeCost(towerId), '거부가 값을 올렸다').toBe(before);
  });

  /**
   * **자리 교환** — 사용자 요구로 '선두 우선' 버튼이 빠지고 그 자리에 들어온 조작이다:
   *   > "선두 우선 버튼은 별 필요 없는것 같아. 대신이 서로 위치 교환 할수 있도록 해줘.
   *   >  물론 비용을 내고 교환 해야지"
   *
   * 이 계약이 잠그는 것은 **"타워가 이사하는 것이지 내용물이 바뀌는 것이 아니다"** 하나다.
   * 자리만 맞바뀌고 티어·HP·투자금은 각자 따라가야 한다 — 이 둘을 헷갈리면 교환이
   * "키운 타워를 안 키운 타워로 만드는" 버그가 된다. 그래서 **서로 다른 티어**로 재고,
   * 자리뿐 아니라 **내용물이 안 섞였는지**까지 되읽는다.
   */
  it('자리 교환 — 자리만 바뀌고 티어·HP·투자금은 각자 따라간다', () => {
    const sim = createBattle(options({ stage: stageDef({ startGold: 100_000 }) }));
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 });
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 });
    const a = sim.state.towers[0]!;
    const b = sim.state.towers[1]!;
    // 한쪽만 두 번 키운다 — 티어가 갈려야 '내용물이 섞였는지'를 잴 수 있다
    sim.applyCommand({ type: 'upgradeTower', towerId: a.id });
    sim.applyCommand({ type: 'upgradeTower', towerId: a.id });
    const before = {
      aId: a.id, aCell: [a.cellX, a.cellZ], aTier: a.tier, aHp: a.hp, aInv: a.invested,
      bId: b.id, bCell: [b.cellX, b.cellZ], bTier: b.tier, bHp: b.hp, bInv: b.invested,
    };
    expect(before.aTier, '두 타워의 티어가 같으면 이 계약이 공허하다').not.toBe(before.bTier);

    const gold = sim.state.gold;
    expect(sim.applyCommand({ type: 'swapTowers', aId: a.id, bId: b.id })).toBe(true);
    expect(gold - sim.state.gold, '교환 값이 안 빠졌다').toBe(sim.swapCost());

    // 자리는 **맞바뀌었다**
    const a2 = sim.state.towers.find((t) => t.id === before.aId)!;
    const b2 = sim.state.towers.find((t) => t.id === before.bId)!;
    expect([a2.cellX, a2.cellZ], 'a 가 b 자리로 안 갔다').toEqual(before.bCell);
    expect([b2.cellX, b2.cellZ], 'b 가 a 자리로 안 갔다').toEqual(before.aCell);
    // 그 칸을 조회하면 **바뀐 타워**가 나온다 (판이 실제로 그렇게 보인다)
    expect(sim.towerAt(before.bCell[0]!, before.bCell[1]!)?.id).toBe(before.aId);
    expect(sim.towerAt(before.aCell[0]!, before.aCell[1]!)?.id).toBe(before.bId);
    // 내용물은 **안 섞였다**
    expect(a2.tier, 'a 의 티어가 b 것이 됐다').toBe(before.aTier);
    expect(b2.tier, 'b 의 티어가 a 것이 됐다').toBe(before.bTier);
    expect(a2.hp).toBe(before.aHp);
    expect(b2.hp).toBe(before.bHp);
    expect(a2.invested).toBe(before.aInv);
    expect(b2.invested).toBe(before.bInv);
    // 조준은 풀린다 — 자리가 바뀌면 사거리 안이던 적이 밖으로 나간다
    expect(a2.targetId).toBe(-1);
    expect(b2.targetId).toBe(-1);
  });

  /**
   * 거부 경로 셋. **거부되면 골드가 한 톨도 안 나가야 한다** — 안 그러면 잘못 누른
   * 탭이 조용히 결제된다(placement.ts 가 2단 무장을 쓰는 이유와 같은 자리).
   */
  it('자리 교환 거부 — 같은 타워 · 없는 타워 · 골드 부족', () => {
    const sim = createBattle(options({ stage: stageDef({ startGold: 100_000 }) }));
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 3, cellZ: 1 });
    sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 });
    const a = sim.state.towers[0]!.id;
    const b = sim.state.towers[1]!.id;

    let gold = sim.state.gold;
    expect(sim.applyCommand({ type: 'swapTowers', aId: a, bId: a }), '자기 자신과 교환').toBe(false);
    expect(sim.applyCommand({ type: 'swapTowers', aId: a, bId: 9999 }), '없는 타워').toBe(false);
    expect(sim.state.gold, '거부인데 골드가 나갔다').toBe(gold);

    sim.state.gold = sim.swapCost() - 1;
    gold = sim.state.gold;
    expect(sim.applyCommand({ type: 'swapTowers', aId: a, bId: b }), '골드 부족').toBe(false);
    expect(sim.state.gold, '거부인데 골드가 나갔다').toBe(gold);
    // 딱 맞는 골드면 된다 (문턱이 한 칸 어긋나 있지 않은지)
    sim.state.gold = sim.swapCost();
    expect(sim.applyCommand({ type: 'swapTowers', aId: a, bId: b })).toBe(true);
    expect(sim.state.gold).toBe(0);
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
