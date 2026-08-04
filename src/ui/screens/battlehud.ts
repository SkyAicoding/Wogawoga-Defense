/**
 * 전투 HUD — facade.battle! API만 사용. update()에서 sim.state를 매 프레임 폴링해
 * diff 갱신한다 (이벤트 의존 금지). 웨이브/보스 배너는 export 함수로 외부(game/fx)에서 호출.
 *
 * 선택된 타워 패널: BattleUiApi 계약에 selectedTower()/requestSetTargeting()이 없어
 * 선택 확장 인터페이스로 기능 감지한다 — 없으면 패널을 숨긴다 (contractIssues 보고).
 */
import type { BattleUiApi, GameFacade, TargetingMode, TowerState } from '@/data/types';
import { TICK_RATE } from '@/data/types';
import type { Screen } from '@/core/fsm';
import { h, cls, fmt, mount, unmount, uiRoot, setText } from '../dom';
import { t } from '../i18n';
import { amberSvg, createTowerCard, goldSvg, heartSvg, towerIconSvg } from '../widgets/card';
import type { TowerCard } from '../widgets/card';
import { showModal } from '../widgets/modal';

/** selectedTower/requestSetTargeting이 계약(BattleUiApi)에 편입됨 — 별칭만 유지 */
type BattleUiApiExt = BattleUiApi;

const TARGETING_ORDER: readonly TargetingMode[] = ['first', 'last', 'strongest', 'nearest'];

// --- 배너 (모듈 스코프 — HUD 장착 중에만 동작) -------------------------------
let bannerHost: HTMLElement | null = null;

function pushBanner(className: string, text: string): void {
  if (!bannerHost || !bannerHost.isConnected) return;
  const b = h('div', { class: `banner ${className}`, text });
  b.addEventListener('animationend', () => b.remove());
  bannerHost.appendChild(b);
}

/** 웨이브 시작 배너. final=true면 '마지막 웨이브!' 문구 */
export function showWaveBanner(wave: number, final = false): void {
  pushBanner('banner--wave', final ? t('battle.finalWaveBanner') : t('battle.waveBanner', { n: wave }));
}

/** 보스 경고 배너 */
export function showBossBanner(): void {
  pushBanner('banner--boss', t('battle.bossBanner'));
}

// ---------------------------------------------------------------------------
export function createBattleHud(): Screen<GameFacade> {
  let root: HTMLElement | null = null;

  // diff 캐시
  let handSig = '';
  let cards: TowerCard[] = [];
  let lastSelTower: number | null = null;

  // 참조 요소 (enter에서 채움)
  let waveNum!: HTMLElement;
  let goldNum!: HTMLElement;
  let amberNum!: HTMLElement;
  let hpNum!: HTMLElement;
  let hpFill!: HTMLElement;
  let speedBtn!: HTMLElement;
  let autoBtn!: HTMLElement;
  let handHost!: HTMLElement;
  let refreshLabel!: HTMLElement;
  let callWaveBtn!: HTMLElement;
  let callWaveSub!: HTMLElement;
  let panelHost!: HTMLElement;
  let panelName!: HTMLElement;
  let panelLv!: HTMLElement;
  let panelIco!: HTMLElement;
  let upBtnLabel!: HTMLElement;
  let sellBtnLabel!: HTMLElement;
  let targetBtn!: HTMLElement;
  let upBtn!: HTMLElement;

  const api = (facade: GameFacade): BattleUiApiExt | null =>
    facade.battle as BattleUiApiExt | null;

  const openPauseModal = (b: BattleUiApiExt): void => {
    b.paused = true;
    showModal({
      title: t('battle.paused'),
      body: t('battle.quitBody'),
      buttons: [
        { label: t('battle.quit'), kind: 'danger', onTap: () => b.quitToLobby() },
        { label: t('battle.resume'), kind: 'primary', onTap: () => { b.paused = false; } },
      ],
    });
  };

  const cycleTargeting = (b: BattleUiApiExt, tower: TowerState): void => {
    const idx = TARGETING_ORDER.indexOf(tower.targeting);
    const next = TARGETING_ORDER[(idx + 1) % TARGETING_ORDER.length] ?? 'first';
    b.requestSetTargeting?.(next);
  };

  return {
    enter(facade) {
      const b = api(facade);

      // --- 상단 ------------------------------------------------------------
      waveNum = h('span', { class: 'wave-num' });
      goldNum = h('span', { class: 'pill-num' });
      amberNum = h('span', { class: 'pill-num' });
      hpNum = h('span', { class: 'hp-num' });
      hpFill = h('div', { class: 'hp-fill' });

      const top = h('div', { class: 'hud-top' },
        h('div', { class: 'hud-top-row' },
          h('button', {
            class: 'icon-btn hud-item',
            attrs: { type: 'button', 'aria-label': t('battle.paused') },
            text: '❚❚',
            onClick: () => { const bb = api(facade); if (bb) openPauseModal(bb); },
          }),
          h('div', { class: 'wave-badge hud-item' },
            h('span', { class: 'wave-label', text: t('battle.wave') }), waveNum),
          h('div', { class: 'hud-top-spacer' }),
          h('div', { class: 'pill pill--gold hud-item' },
            h('span', { class: 'pill-ico', html: goldSvg }), goldNum),
          h('div', { class: 'pill pill--amber hud-item' },
            h('span', { class: 'pill-ico', html: amberSvg }), amberNum),
        ),
        h('div', { class: 'hud-hp hud-item' },
          h('span', { class: 'hp-heart', html: heartSvg }),
          h('div', { class: 'hp-bar' }, hpFill),
          hpNum,
        ),
      );

      // --- 우측 토글 -------------------------------------------------------
      speedBtn = h('button', {
        class: 'side-btn hud-item',
        attrs: { type: 'button' },
        onClick: () => {
          const bb = api(facade);
          if (bb) bb.speed = bb.speed === 1 ? 2 : bb.speed === 2 ? 4 : 1;
        },
      });
      autoBtn = h('button', {
        class: 'side-btn hud-item',
        attrs: { type: 'button' },
        text: t('battle.auto'),
        onClick: () => {
          const bb = api(facade);
          if (bb) bb.autoWave = !bb.autoWave;
        },
      });
      const side = h('div', { class: 'hud-side' }, speedBtn, autoBtn);

      // --- 배너 레이어 -----------------------------------------------------
      bannerHost = h('div', { class: 'banner-host' });

      // --- 선택 타워 패널 --------------------------------------------------
      panelName = h('span', { class: 'tp-name' });
      panelLv = h('span', { class: 'tp-lv' });
      panelIco = h('span', { class: 'tp-ico' });
      upBtnLabel = h('span', { class: 'tp-btn-label' });
      sellBtnLabel = h('span', { class: 'tp-btn-label' });
      targetBtn = h('button', {
        class: 'tp-btn tp-btn--target hud-item',
        attrs: { type: 'button' },
        onClick: () => {
          const bb = api(facade);
          const tw = selectedTowerState(bb);
          if (bb && tw) cycleTargeting(bb, tw);
        },
      });
      upBtn = h('button', {
        class: 'tp-btn tp-btn--up hud-item',
        attrs: { type: 'button' },
        onClick: () => api(facade)?.requestUpgradeSelected(),
      }, h('span', { text: `⬆ ${t('battle.upgrade')} ` }), upBtnLabel);
      const sellBtn = h('button', {
        class: 'tp-btn tp-btn--sell hud-item',
        attrs: { type: 'button' },
        onClick: () => api(facade)?.requestSellSelected(),
      }, h('span', { text: `${t('battle.sell')} ` }), sellBtnLabel);

      panelHost = h('div', { class: 'tower-panel hud-item', attrs: { style: 'display:none' } },
        h('div', { class: 'tp-head' }, panelIco, panelName, panelLv),
        h('div', { class: 'tp-btns' }, upBtn, sellBtn, targetBtn),
      );

      // --- 웨이브 시작 버튼 ------------------------------------------------
      callWaveSub = h('span', { class: 'callwave-sub' });
      callWaveBtn = h('button', {
        class: 'btn btn--primary callwave hud-item',
        attrs: { type: 'button', style: 'display:none' },
        onClick: () => api(facade)?.requestCallWave(),
      }, h('span', { class: 'callwave-main', text: `▶ ${t('battle.callWave')}` }), callWaveSub);

      // --- 하단 손패 -------------------------------------------------------
      handHost = h('div', { class: 'hand-cards' });
      refreshLabel = h('span', { class: 'refresh-label' });
      const refreshBtn = h('button', {
        class: 'refresh-btn hud-item',
        attrs: { type: 'button', 'aria-label': t('battle.refresh') },
        onClick: () => api(facade)?.requestRefresh(),
      }, h('span', { class: 'refresh-ico', text: '🔄' }), refreshLabel);

      const bottom = h('div', { class: 'hud-bottom' },
        panelHost,
        callWaveBtn,
        h('div', { class: 'hand-row hud-item' }, handHost, refreshBtn),
      );

      root = h('div', { class: 'screen screen--battle' },
        h('div', { class: 'col hud-col' }, top, bannerHost, side, bottom));
      mount(uiRoot(), root);

      // 초기 상태 반영
      handSig = '';
      lastSelTower = null;
      if (b) this.update?.(facade, 0);
    },

    exit() {
      if (root) unmount(root);
      root = null;
      bannerHost = null;
      cards = [];
      handSig = '';
    },

    update(facade) {
      const b = api(facade);
      if (!b || !root) return;
      const s = b.sim.state;

      // 상단 숫자
      setText(waveNum, s.endless ? `∞ ${s.waveIndex}` : `${s.waveIndex}/${s.waveCount}`);
      setText(goldNum, fmt(s.gold));
      setText(amberNum, fmt(s.amberEarned));
      setText(hpNum, `${s.baseHp}`);
      const pct = s.baseHpMax > 0 ? (s.baseHp / s.baseHpMax) * 100 : 0;
      hpFill.style.width = `${pct}%`;
      cls(hpFill, 'is-low', pct <= 30);

      // 우측 토글
      setText(speedBtn, `x${b.speed}`);
      cls(autoBtn, 'is-on', b.autoWave);

      // 손패 재구성 (구성 변경 시에만)
      const sig = s.hand.map((c) => `${c.towerId}:${c.cost}`).join(',');
      if (sig !== handSig) {
        handSig = sig;
        handHost.replaceChildren();
        cards = s.hand.map((c, i) =>
          createTowerCard({
            towerId: c.towerId,
            cost: c.cost,
            onTap: () => b.selectCard(b.selectedCard() === i ? null : i),
          }),
        );
        for (const c of cards) handHost.appendChild(c.el);
      }
      const sel = b.selectedCard();
      cards.forEach((c, i) => {
        c.setSelected(sel === i);
        const cost = s.hand[i]?.cost ?? 0;
        c.setDisabled(cost > s.gold);
      });
      setText(refreshLabel, s.refreshCost === 0 ? t('common.free') : fmt(s.refreshCost));

      // 웨이브 시작 버튼 (prep 중에만)
      const prep = s.phase === 'prep';
      callWaveBtn.style.display = prep ? '' : 'none';
      if (prep) {
        const secs = Math.ceil(s.prepTicksLeft / TICK_RATE);
        // 조기 보너스 골드가 계약(BattleStateView)에 없어 근사치 표기 (contractIssues 참고)
        setText(callWaveSub, `${t('battle.earlyBonus', { g: secs * 2 })} · ${t('battle.prep', { s: secs })}`);
      }

      // 선택 타워 패널
      const tw = selectedTowerState(b);
      const selId = tw ? tw.id : null;
      if (selId !== lastSelTower) {
        lastSelTower = selId;
        panelHost.style.display = tw ? '' : 'none';
        if (tw) panelIco.innerHTML = towerIconSvg(tw.defId);
      }
      if (tw) {
        setText(panelName, t(`tower.${tw.defId}.name`));
        setText(panelLv, t('battle.lv', { n: tw.tier + 1 }));
        const up = b.sim.upgradeCost(tw.id);
        setText(upBtnLabel, up === null ? t('common.max') : fmt(up));
        cls(upBtn, 'is-disabled', up === null || up > s.gold);
        const refund = b.sim.sellRefund(tw.id);
        setText(sellBtnLabel, refund === null ? '—' : `+${fmt(refund)}`);
        setText(targetBtn, t(`battle.targeting.${tw.targeting}`));
      }
    },
  };

  /** 선택 타워 상태 조회 */
  function selectedTowerState(b: BattleUiApiExt | null): TowerState | null {
    if (!b) return null;
    const id = b.selectedTower();
    if (id === null) return null;
    return b.sim.state.towers.find((tw) => tw.id === id) ?? null;
  }
}
