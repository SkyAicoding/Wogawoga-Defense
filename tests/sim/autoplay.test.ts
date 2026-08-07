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
 *     (4단계의 `봉쇄 틱 > 0`은 20판에 1틱만 막아도 통과하는 문턱이었다).
 *     8단계: 부족 팔의 **국면(minNear 3 → 1)과 표본(20 → 80시드)**을 고쳤다 — 문턱은 그대로
 *  9) **마을 레벨업의 화력 성장이 값을 한다**(5단계) — HP만 자라는 마을보다 낫다
 * 10) **다섯 번째 갈래 — 부족(아군+마을)도 지배 전략이 아니다**(7단계, 시드 40).
 *     8단계: '갈래가 살아 있다' 하한을 **승수 → 평균 도달 웨이브**로 옮겼다 (승수 하한이
 *     커밋된 시드 표본에서만 참이었다 — 독립 10벌 중 7벌 위반. 항목 주석에 전문)
 * 11) **sortie 열이 부족원을 레벨마다 더 멀리 세우고 더 앞에서 싸우게 한다**(7단계 도입,
 *     8단계 전면 개정) — 결정론 잣대(레벨별 엄격 증가) + 봉쇄 최전선 이동 3타일.
 *     7단계의 '봉쇄 1.4배'는 참이 아니었다(독립 8벌 중 6벌 위반) — 항목 주석에 전문
 * 12) **입구 요격 금지**(7단계) — 전 스테이지·전 레벨에서 실효 한계선이 최단 경로의 절반
 *     이하이고, 가장 짧은 s4에서 실제 봉쇄 지점이 스폰에서 경로의 35% 밖이다
 * 13) **무한 모드에서 아군이 무한 방벽이 되지 않는다**(7단계) — 부족 갈래 ≤ 타워 몰빵
 *
 * ── 8단계: 봉투를 **참으로 만든 것에 대하여** ────────────────────────────────
 * 검증에서 8·10·11번이 "커밋된 시드 표본에서만 참"이라는 지적이 왔고, 셋 다 재현됐다
 * (시작점만 옮긴 독립 표본으로 각각 4/10 · 7/10 · 6/8 실패). 세 항목 모두
 * **문턱을 낮추지 않고** 고쳤다 — 8번은 국면과 표본을, 10·11번은 **지표**를 바꿨다.
 * 승수는 40시드에서 표준편차가 8%p라 갈래 하한을 잠글 수 있는 지표가 아니고
 * (10번 주석), 봉쇄량은 그 판이 얼마나 위급했는지를 주로 잰다(11번 주석).
 * 각 항목에 무엇을 왜 바꿨는지와 독립 표본 실측을 전부 남겼다. 1~7·9·12·13번은
 * 한 줄도 건드리지 않았다.
 *
 * ── 7단계: 봉투를 **조인 것에 대하여** ──────────────────────────────────────
 * 1~6번 문턱은 이번에도 한 줄도 건드리지 않았고 그대로 통과한다. 7·9번도 그대로다.
 * 손댄 곳은 **8번을 조인 것**(`봉쇄 > 0` → 가동률 하한 1.5% + 부족 갈래 추가)과
 * **10~13번을 새로 더한 것**뿐이다. 낮춘 문턱은 없다.
 *
 * 새 항목 넷이 겨냥하는 구멍은 하나씩 분명하다:
 *  · 6단계가 마을 표에 sortie 열을 붙였는데 **그 열을 지워도 봉투가 전부 초록이었다**
 *    (7·8·9번 봇은 마을을 안 올리거나 아군을 안 뽑는다) → 11번.
 *  · 유닛과 기지를 **같이** 사는 갈래가 아예 측정되지 않았다 → 10번.
 *  · 한계선 값이 절대 타일 수라 경로가 짧은 스테이지에서 규칙이 뒤집히는데, 봉투가
 *    전부 s1·s6이라 s4를 한 번도 보지 않았다 → 12번.
 *  · 한계선이 길어지면 후반 골드 인플레에서 아군이 방벽이 될 수 있다 → 13번.
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
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ 9단계(정지 사격 개편) 시점의 **알려진 적색 항목 4개** — 문턱은 한 줄도 건드리지 않았다
 * ═══════════════════════════════════════════════════════════════════════════
 * 습격대 전원을 "원거리 + 공격 지점에서 정지"로 바꾼 뒤(siege.ts 규칙 4) 아래 넷이
 * 깨졌다. **일부러 고치지 않고 남긴다** — 넷 다 지표를 낮추면 초록이 되지만, 그건
 * 측정을 포기하는 것이고 원인은 밸런스 단계에서 풀어야 하기 때문이다.
 *
 * 기준선 A/B (스테이지1, 같은 시드 20개, 덱 spear+catapult+frost, 별 0):
 *              개편 전(HEAD)                     개편 후
 *   타워 봇    16/20승 · 최소웨이브 47 · 파괴 186   18/20승 · 42 · 211
 *   밀착 봇     0/20승 · 파괴 190 · 타워수합 116    3/20승 · 105 · 160
 *
 * 1) **경로 밀착 배치는 클리어하지 못한다** (밀착 3/20 ≤ 2 위반, 타워수합 역전)
 *    원인은 구조적이다. 개편 전 안전선은 2칸이었고 봇의 SAFE_DIST도 2.0이라
 *    "안전 배치 = 근접이 못 닿는 자리"였다. 이제 전위도 2.4~2.8이라 **2칸이 안전하지
 *    않다**. 반대로 1칸에 붙이면 타워가 경로를 더 길게 덮어 습격대를 먼저 잡는다 —
 *    즉 봇의 '안전' 개념이 낡아 밀착이 오히려 유리해졌다.
 *    → 고치려면 SAFE_DIST(2.0)를 새 규칙에 맞게 다시 유도해야 하는데, 그 값은
 *      **모든** 봉투 항목의 기준선을 동시에 움직인다. 시뮬레이션 단계에서 할 일이 아니다.
 *    → dmg 스윕으로도 풀리지 않음을 확인했다(아래 3번 참조): 어느 배율에서도
 *      밀착 봇의 '웨이브15+ 최소 타워 수'가 안전 봇 이상이었다.
 *
 * 2) **골드 배분 네 갈래 — 기지 갈래가 지배**(기지 19/20 · 여유도 우위 vs 타워 18/20)
 * 3) **무한 모드 — 부족 갈래가 타워 몰빵을 넘음**(55.83 대 54.58 평균 도달 웨이브)
 * 4) **출격 한계선 곡선 — 최전선 이동 1.34타일**(문턱 3.0, 개편 전 실측 4.49~5.85)
 *    2~4는 전부 "타워 몰빵 대비 다른 갈래" 비교다. 정지 사격은 습격대가 기지에
 *    도달하는 시각을 늦추므로(멈춘 시간만큼 누수가 줄어든다) 타워 이외의 갈래가
 *    상대적으로 유리해진다. 세 항목 모두 차이가 1승 · 1.25웨이브 · 1.3타일로 **근소**하다.
 *
 * ── 문턱을 낮추는 대신 무엇을 했는가 ────────────────────────────────────────
 * 습격대 dmg를 다섯 단계로 스윕해 "개편 전 압력"을 되찾을 수 있는지 실측했다
 * (blade/lancer/archer/hexer/warrior, 타워 봇 승수 / 밀착 봇 승수 / 웨이브15+ 최소 타워):
 *   [2  5  4 2 3] 채택 → 18 / 3 / 8      [3  8  6 3 5] → 12 / 1 / 1
 *   [2  5  5 2 4]      → 17 / 2 / 7      [4 10  8 4 6] →  0 / 1 / 0
 *   [3  6  5 2 4]      → 14 / 2 / 2      [5 13 10 5 8] →  0 / 0 / 0
 * 응답이 지나치게 가팔라(1.5배에서 이미 12승, 2배에서 전멸) 개편 전 값(16/20)을
 * 재현하는 배율이 없다. 그리고 **어느 배율에서도 1번은 초록이 되지 않았다** —
 * 즉 1번은 화력 크기의 문제가 아니라 봇의 배치 규칙 문제다.
 * 그래서 이전 단계가 검증한 표값 [2 5 4 2 3]을 그대로 두었다: 1차 항목
 * (완주 13/20 · 최소 웨이브 40 · 파괴 100 · 죽음의 나선 7)에서 여유가 가장 크다.
 */
import { describe, expect, it } from 'vitest';
import type { AllyDef, AllyId, BaseLevelDef, TowerId } from '@/data/types';
import { ALLY_DEFS, BASE_LEVELS, stageById } from '@/data';
import { ALLY_SORTIE_PATH_LIMIT, ALLY_SORTIE_RANGE } from '@/data/balance';
import { buildPath } from '@/sim/path';
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
/**
 * 같은 수열의 **80개짜리** — 위약 대조처럼 승수 차이가 노이즈에 잠기는 항목에만 쓴다.
 * 문턱을 낮추는 대신 표본을 늘리는 쪽이다. 얼마나 늘려야 하는지는 실측으로 정했다
 * (8단계: 시작점을 옮긴 독립 표본 10벌로 재고, 그 근거를 쓰는 항목에 적었다).
 */
const SEEDS80 = Array.from({ length: 80 }, (_, i) => 1000 + 37 * i);
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

/**
 * **부족 갈래** — 아군을 뽑으면서 마을도 올리는 봇 (7단계). 마을 레벨업이 아군의
 * 출격 한계선을 늘리므로(data/hometown.ts sortie 열) 이 둘은 서로를 강화한다.
 * 이 갈래를 재지 않으면 6단계가 추가한 상품의 값어치가 봉투에 한 번도 안 나온다.
 */
const TRIBE_BOT: BotOptions = { towerReserve: 600, allies: { minNear: 3 }, base: { reserve: 200 } };

/**
 * 같은 부족 갈래인데 **아군을 실제로 많이 쓰는** 정책 (위급 문턱 1 = 매 웨이브 뽑는다).
 * 위약 대조(8번)는 이 국면에서만 판별력이 있다 — 아래 8번 항목 주석의 실측 참조.
 * 같은 항목의 U 팔이 쓰는 minNear와 같은 값이라 두 팔의 잣대가 하나로 유지된다.
 */
const TRIBE_HEAVY: BotOptions = { towerReserve: 600, allies: { minNear: 1 }, base: { reserve: 200 } };

/**
 * 레벨 비용만 0으로 만든 마을 표 — **만렙을 강제**하는 통제 장치다.
 * 성능(HP/공격력/사거리/출격거리)은 실제 표 그대로라 "만렙에서 규칙이 지켜지는가"를
 * 잰다. 봇이 s4를 웨이브 8에 지므로(골드가 4,500에 닿지 않는다) 비용을 빼지 않으면
 * 짧은 경로 스테이지의 만렙은 **구조적으로 측정 불가**다.
 */
const FREE_LEVELS: readonly BaseLevelDef[] = BASE_LEVELS.map((d) => ({ ...d, cost: 0 }));

/** 아군 정의만 갈아 끼운 같은 스윕 (스테이지1 고정) */
function playAllWithAllies(
  deck: TowerId[],
  opts: BotOptions,
  allyDefs: Record<AllyId, AllyDef>,
  seeds: readonly number[] = SEEDS,
): BotResult[] {
  const stage = stageById(1);
  if (!stage) throw new Error('no stage 1');
  return seeds.map((seed) =>
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
   * 예비비 600): 진짜 아군 13/20 · 봉쇄 인원틱 11,233 대 위약 12/20 · 0.
   * 승수 차이는 시드 20개에서 노이즈에 잠길 수 있으므로 **봉쇄 인원틱**을 같이 건다 —
   * 이쪽은 결정론적이고 위약에서 정확히 0이 된다.
   *
   * ── 7단계: `봉쇄 > 0`을 **가동률 하한**으로 조였다 ──────────────────────────
   * `> 0`은 20판 통틀어 1틱만 막아도 통과하는 문턱이라, 위약이 아닌 "거의 위약"
   * (봉쇄 정원 1마리, 사거리 0.1 등)은 여전히 초록이었다. 이제 **아군이 살아 있던
   * 시간 중 실제로 적을 붙잡고 있던 비율**에 하한을 건다. 실측 2.77%(11,233/405,161)
   * → 하한 1.5%. 판별력: ALLY_BLOCK_CAPACITY를 3→1로 되돌리면 1.2%대로 떨어져 걸린다.
   * 이 지표를 고른 이유는 5단계 진단("아군의 병목은 화력이 아니라 가동률")이 가리키는
   * 바로 그 축이고, 6·7단계의 출격 한계선이 사고 있는 물건도 그것이기 때문이다.
   *
   * ── 7단계: **부족 갈래**(아군+마을)도 같은 잣대로 함께 잰다 ────────────────
   * 마을을 올리면 아군이 더 멀리 나간다(sortie 열). 그 조합이 위약 조합을 못 이기면
   * "마을과 아군을 같이 산 골드"가 통째로 낭비라는 뜻이다.
   *
   * ── 8단계: 이 팔은 **국면과 표본이 둘 다 틀려서** 시드 운으로 통과하고 있었다 ──
   * 7단계 판본은 부족 팔을 `minNear 3`(=아군 지출 6~8%) · 20시드로 쟀다. 검증에서
   * 시작점만 옮긴 독립 표본 10벌 중 **4벌이 실패**했고, 합산 200시드에서 진짜 151 대
   * 위약 149로 **위약과 구분되지 않았다**. 두 가지를 고쳤다. 문턱(`진짜 ≥ 위약`)은
   * 한 톨도 건드리지 않았다:
   *
   *  (1) **국면** — minNear 3은 아군을 거의 안 쓰는 정책이라 위약과의 차이가 노이즈보다
   *      작다. 같은 항목의 U 팔이 이미 쓰는 `minNear 1`(아군 지출 17%)로 맞췄다.
   *      실측(40시드 10벌 합산 400시드): 진짜 164 대 위약 141 = **+5.75%p**.
   *      (mn3의 같은 실측은 +0.5%p였다 — 재는 대상이 아니라 국면이 문제였다)
   *  (2) **표본** — 40시드로도 10벌 중 1벌이 뒤집힌다(off5 13 대 14). 80시드로 늘리면
   *      독립 5벌이 전부 통과한다: 31/27 · 43/37 · 26/22 · 31/27 · 33/28 (여유 +4~+6).
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
    // 위약은 정의상 한 틱도 못 막는다
    expect(sum(sham, (r) => r.allyBlockTicks), msg).toBe(0);
    // 진짜 아군은 **살아 있는 시간의 1.5% 이상**을 실제 교전으로 써야 한다 (실측 2.77%)
    const uptime = sum(real, (r) => r.allyBlockTicks) / sum(real, (r) => r.allyTicks);
    expect(uptime, `가동률 ${(uptime * 100).toFixed(2)}% — ${msg}`).toBeGreaterThan(0.015);
    // 그리고 그 봉쇄가 결과로 이어져야 한다 — 위약보다 못하면 골드를 버린 것이다
    expect(wins(real), msg).toBeGreaterThanOrEqual(wins(sham));

    // 부족 갈래(아군+마을)도 같은 잣대 — 마을까지 산 골드가 값을 하는가
    const tribe = playAllWithAllies(STAGE1_DECK, TRIBE_HEAVY, ALLY_DEFS, SEEDS80);
    const tribeSham = playAllWithAllies(STAGE1_DECK, TRIBE_HEAVY, PLACEBO_ALLIES, SEEDS80);
    const tmsg = `부족 진짜 ${wins(tribe)}/80 (봉쇄 ${sum(tribe, (r) => r.allyBlockTicks)}) / 위약 ${wins(tribeSham)}/80`;
    expect(sum(tribe, (r) => r.allyBlockTicks), tmsg).toBeGreaterThan(0);
    expect(sum(tribeSham, (r) => r.allyBlockTicks), tmsg).toBe(0);
    expect(wins(tribe), tmsg).toBeGreaterThanOrEqual(wins(tribeSham));
  }, 900_000);

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

  /**
   * ── 7단계: **다섯 번째 갈래 — 부족(아군+마을)** ─────────────────────────────
   *
   * 마을 레벨업이 아군의 출격 한계선을 늘리므로(data/hometown.ts sortie 열) 유닛과
   * 기지는 이제 **서로를 강화한다**. 위 항목처럼 갈래를 따로만 재면 그 상호작용이
   * 통째로 빠지고, 둘을 같이 사서 생기는 지배 전략이 있어도 봉투가 보지 못한다.
   * 잣대는 위 항목과 **똑같다**: 승수 범위 [기준선−3, 기준선+1] + 두 축 동시 우위 금지.
   *
   * ⚠ **왜 시드 40인가** — 상한(지배 금지) 쪽은 20시드로 판별이 안 된다. 같은 봇을
   * 표본만 늘려 재면 20시드 부족 17·타워 16 / 40시드 36·36 / 80시드 68·71로, 20시드의
   * +1은 노이즈다. 표본을 늘리는 것은 봉투를 **조이는** 방향이다.
   * (실행 시간 대가: 이 항목 하나가 스윕 2회 ≈ 16초)
   *
   * ⚠⚠ **8단계: 하한을 승수에서 웨이브 평균으로 바꿨다 (검증에서 나온 blocker)** ⚠⚠
   * 7단계는 하한도 `승수 ≥ 기준선 − 3`으로 뒀는데, 그건 **커밋된 시드 표본에서만 참**이었다.
   * 시작점만 옮긴 독립 표본 10벌(각 40시드):
   *    타워 36/36/36/36/32/36/33/35/32/39 · 부족 36/31/31/31/27/31/30/31/29/31
   *    승수 차 0 / −5 / −5 / −5 / −5 / −5 / −3 / −4 / −3 / −8  → **7벌이 하한 위반**
   * 400시드 합산으로 타워 351 대 부족 308(−10.75%p)이고, 커밋된 표본(차 0)이 10벌 중
   * 유일한 최고값이었다.
   *
   * 문턱을 −8까지 늘리는 것은 답이 아니다. 승수는 40시드에서 표준편차가 약 8%p라
   * (p≈0.85 기준) **어떤 문턱도 무의미해진다**. 그래서 같은 주장("이 갈래로도 판이
   * 무너지지 않는다")을 **분산이 10배 작은 지표**로 옮겼다 — 평균 도달 웨이브다.
   * 같은 10벌 실측: 부족/타워 웨평 비 0.9930 · 0.9671 · 0.9744 · 0.9829 · 0.9667 ·
   * 0.9644 · 0.9555 · 0.9713 · 0.9623 · 0.9732 (최소 0.9555).
   * 문턱 0.93은 그 최소에서 2.6%p 아래이고, **붕괴는 그대로 잡는다**: 같은 10벌에서
   * 유닛 몰빵의 비는 0.6673~0.7084로 문턱보다 22%p 낮다.
   * (같은 이유로 무한 모드 항목도 처음부터 평균 도달 웨이브를 쓴다)
   *
   * 승수 쪽은 **상한만** 남긴다 — 지배 전략 금지는 방향이 반대라 표본 운으로 통과할 수
   * 없고(10벌 전부 부족 ≤ 타워), 이 항목이 원래 사려던 것도 그쪽이다.
   */
  it('다섯 번째 갈래 — 부족(아군+마을)도 지배 전략이 아니다', () => {
    const stage = stageById(1);
    if (!stage) throw new Error('no stage 1');
    const seeds = Array.from({ length: 40 }, (_, i) => 1000 + 37 * i);
    const go = (opts: BotOptions): BotResult[] =>
      seeds.map((seed) => runBot(makeBotSimFor(stage, seed, STAGE1_DECK, 0, false, BASE_LEVELS), stage, opts));
    const tower = go({});
    const tribe = go(TRIBE_BOT);
    const norm = (rs: BotResult[]): number =>
      sum(rs, (r) => (r.baseHpMax > 0 ? r.baseHpLeft / r.baseHpMax : 0)) / rs.length;
    const avgWave = (rs: BotResult[]): number => sum(rs, (r) => r.wave) / rs.length;
    const waveRatio = avgWave(tribe) / avgWave(tower);
    const msg =
      `부족 ${wins(tribe)}/40 (웨평 ${avgWave(tribe).toFixed(2)} · 여유 ${(norm(tribe) * 100).toFixed(1)}% · 잔여합 ${sum(tribe, (r) => r.baseHpLeft)}) / ` +
      `타워 ${wins(tower)}/40 (웨평 ${avgWave(tower).toFixed(2)} · 여유 ${(norm(tower) * 100).toFixed(1)}% · 잔여합 ${sum(tower, (r) => r.baseHpLeft)}) ` +
      `웨평비 ${waveRatio.toFixed(4)}`;
    // 검증이 공허하지 않은지 — **둘 다** 써야 갈래다 (한쪽이 0이면 U나 H를 다시 재는 셈)
    expect(sum(tribe, (r) => r.goldAllies), msg).toBeGreaterThan(0);
    expect(sum(tribe, (r) => r.goldBase), msg).toBeGreaterThan(0);
    expect(sum(tribe, (r) => r.allyBlockTicks), msg).toBeGreaterThan(0);
    // 그리고 마을이 실제로 올라가 한계선이 Lv1보다 멀리 나가 있어야 한다
    expect(Math.max(...tribe.map((r) => r.baseLevel)), msg).toBeGreaterThan(1);
    // 갈래가 살아 있다 — 승수가 아니라 **평균 도달 웨이브**로 잠근다 (위 ⚠⚠ 참조).
    // 실측 최소 0.9555 / 유닛 몰빵 0.708.
    expect(waveRatio, msg).toBeGreaterThanOrEqual(0.93);
    // 지배 전략 금지 (승수) — 이쪽은 방향이 반대라 표본 운으로 통과할 수 없다
    expect(wins(tribe), msg).toBeLessThanOrEqual(wins(tower) + 1);
    const dominant =
      wins(tribe) > wins(tower) && sum(tribe, (r) => r.baseHpLeft) > sum(tower, (r) => r.baseHpLeft);
    expect(dominant, `부족 갈래가 승수와 여유 둘 다에서 앞선다 = 지배 전략: ${msg}`).toBe(false);
  }, 600_000);

  /**
   * ── 11번: **sortie 열이 실제로 부족원을 더 멀리 세우고, 거기서 싸운다** ──────
   *
   * 잠그려는 것: 6단계가 마을 표에 붙인 `sortie` 열을 **지우거나 평탄하게 만들면
   * 봉투가 빨개져야 한다**. 7단계까지는 이 항목이 없거나(6단계) 시드 운에 기대고
   * 있었다(7단계).
   *
   * ⚠⚠ **8단계: 7단계의 "봉쇄 1.4배 · 가동률 1.3배"를 지웠다 — 참이 아니었다** ⚠⚠
   * 7단계 판본은 봇 A/B(창 고정 `trigger:12`, 20시드)로 곡선 O 대 sortie만 평탄한 표를
   * 재서 봉쇄 1.80배 · 가동률 1.54배를 얻었다. 시작점만 옮긴 독립 표본 8벌로 다시 재면:
   *    봉쇄비 1.80 / 1.13 / 0.92 / 1.50 / 1.39 / 1.49 / 1.30 / 1.66  (평균 1.40)
   *    가동비 1.55 / 1.12 / 1.33 / 1.31 / 1.36 / 1.26 / 1.26 / 1.56
   *  → **8벌 중 6벌 실패**, off2에서는 곡선 쪽이 오히려 덜 막는다(0.92배).
   * 표본을 늘려도 살아나지 않는다. 더 센 격리(Lv1 자리 6.0 대 만렙 자리 12.0, 40시드
   * 6벌)에서도 가동비가 2.85 / 1.68 / 1.51 / **1.00** / 1.46 / 1.73으로 흔들리고,
   * **짝비교로는 40시드 중 far가 이기는 시드가 3~14개뿐**이다(대부분의 판에서는 짧은
   * 줄이 더 많이 막는다). 기전도 분명하다 — 멀리 나가면 걸어가는 데 수명을 쓰고
   * (몽둥이꾼 1.15타일/초 × 12타일 = 수명 20초의 절반), 그 손해는 **타워가 잘 막는
   * 판에서 크고 밀리는 판에서 작다**. 즉 봉쇄량은 자리가 아니라 그 판이 얼마나
   * 위급했는지를 주로 잰다. 이 상품이 사는 것은 "더 많은 봉쇄"가 아니라
   * **"더 앞에서의 봉쇄"**다.
   *
   * 그래서 잣대를 그 문장 그대로 바꿨다. 둘 다 분산이 거의 없다:
   *
   *  (a) **표 쪽 — 결정론**: 모든 스테이지에서 레벨이 오를 때마다 실효 한계선이
   *      **엄격히 증가**한다. 열을 평탄하게 만들면 첫 스테이지 첫 레벨에서 걸린다.
   *      (경로가 짧은 s4·s6도 8단계의 곡선 압축 덕에 다섯 칸이 전부 다르다 —
   *       자르기였던 7단계에는 s4 Lv3·4·5가 8.80으로 같아 이 잣대를 못 세웠다)
   *  (b) **결과 쪽 — 실측**: 같은 봇·같은 지출(창 고정)로 Lv1 자리와 만렙 자리를
   *      격리해, **봉쇄가 일어난 최전선**(allyBlockMinDist)이 스폰 쪽으로 얼마나
   *      옮겨졌는지 잰다. 이건 기하라 표본을 옮겨도 거의 안 움직인다.
   *      실측(20시드 5벌, 경로 36.19): Lv1 자리는 **다섯 벌 전부 29.04**,
   *      만렙 자리는 23.19~24.55 → 차이 4.49~5.85타일. 문턱 3.0타일.
   */
  it('출격 한계선 곡선 — 레벨마다 더 멀리 세우고, 실제로 더 앞에서 붙잡는다', () => {
    // (a) 표 쪽 — 전 스테이지에서 레벨마다 엄격히 증가한다 (비용 0으로 만렙까지 강제)
    for (let sid = 1; sid <= 6; sid++) {
      const st = stageById(sid);
      if (!st) continue;
      const sim = makeBotSimFor(st, 1, ALL_DECK, 0, false, FREE_LEVELS);
      let prev = sim.allySortieRange();
      expect(prev, `s${sid} Lv1`).toBeCloseTo(ALLY_SORTIE_RANGE, 9);
      for (let lv = 2; lv <= sim.state.baseLevelMax; lv++) {
        expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
        const now = sim.allySortieRange();
        expect(now, `s${sid} Lv${lv} 한계선 ${prev} → ${now} (레벨업이 출격거리를 팔지 않는다)`)
          .toBeGreaterThan(prev);
        prev = now;
      }
    }

    // (b) 결과 쪽 — Lv1 자리 대 만렙 자리 격리. 마을 성능은 Lv1에 고정하고 sortie만 바꾼다
    const stage = stageById(1);
    if (!stage) throw new Error('no stage 1');
    const only = (sortie: number): BaseLevelDef[] => [{ ...BASE_LEVELS[0]!, sortie }];
    const opts: BotOptions = { towerReserve: 600, allies: { minNear: 3, trigger: 12 } };
    const run = (levels: readonly BaseLevelDef[]): BotResult[] =>
      SEEDS.map((seed) => runBot(makeBotSimFor(stage, seed, STAGE1_DECK, 0, false, levels), stage, opts));
    const near = run(only(BASE_LEVELS[0]!.sortie));
    const far = run(only(BASE_LEVELS[BASE_LEVELS.length - 1]!.sortie));
    const front = (rs: BotResult[]): number => Math.min(...rs.map((r) => r.allyBlockMinDist));
    const msg =
      `Lv1자리 최전선 ${front(near).toFixed(2)} (봉쇄 ${sum(near, (r) => r.enemyBlockedTicks)}) / ` +
      `만렙자리 최전선 ${front(far).toFixed(2)} (봉쇄 ${sum(far, (r) => r.enemyBlockedTicks)})`;
    // 실험이 공허하지 않은지 — 양쪽 다 실제로 붙잡았어야 한다
    expect(sum(near, (r) => r.enemyBlockedTicks), msg).toBeGreaterThan(0);
    expect(sum(far, (r) => r.enemyBlockedTicks), msg).toBeGreaterThan(0);
    // 그리고 만렙 자리는 **확실히 더 앞에서** 붙잡는다 (실측 차 4.49~5.85타일)
    expect(front(near) - front(far), msg).toBeGreaterThan(3.0);
  }, 600_000);

  /**
   * ── 7단계 11번: **입구 요격 금지** — 한계선이 존재하는 유일한 이유 ──────────
   *
   * 출격 한계선의 존재 이유는 하나다: "아군이 적 스폰 지점까지 걸어가 웨이브를 입구에서
   * 요격하면 타워가 무의미해진다"(src/sim/allies.ts 규칙 2). 그런데 표의 값은 **절대
   * 타일 수**이고 경로 길이는 s4 17.59 ~ s1 36.19로 두 배 넘게 차이 난다 — 만렙 12.0은
   * s1에서 33%지만 s4에서는 68%다. 그래서 규칙 2-c(경로의 마을 쪽 절반까지)를 넣었고,
   * 이 항목이 그 규칙을 **모든 스테이지에 대해** 잠근다.
   *
   * (a) 표 쪽 — 어느 스테이지·어느 레벨에서도 실효 한계선이 최단 경로의 절반을 넘지 않고,
   *     Lv1은 어디서도 깎이지 않는다(모든 기준선 측정의 원점이라 불가침이다).
   * (b) 결과 쪽 — 실제로 봉쇄가 일어난 지점이 스폰에서 얼마나 떨어져 있었나.
   *     레벨 비용을 0으로 준 표로 **만렙을 강제**하고 가장 짧은 s4에서 잰다.
   *     실측 7.63타일 = 경로의 43%. 상한이 없었다면 17.59 − 12.0 − 1.0 = 4.6 = 26%다.
   *     문턱 35%가 그 둘을 가른다.
   */
  it('입구 요격 금지 — 짧은 경로에서도 아군은 경로의 마을 쪽 절반 안에 머문다', () => {
    // (a) 표 쪽 — 전 스테이지 × 전 레벨
    for (let sid = 1; sid <= 6; sid++) {
      const stage = stageById(sid);
      if (!stage) continue;
      const shortest = Math.min(...stage.paths.map((wp) => buildPath(wp).totalLength));
      const cap = Math.max(ALLY_SORTIE_RANGE, shortest * ALLY_SORTIE_PATH_LIMIT);
      const sim = makeBotSimFor(stage, 1, ALL_DECK, 0, false, FREE_LEVELS);
      for (let lv = 1; lv <= sim.state.baseLevelMax; lv++) {
        const reach = sim.allySortieRange();
        const info = `s${sid} Lv${lv} 한계선 ${reach} / 최단경로 ${shortest.toFixed(2)} / 상한 ${cap.toFixed(2)}`;
        expect(reach, info).toBeLessThanOrEqual(cap + 1e-9);
        if (lv === 1) expect(reach, info).toBeCloseTo(ALLY_SORTIE_RANGE, 9);
        // 미리보기도 같은 상한을 통과해야 한다 — 아니면 패널이 거짓말을 한다
        const next = sim.baseNextStats();
        if (next) expect(next.sortie, `${info} 미리보기`).toBeLessThanOrEqual(cap + 1e-9);
        if (lv < sim.state.baseLevelMax) expect(sim.applyCommand({ type: 'upgradeBase' })).toBe(true);
      }
    }
    // (b) 결과 쪽 — 가장 짧은 경로(s4)에서 만렙을 강제하고 실제 봉쇄 지점을 잰다
    const s4 = stageById(4);
    if (!s4) throw new Error('no stage 4');
    const shortest = Math.min(...s4.paths.map((wp) => buildPath(wp).totalLength));
    const rs = SEEDS.slice(0, 8).map((seed) =>
      runBot(makeBotSimFor(s4, seed, ALL_DECK, 2, false, FREE_LEVELS), s4, {
        towerReserve: 400,
        allies: { minNear: 2 },
        base: {},
      }),
    );
    const front = Math.min(...rs.map((r) => r.allyBlockMinDist));
    const msg = `s4 최전선 ${front.toFixed(2)} / 최단경로 ${shortest.toFixed(2)} = ${((front / shortest) * 100).toFixed(0)}%`;
    // 실험이 공허하지 않은지 — 만렙까지 올라갔고 실제로 봉쇄가 일어났어야 한다
    expect(Math.max(...rs.map((r) => r.baseLevel)), msg).toBe(BASE_LEVELS.length);
    expect(sum(rs, (r) => r.enemyBlockedTicks), msg).toBeGreaterThan(0);
    expect(front, msg).toBeGreaterThan(shortest * 0.35);
  }, 300_000);

  /**
   * ── 7단계 12번: 무한 모드에서 부족 갈래가 **무한 방벽**이 되지 않는다 ────────
   *
   * 한계선이 길어지면 아군이 더 오래 일한다. 후반 골드 인플레가 그것을 사면
   * "여섯 명이 길목을 영구히 막는" 상태가 될 수 있는데, 그러면 무한 모드가 끝나지 않는다.
   * (ALLY_MAX_ACTIVE 주석이 정확히 이 형태를 상한으로 막고 있다고 주장하는 지점이다)
   *
   * 실측(스테이지1 무한, 시드 12, 평균 도달 웨이브):
   *   타워 몰빵 55.83 / 부족 갈래 54.58 (곡선 없는 대조 55.00) / 아군 몰빵 35.42
   * 곡선이 있어도 부족 갈래는 타워 몰빵을 **넘지 않고**, 아군에 몰빵하면 20웨이브를 잃는다.
   */
  it('무한 모드: 출격 한계선이 길어져도 아군이 무한 방벽이 되지 않는다', () => {
    const stage = stageById(1);
    if (!stage) throw new Error('no stage 1');
    const seeds = SEEDS.slice(0, 12);
    const go = (opts: BotOptions): BotResult[] =>
      seeds.map((seed) => runBot(makeBotSimFor(stage, seed, STAGE1_DECK, 0, true, BASE_LEVELS), stage, opts));
    const avgWave = (rs: BotResult[]): number => sum(rs, (r) => r.wave) / rs.length;
    const tower = go({});
    const tribe = go(TRIBE_BOT);
    const allIn = go({ towerReserve: 2400, allies: { minNear: 1 }, base: {} });
    const msg = `타워 ${avgWave(tower).toFixed(2)} / 부족 ${avgWave(tribe).toFixed(2)} / 아군몰빵 ${avgWave(allIn).toFixed(2)}`;
    // 실험이 공허하지 않은지 — 부족 갈래가 실제로 마을을 올리고 봉쇄했어야 한다
    expect(sum(tribe, (r) => r.allyBlockTicks), msg).toBeGreaterThan(0);
    expect(Math.max(...tribe.map((r) => r.baseLevel)), msg).toBeGreaterThan(1);
    // 무한 모드는 끝난다 — 무한 방벽이면 여기서 걸린다
    for (const r of tribe) expect(r.won || r.wave < 500, msg).toBe(true);
    // 그리고 부족 갈래가 타워 몰빵을 넘지 않는다 (넘으면 무한 모드의 답이 하나가 된다)
    expect(avgWave(tribe), msg).toBeLessThanOrEqual(avgWave(tower));
    // 아군 몰빵은 확실히 벌을 받는다
    expect(avgWave(allIn), msg).toBeLessThan(avgWave(tower) * 0.8);
  }, 600_000);

  it('불도저 봇도 스테이지6은 클리어 불가 (지형 개조가 서열을 뒤집지 않는다)', () => {
    const { sim, stage } = makeBotSim(6, 11, ALL_DECK);
    const r = runBot(sim, stage, { bulldoze: true });
    expect(r.won, `stage6 불도저 결과: ${JSON.stringify(r)}`).toBe(false);
  }, 60_000);
});
