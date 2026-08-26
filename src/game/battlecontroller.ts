/**
 * 전투 컨트롤러 — 고정 30Hz 시뮬레이션 + 보간 렌더 + BattleUiApi 구현.
 * 프레임 순서: 틱 진행 → 이벤트 연출 → 뷰 보간 갱신 → 렌더.
 */
import * as THREE from 'three';
import type {
  AllyId,
  BattleSim,
  BattleUiApi,
  EnemyId,
  ResultSummary,
  StageDef,
  TargetingMode,
  TowerId,
} from '@/data/types';
import { TICK_DT } from '@/data/types';
import { ALLY_DEFS, BASE_LEVELS, ENEMY_DEFS, TOWER_DEFS, makeWaveFor, ALL_TOWER_IDS } from '@/data';
import { createBattle } from '@/sim/battle';
import { FixedStepLoop } from '@/core/time';
import { requestWakeLock } from '@/core/device';
import { isTestMode } from '@/debug/harness';
import { audio } from '@/audio';
import { build, type Stage3D } from '@/render/stage3d';
import { DioramaCamera, type ViewportRect } from '@/render/camera';
import type { GameRenderer } from '@/render/renderer';
import type { QualityFlags } from '@/render/quality';
import type { Profile } from '@/meta/profile';
import { settleBattle } from '@/meta/rewards';
import { FxRouter } from './fx';
import { PlacementController } from './placement';

/** 자동 웨이브: prep 진입 후 2초(60틱) 지나면 자동 호출 */
const AUTO_CALL_AT_TICKS = 60;
/** prep 총 틱 — sim/battle.ts의 PREP_TICKS_FIRST/LATER와 일치해야 한다 */
const PREP_TICKS_FIRST = 150;
const PREP_TICKS_LATER = 90;
/** 승패 연출 후 결과 화면 전환 지연 */
const END_DELAY_MS = 1500;
/**
 * HUD 예약 영역 (카메라 플레이필드 fit용, CSS와 대략 일치) — 세로 레이아웃.
 *
 * ── 118 → 74 (상단 HUD가 두 줄에서 **한 줄**이 됐다) ────────────────────────
 * 사용자 요청으로 둘째 줄(.hud-hp: 하트·체력바·숫자)을 걷어냈다. 이 값을 같이
 * 줄이지 않으면 없앤 줄만큼 판이 넓어지지 않는다 — 넓어지는 것이 이 작업의 목적이다.
 *
 * 실측(?test=1 · `.hud-top` 의 getBoundingClientRect().bottom):
 *   개정 전  10(.col 위 여백) + 48(첫 줄) + 8(gap) + 32(HP 줄) = 98
 *   개정 후  10 + 48 = **58**            ← 폭 > 480px
 *            10 + 42 = 52                ← 폭 ≤ 480px (칩 압축)
 *            10 + 40 = 50                ← 폭 ≤ 420px (낱말 접기까지)
 * 즉 예약해야 할 최대치는 58이다. 74는 거기에 개정 전과 같은 비율의 여유
 * (118/98 ≈ 1.20 → 58×1.28)를 남긴 값이다. 여유를 남기는 이유는 노치 기기의
 * safe-area-inset-top 이 이 상수에 반영되지 않기 때문이고, 그 한계는 개정 전에도
 * 똑같았다(노치 47px이면 개정 전 실측도 145 > 118이었다).
 */
const HUD_TOP_PX = 74;
const HUD_BOTTOM_RATIO = 0.27;
const HUD_BOTTOM_MIN_PX = 208;
/**
 * 가로모드(style.css: max-height 560px 압축 HUD)가 실제 차지하는 높이 근사.
 * 하단(116 실측)은 여전히 이 값보다 크지만, 그만큼 예약하면 342px 높이에서 셀이
 * 8.5→6.8px 로 줄어 오히려 못 쓰게 된다. 실제로 상시 HUD 뒤로 내려가는 격자점은
 * 165개 중 4개뿐이라 하단은 이 근사를 유지한다 (제거 패널은 상시 요소가 아니고,
 * 배경이 포인터를 통과시켜 탭은 살아 있다).
 *
 * **상단은 더 이상 근사가 아니다.** HP 줄을 걷어내면서 실측이 96 → 58로 내려가
 * (750×342 실측: 여백 10 + 첫 줄 48) 이 상수가 처음으로 실측을 덮는다.
 * 64는 그 58을 덮으면서 남는 여유가 6px이라 그대로 둔다 — 줄이면 얻는 건 6px인데
 * 노치(safe-area) 기기에서 곧바로 모자라진다.
 */
const LANDSCAPE_MAX_CSS_H = 560;
const HUD_TOP_LANDSCAPE_PX = 64;
const HUD_BOTTOM_LANDSCAPE_PX = 84;

const DEG = Math.PI / 180;
/** 데스크톱 궤도 드래그 감도 — 요 허용폭 80°를 약 290px에 매핑 */
const ORBIT_YAW_PER_PX = 0.28 * DEG;
/** 피치 허용폭 32°를 약 180px에 매핑 (세로 화면에서 손가락이 짧다) */
const ORBIT_PITCH_PER_PX = 0.18 * DEG;
/** 두 손가락 트위스트 → 요. 1 = 손가락 회전각과 1:1 */
const PINCH_TWIST_GAIN = 1;

/**
 * `BattleUiApi`에 없는 **채집 보내기** 한 줄 (gather-spec §7-1 보조 입구).
 *
 * 계약(`data/types.ts BattleUiApi`)에 안 넣은 이유: 그 파일은 이 트랙이 손대지 않는
 * `src/data/**`이고, HUD 쪽은 이미 "계약에 없는 것은 **선택 확장 인터페이스로 기능
 * 감지**한다"는 규약을 갖고 있다(battlehud.ts 헤더의 selectedTower/requestSetTargeting).
 * 그래서 여기서도 같은 규약을 쓴다 — 목 UI(debug/labs/uilab)는 이 메서드가 없어도 돈다.
 *
 * ⚠ **새 커맨드가 아니다.** 보내는 것은 판 위 탭과 **완전히 같은** `moveAlly`이고
 *   `defId`를 안 실어 후보를 전 종족으로 연다. 누구를 보낼지는 sim이 고른다(D7).
 */
export interface BattleGatherApi {
  requestGatherAt(cellX: number, cellZ: number): void;
  /**
   * 자원 패널의 계산에만 쓰는 판 상수 둘 — 마을 셀(짐을 지고 갈 거리)과 격자 폭
   * (셀 키 = cellZ * gridW + cellX, `AllyState.gatherKey`와 맞춰 보는 데 필요하다).
   * `BattleStateView`에 둘 다 없고 그 파일은 이 트랙이 안 건드리므로 여기로 낸다.
   * **게임 규칙은 하나도 안 실린다** — 화면에 적을 숫자의 재료일 뿐이다.
   */
  gatherRefs(): { baseX: number; baseZ: number; gridW: number };
}

/**
 * **집결** — 계약(`BattleUiApi`)에 없는 조작이라 채집 둘과 같은 확장으로 낸다.
 * `src/data/types.ts` 를 넓히지 않은 이유: sim 은 이 개념을 모른다.
 * 구현은 기존 `moveAlly`(allyId −1 = 전원)를 마을 셀로 한 번 발행하는 것이 전부라
 * (sim 0줄) 계약에 얹을 만한 새 능력이 아니다. HUD 는 없으면 버튼을 안 그린다.
 */
export interface BattleRallyApi {
  requestRallyAllies(): void;
}

export class BattleController {
  readonly api: BattleUiApi & BattleGatherApi & BattleRallyApi;
  readonly sim: BattleSim;
  readonly stage3d: Stage3D;
  readonly camera = new DioramaCamera();

  private loop = new FixedStepLoop(TICK_DT);
  private fx: FxRouter;
  private placement: PlacementController;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private ended = false;
  private disposed = false;
  private wakeLock: WakeLockSentinel | null = null;
  private startMs = performance.now();

  constructor(
    private renderer: GameRenderer,
    private canvas: HTMLCanvasElement,
    private profile: Profile,
    readonly stage: StageDef,
    readonly endless: boolean,
    quality: QualityFlags,
    private onEnded: (result: ResultSummary) => void,
    private onQuit: () => void,
  ) {
    const stars: Partial<Record<TowerId, number>> = {};
    const deck: TowerId[] = [];
    for (const id of ALL_TOWER_IDS) {
      const tp = profile.data.towers[id];
      if (tp.unlocked) {
        deck.push(id);
        stars[id] = tp.stars;
      }
    }
    const seed = ((Date.now() & 0xffffffff) ^ (stage.id * 0x9e3779b9)) >>> 0;
    this.sim = createBattle({
      stage,
      stars,
      deck,
      endless,
      seed,
      towerDefs: TOWER_DEFS,
      enemyDefs: ENEMY_DEFS,
      allyDefs: ALLY_DEFS,
      baseLevels: BASE_LEVELS,
      waveFor: makeWaveFor(stage),
    });

    this.stage3d = build(stage, quality);
    // 마을은 Lv1(움막 하나) 크기로 시작한다 — 레벨업 때마다 baseUpgraded가 키운다
    this.stage3d.setBaseLevel(this.sim.state.baseLevel);
    // 지속 상태 표식(파괴 잔해 + 침묵 룬)은 sim 타워 배열을 직접 읽는다.
    // stage3d.update(dt)에서 돌아가므로 테스트 훅 stepFx()로도 시간이 흐른다.
    this.stage3d.towerStatus.setTowers(this.sim.state.towers);
    this.placement = new PlacementController(
      canvas,
      this.camera,
      this.sim,
      stage,
      this.stage3d,
      stars,
    );
    this.fx = new FxRouter(
      this.stage3d,
      this.camera,
      canvas,
      () => this.sim.state.waveCount,
      endless,
      profile.data.settings.vibration,
    );
    // 기지 최대 HP는 홈타운 Lv1 배율이 걸린 값이다 — stage.baseHp를 그대로 쓰면
    // Lv1 hpMul이 1이 아닌 테이블에서 피해 외형 단계가 어긋난다 (레벨업 시 baseUpgraded가 갱신)
    this.fx.baseHpMax = this.sim.state.baseHpMax;
    // 문간 피해 숫자를 마을 머리 위에 띄우는 데 쓴다 — 좌표를 아는 쪽이 넘긴다
    // (`requestRallyAllies` 가 baseCell 을 채우는 것과 같은 이유: UI/연출은 판을 모른다)
    this.fx.baseCell = { x: this.stage.baseCell.x, z: this.stage.baseCell.z };
    this.fx.towerCellLookup = (id) => {
      const t = this.sim.state.towers.find((tw) => tw.id === id);
      return t ? { x: t.cellX, z: t.cellZ } : null;
    };

    const self = this;
    this.api = {
      sim: this.sim,
      get paused() {
        return self.loop.paused;
      },
      set paused(v: boolean) {
        self.loop.paused = v;
      },
      get speed() {
        return self.loop.speed as 1 | 2 | 4;
      },
      set speed(v: 1 | 2 | 4) {
        self.loop.speed = v;
      },
      autoWave: false,
      selectCard: (i) => self.placement.selectCard(i),
      selectedCard: () => self.placement.selectedCard(),
      selectedTower: () => self.placement.selectedTower(),
      selectedScenery: () => self.placement.selectedScenery(),
      selectedBase: () => self.placement.selectedBase(),
      selectBase: () => self.placement.selectBase(),
      selectedAlly: () => self.placement.selectedAlly(),
      clearAllySelection: () => self.placement.clearAllySelection(),
      requestUpgradeBase: () => {
        // 성공하면 baseUpgraded 이벤트가 연출/외형을, 여기서 사거리 링을 갱신한다
        if (self.sim.applyCommand({ type: 'upgradeBase' })) self.placement.refreshBaseSelection();
      },
      reportPanelTop: (y) => {
        self.panelTopPx = y;
      },
      requestClearScenery: () => {
        const c = self.placement.selectedScenery();
        if (!c) return;
        // 성공 시 sceneryCleared 이벤트가 연출/선택 해제를 처리한다
        self.sim.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z });
      },
      gatherRefs: () => ({
        baseX: self.stage.baseCell.x,
        baseZ: self.stage.baseCell.z,
        gridW: self.stage.gridW,
      }),
      requestGatherAt: (cellX: number, cellZ: number) => {
        // 자원 패널의 [채집 보내기] — 웨이브 중의 주 경로다(§7-1 보조 입구, 1탭).
        // **판 위 탭과 같은 커맨드**를 쓰고 `defId`를 안 싣는다 = 후보가 전 종족이고,
        // 그중 누구를 보낼지는 sim이 고른다(gatherPct 내림차순 → id 오름차순).
        if (!self.sim.applyCommand({ type: 'moveAlly', allyId: -1, cellX, cellZ })) return;
        audio.play('uiTap');
        // 탭한 그 칸의 선택 링이 **금색 목표 표식으로 갈아 끼워진다** — 같은 메시라
        // 드로우콜이 안 늘고(§7-2), 손가락 밑에서 색이 바뀌는 것이 "먹혔다"의 신호가 된다.
        self.stage3d.decals.showGatherOrder(cellX, cellZ);
        // 커맨드가 tick() 밖에서 돌았으므로 이벤트를 지금 흘려보낸다 (e2e 훅과 같은 규약)
        self.processEvents();
      },
      clearSelection: () => {
        self.placement.clearScenerySelection();
        self.placement.clearTowerSelection();
        self.placement.clearBaseSelection();
      },
      requestSetTargeting: (mode: TargetingMode) => {
        const id = self.placement.selectedTower();
        if (id !== null) self.sim.applyCommand({ type: 'setTargeting', towerId: id, mode });
      },
      requestTrainAlly: (defId: AllyId) => {
        // 경로는 sim이 결정론적으로 고른다 (allies.ts 규칙 1) — UI는 종만 고른다
        if (self.sim.applyCommand({ type: 'trainAlly', defId })) audio.play('uiTap');
      },
      requestRallyAllies: () => {
        /*
         * 집결 — 살아 있는 부족원 **전원**을 마을 셀로. sim 은 한 줄도 안 늘었다:
         * 기존 moveAlly 의 "allyId −1 + defId 생략 = 전원" 갈래를 그대로 쓴다
         * (types.ts BattleCommand.moveAlly 주석 참조).
         *
         * ⚠ 문간이 들어온 뒤로 이 버튼의 **뜻이 바뀌었다.** gate-wip 에서는 "부족원을
         *   앞으로 보내 보스를 붙잡는다"였고 실전 활성 0% 로 실패했다(부족원이 스폰 즉시
         *   걸어 나가 보스 도착 전에 죽는다). 이번 설계는 집결점(마을 앞 1.4/2.0)과
         *   문간선(1.85~2.99)이 기하로 겹쳐 마을 앞의 부족원이 **태어난 자리에서**
         *   문 앞의 적을 붙잡는다 — 곧 "붙잡으러 보내는" 조작이 필요 없다.
         *   지금 이 버튼이 파는 것은 **자원 칸으로 캐러 나간 일꾼을 되부르는 것**이다.
         *
         * 판 위 선택을 먼저 푸는 이유: 부족 선택이 살아 있으면 **다음 캔버스 탭이
         * 또 하나의 moveAlly 가 된다**(placement.ts). 집결시켜 놓고 화면을 한 번
         * 만졌다가 방금 부른 전원이 엉뚱한 칸으로 되돌아 나가는 사고가 그것이다.
         *
         * 아무도 안 나가 있으면 moveAlly 가 false 를 돌려주고 소리도 안 난다 —
         * 눌린 척하지 않는다.
         */
        self.placement.clearAllySelection();
        const ok = self.sim.applyCommand({
          type: 'moveAlly',
          allyId: -1,
          cellX: self.stage.baseCell.x,
          cellZ: self.stage.baseCell.z,
        });
        if (ok) audio.play('uiTap');
      },
      requestRefresh: () => {
        if (self.sim.applyCommand({ type: 'refreshHand' })) audio.play('cardRefresh');
      },
      requestCallWave: () => {
        self.sim.applyCommand({ type: 'callWave' });
      },
      requestUpgradeSelected: () => {
        const id = self.placement.selectedTower();
        if (id !== null && self.sim.applyCommand({ type: 'upgradeTower', towerId: id })) {
          self.placement.refreshSelection();
        }
      },
      requestSellSelected: () => {
        const id = self.placement.selectedTower();
        if (id !== null && self.sim.applyCommand({ type: 'sellTower', towerId: id })) {
          self.placement.clearTowerSelection();
        }
      },
      quitToLobby: () => this.quit(),
      retry: () => {
        /* 결과 화면에서 startBattle 재호출로 처리 */
      },
    };

    // 카메라 제스처
    //  · 휠 / 두 손가락 거리 → 줌
    //  · 두 손가락 트위스트 → 요, 두 손가락 상하 이동 → 피치
    //  · 좌드래그 → 팬(줌 상태에서), 우드래그 / Shift+드래그 → 궤도 회전
    const input = this.placement.input;
    input.events.on('wheel', (w) => {
      this.camera.zoomBy(w.deltaY < 0 ? 1.12 : 1 / 1.12);
    });
    input.events.on('pinch', (p) => {
      this.camera.zoomBy(p.scale);
      // 손가락을 시계방향으로 비틀면 월드도 시계방향으로 — 카메라는 반대로 돈다.
      // 두 손가락을 아래로 내리면 탑다운(피치 ↑), 올리면 낮은 시점(피치 ↓).
      this.camera.orbitBy(-p.rotate * PINCH_TWIST_GAIN, p.panY * ORBIT_PITCH_PER_PX);
    });
    let lastDragX = 0;
    let lastDragY = 0;
    let orbitDrag = false;
    input.events.on('dragStart', (i) => {
      lastDragX = i.x;
      lastDragY = i.y;
      // 버튼/수정키는 pointerdown 시점에 래치된 값 — 드래그 도중 모드가 바뀌지 않는다.
      // ⚠ **우클릭이 명령이 된 뒤에도 이 줄은 그대로다**(10단계). 우버튼의 두 뜻은
      //   `core/input.ts onUp`이 분기 하나로 갈라 놓는다: 임계값을 넘겼으면 dragEnd(=여기,
      //   궤도 회전)이고, 안 넘겼으면 contextTap(= placement의 명령)이다. 곧 한 제스처가
      //   양쪽으로 가는 일이 없다 — 여기서 `button === 2`를 빼면 화면을 못 돌리게 된다.
      orbitDrag = i.button === 2 || i.shiftKey;
    });
    input.events.on('drag', (i) => {
      const dx = i.x - lastDragX;
      const dy = i.y - lastDragY;
      lastDragX = i.x;
      lastDragY = i.y;
      if (orbitDrag) {
        // 오른쪽으로 끌면 섬의 앞면이 오른쪽으로 돌아간다 (턴테이블 관례)
        this.camera.orbitBy(dx * ORBIT_YAW_PER_PX, dy * ORBIT_PITCH_PER_PX);
        return;
      }
      // 카드 선택 중 좌드래그는 배치 조준 — 카메라 팬과 충돌하지 않게 스킵
      if (this.placement.selectedCard() !== null) return;
      this.camera.panByPixels(dx, dy);
    });

    audio.music.setBiome(stage.biome);
    audio.music.setIntensity(1);
    if (!audio.music.isPlaying) audio.music.start();
    this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.installTestHooks();
  }

  /** 화면 꺼짐 방지 — dispose 이후 도착한 락은 즉시 반납 */
  private acquireWakeLock(): void {
    void requestWakeLock().then((wl) => {
      if (!wl) return;
      if (this.disposed) {
        void wl.release().catch(() => undefined);
        return;
      }
      this.wakeLock = wl;
    });
  }

  /** 백그라운드 전환 시 브라우저가 락을 해제한다 — 복귀하면 재요청 */
  private onVisibilityChange = (): void => {
    if (
      document.visibilityState === 'visible' &&
      (this.wakeLock === null || this.wakeLock.released)
    ) {
      this.acquireWakeLock();
    }
  };

  private lastFrameSec = -1;

  /** 매 rAF 호출 (nowSec = performance.now()/1000) */
  frame(nowSec: number): void {
    if (this.disposed) return;
    // 카메라(궤도 보간/흔들림)는 실제 경과 시간을 쓴다 — 일시정지·배속에서도
    // 시점 조절 손맛이 같아야 하고, 일시정지 중 ticks=0이면 보간이 멈춘다
    const realDt = this.lastFrameSec < 0 ? 1 / 60 : Math.min(0.1, nowSec - this.lastFrameSec);
    this.lastFrameSec = nowSec;
    const { ticks, alpha } = this.loop.update(nowSec);
    const st = this.sim.state;

    // 자동 웨이브: prep 2초 경과 시 자동 호출
    if (
      this.api.autoWave &&
      st.phase === 'prep' &&
      st.prepTicksLeft > 0 &&
      st.prepTicksLeft <=
        (st.waveIndex === 1 ? PREP_TICKS_FIRST : PREP_TICKS_LATER) - AUTO_CALL_AT_TICKS
    ) {
      this.sim.applyCommand({ type: 'callWave' });
    }

    for (let i = 0; i < ticks; i++) this.sim.tick();
    this.processEvents();

    // 뷰 갱신 (보간)
    const dt = Math.min(0.1, ticks * TICK_DT + 0.0001);
    const s3 = this.stage3d;
    // 아군은 적 습격대와 같은 InstancedMesh에 얹혀 그려진다 (드로우콜 증가 0)
    s3.enemies.update(st.enemies, alpha, s3.cellToWorld, dt, st.allies);
    // 오버레이 인스턴스 한 메시 — 적/아군/타워/기지 체력바 + 파괴 잔해 + 침묵 룬 (드로우콜 1)
    // 기지 바는 HUD 둘째 줄(하트+체력바)을 대신한다 — 타워와 같은 규칙(만피면 안 그린다)
    s3.healthbars.update(
      st.enemies,
      st.towers,
      alpha,
      s3.cellToWorld,
      s3.towerStatus.marks(),
      st.allies,
      {
        cellX: this.stage.baseCell.x,
        cellZ: this.stage.baseCell.z,
        hp: st.baseHp,
        maxHp: st.baseHpMax,
        level: st.baseLevel,
      },
      // 채집 표시(게이지·짐 칩·자원 배지)도 **같은 인스턴스 메시**에 얹힌다 —
      // 새 메시가 0개라 드로우콜이 안 는다(views/healthbars.ts 헤더).
      // 금색 배지를 언제 켜는지는 placement가 안다(무엇을 고르고 있는가).
      {
        cells: st.resources,
        gridW: this.stage.gridW,
        selecting: this.placement.showingResourceBadges(),
      },
    );
    s3.projectiles.update(st.projectiles, alpha, dt);
    s3.towers.aim(st.towers, st.enemies, alpha);
    // 부족 사거리 바운더리는 **걸어가는 사람을 따라간다** — 매 프레임 다시 굽지 않으면
    // 유닛은 떠났는데 원만 스폰 자리에 남는다. 지점·반경이 그대로면 굽지 않는다
    // (decals.showAllyRanges가 서명으로 걸러낸다) 무선택이면 즉시 반환한다.
    this.placement.refreshAllySelection();
    s3.update(dt);
    this.updatePanelLift();
    this.camera.update(realDt);
    this.renderer.render(s3.scene, this.camera.camera);
  }

  private fitBox = new THREE.Box3();
  /** UI가 알려 준 하단 패널의 화면 y (닫혔으면 null) — reportPanelTop */
  private panelTopPx: number | null = null;
  /** 마지막 fit에 쓴 플레이필드 창의 위쪽 y — 비켜서기 상한의 기준 */
  private fitRectTop = 0;
  /** 비켜선 뒤 관심 지점과 패널 사이에 남길 여백 (px) */
  private static readonly LIFT_MARGIN_PX = 14;

  /**
   * 마을 패널이 마을 셀·출격 봉수대를 덮으면 판을 그만큼 위로 비켜세운다 (8단계).
   * 필요량은 **비켜서기를 되돌린 좌표**로 잰다(현재 화면 y + 지금 적용된 lift) —
   * 그러지 않으면 "덮였나?"의 답이 자기 자신의 결과에 의존해 진동한다.
   */
  private updatePanelLift(): void {
    const top = this.panelTopPx;
    if (top === null || !this.placement.selectedBase()) {
      this.camera.setLift(0);
      return;
    }
    const applied = this.camera.liftPx;
    // 9단계: 예전에는 출격 한계선 표식들까지 함께 보이게 들어 올렸다. 한계선이 없어져
    // 마을 패널이 가리면 안 되는 관심 지점은 **기지 셀 하나**뿐이다.
    const lowest = this.cellScreenY(this.stage.baseCell.x, this.stage.baseCell.z) + applied;
    const need = lowest + BattleController.LIFT_MARGIN_PX - top;
    // 상한: 관심 지점이 **상단 HUD 예약 밑**까지만 올라간다. 그 위로 더 밀면
    // 보이지도 않는 곳으로 판을 던지는 셈이고, 스폰 쪽이 필요 이상으로 잘린다.
    const max = Math.max(0, lowest - (this.fitRectTop + BattleController.LIFT_MARGIN_PX));
    this.camera.setLift(Math.max(0, Math.min(need, max)));
  }

  private liftProbe = new THREE.Vector3();

  /** 셀 → 화면 y (CSS px). cellToScreen(테스트 훅)과 같은 투영을 쓴다 */
  private cellScreenY(x: number, z: number): number {
    const v = this.liftProbe;
    this.stage3d.cellToWorld(x, z, v);
    v.project(this.camera.camera);
    const r = this.canvas.getBoundingClientRect();
    return r.top + (-v.y * 0.5 + 0.5) * r.height;
  }

  resize(cssW: number, cssH: number): void {
    // 낮은 높이(가로모드)에서는 세로형 예약값(118/27%/208)이 화면 대부분을 잡아먹어
    // 섬이 손톱만 해진다 — 압축 HUD 실측 근사값으로 전환
    const landscape = cssH <= LANDSCAPE_MAX_CSS_H;
    const top = landscape ? HUD_TOP_LANDSCAPE_PX : HUD_TOP_PX;
    const bottom = landscape
      ? HUD_BOTTOM_LANDSCAPE_PX
      : Math.max(HUD_BOTTOM_MIN_PX, cssH * HUD_BOTTOM_RATIO);
    const rect: ViewportRect = {
      x: 8,
      y: top,
      w: Math.max(1, cssW - 16),
      h: Math.max(1, cssH - top - bottom),
    };
    // 절벽 스커트/수중 바위는 프레이밍에서 제외 — 지표면 기준으로 크게 잡는다
    this.fitBox.copy(this.stage3d.aabb);
    this.fitBox.min.y = Math.max(this.fitBox.min.y, -0.9);
    this.fitBox.max.y = Math.max(this.fitBox.max.y, 1.4);
    this.fitRectTop = rect.y;
    this.camera.fitToPlayfield(this.fitBox, rect, cssW, cssH);
  }

  /** 이벤트 소비 — frame()과 테스트 훅 ff()가 같은 경로를 쓴다 */
  private processEvents(): void {
    const events = this.sim.drainEvents();
    if (events.length === 0) return;
    this.fx.handle(events);
    for (const ev of events) {
      if (ev.type === 'battleEnded') this.scheduleEnd(ev.won);
      else if (
        ev.type === 'towerSold' ||
        ev.type === 'towerUpgraded' ||
        // 파괴된 타워가 선택 중이었다면 패널/사거리 링을 정리해야 한다
        ev.type === 'towerDestroyed'
      ) {
        this.placement.refreshSelection();
      } else if (ev.type === 'sceneryCleared' || ev.type === 'gathered') {
        /*
         * 소품이 사라지면 그 칸의 **제거 패널**(380골드 안내)이 거짓이 된다.
         * ⚠ `gathered` 가 여기 온 것이 이번 개정이다 — R1로 다 캔 칸이 사라지고
         *   건설 가능해지면서 `hasScenery` 가 그 자리에서 false 가 된다(clearSceneryCost
         *   도 함께 null 이 된다, E-R4). 이 줄이 없으면 방금 캔 칸에 "치우기 380골드"
         *   패널이 그대로 떠 있고, 누르면 아무 일도 안 일어난다.
         * 재생(gatherRegrown)은 반대 방향이라 여기 필요 없다 — 소품이 **없던** 칸이
         *   생기는 것이고, 그 칸은 애초에 선택돼 있을 수 없다.
         */
        this.placement.refreshScenerySelection();
      }
    }
  }

  private scheduleEnd(won: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.endTimer = setTimeout(() => {
      if (this.disposed) return;
      const st = this.sim.state;
      // settleBattle이 프로필을 저장하므로 플레이타임을 먼저 반영해야 유실되지 않는다
      this.trackPlaytime();
      const result = settleBattle(this.profile, this.stage, {
        won,
        wave: st.waveIndex,
        endless: this.endless,
        amberEarned: st.amberEarned,
        kills: this.fx.kills,
        bossKills: this.fx.bossKills,
      });
      this.onEnded(result);
    }, END_DELAY_MS);
  }

  private quit(): void {
    if (this.ended) return;
    this.ended = true;
    // 중도 포기 — 진행한 웨이브까지 정산 (패배 취급)
    const st = this.sim.state;
    this.trackPlaytime();
    const result = settleBattle(this.profile, this.stage, {
      won: false,
      wave: st.waveIndex,
      endless: this.endless,
      amberEarned: st.amberEarned,
      kills: this.fx.kills,
      bossKills: this.fx.bossKills,
    });
    void result;
    this.onQuit();
  }

  /** 외부 강제 종료(WebGL 컨텍스트 복구 등) — quit 경로 재사용, 이미 종료면 no-op */
  forceQuit(): void {
    this.quit();
  }

  private trackPlaytime(): void {
    this.profile.data.stats.playMs += performance.now() - this.startMs;
  }

  private installTestHooks(): void {
    if (!isTestMode()) return;
    (window as unknown as Record<string, unknown>)['__wgd'] = {
      sim: this.sim,
      ff: (n: number): void => {
        for (let i = 0; i < n; i++) this.sim.tick();
        this.processEvents();
      },
      place: (handIndex: number, x: number, z: number): boolean =>
        this.sim.applyCommand({ type: 'placeTower', handIndex, cellX: x, cellZ: z }),
      callWave: (): boolean => this.sim.applyCommand({ type: 'callWave' }),
      drawCalls: (): number => this.renderer.gl.info.render.calls,
      /*
       * **계측의 증인** — 이 프레임을 잰 조건이 정말 우리가 재려던 조건인가.
       *  · shadowsOn : three 의 실제 상태(gl.shadowMap.enabled). false 면 그림자 패스가
       *    안 돈 것이고, 그 표본의 삼각형은 "그림자 포함 최악"이 아니다.
       *  · degradeCount : 측정 중 품질 강등이 몇 번 불렸나. 0 이 아니면 표본 사이에
       *    조건이 바뀐 것이라 **곡선을 나란히 읽을 수 없다**.
       * 둘 다 재현 조건을 묻는 것이지 값이 아니다 — 예산 어서션 옆에 같이 건다.
       */
      // 최악 프레임 레시피가 **해금 덱과 무관하게** 전 종을 세우기 위한 목록.
      // 신규 프로필 덱은 3종뿐이라 이것 없이는 나머지가 한 기도 안 선다.
      allTowerIds: (): readonly string[] => ALL_TOWER_IDS,
      shadowsOn: (): boolean => this.renderer.gl.shadowMap.enabled,
      degradeCount: (): number => this.renderer.degradeCount,
      renderInfo: (): { calls: number; triangles: number; geometries: number; textures: number } => ({
        calls: this.renderer.gl.info.render.calls,
        triangles: this.renderer.gl.info.render.triangles,
        geometries: this.renderer.gl.info.memory.geometries,
        textures: this.renderer.gl.info.memory.textures,
      }),
      // 연출 검증용: 루프를 멈춘 채 파티클/카메라 시간만 수동으로 진행시켜
      // 착탄 직후 프레임을 정확한 간격으로 캡처한다
      pause: (v: boolean): void => {
        this.loop.paused = v;
      },
      stepFx: (sec: number): void => {
        this.stage3d.update(sec);
        // 투척물(습격대가 던진 것)은 stage3d.update 가 아니라 프레임 루프가 굴린다 —
        // 멈춘 채 한 틱씩 걸어가며 "정말 날아가서 맞는가"를 보려면 여기서도 밀어 줘야 한다
        this.stage3d.projectiles.update(this.sim.state.projectiles, 1, sec);
        this.camera.update(sec);
      },
      // 카메라 궤도 검증용
      camState: (): { yawDeg: number; pitchDeg: number; zoom: number } => ({
        yawDeg: this.camera.yaw / DEG,
        pitchDeg: this.camera.pitch / DEG,
        zoom: this.camera.zoom,
      }),
      resetView: (): void => this.camera.resetView(),
      // 입력/뷰포트 검증용 (모바일 e2e)
      selectCard: (i: number | null): void => this.api.selectCard(i),
      selectedCard: (): number | null => this.api.selectedCard(),
      // 타워 파괴 시 선택 패널/사거리 링이 정리되는지 검증용
      selectedTower: (): number | null => this.api.selectedTower(),
      // 부족 선택(판 위 탭 → 같은 종족 전체) 검증용 — 조작이 전부 캔버스에서 일어나므로
      // DOM으로는 관찰할 방법이 없다
      selectedAlly: (): AllyId | null => this.api.selectedAlly?.() ?? null,
      // 지형지물 제거 검증용
      selectedScenery: (): { x: number; z: number } | null => this.api.selectedScenery(),
      sceneryList: (): { x: number; z: number }[] => {
        const out: { x: number; z: number }[] = [];
        for (let z = 0; z < this.stage.gridH; z++) {
          for (let x = 0; x < this.stage.gridW; x++) {
            if (this.sim.hasScenery(x, z)) out.push({ x, z });
          }
        }
        return out;
      },
      clearSceneryCost: (x: number, z: number): number | null =>
        this.sim.clearSceneryCost(x, z),
      clearScenery: (x: number, z: number): boolean => {
        const ok = this.sim.applyCommand({ type: 'clearScenery', cellX: x, cellZ: z });
        this.processEvents();
        return ok;
      },
      // 지속 표식(파괴 잔해)을 타워 구성을 바꾸지 않고 얹는다 — 드로우콜 A/B 통제용
      markRubble: (x: number, z: number, tier = 0): void => {
        this.stage3d.towerStatus.markDestroyed(x, z, tier);
      },
      clearRubble: (x: number, z: number): void => {
        this.stage3d.towerStatus.clearCell(x, z);
      },
      // 아군 출동 검증용 — 상한/골드 거부까지 그대로 밟는다
      trainAlly: (defId: AllyId): boolean => {
        const ok = this.sim.applyCommand({ type: 'trainAlly', defId });
        this.processEvents();
        return ok;
      },
      allyCost: (defId: AllyId): number => this.sim.allyCost(defId),
      /*
       * ── 문간 검증 창 (e2e 전용) ──────────────────────────────────────────
       * 문간 띠와 집결 버튼은 DOM 이라 Playwright 가 직접 읽지만, "지금 문 앞에
       * 누가 얼마나 섰는가"는 sim 상태라 창이 따로 필요하다(src/sim/gate.ts).
       */
      gateEnemies: (): {
        id: number;
        defId: EnemyId;
        gateTicks: number;
        owed: number;
        cdLeft: number;
        blockerAllyId: number;
      }[] =>
        this.sim.state.enemies
          .filter((e) => e.alive && e.gateTicks > 0)
          .map((e) => ({
            id: e.id,
            defId: e.defId,
            gateTicks: e.gateTicks,
            owed: e.gateOwed,
            cdLeft: e.gateBiteCdLeft,
            blockerAllyId: e.blockerAllyId,
          })),
      /*
       * 연출 계측용 — 문간 한 입의 지붕 파편처럼 **작고 가려지는** 연출은 캡처로
       * 못 닫는다(0.062타일 ≈ 3px, 게다가 문 앞 큰 놈의 몸통 뒤다). 개수로 닫는다.
       * 누적 쪽(spawnedTotal)은 풀 포화·앰비언트에 안 타므로 두 읽기 사이에 프레임을
       * 안 끼우면 "이 한 틱의 사건이 낸 파티클"만 갈라진다.
       */
      particleCount: (): number => this.stage3d.particles.liveCount,
      particlesSpawned: (): number => this.stage3d.particles.spawnedTotal,
      /*
       * 계측 격리용 — 타워가 쏘는 동안에는 궤적·불티가 매 틱 섞여 들어와 지붕 파편을
       * 갈라낼 수 없다. 문 앞 대치 자체는 타워와 무관하게 그대로 선다.
       */
      sellAllTowers: (): number => {
        let n = 0;
        for (const t of [...this.sim.state.towers]) {
          if (this.sim.applyCommand({ type: 'sellTower', towerId: t.id })) n++;
        }
        this.processEvents();
        return n;
      },
      rallyAllies: (): void => {
        this.api.requestRallyAllies();
        this.processEvents();
      },
      canTrainAlly: (defId: AllyId): boolean => this.sim.canTrainAlly(defId),
      // 홈타운 방어/레벨업 검증용 — 최대 레벨·골드 부족 거부까지 그대로 밟는다
      baseInfo: (): {
        level: number;
        levelMax: number;
        hp: number;
        hpMax: number;
        range: number;
        cost: number | null;
        can: boolean;
        cell: { x: number; z: number };
      } => ({
        level: this.sim.state.baseLevel,
        levelMax: this.sim.state.baseLevelMax,
        hp: this.sim.state.baseHp,
        hpMax: this.sim.state.baseHpMax,
        range: this.sim.baseRange(),
        cost: this.sim.baseUpgradeCost(),
        can: this.sim.canUpgradeBase(),
        cell: { x: this.stage.baseCell.x, z: this.stage.baseCell.z },
      }),
      upgradeBase: (): boolean => {
        const ok = this.sim.applyCommand({ type: 'upgradeBase' });
        this.processEvents();
        return ok;
      },
      selectedBase: (): boolean => this.api.selectedBase(),
      damageBase: (n: number): void => {
        // HP 처리 정책 검증용 — 누수를 기다리지 않고 기지에 상처를 낸다
        (this.sim.state as { baseHp: number }).baseHp = Math.max(1, this.sim.state.baseHp - n);
      },
      allies: (): { id: number; defId: AllyId; hp: number; x: number; z: number; targetId: number }[] =>
        this.sim.state.allies.map((a) => ({
          id: a.id,
          defId: a.defId,
          hp: a.hp,
          x: a.x,
          z: a.z,
          targetId: a.targetId,
        })),
      setGold: (g: number): void => {
        // 골드 부족/충분 분기 검증용 — 테스트 모드에서만 노출된다
        (this.sim.state as { gold: number }).gold = g;
      },
      cellToScreen: (x: number, z: number): { x: number; y: number } => {
        const v = new THREE.Vector3();
        this.stage3d.cellToWorld(x, z, v);
        v.project(this.camera.camera);
        const r = this.canvas.getBoundingClientRect();
        return {
          x: r.left + (v.x * 0.5 + 0.5) * r.width,
          y: r.top + (-v.y * 0.5 + 0.5) * r.height,
        };
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.endTimer) clearTimeout(this.endTimer);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.placement.dispose();
    this.stage3d.dispose();
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }
}
