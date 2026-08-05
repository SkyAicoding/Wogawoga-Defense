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
 */
import { describe, expect, it } from 'vitest';
import type { TowerId } from '@/data/types';
import { MIN_TOWERS_FROM_WAVE, makeBotSim, runBot, type BotOptions, type BotResult } from './botharness';

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

  it('불도저 봇도 스테이지6은 클리어 불가 (지형 개조가 서열을 뒤집지 않는다)', () => {
    const { sim, stage } = makeBotSim(6, 11, ALL_DECK);
    const r = runBot(sim, stage, { bulldoze: true });
    expect(r.won, `stage6 불도저 결과: ${JSON.stringify(r)}`).toBe(false);
  }, 60_000);
});
