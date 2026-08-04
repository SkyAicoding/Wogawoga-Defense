/**
 * 바이옴별 장식 소품 — 시드 RNG로 빈 지상 셀에 산포, 병합 지오메트리 1개.
 * 소품 원형은 종류별로 캐시하고 클론+변환+틴트로 배치한다.
 *
 * 폴리 예산: 소품은 스테이지당 40~51개가 하나의 병합 지오메트리에 들어가므로
 * 드로우콜은 1개로 고정이지만 삼각형은 개수만큼 곱해진다.
 * → **소품 원형 1개당 250 삼각형 이하**를 지켜야 한다 (PROTO_TRI_BUDGET).
 * 프리미티브 삼각형 수: box=12, cyl(seg n)=4n, cone(seg n)=2n, ico=20, sphere=80.
 * sphere(80)는 비싸므로 쓰지 않고 ico를 여러 개 겹쳐 각진 실루엣을 만든다.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BiomeId, Vec2 } from '@/data/types';
import { Rng, hashSeed } from '@/core/rng';
import { C, flatMat } from '../palette';
import { buildParts, cachedGeo, geoTransform, tintGeo, type PartSpec } from './factory';

/** 소품 원형 1개가 넘어서면 안 되는 삼각형 수 (스테이지당 최대 51개 배치) */
export const PROTO_TRI_BUDGET = 250;

/** 색 명도 배율 — 같은 계열 안에서 면을 나눠 각진 결을 살릴 때 쓴다 */
function shade(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/** 뒤집힌 원뿔 = 밑동 플레어(뿌리 벌어짐). 줄기 실루엣을 훨씬 안정적으로 만든다 */
function flare(x: number, y: number, z: number, r: number, h: number, color: number, seg = 6): PartSpec {
  return { kind: 'cone', pos: [x, y, z], rot: [Math.PI, 0, 0], scale: [r, h, r], color, seg };
}

// --- 초원/정글 -------------------------------------------------------------

/** 침엽수 — 4단 원뿔 + 곁가지 + 테이퍼 줄기 (148 tri) */
function pine(): PartSpec[] {
  const lf = C.leaf;
  const ld = C.leafDark;
  return [
    { kind: 'cyl', pos: [0, 0.2, 0], scale: [0.15, 0.4, 0.15], color: C.bark, seg: 6 },
    flare(0, 0.07, 0, 0.3, 0.16, shade(C.bark, 0.8)),
    { kind: 'cone', pos: [0, 0.5, 0], scale: [0.72, 0.44, 0.72], color: ld, seg: 7, hueJitter: 0.02 },
    { kind: 'cone', pos: [0, 0.75, 0], scale: [0.58, 0.4, 0.58], color: lf, seg: 7, hueJitter: 0.02 },
    { kind: 'cone', pos: [0, 0.98, 0], scale: [0.42, 0.36, 0.42], color: shade(lf, 1.1), seg: 7, hueJitter: 0.02 },
    { kind: 'cone', pos: [0, 1.18, 0], scale: [0.24, 0.28, 0.24], color: shade(lf, 1.16), seg: 5 },
    { kind: 'cone', pos: [-0.26, 0.58, 0.08], rot: [0, 0, 0.5], scale: [0.26, 0.26, 0.26], color: ld, seg: 5 },
    { kind: 'cone', pos: [0.24, 0.7, -0.1], rot: [0, 0, -0.55], scale: [0.22, 0.24, 0.22], color: lf, seg: 5 },
    { kind: 'ico', pos: [0.2, 0.07, 0.18], rot: [0.3, 0.7, 0], scale: [0.24, 0.14, 0.22], color: ld, hueJitter: 0.03 },
    { kind: 'ico', pos: [-0.24, 0.05, -0.16], rot: [0.9, 0.2, 0.4], scale: 0.14, color: C.rock },
  ];
}

/** 활엽수 — 가지 + 잎 덩어리 5개로 자연스러운 실루엣 (168 tri) */
function roundTree(): PartSpec[] {
  const lf = C.leaf;
  return [
    { kind: 'cyl', pos: [0, 0.24, 0], scale: [0.16, 0.48, 0.16], color: C.bark, seg: 6 },
    flare(0, 0.08, 0, 0.34, 0.18, shade(C.bark, 0.78)),
    { kind: 'cyl', pos: [0.17, 0.5, 0.04], rot: [0, 0, -0.75], scale: [0.075, 0.34, 0.075], color: C.bark, seg: 4 },
    { kind: 'cyl', pos: [-0.15, 0.58, -0.06], rot: [0.2, 0, 0.8], scale: [0.07, 0.3, 0.07], color: shade(C.bark, 0.9), seg: 4 },
    { kind: 'ico', pos: [0, 0.82, 0], rot: [0.3, 0.5, 0.1], scale: [0.66, 0.58, 0.62], color: lf, hueJitter: 0.03 },
    { kind: 'ico', pos: [0.28, 0.7, 0.1], rot: [1.1, 0.2, 0.6], scale: 0.4, color: shade(lf, 0.86), hueJitter: 0.03 },
    { kind: 'ico', pos: [-0.25, 0.74, -0.12], rot: [0.6, 1.3, 0.2], scale: 0.38, color: lf, hueJitter: 0.03 },
    { kind: 'ico', pos: [0.06, 1.04, 0.08], rot: [0.9, 0.4, 1.0], scale: 0.36, color: shade(lf, 1.14), hueJitter: 0.03 },
    { kind: 'ico', pos: [-0.1, 0.96, -0.2], rot: [0.2, 0.9, 0.5], scale: 0.28, color: shade(lf, 1.06), hueJitter: 0.03 },
  ];
}

/** 야자수 — 3단 굽은 줄기 + 2절 잎사귀 6장 + 코코넛 (236 tri) */
function palm(): PartSpec[] {
  const frond = 0x3f9e42;
  const parts: PartSpec[] = [
    flare(0, 0.07, 0, 0.32, 0.16, shade(C.bark, 0.75)),
    { kind: 'cyl', pos: [0.02, 0.2, 0], rot: [0, 0, -0.08], scale: [0.15, 0.4, 0.15], color: C.bark, seg: 5 },
    { kind: 'cyl', pos: [0.07, 0.56, 0], rot: [0, 0, -0.16], scale: [0.13, 0.36, 0.13], color: shade(C.bark, 1.12), seg: 5 },
    { kind: 'cyl', pos: [0.14, 0.88, 0], rot: [0, 0, -0.26], scale: [0.11, 0.3, 0.11], color: shade(C.bark, 1.2), seg: 5 },
    { kind: 'ico', pos: [0.19, 0.96, 0.02], rot: [0.4, 0.3, 0.2], scale: [0.19, 0.14, 0.19], color: 0x6b4b2a },
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const cx = 0.2 + Math.cos(a) * 0.2;
    const cz = Math.sin(a) * 0.2;
    parts.push(
      {
        kind: 'box',
        pos: [cx, 1.04, cz],
        rot: [0, -a, 0.24],
        scale: [0.4, 0.035, 0.17],
        color: i % 2 ? frond : shade(frond, 1.14),
        hueJitter: 0.02,
      },
      {
        kind: 'box',
        pos: [0.2 + Math.cos(a) * 0.48, 0.93, Math.sin(a) * 0.48],
        rot: [0, -a, 0.72],
        scale: [0.42, 0.03, 0.13],
        color: i % 2 ? shade(frond, 0.82) : frond,
        hueJitter: 0.02,
      },
    );
  }
  return parts;
}

// --- 사막 -----------------------------------------------------------------

/** 선인장 — 테이퍼 몸통 + 팔 2개(팔꿈치+수직) + 꽃 (240 tri) */
function cactus(): PartSpec[] {
  const g1 = 0x3f9e52;
  const g2 = 0x45a858;
  return [
    { kind: 'cyl', pos: [0, 0.32, 0], scale: [0.26, 0.64, 0.26], color: g1, seg: 8, hueJitter: 0.015 },
    { kind: 'cyl', pos: [0, 0.82, 0], scale: [0.22, 0.4, 0.22], color: g2, seg: 8, hueJitter: 0.015 },
    { kind: 'cone', pos: [0, 1.04, 0], scale: [0.22, 0.14, 0.22], color: g2, seg: 8 },
    { kind: 'cyl', pos: [-0.2, 0.5, 0], rot: [0, 0, 1.45], scale: [0.12, 0.3, 0.12], color: g1, seg: 5 },
    { kind: 'cyl', pos: [-0.32, 0.66, 0], scale: [0.12, 0.36, 0.12], color: g1, seg: 5 },
    { kind: 'cone', pos: [-0.32, 0.86, 0], scale: [0.12, 0.1, 0.12], color: g2, seg: 5 },
    { kind: 'cyl', pos: [0.19, 0.34, 0.05], rot: [0, 0.3, -1.4], scale: [0.11, 0.28, 0.11], color: g1, seg: 5 },
    { kind: 'cyl', pos: [0.3, 0.5, 0.06], scale: [0.11, 0.3, 0.11], color: g2, seg: 5 },
    { kind: 'cone', pos: [0.3, 0.67, 0.06], scale: [0.11, 0.09, 0.11], color: g2, seg: 5 },
    { kind: 'ico', pos: [0, 1.13, 0], scale: [0.13, 0.1, 0.13], color: 0xe86ba0, hueJitter: 0.03 },
    { kind: 'ico', pos: [0.26, 0.05, -0.2], rot: [0.6, 0.4, 0.2], scale: 0.15, color: 0xc09468 },
    { kind: 'ico', pos: [-0.26, 0.04, 0.18], rot: [1.2, 0.9, 0.5], scale: 0.1, color: shade(0xc09468, 0.86) },
  ];
}

/** 뼈 화석 — 두개골 + 척추 + 갈비뼈 아치 + 골반 (216 tri) */
function bones(): PartSpec[] {
  const parts: PartSpec[] = [
    { kind: 'ico', pos: [-0.42, 0.16, 0], rot: [0.2, 0.4, 0], scale: [0.3, 0.26, 0.26], color: C.bone },
    { kind: 'box', pos: [-0.62, 0.13, 0], rot: [0, 0, 0.12], scale: [0.24, 0.13, 0.15], color: C.bone },
    { kind: 'box', pos: [-0.6, 0.05, 0], scale: [0.26, 0.05, 0.13], color: C.boneDark },
    { kind: 'cone', pos: [-0.36, 0.3, 0.09], rot: [-0.3, 0, -0.35], scale: [0.08, 0.2, 0.08], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [-0.36, 0.3, -0.09], rot: [0.3, 0, -0.35], scale: [0.08, 0.2, 0.08], color: C.bone, seg: 4 },
    { kind: 'box', pos: [0.5, 0.11, 0], rot: [0, 0.2, 0], scale: [0.14, 0.18, 0.26], color: C.boneDark },
  ];
  for (let i = 0; i < 3; i++) {
    const x = -0.1 + i * 0.2;
    parts.push({
      kind: 'cyl',
      pos: [x, 0.11, 0],
      rot: [0, 0, Math.PI / 2],
      scale: [0.075, 0.22, 0.075],
      color: C.boneDark,
      seg: 4,
    });
  }
  const RIB: [number, number, number][] = [
    // [x, 높이배율, 벌어짐]
    [-0.14, 1.0, 0.4],
    [0.08, 0.92, 0.5],
    [0.3, 0.74, 0.62],
  ];
  RIB.forEach(([x, hm, lean], i) => {
    const h = 0.56 * hm;
    const zo = 0.16 + lean * 0.12;
    parts.push(
      { kind: 'cyl', pos: [x, h * 0.5, -zo], rot: [lean, 0, i * 0.05], scale: [0.065, h, 0.065], color: C.bone, seg: 4 },
      { kind: 'cyl', pos: [x, h * 0.5, zo], rot: [-lean, 0, -i * 0.05], scale: [0.065, h, 0.065], color: C.boneDark, seg: 4 },
    );
  });
  return parts;
}

// --- 바위 -----------------------------------------------------------------

/** 각진 결 바위 — 이코사 6덩이 (120 tri) */
function rock(color: number): PartSpec[] {
  return [
    { kind: 'ico', pos: [0, 0.18, 0], rot: [0.4, 0.8, 0.2], scale: [0.5, 0.38, 0.44], color, hueJitter: 0.014 },
    { kind: 'ico', pos: [0.04, 0.34, -0.03], rot: [1.1, 0.4, 0.9], scale: [0.3, 0.28, 0.26], color: shade(color, 1.1), hueJitter: 0.014 },
    { kind: 'ico', pos: [0.26, 0.11, 0.14], rot: [1.2, 0.3, 0.5], scale: [0.28, 0.22, 0.26], color, hueJitter: 0.014 },
    { kind: 'ico', pos: [-0.25, 0.09, -0.12], rot: [0.7, 1.4, 0.2], scale: [0.26, 0.2, 0.24], color: shade(color, 0.88), hueJitter: 0.014 },
    { kind: 'ico', pos: [0.18, 0.04, -0.26], rot: [0.2, 0.9, 1.1], scale: 0.15, color: shade(color, 0.92) },
    { kind: 'ico', pos: [-0.17, 0.04, 0.27], rot: [1.5, 0.2, 0.6], scale: 0.12, color: shade(color, 1.06) },
  ];
}

/** 이끼바위 — 바위 + 이끼 패치 3장 (180 tri) */
function mossRock(): PartSpec[] {
  const moss = 0x4f9440;
  return [
    ...rock(0x7d8a80),
    { kind: 'ico', pos: [-0.02, 0.34, -0.02], rot: [0.2, 0.6, 0.1], scale: [0.4, 0.14, 0.36], color: moss, hueJitter: 0.03 },
    { kind: 'ico', pos: [0.25, 0.19, 0.14], rot: [0.9, 0.3, 0.4], scale: [0.22, 0.1, 0.2], color: shade(moss, 1.12), hueJitter: 0.03 },
    { kind: 'ico', pos: [-0.22, 0.15, -0.18], rot: [0.5, 1.1, 0.2], scale: [0.19, 0.09, 0.18], color: shade(moss, 0.86), hueJitter: 0.03 },
  ];
}

// --- 설원 -----------------------------------------------------------------

/** 눈덮인 침엽수 — 3단 가지 + 각 단 위 눈 모자 + 발치 눈더미 (156 tri) */
function snowPine(): PartSpec[] {
  const nd = 0x2f7a4a;
  return [
    { kind: 'cyl', pos: [0, 0.17, 0], scale: [0.14, 0.34, 0.14], color: C.bark, seg: 6 },
    flare(0, 0.06, 0, 0.28, 0.14, shade(C.bark, 0.8)),
    { kind: 'cone', pos: [0, 0.46, 0], scale: [0.72, 0.46, 0.72], color: nd, seg: 7, hueJitter: 0.02 },
    { kind: 'cone', pos: [0.03, 0.6, -0.02], rot: [0.05, 0, 0.03], scale: [0.6, 0.12, 0.6], color: C.snowCap, seg: 7 },
    { kind: 'cone', pos: [0, 0.78, 0], scale: [0.52, 0.4, 0.52], color: shade(nd, 1.12), seg: 7, hueJitter: 0.02 },
    { kind: 'cone', pos: [-0.03, 0.9, 0.02], rot: [-0.04, 0, -0.05], scale: [0.42, 0.11, 0.42], color: C.snowCap, seg: 7 },
    { kind: 'cone', pos: [0, 1.04, 0], scale: [0.34, 0.34, 0.34], color: nd, seg: 6 },
    { kind: 'cone', pos: [0.01, 1.15, 0], scale: [0.26, 0.24, 0.26], color: C.snowCap, seg: 6 },
    { kind: 'ico', pos: [0.17, 0.04, 0.15], rot: [0.3, 0.5, 0.1], scale: [0.3, 0.1, 0.28], color: C.snowCap },
    { kind: 'ico', pos: [-0.2, 0.04, -0.13], rot: [0.8, 0.2, 0.4], scale: [0.23, 0.09, 0.21], color: shade(C.snowCap, 0.94) },
  ];
}

// --- 늪/화산 --------------------------------------------------------------

/** 고사목 — 굽은 줄기 + 부러진 가지 4개 + 옹이 (170 tri) */
function deadTree(): PartSpec[] {
  const w = 0x4f4136;
  return [
    { kind: 'cyl', pos: [0, 0.28, 0], rot: [0, 0, 0.05], scale: [0.14, 0.56, 0.14], color: w, seg: 6 },
    { kind: 'cyl', pos: [0.05, 0.72, 0.01], rot: [0, 0, 0.12], scale: [0.1, 0.36, 0.1], color: shade(w, 1.12), seg: 5 },
    flare(0, 0.08, 0, 0.3, 0.16, shade(w, 0.78)),
    { kind: 'cyl', pos: [0.22, 0.72, 0.02], rot: [0, 0, -0.95], scale: [0.065, 0.42, 0.065], color: w, seg: 4 },
    { kind: 'cyl', pos: [0.4, 0.9, 0.04], rot: [0, 0, -0.5], scale: [0.045, 0.26, 0.045], color: shade(w, 0.9), seg: 4 },
    { kind: 'cyl', pos: [-0.18, 0.86, 0.05], rot: [0.25, 0, 0.8], scale: [0.06, 0.36, 0.06], color: w, seg: 4 },
    { kind: 'cyl', pos: [0.02, 1.0, -0.16], rot: [-0.8, 0, 0.15], scale: [0.05, 0.3, 0.05], color: shade(w, 0.88), seg: 4 },
    { kind: 'cone', pos: [0.07, 0.98, 0.02], scale: [0.12, 0.24, 0.12], color: shade(w, 1.05), seg: 5 },
    { kind: 'ico', pos: [-0.1, 0.44, 0.1], rot: [0.6, 0.3, 0.9], scale: [0.16, 0.14, 0.14], color: shade(w, 0.85) },
    { kind: 'ico', pos: [0.2, 0.05, 0.16], rot: [0.2, 0.8, 0.3], scale: [0.2, 0.1, 0.16], color: shade(w, 0.82) },
  ];
}

/** 버섯 무리 — 큰 갓(돔+테두리)+주름 + 작은 버섯 2개 (212 tri) */
function mushroom(): PartSpec[] {
  const stem = 0xd8cbb0;
  const cap = 0xc45a8a;
  return [
    { kind: 'cyl', pos: [0, 0.16, 0], scale: [0.13, 0.32, 0.13], color: stem, seg: 6 },
    flare(0, 0.05, 0, 0.24, 0.12, shade(stem, 0.86)),
    { kind: 'cyl', pos: [0, 0.26, 0], scale: [0.2, 0.04, 0.2], color: shade(stem, 0.84), seg: 6 },
    { kind: 'ico', pos: [0, 0.36, 0], rot: [0.2, 0.4, 0], scale: [0.44, 0.26, 0.44], color: cap, hueJitter: 0.03 },
    flare(0, 0.33, 0, 0.44, 0.1, shade(cap, 0.72), 8),
    { kind: 'ico', pos: [0.13, 0.45, 0.06], scale: 0.1, color: 0xf6ece0 },
    { kind: 'ico', pos: [-0.11, 0.44, -0.09], scale: 0.085, color: 0xf6ece0 },
    { kind: 'cyl', pos: [0.24, 0.1, 0.13], scale: [0.08, 0.2, 0.08], color: stem, seg: 5 },
    { kind: 'ico', pos: [0.24, 0.22, 0.13], rot: [0.3, 0.6, 0], scale: [0.25, 0.16, 0.25], color: 0xb84a7a, hueJitter: 0.03 },
    { kind: 'cyl', pos: [-0.23, 0.06, 0.19], scale: [0.06, 0.12, 0.06], color: stem, seg: 4 },
    { kind: 'ico', pos: [-0.23, 0.14, 0.19], rot: [0.5, 0.2, 0.3], scale: [0.17, 0.11, 0.17], color: 0xb84a7a, hueJitter: 0.03 },
  ];
}

/** 화산 분출구 — 분화구 림 + 용암 웅덩이 + 균열 (174 tri) */
function vent(): PartSpec[] {
  const r = 0x4c3733;
  return [
    { kind: 'cone', pos: [0, 0.2, 0], scale: [0.9, 0.4, 0.9], color: r, seg: 9, hueJitter: 0.015 },
    flare(0, 0.3, 0, 0.44, 0.22, 0x2a1c18, 8),
    { kind: 'cyl', pos: [0, 0.4, 0], scale: [0.46, 0.07, 0.46], color: shade(r, 0.7), seg: 8 },
    { kind: 'cyl', pos: [0, 0.44, 0], scale: [0.38, 0.06, 0.38], color: 0xff8a2e, seg: 8, hueJitter: 0.02 },
    { kind: 'cone', pos: [0, 0.52, 0], scale: [0.24, 0.18, 0.24], color: 0xffc85a, seg: 6 },
    { kind: 'ico', pos: [0.4, 0.1, 0.26], rot: [0.7, 0.4, 0.3], scale: [0.26, 0.2, 0.24], color: shade(r, 0.8) },
    { kind: 'ico', pos: [-0.38, 0.08, -0.2], rot: [1.1, 0.9, 0.5], scale: [0.22, 0.16, 0.2], color: shade(r, 0.9) },
    { kind: 'box', pos: [0.34, 0.02, -0.3], rot: [0, 0.6, 0], scale: [0.4, 0.03, 0.09], color: 0xf05a1e },
    { kind: 'box', pos: [-0.3, 0.02, 0.34], rot: [0, -0.9, 0], scale: [0.34, 0.03, 0.08], color: 0xdc4a14 },
  ];
}

/** 불탄 그루터기 — 쪼개진 윗면 + 드러난 뿌리 + 잉걸 (136 tri) */
function charStump(): PartSpec[] {
  const ch = 0x322824;
  return [
    { kind: 'cyl', pos: [0, 0.2, 0], scale: [0.22, 0.4, 0.22], color: ch, seg: 7, hueJitter: 0.015 },
    flare(0, 0.06, 0, 0.36, 0.16, shade(ch, 0.8)),
    { kind: 'cone', pos: [0.06, 0.44, 0.03], rot: [0, 0, 0.15], scale: [0.13, 0.24, 0.13], color: shade(ch, 1.25), seg: 4 },
    { kind: 'cone', pos: [-0.07, 0.42, -0.05], rot: [0.2, 0, -0.2], scale: [0.1, 0.18, 0.1], color: ch, seg: 4 },
    { kind: 'cone', pos: [0, 0.46, -0.09], rot: [-0.25, 0, 0], scale: [0.08, 0.16, 0.08], color: shade(ch, 1.15), seg: 4 },
    { kind: 'cyl', pos: [0.24, 0.05, 0.12], rot: [0, -0.5, 1.35], scale: [0.09, 0.28, 0.09], color: shade(ch, 0.9), seg: 4 },
    { kind: 'cyl', pos: [-0.22, 0.05, -0.14], rot: [0, 0.7, -1.4], scale: [0.08, 0.26, 0.08], color: shade(ch, 0.9), seg: 4 },
    { kind: 'ico', pos: [0.02, 0.17, 0.19], scale: [0.17, 0.12, 0.14], color: 0xff6a20, hueJitter: 0.03 },
    { kind: 'ico', pos: [-0.26, 0.03, 0.2], rot: [0.4, 0.6, 0.2], scale: [0.22, 0.06, 0.2], color: 0x5a5450 },
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

/**
 * 지정된 소품 셀에 산포 — 병합 메시 1개 반환.
 * 셀 선택은 data/grid.sceneryCells가 담당 (sim의 건설 불가 판정과 동일 시드).
 */
export function buildProps(
  biome: BiomeId,
  propCellList: readonly Vec2[],
  cellToWorld: (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3,
  seed: number,
): { group: THREE.Group; dispose(): void } {
  const rng = new Rng(hashSeed(`props:${biome}:${seed}`));
  const set = PROP_SETS[biome];
  const clones: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  for (const cell of propCellList) {
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
      v.x + rng.range(-0.18, 0.18),
      0,
      v.z + rng.range(-0.18, 0.18),
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

/** 테스트/계측용 — 소품 원형 빌더 목록 (바이옴별 중복 제거) */
export const PROP_PROTOS: Readonly<Record<string, () => PartSpec[]>> = {
  pine,
  roundTree,
  palm,
  cactus,
  bones,
  rock: () => rock(C.rock),
  mossRock,
  snowPine,
  deadTree,
  mushroom,
  vent,
  charStump,
};
