/**
 * 로비 — 상단 재화/설정, 중앙 스테이지 캐러셀(스와이프+화살표), 하단 전투/도감.
 * 스테이지 메타(바이옴/웨이브 수)는 data 트랙 소유라 GameFacade로 접근 불가 →
 * 표시용 로컬 테이블 사용 (contractIssues 보고 대상).
 */
import type { BiomeId, GameFacade } from '@/data/types';
import type { Screen } from '@/core/fsm';
import { h, cls, fmt, mount, unmount, uiRoot, clearChildren } from '../dom';
import { t } from '../i18n';
import { amberSvg, lockSvg } from '../widgets/card';

/** 표시용 스테이지 메타 — 통합 시 facade가 StageDef 목록을 노출하면 대체 */
const STAGE_META: readonly { id: number; biome: BiomeId; waveCount: number }[] = [
  { id: 1, biome: 'grassland', waveCount: 50 },
  { id: 2, biome: 'jungle', waveCount: 50 },
  { id: 3, biome: 'desert', waveCount: 50 },
  { id: 4, biome: 'snow', waveCount: 50 },
  { id: 5, biome: 'swamp', waveCount: 50 },
  { id: 6, biome: 'volcano', waveCount: 50 },
];

const B = (body: string, sky: string): string =>
  `<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
   <rect width="120" height="80" rx="10" fill="${sky}"/>${body}</svg>`;

/** 바이옴 썸네일 — 이모지풍 미니 풍경 SVG */
function biomeSvg(biome: BiomeId): string {
  switch (biome) {
    case 'grassland':
      return B(
        `<circle cx="96" cy="18" r="10" fill="#ffd94a"/>
         <ellipse cx="30" cy="78" rx="46" ry="26" fill="#6fbb4a"/>
         <ellipse cx="96" cy="84" rx="52" ry="28" fill="#559e38"/>
         <path d="M22 58 l4 -12 l4 12 Z" fill="#3f7d33"/><path d="M36 62 l4 -12 l4 12 Z" fill="#3f7d33"/>`,
        '#aee3f7',
      );
    case 'jungle':
      return B(
        `<path d="M28 80 V44 M28 46 C16 44 10 34 12 26 C22 26 30 34 28 46 M28 46 C40 44 46 34 44 26 C34 26 26 34 28 46" stroke="#2c6b2f" stroke-width="6" fill="none" stroke-linecap="round"/>
         <path d="M84 80 V38 M84 40 C70 38 64 26 66 16 C78 16 88 26 84 40 M84 40 C98 38 104 26 102 16 C90 16 80 26 84 40" stroke="#3f8f3f" stroke-width="7" fill="none" stroke-linecap="round"/>
         <ellipse cx="60" cy="86" rx="70" ry="20" fill="#2f7a33"/>`,
        '#7fd0a8',
      );
    case 'desert':
      return B(
        `<circle cx="24" cy="16" r="11" fill="#ff9d2e"/>
         <ellipse cx="40" cy="84" rx="60" ry="26" fill="#e8c477"/>
         <ellipse cx="104" cy="88" rx="50" ry="24" fill="#d9a95c"/>
         <path d="M78 66 V40 M78 50 h-9 v-9 M78 46 h9 v-11" stroke="#4d8f3c" stroke-width="7" fill="none" stroke-linecap="round"/>`,
        '#ffe1a8',
      );
    case 'snow':
      return B(
        `<path d="M8 80 L38 30 L58 62 L74 40 L112 80 Z" fill="#e8f2fa"/>
         <path d="M38 30 L46 44 L30 44 Z" fill="#ffffff"/>
         <circle cx="20" cy="18" r="2.6" fill="#fff"/><circle cx="52" cy="12" r="2.6" fill="#fff"/>
         <circle cx="92" cy="20" r="2.6" fill="#fff"/><circle cx="72" cy="10" r="2.2" fill="#fff"/>`,
        '#b9d4e8',
      );
    case 'swamp':
      return B(
        `<ellipse cx="60" cy="72" rx="58" ry="18" fill="#4a6b3a"/>
         <ellipse cx="44" cy="66" rx="16" ry="5" fill="#6fa050"/>
         <ellipse cx="84" cy="72" rx="12" ry="4" fill="#6fa050"/>
         <circle cx="66" cy="56" r="5" fill="#88b868"/><circle cx="74" cy="50" r="3.4" fill="#88b868"/>
         <path d="M20 60 V36 m0 6 c-8 -2 -10 -10 -8 -14 c8 0 12 6 8 14" stroke="#3c5a2e" stroke-width="4" fill="none" stroke-linecap="round"/>`,
        '#8aa678',
      );
    case 'volcano':
      return B(
        `<path d="M14 80 L48 22 L60 34 L74 18 L110 80 Z" fill="#5a4038"/>
         <path d="M48 22 L60 34 L74 18 L68 12 L54 14 Z" fill="#ff5a2f"/>
         <path d="M60 34 C58 48 64 58 60 72" stroke="#ff7a2f" stroke-width="6" fill="none" stroke-linecap="round"/>
         <circle cx="58" cy="8" r="6" fill="#8a8073"/><circle cx="70" cy="6" r="4" fill="#a89e90"/>`,
        '#f2b98a',
      );
  }
}

export function createLobbyScreen(): Screen<GameFacade> {
  let root: HTMLElement | null = null;
  let selectedIdx = 0;
  let endlessOn = false;

  return {
    enter(facade) {
      const p = facade.profile;

      // --- 스테이지 카드들 -------------------------------------------------
      const cards = STAGE_META.map((meta) => {
        const unlocked = p.isStageUnlocked(meta.id);
        const prog = p.stageProgress(meta.id);
        const progressText = prog.cleared
          ? t('lobby.cleared')
          : prog.bestWave > 0
            ? t('lobby.progress', { n: prog.bestWave, m: meta.waveCount })
            : t('lobby.notStarted');
        return h(
          'div',
          { class: `stage-card biome--${meta.biome}${unlocked ? '' : ' is-locked'}` },
          h('div', { class: 'stage-card-no', text: t('lobby.stageNo', { n: meta.id }) }),
          h('div', { class: 'stage-card-art', html: biomeSvg(meta.biome) }),
          h('div', { class: 'stage-card-name', text: t(`stage.${meta.id}.name`) }),
          unlocked
            ? h('div', { class: `stage-card-prog${prog.cleared ? ' is-cleared' : ''}`, text: progressText })
            : h(
                'div',
                { class: 'stage-card-lock' },
                h('span', { class: 'stage-lock-ico', html: lockSvg }),
                h('span', { text: t('lobby.locked', { n: meta.id - 1 }) }),
              ),
          prog.endlessBest > 0
            ? h('div', { class: 'stage-card-endless', text: `∞ ${t('lobby.endlessBest', { n: prog.endlessBest })}` })
            : null,
        );
      });

      const carousel = h('div', { class: 'carousel' }, ...cards);
      const dots = STAGE_META.map((_, i) => h('span', { class: `dot${i === 0 ? ' is-on' : ''}` }));

      // --- 하단 버튼/무한 토글 --------------------------------------------
      const battleLabel = h('span', { text: t('lobby.battle') });
      const battleBtn = h(
        'button',
        {
          class: 'btn btn--primary btn--battle',
          attrs: { type: 'button' },
          onClick: () => {
            const meta = STAGE_META[selectedIdx];
            if (!meta || !p.isStageUnlocked(meta.id)) return;
            facade.startBattle(meta.id, endlessOn && p.stageProgress(meta.id).cleared);
          },
        },
        battleLabel,
      );

      const endlessBtn = h('button', {
        class: 'chip chip--endless',
        attrs: { type: 'button' },
        text: `∞ ${t('lobby.endless')}`,
        onClick: () => {
          endlessOn = !endlessOn;
          syncButtons();
        },
      });

      const syncButtons = (): void => {
        const meta = STAGE_META[selectedIdx];
        if (!meta) return;
        const unlocked = p.isStageUnlocked(meta.id);
        const cleared = p.stageProgress(meta.id).cleared;
        cls(battleBtn, 'is-disabled', !unlocked);
        // 무한 토글: 무한 해금 && 해당 스테이지 클리어 시에만 노출/활성
        endlessBtn.style.display = p.isEndlessUnlocked() ? '' : 'none';
        cls(endlessBtn, 'is-disabled', !cleared);
        cls(endlessBtn, 'is-on', endlessOn && cleared);
        battleLabel.textContent = endlessOn && cleared ? `∞ ${t('lobby.endless')}` : t('lobby.battle');
        dots.forEach((d, i) => cls(d, 'is-on', i === selectedIdx));
      };

      // --- 캐러셀 스크롤 → 선택 인덱스 ------------------------------------
      let scrollRaf = 0;
      carousel.addEventListener('scroll', () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          const first = cards[0];
          if (!first) return;
          const step = first.offsetWidth + 14; // gap과 동기 (css --carousel-gap)
          const idx = Math.round(carousel.scrollLeft / step);
          if (idx !== selectedIdx && idx >= 0 && idx < cards.length) {
            selectedIdx = idx;
            syncButtons();
          }
        });
      });
      const scrollToIdx = (idx: number): void => {
        const target = cards[idx];
        if (!target) return;
        carousel.scrollTo({ left: target.offsetLeft - carousel.offsetLeft, behavior: 'smooth' });
      };
      const arrow = (dir: -1 | 1): HTMLElement =>
        h('button', {
          class: `car-arrow car-arrow--${dir < 0 ? 'l' : 'r'}`,
          attrs: { type: 'button', 'aria-label': dir < 0 ? '◀' : '▶' },
          text: dir < 0 ? '◀' : '▶',
          onClick: () => scrollToIdx(Math.max(0, Math.min(cards.length - 1, selectedIdx + dir))),
        });

      root = h(
        'div',
        { class: 'screen screen--lobby' },
        h(
          'div',
          { class: 'col lobby-col' },
          // 상단 바
          h(
            'div',
            { class: 'topbar' },
            h('div', { class: 'pill pill--amber' },
              h('span', { class: 'pill-ico', html: amberSvg }),
              h('span', { class: 'pill-num', text: fmt(p.data.amber) }),
            ),
            h('div', { class: 'topbar-title', text: t('app.name') }),
            h('button', {
              class: 'icon-btn',
              attrs: { type: 'button', 'aria-label': t('lobby.settings') },
              text: '⚙',
              onClick: () => facade.goto('settings'),
            }),
          ),
          // 캐러셀
          h('div', { class: 'carousel-wrap' }, carousel, arrow(-1), arrow(1)),
          h('div', { class: 'dots' }, ...dots),
          // 하단
          h(
            'div',
            { class: 'lobby-bottom' },
            endlessBtn,
            h(
              'div',
              { class: 'lobby-btnrow' },
              h('button', {
                class: 'btn btn--wood btn--collection',
                attrs: { type: 'button' },
                text: `📖 ${t('lobby.collection')}`,
                onClick: () => facade.goto('collection'),
              }),
              battleBtn,
            ),
          ),
        ),
      );
      mount(uiRoot(), root);
      syncButtons();
    },
    exit() {
      if (root) {
        clearChildren(root);
        unmount(root);
      }
      root = null;
    },
  };
}
