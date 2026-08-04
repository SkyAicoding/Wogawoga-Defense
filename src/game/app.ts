/**
 * 앱 셸 — GameFacade 구현 + 화면 FSM + 메인 rAF 루프.
 * 비전투 화면 뒤에는 회전하는 스테이지 디오라마 배경을 렌더한다.
 */
import type { GameFacade, ResultSummary, ScreenId, StageDef } from '@/data/types';
import { STAGES, TOWER_DEFS, stageById } from '@/data';
import { ScreenFsm } from '@/core/fsm';
import { audio } from '@/audio';
import { setLang } from '@/ui/i18n';
import { createTitleScreen } from '@/ui/screens/title';
import { createLobbyScreen } from '@/ui/screens/lobby';
import { createCollectionScreen } from '@/ui/screens/collection';
import { createSettingsScreen } from '@/ui/screens/settings';
import { createBattleHud } from '@/ui/screens/battlehud';
import { createResultScreen } from '@/ui/screens/result';
import { clearDamageNumbers } from '@/ui/widgets/damagenumbers';
import { GameRenderer } from '@/render/renderer';
import { DioramaCamera } from '@/render/camera';
import { QualityManager } from '@/render/quality';
import { build, type Stage3D } from '@/render/stage3d';
import { createProfile } from '@/meta/profile';
import { BattleController } from './battlecontroller';

export const APP_VERSION = '1.0.0';

export function createApp(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const profile = createProfile();
  setLang(profile.data.settings.lang);

  const qm = new QualityManager(profile.data.settings.quality);
  const renderer = new GameRenderer(canvas, qm.flags);

  // --- 오디오: 첫 제스처 언락 + 설정 반영 -----------------------------------
  audio.setMusicVolume(profile.data.settings.music);
  audio.setSfxVolume(profile.data.settings.sfx);
  const unlockOnce = (): void => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlockOnce);
  };
  window.addEventListener('pointerdown', unlockOnce);

  profile.onSettingsChanged = (s) => {
    audio.setMusicVolume(s.music);
    audio.setSfxVolume(s.sfx);
    setLang(s.lang);
    qm.set(s.quality === 'auto' ? qm.current : s.quality);
    renderer.setQuality(qm.flags);
  };

  // --- 배경 디오라마 (비전투 화면) ------------------------------------------
  let backdrop: Stage3D | null = null;
  const backdropCam = new DioramaCamera();
  let backdropStageId = 0;

  const highestUnlockedStage = (): StageDef => {
    let last = STAGES[0] as StageDef;
    for (const s of STAGES) {
      if (profile.isStageUnlocked(s.id)) last = s;
      else break;
    }
    return last;
  };

  const buildBackdrop = (): void => {
    const stage = highestUnlockedStage();
    if (backdrop && backdropStageId === stage.id) return;
    backdrop?.dispose();
    backdrop = build(stage, qm.flags);
    backdropStageId = stage.id;
    fitBackdrop();
  };

  const fitBackdrop = (): void => {
    if (!backdrop) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    backdropCam.fitToPlayfield(backdrop.aabb, { x: 0, y: h * 0.12, w, h: h * 0.6 }, w, h);
  };

  // --- 파사드 + FSM ----------------------------------------------------------
  let controller: BattleController | null = null;

  const facade: GameFacade = {
    profile,
    stages: STAGES,
    towerDefs: TOWER_DEFS,
    goto: (s: ScreenId, params?: unknown) => fsm.goto(s, params),
    currentScreen: () => fsm.currentId() ?? 'title',
    startBattle,
    battle: null,
    lastResult: null,
    version: APP_VERSION,
  };

  const fsm = new ScreenFsm<GameFacade, ScreenId>(facade);
  fsm.register('title', createTitleScreen());
  fsm.register('lobby', createLobbyScreen());
  fsm.register('collection', createCollectionScreen());
  fsm.register('settings', createSettingsScreen());
  fsm.register('battle', createBattleHud());
  fsm.register('result', createResultScreen());

  function disposeBattle(): void {
    if (!controller) return;
    controller.dispose();
    controller = null;
    facade.battle = null;
    clearDamageNumbers();
  }

  function startBattle(stageId: number, endless: boolean): void {
    const stage = stageById(stageId);
    if (!stage || !profile.isStageUnlocked(stageId)) return;
    disposeBattle();
    backdrop?.dispose();
    backdrop = null;
    backdropStageId = 0;
    controller = new BattleController(
      renderer,
      canvas,
      profile,
      stage,
      endless,
      qm.flags,
      (result: ResultSummary) => {
        facade.lastResult = result;
        disposeBattle();
        buildBackdrop();
        audio.music.setIntensity(0);
        fsm.goto('result');
      },
      () => {
        disposeBattle();
        buildBackdrop();
        audio.music.setIntensity(0);
        fsm.goto('lobby');
      },
    );
    facade.battle = controller.api;
    controller.resize(window.innerWidth, window.innerHeight);
    fsm.goto('battle');
  }

  // --- 리사이즈/회전 대응 ----------------------------------------------------
  const onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    controller?.resize(w, h);
    fitBackdrop();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  onResize();

  // 컨텍스트 복구 시 씬 재구축
  renderer.onContextRestored = () => {
    if (controller) {
      // 전투 중 복구는 드묾 — 안전하게 로비로
      disposeBattle();
      buildBackdrop();
      fsm.goto('lobby');
    } else {
      backdrop?.dispose();
      backdrop = null;
      backdropStageId = 0;
      buildBackdrop();
    }
  };

  // --- 메인 루프 -------------------------------------------------------------
  let last = performance.now();
  const tick = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (controller) {
      controller.frame(now / 1000);
    } else if (backdrop) {
      backdrop.root.rotation.y += dt * 0.12;
      backdrop.update(dt);
      backdropCam.update(dt);
      renderer.render(backdrop.scene, backdropCam.camera);
    }
    fsm.update(dt);
    requestAnimationFrame(tick);
  };

  buildBackdrop();
  fsm.goto('title');
  requestAnimationFrame(tick);
}
