/**
 * 바이옴별 장식 — **소품 셀 하나 = 3층이 겹친 덤불 무리**.
 *
 * ── 왜 다시 만들었나 ───────────────────────────────────────────────────────
 * 로비 썸네일(src/assets/stages/*.webp)과 실제 판을 나란히 놓고 보면 격차의 정체가
 * "소품이 적다"가 아니었다. 썸네일은 **큰 나무 / 중간 덤불 / 바닥 풀**이 서로 겹쳐
 * 윤곽선이 삐죽삐죽하고, 바이옴마다 **거기에만 있는 실루엣**(야자·선인장·얼음 기둥·
 * 맹그로브·현무암 기둥)이 있다. 종전 구현은 바이옴당 원형 2~4종을 셀 중심에 하나씩,
 * 그것도 스케일 0.62~0.88로 눌러 놓아서 **한 층뿐이고 전부 관목 크기**였다.
 * 그래서 이 파일은 층 구조 자체를 바꾼다:
 *   1층(hero)  셀마다 1개. 타일보다 확실히 큰 실루엣 (월드 높이 1.0~1.7)
 *   2층(mid)   1~2개. 덤불·고사리·갈대·얼음 조각 — 30~40 삼각형
 *   3층(ground) 2~4개. 풀 다발·꽃·자갈·갈라진 땅 — 3~18 삼각형
 * 무성함은 폴리곤이 아니라 **겹침**에서 온다. 셀당 오브젝트 수가 1 → 4~7로 늘었는데
 * 삼각형은 오히려 줄었다(아래 예산표).
 *
 * ── 싸게 만드는 두 가지 수단 ───────────────────────────────────────────────
 * (1) **납작한 것은 폴리곤으로 굽지 않는다** (FlatSpec).
 *     카메라 피치는 40~65°로 고정이다(render/camera.ts). 곧 잎·꽃·이끼·갈라진 땅처럼
 *     두께가 안 보이는 것은 **n각형 판 하나(n-2 삼각형)** 면 충분하다. 종전 야자수는
 *     잎 12장을 box(12 삼각형)로 깔아 144 삼각형을 썼는데, 같은 잎을 사각 판(2)으로
 *     바꾸면 24다 — **6분의 1**이고 이 카메라에서 그림은 오히려 낫다(두께가 없어
 *     잎이 얇아 보인다). 판은 한쪽 면만 있으므로 노멀이 언제나 위를 보게 감는다.
 * (2) **안 보이는 파트를 굽지 않는다.** 종전 원형에는 잎 덩어리에 100% 묻힌 곁가지,
 *     선인장의 seg8(이 크기에서 seg6과 구분 불가), 지름 8cm짜리 자갈 같은 것이
 *     원형마다 15~33% 들어 있었다.
 *
 * ── 접촉 그림자 (propsMesh.castShadow = false) ─────────────────────────────
 * 소품·지형·마을은 **메인 패스와 섀도 패스에서 두 번 청구된다**(실측: 스테이지1
 * 그림자 ON 22,429 / OFF 10,771). 곧 소품에 삼각형 1개를 더하면 프레임은 2개가 는다.
 * 그래서 소품은 **그림자를 굽는 대신 지면에 어두운 판을 깐다**(contactShadow):
 *   · 회수: 스테이지당 5,714~10,584 프레임 삼각형 (소품 계산서 전액)
 *   · 지출: 소품 1개당 4 삼각형
 *   · 잃는 것: 소품의 방향성 긴 그림자. 대신 태양 방향으로 늘인 접촉 그림자가 남아
 *     밑동이 지면에 붙어 보이고, **섬·마을·타워·유닛은 그대로 그림자를 굽는다**
 *     (섬이 물 위에 드리우는 그림자도 그대로다).
 *   되돌리려면 propsMesh.castShadow 를 true 로 되돌리고 addContactShadow 호출을
 *   지우면 된다 — 대신 스테이지3~6이 즉시 삼각형 예산(150,000)을 넘는다.
 *
 * ── 예산 실측 (스테이지 소품 지오메트리 / 프레임 청구액) ───────────────────
 *   종전:  s1 6,076→12,152 · s2 8,980→17,960 · s3 10,584→21,168 ·
 *          s4 6,948→13,896 · s5 7,576→15,152 · s6 5,714→11,428  (섀도 패스로 ×2)
 *   지금:  tests/render/props.test.ts 가 6개 스테이지 실측치를 그대로 잠근다 (×1).
 * 드로우콜은 종전과 같이 **1개**다 — 3층 전부가 같은 병합 메시에 들어간다.
 *
 * 프리미티브 삼각형 수: box=12, cyl(seg n)=4n, cone(seg n)=2n, ico=20, 판(n각형)=n-2.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BiomeId, Vec2 } from '@/data/types';
import { Rng, hashSeed } from '@/core/rng';
import { clamp01 } from '@/core/mathx';
import { BIOMES, C, flatMat } from '../palette';
import { applyHeightAo, buildParts, cachedGeo, geoTransform, type PartSpec } from './factory';

/**
 * 층 요소 **하나**가 넘어서면 안 되는 삼각형 수.
 * 종전 값은 250이었고 그것은 "셀당 원형 1개" 시절의 상한이었다. 지금은 셀 하나에
 * 4~7개가 들어가므로 요소 단위 상한을 낮춰 잡아야 셀 합계가 관리된다.
 */
export const PROTO_TRI_BUDGET = 140;

/** 소품 셀 **하나**(3층 + 접촉 그림자) 합계 상한 — 실측 최댓값 + 여유 */
export const CELL_TRI_BUDGET = 300;

/** 소품(1층)이 셀 중심에서 흩어지는 최대 오프셋 (선택 링이 같은 값을 써서 밑동을 감싼다) */
export const PROP_JITTER = 0.18;

/** 2·3층이 놓이는 셀 안 반경 상한 — 셀(1×1) 밖으로 새지 않게 */
const UNDER_RADIUS_MAX = 0.46;

/** 색 명도 배율 — 같은 계열 안에서 면을 나눠 각진 결을 살릴 때 쓴다 */
function shade(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/** 뒤집힌 원뿔 = 밑동 플레어(뿌리 벌어짐). 줄기 실루엣을 훨씬 안정적으로 만든다 */
function flare(x: number, y: number, z: number, r: number, h: number, color: number, seg = 5): PartSpec {
  return { kind: 'cone', pos: [x, y, z], rot: [Math.PI, 0, 0], scale: [r, h, r], color, seg };
}

/**
 * 소품 전용 색 — palette.ts 의 C 에 없는 색만 여기 둔다.
 * (palette.ts 는 지금 다른 담당자가 고치는 중이라 손대지 않는다. 여기 색은 소품
 *  실루엣을 배경에서 떼어 놓는 게 목적이라 바이옴 지면색보다 한 단계 진하거나
 *  한 단계 밝은 쪽으로만 고른다 — 같은 명도대면 판에 먹힌다.)
 */
const P = {
  // 초원/정글 초록 계열 (지면 0x82cf52 / 0x3fa855 보다 진하다)
  pineDark: 0x2f7a3a,
  pineMid: 0x3d9448,
  pineLit: 0x57ad55,
  leafWarm: 0x69b849,
  bushDark: 0x39843a,
  bushLit: 0x63b552,
  grassBlade: 0x63aa3c,
  // 꽃
  flowerWhite: 0xf6f2e2,
  flowerYellow: 0xf2cf4a,
  flowerPink: 0xe07a9c,
  flowerRed: 0xd8412e,
  // 정글
  frond: 0x3f9e42,
  frondDark: 0x2d7a34,
  frondLit: 0x64bd52,
  jungleCanopy: 0x2f8b3e,
  jungleCanopyLit: 0x4aa84c,
  // 사막
  cactus1: 0x3f9e52,
  cactus2: 0x4cae5c,
  sandRock: 0xc89058,
  sandRockLit: 0xdca868,
  sandRockDeep: 0xa96b3e,
  sandCrack: 0xc79a58,
  dryBrush: 0xa8853e,
  // 설원
  needleSnow: 0x2c6f4c,
  needleSnowLit: 0x3a8a5c,
  // 늪
  swampBark: 0x4a3d30,
  swampBarkLit: 0x5d4c3a,
  swampLeaf: 0x3d6b32,
  swampLeafDark: 0x2c5226,
  mossHang: 0x7c9a4e,
  glowCap: 0x6ff0b4,
  glowCapDeep: 0x35c88c,
  glowStem: 0xdfeee0,
  puddle: 0x2f5c4a,
  reed: 0x7a8f3e,
  // 화산
  basalt: 0x4a4a54,
  basaltLit: 0x5e5e6a,
  basaltDeep: 0x2e2e36,
  obsidian: 0x241f28,
  ash: 0x5a5450,
  lavaHot: 0xff8a2e,
  lavaCore: 0xffc85a,
  lavaDeep: 0xe04a12,
} as const;

// --- 납작한 조각(판) ------------------------------------------------------

/**
 * 두께가 안 보이는 것(잎·꽃·이끼·갈라진 땅·접촉 그림자)을 위한 **한 면짜리 n각형**.
 * n각형 = n-2 삼각형. 기본은 수평(노멀 +Y)이라 40~65° 카메라에서 언제나 앞면이다.
 *
 * rot 의 오일러 순서가 buildParts(XYZ)와 **다른 'YXZ'** 인 것은 의도다:
 * 잎은 "+z 로 뻗은 판을 끝이 처지도록 기울이고(rx) 그 다음 제자리 각도로 돌린다(ry)"
 * 로 쓰는데, XYZ 순서면 기울임이 월드 x축 기준이 되어 잎마다 다른 방향으로 접힌다.
 */
export interface FlatSpec {
  pos: [number, number, number];
  /** [기울임 x, 방위 y, 비틀기 z] — 오일러 'YXZ' (기울임을 먼저, 방위를 나중에) */
  rot?: [number, number, number];
  /** [폭(x), 길이(z)] — 지름 1 기준 n각형에 곱한다 */
  scale?: [number, number];
  color: number;
  /** 3~8각형 (기본 4 = 사각형 2삼각형) */
  sides?: number;
  hueJitter?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };

/** 판 목록 → position/color/normal 비인덱스 지오메트리 (buildParts 출력과 같은 어트리뷰트) */
function buildFlats(flats: readonly FlatSpec[], seed: number, faceJitter = 0.04): THREE.BufferGeometry {
  const rng = new Rng(seed);
  let triTotal = 0;
  for (const f of flats) triTotal += (f.sides ?? 4) - 2;
  const pos = new Float32Array(triTotal * 9);
  const col = new Float32Array(triTotal * 9);
  const ring: THREE.Vector3[] = [];
  let o = 0;
  for (const f of flats) {
    const n = f.sides ?? 4;
    const [sx, sz] = f.scale ?? [1, 1];
    const [rx, ry, rz] = f.rot ?? [0, 0, 0];
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    _m.compose(_p.set(f.pos[0], f.pos[1], f.pos[2]), _q, _s.set(sx, 1, sz));
    // 각도를 **줄여 가며** 도는 감김 방향이 위(+Y)를 보는 앞면이다.
    // 반지름 0.5/cos(π/n) · 위상 π/n → n=4 면 꼭짓점이 정확히 (±0.5, ±0.5).
    const rad = 0.5 / Math.cos(Math.PI / n);
    ring.length = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / n - (i / n) * Math.PI * 2;
      ring.push(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad).applyMatrix4(_m));
    }
    for (let t = 1; t <= n - 2; t++) {
      _c.setHex(f.color);
      _c.offsetHSL((rng.next() - 0.5) * 2 * (f.hueJitter ?? 0), 0, (rng.next() - 0.5) * 2 * faceJitter);
      const tri = [ring[0] as THREE.Vector3, ring[t] as THREE.Vector3, ring[t + 1] as THREE.Vector3];
      for (const vtx of tri) {
        pos[o] = vtx.x;
        pos[o + 1] = vtx.y;
        pos[o + 2] = vtx.z;
        col[o] = _c.r;
        col[o + 1] = _c.g;
        col[o + 2] = _c.b;
        o += 3;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// --- 층 요소(원형) 정의 ---------------------------------------------------

/** 층 요소 하나의 설계도 — 입체 파트 + 납작한 판 */
export interface Element {
  solids?: PartSpec[];
  flats?: FlatSpec[];
  /** 바닥 AO 강도 (기본 0.18) */
  ao?: number;
}

/** 설계도 → 병합 지오메트리 (입체와 판을 한 덩어리로 굽고 높이 AO를 마지막에 한 번) */
function bakeElement(el: Element, seed: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  if (el.solids?.length) geos.push(buildParts(el.solids, { seed, ao: 0 }));
  if (el.flats?.length) geos.push(buildFlats(el.flats, seed ^ 0x9e3779b9));
  const first = geos[0];
  if (!first) throw new Error('빈 층 요소');
  let merged: THREE.BufferGeometry;
  if (geos.length === 1) {
    merged = first;
  } else {
    const m = mergeGeometries(geos, false);
    if (!m) throw new Error('층 요소 병합 실패');
    for (const g of geos) g.dispose();
    merged = m;
  }
  // AO 는 입체와 판을 합친 **하나의 y 범위**로 잰다 — 따로 재면 바닥 판만 새까매진다
  applyHeightAo(merged, el.ao ?? 0.18);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

// ── 1층: 큰 실루엣 ─────────────────────────────────────────────────────────

/** 침엽수 — 4단 원뿔 + 곁가지 (84 tri, 높이 1.70) */
function pineTall(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.21, 0], scale: [0.16, 0.42, 0.16], color: C.bark, seg: 4 },
      flare(0, 0.08, 0, 0.30, 0.16, shade(C.bark, 0.8)),
      { kind: 'cone', pos: [0, 0.62, 0], scale: [0.92, 0.60, 0.92], color: P.pineDark, seg: 7, hueJitter: 0.025 },
      { kind: 'cone', pos: [0, 0.95, 0], scale: [0.74, 0.54, 0.74], color: P.pineMid, seg: 7, hueJitter: 0.025 },
      { kind: 'cone', pos: [0, 1.26, 0], scale: [0.54, 0.46, 0.54], color: P.pineLit, seg: 6, hueJitter: 0.02 },
      { kind: 'cone', pos: [0, 1.52, 0], scale: [0.30, 0.36, 0.30], color: shade(P.pineLit, 1.1), seg: 5 },
      { kind: 'cone', pos: [-0.30, 0.74, 0.10], rot: [0, 0, 0.6], scale: [0.30, 0.30, 0.30], color: P.pineDark, seg: 4 },
    ],
  };
}

/** 활엽수 — 덩어리 4개로 뭉친 수관 (110 tri, 높이 1.37) */
function broadleaf(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.27, 0], scale: [0.17, 0.55, 0.17], color: C.bark, seg: 5 },
      flare(0, 0.09, 0, 0.36, 0.18, shade(C.bark, 0.78)),
      { kind: 'ico', pos: [0, 0.95, 0], rot: [0.3, 0.5, 0.1], scale: [0.86, 0.66, 0.80], color: C.leaf, hueJitter: 0.035 },
      { kind: 'ico', pos: [0.32, 0.78, 0.10], rot: [1.1, 0.2, 0.6], scale: [0.52, 0.46, 0.50], color: P.leafWarm, hueJitter: 0.035 },
      { kind: 'ico', pos: [-0.30, 0.84, -0.14], rot: [0.6, 1.3, 0.2], scale: [0.46, 0.42, 0.44], color: C.leafDark, hueJitter: 0.035 },
      { kind: 'ico', pos: [0.06, 1.18, 0.06], rot: [0.9, 0.4, 1.0], scale: [0.42, 0.38, 0.40], color: shade(C.leaf, 1.16), hueJitter: 0.035 },
    ],
  };
}

/** 바위 — 각진 이코사 4덩이 (80 tri, 높이 0.55) */
function boulder(color: number): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.20, 0], rot: [0.4, 0.8, 0.2], scale: [0.62, 0.46, 0.56], color, hueJitter: 0.016 },
      { kind: 'ico', pos: [0.06, 0.38, -0.04], rot: [1.1, 0.4, 0.9], scale: [0.38, 0.34, 0.34], color: shade(color, 1.12), hueJitter: 0.016 },
      { kind: 'ico', pos: [0.30, 0.12, 0.16], rot: [1.2, 0.3, 0.5], scale: [0.32, 0.24, 0.30], color, hueJitter: 0.016 },
      { kind: 'ico', pos: [-0.28, 0.10, -0.14], rot: [0.7, 1.4, 0.2], scale: [0.26, 0.20, 0.24], color: shade(color, 0.86), hueJitter: 0.016 },
    ],
  };
}

/**
 * 야자수 — 굽은 줄기 + 판 잎 11장 (92 tri, 높이 1.55).
 * 종전 palm(236)의 잎은 box 12장이라 55° 카메라에서 **바닥에 붙은 초록 별표**로 보였다.
 * 잎을 판으로 바꾸고 줄기를 키워 위쪽에 잎을 몰아 두면 같은 값에 나무가 된다.
 */
function palmTall(): Element {
  const solids: PartSpec[] = [
    flare(0, 0.08, 0, 0.34, 0.16, shade(C.bark, 0.75)),
    { kind: 'cyl', pos: [0.03, 0.33, 0], rot: [0, 0, -0.10], scale: [0.17, 0.62, 0.17], color: C.bark, seg: 5 },
    { kind: 'cyl', pos: [0.13, 0.92, 0], rot: [0, 0, -0.24], scale: [0.14, 0.62, 0.14], color: shade(C.bark, 1.14), seg: 5 },
    { kind: 'ico', pos: [0.22, 1.18, 0.02], rot: [0.4, 0.3, 0.2], scale: [0.20, 0.16, 0.20], color: 0x6b4b2a },
  ];
  const flats: FlatSpec[] = [];
  // 잎은 **끝이 처지게** 기울인다. 수평에 가까우면 위에서 봤을 때 초록 별표가 되고
  // (종전 palm의 병), 25~35° 처지면 잎 끝이 줄기보다 아래로 내려와 왕관처럼 읽힌다.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.35;
    flats.push({
      pos: [0.26 + Math.cos(a) * 0.40, 1.30 - (i % 3) * 0.07, Math.sin(a) * 0.40],
      rot: [-0.52 - (i % 2) * 0.1, Math.PI / 2 - a, 0],
      scale: [0.25, 1.06],
      color: i % 2 ? P.frond : P.frondLit,
      hueJitter: 0.03,
    });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 1.1;
    flats.push({
      pos: [0.26 + Math.cos(a) * 0.18, 1.40, Math.sin(a) * 0.18],
      rot: [-0.30, Math.PI / 2 - a, 0],
      scale: [0.19, 0.56],
      color: P.frondDark,
      hueJitter: 0.03,
    });
  }
  return { solids, flats };
}

/** 정글 거목 — 넓게 퍼진 2단 캐노피 (110 tri, 높이 1.50) */
function jungleTree(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.39, 0], scale: [0.20, 0.78, 0.20], color: shade(C.bark, 0.9), seg: 5 },
      flare(0, 0.10, 0, 0.40, 0.20, shade(C.bark, 0.72)),
      { kind: 'ico', pos: [0, 1.02, 0], rot: [0.2, 0.6, 0.1], scale: [0.98, 0.52, 0.92], color: P.jungleCanopy, hueJitter: 0.035 },
      { kind: 'ico', pos: [0.10, 1.28, -0.04], rot: [1.0, 0.3, 0.5], scale: [0.66, 0.44, 0.62], color: P.jungleCanopyLit, hueJitter: 0.035 },
      { kind: 'ico', pos: [-0.42, 0.92, 0.16], rot: [0.6, 1.2, 0.3], scale: [0.54, 0.40, 0.50], color: C.leafDark, hueJitter: 0.035 },
      { kind: 'ico', pos: [0.40, 0.86, -0.20], rot: [0.3, 0.9, 0.8], scale: [0.48, 0.36, 0.46], color: P.jungleCanopy, hueJitter: 0.035 },
    ],
  };
}

/** 나무고사리 — 가는 줄기 + 판 잎 6장 (28 tri, 높이 0.95) */
function fernTree(): Element {
  const flats: FlatSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.2;
    flats.push({
      pos: [Math.cos(a) * 0.26, 0.80 - (i % 2) * 0.04, Math.sin(a) * 0.26],
      rot: [-0.42, Math.PI / 2 - a, 0],
      scale: [0.26, 0.66],
      color: i % 2 ? P.frond : P.frondDark,
      hueJitter: 0.03,
    });
  }
  return {
    solids: [{ kind: 'cyl', pos: [0, 0.38, 0], scale: [0.15, 0.76, 0.15], color: shade(C.bark, 1.05), seg: 4 }],
    flats,
  };
}

/** 기둥 선인장 — 팔 2개 (112 tri, 높이 1.28) */
function saguaro(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.58, 0], scale: [0.32, 1.16, 0.32], color: P.cactus1, seg: 6, hueJitter: 0.018 },
      { kind: 'cone', pos: [0, 1.22, 0], scale: [0.32, 0.18, 0.32], color: P.cactus2, seg: 6 },
      { kind: 'cyl', pos: [-0.24, 0.62, 0], rot: [0, 0, 1.45], scale: [0.17, 0.36, 0.17], color: P.cactus1, seg: 4 },
      { kind: 'cyl', pos: [-0.40, 0.84, 0], scale: [0.17, 0.48, 0.17], color: P.cactus2, seg: 4 },
      { kind: 'cone', pos: [-0.40, 1.10, 0], scale: [0.17, 0.14, 0.17], color: P.cactus2, seg: 4 },
      { kind: 'cyl', pos: [0.21, 0.42, 0.06], rot: [0, 0.3, -1.4], scale: [0.15, 0.32, 0.15], color: P.cactus1, seg: 4 },
      { kind: 'cyl', pos: [0.35, 0.62, 0.06], scale: [0.15, 0.40, 0.15], color: P.cactus1, seg: 4 },
    ],
    flats: [
      { pos: [0, 1.32, 0], scale: [0.16, 0.16], color: P.flowerPink, sides: 5 },
      { pos: [-0.40, 1.19, 0.02], scale: [0.13, 0.13], color: P.flowerWhite, sides: 5 },
    ],
  };
}

/** 통 선인장 — 낮고 넓적한 변주 (42 tri, 높이 0.46) */
function barrelCactus(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.18, 0], scale: [0.46, 0.36, 0.46], color: P.cactus1, seg: 6, hueJitter: 0.018 },
      { kind: 'cone', pos: [0, 0.41, 0], scale: [0.44, 0.14, 0.44], color: P.cactus2, seg: 6 },
    ],
    flats: [
      { pos: [0.06, 0.49, 0.04], scale: [0.15, 0.15], color: P.flowerYellow, sides: 5 },
      { pos: [-0.10, 0.47, -0.06], scale: [0.12, 0.12], color: P.flowerRed, sides: 5 },
      { pos: [0.02, 0.46, -0.14], scale: [0.10, 0.10], color: P.flowerWhite, sides: 4 },
    ],
  };
}

/**
 * 층리 바위(메사) — 사암 절벽의 가로 줄무늬를 3단 색 띠로 (64 tri, 높이 0.92).
 * 썸네일 사막의 인상을 만드는 건 선인장이 아니라 **솟은 붉은 바위**다.
 */
function mesaRock(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.15, 0], scale: [0.86, 0.30, 0.78], color: P.sandRockDeep, seg: 6, hueJitter: 0.015 },
      { kind: 'cyl', pos: [0.04, 0.46, -0.03], scale: [0.62, 0.34, 0.58], color: P.sandRock, seg: 5, hueJitter: 0.015 },
      { kind: 'ico', pos: [-0.02, 0.74, 0.02], rot: [0.5, 0.7, 0.2], scale: [0.48, 0.34, 0.44], color: P.sandRockLit, hueJitter: 0.015 },
    ],
  };
}

/**
 * 짐승 뼈 화석 — 두개골 + 척추 + 갈비뼈 우리 (134 tri, 높이 0.52).
 * 갈비뼈는 척추를 따라 **촘촘히 · 좌우 대칭으로** 세운다. 간격을 벌리거나 눕히면
 * 위에서 봤을 때 흩어진 흰 막대기로 보인다(1차 캡처의 사막이 그랬다).
 */
function boneFossil(): Element {
  const solids: PartSpec[] = [
    { kind: 'ico', pos: [-0.42, 0.17, 0], rot: [0.2, 0.4, 0], scale: [0.34, 0.28, 0.28], color: C.bone },
    { kind: 'box', pos: [-0.62, 0.13, 0], rot: [0, 0, 0.12], scale: [0.26, 0.14, 0.16], color: C.bone },
    { kind: 'cone', pos: [-0.36, 0.34, 0.08], rot: [-0.3, 0, -0.35], scale: [0.09, 0.22, 0.09], color: C.bone, seg: 3 },
    { kind: 'cyl', pos: [-0.10, 0.11, 0], rot: [0, 0, Math.PI / 2], scale: [0.09, 0.34, 0.09], color: C.boneDark, seg: 3 },
    { kind: 'cyl', pos: [0.24, 0.10, 0], rot: [0, 0, Math.PI / 2], scale: [0.08, 0.32, 0.08], color: C.boneDark, seg: 3 },
  ];
  const RIB: [number, number][] = [
    [-0.10, 1.0],
    [0.08, 0.9],
    [0.26, 0.72],
  ];
  RIB.forEach(([x, hm]) => {
    const h = 0.52 * hm;
    for (const side of [-1, 1]) {
      solids.push({
        kind: 'cyl',
        pos: [x, h * 0.46, side * 0.10],
        rot: [side * 0.62, 0, 0],
        scale: [0.06, h, 0.06],
        color: side < 0 ? C.bone : C.boneDark,
        seg: 3,
      });
    }
  });
  return { solids };
}

/** 눈 덮인 침엽수 — 3단 + 각 단 눈 모자 (82 tri, 높이 1.57) */
function snowPineTall(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.18, 0], scale: [0.15, 0.36, 0.15], color: C.bark, seg: 4 },
      { kind: 'cone', pos: [0, 0.56, 0], scale: [0.86, 0.56, 0.86], color: P.needleSnow, seg: 6, hueJitter: 0.02 },
      { kind: 'cone', pos: [0.02, 0.74, -0.02], rot: [0.05, 0, 0.03], scale: [0.74, 0.17, 0.74], color: C.snowCap, seg: 6 },
      { kind: 'cone', pos: [0, 0.96, 0], scale: [0.62, 0.48, 0.62], color: P.needleSnowLit, seg: 6, hueJitter: 0.02 },
      { kind: 'cone', pos: [-0.02, 1.12, 0.02], rot: [-0.04, 0, -0.05], scale: [0.52, 0.15, 0.52], color: C.snowCap, seg: 5 },
      { kind: 'cone', pos: [0, 1.28, 0], scale: [0.38, 0.42, 0.38], color: P.needleSnow, seg: 5 },
      { kind: 'cone', pos: [0.01, 1.46, 0], scale: [0.28, 0.24, 0.28], color: C.snowCap, seg: 5 },
    ],
  };
}

/**
 * 얼음 기둥 무리 — 설원 썸네일의 시그니처(청록 스파이크)인데 종전 소품 세트에는
 * 아예 없었다. 팔레트에 C.ice/C.iceDeep/C.crystal 이 이미 있는데 아무도 안 썼다.
 * (56 tri, 높이 1.11)
 */
function iceCrystal(): Element {
  return {
    ao: 0.10, // 얼음은 밑동까지 밝아야 "빛나는" 느낌이 산다
    solids: [
      { kind: 'ico', pos: [0, 0.07, 0], rot: [0.3, 0.6, 0.1], scale: [0.46, 0.16, 0.44], color: C.snowCap },
      { kind: 'cone', pos: [0, 0.56, 0], scale: [0.28, 1.05, 0.28], color: C.crystal, seg: 4, hueJitter: 0.02 },
      { kind: 'cone', pos: [0.24, 0.38, 0.10], rot: [0, 0, -0.18], scale: [0.22, 0.72, 0.22], color: C.ice, seg: 4 },
      { kind: 'cone', pos: [-0.22, 0.29, -0.12], rot: [0, 0, 0.22], scale: [0.18, 0.56, 0.18], color: C.iceDeep, seg: 4 },
      { kind: 'cone', pos: [0.07, 0.21, 0.26], rot: [0.14, 0, 0], scale: [0.14, 0.40, 0.14], color: C.crystal, seg: 3 },
      { kind: 'cone', pos: [-0.16, 0.17, 0.20], rot: [-0.1, 0, 0.1], scale: [0.12, 0.32, 0.12], color: C.ice, seg: 3 },
    ],
  };
}

/** 눈 쌓인 바위 (60 tri, 높이 0.50) */
function snowBoulder(): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.17, 0], rot: [0.4, 0.8, 0.2], scale: [0.62, 0.42, 0.56], color: 0x8ea6bb, hueJitter: 0.015 },
      { kind: 'ico', pos: [-0.02, 0.32, 0.02], rot: [0.9, 0.3, 0.5], scale: [0.58, 0.26, 0.52], color: C.snowCap },
      { kind: 'ico', pos: [0.30, 0.10, 0.16], rot: [1.2, 0.9, 0.3], scale: [0.30, 0.22, 0.28], color: 0x9db4c4, hueJitter: 0.015 },
    ],
  };
}

/** 맹그로브 — 벌어진 뿌리 + 뒤틀린 줄기 + 이끼 커튼 (106 tri, 높이 1.42) */
function mangrove(): Element {
  const solids: PartSpec[] = [
    { kind: 'cyl', pos: [0.02, 0.44, 0], rot: [0, 0, 0.10], scale: [0.21, 0.62, 0.21], color: P.swampBark, seg: 5 },
    { kind: 'cyl', pos: [0.12, 0.94, 0.02], rot: [0, 0, 0.24], scale: [0.15, 0.46, 0.15], color: P.swampBarkLit, seg: 4 },
    { kind: 'ico', pos: [0.16, 1.20, 0.02], rot: [0.2, 0.5, 0.1], scale: [0.78, 0.40, 0.72], color: P.swampLeaf, hueJitter: 0.03 },
    { kind: 'ico', pos: [-0.30, 1.08, -0.10], rot: [0.9, 0.2, 0.6], scale: [0.50, 0.34, 0.48], color: P.swampLeafDark, hueJitter: 0.03 },
  ];
  // 뿌리 4개 — 밑동에서 사방으로 벌어져 섬에 박힌다
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.20, 0.16, Math.sin(a) * 0.20],
      rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5],
      scale: [0.15, 0.42, 0.15],
      color: shade(P.swampBark, 0.85),
      seg: 3,
    });
  }
  return {
    solids,
    flats: [
      { pos: [0.44, 1.02, 0.10], rot: [1.15, 0.4, 0], scale: [0.16, 0.46], color: P.mossHang },
      { pos: [-0.36, 0.96, 0.22], rot: [1.25, -0.7, 0], scale: [0.14, 0.40], color: shade(P.mossHang, 0.86) },
      { pos: [0.06, 1.00, -0.40], rot: [1.2, 2.4, 0], scale: [0.13, 0.36], color: P.mossHang },
    ],
  };
}

/**
 * 고사목 — 가지를 **위로** 뻗게 고쳤다 (82 tri, 높이 1.34).
 * 종전 deadTree 는 가지가 수평이라 55° 카메라에서 바닥에 깔린 검은 거미로 보였다.
 */
function deadTreeUp(): Element {
  const solids: PartSpec[] = [
    flare(0, 0.09, 0, 0.32, 0.18, shade(P.swampBark, 0.78)),
    { kind: 'cyl', pos: [0, 0.38, 0], rot: [0, 0, 0.05], scale: [0.18, 0.70, 0.18], color: P.swampBark, seg: 5 },
    { kind: 'cyl', pos: [0.05, 0.92, 0.01], rot: [0, 0, 0.14], scale: [0.12, 0.46, 0.12], color: P.swampBarkLit, seg: 4 },
  ];
  const BR: [number, number, number, number][] = [
    // [각도, 밑동 높이, 길이, 벌어짐]
    [0.4, 0.72, 0.52, 0.75],
    [2.1, 0.86, 0.44, 0.62],
    [3.8, 0.66, 0.48, 0.85],
    [5.2, 1.02, 0.38, 0.55],
    [1.2, 1.12, 0.32, 0.45],
  ];
  for (const [a, y, len, lean] of BR) {
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * len * 0.30, y + len * 0.34, Math.sin(a) * len * 0.30],
      rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
      scale: [0.10, len, 0.10],
      color: shade(P.swampBark, 1.05),
      seg: 3,
    });
  }
  return { solids };
}

/** 발광 버섯 군집 — 늪의 유일한 광원 (82 tri, 높이 0.64) */
function glowMushroom(): Element {
  return {
    ao: 0.08, // 발광체는 밑동이 어두우면 빛나 보이지 않는다
    solids: [
      { kind: 'cyl', pos: [0, 0.21, 0], scale: [0.16, 0.42, 0.16], color: P.glowStem, seg: 5 },
      { kind: 'ico', pos: [0, 0.48, 0], rot: [0.2, 0.4, 0], scale: [0.62, 0.34, 0.60], color: P.glowCap, hueJitter: 0.03 },
      { kind: 'cyl', pos: [0.29, 0.14, 0.14], scale: [0.12, 0.28, 0.12], color: P.glowStem, seg: 4 },
      { kind: 'cone', pos: [0.29, 0.33, 0.14], scale: [0.42, 0.24, 0.42], color: P.glowCapDeep, seg: 6, hueJitter: 0.03 },
      { kind: 'cone', pos: [-0.27, 0.10, 0.19], scale: [0.09, 0.20, 0.09], color: P.glowStem, seg: 3 },
      { kind: 'cone', pos: [-0.27, 0.25, 0.19], scale: [0.28, 0.18, 0.28], color: P.glowCap, seg: 4 },
    ],
  };
}

/** 이끼 바위 (48 tri, 높이 0.46) */
function mossBoulder(): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.17, 0], rot: [0.4, 0.8, 0.2], scale: [0.58, 0.40, 0.52], color: 0x74806e, hueJitter: 0.015 },
      { kind: 'ico', pos: [-0.01, 0.32, -0.02], rot: [0.2, 0.6, 0.1], scale: [0.48, 0.18, 0.44], color: 0x4f9440, hueJitter: 0.035 },
    ],
    flats: [
      { pos: [0.30, 0.10, 0.18], scale: [0.26, 0.22], color: 0x5aa348, sides: 5, hueJitter: 0.03 },
      { pos: [-0.26, 0.09, -0.16], scale: [0.22, 0.20], color: 0x45803a, sides: 5, hueJitter: 0.03 },
    ],
  };
}

/**
 * 현무암 기둥 — 화산 썸네일의 시그니처인 **세로로 긴 각기둥**이 판에 하나도 없었다.
 * (70 tri, 높이 1.30)
 */
function basaltColumn(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.62, 0], rot: [0, 0, 0.04], scale: [0.34, 1.24, 0.34], color: P.basalt, seg: 5, hueJitter: 0.015 },
      { kind: 'cyl', pos: [0.33, 0.44, 0.14], rot: [0, 0.4, -0.06], scale: [0.27, 0.88, 0.27], color: P.basaltLit, seg: 5, hueJitter: 0.015 },
      { kind: 'cyl', pos: [-0.29, 0.31, -0.16], rot: [0, 0.9, 0.05], scale: [0.23, 0.62, 0.23], color: P.basaltDeep, seg: 5, hueJitter: 0.015 },
      { kind: 'cone', pos: [0, 1.30, 0], scale: [0.30, 0.16, 0.30], color: P.basaltLit, seg: 5 },
    ],
  };
}

/** 재에 타 죽은 나무 — 고사목 골격 + 잉걸 (86 tri, 높이 1.34) */
function charTree(): Element {
  const el = deadTreeUp();
  const solids = (el.solids ?? []).map((p) => ({ ...p, color: shade(P.obsidian, 1.25) }));
  return {
    solids,
    flats: [
      { pos: [0.15, 0.035, 0.19], scale: [0.09, 0.22], rot: [0, 0.6, 0], color: P.lavaHot, sides: 4 },
      { pos: [-0.17, 0.035, -0.15], scale: [0.07, 0.17], rot: [0, -0.9, 0], color: P.lavaDeep, sides: 4 },
    ],
  };
}

/** 흑요석 가시 (30 tri, 높이 0.86) */
function obsidianSpike(): Element {
  return {
    solids: [
      { kind: 'cone', pos: [0, 0.42, 0], rot: [0, 0, 0.06], scale: [0.26, 0.86, 0.26], color: P.obsidian, seg: 4 },
      { kind: 'cone', pos: [0.22, 0.26, 0.12], rot: [0, 0, -0.24], scale: [0.19, 0.54, 0.19], color: shade(P.obsidian, 1.5), seg: 4 },
      { kind: 'cone', pos: [-0.20, 0.19, -0.14], rot: [0.2, 0, 0.28], scale: [0.16, 0.40, 0.16], color: P.obsidian, seg: 4 },
      { kind: 'cone', pos: [0.10, 0.13, -0.24], scale: [0.12, 0.28, 0.12], color: shade(P.obsidian, 1.4), seg: 3 },
    ],
  };
}

/** 분출구 — 림 + 용암 웅덩이 + 갈라진 균열 (44 tri, 높이 0.42) */
function ventCrater(): Element {
  return {
    solids: [
      { kind: 'cone', pos: [0, 0.19, 0], scale: [1.05, 0.38, 1.05], color: P.basaltDeep, seg: 7, hueJitter: 0.015 },
      { kind: 'ico', pos: [0.44, 0.10, 0.28], rot: [0.7, 0.4, 0.3], scale: [0.28, 0.20, 0.26], color: P.basalt },
    ],
    flats: [
      { pos: [0, 0.345, 0], scale: [0.46, 0.40], color: P.lavaDeep, sides: 6, hueJitter: 0.02 },
      { pos: [0, 0.352, 0], scale: [0.26, 0.23], color: P.lavaCore, sides: 5, hueJitter: 0.03 },
      { pos: [0.38, 0.035, -0.32], rot: [0, 0.6, 0], scale: [0.14, 0.46], color: P.lavaHot, sides: 4 },
      { pos: [-0.34, 0.035, 0.36], rot: [0, -0.9, 0], scale: [0.12, 0.40], color: P.lavaDeep, sides: 4 },
    ],
  };
}

// ── 2층: 중간 덤불 ─────────────────────────────────────────────────────────

/** 둥근 덤불 (40 tri, 높이 0.50) */
function bushRound(a: number, b: number): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.20, 0], rot: [0.3, 0.5, 0.2], scale: [0.52, 0.40, 0.48], color: a, hueJitter: 0.04 },
      { kind: 'ico', pos: [0.14, 0.34, -0.08], rot: [1.0, 0.2, 0.7], scale: [0.34, 0.30, 0.32], color: b, hueJitter: 0.04 },
    ],
  };
}

/** 어린 침엽수 (24 tri, 높이 0.62) */
function sapling(): Element {
  return {
    solids: [
      { kind: 'cone', pos: [0, 0.17, 0], scale: [0.36, 0.34, 0.36], color: P.pineDark, seg: 4, hueJitter: 0.03 },
      { kind: 'cone', pos: [0, 0.35, 0], scale: [0.27, 0.28, 0.27], color: P.pineMid, seg: 4, hueJitter: 0.03 },
      { kind: 'cone', pos: [0, 0.51, 0], scale: [0.17, 0.22, 0.17], color: P.pineLit, seg: 4 },
    ],
  };
}

/** 들바위 (28 tri, 높이 0.24) */
function fieldRock(color: number): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.11, 0], rot: [0.5, 0.9, 0.3], scale: [0.36, 0.26, 0.32], color, hueJitter: 0.02 },
      { kind: 'cone', pos: [0.18, 0.06, 0.12], rot: [0.2, 0.4, 0.3], scale: [0.22, 0.16, 0.22], color: shade(color, 0.88), seg: 4 },
    ],
  };
}

/** 고사리 다발 — 판 5장 (10 tri, 높이 0.30) */
function fernBush(color: number): Element {
  const flats: FlatSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    flats.push({
      pos: [Math.cos(a) * 0.16, 0.14 + (i % 2) * 0.05, Math.sin(a) * 0.16],
      rot: [0.34, Math.PI / 2 - a, 0],
      scale: [0.22, 0.58],
      color: i % 2 ? color : shade(color, 0.84),
      hueJitter: 0.035,
    });
  }
  return { flats, ao: 0.12 };
}

/** 꽃 덤불 — 잎 덩어리 + 꽃 판 3장 (26 tri, 높이 0.42) */
function flowerBush(leaf: number, petal: number): Element {
  return {
    solids: [{ kind: 'ico', pos: [0, 0.17, 0], rot: [0.3, 0.7, 0.2], scale: [0.46, 0.34, 0.44], color: leaf, hueJitter: 0.04 }],
    flats: [
      { pos: [0.10, 0.34, 0.06], scale: [0.19, 0.19], color: petal, sides: 5, hueJitter: 0.03 },
      { pos: [-0.13, 0.31, -0.08], scale: [0.16, 0.16], color: petal, sides: 5, hueJitter: 0.03 },
      { pos: [0.02, 0.30, -0.17], scale: [0.13, 0.13], color: shade(petal, 1.12), sides: 4 },
    ],
  };
}

/** 마른 덤불 — 가시 5줄기 (30 tri, 높이 0.34) */
function dryShrub(color: number): Element {
  const solids: PartSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.11, 0.15, Math.sin(a) * 0.11],
      rot: [Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55],
      scale: [0.10, 0.34, 0.10],
      color: i % 2 ? color : shade(color, 0.86),
      seg: 3,
      hueJitter: 0.03,
    });
  }
  return { solids, ao: 0.12 };
}

/** 새끼 선인장 (24 tri, 높이 0.44) */
function smallCactus(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.19, 0], scale: [0.22, 0.38, 0.22], color: P.cactus1, seg: 4, hueJitter: 0.02 },
      { kind: 'cone', pos: [0, 0.41, 0], scale: [0.22, 0.12, 0.22], color: P.cactus2, seg: 4 },
    ],
  };
}

/** 얼어붙은 관목 (24 tri, 높이 0.32) */
function frozenShrub(): Element {
  const solids: PartSpec[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.10, 0.14, Math.sin(a) * 0.10],
      rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5],
      scale: [0.09, 0.32, 0.09],
      color: i % 2 ? 0x6b7a6a : C.snowCap,
      seg: 3,
    });
  }
  return { solids, ao: 0.12 };
}

/** 얼음 조각 (16 tri, 높이 0.44) */
function iceShard(): Element {
  return {
    ao: 0.08,
    solids: [
      { kind: 'cone', pos: [0, 0.22, 0], rot: [0, 0, 0.12], scale: [0.20, 0.44, 0.20], color: C.crystal, hueJitter: 0.02, seg: 4 },
      { kind: 'cone', pos: [0.14, 0.13, 0.08], rot: [0, 0, -0.3], scale: [0.14, 0.28, 0.14], color: C.iceDeep, seg: 4 },
    ],
  };
}

/** 눈더미 (20 tri, 높이 0.26) */
function snowMound(): Element {
  return {
    solids: [{ kind: 'ico', pos: [0, 0.10, 0], rot: [0.3, 0.8, 0.2], scale: [0.54, 0.26, 0.48], color: C.snowCap, hueJitter: 0.008 }],
  };
}

/** 갈대 다발 (30 tri, 높이 0.58) */
function reeds(): Element {
  const solids: PartSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.2;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.09, 0.28, Math.sin(a) * 0.09],
      rot: [Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22],
      scale: [0.07, 0.56, 0.07],
      color: i % 2 ? P.reed : shade(P.reed, 0.82),
      seg: 3,
      hueJitter: 0.03,
    });
  }
  return { solids, ao: 0.12 };
}

/** 작은 발광 버섯 무리 (30 tri, 높이 0.32) */
function glowCluster(): Element {
  return {
    ao: 0.06,
    solids: [
      { kind: 'cone', pos: [0, 0.09, 0], scale: [0.09, 0.18, 0.09], color: P.glowStem, seg: 3 },
      { kind: 'cone', pos: [0, 0.23, 0], scale: [0.34, 0.20, 0.34], color: P.glowCap, seg: 5, hueJitter: 0.03 },
      { kind: 'cone', pos: [0.19, 0.06, 0.11], scale: [0.07, 0.13, 0.07], color: P.glowStem, seg: 3 },
      { kind: 'cone', pos: [0.19, 0.16, 0.11], scale: [0.24, 0.14, 0.24], color: P.glowCapDeep, seg: 4 },
    ],
  };
}

/** 잉걸 바위 (24 tri, 높이 0.28) */
function emberRock(): Element {
  return {
    solids: [{ kind: 'ico', pos: [0, 0.13, 0], rot: [0.6, 0.4, 0.9], scale: [0.42, 0.30, 0.38], color: P.basalt, hueJitter: 0.02 }],
    flats: [
      { pos: [0.17, 0.032, 0.13], rot: [0, 0.8, 0], scale: [0.07, 0.17], color: P.lavaHot, sides: 4 },
      { pos: [-0.18, 0.032, -0.11], rot: [0, -0.4, 0], scale: [0.055, 0.13], color: P.lavaDeep, sides: 4 },
    ],
  };
}

/** 현무암 파편 (20 tri, 높이 0.52) */
function basaltShard(): Element {
  return {
    solids: [{ kind: 'cyl', pos: [0, 0.26, 0], rot: [0, 0.4, 0.10], scale: [0.24, 0.52, 0.24], color: P.basaltLit, seg: 5, hueJitter: 0.02 }],
  };
}

// ── 3층: 바닥 ──────────────────────────────────────────────────────────────

/** 풀 다발 — 잎 3장 (18 tri, 높이 0.36) */
function grassTuft(color: number): Element {
  const solids: PartSpec[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.7;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.07, 0.17, Math.sin(a) * 0.07],
      rot: [Math.sin(a) * 0.42, 0, -Math.cos(a) * 0.42],
      scale: [0.10, 0.36, 0.10],
      color: i === 1 ? shade(color, 1.14) : color,
      seg: 3,
      hueJitter: 0.04,
    });
  }
  return { solids, ao: 0.10 };
}

/**
 * 꽃 무리 — 잎 판 2장 + 꽃송이 판 3장 (10 tri).
 * 꽃만 흩으면 흰 사각형이 잔디 위 **종이 조각**으로 보인다(1차 캡처에서 확인).
 * 아래에 초록 잎을 깔고 꽃을 그 위에 작게 얹어야 "풀에 핀 꽃"으로 읽힌다.
 */
function flowerPatch(leaf: number, a: number, b: number): Element {
  return {
    ao: 0,
    flats: [
      { pos: [0.03, 0.036, 0.02], scale: [0.34, 0.30], color: leaf, sides: 5, hueJitter: 0.04 },
      { pos: [-0.11, 0.036, -0.09], scale: [0.24, 0.21], color: shade(leaf, 0.88), sides: 5, hueJitter: 0.04 },
      { pos: [0.08, 0.052, 0.03], scale: [0.10, 0.10], color: a, sides: 4, hueJitter: 0.03 },
      { pos: [-0.07, 0.052, 0.09], scale: [0.085, 0.085], color: b, sides: 4, hueJitter: 0.03 },
      { pos: [0.01, 0.052, -0.10], scale: [0.075, 0.075], color: a, sides: 4, hueJitter: 0.03 },
    ],
  };
}

/** 자갈 무리 (16 tri, 높이 0.14) */
function pebbles(color: number): Element {
  return {
    solids: [
      { kind: 'cone', pos: [0.08, 0.06, 0.03], rot: [0.3, 0.5, 0.2], scale: [0.26, 0.14, 0.24], color, seg: 4, hueJitter: 0.02 },
      { kind: 'cone', pos: [-0.11, 0.05, -0.08], rot: [0.6, 0.2, 0.4], scale: [0.20, 0.11, 0.19], color: shade(color, 0.88), seg: 4 },
    ],
  };
}

/**
 * 용암 이음매 — **탄 가장자리 + 밝은 심** 2겹 판 (8 tri).
 * 밝은 선 하나만 깔면 바닥에 떨어진 주황 성냥개비로 보인다(2차 캡처의 화산이 그랬다).
 * 어두운 탄 자국을 밑에 넓게 깔고 그 안에 좁은 심을 넣어야 "갈라진 틈에서 새어 나온 빛"이 된다.
 */
function lavaSeam(): Element {
  const seam = (a: number, len: number, w: number, y: number): FlatSpec[] => [
    { pos: [Math.sin(a) * len * 0.5, 0.032, Math.cos(a) * len * 0.5], rot: [0, a, 0], scale: [w, len], color: 0x2b1712, sides: 4 },
    {
      pos: [Math.sin(a) * len * 0.5, y, Math.cos(a) * len * 0.5],
      rot: [0, a, 0],
      scale: [w * 0.34, len * 0.86],
      color: P.lavaHot,
      sides: 4,
      hueJitter: 0.03,
    },
  ];
  return { ao: 0, flats: [...seam(0.4, 0.68, 0.17, 0.038), ...seam(0.4 + Math.PI * 0.86, 0.4, 0.12, 0.038)] };
}

/** 지면 색 패치 — 오각 판 1장 (3 tri). 단색 타일을 깨는 가장 싼 수단이다 */
function groundPatch(color: number, w = 0.52): Element {
  return { ao: 0, flats: [{ pos: [0, 0.032, 0], scale: [w, w * 0.86], color, sides: 5, hueJitter: 0.02 }] };
}

/**
 * 갈라진 땅 / 용암 줄기 — 한 점에서 뻗어 나가는 가는 판 3장 (6 tri).
 * 방향을 제각각 두면 바닥에 떨어진 막대기 세 개로 보인다(1차 캡처의 화산이 그랬다).
 * **같은 원점에서 갈라지게** 두어야 균열 한 줄기로 읽힌다.
 */
function crackLines(color: number, wid = 0.05): Element {
  const branch = (a: number, len: number, w: number, col: number): FlatSpec => ({
    pos: [Math.sin(a) * len * 0.5, 0.033, Math.cos(a) * len * 0.5],
    rot: [0, a, 0],
    scale: [w, len],
    color: col,
    sides: 4,
    hueJitter: 0.02,
  });
  // 두 줄기는 거의 **일직선**(0.30 / 0.30+π)으로 두고 곁가지 하나만 튼다.
  // 세 방향으로 벌리면 새 발자국처럼 보인다.
  return {
    ao: 0,
    flats: [
      branch(0.30, 0.60, wid, color),
      branch(0.30 + Math.PI, 0.46, wid * 0.85, color),
      branch(1.75, 0.30, wid * 0.7, shade(color, 0.88)),
    ],
  };
}

// --- 바이옴 편성 -----------------------------------------------------------

export interface BiomeKit {
  /** 1층 후보 (배열에 여러 번 넣으면 그만큼 자주 나온다) */
  hero: Element[];
  /** 1층 크기 배율 범위 */
  heroScale: [number, number];
  /** 2층 후보 / 개수 범위 */
  mid: Element[];
  midCount: [number, number];
  /** 3층 후보 / 개수 범위 */
  ground: Element[];
  groundCount: [number, number];
  /** 접촉 그림자에 섞는 차가운 색 (그림자는 지면색을 어둡게 + 이 색으로 살짝 민다) */
  shadowTint: number;
  /** 접촉 그림자 명도 배율 */
  shadowMul: number;
}

/**
 * 바이옴 편성표 — **각 바이옴에 그곳에만 있는 실루엣**을 하나씩 박아 넣는 것이 목적이다.
 * (종전에는 여섯 곳이 팔레트 색만 달랐다: 설원은 48개 소품이 단 2종이었다)
 */
const BIOME_KITS: Record<BiomeId, BiomeKit> = {
  grassland: {
    hero: [pineTall(), pineTall(), broadleaf(), broadleaf(), boulder(C.rock)],
    heroScale: [0.78, 1.0],
    mid: [bushRound(P.bushDark, P.bushLit), sapling(), fieldRock(C.rock), bushRound(C.leafDark, P.leafWarm)],
    midCount: [1, 2],
    ground: [
      grassTuft(P.grassBlade),
      grassTuft(shade(P.grassBlade, 0.86)),
      flowerPatch(P.grassBlade, P.flowerWhite, P.flowerYellow),
      pebbles(C.rock),
      groundPatch(0x6fb444),
    ],
    groundCount: [2, 4],
    shadowTint: 0x2a4a5e,
    shadowMul: 0.56,
  },
  jungle: {
    hero: [palmTall(), palmTall(), palmTall(), jungleTree(), jungleTree(), fernTree()],
    heroScale: [0.80, 1.02],
    mid: [
      fernBush(P.frond),
      fernBush(P.frondDark),
      bushRound(P.jungleCanopy, P.frondLit),
      flowerBush(C.leafDark, P.flowerRed),
    ],
    midCount: [2, 3],
    ground: [
      grassTuft(P.frondDark),
      fernBush(P.frondLit),
      groundPatch(0x2f8f45),
      flowerPatch(P.frondDark, P.flowerRed, P.flowerYellow),
      pebbles(0x6f7a68),
    ],
    groundCount: [2, 4],
    shadowTint: 0x11384a,
    shadowMul: 0.52,
  },
  desert: {
    hero: [saguaro(), saguaro(), mesaRock(), mesaRock(), boneFossil(), barrelCactus()],
    heroScale: [0.80, 1.02],
    mid: [dryShrub(P.dryBrush), smallCactus(), fieldRock(P.sandRock), dryShrub(shade(P.dryBrush, 0.88))],
    midCount: [1, 2],
    ground: [
      crackLines(P.sandCrack, 0.035),
      grassTuft(P.dryBrush),
      pebbles(P.sandRock),
      groundPatch(0xdcb462),
      groundPatch(0xd0a154, 0.62),
    ],
    groundCount: [2, 4],
    shadowTint: 0x7a5240,
    shadowMul: 0.60,
  },
  snow: {
    hero: [snowPineTall(), snowPineTall(), snowPineTall(), iceCrystal(), iceCrystal(), snowBoulder()],
    heroScale: [0.86, 1.08],
    mid: [frozenShrub(), iceShard(), snowMound(), iceShard()],
    midCount: [2, 3],
    ground: [
      groundPatch(0xdce9f2, 0.6),
      pebbles(0x9db4c4),
      { ao: 0.06, flats: [{ pos: [0.08, 0.034, 0.05], scale: [0.24, 0.20], color: C.ice, sides: 4 }, { pos: [-0.10, 0.034, -0.09], scale: [0.18, 0.15], color: C.iceDeep, sides: 4 }] },
      groundPatch(0xc9dced, 0.44),
    ],
    groundCount: [2, 4],
    shadowTint: 0x6f92c4,
    shadowMul: 0.74,
  },
  swamp: {
    hero: [mangrove(), mangrove(), deadTreeUp(), deadTreeUp(), glowMushroom(), glowMushroom(), mossBoulder()],
    heroScale: [0.80, 1.02],
    mid: [reeds(), glowCluster(), fernBush(P.swampLeaf), reeds()],
    midCount: [1, 3],
    ground: [
      groundPatch(P.puddle, 0.58),
      grassTuft(P.reed),
      { ao: 0, flats: [{ pos: [0.10, 0.033, 0.06], scale: [0.30, 0.26], color: 0x4a7a3c, sides: 6, hueJitter: 0.03 }] },
      pebbles(0x6a7060),
    ],
    groundCount: [2, 4],
    shadowTint: 0x17323c,
    shadowMul: 0.55,
  },
  volcano: {
    hero: [basaltColumn(), basaltColumn(), basaltColumn(), charTree(), charTree(), obsidianSpike(), ventCrater()],
    heroScale: [0.84, 1.08],
    mid: [emberRock(), basaltShard(), emberRock(), basaltShard()],
    midCount: [2, 3],
    ground: [
      lavaSeam(),
      groundPatch(P.ash, 0.54),
      pebbles(P.basaltDeep),
      groundPatch(0x3f322c, 0.46),
    ],
    groundCount: [2, 4],
    shadowTint: 0x1a1218,
    shadowMul: 0.58,
  },
};

// --- 접촉 그림자 -----------------------------------------------------------

/**
 * 태양 방향 — stage3d.ts 의 DirectionalLight 위치 (diag*0.7, diag*1.1, diag*0.4).
 * 그림자를 여기서 직접 굽기 때문에 그쪽 값이 바뀌면 이 상수도 같이 바꿔야 한다.
 */
const SUN = { x: 0.7, y: 1.1, z: 0.4 } as const;
const SUN_FLAT = Math.hypot(SUN.x, SUN.z);
/** 높이 1당 그림자 길이 (0.73) */
const SHADOW_LEN = SUN_FLAT / SUN.y;
/** 그림자가 뻗는 지면 방향 (태양 반대쪽) */
const SHADOW_DIR = { x: -SUN.x / SUN_FLAT, z: -SUN.z / SUN_FLAT } as const;
/** 지면에서 띄우는 높이 — 타일 상면 지터(최대 +0.02)보다 확실히 위 */
const SHADOW_Y = 0.035;

/**
 * 소품 1개의 접촉 그림자 판 (6각형 4 삼각형).
 *
 * 실제 섀도 맵을 흉내 내되 **셀(1×1) 밖으로 새지 않게 잘라 낸다** — 섬 가장자리
 * 소품의 그림자가 절벽 너머 허공에 떠 있으면 즉시 가짜로 보이기 때문이다.
 * 그래서 태양 방향으로 늘이되 반경을 셀 안으로 제한한다(0.47).
 */
function contactShadowSpec(
  wx: number,
  wz: number,
  dx: number,
  dz: number,
  r: number,
  h: number,
  color: number,
): FlatSpec {
  const reach = Math.min(h * SHADOW_LEN * 0.42, 0.30);
  let ox = dx + SHADOW_DIR.x * reach;
  let oz = dz + SHADOW_DIR.z * reach;
  let halfW = Math.max(0.16, r * 1.02);
  let halfL = halfW + reach * 0.8;
  const ext = Math.max(Math.abs(ox), Math.abs(oz)) + halfL;
  if (ext > 0.47) {
    const k = 0.47 / ext;
    ox *= k;
    oz *= k;
    halfW *= k;
    halfL *= k;
  }
  return {
    pos: [wx + ox, SHADOW_Y, wz + oz],
    // 6각형은 z 방향이 1.155배 길다 — 길이를 그만큼 되돌린다
    rot: [0, Math.atan2(SHADOW_DIR.x, SHADOW_DIR.z), 0],
    scale: [halfW * 2, halfL * 1.73],
    color,
    sides: 6,
  };
}

/** 지면색 + 바이옴 냉색 → 그림자 색 (팔레트가 바뀌면 그림자도 따라 바뀐다) */
function shadowColor(biome: BiomeId): number {
  const kit = BIOME_KITS[biome];
  const ground = BIOMES[biome].ground[0] ?? 0x808080;
  return _c
    .setHex(ground)
    .lerp(new THREE.Color(kit.shadowTint), 0.44)
    .multiplyScalar(kit.shadowMul)
    .getHex();
}

// --- 배치 -----------------------------------------------------------------

/** 인스턴스마다 색을 조금씩 밀어 "복붙"을 지운다 (h = 색상환, l = 명도 배율) */
function shiftGeoColor(geo: THREE.BufferGeometry, dh: number, lm: number): void {
  const col = geo.getAttribute('color');
  if (!col) return;
  for (let i = 0; i < col.count; i++) {
    _c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    _c.getHSL(_hsl);
    _c.setHSL((_hsl.h + dh + 1) % 1, _hsl.s, clamp01(_hsl.l * lm));
    col.setXYZ(i, _c.r, _c.g, _c.b);
  }
}

/** 캐시된 원형 지오메트리 + 크기(그림자 계산용) */
interface Baked {
  geo: THREE.BufferGeometry;
  /** XZ 최대 반경 */
  r: number;
  /** 최고 높이 */
  h: number;
}

function bakedOf(biome: BiomeId, layer: string, idx: number, el: Element): Baked {
  const key = `prop:${biome}:${layer}:${idx}`;
  const geo = cachedGeo(key, () => bakeElement(el, hashSeed(key)));
  const bb = geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox);
  const r = bb ? Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) : 0.4;
  const h = bb ? bb.max.y : 0.5;
  return { geo, r, h };
}

export interface PropsBuild {
  group: THREE.Group;
  /**
   * 그 셀의 소품(3층 전부)을 없애고 남은 셀만 다시 병합한다 (드로우콜은 그대로 1).
   * 제거된 게 있으면 true. 골드 제거는 드문 이벤트라 재병합 비용을 감수한다.
   */
  removeCell(cellX: number, cellZ: number): boolean;
  /**
   * 그 셀 1층 소품의 셀 중심 대비 산포 오프셋 (없으면 null).
   * 선택 링이 밑동을 정확히 감싸도록 데칼이 이 값을 쓴다.
   */
  offsetOf(cellX: number, cellZ: number): { dx: number; dz: number } | null;
  dispose(): void;
}

/**
 * 지정된 소품 셀에 3층 장식을 산포 — 병합 메시 1개 반환.
 * 셀 선택은 data/grid.sceneryCells가 담당 (sim의 건설 불가 판정과 동일 시드).
 * **이 함수는 셀 목록을 늘리거나 줄이지 않는다** — 밀도를 바꾸면 건설 가능 칸 수가
 * 바뀌어 밸런스가 통째로 흔들린다. 여기서 늘어난 것은 셀 **안**의 오브젝트 수뿐이다.
 *
 * 셀별 변환 완료 지오메트리를 CPU에 들고 있다가 removeCell 시 남은 것만 재병합한다.
 * (셀마다 Mesh를 두면 드로우콜이 소품 수만큼 늘어 예산을 즉시 초과한다)
 */
export function buildProps(
  biome: BiomeId,
  propCellList: readonly Vec2[],
  cellToWorld: (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3,
  seed: number,
): PropsBuild {
  const rng = new Rng(hashSeed(`props:${biome}:${seed}`));
  const kit = BIOME_KITS[biome];
  const shColor = shadowColor(biome);
  /** 셀 좌표 → 그 셀의 변환/틴트 완료 지오메트리 (병합 전 원본, 재병합용으로 보관) */
  const parts = new Map<string, THREE.BufferGeometry>();
  /** 셀 좌표 → 1층 산포 오프셋 (선택 링이 밑동을 감싸도록 밖에 알려 준다) */
  const offsets = new Map<string, { dx: number; dz: number }>();

  /** 원형을 클론해 자리에 앉히고 색을 흩는다 */
  const place = (b: Baked, x: number, z: number, scale: number, dh: number, lm: number): THREE.BufferGeometry => {
    const g = b.geo.clone();
    geoTransform(g, x, 0, z, rng.range(0, Math.PI * 2), scale);
    shiftGeoColor(g, dh, lm);
    return g;
  };

  for (const cell of propCellList) {
    cellToWorld(cell.x, cell.z, _v);
    const cx = _v.x;
    const cz = _v.z;
    const pieces: THREE.BufferGeometry[] = [];

    // ── 1층: 큰 실루엣 ──
    const hi = rng.int(0, kit.hero.length - 1);
    const hero = bakedOf(biome, 'h', hi, kit.hero[hi] as Element);
    const dx = rng.range(-PROP_JITTER, PROP_JITTER);
    const dz = rng.range(-PROP_JITTER, PROP_JITTER);
    const hs = rng.range(kit.heroScale[0], kit.heroScale[1]);
    pieces.push(place(hero, cx + dx, cz + dz, hs, rng.range(-0.022, 0.022), rng.range(0.9, 1.1)));

    // ── 접촉 그림자 (소품이 그림자를 굽지 않는 대신) ──
    pieces.push(
      buildFlats([contactShadowSpec(cx, cz, dx, dz, hero.r * hs, hero.h * hs, shColor)], hashSeed(`sh:${cell.x},${cell.z}`), 0.02),
    );

    // ── 2층·3층: 셀 안 고리에 흩는다 (1층 밑동과는 겹치지 않게 민다) ──
    const scatter = (list: Element[], layer: string, n: number, rMin: number, sMin: number, sMax: number): void => {
      for (let i = 0; i < n; i++) {
        const idx = rng.int(0, list.length - 1);
        const el = list[idx];
        if (!el) continue;
        const b = bakedOf(biome, layer, idx, el);
        const a = rng.range(0, Math.PI * 2);
        let rad = rng.range(rMin, UNDER_RADIUS_MAX);
        const px = Math.cos(a) * rad;
        const pz = Math.sin(a) * rad;
        // 1층 밑동에 파묻히면 밖으로 민다
        if (Math.hypot(px - dx, pz - dz) < 0.22) rad = Math.min(UNDER_RADIUS_MAX, rad + 0.22);
        pieces.push(
          place(
            b,
            cx + Math.cos(a) * rad,
            cz + Math.sin(a) * rad,
            rng.range(sMin, sMax),
            rng.range(-0.03, 0.03),
            rng.range(0.86, 1.14),
          ),
        );
      }
    };
    scatter(kit.mid, 'm', rng.int(kit.midCount[0], kit.midCount[1]), 0.24, 0.8, 1.15);
    scatter(kit.ground, 'g', rng.int(kit.groundCount[0], kit.groundCount[1]), 0.14, 0.75, 1.25);

    const merged = mergeGeometries(pieces, false);
    for (const p of pieces) p.dispose();
    if (!merged) continue;
    parts.set(`${cell.x},${cell.z}`, merged);
    offsets.set(`${cell.x},${cell.z}`, { dx, dz });
  }

  const group = new THREE.Group();
  group.name = 'props';
  // flatMat()은 모듈 공유 싱글턴 — 여기서 dispose하면 안 된다
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), flatMat());
  mesh.name = 'propsMesh';
  /**
   * ⚠ 소품은 그림자를 굽지 않는다 — 대신 위 contactShadowSpec 이 지면에 판을 깐다.
   * 섀도 패스는 캐스터의 지오메트리를 **한 번 더** 그리므로, 소품이 캐스터로 남으면
   * 소품 삼각형이 프레임에서 두 번 청구된다(실측 스테이지3: 10,584 × 2 = 21,168).
   * 이 한 줄이 3층 장식을 얹고도 6개 스테이지 전부가 예산 안에 있는 이유다.
   */
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);

  /** 남은 셀 전체를 하나로 병합 — 소품이 0개면 메시를 숨겨 드로우콜도 0으로 */
  const remerge = (): void => {
    const prev = mesh.geometry;
    const live = [...parts.values()];
    const merged = live.length > 0 ? mergeGeometries(live, false) : null;
    mesh.geometry = merged ?? new THREE.BufferGeometry();
    mesh.visible = merged !== null;
    prev.dispose();
  };
  remerge();

  return {
    group,
    removeCell(cellX: number, cellZ: number): boolean {
      const key = `${cellX},${cellZ}`;
      const g = parts.get(key);
      if (!g) return false;
      parts.delete(key);
      offsets.delete(key);
      g.dispose();
      remerge();
      return true;
    },
    offsetOf(cellX: number, cellZ: number): { dx: number; dz: number } | null {
      return offsets.get(`${cellX},${cellZ}`) ?? null;
    },
    dispose(): void {
      mesh.geometry.dispose();
      for (const g of parts.values()) g.dispose();
      parts.clear();
      offsets.clear();
    },
  };
}

/** 테스트/계측용 — 층 요소 전체 (이름 → 설계도). 삼각형 원가표를 여기서 뽑는다 */
export const PROP_ELEMENTS: Readonly<Record<string, Element>> = {
  pineTall: pineTall(),
  broadleaf: broadleaf(),
  boulder: boulder(C.rock),
  palmTall: palmTall(),
  jungleTree: jungleTree(),
  fernTree: fernTree(),
  saguaro: saguaro(),
  barrelCactus: barrelCactus(),
  mesaRock: mesaRock(),
  boneFossil: boneFossil(),
  snowPineTall: snowPineTall(),
  iceCrystal: iceCrystal(),
  snowBoulder: snowBoulder(),
  mangrove: mangrove(),
  deadTreeUp: deadTreeUp(),
  glowMushroom: glowMushroom(),
  mossBoulder: mossBoulder(),
  basaltColumn: basaltColumn(),
  charTree: charTree(),
  obsidianSpike: obsidianSpike(),
  ventCrater: ventCrater(),
  bushRound: bushRound(P.bushDark, P.bushLit),
  sapling: sapling(),
  fieldRock: fieldRock(C.rock),
  fernBush: fernBush(P.frond),
  flowerBush: flowerBush(C.leafDark, P.flowerRed),
  dryShrub: dryShrub(P.dryBrush),
  smallCactus: smallCactus(),
  frozenShrub: frozenShrub(),
  iceShard: iceShard(),
  snowMound: snowMound(),
  reeds: reeds(),
  glowCluster: glowCluster(),
  emberRock: emberRock(),
  basaltShard: basaltShard(),
  grassTuft: grassTuft(P.grassBlade),
  flowerPatch: flowerPatch(P.grassBlade, P.flowerWhite, P.flowerYellow),
  pebbles: pebbles(C.rock),
  groundPatch: groundPatch(0x6fb444),
  crackLines: crackLines(P.sandCrack, 0.035),
  lavaSeam: lavaSeam(),
};

/** 설계도의 삼각형 수 (실제로 굽지 않고 센다 — 원가표 테스트용) */
export function elementTriCount(el: Element): number {
  let n = 0;
  for (const s of el.solids ?? []) {
    const seg = s.seg ?? 6;
    n += s.kind === 'box' ? 12 : s.kind === 'cyl' ? 4 * seg : s.kind === 'cone' ? 2 * seg : s.kind === 'ico' ? 20 : 80;
  }
  for (const f of el.flats ?? []) n += (f.sides ?? 4) - 2;
  return n;
}

/** 바이옴 편성 (테스트/계측용) */
export const PROP_KITS: Readonly<Record<BiomeId, BiomeKit>> = BIOME_KITS;
