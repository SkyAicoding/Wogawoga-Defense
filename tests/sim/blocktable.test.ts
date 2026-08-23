/**
 * **블록별 봉투 표** — 20항목 전부를 독립 블록 하나씩으로 다시 재서 JSON 으로 낸다.
 * 기본은 건너뛴다(봉투 한 벌과 맞먹는 스윕이다):
 *
 *     BLOCK_TABLE=1 BLOCK_AT=0 BLOCK_OUT=/tmp/blk0.json npx vitest run tests/sim/blocktable.test.ts
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * 봉투는 항목을 **4블록 합산**으로 판정한다. 합산은 계약을 지는 올바른 눈금이지만,
 * "이 변경이 어디서 무너지는가"를 못 보여 준다 — 완주율 80.63% → 1.25% 는 네 블록이
 * 고르게 내려앉은 것일 수도, 한 블록이 통째로 죽은 것일 수도 있고 처방이 정반대다.
 * 그래서 **같은 판정 코드**(`ITEMS[*].judge`)를 블록 하나만 밟는 프로파일로 돌린다.
 * 새 통계량을 만들지 않는다 = 블록 표와 봉투가 어긋날 여지가 없다.
 *
 * ── 이 파일이 봉투를 건드리지 않는다는 근거 ──────────────────────────────────
 * 유일한 신설 표면은 `Profile.blockAt` 이고 `FULL`·`FAST` 는 그 필드를 안 쓴다
 * (`seedBlocks` 의 기본값 0 = `BLOCKS.slice(0, nb)` = 종전과 같은 식). 곧 봉투와
 * 대조군 스위트의 시드는 한 톨도 안 변한다.
 *
 * ── 문간 전/후를 나란히 재는 법 (저장소를 한 자리도 안 건드린다) ────────────
 *     git archive HEAD | tar -x -C /tmp/before && ln -s "$PWD/node_modules" /tmp/before/
 *     cp tests/sim/{envelope.ts,blocktable.test.ts} /tmp/before/tests/sim/
 *     for at in 0 1 2 3; do (cd /tmp/before && BLOCK_TABLE=1 BLOCK_AT=$at \
 *       BLOCK_OUT=/tmp/blk-before-$at.json npx vitest run tests/sim/blocktable.test.ts) & done; wait
 * 배포본 트리를 이렇게 뽑아 재면 **원장을 그대로 재현한다**(봉투 26/26 초록) — 곧 이 파일이
 * 봉투의 표본을 건드리지 않았다는 것이 규약이 아니라 실행으로 확인된다.
 *
 * ⚠ 블록 하나는 봉투 표본의 4분의 1이라 **짝 부호검정의 p 는 여기서 의미가 약하다**
 * (불일치 쌍이 5 미만이면 어떤 배치라도 p ≥ 0.05 — autoplay.test.ts 헤더 '얇은 곳' 6번).
 * 이 표로 읽어야 하는 것은 p 가 아니라 **승수·여유·비율 같은 점추정의 블록 간 분산**이다.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE, BLOCKS, FULL, type Profile, ledgerSnapshot, withItem } from './envelope';
import { ITEMS } from './autoplay.probes';

const RUN = process.env['BLOCK_TABLE'] === '1';
const AT = Number(process.env['BLOCK_AT'] ?? '0');
const OUT = process.env['BLOCK_OUT'] ?? `/tmp/blocktable-${AT}.json`;
const d = RUN ? describe : describe.skip;

/** 블록 하나만 밟는 프로파일 — 블록당 개수(`scale`)는 **안 줄인다** */
const oneBlock = (at: number): Profile => ({ name: `blk${BLOCKS[at]}`, blocks: 1, scale: 1, blockAt: at });

d('블록별 봉투 표', () => {
  it(`블록 ${BLOCKS[AT]} — 20항목 전부`, () => {
    const prof = oneBlock(AT);
    expect(ITEMS.length, '항목 수가 20이 아니다 — 표 머리를 고쳐라').toBe(20);
    // 연기 시험용 — 비어 있으면 20항목 전부 (보고용 실측은 언제나 전부다)
    const only = (process.env['BLOCK_ITEMS'] ?? '').split(',').filter(Boolean);
    const rows: Record<string, unknown> = {};
    for (const item of ITEMS) {
      if (only.length > 0 && !only.includes(item.id)) continue;
      const t0 = Date.now();
      try {
        const j = withItem(item.id, () => item.judge(BASE, prof));
        rows[item.id] = {
          ok: j.legs.filter((l) => l.kind === 'contract').every((l) => l.ok),
          ms: Date.now() - t0,
          legs: j.legs.map((l) => ({ id: l.id, kind: l.kind, ok: l.ok, value: l.value })),
        };
      } catch (e) {
        rows[item.id] = { ok: false, ms: Date.now() - t0, error: String(e) };
      }
      // 진행 상황을 파일로 흘린다 — 긴 스윕이 중간에 죽어도 어디까지 갔는지 남는다
      appendFileSync(`${OUT}.progress`, `${item.id} ${Date.now() - t0}ms\n`, 'utf8');
    }
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      `${JSON.stringify({ block: BLOCKS[AT], blockAt: AT, full: FULL.blocks, items: rows, ledger: ledgerSnapshot() }, null, 2)}\n`,
      'utf8',
    );
  }, 3_600_000);
});
