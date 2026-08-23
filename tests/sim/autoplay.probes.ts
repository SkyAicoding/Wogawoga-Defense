/**
 * **봉투의 판정부** — 항목마다 `judge(patch, profile) → Leg[]` 하나씩.
 *
 * 왜 어서션과 분리했는가: 같은 판정 코드를 **두 방향으로** 부르기 위해서다.
 *  · tests/sim/autoplay.test.ts        — `judge(BASE)` 가 전부 초록이길 요구한다(봉투).
 *  · tests/sim/autoplay.control.test.ts — `judge(되돌리기)` 가 **지정된 다리에서 빨갛길** 요구한다.
 * 곧 판별력이 문장이 아니라 실행물이 된다. 배포본 d9864c0 의 17항목 중 다섯은
 * 판별력 근거가 주석에도 없었고([1-a][1-b][2][5-b][17]), 둘은 주석에만 있었다([3][5]).
 *
 * ── 다리의 등급 (envelope.LegKind) ───────────────────────────────────────────
 *  · contract     — 봉투가 잠그는 것.
 *  · precondition — 실험이 공허하지 않은지. 차단하되 **문턱 유도 대상이 아니다**.
 *  · monitor      — 비차단. 값만 원장에 남기고 사람에게 보고한다.
 * 옛 봉투는 이 구분이 없어 `Σ lostGold > 0`(구조적 항상 참)과 `minTowers ≥ 7`(여유 0인 계약)이
 * 같은 무게로 보였다. 계약 표면에서 15개가 빠졌고 **아무것도 약해지지 않았다**.
 *
 * ── 이 파일의 문턱 규율 ──────────────────────────────────────────────────────
 *  1. 옛 문턱은 **숫자를 그대로 옮긴다**. 표본이 바뀌어도 뜻이 같아야 하므로 절대 개수는
 *     비율·판당량으로 다시 적는다(`100기/20판` → `판당 5.0기`). 이건 완화가 아니다.
 *  2. **극값 선언(전 시드 for-루프)은 금지**한다. 통과 확률이 `(1−q)^n` 이라 표본을 늘리면
 *     단조 감소해서, "표본을 늘린다"는 이 파일의 유일한 처방과 정면으로 싸운다.
 *     실측이 그 병을 확정했다 — [3] 은 400시드 독립 분포가 {6:1, 7:30, 8:369} 라
 *     `모든 시드 ≥ 7` 의 통과 확률이 n=20 에서 95.1%, n=400 에서 **36.7%** 다.
 *     곧 "20시드에서 초록"은 문턱이 옳아서가 아니라 **표본이 작아서**였다.
 *     극값 다리는 **분위수 + 절대 바닥** 두 다리로 쪼갠다.
 *     ⚠ 예외 하나: [13] 의 `won || wave < 500` 은 상한이 아니라 **종료 보장**이다.
 *       표본이 커져도 성질이 안 바뀌므로 극값으로 남긴다.
 *  3. 방향/지배 다리는 전부 **짝 부호검정**(envelope.duel)으로 판정한다. 마진은 한 톨도
 *     넣지 않는다 — 문턱은 여전히 "우위 0"이고, 더한 것은 "그 우위가 잡음이 아니다"뿐이다.
 *  4. 실측값은 주석에 손으로 베끼지 않는다. 다리의 `value` 가 들고 원장이 잠근다.
 */
import type { AllyDef, AllyId, BaseLevelDef, TowerId } from '@/data/types';
import { ALLY_DEFS, BASE_LEVELS, stageById } from '@/data';
import { ALLY_MAX_ACTIVE } from '@/data/balance';
import { buildPath } from '@/sim/path';
import { STRONG_BOT, type BotOptions, type BotResult } from './botharness';
import {
  ALPHA,
  ALPHA_GUARD,
  BASE,
  alignPair,
  type DataPatch,
  type Leg,
  type Profile,
  FULL,
  contract,
  cvar,
  dominant,
  dominatesStable,
  duel,
  duelMsg,
  guard,
  makeSim,
  mean,
  mdeMsg,
  mdeSign,
  median,
  monitor,
  outcome,
  pairedSign,
  recordMde,
  play,
  precondition,
  quantile,
  rate,
  seedBlocks,
  seedsOf,
  share,
  slack,
  slackAvg,
  slackOf,
  sum,
  wins,
  avgWave,
  type Tables,
  type WinName,
} from './envelope';

export const STAGE1_DECK: TowerId[] = ['spear', 'catapult', 'frost'];
export const ALL_DECK: TowerId[] = [
  'spear', 'catapult', 'frost', 'lightning', 'poison', 'ballista', 'brazier', 'drum',
];

/** 부족 갈래 — 아군을 뽑으면서 마을도 올린다 (마을 레벨이 아군 정원을 판다) */
const TRIBE_BOT: BotOptions = { towerReserve: 600, allies: { minNear: 3 } , base: { reserve: 200 } };
/** 같은 부족 갈래인데 아군을 실제로 많이 쓰는 정책 (위급 문턱 1 = 매 웨이브 뽑는다) */
const TRIBE_HEAVY: BotOptions = { towerReserve: 600, allies: { minNear: 1 }, base: { reserve: 200 } };
/** 아군 실험의 표준 정책 — 8·11-b·12·14가 같은 국면을 쓴다 */
const ALLY_OPTS: BotOptions = { towerReserve: 600, allies: { minNear: 1 } };

/**
 * **위약 아군** — 가격·속도·hp 는 그대로라 골드 흐름이 같고 전투 능력만 0이다.
 * 이 파일에서 가장 강한 대조군 형태이고, 8·12·14가 같은 표를 쓴다.
 *
 * ⚠ **`gatherer`는 채집 능력까지 지운다** (`gatherPct: 0` · `carryCap: 1`,
 * docs/gather-spec.md §12 T1). 위약의 정의가 "같은 골드를 같은 시점에 태우되 **능력만**
 * 0"인데, 채집꾼의 능력은 전투가 아니라 **캐는 손**이다 — `kill()`만 걸면 위약 채집꾼이
 * 진짜와 똑같이 캐서 위약 실험의 전제가 통째로 깨진다.
 * ⚠ 이 항목을 더해도 커밋된 팔의 숫자는 **한 자리도 안 움직인다**: 이 파일의 어떤 정책도
 * `gatherer`를 뽑지 않고(`allyOrder`는 셋으로 하드코딩돼 있다), `envelope.playKey`는
 * 표의 **내용이 아니라 id**(`'placeboAllies'`)를 접으므로 캐시 키도 그대로다.
 */
export const PLACEBO_ALLIES: Record<AllyId, AllyDef> = (() => {
  const kill = (d: AllyDef): AllyDef => ({ ...d, dmg: 0, blocks: false, canTargetAir: false, range: 0 });
  return {
    clubber: kill(ALLY_DEFS.clubber),
    slinger: kill(ALLY_DEFS.slinger),
    guardian: kill(ALLY_DEFS.guardian),
    gatherer: { ...kill(ALLY_DEFS.gatherer), gatherPct: 0, carryCap: 1 },
  };
})();
const T_PLACEBO: Tables = { id: 'placeboAllies', allies: PLACEBO_ALLIES };
/** 레벨 비용만 0 — 만렙을 강제하는 통제 장치 (성능은 실제 표 그대로) */
const FREE_LEVELS: readonly BaseLevelDef[] = BASE_LEVELS.map((d) => ({ ...d, cost: 0 }));

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const f = (x: number, n = 4): string => x.toFixed(n);

/** 스윕 한 벌 — 창 이름 하나로 시드가 정해진다(항목이 시드 상수를 만들지 않는다) */
function sweep(
  win: WinName,
  prof: Profile,
  patch: DataPatch,
  o: { opts?: BotOptions; stageId?: number; deck?: TowerId[]; stars?: number; endless?: boolean; tables?: Tables } = {},
): BotResult[] {
  return play({
    stageId: o.stageId ?? 1,
    deck: o.deck ?? STAGE1_DECK,
    seeds: seedsOf(win, prof),
    ...(o.opts ? { opts: o.opts } : {}),
    ...(o.stars !== undefined ? { stars: o.stars } : {}),
    ...(o.endless ? { endless: o.endless } : {}),
    ...(o.tables ? { tables: o.tables } : {}),
    patch,
  });
}

/** 블록별로 자른 결과 — 판정에는 안 쓰고(오검출률이 1−(1−α)⁴ 로 부푼다) 산포를 보고한다 */
function byBlock(rs: BotResult[], nBlocks: number): BotResult[][] {
  const per = Math.max(1, Math.ceil(rs.length / nBlocks));
  const out: BotResult[][] = [];
  for (let i = 0; i < rs.length; i += per) out.push(rs.slice(i, i + per));
  return out;
}
const nb = (prof: Profile): number => Math.min(4, prof.blocks);

export interface Judged {
  readonly legs: Leg[];
  /** 실패 메시지에 붙는 한 줄 요약 */
  readonly msg: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 교정 팔과 붕괴 팔 — 판별력을 **매 실행** 증명하는 두 계기
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **CAL(교정 팔) = 기준선 정책 + `stars: 1`.** 덱 전 타워 별 1개(dmg +6~10% · rate +3~5%)는
 * 데이터를 그대로 읽는 **순수 테스트 손잡이**다. 이 팔이 하는 일 셋:
 *  ① 지배 술어가 실제 우위를 잡는다는 증명 — 이 다리가 초록이 아니면 나머지 지배 다리는
 *    전부 "아무것도 안 잡는 채로 초록"일 수 있다.
 *  ② 절대 문턱 항목의 **기울기**(별 1개가 지표를 얼마나 옮기는가)를 매 실행 기록한다.
 *  ③ **표본 축소의 파수꾼** — 누군가 시드를 줄이면 이 팔이 제일 먼저 빨개진다.
 * ⚠ 이 팔은 봉투가 아니라 **계기**다. 여기서 빨개지면 "게임이 깨졌다"가 아니라
 *   "계기가 깨졌다"이므로, 그 사실을 실패 메시지에 적어 둔다.
 */
export function judgeCal(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const cal = sweep('cal', prof, patch, { stars: 1 });
  const base = alignPair(sweep('base1', prof, patch), 'base1', 'cal', prof);
  const d = duel(cal, base, nb(prof));
  const legs: Leg[] = [
    contract(
      'cal.dominates',
      dominant(d, ALPHA),
      '별 1개(화력 +8~10%)를 준 팔이 지배 술어에서 실제로 잡힌다 — 술어의 검출력 증명(계기)',
      duelMsg('CAL', d),
    ),
    monitor(
      'cal.slope',
      '별 1개가 절대 문턱 지표를 얼마나 옮기는가 (판별력을 "별 몇 개 분량"으로 정량화)',
      `완주율 ${pct(rate(base))} → ${pct(rate(cal))} · 판당파괴 ${f(mean(base.map((r) => r.destroyed)), 2)} → ${f(mean(cal.map((r) => r.destroyed)), 2)} · ` +
        `minT q05 ${quantile(base.map((r) => r.minTowers), 0.05)} → ${quantile(cal.map((r) => r.minTowers), 0.05)} · 여유 ${pct(slackAvg(base))} → ${pct(slackAvg(cal))}`,
    ),
  ];
  return { legs, msg: duelMsg('CAL(stars 1) 대 기준선', d) };
}

/**
 * **붕괴 팔 = 밀착 배치 + 수리 포기**(`hugPath` + `alwaysRush`). 판당 55ms 로 이 파일에서
 * 가장 싼 대조군인데 [1-a]·[2]·[3] 세 항목의 다리를 **동시에** 깬다. 곧 판별력 근거가
 * 주석에도 없던 항목 다섯 중 셋이 여기서 해소된다(나머지 둘은 [1-b]·[5-b] 각 항목 참조).
 */
export function judgeCollapse(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const rs = sweep('collapse', prof, patch, { opts: { hugPath: true, alwaysRush: true } });
  const clearRate = rate(rs);
  const perGame = mean(rs.map((r) => r.destroyed));
  const zeroShare = share(rs, (r) => r.destroyed === 0);
  const deepShare = share(rs, (r) => r.minTowers <= 6);
  const cvar10 = cvar(rs.map((r) => r.wave), 0.1);
  const value =
    `완주율 ${pct(clearRate)}(문턱 ${pct(CLEAR_FLOOR)}) · 웨이브 CVaR10 ${f(cvar10, 2)}(문턱 ${WAVE_CVAR10}) · ` +
    `판당파괴 ${f(perGame, 2)}(문턱 ${DESTROY_PER_GAME}) · 0파괴 ${pct(zeroShare)}(문턱 ${pct(ZERO_SHARE_CAP)}) · ` +
    `minT≤6 ${pct(deepShare)}(문턱 ${pct(DEEP_SHARE_CAP)})`;
  const fires =
    clearRate < CLEAR_FLOOR && cvar10 < WAVE_CVAR10 && perGame < DESTROY_PER_GAME &&
    zeroShare > ZERO_SHARE_CAP && deepShare > DEEP_SHARE_CAP;
  return {
    legs: [
      contract(
        'collapse.fires',
        fires,
        '붕괴 팔이 [1-a] 완주·[1-a] 꼬리·[2] 파괴·[2] 0파괴·[3] 깊이 다섯 다리를 전부 깬다 — 판별력 증명(계기)',
        value,
      ),
    ],
    msg: value,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [1-a] 완주 하한 · [2] 습격대 파괴 · [3] 죽음의 나선 — 한 스윕의 세 축
// ═══════════════════════════════════════════════════════════════════════════

/** 완주율 하한 — 옛 `wins ≥ 13/20` 을 표본 무관하게 다시 적은 것. **문턱 불변** */
const CLEAR_FLOOR = 0.65;
/** 웨이브 5퍼센타일 — 옛 `min(wave) ≥ 40`(극값)의 재유도. 아래 유도 참조 */
const WAVE_Q05 = 42;
/** 웨이브 하위 10% 꼬리 평균 — 신설 */
const WAVE_CVAR10 = 43;
/**
 * 웨이브 절대 바닥 — **옛 극값 문턱 40 을 그대로 둔다**(낮추지 않았다).
 * 극값 선언은 통과 확률이 `(1−q)^n` 이라 표본이 커지면 반드시 깨지므로 **판별력을 지는
 * 다리가 아니라 하드 가드**로만 남긴다. 실제 판정을 지는 것은 위의 q05·CVaR 두 다리다.
 * ⚠ 다음 사람에게: 여기서 걸리면 먼저 q05·CVaR 을 보라. 그 둘이 초록인데 이것만 빨갛다면
 *   그건 난이도가 아니라 **표본이 커졌다는 뜻**이고, 그때 이 다리를 분위로 옮기는 것은 완화가 아니다.
 */
const WAVE_FLOOR = 40;

/**
 * ── [1-a] 스테이지1 하한 팔 ──────────────────────────────────────────────────
 * 옛 선언: `wins ≥ 13/20` + `전 시드 wave ≥ 40`.
 *
 * ⚠ **두 번째 다리를 극값에서 분위+바닥으로 재유도했다.** 근거는 실측이다 —
 *   독립 400시드에서 도달 웨이브의 최솟값이 **정확히 40**(= 문턱)이었다. 극값 선언은
 *   통과 확률이 `(1−q)^n` 이라 표본을 늘리면 반드시 깨진다. 곧 그건 게임에 대한 선언이
 *   아니라 **표본 크기에 대한 선언**이다. 분위수·CVaR 은 n 이 커질수록 수렴한다.
 *   · 방향: q05 문턱 **40 → 42 강화** + CVaR10 다리 **신설** + 옛 극값 문턱 40 을
 *     하드 바닥으로 **그대로 이월**(WAVE_FLOOR = 40. 낮추지 않았다).
 *   · ⚠ 이 자리에 한때 "절대 바닥 34 신설 … 옛 40 보다 낮아 완화"라고 적혀 있었다.
 *     **코드와 어긋난 기록이었다** — 상수는 처음부터 40 이다. 이 파일이 반복해서 걸린
 *     병(주석 실측이 낡는다)의 재발이라 여기 남겨 둔다. 실측은 ⟦원장 1a.floor = 42⟧ 이고
 *     문턱 40 과의 여유는 2웨이브다.
 * 첫 번째 다리는 비율로 옮겨 적었을 뿐 **문턱 불변**이다(13/20 = 0.65).
 *   ⚠ 독립 20블록 스캔에서 **1/20 블록이 문턱 아래**였다(b8000 = 10/20). 그래서 판정은
 *     블록별이 아니라 **합산**에 건다 — "4블록 전원 통과"는 오검출률이 1−(1−α)⁴ 로 부풀고,
 *     배포본이 이미 여러 블록에서 깨지므로 그 집계는 게임을 고쳐야만 성립한다.
 * 판별력: 붕괴 팔(완주율 0.000) · CAL 기울기 · 대조군 `raid-x3`·`enemy-hp-x140`.
 */
export function judge1a(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const rs = sweep('base1', prof, patch);
  const waves = rs.map((r) => r.wave);
  const blocks = byBlock(rs, nb(prof));
  const msg =
    `완주율 ${pct(rate(rs))} (${wins(rs)}/${rs.length}) · 웨이브 q05 ${quantile(waves, 0.05)} · ` +
    `CVaR10 ${f(cvar(waves, 0.1), 2)} · 최소 ${Math.min(...waves)}`;
  return {
    msg,
    legs: [
      contract('1a.clearRate', rate(rs) >= CLEAR_FLOOR,
        `완주율 ≥ ${CLEAR_FLOOR} (= 옛 13/20. 문턱 불변, 표본 20 → ${rs.length} 독립 4블록)`,
        `${pct(rate(rs))} (${wins(rs)}/${rs.length})`),
      contract('1a.q05', quantile(waves, 0.05) >= WAVE_Q05,
        `도달 웨이브 5퍼센타일 ≥ ${WAVE_Q05} (옛 극값 ≥ 40 의 재유도 · 강화)`,
        `${quantile(waves, 0.05)}`),
      contract('1a.cvar10', cvar(waves, 0.1) >= WAVE_CVAR10,
        `도달 웨이브 하위 10% 꼬리 평균 ≥ ${WAVE_CVAR10} (신설)`,
        f(cvar(waves, 0.1), 2)),
      contract('1a.floor', Math.min(...waves) >= WAVE_FLOOR,
        `전 시드 도달 웨이브 ≥ ${WAVE_FLOOR} (옛 극값 문턱 그대로 = 낮추지 않았다. 다만 판별력은 위 두 다리가 진다)`,
        `${Math.min(...waves)}`),
      monitor('1a.blocks', '블록별 완주 수 (판정에 쓰지 않는다 — 산포만 본다)',
        blocks.map((b) => `${wins(b)}/${b.length}`).join(' ')),
    ],
  };
}

/** 판당 파괴 하한 — 옛 `Σ ≥ 100기 / 20판` 을 판당으로 옮긴 것. **문턱 불변** */
const DESTROY_PER_GAME = 5.0;
const DESTROY_MEDIAN = 4;
const ZERO_SHARE_CAP = 0.02;

/**
 * ── [2] 습격대가 실제로 타워를 부순다 ────────────────────────────────────────
 * 옛 선언: `Σ destroyed ≥ 100`(20시드 절대 개수) + `Σ lostGold > 0`.
 *
 * ⚠ **절대 개수를 판당으로 옮겼다 — 문턱은 한 자리도 안 바꿨다**(100/20판 = 판당 5.0).
 *   20시드 절대 개수는 독립 블록에서 산포가 97~156(±30%)이라 형태 자체가 틀렸다:
 *   독립 20블록 스캔에서 **2/20 블록이 문턱 아래**였고(97 · 99), 커밋 블록이 115 로
 *   넷 중 좋은 쪽이었다. 표본을 20 → 160(독립 4블록)으로 늘리면 같은 문턱에서 여유가 는다.
 * 신설 두 다리(중앙값 · 0파괴 비율)는 합계가 꼬리에 끌려가지 않는지를 본다 = 강화.
 * `Σ lostGold > 0` 은 구조적으로 항상 참이라 **전제로 강등**했다(계약 표면에서 뺀 것이지
 * 약하게 만든 것이 아니다).
 * 판별력: `raid-off`(파괴 0) · `tough-x3` · 붕괴 팔(판당 3.69 · 0파괴 25/80) · CAL 기울기.
 */
export function judge2(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const rs = sweep('base1', prof, patch);
  const per = rs.map((r) => r.destroyed);
  const msg = `판당파괴 ${f(mean(per), 3)} · 중앙값 ${median(per)} · 0파괴 ${pct(share(rs, (r) => r.destroyed === 0))} · 합 ${sum(rs, (r) => r.destroyed)}`;
  return {
    msg,
    legs: [
      contract('2.perGame', mean(per) >= DESTROY_PER_GAME,
        `판당 파괴 ≥ ${DESTROY_PER_GAME.toFixed(1)}기 (= 옛 100기/20판. 문턱 불변, 표본 8배)`,
        f(mean(per), 3)),
      contract('2.median', median(per) >= DESTROY_MEDIAN,
        `판당 파괴의 중앙값 ≥ ${DESTROY_MEDIAN} (신설 — 합계가 꼬리에 끌려가지 않는다)`,
        `${median(per)}`),
      contract('2.zeroShare', share(rs, (r) => r.destroyed === 0) <= ZERO_SHARE_CAP,
        `파괴가 한 기도 없는 판의 비율 ≤ ${pct(ZERO_SHARE_CAP)} (신설)`,
        pct(share(rs, (r) => r.destroyed === 0))),
      precondition('2.lostGold', sum(rs, (r) => r.lostGold) > 0,
        '잃은 건 타워가 아니라 거기 넣은 골드다 (구조적 항상 참 — 계약이 아니라 전제)',
        `${sum(rs, (r) => r.lostGold)}`),
    ],
  };
}

const MINT_MEDIAN = 8;
const MINT_Q05 = 7;
const DEEP_SHARE_CAP = 0.02;
const MINT_FLOOR = 5;

/**
 * ── [3] 죽음의 나선 금지 ─────────────────────────────────────────────────────
 * 옛 선언: **전 시드** `minTowers ≥ 7` (극값).
 *
 * ⚠ **이 항목이 극값 금지 규칙의 근원이다.** 독립 400시드 분포가 {6: 1개, 7: 30개, 8: 369개}
 *   라 통과 확률이 `(1−0.0025)^n` → n=20 에서 95.1% · n=80 에서 81.8% · n=400 에서 **36.7%**.
 *   곧 표본을 늘리는 처방이 유일하게 **역효과**인 형태였고, "20시드에서 초록"은 문턱이
 *   옳아서가 아니라 표본이 작아서였다(그리고 옛 주석의 "최소 7 · 7시드가 붙어 있다"는
 *   배포본 실측 최소 8 · 붙은 시드 0 이라 거짓이었다 — botharness 쪽 주석이 옳았다).
 * 재유도: **중앙값 ≥ 8**(옛 문턱 7보다 위 = 강화) + **q05 ≥ 7**(문턱 7 불변, 극값 → 분위)
 *   + **깊은 판 비율 ≤ 2%**(극값이 재던 '붕괴'를 사고율로 다시 적는다) + 하드 바닥 5.
 *
 * ⚠ **꼬리 완화 재검토 (2026-08, 적대적 리뷰 지적).** "전 시드 ≥ 7 → 160판 중 3판까지
 *   ≤6 허용"은 겉보기 완화가 맞다. 복원 가능한지 실측으로 따졌고, 답은 **복원 불가**다:
 *    · 지금 표본의 분포가 ⟦원장 3.dist = [[6,1],[7,8],[8,151]]⟧ 이다. 곧 옛 극값 계약
 *      `전 시드 ≥ 7` 을 그대로 되살리면 **배포본이 즉시 빨갛다**(6이 한 판 있다).
 *      옛 계약이 초록이었던 것은 게임이 그것을 만족해서가 아니라 **20시드가 그 한 판을
 *      못 봤기 때문**이다 — 이 항목이 극값 금지 규칙의 근원이 된 바로 그 사실이다.
 *    · 강도를 비교하면: 극값 계약이 n=20 에서 95% 확률로 통과하려면 사고율 q ≲ 0.26%
 *      여야 한다. 실측 q 는 1/160 = 0.63% 로 **그 두 배 이상**이다. 곧 옛 계약이 암묵적으로
 *      주장하던 사고율은 배포본이 이미 만족하지 않는다.
 *    · 그러면 문턱을 2% → 0.63% 근처로 조이면 되는가? **안 된다.** 그건 실측을 보고
 *      문턱을 그 자리에 붙이는 것이라 여유 0(사고 한 판이면 빨강)이고, 이 파일이 없애려는
 *      "동률이 유일한 방벽" 형태의 재발이다. 2%(=160판 중 3.2판)는 사고 **세 판까지**를
 *      허용하는 값이고, 그 위에 q05 ≥ 7 이 겹쳐 있어 7 미만이 8판을 넘길 수 없다.
 *   **결론: 문턱은 그대로 두고, "옛 계약은 표본 20의 산물이었다"를 실측으로 못 박는다.**
 *   되돌릴 손잡이는 문턱이 아니라 사고율 자체다 — 여기서 걸리면 습격대 화력을 다시 유도하라.
 * 판별력: `raid-x3`(옛 주석 실측 minT 5~7) · `raid-x6`(0~4) · 붕괴 팔(≤6 이 9/80) · CAL(≤7 이 0/80).
 */
export function judge3(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const rs = sweep('base1', prof, patch);
  const mt = rs.map((r) => r.minTowers);
  const deep = share(rs, (r) => r.minTowers <= 6);
  const msg = `minT 중앙값 ${median(mt)} · q05 ${quantile(mt, 0.05)} · ≤6 ${pct(deep)} · 최소 ${Math.min(...mt)}`;
  return {
    msg,
    legs: [
      contract('3.median', median(mt) >= MINT_MEDIAN,
        `웨이브 15+ 최소 타워 수의 중앙값 ≥ ${MINT_MEDIAN} (신설 · 옛 문턱 7보다 위 = 강화)`,
        `${median(mt)}`),
      contract('3.p05', quantile(mt, 0.05) >= MINT_Q05,
        `같은 값의 5퍼센타일 ≥ ${MINT_Q05} (문턱 7 불변, 극값 → 분위)`,
        `${quantile(mt, 0.05)}`),
      contract('3.deepShare', deep <= DEEP_SHARE_CAP,
        `minTowers ≤ 6 인 판의 비율 ≤ ${pct(DEEP_SHARE_CAP)} (신설 — 붕괴를 사고율로 잰다)`,
        pct(deep)),
      contract('3.floor', Math.min(...mt) >= MINT_FLOOR,
        `전 시드 minTowers ≥ ${MINT_FLOOR} (극값을 버린 자리의 하드 바닥)`,
        `${Math.min(...mt)}`),
      monitor('3.dist', 'minTowers 분포 (다음 사람이 분위 문턱을 다시 유도할 때 쓴다)',
        JSON.stringify(
          [...new Set(mt)].sort((a, b) => a - b).map((v) => [v, mt.filter((x) => x === v).length]),
        )),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [1-b] 난이도 상한
// ═══════════════════════════════════════════════════════════════════════════

const STRONG_CLEAR = 0.975;
const STRONG_SLACK = 0.55;
/**
 * 최강 팔의 도달 웨이브 절대 바닥 — **옛 `min(wave) ≥ 50` 을 숫자 그대로 복원한 것**.
 * 한 번 지웠다가 되살렸고, 지운 근거가 틀렸다는 것은 아래 유도에 실측으로 적었다.
 */
const STRONG_WAVE_FLOOR = 50;
/**
 * 최강 팔 **하위 10% 판당 여유의 꼬리 평균** 하한 — 신설. 위 바닥의 연속 눈금판이다.
 * 바닥은 "이미 무너졌는가"만 재서 난이도 축에서 늦게 발화한다(아래 실측 참조).
 */
const STRONG_TAIL_CVAR = 0.3;

/**
 * ── [1-b] 스테이지1 상한 팔 ──────────────────────────────────────────────────
 * 옛 선언: `wins ≥ 34/40` + `slack ≤ 0.55` + `Σ placed > 0` + `min(wave) ≥ 50`.
 *
 * · 완주율 문턱 **0.85 → 0.975 강화**(실측이 4/4 블록에서 40/40 이라 옛 문턱은 언제나 참이었다).
 * · 여유 문턱 **0.55 불변**, 표본 40 → 160(독립 4블록). 커밋 블록 하나로는 여유가 8.3%p
 *   처럼 보였지만 독립 blk9000 단독은 **1.7%p** 였다 — 곧 이 항목의 진짜 얇은 곳은
 *   커밋 블록이 가리고 있었다. 합산에 걸어 분산을 줄인다.
 * · **판당 여유의 중앙값** 다리 신설 — 집계 하나에 얹혀 있던 선언을 분포 위치로 이중화한다.
 *
 * ── ⚠⚠ `min(wave) ≥ 50` 은 한 번 삭제됐다가 **복원됐다** (이 커밋) ──────────
 * 삭제 근거는 "완주율 다리와 동어반복이다(이긴 판은 정의상 50)"였다. **그 논증은 틀렸다.**
 * `won ⇒ wave 50` 만 참이고 역은 거짓이다 — 마지막 웨이브에서 기지가 0이 되면 웨이브 50에
 * 닿은 채로 진다. 기준선 팔(창 base1, 160판)에서 직접 재니 패배 31판의 도달 웨이브가
 *   `42×2 · 43×4 · 44×1 · 47×4 · 48×5 · 49×3 · 50×12`
 * 로, **12판이 패배인데 웨이브 50**이다. 곧 옛 다리는 완주율과 겹치지 않는 **꼬리 계약**이었다:
 * "최강 팔의 어떤 판도 마지막 웨이브 전에 무너지지 않는다".
 *
 * 그 계약이 없으면 무엇이 새는가. `1b.clearRate ≥ 0.975` 는 160판 중 **4판까지** 패배를
 * 허용하고, 그 4판이 웨이브 42에 무너져도 초록이다(옛 사양에선 0판). 게다가 진 판은
 * `baseHpLeft = 0` 이라 **상한 다리 `1b.slack ≤ 0.55` 를 오히려 쉽게 만든다** — 곧 꼬리를
 * 안 잠그면 상한 계약이 "난이도가 맞아서"가 아니라 "진 판이 섞여서" 초록일 수 있다.
 * 옛 주석이 이 다리를 "여유가 지는 판이 섞여서 낮아진 것이 아니어야 한다"라고 적어 둔
 * 자리가 정확히 여기다.
 *
 * ── 극값 금지 규칙의 예외인 이유 (실측) ─────────────────────────────────────
 * 이 파일은 극값 선언을 금지한다(통과 확률 `(1−q)^n`). 그 금지의 근거는 **q 가 양수로
 * 측정된 자리**([3]: 400시드에서 1개)였다. 최강 팔은 다르다 — 창 `strong` 160판 +
 * 창 대장 밖 독립 표본 320판(off 400 · off 440, 각 4블록×40)의 **480판 전부가 웨이브 50**
 * 이다(q̂ = 0). 기준선 팔에서 19/160 = 11.9% 인 사건이 최강 팔에서는 480판에 0이다.
 * 곧 여기서는 표본을 늘려도 통과 확률이 안 내려간다. 이것이 [13] 종료 보장 다음가는
 * 두 번째 극값 예외이고, 예외의 근거는 문장이 아니라 위 480판이다.
 *
 * ── ⚠ 그래도 이 바닥 하나로는 모자란다 (그래서 꼬리 CVaR 다리를 세운다) ─────
 * 되돌리기 감도를 직접 쟀다(최강 팔, 창 `strong` 160판):
 *   적 hp ×1.1 → 승 160/160 · 최소웨 50 · 판당여유 CVaR10 32.25%
 *   적 hp ×1.2 → 승 159/160 · 최소웨 50 · CVaR10 **16.25%** (최소 판당여유 0%)
 *   적 hp ×1.4 → 승  84/160 · **최소웨 여전히 50** · CVaR10 0%
 *   습격대 dmg ×6 → 승 0/160 · 최소웨 **20** · 전 판 웨이브 50 미만
 * 곧 승수를 절반으로 깎는 난이도(hp ×1.4)에서도 도달 웨이브 바닥은 **안 움직인다** —
 * 바닥은 "이미 무너진 세계"만 잡는다(습격대 ×6). 난이도 축에서 연속으로 발화하는 것은
 * 꼬리 여유이므로 `1b.tailCvar` 를 함께 세운다.
 *  · 문턱 0.30 의 유도: 배포본 실측이 창 `strong` 에서 ⟦원장 1b.tailCvar = 38.25%⟧ 이고,
 *    창 대장 밖 독립 두 창(off 400 · off 440, 각 4블록×40)에서 40.00% · 40.50% 다.
 *    세 창의 최솟값에서 8%p 아래로 내려 잡았다.
 *  · **최소 검출 효과크기**: 적 체력 **+20%**(CVaR10 16.25% → 빨강). +10% 는 32.25% 로 통과한다.
 *
 * ── 옛 보장과 강도 비교 ─────────────────────────────────────────────────────
 *   옛 사양: 조기 붕괴(웨이브 50 미만) 허용 **0판** / 40시드.
 *   새 사양: `1b.waveFloor` 가 그대로 **0판** / 160시드 (표본 4배, 문턱 동일).
 *   추가분: 옛 사양은 웨이브 50에 닿기만 하면 기지 HP 1로 이겨도 초록이었다.
 *           `1b.tailCvar` 가 그 구간을 새로 잠근다(하위 16판 평균 여유 ≥ 30%).
 * 판별력: `raid-x6`(최강 팔 최소웨 20 → `1b.waveFloor` 빨강) ·
 *   `enemy-hp-x140`(CVaR10 0% → `1b.tailCvar` 빨강) · `enemy-hp-x070`(상한 두 다리).
 *   ⚠ 두 되돌리기의 `targets` 에 새 다리를 얹는 것은 controls.ts 쪽 작업이라 여기서는
 *     실측만 남긴다(보고서에 정확한 추가분을 적었다).
 */
export function judge1b(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const rs = sweep('strong', prof, patch, { opts: STRONG_BOT });
  const cal = sweep('strongCal', prof, patch, { opts: STRONG_BOT, stars: 1 });
  const slacks = rs.map(slackOf);
  const waves = rs.map((r) => r.wave);
  const tail = cvar(slacks, 0.1);
  const blocks = byBlock(rs, nb(prof));
  const msg =
    `최강 ${wins(rs)}/${rs.length} · 여유 ${pct(slack(rs))} · 판당여유 중앙값 ${pct(median(slacks))} · ` +
    `최소웨이브 ${Math.min(...waves)} · 꼬리여유 CVaR10 ${pct(tail)}`;
  return {
    msg,
    legs: [
      contract('1b.clearRate', rate(rs) >= STRONG_CLEAR,
        `최강 정책 완주율 ≥ ${STRONG_CLEAR} (옛 34/40 = 0.85 에서 강화. 실측이 천장이다)`,
        `${pct(rate(rs))} (${wins(rs)}/${rs.length})`),
      contract('1b.waveFloor', Math.min(...waves) >= STRONG_WAVE_FLOOR,
        `최강 팔의 전 시드 도달 웨이브 ≥ ${STRONG_WAVE_FLOOR} — "어떤 판도 마지막 웨이브 전에 무너지지 않는다" ` +
        `(옛 다리 복원 · 문턱 불변. 완주율과 동어반복이 아니다 — 위 유도의 패배 31판 중 12판이 웨이브 50이다)`,
        `${Math.min(...waves)}`),
      contract('1b.tailCvar', tail >= STRONG_TAIL_CVAR,
        `최강 팔 하위 10% 판당 여유의 꼬리 평균 ≥ ${pct(STRONG_TAIL_CVAR)} (신설 — 위 바닥의 연속 눈금판. ` +
        `최소 검출 효과크기 = 적 체력 +20%)`,
        pct(tail)),
      contract('1b.slack', slack(rs) <= STRONG_SLACK,
        `최강 정책의 여유(Σ잔여/Σ최대) ≤ ${STRONG_SLACK} — "끝까지 잘 둬도 마지막 한 마리는 아프다" (문턱 불변)`,
        pct(slack(rs))),
      contract('1b.slackMedian', median(slacks) <= STRONG_SLACK,
        `판당 여유의 중앙값 ≤ ${STRONG_SLACK} (신설 — 집계 하나에 얹힌 선언을 분포 위치로 이중화)`,
        pct(median(slacks))),
      precondition('1b.placed', sum(rs, (r) => r.placed) > 0,
        '최강 봇이 실제로 목표 구성대로 짓고 새로고침을 썼는가',
        `${sum(rs, (r) => r.placed)}`),
      monitor('1b.calSlack',
        '최강 + 별1 팔의 여유 — 이 값이 0.55 를 넘으면 상한 다리가 무엇을 잡는지가 보인다(계기)',
        `${pct(slack(cal))} (${wins(cal)}/${cal.length})`),
      monitor('1b.blocks', '블록별 여유', blocks.map((b) => pct(slack(b))).join(' ')),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [4] 배치 거리 = 실력 축
// ═══════════════════════════════════════════════════════════════════════════

const HUG_RATE_CAP = 0.025;
const HUG_WAVE_RATIO = 0.93;
const STRONGHUG_RATE_CAP = 0.6;
const STRONGHUG_SLACK_CAP = 0.1;

/**
 * ── [4] 경로 밀착 배치는 클리어하지 못한다 ───────────────────────────────────
 * 이 파일에서 여유가 가장 두꺼운 항목이라 문턱은 거의 그대로 두고 **짝지음과 블록 일관성만
 * 더했다**(= 강화).
 *  · 밀착 승률 상한 **0.10 → 0.025**: 실측 0/80 에서 재유도했다(옛 `wins ≤ 2/20`).
 *  · 웨평비 ≤ 0.93 **불변** + 4블록 전부 ≤ 0.93 **신설**.
 *  · 최강+밀착의 승률 0.60 · 여유 0.10 **불변**.
 * ⚠ 문서화된 되돌리기(`balance.SIEGE_ENGAGE_RANGE 1.7 → 2.1`, 웨평비 0.8716 → 1.0059)는
 *   정지 거리가 `min(spec.range, SIEGE_ENGAGE_RANGE, towerReach)` 라 **데이터로 만들 수 없다**.
 *   controls.UNREACHABLE 에 그대로 적어 두고, 대체 대조군을 "같은 축"이라 우기지 않는다.
 */
export function judge4(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const hug = sweep('hug', prof, patch, { opts: { hugPath: true } });
  const safe = alignPair(sweep('base1', prof, patch), 'base1', 'hug', prof);
  const strong = sweep('strong', prof, patch, { opts: STRONG_BOT });
  const strongHug = sweep('strongHug', prof, patch, { opts: { ...STRONG_BOT, hugPath: true } });
  const d = duel(safe, hug, nb(prof));
  const ratio = avgWave(hug) / avgWave(safe);
  const hb = byBlock(hug, nb(prof));
  const sb = byBlock(safe, nb(prof));
  const blockRatios = hb.map((b, i) => avgWave(b) / avgWave(sb[i]!));
  const msg = `웨평비 ${f(ratio)} (밀착 ${f(avgWave(hug), 2)} / 안전 ${f(avgWave(safe), 2)}) · 밀착 ${wins(hug)}/${hug.length}`;
  return {
    msg,
    legs: [
      contract('4.hug.dominated', dominatesStable(d, ALPHA, true),
        '안전 배치가 밀착 배치를 짝 부호검정에서 유의하게 지배한다 (옛 strict 부등호 wins(hug) < wins(safe) 복원 + 유의성)',
        duelMsg('안전 대 밀착', d)),
      contract('4.hugRate', rate(hug) <= HUG_RATE_CAP,
        `밀착 완주율 ≤ ${HUG_RATE_CAP} (옛 2/20 = 0.10 에서 실측 0/80 으로 재유도 = 강화)`,
        `${pct(rate(hug))} (${wins(hug)}/${hug.length})`),
      contract('4.waveRatio', ratio <= HUG_WAVE_RATIO,
        `평균 도달 웨이브 비 ≤ ${HUG_WAVE_RATIO} (문턱 불변)`, f(ratio)),
      contract('4.blockRatio', blockRatios.every((x) => x <= HUG_WAVE_RATIO),
        `4블록 전부 웨평비 ≤ ${HUG_WAVE_RATIO} (신설 — 블록 일관성)`,
        blockRatios.map((x) => f(x, 3)).join(' ')),
      contract('4.strongHug.rate', rate(strongHug) <= STRONGHUG_RATE_CAP,
        `최강 + 밀착 완주율 ≤ ${STRONGHUG_RATE_CAP} (옛 24/40 을 비율로. 문턱 불변)`,
        `${pct(rate(strongHug))} (${wins(strongHug)}/${strongHug.length})`),
      contract('4.strongHug.slack', slack(strongHug) <= STRONGHUG_SLACK_CAP,
        `최강 + 밀착 여유 ≤ ${STRONGHUG_SLACK_CAP} (문턱 불변 — 승수는 잡음이어도 "밀착해도 편하다"는 남을 수 없다)`,
        pct(slack(strongHug))),
      precondition('4.strongHug.less', wins(strongHug) < wins(strong),
        '배치 거리만 되돌려도 최강 팔이 무너진다',
        `${wins(strongHug)}/${strongHug.length} 대 ${wins(strong)}/${strong.length}`),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [5] 방치 · [5-b] 스테이지6 별0
// ═══════════════════════════════════════════════════════════════════════════

const IDLE_WAVE_CAP = 5;
const IDLE_GOLD_CAP = 500;

/** 방치 루프 — `callWave` 말고 어떤 커맨드도 안 낸다 */
function runIdle(seed: number, patch: DataPatch, stageId = 1): { phase: string; wave: number; gold: number } {
  const { sim } = makeSim({ stageId, seed, deck: STAGE1_DECK, patch });
  sim.applyCommand({ type: 'callWave' });
  for (let i = 0; i < 30 * 60 * 8 && sim.state.phase !== 'lost'; i++) {
    sim.tick();
    if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
    sim.drainEvents();
  }
  return { phase: sim.state.phase, wave: sim.state.waveIndex, gold: sim.state.gold };
}

/**
 * ── [5] 방치(타워 0)는 웨이브 5 안에 패배 ────────────────────────────────────
 * 문턱 셋(`lost` · `waveIndex ≤ 5` · `gold ≤ 500`)은 **전부 그대로**다. 바꾼 것은 둘:
 *  · **하드코딩 시드 7 폐기** → 창(idle) 4블록 × 3. 값이 시드 무관이라 비용이 거의 0인데,
 *    "고르지 않았다"는 이 파일의 원칙에서 시드 7 하나가 벗어나 있었다.
 *  · **`시드 무관` 다리 신설** — 12시드가 모두 같은 (웨이브, 골드) 를 낸다. 스테이지1 편성이
 *    시드와 무관하고 봇이 callWave 외 커맨드를 안 낸다는 성질을 실측이 아니라 어서션으로 고정한다.
 * 그리고 스테이지 2·3 의 같은 방치를 **감시**로 기록한다 — 문턱 5·500 이 하는 일이
 * 스테이지1 의 `leakDamage` 라는 것을 서열로 보여 준다.
 * 판별력(신설, 실행 가능): `leak-off`(옛 주석 실측 8웨이브) · `leak-half`(골드 다리 전용).
 */
export function judge5(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const seeds = seedsOf('idle', prof);
  const rs = seeds.map((s) => runIdle(s, patch));
  const waves = rs.map((r) => r.wave);
  const golds = rs.map((r) => r.gold);
  const uniform = new Set(rs.map((r) => `${r.phase}|${r.wave}|${r.gold}`)).size === 1;
  const other = [2, 3].map((sid) => {
    const o = runIdle(seeds[0]!, patch, sid);
    return `s${sid} 웨이브 ${o.wave}/골드 ${o.gold}`;
  });
  const msg = `방치 웨이브 ${Math.max(...waves)} · 골드 ${Math.max(...golds)} · ${rs.length}시드`;
  return {
    msg,
    legs: [
      contract('5.phase', rs.every((r) => r.phase === 'lost'), '방치는 반드시 진다 (문턱 불변)',
        [...new Set(rs.map((r) => r.phase))].join(',')),
      contract('5.wave', Math.max(...waves) <= IDLE_WAVE_CAP,
        `방치 패배 웨이브 ≤ ${IDLE_WAVE_CAP} (문턱 불변)`, `${Math.max(...waves)}`),
      contract('5.gold', Math.max(...golds) <= IDLE_GOLD_CAP,
        `방치 최종 골드 ≤ ${IDLE_GOLD_CAP} — "방치가 전투로 돈을 벌기 시작했다"를 잡는다 (문턱 불변)`,
        `${Math.max(...golds)}`),
      contract('5.seedFree', uniform,
        '전 시드가 같은 결과 — 이 항목에서 시드가 자유변수가 아니라는 성질을 어서션으로 고정 (신설)',
        `${new Set(rs.map((r) => `${r.wave}/${r.gold}`)).size}가지`),
      monitor('5.rank', '스테이지 2·3 의 같은 방치 (문턱 5·500 이 하는 일이 s1 의 leakDamage 라는 서열 증거)',
        other.join(' · ')),
    ],
  };
}

/**
 * ── [5-b] 스테이지6 별0 은 클리어 불가 ───────────────────────────────────────
 * 옛 선언: 시드 11 하나 · `won === false`.
 *  · 시드 11 하드코딩 폐기 → 창(s6) 4블록 × 3.
 *  · **연속 눈금 신설**(평균 도달 웨이브 ≤ 10): 이진 다리 하나로는 대조군이 움직여도 눈금이 없다.
 *  · **서열 대조 신설**: 같은 봇·같은 덱이 스테이지1에서는 평균 도달 웨이브 ≥ 40 —
 *    곧 "6에서 진다"가 봇이 무능해서가 아니라 스테이지가 어려워서임을 결과로 보인다.
 *    이 항목은 판별력 근거가 주석에도 없던 다섯 중 하나였고, 이 다리가 그 대조군이다.
 * 판별력(신설): `s6-tower-x3` · `enemy-hp-x070`.
 */
export function judge5b(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const rs = sweep('s6', prof, patch, { stageId: 6, deck: ALL_DECK });
  const rank = sweep('s6', prof, patch, { stageId: 1, deck: ALL_DECK });
  const msg = `s6 ${wins(rs)}/${rs.length} 승 · 평균 웨이브 ${f(avgWave(rs), 2)} / 같은 봇 s1 평균 웨이브 ${f(avgWave(rank), 2)}`;
  return {
    msg,
    legs: [
      contract('5b.lost', rs.every((r) => !r.won), '스테이지6 별0 은 전 시드 패배 (문턱 불변, 시드 1 → 12)',
        `${wins(rs)}/${rs.length}`),
      contract('5b.wave', avgWave(rs) <= 10, '평균 도달 웨이브 ≤ 10 (신설 — 이진 다리에 연속 눈금을 붙인다)',
        f(avgWave(rs), 2)),
      contract('5b.rank', avgWave(rank) >= 40,
        '같은 봇·같은 덱이 스테이지1 에서는 평균 웨이브 ≥ 40 (신설 — 봇이 무능한 게 아니라 스테이지가 어렵다)',
        f(avgWave(rank), 2)),
    ],
  };
}

/**
 * ── [17] 불도저 봇도 스테이지6 은 클리어 불가 ────────────────────────────────
 * 옛 선언: 시드 11 하나 · `won === false`. 시드를 창으로 옮기고 **짝 다리를 신설**했다:
 * 같은 시드의 일반 봇과 도달 웨이브를 비교해 **승패만이 아니라 진도도 개선되지 않음**을 본다
 * (실측에서 다섯 시드 전부 정확히 같은 웨이브였다). 짝 상대는 [5-b] 가 이미 돌린 팔이라 추가 0판.
 */
export function judge17(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const dz = sweep('s6', prof, patch, { stageId: 6, deck: ALL_DECK, opts: { bulldoze: true } });
  const plain = sweep('s6', prof, patch, { stageId: 6, deck: ALL_DECK });
  const gain = dz.map((r, i) => r.wave - plain[i]!.wave);
  const msg = `불도저 ${wins(dz)}/${dz.length} · 웨이브차 [${gain.join(' ')}]`;
  return {
    msg,
    legs: [
      contract('17.lost', dz.every((r) => !r.won), '불도저 봇도 스테이지6 은 전 시드 패배 (문턱 불변, 시드 1 → 12)',
        `${wins(dz)}/${dz.length}`),
      contract('17.noGain', gain.every((g) => g <= 1),
        '같은 시드의 일반 봇 대비 도달 웨이브가 +1 을 넘지 않는다 (신설 — 지형 개조가 서열을 뒤집지 않는다)',
        `[${gain.join(' ')}]`),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [6] 불도저 · [7] 골드 배분 네 갈래 — 공통 대조 벤치(l2)를 쓴다
// ═══════════════════════════════════════════════════════════════════════════

const BRANCH_RATE_MARGIN = 0.05;
const BRANCH_WAVE_RATIO = 0.93;
/** [10] 부족 갈래의 승률 상한 여유 — 옛 `wins(tribe) ≤ wins(tower)+1` / 40시드 = +2.5%p 그대로 */
const TRIBE_RATE_MARGIN = 0.025;

/**
 * ── [6] 불도저가 스테이지1 을 더 쉽게 만들지 않는다 ──────────────────────────
 * 옛 선언의 마지막 다리는 연언 `rate↑ && slackAvg↑` 였고, **유일한 방벽이 여유의 완전 동률**
 * 이었다(승률은 이미 불도저가 앞섰다). 그 형태는 두 팔이 사실상 같은 판을 밟을 때 판정이
 * 소수점에 걸린다.
 *
 * ⚠ **여기서 진단 하나를 정정한다.** 독립 320시드 **집계**로는 일반 255/320 대 불도저
 *   256/320 이라 연언이 참(= 적색)이지만, 같은 판을 **시드로 짝지어** 재면
 *   불일치 8쌍(4:4) · 승패가 갈린 시드 1:0 · Δ̄ **−0.00175** 다. 곧 "지배"의 근거 전체가
 *   320판 중 한 판이었고, 여유의 "완전 동률"은 **314판이 바이트 단위로 같기** 때문이다.
 *   짝으로 보면 여유 부호도 3:3 으로 갈린다 → **게임을 고쳐야 하는 상황이 아니다.**
 * 재유도: 연언 → `dominant(duel(불도저, 일반)) === false`. 문턱("우위 0")과 승률 상한(+5%p)은
 *   **둘 다 불변**이고 추정량만 짝으로 바뀌었다 = 등강도 재유도.
 * ⚠⚠ **α 를 방어용으로 갈아 끼웠다(2026-08).** 이 다리는 `!dominant(...)` 형태라
 *   **α 가 작아질수록 통과가 쉬워진다** — 옛 구조는 여기에 발견용과 같은 Bonferroni
 *   α = 0.05/12 를 써서, 다리를 더할수록 이 계약이 약해지고 있었다(유도는 envelope.ts
 *   `GUARD_LEGS` 주석 전문). 이제 방어용은 보정 없는 0.05 를 쓴다. 그 결과 이 계약이
 *   빨개지는 데 필요한 같은 방향 불일치 쌍이 **8개 → 5개**로 내려갔다 = 순 강화.
 *   최소 검출 효과크기는 다리 값에 `MDE …판/…` 로 실려 원장이 잠근다.
 * ⚠ 다만 **별개의 밸런스 사실**은 계속 감시한다: 소품 제거가 320판 중 8판(2.5%)에서만
 *   결과를 바꾼다 = 상품이 사실상 죽어 있다(`SCENERY_CLEAR_BASE_COST` 주석의 자체 진단과 일치).
 *   `6.discord` 가 그 값을 매 실행 기록한다. 이 값이 작을수록 **검출력의 상한도 낮다** —
 *   부호검정은 시드 수가 아니라 불일치 쌍 수에서 힘을 얻으므로, 표본을 줄이는 모든 결정이
 *   이 다리를 조용히 완화한다. 그래서 원장이 `d` 를 반드시 인쇄한다.
 *
 * ── ⚠⚠ 웨평비 다리는 한 번 사라졌다가 **복원됐다** (이 커밋) ─────────────────
 * 옛 봉투에서 [7] 의 **지형 갈래**는 갈래마다 세 다리를 걸었다 —
 * `웨평비 ≥ 0.93`(갈래가 살아 있다) · `승률 ≤ 타워 + 0.05` · `지배 금지`.
 * 그 갈래를 여기로 통합하면서 뒤의 둘만 옮겨졌고 **웨평비만 조용히 빠졌다**.
 * 당시 [7] 주석은 "중복 제거이므로 커버리지 손실이 없다"라고 적었는데, 그건 **거짓이다**
 * — [6] 에는 웨평비 다리가 없었으므로 통합은 계약 하나를 지운 것이었다. 그래서 되살린다.
 * 두 다리가 겹치지 않는 이유: 승률 상한과 지배 금지는 **"불도저가 너무 세면"** 빨개지고,
 * 웨평비는 **"불도저가 죽으면"** 빨개진다. 방향이 반대라 서로를 대신할 수 없다.
 * 실측(이 커밋, 창 l2 · dozer 각 80판): 일반 웨평 49.7125 / 불도저 49.7250 → 비 1.0003.
 *  · **최소 검출 효과크기**: 불도저 팔의 평균 도달 웨이브가 **3.48 웨이브**(49.73 → 46.24)
 *    떨어지면 빨개진다. 소품 제거가 순손실이 되는 세계가 그 자리다.
 *  · ⚠ 이 다리를 겨냥하는 되돌리기는 아직 없다 — 양성 대조군이 `SCENERY_CLEAR_BASE_COST`
 *    되돌리기인데 balance 모듈 상수라 주입구가 없다(controls.UNREACHABLE 에 이미 적혀 있는
 *    것과 같은 이유). `6.dozer.notDominant` 와 같은 처지이므로 UNPROVEN 에 함께 실어야 한다.
 */
export function judge6(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const plain = sweep('l2', prof, patch);
  const dozer = sweep('dozer', prof, patch, { opts: { bulldoze: true } });
  const d = duel(dozer, plain, nb(prof));
  const ratio = avgWave(dozer) / avgWave(plain);
  const msg = `${duelMsg('불도저 대 일반', d)} · 웨평비 ${f(ratio, 4)}`;
  return {
    msg,
    legs: [
      precondition('6.clears', sum(dozer, (r) => r.clears) > 0 && sum(dozer, (r) => r.clearGold) > 0,
        '봇이 실제로 골드를 내고 지형을 갈아엎었는가',
        `${sum(dozer, (r) => r.clears)}회 ${sum(dozer, (r) => r.clearGold)}골드`),
      contract('6.waveRatio', ratio >= BRANCH_WAVE_RATIO,
        `불도저 갈래의 평균 도달 웨이브 비 ≥ ${BRANCH_WAVE_RATIO} — 갈래가 살아 있다 ` +
        `(옛 [7] 지형 갈래의 다리 **복원**. 문턱 불변)`,
        f(ratio, 4)),
      contract('6.rateCap', rate(dozer) <= rate(plain) + BRANCH_RATE_MARGIN + 1e-9,
        `불도저 승률 ≤ 일반 + ${BRANCH_RATE_MARGIN} (옛 +1/20 을 표본 무관하게 적은 것. 문턱 불변)`,
        `${pct(rate(dozer))} 대 ${pct(rate(plain))}`),
      guard('6.dozer.notDominant', '불도저', d,
        '불도저가 짝 부호검정에서 승수·여유 모두 유의하게 앞서지 않는다 (옛 동률 의존 연언의 재유도)'),
      monitor('6.discord',
        '두 팔의 국면이 다른 판의 비율 = "소품 제거라는 상품이 살아 있는가"의 직접 지표이자 검출력의 상한',
        `${d.discord}/${d.n} (${pct(d.discord / Math.max(1, d.n))})`),
    ],
  };
}

/**
 * ── [7] 골드 배분 네 갈래 ────────────────────────────────────────────────────
 * 갈래마다 세 다리: 웨평비 하한(갈래가 살아 있다) · 승률 상한 · **지배 금지**.
 * 앞의 둘은 **문턱 불변**, 셋째만 연언 → 짝 부호검정으로 재유도했다.
 * ⚠ 지배 금지 다리의 α 는 **방어용**(보정 없는 0.05)이다 — 이유와 유도는 envelope.ts
 *   `GUARD_LEGS` 주석. 다리 값의 `MDE …판/…` 가 "몇 판이 갈래 쪽으로 더 뒤집히면
 *   이 계약이 빨개지는가"를 매 실행 계산해 원장에 남긴다.
 *
 * ⚠ **지형 갈래는 [6] 으로 통합했다.** 옛 봉투에서 [7]의 지형 갈래와 [6]의 불도저 팔은
 *   문자 그대로 같은 팔인데 따로 실행되고 있었다(캐시가 우연히 겹쳐 절약되던 자리).
 *   ⚠⚠ **여기 "중복 제거이므로 커버리지 손실이 없다"라고 적혀 있었고 그것은 거짓이었다.**
 *   지형 갈래는 세 다리(웨평비 · 승률 상한 · 지배 금지)를 걸고 있었는데 [6] 에는 웨평비
 *   다리가 없어서, 통합이 곧 계약 하나의 삭제였다. `6.waveRatio` 로 복원했다(그 유도는
 *   judge6 주석). 지금은 세 다리가 다 있으므로 이 문장이 참이다.
 * ⚠ 기지(자연) 갈래의 유일한 방벽은 **승수 동률**이었고(66 = 66), 여유는 4/4 블록에서
 *   이미 갈래 쪽이 앞선다(+1.2~2.1%p). 곧 점추정 동률은 방벽이 아니다. 짝으로 재면
 *   그 우위가 "완충을 더 남기고 승을 조금 잃는 교환"이라는 것이 드러난다 — 연언 구조를
 *   유지하는 것이 여기서 옳다는 근거가 그 숫자다.
 * 판별력: `old-hometown`(이 파일이 적발해 게임을 고쳐 껐던 문서화된 실제 지배 전략) · CAL.
 */
const BRANCHES: readonly { readonly key: string; readonly win: WinName; readonly opts: BotOptions; readonly spent: (r: BotResult) => number }[] = [
  { key: 'unit', win: 'unit', opts: { towerReserve: 600, allies: { minNear: 3 } }, spent: (r) => r.goldAllies },
  { key: 'base600', win: 'base600', opts: { towerReserve: 600, base: {} }, spent: (r) => r.goldBase },
  { key: 'baseNat', win: 'baseNat', opts: { base: {} }, spent: (r) => r.goldBase },
];

export function judge7(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const tower = sweep('l2', prof, patch);
  const legs: Leg[] = [];
  const parts: string[] = [];
  for (const b of BRANCHES) {
    const rs = sweep(b.win, prof, patch, { opts: b.opts });
    const d = duel(rs, tower, nb(prof));
    const ratio = avgWave(rs) / avgWave(tower);
    parts.push(`${b.key} ${wins(rs)}/${rs.length} 웨평비 ${f(ratio, 3)}`);
    legs.push(
      precondition(`7.${b.key}.spent`, sum(rs, b.spent) > 0, `${b.key} 갈래가 실제로 골드를 썼는가`,
        `${sum(rs, b.spent)}`),
      contract(`7.${b.key}.waveRatio`, ratio >= BRANCH_WAVE_RATIO,
        `${b.key} 갈래의 평균 도달 웨이브 비 ≥ ${BRANCH_WAVE_RATIO} — 갈래가 살아 있다 (문턱 불변)`,
        f(ratio, 4)),
      contract(`7.${b.key}.rateCap`, rate(rs) <= rate(tower) + BRANCH_RATE_MARGIN + 1e-9,
        `${b.key} 승률 ≤ 타워 + ${BRANCH_RATE_MARGIN} (문턱 불변)`,
        `${pct(rate(rs))} 대 ${pct(rate(tower))}`),
      guard(`7.${b.key}.notDominant`, b.key, d,
        `${b.key} 갈래가 짝 부호검정에서 승수·여유 모두 유의하게 앞서지 않는다 (옛 동률 의존 연언의 재유도)`),
    );
  }
  const unitAll = sweep('allIn', prof, patch, { opts: { towerReserve: 2400, allies: { minNear: 1 } } });
  const baseAll = sweep('allIn', prof, patch, { opts: { towerReserve: 2400, base: {} } });
  legs.push(
    contract('7.unitAll', rate(unitAll) <= 0.15,
      '유닛 몰빵 완주율 ≤ 0.15 (= 옛 3/20. 문턱 불변)',
      `${pct(rate(unitAll))} (${wins(unitAll)}/${unitAll.length})`),
    contract('7.baseAll', rate(baseAll) <= 0.25,
      '기지 몰빵 완주율 ≤ 0.25 (= 옛 5/20. 문턱 불변)',
      `${pct(rate(baseAll))} (${wins(baseAll)}/${baseAll.length})`),
  );
  return { legs, msg: `타워 ${wins(tower)}/${tower.length} · ${parts.join(' · ')}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// [8] 위약 아군 · [9] 마을 화력
// ═══════════════════════════════════════════════════════════════════════════

const PER_HEAD_FLOOR = 35;
const ALLY_GOLD_RATIO = 0.7;

/**
 * ── [8] 유닛 갈래가 값을 한다 (위약 아군 대조) ───────────────────────────────
 * 문턱은 전부 불변이고(명당 35틱 · 골드비 0.7), 바뀐 것은 표본이 독립 4블록이 된 것과
 * 승수/여유 두 다리를 **짝 부호검정 하나**로 합친 것이다(단순 `≥` → 유의성 = 강화).
 * ⚠ 이 항목에서 가장 얇은 다리는 계약이 아니라 **전제**다: 위약/진짜 아군 골드비가
 *   커밋 블록 0.7521 대 독립 blk2000 **0.7121**(여유 0.0121)이었다. 합산에 걸어 분산을 줄인다.
 * 부족 팔의 자기완결 두 다리(생산 > 0 · 봉쇄 > 0)는 사실상 무조건 참이라 **1블록으로
 * 줄였다** — 판별력 손실 0이고 그 예산이 [9][12] 로 갔다.
 * 판별력: `placebo-allies`(내장) · `near-placebo`(사거리만 0.1) · `old-ally-prices`.
 */
export function judge8(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const real = sweep('ally', prof, patch, { opts: ALLY_OPTS });
  const sham = sweep('ally', prof, patch, { opts: ALLY_OPTS, tables: T_PLACEBO });
  const tribe = sweep('tribeSelf', prof, patch, { opts: TRIBE_HEAVY, tables: undefined });
  const perHead = sum(real, (r) => r.allyBlockTicks) / Math.max(1, sum(real, (r) => r.alliesTrained));
  const goldRatio = sum(sham, (r) => r.goldAllies) / Math.max(1, sum(real, (r) => r.goldAllies));
  const d = duel(real, sham, nb(prof));
  const msg = `명당 ${f(perHead, 2)}틱 · 골드비 ${f(goldRatio, 4)} · ${duelMsg('진짜 대 위약', d)}`;
  return {
    msg,
    legs: [
      precondition('8.trained', sum(real, (r) => r.alliesTrained) > 0 && sum(sham, (r) => r.alliesTrained) > 0,
        '양 팔이 실제로 아군을 뽑았는가',
        `${sum(real, (r) => r.alliesTrained)} / ${sum(sham, (r) => r.alliesTrained)}`),
      precondition('8.goldRatio', goldRatio > ALLY_GOLD_RATIO,
        `위약 아군 골드 > 진짜 × ${ALLY_GOLD_RATIO} — 두 팔이 비슷한 골드를 태웠는가 (문턱 불변, 이 항목에서 가장 얇다)`,
        f(goldRatio, 4)),
      precondition('8.shamZero', sum(sham, (r) => r.allyBlockTicks) === 0,
        '위약은 정의상 한 틱도 못 막는다 (위약이 진짜 위약인지의 검사)',
        `${sum(sham, (r) => r.allyBlockTicks)}`),
      contract('8.perHead', perHead > PER_HEAD_FLOOR,
        `출동 한 명당 봉쇄 인원틱 > ${PER_HEAD_FLOOR} (문턱 불변)`, f(perHead, 2)),
      contract('8.real.dominates', dominatesStable(d, ALPHA),
        '진짜 아군이 위약을 짝 부호검정에서 유의하게 이긴다 (옛 단순 부등식 두 개에서 강화)',
        duelMsg('진짜 대 위약', d)),
      precondition('8.tribe.self', sum(tribe, (r) => r.alliesTrained) > 0 && sum(tribe, (r) => r.allyBlockTicks) > 0,
        '부족 국면에서도 아군이 실제로 뽑히고 교전한다 (대조 없이 혼자 성립하는 자기완결 다리)',
        `생산 ${sum(tribe, (r) => r.alliesTrained)} · 봉쇄 ${sum(tribe, (r) => r.allyBlockTicks)}`),
    ],
  };
}

/**
 * ── [9] 마을 레벨업의 화력 성장이 값을 한다 ──────────────────────────────────
 * 문턱 불변(`Σ baseKills > 위약 × 2`), 표본 20 → 4블록 × 10, 승수 다리를 짝 부호검정으로.
 * 위약이 0~1승 바닥에 붙어 있는 것이 이 항목의 실제 방벽이라 짝 통계가 특히 강하다.
 * 판별력: `hp-only-hometown`(내장 팔과 같은 형태의 패치) · `old-hometown`(역방향 초록 확인).
 */
export function judge9(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const lv1 = BASE_LEVELS[0]!;
  const hpOnly: BaseLevelDef[] = BASE_LEVELS.map((d, i) =>
    i === 0 ? { ...d } : { ...d, dmg: lv1.dmg, cooldownTicks: lv1.cooldownTicks, range: lv1.range },
  );
  const opts: BotOptions = { base: { upTo: 5, save: true } };
  const real = sweep('town', prof, patch, { opts });
  const sham = sweep('town', prof, patch, { opts, tables: { id: 'hpOnlyBase', baseLevels: hpOnly } });
  const d = duel(real, sham, nb(prof));
  const rb = byBlock(real, nb(prof));
  const sb = byBlock(sham, nb(prof));
  const ratios = rb.map((b, i) => sum(b, (r) => r.baseKills) / Math.max(1, sum(sb[i]!, (r) => r.baseKills)));
  const msg = `정품 처치 ${sum(real, (r) => r.baseKills)} 대 HP만 ${sum(sham, (r) => r.baseKills)} · ${duelMsg('정품 대 HP만', d)}`;
  return {
    msg,
    legs: [
      precondition('9.spent', sum(real, (r) => r.goldBase) > 0 && sum(sham, (r) => r.goldBase) > 0 && sum(real, (r) => r.baseShots) > 0,
        '둘 다 실제로 레벨을 올리고 화살을 쐈는가',
        `${sum(real, (r) => r.goldBase)} / ${sum(sham, (r) => r.goldBase)} · 발사 ${sum(real, (r) => r.baseShots)}`),
      contract('9.kills', sum(real, (r) => r.baseKills) > sum(sham, (r) => r.baseKills) * 2,
        '마을 화력 성장의 처치 수가 HP만 자라는 마을의 2배를 넘는다 (문턱 불변)',
        `${sum(real, (r) => r.baseKills)} 대 ${sum(sham, (r) => r.baseKills)}`),
      contract('9.blockKills', ratios.every((x) => x > 2),
        '4블록 전부 배율 > 2 (신설 — 블록 일관성)', ratios.map((x) => f(x, 2)).join(' ')),
      contract('9.real.dominates', dominatesStable(d, ALPHA, true),
        '정품 마을이 HP만 자라는 마을을 짝 부호검정에서 유의하게 이긴다 (옛 strict 부등호 wins(real) > wins(sham) 복원 + 유의성)',
        duelMsg('정품 대 HP만', d)),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [10] 부족 갈래
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── [10] 다섯 번째 갈래 — 부족(아군+마을)도 지배 전략이 아니다 ───────────────
 * · **인라인 시드 배열 삭제** — 옛 코드가 `SEEDS40` 을 글자 그대로 재선언하고 있었다.
 * · 웨평비 ≥ 0.93 **불변**.
 * · 옛 `wins(tribe) ≤ wins(tower) + 1` — **삭제했다가 `10.rateCap` 으로 복원했다.**
 *   삭제 근거는 "40시드에서 승수 표준편차가 ≈2.9판이라 표본 잡음을 문턱으로 쓰고 있었다"
 *   였고, 그 진단 자체는 옳다(독립 blk9000 에서 31 ≤ 31 로 여유 0). 하지만 **삭제는
 *   처방이 아니었다** — 짝 통계는 "지배가 아니다"를 재고, 이 다리는 "합산 승률이 벤치보다
 *   눈에 띄게 높지 않다"는 **다른 것**을 잰다([6]·[7] 은 같은 형태를 `rateCap` 으로 계속
 *   들고 있다. [10]만 잃을 이유가 없었다).
 *   복원 형태: 절대 개수를 비율로 옮긴다 — 옛 `+1판/40시드` = **+2.5%p** 를 그대로 쓴다.
 *   ⚠ [6]·[7] 의 `BRANCH_RATE_MARGIN`(+5%p)을 빌려 쓰지 않았다. 그건 옛 [6]·[7]의
 *   `+1/20` 에서 온 값이라 [10]에 쓰면 문턱이 **두 배로 느슨해진다**(= 완화).
 *   실측 여유는 원장 `10.rateCap` 이 매 실행 기록한다.
 * · 지배 연언 → `dominant(duel(부족, 타워)) === false`. 옛 연언의 두 번째 항이 **절대
 *   잔여 HP** 였는데, 마을을 산 팔은 `baseHpMax` 가 커져 절대값 비교가 자명하게 기울어진다
 *   (이 파일이 `BotResult.baseHpMax` 주석에서 이미 경고하는 함정인데 [10]만 아직 절대값을
 *   쓰고 있었다). 짝 우열 정의가 판당 여유 비율을 쓰므로 그 함정이 사라진다 = 강화.
 * 판별력: `ally-dmg-x3`(역방향) · `old-hometown` · `old-ally-prices`.
 */
export function judge10(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const tower = sweep('l2', prof, patch);
  const tribe = sweep('tribe', prof, patch, { opts: TRIBE_BOT });
  const d = duel(tribe, tower, nb(prof));
  const ratio = avgWave(tribe) / avgWave(tower);
  const msg = `웨평비 ${f(ratio)} · ${duelMsg('부족 대 타워', d)}`;
  return {
    msg,
    legs: [
      precondition('10.spent',
        sum(tribe, (r) => r.goldAllies) > 0 && sum(tribe, (r) => r.goldBase) > 0 && sum(tribe, (r) => r.allyBlockTicks) > 0,
        '둘 다 써야 갈래다 (한쪽이 0이면 유닛이나 기지를 다시 재는 셈)',
        `아군 ${sum(tribe, (r) => r.goldAllies)} · 마을 ${sum(tribe, (r) => r.goldBase)} · 봉쇄 ${sum(tribe, (r) => r.allyBlockTicks)}`),
      precondition('10.baseLevel', Math.max(...tribe.map((r) => r.baseLevel)) > 1,
        '마을이 실제로 올라가 정원이 Lv1(2명)보다 늘어 있는가',
        `${Math.max(...tribe.map((r) => r.baseLevel))}`),
      contract('10.waveRatio', ratio >= BRANCH_WAVE_RATIO,
        `부족 갈래의 평균 도달 웨이브 비 ≥ ${BRANCH_WAVE_RATIO} (문턱 불변)`, f(ratio)),
      contract('10.rateCap', rate(tribe) <= rate(tower) + TRIBE_RATE_MARGIN + 1e-9,
        `부족 승률 ≤ 타워 + ${TRIBE_RATE_MARGIN} (= 옛 wins(tribe) ≤ wins(tower)+1 의 40시드 등가. 복원)`,
        `${pct(rate(tribe))} 대 ${pct(rate(tower))}`),
      guard('10.tribe.notDominant', '부족', d,
        '부족 갈래가 짝 부호검정에서 승수·여유 모두 유의하게 앞서지 않는다 (옛 연언 + 잡음 문턱의 재유도)'),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [11] 정원 곡선
// ═══════════════════════════════════════════════════════════════════════════

const LV1_CAP = 2;
const TRAINED_RATIO = 1.1;
const BLOCKED_RATIO = 1.25;

/**
 * ── [11-a] 표 쪽 — 결정론 ────────────────────────────────────────────────────
 * 문턱은 전부 그대로다(Lv1 = 2 · 레벨마다 엄격 증가 · 미리보기 == 실제 · 만렙 == ALLY_MAX_ACTIVE).
 * 바꾼 것은 시드 1 고정 → 블록 시작점 4개로 늘려 **"시드 무관"이라는 주장을 실제로 보인 것**뿐이다
 * (전투가 없어 비용 ≈ 0).
 * 판별력: `flat-allycap` — 즉시 첫 스테이지 첫 레벨에서 걸린다.
 */
export function judge11a(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const seeds = seedsOf('capDet', prof);
  const rows: string[] = [];
  let ok = true;
  const detail: string[] = [];
  for (const seed of seeds) {
    const curves: string[] = [];
    for (let sid = 1; sid <= 6; sid++) {
      const st = stageById(sid);
      if (!st) continue;
      const { sim } = makeSim({
        stageId: sid, seed, deck: ALL_DECK, patch, tables: { id: 'freeLevels', baseLevels: FREE_LEVELS },
      });
      const caps: number[] = [sim.allyCap()];
      if (sim.allyCap() !== LV1_CAP) { ok = false; detail.push(`s${sid} Lv1 정원 ${sim.allyCap()}`); }
      let prev = sim.allyCap();
      for (let lv = 2; lv <= sim.state.baseLevelMax; lv++) {
        const preview = sim.baseNextStats();
        if (!preview) { ok = false; detail.push(`s${sid} Lv${lv} 미리보기 없음`); break; }
        sim.applyCommand({ type: 'upgradeBase' });
        const now = sim.allyCap();
        if (now !== preview.allyCap) { ok = false; detail.push(`s${sid} Lv${lv} 미리보기 ${preview.allyCap} 대 실제 ${now}`); }
        if (!(now > prev)) { ok = false; detail.push(`s${sid} Lv${lv} 정원 ${prev} → ${now} (레벨업이 머릿수를 팔지 않는다)`); }
        if (now > ALLY_MAX_ACTIVE) { ok = false; detail.push(`s${sid} Lv${lv} 정원 ${now} > 절대 상한 ${ALLY_MAX_ACTIVE}`); }
        caps.push(now);
        prev = now;
      }
      if (prev !== ALLY_MAX_ACTIVE) { ok = false; detail.push(`s${sid} 만렙 정원 ${prev} ≠ ${ALLY_MAX_ACTIVE}`); }
      curves.push(`s${sid}:${caps.join('-')}`);
    }
    rows.push(curves.join(' '));
  }
  const seedFree = new Set(rows).size === 1;
  return {
    msg: rows[0] ?? '',
    legs: [
      contract('11a.strict', ok,
        `전 스테이지에서 Lv1 정원 = ${LV1_CAP} · 레벨마다 엄격 증가 · 미리보기 == 실제 · 만렙 == ${ALLY_MAX_ACTIVE} (문턱 불변)`,
        ok ? (rows[0] ?? '') : detail.slice(0, 6).join(' | ')),
      contract('11a.seedFree', seedFree,
        '네 블록 시작점이 모두 같은 표를 낸다 — 시드 무관이라는 주장을 실제로 보인다 (신설)',
        `${new Set(rows).size}가지`),
    ],
  };
}

/**
 * ── [11-b] 결과 쪽 — 정원 2 자리와 정원 6 자리를 격리 ────────────────────────
 * 문턱 둘(생산 1.10 · 봉쇄 1.25)은 **한 자리도 안 건드렸다**. 바꾼 것은 표본뿐이다:
 *   옛 `SEEDS160_4BLK` = 시작점 1000/1001/1002/1003 (인접) → **독립 4블록**.
 * 인접 4벌이 독립이 아니라는 것은 실측이 확정한다 — 1000벌 봉쇄비 1.6511 대 1001벌 1.0516
 * 으로 **이웃 시드 하나에 0.60이 갈린다**(옛 구조의 실측. 이 트리에는 그 창이 없다).
 * 독립 4블록 합산은 같은 문턱 1.25 에서 ⟦원장 11b.blocked = 1.4720⟧ = 여유 0.222 이고,
 * 인접 합산은 1.264 = 여유 0.014 였다. 곧 **문턱을 한 자리도 안 건드리고 여유의 자릿수가
 * 달라진다**. 이 항목은 표본만 고쳐도 크게 안전해진다.
 *
 * ⚠⚠ **그러나 이 항목의 여유는 꼬리가 만든 것이다 — 보고 대상.** 판별로 짝지어 재면
 *   봉쇄비의 중앙값이 **1을 밑돌고**(⟦원장 11b.pairedMedian = 중앙값 0.967⟧), 비가 1을
 *   넘는 시드도 **절반이 안 된다**(⟦원장 11b.pairedMedian = 비>1 시드 43.75%⟧).
 *   정원 6의 가동률은 정원 2의 절반 남짓이다(⟦원장 11b.pairedMedian = 가동률 1.52% → 0.81%⟧).
 *   곧 늘어난 인원은 대체로 놀고 있고, **판의 과반에서는 정원 6이 정원 2보다 덜 붙잡는다** —
 *   합산 비 1.47 을 만드는 것은 소수의 위급한 판이다.
 *   ⚠ 한때 이 자리에 "중앙값 1.018 · 비>1 절반 남짓"이라고 적혀 있었다. 같은 실행이 쓴
 *     원장과 **1을 사이에 두고 부호가 뒤집힌** 기록이었다 — 곧 정성적 결론까지 틀렸다.
 *     그래서 이 문단의 숫자는 전부 원장 인용으로 바꿨고, 어긋나면 메타 it 이 빨개진다.
 *   ⚠ **지표를 체류(allyTicks)로 갈아 끼우는 처방은 채택하지 않았다** — 정원 2 → 6 은
 *     동시 생존 상한이 3배라 체류비 2.77 은 거의 기계적인 값이고, 그 주장은 [11-a] 의
 *     결정론 다리와 사실상 중복이다. 곧 그건 재유도가 아니라 **완화**다.
 *     여기서 걸리면 문턱이 아니라 **아군 값을 다시 유도하라**(파일 헤더의 지시 그대로).
 * 판별력: `flat-allycap` — 두 팔이 같아져 두 비가 정확히 1.000 이 되고 둘 다 동시에 빨개진다.
 */
export function judge11b(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const only = (allyCap: number): BaseLevelDef[] => [{ ...BASE_LEVELS[0]!, cost: 0, allyCap }];
  const few = sweep('cap', prof, patch, { opts: ALLY_OPTS, tables: { id: `cap${LV1_CAP}`, baseLevels: only(LV1_CAP) } });
  const many = sweep('cap', prof, patch, { opts: ALLY_OPTS, tables: { id: `cap${ALLY_MAX_ACTIVE}`, baseLevels: only(ALLY_MAX_ACTIVE) } });
  const trained = (rs: BotResult[]): number => sum(rs, (r) => r.alliesTrained);
  const blocked = (rs: BotResult[]): number => sum(rs, (r) => r.allyBlockTicks);
  const tRatio = trained(many) / Math.max(1, trained(few));
  const bRatio = blocked(many) / Math.max(1, blocked(few));
  const pairRatios = many.map((r, i) => {
    const b = few[i]!.allyBlockTicks;
    return b > 0 ? r.allyBlockTicks / b : r.allyBlockTicks > 0 ? Infinity : 1;
  }).filter((x) => Number.isFinite(x));
  const uptime = (rs: BotResult[]): number => blocked(rs) / Math.max(1, sum(rs, (r) => r.allyTicks));
  const msg = `생산비 ${f(tRatio, 3)} · 봉쇄비 ${f(bRatio, 3)} (정원${LV1_CAP} ${trained(few)}/${blocked(few)} · 정원${ALLY_MAX_ACTIVE} ${trained(many)}/${blocked(many)})`;
  return {
    msg,
    legs: [
      precondition('11b.alive', trained(few) > 0 && blocked(few) > 0, '양쪽 다 실제로 뽑고 붙잡았는가',
        `${trained(few)} / ${blocked(few)}`),
      contract('11b.trained', trained(many) > trained(few) * TRAINED_RATIO,
        `정원 ${ALLY_MAX_ACTIVE} 팔의 생산이 정원 ${LV1_CAP} 팔의 ${TRAINED_RATIO}배를 넘는다 (문턱 불변, 표본만 독립 4블록)`,
        f(tRatio, 4)),
      contract('11b.blocked', blocked(many) > blocked(few) * BLOCKED_RATIO,
        `같은 팔의 봉쇄가 ${BLOCKED_RATIO}배를 넘는다 (문턱 불변, 표본만 독립 4블록 — 인접 4벌 대비 여유 24배)`,
        f(bRatio, 4)),
      monitor('11b.pairedMedian',
        '⚠ 보고 대상: 판별로 짝지은 봉쇄비의 중앙값과 가동률. 합산 봉쇄비의 여유가 꼬리에서 온다는 사실',
        `중앙값 ${f(median(pairRatios), 3)} · 비>1 시드 ${pct(share(pairRatios, (x) => x > 1))} · 가동률 ${pct(uptime(few))} → ${pct(uptime(many))}`),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [12] 입구 요격
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **새 다리라 배포본 실측에서 유도했다** — 옛 봉투에는 없던 선언이므로 어떤 완화도 아니다.
 * 실측은 ⟦원장 12.frontOnly = 2.50%⟧ 다(한때 이 자리에 "3/80 = 3.75%"라고 적혀 있었는데
 * 같은 실행이 쓴 원장과 어긋나 있었다 — 낡은 기록이라 원장 인용으로 바꿨다).
 * 이 다리의 몫은 **크기가 아니라 형태**다 ("입구 요격이 이기는 판은 마을 앞에 세워도
 * 이기는 판"). 유의성은 `12.home.dominates`, 크기는 `12.slackSign` 이 진다.
 *
 * ⚠⚠ **문턱을 0.10 → 0.05 로 조였다(2배 강화).** 옛 0.10 은 실측의 4배라 아무것도 안 잡았고,
 *   같은 자리 주석이 "전체의 2% 이하"라 코드와도 어긋나 있었다(그 문장은 지웠다 — 선언은
 *   상수 하나뿐이어야 한다).
 *   새 문턱의 유도는 커밋 창이 아니라 **400짝**이다. 창 대장 밖 독립 네 창을 더해 쟀다
 *   (off 400 · 460 · 520 · 580, 각 4블록×20. 이 커밋의 유도 실측이라 원장에 없다):
 *     창별 front-only 비율 2.50 / 5.00 / 3.75 / 11.25 / 2.50 % · **합산 20/400 = 5.00%**
 *   곧 모집단 값이 5% 언저리라 문턱을 그 자리에 둔다.
 *    · 창 `stance` 에서의 여유 = **2판**(2.50% → 5.00%).
 *    · **최소 검출 효과크기**: front 만 이기는 판이 80판 중 **5판**이 되면 빨개진다(지금 2판).
 *    · ⚠ 정직하게 적는다: off 520 창은 단독으로 11.25% 라 이 문턱을 못 넘는다. 곧 이 다리는
 *      창에 민감하고, 그래서 문턱을 커밋 창이 아니라 400짝 합산에서 유도했다. 여기서 걸리면
 *      문턱이 아니라 **창을 넓혀서 다시 재라**(창을 골라 통과시키는 것이 이 파일의 병이다).
 */
const FRONT_ONLY_CAP = 0.05;
/**
 * **삭제됐던 승률 격차 15%p 크기 선언이 옮겨 앉은 축.** 판당 여유의 부호가 home 쪽인 판이
 * front 쪽인 판의 몇 배여야 하는가. 왜 축을 옮겼는지의 실측은 judge12 주석에 있다.
 */
const SLACK_SIGN_RATIO = 2;
/** 위 크기 다리가 공허해지지 않으려면 부호가 갈린 판이 최소 몇이어야 하는가 (실측 최소 33) */
const SLACK_DECIDED_MIN = 20;
const STANCE_WAVE_RATIO = 1.01;
const LIFE_RATIO = 2;

/**
 * ── [12] 입구 요격 — 갈 수는 있지만 이기지 못한다 ────────────────────────────
 * 자리 검사(최전선) · 웨평비 ≤ 1.01 · 여유 · 생존비 2배는 **전부 문턱 불변**이다.
 *
 * ⚠⚠ **승률 격차 ≥ 15%p 다리 — 삭제됐다가 이 커밋에서 축을 옮겨 재유도했다.** ────────
 *
 * (1) **삭제 근거의 숫자가 틀렸다.** 삭제 주석은 "이 창에서 실측이 옛 문턱과 같아 배포본이
 *     빨갛다"고 적었는데, **같은 실행이 쓴 원장은 ⟦원장 12.rateGap = 23.75%p⟧** 다
 *     (⟦원장 12.home.dominates = 승 67/80 대 48/80⟧). 곧 배포본은 옛 문턱을 8.75%p 여유로
 *     통과하고 있었다. 인용한 "320시드 합산 15.000%p" 는 창 `stance` 에서 나온 값이 아니고,
 *     어느 표본에서 잰 것인지도 적혀 있지 않다 — 이 파일이 반복해서 걸린 병(다른 트리에서
 *     잰 숫자를 손으로 옮긴다)이 **설계 중심 결정을 정당화하는 자리에** 나타난 것이다.
 *
 * (2) **그래서 직접 다시 쟀다** — 창 대장 밖 독립 네 창을 더해 **400짝**
 *     (off 400 · 460 · 520 · 580, 각 4블록×20. 이 커밋의 유도 실측이라 원장에 없다):
 *       창          stance   400     460     520     580     합산
 *       승률 격차   23.75   16.25   13.75    3.75   23.75   **16.25%p**
 *       불일치쌍    21:2    17:4    14:3    12:9    21:2    85:20
 *       여유 부호   32:11   26:7    34:6    26:11   33:6    151:41
 *     합산 격차 16.25%p · **짝 표준오차 2.43%p** · 95% CI [11.49, 21.01]%p.
 *
 * (3) **판정: 옛 문턱 15%p 는 모집단 효과와 같은 자리가 맞다.** 모집단 추정 16.25%p 의
 *     **0.51 짝-SE 아래**다(= 커밋 창이 초록인 것은 그 창이 +7.5%p 이상치이기 때문이다).
 *     그대로 복원하면 다섯 창 중 **둘(13.75 · 3.75%p)에서 배포본이 빨갛다** — 게임이 정상인데
 *     창 운으로 40%가 빨간 계약은 계약이 아니라 복권이다. 표본을 늘려 고칠 수도 없다:
 *     참값 16.25%p 에서 문턱 15%p 를 95% 확률로 넘으려면 SE ≤ 0.76%p, 곧 **약 4,100짝**이
 *     필요하다(지금 80짝). 승률 축은 이 크기 선언을 실행 가능한 어떤 표본에서도 못 진다.
 *
 * (4) **처방 — 삭제가 아니라 축 이동.** 같은 주장("입구 요격은 마을 앞보다 확실히 못한다")을
 *     판당 여유 부호 축에서 재면 상대 산포가 **6분의 1**이다(위 표에서 계산):
 *       승률 격차     평균 16.25%p · 표준편차 8.29%p → 변동계수 **0.51**
 *       여유 우위 비율 74.4 / 78.8 / 85.0 / 70.3 / 84.6 % · 평균 78.6% · 표준편차 6.4%p → **0.08**
 *     그래서 `12.slackSign` = "여유가 home 쪽인 판이 front 쪽인 판의 **2배 이상**"을 세운다.
 *     다섯 창 전부 통과하고 최소 여유가 4판이다(off 520 에서 26:11).
 *     이건 유의성이 아니라 **크기** 선언이다 — `12.home.dominates` 는 부호검정 p 만 보므로
 *     n 이 크면 아주 작은 우위로도 통과한다. 둘은 서로를 대신하지 않는다.
 *
 * (5) **옛 보장과 강도 비교** (커밋 창 기준, "몇 판이 넘어오면 빨개지는가"):
 *       옛 `격차 ≥ 15%p`  → front 가 **7판** 더 이기면 빨강 (67:48 → 67:55).
 *       새 `12.slackSign` → 여유 부호가 **4판** 넘어오면 빨강 (32:11 → 28:15).
 *     새 다리가 더 빨리 발화한다 = 완화가 아니다. 다만 **승률이라는 눈금 자체를 잃은 것은
 *     사실**이므로 `12.rateGap` 을 감시로 계속 인쇄하고, 여기 표를 남겨 다음 사람이
 *     표본을 넓힐 때 바로 다시 유도할 수 있게 한다.
 *  ⚠ `12.slackSign` 은 두 팔이 완전히 같아지면(부호 0:0) 공허하게 참이 된다. 그 상태는
 *    전제 `12.slackDecided`(부호가 갈린 판 ≥ 20)가 먼저 잡는다.
 * 판별력(신설): `placebo-allies` — 위약 아군은 봉쇄를 못 하므로 두 팔이 사실상 같아지고
 *   술어가 거짓이 되어야 한다. 곧 "이 항목이 재는 것은 아군의 자리 선택이지 봇의 다른
 *   차이가 아니다"가 증명된다. **이 커밋에서 새 두 다리를 그 되돌리기로 직접 확인했다**:
 *     `12.slackSign` 32:11 → **12:13 (빨강)** · `12.frontOnly` 2.50% → **6.25% (빨강)**
 *   ⚠ 뒤엣것은 문턱을 0.10 그대로 뒀으면 **초록**이었다 — 조인 것이 실제로 일을 한다는 증거다.
 *   그리고 전제 `12.slackDecided` 는 이때도 25/80 이라 크기 다리가 공허해지지 않는다.
 *   ⚠ `placebo-allies` 의 `targets` 에 두 다리를 얹는 것은 controls.ts 쪽 작업이라 여기서는
 *     실측만 남긴다(보고서에 정확한 추가분을 적었다).
 */
export function judge12(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const stage = stageById(1);
  if (!stage) throw new Error('no stage 1');
  const pathLen = Math.min(...stage.paths.map((wp) => buildPath(wp).totalLength));
  const homeOpts: BotOptions = { towerReserve: 600, allies: { minNear: 1, stance: 'home' } };
  const frontOpts: BotOptions = { towerReserve: 600, allies: { minNear: 1, stance: 'front' } };
  const home = sweep('stance', prof, patch, { opts: homeOpts });
  const front = sweep('stance', prof, patch, { opts: frontOpts });
  const d = duel(home, front, nb(prof));
  const life = (rs: BotResult[]): number => sum(rs, (r) => r.allyTicks) / Math.max(1, sum(rs, (r) => r.alliesTrained));
  const minDist = (rs: BotResult[]): number => Math.min(...rs.map((r) => r.allyBlockMinDist));
  /** front 만 이긴 시드 — "입구 요격이 이기는 판은 마을 앞에 세워도 이기는 판"의 반례 수 */
  const frontOnlyShare = home.filter((h, i) => !h.won && front[i]!.won).length / Math.max(1, home.length);
  const hb = byBlock(home, nb(prof));
  const fb = byBlock(front, nb(prof));
  const slackSigns = hb.map((b, i) => (slackAvg(b) > slackAvg(fb[i]!) ? '+' : '-')).join('');
  const msg =
    `home ${pct(rate(home))} 여유 ${pct(slackAvg(home))} 최전선 ${f(minDist(home), 2)} 생존 ${life(home).toFixed(0)}틱 / ` +
    `front ${pct(rate(front))} 여유 ${pct(slackAvg(front))} 최전선 ${f(minDist(front), 2)} 생존 ${life(front).toFixed(0)}틱 (경로 ${f(pathLen, 2)})`;
  return {
    msg,
    legs: [
      precondition('12.frontReaches', minDist(front) < pathLen * 0.15,
        'front 팔이 정말로 입구까지 갔는가 — 규칙이 되살아나 스폰 근처를 막으면 여기서 먼저 걸린다',
        `${f(minDist(front), 2)} < ${f(pathLen * 0.15, 2)}`),
      precondition('12.homeStays', minDist(home) > pathLen * 0.6,
        'home 팔은 마을 앞에 머문다', `${f(minDist(home), 2)} > ${f(pathLen * 0.6, 2)}`),
      contract('12.home.dominates', dominatesStable(d, ALPHA),
        '마을 앞에 세우는 봇이 입구에 세우는 봇을 짝 부호검정에서 유의하게 지배한다 (옛 15%p 크기 문턱의 재유도)',
        duelMsg('home 대 front', d)),
      precondition('12.slackDecided', d.slackPos + d.slackNeg >= SLACK_DECIDED_MIN,
        `판당 여유의 부호가 갈린 판 ≥ ${SLACK_DECIDED_MIN} — 아래 크기 다리가 공허하게 참이 되는 상태를 먼저 잡는다`,
        `${d.slackPos + d.slackNeg}/${d.n}`),
      contract('12.slackSign', d.slackPos >= SLACK_SIGN_RATIO * d.slackNeg,
        `판당 여유가 home 쪽인 판이 front 쪽인 판의 ${SLACK_SIGN_RATIO}배 이상 ` +
        `(삭제됐던 승률 격차 15%p 크기 선언의 축 이동 재유도. 커밋 창에서 4판이 넘어오면 빨강)`,
        `${d.slackPos}:${d.slackNeg}`),
      contract('12.frontOnly', frontOnlyShare <= FRONT_ONLY_CAP,
        `front 만 이긴 시드의 비율 ≤ ${pct(FRONT_ONLY_CAP)} — "입구 요격이 이기는 판은 마을 앞에 세워도 이기는 판" (신설 · 확률적 지배)`,
        pct(frontOnlyShare)),
      contract('12.waveRatio', avgWave(front) / avgWave(home) <= STANCE_WAVE_RATIO,
        `front 웨평비 ≤ ${STANCE_WAVE_RATIO} (문턱 불변)`, f(avgWave(front) / avgWave(home))),
      contract('12.slack', slackAvg(front) < slackAvg(home),
        'front 의 여유가 home 보다 작다 (문턱 불변)',
        `${pct(slackAvg(front))} < ${pct(slackAvg(home))}`),
      contract('12.life', life(home) > life(front) * LIFE_RATIO,
        `기전 — 앞에 세운 부족원은 빨리 죽는다 (생존비 > ${LIFE_RATIO}배, 문턱 불변)`,
        f(life(home) / Math.max(1, life(front)), 2)),
      monitor('12.blockSlack', '블록별 여유 부호 (판정에 쓰지 않는다)', slackSigns),
      monitor('12.rateGap',
        '⚠ 옛 승률 격차 다리(문턱 15%p)가 지금 얼마인지 — 크기 선언은 `12.slackSign` 으로 축을 옮겼고, ' +
        '승률 눈금 자체는 잃었으므로 그 값을 매 실행 계속 기록한다(표본이 넓어지면 여기서 다시 유도하라)',
        `${((rate(home) - rate(front)) * 100).toFixed(2)}%p`),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [13] 무한 모드
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── [13] 무한 모드에서 아군이 무한 방벽이 되지 않는다 ────────────────────────
 * 문턱 전부 불변(`부족 ≤ 타워` · `몰빵 < 타워 × 0.8` · `won || wave < 500`).
 * 바꾼 것: 표본을 `SEEDS.slice(0,12)`(접두!) → 창(endless) 독립 4블록으로 옮기고,
 * `부족 ≤ 타워` 한 줄에 **짝 부호검정을 더했다**(옛 주석이 "동전 던지기"라 스스로 적어 둔 자리).
 * ⚠ **`won || wave < 500` 만은 극값으로 남긴다** — 이건 상한이 아니라 **종료 보장**이라
 *   표본이 커져도 성질이 바뀌지 않는다. 이 파일에서 극값이 허용되는 유일한 형태다.
 * 판별력: `ally-dmg-x3`(아군이 무한 방벽이 되는 세계) · `old-ally-prices`.
 */
export function judge13(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const opt = { endless: true };
  const tower = sweep('endless', prof, patch, { ...opt });
  const tribe = sweep('endless', prof, patch, { ...opt, opts: TRIBE_BOT });
  const allIn = sweep('endless', prof, patch, { ...opt, opts: { towerReserve: 2400, allies: { minNear: 1 }, base: {} } });
  const ps = pairedSign(tribe.map((r) => r.wave), tower.map((r) => r.wave));
  const tribeMde = mdeSign(ps.pos, ps.neg, tribe.length, ALPHA_GUARD);
  recordMde('13.tribe.notAhead', tribeMde);
  const msg = `타워 ${f(avgWave(tower), 2)} / 부족 ${f(avgWave(tribe), 2)} / 아군몰빵 ${f(avgWave(allIn), 2)} · 짝부호 ${ps.pos}:${ps.neg}(p ${ps.p.toExponential(2)})`;
  return {
    msg,
    legs: [
      precondition('13.alive', sum(tribe, (r) => r.allyBlockTicks) > 0 && Math.max(...tribe.map((r) => r.baseLevel)) > 1,
        '부족 갈래가 실제로 마을을 올리고 봉쇄했는가',
        `봉쇄 ${sum(tribe, (r) => r.allyBlockTicks)} · 최대 Lv ${Math.max(...tribe.map((r) => r.baseLevel))}`),
      contract('13.terminates', tribe.every((r) => r.won || r.wave < 500),
        '무한 모드는 끝난다 — 상한이 아니라 **종료 보장**이라 이 항목에서만 극값을 남긴다 (문턱 불변)',
        `${Math.max(...tribe.map((r) => r.wave))}`),
      contract('13.tribeAvg', avgWave(tribe) <= avgWave(tower),
        '부족 갈래의 평균 도달 웨이브가 타워 몰빵을 넘지 않는다 (문턱 불변)',
        `${f(avgWave(tribe), 2)} ≤ ${f(avgWave(tower), 2)}`),
      contract('13.tribe.notAhead', ps.p > ALPHA_GUARD,
        '부족 갈래가 짝 부호검정에서 타워 몰빵을 유의하게 앞서지 않는다 (신설 — 옛 주석이 "동전 던지기"라 적은 자리)',
        `${ps.pos}:${ps.neg} p ${ps.p.toExponential(3)} Δ̄ ${f(ps.meanDelta, 3)} · ${mdeMsg(tribeMde)}`),
      contract('13.allIn', avgWave(allIn) < avgWave(tower) * 0.8,
        '아군 몰빵은 확실히 벌을 받는다 (문턱 불변)',
        f(avgWave(allIn) / Math.max(1, avgWave(tower)), 4)),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [14] 아군의 한계 가치
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── [14] 마을을 양 팔에 똑같이 고정해도 진짜가 위약을 이긴다 ─────────────────
 * **이 파일에서 시드 설계가 유일하게 처음부터 옳았던 항목**이다(독립 4블록). 바꾼 것 셋:
 *  · 인라인 `SEEDS320` 선언을 창(marginal)으로 옮겼다 — 옛 배열의 첫 벌이 `SEEDS80` 과
 *    **글자 그대로 같아** [6][7][8] 과 같은 판을 밟고 있었다. 창을 주면 그 겹침이 사라진다.
 *  · 승수·잔여HP 두 다리 → 짝 부호검정 하나(단순 `≥` → 유의성 = 강화). 잔여 HP 다리는
 *    절대 비교라 남겨 두되 계약으로 유지한다.
 *  · **표본 4×80 → 4×30.** 이 설계에서 유일한 표본 축소이고 런타임 자금원이다(−0.9배).
 *    근거: 두 팔의 마을이 바이트 단위로 같고 위약은 dmg·봉쇄·사거리만 0이라 **판마다
 *    우열이 거의 항상 갈린다**. 짝 통계는 그 불일치 수에 비례해 검출력을 얻으므로,
 *    합계 승수(267 대 249)를 보는 것보다 훨씬 적은 판으로 같은 결론에 닿는다.
 *    ⚠ 되돌릴 손잡이: 짝 검정이 예상만큼 유의하지 않으면 창의 `per` 를 30 → 60 으로 올린다.
 *      **줄이지는 마라** — 줄이는 순간 판정이 다시 한 벌의 운에 걸린다.
 *    ⚠⚠ **실측에서 승수 축이 정확히 동률이다**(원장 참조). 옛 봉투 주석이 "승수 어서션이
 *      표본 운에 좌우된다"고 반복해서 경고한 바로 그 자리이고, 이 라운드도 같은 것을 본다.
 *      이 항목을 지고 있는 것은 **여유 축**이다 — 부호가 자릿수로 유의하고 4블록 전부
 *      같은 방향이다. 승수 축은 옛 문턱(`진짜 ≥ 위약`)을 그대로 들고 있는 비열등 다리로만 남는다.
 * 판별력: `placebo-allies`(위약 그 자체) · `near-placebo` · `flat-allycap`.
 */
export function judge14(patch: DataPatch = BASE, prof: Profile = FULL): Judged {
  const PIN: BaseLevelDef[] = [{ ...BASE_LEVELS[2]!, cost: 0 }];
  const real = sweep('marginal', prof, patch, { opts: ALLY_OPTS, tables: { id: 'pinLv3', baseLevels: PIN } });
  const sham = sweep('marginal', prof, patch, {
    opts: ALLY_OPTS, tables: { id: 'pinLv3+placebo', baseLevels: PIN, allies: PLACEBO_ALLIES },
  });
  const d = duel(real, sham, nb(prof));
  const goldRatio = sum(sham, (r) => r.goldAllies) / Math.max(1, sum(real, (r) => r.goldAllies));
  const msg = duelMsg('진짜 대 위약(마을 Lv3 고정)', d);
  return {
    msg,
    legs: [
      precondition('14.trained', sum(real, (r) => r.alliesTrained) > 0, '실제로 아군을 뽑았는가',
        `${sum(real, (r) => r.alliesTrained)}`),
      precondition('14.goldRatio', goldRatio > ALLY_GOLD_RATIO,
        `위약 아군 골드 > 진짜 × ${ALLY_GOLD_RATIO} (문턱 불변)`, f(goldRatio, 4)),
      precondition('14.pinned',
        sum(real, (r) => r.goldBase) === 0 && Math.max(...real.map((r) => r.baseLevel)) === 1,
        '마을이 정말 고정됐는가 (한 칸짜리 표라 레벨업 자체가 불가능하다)',
        `골드 ${sum(real, (r) => r.goldBase)} · 최대 Lv ${Math.max(...real.map((r) => r.baseLevel))}`),
      precondition('14.shamZero', sum(sham, (r) => r.allyBlockTicks) === 0, '위약은 정의상 한 틱도 못 막는다',
        `${sum(sham, (r) => r.allyBlockTicks)}`),
      contract('14.real.dominates', dominatesStable(d, ALPHA),
        '진짜 아군이 위약을 짝 부호검정에서 유의하게 이긴다 (옛 단순 부등식에서 강화)',
        duelMsg('진짜 대 위약', d)),
      contract('14.hp', sum(real, (r) => r.baseHpLeft) > sum(sham, (r) => r.baseHpLeft),
        '잔여 기지 HP 합에서도 진짜가 앞선다 (문턱 불변 — 두 팔의 마을이 같아 절대 비교가 성립한다)',
        `${sum(real, (r) => r.baseHpLeft)} 대 ${sum(sham, (r) => r.baseHpLeft)}`),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 전체 목록 — 봉투와 대조군 스위트가 같은 표를 읽는다
// ═══════════════════════════════════════════════════════════════════════════

export interface Item {
  readonly id: string;
  readonly title: string;
  readonly judge: (patch: DataPatch, prof: Profile) => Judged;
  /** vitest 타임아웃 (ms) — 스윕 크기에 맞춰 준다 */
  readonly timeout: number;
}

export const ITEMS: readonly Item[] = [
  { id: 'cal', title: '교정 팔 — 지배 술어가 실제 우위를 잡는다 (계기)', judge: judgeCal, timeout: 300_000 },
  { id: 'collapse', title: '붕괴 팔 — [1-a][2][3] 이 실제로 무언가를 잠근다 (계기)', judge: judgeCollapse, timeout: 300_000 },
  { id: '1a', title: '스테이지1 하한 팔 — 넓은 시드에서 과반이 완주하고 꼬리도 후반까지 간다', judge: judge1a, timeout: 300_000 },
  { id: '1b', title: '스테이지1 상한 팔 — 잘 두는 사람에게도 마지막 한 마리는 아프다', judge: judge1b, timeout: 300_000 },
  { id: '2', title: '습격대가 실제로 타워를 부순다 (클리어해도 값은 치른다)', judge: judge2, timeout: 300_000 },
  { id: '3', title: '파괴가 죽음의 나선으로 번지지 않는다', judge: judge3, timeout: 300_000 },
  { id: '4', title: '경로 밀착 배치는 클리어하지 못한다 (배치 거리 = 실력 축)', judge: judge4, timeout: 600_000 },
  { id: '5', title: '방치(타워 0)면 웨이브 5 안에 패배', judge: judge5, timeout: 120_000 },
  { id: '5b', title: '스테이지6 별 0 봇은 클리어 불가 (난이도 서열)', judge: judge5b, timeout: 300_000 },
  { id: '6', title: '불도저 봇이 스테이지1 을 더 쉽게 만들지 않는다', judge: judge6, timeout: 600_000 },
  { id: '7', title: '골드 배분 네 갈래 — 적정 배분은 살아 있고, 몰빵은 무너진다', judge: judge7, timeout: 900_000 },
  { id: '8', title: '유닛 갈래가 값을 한다 — 같은 골드를 태우는 위약 아군보다 낫다', judge: judge8, timeout: 900_000 },
  { id: '9', title: '마을 레벨업의 화력 성장이 값을 한다', judge: judge9, timeout: 600_000 },
  { id: '10', title: '다섯 번째 갈래 — 부족(아군+마을)도 지배 전략이 아니다', judge: judge10, timeout: 600_000 },
  { id: '11a', title: '정원 곡선 (a) 표 쪽 — 레벨마다 정원이 엄격히 증가한다', judge: judge11a, timeout: 120_000 },
  { id: '11b', title: '정원 곡선 (b) 결과 쪽 — 실제로 더 많이 나가 더 많이 붙잡는다', judge: judge11b, timeout: 600_000 },
  { id: '12', title: '입구 요격 — 갈 수는 있지만 이기지 못한다', judge: judge12, timeout: 600_000 },
  { id: '13', title: '무한 모드: 정원이 늘어도 아군이 무한 방벽이 되지 않는다', judge: judge13, timeout: 600_000 },
  { id: '14', title: '아군의 한계 가치 — 마을을 양 팔에 고정해도 진짜가 위약을 이긴다', judge: judge14, timeout: 900_000 },
  { id: '17', title: '불도저 봇도 스테이지6 은 클리어 불가', judge: judge17, timeout: 300_000 },
];

/**
 * 항목이 실제로 쓰는 창.
 *
 * ⚠ **이 표는 이제 손 관리 표가 아니다.** 봉투가 각 항목을 `envelope.withItem` 컨텍스트
 * 안에서 돌리며 `seedBlocks` 호출을 계측하고, 메타 it 이 **관측된 창 집합과 이 표를 정확
 * 일치**로 대조한다. 항목이 창을 하나 더 읽거나 덜 읽으면 여기서 걸린다(옛 구조에서는
 * 표와 실제가 어긋나도 아무도 몰랐고, 그러면 "선언된 공유 = 실제 공유" 검사가 선언끼리
 * 비교하는 셈이 된다). 표를 지우지 마라 — 관측만으로는 "무엇을 쓰기로 했는가"가 안 남는다.
 */
export const WINDOW_USE: Readonly<Record<string, readonly WinName[]>> = {
  cal: ['cal', 'base1'],
  collapse: ['collapse'],
  '1a': ['base1'],
  '1b': ['strong', 'strongCal'],
  '2': ['base1'],
  '3': ['base1'],
  '4': ['hug', 'base1', 'strong', 'strongHug'],
  '5': ['idle'],
  '5b': ['s6'],
  '6': ['l2', 'dozer'],
  '7': ['l2', 'unit', 'base600', 'baseNat', 'allIn'],
  '8': ['ally', 'tribeSelf'],
  '9': ['town'],
  '10': ['l2', 'tribe'],
  '11a': ['capDet'],
  '11b': ['cap'],
  '12': ['stance'],
  '13': ['endless'],
  '14': ['marginal'],
  '17': ['s6'],
};
