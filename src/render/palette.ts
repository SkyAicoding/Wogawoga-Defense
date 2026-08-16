/**
 * 색 팔레트 + 공유 머티리얼 싱글톤.
 * Crossy Road풍 고채도 로우폴리 — 모든 지오메트리는 버텍스 컬러로 칠하고
 * 머티리얼은 공유한다 (드로우콜/컴파일 절약).
 * Lambert는 flatShading을 지원하지 않으므로 비인덱스 지오메트리 + 면 노멀로 플랫 효과를 낸다.
 */
import * as THREE from 'three';
import type { BiomeId } from '@/data/types';

/**
 * 지면 "결" — 지면색 필드의 파라미터.
 *
 * 예전엔 타일 색이 `ground` 램프에서 **셀마다 무작위 픽** 하나뿐이었다. 그래서 어느
 * 바이옴이든 그림이 똑같았다 — 색만 다른 체크무늬. 썸네일 6장을 나란히 놓고 보면
 * 바이옴을 가르는 건 색상(hue)이 아니라 **결**이다: 사막은 한 방향으로 흐르는 사구 띠,
 * 설원은 눈 두께에 따른 넓은 명암 얼룩, 화산은 검은 지각에 드문드문 벌어진 균열,
 * 늪은 고인 물 웅덩이. 그 넷을 같은 파라미터 네 개로 표현한 것이 이 구조체다.
 *
 * ⚠ 여기 값들은 **타일 단위가 아니라 좌표의 연속 함수**로 쓰인다
 *   (terrain.ts groundColor — 타일마다 색을 하나씩 뽑던 구조가 판을 체스판으로
 *   보이게 해서 갈아엎었다). 그래서 "확률"이나 "지터 폭"이라기보다 **면적 비율**과
 *   **필드 진폭**으로 읽어야 한다.
 */
export interface GroundGrain {
  /** 저주파 띠(사구/설원 눈두께)의 명도 진폭. 0이면 띠 없음 */
  band: number;
  /** 띠 파장(셀 단위) — 클수록 넓은 띠 */
  bandLen: number;
  /** 띠 진행 방향(라디안, 0 = +x) */
  bandAngle: number;
  /** 램프와 별개로 얹는 명도 필드의 진폭 (경로는 절반) */
  jitter: number;
  /** 색상(hue) 필드의 진폭 */
  hue: number;
  /** 액센트 얼룩이 덮는 **면적 비율** (0~1). 판에서 필드의 분위수로 환산된다 */
  accent: number;
  /** 액센트 얼룩 색 (균열/웅덩이/덤불 자국) — 칸이 아니라 칸을 가로지르는 얼룩이다 */
  accentColor: number;
}

export interface BiomePalette {
  /**
   * 지상 램프. **순서는 뜻이 없다** — 쓰는 쪽(terrain.sortedRamp)이 휘도순으로
   * 정렬한 뒤 얼룩값을 그 위의 연속 위치로 써서 어두운 쪽↔밝은 쪽을 오간다.
   * 그러니 여기엔 "이 바이옴 지면이 오갈 명암 폭"만 정해 두면 된다.
   */
  ground: number[];
  /** 경로(흙) 램프 — ground와 같은 규칙 */
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
     *
     * ── 2차: "타워와 유닛 실루엣이 배경에 묻힌다" (사용자 제보) ──────────────
     * 실측 방법: ?scene=stagelab&biome=swamp&slots=0 에서 애니 루프를 멈추고 적 12·아군 3을
     * 같은 칸에 고정한 한 프레임. 그룹을 하나씩 숨긴 프레임과의 diff 로 요소 마스크를 만들고
     * (그림자 끔 → 실루엣만), 색은 그림자 켠 정본 프레임에서 gl.readPixels 로 직접 읽는다.
     * 대비 = |L_요소 − L_기준| / L_기준 (Rec.709 luma 중앙값), ΔE = 평균 RGB의 CIELAB ΔE76.
     * 초원을 같은 방식으로 재서 대조군으로 쓴다.
     *
     * ⚠ **뷰포트마다 카메라 거리가 달라 안개량이 완전히 달라진다** — 이걸 놓치면 판을 잘못 잡는다.
     *   fitToPlayfield 는 세로가 좁을수록 카메라를 뒤로 뺀다. 판 중심까지의 뷰 깊이가
     *   가로 844×390 36.5 · 세로 900×1400 50.7 · 폰 390×844 **60.8**(desktop 대비 +20%)이라,
     *   같은 fogRange 라도 판 위 안개량이 개정 전 기준 0.02 ↔ 0.65 ↔ **0.91** 로 갈렸다.
     *   그래서 아래 표는 랩 뷰포트가 아니라 **실제 세로 화면 두 종류**에서 잰다.
     *
     *   ① 세로 900×1400 (판 뷰 깊이 50.7)
     *   요소            개정 전            현재             초원(대조군)
     *   판 위 안개량    0.647             0.076            0.049
     *   지면 luma       72.6 (L* 30.3)    53.6 (L* 23.8)   181.4 (L* 72.2)
     *   경로 대비/ΔE    0.007 / 3.6       0.528 / 17.4     0.015 / 26.0
     *   타워 대비/ΔE    0.014 / 4.2       0.522 / 20.8     0.466 / 40.3
     *   적 vs 경로      0.063 / 3.4       0.425 / 20.9     0.581 / 40.4
     *   아군 대비       0.117 / 7.4       0.757 / 25.3     0.246 / 46.9
     *   체력바 대비     0.103 / 10.8      0.493 / 28.8     0.351 / 29.0
     *   섬 vs 물(배경)  0.096 / 6.5       0.502 / 26.0     0.476 / 80.6
     *   발광 버섯 luma  97.0              119.0            —
     *
     *   ② 폰 390×844 (판 뷰 깊이 60.8) — 원래 여기가 최악이었다
     *   판 위 안개량 0.911 → 0.352 · 지면 83.1(L* 35.4) → 61.9(L* 26.7)
     *   경로 0.012/0.9 → 0.354/13.0 · 타워 0.014/1.2 → 0.134/9.8
     *   적 vs 경로 0.008/**0.5** → 0.283/13.4 · 아군 0.016/1.6 → 0.420/17.7
     *   체력바 0.025/1.4 → 0.200/16.3 · 섬 vs 물 0.067/4.3 → 0.465/21.6
     *   발광 버섯: 개정 전에는 **버섯 픽셀이 0개** — 판의 유일한 광원이 안개에 통째로 지워졌다.
     *
     * 진단: "어둡다"가 아니라 **판 전체가 안개색 한 덩어리**였다. 개정 전 폰에서 지면·경로·타워·
     * 적의 평균 RGB 가 [87,79,108] · [89,80,110] · [89,79,109] · [89,79,109] — 넷이 서로
     * ΔE 1.6 안에 들어 있고 색상은 초록이 아니라 **보라 257°**다. 화면에 보이던 건 지면이
     * 아니라 안개였다(작은 화면에서 확실히 갈리는 하한은 ΔE≈25). 그래서 손잡이 다섯을 이 순서로 돌렸다.
     *
     * ① fogRange [1.3, 3.2] → [2.4, 4.2] — 안개를 **끄지 않고 판 밖으로 밀어냈다**.
     *    fogNear 를 초원과 같은 2.4 로 맞추되 fogFar 는 초원(5.2)보다 훨씬 짧은 4.2 로 남겼다:
     *    **섬은 또렷하고, 섬 너머 물은 곧바로 보라 안개 벽에 닫힌다.** 판 위 안개량은
     *    900×1400 0.647→0.076, 폰 0.911→0.352. 이 하나가 지배항이다 — 나머지 손잡이의
     *    효력은 전부 (1−안개량) 배로 깎여 있었다. 이 손잡이만 돌린 중간판(01-mid-fogonly)에서
     *    ΔE 가 통째로 뛴다: 경로 3.6→12.8 · 타워 4.2→13.8 · 적 3.4→19.4 · 아군 7.4→24.5 ·
     *    체력바 10.8→34.2 · 섬 vs 물 6.5→23.6. **대신 판이 72.6→39.7(L* 30.3→17.1)로
     *    45% 어두워진다** — 안개가 검은 쪽을 들어 올리던 밝은 베일이었기 때문이다. 그래서 ②가 붙는다.
     *    범위를 더 넓히면(2.9 이상) 폰에서도 0.09 로 떨어져 안개가 사실상 사라지고,
     *    좁히면(1.8) 폰이 0.774 로 되돌아간다. 후보 5개를 두 뷰포트에서 구운 시트가
     *    dark-swamp/AB-fogsweep-{phone,desk}.png 다.
     * ② sunPower 1.75 → 2.5 / hemiPower 1.2 → 1.55 — ①이 어둡게 만든 만큼을 되갚는다
     *    (지면 39.7 → 53.6). **조명은 곱셈이라 ①이 번 대비는 한 톨도 안 깎인다** — 분자와
     *    분모가 같은 비율로 커지기 때문이다. 실제로 ΔE 는 오히려 늘었다(적 19.4→20.9,
     *    섬 vs 물 23.6→26.0). 이것이 "어둡다"에 답하면서 판독을 안 깎는 유일한 순서다.
     *    sun 색 0xc8d4b8 은 건드리지 않았다 — 밝히면 습지 특유의 탁한 빛이 초원 햇빛이 된다.
     * ③ hemiGround 0x4f5c34 → 0x88a074 — **지면을 안 건드리고 그 위 물체만 띄우는 유일한 손잡이**.
     *    HemisphereLight 는 노멀이 위를 볼수록 sky, 아래를 볼수록 hemiGround 를 섞으므로
     *    타일 상면(노멀 +Y)은 순수 sky 이고 hemiGround 를 한 톨도 안 받는다. 실측이 그대로다:
     *    지면 55.6 → 55.9(불변), 타워 64.5 → 68.7, 아군 85.9 → 95.2. 더 올려 0x9aae82 도 재 봤는데
     *    아군 흰 털이 흰 덩어리로 뭉개져(측면 노멀까지 밝아지며 형태 음영이 사라진다) 여기서 멈췄다.
     * ④ ground 는 **명도를 1도 안 올리고 채도만 내리고 색상만 식혔다**(HSV S ×0.72, H 95°→113°,
     *    V 그대로). 램프 중심 0x4e6b39(S 0.467 · V 0.420) → 0x4b6b47(S 0.336 · V 0.420),
     *    팔레트 luma 97.2 → 97.6. 금지색 0x6f9c46 과는 S 0.336 vs 0.551 · V 0.420 vs 0.612 ·
     *    H 113° vs 91° 로 세 축 모두 벌어져 있다. ①이 보라 베일을 걷으면 화면상 지면 채도는
     *    어차피 올라가므로(렌더 S 0.17 → 0.49) 팔레트 쪽에서 미리 깎아 둔 것이다. 화면 채도를
     *    더 내리려고 S ×0.62 도 구워 봤지만 렌더 S 0.49→0.47 뿐이라(채도를 정하는 건 램프가
     *    아니라 조명색이다) 대비를 깎을 이유가 없어 버렸다. H 132°까지 밀어 본 판도 이득이
     *    ΔE +0.4 뿐이라 청록으로 흐르는 값은 버렸다.
     * ⑤ path 를 젖은 **미사(silt) 색으로 올렸다** — 이 판의 진짜 구멍이었다. 개정 전 경로는
     *    지면과 ΔE 3.6(폰 0.9) 로 6판 중 최저 = **적이 어디로 오는지 지면이 말을 안 했다**.
     *    0x6b5a3c(V 0.42 · S 0.44) → 0x807860(V 0.50 · S 0.27), 팔레트 luma 91.4 → 119.7(×1.31).
     *    경로 대비 0.007 → 0.528, 그 위를 걷는 적 대비 0.063 → 0.425 / ΔE 3.4 → 20.9.
     *    ×1.5(0x948968)까지 올린 판은 마른 사막 길로 읽혀 되돌렸다(캡처 C-gnd-path-swamp.png).
     *
     * 되돌리지 말 것: 지면은 **밝히지 않았다** — 화면 luma 가 72.6 → 53.6 으로 오히려 내려갔는데,
     * 개정 전의 그 72.6 은 지면색이 아니라 안개였다(위 보라 RGB). 여기서 지면 램프를 올리면
     * 타워(67~82)와 붙어 타워 실루엣이 다시 사라지고 "초원2"도 함께 돌아온다.
     * "어둡다"에 대한 답은 지면이 아니라 ①②③이 담당한다. 발광 버섯은 여전히 판에서 가장 밝다
     * (900×1400 기준 버섯 119.0 > 아군 94.2 > 경로 81.9 > 체력바 80.0 > 타워 67~82 > 지면 53.6).
     * ⚠ 타워 줄만 실행 간 두 값으로 갈린다 — 루프를 멈추는 순간 화톳불 타워의 발광 위상이
     *   그대로 굳는 탓이다(같은 팔레트에서 중앙값 67.4↔81.6). 나머지 줄은 3회 재실행에서 1% 이내.
     * 캡처: dark-swamp/ 아래 — 뷰포트별 A/B AB-vp1400.png · AB-vpphone.png,
     * 손잡이 단계별 3벌 {00-base,A-fog18-34,99-final}-swamp.png 와 시트 AB-path-tower.png,
     * 실게임 스테이지 5 AB-game.png · AB-game-zoom.png · AB-phone.png.
     */
    ground: [0x4b6b47, 0x415e3e, 0x567852, 0x374f34, 0x5f835b],
    path: [0x807860, 0x716a52, 0x948b6c],
    cliff: [0x4b452e, 0x201c12],
    cliffBand: 0x556b31,
    shoreSand: 0x7d7c52,
    water: 0x33564f,
    waterDeep: 0x22203a,
    waterShore: 0x527f68,
    foam: 0x8fd9b4,
    fog: 0x5a5070,
    fogRange: [2.4, 4.2],
    sky: 0x473e5c,
    hemiGround: 0x88a074,
    sun: 0xc8d4b8,
    sunPower: 2.5,
    hemiPower: 1.55,
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
     *
     * ── 2차 교정: "화산만 요소 판독이 떨어진다" ────────────────────────────
     * 위 교정은 sky/fog만 내렸고 **물 자체는 그대로 뒀다.** 그 결과 배경은
     * "어두운 하늘 + 여전히 형광 주황인 물"이 됐다 — 실측으로 화면의 27%가
     * 형광 주황(R>120 ∧ R−B>60) 픽셀이었다. 판(휘도 33.6)이 그 한복판에
     * 검은 구멍처럼 앉으니 눈이 배경 쪽으로 순응해 판 위 요소가 안 읽힌다.
     * 썸네일(assets/stages/volcano.webp)의 원경은 주황이 아니라 **갈보라 연무**이고
     * 주황은 섬 둘레 링과 지각 균열에만 있다.
     *
     * 그래서 손댄 것은 **배경 용암의 넓은 중간대(water)와 원경(waterDeep)뿐**이다.
     * 뜨거운 링(waterShore 0xffc84a·foam 0xfff0b0)은 그대로 둬서
     * "용암만 빛난다"는 구도를 지켰다 — 링이 곧 섬 윤곽선 노릇을 한다.
     * waterDeep은 그냥 어둡게가 아니라 fog(0x36211f) 쪽 갈보라로 옮겼다.
     * 순수 스케일(0x1c0805)로 내려 보니 화면 네 귀퉁이가 새까매져 연무가 아니라
     * 잘린 배경으로 보였다.
     *
     * 판 위 요소는 **hemiGround로만** 들어 올렸다. 지형 상면은 노멀이 +y라
     * 반구광에서 sky(0x261719, 휘도 26)만 받고 hemiGround는 거의 안 받는다.
     * 반대로 유닛·타워·소품의 **수직면**은 hemiGround를 절반 받는다 —
     * 즉 이 손잡이는 지면을 안 건드리고 물체만 밝히는 유일한 통로다.
     * 실측: hemiGround/hemiPower만 올렸을 때 지면 중앙값 33.6 → 33.8(불변),
     * 적 41.3 → 45.6, 타워 50.6 → 54.1, 형광주황 면적 0.270 → 0.273(불변).
     *
     * ⚠ sunPower·ground·path는 **일부러 그대로 뒀다.**
     *   · sun ×1.25 → 지면 33.6→38.6, 적 41.3→46.1. 둘이 같이 올라 적 대비는
     *     0.229→0.194로 오히려 나빠지고 형광주황 면적만 0.270→0.349가 된다.
     *   · ground ×1.25 → 적 대비 0.229 → **0.083**. 적 휘도가 41이라 지면(33.6)의
     *     천장이 이미 41이다. 지면을 밝히면 적이 지면 속으로 들어간다.
     *     ("전체를 밝게 올리면 형광 주황 판이 돌아온다"의 수치판 확인이다.)
     *
     * 실측(stagelab 900×1200 DPR1, 적 12마리 동일 칸 고정, 중앙값 휘도 / ΔE76):
     *   요소            이전 → 이후   (초원 = 잘 읽히는 대조군)
     *   적 vs 지면      0.229 → 0.519  (0.550)
     *   적 ΔE vs 지면    18.4 →  26.7  (54.3, 작은 화면 판독 하한 ΔE≈25)
     *   적 ΔE vs 경로    18.7 →  25.3
     *   타워 vs 지면    0.506 → 0.917  (0.419)
     *   체력바 vs 지면  0.905 → 1.222  (0.203)
     *   지면 휘도/L*     33.6 → 32.4 / L* 14.5 → 14.4  ← 판은 안 밝혔다
     *   섬↔원경 절대차    3.3 →  18.6  (초원 71.9)
     *   화면 형광주황    0.270 → 0.122  ← 절반 이하
     * 캡처 3벌: scratchpad/dark-volcano/{v0,it1,fin}-volcano-*.png
     *
     * 실게임 스테이지6(13×17, 웨이브4, 타워 2, 적 6)도 같은 방향으로 움직였다.
     * **판 영역만** 잘라 재면 평균 휘도는 49.2 → 50.9로 사실상 그대로인데
     * 표준편차가 36.6 → 44.2(+21%), p90이 108 → 126이다 — "밝아진" 게 아니라
     * **판 안의 명암 폭이 벌어진** 것이고 그게 목표였다. 화면 전체 형광주황 0.202 → 0.102.
     * (폰은 0.024 → 0.075 로 되레 는다 — 이전엔 섬 둘레 용암 링까지 안개가 덮고 있어서
     *  주황이 "적었던" 것이라, 이 증가는 링이 제 노릇을 되찾은 것이지 배경 범람이 아니다.
     *  데스크톱 기준 절반으로 줄었다는 쪽이 배경 범람 여부의 지표다.)
     *
     * ⚠ 그런데 **폰(390×844)에서는 여기까지가 전부 헛수고였다.** 판 영역 표준편차가
     *   10.0 → 9.6 으로 꿈쩍도 안 했다(데스크톱은 36.6 → 44.2). 원인은 화면비다:
     *   세로로 좁은 뷰포트에 가로로 넓은 판을 맞추려면 카메라가 훨씬 뒤로 빠지므로
     *   판이 앉는 **뷰 깊이가 커진다**. stagelab(900×1200)에서 유도한 안개 기준
     *   (판 중심 = 판 대각선의 2.105배)이 폰에는 그대로 안 먹힌다 — 폰에서는 판이
     *   fogNear 를 한참 지나 있어 [1.9, 4.4] 로도 여전히 통째로 갈색 베일에 잠겨 있었다.
     *   그래서 fogRange 를 폰 기준으로 다시 잡아 **[2.6, 5.6]** 으로 밀었다.
     *   실측(스테이지6 폰, 판 영역): 표준편차 9.6 → 44.2, p90 54.9 → 117.0.
     *   데스크톱은 이미 안개 밖이라 값이 거의 안 움직인다(적 대비 0.519 → 0.528,
     *   형광주황 0.122 → 0.126) — 즉 **공짜로 폰만 고쳐지는 손잡이**다.
     *   2.6 은 초원(2.4)·사막(2.6)과 같은 대역이다. 어두운 판일수록 안개 여유가
     *   더 필요하지 덜 필요하지 않다는 것이 이 판이 준 교훈이다.
     *   A/B: before/fin/fog26-battle-{wide,phone}.png, *-phonecrop.png
     */
    ground: [0x565049, 0x4e4841, 0x5e564e, 0x484239, 0x635a52],
    path: [0x8a8078, 0x7c726b, 0x968b82],
    cliff: [0x3f3936, 0x151111],
    cliffBand: 0x7a3a1c,
    shoreSand: 0x8a5a3a,
    // 넓은 중간 수심대 — 여기가 화면 주황의 대부분이다. 0xe8500c에서 6할로 식혔다.
    // (물은 노멀 +y 램버트라 태양을 1.5배로 받아 albedo보다 훨씬 뜨겁게 나온다)
    water: 0x8e2f06,
    // 원경 — 검게가 아니라 fog(0x36211f) 쪽 갈보라로. 이전 0x2a0c06.
    waterDeep: 0x2a1a1c,
    waterShore: 0xffc84a,
    foam: 0xfff0b0,
    fog: 0x36211f,
    // 이전 [1.4, 3.4]. 안개는 모든 대비를 곱으로 깎는 승수다 — 걷는 것만으로
    // 타워 0.506→0.699, 체력바 0.905→1.261이 됐다(지면 휘도는 불변).
    // ⚠ 값은 **데스크톱이 아니라 폰(390×844) 기준으로 잡아야 한다** — 좁은 화면일수록
    //   카메라가 뒤로 빠져 판이 안개 깊숙이 들어간다. 위 주석의 폰 실측을 볼 것.
    // ⚠ 안개가 걷히면 원경 용암이 덜 뭉개져 주황 면적이 는다 — 그래서 위 water를
    //   같이 식혔다. 둘을 따로 움직이면 안 된다(water를 안 식힌 채 여기만 밀면
    //   "형광 주황이 화면을 채우던" 상태로 돌아간다).
    fogRange: [2.6, 5.6],
    sky: 0x261719,
    // ★ 판 위 물체만 밝히는 손잡이 (지형 상면은 +y라 sky만 받는다). 이전 0x5a3428.
    // 용암 반사광이라는 설정이라 색을 주황 쪽으로 뒀다 — 휘도만이 아니라
    // 채도로도 검은 지각과 갈린다(적 ΔE 18.4 → 26.7).
    hemiGround: 0xba765e,
    sun: 0xffd8b8,
    sunPower: 1.9,
    // 1.4/1.6/1.8 실측: 적 대비 0.488 / 0.519 / 0.543. 1.6이 초원(0.550) 문턱에
    // 딱 닿는 값이라 여기서 멈췄다 — 더 올리면 유닛이 아래에서 뜬 것처럼 보인다.
    hemiPower: 1.6,
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
