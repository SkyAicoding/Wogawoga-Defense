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

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp, { passive: false });
    window.addEventListener('pointercancel', this.onUp, { passive: false });
    window.addEventListener('keydown', this.onKey);
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

  private onDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
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

  private onKey = (e: KeyboardEvent): void => {
    // 물리 키코드 사용 (비라틴 자판 호환)
    this.events.emit('key', { code: e.code });
  };
}
