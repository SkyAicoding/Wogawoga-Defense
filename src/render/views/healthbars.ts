/**
 * 오버레이 인스턴스 계층 — **적 체력바 / 내 타워 체력바 / 기지 체력바 / 파괴 잔해 /
 * 침묵 룬**을 전부 하나의 InstancedMesh로 그린다 (드로우콜 1).
 * barKind로 정점·프래그먼트를 가른다:
 *   0 = 적 체력바, 1 = 타워·아군 체력바 (카메라 정렬 빌보드)
 *   2 = 파괴 잔해, 3 = 침묵 룬     (지면/지붕에 눕는 원형 표식, towerstatus.ts가 상태 소유)
 *   4 = 기지(홈타운) 체력바        (빌보드 — 1과 같은 팔레트, 크기와 저체력 경보만 다르다)
 *   5 = 캐기 진행 게이지 · 6 = 짐 칩 · 7 = 자원 배지   (채집, gather-spec §6-1 — 전부 빌보드)
 *   8 = 대기(HOLD) 말뚝                                (자동 행동 off — 빌보드)
 * 만피는 숨긴다 — 바가 보인다 = 지금 뭔가 깎이고 있다는 신호다.
 *
 * ── 채집 표시가 왜 **여기** 얹혔는가 (드로우콜 0) ──────────────────────────
 * gather-spec §6-1은 자원 배지를 "stage3d.decals의 인스턴스 층"에 얹으라고 적었는데,
 * 코드를 보면 **decals에는 인스턴스 층이 없다** — 병합 메시(slots·chevrons·marker)뿐이라
 * 칸 하나가 텄을 때마다 40~51개 지오메트리를 다시 병합해야 하고, 그건 같은 문서가
 * D1으로 지운 재병합 위험(1회당 CPU 0.3~1.4ms + 버퍼 재할당)을 배지 이름으로 되살리는 일이다.
 * 이 메시는 이미 인스턴스라 **상태 변화가 어트리뷰트 한 칸 쓰기**로 끝나고,
 * 메시가 하나도 안 늘어 드로우콜 Δ가 0이다(count가 0이던 프레임에서만 0 → 1).
 * 대가는 CAPACITY 160의 공유다: 최악 프레임(기지1 + 적56 + 타워15 + 아군6 + 표식)에
 * 게이지 6 + 짐 칩 12 + 배지 51이 더해지면 상한에 닿을 수 있다. 그래서 **배지를 맨 뒤에**
 * 쌓는다 — 넘칠 때 잘리는 것이 언제나 배지이고, 체력바는 한 개도 안 잘린다.
 *
 * ── 왜 네 가지를 한 메시에 몰아넣는가 (드로우콜 예산) ────────────────────────
 * 표식용 메시를 따로 두면 그 자체로 +1 콜이고, 실측한 최대 메시 프레임
 * (스테이지6 w50 = 보스 개별 3 + 인스턴스 2 + 만렙 타워 12 + 체력바 12)이 이미
 * 60/60이라 예산을 넘겼다(61 실측). 체력바 메시는 무언가 깎이는 순간 어차피
 * 그려지므로, 여기에 얹으면 오버레이 계층 전체가 **항상 드로우콜 1개**다.
 * (InstancedMesh는 count가 0이면 draw 자체를 건너뛴다 — 평소에는 0콜이다)
 *
 * ── 실측 정정 (5단계): 최대 프레임은 60콜이 아니다 ─────────────────────────
 * 위 "60/60" 은 **최악 프레임이 아닌 장면에서 잰 값**이었다. 실제 최악 프레임
 * (swiftshader 900×1000, 만렙 T5 타워 12~15기 + 적 56 + 아군 6 + 마을 Lv5 정지 프레임)은
 * **73~81콜**이고, 그 천장을 만드는 것은 오버레이도 아군도 아니라 **타워 수**다
 * (타워 1기당 약 3콜 · 상한 없음 — 0기 11콜 / 4기 23 / 8기 36 / 12기 47 / 15기 56).
 * 즉 "여유가 0이라 메시를 못 늘린다"는 전제 자체가 틀렸다.
 *
 * 그래도 **이 구조는 그대로 둔다**: 오버레이를 한 메시로 묶는 판단은 여유가 0이어서가
 * 아니라 "무언가 깎이는 순간 어차피 그려지는 메시에 얹으면 공짜"이기 때문이고,
 * 그 논리는 실측이 어떻든 유효하다. 예산 관계의 최신 실측 표는
 * views/enemyview.ts 헤더와 tests/e2e/smoke.spec.ts 의 '최악 프레임' 테스트에 있다.
 *
 * ── 적 바와 내 타워 바는 **반드시 달라 보여야 한다** ─────────────────────────
 * 예전에는 폭·높이만 조금 다르고 팔레트(초록→빨강)·테두리가 같아서, 난전 중에
 * 어느 바가 내 것인지 구분되지 않았다. 더 나쁜 건 **의미 반전**이다 —
 * 이 장르에서 빨간 바는 "적이 곧 죽는다"는 좋은 소식인데, 같은 팔레트를 쓰면
 * 무너지기 직전인 내 타워가 오히려 안심 신호로 읽힌다.
 *
 * 그래서 두 축을 동시에 갈랐다:
 *  · **팔레트** — 적은 초록→빨강(자연/생명), 타워는 청록→호박→적색(구조물/경보).
 *    만피 근처의 색이 아예 다르므로(초록 대 청록) 한 프레임만 봐도 갈린다.
 *  · **형태** — 타워 바는 밝은 돌색 테두리를 두르고 중앙에 눈금을 넣는다.
 *    기본 줌에서 유닛이 20px 남짓이라 색만으로는 부족하고, 테두리 명도 대비가
 *    "선이 하나 더 굵다"로 읽힌다. 높이도 0.13 → 0.22로 키웠다
 *    (실측: 데스크톱 기본 줌에서 채움 높이 1~2px → 4~5px).
 *
 * ── 기지 바는 왜 kind 1이 아니라 4인가 ────────────────────────────────────
 * 사용자 요구는 "홈타운 위에 **다른 타워들처럼** 공격받으면 게이지가 나오도록"이다.
 * 그래서 팔레트·테두리·눈금은 타워(kind 1)와 **한 픽셀도 다르지 않게** 두고,
 * 오직 두 가지만 갈랐다 — (a) 크기, (b) 저체력 점멸.
 * 그 둘을 위해 kind를 나눈 것이지 다른 물건으로 보이게 하려고 나눈 게 아니다.
 * 프래그먼트는 `own = min(vKind, 1.0)`으로 1과 4를 같은 팔레트에 태우고,
 * `isBase = step(3.5, vKind)`로 점멸만 기지에 건다.
 * (b)가 필요한 이유: HUD 둘째 줄을 걷어내면서 `.hp-fill.is-low`(30% 이하 0.8초 점멸)가
 * 같이 사라졌다. 그건 장식이 아니라 **패배가 임박했다는 유일한 경보**였고,
 * style.css의 prefers-reduced-motion 블록이 그 애니메이션만은 일부러 안 끄고 있다.
 * 없앨 게 아니라 옮길 신호라 판단해 3D 바로 그대로 이사시켰다(주기·역치 동일).
 */
import * as THREE from 'three';
import type { AllyState, EnemyState, ResourceCellState, TowerState } from '@/data/types';
import { ALLY_DEFS } from '@/data/allies';
// sim이 아니라 **data** 모듈이다 — 도착 판정과 캐기 틱을 sim과 같은 함수로 본다
// (렌더가 @/sim을 임포트하지 않는다는 규약은 그대로다 — enemyview.ts 헤더 참조).
import { gatherTicksFor, isGathering, isWorkerDef } from '@/data/resources';
import { lerp } from '@/core/mathx';
import { BOSS_ENEMIES } from '../meshlib/enemies';
import { towerTierScale } from '../meshlib/towers';
import type { CellToWorld } from '../meshlib/terrain';
import type { TowerMark } from './towerstatus';

const CAPACITY = 160;
/**
 * 타워 체력바 — 적보다 넓고 **확실히** 두껍게.
 * 0.13 → 0.22: 데스크톱 기본 줌(1셀 ≈ 20.5px)에서 0.13은 채움이 1~2px라
 * 읽히지 않았다. 0.22면 4~5px로 "바"의 형태가 생긴다.
 */
const TOWER_BAR_W = 0.9;
const TOWER_BAR_H = 0.22;
/**
 * 아군 부족원 체력바 — **타워와 같은 kind 1**(내 편 팔레트: 청록→호박→적색)을 쓰고
 * 크기만 유닛에 맞게 줄인다. 새 kind를 만들지 않은 이유는 의미가 정확히 같기 때문이다:
 * 이 바가 줄어드는 건 "내가 잃고 있다"는 나쁜 소식이고, 적 바(초록→빨강)가 줄어드는 건
 * 좋은 소식이다. 그 반전이 바로 kind 0/1을 가른 축이라(헤더 참조) 아군을 적 팔레트에
 * 태우면 난전에서 정확히 거꾸로 읽힌다.
 * 폭은 적 바(0.55×...)와 타워 바(0.9) 사이 — 걸어 다니는 작은 유닛이라 타워만큼 넓으면
 * 몸통보다 바가 커진다.
 */
const ALLY_BAR_W = 0.5;
const ALLY_BAR_H = 0.15;
/** 아군 머리 위 높이 (모델 키 0.68 + 여유) */
const ALLY_BAR_Y = 0.95;
/** 티어 스케일에 곱하는 바 높이 — 지붕 바로 위 (towerTierScale 기준) */
const TOWER_BAR_HEIGHT = 1.45;
/**
 * 기지(홈타운) 체력바 — **타워 바보다 크다**. 기지 HP는 패배 조건이라 타워 한 기보다
 * 무겁고, 마을 자체가 타워보다 큰 구조물(반경 1.45 = 약 2.9셀)이라 타워와 같은 0.9면
 * 마을 위에서 오히려 작아 보인다. 그렇다고 마을 폭(2.9셀)을 채우면 이웃 셀까지 덮으므로
 * 그 절반쯤인 1.3셀에서 멈춘다 — 타워 바의 1.44배이고 판은 가리지 않는다.
 */
const BASE_BAR_W = 1.3;
const BASE_BAR_H = 0.3;
/**
 * 마을 레벨(1~5)별 지붕 높이 — **실측값**이다.
 * tests/render/basecamp.test.ts 의 visibleHeight 와 같은 방식으로 레벨×피해 15조합을
 * 재서 얻었다(피해 0 기준): 1.228 / 1.240 / 1.639 / 1.639 / 2.126.
 * 레벨을 반영하는 이유는 마을이 **위로 자라기** 때문이다(움막 → 망루 → 망루 꼭대기층).
 * Lv5 값 하나로 고정하면 Lv1 마을 위 0.9만큼 허공에 뜨고, Lv1 값으로 고정하면
 * Lv3부터 망루에 파묻힌다. 바는 depthTest를 받으므로 파묻히면 **아예 안 보인다**.
 *
 * ⚠ 피해 단계(0/1/2)로는 낮추지 않는다. 반파 마을은 1.403까지 주저앉지만(실측),
 * 바가 그때 같이 내려오면 **피해를 입을수록 바가 움직이는** 꼴이라 읽기가 어려워진다.
 * 무너진 마을 위에서 여유가 조금 더 생길 뿐 가려지지는 않으므로 온전한 높이로 고정한다.
 */
const BASE_ROOF_Y: readonly number[] = [1.228, 1.24, 1.639, 1.639, 2.126];
/**
 * 지붕과 바 사이 여유. 타워 바가 대다수 타워 지붕 위에 남기는 간격(T5 기준 0.03~0.45)의
 * 중간쯤이고, 데스크톱 기본 줌(1셀 ≈ 20.5px)에서 약 4.5px — "지붕에 붙어 있지만
 * 파묻히진 않았다"로 읽히는 최소값이다.
 */
const BASE_BAR_CLEARANCE = 0.22;
/** 지면 표식(잔해) 높이 — 지형 z-파이팅을 polygonOffset과 함께 피한다 */
const GROUND_Y = 0.045;
/**
 * ── 채집 표시 셋 (gather-spec §6-1) ────────────────────────────────────────
 * 게이지는 **발밑**이다. 머리 위는 이미 체력바와 짐 칩이 쓰고 있어 세 층이 겹치면
 * 어느 것이 무엇인지 읽히지 않는다. 폭은 아군 체력바(0.5)보다 좁게 잡아
 * "이건 체력이 아니다"가 크기로도 갈린다.
 */
const GATHER_BAR_W = 0.44;
const GATHER_BAR_H = 0.1;
const GATHER_BAR_Y = 0.17;
/** 짐 칩 — 머리 위(체력바보다 위). 진 개수만큼 **위로 쌓는다**(최대 carryCap 2) */
const LOAD_CHIP = 0.17;
const LOAD_CHIP_Y = 1.22;
const LOAD_CHIP_GAP = 0.21;
/**
 * 자원 배지 — 소품 **위에** 뜬다. 지면 데칼로 두면 55° 부감에서 소품 밑동에 가려
 * 정작 나무가 큰 칸(랜드마크)이 안 보인다. 셀 중심을 쓰는 이유는 탭 타깃이 셀이기 때문이다
 * (소품은 셀 안에서 흩어져 있지만, 플레이어가 찍는 것은 칸이다).
 */
const RES_BADGE = 0.32;
const RES_BADGE_Y = 1.08;
/**
 * ── 대기(HOLD) 표식 — 자동 행동이 꺼진 부족원 (kind 8) ─────────────────────
 * "빈 칸을 지정받아 그 자리를 지키는 중"은 **위치로 구별할 수 없다**(sim의 autoHold
 * 주석과 같은 사실이다 — 서 있는 사람과 명령이 없어 서 있는 사람은 좌표가 같다).
 * 그래서 화면에도 그 한 비트를 그릴 자리가 필요하다. 없으면 플레이어가 "왜 얘만
 * 일하러 안 가지"를 영영 알 수 없다.
 *
 * **드로우콜 Δ 0** — 이 파일의 인스턴스 메시에 얹는다(헤더의 채집 표시와 같은 논거).
 * 자리는 짐 칩(1.22)보다 위다: 짐과 대기는 **동시에** 참일 수 있고(짐을 진 채 대기),
 * 겹치면 둘 다 안 읽힌다. 최대 여섯 개라 CAPACITY(160)에 주는 압력은 무시할 수 있다.
 */
const HOLD_PIN = 0.2;
const HOLD_PIN_Y = 1.66;
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
/** 지면 표식용 — 쿼드를 눕힌다 (빌보드 분기를 타지 않는다) */
const _flatQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _scl = new THREE.Vector3();
const _mat = new THREE.Matrix4();

/**
 * 기지 체력바에 필요한 것 전부 — 셀 좌표 · HP · 마을 레벨.
 * BattleState를 통째로 받지 않는 이유는 이 뷰가 sim 타입에 묶이지 않기 때문이다
 * (다른 인자도 전부 필요한 필드만 받는다). update의 **마지막 선택 인자**라
 * 기존 호출부·테스트는 한 줄도 고치지 않아도 그대로 돈다.
 */
export interface BaseBarInfo {
  cellX: number;
  cellZ: number;
  hp: number;
  maxHp: number;
  /** 마을 레벨 (1-base) — 바 높이가 이걸 따라간다 */
  level: number;
}

/**
 * 채집 표시에 필요한 것 전부 — 자원 칸 목록 · 격자 폭 · 지금 부족을 고르고 있는가.
 * BaseBarInfo와 같은 규약이다(필요한 필드만 받는다). update의 **마지막 선택 인자**라
 * 기존 호출부와 테스트는 한 줄도 안 고쳐도 그대로 돈다.
 */
export interface GatherViewInfo {
  /** BattleState.resources 그대로 — 목록은 안 변하고 taken만 변한다 */
  cells: readonly ResourceCellState[];
  /** 셀 키 해석용 격자 폭 (AllyState.gatherKey = cellZ * gridW + cellX) */
  gridW: number;
  /**
   * 지금 부족원을 고르고 있는가. **안 턴 칸의 금색 배지는 그때만 뜬다** —
   * 상시로 띄우면 판에 배지 40개가 깔려 정작 골랐을 때의 신호가 죽는다.
   * 텄음(회색 칩)과 예약(한랭색)은 이 값과 무관하게 항상 뜬다: 앞은 "이 판을 얼마나 캤나"를
   * 말없이 가르치고, 뒤는 "저기는 이미 사람이 간다"라 선택 중이 아니어도 알아야 한다.
   */
  selecting: boolean;
}

/**
 * 셀 키 → 자원 칸. **선형 탐색이다.** 칸이 판당 40~51개이고 이 함수를 부르는 것은
 * 캐는 중인 아군(정원 6)뿐이라 최악이 프레임당 306회 비교다. 매 프레임 Map을 만들면
 * 그쪽이 더 비싸고(할당), 뷰가 sim의 색인을 복제하기 시작한다.
 */
function cellAtKey(
  cells: readonly ResourceCellState[],
  key: number,
  gridW: number,
): ResourceCellState | null {
  if (key < 0) return null;
  for (const c of cells) {
    if (c.cellZ * gridW + c.cellX === key) return c;
  }
  return null;
}

export class HealthBarView {
  private mesh: THREE.InstancedMesh;
  private fillAttr: THREE.InstancedBufferAttribute;
  private kindAttr: THREE.InstancedBufferAttribute;
  private uniforms = { uTime: { value: 0 } };

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const fills = new Float32Array(CAPACITY);
    this.fillAttr = new THREE.InstancedBufferAttribute(fills, 1);
    this.fillAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('fill', this.fillAttr);
    // 0 = 적 바, 1 = 타워·아군 바, 2 = 파괴 잔해, 3 = 침묵 룬, 4 = 기지 바
    const kinds = new Float32Array(CAPACITY);
    this.kindAttr = new THREE.InstancedBufferAttribute(kinds, 1);
    this.kindAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('barKind', this.kindAttr);

    // 지면 표식은 반투명이라 재질이 투명 패스로 간다. 체력바는 alpha=1이라
    // 블렌딩이 무연산이고, renderOrder 5로 투명 패스 안에서도 맨 뒤에 그려진다.
    const mat = new THREE.MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float fill;
attribute float barKind;
varying float vFill;
varying float vKind;
varying vec2 vBarUv;`,
        )
        .replace(
          '#include <project_vertex>',
          `vFill = fill;
vKind = barKind;
vBarUv = position.xy + 0.5;
vec4 mvPosition;
if (barKind < 1.5 || barKind > 3.5) {
  // 체력바(0·1·4): 빌보드 — 인스턴스 위치 + 카메라 우/상 벡터 * 로컬 좌표 * 인스턴스 스케일
  vec4 ipos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float bsx = length(vec3(instanceMatrix[0]));
  float bsy = length(vec3(instanceMatrix[1]));
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 bbWorld = ipos.xyz + camRight * position.x * bsx + camUp * position.y * bsy;
  mvPosition = viewMatrix * vec4(bbWorld, 1.0);
} else {
  // 지면/지붕 표식: 인스턴스 행렬을 그대로 쓴다 (이미 눕혀져 있다)
  mvPosition = viewMatrix * instanceMatrix * vec4(position, 1.0);
}
gl_Position = projectionMatrix * mvPosition;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
varying float vFill;
varying float vKind;
varying vec2 vBarUv;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if (vKind > 4.5) {
  // ── 채집 표시 (5 게이지 · 6 짐 칩 · 7 자원 배지) ───────────────────────
  // **체력바 분기에 얹지 않는다.** 그 분기는 kind를 숫자로 재서 뜻을 만든다
  // (own = min(vKind,1) · isBase = step(3.5, vKind)) — 5·6·7을 그대로 흘리면
  // 전부 **기지로 오인돼** 30% 미만에서 마을이 무너질 때처럼 깜빡인다.
  // 차오르는 게이지는 언제나 0%에서 시작하므로 그건 **매번** 일어난다
  // (gather-spec §6-1이 잡아낸 자리다). 분기를 앞에 따로 두면 kind 4 이하의 픽셀은
  // 한 개도 안 바뀐다 — 이 파일의 회귀 테스트가 잠근 그림이 그대로 산다.
  if (vKind < 5.5) {
    // 5) 캐기 진행 — 이 바는 체력이 아니라 **진행**이다. 그래서 팔레트 램프를 안 탄다:
    //    0%에서 붉게 시작하면 "다쳤다"로 읽힌다. 채워진 쪽은 고정 호박색이다.
    float inset = 0.16;
    float edge = step(inset, vBarUv.y) * step(vBarUv.y, 1.0 - inset)
               * step(inset * 0.3, vBarUv.x) * step(vBarUv.x, 1.0 - inset * 0.3);
    vec3 body = vBarUv.x < vFill ? vec3(1.0, 0.78, 0.28) : vec3(0.09, 0.07, 0.05);
    diffuseColor.rgb = mix(vec3(0.34, 0.24, 0.13), body, edge);
  } else if (vKind < 6.5) {
    // 6) 짐 칩 — 등에 진 짐 하나가 칩 하나다. 코인이 아니라 **꾸러미**로 읽히게
    //    묶은 자국(십자 띠)을 넣는다. 코인을 그리면 배달 전에 죽었을 때
    //    화면이 거짓말을 한 것이 된다(§7-2 3층).
    vec2 q = (vBarUv - 0.5) * 2.0;
    float box = smoothstep(1.0, 0.84, max(abs(q.x), abs(q.y)));
    float strap = clamp(step(abs(q.x), 0.15) + step(abs(q.y), 0.15), 0.0, 1.0);
    vec3 col = mix(vec3(0.96, 0.75, 0.31), vec3(0.68, 0.46, 0.19), strap);
    diffuseColor.rgb = col * (0.88 + 0.12 * sin(uTime * 3.0 + vFill * 6.283));
    diffuseColor.a *= box;
  } else if (vKind > 7.5) {
    // 8) 대기(HOLD) 말뚝 — **자동 행동이 꺼진 사람**의 머리 위 (사용자 지시 ③ "사용자 지정 우선").
    //    땅에 박은 말뚝 + 고리. 모양이 '멈춤'을 말하고 색이 '일하는 중이 아님'을 말한다:
    //    금색(캔다)·한랭색 배지(예약됨)와 채도가 갈리는 **회청색**이라 난전에서도 안 섞인다.
    //    ⚠ **맥동시키지 않는다.** 이 표식은 경보가 아니라 상태이고, 여섯 명이 동시에
    //      깜빡이면 그것만 눈에 들어온다. 채집 배지가 텄음 칩을 안 깜빡이는 것과 같은 규칙이다.
    vec2 q = (vBarUv - 0.5) * 2.0;
    float r = length(q);
    float ring = smoothstep(0.15, 0.0, abs(r - 0.74));
    float post = step(abs(q.x), 0.17) * step(abs(q.y), 0.46);
    float ink = clamp(ring + post, 0.0, 1.0);
    diffuseColor.rgb = mix(vec3(0.05, 0.06, 0.08), vec3(0.74, 0.82, 0.94), ink);
    diffuseColor.a *= ink * 0.94;
  } else {
    // 7) 자원 배지 — 마름모 칩. vFill 하나가 세 상태를 나른다:
    //      1 = 아직 안 텄다 (금색 · 부족원을 고르고 있을 때만 뜬다)
    //      0.5 = 누가 캐러 가는 중이다 (한랭색 · 예약이 배타적이라 언제나 한 명)
    //      0 = 텄다 (회색 그루터기 칩 · 항상 뜬다)
    vec2 q = (vBarUv - 0.5) * 2.0;
    float d = abs(q.x) + abs(q.y);
    float body = smoothstep(1.0, 0.80, d);
    float core = smoothstep(0.86, 0.66, d);
    float taken = 1.0 - step(0.25, vFill);
    float claim = step(0.25, vFill) * (1.0 - step(0.75, vFill));
    vec3 col = vec3(1.0, 0.81, 0.23);
    col = mix(col, vec3(0.62, 0.86, 0.99), claim);
    col = mix(col, vec3(0.44, 0.42, 0.40), taken);
    // 살아 있는 칸만 호흡시킨다 — 회색 칩은 판이 끝날 때 40개가 동시에 깔리므로
    // 그것까지 깜빡이면 화면이 시끄러워지고 "다 캤다"의 조용함이 사라진다.
    float alive = 1.0 - taken;
    diffuseColor.rgb = mix(vec3(0.05, 0.04, 0.04), col * (1.0 + alive * 0.16 * sin(uTime * 4.0)), core);
    diffuseColor.a *= body * mix(0.70, 0.95, alive);
  }
} else if (vKind < 1.5 || vKind > 3.5) {
  // ── 체력바 ────────────────────────────────────────────────────────────
  // own: 0 = 적, 1 = 내 편(타워·아군 kind 1, 기지 kind 4). 기지는 팔레트·테두리·눈금이
  // 타워와 **완전히 같다** — 갈리는 건 크기와 아래 저체력 점멸뿐이다.
  float own = min(vKind, 1.0);
  float isBase = step(3.5, vKind);
  // 적: 초록→빨강 (자연/생명). 테두리는 검정.
  vec3 foeCol = mix(vec3(0.85, 0.16, 0.1), vec3(0.28, 0.82, 0.2), smoothstep(0.25, 0.6, vFill));
  // 내 타워: 청록→호박→적색 (구조물/경보). 만피 근처 색이 적과 완전히 다르다.
  vec3 ownCol = mix(vec3(0.98, 0.22, 0.13), vec3(1.0, 0.72, 0.12), smoothstep(0.15, 0.45, vFill));
  ownCol = mix(ownCol, vec3(0.36, 0.86, 0.95), smoothstep(0.5, 0.8, vFill));
  vec3 hpCol = mix(foeCol, ownCol, own);
  // 기지 저체력 경보 — HUD에서 사라진 .hp-fill.is-low 를 그대로 옮겨 왔다.
  // 역치 30%·주기 0.8초(≈7.85rad/s)까지 CSS와 같은 값이고, 밝기 배율 대신
  // 뜨거운 흰빛으로 **섞는다**: 저체력 색이 이미 짙은 적색이라 밝기만 곱하면
  // R이 1.0에 물려 거의 안 움직인다(toneMapped=false → 출력에서 잘린다).
  float low = isBase * (1.0 - step(0.30, vFill));
  hpCol = mix(hpCol, vec3(1.0, 0.92, 0.72), low * 0.5 * (0.5 + 0.5 * sin(uTime * 7.85)));
  vec3 barCol = vBarUv.x < vFill ? hpCol : mix(vec3(0.06, 0.05, 0.05), vec3(0.10, 0.09, 0.11), own);
  // 타워 바는 테두리를 두껍게 + 밝은 돌색으로 — 색이 안 보이는 크기에서도 갈린다
  float inset = mix(0.06, 0.17, own);
  float edge = step(inset, vBarUv.y) * step(vBarUv.y, 1.0 - inset)
             * step(inset * 0.35, vBarUv.x) * step(vBarUv.x, 1.0 - inset * 0.35);
  // 타워 바 중앙 눈금 — 반쯤 깎였는지가 한눈에 잡힌다
  float tick = own * step(abs(vBarUv.x - 0.5), 0.012) * step(0.25, vBarUv.y) * step(vBarUv.y, 0.75);
  vec3 frame = mix(vec3(0.04), vec3(0.93, 0.90, 0.82), own);
  diffuseColor.rgb = mix(frame, mix(barCol, vec3(0.16, 0.14, 0.13), tick), edge);
} else {
  // ── 지속 표식 (towerstatus.ts) ───────────────────────────────────────
  vec2 p = (vBarUv - 0.5) * 2.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  if (vKind < 2.5) {
    // 파괴 잔해: 그을음 원 + 무너진 기둥 자국 + 흩어진 파편
    float scorch = smoothstep(1.0, 0.15, r);
    float ringBand = smoothstep(0.62, 0.5, abs(r - 0.56)) * step(0.15, abs(sin(ang * 2.0 + 0.7)));
    float ring = smoothstep(0.10, 0.0, abs(r - 0.56)) * step(0.35, abs(sin(ang * 2.0 + 0.7)));
    // 파편 — 고정 각도에 놓인 밝은 점 (난수 대신 각도 함수라 프레임마다 안 흔들린다)
    float chips = step(0.90, sin(ang * 5.0 + 1.9) * 0.5 + 0.5) * smoothstep(0.95, 0.62, r) * step(0.62, r);
    vec3 soot = mix(vec3(0.035, 0.028, 0.024), vec3(0.10, 0.075, 0.058), scorch * 0.6);
    // 부러진 기둥/파편은 밝은 목재색 — 잔디 위 '그림자'로 오해되지 않게 명도 대비를 준다
    vec3 timber = vec3(0.66, 0.47, 0.27);
    diffuseColor.rgb = mix(soot, timber, clamp(ring + chips, 0.0, 1.0));
    // vFill = 0..1 정착도 (갓 부서졌을 땐 옅다가 진해진다)
    diffuseColor.a *= clamp((scorch * 0.9 + ring * 0.85 + chips * 0.95 + ringBand * 0.1)
                            * (0.5 + 0.5 * vFill), 0.0, 1.0);
  } else {
    // 침묵 룬: 도는 마젠타 고리 + 룬 눈금 (vFill = 개체별 위상 오프셋)
    float spin = uTime * 1.15 + vFill;
    float ring = smoothstep(0.16, 0.0, abs(r - 0.80));
    float ticks = step(0.55, abs(sin(ang * 3.0 + spin))) * smoothstep(0.32, 0.0, abs(r - 0.60));
    float inner = smoothstep(0.07, 0.0, abs(r - 0.34)) * 0.6;
    // 하한을 0.72로 올려 **꺼진 것처럼 보이는 순간이 없게** 한다 (지속 표식의 요건)
    float pulse = 0.86 + 0.14 * sin(uTime * 5.0 + vFill);
    diffuseColor.rgb = mix(vec3(0.86, 0.10, 0.95), vec3(1.0, 0.72, 1.0), ticks);
    diffuseColor.a *= clamp((ring + ticks * 0.95 + inner) * pulse, 0.0, 1.0);
  }
}`,
        );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /** 셰이더 시간 (침묵 룬 회전/맥동) — stage3d.update가 부른다 */
  tick(dt: number): void {
    this.uniforms.uTime.value += dt;
  }

  update(
    enemies: readonly EnemyState[],
    towers: readonly TowerState[],
    alpha: number,
    cellToWorld: CellToWorld,
    marks: readonly TowerMark[] = [],
    allies: readonly AllyState[] = [],
    base: BaseBarInfo | null = null,
    gather: GatherViewInfo | null = null,
  ): void {
    let n = 0;
    _quat.identity();
    /*
     * 기지가 **맨 앞**이다. 순서는 그리기에는 아무 영향이 없지만 CAPACITY(160)를
     * 넘길 때 누가 잘리는지를 정한다 — 적 56 + 타워 15 + 아군 6 + 표식이 한꺼번에
     * 몰리는 최악 프레임에서 잘려도 되는 바가 기지 바일 리는 없다(패배 조건이다).
     * 규칙은 타워와 완전히 같다: **만피면 안 그린다**.
     */
    if (base && base.hp < base.maxHp) {
      cellToWorld(base.cellX, base.cellZ, _pos);
      // 마을 그룹은 지형 y와 무관하게 y=0에 놓인다(stage3d) — 절대 높이를 쓴다
      const lv = Math.max(1, Math.min(BASE_ROOF_Y.length, Math.floor(base.level)));
      _pos.y = (BASE_ROOF_Y[lv - 1] ?? 2.126) + BASE_BAR_CLEARANCE;
      _mat.compose(_pos, _quat, _scl.set(BASE_BAR_W, BASE_BAR_H, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, Math.max(0, base.hp) / Math.max(1, base.maxHp));
      this.kindAttr.setX(n, 4);
      n++;
    }
    for (const e of enemies) {
      if (!e.alive || e.hp >= e.maxHp || n >= CAPACITY) continue;
      const sx = lerp(e.prevX, e.x, alpha);
      const sz = lerp(e.prevZ, e.z, alpha);
      cellToWorld(sx, sz, _pos);
      const boss = BOSS_ENEMIES.has(e.defId);
      _pos.y = (e.flying ? 2.15 : 0.55) + e.radius * 1.6 + (boss ? 0.45 : 0);
      const w = (boss ? 1.3 : 0.55) * (0.8 + e.radius);
      _mat.compose(_pos, _quat, _scl.set(w, boss ? 0.17 : 0.11, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, Math.max(0, e.hp) / e.maxHp);
      this.kindAttr.setX(n, 0);
      n++;
    }
    // 타워 — 같은 인스턴스 버퍼에 이어 붙인다 (드로우콜 증가 0).
    // 셀 고정이라 보간이 필요 없고, 지붕 위 높이는 티어 스케일을 따라간다.
    for (const t of towers) {
      if (t.hp >= t.maxHp || n >= CAPACITY) continue;
      cellToWorld(t.cellX, t.cellZ, _pos);
      _pos.y = 0.1 + towerTierScale(t.tier) * TOWER_BAR_HEIGHT;
      _mat.compose(_pos, _quat, _scl.set(TOWER_BAR_W, TOWER_BAR_H, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, Math.max(0, t.hp) / Math.max(1, t.maxHp));
      this.kindAttr.setX(n, 1);
      n++;
    }
    // 아군 부족원 — 타워와 같은 kind 1(내 편 팔레트), 크기만 유닛에 맞춘다.
    // **만피는 여기서도 숨긴다.** 처음엔 "몇 명이 어디 서 있는지가 판단 재료"라며
    // 항상 띄웠는데, 실제 캡처를 보니 상한(6명)까지 채운 줄이 청록 슬래브 여섯 개로
    // 길을 덮어 정작 교전이 안 보였다. 인원은 HUD의 '출동 n/6'이 이미 말해 주고
    // 위치는 파랗게 물든 유닛 자체가 말해 준다 — 바까지 상시로 띄울 이유가 없다.
    // 이 파일의 대원칙(바가 보인다 = 지금 뭔가 깎이고 있다)을 아군만 어길 근거가 없었다.
    for (const a of allies) {
      if (!a.alive || a.hp >= a.maxHp || n >= CAPACITY) continue;
      cellToWorld(lerp(a.prevX, a.x, alpha), lerp(a.prevZ, a.z, alpha), _pos);
      _pos.y = ALLY_BAR_Y;
      _mat.compose(_pos, _quat, _scl.set(ALLY_BAR_W, ALLY_BAR_H, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, Math.max(0, a.hp) / Math.max(1, a.maxHp));
      this.kindAttr.setX(n, 1);
      n++;
    }
    /*
     * 대기(HOLD) 말뚝 — **자동 행동이 꺼진 부족원**. 체력바와 달리 조건이 "깎였는가"가
     * 아니라 "명령을 받고 그 자리를 지키는가"라 만피여도 뜬다: 이 표식이 말하는 것은
     * 손상이 아니라 **상태**이고, 그 상태는 화면 어디에도 다른 단서가 없다
     * (서 있는 사람과 명령 없이 서 있는 사람은 좌표가 같다).
     * 체력바 **바로 뒤**에 쌓는 이유는 이것도 '사람에 붙은 표시'이기 때문이다 —
     * CAPACITY를 넘겨 잘리는 것은 여전히 판에 깔리는 자원 배지 쪽이어야 한다(헤더).
     * 최대 여섯 개다(정원).
     *
     * ⚠ **일꾼에게만 켠다**(§D-3). 자동 행동이 없는 종(전투 3종)에게 `autoHold` 는
     *   상태가 아니라 **상수**다 — 켜져 있든 꺼져 있든 그 사람의 행동이 한 틱도 안 달라진다.
     *   그런 값에 표식을 붙이면 화면이 아무것도 안 말하면서 자리만 먹는다. 게다가 §D-1
     *   개정으로 "적이 선 칸을 찍으면 autoHold=true" 가 되면서 **전투원 전원에게 상시로**
     *   말뚝이 뜰 참이었다. 술어는 sim(규칙 8 ③)과 **같은 함수**를 쓴다 — 셋이 각자
     *   판정하면 언젠가 한 곳만 어긋난다(isGathering 과 같은 논거).
     * 부수 효과로 최악 프레임의 말뚝 인스턴스가 최대 6 → 최대 (일꾼 수)로 줄어
     * CAPACITY(160) 여유가 는다.
     */
    for (const a of allies) {
      if (!a.alive || !a.autoHold || n >= CAPACITY) continue;
      if (!isWorkerDef(ALLY_DEFS[a.defId])) continue;
      cellToWorld(lerp(a.prevX, a.x, alpha), lerp(a.prevZ, a.z, alpha), _pos);
      _pos.y = HOLD_PIN_Y;
      _mat.compose(_pos, _quat, _scl.set(HOLD_PIN, HOLD_PIN, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, 1);
      this.kindAttr.setX(n, 8);
      n++;
    }
    // 지속 상태 표식 — 눕힌 쿼드라 빌보드 분기를 타지 않는다
    for (const m of marks) {
      if (n >= CAPACITY) break;
      cellToWorld(m.cellX, m.cellZ, _pos);
      // 룬은 지붕 위로 띄운다 (pitch 55°에서 고리로 읽힌다), 잔해는 지면에
      _pos.y = m.ground ? GROUND_Y : 0.12 + towerTierScale(m.tier) * 1.15;
      _mat.compose(_pos, _flatQuat, _scl.set(m.size, m.size, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, m.phase);
      this.kindAttr.setX(n, m.kind);
      n++;
    }
    // ── 채집 (gather-spec §6-1) — 게이지 · 짐 칩 · 자원 배지 ─────────────────
    // 순서에 뜻이 있다: 게이지와 짐 칩은 **사람에 붙은 표시**라 체력바 바로 뒤에,
    // 배지는 **판에 깔리는 표시**라 맨 뒤에 온다. CAPACITY를 넘겨 잘리는 것은
    // 언제나 배지 쪽이어야 한다(위 헤더).
    if (gather) {
      for (const a of allies) {
        if (!a.alive) continue;
        // 발밑 게이지 — 분모는 **그 사람의** 실제 캐기 틱이다. 곧 같은 칸이라도
        // 채집꾼의 게이지는 빠르고 파수꾼의 게이지는 느리다(gatherPct는 속도에만 곱한다).
        if (isGathering(a) && n < CAPACITY) {
          const cell = cellAtKey(gather.cells, a.gatherKey, gather.gridW);
          if (cell) {
            cellToWorld(lerp(a.prevX, a.x, alpha), lerp(a.prevZ, a.z, alpha), _pos);
            _pos.y = GATHER_BAR_Y;
            _mat.compose(_pos, _quat, _scl.set(GATHER_BAR_W, GATHER_BAR_H, 1));
            this.mesh.setMatrixAt(n, _mat);
            const need = Math.max(1, gatherTicksFor(ALLY_DEFS[a.defId], cell.kind));
            this.fillAttr.setX(n, Math.min(1, a.gatherTicks / need));
            this.kindAttr.setX(n, 5);
            n++;
          }
        }
        // 짐 칩 — 진 개수만큼 나란히. **운반 중에도 계속 떠 있다**: §4-4의
        // "캐기는 맞으면 중단, 운반은 안 중단"이 화면에서 갈리는 자리가 여기다
        // (게이지는 맞으면 0으로 깨지고, 칩은 그대로 남는다).
        for (let i = 0; i < a.carryCount && n < CAPACITY; i++) {
          cellToWorld(lerp(a.prevX, a.x, alpha), lerp(a.prevZ, a.z, alpha), _pos);
          // 빌보드는 인스턴스 **위치**에 카메라 우/상 벡터를 더해 만든다 — 월드 x로
          // 옮기면 시점에 따라 두 칩이 겹친다. 그래서 나란히가 아니라 위로 쌓는다
          // (carryCap이 2라 두 칸이면 충분하다).
          _pos.y = LOAD_CHIP_Y + i * LOAD_CHIP_GAP;
          _mat.compose(_pos, _quat, _scl.set(LOAD_CHIP, LOAD_CHIP, 1));
          this.mesh.setMatrixAt(n, _mat);
          this.fillAttr.setX(n, (a.id % 7) / 7);
          this.kindAttr.setX(n, 6);
          n++;
        }
      }
      // 자원 배지 — 텄음/예약은 항상, 안 턴 금색은 부족을 고르고 있을 때만
      for (const c of gather.cells) {
        if (n >= CAPACITY) break;
        const key = c.cellZ * gather.gridW + c.cellX;
        let claimed = false;
        for (const a of allies) {
          if (a.alive && a.gatherKey === key) {
            claimed = true;
            break;
          }
        }
        if (!c.taken && !claimed && !gather.selecting) continue;
        cellToWorld(c.cellX, c.cellZ, _pos);
        _pos.y = RES_BADGE_Y;
        _mat.compose(_pos, _quat, _scl.set(RES_BADGE, RES_BADGE, 1));
        this.mesh.setMatrixAt(n, _mat);
        this.fillAttr.setX(n, c.taken ? 0 : claimed ? 0.5 : 1);
        this.kindAttr.setX(n, 7);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fillAttr.needsUpdate = true;
    this.kindAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
