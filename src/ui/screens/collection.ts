/**
 * 도감 — 타워 그리드(별/조각 진행) + 탭 시 상세 시트(스탯/별 강화/해금).
 * 타워 스탯·비용은 data 트랙 소유(TowerDef)라 GameFacade로 접근 불가 →
 * 표시용 로컬 테이블 사용 (contractIssues 보고 대상, 통합 시 TowerDef로 대체).
 */
import type { GameFacade, TowerId } from '@/data/types';
import type { Screen } from '@/core/fsm';
import { h, cls, fmt, mount, unmount, uiRoot, clearChildren } from '../dom';
import { t } from '../i18n';
import { amberSvg, starSvg, towerIconSvg, lockSvg } from '../widgets/card';

const ALL_TOWERS: readonly TowerId[] = [
  'spear', 'catapult', 'lightning', 'brazier', 'frost', 'poison', 'ballista', 'drum',
];

interface TowerDisplayMeta {
  dmg: number;
  /** 초당 공격 횟수 (오라는 2/s 고정) */
  rate: number;
  range: number;
  cost: number;
  /** 별 n+1개가 되기 위한 [조각, 호박] */
  starCosts: [number, number][];
  starBonus: { dmgPct: number; ratePct: number };
  /** 호박 해금 타워만 값 존재 */
  unlockAmber?: number;
}

const DEFAULT_STAR_COSTS: [number, number][] = [
  [5, 60], [10, 150], [20, 350], [40, 700], [80, 1400],
];

/** 표시용 밸런스 근사값 — 실제 수치는 통합 때 TowerDef에서 읽는다 */
const META: Record<TowerId, TowerDisplayMeta> = {
  spear: { dmg: 12, rate: 1.5, range: 3.2, cost: 60, starCosts: DEFAULT_STAR_COSTS, starBonus: { dmgPct: 10, ratePct: 5 } },
  catapult: { dmg: 30, rate: 0.5, range: 4.0, cost: 90, starCosts: DEFAULT_STAR_COSTS, starBonus: { dmgPct: 12, ratePct: 4 } },
  lightning: { dmg: 18, rate: 0.8, range: 3.4, cost: 110, starCosts: DEFAULT_STAR_COSTS, starBonus: { dmgPct: 10, ratePct: 6 } },
  brazier: { dmg: 6, rate: 2, range: 1.8, cost: 70, starCosts: DEFAULT_STAR_COSTS, starBonus: { dmgPct: 12, ratePct: 0 } },
  frost: { dmg: 8, rate: 0.9, range: 3.0, cost: 80, starCosts: DEFAULT_STAR_COSTS, starBonus: { dmgPct: 8, ratePct: 6 } },
  poison: { dmg: 10, rate: 1.0, range: 3.2, cost: 85, starCosts: DEFAULT_STAR_COSTS, starBonus: { dmgPct: 10, ratePct: 5 }, unlockAmber: 300 },
  ballista: { dmg: 60, rate: 0.4, range: 5.0, cost: 140, starCosts: DEFAULT_STAR_COSTS, starBonus: { dmgPct: 14, ratePct: 4 } },
  drum: { dmg: 0, rate: 0, range: 2.2, cost: 100, starCosts: DEFAULT_STAR_COSTS, starBonus: { dmgPct: 6, ratePct: 6 }, unlockAmber: 500 },
};

function starsRow(stars: number, cl: string): HTMLElement {
  const row = h('div', { class: cl });
  for (let i = 0; i < 5; i++) {
    row.appendChild(h('span', { class: 'star', html: starSvg(i < stars) }));
  }
  return row;
}

export function createCollectionScreen(): Screen<GameFacade> {
  let root: HTMLElement | null = null;

  return {
    enter(facade) {
      const p = facade.profile;
      const amberNum = h('span', { class: 'pill-num', text: fmt(p.data.amber) });
      const grid = h('div', { class: 'coll-grid' });
      const sheetHost = h('div', { class: 'sheet-host' });

      const refreshAmber = (): void => {
        amberNum.textContent = fmt(p.data.amber);
      };

      // --- 그리드 렌더 -----------------------------------------------------
      const renderGrid = (): void => {
        clearChildren(grid);
        for (const id of ALL_TOWERS) {
          const tp = p.data.towers[id];
          const meta = META[id];
          const nextCost = tp.stars < 5 ? meta.starCosts[tp.stars] : null;
          const cell = h(
            'button',
            {
              class: `coll-cell${tp.unlocked ? '' : ' is-locked'}`,
              attrs: { type: 'button' },
              onClick: () => openSheet(id),
            },
            h('div', { class: 'coll-ico', html: towerIconSvg(id) }),
            h('div', { class: 'coll-name', text: t(`tower.${id}.name`) }),
            tp.unlocked ? starsRow(tp.stars, 'coll-stars') : h('div', { class: 'coll-lockrow' },
              h('span', { class: 'coll-lock-ico', html: lockSvg }),
              h('span', { text: t('collection.locked') }),
            ),
            tp.unlocked && nextCost
              ? h(
                  'div',
                  { class: 'coll-shardbar' },
                  h('div', {
                    class: 'coll-shardfill',
                    attrs: { style: `width:${Math.min(100, (tp.shards / nextCost[0]) * 100)}%` },
                  }),
                  h('span', { class: 'coll-shardtxt', text: t('collection.shards', { n: tp.shards, m: nextCost[0] }) }),
                )
              : null,
          );
          grid.appendChild(cell);
        }
      };

      // --- 상세 시트 -------------------------------------------------------
      const openSheet = (id: TowerId): void => {
        clearChildren(sheetHost);
        const tp = p.data.towers[id];
        const meta = META[id];
        const statRow = (label: string, value: string): HTMLElement =>
          h('div', { class: 'sheet-stat' },
            h('span', { class: 'sheet-stat-k', text: label }),
            h('span', { class: 'sheet-stat-v', text: value }),
          );

        let action: HTMLElement;
        if (!tp.unlocked) {
          action = meta.unlockAmber !== undefined
            ? h('button', {
                class: `btn btn--primary sheet-action${p.data.amber < meta.unlockAmber ? ' is-disabled' : ''}`,
                attrs: { type: 'button' },
                onClick: () => {
                  if (p.unlockTower(id)) {
                    refreshAmber();
                    renderGrid();
                    openSheet(id);
                  }
                },
              },
              h('span', { text: `${t('collection.unlock')} · ` }),
              h('span', { class: 'inline-ico', html: amberSvg }),
              h('span', { text: t('collection.unlockAmber', { a: meta.unlockAmber }) }),
            )
            : h('div', { class: 'sheet-hint', text: t('collection.unlockStage') });
        } else if (tp.stars >= 5) {
          action = h('div', { class: 'sheet-hint sheet-hint--max', text: t('collection.maxStar') });
        } else {
          const cost = meta.starCosts[tp.stars];
          const [s, a] = cost ?? [0, 0];
          const afford = tp.shards >= s && p.data.amber >= a;
          action = h('button', {
            class: `btn btn--primary sheet-action${afford ? '' : ' is-disabled'}`,
            attrs: { type: 'button' },
            onClick: () => {
              if (p.starUp(id)) {
                refreshAmber();
                renderGrid();
                openSheet(id);
              }
            },
          },
          h('span', { text: `⭐ ${t('collection.starUp')}` }),
          h('span', { class: 'sheet-action-cost', text: t('collection.cost', { s, a }) }),
          );
        }

        const sheet = h(
          'div',
          { class: 'sheet' },
          h('button', {
            class: 'sheet-close',
            attrs: { type: 'button', 'aria-label': t('common.back') },
            text: '✕',
            onClick: () => clearChildren(sheetHost),
          }),
          h('div', { class: 'sheet-head' },
            h('div', { class: 'sheet-ico', html: towerIconSvg(id) }),
            h('div', { class: 'sheet-head-txt' },
              h('div', { class: 'sheet-name', text: t(`tower.${id}.name`) }),
              starsRow(tp.stars, 'sheet-stars'),
            ),
          ),
          h('div', { class: 'sheet-desc', text: t(`tower.${id}.desc`) }),
          h('div', { class: 'sheet-stats' },
            statRow(t('collection.statDmg'), meta.dmg > 0 ? String(meta.dmg) : '—'),
            statRow(t('collection.statRate'), meta.rate > 0 ? t('collection.statRateUnit', { n: meta.rate }) : '—'),
            statRow(t('collection.statRange'), String(meta.range)),
            statRow(t('collection.statCost'), String(meta.cost)),
          ),
          h('div', { class: 'sheet-bonus' },
            h('span', { class: 'sheet-bonus-k', text: t('collection.starBonusTitle') }),
            h('span', {
              class: 'sheet-bonus-v',
              text: t('collection.starBonus', { d: meta.starBonus.dmgPct, r: meta.starBonus.ratePct }),
            }),
          ),
          action,
        );
        sheetHost.appendChild(
          h('div', { class: 'sheet-backdrop', onClick: (e) => {
            if (e.target === e.currentTarget) clearChildren(sheetHost);
          } }, sheet),
        );
      };

      root = h(
        'div',
        { class: 'screen screen--collection' },
        h(
          'div',
          { class: 'col' },
          h('div', { class: 'topbar' },
            h('button', {
              class: 'icon-btn',
              attrs: { type: 'button', 'aria-label': t('common.back') },
              text: '←',
              onClick: () => facade.goto('lobby'),
            }),
            h('div', { class: 'topbar-title', text: t('collection.title') }),
            h('div', { class: 'pill pill--amber' },
              h('span', { class: 'pill-ico', html: amberSvg }),
              amberNum,
            ),
          ),
          h('div', { class: 'coll-scroll' }, grid),
        ),
        sheetHost,
      );
      renderGrid();
      mount(uiRoot(), root);
    },
    exit() {
      if (root) unmount(root);
      root = null;
    },
  };
}
