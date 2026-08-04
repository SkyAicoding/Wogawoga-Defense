/**
 * 경로 파라미터화 — 웨이포인트를 코너 라운딩(반경 0.35 호를 4세그먼트 베지어로 절삭)한 뒤
 * 누적 호장 테이블을 만든다. sample(dist)는 이진 탐색으로 위치/방향을 out에 기록한다(할당 없음).
 * 좌표는 셀 연속 좌표, heading 0 = +x 방향 (atan2(dz,dx)).
 */
import type { Vec2 } from '@/data/types';
import { lerp } from '@/core/mathx';

export interface PathPoint {
  x: number;
  z: number;
  heading: number;
}

const CORNER_RADIUS = 0.35;
const CORNER_SEGS = 4;
const EPS = 1e-9;

export class BattlePath {
  private readonly xs: number[] = [];
  private readonly zs: number[] = [];
  /** cum[i] = 점 i까지의 누적 길이 */
  private readonly cum: number[] = [0];
  /** headings[i] = 세그먼트 i(점 i → i+1)의 진행 방향 */
  private readonly headings: number[] = [];
  readonly totalLength: number;

  constructor(points: readonly Vec2[]) {
    for (const p of points) {
      const n = this.xs.length;
      if (
        n > 0 &&
        Math.abs((this.xs[n - 1] as number) - p.x) < EPS &&
        Math.abs((this.zs[n - 1] as number) - p.z) < EPS
      ) {
        continue; // 중복점 제거 — 0길이 세그먼트 방지
      }
      this.xs.push(p.x);
      this.zs.push(p.z);
    }
    if (this.xs.length === 0) {
      this.xs.push(0);
      this.zs.push(0);
    }
    let acc = 0;
    for (let i = 0; i + 1 < this.xs.length; i++) {
      const dx = (this.xs[i + 1] as number) - (this.xs[i] as number);
      const dz = (this.zs[i + 1] as number) - (this.zs[i] as number);
      acc += Math.hypot(dx, dz);
      this.cum.push(acc);
      this.headings.push(Math.atan2(dz, dx));
    }
    if (this.headings.length === 0) this.headings.push(0);
    this.totalLength = acc;
  }

  /** dist(경계 클램프)를 위치/heading으로 변환해 out에 기록 */
  sample(d: number, out: PathPoint): void {
    const xs = this.xs;
    const n = xs.length;
    if (n === 1) {
      out.x = xs[0] as number;
      out.z = this.zs[0] as number;
      out.heading = 0;
      return;
    }
    const total = this.totalLength;
    const dd = d < 0 ? 0 : d > total ? total : d;
    // cum[lo] <= dd 를 만족하는 최대 세그먼트 인덱스 (이진 탐색)
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.cum[mid] as number) <= dd) lo = mid;
      else hi = mid - 1;
    }
    const s0 = this.cum[lo] as number;
    const s1 = this.cum[lo + 1] as number;
    const t = s1 > s0 ? (dd - s0) / (s1 - s0) : 0;
    out.x = lerp(xs[lo] as number, xs[lo + 1] as number, t);
    out.z = lerp(this.zs[lo] as number, this.zs[lo + 1] as number, t);
    out.heading = this.headings[lo] as number;
  }
}

/** 내부 꼭짓점을 반경 CORNER_RADIUS 원호(2차 베지어 근사, 4세그먼트)로 절삭한 경로 생성 */
export function buildPath(waypoints: readonly Vec2[]): BattlePath {
  if (waypoints.length < 3) return new BattlePath(waypoints);
  const pts: Vec2[] = [waypoints[0] as Vec2];
  for (let i = 1; i + 1 < waypoints.length; i++) {
    const a = waypoints[i - 1] as Vec2;
    const p = waypoints[i] as Vec2;
    const b = waypoints[i + 1] as Vec2;
    const inX = p.x - a.x;
    const inZ = p.z - a.z;
    const outX = b.x - p.x;
    const outZ = b.z - p.z;
    const inLen = Math.hypot(inX, inZ);
    const outLen = Math.hypot(outX, outZ);
    if (inLen < EPS || outLen < EPS) continue; // 퇴화 꼭짓점 무시
    const cross = inX * outZ - inZ * outX;
    const dot = inX * outX + inZ * outZ;
    if (Math.abs(cross) < 1e-6 && dot > 0) {
      pts.push(p); // 일직선 — 라운딩 불필요
      continue;
    }
    const cut = Math.min(CORNER_RADIUS, inLen / 2, outLen / 2);
    const p0x = p.x - (inX / inLen) * cut;
    const p0z = p.z - (inZ / inLen) * cut;
    const p1x = p.x + (outX / outLen) * cut;
    const p1z = p.z + (outZ / outLen) * cut;
    for (let s = 0; s <= CORNER_SEGS; s++) {
      const t = s / CORNER_SEGS;
      const u = 1 - t;
      // 2차 베지어(제어점 = 원래 꼭짓점)로 원호 근사
      pts.push({
        x: u * u * p0x + 2 * u * t * p.x + t * t * p1x,
        z: u * u * p0z + 2 * u * t * p.z + t * t * p1z,
      });
    }
  }
  pts.push(waypoints[waypoints.length - 1] as Vec2);
  return new BattlePath(pts);
}

/** 공중 레인 폴백: 스폰 → 기지 직선 */
export function buildStraight(from: Vec2, to: Vec2): BattlePath {
  return new BattlePath([from, to]);
}
