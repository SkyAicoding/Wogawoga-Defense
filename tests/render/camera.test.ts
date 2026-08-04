/**
 * 카메라 팬/줌/궤도 — "콘텐츠가 손가락을 따라온다" 규약과 회전 후 프레이밍을
 * 실제 카메라 행렬의 화면 투영으로 검증한다.
 * (좌우 팬이 반대로 동작하던 회귀 방지: 카메라 right 벡터 부호)
 */
import { Box3, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DioramaCamera } from '@/render/camera';

const CANVAS_W = 390;
const CANVAS_H = 844;
const VIEWPORT = { x: 8, y: 118, w: 374, h: 500 };
const DEG = Math.PI / 180;
/** 스테이지 AABB (battlecontroller의 fitBox 클램프와 같은 형태) */
const AABB_MIN = new Vector3(-6, -0.9, -8);
const AABB_MAX = new Vector3(6, 1.4, 8);

/**
 * 월드 좌표를 캔버스 픽셀로 투영.
 * 실제 앱에서는 renderer.render()가 matrixWorld를 갱신하므로 테스트에서 직접 호출한다.
 */
function project(cam: DioramaCamera, p: Vector3): { sx: number; sy: number } {
  cam.camera.updateMatrixWorld(true);
  const v = p.clone().project(cam.camera);
  return { sx: (v.x * 0.5 + 0.5) * CANVAS_W, sy: (-v.y * 0.5 + 0.5) * CANVAS_H };
}

function makeCam(): DioramaCamera {
  const cam = new DioramaCamera();
  const aabb = new Box3(AABB_MIN.clone(), AABB_MAX.clone());
  cam.fitToPlayfield(aabb, VIEWPORT, CANVAS_W, CANVAS_H);
  return cam;
}

/** 보간이 목표에 닿을 때까지 update를 돌린다 (실제 프레임 경로 그대로) */
function settleByUpdate(cam: DioramaCamera, maxFrames = 240): number {
  let n = 0;
  while (n < maxFrames && (cam.yaw !== cam.targetYaw || cam.pitch !== cam.targetPitch)) {
    cam.update(1 / 60);
    n++;
  }
  return n;
}

/** 스테이지 AABB 8코너의 화면 투영 바운즈 */
function projectedBounds(cam: DioramaCamera): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = project(
      cam,
      new Vector3(
        i & 1 ? AABB_MAX.x : AABB_MIN.x,
        i & 2 ? AABB_MAX.y : AABB_MIN.y,
        i & 4 ? AABB_MAX.z : AABB_MIN.z,
      ),
    );
    minX = Math.min(minX, p.sx);
    maxX = Math.max(maxX, p.sx);
    minY = Math.min(minY, p.sy);
    maxY = Math.max(maxY, p.sy);
  }
  return { minX, maxX, minY, maxY };
}

describe('DioramaCamera 팬/줌', () => {
  let cam: DioramaCamera;
  beforeEach(() => {
    cam = makeCam();
  });

  it('줌 1(전체 보기)에서는 팬이 무시된다', () => {
    const origin = new Vector3(0, 0, 0);
    const before = project(cam, origin);
    cam.panByPixels(120, 80);
    const after = project(cam, origin);
    expect(after.sx).toBeCloseTo(before.sx, 5);
    expect(after.sy).toBeCloseTo(before.sy, 5);
  });

  it('오른쪽으로 드래그하면 지형이 오른쪽으로 따라온다', () => {
    cam.zoomBy(2);
    const origin = new Vector3(0, 0, 0);
    const before = project(cam, origin);
    cam.panByPixels(100, 0);
    const after = project(cam, origin);
    expect(after.sx - before.sx, '오른쪽 드래그 → 콘텐츠도 오른쪽').toBeGreaterThan(0);
    // 수평 드래그가 세로로 크게 새지 않아야 한다
    expect(Math.abs(after.sy - before.sy)).toBeLessThan(Math.abs(after.sx - before.sx) * 0.5);
  });

  it('왼쪽으로 드래그하면 지형이 왼쪽으로 따라온다', () => {
    cam.zoomBy(2);
    const origin = new Vector3(0, 0, 0);
    const before = project(cam, origin);
    cam.panByPixels(-100, 0);
    const after = project(cam, origin);
    expect(after.sx - before.sx).toBeLessThan(0);
  });

  it('아래로 드래그하면 지형이 아래로 따라온다', () => {
    cam.zoomBy(2);
    const origin = new Vector3(0, 0, 0);
    const before = project(cam, origin);
    cam.panByPixels(0, 100);
    const after = project(cam, origin);
    expect(after.sy - before.sy, '아래 드래그 → 콘텐츠도 아래').toBeGreaterThan(0);
    expect(Math.abs(after.sx - before.sx)).toBeLessThan(Math.abs(after.sy - before.sy) * 0.5);
  });

  it('위로 드래그하면 지형이 위로 따라온다', () => {
    cam.zoomBy(2);
    const origin = new Vector3(0, 0, 0);
    const before = project(cam, origin);
    cam.panByPixels(0, -100);
    const after = project(cam, origin);
    expect(after.sy - before.sy).toBeLessThan(0);
  });

  it('줌은 상한/하한으로 클램프된다', () => {
    for (let i = 0; i < 40; i++) cam.zoomBy(1.5);
    expect(cam.zoom).toBeLessThanOrEqual(DioramaCamera.ZOOM_MAX + 1e-6);
    for (let i = 0; i < 60; i++) cam.zoomBy(1 / 1.5);
    expect(cam.zoom).toBeGreaterThanOrEqual(DioramaCamera.ZOOM_MIN - 1e-6);
  });

  it('완전히 줌아웃하면 팬이 중앙으로 복귀한다', () => {
    cam.zoomBy(2.5);
    cam.panByPixels(200, 150);
    const panned = project(cam, new Vector3(0, 0, 0));
    for (let i = 0; i < 40; i++) cam.zoomBy(1 / 1.5);
    const reset = project(cam, new Vector3(0, 0, 0));
    const fresh = project(makeCam(), new Vector3(0, 0, 0));
    expect(reset.sx).toBeCloseTo(fresh.sx, 3);
    expect(reset.sy).toBeCloseTo(fresh.sy, 3);
    expect(Math.abs(panned.sx - fresh.sx)).toBeGreaterThan(1);
  });

  it('resetZoomPan은 초기 프레이밍으로 되돌린다', () => {
    const fresh = project(makeCam(), new Vector3(2, 0, -3));
    cam.zoomBy(2);
    cam.panByPixels(90, -40);
    cam.resetZoomPan();
    const after = project(cam, new Vector3(2, 0, -3));
    expect(cam.zoom).toBe(1);
    expect(after.sx).toBeCloseTo(fresh.sx, 3);
    expect(after.sy).toBeCloseTo(fresh.sy, 3);
  });
});

describe('DioramaCamera 궤도(orbit)', () => {
  let cam: DioramaCamera;
  beforeEach(() => {
    cam = makeCam();
  });

  it('기본 각도는 요 -35°, 피치 55°', () => {
    expect(cam.yaw / DEG).toBeCloseTo(-35, 6);
    expect(cam.pitch / DEG).toBeCloseTo(55, 6);
    expect(DioramaCamera.YAW_MIN / DEG).toBeCloseTo(-75, 6);
    expect(DioramaCamera.YAW_MAX / DEG).toBeCloseTo(5, 6);
  });

  it('요는 기본 ±범위로 클램프된다', () => {
    for (let i = 0; i < 60; i++) cam.orbitBy(5 * DEG, 0);
    expect(cam.targetYaw).toBeCloseTo(DioramaCamera.YAW_MAX, 9);
    settleByUpdate(cam);
    expect(cam.yaw).toBeCloseTo(DioramaCamera.YAW_MAX, 9);
    for (let i = 0; i < 120; i++) cam.orbitBy(-5 * DEG, 0);
    expect(cam.targetYaw).toBeCloseTo(DioramaCamera.YAW_MIN, 9);
    settleByUpdate(cam);
    expect(cam.yaw).toBeCloseTo(DioramaCamera.YAW_MIN, 9);
  });

  it('피치는 상한/하한으로 클램프된다', () => {
    for (let i = 0; i < 60; i++) cam.orbitBy(0, 5 * DEG);
    expect(cam.targetPitch).toBeCloseTo(DioramaCamera.PITCH_MAX, 9);
    settleByUpdate(cam);
    expect(cam.pitch).toBeCloseTo(DioramaCamera.PITCH_MAX, 9);
    for (let i = 0; i < 120; i++) cam.orbitBy(0, -5 * DEG);
    expect(cam.targetPitch).toBeCloseTo(DioramaCamera.PITCH_MIN, 9);
    settleByUpdate(cam);
    expect(cam.pitch).toBeCloseTo(DioramaCamera.PITCH_MIN, 9);
    // 하한에서도 카메라는 지면 위에 있다 (밑면이 보이면 안 된다)
    expect(cam.camera.position.y).toBeGreaterThan(AABB_MAX.y);
  });

  it('보간은 목표 각도로 수렴한다 (update 경로)', () => {
    cam.orbitBy(20 * DEG, -10 * DEG);
    // 첫 프레임에는 목표에 아직 못 미친다 (즉시 점프 아님)
    cam.update(1 / 60);
    expect(Math.abs(cam.yaw - cam.targetYaw)).toBeGreaterThan(1e-4);
    expect(cam.yaw).toBeGreaterThan(DioramaCamera.YAW_BASE);
    const frames = settleByUpdate(cam);
    expect(frames).toBeLessThan(120); // 2초 안에는 정착
    expect(cam.yaw).toBeCloseTo(DioramaCamera.YAW_BASE + 20 * DEG, 9);
    expect(cam.pitch).toBeCloseTo(DioramaCamera.PITCH_BASE - 10 * DEG, 9);
  });

  it('요 +방향은 화면 위쪽 콘텐츠를 왼쪽으로 돌린다 (제스처 부호 규약)', () => {
    // battlecontroller: 우드래그(+dx) → orbitBy(+yaw) → 섬 앞면이 오른쪽으로,
    //                   시계방향 트위스트 → orbitBy(-yaw)
    const far = new Vector3(0, 0, 7); // 기본 앵글에서 화면 위쪽에 오는 점
    const before = project(cam, far);
    expect(before.sy).toBeLessThan(CANVAS_H / 2);
    cam.orbitBy(10 * DEG, 0);
    settleByUpdate(cam);
    const after = project(cam, far);
    expect(after.sx - before.sx).toBeLessThan(0);
  });

  it('어떤 각도에서도 스테이지 AABB가 뷰포트 안에 들어온다', () => {
    const combos: [number, number][] = [
      [0, 0],
      [40, 0],
      [-40, 0],
      [0, 20],
      [0, -20],
      [40, 20],
      [-40, -20],
      [40, -20],
      [-40, 20],
    ];
    for (const [dy, dp] of combos) {
      const c = makeCam();
      c.orbitBy(dy * DEG, dp * DEG);
      settleByUpdate(c);
      const b = projectedBounds(c);
      const label = `dyaw=${dy} dpitch=${dp}`;
      expect(b.minX, `${label} 좌측 잘림`).toBeGreaterThanOrEqual(VIEWPORT.x);
      expect(b.maxX, `${label} 우측 잘림`).toBeLessThanOrEqual(VIEWPORT.x + VIEWPORT.w);
      expect(b.minY, `${label} 상단 잘림`).toBeGreaterThanOrEqual(VIEWPORT.y);
      expect(b.maxY, `${label} 하단 잘림`).toBeLessThanOrEqual(VIEWPORT.y + VIEWPORT.h);
      // 과하게 작아지지도 않아야 한다
      expect(b.maxX - b.minX, `${label} 너무 작음(가로)`).toBeGreaterThan(VIEWPORT.w * 0.6);
      expect(b.maxY - b.minY, `${label} 너무 작음(세로)`).toBeGreaterThan(VIEWPORT.h * 0.35);
    }
  });

  it('회전한 상태에서도 팬 방향 규약이 유지된다', () => {
    for (const dy of [-40, -20, 0, 20, 40]) {
      const c = makeCam();
      c.orbitBy(dy * DEG, dy > 0 ? 12 * DEG : -12 * DEG);
      settleByUpdate(c);
      c.zoomBy(2);
      const origin = new Vector3(0, 0, 0);
      let before = project(c, origin);
      c.panByPixels(100, 0);
      let after = project(c, origin);
      expect(after.sx - before.sx, `dyaw=${dy} 오른쪽 드래그`).toBeGreaterThan(0);
      expect(Math.abs(after.sy - before.sy)).toBeLessThan(Math.abs(after.sx - before.sx) * 0.5);
      before = project(c, origin);
      c.panByPixels(0, 100);
      after = project(c, origin);
      expect(after.sy - before.sy, `dyaw=${dy} 아래 드래그`).toBeGreaterThan(0);
      expect(Math.abs(after.sx - before.sx)).toBeLessThan(Math.abs(after.sy - before.sy) * 0.5);
    }
  });

  it('줌아웃으로 팬이 중앙 복귀해도 각도는 유지된다', () => {
    cam.orbitBy(25 * DEG, -12 * DEG);
    settleByUpdate(cam);
    cam.zoomBy(2.5);
    cam.panByPixels(200, 150);
    for (let i = 0; i < 40; i++) cam.zoomBy(1 / 1.5);
    expect(cam.zoom).toBe(DioramaCamera.ZOOM_MIN);
    expect(cam.yaw).toBeCloseTo(DioramaCamera.YAW_BASE + 25 * DEG, 9);
    expect(cam.pitch).toBeCloseTo(DioramaCamera.PITCH_BASE - 12 * DEG, 9);
  });

  it('resetView는 각도까지 기본 프레이밍으로 되돌린다', () => {
    const probe = new Vector3(2, 0, -3);
    const fresh = project(makeCam(), probe);
    cam.orbitBy(-30 * DEG, 14 * DEG);
    settleByUpdate(cam);
    cam.zoomBy(2);
    cam.panByPixels(90, -40);
    expect(project(cam, probe).sx).not.toBeCloseTo(fresh.sx, 1);
    cam.resetView();
    const after = project(cam, probe);
    expect(cam.zoom).toBe(1);
    expect(cam.yaw).toBe(DioramaCamera.YAW_BASE);
    expect(cam.pitch).toBe(DioramaCamera.PITCH_BASE);
    expect(after.sx).toBeCloseTo(fresh.sx, 3);
    expect(after.sy).toBeCloseTo(fresh.sy, 3);
  });

  it('resetZoomPan은 각도를 건드리지 않는다', () => {
    cam.orbitBy(15 * DEG, 8 * DEG);
    settleByUpdate(cam);
    cam.zoomBy(2);
    cam.resetZoomPan();
    expect(cam.zoom).toBe(1);
    expect(cam.yaw).toBeCloseTo(DioramaCamera.YAW_BASE + 15 * DEG, 9);
    expect(cam.pitch).toBeCloseTo(DioramaCamera.PITCH_BASE + 8 * DEG, 9);
  });
});
