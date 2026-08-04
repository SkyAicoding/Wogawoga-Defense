/**
 * 도감 — 타워 그리드(별/조각 진행) + 탭 시 상세 시트(스탯/별 강화/해금).
 * 스탯·비용·해금 조건은 전부 facade.towerDefs(TowerDef 실데이터)에서 읽는다.
 */
import type { GameFacade, TowerDef, TowerId } from '@/data/types';
import { TICK_RATE } from '@/data/types';
import type { Screen } from '@/core/fsm';
import { h, fmt, mount, unmount, uiRoot, clearChildren } from '../dom';
import { t } from '../i18n';
import { amberSvg, starSvg, towerIconSvg, lockSvg } from '../widgets/card';

function starsRow(stars: number, cl: string): HTMLElement {
  const row = h('div', { class: cl });
  for (let i = 0; i < 5; i++) {
    row.appendChild(h('span', { class: 'star', html: starSvg(i < stars) }));
  }
  return row;
}

/** 별 1개당 보너스 요약 — def.starBonus 실측값(비율 → %). 0인 항목은 생략 */
function bonusSummary(def: TowerDef): string {
  const pct = (n: number): number => Math.round(n * 100);
  const parts: string[] = [];
  if (def.starBonus.dmgPct > 0) parts.push(t('collection.bonusDmg', { n: pct(def.starBonus.dmgPct) }));
  if (def.starBonus.ratePct > 0) parts.push(t('collection.bonusRate', { n: pct(def.starBonus.ratePct) }));
  const rangePct = def.starBonus.rangePct ?? 0;
  if (rangePct > 0) parts.push(t('collection.bonusRange', { n: pct(rangePct) }));
  return parts.join(' · ');
}

/** 특수효과(스플래시/체인/상태이상/오라) 한 줄 요약 — 티어0 스펙 존재 여부 기준 */
function fxSummary(def: TowerDef): string {
  const t0 = def.tiers[0];
  if (!t0) return '';
  const parts: string[] = [];
  if (t0.splash) parts.push(t('collection.fxSplash'));
  if (t0.chain) parts.push(t('collection.fxChain'));
  const status = t0.status ?? t0.aura?.status;
  if (status) parts.push(t(`collection.fxStatus.${status.kind}`));
  if (t0.aura) {
    if (t0.aura.dmgPerStatusTick !== undefined) parts.push(t('collection.fxAuraDmg'));
    if (t0.aura.dmgPct !== undefined || t0.aura.ratePct !== undefined) {
      parts.push(t('collection.fxAuraBuff'));
    }
  }
  return parts.join(' · ');
}

/** 실패 피드백 — 흔들기 애니메이션 재시작 */
function shake(el: HTMLElement): void {
  el.classList.remove('is-shake');
  void el.offsetWidth; // 리플로우로 애니메이션 리셋
  el.classList.add('is-shake');
}

export function createCollectionScreen(): Screen<GameFacade> {
  let root: HTMLElement | null = null;

  return {
    enter(facade) {
      const p = facade.profile;
      const defs = facade.towerDefs;
      const towerIds = Object.keys(defs) as TowerId[];
      const amberNum = h('span', { class: 'pill-num', text: fmt(p.data.amber) });
      const grid = h('div', { class: 'coll-grid' });
      const sheetHost = h('div', { class: 'sheet-host' });

      const refreshAmber = (): void => {
        amberNum.textContent = fmt(p.data.amber);
      };

      // --- 그리드 렌더 -----------------------------------------------------
      const renderGrid = (): void => {
        clearChildren(grid);
        for (const id of towerIds) {
          const tp = p.data.towers[id];
          const def = defs[id];
          const nextCost = tp.stars < 5 ? def.starCosts[tp.stars] : null;
          const cell = h(
            'button',
            {
              class: `coll-cell${tp.unlocked ? '' : ' is-locked'}`,
              attrs: { type: 'button' },
              onClick: () => openSheet(id),
            },
            h('div', { class: 'coll-ico', html: towerIconSvg(id) }),
            h('div', { class: 'coll-name', text: t(def.nameKey) }),
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
        const def = defs[id];
        const tier0 = def.tiers[0];
        const statRow = (label: string, value: string): HTMLElement =>
          h('div', { class: 'sheet-stat' },
            h('span', { class: 'sheet-stat-k', text: label }),
            h('span', { class: 'sheet-stat-v', text: value }),
          );

        let action: HTMLElement;
        if (!tp.unlocked) {
          const unlock = def.unlock;
          if (unlock.type === 'amber') {
            action = h('button', {
              class: `btn btn--primary sheet-action${p.data.amber < unlock.cost ? ' is-disabled' : ''}`,
              attrs: { type: 'button' },
              onClick: (e) => {
                if (p.unlockTower(id)) {
                  refreshAmber();
                  renderGrid();
                  openSheet(id);
                } else {
                  shake(e.currentTarget as HTMLElement);
                }
              },
            },
            h('span', { class: 'sheet-action-row' },
              h('span', { text: `${t('collection.unlock')} · ` }),
              h('span', { class: 'inline-ico', html: amberSvg }),
              h('span', { text: t('collection.unlockAmber', { a: unlock.cost }) }),
            ),
            );
          } else if (unlock.type === 'stage') {
            action = h('div', { class: 'sheet-hint', text: t('collection.unlockStage', { n: unlock.stage }) });
          } else {
            // 'start'형은 프로필이 항상 해금 상태로 시작 — 도달 불가 방어 분기
            action = h('div', { class: 'sheet-hint', text: t('collection.locked') });
          }
        } else if (tp.stars >= 5) {
          action = h('div', { class: 'sheet-hint sheet-hint--max', text: t('collection.maxStar') });
        } else {
          const [s, a] = def.starCosts[tp.stars] ?? [0, 0];
          const afford = tp.shards >= s && p.data.amber >= a;
          action = h('button', {
            class: `btn btn--primary sheet-action${afford ? '' : ' is-disabled'}`,
            attrs: { type: 'button' },
            onClick: (e) => {
              if (p.starUp(id)) {
                refreshAmber();
                renderGrid();
                openSheet(id);
              } else {
                shake(e.currentTarget as HTMLElement);
              }
            },
          },
          h('span', { text: `⭐ ${t('collection.starUp')}` }),
          h('span', { class: 'sheet-action-cost', text: t('collection.cost', { s, a }) }),
          );
        }

        const hasAttack = (tier0?.dmg ?? 0) > 0;
        const bonus = bonusSummary(def);
        const fx = fxSummary(def);
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
              h('div', { class: 'sheet-name', text: t(def.nameKey) }),
              starsRow(tp.stars, 'sheet-stars'),
            ),
          ),
          h('div', { class: 'sheet-desc', text: t(def.descKey) }),
          h('div', { class: 'sheet-stats' },
            statRow(t('collection.statDmg'), hasAttack && tier0 ? String(tier0.dmg) : '—'),
            statRow(
              t('collection.statRate'),
              hasAttack && tier0
                ? t('collection.statRateUnit', { n: (TICK_RATE / tier0.cooldownTicks).toFixed(1) })
                : '—',
            ),
            statRow(t('collection.statRange'), tier0 ? String(tier0.range) : '—'),
            statRow(t('collection.statCost'), tier0 ? String(tier0.cost) : '—'),
          ),
          bonus
            ? h('div', { class: 'sheet-bonus' },
                h('span', { class: 'sheet-bonus-k', text: t('collection.starBonusTitle') }),
                h('span', { class: 'sheet-bonus-v', text: bonus }),
              )
            : null,
          fx
            ? h('div', { class: 'sheet-bonus sheet-bonus--fx' },
                h('span', { class: 'sheet-bonus-k', text: t('collection.fxTitle') }),
                h('span', { class: 'sheet-bonus-v', text: fx }),
              )
            : null,
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
