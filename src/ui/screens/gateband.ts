/**
 * 문간 띠의 **뷰모델** — DOM 도 THREE 도 만지지 않는 순수 함수 한 벌이다.
 *
 * ── 왜 battlehud.ts 안에 안 두는가 ──────────────────────────────────────────
 * 이 저장소에는 jsdom 이 없다(vitest environment: 'node' — tests/ui/input.test.ts 헤더).
 * 곧 `battlehud.ts` 는 **자동 검증이 원리적으로 불가능한 파일**이고, 지금까지 그래도
 * 됐던 이유는 그 안의 판단이 "값을 문자열로 바꿔 넣는다" 정도였기 때문이다.
 * 문간 띠는 다르다 — 누구를 대표로 고르는가 · 언제 경보인가 · 돌파까지 몇 초인가는
 * **판단**이고, 이 셋이 틀리면 화면이 조용히 거짓말을 한다(gate-wip 이 정확히 그 사고를
 * 냈다: 막대는 초록인데 배지는 "4입 남음"이라 한 화면에서 두 경보가 다른 말을 했다).
 * 그래서 판단만 여기로 떼어 내 `tests/ui/gateband.test.ts` 가 전부 밟는다.
 * 남는 `battlehud.ts` 쪽은 "모델 필드 → textContent/style.width" 사상뿐이다.
 *
 * ── 규칙 (src/sim/gate.ts 규칙 1~11 을 화면 쪽에서 읽는 방법) ────────────────
 * 1) **전부 폴링이다.** 이벤트를 한 개도 안 쓴다. gate-wip 은 한 입 크기를
 *    `bossAtGate.bite` 이벤트로 받아야 했는데(스테이지가 divisor 를 덮을 수 있어서),
 *    이번 설계는 한 입이 **언제나 마을 HP 정확히 1**이라 그 통로가 통째로 사라졌다.
 *    곧 이 띠는 이벤트를 놓쳐도, 배속을 바꿔도, 세이브를 복원해도 절대 어긋나지 않는다.
 * 2) **띠가 파는 사실은 두 개뿐이다.**
 *      · 남은 빚 합계(Σ gateOwed) 대 마을 HP  — "판 위의 저것들이 다 갚으면 마을이 남는가"
 *      · 대표 개체가 **돌파**하기까지 남은 시간   — "언제 뚫고 들어오는가"
 *    한 입 초읽기(다음 −1 까지 몇 초)는 **일부러 뺐다**: 한 입이 1로 고정된 뒤로는
 *    마을 HP 바가 1초에 한 칸씩 줄어드는 것 자체가 그 초읽기다. 같은 사실을 두 자리에
 *    그리면 390px 에서 돌파 게이지가 들어갈 칸이 없어진다.
 * 2-b) ⚠ **빚을 문 앞만 세면 띠가 "위협 없음"을 그린다** (12단계에 실측으로 잡힌 결함).
 *    `baseDamage 1` 인 11종은 **도착 틱에 전액을 물어**(gate.ts 규칙 5 — 첫 입은 즉시)
 *    다음 프레임부터 `gateOwed` 가 0 이다. 곧 랩터 8마리가 문 앞을 덮고 마을이 4/25 여도
 *    문 앞 빚 합계는 **0**이고, 그 0 에 걸려 있던 배지·HP 바 경보가 전부 꺼진다 —
 *    실제 캡처(70-phone844-danger1.png)에서 마을 4/25 인데 띠의 HP 바가 **초록**이었다.
 *    고침은 둘이다.
 *      · 빚을 **판 위 전원**으로 센다. `gateOwed` 는 스폰이 `baseDamage` 로 굳히므로
 *        (waves.ts) 살아 있는 개체의 이 값은 언제나 "이놈을 못 죽이면 마을이 앞으로
 *        잃을 HP"다 — 걸어오는 중이든 문 앞이든 뜻이 같다. 그래서 합이 곧
 *        **"지금 판을 그대로 두면 마을이 잃을 총액"**이 되고, 이 수는 문 앞이 다 갚아도
 *        뒤가 걸어오는 한 0 이 아니다. (아직 **스폰 전**인 적은 판 위에 없어 못 센다 —
 *        곧 이 값은 언제나 하한이고, 하한을 넘겨 그리지 않는다.)
 *      · 마을 HP 바의 경보(`hpLow`)를 빚에서 **떼어 낸다**. 빚은 예보이고 HP 는 상태다.
 *        문턱은 위급 테두리(battlehud.ts danger 1단계)와 **같은 0.35** 를 쓴다 —
 *        한 화면의 두 경보가 서로 다른 말을 하면 안 된다(gate-wip 의 사고).
 * 3) **봉쇄·스턴은 유예이지 면제가 아니다**(gate.ts 규칙 8). 이 띠에서 가장 위험한
 *    거짓말이 "붙잡는 중 — 안 물어요"를 초록으로만 그리는 것이다 — 그 사이에도
 *    `gateTicks` 는 흐르고, 상한에서 남은 빚이 **한 방에** 떨어진다. 그래서 붙잡는
 *    중에도 돌파 게이지는 계속 차오르고, 빚 배지도 그대로 남는다.
 */

/**
 * 이 모듈이 적에게서 읽는 전부. `EnemyState` 가 구조적으로 이 모양을 만족하므로
 * 캐스팅 없이 그대로 넘어간다 — 테스트는 이 최소 모양만 만들면 된다.
 */
export interface GateFoe {
  readonly id: number;
  readonly defId: string;
  readonly alive: boolean;
  /** 문간 체류 누적 틱 (0 = 문간이 아니다) */
  readonly gateTicks: number;
  /** 아직 마을에 갚지 않은 총액 = 돌파 때 한 방에 떨어지는 값 */
  readonly gateOwed: number;
  /** 도착이 청구한 총액 (= 오늘의 누수 한 방 값). 체류 상한의 분모다 */
  readonly baseDamage: number;
  readonly blockerAllyId: number;
  readonly statuses: readonly { readonly kind: string; readonly remainingTicks: number }[];
}

export interface GateBandInput {
  readonly enemies: readonly GateFoe[];
  readonly baseHp: number;
  readonly baseHpMax: number;
  /** 'won' | 'lost' 이면 띠를 접는다 — 조작이 전부 거부되는데 살아 있는 척하지 않는다 */
  readonly phase: string;
  /** 되부를 수 있는 부족원 수 (0 이면 집결 버튼 비활성) */
  readonly allyCount: number;
  /**
   * 이 개체의 문간 체류 상한(틱) — **모르면 0**.
   *
   * ⚠ 이 한 값만은 폴링으로 못 구한다. 상한은
   * `clamp(holdMin, GATE_HOLD_MAX_TICKS, baseDamage × biteTicks)` 인데 `holdMin` 과
   * `biteTicks` 를 **스테이지가 덮어쓸 수 있고**(types.ts `GateSpec`), UI 는 지금 어느
   * 스테이지인지 모른다(`BattleStateView` 에 stageId 가 없다). balance.ts 의 기본값을
   * 박아 넣으면 배포 데이터에서는 맞지만, 누가 한 스테이지에 `holdMinTicks` 를 적는 날
   * **띠가 조용히 거짓말을 시작한다.** 그건 안 그리느니만 못하다.
   * 그래서 정확한 값을 아는 쪽(sim)이 이미 실어 보내는 `enemyAtGate.holdTicks` 를
   * 받아 두고 여기로 넘긴다 — 배너(showWaveBanner)와 **같은 경로**다.
   *
   * **0을 돌려주면 돌파 게이지를 통째로 접는다**(breachTicks·breachFrac 0, knownBreach false).
   * 곧 이벤트를 놓친 프레임에서도 나머지(마릿수·빚·마을 HP·붙잡음)는 정확히 그린다.
   * 절대 여기에 판정을 걸지 말 것 — 판정은 전부 sim 이 한다.
   */
  readonly holdTicksOf: (foe: GateFoe) => number;
}

export interface GateBandModel {
  /** 문간에 아무도 없으면 false — 띠를 통째로 접는다 */
  readonly visible: boolean;
  /** 대표 개체의 종 (아이콘·이름) */
  readonly defId: string;
  /** 문 앞에 선 총 마릿수 */
  readonly count: number;
  /** Σ gateOwed — **문 앞에 선 것들만**. 저것들이 전부 갚으면 마을이 잃는 HP */
  readonly owedTotal: number;
  /**
   * Σ gateOwed — **아직 걸어오는 것들**(판 위에 있고 문 앞이 아닌 살아 있는 적).
   * 문 앞 빚이 0 으로 꺼져도 이 값이 남아 있으면 위협은 끝나지 않았다(규칙 2-b).
   */
  readonly owedIncoming: number;
  /**
   * `owedTotal + owedIncoming` — **지금 판을 그대로 두면 마을이 잃을 총액**.
   * 경보(`doomed`)가 이 값으로 켜진다. 스폰 전의 적은 못 세므로 언제나 **하한**이다.
   */
  readonly owedAll: number;
  /**
   * 대표의 체류 상한을 아는가. false 면 돌파 게이지를 접는다 —
   * 모르는 것을 아는 척하지 않는다(holdTicksOf 주석).
   */
  readonly knownBreach: boolean;
  /** 대표 개체가 돌파하기까지 남은 틱 (0 = 이번 틱에 뚫린다) */
  readonly breachTicks: number;
  /** 돌파 게이지 채움 0..1 (차오르다 터진다) */
  readonly breachFrac: number;
  /**
   * **곧 뚫린다** — 돌파까지 GATE_BREACH_IMMINENT_TICKS 이하이고 아직 갚을 빚이 남았다.
   * 빚이 0이면 뚫려도 마을은 한 톨도 안 깎이므로(gate.ts 규칙 7) 경보가 아니다.
   */
  readonly imminent: boolean;
  /** 대표가 붙잡혀 있다 (물지 않는다 — 그러나 시계는 흐른다) */
  readonly held: boolean;
  /** 대표가 기절했다 (물지 않고 쿨다운도 언다) */
  readonly stunned: boolean;
  /**
   * **마을이 이대로면 진다** — 판 위 전원의 빚 합계(`owedAll`)가 남은 마을 HP 이상이다.
   * 비율(30%)이 아니라 빚으로 재는 이유: 문간에서는 "몇 % 남았나"가 아니라
   * "지금 판 위에 있는 것을 못 죽이면 끝나는가"가 유일하게 행동을 바꾸는 사실이다.
   */
  readonly doomed: boolean;
  /**
   * **마을 HP 가 낮다** — 빚과 **무관한** 상태 경보다(규칙 2-b).
   * `doomed` 는 예보("앞으로 이만큼 더 맞는다")라 판 위의 빚이 0 이면 꺼진다.
   * 그때도 마을이 4/25 면 그건 여전히 위급이고, 띠의 HP 바가 초록이면 화면이
   * 거짓말을 한다. 문턱은 위급 테두리 1단계와 같은 **0.35**다.
   */
  readonly hpLow: boolean;
  /** 마을 HP 바 채움 0..1 */
  readonly hpFrac: number;
  readonly baseHp: number;
  readonly baseHpMax: number;
  /** 집결 버튼을 누를 수 있나 */
  readonly canRally: boolean;
}

/** 돌파가 이만큼 남으면 "임박"이다 (틱). 2초 — 한 번 더 탭할 수 있는 마지막 창. */
export const GATE_BREACH_IMMINENT_TICKS = 60;

/**
 * 마을 HP 가 이 비율 **이하**면 띠의 HP 바가 붉어진다 (규칙 2-b).
 * ⚠ 위급 테두리 1단계(battlehud.ts `danger`)와 **같은 수**여야 한다 — 한 화면의
 *   두 경보가 서로 다른 문턱을 쓰면 "테두리는 붉은데 띠는 초록"이 나온다.
 */
export const GATE_HP_LOW_FRAC = 0.35;

const EMPTY: GateBandModel = {
  visible: false,
  defId: '',
  count: 0,
  owedTotal: 0,
  owedIncoming: 0,
  owedAll: 0,
  knownBreach: false,
  breachTicks: 0,
  breachFrac: 0,
  imminent: false,
  held: false,
  stunned: false,
  doomed: false,
  hpLow: false,
  hpFrac: 0,
  baseHp: 0,
  baseHpMax: 0,
  canRally: false,
};

function isStunned(e: GateFoe): boolean {
  for (const st of e.statuses) if (st.kind === 'stun' && st.remainingTicks > 0) return true;
  return false;
}

/**
 * 대표 개체 고르기 — **지금 마을에 가장 위험한 놈**이다.
 *
 * 순서: 남은 빚 큰 쪽 → 먼저 뚫는 쪽 → 낮은 id.
 *
 * ⚠ gate-wip 은 "가장 먼저 물 놈"(gateBiteCdLeft 최소)을 골랐다. 그때는 문간에 보스가
 *   많아야 둘이라 성립했지만, 이번 설계는 **모든 종이 문 앞에 선다** — 홍수 웨이브에서
 *   동시에 열몇 마리다. 쿨다운 최소는 매 틱 주인이 바뀌므로 띠의 아이콘과 이름이
 *   초당 수십 번 갈아 끼워진다(= 읽을 수 없다). 빚은 초당 1씩만 줄어들어 대표가
 *   거의 안 바뀌고, 무엇보다 **읽어야 할 놈이 곧 가장 아픈 놈**이다.
 *
 * 순회 순서에 안 기댄다 — 동률은 언제나 낮은 id 가 이긴다(결정론 규칙).
 */
export function pickGateLead(
  enemies: readonly GateFoe[],
  holdTicksOf: (foe: GateFoe) => number,
): GateFoe | null {
  let best: GateFoe | null = null;
  let bestBreach = 0;
  for (const e of enemies) {
    if (!e.alive || e.gateTicks <= 0) continue;
    // 상한을 모르는 개체는 '무한히 남았다'로 본다 — 아는 개체가 언제나 먼저 뚫는다
    const hold = holdTicksOf(e);
    const breach = hold > 0 ? Math.max(0, hold - e.gateTicks) : Number.POSITIVE_INFINITY;
    if (best === null) {
      best = e;
      bestBreach = breach;
      continue;
    }
    if (e.gateOwed > best.gateOwed) {
      best = e;
      bestBreach = breach;
    } else if (e.gateOwed === best.gateOwed) {
      if (breach < bestBreach || (breach === bestBreach && e.id < best.id)) {
        best = e;
        bestBreach = breach;
      }
    }
  }
  return best;
}

/** 문간 띠 한 프레임분 — 위 규칙 전부가 여기서 닫힌다 */
export function gateBandModel(input: GateBandInput): GateBandModel {
  if (input.phase === 'won' || input.phase === 'lost') return EMPTY;

  let count = 0;
  let owedTotal = 0;
  let owedIncoming = 0;
  for (const e of input.enemies) {
    if (!e.alive) continue;
    // 규칙 2-b) 살아 있으면 문 앞이든 걸어오는 중이든 `gateOwed` 의 뜻이 같다 —
    // "이놈을 못 죽이면 마을이 앞으로 잃을 HP". 자리만 갈라 담는다.
    if (e.gateTicks > 0) {
      count++;
      owedTotal += Math.max(0, e.gateOwed);
    } else {
      owedIncoming += Math.max(0, e.gateOwed);
    }
  }
  if (count === 0) return EMPTY;
  const owedAll = owedTotal + owedIncoming;

  const lead = pickGateLead(input.enemies, input.holdTicksOf);
  if (lead === null) return EMPTY;

  const hold = input.holdTicksOf(lead);
  const knownBreach = hold > 0;
  const breachTicks = knownBreach ? Math.max(0, hold - lead.gateTicks) : 0;
  const baseHpMax = Math.max(1, input.baseHpMax);
  const baseHp = Math.max(0, input.baseHp);

  return {
    visible: true,
    defId: lead.defId,
    count,
    owedTotal,
    owedIncoming,
    owedAll,
    knownBreach,
    breachTicks,
    // 남은 비율이 아니라 **찬 비율**을 그린다 — 차오르다 터지는 게이지라야 다가오는
    // 사건으로 읽힌다(줄어드는 막대는 '내가 잃는 중'으로 읽힌다). 봉쇄 중에도 찬다.
    breachFrac: knownBreach ? Math.min(1, Math.max(0, 1 - breachTicks / hold)) : 0,
    imminent: knownBreach && lead.gateOwed > 0 && breachTicks <= GATE_BREACH_IMMINENT_TICKS,
    held: lead.blockerAllyId >= 0,
    stunned: isStunned(lead),
    // 판 위의 빚이 0이면 지금 판에 있는 것은 다 갚았다 — 서 있어도 마을은 더 안 깎인다.
    doomed: owedAll > 0 && owedAll >= baseHp,
    // 빚과 **무관하게** 마을 상태만 본다 — 판 위가 다 갚아도 4/25 는 여전히 위급이다
    hpLow: baseHp <= baseHpMax * GATE_HP_LOW_FRAC,
    hpFrac: baseHp / baseHpMax,
    baseHp,
    baseHpMax,
    canRally: input.allyCount > 0,
  };
}
