/**
 * zz 임시 캡처 랩 — ?scene=zzcap&shot=<이름>
 *
 * 렌더 성능 변경(보스 예열 회수 · 타워 BatchedMesh)이 **그림을 바꿨는지**만 본다.
 * 전/후 두 트리에 **같은 파일**을 넣고 같은 URL 로 찍어 픽셀 대조하는 것이 목적이라
 * 이 파일은 다음을 지킨다:
 *  · rAF 시간을 안 쓴다 — 고정 dt 로 정해진 횟수만 update 하고 그 프레임을 계속 다시 그린다
 *  · GameRenderer 를 안 쓴다 — 동적 해상도가 프레임타임에 따라 버퍼 크기를 바꾼다
 *  · build() 3번째 인자는 옛 트리에서 그냥 무시된다(JS) — 그래서 파일이 갈리지 않는다
 *
 * 끝나면 지운다.
 */
import * as THREE from 'three';
import { STAGES } from '@/data';
import type { EnemyState, StageDef, TowerId } from '@/data/types';
import { build, type Stage3D } from '@/render/stage3d';
import { flagsFor } from '@/render/quality';
import { DioramaCamera } from '@/render/camera';

const SPECIES: readonly TowerId[] = [
  'spear', 'catapult', 'lightning', 'brazier', 'frost', 'poison', 'ballista', 'drum',
];

/** 고정 스텝 — 전/후가 같은 수의 같은 크기 스텝을 밟아야 애니 위상이 같다 */
const STEP = 1 / 60;

function stepTo(s3: Stage3D, seconds: number): void {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) s3.update(STEP);
}

/** AABB 를 화면 90% 에 채우는 카메라 (meshlab 의 fit 과 같은 반복 투영) */
function fitCamera(
  cam: THREE.PerspectiveCamera,
  box: THREE.Box3,
  yaw: number,
  pitch: number,
): void {
  const center = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    .multiplyScalar(Math.cos(pitch))
    .setY(Math.sin(pitch));
  let dist = box.getSize(new THREE.Vector3()).length();
  const corner = new THREE.Vector3();
  for (let iter = 0; iter < 6; iter++) {
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    let maxN = 0;
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      corner.project(cam);
      maxN = Math.max(maxN, Math.abs(corner.x), Math.abs(corner.y));
    }
    if (maxN < 1e-3) break;
    dist *= maxN / 0.9;
  }
}

/** 셀 목록의 월드 경계 상자 (높이는 타워가 들어갈 만큼 위로) */
function cellBox(s3: Stage3D, cells: readonly { x: number; z: number }[], top = 2.6): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const c of cells) {
    s3.cellToWorld(c.x, c.z, v);
    box.expandByPoint(new THREE.Vector3(v.x - 0.6, 0, v.z - 0.6));
    box.expandByPoint(new THREE.Vector3(v.x + 0.6, top, v.z + 0.6));
  }
  return box;
}

/** 목 EnemyState — stagelab 과 같은 방식 (sim 없이 뷰만 돌린다) */
function mockEnemy(
  id: number,
  defId: string,
  x: number,
  z: number,
  extra: Partial<EnemyState> = {},
): EnemyState {
  return {
    id,
    defId: defId as EnemyState['defId'],
    hp: 60,
    maxHp: 100,
    shieldHitsLeft: 0,
    dist: 0,
    pathIndex: 0,
    attackCdLeft: 0,
    towerTargetId: -1,
    siegeHoldLeft: 0,
    attackAnimLeft: 0,
    attackAnimTicks: 0,
    blockerAllyId: -1,
    gateTicks: 0,
    gateBiteCdLeft: 0,
    gateOwed: 0,
    flying: false,
    x,
    z,
    prevX: x,
    prevZ: z,
    heading: 0,
    statuses: [],
    bounty: 5,
    baseDamage: 1,
    radius: 0.3,
    alive: true,
    hpMul: 1,
    ...extra,
  } as EnemyState;
}

export function run(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const ui = document.getElementById('ui-root');
  if (ui) ui.innerHTML = '';
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot') ?? 'towers';
  const stageNo = Math.max(1, Math.min(STAGES.length, Number(params.get('stage') ?? '1')));
  const stage = STAGES[stageNo - 1] as StageDef;
  const q = flagsFor('high');

  const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
  gl.setPixelRatio(window.devicePixelRatio); // 동적 해상도 없음 — 전/후 버퍼 크기가 같다
  gl.setSize(window.innerWidth, window.innerHeight, false);
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.shadowMap.enabled = q.shadows;
  gl.shadowMap.type = THREE.PCFShadowMap;

  // 배경 디오라마만 비전투 씬이다 (game/app.ts buildBackdrop 과 같은 호출)
  const isBackdrop = shot.startsWith('backdrop');
  const s3 = build(stage, q, { combat: !isBackdrop });

  const camera = new THREE.PerspectiveCamera(
    38,
    window.innerWidth / window.innerHeight,
    0.1,
    400,
  );
  let renderCam: THREE.Camera = camera;
  const cells: { x: number; z: number }[] = [];
  let id = 1;

  const num = (k: string, d: number): number => {
    const v = Number(params.get(k));
    return params.get(k) !== null && Number.isFinite(v) ? v : d;
  };

  // ?clean=1 — 소품/바닥결/마을을 숨겨 타워만 남긴다 (지형은 남겨 그림자를 본다).
  // stage3d 가 root 에 넣는 순서: 0 지형 · 1 소품 · 2 바닥결 · 3 마을
  if (params.get('clean') === '1') {
    s3.root.children.forEach((c, i) => {
      if (i > 0) c.visible = false;
    });
  }

  if (shot === 'towers') {
    // 8종 × T1(앞줄) / T5(뒷줄) — 모양·색·그림자
    SPECIES.forEach((sp, i) => {
      s3.towers.add(id++, sp, 0, 1 + i, 6);
      s3.towers.add(id++, sp, 4, 1 + i, 4);
      cells.push({ x: 1 + i, z: 6 }, { x: 1 + i, z: 4 });
    });
    stepTo(s3, 1.2); // 팝 애니(0.3초)가 끝난 정지 자세
    fitCamera(camera, cellBox(s3, cells, num('top', 1.9)), num('yaw', 0), num('pitch', 0.42));
  } else if (shot.startsWith('fire')) {
    // 8종 T5 한 줄 — recoil 후 t초 지점. homing/ballistic/beam/aura 가 모두 이 줄에 있다
    const ids: number[] = [];
    SPECIES.forEach((sp, i) => {
      const tid = id++;
      ids.push(tid);
      s3.towers.add(tid, sp, 4, 1 + i, 5);
      cells.push({ x: 1 + i, z: 5 });
    });
    stepTo(s3, 1.2); // 팝 끝
    for (const tid of ids) s3.towers.recoil(tid);
    stepTo(s3, num('t', 0.05));
    fitCamera(camera, cellBox(s3, cells, num('top', 2.1)), num('yaw', 0), num('pitch', 0.34));
  } else if (shot === 'states') {
    // 고스트 · 피격 플래시 · 파괴 잔해 · 사거리 링 · 선택 표시를 한 프레임에
    const normal = id++;
    s3.towers.add(normal, 'ballista', 4, 2, 5);
    const flashing = id++;
    s3.towers.add(flashing, 'brazier', 4, 4, 5);
    const ringed = id++;
    s3.towers.add(ringed, 'catapult', 4, 6, 5);
    cells.push({ x: 2, z: 5 }, { x: 4, z: 5 }, { x: 6, z: 5 }, { x: 8, z: 5 }, { x: 4, z: 4 });
    stepTo(s3, 1.2);
    // 사거리 링 + 선택 표시 (실게임은 타워를 고르면 이 둘을 같이 켠다)
    s3.decals.showRange(6, 5, 2.6);
    s3.decals.showTowerMarker(6, 5);
    // 파괴 잔해 — 그리기는 healthbars 인스턴스 메시가 맡는다
    s3.towerStatus.markDestroyed(4, 4, 3);
    s3.healthbars.update([], [], 1, s3.cellToWorld, s3.towerStatus.marks());
    // 배치 고스트 (초록 = 가능 / ?ghost=bad 면 빨강)
    s3.decals.setSlotsVisible(true);
    s3.towers.setGhost('lightning', 8, 5, params.get('ghost') !== 'bad');
    // 피격 플래시 — HIT_FLASH_TIME 0.07초 구간 안에서 얼린다
    s3.towers.hit(flashing);
    stepTo(s3, 0.6); // 잔해 정착(0.9초 중 0.6) + 링 페이드인
    s3.towers.hit(flashing);
    stepTo(s3, 0.0333); // 플래시 켜진 채로 2프레임
    s3.healthbars.update([], [], 1, s3.cellToWorld, s3.towerStatus.marks());
    fitCamera(camera, cellBox(s3, cells, num('top', 2.0)), num('yaw', 0), num('pitch', 0.5));
  } else if (shot === 'combat') {
    // 전투 씬 — 타워 + 적(문간 앞). 예열 회수가 전투 그림을 건드렸는지 본다
    SPECIES.forEach((sp, i) => {
      s3.towers.add(id++, sp, i % 5, 1 + i, 5);
      cells.push({ x: 1 + i, z: 5 });
    });
    const base = stage.baseCell;
    const enemies: EnemyState[] = [];
    const kinds = ['blade', 'lancer', 'archer', 'hexer', 'raptor', 'trike', 'trex', 'spino'];
    kinds.forEach((k, i) => {
      const ex = base.x - 2 + (i % 4);
      const ez = base.z - 2 + Math.floor(i / 4);
      enemies.push(mockEnemy(100 + i, k, ex, ez, { gateTicks: 20, attackAnimLeft: 6, attackAnimTicks: 12 }));
      cells.push({ x: ex, z: ez });
    });
    cells.push({ x: base.x, z: base.z });
    stepTo(s3, 1.2);
    // 적 뷰는 stage3d.update 가 아니라 프레임 루프가 굴린다 — 고정 dt 로 직접 민다
    for (let i = 0; i < 72; i++) s3.enemies.update(enemies, 1, s3.cellToWorld, STEP);
    s3.healthbars.update(enemies, [], 1, s3.cellToWorld, s3.towerStatus.marks());
    fitCamera(camera, cellBox(s3, cells, num('top', 2.6)), num('yaw', 0), num('pitch', 0.45));
  } else {
    // backdrop — game/app.ts 의 타이틀/로비 배경과 같은 조립
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dio = new DioramaCamera();
    dio.fitToPlayfield(s3.aabb, { x: 0, y: h * 0.12, w, h: h * 0.6 }, w, h);
    dio.update(0);
    s3.root.rotation.y = num('rot', 0);
    stepTo(s3, num('t', 2));
    renderCam = dio.camera;
  }

  gl.render(s3.scene, renderCam);
  // 같은 프레임을 계속 다시 그린다 — 시간은 더 이상 흐르지 않는다
  gl.setAnimationLoop(() => {
    gl.render(s3.scene, renderCam);
  });
  Object.assign(window as unknown as Record<string, unknown>, {
    __zz: {
      ready: true,
      shot,
      info: (): { calls: number; triangles: number } => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      }),
    },
  });
  console.log(
    `[zzcap] ${shot} — ${gl.info.render.calls}콜 / ${gl.info.render.triangles}삼각형`,
  );
}
