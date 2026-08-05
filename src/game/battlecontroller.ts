/**
 * 전투 컨트롤러 — 고정 30Hz 시뮬레이션 + 보간 렌더 + BattleUiApi 구현.
 * 프레임 순서: 틱 진행 → 이벤트 연출 → 뷰 보간 갱신 → 렌더.
 */
import * as THREE from 'three';
import type {
  AllyId,
  BattleSim,
  BattleUiApi,
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
/** HUD 예약 영역 (카메라 플레이필드 fit용, CSS와 대략 일치) — 세로 레이아웃 */
const HUD_TOP_PX = 118;
const HUD_BOTTOM_RATIO = 0.27;
const HUD_BOTTOM_MIN_PX = 208;
/**
 * 가로모드(style.css: max-height 560px 압축 HUD)가 실제 차지하는 높이 근사.
 * 실측 HUD는 상단 96 / 하단 116(iPhone 13 landscape 750×342)이라 이 값보다 크지만,
 * 그만큼 예약하면 342px 높이에서 셀이 8.5→6.8px 로 줄어 오히려 못 쓰게 된다.
 * 실제로 상시 HUD 뒤로 내려가는 격자점은 165개 중 4개뿐이라 이 근사를 유지한다
 * (제거 패널은 상시 요소가 아니고, 배경이 포인터를 통과시켜 탭은 살아 있다).
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

export class BattleController {
  readonly api: BattleUiApi;
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
      requestUpgradeBase: () => {
        // 성공하면 baseUpgraded 이벤트가 연출/외형을, 여기서 사거리 링을 갱신한다
        if (self.sim.applyCommand({ type: 'upgradeBase' })) self.placement.refreshBaseSelection();
      },
      requestClearScenery: () => {
        const c = self.placement.selectedScenery();
        if (!c) return;
        // 성공 시 sceneryCleared 이벤트가 연출/선택 해제를 처리한다
        self.sim.applyCommand({ type: 'clearScenery', cellX: c.x, cellZ: c.z });
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
      // 버튼/수정키는 pointerdown 시점에 래치된 값 — 드래그 도중 모드가 바뀌지 않는다
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
    // 오버레이 인스턴스 한 메시 — 적/아군/타워 체력바 + 파괴 잔해 + 침묵 룬 (드로우콜 1)
    s3.healthbars.update(
      st.enemies,
      st.towers,
      alpha,
      s3.cellToWorld,
      s3.towerStatus.marks(),
      st.allies,
    );
    s3.projectiles.update(st.projectiles, alpha, dt);
    s3.towers.aim(st.towers, st.enemies, alpha);
    s3.update(dt);
    this.camera.update(realDt);
    this.renderer.render(s3.scene, this.camera.camera);
  }

  private fitBox = new THREE.Box3();

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
      } else if (ev.type === 'sceneryCleared') {
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
