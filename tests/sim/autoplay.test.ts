/**
 * 자동플레이 밸런스 봉투 — 난이도 계약을 CI에 고정한다.
 * 봇 구현과 "봇이 왜 이렇게 두는가"의 근거는 tests/sim/botharness.ts 헤더에 있다.
 *
 * ╔═════════════════════════════════════════════════════════════════════════╗
 * ║ 이 파일의 규칙은 바뀌지 않았다:                                          ║
 * ║ **문턱을 낮추지 않는다 — 게임을 고치거나, 판별력을 유지한 채 선언을      ║
 * ║ 재도출한다.** 이번 라운드가 고친 것은 그 위에 얹혀 있던 **표본 설계**다. ║
 * ╚═════════════════════════════════════════════════════════════════════════╝
 *
 * ── 무엇이 잘못돼 있었나 ────────────────────────────────────────────────────
 * 옛 봉투는 시드 상수를 셋 들고 있었고 `SEEDS ⊂ SEEDS40 ⊂ SEEDS80` 이었다. 셋이 한
 * 수열의 앞부분이라 "20시드 항목"과 "80시드 항목"이 **문자 그대로 같은 판**을 봤고,
 * 17개 중 15개가 시작점 1000 한 블록 안에서만 살았다. 결과가 셋이다:
 *  · 항목들이 서로 독립이 아니었다 — 통계적으로가 아니라 문자 그대로.
 *  · 표본을 20 → 80 으로 늘려도 독립성이 하나도 안 늘었다. 같은 판을 더 오래 볼 뿐이다.
 *  · 여러 항목의 유일한 방벽이 **승수/여유 동률**이었다(60/60 · 66/66 · 소수점 이하 전부).
 *    한 판만 넘어가면 빨개지는 상태였고, 실제로 배포본이 독립 블록 넷 중 하나에서
 *    다섯 군데 깨졌다.
 * 그리고 기록이 계속 낡았다 — 배포본에서 전 항목을 다시 재니 **17개 중 12개**의 주석
 * 실측이 실제와 어긋나 있었다(1-a 15→16 · 1-b 54.3%→46.70% · 3번 최소 7→8 ·
 * 6번 60/60→66/67 · 12번 57.5%→60.0% …). 공통점은 "다른 트리에서 잰 숫자를 손으로 합쳤다"다.
 *
 * ── 이번 라운드가 바꾼 것 ───────────────────────────────────────────────────
 *  (a) **표본 독립성** — 시드 상수를 항목마다 만들던 구조를 없앴다. 표본 정책은
 *      tests/sim/envelope.ts 의 **창 대장(WINDOWS)** 한 곳에만 있고, 항목은 창 이름
 *      하나를 고른다. 창이 다르면 시드가 안 겹치고, 창이 같으면(`pairOf`) 그건
 *      **짝 비교라서 공유가 필수인 자리**다. 아래 메타 it 이 그 규약을 강제한다.
 *      시드는 독립 블록 4벌(1000 / 2000 / 5000 / 9000)에서 공차 37로 뽑는다.
 *  (b) **원리 있는 선언** — 동률이 방벽이던 자리를 **짝 부호검정**으로 재유도했다.
 *      마진은 한 톨도 넣지 않았다: 문턱은 여전히 "우위 0"이고, 더한 것은 "그 우위가
 *      잡음이 아니다" 하나뿐이다. α 는 **두 갈래**다 — 발견용(`X 가 Y 를 이긴다`)은
 *      방향 다리 수에서 Bonferroni 로 유도해 다리를 더하면 자동으로 좁아지고(사후선택 방지),
 *      방어용(`X 는 지배 전략이 아니다`)은 **보정하지 않는다**. 방어용은 `p > α` 로 통과하는
 *      형태라 α 를 줄이면 계약이 **약해지기** 때문이다(옛 구조는 여기에 같은 α 를 써서
 *      여섯 계약을 방향과 반대로 느슨하게 만들고 있었다 — envelope.ts `GUARD_LEGS` 주석).
 *      그리고 방어용 다리마다 **최소 검출 효과크기**(MDE)를 계산해 값에 싣고, 메타 it 이
 *      "실패 불가능한 계약이 하나도 없다"를 검사한다.
 *      극값 선언(`전 시드 X ≥ k`)은 **금지**했다 — 통과 확률이 `(1−q)^n` 이라 표본을
 *      늘리면 단조 감소해서, "표본을 늘린다"는 이 파일의 유일한 처방과 정면으로 싸운다.
 *      분위수 + 절대 바닥으로 쪼갠다. (예외는 [13] 의 종료 보장 하나. 그 항목 주석 참조)
 *  (c) **판별력 증명** — 대조군이 실행 가능해졌다. 두 층이다:
 *      · **매 실행**(약 21초): 교정 팔 CAL(stars 1)이 지배 술어가 실제 우위를 잡는지,
 *        붕괴 팔(밀착+수리포기)이 [1-a][2][3] 의 다섯 다리를 실제로 깨는지 증명한다.
 *      · **옵트인**: tests/sim/controls.ts 의 되돌리기 **19개** × tests/sim/autoplay.control.test.ts.
 *        실측: fast 등급 9분 28초에 전부 초록(1개는 full 전용). 무엇이 무엇을 깨우는지는
 *        각 되돌리기의 `targets` 와 주석에 실측으로 적혀 있다.
 *      · **커버리지는 이제 코드가 센다**(메타 it). 계약 다리 71개 중 대조군이 겨냥하는 것이
 *        53개, 나머지 18개는 controls.UNPROVEN 에 **사유와 함께** 실려 있고, 둘 다 아닌 다리가
 *        하나라도 있으면 빨개진다. 이 검사를 넣기 전에는 66개 중 38개가 아무 대조군도
 *        안 겨냥하는데 목록에는 다섯만 실려 있었다 — 그중 둘이 '지배 금지' 계약이었다.
 *      · **판정 불가를 공시한다.** fast 등급에서 기준선이 이미 빨간 다리(표본이 모자라
 *        판정할 수 없는 자리)는 카탈로그의 `fullOnly` 에 선언된 것만 허용되고, 초록 실행에서도
 *        어느 다리가 판정 불가였는지 찍힌다. 옛 규칙은 "전부 판정 불가일 때만 빨강"이라
 *        넷 중 셋이 판정 불가여도 조용히 통과했다.
 *  (d) **기록이 안 낡게** — 실측값을 주석에 손으로 베끼지 않는다. 다리의 `value` 가 들고
 *      **원장**(tests/sim/__ledger__/autoplay.json)이 정확 일치로 잠근다. 낡으면 즉시 빨강이다.
 *
 * ── 어떻게 도는가 ───────────────────────────────────────────────────────────
 *     npx vitest run tests/sim/autoplay.test.ts                   # 봉투 (CI 매번)
 *     AUTOPLAY_REPORT=1 npx vitest run tests/sim/autoplay.test.ts # 전 다리 표를 찍는다
 *     AUTOPLAY_LEDGER=1 npx vitest run tests/sim/autoplay.test.ts # 원장 갱신(= 재측정)
 *     AUTOPLAY_CONTROLS=fast npx vitest run tests/sim/autoplay.control.test.ts  # 판별력
 *     AUTOPLAY_CONTROLS=full npx vitest run tests/sim/autoplay.control.test.ts
 *
 * ── 런타임 (격리 실행) ──────────────────────────────────────────────────────
 *   옛 봉투 486.99초 → 이 봉투 484.59초 → **이번 라운드 401.80초**(판별력·기록 보강 뒤).
 *   대조군 fast 스위트는 515초 → **567.65초**(+52초). 늘어난 자리는 전부 커버리지다 —
 *   [7] 갈래 둘에 양성 대조군을 신설하고([7] 스윕 두 벌), [4]·[1-b]·[5-b] 에 겨냥을 붙였다.
 *   ⚠ **표본은 한 톨도 안 키웠다.** '지배 금지' 계약의 검출력은 α 를 방어용으로 되돌려
 *   얻었다(같은 방향 쌍 8개 → 5개). 표본을 키우는 대신 잣대의 방향을 고친 것이라 공짜다.
 *   늘린 곳: [1-a][2][3] 20 → 160시드 · [11-b] 인접 160 → 독립 160 · [9] 20 → 60 ·
 *   [12] 40 → 80 · 교정/붕괴 계기 두 팔 신설. 줄인 곳: [14] 320 → 120시드(유일한 축소) ·
 *   [7] 지형 갈래를 [6] 과 통합(같은 팔인데 따로 돌고 있었다) · [8] 부족 자기완결 팔 1블록.
 *
 * ── 다리의 등급 (계약 / 전제 / 감시) ────────────────────────────────────────
 * 옛 봉투는 62개 어서션이 한 줄에 섞여 있어 **구조적으로 항상 참인 것**(`Σ lostGold > 0`)과
 * **여유 0인 계약**(`minTowers ≥ 7`)이 같은 무게로 보였다. 이제 셋으로 나눈다:
 *  · contract     — 봉투가 잠그는 것.
 *  · precondition — 실험이 공허하지 않은지. 차단하되 문턱 유도 대상이 아니다.
 *  · monitor      — 비차단. 값만 원장에 남기고 사람에게 보고한다.
 * 계약 표면에서 15개가 빠졌고 **아무것도 약해지지 않았다.**
 *
 * ── ⚠ 지금 얇은 곳 (옛 헤더의 '여유 0 목록'을 새 구조에 맞게 다시 쓴 것) ────
 * 옛 목록은 전부 "동률이 유일한 방벽"이었고, 그 형태는 짝 부호검정으로 사라졌다.
 * 지금 남은 얇은 곳은 성질이 다르다 — **숫자는 원장이 들고 있으므로 여기엔 성질만 적는다.**
 *  1. **[6] 불도저 · 검출력의 상한이 표본이 아니라 상품에 있다.** 소품 제거가 결과를
 *     바꾸는 판이 2.5%뿐이라, 부호검정이 힘을 얻을 불일치 쌍 자체가 거의 없다. 표본을
 *     두 배로 늘려도 검출력은 √2배다. 원장의 `6.discord` 가 그 값을 매 실행 기록한다.
 *     ⚠ 이건 표본 설계로 못 고친다 — 제거 비용/이득의 **밸런스 결정**이고 별개 안건이다.
 *     ⚠ 다만 "아무 값에서나 초록"은 아니다: 방어용 α 를 되돌린 뒤 이 계약의 최소 검출
 *     효과크기가 ⟦원장 6.dozer.notDominant = MDE 3판/80⟧ 이다 — 불도저 쪽으로 세 판만 더
 *     갈리면 빨개진다. 옛 α(0.05/12)에서는 같은 계산이 6판이었다 — 곧 α 교체의 실제 효과는
 *     "불가능 → 3판"이 아니라 **6판 → 3판**이다. (한때 "산술적으로 실패가 불가능했다"고
 *     적혀 있었으나 거짓이다: 옛 α 에서도 여섯 다리 전부 MDE 가 유한하고 표본 이하였다 —
 *     6 / 18 / 22 / 1 / 10 / 13. 적대적 리뷰가 원장 값으로 재계산해 잡았다.)
 *  2. **[7] 기지(자연) 갈래 — 여유 축은 이미 유의하게 앞선다.** 지금 이 갈래를 막고 있는
 *     것은 **승수 축의 불일치 쌍 점추정**뿐이다(원장 `7.baseNat.notDominant` 참조).
 *     여유 축의 p 는 자릿수로 유의하다. 곧 승수가 몇 판만 넘어오면 이 항목은 빨개진다.
 *     그건 잡음이 아니라 **실제 신호**이므로, 그때 할 일은 문턱이 아니라 마을 값의 재유도다.
 *  3. **[11-b] 봉쇄비의 여유가 꼬리에서 온다 — 창을 절대 줄이지 마라.** 판별로 짝지은
 *     비의 중앙값은 1 근처이고(원장 `11b.pairedMedian`), 정원 6의 가동률은 정원 2의
 *     절반이다. 곧 늘어난 인원은 대체로 놀고 있고, 합산 비를 올리는 것은 소수의 위급한
 *     판이다. 실측으로 창을 옮기면 블록당 16에서는 1.242 / 1.532 / 1.503 로 **하나가
 *     문턱 아래**이고, 블록당 40에서는 1.329 / 1.395 / 1.534 로 셋 다 위다. 그래서
 *     창은 처음 선언한 자리에 두고 per 만 올렸다. ⚠ 여기서 걸리면 문턱이 아니라
 *     **아군 값을 다시 유도하라**(9단계가 ALLY_COST_GROWTH 로 한 것과 같은 자리).
 *  4. **[8] 골드비 전제(0.7)** — 계약이 아니라 전제인데 독립 블록에서 가장 얇았다.
 *     여기서 걸리면 문턱이 아니라 **두 팔의 지출을 맞추는 방식**을 다시 유도해야 한다.
 *  5. **[14] 는 이 설계에서 유일하게 표본이 준 항목**이고(4×80 → 4×30), 승수 축이
 *     실측에서 **정확히 동률**이다(원장 `14.real.dominates`). 이 항목을 지고 있는 것은
 *     여유 축이고(부호 압도적, p 가 자릿수로 유의) 승수 축은 옛 문턱 `진짜 ≥ 위약`을
 *     그대로 들고 있을 뿐이다. 되돌릴 손잡이는 창 `marginal` 의 `per` 를 올리는 것
 *     하나이고, **줄이지는 마라**. ⚠ 승수 축으로 무언가를 주장하려면 표본이 더 커야 한다.
 *  6. **짝 부호검정 항목의 표본을 먼저 깎지 마라.** 불일치 쌍이 5개 미만이면 어떤 배치라도
 *     p ≥ 0.05 라 "지배 아님"이 무조건 참이 된다. 곧 n 을 줄이는 결정이 [6][7][10][13][14]를
 *     조용히 완화한다. 예산이 모자라면 절대 문턱 항목(1-a·2·3)의 per 부터 줄여라.
 *  7. **[12] 는 승률 격차의 크기 선언을 승률 축에서 잃었다 — 축을 옮겨 되찾았다.**
 *     400짝(창 대장 밖 독립 네 창을 더해 다시 쟀다)에서 모집단 격차가 16.25%p · 짝 SE
 *     2.43%p 라, 옛 문턱 15%p 는 모집단 효과의 0.5 SE 아래다(= 다섯 창 중 둘에서 배포본이
 *     빨갛다). 승률 축으로 그 크기를 지려면 약 4,100짝이 필요하다. 그래서 같은 주장을
 *     **판당 여유 부호 축**(상대 산포가 6분의 1)에서 다시 세웠다 = `12.slackSign`.
 *     유도 표와 강도 비교는 probes.ts 의 judge12 주석에 있고, 원장의 `12.rateGap` 이
 *     승률 눈금의 값을 계속 기록한다. ⚠ 표본이 넓어지면 거기서 다시 유도하라.
 *
 * ── ⚠ 교정 팔이 이미 한 번 일했다 (이 설계 자체의 판별력 기록) ──────────────
 * 지배 술어를 처음에는 "승수와 여유 **둘 다** 유의하게 앞선다"로 썼다. 교정 팔(별 1개,
 * ⟦원장 cal.slope = 완주율 80.00% → 93.75%⟧ · ⟦원장 cal.slope = 여유 22.95% → 47.95%⟧)을
 * 그 술어로 재니 **거짓**이었다 —
 * 승수 축의 McNemar p 가 3.27e-2 로 α 를 못 넘기 때문이다. 곧 그 형태에서는 "지배가
 * 아니다" 계약 여섯이 **아무것도 못 잡는 채로 초록**이었을 것이다. 술어를 "두 축 모두에서
 * 뒤지지 않고 적어도 한 축에서 유의하게 앞선다"로 고쳤다(envelope.dominant 주석에 전문).
 * **계기를 안 달았으면 이 재설계는 옛 봉투와 같은 병을 다른 형태로 재현했을 것이다.**
 *
 * ── 항목별로 무엇을 잠그는가 ────────────────────────────────────────────────
 * 각 항목의 유도·방향(강화/재유도/완화)·판별력은 tests/sim/autoplay.probes.ts 의
 * 해당 `judge*` 함수 바로 위에 있다. 문턱 상수도 전부 거기 한 곳에 모여 있다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALPHA,
  ALPHA_GUARD,
  BASE,
  BLOCKS,
  DIRECTIONAL_LEGS,
  FULL,
  GUARD_LEGS,
  SHARED_NOTE,
  STRIDE,
  WINDOWS,
  type Leg,
  failures,
  legReport,
  ledgerSnapshot,
  mdeSnapshot,
  observedWindows,
  playKey,
  playStats,
  seedsOf,
  withItem,
} from './envelope';
import { ITEMS, WINDOW_USE } from './autoplay.probes';
import { CONTROLS, UNPROVEN } from './controls';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = join(HERE, '__ledger__', 'autoplay.json');
const WRITE_LEDGER = process.env.AUTOPLAY_LEDGER === '1';
const REPORT = process.env.AUTOPLAY_REPORT === '1';

const collected: Leg[] = [];
const ranItems = new Set<string>();

describe('autoplay 난이도 봉투', () => {
  /**
   * ── 메타 — 표본 독립성을 **규약이 아니라 테스트로** 강제한다 (시뮬레이션 0판) ──
   * 옛 봉투가 걸린 병은 "다들 같은 시드를 본다"였고, 그건 사람이 주석을 읽어야만
   * 보이는 문제였다. 이제 코드가 검사한다.
   */
  it('메타: 창 대장이 서로소이고, 블록이 겹치지 않고, 캐시 키가 시드 집합을 식별한다', () => {
    // (1) 블록끼리 시드가 절대 안 겹친다 — 공차 37 과 간격 1000/3000/4000/7000/8000 이
    //     서로 소라는 증명의 실행판이다.
    for (let i = 0; i < BLOCKS.length; i++) {
      for (let j = i + 1; j < BLOCKS.length; j++) {
        const d = Math.abs(BLOCKS[j]! - BLOCKS[i]!);
        expect(d % STRIDE, `블록 ${BLOCKS[i]} 과 ${BLOCKS[j]} 의 간격 ${d} 이 공차 ${STRIDE} 의 배수다 = 시드가 겹친다`)
          .not.toBe(0);
      }
    }

    // (2) 창끼리 서로소 — `pairOf` 가 없는 창은 어떤 창과도 인덱스 구간이 겹치면 안 된다.
    //     겹치면 그것이 곧 옛 `SEEDS ⊂ SEEDS40 ⊂ SEEDS80` 의 재발이다.
    const names = Object.keys(WINDOWS) as (keyof typeof WINDOWS)[];
    const solo = names.filter((n) => !('pairOf' in WINDOWS[n]));
    for (let i = 0; i < solo.length; i++) {
      for (let j = i + 1; j < solo.length; j++) {
        const a = WINDOWS[solo[i]!];
        const b = WINDOWS[solo[j]!];
        const overlap = a.off < b.off + b.per && b.off < a.off + a.per;
        expect(overlap, `창 ${solo[i]}(${a.off}+${a.per}) 과 ${solo[j]}(${b.off}+${b.per}) 이 겹친다 — 접두 중첩의 재발`)
          .toBe(false);
      }
    }
    // (3) 짝 창은 반드시 짝 상대의 구간 **안**에 있어야 한다 (= 같은 판을 밟는다)
    for (const n of names) {
      const w = WINDOWS[n] as { off: number; per: number; pairOf?: string };
      if (!w.pairOf) continue;
      const host = WINDOWS[w.pairOf as keyof typeof WINDOWS];
      expect(host, `창 ${n} 의 짝 상대 ${w.pairOf} 가 없다`).toBeTruthy();
      expect(w.off >= host.off && w.off + w.per <= host.off + host.per,
        `창 ${n} 이 짝 상대 ${w.pairOf} 의 구간을 벗어난다 — 짝이 아니라 우연한 겹침이다`).toBe(true);
    }
    /**
     * (3-b) **같은 짝 상대를 공유하는 창끼리도 검사한다** — 여기가 비어 있었다.
     *
     * (2)는 `pairOf` 없는 창만 봤고 (3)은 "짝 상대 안에 들어 있는가"만 봤다. 그 사이로
     * `strongCal`(off 40, per 10) ⊂ `strongHug`(off 40, per 20) 가 **통과하고 있었다** —
     * 시작점이 같고 크기가 다른 두 창은 이 파일이 없애려는 접두 중첩(`SEEDS ⊂ SEEDS40`)
     * 그 자체다. 규칙: 같은 상대를 공유하는 두 창은 **완전히 같거나(= 일부러 같은 판을
     * 밟는 Dunnett 형 팔들) 완전히 서로소**여야 한다. "앞부분"은 금지다.
     */
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = WINDOWS[names[i]!] as { off: number; per: number; pairOf?: string };
        const b = WINDOWS[names[j]!] as { off: number; per: number; pairOf?: string };
        if (!a.pairOf || a.pairOf !== b.pairOf) continue;
        const same = a.off === b.off && a.per === b.per;
        const disjoint = a.off + a.per <= b.off || b.off + b.per <= a.off;
        expect(same || disjoint,
          `창 ${names[i]}(${a.off}+${a.per}) 과 ${names[j]}(${b.off}+${b.per}) 이 짝 상대 ${a.pairOf} 를 공유하면서 ` +
          `부분만 겹친다 — 같은 시작점의 크기 다른 두 창은 접두 중첩이다. 같게 하거나 서로소로 옮겨라`).toBe(true);
      }
    }

    // (4) 선언된 공유와 실제 사용이 정확히 일치한다
    const useCount = new Map<string, string[]>();
    for (const [item, wins] of Object.entries(WINDOW_USE)) {
      for (const w of wins) {
        expect(names.includes(w), `항목 ${item} 이 창 대장에 없는 창 ${w} 를 쓴다`).toBe(true);
        useCount.set(w, [...(useCount.get(w) ?? []), item]);
      }
    }
    for (const n of names) {
      expect(useCount.has(n), `창 ${n} 을 쓰는 항목이 없다 — 죽은 창은 지워라`).toBe(true);
    }
    const shared = [...useCount.entries()].filter(([, v]) => v.length > 1).map(([k]) => k).sort();
    expect(shared, `선언된 공유(SHARED_NOTE)와 실제 공유가 다르다`).toEqual(Object.keys(SHARED_NOTE).sort());

    // (5) 캐시 키가 **길이가 아니라 시드 집합**을 식별한다. 옛 키는 `n${seeds.length}` 라
    //     같은 길이의 다른 창을 돌리면 두 번째 호출이 첫 번째 결과를 조용히 돌려받았다.
    //     이 재설계는 같은 길이의 서로 다른 창(l2 · unit · base600 · baseNat)을 반드시 만든다.
    const a = playKey({ stageId: 1, deck: ['spear'], seeds: seedsOf('l2', FULL) });
    const b = playKey({ stageId: 1, deck: ['spear'], seeds: seedsOf('ally', FULL) });
    const c = playKey({ stageId: 1, deck: ['spear'], seeds: seedsOf('l2', FULL), patch: { id: 'X' } });
    const p = playKey({ stageId: 1, deck: ['spear'], seeds: seedsOf('unit', FULL) });
    expect(seedsOf('l2', FULL).length, '이 검사는 같은 길이의 서로 다른 창 두 개가 있어야 성립한다')
      .toBe(seedsOf('ally', FULL).length);
    expect(a === b, '같은 길이의 서로 다른 창이 같은 캐시 키를 낸다 — 남의 표본을 돌려받는다').toBe(false);
    expect(a === c, '데이터 패치가 캐시 키에 없다 — 대조군이 배포본 결과를 돌려받는다').toBe(false);
    // 반대로 **짝 창은 같은 키를 내야 한다** — 그게 짝의 정의이고, 캐시가 두 팔의 공통
    // 대조군을 한 번만 돌려 예산을 아끼는 자리이기도 하다.
    expect(a === p, '짝 창(l2 · unit)이 다른 키를 낸다 — 짝 비교가 성립하지 않는다').toBe(true);
  }, 30_000);

  for (const item of ITEMS) {
    it(`[${item.id}] ${item.title}`, () => {
      const j = withItem(item.id, () => item.judge(BASE, FULL));
      collected.push(...j.legs);
      ranItems.add(item.id);
      // ── 창 대장 표를 **실제 사용에서 강제**한다 (손 관리 표 → 계측) ──────────────
      // 옛 구조에서 WINDOW_USE 는 사람이 적는 표라, 항목이 창을 하나 더 읽어도(또는
      // 안 읽어도) 아무도 몰랐다. 이제 봉투가 세는 것과 표가 다르면 여기서 걸린다.
      expect(
        observedWindows(item.id),
        `항목 ${item.id} 이 실제로 읽은 창과 WINDOW_USE 표가 다르다 — 표를 고쳐라(창을 더 읽었거나 덜 읽었다)`,
      ).toEqual([...(WINDOW_USE[item.id] ?? [])].sort());
      const bad = failures(j.legs);
      const msg =
        `\n${j.msg}\n` +
        `── 다리 (α = ${ALPHA.toExponential(3)}, 방향 다리 ${DIRECTIONAL_LEGS.length}개에서 Bonferroni) ──\n` +
        legReport(j.legs);
      expect(bad.map((l) => l.id), msg).toEqual([]);
    }, item.timeout);
  }

  /**
   * ── 기록 검사 — "잰 값과 적힌 값이 다르다"를 자동으로 알린다 ────────────────
   * 시뮬은 결정론이므로 정확 일치로 본다. 여기서 걸리는 것은 **계약 위반이 아니라
   * 기록이 낡은 것**이다 — 게임을 만졌으면 값이 움직이는 것이 정상이고, 해야 할 일은
   * 문턱을 건드리는 게 아니라 원장을 다시 뽑는 것이다:
   *
   *     AUTOPLAY_LEDGER=1 npx vitest run tests/sim/autoplay.test.ts
   *
   * 이 파일이 반복해서 걸린 병(주석 실측 12/17 낡음)이 구조적으로 불가능해진다.
   */
  it('기록 검사: 원장의 실측과 이번 실행의 실측이 정확히 같다', () => {
    const now = ledgerSnapshot();
    if (WRITE_LEDGER) {
      mkdirSync(dirname(LEDGER_PATH), { recursive: true });
      writeFileSync(LEDGER_PATH, `${JSON.stringify(now, null, 2)}\n`, 'utf8');
      expect(Object.keys(now).length).toBeGreaterThan(0);
      return;
    }
    expect(existsSync(LEDGER_PATH), `원장이 없다. AUTOPLAY_LEDGER=1 로 한 번 돌려 만들어라: ${LEDGER_PATH}`).toBe(true);
    const saved = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Record<string, string>;
    const complete = ranItems.size === ITEMS.length;
    const diffs: string[] = [];
    for (const [k, v] of Object.entries(now)) {
      if (!(k in saved)) diffs.push(`+ ${k}\n    이번 실행 ${v}\n    (원장에 없다)`);
      else if (saved[k] !== v) diffs.push(`≠ ${k}\n    원장   ${saved[k]}\n    이번   ${v}`);
    }
    if (complete) {
      for (const k of Object.keys(saved)) if (!(k in now)) diffs.push(`- ${k} (원장에만 있다 — 다리가 사라졌다)`);
    }
    expect(
      diffs,
      `\n원장이 낡았다 (계약 위반이 아니다). 재측정해서 갱신하라:\n` +
        `    AUTOPLAY_LEDGER=1 npx vitest run tests/sim/autoplay.test.ts\n` +
        (complete ? '' : `⚠ 이번 실행은 전 항목을 돌리지 않았다(${ranItems.size}/${ITEMS.length}) — 사라진 키는 검사하지 않았다\n`) +
        diffs.join('\n'),
    ).toEqual([]);
  }, 30_000);

  /**
   * ── 메타 ①: **판별력 커버리지를 코드가 계산한다** ───────────────────────────
   * 옛 구조에서 `UNPROVEN`(= 아무 대조군도 못 깨우는 다리)은 **사람이 적는 목록**이었고,
   * 그래서 실측과 어긋나 있었다: 계약 다리 66개 중 **38개**를 어떤 대조군도 겨냥하지
   * 않는데 목록에는 5개만 실려 있었다. 그중 둘(`7.unit` · `7.base600`)은 '지배 금지'
   * 계약이라, 봉투가 잠근다고 적어 놓고 아무도 확인한 적 없는 자리였다.
   *
   * 이제 규칙은 하나다: **모든 계약 다리는 대조군이 겨냥하거나, UNPROVEN 에 사유와 함께
   * 실려 있어야 한다.** 둘 다 아니면 여기서 빨개진다. 목록이 낡는 것도 막는다 —
   * UNPROVEN 에 있는데 대조군이 겨냥하면(또는 그런 다리가 아예 없으면) 그것도 빨강이다.
   * (전제·감시 다리는 대상이 아니다. 전제는 실험이 공허하지 않은지를 보는 자리이고,
   *  감시는 애초에 차단하지 않는다.)
   */
  it('메타: 모든 계약 다리를 대조군이 겨냥하거나 UNPROVEN 이 사유와 함께 싣는다', () => {
    if (ranItems.size !== ITEMS.length) return; // 부분 실행에서는 검사하지 않는다
    const targeted = new Set(CONTROLS.flatMap((c) => c.targets));
    const excused = new Map<string, (typeof UNPROVEN)[number]>();
    for (const u of UNPROVEN) for (const l of u.legs) excused.set(l, u);
    const known = new Set(collected.map((l) => l.id));
    const contracts = [...new Set(collected.filter((l) => l.kind === 'contract').map((l) => l.id))].sort();

    const uncovered = contracts.filter((id) => !targeted.has(id) && !excused.has(id));
    expect(
      uncovered,
      '\n판별력이 증명되지도, 증명 안 됐다고 적히지도 않은 **계약** 다리다.\n' +
        'controls.CONTROLS 에 겨냥하는 되돌리기를 더하거나, controls.UNPROVEN 에 ' +
        '"무엇을 시도했고 왜 안 깨졌는지"와 함께 실어라. 둘 다 안 하는 것은 금지다.\n' +
        uncovered.join(' · '),
    ).toEqual([]);

    const stale = [...excused.keys()].filter((id) => !known.has(id) || targeted.has(id)).sort();
    expect(
      stale,
      '\nUNPROVEN 이 낡았다 — 그 다리를 대조군이 이미 겨냥하거나, 그런 다리가 아예 없다.\n' +
        stale.join(' · '),
    ).toEqual([]);
    for (const u of UNPROVEN) {
      expect(u.legs.length, 'UNPROVEN 항목에 다리가 없다').toBeGreaterThan(0);
      expect(u.tried.length, `UNPROVEN(${u.legs[0]}) 에 "무엇을 시도했는가"가 비어 있다`).toBeGreaterThan(0);
      expect(u.finding.length, `UNPROVEN(${u.legs[0]}) 에 "왜 안 깨졌는가"가 비어 있다`).toBeGreaterThan(0);
    }
    // 초록 실행에서도 커버리지가 눈에 보이게 남는다 (보고가 목적이라 차단하지 않는다)
    process.stdout.write(
      `\n══ 판별력 커버리지 ══\n계약 ${contracts.length}개 중 대조군이 겨냥 ${
        contracts.filter((id) => targeted.has(id)).length
      }개 · UNPROVEN ${contracts.filter((id) => excused.has(id)).length}개\n`,
    );
  }, 30_000);

  /**
   * ── 메타 ②: **실패 불가능한 계약이 하나도 없다** ────────────────────────────
   * '지배 금지' 계약은 "증거가 없다"를 통과 조건으로 삼는다. 그런 계약은 표본이 힘을
   * 잃으면 **아무 일도 안 하는 채로 영원히 초록**이 되고, 아무도 모른다. 적대적 리뷰가
   * 실제로 그것을 잡았다 — 옛 α(0.05/12)는 방어용 다리를 **방향과 반대로** 느슨하게 만들고
   * 있었다(계약이 `!dominant(...)` 형태라 α 가 작을수록 통과가 쉽다). `6.dozer` 의 MDE 는
   * 옛 α 에서 6판, 지금 3판이다.
   *
   * ⚠ 한때 이 자리에 "옛 α 에서는 산술적으로 실패가 불가능했다"고 적혀 있었으나 **거짓**이다.
   * 원장 값으로 재계산하면 옛 α 에서도 여섯 다 유한했다(6 / 18 / 22 / 1 / 10 / 13판),
   * 그중 셋(`7.unit` 18 · `7.base600` 22 · `7.baseNat` 1)은 α 교체로 **한 자리도 안 변했다**.
   * α 교체는 옳지만 그 근거는 "불가능을 가능으로"가 아니라 "방향이 반대인 보정을 걷어냈다"다.
   *
   * 그래서 `envelope.mdeGuard` 가 다리마다 "지금 실측에서 몇 판이 더 뒤집히면 빨개지는가"
   * 를 계산하고, 여기서 그 값이 **유한하고 표본 안에서 도달 가능한지**를 계약으로 검사한다.
   * 값 자체는 다리 값에 실려 원장이 잠그므로, MDE 가 조용히 커지면 원장 검사가 먼저 운다.
   */
  it('메타: 지배 금지 계약 여섯 개가 전부 "실패 가능"하다 (최소 검출 효과크기)', () => {
    if (ranItems.size !== ITEMS.length) return;
    const snap = mdeSnapshot();
    const missing = GUARD_LEGS.filter((id) => !snap.has(id));
    expect(missing, 'MDE 가 등록되지 않은 방어용 다리 — envelope.guard 를 거치지 않고 손으로 판정했다').toEqual([]);
    const rows: string[] = [];
    const impossible: string[] = [];
    const vacuous: string[] = [];
    for (const id of GUARD_LEGS) {
      const m = snap.get(id)!;
      rows.push(
        `  ${id} — ${Number.isFinite(m.flips) ? `${m.flips}판` : '∞'} / 표본 ${m.n}판 · 같은 방향 쌍 ${m.pairs}개 · ` +
          `갈린 짝 ${m.decided}개 · α ${m.alpha}`,
      );
      if (!Number.isFinite(m.flips) || m.flips > m.n) impossible.push(id);
      if (m.decided === 0) vacuous.push(id);
    }
    expect(
      impossible,
      `\n══ 최소 검출 효과크기 (얼마나 나빠지면 빨개지는가) ══\n${rows.join('\n')}\n\n` +
        '⚠ 위 다리는 **어떤 결과가 나와도 실패할 수 없다.** 마진을 넣거나 문턱을 만지지 말고 ' +
        '표본(창의 per)을 키워라 — 이 형태의 계약에서 검출력은 불일치 쌍 수에서만 나온다.',
    ).toEqual([]);

    /**
     * ── ⚠ `flips` 가 못 잡는 두 번째 구멍: **공허한 통과** ───────────────────────
     * 위 검사는 "산술적으로 몇 판이면 빨개지는가"만 본다. 그런데 `mdeGuard` 는
     * `onlyA += m` 을 가정하므로, 두 팔이 **한 판도 못 이기고 여유가 양쪽 다 0**인
     * 트리에서도 `minPairs(α)` = 5 를 돌려준다 — 게임의 성질이 아니라 α 의 상수다.
     * 곧 판이 통째로 무너지면 여섯 방어용 계약이 전부 "MDE 5판"을 달고 **초록**이 된다.
     *
     * 실측으로 확인했다 — 배포 트리와 문간 공성 브랜치를 같은 창(4블록 FULL)으로 나란히 쟀다.
     * 배포 쪽 값은 원장이 들고 있으므로 인용으로 적는다(손으로 베끼면 낡는다):
     *   다리                배포 트리                              무너진 트리
     *   6.dozer             ⟦원장 6.dozer.notDominant = MDE 3판/80⟧      MDE 5판/80
     *   7.unit              ⟦원장 7.unit.notDominant = MDE 18판/80⟧      MDE 5판/80
     *   7.base600           ⟦원장 7.base600.notDominant = MDE 22판/80⟧   MDE 5판/80
     *   7.baseNat           ⟦원장 7.baseNat.notDominant = MDE 1판/80⟧    MDE 5판/80
     *   10.tribe            ⟦원장 10.tribe.notDominant = MDE 9판/80⟧     MDE 5판/80
     *   13.tribe.notAhead   ⟦원장 13.tribe.notAhead = MDE 11판/24⟧       MDE 5판/24
     * **서로 다른 여섯 게임의 여섯 숫자가 하나의 상수로 수렴하는 것**이 그 상태의 지문이다.
     * (무너진 쪽 열은 이 트리의 브랜치 실측이라 원장에 없다. 갈린 짝은 앞의 다섯이 전부 0,
     *  [13]만 4 로 살아남았다 — 무한 모드는 마을 HP 로 안 끝나 여유 축이 죽지 않기 때문이고,
     *  그래서 이 검사는 [13]을 통과시킨다. 배포 쪽 갈린 짝은 4 / 62 / 95 / 56 / 83 / 18 이라
     *  가장 얇은 [6]도 0 에서 넷 떨어져 있다.)
     * (원인은 `slackOf = baseHpLeft / baseHpMax` 다 — 모든 판이 마을 0으로 끝나면 여유 축이
     *  통째로 0이 되고, 승수 축도 0/n 대 0/n 이라 `dominant` 의 두 축이 동시에 죽는다.)
     *
     * ⚠ 여기서 걸리면 **문턱이 아니라 게임을 고쳐라.** 이 다리는 "갈린 짝이 0이다"라고만
     *   말하고, 그건 표본이 모자란 것이 아니라 **비교할 것이 남지 않은 것**이다.
     *   판별력: 이 검사를 배포 트리(02a6062)에 걸면 여섯 다 갈린 짝 ≥ 4 로 초록이고,
     *   문간 공성 브랜치에 걸면 여섯 다 0 으로 빨갛다.
     */
    expect(
      vacuous,
      `\n══ 최소 검출 효과크기 ══\n${rows.join('\n')}\n\n` +
        '⚠ 위 다리는 **두 팔의 결과가 한 짝도 갈리지 않았다**(승수·여유 양축 전부). ' +
        '곧 "지배 전략이 아니다"가 참이라서 통과한 것이 아니라, **비교할 것이 없어서** 통과했다. ' +
        'MDE 가 유한하게 찍히는 것에 속지 마라 — 그 값은 α 의 상수(minPairs)이지 게임의 성질이 아니다. ' +
        '문턱을 만지지 말고 왜 두 팔이 똑같이 전멸하는지를 먼저 고쳐라.',
    ).toEqual([]);
    process.stdout.write(`\n══ 지배 금지 계약의 최소 검출 효과크기 (α ${ALPHA_GUARD}) ══\n${rows.join('\n')}\n`);
  }, 30_000);

  /**
   * ── 메타 ③: **주석의 숫자가 원장과 어긋나면 빨개진다** ──────────────────────
   * 이 파일이 반복해서 걸린 병이 "다른 트리에서 잰 숫자를 손으로 주석에 베꼈다"이고,
   * 이번 라운드에도 **여섯 건이 재발**했다(그중 하나는 부호가 뒤집혀 정성적 결론까지
   * 틀렸다: 짝 봉쇄비 중앙값을 1.018 이라 적었는데 같은 실행의 원장은 0.967 이다).
   *
   * 처방: 주석에서 실측 숫자를 **빼고 원장 인용으로 바꾼다.** 인용 문법은
   *     ⟦원장 <다리 id> = <원장 값의 부분 문자열>⟧
   * 이고, 이 it 이 소스를 훑어 원장과 대조한다. 원장이 갱신되면 인용이 먼저 운다.
   *
   * ⚠ **왜 "주석의 모든 숫자"를 금지하지 않는가**: 주석의 숫자 대부분은 실측이 아니라
   *   **문턱·상수·유도**(0.93 · 13/20 · 2⁻⁵ …)라, 싸잡아 금지하면 유도를 못 적는다.
   *   그래서 금지 대신 **인용을 제1 표현으로 만들고**, 남은 자유 서술은 "이 트리에서
   *   재현할 창이 없는 이력"(옛 구조 실측 등)으로 한정해 그 사실을 옆에 적는다.
   */
  it('메타: 주석의 원장 인용(⟦원장 …⟧)이 실제 원장 값과 일치한다', () => {
    const files = [
      'envelope.ts',
      'autoplay.probes.ts',
      'autoplay.test.ts',
      'controls.ts',
      'autoplay.control.test.ts',
    ];
    const saved: Record<string, string> = existsSync(LEDGER_PATH)
      ? (JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Record<string, string>)
      : {};
    const bad: string[] = [];
    let n = 0;
    for (const f of files) {
      const src = readFileSync(join(HERE, f), 'utf8');
      for (const m of src.matchAll(/⟦원장\s+([A-Za-z0-9_.]+)\s*=\s*([^⟧]*)⟧/g)) {
        n++;
        const key = m[1]!;
        const quoted = m[2]!.trim();
        const actual = saved[key];
        if (actual === undefined) bad.push(`${f}: 원장에 없는 다리 ${key} 를 인용한다`);
        else if (!actual.includes(quoted))
          bad.push(`${f}: ${key}\n    인용 "${quoted}"\n    원장 "${actual}"`);
      }
    }
    expect(n, '원장 인용이 하나도 없다 — 인용 문법이 깨졌는지 확인하라').toBeGreaterThan(5);
    expect(
      bad,
      '\n주석의 실측 인용이 원장과 다르다 (= 기록이 낡았다). 주석을 원장에 맞춰 고치거나, ' +
        '게임을 만졌다면 AUTOPLAY_LEDGER=1 로 원장을 다시 뽑아라.\n' + bad.join('\n'),
    ).toEqual([]);
  }, 30_000);

  /** 방향 다리 목록이 실제와 같은지 — α 유도의 사후선택을 막는다 */
  it('메타: 방향 다리 목록이 실제 발화한 다리와 정확히 같다 (α 사후선택 방지)', () => {
    if (ranItems.size !== ITEMS.length) return; // 부분 실행에서는 검사하지 않는다
    const emitted = collected
      .map((l) => l.id)
      .filter((id) => (DIRECTIONAL_LEGS as readonly string[]).includes(id))
      .sort();
    expect(
      [...new Set(emitted)],
      `방향 다리를 더하거나 뺐으면 envelope.DIRECTIONAL_LEGS 도 같이 고쳐라 — α = 0.05/L 이 거기서 유도된다`,
    ).toEqual([...DIRECTIONAL_LEGS].sort());
  }, 30_000);
});

afterAll(() => {
  if (!REPORT) return;
  const total = playStats.games;
  process.stdout.write(
    `\n══ autoplay 봉투 보고 (α ${ALPHA.toExponential(3)} · 스윕 ${playStats.runs}회 중 캐시 ${playStats.hits}회 · 실행 ${total}판) ══\n` +
      `${legReport(collected)}\n`,
  );
});
