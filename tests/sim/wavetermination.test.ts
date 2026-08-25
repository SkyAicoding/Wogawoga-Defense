/**
 * 웨이브 종료 보장 — **실제 6개 스테이지 · 50웨이브 전부**가 유한 시간에 끝나는가.
 *
 * 습격대를 전원 원거리·정지 사격으로 바꾸면서 생긴 가장 큰 위험이 이것이다.
 * 멈춰 서는 적은 원리상 "영원히 서 있는" 상태가 될 수 있고, 그러면 웨이브가
 * 끝나지 않아 게임이 얼어붙는다. siege.ts 규칙 4-b(유한 정지 + 의무 전진)가
 * 그걸 막는 장치이고, 이 파일은 그 장치를 **합성 목이 아니라 진짜 판**에서 잰다.
 *
 * siege.test.ts 에도 스톨 방지 검증이 있지만 그쪽은 목 전장(z=2 가로줄 · 죽일 수 없는
 * 타워 40기)이다. 목은 규칙을 정확히 겨냥하는 대신 **실제 경로 모양 · 실제 적 조합 ·
 * 실제 웨이브 예산**을 재지 못한다. 두 층이 다 필요하다.
 *
 * 타워를 12기(배치 상한 8보다 많이) 깔아 두는 것은 일부러다 — 타워가 많을수록
 * 습격대가 멈출 구실이 많아져 스톨에 가장 가까운 국면이 된다.
 */
import { describe, expect, it } from 'vitest';
import { STAGES } from '@/data/stages';
import { makeBotSimFor } from './botharness';

/**
 * 한 웨이브의 상한 (30Hz 기준 200초).
 *
 * 실측 최장: **3,141틱(105초, s1 w50)** — 1.91배 여유.
 * (s1 3141 · s2 2639 · s3 2809 · s4 1907 · s5 3135 · s6 2641 — 전부 w50)
 *
 * ⚠ 11단계(문간 교전)가 이 수를 2,772 → 2,801 로 **+29틱** 움직였고, 이번 라운드가
 *   `GATE_BITE_TICKS` 를 30 → 60(따라서 `GATE_HOLD_MAX_TICKS` 를 360 → 720)으로 올리면서
 *   2,801 → **3,141** 로 **+340틱** 더 움직였다. 이론 상계는 개체당
 *   `GATE_HOLD_MAX_TICKS` = 720 인데(gate.ts 보조정리 C) 실제 증분이 그 절반 아래인 이유는,
 *   웨이브의 끝을 정하는 것이 **가장 느린 보행자**이지 문 앞에 오래 서는 trex 가 아니기
 *   때문이다. 상계와 실측을 둘 다 적어 두는 이유는 경로·속도 데이터가 바뀌면 실측은
 *   움직여도 **상계는 안 움직이기** 때문이다.
 *
 * ⚠⚠ 이 파일은 문간 종료 증명의 **두 번째 층**이다(첫 층은 tests/sim/gate.test.ts 의
 *   불사 적). 체류 상한을 없애면 여기 6건이 전부 빨개진다 — 실제로 확인했다.
 *   `claude/gate-wip`(10e1187)이 정확히 그 상태였다(s1 w30 에서 30,000틱 초과).
 */
const WAVE_TICK_CAP = 6_000;
/** 이 아래로 내려가면 상한에 닿기 전에 루프를 끊는다 (실패 메시지에 실제 값을 싣기 위함) */
const HARD_CAP = 30_000;

describe('웨이브 종료 보장', () => {
  for (const stage of STAGES) {
    it(`s${stage.id}: 50웨이브가 모두 유한 시간에 끝난다`, () => {
      const sim = makeBotSimFor(stage, 1234, ['spear', 'catapult', 'frost']);
      const lens: number[] = [];
      let spawned = 0;

      for (let w = 0; w < 50; w++) {
        // 타워를 매 웨이브 최대한 다시 세운다 (부서져도 채운다) — 멈출 구실을 최대로
        sim.state.gold = 9_999_999;
        for (let z = 0; z < stage.gridH && sim.state.towers.length < 12; z++) {
          for (let x = 0; x < stage.gridW && sim.state.towers.length < 12; x++) {
            if (sim.hasScenery(x, z)) sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z });
            sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ: z });
          }
        }
        sim.state.gold = 9_999_999;
        if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });

        // phase 전환은 커맨드가 아니라 **다음 틱**에 일어난다.
        // 커맨드 직후에 phase를 보면 아직 'prep'이라, 그걸 루프 조건으로 쓰면
        // 루프가 0틱만에 끝나고 **검증이 통째로 공허해진다**(0틱은 항상 상한 미만이다).
        let t = 0;
        while (t < HARD_CAP) {
          sim.state.baseHp = sim.state.baseHpMax; // 패배로 조기 종료되지 않게
          sim.tick();
          t++;
          spawned = Math.max(spawned, sim.state.enemies.length);
          const p = sim.state.phase;
          if (p === 'won' || p === 'lost') break;
          if (p === 'prep' && t > 2) break; // 웨이브 종료
        }
        lens.push(t);
        if (sim.state.phase === 'won' || sim.state.phase === 'lost') break;
      }

      // ── 검증이 공허하지 않은지 먼저 ──────────────────────────────────
      // 위 주석의 함정을 그대로 잠근다: 웨이브가 실제로 돌았고 적이 실제로 나왔어야 한다
      expect(lens.length, `s${stage.id} 웨이브 수`).toBe(50);
      expect(Math.min(...lens), `s${stage.id} 최단 웨이브 — 0틱이면 루프가 안 돈 것이다`).toBeGreaterThan(10);
      expect(spawned, `s${stage.id} 동시 최대 적 수`).toBeGreaterThan(0);

      // ── 본 검증 ────────────────────────────────────────────────────
      const worst = Math.max(...lens);
      const at = lens.indexOf(worst) + 1;
      expect(
        worst,
        `s${stage.id} 최장 웨이브 = ${at}번 ${worst}틱 (${(worst / 30).toFixed(0)}초)`,
      ).toBeLessThan(WAVE_TICK_CAP);
    }, 600_000);
  }
});
