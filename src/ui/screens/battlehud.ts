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
import {
  amberSvg,
  createTowerCard,
  goldSvg,
  heartSvg,
  sceneryIconSvg,
  towerCountSvg,
  towerIconSvg,
} from '../widgets/card';
import type { TowerCard } from '../widgets/card';
import { showModal } from '../widgets/modal';
import type { ModalHandle } from '../widgets/modal';

/** selectedTower/requestSetTargeting이 계약(BattleUiApi)에 편입됨 — 별칭만 유지 */
type BattleUiApiExt = BattleUiApi;

const TARGETING_ORDER: readonly TargetingMode[] = ['first', 'last', 'strongest', 'nearest'];

/** 제거 확인 무장이 자동으로 풀리는 시간 (ms) — 무장 상태가 잊힌 채 남지 않게 */
const ARM_TIMEOUT_MS = 4000;

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

  // 열린 일시정지 모달 — 화면 이탈 시 닫아 결과 화면에 잔존하지 않게 한다
  let pauseModal: ModalHandle | null = null;

  // 참조 요소 (enter에서 채움)
  let waveNum!: HTMLElement;
  let goldNum!: HTMLElement;
  let amberNum!: HTMLElement;
  let hpNum!: HTMLElement;
  let towerNum!: HTMLElement;
  let towerPill!: HTMLElement;
  /** 직전 프레임의 타워 수 — 줄어든 순간에만 경보 클래스를 붙인다 */
  let lastTowerCount = -1;
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
  // 소품(방해 지형지물) 제거 패널 — 선택 타워 패널과 같은 자리/같은 톤
  let scPanel!: HTMLElement;
  let scDesc!: HTMLElement;
  let scClearLabel!: HTMLElement;
  let scClearBtn!: HTMLElement;
  let scCloseBtn!: HTMLElement;
  let lastSelScenery = '';
  /** 제거 확인 무장 상태 — true일 때만 다음 탭이 실제로 골드를 쓴다 */
  let scArmed = false;
  let scArmTimer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    scArmed = false;
    if (scArmTimer) {
      clearTimeout(scArmTimer);
      scArmTimer = null;
    }
  };

  const api = (facade: GameFacade): BattleUiApiExt | null =>
    facade.battle as BattleUiApiExt | null;

  const openPauseModal = (b: BattleUiApiExt): void => {
    b.paused = true;
    pauseModal = showModal({
      title: t('battle.paused'),
      body: t('battle.quitBody'),
      buttons: [
        { label: t('battle.quit'), kind: 'danger', onTap: () => b.quitToLobby() },
        { label: t('battle.resume'), kind: 'primary', onTap: () => { b.paused = false; } },
      ],
      onClose: () => { pauseModal = null; },
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
      towerNum = h('span', { class: 'pill-num' });
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
          // 서 있는 타워 수 — 파괴가 3D 파티클로만 표현돼 시선을 뗀 사이에 잃으면
          // 알 방법이 없었다. 줄어드는 순간 붉게 튄다(pill--tower-drop).
          (towerPill = h('div', { class: 'pill pill--tower hud-item' },
            h('span', { class: 'pill-ico', html: towerCountSvg }), towerNum)),
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

      // 패널 배경에는 hud-item을 주지 않는다 — 버튼만 포인터를 받고 나머지는
      // 캔버스로 흘려보내 패널에 가린 셀도 그대로 탭할 수 있게 한다
      panelHost = h('div', { class: 'tower-panel', attrs: { style: 'display:none' } },
        h('div', { class: 'tp-head' }, panelIco, panelName, panelLv),
        h('div', { class: 'tp-btns' }, upBtn, sellBtn, targetBtn),
      );

      // --- 방해 지형지물 제거 패널 -----------------------------------------
      // 제거는 환불이 없고 비용이 최대 4,000까지 오른다. 그런데 패널이 방금 탭한
      // 그 지점 위에 열려서, "같은 셀 재탭 → 닫기" 제스처가 그대로 결제가 되는
      // 경로가 있었다(가로 실측: 1탭 선택 → 2탭 결제). 그래서 **두 번 눌러야**
      // 실제로 나간다 — 첫 탭은 확인 상태로 무장만 하고 골드는 건드리지 않는다.
      scDesc = h('span', { class: 'tp-sub' });
      scClearLabel = h('span', { class: 'tp-btn-label' });
      scClearBtn = h('button', {
        class: 'tp-btn tp-btn--clear hud-item',
        attrs: { type: 'button' },
        onClick: () => {
          const bb = api(facade);
          if (!bb) return;
          const sc = bb.selectedScenery?.() ?? null;
          if (!sc) return;
          const cost = bb.sim.clearSceneryCost(sc.x, sc.z);
          if (cost === null || cost > bb.sim.state.gold) return;
          if (!scArmed) {
            // 1단계: 확인 대기. 자동 해제 타이머로 무장 상태가 남지 않게 한다
            scArmed = true;
            if (scArmTimer) clearTimeout(scArmTimer);
            scArmTimer = setTimeout(() => { scArmed = false; scArmTimer = null; }, ARM_TIMEOUT_MS);
            return;
          }
          scArmed = false;
          if (scArmTimer) { clearTimeout(scArmTimer); scArmTimer = null; }
          bb.requestClearScenery();
        },
      }, scClearLabel);
      // 닫기 버튼 — 판을 덮은 패널을 확실히 치울 수 있는 경로. 같은 셀 재탭은
      // 패널이 그 자리를 가리면 실행 자체가 불가능하다
      scCloseBtn = h('button', {
        class: 'tp-btn tp-btn--close hud-item',
        attrs: { type: 'button', 'aria-label': t('battle.close') },
        text: '✕',
        onClick: () => {
          disarm();
          api(facade)?.clearSelection();
        },
      });
      // 패널 자체에는 hud-item을 주지 않는다 — 배경이 포인터를 삼키면 그 밑의
      // 소품/타워 셀 탭이 아무 피드백 없이 죽는다 (실측: 세로 9/40, 가로 13/40 셀)
      scPanel = h('div', { class: 'tower-panel tower-panel--scenery', attrs: { style: 'display:none' } },
        h('div', { class: 'tp-head' },
          h('span', { class: 'tp-ico tp-ico--scenery', html: sceneryIconSvg }),
          h('span', { class: 'tp-name', text: t('battle.scenery.title') }),
        ),
        scDesc,
        h('div', { class: 'tp-btns' }, scClearBtn, scCloseBtn),
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
        scPanel,
        callWaveBtn,
        h('div', { class: 'hand-row hud-item' }, handHost, refreshBtn),
      );

      root = h('div', { class: 'screen screen--battle' },
        h('div', { class: 'col hud-col' }, top, bannerHost, side, bottom));
      mount(uiRoot(), root);

      // 초기 상태 반영
      handSig = '';
      lastSelTower = null;
      lastSelScenery = '';
      if (b) this.update?.(facade, 0);
    },

    exit() {
      disarm();
      pauseModal?.close();
      pauseModal = null;
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
      const towerCount = s.towers.length;
      if (towerCount !== lastTowerCount) {
        setText(towerNum, `${towerCount}`);
        if (lastTowerCount >= 0 && towerCount < lastTowerCount) {
          towerPill.classList.remove('pill--tower-drop');
          void towerPill.offsetWidth; // 애니 재시작
          towerPill.classList.add('pill--tower-drop');
        }
        lastTowerCount = towerCount;
      }
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
        setText(
          callWaveSub,
          `${t('battle.earlyBonus', { g: s.earlyCallBonusGold })} · ${t('battle.prep', { s: secs })}`,
        );
      }

      // 승패가 확정되면 선택 패널은 더 이상 유효한 조작이 아니다 — sim이 커맨드를
      // 전부 거부하므로 눌러도 아무 일이 없는 '살아 있는 척하는 버튼'이 된다
      const over = s.phase === 'won' || s.phase === 'lost';

      // 선택 타워 패널
      const tw = over ? null : selectedTowerState(b);
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

      // 방해 지형지물 제거 패널 (선택 타워 패널과 상호배타 — placement가 보장)
      const sc = over ? null : (b.selectedScenery?.() ?? null);
      const scSig = sc ? `${sc.x},${sc.z}` : '';
      if (scSig !== lastSelScenery) {
        lastSelScenery = scSig;
        scPanel.style.display = sc ? '' : 'none';
        disarm(); // 대상이 바뀌면 확인 무장은 무효
      }
      if (sc) {
        const cost = b.sim.clearSceneryCost(sc.x, sc.z);
        const short = cost === null ? 0 : cost - s.gold;
        const blocked = cost === null || short > 0;
        if (blocked && scArmed) disarm(); // 도중에 골드가 모자라지면 무장 해제
        setText(
          scClearLabel,
          cost === null
            ? '—'
            : scArmed
              ? `✓ ${t('battle.scenery.confirm')} ${fmt(cost)}`
              : `⛏ ${t('battle.scenery.clear')} ${fmt(cost)}`,
        );
        cls(scClearBtn, 'is-armed', scArmed);
        // 골드가 모자라면 비활성 + 얼마나 모자란지 이유를 그 자리에 띄운다
        cls(scClearBtn, 'is-disabled', blocked);
        setText(
          scDesc,
          short > 0
            ? t('battle.scenery.needGold', { n: fmt(short) })
            : scArmed && cost !== null
              ? t('battle.scenery.confirmDesc', { n: fmt(cost) })
              : t('battle.scenery.desc'),
        );
        cls(scDesc, 'is-warn', short > 0 || scArmed);
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
