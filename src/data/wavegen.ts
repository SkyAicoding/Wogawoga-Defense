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
import { BOUNTY_PER_COST, ENEMY_DEFS } from './enemies';
import {
  ELITE_HP_BONUS,
  GROUP_MAX_COUNT,
  HP_CORR_MAX,
  HP_CORR_MIN,
  WAVE_GOLD_BASE,
  WAVE_GOLD_PER_WAVE,
  WAVE_MAX_SPAWNS,
} from './balance';

type Template = 'swarm' | 'tank_escort' | 'air_raid' | 'mixed' | 'elite' | 'raid';

// 역할 풀 — allowedEnemies와 교집합해서 사용
const SWARMERS: readonly EnemyId[] = ['compy', 'raptor'];
const TANKS: readonly EnemyId[] = ['trike', 'ankylo', 'mammoth', 'golem'];
const MIDS: readonly EnemyId[] = ['raptor', 'boar', 'warrior', 'shaman'];
/**
 * 부족 습격대 — 'raid' 템플릿 전용 풀. 전위(근접)가 먼저 쏟아지고 후위(원거리)가 뒤따른다.
 * 다른 템플릿에도 섞여 나오긴 한다(genMixed는 allowed 전체에서 뽑는다) —
 * raid는 그중에서 **무리로 몰려오는 형태**를 보장하는 편성이다.
 */
const RAID_FRONT: readonly EnemyId[] = ['blade', 'lancer'];
const RAID_BACK: readonly EnemyId[] = ['archer', 'hexer'];
/** 습격대 편성이 처음 등장하는 웨이브 (그 전에는 타워가 아직 한두 기뿐이라 학살이 된다) */
const RAID_FROM_WAVE = 8;
/** 습격대 빈도가 2배가 되는 웨이브 — 후반의 주된 위협축이 된다 */
const RAID_FREQUENT_WAVE = 15;
/**
 * 습격대 **최소 인원** — 무리의 정체성을 데이터로 보장한다.
 *
 * 이게 없으면 예산이 작은 초반 raid 웨이브가 `floor(share/cost)` → 0 → 1 로 떨어져
 * "투창병 1명 + 투창병 1명"이 나온다. 그건 무리가 아니라 낙오병이고, 습격대 템플릿이
 * mixed 와 구분되지 않는다 (실측: 예전 스테이지2 w6 = blade×1 + blade×1).
 *
 * 예산이 모자랄 때 마릿수를 줄이는 대신 **개체를 약하게** 만든다 —
 * normalize() 가 웨이브 총 HP를 목표 곡선에 맞추므로(HP_CORR_MIN 0.25까지 흡수)
 * 초반 습격대는 "약한 부족민이 떼로 몰려온다"가 되고 총 HP는 곡선 위에 그대로 남는다.
 * 마릿수가 아니라 개체 HP 를 깎는 쪽이 습격대의 정체성을 지키는 유일한 방향이다.
 *
 * 단, 타워에 넣는 피해는 HP 곡선 밖의 축이라 인원수에 비례해 커진다 —
 * 그래서 등장 웨이브를 6 → 8 로 늦췄다(타워 3~4기가 서는 시점).
 *
 * **보상도 같이 눌러야 한다** — 마릿수만 늘리고 보상을 그대로 두면 총 HP는 그대로인데
 * 골드만 마릿수에 비례해 부푼다(실측: 스테이지1 w12에서 총 HP 503 동일에 보상 138 대 16).
 * 그 몫은 capBounty()가 걷어낸다. 두 장치는 한 쌍이다: min이 머릿수를 지키고,
 * capBounty가 "약해진 개체는 값도 싸다"를 강제한다.
 */
const RAID_MIN_FRONT = 3;
const RAID_MIN_BACK = 2;

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

/**
 * 예산 share만큼 해당 적 그룹 추가. count = floor(share / (cost × hpBonus)), min~캡 클램프.
 * min(기본 1)은 습격대처럼 **마릿수 자체가 정체성**인 편성이 예산 부족으로 흩어지지 않게 한다.
 */
function push(
  g: Gen,
  id: EnemyId,
  share: number,
  interval: number,
  delay: number,
  hpBonus: number,
  min = 1,
): void {
  const def = ENEMY_DEFS[id];
  let count = Math.floor(share / (def.cost * hpBonus));
  if (count < min) count = min;
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
  if (wave >= RAID_FROM_WAVE && inter(RAID_FRONT, allowed).length > 0) {
    c.push('raid');
    if (wave >= RAID_FREQUENT_WAVE) c.push('raid');
  }
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

/**
 * 습격대 — 부족이 **무리지어** 타워를 부수러 온다.
 * 형태 규칙(다른 템플릿과 눈으로 구분되어야 한다):
 *  · 전위(칼·창) 2무리를 간격 5~9틱(0.17~0.3초)으로 쏟아붓는다 — 한 덩어리로 몰려 보인다.
 *    간격을 mixed(10~26)보다 확실히 좁힌 게 "무리"의 시각적 정체성이다.
 *  · 후위(궁수·주술사) 1무리는 70~110틱 늦게 출발해 전위 뒤를 따라온다.
 *    걸으면서 쏘는 종이라 뒤에서 갉고, 전위가 붙어서 두들긴다는 역할 분담이 보인다.
 *  · 후위 풀이 비어 있는(=아직 궁수/주술사가 해금되지 않은) 스테이지에서는
 *    예산 전부가 전위로 간다 — 초반 스테이지는 순수 돌격대가 된다.
 */
function genRaid(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const front = inter(RAID_FRONT, allowed);
  const back = inter(RAID_BACK, allowed);
  const frontShare = back.length > 0 ? 0.62 : 1;
  const lead = g.rng.int(20, 45);
  for (let i = 0; i < 2; i++) {
    const share = (budget * frontShare) / 2;
    push(g, pickAffordable(g.rng, front, share), share, g.rng.int(5, 9), i * lead, 1, RAID_MIN_FRONT);
  }
  if (back.length > 0) {
    const share = budget * (1 - frontShare);
    push(g, pickAffordable(g.rng, back, share), share, g.rng.int(8, 14), g.rng.int(70, 110), 1, RAID_MIN_BACK);
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

/**
 * allowedEnemies의 평균 hp/cost — 총 HP 목표 곡선의 계수.
 *
 * **타워를 때리는 종(towerAttack)은 평균에서 제외한다.** 이들의 cost에는 체력이 아니라
 * 타워 파괴력의 값이 들어 있어(enemies.ts 참조) hp/cost가 구조적으로 낮다.
 * 그대로 평균에 넣으면 습격대를 허용하는 것만으로 그 스테이지의 **모든 웨이브**
 * (습격대가 한 마리도 없는 웨이브까지) 목표 총 HP가 내려간다 —
 * 실측: 스테이지1에 blade+archer를 허용하면 계수가 6.79 → 5.73(-16%)로 떨어져,
 * 습격대 추가가 난이도를 '더하는' 대신 '맞바꾸는' 결과가 됐다.
 * 제외하면 습격대는 기존 HP 곡선 위에 타워 압박을 **순증**시킨다.
 *
 * 전원이 타워 공격자인 스테이지는 없지만, 그런 경우에는 전체 평균으로 폴백한다.
 */
function refHpPerCost(allowed: readonly EnemyId[]): number {
  const base = allowed.filter((id) => ENEMY_DEFS[id].towerAttack === undefined);
  const pool = base.length > 0 ? base : allowed;
  let sum = 0;
  for (const id of pool) {
    const d = ENEMY_DEFS[id];
    sum += d.hp / d.cost;
  }
  return pool.length > 0 ? sum / pool.length : 6;
}

/** allowedEnemies의 평균 cost — 스폰 캡으로 실제 소비 가능한 예산 상한 계산용 */
function avgCost(allowed: readonly EnemyId[]): number {
  let sum = 0;
  for (const id of allowed) sum += ENEMY_DEFS[id].cost;
  return allowed.length > 0 ? sum / allowed.length : 20;
}

/**
 * 웨이브 처치 보상 상한 — **예산이 산 것보다 많은 골드를 주지 않는다**.
 *
 * 이 게임의 경제 계약은 `bounty = round(cost × BOUNTY_PER_COST)` 하나이고,
 * 그룹 마릿수가 `floor(share / cost)` 인 한 웨이브 총 보상은 자동으로
 * `Σ 0.8 × cost × count ≤ 0.8 × Σ share = 0.8 × budget` 이하로 유지된다.
 * 즉 **정상 편성에서는 이 상한이 절대 물리지 않는다** (floor 때문에 항상 미만이다).
 *
 * 물리는 경우는 하나뿐 — `push(min=…)` 이 예산을 무시하고 마릿수를 올릴 때다.
 * 습격대(genRaid)는 "무리"가 정체성이라 예산이 모자라도 최소 인원을 채우는데,
 * 그러면 **총 HP는 normalize()가 곡선으로 되돌리는 반면 보상만 마릿수에 비례해 부푼다**.
 * 실측(스테이지1, 3단계 시점): w12는 습격대 유/무의 총 HP가 503으로 동일한데
 * 보상이 138 대 16(8.6배)이었고, w1~50 총계로도 총 HP +1.3%에 총수입 +18.7%였다.
 * 그 결과 습격대를 **넣으면 게임이 쉬워지는** 역전이 났다(봇 24시드 17승 대 15승).
 *
 * 그래서 상한만 건다(끌어올리지 않는다):
 *  · 정상 편성은 값이 1바이트도 바뀌지 않는다 — 회귀 위험이 없다.
 *  · 최소 인원으로 늘어난 개체는 normalize()가 HP를 깎은 만큼 값도 싸진다
 *    ("약한 부족민이 떼로" = 머릿수는 무리지만 한 명 한 명은 값이 헐하다).
 *  · 보스 오버라이드 웨이브는 이 경로를 타지 않는다(클라이맥스 보상은 수동 설계다).
 */
function capBounty(groups: SpawnGroup[], budget: number): void {
  let raw = 0;
  for (const sg of groups) raw += ENEMY_DEFS[sg.enemyId].bounty * sg.count;
  const target = budget * BOUNTY_PER_COST;
  if (raw <= target || raw <= 0) return;
  const mul = round3(target / raw);
  for (const sg of groups) sg.bountyMul = mul;
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
    else if (template === 'raid') genRaid(g, budget, allowed);
    else genMixed(g, budget, allowed);

    // 안전망 — 어떤 경우에도 빈 웨이브 금지
    if (g.groups.length === 0) {
      const id = allowed.length > 0 ? (allowed[0] as EnemyId) : 'raptor';
      g.groups.push({ enemyId: id, count: 1, intervalTicks: 15, delayTicks: 0, pathIndex: 0, hpMul });
    }

    normalize(g.groups, budget * ref * hpMul);
    // 총 HP를 곡선에 맞춘 뒤 보상도 예산 상한 안으로 되돌린다 (순서 무관 — 서로 독립)
    capBounty(g.groups, budget);

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
