/**
 * 문간 공성 — 보스가 마을 문 앞에 **살아서 서서** 마을을 문다 (src/sim/gate.ts 규칙 1~6).
 *
 * ── 목 스테이지의 기하 (아래 전부의 출발점) ────────────────────────────────
 * fixtures.stageDef 그대로다: 경로는 z=2 가로줄(x 0→9, 길이 9), 기지 (9,2), 격자 10×5.
 * 목 마을은 **기본이 무장 해제**(fixtures.baseLevels: dmg 0 / range 0)라, 여기서 재는 것은
 * 문간의 산술 하나뿐이고 "마을이 보스를 쏴 죽여서 안 물렸다"가 섞이지 않는다.
 * 그래서 이 파일의 보스는 hp를 크게 줘서 **절대 안 죽게** 두거나, 죽는 것을 재는 항목에서만
 * 명시적으로 마을을 무장시킨다.
 *
 * ⚠ 목 `enemyDefs()`는 어떤 종에도 `boss`를 안 준다 — 보스 여부는 항목마다 명시적으로
 *   켠다. 그 덕에 "보스가 아닌 적은 종전대로 누수한다"(규칙 1)가 같은 파일에서 대조군이 된다.
 */
import { describe, expect, it } from 'vitest';
import type { BattleSim, EnemyId, StatusInstance } from '@/data/types';
import { GATE_BITE_DIVISOR, GATE_BITE_TICKS } from '@/data/balance';
import { stage01 } from '@/data/stages/stage01';
import { createBattle } from '@/sim/battle';
import { makeBotSimFor } from './botharness';
import {
  allyDefs,
  baseLevels,
  enemyDefs,
  eventsOf,
  options,
  runTicks,
  stageDef,
  tier,
  towerDefs,
  wave,
} from './fixtures';

/** 문간까지 빨리 걸어오는 보스 하나 — 나머지는 항목이 덮어쓴다 */
function gateSim(
  over: {
    baseHp?: number;
    baseDamage?: number;
    hp?: number;
    speed?: number;
    boss?: boolean;
    gate?: { enabled?: boolean; biteTicks?: number; divisor?: number };
    armed?: boolean;
    allyCap?: number;
    count?: number;
  } = {},
): BattleSim {
  const armed = over.armed === true;
  return createBattle(
    options({
      deck: ['spear'],
      stage: stageDef({
        waveCount: 1,
        baseHp: over.baseHp ?? 25,
        startGold: 100_000,
        ...(over.gate ? { gate: over.gate } : {}),
      }),
      enemyDefs: enemyDefs({
        trex: {
          hp: over.hp ?? 1_000_000,
          speed: over.speed ?? 3,
          armor: 0,
          boss: over.boss ?? true,
          baseDamage: over.baseDamage ?? 12,
        },
      }),
      // 마을 사격은 기본 꺼짐 — 켜는 항목만 armed:true
      baseLevels: baseLevels([
        {
          dmg: armed ? 50 : 0,
          range: armed ? 3 : 0,
          cooldownTicks: 10,
          allyCap: over.allyCap ?? 6,
        },
      ]),
      waves: [wave([{ enemyId: 'trex' as EnemyId, count: over.count ?? 1, intervalTicks: 0 }])],
    }),
  );
}

/** 보스 한 마리를 잡아 온다 (문간 판정은 전부 이 개체 위에서 읽는다) */
function theBoss(sim: BattleSim) {
  const e = sim.state.enemies[0];
  expect(e, '적이 살아 있어야 한다').toBeDefined();
  return e!;
}

// ---------------------------------------------------------------------------
// 규칙 1 — 보스만 선다. 그 외는 한 글자도 안 바뀐다
// ---------------------------------------------------------------------------
describe('규칙 1) 문간에 서는 것은 보스뿐이다', () => {
  it('보스는 경로 끝에서 사라지지 않고 살아서 선다 — enemyLeaked 대신 bossAtGate', () => {
    const sim = gateSim();
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 200);
    expect(eventsOf(ev, 'enemyLeaked'), '보스에게 누수 이벤트는 절대 안 나간다').toHaveLength(0);
    const at = eventsOf(ev, 'bossAtGate');
    expect(at, '문간 입장은 개체당 정확히 한 번').toHaveLength(1);
    expect(at[0]?.defId).toBe('trex');
    // 한 입 크기를 미리 알려 준다 (2단계 HUD 가 읽는다)
    expect(at[0]?.bite).toBe(Math.ceil(12 / GATE_BITE_DIVISOR));
    // 좌표는 경로 끝 = 기지 셀
    expect(at[0]?.x).toBeCloseTo(9, 5);
    expect(at[0]?.z).toBeCloseTo(2, 5);
    expect(sim.state.enemies).toHaveLength(1);
    expect(theBoss(sim).alive).toBe(true);
    expect(theBoss(sim).gateTicks).toBeGreaterThan(0);
  });

  it('보스가 아닌 적은 **종전대로** 누수한다 (enemyLeaked + 사라짐)', () => {
    const sim = gateSim({ boss: false, baseHp: 9999 });
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 200);
    expect(eventsOf(ev, 'bossAtGate')).toHaveLength(0);
    const leaks = eventsOf(ev, 'enemyLeaked');
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.baseDamage).toBe(12);
    expect(eventsOf(ev, 'gateBite'), '누수는 한 입이 아니다').toHaveLength(0);
    expect(sim.state.enemies, '누수한 적은 사라진다').toHaveLength(0);
  });

  it('문간에 선 보스는 두 번 다시 걷지 않는다 (좌표 영구 고정)', () => {
    const sim = gateSim({ baseHp: 9999 });
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200);
    const b = theBoss(sim);
    const [x, z, dist] = [b.x, b.z, b.dist];
    runTicks(sim, 400);
    const b2 = theBoss(sim);
    expect(b2.x).toBe(x);
    expect(b2.z).toBe(z);
    expect(b2.dist).toBe(dist);
    expect(b2.gateTicks, '버틴 시간은 계속 는다').toBeGreaterThan(500);
  });

  it('gate.enabled=false 면 보스도 종전대로 누수한다 (gate-off 되돌리기의 주입구)', () => {
    const sim = gateSim({ gate: { enabled: false }, baseHp: 9999 });
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 200);
    expect(eventsOf(ev, 'bossAtGate')).toHaveLength(0);
    expect(eventsOf(ev, 'gateBite')).toHaveLength(0);
    expect(eventsOf(ev, 'enemyLeaked')).toHaveLength(1);
    expect(sim.state.enemies).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 규칙 3·4 — 주기와 총량
// ---------------------------------------------------------------------------
describe('규칙 3·4) 주기와 한 입의 크기', () => {
  it('첫 한 입은 도착 즉시가 아니라 **한 주기 뒤**다 (첫 1초 = 피해 0)', () => {
    const sim = gateSim({ baseHp: 9999 });
    sim.applyCommand({ type: 'callWave' });
    // 문간에 설 때까지 굴린다
    let arrivedAt = -1;
    for (let t = 0; t < 300 && arrivedAt < 0; t++) {
      sim.tick();
      if (eventsOf(sim.drainEvents(), 'bossAtGate').length > 0) arrivedAt = t;
    }
    expect(arrivedAt).toBeGreaterThanOrEqual(0);
    // 도착 다음 틱부터 (GATE_BITE_TICKS − 1)틱 동안은 한 입도 없어야 한다
    const grace = runTicks(sim, GATE_BITE_TICKS - 1);
    expect(eventsOf(grace, 'gateBite'), '첫 1초는 유예다').toHaveLength(0);
    expect(sim.state.baseHp).toBe(9999);
    // 그 다음 틱에 첫 한 입
    const first = runTicks(sim, 1);
    expect(eventsOf(first, 'gateBite')).toHaveLength(1);
  });

  it('한 입 = ceil(baseDamage / divisor) 이고 주기는 정확히 GATE_BITE_TICKS 다', () => {
    const sim = gateSim({ baseHp: 9999, baseDamage: 12 });
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const bites = eventsOf(ev, 'gateBite');
    expect(bites.length).toBeGreaterThan(5);
    for (const b of bites) expect(b.amount).toBe(Math.ceil(12 / GATE_BITE_DIVISOR));
    // 주기 — 연속한 두 입의 gateTicks 차이가 언제나 정확히 한 주기
    for (let i = 1; i < bites.length; i++) {
      expect(bites[i]!.gateTicks - bites[i - 1]!.gateTicks).toBe(GATE_BITE_TICKS);
    }
    // 총량 — 마을 HP 감소분이 한 입 × 횟수와 정확히 같다
    expect(9999 - sim.state.baseHp).toBe(bites.length * bites[0]!.amount);
  });

  it('divisor 를 올리면 한 입이 작아진다 (문간 손잡이가 데이터로 닿는다)', () => {
    for (const [divisor, want] of [
      [4, 3],
      [6, 2],
      [8, 2],
    ] as const) {
      const sim = gateSim({ baseHp: 9999, baseDamage: 12, gate: { divisor } });
      sim.applyCommand({ type: 'callWave' });
      const bites = eventsOf(runTicks(sim, 300), 'gateBite');
      expect(bites.length, `divisor ${divisor}`).toBeGreaterThan(0);
      expect(bites[0]?.amount, `divisor ${divisor}`).toBe(want);
    }
  });

  it('한 입은 올림이라 **언제나 1 이상**이다 (교착 증명 ②가 이 하한 위에 선다)', () => {
    const sim = gateSim({ baseHp: 9999, baseDamage: 1, gate: { divisor: 1000 } });
    sim.applyCommand({ type: 'callWave' });
    const bites = eventsOf(runTicks(sim, 300), 'gateBite');
    expect(bites.length).toBeGreaterThan(0);
    expect(bites[0]?.amount).toBe(1);
  });

  it('gateBite 가 baseDamaged 보다 **먼저** 나간다 (무는 것이 먼저, 깎이는 것이 나중)', () => {
    const sim = gateSim({ baseHp: 9999 });
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 200);
    const i = ev.findIndex((e) => e.type === 'gateBite');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ev[i + 1]?.type).toBe('baseDamaged');
  });
});

// ---------------------------------------------------------------------------
// 규칙 2 — 봉쇄·스턴이면 안 문다 (siege.ts 규칙 1-b·5 상속)
// ---------------------------------------------------------------------------
describe('규칙 2) 봉쇄·스턴이면 안 문다', () => {
  it('봉쇄된 보스는 마을을 물지 않는다 — 그리고 봉쇄가 풀리면 다시 문다', () => {
    /*
     * ⚠ `blockerAllyId` 를 손으로 박는 방식은 **못 쓴다** — `updateAllies` 가 매 틱 맨 처음에
     *   전부 지우고 다시 채우기 때문이다(combat.isSundered 주석). 그래서 진짜 부족원을
     *   문간(9,2)으로 보내 봉쇄를 세운다. 아군 HP 를 크게 줘서 난투로 먼저 죽지 않게 한다 —
     *   여기서 재는 것은 "봉쇄면 안 문다"이지 아군의 수명이 아니다.
     */
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ waveCount: 1, baseHp: 9999, startGold: 100_000 }),
        enemyDefs: enemyDefs({
          trex: { hp: 1_000_000, speed: 3, armor: 0, boss: true, baseDamage: 12 },
        }),
        /*
         * hp 40 은 계산된 값이다 — 목 trex 의 난투는 `enemyBrawlDmgFor(cost 1)` = **2**,
         * 주기 BRAWL_COOLDOWN_TICKS(30). 곧 이 부족원은 정확히 20대(600틱)를 버틴다:
         * 아래 300틱 관측 창은 넉넉히 살아 있고, 그 뒤에는 **반드시 죽어** 봉쇄가 풀린다.
         * (붙잡은 근접 아군은 명령을 줘도 안 움직인다 — allies.ts 규칙 5. 곧 봉쇄를 푸는
         *  길은 죽음뿐이고, 그것이 allies.ts '교착 안전성'이 말하는 바로 그 성질이다)
         */
        allyDefs: allyDefs({ clubber: { hp: 40, dmg: 0, range: 2, blocks: true } }),
        baseLevels: baseLevels([{ dmg: 0, range: 0, allyCap: 6 }]),
        waves: [wave([{ enemyId: 'trex' as EnemyId, count: 1, intervalTicks: 0 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200); // 보스가 문간에 선다
    expect(theBoss(sim).gateTicks).toBeGreaterThan(0);

    expect(sim.applyCommand({ type: 'trainAlly', defId: 'clubber' })).toBe(true);
    const ally = sim.state.allies[0]!;
    sim.applyCommand({ type: 'moveAlly', allyId: ally.id, cellX: 9, cellZ: 2 });
    runTicks(sim, 60); // 문간까지 걸어가 붙는다
    expect(theBoss(sim).blockerAllyId, '봉쇄가 섰다').toBe(ally.id);

    const hpAtLock = sim.state.baseHp;
    const bites = eventsOf(runTicks(sim, 300), 'gateBite');
    expect(bites, '봉쇄된 300틱 동안 한 입도 없다').toHaveLength(0);
    expect(sim.state.baseHp).toBe(hpAtLock);
    expect(theBoss(sim).gateTicks, '버틴 시간은 그래도 흐른다').toBeGreaterThan(300);
    // 봉쇄 중에도 **쿨다운은 흘렀다** (siege 규칙 1-b 그대로 — 스턴과 갈리는 자리)
    expect(theBoss(sim).gateBiteCdLeft).toBe(0);

    // 아군이 난투로 쓰러지면 봉쇄가 풀리고, 흘러 있던 쿨다운(0) 덕에 **풀린 그 틱에** 문다
    let releasedAt = -1;
    let firstBiteAt = -1;
    for (let t = 0; t < 600; t++) {
      const wasBlocked = theBoss(sim).blockerAllyId >= 0;
      sim.tick();
      const bit = eventsOf(sim.drainEvents(), 'gateBite').length > 0;
      if (releasedAt < 0 && wasBlocked && theBoss(sim).blockerAllyId < 0) releasedAt = t;
      if (bit && firstBiteAt < 0) firstBiteAt = t;
      if (firstBiteAt >= 0) break;
    }
    expect(releasedAt, '아군이 걸어 나가 봉쇄가 풀린다').toBeGreaterThanOrEqual(0);
    expect(firstBiteAt, '풀리자마자 문다 — 쿨다운이 흐르고 있었기 때문이다').toBe(releasedAt);
  });

  it('스턴이면 안 물고 **쿨다운도 안 흐른다** (siege 규칙 5 그대로)', () => {
    const sim = gateSim({ baseHp: 9999 });
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200);
    const b = theBoss(sim);
    // 첫 한 입 직후로 위상을 맞춘다 — 남은 쿨다운이 한 주기 통째여야 관찰이 깔끔하다
    while (eventsOf(runTicks(sim, 1), 'gateBite').length === 0) {
      /* 첫 한 입까지 */
    }
    const cd0 = theBoss(sim).gateBiteCdLeft;
    expect(cd0).toBe(GATE_BITE_TICKS);
    const stun: StatusInstance = { kind: 'stun', magnitude: 0, remainingTicks: 100_000, acc: 0 };
    b.statuses.push(stun);
    const ev = runTicks(sim, 300);
    expect(eventsOf(ev, 'gateBite'), '스턴 300틱 동안 한 입도 없다').toHaveLength(0);
    expect(theBoss(sim).gateBiteCdLeft, '쿨다운이 얼어 있다').toBe(cd0);
    // 풀면 남은 쿨다운만큼 뒤에 문다
    b.statuses.length = 0;
    expect(eventsOf(runTicks(sim, cd0 - 1), 'gateBite')).toHaveLength(0);
    expect(eventsOf(runTicks(sim, 1), 'gateBite')).toHaveLength(1);
  });

  it('감속은 문간 피해를 깎는다 (siege 규칙 9 — 뒤집힌 주석의 실행물)', () => {
    const bite = (mag: number | null): number => {
      const sim = gateSim({ baseHp: 9999, baseDamage: 40, gate: { divisor: 4 } }); // 한 입 10
      sim.applyCommand({ type: 'callWave' });
      runTicks(sim, 150);
      const b = theBoss(sim);
      expect(b.gateTicks).toBeGreaterThan(0);
      if (mag !== null) {
        b.statuses.push({ kind: 'slow', magnitude: mag, remainingTicks: 100_000, acc: 0 });
      }
      const bites = eventsOf(runTicks(sim, 200), 'gateBite');
      expect(bites.length).toBeGreaterThan(0);
      return bites[0]!.amount;
    };
    expect(bite(null), '감속 없음 = 온전한 한 입').toBe(10);
    expect(bite(0.35), '35% 감속이면 한 입도 35% 준다').toBe(7); // round(10 × 0.65)
    expect(bite(0.5)).toBe(5);
    expect(bite(0.99), '아무리 얼려도 하한 1').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 교착 불가능성 (gate.ts 헤더의 증명 ①②③)
// ---------------------------------------------------------------------------
describe('교착 불가능성 — 두 카운트다운', () => {
  it('② 마을 HP 카운트다운 — 방치하면 유한 시간에 반드시 진다', () => {
    // 스테이지1 실측과 같은 모양: 마을 25 · trex baseDamage 12 · divisor 4 → 한 입 3
    const sim = gateSim({ baseHp: 25, baseDamage: 12 });
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 30 * 60);
    expect(sim.state.phase, '반드시 끝난다').toBe('lost');
    const ended = eventsOf(ev, 'battleEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.won).toBe(false);
    // 9번 물면 25 → 0 (3씩). 마지막 한 입이 5초가 아니라 9초쯤이라는 것을 눈금으로 남긴다
    expect(eventsOf(ev, 'gateBite')).toHaveLength(9);
  });

  it('① 마을 화살 카운트다운 — ②가 완전히 멈춘 상태에서도 보스가 죽는다', () => {
    // 마을 화력 50 / 10틱 = 5dps. hp 5,000 이면 걸어오며 맞는 몫을 빼도 1,000틱 안에 죽는다
    const sim = gateSim({ baseHp: 9999, hp: 5000, armed: true });
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 150);
    expect(theBoss(sim).gateTicks).toBeGreaterThan(0);
    // 영구 스턴 — ②(마을 HP 카운트다운)를 통째로 멈춘다. 쿨다운까지 얼어 있다(규칙 2).
    theBoss(sim).statuses.push({ kind: 'stun', magnitude: 0, remainingTicks: 10_000_000, acc: 0 });
    const hpAtLock = sim.state.baseHp;
    let died = 0;
    for (let t = 0; t < 30 * 120 && died === 0; t++) {
      sim.tick();
      died += eventsOf(sim.drainEvents(), 'enemyDied').length;
    }
    expect(died, '②가 멈춰 있어도 ①이 계속 돌아 보스가 죽는다').toBe(1);
    expect(sim.state.baseHp, '멈춰 있는 동안 마을은 한 대도 안 맞았다').toBe(hpAtLock);
  });

  it('보스가 문간에서 죽으면 웨이브가 완료된다 (enemies.length === 0 이 영구 정지하지 않는다)', () => {
    const sim = gateSim({ baseHp: 9999, hp: 3000, armed: true });
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 30 * 60);
    const died = eventsOf(ev, 'enemyDied');
    expect(died).toHaveLength(1);
    // 문간에서 죽었다는 기록이 사망 이벤트에 실린다 (계측의 유일한 확정 기록)
    expect(died[0]?.gateTicks).toBeGreaterThan(0);
    expect(eventsOf(ev, 'waveCleared'), '웨이브가 완료된다').toHaveLength(1);
    expect(sim.state.phase).toBe('won');
  });
});

// ---------------------------------------------------------------------------
// 결정론 — 풀 재사용 누출 · 해시
// ---------------------------------------------------------------------------
describe('결정론', () => {
  /**
   * 풀 재사용 누출 — **한 판에서 보스를 죽이고 그 슬롯을 잡몹이 물려받는** 모양을 만든다.
   * 여기가 새면 새 개체가 태어나자마자 "문간에 서 있는 것"이 되어 스폰 지점에서 마을을
   * 물기 시작한다. bountyPaid 가 당한 것과 정확히 같은 사고다 (entities.resetEnemy 주석).
   */
  it('풀 재사용 누출이 없다 — 보스가 죽은 슬롯을 물려받은 적은 문간 상태가 0이다', () => {
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ waveCount: 2, baseHp: 9999, startGold: 100_000 }),
        enemyDefs: enemyDefs({
          // 마을 사거리 3 · 5틱마다 50 → 문간까지 오는 동안 300 정도만 맞는다.
          // 2,000 이면 **문간에 서고 나서** 죽는다 (여기서 재는 것이 그 슬롯의 재사용이다)
          trex: { hp: 2000, speed: 3, armor: 0, boss: true, baseDamage: 12 },
          raptor: { hp: 50, speed: 0.4, armor: 0, baseDamage: 1 },
        }),
        // 마을이 문간의 보스를 확실히 죽인다
        baseLevels: baseLevels([{ dmg: 50, range: 3, cooldownTicks: 5 }]),
        waves: [
          wave([{ enemyId: 'trex' as EnemyId, count: 1, intervalTicks: 0 }]),
          wave([{ enemyId: 'raptor' as EnemyId, count: 4, intervalTicks: 5 }]),
        ],
      }),
    );
    sim.applyCommand({ type: 'callWave' });
    const ev1 = runTicks(sim, 400);
    expect(eventsOf(ev1, 'bossAtGate')).toHaveLength(1);
    expect(eventsOf(ev1, 'enemyDied')).toHaveLength(1);
    // 웨이브 2 — 풀 슬롯을 물려받은 잡몹들
    sim.applyCommand({ type: 'callWave' });
    const ev2 = runTicks(sim, 60);
    expect(sim.state.enemies.length).toBeGreaterThan(0);
    for (const e of sim.state.enemies) {
      expect(e.gateTicks, `enemy ${e.id} 의 문간 체류가 새어 나왔다`).toBe(0);
      expect(e.gateBiteCdLeft, `enemy ${e.id} 의 문간 쿨다운이 새어 나왔다`).toBe(0);
    }
    expect(eventsOf(ev2, 'gateBite'), '스폰 지점에서 마을을 물지 않는다').toHaveLength(0);
  });

  it('같은 시드 두 판의 상태 해시가 문간 구간 내내 같다', () => {
    const run = (): number[] => {
      const sim = gateSim({ baseHp: 9999 });
      sim.applyCommand({ type: 'callWave' });
      const hs: number[] = [];
      for (let t = 0; t < 600; t++) {
        sim.tick();
        sim.drainEvents();
        if (t % 25 === 24) hs.push(sim.hash());
      }
      return hs;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(new Set(a).size, '해시가 상수로 굳어 있으면 아무것도 안 잡는다').toBeGreaterThan(1);
  });

  /**
   * 목이 아니라 **진짜 스테이지1** 에서 같은 시드 두 판의 해시를 맞춰 본다.
   * 목 전장은 규칙을 정확히 겨냥하는 대신 실제 경로·실제 편성·실제 풀 재사용 순서를
   * 재지 못한다 — 문간은 그 셋 위에서 도는 기능이라 두 층이 다 필요하다
   * (wavetermination.test.ts 헤더가 같은 논거로 목과 실판을 나눈다).
   * 웨이브 10 = 스테이지1 의 첫 보스(spino) 웨이브라, 이 구간이 곧 첫 문간 대치다.
   */
  it('진짜 스테이지1 — 첫 보스 웨이브까지 같은 시드 두 판의 해시가 같다', () => {
    const run = (): { hashes: number[]; gate: number } => {
      const sim = makeBotSimFor(stage01, 4242, ['spear', 'catapult', 'frost']);
      // 타워를 12기 깔아 둔다 — 안 깔면 방치와 같아져 웨이브 4에 지고 보스를 못 본다
      // (wavetermination.test.ts 와 같은 준비. **마을 HP 는 손대지 않는다** —
      //  그걸 만지면 gate.ts 교착 증명의 전제 ②가 깨진다)
      sim.state.gold = 9_999_999;
      for (let z = 0; z < stage01.gridH && sim.state.towers.length < 12; z++) {
        for (let x = 0; x < stage01.gridW && sim.state.towers.length < 12; x++) {
          if (sim.hasScenery(x, z)) sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z });
          sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ: z });
        }
      }
      sim.state.gold = 9_999_999;
      const hashes: number[] = [];
      let gate = 0;
      for (let t = 0; t < 30 * 60 * 12; t++) {
        if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
        sim.tick();
        for (const ev of sim.drainEvents()) if (ev.type === 'bossAtGate') gate++;
        if (t % 200 === 199) hashes.push(sim.hash());
        if (sim.state.phase === 'lost' || sim.state.phase === 'won') break;
      }
      return { hashes, gate };
    };
    const a = run();
    const b = run();
    expect(a.gate, '이 구간에 문간 대치가 실제로 있었다 — 없으면 검증이 공허하다').toBeGreaterThan(0);
    expect(a.hashes).toEqual(b.hashes);
    expect(new Set(a.hashes).size).toBeGreaterThan(1);
  });

  it('문간 두 필드가 hash() 에 들어간다 (각각 따로)', () => {
    const at = (mutate?: (sim: BattleSim) => void): number => {
      const sim = gateSim({ baseHp: 9999 });
      sim.applyCommand({ type: 'callWave' });
      runTicks(sim, 200);
      mutate?.(sim);
      return sim.hash();
    };
    const h0 = at();
    expect(at((s) => (s.state.enemies[0]!.gateTicks += 1))).not.toBe(h0);
    expect(at((s) => (s.state.enemies[0]!.gateBiteCdLeft += 1))).not.toBe(h0);
  });
});

// ---------------------------------------------------------------------------
// "왜 한 줄이 큰가" — 문간이 세 부품을 코드 0줄로 켠다
// ---------------------------------------------------------------------------
describe('문간은 이미 만들어 둔 세 부품을 켠다', () => {
  it('문간의 보스는 마을 사거리 안이라 Lv1 마을도 계속 쏜다', () => {
    const sim = gateSim({ baseHp: 9999, hp: 1_000_000, armed: true });
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200);
    expect(theBoss(sim).gateTicks).toBeGreaterThan(0);
    const shots = eventsOf(runTicks(sim, 300), 'baseFired');
    expect(shots.length, '문간은 baseCell 과 거리 0이라 100% 사거리 안이다').toBeGreaterThan(20);
  });

  it('문간을 덮는 타워는 움직이지 않는 표적을 계속 때린다', () => {
    const sim = createBattle(
      options({
        deck: ['spear'],
        stage: stageDef({ waveCount: 1, baseHp: 9999, startGold: 100_000 }),
        enemyDefs: enemyDefs({
          trex: { hp: 1_000_000, speed: 3, armor: 0, boss: true, baseDamage: 12 },
        }),
        towerDefs: towerDefs({
          spear: { tiers: Array.from({ length: 5 }, () => tier({ range: 2, cooldownTicks: 10 })) },
        }),
        allyDefs: allyDefs(),
        waves: [wave([{ enemyId: 'trex' as EnemyId, count: 1, intervalTicks: 0 }])],
      }),
    );
    // 기지 (9,2) 옆 (8,1) — 문간을 덮는다
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 8, cellZ: 1 })).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    runTicks(sim, 200);
    expect(theBoss(sim).gateTicks).toBeGreaterThan(0);
    const hits = eventsOf(runTicks(sim, 300), 'enemyDamaged');
    expect(hits.length, '표적이 안 움직이니 사격이 끊기지 않는다').toBeGreaterThan(20);
  });
});
