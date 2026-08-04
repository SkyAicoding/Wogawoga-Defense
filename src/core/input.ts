/**
 * 통합 입력 — 터치+마우스를 하나의 포인터 스트림으로, 탭/드래그 판별 포함.
 * 좌표는 캔버스 CSS 픽셀 기준. 3D 레이캐스트 변환은 render/game 쪽 책임.
 */
import { Emitter } from './events';

export interface PointerInfo {
  x: number;
  y: number;
  /** down 위치로부터 이동 거리 */
  dragDx: number;
  dragDy: number;
}

type InputEvents = {
  down: PointerInfo;
  move: PointerInfo;
  up: PointerInfo;
  /** 이동이 임계값 미만인 up */
  tap: PointerInfo;
  /** 드래그 시작 (임계값 초과 시 1회) */
  dragStart: PointerInfo;
  drag: PointerInfo;
  dragEnd: PointerInfo;
  /** 두 손가락 핀치 — scale은 직전 프레임 대비 배율 */
  pinch: { scale: number; centerX: number; centerY: number };
  /** 마우스 휠 — deltaY>0 = 축소 방향 */
  wheel: { deltaY: number; x: number; y: number };
  key: { code: string };
};

const TAP_THRESHOLD_PX = 12;

export class InputManager {
  readonly events = new Emitter<InputEvents>();
  private downX = 0;
  private downY = 0;
  private isDown = false;
  private dragging = false;
  private info: PointerInfo = { x: 0, y: 0, dragDx: 0, dragDy: 0 };
  /** 활성 포인터들 (멀티터치 핀치 판정) */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinching = false;
  private lastPinchDist = 0;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp, { passive: false });
    window.addEventListener('pointercancel', this.onUp, { passive: false });
    window.addEventListener('keydown', this.onKey);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    // 모바일 제스처 차단
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private setInfo(e: PointerEvent): void {
    const rect = this.el.getBoundingClientRect();
    this.info.x = e.clientX - rect.left;
    this.info.y = e.clientY - rect.top;
    this.info.dragDx = this.info.x - this.downX;
    this.info.dragDy = this.info.y - this.downY;
  }

  private pointerPos(e: PointerEvent): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private pinchDist(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    const a = pts[0] as { x: number; y: number };
    const b = pts[1] as { x: number; y: number };
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private onDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, this.pointerPos(e));
    if (this.pointers.size === 2) {
      // 두 번째 손가락 → 핀치 모드: 진행 중이던 탭/드래그 취소
      this.pinching = true;
      this.lastPinchDist = this.pinchDist();
      if (this.dragging) {
        this.dragging = false;
        this.events.emit('dragEnd', this.info);
      }
      this.isDown = false;
      return;
    }
    if (!e.isPrimary || this.pinching) return;
    this.setInfo(e);
    this.downX = this.info.x;
    this.downY = this.info.y;
    this.info.dragDx = 0;
    this.info.dragDy = 0;
    this.isDown = true;
    this.dragging = false;
    this.events.emit('down', this.info);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.pointerPos(e));
    if (this.pinching) {
      const d = this.pinchDist();
      if (d > 0 && this.lastPinchDist > 0) {
        const pts = [...this.pointers.values()];
        const a = pts[0] as { x: number; y: number };
        const b = pts[1] as { x: number; y: number };
        this.events.emit('pinch', {
          scale: d / this.lastPinchDist,
          centerX: (a.x + b.x) / 2,
          centerY: (a.y + b.y) / 2,
        });
      }
      if (d > 0) this.lastPinchDist = d;
      return;
    }
    if (!e.isPrimary) return;
    this.setInfo(e);
    this.events.emit('move', this.info);
    if (this.isDown && !this.dragging) {
      if (Math.hypot(this.info.dragDx, this.info.dragDy) > TAP_THRESHOLD_PX) {
        this.dragging = true;
        this.events.emit('dragStart', this.info);
      }
    } else if (this.dragging) {
      this.events.emit('drag', this.info);
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pinching) {
      if (this.pointers.size < 2) {
        this.pinching = false;
        this.lastPinchDist = 0;
      }
      return; // 핀치에 쓰인 손가락의 up은 탭으로 치지 않는다
    }
    if (!e.isPrimary || !this.isDown) return;
    this.setInfo(e);
    this.isDown = false;
    this.events.emit('up', this.info);
    if (this.dragging) {
      this.dragging = false;
      this.events.emit('dragEnd', this.info);
    } else {
      this.events.emit('tap', this.info);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault(); // 페이지 스크롤/브라우저 줌 방지
    const rect = this.el.getBoundingClientRect();
    this.events.emit('wheel', {
      deltaY: e.deltaY,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  private onKey = (e: KeyboardEvent): void => {
    // 물리 키코드 사용 (비라틴 자판 호환)
    this.events.emit('key', { code: e.code });
  };

  /** 리스너 해제 (전투 종료 시 누수 방지) */
  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    this.el.removeEventListener('wheel', this.onWheel);
    this.events.clear();
  }
}
