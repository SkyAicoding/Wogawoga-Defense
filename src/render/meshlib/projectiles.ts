/**
 * 투사체 소형 지오메트리 — 진행방향 +x 기준으로 모델링.
 * homing/ballistic을 쓰는 타워만 매핑된다 (lightning=beam, brazier/drum=aura).
 */
import type * as THREE from 'three';
import type { TowerId } from '@/data/types';
import { C } from '../palette';
import { buildParts, cachedGeo, type PartSpec } from './factory';

function spearProj(): PartSpec[] {
  // 던지는 창: 긴 자루 + 돌촉 + 깃
  return [
    { kind: 'cyl', pos: [0, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.05, 0.66, 0.05], color: C.wood, seg: 4 },
    { kind: 'cone', pos: [0.38, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.09, 0.2, 0.09], color: C.stone, seg: 4 },
    { kind: 'box', pos: [-0.3, 0.02, 0], rot: [0, 0, 0.3], scale: [0.1, 0.08, 0.02], color: 0xe0512e },
  ];
}

function rockProj(): PartSpec[] {
  // 투석기 바위 덩어리
  return [
    { kind: 'ico', pos: [0, 0, 0], rot: [0.4, 0.7, 0.2], scale: 0.3, color: C.stone, hueJitter: 0.02 },
    { kind: 'ico', pos: [0.08, 0.08, 0.06], scale: 0.14, color: C.stoneDark },
  ];
}

function fireballProj(): PartSpec[] {
  // 불덩이 (glowMat 렌더 전제 — 밝은 색)
  return [
    { kind: 'sphere', pos: [0, 0, 0], scale: 0.24, color: C.fire },
    { kind: 'cone', pos: [-0.2, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.16, 0.3, 0.16], color: 0xffd24a, seg: 5 },
  ];
}

function iceProj(): PartSpec[] {
  // 얼음조각: 양끝 뾰족한 결정
  return [
    { kind: 'cone', pos: [0.12, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.12, 0.3, 0.12], color: C.ice, seg: 5 },
    { kind: 'cone', pos: [-0.12, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.12, 0.3, 0.12], color: C.iceDeep, seg: 5 },
    { kind: 'ico', pos: [0.02, 0.08, 0.02], scale: 0.08, color: 0xe2faff },
  ];
}

function dartProj(): PartSpec[] {
  // 독침
  return [
    { kind: 'cone', pos: [0.1, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.08, 0.34, 0.08], color: C.poison, seg: 4 },
    { kind: 'sphere', pos: [-0.12, 0, 0], scale: 0.1, color: C.poisonDark },
  ];
}

function boltProj(): PartSpec[] {
  // 상아 볼트: 굵은 대 + 뼈 촉
  return [
    { kind: 'cyl', pos: [0, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.07, 0.6, 0.07], color: C.boneDark, seg: 5 },
    { kind: 'cone', pos: [0.36, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.11, 0.22, 0.11], color: C.bone, seg: 5 },
    { kind: 'box', pos: [-0.26, 0, 0.04], rot: [0.4, 0, 0], scale: [0.12, 0.1, 0.02], color: C.hide },
    { kind: 'box', pos: [-0.26, 0, -0.04], rot: [-0.4, 0, 0], scale: [0.12, 0.1, 0.02], color: C.hide },
  ];
}

function toothProj(): PartSpec[] {
  // 연타 함정의 나무 이빨 — 짧고 굵다. 초당 3.3발이라 길면 화면이 막대로 덮인다
  return [
    { kind: 'cone', pos: [0.08, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.09, 0.26, 0.09], color: C.wood, seg: 4 },
    { kind: 'box', pos: [-0.1, 0, 0], scale: [0.12, 0.07, 0.07], color: C.woodDark },
  ];
}

function sparkProj(): PartSpec[] {
  // 충격 말뚝의 방전 덩이 (glowMat 전제 — 밝은 색). 꼬리를 달아 진행 방향이 읽힌다
  return [
    { kind: 'ico', pos: [0, 0, 0], scale: 0.15, color: 0xd9f6ff },
    { kind: 'cone', pos: [-0.16, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.1, 0.26, 0.1], color: C.ice, seg: 4 },
  ];
}

/*
 * ⚠⚠ **2026-08-27: 여기 둘이 빠져 있었다 — 그 타워의 투사체가 화면에 없었다.**
 * `rattletrap`·`shockstake` 는 `attackKind: 'homing'` 이라 sim 은 투사체를 정상으로
 * 쏘는데(피해도 들어간다) 이 표에 없어서 `buildProjectile` 이 null 을 돌려줬고,
 * `ProjectileView.update` 의 `meshes.get(defId)` 가 undefined 라 **조용히 건너뛰었다**.
 * 곧 s5·s6 에서 해금되는 두 타워는 **아무것도 안 나가는 것처럼 보였다.**
 * 잡힌 경위: 사용자가 "종류마다 다른 색 줘" 를 요구해 이 표를 훑다가 두 종이 없는 것을 봤다.
 * (`tests/render/projectiletier.test.ts` 의 '전 종이 메시를 갖는다' 가 이제 이걸 잠근다)
 */
const BUILDERS: Partial<Record<TowerId, () => PartSpec[]>> = {
  spear: spearProj,
  catapult: rockProj,
  brazier: fireballProj,
  frost: iceProj,
  poison: dartProj,
  ballista: boltProj,
  rattletrap: toothProj,
  shockstake: sparkProj,
};

/**
 * ══ 종마다 다른 색 ═══════════════════════════════════════════════════════════
 * 사용자 요구: **"종류마다 다른 색 줘 창은 붉게 얼음은 푸르게"**
 *
 * 이 값은 `instanceColor` 로 **정점색에 곱해진다**(뷰가 티어 밝기와 함께 쓴다).
 * 그래서 여기 적는 것은 "칠할 색"이 아니라 **어느 쪽으로 밀 것인가**다.
 *
 * ⚠ `game/fx.ts` 의 `TOWER_FX_COLOR` 와 **일부러 다르다.** 그쪽은 착탄 폭발의 색이라
 *   큰 파티클 뭉치이고 차분해도 읽힌다. 투사체는 **작고 빠르다** — 한눈에 종을 가르려면
 *   더 진해야 한다. 특히 창은 그쪽이 베이지(0xd9c8a0)라 잔디 위에서 거의 안 보였고,
 *   그것이 사용자가 "창은 붉게" 라고 한 이유다.
 * ⚠ 팔레트를 하나로 합치지 않은 이유가 그것이다 — 두 자리의 **요구가 다르다**.
 *   합치면 한쪽을 맞출 때마다 다른 쪽이 어긋난다.
 */
const PROJECTILE_HUE: Partial<Record<TowerId, number>> = {
  spear: 0xff5a3c, // 붉게 (사용자 지정)
  catapult: 0x9a8b72, // 회색 돌 — 붉은 창과 확실히 갈린다
  brazier: 0xff8c42, // 주황 불덩이
  frost: 0x5ab6ff, // 푸르게 (사용자 지정). fx 쪽 0x9fdcf7 보다 진하다 — 작아서 흐리면 안 보인다
  poison: 0x8fd14f, // 초록 독침
  ballista: 0xffd24a, // 금빛 상아 볼트 — 흰 뼈색은 하늘·눈밭에 묻힌다
  rattletrap: 0xc9a35a, // 나무 이빨
  shockstake: 0xbfe9ff, // 창백한 방전 — 얼음보다 희어 구분된다
};

/**
 * 곱셈 색조로 바꾼다 — **평균이 1이 되게 정규화**한 뒤 흰색 쪽으로 되당긴다.
 *
 *  · 정규화: 그냥 hex 를 곱하면 전부 **어두워진다**(모든 채널 ≤ 1). 평균을 1 로 맞추면
 *    밝기는 그대로 두고 **색조만** 민다 — 그래서 T1 이 옛 그림만큼 밝게 남는다.
 *  · 되당김(`HUE_STRENGTH`): 정규화만 하면 창이 (1.89, 0.67, 0.44)로 너무 세다.
 *    0.65 로 섞으면 (1.58, 0.78, 0.64) — 붉지만 창의 나무·돌 결이 살아 있다.
 *    1 로 올리면 원색 덩어리가 되어 로우폴리 결이 통째로 사라진다.
 */
const HUE_STRENGTH = 0.65;
function tintOf(hex: number): readonly [number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const mean = Math.max(1e-3, (r + g + b) / 3);
  const mix = (v: number): number => 1 + (v / mean - 1) * HUE_STRENGTH;
  return [mix(r), mix(g), mix(b)];
}

/** 그 타워 투사체의 색조 배수 (없는 종은 흰색 = 안 민다) */
export function projectileTint(id: TowerId): readonly [number, number, number] {
  const hex = PROJECTILE_HUE[id];
  return hex === undefined ? [1, 1, 1] : tintOf(hex);
}

/** glowMat로 렌더할 투사체 (자체발광) */
export const GLOW_PROJECTILES: ReadonlySet<TowerId> = new Set([
  'brazier', 'frost', 'poison',
  'shockstake', // 방전 덩이 — 발광이라야 "전기"로 읽힌다 (연타 함정은 나무라 평면재질)
]);

/** 투사체를 쏘는 타워 목록 (뷰 인스턴스 준비용) */
export const PROJECTILE_TOWERS: readonly TowerId[] = [
  'spear',
  'catapult',
  'brazier',
  'frost',
  'poison',
  'ballista',
  'rattletrap',
  'shockstake',
];

/** 캐시된 투사체 지오메트리. 매핑 없는 타워(beam/aura)는 null */
export function buildProjectile(towerId: TowerId): THREE.BufferGeometry | null {
  const builder = BUILDERS[towerId];
  if (!builder) return null;
  return cachedGeo(`proj:${towerId}`, () => buildParts(builder(), { seed: 9, ao: 0, faceJitter: 0.03 }));
}
