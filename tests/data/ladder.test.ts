/**
 * **스테이지 사다리 (데이터 쪽)** — s1 < s2 < … < s6 을 웨이브 단위로 잠근다.
 *
 * 왜 따로 필요한가: 지금까지 난이도 서열의 근거는 (a) tests/data/stages.test.ts의
 * `budgetBase·hpBase·firstClearAmber가 스테이지 순으로 커진다`와 (b) autoplay 봉투의
 * "s6은 별0으로 클리어 불가" 둘뿐이었다. (a)는 **곡선의 출발점만** 보므로 성장률이
 * 뒤집혀도 통과하고, (b)는 s1과 s6만 본다 — **s2~s5는 아무도 잠그지 않았다.**
 * 이 파일은 그 사이를 웨이브 하나 단위로 메운다.
 *
 * 잣대는 웨이브 총 HP다. 순수 데이터라 **분산이 0이고 봇과 무관**하며 0.01초에 끝난다
 * (봇으로 재는 쪽은 tests/sim/ladder.test.ts가 따로 맡는다 — 둘은 서로를 대신하지 못한다:
 *  총 HP는 "얼마나 두꺼운가"만 알고, 경로 길이·배치 공간·종 구성은 모른다).
 *
 * ── 보스 웨이브에 문턱이 따로 있는 이유 ────────────────────────────────────
 * 10배수 웨이브는 `bossOverrides`로 **손으로 설계**되며, 실제로 스테이지마다 다른 의도가
 * 들어가 있다 — 예를 들어 stage02의 w10은 "첫 보스 벽 완화"로 일부러 ×0.55 눌러 놨다
 * (stage02.ts 주석). 그래서 일반 웨이브와 같은 문턱을 씌우면 그 설계 의도를 금지하게 된다.
 * 실측도 두 무리가 뚜렷이 갈린다: 일반 최소 1.2649 대 보스 최소 1.1130.
 */
import { describe, expect, it } from 'vitest';
import type { StageDef, WaveDef } from '@/data/types';
import { ENEMY_DEFS } from '@/data/enemies';
import { STAGES } from '@/data/stages';
import { makeWaveFor } from '@/data/wavegen';

function totalHp(def: WaveDef): number {
  let sum = 0;
  for (const g of def.groups) sum += ENEMY_DEFS[g.enemyId].hp * g.hpMul * g.count;
  return sum;
}

/** 두 스테이지의 같은 웨이브 총 HP 비 중 최솟값 (보스/일반 중 한 무리만) */
function minRatio(a: StageDef, b: StageDef, boss: boolean): { ratio: number; wave: number } {
  const fa = makeWaveFor(a);
  const fb = makeWaveFor(b);
  let ratio = Infinity;
  let wave = 0;
  for (let w = 1; w <= 50; w++) {
    if ((w % 10 === 0) !== boss) continue;
    const r = totalHp(fb(w)) / totalHp(fa(w));
    if (r < ratio) {
      ratio = r;
      wave = w;
    }
  }
  return { ratio, wave };
}

/**
 * 일반 웨이브 문턱. 실측 최소 **1.2649** (s4→s5 w34)이고 단계별 최소는
 * 1.3649 / 1.2993 / 1.4983 / 1.2649 / 1.3507 이다. 1.20은 그 최소에서 6.5%p 아래다.
 *
 * 판별력(실제로 되돌려 봤다): 뒤 스테이지의 **HP 곡선과 예산 곡선을 앞 스테이지 값으로**
 * 평탄화하면 다섯 단계 전부가 문턱 아래로 떨어진다 —
 *   s1→2 0.9467 · s2→3 0.9546 · s3→4 1.0783 · s4→5 0.9998 · s5→6 1.0106
 * 곧 이 항목은 "뒤 스테이지가 앞 스테이지보다 실제로 두꺼운가"를 잠근다.
 * ⚠ 한쪽 곡선만 평탄화하는 정도로는 안 걸린다(s4의 HP 곡선만 s3로 되돌리면 1.2714).
 *   이 문턱이 잡는 것은 **한 스테이지가 통째로 앞 스테이지 수준으로 주저앉는 것**이지
 *   손잡이 하나의 미세 조정이 아니다.
 */
const NORMAL_MIN = 1.2;
/**
 * 보스 웨이브 문턱. 실측 최소 **1.1130** (s1→s2 w10 — stage02가 첫 보스 벽을 일부러
 * 완화한 자리다). 1.08은 그 최소에서 3.3%p 아래이고, 같은 평탄화 되돌리기에서는
 * 0.5742~1.2310으로 다섯 중 넷이 걸린다.
 */
const BOSS_MIN = 1.08;

describe('스테이지 사다리 — 총 HP는 웨이브마다 뒤 스테이지가 더 두껍다', () => {
  for (let n = 0; n + 1 < STAGES.length; n++) {
    const a = STAGES[n] as StageDef;
    const b = STAGES[n + 1] as StageDef;
    it(`s${a.id} → s${b.id}: 일반 웨이브 ≥${NORMAL_MIN}배 · 보스 웨이브 ≥${BOSS_MIN}배`, () => {
      const normal = minRatio(a, b, false);
      const boss = minRatio(a, b, true);
      expect(
        normal.ratio,
        `일반 최소 ${normal.ratio.toFixed(4)} @w${normal.wave}`,
      ).toBeGreaterThanOrEqual(NORMAL_MIN);
      expect(
        boss.ratio,
        `보스 최소 ${boss.ratio.toFixed(4)} @w${boss.wave}`,
      ).toBeGreaterThanOrEqual(BOSS_MIN);
    });
  }
});
