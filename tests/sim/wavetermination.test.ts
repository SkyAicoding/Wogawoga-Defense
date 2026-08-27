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
import { GATE_HOLD_MAX_TICKS } from '@/data/balance';
import { STAGES } from '@/data/stages';
import type { EnemySim } from '@/sim/entities';
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
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ **2026-08-27 — 체류 상한이 사용자 지시로 없어졌다. 이 파일은 두 팔로 갈라졌다.**
 *
 * 사용자 지시 원문:
 *   > "공룡이 홈타운을 공격할때, 적 공룡 hp 가 남아 있는데도, 몇대 맞다가 죽는게 있어.
 *   >  그러지 말고, hp 만큼 계속해서 살아서 홈 타운을 공격 하도록 해줘."
 * 구현: `updateGate` 의 `gateTicks >= holdTicksFor → leakEnemy` 분기가 삭제됐다.
 *
 * **무엇이 무너졌나**: 이 파일의 옛 하네스는 매 틱 `baseHp = 1e9` 로 마을을 불사로
 * 만들었다. 옛 판에서는 그래도 웨이브가 끝났다 — 문 앞의 적이 상한에 닿아 나갔기
 * 때문이다. 상한이 없어진 지금 그 하네스는 **두 출구를 다 막는다**: 적은 안 나가고
 * (상한 없음) 마을은 안 죽는다(HP 고정). 실측으로 6스테이지 전부가 30,000틱을 넘겼다 —
 * 그런데 그것은 공성 스톨이 아니라 **하네스가 만든 교착**이다. 이 저장소가 세 번 당한
 * 병("잣대가 재려는 것과 다른 것을 잰다")의 네 번째 사례가 될 뻔한 자리다.
 *
 * 그래서 재는 것을 **두 팔로 갈랐다** — 하나에 두 성질을 겹쳐 두면 어느 쪽이 빨간지
 * 알 수 없기 때문이다:
 *
 *  【팔 A · 걷기와 공성의 유한성】 — 이 파일이 원래 만들어진 이유(습격대 스톨).
 *    마을을 불사로 두되, 하네스가 **옛 상한을 그대로 흉내 내어** `gateTicks` 가
 *    `GATE_HOLD_MAX_TICKS` 를 넘긴 개체를 걷어낸다. 곧 문간 체류를 측정 대상에서
 *    **뺀다**. 남는 것은 정확히 "적이 경로를 걸어 문 앞까지 오는 데 걸리는 시간"이고,
 *    그것이 `WAVE_TICK_CAP` 안이어야 한다. 문턱은 **한 톨도 안 내렸다**(6,000 그대로).
 *
 *  【팔 B · 새 종료 논거】 — 문간 체류에는 이제 상한이 없다. 그 대신 문 앞의 개체가
 *    매 주기 마을을 깎으므로 **마을이 죽어서** 판이 끝난다. 그래서 팔 B 는 HP 고정을
 *    걷어내고 실제 판을 끝까지 돌려 (i) 판이 실제로 끝나는가 (ii) 각 웨이브가 여전히
 *    `WAVE_TICK_CAP` 안인가 (iii) 돌파(`enemyLeaked`)가 0건인가를 잰다.
 *
 * ⚠ 판별력(실측으로 확인함, 아래 "판별력" 주석 참조): `bite()` 에 총액 상한을
 *   되돌리면(다 문 개체가 그만 문다) 팔 B 가 6건 전부 빨개진다 — 마을이 안 죽어
 *   판이 영영 안 끝나기 때문이다. 팔 A 는 `siegeWalkLeft`(규칙 4-b)를 지우면 빨개진다.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⚠ (옛 주석 보존) "체류 상한을 없애면"을 `GATE_HOLD_MAX_TICKS` 를 **키우는** 것으로
 *   읽으면 안 된다 — 옛 판에서 그 조작은 아무것도 안 했다. 상한이 종속 변수라
 *   적은 빚을 다 갚으면 어차피 떠났고 그 시간이 `12 × 60 = 720` 으로 상한과 같았다.
 *   실제로 판별력을 재려면 **나갈 길을 먼저 막아야** 했다. 그 함정을 남겨 둔다.
 */
const WAVE_TICK_CAP = 6_000;
/** 이 아래로 내려가면 상한에 닿기 전에 루프를 끊는다 (실패 메시지에 실제 값을 싣기 위함) */
const HARD_CAP = 30_000;

describe('웨이브 종료 보장', () => {
  /**
   * 【팔 A】 하네스가 옛 상한을 **흉내 낸다** — 문간 체류를 측정 대상에서 뺀다.
   *
   * ⚠ 이 걷어내기는 **게임 동작이 아니라 계기**다. 게임에서는 상한이 없어졌고 그것이
   *   옳다(사용자 지시). 여기서 흉내 내는 이유는, 이 팔이 재려는 것이 "적이 경로를
   *   걸어 문 앞까지 오는 데 걸리는 시간"뿐이기 때문이다 — 문간에 얼마나 서 있느냐는
   *   `tests/sim/gate.test.ts` 가 잰다. 겹쳐 두면 어느 쪽이 빨간지 알 수 없다.
   * ⚠ `culled` 를 공허성 가드로 함께 잰다 — 걷어낸 개체가 0 이면 이 팔은 그냥 옛
   *   테스트이고, 그러면 팔 B 와 겹쳐서 두 번 같은 것을 재는 것이 된다.
   */
  for (const stage of STAGES) {
    it(`s${stage.id} 【A】 걷기·공성이 유한하다 — 50웨이브 전부 ${WAVE_TICK_CAP}틱 안`, () => {
      const sim = makeBotSimFor(stage, 1234, ['spear', 'catapult', 'frost']);
      const lens: number[] = [];
      let spawned = 0;
      let culled = 0;

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
          /*
           * 패배로 조기 종료되지 않게 — **정말로 불사여야 한다.**
           * 원래 이 줄은 `baseHpMax`(s2 는 20)로 되돌렸는데, 그러면 "여러 틱에 걸친
           * 누적 피해"만 막고 **한 틱에 baseHpMax 이상**이 들어오면 그대로 진다
           * (checkEnd 는 `baseHp <= 0` 만 본다 — battle.ts:354).
           *
           * 실제로 그렇게 무너졌다: 2라운드에서 s2 에 공중 게이트를 걸자
           * (익룡 몫 예산이 지상으로 돌아 한꺼번에 도착하는 지상 개체가 늘었다)
           * w45 의 어느 한 틱이 20을 넘겨 루프가 45회에서 끊겼다. 그런데 **이 파일이
           * 재려던 종료성은 한 번도 위반되지 않았다** — 그 판의 최장 웨이브가 2,199틱으로
           * 상한 6,000 의 36% 였다. 곧 어서션이 아니라 공허성 가드가 대신 빨개진 것이고,
           * 그것은 "잣대가 재려는 것과 다른 것을 잰다"(CLAUDE.md)의 한 사례다.
           */
          sim.state.baseHp = 1e9;
          sim.tick();
          sim.drainEvents();
          // ⚠⚠ 옛 상한 흉내 — `GATE_HOLD_MAX_TICKS` 를 넘긴 문간 개체를 걷어낸다.
          //   `alive = false` 만 세우면 battle.ts 의 사망 스윕이 그 틱에 회수한다.
          for (const e of sim.state.enemies as EnemySim[]) {
            if (e.alive && e.gateTicks > GATE_HOLD_MAX_TICKS) {
              e.alive = false;
              culled++;
            }
          }
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
      // 그리고 **걷어내기가 실제로 일어났어야** 이 팔이 팔 B 와 다른 것을 잰다
      expect(culled, `s${stage.id} 걷어낸 문간 개체 — 0 이면 상한이 되돌려진 것이다`).toBeGreaterThan(0);

      // ── 본 검증 ────────────────────────────────────────────────────
      const worst = Math.max(...lens);
      const at = lens.indexOf(worst) + 1;
      expect(
        worst,
        `s${stage.id} 최장 웨이브 = ${at}번 ${worst}틱 (${(worst / 30).toFixed(0)}초) · 걷어냄 ${culled}`,
      ).toBeLessThan(WAVE_TICK_CAP);
    }, 600_000);
  }

  /**
   * 【팔 B】 **새 종료 논거를 실제 판에서 잰다** — 마을 HP 고정도, 걷어내기도 없다.
   *
   * 문간 체류에 상한이 없으므로 판을 끝내는 것은 둘 중 하나다: 방어가 문 앞의 적을
   * 전부 죽이거나(웨이브 종료), 문 앞의 이빨이 마을을 죽이거나(패배). 셋째 길은 없고,
   * 특히 **돌파(`enemyLeaked`)는 이제 존재하지 않는다** — 그것을 여기서 직접 잠근다.
   *
   * 실측(시드 1234 · 덱 spear+catapult+frost · 타워 12기 재건):
   *   s1 w10 패배 · s2 w8 · s3 w6 · s4 w5 · s5 w5 · s6 w2 —
   *   최장 웨이브 s1 3,647 · s2 1,871 · s3 2,105 · s4 1,458 · s5 1,708 · s6 1,182틱.
   * ⚠ 이 웨이브 수는 **난이도 지표가 아니다.** 이 하네스는 부족원도 마을 레벨업도
   *   안 쓰는 반쪽 봇이다. 난이도는 `npm run difficulty` 가 잰다.
   */
  for (const stage of STAGES) {
    it(`s${stage.id} 【B】 판이 끝난다 — 마을이 죽거나 적이 다 죽거나 (돌파는 0건)`, () => {
      const sim = makeBotSimFor(stage, 1234, ['spear', 'catapult', 'frost']);
      const lens: number[] = [];
      let leaks = 0;
      let arrivals = 0;
      let ended: 'won' | 'lost' | null = null;

      for (let w = 0; w < 50 && ended === null; w++) {
        sim.state.gold = 9_999_999;
        for (let z = 0; z < stage.gridH && sim.state.towers.length < 12; z++) {
          for (let x = 0; x < stage.gridW && sim.state.towers.length < 12; x++) {
            if (sim.hasScenery(x, z)) sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z });
            sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ: z });
          }
        }
        sim.state.gold = 9_999_999;
        if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });

        let t = 0;
        while (t < HARD_CAP) {
          sim.tick();
          for (const e of sim.drainEvents()) {
            if (e.type === 'enemyAtGate') arrivals++;
            if (e.type === 'enemyLeaked') leaks++;
          }
          t++;
          const p = sim.state.phase;
          if (p === 'won' || p === 'lost') {
            ended = p;
            break;
          }
          if (p === 'prep' && t > 2) break;
        }
        lens.push(t);
      }

      // ── 공허성 가드 ────────────────────────────────────────────────
      expect(arrivals, `s${stage.id} 문 앞에 선 적이 0 — 문간을 안 탄 판이다`).toBeGreaterThan(0);
      expect(Math.min(...lens), `s${stage.id} 최단 웨이브 — 0틱이면 루프가 안 돈 것이다`).toBeGreaterThan(10);

      // ── 본 검증 ────────────────────────────────────────────────────
      // (i) 판이 실제로 끝난다. 50웨이브를 다 돌아도(won) 끝난 것이다
      expect(
        ended ?? (lens.length === 50 ? 'won' : null),
        `s${stage.id} ${lens.length}웨이브를 돌고도 안 끝났다 = 새 종료 논거가 거짓이다`,
      ).not.toBeNull();
      // (ii) 각 웨이브는 여전히 상한 안이다 — 문턱은 한 톨도 안 내렸다
      const worst = Math.max(...lens);
      const at = lens.indexOf(worst) + 1;
      expect(
        worst,
        `s${stage.id} 최장 웨이브 = ${at}번 ${worst}틱 (${(worst / 30).toFixed(0)}초) · 끝 ${ended}`,
      ).toBeLessThan(WAVE_TICK_CAP);
      // (iii) ⚠⚠ 뒤집힌 자리 — 돌파는 문간이 켜진 판에 더는 존재하지 않는다
      expect(leaks, `s${stage.id} 뚫고 들어간 적 ${leaks}마리 — 체류 상한이 되돌려졌다`).toBe(0);
    }, 600_000);
  }
});
