/**
 * 메시 갤러리 랩 — ?scene=meshlab
 * 적 12 + 타워 8×5티어 + 기지 + 소품 + 투사체를 격자 배치, 천천히 회전.
 * ?model=raptor 로 단일 모델 확대. DOM 라벨로 이름 표시.
 * ?model=towers 로 타워만 8행(종) × 5열(티어) — 등급 성장 비교 전용 격자.
 * ?yaw=0.9 로 회전을 고정(라디안) — 개선 전/후 동일 앵글 비교 캡처용.
 * ?camyaw=0 으로 카메라 방위 고정 — 한 줄 배치를 정면으로 받아 화면을 꽉 채울 때 쓴다.
 */
import * as THREE from 'three';
import type { EnemyId, TowerId } from '@/data/types';
import { flatMat, glowMat } from '@/render/palette';
import { ALL_ENEMY_IDS, buildEnemy } from '@/render/meshlib/enemies';
import { assembleTower, buildTower, towerTierScale } from '@/render/meshlib/towers';
import { PROJECTILE_TOWERS, buildProjectile } from '@/render/meshlib/projectiles';
import { createBasecamp } from '@/render/meshlib/basecamp';

const TOWER_IDS: readonly TowerId[] = [
  'spear', 'catapult', 'lightning', 'brazier', 'frost', 'poison', 'ballista', 'drum',
];

interface Item {
  name: string;
  group: THREE.Group;
}

function makeItem(name: string, build: (g: THREE.Group) => void): Item {
  const group = new THREE.Group();
  build(group);
  return { name, group };
}

function towerItem(id: TowerId, tier: number): Item {
  return makeItem(`${id} t${tier + 1}`, (g) => {
    const rig = assembleTower(buildTower(id, tier), { flat: flatMat(), glow: glowMat() }, true);
    // 게임과 동일한 티어 크기 램프를 실어야 갤러리에서 성장이 그대로 보인다
    rig.root.scale.setScalar(towerTierScale(tier));
    g.add(rig.root);
  });
}

function enemyItem(id: EnemyId): Item {
  return makeItem(id, (g) => {
    const mesh = new THREE.Mesh(buildEnemy(id), flatMat());
    mesh.castShadow = true;
    g.add(mesh);
  });
}

/** 열 수를 강제하는 축약 갤러리 — 없으면 화면 비율로 자동 계산 */
const GROUPS: Record<string, { cols: number; build: () => Item[] }> = {
  enemies: { cols: 0, build: () => ALL_ENEMY_IDS.map(enemyItem) },
  // 한 행 = 한 종, 왼→오 = T1→T5. 등급 성장을 나란히 읽는 격자.
  towers: { cols: 5, build: () => TOWER_IDS.flatMap((id) => [0, 1, 2, 3, 4].map((t) => towerItem(id, t))) },
};

function buildItems(filter: string | null): Item[] {
  const group = filter === null ? undefined : GROUPS[filter];
  if (group) return group.build();
  let items: Item[] = [
    ...ALL_ENEMY_IDS.map(enemyItem),
    ...TOWER_IDS.flatMap((id) => [0, 1, 2, 3, 4].map((t) => towerItem(id, t))),
    makeItem('basecamp', (g) => {
      const camp = createBasecamp();
      g.add(camp.group);
    }),
    ...PROJECTILE_TOWERS.map((id) =>
      makeItem(`proj:${id}`, (g) => {
        const geo = buildProjectile(id);
        if (geo) {
          const mesh = new THREE.Mesh(geo, flatMat());
          mesh.position.y = 0.5;
          g.add(mesh);
        }
      }),
    ),
  ];
  if (filter) {
    const found = items.filter((it) => it.name.startsWith(filter));
    if (found.length > 0) items = found;
  }
  return items;
}

export function run(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  const single = params.get('model');
  // 고정 yaw (비교 캡처용). 지정 없으면 null → 자동 회전
  const yawParam = params.get('yaw');
  const fixedYaw = yawParam === null ? null : Number(yawParam);
  // 카메라 방위 (기본 -0.5rad = 살짝 비스듬). 0이면 정면 — 가로 한 줄 배치가 화면을 꽉 채운다
  const camYawParam = Number(params.get('camyaw'));
  const camYaw = Number.isFinite(camYawParam) && params.get('camyaw') !== null ? camYawParam : -0.5;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2c3440);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x6a5a48, 1.1));

  const items = buildItems(single);
  const isSingle = single !== null && items.length <= 2;
  // 화면 비율에 맞춘 열 수 (세로폰=5열, 데스크톱 와이드=10열). 축약 갤러리는 고정 열.
  const aspect0 = window.innerWidth / window.innerHeight;
  const fixedCols = single === null ? 0 : (GROUPS[single]?.cols ?? 0);
  const cols = isSingle
    ? 1
    : fixedCols > 0
      ? fixedCols
      : Math.max(3, Math.min(10, Math.round(Math.sqrt(items.length * aspect0 * 1.4))));
  const spacing = 2.6;
  const rows = Math.ceil(items.length / cols);
  const world = new THREE.Group();
  scene.add(world);

  // 격자 배치 + 바닥 패드
  const padGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.12, 16);
  const padMat = new THREE.MeshLambertMaterial({ color: 0x4a5464 });
  items.forEach((item, i) => {
    const cx = (i % cols) - (Math.min(cols, items.length) - 1) / 2;
    const cz = Math.floor(i / cols) - (rows - 1) / 2;
    item.group.position.set(cx * spacing, 0, cz * spacing);
    if (fixedYaw !== null && Number.isFinite(fixedYaw)) item.group.rotation.y = fixedYaw;
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(cx * spacing, -0.07, cz * spacing);
    pad.receiveShadow = true;
    world.add(pad, item.group);
  });
  const shadowRadius = Math.max(cols, rows) * spacing * 0.7;
  sun.shadow.camera.left = -shadowRadius;
  sun.shadow.camera.right = shadowRadius;
  sun.shadow.camera.top = shadowRadius;
  sun.shadow.camera.bottom = -shadowRadius;
  sun.shadow.camera.far = 60;

  // DOM 이름 라벨
  const ui = document.getElementById('ui-root') as HTMLElement;
  ui.innerHTML = '';
  const labels = items.map((item) => {
    const el = document.createElement('div');
    el.textContent = item.name;
    el.style.cssText =
      'position:absolute;transform:translate(-50%,0);color:#fff;font:11px/1.2 monospace;' +
      'text-shadow:0 1px 2px #000;pointer-events:none;white-space:nowrap;';
    ui.appendChild(el);
    return el;
  });

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);

  // 전체 AABB (단일 모드면 해당 모델만)
  const fitBox = new THREE.Box3();
  for (const item of items) {
    const b = new THREE.Box3().setFromObject(item.group);
    b.expandByPoint(item.group.position); // 빈 그룹 방어
    fitBox.union(b);
  }
  fitBox.expandByScalar(isSingle ? 0.3 : 0.8);
  const center = fitBox.getCenter(new THREE.Vector3());
  const elev = isSingle ? 0.35 : 0.62; // 라디안
  let dist = 10;

  /** 투영 반복으로 AABB가 화면 90% 안에 들어오는 거리 탐색 */
  function fit(): void {
    const dir = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
    dir.multiplyScalar(Math.cos(elev)).setY(Math.sin(elev));
    dist = fitBox.getSize(new THREE.Vector3()).length();
    const corner = new THREE.Vector3();
    for (let iter = 0; iter < 4; iter++) {
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      let maxN = 0;
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? fitBox.max.x : fitBox.min.x,
          i & 2 ? fitBox.max.y : fitBox.min.y,
          i & 4 ? fitBox.max.z : fitBox.min.z,
        );
        corner.project(camera);
        maxN = Math.max(maxN, Math.abs(corner.x), Math.abs(corner.y));
      }
      if (maxN < 1e-3) break;
      dist *= maxN / 0.9;
    }
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fit();
  }
  window.addEventListener('resize', resize);
  resize();

  const proj = new THREE.Vector3();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    // 아이템 자체 회전 (천천히) — yaw 고정 시 생략
    if (fixedYaw === null || !Number.isFinite(fixedYaw)) {
      for (const item of items) item.group.rotation.y = t * 0.5;
    }
    renderer.render(scene, camera);
    // 라벨 투영 (2프레임에 1회)
    if ((Math.floor(t * 60) & 1) === 0) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      items.forEach((item, i) => {
        proj.copy(item.group.position);
        proj.y -= 0.35;
        proj.project(camera);
        const el = labels[i];
        if (!el) return;
        if (proj.z > 1) {
          el.style.display = 'none';
          return;
        }
        el.style.display = 'block';
        el.style.left = `${((proj.x + 1) / 2) * w}px`;
        el.style.top = `${((1 - proj.y) / 2) * h}px`;
      });
    }
  });

  console.log(`[meshlab] ${items.length}개 모델 로드 완료`);
}
