/**
 * 바이옴별 장식 소품 — 시드 RNG로 빈 지상 셀에 산포, 병합 지오메트리 1개.
 * 소품 원형은 종류별로 캐시하고 클론+변환+틴트로 배치한다.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BiomeId, Vec2 } from '@/data/types';
import { Rng, hashSeed } from '@/core/rng';
import { C, flatMat } from '../palette';
import { buildParts, cachedGeo, geoTransform, tintGeo, type PartSpec } from './factory';

function pine(): PartSpec[] {
  return [
    { kind: 'cyl', pos: [0, 0.18, 0], scale: [0.14, 0.36, 0.14], color: C.bark, seg: 5 },
    { kind: 'cone', pos: [0, 0.62, 0], scale: [0.62, 0.6, 0.62], color: C.leafDark, seg: 6, hueJitter: 0.02 },
    { kind: 'cone', pos: [0, 1.0, 0], scale: [0.46, 0.5, 0.46], color: C.leaf, seg: 6, hueJitter: 0.02 },
  ];
}

function roundTree(): PartSpec[] {
  return [
    { kind: 'cyl', pos: [0, 0.22, 0], scale: [0.16, 0.44, 0.16], color: C.bark, seg: 5 },
    { kind: 'ico', pos: [0, 0.72, 0], scale: 0.78, color: C.leaf, hueJitter: 0.03 },
    { kind: 'ico', pos: [0.18, 0.95, 0.1], scale: 0.42, color: 0x5cb84a, hueJitter: 0.03 },
  ];
}

function palm(): PartSpec[] {
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [0.03, 0.3, 0], rot: [0, 0, -0.12], scale: [0.13, 0.6, 0.13], color: C.bark, seg: 5 },
    { kind: 'cyl', pos: [0.11, 0.82, 0], rot: [0, 0, -0.22], scale: [0.11, 0.5, 0.11], color: 0x7a563a, seg: 5 },
  ];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push({
      kind: 'box',
      pos: [0.16 + Math.cos(a) * 0.3, 1.08, Math.sin(a) * 0.3],
      rot: [0, -a, 0.42],
      scale: [0.68, 0.035, 0.2],
      color: 0x3f9e42,
      hueJitter: 0.02,
    });
  }
  return parts;
}

function cactus(): PartSpec[] {
  return [
    { kind: 'cyl', pos: [0, 0.42, 0], scale: [0.24, 0.84, 0.24], color: 0x3f9e52, seg: 7, hueJitter: 0.015 },
    { kind: 'cyl', pos: [0.26, 0.5, 0], rot: [0, 0, 1.35], scale: [0.14, 0.3, 0.14], color: 0x3f9e52, seg: 6 },
    { kind: 'cyl', pos: [0.36, 0.68, 0], scale: [0.13, 0.34, 0.13], color: 0x45a858, seg: 6 },
    { kind: 'sphere', pos: [0, 0.9, 0], scale: 0.2, color: 0x45a858 },
  ];
}

function bones(): PartSpec[] {
  // 뼈 화석 — 갈비뼈 아치
  const parts: PartSpec[] = [];
  for (let i = 0; i < 3; i++) {
    const x = i * 0.26 - 0.26;
    parts.push(
      { kind: 'cyl', pos: [x, 0.28, -0.2], rot: [0.5, 0, 0], scale: [0.07, 0.55, 0.07], color: C.bone, seg: 5 },
      { kind: 'cyl', pos: [x, 0.28, 0.2], rot: [-0.5, 0, 0], scale: [0.07, 0.55, 0.07], color: C.boneDark, seg: 5 },
    );
  }
  parts.push({ kind: 'sphere', pos: [-0.45, 0.14, 0], scale: 0.28, color: C.bone });
  return parts;
}

function rock(color: number): PartSpec[] {
  return [
    { kind: 'ico', pos: [0, 0.16, 0], rot: [0.4, 0.8, 0.2], scale: [0.5, 0.36, 0.44], color, hueJitter: 0.012 },
    { kind: 'ico', pos: [0.26, 0.1, 0.14], rot: [1.2, 0.3, 0.5], scale: 0.24, color, hueJitter: 0.012 },
  ];
}

function mossRock(): PartSpec[] {
  return [
    ...rock(0x7d8a80),
    { kind: 'ico', pos: [-0.06, 0.3, -0.04], scale: [0.4, 0.16, 0.36], color: 0x4f9440, hueJitter: 0.02 },
  ];
}

function snowPine(): PartSpec[] {
  return [
    { kind: 'cyl', pos: [0, 0.16, 0], scale: [0.13, 0.32, 0.13], color: C.bark, seg: 5 },
    { kind: 'cone', pos: [0, 0.58, 0], scale: [0.6, 0.56, 0.6], color: 0x2f7a4a, seg: 6 },
    { kind: 'cone', pos: [0, 0.94, 0], scale: [0.46, 0.46, 0.46], color: C.snowCap, seg: 6 },
    { kind: 'cone', pos: [0, 0.68, 0], scale: [0.64, 0.14, 0.64], color: C.snowCap, seg: 6 },
  ];
}

function deadTree(): PartSpec[] {
  return [
    { kind: 'cyl', pos: [0, 0.4, 0], rot: [0, 0, 0.08], scale: [0.13, 0.8, 0.13], color: 0x4f4136, seg: 5 },
    { kind: 'cyl', pos: [0.2, 0.75, 0], rot: [0, 0, -0.9], scale: [0.07, 0.4, 0.07], color: 0x4f4136, seg: 4 },
    { kind: 'cyl', pos: [-0.16, 0.9, 0.05], rot: [0.2, 0, 0.7], scale: [0.06, 0.36, 0.06], color: 0x453a30, seg: 4 },
  ];
}

function mushroom(): PartSpec[] {
  return [
    { kind: 'cyl', pos: [0, 0.14, 0], scale: [0.12, 0.28, 0.12], color: 0xd8cbb0, seg: 6 },
    { kind: 'sphere', pos: [0, 0.32, 0], scale: [0.4, 0.24, 0.4], color: 0xc45a8a, hueJitter: 0.03 },
    { kind: 'cyl', pos: [0.22, 0.09, 0.12], scale: [0.08, 0.18, 0.08], color: 0xd8cbb0, seg: 5 },
    { kind: 'sphere', pos: [0.22, 0.2, 0.12], scale: [0.24, 0.16, 0.24], color: 0xb84a7a },
  ];
}

function vent(): PartSpec[] {
  return [
    { kind: 'cone', pos: [0, 0.22, 0], scale: [0.85, 0.44, 0.85], color: 0x4c3733, seg: 7, hueJitter: 0.015 },
    { kind: 'cyl', pos: [0, 0.42, 0], scale: [0.3, 0.1, 0.3], color: 0x2a1c18, seg: 6 },
    { kind: 'cyl', pos: [0, 0.45, 0], scale: [0.2, 0.08, 0.2], color: C.lava, seg: 6 },
  ];
}

function charStump(): PartSpec[] {
  return [
    { kind: 'cyl', pos: [0, 0.16, 0], scale: [0.2, 0.32, 0.2], color: 0x322824, seg: 6 },
    { kind: 'ico', pos: [0.2, 0.08, 0.1], scale: 0.18, color: 0x3d302c },
  ];
}

/** 바이옴 → 소품 빌더 목록 (가중 반복으로 빈도 조절) */
const PROP_SETS: Record<BiomeId, (() => PartSpec[])[]> = {
  grassland: [pine, pine, roundTree, roundTree, () => rock(C.rock)],
  jungle: [palm, palm, roundTree, mossRock, mushroom],
  desert: [cactus, cactus, bones, () => rock(0xc09468)],
  snow: [snowPine, snowPine, snowPine, () => rock(0x9db4c4)],
  swamp: [deadTree, mushroom, mossRock, deadTree],
  volcano: [vent, charStump, () => rock(0x4c3a34), charStump],
};

/** 빈 지상 셀에 소품 산포 — 병합 메시 1개 반환 */
export function buildProps(
  biome: BiomeId,
  freeCells: readonly Vec2[],
  cellToWorld: (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3,
  seed: number,
  density = 0.3,
): { group: THREE.Group; dispose(): void } {
  const rng = new Rng(hashSeed(`props:${biome}:${seed}`));
  const set = PROP_SETS[biome];
  const clones: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  for (const cell of freeCells) {
    if (!rng.chance(density)) continue;
    const idx = rng.int(0, set.length - 1);
    const builder = set[idx];
    if (!builder) continue;
    const proto = cachedGeo(`prop:${biome}:${idx}`, () =>
      buildParts(builder(), { seed: hashSeed(`prop:${biome}:${idx}`), ao: 0.18 }),
    );
    cellToWorld(cell.x, cell.z, v);
    const g = proto.clone();
    geoTransform(
      g,
      v.x + rng.range(-0.24, 0.24),
      0,
      v.z + rng.range(-0.24, 0.24),
      rng.range(0, Math.PI * 2),
      rng.range(0.8, 1.15),
    );
    tintGeo(g, rng.range(0.92, 1.08));
    clones.push(g);
  }

  const group = new THREE.Group();
  group.name = 'props';
  let merged: THREE.BufferGeometry | null = null;
  if (clones.length > 0) {
    merged = mergeGeometries(clones, false);
    for (const g of clones) g.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, flatMat());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return { group, dispose: () => merged?.dispose() };
}
