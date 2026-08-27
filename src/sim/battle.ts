/**
 * createBattle — BattleSim 구현. 틱 순서:
 * 웨이브 스폰(+prep 수리) → **아군 교전/봉쇄(+적의 난투 반격)** → 적의 타워 공격(+저주)
 * → 부서진 타워 회수 → **문간 교전(문 앞의 한 입)** → 적 이동/누수 → **아군 이동** → 상태이상
 * → 버프 재계산(5틱마다) → 타워 조준/발사(침묵 감소) → **홈타운 조준/발사**
 * → 투사체 이동/명중 → 사망 처리(적·아군) → 승패 판정.
 *
 * 세 단계의 자리는 전부 **"결정을 읽는 쪽이 뒤"** 라는 한 규칙으로 정해져 있다:
 *  · 공성이 이동보다 앞 — 근접 적의 "멈춰 서서 때린다"를 이동이 towerTargetId로 읽는다
 *    (src/sim/siege.ts 규칙 4).
 *  · **아군 교전이 공성보다 앞** — 봉쇄된 적은 타워를 때리지 않으므로(allies.ts 규칙 5)
 *    공성이 blockerAllyId를 읽으려면 봉쇄가 먼저 서 있어야 한다.
 *  · **문간이 공성 직후·이동 직전** — 두 축이 같은 `blockerAllyId` 스냅샷을 읽어야
 *    "봉쇄된 적은 타워도 안 때리고 마을도 안 문다"가 한 틱 안에서 일관되고, 이동은
 *    `atGate`를 읽어 전진을 멈춘다 (src/sim/gate.ts · `isSieging`과 같은 꼴).
 *  · **아군 이동이 적 이동 직후** — 교전 판정은 이미 끝났고 결과대로 걷기만 한다.
 *    같은 틱의 같은 스냅샷으로 양쪽을 움직여야 사거리 판정이 한쪽으로 기울지 않는다.
 *  · **홈타운 발사가 타워 발사 직후, 투사체 단계 직전** — 사수는 사수끼리 같은
 *    스냅샷에서 쏴야 사거리 판정이 기울지 않고, 화살이 같은 틱의 투사체 단계에 실려야
 *    비행 시간 규칙이 타워 것과 같아진다 (hometown.ts 규칙 7).
 * 요약하면 한 틱의 인과는 **봉쇄 확정 → 공성 → 문간 → 이동 → 사격**이다.
 *
 * prep: 웨이브1 전 150틱, 이후 90틱. callWave 스킵 시 남은틱×0.15 골드(내림).
 * three/DOM 임포트 금지 — @/data/types + @/core/* 만 사용.
 */
import { TICK_DT, STATUS_KIND_ORDER, STATUS_TICK_INTERVAL } from '@/data/types';
import type {
  AllyId,
  BattleCommand,
  BattleOptions,
  BattleSim,
  BattleStateView,
  CardState,
  EnemyId,
  SimEvent,
  TowerState,
  ResourceCellState,
  Vec2,
  WaveDef,
  WavePreview,
  WavePreviewEntry,
} from '@/data/types';
import { Rng } from '@/core/rng';
import { ALLY_MAX_ACTIVE, TOWER_SWAP_COST, enemyTraitsOf, hideCapFor } from '@/data/balance';
import { isBuildableCell, rasterizePathCells, sceneryCells } from '@/data/grid';
import {
  moveAlly,
  allyTrainCost,
  canTrainAlly,
  moveAllies,
  sweepDeadAllies,
  trainAlly,
  updateAllies,
  updateAllyAuto,
} from './allies';
import { recomputeBuffs, updateProjectiles, updateTowers } from './attack';
import { addGold, leakEnemy } from './combat';
import { atGate, enterGate, stopDistFor, updateGate } from './gate';
import { Economy, sceneryClearCostFor, sellRefundFor } from './economy';
import { pathFor, World, type EnemySim, type SimCtx } from './entities';
import {
  ResourceField,
  burnRegrow,
  cancelGatherersOf,
  takeCell,
  updateGather,
  updateRegrow,
} from './gather';
import {
  baseNextStats,
  allyCapFor,
  baseUpgradeCost,
  canUpgradeBase,
  createHometown,
  currentLevelDef,
  initialBaseHp,
  updateHometown,
  upgradeBase,
} from './hometown';
import { buildPath, buildStraight } from './path';
import {
  isRepairTick,
  isSieging,
  maxHpFor,
  repairTowers,
  sweepDestroyedTowers,
  updateSiege,
} from './siege';
import { updateAllyHeal } from './heal';
import {
  effectiveSpeed,
  processHealAuras,
  processPurgeAuras,
  tickEnemyStatuses,
  tickShields,
} from './status';
import { WaveSpawner } from './waves';

const PREP_TICKS_FIRST = 150;
const PREP_TICKS_LATER = 90;
const EARLY_CALL_RATE = 0.15;
const BUFF_INTERVAL = 5;
const ENDLESS_HP_GROWTH = 1.06;
const MAX_TIER = 4;

/** 진행거리 오름차순, 동점은 id (타게팅 규약, 완전 결정론) — 매 틱 클로저 생성 방지용 호이스팅 */
const byDistThenId = (a: EnemySim, b: EnemySim): number => a.dist - b.dist || a.id - b.id;

// FNV-1a — float를 비트 단위로 혼합 (결정론 해시)
const hashF64 = new Float64Array(1);
const hashU32 = new Uint32Array(hashF64.buffer);
function mix(h: number, n: number): number {
  hashF64[0] = n;
  h = Math.imul(h ^ (hashU32[0] as number), 16777619);
  h = Math.imul(h ^ (hashU32[1] as number), 16777619);
  return h >>> 0;
}

class Battle implements BattleSim {
  private readonly ctx: SimCtx;
  private readonly economy = new Economy();
  private readonly spawner = new WaveSpawner();
  private waveDef: WaveDef | null = null;
  /** 경로가 지나는 셀 — 건설 불가 (render와 동일 래스터라이즈) */
  private readonly pathCells: ReadonlySet<number>;
  /**
   * 나무/바위 등 소품 셀 — **"유료로 치우지 않았다"** 하나만 뜻한다 (render와 동일 시드).
   * `clearScenery`로 치우면 여기서 빠진다.
   * ⚠ **이 집합 혼자로는 건설 가능을 못 정한다** — 다 캔 칸도 열려야 하기 때문이다(D1 뒤집힘).
   *   판정은 언제나 `grown()` 하나를 거친다.
   */
  private readonly scenery: Set<number>;
  /** 치운 소품 셀 키 — 제거 순서대로. length가 곧 다음 제거 비용의 지수 */
  private readonly clearedScenery: number[] = [];

  constructor(opts: BattleOptions, tuning?: BattleTuning) {
    const stage = opts.stage;
    // ⚠ 소품 셀은 **ctx 리터럴보다 먼저** 계산한다 — 자원 밭이 그 집합 위에 서고,
    //   ctx와 view가 **같은 배열**을 들어야 하기 때문이다(둘이 갈리면 UI가 다른 판을 그린다).
    const pathCells = rasterizePathCells(stage);
    const scenery = sceneryCells(stage, pathCells);
    // 자원 밭 — 소품 칸의 **뜻**만 얹는다. `scenery` Set 자체는 한 글자도 안 바뀐다:
    // 그 집합의 뜻은 "유료로 치우지 않았다" 하나로 남고, 건설 가능은 아래 `grown()` 이
    // 그 집합과 `taken` 의 **곱**으로 정한다.
    const resources = new ResourceField(stage, scenery, {
      baseValue: tuning?.gatherBaseValue,
      regrowMax: tuning?.gatherRegrowMax,
      regrowTicks: tuning?.gatherRegrowTicks,
      regrowStockFrac: tuning?.gatherRegrowStockFrac,
      regrowWaveSpeedup: tuning?.gatherRegrowWaveSpeedup,
    });
    const groundPaths = stage.paths.map((w) => buildPath(w));
    const airPaths =
      stage.airPaths && stage.airPaths.length > 0
        ? stage.airPaths.map((w) => buildPath(w))
        : stage.paths.map((w) => buildStraight(w[0] ?? stage.baseCell, stage.baseCell));
    const world = new World();
    const hand: CardState[] = [];
    // 홈타운은 Lv1(움막 하나)에서 시작한다 — hpMul이 1이 아닌 테이블도 여기서 흡수된다
    const baseHp0 = initialBaseHp(stage.baseHp, opts.baseLevels);
    const view: BattleStateView = {
      tick: 0,
      phase: 'prep',
      waveIndex: 1,
      waveCount: stage.waveCount,
      gold: stage.startGold,
      baseHp: baseHp0,
      baseHpMax: baseHp0,
      baseLevel: 1,
      baseLevelMax: Math.max(1, opts.baseLevels.length),
      prepTicksLeft: PREP_TICKS_FIRST,
      earlyCallBonusGold: Math.floor(PREP_TICKS_FIRST * EARLY_CALL_RATE),
      hand,
      // 읽기 전용 사본 — UI(미리보기 수요 막대)가 "내 덱"을 알아야 한다
      deck: [...opts.deck],
      refreshCost: 0,
      enemies: world.enemies.items,
      towers: world.towers.items,
      projectiles: world.projectiles.items,
      allies: world.allies.items,
      // 자리만 잡아 두는 값 — 진짜 Lv1 정원은 ctx 조립 직후 allyCapFor로 덮어쓴다.
      // 갱신 지점이 **둘**이다: 생성(아래)과 레벨업(cmd 'upgradeBase'). 둘 중 하나라도
      // 빠지면 HUD 부족 칩의 분모가 규칙과 갈라진다.
      allyCap: ALLY_MAX_ACTIVE,
      amberEarned: 0,
      endless: opts.endless,
      // ctx.resources.list와 **같은 배열 객체**다 — 목록은 안 변하고
      // 상태 셋(taken·regrowAt·regrowsLeft)만 변한다
      resources: resources.list,
    };
    this.ctx = {
      opts,
      rng: new Rng(opts.seed),
      world,
      events: [],
      view,
      groundPaths,
      airPaths,
      hometown: createHometown(),
      resources,
    };
    this.pathCells = pathCells;
    this.scenery = scenery;
    // 정원은 마을 레벨의 함수라 **시작 시점에도** 표에서 읽어야 한다. 위 리터럴의
    // ALLY_MAX_ACTIVE는 그저 형태를 맞추는 값이고, 진짜 Lv1 값은 여기서 들어온다
    // (ctx가 조립되기 전에는 allyCapFor를 부를 수 없어 두 줄로 나뉜다).
    // ⚠ 9단계 검증에서 이 줄이 없어 HUD가 Lv1에서 '0/6'을 띄웠다 — 커맨드는 2에서 거부하는데.
    view.allyCap = allyCapFor(this.ctx);
    this.economy.fillHand(this.ctx);
  }

  get state(): BattleStateView {
    return this.ctx.view;
  }

  tick(): void {
    const ctx = this.ctx;
    const v = ctx.view;
    if (v.phase === 'won' || v.phase === 'lost') return; // 종료 후 동결
    v.tick++;
    // 1) prep 진행 / 웨이브 스폰
    if (v.phase === 'prep') {
      // 준비 단계 자동 수리 — 이 페이즈에는 살아 있는 적이 0마리임이 보장된다(checkEnd)
      if (isRepairTick(v.tick)) repairTowers(ctx);
      if (v.prepTicksLeft > 0) v.prepTicksLeft--;
      v.earlyCallBonusGold = Math.floor(v.prepTicksLeft * EARLY_CALL_RATE);
      if (v.prepTicksLeft <= 0) this.startWave();
    }
    if (v.phase === 'wave') this.spawner.update(ctx);
    // 2) 아군 교전/봉쇄 + 적의 난투 반격 (공성보다 **먼저** — allies.ts 규칙 5)
    updateAllies(ctx);
    // 3) 적 부족의 타워 공격 → 부서진 타워 회수 (발사 단계보다 먼저)
    updateSiege(ctx);
    if (sweepDestroyedTowers(ctx)) {
      this.economy.recalcCosts(ctx); // 타워 수 감소 → 핸드 실비용 하락
      recomputeBuffs(ctx); // drum이 부서졌을 수 있다 — 5틱 주기를 기다리지 않는다
    }
    // 3-b) 문간 교전 — 문 앞에 선 적이 마을을 문다 (gate.ts). 공성과 **같은 스냅샷**을 본다.
    //   여기서 체류 상한에 닿은 개체는 leakEnemy로 뚫고 들어가고, 회수는 9단계가 한다.
    updateGate(ctx);
    // 4) 적 이동/누수 → 아군 이동 (같은 스냅샷으로 양쪽을 움직인다)
    this.moveEnemies();
    /*
     * 8-d) **마법사 회복** — 전투 뒤, 이동 앞. 그 자리인 이유 셋은 `heal.ts` 헤더에 있다
     * (요약: 이 틱의 피해를 이 틱에 고치고, 여기서 정한 tgt 가 같은 틱에 걸음이 된다).
     */
    updateAllyHeal(ctx);
    moveAllies(ctx);
    // 5) 상태이상 틱 + 힐 오라
    const enemies = ctx.world.enemies.items;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i] as EnemySim;
      if (e.alive) {
        tickEnemyStatuses(ctx, e);
        // 재충전형 방패는 **매 틱** 센다 — 15틱 경계로 올리면 차단율이 재충전 값이
        // 아니라 경계 간격에 딸리게 되어 types.ts 의 유도가 깨진다
        tickShields(ctx, e);
      }
    }
    if (v.tick % STATUS_TICK_INTERVAL === 0) {
      /*
       * ⚠ **순서를 못 박는다: 힐이 먼저, 정화가 나중.**
       * 같은 15틱 경계에 두 오라가 붙으므로 순서가 결과를 바꾼다. 이 틱의 DoT 는 위
       * 5단계에서 이미 적용된 뒤이므로, 정화를 나중에 두면 "이번 틱의 DoT 는 들어가고
       * 다음 틱부터 빠진다" 가 되어 벗기는 값이 정확히 한 주기분이다. 정화를 먼저 두면
       * 같은 스택이 이번 틱 피해를 넣고도 사라져 한 주기가 공짜가 된다.
       * 순서를 안 적으면 다음 사람이 뒤집고 아무도 모른다.
       */
      processHealAuras(ctx);
      processPurgeAuras(ctx);
    }
    // 6) 버프 재계산 (5틱마다)
    if (v.tick % BUFF_INTERVAL === 0) recomputeBuffs(ctx);
    // 7) 타워 조준/발사 → 홈타운 조준/발사 (사수는 같은 스냅샷에서 함께 쏜다)
    updateTowers(ctx);
    updateHometown(ctx);
    // 8) 투사체 이동/명중 (타워 투사체와 홈타운 화살이 같은 단계를 탄다)
    updateProjectiles(ctx);
    // 8-a) 재생 — 다 캔 칸이 T틱 뒤 같은 종·같은 값으로 돌아온다 (R2).
    //   **8-b 앞**인 이유 셋은 `updateRegrow` 헤더에 있다(요약: 이 틱에 자란 칸을 같은 틱의
    //   8-c가 잡는다 · 자라는 칸에는 예약이 없다 · 커맨드는 tick() 밖이라 경합이 없다).
    //   ⚠ 방치 판에서도 매 틱 돈다 — 다만 아무 칸도 안 텄으면 재고가 정확히 1.0이라
    //     **문턱 비교 한 줄에서 반환**한다. 상태 변화 0 · 이벤트 0 · rng 0 이고,
    //     그래서 economy.fillHand 의 드로우가 한 칸도 안 밀린다.
    updateRegrow(ctx);
    // 8-b) 채집 — 캐기 진행 · 짐 확정 · 자동 귀환 · **배달** (docs/gather-spec.md §4-7)
    //  한 자리가 네 조건을 동시에 만족한다:
    //   · 4) moveAllies 뒤 → **같은 틱의 도착**과 **같은 틱의 배달 진입**을 읽는다(지연 없음)
    //   · 2) updateAllies(난투 = 아군 피해의 **유일한** 발생지) 뒤 → **이 틱의 피해**로
    //        중단 판정(D5)이 선다. 앞에 두면 언제나 한 틱 늦게 끊긴다
    //   · 9) sweepDeadAllies 앞 → **죽은 사람의 짐**을 흘릴 수 있다. 뒤로 가면 시체가
    //        이미 회수돼 gatherLost{'died'}가 영영 안 나가고, 그 전에 시체가 마을에 닿아
    //        **지급까지 받는다** — "지고 오는 길이 위험하다"가 통째로 사라진다
    //   · 10) checkEnd 앞 → **승패를 선언하는 틱에도 마을에 닿아 있으면 지급된다.**
    //        이 선후는 운반·배달이 생기면서 **다시 판단한 것**이고 답은 "앞"이다:
    //        (1) 이기는 판 — 승리 골드는 결과 화면에 안 쓰이므로(결과는 호박만 읽는다)
    //            수치는 안 바뀌고, 바뀌는 것은 마지막 프레임에 배달 연출이 나오느냐뿐이다.
    //            그 한 프레임이 "짐을 지고 오면 돈이 된다"의 마지막 확인이다.
    //        (2) 지는 판 — leakEnemy는 4단계인데 checkEnd는 10단계다. 8-b가 앞이므로
    //            **지는 판의 마지막 배달도 지급된다.** 뒤로 옮기면 "마을이 무너지는 순간
    //            등에 진 짐이 사라진다"가 되는데, 그건 화면에서 **운반 중 사망 벌금과
    //            구별되지 않는다** — 같은 그림에 규칙 둘이 겹치면 어느 쪽도 안 배워진다.
    //        되먹임은 없다: 이 골드를 이 틱의 어떤 판정도 읽지 않는다.
    //  대가 하나: 여기는 updateTowers(7)·updateProjectiles(8) **뒤**라 배달 골드는
    //  **다음 틱**부터 쓸 수 있다. 커맨드는 틱 경계에 적용되므로 손에는 차이가 없다(1/30초).
    updateGather(ctx);
    // 8-c) 자동 행동 — 명령 없는 일꾼이 다음 칸/마을을 스스로 잡는다 (allies.ts 규칙 8).
    //   8-b 뒤인 이유: 같은 틱의 배달을 읽어 "마을에 들어와 놓고 다시 나간다"가 지연 없이
    //   일어난다(updateGather ③이 배달 직후 tgt를 지금 위치로 박으므로 여기서는
    //   "도착해 있고 빈손"으로 읽힌다). 9 앞인 이유: 자동은 산 사람만 보므로 시체가 배열에
    //   있어도 상관없고, 읽는 순서가 채집 바로 옆인 편이 규칙을 읽는 순서와 같다.
    //   ⚠ 이 단계는 이벤트를 한 건도 안 낸다 — 자동은 연출이 아니다.
    updateAllyAuto(ctx);
    // 9) 사망 처리 (이벤트는 피해/귀환 시점에 발생, 여기서는 회수만)
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!(enemies[i] as EnemySim).alive) ctx.world.removeEnemyAt(i);
    }
    sweepDeadAllies(ctx);
    // 10) 승패/웨이브 완료 판정
    this.checkEnd();
  }

  private startWave(): void {
    const ctx = this.ctx;
    const v = ctx.view;
    v.phase = 'wave';
    this.economy.onWaveStart(ctx);
    const wave = v.waveIndex;
    const def = ctx.opts.waveFor(wave);
    // endless: waveCount 초과분은 hpMul × 1.06^(wave-waveCount) 추가
    const extra = wave > v.waveCount ? ENDLESS_HP_GROWTH ** (wave - v.waveCount) : 1;
    this.waveDef = def;
    // ctx를 넘기는 이유: 살점 값의 기준 HP(마릿수 가중 중앙값)를 웨이브당 한 번
    // 굳혀야 하고, 그 계산에 enemyDefs가 필요하다 (waves.medianSpawnHp)
    this.spawner.start(ctx, def, extra);
    ctx.events.push({ type: 'waveStarted', wave });
  }

  private moveEnemies(): void {
    const ctx = this.ctx;
    const items = ctx.world.enemies.items;
    for (const e of items) {
      if (!e.alive) continue;
      e.prevX = e.x;
      e.prevZ = e.z;
      // **문 앞에 선 적은 두 번 다시 걷지 않는다** (gate.ts 규칙 3). 봉쇄·정지 판정보다
      // 앞이다 — 문간은 그 둘의 결과와 무관하게 좌표를 영구히 고정한다.
      if (atGate(e)) continue;
      // 아군에게 발이 묶였다 — 유닛 충돌 대신 쓰는 봉쇄 표현 (allies.ts 규칙 5)
      if (e.blockerAllyId >= 0) continue;
      // 습격대는 타워를 쏘는 동안 그 자리에 멈춰 선다 (siege.ts 규칙 4)
      if (isSieging(e)) continue;
      const sp = effectiveSpeed(e);
      if (sp <= 0) continue;
      // 규칙 4-b) 전진 의무는 **실제로 전진한 틱에만** 준다 — 봉쇄·스턴으로 서 있는
      // 시간이 의무를 갉으면 "묶였다 풀리자마자 또 정지"가 되어 보장이 깨진다
      if (e.siegeWalkLeft > 0) e.siegeWalkLeft--;
      e.dist += sp * TICK_DT;
      const path = pathFor(ctx, e);
      // 정지선 = 문간이 켜져 있으면 `totalLength − (GATE_STANDOFF_EDGE + def.restReach)`,
      // 꺼져 있으면 경로 끝. (숫자를 베끼지 않는다 — 잣대가 `radius` → `restReach` 로 갔다)
      // **갈림은 이 한 곳뿐이다** (gate.ts 규칙 1) — `leakEnemy` 안에 두면 combat → gate
      // 순환 참조가 생기고, 새 호출자가 조용히 규칙을 우회한다.
      const stop = stopDistFor(ctx, e, path);
      if (e.dist >= stop) {
        e.dist = stop;
        // 문간이 꺼진 판(`gate.enabled = false` 대조군)에서는 stop === totalLength 이고
        // 아래가 종전과 **비트 단위로 같은 경로**다. 그것이 A/B 를 코드 0줄로 만든다.
        if (stop < path.totalLength) enterGate(ctx, e, path, stop);
        else leakEnemy(ctx, e); // 회수는 사망 처리 단계에서
        continue;
      }
      path.sample(e.dist, e);
    }
    // 진행거리 오름차순 정렬 유지 (타게팅 규약)
    items.sort(byDistThenId);
  }

  private checkEnd(): void {
    const ctx = this.ctx;
    const v = ctx.view;
    if (v.baseHp <= 0) {
      v.phase = 'lost';
      ctx.events.push({
        type: 'battleEnded',
        won: false,
        wave: v.waveIndex,
        amberEarned: v.amberEarned,
      });
      return;
    }
    if (v.phase !== 'wave' || !this.spawner.allSpawned() || ctx.world.enemies.length > 0) return;
    // 웨이브 완료 — 전원 스폰됨 + 생존 0
    const def = this.waveDef;
    const reward = def ? def.goldReward : 0;
    if (reward > 0) addGold(ctx, reward);
    const amber = ctx.opts.stage.perWaveAmber;
    v.amberEarned += amber;
    ctx.events.push({ type: 'waveCleared', wave: v.waveIndex, goldReward: reward, amber });
    if (!v.endless && v.waveIndex >= v.waveCount) {
      v.phase = 'won';
      ctx.events.push({
        type: 'battleEnded',
        won: true,
        wave: v.waveIndex,
        amberEarned: v.amberEarned,
      });
      return;
    }
    v.waveIndex++;
    v.phase = 'prep';
    v.prepTicksLeft = PREP_TICKS_LATER;
  }

  applyCommand(cmd: BattleCommand): boolean {
    const v = this.ctx.view;
    if (v.phase === 'won' || v.phase === 'lost') return false;
    switch (cmd.type) {
      case 'placeTower':
        return this.cmdPlace(cmd.handIndex, cmd.cellX, cmd.cellZ);
      case 'upgradeTower':
        return this.cmdUpgrade(cmd.towerId);
      case 'sellTower':
        return this.cmdSell(cmd.towerId);
      case 'refreshHand':
        return this.economy.tryRefresh(this.ctx);
      case 'setTargeting': {
        const t = this.ctx.world.findTower(cmd.towerId);
        if (!t) return false;
        t.targeting = cmd.mode;
        t.targetId = -1; // 새 모드로 재조준
        return true;
      }
      case 'swapTowers':
        return this.cmdSwapTowers(cmd.aId, cmd.bId);
      case 'clearScenery':
        return this.cmdClearScenery(cmd.cellX, cmd.cellZ);
      case 'trainAlly':
        return trainAlly(this.ctx, cmd.defId);
      case 'moveAlly':
        return moveAlly(this.ctx, cmd.allyId, cmd.cellX, cmd.cellZ, cmd.defId);
      case 'upgradeBase': {
        if (!upgradeBase(this.ctx)) return false;
        // 정원은 마을 레벨의 함수라 레벨이 오르는 **그 자리에서** 공개 상태도 따라가야 한다
        this.ctx.view.allyCap = allyCapFor(this.ctx);
        return true;
      }
      case 'callWave': {
        // 이미 호출됨(카운트다운 0)이면 중복 호출 거부
        if (v.phase !== 'prep' || v.prepTicksLeft <= 0) return false;
        const bonus = Math.floor(v.prepTicksLeft * EARLY_CALL_RATE);
        if (bonus > 0) addGold(this.ctx, bonus);
        this.ctx.events.push({ type: 'earlyCallBonus', gold: bonus });
        v.prepTicksLeft = 0; // 다음 틱에 웨이브 시작
        v.earlyCallBonusGold = 0;
        return true;
      }
    }
  }

  private cmdPlace(handIndex: number, cellX: number, cellZ: number): boolean {
    const ctx = this.ctx;
    const card = ctx.view.hand[handIndex];
    if (!card) return false;
    if (!this.canPlaceAt(cellX, cellZ)) return false;
    if (ctx.view.gold < card.cost) return false;
    addGold(ctx, -card.cost);
    const maxHp = maxHpFor(ctx, card.towerId, 0);
    const t: TowerState = {
      id: ctx.world.newId(),
      defId: card.towerId,
      tier: 0,
      hp: maxHp,
      maxHp,
      silenceLeft: 0,
      cellX,
      cellZ,
      cooldownLeft: 0,
      targetId: -1,
      targeting: 'first',
      invested: card.cost,
      buffDmgPct: 0,
      buffRatePct: 0,
    };
    // R3) **타워가 선 칸은 영영 안 자란다.** 이 기능이 만드는 진짜 선택이 이 두 줄이다:
    //   "지금 지을까(칸을 영구히 얻고 그 자원을 태운다), 두고 계속 캘까(수입은 계속되지만
    //    T틱마다 그 칸이 다시 막힌다)". 팔아도 안 돌아온다(burnRegrow 주석의 근거 셋).
    // ⚠ 매 틱 "이 칸에 타워가 있나"를 묻지 **않는다** — 40칸 × 타워수 조회가 매 틱 돌고,
    //   그 조회는 towers 풀의 swap-remove 순서를 타는 순간 계약 B를 깬다. 배치 시점에
    //   한 번 태우는 편이 규칙도 비용도 작고, 누락은 hash()의 regrowsLeft 가 잡는다.
    const rc = ctx.resources.at(cellZ * ctx.opts.stage.gridW + cellX);
    if (rc) burnRegrow(rc);
    ctx.world.towers.add(t);
    ctx.events.push({ type: 'towerPlaced', towerId: t.id, defId: t.defId, cellX, cellZ });
    this.economy.onPlaced(ctx, handIndex);
    return true;
  }

  private cmdUpgrade(towerId: number): boolean {
    const ctx = this.ctx;
    const t = ctx.world.findTower(towerId);
    if (!t || t.tier >= MAX_TIER) return false;
    const next = ctx.opts.towerDefs[t.defId].tiers[t.tier + 1];
    // 사용자 지시로 압력이 배치 → 업그레이드로 옮겨졌다(balance.UPGRADE_GROWTH).
    // 티어표 값이 아니라 **이 판에서 몇 번째 업그레이드인가**가 곱해진 실비용을 쓴다.
    const cost = next ? this.economy.upgradeCostOf(next.cost) : 0;
    if (!next || ctx.view.gold < cost) return false;
    addGold(ctx, -cost);
    t.tier++;
    t.invested += cost;
    // 업그레이드 회복 정책: **늘어난 최대치만큼만 즉시 회복** (누적 피해량은 그대로 유지).
    // 전량 회복으로 하면 업그레이드가 곧 완전 수리가 되어 "부서지기 전에 한 티어 올려 버티기"가
    // 항상 정답이 되고 파괴 위협이 사라진다. 비율 유지로 하면 반대로 절반 남은 타워를
    // 올릴 이유가 없어져 투자가 죽는다. 절대 피해 보존은 그 사이 —
    // 업그레이드가 체력을 크게 늘려주긴 하지만(T1→T2에서 +130) 상처는 남는다.
    const nextMax = maxHpFor(ctx, t.defId, t.tier);
    t.hp = Math.max(1, t.hp + (nextMax - t.maxHp));
    t.maxHp = nextMax;
    // 성사된 뒤에만 센다 — 위 거부 경로(골드 부족·만렙)는 값을 안 올린다
    this.economy.onUpgraded();
    ctx.events.push({ type: 'towerUpgraded', towerId: t.id, defId: t.defId, tier: t.tier });
    return true;
  }

  /**
   * **두 타워의 자리를 맞바꾼다.** 바뀌는 상태는 `cellX/cellZ` 둘뿐이다 —
   * HP·티어·투자금·침묵은 각자 그대로 따라간다(타워가 이사하는 것이다).
   *
   * 거부 조건: 같은 타워 · 둘 중 하나가 없음 · 골드 부족.
   * ⚠ **조준은 반드시 푼다**(`targetId = -1`). 자리가 바뀌면 사거리 안이던 적이 밖으로
   *   나가는데, 안 풀면 그 틱의 조준이 사거리 밖 적을 그대로 겨눈 채 남는다.
   * ⚠ **쿨다운은 안 건드린다.** 자리를 바꾸는 것으로 발사 주기가 초기화되면 "교환 →
   *   즉시 발사"가 공짜 딜이 되어 값싼 착취가 된다.
   * ⚠ 버프 캐시(`buffDmgPct/buffRatePct`)도 안 건드린다 — 5틱마다 스스로 다시 계산되고,
   *   여기서 손대면 그 재계산과 어느 쪽이 옳은지가 두 곳으로 갈린다.
   */
  private cmdSwapTowers(aId: number, bId: number): boolean {
    const ctx = this.ctx;
    if (aId === bId) return false;
    const a = ctx.world.findTower(aId);
    const b = ctx.world.findTower(bId);
    if (!a || !b) return false;
    const cost = TOWER_SWAP_COST;
    if (ctx.view.gold < cost) return false;
    addGold(ctx, -cost);
    const ax = a.cellX;
    const az = a.cellZ;
    a.cellX = b.cellX;
    a.cellZ = b.cellZ;
    b.cellX = ax;
    b.cellZ = az;
    a.targetId = -1;
    b.targetId = -1;
    ctx.events.push({
      type: 'towersSwapped',
      aId: a.id, aDefId: a.defId, aTier: a.tier, aCellX: a.cellX, aCellZ: a.cellZ,
      bId: b.id, bDefId: b.defId, bTier: b.tier, bCellX: b.cellX, bCellZ: b.cellZ,
      cost,
    });
    return true;
  }

  private cmdSell(towerId: number): boolean {
    const ctx = this.ctx;
    const items = ctx.world.towers.items;
    const idx = items.findIndex((t) => t.id === towerId);
    if (idx < 0) return false;
    const t = items[idx] as TowerState;
    const refund = sellRefundFor(t.invested);
    ctx.world.towers.removeAt(idx);
    addGold(ctx, refund);
    ctx.events.push({ type: 'towerSold', towerId, refund });
    this.economy.recalcCosts(ctx); // 타워 수 감소 → 핸드 실비용 하락 반영
    return true;
  }

  /**
   * 골드로 소품 치우기 — 성공하면 그 셀은 즉시 건설 가능해진다.
   * 이미 치운 셀/소품 없는 셀/골드 부족이면 거부(골드 이중 차감 불가).
   */
  private cmdClearScenery(cellX: number, cellZ: number): boolean {
    const ctx = this.ctx;
    const cost = this.clearSceneryCost(cellX, cellZ);
    if (cost === null || ctx.view.gold < cost) return false;
    const key = cellZ * ctx.opts.stage.gridW + cellX;
    addGold(ctx, -cost);
    this.scenery.delete(key);
    this.clearedScenery.push(key);
    // 치운 칸의 짐은 **버려진다** — 소품이 사라졌는데 배지가 짐값을 계속 그리거나 그 칸을
    // 다시 채집 대상으로 찍을 수 있으면 안 된다. 그것이 이 상품의 기회비용이다.
    // ⚠⚠ **`burn = true` 다 (R-f).** `r.taken = true` 를 직접 쓰면 **돈 내고 치운 칸이
    //   T틱 뒤 다시 자라 건설 불가로 돌아간다** — 그러면 `dozer` 팔이 오늘과 다른 판을 밟아
    //   6.clears·6.rateCap·6.dozer.notDominant·6.discord 가 전부 흔들리고, "채집 정책이 없는
    //   팔은 비트 동일"이라는 이 라운드 전체의 안전 논거가 한 줄 때문에 무너진다.
    //   그 실패는 조용하다: 타입 오류 0건이고, 짧은 판에서는 T가 안 지나 아무 일도 안 난다.
    const r = this.ctx.resources.at(key);
    if (r) takeCell(this.ctx, r, true);
    cancelGatherersOf(this.ctx, key);
    ctx.events.push({
      type: 'sceneryCleared',
      cellX,
      cellZ,
      cost,
      clearedCount: this.clearedScenery.length,
    });
    return true;
  }

  drainEvents(): SimEvent[] {
    const ev = this.ctx.events;
    return ev.splice(0, ev.length); // 배열 참조 유지 (SimCtx 공유)
  }

  hash(): number {
    const ctx = this.ctx;
    const v = ctx.view;
    let h = 2166136261 >>> 0;
    h = mix(h, ctx.rng.getState());
    h = mix(h, v.tick);
    h = mix(h, v.gold);
    h = mix(h, v.baseHp);
    // 홈타운 — 레벨은 최대 HP·공격력·사거리를 한꺼번에 바꾸고, 쿨다운/타깃은
    // "언제 누구를 쏘는가"를 바꾼다. 셋 다 빠지면 기지가 개입한 판의 발산을 해시가 놓친다
    h = mix(h, v.baseLevel);
    h = mix(h, v.baseHpMax);
    h = mix(h, ctx.hometown.attackCdLeft);
    h = mix(h, ctx.hometown.targetId);
    for (const e of ctx.world.enemies.items) {
      h = mix(h, e.id);
      h = mix(h, Math.round(e.x * 1000));
      h = mix(h, Math.round(e.z * 1000));
      h = mix(h, e.hp);
      /*
       * 방패 둘 — **hp 에서 유도되지 않는다.** 방패에 막힌 타격은 피해가 **0** 이라
       * hp 가 한 자리도 안 움직인다. 곧 hp 가 같은 두 개체가 잔량이 다를 수 있고,
       * 그 둘의 미래는 통째로 다르다 (gateOwed·bountyPaid 와 정확히 같은 논거).
       * ⚠ `shieldHitsLeft` 는 원래부터 여기 없었다 — 재충전(2라운드 2-b)이 들어오기
       *   전에도 누락이었고, 새 필드만 접으면 "언제 회복하나"는 잡고 "지금 몇 장인가"는
       *   못 잡는다. 둘 다 접어야 이 해시가 방패 회귀를 실제로 잡는다.
       * 풀 재사용 리셋 누락(resetEnemy)도 여기서만 그 틱에 드러난다.
       */
      h = mix(h, e.shieldHitsLeft);
      h = mix(h, e.shieldRechargeLeft);
      /*
       * 상태이상 — 정화(purge)가 들어오면서 **"어느 스택을 벗겼나"가 판정에 되먹임되는
       * 새 상태**가 생겼다. 그 차이는 hp·속도로 발산할 때까지 몇 주기가 걸리므로,
       * 접지 않으면 해시가 정화 회귀를 한참 뒤에나 본다.
       * kind 는 문자열이라 그대로 못 접는다 — `STATUS_KIND_ORDER` 인덱스로 바꾼다.
       */
      for (const s of e.statuses) {
        h = mix(h, STATUS_KIND_ORDER.indexOf(s.kind));
        h = mix(h, s.remainingTicks);
        h = mix(h, Math.round(s.magnitude * 1000));
        h = mix(h, s.acc);
      }
      // 공성 상태 — 이게 빠지면 "언제 누구를 때리는가"의 발산을 해시가 못 잡는다
      h = mix(h, e.attackCdLeft);
      h = mix(h, e.towerTargetId);
      // 정지 사격(siege.ts 규칙 4) — 셋이 **각각** 다른 발산을 잡는다.
      //  · siegeHoldLeft : 지금 서 있는가 = 이동 여부. 1틱만 어긋나도 위치가 갈린다
      //  · siegeWalkLeft : 언제 다시 멈출 수 있는가 = 앞으로의 정지 시점 전부
      //  · attackAnimLeft: 연출 전용이지만 타격 시점의 파생값이라, 여기가 갈리면
      //    "언제 쐈는가"가 갈린 것이다 (판정에 되먹임은 없어도 증거로는 유효하다)
      h = mix(h, e.siegeHoldLeft);
      h = mix(h, e.siegeWalkLeft);
      h = mix(h, e.attackAnimLeft);
      // 봉쇄/난투 — 봉쇄는 이동·공성·반격을 동시에 바꾸므로 1틱만 어긋나도 전부 갈라진다
      h = mix(h, e.blockerAllyId);
      h = mix(h, e.brawlCdLeft);
      // 문간 (gate.ts) — 셋이 **각각** 다른 발산을 잡는다.
      //  · gateTicks     : 문 앞에 서 있는가(= 이동 여부) + 몇 틱째인가. 진입이 1틱만
      //    어긋나도 여기가 갈리고, 풀 재사용 리셋 누락(resetEnemy)이 **스폰 첫 틱에**
      //    드러난다 — v.baseHp 로도 갈리긴 하지만 그 발산은 한 주기 뒤에나 보인다.
      //  · gateBiteCdLeft: 언제 다음 한 입이 나가는가 = 앞으로의 마을 HP 궤적 전부.
      //    봉쇄·스턴이 쿨다운을 다르게 다루므로(규칙 8) gateTicks 에서 유도되지 않는다.
      //  · gateOwed      : 앞으로 마을에 들어갈 총 피해. **hp 로도 gateTicks 로도 유도되지
      //    않는다** — 같은 자리에 같은 틱수로 선 두 개체가 잔액이 다르면 앞으로의 판이
      //    통째로 다르다. resetEnemy/waves.spawn 초기화 누락도 여기서만 그 틱에 드러난다
      //    (bountyPaid 와 정확히 같은 논거).
      h = mix(h, e.gateTicks);
      h = mix(h, e.gateBiteCdLeft);
      h = mix(h, e.gateOwed);
      // 문간 자리 목표 — x/z 에서 **유도되지 않는다.** 도착 전까지 앞으로의 궤적
      // 전부가 이 값에 걸리고, resetEnemy 누락(풀 재사용)도 여기서 드러난다.
      h = mix(h, Math.round(e.gateTgtX * 1000));
      h = mix(h, Math.round(e.gateTgtZ * 1000));
      // 살점 값의 지급 이력 — **hp에서 유도되지 않는다.** 회복(healAura)으로 hp가
      // 되돌아온 적은 hp가 같아도 bountyPaid가 다르고, 곧 앞으로 받을 돈이 다르다.
      // 풀 재사용 리셋 누락(resetEnemy)도 여기서만 그 틱에 드러난다 — v.gold로도
      // 갈리긴 하지만 그 발산은 몇 백 틱 뒤에나 보인다.
      // (bountyChunks는 안 넣는다: 스폰 시 maxHp·bounty·refHp에서 결정되는 상수라
      //  그것이 갈리면 bountyPaid가 반드시 먼저 갈린다)
      h = mix(h, e.bountyPaid);
    }
    // 아군 부족원 — 위치/걸은 거리/목표/체력/쿨다운/타깃 전부. 하나라도 빠지면
    // "언제 누가 어디서 죽는가"의 발산을 해시가 놓친다.
    // (walked는 x/z에서 유도되지만 **목표에 도착해 멈춘 뒤에도 값이 남는** 유일한 항목이라
    //  따로 넣는다 — 9단계 전에는 같은 역할을 경로 호장 dist가 했다. 목표 tgtX/tgtZ도 넣는다:
    //  명령만 바꾸고 아직 한 걸음도 안 걸은 틱을 x/z만으로는 구별할 수 없다)
    for (const a of ctx.world.allies.items) {
      h = mix(h, a.id);
      h = mix(h, Math.round(a.x * 1000));
      h = mix(h, Math.round(a.z * 1000));
      h = mix(h, Math.round(a.walked * 1000));
      h = mix(h, Math.round(a.tgtX * 1000));
      h = mix(h, Math.round(a.tgtZ * 1000));
      h = mix(h, a.hp);
      h = mix(h, a.attackCdLeft);
      h = mix(h, a.targetId);
      // 채집 — 다섯 다 어디서도 유도되지 않는다. **빠뜨리면 결정론이 조용히 깨진다.**
      //  · gatherKey    : 다음 틱에 이 사람이 무엇을 하는가 자체다
      //  · gatherTicks  : 순수 누적기. x/z로도 walked로도 복원할 수 없고,
      //                   resetAlly 누락(풀 재사용)이 그 틱에 드러나는 유일한 자리다
      //  · carryGold    : 앞으로 발행될 골드. v.gold로도 갈리지만 그건 배달 뒤에나 보인다
      //  · carryCount   : 언제 자동 귀환이 걸리는가 = 앞으로의 동선 전부
      //  · gatherHpMark : 같은 hp라도 시도 시작 시점이 다르면 중단 여부가 갈린다
      h = mix(h, a.gatherKey);
      h = mix(h, a.gatherTicks);
      h = mix(h, a.carryGold);
      h = mix(h, a.carryCount);
      h = mix(h, a.gatherHpMark);
      // 자동 행동 — **유도되지 않는다.** 같은 자리에 같은 짐으로 서 있어도 이 비트가
      // 다르면 다음 틱에 일하러 가느냐 서 있느냐가 갈린다. resetAlly 누락도 여기서 드러난다.
      h = mix(h, a.autoHold ? 1 : 0);
      // 회복 (sim/heal.ts) — 둘 다 **유도되지 않는다.**
      //  · healKey     : 다음 틱에 이 사람이 어디로 걸어가 무엇을 고치는가 자체다.
      //                  tgtX/tgtZ 로도 복원 안 된다 — 사거리 안에 들어와 멈춘 뒤에는
      //                  tgt 가 그대로인데 대상이 바뀔 수 있다(만피가 되면 다음으로 옮긴다).
      //  · healCdLeft  : 순수 카운터. 앞으로의 HP 궤적 전부가 여기 걸린다.
      // resetAlly 누락(풀 재사용)이 드러나는 자리도 여기다 — 위 gatherTicks 와 같은 논거.
      h = mix(h, a.healKey);
      h = mix(h, a.healCdLeft);
    }
    for (const t of ctx.world.towers.items) {
      h = mix(h, t.id);
      h = mix(h, t.cellX * 1000);
      h = mix(h, t.cellZ * 1000);
      h = mix(h, t.tier * 1000 + t.cooldownLeft);
      // 구조물 체력 — 파괴 시점이 1틱만 어긋나도 해시가 갈라진다
      h = mix(h, t.hp);
      h = mix(h, t.maxHp);
      // 침묵 잔여 — "언제부터 다시 쏘는가"의 발산을 잡는다 (저주는 발사 시점을 바꾼다)
      h = mix(h, t.silenceLeft);
    }
    for (const p of ctx.world.projectiles.items) {
      h = mix(h, p.id);
      h = mix(h, Math.round(p.x * 1000));
      h = mix(h, Math.round(p.z * 1000));
      h = mix(h, p.dmg);
    }
    // 지형 개조 상태 — 어떤 셀을 어떤 순서로 치웠는지까지 해시에 넣어야
    // 제거를 포함한 커맨드열의 결정론이 검증된다
    h = mix(h, this.clearedScenery.length);
    for (const key of this.clearedScenery) h = mix(h, key);
    // 자원 칸 — **자료구조의 순회 순서에 결정론을 걸지 않는다.**
    // ctx.resources.list는 생성 시 셀 키 오름차순으로 굳고 그 뒤로 재정렬도 삭제도 없다
    // (텄어도 taken = true로 남는다). 곧 접는 순서가 Map/Set 구현과 완전히 무관하다.
    // 셀 좌표를 함께 접는 이유: taken만 접으면 **목록 자체가 잘못 만들어진 회귀**
    // (resourceKindOf가 갈리거나 정렬이 빠진 경우)를 못 잡는다. 40~51칸이라 값이 싸다.
    // kind와 value는 안 접는다 — 생성 시 굳어 절대 안 변하므로 **상태가 아니다**:
    //   종류가 갈리면 캐는 틱 수가 갈려 gatherTicks가, 값이 갈리면 carryGold가 반드시
    //   먼저 갈린다(bountyChunks를 안 접는 것과 같은 논거).
    // **텐 순서는 안 접는다.** clearedScenery가 순서까지 접는 이유는 그 순서가 다음
    //   제거값의 지수이기 때문인데, 채집에는 순서에 의존하는 값이 하나도 없다.
    //   같은 집합을 다른 순서로 텄다면 아군의 위치·gatherTicks가 이미 갈려 있다.
    // ⚠ **셋을 접는다.** 재생이 들어오면서 상태가 하나에서 셋으로 늘었다:
    //  · taken       — 뜻이 하나 늘었다. 이제 이 비트가 **건설 가능 여부**이기도 하다(D1 뒤집힘).
    //                  갈리면 canPlaceAt 이 갈린 것이고, 그건 판이 통째로 갈린다.
    //  · regrowAt    — **taken 에서 유도되지 않는다.** 같은 틱에 똑같이 "텄음"인 두 칸도
    //                  자격을 얻는 틱이 다르면 **일꾼이 다음에 어디로 가는가**(pickAutoCell)와
    //                  **그 칸에 지을 수 있는 마지막 틱**이 다르다. 1틱만 어긋나도 타워 한 기의
    //                  자리가 갈리고, 그 발산은 몇 백 틱 뒤 gold 로만 보인다.
    //                  ⚠ **재고 게이트가 들어온 뒤 이 값이 지는 짐이 하나 더 늘었다**: 재생
    //                  선택 순서가 `(regrowAt, 셀 키)` 이고(gather.ts `updateRegrow`),
    //                  웨이브별 지연 차이도 텄던 틱에 여기 굳는다. 곧 `view.waveIndex` 가
    //                  hash() 에 **안 접혀 있는데도**(지금도 그렇다) 웨이브 의존의 발산이
    //                  이 값으로 드러난다 — 해시를 넓히지 않아도 되는 이유가 그 배치다.
    // ⚠ 재고 비율은 **접지 않는다**: `taken`·`value` 와 밭의 분모에서 남김없이 유도되고
    //   (분모는 좌표만의 함수라 판 중에 안 변한다), 상태가 아니라 **계산**이기 때문이다.
    //   `bountyChunks`·`kind`·`value` 를 안 접는 것과 정확히 같은 논거다.
    //  · regrowsLeft — **판당 총액의 상한 그 자체다.** 0 은 광물·유료 제거·타워 소각이 만드는
    //                  되돌릴 수 없는 사실이고, R3 소각을 한 번 빠뜨리면 이 값이 안 접힐 때
    //                  판이 끝날 때까지 아무 데서도 안 드러난다.
    for (const r of ctx.resources.list) {
      h = mix(h, r.cellX * 1000 + r.cellZ);
      h = mix(h, r.taken ? 1 : 0);
      h = mix(h, r.regrowAt);
      h = mix(h, r.regrowsLeft);
    }
    return h;
  }

  /**
   * 웨이브 미리보기 — **순수 조회**. 상태를 안 건드리고, 이벤트를 안 내고,
   * hash()에 안 들어간다(이 메서드는 어떤 필드에도 쓰지 않는다).
   *
   * 기본값이 "다음에 올 웨이브"인 이유: prep 중에는 view.waveIndex가 **이미**
   * 다음 웨이브 번호이고(startWave가 그 값을 그대로 쓴다), 전투 중이면 지금 웨이브라
   * 다음은 +1이다. 두 국면을 하나의 식으로 쓰면 prep에서 한 웨이브 건너뛴 것을 보여준다.
   * (docs/counter-plan.md 1단계는 `waveIndex + 1`로 적혀 있는데, 그 식은 전투 중에만 맞다.)
   *
   * hpMul은 스폰과 **같은 식**을 쓴다 — sim/waves.ts spawn의
   * `max(1, round(def.hp × g.hpMul × extraHpMul))` 그대로다. 무한 모드 초과분
   * (ENDLESS_HP_GROWTH^(wave−waveCount))도 startWave와 같은 조건으로 곱한다.
   * 이 두 식이 어긋나면 미리보기가 거짓말을 하므로 tests/sim/preview.test.ts가
   * "미리보기의 종별 합계 == 실제로 돌렸을 때 스폰된 종별 합계"를 잠근다.
   */
  previewWave(wave?: number): WavePreview {
    const ctx = this.ctx;
    const v = ctx.view;
    const next = v.phase === 'prep' ? v.waveIndex : v.waveIndex + 1;
    const w = Math.max(1, Math.floor(wave ?? next));
    const def = ctx.opts.waveFor(w);
    const extra = w > v.waveCount ? ENDLESS_HP_GROWTH ** (w - v.waveCount) : 1;
    const byId = new Map<EnemyId, WavePreviewEntry>();
    for (const g of def.groups) {
      if (g.count <= 0) continue;
      const eDef = ctx.opts.enemyDefs[g.enemyId];
      if (!eDef) continue;
      const maxHp = Math.max(1, Math.round(eDef.hp * g.hpMul * extra));
      const hit = byId.get(g.enemyId);
      if (hit) {
        hit.count += g.count;
        hit.totalHp += maxHp * g.count;
        // 같은 종이 여러 hpMul로 나뉘면 배지는 **가장 단단한 개체**를 말한다
        if (maxHp > hit.maxHp) {
          hit.maxHp = maxHp;
          // 가죽 상한은 maxHp에 비례하므로 **같은 개체**를 따라가야 한다
          if (eDef.hide !== undefined) hit.hideCap = hideCapFor(maxHp, eDef.hide);
        }
      } else {
        byId.set(g.enemyId, {
          defId: g.enemyId,
          count: g.count,
          maxHp,
          totalHp: maxHp * g.count,
          armor: eDef.armor,
          ...(eDef.hide !== undefined ? { hideCap: hideCapFor(maxHp, eDef.hide) } : {}),
          ...(eDef.splashResist !== undefined ? { splashResist: eDef.splashResist } : {}),
          flying: eDef.flying,
          boss: eDef.boss ?? false,
          traits: enemyTraitsOf(eDef),
        });
      }
    }
    // 총 HP 내림차순, 동점은 종 id 사전순 (완전 결정론 — 칩 순서가 시드에 흔들리지 않는다)
    const entries = [...byId.values()].sort(
      (a, b) => b.totalHp - a.totalHp || (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0),
    );
    let totalHp = 0;
    let totalCount = 0;
    let hasAir = false;
    let boss = false;
    for (const e of entries) {
      totalHp += e.totalHp;
      totalCount += e.count;
      if (e.flying) hasAir = true;
      if (e.boss) boss = true;
    }
    return { wave: w, entries, totalHp, totalCount, goldReward: def.goldReward, hasAir, boss };
  }

  /**
   * 그 칸에 **지금 소품이 서 있는가.** 건설 가능/불가의 **유일한** 지형 판정이다.
   *
   * ⚠ D1이 뒤집혔다(사용자 재정의): 다 캔 칸은 소품이 사라지고 **건설 가능해진다.**
   *   그렇지 않으면 화면에 아무것도 없는데 못 짓는 칸이 되고, 그건 설명할 방법이 없다.
   * ⚠ `scenery` Set 과 `taken` 이 **각자** "지을 수 있나"를 말하게 두면 두 답이 갈리는
   *   날이 온다. 판정을 하나 만들고 `canPlaceAt`·`hasScenery` 둘 다 이것을 부른다.
   *
   * 두 사실의 **곱**이다:
   *   ① 유료로 치우지 않았다 (`scenery` — 그 집합의 뜻은 한 글자도 안 바뀐다)
   *   ② 지금 다 자라 있다   (`resources` 의 `taken` — 재생하면 다시 `false` 가 된다)
   */
  private grown(key: number): boolean {
    if (!this.scenery.has(key)) return false;
    const r = this.ctx.resources.at(key);
    return r !== null && !r.taken;
  }

  canPlaceAt(cellX: number, cellZ: number): boolean {
    const stage = this.ctx.opts.stage;
    if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) return false;
    // 자유 배치: 경로/물/장식('#')/소품(나무·바위)이 아닌 빈 땅 어디든.
    // 치운 소품 셀도 **다 캔 소품 셀도** 여기서 통과한다 — 둘 다 화면에서 비어 있다.
    if (!isBuildableCell(stage, this.pathCells, cellX, cellZ)) return false;
    if (this.grown(cellZ * stage.gridW + cellX)) return false;
    return this.towerAt(cellX, cellZ) === null;
  }

  /**
   * 자원 칸 조회 — 소품이 없거나 격자 밖이면 null. HUD 자원 패널과 e2e 훅이 쓴다.
   * `hasScenery`와 **같은 정수/범위 가드**를 쓴다 — 두 답이 갈리면 "소품은 있는데 자원은
   * 없다"는 칸이 생기고, 화면이 그 차이를 설명할 방법이 없다.
   * ⚠ **`taken`을 걸러 내지 않는다.** 텄음 칸도 목록에 남아 있고(칸은 사라지지 않는다 —
   *   `regrowAt` 이 붙은 채 자라기를 기다린다), 호출부가 `taken`으로 "지금 캘 수 있는가"와
   *   "지금 비어 있는가"를 함께 읽는다. ⚠ 옛 주석의 "텄음 칸도 그루터기로 서 있고(D1)"는
   *   **거짓이 됐다** — 사용자가 그 판정을 뒤집었다.
   */
  resourceAt(cellX: number, cellZ: number): ResourceCellState | null {
    const stage = this.ctx.opts.stage;
    if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) return null;
    if (cellX < 0 || cellX >= stage.gridW || cellZ < 0 || cellZ >= stage.gridH) return null;
    return this.ctx.resources.at(cellZ * stage.gridW + cellX);
  }

  /**
   * 그 칸에 **지금 소품이 서 있는가** — 이름과 뜻이 다시 일치한다.
   * ⚠ 텄음 칸에서 `false` 를 준다 ⇒ `clearSceneryCost` 가 자동으로 `null` 이 되고
   *   `cmdClearScenery` 가 그 자리에서 거부한다(R-e). **이미 비어 있고 이미 지을 수 있는
   *   칸에 380골드를 받는 것은 사기다.** 부수 효과가 이 기능의 핵심이다: 재생을 끄는
   *   유일한 길이 "그 자리에 타워를 짓는 것"으로 좁아진다(R3).
   */
  hasScenery(cellX: number, cellZ: number): boolean {
    const stage = this.ctx.opts.stage;
    if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) return false;
    if (cellX < 0 || cellX >= stage.gridW || cellZ < 0 || cellZ >= stage.gridH) return false;
    return this.grown(cellZ * stage.gridW + cellX);
  }

  clearSceneryCost(cellX: number, cellZ: number): number | null {
    if (!this.hasScenery(cellX, cellZ)) return null;
    return sceneryClearCostFor(this.clearedScenery.length);
  }

  allyCost(defId: AllyId): number {
    const def = this.ctx.opts.allyDefs[defId];
    return def ? allyTrainCost(this.ctx, def) : 0;
  }

  canTrainAlly(defId: AllyId): boolean {
    const v = this.ctx.view;
    if (v.phase === 'won' || v.phase === 'lost') return false;
    const def = this.ctx.opts.allyDefs[defId];
    return def ? canTrainAlly(this.ctx, def) : false;
  }

  baseUpgradeCost(): number | null {
    return baseUpgradeCost(this.ctx);
  }

  canUpgradeBase(): boolean {
    const v = this.ctx.view;
    if (v.phase === 'won' || v.phase === 'lost') return false;
    return canUpgradeBase(this.ctx);
  }

  baseRange(): number {
    return currentLevelDef(this.ctx).range;
  }

  /** 지금 마을이 허용하는 부족원 정원 (9단계에 allySortieRange를 대신한다) */
  allyCap(): number {
    return allyCapFor(this.ctx);
  }

  baseNextStats(): { hpMax: number; dmg: number; range: number; allyCap: number } | null {
    return baseNextStats(this.ctx);
  }

  towerAt(cellX: number, cellZ: number): TowerState | null {
    for (const t of this.ctx.world.towers.items) {
      if (t.cellX === cellX && t.cellZ === cellZ) return t;
    }
    return null;
  }

  upgradeCost(towerId: number): number | null {
    const t = this.ctx.world.findTower(towerId);
    if (!t) return null;
    const next = this.ctx.opts.towerDefs[t.defId].tiers[t.tier + 1];
    // ⚠ 티어표 값이 아니라 **지금 실비용**이다 — 판 누적 업그레이드 횟수가 곱해진다
    //   (balance.UPGRADE_GROWTH). 화면·봇·테스트가 전부 이 하나를 읽어야 값이 안 갈린다.
    return next ? this.economy.upgradeCostOf(next.cost) : null;
  }

  /** 자리 교환 값 — 화면이 버튼에 적는 그 숫자. 정액이라 인자가 없다 */
  swapCost(): number {
    return TOWER_SWAP_COST;
  }

  sellRefund(towerId: number): number | null {
    const t = this.ctx.world.findTower(towerId);
    return t ? sellRefundFor(t.invested) : null;
  }
}

/**
 * **테스트 전용 주입구.** 게임 코드에서 이 인자를 넘기는 곳은 **한 군데도 없다** —
 * 넘기지 않으면 `ResourceField`가 `GATHER_BASE_VALUE` 하나를 읽으므로 "되돌리는 손잡이는
 * 하나"(D9)가 그대로 지켜진다.
 *
 * 그런데도 인자가 필요한 이유: 주입구가 없으면 난이도 봉투가 **짐값 축을 A/B할 수 없다.**
 * 대조군 `gather-x4`(짐값 네 배 = 반드시 빨개져야 하는 팔)를 만들 수 없고, 그러면 채집
 * 다리들이 전부 UNPROVEN으로 태어난다 — `tests/sim/controls.ts`가 `SCENERY_CLEAR_BASE_COST`에
 * 대해 이미 한 번 적어 둔 처지 그대로다. `BattleOptions`에 안 넣고 여기 둔 이유는
 * 그것이 **게임 데이터가 아니라 실험 손잡이**이기 때문이다.
 */
export interface BattleTuning {
  /** 짐값의 기준 크기 (생략 = `GATHER_BASE_VALUE`) */
  gatherBaseValue?: number;
  /**
   * 칸당 **재생 횟수 상한** (생략 = `GATHER_REGROW_MAX`).
   * ⚠ **판당 총액을 닫는 값이 이것이다** — 총액 = Σ value × (1 + regrowsLeft).
   * 대조군 둘이 이 인자 하나로 성립한다: `gather-regrow-off`(0 = 재생 없는 세계 복원,
   * 음성 대조)와 `gather-regrow-x3`(3 = 총액 폭주, 계약 다리 전부를 겨냥).
   */
  gatherRegrowMax?: number;
  /**
   * 자격을 얻기까지의 최소 지연 틱, 웨이브 1 기준 (생략 = `stage.gather` → `GATHER_REGROW_TICKS`).
   * 총액이 아니라 **모양**만 바꾼다 — 단위 테스트가 이 값을 짧게 잡아 재생을 강제하는 데 쓴다.
   */
  gatherRegrowTicks?: number;
  /**
   * 재생이 켜지는 **재고 문턱** (생략 = `stage.gather` → `GATHER_REGROW_STOCK_FRAC`).
   * ⚠ **판당 총액을 안 바꾼다** — 게이트는 "언제 자라는가"만 바꾸고 횟수는
   * `gatherRegrowMax` 가 그대로 닫는다. 그래서 `18.rateCap` 이 이 축과 무관하게 산다.
   * 두 끝이 그대로 대조군이다: **0 = 재생 없음** · **1 = 재고 게이트가 없던 옛 규칙**.
   */
  gatherRegrowStockFrac?: number;
  /**
   * 웨이브당 최소 지연 감쇠율 (생략 = `stage.gather` → `GATHER_REGROW_WAVE_SPEEDUP`,
   * **0 = 웨이브 의존을 통째로 끔**). 이것도 횟수가 아니라 속도만 바꾼다.
   */
  gatherRegrowWaveSpeedup?: number;
}

export function createBattle(options: BattleOptions, tuning?: BattleTuning): BattleSim {
  return new Battle(options, tuning);
}
