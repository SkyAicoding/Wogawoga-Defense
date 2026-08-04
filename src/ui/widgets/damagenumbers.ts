/**
 * 데미지 숫자 — 풀링된 span 최대 24개. 떠오르며 페이드아웃.
 * 좌표는 화면(css px) 기준 — 3D→화면 투영은 호출자(game/fx) 책임.
 */
import { h, uiRoot, unmount } from '../dom';

export type DamageKind = 'normal' | 'crit' | 'poison' | 'burn' | 'heal' | 'gold';

const MAX_ACTIVE = 24;

/** style.css의 .dmg--* 기본 크기(rem). scale 인자를 곱해 인라인으로 덮어쓴다 */
const BASE_REM: Record<DamageKind, number> = {
  normal: 1.05,
  crit: 1.5,
  poison: 1.05,
  burn: 1.05,
  heal: 1.05,
  gold: 1.15,
};

interface DmgItem {
  el: HTMLSpanElement;
}

let layer: HTMLElement | null = null;
const free: DmgItem[] = [];
/** 스폰 순서 유지 — 상한 초과 시 가장 오래된 것을 재활용 */
const active: DmgItem[] = [];

function ensureLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = h('div', { class: 'dmg-layer', attrs: { 'aria-hidden': 'true' } });
  uiRoot().appendChild(layer);
  return layer;
}

function release(item: DmgItem): void {
  const i = active.indexOf(item);
  if (i >= 0) active.splice(i, 1);
  item.el.classList.remove('run');
  free.push(item);
}

function acquire(): DmgItem {
  const pooled = free.pop();
  if (pooled) return pooled;
  if (active.length >= MAX_ACTIVE) {
    // 상한 도달: 가장 오래된 것을 강제 재활용
    const oldest = active.shift();
    if (oldest) {
      oldest.el.classList.remove('run');
      return oldest;
    }
  }
  const el = h('span', { class: 'dmg' });
  el.addEventListener('animationend', () => {
    const found = active.find((it) => it.el === el);
    if (found) release(found);
  });
  return { el };
}

/**
 * 데미지/골드/회복 숫자 표시.
 * @param screenX/screenY 화면 css px (뷰포트 기준)
 * @param scale 연출 강도 배수 (1 = CSS 기본 크기). 강한 타격일수록 크게.
 */
export function spawnDamageNumber(
  screenX: number,
  screenY: number,
  text: string,
  kind: DamageKind,
  scale = 1,
): void {
  const host = ensureLayer();
  const item = acquire();
  const el = item.el;
  el.className = `dmg dmg--${kind}`;
  el.textContent = text;
  el.style.left = `${screenX}px`;
  el.style.top = `${screenY}px`;
  // 1에 가까우면 CSS 기본값 그대로 (style.css 미수정 원칙)
  el.style.fontSize =
    Math.abs(scale - 1) < 0.02 ? '' : `${(BASE_REM[kind] * scale).toFixed(3)}rem`;
  if (!el.isConnected) host.appendChild(el);
  // 애니메이션 재시작 트릭: 리플로우 강제 후 run 클래스 부여
  void el.offsetWidth;
  el.classList.add('run');
  active.push(item);
}

/** 랩/화면 전환 정리용 — 레이어와 풀을 통째로 비운다 */
export function clearDamageNumbers(): void {
  if (layer) {
    unmount(layer);
    layer = null;
  }
  free.length = 0;
  active.length = 0;
}
