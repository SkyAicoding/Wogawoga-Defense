/**
 * **되돌리기 카탈로그** — 봉투가 무엇을 잡는지 실행 가능한 형태로 증명한다.
 *
 * 왜 필요한가: 배포본 d9864c0 의 봉투 17개 중 **다섯 개는 판별력 근거가 주석에도 없었다**
 * ([1-a] · [1-b] · [2] · [5-b] · [17]). 둘은 주석에 실측이 있었지만 **실행 가능한 형태가
 * 아니었다**([3] 습격대 dmg ×3 → minT 5~7 · [5] leakDamage 한 줄 삭제 → 8웨이브).
 * 그리고 한 라운드에서 지표를 갈았다가, 되돌리기 대조군으로 재 보니 **0/4 블록에서
 * 아무것도 못 잡는다**는 것이 드러나 되돌린 전례가 이미 이 저장소 안에 있다(옛 7번 주석).
 * 그 되돌리기를 한 항목의 일화가 아니라 **파일 전체의 규율**로 만드는 것이 이 파일이다.
 *
 * ── 어떻게 도는가 ────────────────────────────────────────────────────────────
 *     npx vitest run tests/sim/autoplay.control.test.ts            (기본 = 건너뛴다)
 *     AUTOPLAY_CONTROLS=fast npx vitest run tests/sim/autoplay.control.test.ts
 *     AUTOPLAY_CONTROLS=full npx vitest run tests/sim/autoplay.control.test.ts
 * fast = **독립 블록 2벌 × 블록당 개수는 봉투와 같다**. full = 봉투와 같은 4벌(더 오래 걸린다).
 * ⚠ 블록당 개수를 안 줄이는 이유는 envelope.FAST 주석에 있다 — 짝 검정의 검출력은 시드 수가
 *   아니라 불일치 쌍 수에서 나오므로, 줄이면 스위트가 스스로 거짓 음성을 만든다.
 *   (한때 여기 "1블록 × 표본 절반"이라고 적혀 있었는데 코드와 어긋난 기술이었다.)
 *
 * ── 게임 데이터는 한 줄도 안 건드린다 ────────────────────────────────────────
 * `makeBotSimFor` 가 baseLevels · allyDefs · enemyDefs · towerDefs 네 표와 스테이지
 * 객체를 전부 주입받으므로(botharness.ts:499~528) 되돌리기는 전부 **테스트 전용 주입**이다.
 *
 * ⚠ **주입구가 없는 되돌리기는 정직하게 적는다** (UNREACHABLE 참조). 대체 대조군을
 *   "같은 축"이라고 우기지 않는다 — 이 파일이 이미 한 번 당한 실패가 정확히 그 모양이다.
 */
import type { AllyDef, AllyId, BaseLevelDef, EnemyDef, EnemyId, StageDef, TowerDef, TowerId } from '@/data/types';
import type { DataPatch } from './envelope';

const mapVals = <K extends string, V>(t: Readonly<Record<K, V>>, f: (v: V, k: K) => V): Record<K, V> => {
  const out = {} as Record<K, V>;
  for (const k of Object.keys(t) as K[]) out[k] = f(t[k], k);
  return out;
};

/** 되돌리기 하나 */
export interface Control {
  /** 원장·실패 메시지의 신원 */
  readonly id: string;
  /** 무엇을 깨뜨리는가 */
  readonly why: string;
  /**
   * 겨냥하는 다리 id. **이 다리들이 전부 빨개져야** 이 되돌리기가 제 일을 한 것이다.
   * 하나라도 안 빨개지면 그 다리는 아무것도 안 잡고 있는 것이고, 그것이 이 스위트의 산출물이다.
   */
  readonly targets: readonly string[];
  /** kill = 기능을 통째로 지운다 · nudge = 실제로 있었던 크기의 되돌리기 */
  readonly grade: 'kill' | 'nudge';
  /**
   * `'full'` 이면 fast 등급에서는 건너뛴다 — 겨냥한 다리가 **유의성 다리**라 블록 둘에서는
   * 불일치 쌍이 반으로 줄어 α 를 못 넘기기 때문이다. 그건 되돌리기가 약한 것이 아니라
   * 스위트의 표본이 모자란 것이고, 그 구분을 흐리지 않으려고 명시한다.
   */
  readonly minProfile?: 'full';
  /**
   * **fast 등급에서 판정할 수 없는 겨냥 다리** — 그 다리의 *기준선*이 블록 둘에서는
   * 이미 빨갛기 때문이다(유의성 다리가 불일치 쌍 부족으로 α 를 못 넘는 자리).
   *
   * ⚠ 왜 필드로 만들었는가: 옛 스위트는 "겨냥한 다리가 **전부** 판정 불가일 때만" 빨개졌다.
   *   곧 넷 중 셋이 판정 불가여도 초록이었고, 그 셋은 fast 실행에서 **아무것도 증명하지
   *   않은 채 증명된 것처럼 보였다**. 이제 판정 불가는 여기 적힌 다리만 허용되고,
   *   적히지 않은 다리가 판정 불가가 되면 스위트가 빨개진다. 초록 실행에서도 어느 다리가
   *   판정 불가였는지 표준출력에 찍는다.
   */
  readonly fullOnly?: readonly string[];
  readonly patch: DataPatch;
}

// ── 적 습격대 축 ─────────────────────────────────────────────────────────────
const raidDmg = (mul: number) => (t: Readonly<Record<EnemyId, EnemyDef>>): Record<EnemyId, EnemyDef> =>
  mapVals(t, (d) =>
    d.towerAttack ? { ...d, towerAttack: { ...d.towerAttack, dmg: Math.round(d.towerAttack.dmg * mul) } } : d,
  );
const raidOff = (t: Readonly<Record<EnemyId, EnemyDef>>): Record<EnemyId, EnemyDef> =>
  mapVals(t, (d) => {
    if (!d.towerAttack) return d;
    const { towerAttack: _drop, ...rest } = d;
    return rest as EnemyDef;
  });
const enemyHp = (mul: number) => (t: Readonly<Record<EnemyId, EnemyDef>>): Record<EnemyId, EnemyDef> =>
  mapVals(t, (d) => ({ ...d, hp: Math.max(1, Math.round(d.hp * mul)) }));

// ── 타워 축 ─────────────────────────────────────────────────────────────────
const toughMul = (mul: number) => (t: Readonly<Record<TowerId, TowerDef>>): Record<TowerId, TowerDef> =>
  mapVals(t, (d) => ({ ...d, toughness: (d.toughness ?? 1) * mul }));
/** dmg 만 곱한다 — `cost` 를 건드리면 봇의 배치 판정이 바뀌어 A/B 가 깨진다 */
const towerDmg = (mul: number) => (t: Readonly<Record<TowerId, TowerDef>>): Record<TowerId, TowerDef> =>
  mapVals(t, (d) => ({ ...d, tiers: d.tiers.map((x) => ({ ...x, dmg: Math.round(x.dmg * mul) })) }));

// ── 마을 축 ─────────────────────────────────────────────────────────────────
/**
 * **구 마을 표** — 이 파일이 직접 적발해 게임을 고쳐 껐던 **문서화된 실제 지배 전략**이다.
 * 한 라운드에서 지표를 절대 누수로 갈았다가 이 대조군을 0/4 로 놓치는 것이 드러나 되돌렸다.
 * 곧 이것이 카탈로그의 기준점이고, 갈래 항목들의 판별력은 여기서 증명된다.
 * 값: 비용 300/600/1200/2400 (지금 900/1000/1200/1400) · hpMul 레벨당 +12%p (지금 +4%p).
 */
const OLD_COST = [0, 300, 600, 1200, 2400];
const oldHometown = (t: readonly BaseLevelDef[]): BaseLevelDef[] =>
  t.map((d, i) => ({ ...d, cost: OLD_COST[i] ?? d.cost, hpMul: 1 + 0.12 * i }));
/** 화력 성장만 지운 마을 — 비용·HP·정원은 그대로 (9번의 내장 대조군과 같은 형태) */
const hpOnlyHometown = (t: readonly BaseLevelDef[]): BaseLevelDef[] => {
  const lv1 = t[0]!;
  return t.map((d, i) =>
    i === 0 ? { ...d } : { ...d, dmg: lv1.dmg, cooldownTicks: lv1.cooldownTicks, range: lv1.range },
  );
};
/**
 * 정원 열을 평탄하게 — 마을이 머릿수를 팔지 않는 세계.
 * **상수 2로 못 박는다**(`t[0]` 이 아니다): 11-b 의 두 팔은 한 칸짜리 표(정원 2 / 정원 6)라
 * `t[0]` 을 쓰면 각 팔이 자기 값을 그대로 돌려받아 패치가 아무 일도 안 한다. 상수로 박아야
 * 두 팔이 같아져 생산비·봉쇄비가 정확히 1.000 이 되고 11-a·11-b 가 **동시에** 빨개진다.
 */
const FLAT_CAP = 2;
const flatAllyCap = (t: readonly BaseLevelDef[]): BaseLevelDef[] =>
  t.map((d) => ({ ...d, allyCap: FLAT_CAP }));

// ── 아군 축 ─────────────────────────────────────────────────────────────────
const killAlly = (d: AllyDef): AllyDef => ({ ...d, dmg: 0, blocks: false, canTargetAir: false, range: 0 });
const placeboAllies = (t: Readonly<Record<AllyId, AllyDef>>): Record<AllyId, AllyDef> => mapVals(t, killAlly);
/** "거의 위약" — 사거리만 0.1. 7단계가 봉쇄 하한을 만든 이유 그 자체다 */
const nearPlacebo = (t: Readonly<Record<AllyId, AllyDef>>): Record<AllyId, AllyDef> =>
  mapVals(t, (d) => ({ ...d, range: 0.1 }));
/**
 * 구 가격표(clubber 40 · slinger 60 · guardian 85 — 아군 재정의 전 값).
 * ⚠ **카탈로그에서 뺐다**: 실측에서 이 되돌리기는 [10]·[13]의 지배 금지 다리를 하나도
 * 깨우지 못했다(부족 26 → 24승 대 타워 29승, 오히려 더 떨어진다). 값만 내리면 봇이
 * 아군을 더 뽑아 타워 골드가 더 빠지기 때문이다. 값과 힘을 **같이** 되돌리는 allySuper 가
 * 그 자리를 대신한다. 지운 게 아니라 무엇이 안 되는지를 여기 남긴다.
 */
const OLD_ALLY_COST: Record<string, number> = { clubber: 40, slinger: 60, guardian: 85 };
export const oldAllyPrices = (t: Readonly<Record<AllyId, AllyDef>>): Record<AllyId, AllyDef> =>
  mapVals(t, (d, k) => ({ ...d, cost: OLD_ALLY_COST[k] ?? d.cost }));
/** 역방향 — 아군이 실제로 지배 전략이 되는 세계 */
const allyDmg = (mul: number) => (t: Readonly<Record<AllyId, AllyDef>>): Record<AllyId, AllyDef> =>
  mapVals(t, (d) => ({ ...d, dmg: Math.round(d.dmg * mul), hp: Math.round(d.hp * mul) }));
/**
 * **공짜에 압도적인 아군** — 값(cost 1)과 힘(dmg·hp ×m)을 동시에 되돌린다.
 *
 * 왜 셋을 한꺼번에 거는가(아군 값 · 아군 힘 · 마을 값). 하나씩은 전부 실패했다:
 *   · `old-ally-prices`(값만)   → 부족 26 → **24**승 (오히려 내려간다. 싸지면 더 뽑아 타워 골드가 더 빠진다)
 *   · `ally-dmg-x3`(힘만)       → 부족 26 → 28승 (타워 29)
 *   · 아군 cost 1 + ×5 (값+힘) → 부족 56 → **64**승 (타워 65) — 여전히 한 판 모자라다
 *   · 위 + **마을 무료**        → 부족 **78/80** 대 타워 65/80 · 불일치 13:0 (p 1.22e-4) → 깨진다
 * 곧 부족 갈래의 약점은 전투력이 아니라 **타워에서 빠지는 골드 전체**이고, 그 갈래가
 * 사는 물건이 둘(아군·마을)이라 둘의 기회비용을 같이 지워야 지배가 성립한다.
 * 이 실측 자체가 [10] 이 무엇을 재고 있는지에 대한 답이다.
 */
const superAlly = (mul: number) => (t: Readonly<Record<AllyId, AllyDef>>): Record<AllyId, AllyDef> =>
  mapVals(t, (d) => ({ ...d, cost: 1, dmg: Math.round(d.dmg * mul), hp: Math.round(d.hp * mul) }));
/** 마을 레벨업을 공짜로 — 부족 갈래의 나머지 절반 기회비용을 지운다 */
const freeTown = (t: readonly BaseLevelDef[]): BaseLevelDef[] => t.map((d) => ({ ...d, cost: 0 }));
/**
 * **유닛 갈래가 실제로 지배 전략이 되는 세계** — 값(cost 1) · 힘(dmg·hp ×100) · 사거리(×5).
 *
 * ⚠ **왜 이렇게 세야 했는가 (사다리를 실측으로 남긴다).** [7] 유닛 갈래의 지배 금지 다리는
 *   여유가 매우 큰 계약이라(원장 `7.unit.notDominant` 의 MDE 를 보라) 어지간한 되돌리기로는
 *   안 깨진다. 같은 창·같은 정책에서 재 본 사다리:
 *     · 값+힘 ×5  → 유닛 37/40 대 벤치 34/40 · 불일치 5:2(p 2.27e-1) — **안 깨진다**
 *     · 값+힘 ×10 → full 71/80 대 65/80 · 불일치 10:4(p 8.98e-2) · 여유 34:27(p 2.21e-1) — 안 깨진다
 *     · 값+힘 ×30 → **fast 는 깨지고(p 4.61e-2) full 은 안 깨진다**(11:4 p 5.92e-2 · 여유 38:26)
 *       — 표본이 커질수록 벤치의 패배 판 수가 상한이라 승수 축이 먼저 막힌다
 *     · 값+힘 ×100 + 사거리 ×5 → full 80/80 대 65/80 · 불일치 **15:0**(p 3.05e-5) ·
 *       여유 55:17(p 4.07e-6) → 두 등급 모두에서 깨진다
 *   곧 "아군을 백 배로 만들어야 겨우 지배 판정을 넘는다"가 이 계약의 여유이고, 그 자체가
 *   유닛 갈래가 지금 얼마나 지배와 멀리 있는지의 눈금이다. 사다리를 지우지 마라 —
 *   다음 사람이 "왜 이렇게 극단적인 패치냐"고 물을 때의 답이 이것이다.
 */
const godAlly = (t: Readonly<Record<AllyId, AllyDef>>): Record<AllyId, AllyDef> =>
  mapVals(t, (d) => ({ ...d, cost: 1, dmg: d.dmg * 100, hp: d.hp * 100, range: d.range * 5 }));
/**
 * **기지 갈래가 실제로 지배 전략이 되는 세계** — 마을이 거의 공짜(cost 1)에 화력 ×5,
 * HP 성장은 구 표(레벨당 +12%p). `old-hometown` 이 자연 정책 하나만 깨우는 데 반해
 * 이쪽은 예비비 600 갈래까지 깨운다.
 * ⚠ **cost 를 0 이 아니라 1 로 둔 이유**: 0 이면 `7.*.spent`(갈래가 실제로 골드를 썼는가)
 *   전제가 함께 빨개져 "실험이 공허해서 깨진 것"과 구분이 안 된다. 1 이면 지출이 남는다.
 */
const superTown = (t: readonly BaseLevelDef[]): BaseLevelDef[] =>
  t.map((d, i) => ({ ...d, cost: 1, dmg: d.dmg * 5, hpMul: 1 + 0.12 * i }));

// ── 스테이지 축 ─────────────────────────────────────────────────────────────
const leakOff = (s: StageDef): StageDef => {
  const { leakDamage: _drop, ...rest } = s;
  return rest as StageDef;
};
const leakHalf = (s: StageDef): StageDef => ({ ...s, leakDamage: { compy: 1 } });

/**
 * 카탈로그. `targets` 는 tests/sim/autoplay.probes.ts 의 다리 id 다.
 */
export const CONTROLS: readonly Control[] = [
  {
    id: 'raid-off',
    why: '습격대의 타워 공격을 통째로 지운다 (타워가 부서지지 않는 세계)',
    grade: 'kill',
    // ⚠ [3](죽음의 나선)은 겨냥하지 않는다 — 실측에서 이 되돌리기는 minTowers 를 상한(8)에
    //   **붙여 놓아** 그 다리를 오히려 더 초록으로 만든다(반대 방향). [3]은 raid-x3/x6 이 잡는다.
    // ⚠ [4](배치 거리)도 겨냥해 봤고 **실패했다**: 습격대를 통째로 지워도 밀착 봇은
    //   0/40 그대로이고 웨평비는 0.7350 → 0.7413 으로 거의 안 움직인다. 곧 밀착의 벌은
    //   습격대가 아니라 **커버 등급(킬존)** 에서 온다. [4]의 문서화된 되돌리기는 정지선이고
    //   그건 모듈 상수라 주입구가 없다 — UNREACHABLE 과 UNPROVEN 에 그대로 적어 뒀다.
    // 실측(fast): 판당파괴 0 · 중앙값 0 · 0파괴 100% — [2] 의 계약 세 다리를 전부 깬다.
    targets: ['2.perGame', '2.median', '2.zeroShare'],
    patch: { id: 'raid-off', why: '전 적의 towerAttack 삭제', enemies: raidOff },
  },
  {
    id: 'raid-x3',
    why: '습격대 towerAttack.dmg ×3 — 옛 3번 주석의 판별력 실측(minT 5~7)을 실행물로',
    grade: 'nudge',
    // 실측(fast): minT 중앙값도 8 아래로 내려간다 — 분위 다리와 중앙값 다리가 함께 깨진다.
    targets: ['3.median', '3.p05', '3.deepShare', '1a.clearRate'],
    patch: { id: 'raid-x3', why: '습격대 화력 ×3', enemies: raidDmg(3) },
  },
  {
    id: 'raid-x6',
    why: '습격대 towerAttack.dmg ×6 — 옛 주석 실측 minT 0~4',
    grade: 'kill',
    targets: ['3.p05', '3.floor', '3.deepShare', '1b.waveFloor'],
    patch: { id: 'raid-x6', why: '습격대 화력 ×6', enemies: raidDmg(6) },
  },
  {
    id: 'tough-x3',
    why: '타워 내구도 ×3 — 습격대가 거의 아무것도 못 부순다 (raid-off 의 거울)',
    grade: 'kill',
    targets: ['2.perGame'],
    patch: { id: 'tough-x3', why: '타워 toughness ×3', towers: toughMul(3) },
  },
  {
    id: 'enemy-hp-x140',
    why: '적 체력 ×1.4 — 초심자 하한이 무너지는 난이도',
    grade: 'nudge',
    /**
     * ⚠ 겨냥을 넓혔다(2026-08). 같은 패치가 실제로 깨는 것을 실측으로 다시 세니 다섯이다:
     *   [1-a] 완주율 · q05 · CVaR10 · 절대 바닥 · [1-b] 완주율 · [1-b] 꼬리 CVaR · [5-b] 서열.
     * 옛 카탈로그는 그중 둘만 적고 있었다 — 겨냥을 좁게 적는 것 자체가 커버리지 공백을
     * 실제보다 크게 만든다(빠진 다리는 "아무도 확인 안 한 자리"로 남는다).
     */
    targets: ['1a.clearRate', '1a.q05', '1a.cvar10', '1a.floor', '1b.clearRate', '1b.tailCvar', '5b.rank'],
    patch: { id: 'enemy-hp-x140', why: '적 hp ×1.4', enemies: enemyHp(1.4) },
  },
  {
    id: 'enemy-hp-x070',
    why: '적 체력 ×0.7 — 잘 두는 사람이 거의 안 맞는 난이도 (상한 팔의 되돌리기)',
    grade: 'kill',
    // ⚠ 스테이지6 서열([5-b][17])은 겨냥하지 않는다 — 적 hp ×0.7 로는 별0 봇이 여전히
    //   전 시드 패배다(실측 0/6). 그쪽은 s6-easy 가 맡는다.
    /**
     * ⚠ **[4] 배치 거리의 다섯 다리를 여기서 겨냥한다(2026-08 신설).**
     *   [4]는 문서화된 되돌리기(SIEGE_ENGAGE_RANGE)가 모듈 상수라 주입구가 없어 **항목 전체가
     *   UNPROVEN** 이었다. 적 체력 ×0.7 은 그 되돌리기가 아니다 — 밀착의 벌을 되돌리는 것이
     *   아니라 난이도 축 전체를 내린다. 그래도 이 겨냥은 정직하고 쓸모가 있다:
     *   **"이 다섯 다리는 어떤 값에서나 초록인 게 아니라, 난이도가 내려가면 실제로 발화한다"**
     *   를 증명한다(실측 fast: 밀착 완주율 0% → 문턱 초과 · 웨평비·블록 웨평비·최강+밀착
     *   승률·최강+밀착 여유 전부 빨강). 짝 지배 다리 `4.hug.dominated` 는 여전히 안 깨진다 —
     *   그건 UNPROVEN 에 그대로 남긴다. 대체 대조군을 "같은 축"이라 우기지 않는다는 규율은
     *   **다리 단위로** 지킨다.
     */
    targets: ['1b.slack', '1b.slackMedian', '4.hugRate', '4.waveRatio', '4.blockRatio', '4.strongHug.rate', '4.strongHug.slack'],
    patch: { id: 'enemy-hp-x070', why: '적 hp ×0.7', enemies: enemyHp(0.7) },
  },
  {
    id: 'leak-off',
    why: 'stage01 의 leakDamage 한 줄 삭제 — 옛 5번 주석 실측(8웨이브)을 실행물로',
    grade: 'kill',
    targets: ['5.wave'],
    patch: { id: 'leak-off', why: 'stage01 leakDamage 삭제', stage: leakOff },
  },
  {
    id: 'leak-half',
    why: 'leakDamage compy 3 → 1 — 더 오래 버티며 웨이브 보상이 쌓인다 (골드 다리 전용)',
    grade: 'nudge',
    targets: ['5.gold', '5.wave'],
    patch: { id: 'leak-half', why: 'stage01 leakDamage compy 1', stage: leakHalf },
  },
  {
    id: 'old-hometown',
    why: '구 마을 표(비용 300/600/1200/2400 · hpMul +12%p/레벨) — 이 파일이 적발해 게임을 고쳐 껐던 **문서화된 실제 지배 전략**',
    grade: 'nudge',
    // ⚠ 실측: 이 되돌리기가 실제로 깨우는 것은 **기지(자연) 갈래 하나**다. 예비비 600 을
    //   두는 기지 갈래와 부족 갈래는 구 표에서도 타워를 못 이긴다(그 팔들은 마을을 늦게 산다).
    //   곧 "구 마을 표 = 지배 전략"이라는 문서화된 사실이 붙는 자리는 자연 정책이고,
    //   그 자리를 [7] 이 정확히 잡는다는 것이 여기서 증명된다.
    targets: ['7.baseNat.notDominant'],
    patch: { id: 'old-hometown', why: '구 마을 표', baseLevels: oldHometown },
  },
  {
    id: 'hp-only-hometown',
    why: '마을의 화력 성장만 제거 (HP·비용·정원은 그대로)',
    grade: 'kill',
    // 패치가 정품 팔을 위약 팔과 같게 만들므로 블록별 배율이 전부 1.00 으로 내려간다.
    // ⚠ `9.real.dominates` 는 fast 등급에서 **기준선이 이미 빨갛다**: [9]의 창은 블록당 15라
    //   블록 둘이면 불일치 쌍이 7:0 이고 p 7.81e-3 로 발견용 α(4.167e-3)를 못 넘는다.
    //   full 등급에서는 14:0 · p 6.10e-5 로 넉넉히 넘는다(원장 `9.real.dominates`).
    //   곧 되돌리기가 약한 것이 아니라 **스위트의 표본이 모자란 자리**라 그렇게 공시한다.
    //   이 한 줄이 없으면 fast 실행이 "증명했다"고 조용히 넘어간다 — 옛 규칙의 병이 그것이었다.
    fullOnly: ['9.real.dominates'],
    targets: ['9.kills', '9.blockKills', '9.real.dominates'],
    patch: { id: 'hp-only-hometown', why: '마을 dmg/쿨다운/사거리를 Lv1 고정', baseLevels: hpOnlyHometown },
  },
  {
    id: 'flat-allycap',
    why: '정원 열을 평탄하게 — 마을이 머릿수를 팔지 않는다. 두 비가 정확히 1.000 이 된다',
    grade: 'kill',
    targets: ['11a.strict', '11b.trained', '11b.blocked'],
    patch: { id: 'flat-allycap', why: 'allyCap 전 레벨 2', baseLevels: flatAllyCap },
  },
  {
    id: 'placebo-allies',
    why: '아군의 전투 능력만 0 (가격·속도·hp 그대로) — 이 파일에서 가장 강한 대조군 형태',
    grade: 'kill',
    /**
     * ⚠ 겨냥을 넓혔다(2026-08). 위약 아군은 두 자세(home/front)를 사실상 같은 팔로 만들므로
     *   [12] 의 여유·부호·확률적 지배 다리가 함께 깨지고, [14] 는 두 팔이 바이트 단위로
     *   같아져 잔여 HP 다리까지 깨진다. 옛 카탈로그는 넷만 적었다.
     * ⚠ `12.home.dominates` 는 **fast 등급에서 기준선이 이미 빨갛다**(유의성 다리 · 블록 둘에서
     *   불일치 쌍 부족). 판정 불가를 숨기지 않으려고 fullOnly 에 명시한다.
     */
    fullOnly: ['12.home.dominates'],
    targets: ['8.perHead', '8.real.dominates', '14.real.dominates', '14.hp', '12.home.dominates', '12.slack', '12.slackSign', '12.frontOnly'],
    patch: { id: 'placebo-allies', why: '아군 dmg·봉쇄·사거리 0', allies: placeboAllies },
  },
  {
    id: 'near-placebo',
    why: '아군 사거리만 0.1 — 위약이 아닌 "거의 위약". 승수·잔여 HP 로는 구분되지 않는다',
    grade: 'nudge',
    targets: ['8.perHead'],
    patch: { id: 'near-placebo', why: '아군 range 0.1', allies: nearPlacebo },
  },
  {
    id: 'ally-dmg-x3',
    why: '아군 dmg·hp ×3 — 힘만 되돌린다 (역방향)',
    grade: 'kill',
    // ⚠ 실측: 힘만 3배로 올려서는 [10]의 지배 금지 다리가 **한 번도 안 깨진다**
    //   (부족 26 → 28승 대 타워 29승). 부족 갈래의 약점은 전투력이 아니라 타워에서 빠지는
    //   골드이기 때문이다. 그 자리는 tribe-super 가 맡는다. 여기서 잡히는 것은 몰빵 가드뿐이다.
    targets: ['13.allIn'],
    patch: { id: 'ally-dmg-x3', why: '아군 dmg·hp ×3', allies: allyDmg(3) },
  },
  {
    id: 'tribe-super',
    why: '부족 갈래의 기회비용을 통째로 지운다 — 아군 cost 1 · dmg·hp ×5 · 마을 레벨업 무료',
    grade: 'kill',
    // 부족 팔이 벤치를 승률에서도 넘어서므로 복원된 승률 상한(+2.5%p)도 함께 깨진다.
    targets: ['10.rateCap', '10.tribe.notDominant', '13.tribeAvg', '13.allIn'],
    patch: {
      id: 'tribe-super',
      why: '아군 cost 1 · dmg·hp ×5 + 마을 무료',
      allies: superAlly(5),
      baseLevels: freeTown,
    },
  },
  {
    id: 'tribe-endless',
    why: '같은 되돌리기의 ×10 판 — 무한 모드의 짝 부호검정 다리 전용',
    grade: 'kill',
    // 무한 모드는 창이 작아(블록당 6) 짝 검정의 불일치 쌍이 적다. ×5 는 full 에서 p 2.17e-3 로
    // 겨우 넘고 fast 에서는 못 넘는다(1.13e-1). ×10 은 full 에서 2.44e-4 — 여유를 두고 full 전용으로 둔다.
    minProfile: 'full',
    targets: ['13.tribe.notAhead'],
    patch: {
      id: 'tribe-endless',
      why: '아군 cost 1 · dmg·hp ×10 + 마을 무료',
      allies: superAlly(10),
      baseLevels: freeTown,
    },
  },
  {
    id: 's6-break',
    why: '타워 dmg ×8 + 적 hp ×0.15 — 스테이지6 서열이 무너진다',
    grade: 'kill',
    // ⚠ **얼마나 세게 밀어야 깨지는지 실측했다** (12시드, 별0 봇, 전 덱. 일반 승수 / 불도저 승수):
    //     dmg ×3 · hp ×0.35 → 0 / 0 (웨평 10.58)   dmg ×6 · hp ×0.20 → 0 / 0 (웨평 22.00)
    //     dmg ×8 · hp ×0.15 → **3 / 4** (웨평 36.33)  dmg ×10 · hp ×0.10 → 8 / 8 (웨평 45.00)
    //   곧 이 서열은 한 축으로는 안 깨지고 화력 8배 + 체력 0.15배가 필요하다 — 그 자체가
    //   [5-b]·[17] 이 실제로 무언가를 잠그고 있다는 증거이자 그 여유의 크기다.
    targets: ['5b.lost', '5b.wave', '17.lost'],
    patch: {
      id: 's6-break',
      why: '타워 dmg ×8 + 적 hp ×0.15',
      towers: towerDmg(8),
      enemies: enemyHp(0.15),
    },
  },
  {
    id: 'unit-super',
    why: '아군을 값(cost 1)·힘(dmg·hp ×100)·사거리(×5)까지 되돌린다 — 유닛 갈래가 실제로 지배 전략이 되는 세계',
    grade: 'kill',
    // ⚠ 얼마나 세게 밀어야 깨지는지의 사다리는 godAlly 주석에 실측으로 적어 뒀다.
    //   실측(full): 유닛 80/80 대 벤치 65/80 · 불일치쌍 15:0(p 3.05e-5) · 여유부호 55:17(p 4.07e-6).
    //   실측(fast): 40/40 대 29/40 · 불일치쌍 11:0(p 4.88e-4) — 두 등급 모두에서 깨진다.
    targets: ['7.unit.notDominant', '7.unit.rateCap', '7.unitAll'],
    patch: { id: 'unit-super', why: '아군 cost 1 · dmg·hp ×100 · 사거리 ×5', allies: godAlly },
  },
  {
    id: 'town-super',
    why: '마을을 거의 공짜(cost 1)에 화력 ×5 · 구 HP 곡선으로 — 기지 갈래 둘이 실제로 지배 전략이 되는 세계',
    grade: 'kill',
    // ⚠ `old-hometown` 은 자연 정책 하나만 깨운다(그 주석의 실측 참조). 예비비 600 갈래는
    //   마을을 늦게 사서 구 표로도 타워를 못 이기기 때문이다. 값과 화력을 같이 되돌리면
    //   실측(fast) 예비비 600 갈래 38/40 대 벤치 34/40 · 여유부호 38:1(p 7.28e-11) 로 깨지고,
    //   자연 갈래도 40/40 대 34/40 · 여유부호 40:0(p 9.09e-13) 으로 함께 깨진다.
    //   곧 [7] 의 '지배 금지' 네 다리 중 셋이 여기서 판별력을 얻는다(나머지 하나는 unit-super).
    targets: [
      '7.base600.notDominant', '7.base600.rateCap',
      '7.baseNat.notDominant', '7.baseNat.rateCap',
      '7.baseAll',
    ],
    patch: { id: 'town-super', why: '마을 cost 1 · dmg ×5 · hpMul +12%p/레벨', baseLevels: superTown },
  },
];

/**
 * **판별력이 아직 증명되지 않은 다리** — 이 카탈로그의 어떤 되돌리기도 안 겨냥하는 자리.
 *
 * 이 목록이 이 스위트의 **가장 중요한 산출물**이다. 그리고 한 번 크게 틀렸다:
 * 적대적 리뷰가 세어 보니 **계약 다리 66개 중 38개**를 어떤 대조군도 겨냥하지 않는데
 * 이 목록에는 **다섯 개**만 실려 있었다. 곧 "무엇이 증명 안 됐는지 정직하게 적는다"는
 * 이 파일의 약속이 스스로 낡아 있었고, 빠진 것 중에는 '지배 금지' 계약 둘
 * (`7.unit` · `7.base600`)이 있었다 — 봉투가 잠근다고 적어 놓고 아무도 확인한 적 없는 자리다.
 *
 * ── 그래서 구조를 바꿨다 ─────────────────────────────────────────────────────
 *  1. **커버리지를 코드가 센다.** autoplay.test.ts 의 메타 it 이 "모든 **계약** 다리는
 *     대조군이 겨냥하거나 여기 사유와 함께 실려 있어야 한다"를 검사한다. 빠지면 빨강,
 *     여기 있는데 대조군이 겨냥해도 빨강(목록이 낡은 것이다), 없는 다리를 적어도 빨강.
 *     곧 이 목록이 **손으로 관리하는 표에서 강제되는 표로** 바뀌었다.
 *  2. 그 검사에 맞추려고 실제로 대조군을 늘렸다 — 계약 다리 겨냥 28 → **53개**(자세한 실측은 각
 *     되돌리기의 주석). 특히 `unit-super` · `town-super` 를 신설해 '지배 금지' 네 다리
 *     전부에 판별력을 붙였고, `enemy-hp-x070` 으로 [4] 의 다섯 다리를 처음으로 깨웠다.
 *  3. 남은 자리를 성질별로 묶어 아래에 적는다. **강등은 하지 않았다** — 강등이 곧 완화다.
 *
 * ⚠ 처분 규칙(문턱은 절대 낮추지 않는다): 더 센 kill 대조군을 하나 더 만들어 본다 →
 *   그래도 안 잡히면 그 다리를 monitor 로 강등한다 → 항목의 계약 다리가 전부 강등되면
 *   항목을 삭제하고 보고한다.
 */
export const UNPROVEN: readonly { readonly legs: readonly string[]; readonly tried: string; readonly finding: string }[] = [
  {
    legs: ['4.hug.dominated'],
    tried: 'raid-off (습격대 타워 공격 삭제) · enemy-hp-x070 (적 체력 ×0.7)',
    finding:
      '습격대를 통째로 지워도 밀착 봇은 0/40 그대로이고 웨평비는 0.7350 → 0.7413 으로 거의 안 움직인다. ' +
      '곧 밀착의 벌은 습격대가 아니라 커버 등급(킬존)에서 온다. 적 체력 ×0.7 은 [4] 의 나머지 다섯 다리를 ' +
      '전부 깨웠지만 이 짝 지배 다리만은 못 깼다 — 난이도를 내려도 "안전 배치가 밀착을 짝으로 이긴다"는 ' +
      '부호 자체는 뒤집히지 않기 때문이다(그 사실 자체가 이 다리가 재는 것이 난이도가 아니라 배치 축임을 보인다). ' +
      '문서화된 되돌리기(SIEGE_ENGAGE_RANGE)는 모듈 상수라 주입구가 없다.',
  },
  {
    legs: ['6.dozer.notDominant', '6.rateCap', '6.waveRatio'],
    tried: '없음 (주입구 밖)',
    finding:
      '양성 대조군은 제거 비용(SCENERY_CLEAR_BASE_COST)을 되돌리는 것인데 balance 모듈 상수라 만들 수 없다. ' +
      '게다가 검출력의 상한이 표본이 아니라 상품에 있다 — 두 팔의 국면이 다른 판이 2.5%뿐이다(원장 6.discord). ' +
      '⚠ 다만 "실패 불가능"은 아니다: 방어용 α 를 보정 없는 0.05 로 되돌린 뒤 이 계약의 최소 검출 효과크기가 ' +
      '원장 `6.dozer.notDominant` 의 MDE 로 계산돼 있고(같은 방향으로 몇 판만 더 갈리면 빨개진다), ' +
      'autoplay.test.ts 의 메타 it 이 그 값이 표본 안에서 도달 가능한지를 계약으로 검사한다.',
  },
  {
    legs: ['7.unit.waveRatio', '7.base600.waveRatio', '7.baseNat.waveRatio', '10.waveRatio'],
    tried: '없음 — 후보는 있으나 아직 안 만들었다',
    finding:
      '이 넷은 "갈래가 살아 있다"(웨평비 ≥ 0.93)는 **하한**이라, 깨우려면 갈래를 세게 만드는 것이 아니라 ' +
      '갈래에 쓴 골드가 **아무 값도 못 하게** 만들어야 한다(위약 아군을 [7]·[10] 정책에 먹이는 형태). ' +
      '지금 카탈로그의 placebo-allies 는 [8][12][14] 만 겨냥하고 있어 이 자리를 비워 뒀다 — ' +
      '겨냥을 넓히면 항목 7·10 의 스윕이 대조군 스위트에 통째로 더해져 fast 등급이 눈에 띄게 길어진다. ' +
      '다음 라운드의 예산 항목으로 남긴다(실측 없이 "아마 깨질 것"이라고 적지 않는다).',
  },
  {
    legs: ['12.life', '12.waveRatio'],
    tried: 'placebo-allies (아군 전투 능력 0)',
    finding:
      '위약 아군은 두 자세를 사실상 같은 팔로 만들어 [12] 의 다른 다섯 다리를 깨지만 이 둘은 초록으로 남는다. ' +
      '생존비(home 생존 / front 생존)는 위약이어도 **앞에 세운 쪽이 여전히 먼저 죽어** 2배가 유지되고, ' +
      '웨평비는 두 팔이 같아지면 1.000 이라 상한 1.01 을 못 넘는다. 곧 이 둘을 깨우려면 자세 자체의 ' +
      '기전(전진 배치의 벌)을 되돌려야 하는데 그건 봇 정책이라 데이터 주입구 밖이다.',
  },
  {
    legs: ['5.phase', '5.seedFree', '11a.seedFree', '13.terminates', '17.noGain'],
    tried: '해당 없음 — 성질이 다르다',
    finding:
      '이 다섯은 난이도 계약이 아니라 **구조적 성질**을 고정한다: 방치는 반드시 진다 · 방치와 정원 곡선은 ' +
      '시드 무관이다 · 무한 모드는 끝난다 · 지형 개조가 서열을 뒤집지 않는다. 되돌리기로 "깨우는" 것이 ' +
      '의미 있는 형태가 아니고(깨우려면 게임을 무한 루프로 만들거나 결정론을 부수는 것이다), ' +
      '실제로 이 다리들이 잡는 것은 밸런스 변경이 아니라 **엔진 회귀**다. 정직하게 그렇게 적어 둔다.',
  },
  {
    legs: ['cal.dominates', 'collapse.fires'],
    tried: '해당 없음 — 이 둘이 곧 계기다',
    finding:
      '교정 팔과 붕괴 팔은 다른 다리의 판별력을 **매 실행 증명하는 자리**다. 여기에 대조군을 겨냥하는 것은 ' +
      '"계기를 재는 계기"를 만드는 순환이라 하지 않는다. 대신 이 둘이 빨개지면 그건 게임이 아니라 계기가 ' +
      '깨졌다는 뜻이고, 그 사실은 각 다리의 선언문에 적혀 있다.',
  },
];

/**
 * **주입구가 없는 되돌리기** — 대체 대조군을 "같은 축"이라 우기지 않고 여기 적는다.
 * 상수 주입구를 여는 것은 `src/**` 변경이라 이 작업의 범위 밖이다(별개 결정으로 보고).
 */
export const UNREACHABLE: readonly { readonly what: string; readonly why: string; readonly item: string }[] = [
  {
    what: 'balance.SIEGE_ENGAGE_RANGE 1.7 → 2.1',
    why: '정지 거리가 min(spec.range, SIEGE_ENGAGE_RANGE, towerReach)(siege.ts)라 데이터로는 늘릴 수 없다. 모듈 상수라 주입구가 없다',
    item: '[4] 배치 거리 — 문서화된 되돌리기(웨평비 0.8716 → 1.0059)를 코드로 못 만든다. 자기 대조(밀착 대 안전)로만 남는다',
  },
  {
    what: 'balance.SCENERY_CLEAR_BASE_COST 380',
    why: 'balance 모듈 상수라 주입구가 없다',
    item: '[6] 불도저 — 제거 비용을 되돌리는 양성 대조군을 코드로 못 만든다. 대신 불일치 쌍 비율을 감시 다리로 계속 기록한다',
  },
];
