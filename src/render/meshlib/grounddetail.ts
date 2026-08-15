/**
 * 맨 셀 **바닥 결** — 소품이 없는 칸에 까는 완전 납작한 장식 레이어.
 *
 * ── 왜 필요한가 (허전함의 정량적 정체) ──────────────────────────────────────
 * `SCENERY_DENSITY = 0.3` 이라 건설 가능 셀의 **30%만** 소품 셀이다. 나머지 70%는
 * 쿼드 한 장 + 타일색 하나뿐이라, 소품을 아무리 늘려도 화면의 대부분은 손대지지
 * 않는다. 셀 인구조사 실측:
 *   stage | 건설가능 | 소품 | **맨셀** | (맨셀 중) 경로인접 / 물인접
 *    s1   |  124 |  40 |  **84** | 52 / 26
 *    s2   |  134 |  44 |  **90** | 45 / 31
 *    s3   |  152 |  51 | **101** | 45 / 43
 *    s4   |  142 |  48 |  **94** | 40 / 28
 *    s5   |  142 |  42 | **100** | 51 / 45
 *    s6   |  148 |  40 | **108** | 55 / 38
 * 6판 합계 577칸이 민무늬였다. 그리고 캡처(bare-before.png)로 확인한 그림은 "빈 땅"이
 * 아니라 **격자무늬로 읽히는 빈 땅**이었다 — terrain 이 상면을 쿼드로 바꾸면서 결을
 * "타일 단위 색 지터"로만 내다 보니 이 카메라에서 타일 경계가 하드 엣지로 보인다.
 * 그래서 이 레이어의 목적은 "물건을 놓는 것"이 아니라 **타일 경계를 흐리는 것**이다.
 *
 * ⚠ 소품 셀 개수는 곧 건설 가능 칸 수 = 밸런스라 **한 개도 바꾸지 않는다**.
 *   sceneryCells()/SCENERY_DENSITY/isBuildableCell 어느 것도 이 파일은 건드리지 않고,
 *   여기서 늘어나는 것은 "소품이 없는 칸 **안**의 오브젝트"뿐이다. 순수 시각 레이어다.
 *
 * ── 왜 props.ts 가 아니라 새 파일인가 ──────────────────────────────────────
 * props.ts 에 함수를 더하는 쪽도 검토했고, 세 가지 이유로 접었다.
 *  (1) **removeCell 의 사정거리.** props 의 소유 단위는 "소품 셀"이고 removeCell 이
 *      셀 단위 삭제/재병합의 주체다. 맨 셀 장식이 같은 Map 에 들어가면 골드 제거의
 *      대상이 되어 버린다 — 유저가 치울 수 없는 것을 치우려 하게 된다.
 *  (2) **예산 격리.** props.test.ts 는 STAGE_CAP(8,400~11,700)·셀당 >90·"모든 셀
 *      제거 후 0"·"메시 정확히 1개" 넷을 동시에 잠근다. 한 메시에 섞으면 그 숫자가
 *      두 레이어의 합이 되어 다음 사람이 어느 쪽이 예산을 먹었는지 못 가린다.
 *  (3) 소품 셀과 맨 셀은 **서로소 집합**이라 애초에 한 파일에 둘 이유가 없다.
 * 반대로 terrain.decoMesh 병합(드로우콜 +0)도 접었다 — terrain.test.ts 의
 * `deco <= 345~460` 캡을 10배로 올려야 하고, 그러면 "지형 장식"과 "맨 셀 장식"이
 * 한 숫자에 섞인다. 자체 메시 1개(**드로우콜 +1**)가 값이 맞다: 최악 프레임 실측
 * 드로우콜이 72~74(상한 90)라 여유가 16~18인데, 삼각형 여유는 s3 기준 16,890 뿐이다.
 * 곧 여기서 아껴야 할 자원은 콜이 아니라 삼각형이고, 콜 1로 예산 격리를 산다.
 *
 * ── y 스택 (이 표를 깨면 링/원판을 뚫는다) ─────────────────────────────────
 *   0.000 타일 상면
 *   0.012 terrain deco 지면 무늬
 *   0.018 **맨셀 중앙 얼룩 (이 파일)**
 *   0.020 **맨셀 가장자리 얼룩 (이 파일)**
 *   0.023 **맨셀 액센트 아래층 (이 파일)**
 *   0.026 **맨셀 액센트 위층 (이 파일)**
 *   0.030 DECAL_Y — 사거리 링 · 경로 셰브런
 *   0.035 소품 접촉 그림자 ← **이 높이는 절대 쓰지 않는다**
 *   0.070 선택 마커 링 / 0.090 배치 슬롯 원판(반경 0.34) / 0.100 타워 루트
 * 0.035 금지 이유: props.test.ts 의 "그림자 판이 셀 밖으로 새지 않는다"가 그 높이의
 * 정점을 전부 훑어 **소품 셀 소유**임을 어서션한다. 지금은 다른 메시라 안전하지만,
 * 나중에 누가 두 레이어를 병합하는 순간 지뢰가 된다.
 * 깊이 정밀도: 카메라 near 0.5 / far ≈ 110, 판까지 거리 ≈ 25 → 깊이 해상도 ≈ 0.00007
 * 월드. 5~6mm 간격은 그 80배라 z-파이팅이 없다(polygonOffset 불필요).
 *
 * ── 규칙 셋 (전부 테스트로 잠근다) ─────────────────────────────────────────
 *  ① **완전 수평 판만.** 기울이지 않는다. 길이 0.26 판을 0.12rad만 기울여도 끝이
 *     y≈0.042로 올라가고, 그 높이대는 사거리 링(0.030)~슬롯 원판(0.090) 구간이라
 *     링을 뚫고 삐져나온다. "잎이 살짝 서야 예뻐 보인다"가 가장 크게 작동하는 지점이다.
 *  ② **셀 중앙을 비운다.** 액센트는 반경 0.24~0.38 고리에만. 근거는 타워가 아니라
 *     **배치 슬롯 원판(CircleGeometry 반경 0.34)** 이다 — 원판이 얹히는 자리를
 *     어지럽히면 "여기 지을 수 있다"가 흐려진다. 중앙에는 미묘한 색 얼룩만 둔다.
 *  ③ **셀 밖으로 안 샌다** (GD_FIT 0.47 + 요소 외접 반경). 이웃 칸 장식과 붙어
 *     카펫이 되면 타일 격자가 아예 지워져 조준이 어려워진다.
 *  ④ **명도 대비 ±28%(GD_CONTRAST_BAND) 이내.** 이보다 세면 "칸 안에 물건이 있다"로
 *     읽혀 유저가 골드 제거 대상으로 오인한다 — 이 레이어의 1순위 실패 모드다.
 *     그래서 세로로 선 것·그림자를 만드는 것은 하나도 넣지 않는다.
 *     기준선은 **바이옴 지면 램프의 평균 휘도**(gdGroundLuma), 재는 자는 Rec.709 이고,
 *     실제로 당기는 곳은 clampKit — 편성표(kitOf)를 통과한 색에는 밴드 밖이 없다.
 *     ⚠ 오래 이 줄이 "±20%"라고만 적혀 있고 **구현은 바닥 얼룩에만** 있었다. 그때
 *       실측은 잔가지 −53% / 흰 꽃 +30% / 설원 마른가지 −68% 였다 — 즉 규칙이 아니라
 *       희망이었다. 숫자를 바꾸려거든 GD_CONTRAST_BAND 주석의 "세 곳" 경고를 읽어라.
 *
 * 실측(오프라인, tests/render/grounddetail.test.ts 가 잠근다): 셀당 평균 17~29,
 * 스테이지 총량 2,000~3,600. 캐스터가 아니므로 **프레임 청구는 ×1**이다.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BiomeId, StageDef, Vec2 } from '@/data/types';
import { charAt as gridCharAt, cellKey } from '@/data/grid';
import { Rng, hashSeed } from '@/core/rng';
import { BIOMES, C, flatMat } from '../palette';
import { cachedGeo, tintGeo } from './factory';
import { PROP_COLORS as P, buildFlats, shade, type FlatSpec } from './props';
import type { CellToWorld } from './terrain';

/** 요소 **하나**의 삼각형 상한 — 이 레이어는 "물건"이 아니므로 값이 싸야 한다 */
export const GD_ELEMENT_TRI_BUDGET = 8;

/**
 * 셀 **하나**의 합계 상한.
 *
 * 산정 근거는 최악 프레임 실측이다: s3 133,110(6판 중 최대) / 예산 150,000 → 여유
 * 16,890, 맨 셀 101개니 이론상 167 tri/셀까지 가능하다. 그 **1/3 이하**로 잡아
 * 이후 작업(타워 LOD·적 추가)에 여유를 남긴다. props.ts 와 같은 방식으로 굽기 전에
 * 세어 가며 채우므로 초과는 확률이 낮은 게 아니라 **구조적으로 불가능**하다.
 *
 * 이 값이 실제로 걸리는 곳은 **정글 내부 셀 하나뿐**이다(얼룩 2장 7 + 액센트 6개
 * 최대 7 = 49). 나머지 다섯 바이옴은 액센트 상한이 3~5라 여기 닿지 않는다.
 */
export const GD_CELL_TRI_BUDGET = 52;

/** 스테이지 전체 상한 — s6(맨셀 108 + 경로 42)가 가장 크다 */
export const GD_STAGE_CAP = 4_800;

/** 바닥 얼룩 y (셀 중앙) */
const Y_SOIL = 0.018;
/** 가장자리 얼룩 y — 중앙 얼룩과 겹치므로 2mm 띄운다(같은 높이면 z-파이팅) */
const Y_EDGE = 0.020;
/** 액센트 아래층 y */
const Y_ACC = 0.023;
/** 액센트 위층 y (꽃잎·기포 같은 것) */
const Y_TOP = 0.026;

/** 액센트가 놓이는 고리 [안쪽, 바깥쪽] — 안쪽이 슬롯 원판(0.34)보다 작아도 되는 것은
 *  원판이 반투명이고 액센트가 그 아래 6cm 에 깔리기 때문이다. 중요한 건 **중심**이 빈 것 */
const ACC_R0 = 0.24;
const ACC_R1 = 0.38;
/** 셀(1×1) 안쪽 안전 반경 — 요소 외접 반경을 뺀 값이 배치 반경의 상한이다 */
const GD_FIT = 0.47;
/** 같은 셀 안 액센트끼리 요구하는 최소 각도 차 — 한쪽에 뭉치면 "물건 더미"가 된다 */
const ACC_MIN_SEP = 0.7;

const _v = new THREE.Vector3();
const _ca = new THREE.Color();
const _cb = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _pv = new THREE.Vector3();
const _sv = new THREE.Vector3();

/**
 * 판을 자리에 앉힌다 — **y 는 스케일하지 않는다**.
 *
 * factory.geoTransform 은 균일 스케일이라 s=1.2 를 주면 y 0.026 이 0.0312 로 올라가
 * 사거리 링(0.030)을 뚫는다. 첫 판이 실제로 그렇게 터졌고 y 스택 테스트가 잡았다.
 * 판은 두께가 없으므로 y 를 같이 키울 이유도 없다 — 이 함수가 y 스택을 배율과
 * **무관하게** 고정해 준다.
 */
function placeFlat(geo: THREE.BufferGeometry, x: number, z: number, yaw: number, s: number): THREE.BufferGeometry {
  _q.setFromEuler(_e.set(0, yaw, 0, 'XYZ'));
  _m.compose(_pv.set(x, 0, z), _q, _sv.set(s, 1, s));
  geo.applyMatrix4(_m);
  return geo;
}

/** 두 색을 섞는다 (존별 색 변조용 — 팔레트가 바뀌면 이 레이어도 따라 바뀐다) */
function mix(a: number, b: number, t: number): number {
  return _ca.setHex(a).lerp(_cb.setHex(b), t).getHex();
}

// ── 규칙 ④ 대비 클램프 (선언이 아니라 구현) ─────────────────────────────────

/**
 * 이 레이어가 지면에서 벗어날 수 있는 **상대 휘도 폭**.
 *
 * ── 왜 0.20 이 아니라 0.28 인가 (캡처 실측) ───────────────────────────────
 * 규칙 ④는 오래 ±20%라고 **주석에만** 적혀 있었고 액센트에는 구현이 없었다.
 * 실제로 구현해 보니 두 방향에서 다른 답이 나왔다:
 *  · **밝은 판(설원 지면 0.923)** — ±20% 하한이 0.738 이라, 마른 잔가지(0.297)와
 *    나무껍질(0.310)이 **밝은 베이지**까지 끌려 올라와 눈 위에서 통째로 증발했다.
 *    캡처 fix/band20/snow.png 확대에서 잔가지가 한 개도 보이지 않는다.
 *  · **어두운 판(화산 지면 0.312)** — ±20% 상한이 0.374 라 유황·용암 결이 재색과
 *    구분되지 않아 판이 회색 한 장이 됐다.
 * 0.28 로 넓히면 두 판 다 요소가 다시 보이면서, 이 레이어의 1순위 실패 모드
 * ("칸 안에 물건이 있다" → 골드 제거 대상 오인)는 그대로 막힌다 — 오인이 시작되는
 * 지점은 실측상 **하드 엣지가 생기는 −40% 부근**이었다(수정 전 잔가지 −53%,
 * 흰 꽃 +30%가 정확히 그 예다). 0.28 은 그 절반 아래다.
 *
 * ⚠ 이 숫자를 고치면 **세 곳을 같이** 고쳐라: 파일 머리 규칙 ④ 문구, 이 상수,
 *   그리고 tests/render/grounddetail.test.ts 의 "대비 밴드" 케이스. 규칙이 주석에만
 *   있고 코드가 어기는 상태가 바로 이 상수가 생긴 이유다.
 */
export const GD_CONTRAST_BAND = 0.28;

/**
 * Rec.709 상대 휘도. **팔레트 숫자(sRGB 바이트)를 그대로** 쓴다 — 선형 변환하지
 * 않는 것이 중요하다. 이 판정의 목적은 물리적 밝기가 아니라 "눈에 얼마나 튀나"이고,
 * 그건 화면에 나가는 sRGB 값에서 재야 한다. THREE.Color 를 거치면 컬러 매니지먼트가
 * 선형으로 바꿔 버리므로 여기서는 비트 연산으로 직접 뽑는다.
 */
export function gdLuma(hex: number): number {
  return (
    (0.2126 * ((hex >> 16) & 0xff) + 0.7152 * ((hex >> 8) & 0xff) + 0.0722 * (hex & 0xff)) / 255
  );
}

const _hsl = { h: 0, s: 0, l: 0 };

/**
 * 색상·채도는 두고 **명도만** 밴드 안으로 당긴다.
 *
 * 지면색 쪽으로 lerp 하는 쪽(구현이 한 줄이다)도 시도했고 접었다 — 흰 꽃이
 * 32% 섞이는 순간 **연두색 얼룩**이 되어 꽃이 아니게 됐다. 색을 섞으면 대비와 함께
 * 색상까지 지워진다. 그래서 HSL 의 h·s 를 고정하고 l 만 움직인다: 흰 꽃은 크림색으로,
 * 설원의 검은 잔가지는 **볕에 바랜 회갈색**으로 내려앉는다 — 둘 다 자기 색을 지킨다.
 *
 * l → 휘도는 (h·s 고정 시) 단조증가라 이분 탐색이 항상 수렴한다. 색은 kit 을 만들 때
 * 한 번만 통과하고 KITS 에 캐시되므로 프레임 비용은 0이다.
 */
function toBand(hex: number, refLuma: number, band = GD_CONTRAST_BAND): number {
  const lo = refLuma * (1 - band);
  const hi = refLuma * (1 + band);
  const l = gdLuma(hex);
  if (l >= lo && l <= hi) return hex;
  const target = l < lo ? lo : hi;
  // 도달 불가능한 상한(밝은 판에서 hi > 1) — 흰색이 갈 수 있는 끝이다
  if (target >= 1) return 0xffffff;
  const up = target > l;
  _ca.setHex(hex).getHSL(_hsl);
  let a = 0;
  let b = 1;
  for (let i = 0; i < 22; i++) {
    const m = (a + b) / 2;
    if (gdLuma(_cb.setHSL(_hsl.h, _hsl.s, m).getHex()) < target) a = m;
    else b = m;
  }
  /*
   * 마지막 한 칸은 **양자화 보정**이다. 탐색은 실수로 수렴하지만 결과는 8비트로
   * 반올림되므로, 수렴값이 밴드 경계 바로 **바깥**(−28.2% 같은 값)에 떨어질 수 있다.
   * 테스트가 실제로 그걸 잡았다. 그래서 밴드 안쪽으로 1/512 씩 밀어 마무리한다 —
   * 눈에 보이지 않는 차이지만, 이 레이어의 계약이 "밴드 안"이므로 안이어야 한다.
   */
  let m = (a + b) / 2;
  let out = _cb.setHSL(_hsl.h, _hsl.s, m).getHex();
  for (let i = 0; i < 32 && (up ? gdLuma(out) < target : gdLuma(out) > target); i++) {
    m = Math.min(1, Math.max(0, m + (up ? 1 / 512 : -1 / 512)));
    out = _cb.setHSL(_hsl.h, _hsl.s, m).getHex();
  }
  return out;
}

/** 바이옴 지면 램프의 평균 휘도 — 대비를 재는 기준선 */
export function gdGroundLuma(biome: BiomeId): number {
  const g = BIOMES[biome].ground;
  if (g.length === 0) return 0.5;
  let s = 0;
  for (const c of g) s += gdLuma(c);
  return s / g.length;
}

/** 판 목록의 모든 색을 밴드 안으로 (요소 함수가 어떤 색을 고르든 여기를 반드시 지난다) */
function bandFlats(flats: Flats, refLuma: number): Flats {
  return flats.map((f) => {
    const c = toBand(f.color, refLuma);
    return c === f.color ? f : { ...f, color: c };
  });
}

/**
 * 편성 전체를 밴드에 통과시킨다.
 *
 * 요소 함수(twig·flowerDot…) 안에서 색을 손보지 않고 **표를 만든 뒤 한 번에** 거는
 * 것이 핵심이다. 그래야 "새 액센트를 추가했는데 대비 클램프를 깜빡했다"가 구조적으로
 * 불가능해진다 — kitOf 를 통과한 편성에는 밴드 밖 색이 존재할 수 없다.
 */
function clampKit(raw: GdKit, refLuma: number): GdKit {
  const soil = {} as Record<Zone, readonly number[]>;
  const accent = {} as Record<Zone, readonly Flats[]>;
  for (const z of ZONES) {
    soil[z] = raw.soil[z].map((c) => toBand(c, refLuma));
    accent[z] = raw.accent[z].map((f) => bandFlats(f, refLuma));
  }
  return { soil, soilW: raw.soilW, accent, count: raw.count };
}

// ── 존 ─────────────────────────────────────────────────────────────────────
/**
 * 셀의 성격. **개수가 아니라 풍성함과 색만** 존마다 다르다 (셀 개수는 불변).
 *  · inner — 경로도 물도 안 닿는 안쪽. 가장 풍성하다. 캡처에서 제일 허전했던 곳이다.
 *  · trail — 경로 인접. 액센트를 줄이고 색을 길 쪽으로 당겨 "밟혀 닳은 길가"로.
 *            경로 윤곽이 덤으로 또렷해진다.
 *  · shore — 물 인접. 색을 shoreSand 쪽으로 당기고 조개·유목·모래를 섞는다
 *            (terrain 의 exposedCell 모래 립과 같은 논리를 한 겹 잇는다).
 *  · path  — 경로 셀 **위**. 발자국·자갈만. 여기만 규칙이 다르다(아래 주석).
 */
type Zone = 'inner' | 'trail' | 'shore' | 'path';

const ZONES: readonly Zone[] = ['inner', 'trail', 'shore', 'path'];

// ── 요소 (전부 완전 수평 판) ────────────────────────────────────────────────
// n각형 = n-2 삼각형. 어느 것도 GD_ELEMENT_TRI_BUDGET(8)을 넘지 않는다.

type Flats = readonly FlatSpec[];

/**
 * **뾰족한 잎/가지 한 장** — 3각 판 1장 (**1 tri**). 원점에서 방향 a 로 len 만큼 뻗는다.
 *
 * 첫 판은 잎을 사각 판으로 깔았는데, 게임 카메라 거리 캡처에서 폭이 일정한 막대가
 * 나란히 서서 **화살표(>)·괄호(⌐) 글리프**로 읽혔다 — 지형이 아니라 UI 표시로 보였다.
 * 원인은 길이가 아니라 **폭이 끝까지 일정한 것**이다. 밑동이 넓고 끝이 한 점으로
 * 모이면 같은 크기에서도 풀잎/잔가지로 읽힌다. 게다가 3각형은 사각형의 **절반 값**이라
 * 잎을 3장에서 5장으로 늘리고도 오히려 싸졌다(6 tri → 5 tri).
 *
 * 기하: sides=3 판의 로컬 꼭짓점은 (-1,0)·(0.5,±0.866) 이라 -x 가 뾰족한 끝,
 * +0.5x 가 밑동이다. 길이 = 1.5·sx, 밑동 폭 = 1.73·sz. yaw 를 a+π/2 로 두고
 * 밑동이 원점에 오도록 0.5·sx 만큼 밀면 원점→(sin a, cos a)·len 짜리 잎이 된다.
 */
function blade(a: number, len: number, wid: number, color: number, ox = 0, oz = 0, y = Y_ACC): FlatSpec {
  const sx = len / 1.5;
  return {
    pos: [ox + Math.sin(a) * sx * 0.5, y, oz + Math.cos(a) * sx * 0.5],
    rot: [0, a + Math.PI / 2, 0],
    scale: [sx, wid / 1.732],
    color,
    sides: 3,
    hueJitter: 0.035,
  };
}

/** 흙/색 얼룩 — 5각 판 1장 (3 tri). **단색 타일을 깨는 주력**이라 셀마다 반드시 1장 */
function soilPatch(color: number, w: number): Flats {
  return [{ pos: [0, Y_SOIL, 0], scale: [w, w * 0.84], color, sides: 5, hueJitter: 0.022 }];
}

/**
 * 풀 포기 — 잎 5장이 **한 원점에서** 부채꼴로 뻗는다 (5 tri).
 *
 * 원점을 공유하는 것과 **부채가 비대칭인 것** 둘 다 필요하다. 원점을 흩으면 바닥에
 * 뿌린 성냥개비가 되고(props.ts:crackLines 가 같은 함정을 이미 진단해 뒀다),
 * 각도·길이를 고르게 두면 좌우대칭 화살표가 된다 — 첫 판이 정확히 그랬다.
 * 그래서 각도 간격(0.40/0.27/0.33/0.37)과 길이(0.15~0.26)를 일부러 어긋나게 뒀다.
 */
function grassSprig(color: number): Flats {
  const A = [-0.66, -0.26, 0.01, 0.34, 0.71];
  const L = [0.15, 0.22, 0.26, 0.19, 0.13];
  return A.map((a, i) =>
    blade(a, L[i] as number, 0.055, i === 2 ? shade(color, 1.12) : i === 0 ? shade(color, 0.9) : color),
  );
}

/**
 * 작은 꽃 — 잎 판(5각 3 tri) + 꽃송이 **한 덩이**(6각 4 tri) = 7 tri.
 *
 * 2차 캡처(before/grassland_zoom.png, 5배 확대)에서 정확히 진단된 결함:
 * 꽃잎을 `sides: 4` 0.072 판 **두 장**으로 두었더니 게임 카메라에서 화면상 3~4px
 * 짜리 **흰 정사각형 두 개**가 되어 잔디 위에 붙은 **색종이 조각/스티커**로 읽혔다.
 * 원인은 색이 아니라 **모서리 개수**다 — 4각형은 이 크기에서 안티에일리어싱을 거쳐도
 * 직각이 살아남는 유일한 다각형이라 "잘라 붙인 종이"라는 인상이 지워지지 않는다.
 * 6각형은 같은 픽셀 수에서 원으로 뭉개져 "꽃송이"가 된다.
 *
 * 두 장 → 한 장으로 줄인 것은 예산 때문이다(6각 4 tri × 2 + 잎 3 = 11 > 8).
 * 대신 한 덩이를 키우고(0.072 → 0.105) hueJitter 를 0.02 → 0.05 로 올렸다 —
 * buildFlats 가 **삼각형마다** 색을 흔들므로, 6각 판 하나가 색이 조금씩 다른
 * 꽃잎 4장으로 갈라져 보인다. 두 색(a·b)은 그 한 덩이 안에서 섞어 쓴다.
 */
function flowerDot(leaf: number, a: number, b: number): Flats {
  return [
    { pos: [0, Y_ACC, 0], scale: [0.21, 0.18], color: leaf, sides: 5, hueJitter: 0.04 },
    { pos: [0.035, Y_TOP, 0.025], scale: [0.105, 0.10], color: mix(a, b, 0.35), sides: 6, hueJitter: 0.05 },
  ];
}

/**
 * 돌멩이 — 6각 판 **한 장** (4 tri). 지면보다 한 단 어둡게.
 *
 * 이 함수는 결국 "덧판을 어떤 다각형으로 두느냐"를 세 번 틀리고 나서야 답이 나왔다.
 * 확대 캡처가 매번 다른 글리프를 돌려줬다:
 *   `sides: 4` → **회갈색 정사각형**(색종이 조각). flowerDot 과 같은 병이었다.
 *   `sides: 3` 을 몸돌 옆에  → 뾰족한 끝이 삐져나와 **화살촉(➤)**. twig 과 같은 병.
 *   `sides: 3` 을 몸돌 **안**에 → 밝은 6각 안의 어두운 삼각형이 **재생 버튼(▶)**.
 * 세 번째가 특히 배울 게 많다. 실루엣은 규칙대로 6각 그대로였는데도 글리프가 됐다 —
 * 이 크기에서는 **윤곽선이 아니라 명암 경계가 도형을 만든다**. 요소 안에 대비를
 * 넣으면 그 대비가 곧 아이콘이 된다.
 *
 * 그래서 덧판을 아예 뺐다. 화면상 6~8px 짜리 육각형은 그 자체로 자갈로 읽히고,
 * 로우폴리 특유의 "깎인 면"은 buildFlats 의 삼각형별 색 지터(faceJitter 0.03)가
 * 이미 공짜로 내 준다. 덤으로 5 → **4 tri**, pebbleFlat 은 6바이옴 거의 모든 zone 에
 * 실려 있어 이 −1 이 스테이지당 수십 tri 다.
 */
function pebbleFlat(color: number): Flats {
  return [{ pos: [0.02, Y_ACC, 0.015], scale: [0.145, 0.125], color, sides: 6, hueJitter: 0.025 }];
}

/**
 * 잔가지 — **획 하나**짜리 마른 막대기 (1 tri).
 *
 * 앞선 두 판이 모두 같은 함정에 빠졌다. 1차는 곁가지를 90°로 틀어 **꺾쇠(⌐)**,
 * 2차는 0.52rad 로 눕혀 **체크마크(✓)/화살표(➤)** 가 됐다. 확대 캡처에서 초원 판
 * 한 화면에 짙은 적갈색 ✓ 가 예닐곱 개 셀 수 있었고, 이 게임에서는 그게 단순히
 * 못생긴 게 아니라 **의미 충돌**이다 — 경로 타일 위에 진행 방향 셰브런(▶)이 이미
 * 깔려 있어서, 판 위의 화살표 모양은 전부 "길 표시"로 먼저 읽힌다.
 *
 * 각도 문제가 아니다. **긴 획과 짧은 획이 한 점에서 만나는 도형 자체**가 글리프다
 * (✓ ➤ ⌐ ∟ 은 전부 그 도형이다). 그래서 각도를 더 눕히는 대신 곁가지를 없앴다 —
 * 땅에 떨어진 막대기는 한 획으로 충분히 읽히고, 획이 하나뿐이면 만나는 점이
 * 없으므로 어떤 yaw 로 돌려도 글리프가 될 수 없다. 덤으로 2 tri → **1 tri**.
 *
 * 길이 0.26 → 0.28, 밑동 0.038 → 0.05 로 살짝 키웠다. 획이 하나뿐이라 그전 굵기로는
 * 확대 전에는 **머리카락 한 올**로 사라졌다. 밑동:길이 = 1:5.6 의 쐐기라 굵은 쪽이
 * 부러진 단면, 가는 쪽이 가지 끝으로 읽힌다.
 */
function twig(color: number): Flats {
  return [blade(0.0, 0.28, 0.05, color)];
}

/** 이끼/얼룩 — 6각 판 1장 (4 tri). 가장 싼 "면" */
function blot(color: number, w = 0.22, y = Y_ACC): Flats {
  // hueJitter 를 0.05 로 뒀더니 흙색(탄 계열) 얼룩이 **분홍**으로 돌았다 —
  // 채도가 낮고 따뜻한 색은 같은 색상 지터에도 훨씬 크게 튄다. 0.028 이 상한이다.
  return [{ pos: [0, y, 0], scale: [w, w * 0.86], color, sides: 6, hueJitter: 0.028 }];
}

/**
 * 낙엽 — 잎 3장 (3 tri). **원점을 흩는 유일한 요소**다 (떨어진 것이므로 뿌리가 없다).
 * 나머지 요소가 전부 한 원점에서 뻗는 것과 정반대의 규칙이고, 그래서 이것만
 * 다른 것들 사이에서 "흩어진 것"으로 읽힌다.
 */
function litter(a: number, b: number): Flats {
  return [
    blade(0.55, 0.15, 0.09, a, 0.04, 0.05),
    blade(2.45, 0.13, 0.08, b, -0.07, 0.02),
    blade(1.35, 0.11, 0.07, shade(a, 0.88), 0.01, -0.08),
  ];
}

/**
 * 갈라진 땅 — 한 점에서 갈라지는 가는 균열 3가닥 (3 tri).
 * 두 가닥을 **같은 반구 안**(0.18~1.15 rad)에 두는 것은 그림 때문만이 아니다 —
 * 원점 뒤로 뻗는 가닥이 있으면 이 요소가 "양방향"으로 분류되어(oneSided=false)
 * 셀 고리 위에 앉혔을 때 반대쪽 끝이 셀 중앙을 가로지른다.
 * 균열은 뿌리 쪽이 넓고 끝이 가늘어지므로 blade 가 그대로 맞는 모양이다.
 */
function crackFleck(color: number): Flats {
  return [
    blade(0.18, 0.30, 0.045, color),
    blade(0.72, 0.17, 0.032, shade(color, 0.92)),
    blade(1.15, 0.11, 0.026, shade(color, 0.86)),
  ];
}

/**
 * 조개 껍데기 — 5각 두 쪽이 살짝 어긋나 겹친 것 (3+3 = 6 tri). 물가에만.
 *
 * 덧판이 `sides: 4` 였고 pebbleFlat 과 같은 병이었다. 다만 여기서는 pebbleFlat 처럼
 * 한 장으로 줄이지 않았다 — 물가 편성에는 이미 6각 한 장짜리(모래 얼룩 blot·자갈
 * pebbleFlat)가 둘이나 있어서, 조개까지 한 장이 되면 물가가 **똑같은 다각형 세 개**가
 * 된다. 대신 두 쪽을 **거의 겹쳐** 둔다: 합친 윤곽이 좌우로 살짝 어긋난 쌍각(雙殼)이
 * 되어 실루엣만으로 다른 것과 구별되고, 두 쪽의 밝기 차(×1.08)는 겹친 자리에서만
 * 보이므로 pebbleFlat 이 걸렸던 "안쪽 대비가 아이콘이 된다"에 걸리지 않는다.
 * shellFleck 은 shoreCommon 한 자리뿐이라 +1 tri 의 스테이지 영향은 십여 개 수준이다.
 */
function shellFleck(color: number): Flats {
  return [
    { pos: [0.015, Y_ACC, 0.008], scale: [0.105, 0.088], color, sides: 5, hueJitter: 0.02 },
    { pos: [-0.045, Y_TOP, -0.028], scale: [0.088, 0.074], color: shade(color, 1.08), sides: 5 },
  ];
}

/**
 * 발자국 — 작은 판 2장을 **진행 방향으로 어긋나게** (4 tri). 경로 셀 전용.
 * 배치할 때 yaw 를 경로 방향에 맞춰 준다(pathHeading) — 제각각 돌리면 발자국이
 * 아니라 그냥 어두운 점 두 개다.
 */
function footScuff(color: number): Flats {
  return [
    { pos: [0.055, Y_ACC, 0.075], scale: [0.085, 0.135], color, sides: 5, hueJitter: 0.02 },
    { pos: [-0.055, Y_ACC, -0.075], scale: [0.080, 0.128], color: shade(color, 0.94), sides: 5, hueJitter: 0.02 },
  ];
}

// ── 바이옴 편성 ─────────────────────────────────────────────────────────────

export interface GdKit {
  /** 존별 바닥 얼룩 색 후보 (셀마다 1장) */
  soil: Record<Zone, readonly number[]>;
  /** 존별 바닥 얼룩 폭 */
  soilW: Record<Zone, number>;
  /** 존별 액센트 후보 */
  accent: Record<Zone, readonly Flats[]>;
  /**
   * 존별 액센트 개수 [최소, 최대] — **바이옴 밀도가 사는 곳이 여기다.**
   * 정글은 빽빽하고(내부 4~6) 사막은 성기다(내부 2~3). 판을 나란히 놓고 보면
   * 바이옴을 가르는 것은 종류가 아니라 이 숫자다.
   */
  count: Record<Zone, readonly [number, number]>;
}

/** 존별 공통 골격 — 색만 바이옴에서 받아 채운다 */
function zoneSoil(
  inner: readonly number[],
  path0: number,
  sand: number,
): Record<Zone, readonly number[]> {
  return {
    inner,
    // 길가는 흙 쪽으로 당긴다 — 경로 윤곽이 한 겹 두꺼워 보이는 효과가 덤으로 온다
    trail: inner.map((c) => mix(c, path0, 0.20)),
    // 물가는 모래 쪽으로 (terrain 의 exposedCell 모래 립을 안쪽으로 한 겹 잇는다)
    shore: inner.map((c) => mix(c, sand, 0.20)),
    path: [shade(path0, 0.93), shade(path0, 1.05), mix(path0, sand, 0.18)],
  };
}

const SOIL_W: Record<Zone, number> = { inner: 0.46, trail: 0.42, shore: 0.44, path: 0.38 };

function kitRaw(biome: BiomeId): GdKit {
  const pal = BIOMES[biome];
  const g = pal.ground;
  const g0 = g[0] ?? 0x808080;
  const g2 = g[2] ?? g0;
  const g4 = g[4] ?? g0;
  const path0 = pal.path[0] ?? g0;
  const sand = pal.shoreSand;
  const acc = pal.grain.accentColor;
  /*
   * 바닥 얼룩 색은 전부 **팔레트 램프에서 유도**한다 (직접 하드코딩하지 않는다).
   * 명도 배율을 0.92~1.07 안에 묶어 두는 것은 여전히 맞지만, 그것은 규칙 ④의
   * 구현이 아니라 **얼룩만의 관습**이다 — 규칙 ④를 실제로 강제하는 것은 이 함수
   * 바깥의 clampKit 이고, 얼룩·액센트가 **똑같이** 그것을 통과한다.
   */
  const inner = [shade(g0, 0.93), shade(g2, 1.05), shade(g4, 0.96), mix(g0, acc, 0.24)];
  const soil = zoneSoil(inner, path0, sand);
  const stone = mix(C.rock, g0, 0.25);
  const shoreStone = mix(stone, sand, 0.45);
  const pathStone = mix(stone, path0, 0.4);

  /** 6판이 공유하는 물가 편성 — 모래알·조개·유목·자갈 */
  const shoreCommon: Flats[] = [
    blot(mix(sand, g0, 0.35), 0.26),
    shellFleck(mix(sand, 0xffffff, 0.25)),
    pebbleFlat(shoreStone),
    twig(mix(C.bark, sand, 0.35)),
  ];
  /** 6판이 공유하는 경로 편성 — 발자국 + 자갈만. 여기 이상은 길을 흐린다 */
  const pathCommon: Flats[] = [
    footScuff(shade(path0, 0.82)),
    footScuff(mix(path0, acc, 0.4)),
    pebbleFlat(pathStone),
  ];

  switch (biome) {
    case 'grassland':
      return {
        soil,
        soilW: SOIL_W,
        accent: {
          inner: [
            grassSprig(P.grassBlade),
            grassSprig(shade(P.grassBlade, 0.88)),
            flowerDot(P.grassBlade, P.flowerWhite, P.flowerYellow),
            flowerDot(shade(P.grassBlade, 0.9), P.flowerPink, P.flowerWhite),
            blot(P.mossPatch),
            pebbleFlat(stone),
            twig(P.soil),
          ],
          trail: [grassSprig(shade(P.grassBlade, 0.84)), pebbleFlat(stone), twig(P.soil), blot(mix(P.soilLit, g0, 0.4))],
          shore: [...shoreCommon, grassSprig(shade(P.grassBlade, 0.9))],
          path: pathCommon,
        },
        count: { inner: [3, 5], trail: [1, 3], shore: [2, 4], path: [1, 2] },
      };
    case 'jungle':
      // 정글이 가장 빽빽하다 — 판 전체가 덮여 있어야 밀림으로 읽힌다
      return {
        soil,
        soilW: SOIL_W,
        accent: {
          inner: [
            grassSprig(P.frond),
            grassSprig(P.frondDark),
            blot(P.frondDark, 0.26),
            blot(mix(P.mossHang, g0, 0.3), 0.24),
            litter(P.frondLit, P.leafWarm),
            flowerDot(P.frondDark, P.flowerRed, P.flowerYellow),
            pebbleFlat(mix(P.jungleRock, g0, 0.25)),
            twig(P.swampBark),
          ],
          trail: [grassSprig(P.frondDark), blot(P.frondDark, 0.22), pebbleFlat(P.jungleRock), litter(P.frondLit, P.leafWarm)],
          shore: [...shoreCommon, blot(P.frondDark, 0.24)],
          path: pathCommon,
        },
        count: { inner: [4, 6], trail: [2, 4], shore: [3, 5], path: [1, 3] },
      };
    case 'desert':
      // 사막이 가장 성기다 — 빈 모래가 보여야 사막이다. 대신 모래 결(crack)이 넓다
      return {
        soil,
        soilW: { ...SOIL_W, inner: 0.50, shore: 0.48 },
        accent: {
          inner: [
            crackFleck(shade(P.sandCrack, 0.86)),
            pebbleFlat(P.sandRock),
            grassSprig(P.dryBrush),
            blot(mix(P.sandRipple, g0, 0.4), 0.26),
          ],
          trail: [pebbleFlat(P.sandRock), crackFleck(shade(P.sandCrack, 0.88)), blot(mix(P.sandRipple, g0, 0.45), 0.22)],
          shore: [...shoreCommon, pebbleFlat(P.sandRockDeep)],
          path: pathCommon,
        },
        count: { inner: [2, 3], trail: [1, 2], shore: [1, 3], path: [1, 2] },
      };
    case 'snow':
      return {
        soil,
        soilW: SOIL_W,
        accent: {
          inner: [
            blot(mix(C.ice, g0, 0.45), 0.26),
            pebbleFlat(mix(P.snowRock, g0, 0.3)),
            twig(P.deadWoodLit),
            grassSprig(P.dryReed),
            blot(mix(C.iceDeep, g0, 0.55), 0.20),
          ],
          trail: [pebbleFlat(mix(P.snowRock, g0, 0.35)), twig(P.deadWoodLit), blot(mix(C.ice, g0, 0.5), 0.22)],
          shore: [...shoreCommon, blot(mix(C.iceDeep, g0, 0.5), 0.24)],
          path: pathCommon,
        },
        count: { inner: [2, 4], trail: [1, 3], shore: [2, 3], path: [1, 2] },
      };
    case 'swamp':
      return {
        soil,
        soilW: SOIL_W,
        accent: {
          inner: [
            blot(mix(P.puddle, g0, 0.35), 0.26),
            blot(mix(P.mud, g0, 0.4), 0.24),
            grassSprig(P.reed),
            grassSprig(shade(P.swampLeaf, 1.1)),
            twig(P.swampBarkLit),
            pebbleFlat(mix(0x6a7060, g0, 0.3)),
            litter(P.mossHang, P.swampLeaf),
          ],
          trail: [blot(mix(P.mud, g0, 0.45), 0.22), grassSprig(P.reed), pebbleFlat(mix(0x6a7060, g0, 0.35))],
          shore: [...shoreCommon, blot(mix(P.puddle, g0, 0.3), 0.26)],
          path: pathCommon,
        },
        count: { inner: [3, 5], trail: [2, 3], shore: [3, 4], path: [1, 2] },
      };
    case 'volcano':
      return {
        soil,
        soilW: SOIL_W,
        accent: {
          inner: [
            crackFleck(mix(P.lavaDeep, g0, 0.45)),
            blot(mix(P.ash, g0, 0.35), 0.26),
            pebbleFlat(shade(P.basalt, 1.1)),
            blot(mix(P.sulfur, g0, 0.55), 0.18),
            grassSprig(P.charGrassCol),
          ],
          trail: [blot(mix(P.ash, g0, 0.4), 0.22), pebbleFlat(shade(P.basalt, 1.08)), crackFleck(mix(P.lavaDeep, g0, 0.5))],
          shore: [...shoreCommon, blot(mix(P.ash, g0, 0.4), 0.24)],
          path: pathCommon,
        },
        count: { inner: [2, 4], trail: [1, 3], shore: [2, 3], path: [1, 2] },
      };
  }
}

/**
 * 편성 = 팔레트에서 유도한 원안(kitRaw) → **대비 밴드 통과**(clampKit).
 * 이 두 단계를 합치지 않는 것은, 원안 쪽에서는 "바이옴다운 색"만 고르고
 * 대비 책임은 한 곳에 모아 두기 위해서다.
 */
function kitOf(biome: BiomeId): GdKit {
  return clampKit(kitRaw(biome), gdGroundLuma(biome));
}

/** 바이옴 편성은 팔레트에서만 유도되므로 한 번 만들면 그대로다 */
const KITS = new Map<BiomeId, GdKit>();
function kitFor(biome: BiomeId): GdKit {
  let k = KITS.get(biome);
  if (!k) {
    k = kitOf(biome);
    KITS.set(biome, k);
  }
  return k;
}

// ── 굽기 ────────────────────────────────────────────────────────────────────

/** 캐시된 요소 지오메트리 + 외접 반경(셀 밖 방지) + 삼각형 수(예산) */
interface Baked {
  geo: THREE.BufferGeometry;
  /**
   * XZ **외접** 반경. 배치할 때 yaw 를 무작위로 돌리므로 축 정렬 반경으로 재면
   * 최대 √2배까지 과소평가한다 — props.ts:Baked.rc 와 같은 이유다.
   */
  rc: number;
  tri: number;
  /**
   * 원점에서 **한쪽(+z)으로만** 뻗는 요소인가 (잔가지·풀 포기·균열).
   * 이런 것은 yaw 를 무작위로 돌리면 절반의 확률로 셀 중앙을 향해 눕는다.
   * 그래서 배치할 때 +z 가 **셀 바깥**을 보게 돌린다 — 중앙이 비고, 덤으로
   * "풀이 가장자리에서 안쪽으로 자란" 그림이 된다.
   */
  oneSided: boolean;
}

function baked(key: string, flats: Flats): Baked {
  const geo = cachedGeo(key, () => {
    const g = buildFlats(flats, hashSeed(key), 0.03);
    g.computeBoundingBox();
    return g;
  });
  const bb = geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox);
  const rc = bb ? Math.hypot(Math.max(bb.max.x, -bb.min.x), Math.max(bb.max.z, -bb.min.z)) : 0.3;
  const oneSided = bb ? bb.min.z > -0.04 && bb.max.z > 0.12 : false;
  return { geo, rc, tri: geo.getAttribute('position').count / 3, oneSided };
}

const DIRS8: readonly (readonly [number, number])[] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

export interface GroundDetailBuild {
  group: THREE.Group;
  /**
   * 소품을 치워 새로 맨 셀이 된 칸에 결을 얹고 재병합한다 (드로우콜은 그대로 1).
   * 이미 결이 있거나 지상이 아니면 false.
   *
   * 이게 없으면 소품을 치운 칸만 **결 없는 대머리**로 남아, "치운 자리"가 아니라
   * 렌더 버그로 보인다. decals.addSlotCell 이 이미 같은 이벤트에서 같은 재병합을
   * 하고 있으므로 비용/구조가 검증된 경로다(제거는 드문 이벤트다).
   */
  addCell(cellX: number, cellZ: number): boolean;
  dispose(): void;
}

/**
 * 맨 셀(+경로 셀) 바닥 결 — 병합 메시 1개 반환.
 *
 * @param bareCells stage3d 가 이미 계산해 둔 "건설 가능 − 소품" 목록을 **그대로**
 *   넘긴다. 여기서 다시 계산하면 decals 의 슬롯 목록과 갈릴 수 있고, 갈리는 순간
 *   "장식은 있는데 배치 하이라이트가 없는 칸"이 생긴다.
 * @param density 품질 티어 밀도 배수 (quality.groundDetail). 1 = 그대로.
 */
export function buildGroundDetail(
  stage: StageDef,
  pathCells: ReadonlySet<number>,
  bareCells: readonly Vec2[],
  cellToWorld: CellToWorld,
  density = 1,
): GroundDetailBuild {
  const kit = kitFor(stage.biome);
  const biome = stage.biome;
  /** 규칙 ④ 기준선 — 굽는 중에 파생되는 색(가장자리 얼룩)도 이 밴드를 지나야 한다 */
  const refLuma = gdGroundLuma(biome);
  /** 셀 좌표 → 그 셀의 변환 완료 지오메트리 (재병합용 원본) */
  const parts = new Map<string, THREE.BufferGeometry>();

  const isPath = (x: number, z: number): boolean =>
    x >= 0 && x < stage.gridW && z >= 0 && z < stage.gridH && pathCells.has(cellKey(stage, x, z));

  const zoneOf = (x: number, z: number): Zone => {
    if (isPath(x, z)) return 'path';
    for (const [dx, dz] of DIRS8) if (gridCharAt(stage, x + dx, z + dz) === '~') return 'shore';
    for (const [dx, dz] of DIRS8) if (isPath(x + dx, z + dz)) return 'trail';
    return 'inner';
  };

  /** 경로 셀의 진행 축 — 발자국을 여기에 맞춘다 (제각각 돌리면 발자국이 아니다) */
  const pathHeading = (x: number, z: number): number => {
    for (const [dx, dz] of DIRS8) if (isPath(x + dx, z + dz)) return Math.atan2(dx, dz);
    return 0;
  };

  /**
   * 셀 하나를 굽는다.
   *
   * rng 를 **셀 좌표에서 직접** 시드한다(공용 rng 를 순회하지 않는다). 이유는
   * addCell 이다 — 공용 rng 면 소품을 치우는 **순서**에 따라 같은 칸의 그림이 달라져
   * 결정론 테스트가 간헐 실패한다. 셀 전용 시드면 언제 치우든 같은 칸에 같은 결이 난다.
   */
  const bakeCell = (x: number, z: number): THREE.BufferGeometry | null => {
    const zone = zoneOf(x, z);
    const rng = new Rng(hashSeed(`gd:${stage.id}:${zone}:${x},${z}`));
    cellToWorld(x, z, _v);
    const cx = _v.x;
    const cz = _v.z;
    const pieces: THREE.BufferGeometry[] = [];
    let left = GD_CELL_TRI_BUDGET;

    // ── 바닥 얼룩 (셀마다 1장 — 이 한 장이 타일 경계를 흐리는 주력이다) ──
    const soils = kit.soil[zone];
    const si = rng.int(0, soils.length - 1);
    const soilB = baked(`gd:${biome}:soil:${zone}:${si}`, soilPatch(soils[si] as number, kit.soilW[zone]));
    const ss = Math.min(rng.range(0.86, 1.14), GD_FIT / soilB.rc);
    const soff = Math.min(rng.range(0, 0.10), Math.max(0, GD_FIT - soilB.rc * ss));
    const sa = rng.range(0, Math.PI * 2);
    pieces.push(
      tintGeo(
        placeFlat(soilB.geo.clone(), cx + Math.cos(sa) * soff, cz + Math.sin(sa) * soff, rng.range(0, Math.PI * 2), ss),
        rng.range(0.95, 1.05),
      ),
    );
    left -= soilB.tri;

    /*
     * ── 가장자리 얼룩 (6각 판 1장) ──
     * 첫 판은 셀마다 **중앙 얼룩 한 장**뿐이었고, 캡처에서 타일 격자가 거의 그대로
     * 남았다. 당연하다 — 격자를 만드는 것은 타일 **경계**인데 얼룩이 한가운데
     * 있으면 경계는 손대지지 않는다(오히려 칸마다 점이 하나씩 찍혀 규칙성이 는다).
     * 그래서 두 번째 얼룩을 경계 가까이(r 0.20~0.30) 무작위 방향으로 민다. 셀 밖으로
     * 넘기지는 않는다(카펫화 금지) — 대신 이웃 칸도 각자 자기 경계에 얼룩을 두므로,
     * 두 칸의 얼룩이 경계를 사이에 두고 만나 직선이 끊겨 보인다.
     */
    const ei = rng.int(0, soils.length - 1);
    const edgeB = baked(
      `gd:${biome}:edge:${zone}:${ei}`,
      blot(toBand(shade(soils[ei] as number, 0.97), refLuma), 0.34, Y_EDGE),
    );
    if (edgeB.tri <= left) {
      const es = rng.range(0.78, 1.14);
      const ea = rng.range(0, Math.PI * 2);
      const erad = Math.min(rng.range(0.20, 0.30), Math.max(0, GD_FIT - edgeB.rc * es));
      pieces.push(
        tintGeo(
          placeFlat(edgeB.geo.clone(), cx + Math.cos(ea) * erad, cz + Math.sin(ea) * erad, rng.range(0, Math.PI * 2), es),
          rng.range(0.95, 1.05),
        ),
      );
      left -= edgeB.tri;
    }

    // ── 액센트: 중앙을 비운 고리에만 ──
    const list = kit.accent[zone];
    const [n0, n1] = kit.count[zone];
    // 저사양 밀도 감쇠. 맨 셀은 최소 1개는 남긴다 — 0이면 다시 민무늬 칸이 된다
    const want = Math.max(zone === 'path' ? 0 : 1, Math.round(rng.int(n0, n1) * density));
    const used: number[] = [];
    for (let i = 0; i < want; i++) {
      const idx = rng.int(0, list.length - 1);
      const flats = list[idx];
      if (!flats) continue;
      const b = baked(`gd:${biome}:acc:${zone}:${idx}`, flats);
      // 예산이 모자라면 **이번 하나만** 건너뛴다 (더 싼 게 다음에 뽑힐 수 있다)
      if (b.tri > left) continue;
      // 각도 분산: 이미 쓴 각과 ACC_MIN_SEP 이상 떨어진 후보를 최대 5번 뽑는다
      let a = rng.range(0, Math.PI * 2);
      for (let t = 0; t < 5; t++) {
        if (used.every((u) => Math.abs(((a - u + Math.PI * 3) % (Math.PI * 2)) - Math.PI) >= ACC_MIN_SEP)) break;
        a = rng.range(0, Math.PI * 2);
      }
      used.push(a);
      /*
       * 셀 밖으로 새지 않게 (카펫화 방지 계약) — **반경을 먼저, 크기를 나중에** 깎는다.
       * 반대로 하면 큰 요소가 셀 중심 쪽으로 끌려 들어와 고리가 무너지고,
       * 중앙을 비운다는 규칙 ②가 조용히 사라진다. 반경을 ACC_R0 까지 당겨도
       * 모자랄 때만 크기를 줄인다.
       */
      let s = rng.range(0.8, 1.2);
      let rad = rng.range(ACC_R0, ACC_R1);
      if (rad + b.rc * s > GD_FIT) {
        rad = Math.max(ACC_R0, GD_FIT - b.rc * s);
        if (rad + b.rc * s > GD_FIT) s = (GD_FIT - rad) / b.rc;
      }
      /*
       * yaw 규칙 셋:
       *  · 경로 셀 — 진행 축에 맞춘다. 제각각 돌리면 발자국이 아니라 어두운 점이다.
       *  · 한쪽으로만 뻗는 것 — +z 가 셀 **바깥**을 보게 (yaw = π/2 − a). 무작위면
       *    절반은 중앙을 향해 누워 슬롯 원판 자리를 가로지른다.
       *  · 나머지 — 자연물이라 무작위가 맞다.
       */
      const yaw =
        zone === 'path'
          ? pathHeading(x, z) + rng.range(-0.25, 0.25)
          : b.oneSided
            ? Math.PI / 2 - a + rng.range(-0.55, 0.55)
            : rng.range(0, Math.PI * 2);
      /*
       * 개체별 밝기 흔들기. 예전 폭 ±7% 를 ±5% 로 좁혔다 — 화면에 실제로 나가는 대비는
       * **밴드(±28%) + 이 지터 + buildFlats 의 면 지터(HSL l ±0.03)** 의 합이고,
       * ±7% 면 최악 개체가 −38%까지 내려가 클램프를 해 놓고도 규칙 ④ 밖으로 새는
       * 개체가 남는다. ±5% 는 눈으로 구별되지 않는 차이인데(캡처 A/B 동일) 합계는
       * 밴드 근처로 묶인다.
       */
      pieces.push(
        tintGeo(
          placeFlat(b.geo.clone(), cx + Math.cos(a) * rad, cz + Math.sin(a) * rad, yaw, s),
          rng.range(0.95, 1.05),
        ),
      );
      left -= b.tri;
    }

    const merged = mergeGeometries(pieces, false);
    for (const p of pieces) p.dispose();
    return merged;
  };

  const addAt = (x: number, z: number): boolean => {
    const key = `${x},${z}`;
    if (parts.has(key)) return false;
    if (gridCharAt(stage, x, z) === '~') return false;
    const g = bakeCell(x, z);
    if (!g) return false;
    parts.set(key, g);
    return true;
  };

  // ── 1) 맨 셀 (이 레이어의 본체) ──
  // 마을이 앉는 칸은 건너뛴다 — 큰 움막 밑에 깔린 결은 보이지 않고 값만 낸다
  for (const c of bareCells) {
    if (c.x === stage.baseCell.x && c.z === stage.baseCell.z) continue;
    addAt(c.x, c.z);
  }

  // ── 2) 경로 셀 ──
  // 경로에는 terrain.buildDeco 가 이미 30% 확률로 넓적한 자국을 깔아 뒀다. 그래서
  // 여기서는 **발자국과 자갈만** 얹는다 — 그 이상 얹으면 길이 길로 안 읽힌다.
  // 경로는 판 밖(물)에서 시작하므로 '~' 칸이 섞여 있다(addAt 이 걸러낸다).
  const pathList = [...pathCells].sort((a, b) => a - b);
  for (const k of pathList) {
    const x = k % stage.gridW;
    const z = Math.floor(k / stage.gridW);
    addAt(x, z);
  }

  const group = new THREE.Group();
  group.name = 'groundDetail';
  // flatMat()은 모듈 공유 싱글턴 — 여기서 dispose 하면 안 된다 (props.ts 와 같은 규약)
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), flatMat());
  mesh.name = 'groundDetailMesh';
  /**
   * ⚠ 캐스터로 만들면 프레임 청구가 2배가 된다 — 게다가 두께 0인 판의 그림자는
   * 어차피 자기 자신에 가려 보이지도 않는다. 얻는 게 없고 값만 두 배다.
   */
  mesh.castShadow = false;
  // 타워/유닛 그림자가 장식 위에 떨어져야 한다. false 면 그늘 속에서 장식만 밝은 얼룩이 된다
  mesh.receiveShadow = true;
  group.add(mesh);

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
    addCell(cellX: number, cellZ: number): boolean {
      if (!addAt(cellX, cellZ)) return false;
      remerge();
      return true;
    },
    dispose(): void {
      mesh.geometry.dispose();
      for (const g of parts.values()) g.dispose();
      parts.clear();
    },
  };
}

/** 테스트/계측용 — 요소 전체 (이름 → 판 목록) */
export const GD_ELEMENTS: Readonly<Record<string, Flats>> = {
  soilPatch: soilPatch(0x8ad455, 0.46),
  grassSprig: grassSprig(P.grassBlade),
  flowerDot: flowerDot(P.grassBlade, P.flowerWhite, P.flowerYellow),
  pebbleFlat: pebbleFlat(C.rock),
  twig: twig(P.soil),
  blot: blot(P.mossPatch),
  litter: litter(P.frondLit, P.leafWarm),
  crackFleck: crackFleck(P.sandCrack),
  shellFleck: shellFleck(C.bone),
  footScuff: footScuff(0xc69a5e),
};

/** 테스트/계측용 — 바이옴 편성 */
export function gdKit(biome: BiomeId): GdKit {
  return kitFor(biome);
}

/** 테스트/계측용 — 존 목록 */
export const GD_ZONES = ZONES;

/** 판 목록의 삼각형 수 (굽지 않고 센다) */
export function flatsTriCount(flats: Flats): number {
  let n = 0;
  for (const f of flats) n += (f.sides ?? 4) - 2;
  return n;
}
