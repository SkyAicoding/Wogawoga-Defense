/**
 * 색 팔레트 + 공유 머티리얼 싱글톤.
 * Crossy Road풍 고채도 로우폴리 — 모든 지오메트리는 버텍스 컬러로 칠하고
 * 머티리얼은 공유한다 (드로우콜/컴파일 절약).
 * Lambert는 flatShading을 지원하지 않으므로 비인덱스 지오메트리 + 면 노멀로 플랫 효과를 낸다.
 */
import * as THREE from 'three';
import type { BiomeId } from '@/data/types';

/**
 * 지면 "결" — 타일 색을 고르는 규칙.
 *
 * 예전엔 타일 색이 `ground` 램프에서 **셀마다 무작위 픽** 하나뿐이었다. 그래서 어느
 * 바이옴이든 그림이 똑같았다 — 색만 다른 체크무늬. 썸네일 6장을 나란히 놓고 보면
 * 바이옴을 가르는 건 색상(hue)이 아니라 **결**이다: 사막은 한 방향으로 흐르는 사구 띠,
 * 설원은 눈 두께에 따른 넓은 명암 얼룩, 화산은 검은 지각에 드문드문 벌어진 균열,
 * 늪은 고인 물 웅덩이. 그 넷을 같은 파라미터 네 개로 표현한 것이 이 구조체다.
 */
export interface GroundGrain {
  /** 저주파 띠(사구/설원 눈두께)의 명도 진폭. 0이면 띠 없음 */
  band: number;
  /** 띠 파장(셀 단위) — 클수록 넓은 띠 */
  bandLen: number;
  /** 띠 진행 방향(라디안, 0 = +x) */
  bandAngle: number;
  /** 타일 단위 명도 지터 폭 (면 단위가 아니다 — 타일 안은 균일해야 한다) */
  jitter: number;
  /** 색상(hue) 지터 폭 */
  hue: number;
  /** 액센트 타일 확률 (0~1) */
  accent: number;
  /** 액센트 타일 색 (균열/웅덩이/덤불 자국) */
  accentColor: number;
}

export interface BiomePalette {
  /** 지상 타일 램프 (셀마다 랜덤 픽) */
  ground: number[];
  /** 경로(흙) 램프 */
  path: number[];
  /** 절벽 [상단, 하단] — 아래로 어두워짐 */
  cliff: [number, number];
  /** 절벽 중간 층리색 — 사암 줄무늬/이끼 띠. 상↔하 단순 보간에 한 겹을 더 끼운다 */
  cliffBand: number;
  /** 물가 모래톱/여울 — 섬 가장자리 상면과 절벽 최상단에 깔리는 밝은 띠 */
  shoreSand: number;
  /** 중간 수심 (예전 단색 물 색) */
  water: number;
  /** 먼 바다 — 이 색으로 어두워지다 fog에 먹힌다 */
  waterDeep: number;
  /** 섬 둘레 얕은 물 링 */
  waterShore: number;
  /** 물가 포말 */
  foam: number;
  fog: number;
  /** 안개 시작/끝 거리 (판 대각선 배수) */
  fogRange: [number, number];
  sky: number;
  /** 환경광 지면 반사색 */
  hemiGround: number;
  /** 태양광 색 */
  sun: number;
  /** 태양광 세기 */
  sunPower: number;
  /** 반구광 세기 */
  hemiPower: number;
  /** 환경 파티클 색 (눈/재/포자, 없으면 0) */
  ambient: number;
  /** 지면 결 */
  grain: GroundGrain;
}

export const BIOMES: Record<BiomeId, BiomePalette> = {
  grassland: {
    ground: [0x8ad455, 0x93dc5e, 0x81cc4d, 0x9ce168, 0x7ac247],
    path: [0xd2a86e, 0xc69a5e, 0xdbb37c],
    cliff: [0xa8845a, 0x513521],
    cliffBand: 0x8b6740,
    shoreSand: 0xe7d5a2,
    water: 0x2b96cf,
    waterDeep: 0x14548c,
    waterShore: 0x6fdcd6,
    foam: 0xe8fbff,
    fog: 0xc6e9f6,
    fogRange: [2.4, 5.2],
    sky: 0x92d7f2,
    hemiGround: 0x8a7a4d,
    sun: 0xfff2d8,
    sunPower: 2.4,
    hemiPower: 1.15,
    ambient: 0,
    // 잔디밭은 "고른 초록 + 드문 맨흙 자국". 띠는 거의 없고 타일 지터가 결을 만든다.
    grain: { band: 0.02, bandLen: 9, bandAngle: 0.6, jitter: 0.03, hue: 0.018, accent: 0.05, accentColor: 0xa8c95e },
  },
  jungle: {
    /*
     * 정글은 **섬이 배경에 녹아 있던** 바이옴이다 (지면 휘도 140 · 물 149 = 4% 차이).
     * 가른 것은 밝기가 아니라 **색상 대비**다: 지면을 순수한 잎초록 쪽으로 몰고
     * 물을 형광 터콰이즈로 올려 초록↔청록으로 갈라 놨다. 밝기만 벌리려고 지면을
     * 더 짙게 내려 본 판도 있었는데, 그러면 소품 그림자가 얹히는 순간 지면이
     * 검게 죽어 버려(캡처 a2-s3) 반대로 한 단 올려 잡았다.
     */
    ground: [0x3f9e52, 0x369046, 0x4bad5e, 0x2d8040, 0x56ba6c],
    path: [0x8f6f46, 0x84643c, 0x9c7c52],
    cliff: [0x5e4a2c, 0x2a2013],
    cliffBand: 0x4e7434,
    shoreSand: 0xd8cf94,
    water: 0x1aa8a8,
    waterDeep: 0x086070,
    waterShore: 0x7ae8d4,
    foam: 0xeafff9,
    fog: 0xa8dcc6,
    fogRange: [1.9, 4.4],
    sky: 0x72c6b1,
    hemiGround: 0x4d6b3a,
    sun: 0xf4ffe2,
    sunPower: 2.1,
    hemiPower: 1.25,
    ambient: 0xd6f2a8,
    // 하층 덤불이 만드는 얼룩 — 액센트가 잦고 짙다.
    grain: { band: 0.03, bandLen: 6, bandAngle: 1.9, jitter: 0.05, hue: 0.025, accent: 0.14, accentColor: 0x2b7a3f },
  },
  desert: {
    ground: [0xf0cf82, 0xe7c274, 0xf9de95, 0xdeb566, 0xd3a659],
    path: [0xc98f4e, 0xbf8546, 0xd49a58],
    cliff: [0xd09456, 0x6d3f1c],
    cliffBand: 0xae6733,
    shoreSand: 0xf7e6b4,
    water: 0x28b4dc,
    waterDeep: 0x0f7cb4,
    waterShore: 0x8ceff0,
    foam: 0xffffff,
    fog: 0xf7e8c8,
    fogRange: [2.6, 6.0],
    sky: 0xf3dfae,
    hemiGround: 0xb08c56,
    sun: 0xfff0c4,
    sunPower: 2.9,
    hemiPower: 1.05,
    ambient: 0xf0d9a0,
    // 사구 — 한 방향으로 흐르는 넓은 띠가 이 바이옴 결의 전부다. 액센트는 갈라진 땅.
    grain: { band: 0.075, bandLen: 5.5, bandAngle: 0.5, jitter: 0.035, hue: 0.012, accent: 0.09, accentColor: 0xc79a55 },
  },
  snow: {
    /*
     * 설원 지면 램프는 휘도 폭이 7%뿐이라 판 전체가 "흰 종이 한 장"이었고 경로조차
     * 안 보였다. 눈은 **두께**로 읽힌다 — 두꺼운 곳은 희고 얇은 곳은 아래 바위가 비쳐
     * 푸르다. 그래서 램프를 흰색~회청색으로 넓히고(폭 약 25%) 결의 띠 진폭을 크게 줬다.
     */
    ground: [0xf9fdff, 0xe9f2f9, 0xd5e5f2, 0xc2d6e9, 0xeff7fd],
    path: [0xa9bccc, 0x99adc1, 0xbccdda],
    cliff: [0x8fa8bf, 0x3e5670],
    cliffBand: 0x6d89a4,
    shoreSand: 0xf4fbff,
    water: 0x46aeae,
    waterDeep: 0x226a74,
    waterShore: 0xa6e8d8,
    foam: 0xffffff,
    fog: 0xdcecf7,
    fogRange: [2.0, 4.6],
    sky: 0xb8dcf0,
    hemiGround: 0x9db4c8,
    sun: 0xeaf4ff,
    sunPower: 2.2,
    hemiPower: 1.3,
    ambient: 0xffffff,
    // 눈 두께 얼룩 — 넓고 부드러운 띠 + 드문 파란 그늘.
    grain: { band: 0.055, bandLen: 7, bandAngle: 2.4, jitter: 0.045, hue: 0.006, accent: 0.08, accentColor: 0xaecbe2 },
  },
  swamp: {
    /*
     * 늪이 "초원2"로 보였던 원인은 지면이 선명한 잔디 초록(0x6f9c46)이었기 때문이다.
     * 썸네일의 늪은 채도가 낮고 어두운 습지색이며, 밝은 것은 **발광 버섯뿐**이다.
     * 배경도 물이 아니라 보라-청록 안개다 — waterDeep을 보랏빛으로 두고 fogRange를
     * 바짝 당겨 섬 둘레부터 안개가 삼키게 했다.
     */
    ground: [0x4e6b39, 0x445e31, 0x5b7843, 0x374f29, 0x64834b],
    path: [0x6b5a3c, 0x5e5034, 0x7a6746],
    cliff: [0x4b452e, 0x201c12],
    cliffBand: 0x556b31,
    shoreSand: 0x7d7c52,
    water: 0x33564f,
    waterDeep: 0x22203a,
    waterShore: 0x527f68,
    foam: 0x8fd9b4,
    fog: 0x5a5070,
    fogRange: [1.3, 3.2],
    sky: 0x473e5c,
    hemiGround: 0x4f5c34,
    sun: 0xc8d4b8,
    sunPower: 1.75,
    hemiPower: 1.2,
    ambient: 0xb8e07c,
    // 고인 물 웅덩이 — 액센트가 어둡고 푸르다.
    grain: { band: 0.04, bandLen: 5, bandAngle: 1.1, jitter: 0.055, hue: 0.03, accent: 0.13, accentColor: 0x3a5747 },
  },
  volcano: {
    /*
     * 화산은 **판과 배경의 관계가 뒤집혀 있던** 바이옴이다: 배경(용암 물 0xff671e)이
     * 화면 전체를 형광 주황으로 채우고 판은 구분 없는 진흙색 덩어리였다. 썸네일은
     * 정반대다 — 배경이 어둡고 **용암만 빛난다**. 그래서 sky/fog를 어두운 갈보라로
     * 내리고, 용암은 섬 둘레에서만 노랗게 달아오르다 멀리서 검붉게 식게 했다
     * (waterShore 0xffc84a → water 0xe8500c → waterDeep 0x2a0c06).
     * 지면도 진흙색에서 회흑색 현무암으로 옮겨 그 위의 주황 균열이 살아나게 했다.
     */
    ground: [0x565049, 0x4e4841, 0x5e564e, 0x484239, 0x635a52],
    path: [0x8a8078, 0x7c726b, 0x968b82],
    cliff: [0x3f3936, 0x151111],
    cliffBand: 0x7a3a1c,
    shoreSand: 0x8a5a3a,
    water: 0xe8500c,
    waterDeep: 0x2a0c06,
    waterShore: 0xffc84a,
    foam: 0xfff0b0,
    fog: 0x36211f,
    fogRange: [1.4, 3.4],
    sky: 0x261719,
    hemiGround: 0x5a3428,
    sun: 0xffd8b8,
    sunPower: 1.9,
    hemiPower: 1.0,
    ambient: 0x3a3a3a,
    // 갈라진 지각 — 액센트가 곧 용암 균열이다. 띠는 굳은 용암류 방향.
    grain: { band: 0.05, bandLen: 6.5, bandAngle: 2.0, jitter: 0.06, hue: 0.01, accent: 0.1, accentColor: 0x2a2422 },
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
  /**
   * 아군 부족 진영색 — **마을 깃발과 주민 제복이 같은 색을 쓴다.**
   * 여기 모아 둔 이유는 하나뿐이다: 마을(basecamp.ts)과 출동하는 주민(enemies.ts의
   * allyLivery)이 서로 다른 파일에 살지만 화면에서는 **같은 편**으로 읽혀야 한다.
   * 예전엔 마을 깃발이 C.banner(주황빛 붉은색)라 blade 습격대의 염료(0xd2492f)와
   * 사실상 같은 색이었다 — 우리 마을이 적 부족기를 걸고 있던 셈이다.
   * 털흰색(명도 L≈89%)은 적 염료 4색(L≈30~45%)보다 한 단계 위 명도대라
   * 잔디·흙 위에서 먼저 눈에 들어온다.
   */
  allyFur: 0xf7f0dd,
  allyFurDark: 0xd6cbb0,
  allySky: 0x4fb0e6,
  allySkyDark: 0x2d84bd,
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
