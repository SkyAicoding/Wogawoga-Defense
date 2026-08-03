/** 기기/브라우저 능력 감지 — 부팅 시 1회 평가 */

export const isTouch =
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

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
