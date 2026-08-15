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
 *   1층(hero)  셀마다 1개 + 밑동 옆 부 소품 1개(조건부). 타일보다 큰 실루엣
 *   2층(mid)   1~4개. 덤불·고사리·갈대·얼음 조각·덩굴 — 10~40 삼각형
 *   3층(ground) 3~5개. 풀 다발·꽃·자갈·웅덩이·유황 — 3~18 삼각형
 * 무성함은 폴리곤이 아니라 **겹침**에서 온다. 셀당 오브젝트 수가 1 → 5~9로 늘었는데
 * 삼각형은 개정 전 프레임 청구액의 절반 이하다(아래 예산표).
 *
 * ── 2차 개정: 크기 계층 ────────────────────────────────────────────────────
 * 위 3층 구조를 얹고도 판이 허전하다는 지적이 남았고, 정량적 정체는 종류 수가 아니라
 * **크기 폭**이었다. heroScale 이 ±12%(0.78~1.0)에 원형 높이도 1.37~1.70 이라,
 * 곱해도 판 위 모든 나무가 28% 밴드 안에 있었다 — 같은 도장을 45번 찍은 그림.
 * 그래서 셋을 같이 했다:
 *   (a) 배율을 세 계층으로 나눠 뽑는다 (HERO_TIERS — 구간 **사이에 틈**을 둔다)
 *   (b) 원형 목록에 2.0급(pineGiant/buttressTree/iceSpireTall/rockSpire/basaltStack)과
 *       0.3급(그루터기·눕힌 통나무)을 같이 넣는다 — 배율만 넓히면 같은 실루엣이
 *       커졌다 작아졌다 할 뿐이다
 *   (c) 1층이 작게 뽑힌 셀에는 부 소품을 붙여 셀이 통째로 비지 않게 한다
 * 실제 높이 폭은 1.33~1.70(1.3배)에서 0.17~2.32(최대 13배)로 벌어졌다.
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

/**
 * 셀을 채울 때 실제로 쓰는 예산 — CELL_TRI_BUDGET 에서 8 만큼 뺀 값.
 *
 * 후보 목록을 넓히고 크기 계층까지 섞으면 이론 최악 조합이 바이옴에 따라
 * 306~377 삼각형까지 튄다. 개정 전처럼 "편성표를 상한에 맞춰 손으로 깎는" 방식은
 * 후보가 6~10종이 되는 순간 유지가 불가능하다(조합이 수백 가지다). 그래서
 * buildProps 가 **굽기 전에 세어 가며** 채우고, 이 상수가 그 하드 캡이다.
 * 곧 CELL_TRI_BUDGET 초과는 확률이 낮은 게 아니라 **구조적으로 불가능**하다.
 */
export const CELL_SOFT_BUDGET = CELL_TRI_BUDGET - 8;

/** 접촉 그림자 판 1장(6각형) — 셀 예산에서 미리 뗀다 */
const SHADOW_TRI = 4;

/** 2·3층 최소 몫 — 부 소품이 이만큼은 남기고 들어와야 한다 (2층 1개 + 3층 3개 급) */
const UNDER_RESERVE = 68;

/** 3층 몫 — 2층이 여기까지 먹어 들어가지 못하게 막는다 (3층 3~4개 급) */
const GROUND_RESERVE = 42;

/** 소품(1층)이 셀 중심에서 흩어지는 최대 오프셋 (선택 링이 같은 값을 써서 밑동을 감싼다) */
export const PROP_JITTER = 0.18;

/** 2·3층이 놓이는 셀 안 반경 상한 — 셀(1×1) 밖으로 새지 않게 */
const UNDER_RADIUS_MAX = 0.46;

/**
 * 색 명도 배율 — 같은 계열 안에서 면을 나눠 각진 결을 살릴 때 쓴다.
 * (export 인 이유: 맨 셀 바닥 결 레이어(grounddetail.ts)가 **같은 함수**로 색을
 *  나눠야 두 레이어의 톤이 갈리지 않는다. 복제하면 조용히 어긋난다)
 */
export function shade(hex: number, f: number): number {
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

  /*
   * ── 아래는 "바이옴 **안**의 대비"를 위해 새로 넣은 색 ────────────────────
   * 캡처를 6장 나란히 놓고 보면 바이옴끼리는 이미 충분히 다른데, **각자 안에서
   * 단색**인 게 더 큰 병이었다: 초원은 초록 한 톤, 설원은 흰 위의 흰색(지피가
   * 아예 식별되지 않는다), 화산은 검정+주황 2색뿐이라 색상환에서 두 점만 쓴다.
   * 그래서 신규 요소의 색은 "새 종류"보다 **다른 명도/색상 악센트**를 먼저 골랐다.
   */
  // 초원 — 흰 줄기(자작나무)와 갈색 맨흙이 초록 단색을 깬다
  birchBark: 0xe4dfcd,
  birchBarkShade: 0xc9c2ab,
  birchKnot: 0x413b31,
  soil: 0x6f5436,
  soilLit: 0x8a6a45,
  stumpTop: 0x9a7850,
  mossPatch: 0x6a9a3e,
  // 정글 — 회색 노두와 대나무 연두가 초록 한 톤을 끊는다
  bamboo: 0x9fc158,
  bambooDark: 0x789c40,
  jungleRock: 0x6f7a68,
  jungleRockLit: 0x8b9682,
  vineGreen: 0x4f9440,
  // 사막 — 아치 그늘의 진갈색이 주황 감자밭에 어두운 점을 찍는다
  sandArchShade: 0x8a542c,
  sandRipple: 0xe2c184,
  cairnStone: 0xb28454,
  // 설원 — 고사목 검정과 마른 갈대 갈색. 흰 판에 유일한 어두운 색이다
  snowRock: 0x8ea6bb,
  snowRockLit: 0xa9becd,
  deadWood: 0x3c372f,
  deadWoodLit: 0x524b40,
  dryReed: 0xa8935e,
  // 늪 — 진흙 갈색이 어두운 초록 한 톤에 명도를 올린다
  mud: 0x4a3a2c,
  mudBubble: 0x7d6852,
  puddleLit: 0x4a8a72,
  cattailHead: 0x7d5a30,
  // 화산 — 연기 회백색 + 유황 노랑이 검정·주황 사이의 세 번째·네 번째 점이다
  smokePale: 0xd6d0c6,
  smokeGray: 0xa7a199,
  sulfur: 0xd8c24a,
  sulfurLit: 0xb8c85a,
  charGrassCol: 0x5a4a38,
  lavaCrust: 0x2b1712,
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

/**
 * 판 목록 → position/color/normal 비인덱스 지오메트리 (buildParts 출력과 같은 어트리뷰트)
 *
 * export 인 이유: 맨 셀 바닥 결 레이어(grounddetail.ts)가 이 함수를 그대로 쓴다.
 * 복제하지 않는 것이 중요하다 — 감김 방향(노멀 +Y)과 색 지터 규약이 갈리는 순간
 * 두 레이어가 다른 톤으로 굽히고, 그건 캡처 한 장으로는 잘 안 보인다.
 */
export function buildFlats(flats: readonly FlatSpec[], seed: number, faceJitter = 0.04): THREE.BufferGeometry {
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

/*
 * ── 신규 1층 ①: **수평 실루엣** ───────────────────────────────────────────
 * 개정 전 1층 21종이 **전부 수직**(원뿔·기둥·구·이코사)이었다. 통나무처럼 누운 것이
 * 하나도 없어 판 전체가 "같은 방향으로 선 것들"의 반복이었고, 그게 카메라를 돌려도
 * 그림이 안 바뀌는 이유였다. 눕힌 통나무는 세 가지를 한꺼번에 준다:
 *   (a) 가로 실루엣  (b) 1층 최저 높이 0.30 — 그 위 pineGiant(1.94)와 6배 대비
 *   (c) 잘린 단면 = 사람이 벤 자국이라 원시시대 서사에도 맞는다
 * 세 바이옴이 같은 골격을 색만 갈아 쓰므로(charTree 가 deadTreeUp 을 재사용한 것과
 * 같은 수법) 코드는 한 벌이다.
 */
function lyingLog(bark: number, cut: number, moss: number, capMushroom: boolean): Element {
  const solids: PartSpec[] = [
    // 눕힌 원기둥 — rot z=90° 로 축을 x 로 눕힌다 (scale 은 회전 전 로컬축 기준이다)
    { kind: 'cyl', pos: [0, 0.15, 0], rot: [0, 0, Math.PI / 2], scale: [0.30, 0.92, 0.30], color: bark, seg: 6, hueJitter: 0.02 },
    // 부러진 가지 2개 — 통나무가 "쓰러진 나무"로 읽히려면 잔가지가 남아 있어야 한다
    { kind: 'cone', pos: [0.22, 0.34, 0.16], rot: [0.5, 0, -0.5], scale: [0.09, 0.36, 0.09], color: shade(bark, 1.12), seg: 3 },
    { kind: 'cone', pos: [-0.18, 0.30, -0.14], rot: [-0.4, 0, 0.6], scale: [0.07, 0.28, 0.07], color: shade(bark, 0.9), seg: 3 },
  ];
  if (capMushroom) {
    // 통나무 위 버섯 — 늪·정글 판의 "썩어 가는 것" 서사를 한 번 더 찍는다
    solids.push(
      { kind: 'cone', pos: [0.14, 0.32, -0.09], scale: [0.20, 0.13, 0.20], color: P.glowCap, seg: 3 },
      { kind: 'cone', pos: [-0.06, 0.31, 0.12], scale: [0.15, 0.10, 0.15], color: P.glowCapDeep, seg: 3 },
    );
  }
  return {
    solids,
    flats: [
      // 잘린 단면 2장 — rz=±90° 로 판을 세워 ∓x 를 보게 한다 (FlatSpec 은 오일러 'YXZ')
      { pos: [-0.465, 0.15, 0], rot: [0, 0, Math.PI / 2], scale: [0.30, 0.30], color: cut, sides: 6 },
      { pos: [0.465, 0.15, 0], rot: [0, 0, -Math.PI / 2], scale: [0.29, 0.29], color: shade(cut, 0.88), sides: 6 },
      // 윗면 이끼 — 통나무 등에 얹혀야 "오래 누워 있었다"가 된다
      { pos: [0.10, 0.302, 0.02], scale: [0.42, 0.24], color: moss, sides: 5, hueJitter: 0.04 },
      { pos: [-0.24, 0.302, -0.03], scale: [0.30, 0.20], color: shade(moss, 0.86), sides: 5, hueJitter: 0.04 },
    ],
  };
}

/** 쓰러진 통나무 (초원, 50 tri, 높이 0.30) */
function fallenLog(): Element {
  return lyingLog(C.bark, P.stumpTop, P.mossPatch, false);
}

/** 이끼 통나무 (정글, 62 tri, 높이 0.32) */
function mossyLog(): Element {
  return lyingLog(shade(C.bark, 0.92), P.stumpTop, 0x4f9440, true);
}

/** 썩은 통나무 (늪, 62 tri, 높이 0.32) */
function swampLog(): Element {
  return lyingLog(P.swampBark, P.swampBarkLit, P.mossHang, true);
}

/**
 * 눈 덮인 쓰러진 나무 (설원, 50 tri, 높이 0.30).
 * 설원은 1층 최저가 snowBoulder 0.55 라 여섯 바이옴 중 **유일하게 0.3급이 없었고**,
 * 그래서 눈밭 위 소품이 전부 비슷한 키로 늘어섰다. 검은 줄기 위 흰 이끼(=눈)라
 * 명도 대비도 같이 얻는다.
 */
function snowLog(): Element {
  /*
   * 껍질은 **고사목(0x3c372f)보다 두 단 밝게** 잡는다. 처음엔 같은 검회색을 썼는데
   * 캡처에서 눈밭 위 검은 판자 대여섯 장이 되어, 명도 악센트가 아니라 구멍처럼 보였다.
   * 고사목은 가는 가지라 검정이 실루엣으로 읽히지만, 통나무는 면적이 넓어 같은 색이면
   * 그냥 검은 덩어리가 된다 — 면적이 넓을수록 명도를 올려야 같은 대비가 된다.
   */
  return lyingLog(0x6a6055, 0x8a7d6c, C.snowCap, false);
}

/**
 * 그루터기 — 1층 후보의 **최저 높이**를 0.30 으로 내리는 것이 목적이다 (49 tri).
 * heroScale 만 넓히면 같은 실루엣이 커졌다 작아졌다 할 뿐이라, 원형 단계에서
 * 0.3급을 넣어야 크기 계층이 실제로 생긴다.
 */
function stumpMossy(): Element {
  const solids: PartSpec[] = [
    { kind: 'cyl', pos: [0, 0.14, 0], scale: [0.42, 0.28, 0.40], color: C.bark, seg: 6, hueJitter: 0.02 },
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.22, 0.07, Math.sin(a) * 0.22],
      rot: [Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2],
      scale: [0.13, 0.30, 0.13],
      color: shade(C.bark, 0.82),
      seg: 3,
    });
  }
  return {
    solids,
    flats: [
      { pos: [0, 0.283, 0], scale: [0.40, 0.38], color: P.stumpTop, sides: 6, hueJitter: 0.02 },
      { pos: [0.13, 0.288, 0.08], scale: [0.20, 0.16], color: P.mossPatch, sides: 5, hueJitter: 0.04 },
    ],
  };
}

/*
 * ── 신규 1층 ②: **크기 계층의 꼭대기** ────────────────────────────────────
 * 개정 전 1층 최고 높이는 pineTall 1.70 / broadleaf 1.37 이었고 heroScale 이 ±12%
 * 라 판 위 모든 나무가 1.33~1.70 안에 들어왔다 — 28% 밴드. 그러니 "큰 나무"가
 * 하나도 없고 45번 찍은 같은 도장으로 보였다. 아래 셋은 전부 1.9~2.1 급이다.
 */

/** 큰 소나무 — pineTall 을 5단으로 늘린 확대판 (108 tri, 높이 1.94) */
function pineGiant(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.26, 0], scale: [0.19, 0.52, 0.19], color: C.bark, seg: 5 },
      flare(0, 0.10, 0, 0.36, 0.20, shade(C.bark, 0.78)),
      { kind: 'cone', pos: [0, 0.74, 0], scale: [1.02, 0.66, 1.02], color: P.pineDark, seg: 7, hueJitter: 0.025 },
      { kind: 'cone', pos: [0, 1.08, 0], scale: [0.86, 0.60, 0.86], color: P.pineMid, seg: 7, hueJitter: 0.025 },
      { kind: 'cone', pos: [0, 1.36, 0], scale: [0.68, 0.54, 0.68], color: P.pineLit, seg: 6, hueJitter: 0.02 },
      { kind: 'cone', pos: [0, 1.60, 0], scale: [0.48, 0.44, 0.48], color: P.pineMid, seg: 6, hueJitter: 0.02 },
      { kind: 'cone', pos: [0, 1.78, 0], scale: [0.28, 0.32, 0.28], color: shade(P.pineLit, 1.12), seg: 5 },
      { kind: 'cone', pos: [-0.36, 0.86, 0.12], rot: [0, 0, 0.7], scale: [0.30, 0.34, 0.30], color: P.pineDark, seg: 4 },
      { kind: 'cone', pos: [0.34, 0.98, -0.14], rot: [0, 0, -0.6], scale: [0.26, 0.30, 0.26], color: P.pineDark, seg: 4 },
    ],
  };
}

/**
 * 자작나무 — **흰 줄기** (78 tri, 높이 1.58).
 * 판 위 나무 줄기가 전부 C.bark 갈색 한 톤이라 밑동이 지면에 먹혔다. 밝은 수직선
 * 하나가 초원의 초록 단색을 깨는 가장 싼 방법이다 (검은 옹이가 흰 줄기를 살린다).
 */
function birchSlim(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.36, 0], scale: [0.14, 0.72, 0.14], color: P.birchBark, seg: 4 },
      { kind: 'cyl', pos: [0.03, 0.94, 0.01], rot: [0, 0.6, 0.05], scale: [0.11, 0.48, 0.11], color: P.birchBarkShade, seg: 4 },
      { kind: 'ico', pos: [0.06, 1.24, 0], rot: [0.3, 0.6, 0.2], scale: [0.72, 0.52, 0.68], color: C.leaf, hueJitter: 0.035 },
      { kind: 'ico', pos: [-0.16, 1.42, 0.08], rot: [1.0, 0.2, 0.7], scale: [0.46, 0.36, 0.44], color: P.leafWarm, hueJitter: 0.035 },
    ],
    // 옹이는 **세운 판**이라야 보인다 — rx=90° 로 세우고 ry 로 줄기 둘레 각도를 준다
    flats: [
      { pos: [0.075, 0.52, 0], rot: [Math.PI / 2, Math.PI / 2, 0], scale: [0.10, 0.05], color: P.birchKnot },
      { pos: [-0.075, 0.30, 0], rot: [Math.PI / 2, -Math.PI / 2, 0], scale: [0.12, 0.045], color: P.birchKnot },
      { pos: [0, 0.66, 0.075], rot: [Math.PI / 2, 0, 0], scale: [0.09, 0.04], color: P.birchKnot },
    ],
  };
}

/**
 * 바위 무리 — boulder 는 4덩이 스케일이 0.62/0.38/0.32/0.26 으로 다 비슷해서
 * 뭉친 회색 감자로 보였다. 큰 것 하나 + 확 작은 것 둘로 **대비를 크게** 주면
 * 같은 값에 "바위 무리"가 된다 (76 tri, 높이 0.78).
 */
function rockPile(color: number): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.30, 0], rot: [0.35, 0.7, 0.15], scale: [0.76, 0.64, 0.70], color, hueJitter: 0.016 },
      { kind: 'ico', pos: [0.08, 0.62, -0.06], rot: [1.0, 0.3, 0.8], scale: [0.34, 0.30, 0.32], color: shade(color, 1.16), hueJitter: 0.016 },
      { kind: 'ico', pos: [0.36, 0.10, 0.22], rot: [1.2, 1.1, 0.4], scale: [0.24, 0.20, 0.22], color: shade(color, 0.82), hueJitter: 0.016 },
      { kind: 'cone', pos: [-0.34, 0.12, -0.18], rot: [0.2, 0.5, 0.35], scale: [0.26, 0.24, 0.24], color: shade(color, 0.9), seg: 4 },
      { kind: 'cone', pos: [-0.10, 0.08, 0.36], rot: [0.3, 1.2, -0.25], scale: [0.20, 0.16, 0.19], color, seg: 4 },
    ],
  };
}

/**
 * 버팀뿌리 거목 — 정글 크기 계층의 꼭대기 (112 tri, 높이 2.04).
 * 개정 전 정글 1층 최고가 palmTall 1.55 / jungleTree 1.50 으로 **사실상 같은 키**라
 * 캐노피가 한 층에 나란히 깔렸다. 썸네일은 캐노피가 섬 밖으로 넘칠 만큼 큰 나무가
 * 하나 있고 나머지가 그 밑에 깔린다 — 그 한 그루가 정글을 정글로 만든다.
 * ⚠ 정글은 셀 예산이 가장 빡빡하다. 이걸 넣는 대신 jungleTree 중복 하나를 뺐다.
 */
function buttressTree(): Element {
  const solids: PartSpec[] = [
    { kind: 'cyl', pos: [0, 0.46, 0], scale: [0.24, 0.92, 0.24], color: shade(C.bark, 0.88), seg: 5 },
    { kind: 'cyl', pos: [0.03, 1.16, 0], rot: [0, 0.5, 0.04], scale: [0.18, 0.56, 0.18], color: shade(C.bark, 1.02), seg: 5 },
    { kind: 'ico', pos: [0, 1.58, 0], rot: [0.2, 0.5, 0.1], scale: [1.06, 0.58, 1.00], color: P.jungleCanopy, hueJitter: 0.035 },
    { kind: 'ico', pos: [0.16, 1.80, -0.08], rot: [0.9, 0.3, 0.6], scale: [0.66, 0.46, 0.62], color: P.jungleCanopyLit, hueJitter: 0.035 },
  ];
  // 버팀뿌리 4장 — mangrove 의 뿌리 루프와 같은 코드. 밑동을 넓혀 "거목"의 무게를 만든다
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.7;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.22, 0.22, Math.sin(a) * 0.22],
      rot: [Math.sin(a) * 0.42, 0, -Math.cos(a) * 0.42],
      scale: [0.20, 0.60, 0.20],
      color: shade(C.bark, 0.74),
      seg: 3,
    });
  }
  const flats: FlatSpec[] = [];
  // 늘어진 덩굴 — 캐노피에서 아래로. rx=90° 면 판의 길이축(z)이 -y 로 향한다
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const len = 0.54 + (i % 2) * 0.26;
    flats.push({
      pos: [Math.cos(a) * 0.62, 1.46 - len * 0.5, Math.sin(a) * 0.62],
      rot: [Math.PI / 2, a + Math.PI / 2, 0],
      scale: [0.07, len],
      color: i % 2 ? P.vineGreen : shade(P.vineGreen, 0.82),
      hueJitter: 0.03,
    });
  }
  return { solids, flats };
}

/**
 * 대나무 다발 — **한 요소 안에서 5단 높이 차** (72 tri, 높이 1.85).
 * 정글에 가늘고 곧은 수직선이 하나도 없었다(전부 둥근 캐노피 아니면 별 모양 팜).
 * seg3 이라 대 하나가 12 삼각형뿐이라 크기 계층을 셀 하나 값으로 산다.
 */
function bambooClump(): Element {
  const H = [1.85, 1.55, 1.30, 1.05, 0.80];
  const solids: PartSpec[] = H.map((h, i) => {
    const a = (i / 5) * Math.PI * 2 + 0.5;
    return {
      kind: 'cyl' as const,
      pos: [Math.cos(a) * 0.17, h * 0.5, Math.sin(a) * 0.17] as [number, number, number],
      rot: [Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08] as [number, number, number],
      scale: [0.09, h, 0.09] as [number, number, number],
      color: i % 2 ? P.bamboo : P.bambooDark,
      seg: 3,
      hueJitter: 0.03,
    };
  });
  const flats: FlatSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.9;
    flats.push({
      pos: [Math.cos(a) * 0.30, 1.02 + (i % 3) * 0.26, Math.sin(a) * 0.30],
      rot: [-0.30, Math.PI / 2 - a, 0],
      scale: [0.11, 0.44],
      color: i % 2 ? P.bamboo : P.frondLit,
      hueJitter: 0.03,
    });
  }
  return { solids, flats };
}

/**
 * 사암 아치 — **실루엣 안에 하늘이 보이는** 첫 소품 (104 tri, 높이 1.42).
 * 개정 전 41종이 전부 꽉 찬 덩어리라 판 어디를 봐도 "막힌 것"뿐이었다. 구멍이
 * 하나 뚫리면 그 뒤 지면이 비쳐 판에 숨구멍이 생긴다 — 썸네일 사막에서 눈이 가장
 * 먼저 가는 것도 선인장이 아니라 이 아치다.
 */
function sandArch(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [-0.34, 0.46, 0], rot: [0, 0.3, 0.06], scale: [0.30, 0.92, 0.26], color: P.sandRock, seg: 5, hueJitter: 0.015 },
      { kind: 'cyl', pos: [0.34, 0.42, 0.04], rot: [0, -0.4, -0.08], scale: [0.27, 0.84, 0.24], color: P.sandRockDeep, seg: 5, hueJitter: 0.015 },
      // 상판 2장을 서로 기울여 걸친다 — 가운데서 만나 아치 이마를 만든다
      { kind: 'box', pos: [-0.20, 1.06, 0], rot: [0, 0, 0.42], scale: [0.46, 0.20, 0.30], color: P.sandRockLit },
      { kind: 'box', pos: [0.20, 1.04, 0.02], rot: [0, 0, -0.38], scale: [0.44, 0.19, 0.29], color: P.sandRock },
      // 밑동 마감 — 기둥이 지면에서 그냥 잘리면 세워 둔 파이프로 보인다
      { kind: 'ico', pos: [-0.36, 0.10, 0.02], rot: [0.5, 0.9, 0.2], scale: [0.44, 0.24, 0.40], color: P.sandRockDeep, hueJitter: 0.015 },
      { kind: 'ico', pos: [0.36, 0.09, -0.04], rot: [0.7, 0.3, 0.4], scale: [0.40, 0.22, 0.36], color: P.sandArchShade, hueJitter: 0.015 },
    ],
  };
}

/**
 * 첨탑 바위 — 실제 캡처에서 mesaRock(0.92)이 전부 같은 크기의 둥근 주황 덩어리로
 * 반복돼 감자밭이 됐다. 사막에 **수직 리듬**을 주는 솟은 사암 (72 tri, 높이 1.70).
 */
function rockSpire(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.18, 0], scale: [0.68, 0.36, 0.62], color: P.sandRockDeep, seg: 6, hueJitter: 0.015 },
      { kind: 'cone', pos: [0, 0.64, 0], scale: [0.54, 0.64, 0.52], color: P.sandRock, seg: 5, hueJitter: 0.015 },
      { kind: 'cone', pos: [0.02, 1.08, 0.01], scale: [0.38, 0.56, 0.36], color: P.sandRockLit, seg: 5, hueJitter: 0.015 },
      { kind: 'cone', pos: [0.03, 1.44, 0], scale: [0.23, 0.52, 0.23], color: P.sandRock, seg: 4 },
      { kind: 'ico', pos: [-0.36, 0.18, 0.18], rot: [0.6, 0.5, 0.3], scale: [0.36, 0.32, 0.34], color: P.sandArchShade, hueJitter: 0.015 },
    ],
  };
}

/**
 * 돌탑(케언) — 위로 갈수록 좁아지는 형태가 mesaRock 의 뭉툭함과 정반대라 실루엣이
 * 겹치지 않는다. 길잡이 돌탑은 "사람이 지나갔다"는 신호라 서사에도 맞는다
 * (53 tri, 높이 0.76).
 */
function cairnStack(): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.16, 0], rot: [0.4, 0.8, 0.2], scale: [0.48, 0.32, 0.44], color: P.cairnStone, hueJitter: 0.02 },
      { kind: 'ico', pos: [0.03, 0.42, -0.02], rot: [1.0, 0.4, 0.7], scale: [0.34, 0.24, 0.32], color: shade(P.cairnStone, 0.86), hueJitter: 0.02 },
      { kind: 'cone', pos: [0.01, 0.64, 0], rot: [0, 0.6, 0.05], scale: [0.24, 0.24, 0.23], color: shade(P.cairnStone, 1.1), seg: 5 },
    ],
    flats: [{ pos: [0.22, 0.033, 0.14], scale: [0.42, 0.30], color: P.sandArchShade, sides: 5, hueJitter: 0.02 }],
  };
}

/**
 * 눈 덮인 바위 노두 — 썸네일 설원의 시각 중심은 눈을 뒤집어쓴 **큰** 바위 덩어리다.
 * snowBoulder(0.50)는 흰 지면에 파묻혀 캡처에서 흰 얼룩으로만 보였다.
 * 높이를 2.6배로 올려야 실루엣이 생긴다 (86 tri, 높이 1.28).
 */
function snowRockOutcrop(): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.40, 0], rot: [0.35, 0.7, 0.2], scale: [0.86, 0.86, 0.78], color: P.snowRock, hueJitter: 0.015 },
      { kind: 'ico', pos: [0.34, 0.22, 0.18], rot: [1.1, 0.4, 0.6], scale: [0.52, 0.44, 0.48], color: shade(P.snowRock, 0.86), hueJitter: 0.015 },
      { kind: 'ico', pos: [-0.32, 0.16, -0.14], rot: [0.8, 1.2, 0.3], scale: [0.40, 0.32, 0.38], color: P.snowRockLit, hueJitter: 0.015 },
      // 눈 모자 — 넓고 납작하게 얹어야 "쌓인 눈"이 된다
      { kind: 'ico', pos: [-0.02, 0.76, 0.02], rot: [0.15, 0.5, 0.1], scale: [0.82, 0.30, 0.74], color: C.snowCap },
    ],
    flats: [
      { pos: [0.30, 0.034, 0.24], scale: [0.40, 0.32], color: C.snowCap, sides: 5, hueJitter: 0.01 },
      { pos: [-0.28, 0.034, -0.22], scale: [0.34, 0.28], color: 0xdce9f2, sides: 5, hueJitter: 0.01 },
    ],
  };
}

/**
 * 큰 얼음 첨탑 — 설원 크기 계층의 꼭대기 (61 tri, 높이 1.92).
 * 개정 전 얼음(iceCrystal 1.11)이 소나무(1.57)보다 작아 배경으로 밀렸다. 썸네일은
 * 얼음이 나무보다 크고, 그게 설원을 "얼음 땅"으로 읽히게 하는 유일한 장치다.
 */
function iceSpireTall(): Element {
  const H = [1.92, 1.38, 0.94, 0.60];
  return {
    ao: 0.10, // 얼음은 밑동까지 밝아야 빛난다 (iceCrystal 과 같은 원칙)
    solids: [
      { kind: 'ico', pos: [0, 0.08, 0], rot: [0.3, 0.6, 0.1], scale: [0.60, 0.18, 0.56], color: C.snowCap },
      ...H.map((h, i) => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const off = i === 0 ? 0 : 0.20 + i * 0.05;
        return {
          kind: 'cone' as const,
          pos: [Math.cos(a) * off, h * 0.5, Math.sin(a) * off] as [number, number, number],
          rot: [Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1] as [number, number, number],
          scale: [0.13 + h * 0.08, h, 0.13 + h * 0.08] as [number, number, number],
          color: [C.crystal, C.ice, C.iceDeep, C.crystal][i] ?? C.ice,
          seg: 4,
          hueJitter: 0.02,
        };
      }),
    ],
    flats: [
      { pos: [0.26, 0.033, 0.18], scale: [0.34, 0.26], color: C.ice, sides: 5, hueJitter: 0.02 },
      { pos: [-0.24, 0.033, 0.14], scale: [0.26, 0.20], color: C.iceDeep, sides: 5, hueJitter: 0.02 },
      { pos: [0.06, 0.033, -0.28], scale: [0.22, 0.18], color: C.ice, sides: 5, hueJitter: 0.02 },
    ],
  };
}

/**
 * 눈 덮인 고사목 — 설원 1층이 전부 짙은 초록·청록이라 **어두운 색이 0개**였다.
 * 흰 배경에 검은 가지 실루엣이 들어가면 명도 폭이 단번에 두 배가 된다.
 * charTree 가 deadTreeUp 을 색만 갈아 재사용한 것과 같은 수법 (82 tri, 높이 1.38).
 */
function snowDeadTree(): Element {
  const el = deadTreeUp();
  const solids = (el.solids ?? []).map((p, i) => ({ ...p, color: i % 2 ? P.deadWood : P.deadWoodLit }));
  return {
    solids,
    // 가지에 얹힌 눈 — 검은 골격만 두면 죽은 나무가 아니라 그을린 나무로 읽힌다
    flats: [
      { pos: [0.20, 1.06, 0.08], scale: [0.28, 0.16], color: C.snowCap, hueJitter: 0.01 },
      { pos: [-0.22, 0.94, -0.10], scale: [0.24, 0.14], color: 0xdce9f2, hueJitter: 0.01 },
      { pos: [0.04, 1.26, -0.06], scale: [0.20, 0.12], color: C.snowCap, hueJitter: 0.01 },
    ],
  };
}

/**
 * 거대 발광 버섯 — 썸네일 늪의 **주인공**이다 (82 tri, 높이 1.50).
 * 개정 전 glowMushroom(0.64)은 reeds(0.58)와 키가 같아 사실상 2층으로 내려앉았고,
 * 실제 캡처에서 청록 점으로만 보였다. 2.3배로 키워야 판의 광원이자 랜드마크가 된다.
 */
function giantGlowCap(): Element {
  const flats: FlatSpec[] = [];
  // 갓 아래 주름 — 세운 판 4장. 아래에서 올려다보는 각이 아니라도 갓 테두리를 두껍게 만든다
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    flats.push({
      pos: [Math.cos(a) * 0.40, 1.02, Math.sin(a) * 0.40],
      rot: [Math.PI / 2, a + Math.PI / 2, 0],
      scale: [0.30, 0.18],
      color: P.glowCapDeep,
      sides: 6,
      hueJitter: 0.03,
    });
  }
  // 포자 점 — 갓 위에 흩어진 밝은 점
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 1.2;
    flats.push({
      pos: [Math.cos(a) * 0.30, 1.34 + (i % 2) * 0.03, Math.sin(a) * 0.30],
      scale: [0.14, 0.13],
      color: P.glowStem,
      hueJitter: 0.02,
    });
  }
  return {
    ao: 0.06, // 발광체는 밑동이 어두우면 안 빛난다
    solids: [
      { kind: 'cyl', pos: [0, 0.52, 0], rot: [0, 0, 0.04], scale: [0.24, 1.04, 0.24], color: P.glowStem, seg: 6 },
      { kind: 'ico', pos: [0, 1.20, 0], rot: [0.1, 0.5, 0.05], scale: [1.00, 0.56, 0.96], color: P.glowCap, hueJitter: 0.03 },
      // 뒤집힌 원뿔 = 갓 테두리. 갓이 구 하나면 위에서 봤을 때 그냥 초록 공이다
      { kind: 'cone', pos: [0, 1.14, 0], rot: [Math.PI, 0, 0], scale: [0.94, 0.30, 0.90], color: P.glowCapDeep, seg: 7, hueJitter: 0.03 },
    ],
    flats,
  };
}

/**
 * 뿌리 아치 — sandArch 와 함께 **실루엣 안에 하늘이 보이는** 두 번째 소품
 * (72 tri, 높이 0.92). 썸네일 늪은 절벽에서 뿌리가 뻗어 나와 구멍 난 그림을 만든다.
 */
function rootArch(): Element {
  const solids: PartSpec[] = [
    { kind: 'ico', pos: [0, 0.14, 0], rot: [0.5, 0.7, 0.2], scale: [0.52, 0.28, 0.48], color: shade(P.swampBark, 0.8), hueJitter: 0.02 },
  ];
  // 굽은 뿌리 3개 — 각도를 달리해 서로 걸치면 아래에 구멍이 남는다
  const ARC: [number, number, number][] = [
    // [방위각, 기울기, 길이]
    [0.4, 1.05, 0.92],
    [2.5, 0.90, 0.78],
    [4.4, 1.15, 0.70],
  ];
  for (const [a, lean, len] of ARC) {
    solids.push({
      kind: 'cyl',
      pos: [Math.cos(a) * len * 0.22, len * 0.40, Math.sin(a) * len * 0.22],
      rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
      scale: [0.15, len, 0.15],
      color: P.swampBarkLit,
      seg: 4,
      hueJitter: 0.02,
    });
  }
  return {
    solids,
    flats: [{ pos: [0.08, 0.033, 0.10], scale: [0.56, 0.44], color: P.mossHang, sides: 6, hueJitter: 0.04 }],
  };
}

/**
 * 계단식 현무암 — 실제 캡처에서 basaltColumn 이 굵기(0.34/0.27/0.23)·높이가 비슷해
 * 똑같은 검은 말뚝 40개로 보였다. 썸네일 화산은 각진 암반이 **계단처럼 층지고**
 * 단마다 지름이 줄어든다 — 그 형태가 인상을 직접 만든다 (88 tri, 높이 1.46).
 */
function basaltStack(): Element {
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.24, 0], rot: [0, 0.0, 0], scale: [0.78, 0.48, 0.74], color: P.basaltDeep, seg: 6, hueJitter: 0.015 },
      { kind: 'cyl', pos: [0.04, 0.66, -0.03], rot: [0, 0.5, 0.02], scale: [0.62, 0.40, 0.58], color: P.basalt, seg: 5, hueJitter: 0.015 },
      { kind: 'cyl', pos: [-0.02, 1.02, 0.04], rot: [0, 1.0, -0.03], scale: [0.46, 0.34, 0.44], color: P.basaltLit, seg: 5, hueJitter: 0.015 },
      { kind: 'cyl', pos: [0.03, 1.32, 0], rot: [0, 0.3, 0.04], scale: [0.31, 0.28, 0.30], color: P.basalt, seg: 4, hueJitter: 0.015 },
    ],
    flats: [
      { pos: [0.03, 1.462, 0], scale: [0.30, 0.28], color: P.basaltLit, sides: 6, hueJitter: 0.02 },
      { pos: [0.30, 0.034, 0.22], rot: [0, 0.7, 0], scale: [0.10, 0.40], color: P.lavaDeep, sides: 4 },
      { pos: [-0.26, 0.034, -0.20], rot: [0, -0.5, 0], scale: [0.08, 0.32], color: P.lavaHot, sides: 4 },
    ],
  };
}

/**
 * 분기공 — 썸네일 화산 인상의 절반이 **흰 연기 기둥**이다 (76 tri, 높이 1.22).
 * 지금 판에 밝은 색이 용암 주황뿐이라 검정 위 주황 2색으로 눈이 쉴 데가 없었다.
 * 연기 판은 4 삼각형씩이라 세 번째 명도를 아주 싸게 산다.
 */
function fumarole(): Element {
  /*
   * ⚠ 연기를 **판으로 만들면 안 된다.** 처음엔 3층과 같은 수법(수평 6각 판을 층층이
   * 띄우기)으로 짰는데, 캡처에서 굴뚝 위에 **흰 종이접시 4장이 떠 있는** 그림이 됐다.
   * 판은 지면에 붙어 있을 때만 두께 없는 게 자연스럽고, 공중에 뜨면 두께가 없다는
   * 사실이 그대로 드러난다. 그래서 연기만 이코사 3덩이로 굽는다(60 삼각형).
   * 화산은 셀 실측이 6개 중 가장 낮아 이 값을 쓸 여유가 있다.
   */
  return {
    solids: [
      { kind: 'cyl', pos: [0, 0.36, 0], rot: [0, 0.4, 0.03], scale: [0.40, 0.72, 0.38], color: P.basaltDeep, seg: 6, hueJitter: 0.015 },
      { kind: 'cone', pos: [0, 0.78, 0], rot: [Math.PI, 0, 0], scale: [0.44, 0.20, 0.42], color: P.basalt, seg: 6 },
      { kind: 'ico', pos: [0.38, 0.12, 0.20], rot: [0.7, 0.5, 0.3], scale: [0.36, 0.26, 0.34], color: P.basaltLit, hueJitter: 0.02 },
      // 연기 3덩이 — 위로 갈수록 크고 밝게, 옆으로 조금씩 밀려 기울어진 기둥이 된다
      { kind: 'ico', pos: [0.03, 0.98, -0.02], rot: [0.4, 0.6, 0.2], scale: [0.34, 0.30, 0.32], color: P.smokeGray, hueJitter: 0.012 },
      { kind: 'ico', pos: [0.11, 1.20, -0.08], rot: [1.0, 0.2, 0.7], scale: [0.46, 0.38, 0.44], color: shade(P.smokeGray, 1.08), hueJitter: 0.012 },
      { kind: 'ico', pos: [0.22, 1.44, -0.16], rot: [0.6, 1.2, 0.3], scale: [0.56, 0.44, 0.52], color: P.smokePale, hueJitter: 0.012 },
    ],
    flats: [
      { pos: [0.30, 0.034, -0.26], rot: [0, 0.9, 0], scale: [0.11, 0.36], color: P.lavaHot, sides: 4 },
      { pos: [-0.28, 0.034, 0.24], rot: [0, -0.6, 0], scale: [0.09, 0.30], color: P.lavaDeep, sides: 4 },
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

/*
 * ── 신규 2층 ─────────────────────────────────────────────────────────────
 * 2층의 병은 "종류가 적다"가 아니라 **높이가 다 같다**였다. 개정 전 2층 12종의
 * 높이가 0.24~0.62 안에 전부 들어가, 3층(0.14~0.36)과 1층(1.3~1.7) 사이의
 * 0.6~1.0 구간이 통째로 비어 있었다. 그 구간이 비면 1층 밑동이 지면에서 떠 보인다.
 * 아래 신규 2층은 절반이 0.55~0.95 급이다.
 */

/** 키 큰 풀 다발 — grassTuft(0.36)와 bushRound(0.50) 사이를 메운다 (24 tri, 높이 0.74) */
function grassClumpTall(color: number): Element {
  const solids: PartSpec[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.55;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.09, 0.34, Math.sin(a) * 0.09],
      rot: [Math.sin(a) * 0.30, 0, -Math.cos(a) * 0.30],
      scale: [0.11, 0.72, 0.11],
      // 같은 다발 안에서 명도 2단 — 단색 원뿔 4개는 초록 부채로 뭉친다
      color: i % 2 ? color : shade(color, 0.84),
      seg: 3,
      hueJitter: 0.04,
    });
  }
  return { solids, ao: 0.12 };
}

/**
 * 덩굴 커튼 — 썸네일 정글의 시그니처(위에서 늘어진 초록 줄)가 판에 0개였다.
 * 14 삼각형에 정글 정체성을 사는 가장 싼 거래다 (높이 0.92).
 */
function vineCurtain(): Element {
  const flats: FlatSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const len = 0.42 + ((i * 7) % 5) * 0.10;
    const x = (i - 2) * 0.11;
    flats.push({
      // rx=90° 면 판의 길이축(로컬 z)이 -y 를 향한다 → 위에서 아래로 늘어진다
      pos: [x, 0.92 - len * 0.5, (i % 2) * 0.06 - 0.03],
      rot: [Math.PI / 2, 0.1 * i, 0],
      scale: [0.055, len],
      color: i % 2 ? P.vineGreen : shade(P.vineGreen, 0.82),
      hueJitter: 0.03,
    });
  }
  flats.push(
    { pos: [0.14, 0.50, 0.05], rot: [-0.4, 0.8, 0], scale: [0.16, 0.26], color: P.frondLit, hueJitter: 0.03 },
    { pos: [-0.16, 0.62, -0.04], rot: [-0.4, -1.1, 0], scale: [0.14, 0.24], color: P.frond, hueJitter: 0.03 },
  );
  return { flats, ao: 0.10 };
}

/**
 * 넓은 잎 식물(토란) — fernBush 는 폭 0.22 의 가늘고 뾰족한 잎뿐이라 판 위 잎이
 * 전부 같은 크기로 읽혔다. 폭 0.6급 잎이 **잎 자체의 크기 계층**을 만든다
 * (18 tri, 높이 0.58).
 */
function elephantEar(): Element {
  return {
    ao: 0.12,
    solids: [{ kind: 'cone', pos: [0, 0.16, 0], scale: [0.09, 0.32, 0.09], color: P.frondDark, seg: 3 }],
    flats: [
      { pos: [0.16, 0.50, 0.04], rot: [-0.55, 0.4, 0], scale: [0.58, 0.52], color: P.frond, sides: 6, hueJitter: 0.035 },
      { pos: [-0.18, 0.42, -0.08], rot: [-0.45, 2.3, 0], scale: [0.50, 0.46], color: P.frondLit, sides: 6, hueJitter: 0.035 },
      { pos: [0.02, 0.30, -0.22], rot: [-0.35, 4.1, 0], scale: [0.42, 0.38], color: P.frondDark, sides: 6, hueJitter: 0.035 },
    ],
  };
}

/**
 * 정글 암석 노두 — 정글이 초록 한 톤이라 눈이 밀도를 못 읽었다. 회색 하나가 명도를
 * 끊어 주면 그 주변 초록이 오히려 더 무성해 보인다 — **대비가 밀도를 만든다**
 * (26 tri, 높이 0.36).
 */
function jungleOutcrop(): Element {
  return {
    solids: [{ kind: 'ico', pos: [0, 0.14, 0], rot: [0.5, 0.9, 0.25], scale: [0.52, 0.34, 0.46], color: P.jungleRock, hueJitter: 0.02 }],
    flats: [
      { pos: [0.10, 0.30, 0.05], scale: [0.30, 0.24], color: 0x4f9440, sides: 5, hueJitter: 0.04 },
      { pos: [-0.14, 0.24, -0.10], scale: [0.22, 0.18], color: P.jungleRockLit, sides: 5, hueJitter: 0.02 },
    ],
  };
}

/**
 * 오코티요 — dryShrub 와 **코드가 같고 상수 둘만 다르다**(길이 0.34 → 0.92,
 * 벌어짐 0.55 → 0.22). 지면에 먹히던 마른 덤불이 키 큰 회초리가 된다.
 * 가장 싼 변주 (30 tri, 높이 0.94).
 */
function ocotillo(color: number): Element {
  const solids: PartSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.09, 0.44, Math.sin(a) * 0.09],
      rot: [Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22],
      scale: [0.08, 0.92, 0.08],
      color: i % 2 ? color : shade(color, 0.86),
      seg: 3,
      hueJitter: 0.03,
    });
  }
  return { solids, ao: 0.12 };
}

/**
 * 단독 두개골 — boneFossil 은 134 삼각형이라 1층 슬롯을 통째로 먹어 자주 못 뿌린다.
 * 32 짜리면 "메마름"이라는 사막 서사를 판 전역에 반복할 수 있다 (높이 0.26).
 */
function skullAlone(): Element {
  return {
    solids: [
      { kind: 'ico', pos: [0, 0.14, 0], rot: [0.25, 0.5, 0.1], scale: [0.34, 0.28, 0.30], color: C.bone },
      { kind: 'box', pos: [-0.21, 0.10, 0.01], rot: [0, 0.1, 0.14], scale: [0.24, 0.13, 0.15], color: C.boneDark },
    ],
  };
}

/**
 * 모래 두덕 — 사막 지면이 완전 평면이라 소품 없는 곳이 종이처럼 보였다.
 * 낮고 **비대칭으로** 눌린 볼륨이 태양광에 명암 띠를 만들면 평면이 지형으로 읽힌다
 * (14 tri, 높이 0.26).
 */
function duneMound(): Element {
  return {
    solids: [{ kind: 'cone', pos: [0, 0.11, 0], rot: [0, 0.6, 0.06], scale: [0.72, 0.26, 0.52], color: P.sandRipple, seg: 5, hueJitter: 0.02 }],
    flats: [{ pos: [0.16, 0.033, -0.12], rot: [0, 0.6, 0], scale: [0.52, 0.30], color: shade(P.sandRipple, 0.92), sides: 6, hueJitter: 0.02 }],
  };
}

/**
 * 고드름 — 판 위 41종이 **전부 위로 뾰족했다**. 아래로 향한 형태 하나가 방향성
 * 대비를 만든다 (18 tri, 높이 0.46). flare 와 같이 rot[π,0,0] 으로 원뿔을 뒤집는다.
 */
function icicleCluster(): Element {
  const L = [0.46, 0.34, 0.24];
  return {
    ao: 0.06,
    solids: L.map((h, i) => {
      const a = (i / 3) * Math.PI * 2 + 0.8;
      return {
        kind: 'cone' as const,
        pos: [Math.cos(a) * 0.10, h * 0.5, Math.sin(a) * 0.10] as [number, number, number],
        rot: [Math.PI, 0, 0] as [number, number, number],
        scale: [0.12, h, 0.12] as [number, number, number],
        color: i % 2 ? C.ice : C.crystal,
        seg: 3,
        hueJitter: 0.02,
      };
    }),
  };
}

/**
 * 바람에 밀린 눈 능선 — snowMound 는 대칭 ico 라 어디서 봐도 같은 흰 혹이다.
 * **한쪽이 긴** 비대칭이면 방향이 생겨, 여러 개가 같은 방향으로 깔렸을 때
 * "바람이 분 자리"로 읽힌다 (16 tri, 높이 0.32).
 */
function snowDrift(): Element {
  return {
    solids: [
      { kind: 'cone', pos: [0, 0.14, 0], rot: [0, 0.5, 0.10], scale: [0.62, 0.32, 0.38], color: C.snowCap, seg: 5, hueJitter: 0.008 },
      { kind: 'cone', pos: [0.28, 0.06, 0.16], rot: [0, 0.5, 0.45], scale: [0.30, 0.24, 0.22], color: 0xdce9f2, seg: 3 },
    ],
  };
}

/**
 * 마른 갈대 — 설원에 갈색이 **0개**였다. 눈 위로 삐죽 나온 마른 풀이 흰 면을 끊고
 * "눈 밑에 땅이 있다"는 정보를 준다 (18 tri, 높이 0.56).
 */
function snowReeds(): Element {
  const solids: PartSpec[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.9;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.07, 0.27, Math.sin(a) * 0.07],
      rot: [Math.sin(a) * 0.26, 0, -Math.cos(a) * 0.26],
      scale: [0.07, 0.56, 0.07],
      color: i === 1 ? shade(P.dryReed, 1.14) : P.dryReed,
      seg: 3,
      hueJitter: 0.03,
    });
  }
  return { solids, ao: 0.10 };
}

/**
 * 사이프러스 무릎뿌리 — reeds 와 **코드 구조가 같고 굵기·색·높이만 다르다**.
 * 늪 2층이 갈대·버섯·고사리 셋뿐이라 갈색 볼륨이 없었다 (30 tri, 높이 0.56).
 */
function cypressKnees(): Element {
  const H = [0.56, 0.43, 0.34, 0.27, 0.20];
  return {
    solids: H.map((h, i) => {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      return {
        kind: 'cone' as const,
        pos: [Math.cos(a) * 0.16, h * 0.5, Math.sin(a) * 0.16] as [number, number, number],
        rot: [Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14] as [number, number, number],
        scale: [0.15, h, 0.15] as [number, number, number],
        color: i % 2 ? P.swampBark : P.swampBarkLit,
        seg: 3,
        hueJitter: 0.025,
      };
    }),
    ao: 0.14,
  };
}

/**
 * 부들 — reeds 는 끝이 뾰족해 갈대밭이 전부 같은 삼각으로 읽힌다. 끝이 **뭉툭한**
 * 이삭 하나가 붙으면 같은 갈대밭 안에서 형태가 갈라진다 (32 tri, 높이 0.72).
 */
function cattail(): Element {
  return {
    ao: 0.12,
    solids: [
      { kind: 'cone', pos: [0.06, 0.30, 0.02], rot: [0, 0, -0.08], scale: [0.05, 0.60, 0.05], color: P.reed, seg: 3 },
      { kind: 'cone', pos: [-0.09, 0.25, -0.05], rot: [0, 0, 0.12], scale: [0.045, 0.50, 0.045], color: shade(P.reed, 0.86), seg: 3 },
      // 이삭 — 원뿔을 뒤집어 얹으면 끝이 뭉툭해진다
      { kind: 'cyl', pos: [0.08, 0.64, 0.02], scale: [0.10, 0.18, 0.10], color: P.cattailHead, seg: 4 },
      { kind: 'cyl', pos: [-0.11, 0.54, -0.05], scale: [0.085, 0.15, 0.085], color: shade(P.cattailHead, 1.14), seg: 4 },
    ],
    flats: [
      { pos: [0.20, 0.22, 0.10], rot: [-0.9, 0.6, 0], scale: [0.09, 0.44], color: P.reed, hueJitter: 0.03 },
      { pos: [-0.20, 0.20, 0.12], rot: [-0.9, -1.2, 0], scale: [0.08, 0.38], color: shade(P.reed, 0.88), hueJitter: 0.03 },
    ],
  };
}

/**
 * 화산탄 — 화산 1·2층 9종이 전부 각기둥 아니면 가시라 실루엣이 뾰족한 것뿐이었다.
 * **둥근 것 하나**가 들어가면 각진 것들이 오히려 더 각져 보인다 (26 tri, 높이 0.40).
 */
function volcanicBomb(): Element {
  return {
    solids: [{ kind: 'ico', pos: [0, 0.19, 0], rot: [0.5, 0.4, 0.7], scale: [0.40, 0.38, 0.39], color: P.obsidian, hueJitter: 0.02 }],
    flats: [
      { pos: [0.09, 0.36, 0.04], rot: [0, 0.5, 0], scale: [0.05, 0.20], color: P.lavaHot, hueJitter: 0.03 },
      { pos: [-0.11, 0.32, -0.06], rot: [0, 1.4, 0], scale: [0.04, 0.16], color: P.lavaDeep },
      { pos: [0.02, 0.30, 0.15], rot: [0, -0.7, 0], scale: [0.035, 0.13], color: P.lavaCore },
    ],
  };
}

/**
 * 재 원뿔 — 화산 2층이 emberRock·basaltShard 를 두 번씩 넣은 **실질 2종**이었다.
 * 13 삼각형짜리 재 더미면 밀도를 거의 공짜로 올리면서 회색 중간 명도도 채운다
 * (높이 0.34).
 */
function ashCone(): Element {
  return {
    solids: [{ kind: 'cone', pos: [0, 0.15, 0], rot: [0, 0.4, 0.05], scale: [0.46, 0.34, 0.42], color: P.ash, seg: 5, hueJitter: 0.02 }],
    flats: [{ pos: [0.06, 0.033, 0.04], scale: [0.52, 0.44], color: shade(P.ash, 0.82), sides: 5, hueJitter: 0.02 }],
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

/*
 * ── 신규 3층 ─────────────────────────────────────────────────────────────
 * 3층은 **판이 압도적으로 싸다**(n각형 = n-2 삼각형). 그래서 여기서는 삼각형을
 * 아끼는 것보다 "게임 카메라 거리에서 실제로 식별되느냐"가 유일한 기준이다.
 * 개정 전 캡처에서 3층이 한 개도 식별되지 않은 바이옴이 둘 있었다:
 *   · 설원 — 지피 4종이 전부 흰~연회색 판이라 흰 지면 위에서 사라진다
 *   · 늪  — 지피 4종이 전부 어두운 초록/회색이라 판 전체가 뭉갠 그림자로 보인다
 * 그래서 신규 3층은 **지면과 색상이 다른 것**을 우선했다 (얼음 파랑 / 진흙 갈색 /
 * 유황 노랑). 같은 색 계열을 더 넣는 것은 밀도가 아니라 노이즈다.
 */

/** 야생화 군락 — flowerPatch 보다 꽃 수·색 수를 늘린 판 (14 tri) */
function wildflowerBunch(leaf: number): Element {
  return {
    ao: 0,
    flats: [
      { pos: [0.02, 0.036, 0.01], scale: [0.44, 0.38], color: leaf, sides: 5, hueJitter: 0.04 },
      { pos: [-0.14, 0.036, -0.11], scale: [0.30, 0.26], color: shade(leaf, 0.86), sides: 5, hueJitter: 0.04 },
      // 꽃 4송이 3색 — flowerPatch(3송이 2색)는 게임 거리에서 점 하나로 뭉쳤다
      { pos: [0.11, 0.053, 0.05], scale: [0.11, 0.11], color: P.flowerWhite, hueJitter: 0.02 },
      { pos: [-0.09, 0.053, 0.11], scale: [0.10, 0.10], color: P.flowerYellow, hueJitter: 0.02 },
      { pos: [0.03, 0.053, -0.13], scale: [0.095, 0.095], color: P.flowerPink, hueJitter: 0.02 },
      { pos: [-0.16, 0.053, -0.02], scale: [0.085, 0.085], color: P.flowerWhite, hueJitter: 0.02 },
    ],
  };
}

/**
 * 흙두덕 — 초원 지피가 초록·초록·회색뿐이라 갈색 악센트가 없었다. 길(tan)과
 * 잔디(green) 사이 중간색을 판에 뿌려 주는 역할도 한다 (11 tri, 높이 0.11).
 */
function dirtMound(): Element {
  return {
    solids: [{ kind: 'cone', pos: [0, 0.05, 0], rot: [0, 0.5, 0], scale: [0.34, 0.14, 0.30], color: P.soil, seg: 4, hueJitter: 0.03 }],
    flats: [{ pos: [0.05, 0.033, 0.03], scale: [0.44, 0.36], color: P.soilLit, sides: 5, hueJitter: 0.03 }],
  };
}

/** 브로멜리아드 — 썸네일 정글에 흩어진 **빨간 점**이 화면을 살린다 (11 tri) */
function bromeliad(): Element {
  return {
    ao: 0,
    flats: [
      { pos: [0, 0.036, 0], scale: [0.32, 0.28], color: P.frondDark, sides: 6, hueJitter: 0.04 },
      { pos: [-0.10, 0.038, -0.08], scale: [0.22, 0.19], color: P.frond, sides: 5, hueJitter: 0.04 },
      { pos: [0.02, 0.054, 0.01], scale: [0.12, 0.12], color: P.flowerRed, hueJitter: 0.02 },
      { pos: [-0.07, 0.054, 0.06], scale: [0.085, 0.085], color: shade(P.flowerRed, 1.2), hueJitter: 0.02 },
    ],
  };
}

/**
 * 모래 물결 — crackLines 는 균열용이라 세 가닥이 **갈라진다**. 바람이 만든 결은
 * 평행해야 결로 읽힌다 — 그래서 각도를 공유하고 위치만 어긋나게 둔다 (9 tri).
 */
function sandRipple(): Element {
  const a = 0.42;
  const line = (off: number, len: number, w: number, col: number): FlatSpec => ({
    pos: [Math.cos(a) * off, 0.033, -Math.sin(a) * off],
    rot: [0, a, 0],
    scale: [w, len],
    color: col,
    sides: 4,
    hueJitter: 0.02,
  });
  return {
    ao: 0,
    flats: [
      { pos: [0, 0.032, 0], rot: [0, a, 0], scale: [0.50, 0.44], color: shade(P.sandRipple, 0.94), sides: 5, hueJitter: 0.02 },
      line(0.0, 0.56, 0.055, P.sandRipple),
      line(0.17, 0.46, 0.045, shade(P.sandRipple, 0.9)),
      line(-0.16, 0.42, 0.04, P.sandRipple),
    ],
  };
}

/**
 * 얼어붙은 연못 — 설원 3층에서 **유일하게 흰 지면과 대비되는 것**이다.
 * lavaSeam 의 2겹 수법(어두운 테 + 밝은 심)을 그대로 가져왔다 (11 tri).
 */
function frozenPond(): Element {
  return {
    ao: 0,
    flats: [
      { pos: [0, 0.032, 0], scale: [0.62, 0.54], color: C.iceDeep, sides: 7, hueJitter: 0.02 },
      { pos: [0.03, 0.036, 0.02], scale: [0.42, 0.36], color: C.ice, sides: 6, hueJitter: 0.02 },
      { pos: [-0.06, 0.040, 0.05], rot: [0, 0.8, 0], scale: [0.04, 0.34], color: C.snowCap, sides: 4 },
    ],
  };
}

/**
 * 넓은 물웅덩이 — groundPatch(P.puddle)는 5각 단색 3삼각형이라 웅덩이가 아니라
 * 색 얼룩이었다. 어두운 테 + 밝은 심 2겹이면 같은 값에 물이 고인 것으로 읽힌다
 * (lavaSeam 주석이 정확히 같은 병을 이미 진단해 뒀다) (9 tri).
 */
function puddleWide(): Element {
  return {
    ao: 0,
    flats: [
      { pos: [0, 0.032, 0], scale: [0.66, 0.56], color: P.puddle, sides: 7, hueJitter: 0.03 },
      { pos: [0.04, 0.036, -0.03], scale: [0.40, 0.34], color: P.puddleLit, sides: 6, hueJitter: 0.03 },
    ],
  };
}

/**
 * 부글거리는 진흙 — 늪 지피 4종이 전부 어두운 초록/회색이라 판 전체가 뭉갠
 * 그림자로 보였다. 갈색 진흙 + 밝은 기포가 유일하게 명도를 올려 준다 (13 tri).
 */
function bubblingMud(): Element {
  return {
    ao: 0,
    flats: [
      { pos: [0, 0.032, 0], scale: [0.58, 0.50], color: P.mud, sides: 7, hueJitter: 0.03 },
      { pos: [0.10, 0.037, 0.06], scale: [0.20, 0.18], color: P.mudBubble, sides: 5, hueJitter: 0.03 },
      { pos: [-0.12, 0.037, -0.05], scale: [0.15, 0.14], color: shade(P.mudBubble, 1.12), sides: 5, hueJitter: 0.03 },
      { pos: [0.02, 0.040, -0.14], scale: [0.09, 0.09], color: P.mudBubble },
    ],
  };
}

/**
 * 용암 줄기 — lavaSeam 은 폭 0.17 막대 두 쌍이라 캡처에서 여전히 바닥에 흩뿌린
 * **주황 성냥개비**로 보였다. 같은 처방(어두운 탄 자국을 넓게, 심을 좁게)을
 * 폭 3배로 제대로 적용한 버전이다 (14 tri).
 */
function lavaFlow(): Element {
  return {
    ao: 0,
    flats: [
      { pos: [0.02, 0.032, 0.04], rot: [0, 0.5, 0], scale: [0.50, 0.62], color: P.lavaCrust, sides: 6, hueJitter: 0.02 },
      { pos: [-0.16, 0.032, -0.22], rot: [0, 0.9, 0], scale: [0.38, 0.46], color: shade(P.lavaCrust, 1.3), sides: 6, hueJitter: 0.02 },
      { pos: [0.02, 0.038, 0.04], rot: [0, 0.5, 0], scale: [0.14, 0.50], color: P.lavaHot, sides: 4, hueJitter: 0.03 },
      { pos: [-0.14, 0.038, -0.20], rot: [0, 0.9, 0], scale: [0.10, 0.36], color: P.lavaCore, sides: 4, hueJitter: 0.03 },
      { pos: [-0.06, 0.040, -0.08], rot: [0, 0.7, 0], scale: [0.07, 0.22], color: P.lavaCore, sides: 4 },
    ],
  };
}

/**
 * 유황 결정 — 화산 판이 검정+주황 2색뿐이라 색상환에서 두 점만 쓰고 있었다.
 * 유황 노랑-연두는 용암 주황과 **이웃이면서 명도가 훨씬 높아**, 검은 지면을
 * 깨면서도 색이 튀지 않는다 (10 tri).
 */
function sulfurCrust(): Element {
  return {
    ao: 0,
    flats: [
      { pos: [0, 0.032, 0], scale: [0.52, 0.44], color: P.sulfur, sides: 6, hueJitter: 0.03 },
      { pos: [0.13, 0.036, 0.08], scale: [0.26, 0.22], color: P.sulfurLit, sides: 5, hueJitter: 0.03 },
      { pos: [-0.14, 0.036, -0.06], scale: [0.20, 0.17], color: shade(P.sulfur, 0.84), sides: 5, hueJitter: 0.03 },
    ],
  };
}

/**
 * 탄 마른 풀 — 화산 지피 4종이 전부 판이라 **두께가 있는 것이 0개**였다.
 * 작아도 입체가 하나 있어야 지면이 평면으로 안 보인다 (12 tri, 높이 0.30).
 */
function charGrass(): Element {
  const solids: PartSpec[] = [];
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI + 0.6;
    solids.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.07, 0.14, Math.sin(a) * 0.07],
      rot: [Math.sin(a) * 0.44, 0, -Math.cos(a) * 0.44],
      scale: [0.09, 0.30, 0.09],
      color: i ? P.charGrassCol : shade(P.charGrassCol, 1.2),
      seg: 3,
      hueJitter: 0.04,
    });
  }
  return { solids, ao: 0.10 };
}

// --- 바이옴 편성 -----------------------------------------------------------

export interface BiomeKit {
  /** 1층 후보 (배열에 여러 번 넣으면 그만큼 자주 나온다) */
  hero: Element[];
  /**
   * 1층 크기 배율 **봉투** [최소, 최대].
   * 이 구간에서 균등하게 뽑지 않는다 — HERO_TIERS 가 세 계층으로 나눠 뽑는다.
   */
  heroScale: [number, number];
  /**
   * 1층 **부 소품** 후보 — 밑동 옆(반경 0.26~0.40)에 0.42~0.62배로 붙는 작은 것.
   * 개정 전에는 셀당 1층이 **1개 고정**이라 "큰 나무 옆에 작은 나무"가 구조적으로
   * 불가능했고, 그래서 판 위 나무가 전부 등거리로 흩어진 점무늬로 보였다.
   * 값이 비싸므로 셀 삼각형 예산이 남을 때만 놓인다(아래 CELL_SOFT_BUDGET).
   */
  companion: Element[];
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
 * 1층 **크기 계층** — heroScale 봉투를 세 구간으로 자르고 가중치로 뽑는다.
 *
 * 개정 전에는 `rng.range(heroScale[0], heroScale[1])` 균등 분포였고, 봉투 자체가
 * ±12%(초원 0.78~1.0)라 판 위 모든 나무가 1.33~1.70 안에 들어왔다 — 28% 밴드.
 * 그게 "같은 도장을 45번 찍은" 그림의 정체다.
 *
 * 봉투를 [0.58, 1.18] 급으로 넓히는 것만으로는 부족하다. **균등 분포는 계층을
 * 만들지 않는다** — 0.58부터 1.18까지 고르게 흩으면 눈에는 그냥 "크기가 제각각인
 * 연속체"로 보이고, 어느 것도 "큰 것"으로 읽히지 않는다. 크기가 계층으로 읽히려면
 * 구간 **사이에 빈 틈**이 있어야 한다. 그래서 t(정규화 위치)를 0.18~0.38 과
 * 0.62~0.82 두 곳에서 끊었다:
 *   작은 것 t∈[0.00,0.18] 26%  ·  보통 t∈[0.38,0.62] 46%  ·  큰 것 t∈[0.82,1.00] 28%
 * 가중치는 "보통이 절반, 나머지를 큰 것/작은 것이 비슷하게" — 큰 것이 이보다 잦으면
 * 판이 나무로 꽉 차 적 이동이 안 보이고, 작은 것이 잦으면 다시 허전해진다.
 *
 * ⚠ 스케일만으로는 계층이 절반만 산다. 같은 실루엣이 커졌다 작아졌다 할 뿐이기
 * 때문이다. 그래서 hero **원형** 목록에도 2.0급(pineGiant/buttressTree/iceSpireTall/
 * rockSpire)과 0.3급(그루터기·통나무)을 같이 넣었다. 둘을 곱해야 실제 높이 폭이
 * 0.17~2.29(13배)가 된다 — 개정 전은 1.33~1.70(1.3배)였다.
 */
const HERO_TIERS: readonly { readonly w: number; readonly t0: number; readonly t1: number }[] = [
  { w: 26, t0: 0.0, t1: 0.18 },
  { w: 46, t0: 0.38, t1: 0.62 },
  { w: 28, t0: 0.82, t1: 1.0 },
];
const HERO_TIER_W = HERO_TIERS.reduce((s, t) => s + t.w, 0);

/** 계층 하나를 뽑아 봉투 안 실제 배율로 편다 */
function drawHeroScale(rng: Rng, envelope: readonly [number, number]): number {
  let r = rng.range(0, HERO_TIER_W);
  for (const tier of HERO_TIERS) {
    r -= tier.w;
    if (r <= 0) {
      const t = rng.range(tier.t0, tier.t1);
      return envelope[0] + (envelope[1] - envelope[0]) * t;
    }
  }
  return envelope[1];
}

/**
 * 바이옴 편성표 — **각 바이옴에 그곳에만 있는 실루엣**을 하나씩 박아 넣는 것이 목적이다.
 * (종전에는 여섯 곳이 팔레트 색만 달랐다: 설원은 48개 소품이 단 2종이었다)
 *
 * 이번 개정에서 각 바이옴에 넣은 것은 "종류"가 아니라 **없던 축** 넷이다:
 *   ① 2.0급 큰 것 (크기 계층의 꼭대기)   ② 0.3급 누운 것 (수평 실루엣)
 *   ③ 바이옴 안에서 명도/색상이 튀는 것  ④ 0.6~0.95 구간의 2층 (1층과 3층 사이)
 */
const BIOME_KITS: Record<BiomeId, BiomeKit> = {
  grassland: {
    // ① pineGiant  ② fallenLog/stumpMossy  ③ birchSlim(흰 줄기)  ④ grassClumpTall
    hero: [
      pineTall(),
      pineTall(),
      pineGiant(),
      broadleaf(),
      broadleaf(),
      birchSlim(),
      boulder(C.rock),
      rockPile(C.rock),
      fallenLog(),
      stumpMossy(),
    ],
    heroScale: [0.58, 1.18],
    companion: [sapling(), stumpMossy(), fallenLog(), bushRound(P.bushDark, P.bushLit)],
    mid: [
      bushRound(P.bushDark, P.bushLit),
      sapling(),
      fieldRock(C.rock),
      bushRound(C.leafDark, P.leafWarm),
      grassClumpTall(P.grassBlade),
      grassClumpTall(shade(P.grassBlade, 0.88)),
    ],
    midCount: [1, 3],
    ground: [
      grassTuft(P.grassBlade),
      grassTuft(shade(P.grassBlade, 0.86)),
      flowerPatch(P.grassBlade, P.flowerWhite, P.flowerYellow),
      wildflowerBunch(P.grassBlade),
      dirtMound(),
      pebbles(C.rock),
      groundPatch(0x6fb444),
    ],
    groundCount: [3, 5],
    shadowTint: 0x2a4a5e,
    shadowMul: 0.56,
  },
  jungle: {
    // ⚠ 정글은 셀 예산이 6개 중 가장 빡빡하다(1층 최고가 112). buttressTree 를 넣는
    //   대신 jungleTree(110) 중복 하나를 뺐다 — 종류는 늘고 최악값은 그대로다.
    hero: [palmTall(), palmTall(), jungleTree(), buttressTree(), bambooClump(), fernTree(), mossyLog()],
    heroScale: [0.60, 1.12],
    companion: [fernTree(), mossyLog(), elephantEar(), fernBush(P.frond)],
    mid: [
      fernBush(P.frond),
      fernBush(P.frondDark),
      bushRound(P.jungleCanopy, P.frondLit),
      flowerBush(C.leafDark, P.flowerRed),
      vineCurtain(),
      elephantEar(),
      jungleOutcrop(),
    ],
    midCount: [2, 3],
    ground: [
      grassTuft(P.frondDark),
      fernBush(P.frondLit),
      groundPatch(0x2f8f45),
      flowerPatch(P.frondDark, P.flowerRed, P.flowerYellow),
      bromeliad(),
      pebbles(0x6f7a68),
    ],
    groundCount: [3, 4],
    shadowTint: 0x11384a,
    shadowMul: 0.52,
  },
  desert: {
    // ① rockSpire  ② sandArch(구멍 뚫린 실루엣)  ③ cairnStack  ④ ocotillo
    hero: [saguaro(), saguaro(), mesaRock(), rockSpire(), sandArch(), cairnStack(), boneFossil(), barrelCactus()],
    heroScale: [0.62, 1.22],
    companion: [smallCactus(), barrelCactus(), skullAlone(), cairnStack()],
    mid: [
      dryShrub(P.dryBrush),
      smallCactus(),
      fieldRock(P.sandRock),
      ocotillo(P.dryBrush),
      skullAlone(),
      duneMound(),
    ],
    midCount: [2, 3],
    ground: [
      crackLines(P.sandCrack, 0.035),
      grassTuft(P.dryBrush),
      pebbles(P.sandRock),
      groundPatch(0xdcb462),
      sandRipple(),
      sandRipple(),
    ],
    groundCount: [3, 5],
    shadowTint: 0x7a5240,
    shadowMul: 0.60,
  },
  snow: {
    // ① iceSpireTall(나무보다 큰 얼음)  ② snowRockOutcrop  ③ snowDeadTree(검정)·snowReeds(갈색)
    hero: [
      snowPineTall(),
      snowPineTall(),
      iceCrystal(),
      iceSpireTall(),
      snowRockOutcrop(),
      snowDeadTree(),
      snowBoulder(),
      snowLog(),
    ],
    heroScale: [0.62, 1.18],
    companion: [frozenShrub(), icicleCluster(), snowDrift(), snowLog()],
    mid: [frozenShrub(), iceShard(), snowMound(), icicleCluster(), snowDrift(), snowReeds()],
    midCount: [2, 4],
    ground: [
      groundPatch(0xdce9f2, 0.6),
      pebbles(0x9db4c4),
      { ao: 0.06, flats: [{ pos: [0.08, 0.034, 0.05], scale: [0.24, 0.20], color: C.ice, sides: 4 }, { pos: [-0.10, 0.034, -0.09], scale: [0.18, 0.15], color: C.iceDeep, sides: 4 }] },
      groundPatch(0xc9dced, 0.44),
      frozenPond(),
      frozenPond(),
    ],
    groundCount: [3, 5],
    shadowTint: 0x6f92c4,
    shadowMul: 0.74,
  },
  swamp: {
    // ① giantGlowCap(판의 광원이자 랜드마크)  ② swampLog  ③ bubblingMud(갈색)  ④ cattail
    hero: [mangrove(), mangrove(), deadTreeUp(), giantGlowCap(), rootArch(), swampLog(), glowMushroom(), mossBoulder()],
    heroScale: [0.60, 1.26],
    companion: [glowCluster(), cypressKnees(), mossBoulder(), swampLog()],
    mid: [reeds(), glowCluster(), fernBush(P.swampLeaf), cypressKnees(), cattail()],
    midCount: [2, 3],
    ground: [
      puddleWide(),
      grassTuft(P.reed),
      { ao: 0, flats: [{ pos: [0.10, 0.033, 0.06], scale: [0.30, 0.26], color: 0x4a7a3c, sides: 6, hueJitter: 0.03 }] },
      pebbles(0x6a7060),
      bubblingMud(),
    ],
    groundCount: [3, 5],
    shadowTint: 0x17323c,
    shadowMul: 0.55,
  },
  volcano: {
    // ① basaltStack(계단식)  ③ fumarole(흰 연기)·sulfurCrust(노랑)  ④ volcanicBomb(둥근 것)
    hero: [basaltColumn(), basaltColumn(), basaltStack(), charTree(), fumarole(), obsidianSpike(), ventCrater()],
    heroScale: [0.62, 1.24],
    companion: [obsidianSpike(), volcanicBomb(), ashCone(), emberRock()],
    mid: [emberRock(), basaltShard(), volcanicBomb(), ashCone(), emberRock()],
    // 화산 2층은 6개 중 가장 싸다(최대 26). 셀 실측이 172로 가장 낮게 나와 한 개 더
    // 얹었다 — 화산은 원래 "검은 벌판"이 콘셉트라 밀도가 낮으면 곧장 허전함이 된다.
    midCount: [3, 4],
    ground: [
      lavaFlow(),
      groundPatch(P.ash, 0.54),
      pebbles(P.basaltDeep),
      sulfurCrust(),
      charGrass(),
      groundPatch(0x3f322c, 0.46),
    ],
    groundCount: [3, 5],
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
/** 지면에서 띄우는 높이 — 타일 상면(y=0)과 지형 장식 무늬(0.012)보다 확실히 위 */
const SHADOW_Y = 0.035;
/** 그림자 판이 놓이는 방위 (태양 반대쪽) — 셀 밖으로 새는지 재려면 회전을 알아야 한다 */
const SHADOW_YAW = Math.atan2(SHADOW_DIR.x, SHADOW_DIR.z);
const SHADOW_COS = Math.abs(Math.cos(SHADOW_YAW));
const SHADOW_SIN = Math.abs(Math.sin(SHADOW_YAW));
/** 셀(1×1) 안쪽 안전 반경 — 판 꼭짓점이 여기를 못 넘는다 */
const SHADOW_FIT = 0.47;

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
  /*
   * 셀 밖으로 새지 않게 줄이는 계수.
   *
   * ⚠ 종전 식은 `max(|ox|,|oz|) + halfL <= 0.47` 이었는데 이건 **판이 돌아가 있다는
   * 사실을 빼먹은** 식이다. 판의 긴 축은 태양 반대 방향(약 -30°)을 보므로 월드 x 로
   * 재면 halfL·cos + halfW·sin 만큼 뻗는다. 소품이 작을 때는 halfW 가 작아 종전 식도
   * 우연히 맞았지만, 이번에 1층 원형이 커지면서(rockPile·snowRockOutcrop 등 반경 0.5급)
   * halfW 항이 커져 실제로 셀 밖 0.54까지 새는 셀이 나왔다(s3 (7,12) 실측).
   * 지금은 회전을 반영한 실제 반폭으로 잰다.
   */
  const extX = Math.abs(ox) + halfL * SHADOW_SIN + halfW * SHADOW_COS;
  const extZ = Math.abs(oz) + halfL * SHADOW_COS + halfW * SHADOW_SIN;
  const ext = Math.max(extX, extZ);
  if (ext > SHADOW_FIT) {
    const k = SHADOW_FIT / ext;
    ox *= k;
    oz *= k;
    halfW *= k;
    halfL *= k;
  }
  return {
    pos: [wx + ox, SHADOW_Y, wz + oz],
    // 6각형은 z 방향이 1.155배 길다 — 길이를 그만큼 되돌린다
    rot: [0, SHADOW_YAW, 0],
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

/** 캐시된 원형 지오메트리 + 크기(그림자 계산용) + 원가(셀 예산 계산용) */
interface Baked {
  geo: THREE.BufferGeometry;
  /** XZ 최대 반경 (축 정렬) */
  r: number;
  /**
   * XZ 외접 반경 — 배치할 때 **yaw 를 무작위로 돌리므로**(place) 축 정렬 반경으로
   * 재면 최대 √2배까지 과소평가한다. 셀 밖으로 새는지 따질 때는 이쪽을 써야 한다.
   */
  rc: number;
  /** 최고 높이 */
  h: number;
  /** 삼각형 수 — 셀 예산을 굽기 전에 세는 데 쓴다 */
  tri: number;
}

function bakedOf(biome: BiomeId, layer: string, idx: number, el: Element): Baked {
  const key = `prop:${biome}:${layer}:${idx}`;
  const geo = cachedGeo(key, () => bakeElement(el, hashSeed(key)));
  const bb = geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox);
  const r = bb ? Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) : 0.4;
  const rc = bb ? Math.hypot(Math.max(bb.max.x, -bb.min.x), Math.max(bb.max.z, -bb.min.z)) : 0.56;
  const h = bb ? bb.max.y : 0.5;
  return { geo, r, rc, h, tri: geo.getAttribute('position').count / 3 };
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
    /**
     * 이 셀에 남은 삼각형. 후보 목록을 넓히고 계층까지 섞으면 **이론 최악 조합**이
     * 바이옴에 따라 306~377까지 튄다(1층 최대 + 부 소품 + 2층 최대×N + 3층 최대×N).
     * 그 조합이 실제로 뽑힐 확률은 낮지만 6판 270셀이면 몇 번은 뽑힌다 — 그래서
     * 확률에 기대지 않고 **굽기 전에 세어 가며 채운다**. 밑에서 층마다 몫을 떼는
     * 순서가 곧 "무엇을 먼저 포기하는가"의 선언이다.
     */
    let left = CELL_SOFT_BUDGET;

    // ── 1층: 큰 실루엣 (무조건 놓는다 — 1층이 빠지면 그냥 빈 칸이다) ──
    const hi = rng.int(0, kit.hero.length - 1);
    const hero = bakedOf(biome, 'h', hi, kit.hero[hi] as Element);
    const dx = rng.range(-PROP_JITTER, PROP_JITTER);
    const dz = rng.range(-PROP_JITTER, PROP_JITTER);
    const hs = drawHeroScale(rng, kit.heroScale);
    pieces.push(place(hero, cx + dx, cz + dz, hs, rng.range(-0.022, 0.022), rng.range(0.9, 1.1)));
    left -= hero.tri + SHADOW_TRI;

    // ── 접촉 그림자 (소품이 그림자를 굽지 않는 대신) ──
    pieces.push(
      buildFlats([contactShadowSpec(cx, cz, dx, dz, hero.r * hs, hero.h * hs, shColor)], hashSeed(`sh:${cell.x},${cell.z}`), 0.02),
    );

    /*
     * ── 1층 보조: 밑동 옆 부 소품 ──
     * 언제 붙이느냐가 이 개정의 핵심이다.
     *  · 1층 월드 높이가 0.60 미만 = 작은 원형이 작은 계층으로 뽑힌 경우.
     *    그대로 두면 셀이 **통째로 작아져** 그냥 빈 칸으로 보인다 — 반드시 붙인다.
     *  · 큰 계층(1.35 이상)이면 40% — 썸네일처럼 "큰 나무 밑에 작은 나무"가 된다.
     *  · 그 외 20% — 너무 잦으면 모든 셀이 쌍둥이 배치가 되어 다시 규칙적으로 보인다.
     */
    const heroH = hero.h * hs;
    const compRoll = rng.next();
    const compWant = heroH < 0.6 ? true : heroH > 1.35 ? compRoll < 0.4 : compRoll < 0.2;
    if (compWant && kit.companion.length > 0) {
      const ci = rng.int(0, kit.companion.length - 1);
      const comp = bakedOf(biome, 'c', ci, kit.companion[ci] as Element);
      // 2·3층 몫을 먼저 떼고 남을 때만 — 부 소품 때문에 지피가 사라지면 밑동이 뜬다
      if (comp.tri <= left - UNDER_RESERVE) {
        const a = rng.range(0, Math.PI * 2);
        const rad = rng.range(0.26, 0.40);
        pieces.push(
          place(
            comp,
            cx + dx + Math.cos(a) * rad,
            cz + dz + Math.sin(a) * rad,
            rng.range(0.42, 0.62),
            rng.range(-0.03, 0.03),
            rng.range(0.88, 1.12),
          ),
        );
        left -= comp.tri;
      }
    }

    // ── 2층·3층: 셀 안 고리에 흩는다 (1층 밑동과는 겹치지 않게 민다) ──
    const scatter = (
      list: Element[],
      layer: string,
      n: number,
      rMin: number,
      rMax: number,
      sMin: number,
      sMax: number,
      reserve: number,
      fitInCell: boolean,
    ): void => {
      for (let i = 0; i < n; i++) {
        const idx = rng.int(0, list.length - 1);
        const el = list[idx];
        if (!el) continue;
        const b = bakedOf(biome, layer, idx, el);
        const a = rng.range(0, Math.PI * 2);
        let rad = rng.range(rMin, rMax);
        const s = rng.range(sMin, sMax);
        const dh = rng.range(-0.03, 0.03);
        const lm = rng.range(0.86, 1.14);
        // 예산이 모자라면 **이번 하나만** 건너뛴다 (더 싼 게 다음에 뽑힐 수 있다)
        if (b.tri > left - reserve) continue;
        const px = Math.cos(a) * rad;
        const pz = Math.sin(a) * rad;
        // 1층 밑동에 파묻히면 밖으로 민다
        if (Math.hypot(px - dx, pz - dz) < 0.22) rad = Math.min(rMax, rad + 0.22);
        /*
         * 3층만 셀 안으로 **완전히** 접어 넣는다.
         * 1·2층(나무·덤불)이 이웃 칸 위로 넘치는 건 오히려 좋다 — 캐노피가 겹쳐야
         * 숲으로 읽힌다. 그런데 3층은 지면에 붙은 판이라 넘치는 순간 **이웃 칸 바닥
         * 무늬**가 되고, 그러면 (a) 어느 칸이 소품 칸인지 흐려지고 (b) 이웃 칸끼리
         * 이어붙어 타일 격자가 지워진다(카펫화). 실제로 개정 직후 s1 (7,12)에서
         * 흙두덕 판이 이웃 칸으로 넘어가 접촉 그림자 계약 테스트가 잡아냈다.
         */
        if (fitInCell) rad = Math.max(0, Math.min(rad, SHADOW_FIT - b.rc * s));
        pieces.push(place(b, cx + Math.cos(a) * rad, cz + Math.sin(a) * rad, s, dh, lm));
        left -= b.tri;
      }
    };
    // 2층은 3층 몫(GROUND_RESERVE)을 남기고 쓴다 — 3층이 잘리면 밑동이 지면에서 뜬다
    scatter(kit.mid, 'm', rng.int(kit.midCount[0], kit.midCount[1]), 0.24, UNDER_RADIUS_MAX, 0.8, 1.15, GROUND_RESERVE, false);
    // 3층 rMin 을 0.14 → 0.26 으로 밀었다: 개정 전에는 지피가 1층 밑동 그늘에 파묻혀
    // 게임 카메라 거리 캡처에서 **한 개도 식별되지 않았다**. 대신 rMax 를 0.42 로
    // 당겨 셀 밖으로 새는 양은 그대로 둔다.
    scatter(kit.ground, 'g', rng.int(kit.groundCount[0], kit.groundCount[1]), 0.26, 0.42, 0.75, 1.25, 0, true);

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

/**
 * 소품 전용 색 — 맨 셀 바닥 결 레이어(grounddetail.ts)가 **같은 색표**를 쓰도록 연다.
 * 지피(3층)와 맨 셀 장식은 화면에서 나란히 놓이므로 색이 다른 표에서 나오면
 * "소품 칸과 빈 칸의 풀이 서로 다른 종"으로 보인다.
 */
export const PROP_COLORS = P;

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
  // ── 이번 개정에서 추가한 것 (1층 13 · 2층 12 · 3층 8) ──
  pineGiant: pineGiant(),
  birchSlim: birchSlim(),
  rockPile: rockPile(C.rock),
  fallenLog: fallenLog(),
  stumpMossy: stumpMossy(),
  buttressTree: buttressTree(),
  bambooClump: bambooClump(),
  mossyLog: mossyLog(),
  sandArch: sandArch(),
  rockSpire: rockSpire(),
  cairnStack: cairnStack(),
  snowRockOutcrop: snowRockOutcrop(),
  iceSpireTall: iceSpireTall(),
  snowDeadTree: snowDeadTree(),
  snowLog: snowLog(),
  giantGlowCap: giantGlowCap(),
  rootArch: rootArch(),
  swampLog: swampLog(),
  basaltStack: basaltStack(),
  fumarole: fumarole(),
  grassClumpTall: grassClumpTall(P.grassBlade),
  vineCurtain: vineCurtain(),
  elephantEar: elephantEar(),
  jungleOutcrop: jungleOutcrop(),
  ocotillo: ocotillo(P.dryBrush),
  skullAlone: skullAlone(),
  duneMound: duneMound(),
  icicleCluster: icicleCluster(),
  snowDrift: snowDrift(),
  snowReeds: snowReeds(),
  cypressKnees: cypressKnees(),
  cattail: cattail(),
  volcanicBomb: volcanicBomb(),
  ashCone: ashCone(),
  wildflowerBunch: wildflowerBunch(P.grassBlade),
  dirtMound: dirtMound(),
  bromeliad: bromeliad(),
  sandRipple: sandRipple(),
  frozenPond: frozenPond(),
  puddleWide: puddleWide(),
  bubblingMud: bubblingMud(),
  lavaFlow: lavaFlow(),
  sulfurCrust: sulfurCrust(),
  charGrass: charGrass(),
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

/**
 * 설계도의 실제 높이 (테스트/계측용).
 * elementTriCount 와 달리 **굽고 나서 잰다** — 눕힌 통나무처럼 회전이 실루엣을
 * 결정하는 원형은 pos/scale 만 봐서는 높이를 알 수 없기 때문이다.
 */
export function elementHeight(el: Element): number {
  const geo = bakeElement(el, 1);
  geo.computeBoundingBox();
  const h = geo.boundingBox?.max.y ?? 0;
  geo.dispose();
  return h;
}

/** 바이옴 편성 (테스트/계측용) */
export const PROP_KITS: Readonly<Record<BiomeId, BiomeKit>> = BIOME_KITS;
