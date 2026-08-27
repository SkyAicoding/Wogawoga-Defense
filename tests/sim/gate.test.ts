/**
 * 문간 교전 (src/sim/gate.ts) — **종료 보장이 1순위다.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ **이 파일의 ①·②·④·⑤ 는 2026-08-27 에 통째로 뒤집혔다.** 잣대를 지운 것이
 *   아니라 **부호를 뒤집었다** — 없어진 성질을 "없다"로 재는 항목으로 바꿔 두면,
 *   누군가 그 동작을 되돌렸을 때 이 파일이 **다시** 빨개져서 그 사실을 말해 준다.
 *   (`tests/e2e/smoke.spec.ts` 의 "이 절은 정확히 뒤집혔다" · `siege.test.ts` 의
 *    자동 수리 항목이 같은 문체의 선례다.)
 *
 * ── 바뀐 것 ① : 체류 상한과 총액 상한이 **둘 다 없어졌다** ──────────────────
 * 사용자 지시 원문:
 *   > "공룡이 홈타운을 공격할때, 적 공룡 hp 가 남아 있는데도, 몇대 맞다가 죽는게
 *   >  있어. 그러지 말고, hp 만큼 계속해서 살아서 홈 타운을 공격 하도록 해줘."
 * 구현: `updateGate` 의 `gateTicks >= holdTicksFor → leakEnemy` 분기 삭제 ·
 *       `gateOwed <= 0 → continue` 삭제 · `bite()` 의 `min(GATE_BITE_AMOUNT, gateOwed)`
 *       → `GATE_BITE_AMOUNT` 고정.
 * **잃은 것(정직하게 적는다)**:
 *   · 보조정리 A("모든 적의 문간 체류 ≤ `GATE_HOLD_MAX_TICKS`")가 **거짓**이 됐다.
 *   · 총량 항등식(`Σ한 입 + 잔액 = baseDamage`)이 **없어졌다**. 한 개체가 마을에
 *     넣는 피해는 이제 **그 개체가 살아 있는 시간**이 정한다.
 *   · `enemyLeaked`(뚫고 들어가기)는 문간이 켜진 판에서 **한 번도 안 일어난다** —
 *     `gate.enabled = false` 대조군에만 남았다.
 * **새 종료 논거**: 문 앞의 개체는 매 `GATE_BITE_TICKS` 마다 마을 HP 를
 *   `GATE_BITE_AMOUNT` 씩 깎으므로, 아무도 못 죽여도 마을이 유한 틱에 죽는다 —
 *   곧 "적이 죽거나 **마을이 죽거나**" 둘 중 하나로 끝난다. ①-e 가 그것을 직접 잰다.
 *
 * ── 바뀐 것 ② : 문간 도착이 **순간이동에서 걸어 들어가기로** 바뀌었다 ────────
 * 사용자 지시 원문:
 *   > "공룡이 홈타운에 도착해서 공격을 할때 동작이 매우 부자연스러워. 갑자기
 *   >  화면에서 공룡이 이동해서 나타나는 것처럼 보여."
 * 구현: `standAt` 이 `e.x/e.z`(+`prevX/prevZ`)에 좌표를 박던 것을 없애고, 부채꼴
 *       자리를 `e.gateTgtX/gateTgtZ` 에 **적어 두기만** 한다. `updateGate` 가 매 틱
 *       `speed × TICK_DT` 로 그 자리를 향해 걸어간다.
 * **그래서 ③(기하)의 잣대가 바뀐다**: `enemyAtGate` 이벤트의 좌표는 **도착 틱의
 *   좌표**이고 그때는 아직 경로 위다. 정지 기하는 **다 걸어 들어간 뒤에만** 성립한다.
 *   문턱은 한 톨도 안 내렸다 — 재는 **시점**만 옮겼고, `settleGate` 헬퍼가 그 시점에
 *   실제로 도착했는지를 **단언**한다(안 그러면 "덜 온 상태"를 재고도 통과한다).
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 이 파일이 잠그는 것은 다섯이고, 순서에 뜻이 있다:
 *  ① **종료** — 문 앞의 적은 **안 떠난다**(상한이 없다). 끝내는 것은 마을 HP 다.
 *     `updateGate` 의 `gateTicks++` 는 여전히 무조건이어야 하고, 한 입은 여전히
 *     매 주기 나가야 한다 — 그 둘이 새 종료 논거의 전부다.
 *  ② **총량 항등식이 없다** — 한 입의 크기는 여전히 `GATE_BITE_AMOUNT` 고정이지만
 *     횟수에 상한이 없다. 잔액(`gateOwed`)은 0 에서 바닥을 치는 **표시용**이다.
 *  ③ **기하** — 6스테이지 전 종이 **몸 앞끝을 마을 바깥끝(1.45)에 대고** 선다.
 *     실제 판에서, **다 걸어 들어간 뒤의** 좌표로 잰다.
 *  ④ **[5] 방치 판의 유도** — 옛 유도(누수 총액 불변)가 통째로 사라졌다. 방치 패배는
 *     이제 `누수`가 아니라 **문 앞의 이빨**이 만든다.
 *  ⑤ **되돌리기** — `stage.gate.enabled = false` 면 종전 동작으로 정확히 돌아간다.
 *     ⚠ 이 대조군은 **하나도 안 바뀌었다** — 두 변경이 전부 문간 안쪽이기 때문이다.
 *
 * ⚠ 이 파일이 초록이 되기 전에는 봉투를 돌리지 마라 (설계 §8 착수 순서 3).
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '@/data/types';
import type { BattleSim, EnemyId, SimEvent, StatusInstance } from '@/data/types';
import {
  GATE_BITE_AMOUNT,
  GATE_BITE_TICKS,
  GATE_FAN_COLS,
  GATE_FAN_SPACING,
  GATE_HOLD_MAX_TICKS,
  GATE_HOLD_MIN_TICKS,
  GATE_STANDOFF_EDGE,
} from '@/data/balance';
import { ENEMY_DEFS } from '@/data/enemies';
import { STAGES } from '@/data/stages';
// ⚠ 렌더 상수를 **직접 읽는다.** 옛 잣대는 이 숫자를 손으로 베낀 `1.0` 이었고 그 값은
//   구조물이 놓인 **중심 고리**라 마을 바깥끝(1.45)과 0.45 만큼 어긋나 있었다 —
//   그래서 적 메시가 움막을 뚫는데 이 파일은 초록이었다. 베끼면 같은 착오가 다시 통과한다.
import { BASECAMP_MAX_RADIUS } from '@/render/meshlib/basecamp';
import { createBattle } from '@/sim/battle';
import type { EnemySim } from '@/sim/entities';
import { allyDefs, baseLevels, enemyDefs, options, runTicks, stageDef, wave } from './fixtures';
import { makeBotSimFor } from './botharness';

/**
 * **옛 체류 상한** — `gate.holdTicksFor` 와 같은 식이다.
 *
 * ⚠⚠ 이 값은 이제 **아무것도 자르지 않는다**(위 헤더 ①). 그래도 지우지 않는 이유는
 *   뒤집힌 항목들이 "그 선을 **넘는다**"를 재는 데 이 값을 쓰기 때문이다 — 문턱을
 *   내려서 초록을 만든 것이 아니라 **같은 선을 반대 방향으로** 쓴다는 증거를 코드에
 *   남긴다. `holdTicksFor` 는 아직 살아 있고 `enemyAtGate` 이벤트가 이 값을 싣는다.
 */
function holdOf(baseDamage: number): number {
  return Math.min(GATE_HOLD_MAX_TICKS, Math.max(GATE_HOLD_MIN_TICKS, baseDamage * GATE_BITE_TICKS));
}

function eventsOf<K extends SimEvent['type']>(
  ev: readonly SimEvent[],
  type: K,
): Extract<SimEvent, { type: K }>[] {
  return ev.filter((e) => e.type === type) as Extract<SimEvent, { type: K }>[];
}

/** 지금 판에 있는 그 개체 (`state.enemies` 는 `world.enemies.items` 그 배열이다) */
function findEnemy(sim: BattleSim, id: number): EnemySim | undefined {
  return (sim.state.enemies as EnemySim[]).find((e) => e.id === id);
}

/**
 * **정착했는가** — 부채꼴 자리에 다 걸어 들어갔는가.
 *
 * `gateTgtX/gateTgtZ` 는 `standAt` 이 진입 틱에 한 번 적고 그 뒤로 안 바뀌는 목표다.
 * `updateGate` 는 남은 거리가 `GATE_SETTLE_EPS2` 안이면 좌표를 **정확히 박으므로**,
 * 정착의 잣대는 근사가 아니라 **비트 단위 일치**다(그래야 해시에 부동소수 꼬리가 안 남는다).
 */
function isSettled(e: EnemySim): boolean {
  return e.gateTicks > 0 && e.x === e.gateTgtX && e.z === e.gateTgtZ;
}

/**
 * 걸어 들어가기에 넉넉한 창(틱). 실측 최장 **90틱**(s3, 6스테이지 12웨이브 전수)의 2.6배.
 * ⚠ 이 값을 키우는 것으로 빨강을 고치지 마라 — 안 정착하면 `settleGate` 가 **단언으로**
 *   빨개진다. 그 빨강은 "창이 좁다"가 아니라 "걸어 들어가기가 멈췄다"는 뜻이다.
 */
const SETTLE_TICKS = 240;

/**
 * ⚠⚠ **기하를 재기 전에 반드시 통과시키는 문** — 개체 `id` 가 자기 부채꼴 자리에
 * **다 걸어 들어갈 때까지** 돌리고, 정착을 **단언한 뒤** 그 개체를 돌려준다.
 *
 * 왜 단언이 필수인가: 도착 틱의 좌표는 아직 **경로 위**다(위 헤더 ②). 단언 없이 재면
 * "덜 온 상태"를 재고도 통과하는 공허한 계약이 된다 — 이 저장소가 세 번 당한 병
 * ("잣대가 재려는 것과 다른 것을 잰다")과 정확히 같은 모양이다.
 */
interface Settled {
  e: EnemySim;
  /** 자리에 들어가는 데 걸린 틱 */
  ticks: number;
  /** 도착 틱의 자리에서 실제로 걸어 들어간 거리(타일) */
  walked: number;
  /** 정착을 기다리는 동안 벌어진 일 (호출자가 놓치면 안 되는 이벤트가 여기 있다) */
  ev: SimEvent[];
}

function settleGate(
  sim: BattleSim,
  id: number,
  note = '',
  beforeTick?: () => void,
): Settled | null {
  const before = findEnemy(sim, id);
  expect(before, `${note} 개체 ${id} 가 판에 없다 — 정착을 잴 수 없다`).toBeDefined();
  const fromX = before!.x;
  const fromZ = before!.z;
  const ev: SimEvent[] = [];
  let ticks = 0;
  let e = findEnemy(sim, id);
  /*
   * ⚠⚠ **한 틱 이동량의 상한 = 걸음 속도 그 자체.** `updateGate` 는 `speed × TICK_DT`
   *   만큼만 옮긴다 — 곧 "걸어 들어간다"의 실행 가능한 정의가 이 한 줄이다.
   *   ⚠ 이 검사가 없으면 **한 틱에 자리로 순간이동**하는 구현이 조용히 통과한다:
   *     실측으로 확인했다 — 걷기 블록을 죽이면 `else` 가지가 좌표를 그 자리에서 박아
   *     "도착 틱 좌표와 다르다"만 보는 잣대는 **전부 초록**이었다.
   */
  const steps: number[] = [];
  while (ticks < SETTLE_TICKS && e !== undefined && !isSettled(e)) {
    const wasX = e.x;
    const wasZ = e.z;
    beforeTick?.();
    sim.tick();
    ev.push(...sim.drainEvents());
    ticks++;
    e = findEnemy(sim, id);
    if (e !== undefined) steps.push(Math.hypot(e.x - wasX, e.z - wasZ));
  }
  // 정착 전에 죽었다 — **잴 것이 없다**. 호출자가 공허성 가드로 이 경우 수를 센다.
  if (e === undefined) return null;
  // ── 이 세 줄이 "덜 온 상태를 쟀다"를 불가능하게 만든다 ──────────────────
  expect(isSettled(e), `${note} ${ticks}틱 안에 자리에 못 들어갔다`).toBe(true);
  expect(e.x, `${note} x 가 목표와 비트 단위로 같지 않다`).toBe(e.gateTgtX);
  expect(e.z, `${note} z 가 목표와 비트 단위로 같지 않다`).toBe(e.gateTgtZ);
  /*
   * ⚠ **마지막 한 걸음은 뺀다.** `updateGate` 는 남은 거리가 `GATE_SETTLE_EPS2` 안이면
   *   좌표를 **정확히 박는다**(부동소수 꼬리를 안 남기려고 — 해시가 그 꼬리에 걸린다).
   *   그 스냅 폭이 느린 종의 한 틱 걸음보다 클 수 있다 — 실측 s2 spino 0.0182 대 걸음
   *   0.0167. 그건 순간이동이 아니라 **정착의 마지막 한 틱**이므로 잣대에서 뺀다.
   *   ⚠ 대신 "한 틱 만에 자리를 잡았다"는 호출자가 `ticks > 1` 로 따로 잠근다 —
   *     여기서만 보면 스냅 한 번으로 끝내는 구현이 통과한다(실측으로 확인했다).
   */
  const stride = e.def.speed * TICK_DT;
  const walkSteps = steps.slice(0, -1);
  const maxStep = walkSteps.length > 0 ? Math.max(...walkSteps) : 0;
  expect(maxStep, `${note} 한 틱에 ${maxStep.toFixed(4)}타일 — 걸음 ${stride.toFixed(4)} 을 넘었다 = 순간이동이다`)
    .toBeLessThanOrEqual(stride + 1e-9);
  return { e, ticks, walked: Math.hypot(e.x - fromX, e.z - fromZ), ev };
}

// ---------------------------------------------------------------------------
// ① 종료 보장 — 이 파일의 존재 이유 (**논거가 바뀌었다**)
// ---------------------------------------------------------------------------
describe('① 종료 보장 — 문 앞의 적은 **안 떠난다**. 끝내는 것은 마을 HP 다', () => {
  /**
   * ⚠⚠ **이 항목은 정확히 뒤집혔다.** 옛 문장은 "상한 안에 반드시 `enemyLeaked` 로
   *   나간다"였고, 지금 재는 것은 **"영영 안 나간다"** 다.
   *   (사용자 지시: "hp 만큼 계속해서 살아서 홈 타운을 공격 하도록 해줘" — 위 헤더 ①)
   *
   * **불사 적.** 죽일 수 없고(hp 10^9 · armor 10^9 · 방패 10^9), 매 틱 완전 회복되고,
   * 매 틱 새 스턴이 걸리고, 매 틱 아군에게 붙잡혀 있다 — 곧 `updateGate` 안에서
   * `gateTicks++` 뒤에 오는 **모든 분기를 동시에 참으로** 만든 상태다.
   *
   * 옛 구현에서는 그래도 상한에 닿아 나갔다. 지금은 **나갈 문 자체가 없다**:
   * 죽지도 않고, 물지도 못하니 마을도 안 죽는다 — 이 개체는 판이 끝날 때까지 서 있다.
   * 그리고 그것이 **의도된 상태**다. 문 앞의 적은 이제 "반드시 죽여야 하는 것"이다.
   *
   * ⚠ 이 세 줄(회복·스턴·봉쇄)을 지우면 테스트가 쉬워지는 것이 아니라 **아무것도 안
   *   재게 된다**. gate-wip 의 교착 증명은 정확히 이 셋 중 하나(주술사 힐)에서 죽었다.
   * ⚠ **잃은 것**: "판이 영영 안 끝나는 상태는 없다"를 이 항목이 더는 못 잠근다.
   *   그 자리는 아래 ①-e(마을이 죽어서 끝난다)로 **옮겼다** — 거기가 새 논거다.
   */
  it('힐 + 영구 스턴 + 영구 봉쇄 + 불사 HP 면 **영영 안 나간다** — 상한이 사라졌다', () => {
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
    // ⚠ **끝까지 돈다.** 옛 판본은 `leftAt < 0` 을 루프 조건에 걸어 "나가면 멈췄다".
    //   지금은 나가는 것이 곧 회귀라, 창을 끝까지 돌려서 **안 나간다**를 재야 한다.
    const LIMIT = 4_000; // 옛 상한 720 의 5.5배
    for (let t = 0; t < LIMIT; t++) {
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
        if (x.type === 'enemyLeaked') leftAt = t;
      }
    }

    // 검증이 공허하지 않은지 먼저 — 실제로 문 앞에 서 봤고, 개입이 실제로 먹었어야 한다
    expect(arrivedAt, '문 앞에 서지도 못했다 — 이 테스트는 아무것도 안 쟀다').toBeGreaterThanOrEqual(0);
    expect(eventsOf(seen, 'enemyDied'), '불사 적이 죽었다 — 개입이 안 먹었다').toHaveLength(0);
    expect(bites, '봉쇄가 안 걸렸다 — 진입 틱의 한 입 말고 더 물었다면 개입이 헛돌았다').toBe(1);
    // ── 본 검증 (**뒤집힌 자리**) ───────────────────────────────────────────
    expect(leftAt, `상한(옛 ${holdOf(baseDamage)}틱)이 아직 살아 있다 — 동작이 되돌려졌다`).toBe(-1);
    const still = findEnemy(sim, sim.state.enemies[0]?.id ?? -1);
    expect(still, '문 앞의 적이 사라졌다 — 죽지도 나가지도 않아야 한다').toBeDefined();
    // 체류가 **옛 상한을 훌쩍 넘는다**. 문턱을 내린 것이 아니라 **같은 선을 반대로** 쓴다
    expect(still!.gateTicks, `체류 ${still!.gateTicks}틱 — 옛 상한 ${holdOf(baseDamage)}`)
      .toBeGreaterThan(holdOf(baseDamage));
    // 그리고 `gateTicks++` 는 여전히 **무조건**이다 — 새 종료 논거가 이 한 줄 위에 선다
    expect(still!.gateTicks, '체류 카운터가 창 길이만큼 정확히 흘렀다').toBe(LIMIT - arrivedAt);
  });

  /**
   * ── ①-e ── ⚠⚠ **새 종료 논거를 직접 잰다.** 위 항목이 잃은 자리가 여기다.
   *
   * 옛 논거(보조정리 A): "모든 적의 문간 체류 ≤ `GATE_HOLD_MAX_TICKS` → 유한".
   * 새 논거: 문 앞의 개체는 매 `GATE_BITE_TICKS` 마다 마을 HP 를 `GATE_BITE_AMOUNT`
   *   씩 깎는다. 회복 수단이 없으므로 마을 HP 는 **단조 감소**하고, 아무도 그 적을
   *   못 죽여도 `baseHp × biteTicks / GATE_BITE_AMOUNT` 틱 안에 0 이 된다.
   *   곧 "적이 죽거나 **마을이 죽거나**" 둘 중 하나로 유한하다.
   *
   * 그래서 여기서는 **아무도 못 죽이는 적**(hp/armor/방패 10^9)을 세우고, 아군도
   * 타워도 없이 둔다 — 남은 출구는 마을의 죽음 하나뿐이다. 그 출구가 실제로 열리는가,
   * 그리고 **위 상계 안에서** 열리는가를 잰다.
   *
   * 판별력: `bite()` 에 총액 상한(`gateOwed <= 0` → 그만 문다)을 되돌리면 마을이
   *   `baseDamage` 만큼만 깎이고 판이 영영 안 끝나 여기가 즉시 빨개진다.
   */
  it('①-e 마을이 죽어서 끝난다 — 상계 baseHp × biteTicks / 한 입 안에', () => {
    const baseHp = 20;
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({
          trex: { hp: 1e9, armor: 1e9, shieldHits: 1e9, speed: 3, baseDamage: 12, radius: 0.8 },
        }),
        stage: stageDef({ waveCount: 1, baseHp, startGold: 0 }),
        waves: [wave([{ enemyId: 'trex', count: 1 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    /** 새 논거의 상계 — 한 마리만 물어도 이 안에 끝난다 (여럿이면 더 빠르다) */
    const BOUND = (baseHp * GATE_BITE_TICKS) / GATE_BITE_AMOUNT;
    let arrivedAt = -1;
    let endedAt = -1;
    let won: boolean | undefined;
    let hpPrev = baseHp;
    for (let t = 0; t < BOUND * 3 && endedAt < 0; t++) {
      sim.tick();
      for (const x of sim.drainEvents()) {
        if (x.type === 'enemyAtGate') arrivedAt = t;
        if (x.type === 'baseDamaged') {
          // 마을 HP 는 **단조 감소**다 — 이 줄이 깨지면 상계의 유도가 통째로 무너진다
          expect(x.hpLeft, '마을 HP 가 되돌아갔다').toBeLessThan(hpPrev);
          hpPrev = x.hpLeft;
        }
        if (x.type === 'battleEnded') {
          endedAt = t;
          won = x.won;
        }
      }
    }
    // 공허하지 않은지 — 적은 실제로 문 앞에 섰고, 끝까지 **안 죽었고**, 안 나갔다
    expect(arrivedAt, '문 앞에 서지도 못했다').toBeGreaterThanOrEqual(0);
    expect(sim.state.enemies.length, '불사 적이 죽었다 — 그러면 이 출구를 안 쓴 것이다').toBe(1);
    // ── 본 검증 ────────────────────────────────────────────────────────────
    expect(endedAt, `상계 ${BOUND}틱 안에 판이 안 끝났다 = 새 종료 논거가 거짓이다`).toBeGreaterThanOrEqual(0);
    expect(won, '마을이 죽어서 끝나야 한다').toBe(false);
    expect(endedAt - arrivedAt, `문간 도착 → 패배 ${endedAt - arrivedAt}틱 (상계 ${BOUND})`)
      .toBeLessThanOrEqual(BOUND);
    expect(sim.state.baseHp, '마을 HP 가 0 이라야 그 출구다').toBe(0);
  });

  /**
   * ⚠⚠ **이 항목도 정확히 뒤집혔다.**
   *
   * 옛 문장: "상한은 개체 상태가 아니라 **상수**다 — 붙잡혀 한 번도 못 문 개체와 전부
   *   문 개체의 체류가 같은 틱 수다(보조정리 A). 그리고 봉쇄는 **유예이지 면제가 아니다** —
   *   못 문 잔액이 돌파 순간 한 방에 청구된다."
   *
   * 새 문장 둘, 그리고 **잃은 것 하나**:
   *  (a) 체류에 상한이 없다 — 자유로운 개체는 창이 끝날 때까지 **계속** 문다.
   *      물어낸 총액이 `baseDamage` 를 훌쩍 넘는다(= 총액 상한도 없다, ②).
   *  (b) 봉쇄는 여전히 **표적 전환**이라 한 입도 못 나가게 막는다(규칙 8, 안 바뀜).
   *  (c) ⚠ **잃은 것**: 봉쇄가 이제 **면제**다. 돌파가 없어졌으니 못 문 잔액을 청구할
   *      순간도 없다 — 붙잡아 두는 동안 마을은 한 톨도 안 깎인다. 옛 판본이 막던
   *      "몽둥이꾼 여섯으로 누수를 0 으로" 가 **가능해졌다**. 다만 그 대가로 그 적은
   *      영영 안 사라지므로 아군이 계속 묶인다 — 그 교환은 사용자 지시가 만든 것이다.
   */
  it('봉쇄는 이제 **면제**다 — 상한이 없어져 유예가 영구가 됐다', () => {
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
      /** 창은 고정이다 — "언제 나가나"가 아니라 "창이 끝나도 안 나간다"를 재기 때문이다 */
      const WINDOW = 2_000;
      let arrivedAt = -1;
      let leftAt = -1;
      let bites = 0;
      for (let t = 0; t < WINDOW; t++) {
        sim.tick();
        for (const x of sim.drainEvents()) {
          if (x.type === 'enemyAtGate') {
            arrivedAt = t;
            if (block) for (let k = 0; k < 3; k++) sim.applyCommand({ type: 'trainAlly', defId: 'clubber' });
          }
          if (x.type === 'gateBite') bites++;
          if (x.type === 'enemyLeaked') leftAt = t;
        }
      }
      expect(arrivedAt).toBeGreaterThanOrEqual(0);
      expect(leftAt, '뚫고 들어갔다 — 상한이 되돌려졌다').toBe(-1);
      const e = findEnemy(sim, sim.state.enemies[0]?.id ?? -1);
      expect(e, '문 앞의 적이 사라졌다').toBeDefined();
      return { hold: e!.gateTicks, owed: e!.gateOwed, bites };
    };
    const free = run(false);
    const held = run(true);
    // 체류는 **여전히** 전투 결과와 무관하다 — `gateTicks++` 가 무조건인 덕이다.
    // 다만 이제 그 값은 "상한까지"가 아니라 "창이 끝날 때까지"다.
    expect(free.hold, '체류는 전투 결과와 무관하게 흐른다').toBe(held.hold);
    // (a) 자유로우면 **매 주기마다 계속** 문다 — 식을 베끼지 않고 **실측 체류**로 검산한다
    expect(free.bites, `자유로운 개체의 한 입 수 (체류 ${free.hold}틱)`)
      .toBe(Math.floor((free.hold - 1) / GATE_BITE_TICKS) + 1);
    // ⚠⚠ 총액 상한이 사라졌다는 것의 실행 가능한 형태 — `baseDamage` 3 을 **넘는다**
    expect(free.bites * GATE_BITE_AMOUNT, '총액 상한이 되돌려졌다').toBeGreaterThan(3);
    expect(free.owed, '잔액은 0 에서 바닥을 친다 (음수로 안 간다)').toBe(0);
    // (b) 봉쇄는 안 바뀌었다 — 진입 틱의 한 입만 나가고 그 뒤로 한 톨도 못 문다
    expect(held.bites, '진입 틱의 한 입만 나간다 — 그 틱은 구조적으로 봉쇄가 아니다').toBe(1);
    // (c) ⚠ **잃은 것** — 잔액 2 가 청구되는 순간이 영영 안 온다 (옛 판본은 돌파에서 걷었다)
    expect(held.owed, '봉쇄된 개체의 잔액은 영영 안 걷힌다 = 면제다').toBe(2);
  });

  /**
   * ⚠⚠ **이 항목도 뒤집혔다.** 옛 문장은 "주기를 1000배로 주입해도 `clamp` 의 상한이
   *   값과 무관하게 체류를 자른다"였다. 상한이 없어진 지금 그 주입은 **나갈 길을 통째로
   *   막는다** — 첫 입 뒤로 30,000틱 동안 아무 일도 안 일어나고, 개체는 그대로 서 있다.
   *
   * ⚠ 옛 판본을 그냥 두면 **공허한 초록**이 됐다: `leftAt` 이 -1 이라 `leftAt − arrivedAt`
   *   이 음수가 되어 `≤ 상한` 이 자동으로 참이다. 뒤집지 않고 놔뒀다면 이 파일은
   *   "상한이 산다"고 계속 말했을 것이다 — 이 저장소가 세 번 당한 병 그 자체다.
   */
  it('주기를 1000배로 주입하면 **영영 안 나간다** — 자르던 상한이 없다', () => {
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
    const WINDOW = 5_000;
    let arrivedAt = -1;
    let leftAt = -1;
    let bites = 0;
    for (let t = 0; t < WINDOW; t++) {
      sim.tick();
      for (const x of sim.drainEvents()) {
        if (x.type === 'enemyAtGate') arrivedAt = t;
        if (x.type === 'gateBite') bites++;
        if (x.type === 'enemyLeaked') leftAt = t;
      }
    }
    expect(arrivedAt).toBeGreaterThanOrEqual(0);
    expect(bites, '주기가 30,000 이라 진입 틱의 첫 입 하나뿐이다').toBe(1);
    expect(leftAt, `옛 상한 ${GATE_HOLD_MAX_TICKS} 이 아직 자른다 — 동작이 되돌려졌다`).toBe(-1);
    const e = findEnemy(sim, sim.state.enemies[0]?.id ?? -1);
    expect(e?.gateTicks, '체류가 옛 상한을 넘는다').toBeGreaterThan(GATE_HOLD_MAX_TICKS);
  });

  /**
   * 진짜 판 — 6스테이지 실제 데이터에서 **문 앞의 유일한 출구가 죽음**인지.
   *
   * ⚠⚠ 옛 이름은 "도착 = 죽음 + 돌파"였다. 돌파(`enemyLeaked`)는 이제 문간이 켜진
   *   판에서 **한 번도 안 일어난다** — 그래서 그 사실을 여기서 직접 잠근다.
   *   마을 HP 를 매 틱 되돌리므로(패배로 조기 종료 방지) 남는 출구는 죽음뿐이고,
   *   곧 "문 앞의 적을 못 죽이면 웨이브가 안 끝난다"가 실제 데이터로 성립한다.
   */
  it('실제 스테이지1 — 문 앞의 유일한 출구는 **죽음**이다 (돌파가 0건이다)', () => {
    const sim = makeBotSimFor(STAGES[0]!, 4242, ['spear', 'catapult', 'frost']);
    const arrivals = new Set<number>();
    const exits = new Set<number>();
    let leaks = 0;
    let maxGateTicks = 0;
    for (let w = 0; w < 6; w++) {
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      for (let t = 0; t < 6_000; t++) {
        sim.state.baseHp = sim.state.baseHpMax; // 패배로 조기 종료되지 않게
        sim.tick();
        for (const x of sim.drainEvents()) {
          if (x.type === 'enemyAtGate') arrivals.add(x.enemyId);
          if (x.type === 'enemyLeaked') leaks++;
          if (x.type === 'enemyLeaked' || x.type === 'enemyDied') exits.add(x.enemyId);
        }
        for (const e of sim.state.enemies as EnemySim[]) {
          if (e.gateTicks > maxGateTicks) maxGateTicks = e.gateTicks;
        }
        if (t > 2 && sim.state.phase === 'prep') break;
      }
    }
    expect(arrivals.size, '문 앞에 선 적이 하나도 없다 — 공허한 검증이다').toBeGreaterThan(0);
    for (const id of arrivals) expect(exits.has(id), `적 ${id} 가 문 앞에 남았다`).toBe(true);
    // ⚠⚠ 뒤집힌 자리 — 돌파는 이제 문간이 켜진 판에 존재하지 않는다
    expect(leaks, '뚫고 들어간 적이 있다 — 체류 상한이 되돌려졌다').toBe(0);
    // 그리고 실제 데이터에서 체류가 **옛 상한을 넘는다** (같은 선을 반대로 쓴다)
    expect(maxGateTicks, `실측 최장 체류 ${maxGateTicks}틱 — 옛 상한 ${GATE_HOLD_MAX_TICKS}`)
      .toBeGreaterThan(GATE_HOLD_MAX_TICKS);
  });
});

// ---------------------------------------------------------------------------
// ② 총량 항등식 — **없어졌다.** 그 사실을 재는 자리로 뒤집는다
// ---------------------------------------------------------------------------
describe('② 총량 항등식이 **없다** — 피해는 살아 있는 시간이 정한다', () => {
  /**
   * ⚠⚠ 옛 문장: "Σ(한 입) + (뚫고 들어갈 때의 잔액) = `e.baseDamage`. 언제나, 정확히.
   *   이것이 성립하는 동안 밸런스는 근사가 아니라 **정의상** 보존된다."
   *
   * 그 항등식은 두 다리로 서 있었고 **둘 다 잘렸다**(사용자 지시 — 위 헤더 ①):
   *   · 왼쪽 항 — `bite()` 의 `min(GATE_BITE_AMOUNT, gateOwed)` 이 없어져 횟수가 무한이다.
   *   · 오른쪽 항 — `enemyLeaked` 가 안 일어나니 "뚫고 들어갈 때의 잔액"이 존재하지 않는다.
   *
   * 그래서 남은 것을 정확히 적고 그것만 잰다:
   *   (1) 한 입의 **크기**는 여전히 `GATE_BITE_AMOUNT` 고정이다 (여기는 안 바뀌었다).
   *   (2) 한 입의 **횟수**는 체류의 함수다 — `floor((gateTicks − 1) / 주기) + 1`.
   *   (3) `gateOwed` 는 0 에서 바닥을 치는 **표시용 잔액**이다 (음수로 안 간다).
   *   (4) ⚠ **잃은 것**: 마을이 받는 총 피해가 옛 항등식의 값(Σ baseDamage)을 **넘는다**.
   *       밸런스는 이제 "정의상 보존"이 아니라 **방어가 얼마나 빨리 죽이느냐**가 정한다.
   */
  it('한 입은 크기만 고정이고 횟수에 상한이 없다 (7종 혼성)', () => {
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

    const DMG = { compy: 1, raptor: 1, ptera: 1, trike: 2, mammoth: 3, spino: 5, trex: 12 };
    const bites = new Map<number, number>();
    for (const b of eventsOf(ev, 'gateBite')) {
      // (1) 한 입의 **크기**는 안 바뀌었다
      expect(b.amount, '한 입은 언제나 GATE_BITE_AMOUNT 다').toBe(GATE_BITE_AMOUNT);
      bites.set(b.enemyId, (bites.get(b.enemyId) ?? 0) + 1);
    }
    // ⚠⚠ 뒤집힌 자리 — 옛 판본은 여기서 `leaks.length > 0` 을 공허성 가드로 썼다
    expect(eventsOf(ev, 'enemyLeaked'), '뚫고 들어간 적이 있다 — 상한이 되돌려졌다').toHaveLength(0);

    const atGate = (sim.state.enemies as EnemySim[]).filter((e) => e.gateTicks > 0);
    expect(atGate.length, '문 앞에 선 적이 0 — 공허한 검증이다').toBe(species.length * 2);
    let overpaid = 0;
    for (const e of atGate) {
      const owedTotal = DMG[e.defId as 'compy'];
      const n = bites.get(e.id) ?? 0;
      // (2) 횟수 = 체류의 함수. 식을 베끼지 않고 **실측 체류**에서 다시 만든다
      expect(n, `${e.defId} 한 입 수 (체류 ${e.gateTicks}틱)`)
        .toBe(Math.floor((e.gateTicks - 1) / GATE_BITE_TICKS) + 1);
      // (3) 잔액은 0 에서 바닥을 친다
      expect(e.gateOwed, `${e.defId} 잔액`).toBe(Math.max(0, owedTotal - n * GATE_BITE_AMOUNT));
      expect(e.gateOwed, `${e.defId} 잔액이 음수다`).toBeGreaterThanOrEqual(0);
      if (n * GATE_BITE_AMOUNT > owedTotal) overpaid++;
    }
    // (4) ⚠ **잃은 것** — 총액을 넘겨 문 개체가 실제로 있고, 마을이 받은 총 피해가
    //     옛 항등식의 값(Σ baseDamage)을 **넘는다**. 이 두 줄이 "총량 불변"의 부고다.
    expect(overpaid, '아무도 총액을 안 넘겼다 — 총액 상한이 되돌려졌다').toBeGreaterThan(0);
    const dealt = eventsOf(ev, 'baseDamaged').reduce((a, b) => a + b.amount, 0);
    const oldTotal = species.reduce((a, id) => a + 2 * DMG[id as 'compy'], 0);
    expect(dealt, `마을이 받은 총 피해 ${dealt} — 옛 항등식의 값 ${oldTotal}`).toBeGreaterThan(oldTotal);
    // 이벤트와 **상태**가 어긋나지 않는다 (한 입이 곧 마을 HP 다)
    expect(dealt).toBe([...bites.values()].reduce((a, b) => a + b, 0) * GATE_BITE_AMOUNT);
  });

  /**
   * ⚠ 옛 제목은 "…그리고 **그것이 유일한 면제다**"였다. 그 꼬리는 뗐다 — 봉쇄도 이제
   *   면제이기 때문이다(①의 (c)). 앞머리는 그대로 산다: 죽으면 더 안 문다.
   *   지금은 이 항목이 **죽음이 유일한 출구**라는 쪽을 받친다(①의 실제 스테이지1과 짝).
   */
  it('문 앞에서 죽으면 그 순간 물기가 멈춘다 (죽음이 유일한 출구다)', () => {
    const sim = createBattle(
      options({
        // 마을이 쏜다: dmg 50 · cd 5 → 문 앞에서 확실히 죽는다
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
    const bites = eventsOf(ev, 'gateBite');
    expect(bites.length, '진입 틱의 첫 입은 반드시 나간다').toBeGreaterThanOrEqual(1);
    // 죽은 뒤에는 한 입도 없다 — 창 800틱은 상한이 살아 있던 시절의 체류(720)보다 길다
    const deathTick = died[0]!.gateTicks!;
    for (const b of bites) {
      expect(b.gateTicks, `죽은 뒤(체류 ${deathTick}틱)에도 물었다`).toBeLessThanOrEqual(deathTick);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 기하 — 실제 판에서 나온 좌표로 잰다. **다 걸어 들어간 뒤에** 잰다
//
// ⚠⚠ 이 절은 뒤집힌 것이 **아니다** — 문턱은 한 톨도 안 움직였다. 바뀐 것은 **시점**이다.
//   `standAt` 이 좌표를 박지 않게 되면서(위 헤더 ②) `enemyAtGate` 이벤트의 좌표는
//   **도착 틱의 좌표**, 곧 아직 경로 위의 점이 됐다. 그 점으로 재면 중심거리가
//   `GATE_STANDOFF_EDGE + restReach` 보다 **작게** 나온다(실측 raptor 2.017 대 2.170).
//   문턱을 그 값까지 내리면 "메시가 움막을 안 뚫는다"가 통째로 무너진다 —
//   그래서 문턱은 그대로 두고 `settleGate` 로 **자리에 다 들어간 뒤**에 잰다.
// ---------------------------------------------------------------------------
describe('③ 기하 — 6스테이지 전 종이 몸 앞끝을 마을 바깥끝에 대고 선다', () => {
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

  /**
   * ⚠⚠ **"Lv1 사거리 안" 줄이 여기서 빠졌다 — 완화가 아니라 이사다.**
   * 옛 계약은 `중심거리 < BASE_LEVELS[0].range` 였다. 그 줄은 "마을이 문 앞의 적을 쏜다"를
   * **숫자 우연**으로 재고 있었고, 정지선 잣대가 `radius` → `restReach` 로 바뀌면서
   * 최대 중심거리가 2.25 → **2.988**(trex) 이 되어 어떤 Lv1 사거리로도 못 덮게 됐다.
   * 사거리를 올려 되찾는 길은 "Lv1 < 쏘는 타워 최소(frost T1 2.4)" 계약이 막는다.
   *
   * 그래서 그 성질을 **규칙**으로 옮겼다 — `updateHometown` 이 `atGate` 인 적을 사거리와
   * 무관하게 표적 후보로 삼는다(hometown.ts 규칙 2-b). 잠그는 자리도 같이 옮겼다:
   * `tests/sim/hometown.test.ts` 의 "문간에 선 16종 전부가 Lv1 마을의 표적이 된다".
   * 그쪽은 **실제로 화살이 나가는지**를 재므로 여기 숫자 대리보다 강한 잣대다.
   */
  for (const stage of STAGES) {
    it(`s${stage.id}: 중심거리 = ${GATE_STANDOFF_EDGE} + restReach · 앞끝 ≥ ${STRUCTURE_RING}`, () => {
      const sim = makeBotSimFor(stage, 777, ['spear', 'catapult', 'frost']);
      const pin = (): void => {
        sim.state.baseHp = sim.state.baseHpMax;
      };
      /** 잰 마릿수 */
      let n = 0;
      /** 자리에 들어가기 **전에** 죽어서 못 잰 마릿수 (공허성 판단용) */
      let killedEarly = 0;
      /** 실제로 걸어 들어간 마릿수 — 0 이면 좌표 박기가 되돌아온 것이다 */
      let walkedIn = 0;
      /** 자리 잡는 데 **두 틱 이상** 걸린 마릿수 — 0 이면 한 틱 순간이동이다 */
      let multiTick = 0;
      const done = new Set<number>();
      for (let w = 0; w < 12; w++) {
        if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
        for (let t = 0; t < 6_000; t++) {
          pin();
          sim.tick();
          // ⚠ 정착을 기다리는 동안에도 새 개체가 문 앞에 설 수 있다. `settleGate` 가
          //   그동안의 이벤트를 돌려주므로 **작업 목록**으로 이어 처리한다 —
          //   그냥 버리면 그 개체들이 조용히 안 재진다(= 커버리지가 새는 공허함).
          const queue: SimEvent[] = [...sim.drainEvents()];
          while (queue.length > 0) {
            const x = queue.shift()!;
            if (x.type !== 'enemyAtGate' || done.has(x.enemyId)) continue;
            done.add(x.enemyId);
            // ⚠⚠ **여기가 이 절의 전부다.** 도착 틱의 좌표(`x.x/x.z`)는 아직 경로
            //   위이므로 쓰지 않는다 — 자리에 다 들어간 뒤의 **상태**를 읽는다.
            const s = settleGate(sim, x.enemyId, `s${stage.id} ${x.defId}`, pin);
            if (s === null) {
              killedEarly++;
              continue;
            }
            queue.push(...s.ev);
            n++;
            // ⚠ 도착 틱의 좌표는 **이벤트에서** 읽는다 — `settleGate` 를 언제 불렀는지에
            //   안 걸린다(다른 개체를 정착시키는 동안 이 개체가 먼저 자리를 잡을 수 있다).
            if (Math.hypot(s.e.x - x.x, s.e.z - x.z) > 1e-9) walkedIn++;
            if (s.ticks > 1) multiTick++;
            // ⚠ 잣대는 `radius`(충돌 반지름)가 아니라 `restReach`(메시 앞끝 도달)다.
            //   그 둘의 비가 0.96~2.51배로 흩어져 있어 서로를 대신하지 못한다 —
            //   `tests/render/gatepose.test.ts` §1 이 이 값 16개를 메시와 대조한다.
            const r = ENEMY_DEFS[s.e.defId].restReach;
            const d = Math.hypot(s.e.x - stage.baseCell.x, s.e.z - stage.baseCell.z);
            // 규칙 2 — 중심거리가 **정확히** `GATE_STANDOFF_EDGE + restReach` 다.
            //   부채는 회전이라 길이를 안 바꾸고, 판 밖이면 좌표를 자르는 대신 접는다 —
            //   곧 위아래 두 줄이 함께 "정확히 같다"를 잠근다.
            expect(d, `${s.e.defId} 중심거리`).toBeGreaterThanOrEqual(GATE_STANDOFF_EDGE + r - 1e-6);
            expect(d, `${s.e.defId} 중심거리`).toBeLessThanOrEqual(GATE_STANDOFF_EDGE + r + 1e-6);
            // ⚠⚠ 메시가 **마을 바깥끝 밖**에 선다. 이 한 줄이 "적이 움막을 뚫는다"를 닫는다
            expect(d - r, `${s.e.defId} 몸 앞끝`).toBeGreaterThanOrEqual(STRUCTURE_RING - 1e-6);
            // 맵 밖으로 나가지 않는다
            expect(s.e.x).toBeGreaterThanOrEqual(0.5);
            expect(s.e.x).toBeLessThanOrEqual(stage.gridW - 0.5);
            expect(s.e.z).toBeGreaterThanOrEqual(0.5);
            expect(s.e.z).toBeLessThanOrEqual(stage.gridH - 0.5);
          }
          if (t > 2 && sim.state.phase === 'prep') break;
        }
      }
      expect(n, `s${stage.id}: 자리에 들어간 적이 0마리 (죽어서 못 잰 ${killedEarly}) — 공허한 검증이다`)
        .toBeGreaterThan(0);
      // ⚠⚠ **이 한 줄이 "걸어 들어간다"를 잠근다.** 좌표 박기로 되돌리면 도착 틱에
      //   이미 자리에 있어 `walked === 0` 이 되고 여기가 빨개진다.
      expect(walkedIn, `s${stage.id}: 아무도 걸어 들어가지 않았다 — 순간이동이 되돌아왔다`)
        .toBeGreaterThan(0);
      // ⚠ 그리고 **한 틱에 끝나지 않는다.** 위 줄만으로는 "한 틱 늦게 순간이동"이 통과한다
      //   (실측으로 확인했다 — 걷기 블록을 죽여도 위 줄은 초록이었다).
      expect(multiTick, `s${stage.id}: 전부 한 틱 만에 자리를 잡았다 — 걸어 들어가기가 죽었다`)
        .toBeGreaterThan(0);
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
    /*
     * ⚠⚠ **도착 틱의 좌표로 재면 아홉 마리가 한 점에 겹쳐 보인다** — 실측
     *   `7.050000,4.000000` ×9 다. 그 점은 부채 자리가 아니라 **경로 위의 정지선**이고,
     *   아홉 마리가 같은 경로를 오므로 같은 점인 것이 당연하다. 자리는 그 뒤에 갈린다.
     *   그래서 **도착하는 족족 그 자리에서 정착시켜** 걸어 들어간 거리까지 함께 잰다
     *   (다 돌린 뒤에 부르면 이미 서 있어서 `walked` 가 0 이라 아무것도 못 잰다).
     */
    const settled: Settled[] = [];
    /** 도착 틱의 자리 → 최종 자리까지 실제로 옮겨 간 거리 (이벤트 좌표로 재므로 호출 시점과 무관) */
    const moved: number[] = [];
    const seenIds = new Set<number>();
    const queue: SimEvent[] = [];
    for (let t = 0; t < 900 && settled.length < N; t++) {
      sim.tick();
      queue.push(...sim.drainEvents());
      while (queue.length > 0) {
        const x = queue.shift()!;
        if (x.type !== 'enemyAtGate' || seenIds.has(x.enemyId)) continue;
        seenIds.add(x.enemyId);
        const s = settleGate(sim, x.enemyId, `§D ${x.enemyId}`);
        expect(s, '§D 판에는 아무도 안 죽는다 — 죽었다면 픽스처가 바뀐 것이다').not.toBeNull();
        queue.push(...s!.ev);
        settled.push(s!);
        moved.push(Math.hypot(s!.e.x - x.x, s!.e.z - x.z));
      }
    }
    expect(settled, `${N}마리가 전부 문 앞에 서야 이 검증이 공허하지 않다`).toHaveLength(N);
    /*
     * ⚠⚠ **이 두 줄이 "걸어 들어간다"를 잠근다.** 좌표 박기로 되돌리면 `enemyAtGate`
     *   이벤트의 좌표가 곧 부채 자리라 `moved` 가 아홉 마리 전부 0 이 된다.
     *   ⚠ `N` 이 아니라 `N − 1` 인 것은 **정면 자리(각 0)** 때문이다 — 이 판의 경로가
     *     마을로 곧게 들어오므로 그 한 마리는 도착 지점이 곧 제 자리다(걸을 것이 없다).
     */
    expect(moved.filter((d) => d > 1e-9).length, `걸어 들어간 마릿수 (거리 ${moved.map((d) => d.toFixed(3)).join(' ')})`)
      .toBe(N - 1);
    expect(Math.max(...moved), '옮겨 간 거리가 부채 한 칸보다도 짧다 — 자리 잡기가 반쯤 죽었다')
      .toBeGreaterThan(GATE_FAN_SPACING);
    // ⚠ 한 틱 만에 자리를 잡으면 그것도 순간이동이다 — 틱 수로 따로 잠근다
    expect(settled.filter((s) => s.ticks > 1).length, `자리 잡는 데 걸린 틱 ${settled.map((s) => s.ticks).join(' ')}`)
      .toBeGreaterThan(0);
    const spots = settled.map((s) => `${s.e.x.toFixed(6)},${s.e.z.toFixed(6)}`);
    expect(new Set(spots).size, `같은 종이 같은 자리에 겹쳤다 — ${spots.join(' | ')}`).toBe(N);
    // 그리고 부채는 **원 위**다 — 자리가 갈려도 중심거리는 한 톨도 안 흔들린다
    const ds = settled.map((s) => Math.hypot(s.e.x - wide.baseCell.x, s.e.z - wide.baseCell.z));
    for (const d of ds) expect(d, '부채가 중심거리를 바꿨다').toBeCloseTo(ds[0]!, 6);
  });

  /**
   * ⚠ `holdTicks` 줄은 **남긴다**. `holdTicksFor` 는 아무것도 자르지 않게 됐지만
   *   여전히 순수 함수이고 `enemyAtGate` 이벤트가 그 값을 싣는다(연출이 쓸 수 있다) —
   *   그 계약까지 같이 죽지는 않았다는 것을 여기서 잠근다. 다만 이제 그것은 **체류가
   *   아니다**: 아래 한 줄이 실제 체류가 그 값을 훌쩍 넘는다는 것을 함께 잰다.
   */
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
    expect(at[0]?.holdTicks, '이벤트가 아직 holdTicksFor 값을 싣는다').toBe(GATE_HOLD_MIN_TICKS);
    // ⚠⚠ 뒤집힌 자리 — 옛 문장은 "공중도 (한 번) 문다"였다. 지금은 **계속** 문다
    const bites = eventsOf(ev, 'gateBite');
    expect(bites.length, '공중도 매 주기 계속 문다').toBeGreaterThan(1);
    const e = findEnemy(sim, at[0]!.enemyId);
    expect(e, '공중이 사라졌다 — 아군이 못 잡는 종이라 죽을 길이 없다').toBeDefined();
    expect(bites.length, `한 입 수 (체류 ${e!.gateTicks}틱)`)
      .toBe(Math.floor((e!.gateTicks - 1) / GATE_BITE_TICKS) + 1);
    expect(e!.gateTicks, '체류가 이벤트의 holdTicks 를 넘는다 — 그 값은 더는 상한이 아니다')
      .toBeGreaterThan(GATE_HOLD_MIN_TICKS);
    // 그리고 기하는 **다 걸어 들어간 뒤에** 성립한다 — 공중도 예외가 아니다
    const s = settleGate(sim, at[0]!.enemyId, 'G3');
    expect(s, 'G3 공중이 자리에 못 들어갔다').not.toBeNull();
    // ⚠ 잣대를 베끼지 않는다 — 목 표의 `restReach` 를 **개체가 들고 있는 def 에서** 읽는다
    //   (`ENEMY_DEFS` 를 읽으면 실제 데이터를 재게 되어 이 판의 목 값과 어긋난다)
    const r = s!.e.def.restReach;
    const d = Math.hypot(s!.e.x - 9, s!.e.z - 2); // 목 스테이지의 마을 셀 (9,2)
    expect(d, '공중 중심거리').toBeCloseTo(GATE_STANDOFF_EDGE + r, 6);
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
   * ── ⚠⚠ **이 유도는 통째로 갈아엎혔다.** 옛 문장과 그 죽음을 먼저 적는다 ────────
   *
   * 옛 문장(2026-08-26): "방치 판의 문 앞 죽음은 언제나 **총액을 다 문 뒤**다 —
   *   총액 `n` 인 개체의 마지막 한 입이 `gateTicks = (n − 1) × 주기 + 1` 에 나가고
   *   그 뒤의 죽음은 청구서에 한 글자도 안 남기므로, 그 웨이브의 **누수 총액이 안 줄어**
   *   `5.wave = 4` 가 안 밀린다." 실측 HP 궤적: w1 25 → w2 23 → w3 21 → w4 9 → w4 패배.
   *
   * 그 유도의 **모든 항이 사라졌다**(사용자 지시 — 위 헤더 ①):
   *   · "총액"이 없다 — 한 입은 살아 있는 한 계속 나간다.
   *   · "누수"가 없다 — `enemyLeaked` 가 문간 켜진 판에서 한 번도 안 일어난다.
   *   · "다 문 뒤의 죽음은 공짜"가 없다 — 죽기 전까지 문 만큼이 그대로 청구다.
   *
   * ── 새 유도 (실측 2026-08-27, s1 · 시드 20260825 · 덱 spear · 완전 방치) ────────
   *   문 앞 도착 4마리 · 돌파 0건 · 문 앞 죽음 3마리(체류 230 · 454 · 260틱) ·
   *   HP 궤적 **w1 25 → w2 13 → w2 에서 패배**.
   * 곧 방치 패배가 **w4 → w2 로 두 웨이브 당겨졌다.** 무엇이 당겼나: 옛 판에서 compy
   * 한 마리가 마을에 넣는 피해는 총액 3 으로 **닫혀** 있었는데, 지금은 마을 Lv1 이
   * 그 개체를 죽이는 데 걸리는 시간(실측 230~454틱 = 4~8번의 한 입)이 그대로 피해다.
   *
   * ⚠ 봉투 [5] 의 문턱은 "방치면 **웨이브 5 안에** 패배"(`5.wave ≤ 5`)이고, 2 는 그
   *   안이다 — 문턱은 여전히 지켜지고, 오히려 여유가 커졌다. 문턱을 건드리지 않고
   *   **유도만** 갈아 끼우는 이유가 그것이다. (`autoplay.probes.ts` 는 보호 파일이라
   *   손대지 않았다.)
   *
   * 그래서 이 항목이 잠그는 문장 셋:
   *   (a) 방치 판에 **돌파가 0건**이다 — 마을을 깎는 것은 이제 문 앞의 이빨뿐이다.
   *   (b) 문 앞의 죽음은 **옛 "마지막 한 입" 시각을 훌쩍 넘겨서** 일어난다 —
   *       옛 유도가 기대던 "빚을 다 받은 뒤"가 더는 특별한 순간이 아니다.
   *   (c) 방치 패배 웨이브는 **2** 이고, 그것은 봉투 [5] 의 ≤5 안이다.
   */
  it('방치 판 — 돌파 0건 · 문 앞 죽음이 옛 총액 시각을 넘긴다 · 패배가 w2 로 당겨졌다', () => {
    const stage = STAGES[0]!;
    const sim = makeBotSimFor(stage, 20260825, ['spear']);
    /** 이 스테이지에서 이 종이 옛 판에 청구하던 총액 (`StageDef.leakDamage` 덮어쓰기 반영) */
    const owedOf = (id: EnemyId): number => stage.leakDamage?.[id] ?? ENEMY_DEFS[id].baseDamage;
    let arrivals = 0;
    let leaks = 0;
    let gateKills = 0;
    /** 옛 유도의 "마지막 한 입" 시각을 **넘겨서** 죽은 개체 (지금은 이쪽이 정상이다) */
    let pastOldDebt = 0;
    let lostWave = -1;
    for (let w = 0; w < 8 && lostWave < 0; w++) {
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      for (let t = 0; t < 6_000; t++) {
        sim.tick(); // 타워 0기 · 부족원 0명 · 레벨업 0회 = 완전 방치
        for (const x of sim.drainEvents()) {
          if (x.type === 'enemyAtGate') arrivals++;
          if (x.type === 'enemyLeaked') leaks++;
          if (x.type === 'enemyDied' && x.gateTicks !== undefined) {
            gateKills++;
            // 옛 유도의 마지막 한 입 = (총액 − 1) × 주기 + 1
            const lastBite = (owedOf(x.defId) - 1) * GATE_BITE_TICKS + 1;
            if (x.gateTicks > lastBite) pastOldDebt++;
          }
          if (x.type === 'battleEnded' && !x.won) lostWave = x.wave;
        }
        if (lostWave >= 0) break;
        if (t > 2 && sim.state.phase === 'prep') break;
      }
    }
    expect(arrivals, '방치 판인데 문 앞에 선 적이 0 — 공허한 검증이다').toBeGreaterThan(0);
    expect(gateKills, '문 앞에서 아무도 안 죽었다 — 아래 검사가 공허해진다').toBeGreaterThan(0);
    // (a) ⚠⚠ 뒤집힌 자리 — 옛 유도의 주어("누수 총액")가 아예 존재하지 않는다
    expect(leaks, '방치 판에 돌파가 있다 — 체류 상한이 되돌려졌다').toBe(0);
    // (b) 그리고 문 앞의 죽음은 옛 "빚을 다 받은 순간"을 **넘겨서** 일어난다
    expect(pastOldDebt, '문 앞의 죽음이 전부 옛 총액 시각 안이다 — 총액 상한이 되돌려졌다')
      .toBe(gateKills);
    // (c) 패배 웨이브 — 옛 4 에서 **2 로 당겨졌다**. 봉투 [5] 의 ≤5 안이다
    expect(lostWave, '방치 패배 웨이브').toBe(2);
    expect(lostWave, '봉투 [5] 의 "웨이브 5 안에 패배" 문턱').toBeLessThanOrEqual(5);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// ⑤ 되돌리기 · 풀 재사용
// ---------------------------------------------------------------------------
describe('⑤ 되돌리기 대조군과 풀 재사용', () => {
  /**
   * ⚠ **대조군(off)은 한 글자도 안 바뀌었다** — 두 변경이 전부 문간 **안쪽**이기 때문이다.
   *   그래서 이 항목은 "되돌리기 스위치가 아직 정확히 되돌린다"를 그대로 잠근다.
   *   바뀐 것은 on 쪽뿐이고, 거기서 옛 문장("켜져도 총량은 같다 — 12번에 나눠 낼 뿐")이
   *   **뒤집힌다**: 총량은 더 크고, 창을 늘리면 **더 커진다**.
   */
  it('gate.enabled = false 면 종전 동작으로 정확히 돌아간다 (on 은 총량이 안 닫힌다)', () => {
    const mk = (enabled: boolean, ticks: number) => {
      const sim = createBattle(
        options({
          enemyDefs: enemyDefs({ trex: { hp: 1e6, speed: 3, baseDamage: 12, radius: 0.8 } }),
          stage: stageDef({ waveCount: 1, baseHp: 1e9, gate: { enabled } }),
          waves: [wave([{ enemyId: 'trex', count: 1 }])],
        }),
      );
      sim.applyCommand({ type: 'callWave' });
      return runTicks(sim, ticks);
    };
    // ⚠ 창은 **주기의 함수**다(600 고정이면 주기가 30 → 60 이 된 순간 조용히 빨개진다)
    const WINDOW = 12 * GATE_BITE_TICKS + 400;
    const off = mk(false, WINDOW);
    expect(eventsOf(off, 'enemyAtGate'), '꺼졌으면 문 앞에 안 선다').toHaveLength(0);
    expect(eventsOf(off, 'gateBite'), '꺼졌으면 안 문다').toHaveLength(0);
    const offLeak = eventsOf(off, 'enemyLeaked');
    expect(offLeak).toHaveLength(1);
    // 종전 그대로 — 도달 한 방에 baseDamage 전액
    expect(offLeak[0]?.baseDamage).toBe(12);
    expect(eventsOf(off, 'baseDamaged').map((b) => b.amount)).toEqual([12]);

    const on = mk(true, WINDOW);
    expect(eventsOf(on, 'enemyAtGate')).toHaveLength(1);
    expect(eventsOf(on, 'enemyLeaked'), '켜졌으면 돌파가 없다').toHaveLength(0);
    const onTotal = eventsOf(on, 'baseDamaged').reduce((a, b) => a + b.amount, 0);
    // ⚠⚠ 뒤집힌 자리 — 옛 문장은 `=== 12`("총량은 같다")였다
    expect(onTotal, '총액 상한이 되돌려졌다 — 총량이 baseDamage 에서 닫힌다').toBeGreaterThan(12);
    expect(eventsOf(on, 'gateBite')).toHaveLength(onTotal / GATE_BITE_AMOUNT);
    // 그리고 **창을 늘리면 총량이 늘어난다** — 이 한 줄이 "상한이 없다"의 실행 가능한 형태다
    const onLonger = mk(true, WINDOW + 10 * GATE_BITE_TICKS);
    const longerTotal = eventsOf(onLonger, 'baseDamaged').reduce((a, b) => a + b.amount, 0);
    expect(longerTotal, `창 ${WINDOW} → ${WINDOW + 10 * GATE_BITE_TICKS} 인데 총량이 안 늘었다`)
      .toBe(onTotal + 10 * GATE_BITE_AMOUNT);
    // 대조군은 창을 늘려도 그대로다 — 그쪽 총량은 여전히 **닫혀 있다**
    const offLonger = mk(false, WINDOW + 10 * GATE_BITE_TICKS);
    expect(eventsOf(offLonger, 'baseDamaged').reduce((a, b) => a + b.amount, 0)).toBe(12);
  });

  /**
   * ⚠ 옛 판본은 hp 10^6 짜리 랩터 다섯을 보내며 "슬롯이 재사용되므로"라고 적었다.
   *   지금은 **문 앞의 적이 안 죽으면 슬롯이 영영 안 돈다** — 나갈 길이 죽음뿐이라
   *   그 전제가 거짓이 됐다. 그래서 마을을 무장시켜(dmg 50 · cd 5) 문 앞의 개체를
   *   실제로 죽인다: 그래야 풀이 돌고, 그래야 이 항목이 재려던 것을 잰다.
   */
  it('풀 재사용 — 앞사람의 문간 상태가 새 개체에 새지 않는다', () => {
    const sim = createBattle(
      options({
        baseLevels: baseLevels([{ dmg: 50, cooldownTicks: 5, range: 3 }]),
        enemyDefs: enemyDefs({ raptor: { hp: 120, speed: 3, baseDamage: 2, radius: 0.3 } }),
        stage: stageDef({ waveCount: 1, baseHp: 1e9 }),
        waves: [wave([{ enemyId: 'raptor', count: 5, intervalTicks: 140 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 1_600);
    const at = eventsOf(ev, 'enemyAtGate');
    expect(at).toHaveLength(5);
    // 슬롯이 실제로 돌았다 — 안 죽으면 이 항목은 아무것도 안 잰다
    expect(eventsOf(ev, 'enemyDied'), '문 앞에서 안 죽었다 — 풀이 안 돈다').toHaveLength(5);
    for (const a of at) expect(a.owed, '새 개체는 언제나 총액이 baseDamage 다').toBe(2);
    // 그리고 **체류 카운터**도 새지 않는다 — 첫 입이 언제나 `gateTicks = 1` 이다
    const firstBites = new Map<number, { gateTicks: number; owed: number }>();
    for (const b of eventsOf(ev, 'gateBite')) {
      if (!firstBites.has(b.enemyId)) firstBites.set(b.enemyId, b);
    }
    expect(firstBites.size, '다섯 마리가 전부 한 입은 물어야 한다').toBe(5);
    for (const [id, b] of firstBites) {
      expect(b.gateTicks, `개체 ${id} 의 첫 입이 도착 틱이 아니다 = gateTicks 가 샜다`).toBe(1);
      expect(b.owed, `개체 ${id} 의 첫 입 뒤 잔액 = baseDamage − 한 입`).toBe(2 - GATE_BITE_AMOUNT);
    }
    // 마을이 받은 총 피해 = 한 입 수 × 한 입 (총량이 아니라 **한 입의 합**이다)
    const bites = eventsOf(ev, 'gateBite').length;
    expect(eventsOf(ev, 'baseDamaged').reduce((a, b) => a + b.amount, 0)).toBe(bites * GATE_BITE_AMOUNT);
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
