/**
 * 데미지 숫자 — 풀링된 span 최대 24개. 떠오르며 페이드아웃.
 * 좌표는 화면(css px) 기준 — 3D→화면 투영은 호출자(game/fx) 책임.
 */
import { h, uiRoot, unmount } from '../dom';

/**
 * 'tower' = **내 타워가 깎이는** 피해. 적 피해('normal', 흰색)와 부호 하나로만
 * 구분되던 것을 색·굵기·크기로 갈랐다 — 난전에서 숫자가 겹치면 부호는 못 읽는다.
 */
export type DamageKind = 'normal' | 'crit' | 'poison' | 'burn' | 'heal' | 'gold' | 'tower';

const MAX_ACTIVE = 24;

// ---------------------------------------------------------------------------
// 표기 규약 — **색만으로 구분하지 않는다**
//
// 색각 이상에서 색은 채널이 아니다. 그래서 상성이 개입한 타격에는 **부호**를 준다:
//   감산된 피해 `(18)` — 괄호        유리한 피해 `43!` — 느낌표
// 괄호는 "원래보다 작다", 느낌표는 "장갑이 있었는데도 거의 다 들어갔다"이고,
// 둘 다 **같은 적에게 서로 다른 타워를 쐈을 때 나란히 보인다** — 그게 이 표기의 값이다
// (트리케라톱스 armor 4: 얼음 T1 `(3)` · 창 T1 `(8)` · 발리스타 T1 `51!`).
//
// 왜 이 형태인가 (docs/counter-plan.md Q3 층 3): 24슬롯 난전에서 가장 짧아야 한다.
// `76 ⤳ 36`(두 수 + 화살표)나 '빗나감'(낱말, ko/en 폭이 다르다)은 겹치면 못 읽는다.
//
// 지금은 **armor 감산에만** 붙는다. 신설 축(가죽🟫·흩어짐〽)은 Phase 2에서
// 같은 규약에 얹는다 — 새 부호를 만들지 않고 괄호를 그대로 쓴다.
// ---------------------------------------------------------------------------
/** 원래 피해의 이 비율 이상을 장갑이 먹었으면 괄호 */
export const MITIGATED_SHARE = 0.25;
/** 장갑이 있는데도 이 비율 이하만 먹혔으면 느낌표 (뚫었다) */
export const PIERCED_SHARE = 0.1;

/**
 * 데미지 숫자 문자열. `armor`는 **이 타격에 실제로 적용된 고정 감산**이다
 * (적용되지 않는 경로 — 독 DoT의 ignoreArmor 등 — 은 호출자가 0을 넘긴다).
 *
 * 원래 피해를 이벤트가 싣고 다니지 않으므로 `dealt + armor`로 되짚는다.
 * 감산 후 하한(최소 1)에 걸린 타격에서는 이 되짚기가 실제보다 작게 나오는데,
 * 그때는 비율이 더욱 커져 어차피 괄호가 붙으므로 판정이 뒤집히지 않는다.
 *
 * `mitigated`(2단계)는 **가죽🟫·흩어짐〽 전용 통로**다. 이 둘은 원래 피해를 UI가
 * 되짚을 수 없어서(상한값·저항률이 화면에 없다) sim이 직접 "깎였다"를 실어 보낸다.
 * 이미 `MITIGATED_MIN_SHARE`로 **눈에 띄는 손실만** 걸러져 오므로 여기서는 그대로 괄호다.
 * 장갑은 옛 경로를 그대로 쓴다 — 되짚기가 가능하고, `n!`(뚫었다)이 그 비율에서만 나온다.
 */
export function damageText(
  dealt: number,
  armor: number,
  mitigated?: 'armor' | 'hide' | 'splash',
): string {
  const n = Math.max(1, Math.round(dealt));
  if (mitigated === 'hide' || mitigated === 'splash') return `(${n})`;
  if (armor <= 0) return String(n);
  const share = armor / (n + armor);
  if (share >= MITIGATED_SHARE) return `(${n})`;
  if (share <= PIERCED_SHARE) return `${n}!`;
  return String(n);
}

/** style.css의 .dmg--* 기본 크기(rem). scale 인자를 곱해 인라인으로 덮어쓴다 */
const BASE_REM: Record<DamageKind, number> = {
  normal: 1.05,
  crit: 1.5,
  poison: 1.05,
  burn: 1.05,
  heal: 1.05,
  gold: 1.15,
  tower: 1.25,
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
