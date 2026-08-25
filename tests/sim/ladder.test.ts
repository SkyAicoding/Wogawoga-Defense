/**
 * **스테이지 사다리 (플레이 쪽)** — 같은 봇·같은 덱으로 s1부터 s6까지 실제로 굴려서
 * "뒤 스테이지가 실제로 더 멀리 못 간다"를 잠근다.
 *
 * tests/data/ladder.test.ts(총 HP 비)와 **서로를 대신하지 못한다**: 총 HP는 "얼마나
 * 두꺼운가"만 알고 경로 길이·배치 공간·물(~)·종 구성은 모른다. 실제로 이 축들은
 * 스테이지마다 두 배 넘게 차이 난다(최단 경로 s4 17.59 ~ s1 36.19).
 *
 * ── 왜 승수도 여유도 아닌 **평균 도달 웨이브**인가 ─────────────────────────
 * s2~s6에서는 별 0 봇의 승수가 **전부 0/20이고 여유도 전부 0.0%**다(실측). 곧 그 두
 * 지표는 이 구간에서 상수라 아무것도 못 잰다. 평균 도달 웨이브만이 s2와 s6을 구분한다.
 * (봉투 10·13번이 같은 이유로 이미 이 지표를 쓴다 — 분산이 승수의 1/10이다)
 *
 * ── 덱을 반드시 고정하는 이유 (이게 이 파일에서 가장 미묘한 부분이다) ──────
 * 해금덱(8장)으로 재면 **ballista(사거리 5.5)가 s4~s6만 밀어 올린다** — 경로가 짧고
 * 배치 공간이 좁은 스테이지일수록 긴 사거리의 값이 커지기 때문이다. 실측(시드 20):
 *   고정덱 웨평 48.55 · 19.55 ·  9.65 · 8.60 · 6.75 · 6.00 → 단계비 최악 **0.8912**
 *   해금덱 웨평 49.70 · 15.05 ·  9.05 · 7.20 · 6.90 · 6.30 → 단계비 최악 **0.9583**
 *
 * ⚠ **15단계: s1의 웨평이 49.05 → 48.55로 내려갔다** (문턱이 아니라 기록을 고친 것이다).
 *   스테이지1에 공중 축이 들어오면서(stage01.airPaths · wavePlan.airFromWave 22) 기준선
 *   봇이 후반에 조금 더 자주 무너진다. 나머지 다섯 스테이지는 한 자리도 안 움직였고
 *   (공중 게이트가 없어 곡선 풀 분기를 타지 않는다) 단계비 최악도 0.8912 그대로다.
 *   s2/s1만 0.3986 → 0.4027로 올라간다 — 문턱(0.95)에서 여전히 55%p 아래다.
 * 해금덱에서는 s5/s4가 0.9583까지 올라가 사다리가 거의 평평해진다(s5→s6은 0.9130).
 * 곧 이 항목이 재려는 것은 스테이지의 난이도이지 덱의 성능이 아니므로, 덱은
 * **초기 3장으로 못 박는다**. 이 문단이 곧 문턱 0.95의 판별력 증명이기도 하다 —
 * 덱 고정을 풀면 s5/s4가 문턱을 넘어 즉시 빨개진다.
 */
import { describe, expect, it } from 'vitest';
import type { TowerId } from '@/data/types';
import { stageById } from '@/data';
import { makeBotSimFor, runBot, type BotResult } from './botharness';

/** 초기 해금 3장 — 어느 스테이지에서도 같은 도구로 잰다 (위 ⚠ 참조) */
const DECK: TowerId[] = ['spear', 'catapult', 'frost'];
/** autoplay 봉투와 같은 고정 등차수열 */
const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + 37 * i);
/**
 * 한 칸 내려갈 때 최소한 이만큼은 짧아져야 한다. 실측 단계비는
 * 0.3986 / 0.4936 / **0.8912** / 0.7849 / 0.8889 이고 최악(s4/s3)이 0.8912라
 * 0.95는 5.8%p의 여유를 남긴다. 해금덱에서는 0.9583이 나와 이 문턱에 걸린다.
 */
const STEP_MAX = 0.95;

describe('스테이지 사다리 — 같은 봇·같은 덱으로 뒤 스테이지가 더 못 간다', () => {
  it('평균 도달 웨이브가 s1 > s2 > … > s6 로 단조 감소하고, 매 단계 5% 이상 짧아진다', () => {
    const avg: number[] = [];
    const detail: string[] = [];
    for (let sid = 1; sid <= 6; sid++) {
      const stage = stageById(sid);
      if (!stage) throw new Error(`no stage ${sid}`);
      const rs: BotResult[] = SEEDS.map((seed) =>
        runBot(makeBotSimFor(stage, seed, DECK), stage, {}),
      );
      const a = rs.reduce((s, r) => s + r.wave, 0) / rs.length;
      avg.push(a);
      detail.push(`s${sid} 웨평 ${a.toFixed(2)} (승 ${rs.filter((r) => r.won).length}/20)`);
    }
    const msg = detail.join(' · ');
    for (let i = 1; i < avg.length; i++) {
      const prev = avg[i - 1] as number;
      const cur = avg[i] as number;
      expect(cur, `s${i + 1} < s${i}: ${msg}`).toBeLessThan(prev);
      expect(cur / prev, `s${i + 1}/s${i} = ${(cur / prev).toFixed(4)}: ${msg}`).toBeLessThanOrEqual(
        STEP_MAX,
      );
    }
    // 검증이 공허하지 않은지 — s1은 실제로 완주하는 판이어야 하고 s6은 초반에 끝나야 한다
    expect(avg[0], msg).toBeGreaterThan(40);
    expect(avg[5], msg).toBeLessThan(15);
  }, 600_000);
});
