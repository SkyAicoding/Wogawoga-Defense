/** 기기/브라우저 능력 감지 — 부팅 시 1회 평가 */

export const isTouch =
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

/**
 * **주 포인터가 손가락인가** — 조작 안내 문구를 고르는 값이다.
 *
 * `isTouch`(터치가 되기는 하는가)와 갈라 둔 이유가 하이브리드 기기다: 터치 노트북은
 * `isTouch`가 참이지만 사람이 실제로 쓰는 것은 마우스다. 그 기기에 "탭하세요"를 띄우면
 * **화면이 없는 조작을 가르친다** — 마우스에서는 좌클릭이 선택이고 명령은 우클릭이다
 * (game/placement.ts 헤더). `(pointer: coarse)`는 브라우저가 **주** 입력을 답하므로
 * 그 기기에서 정확히 마우스 쪽을 고른다.
 *
 * ⚠ 실제 명령 갈래는 이 값을 **안 본다.** 그쪽은 이벤트마다 `pointerType`으로 갈린다 —
 * 기기 단위 추측으로 조작을 정하면 하이브리드에서 한쪽 입력이 죽는다. 이 상수가 정하는
 * 것은 **글자뿐**이고, 틀려도 잃는 것은 안내 한 줄이다.
 */
export const isCoarsePointer =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const isMobile =
  typeof navigator !== 'undefined' &&
  (isIOS || /Android|Mobile/i.test(navigator.userAgent));

export const supportsVibration =
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** 렌더 해상도 상한: 모바일 DPR 2, 데스크톱 2 */
export function cappedDpr(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(dpr, 2);
}

export function vibrate(ms: number | number[]): void {
  if (supportsVibration) navigator.vibrate(ms);
}

/** 화면 꺼짐 방지 (지원 시). 실패해도 무시 */
export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    if ('wakeLock' in navigator) {
      return await navigator.wakeLock.request('screen');
    }
  } catch {
    /* 저전력 모드 등에서 거부 — 무시 */
  }
  return null;
}
