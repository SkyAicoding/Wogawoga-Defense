/**
 * 타워 카드 위젯 + 공용 아이콘 SVG.
 * 아이콘은 전부 코드 생성 인라인 SVG — 8종 타워가 서로 확실히 구분되도록 형태/색을 달리한다.
 */
import type { TowerId } from '@/data/types';
import { h, cls, fmt, setText } from '../dom';
import { t } from '../i18n';

const SVG = (body: string): string =>
  `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

/** 타워별 상징 아이콘 — viewBox 48×48 */
export function towerIconSvg(id: TowerId): string {
  switch (id) {
    case 'spear': // 창 + 짚 움막 지붕
      return SVG(
        `<path d="M6 30 L24 14 L42 30 Z" fill="#c9a35a" stroke="#5e3a1e" stroke-width="2.5"/>
         <rect x="12" y="30" width="24" height="10" rx="2" fill="#8a5a33" stroke="#5e3a1e" stroke-width="2.5"/>
         <line x1="14" y1="40" x2="38" y2="8" stroke="#a97e4f" stroke-width="3.4" stroke-linecap="round"/>
         <path d="M38 8 L44 4 L41 12 Z" fill="#b9c4c9" stroke="#4a5559" stroke-width="2"/>`,
      );
    case 'catapult': // 투석기 팔 + 바위
      return SVG(
        `<rect x="8" y="34" width="32" height="7" rx="3" fill="#8a5a33" stroke="#5e3a1e" stroke-width="2.5"/>
         <circle cx="14" cy="40" r="4" fill="#6b4a2f" stroke="#4a3220" stroke-width="2"/>
         <circle cx="34" cy="40" r="4" fill="#6b4a2f" stroke="#4a3220" stroke-width="2"/>
         <line x1="14" y1="36" x2="34" y2="14" stroke="#a97e4f" stroke-width="4" stroke-linecap="round"/>
         <circle cx="36" cy="11" r="7" fill="#9aa3a8" stroke="#4a5559" stroke-width="2.5"/>
         <circle cx="33.5" cy="9" r="2" fill="#c3ccd1"/>`,
      );
    case 'lightning': // 토템 + 번개
      return SVG(
        `<rect x="18" y="16" width="12" height="26" rx="3" fill="#7a5230" stroke="#4a3220" stroke-width="2.5"/>
         <rect x="15" y="10" width="18" height="8" rx="3" fill="#a97e4f" stroke="#4a3220" stroke-width="2.5"/>
         <circle cx="21.5" cy="24" r="1.8" fill="#2c1c0e"/><circle cx="26.5" cy="24" r="1.8" fill="#2c1c0e"/>
         <path d="M28 4 L18 22 L25 22 L20 36 L34 17 L26 17 Z" fill="#ffd94a" stroke="#a56a00" stroke-width="2" stroke-linejoin="round"/>`,
      );
    case 'brazier': // 장작 + 불꽃
      return SVG(
        `<line x1="12" y1="42" x2="36" y2="34" stroke="#6b4a2f" stroke-width="5" stroke-linecap="round"/>
         <line x1="12" y1="34" x2="36" y2="42" stroke="#8a5a33" stroke-width="5" stroke-linecap="round"/>
         <path d="M24 4 C30 12 34 16 34 24 a10 10 0 0 1 -20 0 C14 16 20 12 24 4 Z" fill="#ff7a2f" stroke="#a53d00" stroke-width="2.5"/>
         <path d="M24 16 C27 20 29 22 29 26 a5 5 0 0 1 -10 0 C19 22 22 20 24 16 Z" fill="#ffd94a"/>`,
      );
    case 'frost': // 얼음 결정
      return SVG(
        `<path d="M24 3 L33 12 L33 30 L24 43 L15 30 L15 12 Z" fill="#9fdcf7" stroke="#2c7ea6" stroke-width="2.5" stroke-linejoin="round"/>
         <path d="M24 10 L28 14 L28 28 L24 35 L20 28 L20 14 Z" fill="#e3f6ff"/>
         <line x1="24" y1="10" x2="24" y2="35" stroke="#6ebfe3" stroke-width="1.6"/>`,
      );
    case 'poison': // 가시 덩굴 + 독액
      return SVG(
        `<path d="M10 42 C16 30 14 20 24 14 C34 8 38 12 40 8" fill="none" stroke="#3f7d33" stroke-width="4.5" stroke-linecap="round"/>
         <path d="M18 28 l-6 -2 M22 20 l-6 -4 M30 12 l-3 -6 M34 11 l2 -6" stroke="#3f7d33" stroke-width="3" stroke-linecap="round"/>
         <path d="M33 26 C36 31 39 33 39 37 a6 6 0 0 1 -12 0 C27 33 30 31 33 26 Z" fill="#8bd44a" stroke="#3c6b1c" stroke-width="2.5"/>`,
      );
    case 'ballista': // 활대 + 상아 화살
      return SVG(
        `<path d="M8 34 A22 22 0 0 1 40 34" fill="none" stroke="#8a5a33" stroke-width="4.5" stroke-linecap="round"/>
         <line x1="8" y1="34" x2="40" y2="34" stroke="#d9c9a3" stroke-width="2"/>
         <line x1="24" y1="42" x2="24" y2="12" stroke="#f2e6c9" stroke-width="4" stroke-linecap="round"/>
         <path d="M24 4 L18 14 L30 14 Z" fill="#f2e6c9" stroke="#8a7a55" stroke-width="2"/>`,
      );
    case 'drum': // 전쟁북 + 북채
      return SVG(
        `<ellipse cx="24" cy="16" rx="14" ry="6" fill="#e8d9b8" stroke="#5e3a1e" stroke-width="2.5"/>
         <path d="M10 16 V34 a14 6 0 0 0 28 0 V16" fill="#b3502e" stroke="#5e3a1e" stroke-width="2.5"/>
         <path d="M12 20 l8 8 m8 0 l8 -8 m-16 6 l8 -6" stroke="#f2e0c0" stroke-width="2"/>
         <line x1="10" y1="6" x2="20" y2="13" stroke="#6b4a2f" stroke-width="3" stroke-linecap="round"/>
         <line x1="38" y1="6" x2="28" y2="13" stroke="#6b4a2f" stroke-width="3" stroke-linecap="round"/>
         <circle cx="9" cy="5" r="3" fill="#e8d9b8" stroke="#5e3a1e" stroke-width="1.6"/>
         <circle cx="39" cy="5" r="3" fill="#e8d9b8" stroke="#5e3a1e" stroke-width="1.6"/>`,
      );
  }
}

/** 골드(조개 화폐) 아이콘 */
export const goldSvg = SVG(
  `<circle cx="24" cy="24" r="17" fill="#ffd04a" stroke="#a56a00" stroke-width="3"/>
   <circle cx="24" cy="24" r="10" fill="#ffe9a3" stroke="#d9a520" stroke-width="2"/>`,
);

/** 호박(메타 재화) 아이콘 — 벌레 든 호박 보석 */
export const amberSvg = SVG(
  `<path d="M24 4 C36 4 42 14 42 24 C42 36 34 44 24 44 C14 44 6 36 6 24 C6 14 12 4 24 4 Z"
     fill="#ff9d2e" stroke="#a04c00" stroke-width="3"/>
   <path d="M24 9 C32 9 37 16 37 24 C37 33 31 39 24 39" fill="none" stroke="#ffd94a" stroke-width="3" stroke-linecap="round"/>
   <ellipse cx="22" cy="26" rx="4" ry="5.5" fill="#7a3c00"/>`,
);

/** 기지 HP 하트 */
export const heartSvg = SVG(
  `<path d="M24 42 C10 32 4 24 4 15 A10 10 0 0 1 24 11 A10 10 0 0 1 44 15 C44 24 38 32 24 42 Z"
     fill="#ff5a5a" stroke="#8f1d1d" stroke-width="3"/>`,
);

/** 별 (채움/빈칸) */
export function starSvg(filled: boolean): string {
  const fill = filled ? '#ffd94a' : '#4d4438';
  const stroke = filled ? '#a56a00' : '#332c22';
  return SVG(
    `<path d="M24 3 L30 17 L45 18 L34 28 L37 43 L24 35 L11 43 L14 28 L3 18 L18 17 Z"
       fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`,
  );
}

/** 자물쇠 */
export const lockSvg = SVG(
  `<rect x="10" y="20" width="28" height="22" rx="5" fill="#8a8073" stroke="#3c352b" stroke-width="3"/>
   <path d="M15 20 v-4 a9 9 0 0 1 18 0 v4" fill="none" stroke="#3c352b" stroke-width="4"/>
   <circle cx="24" cy="30" r="3.4" fill="#3c352b"/>`,
);

// ---------------------------------------------------------------------------
// 전투 카드 컴포넌트
// ---------------------------------------------------------------------------
export interface TowerCardOpts {
  towerId: TowerId;
  cost: number;
  onTap: () => void;
}

export interface TowerCard {
  el: HTMLElement;
  towerId: TowerId;
  setSelected(on: boolean): void;
  setDisabled(on: boolean): void;
  setCost(cost: number): void;
}

/** 전투 HUD 하단의 타워 카드. 선택/골드 부족 상태는 매 프레임 diff 갱신된다. */
export function createTowerCard(opts: TowerCardOpts): TowerCard {
  const costEl = h('span', { class: 'tcard-cost-num', text: fmt(opts.cost) });
  const el = h(
    'button',
    { class: 'tcard', attrs: { type: 'button' }, onClick: opts.onTap },
    h('span', { class: 'tcard-icon', html: towerIconSvg(opts.towerId) }),
    h('span', { class: 'tcard-name', text: t(`tower.${opts.towerId}.name`) }),
    h('span', { class: 'tcard-cost', html: goldSvg }, costEl),
  );
  return {
    el,
    towerId: opts.towerId,
    setSelected(on) {
      cls(el, 'is-selected', on);
    },
    setDisabled(on) {
      cls(el, 'is-disabled', on);
    },
    setCost(cost) {
      setText(costEl, fmt(cost));
    },
  };
}
