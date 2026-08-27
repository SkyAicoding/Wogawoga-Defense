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
import { createTowerPreview, type TowerPreview } from '../widgets/towerpreview';

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
  /**
   * 액션 미리보기 — 시트가 열려 있는 동안만 산다. 사용자 요구:
   *   > "게임 플레이 하기 전에 어떤 모양으로 던지고 터지는지 볼수 있는 메뉴"
   * ⚠ WebGL 컨텍스트를 하나 더 여므로 **시트를 닫는 모든 길**에서 반드시 버려야 한다
   *   (✕ 버튼 · 배경 탭 · 다른 타워로 갈아타기 · 화면 나가기). 하나라도 새면
   *   도감을 여닫는 것만으로 컨텍스트 상한에 걸리고, 그때 죽는 것은 **가장 오래된 캔버스**
   *   = 게임 본 화면이다. 그래서 여는 자리와 버리는 자리를 이 한 쌍으로 묶어 둔다.
   */
  let preview: TowerPreview | null = null;
  const dropPreview = (): void => {
    preview?.dispose();
    preview = null;
  };

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
      const closeSheet = (): void => {
        dropPreview();
        clearChildren(sheetHost);
      };
      const openSheet = (id: TowerId): void => {
        dropPreview(); // 다른 타워로 갈아타는 길도 여기를 지난다
        clearChildren(sheetHost);
        const tp = p.data.towers[id];
        const def = defs[id];
        const tier0 = def.tiers[0];
        /*
         * 스탯 값은 **레벨 선택기를 따라간다**. 처음엔 Lv1 고정이었는데, 미리보기에서
         * Lv5 를 골라도 "공격력 12"가 그대로라 화면이 두 가지를 동시에 말했다 —
         * 도감에서 본 숫자와 실제가 어긋나는 꼴이고, 이 저장소가 반복해서 당한 병이다.
         * 그래서 값 칸만 붙잡아 두고 `pick()` 이 다시 쓴다.
         */
        const statVals = new Map<string, HTMLElement>();
        const statRow = (key: string, label: string, value: string): HTMLElement => {
          const v = h('span', { class: 'sheet-stat-v', text: value });
          statVals.set(key, v);
          return h('div', { class: 'sheet-stat' },
            h('span', { class: 'sheet-stat-k', text: label }),
            v,
          );
        };
        /** 그 레벨의 스탯 넷을 다시 쓴다 (없는 축은 —) */
        const writeStats = (n: number): void => {
          const tr = def.tiers[n];
          const atk = (tr?.dmg ?? 0) > 0;
          const set = (k: string, s: string): void => {
            const el = statVals.get(k);
            if (el) el.textContent = s;
          };
          set('dmg', atk && tr ? String(tr.dmg) : '—');
          set('rate', atk && tr ? t('collection.statRateUnit', { n: (TICK_RATE / tr.cooldownTicks).toFixed(1) }) : '—');
          set('range', tr ? String(tr.range) : '—');
          set('cost', tr ? String(tr.cost) : '—');
        };

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

        /*
         * ── 미리보기 + 레벨 선택기 ────────────────────────────────────────────
         * 레벨은 **판에서 강화할 수 있는 다섯 단계**(Lv1~Lv5)다. 별(★)과는 다른 축이라
         * 따로 고른다 — 별은 영구 보너스이고 레벨은 판 안에서 골드로 올리는 것이다.
         * 여기서 보여 주는 것은 **레벨**이다: 사용자가 물은 것이 "어떤 모양으로 던지고
         * 터지는지"이고, 모양을 바꾸는 축이 레벨이기 때문이다(별은 수치만 바꾼다).
         */
        /*
         * ⚠ **잠긴 타워도 보여 준다.** 처음엔 해금한 것만 붙였다("잠긴 것을 보여 주면
         *   광고가 된다"는 내 판단이었다). 사용자가 물렸다: "스테이지 안 열린것은 못 보내?"
         *   맞는 지적이다 — **안 열린 것이야말로 궁금한 것**이고, 도감의 뜻이 원래 그거다.
         *   해금 조건은 아래 `action` 이 따로 말하므로 정보가 겹치지도 않는다.
         */
        let previewBlock: HTMLElement | null = null;
        {
          if (!preview) preview = createTowerPreview();
          const pv = preview;
          const lvBtns: HTMLElement[] = [];
          const pick = (n: number): void => {
            pv.show(def, n);
            writeStats(n); // 숫자도 같이 간다 — 화면이 두 가지를 동시에 말하면 안 된다
            lvBtns.forEach((b, i) => b.classList.toggle('is-on', i === n));
          };
          for (let n = 0; n < def.tiers.length; n++) {
            const b = h('button', {
              class: `tp-lv-btn${n === 0 ? ' is-on' : ''}`,
              attrs: { type: 'button' },
              text: t('battle.lv', { n: n + 1 }),
              onClick: () => pick(n),
            });
            lvBtns.push(b);
          }
          previewBlock = h('div', { class: 'tp-block' },
            h('div', { class: 'tp-caption', text: t('collection.previewTitle') }),
            pv.el,
            h('div', { class: 'tp-lv-row' }, ...lvBtns),
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
            onClick: closeSheet,
          }),
          h('div', { class: 'sheet-head' },
            h('div', { class: 'sheet-ico', html: towerIconSvg(id) }),
            h('div', { class: 'sheet-head-txt' },
              h('div', { class: 'sheet-name', text: t(def.nameKey) }),
              starsRow(tp.stars, 'sheet-stars'),
            ),
          ),
          h('div', { class: 'sheet-desc', text: t(def.descKey) }),
          /*
           * **액션 미리보기** — 해금한 타워에만 붙인다. 잠긴 타워는 판에 세울 수 없으므로
           * 동작을 보여 주는 것이 정보가 아니라 광고가 된다(해금 조건 안내가 그 자리의 뜻이다).
           */
          previewBlock,
          h('div', { class: 'sheet-stats' },
            statRow('dmg', t('collection.statDmg'), hasAttack && tier0 ? String(tier0.dmg) : '—'),
            statRow(
              'rate',
              t('collection.statRate'),
              hasAttack && tier0
                ? t('collection.statRateUnit', { n: (TICK_RATE / tier0.cooldownTicks).toFixed(1) })
                : '—',
            ),
            statRow('range', t('collection.statRange'), tier0 ? String(tier0.range) : '—'),
            statRow('cost', t('collection.statCost'), tier0 ? String(tier0.cost) : '—'),
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
            if (e.target === e.currentTarget) closeSheet();
          } }, sheet),
        );
        // 미리보기는 **DOM 에 붙은 뒤에** 켠다 — 캔버스 크기를 재야 카메라가 잡힌다
        preview?.show(def, 0);
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
      dropPreview();
      if (root) unmount(root);
      root = null;
    },
  };
}
