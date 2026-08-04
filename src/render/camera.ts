/**
 * 디오라마 카메라 릭 — FOV 32°, 피치 ~55°, 요 ~-35° 고정 앵글.
 * fitToPlayfield: setViewOffset으로 플레이필드 AABB를 캔버스 내 임의
 * 뷰포트 영역(카드 핸드 제외 영역)에 8% 마진으로 맞춘다. 세로/가로 공용.
 * shake: 감쇠 노이즈 오프셋.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
/** 5% 마진 → 사용 가능 비율 */
const FIT_USABLE = 1 - 0.05 * 2;

export interface ViewportRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class DioramaCamera {
  readonly camera: THREE.PerspectiveCamera;
  pitch = 55 * DEG;
  yaw = -35 * DEG;

  private target = new THREE.Vector3();
  private basePos = new THREE.Vector3(10, 14, 10);
  private shakeAmp = 0;
  private shakeTime = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 300);
    this.camera.position.copy(this.basePos);
    this.camera.lookAt(this.target);
  }

  /** 타깃→카메라 단위 방향 (피치/요 릭) */
  private rigDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(cp * Math.cos(this.yaw), Math.sin(this.pitch), cp * Math.sin(this.yaw));
  }

  // --- 줌/팬 상태 (fit 파라미터를 저장해 두고 재적용) ------------------------
  /** 1 = 전체 fit, >1 = 확대. 핀치/휠로 조절 */
  private zoomLevel = 1;
  private panX = 0;
  private panZ = 0;
  private fitDist = 20; // 마지막 fit 계산 거리 (줌 1 기준)
  private lastAabb = new THREE.Box3();
  private lastViewport: ViewportRect = { x: 0, y: 0, w: 1, h: 1 };
  private lastCanvasW = 1;
  private lastCanvasH = 1;
  private hasFit = false;

  static readonly ZOOM_MIN = 1;
  static readonly ZOOM_MAX = 2.6;

  get zoom(): number {
    return this.zoomLevel;
  }

  /**
   * AABB를 캔버스 내 viewport 영역에 맞춘다.
   * 가상 풀 이미지 = viewport 크기의 fit 뷰로 두고, 캔버스를 그 주변 창으로
   * 매핑하는 setViewOffset 트릭 — 세로/가로 어느 비율에서도 성립.
   * 현재 줌/팬을 유지한 채 재적용된다 (리사이즈 대응).
   */
  fitToPlayfield(aabb: THREE.Box3, viewport: ViewportRect, canvasW: number, canvasH: number): void {
    this.lastAabb.copy(aabb);
    this.lastViewport = { ...viewport };
    this.lastCanvasW = canvasW;
    this.lastCanvasH = canvasH;
    this.hasFit = true;
    this.applyView();
  }

  private applyView(): void {
    const aabb = this.lastAabb;
    const viewport = this.lastViewport;
    const vw = Math.max(1, viewport.w);
    const vh = Math.max(1, viewport.h);
    const center = aabb.getCenter(new THREE.Vector3());

    // 릭 방향 기준 카메라 공간 축
    const dir = this.rigDir(new THREE.Vector3());
    const camPos = new THREE.Vector3().copy(center).add(dir);
    const m = new THREE.Matrix4().lookAt(camPos, center, new THREE.Vector3(0, 1, 0));
    const right = new THREE.Vector3().setFromMatrixColumn(m, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(m, 1);
    const back = new THREE.Vector3().setFromMatrixColumn(m, 2); // 카메라 뒤 = 시선 반대

    const tanV = Math.tan(0.5 * this.camera.fov * DEG) * FIT_USABLE;
    const aspect = vw / vh;
    const tanH = tanV * aspect;

    // AABB 8코너를 릭 공간으로 투영해 필요한 거리 계산
    const corner = new THREE.Vector3();
    const rel = new THREE.Vector3();
    let dist = 1;
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? aabb.max.x : aabb.min.x,
        i & 2 ? aabb.max.y : aabb.min.y,
        i & 4 ? aabb.max.z : aabb.min.z,
      );
      rel.subVectors(corner, center);
      const cx = rel.dot(right);
      const cy = rel.dot(up);
      const cz = rel.dot(back); // 카메라 쪽 +
      dist = Math.max(dist, cz + Math.abs(cy) / tanV, cz + Math.abs(cx) / tanH);
    }
    this.fitDist = dist;

    // 팬: 줌 배율에 비례해 허용 범위 확대 (줌 1이면 0 → 자동 중앙 복귀)
    const halfX = (aabb.max.x - aabb.min.x) / 2;
    const halfZ = (aabb.max.z - aabb.min.z) / 2;
    const panScale = 1 - 1 / this.zoomLevel;
    const maxPanX = halfX * panScale * 1.4;
    const maxPanZ = halfZ * panScale * 1.4;
    this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
    this.panZ = Math.max(-maxPanZ, Math.min(maxPanZ, this.panZ));
    this.target.set(center.x + this.panX, center.y, center.z + this.panZ);

    const zoomedDist = dist / this.zoomLevel;
    this.basePos.copy(this.target).addScaledVector(dir, zoomedDist);
    this.camera.position.copy(this.basePos);
    this.camera.lookAt(this.target);
    this.camera.aspect = aspect;
    // 풀 이미지(vw×vh) 안에 fit → 캔버스는 (-vx,-vy)에서 시작하는 창
    this.camera.setViewOffset(vw, vh, -viewport.x, -viewport.y, this.lastCanvasW, this.lastCanvasH);
    this.camera.far = dist + 80;
    this.camera.updateProjectionMatrix();
  }

  /** 줌 배율 곱하기 (핀치 scale/휠). 화면 고정점 없이 중앙 기준 */
  zoomBy(factor: number): void {
    if (!this.hasFit) return;
    this.zoomLevel = Math.max(
      DioramaCamera.ZOOM_MIN,
      Math.min(DioramaCamera.ZOOM_MAX, this.zoomLevel * factor),
    );
    this.applyView();
  }

  /** 화면 픽셀 드래그 → 지면 팬. 콘텐츠가 손가락을 따라오는 방향 */
  panByPixels(dxPx: number, dyPx: number): void {
    if (!this.hasFit || this.zoomLevel <= 1.001) return;
    const vh = Math.max(1, this.lastViewport.h);
    const worldPerPx =
      (2 * (this.fitDist / this.zoomLevel) * Math.tan(0.5 * this.camera.fov * DEG)) / vh;
    // dir = 타깃→카메라. 시선 forward = -dir 이므로
    // 화면 오른쪽(월드) = normalize(cross(forward, up)) = normalize(dir.z, 0, -dir.x),
    // 화면 위(지면 투영) = normalize(-dir.x, -dir.z) (카메라 반대 방향).
    const dir = this.rigDir(new THREE.Vector3());
    const groundLen = Math.hypot(dir.x, dir.z) || 1;
    const rx = dir.z / groundLen;
    const rz = -dir.x / groundLen;
    const fx = -dir.x / groundLen;
    const fz = -dir.z / groundLen;
    // 세로 드래그는 피치 때문에 지면 이동량이 커진다 — sin(pitch) 보정
    const vScale = 1 / Math.max(0.35, Math.sin(this.pitch));
    // 콘텐츠가 손가락을 따라온다: 오른쪽 드래그 → 왼쪽 내용 노출(타깃 -right),
    // 아래 드래그 → 위쪽 내용 노출(타깃 +forward)
    this.panX += (-dxPx * rx + dyPx * fx * vScale) * worldPerPx;
    this.panZ += (-dxPx * rz + dyPx * fz * vScale) * worldPerPx;
    this.applyView();
  }

  resetZoomPan(): void {
    this.zoomLevel = 1;
    this.panX = 0;
    this.panZ = 0;
    if (this.hasFit) this.applyView();
  }

  /** 피격/보스 등장 등 화면 흔들림 (strength ≈ 0.1~0.6) */
  shake(strength: number): void {
    this.shakeAmp = Math.min(1, this.shakeAmp + strength);
  }

  update(dt: number): void {
    if (this.shakeAmp > 0.002) {
      this.shakeTime += dt;
      this.shakeAmp *= Math.exp(-6 * dt); // 감쇠
      const t = this.shakeTime;
      const a = this.shakeAmp * 0.35;
      // 서로 소인 주파수 노이즈 근사
      this.camera.position.set(
        this.basePos.x + Math.sin(t * 47.1) * a,
        this.basePos.y + Math.sin(t * 39.7 + 1.3) * a * 0.6,
        this.basePos.z + Math.cos(t * 43.3 + 2.1) * a,
      );
    } else if (this.shakeAmp !== 0) {
      this.shakeAmp = 0;
      this.camera.position.copy(this.basePos);
    }
  }
}
