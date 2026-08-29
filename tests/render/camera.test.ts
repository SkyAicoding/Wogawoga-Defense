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

/*
 * **프레이밍 하한** — 어떤 각도에서도 섬이 뷰포트의 이만큼은 차지해야 한다.
 * 잡으려는 회귀는 "fitToPlayfield 가 어긋나 섬이 점만 해진다" 이지, 소수점 몇 자리가 아니다.
 *
 * 세로 0.32 의 유도(실측, 뷰포트 374×500, 25×25 격자 스윕):
 *   옛 폭(요 -75..5 · 피치 40..65)   세로 최소 **36.14%** (yaw -1.7 pitch 40.0)
 *   새 폭(요 -87..17 · 피치 35.5..68) 세로 최소 **33.17%** (yaw -0.3 pitch 35.5)
 *   두 경우 다 **잘림 0건** — 섬이 뷰포트를 벗어나는 일은 없다.
 * ⚠ 이 값이 0.35 → 0.32 로 내려간 것은 **문턱을 낮춘 것이 아니라 설계가 바뀐 것**이다.
 *   피치 하한을 40° → 35.5° 로 내리면(사용자 요구) 섬을 더 옆에서 보게 되므로 세로
 *   투영이 짧아진다 — 기하의 결과지 fit 의 버그가 아니다. 남긴 여유(33.17/32 = 1.037배)는
 *   옛 여유(36.14/35 = 1.033배)와 같은 크기다. 아래 ratio 계약이 그 여유까지 잠근다.
 * 가로 0.6 은 손대지 않았다 — 새 폭에서도 최소 79.01% 라 근처도 안 간다.
 */
const MIN_H_FRAC = 0.32;
const MIN_W_FRAC = 0.6;

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

  /*
   * ⚠ **폭을 30% 넓혔다 (사용자 요구, 2026-08-29)** — "각도를 지금 보다 30% 정도 더
   *   증가 시켜줘. 더 많이 상하로 각도를 바꿔 보고 싶어".
   *   요 ±40° → ±52° · 피치 [40°, 65°] → [35.5°, 68°] (기본각 55° 기준 아래 15°→19.5°,
   *   위 10°→13°). 감도(battlecontroller.ORBIT_*_PER_PX)도 같은 ×1.3 이다.
   *   여기 숫자는 **문턱을 내린 것이 아니라 사용자가 정한 설계값**이라 같이 옮긴다.
   */
  it('기본 각도는 요 -35°, 피치 55° · 폭은 요 ±52° 피치 [35.5°, 68°]', () => {
    expect(cam.yaw / DEG).toBeCloseTo(-35, 6);
    expect(cam.pitch / DEG).toBeCloseTo(55, 6);
    expect(DioramaCamera.YAW_MIN / DEG).toBeCloseTo(-87, 6);
    expect(DioramaCamera.YAW_MAX / DEG).toBeCloseTo(17, 6);
    expect(DioramaCamera.PITCH_MIN / DEG).toBeCloseTo(35.5, 6);
    expect(DioramaCamera.PITCH_MAX / DEG).toBeCloseTo(68, 6);
    // 폭이 기본각 기준 정확히 1.3배인가 — 옛 값(40 · 15 · 10)에서 유도한다
    expect(DioramaCamera.YAW_RANGE / DEG).toBeCloseTo(40 * 1.3, 6);
    expect((DioramaCamera.PITCH_BASE - DioramaCamera.PITCH_MIN) / DEG).toBeCloseTo(15 * 1.3, 6);
    expect((DioramaCamera.PITCH_MAX - DioramaCamera.PITCH_BASE) / DEG).toBeCloseTo(10 * 1.3, 6);
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

  /*
   * ⚠⚠ **각도 조합을 상수에서 유도한다 — 숫자를 베끼지 않는다.**
   *   옛 판본은 `[±40, ±20]` 을 손으로 적어 뒀는데, 그 값은 **그때의 클램프 끝**이었다.
   *   2026-08-29 에 폭이 ±52° / [35.5°, 68°] 로 넓어지자 그 조합은 더 이상 끝이 아니라
   *   **범위 안쪽**이 됐다 — 곧 이 계약이 새 극단을 한 번도 안 재게 된다.
   *   이 저장소가 세 번 앓은 병이 정확히 그것이다(CLAUDE.md: `MAX_STANDOFF = 1.95`
   *   하드코딩이 정지선이 옮겨간 뒤에도 그대로였다). 그래서 여기서는 끝값을
   *   `DioramaCamera` 에서 읽어 **격자로 훑는다** — 폭을 또 바꿔도 계약이 따라온다.
   */
  it('어떤 각도에서도 스테이지 AABB가 뷰포트 안에 들어온다 (실제 클램프 끝까지)', () => {
    const yLo = DioramaCamera.YAW_MIN;
    const yHi = DioramaCamera.YAW_MAX;
    const pLo = DioramaCamera.PITCH_MIN;
    const pHi = DioramaCamera.PITCH_MAX;
    const STEPS = 8; // 9×9 = 81 조합. 네 모서리와 두 축의 중간이 전부 들어온다
    let minH = Infinity;
    let minHLabel = '';
    for (let i = 0; i <= STEPS; i++) {
      for (let j = 0; j <= STEPS; j++) {
        const yaw = yLo + ((yHi - yLo) * i) / STEPS;
        const pitch = pLo + ((pHi - pLo) * j) / STEPS;
        const c = makeCam();
        c.orbitBy(yaw - DioramaCamera.YAW_BASE, pitch - DioramaCamera.PITCH_BASE);
        settleByUpdate(c);
        const b = projectedBounds(c);
        const label = `yaw=${(yaw / DEG).toFixed(1)}° pitch=${(pitch / DEG).toFixed(1)}°`;
        expect(b.minX, `${label} 좌측 잘림`).toBeGreaterThanOrEqual(VIEWPORT.x);
        expect(b.maxX, `${label} 우측 잘림`).toBeLessThanOrEqual(VIEWPORT.x + VIEWPORT.w);
        expect(b.minY, `${label} 상단 잘림`).toBeGreaterThanOrEqual(VIEWPORT.y);
        expect(b.maxY, `${label} 하단 잘림`).toBeLessThanOrEqual(VIEWPORT.y + VIEWPORT.h);
        // 과하게 작아지지도 않아야 한다
        expect(b.maxX - b.minX, `${label} 너무 작음(가로)`).toBeGreaterThan(VIEWPORT.w * MIN_W_FRAC);
        expect(b.maxY - b.minY, `${label} 너무 작음(세로)`).toBeGreaterThan(VIEWPORT.h * MIN_H_FRAC);
        if (b.maxY - b.minY < minH) {
          minH = b.maxY - b.minY;
          minHLabel = label;
        }
      }
    }
    /*
     * 문턱이 **실측을 뒤쫓기만 하는 자**가 되지 않게, 여유가 얼마나 남았는지도 잠근다.
     * 너무 붙어 있으면(1.05배 미만) 다음 각도 변경에서 조용히 빨개지고, 너무 떨어져
     * 있으면(1.25배 초과) 프레이밍이 실제로 망가져도 이 계약이 아무 말도 안 한다.
     */
    const ratio = minH / (VIEWPORT.h * MIN_H_FRAC);
    expect(ratio, `세로 최소 ${minH.toFixed(1)}px @ ${minHLabel} — 문턱 여유가 ${ratio.toFixed(3)}배`)
      .toBeGreaterThan(1.02);
    expect(ratio, `세로 최소 ${minH.toFixed(1)}px @ ${minHLabel} — 문턱이 너무 헐겁다`)
      .toBeLessThan(1.25);
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
