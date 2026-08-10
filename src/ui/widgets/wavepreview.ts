/**
 * 웨이브 미리보기 띠 — **prep 전용**, `hud-bottom`의 웨이브 호출 버튼 바로 위.
 *
 * ── 왜 여기 있는가 ──────────────────────────────────────────────────────────
 * 사용자 진단 (1)은 "정보가 없다"였다. 다음에 무엇이 오는지 알 방법이 화면 어디에도
 * 없어서 **모르는 것을 대비할 수 없었다.** 상성을 아무리 정교하게 만들어도 읽을 수
 * 없으면 전략이 아니다 — 그래서 상성 수치를 넣기 **전에** 읽을 자리부터 만든다.
 *
 * ── 왜 hud-top이 아닌가 (세로 예산) ─────────────────────────────────────────
 * `hud-top-row`는 390px에서 이미 포화다(일시정지 44px + 웨이브 배지 + 칩 3개).
 * 거기에 얹으면 `battlecontroller.HUD_TOP_PX`를 **영구히** 키워 전투 중에도
 * 플레이필드를 깎는다. 이 띠는 prep에만 존재하고, prep에만 존재하는 웨이브 호출
 * 버튼과 **세로 예산을 나눠 쓴다** — 그래서 HUD_TOP_PX는 한 자리도 안 건드린다.
 *
 * ── 세 층 ──────────────────────────────────────────────────────────────────
 *  1. 칩 (접힘 기본, 한 줄) — `[적 아이콘] ×N [배지]`. **적 이름을 쓰지 않는다**:
 *     '안킬로사우루스'·'부족 주술 저주사'는 390px에서 깨진다. 이름은 상세에만.
 *  2. 수요 막대 (펼침) — demand[t] = Σ(hp×eff)/Σhp. **내 덱에 있는 타워만.**
 *     못 때리는 것은 0으로 세므로 막대 하나가 상성과 대공을 함께 말한다.
 *  3. 상세 (칩 탭) — 이름 / 특성 한 줄 / **내 덱 안의** 잘 듣는 것과 안 듣는 것.
 *     *없는 답을 알려주는 것은 정보가 아니라 좌절이다.*
 */
import type { BattleStateView, EnemyId, TowerId, WavePreview, WavePreviewEntry } from '@/data/types';
import { DEMAND_WEAK, TOWER_DEFS, demandFor, isAttackTower, towerEffVs } from '@/data';
import { h, cls, setText } from '../dom';
import { t } from '../i18n';
import { enemyIconSvg, towerIconSvg, traitIconSvg } from './card';

/** 칩 상한 — 넘치면 `+N종`으로 접는다 (390px에서 한 줄에 들어가는 한계) */
export const MAX_CHIPS = 6;
/** 상세의 "잘 듣는 것"에 넣을 최대 개수 */
const MAX_GOOD = 3;
/** 상세에서 "잘 듣는다"로 치는 배율 하한 */
const GOOD_EFF = 0.9;

export interface WavePreviewBand {
  el: HTMLElement;
  /** 매 프레임 폴링 갱신. prep이 아니면 통째로 숨긴다 */
  update(state: BattleStateView, preview: WavePreview | null): void;
  /** 화면 이탈/전투 종료 시 상태 초기화 */
  reset(): void;
}

/**
 * 타워의 **대표 티어** — 이미 세워 둔 같은 종의 최고 티어(없으면 T1).
 * 왜 이 정의인가: 수요 막대는 "지금 내가 가진 답이 이번 웨이브에 얼마나 듣는가"를
 * 말해야 한다. 항상 T1로 계산하면 다 키운 판에서 막대가 실제보다 짧게 나오고,
 * 항상 최대 티어로 계산하면 아직 못 산 화력을 있다고 말한다.
 * (별 보너스는 안 본다 — 별이 있으면 실제 배율은 이 값보다 **좋다**.
 *  화면이 과소평가하는 방향이라 안전하다.)
 */
function repTier(state: BattleStateView, id: TowerId): number {
  let tier = 0;
  for (const tw of state.towers) if (tw.defId === id && tw.tier > tier) tier = tw.tier;
  return tier;
}

/** 특성 배지 한 개 (아이콘 + 짧은 낱말). 장갑만 수치를 함께 쓴다 */
function badgeOf(e: WavePreviewEntry): HTMLElement | null {
  const tag = e.traits[0];
  if (!tag) return null;
  const label = tag === 'armor' ? `${t('trait.armor.name')}${e.armor}` : t(`trait.${tag}.name`);
  return h('span', { class: `wp-badge wp-badge--${tag}` },
    h('span', { class: 'wp-badge-ico', html: traitIconSvg(tag) }),
    h('span', { class: 'wp-badge-txt', text: label }),
  );
}

export function createWavePreview(): WavePreviewBand {
  let expanded = false;
  let selected: EnemyId | null = null;
  /** 다시 그릴 필요가 있는지 판단하는 서명 — 매 프레임 DOM을 다시 만들지 않는다 */
  let sig = '';
  /** 종 → 칩 버튼 (선택 표시를 문자열 비교 없이 갱신한다) */
  const chipOf = new Map<EnemyId, HTMLElement>();

  const waveNum = h('span', { class: 'wp-wave' });
  const chips = h('div', { class: 'wp-chips' });
  const toggle = h('button', {
    class: 'wp-toggle hud-item',
    attrs: { type: 'button', 'aria-label': t('battle.preview.expand') },
    text: '▾',
    onClick: () => {
      expanded = !expanded;
      if (!expanded) selected = null;
      applyOpen();
    },
  });

  const bars = h('div', { class: 'wp-bars' });
  const detail = h('div', { class: 'wp-detail' });
  const body = h('div', { class: 'wp-body' }, bars, detail);

  const el = h('div', { class: 'wave-preview', attrs: { style: 'display:none' } },
    h('div', { class: 'wp-head' },
      h('span', { class: 'wp-title', text: t('battle.preview.title') }),
      waveNum,
      chips,
      toggle,
    ),
    body,
  );

  const applyOpen = (): void => {
    cls(el, 'is-open', expanded);
    body.style.display = expanded ? '' : 'none';
    setText(toggle, expanded ? '▴' : '▾');
    toggle.setAttribute(
      'aria-label',
      expanded ? t('battle.preview.collapse') : t('battle.preview.expand'),
    );
    detail.style.display = selected ? '' : 'none';
    for (const [id, btn] of chipOf) cls(btn, 'is-sel', id === selected);
  };

  /** 상세 — 이름 / 특성 한 줄 / 내 덱 안의 잘 듣는 것 · 안 듣는 것 */
  const renderDetail = (state: BattleStateView, e: WavePreviewEntry): void => {
    const rows: { id: TowerId; eff: number }[] = [];
    for (const id of state.deck) {
      const def = TOWER_DEFS[id];
      if (!isAttackTower(def)) continue;
      rows.push({ id, eff: towerEffVs(def, repTier(state, id), e) });
    }
    rows.sort((a, b) => b.eff - a.eff || (a.id < b.id ? -1 : 1));
    const good = rows.filter((r) => r.eff >= GOOD_EFF).slice(0, MAX_GOOD);
    const bad = rows.filter((r) => r.eff < DEMAND_WEAK);
    const tag = e.traits[0];
    const twChip = (r: { id: TowerId; eff: number }): HTMLElement =>
      h('span', { class: 'wp-d-tw' },
        h('span', { class: 'wp-d-tw-ico', html: towerIconSvg(r.id) }),
        h('span', { class: 'wp-d-tw-name', text: t(`tower.${r.id}.name`) }),
        h('span', { class: 'wp-d-tw-eff', text: r.eff.toFixed(2) }),
      );
    const kids: HTMLElement[] = [
      h('div', { class: 'wp-d-head' },
        h('span', { class: 'wp-d-name', text: t(`enemy.${e.defId}.name`) }),
        h('span', {
          class: 'wp-d-hp',
          text: t('battle.preview.hp', { n: `${e.maxHp}`, c: `${e.count}` }),
        }),
      ),
      h('div', {
        class: 'wp-d-trait',
        text: tag
          ? tag === 'armor'
            ? t('trait.armor.desc', { n: e.armor })
            : t(`trait.${tag}.desc`)
          : t('battle.preview.plain'),
      }),
      h('div', { class: 'wp-d-row' },
        h('span', { class: 'wp-d-label', text: t('battle.preview.good') }),
        ...(good.length > 0
          ? good.map(twChip)
          : [h('span', { class: 'wp-d-none', text: t('battle.preview.noAnswer') })]),
      ),
    ];
    if (bad.length > 0) {
      kids.push(
        h('div', { class: 'wp-d-row wp-d-row--bad' },
          h('span', { class: 'wp-d-label', text: t('battle.preview.bad') }),
          ...bad.map(twChip),
        ),
      );
    }
    detail.replaceChildren(...kids);
  };

  const rebuild = (state: BattleStateView, p: WavePreview): void => {
    setText(waveNum, `${p.wave}`);
    // --- 칩 ---------------------------------------------------------------
    chipOf.clear();
    const shown = p.entries.slice(0, MAX_CHIPS);
    const rest = p.entries.length - shown.length;
    const chipEls: HTMLElement[] = shown.map((e) => {
      const label = `${t(`enemy.${e.defId}.name`)} ×${e.count}`;
      const btn = h('button', {
        class: 'wp-chip hud-item',
        attrs: { type: 'button', 'aria-label': label, title: label },
        onClick: () => {
          selected = selected === e.defId ? null : e.defId;
          if (selected) {
            expanded = true;
            renderDetail(state, e);
          }
          applyOpen();
        },
      },
        h('span', { class: 'wp-chip-ico', html: enemyIconSvg(e.defId) }),
        h('span', { class: 'wp-chip-n', text: `×${e.count}` }),
      );
      const badge = badgeOf(e);
      if (badge) btn.appendChild(badge);
      cls(btn, 'is-boss', e.boss);
      chipOf.set(e.defId, btn);
      return btn;
    });
    if (rest > 0) chipEls.push(h('span', { class: 'wp-more', text: t('battle.preview.more', { n: rest }) }));
    chips.replaceChildren(...chipEls);

    // --- 수요 막대 (내 덱에 있는, 실제로 때리는 타워만) ----------------------
    const barEls: HTMLElement[] = [];
    for (const id of state.deck) {
      const def = TOWER_DEFS[id];
      if (!isAttackTower(def)) continue; // 전쟁북은 분모가 정의되지 않는다
      const d = demandFor(def, repTier(state, id), p.entries);
      const fill = h('div', { class: 'wp-bar-fill' });
      fill.style.width = `${Math.round(d * 100)}%`;
      const row = h('div', {
        class: 'wp-bar',
        attrs: { title: `${t(`tower.${id}.name`)} ${d.toFixed(2)}` },
      },
        h('span', { class: 'wp-bar-ico', html: towerIconSvg(id) }),
        h('div', { class: 'wp-bar-track' }, fill),
        h('span', { class: 'wp-bar-val', text: d.toFixed(2) }),
      );
      cls(row, 'is-weak', d < DEMAND_WEAK);
      barEls.push(row);
    }
    bars.replaceChildren(
      h('span', { class: 'wp-bars-label', text: t('battle.preview.demand') }),
      ...barEls,
    );

    // 웨이브가 바뀌면 열려 있던 상세의 대상이 사라졌을 수 있다
    const still = selected ? p.entries.find((e) => e.defId === selected) : undefined;
    if (still) renderDetail(state, still);
    else selected = null;
    applyOpen();
  };

  return {
    el,
    update(state, p) {
      const show = state.phase === 'prep' && p !== null && p.entries.length > 0;
      el.style.display = show ? '' : 'none';
      if (!show || !p) return;
      // 서명: 웨이브 + 종별 마릿수 + 내 타워의 대표 티어 (막대가 티어에 반응한다)
      const next =
        `${p.wave}|${p.entries.map((e) => `${e.defId}${e.count}`).join()}|` +
        state.deck.map((id) => repTier(state, id)).join();
      if (next === sig) return;
      sig = next;
      rebuild(state, p);
    },
    reset() {
      sig = '';
      expanded = false;
      selected = null;
      chipOf.clear();
      el.style.display = 'none';
    },
  };
}
