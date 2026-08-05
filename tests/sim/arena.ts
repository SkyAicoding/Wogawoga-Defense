/**
 * 습격대 전용 통제 실험장 — "어떤 타워가 부족 습격대의 답인가"를 격리해서 잰다.
 *
 * 전체 스테이지 자동플레이(autoplay.test.ts)는 웨이브 구성·경제·경로 형태가 전부 섞여
 * 있어 "얼음이 습격대에 유효한가" 같은 질문에 답할 수 없다. 여기서는 그 변수를 없앤다:
 * 직선 경로 하나, 소품 없음, 골드 무제한, 웨이브 하나, 타워는 **같은 골드**만큼만 짓는다.
 * 남는 변수는 (타워 종류 × 습격대 종류 × 경로 이격 거리) 셋뿐이다.
 *
 * 경로는 z = PATH_Z 를 따라 x축으로 곧게 가고, 타워는 z = PATH_Z − dist 에 일렬로 선다.
 * 타워 좌표가 셀 정수라 dist 가 곧 사거리 판정 거리다 (siege 는 셀 좌표로 잰다).
 */
import { createBattle } from '@/sim/battle';
import { ALLY_DEFS, ENEMY_DEFS, TOWER_DEFS } from '@/data';
import type {
  BaseLevelDef,
  BattleSim,
  EnemyId,
  SpawnGroup,
  StageDef,
  TowerId,
  WaveDef,
} from '@/data/types';

/**
 * 이 실험장의 기지는 **쏘지 않는다** (dmg 0 = 무장 해제).
 * 여기서 재는 것은 "타워와 습격대의 교환비" 하나뿐인데, 기지가 경로 끝(x=23)에서
 * 사격하면 살아 넘어간 습격대를 기지가 정리해 버려 타워의 몫과 기지의 몫이 섞인다.
 * 홈타운 방어의 효과는 그것을 재는 자리에서 따로 잰다(tests/sim/hometown.test.ts).
 */
const ARENA_BASE_LEVELS: readonly BaseLevelDef[] = [
  { cost: 0, hpMul: 1, dmg: 0, cooldownTicks: 30, range: 0 },
];

const GRID_W = 24;
const GRID_H = 11;
/** 경로가 지나는 행 */
export const PATH_Z = 6;
/** 첫 타워의 x 좌표 (이후 spacing 간격으로 늘어선다) */
const TOWER_X0 = 4;
/** 기본 배치 간격 — 4면 사거리가 거의 겹치지 않아 타워끼리 독립적으로 잰다 */
const DEFAULT_SPACING = 4;

function arenaStage(): StageDef {
  return {
    id: 91,
    nameKey: 'arena',
    biome: 'grassland',
    gridW: GRID_W,
    gridH: GRID_H,
    layout: Array.from({ length: GRID_H }, () => '.'.repeat(GRID_W)),
    paths: [[{ x: 0, z: PATH_Z }, { x: GRID_W - 1, z: PATH_Z }]],
    baseCell: { x: GRID_W - 1, z: PATH_Z },
    // 기지는 사실상 무적 — 여기서 재는 건 기지 방어가 아니라 타워와 습격대의 교환비다
    baseHp: 100_000,
    startGold: 1_000_000,
    waveCount: 1,
    wavePlan: {
      budgetBase: 1,
      budgetGrowth: 1,
      hpBase: 1,
      hpGrowth: 1,
      seed: 1,
      allowedEnemies: ['blade'],
      bossOverrides: {},
    },
    firstClearAmber: 0,
    perWaveAmber: 0,
  };
}

export interface ArenaResult {
  /** 이 습격대에서 죽은 마릿수 */
  killed: number;
  /** 스폰된 총 마릿수 */
  total: number;
  /** 타워가 받은 총 피해 */
  towerDamage: number;
  /** 부서진 타워 수 */
  towersLost: number;
  /** 실제로 투자한 골드 (배치 + 업그레이드) */
  invested: number;
  /** 웨이브가 끝난 틱 (전멸 또는 전원 누수) */
  ticks: number;
  /** 관측된 타워 피격 1회 최소/최대 피해 (감속이 한 방의 위력을 깎는지 확인용). 피격 없으면 0 */
  minHit: number;
  maxHit: number;
}

export interface ArenaOptions {
  /** 방어 타워 종류 (여러 종을 섞으면 순환 배치) */
  towers: TowerId[];
  /** 습격대 편성 */
  pack: { id: EnemyId; count: number }[];
  /** 경로에서 타워까지의 거리(셀). 2 이상이면 근접(칼 1.5 / 창 1.95)이 닿지 않는다 */
  dist: number;
  /** 방어에 쓸 총 골드 예산 — 종류가 달라도 같은 값으로 맞춰 비교한다 */
  gold: number;
  /** 타워 기수 (기본 4) */
  count?: number;
  /**
   * 타워 사이 x 간격(셀). 기본 4는 사거리가 겹치지 않아 종별 성능을 독립적으로 잰다.
   * 2로 좁히면 사거리가 겹쳐 **보조 타워(얼음·북)의 시너지**를 잴 수 있다 —
   * 근접 습격대는 맨 앞 타워에 붙어 멈추므로, 얼음이 그 자리에 사거리를 뻗지 못하면
   * 아무 일도 일어나지 않는다(간격 4에서 실제로 그랬다).
   */
  spacing?: number;
  /** 개체 HP 배율 */
  hpMul?: number;
  maxTicks?: number;
}

/** 같은 골드 예산 안에서 배치 → 최저투자 타워부터 균등 업그레이드 */
function buildDefense(sim: BattleSim, opts: ArenaOptions): number {
  const n = opts.count ?? 4;
  const z = PATH_Z - opts.dist;
  let spent = 0;
  for (let i = 0; i < n; i++) {
    const x = TOWER_X0 + i * (opts.spacing ?? DEFAULT_SPACING);
    const want = opts.towers[i % opts.towers.length] as TowerId;
    // 핸드는 덱에서 무작위로 3장이라 원하는 카드가 없을 수 있다 — 나올 때까지 새로고침한다.
    // (새로고침 비용은 spent에 넣지 않는다: 실험장의 관심사는 '방어에 넣은 골드'뿐이고
    //  덱 크기가 같은 변종끼리 비교하므로 기대값도 같다)
    let h = sim.state.hand.findIndex((c) => c.towerId === want);
    for (let guard = 0; h < 0 && guard < 20; guard++) {
      if (!sim.applyCommand({ type: 'refreshHand' })) break;
      h = sim.state.hand.findIndex((c) => c.towerId === want);
    }
    if (h < 0) throw new Error(`hand에 ${want} 없음 (deck 확인)`);
    const cost = (sim.state.hand[h] as { cost: number }).cost;
    if (spent + cost > opts.gold) break;
    // 소품은 시드 고정으로 흩뿌려진다 — 실험장에서는 방해 변수라 치우고 시작한다.
    // (제거 비용은 spent에 넣지 않는다: 모든 변종이 같은 칸을 쓰므로 비교에 영향이 없다)
    if (sim.hasScenery(x, z)) sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z });
    if (!sim.applyCommand({ type: 'placeTower', handIndex: h, cellX: x, cellZ: z })) {
      throw new Error(`배치 실패 (${x},${z})`);
    }
    spent += cost;
  }
  // 예산이 남는 동안 가장 덜 자란 타워부터 올린다 (한 기 몰빵이 아니라 균등 성장)
  for (;;) {
    let best: { id: number; inv: number; cost: number } | null = null;
    for (const t of sim.state.towers) {
      const c = sim.upgradeCost(t.id);
      if (c === null || spent + c > opts.gold) continue;
      if (!best || t.invested < best.inv) best = { id: t.id, inv: t.invested, cost: c };
    }
    if (!best) break;
    sim.applyCommand({ type: 'upgradeTower', towerId: best.id });
    spent += best.cost;
  }
  return spent;
}

/** 통제 실험 1회 — 방어를 세우고 습격대 한 무리를 흘려보낸 결과 */
export function runArena(opts: ArenaOptions): ArenaResult {
  const stage = arenaStage();
  const groups: SpawnGroup[] = opts.pack.map((p) => ({
    enemyId: p.id,
    count: p.count,
    intervalTicks: 7, // raid 편성과 같은 촘촘한 간격 (한 덩어리로 몰려온다)
    delayTicks: 0,
    pathIndex: 0,
    hpMul: opts.hpMul ?? 1,
  }));
  const wave: WaveDef = { groups, goldReward: 0 };
  const deck = [...new Set(opts.towers)];
  const stars: Partial<Record<TowerId, number>> = {};
  for (const id of deck) stars[id] = 0;
  const sim = createBattle({
    stage,
    stars,
    deck,
    endless: false,
    seed: 4242,
    towerDefs: TOWER_DEFS,
    enemyDefs: ENEMY_DEFS,
    allyDefs: ALLY_DEFS,
    baseLevels: ARENA_BASE_LEVELS,
    waveFor: () => wave,
  });
  const invested = buildDefense(sim, opts);
  sim.applyCommand({ type: 'callWave' });

  let killed = 0;
  let towerDamage = 0;
  let towersLost = 0;
  let minHit = Infinity;
  let maxHit = 0;
  const total = opts.pack.reduce((a, p) => a + p.count, 0);
  const maxTicks = opts.maxTicks ?? 3600;
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    sim.tick();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'enemyDied') killed++;
      else if (ev.type === 'towerDamaged') {
        towerDamage += ev.amount;
        if (ev.amount < minHit) minHit = ev.amount;
        if (ev.amount > maxHit) maxHit = ev.amount;
      }
      else if (ev.type === 'towerDestroyed') towersLost++;
    }
    if (sim.state.phase !== 'wave' && ticks > 30) break; // 웨이브 종료(전멸 또는 전원 누수)
  }
  return {
    killed, total, towerDamage, towersLost, invested, ticks,
    minHit: minHit === Infinity ? 0 : minHit,
    maxHit,
  };
}
