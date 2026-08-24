/**
 * InputManager 제스처 판별 — **입력 모델의 유일한 자동 검증**이다.
 *
 * 왜 여기인가: e2e 21개는 전부 `page.mouse.click`으로 돌아 `pointerType`이 언제나
 * 'mouse'다. 곧 **터치 경로를 한 줄도 안 밟는다.** 판정이 어긋나면 폰에서 부족원을
 * 움직일 방법이 사라지는데 CI는 전부 초록이다 — 그 구멍을 이 파일이 막는다.
 *
 * 왜 합성 이벤트인가: 이 저장소에는 jsdom이 없고(vitest environment: 'node'),
 * 테스트 하나 때문에 의존성을 늘리지 않는다. InputManager가 DOM에서 실제로 쓰는 것은
 * `addEventListener` · `removeEventListener` · `getBoundingClientRect` 셋뿐이라
 * 그만큼만 흉내 내면 **진짜 코드 경로가 그대로 돈다**(핸들러도, 임계값도, 분기도 진짜다).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputManager } from '@/core/input';

/** 리스너를 모아 두고 직접 때리는 최소 EventTarget */
class FakeTarget {
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  fire(type: string, e: unknown): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
}

/** PointerEvent가 없는 런타임이므로 InputManager가 읽는 필드만 만든다 */
function ptr(
  opts: { x: number; y: number; button?: number; pointerType?: string; id?: number },
): unknown {
  return {
    pointerId: opts.id ?? 1,
    isPrimary: true,
    clientX: opts.x,
    clientY: opts.y,
    button: opts.button ?? 0,
    shiftKey: false,
    pointerType: opts.pointerType ?? 'mouse',
    preventDefault(): void {},
  };
}

describe('InputManager 제스처', () => {
  let el: FakeTarget;
  let win: FakeTarget;
  let input: InputManager;
  let log: { type: string; button: number; pointerType: string }[];
  let prevWindow: unknown;

  beforeEach(() => {
    el = new FakeTarget();
    win = new FakeTarget();
    prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = win;
    input = new InputManager(el as unknown as HTMLElement);
    log = [];
    for (const type of ['tap', 'contextTap', 'dragEnd', 'dragStart'] as const) {
      input.events.on(type, (p) => log.push({ type, button: p.button, pointerType: p.pointerType }));
    }
  });

  afterEach(() => {
    input.dispose();
    (globalThis as { window?: unknown }).window = prevWindow;
  });

  /** down → (선택적 이동) → up 한 벌. 이동은 임계값(12px) 판정을 태우기 위해 move로 흘린다 */
  const gesture = (o: { button?: number; pointerType?: string; move?: number }): void => {
    const base = { x: 100, y: 100, button: o.button, pointerType: o.pointerType };
    el.fire('pointerdown', ptr(base));
    if (o.move) win.fire('pointermove', ptr({ ...base, x: 100 + o.move }));
    win.fire('pointerup', ptr({ ...base, x: 100 + (o.move ?? 0) }));
  };
  const types = (): string[] => log.map((e) => e.type);

  it('마우스 좌클릭 = tap (선택)', () => {
    gesture({ button: 0, pointerType: 'mouse' });
    expect(types()).toEqual(['tap']);
    expect(log[0]?.pointerType, 'placement가 기기를 가르는 값').toBe('mouse');
  });

  it('마우스 우클릭 = contextTap (명령)', () => {
    gesture({ button: 2, pointerType: 'mouse' });
    expect(types()).toEqual(['contextTap']);
    expect(log[0]?.button).toBe(2);
  });

  /**
   * **이 판이 깨지면 카메라를 잃는다.** 우드래그는 궤도 회전이고, 그것이 명령으로도
   * 새면 화면을 돌릴 때마다 부족원이 엉뚱한 곳으로 출발한다.
   */
  it('마우스 우드래그(12px 초과) = dragEnd만 · contextTap 0건', () => {
    gesture({ button: 2, pointerType: 'mouse', move: 40 });
    expect(types()).toEqual(['dragStart', 'dragEnd']);
    expect(types().includes('contextTap'), '우드래그가 명령으로 샜다').toBe(false);
  });

  /** 임계값 **안쪽**의 흔들림은 드래그가 아니다 — 손이 떨려도 명령은 나가야 한다 */
  it('마우스 우클릭 + 임계값 안 흔들림 = contextTap', () => {
    gesture({ button: 2, pointerType: 'mouse', move: 5 });
    expect(types()).toEqual(['contextTap']);
  });

  /**
   * 터치의 primary contact는 `button === 0`이다 → **contextTap이 발화할 경로가 없다.**
   * 이것이 "폰의 흐름은 한 글자도 안 바뀐다"의 구조적 보장이고, 여기가 그 어서션이다.
   */
  it('터치 탭 = tap이고 contextTap은 0건', () => {
    gesture({ button: 0, pointerType: 'touch' });
    expect(types()).toEqual(['tap']);
    expect(log[0]?.pointerType, 'placement가 이 값으로 터치 갈래를 연다').toBe('touch');
  });

  /** 휠 버튼은 지금도 앞으로도 어디로도 안 간다 */
  it('휠 버튼(1)은 아무 이벤트도 안 낸다', () => {
    gesture({ button: 1, pointerType: 'mouse' });
    expect(types()).toEqual([]);
  });

  /** 값이 비어 있으면 placement는 '버튼 하나'로 본다 — 그 판정의 입력이 여기서 보존된다 */
  it('pointerType이 비어 있어도 그대로 실려 나간다', () => {
    gesture({ button: 0, pointerType: '' });
    expect(log[0]?.pointerType).toBe('');
  });
});
