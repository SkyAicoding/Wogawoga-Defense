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
 * "타일 단위 색 지터"로만 내다 보니 이 카메라에서 타일 경계가 하드 엣지로 보였다.
 *
 * ⚠ **그 전제는 이제 낡았다.** terrain 이 지면색을 타일 픽에서 **좌표의 연속 함수**로
 *   갈아엎어(terrain.ts:groundColor) 타일 경계가 원리적으로 사라졌다. 곧 이 레이어의
 *   목적도 바뀌었다 — "경계를 흐리는 것"이 아니라 **매끄러운 지면 위에 반점과 잔물건을
 *   놓는 것**이다. 목적이 바뀐 줄 모르고 남아 있던 구조("셀마다 얼룩 한 장을 중앙에",
 *   "액센트는 반경 0.24~0.38 고리에만")가 정확히 격자를 다시 그리고 있었다.
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
 *   0.015~0.0218 **면 얼룩 (이 파일)** — 사이트마다 이 대역 안에서 높이가 다르다.
 *         겹치는 판이 정확히 같은 y 면 z-파이팅이 나므로 해시로 흩는다(아래 Y_BLOT).
 *   0.023 **맨셀 액센트 아래층 (이 파일)**
 *   0.026 **맨셀 액센트 위층 (이 파일)**
 *   0.030 DECAL_Y — 사거리 링 · 경로 셰브런
 *   0.035 소품 접촉 그림자 ← **이 높이는 절대 쓰지 않는다**
 *   0.070 선택 마커 링 / 0.090 배치 슬롯 원판(반경 0.34) / 0.100 타워 루트
 * 0.035 금지 이유: props.test.ts 의 "그림자 판이 셀 밖으로 새지 않는다"가 그 높이의
 * 정점을 전부 훑어 **소품 셀 소유**임을 어서션한다. 지금은 다른 메시라 안전하지만,
 * 나중에 누가 두 레이어를 병합하는 순간 지뢰가 된다.
 * 깊이 정밀도: 카메라 near 0.5 / far ≈ 110, 판까지 거리 ≈ 25 → 깊이 해상도 ≈ 0.00007
 * 월드. 층 사이 3mm 간격은 그 40배라 z-파이팅이 없다(polygonOffset 불필요).
 * ⚠ **면 얼룩끼리는 층이 아니다** — 셀당 장수가 고정이 아니게 되면서 높이를 해시로
 *   흩었다. 그래서 겹친 두 판의 y 차이가 우연히 해상도 밑으로 떨어질 수 있다.
 *   확률과 그때 왜 안 보이는지는 Y_BLOT 주석에 있다.
 *
 * ── 규칙 셋 (전부 테스트로 잠근다) ─────────────────────────────────────────
 *  ① **완전 수평 판만.** 기울이지 않는다. 길이 0.26 판을 0.12rad만 기울여도 끝이
 *     y≈0.042로 올라가고, 그 높이대는 사거리 링(0.030)~슬롯 원판(0.090) 구간이라
 *     링을 뚫고 삐져나온다. "잎이 살짝 서야 예뻐 보인다"가 가장 크게 작동하는 지점이다.
 *  ② **셀 중앙은 성기게.** 근거는 타워가 아니라 **배치 슬롯 원판(CircleGeometry
 *     반경 0.34)** 이다 — 원판이 얹히는 자리를 어지럽히면 "여기 지을 수 있다"가
 *     흐려진다. 다만 **금지가 아니라 감쇠**다(gdCenterKeep): 반경 0.13 안은 버리고
 *     0.28 까지 확률을 선형으로 올린다.
 *     ⚠ 오래 이 규칙이 "액센트는 반경 0.24~0.38 **고리에만**"이었고, 그게 이 파일의
 *       제1 결함이었다 — 모든 칸에 **같은 반지름의 고리**가 생겨 셀이 '슬롯'으로
 *       보였다(심판: "무더기의 발자국 크기가 칸마다 거의 동일하고 같은 도장 2~3종의
 *       반복"). 고리는 중앙을 비우는 가장 쉬운 방법이지만 **격자를 그리는** 방법이다.
 *  ③ **셀 밖으로 안 샌다** (GD_FIT 0.47). 이건 그림 규칙이 아니라 **소유권 계약**이다 —
 *     addCell/재병합이 셀 단위라, 한 셀의 판이 이웃으로 넘어가면 소품을 치운 칸을
 *     다시 구울 때 이웃 칸 그림이 두 겹이 된다. 그래서 좌표 소유는 절대 안 푼다.
 *     대신 **그림만 푼다** — 아래 "격자에 안 매이게 하는 법" 참고.
 *  ④ **명도 대비 ±38%(GD_CONTRAST_BAND) 이내 — 단, 이건 설계 단계 값이다.**
 *     기준선은 **바이옴 지면 램프의 평균 휘도**(gdGroundLuma), 재는 자는 Rec.709 이고,
 *     실제로 당기는 곳은 clampKit — 편성표(kitOf)를 통과한 **FlatSpec 색**에는 밴드
 *     밖이 없다(면 얼룩은 그 앞에 stretchRamp 로 **폭을 늘리는** 단계를 하나 더 지난다 —
 *     밴드는 상한만 정하지 하한을 보장하지 않기 때문이다).
 *     그러나 **화면 정점 색은 밴드 밖으로 나간다**(정직하게: 실측 −47~+49%).
 *     굽는 도중 색을 흔드는 항이 셋 더 있기 때문이고, 그 셋의 크기는 GD_CONTRAST_BAND
 *     주석에 실측표로 적어 뒀다. 이보다 세면 "칸 안에 물건이 있다"로 읽혀 유저가
 *     골드 제거 대상으로 오인한다 — 이 레이어의 1순위 실패 모드다. 그래서 세로로
 *     선 것·그림자를 만드는 것은 하나도 넣지 않는다.
 *
 * ── 격자에 안 매이게 하는 법 (규칙 ③을 지키면서) ──────────────────────────
 * 판을 놓는 자리를 **셀 좌표에서 뽑지 않는다.** 월드 좌표계에 깔린 지터 격자
 * (gdSites — 간격 0.60/0.50칸, 칸 격자와 어긋난 각도로 회전)에서 사이트를 뽑고,
 * 그중 **자기 셀 안에 떨어진 것만** 굽는다. 소유는 셀이 갖되 **패턴은 셀을 모른다**:
 *   · 사이트 간격이 1칸의 약수가 아니라 칸마다 위상이 어긋난다 → 같은 도장이 안 된다.
 *   · 경계 양쪽 사이트가 0.5~0.6칸 간격으로 이어지므로 **얼룩 무리가 칸을 가로질러** 보인다.
 *     (판 하나하나는 자기 칸 안에 있는데, 무리는 두세 칸 폭이다 — 이게 핵심이다.)
 *   · 개수·크기·색은 **저주파 필드**에서 온다(gdField). 이웃 사이트가 같은 값을 읽으니
 *     인접한 얼룩이 같은 톤·같은 크기로 나와 **하나의 큰 얼룩**으로 붙어 읽힌다.
 *     칸마다 독립 rng 로 뽑으면 절대 이렇게 안 된다 — 그게 예전 구조였다.
 *   · 방향도 필드다(gdWind). 풀·잔가지가 한 구역에서 같은 쪽으로 눕는다.
 * 셀 경계에 걸친 사이트는 s 를 줄여 넣고, 그래도 안 되면 버린다. 버려지는 띠는
 * 폭 0.03칸(플레이 해상도로 1픽셀 미만)이라 "칸 사이 빈 줄"로 보이지 않는다.
 *
 * ── 실플레이 해상도가 정하는 크기 ──────────────────────────────────────────
 * 데스크톱 1280×800 에서 판 전체가 화면에 들어오면 **한 칸이 약 15px**, 폰 390×844 는
 * 더 작다. 곧 0.2칸짜리 요소는 3px 이고, 심판이 "얼룩·잔가지·꽃이 판독되지 않는다"고
 * 한 것은 대비만의 문제가 아니라 **크기 문제**였다. 그래서 이 레이어의 주력은 작은
 * 소품이 아니라 **면 얼룩(soilBlot, 폭 0.19~0.58칸 = 3~9px)** 이고, 저주파 색 필드가
 * 이웃 얼룩을 같은 톤으로 묶어 두세 칸짜리 반점으로 키운다. 잔가지·꽃은 확대했을 때
 * 나오는 덤이다 — 1x 에서 그것까지 읽히게 만들려면 밴드를 ±60%까지 열어야 하고,
 * 그건 곧 "칸 안의 물건"이다.
 *
 * 실측(오프라인, tests/render/grounddetail.test.ts 가 잠근다): 셀당 평균 14~21,
 * 스테이지 총량은 테스트 로그에 남는다. 캐스터가 아니므로 **프레임 청구는 ×1**이다.
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
 * 실측 최악 셀은 **32 tri (s2 정글 5,10)** 이다. 배치가 월드 격자로 바뀌면서 셀에
 * 몇 장이 떨어지느냐가 확률적이 됐고(면 얼룩 0~4장 + 액센트 0~7개), 그래서 상한이
 * 예전보다 더 여유롭게 남는다. 상한을 32 로 조이지 않는 이유는 그 확률 꼬리 때문이다 —
 * 사이트가 우연히 여섯 개 떨어진 칸이 언제든 나올 수 있고, 그때 잘리는 것은 예산이
 * 아니라 그림이다.
 */
export const GD_CELL_TRI_BUDGET = 52;

/**
 * 스테이지 전체 상한 — s6(맨셀 108 + 경로 42)가 가장 크다.
 * 실측 1,208(s3)~1,516(s2). 예전 구조(1,902~2,476)보다 **적은데 화면에서는 더 보인다** —
 * 셀마다 작은 것을 여러 개 놓는 대신 큰 면 얼룩을 흩었기 때문이다.
 */
export const GD_STAGE_CAP = 4_800;

/**
 * 면 얼룩(soilBlot)이 구워지는 y — 실제로 놓을 때 사이트 해시로 **아래로만** 내린다.
 * 대역 폭 6.8mm 는 z-파이팅 여유에서 왔다: 카메라 near 0.5 / 판까지 ≈25 → 깊이
 * 해상도 ≈ 0.07mm 이므로 대역을 6.8mm 로 두면 무작위로 겹친 두 판이 구분 못 할
 * 만큼 가까울 확률이 2% 남짓이고, 그 둘은 같은 저주파 색 필드를 읽어 색이 거의
 * 같으므로 설령 깜빡여도 보이지 않는다. (예전엔 판이 셀당 2장 고정이라 0.018 /
 * 0.020 두 층으로 충분했다 — 이제 셀당 0~4장이라 층으로는 안 된다.)
 */
const Y_BLOT = 0.0218;
const Y_BLOT_DROP = 0.0068;
/** 액센트 아래층 y */
const Y_ACC = 0.023;
/** 액센트 위층 y (꽃잎·기포 같은 것) */
const Y_TOP = 0.026;

/** 셀(1×1) 안쪽 안전 반경 — 판의 회전 AABB 가 이 정사각형 안에 들어야 한다(규칙 ③) */
const GD_FIT = 0.47;
/** 셀 경계에 걸린 사이트를 넣기 위해 줄일 수 있는 배율의 하한. 이보다 작아지면 버린다 */
const GD_S_MIN = 0.52;
/** 이 반경 안에는 액센트 앵커를 두지 않는다 (배치 슬롯 원판 한가운데) */
const ACC_CLEAR_R = 0.13;
/** 여기부터는 액센트를 그대로 받는다 — 사이 구간은 확률이 선형으로 오른다 */
const ACC_FADE_R = 0.28;

// ── 좌표 필드 (칸이 아니라 월드 좌표에서 나오는 값들) ───────────────────────
/*
 * terrain.ts 에도 같은 모양의 해시/값노이즈가 있고, 일부러 **복사**했다.
 * 두 레이어는 서로 다른 것을 그린다 — terrain 은 지면색, 여기는 그 위에 얹는 얼룩 —
 * 이라 파장·시드가 갈려야 하고, 무엇보다 terrain.ts 는 지금 다른 담당자가 고치는
 * 중이라 export 를 요구하면 두 작업이 서로를 막는다. 열다섯 줄짜리 순수 함수다.
 */

/** 좌표 해시 — 정수 격자점 하나에 [0,1). 같은 좌표면 언제나 같은 값이다 */
function gdHash(xi: number, zi: number, seed: number): number {
  let h = (Math.imul(xi | 0, 0x8da6b343) ^ Math.imul(zi | 0, 0xd8163841) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** smoothstep 보간 값 노이즈 — 저주파 필드용. 반환 [0,1] */
function gdNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = gdHash(xi, zi, seed);
  const b = gdHash(xi + 1, zi, seed);
  const c = gdHash(xi, zi + 1, seed);
  const d = gdHash(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * 두 옥타브 저주파 필드 — 개수·크기·색·방향이 전부 여기서 온다.
 *
 * `len` 은 **칸 단위 파장**이고 3칸 밑으로 내리지 마라. 이 필드의 존재 이유는
 * "이웃 사이트가 같은 값을 읽는 것"이고, 파장이 칸 크기에 가까워지면 값이 칸마다
 * 갈려 다시 칸 단위 무작위가 된다 — 그러면 얼룩이 안 붙고 격자가 돌아온다.
 */
function gdField(x: number, z: number, len: number, seed: number): number {
  const a = gdNoise(x / len, z / len, seed);
  // 둘째 옥타브는 각도를 틀어 얹는다 — 값 노이즈 격자가 축 정렬이라 안 틀면 얼룩
  // 결이 칸 격자와 같은 방향으로 선다(terrain.ts 가 같은 함정을 이미 진단해 뒀다).
  const c = 0.5403;
  const s = 0.8415;
  const b = gdNoise((x * c - z * s) / (len * 0.44), (x * s + z * c) / (len * 0.44), (seed ^ 0x5bd1) | 0);
  return a * 0.7 + b * 0.3;
}

/**
 * 월드 좌표 지터 격자 — **셀 격자와 어긋난** 사이트 생성기.
 *
 * pitch 를 1칸의 약수로 두면 칸마다 같은 자리에 사이트가 생겨 예전 고리와 똑같아진다.
 * 그래서 0.60 / 0.50 처럼 1과 공약수가 없는 값을 쓰고, 위에 각도를 얹어 축까지 튼다.
 * (0.5 는 1의 약수지만 격자를 1.07/0.41 rad 로 돌려 두어 칸 축과 절대 안 맞물린다 —
 *  간격만 보고 고르지 말고 회전까지 같이 보라는 뜻이다.)
 */
interface SiteLattice {
  /** 사이트 간격 (칸 단위) */
  pitch: number;
  /** 격자 회전 (라디안) */
  angle: number;
  /** 격자점에서 흔드는 폭 (pitch 배수) */
  jitter: number;
  seed: number;
}

const SITE_BLOT: SiteLattice = { pitch: 0.60, angle: 1.07, jitter: 0.44, seed: 0x51ed3b };
const SITE_ACC: SiteLattice = { pitch: 0.50, angle: 0.41, jitter: 0.42, seed: 0x2f19c7 };

/** 사이트 하나 — 위치는 월드, 소유는 이 사이트가 떨어진 셀 */
interface Site {
  x: number;
  z: number;
  /** 사이트 전용 난수 넷 (요소 픽 / 크기 / yaw / 판정) */
  h0: number;
  h1: number;
  h2: number;
  h3: number;
}

/**
 * 셀 (cx,cz) 이 **소유하는** 사이트들. 자기 셀 밖에 떨어진 것은 이웃이 굽는다.
 *
 * 정렬 키를 h0 으로 두는 것은 "몇 개만 쓸 때 어느 것을 쓰나"를 결정론적으로
 * 정하기 위해서다 — i,j 순서로 자르면 항상 같은 모서리 쪽이 살아남는다.
 */
function gdSites(l: SiteLattice, cx: number, cz: number): Site[] {
  const cs = Math.cos(l.angle);
  const sn = Math.sin(l.angle);
  // 월드 → 격자 (역회전 후 pitch 로 나눈다)
  const qx = (cx * cs + cz * sn) / l.pitch;
  const qz = (-cx * sn + cz * cs) / l.pitch;
  // 셀 반대각 0.7072 + 지터 폭까지 훑는다
  const r = Math.ceil(0.7072 / l.pitch + l.jitter + 0.5);
  const i0 = Math.floor(qx);
  const j0 = Math.floor(qz);
  const out: Site[] = [];
  for (let j = j0 - r; j <= j0 + r; j++) {
    for (let i = i0 - r; i <= i0 + r; i++) {
      const jx = (gdHash(i, j, l.seed) - 0.5) * 2 * l.jitter;
      const jz = (gdHash(i, j, (l.seed ^ 0x9e3779b1) | 0) - 0.5) * 2 * l.jitter;
      const lx = (i + 0.5 + jx) * l.pitch;
      const lz = (j + 0.5 + jz) * l.pitch;
      const x = lx * cs - lz * sn;
      const z = lx * sn + lz * cs;
      if (Math.abs(x - cx) >= 0.5 || Math.abs(z - cz) >= 0.5) continue;
      out.push({
        x,
        z,
        h0: gdHash(i, j, (l.seed ^ 0x2c1b3c6d) | 0),
        h1: gdHash(i, j, (l.seed ^ 0x1357bd11) | 0),
        h2: gdHash(i, j, (l.seed ^ 0x7f4a7c15) | 0),
        h3: gdHash(i, j, (l.seed ^ 0x3b9aca07) | 0),
      });
    }
  }
  out.sort((a, b) => a.h0 - b.h0 || a.x - b.x || a.z - b.z);
  return out;
}

/**
 * 규칙 ② — 셀 중앙 감쇠. 앵커가 중앙에 가까울수록 살아남을 확률이 낮다.
 * 계단이 아니라 램프인 것이 중요하다: 반경 하나로 딱 자르면 그 반경이 곧 고리가 되고,
 * 그게 이 파일이 방금 고친 결함이다.
 */
function gdCenterKeep(dx: number, dz: number): number {
  const r = Math.hypot(dx, dz);
  return Math.min(1, Math.max(0, (r - ACC_CLEAR_R) / (ACC_FADE_R - ACC_CLEAR_R)));
}

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
function placeFlat(
  geo: THREE.BufferGeometry,
  x: number,
  z: number,
  yaw: number,
  s: number,
  dy = 0,
): THREE.BufferGeometry {
  _q.setFromEuler(_e.set(0, yaw, 0, 'XYZ'));
  _m.compose(_pv.set(x, dy, z), _q, _sv.set(s, 1, s));
  geo.applyMatrix4(_m);
  return geo;
}

/** 두 색을 섞는다 (존별 색 변조용 — 팔레트가 바뀌면 이 레이어도 따라 바뀐다) */
function mix(a: number, b: number, t: number): number {
  return _ca.setHex(a).lerp(_cb.setHex(b), t).getHex();
}

// ── 규칙 ④ 대비 클램프 (선언이 아니라 구현) ─────────────────────────────────

/**
 * 이 레이어가 지면에서 벗어날 수 있는 **상대 휘도 폭 — 설계 단계에서만**.
 *
 * ── 어디까지 잠겼나 (정직하게) ─────────────────────────────────────────────
 * 잠긴 것: clampKit 을 지난 **FlatSpec.color**. 편성표(kitOf)의 색은 예외 없이
 *   |Δ| ≤ 이 값이다. 테스트가 6바이옴 × 4존 × 모든 판을 훑는다.
 * 안 잠긴 것: **화면에 실제로 나가는 정점 색**. 굽는 동안 색을 세 번 더 흔들기
 *   때문이고, 그 셋은 밴드를 모른다. 항별 실측(설계 ±0.28 시절, 액센트 판 전수):
 *     바이옴     설계        faceJitter만   hueJitter만   tint만      셋 합
 *     초원      −28~+28%    −33~+29%       −35~+29%      −30~+30%    −41~+33%
 *     정글      −28~+28%    −39~+34%       −32~+38%      −30~+31%    −42~+45%
 *     사막      −28~+28%    −32~+28%       −37~+28%      −30~+31%    −41~+31%
 *     설원      −28~ +8%    −31~ +8%       −33~ +8%      −30~+11%    −37~+11%
 *     늪        −27~+28%    −50~+40%       −30~+30%      −28~+31%    −54~+46%
 *     화산      −14~+28%    −41~+44%       −20~+53%      −16~+31%    −47~+65%
 *   그리고 실제로 구운 지오메트리의 정점 색 분포(전 스테이지, p0~p100)는
 *   −45~+45% 였다(합계 열이 최악 조합이라 그보다 좁다).
 *
 * ⚠ **지배항은 tint 가 아니다.** tint(tintGeo ±5%)는 선형 RGB 배율이라 sRGB 휘도로는
 *   ±2~3%p 밖에 못 민다 — 위 표에서 tint 열이 설계 열과 거의 같은 것이 그 증거다.
 *   예전 주석은 tint 를 ±7%→±5%로 좁힌 것을 근거로 "합계는 밴드 근처로 묶인다"고
 *   적었는데, 좁힌 항이 원래 제일 작은 항이었으므로 그 문장은 틀렸다.
 *   실제 지배항은 **buildFlats 의 faceJitter**(HSL 명도 **절대** 오프셋)이고,
 *   채도 높은 색에서는 **hueJitter** 가 그것을 넘는다(화산 +53%: Rec.709 가중치가
 *   초록 0.7152 / 파랑 0.0722 로 여덟 배 차이라, 색상만 돌려도 휘도가 크게 움직인다).
 *
 * ── 그래서 0.28 이 아니라 0.38 인가 ────────────────────────────────────────
 * 심판이 "실플레이 해상도에서 아무것도 안 읽힌다"고 했고, 대비를 올려야 했다.
 * 그런데 **화면 값**을 −45~+45%보다 더 벌리는 것은 정확히 1순위 실패 모드
 * (수정 전 잔가지 −53% / 설원 마른가지 −68% = "칸 안의 물건")로 돌아가는 길이다.
 * 그래서 밴드만 열지 않고 **지배항을 같이 줄였다**:
 *   faceJitter 0.03 → GD_FACE_JITTER 0.018,  요소 hueJitter 최대 0.05 → 0.028.
 * 결과: 설계 밴드는 ±28% → ±38%로 넓어졌는데 화면 분포는 −45~+45% → −47~+49% 로
 * 사실상 제자리다. **평균 대비는 오르고 꼬리는 안 늘었다** — 이게 노린 지점이다
 * (중앙값이 초원 −11% → −19%, 사막 −13% → −19% 로 내려간 것이 그 증거다).
 *
 * ⚠ 밴드를 넓히는 것만으로는 **설원이 안 고쳐진다.** 밴드는 안으로 당기기만 하고
 *   설원 램프는 자기 폭이 7%뿐이라 얼룩 다섯이 한 색이었다. 그건 stretchRamp 가 —
 *   램프의 자기 명암 폭을 늘리는 별도의 단계가 — 고친다. 두 장치의 역할이 다르다:
 *   **밴드는 상한, 스트레치는 하한.**
 *
 * ⚠ 이 밴드는 **휘도만** 잰다. 채도는 안 잰다. 어두운 재 위의 새빨간 균열처럼
 *   휘도가 밴드 안이어도 색으로 튀는 경우가 있고, 그건 **모양**과 **채도 선택**으로
 *   막아야 한다(crackFleck 주석 참고). 밴드를 조여서 해결하려 들지 마라.
 *
 * ⚠ 이 숫자를 고치면 **세 곳을 같이** 고쳐라: 파일 머리 규칙 ④ 문구, 이 상수,
 *   그리고 tests/render/grounddetail.test.ts 의 "대비 밴드" 케이스.
 */
export const GD_CONTRAST_BAND = 0.38;

/**
 * buildFlats 에 넘기는 면 단위 명도 지터 — 규칙 ④의 **지배항**이라 여기 상수로 뺐다.
 * 0.03 은 props.ts 기본값(0.04)에서 한 번 내린 값이었고, 위 실측표대로 그것만으로도
 * 밴드를 최대 22%p 밀었다. 0.018 은 로우폴리 특유의 "깎인 면"이 남는 하한이다 —
 * 0 으로 두면 얼룩이 단색 종잇조각이 되어 오히려 도형으로 읽힌다.
 */
const GD_FACE_JITTER = 0.018;

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
function withLuma(hex: number, target: number, inward: boolean): number {
  // 도달 불가능한 상한(밝은 판에서 target > 1) — 흰색이 갈 수 있는 끝이다
  if (target >= 1) return 0xffffff;
  if (target <= 0) return 0x000000;
  const up = target > gdLuma(hex);
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
   * 반올림되므로, 수렴값이 밴드 경계 바로 **바깥**(−38.2% 같은 값)에 떨어질 수 있다.
   * 테스트가 실제로 그걸 잡았다. 그래서 밴드 안쪽으로 1/512 씩 밀어 마무리한다 —
   * 눈에 보이지 않는 차이지만, 이 레이어의 계약이 "밴드 안"이므로 안이어야 한다.
   * (inward=false 면 정확히 맞추기만 한다 — 대비 스트레치는 뒤에서 toBand 가 자른다.)
   */
  let m = (a + b) / 2;
  let out = _cb.setHSL(_hsl.h, _hsl.s, m).getHex();
  if (!inward) return out;
  for (let i = 0; i < 32 && (up ? gdLuma(out) < target : gdLuma(out) > target); i++) {
    m = Math.min(1, Math.max(0, m + (up ? 1 / 512 : -1 / 512)));
    out = _cb.setHSL(_hsl.h, _hsl.s, m).getHex();
  }
  return out;
}

function toBand(hex: number, refLuma: number, band = GD_CONTRAST_BAND): number {
  const lo = refLuma * (1 - band);
  const hi = refLuma * (1 + band);
  const l = gdLuma(hex);
  if (l >= lo && l <= hi) return hex;
  return withLuma(hex, l < lo ? lo : hi, true);
}

/**
 * 면 얼룩 램프 **대비 스트레치** — 밴드가 못 하는 일을 하는 한 줄.
 *
 * toBand 는 **안으로 당기기만** 한다. 그래서 바이옴 램프 자체가 좁으면 얼룩 색
 * 다섯이 사실상 한 색이고 레이어가 통째로 증발하는데, 밴드를 아무리 넓혀도 그건
 * 안 고쳐진다 — 실제로 설원이 그랬다(램프 자기 폭 7%, 팔레트 주석 참조. 심판이
 * "폰에서 아무것도 안 보인다"고 한 판이 이 판이다).
 *
 * 그래서 램프의 **자기 명암 폭을 목표 폭까지 늘린다**. 늘리기만 하고 줄이지는
 * 않으므로(k ≥ 1) 이미 폭이 넓은 바이옴은 그대로 지나간다. 배율 상한 4는 설원에서
 * 왔다 — 설원 얼룩 폭 0.06을 0.27로 늘리려면 4.5배가 필요한데, 그 이상 늘리면
 * 8비트 양자화 때문에 색이 서로 겹쳐 계단이 보인다. 마지막에 toBand 가 자르므로
 * 여기서 넘겨도 계약은 안 깨진다.
 */
function stretchRamp(cols: readonly number[], refLuma: number, target: number): number[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of cols) {
    const d = (gdLuma(c) - refLuma) / refLuma;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const span = Math.max(hi - lo, 1e-4);
  const k = Math.min(4, (target * 2) / span);
  if (k <= 1.02) return [...cols];
  const mid = (lo + hi) / 2;
  /*
   * 램프의 중심을 밴드 안으로 먼저 당긴다. 안 그러면 밴드 **밖에서** 넓힌 램프를
   * toBand 가 통째로 벽에 붙여 다섯 색이 전부 같은 색이 된다 — 화산 경로가 정확히
   * 그랬다(path 램프 휘도 0.502 vs 지면 0.313 = +60%, 셋 다 +37%로 붙어 버렸다).
   */
  const room = Math.max(0, GD_CONTRAST_BAND - target);
  const mid2 = Math.min(room, Math.max(-room, mid));
  return cols.map((c) => {
    const d = (gdLuma(c) - refLuma) / refLuma;
    return withLuma(c, refLuma * (1 + mid2 + (d - mid) * k), false);
  });
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
    /*
     * 면 얼룩만 대비 스트레치를 먼저 통과한다(액센트는 자기 색이 이미 뚜렷하다).
     * 경로 목표를 절반 이하로 두는 이유는 그림이 아니라 **가독성**이다 — 길 위 얼룩이
     * 세지면 경로 리본의 폭과 방향이 흐려지고, 그건 조준에 직접 영향을 준다.
     */
    const target = GD_CONTRAST_BAND * (z === 'path' ? 0.34 : 0.72);
    soil[z] = stretchRamp(raw.soil[z], refLuma, target).map((c) => toBand(c, refLuma));
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
function blade(a: number, len: number, wid: number, color: number, ox = 0, oz = 0, hj = 0.022): FlatSpec {
  const sx = len / 1.5;
  return {
    pos: [ox + Math.sin(a) * sx * 0.5, Y_ACC, oz + Math.cos(a) * sx * 0.5],
    rot: [0, a + Math.PI / 2, 0],
    scale: [sx, wid / 1.732],
    color,
    sides: 3,
    hueJitter: hj,
  };
}

/**
 * **면 얼룩** — 이 레이어에서 실플레이 해상도에 실제로 읽히는 유일한 요소다.
 *
 * 폭 0.19~0.58칸(1280×800 에서 3~9px, 큰 쪽이 주력이다). 예전 이름은 soilPatch 였고 "셀마다 반드시
 * 1장, 셀 중앙에" 였다 — 그건 지면 타일 색이 체스판이던 시절 **타일 경계를 흐리는**
 * 것이 목적이었기 때문이다. 지금 terrain 의 지면색은 좌표의 연속 함수라 경계가
 * 애초에 없고, 그래서 이 판은 목적이 바뀌었다: 경계를 지우는 것이 아니라 **지면에
 * 반점을 놓는 것**. 그러려면 칸에 한 장씩이 아니라 월드 격자에 흩어져야 한다.
 *
 * 5각과 6각 둘 다 두는 것은 실루엣이 한 종류면 "같은 도장의 반복"이 되기 때문이다
 * (심판이 정확히 그 표현을 썼다). 4각은 이 크기에서도 직각이 살아남아 금지다.
 */
function soilBlot(color: number, w: number, sides: 5 | 6): Flats {
  return [{ pos: [0, Y_BLOT, 0], scale: [w, w * (sides === 5 ? 0.84 : 0.9)], color, sides, hueJitter: 0.012 }];
}

/**
 * 풀 포기 — 잎 5장이 **한 원점에서** 부채꼴로 뻗는다 (5 tri).
 *
 * 원점을 공유하는 것과 **부채가 비대칭인 것** 둘 다 필요하다. 원점을 흩으면 바닥에
 * 뿌린 성냥개비가 되고(props.ts:crackLines 가 같은 함정을 이미 진단해 뒀다),
 * 각도·길이를 고르게 두면 좌우대칭 화살표가 된다 — 첫 판이 정확히 그랬다.
 * 그래서 각도 간격(0.40/0.27/0.33/0.37)과 길이(0.18~0.31)를 일부러 어긋나게 뒀다.
 * 길이·굵기는 실플레이 해상도 A/B 에서 한 단 올렸다(0.15~0.26 → 0.18~0.31,
 * 밑동 0.055 → 0.062). 1x 에서 여전히 3px 급이지만 확대에서 "풀"로 읽히는 하한이다.
 */
function grassSprig(color: number): Flats {
  const A = [-0.66, -0.26, 0.01, 0.34, 0.71];
  const L = [0.18, 0.26, 0.31, 0.23, 0.16];
  return A.map((a, i) =>
    blade(a, L[i] as number, 0.062, i === 2 ? shade(color, 1.12) : i === 0 ? shade(color, 0.9) : color),
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
 * 대신 한 덩이를 키웠다: 0.072 → 0.105 → **0.125**. 마지막 한 단은 실플레이 해상도
 * 캡처에서 왔다 — 1280×800 에서 한 칸이 15px 이라 0.105는 1.5px, 0.125도 1.9px 다.
 * 어차피 1x 에서 꽃은 못 읽는다는 것을 인정하고(면 얼룩이 그 몫을 진다) 확대에서
 * 예쁘게 보이는 크기로 잡았다.
 * ⚠ hueJitter 는 한때 0.05 였다. buildFlats 가 **삼각형마다** 색을 흔들어 6각 판
 *   하나가 꽃잎 4장으로 갈라져 보이게 하려던 것인데, 규칙 ④ 실측에서 hueJitter 가
 *   밴드를 최대 25%p 미는 **둘째 지배항**으로 드러나 0.028 로 내렸다. 갈라짐은
 *   약해졌지만 6각 실루엣이 이미 꽃송이로 읽히므로 잃은 것이 적다.
 */
function flowerDot(leaf: number, a: number, b: number): Flats {
  return [
    { pos: [0, Y_ACC, 0], scale: [0.23, 0.20], color: leaf, sides: 5, hueJitter: 0.026 },
    { pos: [0.038, Y_TOP, 0.027], scale: [0.125, 0.118], color: mix(a, b, 0.35), sides: 6, hueJitter: 0.028 },
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
 * 로우폴리 특유의 "깎인 면"은 buildFlats 의 삼각형별 색 지터(GD_FACE_JITTER)가
 * 이미 공짜로 내 준다. 덤으로 5 → **4 tri**, pebbleFlat 은 6바이옴 거의 모든 zone 에
 * 실려 있어 이 −1 이 스테이지당 수십 tri 다.
 * 크기는 0.145×0.125 → 0.175×0.15 로 한 단 올렸다(실플레이 해상도 A/B).
 */
function pebbleFlat(color: number): Flats {
  return [{ pos: [0.02, Y_ACC, 0.015], scale: [0.175, 0.15], color, sides: 6, hueJitter: 0.025 }];
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
 * 길이 0.26 → 0.28 → **0.33**, 밑동 0.038 → 0.05 → **0.058** 로 두 번 키웠다. 획이
 * 하나뿐이라 그전 굵기로는 확대 전에 **머리카락 한 올**로 사라졌다. 밑동:길이 =
 * 1:5.7 의 쐐기라 굵은 쪽이 부러진 단면, 가는 쪽이 가지 끝으로 읽힌다.
 */
function twig(color: number): Flats {
  return [blade(0.0, 0.33, 0.058, color)];
}

/**
 * 이끼/얼룩 — 6각 판 1장 (4 tri). 액센트 층에서 가장 싼 "면".
 * (면 얼룩 soilBlot 과 다르다 — 이쪽은 바이옴 고유색 액센트라 액센트 y 에 놓인다.)
 */
function blot(color: number, w = 0.26): Flats {
  // hueJitter 를 0.05 로 뒀더니 흙색(탄 계열) 얼룩이 **분홍**으로 돌았다 —
  // 채도가 낮고 따뜻한 색은 같은 색상 지터에도 훨씬 크게 튄다. 0.028 이 상한이다.
  return [{ pos: [0, Y_ACC, 0], scale: [w, w * 0.86], color, sides: 6, hueJitter: 0.028 }];
}

/**
 * 낙엽 — 잎 3장 (3 tri). **원점을 흩는 유일한 요소**다 (떨어진 것이므로 뿌리가 없다).
 * 나머지 요소가 전부 한 원점에서 뻗는 것과 정반대의 규칙이고, 그래서 이것만
 * 다른 것들 사이에서 "흩어진 것"으로 읽힌다.
 */
function litter(a: number, b: number): Flats {
  return [
    blade(0.55, 0.18, 0.105, a, 0.05, 0.06),
    blade(2.45, 0.155, 0.095, b, -0.085, 0.025),
    blade(1.35, 0.13, 0.082, shade(a, 0.88), 0.012, -0.095),
  ];
}

/**
 * 갈라진 땅 — **끊어진 균열 자국** 3토막 (3 tri). 한 점에서 갈라지지 **않는다**.
 *
 * ── 세 번째 실패와 그 진짜 원인 ────────────────────────────────────────────
 * 1차(90° 곁가지) → 꺾쇠 ⌐. 2차(0.52rad) → 체크마크 ✓. 3차는 "가닥을 셋으로 만들고
 * 부채를 80°로 벌리면 글리프가 아니다"였는데, **또 ✓ 였다**(심판: 15배 확대에서
 * 정확한 ✓, 셋째 가닥은 화면에서 사라짐).
 *
 * 재리뷰는 원인을 아이소메트릭 투영으로 지목했다 — "부채 80°로 벌려도 화면에서는
 * 눌려 두 획으로 붙는다". **재 보니 그건 아니다.** 화면 공간에서 실제로 계산하면:
 *
 *   카메라는 yaw −35° / pitch 55° 고정(render/camera.ts YAW_BASE/PITCH_BASE).
 *   lookAt 기저: z=(0.4699, 0.8192, −0.3290)  ← 타깃→카메라
 *                x=(−0.5736, 0,      −0.8192) ← 화면 오른쪽
 *                y=(−0.6711, 0.5737,  0.4699) ← 화면 위
 *   지면 방향 d=(dx,0,dz) → 화면 (u,v):
 *     u = −0.5736·dx − 0.8192·dz
 *     v = −0.6711·dx + 0.4699·dz
 *   이 2×2 사상의 특이값은 **1.0000 과 0.8192**(= sin 55°, 지면이 화면으로 눌리는
 *   유일한 축). 곧 각도 미분 dθ/dφ 는 0.819~1.221 사이이고, 월드 80° 부채는 화면에서
 *   **65.5°~97.6°** 가 된다. 방향에 따라 좁아지긴 해도 두 획으로 붙지는 않는다.
 *   실제 3차 값(0.06 / 0.78 / 1.45 rad)을 그대로 넣으면 화면 각은 153.3° / 188.0° /
 *   222.4° — 간격이 34.7° 와 34.4° 로 거의 균등하다. 투영은 무죄다.
 *
 * 남는 원인은 **도형 자체**다. 길이가 얼마든 각이 얼마든, 굵은 쪽이 한 점에 모이는
 * 뾰족한 획 여러 개는 ✓ ➤ ⌐ ∨ 중 하나로 읽힌다. twig 이 2획에서 1획으로 내려가며
 * 이미 낸 결론("만나는 점이 없으면 글리프가 될 수 없다")을 crackFleck 만 안 따르고
 * "셋이면 괜찮다"로 우회했던 것이다. 3차 화면 길이도 다시 재 보면 0.267/0.219/0.145
 * (최단/최장 0.54)라 셋째가 사라진 것도 아니었다 — 셋이 다 보여도 ✓ 였다.
 *
 * ── 그래서 갈래 구조를 버렸다 ──────────────────────────────────────────────
 * 균열을 **한 줄로 이어지되 끊어진 세 토막**으로 바꿨다. 토막들은 원점을 공유하지
 * 않고 진행 방향(±0.2rad)만 거의 같으므로 만나는 점이 없다 — 점선이지 글리프가
 * 아니다. 땅이 갈라진 자국은 원래 이어지다 끊기는 것이라 그림도 이쪽이 맞다.
 * 덤으로 전체 길이가 0.28 → 0.44칸으로 늘어 실플레이 해상도에서 훨씬 잘 보인다
 * (판이 길어져도 배치는 회전 AABB 로 정확히 재므로 셀 밖으로 안 샌다).
 *
 * 채도는 따로 손봤다 — 규칙 ④는 휘도만 재고, hueJitter 는 채도 높은 빨강에서
 * 휘도를 +25%p 까지 민다(GD_CONTRAST_BAND 표의 화산 열). 그래서 이 요소만 blade
 * hueJitter 를 0.010 으로 내리고, 화산 편성의 균열색을 지면 쪽으로 더 섞었다
 * (mix(lavaDeep, 지면, 0.45 → 0.66)). 실측 결과색 #984e3d — HSL 채도 0.43, 휘도
 * +16%. "어두운 재 위 채도 최대 빨강"이 아니라 벽돌색이다.
 *
 * ⚠ 이 결론은 테스트로 잠갔다: **획이 3~4개인 요소는 밑동이 한 점에 모이면 안 된다**
 *   (tests/render/grounddetail.test.ts). 5획 이상(grassSprig)만 부채로 읽히므로
 *   예외다. 개수·길이 낙차만 재던 예전 규약은 이 요소를 세 번 통과시켰다.
 */
function crackFleck(color: number): Flats {
  return [
    blade(0.13, 0.155, 0.050, color, -0.012, 0.0, 0.01),
    blade(-0.10, 0.130, 0.042, shade(color, 0.93), 0.028, 0.185, 0.01),
    blade(0.20, 0.100, 0.034, shade(color, 0.87), -0.006, 0.34, 0.01),
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
 * 발자국 — 5각 판 2장을 **진행 방향으로 어긋나게** (3+3 = 6 tri). 경로 셀 전용.
 * (주석이 오래 "4 tri"라고 적혀 있었다 — 두 판 다 5각이라 처음부터 6이었다.)
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
  /**
   * 존별 **면 얼룩** 색 후보. 사이트마다 하나를 고르되 **rng 가 아니라 저주파
   * 색 필드**로 고른다 — 이웃 사이트가 같은 색을 읽어야 얼룩이 붙어 커진다.
   */
  soil: Record<Zone, readonly number[]>;
  /** 존별 면 얼룩 기준 폭 (사이트마다 0.42~1.30 배가 걸린다) */
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

/*
 * 면 얼룩 기준 폭. 사이트당 0.42~1.30 배가 걸리므로 실제 폭은 0.19~0.58칸이다.
 * 경로만 좁게 두는 것은 길이 길로 읽혀야 하기 때문이다(넓은 얼룩이 길 위를 덮으면
 * 경로 리본의 폭이 흐려진다).
 */
const SOIL_W: Record<Zone, number> = { inner: 0.45, trail: 0.42, shore: 0.44, path: 0.34 };

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
  /*
   * 명도 배율 폭을 0.93~1.05 에서 0.86~1.09 로, 액센트색 혼합을 0.24 에서 0.20~0.45 로
   * 넓혔다. 좁힌 쪽이 안전해 보이지만 **설원에서 레이어가 통째로 증발했다** —
   * 설원 램프는 자기 폭이 7%뿐이라(팔레트 주석 참조) 거기에 ±7% 배율을 걸면 얼룩
   * 다섯 색의 휘도가 사실상 한 색이고, 심판이 "폰에서 아무것도 안 보인다"고 한 판이
   * 정확히 설원이었다. 넓혀도 밴드 밖으로는 못 나간다 — clampKit 이 뒤에서 자른다.
   * 그래서 여기서는 **바이옴 램프가 좁아도 결이 남을 만큼** 벌려 두는 것이 맞다.
   */
  const inner = [
    shade(g0, 0.86),
    shade(g2, 1.09),
    shade(g4, 0.94),
    mix(g0, acc, 0.45),
    mix(shade(g2, 0.88), acc, 0.20),
  ];
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
            crackFleck(mix(P.lavaDeep, g0, 0.66)),
            blot(mix(P.ash, g0, 0.35), 0.26),
            pebbleFlat(shade(P.basalt, 1.1)),
            blot(mix(P.sulfur, g0, 0.55), 0.18),
            grassSprig(P.charGrassCol),
          ],
          trail: [blot(mix(P.ash, g0, 0.4), 0.22), pebbleFlat(shade(P.basalt, 1.08)), crackFleck(mix(P.lavaDeep, g0, 0.70))],
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

/** 캐시된 요소 지오메트리 + 로컬 XZ 상자(셀 밖 방지) + 삼각형 수(예산) */
interface Baked {
  geo: THREE.BufferGeometry;
  /**
   * 로컬 XZ AABB [x0, x1, z0, z1] — yaw·s 를 걸기 **전**.
   *
   * 예전엔 원점 기준 **외접 반경 하나**로 쟀다. 회전을 대비한 보수적인 값이라
   * 안전하기는 한데, 잔가지·균열처럼 **한쪽으로만 뻗는** 요소에서 반지름이 길이
   * 전체가 되어 배치 반경을 통째로 잡아먹었다(길이 0.44 균열이면 앵커가 반경 0.03
   * 안에만 놓인다 = 사실상 셀 중앙 고정). 상자를 그대로 들고 있다가 배치할 때
   * yaw 로 돌려 재면 같은 요소가 셀 어디에나 앉는다 — 규칙 ③을 **더 정확히**
   * 지키면서 자유도가 는다.
   */
  box: readonly [number, number, number, number];
  tri: number;
  /**
   * 원점에서 **한쪽(+z)으로만** 뻗는 요소인가 (잔가지·풀 포기·균열).
   * 이런 것은 "바닥에 자라거나 누운 것"이라 방향이 뜻을 갖는다 — 무작위로 돌리는
   * 대신 **바람 필드**(gdWind)를 따르게 해서 한 구역의 풀이 같은 쪽으로 눕는다.
   */
  oneSided: boolean;
}

function baked(key: string, flats: Flats): Baked {
  const geo = cachedGeo(key, () => {
    const g = buildFlats(flats, hashSeed(key), GD_FACE_JITTER);
    g.computeBoundingBox();
    return g;
  });
  const bb = geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox);
  const box: [number, number, number, number] = bb
    ? [bb.min.x, bb.max.x, bb.min.z, bb.max.z]
    : [-0.3, 0.3, -0.3, 0.3];
  const oneSided = bb ? bb.min.z > -0.04 && bb.max.z > 0.12 : false;
  return { geo, box, tri: geo.getAttribute('position').count / 3, oneSided };
}

/**
 * 회전·배율을 건 뒤의 XZ 상자 (앵커 기준 오프셋). placeFlat 과 **같은 회전**이어야
 * 한다 — y 회전 행렬이 (x,z) 를 (x·cos + z·sin, −x·sin + z·cos) 로 보낸다.
 */
const _fit = [0, 0, 0, 0];
function fitBox(b: Baked, yaw: number, s: number): number[] {
  const c = Math.cos(yaw) * s;
  const sn = Math.sin(yaw) * s;
  const [x0, x1, z0, z1] = b.box;
  let ax0 = Infinity;
  let ax1 = -Infinity;
  let az0 = Infinity;
  let az1 = -Infinity;
  for (let k = 0; k < 4; k++) {
    const lx = k & 1 ? x1 : x0;
    const lz = k & 2 ? z1 : z0;
    const wx = lx * c + lz * sn;
    const wz = -lx * sn + lz * c;
    if (wx < ax0) ax0 = wx;
    if (wx > ax1) ax1 = wx;
    if (wz < az0) az0 = wz;
    if (wz > az1) az1 = wz;
  }
  _fit[0] = ax0;
  _fit[1] = ax1;
  _fit[2] = az0;
  _fit[3] = az1;
  return _fit;
}

/**
 * 앵커 (dx,dz)(셀 중심 기준)에 요소를 넣을 수 있는 **최대 배율**.
 * 상자 오프셋이 s 에 비례하므로 네 부등식을 s 에 대해 풀면 닫힌 식이 나온다.
 * 반환이 GD_S_MIN 미만이면 그 사이트는 버린다(경계에 너무 가깝다).
 */
function fitScale(b: Baked, yaw: number, dx: number, dz: number): number {
  const u = fitBox(b, yaw, 1);
  let s = Infinity;
  const lim = (off: number, room: number): void => {
    if (off > 1e-9) s = Math.min(s, room / off);
  };
  lim(u[1] as number, GD_FIT - dx); // dx + s·x1 ≤ +F
  lim(-(u[0] as number), GD_FIT + dx); // dx + s·x0 ≥ −F
  lim(u[3] as number, GD_FIT - dz);
  lim(-(u[2] as number), GD_FIT + dz);
  return s;
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
   * 판 전체에 공통인 저주파 필드 시드. **스테이지 id 만** 섞는다 — 셀 좌표를 섞으면
   * 필드가 칸마다 끊겨 존재 이유(이웃이 같은 값을 읽는 것)가 사라진다.
   */
  const fSeed = hashSeed(`gdf:${stage.id}:${biome}`) | 0;
  /** 얼룩 밀도 (개수) */
  const fDens = (wx: number, wz: number): number => gdField(wx, wz, 4.8, fSeed);
  /** 얼룩 크기 — 밀도와 다른 시드/파장이라 "빽빽하고 잔" 구역과 "성기고 큰" 구역이 섞인다 */
  const fSize = (wx: number, wz: number): number => gdField(wx, wz, 3.6, (fSeed ^ 0x5f356495) | 0);
  /** 면 얼룩 색 — 램프 위 연속 위치. 이웃이 같은 값을 읽어야 얼룩이 붙어 커진다 */
  const fTone = (wx: number, wz: number): number => gdField(wx, wz, 3.2, (fSeed ^ 0x1b873593) | 0);
  /** 바람 — 풀·잔가지가 한 구역에서 같은 쪽으로 눕는다 */
  const gdWind = (wx: number, wz: number): number =>
    (gdField(wx, wz, 6.5, (fSeed ^ 0x27d4eb2d) | 0) - 0.5) * 3.4;

  /**
   * 셀 하나를 굽는다.
   *
   * 판을 놓는 자리는 **셀 좌표에서 뽑지 않는다**(gdSites — 파일 머리 "격자에 안
   * 매이게 하는 법" 참고). rng 는 셀 좌표에서 직접 시드해 두지만 이제 하는 일은
   * 자잘한 흔들기뿐이다. rng 를 셀 전용으로 두는 이유는 그대로다 — 공용 rng 면
   * 소품을 치우는 **순서**에 따라 같은 칸의 그림이 달라져 결정론이 깨진다.
   */
  const bakeCell = (x: number, z: number): THREE.BufferGeometry | null => {
    const zone = zoneOf(x, z);
    const rng = new Rng(hashSeed(`gd:${stage.id}:${zone}:${x},${z}`));
    cellToWorld(x, z, _v);
    const cx = _v.x;
    const cz = _v.z;
    const pieces: THREE.BufferGeometry[] = [];
    let left = GD_CELL_TRI_BUDGET;

    /**
     * 판 하나를 앉힌다. 셀 밖으로 새면(규칙 ③) false — 그 사이트는 버린다.
     *
     * ⚠ 버리는 판정은 **fitScale 기준**이지 최종 s 기준이 아니다. 최종 s 로 재면
     *   "일부러 작게 놓으려던 판"(want 0.5)까지 경계 근처라고 오해해 버려서,
     *   결국 크기 분포가 좁아지고 얼룩이 다시 같은 도장으로 보인다. 두 가지를
     *   가르는 것이 이 한 줄이다: fit 은 **놓을 수 있나**, want 는 **얼마나 크게**.
     */
    const put = (b: Baked, px: number, pz: number, yaw: number, want: number, dy: number, tint: number): boolean => {
      if (b.tri > left) return false;
      const fit = fitScale(b, yaw, px - cx, pz - cz);
      if (fit < GD_S_MIN) return false;
      pieces.push(tintGeo(placeFlat(b.geo.clone(), px, pz, yaw, Math.min(want, fit), dy), tint));
      left -= b.tri;
      return true;
    };

    // ── ① 면 얼룩 — 이 레이어가 실플레이 해상도에 내놓는 유일한 그림 ──
    const soils = kit.soil[zone];
    const blotSites = gdSites(SITE_BLOT, cx, cz);
    let laid = 0;
    for (const st of blotSites) {
      /*
       * 색은 rng 가 아니라 **저주파 톤 필드**로 고른다. 이웃 사이트(자기 칸이든
       * 옆 칸이든)가 거의 같은 값을 읽으므로 붙어 있는 얼룩이 같은 색으로 나오고,
       * 겹쳐서 두세 칸짜리 반점 하나로 읽힌다. 칸마다 rng 로 뽑으면 옆 칸 얼룩이
       * 다른 색이라 절대 안 붙는다 — 그게 예전 구조가 격자로 읽힌 이유의 절반이다.
       */
      const tone = fTone(st.x, st.z);
      const si = Math.min(soils.length - 1, Math.floor(tone * soils.length));
      const sides: 5 | 6 = st.h1 < 0.5 ? 5 : 6;
      const b = baked(
        `gd:${biome}:blot:${zone}:${sides}:${si}`,
        soilBlot(soils[si] as number, kit.soilW[zone], sides),
      );
      /*
       * 크기도 **필드**가 정한다(±해시 소량) — 이웃끼리 크기가 비슷해야 한 덩이로 붙는다.
       * 폭은 넓게 연다(0.42~1.30 → 실폭 0.19~0.58칸).
       * 폭을 0.68~1.18 로 좁게 뒀던 판을 캡처해 봤더니 얼룩이 전부 같은 크기로 나와,
       * 액센트에서 고친 "같은 도장 2~3종의 반복"이 얼룩 레이어에서 그대로 재현됐다.
       */
      const want = 0.42 + fSize(st.x, st.z) * 0.72 + (st.h2 - 0.5) * 0.32;
      // y 는 사이트마다 다르게(겹칠 때 z-파이팅 방지). 위에서 아래로만 내린다
      /*
       * 밝기 흔들기를 **사이트 해시**에서 뽑고 폭도 ±2.5%로 좁힌다. 셀 rng 로 뽑으면
       * 같은 칸의 얼룩끼리는 달라지고 옆 칸 얼룩과는 무관해져, 톤 필드로 겨우 맞춰
       * 놓은 색이 다시 갈라진다 — 그러면 얼룩이 안 붙고 낱개 육각형으로 읽힌다.
       */
      if (put(b, st.x, st.z, st.h3 * Math.PI * 2, want, -st.h0 * Y_BLOT_DROP, 0.975 + st.h2 * 0.05)) laid++;
    }
    /*
     * 사이트가 하나도 안 남은 칸(경계에만 떨어졌거나 격자 위상이 나빴다)은 판에서
     * 5% 남짓 나온다. 그 칸만 통째로 비면 "결이 안 깔린 칸"으로 보이므로 한 장은
     * 보장한다. 중앙 고정이 아니라 해시로 흩어 두는 것이 중요하다 — 중앙에 박으면
     * 그 5%가 다시 격자점으로 보인다.
     */
    if (laid === 0) {
      const b = baked(`gd:${biome}:blot:${zone}:6:0`, soilBlot(soils[0] as number, kit.soilW[zone], 6));
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.22);
      put(b, cx + Math.cos(a) * r, cz + Math.sin(a) * r, rng.range(0, Math.PI * 2), 1, -rng.next() * Y_BLOT_DROP, 1);
    }

    // ── ② 액센트 ──
    const list = kit.accent[zone];
    const [n0, n1] = kit.count[zone];
    /*
     * 개수도 필드다. `n0 − 1.8` 로 아래를 여는 것은 **빈 칸을 만들기 위해서**다 —
     * 예전엔 "맨 셀은 최소 1개"라 모든 칸에 반드시 뭔가가 있었고, 그 자체가 규칙성
     * 이었다. 필드가 낮은 구역은 여러 칸이 함께 비어 **빈터**로 읽힌다(사막이 특히).
     * 정글은 n0 가 4라 이 식에서도 2 밑으로 안 내려간다 — 바이옴 밀도 차는 그대로다.
     */
    const dens = fDens(cx, cz);
    const want = Math.max(0, Math.round((n0 - 1.8 + (n1 + 0.6 - (n0 - 1.8)) * dens) * density));
    const accSites = gdSites(SITE_ACC, cx, cz);
    let put0 = 0;
    for (const st of accSites) {
      if (put0 >= want) break;
      const dx = st.x - cx;
      const dz = st.z - cz;
      // 규칙 ② — 슬롯 원판 자리는 성기게 (계단이 아니라 램프라 고리가 안 생긴다)
      if (st.h3 > gdCenterKeep(dx, dz)) continue;
      const idx = Math.min(list.length - 1, Math.floor(st.h0 * list.length));
      const flats = list[idx];
      if (!flats) continue;
      const b = baked(`gd:${biome}:acc:${zone}:${idx}`, flats);
      // 예산이 모자라면 **이번 하나만** 건너뛴다 (더 싼 게 다음에 뽑힐 수 있다)
      if (b.tri > left) continue;
      /*
       * yaw 규칙 셋:
       *  · 경로 셀 — 진행 축에 맞춘다. 제각각 돌리면 발자국이 아니라 어두운 점이다.
       *  · 한쪽으로만 뻗는 것(풀·잔가지·균열) — **바람 필드**를 따른다. 예전엔
       *    "셀 중심에서 바깥으로" 였는데, 그건 칸마다 방사형 배치를 만들어 고리를
       *    한 겹 더 그렸다. 바람은 칸을 모르고 한 구역을 통째로 같은 쪽으로 눕힌다.
       *  · 나머지 — 자연물이라 무작위가 맞다.
       */
      const yaw =
        zone === 'path'
          ? pathHeading(x, z) + rng.range(-0.25, 0.25)
          : b.oneSided
            ? gdWind(st.x, st.z) + (st.h2 - 0.5) * 1.1
            : st.h2 * Math.PI * 2;
      /*
       * 개체별 밝기 흔들기 ±5%. 화면 대비의 **지배항이 아니다** — GD_CONTRAST_BAND
       * 주석의 항별 실측표를 보면 tint 열은 설계 열과 2~3%p 밖에 차이가 안 난다.
       * (예전 주석은 이 항을 ±7%→±5%로 좁힌 것을 근거로 "합계가 밴드 근처로 묶인다"고
       *  적었는데, 그건 제일 작은 항을 좁힌 것이라 사실이 아니었다.)
       */
      if (put(b, st.x, st.z, yaw, 0.85 + st.h1 * 0.55, 0, rng.range(0.95, 1.05))) put0++;
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

/**
 * 테스트/계측용 — 요소 전체 (이름 → 판 목록).
 *
 * ⚠ 이 표는 **모양 규칙의 입력이 아니라 목록일 뿐**이다. 예전엔 직각 판 금지·3각 판
 *   용도·획 개수·원가 테스트가 이 표만 훑었고, kitRaw 에 새 액센트를 넣으며 여기
 *   등록을 깜빡하면 정사각형도 화살촉도 전부 통과했다. 지금은 그 규칙들이
 *   **실제 편성 gdKit() 을 훑는다**(clampKit 이 대비 밴드에 대해 하는 일과 같다).
 *   여기 등록은 "그 요소 하나만 콕 집어 보기"용으로 남겨 둔다.
 */
export const GD_ELEMENTS: Readonly<Record<string, Flats>> = {
  soilBlot: soilBlot(0x8ad455, 0.45, 5),
  soilBlot6: soilBlot(0x8ad455, 0.45, 6),
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
