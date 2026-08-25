/**
 * 홈타운 — 반격(사거리/타깃/공중/고정)과 레벨업(경제/상한/HP 정책).
 * 규칙 전문은 src/sim/hometown.ts 헤더, 수치 근거는 src/data/hometown.ts.
 */
import { describe, expect, it } from 'vitest';
import type { BaseLevelDef, BattleSim, SimEvent, TowerTier } from '@/data/types';
import { TICK_RATE } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { BASE_LEVELS } from '@/data/hometown';
import { ALLY_MAX_ACTIVE } from '@/data/balance';
import { ALL_ENEMY_IDS, ALLY_DEFS, ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import { baseLevels, enemyDefs, eventsOf, options, runTicks, stageDef, wave } from './fixtures';

/**
 * 기본 실험 판: 10×5, 경로 (0,2)→(9,2) 직선, 기지 (9,2).
 * 적 속도 1타일/초라 dist가 곧 x좌표이고, 사거리 2면 x ≥ 7 구간에서 맞는다.
 */
function armedSim(over?: {
  levels?: Partial<BaseLevelDef>[];
  enemy?: Parameters<typeof enemyDefs>[0];
  gold?: number;
  baseHp?: number;
  count?: number;
}): BattleSim {
  return createBattle(
    options({
      // waveCount를 넉넉히 둔다 — 웨이브 1이 끝나자마자 'won'이 되면
      // 그 뒤의 커맨드(레벨업)가 전부 거부되어 무엇을 재는지 알 수 없게 된다
      stage: stageDef({
        startGold: over?.gold ?? 1000,
        baseHp: over?.baseHp ?? 10,
        waveCount: 9,
      }),
      baseLevels: baseLevels(
        over?.levels ?? [
          { dmg: 5, cooldownTicks: 30, range: 2 },
          { dmg: 20, cooldownTicks: 30, range: 3 },
          { dmg: 40, cooldownTicks: 30, range: 4 },
        ],
      ),
      enemyDefs: enemyDefs(over?.enemy),
      waves: [wave([{ count: over?.count ?? 1 }])],
    }),
  );
}

/** 웨이브를 즉시 시작하고 n틱 진행 */
function play(sim: BattleSim, ticks: number): SimEvent[] {
  sim.applyCommand({ type: 'callWave' });
  return runTicks(sim, ticks);
}

describe('홈타운 반격', () => {
  it('사거리 안에 든 적에게만 쏜다 (규칙 1)', () => {
    // 적 hp를 크게 잡아 사거리 안에서 죽지 않게 — "언제부터 쏘는가"만 본다
    const sim = armedSim({ enemy: { raptor: { hp: 500, speed: 1 } } });
    const ev = play(sim, 400);
    const shots = eventsOf(ev, 'baseFired');
    expect(shots.length).toBeGreaterThan(0);
    // 첫 발이 나가는 순간 적은 기지에서 사거리(2.0) 안에 있어야 한다
    const dmg = eventsOf(ev, 'enemyDamaged').filter((d) => d.source === 'hometown');
    expect(dmg.length).toBeGreaterThan(0);
    for (const d of dmg) {
      // 기지 셀 (9,2) 기준. 화살 비행 중 적이 더 다가오므로 사거리보다 가까울 수만 있다
      expect(Math.hypot(d.x - 9, d.z - 2)).toBeLessThanOrEqual(2.0 + 1e-6);
    }
  });

  it('사거리 0(무장 해제) 테이블이면 한 발도 쏘지 않는다 — 통제 실험 경로', () => {
    const sim = armedSim({ levels: [{ dmg: 0, range: 0 }] });
    const ev = play(sim, 400);
    expect(eventsOf(ev, 'baseFired')).toHaveLength(0);
    expect(eventsOf(ev, 'enemyDamaged').filter((d) => d.source === 'hometown')).toHaveLength(0);
  });

  it('화살은 armor를 거쳐 실제 피해를 넣고 출처가 hometown이다', () => {
    const sim = armedSim({ enemy: { raptor: { hp: 500, speed: 1, armor: 2 } } });
    const ev = play(sim, 400);
    const hits = eventsOf(ev, 'enemyDamaged').filter((d) => d.source === 'hometown');
    expect(hits.length).toBeGreaterThan(0);
    // dmg 5 − armor 2 = 3 (damageEnemy의 고정 감산 규약을 그대로 탄다)
    for (const hit of hits) expect(hit.amount).toBe(3);
  });

  it('공중 적도 쏜다 (규칙 3 — 아군 부족원과 갈리는 지점)', () => {
    const sim = armedSim({ enemy: { raptor: { hp: 500, speed: 1, flying: true } } });
    const ev = play(sim, 400);
    expect(eventsOf(ev, 'baseFired').length).toBeGreaterThan(0);
  });

  it('타깃은 유효한 동안 고정된다 — 더 가까운 적이 나타나도 갈아타지 않는다 (규칙 2)', () => {
    // 느린 놈이 먼저 사거리에 들고, 빠른 놈이 뒤늦게 출발해 **추월한다**.
    // 매 틱 최근접을 재평가하면 추월 시점에 타깃이 바뀐다 — 고정이면 안 바뀐다.
    //   느린 놈(0.5타일/초): t=420틱에 dist 7(사거리 진입), t=540틱에 누수
    //   빠른 놈(1.5타일/초, 300틱 지연): t=450틱에 느린 놈을 따라잡고 그 뒤로 더 가깝다
    const sim = createBattle(
      options({
        stage: stageDef({ startGold: 1000, baseHp: 999, waveCount: 9 }),
        baseLevels: baseLevels([{ dmg: 5, cooldownTicks: 30, range: 2 }]),
        // ⚠ **`restReach` 를 명시한다.** 문 앞 정지선이 `GATE_STANDOFF_EDGE + restReach` 라
        //   그 값이 같으면 두 놈이 **같은 거리에 나란히 선다** — 그러면 "더 가까운 적"이
        //   원리적으로 생기지 않아 이 테스트가 재려는 상황 자체가 없어진다.
        //   (옛 픽스처는 이 자리에 `radius` 를 적었다. 정지선의 잣대가 `radius` →
        //    `restReach` 로 바뀌면서 그 두 줄이 아무것도 안 벌리게 됐고, 목 기본값이
        //    같아져 실제로 `overtaken 0` 으로 빨개졌다. 값은 실제 종의 값을 쓴다.)
        // ⚠ `baseDamage` 도 명시한다 — 문 앞 체류가 `baseDamage × GATE_BITE_TICKS` 라
        //   총액 1 로 두면 하한(60틱)만 서 있다가 돌파해 **관측 창이 화살 세 발로 줄어든다**
        //   (실측: 하한 90 → 60 에서 4발 → 3발). 4 면 240틱을 서 있어 상수가 흔들려도 남는다.
        enemyDefs: enemyDefs({
          raptor: { hp: 100000, speed: 0.5, radius: 0.3, restReach: 0.72, baseDamage: 4 },
          compy: { hp: 100000, speed: 1.5, radius: 0.22, restReach: 0.4025, baseDamage: 4 },
        }),
        waves: [
          wave([
            { enemyId: 'raptor', count: 1 },
            { enemyId: 'compy', count: 1, delayTicks: 300 },
          ]),
        ],
      }),
    );
    // ⚠ **틱마다 직접 본다.** 화살이 나간 그 틱에 "더 가까운 적이 있었는가"를 재려면
    //   사건만으로는 부족하다 — 위치는 상태에만 있고, 창이 끝난 뒤에 보면 이미 늦다
    //   (실측: 느린 놈은 창이 끝나기 전에 문간 상한에 닿아 돌파해 목록에서 빠진다).
    const shots: { targetId: number }[] = [];
    let overtaken = 0; // 화살이 나간 틱에 **표적이 최근접이 아니었던** 횟수
    const ev: SimEvent[] = [];
    sim.applyCommand({ type: 'callWave' });
    for (let t = 0; t < 530; t++) {
      sim.tick();
      const tickEv = sim.drainEvents();
      ev.push(...tickEv);
      const fired = eventsOf(tickEv, 'baseFired');
      if (fired.length === 0) continue;
      const d = (e: { x: number; z: number }): number => Math.hypot(e.x - 9, e.z - 2);
      let nearest = -1;
      let best = Infinity;
      for (const e of sim.state.enemies) {
        if (!e.alive) continue;
        const dd = d(e);
        if (dd < best) { best = dd; nearest = e.id; }
      }
      for (const f of fired) {
        shots.push({ targetId: f.targetId });
        if (nearest >= 0 && f.targetId !== nearest) overtaken++;
      }
    }
    expect(shots.length).toBeGreaterThan(3);
    const slowId = eventsOf(ev, 'enemySpawned')[0]?.enemyId;
    // 느린 놈이 살아 있고 사거리 안인 내내 화살은 전부 그놈에게 간다
    expect(shots.every((s) => s.targetId === slowId)).toBe(true);
    // 추월이 실제로 일어났는지 못 박는다. 이게 없으면 이 테스트는 공허해진다.
    //
    // ⚠ 옛 잣대는 **도착 순서**(`enemyAtGate` 의 첫 사건이 compy)였다. 그 잣대는
    //   `GATE_STANDOFF_EDGE` 가 1.15 → 1.45 로 나가면서 **뒤집혔다** — 정지선이
    //   `edge + radius` 라 몸이 큰 놈일수록 경로를 덜 걷고, 느린 raptor(radius 0.30)의
    //   정지 호장이 빠른 compy(0.22)보다 0.08 짧아져 435틱 대 447틱으로 먼저 선다.
    //   곧 옛 잣대는 "누가 추월했나"가 아니라 **"누구의 몸이 큰가"** 를 재고 있었다.
    //   이 규칙(타깃 고정)과는 아무 상관이 없는 축이다.
    //
    //   그래서 재는 것을 규칙의 문장 그대로 옮긴다: **창이 끝난 시점에 빠른 놈이 실제로
    //   더 가깝다**(= 사거리 안에 더 가까운 적이 있는데도 화살은 느린 놈에게 갔다).
    //   이 형태는 정지선·반경·경로 길이가 바뀌어도 뜻이 같다.
    expect(overtaken, '화살이 나간 어떤 틱에도 표적이 최근접이었다 — 추월이 안 일어나 검증이 공허하다')
      .toBeGreaterThan(0);
  });

  /**
   * ── 규칙 2-b) **문 앞에 선 적은 사거리와 무관하게 표적이 된다** ──────────────
   *
   * ⚠⚠ 이 테스트가 **숫자 대리를 대신한다.** 옛 잠금은 `tests/sim/gate.test.ts` 의
   *   `중심거리 < BASE_LEVELS[0].range` 한 줄이었다. 그건 "마을이 문 앞의 적을 쏜다"를
   *   두 표(정지선·사거리)가 우연히 겹치는지로 재고 있었고, 정지선 잣대가
   *   `radius` → `restReach` 로 바뀌면서 최대 중심거리가 2.25 → **2.988**(trex) 이 되어
   *   그 겹침이 깨졌다. 사거리를 올려 되찾는 길은 "Lv1 < frost T1 2.4" 계약이 막는다.
   *
   * **완화가 아니라 강화다.** 옛 줄은 좌표만 봤고, 이 줄은 **화살이 실제로 나가는지**를
   * 본다 — 조준 코드가 문간을 안 보면(규칙 2-b 를 되돌리면) 즉시 빨개진다.
   * 16종을 전부 세우는 이유는 이 성질이 "종을 안 가린다"이기 때문이다(gate.ts 규칙 1).
   *
   * ⚠ 공허해지지 않게 **정지선이 Lv1 사거리 밖인 종이 실제로 있다**는 것도 함께 못 박는다.
   *   그 종이 하나도 없으면 이 테스트는 옛 숫자 우연을 다시 재는 것이 된다.
   */
  it('문간에 선 16종 전부가 Lv1 마을의 표적이 된다 (규칙 2-b)', () => {
    const lv1 = BASE_LEVELS[0] as BaseLevelDef;
    let outOfRange = 0;
    for (const id of ALL_ENEMY_IDS) {
      // **실제 데이터**로 세운다 — 목 정의를 쓰면 `restReach` 가 목 값이라 아무것도 안 잰다
      const defs = { ...ENEMY_DEFS, [id]: { ...ENEMY_DEFS[id], hp: 1e9, speed: 3 } };
      const sim = createBattle(
        options({
          stage: stageDef({ baseHp: 1e9, waveCount: 9 }),
          baseLevels: BASE_LEVELS,
          enemyDefs: defs,
          waves: [wave([{ enemyId: id, count: 1 }])],
        }),
      );
      sim.applyCommand({ type: 'callWave' });
      let gateId = -1;
      let hit = false;
      let dist = 0;
      for (let t = 0; t < 900 && !hit; t++) {
        sim.tick();
        for (const ev of sim.drainEvents()) {
          if (ev.type === 'enemyAtGate') {
            gateId = ev.enemyId;
            dist = Math.hypot(ev.x - 9, ev.z - 2);
          } else if (ev.type === 'baseFired' && gateId >= 0 && ev.targetId === gateId) {
            hit = true;
          }
        }
      }
      expect(gateId, `${id} 가 문 앞에 서지 않았다 — 이 종은 아무것도 안 쟀다`).toBeGreaterThanOrEqual(0);
      expect(hit, `${id}: 문 앞에 섰는데 마을이 한 발도 안 쐈다 (중심거리 ${dist.toFixed(3)})`).toBe(true);
      if (dist > lv1.range) outOfRange++;
    }
    // mammoth 2.508 · spino 2.875 · trex 2.988 이 Lv1 사거리 2.3 밖이다 — 규칙이 없으면
    // 이 셋은 문 앞에 서서도 영영 안 맞는다. 셋이 사라지면 이 테스트가 공허해진다.
    expect(outOfRange, '문간선이 전부 Lv1 사거리 안이다 — 규칙 2-b 가 무엇도 사지 않는다').toBeGreaterThanOrEqual(3);
  });

  it('타워가 전부 침묵해도 홈타운은 계속 쏜다 (규칙 5)', () => {
    // hexer는 타워만 침묵시킨다 — 기지에는 침묵 개념 자체가 없다
    const sim = armedSim({ enemy: { raptor: { hp: 500, speed: 1 } } });
    const ev = play(sim, 400);
    expect(eventsOf(ev, 'towerSilenced')).toHaveLength(0);
    expect(eventsOf(ev, 'baseFired').length).toBeGreaterThan(0);
  });

  it('레벨이 오르면 같은 시나리오에서 더 아프게, 더 멀리서 쏜다', () => {
    const shotsAt = (level: number): { shots: number; total: number } => {
      const sim = armedSim({ enemy: { raptor: { hp: 5000, speed: 1 } } });
      for (let i = 1; i < level; i++) expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
      const ev = play(sim, 400);
      const hits = eventsOf(ev, 'enemyDamaged').filter((d) => d.source === 'hometown');
      return { shots: hits.length, total: hits.reduce((a, h) => a + h.amount, 0) };
    };
    const lv1 = shotsAt(1);
    const lv3 = shotsAt(3);
    // 사거리 2 → 4라 체류 시간이 두 배, 피해도 5 → 40이라 총량은 훨씬 크다
    expect(lv3.shots).toBeGreaterThan(lv1.shots);
    expect(lv3.total).toBeGreaterThan(lv1.total * 2);
  });
});

describe('홈타운 레벨업', () => {
  it('골드를 정확히 깎고 레벨·최대HP·공격력·사거리를 함께 올린다', () => {
    const sim = armedSim({ gold: 1000 });
    const s = sim.state;
    expect(s.baseLevel).toBe(1);
    expect(s.baseLevelMax).toBe(3);
    expect(s.baseHpMax).toBe(10); // hpMul 1
    expect(sim.baseRange()).toBe(2);
    expect(sim.baseUpgradeCost()).toBe(100);

    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(s.gold).toBe(900);
    expect(s.baseLevel).toBe(2);
    expect(s.baseHpMax).toBe(20); // hpMul 2
    expect(sim.baseRange()).toBe(3);
    expect(sim.baseUpgradeCost()).toBe(200);

    const ev = sim.drainEvents();
    const up = eventsOf(ev, 'baseUpgraded');
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ level: 2, cost: 100, hpMax: 20, dmg: 20, range: 3 });
  });

  it('HP 정책: 누적 피해 절대량이 보존된다 (전량 회복이 아니다)', () => {
    // 적 하나를 흘려보내 기지에 상처를 낸 뒤 레벨업한다
    const sim = armedSim({ levels: [{ dmg: 0, range: 0 }], baseHp: 10, gold: 1000 });
    play(sim, 400);
    const s = sim.state;
    expect(s.baseHp).toBe(9); // baseDamage 1 누수 1회
    expect(s.baseHpMax).toBe(10);
    const takenBefore = s.baseHpMax - s.baseHp;

    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    // 늘어난 최대치(+10)만큼만 즉시 증축 → 19/20. 상처(1)는 그대로 남는다
    expect(s.baseHpMax).toBe(20);
    expect(s.baseHp).toBe(19);
    expect(s.baseHpMax - s.baseHp).toBe(takenBefore);
    // 전량 회복이었다면 20/20이 됐어야 한다 — 회복 수단이 되지 않는다는 잠금
    expect(s.baseHp).toBeLessThan(s.baseHpMax);

    // 한 단계 더 올려도 상처는 계속 따라온다 (hpMul 3 → 30)
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(s.baseHpMax).toBe(30);
    expect(s.baseHp).toBe(29);
    expect(s.baseHpMax - s.baseHp).toBe(takenBefore);
  });

  it('골드가 모자라면 거부하고 한 푼도 쓰지 않는다', () => {
    const sim = armedSim({ gold: 99 }); // Lv2 비용 100
    const s = sim.state;
    expect(sim.canUpgradeBase()).toBe(false);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(false);
    expect(s.gold).toBe(99);
    expect(s.baseLevel).toBe(1);
    expect(s.baseHpMax).toBe(10);
    expect(sim.drainEvents().filter((e) => e.type === 'baseUpgraded')).toHaveLength(0);
  });

  it('최대 레벨에서는 골드가 남아도 거부한다', () => {
    const sim = armedSim({ gold: 100000 });
    const s = sim.state;
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    expect(s.baseLevel).toBe(3);
    expect(sim.baseUpgradeCost()).toBeNull();
    expect(sim.canUpgradeBase()).toBe(false);
    const goldBefore = s.gold;
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(false);
    expect(s.gold).toBe(goldBefore);
    expect(s.baseLevel).toBe(3);
  });

  it('전투가 끝나면 레벨업 커맨드를 받지 않는다', () => {
    const sim = armedSim({ gold: 100000, baseHp: 1, levels: [{ dmg: 0, range: 0 }] });
    play(sim, 400);
    expect(sim.state.phase).toBe('lost');
    expect(sim.canUpgradeBase()).toBe(false);
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(false);
  });
});

describe('실제 밸런스 데이터', () => {
  it('레벨 곡선이 단조 증가한다 (비용·HP·사거리·DPS·정원)', () => {
    expect(BASE_LEVELS.length).toBeGreaterThanOrEqual(2);
    expect(BASE_LEVELS[0]?.cost).toBe(0); // Lv1은 시작 상태라 값을 치르지 않는다
    for (let i = 1; i < BASE_LEVELS.length; i++) {
      const prev = BASE_LEVELS[i - 1] as BaseLevelDef;
      const cur = BASE_LEVELS[i] as BaseLevelDef;
      expect(cur.cost, `Lv${i + 1} 비용`).toBeGreaterThan(prev.cost);
      expect(cur.hpMul, `Lv${i + 1} HP`).toBeGreaterThan(prev.hpMul);
      expect(cur.range, `Lv${i + 1} 사거리`).toBeGreaterThan(prev.range);
      expect(cur.dmg / cur.cooldownTicks, `Lv${i + 1} DPS`).toBeGreaterThan(
        prev.dmg / prev.cooldownTicks,
      );
      /**
       * 9단계) 정원(allyCap)이 예전 출격 한계선(sortie)이 서 있던 칸을 물려받았다.
       * **엄격 증가**를 따로 잠그는 이유: 아군을 어디로든 보낼 수 있게 된 뒤로 마을이
       * 파는 손잡이가 이 하나뿐이라, 두 레벨이 같은 정원을 팔면 그 사이 칸은
       * **HP·화력만 남고 이 열은 0을 파는 칸**이 된다(8단계 sortie가 짧은 스테이지에서
       * 겪은 바로 그 함정 — src/data/hometown.ts "자르기에서 곡선 압축으로").
       */
      expect(cur.allyCap, `Lv${i + 1} 정원`).toBeGreaterThan(prev.allyCap);
    }
  });

  it('정원은 1명 이상에서 시작해 만렙에서 절대 상한과 만난다', () => {
    const lv1 = BASE_LEVELS[0] as BaseLevelDef;
    const max = BASE_LEVELS[BASE_LEVELS.length - 1] as BaseLevelDef;
    // Lv1이 0이면 이 상품이 시작 시점에 통째로 존재하지 않는다 (뽑기 버튼이 늘 회색)
    expect(lv1.allyCap).toBeGreaterThanOrEqual(1);
    // 만렙 정원 = ALLY_MAX_ACTIVE. 두 숫자가 갈리면 표의 마지막 칸이 조용히 사라지거나
    // (표 < 상한) 렌더 정원을 넘겨 인스턴스 버퍼가 잘린다 (표 > 상한, allyCapFor의 min).
    expect(max.allyCap).toBe(ALLY_MAX_ACTIVE);
  });

  it('Lv1 사거리는 쏘는 타워 전부보다 짧다 (홈타운이 타워를 대체하지 못한다)', () => {
    // 오라형(brazier 1.8 / drum 2.0)은 조준 사거리가 아니라 장판/버프 반경이라 제외한다
    const shooterMin = Math.min(
      ...Object.values(TOWER_DEFS)
        .filter((d) => d.attackKind !== 'aura' && d.attackKind !== 'pulse')
        .map((d) => (d.tiers[0] as TowerTier).range),
    );
    expect(shooterMin).toBe(2.4); // frost T1 — 이 값이 바뀌면 아래 주장도 다시 봐야 한다
    expect(BASE_LEVELS[0]?.range).toBeLessThan(shooterMin);
  });

  /**
   * 만렙 사거리의 상한을 **발리스타**가 잡는다.
   *
   * 5단계 개정 전에는 `≤ 3.0`(창움막 만렙과 동일)이었다. 그 잣대는 실측으로 무너졌다:
   * 사거리가 곧 체류 시간이고, 체류 시간이 짧으면 공격력을 아무리 올려도 한 마리를
   * 못 죽이며, **죽이지 못한 피해는 누수 앞에서 아무 흔적도 남기지 않는다**
   * (근거 전문 src/data/hometown.ts). 그래서 상한을 "들판 타워보다 짧다"가 아니라
   * "가장 멀리 보는 타워보다 짧다"로 옮겼다 — 홈타운이 **최장 사거리 자리를 빼앗지
   * 않는다**가 지켜야 할 선이고, 그건 여전히 지켜진다.
   */
  it('만렙 사거리도 최장 타워(발리스타)보다 짧다 — 원거리 자리를 빼앗지 않는다', () => {
    const max = BASE_LEVELS[BASE_LEVELS.length - 1] as BaseLevelDef;
    const ballistaMin = (TOWER_DEFS.ballista.tiers[0] as TowerTier).range;
    expect(ballistaMin).toBe(5.5); // 이 값이 바뀌면 아래 주장도 다시 봐야 한다
    expect(max.range).toBeLessThan(ballistaMin);
  });

  it('화력 단가는 언제나 타워보다 나쁘다 (홈타운은 화력이 아니라 보험이다)', () => {
    const spear = TOWER_DEFS.spear;
    const t1 = spear.tiers[0] as TowerTier;
    const lv1 = BASE_LEVELS[0] as BaseLevelDef;
    const lv5 = BASE_LEVELS[BASE_LEVELS.length - 1] as BaseLevelDef;
    const dps = (d: { dmg: number; cooldownTicks: number }): number =>
      (d.dmg / d.cooldownTicks) * TICK_RATE;
    // Lv1은 가장 싼 공격 타워 T1의 절반 미만 — 혼자서는 아무것도 못 잡는다
    expect(dps(lv1)).toBeLessThan(dps(t1) * 0.5);
    /**
     * 만렙은 **단가**로 잠근다(개정 전에는 절대 dps로 잠갔다).
     * 절대 dps 상한은 "죽이지 못하는 화력 = 0"이라는 기전을 몰랐던 잣대라, 지키는 순간
     * 이 상품이 존재하지 않게 된다. 값을 매기는 올바른 단위는 골드당 dps다:
     * 홈타운 누적 4,500골드에 168dps = 26.8골드/dps, 창움막 만렙 3,100골드에 177dps =
     * 17.5골드/dps — 홈타운이 1.5배 비싸다. 칸을 안 먹고 부서지지 않는 값이 그 웃돈이다.
     */
    const baseTotal = BASE_LEVELS.reduce((a, lv) => a + lv.cost, 0);
    const spearTotal = spear.tiers.reduce((a, tr) => a + tr.cost, 0);
    const t5 = spear.tiers[4] as TowerTier;
    const baseGoldPerDps = baseTotal / dps(lv5);
    const spearGoldPerDps = spearTotal / dps(t5);
    expect(baseGoldPerDps).toBeGreaterThan(spearGoldPerDps * 1.2);
  });

  /**
   * 5단계 개정의 핵심 잣대 — **HP는 얕게 판다.**
   * hpMul 3.2(스테이지1에서 25→80)일 때 Lv2 하나가 승수와 여유를 동시에 이기는
   * 지배 전략이었다(봉투 시드 40에서 36/40·8.3 → 38/40·16.1). 완충 25뿐인 게임에서
   * 최대 HP 배증은 어떤 값을 매겨도 싸다 — 그래서 이 상품이 파는 물건을 화력으로 옮기고
   * HP 성장은 상한을 걸어 둔다. 실효는 난이도 봉투 7번(지배 전략 금지)이 잰다.
   */
  it('HP 성장은 얕다 — 최대 HP 배율 상한 (지배 전략 방지)', () => {
    const max = BASE_LEVELS[BASE_LEVELS.length - 1] as BaseLevelDef;
    expect(max.hpMul).toBeLessThanOrEqual(1.6);
    // 레벨당 증가폭도 고르게 — 한 칸에 몰아주면 그 칸이 다시 지배 전략이 된다
    for (let i = 1; i < BASE_LEVELS.length; i++) {
      const d = (BASE_LEVELS[i] as BaseLevelDef).hpMul - (BASE_LEVELS[i - 1] as BaseLevelDef).hpMul;
      expect(d, `Lv${i + 1} hpMul 증가폭`).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('다음 레벨 미리보기 (비가역 결제 전 정보)', () => {
  /**
   * 9단계) 미리보기의 넷째 칸이 출격 한계선(sortie)에서 **정원(allyCap)**으로 바뀌었다.
   * 정원을 레벨마다 다르게 준 목 테이블을 쓰는 이유: 목 기본값(전 레벨 동일)으로 재면
   * "다음 레벨을 읽는가"와 "지금 레벨을 읽는가"와 "상수를 그대로 뱉는가"가 전부
   * 같은 숫자를 내서 셋을 구분하지 못한다. 2/3/5로 벌려 두면 그 셋이 갈린다.
   */
  it('다음 레벨의 최대HP·공격력·사거리·정원을 sim이 확정한 값으로 준다', () => {
    const sim = armedSim({
      gold: 1000,
      baseHp: 10,
      levels: [
        { dmg: 5, cooldownTicks: 30, range: 2, allyCap: 2 },
        { dmg: 20, cooldownTicks: 30, range: 3, allyCap: 3 },
        { dmg: 40, cooldownTicks: 30, range: 4, allyCap: 5 },
      ],
    });
    // 목 테이블: Lv2 = hpMul 2 · dmg 20 · range 3 · 정원 3 (지금 레벨의 2가 아니다)
    expect(sim.baseNextStats()).toEqual({ hpMax: 20, dmg: 20, range: 3, allyCap: 3 });
    expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
    // 결제 뒤 지금 정원이 미리보기와 같아지고, 미리보기는 다시 한 칸 앞(Lv3 = 5)을 본다
    expect(sim.allyCap()).toBe(3);
    expect(sim.baseNextStats()).toEqual({ hpMax: 30, dmg: 40, range: 4, allyCap: 5 });
  });

  it('미리보기 최대HP가 실제 레벨업 결과와 정확히 일치한다 (반올림이 갈리지 않는다)', () => {
    // hpMul 1.9 × baseHp 25 = 47.5 — UI가 따로 곱하면 47/48이 갈릴 수 있는 자리다
    const sim = armedSim({ gold: 100000, baseHp: 25, levels: [{}, { hpMul: 1.9 }, {}] });
    const preview = sim.baseNextStats();
    expect(preview).not.toBeNull();
    sim.applyCommand({ type: 'upgradeBase' });
    expect(sim.state.baseHpMax).toBe(preview?.hpMax);
  });

  it('최대 레벨에서는 null이다', () => {
    const sim = armedSim({ gold: 100000 });
    sim.applyCommand({ type: 'upgradeBase' });
    sim.applyCommand({ type: 'upgradeBase' });
    expect(sim.state.baseLevel).toBe(sim.state.baseLevelMax);
    expect(sim.baseNextStats()).toBeNull();
  });
});

/**
 * 아군과 함께 쓸 때의 사거리 관계 — 5단계 검증에서 나온 결함의 회귀 잠금.
 *
 * ── 9단계: 가리는 것이 **한계선에서 집결 지점**으로 바뀌었다 (기전만 바뀌고 결함은 같다) ──
 * 5단계의 진단은 "아군이 기지에서 ALLY_SORTIE_RANGE(6.0타일) 앞에 줄을 서서 다 잡아 버려
 * 사거리 2.0짜리 Lv1 마을은 한 발도 못 쏜다"였다. 한계선은 사라졌지만 **결함은 그대로
 * 살아 있다** — 아군은 이제 홈타운 앞 ALLY_MUSTER_FORWARD(1.4타일)에 태어나 명령이 없으면
 * 거기 서 있고, 곤봉잡이 사거리가 1.0이라 적을 **기지에서 약 2.4타일**에서 붙잡는다.
 * 그 자리는 Lv1 사거리 2.0의 **바깥**이다. 즉 줄이 앞으로 나가서가 아니라 줄이 가까워도
 * 봉쇄 지점이 문턱 밖이라 가려진다. 잠글 것이 달라지지 않는 이유가 이것이다.
 *
 * 실측 (스테이지1·타워 0기·기지 무적·6,000틱, 53틱마다 곤봉잡이 출동 시도):
 *   Lv1 고정  baseFired **0**  (누적 출동 3명 · 동시 최대 2명 = Lv1 정원)
 *   만렙까지  baseFired **39** (누적 출동 6명 · 동시 최대 6명 = Lv5 정원)
 * 8단계 같은 실험의 21발에서 39발로 늘었는데, 이건 마을이 세진 게 아니라 **아군이
 * 문 앞에 서게 되어 적이 마을 사거리 안에서 오래 머문다**는 뜻이다.
 *
 * 그래서 잠그는 것은 8단계와 같다: "**레벨을 올리면 그 상황에서도 마을이 싸운다**".
 * Lv1이 0이라는 사실 자체는 어서션하지 않는다 — 집결 지점을 당기거나 Lv1 사거리를
 * 늘리면 개선되는 방향이고, 그 개선을 이 테스트가 막아서는 안 된다.
 */
describe('아군과 함께 있을 때의 홈타운 사격', () => {
  /**
   * 관측값이 trained(누적 출동 수)에서 **peakAlive(동시에 나가 있던 최대 인원)**로 바뀌었다.
   *
   * 8단계는 `trained > 10`으로 "아군이 실제로 나가 있었다"를 확인했다. 그 임계값이
   * 성립했던 이유는 **수명 20초**였다 — 6,000틱이면 아군이 열 번 넘게 죽고 다시 나므로
   * 누적 수가 자연히 커졌다. 9단계에서 아군이 영구가 되면서 누적 출동 수는 곧
   * **정원 + 사망 보충 횟수**로 줄었고(실측 6), 임계값을 6까지 내리면 그 숫자는
   * "정원이 몇이냐"만 말하게 되어 판별력이 사라진다.
   *
   * 그래서 임계값을 내리는 대신 재 보는 것을 바꿨다. 이 실험이 성립하려면 필요한 사실은
   * "많이 뽑았다"가 아니라 **"재는 내내 판 위에 아군이 서 있었다"**이므로, 그것을 직접 센다:
   *  · peakAlive  — 정원이 실제로 찼는가 (한 명도 못 뽑는 실험으로 조용히 바뀌지 않는다)
   *  · allyTicks  — 아군이 서 있던 틱 수 (전멸한 채로 6,000틱을 돌지 않았다)
   * 둘 다 수명이 없어져도 뜻이 변하지 않고, 아군이 사라지면 즉시 빨개진다.
   */
  function noTowerRun(upgradeToMax: boolean): {
    fired: number;
    trained: number;
    peakAlive: number;
    allyTicks: number;
  } {
    const stage = stageById(1);
    if (!stage) throw new Error('no stage 1');
    const sim = createBattle({
      stage,
      stars: {},
      deck: ['spear'],
      endless: true,
      seed: 4242,
      towerDefs: TOWER_DEFS,
      enemyDefs: ENEMY_DEFS,
      allyDefs: ALLY_DEFS,
      baseLevels: BASE_LEVELS,
      waveFor: makeWaveFor(stage),
    });
    const mut = sim.state as unknown as { baseHp: number; gold: number };
    let fired = 0;
    let trained = 0;
    let peakAlive = 0;
    let allyTicks = 0;
    for (let i = 0; i < 6000; i++) {
      // 타워 0기로 6,000틱을 버티게 하려면 기지를 계속 되돌려야 한다 (사격만 재는 실험)
      mut.baseHp = sim.state.baseHpMax;
      mut.gold = 999_999;
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      if (i % 53 === 0 && sim.applyCommand({ type: 'trainAlly', defId: 'clubber' })) trained++;
      if (upgradeToMax && i % 601 === 0) sim.applyCommand({ type: 'upgradeBase' });
      sim.tick();
      // 이동 명령은 일부러 한 번도 내리지 않는다 — 명령이 없는 아군은 집결 지점에
      // 그대로 서 있으므로, 이 실험이 재는 것은 **플레이어가 아무것도 안 했을 때의 기본 배치**다
      const alive = sim.state.allies.length;
      if (alive > peakAlive) peakAlive = alive;
      if (alive > 0) allyTicks++;
      for (const ev of sim.drainEvents()) if (ev.type === 'baseFired') fired++;
    }
    return { fired, trained, peakAlive, allyTicks };
  }

  it('만렙 마을은 아군이 길목을 잡고 있어도 화살을 쏜다', () => {
    const maxed = noTowerRun(true);
    const info = JSON.stringify(maxed);
    // 실험 성립 조건 — 정원이 실제로 찼고(만렙 6명), 재는 내내 아군이 서 있었다.
    // 실측: peakAlive 6 · allyTicks 6,000/6,000 (첫 출동이 i=0이라 빈 틱이 하나도 없다).
    // allyTicks 임계값을 6,000이 아니라 5,000으로 두는 이유: 전멸 없이 돌았다는 것만
    // 확인하면 되는 자리라, 사망·보충 타이밍이 몇 틱 흔들렸다고 빨개질 이유가 없다
    expect(maxed.peakAlive, `정원이 실제로 찼어야 한다: ${info}`).toBe(ALLY_MAX_ACTIVE);
    expect(maxed.allyTicks, `아군이 판에 서 있던 틱: ${info}`).toBeGreaterThan(5000);
    expect(maxed.fired, `만렙 마을 발사 수: ${info}`).toBeGreaterThan(0);
  }, 60_000);
});
