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

const BUILDERS: Partial<Record<TowerId, () => PartSpec[]>> = {
  spear: spearProj,
  catapult: rockProj,
  brazier: fireballProj,
  frost: iceProj,
  poison: dartProj,
  ballista: boltProj,
};

/** glowMat로 렌더할 투사체 (자체발광) */
export const GLOW_PROJECTILES: ReadonlySet<TowerId> = new Set(['brazier', 'frost', 'poison']);

/** 투사체를 쏘는 타워 목록 (뷰 인스턴스 준비용) */
export const PROJECTILE_TOWERS: readonly TowerId[] = [
  'spear',
  'catapult',
  'brazier',
  'frost',
  'poison',
  'ballista',
];

/** 캐시된 투사체 지오메트리. 매핑 없는 타워(beam/aura)는 null */
export function buildProjectile(towerId: TowerId): THREE.BufferGeometry | null {
  const builder = BUILDERS[towerId];
  if (!builder) return null;
  return cachedGeo(`proj:${towerId}`, () => buildParts(builder(), { seed: 9, ao: 0, faceJitter: 0.03 }));
}
