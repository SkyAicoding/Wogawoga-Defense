/**
 * 습격대 **측정판** — 봇이 도달하지 못하는 종의 수치를 잴 수 있게 만든 판.
 *
 * ── 왜 이 파일이 필요한가 (측정 공백) ──────────────────────────────────────
 * lancer는 스테이지2부터, hexer는 스테이지3부터 나온다. 그런데 별 0 봇의 사망 웨이브가
 * 두 종의 첫 등장 웨이브보다 앞서서, 시드 20판 합계로 **lancer 사격 0회 · hexer 사격
 * 0회**다. 확인 삼아 s2~s6에서 습격대 5종 전원의 `towerAttack.range`를 0으로 만들어도
 * 봇 결과가 소수점까지 동일하다 — 곧 **그 스테이지들에 문턱을 걸면 전부 공허한 초록**이고,
 * 두 종의 수치는 지금까지 "서열 추론"으로만 정해져 왔다(enemies.ts lancer 주석의 궤적).
 *
 * ── 어떻게 메우는가 ────────────────────────────────────────────────────────
 * 스테이지1(= 봇이 유일하게 완주하는 판)의 `allowedEnemies`만 갈아 끼운 **측정판**을
 * 이 파일 안에 상수로 둔다. `src/`는 한 줄도 바뀌지 않는다.
 *  · lancer 판: blade 자리에 lancer  → `[raptor, compy, boar, trike, lancer, archer]`
 *  · hexer  판: archer 자리에 hexer  → `[raptor, compy, boar, trike, blade, hexer]`
 * 총 HP 계수는 세 판이 모두 같다 — `refHpPerCost`가 towerAttack 보유 종을 평균에서 빼므로
 * 남은 넷(raptor·compy·boar·trike)만이 계수를 정한다. 반면 `avgCost`는 다르다
 * (스테이지1 128/6 = 21.33 · 두 측정판 136/6 = 22.67), 곧 후반 스폰 캡 예산이 달라진다.
 * 그래서 **측정판끼리도, 스테이지1과도 절대 비교하지 않는다** — 각 판은 오직
 * **자기 대조군**과만 비교한다. 이 파일의 모든 문턱이 비(ratio)와 차(diff)인 이유다.
 *
 * ── 대조군 설계 (여기가 이 파일의 핵심이다) ────────────────────────────────
 * 대조군은 **같은 판 + 그 종의 `towerAttack.range = 0`**이다. 이 형태여야 하는 이유:
 *  · `makeWaveFor`는 모듈 상수 ENEMY_DEFS만 보고, 편성에 쓰는 것은 hp·cost·flying뿐이다.
 *    range를 0으로 만들어도 hp·cost가 그대로라 **편성이 바이트 단위로 동일**하다.
 *    곧 두 팔의 차이는 "이 종이 타워를 때리는가" 하나뿐이다.
 *  · ⚠ `dmg = 0`은 쓰면 안 된다 — siege.fireAtTower의 `Math.max(1, ...)` 때문에
 *    1피해가 남아 대조군이 깨끗하지 않다.
 *  · ⚠ `allowedEnemies`에서 그 종을 빼는 것도 안 된다 — avgCost가 바뀌어 예산 곡선이
 *    통째로 움직인다(= 재려는 것이 아니라 판을 재게 된다).
 *
 * 계측은 `runBot`의 `onEvent` 훅으로 사건을 세기만 한다(BotResult 확장 없음).
 */
import { describe, expect, it } from 'vitest';
import type { EnemyDef, EnemyId, SimEvent, StageDef, TowerId } from '@/data/types';
import { ENEMY_DEFS, stageById } from '@/data';
import { makeBotSimFor, runBot, type BotResult } from './botharness';

const DECK: TowerId[] = ['spear', 'catapult', 'frost'];
/** autoplay 봉투와 같은 고정 등차수열 — 고를 여지가 없어야 표본이 정직하다 */
const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + 37 * i);

/** 스테이지1을 얕게 복사해 편성 풀만 갈아 끼운 측정판 */
function board(allowed: EnemyId[]): StageDef {
  const s = stageById(1);
  if (!s) throw new Error('no stage 1');
  return { ...s, wavePlan: { ...s.wavePlan, allowedEnemies: allowed } };
}

/** 한 종의 towerAttack만 갈아 끼운 적 표 (hp·cost 불변 → 편성 동일) */
function disarm(id: EnemyId): Record<EnemyId, EnemyDef> {
  const d = ENEMY_DEFS[id];
  if (!d.towerAttack) throw new Error(`${id}는 towerAttack이 없다`);
  return { ...ENEMY_DEFS, [id]: { ...d, towerAttack: { ...d.towerAttack, range: 0 } } };
}

interface Measured {
  wins: number;
  /** Σ잔여 기지HP / Σ최대 기지HP */
  slack: number;
  destroyed: number;
  lostGold: number;
  /** 이 종이 무기를 놓은 횟수 */
  shots: number;
  /** 타워가 침묵당한 횟수 (hexer 전용 축) */
  silences: number;
}

function measure(stage: StageDef, defs: Record<EnemyId, EnemyDef>, who: EnemyId): Measured {
  let shots = 0;
  let silences = 0;
  const rs: BotResult[] = SEEDS.map((seed) => {
    const onEvent = (ev: SimEvent): void => {
      if (ev.type === 'raidAttack' && ev.attackerDefId === who) shots++;
      else if (ev.type === 'towerSilenced') silences++;
    };
    const sim = makeBotSimFor(stage, seed, DECK, 0, false, undefined, undefined, defs);
    return runBot(sim, stage, { onEvent });
  });
  const sum = (f: (r: BotResult) => number): number => rs.reduce((a, r) => a + f(r), 0);
  return {
    wins: rs.filter((r) => r.won).length,
    slack: sum((r) => r.baseHpLeft) / sum((r) => r.baseHpMax),
    destroyed: sum((r) => r.destroyed),
    lostGold: sum((r) => r.lostGold),
    shots,
    silences,
  };
}

const show = (t: string, m: Measured): string =>
  `${t} ${m.wins}/20 · 여유 ${(m.slack * 100).toFixed(1)}% · 파괴 ${m.destroyed} · 손실골드 ${m.lostGold} · 사격 ${m.shots} · 침묵 ${m.silences}`;

describe('습격대 측정판 — 봇이 못 닿는 종을 같은 잣대로 잰다', () => {
  /**
   * **lancer가 값을 한다** — 무장 해제한 자기 자신보다 확실히 아프다.
   *
   * 실측(측정판 · 시드 20 · 덱 spear+catapult+frost · 별 0):
   *   무장  11/20 · 여유 14.8% · 파괴 238 · 손실골드 166,145 · 사격 34,171
   *   대조  20/20 · 여유 24.8% · 파괴  48 · 손실골드  40,116 · 사격      0
   * → 파괴비 4.96 · 손실골드비 4.14 · 여유차 10.0%p.
   * 문턱은 파괴비 >3.0 · 손실골드비 >2.5 · 여유차 >5%p로, 실측에서 각각 1.65배 ·
   * 1.66배 · 2.0배의 여유가 있다.
   *
   * ⚠ **배치 지가 동결(PLACEMENT_GROWTH 1) 이후 재측정** — 세 다리 모두 살아 있지만
   *   파괴비의 여유가 1.65배 → **1.02배**로 줄었다:
   *   ```
   *     무장  20/20 · 여유 48.8% · 파괴 295 · 손실골드 86,390 · 사격 28,603
   *     대조  20/20 · 여유 55.6% · 파괴  96 · 손실골드 29,430 · 사격      0
   *     → 파괴비 3.073(>3.0) · 손실골드비 2.936(>2.5) · 여유차 6.8%p(>5%p)
   *   ```
   *   동결로 타워가 싸져 **양쪽 다 훨씬 많이 짓고 훨씬 많이 잃는다**(대조 파괴 48 → 96).
   *   분모가 커지면 비는 압축된다 — 아래 hexer 항목이 그 압축으로 실제로 무너졌다.
   *   lancer 가 버티는 이유는 직접 파괴라 동결이 되돌릴 수 없기 때문이다.
   *
   * ⚠ **승수는 일부러 걸지 않는다.** 20시드 승수의 표준편차가 1.8이라 어떤 문턱도
   *   표본 운을 탄다(같은 지적으로 봉투 10·11번이 지표를 옮겼다). 위 세 지표는
   *   전부 누적량이라 분산이 훨씬 작다.
   *
   * 판별력: 대조군이 곧 "되돌린 상태"다 — lancer의 towerAttack을 지우거나 사거리를
   * 0으로 만들면 세 비율이 정확히 1.0이 되어 세 단언이 동시에 빨개진다.
   * (이 판이 없으면 s2~s6에서는 같은 되돌리기가 **아무 테스트도 건드리지 않는다**)
   */
  it('lancer: 무장한 판이 무장 해제한 같은 판보다 확실히 아프다', () => {
    const b = board(['raptor', 'compy', 'boar', 'trike', 'lancer', 'archer']);
    const armed = measure(b, ENEMY_DEFS, 'lancer');
    const sham = measure(b, disarm('lancer'), 'lancer');
    const msg = `${show('무장', armed)} / ${show('대조', sham)}`;
    // 실험이 공허하지 않은지 — 무장한 쪽은 실제로 쐈고, 대조는 한 발도 못 쐈다
    expect(armed.shots, msg).toBeGreaterThan(5000);
    expect(sham.shots, msg).toBe(0);
    expect(armed.destroyed / sham.destroyed, msg).toBeGreaterThan(3.0);
    expect(armed.lostGold / sham.lostGold, msg).toBeGreaterThan(2.5);
    expect(sham.slack - armed.slack, msg).toBeGreaterThan(0.05);
  }, 300_000);

  /**
   * **hexer의 본체는 침묵이다** — 직접 피해는 전 종 최저(1 dps)인데도 판을 조인다.
   *
   * 동결 전 실측(측정판 · 시드 20):
   *   무장  16/20 · 여유 22.8% · 파괴 149 · 손실골드 115,553 · 침묵 16,709
   *   대조  20/20 · 여유 24.8% · 파괴  84 · 손실골드  60,320 · 침묵      0
   * → 침묵 16,709회(대조 0) · 파괴비 1.77 · 손실골드비 1.92. 문턱 1.35 / 1.5.
   *
   * ⚠ **여유차에는 문턱을 걸지 않는다 — 실측이 2.0%p뿐이다.** lancer 판의 10.0%p와
   *   달리 이쪽은 20시드 잡음과 구분되지 않으므로, 문턱을 억지로 맞추는 대신 사실을
   *   여기 적어 둔다. hexer가 사는 것은 기지 체력이 아니라 **타워의 발사 시간**이고,
   *   그건 침묵 횟수와 파괴·손실골드가 잡는다.
   *
   * ══ ⚠⚠ 배치 지가 **동결** 이후: 옛 두 문턱을 지금은 못 넘는다 ══════════════
   * ```
   *   무장  20/20 · 여유 51.4% · 파괴 200 · 손실골드 54,920 · 침묵 11,505
   *   대조  20/20 · 여유 51.8% · 파괴 160 · 손실골드 46,240 · 침묵      0
   *   → 파괴비 1.250 (문턱 1.35) · 손실골드비 1.188 (문턱 1.5)
   * ```
   * **효과가 사라진 것이 아니라 압축됐다.** 절대량은 여전히 크다(타워 +40기 · 골드
   * +8,680 · 침묵 11,505회 대 0). 무너진 것은 비(比)이고, 원인은 두 겹이다:
   *  ① 동결로 타워가 싸져 대조군의 파괴가 84 → 160으로 **분모가 배로 늘었다**.
   *  ② 판이 쉬워져 두 팔이 **둘 다 20/20 · 여유 51%** 로 천장에 붙었다 — 성과 축이
   *     포화된 자리에서는 어떤 효과크기도 작게 보인다.
   * 곧 침묵의 본체(타워의 발사 시간을 빼앗는 것)를 **동결이 되사 준다**: 침묵당해
   * 잃은 타워를 같은 값에 다시 세울 수 있기 때문이다. lancer(직접 파괴)가 3.07로
   * 버틴 것과 정확히 대비된다.
   *
   * ── 왜 문턱을 내리지도, 게임을 고치지도 않는가 ─────────────────────────────
   * 이 저장소의 규칙은 "문턱을 내리지 말고 게임을 고쳐라"다. 그런데 여기서 게임을
   * 고치는 손잡이(적을 더 세게/많이)는 **사용자가 명시적으로 자기 몫으로 예약했다**:
   * "이렇게 해서 적군이 너무 약할 경우에는 나중에 적의 숫자를 증가시키는 걸 할 거야."
   * 그래서 셋 중 어느 것도 조용히 하지 않고, **지금 상태를 그대로 잠근다**:
   *  · 방향 다리는 **하드 계약으로 남긴다** — 침묵은 여전히 더 많은 타워를 잃게 한다.
   *  · 옛 문턱은 **역(逆)으로 잠근다**(아래 `toBeLessThan`). 적 수를 늘리는 라운드에서
   *    효과가 되살아나면 그 두 줄이 **빨개져서** 옛 문턱을 되돌리라고 강제한다.
   *    새 숫자를 발명해 끼워 넣는 것(=문턱 내리기)보다 이쪽이 잊히지 않는다.
   *
   * 판별력: `silenceTicks`를 지우면 침묵 단언이 즉시 0이 되어 빨개지고, 사거리를 0으로
   * 만들면(=대조군) 방향 두 단언이 빨개진다.
   */
  it('hexer: 침묵이 실제로 걸리고, 그것이 결과로 이어진다', () => {
    const b = board(['raptor', 'compy', 'boar', 'trike', 'blade', 'hexer']);
    const armed = measure(b, ENEMY_DEFS, 'hexer');
    const sham = measure(b, disarm('hexer'), 'hexer');
    const msg = `${show('무장', armed)} / ${show('대조', sham)}`;
    expect(armed.silences, msg).toBeGreaterThan(5000);
    expect(sham.silences, msg).toBe(0);
    // ① 방향 — 침묵은 실제로 더 많은 타워를 잃게 하고 더 많은 골드를 태운다
    const dRatio = armed.destroyed / sham.destroyed;
    const gRatio = armed.lostGold / sham.lostGold;
    expect(dRatio, msg).toBeGreaterThan(1);
    expect(gRatio, msg).toBeGreaterThan(1);
    // ② 되살아남 감지기 — 이 두 줄이 빨개지면 위 ⚠⚠ 블록이 낡은 것이다.
    //    그때 할 일은 여기를 고치는 게 아니라 **옛 문턱(1.35 / 1.5)을 복원**하는 것이다.
    expect(dRatio, `${msg} — 파괴비가 옛 문턱을 넘었다: 1.35 문턱을 복원하라`).toBeLessThan(1.35);
    expect(gRatio, `${msg} — 손실골드비가 옛 문턱을 넘었다: 1.5 문턱을 복원하라`).toBeLessThan(1.5);
  }, 300_000);
});
