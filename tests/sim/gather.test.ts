/**
 * 채집 규칙 (docs/gather-spec.md §4) — 상태 기계 전수.
 *
 * ── 이 파일이 서 있는 두 전제 ──────────────────────────────────────────────
 * ① **짐값 기준을 6으로 주입해서 돈다**(`createBattle`의 둘째 인자 `BattleTuning`).
 *    배포본 `GATHER_BASE_VALUE`는 아직 **0**이라(T6이 마지막에 켠다) 주입 없이 짜면
 *    "골드가 늘었다"를 재는 모든 항목이 **0과 0을 비교하는 실패 불가능한 계약**이 된다.
 *    ⚠ 그래서 이 파일의 어떤 어서션도 배포본 상수를 읽지 않는다 — 값은 언제나
 *      `sim.state.resources`의 `value`에서 온다(칸이 스스로 자기 값을 말한다).
 * ② **목 스테이지**(fixtures `stageDef`)는 10×5이고 경로가 z=2 한 줄이라 소품 칸이 11개다.
 *    z=0·z=4 줄은 경로에서 2타일이라 `BRAWL_BRUSH_RANGE 1.1` **밖**이고, z=1·z=3 줄은
 *    정확히 1.0이라 **안**이다. 곧 "안전한 칸"과 "전선 옆 칸"이 같은 판에 다 있다.
 *
 * 기지 셀은 (9,2)이고 집결 지점은 거기서 1.4타일 앞이다 — **배달 반경 0.7 밖**이라
 * 뽑기만 해서는 절대 지급이 안 된다(계약 A의 둘째 방어선).
 */
import { describe, expect, it } from 'vitest';
import type { AllyState, BattleSim, ResourceCellState, SimEvent, StageDef } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { GATHER_DELIVER_RANGE, GATHER_REGROW_STOCK_FRAC, gatherValueFor } from '@/data/balance';
import { REGROWABLE_KINDS, RESOURCE_DEFS, gatherTicksFor } from '@/data/resources';
import { allyDef, allyDefs, enemyDefs, eventsOf, options, stageDef, wave } from './fixtures';

/** 이 파일 전체가 쓰는 짐값 기준 — 배포본 상수(0)를 **일부러** 안 쓴다 (위 전제 ①) */
const B = 6;

/** 목 스테이지의 기지 셀 */
const BASE = { x: 9, z: 2 };

/**
 * 안전한 자원 칸 셋 (z=0·z=4 줄 — 난투 스치기 사거리 밖).
 * 값·종류는 어서션에 안 박는다. 실측을 상수로 굳히면 소품 시드가 바뀌는 날
 * "무엇이 틀렸는지"가 아니라 "숫자가 다르다"만 남는다 — 칸에게 직접 물어본다.
 */
const NEAR = { x: 7, z: 0 }; // 집결 지점에서 가장 가까운 안전 칸
const FAR_A = { x: 0, z: 4 };
const FAR_B = { x: 1, z: 4 }; // FAR_A의 옆칸 — carryCap 2의 "두 칸 연달아"에 쓴다
/** 전선 옆 칸 (z=3 줄 — 경로에서 1.0타일이라 스치는 타격이 닿는다) */
const FRONT = { x: 7, z: 3 };
/**
 * **자원이 없는 빈 칸** — 규칙 8-b의 "여기 지켜"(autoHold = true)를 거는 유일한 수단이다.
 * 자동 행동이 들어온 뒤로는 "가만히 서 있는 채집꾼"을 만들려면 반드시 이 칸을 찍어야 한다:
 * 안 찍으면 그 사람은 **스스로 다음 칸을 캐러 간다**(그것이 사용자 항목 2·4다).
 * 마을거리 4.47이라 배달 반경(0.7) 밖이고, 자원 칸도 기지 셀도 아니다.
 */
const HOLD = { x: 5, z: 0 };

interface MkOpts {
  /** 적을 실제로 내보낸다 (기본: 빈 웨이브라 아무도 안 나온다) */
  enemies?: boolean;
  /** 아군 목 정의 덮어쓰기 */
  allies?: Parameters<typeof allyDefs>[0];
  /** 무한 모드를 끈다 (승리 틱을 재는 항목 전용) */
  finite?: boolean;
  /**
   * 재생 손잡이 덮어쓰기 (재생 블록 전용).
   * ⚠ 지연을 짧게 주입하는 것은 **모양**만 바꾼다 — 총액은 재생 횟수 상한이 닫는다.
   * ⚠ `gatherRegrowStockFrac` 은 **재고 문턱**이다. 1 이면 재고 게이트가 통째로 꺼져
   *   재고 게이트가 들어오기 전의 순수 타이머와 완전히 같아진다.
   */
  tuning?: {
    gatherRegrowMax?: number;
    gatherRegrowTicks?: number;
    gatherRegrowStockFrac?: number;
    gatherRegrowWaveSpeedup?: number;
  };
  /**
   * 목 스테이지의 바이옴 (기본 grassland). 초원 가중치에는 **광물이 stone 18%뿐**이라
   * 11칸짜리 목 스테이지에서 한 칸도 안 나오는 시드가 있다 — R4("광물은 안 자란다")를
   * 재려면 광물과 재생종이 **같은 판에** 있어야 하므로 화산(광물 84%)을 쓴다.
   */
  biome?: StageDef['biome'];
}

/**
 * 표준 판 — **적이 없고 무한 모드**다.
 * 적을 기본으로 빼는 이유: 이 파일이 재는 것은 채집 상태 기계이고, 난투가 끼면
 * 거의 모든 항목이 "언제 맞았나"에 결과가 걸린다. 맞는 규칙(E-11)은 그것만 재는
 * 항목이 적을 **켜서** 잰다.
 * 무한 모드인 이유: 목 스테이지는 waveCount 2에 빈 웨이브라 240틱이면 'won'이 되고
 * `tick()`이 즉시 return해 **채집도 함께 언다**(E-12). 그러면 긴 루프가 조용히 헛돈다.
 */
function mk(o: MkOpts = {}): BattleSim {
  return createBattle(
    options({
      seed: 7,
      endless: !o.finite,
      deck: ['spear'],
      stage: stageDef({
        waveCount: o.finite ? 1 : 3,
        baseHp: 9999,
        startGold: 100000,
        ...(o.biome ? { biome: o.biome } : {}),
      }),
      enemyDefs: enemyDefs({
        // 난투 피해를 3으로 낮춘다 — 기본값(cost 40 → 13)이면 채집꾼이 첫 뭉치에 즉사해
        // "맞으면 진행분만 0"(E-11)이 죽는 판정에 가려 한 번도 안 밟힌다
        warrior: { hp: 2000, speed: 0.25, cost: 40, brawl: { dmg: 3, cooldownTicks: 30 } },
      }),
      allyDefs: allyDefs({
        // 실제 채집꾼과 같은 축: 못 싸우고(blocks false), 빨리 캐고(300%), 둘 진다.
        gatherer: { hp: 400, dmg: 1, range: 0.9, speed: 1.3, blocks: false, gatherPct: 300, carryCap: 2 },
        // 짐 하나만 지는 대조 — carryCap 생략(=1)이 아니라 **명시**한다
        clubber: { hp: 400, dmg: 1, range: 0.9, speed: 1.3, blocks: false, gatherPct: 300, carryCap: 1 },
        // **못 캐는 종** (위약 아군이 정확히 이 값이다). gatherTicksFor가 Infinity를 돌려준다
        slinger: { hp: 400, dmg: 1, range: 0.9, speed: 1.3, blocks: false, gatherPct: 0, carryCap: 1 },
        ...o.allies,
      }),
      // ⚠ **웨이브 보상을 0으로 둔다.** 목 기본은 10이고 빈 웨이브는 즉시 완료되므로,
      //   무한 모드에서 골드가 90틱마다 저절로 는다 — 그러면 이 파일의 "골드가 안 늘었다"
      //   항목이 전부 채집이 아니라 웨이브 보상을 재게 된다. 채집만 남긴다.
      waves: o.enemies
        ? [
            wave([{ enemyId: 'warrior', count: 8, intervalTicks: 40 }], 0),
            wave([{ enemyId: 'warrior', count: 8, intervalTicks: 40 }], 0),
          ]
        : [wave([{ count: 0 }], 0)],
    }),
    { gatherBaseValue: B, ...o.tuning },
  );
}

/** n틱 굴리며 이벤트를 모은다 (fixtures.runTicks와 같지만 sim 인자 타입만 좁혔다) */
function run(sim: BattleSim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.tick();
    out.push(...sim.drainEvents());
  }
  return out;
}

/** 조건이 참이 될 때까지 굴린다. 이벤트를 모아 돌려주고, 못 만나면 그 자리에서 빨개진다 */
function runUntil(sim: BattleSim, why: string, pred: () => boolean, max = 2000): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    if (pred()) return out;
    sim.tick();
    out.push(...sim.drainEvents());
  }
  expect(pred(), `${why}: ${max}틱 안에 일어나지 않았다`).toBe(true);
  return out;
}

function train(sim: BattleSim, defId: 'gatherer' | 'clubber' | 'slinger' = 'gatherer'): AllyState {
  expect(sim.applyCommand({ type: 'trainAlly', defId })).toBe(true);
  const a = sim.state.allies[sim.state.allies.length - 1];
  expect(a, '출동한 부족원이 목록에 있다').toBeDefined();
  return a as AllyState;
}

function send(sim: BattleSim, allyId: number, c: { x: number; z: number }): boolean {
  return sim.applyCommand({ type: 'moveAlly', allyId, cellX: c.x, cellZ: c.z });
}

function cellAt(sim: BattleSim, c: { x: number; z: number }): ResourceCellState {
  const r = sim.resourceAt(c.x, c.z);
  expect(r, `(${c.x},${c.z})는 자원 칸이어야 한다`).not.toBeNull();
  return r as ResourceCellState;
}

/** 내부 필드(AllySim.gatherHpMark)를 읽고 쓰기 위한 캐스트 — 의도된 비공개다 */
function raw(a: AllyState): Record<string, number | boolean> {
  return a as unknown as Record<string, number | boolean>;
}

describe('채집 — 밭과 명령', () => {
  it('자원 밭은 소품 칸과 **정확히 같은 집합**이고 셀 키 오름차순이다', () => {
    const sim = mk();
    const list = sim.state.resources;
    expect(list.length).toBeGreaterThan(0);
    let prev = -1;
    for (const r of list) {
      const key = r.cellZ * 10 + r.cellX;
      expect(key, '셀 키 오름차순으로 굳어 있다').toBeGreaterThan(prev);
      prev = key;
      expect(sim.hasScenery(r.cellX, r.cellZ), `(${r.cellX},${r.cellZ})에 소품이 있다`).toBe(true);
      expect(r.taken).toBe(false);
    }
    // 소품이 없는 칸은 자원도 없다 — 두 판정이 갈리면 화면이 설명할 수 없는 칸이 생긴다
    let scenery = 0;
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 10; x++) {
        if (sim.hasScenery(x, z)) scenery++;
        else expect(sim.resourceAt(x, z), `(${x},${z})`).toBeNull();
      }
    }
    expect(scenery).toBe(list.length);
    // 격자 밖 · 정수가 아닌 셀은 언제나 null
    expect(sim.resourceAt(-1, 0)).toBeNull();
    expect(sim.resourceAt(10, 2)).toBeNull();
    expect(sim.resourceAt(0.5, 0)).toBeNull();
  });

  it('E-13) 배달 반경 안에는 자원 칸이 **하나도 없다** — "캐면서 마을 안"은 존재하지 않는다', () => {
    const sim = mk();
    // ⚠ 이 성질이 `updateGather`의 한 줄을 떠받친다: 맞아서 중단된 틱은 `continue`로
    //   **배달 판정까지 건너뛴다.** 반경 안에 자원 칸이 있으면 "캐는 중이면서 마을 안"인
    //   사람이 그 틱에만 지급을 못 받는 설명 불가능한 규칙이 생긴다.
    // ⚠ 여기서 잠그는 것은 **목 스테이지**뿐이다 — 배포본 6판에 대한 같은 검사는
    //   자원 표를 소유한 tests/data/resources.test.ts의 몫이다.
    for (const r of sim.state.resources) {
      const d = Math.hypot(r.cellX - BASE.x, r.cellZ - BASE.z);
      expect(d, `(${r.cellX},${r.cellZ})가 배달 반경 안이다`).toBeGreaterThan(GATHER_DELIVER_RANGE);
    }
  });

  it('짐값은 마을거리의 함수이고 판 내내 안 변한다 (같은 종이면 멀수록 크거나 같다)', () => {
    const sim = mk();
    const byKind = new Map<string, { d: number; v: number }[]>();
    for (const r of sim.state.resources) {
      const dx = r.cellX - BASE.x;
      const dz = r.cellZ - BASE.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      // 값의 출처가 balance.gatherValueFor 하나임을 못 박는다 (round는 여기서 딱 한 번 닿는다)
      expect(r.value, `(${r.cellX},${r.cellZ}) ${r.kind}`).toBe(
        gatherValueFor(B, RESOURCE_DEFS[r.kind].kindMul, d),
      );
      const rows = byKind.get(r.kind) ?? [];
      rows.push({ d, v: r.value });
      byKind.set(r.kind, rows);
    }
    for (const [kind, rows] of byKind) {
      rows.sort((p, q) => p.d - q.d);
      for (let i = 1; i < rows.length; i++) {
        expect((rows[i] as { v: number }).v, `${kind} 단조성`).toBeGreaterThanOrEqual(
          (rows[i - 1] as { v: number }).v,
        );
      }
    }
  });

  it('⑦ 예약은 배타적이다 — 둘을 같은 칸에 보내면 낮은 id만 예약하고 높은 id는 그냥 선다', () => {
    const sim = mk();
    const a = train(sim);
    const b = train(sim);
    expect(send(sim, a.id, NEAR)).toBe(true);
    // 개별 지정이라 ③(한 사람 고르기)을 안 탄다 — 둘 다 걸어간다. 예약만 배타적이다
    expect(send(sim, b.id, NEAR)).toBe(true);
    expect(a.gatherKey).toBeGreaterThanOrEqual(0);
    expect(b.gatherKey, '둘째는 예약을 못 붙인다').toBe(-1);
    // 그래도 **이동 명령 자체는 성공**이다 — 헛걸음을 막는 것은 sim이 아니라 UI다(E-5)
    expect(b.tgtX).toBe(NEAR.x);
    expect(b.tgtZ).toBe(NEAR.z);
    const evs = runUntil(sim, '첫째가 짐을 진다', () => a.carryCount > 0);
    expect(eventsOf(evs, 'gathered').length, '한 칸에서 짐은 하나만 나온다').toBe(1);
    expect(b.carryCount).toBe(0);
  });

  it('E-9 종족 명령이 자원 칸에 오면 **한 사람만** 움직인다 (나머지는 자리도 안 바꾼다)', () => {
    const sim = mk();
    const a = train(sim);
    const b = train(sim);
    const bx = b.tgtX;
    const bz = b.tgtZ;
    expect(
      sim.applyCommand({ type: 'moveAlly', allyId: -1, defId: 'gatherer', cellX: NEAR.x, cellZ: NEAR.z }),
    ).toBe(true);
    expect(a.gatherKey, '낮은 id가 맡는다').toBeGreaterThanOrEqual(0);
    expect(b.gatherKey).toBe(-1);
    expect({ x: b.tgtX, z: b.tgtZ }, '둘째는 목표조차 안 바뀐다').toEqual({ x: bx, z: bz });
    // 자원 칸이 **아닌** 칸이면 지금까지와 똑같이 전원이 움직인다
    expect(sim.applyCommand({ type: 'moveAlly', allyId: -1, defId: 'gatherer', cellX: 5, cellZ: 2 })).toBe(true);
    expect(b.tgtX).toBe(5);
  });

  it('E-9 고르는 규칙은 **gatherPct 내림차순 → id 오름차순**이다 (결정론이라 규칙이 하나다)', () => {
    // 전투 3종보다 채집꾼이 잘 캐므로, 전원 명령이 오면 **잘 캐는 사람**이 간다.
    // 부동소수 동점이 없도록 전부 정수 비교다.
    const sim = mk({ allies: { clubber: { gatherPct: 100, blocks: false, speed: 1.3, carryCap: 1 } } });
    const slow = train(sim, 'clubber'); // 먼저 뽑혀 id가 낮다
    const fast = train(sim, 'gatherer'); // gatherPct 300
    expect(
      sim.applyCommand({ type: 'moveAlly', allyId: -1, cellX: NEAR.x, cellZ: NEAR.z }),
    ).toBe(true);
    expect(fast.gatherKey, '**낮은 id가 아니라** 잘 캐는 사람이 간다').toBeGreaterThanOrEqual(0);
    expect(slow.gatherKey).toBe(-1);
    // 같은 gatherPct끼리는 id 오름차순이다 (orderOrder가 id순이라 앞사람이 이긴다)
    const sim2 = mk();
    const a = train(sim2);
    const b = train(sim2);
    expect(sim2.applyCommand({ type: 'moveAlly', allyId: -1, cellX: NEAR.x, cellZ: NEAR.z })).toBe(true);
    expect(a.gatherKey).toBeGreaterThanOrEqual(0);
    expect(b.gatherKey).toBe(-1);
  });

  it('E-9 **놀고 있는 사람이 캐는 중인 사람을 이긴다** — 둘째 채집꾼이 실제로 나간다', () => {
    // ⚠ 실측으로 잡은 결함의 회귀 방벽이다. 이 단(段)이 없으면 후보가 gatherPct 동점이라
    //   언제나 **낮은 id**가 뽑혀, 1번이 캐던 칸을 버리고(진행분 소멸) 새 칸으로 옮겨 간다.
    //   그러면 채집꾼을 몇을 뽑든 **실질 가동은 영영 1명**이고, 정원을 세는 밸런스 계산이
    //   통째로 거짓이 된다(T6이 이 위에서 짐값을 맞추면 그 숫자가 전부 틀린다).
    const sim = mk();
    const first = train(sim); // id 낮음
    const second = train(sim); // id 높음
    // ⚠ 규칙 8) **2번을 빈 칸에 세워 자동을 끈다.** 안 그러면 2번은 뽑히자마자 스스로
    //   가까운 칸을 캐러 나가 "놀고 있는 사람"이라는 이 항목의 전제가 사라진다
    //   (그때는 둘 다 3단이 되고, 이 판정이 재려던 2단이 한 번도 안 밟힌다).
    expect(send(sim, second.id, HOLD)).toBe(true);
    expect(second.autoHold, '빈 칸 명령 = 여기 지켜').toBe(true);
    // 1번을 FAR_A로 보내 실제로 캐게 만든다
    expect(sim.applyCommand({ type: 'moveAlly', allyId: -1, cellX: FAR_A.x, cellZ: FAR_A.z })).toBe(true);
    expect(first.gatherKey).toBeGreaterThanOrEqual(0);
    runUntil(sim, '1번이 FAR_A에 도착해 캐기 시작', () => first.gatherTicks > 0);
    const keyA = first.gatherKey;
    const ticksA = first.gatherTicks;
    expect(ticksA).toBeGreaterThan(0);

    // 이제 **다른 칸**을 찍는다 — 놀고 있는 2번이 가야 한다
    expect(sim.applyCommand({ type: 'moveAlly', allyId: -1, cellX: FAR_B.x, cellZ: FAR_B.z })).toBe(true);

    expect(second.gatherKey, '놀던 2번이 새 칸을 맡는다').toBeGreaterThanOrEqual(0);
    expect(first.gatherKey, '1번은 자기 칸을 그대로 지킨다').toBe(keyA);
    expect(first.gatherTicks, '1번의 진행분이 파괴되지 않는다').toBeGreaterThanOrEqual(ticksA);
    expect(second.gatherKey).not.toBe(first.gatherKey);

    // 그리고 둘 다 실제로 자기 칸을 캐낸다 = 가동이 정말 2명이다.
    // ⚠ 텄음 칸 **수**는 이제 못 센다: 2번이 명령을 받는 순간 자동이 다시 켜지므로
    //   (일감 = 자동 온, 규칙 8-b) 둘 다 그 뒤로 계속 일한다. 세는 대신 **맡은 두 칸이
    //   각각 텄는가**를 본다 — 이 항목이 재려는 것은 "둘이 동시에 일한다"이지 총량이 아니다.
    const got = run(sim, 3000).filter((e) => e.type === 'gathered');
    const byAlly = new Set(got.map((e) => (e as { allyId: number }).allyId));
    expect(byAlly.size, '두 사람이 각각 캤다 = 실질 가동 2명').toBe(2);
    expect(cellAt(sim, FAR_A).taken, '1번이 맡은 칸이 텄다').toBe(true);
    expect(cellAt(sim, FAR_B).taken, '2번이 맡은 칸이 텄다').toBe(true);
  });

  it('E-9 전부 캐는 중이면 **진행분이 가장 적은 사람**이 옮겨 간다 (버리는 값이 최소)', () => {
    const sim = mk();
    const a = train(sim);
    const b = train(sim);
    // a를 먼저 캐게 하고, 조금 뒤 b도 캐게 해서 진행분에 차이를 만든다
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, 'a가 캐기 시작', () => a.gatherTicks > 0);
    run(sim, 10);
    expect(send(sim, b.id, FAR_B)).toBe(true);
    runUntil(sim, 'b가 캐기 시작', () => b.gatherTicks > 0);
    expect(a.gatherTicks).toBeGreaterThan(b.gatherTicks); // a가 더 많이 캤다

    // 셋째 칸을 종족 명령으로 찍는다 → 덜 캔 b가 옮겨 가야 한다
    const aTicks = a.gatherTicks;
    expect(sim.applyCommand({ type: 'moveAlly', allyId: -1, cellX: NEAR.x, cellZ: NEAR.z })).toBe(true);
    expect(a.gatherTicks, '더 많이 캔 사람은 안 건드린다').toBeGreaterThanOrEqual(aTicks);
    expect(b.gatherTicks, '덜 캔 사람이 옮겨 가며 진행분을 버린다').toBe(0);
  });

  it('⑥ gatherPct 0인 종은 못 캔다 — 명령은 성공하고 예약만 안 붙는다', () => {
    const sim = mk();
    const s = train(sim, 'slinger');
    // 전제: 이 종은 실제로 "못 캐는" 값이다 (호출부가 안 걸러 주면 Infinity가 새어 나온다)
    expect(gatherTicksFor(allyDef('slinger', { gatherPct: 0 }), 'fruit')).toBe(Infinity);
    expect(send(sim, s.id, NEAR), '이동 명령 자체는 성공한다').toBe(true);
    expect(s.gatherKey).toBe(-1);
    const evs = run(sim, 900);
    expect(eventsOf(evs, 'gatherStarted').length).toBe(0);
    expect(eventsOf(evs, 'gathered').length).toBe(0);
    expect(cellAt(sim, NEAR).taken).toBe(false);
    // 종족 명령에서도 후보에서 빠진다 — 뽑아 봐야 헛걸음만 시킨다
    expect(
      sim.applyCommand({ type: 'moveAlly', allyId: -1, defId: 'slinger', cellX: NEAR.x, cellZ: NEAR.z }),
    ).toBe(true);
    expect(s.gatherKey).toBe(-1);
  });

  it('정수 셀만 자원 칸이 될 수 있다 — 키가 우연히 정수가 되는 소수쌍을 막는다', () => {
    const sim = mk();
    const a = train(sim);
    // ⚠ 이 쌍이 이 테스트의 전부다: gridW 10에서 key = 0.25 × 10 + 0.5 = **3.0(정수)** 이고
    //   셀 (3,0)은 실제 자원 칸이다. 가드가 없으면 아군은 (0.5, 0.25)에 **서서** 맵 반대편
    //   칸을 캐게 되고, 마을 반경 안에 서서 캐 왕복 0으로 배달하는 길이 열린다(D3 무효화).
    const ghost = { x: 0.5, z: 0.25 };
    expect(ghost.z * 10 + ghost.x, '이 소수쌍의 셀 키는 정수다').toBe(3);
    expect(cellAt(sim, { x: 3, z: 0 }).taken).toBe(false);
    expect(send(sim, a.id, ghost), '이동 명령 자체는 지금까지와 똑같이 성공한다').toBe(true);
    expect(a.gatherKey, '소수 셀에는 예약이 안 붙는다').toBe(-1);
    run(sim, 600);
    expect(cellAt(sim, { x: 3, z: 0 }).taken, '(3,0)은 그대로 남아 있다').toBe(false);
    expect(a.carryCount).toBe(0);
  });
});

describe('채집 — 캐기와 배달', () => {
  it('② 배달해야 돈이 된다 — gathered 뒤 골드 불변, gatherDelivered 뒤에만 증가', () => {
    const sim = mk();
    const a = train(sim);
    const cell = cellAt(sim, NEAR);
    const gold0 = sim.state.gold;
    expect(send(sim, a.id, NEAR)).toBe(true);

    const evs1 = runUntil(sim, '짐을 진다', () => a.carryCount > 0);
    const got = eventsOf(evs1, 'gathered');
    expect(got.length).toBe(1);
    expect((got[0] as { value: number }).value).toBe(cell.value);
    expect(cell.taken, '짐을 진 순간 칸이 텄다 (한 칸 한 짐)').toBe(true);
    expect(a.carryGold).toBe(cell.value);
    expect(sim.state.gold, '⚠ 캤다고 골드가 나가면 안 된다 — 지급은 배달뿐이다').toBe(gold0);
    expect(eventsOf(evs1, 'gatherDelivered').length).toBe(0);

    // carryCap 2인데 짐이 하나뿐이라 **자동 귀환은 안 걸린다**(E-18).
    // ⚠ 규칙 8) 그 자리에 서 있지는 않는다 — 자동이 같은 틱에 다음 칸을 잡는다.
    //   이 항목이 재는 것은 "배달해야 돈이 된다"이므로 **빈 칸을 찍어 자동을 끈다**.
    expect(send(sim, a.id, HOLD)).toBe(true);
    expect(a.autoHold).toBe(true);
    run(sim, 300);
    expect(sim.state.gold, '짐 하나 들고 서 있으면 영원히 0이다').toBe(gold0);

    // 마을로 보내야 비로소 지급된다
    expect(send(sim, a.id, BASE)).toBe(true);
    const evs2 = runUntil(sim, '배달한다', () => sim.state.gold !== gold0);
    const del = eventsOf(evs2, 'gatherDelivered');
    expect(del.length).toBe(1);
    expect((del[0] as { gold: number }).gold).toBe(cell.value);
    expect((del[0] as { loads: number }).loads).toBe(1);
    expect(sim.state.gold).toBe(gold0 + cell.value);
    expect(a.carryGold).toBe(0);
    expect(a.carryCount).toBe(0);
  });

  it('③ 한 칸의 총 지급은 그 칸의 value **정확히 한 번**이다 (초과도 미달도 없다)', () => {
    const sim = mk();
    const a = train(sim);
    const cell = cellAt(sim, NEAR);
    const gold0 = sim.state.gold;
    expect(send(sim, a.id, NEAR)).toBe(true);
    runUntil(sim, '짐을 진다', () => a.carryCount > 0);
    expect(send(sim, a.id, BASE)).toBe(true);
    runUntil(sim, '배달한다', () => a.carryCount === 0);
    // 텄음 칸에 다시 보내도 한 푼도 더 안 나온다
    expect(send(sim, a.id, NEAR)).toBe(true);
    expect(a.gatherKey, '텄음 칸에는 예약이 안 붙는다 (E-6)').toBe(-1);
    const evs = run(sim, 900);
    expect(eventsOf(evs, 'gathered').length).toBe(0);
    expect(sim.state.gold - gold0, '총 지급 = value 한 번').toBe(cell.value);
  });

  it('① 부분 지급은 없다 — 캐다 만 사람이 마을에 닿아도 골드는 0이다', () => {
    const sim = mk();
    const a = train(sim);
    const gold0 = sim.state.gold;
    expect(send(sim, a.id, FAR_A)).toBe(true);
    // 도착해 캐기 시작할 때까지만 굴린다
    runUntil(sim, '캐기를 시작한다', () => raw(a)['gatherHpMark'] !== 0);
    const need = gatherTicksFor(allyDef('gatherer', { gatherPct: 300 }), cellAt(sim, FAR_A).kind);
    run(sim, Math.floor(need / 2)); // 절반만 캔다
    expect(a.gatherTicks).toBeGreaterThan(0);
    expect(a.gatherTicks).toBeLessThan(need);
    // E-2) 진행분을 진 채 마을로 — 예약은 풀리고 **진행분은 폐기**된다
    expect(send(sim, a.id, BASE)).toBe(true);
    expect(a.gatherKey).toBe(-1);
    expect(a.gatherTicks).toBe(0);
    run(sim, 500);
    expect(sim.state.gold, '캐다 만 것은 한 푼도 아니다').toBe(gold0);
    expect(cellAt(sim, FAR_A).taken, '앞 칸은 안 텄으므로 살아 돌아온다').toBe(false);
  });

  it('⑩ carryCap 2는 두 칸을 지고 **한 번에** 지급된다 (자동 귀환은 가득 찼을 때만)', () => {
    const sim = mk();
    const a = train(sim);
    const c1 = cellAt(sim, FAR_A);
    const c2 = cellAt(sim, FAR_B);
    const gold0 = sim.state.gold;
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, '첫 짐', () => a.carryCount === 1);
    expect(a.tgtX, '짐이 하나면 자동 귀환이 안 걸린다 — 그 자리에 선다').toBe(FAR_A.x);
    expect(send(sim, a.id, FAR_B)).toBe(true);
    const evs = runUntil(sim, '둘째 짐', () => a.carryCount === 2);
    const got = eventsOf(evs, 'gathered');
    expect((got[got.length - 1] as { carried: number }).carried).toBe(2);
    // 가득 찼다 → **자동 귀환**. 목표는 집결 지점이 아니라 **기지 셀 자체**여야 한다
    expect({ x: a.tgtX, z: a.tgtZ }, '자동 귀환 목표는 기지 셀이다').toEqual(BASE);
    expect(sim.state.gold, '아직 한 푼도 안 나갔다').toBe(gold0);
    const evs2 = runUntil(sim, '배달', () => a.carryCount === 0);
    const del = eventsOf(evs2, 'gatherDelivered');
    expect(del.length, '두 짐이 **한 번에** 나간다').toBe(1);
    expect((del[0] as { loads: number }).loads).toBe(2);
    expect((del[0] as { gold: number }).gold).toBe(c1.value + c2.value);
    expect(sim.state.gold).toBe(gold0 + c1.value + c2.value);
  });

  it('⑪ 규칙 8) 배달 뒤 손을 떼도 **다시 나간다** — 자동 반복이 있다 (사용자 항목 4)', () => {
    // ⚠ 이 항목은 T2의 "⑪ 자동 반복이 없다(D4)"를 **뒤집은 것**이다. 사용자가 정한
    //   방향이 "채집이 끝나면 다음 채집 및 홈타운에 들어와 놓고, 다시 나간다"이고,
    //   그 규칙은 sim에 있다(규칙 8). 바로 아래 항목이 **반대 방향**을 잠근다 —
    //   자동을 끄면(빈 칸 명령) 정말로 서 있는지. 둘이 한 쌍이라야 판별력이 있다.
    const sim = mk();
    const a = train(sim);
    expect(send(sim, a.id, NEAR)).toBe(true);
    runUntil(sim, '짐', () => a.carryCount > 0);
    expect(send(sim, a.id, BASE)).toBe(true);
    runUntil(sim, '배달', () => a.carryCount === 0);
    const gold1 = sim.state.gold;
    // ⚠ 배달한 **그 틱**에 이미 다음 칸이 붙어 있다 — 8-c가 8-b 바로 뒤이기 때문이다.
    //   한 틱이라도 늦으면 "들어와 놓고 다시 나간다"가 왕복마다 지연을 쌓는다.
    expect(a.gatherKey, '배달과 같은 틱에 다음 칸을 잡는다').toBeGreaterThanOrEqual(0);
    const evs = run(sim, 1000);
    expect(eventsOf(evs, 'gathered').length, '스스로 다음 칸을 캔다').toBeGreaterThan(0);
    expect(eventsOf(evs, 'gatherDelivered').length, '스스로 마을에 들어와 놓는다').toBeGreaterThan(0);
    expect(sim.state.gold, '손을 떼도 수입이 흐른다').toBeGreaterThan(gold1);
  });

  it('⑪-b 규칙 8-b) **빈 칸을 찍으면 자동이 꺼진다** — 1,000틱을 굴려도 한 톨도 안 캔다', () => {
    // ⚠ 위 항목의 짝이다. 이것이 빨개지지 않으면 위 항목은 "자동이 켜져 있다"가 아니라
    //   "무엇을 해도 캔다"를 재는 자가 된다(= 실패 불가능한 계약).
    const sim = mk();
    const a = train(sim);
    expect(send(sim, a.id, HOLD)).toBe(true);
    expect(a.autoHold, '자원도 적도 기지도 아닌 칸 = 여기 지켜').toBe(true);
    const gold0 = sim.state.gold;
    const evs = run(sim, 1000);
    expect(eventsOf(evs, 'gatherStarted').length, '캐기 시작조차 안 한다').toBe(0);
    expect(eventsOf(evs, 'gathered').length).toBe(0);
    expect(sim.state.gold, '대기 중인 사람은 한 푼도 안 번다').toBe(gold0);
    expect(a.gatherKey).toBe(-1);
    expect({ x: a.tgtX, z: a.tgtZ }, '찍어 준 자리에 서 있는다').toEqual(HOLD);
    expect(sim.state.resources.some((r) => r.taken), '칸이 하나도 안 텄다').toBe(false);

    // 규칙 8-b) **기지 셀을 찍으면 자동이 다시 켜진다** — 그 문장이 사용자 항목 4다
    expect(send(sim, a.id, BASE)).toBe(true);
    expect(a.autoHold, '기지 셀 = 돌아와서 내려놓고 다시 일해').toBe(false);
    runUntil(sim, '자동이 다시 일을 잡는다', () => a.gatherKey >= 0);
    runUntil(sim, '다시 나가 캔다', () => sim.state.resources.some((r) => r.taken), 1500);
  });

  it('계약 A′) **사람이 없으면 코인도 없다** — 아군 0명인 판은 2,000틱을 굴려도 채집 0건', () => {
    // ⚠ T2의 계약 A("탭이 없으면 코인도 없다")는 규칙 8과 함께 **철회됐다.**
    //   근거가 "탭이 없으면"에서 **"사람이 없으면"**으로 옮겨간 것뿐이고, 봉투 [5]와
    //   `18.idleZero`의 결과는 안 바뀐다: `gatherKey`를 0 이상으로 만드는 두 통로
    //   (`moveAlly` · `updateAllyAuto`)가 **둘 다 살아 있는 아군을 순회**하므로,
    //   `trainAlly`를 한 번도 안 낸 판은 그 순회가 0번 돈다.
    const sim = mk();
    const gold0 = sim.state.gold;
    expect(sim.state.allies.length, '이 판에는 사람이 없다').toBe(0);
    const evs = run(sim, 2000);
    expect(eventsOf(evs, 'gatherStarted').length).toBe(0);
    expect(eventsOf(evs, 'gathered').length).toBe(0);
    expect(eventsOf(evs, 'gatherDelivered').length).toBe(0);
    expect(sim.state.gold).toBe(gold0);
    expect(sim.state.resources.some((r) => r.taken)).toBe(false);
  });

  it('뽑기만 해서는 지급이 안 된다 — 집결 자리는 배달 반경 밖이다 (둘째 방어선)', () => {
    // 자동이 켜져 있어도 **태어난 그 틱**에는 아직 예약도 짐도 없다. 그리고 집결 자리가
    // 배달 반경 안이면 resetAlly가 carryGold를 놓치는 순간 trainAlly가 곧 addGold가 된다.
    const sim = mk();
    for (let i = 0; i < 4; i++) train(sim);
    for (const a of sim.state.allies) {
      expect(a.gatherKey).toBe(-1);
      expect(a.gatherTicks).toBe(0);
      expect(a.carryCount).toBe(0);
      expect(a.autoHold, '기본값은 자동 켜짐이다').toBe(false);
      const d = Math.hypot(a.x - BASE.x, a.z - BASE.z);
      expect(d, '집결 자리는 배달 반경 밖이다').toBeGreaterThan(GATHER_DELIVER_RANGE);
    }
    // 전원을 빈 칸에 세우면(자동 끔) 2,000틱을 방치해도 골드가 한 푼도 안 는다
    const gold0 = sim.state.gold;
    expect(sim.applyCommand({ type: 'moveAlly', allyId: -1, cellX: HOLD.x, cellZ: HOLD.z })).toBe(true);
    const evs = run(sim, 2000);
    expect(eventsOf(evs, 'gathered').length).toBe(0);
    expect(sim.state.gold).toBe(gold0);
  });

  it('풀 재사용) 죽은 사람의 채집 상태가 새 부족원에게 새지 않는다 (resetAlly 다섯 줄)', () => {
    const sim = mk();
    const a = train(sim);
    expect(send(sim, a.id, NEAR)).toBe(true);
    runUntil(sim, '짐', () => a.carryCount > 0);
    // 짐을 진 채 죽인다 — 슬롯이 풀로 반납된다
    const r = raw(a);
    r['hp'] = 0;
    r['alive'] = false;
    run(sim, 2);
    expect(sim.state.allies.length).toBe(0);
    // 같은 슬롯을 물려받는 새 부족원 — 다섯 필드가 전부 초기값이어야 한다
    const b = train(sim);
    // ⚠ 기준 골드는 **출동 비용을 낸 뒤**에 잡는다. 앞에서 잡으면 이 항목이 재는 것이
    //   채집 누수가 아니라 trainAlly의 가격이 된다
    const gold0 = sim.state.gold;
    expect(b.gatherKey).toBe(-1);
    expect(b.gatherTicks).toBe(0);
    expect(b.carryGold).toBe(0);
    expect(b.carryCount).toBe(0);
    expect(raw(b)['gatherHpMark']).toBe(0);
    run(sim, 300);
    expect(sim.state.gold, '⚠ 여기서 골드가 늘면 trainAlly가 곧 addGold가 된 것이다').toBe(gold0);
  });
});

describe('채집 — 어긋나는 길 (E-1 ~ E-14)', () => {
  it('E-1) 같은 칸 재명령은 진행분을 **유지**한다 (연타가 손해가 되면 안 된다)', () => {
    const sim = mk();
    const a = train(sim);
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, '캐기 시작', () => a.gatherTicks > 5);
    const t0 = a.gatherTicks;
    const evs: SimEvent[] = [];
    expect(send(sim, a.id, FAR_A)).toBe(true);
    evs.push(...sim.drainEvents());
    expect(a.gatherTicks, '진행분이 그대로다').toBe(t0);
    expect(eventsOf(evs, 'gatherLost').length, '취소 이벤트가 안 난다').toBe(0);
  });

  it('E-3) 채집 중 다른 자원 칸으로 — 앞 예약은 풀리고(moved) 앞 칸은 살아 돌아온다', () => {
    const sim = mk();
    const a = train(sim);
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, '캐기 시작', () => a.gatherTicks > 5);
    sim.drainEvents();
    expect(send(sim, a.id, NEAR)).toBe(true);
    const evs = sim.drainEvents();
    const lost = eventsOf(evs, 'gatherLost');
    expect(lost.length).toBe(1);
    expect((lost[0] as { reason: string }).reason).toBe('moved');
    expect((lost[0] as { gold: number }).gold, '짐은 안 건드린다').toBe(0);
    // ⚠ 이 호출 하나가 이벤트를 **2건** 낸다 — 취소와 명령
    expect(eventsOf(evs, 'allyOrdered').length).toBe(1);
    expect(a.gatherTicks).toBe(0);
    expect(cellAt(sim, FAR_A).taken, '취소 값이 0이다 — 앞 칸은 안 텄다').toBe(false);
    runUntil(sim, '새 칸에서 짐', () => a.carryCount > 0);
    expect(cellAt(sim, NEAR).taken).toBe(true);
    expect(cellAt(sim, FAR_A).taken).toBe(false);
  });

  it('E-4) 짐을 진 채 딴 데로 보내도 돈은 안 사라진다 — 반경에 드는 순간 지급된다', () => {
    const sim = mk();
    const a = train(sim);
    const cell = cellAt(sim, NEAR);
    const gold0 = sim.state.gold;
    expect(send(sim, a.id, NEAR)).toBe(true);
    runUntil(sim, '짐', () => a.carryCount > 0);
    // 마을이 아닌 엉뚱한 데로 보낸다 — 짐은 그대로 진다
    expect(send(sim, a.id, { x: 0, z: 0 })).toBe(true);
    run(sim, 250);
    expect(a.carryCount).toBe(1);
    expect(sim.state.gold).toBe(gold0);
    // 비상 소집 — **어디로 가던 중이든** 반경에 들면 나간다
    expect(send(sim, a.id, BASE)).toBe(true);
    runUntil(sim, '배달', () => a.carryCount === 0);
    expect(sim.state.gold).toBe(gold0 + cell.value);
  });

  it('E-5) 짐이 가득 찬 사람은 자원 칸을 찍어도 예약이 안 붙는다 (이동 명령은 성공)', () => {
    const sim = mk();
    const a = train(sim, 'clubber'); // carryCap 1
    expect(send(sim, a.id, NEAR)).toBe(true);
    runUntil(sim, '짐', () => a.carryCount > 0);
    expect(a.carryCount).toBe(1);
    // 가득 찼으므로 자동 귀환 중이다. 그 상태로 다른 자원 칸을 찍는다
    expect(send(sim, a.id, FAR_A), '⚠ 여기서 false를 돌려주면 moveAlly의 계약이 갈라진다').toBe(true);
    expect(a.gatherKey).toBe(-1);
    expect(a.tgtX).toBe(FAR_A.x);
    // 걸어가는 동안에도 예약은 안 붙는다 — 찍힌 칸은 그대로 남아 있다
    const evs = run(sim, 60);
    expect(eventsOf(evs, 'gatherStarted').length, '가는 중에는 아무것도 안 캔다').toBe(0);
    expect(cellAt(sim, FAR_A).taken).toBe(false);
    // 규칙 8 ⑤) 짐이 가득 찬 채로 도착해 서면 **자동이 마을로 돌려보낸다.**
    // (T2에는 여기서 영영 서 있었다 — E-18 "짐 하나 들고 서 있기"를 자동이 끝낸다)
    runUntil(sim, '자동이 집으로 보낸다', () => a.tgtX === BASE.x && a.tgtZ === BASE.z);
    expect(cellAt(sim, FAR_A).taken, '짐이 가득 찼으므로 그 칸은 못 캔다').toBe(false);
    runUntil(sim, '배달', () => a.carryCount === 0);
  });

  it('E-6) 자원 없는 칸·이미 텄음 칸은 지금까지와 똑같이 그냥 가서 선다', () => {
    const sim = mk();
    const a = train(sim);
    // 자원이 없는 칸 (경로 셀)
    expect(send(sim, a.id, { x: 5, z: 2 })).toBe(true);
    expect(a.gatherKey).toBe(-1);
    // 격자 밖만 거부된다 (기존 규칙 그대로)
    expect(send(sim, a.id, { x: -1, z: 0 })).toBe(false);
    expect(send(sim, a.id, { x: 10, z: 0 })).toBe(false);
    expect(sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: NaN, cellZ: 0 })).toBe(false);
  });

  it('E-14) 캐던 칸이 골드로 치워지면 예약이 풀리고(cleared) 계속 걸어가 그 자리에 선다', () => {
    const sim = mk();
    const a = train(sim);
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, '캐기 시작', () => a.gatherTicks > 5);
    sim.drainEvents();
    expect(sim.applyCommand({ type: 'clearScenery', cellX: FAR_A.x, cellZ: FAR_A.z })).toBe(true);
    const evs = sim.drainEvents();
    const lost = eventsOf(evs, 'gatherLost');
    expect(lost.length, '예약이 배타적이라 정확히 한 명이다').toBe(1);
    expect((lost[0] as { reason: string }).reason).toBe('cleared');
    expect(a.gatherKey).toBe(-1);
    expect({ x: a.tgtX, z: a.tgtZ }, '목표는 유지된다 — 도중에 세우면 화면이 설명할 수 없다').toEqual(FAR_A);
    // 치운 칸은 텄음으로 굳는다 — 배지가 짐값을 계속 그리면 안 된다
    expect(cellAt(sim, FAR_A).taken).toBe(true);
    // **치운 사람이 그 짐을 버린 것이다** — 다시 찍어도 안 캔다
    expect(send(sim, a.id, FAR_A)).toBe(true);
    expect(a.gatherKey).toBe(-1);
  });

  it('예약 칸이 밖에서 텄으면(방어선) 예약만 풀고 계속 걸어가 선다', () => {
    const sim = mk();
    const a = train(sim);
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, '캐기 시작', () => a.gatherTicks > 5);
    // cmdClearScenery는 cancelGatherersOf를 먼저 부르므로 이 경로는 방어선이다.
    // 그래도 **골드를 흘리지 않고 조용히 닫히는지**는 확인해야 한다.
    const keyA = a.gatherKey;
    (cellAt(sim, FAR_A) as { taken: boolean }).taken = true;
    const gold0 = sim.state.gold;
    run(sim, 1);
    // 예약은 그 틱에 조용히 닫힌다 — 골드도 짐도 한 톨 안 샌다
    expect(a.gatherKey, '텄음이 된 칸의 예약은 유지되지 않는다').not.toBe(keyA);
    expect(a.carryCount).toBe(0);
    expect(sim.state.gold).toBe(gold0);
    // ⚠ 규칙 8) 그 자리에 **서 있지는 않는다** — 8-b가 예약을 푼 뒤 같은 틱의 8-c가
    //   도착해 있는 빈손 일꾼에게 다음 칸을 준다. T2에는 여기서 영원히 서 있었다.
    expect(a.gatherKey, '자동이 같은 틱에 다음 칸을 준다').toBeGreaterThanOrEqual(0);
    expect(a.gatherTicks, '새 칸의 진행분은 0에서 시작한다').toBe(0);
  });
});

describe('채집 — 전투 불능과 사망 (D5 · E-10 · E-11)', () => {
  it('D5) 캐는 중·짐을 진 사람은 조준도 봉쇄도 안 한다 (가는 중은 전투 불능이 아니다)', () => {
    const sim = mk({ enemies: true });
    const a = train(sim);
    expect(sim.applyCommand({ type: 'callWave' })).toBe(true);
    expect(send(sim, a.id, FRONT)).toBe(true);
    // 도착 전(가는 중)에는 평소대로 조준한다 — 사거리에 적이 들면 targetId가 선다
    runUntil(sim, '캐기 시작', () => raw(a)['gatherHpMark'] !== 0, 3000);
    // 캐는 중에는 언제나 targetId가 −1이다
    for (let i = 0; i < 200; i++) {
      sim.tick();
      sim.drainEvents();
      if (a.gatherKey >= 0 || a.carryCount > 0) {
        expect(a.targetId, '캐는 중·운반 중에는 조준이 안 선다').toBe(-1);
      }
    }
    // 봉쇄도 안 건다 — 이 아군을 봉쇄자로 지목한 적이 하나도 없어야 한다
    for (const e of sim.state.enemies) expect(e.blockerAllyId).not.toBe(a.id);
  });

  it('E-11) 맞으면 **진행분만** 0으로 — 예약과 짐은 유지되고 hit는 진행분이 있을 때만 난다', () => {
    const sim = mk();
    const a = train(sim);
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, '캐기 시작', () => a.gatherTicks > 20);
    const key = a.gatherKey;
    const mark0 = raw(a)['gatherHpMark'] as number;
    expect(mark0).toBe(a.hp);
    sim.drainEvents();
    // hp를 인위로 깎는다 (난투를 부르지 않고 D5의 판정만 격리해서 잰다)
    raw(a)['hp'] = a.hp - 10;
    const evs = run(sim, 1);
    const lost = eventsOf(evs, 'gatherLost');
    expect(lost.length).toBe(1);
    expect((lost[0] as { reason: string }).reason).toBe('hit');
    expect(a.gatherTicks, '진행분이 0으로 돌아간다').toBe(0);
    expect(a.gatherKey, '예약은 유지된다 — 적이 지나가면 그 자리에서 다시 캔다').toBe(key);
    expect(raw(a)['gatherHpMark'], '새 시도의 시작으로 다시 마크한다').toBe(a.hp);
    // 진행분이 0인 상태에서 또 맞으면 이벤트가 **안** 난다 (초당 여러 건 방지)
    raw(a)['hp'] = a.hp - 10;
    sim.drainEvents();
    // ⚠ 같은 틱에 진행분이 1 오르므로, 맞자마자 바로 다음 틱에 재현해야 0에서의 판정이 된다
    const before = a.gatherTicks;
    expect(before).toBe(0);
    expect(eventsOf(run(sim, 1), 'gatherLost').length, '진행분이 0이면 조용하다').toBe(0);
    // 그리고 gatherStarted는 예약당 한 번뿐이다 — 중단마다 다시 나가면 안 된다
    const evs2 = runUntil(sim, '결국 캔다', () => a.carryCount > 0);
    expect(eventsOf(evs2, 'gatherStarted').length, '중단해도 시작 이벤트는 다시 안 난다').toBe(0);
  });

  it('E-10) 운반 중 사망 = 지급 0 + gatherLost{died} 한 건. 시체는 마을에 닿아도 못 받는다', () => {
    const sim = mk();
    const a = train(sim);
    const cell = cellAt(sim, NEAR);
    const gold0 = sim.state.gold;
    expect(send(sim, a.id, NEAR)).toBe(true);
    runUntil(sim, '짐', () => a.carryCount > 0);
    // 마을 반경 **안**에 시체를 세운다 — 가드가 없으면 그 틱에 지급된다
    const r = raw(a);
    r['x'] = BASE.x;
    r['z'] = BASE.z;
    r['hp'] = 0;
    r['alive'] = false;
    sim.drainEvents();
    const evs = run(sim, 1);
    const lost = eventsOf(evs, 'gatherLost');
    expect(lost.length).toBe(1);
    expect((lost[0] as { reason: string }).reason).toBe('died');
    expect((lost[0] as { gold: number }).gold, '잃은 액수가 이벤트에 실린다').toBe(cell.value);
    expect(eventsOf(evs, 'gatherDelivered').length, '⚠ 시체는 지급받지 않는다').toBe(0);
    expect(sim.state.gold).toBe(gold0);
    // 예약도 즉시 풀린다 — 남이 그 칸을 다시 찍을 수 있어야 한다
    expect(a.gatherKey).toBe(-1);
    expect(a.carryCount).toBe(0);
  });
});

describe('채집 — ⚠ 다 캔 칸은 **사라지고 열린다** (D1 뒤집힘)', () => {
  /**
   * 사용자 재정의: *"채집을 하고 나면 그자리에 없어져야 하는데 그대로 남아 있어, 이걸 없애줘"*.
   * 옛 규칙(다 캔 칸은 그루터기로 남고 건설 불가)이 여기서 **정반대로** 뒤집힌다.
   * 그렇게 안 하면 화면에 아무것도 없는데 못 짓는 칸이 되고, 그건 설명할 방법이 없다.
   */
  it('④⑤ 다 캔 칸은 즉시 **건설 가능**해지고, 그래도 유료 제거 지수는 한 톨 안 오른다', () => {
    const sim = mk();
    const a = train(sim);
    expect(sim.canPlaceAt(NEAR.x, NEAR.z), '캐기 전에는 소품이라 건설 불가다').toBe(false);
    const cost0 = sim.clearSceneryCost(NEAR.x, NEAR.z);
    expect(cost0).not.toBeNull();
    expect(send(sim, a.id, NEAR)).toBe(true);
    runUntil(sim, '짐', () => a.carryCount > 0);
    expect(cellAt(sim, NEAR).taken).toBe(true);
    // ── R1의 직접 증거 셋 ────────────────────────────────────────────────────
    expect(sim.hasScenery(NEAR.x, NEAR.z), '소품이 사라졌다').toBe(false);
    expect(sim.canPlaceAt(NEAR.x, NEAR.z), '그래서 지을 수 있다').toBe(true);
    // R-e) 이미 비어 있고 이미 지을 수 있는 칸에 380골드를 받는 것은 사기다
    expect(sim.clearSceneryCost(NEAR.x, NEAR.z), '텄음 칸에는 유료 제거를 못 판다').toBeNull();
    expect(
      sim.applyCommand({ type: 'clearScenery', cellX: NEAR.x, cellZ: NEAR.z }),
      '커맨드도 같은 답을 쓴다',
    ).toBe(false);
    // ⚠ 그래도 **유료 제거 지수(clearedScenery)는 채집이 한 톨도 안 올린다.**
    //   두 카운터가 서로를 안 보는 것이 유일하게 안전한 배치다 — 안 텄은 다른 칸의 값으로 잰다.
    expect(sim.clearSceneryCost(FAR_A.x, FAR_A.z), '제거 지수가 안 올랐다').toBe(cost0);
    // 실제 배치 커맨드도 통해야 한다 (조회와 커맨드가 같은 답을 쓴다)
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: NEAR.x, cellZ: NEAR.z })).toBe(true);
    // 그리고 그 배치는 유료 제거 지수를 여전히 안 올린다
    expect(sim.clearSceneryCost(FAR_A.x, FAR_A.z)).toBe(cost0);
  });

  it('유료 제거는 오늘과 똑같이 칸을 열고 지수를 올린다 (채집과 갈리는 자리)', () => {
    const sim = mk();
    const cost0 = sim.clearSceneryCost(NEAR.x, NEAR.z);
    expect(cost0).not.toBeNull();
    expect(sim.applyCommand({ type: 'clearScenery', cellX: NEAR.x, cellZ: NEAR.z })).toBe(true);
    expect(sim.canPlaceAt(NEAR.x, NEAR.z)).toBe(true);
    expect(sim.clearSceneryCost(FAR_A.x, FAR_A.z)).toBeGreaterThan(cost0 as number);
  });
});

/**
 * ── 재생: **칸 단위** 규칙 (R1~R6) ─────────────────────────────────────────
 * ⚠ 이 블록은 **최소 지연을 짧게 주입해서** 돈다(`BattleTuning.gatherRegrowTicks`).
 *   배포본 9,000틱(300초)을 그대로 돌리면 항목 하나가 5분짜리가 되고, 그러면 아무도
 *   안 돌려서 규칙이 조용히 죽는다. 주입되는 것은 **모양**뿐이고 총액은 안 움직인다.
 *
 * ⚠⚠ **이 블록은 `gatherRegrowStockFrac: 1` 로 재고 게이트를 열어 두고 돈다.**
 *   재생의 방아쇠는 이제 밭 전체의 **재고 비율**인데(사용자 요구), 여기서 재는 것은
 *   방아쇠가 아니라 **칸 하나가 어떤 규칙을 지키는가**다: 같은 종·같은 값으로 돌아오는가 ·
 *   광물은 안 자라는가 · 타워/유료 제거가 재생권을 태우는가 · 재생권은 한 번뿐인가.
 *   방아쇠를 안 열어 두면 이 항목들이 **밭이 얼마나 비었나에 따라 켜졌다 꺼졌다** 하고,
 *   그러면 무엇이 깨졌는지 말해 주지 못하는 계약이 된다. 방아쇠 자체는 **아래 블록**이
 *   배포본 문턱 그대로 잰다 — 곧 두 블록이 갈라 맡는다.
 *   (frac 1 = 재고 게이트가 없던 옛 규칙과 **완전히 같다** — 그래서 이 블록의 어서션은
 *    재고 게이트가 들어오기 전과 한 글자도 안 달라졌다.)
 * ⚠ **판별력**: `gatherRegrowMax: 0` 을 주면 아래 재생 항목들이 전부 빨개져야 한다 —
 *   맨 아래 "재생을 끄면 안 자란다" 항목이 그 음성 대조를 **실행물로** 들고 있다.
 */
describe('채집 — 재생: 칸 단위 규칙 (R1~R6)', () => {
  /** 재생을 눈으로 볼 수 있는 판 — 최소 지연 60틱(2초) */
  const REGROW_T = 60;
  const mkR = (
    over: { gatherRegrowMax?: number; gatherRegrowTicks?: number; gatherRegrowStockFrac?: number } = {},
  ): BattleSim =>
    mk({ tuning: { gatherRegrowTicks: REGROW_T, gatherRegrowStockFrac: 1, ...over } });

  /** 그 칸을 한 짐 캐게 하고, 캔 아군을 돌려준다 */
  const harvest = (sim: BattleSim, at: { x: number; z: number }): AllyState => {
    const a = train(sim);
    expect(send(sim, a.id, at)).toBe(true);
    runUntil(sim, `${at.x},${at.z} 한 짐`, () => a.carryCount > 0, 4000);
    return a;
  };

  it('R1·R2) 다 캔 칸이 T틱 뒤 **같은 종·같은 값**으로 돌아오고, 그 칸은 다시 건설 불가다', () => {
    const sim = mkR();
    const cell = cellAt(sim, NEAR);
    const kind0 = cell.kind;
    const value0 = cell.value;
    harvest(sim, NEAR);
    expect(cell.taken, '캔 순간 비었다').toBe(true);
    expect(sim.canPlaceAt(NEAR.x, NEAR.z), '비었으니 지을 수 있다').toBe(true);
    // R-a) 타이머는 **캔 순간**에 시작한다 — 배달 순간이 아니다
    expect(cell.regrowAt, '캔 순간 재생 타이머가 걸렸다').toBeGreaterThan(0);
    expect(cell.regrowsLeft, '재생권 하나를 썼다').toBe(0);
    sim.drainEvents();
    runUntil(sim, '다시 자란다', () => !cell.taken, REGROW_T * 4);
    // R2) 종도 값도 다시 뽑지 않는다 — `resourceKindOf` 를 다시 부르면 rng 호출 횟수에 걸린다
    expect(cell.kind, '같은 종으로 돌아온다').toBe(kind0);
    expect(cell.value, '같은 값으로 돌아온다').toBe(value0);
    expect(cell.regrowAt, '타이머가 꺼졌다').toBe(0);
    expect(sim.canPlaceAt(NEAR.x, NEAR.z), '자랐으니 다시 건설 불가다').toBe(false);
    expect(sim.hasScenery(NEAR.x, NEAR.z), '유료 제거를 다시 살 수 있다').toBe(true);
  });

  it('R2) 재생은 `gatherRegrown` 이벤트를 낸다 — 이름이 `gather` 로 시작한다 (18.idleZero)', () => {
    const sim = mkR();
    const cell = cellAt(sim, NEAR);
    harvest(sim, NEAR);
    sim.drainEvents();
    // ⚠ `runUntil` 이 매 틱 이벤트를 걷어 돌려주므로 **그 반환값에서** 찾는다.
    //   술어 안에서 다시 drainEvents 를 부르면 둘이 같은 큐를 놓고 경쟁해 영영 못 만난다.
    const evs = runUntil(sim, '다시 자란다', () => !cell.taken, REGROW_T * 4);
    const ev = evs.find((e) => e.type === 'gatherRegrown');
    expect(ev, '재생 이벤트가 나왔다').toBeDefined();
    const g = ev as { type: string; cellX: number; cellZ: number; kind: string; value: number };
    expect(g.type.startsWith('gather'), '⚠ 이름이 gather 로 시작해야 18.idleZero 가 재생을 함께 잡는다').toBe(true);
    expect([g.cellX, g.cellZ]).toEqual([NEAR.x, NEAR.z]);
    expect(g.kind).toBe(cell.kind);
    expect(g.value).toBe(cell.value);
  });

  it('R4) **광물은 안 자란다** — stone·flint·obsidian 은 캔 순간 영구히 열린다', () => {
    // 화산 바이옴: 광물 84%(flint 20 · stone 30 · obsidian 34) + wood 16% — 한 판에 둘 다 있다
    const sim = mk({
      biome: 'volcano',
      tuning: { gatherRegrowTicks: REGROW_T, gatherRegrowStockFrac: 1 },
    });
    const rocks = sim.state.resources.filter((r) => !REGROWABLE_KINDS.has(r.kind));
    const grow = sim.state.resources.filter((r) => REGROWABLE_KINDS.has(r.kind));
    // 목 스테이지에 두 종류가 다 있어야 이 항목이 헛돌지 않는다
    expect(rocks.length, '광물 칸이 있다').toBeGreaterThan(0);
    expect(grow.length, '재생종 칸도 있다').toBeGreaterThan(0);
    for (const r of rocks) expect(r.regrowsLeft, `${r.kind} 는 재생권이 0이다`).toBe(0);
    for (const r of grow) expect(r.regrowsLeft, `${r.kind} 는 재생권이 있다`).toBeGreaterThan(0);
    const rock = rocks[0] as ResourceCellState;
    harvest(sim, { x: rock.cellX, z: rock.cellZ });
    expect(rock.taken).toBe(true);
    expect(rock.regrowAt, '광물에는 타이머가 안 걸린다').toBe(0);
    run(sim, REGROW_T * 5);
    expect(rock.taken, '광물은 영영 안 자란다').toBe(true);
    expect(sim.canPlaceAt(rock.cellX, rock.cellZ), '영구 건설칸이 됐다').toBe(true);
  });

  it('R3) **타워를 세우면 안 자란다 — 팔아도 안 자란다**', () => {
    const sim = mkR();
    const cell = cellAt(sim, NEAR);
    expect(REGROWABLE_KINDS.has(cell.kind), '이 칸은 원래 자라는 종이다').toBe(true);
    harvest(sim, NEAR);
    expect(cell.regrowAt, '캔 직후에는 타이머가 걸려 있다').toBeGreaterThan(0);
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: NEAR.x, cellZ: NEAR.z })).toBe(true);
    expect(cell.regrowAt, '타워가 재생권을 태웠다').toBe(0);
    expect(cell.regrowsLeft).toBe(0);
    run(sim, REGROW_T * 5);
    expect(cell.taken, '타워가 선 칸은 영영 안 자란다').toBe(true);
    // 팔아도 안 돌아온다 — 소각은 영구다(단조성이 종료 증명과 해시를 단순하게 유지한다)
    const t = sim.state.towers.find((x) => x.cellX === NEAR.x && x.cellZ === NEAR.z);
    expect(t, '방금 세운 타워가 있다').toBeDefined();
    expect(sim.applyCommand({ type: 'sellTower', towerId: (t as { id: number }).id })).toBe(true);
    run(sim, REGROW_T * 5);
    expect(cell.taken, '타워를 팔아도 숲은 안 돌아온다').toBe(true);
    expect(sim.canPlaceAt(NEAR.x, NEAR.z), '맨땅으로 남는다').toBe(true);
  });

  it('R-f) **유료로 치운 칸은 절대 안 자란다** — 돈 내고 산 칸이 다시 막히면 사기다', () => {
    const sim = mkR();
    const cell = cellAt(sim, NEAR);
    expect(REGROWABLE_KINDS.has(cell.kind), '이 칸은 원래 자라는 종이다').toBe(true);
    expect(sim.applyCommand({ type: 'clearScenery', cellX: NEAR.x, cellZ: NEAR.z })).toBe(true);
    expect(cell.taken).toBe(true);
    expect(cell.regrowAt, '재생권이 그 자리에서 탔다').toBe(0);
    expect(cell.regrowsLeft).toBe(0);
    run(sim, REGROW_T * 5);
    expect(cell.taken, '유료로 치운 칸은 T×5 틱 뒤에도 비어 있다').toBe(true);
    expect(sim.canPlaceAt(NEAR.x, NEAR.z), '그리고 계속 지을 수 있다').toBe(true);
  });

  it('R2) 재생권은 **한 번**뿐이다 — 두 번째로 캐면 그 칸은 영구히 열린다', () => {
    const sim = mkR();
    const cell = cellAt(sim, NEAR);
    expect(cell.regrowsLeft, '배포본 재생권은 1이다').toBe(1);
    harvest(sim, NEAR);
    runUntil(sim, '한 번 자란다', () => !cell.taken, REGROW_T * 4);
    // 두 번째 수확 — 재생권이 이미 0이라 타이머가 안 걸린다
    const b = train(sim);
    expect(send(sim, b.id, NEAR)).toBe(true);
    runUntil(sim, '두 번째 짐', () => cell.taken, 4000);
    expect(cell.regrowAt, '재생권이 없으면 타이머도 없다').toBe(0);
    run(sim, REGROW_T * 5);
    expect(cell.taken, '두 번 캔 칸은 영영 안 자란다').toBe(true);
  });

  it('⚠ 판별력) **재생을 끄면**(regrowMax 0) 위 항목들이 재는 사실이 사라진다', () => {
    const sim = mkR({ gatherRegrowMax: 0 });
    const cell = cellAt(sim, NEAR);
    expect(cell.regrowsLeft, '재생권이 0으로 태어난다').toBe(0);
    harvest(sim, NEAR);
    expect(cell.regrowAt, '타이머가 안 걸린다').toBe(0);
    sim.drainEvents();
    run(sim, REGROW_T * 6);
    expect(cell.taken, '재생을 끄면 안 자란다').toBe(true);
    expect(
      sim.drainEvents().some((e) => e.type === 'gatherRegrown'),
      '재생 이벤트가 한 건도 안 나온다',
    ).toBe(false);
  });
});

/**
 * ── 재생의 **방아쇠**: 재고 비율 (사용자 요구 · R7) ─────────────────────────
 * 사용자 문장이 이 블록의 전부다: *"전체적으로 자원의 일정 비율 이하가 되면 자원이 다시
 * 생성 되도록 해줘."* 곧 재생은 이제 칸마다 도는 독립 타이머가 아니라 **밭 전체의 상태**가
 * 켜고 끄는 것이고, 여기서 그 방아쇠를 **양방향으로** 잠근다(위면 안 자란다 / 아래면 자란다).
 *
 * ⚠ 이 블록은 `gatherRegrowStockFrac` 을 **안 주입한다** — 배포본 문턱
 *   (`GATHER_REGROW_STOCK_FRAC`)을 그대로 재는 것이 요점이기 때문이다. 짧게 주입하는 것은
 *   최소 지연 하나뿐이고 그것은 **모양**만 바꾼다.
 * ⚠ **판별력**(전부 실측으로 확인했다):
 *   · `gatherRegrowStockFrac: 1`(= 재고 게이트가 없던 옛 규칙)로 두면
 *     "문턱 위면 안 자란다"와 "문턱에 닿을 때까지만"이 빨개진다.
 *   · `updateRegrow` 의 문턱 비교를 지우면(= 자격만 보면) 같은 둘이 빨개진다.
 *   · 최소 지연을 지우면(= 자격 판정을 없애면) "지연 전에는 안 자란다"가 빨개진다.
 */
describe('채집 — 재생의 방아쇠는 재고 비율이다 (R7)', () => {
  /** 최소 지연 60틱(2초) — 배포본 9,000틱을 그대로 돌리면 항목 하나가 5분짜리가 된다 */
  const T = 60;
  const mkG = (over: MkOpts['tuning'] = {}): BattleSim =>
    mk({ tuning: { gatherRegrowTicks: T, ...over } });

  /** 재고 = 지금 **서 있는 재생종** 칸의 value 합 (`sim/gather.ts updateRegrow` ①과 같은 식) */
  const stock = (sim: BattleSim): number => {
    let n = 0;
    for (const r of sim.state.resources) if (REGROWABLE_KINDS.has(r.kind) && !r.taken) n += r.value;
    return n;
  };
  /**
   * 분모 = 판 시작 시점의 재생종 value 합. **좌표만의 함수**라 판 중에 안 변한다 —
   * 그래서 판 도중에 세도 같은 값이 나온다(이 함수가 `taken` 을 안 보는 것이 그 증거다).
   */
  const denom = (sim: BattleSim): number => {
    let n = 0;
    for (const r of sim.state.resources) if (REGROWABLE_KINDS.has(r.kind)) n += r.value;
    return n;
  };
  /** 이 판에서 게이트가 열리는 재고 값 (value 단위) */
  const needOf = (sim: BattleSim): number => GATHER_REGROW_STOCK_FRAC * denom(sim);

  /**
   * 값이 큰 칸부터 **유료로 치워** 재고를 목표 이하로 내린다.
   *
   * 왜 채집이 아니라 유료 제거인가: 유료 제거는 그 칸을 **영구히** 비우므로(R-f)
   * "밭이 비었다"만 만들고 **자랄 후보는 한 칸도 안 만든다.** 그래서 아래 항목들이
   * 자기가 심어 둔 칸만 보고 판정할 수 있다 — 캐서 비우면 비운 칸마다 자격이 따라붙어
   * 무엇이 왜 자랐는지 말할 수 없게 된다.
   */
  const strip = (sim: BattleSim, keep: readonly { x: number; z: number }[], target: number): void => {
    const kept = new Set(keep.map((c) => `${c.x},${c.z}`)); // 멤버십 검사 전용 (순회 안 한다)
    const order = sim.state.resources
      .filter(
        (r) => REGROWABLE_KINDS.has(r.kind) && !r.taken && !kept.has(`${r.cellX},${r.cellZ}`),
      )
      .slice()
      .sort((a, b) => b.value - a.value || a.cellZ - b.cellZ || a.cellX - b.cellX);
    for (const r of order) {
      if (stock(sim) <= target) break;
      expect(
        sim.applyCommand({ type: 'clearScenery', cellX: r.cellX, cellZ: r.cellZ }),
        `(${r.cellX},${r.cellZ}) 유료 제거가 거부됐다`,
      ).toBe(true);
    }
    expect(stock(sim), '치울 칸이 모자라 목표 재고까지 못 내렸다').toBeLessThanOrEqual(target);
  };

  /**
   * 그 칸을 한 짐 캐게 하고 **그 일꾼을 세운다**(HOLD).
   * ⚠ 세우지 않으면 규칙 8의 자동이 곧바로 다음 칸을 캐서 **재고를 계속 내린다** — 그러면
   *   "문턱 위에서는 안 자란다"를 재는 항목이 자기 손으로 문턱을 넘어 버린다.
   */
  const harvestThenHold = (sim: BattleSim, at: { x: number; z: number }): AllyState => {
    const a = train(sim);
    expect(send(sim, a.id, at)).toBe(true);
    runUntil(sim, `(${at.x},${at.z}) 한 짐`, () => a.carryCount > 0, 4000);
    expect(send(sim, a.id, HOLD), '일손을 세운다').toBe(true);
    return a;
  };

  const regrownOf = (evs: SimEvent[]): SimEvent[] => evs.filter((e) => e.type === 'gatherRegrown');

  it('R7-a) 재고가 문턱 **위**면 자격을 얻고도 안 자란다 — 지연의 열 배를 돌려도', () => {
    const sim = mkG();
    const cell = cellAt(sim, NEAR);
    harvestThenHold(sim, NEAR);
    expect(cell.regrowAt, '자격 시각은 걸렸다 — **자격과 재생은 다른 사실이다**').toBeGreaterThan(0);
    expect(stock(sim), '한 칸만 텄으니 재고가 문턱 위다').toBeGreaterThan(needOf(sim));
    sim.drainEvents();
    const evs = run(sim, T * 10);
    expect(cell.taken, '재고가 문턱 위인 동안은 안 자란다').toBe(true);
    expect(cell.regrowAt, '자격은 잃은 것이 아니라 **기다리는 것**이다').toBeGreaterThan(0);
    expect(regrownOf(evs).length, '재생 이벤트가 한 건도 안 나온다').toBe(0);
  });

  it('R7-b) 재고가 문턱 **아래**로 내려가면 그 칸이 자란다 — 방아쇠는 시계가 아니라 밭이다', () => {
    const sim = mkG();
    const cell = cellAt(sim, NEAR);
    const kind0 = cell.kind;
    const value0 = cell.value;
    harvestThenHold(sim, NEAR);
    run(sim, T * 4); // 자격은 진작 얻었다
    expect(cell.taken, '아직 재고가 문턱 위라 안 자랐다').toBe(true);
    strip(sim, [NEAR], Math.ceil(needOf(sim)) - 1); // 밭을 문턱 아래로 비운다
    sim.drainEvents();
    const evs = run(sim, 2);
    expect(cell.taken, '재고가 문턱 아래로 내려가자 자란다').toBe(false);
    // R2 는 여기서도 그대로다 — 종도 값도 다시 뽑지 않는다
    expect(cell.kind, '같은 종으로 돌아온다').toBe(kind0);
    expect(cell.value, '같은 값으로 돌아온다').toBe(value0);
    expect(cell.regrowAt, '자격 시각이 꺼졌다').toBe(0);
    expect(regrownOf(evs).length, '그 칸 하나가 자랐다').toBe(1);
    expect(sim.canPlaceAt(NEAR.x, NEAR.z), '다시 자랐으니 못 짓는다').toBe(false);
  });

  it('R7-c) 되살리기는 **문턱에 닿을 때까지**다 — 자격을 먼저 얻은 칸부터, 남는 칸은 계속 기다린다', () => {
    const sim = mkG();
    const first = cellAt(sim, FAR_A);
    const second = cellAt(sim, FAR_B);
    const a = train(sim);
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, 'FAR_A 한 짐', () => first.taken, 4000);
    expect(send(sim, a.id, FAR_B)).toBe(true);
    runUntil(sim, 'FAR_B 한 짐', () => second.taken, 4000);
    expect(send(sim, a.id, HOLD)).toBe(true);
    expect(first.regrowAt, '먼저 텄으니 자격도 먼저 얻는다').toBeLessThan(second.regrowAt);
    run(sim, T * 4); // 둘 다 자격을 얻는다
    expect(first.taken && second.taken, '재고가 문턱 위라 둘 다 그대로다').toBe(true);
    // **한 칸만 되살아나도 문턱을 넘도록** 재고를 딱 그만큼만 내린다
    strip(sim, [FAR_A, FAR_B], Math.ceil(needOf(sim)) - 1);
    sim.drainEvents();
    const evs = run(sim, 2);
    expect(first.taken, '자격을 먼저 얻은 칸이 먼저 살아난다').toBe(false);
    expect(second.taken, '문턱에 닿았으므로 **여기서 멈춘다** — 자격이 있어도 안 살아난다').toBe(true);
    expect(second.regrowAt, '멈춘 칸은 자격을 그대로 들고 기다린다').toBeGreaterThan(0);
    expect(regrownOf(evs).length, '한 칸만 자랐다').toBe(1);
    expect(stock(sim), '되살린 뒤 재고가 문턱 위로 올라와 있다').toBeGreaterThanOrEqual(needOf(sim));
  });

  it('R7-d) 재고가 문턱 아래여도 **최소 지연 전에는** 안 자란다 — 캐자마자 되살아나는 판은 없다', () => {
    const sim = mkG();
    const cell = cellAt(sim, NEAR);
    strip(sim, [NEAR], Math.ceil(needOf(sim)) - 1); // 시작부터 밭이 비어 있는 판
    expect(stock(sim), '이 판은 처음부터 재고가 문턱 아래다').toBeLessThan(needOf(sim));
    const a = train(sim);
    expect(send(sim, a.id, NEAR)).toBe(true);
    runUntil(sim, 'NEAR 한 짐', () => cell.taken, 4000);
    expect(send(sim, a.id, HOLD)).toBe(true);
    const due = cell.regrowAt;
    expect(due, '자격 시각이 아직 앞에 있다').toBeGreaterThan(sim.state.tick);
    expect(stock(sim), '캤으니 재고는 여전히 문턱 아래다').toBeLessThan(needOf(sim));
    runUntil(sim, '자격 직전까지', () => sim.state.tick >= due - 1, 4000);
    expect(cell.taken, '재고가 문턱 아래여도 지연 전에는 안 자란다').toBe(true);
    run(sim, 2);
    expect(cell.taken, '지연이 지나면 그때 자란다').toBe(false);
  });

  it('R7-e) 웨이브가 지날수록 **자격까지의 지연이 짧아진다** (속도만 — 횟수는 그대로)', () => {
    /** 그 웨이브에서 한 칸을 캐고 "텄던 틱 → 자격 틱"의 간격을 잰다 */
    const delayAtWave = (targetWave: number, speedup?: number): number => {
      const sim = mkG(speedup === undefined ? {} : { gatherRegrowWaveSpeedup: speedup });
      runUntil(sim, `웨이브 ${targetWave}`, () => sim.state.waveIndex >= targetWave, 60000);
      const cell = cellAt(sim, NEAR);
      const a = train(sim);
      expect(send(sim, a.id, NEAR)).toBe(true);
      runUntil(sim, 'NEAR 한 짐', () => cell.taken, 4000);
      expect(cell.regrowsLeft, '재생권을 정확히 한 장 썼다 — 웨이브는 **횟수**를 안 바꾼다').toBe(0);
      return cell.regrowAt - sim.state.tick;
    };
    const w1 = delayAtWave(1);
    const w21 = delayAtWave(21);
    // ⚠ `w1` 이 주입값 T와 **정확히 같지는 않다**: 캐는 데 200틱 남짓이 걸리는 동안 빈 웨이브가
    //   한두 번 지나가 텄던 시점이 이미 웨이브 2~3이다(실측 59 = round(60 × 0.99)).
    //   그 어긋남 자체가 웨이브 의존이 **살아 있다**는 증거라 감추지 않고 여기 적는다.
    expect(w1, '지연은 주입값을 넘지 않는다').toBeLessThanOrEqual(T);
    expect(w21, '웨이브가 지나면 자격이 더 빨리 온다').toBeLessThan(w1);
    // ⚠ 되돌리기 = 판별력: 감쇠율 0이면 웨이브가 몇이든 **주입값 그대로**다
    expect(delayAtWave(1, 0), '감쇠율 0이면 웨이브 1의 지연이 주입값이다').toBe(T);
    expect(delayAtWave(21, 0), '감쇠율 0이면 웨이브 의존이 통째로 꺼진다').toBe(T);
  });

  it('R7-g) **광물은 재고에 안 낀다** — 바위가 가득 서 있어도 재생종이 비면 재생이 켜진다', () => {
    // 화산 목 판: 11칸 중 재생종은 wood 한 칸(9)뿐이고 나머지 152는 전부 광물이다.
    // ⚠⚠ **이 항목이 분모의 정의를 잠근다.** 분모를 "전체 value 합"으로 잡으면
    //   서 있는 바위 152가 문턱(0.5 × 161 = 80.5)을 훌쩍 넘겨 **게이트가 영영 안 열리고**
    //   이 항목이 그 자리에서 빨개진다. 배포 스테이지 s6가 정확히 그 모양이다
    //   (재생종이 총액의 17.2%뿐) — 그래서 이것은 목 판의 사정이 아니라 **배포본의 사정**이다.
    const sim = mk({ biome: 'volcano', tuning: { gatherRegrowTicks: T } });
    const grow = sim.state.resources.filter((r) => REGROWABLE_KINDS.has(r.kind));
    const rocks = sim.state.resources.filter((r) => !REGROWABLE_KINDS.has(r.kind));
    expect(grow.length, '재생종 칸이 있다').toBeGreaterThan(0);
    expect(rocks.length, '광물이 훨씬 많다').toBeGreaterThan(grow.length);
    const wood = grow[0] as ResourceCellState;
    harvestThenHold(sim, { x: wood.cellX, z: wood.cellZ });
    expect(stock(sim), '재생종이 전부 텄으니 재고는 0이다').toBe(0);
    let rockValue = 0;
    for (const r of rocks) if (!r.taken) rockValue += r.value;
    expect(rockValue, '그런데 바위는 그대로 서 있다').toBeGreaterThan(0);
    runUntil(sim, '재고가 0이니 자란다', () => !wood.taken, T * 4);
    expect(wood.taken, '광물의 재고는 이 판정에 한 표도 없다').toBe(false);
  });

  it('R7-g2) 분자와 분모는 **같은 집합** 위에 있다 — 광물이 62%인 판도 재생종 기준으로만 잰다', () => {
    // 설원 목 판: 재생종 Σv 52 · 광물 Σv 84(전체의 62%). 재생종 한 칸(16)을 캐면
    //   올바른 정의: 재고 36 / 분모 52 = 69% → 문턱 위 → **안 자란다** (이 항목이 재는 사실)
    //   분모만 넓힌 정의: 36 / 136 = 26% → 문턱 아래 → 자란다 (빨개진다)
    // ⚠⚠ 위 R7-g 는 **둘 다** 넓힌 변형을 잡고, 이 항목은 **분모만** 넓힌 변형을 잡는다.
    //   실측으로 확인했다: 분모만 넓히면 R7-g 는 초록인 채로 이 항목만 빨개진다.
    //   두 항목이 함께 있어야 "분자와 분모가 같은 집합"이 실제로 잠긴다.
    const sim = mk({ biome: 'snow', tuning: { gatherRegrowTicks: T } });
    const cell = cellAt(sim, FAR_B);
    expect(REGROWABLE_KINDS.has(cell.kind), 'FAR_B 는 설원에서도 재생종이다').toBe(true);
    let mineral = 0;
    for (const r of sim.state.resources) if (!REGROWABLE_KINDS.has(r.kind)) mineral += r.value;
    expect(mineral, '이 판은 광물이 재생종보다 많다').toBeGreaterThan(denom(sim));
    harvestThenHold(sim, FAR_B);
    expect(stock(sim), '재생종 기준으로는 아직 문턱 위다').toBeGreaterThan(needOf(sim));
    sim.drainEvents();
    const evs = run(sim, T * 10);
    expect(cell.taken, '광물이 아무리 많아도 재고 판정에는 안 낀다').toBe(true);
    expect(regrownOf(evs).length).toBe(0);
  });

  it('R7-h) **영구히 사라진 칸은 분모에 그대로 남는다** — 그래서 밭이 죽을수록 재생이 쉬워진다', () => {
    // ⚠⚠ **이 항목이 그 선택을 잠근다.** 분모에서 죽은 칸을 빼면(= 살아 있는 칸만으로 다시
    //   잡으면) 문턱도 함께 내려가 아래 칸이 **안 자란다**. 아래 수치가 그 창이다:
    //     분모 고정 D=128 · 문턱 64 · 유료로 죽인 값 c=63 · 캔 칸 v=8 · 남은 재고 S=57
    //     고정 분모 : 57 < 64        → 자란다 (이 항목이 재는 사실)
    //     죽은 칸 제외: 57 ≥ 0.5×(128−63)=32.5 → 안 자란다 (빨개진다)
    //   근거는 `balance.GATHER_REGROW_STOCK_FRAC` 주석의 셋이고, 방향은 사용자 요구와
    //   같다 — 밭이 영구히 마를수록 남은 재생권이 더 쉽게 돌아온다.
    const sim = mkG();
    const cell = cellAt(sim, NEAR);
    const D = denom(sim);
    strip(sim, [NEAR], Math.ceil(needOf(sim)) - 1 + cell.value);
    const deadValue = D - stock(sim);
    harvestThenHold(sim, NEAR);
    expect(stock(sim), '남은 재고가 문턱 아래다 (분모가 고정이므로)').toBeLessThan(needOf(sim));
    expect(
      stock(sim),
      '⚠ 그런데 **죽은 칸을 뺀 분모**로 재면 문턱 위다 — 두 정의가 갈리는 자리에 서 있다',
    ).toBeGreaterThanOrEqual(GATHER_REGROW_STOCK_FRAC * (D - deadValue));
    runUntil(sim, '자란다', () => !cell.taken, T * 4);
    expect(cell.taken, '분모가 고정이라 자란다').toBe(false);
  });

  it('R7-f) 방치 판은 재생도 0건이다 — 아무 칸도 안 텄으면 재고가 1.0이라 첫 줄에서 닫힌다', () => {
    const sim = mkG();
    expect(stock(sim), '시작 재고 = 분모').toBe(denom(sim));
    sim.drainEvents();
    const evs = run(sim, T * 20);
    expect(regrownOf(evs).length, '`18.idleZero` 가 서 있는 자리').toBe(0);
    expect(evs.filter((e) => e.type.startsWith('gather')).length, '채집 이벤트가 통째로 0건').toBe(0);
  });
});

/**
 * ── 판당 총액 항등식 — **재고 게이트가 들어와도 닫힌다** ────────────────────
 * 봉투 `18.rateCap`("판당 배달 + 사망 손실 ≤ 스테이지1 총액 494")이 이 항등식 위에 서 있고,
 * 그 주석이 *"넘으면 밸런스가 아니라 엔진 버그다"* 라고 적어 두었다. 그런데 봉투는
 * **부등식 한 줄**만 재고 그것도 배포 스테이지 하나에서만 잰다 — 곧 재생이 조금 새는
 * 회귀는 그 부등식 안쪽에 숨을 수 있다. 여기서는 **등식**으로, 그리고 **칸마다** 잠근다.
 *
 *     칸마다:  이미 캔 횟수 + 앞으로 캘 수 있는 횟수 == 1 + regrowsLeft@생성
 *     판 전체: Σ value × 캔 횟수 + Σ value × 남은 횟수 == 판당 총액
 *
 * "앞으로 캘 수 있는 횟수" = `(서 있으면 1) + regrowsLeft + (자격을 들고 있으면 1)`.
 * 이 값이 이 파일이 재생을 이해하는 방식 전부다 — 서 있는 한 짐 · 아직 안 쓴 재생권 ·
 * 텄지만 돌아올 예정인 한 짐.
 *
 * ⚠ **재고 문턱을 어디에 두든 이 등식은 한 자리도 안 움직여야 한다.** 게이트는 "언제
 *   자라는가"만 바꾸고 "몇 번 자라는가"는 안 바꾸기 때문이다 — 그것이 이 라운드의 설계
 *   제약이었고, 여기가 그 제약을 실행으로 확인하는 자리다.
 * ⚠ **판별력**(실측으로 확인했다): `updateRegrow` 가 되살리면서 `regrowsLeft++` 를 하거나
 *   `takeCell` 의 `regrowsLeft--` 를 지우면 아래 등식이 그 자리에서 빨개진다.
 */
describe('채집 — 판당 총액 항등식 (재고 게이트가 들어와도 닫힌다)', () => {
  const KEY = (r: { cellX: number; cellZ: number }): string => `${r.cellX},${r.cellZ}`;
  /** 앞으로 이 칸을 몇 번 더 캘 수 있는가 */
  const remainingOf = (r: ResourceCellState): number =>
    (r.taken ? 0 : 1) + r.regrowsLeft + (r.regrowAt > 0 ? 1 : 0);

  /**
   * 일꾼 둘을 붙여 오래 굴리며 **매 검문마다** 항등식을 확인한다.
   * 커맨드는 `trainAlly` 둘뿐이다 — 타워도 유료 제거도 안 낸다. 그 둘은 재생권을 **태우므로**
   * 등식이 부등식이 되고(아래 마지막 항목이 그쪽을 따로 잰다), 여기서 재려는 것은 등식이다.
   */
  const auditRun = (
    tuning: MkOpts['tuning'],
    ticks: number,
  ): { total0: number; harvested: number; harvests: number; capacity: number; cells: number } => {
    const sim = mk({ tuning });
    const cap0 = new Map<string, number>();
    let total0 = 0;
    let capacity = 0;
    for (const r of sim.state.resources) {
      const n = 1 + r.regrowsLeft;
      cap0.set(KEY(r), n);
      total0 += r.value * n;
      capacity += n;
    }
    const done = new Map<string, number>();
    let harvested = 0;
    let harvests = 0;
    const audit = (): void => {
      let left = 0;
      for (const r of sim.state.resources) {
        const n = done.get(KEY(r)) ?? 0;
        expect(
          n + remainingOf(r),
          `칸 (${r.cellX},${r.cellZ}) 의 수확 예산이 갈렸다 — 캔 ${n} + 남은 ${remainingOf(r)}`,
        ).toBe(cap0.get(KEY(r)) as number);
        left += r.value * remainingOf(r);
      }
      expect(harvested + left, '캔 값 + 남은 값 = 판당 총액').toBe(total0);
    };
    audit();
    for (let i = 0; i < ticks; i++) {
      if (i === 0) {
        train(sim);
        train(sim);
      }
      sim.tick();
      for (const ev of sim.drainEvents()) {
        if (ev.type !== 'gathered') continue;
        const k = `${ev.cellX},${ev.cellZ}`;
        done.set(k, (done.get(k) ?? 0) + 1);
        harvested += ev.value;
        harvests++;
      }
      if (i % 500 === 0) audit();
    }
    audit();
    return { total0, harvested, harvests, capacity, cells: sim.state.resources.length };
  };

  it('배포본 문턱에서 닫힌다 — 그리고 판이 길면 **총액에 정확히 닿는다**(포화)', () => {
    const r = auditRun({ gatherRegrowTicks: 60 }, 20000);
    expect(r.harvests, '판이 길면 재생권을 남김없이 쓴다').toBe(r.capacity);
    expect(r.harvested, '그때 캔 값의 합이 곧 판당 총액이다').toBe(r.total0);
  });

  it('문턱을 어디에 두든 **총액도 수확 횟수도 같다** — 게이트는 속도만 바꾼다', () => {
    // 1 = 재고 게이트가 없던 옛 규칙 · 0.2 = 밭이 80% 비어야 자라는 판
    const open = auditRun({ gatherRegrowTicks: 60, gatherRegrowStockFrac: 1 }, 20000);
    const tight = auditRun({ gatherRegrowTicks: 60, gatherRegrowStockFrac: 0.2 }, 20000);
    expect(open.total0, '총액은 좌표만의 함수라 문턱과 무관하다').toBe(tight.total0);
    expect(open.harvests).toBe(open.capacity);
    expect(tight.harvests, '문턱이 낮아도 캘 수 있는 횟수는 그대로다').toBe(tight.capacity);
    expect(tight.harvested).toBe(tight.total0);
  });

  it('재생 횟수 상한만이 총액을 움직인다 (R=0 · 1 · 3)', () => {
    const r0 = auditRun({ gatherRegrowTicks: 60, gatherRegrowMax: 0 }, 20000);
    const r1 = auditRun({ gatherRegrowTicks: 60 }, 20000);
    const r3 = auditRun({ gatherRegrowTicks: 60, gatherRegrowMax: 3 }, 20000);
    expect(r0.capacity, 'R=0 이면 칸마다 한 번뿐이다').toBe(r0.cells);
    expect(r1.total0, 'R=1 이 R=0 보다 크다').toBeGreaterThan(r0.total0);
    expect(r3.total0, 'R=3 이 R=1 보다 크다').toBeGreaterThan(r1.total0);
  });

  it('타워·유료 제거는 총액을 **줄이기만** 한다 — 등식이 부등식이 되는 유일한 길', () => {
    const sim = mk({ tuning: { gatherRegrowTicks: 60 } });
    let total0 = 0;
    for (const r of sim.state.resources) total0 += r.value * (1 + r.regrowsLeft);
    let harvested = 0;
    train(sim);
    train(sim);
    for (let i = 0; i < 6000; i++) {
      sim.tick();
      for (const ev of sim.drainEvents()) if (ev.type === 'gathered') harvested += ev.value;
      // 판 중간에 한 번 태운다: 텄은 칸에 타워를 세우고, 서 있는 칸 하나를 돈으로 치운다
      if (i === 3000) {
        const opened = sim.state.resources.find((r) => r.taken && r.regrowAt > 0);
        if (opened) {
          expect(
            sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: opened.cellX, cellZ: opened.cellZ }),
          ).toBe(true);
        }
        const grown = sim.state.resources.find((r) => !r.taken);
        if (grown) sim.applyCommand({ type: 'clearScenery', cellX: grown.cellX, cellZ: grown.cellZ });
      }
    }
    let left = 0;
    for (const r of sim.state.resources) {
      left += r.value * ((r.taken ? 0 : 1) + r.regrowsLeft + (r.regrowAt > 0 ? 1 : 0));
    }
    expect(harvested + left, '태운 만큼은 어디에도 안 남는다 — 총액을 넘는 일은 없다').toBeLessThan(total0);
  });
});

/**
 * ── 결정론 — 재생이 들어와도 같은 시드·같은 커맨드열은 **같은 해시**다 ──────
 * `battle.ts hash()` 는 칸마다 `taken`·`regrowAt`·`regrowsLeft` 셋을 접는다. 이 라운드는
 * 상태 필드를 **한 개도 안 늘렸으므로**(재고 비율은 그 셋에서 유도되는 계산이다) 그 접기가
 * 그대로 유효하다 — 그 사실을 말이 아니라 실행으로 확인한다.
 * ⚠ 웨이브 의존도 여기서 함께 잡힌다: `view.waveIndex` 는 hash() 에 안 접혀 있지만,
 *   웨이브별 지연이 `takeCell` 에서 `regrowAt` 에 굳으므로 **접혀 있는 값으로** 드러난다.
 */
describe('채집 — 재생의 결정론', () => {
  const script = (sim: BattleSim): number[] => {
    const hashes: number[] = [];
    const a = train(sim);
    const b = train(sim);
    expect(send(sim, a.id, FAR_A)).toBe(true);
    expect(send(sim, b.id, NEAR)).toBe(true);
    for (let i = 0; i < 8000; i++) {
      sim.tick();
      sim.drainEvents();
      if (i === 2000) sim.applyCommand({ type: 'moveAlly', allyId: a.id, cellX: FRONT.x, cellZ: FRONT.z });
      if (i === 4000) sim.applyCommand({ type: 'clearScenery', cellX: FAR_B.x, cellZ: FAR_B.z });
      if (i % 250 === 0) hashes.push(sim.hash());
    }
    hashes.push(sim.hash());
    return hashes;
  };

  it('같은 커맨드열 두 판의 해시열이 **한 자리도** 안 갈린다', () => {
    const mkD = (): BattleSim => mk({ tuning: { gatherRegrowTicks: 60 } });
    const a = script(mkD());
    const b = script(mkD());
    expect(a).toEqual(b);
    // ⚠ 그 해시가 **재생을 실제로 봤다**는 증거 — 안 그러면 이 항목은 헛돈다
    const probe = mkD();
    train(probe);
    train(probe);
    let regrown = 0;
    for (let i = 0; i < 8000; i++) {
      probe.tick();
      for (const ev of probe.drainEvents()) if (ev.type === 'gatherRegrown') regrown++;
    }
    expect(regrown, '이 판에서 재생이 실제로 여러 번 일어났다').toBeGreaterThan(2);
  });
});

describe('채집 — 판이 끝나는 틱 (E-12)', () => {
  it('승리를 선언하는 **그 틱**에 마을 반경 안이면 지급된다 (8-b가 checkEnd보다 앞)', () => {
    const sim = mk({ finite: true });
    const a = train(sim);
    const gold0 = sim.state.gold;
    // prep이 1틱 남은 자리에서 짐과 위치를 박는다 — 다음 틱에 웨이브가 시작되고
    // (빈 웨이브라) 같은 틱에 승리가 선언된다. 곧 배달과 승리가 **같은 틱**이다.
    runUntil(sim, 'prep이 1틱 남는다', () => sim.state.prepTicksLeft === 1);
    const r = raw(a);
    r['x'] = BASE.x;
    r['z'] = BASE.z;
    r['carryCount'] = 1;
    r['carryGold'] = 42;
    sim.drainEvents();
    sim.tick();
    const evs = sim.drainEvents();
    expect(sim.state.phase, '이 틱에 판이 끝났다').toBe('won');
    expect(eventsOf(evs, 'battleEnded').length).toBe(1);
    expect(eventsOf(evs, 'gatherDelivered').length, '⚠ 같은 틱의 배달이 살아 있다').toBe(1);
    expect(sim.state.gold).toBe(gold0 + 42);
  });

  it('판이 끝난 뒤로는 영영 지급이 없다 (tick이 즉시 return하므로 채집도 함께 언다)', () => {
    const sim = mk({ finite: true });
    const a = train(sim);
    runUntil(sim, '판이 끝난다', () => sim.state.phase === 'won' || sim.state.phase === 'lost');
    const gold1 = sim.state.gold;
    const r = raw(a);
    r['x'] = BASE.x;
    r['z'] = BASE.z;
    r['carryCount'] = 1;
    r['carryGold'] = 99;
    const evs = run(sim, 500);
    expect(eventsOf(evs, 'gatherDelivered').length).toBe(0);
    expect(sim.state.gold).toBe(gold1);
  });
});

describe('채집 — 자동 행동 (규칙 8)', () => {
  /** 목 스테이지는 10칸 폭이라 셀 키가 z*10+x 다 (sim/allies.ts와 같은 식) */
  const keyOf = (c: { x: number; z: number }): number => c.z * 10 + c.x;

  it('명령이 없으면 **가장 가까운** 칸을 스스로 잡는다 — 전순서라 시드와 무관하다', () => {
    const sim = mk();
    const a = train(sim);
    // 집결 자리는 (7.6, 2.6) = 반올림하면 셀 (8,3)이고 그 칸이 곧 자원 칸이다(거리 0).
    // 곧 "가장 가까운 칸"의 답이 유일하게 정해진다 — 동점 규칙에 기대지 않는 형태다.
    expect(sim.resourceAt(8, 3), '집결 자리의 셀은 자원 칸이다').not.toBeNull();
    run(sim, 1);
    expect(a.gatherKey, '한 틱 만에 가장 가까운 칸을 잡는다').toBe(keyOf({ x: 8, z: 3 }));
    expect({ x: a.tgtX, z: a.tgtZ }, '목표도 그 칸으로 간다').toEqual({ x: 8, z: 3 });
    // ⚠ 자동은 **이벤트를 한 건도 안 낸다** — allyOrdered는 커맨드의 이벤트지 자동의 것이 아니다
    //   (내면 초당 수십 건이 fx와 e2e로 쏟아진다). 캐기 시작 이벤트는 도착 뒤의 일이다.
    const evs = sim.drainEvents();
    expect(eventsOf(evs, 'allyOrdered').length).toBe(0);
    expect(eventsOf(evs, 'gatherLost').length).toBe(0);
  });

  it('여럿이어도 같은 칸을 두 번 잡지 않는다 — 예약이 배타적이라 헛걸음이 0이다', () => {
    const sim = mk();
    for (let i = 0; i < 4; i++) train(sim);
    run(sim, 400);
    const keys = sim.state.allies.map((a) => a.gatherKey).filter((k) => k >= 0);
    expect(keys.length, '넷 다 일감을 잡았다').toBe(4);
    expect(new Set(keys).size, '네 사람이 네 칸을 나눠 가진다').toBe(4);
  });

  it('일꾼이 아니면 자동으로 안 나간다 — 판정선은 gatherPct 하나다 (전투 3종의 보장)', () => {
    // ⚠ 이 항목이 봉투 [12]의 전제를 코드 수준에서 잠근다: 자동 이동이 일꾼에게만 붙으므로
    //   전투 3종은 명령 없이는 한 걸음도 안 걷는다 = 스스로 적 스폰까지 걸어가지 않는다.
    const sim = mk({ allies: { clubber: { gatherPct: 100, blocks: false, speed: 1.3, carryCap: 1 } } });
    const c = train(sim, 'clubber'); // gatherPct 100 < 200 = 일꾼이 아니다
    const spot = { x: c.tgtX, z: c.tgtZ };
    const evs = run(sim, 600);
    expect(c.gatherKey, '스스로 칸을 잡지 않는다').toBe(-1);
    expect({ x: c.tgtX, z: c.tgtZ }, '한 걸음도 안 움직인다').toEqual(spot);
    expect(eventsOf(evs, 'gathered').length).toBe(0);
    // 그래도 **시키면 캔다** — 판정선이 막는 것은 자동뿐이고 능력이 아니다
    expect(send(sim, c.id, NEAR)).toBe(true);
    expect(c.gatherKey).toBeGreaterThanOrEqual(0);
    runUntil(sim, '시키면 캔다', () => c.carryCount > 0);
  });

  it('캘 칸이 하나도 없으면 **정지**한다 — 무한 배회가 없다', () => {
    const sim = mk();
    // 밭을 통째로 텄음으로 굳힌다 (판 끝물의 상태다)
    for (const r of sim.state.resources) (r as { taken: boolean }).taken = true;
    const a = train(sim);
    const spot = { x: a.tgtX, z: a.tgtZ };
    run(sim, 300);
    expect(a.gatherKey).toBe(-1);
    expect({ x: a.tgtX, z: a.tgtZ }, '걸어다닐 이유가 없으면 안 걷는다').toEqual(spot);
    expect(a.walked, '한 걸음도 안 걸었다').toBe(0);
  });

  it('짐을 진 채 캘 칸이 없어지면 마을로 간다 — 마지막 한 짐이 좌초하지 않는다 (E-18)', () => {
    const sim = mk();
    const a = train(sim, 'clubber'); // carryCap 1 … 짐 하나로 가득 찬다
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, '짐', () => a.carryCount > 0);
    runUntil(sim, '자동이 집으로 보낸다', () => a.tgtX === BASE.x && a.tgtZ === BASE.z);
    runUntil(sim, '배달', () => a.carryCount === 0);
    expect(sim.state.gold).toBeGreaterThan(0);
  });

  it('규칙 8-b) 적이 선 칸을 찍으면 자동이 **안 꺼진다** — 빈 칸일 때만 "여기 지켜"다', () => {
    const sim = mk({ enemies: true });
    const a = train(sim);
    // 적이 서 있는 셀을 찾는다. 적은 경로(z=2) 위를 걸으므로 그 칸에는 자원이 없다 —
    // 곧 이 판정이 재는 것은 오로지 "적이 있느냐"다(자원 칸이면 어차피 자동이 켜진다).
    runUntil(sim, '적이 나온다', () => sim.state.enemies.some((e) => e.alive));
    const e = sim.state.enemies.find((x) => x.alive) as { x: number; z: number };
    const cell = { x: Math.round(e.x), z: Math.round(e.z) };
    expect(sim.resourceAt(cell.x, cell.z), '적이 선 칸은 자원 칸이 아니다').toBeNull();
    expect(send(sim, a.id, cell)).toBe(true);
    expect(a.autoHold, '적이 선 칸도 "여기 지켜"다 — 예약이 안 붙었으므로').toBe(true);
    // 적이 있든 없든 답이 같다 — 그것이 §D-1 개정의 요점이다(판정이 적을 아예 안 본다)
    const empty = { x: cell.x, z: cell.z };
    runUntil(sim, '그 칸에서 적이 사라진다', () =>
      !sim.state.enemies.some((x) => x.alive && Math.round(x.x) === empty.x && Math.round(x.z) === empty.z),
    );
    expect(send(sim, a.id, empty)).toBe(true);
    expect(a.autoHold, '적이 없는 같은 칸도 여기 지켜').toBe(true);
  });

  /**
   * §D-1) **명령이 증발하지 않는다.** 사용자가 지적한 "시켰는데 안 한다"가 이것이다.
   *
   * 옛 규칙은 `autoHold` 를 명령의 **의도**("이 칸이 일감처럼 생겼나")로 정했다. 그래서
   * 남이 이미 예약한 자원 칸을 찍으면 예약이 거부되는데도(E-9) `autoHold = false` 로 남고,
   * 그 사람이 도착하는 순간 자동이 **다른 칸을 잡아 그 자리를 떠났다.** 화면에는
   * `allyOrdered` 가 세운 목표 표식만 남는다 — 명령이 조용히 사라진 것이다.
   * 개정된 규칙은 **결과**("이 사람에게 실제로 일이 붙었나")로 정한다.
   */
  it('§D-1) 남이 예약한 칸을 찍은 사람은 **그 자리에 선다** — 명령이 증발하지 않는다', () => {
    const sim = mk();
    const a = train(sim);
    const b = train(sim);
    // ① a 가 FAR_A 를 잡는다 (예약은 배타적이다)
    expect(send(sim, a.id, FAR_A)).toBe(true);
    expect(a.gatherKey, 'a 에게 예약이 붙었다').toBeGreaterThanOrEqual(0);
    expect(a.autoHold, '예약이 붙었으므로 자동은 켜진 채다').toBe(false);
    // ② b 를 **같은 칸**으로 보낸다 — 예약은 거부되지만 명령 자체는 유효하다
    expect(send(sim, b.id, FAR_A), '"거기로 가라"는 언제나 유효한 명령이다').toBe(true);
    expect(b.gatherKey, 'b 에게는 예약이 안 붙는다 (배타성)').toBe(-1);
    expect(b.autoHold, '⚠ 그러므로 b 는 "여기 지켜"다 — 도착해서 선다').toBe(true);
    expect({ x: b.tgtX, z: b.tgtZ }, '목표 표식은 찍은 칸 그대로다').toEqual({ x: FAR_A.x, z: FAR_A.z });
    // ③ 도착하고 한참을 둬도 **그 자리를 안 떠난다** (옛 규칙이면 다른 칸을 캐러 갔다)
    runUntil(sim, 'b 가 도착한다', () => b.x === FAR_A.x && b.z === FAR_A.z, 2000);
    run(sim, 600);
    expect({ x: b.x, z: b.z }, 'b 는 찍은 자리에 서 있다').toEqual({ x: FAR_A.x, z: FAR_A.z });
    expect(b.gatherKey, 'b 는 다른 칸을 잡지 않았다').toBe(-1);
    expect(b.carryCount, 'b 는 아무것도 안 캤다 — 시킨 것이 "여기 서 있어"였으므로').toBe(0);
  });

  it('§D-1) 짐이 차서만 못 잡은 자원 칸은 **자동을 켠 채로 둔다** — 배달하고 다시 나간다', () => {
    const sim = mk();
    const a = train(sim); // carryCap 2
    // 두 칸을 연달아 캐서 손을 채운다
    expect(send(sim, a.id, FAR_A)).toBe(true);
    runUntil(sim, '첫 짐', () => a.carryCount > 0);
    expect(send(sim, a.id, FAR_B)).toBe(true);
    runUntil(sim, '손이 찬다', () => a.carryCount >= 2, 3000);
    // 손이 찬 채로 **또 다른 자원 칸**을 찍는다 — 예약은 안 붙지만(E-5) 자동은 살아 있어야 한다
    const third = sim.state.resources.find(
      (r) => !r.taken && !(r.cellX === FAR_A.x && r.cellZ === FAR_A.z),
    ) as ResourceCellState;
    expect(send(sim, a.id, { x: third.cellX, z: third.cellZ })).toBe(true);
    expect(a.gatherKey, '짐이 가득이라 예약은 안 붙는다').toBe(-1);
    expect(a.autoHold, '⚠ 그래도 자동은 켜진 채다 — 자동 ⑤가 마을로 보낸다').toBe(false);
    runUntil(sim, '배달', () => a.carryCount === 0, 4000);
    expect(sim.state.gold).toBeGreaterThan(0);
  });
});
