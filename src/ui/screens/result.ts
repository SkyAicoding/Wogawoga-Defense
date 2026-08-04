/**
 * 결과 화면 — 승리(별 3개 팡파레)/패배, 보상 카운트업 애니메이션.
 * facade.lastResult 사용. 카운트업은 update(dt)에서 이징으로 진행한다.
 */
import type { GameFacade, ResultSummary, TowerId } from '@/data/types';
import type { Screen } from '@/core/fsm';
import { easeOutCubic, clamp01 } from '@/core/mathx';
import { h, fmt, mount, unmount, uiRoot } from '../dom';
import { t } from '../i18n';
import { amberSvg, starSvg, towerIconSvg } from '../widgets/card';

const MAX_STAGE = 6;
const COUNTUP_SECS = 1.2;

export function createResultScreen(): Screen<GameFacade> {
  let root: HTMLElement | null = null;
  let elapsed = 0;
  let amberEl: HTMLElement | null = null;
  let killsEl: HTMLElement | null = null;
  let shardEls: { el: HTMLElement; target: number }[] = [];
  let result: ResultSummary | null = null;

  return {
    enter(facade) {
      elapsed = 0;
      result = facade.lastResult;
      const r: ResultSummary = result ?? {
        won: false, stageId: 1, wave: 0, waveCount: 50, amberEarned: 0,
        shardsEarned: {}, firstClear: false, endless: false, kills: 0,
      };

      amberEl = h('span', { class: 'res-num', text: '0' });
      killsEl = h('span', { class: 'res-num res-num--sm', text: '0' });

      // 별 3개 (승리 시 팡파레 팝, 패배 시 어둡게)
      const stars = h('div', { class: `res-stars${r.won ? ' is-won' : ''}` },
        ...[0, 1, 2].map((i) =>
          h('span', {
            class: 'res-star',
            attrs: { style: `animation-delay:${0.25 + i * 0.3}s` },
            html: starSvg(r.won),
          }),
        ),
      );

      // 타워 조각 목록
      shardEls = [];
      const shardEntries = Object.entries(r.shardsEarned) as [TowerId, number][];
      const shardList = h('div', { class: 'res-shards' },
        ...shardEntries.map(([id, n]) => {
          const numEl = h('span', { class: 'res-shard-num', text: '+0' });
          shardEls.push({ el: numEl, target: n });
          return h('div', { class: 'res-shard' },
            h('span', { class: 'res-shard-ico', html: towerIconSvg(id) }), numEl);
        }),
      );

      const nextOk =
        r.won && !r.endless && r.stageId < MAX_STAGE && facade.profile.isStageUnlocked(r.stageId + 1);

      const buttons = h('div', { class: 'res-btns' },
        h('button', {
          class: 'btn btn--wood', attrs: { type: 'button' }, text: t('result.lobby'),
          onClick: () => facade.goto('lobby'),
        }),
        h('button', {
          class: `btn ${nextOk ? 'btn--wood' : 'btn--primary'}`,
          attrs: { type: 'button' }, text: t('result.retry'),
          onClick: () => facade.startBattle(r.stageId, r.endless),
        }),
        nextOk
          ? h('button', {
              class: 'btn btn--primary', attrs: { type: 'button' }, text: `${t('result.next')} ▶`,
              onClick: () => facade.startBattle(r.stageId + 1, false),
            })
          : null,
      );

      root = h('div', { class: `screen screen--result ${r.won ? 'is-won' : 'is-lost'}` },
        h('div', { class: 'col res-col' },
          h('div', { class: 'res-burst', attrs: { 'aria-hidden': 'true' } }),
          stars,
          h('div', { class: 'res-title', text: r.won ? t('result.victory') : t('result.defeat') }),
          r.endless ? h('div', { class: 'res-tag', text: `∞ ${t('result.endless')}` }) : null,
          r.firstClear ? h('div', { class: 'res-tag res-tag--first', text: `🎉 ${t('result.firstClear')}` }) : null,
          h('div', { class: 'res-panel' },
            h('div', { class: 'res-row' },
              h('span', { class: 'res-label', text: t('result.wave') }),
              h('span', { class: 'res-num res-num--sm', text: r.endless ? `${r.wave}` : `${r.wave} / ${r.waveCount}` }),
            ),
            h('div', { class: 'res-row' },
              h('span', { class: 'res-label', text: t('result.kills') }), killsEl),
            h('div', { class: 'res-row res-row--amber' },
              h('span', { class: 'res-label' },
                h('span', { class: 'inline-ico', html: amberSvg }),
                h('span', { text: ` ${t('result.amber')}` }),
              ),
              amberEl,
            ),
            shardEntries.length > 0
              ? h('div', { class: 'res-row res-row--shards' },
                  h('span', { class: 'res-label', text: t('result.shards') }), shardList)
              : null,
          ),
          buttons,
        ),
      );
      mount(uiRoot(), root);
    },

    exit() {
      if (root) unmount(root);
      root = null;
      amberEl = null;
      killsEl = null;
      shardEls = [];
    },

    update(_facade, dt) {
      if (!root || !result) return;
      if (elapsed >= COUNTUP_SECS + 0.05) return;
      elapsed += dt;
      const p = easeOutCubic(clamp01(elapsed / COUNTUP_SECS));
      if (amberEl) amberEl.textContent = `+${fmt(result.amberEarned * p)}`;
      if (killsEl) killsEl.textContent = fmt(result.kills * p);
      for (const s of shardEls) s.el.textContent = `+${fmt(s.target * p)}`;
    },
  };
}
