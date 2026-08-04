/**
 * 웨이브 생성기 — 순수·결정론적: 같은 (stage, wave) → 항상 deepEqual 결과.
 * 웨이브마다 fresh Rng(seed + wave)를 만들므로 호출 순서/횟수와 무관하다.
 *
 * 난이도 곡선: 예산 B = budgetBase × budgetGrowth^(wave-1), hpMul = hpBase × hpGrowth^(wave-1).
 * 템플릿(swarm/tank_escort/air_raid/mixed/elite)으로 그룹을 구성한 뒤, 웨이브 총 HP를
 * 목표 곡선(유효예산 × 평균 hp/cost × hpMul)에 정규화해 총 HP가 웨이브 단조 증가함을 보장한다.
 * 유효예산 = min(B, WAVE_MAX_SPAWNS × 평균 cost) — 스폰 캡이 물리는 후반 웨이브는
 * 성장이 hpGrowth로만 제한되어 트래시 웨이브가 보스 웨이브를 추월하지 않는다.
 *
 * 보스 규칙: bossOverrides[wave]가 있으면 우선. 오버라이드 그룹의 hpMul은 "웨이브 배율에
 * 대한 상대값"이며 여기서 웨이브 hpMul을 곱해 절대값으로 변환한다. waveCount(50) 초과의
 * endless 10배수 웨이브는 오버라이드가 없으므로 보스(spino/50배수는 trex)를 자동 주입한다.
 */
import { Rng } from '@/core/rng';
import type { EnemyId, SpawnGroup, StageDef, WaveDef } from './types';
import { ENEMY_DEFS } from './enemies';
import {
  ELITE_HP_BONUS,
  GROUP_MAX_COUNT,
  HP_CORR_MAX,
  HP_CORR_MIN,
  WAVE_GOLD_BASE,
  WAVE_GOLD_PER_WAVE,
  WAVE_MAX_SPAWNS,
} from './balance';

type Template = 'swarm' | 'tank_escort' | 'air_raid' | 'mixed' | 'elite';

// 역할 풀 — allowedEnemies와 교집합해서 사용
const SWARMERS: readonly EnemyId[] = ['compy', 'raptor'];
const TANKS: readonly EnemyId[] = ['trike', 'ankylo', 'mammoth', 'golem'];
const MIDS: readonly EnemyId[] = ['raptor', 'boar', 'warrior', 'shaman'];

function inter(pool: readonly EnemyId[], allowed: readonly EnemyId[]): EnemyId[] {
  return pool.filter((id) => allowed.includes(id));
}

/** hpMul은 3자리 반올림 — 세이브/로그 가독성용 (결정론에는 영향 없음) */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 예산 내 선택 가능(비용 ≤ maxCost) 우선, 전부 비싸면 풀에서 최저가 확정 선택 */
function pickAffordable(rng: Rng, pool: readonly EnemyId[], maxCost: number): EnemyId {
  const ok = pool.filter((id) => ENEMY_DEFS[id].cost <= maxCost);
  if (ok.length > 0) return rng.pick(ok);
  let best = pool[0] as EnemyId;
  for (const id of pool) if (ENEMY_DEFS[id].cost < ENEMY_DEFS[best].cost) best = id;
  return best;
}

interface Gen {
  rng: Rng;
  groups: SpawnGroup[];
  hpMul: number;
  groundLanes: number;
  airLanes: number;
  spawnsLeft: number;
}

/** 예산 share만큼 해당 적 그룹 추가. count = floor(share / (cost × hpBonus)), 1~캡 클램프 */
function push(g: Gen, id: EnemyId, share: number, interval: number, delay: number, hpBonus: number): void {
  const def = ENEMY_DEFS[id];
  let count = Math.floor(share / (def.cost * hpBonus));
  if (count < 1) count = 1;
  if (count > GROUP_MAX_COUNT) count = GROUP_MAX_COUNT;
  if (count > g.spawnsLeft) count = g.spawnsLeft;
  if (count < 1) return; // 스폰 캡 소진
  g.spawnsLeft -= count;
  const lanes = def.flying ? g.airLanes : g.groundLanes;
  g.groups.push({
    enemyId: id,
    count,
    intervalTicks: interval,
    delayTicks: delay,
    pathIndex: lanes > 1 ? g.rng.int(0, lanes - 1) : 0,
    hpMul: g.hpMul * hpBonus,
  });
}

function chooseTemplate(rng: Rng, wave: number, allowed: readonly EnemyId[]): Template {
  if (wave <= 2) return 'swarm'; // 초반 온보딩 — 약한 스웜만
  const c: Template[] = ['mixed', 'mixed', 'swarm']; // mixed 가중 2배 (HP 분산 완화)
  if (wave >= 4 && inter(TANKS, allowed).length > 0) c.push('tank_escort');
  if (wave >= 5 && allowed.includes('ptera')) c.push('air_raid');
  if (wave >= 12) c.push('elite');
  return rng.pick(c);
}

function genSwarm(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const pool = inter(SWARMERS, allowed);
  const n = budget >= 60 ? 3 : 2;
  const gap = g.rng.int(40, 80);
  for (let i = 0; i < n; i++) {
    push(g, pickAffordable(g.rng, pool, budget / n), budget / n, g.rng.int(6, 12), i * gap, 1);
  }
}

function genTankEscort(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const tanks = inter(TANKS, allowed);
  push(g, pickAffordable(g.rng, tanks, budget * 0.55), budget * 0.55, g.rng.int(50, 80), g.rng.int(0, 30), 1);
  const escorts = inter([...SWARMERS, ...MIDS], allowed);
  for (let i = 0; i < 2; i++) {
    push(g, pickAffordable(g.rng, escorts, budget * 0.225), budget * 0.225, g.rng.int(12, 20), g.rng.int(60, 140), 1);
  }
}

function genAirRaid(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  push(g, 'ptera', budget * 0.55, g.rng.int(14, 22), g.rng.int(0, 40), 1);
  const ground = inter([...SWARMERS, ...MIDS], allowed);
  push(g, pickAffordable(g.rng, ground, budget * 0.45), budget * 0.45, g.rng.int(12, 24), g.rng.int(60, 120), 1);
}

function genMixed(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const gap = g.rng.int(35, 70);
  for (let i = 0; i < 3; i++) {
    push(g, pickAffordable(g.rng, allowed, budget / 3), budget / 3, g.rng.int(10, 26), i * gap, 1);
  }
}

function genElite(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const pool = inter([...TANKS, ...MIDS], allowed);
  const gap = g.rng.int(50, 90);
  for (let i = 0; i < 2; i++) {
    const share = budget / 2;
    push(g, pickAffordable(g.rng, pool, share / ELITE_HP_BONUS), share, g.rng.int(30, 50), i * gap, ELITE_HP_BONUS);
  }
}

/** allowedEnemies의 평균 hp/cost — 총 HP 목표 곡선의 계수 */
function refHpPerCost(allowed: readonly EnemyId[]): number {
  let sum = 0;
  for (const id of allowed) {
    const d = ENEMY_DEFS[id];
    sum += d.hp / d.cost;
  }
  return allowed.length > 0 ? sum / allowed.length : 6;
}

/** allowedEnemies의 평균 cost — 스폰 캡으로 실제 소비 가능한 예산 상한 계산용 */
function avgCost(allowed: readonly EnemyId[]): number {
  let sum = 0;
  for (const id of allowed) sum += ENEMY_DEFS[id].cost;
  return allowed.length > 0 ? sum / allowed.length : 20;
}

/** 웨이브 총 HP를 목표값으로 정규화 — 그룹 hpMul에 보정 배율(클램프) 적용 */
function normalize(groups: SpawnGroup[], targetHp: number): void {
  let raw = 0;
  for (const sg of groups) raw += ENEMY_DEFS[sg.enemyId].hp * sg.count * sg.hpMul;
  if (raw <= 0) return;
  let corr = targetHp / raw;
  if (corr < HP_CORR_MIN) corr = HP_CORR_MIN;
  if (corr > HP_CORR_MAX) corr = HP_CORR_MAX;
  for (const sg of groups) sg.hpMul = round3(sg.hpMul * corr);
}

export function makeWaveFor(stage: StageDef): (wave: number) => WaveDef {
  const plan = stage.wavePlan;
  const groundLanes = stage.paths.length;
  // 공중 레인: airPaths가 없으면 sim이 paths[i] 직선화를 쓰므로 레인 수는 paths와 동일
  const airLanes = stage.airPaths && stage.airPaths.length > 0 ? stage.airPaths.length : groundLanes;
  const ref = refHpPerCost(plan.allowedEnemies);
  // 스폰 캡 하에서 소비 가능한 최대 예산 — 목표 HP 곡선의 상한
  const maxSpend = WAVE_MAX_SPAWNS * avgCost(plan.allowedEnemies);

  return (wave: number): WaveDef => {
    const hpMul = plan.hpBase * plan.hpGrowth ** (wave - 1);
    const goldReward = WAVE_GOLD_BASE + wave * WAVE_GOLD_PER_WAVE;

    const override = plan.bossOverrides[wave];
    if (override) {
      // 오버라이드 hpMul(상대값) × 웨이브 hpMul = 절대 배율
      return {
        groups: override.groups.map((sg) => ({ ...sg, hpMul: round3(sg.hpMul * hpMul) })),
        goldReward,
      };
    }

    const rng = new Rng((plan.seed + wave) >>> 0);
    // min(예산 곡선, 캡 소비 한계) — 두 단조 증가 곡선의 min이라 목표 HP도 단조 증가
    const budget = Math.min(plan.budgetBase * plan.budgetGrowth ** (wave - 1), maxSpend);
    const g: Gen = { rng, groups: [], hpMul, groundLanes, airLanes, spawnsLeft: WAVE_MAX_SPAWNS };
    const allowed = plan.allowedEnemies;
    const template = chooseTemplate(rng, wave, allowed);
    if (template === 'swarm') genSwarm(g, budget, allowed);
    else if (template === 'tank_escort') genTankEscort(g, budget, allowed);
    else if (template === 'air_raid') genAirRaid(g, budget, allowed);
    else if (template === 'elite') genElite(g, budget, allowed);
    else genMixed(g, budget, allowed);

    // 안전망 — 어떤 경우에도 빈 웨이브 금지
    if (g.groups.length === 0) {
      const id = allowed.length > 0 ? (allowed[0] as EnemyId) : 'raptor';
      g.groups.push({ enemyId: id, count: 1, intervalTicks: 15, delayTicks: 0, pathIndex: 0, hpMul });
    }

    normalize(g.groups, budget * ref * hpMul);

    // endless(waveCount 초과) 10배수 웨이브 — 오버라이드가 없으므로 보스 자동 주입
    if (wave % 10 === 0) {
      g.groups.unshift({
        enemyId: wave % 50 === 0 ? 'trex' : 'spino',
        count: 1,
        intervalTicks: 90,
        delayTicks: 30,
        pathIndex: 0,
        hpMul: round3(hpMul),
      });
    }

    return { groups: g.groups, goldReward };
  };
}
