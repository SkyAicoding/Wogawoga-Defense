/**
 * 전투 컨트롤러 — 고정 30Hz 시뮬레이션 + 보간 렌더 + BattleUiApi 구현.
 * 프레임 순서: 틱 진행 → 이벤트 연출 → 뷰 보간 갱신 → 렌더.
 */
import * as THREE from 'three';
import type {
  BattleSim,
  BattleUiApi,
  ResultSummary,
  StageDef,
  TargetingMode,
  TowerId,
} from '@/data/types';
import { TICK_DT } from '@/data/types';
import { ENEMY_DEFS, TOWER_DEFS, makeWaveFor, ALL_TOWER_IDS } from '@/data';
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
/** 가로모드(style.css: max-height 560px 압축 HUD)가 실제 차지하는 높이 근사 */
const LANDSCAPE_MAX_CSS_H = 560;
const HUD_TOP_LANDSCAPE_PX = 64;
const HUD_BOTTOM_LANDSCAPE_PX = 84;

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
      waveFor: makeWaveFor(stage),
    });

    this.stage3d = build(stage, quality);
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
    this.fx.baseHpMax = stage.baseHp;
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
      requestSetTargeting: (mode: TargetingMode) => {
        const id = self.placement.selectedTower();
        if (id !== null) self.sim.applyCommand({ type: 'setTargeting', towerId: id, mode });
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

    // 카메라 제스처: 휠/핀치 줌 + (줌 상태에서) 드래그 팬
    const input = this.placement.input;
    input.events.on('wheel', (w) => {
      this.camera.zoomBy(w.deltaY < 0 ? 1.12 : 1 / 1.12);
    });
    input.events.on('pinch', (p) => {
      this.camera.zoomBy(p.scale);
    });
    let lastDragX = 0;
    let lastDragY = 0;
    input.events.on('dragStart', (i) => {
      lastDragX = i.x;
      lastDragY = i.y;
    });
    input.events.on('drag', (i) => {
      const dx = i.x - lastDragX;
      const dy = i.y - lastDragY;
      lastDragX = i.x;
      lastDragY = i.y;
      // 카드 선택 중 드래그는 배치 조준 — 카메라 팬과 충돌하지 않게 스킵
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

  /** 매 rAF 호출 (nowSec = performance.now()/1000) */
  frame(nowSec: number): void {
    if (this.disposed) return;
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
    s3.enemies.update(st.enemies, alpha, s3.cellToWorld, dt);
    s3.healthbars.update(st.enemies, alpha, s3.cellToWorld);
    s3.projectiles.update(st.projectiles, alpha, dt);
    s3.towers.aim(st.towers, st.enemies, alpha);
    s3.update(dt);
    this.camera.update(dt);
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
      else if (ev.type === 'towerSold' || ev.type === 'towerUpgraded') {
        this.placement.refreshSelection();
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
      // 입력/뷰포트 검증용 (모바일 e2e)
      selectCard: (i: number | null): void => this.api.selectCard(i),
      selectedCard: (): number | null => this.api.selectedCard(),
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
