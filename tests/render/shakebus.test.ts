/**
 * **화면 흔들림 2채널** — 사용자 요구문을 그대로 계약으로 옮긴 것이다.
 *
 * > "적을 공격할 때마다 판 전체가 지진이 나는 효과가 나는데 … 크리티컬 한 경우에만
 * >  지진 효과를 넣어줘, 그렇지 않을 때는 지금보다 작게 하거나 고정 시켜서.
 * >  판 전체를 너무 흔들면 게임 중에 어지러워."
 *
 * ⚠ 이 계약이 왜 필요한가: 이 자리에서 **두 번 틀렸다.** 한 번은 출시본에서(착탄
 *   셰이크가 피해량과 타워 종류에 비례했다), 한 번은 그걸 고치는 첫 판에서(배치당
 *   예산은 카메라 진폭이 프레임을 넘어 쌓이므로 상한 구실을 못 한다). 둘 다 타입도
 *   테스트도 아무 말을 안 했다 — 규칙이 `FxRouter` 의 private 메서드였기 때문이다.
 *
 * 잠그는 것은 **정상 상태 진폭**이다. 그것이 사용자가 "어지럽다"고 말한 값이고,
 * 순간 최댓값이 아니다.
 */
import { describe, expect, it } from 'vitest';
import {
  QUAKE_BUDGET,
  ShakeBus,
  TAP_MIN_MS,
  TAP_SHAKE,
} from '@/game/shakebus';

/** 카메라 대신 꽂는 기록기 — 실제로 나간 세기만 모은다 */
function rig(): { bus: ShakeBus; sent: number[]; at: (ms: number) => void } {
  const sent: number[] = [];
  let t = 0;
  const bus = new ShakeBus((a) => sent.push(a), () => t);
  return { bus, sent, at: (ms) => { t = ms; } };
}

/**
 * `DioramaCamera` 의 정상 상태 **최대** 진폭 — `amp = min(1, amp + s)`, 감쇠 `exp(−6·dt)`.
 * 트로프(주입 직전)가 아니라 **피크(주입 직후)**를 재는 것이 요점이다: 화면이 실제로
 * 튀는 폭이 피크이고, 트로프끼리 비교하면 두 주입 주기가 달라 사과와 배가 된다.
 * ⚠ 식을 여기 베낀 것이 아니라 **카메라와 같은 두 상수(1 상한 · −6 감쇠)를 쓴다**.
 *   카메라가 바뀌면 이 계약이 재는 값도 같이 바뀌어야 하므로 camera.test.ts 가
 *   그 두 상수를 따로 잠근다.
 */
function steadyPeak(shots: number[], dtSec: number): number {
  let amp = 0;
  let peak = 0;
  for (const s of shots) {
    amp = Math.min(1, amp + s);
    if (amp > peak) peak = amp; // ⚠ **직후 최댓값**이 화면이 실제로 튀는 폭이다
    amp *= Math.exp(-6 * dtSec);
  }
  return peak;
}

describe('셰이크 2채널 — 잦은 사건은 판을 안 흔든다', () => {
  it('잦은 사건은 **고정 세기**다 — 인자로 피해량을 받을 방법이 없다', () => {
    const { bus, sent, at } = rig();
    // 같은 사건을 스로틀 간격을 벌려 세 번. 세기가 매번 같아야 한다.
    for (let i = 0; i < 3; i++) {
      at(i * TAP_MIN_MS);
      bus.tap();
    }
    expect(sent).toEqual([TAP_SHAKE, TAP_SHAKE, TAP_SHAKE]);
  });

  it('한 프레임에 착탄이 열 발 들어와도 톡은 한 번이다', () => {
    const { bus, sent, at } = rig();
    at(1000);
    for (let i = 0; i < 10; i++) bus.tap();
    expect(sent).toHaveLength(1);
    // 스로틀 간격을 못 넘긴 다음 프레임(16ms)도 마찬가지
    at(1016);
    for (let i = 0; i < 10; i++) bus.tap();
    expect(sent).toHaveLength(1);
    at(1000 + TAP_MIN_MS);
    bus.tap();
    expect(sent).toHaveLength(2);
  });

  it('⚠ 쉬지 않는 착탄의 **정상 상태**가 종전의 1/10 밑이다 (어지럼의 원인)', () => {
    // 종전: 투석기 착탄 clamp(0.055·s^1.45·1.35, …) ≈ 0.284 를 초당 4회.
    const beforeShots = Array.from({ length: 200 }, () => 0.284);
    const before = steadyPeak(beforeShots, 1 / 4);

    // 지금: 60fps 로 매 프레임 착탄이 쏟아져도 스로틀이 초당 1000/TAP_MIN_MS 로 자른다.
    const { bus, sent, at } = rig();
    for (let f = 0; f < 60 * 20; f++) {
      at(f * (1000 / 60));
      for (let k = 0; k < 8; k++) bus.tap(); // 한 프레임에 여덟 발
    }
    const perSec = 1000 / TAP_MIN_MS;
    const after = steadyPeak(sent, 1 / perSec);

    expect(after, `종전 ${before.toFixed(3)} · 지금 ${after.toFixed(4)}`).toBeLessThan(before / 10);
    // 공허성 가드 — 톡이 실제로 나갔고(0 이 아니고) 초당 상한도 지켰다
    expect(sent.length).toBeGreaterThan(100);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(20 * perSec) + 1);
  });

  it('큰 사건은 세기를 그대로 통과시키고, 한 배치 총량만 막는다', () => {
    const { bus, sent } = rig();
    bus.beginBatch();
    bus.quake(0.4);
    expect(sent).toEqual([0.4]);
    // 같은 배치에서 계속 부으면 예산에서 잘린다
    bus.quake(0.4);
    expect(sent[1]).toBeCloseTo(QUAKE_BUDGET - 0.4 < 0 ? 0 : QUAKE_BUDGET - 0.4, 10);
    const spent = sent.reduce((a, b) => a + b, 0);
    expect(spent).toBeLessThanOrEqual(QUAKE_BUDGET + 1e-9);
    // 다음 배치에서 예산이 돌아온다
    bus.beginBatch();
    bus.quake(0.3);
    expect(sent[sent.length - 1]).toBe(0.3);
  });

  it('두 채널은 예산을 안 나눠 쓴다 — 착탄이 많다고 보스 등장이 죽으면 안 된다', () => {
    const { bus, sent, at } = rig();
    bus.beginBatch();
    at(0);
    for (let i = 0; i < 50; i++) { at(i * TAP_MIN_MS); bus.tap(); }
    sent.length = 0;
    bus.quake(0.4); // 보스 등장
    expect(sent).toEqual([0.4]);
  });
});
