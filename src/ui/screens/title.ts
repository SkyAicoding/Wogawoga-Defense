/**
 * 타이틀 화면 — 돌도장 로고 + '탭하여 시작'. 화면 전체 탭 → 로비.
 */
import type { GameFacade } from '@/data/types';
import { buildStamp } from '@/game/buildinfo';
import type { Screen } from '@/core/fsm';
import { h, mount, unmount, uiRoot } from '../dom';
import { t } from '../i18n';

/** 뼈 장식 (로고 좌우) */
const boneSvg = `<svg viewBox="0 0 64 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M14 12 L50 12" stroke="#f2e6c9" stroke-width="7" stroke-linecap="round"/>
  <circle cx="10" cy="8" r="5.5" fill="#f2e6c9"/><circle cx="10" cy="16" r="5.5" fill="#f2e6c9"/>
  <circle cx="54" cy="8" r="5.5" fill="#f2e6c9"/><circle cx="54" cy="16" r="5.5" fill="#f2e6c9"/>
  <path d="M14 12 L50 12" stroke="#d9c9a3" stroke-width="3" stroke-linecap="round"/>
</svg>`;

/** 모닥불 장식 (로고 아래) */
const fireSvg = `<svg viewBox="0 0 96 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <line x1="20" y1="66" x2="76" y2="52" stroke="#6b4a2f" stroke-width="9" stroke-linecap="round"/>
  <line x1="20" y1="52" x2="76" y2="66" stroke="#8a5a33" stroke-width="9" stroke-linecap="round"/>
  <path d="M48 4 C60 20 70 26 70 42 a22 22 0 0 1 -44 0 C26 26 36 20 48 4 Z"
    fill="#ff7a2f" stroke="#a53d00" stroke-width="4"/>
  <path d="M48 26 C54 34 58 38 58 46 a10 10 0 0 1 -20 0 C38 38 42 34 48 26 Z" fill="#ffd94a"/>
</svg>`;

export function createTitleScreen(): Screen<GameFacade> {
  let root: HTMLElement | null = null;

  return {
    enter(facade) {
      root = h(
        'div',
        {
          class: 'screen screen--title',
          onClick: () => facade.goto('lobby'),
        },
        h(
          'div',
          { class: 'col title-col' },
          h('div', { class: 'title-spacer' }),
          h(
            'div',
            { class: 'title-logo-wrap' },
            h('div', { class: 'title-bone', html: boneSvg }),
            h('div', { class: 'title-logo' },
              h('span', { class: 'title-logo-top', text: t('title.logoTop') }),
              h('span', { class: 'title-logo-bottom', text: t('title.logoBottom') }),
            ),
            h('div', { class: 'title-bone title-bone--flip', html: boneSvg }),
          ),
          h('div', { class: 'title-fire', html: fireSvg }),
          h('div', { class: 'title-spacer' }),
          h('div', { class: 'title-tap', text: t('title.tapToStart') }),
          /*
           * 버전 · 빌드 시각 · 빌드 기기 (사용자 요구). `facade.version` 이 아니라
           * `buildStamp()` 를 쓰는 이유: 시각과 기기는 파사드를 거칠 이유가 없는
           * **빌드 상수**라, 파사드에 실으면 시뮬레이션 쪽 표면만 넓어진다.
           */
          h('div', { class: 'title-version', text: buildStamp() }),
        ),
      );
      mount(uiRoot(), root);
    },
    exit() {
      if (root) unmount(root);
      root = null;
    },
  };
}
