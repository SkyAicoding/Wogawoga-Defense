/**
 * WebGLRenderer 셋업 + 프레임타임 기반 동적 해상도.
 * - ACES 톤매핑 / sRGB 출력 / PCFSoft 그림자 / DPR ≤2
 * - EMA 프레임타임 >18ms 2초 지속 → 스케일 0.15씩 다운 (최저 0.7)
 *   <12ms 5초 지속 → 0.15씩 복원
 * - webglcontextlost/restored: 콜백으로 상위에 씬 재구축 요청
 */
import * as THREE from 'three';
import { cappedDpr } from '@/core/device';
import type { QualityFlags } from './quality';

const SCALE_MIN = 0.7;
const SCALE_STEP = 0.15;
const SLOW_MS = 18;
const FAST_MS = 12;
const SLOW_HOLD = 2;
const FAST_HOLD = 5;
/** 해상도 스케일 바닥 도달 후에도 느리면 품질 강등 요청까지 걸리는 시간(초)/재요청 쿨다운(ms) */
const PERSIST_SLOW_HOLD = 4;
const PERSIST_SLOW_COOLDOWN_MS = 10000;

export class GameRenderer {
  readonly gl: THREE.WebGLRenderer;
  /** 콘텍스트 복구 시 씬/지오메트리 재구축 요청 */
  onContextRestored: (() => void) | null = null;
  onContextLost: (() => void) | null = null;
  /** 해상도 스케일이 바닥(0.7)인데도 EMA>18ms가 4초 지속 — 상위 레이어의 품질 강등 훅 */
  onPersistentlySlow: (() => void) | null = null;

  private scale = 1;
  private emaMs = 16;
  private slowFor = 0;
  private fastFor = 0;
  private persistSlowFor = 0;
  private lastPersistSlowMs = -Infinity;
  private lastTime = -1;
  private width = 1;
  private height = 1;
  private maxDpr = 2;
  private contextAlive = true;

  constructor(canvas: HTMLCanvasElement, quality?: QualityFlags) {
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.shadowMap.enabled = quality?.shadows ?? true;
    // r185: PCFSoftShadowMap 폐기 예고 → PCF 사용 (모바일 성능에도 유리)
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    if (quality) this.maxDpr = Math.min(quality.maxDpr, 2);

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // restored 이벤트를 받으려면 필수
      this.contextAlive = false;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextAlive = true;
      this.applyPixelRatio();
      this.onContextRestored?.();
    });
  }

  setQuality(quality: QualityFlags): void {
    this.gl.shadowMap.enabled = quality.shadows;
    this.maxDpr = Math.min(quality.maxDpr, 2);
    this.applyPixelRatio();
  }

  /** CSS 픽셀 크기 설정 (리사이즈 시 호출) */
  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.applyPixelRatio();
  }

  get resolutionScale(): number {
    return this.scale;
  }

  get isContextAlive(): boolean {
    return this.contextAlive;
  }

  private applyPixelRatio(): void {
    const dpr = Math.min(cappedDpr(), this.maxDpr) * this.scale;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(this.width, this.height, false);
  }

  /** 매 프레임 호출 — 렌더 + 프레임타임 EMA 동적 해상도 */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.contextAlive) return;
    const now = performance.now();
    if (this.lastTime >= 0) {
      const frameMs = Math.min(now - this.lastTime, 100);
      this.emaMs += (frameMs - this.emaMs) * 0.1;
      const dt = frameMs / 1000;
      if (this.emaMs > SLOW_MS) {
        this.slowFor += dt;
        this.fastFor = 0;
        if (this.slowFor >= SLOW_HOLD && this.scale > SCALE_MIN) {
          this.scale = Math.max(SCALE_MIN, this.scale - SCALE_STEP);
          this.slowFor = 0;
          this.applyPixelRatio();
        }
        // 스케일 바닥에서도 계속 느리면 상위 레이어에 품질 강등 요청 (쿨다운 포함)
        if (this.scale <= SCALE_MIN) {
          this.persistSlowFor += dt;
          if (
            this.persistSlowFor >= PERSIST_SLOW_HOLD &&
            now - this.lastPersistSlowMs >= PERSIST_SLOW_COOLDOWN_MS
          ) {
            this.lastPersistSlowMs = now;
            this.persistSlowFor = 0;
            this.onPersistentlySlow?.();
          }
        } else {
          this.persistSlowFor = 0;
        }
      } else if (this.emaMs < FAST_MS) {
        this.fastFor += dt;
        this.slowFor = 0;
        this.persistSlowFor = 0;
        if (this.fastFor >= FAST_HOLD && this.scale < 1) {
          this.scale = Math.min(1, this.scale + SCALE_STEP);
          this.fastFor = 0;
          this.applyPixelRatio();
        }
      } else {
        this.slowFor = 0;
        this.fastFor = 0;
        this.persistSlowFor = 0;
      }
    }
    this.lastTime = now;
    this.gl.render(scene, camera);
  }

  dispose(): void {
    this.gl.setAnimationLoop(null);
    this.gl.dispose();
  }
}
