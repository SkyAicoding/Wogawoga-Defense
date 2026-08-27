/**
 * **난이도 보고서** — 사용자가 "게임난이도 검토해줘" 라고 할 때 돌리는 도구.
 *
 * ```bash
 * npm run difficulty              # 기본 40시드 · 전 스테이지
 * WGD_SEEDS=80 npm run difficulty # 표본을 늘린다
 * WGD_ALLIES=1 npm run difficulty # 부족원을 뽑는 봇으로 (마법사 효과를 보려면 필수)
 * WGD_OUT=/tmp/x.md npm run difficulty # 표를 낼 곳 (스윕에서 팔끼리 안 덮어쓰게)
 * ```
 *
 * 보고 형식은 **사용자가 지정했다**: 스테이지별 시도 횟수 · 깬 판 수 · 못 깬 판 수 ·
 * 성공률. 여기에 판단에 필요한 셋을 더한다(평균 도달 웨이브 · 평균 여유 · 판당 타워 파괴).
 *
 * ⚠ **이 파일은 `npm test` 에서 안 돈다.** `WGD_DIFFICULTY=1` 이 없으면 통째로 건너뛴다 —
 *   난이도 측정은 몇 분이 걸리고 **판정이 아니라 보고**라서, CI 를 빨갛게 만들 이유가 없다.
 *   (이 저장소의 옵트인 규약은 `AUTOPLAY_LEDGER=1` 이 선례다)
 *
 * ⚠⚠ **계기 함정 — 이걸 모르면 엉뚱한 결론을 낸다.** 기준선 봇은 `allies` 옵션을 안 주면
 *   **부족원을 한 명도 안 뽑는다**(`botharness.ts` 의 그 필드 주석). 그래서 마법사 회복량을
 *   6배 올려도 기본 팔의 결과가 **소수점까지 동일**하다 — 마법사가 없는 세계를 재기
 *   때문이다. 아군·마법사 축을 보려면 반드시 `WGD_ALLIES=1` 로 재라.
 *
 * ⚠ 여기서 나온 숫자로 **밸런스를 임의로 돌리지 마라.** 표를 올리고 기다린다 —
 *   수정 방안은 사용자가 정한다(CLAUDE.md 「밸런스는 사용자가 직접 한다」).
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { TowerId } from '@/data/types';
import { STAGES } from '@/data/stages';
import { makeBotSimFor, runBot, type BotOptions, type BotResult } from './botharness';

const ON = process.env.WGD_DIFFICULTY === '1';
/** 어느 스테이지에서도 같은 도구로 잰다 — 해금덱을 쓰면 덱 성능을 재게 된다(ladder.test.ts) */
const DECK: TowerId[] = ['spear', 'catapult', 'frost'];
const N = Number(process.env.WGD_SEEDS ?? 40);
/** 봉투 창 대장과 같은 축 (공차 37) — 표본이 고를 여지 없이 정직해야 한다 */
const SEEDS = Array.from({ length: N }, (_, i) => 1000 + 37 * i);
const WITH_ALLIES = process.env.WGD_ALLIES === '1';
const OPTS: BotOptions = WITH_ALLIES ? { towerReserve: 600, allies: { minNear: 3 } } : {};

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

describe.skipIf(!ON)('난이도 보고서', () => {
  it('스테이지별 성공률', () => {
    const rows: string[] = [];
    for (const stage of STAGES) {
      const rs: BotResult[] = SEEDS.map((seed) =>
        runBot(makeBotSimFor(stage, seed, DECK), stage, OPTS),
      );
      const won = rs.filter((r) => r.won).length;
      const lost = rs.length - won;
      const wave = rs.reduce((s, r) => s + r.wave, 0) / rs.length;
      const slack =
        rs.reduce((s, r) => s + r.baseHpLeft, 0) / rs.reduce((s, r) => s + r.baseHpMax, 0);
      const destroyed = rs.reduce((s, r) => s + r.destroyed, 0) / rs.length;
      rows.push(
        `| s${stage.id} | ${rs.length} | ${won} | ${lost} | ${pct(won / rs.length)} | ` +
          `${wave.toFixed(1)} / ${stage.waveCount} | ${pct(slack)} | ${destroyed.toFixed(1)} |`,
      );
    }
    const table = [
      '',
      `## 난이도 보고서 (봇 ${WITH_ALLIES ? '부족원 O' : '부족원 X'} · 시드 ${N} · 덱 spear+catapult+frost)`,
      '',
      '| 스테이지 | 시도 | 깬 판 | 못 깬 판 | 성공률 | 평균 도달 웨이브 | 평균 여유 | 판당 타워 파괴 |',
      '|---|---|---|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n');
    // ⚠ 파일로 낸다 — vitest 리포터가 console 출력을 삼키는 일이 있어서
    //   (실제로 이 저장소에서 프로브 출력이 두 번 사라졌다), 표는 반드시 남아야 한다.
    // ⚠ 경로를 env 로 받는 이유: 손잡이 스윕은 **여러 팔을 동시에** 돌리는데, 경로가
    //   고정이면 팔들이 서로의 표를 덮어써서 조용히 같은 숫자를 읽게 된다(실제로
    //   문간 주기 스윕에서 걸릴 뻔했다). 팔마다 `WGD_OUT` 을 다르게 준다.
    writeFileSync(process.env.WGD_OUT ?? '/tmp/difficulty.md', table, 'utf8');
    // eslint-disable-next-line no-console
    console.log(table);
  }, 3_600_000);
});
