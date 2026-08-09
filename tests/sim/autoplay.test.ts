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
 * ── 11단계: 봉투가 **두 팔**이 됐다 (1번을 쪼갰다) ──────────────────────────
 * 10단계까지의 봉투는 전부 **하한선**이었다 — "대충 두는 봇도 완주한다". 그 선언만으로
 * 봉투를 닫아 두면 **잘 두는 사람 쪽에는 아무 선언도 없다**. 실측이 그 구멍을 그대로
 * 보여줬다: 기준선 봇 160시드 75.6%인데 최강 정책은 **160/160 완주 · 여유 77.6%**였고,
 * 50웨이브 중 **49웨이브가 그 정책의 기지 체력을 한 톨도 못 깎았다**.
 * 그래서 1번에 **상한 팔**(1-b)을 얹었다. 하한 팔(1-a)의 문턱은 한 톨도 안 건드렸다.
 * 잣대가 다른 이유는 최강 봇의 승수가 천장에 붙어 있어서다 — 난이도를 크게 바꿔도
 * 40/40이 그대로이므로 **여유**(Σ잔여HP/Σ최대HP)로 잰다.
 *
 * ── 항목별로 무엇을 잠그는가 ────────────────────────────────────────────────
 *  1-a) 완주 가능성(하한 팔) — 클리어 13/20 이상 + 전 시드 웨이브 40 이상 (실측 14/20, 최소 43)
 *  1-b) **난이도 상한**(상한 팔, 11단계) — 최강 정책도 여유 ≤ 55%로 끝난다 (실측 52.0%)
 *       + 그래도 완주는 한다(승수 ≥ 34/40, 실측 40/40)
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
 * 14) **아군의 한계 가치**(12단계) — 마을 레벨을 **양 팔에 똑같이 못 박고** 위약과 대조한다.
 *     10단계가 confounded라며 뺀 자리를 "마을을 빼는" 대신 "마을을 고정하는" 설계로 메웠다.
 *     같은 실험을 레벨별로 돌리면 아군의 한계 가치가 마을 레벨의 함수라는 것도 드러난다
 *     (Lv1 44/37 · Lv3 48/43 · **Lv5 58/58**) — 항목 주석에 전문
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
 * 10단계(밸런스) — 9단계가 남긴 **적색 항목 4개를 문턱을 낮추지 않고 고쳤다**
 * ═══════════════════════════════════════════════════════════════════════════
 * 9단계는 넷을 적색으로 남기며 "원인은 밸런스 단계에서 풀어야 한다"고 적었다.
 * 그 진단이 맞았다. 넷의 원인은 **하나**였고, 고친 것도 하나다.
 *
 * ── 원인: 정지선(SIEGE_ENGAGE_RANGE 2.1)이 거리 축을 통째로 지웠다 ──────────
 * 9단계는 원인을 "봇의 SAFE_DIST(2.0)가 낡았다"로 짚었지만, 값을 어디로 옮겨도
 * 초록이 되지 않았다(2.12 → 안전 봇 0/20 · 2.35 이상 → 밀착 봇과 완전히 동일).
 * 진짜 원인은 봇이 아니라 **판정 거리**였다. 타워 좌표가 셀 정수라 이격은 사실상
 * 1칸·2칸 두 자리뿐인데, 정지선 2.1이 그 **둘 다**를 붙잡고 있었다:
 *    정지 사격 비율 — 안전 봇(이격 2) 43.6% · 밀착 봇(이격 1) 43.1%
 * 전원 원거리 개편으로 사거리(2.2~3.6)까지 두 자리를 모두 덮으므로, 거리가 사는 것이
 * **아무것도 없는 상태**였다. 남는 차이는 커버 길이뿐이고 그건 가까울수록 크다 —
 * 그래서 dmg를 어떻게 흔들어도 밀착이 상대적으로 유리했던 것이다.
 * (9단계 dmg 5단계 스윕이 전부 실패한 이유가 이것이다. 화력은 두 봇에 똑같이 걸린다)
 *
 * ── 고친 것: 정지선 2.1 → 1.7 (balance.SIEGE_ENGAGE_RANGE) + 그 위에서 화력 재조정 ──
 *    정지 사격 비율 — 안전 봇 **1.2%** · 밀착 봇 **42.4%**
 * 즉 "두 칸 떨어뜨린 타워 앞에는 아무도 멈춰 서지 못한다"가 복원됐고(규칙 1의 약속),
 * 그러자 습격대 화력이 **밀착에만** 선택적으로 걸리게 되어 dmg가 비로소 난이도
 * 손잡이가 됐다. blade 2→3 · archer 4→5(잠정치 해소) · lancer 5→6(서열 유지).
 * 봇에서 바꾼 것은 SAFE_DIST를 상수에서 **유도값**(floor(정지선)+1)으로 돌린 것 하나뿐이고
 * 값 2.0은 그대로다 — 배치 규칙(placementKey)의 등급 체계는 한 줄도 바꾸지 않았다.
 *
 * ── 스윕 표 (스테이지1 · 시드 20 · 덱 spear+catapult+frost · 별 0) ──────────
 *                          안전 봇                        밀착 봇
 *   개편 전(8단계)      16승 · 최소웨 47 · 파괴 186     0승 · 파괴 190 · minT합 116
 *   9단계(정지선 2.1)   18승 · 42 · 211 · minT합 160    3승 · 105 · 160  ← 적색 4개
 *   10단계 정지선만 1.7 18승 · 47 · 116 · 160           3승 · 113 · 160
 *   10단계 최종(+화력)  15승 · 42 · 228 · 160           2승 · 194 · **153**(최소 2기)
 * 마지막 줄이 이 단계의 결과다. 밀착 봇의 방어선이 처음으로 **무너진다**(웨이브 15 이후
 * 최소 타워 수가 2기까지 떨어진다) — 9단계에서는 어떤 dmg 배율에서도 이게 안 됐다.
 *
 * ── 화력 격자 (blade × archer, lancer 6 고정. 안전 승수 / 밀착 승수 / 밀착 minT합) ──
 *   blade 2: archer 4 → 18/3/160 · 5 → 18/3/160 · 6 → 18/3/156
 *   blade 3: archer 4 → 16/2/160 · 5 → **15/2/153** 채택 · 6 → 13/2/144
 *   blade 4: archer 4 → 10/1/143 · 5 →  8/1/155 · 6 →  6/1/152
 *   blade 5: archer 4 →  6/1/135 · 5 →  6/1/140 · 6 →  3/0/131
 * blade 3 / archer 5가 "밀착 방어선은 무너지고(minT 153 < 안전 160) 안전 봇은 완주
 * 하한(13)에 여유 2를 남기는" 유일한 자리다. blade 4부터는 안전 봇까지 하한을 깬다.
 *
 * ── 웨이브 페이스 (체감 늘어짐 점검. 스테이지1 · 시드 8) ────────────────────
 *                       안전 봇                     밀착 봇
 *   9단계(정지선 2.1)   25.16초 · 정지사격 43.6%    25.90초 · 43.1%
 *   10단계 정지선만 1.7 24.47초 · 1.2%             25.77초 · 42.4%
 *   10단계 최종(+화력)  **24.76초 · 0.0%**         25.73초 · 41.2%
 * 정지 사격 개편이 늘린 길이를 되돌린 셈이다(−1.6%). 밀착 봇은 거의 그대로다 —
 * 즉 늘어짐은 이제 **밀착의 대가**이지 기본 페이스가 아니다.
 * 최종 안전 봇의 정지 사격이 0.0%인 것은 봇이 전 타워를 이격 2칸 이상에 두기 때문이고,
 * 사람이 한 칸에 붙이면 그대로 41%가 나온다 — 연출(2단계)이 죽은 것이 아니라
 * **잘 두면 안 맞는다**가 데이터로 성립한 것이다.
 */
import { describe, expect, it } from 'vitest';
import type { AllyDef, AllyId, BaseLevelDef, TowerId } from '@/data/types';
import { ALLY_DEFS, BASE_LEVELS, stageById } from '@/data';
import { ALLY_SORTIE_PATH_LIMIT, ALLY_SORTIE_RANGE } from '@/data/balance';
import { buildPath } from '@/sim/path';
import {
  MIN_TOWERS_FROM_WAVE,
  STRONG_BOT,
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
/**
 * **상한 팔 전용 40개** (11단계). 상한 팔은 승수가 천장(100%)에 붙어 있어 승수로는 아무것도
 * 못 재고 **여유**로 잰다. 여유는 승수보다 분산이 훨씬 작지만(같은 봇·같은 수치에서 20시드와
 * 40시드의 여유가 소수점 한 자리까지 같게 나오는 일이 흔하다) 40개를 쓰는 이유는 따로 있다:
 * 잔여 HP가 사실상 **두세 개의 값**(25 / 15 / 5)만 갖는 계단 분포라, 판 하나가 계단 한 칸을
 * 옮기면 20시드에서는 2.5%p가 흔들린다. 40이면 그 최소 눈금이 1.25%p가 된다.
 */
const SEEDS40 = Array.from({ length: 40 }, (_, i) => 1000 + 37 * i);
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

/** 상한 팔의 잣대 — 남긴 기지 체력의 비율. 승수가 천장에 붙은 뒤에도 계속 움직인다 */
const slack = (rs: BotResult[]): number =>
  sum(rs, (r) => r.baseHpLeft) / sum(rs, (r) => r.baseHpMax);

/** 상한 팔 스윕 (여러 항목이 재사용하므로 캐시) */
function playStrong(opts: BotOptions = STRONG_BOT): BotResult[] {
  const key = `strong|${JSON.stringify(opts)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const stage = stageById(1);
  if (!stage) throw new Error('no stage 1');
  const rs = SEEDS40.map((seed) => runBot(makeBotSimFor(stage, seed, STAGE1_DECK), stage, opts));
  cache.set(key, rs);
  return rs;
}

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
  it('스테이지1 하한 팔: 넓은 시드 20개에서 과반이 완주하고, 전부 웨이브 40을 넘긴다', () => {
    const rs = playAll(1, STAGE1_DECK);
    const msg = JSON.stringify(rs);
    // 실측 14/20 (11단계 이전 15/20). 하한 13은 "핸드 드로우 운으로 지는 판이 절반을
    // 넘지 않는다"이고, 5시드 표본이 주장하던 '전부 클리어'가 사실이 아님을 문서화한 값이다.
    // ⚠ 지금 여유가 **한 판뿐**이다. 11단계가 클라이맥스를 복원하면서 판당 −2HP를
    //   더했고(trex baseDamage 10 → 12) 그게 딱 한 판을 가져갔다. 이 하한을 건드리는
    //   변경을 할 때는 반드시 이 팔부터 다시 재라.
    expect(wins(rs), `클리어 ${wins(rs)}/20, 결과: ${msg}`).toBeGreaterThanOrEqual(13);
    // 지더라도 후반까지는 간다 — 초반에 무너지면 여기서 걸린다 (실측 최소 43)
    expect(Math.min(...rs.map((r) => r.wave)), `최소 도달 웨이브: ${msg}`).toBeGreaterThanOrEqual(40);
  }, 120_000);

  /**
   * ── 11단계: 봉투 1번의 **상한 팔** ─────────────────────────────────────────
   *
   * 왜 팔이 둘이어야 하는가: 위 하한 팔은 "대충 두는 사람도 완주할 수 있다"만 잠근다.
   * 그 선언 하나로 봉투를 닫아 두면 **잘 두는 사람 쪽이 통째로 무주공산**이 되고, 실제로
   * 그랬다 — 사용자의 "스테이지1이 wave 50까지 가는데 쉬웠다"가 정확히 그 자리다.
   * 실측(11단계 착수 시점): 기준선 봇 160시드 121/160(75.6%)인데 **최강 정책은 160/160
   * 완주 · 여유 77.6%**였다. 곧 상한 쪽에는 아무 선언도 없었다.
   *
   * 상한 팔의 잣대는 **승수가 아니라 여유**다. 최강 봇은 어떤 수치에서도 40/40에 붙어 있어
   * 승수로는 난이도 변화를 한 자리도 못 재기 때문이다(실측: 여유 84% → 52%로 내려가는
   * 동안 승수는 40/40 그대로). 승수 하한은 "그래도 완주는 한다"를 잠그는 안전장치로만 둔다.
   *
   * ── 문턱 두 개의 유도 ──────────────────────────────────────────────────────
   *  · `승수 ≥ 34/40` — 사전 조사에서 hpGrowth 1.030이 최강 봇을 32/40으로 떨어뜨렸고
   *    1.035는 19/40이었다. 잘 두는 사람이 절반을 지는 초심자 스테이지는 서열 위반이다.
   *  · `여유 ≤ 0.55` — **이 항목의 본체다.** 착수 시점 실측 0.84였고, 지금 0.52다.
   *    0.55라는 숫자의 뜻: 기지 HP 25에서 trex 한 마리의 누수(12)가 곧 48%이므로,
   *    이 문턱은 "**끝까지 잘 둬도 마지막 한 마리는 반드시 아프다**"의 최소 형태다.
   *    여유가 0.55를 넘는 순간 그 스테이지에는 잘 두는 사람을 건드리는 웨이브가
   *    하나도 없다는 뜻이 된다 — 착수 전 상태가 정확히 그랬다(w1~49 누수 피해 0.0).
   *
   * ── 이 팔이 왜 시드 운으로 통과할 수 없는가 ────────────────────────────────
   * 최강 봇의 종료 HP는 전 시드에서 **정확히 같은 값**이다(40시드 전부 13). 스테이지1의
   * 웨이브 편성이 시드와 무관하게 고정이고(makeWaveFor는 wavePlan.seed만 쓴다) 목표 구성 +
   * 새로고침이 핸드 드로우 운을 지우기 때문이다. 곧 이 팔의 여유는 표본이 아니라
   * **스테이지 데이터의 함수**이고, 시드를 옮겨도 값이 바뀌지 않는다.
   *
   * ⚠ 3번(minTowers)을 이 팔로 옮기지 않은 이유: 최강 봇은 전 시드에서 minT가 상한(8)이라
   *   판별력이 0이다. 그 항목은 하한 팔에 남아 있어야 무언가를 잡는다.
   */
  it('스테이지1 상한 팔: 잘 두는 사람에게도 마지막 한 마리는 아프다 (여유 상한)', () => {
    const strong = playStrong();
    const msg =
      `최강 ${wins(strong)}/40 · 여유 ${(slack(strong) * 100).toFixed(1)}% · ` +
      `종료HP ${strong.map((r) => r.baseHpLeft).join(',')}`;
    expect(wins(strong), msg).toBeGreaterThanOrEqual(34);
    expect(slack(strong), msg).toBeLessThanOrEqual(0.55);
    // 검증이 공허하지 않은지 — 최강 봇이 실제로 목표 구성대로 짓고 새로고침을 썼어야 한다
    expect(sum(strong, (r) => r.placed), msg).toBeGreaterThan(0);
    // 그리고 여유가 "지는 판이 섞여서" 낮아진 것이 아니어야 한다 (승수 천장 확인)
    expect(Math.min(...strong.map((r) => r.wave)), msg).toBeGreaterThanOrEqual(50);
  }, 300_000);

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
   * 같은 전략·같은 시드에서 밀착 배치만 바꾸면 15/20 → 2/20 으로 무너진다.
   * 이 격차가 사라지면 습격대는 그냥 체력이 늘어난 적일 뿐이다.
   *
   * 파괴 '총수'로는 재지 않는다 — 밀착 봇은 일찍 죽어 부서질 시간이 짧아 오히려
   * 총수가 적게 나온다(실측 194 대 228). 대신 **방어선이 남아나는지**를 본다:
   * 웨이브 15+ 최소 타워 수가 밀착 봇에서 확실히 낮다 (실측 합계 153 대 160,
   * 밀착 봇의 최악 시드는 2기까지 떨어지고 안전 봇은 전 시드 8기 = 상한).
   *
   * ── 10단계: 이 항목이 실제로 재는 것은 **정지선**이다 ─────────────────────
   * 9단계에서 이 항목이 빨개진 뒤 셋을 차례로 시험했고, 앞의 둘은 **버렸다**:
   *  · SAFE_DIST를 옮긴다 → 실패. 2.12에서 안전 봇 0/20(창·얼음이 커버 등급을 잃고
   *    도로 밀착한다), 2.35 이상에서는 밀착 봇과 **결과가 완전히 동일**해진다.
   *  · 봇에 '펴기'(빈 구간 우선 커버) 규칙을 넣어 배치 쏠림을 없앤다 → 실패.
   *    밀착 봇이 3승 → 9승으로 **좋아지고** 안전 봇은 18승 → 15승으로 나빠졌다
   *    (타워 8기를 36타일 경로에 흩으면 어디에도 킬존이 안 생긴다). 3번 항목도 깨졌다.
   *  · 정지선을 내린다 → 성공. 봇은 한 줄도 안 바뀌고 게임이 바뀐다.
   * 그래서 이 항목의 **문턱은 한 톨도 건드리지 않았다**(밀착 ≤ 2 · minT합 역전 금지).
   * 판별력 확인: 정지선을 9단계 값 2.1로 되돌리면 밀착 3/20 · minT합 160 대 160으로
   * 즉시 빨개진다 — 곧 이 항목은 지금 "정지선이 1칸과 2칸을 가르는가"를 잠그고 있다.
   */
  it('스테이지1: 경로 밀착 배치는 클리어하지 못한다 (배치 거리 = 실력 축)', () => {
    const safe = playAll(1, STAGE1_DECK);
    const hug = playAll(1, STAGE1_DECK, { hugPath: true });
    const msg = `안전배치 ${JSON.stringify(safe)} / 밀착배치 ${JSON.stringify(hug)}`;
    expect(wins(hug), msg).toBeLessThan(wins(safe));
    expect(wins(hug), msg).toBeLessThanOrEqual(2);
    expect(sum(hug, (r) => r.minTowers), msg).toBeLessThan(sum(safe, (r) => r.minTowers));

    /*
     * ── 11단계: **상한 팔에서도 같은 주장이 선다** (하한 팔 문턱은 위에 그대로 둔다) ──
     * 기준선 봇에서만 재면 "밀착은 못 이긴다"가 약한 봇의 성질인지 게임의 성질인지
     * 구분되지 않는다. 나머지를 전부 최강 정책으로 맞추고 **배치 거리만** 되돌리면
     * 그 하나로 40/40이 2/40이 된다 — 목표 구성도, 새로고침도, 킬존도 그대로인데도.
     * 실측(시드 40): 최강 40/40 · 여유 52.0% 대 최강+밀착 **18/40 · 여유 3.6%**,
     * 첫 피격 웨이브 중앙값 50 대 **2**.
     *
     * 문턱을 승수(≤ 24)와 여유(≤ 0.10) 둘로 거는 이유: 승수는 20시드에서 ±1이 잡음이고
     * 40시드에서도 ±2인데, **여유는 이 팔에서 자릿수가 다르다**(3.6% 대 52.0%). 곧
     * "밀착해도 이기긴 한다"는 남을 수 있어도 "밀착해도 편하다"는 남을 수 없다.
     * 승수 상한 24는 실측 18에서 6칸(=15%p) 위이고, 11단계 이전 값 23보다도 위다 —
     * 곧 이 문턱은 **되돌리기를 잡는 것이 아니라 개선의 유지**를 잠근다.
     */
    const strong = playStrong();
    const strongHug = playStrong({ ...STRONG_BOT, hugPath: true });
    const smsg = `최강 ${wins(strong)}/40 (여유 ${(slack(strong) * 100).toFixed(1)}%) / 최강+밀착 ${wins(strongHug)}/40 (여유 ${(slack(strongHug) * 100).toFixed(1)}%)`;
    expect(wins(strongHug), smsg).toBeLessThan(wins(strong));
    expect(wins(strongHug), smsg).toBeLessThanOrEqual(24);
    expect(slack(strongHug), smsg).toBeLessThanOrEqual(0.1);
  }, 480_000);

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
   *
   * ── 10단계: **U 팔에도 같은 표본 교정을 했다** (문턱은 그대로 `진짜 ≥ 위약`) ──
   * 8단계는 부족 팔만 80시드로 늘리고 U 팔은 20시드로 뒀는데, 그 팔이 정지선 교정
   * (balance.SIEGE_ENGAGE_RANGE 2.1→1.7) 뒤에 커밋된 표본에서 뒤집혔다(진짜 9 대 위약 11).
   * 20시드가 노이즈라는 것은 표본만 늘려 보면 바로 보인다 — 같은 봇·같은 수치로:
   *    n= 20 → 진짜  9 대 위약 11 (여유 75 대 68)
   *    n= 40 → 진짜 22 대 위약 21 (여유 174 대 140)
   *    n= 80 → 진짜 41 대 위약 41 (여유 324 대 280)
   *    n=120 → 진짜 64 대 위약 61 (여유 504 대 400)
   * 시작점을 옮긴 독립 표본 5벌(각 80시드)은 **전부 진짜 우위**다:
   *    47/35 · 45/43 · 41/31 · 41/25 · 51/44
   * 즉 커밋된 20시드 표본이 다섯 벌 중 어느 것보다도 나쁜 쪽으로 치우쳐 있었다.
   * **여유(잔여 기지 HP)는 표본 크기와 무관하게 언제나 진짜 쪽이 앞선다** — 승수보다
   * 분산이 작은 지표라 이쪽이 신호이고, 승수 쪽이 20시드에서 잠긴 것이다.
   * 부족 팔과 같은 SEEDS80으로 맞춰 두 팔의 잣대를 하나로 유지한다.
   */
  it('유닛 갈래가 값을 한다 — 같은 골드를 태우는 위약 아군보다 낫다', () => {
    const opts: BotOptions = { towerReserve: 600, allies: { minNear: 1 } };
    const real = playAllWithAllies(STAGE1_DECK, opts, ALLY_DEFS, SEEDS80);
    const sham = playAllWithAllies(STAGE1_DECK, opts, PLACEBO_ALLIES, SEEDS80);
    const msg = `진짜 ${wins(real)}/${real.length} (봉쇄 ${sum(real, (r) => r.allyBlockTicks)} · 여유 ${sum(real, (r) => r.baseHpLeft)}) / 위약 ${wins(sham)}/${sham.length} (봉쇄 ${sum(sham, (r) => r.allyBlockTicks)} · 여유 ${sum(sham, (r) => r.baseHpLeft)})`;
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
    // 승수는 80시드에서도 동률까지 내려오므로 **여유**를 함께 건다 (위 실측: 전 표본에서 우위)
    expect(sum(real, (r) => r.baseHpLeft), msg).toBeGreaterThan(sum(sham, (r) => r.baseHpLeft));

    /*
     * ── 10단계: **부족 팔(아군+마을)의 위약 대조를 뺐다** ─────────────────────
     * 뺀 것이므로 근거를 길게 남긴다. 7단계가 이 팔을 더한 취지는 "마을까지 산 골드가
     * 값을 하는가"였는데, **위약이 지우는 것은 아군뿐이고 마을은 그대로 남는다.**
     * 마을(홈타운 화력)과 아군(봉쇄)은 둘 다 '경로의 마을 쪽 끝'에서 일하는 자원이라,
     * 마을을 올려 둔 봇에서는 아군을 지워도 마을이 그 자리를 대신 메운다 —
     * 즉 이 팔은 설계상 **아군의 값어치를 마을이 가리는 국면**을 재고 있었다.
     *
     * 그 confounding이 수치로 드러난다. 시작점을 옮긴 독립 표본 5벌(각 80시드),
     * TRIBE_HEAVY(minNear 1 · 마을 예비비 200), 진짜 승수 / 위약 승수:
     *    26/29 · 21/21 · 23/31 · 25/22 · 18/19  → **진짜가 이기는 벌이 5벌 중 1벌**
     * 여유(잔여 기지 HP)도 2/5, 웨평도 4/5로 흔들린다. 곧 `진짜 ≥ 위약`은
     * 이 국면에서 **참이 아니고**, 8단계가 커밋한 표본(31/27 등)이 운이었던 것이다.
     * (8단계가 이 팔에 대해 지적했던 것과 정확히 같은 병이고, 그때는 국면과 표본을
     *  고쳐서 살렸다. 이번에는 국면 자체가 confounded라 살릴 방법이 없다)
     *
     * 가동률로 옮기는 것도 안 된다 — 같은 5벌에서 사거리를 0.1로 줄인 "거의 위약"의
     * 가동률이 오히려 **더 높다**(진짜 5.56~5.95% 대 6.85~7.37%). 11번 주석이 이미
     * 밝힌 성질이다: 봉쇄량은 자리나 성능이 아니라 **그 판이 얼마나 위급했는지**를 잰다.
     *
     * 이 팔을 빼도 부족 갈래는 잠긴 채로 남는다:
     *  · 바로 위 U 팔(같은 minNear 1, 마을 없음)이 아군 무력화를 **5벌 전부** 잡는다.
     *  · 9번이 마을 레벨업의 화력 성장을 HP만 자라는 마을과 대조해 잠근다.
     *  · 10번이 부족 갈래 전체를 타워 몰빵 대비 평균 도달 웨이브 비로 잠근다.
     * 곧 "아군이 값을 하는가"와 "마을이 값을 하는가"는 각각 자기 대조군이 있는
     * 항목에서 재고, 둘을 한 위약으로 겹쳐 재던 이 팔만 없앤다.
     *
     * ── 다만 **대조가 필요 없는 두 단언은 남긴다** ────────────────────────────
     * 위에서 무너진 것은 `진짜 승수 ≥ 위약 승수`, 곧 **위약과의 비교**뿐이다.
     * "부족 국면에서 아군이 실제로 교전하는가"는 대조군 없이 혼자 성립하는 사실이라
     * confounding과 무관하고, 시드 운도 타지 않는다(80시드 합산 > 0).
     *
     * 그리고 이 국면에서만 잡히는 회귀가 있다 — **출격 한계선은 마을 레벨에 묶여 있다**
     * (6단계). U 팔은 마을을 안 올려 레벨 1에 머무르므로, 마을을 올렸을 때 한계선이
     * 늘지 않거나 0이 되는 회귀는 U 팔이 못 잡는다. 위약을 지운 자리에 그 국면의
     * **자기 완결적 생존 신호**만 남겨 둔다. (위약 쪽 `봉쇄 = 0`은 같은 PLACEBO_ALLIES를
     *  쓰는 U 팔이 이미 잠그므로 다시 돌리지 않는다 — 80시드 한 벌치 비용을 아낀다)
     */
    const tribe = playAllWithAllies(STAGE1_DECK, TRIBE_HEAVY, ALLY_DEFS, SEEDS80);
    const tmsg = `부족 ${wins(tribe)}/${tribe.length} · 생산 ${sum(tribe, (r) => r.alliesTrained)} · 봉쇄 ${sum(tribe, (r) => r.allyBlockTicks)}`;
    expect(sum(tribe, (r) => r.alliesTrained), tmsg).toBeGreaterThan(0);
    expect(sum(tribe, (r) => r.allyBlockTicks), tmsg).toBeGreaterThan(0);
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

  /**
   * ── 12단계 14번: **아군의 한계 가치** — 마을을 양 팔에 똑같이 못 박고 잰다 ──────
   *
   * 무엇을 메우는 항목인가: 10단계가 부족 팔(아군+마을)의 위약 대조를 **뺐다**. 이유는
   * confounding이었다 — 위약이 지우는 것은 아군뿐인데 마을은 그대로 남아, 마을을 올려 둔
   * 봇에서는 아군을 지워도 마을(홈타운 화력)이 그 자리를 대신 메웠다. 그래서 그 국면에는
   * **아무 대조군도 없는 상태**로 남아 있었다.
   *
   * 고치는 방법은 마을을 빼는 게 아니라 **양 팔에 똑같이 고정**하는 것이다. 레벨이 하나뿐인
   * 표(`[{...BASE_LEVELS[2], cost: 0}]`)를 주면 마을은 처음부터 Lv3 성능이고 올릴 수도
   * 없다 — 두 팔의 마을이 바이트 단위로 같아지므로 남는 차이는 **아군의 전투 능력뿐**이다.
   * (레벨업 지출도 사라져 골드 흐름까지 같아진다. 위약은 가격·수명·속도·hp가 진짜와 같고
   *  dmg·봉쇄·사거리만 0이라, 아군에 태우는 골드도 거의 같다)
   *
   * ── 왜 Lv3인가 — 이 항목의 가장 중요한 실측이 여기 있다 ────────────────────
   * 마을 레벨을 바꿔 가며 같은 A/B를 돌리면 **아군의 한계 가치가 마을 레벨의 함수**임이
   * 그대로 보인다(각 80시드 · minNear 1 · 예비비 600. `진짜 승수/위약 승수`):
   *   마을 Lv1 고정 → 44/37 (잔여 241/181)
   *   마을 Lv3 고정 → 48/43 (잔여 825/655)
   *   마을 Lv5 고정 → **58/58** (잔여 1396/1370)
   * 곧 **만렙 마을 앞에서는 아군의 전투 능력이 사실상 값을 하지 않는다**(dps 168 · 사거리
   * 4.6의 마을이 같은 자리를 이미 지킨다). 10단계가 confounding이라고 부른 것의 정체가
   * 이것이고, 이제 수치로 확인됐다. 그래서 문턱은 **마을이 다 자라기 전 국면**에 건다.
   *
   * ⚠ 시작점을 옮긴 독립 표본 5벌(각 80시드)로 확인했다. 문턱은 그 최악값에서 나왔다:
   *   Lv3 진짜/위약 승수 48/43 · 47/43 · 43/41 · 45/43 · **38/37**  → 5벌 전부 우위
   *   Lv3 잔여 합       825/655 · 801/650 · 735/617 · 773/660 · 670/600 → 5벌 전부 우위
   *   (Lv5는 같은 5벌에서 58/58 · 57/57 · 55/52 · 55/55 · **48/50** — 승수는 1벌만 우위이고
   *    한 벌은 **열세**다. Lv5에 문턱을 걸면 그게 바로 "커밋된 표본에서만 참"인 항목이 된다)
   *
   * 판별력: 위약이 곧 되돌리기다 — 아군의 dmg·봉쇄를 지우면 두 팔이 같아져 즉시 빨개진다.
   * 위 8번(U 팔)과 다른 점은 **마을이 Lv1이 아니라는 것 하나**이고, 그게 이 항목이
   * 새로 잠그는 사실이다.
   */
  it('아군의 한계 가치 — 마을을 양 팔에 똑같이 고정해도 진짜가 위약을 이긴다', () => {
    const stage = stageById(1);
    if (!stage) throw new Error('no stage 1');
    // 레벨 하나짜리 표 = 마을을 Lv3 성능에 못 박는다 (비용 0이지만 살 다음 레벨이 없다)
    const PIN: BaseLevelDef[] = [{ ...BASE_LEVELS[2]!, cost: 0 }];
    const opts: BotOptions = { towerReserve: 600, allies: { minNear: 1 } };
    const run = (defs: Record<AllyId, AllyDef>): BotResult[] =>
      SEEDS80.map((seed) =>
        runBot(makeBotSimFor(stage, seed, STAGE1_DECK, 0, false, PIN, defs), stage, opts),
      );
    const real = run(ALLY_DEFS);
    const sham = run(PLACEBO_ALLIES);
    const msg =
      `진짜 ${wins(real)}/80 (잔여 ${sum(real, (r) => r.baseHpLeft)} · 봉쇄 ${sum(real, (r) => r.allyBlockTicks)}) / ` +
      `위약 ${wins(sham)}/80 (잔여 ${sum(sham, (r) => r.baseHpLeft)} · 봉쇄 ${sum(sham, (r) => r.allyBlockTicks)})`;
    // 실험이 공허하지 않은지 — 양 팔이 실제로 아군을 뽑고 비슷한 골드를 태웠고, 마을이 고정됐다
    expect(sum(real, (r) => r.alliesTrained), msg).toBeGreaterThan(0);
    expect(sum(sham, (r) => r.goldAllies), msg).toBeGreaterThan(sum(real, (r) => r.goldAllies) * 0.7);
    expect(sum(real, (r) => r.goldBase), msg).toBe(0);
    expect(Math.max(...real.map((r) => r.baseLevel)), msg).toBe(1);
    // 위약은 정의상 한 틱도 못 막는다
    expect(sum(sham, (r) => r.allyBlockTicks), msg).toBe(0);
    // 그리고 두 축 모두에서 진짜가 앞선다 (독립 5벌 전부 성립)
    expect(wins(real), msg).toBeGreaterThanOrEqual(wins(sham));
    expect(sum(real, (r) => r.baseHpLeft), msg).toBeGreaterThan(sum(sham, (r) => r.baseHpLeft));
  }, 900_000);

  it('불도저 봇도 스테이지6은 클리어 불가 (지형 개조가 서열을 뒤집지 않는다)', () => {
    const { sim, stage } = makeBotSim(6, 11, ALL_DECK);
    const r = runBot(sim, stage, { bulldoze: true });
    expect(r.won, `stage6 불도저 결과: ${JSON.stringify(r)}`).toBe(false);
  }, 60_000);
});
