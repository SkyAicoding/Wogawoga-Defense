/**
 * 자동플레이 밸런스 하네스 — 난이도 봉투를 CI에 고정한다.
 * 봇 구현과 "봇이 왜 이렇게 두는가"의 근거는 tests/sim/botharness.ts 헤더에 있다.
 *
 * ── 4단계 개정: 시드 5개 표본을 버렸다 ──────────────────────────────────────
 * 이전 봉투는 시드 5개(101/202/303/404/505)로 "전부 클리어 = 초심자 완주 보장"을
 * 주장했다. **그 표본이 편향돼 있었다** — 같은 봇·같은 덱으로 신선한 시드 40개를
 * 돌리면 30/40(75%)이었고, 스테이지1의 웨이브 편성은 시드와 무관하게 완전 고정이므로
 * (makeWaveFor가 stage.wavePlan.seed만 쓴다) 그 25%는 웨이브 운이 아니라 **핸드 드로우
 * 운**이다. 5개짜리 표본으로는 그 분산을 볼 수 없다.
 *
 * 그래서 이 파일의 모든 스윕은 **1000 + 37i (i=0..19)** 라는 고정 등차수열 20개를 쓴다.
 * 값을 고를 여지가 없는 수열이라 "통과하는 시드를 골랐다"가 불가능하고, 20개면
 * 승수 1 차이(=5%p)까지 잡힌다. 실행 시간은 스윕 1회 ≈ 2초다.
 *
 * ── 항목별로 무엇을 잠그는가 ────────────────────────────────────────────────
 *  1) 완주 가능성 — 클리어 13/20 이상 + 전 시드 웨이브 40 이상 도달 (실측 15/20, 최소 42)
 *  2) 습격대가 실제로 값을 청구한다 — 파괴 합계 하한 (실측 177기)
 *  3) 죽음의 나선 금지 — **웨이브 15 이후** 타워 수 하한 (실측 전 시드 8, 상한선=배치상한)
 *     웨이브 10부터 재던 예전 지표는 '건설 진도'를 재고 있어 구조적으로 무력했다
 *     (botharness.MIN_TOWERS_FROM_WAVE 주석에 판별력 실측 있음)
 *  4) 배치 거리 = 실력 축 — 경로 밀착 봇은 클리어 0
 *  5) 방치(타워 0)는 웨이브 10 안에 패배 / 스테이지6 별0은 클리어 불가 (난이도 서열)
 *  6) 지형 개조가 지배 전략이 아니다 — 승수 우위 ≤ 1, 여유(기지HP)도 앞서지 않는다
 *  7) **골드 배분 네 갈래**(4단계) — 적정 배분은 기준선 근처, 몰빵은 붕괴
 *     + 5단계 보강: 어느 갈래도 **승수와 여유를 동시에** 이기지 못한다(불도저와 같은 잣대),
 *       그리고 "살 수 있으면 산다"는 자연 정책도 갈래로 함께 잰다
 *  8) **유닛 갈래가 값을 한다**(5단계 개정) — 같은 골드를 태우는 **위약 아군**보다 낫다
 *     (4단계의 `봉쇄 틱 > 0`은 20판에 1틱만 막아도 통과하는 문턱이었다)
 *  9) **마을 레벨업의 화력 성장이 값을 한다**(5단계) — HP만 자라는 마을보다 낫다
 *
 * ── 5단계: 봉투를 **조인 것에 대하여** ──────────────────────────────────────
 * 1~6번 문턱은 이번에도 하나도 건드리지 않았다(기준선 실측 16/20 · 최소 웨이브 47 ·
 * 파괴 186 그대로). 바꾼 것은 7·8번의 **판별력**이다 — 둘 다 통과하지만 잡으라고 만든
 * 것을 못 잡고 있었다:
 *  · 7번은 승수만 봐서, 승수 +2 · 잔여 기지HP +94%로 두 축을 동시에 이기던 마을 Lv2를
 *    통과시켰다(불도저 항목은 같은 형태를 이미 금지하고 있었다).
 *  · 8번은 `봉쇄 틱 > 0`이라, 전투 능력을 통째로 지운 위약 아군도 초록이었다.
 * 두 항목 모두 **대조군을 두는 형태**로 바꿨다(위약 아군 · HP만 자라는 마을).
 * 문턱을 낮춘 곳은 없다.
 *
 * ── 4단계에서 봉투를 **완화하지 않은 것에 대하여** ──────────────────────────
 * 이번 작업은 아군 봉쇄 규칙 둘(규칙 5-b 정원 봉쇄 · 규칙 6-b 중복 조준 금지)과
 * 가격 셋(아군 기본가 −27% · ALLY_COST_GROWTH 1.35→1.20 · 마을 레벨업 +36%)을 바꿨는데,
 * 1~6번 항목의 **문턱을 하나도 건드리지 않았고 전부 그대로 통과한다**.
 * 기준선(타워 몰빵) 실측은 16/20승 · 최소 도달 웨이브 47 · 파괴 186기로 변경 전과 같다 —
 * 바뀐 것은 타워를 쓰지 않는 갈래들의 값어치뿐이라 기준선이 움직이지 않는 것이 정상이다.
 * 새로 더한 7·8번의 문턱도 실측에서 유도했고 근거를 각 항목 주석에 적었다.
 */
import { describe, expect, it } from 'vitest';
import type { AllyDef, AllyId, TowerId } from '@/data/types';
import { ALLY_DEFS, BASE_LEVELS, stageById } from '@/data';
import {
  MIN_TOWERS_FROM_WAVE,
  makeBotSim,
  makeBotSimFor,
  runBot,
  type BotOptions,
  type BotResult,
} from './botharness';

/**
 * 고정 등차수열 — 고를 여지가 없어야 표본이 정직하다.
 * (예전 봉투가 쓰던 101/202/303/404/505 는 전부 통과하는 5개짜리 편향 표본이었다)
 */
const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + 37 * i);
const STAGE1_DECK: TowerId[] = ['spear', 'catapult', 'frost'];
const ALL_DECK: TowerId[] = [
  'spear', 'catapult', 'frost', 'lightning', 'poison', 'ballista', 'brazier', 'drum',
];

/** 같은 스윕을 여러 항목이 재사용한다 — 20시드 × 재실행은 순수 낭비라 캐시한다 */
const cache = new Map<string, BotResult[]>();
function playAll(stageId: number, deck: TowerId[], opts: BotOptions = {}): BotResult[] {
  const key = `${stageId}|${deck.join()}|${JSON.stringify(opts)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rs = SEEDS.map((seed) => {
    const { sim, stage } = makeBotSim(stageId, seed, deck);
    return runBot(sim, stage, opts);
  });
  cache.set(key, rs);
  return rs;
}

const wins = (rs: BotResult[]): number => rs.filter((r) => r.won).length;
const sum = (rs: BotResult[], f: (r: BotResult) => number): number => rs.reduce((a, r) => a + f(r), 0);

/**
 * **위약 아군** — 가격·수명·속도·hp는 그대로라 골드 흐름이 정확히 같고 전투 능력만 0이다.
 * 유닛 갈래가 "값을 한다"를 증명하는 유일한 정직한 대조군이다: 같은 골드를 같은 시점에
 * 태우면서 아무 일도 하지 않으므로, 진짜 아군이 위약을 못 이기면 그 골드는 그냥 버린 것이다.
 */
const PLACEBO_ALLIES: Record<AllyId, AllyDef> = (() => {
  const kill = (d: AllyDef): AllyDef => ({ ...d, dmg: 0, blocks: false, canTargetAir: false, range: 0 });
  return {
    clubber: kill(ALLY_DEFS.clubber),
    slinger: kill(ALLY_DEFS.slinger),
    guardian: kill(ALLY_DEFS.guardian),
  };
})();

/** 아군 정의만 갈아 끼운 같은 스윕 (스테이지1 고정) */
function playAllWithAllies(
  deck: TowerId[],
  opts: BotOptions,
  allyDefs: Record<AllyId, AllyDef>,
): BotResult[] {
  const stage = stageById(1);
  if (!stage) throw new Error('no stage 1');
  return SEEDS.map((seed) =>
    runBot(makeBotSimFor(stage, seed, deck, 0, false, BASE_LEVELS, allyDefs), stage, opts),
  );
}

describe('autoplay 난이도 봉투', () => {
  it('스테이지1: 넓은 시드 20개에서 과반이 완주하고, 전부 웨이브 40을 넘긴다', () => {
    const rs = playAll(1, STAGE1_DECK);
    const msg = JSON.stringify(rs);
    // 실측 15/20. 하한 13은 "핸드 드로우 운으로 지는 판이 절반을 넘지 않는다"이고,
    // 5시드 표본이 주장하던 '전부 클리어'가 사실이 아님을 문서화한 값이다.
    expect(wins(rs), `클리어 ${wins(rs)}/20, 결과: ${msg}`).toBeGreaterThanOrEqual(13);
    // 지더라도 후반까지는 간다 — 초반에 무너지면 여기서 걸린다 (실측 최소 42)
    expect(Math.min(...rs.map((r) => r.wave)), `최소 도달 웨이브: ${msg}`).toBeGreaterThanOrEqual(40);
  }, 120_000);

  /**
   * 봉투가 "통과하지만 아무 일도 안 일어나는" 상태로 썩지 않게 한다.
   * 습격대를 삭제하거나 무력화하면(예: 근접만 남기면 경로 이격 배치에 영원히 못 닿는다)
   * 파괴 수가 0으로 떨어져 여기서 걸린다. 실측 177기(시드 20 합계) → 하한 100기.
   */
  it('스테이지1: 습격대가 실제로 타워를 부순다 (클리어해도 값은 치른다)', () => {
    const rs = playAll(1, STAGE1_DECK);
    const destroyed = sum(rs, (r) => r.destroyed);
    expect(destroyed, `파괴 합계: ${JSON.stringify(rs)}`).toBeGreaterThanOrEqual(100);
    // 잃은 건 타워 한 기가 아니라 거기 넣은 골드다 — 재건설 비용이 성장을 늦춘다
    expect(sum(rs, (r) => r.lostGold)).toBeGreaterThan(0);
  }, 120_000);

  /**
   * 죽음의 나선 금지 — 부서진 만큼 다시 짓지 못해 방어선이 계속 줄어드는 상태.
   * 웨이브 15면 배치 상한 8기가 다 서 있으므로(실측 전 시드 8) 그 뒤의 하락은 전부
   * '파괴를 못 메운 몫'이다. 하한 7 = 상한선에서 한 기까지의 하락만 허용.
   * 판별력: 습격대 towerAttack.dmg를 ×3 하면 5~7로 떨어져 걸린다
   * (botharness.MIN_TOWERS_FROM_WAVE 주석의 A/B 실측).
   */
  it('스테이지1: 파괴가 죽음의 나선으로 번지지 않는다', () => {
    const rs = playAll(1, STAGE1_DECK);
    for (const r of rs) {
      expect(r.minTowers, `웨이브 ${MIN_TOWERS_FROM_WAVE}+ 최소 타워 수: ${JSON.stringify(r)}`)
        .toBeGreaterThanOrEqual(7);
    }
  }, 120_000);

  /**
   * 습격대가 만든 실력 축을 잠근다: **경로에서 얼마나 떨어뜨려 짓는가**.
   * 같은 전략·같은 시드에서 밀착 배치만 바꾸면 15/20 → 0/20 으로 무너진다.
   * 이 격차가 사라지면 습격대는 그냥 체력이 늘어난 적일 뿐이다.
   *
   * 파괴 '총수'로는 재지 않는다 — 밀착 봇은 웨이브 20 언저리에서 죽어 부서질 시간이
   * 짧아 오히려 총수가 적게 나온다(실측 142 대 177). 대신 **방어선이 남아나는지**를
   * 본다: 웨이브 15+ 최소 타워 수가 밀착 봇에서 확실히 낮다 (실측 합계 120 대 160).
   */
  it('스테이지1: 경로 밀착 배치는 클리어하지 못한다 (배치 거리 = 실력 축)', () => {
    const safe = playAll(1, STAGE1_DECK);
    const hug = playAll(1, STAGE1_DECK, { hugPath: true });
    const msg = `안전배치 ${JSON.stringify(safe)} / 밀착배치 ${JSON.stringify(hug)}`;
    expect(wins(hug), msg).toBeLessThan(wins(safe));
    expect(wins(hug), msg).toBeLessThanOrEqual(2);
    expect(sum(hug, (r) => r.minTowers), msg).toBeLessThan(sum(safe, (r) => r.minTowers));
  }, 240_000);

  it('스테이지1: 방치(타워 0)면 웨이브 10 안에 패배', () => {
    const { sim } = makeBotSim(1, 7, STAGE1_DECK);
    sim.applyCommand({ type: 'callWave' });
    for (let i = 0; i < 30 * 60 * 8 && sim.state.phase !== 'lost'; i++) {
      sim.tick();
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      sim.drainEvents();
    }
    expect(sim.state.phase).toBe('lost');
    expect(sim.state.waveIndex).toBeLessThanOrEqual(10);
  }, 30_000);

  it('스테이지6: 별 0 봇은 클리어 불가 (난이도 서열)', () => {
    const { sim, stage } = makeBotSim(6, 11, ALL_DECK);
    const r = runBot(sim, stage);
    expect(r.won, `stage6 결과: ${JSON.stringify(r)}`).toBe(false);
  }, 60_000);

  /**
   * 지형 개조가 **지배 전략**이 되면 안 된다 — "승수도 앞서고 여유도 앞선다"는 금지다.
   * 습격대 도입으로 칸의 가치가 올랐으므로(근접이 못 닿는 자리 = 타워 수명)
   * 제거 비용 곡선도 함께 올렸다 — 스윕 근거는 balance.SCENERY_CLEAR_BASE_COST 주석.
   *
   * 실측(시드 20): 일반 15승·기지HP합 171 / 불도저 16승·164·제거 12회.
   * 승수 +1은 20시드에서 노이즈 폭(제거 0회인 BASE 470에서도 ±1이 나온다)이라
   * 하한을 +1까지 허용하되, **여유까지 동시에 앞서면** 실패로 잡는다.
   * BASE 120(3단계 값)에서는 17승·166으로 승수 +2라 이 항목이 걸린다.
   */
  it('불도저 봇(소품 제거로 자리 사기)이 스테이지1을 더 쉽게 만들지 않는다', () => {
    const plain = playAll(1, STAGE1_DECK);
    const dozer = playAll(1, STAGE1_DECK, { bulldoze: true });
    const msg = `일반 ${JSON.stringify(plain)} / 불도저 ${JSON.stringify(dozer)}`;
    // 검증이 공허하지 않은지 — 봇이 실제로 골드를 내고 지형을 갈아엎었어야 한다
    expect(sum(dozer, (r) => r.clears), msg).toBeGreaterThan(0);
    expect(sum(dozer, (r) => r.clearGold), msg).toBeGreaterThan(0);
    expect(wins(dozer), msg).toBeLessThanOrEqual(wins(plain) + 1);
    const better =
      wins(dozer) > wins(plain) &&
      sum(dozer, (r) => r.baseHpLeft) > sum(plain, (r) => r.baseHpLeft);
    expect(better, `불도저가 승수와 여유 둘 다에서 앞선다 = 지배 전략: ${msg}`).toBe(false);
  }, 240_000);

  /**
   * ── 4단계: 골드 배분 네 갈래 ────────────────────────────────────────────────
   * 타워 / 유닛 / 기지 / 지형 중 **하나가 지배 전략이 되면 나머지 셋이 죽는다.**
   * 여기서 잠그는 것은 두 가지뿐이고, 둘 다 실측에서 나온 값이다(시드 20, 스테이지1):
   *
   *  (1) **적정 배분은 판을 무너뜨리지 않는다** — 유닛/기지/지형에 골드의 5~8%를 쓰는
   *      봇이 타워 몰빵 기준선 근처에 머문다. 실측 타워 16 · 유닛 14 · 기지 16 · 지형 17.
   *      하한을 기준선 −3으로 두는 이유: 20시드에서 승수 ±1은 핸드 드로우 노이즈이고
   *      (autoplay 헤더), 유닛은 그중 가장 약한 갈래라 −2가 실측이다.
   *  (2) **몰빵은 확실히 벌을 받는다** — 예비비를 2,400까지 올려 타워를 굶기면
   *      유닛 0/20(평균 웨이브 32.9) · 기지 2/20(39.8)로 무너진다.
   *      이쪽이 봉투의 핵심이다: 새 소비처가 "타워 대신 사도 되는 것"이 되면
   *      타워 디펜스가 아니게 된다.
   *
   * 상한(기준선 +1)도 같이 건다 — 어느 갈래든 타워보다 **확실히 낫다**면 그 순간
   * 지배 전략이고 나머지 셋이 죽는다. 불도저 항목이 이미 같은 형태로 잠겨 있다.
   *
   * ── 5단계 보강: **"승수만" 보던 상한을 불도저와 같은 두 축으로 올린다** ──────
   * 4단계의 이 항목은 승수만 봤다. 그래서 실제로 있던 지배 전략을 통과시켰다:
   * 마을 Lv2까지만 올리는 봇이 **승수 38/40(기준선 36) · 잔여 기지HP 16.1(기준선 8.3)**
   * 로 두 축을 동시에 이겼는데(골드의 1.3%), 승수 +2가 상한 +1을 넘겨야 걸리는 구조라
   * 40시드에서만 드러나고 20시드 봉투에서는 조용했다. 바로 위 불도저 항목(:160-163)이
   * 같은 상황을 "승수와 여유 둘 다에서 앞선다 = 지배 전략"으로 정확히 잡고 있었는데
   * 새 세 갈래에는 그 잣대가 이식되지 않았던 것이다. 이제 이식한다.
   *
   * 또 하나 — 4단계는 기지 갈래를 `{towerReserve:600, base:{}}` **하나로만** 쟀다.
   * 그건 예비비 때문에 과투자하는 조합이라, 플레이어의 자연스러운 행동(**살 수 있으면
   * 산다** = 예비비 없음)은 재지 않았다. 그 자연 정책을 별도 갈래로 추가한다.
   */
  it('골드 배분 네 갈래 — 적정 배분은 살아 있고, 몰빵은 무너진다', () => {
    const tower = playAll(1, STAGE1_DECK);
    const branches: [string, BotResult[]][] = [
      ['유닛', playAll(1, STAGE1_DECK, { towerReserve: 600, allies: { minNear: 3 } })],
      ['기지', playAll(1, STAGE1_DECK, { towerReserve: 600, base: {} })],
      ['지형', playAll(1, STAGE1_DECK, { bulldoze: true })],
      // 예비비 없이 "살 수 있으면 산다" — 플레이어가 실제로 하는 행동
      ['기지(자연)', playAll(1, STAGE1_DECK, { base: {} })],
    ];
    for (const [name, rs] of branches) {
      const msg = `${name}: ${wins(rs)}/20 (타워 ${wins(tower)}/20) ${JSON.stringify(rs)}`;
      expect(wins(rs), msg).toBeGreaterThanOrEqual(wins(tower) - 3);
      expect(wins(rs), msg).toBeLessThanOrEqual(wins(tower) + 1);
      // 지배 전략 금지 — 승수와 여유(잔여 기지 HP) 둘 다에서 앞서면 실패 (불도저와 같은 잣대)
      const dominant =
        wins(rs) > wins(tower) && sum(rs, (r) => r.baseHpLeft) > sum(tower, (r) => r.baseHpLeft);
      expect(dominant, `${name} 갈래가 승수와 여유 둘 다에서 앞선다 = 지배 전략: ${msg}`).toBe(false);
    }
    // 검증이 공허하지 않은지 — 각 갈래가 실제로 골드를 썼어야 한다
    expect(sum(branches[0]![1], (r) => r.goldAllies)).toBeGreaterThan(0);
    expect(sum(branches[1]![1], (r) => r.goldBase)).toBeGreaterThan(0);
    expect(sum(branches[2]![1], (r) => r.goldScenery)).toBeGreaterThan(0);
    expect(sum(branches[3]![1], (r) => r.goldBase)).toBeGreaterThan(0);

    const unitAll = playAll(1, STAGE1_DECK, { towerReserve: 2400, allies: { minNear: 1 } });
    const baseAll = playAll(1, STAGE1_DECK, { towerReserve: 2400, base: {} });
    expect(wins(unitAll), `유닛 몰빵: ${JSON.stringify(unitAll)}`).toBeLessThanOrEqual(3);
    expect(wins(baseAll), `기지 몰빵: ${JSON.stringify(baseAll)}`).toBeLessThanOrEqual(5);
  }, 900_000);

  /**
   * 유닛 갈래가 **골드값을 하는지**를 잠근다.
   *
   * 4단계 판본은 `allyBlockTicks > 0` 하나였다 — 20판 통틀어 1틱만 봉쇄해도 통과하는
   * 문턱이고, `blocks`만 남기고 dmg·수명·사거리를 전부 망가뜨리면 그대로 초록이었다.
   * 그래서 대조군을 **위약 아군**(가격·수명·속도·hp는 그대로, 전투 능력만 0)으로 바꿨다.
   * 골드 흐름이 같으므로 차이는 전투 능력에서만 나온다 — 아군을 통째로 무력화하면
   * 위약과 같아지고 이 항목이 걸린다.
   *
   * 문턱은 "**위약보다 못하지는 않다**"로 둔다(같거나 낫다). 실측(시드 20, minNear 1,
   * 예비비 600): 진짜 아군 15/20 · 봉쇄 인원틱 8,020 대 위약 12/20 · 0.
   * 승수 차이는 시드 20개에서 노이즈에 잠길 수 있으므로 **봉쇄 인원틱**을 같이 건다 —
   * 이쪽은 결정론적이고 위약에서 정확히 0이 된다.
   */
  it('유닛 갈래가 값을 한다 — 같은 골드를 태우는 위약 아군보다 낫다', () => {
    const opts: BotOptions = { towerReserve: 600, allies: { minNear: 1 } };
    const real = playAll(1, STAGE1_DECK, opts);
    const sham = playAllWithAllies(STAGE1_DECK, opts, PLACEBO_ALLIES);
    const msg = `진짜 ${wins(real)}/20 (봉쇄 ${sum(real, (r) => r.allyBlockTicks)}) / 위약 ${wins(sham)}/20 (봉쇄 ${sum(sham, (r) => r.allyBlockTicks)})`;
    // 실험이 공허하지 않은지 — 둘 다 실제로 아군을 뽑고 비슷한 골드를 태웠어야 한다
    expect(sum(real, (r) => r.alliesTrained), msg).toBeGreaterThan(0);
    expect(sum(sham, (r) => r.alliesTrained), msg).toBeGreaterThan(0);
    expect(sum(sham, (r) => r.goldAllies), msg).toBeGreaterThan(sum(real, (r) => r.goldAllies) * 0.7);
    // 위약은 정의상 한 틱도 못 막는다. 진짜 아군은 막아야 한다
    expect(sum(sham, (r) => r.allyBlockTicks), msg).toBe(0);
    expect(sum(real, (r) => r.allyBlockTicks), msg).toBeGreaterThan(0);
    // 그리고 그 봉쇄가 결과로 이어져야 한다 — 위약보다 못하면 골드를 버린 것이다
    expect(wins(real), msg).toBeGreaterThanOrEqual(wins(sham));
  }, 600_000);

  /**
   * 마을 레벨업의 **공격력·사거리 성장이 값을 하는지**를 잠근다.
   *
   * 4단계까지는 이 축이 통째로 죽어 있었다: Lv2의 dmg/사거리만 Lv1 값으로 고정한 위약과
   * 정품이 40시드에서 **모든 자릿수까지 같은 결과**를 냈다. 기전은 "기지 사거리 안의 적은
   * 어차피 곧 누수되어 사라지고, **죽이지 못한 피해는 아무 흔적도 남기지 않는다**"이다
   * (src/data/hometown.ts). 5단계에서 화력·사거리를 실제로 죽일 수 있는 크기로 올렸고,
   * 그게 유지되는지를 여기서 본다.
   *
   * 대조군은 **HP만 자라는 마을**(공격력·쿨다운·사거리를 Lv1에 고정, 비용·HP는 그대로).
   * 실측(시드 20, 만렙까지 모아 사는 봇): 정품 9/20 · 기지 처치 909 대 HP만 3/20 · 처치 27.
   */
  it('마을 레벨업의 화력 성장이 값을 한다 (HP만 자라는 마을보다 낫다)', () => {
    const stage = stageById(1);
    if (!stage) throw new Error('no stage 1');
    const lv1 = BASE_LEVELS[0]!;
    const hpOnly = BASE_LEVELS.map((d, i) =>
      i === 0 ? { ...d } : { ...d, dmg: lv1.dmg, cooldownTicks: lv1.cooldownTicks, range: lv1.range },
    );
    const opts: BotOptions = { base: { upTo: 5, save: true } };
    const run = (levels: typeof BASE_LEVELS): BotResult[] =>
      SEEDS.map((seed) => runBot(makeBotSimFor(stage, seed, STAGE1_DECK, 0, false, levels), stage, opts));
    const real = run(BASE_LEVELS);
    const sham = run(hpOnly);
    const msg = `정품 ${wins(real)}/20 (기지 처치 ${sum(real, (r) => r.baseKills)}) / HP만 ${wins(sham)}/20 (처치 ${sum(sham, (r) => r.baseKills)})`;
    // 실험이 공허하지 않은지 — 둘 다 실제로 레벨을 올리고 화살을 쐈어야 한다
    expect(sum(real, (r) => r.goldBase), msg).toBeGreaterThan(0);
    expect(sum(sham, (r) => r.goldBase), msg).toBeGreaterThan(0);
    expect(sum(real, (r) => r.baseShots), msg).toBeGreaterThan(0);
    // 화력 성장이 실제로 적을 죽여야 하고, 그게 결과로 이어져야 한다
    expect(sum(real, (r) => r.baseKills), msg).toBeGreaterThan(sum(sham, (r) => r.baseKills) * 2);
    expect(wins(real), msg).toBeGreaterThan(wins(sham));
  }, 600_000);

  it('불도저 봇도 스테이지6은 클리어 불가 (지형 개조가 서열을 뒤집지 않는다)', () => {
    const { sim, stage } = makeBotSim(6, 11, ALL_DECK);
    const r = runBot(sim, stage, { bulldoze: true });
    expect(r.won, `stage6 불도저 결과: ${JSON.stringify(r)}`).toBe(false);
  }, 60_000);
});
