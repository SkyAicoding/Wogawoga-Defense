/**
 * 전투 HUD — facade.battle! API만 사용. update()에서 sim.state를 매 프레임 폴링해
 * diff 갱신한다 (이벤트 의존 금지). 웨이브/보스 배너는 export 함수로 외부(game/fx)에서 호출.
 *
 * 선택된 타워 패널: BattleUiApi 계약에 selectedTower()/requestSetTargeting()이 없어
 * 선택 확장 인터페이스로 기능 감지한다 — 없으면 패널을 숨긴다 (contractIssues 보고).
 */
import type { AllyId, BattleUiApi, GameFacade, TargetingMode, TowerState } from '@/data/types';
import { TICK_RATE } from '@/data/types';
import {
  ALL_ALLY_IDS,
  ALLY_BLOCK_CAPACITY,
  ALLY_DEFS,
  ALLY_MAX_ACTIVE,
  ALLY_RETIRE_REFUND,
} from '@/data';
import type { Screen } from '@/core/fsm';
import { h, cls, fmt, mount, unmount, uiRoot, setText } from '../dom';
import { t } from '../i18n';
import {
  ALLY_ICON_SVG,
  amberSvg,
  createTowerCard,
  goldSvg,
  heartSvg,
  hometownIconSvg,
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

  /**
   * 출동 바 — 아군 부족원 생산.
   *
   * **왜 상시 노출된 버튼인가 (기지 탭이 아니라)**:
   * 아군은 수명 20초짜리 긴급 자원이라 "지금 필요하다"고 느낀 순간과 나가는 순간 사이의
   * 탭 수가 곧 반응 속도다. 기지 탭 → 패널 → 버튼은 2탭이고, 그마저도 기지가 화면 구석에
   * 있거나 HUD에 가려 있으면 조준부터 해야 한다. 상시 바는 1탭이고 위치가 고정이다.
   * 카드 핸드를 쓰지 않는 이유도 같다 — 핸드는 타워 배치용 슬롯 3칸을 이미 다 쓰고 있고,
   * 거기에 섞으면 "배치(자리를 고른다)"와 "출동(즉시 나간다)"의 조작 성격이 뒤섞인다.
   * (2단계의 마을 레벨업은 웨이브 사이에 누르는 조작이라 기지 탭 패널이 어울린다 — 자리를 나눈다)
   */
  interface AllyButton {
    el: HTMLElement;
    costLabel: HTMLElement;
    defId: AllyId;
  }
  let allyBtns: AllyButton[] = [];
  let allyCountEl!: HTMLElement;
  let lastAllySig = '';
  /**
   * 출동 안내 패널 — **descKey를 화면에 실제로 띄우는 자리**.
   *
   * 5단계에서 추가했다. 그전까지 ALLY_DEFS.descKey / ko.ts / en.ts 에 설명 문자열이
   * 다 있는데도 `t()`에 한 번도 넘어가지 않아, 플레이어가 버튼에서 읽을 수 있는 것은
   * **이름과 가격뿐**이었다. 그 상태에서는 "수명 20초짜리 소모품"이라는 사실도,
   * "귀환하면 절반이 돌아온다"도, "공중을 칠 수 있는 건 돌팔매꾼뿐"이라는 것도
   * 어디에도 없어서 40골드가 그냥 싼 유닛으로 읽힌다 — 살지 말지를 판단할 정보 자체가
   * 없는 버튼이었다.
   *
   * 왜 버튼 안에 두 줄로 넣지 않고 패널인가: 출동 바는 480px 이하에서 이름까지 접는
   * 자리라(style.css) 설명을 넣을 폭이 없고, 세 버튼에 같은 규칙(수명·환급·상한)을
   * 세 번 적는 것도 낭비다. 대신 이미 있는 "출동 n/6" 칩을 눌러 여는 패널로 만들면
   * 선택 타워/소품/홈타운 패널과 **같은 자리·같은 톤**이 되고, 상시 1탭 출동 동선은
   * 조금도 건드리지 않는다. 접근성 경로(title/aria-label)는 버튼에 따로 붙인다.
   */
  let allyInfoPanel!: HTMLElement;
  let allyInfoOpen = false;

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

  // 홈타운 레벨업 패널 — 선택 타워/소품 패널과 같은 자리, 같은 톤, 같은 2단 확인
  let htPanel!: HTMLElement;
  let htLv!: HTMLElement;
  let htDesc!: HTMLElement;
  let htUpLabel!: HTMLElement;
  let htUpBtn!: HTMLElement;
  let htCloseBtn!: HTMLElement;
  let htStats!: HTMLElement;
  let lastSelBase = false;
  /** 레벨업 확인 무장 상태 — 소품 제거와 완전히 같은 규약 */
  let htArmed = false;
  let htArmTimer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    scArmed = false;
    if (scArmTimer) {
      clearTimeout(scArmTimer);
      scArmTimer = null;
    }
  };

  const disarmBase = (): void => {
    htArmed = false;
    if (htArmTimer) {
      clearTimeout(htArmTimer);
      htArmTimer = null;
    }
  };

  /**
   * 아군 설명 — 마릿수는 문자열에 박지 않고 balance 상수에서 넘긴다.
   * 4단계에서 규칙 5-b(정원 봉쇄)가 1마리 → 3마리로 바뀌었는데 파수꾼 문구만
   * "한 놈"으로 남아 사실과 어긋났다. 값을 주입하면 규칙이 바뀔 때 문구가 따라온다.
   */
  const allyDesc = (defId: AllyId): string =>
    t(`ally.${defId}.desc`, { n: ALLY_BLOCK_CAPACITY });

  /** 세 종이 공유하는 규칙 한 줄 (수명·환급·동시 상한) */
  const allyRules = (): string =>
    t('battle.ally.rules', {
      s: Math.round(ALLY_DEFS.clubber.lifeTicks / TICK_RATE),
      p: Math.round(ALLY_RETIRE_REFUND * 100),
      m: ALLY_MAX_ACTIVE,
    });

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

      // --- 홈타운 레벨업 패널 ----------------------------------------------
      // 아군 출동이 "1탭 상시 바"인 것과 일부러 반대로 뒀다: 레벨업은 웨이브 사이에
      // 누르는 되돌릴 수 없는 큰 결제라, 기지를 **조준해서 고른 다음** 확인까지
      // 거치게 하는 편이 맞다(1단계 결론 그대로). 확인 단계는 소품 제거 패널과
      // 완전히 같은 is-armed 규약을 쓴다 — 이 게임에서 패널이 손가락 밑에 열려
      // 재탭이 그대로 결제가 된 사고가 실제로 있었기 때문이다.
      htLv = h('span', { class: 'tp-lv' });
      htStats = h('span', { class: 'tp-sub tp-sub--stats' });
      htDesc = h('span', { class: 'tp-sub' });
      htUpLabel = h('span', { class: 'tp-btn-label' });
      htUpBtn = h('button', {
        class: 'tp-btn tp-btn--up hud-item',
        attrs: { type: 'button' },
        onClick: () => {
          const bb = api(facade);
          if (!bb || !bb.sim.canUpgradeBase()) return;
          if (!htArmed) {
            htArmed = true;
            if (htArmTimer) clearTimeout(htArmTimer);
            htArmTimer = setTimeout(() => {
              htArmed = false;
              htArmTimer = null;
            }, ARM_TIMEOUT_MS);
            return;
          }
          disarmBase();
          bb.requestUpgradeBase();
        },
      }, htUpLabel);
      htCloseBtn = h('button', {
        class: 'tp-btn tp-btn--close hud-item',
        attrs: { type: 'button', 'aria-label': t('battle.close') },
        text: '✕',
        onClick: () => {
          disarmBase();
          api(facade)?.clearSelection();
        },
      });
      // 소품 패널과 같은 이유로 패널 배경에는 hud-item을 주지 않는다 (포인터 통과)
      htPanel = h('div', { class: 'tower-panel tower-panel--home', attrs: { style: 'display:none' } },
        h('div', { class: 'tp-head' },
          h('span', { class: 'tp-ico tp-ico--home', html: hometownIconSvg }),
          h('span', { class: 'tp-name', text: t('battle.home.title') }),
          htLv,
        ),
        htStats,
        htDesc,
        h('div', { class: 'tp-btns' }, htUpBtn, htCloseBtn),
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

      // --- 출동 바 (아군 부족원) -------------------------------------------
      allyCountEl = h('span', { class: 'ally-count-num' });
      allyBtns = ALL_ALLY_IDS.map((defId) => {
        const costLabel = h('span', { class: 'ally-btn-cost' });
        // 설명은 패널에서 읽는 게 기본 동선이지만, 마우스/스크린리더 경로도 같이 연다.
        // (title은 데스크톱 호버, aria-label은 보조기기 — 둘 다 같은 문장을 쓴다)
        const label = `${t(`ally.${defId}.name`)} — ${allyDesc(defId)} · ${allyRules()}`;
        const el = h('button', {
          class: 'ally-btn hud-item',
          attrs: { type: 'button', 'aria-label': label, title: label },
          onClick: () => api(facade)?.requestTrainAlly(defId),
        },
          h('span', { class: 'ally-btn-ico', html: ALLY_ICON_SVG[defId] }),
          h('span', { class: 'ally-btn-name', text: t(`ally.${defId}.name`) }),
          costLabel,
        );
        return { el, costLabel, defId };
      });
      // 안내 패널 본문 — 종별 한 줄 + 세 종이 공유하는 규칙 한 줄
      allyInfoPanel = h('div', { class: 'tower-panel tower-panel--ally', attrs: { style: 'display:none' } },
        h('div', { class: 'tp-head' },
          h('span', { class: 'tp-name', text: t('battle.ally.infoTitle') }),
        ),
        ...ALL_ALLY_IDS.map((defId) =>
          h('div', { class: 'ally-info-row' },
            h('span', { class: 'ally-info-ico', html: ALLY_ICON_SVG[defId] }),
            h('span', { class: 'ally-info-name', text: t(`ally.${defId}.name`) }),
            h('span', { class: 'ally-info-desc', text: allyDesc(defId) }),
          ),
        ),
        h('span', { class: 'tp-sub', text: allyRules() }),
      );
      const allyInfoBtn = h('button', {
        class: 'ally-count hud-item',
        attrs: { type: 'button', title: t('battle.ally.infoTitle'), 'aria-expanded': 'false' },
        onClick: () => {
          allyInfoOpen = !allyInfoOpen;
          allyInfoPanel.style.display = allyInfoOpen ? '' : 'none';
          allyInfoBtn.setAttribute('aria-expanded', allyInfoOpen ? 'true' : 'false');
        },
      },
        h('span', { class: 'ally-count-label', text: t('battle.ally.title') }),
        allyCountEl,
      );
      const allyRow = h('div', { class: 'ally-row' }, allyInfoBtn, ...allyBtns.map((b) => b.el));

      const bottom = h('div', { class: 'hud-bottom' },
        panelHost,
        scPanel,
        htPanel,
        allyInfoPanel,
        callWaveBtn,
        allyRow,
        h('div', { class: 'hand-row hud-item' }, handHost, refreshBtn),
      );

      root = h('div', { class: 'screen screen--battle' },
        h('div', { class: 'col hud-col' }, top, bannerHost, side, bottom));
      mount(uiRoot(), root);

      // 초기 상태 반영
      handSig = '';
      lastSelTower = null;
      lastSelScenery = '';
      lastSelBase = false;
      lastAllySig = '';
      if (b) this.update?.(facade, 0);
    },

    exit() {
      disarm();
      disarmBase();
      pauseModal?.close();
      pauseModal = null;
      if (root) unmount(root);
      root = null;
      bannerHost = null;
      cards = [];
      handSig = '';
      allyBtns = [];
      lastAllySig = '';
      allyInfoOpen = false;
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

      // 출동 바 — 비용은 나가 있는 인원 수에 따라 오르므로 인원이 바뀔 때만 갱신하고,
      // 골드는 매 프레임 바뀌니 비활성 여부는 항상 다시 본다
      const allySig = `${s.allies.length}/${s.allyCap}`;
      if (allySig !== lastAllySig) {
        lastAllySig = allySig;
        setText(allyCountEl, allySig);
        cls(allyCountEl, 'is-full', s.allies.length >= s.allyCap);
        for (const btn of allyBtns) setText(btn.costLabel, fmt(b.sim.allyCost(btn.defId)));
      }
      // canTrainAlly는 상한·골드·종료 여부를 한 번에 본다 (sim이 커맨드를 거부하는 판정 그대로)
      for (const btn of allyBtns) cls(btn.el, 'is-disabled', !b.sim.canTrainAlly(btn.defId));

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

      // 홈타운 레벨업 패널 (타워/소품 패널과 상호배타 — placement가 보장)
      const homeSel = over ? false : (b.selectedBase?.() ?? false);
      if (homeSel !== lastSelBase) {
        lastSelBase = homeSel;
        htPanel.style.display = homeSel ? '' : 'none';
        disarmBase(); // 패널이 닫히거나 새로 열리면 확인 무장은 무효
      }
      if (homeSel) {
        setText(htLv, t('battle.lvOf', { n: s.baseLevel, m: s.baseLevelMax }));
        // 지금 성능을 항상 보여 준다 — 레벨업이 무엇을 사는지 비교할 기준이 화면에 있어야 한다
        setText(
          htStats,
          t('battle.home.stats', { hp: `${s.baseHp}/${s.baseHpMax}`, r: b.sim.baseRange().toFixed(1) }),
        );
        const cost = b.sim.baseUpgradeCost();
        const maxed = cost === null;
        const short = maxed ? 0 : cost - s.gold;
        const blocked = maxed || short > 0;
        if (blocked && htArmed) disarmBase(); // 도중에 골드가 모자라지면 무장 해제
        setText(
          htUpLabel,
          maxed
            ? t('common.max')
            : htArmed
              ? `✓ ${t('battle.scenery.confirm')} ${fmt(cost)}`
              : `⬆ ${t('battle.upgrade')} ${fmt(cost)}`,
        );
        cls(htUpBtn, 'is-armed', htArmed);
        cls(htUpBtn, 'is-disabled', blocked);
        // 되돌릴 수 없는 결제라 **무엇을 사는지**를 확인 단계 전에 숫자로 보여 준다.
        // (골드가 모자라거나 확인 대기 중이면 그 사정이 우선 — 그때는 이유를 띄운다)
        const next = b.sim.baseNextStats();
        setText(
          htDesc,
          maxed
            ? t('battle.home.maxed')
            : short > 0
              ? t('battle.scenery.needGold', { n: fmt(short) })
              : htArmed
                ? t('battle.home.confirmDesc', { n: fmt(cost) })
                : next
                  ? t('battle.home.next', {
                      hp: `${next.hpMax}`,
                      d: `${next.dmg}`,
                      r: next.range.toFixed(1),
                    })
                  : t('battle.home.desc'),
        );
        cls(htDesc, 'is-warn', short > 0 || htArmed);
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
