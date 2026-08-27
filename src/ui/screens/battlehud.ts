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
  EnemyId,
  GameFacade,
  TargetingMode,
  TowerState,
  WavePreview,
} from '@/data/types';
import type { AllyState, ResourceId } from '@/data/types';
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
import { gatherTicksFor, isGathering, isWorkerDef } from '@/data/resources';
import type { Screen } from '@/core/fsm';
import { isCoarsePointer } from '@/core/device';
import { h, cls, fmt, mount, unmount, uiRoot, setText } from '../dom';
import { t } from '../i18n';
import {
  ALLY_ICON_SVG,
  amberSvg,
  createTowerCard,
  enemyIconSvg,
  goldSvg,
  hometownIconSvg,
  rallySvg,
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

/**
 * selectedTower/requestSetTargeting은 계약(BattleUiApi)에 편입됐고, **채집 둘만** 아직
 * 확장이다 — 계약이 사는 `src/data/types.ts`는 이 트랙이 손대지 않는 파일이라
 * (docs/gather-spec.md T5) 이 파일 헤더의 규약대로 **기능 감지**로 붙인다.
 * 구현은 `game/battlecontroller.ts`의 `BattleGatherApi`이고, 없으면 자원 패널은
 * [채집 보내기] 없이 예전 그대로의 제거 패널로 돈다(목 UI가 그 경우다).
 */
type BattleUiApiExt = BattleUiApi & {
  /** 자원 칸에 채집을 보낸다 (누구를 보낼지는 sim이 고른다 — gather-spec D7) */
  requestGatherAt?(cellX: number, cellZ: number): void;
  /**
   * 자원 패널의 계산에만 쓰는 판 상수 둘 — 마을 셀(마을까지 몇 초)과 격자 폭
   * (셀 키 = cellZ * gridW + cellX, `AllyState.gatherKey`와 맞춰 보려면 필요하다).
   * `BattleStateView`에 없어서 여기로 받는다. **게임 규칙은 하나도 안 실린다.**
   */
  gatherRefs?(): { baseX: number; baseZ: number; gridW: number };
  /**
   * **집결** — 살아 있는 부족원 전원을 마을 셀로 되부른다(탭 1회).
   * sim 은 0줄이다: 기존 `moveAlly`(allyId −1 = 전원)를 마을 셀로 한 번 발행할 뿐이다.
   * 좌표를 아는 쪽(game/battlecontroller)이 채운다 — UI 는 `baseCell` 을 모른다.
   * 선택 사항이라 없으면 버튼을 아예 안 그린다(이 파일 헤더의 기능 감지 규약).
   */
  requestRallyAllies?(): void;
};

const TARGETING_ORDER: readonly TargetingMode[] = ['first', 'last', 'strongest', 'nearest'];

/** 제거 확인 무장이 자동으로 풀리는 시간 (ms) — 무장 상태가 잊힌 채 남지 않게 */
const ARM_TIMEOUT_MS = 4000;

/**
 * 자원 종류의 얼굴 — **이모지 하나**다. 새 SVG 자산을 만들지 않은 이유가 둘:
 *  ① 이 자리는 34px 아이콘 하나이고 여덟 종이 **형태로** 갈려야 하는데, 그건
 *     이모지가 이미 아주 잘 하는 일이다(딸기·버섯·꿀·나무·돌은 실루엣이 전부 다르다).
 *  ② 자산을 늘리면 card.ts의 아이콘 표가 여덟 개 커지고, 그 표는 이 트랙 소유가 아니다.
 * ⚠ **판 위의 소품과 짝이 맞아야 한다** — 판에서는 종류가 곧 1층 실루엣이므로
 *   (gather-spec §6-2) 이 이모지는 그 실루엣의 축약이지 새 정보가 아니다.
 */
const RES_EMOJI: Readonly<Record<ResourceId, string>> = {
  berry: '🍓',
  mushroom: '🍄',
  honey: '🍯',
  fruit: '🌳',
  flint: '⚡',
  wood: '🪵',
  stone: '🪨',
  obsidian: '🌋',
};

// --- 배너 (모듈 스코프 — HUD 장착 중에만 동작) -------------------------------
let bannerHost: HTMLElement | null = null;

/*
 * ⚠ 문간 체류 상한 표(`gateHoldTicks`)와 `noteGateHold` 는 **문간 띠와 함께 없앴다.**
 *   그 표가 파는 값(돌파까지 남은 틱)을 그리던 게이지가 사라졌기 때문이다.
 *   `game/fx.ts` 의 `enemyAtGate` 핸들러에서 호출도 같이 지웠다.
 */

function pushBanner(className: string, text: string): boolean {
  if (!bannerHost || !bannerHost.isConnected) return false;
  const b = h('div', { class: `banner ${className}`, text });
  b.addEventListener('animationend', () => b.remove());
  bannerHost.appendChild(b);
  return true;
}

/** 웨이브 시작 배너. final=true면 '마지막 웨이브!' 문구 */
export function showWaveBanner(wave: number, final = false): void {
  pushBanner('banner--wave', final ? t('battle.finalWaveBanner') : t('battle.waveBanner', { n: wave }));
}

/** 보스 경고 배너 */
export function showBossBanner(): void {
  pushBanner('banner--boss', t('battle.bossBanner'));
}

/**
 * 첫 사용자 안내 배너 (gather-spec §7 마지막 항목) — **최소 개입**이다.
 *
 * 이 기능은 발견되지 않으면 없는 것과 같다: 자원 칸은 지금까지 "치우는 방해물"이었고,
 * 채집을 켜도 화면에 새 버튼이 하나도 안 생긴다(명령이 기존 탭 두 번 그대로이기 때문이다).
 * 그래서 **판을 가르치지 않고 한 문장만** 띄운다 — 튜토리얼도, 강제 진행도, 화살표도 없다.
 * `.banner-host`는 pointer-events: none이라 탭을 하나도 안 먹는다.
 * 띄웠는지 여부를 돌려주는 이유는 호출부가 "HUD가 아직 안 붙었다"와 "띄웠다"를
 * 구분해야 하기 때문이다(안 그러면 한 프레임 차이로 안내가 영영 사라진다).
 */
export function showHintBanner(text: string): boolean {
  return pushBanner('banner--hint', text);
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
  /** ⛏ n명 채집 중 · 짐 c — 마을 패널의 인원 줄 뒤에 붙는다 */
  let allyGatherEl!: HTMLElement;
  /*
   * ── '이동 명령' 버튼은 삭제됐다 (사용자 지시) ──────────────────────────────
   * "그럼 안되고, 그냥 생산한 다음 마을 부족을 아무나 선택하면 같은 종류는 모두
   *  선택되게 해서 원하는 블록을 찍으면 그곳으로 이동 하도록 해줘."
   * 조작이 전부 **판 위**로 옮겨갔다: 부족원 탭 → 그 종족 전체 선택 → 셀 탭 → 이동.
   * HUD에 남은 것은 '지금 누구를 고르고 있는지'를 알려 주는 표시 한 줄뿐이고,
   * 상태와 입력은 game/placement.ts가 갖는다(selectedAlly / clearAllySelection).
   */
  let lastAllySig = '';
  /**
   * 첫 사용자 안내 배너를 이 판에서 이미 띄웠는가 (gather-spec §7-3 (f)).
   * **프로필에 새 플래그를 만들지 않는다** — `ProfileData`를 늘리면 세이브 스키마가 바뀌고
   * 마이그레이션이 따라온다. 대가는 "웨이브를 한 번도 못 깬 사람에게 다시 보인다"뿐이다.
   */
  let hintShown = false;

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
  /** 자원 칸의 숫자 줄 — 짐값 · 캐기 초 · 마을까지 초 (텄으면 그 사실 한 줄) */
  let scInfo!: HTMLElement;
  /** 패널 머리 — 자원 종류에 따라 아이콘과 이름이 바뀐다 (소품 일반은 예전 그대로) */
  let scIco!: HTMLElement;
  let scName!: HTMLElement;
  let scGatherBtn!: HTMLElement;
  let scClearLabel!: HTMLElement;
  let scClearBtn!: HTMLElement;
  let scCloseBtn!: HTMLElement;
  let lastSelScenery = '';
  /** 제거 확인 무장 상태 — true일 때만 다음 탭이 실제로 골드를 쓴다 */
  let scArmed = false;
  let scArmTimer: ReturnType<typeof setTimeout> | null = null;

  /*
   * ── 문간 띠 ────────────────────────────────────────────────────────────────
   * 적이 마을 문 앞에 서 있는 **동안에만** 존재한다(src/sim/gate.ts). 두 줄이다:
   *   1줄 — 지금 가장 위험한 놈(아이콘 + 이름 + ×N) · **문 앞 빚 합계**
   *   2줄 — 마을 HP 바 · 돌파 게이지("돌파까지 N.N초")
   * 왼쪽 끝에 집결 버튼이 붙는다.
   *
   * ── 왜 이 두 줄인가 (gate-wip 에서 바뀐 자리) ───────────────────────────────
   * 그 가지는 "한 입 −N · N입 남음 · 다음 한 입 N초"를 그렸다. 이번 설계는 한 입이
   * **언제나 1**이라 그 셋이 통째로 뜻을 잃는다 — 크기는 늘 −1이고, 남은 입 수는
   * 마을 HP 숫자 그 자체이며, 다음 한 입 초읽기는 **마을 HP 바가 1초에 한 칸씩
   * 줄어드는 것**으로 이미 화면에 있다. 같은 사실을 두 번 그리면 390px 에서
   * 돌파 게이지가 들어갈 칸이 없어진다.
   * 그 자리에 들어온 두 숫자가 이번 설계에서 **새로 생긴 사실**이다:
   *   · 빚 합계(Σ gateOwed) — 저기 선 것들을 못 죽이면 마을이 잃을 총 HP.
   *     마을 HP 이상이면 경보다(`doomed`). 오늘까지는 "도착 = 즉시 한 방"이라
   *     미리 볼 수가 없던 값이고, 문간이 처음으로 **예고**를 만들었다.
   *   · 돌파까지 남은 시간 — 봉쇄가 **유예이지 면제가 아니라는** 사실(gate.ts 규칙 8)이
   *     화면에 나타나는 유일한 자리다. 붙잡아 놓고 안심하다 상한에서 잔액을 한 방에
   *     맞는 것이 이 기능의 유일한 배신인데, 그 시계가 없으면 배신이 예고 없이 온다.
   *
   * ── 왜 그 외에는 아예 안 보이는가 ────────────────────────────────────────────
   * (1) 세로 예산. 390px 에서 상·하단이 이미 포화라고 CSS 주석이 여러 번 실측으로
   *     적어 놨다. 죽은 줄 하나를 상시로 두면 손패·마을 패널이 그만큼 밀린다.
   * (2) 비활성 버튼은 가르치지 못한다. 이 띠가 파는 것은 "지금"이고,
   *     **나타나는 것 자체가 신호**다.
   * (3) 이 파일의 선례와 같다 — 웨이브 시작 버튼·미리보기 띠도 prep 이 아니면
   *     display:none 이지 비활성으로 남지 않는다.
   */
  /** 띠가 지금 보이는가 — 켜짐/꺼짐 전환에만 DOM 을 만진다 */
  /*
   * ── 마을 위급 테두리 ────────────────────────────────────────────────────────
   * 화면 가장자리에 붉은 빛이 어린다. **마을 HP 가 낮은 동안 계속** 떠 있고,
   * 문간 띠와 달리 문 앞에 아무도 없어도 뜬다.
   *
   * 왜 따로 필요한가: 기지 HP 표시는 8단계에서 상단 HUD 를 떠나 **마을 지붕 위 3D 바**로
   * 갔다(healthbars.ts kind 4). 그 바는 마을을 보고 있을 때는 훌륭하지만, 판을 넓게
   * 보거나 손패를 고르는 동안에는 화면 한구석의 몇 픽셀이다 — 곧 **HP 가 낮다는 사실이
   * 시선의 위치에 달려 있다.** 문간이 들어오면서 그 위험이 커졌다: 종전에는 마을이
   * 깎이는 순간이 도달 한 번이라 흔들림이 시선을 끌어왔는데, 이제는 1초에 1씩 조금씩
   * 깎여 **큰 신호가 한 번도 안 오는 채로 마을이 죽을 수 있다.**
   * 가장자리는 어디를 보고 있든 주변시에 들어오는 유일한 자리다.
   *
   * 드로우콜 0 — DOM 한 겹이고 포인터를 통과시킨다(3D 위에 얹지 않는다).
   */
  let dangerVig!: HTMLElement;
  /** 직전 프레임의 위급 단계 (0 안전 · 1 위험 · 2 치명) — 바뀔 때만 DOM 을 만진다 */
  let lastDanger = -1;
  /** 아이콘 innerHTML 은 비싸다 — 종이 바뀔 때만 다시 그린다 */

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
    t(`ally.${defId}.desc`, {
      n: ALLY_BLOCK_CAPACITY,
      // 채집꾼 문구의 {g}·{c}도 같은 이유로 **정의에서** 온다 — 값을 문장에 박으면
      // gatherPct/carryCap을 튜닝할 때(T6이 그 일을 한다) 화면만 옛말을 하게 된다.
      // 나머지 세 종의 문구에는 이 자리표시자가 없어 그냥 무시된다.
      g: gatherMul(defId),
      c: ALLY_DEFS[defId].carryCap ?? 1,
    });

  /** 채집 배수 (gatherPct 300 → 3). 문구와 배지가 같은 값을 본다 */
  const gatherMul = (defId: AllyId): number =>
    Math.round(((ALLY_DEFS[defId].gatherPct ?? 100) / 100) * 10) / 10;

  /**
   * 네 종이 공유하는 규칙 한 줄 (조작·자동 행동·정원).
   * 9단계: 수명과 환급이 사라져 문구 셋 중 둘이 통째로 바뀌었다. 정원은 이제 상수가
   * 아니라 **지금 마을 레벨의 값**이라 sim에서 읽는다 — 레벨을 올리면 이 줄이 따라 바뀐다.
   *
   * 10단계: 조작이 기기마다 갈려(마우스 = 좌 선택·우 명령 / 터치 = 탭 하나) 앞 조각을
   * `isCoarsePointer`로 고른다. 뒤 조각(자동 행동)은 **양쪽이 같다** — 규칙은 sim에 있고
   * 입력 기기와 무관하기 때문이다. 그래서 문자열도 갈라 두고 여기서 잇는다.
   */
  const allyRules = (cap: number = ALLY_MAX_ACTIVE): string =>
    `${t(isCoarsePointer ? 'battle.ally.rulesTouch' : 'battle.ally.rulesMouse', { m: cap })} · ${t('battle.ally.rulesAuto')}`;
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
      scInfo = h('span', { class: 'tp-sub tp-sub--stats' });
      scIco = h('span', { class: 'tp-ico tp-ico--scenery', html: sceneryIconSvg });
      scName = h('span', { class: 'tp-name', text: t('battle.scenery.title') });
      /*
       * [채집 보내기] — **1탭, 확인 없음**이다(골드를 안 쓴다). 제거(2단 확인)와 나란히
       * 서지만 성격이 정반대라 색으로도 갈린다: 이쪽은 초록(버는 일), 저쪽은 흙색(쓰는 일).
       *
       * ⚠ 이 버튼은 **누구를 보낼지 안 고른다.** 보내는 커맨드는 판 위 탭과 같은
       *   `moveAlly`이고 `defId`를 안 실어 후보를 전 종족으로 연다 — 그중 한 사람을
       *   고르는 것은 sim의 규칙이다(gather-spec D7 · sim/allies.ts moveAlly ③).
       *   UI가 아는 것은 "보낼 수 있나/없나"뿐이고, 그 판정도 아래 update()가 sim의
       *   후보 조건(못 캐는 종 · 짐 가득)을 그대로 되짚어 **사유를 화면에 적기 위해서**다.
       */
      scGatherBtn = h('button', {
        class: 'tp-btn tp-btn--gather hud-item',
        attrs: { type: 'button' },
        onClick: () => {
          const bb = api(facade);
          const sc = bb?.selectedScenery?.() ?? null;
          if (!bb || !sc) return;
          const r = bb.sim.resourceAt(sc.x, sc.z);
          // ⚠ resourceAt은 taken을 안 걸러낸다 — 다 턴 칸으로 사람을 보내면 헛걸음이다
          if (!r || r.taken) return;
          bb.requestGatherAt?.(sc.x, sc.z);
        },
      }, h('span', { class: 'tp-btn-label', text: `🧺 ${t('battle.res.send')}` }));
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
        h('div', { class: 'tp-head' }, scIco, scName),
        // 숫자 줄이 **먼저**다 — 이 패널에서 결정을 바꾸는 것은 문장이 아니라 세 숫자
        // (짐값 · 캐기 초 · 마을까지 초)이고, 그 셋이 "채집꾼이면 4초, 파수꾼이면 20초"를
        // 버튼 하나 위에서 가른다(gather-spec §7-3 (e)).
        scInfo,
        scDesc,
        h('div', { class: 'tp-btns' }, scGatherBtn, scClearBtn, scCloseBtn),
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
        /*
         * 배지는 **데이터가 정한다** — 종 이름을 여기 박지 않는다. 붙는 축은 셋이다:
         *   heal(마법사) = 유일한 회복 수단 · sunder = 타워 화력의 곱셈 인자 ·
         *   gather(채집꾼) = 유일한 벌이 수단.
         *
         * ⚠ **더 이상 배타가 아니다.** 종전 주석은 "한 종이 둘 다는 아니다"라고 적었는데,
         *   마법사가 `heal` 과 `sunder` 를 **둘 다** 갖는다(파수꾼의 탱커 성질을 그대로
         *   물려받았기 때문이다 — hp 560 은 봉투 [14]의 필요조건이라 뺄 수 없다).
         *   배지 자리는 한 벌뿐이므로 **회복을 우선**한다: 그것이 이 카드의 새 정체이고,
         *   가죽 열기는 아래 `label`(호버·스크린리더)이 계속 말한다. 곧 정보는 안 잃고
         *   가장 눈에 띄는 자리만 새 능력에 준다.
         */
        const heals = ALLY_DEFS[defId].heal !== undefined;
        const opensHide = ALLY_DEFS[defId].sunder === true;
        const gathers = (ALLY_DEFS[defId].gatherPct ?? 100) > 100;
        const badge: 'heal' | 'sunder' | 'gather' | null = heals
          ? 'heal'
          : opensHide
            ? 'sunder'
            : gathers
              ? 'gather'
              : null;
        const label =
          `${t(`ally.${defId}.name`)} — ${allyDesc(defId)} · ${allyRules()}` +
          (heals ? ` · ${t('battle.ally.healHint')}` : '') +
          (opensHide ? ` · ${t('battle.ally.sunderHint')}` : '') +
          (gathers
            ? ` · ${t('battle.ally.gatherHint', {
                g: gatherMul(defId),
                c: ALLY_DEFS[defId].carryCap ?? 1,
              })}`
            : '');
        const el = h('button', {
          class: 'ally-btn hud-item',
          attrs: { type: 'button', 'aria-label': label, title: label },
          onClick: () => api(facade)?.requestTrainAlly(defId),
        },
          h('span', { class: 'ally-btn-ico', html: ALLY_ICON_SVG[defId] }),
          h('span', { class: 'ally-btn-name', text: t(`ally.${defId}.name`) }),
          costLabel,
        );
        /*
         * 배지 DOM은 **한 벌**이다 — 자리(버튼 안쪽 위 모서리)도, 좁은 화면에서 낱말을
         * 접는 규칙도 종류와 무관하게 같아야 하기 때문이다. 그래서 기존 `.ally-btn-sunder`가
         * 배지의 **자리 이름**으로 남고 종류는 수식 클래스가 가른다(색만 갈린다).
         * 이름이 역사적이라는 것은 알고 둔다 — 바꾸면 style.css의 반응형 규칙 넷과
         * e2e 선택자가 같이 움직여야 하고, 그건 이 배지가 사는 값보다 크다.
         */
        if (badge) {
          el.appendChild(
            h('span', { class: `ally-btn-sunder ally-btn-sunder--${badge}` },
              badge === 'sunder'
                ? h('span', { class: 'ally-btn-sunder-ico', html: traitIconSvg('hide') })
                : h('span', {
                    class: 'ally-btn-sunder-ico ally-btn-sunder-ico--glyph',
                    text: badge === 'heal' ? '✚' : '⛏',
                  }),
              h('span', {
                class: 'ally-btn-sunder-txt',
                text: t(`battle.ally.${badge}`),
              }),
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
          // "몇 명이 캐고 있고 짐이 몇 개인가" — 채집은 **전선에서 빠지는 일**이라
          // 그 인원이 화면에 없으면 "왜 이렇게 안 막히지"의 답이 어디에도 없다.
          // 부모 컨테이너가 flex-wrap이라 폭이 모자라면 줄바꿈된다.
          (allyGatherEl = h('span', { class: 'ally-gather-num' })),
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
                  : (ALLY_DEFS[defId].gatherPct ?? 100) > 100
                    ? // 채집꾼만 **조작법 한 마디**가 붙는다 — 이 종은 출동시키는 것만으로는
                      // 아무 일도 안 일어나고, 자원 칸을 찍어야 비로소 일을 시작한다.
                      `${allyDesc(defId)} · ${t('battle.ally.rulesGather')}`
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

      /*
       * 문간 띠는 하단 덩어리의 **맨 위**다. 셋을 동시에 만족하는 유일한 자리다:
       *  · 상단 HUD 를 한 자리도 안 건드린다 (HUD_TOP_PX 74 는 카메라 예약이다).
       *  · 흐름 안에 있어 나타날 때 위로 자라고, 사라지면 자리를 통째로 돌려준다.
       *  · 390×844 세로에서 **엄지 구역**이다 — 문 앞의 시간이 3~12초뿐이라
       *    상단(반대쪽 끝)에 두면 한 손으로는 그 시간을 못 지킨다.
       */
      /*
       * ⚠⚠ **쌓는 순서가 곧 "무엇이 안 움직이는가" 다** (사용자 지적).
       *   > "하단 메뉴 위에 각종 알림 정보가 뜨는데 … 아래에서부터 위로 차곡차곡 쌓아
       *   >  올려서 보이도록 해줘 … 특히 홈타운 메뉴를 호출 했을때 알림창이 홈타운
       *   >  아래에 뜨니까 선택 하려고 했다가 메뉴가 이동되서 어려워."
       *
       *   이 열은 화면 **아래에 붙어** 세로로 자란다. 그래서 세로 flex 에서
       *   **DOM 뒤쪽(= 시각적으로 아래)일수록 안 움직인다** — 위에서 무엇이 뜨고 지든
       *   자기 자리는 그대로다. 반대로 앞쪽에 있는 것은 아래에서 뭔가 나타나는 순간
       *   그만큼 위로 밀린다.
       *
       *   종전 순서(위→아래)는 `패널 · 소품 · 홈타운 · 미리보기띠 · 웨이브시작 · 손패`
       *   였다. 미리보기 띠와 웨이브 시작 버튼은 **준비 단계에만 떴다 사라지는데**
       *   홈타운 패널보다 **아래**에 있었다 — 곧 그 둘이 나타날 때마다 홈타운 메뉴가
       *   통째로 밀려 올라갔다. 사용자가 누르려던 버튼이 손가락 밑에서 움직인 것이다.
       *
       *   지금 순서는 **뜨고 지는 것을 위로, 손이 가는 것을 아래로** 보낸다:
       *     미리보기띠 · 웨이브시작  ← 준비 단계에만 존재(가장 많이 나타났다 사라진다)
       *     타워패널 · 소품패널 · 홈타운패널  ← 골라서 여는 것
       *     손패                            ← 언제나 있다 = 바닥 기준점
       *   ⇒ 새 알림은 **위에서 나오고**, 아래에 있는 것들은 그 자리를 지킨다.
       *   ⚠ 패널끼리도 같은 규칙이라 **홈타운이 가장 아래**다 — 사용자가 지목한 그 메뉴가
       *     가장 안 흔들리는 자리를 갖는다.
       */
      const bottom = h('div', { class: 'hud-bottom' },
        band.el,
        callWaveBtn,
        panelHost,
        scPanel,
        htPanel,
        h('div', { class: 'hand-row hud-item' }, handHost, refreshBtn),
      );

      /*
       * 테두리는 **HUD 열 밖**에 둔다 — 열 안에 넣으면 흐름에 자리를 차지해
       * 손패가 밀린다. `.screen` 이 이미 절대 배치의 기준이라 여기가 유일한 자리다.
       * 맨 앞에 두어 z 순서상 HUD 아래로 깔린다: 경보가 버튼을 덮으면 안 된다.
       */
      dangerVig = h('div', { class: 'danger-vig', attrs: { 'aria-hidden': 'true' } });
      root = h('div', { class: 'screen screen--battle' },
        dangerVig,
        h('div', { class: 'col hud-col' }, top, bannerHost, side, bottom));
      mount(uiRoot(), root);

      // 초기 상태 반영
      handSig = '';
      lastSelTower = null;
      lastSelScenery = '';
      lastSelBase = false;
      lastAllySig = '';
      hintShown = false;
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
      /*
       * 문간 표는 **판 단위로 산다.** 안 지우면 다음 판의 같은 id 가 지난 판의 체류
       * 상한을 물려받는다 — sim 의 풀 재사용 누출(entities.ts `bountyPaid`)과 정확히
       * 같은 종류의 사고이고, 여기서는 "돌파까지 3초"가 틀린 종의 값으로 뜬다.
       */
      lastDanger = -1;
    },

    update(facade) {
      const b = api(facade);
      if (!b || !root) return;
      const s = b.sim.state;

      /*
       * 첫 사용자 안내 (gather-spec §7-3 (f)) — prep · 웨이브 1 · **한 번도 못 깬 사람**.
       * 새 프로필 플래그를 안 만든다(세이브 스키마 불변). 대가는 알고 받는다:
       * 첫 웨이브를 못 깨고 계속 지는 사람에게는 판마다 다시 보인다 — 그 사람에게는
       * 아직 필요한 안내라 그 대가가 나쁘지 않다.
       * 반환값을 그대로 대입하는 이유: HUD가 아직 안 붙은 프레임에 눌러 버리면
       * 안내가 영영 사라진다(pushBanner가 조용히 반환한다).
       */
      if (
        !hintShown &&
        s.phase === 'prep' &&
        s.waveIndex === 1 &&
        facade.profile.data.stats.wavesCleared === 0
      ) {
        hintShown = showHintBanner(
          t(isCoarsePointer ? 'battle.hint.gatherTouch' : 'battle.hint.gatherMouse'),
        );
      }

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

      /*
       * 마을 위급 단계. 문턱 0.35 / 0.15 는 **연출의 피해 단계**(fx.ts baseDamaged 가
       * 0.6 / 0.3 에서 지붕을 무너뜨린다)보다 늦게 잡았다 — 그쪽은 "얼마나 상했나"를
       * 그리는 상태이고 이쪽은 "지금 뭔가 해라"라는 경보다. 상하면 곧바로 비명을 지르면
       * 경보가 배경이 된다.
       * ⚠ 승패가 확정되면 끈다 — 진 뒤에도 화면이 붉으면 결과 화면으로 그대로 새어 나간다.
       */
      const ended = s.phase === 'won' || s.phase === 'lost';
      const hpFrac = s.baseHpMax > 0 ? Math.max(0, s.baseHp) / s.baseHpMax : 1;
      const danger = ended || hpFrac > 0.35 ? 0 : hpFrac > 0.15 ? 1 : 2;
      if (danger !== lastDanger) {
        lastDanger = danger;
        cls(dangerVig, 'is-on', danger > 0);
        cls(dangerVig, 'is-crit', danger === 2);
      }

      // --- 문간 띠 ---------------------------------------------------------

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

      /*
       * ── 자원 패널 (옛 '방해 지형지물 제거' 패널의 확장) ────────────────────────
       * 같은 셀이 두 가지 뜻을 갖게 됐다: **캘 것**(짐 하나)이면서 **치울 것**(건설 자리)이다.
       * 그래서 패널 하나가 둘을 나란히 판다 — 그리고 D1이 만든 기회비용을 화면이 말한다:
       * 안 턴 칸을 치우면 **그 짐을 버리는 것**이다(battle.res.clearWarn).
       * ⚠ 제거 쪽(클래스 · 2단 확인 · 사유 문구)은 한 줄도 안 바꿨다 — e2e가 전부 잡는다.
       */
      const sc = over ? null : (b.selectedScenery?.() ?? null);
      const res = sc ? b.sim.resourceAt(sc.x, sc.z) : null; // ⚠ taken을 안 걸러낸다
      const scSig = sc ? `${sc.x},${sc.z}` : '';
      if (scSig !== lastSelScenery) {
        lastSelScenery = scSig;
        scPanel.style.display = sc ? '' : 'none';
        disarm(); // 대상이 바뀌면 확인 무장은 무효
        // 머리는 **대상이 바뀔 때만** 다시 쓴다 (종류는 판 내내 안 변한다)
        if (res) {
          scIco.innerHTML = '';
          scIco.textContent = RES_EMOJI[res.kind];
          setText(scName, t(`res.${res.kind}.name`));
        } else if (sc) {
          scIco.textContent = '';
          scIco.innerHTML = sceneryIconSvg;
          setText(scName, t('battle.scenery.title'));
        }
        cls(scIco, 'tp-ico--res', res !== null);
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

        // --- 채집 갈래 -------------------------------------------------------
        const refs = b.gatherRefs?.() ?? null;
        const canSend = res !== null && !res.taken && b.requestGatherAt !== undefined;
        scGatherBtn.style.display = canSend ? '' : 'none';
        const key = res && refs ? res.cellZ * refs.gridW + res.cellX : -1;
        const claimer = key >= 0 ? allyClaiming(s.allies, key) : null;
        const who = canSend ? pickGatherer(s.allies, key) : null;
        // 못 보내는 사유를 **화면이 말한다** — 회색 버튼만 있으면 "왜"가 어디에도 없다
        const anyGatherer = s.allies.some(
          (a) => a.alive && (ALLY_DEFS[a.defId].gatherPct ?? 100) > 0,
        );
        cls(scGatherBtn, 'is-disabled', canSend && who === null);
        // D1이 만든 기회비용 — 안 턴 칸을 치우면 **그 짐을 버리는 것**이다.
        // 결제 확인 문구에 한 줄로 붙는다(치우기가 무엇을 앗아 가는지 그 자리에서 말한다).
        const clearWarn =
          res && !res.taken ? ` · ${t('battle.res.clearWarn', { g: fmt(res.value) })}` : '';

        // 숫자 줄 — 짐값 · (보낼 사람 기준) 캐기 초 · 마을까지 초
        if (res && res.taken) {
          setText(scInfo, t('battle.res.taken'));
        } else if (res) {
          let line = t('battle.res.value', { g: fmt(res.value) });
          // ⚠ 시간은 **누구를 보낼지 정한 뒤의 숫자**다. 그 사람이 없으면 안 적는다 —
          //   임의의 종을 가정해 적으면 화면이 아무도 실행하지 않을 값을 말하게 된다.
          if (who && refs) {
            const wd = ALLY_DEFS[who.defId];
            const secs = Math.max(1, Math.round(gatherTicksFor(wd, res.kind) / TICK_RATE));
            const dx = res.cellX - refs.baseX;
            const dz = res.cellZ - refs.baseZ;
            const walk = Math.max(
              1,
              Math.round(Math.sqrt(dx * dx + dz * dz) / Math.max(0.1, wd.speed)),
            );
            line += ` · ${t('battle.res.time', { s: secs, w: walk })}`;
          }
          setText(scInfo, line);
        }
        scInfo.style.display = res ? '' : 'none';

        /*
         * 상태/경고 줄 — **우선순위가 곧 "지금 이 사람이 알아야 하는 것"의 순서**다.
         *
         * ⚠ 골드 부족(needGold)을 맨 위에 두면 안 된다. 치우기 값은 380부터 시작하고
         *   초반 잔고는 그 아래에 오래 머무르므로, 그대로 두면 **안 턴 칸의 설명이
         *   판 내내 "골드 부족"으로 덮인다** — 정작 지금 할 수 있는 일(공짜인 채집)이
         *   화면에서 사라진다. 그래서 골드 부족은 **캘 것이 없는 칸에서만** 말한다
         *   (치우기 버튼은 어차피 회색이라 못 누른다는 사실 자체는 이미 보인다).
         */
        let warn = false;
        let desc: string;
        if (scArmed && cost !== null) {
          // 결제 직전 — 되돌릴 수 없는 지출이라 다른 무엇보다 먼저다.
          // 안 턴 칸이면 D1의 기회비용(짐을 버린다)이 여기 붙는다.
          desc = t('battle.scenery.confirmDesc', { n: fmt(cost) }) + clearWarn;
          warn = true;
        } else if (!res) {
          desc = short > 0 ? t('battle.scenery.needGold', { n: fmt(short) }) : t('battle.scenery.desc');
          warn = short > 0;
        } else if (res.taken) {
          // 그루터기 — 캘 것이 없으니 이 칸의 남은 뜻은 '치우기'뿐이다
          desc = short > 0
            ? t('battle.scenery.needGold', { n: fmt(short) })
            : t(`res.${res.kind}.tag`);
          warn = short > 0;
        } else if (claimer) {
          // 이미 사람이 가 있다. **캐는 중이면** 규칙 한 줄을 대신 띄운다:
          // 맞으면 손이 멈추고, 그래도 등에 진 짐은 안 놓친다(§4-4). 그 둘이 화면에서
          // 안 갈리면 플레이어에게는 "가끔 안 캔다"가 랜덤으로 읽힌다.
          desc = isGathering(claimer)
            ? t('battle.res.fightFirst')
            : t('battle.res.claimed', { n: t(`ally.${claimer.defId}.name`) });
        } else if (who || !canSend) {
          // (canSend가 false인데 여기까지 온 것은 채집 API가 없는 목 UI뿐이다 —
          //  그때는 "왜 못 보내나"를 말할 처지가 아니므로 주제 문장을 그대로 둔다)
          desc = t('battle.res.desc');
        } else {
          desc = anyGatherer ? t('battle.res.handsFull') : t('battle.res.sendNone');
          warn = true;
        }
        setText(scDesc, desc);
        cls(scDesc, 'is-warn', warn);
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
        // 채집 인원·짐도 같은 서명에 접는다 — 셋 중 하나라도 바뀌면 줄을 다시 쓴다
        let gathering = 0;
        let carrying = 0;
        // 대기 인원 — 자동이 꺼진 사람 수. 판 위의 말뚝(healthbars kind 8)과 같은 사실을
        // 숫자로도 말한다: 표식을 놓치면 "왜 다들 노나"의 답이 화면 어디에도 없다.
        // ⚠ **일꾼만 센다**(§D-3). 자동이 없는 종에게 autoHold 는 상수라 그 숫자가
        //    말하는 것이 없다. 판 위 말뚝(healthbars kind 8)과 **같은 술어**를 쓴다 —
        //    둘이 갈리면 "말뚝은 셋인데 HUD는 다섯"이 된다.
        let holding = 0;
        /**
         * **대기 중인 사람이 등에 지고 있는 골드**(§D-2).
         * 짐을 진 채 "여기 지켜"를 받으면 그 골드가 무기한 묶인다 — 규칙은 그게 맞지만
         * (자동으로 배달을 보내면 목표 표식이 거짓말을 시작한다) 화면 어디에도 안내가
         * 없어서 "왜 돈이 안 들어오지"의 답이 없었다. 여기가 그 답이다.
         * ⚠ **이쪽은 일꾼으로 안 거른다.** 전투원이 짐을 진 채 서 있는 것도 진짜로
         *   묶인 돈이고, 오히려 그쪽이 사용자가 못 알아채는 경우다(전투원은 스스로
         *   배달하러 가지 않는다).
         */
        let heldGold = 0;
        for (const a of s.allies) {
          if (!a.alive) continue;
          if (a.gatherKey >= 0) gathering++;
          if (a.autoHold) {
            if (isWorkerDef(ALLY_DEFS[a.defId])) holding++;
            heldGold += a.carryGold;
          }
          carrying += a.carryCount;
        }
        const headCount = `${s.allies.length}/${s.allyCap}`;
        const allySig = `${headCount}|${gathering}|${carrying}|${holding}|${heldGold}`;
        if (allySig !== lastAllySig) {
          lastAllySig = allySig;
          setText(allyCountEl, headCount);
          cls(allyCountEl, 'is-full', s.allies.length >= s.allyCap);
          // 아무도 안 캐고 짐도 없으면 **줄 자체를 비운다** — 채집을 안 하는 판에서
          // "0명 채집 중"이 상시로 떠 있으면 그것 자체가 소음이다.
          //
          // ⚠ 두 조각을 **따로** 켠다. 하나로 묶으면 아무도 안 캐고 짐만 있을 때
          // "⛏ 0명 채집 중 · 짐 1"이 뜬다 — 줄을 비우는 분기가 합이 0인 경우만 막기
          // 때문이다. 0은 "없다"이지 "0명이 하고 있다"가 아니다.
          const parts: string[] = [];
          if (gathering > 0) parts.push(t('battle.ally.gathering', { n: gathering }));
          if (carrying > 0) parts.push(t('battle.ally.carrying', { c: carrying }));
          if (holding > 0) parts.push(t('battle.ally.holding', { n: holding }));
          // 0은 "없다"이지 "0이 묶여 있다"가 아니다 — 위 두 조각과 같은 규율로 따로 켠다
          if (heldGold > 0) parts.push(t('battle.ally.heldGold', { g: fmt(heldGold) }));
          setText(allyGatherEl, parts.join(' · '));
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

  /** 그 칸을 이미 맡은 사람 (예약은 배타적이라 최대 한 명) — 없으면 null */
  function allyClaiming(allies: readonly AllyState[], key: number): AllyState | null {
    for (const a of allies) {
      if (a.alive && a.gatherKey === key) return a;
    }
    return null;
  }

  /**
   * 지금 [채집 보내기]를 누르면 **누가 갈까** — 화면에 적을 숫자를 위한 미리보기다.
   *
   * ⚠ **이것은 정책이 아니다.** 실제로 누가 가는지는 언제나 sim이 정한다
   *   (gather-spec D7 · sim/allies.ts moveAlly ③: 이미 그 칸을 맡은 사람 →
   *   gatherPct 내림차순 → id 오름차순). 여기서 같은 순서를 되짚는 이유는 패널이
   *   "채집꾼이면 4초, 파수꾼이면 20초"를 **누르기 전에** 말해야 하기 때문이고,
   *   그것이 이 기능의 교육이다. 두 곳이 어긋나면 **화면의 숫자만** 틀리고 규칙은
   *   흔들리지 않는다 — 그래서 정렬을 sim으로 보내고 복제본을 이쪽에 두는 것이 맞다.
   *   (UI에 정책을 두면 그 정책이 hash()에도 sim 테스트에도 안 잡히고, 봇 하네스는
   *    또 다른 정책을 쓰게 되어 사람과 봇이 다른 게임을 하게 된다 — §7-1)
   *
   * 정렬을 안 하고 한 번만 훑는 이유: `state.allies`는 풀 순서(swap-remove)라 id 순이
   * 아니고, 복사해 정렬하면 패널이 열려 있는 동안 매 프레임 배열을 하나씩 버리게 된다.
   * "동점이면 낮은 id"는 비교식에 직접 적으면 순회 순서와 무관하게 같은 답이 나온다.
   */
  function pickGatherer(allies: readonly AllyState[], key: number): AllyState | null {
    let best: AllyState | null = null;
    let bestPct = -1;
    for (const a of allies) {
      if (!a.alive) continue;
      const def = ALLY_DEFS[a.defId];
      const pct = def.gatherPct ?? 100;
      if (pct <= 0) continue; // 못 캐는 종은 애초에 후보가 아니다
      if (a.carryCount >= (def.carryCap ?? 1)) continue; // 짐이 가득
      // ⚠ `key >= 0` 가드가 있어야 한다 — 키를 못 구한 경우(-1)에 이 비교를 그대로 두면
      //   **아무 명령도 없는 사람**(gatherKey −1)이 "이미 그 칸을 맡은 사람"으로 잡힌다.
      if (key >= 0 && a.gatherKey === key) return a; // 이미 맡은 사람이 언제나 우선
      if (best === null || pct > bestPct || (pct === bestPct && a.id < best.id)) {
        best = a;
        bestPct = pct;
      }
    }
    return best;
  }

  /*
   * ⚠⚠ **문간 띠는 통째로 없앴다 (사용자 요구).**
   *   > "보스전 할때 여기 보이는 정보는 필요 없어 이거 지워줘." → 정보 줄 제거
   *   > "지워 집결버튼"                                        → 남은 버튼도 제거
   *
   *   없어진 것: 적 아이콘·이름·마릿수 · 빚 배지 · 마을 HP 바 · 돌파 게이지 ·
   *   집결 버튼. 그리고 그것들만 쓰던 `screens/gateband.ts`(순수 뷰모델)와
   *   `tests/ui/gateband.test.ts`, `battle.gate.*` 문자열, `.gate-*` CSS 도 함께.
   *
   *   ⚠ **되부르기 능력 자체는 안 지웠다** — `battlecontroller` 의
   *     `requestRallyAllies` 는 그대로 있고 디버그 API(`window.__wgd.rallyAllies`)가
   *     쓴다. 사라진 것은 **화면의 버튼**이지 기능이 아니다. 버튼을 되살리려면
   *     이 커밋을 되돌리면 된다.
   *
   *   ⚠ 화면에서 실제로 사라진 **사실**은 둘뿐이다: 문 앞 빚(`문 앞 −n`)과
   *     돌파까지 남은 시간. 마을 HP 는 3D 마을 위 바(healthbars kind 4)가, 보스 HP 는
   *     보스 머리 위 바가 상시로 그린다.
   */

  /** 선택 타워 상태 조회 */
  function selectedTowerState(b: BattleUiApiExt | null): TowerState | null {
    if (!b) return null;
    const id = b.selectedTower();
    if (id === null) return null;
    return b.sim.state.towers.find((tw) => tw.id === id) ?? null;
  }
}
