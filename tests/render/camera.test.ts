/**
 * 카메라 팬/줌 — "콘텐츠가 손가락을 따라온다" 규약을 화면 투영으로 검증한다.
 * (좌우 팬이 반대로 동작하던 회귀 방지: 카메라 right 벡터 부호)
 */
import { Box3, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DioramaCamera } from '@/render/camera';

const CANVAS_W = 390;
const CANVAS_H = 844;
const VIEWPORT = { x: 8, y: 118, w: 374, h: 500 };

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
  const aabb = new Box3(new Vector3(-6, -0.9, -8), new Vector3(6, 1.4, 8));
  cam.fitToPlayfield(aabb, VIEWPORT, CANVAS_W, CANVAS_H);
  return cam;
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
