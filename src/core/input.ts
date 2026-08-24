/**
 * 통합 입력 — 터치+마우스를 하나의 포인터 스트림으로, 탭/드래그 판별 포함.
 * 좌표는 캔버스 CSS 픽셀 기준. 3D 레이캐스트 변환은 render/game 쪽 책임.
 *
 * ── 버튼이 뜻을 갖는 자리는 여기가 아니다 ───────────────────────────────────
 * 이 파일이 하는 일은 **제스처를 셋으로 가르는 것**뿐이다:
 *   좌클릭/터치 탭 → `tap` · 우클릭 탭 → `contextTap` · 임계값 넘은 이동 → `dragEnd`.
 * "탭이 선택인가 명령인가"는 game/placement.ts가 `pointerType`을 보고 정한다.
 * 규칙을 여기 두면 카메라(궤도 회전)와 게임(명령)이 같은 상수를 공유하게 되고,
 * 한쪽을 고칠 때 다른 쪽이 조용히 따라 바뀐다.
 */
import { Emitter } from './events';

export interface PointerInfo {
  x: number;
  y: number;
  /** down 위치로부터 이동 거리 */
  dragDx: number;
  dragDy: number;
  /**
   * pointerdown 시점의 버튼 (0=좌/터치, 1=휠, 2=우). 제스처 도중에는 고정 —
   * 드래그 중간에 버튼/수정키가 바뀌어도 모드가 튀지 않게 래치한다.
   */
  button: number;
  /** pointerdown 시점의 Shift 상태 */
  shiftKey: boolean;
  /**
   * pointerdown 시점의 포인터 종류 (`'mouse' | 'touch' | 'pen' | ''`). 제스처 도중 고정.
   *
   * **입력 모델을 데스크톱과 터치로 가르는 유일한 값이다** — 버튼이 둘인 기기와 하나뿐인
   * 기기는 같은 규칙을 쓸 수 없다(마우스는 좌=선택·우=명령, 터치는 좌탭 하나가 둘을 겸한다).
   * 값 자체를 그대로 넘기고 **해석은 소비자(placement)가 한다** — 이 파일은 포인터
   * 스트림을 정규화할 뿐 게임 규칙을 모른다.
   */
  pointerType: string;
}

type InputEvents = {
  down: PointerInfo;
  move: PointerInfo;
  up: PointerInfo;
  /** 이동이 임계값 미만인 up */
  tap: PointerInfo;
  /**
   * 이동이 임계값 미만인 **보조 버튼** up (`button === 2` = 우클릭) = **명령**.
   *
   * ⚠ **우드래그는 여기 안 온다.** 아래 `onUp`의 `dragging` 분기가 먼저 잡아 `dragEnd`로
   *   나가고, 그것이 카메라 궤도 회전이다(placement.ts의 dragEnd 구독 ·
   *   battlecontroller.ts의 `orbitDrag = i.button === 2 || i.shiftKey`).
   *   곧 "우클릭했는데 드래그가 아니었을 때"만 이 이벤트다 — 두 뜻이 분기 하나로 배타다.
   * ⚠ **터치는 여기 안 온다.** 터치의 primary contact는 `button === 0`이라 구조적으로
   *   `tap`으로만 나간다. 폰의 흐름은 한 글자도 안 바뀐다.
   */
  contextTap: PointerInfo;
  /** 드래그 시작 (임계값 초과 시 1회) */
  dragStart: PointerInfo;
  drag: PointerInfo;
  dragEnd: PointerInfo;
  /**
   * 두 손가락 제스처 — 직전 이벤트 대비 델타를 한 번에 싣는다.
   * scale: 거리 배율(줌), rotate: 두 손가락이 이루는 각의 변화(rad, 화면
   * 시계방향 +), panX/panY: 중심점 이동(px). rotate/pan은 데드존을 넘기
   * 전까지 0으로 나간다.
   */
  pinch: {
    scale: number;
    rotate: number;
    panX: number;
    panY: number;
    centerX: number;
    centerY: number;
  };
  /** 마우스 휠 — deltaY>0 = 축소 방향 */
  wheel: { deltaY: number; x: number; y: number };
  key: { code: string };
};

const TAP_THRESHOLD_PX = 12;
/** 두 손가락 회전 데드존 — 누적 2°를 넘겨야 회전이 열린다 */
const PINCH_ROTATE_DEADZONE = (2 * Math.PI) / 180;
/** 두 손가락 중심 이동 데드존(px) */
const PINCH_PAN_DEADZONE_PX = 4;
/**
 * 중심 이동이 "손가락 벌림"보다 이만큼 우세해야 팬으로 인정한다.
 * 한 손가락을 고정하고 다른 손가락만 벌리는 줌에서는 중심이 벌린 거리의 절반만큼
 * 따라 움직이므로(비율 0.5), 0.6 문턱을 두면 그런 줌이 피치로 새지 않는다.
 */
const PINCH_PAN_DOMINANCE = 0.6;

export class InputManager {
  readonly events = new Emitter<InputEvents>();
  private downX = 0;
  private downY = 0;
  private isDown = false;
  private dragging = false;
  private info: PointerInfo = {
    x: 0, y: 0, dragDx: 0, dragDy: 0, button: 0, shiftKey: false, pointerType: '',
  };
  /** 활성 포인터들 (멀티터치 핀치 판정) */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinching = false;
  /** 핀치에 쓰는 두 포인터 id — 손가락이 바뀌면 기준값을 다시 잡는다 */
  private pinchIds: [number, number] | null = null;
  private lastPinchDist = 0;
  private lastPinchAngle = 0;
  private lastPinchCx = 0;
  private lastPinchCy = 0;
  /** 데드존 누적/개방 상태 */
  private rotAccum = 0;
  private panAccum = 0;
  private spreadAccum = 0;
  private rotOpen = false;
  private panOpen = false;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp, { passive: false });
    window.addEventListener('pointercancel', this.onCancel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    // 모바일 제스처 차단
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('dblclick', this.onDblClick);
    /*
     * ⚠ 우클릭 메뉴는 **문서 전체**에서 막는다 — 캔버스에만 걸면 부족하다.
     *
     * 우클릭이 카메라 회전 전용이던 동안에는 캔버스 밖에서 메뉴가 떠도 무해했다.
     * 그런데 이제 우클릭이 **주요 동사**(이동·채집·공격)라, 전투 중에 카드 바·사이드
     * 버튼·웨이브 배너를 살짝 빗맞히면 그 순간 OS 메뉴가 게임 위에 뜬다.
     * 실측: `canvas → prevented true` · `button.icon-btn → prevented **false**` · `body → false`.
     * 화면의 상당 면적이 캔버스가 아니므로 이건 드문 사고가 아니다.
     *
     * 문서 레벨로 올리는 대가는 "이 페이지에서는 우클릭 메뉴를 못 쓴다" 하나이고,
     * 전체 화면 게임에서 그건 잃는 것이 아니다(모바일 롱프레스 메뉴도 같은 이유로 막고 있다).
     */
    document.addEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onDblClick = (e: Event): void => {
    e.preventDefault();
  };

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

  /** 핀치 기준 쌍의 현재 좌표 (한 손가락이라도 빠졌으면 null) */
  private pinchPts(): [{ x: number; y: number }, { x: number; y: number }] | null {
    if (!this.pinchIds) return null;
    const a = this.pointers.get(this.pinchIds[0]);
    const b = this.pointers.get(this.pinchIds[1]);
    return a && b ? [a, b] : null;
  }

  /** 현재 활성 포인터 중 앞의 둘을 핀치 쌍으로 잡고 기준값 리셋 */
  private beginPinch(): void {
    const ids = [...this.pointers.keys()];
    if (ids.length < 2) return;
    this.pinchIds = [ids[0] as number, ids[1] as number];
    const pts = this.pinchPts();
    if (!pts) return;
    const [a, b] = pts;
    this.pinching = true;
    this.lastPinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    this.lastPinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
    this.lastPinchCx = (a.x + b.x) / 2;
    this.lastPinchCy = (a.y + b.y) / 2;
    this.rotAccum = 0;
    this.panAccum = 0;
    this.spreadAccum = 0;
    this.rotOpen = false;
    this.panOpen = false;
  }

  private endPinch(): void {
    this.pinching = false;
    this.pinchIds = null;
    this.lastPinchDist = 0;
  }

  private onDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, this.pointerPos(e));
    if (this.pointers.size === 2) {
      // 두 번째 손가락 → 핀치 모드: 진행 중이던 탭/드래그는 취소.
      // 취소이므로 dragEnd를 방출하지 않는다 (dragEnd = 의도된 릴리즈에만).
      this.beginPinch();
      this.dragging = false;
      this.isDown = false;
      return;
    }
    if (!e.isPrimary || this.pinching) return;
    this.setInfo(e);
    this.info.button = e.button;
    this.info.shiftKey = e.shiftKey;
    // button/shiftKey와 같은 규약으로 **down 시점에 래치**한다 — 한 제스처 도중
    // 종류가 바뀔 일은 없지만, 소비자가 up에서 읽으므로 값의 수명이 같아야 한다.
    this.info.pointerType = e.pointerType;
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
      const pts = this.pinchPts();
      if (!pts) {
        // 기준 손가락이 바뀌었다 (3손가락 중 하나가 떨어진 경우 등) — 기준 재설정
        this.beginPinch();
        return;
      }
      const [a, b] = pts;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > 0 && this.lastPinchDist > 0) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        // [-π,π]로 랩 — 두 손가락이 수평을 지날 때 튀지 않게
        let dAng = ang - this.lastPinchAngle;
        if (dAng > Math.PI) dAng -= 2 * Math.PI;
        else if (dAng < -Math.PI) dAng += 2 * Math.PI;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const dCx = cx - this.lastPinchCx;
        const dCy = cy - this.lastPinchCy;

        // 데드존: 누적이 임계를 넘으면 그때부터 델타를 통과시킨다
        // (프레임 델타에 직접 임계를 걸면 느린 회전이 영영 안 열린다)
        if (!this.rotOpen) {
          this.rotAccum += dAng;
          if (Math.abs(this.rotAccum) > PINCH_ROTATE_DEADZONE) this.rotOpen = true;
        }
        if (!this.panOpen) {
          this.panAccum += Math.hypot(dCx, dCy);
          this.spreadAccum += Math.abs(d - this.lastPinchDist);
          if (
            this.panAccum > PINCH_PAN_DEADZONE_PX &&
            this.panAccum > this.spreadAccum * PINCH_PAN_DOMINANCE
          ) {
            this.panOpen = true;
          }
        }

        this.events.emit('pinch', {
          scale: d / this.lastPinchDist,
          rotate: this.rotOpen ? dAng : 0,
          panX: this.panOpen ? dCx : 0,
          panY: this.panOpen ? dCy : 0,
          centerX: cx,
          centerY: cy,
        });
        this.lastPinchAngle = ang;
        this.lastPinchCx = cx;
        this.lastPinchCy = cy;
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
      if (this.pointers.size < 2) this.endPinch();
      else if (!this.pinchPts()) this.beginPinch();
      return; // 핀치에 쓰인 손가락의 up은 탭으로 치지 않는다
    }
    if (!e.isPrimary || !this.isDown) return;
    this.setInfo(e);
    this.isDown = false;
    this.events.emit('up', this.info);
    if (this.dragging) {
      this.dragging = false;
      this.events.emit('dragEnd', this.info);
    } else if (this.info.button === 0) {
      // 좌클릭/터치 = **선택**(그리고 터치에서는 명령까지 겸한다 — placement가 가른다).
      // 우클릭은 여기로 안 온다: 궤도 회전으로 오해돼 타워가 실수로 배치되던 자리다.
      this.events.emit('tap', this.info);
    } else if (this.info.button === 2) {
      // 우클릭인데 드래그가 아니었다 = **명령**이다. 궤도 회전은 바로 위 분기가 이미
      // 통째로 가져갔으므로 한 제스처가 두 뜻을 갖지 않는다.
      // 휠 버튼(1)은 지금도 앞으로도 어디로도 안 간다.
      this.events.emit('contextTap', this.info);
    }
  };

  /** pointercancel — tap/dragEnd 없이 상태만 리셋 (브라우저가 제스처를 가로챈 경우) */
  private onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.endPinch();
    else if (this.pinching && !this.pinchPts()) this.beginPinch();
    this.isDown = false;
    this.dragging = false;
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
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onKey);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('contextmenu', this.onContextMenu);
    this.el.removeEventListener('dblclick', this.onDblClick);
    this.events.clear();
  }
}
