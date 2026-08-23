/**
 * **문간 공성 실측** — `GATE_BITE_DIVISOR` 3점 스윕과 `gateTicks` 눈금.
 * 기본은 건너뛴다(봉투와 같은 창을 세 번 도는 값비싼 스윕이다):
 *
 *     GATE_MEASURE=1 npx vitest run tests/sim/gatemeasure.test.ts
 *
 * 재는 것 둘:
 *  ① **divisor 스윕(4 / 6 / 8)** — 봉투 [1-a] 완주율이 원장 블록 분포 안에 남는 **최대값**.
 *  ② **gateTicks 눈금** — 기준선 봇 스테이지1 w50 trex 의 문간 체류 틱 중앙값.
 *     합격선 ≥ 250틱(8.3초). 문간 도입 전 값은 구조적으로 **정확히 0**이다.
 * 표는 보고서에 그대로 옮긴다. 값을 어서션으로 굳히지 않는 이유: 이건 계약이 아니라
 * **손잡이를 고르기 위한 계기**이고, 계약은 봉투([1-a]·[5])와 `gate-off` 대조군이 진다.
 */
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StageDef } from '@/data/types';
import type { BotResult, GateStint } from './botharness';
import { BASE, cvar, play, rate, seedBlocks, seedsOf, slack, slackOf, type DataPatch } from './envelope';
import { STAGE1_DECK } from './autoplay.probes';
import { GATE_OFF_PATCH } from './controls';
import { STRONG_BOT } from './botharness';

const RUN = process.env['GATE_MEASURE'] === '1';
/**
 * 표는 **파일로** 낸다 — vitest 기본 리포터는 통과한 it 의 stdout 을 접어 버려서
 * `console.log` 로는 정작 필요한 표가 안 보인다(한 번 당했다).
 */
const OUT = process.env['GATE_MEASURE_OUT'] ?? '/tmp/gatemeasure.txt';
const report = (text: string): void => {
  appendFileSync(OUT, `${text}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(text);
};
const d = RUN ? describe : describe.skip;

/** divisor 만 갈아 끼운 패치 — `StageDef.gate` 가 유일한 주입구다 */
const divisorPatch = (divisor: number): DataPatch => ({
  id: `gate-div-${divisor}`,
  why: `문간 divisor ${divisor}`,
  stage: (s: StageDef): StageDef => ({ ...s, gate: { ...(s.gate ?? {}), divisor } }),
});

/** 되돌리기 카탈로그와 **같은 패치를 쓴다** — 두 벌이면 실측과 대조군이 갈라진다 */
const GATE_OFF = GATE_OFF_PATCH;

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
};
const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

/** 기준선 창(base1, 4블록 × 40) 그대로 — [1-a] 가 읽는 바로 그 판들이다 */
function base1(patch: DataPatch): BotResult[] {
  return play({ stageId: 1, deck: STAGE1_DECK, seeds: seedsOf('base1'), patch });
}
/** 최강 창(strong, 4블록 × 40) — [1-b] 가 읽는 바로 그 판들이다 */
function strongArm(patch: DataPatch): BotResult[] {
  return play({ stageId: 1, deck: STAGE1_DECK, seeds: seedsOf('strong'), opts: STRONG_BOT, patch });
}
function base1Blocks(patch: DataPatch): BotResult[][] {
  const rs = base1(patch);
  const blocks = seedBlocks('base1');
  let i = 0;
  return blocks.map((b) => rs.slice(i, (i += b.length)));
}

const stintsOf = (rs: readonly BotResult[], defId: string): GateStint[] =>
  rs.flatMap((r) => r.gateStints.filter((g) => g.defId === defId));

d('문간 실측', () => {
  it('divisor 스윕 (4 / 6 / 8) + gate-off 기준선', () => {
    const rows: string[] = [];
    /*
     * divisor 4 는 `BASE` 를 그대로 쓴다 — 배포 기본값이 4라 같은 세계이고, 패치 id 가
     * 다르면 캐시가 안 맞아 160판을 한 번 더 돈다(gateTicks 항목도 BASE 를 읽는다).
     * 16 · 32 는 3점(4/6/8) 밖이지만 **일부러 넣었다**: 스윕이 "더 올리면 되는데 안 올린
     * 것"인지 "올려도 안 되는 것"인지를 표가 스스로 말해야 하기 때문이다.
     */
    const arms: { name: string; patch: DataPatch }[] = [
      { name: 'gate-off (오늘)', patch: GATE_OFF },
      { name: 'divisor 4 (기본)', patch: BASE },
      { name: 'divisor 6', patch: divisorPatch(6) },
      { name: 'divisor 8', patch: divisorPatch(8) },
      { name: 'divisor 16', patch: divisorPatch(16) },
      { name: 'divisor 32', patch: divisorPatch(32) },
    ];
    for (const a of arms) {
      const rs = base1(a.patch);
      const blocks = base1Blocks(a.patch);
      const trex = stintsOf(rs, 'trex');
      const spino = stintsOf(rs, 'spino');
      rows.push(
        [
          a.name.padEnd(18),
          `완주 ${pct(rate(rs))} (${rs.filter((r) => r.won).length}/${rs.length})`,
          `블록 [${blocks.map((b) => b.filter((r) => r.won).length).join(' ')}]`,
          `여유합 ${rs.reduce((s, r) => s + r.baseHpLeft, 0)}`,
          `trex 대치 n=${trex.length} 중앙 ${median(trex.map((g) => g.ticks))}틱 ` +
            `한입 ${median(trex.map((g) => g.bites))} 처치 ${trex.filter((g) => g.killed).length}`,
          `spino 대치 n=${spino.length} 중앙 ${median(spino.map((g) => g.ticks))}틱`,
        ].join(' · '),
      );
    }
    report(`\n── divisor 스윕 (창 base1 = 4블록 × 40 = 160판) ──\n${rows.join('\n')}`);
    expect(rows).toHaveLength(arms.length);
  }, 1_800_000);

  it('divisor 스윕 — 최강 팔([1-b] 상한 다리가 여기서 깨진다)', () => {
    const rows: string[] = [];
    for (const a of [
      { name: 'gate-off (오늘)', patch: GATE_OFF },
      { name: 'divisor 4', patch: divisorPatch(4) },
      { name: 'divisor 6', patch: divisorPatch(6) },
      { name: 'divisor 8', patch: divisorPatch(8) },
    ]) {
      const rs = strongArm(a.patch);
      const trex = stintsOf(rs, 'trex');
      rows.push(
        [
          a.name.padEnd(18),
          `완주 ${pct(rate(rs))} (${rs.filter((r) => r.won).length}/${rs.length})`,
          `여유 ${pct(slack(rs))} (상한 55%)`,
          `판당여유중앙 ${pct(median(rs.map(slackOf)))}`,
          `꼬리CVaR10 ${pct(cvar(rs.map(slackOf), 0.1))} (하한 30%)`,
          `최소웨 ${Math.min(...rs.map((r) => r.wave))}`,
          `trex 대치 n=${trex.length} 중앙 ${median(trex.map((g) => g.ticks))}틱 처치 ${trex.filter((g) => g.killed).length}`,
        ].join(' · '),
      );
    }
    report(`\n── divisor 스윕 · 최강 팔 (창 strong = 160판) ──\n${rows.join('\n')}`);
    expect(rows.length).toBeGreaterThan(0);
  }, 1_800_000);

  it('문간의 반격 수단이 실제로 듣는가 — 아군 봉쇄 정책 팔', () => {
    /*
     * 1-A 설계의 핵심 주장은 "적극적이면 더 편하다"이고, 그 적극성의 두 수단은
     * **아군 봉쇄**와 (2단계의) 문간 집결 버튼이다. 봉투 팔들은 둘 다 안 쓴다 —
     * 기준선/최강 봇은 부족원을 한 명도 안 뽑는다. 그래서 "봉투가 빨간 것"이
     * **게임이 깨진 것**인지 **계기가 반격을 안 쓰는 것**인지를 여기서 가른다.
     */
    const opts = { towerReserve: 600, allies: { minNear: 1 } } as const;
    const rows: string[] = [];
    for (const a of [
      { name: 'gate-off · 아군정책', patch: GATE_OFF },
      { name: 'divisor 4 · 아군정책', patch: BASE },
      { name: 'divisor 8 · 아군정책', patch: divisorPatch(8) },
    ]) {
      const rs = play({
        stageId: 1,
        deck: STAGE1_DECK,
        seeds: seedsOf('base1'),
        opts,
        patch: a.patch,
      });
      const trex = stintsOf(rs, 'trex');
      const spino = stintsOf(rs, 'spino');
      rows.push(
        [
          a.name.padEnd(22),
          `완주 ${pct(rate(rs))} (${rs.filter((r) => r.won).length}/${rs.length})`,
          `아군 ${rs.reduce((x, r) => x + r.alliesTrained, 0)}명`,
          `trex 대치 n=${trex.length} 중앙 ${median(trex.map((g) => g.ticks))}틱 처치 ${trex.filter((g) => g.killed).length}`,
          `spino 대치 n=${spino.length} 중앙 ${median(spino.map((g) => g.ticks))}틱 처치 ${spino.filter((g) => g.killed).length}`,
        ].join(' · '),
      );
    }
    report(`\n── 반격 수단(아군 봉쇄) 팔 (창 base1 = 160판) ──\n${rows.join('\n')}`);
    expect(rows.length).toBeGreaterThan(0);
  }, 1_800_000);

  it('gateTicks 합격선 — 기준선 봇 스테이지1 w50 trex 중앙값 ≥ 250틱', () => {
    const rs = base1(BASE);
    const trex = stintsOf(rs, 'trex');
    const med = median(trex.map((g) => g.ticks));
    report(
      `\n── gateTicks (BASE) ──\n` +
        `trex 대치 ${trex.length}건 · 중앙 ${med}틱 (${(med / 30).toFixed(1)}초) · ` +
        `최소 ${Math.min(...trex.map((g) => g.ticks))} · 최대 ${Math.max(...trex.map((g) => g.ticks))} · ` +
        `문간 처치 ${trex.filter((g) => g.killed).length}/${trex.length}\n`,
    );
    expect(trex.length, '기준선 봇이 w50 trex 를 문간까지 보낸 판이 있어야 한다').toBeGreaterThan(0);
    expect(med, 'gateTicks 중앙값 ≥ 250틱 (8.3초)').toBeGreaterThanOrEqual(250);
  }, 1_800_000);
});
