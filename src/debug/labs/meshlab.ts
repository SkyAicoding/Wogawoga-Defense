/**
 * 메시 갤러리 랩 — ?scene=meshlab
 * 적 16 + 타워 8×5티어 + 기지 + 소품 + 투사체를 격자 배치, 천천히 회전.
 * ?model=raptor 로 단일 모델 확대. DOM 라벨로 이름 표시.
 * ?model=towers 로 타워만 8행(종) × 5열(티어) — 등급 성장 비교 전용 격자.
 * ?yaw=0.9 로 회전을 고정(라디안) — 개선 전/후 동일 앵글 비교 캡처용.
 * ?camyaw=0 으로 카메라 방위 고정 — 한 줄 배치를 정면으로 받아 화면을 꽉 채울 때 쓴다.
 * ?spacing=3.6 으로 격자 간격 조절 — 마을처럼 큰 모델이 서로 겹칠 때.
 * ?model=hometown1..5 로 마을 한 레벨만 확대.
 */
import * as THREE from 'three';
import type { AllyId, EnemyId, TowerId } from '@/data/types';
import { ALL_ALLY_IDS } from '@/data/allies';
import { flatMat, glowMat } from '@/render/palette';
import {
  ALL_ENEMY_IDS,
  buildAllySolo,
  buildEnemy,
  buildEnemySolo,
  enemyAttackLean,
  enemyRig,
  enemyVariant,
} from '@/render/meshlib/enemies';
import { attackLean, makeGaitMaterials } from '@/render/meshlib/gait';
import { assembleTower, buildTower, towerTierScale } from '@/render/meshlib/towers';
import { PROJECTILE_TOWERS, buildProjectile } from '@/render/meshlib/projectiles';
import { BASECAMP_LAYER_COUNT, createBasecamp } from '@/render/meshlib/basecamp';

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
    // 단품 지오메트리 — 부족 습격대는 전투에서 4종이 지오메트리를 공유하므로
    // 공유본을 그대로 쓰면 무기 4개가 한 몸에 다 붙어 나온다 (마스킹은 적 전용 셰이더 담당)
    const mesh = new THREE.Mesh(buildEnemySolo(id), flatMat());
    mesh.castShadow = true;
    g.add(mesh);
  });
}

function allyItem(id: AllyId): Item {
  return makeItem(`ally:${id}`, (g) => {
    const mesh = new THREE.Mesh(buildAllySolo(id), flatMat());
    mesh.castShadow = true;
    g.add(mesh);
  });
}

/**
 * 공격 동작 갤러리 (?model=attack) — 타워를 때리는 5종 × 한 주기 8프레임.
 *
 * 전투를 열지 않고도 **동작이 완결되는지**를 한 장으로 본다. 전투 캡처는 유닛이
 * 작고(20~40px) 무리가 겹쳐 한 종의 한 주기를 골라내기 어렵다 — 여기서 포즈를 잡고
 * 실전투에서는 "기본 줌에서 읽히는가"만 확인하는 분업이다.
 *
 * 전투와 **완전히 같은 경로**를 태운다: 같은 지오메트리(공유본) + 같은 gait 머티리얼 +
 * 같은 공격 유니폼 + 같은 몸통 기울임. 다른 것은 인스턴스가 아니라 개별 Mesh 라
 * 진행도가 어트리뷰트 대신 유니폼으로 들어간다는 점뿐이다(setAttack 폴백).
 * castShadow 를 켜 두므로 **그림자에도 동작이 실리는지** 이 갤러리에서 바로 보인다.
 */
const ATTACK_STEPS = 8;
const ATTACK_SPECIES: readonly EnemyId[] = ['blade', 'lancer', 'archer', 'hexer', 'warrior'];

function attackItem(id: EnemyId, step: number): Item {
  const p = step / (ATTACK_STEPS - 1);
  return makeItem(`${id} ${p.toFixed(2)}`, (g) => {
    const variant = enemyVariant(id);
    const gm = makeGaitMaterials(enemyRig(id), variant > 0);
    const mesh = new THREE.Mesh(buildEnemy(id), gm.color);
    mesh.customDepthMaterial = gm.depth;
    mesh.castShadow = true;
    if (variant > 0) gm.setVariant(variant);
    gm.setGait(0);
    gm.setAttack(p, 1); // 조준 1 = 멈춰 서서 쏘는 상태
    // 몸통 기울임은 전투에서 인스턴스 행렬이 준다 — 갤러리에서도 같은 식으로 얹는다
    mesh.rotation.z = attackLean(p, 1, enemyAttackLean(id));
    g.add(mesh);
  });
}

/** 마을 레벨 1~5를 한 줄로 — 구조물이 쌓이는지 나란히 비교한다 */
function hometownItem(level: number): Item {
  return makeItem(`마을 Lv${level}`, (g) => {
    const camp = createBasecamp();
    camp.setLevel(level, BASECAMP_LAYER_COUNT);
    camp.setDamageLevel(0);
    g.add(camp.group);
  });
}

/** 같은 레벨의 피해 3단계 (온전/파손/반파) */
function hometownDamageItem(level: number, dmg: 0 | 1 | 2): Item {
  return makeItem(`Lv${level} 피해${dmg}`, (g) => {
    const camp = createBasecamp();
    camp.setLevel(level, BASECAMP_LAYER_COUNT);
    camp.setDamageLevel(dmg);
    g.add(camp.group);
  });
}

/** 열 수를 강제하는 축약 갤러리 — 없으면 화면 비율로 자동 계산 */
const GROUPS: Record<string, { cols: number; build: () => Item[] }> = {
  enemies: { cols: 0, build: () => ALL_ENEMY_IDS.map(enemyItem) },
  // 부족 습격대 4종만 한 줄로 — 실루엣·무기·염료가 서로 구분되는지 나란히 비교한다
  raiders: {
    cols: 4,
    build: () => (['blade', 'lancer', 'archer', 'hexer'] as EnemyId[]).map(enemyItem),
  },
  // 아군 3종 + 적 습격대 4종을 한 줄로 — **아군/적 구분이 서는지**가 이 줄의 목적이다
  tribes: {
    cols: 7,
    build: () => [
      ...ALL_ALLY_IDS.map(allyItem),
      ...(['blade', 'lancer', 'archer', 'hexer'] as EnemyId[]).map(enemyItem),
    ],
  },
  allies: { cols: 3, build: () => ALL_ALLY_IDS.map(allyItem) },
  // 한 행 = 한 종, 왼→오 = 공격 진행도 0 → 1. ?model=attack:blade 로 한 종만 크게 본다
  attack: {
    cols: ATTACK_STEPS,
    build: () =>
      ATTACK_SPECIES.flatMap((id) =>
        Array.from({ length: ATTACK_STEPS }, (_, s) => attackItem(id, s)),
      ),
  },
  ...Object.fromEntries(
    ATTACK_SPECIES.map((id) => [
      `attack:${id}`,
      {
        cols: ATTACK_STEPS,
        build: () => Array.from({ length: ATTACK_STEPS }, (_, s) => attackItem(id, s)),
      },
    ]),
  ),
  hometown: { cols: 5, build: () => [1, 2, 3, 4, 5].map(hometownItem) },
  hometownDamage: {
    cols: 3,
    build: () =>
      [1, 3, 5].flatMap((lv) => ([0, 1, 2] as const).map((d) => hometownDamageItem(lv, d))),
  },
  // 한 행 = 한 종, 왼→오 = T1→T5. 등급 성장을 나란히 읽는 격자.
  towers: { cols: 5, build: () => TOWER_IDS.flatMap((id) => [0, 1, 2, 3, 4].map((t) => towerItem(id, t))) },
};

function buildItems(filter: string | null): Item[] {
  const group = filter === null ? undefined : GROUPS[filter];
  if (group) return group.build();
  // ?model=hometown3 — 마을 한 레벨만 (단일 모드로 확대된다)
  const one = filter?.match(/^hometown([1-9])$/);
  if (one) return [hometownItem(Number(one[1]))];
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
  const spacingParam = Number(params.get('spacing'));
  const spacing = Number.isFinite(spacingParam) && spacingParam > 0 ? spacingParam : 2.6;
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
  // ?elev=0.25 로 카메라 고도 고정 — 던지는 팔의 호는 옆에서 봐야 궤적이 읽힌다
  const elevParam = Number(params.get('elev'));
  const elev =
    params.get('elev') !== null && Number.isFinite(elevParam)
      ? elevParam
      : isSingle
        ? 0.35
        : 0.62; // 라디안
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
