/**
 * 자동플레이 봇 하네스 — 난이도 봉투 측정의 단일 구현체.
 * (autoplay.test.ts 가 봉투를 잠그고, 밸런스 스윕이 같은 봇으로 숫자를 낸다)
 *
 * ── 봇이 흉내내는 것 ───────────────────────────────────────────────────────
 * "평범한 사람의 상식적 플레이"다. 새로고침·판매·타게팅 변경은 쓰지 않는다
 * (사람은 이보다 잘한다 → 봇이 클리어하면 사람도 클리어한다는 하한선이 된다).
 * 대신 **게임이 명시적으로 가르치는 규칙**은 지킨다. 규칙을 모르는 봇이 지는 것은
 * 게임이 불공정하다는 증거가 아니기 때문이다. 부족 습격대(siege.ts) 도입으로
 * 새로 생긴 규칙이 둘이라 봇도 둘을 배웠다:
 *
 *  1) **배치 거리 = 위험도** (siege.ts 규칙 1).
 *     적은 경로를 벗어나지 않으므로 경로에서 SAFE_DIST 이상 떨어진 타워는
 *     근접(칼 1.5 / 창 1.95)이 영원히 닿지 못한다. 경로에 딱 붙여 짓던 예전 봇은
 *     이 세계에서 그냥 서투른 것이고, 그 서투름으로 잰 난이도는 게임의 난이도가 아니다.
 *     → 기본 봇은 "사거리가 닿는 한 가장 안전한 칸"을 고른다. 공짜는 아니다 —
 *       멀어질수록 경로를 덮는 구간이 짧아져(현 d에서 커버 길이 2√(r²−d²)) 화력이 준다.
 *     비교군이 필요할 때는 hugPath:true 로 예전 봇(경로 밀착)을 그대로 재현한다.
 *
 *  2) **손상 중이면 조기 호출하지 않는다** — 다만 이건 "게임이 가르치는 규칙"이
 *     아니라 **보수적인 하한선**으로만 유지한다.
 *     prep 자동 수리(balance.TOWER_REPAIR_PER_STATUS_TICK)는 준비 시간이 흘러야 들어오고,
 *     조기 호출은 그걸 버리는 대신 남은틱×0.15 골드를 받는다. 도입 당시 이 선택이
 *     유의미하다고 적었지만 **데이터는 그렇지 않았다**: 스테이지1 시드 24개 실측에서
 *     항상 조기호출 16/24승·기지HP합 129 대 수리 대기(기본) 16/24승·126 — 무승부다.
 *     prep 90틱의 조기 보너스는 floor(90×0.15)=13골드뿐이라 애초에 판단할 거리가 아니다.
 *     기본값을 수리 대기로 두는 이유는 우월해서가 아니라 (a) 파괴가 근소하게 적어
 *     (8.4기 대 10.4기) 측정 분산이 작고 (b) 봇이 게임을 덜 짜내는 쪽이
 *     "봇이 이기면 사람도 이긴다"는 하한선의 취지에 맞기 때문이다.
 *     (alwaysRush:true 로 반대 행동 재현)
 *
 * 파괴 대응은 별도 로직이 필요 없다 — 배치 상한 미만이면 채우는 기존 루프가
 * 부서진 자리를 그대로 다시 짓는다(안전거리 규칙을 그대로 다시 적용하므로 재건설은
 * 자동으로 더 나은 자리를 고른다). 다만 그 골드는 업그레이드에서 빠져나가므로
 * 파괴는 "타워 한 기"가 아니라 "성장 정체"로 청구된다 — placed(총 배치 횟수)와
 * lostGold(파괴로 날아간 누적 투자)가 그 값을 계측한다.
 */
import { createBattle } from '@/sim/battle';
import { buildPath } from '@/sim/path';
import { ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import type { BattleSim, StageDef, TowerDef, TowerId } from '@/data/types';

/** 봇 배치 상한 — 지가 상승으로 8기 이후는 업그레이드가 우세 */
export const PLACEMENT_CAP = 8;

/**
 * 근접 습격대가 절대 닿지 못하는 경로 이격 거리.
 * lancer 사거리 1.95가 최대치이고 타워 좌표는 셀 정수이므로 2.0이면 확정 안전이다.
 * (archer 3.2 / hexer 3.6 은 여전히 닿는다 — 원거리는 "거리로 푸는" 위협이 아니다)
 */
export const SAFE_DIST = 2.0;
/** 사거리 r 타워가 경로를 '덮는다'고 볼 최소 여유 — 접점 하나만 스치는 배치 배제 */
const COVER_MARGIN = 0.3;
/** 경로 폴리라인 샘플 간격 (거리장 계산용) */
const PATH_SAMPLE_STEP = 0.05;

export interface BotOptions {
  /** 골드로 소품을 치워 더 좋은 자리를 사는 '불도저' 봇 */
  bulldoze?: boolean;
  /** 경로 밀착 배치 — 습격대 이전 시대의 봇 (안전거리를 모른다) */
  hugPath?: boolean;
  /** 손상 타워가 있어도 웨이브를 즉시 호출 — 예전 봇 (수리를 버린다) */
  alwaysRush?: boolean;
  /** 배치 상한 (기본 PLACEMENT_CAP) */
  cap?: number;
  /** 외곽 루프 반복 상한 (1회 = 120틱) */
  maxIters?: number;
}

export interface BotResult {
  won: boolean;
  wave: number;
  /** 골드로 치운 소품 수 */
  clears: number;
  /** 소품 제거에 쓴 누적 골드 — 불도저 전략의 손익을 파괴 손실과 같은 단위로 잰다 */
  clearGold: number;
  /** 이 판에서 부서진 타워 수 */
  destroyed: number;
  /** 총 배치 횟수 (초기 건설 + 파괴 후 재건설) */
  placed: number;
  /** 파괴된 타워들의 tier 합 — '얼마나 키운 걸 잃었나' */
  lostTiers: number;
  /** 파괴로 날아간 누적 투자 골드 — 죽음의 나선 판정의 핵심 지표 */
  lostGold: number;
  /** 종료 시점 기지 체력 (이겼을 때의 여유 = 승패보다 해상도 높은 난이도 척도) */
  baseHpLeft: number;
  /**
   * 방어선이 다 서고 난 뒤(웨이브 MIN_TOWERS_FROM_WAVE 이후) 관측된 최소 타워 수.
   * 죽음의 나선(부서진 만큼 다시 못 짓고 계속 줄어드는 상태)의 직접 지표다.
   */
  minTowers: number;
}

/**
 * minTowers 계측 시작 웨이브.
 *
 * 10 → 15로 올렸다. 10에서는 봇이 아직 방어선을 **짓는 중**이라(스테이지1 실측에서
 * 웨이브 10의 타워 수가 5~8) 계측값이 "붕괴의 깊이"가 아니라 "건설 진도"를 재게 된다.
 * 그 탓에 `minTowers >= 5` 가드가 구조적으로 무력했다 — 실제로 웨이브 47~49에
 * 18→10으로 무너지는 판에서도 minTowers는 6~8(=웨이브 10의 건설 진도)이었다.
 * 웨이브 15면 배치 상한 8기가 다 서 있어(전 시드 실측 8) 그 뒤의 하락은 전부
 * **파괴를 못 메운 몫**이다. 판별력 실측(습격대 towerAttack.dmg 배율 A/B, 시드 12):
 *   ×1 → 전 시드 8, ×3 → 5~7, ×6 → 0~4. 하한 7이면 ×1은 통과, ×3부터 걸린다.
 */
export const MIN_TOWERS_FROM_WAVE = 15;

export function makeBotSim(
  stageId: number,
  seed: number,
  deck: TowerId[],
  stars = 0,
  endless = false,
): { sim: BattleSim; stage: StageDef } {
  const stage = stageById(stageId);
  if (!stage) throw new Error(`no stage ${stageId}`);
  return { sim: makeBotSimFor(stage, seed, deck, stars, endless), stage };
}

/** 스테이지 객체를 직접 넘기는 형태 — A/B용 변형 스테이지에 쓴다 */
export function makeBotSimFor(
  stage: StageDef,
  seed: number,
  deck: TowerId[],
  stars = 0,
  endless = false,
): BattleSim {
  const starMap: Partial<Record<TowerId, number>> = {};
  for (const id of deck) starMap[id] = stars;
  const sim = createBattle({
    stage,
    stars: starMap,
    deck,
    endless,
    seed,
    towerDefs: TOWER_DEFS,
    enemyDefs: ENEMY_DEFS,
    waveFor: makeWaveFor(stage),
  });
  return sim;
}

/**
 * 셀 중심 → 지상 경로까지의 최단 거리.
 * 래스터 셀이 아니라 **실제 주행 폴리라인**(buildPath, 코너 라운딩 포함)을 촘촘히
 * 샘플링한다 — 안전거리 판정이 1.95 대 2.0 의 0.05 차이를 다투기 때문에
 * 코너에서 안쪽으로 잘리는 실제 경로를 그대로 재야 한다.
 */
function pathDistances(stage: StageDef): Float64Array {
  const xs: number[] = [];
  const zs: number[] = [];
  const p = { x: 0, z: 0, heading: 0 };
  for (const wp of stage.paths) {
    const path = buildPath(wp);
    for (let d = 0; d <= path.totalLength; d += PATH_SAMPLE_STEP) {
      path.sample(d, p);
      xs.push(p.x);
      zs.push(p.z);
    }
    path.sample(path.totalLength, p);
    xs.push(p.x);
    zs.push(p.z);
  }
  const out = new Float64Array(stage.gridW * stage.gridH);
  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      let best = Infinity;
      for (let i = 0; i < xs.length; i++) {
        const dx = (xs[i] as number) - x;
        const dz = (zs[i] as number) - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      out[z * stage.gridW + x] = Math.sqrt(best);
    }
  }
  return out;
}

/** 이 타워는 경로를 덮어야 쓸모가 있는가 (drum 은 아니다 — 아군 버프 오라) */
function needsPathCoverage(def: TowerDef): boolean {
  return def.canTargetGround || def.canTargetAir;
}

/**
 * 배치 후보의 순위 키 (작을수록 좋다).
 * 0번대 = 경로를 덮으면서 근접 사거리 밖 / 1번대 = 덮지만 노출 / 2번대 = 못 덮음.
 * 같은 등급 안에서는 경로에 가까울수록(=커버 길이가 길수록) 낫다.
 */
function placementKey(def: TowerDef, d: number, hugPath: boolean): number {
  if (hugPath) return d; // 예전 봇 — 안전 개념 없음, 무조건 최근접
  if (!needsPathCoverage(def)) {
    // drum: 경로 커버가 무의미하다. 안전한 칸을 고르되 타워 무리와 떨어지지 않게
    // 경로에서 너무 멀어지지도 않는다(오라 반경 2.0 안에 아군이 있어야 한다).
    return (d >= SAFE_DIST ? 0 : 1000) + Math.abs(d - SAFE_DIST);
  }
  const r = def.tiers[0]?.range ?? 2.5;
  const covers = d <= r - COVER_MARGIN;
  if (covers && d >= SAFE_DIST) return d;
  if (covers) return 1000 + d;
  return 2000 + d;
}

/**
 * 봇 1판 실행. 외곽 루프 1회 = 커맨드 한 묶음 + 120틱.
 * 파괴로 타워 수가 줄면 배치 루프가 자동으로 빈 자리를 채운다(= 재건설).
 */
export function runBot(sim: BattleSim, stage: StageDef, opts: BotOptions = {}): BotResult {
  const bulldoze = opts.bulldoze === true;
  const hugPath = opts.hugPath === true;
  const maxIters = opts.maxIters ?? 900;
  const cap = opts.cap ?? PLACEMENT_CAP;
  const dist = pathDistances(stage);
  const cells: [number, number][] = [];
  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      if (sim.canPlaceAt(x, z) || (bulldoze && sim.hasScenery(x, z))) cells.push([x, z]);
    }
  }
  const distOf = ([x, z]: [number, number]): number => dist[z * stage.gridW + x] as number;

  let clears = 0;
  let clearGold = 0;
  let destroyed = 0;
  let placed = 0;
  let lostTiers = 0;
  let lostGold = 0;
  let minTowers = Infinity;
  /** 틱 진행 직전 스냅샷 — 파괴 이벤트에는 invested가 없으므로 여기서 조회한다 */
  const investedById = new Map<number, number>();

  /**
   * 이 카드로 지금 지을 최적의 빈 칸. 불도저 봇은 더 좋은 등급의 소품 칸을 만나면
   * (제거비 + 배치비)를 감당할 수 있는 한 골드를 내고 산다.
   */
  const pickCell = (towerId: TowerId, placeCost: number): [number, number] | undefined => {
    const def = TOWER_DEFS[towerId];
    let bestFree: [number, number] | undefined;
    let bestFreeKey = Infinity;
    let bestBuy: [number, number] | undefined;
    let bestBuyKey = Infinity;
    for (const c of cells) {
      const key = placementKey(def, distOf(c), hugPath);
      if (sim.canPlaceAt(c[0], c[1])) {
        if (key < bestFreeKey) {
          bestFreeKey = key;
          bestFree = c;
        }
      } else if (bulldoze && key < bestBuyKey) {
        const clear = sim.clearSceneryCost(c[0], c[1]);
        if (clear !== null && sim.state.gold >= clear + placeCost) {
          bestBuyKey = key;
          bestBuy = c;
        }
      }
    }
    // 소품을 치워서 얻는 자리가 **더 좋을 때만** 산다 (같거나 나쁘면 낭비)
    if (bestBuy && bestBuyKey < bestFreeKey) {
      const paid = sim.clearSceneryCost(bestBuy[0], bestBuy[1]) ?? 0;
      if (sim.applyCommand({ type: 'clearScenery', cellX: bestBuy[0], cellZ: bestBuy[1] })) {
        clears++;
        clearGold += paid;
        return bestBuy;
      }
    }
    return bestFree;
  };

  const tryPlace = (goldFactor: number): void => {
    const st = sim.state;
    for (let h = 0; h < st.hand.length; h++) {
      const card = st.hand[h];
      if (!card || st.gold < card.cost * goldFactor) continue;
      const cell = pickCell(card.towerId, card.cost);
      if (!cell) break;
      if (sim.applyCommand({ type: 'placeTower', handIndex: h, cellX: cell[0], cellZ: cell[1] })) {
        placed++;
      }
      break;
    }
  };

  let guard = 0;
  while (sim.state.phase !== 'won' && sim.state.phase !== 'lost' && guard < maxIters) {
    guard++;
    const st = sim.state;
    if (st.towers.length < cap) tryPlace(1);
    // 최다투자 타워 집중 업그레이드 (소수 정예)
    let best: { id: number; inv: number } | null = null;
    for (const t of st.towers) {
      const c = sim.upgradeCost(t.id);
      if (c !== null && st.gold >= c && (!best || t.invested > best.inv)) {
        best = { id: t.id, inv: t.invested };
      }
    }
    if (best) sim.applyCommand({ type: 'upgradeTower', towerId: best.id });
    else if (st.towers.length >= cap) tryPlace(1.5);
    // 조기 호출: 성한 타워만 있을 때만 (손상 중이면 준비 시간을 수리로 쓴다)
    if (st.phase === 'prep' && st.prepTicksLeft > 0) {
      const damaged = opts.alwaysRush !== true && st.towers.some((t) => t.hp < t.maxHp);
      if (!damaged) sim.applyCommand({ type: 'callWave' });
    }
    investedById.clear();
    for (const t of st.towers) investedById.set(t.id, t.invested);
    for (let i = 0; i < 120; i++) {
      sim.tick();
      const s = sim.state;
      if (s.phase === 'wave' && s.waveIndex >= MIN_TOWERS_FROM_WAVE && s.towers.length < minTowers) {
        minTowers = s.towers.length;
      }
    }
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'towerDestroyed') {
        destroyed++;
        lostTiers += ev.tier;
        lostGold += investedById.get(ev.towerId) ?? 0;
      }
    }
  }
  return {
    won: sim.state.phase === 'won',
    wave: sim.state.waveIndex,
    clears,
    clearGold,
    destroyed,
    placed,
    lostTiers,
    lostGold,
    baseHpLeft: sim.state.baseHp,
    minTowers: minTowers === Infinity ? 0 : minTowers,
  };
}
