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
  // iOS 사파리 등은 pointerdown만으로 언락이 안 되는 경우가 있어
  // touchend/click까지 함께 대기 — 처음 발화한 이벤트가 셋 다 제거한다
  const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click'] as const;
  const unlockOnce = (): void => {
    audio.unlock();
    for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, unlockOnce);
  };
  for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, unlockOnce);

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

  /**
   * 배경 디오라마가 쓸 스테이지 — **실제 진행도**를 따른다.
   *
   * isStageUnlocked()를 쓰면 안 된다. 설정의 '모든 스테이지 열기'가 켜져 있으면 그건
   * 무조건 true라 루프가 한 번도 break하지 않고 **언제나 마지막 스테이지(화산)** 가
   * 남는다. 실측: 진행도 0인 새 프로필에서 토글만 켜도 타이틀 배경이 초원 → 용암으로
   * 바뀌어 화면 색조가 파랑에서 붉은색으로 뒤집혔다. 문제가 둘이다 —
   * 설정 설명은 "진행도와 호박은 그대로 유지됩니다"라 배경이 바뀐다는 예고가 없고,
   * 최종 바이옴을 첫 화면에서 스포일한다.
   *
   * 그래서 unlockAll이 우회하는 것은 "플레이할 수 있는가"뿐이고, "어디까지 왔는가"는
   * 여기서 cleared 기록으로 따로 읽는다. 해금 규칙(스테이지 n은 n-1 클리어 시)은
   * profile.isStageUnlocked와 같게 유지한다.
   *
   * profile.stageProgress()가 아니라 data.stages를 직접 읽는 이유: 그 함수는 없는
   * 항목을 **만들어 넣는** 부수효과가 있다(meta/profile.ts). buildBackdrop은 초기화와
   * 화면 전환마다 불리므로, 그걸 쓰면 배경을 그릴 때마다 세이브에 빈 진행도 6개가
   * 쌓인다 — 배경 계산은 읽기만 해야 한다.
   */
  const backdropStage = (): StageDef => {
    let last = STAGES[0] as StageDef;
    for (let i = 1; i < STAGES.length; i++) {
      const prev = STAGES[i - 1] as StageDef;
      if (profile.data.stages[prev.id]?.cleared !== true) break;
      last = STAGES[i] as StageDef;
    }
    return last;
  };

  const buildBackdrop = (): void => {
    const stage = backdropStage();
    if (backdrop && backdropStageId === stage.id) return;
    backdrop?.dispose();
    // combat:false — 배경에는 적이 한 마리도 안 서므로 보스 예열 슬롯을 만들지 않는다.
    // 예열을 끄는 코드는 EnemyView.update() 안에만 있고 배경은 그 함수를 안 부르므로,
    // 켜 두면 예열 4메시가 **영영** 그려진다(실측 8콜 / 10,824삼각형 = 이 씬의 44% · 33%).
    backdrop = build(stage, qm.flags, { combat: false });
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
      // 전투 중 복구는 드묾 — 진행분 정산 포함 종료 후 로비로 (quit 경로 재사용).
      // 이미 종료 연출 중이면 no-op — 기존 종료 흐름(결과/로비 전환)이 마무리한다.
      controller.forceQuit();
      audio.music.setIntensity(0);
    } else {
      backdrop?.dispose();
      backdrop = null;
      backdropStageId = 0;
      buildBackdrop();
    }
  };

  // 동적 해상도가 바닥(0.7)에 닿아도 계속 느림 → 품질 티어 한 단계 강등
  renderer.onPersistentlySlow = () => {
    if (qm.degrade()) renderer.setQuality(qm.flags);
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
