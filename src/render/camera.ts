/**
 * 디오라마 카메라 릭 — FOV 32°, 피치 ~55°, 요 ~-35° 고정 앵글.
 * fitToPlayfield: setViewOffset으로 플레이필드 AABB를 캔버스 내 임의
 * 뷰포트 영역(카드 핸드 제외 영역)에 8% 마진으로 맞춘다. 세로/가로 공용.
 * shake: 감쇠 노이즈 오프셋.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
/** 8% 마진 → 사용 가능 비율 */
const FIT_USABLE = 1 - 0.08 * 2;

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

  /**
   * AABB를 캔버스 내 viewport 영역에 맞춘다.
   * 가상 풀 이미지 = viewport 크기의 fit 뷰로 두고, 캔버스를 그 주변 창으로
   * 매핑하는 setViewOffset 트릭 — 세로/가로 어느 비율에서도 성립.
   */
  fitToPlayfield(aabb: THREE.Box3, viewport: ViewportRect, canvasW: number, canvasH: number): void {
    const vw = Math.max(1, viewport.w);
    const vh = Math.max(1, viewport.h);
    aabb.getCenter(this.target);

    // 릭 방향 기준 카메라 공간 축
    const dir = this.rigDir(new THREE.Vector3());
    const camPos = new THREE.Vector3().copy(this.target).add(dir);
    const m = new THREE.Matrix4().lookAt(camPos, this.target, new THREE.Vector3(0, 1, 0));
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
      rel.subVectors(corner, this.target);
      const cx = rel.dot(right);
      const cy = rel.dot(up);
      const cz = rel.dot(back); // 카메라 쪽 +
      dist = Math.max(dist, cz + Math.abs(cy) / tanV, cz + Math.abs(cx) / tanH);
    }

    this.basePos.copy(this.target).addScaledVector(dir, dist);
    this.camera.position.copy(this.basePos);
    this.camera.lookAt(this.target);
    this.camera.aspect = aspect;
    // 풀 이미지(vw×vh) 안에 fit → 캔버스는 (-vx,-vy)에서 시작하는 창
    this.camera.setViewOffset(vw, vh, -viewport.x, -viewport.y, canvasW, canvasH);
    this.camera.far = dist + 80;
    this.camera.updateProjectionMatrix();
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
