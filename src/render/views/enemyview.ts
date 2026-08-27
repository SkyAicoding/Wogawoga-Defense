/**
 * 지상 유닛 렌더 뷰 — 타입별 InstancedMesh (보스 2종은 개별 Mesh).
 * prev→cur 보간, 보행 리그(버텍스 셰이더), 히트 플래시(instanceColor), 스폰 팝을 처리한다.
 * sim 상태는 EnemyState/AllyState 배열로만 받는다 (sim 모듈 임포트 금지).
 *
 * 보행 위상은 시간이 아니라 이동거리(e.dist)에서 뽑는다 —
 * 그래야 발이 일정 보폭으로 꽂히고, 둔화/배속에서 걸음이 자동으로 맞는다.
 *
 * ── 왜 **아군까지** 이 뷰가 그리는가 ─────────────────────────────────────────
 * 아군은 적 습격대와 **같은 몸통·같은 보행 리그·같은 머티리얼 구성**을 쓴다
 * (meshlib/enemies.ts raiderBody). 뷰를 따로 두면 보간·보행 위상·스폰 팝·히트 플래시가
 * 두 벌이 되고 둘이 어긋나는 순간 아군만 미끄러진다. 그래서 인스턴스 커서(counts)와
 * 애니 상태(anims)를 공유하는 이 뷰가 함께 그린다.
 * 지오메트리는 5단계에서 갈랐다(장비 4벌 / 3벌) — 근거는 아래 addAllyMesh 주석.
 * 구분은 구워진 장비 + instanceColor 색조(ALLY_TINT)가 함께 맡는다.
 *
 * ── UNIT_SHADOW: 인스턴스 유닛은 그림자를 드리우지 않는다 ────────────────────
 * castShadow=true 이면 같은 지오메트리가 **컬러 패스 + 그림자 패스 두 번** 그려진다.
 * 유닛은 인스턴스라 드로우콜은 패스당 1개뿐이지만 **삼각형은 인스턴스 수만큼 두 배**다.
 * 웨이브 스폰 상한이 60이고(balance.WAVE_MAX_SPAWNS) 실제로 스테이지1 웨이브 49에서
 * 동시 생존 45마리·무한 모드 웨이브 72에서 60마리가 관측되므로(sim 실측), 모델당
 * 800~1,700 삼각형 × 60마리 × 2패스 = 20만 삼각형이 유닛만으로 나온다.
 *
 * 실측(swiftshader 900×1000, 적 48 + 아군 6 + 만렙 타워 12 + 마을 Lv5 정지 프레임):
 *   그림자 ON  → 73~93콜 · **247,781 삼각형** (예산 150,000의 165%)
 *   그림자 OFF → 60~80콜 · **139,445 삼각형** (예산의 93%)
 * 즉 유닛 그림자 하나가 프레임 삼각형의 **36%**였다. 이 게임의 카메라는 55° 부감이고
 * 유닛은 화면에서 20~40px이라 발밑 그림자가 가려지는 면적이 크다 — 반면 나무·타워·마을은
 * 크고 고정이라 그림자가 공간을 만든다. 그래서 **고정물은 남기고 유닛만 끈다**.
 * (towers.ts가 이미 같은 판단을 한다: "그림자 캐스터는 타워당 정확히 1개, action/장식은
 *  그림자 미참여" — 그림자 패스를 먼저 깎는 것이 이 프로젝트의 규칙이다.)
 *
 * 보스(개별 Mesh)는 **예외로 그림자를 유지한다**: 동시 2마리 이하라 비용이 2×1,400
 * 삼각형뿐이고, 크고 느려서 그림자가 실제로 읽힌다.
 *
 * 버린 대안 — "낮폴리 그림자 프록시 InstancedMesh 하나를 따로 둔다"(유닛당 12삼각형
 * 상자를 그림자 패스에만 태운다): 삼각형은 1.4k로 끝나지만 컬러 패스에서 colorWrite=false
 * 로라도 한 번 그려야 해서 **드로우콜이 +2**다. 드로우콜 쪽이 지금 더 빡빡하고
 * (아래 실측 참조) 무엇보다 나무·타워의 날카로운 실루엣 그림자 옆에 유닛만 뭉툭한 상자
 * 그림자가 깔려 스타일이 갈린다.
 */
import * as THREE from 'three';
import type { AllyState, EnemyId, EnemyState } from '@/data/types';
import { isGathering } from '@/data/resources';
import { clamp01, easeOutBack, lerp } from '@/core/mathx';
import { flatMat } from '../palette';
import {
  ALL_ENEMY_IDS,
  ALLY_TINT,
  BOSS_ENEMIES,
  BOSS_RENDER_SCALE,
  allyAttackAnim,
  allyGeoKey,
  allyHealAnim,
  allyRig,
  allyVariant,
  buildAlly,
  buildEnemy,
  enemyAttackLean,
  enemyGateLean,
  enemyGeoKey,
  enemyRig,
  enemyVariant,
  type AllyAttackAnim,
} from '../meshlib/enemies';
import {
  ATTACK_ATTR,
  GAIT_ATTR,
  VARIANT_SEL_ATTR,
  attackLean,
  cachedGaitMaterials,
  groundLiftAt,
  wrapGait,
  type GaitMaterials,
} from '../meshlib/gait';
import type { CellToWorld } from '../meshlib/terrain';

const CAPACITY = 100;
const FLY_ALTITUDE = 1.6;
const TAU = Math.PI * 2;
/**
 * 멈춰 서서 타워를 두들기는 적의 팔 휘두름 속도 (rad/s).
 * 보행 위상은 **이동거리**에서 뽑기 때문에(발 미끄러짐 방지) 멈춘 유닛은 리그가 통째로
 * 얼어붙는다. 그래서 "정지 + 공격 중"일 때만 위상을 시간으로 굴린다 —
 * 제자리 걸음이 곧 내려치는 팔 동작이 된다(팔은 다리와 반대 위상이라 교대로 나간다).
 * 걸으면서 쏘는 원거리 유닛에는 절대 더하면 안 된다(다리가 이동보다 빨라져 미끄러진다).
 */
const ATTACK_SWING_RATE = 9;
/** 공격 중 앞으로 기울이는 최대 각(rad) — 내려치는 순간에 몸이 따라 나간다 */
const ATTACK_LEAN = 0.22;
/**
 * **문간 한 대의 주기 (초)** — 문 앞에 선 적이 마을을 무는 동작 한 번의 길이.
 *
 * 1.0 인 이유는 sim 의 한 입 주기(`GATE_BITE_TICKS` 30틱)와 같은 박자이기 때문이다.
 * ⚠ 그렇다고 `@/data` 에서 그 상수를 끌어오지는 **않는다**: 이 값은 순수 연출이라
 * 어긋나도 판정이 한 톨도 안 바뀌고(피해는 sim 이 정한다), 대신 상수를 끌어오면
 * 렌더 핫루프가 밸런스 표에 묶여 "박자를 조금 늦추자"가 밸런스 변경이 된다.
 * 이 파일이 `ATTACK_SWING_RATE = 9`(rad/s)를 쿨다운과 무관하게 고른 것과 같은 규약이다.
 *
 * 개체마다 `phaseOffset01(id)` 만큼 어긋내므로 문 앞의 대열이 한 몸처럼 내려치지 않는다 —
 * 실제로도 개체의 한 입 시각은 **도착한 틱**이 정하므로 제각각이다.
 */
const GATE_SWING_PERIOD = 1;

/**
 * **한 입의 포락선** 0..1 → 0..1 — 뒤로 젖혔다가 앞으로 꽂고 되돌아온다.
 *
 * `sin(p·2π)` 한 주기를 쓰지 않은 이유는 그것이 **대칭**이기 때문이다. 대칭 곡선은
 * 들어가는 시간과 나오는 시간이 같아 "물어뜯는다"가 아니라 "흔들린다"로 읽힌다
 * (사용자가 물린 그 화면이 정확히 그랬다 — 게다가 옛 위상은 실제 한 입과 박자도 어긋나 있었다).
 *
 * 여기서는 셋으로 나눈다:
 *   p < WIND(0.55) : 0 → −0.25  **뒤로 젖힌다** (때릴 것을 예고한다 = 눈이 따라온다)
 *   p < STRIKE(0.75): −0.25 → 1  **앞으로 꽂는다** (짧고 빠르다. 끝점이 곧 피해 틱)
 *   그 뒤            : 1 → 0     되돌아온다 (젖히기보다 길게 = 무게가 실린다)
 * 되돌아온 끝값이 0 이라 다음 주기와 이어져도 자세가 안 튄다(옛 sin 과 같은 성질).
 * 음수 구간이 있으므로 호출부는 **빼기**로 쓴다 — 젖힐 때는 뒤로, 꽂을 때는 앞으로.
 */
const BITE_WIND = 0.55;
const BITE_STRIKE = 0.75;
const BITE_BACK = 0.25;
function biteEnvelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < BITE_WIND) return -BITE_BACK * Math.sin((p / BITE_WIND) * Math.PI);
  if (p < BITE_STRIKE) {
    const q = (p - BITE_WIND) / (BITE_STRIKE - BITE_WIND);
    return -BITE_BACK + (1 + BITE_BACK) * q * q; // 가속하며 꽂는다
  }
  const q = (p - BITE_STRIKE) / (1 - BITE_STRIKE);
  return 1 - q * q * (3 - 2 * q); // smoothstep 으로 되돌아온다
}
/*
 * ── ⚠⚠ 옛 `GATE_LEAN = 0.34` 이 여기 있었다. 상수를 지운 이유 ────────────────
 * 그 각은 `swinging`(ATTACK_LEAN 0.22)과 **겹쳐** 있었다 — 아래 `marking` 이
 * `lean === 0 && (atGate || …)` 이라 문간에서 언제나 참이었기 때문이다. 곧 문간의
 * 실제 최대 앞기울임은 0.56 이었고, **각이 하나뿐이라 물기 깊이가 모델 높이에 비례**했다:
 * 코끝이 trex 0.738 · spino 0.937 · golem 0.941 · shaman 0.954 로 구조물 중심선 1.0 보다
 * 깊이 들어갔다(= 지붕 관통). 옛 주석이 "주둥이가 지붕 선에 닿는 각"이라고 적은 것은
 * 참이었지만, 그 문장이 **한 종(trex)에 대해서만** 참이었다.
 *
 * 그래서 각을 상수로 두는 대신 **겹침폭 `GATE_BITE_DEPTH` 를 상수로 두고 각을 메시에서
 * 역산**한다(meshlib/enemies.ts `enemyGateLean`). 코끝이
 * `GATE_STANDOFF_EDGE − GATE_BITE_DEPTH` 로 전 종 동일해진다.
 * ⚠ 그 역산이 뜻을 가지려면 문간에서 `ATTACK_LEAN` 이 **겹치면 안 된다** — 아래
 *   `marking && !atGate` 가 그 한 줄이다. 두들기기(타워)에는 그대로 남는다.
 */
/** "멈춰 있다"로 보는 한 틱 이동거리 상한 (타일) */
const STOPPED_EPS = 1e-4;
/**
 * 조준 자세로 들고 나는 속도 (1/s). 서는 순간 팔이 딱 하고 튀면 정지가 사고처럼 보인다 —
 * 0.15초쯤 들어 올리게 두면 "멈춰 서서 겨눈다"는 한 동작이 된다.
 * 다시 걸을 때도 같은 속도로 풀려 보행 스윙으로 되돌아간다.
 */
const AIM_RATE = 7;
/**
 * 보스 머티리얼 예열 프레임 수.
 * three 는 머티리얼을 **처음 그릴 때** GL 프로그램을 링크한다. 보스는 비인스턴스 변종이라
 * 인스턴스용과 프로그램을 공유하지 못해, 그냥 두면 하필 보스 등장 프레임에 링크 스톨이 걸린다.
 * 그래서 전투 시작 직후 몇 프레임 동안 보스 메시를 0에 가까운 스케일로 그려 미리 링크시킨다.
 */
const BOSS_WARM_FRAMES = 2;
const WARM_SCALE = 1e-4;
/**
 * 종당 미리 만들어 두는 보스 슬롯 수.
 * 머티리얼 인스턴스마다 GL 프로그램을 따로 잡으므로(같은 소스라도) 동시에 나올 수 있는
 * 만큼 예열해야 한다 — 스테이지6 웨이브20 은 spino 를 두 마리 같이 내보낸다.
 */
const BOSS_WARM_SLOTS = 2;

interface Anim {
  age: number;
  flash: number;
  /** 조준 자세 블렌드 0..1 — siegeHoldLeft 를 따라 완만히 오르내린다 */
  aim: number;
  /**
   * **관측한 한 입 주기 (틱)** — 문간 물기 위상의 분모다. 0 = 아직 한 입도 못 봤다.
   *
   * 왜 상수를 안 쓰고 **관측**하는가: 주기는 `balance.GATE_BITE_TICKS` 가 기본값이지만
   * 스테이지가 `stage.gate.biteTicks` 로 덮어쓸 수 있다(sim/gate.ts `biteTicks`).
   * 상수를 import 하면 그 덮어쓴 판에서 동작과 실제 한 입이 어긋나고, 그건 정확히
   * 옛 자유 진동이 하던 잘못이다. `gateBiteCdLeft` 는 한 입 직후 주기 전체로 채워지므로
   * **관측 최댓값이 곧 그 판의 주기**다 — 원본에서 오는 값이라 절대 안 낡는다.
   */
  biteCd: number;
}

/**
 * 개체별 보행 위상 오프셋 (0..1).
 * id 에 상수를 곱하면 같은 웨이브에서 연속 id 로 스폰된 무리가 **등간격 위상**이 되어
 * 흩어지는 게 아니라 물결처럼 파도타기를 한다 — 정수 해시로 흩뿌린다.
 */
function phaseOffset01(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _quat2 = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const AXIS_X = new THREE.Vector3(1, 0, 0);

/**
 * 인스턴스 어트리뷰트를 지오메트리에 붙이고 돌려준다 (이미 있으면 재사용).
 * 지오메트리는 캐시 공유물이라 전투 재진입 때 같은 GPU 버퍼를 다시 쓴다.
 */
function instAttr(
  geo: THREE.BufferGeometry,
  name: string,
  itemSize = 1,
): THREE.InstancedBufferAttribute {
  const found = geo.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
  if (found) return found;
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * itemSize), itemSize);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, attr);
  return attr;
}

/**
 * 공격 동작 진행도 0..1 — 틱 카운터(attackAnimLeft)를 렌더 alpha 로 이어 붙인다.
 * 그냥 틱 값만 쓰면 12틱(0.4초) 동작이 60fps 화면에서 **12칸짜리 계단**으로 끊긴다.
 * 동작이 없으면 0을 준다: 셰이더의 두 포락선은 p=0 과 p=1 에서 같은 값(0)이라
 * 끝난 동작을 0으로 되돌려도 자세가 튀지 않는다.
 */
function attackProgress(left: number, ticks: number, alpha: number): number {
  if (left <= 0 || ticks <= 0) return 0;
  return clamp01(1 - (left - alpha) / ticks);
}

/**
 * 캐기 한 번(훑어 내리기)의 길이 (틱). 30 = 1.0초.
 *
 * 왜 새 상수인가: 캐는 동안에는 **쿨다운이 돌지 않는다**(캐는 중은 전투 불능이라
 * 조준도 타격도 없다 — gather-spec D5). 그래서 아래 `allyAttackProgress`의 역산이
 * 얼어붙어 팔이 한 자세로 굳는다. 채집 자세만은 뷰가 위상을 직접 만들어야 하고
 * (meshlib/enemies.ts 채집 포즈 4의 ⚠⚠ 주석이 이 일을 T5 소관으로 적어 뒀다),
 * 그 위상의 출처는 시간이 아니라 **gatherTicks**다 — 그래야 배속·일시정지에서
 * 손놀림이 진행과 같이 가고, 맞아서 진행분이 0으로 돌아가면(D5) 동작도 처음부터 다시 시작해
 * "손이 멈췄다"가 팔에서도 읽힌다.
 */
const GATHER_SWING_TICKS = 30;

/**
 * 아군 공격 동작 진행도 0..1 — **쿨다운 잔여 틱에서 역산한다.**
 *
 * 습격대는 sim 이 동작 전용 카운터(attackAnimLeft)를 실어 보내지만 AllyState 에는
 * 그런 필드가 없다(sim 은 아군 연출을 모른다). 그래도 필요한 정보는 전부 있다:
 * `attackCdLeft` 는 타격 순간 쿨다운 전체로 채워져 매 틱 1씩 주므로,
 *   지난 타격 이후 흐른 틱 = cooldown − attackCdLeft,  다음 타격까지 = attackCdLeft
 * 두 값을 동시에 준다. 곧 **다음 타격이 언제인지 미리 안다** — 그래서 타격 틱보다
 * 앞서 팔을 들어 올렸다가(젖히기) 정확히 그 틱에 내려칠 수 있다.
 * 이것이 this.time 으로 자유 진동시키던 옛 방식과의 결정적 차이다: 자유 진동은
 * 피해가 들어가는 틱과 영원히 어긋나 "때리는 시늉"으로만 보인다.
 *
 * 동작은 타격 지점(anim.impact)을 기준으로 **앞뒤 두 조각**으로 놓인다.
 *   [타격 − wind틱, 타격]  → 진행도 0 → impact  (치켜드는 구간)
 *   [타격, 타격 + rec틱]   → 진행도 impact → 1  (내려친 뒤 복귀)
 * 동작 길이가 쿨다운 이하라(anim.ticks) 두 조각은 절대 겹치지 않고, 그 바깥은 0이다.
 * 포락선이 진행도 0 과 1 에서 똑같이 0이므로(gait.ts attackEnvelope) 조각과 조각
 * 사이에서 자세가 튀지 않는다 — 0 은 "동작 없음"과 같은 자세다.
 *
 * ⚠ 젖히기는 **적을 물고 있을 때만**(engaged) 켠다. 사거리에 아무도 없는 아군은
 * 쿨다운이 0에 눌러앉아 있어서, 그대로 두면 "다음 타격까지 0틱"으로 읽혀 팔이
 * 내려치기 직전 자세로 **얼어붙는다**. 대기 중에는 0(보행/정지 자세)이 맞다.
 * 반대로 복귀 구간은 조건 없이 끝까지 재생한다 — 마지막 한 대에 적이 죽어 교전이
 * 풀려도 치켜든 팔이 그 자리에서 사라지지 않고 제대로 내려온다.
 */
function allyAttackProgress(
  cdLeft: number,
  anim: AllyAttackAnim,
  engaged: boolean,
  alpha: number,
): number {
  const wind = anim.impact * anim.ticks;
  const rec = anim.ticks - wind;
  // 틱 카운터를 렌더 alpha 로 이어 붙인다 (습격대 attackProgress 와 같은 규약)
  const since = anim.cooldown - cdLeft + alpha;
  if (since < rec) return anim.impact + since / anim.ticks;
  const toGo = cdLeft - alpha;
  if (engaged && toGo >= 0 && toGo < wind) return anim.impact - toGo / anim.ticks;
  return 0;
}

/** 인스턴스 어트리뷰트를 앞에서 count 개 요소만 업로드하도록 예약 */
function uploadRange(attr: THREE.BufferAttribute | THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
}

/** `EnemyView` 생성 옵션 */
export interface EnemyViewOptions {
  /**
   * 보스 머티리얼 예열을 켠다 (기본 **true**).
   *
   * 예열은 보스 슬롯 `BOSS_WARM_SLOTS` 개를 미리 만들어 전투 첫 프레임에 한 번 그려
   * GL 프로그램을 링크시키는 장치다(BOSS_WARM_FRAMES 주석). 그 값은 **보스가 나올 수
   * 있는 씬**에서만 있다 — 타이틀·로비 뒤에서 도는 디오라마 배경은 적을 한 마리도
   * 그리지 않으므로 예열 슬롯이 순수 낭비다.
   *
   * 그런데 그 낭비를 **끄는 코드가 `update()` 안에만** 있다(warm 카운터). 배경은
   * `Stage3D.update()` 만 돌고 `EnemyView.update()` 를 부르지 않으므로 슬롯은 영영
   * `visible=true · frustumCulled=false` 로 남아 매 프레임 그려졌다.
   * 실측(s1 정적 배경, 씬 그래프 잣대): 18콜 / 32,417삼각형 중 예열 4메시가
   * **8콜(컬러 4 + 그림자 4) / 10,824삼각형** = 드로우콜의 44% · 삼각형의 33%.
   *
   * 기본값이 true 인 것은 **안전한 쪽이 기본**이기 때문이다. 새 호출부가 이 옵션을
   * 잊으면 최악이 "비전투 씬이 8콜 더 무겁다"이고, 반대로 기본을 false 로 두면
   * 잊은 전투 씬이 **보스 등장 프레임에 셰이더 링크 스톨**을 맞는다.
   */
  readonly warmBoss?: boolean;
}

export class EnemyView {
  /** 키 = 지오메트리 키(enemyGeoKey) — 부족 습격대 4종은 한 메시를 공유한다 */
  private meshes = new Map<string, THREE.InstancedMesh>();
  private gaitAttrs = new Map<string, THREE.InstancedBufferAttribute>();
  /** 공격 채널 (vec2: 진행도, 조준) — 보행과 별개의 두 번째 채널 */
  private atkAttrs = new Map<string, THREE.InstancedBufferAttribute>();
  private varAttrs = new Map<string, THREE.InstancedBufferAttribute>();
  private bossPool = new Map<EnemyId, THREE.Mesh[]>();
  private bossGait = new Map<THREE.Mesh, GaitMaterials>();
  private anims = new Map<number, Anim>();
  private group = new THREE.Group();
  private time = 0;
  private warm: number;

  constructor(scene: THREE.Scene, opts?: EnemyViewOptions) {
    // 예열은 **전투 씬의 장치**다 — 끄면 warm 카운터도 0에서 시작해야 update() 가
    // 곧바로 예열 이후의 상태(컬링 복구)로 돈다.
    const warmBoss = opts?.warmBoss !== false;
    this.warm = warmBoss ? BOSS_WARM_FRAMES : 0;
    this.group.name = 'enemies';
    for (const id of ALL_ENEMY_IDS) {
      if (BOSS_ENEMIES.has(id)) {
        this.bossPool.set(id, []);
        // 보스가 나올 수 없는 씬은 슬롯을 **아예 만들지 않는다**. 만들어 두고
        // visible=false 로 숨기는 길도 있지만, 그러면 그 숨김이 update() 끝의
        // `pool.forEach(m.visible = ...)` 와 갈리는 두 번째 진실이 된다 — 지금 새고 있는
        // 버그가 바로 "가시성의 주인이 update() 하나뿐인데 그 함수가 안 불린다"였다.
        // 만들지 않으면 그 씬은 보스를 그릴 **수단 자체가 없다**(지오메트리 굽는 값도 아낀다).
        if (!warmBoss) continue;
        // 프로그램 링크를 보스 등장 프레임에서 전투 시작 프레임으로 앞당긴다.
        // 첫 슬롯을 미리 만들어 두면 실제 등장 때 그대로 재사용된다.
        for (let i = 0; i < BOSS_WARM_SLOTS; i++) {
          const warm = this.makeBoss(id);
          warm.scale.setScalar(WARM_SCALE);
          warm.position.set(0, -40, 0); // 어떤 시야에도 안 걸리는 지면 한참 아래
          // 컬링을 끄지 않으면 그림자 카메라 밖이라 depth 머티리얼이 컴파일되지 않는다
          // (프로그램 링크는 setProgram 시점이라 정점이 잘려도 예열은 된다)
          warm.frustumCulled = false;
        }
        continue;
      }
      const key = enemyGeoKey(id);
      if (this.meshes.has(key)) continue; // 공유 지오메트리(부족 습격대) — 첫 종이 이미 만들었다
      const geo = buildEnemy(id);
      const rig = enemyRig(id);
      const shared = enemyVariant(id) > 0;
      let mesh: THREE.InstancedMesh;
      if (rig.limbs.length > 0) {
        // 인스턴스별 보행 위상. 지오메트리는 캐시 공유물이지만 이 어트리뷰트를
        // 참조하는 건 적 전용 머티리얼뿐이라(meshlab은 개별 Mesh + flatMat) 무해하다.
        // 전투를 다시 열어도 같은 버퍼를 재사용해 GPU 버퍼가 쌓이지 않게 한다.
        this.gaitAttrs.set(key, instAttr(geo, GAIT_ATTR));
        this.atkAttrs.set(key, instAttr(geo, ATTACK_ATTR, 2));
        // 변형 선택(어느 장비를 보여줄 것인가) — 공유 지오메트리에만 필요하다
        if (shared) this.varAttrs.set(key, instAttr(geo, VARIANT_SEL_ATTR));
        const gm = cachedGaitMaterials(key, rig, shared);
        mesh = new THREE.InstancedMesh(geo, gm.color, CAPACITY);
        // 그림자 패스에도 같은 정점 변형을 넣지 않으면 그림자만 다리가 굳는다
        mesh.customDepthMaterial = gm.depth;
      } else {
        mesh = new THREE.InstancedMesh(geo, flatMat(), CAPACITY);
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // instanceColor 초기화 (히트 플래시용)
      for (let i = 0; i < CAPACITY; i++) mesh.setColorAt(i, _col.setRGB(1, 1, 1));
      mesh.count = 0;
      // 규칙: **인스턴스 유닛은 그림자를 드리우지 않는다** (아래 UNIT_SHADOW 주석 참조)
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    }
    this.addAllyMesh();
    scene.add(this.group);
  }

  /**
   * 아군 전용 InstancedMesh — 습격대와 **몸통은 같고 장비만 다른** 별도 지오메트리.
   *
   * 3단계까지는 습격대 메시에 얹어 그렸다("드로우콜 +0"). 5단계에 갈랐다:
   * 변형 마스킹은 자기 것이 아닌 정점을 원점으로 접을 뿐이라 한 인스턴스가 장비 7벌의
   * 정점 비용을 매 프레임 낸다. 습격대가 56마리 동시에 사는 편성(스테이지1 웨이브 49)에서
   * 그 낭비가 프레임을 지배했다 — 최악 프레임 170,341 삼각형(예산 150,000의 114%).
   * 4벌/3벌로 갈라 구우면 인스턴스당 1,662 → 1,146이 되어 최악 프레임이 예산 안으로 들어온다.
   * 대가는 **드로우콜 +1**, 그것도 아군과 습격대가 동시에 화면에 있을 때뿐이다
   * (아군이 없으면 count=0 → three 가 즉시 반환해 0콜). 근거 전문은
   * meshlib/enemies.ts 의 RAIDER_KITS 주석.
   */
  private addAllyMesh(): void {
    const key = allyGeoKey();
    if (this.meshes.has(key)) return;
    const geo = buildAlly();
    const rig = allyRig();
    this.gaitAttrs.set(key, instAttr(geo, GAIT_ATTR));
    this.atkAttrs.set(key, instAttr(geo, ATTACK_ATTR, 2));
    this.varAttrs.set(key, instAttr(geo, VARIANT_SEL_ATTR));
    const gm = cachedGaitMaterials(key, rig, true);
    const mesh = new THREE.InstancedMesh(geo, gm.color, CAPACITY);
    mesh.customDepthMaterial = gm.depth;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < CAPACITY; i++) mesh.setColorAt(i, _col.setRGB(1, 1, 1));
    mesh.count = 0;
    mesh.castShadow = false; // UNIT_SHADOW — 인스턴스 유닛은 그림자를 드리우지 않는다
    mesh.frustumCulled = false;
    this.meshes.set(key, mesh);
    this.group.add(mesh);
  }

  /** 피격 순간 호출 — 흰색 플래시 후 원색 복귀 */
  setHitFlash(enemyId: number): void {
    const a = this.anims.get(enemyId);
    if (a) a.flash = 1;
  }

  update(
    enemies: readonly EnemyState[],
    alpha: number,
    cellToWorld: CellToWorld,
    dt: number,
    allies: readonly AllyState[] = [],
  ): void {
    this.time += dt;
    const counts = new Map<string, number>();
    const bossUsed = new Map<EnemyId, number>();
    const seen = new Set<number>();

    for (const e of enemies) {
      if (!e.alive) continue;
      seen.add(e.id);
      let anim = this.anims.get(e.id);
      if (!anim) {
        anim = { age: 0, flash: 0, aim: 0, biteCd: 0 };
        this.anims.set(e.id, anim);
      }
      // 일시정지 프레임은 dt 로 0 대신 0.0001 이 들어온다(battlecontroller).
      // 그대로 누적하면 정지 중에도 스폰 팝이 프레임마다 조금씩 기어간다.
      if (dt > 1e-3) {
        anim.age += dt;
        anim.flash = Math.max(0, anim.flash - dt * 5);
        // 조준 자세는 정지 상태(siegeHoldLeft)를 따라 완만히 들고 난다.
        // **문간(gateTicks > 0)도 같은 정지다** — 마을 문 앞에 선 적은 걷지 않고
        // 눈앞의 것을 팬다(src/sim/gate.ts 규칙 3·4). 자세를 안 바꾸면 대열 전체가
        // 걷다 만 자세로 얼어붙어 "멈춰 서서 때린다"가 화면에서 사라진다.
        const want = e.siegeHoldLeft > 0 || e.gateTicks > 0 ? 1 : 0;
        anim.aim += (want - anim.aim) * Math.min(1, dt * AIM_RATE);
      }

      // 보간 위치 (셀 연속 좌표 → 월드)
      const sx = lerp(e.prevX, e.x, alpha);
      const sz = lerp(e.prevZ, e.z, alpha);
      cellToWorld(sx, sz, _pos);

      const rig = enemyRig(e.defId);
      const rigged = rig.limbs.length > 0;
      // 보행 위상도 위치와 **같은 alpha 로 보간**해야 한다.
      // e.dist 는 틱 경계값이라 그대로 쓰면 틱이 없는 렌더 프레임에서 몸통만 나아가고
      // 다리는 멈춰 있어, 디딤발이 한 틱 이동거리만큼 밀렸다 되돌아온다(30Hz 톱니).
      const step = Math.hypot(e.x - e.prevX, e.z - e.prevZ);
      const travel = e.dist - step * (1 - alpha);
      // 개체마다 위상을 어긋내 무리가 한 몸처럼 걷지 않게 한다
      const off = phaseOffset01(e.id) * TAU;
      /**
       * 공격 채널 — 이 종에 공격 포즈가 있으면(lean ≠ 0) 팔·머리를 그쪽이 가져간다.
       * 포즈가 없는 공룡·짐승은 예전처럼 "멈춘 채 위상을 시간으로 굴리는" 폴백을 쓴다.
       * 두 길을 섞으면 던지는 팔이 제자리걸음까지 겹쳐 박자가 두 개가 된다.
       */
      const lean = enemyAttackLean(e.defId);
      /*
       * **문간** — 마을 문 앞에 서서 마을을 무는 중(src/sim/gate.ts).
       * 여기서 갈리는 것은 "무엇을 때리는가"가 아니라 **동작의 출처**다:
       * 타워 타격은 sim 이 동작 카운터(attackAnimLeft)를 실어 보내지만, 한 입은
       * 마을 HP 를 1 깎는 회계일 뿐이라 개체 동작 카운터가 없다. 그래서 문간의
       * 동작만은 뷰가 위상을 직접 만든다 — 채집 자세(GATHER_SWING_TICKS)와 같은 사정이고
       * 같은 해법이다.
       *
       * 위상은 **개체마다 어긋난 1초 톱니**다. 포락선이 p=0 과 p=1 에서 똑같이 0이라
       * (gait.ts attackEnvelope) 톱니가 되감기는 순간에도 자세가 안 튄다.
       */
      const atGate = e.gateTicks > 0;
      /*
       * ⚠⚠ **자유 진동을 걷어냈다** (사용자 지적: "공룡이 홈타운을 공격할때 …
       *   지금은 가만 있잖아"). 옛 위상은 `this.time / GATE_SWING_PERIOD` 였고
       *   `GATE_SWING_PERIOD = 1초` 는 **그 시절 한 입 주기(30틱)** 에 맞춘 값이었다.
       *   그 뒤 `GATE_BITE_TICKS` 가 30 → 60(2초)이 되면서 동작이 **한 입당 두 번**
       *   돌게 됐다 — 곧 물어뜯는 시늉과 마을이 실제로 깎이는 순간이 영영 안 맞고,
       *   화면에서는 "때리는 것 같지도 않은데 HP만 준다"로 읽힌다.
       *
       *   지금은 sim 의 **한 입 쿨다운**에서 역산한다(아군 `allyAttackProgress` 와 같은
       *   규약). 주기는 관측값이라(anim.biteCd) 스테이지가 덮어써도 따라간다.
       *   한 입이 들어가는 그 틱에 목이 가장 깊이 들어간다.
       */
      if (atGate) anim.biteCd = Math.max(anim.biteCd, e.gateBiteCdLeft);
      const biteP =
        atGate && anim.biteCd > 0
          ? clamp01((anim.biteCd - e.gateBiteCdLeft + alpha) / anim.biteCd)
          : 0;
      // 물기 포락선 — 뒤로 젖혔다가(0~0.55) 앞으로 꽂고(0.55~0.75) 되돌아온다(~1).
      // `sin` 한 주기가 아니라 **비대칭**이라야 "때린다"로 읽힌다: 되돌아오는 구간이
      // 길면 늘어져 보이고, 짧으면 튄다.
      const gateP = biteP;
      const atkP = atGate
        ? gateP
        : lean > 0
          ? attackProgress(e.attackAnimLeft, e.attackAnimTicks, alpha)
          : 0;
      // 문간에서는 던지는 포즈가 없는 종(공룡·짐승)도 상체를 쓴다 — 아래 swing 과
      // 합쳐 "제자리 걸음 + 앞으로 물어뜯기"가 된다. lean 0 인 종은 attackLean 이
      // 0을 돌려주므로 기울임은 뒤의 `enemyGateLean` 이 따로 준다.
      const aim = atGate || lean > 0 ? anim.aim : 0;
      /*
       * 멈춰 서서 때리는 중 — 공격 포즈가 없는 종만 위상을 시간으로 굴린다.
       * 문간이 조건에 들어온 이유: 문 앞의 적은 `towerTargetId` 가 −1 이다
       * (gate.ts 규칙 4 — 문간의 적은 타워를 안 때린다). 그대로 두면 공룡 대열이
       * **통째로 얼어붙는다**. 이 게임에서 가장 오래 보이는 정지 장면이 그거라면
       * 사용자 요구("문 앞에서 서로 때린다")가 화면에 도착하지 않는다.
       */
      /*
       * ⚠ **주민을 때리는 중(난투)도 여기 들어온다** — 사용자 지적:
       *   > "공룡 옆에 우리 주민이 가까이 가면 그냥 죽어 버리는데 … 공격하는
       *   >  애니매이션을 하고 주민을 죽어야 해."
       * 난투는 `towerTargetId` 도 `gateTicks` 도 안 쓴다(타워도 마을도 아닌 사람을
       * 때린다). 그래서 옛 조건으로는 **공룡이 미동도 없이 서 있는데 주민만 죽었다.**
       * sim 이 난투 때 `attackAnimLeft` 를 채워 주므로(sim/allies.ts) 그 값으로 잡는다.
       */
      const brawling = e.attackAnimLeft > 0;
      const marking =
        lean === 0 && (atGate || brawling || (e.towerTargetId >= 0 && step < STOPPED_EPS));
      const swing = marking ? this.time * ATTACK_SWING_RATE : 0;
      const gait = rigged
        ? wrapGait(travel * rig.gaitPerDist + off + swing)
        : (travel / Math.max(0.5, e.radius * 3.2)) * TAU + off + swing;

      // 스폰 팝 스케일 (접지 보정보다 먼저 — 보정은 모델 단위라 스케일을 먹여야 한다)
      const pop = anim.age < 0.28 ? easeOutBack(anim.age / 0.28) : 1;
      const boss = BOSS_ENEMIES.has(e.defId);
      const scale = pop * (boss ? BOSS_RENDER_SCALE : 1);

      let pitch = 0;
      let roll = 0;
      if (e.flying) {
        if (rigged) {
          // 내려치기(위상 π/2 부근)에서 몸이 떠오른다 — 날갯짓과 위상을 맞춘 보브
          _pos.y = FLY_ALTITUDE - Math.cos(gait) * 0.085;
        } else {
          _pos.y = FLY_ALTITUDE + Math.sin(this.time * 5 + e.id) * 0.12;
          roll = Math.sin(this.time * 9 + e.id * 2) * 0.16; // 날갯짓 롤
        }
      } else if (rigged) {
        // 접지 보정 = 걸음 바운스. 다리가 벌어질수록 몸이 떠오른다(발이 파묻히지 않게).
        // 최고점/최저점이 발 딛는 순간과 자동으로 맞으므로 따로 위상을 맞출 필요가 없다.
        // 표는 **모델 단위**라 메시 스케일(보스 1.15배·스폰 팝)을 그대로 곱해야
        // 발이 지면을 파고들거나 뜨지 않는다.
        _pos.y = groundLiftAt(rig, Math.abs(Math.sin(gait))) * scale;
      } else {
        _pos.y = Math.abs(Math.sin(gait)) * Math.min(0.09, e.radius * 0.22) * scale;
        pitch = Math.sin(gait * 2) * 0.05;
      }
      // 내려치는 반주기(sin>0)에만 앞으로 기운다 — 되돌아올 땐 자세를 세운다.
      // pitch(+z축 회전)는 +x(정면)를 위로 드는 방향이라 앞으로 숙이려면 음수다.
      //
      // ⚠⚠ **문간에서는 안 겹친다**(`!atGate`). 문간 각은 `enemyGateLean` 이 메시에서
      //   역산한 값이라 여기서 0.22 가 더해지면 역산이 통째로 무의미해진다 — 옛 구현이
      //   정확히 그 상태였고(0.22 + 0.34 = 0.56 이 문간의 실제 각이었다), 그래서 물기
      //   깊이가 종마다 제각각이었다. 제자리 걸음(`marking` → `swing` → `gait`)은 그대로
      //   남으므로 다리는 계속 움직인다 — 대열이 얼어붙지 않는다.
      if (marking && !atGate) pitch -= Math.max(0, Math.sin(gait)) * ATTACK_LEAN;
      // 온몸으로 던진다 — 젖힐 때 뒤로, 놓을 때 앞으로. 셰이더와 **같은 포락선**을 쓴다.
      pitch += attackLean(atkP, aim, lean);
      /*
       * 문간 물기 — 마을을 향해 목을 꺾는다. **각이 종마다 다르다**(meshlib
       * `enemyGateLean`): `reach(L) − restReach = GATE_BITE_DEPTH` 를 메시에서 역산한
       * 값이라, 코끝이 `GATE_STANDOFF_EDGE − GATE_BITE_DEPTH` = 1.25 로 전 종 같아진다.
       * 상수 하나였을 때는 같은 각에서 **모델이 높을수록 더 나가** trex 코끝이 0.738 까지
       * 들어갔다(마을 구조물 중심선이 1.0 이다).
       *
       * **공격 포즈가 없는 종(lean 0)에만** 준다. 위 `attackLean` 이 종별 던지기 각에
       * 비례하는데 공룡·짐승은 그 값이 0이라 한 줄만으로는 몸이 하나도 안 기울기
       * 때문이다. 반대로 던지는 종(습격대 4종 + warrior)에 이걸 겹치면 **기울임이 두
       * 겹**이 되어 던지는 순간 상체가 지면에 닿을 만큼 꺾인다.
       *   ⚠ 그 다섯은 문간에서도 던지기 각 그대로다(`0.3 × enemyAttackLean`). 겹침폭이
       *     0.033~0.173 으로 작아 코끝이 1.277~1.417 에 남는다 — 곧 목표선 1.25 보다
       *     **얕게** 문다. 안전 성질("아무도 1.25 보다 깊이 안 들어간다")을 이미 만족하므로
       *     건드리지 않는다(`tests/render/gatepose.test.ts` §2 가 다섯도 함께 잰다).
       * sin 반주기만 쓰는 것은 위 `marking` 과 같은 규약이다 — 내려칠 때만 숙이고
       * 되돌아올 때는 자세를 세운다. `anim.aim` 을 곱해 서는 순간 0.15초에 걸쳐
       * 들어가고, 문간을 떠나면 같은 속도로 풀린다.
       */
      if (atGate && lean === 0) {
        pitch -= biteEnvelope(gateP) * enemyGateLean(e.defId) * anim.aim;
      } else if (brawling && lean === 0) {
        /*
         * **난투 물어뜯기** — 문간과 같은 각(`enemyGateLean`)을 쓴다. 그 각은 메시에서
         * 역산한 "코끝이 몸 앞 얼마나 나가는가"라 대상이 마을이든 사람이든 같은 뜻이고,
         * 종마다 자기 몸에 맞는 깊이가 나온다. 여기서 새 상수를 만들면 그 역산이
         * 두 벌이 되고, 이 저장소가 세 번 당한 "잣대가 두 벌"이 다시 생긴다.
         * 위상은 sim 의 동작 카운터에서 온다 — 곧 **피해가 들어가는 틱에 가장 깊다**.
         */
        pitch -= biteEnvelope(attackProgress(e.attackAnimLeft, e.attackAnimTicks, alpha));
      }

      _quat.setFromAxisAngle(AXIS_Y, -e.heading);
      _quat2.setFromAxisAngle(AXIS_Z, pitch);
      _quat.multiply(_quat2);
      if (roll !== 0) {
        _quat2.setFromAxisAngle(AXIS_X, roll);
        _quat.multiply(_quat2);
      }

      if (boss) {
        this.updateBoss(e, bossUsed, scale, anim, gait, atkP, aim);
        continue;
      }

      const key = enemyGeoKey(e.defId);
      const mesh = this.meshes.get(key);
      if (!mesh) continue;
      const idx = counts.get(key) ?? 0;
      if (idx >= CAPACITY) continue;
      counts.set(key, idx + 1);
      _mat.compose(_pos, _quat, _scl.setScalar(scale));
      mesh.setMatrixAt(idx, _mat);
      this.gaitAttrs.get(key)?.setX(idx, gait);
      this.atkAttrs.get(key)?.setXY(idx, atkP, aim);
      // 공유 지오메트리(부족 습격대): 이 인스턴스가 어떤 장비를 보일지 고른다
      this.varAttrs.get(key)?.setX(idx, enemyVariant(e.defId));
      // 플래시: 값을 크게 줘 톤매핑 후 흰색 포화
      const f = 1 + anim.flash * anim.flash * 7;
      mesh.setColorAt(idx, _col.setRGB(f, f, f));
    }

    this.updateAllies(allies, alpha, cellToWorld, dt, counts, seen);

    for (const [key, mesh] of this.meshes) {
      const n = counts.get(key) ?? 0;
      mesh.count = n;
      // 빈 타입은 아예 숨긴다. count=0 이어도 frustumCulled=false 라 렌더 리스트에는 올라가
      // 그리지도 않을 메시의 프로그램/유니폼(사지 테이블 36 vec4)이 컬러·그림자 두 패스에서
      // 매 프레임 올라간다.
      mesh.visible = n > 0;
      if (n === 0) continue;
      // 살아 있는 인스턴스 구간만 올린다 (CAPACITY 100칸 전체를 매 프레임 재업로드하지 않게)
      uploadRange(mesh.instanceMatrix, n * 16);
      if (mesh.instanceColor) uploadRange(mesh.instanceColor, n * 3);
      const gait = this.gaitAttrs.get(key);
      if (gait) uploadRange(gait, n);
      const atk = this.atkAttrs.get(key);
      if (atk) uploadRange(atk, n * 2);
      const vsel = this.varAttrs.get(key);
      if (vsel) uploadRange(vsel, n);
    }
    // 사라진 적의 애니 상태/보스 메시 정리
    for (const key of this.anims.keys()) {
      if (!seen.has(key)) this.anims.delete(key);
    }
    if (this.warm > 0) this.warm--;
    for (const [id, pool] of this.bossPool) {
      const used = bossUsed.get(id) ?? 0;
      // 예열 프레임 동안은 첫 슬롯을 보이게 둬 프로그램을 링크시킨다(스케일 1e-4, 지면 아래)
      pool.forEach((m, i) => {
        m.visible = i < used || (this.warm > 0 && i < BOSS_WARM_SLOTS);
        if (this.warm === 0) m.frustumCulled = true; // 예열 끝 — 컬링 복구
      });
    }
  }

  /**
   * 아군 인스턴스를 아군 전용 메시에 쌓는다 (5단계에 습격대 메시에서 갈렸다 — addAllyMesh 주석).
   * 적 루프와 공유하는 것: counts(인스턴스 커서) · seen(애니 상태 GC) · anims(스폰 팝/조준 블렌드).
   *
   * 아군은 판 위를 자유롭게 걷는다(9단계 — 경로 역주행은 폐기됐다). 그래서 보행 위상은
   * 좌표가 아니라 **걸은 총 거리**(walked)에서 뽑는다 — 방향과 무관하게 언제나 늘어나므로
   * 앞뒤로 오가도 다리가 얼거나 거꾸로 돌지 않는다.
   *
   * 11단계에 **공격이 이 함수의 두 번째 축**이 됐다. 몸통·리그가 습격대와 같은 코드에서
   * 나오므로 공격 채널(gait.ts aAtk)도 그대로 쓴다 — 팔·머리만 포즈가 가져가고 다리는
   * 보행/정지 그대로 남는다. 다른 것은 진행도의 출처 하나뿐이다: 습격대는 sim 이 동작
   * 카운터를 실어 보내지만 아군은 **쿨다운 잔여 틱에서 역산**한다(allyAttackProgress).
   */
  private updateAllies(
    allies: readonly AllyState[],
    alpha: number,
    cellToWorld: CellToWorld,
    dt: number,
    counts: Map<string, number>,
    seen: Set<number>,
  ): void {
    if (allies.length === 0) return;
    const key = allyGeoKey();
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    const rig = allyRig(); // 몸통은 습격대와 같고 접지 보정만 아군 지오메트리 것을 쓴다
    for (const a of allies) {
      if (!a.alive) continue;
      seen.add(a.id);
      let anim = this.anims.get(a.id);
      if (!anim) {
        anim = { age: 0, flash: 0, aim: 0, biteCd: 0 };
        this.anims.set(a.id, anim);
      }
      const step = Math.hypot(a.x - a.prevX, a.z - a.prevZ);
      if (dt > 1e-3) {
        anim.age += dt;
        anim.flash = Math.max(0, anim.flash - dt * 5);
        // 조준 자세는 **멈춰 서서 적을 물고 있을 때만** 든다. 걸어가는 중에는 0이라
        // 팔이 보행 스윙 그대로 남고, 그 위로 타격 동작만 잠깐 얹힌다(take = wb+fw).
        // 서서 겨누는 동안에는 젖힌 자세로 굳어 "몽둥이를 들고 벼르는" 그림이 된다.
        // ⚠ **회복 중도 '멈춰서 무언가 하는 중'이다.** 마법사는 `targetId` 가 −1 이라
        //   이 줄만으로는 자세가 0 으로 굳는다 — 사용자가 물린 그 정지 화면이다.
        const busy = a.targetId >= 0 || a.healCdLeft > 0;
        const want = busy && step < STOPPED_EPS ? 1 : 0;
        anim.aim += (want - anim.aim) * Math.min(1, dt * AIM_RATE);
      }
      const idx = counts.get(key) ?? 0;
      if (idx >= CAPACITY) return;
      counts.set(key, idx + 1);

      const sx = lerp(a.prevX, a.x, alpha);
      const sz = lerp(a.prevZ, a.z, alpha);
      cellToWorld(sx, sz, _pos);
      // 9단계: 아군이 경로를 떠나면서 `-a.dist`(역주행 호장)가 사라졌다. 대신 태어나서
      // 걸은 총 거리 `walked`를 쓴다 — 방향과 무관하게 **언제나 증가**하므로 앞뒤로
      // 오가도 다리가 얼거나 거꾸로 돌지 않는다. 보간은 적과 같은 규약(한 틱 뒤로 되감기).
      const travel = a.walked - step * (1 - alpha);
      const off = phaseOffset01(a.id) * TAU;
      /**
       * 보행 위상은 **오직 걸은 거리**에서 나온다. 11단계까지는 여기에 "멈춰서 때리는
       * 중이면 시간을 9rad/s로 더한다"는 폴백이 있었는데, 그 위상은 사지 전부가 공유하는
       * 값이라 팔을 빨리 돌리려다 **다리까지 같이 빨라져 제자리 뜀박질**이 됐다.
       * 이제 팔·머리는 공격 채널이 배역으로 가져가므로(아래 atkP) 폴백이 필요 없다 —
       * 멈춘 아군은 이동거리가 늘지 않아 다리가 저절로 정지 자세로 굳는다.
       */
      const gait = wrapGait(travel * rig.gaitPerDist + off);
      // 공격 채널 — 진행도는 쿨다운 잔여 틱에서 역산해 **피해가 들어가는 틱**에 맞춘다.
      // 단, 캐는 중이면 같은 채널을 **채집 위상**이 가져간다(위 GATHER_SWING_TICKS).
      // 같은 채널을 쓰므로 포즈가 겹칠 걱정이 없다: 캐는 사람은 전투 불능이라 조준도
      // 타격도 없고(targetId −1), 반대로 싸우는 사람은 gatherKey가 −1이라 여기 안 온다.
      /*
       * ── 배역이 셋이다: 채집 · 전투 · **회복** ──────────────────────────────
       * 셋 다 같은 채널(팔·머리)을 쓰고 서로 배타다. 우선순위는 위에서부터고, 회복이
       * 전투보다 **뒤**인 이유는 마법사가 싸우면서도 회복하기 때문이다(sim/heal.ts) —
       * 싸우는 중이면 내려치는 자세가 맞고, 회복만 할 때 지팡이를 든다.
       *
       * ⚠ 회복 배역이 없던 동안 마법사는 판 위에서 **한 번도 안 움직였다**(사용자 지적).
       *   `targetId` 가 −1 이라 `allyAttackProgress` 가 언제나 0 을 돌려줬기 때문이다.
       */
      const healing = a.targetId < 0 && a.healCdLeft > 0;
      const atk = healing ? allyHealAnim(a.defId) : allyAttackAnim(a.defId);
      const atkP = isGathering(a)
        ? ((a.gatherTicks + alpha) % GATHER_SWING_TICKS) / GATHER_SWING_TICKS
        : healing
          ? allyAttackProgress(a.healCdLeft, atk, true, alpha)
          : allyAttackProgress(a.attackCdLeft, atk, a.targetId >= 0, alpha);
      const pop = anim.age < 0.28 ? easeOutBack(anim.age / 0.28) : 1;
      _pos.y = groundLiftAt(rig, Math.abs(Math.sin(gait))) * pop;
      // 온몸으로 내려친다 — 치켜들 때 뒤로, 내려칠 때 앞으로. 셰이더와 **같은 포락선**이다
      const pitch = attackLean(atkP, anim.aim, atk.lean);
      _quat.setFromAxisAngle(AXIS_Y, -a.heading);
      _quat2.setFromAxisAngle(AXIS_Z, pitch);
      _quat.multiply(_quat2);
      _mat.compose(_pos, _quat, _scl.setScalar(pop));
      mesh.setMatrixAt(idx, _mat);
      this.gaitAttrs.get(key)?.setX(idx, gait);
      this.atkAttrs.get(key)?.setXY(idx, atkP, anim.aim);
      this.varAttrs.get(key)?.setX(idx, allyVariant(a.defId));
      // 아군은 한랭 색조로 물들여 적과 즉시 갈린다. 피격 플래시는 그 위에 더한다
      const f = anim.flash * anim.flash * 7;
      mesh.setColorAt(idx, _col.setRGB(ALLY_TINT[0] + f, ALLY_TINT[1] + f, ALLY_TINT[2] + f));
    }
  }

  /** 보스 개체 메시 1개 생성 (풀에 넣고 그룹에 붙인다) */
  private makeBoss(id: EnemyId): THREE.Mesh {
    const pool = this.bossPool.get(id)!;
    const rig = enemyRig(id);
    let mesh: THREE.Mesh;
    if (rig.limbs.length > 0) {
      // 보스 전용: 머티리얼 인스턴스를 개체마다 따로 (플래시는 emissive, 보행 위상은 유니폼)
      const gm = cachedGaitMaterials(`${id}#${pool.length}`, rig);
      mesh = new THREE.Mesh(buildEnemy(id), gm.color);
      mesh.customDepthMaterial = gm.depth;
      this.bossGait.set(mesh, gm);
    } else {
      mesh = new THREE.Mesh(buildEnemy(id), flatMat().clone());
    }
    // UNIT_SHADOW 예외 — 보스는 동시 2마리 이하라 그림자 패스가 2×1,400 삼각형뿐이고,
    // 크고 느려서 그림자가 실제로 읽힌다 (헤더 주석 참조)
    mesh.castShadow = true;
    pool.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** 보스는 개별 Mesh (동시 ≤2 전제) — 이미 계산된 _pos/_quat 사용 */
  private updateBoss(
    e: EnemyState,
    bossUsed: Map<EnemyId, number>,
    scale: number,
    anim: Anim,
    gait: number,
    atkP: number,
    aim: number,
  ): void {
    const pool = this.bossPool.get(e.defId);
    if (!pool) return;
    const idx = bossUsed.get(e.defId) ?? 0;
    bossUsed.set(e.defId, idx + 1);
    const mesh = pool[idx] ?? this.makeBoss(e.defId);
    mesh.visible = true;
    mesh.position.copy(_pos);
    mesh.quaternion.copy(_quat);
    mesh.scale.setScalar(scale);
    // 개별 Mesh 는 인스턴스 어트리뷰트가 없으므로 유니폼으로 위상을 넣는다
    const gm = this.bossGait.get(mesh);
    gm?.setGait(gait);
    gm?.setAttack(atkP, aim);
    const mat = mesh.material as THREE.MeshLambertMaterial;
    mat.emissive.setScalar(anim.flash * 0.9);
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const mesh of this.meshes.values()) mesh.dispose();
    for (const pool of this.bossPool.values()) {
      for (const m of pool) {
        // gait 머티리얼은 캐시 소유물이라 여기서 파기하지 않는다.
        // (파기하면 GL 프로그램 참조가 0이 되어 해제되고, 전투 재진입 때 다시 링크된다)
        if (!this.bossGait.has(m)) (m.material as THREE.Material).dispose();
      }
    }
    this.meshes.clear();
    this.gaitAttrs.clear();
    this.atkAttrs.clear();
    this.varAttrs.clear();
    this.bossGait.clear();
    this.bossPool.clear();
    this.anims.clear();
  }
}
