/**
 * 문간 띠 뷰모델 — **HUD 판단의 유일한 자동 검증**이다.
 *
 * 왜 여기인가: 이 저장소에는 jsdom 이 없어(vitest environment: 'node' —
 * tests/ui/input.test.ts 헤더) `battlehud.ts` 는 자동 검증이 원리적으로 불가능하다.
 * 지금까지 그래도 됐던 이유는 그 안의 일이 "값을 문자열로 바꿔 넣는다" 정도였기
 * 때문인데, 문간 띠는 다르다 — **누구를 대표로 그리는가 · 언제 경보인가 ·
 * 돌파까지 몇 초인가**는 판단이고, 틀리면 화면이 조용히 거짓말을 한다.
 * gate-wip 이 정확히 그 사고를 냈다(막대는 초록인데 배지는 "4입 남음"이라
 * 한 화면에서 두 경보가 서로 다른 말을 했다).
 */
import { describe, expect, it } from 'vitest';
import { GATE_BREACH_IMMINENT_TICKS, gateBandModel, pickGateLead } from '@/ui/screens/gateband';
import type { GateFoe } from '@/ui/screens/gateband';

function foe(o: Partial<GateFoe> = {}): GateFoe {
  return {
    id: 1,
    defId: 'raptor',
    alive: true,
    gateTicks: 10,
    gateOwed: 1,
    baseDamage: 1,
    blockerAllyId: -1,
    statuses: [],
    ...o,
  };
}

/** 배포 기본값의 체류 상한 — clamp(90, 360, baseDamage × 30) */
const hold = (f: GateFoe): number => Math.min(360, Math.max(90, f.baseDamage * 30));

function model(enemies: readonly GateFoe[], o: Partial<Parameters<typeof gateBandModel>[0]> = {}) {
  return gateBandModel({
    enemies,
    baseHp: 25,
    baseHpMax: 25,
    phase: 'wave',
    allyCount: 2,
    holdTicksOf: hold,
    ...o,
  });
}

describe('문간 띠 뷰모델', () => {
  it('문 앞에 아무도 없으면 띠를 접는다', () => {
    expect(model([]).visible).toBe(false);
    expect(model([foe({ gateTicks: 0 })]).visible).toBe(false);
    expect(model([foe({ alive: false })]).visible).toBe(false);
  });

  it('승패가 확정되면 접는다 — 조작이 거부되는데 살아 있는 척하지 않는다', () => {
    expect(model([foe()], { phase: 'lost' }).visible).toBe(false);
    expect(model([foe()], { phase: 'won' }).visible).toBe(false);
  });

  it('마릿수와 빚 합계는 문 앞에 선 것만 센다', () => {
    const m = model([
      foe({ id: 1, gateOwed: 3, baseDamage: 3 }),
      foe({ id: 2, gateOwed: 5, baseDamage: 5 }),
      foe({ id: 3, gateTicks: 0, gateOwed: 9, baseDamage: 9 }), // 아직 걷는 중
      foe({ id: 4, alive: false, gateOwed: 9, baseDamage: 9 }),
    ]);
    expect(m.count).toBe(2);
    expect(m.owedTotal).toBe(8);
  });

  /**
   * 대표는 **지금 마을에 가장 위험한 놈**이다.
   * gate-wip 은 "가장 먼저 물 놈"(쿨다운 최소)을 골랐는데, 그때는 문 앞이 보스 둘뿐이라
   * 성립했다. 이번 설계는 종을 안 가려 문 앞이 열몇 마리라 쿨다운 최소는 매 틱
   * 주인이 바뀐다 — 아이콘과 이름이 초당 수십 번 갈아 끼워져 읽을 수 없다.
   */
  it('대표는 빚이 가장 큰 놈이다 (동률이면 먼저 뚫는 쪽 → 낮은 id)', () => {
    const trex = foe({ id: 9, defId: 'trex', gateOwed: 9, baseDamage: 12, gateTicks: 100 });
    const compy = foe({ id: 2, defId: 'compy', gateOwed: 1, baseDamage: 1, gateTicks: 88 });
    expect(pickGateLead([compy, trex], hold)?.id).toBe(9);
    expect(pickGateLead([trex, compy], hold)?.id).toBe(9); // 순회 순서에 안 기댄다

    const soon = foe({ id: 5, gateOwed: 2, baseDamage: 2, gateTicks: 80 }); // 돌파까지 10
    const later = foe({ id: 6, gateOwed: 2, baseDamage: 2, gateTicks: 10 }); // 돌파까지 80
    expect(pickGateLead([later, soon], hold)?.id).toBe(5);

    const tieA = foe({ id: 8, gateOwed: 2, baseDamage: 2, gateTicks: 40 });
    const tieB = foe({ id: 3, gateOwed: 2, baseDamage: 2, gateTicks: 40 });
    expect(pickGateLead([tieA, tieB], hold)?.id).toBe(3);
  });

  /**
   * ⚠ 이 띠가 파는 가장 중요한 사실이다. 오늘까지는 "도착 = 즉시 한 방"이라
   * 예고가 원리적으로 불가능했다 — 문간이 처음으로 **예고**를 만들었다.
   * 경보를 비율(30%)이 아니라 빚으로 재는 이유: 문 앞에서 행동을 바꾸는 사실이
   * "몇 % 남았나"가 아니라 **"이대로면 지는가"** 하나이기 때문이다.
   */
  it('빚 합계가 마을 HP 이상이면 경보다 (doomed)', () => {
    expect(model([foe({ gateOwed: 12, baseDamage: 12 })], { baseHp: 25 }).doomed).toBe(false);
    expect(model([foe({ gateOwed: 12, baseDamage: 12 })], { baseHp: 12 }).doomed).toBe(true);
    const two = [
      foe({ id: 1, gateOwed: 5, baseDamage: 5 }),
      foe({ id: 2, gateOwed: 5, baseDamage: 5 }),
    ];
    expect(model(two, { baseHp: 11 }).doomed).toBe(false);
    expect(model(two, { baseHp: 10 }).doomed).toBe(true);
  });

  it('빚이 0이면 경보가 아니다 — 뚫려도 마을은 한 톨도 안 깎인다', () => {
    const paid = [foe({ id: 1, gateOwed: 0 }), foe({ id: 2, gateOwed: 0 })];
    const m = model(paid, { baseHp: 1 });
    expect(m.visible).toBe(true); // 서 있는 것은 여전히 보여야 한다
    expect(m.owedTotal).toBe(0);
    expect(m.doomed).toBe(false);
    expect(m.imminent).toBe(false);
  });

  /**
   * **봉쇄는 유예이지 면제가 아니다**(src/sim/gate.ts 규칙 8).
   * 이 띠에서 가장 위험한 거짓말이 "붙잡는 중"을 초록으로만 그리는 것이다 —
   * 그 사이에도 `gateTicks` 는 흐르고 상한에서 남은 빚이 **한 방에** 떨어진다.
   */
  it('붙잡혀 있어도 돌파 게이지는 계속 찬다', () => {
    const held = foe({ gateOwed: 9, baseDamage: 12, gateTicks: 200, blockerAllyId: 3 });
    const m = model([held]);
    expect(m.held).toBe(true);
    expect(m.breachTicks).toBe(160); // 360 − 200
    expect(m.breachFrac).toBeCloseTo(200 / 360, 6);
    // 더 오래 붙잡아도 시계는 멈추지 않는다
    const later = model([{ ...held, gateTicks: 340 }]);
    expect(later.breachTicks).toBe(20);
    expect(later.breachFrac).toBeGreaterThan(m.breachFrac);
  });

  it('기절도 봉쇄와 같다 — 안 물지만 시계는 흐른다', () => {
    const m = model([
      foe({ gateOwed: 4, baseDamage: 5, gateTicks: 100, statuses: [{ kind: 'stun', remainingTicks: 20 }] }),
    ]);
    expect(m.stunned).toBe(true);
    expect(m.breachTicks).toBe(50); // 150 − 100
  });

  it('끝난 상태 효과는 기절로 안 친다', () => {
    const m = model([foe({ statuses: [{ kind: 'stun', remainingTicks: 0 }] })]);
    expect(m.stunned).toBe(false);
  });

  it('돌파가 임박하고 갚을 빚이 남았을 때만 경보다', () => {
    const near = { gateOwed: 3, baseDamage: 12, gateTicks: 360 - GATE_BREACH_IMMINENT_TICKS };
    expect(model([foe(near)]).imminent).toBe(true);
    expect(model([foe({ ...near, gateTicks: near.gateTicks - 1 })]).imminent).toBe(false);
    // 빚을 다 갚았으면 뚫려도 마을이 안 깎인다 → 경보가 아니다
    expect(model([foe({ ...near, gateOwed: 0 })]).imminent).toBe(false);
  });

  /**
   * 체류 상한은 스테이지가 덮어쓸 수 있어(types.ts `GateSpec.holdMinTicks`) UI 가
   * 폴링으로 못 구한다. 모르면 **아는 척하지 않는다** — 게이지만 접고 나머지는 그린다.
   */
  it('체류 상한을 모르면 돌파 게이지만 접는다', () => {
    const m = model([foe({ gateOwed: 7, baseDamage: 12 })], { holdTicksOf: () => 0 });
    expect(m.visible).toBe(true);
    expect(m.knownBreach).toBe(false);
    expect(m.breachTicks).toBe(0);
    expect(m.breachFrac).toBe(0);
    expect(m.imminent).toBe(false);
    expect(m.owedTotal).toBe(7); // 빚·마릿수·마을 HP 는 그대로 정확하다
    expect(m.count).toBe(1);
  });

  it('상한을 아는 개체가 모르는 개체보다 먼저 대표가 된다 (빚 동률에서)', () => {
    const known = foe({ id: 7, gateOwed: 2, baseDamage: 2, gateTicks: 80 });
    const unknown = foe({ id: 2, gateOwed: 2, baseDamage: 2, gateTicks: 80 });
    const pick = pickGateLead([unknown, known], (f) => (f.id === 7 ? 90 : 0));
    expect(pick?.id).toBe(7);
  });

  it('마을 HP 비율은 음수·0 분모에서도 무너지지 않는다', () => {
    expect(model([foe()], { baseHp: -5 }).hpFrac).toBe(0);
    expect(model([foe()], { baseHp: 3, baseHpMax: 0 }).hpFrac).toBe(3);
    expect(model([foe()], { baseHp: -5 }).baseHp).toBe(0);
  });

  it('되부를 부족원이 없으면 집결 버튼을 비활성으로 본다', () => {
    expect(model([foe()], { allyCount: 0 }).canRally).toBe(false);
    expect(model([foe()], { allyCount: 1 }).canRally).toBe(true);
  });
});
