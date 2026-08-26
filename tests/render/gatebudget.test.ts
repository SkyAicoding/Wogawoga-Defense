/**
 * 문간 예산 실측 — **드로우콜과 삼각형이 문 앞 대치 때문에 늘지 않는가.**
 *
 * ── 왜 e2e 가 아니라 여기인가 ─────────────────────────────────────────────────
 * 이 저장소의 예산 판정은 원래 `tests/e2e/smoke.spec.ts` 의 `renderInfo()`(실제
 * WebGL 렌더러가 센 값)가 맡는다. 그쪽이 진짜 잣대이고 이 파일이 그것을 대신하지 않는다.
 * 그런데 이 파일이 재는 질문은 **e2e 가 잘 못 재는 종류**다: "같은 적 집합이 걷고 있을
 * 때와 문 앞에 서 있을 때 사이에 콜이 하나라도 늘었는가". e2e 로 그 둘을 나란히 세우려면
 * 실제 웨이브를 두 번 굴려 같은 순간을 잡아야 하는데, 그 두 프레임은 투사체·파티클·
 * 체력바가 제각각이라 **차이가 잡음에 묻힌다.**
 * 여기서는 두 팔에 **같은 적 집합**을 주고 나머지를 전부 동일하게 세워 차이만 남긴다.
 *
 * ⚠ 이 파일이 세는 것은 **씬 그래프의 그려질 메시 수**다(WebGL 없이 THREE 객체만 본다).
 *   절대값은 실제 프레임보다 작다 — 타워·투사체·체력바가 없고 포스트 패스도 없다.
 *   여기서 읽어야 하는 것은 절대값이 아니라 **두 팔의 차이**다.
 */
import { describe, expect, it } from 'vitest';
import { build } from '@/render/stage3d';
import { STAGES } from '@/data';
import type { EnemyId, EnemyState } from '@/data/types';
// 그리기 잣대는 비전투 배경 예산(warmup.test.ts)과 **같은 것**을 쓴다 — drawcount.ts 주석 참조
import { drawables } from './drawcount';

const Q = { shadows: true, particles: 1, antialias: true, dpr: 2 } as never;

function foe(o: Partial<EnemyState>): EnemyState {
  return {
    id: 1, defId: 'raptor', hp: 10, maxHp: 10, shieldHitsLeft: 0, dist: 12, pathIndex: 0,
    attackCdLeft: 0, towerTargetId: -1, siegeHoldLeft: 0, attackAnimLeft: 0, attackAnimTicks: 0,
    blockerAllyId: -1, gateTicks: 0, gateBiteCdLeft: 0, gateOwed: 0,
    flying: false, x: 9, z: 11.5, prevX: 9, prevZ: 11.5, heading: 0, statuses: [],
    bounty: 1, baseDamage: 1, radius: 0.3, alive: true, hpMul: 1, ...o,
  };
}

/** 새 장면을 세우고 같은 적 집합으로 N 프레임 돌린 뒤 잰다 — 두 팔을 완전히 격리한다 */
function measure(level: number, foes: readonly EnemyState[], frames = 6) {
  const s3 = build(STAGES[0]!, Q);
  s3.setBaseLevel(level);
  const cw = s3.cellToWorld.bind(s3);
  for (let i = 0; i < frames; i++) {
    s3.enemies.update(foes, 1, cw, 0.033, []);
    s3.update(0.033);
  }
  return drawables(s3.scene);
}

/**
 * 걷는 무리 → 같은 무리를 문 앞에 세운 것.
 * ⚠ 여기 ±0.6 은 **드로우콜을 재려고 벌려 놓은 목 좌표**이지 부채 식이 아니다.
 *   실제 부채는 마을 중심 원 위의 **회전**이고 이웃 간격이 호장 `GATE_FAN_SPACING`
 *   0.46 × `GATE_FAN_COLS` 9줄이다(gate.ts 규칙 2-b). 이 파일이 재는 것은 드로우콜/
 *   삼각형이라 좌표의 정확한 값과 무관하다 — 겹치지만 않으면 된다.
 */
function gated(foes: readonly EnemyState[]): EnemyState[] {
  return foes.map((e, i) => ({
    ...e,
    gateTicks: 5 + i,
    gateOwed: e.baseDamage,
    dist: 12,
    x: 9 + ((i % 3) - 1) * 0.6,
    prevX: 9 + ((i % 3) - 1) * 0.6,
    z: 11.5,
    prevZ: 11.5,
  }));
}

const MIX: readonly EnemyId[] = ['blade', 'raptor', 'ptera', 'lancer', 'boar', 'trike'];

function crowd(n: number): EnemyState[] {
  return Array.from({ length: n }, (_, i) =>
    foe({
      id: 100 + i,
      defId: MIX[i % MIX.length]!,
      flying: MIX[i % MIX.length] === 'ptera',
      x: 5 + i * 0.12,
      prevX: 5 + i * 0.12 - 0.05,
      dist: 6,
    }),
  );
}

describe('문간 예산', () => {
  /**
   * 이번 변경의 렌더 쪽 핵심 주장이다: **새 메시 0 · 새 인스턴서 0**.
   * 문 앞의 그림은 전부 기존 층에 얹혔다 —
   *  · 서서 때리는 동작 → 기존 보행/공격 어트리뷰트(GAIT_ATTR · ATTACK_ATTR)
   *  · 도착 먼지·지붕 파편 → 기존 파티클 인스턴서
   *  · 띠·경보 → DOM
   */
  // 실측(이 파일 기준, s1 Lv1): 걷는 중 16콜 / 32,317삼각형 → 문 앞 16콜 / 32,317삼각형
  it('같은 무리가 걷든 문 앞에 서든 드로우콜·삼각형이 같다 (18마리)', () => {
    const walking = crowd(18);
    const a = measure(1, walking);
    const b = measure(1, gated(walking));
    expect(b.calls).toBe(a.calls);
    expect(b.tris).toBe(a.tris);
  });

  // 실측: trex + spino, 걷는 중 15콜 / 27,029 → 문 앞 15콜 / 27,029
  it('보스 둘이 문 앞에 서도 콜이 안 는다', () => {
    const mk = (gate: number): EnemyState[] => [
      foe({ id: 1, defId: 'trex', radius: 0.8, baseDamage: 12, x: 9, prevX: 9, gateTicks: gate, gateOwed: gate > 0 ? 12 : 0 }),
      foe({ id: 2, defId: 'spino', radius: 0.7, baseDamage: 5, x: 9.6, prevX: 9.6, gateTicks: gate, gateOwed: gate > 0 ? 5 : 0 }),
    ];
    const a = measure(5, mk(0));
    const b = measure(5, mk(40));
    expect(b.calls).toBe(a.calls);
    expect(b.tris).toBe(a.tris);
  });

  /**
   * 문간이 실제로 늘리는 것은 **동시 생존 적 수** 하나다(체류 하한 90틱 × 도착률).
   * 적은 인스턴싱이라 드로우콜에는 안 실리지만 삼각형에는 실린다 — 그래서
   * 홍수 웨이브의 상한(WAVE_MAX_SPAWNS 60)을 통째로 문 앞에 세워 두고 잰다.
   * 예산은 프레임 150,000 이고 여기에 타워·체력바·투사체가 더 붙는다.
   *
   * ── 드로우콜 문턱을 다시 유도한 자리 (이전: `calls <= 90`) ──────────────────
   * 90은 **e2e 최악 프레임**(실제 렌더러 · 타워 12기 · 적 56 · 아군 6)의 예산이다.
   * 그 수를 이 파일에 그대로 옮겨 적은 것이 잘못이었다 — 여기는 WebGL 없는 씬 그래프
   * 잣대이고 타워·투사체·체력바가 아예 없어서 실측이 **16콜**이다. 여유 74로는
   * "적 60마리가 60콜이 됐다"는 파국 말고는 아무것도 못 잡는다.
   *
   * 무엇을 재는 프레임인가: s1 Lv1 · 스폰 상한 60마리 전원 문 앞 · 타워 0.
   * 실측 유도: 적 0 프레임 11콜 + MIX 6종이 실제로 쓰는 인스턴스 메시 5개 = **16콜**
   *   (부족 습격대 blade·lancer 는 지오메트리를 공유해 한 메시다 — enemyGeoKey)
   * 문턱 20 = 실측 16 + 여유 4. 실측에 딱 붙이지 않는 이유는 MIX 에 종이 한둘 더
   * 붙어도 그건 회귀가 아니기 때문이다. 반대로 **유닛 그림자 부활**(UNIT_SHADOW 폐기)은
   * 인스턴스 메시 5개가 전부 두 패스가 되어 +5 → 21콜이므로 이 문턱이 잡는다(실측).
   */
  // 실측: 60마리 전원 문 앞 = 16콜 / **71,377삼각형** (프레임 예산 150,000의 48%)
  it('스폰 상한 60마리를 통째로 문 앞에 세워도 예산 안이다', () => {
    const m = measure(1, gated(crowd(60)));
    expect(m.calls, `60마리 문 앞 ${m.calls}콜`).toBeLessThanOrEqual(20);
    /*
     * 이 파일의 진짜 주장은 절대값이 아니라 **마릿수가 콜에 안 실린다**는 것이다.
     * 6마리는 MIX 6종을 한 번씩 다 쓰므로 60마리와 **메시 집합이 같다** — 곧 인스턴싱이
     * 살아 있는 한 두 프레임의 콜은 같아야 한다. 인스턴싱이 깨지면 60쪽만 뛴다.
     */
    expect(m.calls, '6마리와 60마리의 드로우콜이 같다').toBe(measure(1, gated(crowd(6))).calls);
    // 적 60마리(그림자 없음 — UNIT_SHADOW)가 실린 프레임. 실제 최악 프레임의
    // 천장을 만드는 것은 타워 수라는 실측이 있으므로(enemyview.ts 헤더) 여기서는
    // **적이 예산의 절반을 안 먹는가**만 잠근다.
    expect(m.tris).toBeLessThan(75_000);
  });

  /**
   * 문간 연출은 전부 **기존 파티클 인스턴서 하나**에 얹힌다 —
   * 곧 연출을 몇 배로 쏟아부어도 드로우콜은 안 는다.
   * (healthbars.ts 헤더의 규칙과 같다: 어차피 그려지는 메시에 얹으면 공짜)
   */
  // 실측: 연출 1회 19콜 / 26,833 → 8회 19콜 / 30,289 (살아 있는 파티클 325)
  it('문간 연출을 여덟 배로 쏟아도 드로우콜이 안 는다', () => {
    const s3 = build(STAGES[0]!, Q);
    s3.setBaseLevel(1);
    for (let i = 0; i < 4; i++) s3.update(0.033);
    // game/fx.ts 가 실제로 부르는 것과 같은 호출 두 벌 (도착 먼지 · 지붕 파편)
    const bursts = (n: number): void => {
      for (let i = 0; i < n; i++) {
        s3.particles.burst(9, 0.3, 11.5, 0xc8b28a, 20, 2.4, 0.07, 0.6, {
          gravity: 5, drag: 1.6, upBias: 0.15, sizeVar: 0.55,
        });
        s3.particles.burst(9, 1.7, 11.5, 0xc8a06a, 16, 2.4, 0.062, 0.55, {
          gravity: 9, drag: 1.4, upBias: 0.55, sizeVar: 0.6,
        });
      }
      s3.update(0.033);
    };
    const spawned0 = s3.particles.spawnedTotal;
    bursts(1);
    const one = drawables(s3.scene);
    bursts(8);
    const many = drawables(s3.scene);
    expect(many.calls).toBe(one.calls);
    // 누적 스폰 창이 실제로 세고 있는지 — 연출 계측의 전제다(particles.ts spawnedTotal)
    expect(s3.particles.spawnedTotal - spawned0).toBe(36 * 9);
  });
});
