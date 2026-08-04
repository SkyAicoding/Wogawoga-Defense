/** 호장 파라미터화 — 직선 길이, L자 코너 절삭/단조성, sample 경계 클램프 */
import { describe, expect, it } from 'vitest';
import { buildPath, buildStraight, type PathPoint } from '@/sim/path';

function pt(): PathPoint {
  return { x: 0, z: 0, heading: 0 };
}

describe('path', () => {
  it('직선 경로 — 총 길이/중간점/heading', () => {
    const p = buildPath([
      { x: 0, z: 2 },
      { x: 9, z: 2 },
    ]);
    expect(p.totalLength).toBeCloseTo(9, 10);
    const o = pt();
    p.sample(4.5, o);
    expect(o.x).toBeCloseTo(4.5, 10);
    expect(o.z).toBeCloseTo(2, 10);
    expect(o.heading).toBeCloseTo(0, 10); // +x 방향
  });

  it('sample 경계 — 음수/초과 클램프', () => {
    const p = buildStraight({ x: 0, z: 0 }, { x: 5, z: 0 });
    const o = pt();
    p.sample(-3, o);
    expect(o.x).toBeCloseTo(0, 10);
    p.sample(999, o);
    expect(o.x).toBeCloseTo(5, 10);
  });

  it('L자 코너 — 절삭으로 길이 감소, 꼭짓점 회피', () => {
    const p = buildPath([
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 5 },
    ]);
    // 원래 길이 10에서 코너 절삭만큼 짧아진다 (반경 0.35)
    expect(p.totalLength).toBeLessThan(10);
    expect(p.totalLength).toBeGreaterThan(9.3);
    // 경로가 꼭짓점 (5,0)을 지나지 않는다 (베지어 절삭)
    const o = pt();
    let minCornerDist = Infinity;
    for (let d = 0; d <= p.totalLength; d += 0.01) {
      p.sample(d, o);
      minCornerDist = Math.min(minCornerDist, Math.hypot(o.x - 5, o.z - 0));
    }
    expect(minCornerDist).toBeGreaterThan(0.1);
  });

  it('L자 코너 — x/z 단조성과 시작/끝 heading', () => {
    const p = buildPath([
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 5 },
    ]);
    const o = pt();
    let prevX = -1;
    let prevZ = -1;
    for (let d = 0; d <= p.totalLength; d += 0.05) {
      p.sample(d, o);
      expect(o.x).toBeGreaterThanOrEqual(prevX - 1e-9);
      expect(o.z).toBeGreaterThanOrEqual(prevZ - 1e-9);
      prevX = o.x;
      prevZ = o.z;
    }
    p.sample(0, o);
    expect(o.heading).toBeCloseTo(0, 5);
    p.sample(p.totalLength, o);
    expect(o.heading).toBeCloseTo(Math.PI / 2, 5); // +z 방향
  });

  it('일직선 중간 웨이포인트는 라운딩 없이 유지', () => {
    const p = buildPath([
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 6, z: 0 },
    ]);
    expect(p.totalLength).toBeCloseTo(6, 10);
  });
});
