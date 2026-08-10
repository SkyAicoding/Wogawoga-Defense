/**
 * UI 랩 — ?scene=uilab
 * 목 GameFacade(가짜 프로필/전투 상태)로 전 화면을 실제 전환하며 검증한다.
 * 우상단 🧪 버튼 → 화면 선택 드롭다운 + 데미지/배너/모달 트리거.
 * Playwright 자동화용 훅: window.__uilab
 */
import type {
  BattleSim, BattleStateView, BattleUiApi, CardState, EnemyId, GameFacade, ProfileApi,
  ProfileData, ResultSummary, ScreenId, StageProgress, TargetingMode, TowerId,
  TowerProgress, TowerState, Vec2, WavePreview, WavePreviewEntry,
} from '@/data/types';
import { TICK_RATE } from '@/data/types';
import { ENEMY_DEFS } from '@/data/enemies';
import { enemyTraitsOf } from '@/data/balance';
import { ScreenFsm } from '@/core/fsm';
import { Rng } from '@/core/rng';
import { STAGES } from '@/data/stages';
import { TOWER_DEFS } from '@/data/towers';
import { setLang } from '@/ui/i18n';
import { createTitleScreen } from '@/ui/screens/title';
import { createLobbyScreen } from '@/ui/screens/lobby';
import { createCollectionScreen } from '@/ui/screens/collection';
import { createSettingsScreen } from '@/ui/screens/settings';
import { createBattleHud, showBossBanner, showWaveBanner } from '@/ui/screens/battlehud';
import { createResultScreen } from '@/ui/screens/result';
import { spawnDamageNumber } from '@/ui/widgets/damagenumbers';
import type { DamageKind } from '@/ui/widgets/damagenumbers';
import { showModal } from '@/ui/widgets/modal';
import { h } from '@/ui/dom';

const ALL_TOWERS: readonly TowerId[] = [
  'spear', 'catapult', 'lightning', 'brazier', 'frost', 'poison', 'ballista', 'drum',
];
const STAR_COSTS: readonly [number, number][] = [[5, 60], [10, 150], [20, 350], [40, 700], [80, 1400]];

// --- 목 프로필 --------------------------------------------------------------
function makeProfile(): ProfileApi {
  const towers = {} as Record<TowerId, TowerProgress>;
  ALL_TOWERS.forEach((id, i) => {
    towers[id] = { unlocked: i < 6, stars: Math.max(0, 4 - i), shards: (i * 7) % 28 };
  });
  const stages: Record<number, StageProgress> = {
    1: { bestWave: 50, cleared: true, endlessBest: 63 },
    2: { bestWave: 50, cleared: true, endlessBest: 0 },
    3: { bestWave: 24, cleared: false, endlessBest: 0 },
  };
  const data: ProfileData = {
    amber: 1240,
    towers,
    stages,
    milestones: [],
    settings: { lang: 'ko', music: 0.8, sfx: 0.9, vibration: true, quality: 'auto' },
    stats: { kills: 1234, wavesCleared: 87, playMs: 0, bossKills: 3 },
  };
  const stageProgress = (id: number): StageProgress =>
    stages[id] ?? { bestWave: 0, cleared: false, endlessBest: 0 };
  return {
    data,
    spendAmber(n) {
      if (data.amber < n) return false;
      data.amber -= n;
      return true;
    },
    addAmber(n) {
      data.amber += n;
    },
    starUp(id) {
      const tp = data.towers[id];
      const cost = STAR_COSTS[tp.stars];
      if (!tp.unlocked || !cost) return false;
      const [s, a] = cost;
      if (tp.shards < s || data.amber < a) return false;
      tp.shards -= s;
      data.amber -= a;
      tp.stars += 1;
      return true;
    },
    unlockTower(id) {
      const tp = data.towers[id];
      if (tp.unlocked || data.amber < 300) return false;
      data.amber -= 300;
      tp.unlocked = true;
      return true;
    },
    stageProgress,
    isStageUnlocked: (id) => id === 1 || stageProgress(id - 1).cleared,
    isEndlessUnlocked: () => true,
    updateSettings(patch) {
      Object.assign(data.settings, patch);
    },
    resetData() {
      /* 목: 초기화 안 함 */
    },
    save() {
      /* 목: 저장 안 함 */
    },
  };
}

// --- 목 전투 ----------------------------------------------------------------
export function run(): void {
  const rng = new Rng(20260804);
  const profile = makeProfile();
  setLang(profile.data.settings.lang);

  const drawHand = (): CardState[] => {
    const hand: CardState[] = [];
    for (let i = 0; i < 3; i++) {
      hand.push({ towerId: rng.pick(ALL_TOWERS), cost: rng.int(4, 14) * 10 });
    }
    return hand;
  };

  const mockTower: TowerState = {
    id: 1, defId: 'lightning', tier: 2, hp: 585, maxHp: 585, silenceLeft: 0,
    cellX: 4, cellZ: 6, cooldownLeft: 0,
    targetId: -1, targeting: 'first', invested: 260, buffDmgPct: 0, buffRatePct: 0,
  };

  const st: BattleStateView = {
    tick: 0, phase: 'prep', waveIndex: 1, waveCount: 50, gold: 120,
    baseHp: 100, baseHpMax: 100, baseLevel: 1, baseLevelMax: 5, prepTicksLeft: 6 * TICK_RATE,
    earlyCallBonusGold: Math.floor(6 * TICK_RATE * 0.15),
    // 첫 손패는 **고정**이다 — 스테이지1 시작 덱 그대로라 미리보기의 상성 표시
    // (투석기 = 대공 없음 → 회색, 창·얼음 = 유리 → 옅은 테두리)가 랩에서 항상 재현된다.
    // 새로고침 버튼을 누르면 그때부터는 무작위(drawHand)다.
    hand: [
      { towerId: 'catapult', cost: 130 },
      { towerId: 'spear', cost: 110 },
      { towerId: 'frost', cost: 99 },
    ],
    deck: ['spear', 'catapult', 'frost'], refreshCost: 0, enemies: [], towers: [mockTower],
    projectiles: [], allies: [], allyCap: 6, amberEarned: 0, endless: false,
  };

  /**
   * 목 미리보기 — 띠의 레이아웃을 랩에서 그대로 보기 위한 고정 편성이다.
   * 칩 상한(6개)과 `+N` 접힘까지 확인되도록 7종을 넣었고, 공중·장갑·방패·힐이
   * 전부 한 번씩 나와 배지 네 종류가 동시에 그려진다.
   */
  const mockPreviewEntry = (defId: EnemyId, count: number, hpMul: number): WavePreviewEntry => {
    const d = ENEMY_DEFS[defId];
    const maxHp = Math.max(1, Math.round(d.hp * hpMul));
    return {
      defId, count, maxHp, totalHp: maxHp * count,
      armor: d.armor, flying: d.flying, boss: d.boss ?? false, traits: enemyTraitsOf(d),
    };
  };
  const mockPreview = (wave: number): WavePreview => {
    const entries = [
      mockPreviewEntry('raptor', 12, 1.8), mockPreviewEntry('compy', 20, 1.8),
      mockPreviewEntry('boar', 6, 1.8), mockPreviewEntry('trike', 3, 1.8),
      // 프테라 12마리 = 공중 HP 비중 21% — AIR_BLIND_SHARE(10%)를 넘겨 **손패 경고가
      // 실제로 켜지는** 편성이다. 랩은 상태를 전시하는 곳이라 켜진 것을 보여줘야 한다.
      mockPreviewEntry('blade', 5, 1.8), mockPreviewEntry('ptera', 12, 1.8),
      mockPreviewEntry('archer', 3, 1.8),
    ].sort((a, b) => b.totalHp - a.totalHp);
    return {
      wave,
      entries,
      totalHp: entries.reduce((a, e) => a + e.totalHp, 0),
      totalCount: entries.reduce((a, e) => a + e.count, 0),
      goldReward: 30 + wave * 6,
      hasAir: true,
      boss: false,
    };
  };

  const sim: BattleSim = {
    state: st,
    previewWave: (wave) => mockPreview(wave ?? st.waveIndex),
    applyCommand: () => true,
    tick: () => undefined,
    drainEvents: () => [],
    hash: () => 0,
    canPlaceAt: () => true,
    towerAt: () => null,
    upgradeCost: () => 120,
    sellRefund: () => 45,
    // 목: (3,4)에만 소품이 있다고 가정 — 제거 패널 레이아웃 확인용
    hasScenery: (x, z) => x === 3 && z === 4,
    clearSceneryCost: (x, z) => (x === 3 && z === 4 ? 80 : null),
    allyCost: () => 55,
    canTrainAlly: () => true,
    // 목: Lv1 → Lv2가 220골드. 골드 120이라 '부족' 표시까지 그대로 확인된다
    baseUpgradeCost: () => 220,
    canUpgradeBase: () => st.gold >= 220,
    baseRange: () => 2,
    allySortieRange: () => 6,
    // 목: 경로가 없으므로 표식 지점도 없다 — 랩은 패널 레이아웃만 본다
    allySortiePoints: () => [],
    baseNextStats: () => ({ hpMax: 140, dmg: 13, range: 2.25, sortie: 7.5 }),
  };

  let selectedCard: number | null = null;
  let selectedTower: number | null = null;
  let selectedScenery: Vec2 | null = null;
  let selectedBase = false;
  let waveTicksLeft = 0;

  const startWave = (): void => {
    st.phase = 'wave';
    waveTicksLeft = 9 * TICK_RATE;
    showWaveBanner(st.waveIndex, st.waveIndex === st.waveCount);
    if (st.waveIndex % 5 === 0) showBossBanner();
  };

  interface BattleUiApiExt extends BattleUiApi {
    selectedTower(): number | null;
    requestSetTargeting(mode: TargetingMode): void;
  }

  const battleApi: BattleUiApiExt = {
    sim,
    paused: false,
    speed: 1,
    autoWave: false,
    selectCard: (i) => {
      selectedCard = i;
    },
    selectedCard: () => selectedCard,
    // 목 UI 랩 — 실제 출동은 없고 버튼 레이아웃/상태만 본다
    requestTrainAlly: () => undefined,
    selectedBase: () => selectedBase,
    requestUpgradeBase: () => {
      st.baseLevel = Math.min(st.baseLevelMax, st.baseLevel + 1);
    },
    requestRefresh: () => {
      st.hand = drawHand();
      st.refreshCost = st.refreshCost === 0 ? 20 : st.refreshCost + 10;
    },
    requestCallWave: () => {
      if (st.phase === 'prep') startWave();
    },
    requestUpgradeSelected: () => {
      mockTower.tier = Math.min(4, mockTower.tier + 1);
    },
    requestSellSelected: () => {
      selectedTower = null;
    },
    clearSelection: () => {
      selectedTower = null;
      selectedScenery = null;
      selectedBase = false;
    },
    quitToLobby: () => {
      facade.battle = null;
      fsm.goto('lobby');
    },
    retry: () => undefined,
    selectedTower: () => selectedTower,
    selectedScenery: () => selectedScenery,
    requestClearScenery: () => {
      selectedScenery = null;
    },
    requestSetTargeting: (mode) => {
      mockTower.targeting = mode;
    },
  };

  /** 전투 목 진행 — 배속/일시정지 반영, 숫자들이 살아 움직이게 */
  const driveBattle = (dt: number): void => {
    if (battleApi.paused) return;
    const ticks = dt * TICK_RATE * battleApi.speed;
    st.tick += ticks;
    st.gold = 80 + Math.floor(70 * (1 + Math.sin(st.tick / 80)));
    st.amberEarned = Math.floor(st.tick / 240);
    st.baseHp = Math.max(5, Math.round(62 + 40 * Math.sin(st.tick / 300)));
    if (st.phase === 'prep') {
      st.prepTicksLeft = Math.max(0, st.prepTicksLeft - ticks);
      if (st.prepTicksLeft <= 0 || battleApi.autoWave) startWave();
    } else if (st.phase === 'wave') {
      waveTicksLeft -= ticks;
      if (waveTicksLeft <= 0) {
        st.waveIndex += 1;
        st.phase = 'prep';
        st.prepTicksLeft = 6 * TICK_RATE;
      }
    }
  };

  // --- 파사드 + FSM ---------------------------------------------------------
  const facade: GameFacade = {
    profile,
    stages: STAGES,
    towerDefs: TOWER_DEFS,
    goto: (s, params) => fsm.goto(s, params),
    currentScreen: () => fsm.currentId() ?? 'title',
    startBattle: (stageId, endless) => {
      st.endless = endless;
      st.waveIndex = 1;
      st.phase = 'prep';
      st.prepTicksLeft = 6 * TICK_RATE;
      st.amberEarned = 0;
      st.tick = 0;
      selectedCard = null;
      facade.battle = battleApi;
      facade.lastResult = makeResult(true, stageId);
      fsm.goto('battle');
    },
    battle: null,
    lastResult: null,
    version: '0.1.0-uilab',
  };

  const makeResult = (won: boolean, stageId = 3): ResultSummary =>
    won
      ? { won: true, stageId, wave: 50, waveCount: 50, amberEarned: 230,
          shardsEarned: { spear: 12, frost: 6, catapult: 4 }, firstClear: true,
          endless: false, kills: 842 }
      : { won: false, stageId, wave: 23, waveCount: 50, amberEarned: 60,
          shardsEarned: { spear: 3 }, firstClear: false, endless: false, kills: 311 };

  const fsm = new ScreenFsm<GameFacade, ScreenId>(facade);
  fsm.register('title', createTitleScreen());
  fsm.register('lobby', createLobbyScreen());
  fsm.register('collection', createCollectionScreen());
  fsm.register('settings', createSettingsScreen());
  fsm.register('battle', createBattleHud());
  fsm.register('result', createResultScreen());
  fsm.goto('title');

  // --- 랩 조작 훅 -----------------------------------------------------------
  const gotoScreen = (id: ScreenId): void => {
    if (id === 'battle') facade.startBattle(1, false);
    else if (id === 'result') {
      facade.battle = null;
      if (!facade.lastResult) facade.lastResult = makeResult(true);
      fsm.goto('result');
    } else {
      facade.battle = null;
      fsm.goto(id);
    }
  };
  const showResult = (won: boolean): void => {
    facade.battle = null;
    facade.lastResult = makeResult(won);
    if (fsm.currentId() === 'result') fsm.goto('lobby'); // 강제 재진입
    fsm.goto('result');
  };
  const demoDamage = (): void => {
    const kinds: DamageKind[] = ['normal', 'normal', 'crit', 'poison', 'burn', 'heal', 'gold'];
    for (let i = 0; i < 12; i++) {
      const kind = kinds[i % kinds.length] ?? 'normal';
      const x = 40 + rng.next() * (window.innerWidth - 80);
      const y = 130 + rng.next() * Math.max(60, window.innerHeight - 340);
      const val = rng.int(8, 240);
      const text = kind === 'gold' ? `+${val}` : kind === 'heal' ? `+${rng.int(5, 40)}` : `${val}`;
      setTimeout(() => spawnDamageNumber(x, y, text, kind), i * 70);
    }
  };
  const demoModal = (): void => {
    showModal({
      title: '모달 데모',
      body: '반투명 배경 + 팝 등장 애니메이션.\n버튼 콜백도 동작합니다.',
      dismissible: true,
      buttons: [
        { label: '취소', kind: 'ghost' },
        { label: '확인', kind: 'primary', onTap: () => console.log('[uilab] 확인') },
      ],
    });
  };
  const toggleTowerSel = (): void => {
    selectedTower = selectedTower === null ? mockTower.id : null;
  };

  // --- 랩 크롬 (우상단, ui-root 밖 — 화면 전환과 무관하게 유지) --------------
  const select = h('select', {
    attrs: { style: 'width:100%;min-height:32px;font-size:12px' },
    onChange: (e) => gotoScreen((e.target as HTMLSelectElement).value as ScreenId),
  });
  (['title', 'lobby', 'collection', 'settings', 'battle', 'result'] as const).forEach((s) =>
    select.appendChild(h('option', { attrs: { value: s }, text: s })),
  );
  const labBtn = (label: string, onClick: () => void): HTMLElement =>
    h('button', {
      text: label,
      attrs: { type: 'button', style: 'min-height:30px;font-size:11px;background:#333;color:#eee;border:1px solid #666;border-radius:6px;padding:2px 6px;cursor:pointer' },
      onClick,
    });
  const panel = h(
    'div',
    { attrs: { style: 'display:none;flex-direction:column;gap:4px;background:rgba(10,10,10,.88);border:1px solid #555;border-radius:8px;padding:6px;width:140px' } },
    select,
    labBtn('데미지 숫자', demoDamage),
    labBtn('웨이브 배너', () => showWaveBanner(rng.int(2, 49))),
    labBtn('보스 배너', showBossBanner),
    labBtn('모달', demoModal),
    labBtn('타워선택 토글', toggleTowerSel),
    labBtn('결과: 승리', () => showResult(true)),
    labBtn('결과: 패배', () => showResult(false)),
  );
  const chrome = h(
    'div',
    { attrs: { id: 'uilab-chrome', style: 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 4px);right:4px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-family:monospace' } },
    h('button', {
      text: '🧪',
      attrs: { type: 'button', style: 'width:34px;height:34px;font-size:16px;background:rgba(10,10,10,.7);border:1px solid #555;border-radius:8px;cursor:pointer' },
      onClick: () => {
        panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
      },
    }),
    panel,
  );
  document.body.appendChild(chrome);

  // Playwright 자동화 훅
  (window as unknown as { __uilab: unknown }).__uilab = {
    goto: gotoScreen, showResult, demoDamage, demoModal, toggleTowerSel,
    waveBanner: showWaveBanner, bossBanner: showBossBanner,
    current: () => fsm.currentId(),
  };

  // --- 루프 -----------------------------------------------------------------
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (fsm.currentId() === 'battle' && facade.battle) driveBattle(dt);
    fsm.update(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
