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
import { clamp01, easeOutBack, lerp } from '@/core/mathx';
import { flatMat } from '../palette';
import {
  ALL_ENEMY_IDS,
  ALLY_TINT,
  BOSS_ENEMIES,
  allyGeoKey,
  allyRig,
  allyVariant,
  buildAlly,
  buildEnemy,
  enemyAttackLean,
  enemyGeoKey,
  enemyRig,
  enemyVariant,
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

/** 인스턴스 어트리뷰트를 앞에서 count 개 요소만 업로드하도록 예약 */
function uploadRange(attr: THREE.BufferAttribute | THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
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
  private warm = BOSS_WARM_FRAMES;

  constructor(scene: THREE.Scene) {
    this.group.name = 'enemies';
    for (const id of ALL_ENEMY_IDS) {
      if (BOSS_ENEMIES.has(id)) {
        this.bossPool.set(id, []);
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
        anim = { age: 0, flash: 0, aim: 0 };
        this.anims.set(e.id, anim);
      }
      // 일시정지 프레임은 dt 로 0 대신 0.0001 이 들어온다(battlecontroller).
      // 그대로 누적하면 정지 중에도 스폰 팝이 프레임마다 조금씩 기어간다.
      if (dt > 1e-3) {
        anim.age += dt;
        anim.flash = Math.max(0, anim.flash - dt * 5);
        // 조준 자세는 정지 상태(siegeHoldLeft)를 따라 완만히 들고 난다
        const want = e.siegeHoldLeft > 0 ? 1 : 0;
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
      const atkP = lean > 0 ? attackProgress(e.attackAnimLeft, e.attackAnimTicks, alpha) : 0;
      const aim = lean > 0 ? anim.aim : 0;
      // 멈춰 서서 타워를 때리는 중 — 공격 포즈가 없는 종만 위상을 시간으로 굴린다
      const swinging = lean === 0 && e.towerTargetId >= 0 && step < STOPPED_EPS;
      const swing = swinging ? this.time * ATTACK_SWING_RATE : 0;
      const gait = rigged
        ? wrapGait(travel * rig.gaitPerDist + off + swing)
        : (travel / Math.max(0.5, e.radius * 3.2)) * TAU + off + swing;

      // 스폰 팝 스케일 (접지 보정보다 먼저 — 보정은 모델 단위라 스케일을 먹여야 한다)
      const pop = anim.age < 0.28 ? easeOutBack(anim.age / 0.28) : 1;
      const boss = BOSS_ENEMIES.has(e.defId);
      const scale = pop * (boss ? 1.15 : 1);

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
      if (swinging) pitch -= Math.max(0, Math.sin(gait)) * ATTACK_LEAN;
      // 온몸으로 던진다 — 젖힐 때 뒤로, 놓을 때 앞으로. 셰이더와 **같은 포락선**을 쓴다.
      pitch += attackLean(atkP, aim, lean);

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
   * 아군 인스턴스를 **적 습격대와 같은 메시**의 뒤쪽에 이어 붙인다 (드로우콜 증가 0).
   * 적 루프와 공유하는 것: counts(인스턴스 커서) · seen(애니 상태 GC) · anims(스폰 팝).
   *
   * 아군은 경로를 **거꾸로** 걷는다(dist가 줄어든다). 보행 위상을 e.dist처럼 그대로 쓰면
   * 위상이 감소해 걸음이 거꾸로 돈다 — 그래서 부호를 뒤집은 -dist를 이동거리로 쓴다.
   * 그러면 "앞으로 나아간 거리"가 되어 보폭·접지 보정이 적과 완전히 같은 식으로 맞는다.
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
        anim = { age: 0, flash: 0, aim: 0 };
        this.anims.set(a.id, anim);
      }
      if (dt > 1e-3) {
        anim.age += dt;
        anim.flash = Math.max(0, anim.flash - dt * 5);
      }
      const idx = counts.get(key) ?? 0;
      if (idx >= CAPACITY) return;
      counts.set(key, idx + 1);

      const sx = lerp(a.prevX, a.x, alpha);
      const sz = lerp(a.prevZ, a.z, alpha);
      cellToWorld(sx, sz, _pos);
      const step = Math.hypot(a.x - a.prevX, a.z - a.prevZ);
      // 9단계: 아군이 경로를 떠나면서 `-a.dist`(역주행 호장)가 사라졌다. 대신 태어나서
      // 걸은 총 거리 `walked`를 쓴다 — 방향과 무관하게 **언제나 증가**하므로 앞뒤로
      // 오가도 다리가 얼거나 거꾸로 돌지 않는다. 보간은 적과 같은 규약(한 틱 뒤로 되감기).
      const travel = a.walked - step * (1 - alpha);
      const off = phaseOffset01(a.id) * TAU;
      // 멈춰 서서 때리는 중 — 적과 같은 규칙으로 팔을 휘두른다
      const swinging = a.targetId >= 0 && step < STOPPED_EPS;
      const swing = swinging ? this.time * ATTACK_SWING_RATE : 0;
      const gait = wrapGait(travel * rig.gaitPerDist + off + swing);
      const pop = anim.age < 0.28 ? easeOutBack(anim.age / 0.28) : 1;
      _pos.y = groundLiftAt(rig, Math.abs(Math.sin(gait))) * pop;
      let pitch = 0;
      if (swinging) pitch -= Math.max(0, Math.sin(gait)) * ATTACK_LEAN;
      _quat.setFromAxisAngle(AXIS_Y, -a.heading);
      _quat2.setFromAxisAngle(AXIS_Z, pitch);
      _quat.multiply(_quat2);
      _mat.compose(_pos, _quat, _scl.setScalar(pop));
      mesh.setMatrixAt(idx, _mat);
      this.gaitAttrs.get(key)?.setX(idx, gait);
      // 아군은 아직 공격 포즈 표가 비어 있다(ALLY_KITS 미등록) — 채널을 0으로 눌러
      // 앞 프레임의 값이 남아 돌지 않게 한다. 지금 동작은 위의 swing 폴백이 그대로 낸다.
      this.atkAttrs.get(key)?.setXY(idx, 0, 0);
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
