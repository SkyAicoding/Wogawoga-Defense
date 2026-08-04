/**
 * 색 팔레트 + 공유 머티리얼 싱글톤.
 * Crossy Road풍 고채도 로우폴리 — 모든 지오메트리는 버텍스 컬러로 칠하고
 * 머티리얼은 공유한다 (드로우콜/컴파일 절약).
 * Lambert는 flatShading을 지원하지 않으므로 비인덱스 지오메트리 + 면 노멀로 플랫 효과를 낸다.
 */
import * as THREE from 'three';
import type { BiomeId } from '@/data/types';

export interface BiomePalette {
  /** 지상 타일 램프 (셀마다 랜덤 픽) */
  ground: number[];
  /** 경로(흙) 램프 */
  path: number[];
  /** 절벽 [상단, 하단] — 아래로 어두워짐 */
  cliff: [number, number];
  water: number;
  fog: number;
  sky: number;
  /** 환경광 지면 반사색 */
  hemiGround: number;
  /** 환경 파티클 색 (눈/재/포자, 없으면 0) */
  ambient: number;
}

export const BIOMES: Record<BiomeId, BiomePalette> = {
  grassland: {
    ground: [0x82cf52, 0x8fd95c, 0x76c249, 0x9be06a],
    path: [0xd2a86e, 0xc69a5e, 0xdbb37c],
    cliff: [0xa57c4c, 0x5f4128],
    water: 0x3fb4e6,
    fog: 0xbfe6f5,
    sky: 0x8ed3f0,
    hemiGround: 0x8a7a4d,
    ambient: 0,
  },
  jungle: {
    ground: [0x3fa855, 0x379a4c, 0x4cb862, 0x2f8f45],
    path: [0x8f6f46, 0x84643c, 0x9c7c52],
    cliff: [0x6f5638, 0x3c2d1c],
    water: 0x2fb39c,
    fog: 0xa3dcc3,
    sky: 0x77c9ae,
    hemiGround: 0x4d6b3a,
    ambient: 0xd6f2a8,
  },
  desert: {
    ground: [0xeac778, 0xe2bd6c, 0xf2d288, 0xdcb462],
    path: [0xc98f4e, 0xbf8546, 0xd49a58],
    cliff: [0xc08a50, 0x7c5028],
    water: 0x45c2dc,
    fog: 0xf4dfb2,
    sky: 0xf6d89e,
    hemiGround: 0xb08c56,
    ambient: 0xf0d9a0,
  },
  snow: {
    ground: [0xeef5fa, 0xe4eef6, 0xf6fbff, 0xdce9f2],
    path: [0xb2c4d2, 0xa6b8c8, 0xbecfdc],
    cliff: [0x93aabf, 0x54708a],
    water: 0x6fc9e8,
    fog: 0xdcecf6,
    sky: 0xc4e4f4,
    hemiGround: 0x9db4c8,
    ambient: 0xffffff,
  },
  swamp: {
    ground: [0x6f9c46, 0x64903e, 0x7ba851, 0x588438],
    path: [0x7c6a44, 0x71603c, 0x89764e],
    cliff: [0x5f5636, 0x332e1c],
    water: 0x3f7a66,
    fog: 0x9cb593,
    sky: 0x8aa985,
    hemiGround: 0x4f5c34,
    ambient: 0xb8e07c,
  },
  volcano: {
    ground: [0x6f5c54, 0x695650, 0x75625a, 0x645350],
    path: [0x7a4a30, 0x704329, 0x855438],
    cliff: [0x4c3733, 0x241816],
    water: 0xff671e,
    fog: 0x6e4c44,
    sky: 0x46302c,
    hemiGround: 0x5a3428,
    ambient: 0x3a3a3a,
  },
};

/** 공용 색상표 — 소품/타워/적에서 재사용 */
export const C = {
  wood: 0x8f5c34,
  woodDark: 0x5f3d22,
  straw: 0xdcb562,
  bone: 0xece0c4,
  boneDark: 0xc9bb9a,
  stone: 0x9aa1a8,
  stoneDark: 0x666e75,
  rock: 0x8c8378,
  rope: 0xc99f57,
  leaf: 0x4aa03c,
  leafDark: 0x357a2c,
  hide: 0xb27a49,
  hideDark: 0x8a5a34,
  skin: 0xdca06c,
  fire: 0xff9a2e,
  ember: 0xff5a1a,
  lava: 0xff7626,
  ice: 0xa8ecff,
  iceDeep: 0x5ec8f0,
  crystal: 0x62eaff,
  poison: 0x8fd42e,
  poisonDark: 0x4f8a1e,
  purple: 0x8a4a9e,
  snowCap: 0xf2f8fc,
  bark: 0x6b4a2f,
  black: 0x2a2622,
  white: 0xf2efe8,
  banner: 0xe0512e,
  gold: 0xf0b840,
} as const;

// --- 공유 머티리얼 싱글톤 -------------------------------------------------
let _flat: THREE.MeshLambertMaterial | null = null;
let _glow: THREE.MeshBasicMaterial | null = null;
let _additive: THREE.MeshBasicMaterial | null = null;

/** 라이팅 받는 기본 버텍스컬러 머티리얼 (비인덱스 노멀 = 플랫 셰이딩) */
export function flatMat(): THREE.MeshLambertMaterial {
  if (!_flat) _flat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return _flat;
}

/** 발광부(불꽃/크리스탈) — 라이팅 무시, 톤매핑 제외로 쨍한 색 */
export function glowMat(): THREE.MeshBasicMaterial {
  if (!_glow) _glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  return _glow;
}

/** 애디티브 글로우 (빔/하이라이트) */
export function additiveMat(): THREE.MeshBasicMaterial {
  if (!_additive)
    _additive = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  return _additive;
}

/** 콘텍스트 로스트 후 재구축 시 호출 — 머티리얼 재생성 유도 */
export function disposeSharedMats(): void {
  _flat?.dispose();
  _glow?.dispose();
  _additive?.dispose();
  _flat = _glow = _additive = null;
}
