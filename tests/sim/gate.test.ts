/**
 * 문간 교전 (src/sim/gate.ts) — **종료 보장이 1순위다.**
 *
 * 이 파일이 잠그는 것은 다섯이고, 순서에 뜻이 있다:
 *  ① **종료** — 문 앞의 적은 HP·스턴·힐·봉쇄 그 무엇과도 무관하게 상한 안에 반드시
 *     문간을 떠난다. `updateGate` 의 `gateTicks++` 를 조건부로 만들거나 상한을 없애면
 *     여기가 빨개진다. (gate.ts §종료 증명의 **실행 가능한 형태**다)
 *  ② **총량 항등식** — Σ(한 입) + (뚫고 들어갈 때의 잔액) = `e.baseDamage`. 언제나, 정확히.
 *     이것이 성립하는 동안 밸런스는 근사가 아니라 **정의상** 보존된다.
 *  ③ **기하** — 6스테이지 전 종이 마을 Lv1 사거리(2.0) 안에 서고, 몸 앞끝이 구조물
 *     고리(1.0) 밖이다. 실제 판에서 나온 `enemyAtGate` 좌표로 잰다.
 *  ④ **[5] 방치 판의 유도** — `5.wave = 4` 는 "w3 compy 가 문 앞에서 **안 죽는다**"라는
 *     11HP 여유 위에 서 있다. 문턱을 지키는 게 아니라 **문턱이 서 있는 유도**를 지킨다.
 *  ⑤ **되돌리기** — `stage.gate.enabled = false` 면 종전 동작으로 정확히 돌아간다.
 *
 * ⚠ 이 파일이 초록이 되기 전에는 봉투를 돌리지 마라 (설계 §8 착수 순서 3).
 */
import { describe, expect, it } from 'vitest';
import type { EnemyId, SimEvent, StatusInstance } from '@/data/types';
import {
  GATE_BITE_AMOUNT,
  GATE_BITE_TICKS,
  GATE_FAN_COLS,
  GATE_HOLD_MAX_TICKS,
  GATE_HOLD_MIN_TICKS,
  GATE_STANDOFF_EDGE,
} from '@/data/balance';
import { ENEMY_DEFS } from '@/data/enemies';
import { BASE_LEVELS } from '@/data/hometown';
import { STAGES } from '@/data/stages';
// ⚠ 렌더 상수를 **직접 읽는다.** 옛 잣대는 이 숫자를 손으로 베낀 `1.0` 이었고 그 값은
//   구조물이 놓인 **중심 고리**라 마을 바깥끝(1.45)과 0.45 만큼 어긋나 있었다 —
//   그래서 적 메시가 움막을 뚫는데 이 파일은 초록이었다. 베끼면 같은 착오가 다시 통과한다.
import { BASECAMP_MAX_RADIUS } from '@/render/meshlib/basecamp';
import { createBattle } from '@/sim/battle';
import { allyDefs, enemyDefs, options, runTicks, stageDef, wave } from './fixtures';
import { makeBotSimFor } from './botharness';

/** 이 개체의 체류 상한 — gate.holdTicksFor 와 **같은 식**이다(SimCtx 없이 검산하려고 다시 쓴다) */
function holdOf(baseDamage: number): number {
  return Math.min(GATE_HOLD_MAX_TICKS, Math.max(GATE_HOLD_MIN_TICKS, baseDamage * GATE_BITE_TICKS));
}

function eventsOf<K extends SimEvent['type']>(
  ev: readonly SimEvent[],
  type: K,
): Extract<SimEvent, { type: K }>[] {
  return ev.filter((e) => e.type === type) as Extract<SimEvent, { type: K }>[];
}

// ---------------------------------------------------------------------------
// ① 종료 보장 — 이 파일의 존재 이유
// ---------------------------------------------------------------------------
describe('① 종료 보장 — 문 앞의 적은 반드시 떠난다', () => {
  /**
   * **불사 적.** 죽일 수 없고(hp 10^9 · armor 10^9 · 방패 10^9), 매 틱 완전 회복되고,
   * 매 틱 새 스턴이 걸리고, 매 틱 아군에게 붙잡혀 있다 — 곧 `updateGate` 안에서
   * `gateTicks++` 뒤에 오는 **모든 분기를 동시에 참으로** 만든 상태다.
   *
   * 그래도 상한에 닿아 `enemyLeaked` 로 나가야 한다. 안 나가면 그 판은 영영 안 끝난다.
   *
   * ⚠ 이 세 줄(회복·스턴·봉쇄)을 지우면 테스트가 쉬워지는 것이 아니라 **아무것도 안
   *   재게 된다**. gate-wip 의 교착 증명은 정확히 이 셋 중 하나(주술사 힐)에서 죽었다.
   */
  it('힐 + 영구 스턴 + 영구 봉쇄 + 불사 HP 여도 상한 안에 뚫고 들어간다', () => {
    const baseDamage = 12; // trex — 상한이 걸리는 가장 긴 종
    const sim = createBattle(
      options({
        // 붙잡기만 하고 아무것도 안 죽이는 아군 — 사거리 3 이라 문 앞의 적에 확실히 닿는다
        allyDefs: allyDefs({ clubber: { hp: 1e9, dmg: 0, range: 3, blocks: true, cost: 10 } }),
        enemyDefs: enemyDefs({
          trex: { hp: 1e9, armor: 1e9, shieldHits: 1e9, speed: 3, baseDamage, radius: 0.8 },
        }),
        stage: stageDef({ waveCount: 1, baseHp: 1e9, startGold: 10_000 }),
        waves: [wave([{ enemyId: 'trex', count: 1 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });

    const seen: SimEvent[] = [];
    let arrivedAt = -1;
    let leftAt = -1;
    let bites = 0;
    let owed = -1;
    const LIMIT = 4_000; // 상한 360 의 11배 — 여기까지 안 나가면 그건 무한 루프다
    for (let t = 0; t < LIMIT && leftAt < 0; t++) {
      // ── 적대적 개입: 문 앞에 선 **뒤부터** 세 분기를 전부 참으로 만든다 ──────────
      //   ⚠ 걷는 동안 걸면 애초에 문 앞에 도달하지 못해 검증이 공허해진다
      //     (스턴이면 안 걷고, 봉쇄면 안 걷는다 — 그게 오늘의 규칙이다).
      if (arrivedAt >= 0) {
        for (const e of sim.state.enemies) {
          e.hp = e.maxHp; // 주술사 힐 오라보다 강한 회복
          e.shieldHitsLeft = 1e9; // 방패 소진 카운트다운 무력화
          const stun: StatusInstance = { kind: 'stun', magnitude: 0, remainingTicks: 9_999, acc: 0 };
          e.statuses.length = 0;
          e.statuses.push(stun); // 규칙 8) 스턴 — 쿨다운도 안 흐른다
        }
      }
      sim.tick();
      const ev = sim.drainEvents();
      seen.push(...ev);
      for (const x of ev) {
        if (x.type === 'enemyAtGate') {
          arrivedAt = t;
          // 봉쇄는 **진짜 아군**으로 건다 — `blockerAllyId` 를 밖에서 쓰면 다음 틱의
          // `updateAllies` 가 첫 줄에서 전부 지워(allies.ts:547) 개입이 조용히 사라진다.
          for (let k = 0; k < 3; k++) sim.applyCommand({ type: 'trainAlly', defId: 'clubber' });
        }
        if (x.type === 'gateBite') bites++;
        if (x.type === 'enemyLeaked') {
          leftAt = t;
          owed = x.baseDamage;
        }
      }
    }

    // 검증이 공허하지 않은지 먼저 — 실제로 문 앞에 서 봤고, 개입이 실제로 먹었어야 한다
    expect(arrivedAt, '문 앞에 서지도 못했다 — 이 테스트는 아무것도 안 쟀다').toBeGreaterThanOrEqual(0);
    expect(eventsOf(seen, 'enemyDied'), '불사 적이 죽었다 — 개입이 안 먹었다').toHaveLength(0);
    expect(bites, '봉쇄가 안 걸렸다 — 진입 틱의 한 입 말고 더 물었다면 개입이 헛돌았다').toBe(1);
    // ── 본 검증 ────────────────────────────────────────────────────────────
    expect(leftAt, `상한(${holdOf(baseDamage)}틱) 안에 안 나갔다 = 판이 영영 안 끝난다`).toBeGreaterThanOrEqual(0);
    expect(leftAt - arrivedAt, '체류 틱').toBeLessThanOrEqual(holdOf(baseDamage) + 1);
    // 봉쇄는 **유예이지 면제가 아니다** — 못 문 11 이 돌파 순간 한 방에 청구된다
    expect(owed, '잔액이 면제되면 몽둥이꾼 여섯으로 누수를 0 으로 만드는 착취가 생긴다').toBe(baseDamage - 1);
  });

  /**
   * 상한은 **개체 상태가 아니라 상수**다 — 붙잡혀 한 번도 못 문 개체와 전부 문 개체의
   * 체류가 **같은 틱 수**여야 한다. 그것이 보조정리 A 의 요지다.
   */
  it('봉쇄로 한 입도 못 물어도 체류 길이는 똑같다 (봉쇄는 유예이지 면제가 아니다)', () => {
    const run = (block: boolean): { hold: number; owed: number; bites: number } => {
      const sim = createBattle(
        options({
          allyDefs: allyDefs({ clubber: { hp: 1e9, dmg: 0, range: 3, blocks: true, cost: 10 } }),
          enemyDefs: enemyDefs({ mammoth: { hp: 1e9, speed: 3, baseDamage: 3, radius: 0.62 } }),
          stage: stageDef({ waveCount: 1, baseHp: 1e9, startGold: 10_000 }),
          waves: [wave([{ enemyId: 'mammoth', count: 1 }])],
        }),
      );
      sim.applyCommand({ type: 'callWave' });
      let arrivedAt = -1;
      let leftAt = -1;
      let owed = -1;
      let bites = 0;
      for (let t = 0; t < 2_000 && leftAt < 0; t++) {
        sim.tick();
        for (const x of sim.drainEvents()) {
          if (x.type === 'enemyAtGate') {
            arrivedAt = t;
            if (block) for (let k = 0; k < 3; k++) sim.applyCommand({ type: 'trainAlly', defId: 'clubber' });
          }
          if (x.type === 'gateBite') bites++;
          if (x.type === 'enemyLeaked') {
            leftAt = t;
            owed = x.baseDamage;
          }
        }
      }
      expect(arrivedAt).toBeGreaterThanOrEqual(0);
      return { hold: leftAt - arrivedAt, owed, bites };
    };
    const free = run(false);
    const held = run(true);
    expect(free.hold, '체류는 전투 결과와 무관한 상수다').toBe(held.hold);
    expect(free.bites, '자유로우면 3번 문다').toBe(3);
    expect(free.owed, '다 물었으니 잔액 0').toBe(0);
    expect(held.bites, '진입 틱의 한 입만 나간다 — 그 틱은 구조적으로 봉쇄가 아니다').toBe(1);
    expect(held.owed, '나머지 2 는 뚫고 들어갈 때 한 방에').toBe(2);
    // ⚠ 총량은 어느 쪽이든 같다 — 그것이 ②다
    expect(free.bites * GATE_BITE_AMOUNT + free.owed).toBe(3);
    expect(held.bites * GATE_BITE_AMOUNT + held.owed).toBe(3);
  });

  /**
   * 상한이 **주기 주입에도 잘린다** — `gate.biteTicks` 를 터무니없이 키워도
   * `clamp` 의 상한이 값과 무관하게 자른다(보조정리 B 의 `leakDamage` 줄과 같은 논거).
   */
  it('주기를 1000배로 주입해도 체류가 GATE_HOLD_MAX_TICKS 를 못 넘는다', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ trex: { hp: 1e9, speed: 3, baseDamage: 12, radius: 0.8 } }),
        stage: stageDef({
          waveCount: 1,
          baseHp: 1e9,
          gate: { biteTicks: 30_000 },
        }),
        waves: [wave([{ enemyId: 'trex', count: 1 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    let arrivedAt = -1;
    let leftAt = -1;
    for (let t = 0; t < 5_000 && leftAt < 0; t++) {
      sim.tick();
      for (const x of sim.drainEvents()) {
        if (x.type === 'enemyAtGate') arrivedAt = t;
        if (x.type === 'enemyLeaked') leftAt = t;
      }
    }
    expect(arrivedAt).toBeGreaterThanOrEqual(0);
    expect(leftAt - arrivedAt).toBeLessThanOrEqual(GATE_HOLD_MAX_TICKS + 1);
  });

  /**
   * 진짜 판 — 6스테이지 실제 데이터로 웨이브가 끝나는지. `wavetermination.test.ts` 가
   * 50웨이브 전량을 재므로 여기서는 **문간이 실제로 걸리는** 짧은 구간만 확인한다.
   */
  it('실제 스테이지1 — 문 앞에 선 개체가 전부 퇴장한다 (도착 = 죽음 + 돌파)', () => {
    const sim = makeBotSimFor(STAGES[0]!, 4242, ['spear', 'catapult', 'frost']);
    const arrivals = new Set<number>();
    const exits = new Set<number>();
    for (let w = 0; w < 6; w++) {
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      for (let t = 0; t < 6_000; t++) {
        sim.state.baseHp = sim.state.baseHpMax; // 패배로 조기 종료되지 않게
        sim.tick();
        for (const x of sim.drainEvents()) {
          if (x.type === 'enemyAtGate') arrivals.add(x.enemyId);
          if (x.type === 'enemyLeaked' || x.type === 'enemyDied') exits.add(x.enemyId);
        }
        if (t > 2 && sim.state.phase === 'prep') break;
      }
    }
    expect(arrivals.size, '문 앞에 선 적이 하나도 없다 — 공허한 검증이다').toBeGreaterThan(0);
    for (const id of arrivals) expect(exits.has(id), `적 ${id} 가 문 앞에 남았다`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② 총량 항등식 — 밸런스가 정의상 보존된다는 것의 실행 가능한 형태
// ---------------------------------------------------------------------------
describe('② 총량 항등식 — Σ(한 입) + 잔액 = baseDamage', () => {
  it('처치되지 않은 개체 전부에서 성립한다 (16종 혼성)', () => {
    const species: EnemyId[] = ['compy', 'raptor', 'ptera', 'trike', 'mammoth', 'spino', 'trex'];
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({
          compy: { hp: 1e6, speed: 2, baseDamage: 1, radius: 0.22 },
          raptor: { hp: 1e6, speed: 2, baseDamage: 1, radius: 0.3 },
          ptera: { hp: 1e6, speed: 2, baseDamage: 1, radius: 0.32, flying: true },
          trike: { hp: 1e6, speed: 2, baseDamage: 2, radius: 0.52 },
          mammoth: { hp: 1e6, speed: 2, baseDamage: 3, radius: 0.62 },
          spino: { hp: 1e6, speed: 2, baseDamage: 5, radius: 0.7 },
          trex: { hp: 1e6, speed: 2, baseDamage: 12, radius: 0.8 },
        }),
        stage: stageDef({ waveCount: 1, baseHp: 1e9 }),
        waves: [wave(species.map((enemyId) => ({ enemyId, count: 2, intervalTicks: 7 })))],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 1_200);

    const bitten = new Map<number, number>();
    for (const b of eventsOf(ev, 'gateBite')) {
      expect(b.amount, '한 입은 언제나 GATE_BITE_AMOUNT 다').toBe(GATE_BITE_AMOUNT);
      bitten.set(b.enemyId, (bitten.get(b.enemyId) ?? 0) + b.amount);
    }
    const leaks = eventsOf(ev, 'enemyLeaked');
    expect(leaks.length, '아무도 안 뚫고 들어왔다 — 공허한 검증이다').toBeGreaterThan(0);
    for (const l of leaks) {
      const owedTotal = (bitten.get(l.enemyId) ?? 0) + l.baseDamage;
      const def = { compy: 1, raptor: 1, ptera: 1, trike: 2, mammoth: 3, spino: 5, trex: 12 }[
        l.defId as 'compy'
      ];
      expect(owedTotal, `${l.defId} 총량`).toBe(def);
    }
    // 마을이 실제로 받은 총 피해도 같은 값이어야 한다 (이벤트가 아니라 **상태**로 검산)
    const dealt = eventsOf(ev, 'baseDamaged').reduce((a, b) => a + b.amount, 0);
    const expected = species.reduce(
      (a, id) => a + 2 * { compy: 1, raptor: 1, ptera: 1, trike: 2, mammoth: 3, spino: 5, trex: 12 }[id as 'compy'],
      0,
    );
    expect(dealt).toBe(expected);
  });

  it('문 앞에서 죽으면 잔액은 면제된다 — 그리고 그것이 유일한 면제다', () => {
    const sim = createBattle(
      options({
        // 마을이 쏜다: dmg 50 · cd 5 → 90틱 체류 동안 확실히 죽는다
        baseLevels: [
          { cost: 0, hpMul: 1, dmg: 50, cooldownTicks: 5, range: 3, allyCap: 0 },
        ],
        // hp 400: 접근 구간(사거리 3 → 문간 1.95)에서는 안 죽고 문 앞에서 죽는다
        enemyDefs: enemyDefs({ trex: { hp: 400, speed: 3, baseDamage: 12, radius: 0.8 } }),
        stage: stageDef({ waveCount: 1, baseHp: 1e9 }),
        waves: [wave([{ enemyId: 'trex', count: 1 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 800);
    const died = eventsOf(ev, 'enemyDied');
    expect(died, '문 앞에서 안 죽었다 — 이 테스트는 아무것도 안 쟀다').toHaveLength(1);
    expect(died[0]?.gateTicks, '문 앞에서 죽은 개체는 체류 틱을 싣는다').toBeGreaterThan(0);
    expect(eventsOf(ev, 'enemyLeaked'), '죽었으면 뚫고 들어가지 않는다').toHaveLength(0);
    const bites = eventsOf(ev, 'gateBite').length;
    expect(bites, '죽기 전까지만 문다').toBeLessThan(12);
    expect(bites, '진입 틱의 첫 입은 반드시 나간다').toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// ③ 기하 — 실제 판에서 나온 좌표로 잰다
// ---------------------------------------------------------------------------
describe('③ 기하 — 6스테이지 전 종이 마을 Lv1 사거리 안에 선다', () => {
  const LV1_RANGE = BASE_LEVELS[0]!.range;
  /**
   * **마을 메시의 바깥끝** — 이 안으로 몸 앞끝이 들어오면 적이 움막·목책을 관통한다.
   *
   * ⚠⚠ 옛 값은 `1.0`(하드코딩)이었고 그것은 구조물이 **놓인 고리**(중심선)였다.
   *   같은 파일의 실제 바깥끝은 `BASECAMP_MAX_RADIUS` = 1.45 이고 목책만 해도
   *   `WALL_R` = 1.28 이다. 곧 이 잣대는 0.45 만큼 안쪽을 재고 있었고, `GATE_STANDOFF_EDGE`
   *   1.15 는 목책보다도 0.13 안쪽이라 **테스트는 초록인데 그림이 틀렸다**.
   *   이제 렌더 상수를 직접 읽으므로 마을 메시가 커지면 이 계약이 먼저 빨개진다.
   */
  const STRUCTURE_RING = BASECAMP_MAX_RADIUS;

  for (const stage of STAGES) {
    it(`s${stage.id}: 중심거리 = ${GATE_STANDOFF_EDGE} + radius · Lv1 사거리 ${LV1_RANGE} 안 · 앞끝 ≥ ${STRUCTURE_RING}`, () => {
      const sim = makeBotSimFor(stage, 777, ['spear', 'catapult', 'frost']);
      let n = 0;
      for (let w = 0; w < 12; w++) {
        if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
        for (let t = 0; t < 6_000; t++) {
          sim.state.baseHp = sim.state.baseHpMax;
          sim.tick();
          for (const x of sim.drainEvents()) {
            if (x.type !== 'enemyAtGate') continue;
            n++;
            const r = ENEMY_DEFS[x.defId].radius;
            const d = Math.hypot(x.x - stage.baseCell.x, x.z - stage.baseCell.z);
            // 규칙 2 — 중심거리가 **정확히** `GATE_STANDOFF_EDGE + radius` 다.
            //   부채는 회전이라 길이를 안 바꾸고, 판 밖이면 좌표를 자르는 대신 접는다 —
            //   곧 위아래 두 줄이 함께 "정확히 같다"를 잠근다.
            expect(d, `${x.defId} 중심거리`).toBeGreaterThanOrEqual(GATE_STANDOFF_EDGE + r - 1e-6);
            expect(d, `${x.defId} 중심거리`).toBeLessThanOrEqual(GATE_STANDOFF_EDGE + r + 1e-6);
            // ⚠⚠ 이 한 줄이 "홈타운이 적을 공격한다"를 첫 레벨에서 성립시킨다
            expect(d, `${x.defId} 가 Lv1 사거리 밖이다`).toBeLessThan(LV1_RANGE);
            // ⚠⚠ 메시가 **마을 바깥끝 밖**에 선다. 이 한 줄이 "적이 움막을 뚫는다"를 닫는다
            expect(d - r, `${x.defId} 몸 앞끝`).toBeGreaterThanOrEqual(STRUCTURE_RING - 1e-6);
            // 맵 밖으로 나가지 않는다
            expect(x.x).toBeGreaterThanOrEqual(0.5);
            expect(x.x).toBeLessThanOrEqual(stage.gridW - 0.5);
            expect(x.z).toBeGreaterThanOrEqual(0.5);
            expect(x.z).toBeLessThanOrEqual(stage.gridH - 0.5);
          }
          if (t > 2 && sim.state.phase === 'prep') break;
        }
      }
      expect(n, `s${stage.id}: 문 앞에 선 적이 0마리 — 공허한 검증이다`).toBeGreaterThan(0);
    }, 120_000);
  }

  /**
   * ── §D) 같은 종이 픽셀 단위로 포개지지 않는다 ────────────────────────────
   * 자리는 (종의 반경 → 중심거리) × (id → 부채 자리) 두 값이 정한다. 같은 종은 반경이
   * 같으므로 **부채 자리가 같아지는 순간 좌표가 비트 단위로 일치**한다. 옛 3줄에서는
   * 랩터 여덟 마리가 3·3·2 로 세 자리에 겹쳐, 띠에는 "랩터 ×8"인데 화면에는 실루엣이
   * 셋만 보였다 — 이 다리가 그 회귀를 잡는다.
   *
   * 잣대를 "겹치지 않는다"가 아니라 **"같은 자리가 아니다"** 로 두는 이유: 큰 종은
   * 몸통 지름이 호장보다 커서 일부 겹치는 것이 정상이고(그건 무리로 읽힌다),
   * 문제였던 것은 좌표의 **완전 일치**다.
   */
  it('연속으로 스폰된 같은 종 아홉 마리가 문 앞에서 전부 다른 자리에 선다 (§D)', () => {
    const N = GATE_FAN_COLS;
    // ⚠ 판을 세로로 넉넉히 준다. 좁은 판에서는 **부채 접기**(규칙 2-b)가 바깥 자리를
    //   반대쪽으로 되접어 두 마리가 한 자리에 설 수 있다 — 그건 이 다리가 재는 것이
    //   아니라 "메시가 마을을 안 뚫는다"를 지키려고 일부러 치르는 대가다.
    const wide = stageDef({
      waveCount: 1,
      baseHp: 1e9,
      gridH: 9,
      layout: Array.from({ length: 9 }, () => 'oooooooooo'),
      paths: [[{ x: 0, z: 4 }, { x: 9, z: 4 }]],
      baseCell: { x: 9, z: 4 },
    });
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { hp: 1e6, speed: 3, baseDamage: 4, radius: 0.3 } }),
        stage: wide,
        waves: [wave([{ enemyId: 'raptor', count: N, intervalTicks: 2 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const at = eventsOf(runTicks(sim, 900), 'enemyAtGate');
    expect(at, `${N}마리가 전부 문 앞에 서야 이 검증이 공허하지 않다`).toHaveLength(N);
    const spots = at.map((a) => `${a.x.toFixed(6)},${a.z.toFixed(6)}`);
    expect(new Set(spots).size, `같은 종이 같은 자리에 겹쳤다 — ${spots.join(' | ')}`).toBe(N);
    // 그리고 부채는 **원 위**다 — 자리가 갈려도 중심거리는 한 톨도 안 흔들린다
    const ds = at.map((a) => Math.hypot(a.x - wide.baseCell.x, a.z - wide.baseCell.z));
    for (const d of ds) expect(d, '부채가 중심거리를 바꿨다').toBeCloseTo(ds[0]!, 6);
  });

  it('공중(ptera)도 같은 규칙 — 예외 분기가 없다 (G3)', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ ptera: { hp: 1e6, speed: 2, baseDamage: 1, radius: 0.32, flying: true } }),
        stage: stageDef({ waveCount: 1, baseHp: 1e9 }),
        waves: [wave([{ enemyId: 'ptera', count: 1 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const at = eventsOf(ev, 'enemyAtGate');
    expect(at, '공중이 문 앞에 안 섰다').toHaveLength(1);
    expect(at[0]?.holdTicks, '아군이 절대 못 붙잡으므로 체류가 결정론적 상수다').toBe(GATE_HOLD_MIN_TICKS);
    expect(eventsOf(ev, 'gateBite'), '공중도 문다').toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ④ [5] 방치 판의 유도 — 문턱이 아니라 문턱이 서 있는 근거를 지킨다
// ---------------------------------------------------------------------------
describe('④ [5] 방치 판 — 유도를 직접 잠근다', () => {
  /**
   * ⚠⚠ `GATE_HOLD_MIN_TICKS` 의 허용 구간. 이 밖으로 나가면 s1 방치 판 w3 의 compy 가
   * 문 앞에서 **죽기 시작해** `5.wave = 4` 가 5~6 으로 밀린다 (balance.ts 의 유도 표).
   * 위험 2(폭발 타워 강화)의 완화책이 손대는 나사가 정확히 이 값이라, 두 위험이 같은
   * 나사를 반대 방향으로 당긴다 — 그래서 구간을 코드로 못박는다.
   */
  it('GATE_HOLD_MIN_TICKS 는 [60, 120] 이다', () => {
    expect(GATE_HOLD_MIN_TICKS).toBeGreaterThanOrEqual(60);
    expect(GATE_HOLD_MIN_TICKS).toBeLessThanOrEqual(120);
  });

  /**
   * ── ⚠⚠ 이 유도는 `GATE_BITE_TICKS` 30 → 60 에서 **다시 썼다** ────────────────
   * 옛 문장은 "마을 Lv1 은 문 앞에서 **한 마리도 못 죽인다**"였고 근거는
   *   s1 방치 w3 의 compy 실HP 43 대 (체류 90틱 = 3발 24) + 접근 8 = 32 < 43
   * 이었다. 주기가 60 이 되면서 compy(s1 `leakDamage` 덮어쓰기로 총액 3)의 체류가
   * `3 × 60` = **180틱** 이 되고, 마을은 그 안에 5~6발을 쏜다 — 실측으로 **죽인다**
   * (w3 compy 1마리, `gateTicks = 132`).
   *
   * ── 그런데 `5.wave` 는 안 움직였다. 왜인가 (실측이 확정한 새 유도) ──────────
   * 옛 문장이 지키려던 것은 "문 앞의 죽음"이 아니라 **그 웨이브의 누수 총액**이다.
   * 총액은 `gateOwed` 잔액 방식이라 **다 물고 나면 더 줄지 않는다**: 총액 `n` 인 개체의
   * 마지막 한 입은 `gateTicks = (n − 1) × 주기 + 1` 에 나가고, 그 뒤의 죽음은 청구서에
   * 한 글자도 안 남긴다. compy 는 1·61·**121** 틱에 3 을 전부 물었고 마을은 **132틱**에
   * 죽였다 — 곧 **빚을 다 받은 뒤의 죽음**이라 누수가 한 톨도 안 줄었다.
   * 실측 HP 궤적도 그대로다: w1시작 25 → w2 23 → w3 21 → w4 **9** → w4 에서 패배.
   *
   * 그래서 이 테스트가 잠그는 문장을 **누수가 줄지 않는다**로 옮긴다. "안 죽는다"는
   * 그것의 옛 충분조건 하나였을 뿐이고, 주기가 바뀌면 성립하지 않는 우연이었다.
   * 새 형태는 주기·체류·마을 화력이 어떻게 바뀌어도 뜻이 같다.
   */
  it('방치 판의 문 앞 죽음은 언제나 **총액을 다 문 뒤**다 (누수 총액이 안 줄어 5.wave 가 안 밀린다)', () => {
    const stage = STAGES[0]!;
    const sim = makeBotSimFor(stage, 20260825, ['spear']);
    /** 이 스테이지에서 이 종이 실제로 청구하는 총액 (`StageDef.leakDamage` 덮어쓰기 반영) */
    const owedOf = (id: EnemyId): number => stage.leakDamage?.[id] ?? ENEMY_DEFS[id].baseDamage;
    let arrivals = 0;
    let gateKills = 0;
    const early: string[] = [];
    let lostWave = -1;
    for (let w = 0; w < 8 && lostWave < 0; w++) {
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      for (let t = 0; t < 6_000; t++) {
        sim.tick(); // 타워 0기 · 부족원 0명 · 레벨업 0회 = 완전 방치
        for (const x of sim.drainEvents()) {
          if (x.type === 'enemyAtGate') arrivals++;
          if (x.type === 'enemyDied' && x.gateTicks !== undefined) {
            gateKills++;
            // 마지막 한 입의 틱 = (총액 − 1) × 주기 + 1. 그보다 **뒤**에 죽어야 빚이 다 걷힌다
            const lastBite = (owedOf(x.defId) - 1) * GATE_BITE_TICKS + 1;
            if (x.gateTicks < lastBite) early.push(`${x.defId} ${x.gateTicks} < ${lastBite}`);
          }
          if (x.type === 'battleEnded' && !x.won) lostWave = x.wave;
        }
        if (lostWave >= 0) break;
        if (t > 2 && sim.state.phase === 'prep') break;
      }
    }
    expect(arrivals, '방치 판인데 문 앞에 선 적이 0 — 공허한 검증이다').toBeGreaterThan(0);
    // ⚠⚠ 이 한 줄이 [5] 의 새 유도다. 총액을 다 물기 **전에** 죽는 개체가 하나라도
    //   생기면 그 웨이브의 누수가 줄고 `5.wave` 가 밀린다 — 다리를 깨는 것이 아니라
    //   다리가 재는 대상이 옮겨진다.
    expect(early, '문 앞의 적이 총액을 다 물기 전에 죽었다 → [5] 의 유도가 무너진다').toEqual([]);
    // 그리고 그 죽음이 실제로 일어나야 이 검증이 공허하지 않다 (주기 60 의 실측)
    expect(gateKills, '문 앞에서 아무도 안 죽으면 위 검사가 공허하다 — 유도가 통째로 바뀐 것이다')
      .toBeGreaterThan(0);
    // 총량이 불변이므로 지는 웨이브도 그대로다
    expect(lostWave, '방치 패배 웨이브').toBe(4);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// ⑤ 되돌리기 · 풀 재사용
// ---------------------------------------------------------------------------
describe('⑤ 되돌리기 대조군과 풀 재사용', () => {
  it('gate.enabled = false 면 종전 동작으로 정확히 돌아간다', () => {
    const mk = (enabled: boolean) => {
      const sim = createBattle(
        options({
          enemyDefs: enemyDefs({ trex: { hp: 1e6, speed: 3, baseDamage: 12, radius: 0.8 } }),
          stage: stageDef({ waveCount: 1, baseHp: 1e9, gate: { enabled } }),
          waves: [wave([{ enemyId: 'trex', count: 1 }])],
        }),
      );
      sim.applyCommand({ type: 'callWave' });
      // ⚠ 창은 **주기의 함수**다. 총액 12 를 다 물려면 마지막 한 입이 11 × 주기 + 1 에
      //   나가므로, 접근 시간까지 덮으려면 그보다 넉넉해야 한다(600 고정이면 주기가
      //   30 → 60 이 된 순간 9 번만 세고 조용히 빨개진다 — 실제로 그랬다).
      return runTicks(sim, 12 * GATE_BITE_TICKS + 400);
    };
    const off = mk(false);
    expect(eventsOf(off, 'enemyAtGate'), '꺼졌으면 문 앞에 안 선다').toHaveLength(0);
    expect(eventsOf(off, 'gateBite'), '꺼졌으면 안 문다').toHaveLength(0);
    const offLeak = eventsOf(off, 'enemyLeaked');
    expect(offLeak).toHaveLength(1);
    // 종전 그대로 — 도달 한 방에 baseDamage 전액
    expect(offLeak[0]?.baseDamage).toBe(12);
    expect(eventsOf(off, 'baseDamaged').map((b) => b.amount)).toEqual([12]);

    const on = mk(true);
    expect(eventsOf(on, 'enemyAtGate')).toHaveLength(1);
    // 켜져도 **총량은 같다** — 12번에 나눠 낼 뿐이다
    expect(eventsOf(on, 'baseDamaged').reduce((a, b) => a + b.amount, 0)).toBe(12);
    expect(eventsOf(on, 'gateBite')).toHaveLength(12);
  });

  it('풀 재사용 — 앞사람의 문간 상태가 새 개체에 새지 않는다', () => {
    // 5마리를 차례로 보낸다. 슬롯이 재사용되므로 잔액이 안 지워지면 뒷사람이 0 을 청구한다
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { hp: 1e6, speed: 3, baseDamage: 2, radius: 0.3 } }),
        stage: stageDef({ waveCount: 1, baseHp: 1e9 }),
        waves: [wave([{ enemyId: 'raptor', count: 5, intervalTicks: 140 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 1_600);
    const at = eventsOf(ev, 'enemyAtGate');
    expect(at).toHaveLength(5);
    for (const a of at) expect(a.owed, '새 개체는 언제나 총액이 baseDamage 다').toBe(2);
    expect(eventsOf(ev, 'gateBite')).toHaveLength(10);
    expect(eventsOf(ev, 'baseDamaged').reduce((a, b) => a + b.amount, 0)).toBe(10);
  });

  it('한 입의 주기가 정확히 GATE_BITE_TICKS 다 (첫 입은 도착 틱)', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ trex: { hp: 1e6, speed: 3, baseDamage: 12, radius: 0.8 } }),
        stage: stageDef({ waveCount: 1, baseHp: 1e9 }),
        waves: [wave([{ enemyId: 'trex', count: 1 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 800);
    const ticks = eventsOf(ev, 'gateBite').map((b) => b.gateTicks);
    expect(ticks[0], '첫 입은 도착 틱(gateTicks = 1)에 즉시').toBe(1);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!, `${i}번째 간격`).toBe(GATE_BITE_TICKS);
    }
  });
});
