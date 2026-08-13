/**
 * 전투 HUD — facade.battle! API만 사용. update()에서 sim.state를 매 프레임 폴링해
 * diff 갱신한다 (이벤트 의존 금지). 웨이브/보스 배너는 export 함수로 외부(game/fx)에서 호출.
 *
 * 선택된 타워 패널: BattleUiApi 계약에 selectedTower()/requestSetTargeting()이 없어
 * 선택 확장 인터페이스로 기능 감지한다 — 없으면 패널을 숨긴다 (contractIssues 보고).
 */
import type {
  AllyId,
  BattleUiApi,
  GameFacade,
  TargetingMode,
  TowerState,
  WavePreview,
} from '@/data/types';
import { TICK_RATE } from '@/data/types';
import {
  ALL_ALLY_IDS,
  ALLY_BLOCK_CAPACITY,
  ALLY_DEFS,
  ALLY_MAX_ACTIVE,
  TOWER_DEFS,
  counteredBy,
  favoredAgainst,
} from '@/data';
import type { Screen } from '@/core/fsm';
import { h, cls, fmt, mount, unmount, uiRoot, setText } from '../dom';
import { t } from '../i18n';
import {
  ALLY_ICON_SVG,
  amberSvg,
  createTowerCard,
  goldSvg,
  hometownIconSvg,
  sceneryIconSvg,
  towerCountSvg,
  towerIconSvg,
  traitIconSvg,
} from '../widgets/card';
import type { TowerCard } from '../widgets/card';
import { showModal } from '../widgets/modal';
import type { ModalHandle } from '../widgets/modal';
import { createWavePreview } from '../widgets/wavepreview';
import type { WavePreviewBand } from '../widgets/wavepreview';

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
   * 웨이브 미리보기 띠 (prep 전용) + 그 미리보기를 손패 경고와 **함께 쓴다**.
   * 웨이브 번호가 바뀔 때만 새로 뽑는다 — previewWave는 순수 함수이므로 같은 웨이브에
   * 대해 항상 같은 값이고, 매 프레임 부르면 60Hz로 객체를 버리는 셈이 된다.
   */
  let band: WavePreviewBand | null = null;
  let preview: WavePreview | null = null;
  let previewWaveNo = -1;

  /**
   * 출동 버튼 — 아군 부족원 생산. **마을 패널 안**에 산다 (6단계 개편).
   *
   * ── 무엇이 바뀌었나 ────────────────────────────────────────────────────────
   * 5단계까지는 손패 위에 상시 떠 있는 '출동 바'였다. 근거는 "아군은 수명 20초짜리
   * 긴급 자원이라 탭 수가 곧 반응 속도"였고, 그 판단 자체는 지금도 틀리지 않다.
   * 그럼에도 마을 패널로 옮긴 이유는 **사용자의 명시적 요청**이다:
   * "아군은 기본 UI 화면에서 만들게 하지말고, 마을을 선택했을때 아군을 선택하거나
   * 마을을 업그레이드 하도록 바꿔줘".
   *
   * ── 대가와 그것을 줄인 방법 ────────────────────────────────────────────────
   * 대가는 분명하다. 첫 출동이 1탭에서 2탭이 되고, 기지 셀을 조준해야 한다.
   * 그 마찰을 줄이려고 셋을 했다:
   *  · **패널이 닫히지 않는다** — 출동 버튼은 hud-item이라 탭이 캔버스로 새지 않는다.
   *    한 번 열면 세 명을 연속으로 내보낼 수 있고, 인원이 차 비활성이 된 버튼도
   *    포인터를 삼킨다(style.css). 즉 2탭은 **첫 한 명에게만** 붙는 값이다.
   *  · **전투 중에도 열린다** — 마을 선택은 웨이브 중에도 그대로 되고, 패널은
   *    승패가 확정될 때만 닫힌다.
   *  · **한 패널에서 둘 다** — 레벨업과 출동이 같은 자리에 있어, 마을에 투자하면
   *    부족원이 더 멀리 나간다는 관계(allies.ts 규칙 2)가 손으로도 이어진다.
   *
   * 출동에는 **2단 확인을 넣지 않는다**. 소모품이고 수명이 짧아 반응 속도가 곧 성능이며,
   * 잘못 눌러도 잃는 것은 40~70골드다 (레벨업·소품 제거는 비가역 대형 결제라 확인을 건다).
   */
  interface AllyButton {
    el: HTMLElement;
    costLabel: HTMLElement;
    defId: AllyId;
  }
  let allyBtns: AllyButton[] = [];
  let allyCountEl!: HTMLElement;
  /*
   * ── '이동 명령' 버튼은 삭제됐다 (사용자 지시) ──────────────────────────────
   * "그럼 안되고, 그냥 생산한 다음 마을 부족을 아무나 선택하면 같은 종류는 모두
   *  선택되게 해서 원하는 블록을 찍으면 그곳으로 이동 하도록 해줘."
   * 조작이 전부 **판 위**로 옮겨갔다: 부족원 탭 → 그 종족 전체 선택 → 셀 탭 → 이동.
   * HUD에 남은 것은 '지금 누구를 고르고 있는지'를 알려 주는 표시 한 줄뿐이고,
   * 상태와 입력은 game/placement.ts가 갖는다(selectedAlly / clearAllySelection).
   */
  let lastAllySig = '';

  // 참조 요소 (enter에서 채움)
  let waveNum!: HTMLElement;
  let goldNum!: HTMLElement;
  let amberNum!: HTMLElement;
  let towerNum!: HTMLElement;
  let towerPill!: HTMLElement;
  let allyPillNum!: HTMLElement;
  let allyPill!: HTMLButtonElement;
  /** 직전 프레임의 타워 수 — 줄어든 순간에만 경보 클래스를 붙인다 */
  let lastTowerCount = -1;
  let lastAllyPillSig = '';
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

  // 마을 패널 — 선택 타워/소품 패널과 같은 자리, 같은 톤. 레벨업(2단 확인) + 출동(1탭)
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

  /**
   * 세 종이 공유하는 규칙 한 줄 (이동 명령·영구·정원).
   * 9단계: 수명과 환급이 사라져 문구 셋 중 둘이 통째로 바뀌었다. 정원은 이제 상수가
   * 아니라 **지금 마을 레벨의 값**이라 sim에서 읽는다 — 레벨을 올리면 이 줄이 따라 바뀐다.
   */
  const allyRules = (cap: number = ALLY_MAX_ACTIVE): string => t('battle.ally.rules', { m: cap });
  /** 규칙 줄 DOM — 정원이 마을 레벨을 따라 바뀌므로 update()가 다시 쓴다 */
  let allyRulesEl!: HTMLElement;
  let lastAllyRulesCap = -1;

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
      towerNum = h('span', { class: 'pill-num' });
      allyPillNum = h('span', { class: 'pill-num' });

      /*
       * ── 상단은 이제 **한 줄**이다 (사용자 요청) ─────────────────────────────
       * 둘째 줄(.hud-hp)에 있던 하트·체력바·숫자는 통째로 사라지고, 기지 HP는
       * 판 위 홈타운 지붕 위에 3D 바로 나온다(render/views/healthbars.ts, kind 4).
       * 규칙도 타워와 같아졌다 — **깎이는 동안에만 보인다**.
       * 그 대가로 HUD는 "지금 몇 대 남았나"를 상시로는 말하지 않게 됐지만,
       * 그게 바로 사용자가 요구한 것이고 대신 플레이필드가 한 줄만큼 넓어졌다
       * (battlecontroller.HUD_TOP_PX 118 → 74).
       */
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
      );

      /*
       * 부족 칩 — 나가 있는 인원 n/6 + **마을 패널로 가는 상시 입구**.
       *
       * 6단계에서 상시 출동 바를 걷어내면서 인원 표시까지 패널 안으로 들어갔다.
       * 그 대가가 "탭 하나 더"가 아니라 **기능의 발견 가능성 0**이었다(8단계 검증):
       * 기본 HUD에 아군의 존재를 알리는 요소가 하나도 없고, 유일한 입구인 판 위의
       * 움막 한 칸에는 배지도 글로우도 없다. 웨이브 중 몇 명이 나가 있는지도
       * 화면 어디에도 없었다.
       *
       * 이건 출동 바가 아니다 — 종도 가격도 없고 **아무도 출동시키지 않는다**.
       * 누르면 판 위의 움막을 탭한 것과 같은 경로로 마을을 고른다(api.selectBase).
       * 그래서 "급할 때 첫 한 명"의 동선이 2탭으로 돌아온다 — 출동 버튼 자체는
       * 여전히 패널 안에만 있다.
       *
       * ⚠ 자리 이력: HP 줄(2줄) → 첫 줄 맨 오른쪽 → **지금은 우측 토글 기둥의 맨 위**.
       * 사용자 요청("맨 위에 인원수, x1, 자동 순서로 우측에 세로로"). 상태 표시라
       * 토글 둘과 성격이 달라서 아래 간격을 두 배로 벌리고(.hud-side .pill--ally의
       * margin-bottom) 알약 모양·한랭색을 유지해 사각 토글과 갈리게 뒀다.
       * 옮겨도 **기능은 그대로다** — 여전히 button이고 여전히 api.selectBase()를
       * 부른다. 죽이면 마을 패널로 가는 상시 입구가 다시 0이 된다.
       */
      allyPill = h('button', {
        class: 'pill pill--ally hud-item',
        attrs: { type: 'button', 'aria-label': t('battle.ally.pillHint'), title: t('battle.ally.pillHint') },
        onClick: () => api(facade)?.selectBase?.(),
      },
        h('span', { class: 'pill-ico', html: ALLY_ICON_SVG.clubber }), allyPillNum) as HTMLButtonElement;

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
      // 순서 = 화면에 보이는 순서(위→아래): 인원수 · 배속 · 자동
      const side = h('div', { class: 'hud-side' }, allyPill, speedBtn, autoBtn);

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

      // --- 마을 패널: 레벨업 + 아군 출동 ------------------------------------
      // 레벨업은 웨이브 사이에 누르는 되돌릴 수 없는 큰 결제라, 기지를 **조준해서
      // 고른 다음** 확인까지 거치게 한다. 확인 단계는 소품 제거 패널과 완전히 같은
      // is-armed 규약을 쓴다 — 이 게임에서 패널이 손가락 밑에 열려 재탭이 그대로
      // 결제가 된 사고가 실제로 있었기 때문이다.
      // 출동은 같은 패널 아래쪽에 있지만 **확인 없이 1탭**이다 (위 AllyButton 주석).
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
      // --- 마을 패널의 출동 구역 --------------------------------------------
      allyCountEl = h('span', { class: 'ally-count-num' });
      allyBtns = ALL_ALLY_IDS.map((defId) => {
        const costLabel = h('span', { class: 'ally-btn-cost' });
        // 설명은 아래 안내 줄에서 읽는 게 기본 동선이지만, 마우스/스크린리더 경로도 같이 연다.
        // (title은 데스크톱 호버, aria-label은 보조기기 — 둘 다 같은 문장을 쓴다)
        // 가죽을 여는 카드(파수꾼)만 배지를 단다 — 데이터가 정하므로 종 이름을
        // 여기 박지 않는다. `sunder`를 끄면 배지도 같이 사라진다.
        const opensHide = ALLY_DEFS[defId].sunder === true;
        const label =
          `${t(`ally.${defId}.name`)} — ${allyDesc(defId)} · ${allyRules()}` +
          (opensHide ? ` · ${t('battle.ally.sunderHint')}` : '');
        const el = h('button', {
          class: 'ally-btn hud-item',
          attrs: { type: 'button', 'aria-label': label, title: label },
          onClick: () => api(facade)?.requestTrainAlly(defId),
        },
          h('span', { class: 'ally-btn-ico', html: ALLY_ICON_SVG[defId] }),
          h('span', { class: 'ally-btn-name', text: t(`ally.${defId}.name`) }),
          costLabel,
        );
        if (opensHide) {
          el.appendChild(
            h('span', { class: 'ally-btn-sunder' },
              h('span', { class: 'ally-btn-sunder-ico', html: traitIconSvg('hide') }),
              h('span', { class: 'ally-btn-sunder-txt', text: t('battle.ally.sunder') }),
            ),
          );
        }
        return { el, costLabel, defId };
      });
      /**
       * 출동 구역만 hud-item(포인터 흡수)이다 — 패널의 나머지(정보 줄)는 그대로 통과시킨다.
       *
       * 패널 배경이 포인터를 삼키면 그 밑의 셀 탭이 죽는다(실측: 세로 9/40 · 가로 13/40).
       * 그런데 출동은 **연속으로 누르는 조작**이라, 버튼 사이 여백을 스치기만 해도 탭이
       * 캔버스로 새어 마을 선택이 풀리고 패널이 닫힌다 — 손이 가장 자주 오가는 구역에서
       * 가장 나쁜 실패다. 그래서 이 구역만 삼키고, 정보 줄(체력/미리보기)은 통과시켜
       * 가려진 셀을 살린다.
       */
      const allySection = h('div', { class: 'home-ally hud-item' },
        h('div', { class: 'home-ally-head' },
          h('span', { class: 'ally-count-label', text: t('battle.ally.title') }),
          allyCountEl,
          (allyRulesEl = h('span', { class: 'tp-sub home-ally-rules', text: allyRules() })),
        ),
        h('div', { class: 'ally-row' }, ...allyBtns.map((b) => b.el)),
        // 종별 한 줄 — descKey를 화면에 실제로 띄우는 자리. 5단계의 '출동 안내 패널'을
        // 여기로 흡수했다: 별도 패널이면 마을 패널과 배타 규칙이 어긋나고(둘 다 열릴 수
        // 있었다) 같은 정보가 두 자리에 흩어진다.
        // 좁은 화면에서는 버튼의 배지가 아이콘만 남으므로(style.css @480px)
        // "가죽을 연다"의 **문장**을 읽을 자리는 여기뿐이다.
        ...ALL_ALLY_IDS.map((defId) =>
          h('div', { class: 'ally-info-row' },
            h('span', { class: 'ally-info-ico', html: ALLY_ICON_SVG[defId] }),
            h('span', { class: 'ally-info-name', text: t(`ally.${defId}.name`) }),
            h('span', {
              class: 'ally-info-desc',
              text:
                ALLY_DEFS[defId].sunder === true
                  ? `${allyDesc(defId)} · ${t('battle.ally.sunder')}`
                  : allyDesc(defId),
            }),
          ),
        ),
      );

      // 소품 패널과 같은 이유로 패널 배경에는 hud-item을 주지 않는다 (포인터 통과).
      // 마을 쪽(.home-main)과 출동 쪽(.home-ally)을 감싸 두 덩어리로 나눈 이유는 가로모드다:
      // 세로로 다 쌓으면 390px 높이에서 손패까지 밀려 내려가 화면 밖으로 나간다(실측).
      // 두 덩어리면 가로에서 나란히 눕고 세로에서는 그대로 위아래로 쌓인다.
      htPanel = h('div', { class: 'tower-panel tower-panel--home', attrs: { style: 'display:none' } },
        h('div', { class: 'home-main' },
          h('div', { class: 'tp-head' },
            h('span', { class: 'tp-ico tp-ico--home', html: hometownIconSvg }),
            h('span', { class: 'tp-name', text: t('battle.home.title') }),
            htLv,
          ),
          htStats,
          htDesc,
          h('div', { class: 'tp-btns' }, htUpBtn, htCloseBtn),
        ),
        allySection,
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

      // --- 웨이브 미리보기 띠 ------------------------------------------------
      // 웨이브 호출 버튼 **바로 위** — 둘 다 prep에만 존재하므로 세로 예산을 나눠 쓴다.
      // (상단은 390px에서 이미 포화라 HUD_TOP_PX를 한 자리도 안 건드린다)
      band = createWavePreview();

      const bottom = h('div', { class: 'hud-bottom' },
        panelHost,
        scPanel,
        htPanel,
        band.el,
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
      lastSelBase = false;
      lastAllySig = '';
      preview = null;
      previewWaveNo = -1;
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
      lastAllyPillSig = '';
      band?.reset();
      band = null;
      preview = null;
      previewWaveNo = -1;
    },

    update(facade) {
      const b = api(facade);
      if (!b || !root) return;
      const s = b.sim.state;

      // 상단 숫자
      setText(waveNum, s.endless ? `∞ ${s.waveIndex}` : `${s.waveIndex}/${s.waveCount}`);
      setText(goldNum, fmt(s.gold));
      setText(amberNum, fmt(s.amberEarned));
      // 기지 HP는 더 이상 HUD에 없다 — 홈타운 지붕 위 3D 바가 맡는다
      // (render/views/healthbars.ts kind 4, 저체력 점멸까지 그쪽으로 옮겼다)
      // 부족 칩 — 나가 있는 인원. 상한에 닿으면 색이 바뀐다(패널 안 표시와 같은 규약)
      const allyPillSig = `${s.allies.length}/${s.allyCap}`;
      if (allyPillSig !== lastAllyPillSig) {
        lastAllyPillSig = allyPillSig;
        setText(allyPillNum, allyPillSig);
        cls(allyPill, 'is-full', s.allies.length >= s.allyCap);
      }
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
      /*
       * 이번에 상대할 웨이브의 미리보기 — **prep이면 곧 올 웨이브, 전투 중이면 지금 웨이브**다.
       * state.waveIndex가 두 국면에서 정확히 그 값이므로 번호를 그대로 넘긴다
       * (기본 인자를 쓰면 전투 중에 '다음' 웨이브가 나와 지금 손에 든 카드와 어긋난다).
       * 웨이브가 바뀔 때만 다시 뽑는다 — 순수 함수라 같은 웨이브면 항상 같은 값이다.
       */
      if (s.waveIndex !== previewWaveNo) {
        previewWaveNo = s.waveIndex;
        preview = b.sim.previewWave(s.waveIndex);
      }
      band?.update(s, preview);

      const sel = b.selectedCard();
      cards.forEach((c, i) => {
        c.setSelected(sel === i);
        const cost = s.hand[i]?.cost ?? 0;
        c.setDisabled(cost > s.gold);
        /*
         * 손패 상성 경고 — **배치 티어(T1)** 기준이다. 이 카드를 지금 놓으면 T1이 서기
         * 때문이다(이미 세운 타워의 티어는 미리보기 띠의 수요 막대가 따로 말한다).
         * 새로고침을 슬롯머신에서 **정보에 근거한 구매**로 바꾸는 것이 이 표시의 값이다.
         */
        const def = TOWER_DEFS[c.towerId];
        const entries = preview ? preview.entries : [];
        c.setCounter(counteredBy(def, 0, entries), favoredAgainst(def, 0, entries));
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

      // 마을 패널: 레벨업 + 출동 (타워/소품 패널과 상호배타 — placement가 보장)
      const homeSel = over ? false : (b.selectedBase?.() ?? false);
      if (homeSel !== lastSelBase) {
        lastSelBase = homeSel;
        htPanel.style.display = homeSel ? '' : 'none';
        disarmBase(); // 패널이 닫히거나 새로 열리면 확인 무장은 무효
        lastAllySig = ''; // 다시 열릴 때 인원/가격을 무조건 한 번 다시 쓴다
        if (!homeSel) b.reportPanelTop?.(null); // 닫히면 판이 제자리로 돌아온다
      }
      if (homeSel) {
        // 이 패널이 판을 어디부터 덮는지 게임 쪽에 알린다 — 카메라가 그만큼 비켜선다
        // (types.BattleUiApi.reportPanelTop). 레벨업 미리보기 줄이 사라지는 등
        // 내용에 따라 높이가 변하므로 열려 있는 동안 매 프레임 다시 잰다.
        b.reportPanelTop?.(htPanel.getBoundingClientRect().top);
        setText(htLv, t('battle.lvOf', { n: s.baseLevel, m: s.baseLevelMax }));
        // 지금 성능을 항상 보여 준다 — 레벨업이 무엇을 사는지 비교할 기준이 화면에 있어야 한다.
        // **출격 거리도 여기 있다**: 이 값이 없으면 마을 레벨업이 아군까지 강화한다는
        // 설계 의도(allies.ts 규칙 2)가 화면 어디에도 없다
        setText(
          htStats,
          t('battle.home.stats', {
            hp: `${s.baseHp}/${s.baseHpMax}`,
            r: b.sim.baseRange().toFixed(1),
            s: `${b.sim.allyCap()}`,
          }),
        );
        // 정원은 마을 레벨을 따라 바뀐다 — 바뀔 때만 규칙 줄을 다시 쓴다
        const capNow = b.sim.allyCap();
        if (capNow !== lastAllyRulesCap) {
          lastAllyRulesCap = capNow;
          setText(allyRulesEl, allyRules(capNow));
        }
        // 출동 버튼 — 비용은 나가 있는 인원 수에 따라 오르므로 인원이 바뀔 때만 갱신하고,
        // 골드는 매 프레임 바뀌니 비활성 여부는 항상 다시 본다.
        // (패널이 닫혀 있으면 이 블록에 오지 않는다 — 안 보이는 DOM을 매 프레임 만지지 않는다)
        const allySig = `${s.allies.length}/${s.allyCap}`;
        if (allySig !== lastAllySig) {
          lastAllySig = allySig;
          setText(allyCountEl, allySig);
          cls(allyCountEl, 'is-full', s.allies.length >= s.allyCap);
          for (const btn of allyBtns) setText(btn.costLabel, fmt(b.sim.allyCost(btn.defId)));
        }
        // canTrainAlly는 상한·골드·종료 여부를 한 번에 본다 (sim이 커맨드를 거부하는 판정 그대로)
        for (const btn of allyBtns) cls(btn.el, 'is-disabled', !b.sim.canTrainAlly(btn.defId));
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
                      s: `${next.allyCap}`,
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
