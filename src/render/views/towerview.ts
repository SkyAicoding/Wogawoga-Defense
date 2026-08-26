/**
 * 타워 렌더 뷰 — 부위 리그(base + head(action)) 관리.
 * 헤드 타깃 조준(지수 감쇠 요 회전), 무기별 발사 애니메이션, 업그레이드 팝,
 * 배치 고스트 프리뷰(초록/빨강), 적 부족에게 맞았을 때의 피격 연출을 처리한다.
 *
 * ── 드로우콜: 타워가 몇 기든 상수다 (views/towerbatch.ts) ────────────────────
 * 리그는 그대로 `THREE.Group` 세 개(root/head/action)로 두되 **씬에 넣지 않는다** —
 * 애니메이션이 끝난 뒤 각 조각의 `matrixWorld` 를 `BatchedMesh` 인스턴스 행렬로 옮긴다.
 * 그래서 아래 애니메이션 코드는 한 글자도 바뀌지 않았고(회전·스케일·위치 전부 행렬에
 * 실린다), 드로우콜만 기당 3개에서 **묶음 6개 상한**으로 접힌다.
 *   몸체(그림자 캐스터) 2 · action(flat) 1 · action(glow) 1 · 발사 셸 1 ·
 *   피격 플래시 몸체 2 + action 1  = 최악 8콜 (+ 배치 고스트 2, 배치 중에만)
 * 실측 전/후: 24기 = 90콜 → 13콜.
 *
 * ⚠ **피격 플래시가 재질 스왑이 아니게 됐다.** 재질은 묶음 단위라 인스턴스 하나만
 *   빨갛게 만들 수 없다. 대신 같은 `hitMat` 을 쓰는 **두 번째 묶음**을 두고 그쪽
 *   인스턴스로 자리를 옮긴다(보이기 토글). 화면에 나오는 그림은 전과 같고, 맞고 있는
 *   타워가 하나라도 있는 프레임에만 +3콜이 든다.
 */
import * as THREE from 'three';
import type { EnemyState, TowerId, TowerState } from '@/data/types';
import { clamp, clamp01, damp, easeInOutQuad, easeOutCubic, lerp, lerpAngle } from '@/core/mathx';
import { additiveMat, flatMat, glowMat } from '../palette';
import { assembleTower, buildTower, towerTierScale, type TowerModel } from '../meshlib/towers';
import type { CellToWorld } from '../meshlib/terrain';
import { TowerBatch } from './towerbatch';

/** 방향성 무기 — 헤드가 현재 타깃을 향해 요 회전 */
const AIMED: ReadonlySet<TowerId> = new Set<TowerId>(['spear', 'catapult', 'poison', 'ballista']);

/** 발사 애니 길이 (초). drum은 스프링 임펄스로만 처리 */
const FIRE_DUR: Record<TowerId, number> = {
  spear: 0.34,
  catapult: 0.14, // 팔 스냅 — 이후 재장전은 감쇠 복귀
  lightning: 0.22,
  brazier: 0.5,
  frost: 0.32,
  poison: 0.38,
  ballista: 0.9, // 재장전 슬라이드 전체
  drum: 0,
  // 2-c — 회전하지 않는 셋(AIMED 에 없다). 발사 연출은 action 슬롯의 상하 움직임뿐이다
  hushtotem: 0, // 지원형 — 발사가 없다 (drum 과 같다)
  rattletrap: 0.1, // 이빨이 튕겼다 돌아오는 짧은 스냅 (쿨다운 6~9틱 = 0.2~0.3초라 더 길면 겹친다)
  shockstake: 0.26,
};

/** 조준 지수 감쇠 속도 (rad 수렴 ~8/s) */
const AIM_LAMBDA = 8;
const RECOIL_TIME = 0.22;
const POP_TIME = 0.3;
/** ballista: 발사 직후 볼트 숨김 시간 */
const BOLT_HIDE = 0.12;
/** 배치 고스트 크기 — 실제로 놓이는 건 T1이므로 T1 크기와 같아야 한다 */
const GHOST_SCALE = towerTierScale(0);
/** 피격 붉은 플래시 지속 (초) — 재질 스왑 구간 */
const HIT_FLASH_TIME = 0.07;
/**
 * 플래시 **최소 간격**(초) — 듀티 사이클 상한을 만든다.
 *
 * 없으면 무리에 붙잡힌 타워가 상시 붉은 덩어리가 된다: siege 규칙 2(사거리 내 최근접)
 * 때문에 한 무리가 같은 타워를 잡으므로, blade 쿨다운 20틱(0.667초) 기준
 * N명이면 평균 0.667/N초마다 플래시가 걸려 N≥7이면 듀티 100%, N=5에서도 75%다.
 * 그동안 종류·티어·지붕 형태가 전부 사라져 "팔지 강화할지"를 판단할 근거가 없어진다.
 * 0.30초 간격 + 0.07초 플래시 = 듀티 상한 23% — 맞고 있다는 건 계속 보이지만
 * 타워의 정체는 4프레임 중 3프레임에서 읽힌다. (지속 신호는 체력바가 맡는다)
 */
const HIT_FLASH_MIN_GAP = 0.3;
/** 피격 흔들림 지속 (초) — 플래시보다 길게 남겨 타격감을 준다 */
const HIT_SHAKE_TIME = 0.26;

interface TowerEntry {
  /** 씬에 넣지 않는 순수 변환 노드 — matrixWorld 만 읽어 인스턴스 행렬로 옮긴다 */
  root: THREE.Group;
  head: THREE.Group;
  action: THREE.Group;
  /**
   * 발사 플래시 셸의 변환 노드 (애디티브, 평시 visible=false).
   * 예전엔 Mesh 였다 — 지금은 그리기를 `shell` 묶음이 맡으므로 위치/스케일만 남았다.
   */
  flash: THREE.Object3D | null;
  /** 인스턴스를 늦게(피격 때) 하나 더 발급할 때 지오메트리를 다시 찾으려고 들고 있는다 */
  model: TowerModel;
  /** 지오메트리 캐시 키 앞자리 = `종:티어` */
  key: string;
  defId: TowerId;
  tier: number;
  /**
   * 티어 시각 크기 배율 — 루트에 곱해 팝/반동 애니와 함께 실린다.
   * 루트 스케일이라 그림자·발사 연출·actionPivot(투사체 발사 위치)이 전부 따라온다.
   * 사거리 링은 decals가 게임 데이터로 따로 그리므로 여기 영향을 받지 않는다.
   */
  tierScale: number;
  /** action 그룹 기본 로컬 위치 (애니 오프셋 기준점) */
  actionPos: THREE.Vector3;
  /** head 피벗 높이 (poison 런지 복원용) */
  headPosY: number;
  /** 현재/목표 요 (마지막 타깃 방향 유지) */
  yaw: number;
  targetYaw: number;
  /** 발사 애니 잔여 시간 (초, FIRE_DUR→0) */
  fireT: number;
  /** catapult 팔 각도 (스냅 후 감쇠 재장전) */
  armVal: number;
  /** ballista 활대 반동 */
  headPunch: number;
  /** frost 크리스탈 회전 상태 */
  spin: number;
  spinVel: number;
  /** drum 스프링 스쿼시 (1=정지) */
  sq: number;
  sqVel: number;
  /** 개체별 위상 (플리커/부유 어긋남) */
  phase: number;
  /** 미세 반동 진행 (1→0) */
  recoilT: number;
  /** 업그레이드/배치 팝 진행 */
  popT: number;
  /** 피격 흔들림 진행 (1→0) */
  hitT: number;
  /** 다음 플래시가 허용될 때까지 남은 초 (듀티 상한) */
  flashGap: number;
  /** 피격 플래시 잔여 (초). 0 이하면 원래 재질로 되돌린다 */
  flashT: number;
  /** 몸체 인스턴스 — base 는 root 행렬, head 는 head 행렬을 받는다. 없으면 -1 */
  baseInst: number;
  headInst: number;
  /** action 인스턴스와 그것이 사는 묶음(flat/glow) */
  actInst: number;
  actBatch: TowerBatch | null;
  /** 발사 플래시 셸 인스턴스 (lightning 만) */
  shellInst: number;
  /** 피격 플래시용 대체 인스턴스 — **처음 맞는 순간에** 발급한다 (안 맞으면 버퍼도 안 잡는다) */
  hitBase: number;
  hitHead: number;
  hitAct: number;
  /** 지금 피격 묶음 쪽이 보이는가 — 행렬을 어느 쪽에 쓸지 가른다 */
  flashOn: boolean;
  /** 배치 월드 좌표 (피격 흔들림 오프셋의 기준점) */
  baseX: number;
  baseZ: number;
}

const _v = new THREE.Vector3();

export class TowerView {
  private group = new THREE.Group();
  private towers = new Map<number, TowerEntry>();
  /** 몸체 — **유일한 그림자 캐스터**(meshlib/towers.ts 규약) */
  private body: TowerBatch;
  /** action(flat): 창·투석기 팔·발리스타 볼트·북면 */
  private actFlat: TowerBatch;
  /** action(glow): 불꽃·크리스탈·얼음·포자 머리 — 라이팅 무시라 그림자도 안 받는다 */
  private actGlow: TowerBatch;
  /** 발사 애디티브 셸 (lightning) */
  private shell: TowerBatch;
  /** 피격 플래시 몸체/action — 처음 맞을 때까지 정점 버퍼를 잡지 않는다 */
  private hitBody: TowerBatch;
  private hitAct: TowerBatch;
  private batches: TowerBatch[];
  private ghost: THREE.Group | null = null;
  private ghostMatValid: THREE.MeshLambertMaterial;
  private ghostMatInvalid: THREE.MeshLambertMaterial;
  /** 피격 플래시용 공유 재질 — 전 타워가 같은 인스턴스를 쓴다 (프로그램 1개) */
  private hitMat: THREE.MeshLambertMaterial;
  private enemyById = new Map<number, EnemyState>();
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private cellToWorld: CellToWorld,
  ) {
    this.group.name = 'towers';
    scene.add(this.group);
    // 고스트는 **음영이 있어야** 모델 형태가 읽힌다. 예전엔 MeshBasic 단색이라
    // 잔디+슬롯 디스크 위의 초록 얼룩으로만 보였다(실측: 초록은 식별 불가, 빨강만 판독).
    // Lambert + 버텍스 컬러에 색을 곱하면 실루엣/면 방향이 살아나고, 곱해지는 틴트가
    // 가능(청록 초록)/불가(적색)를 구분한다.
    // 곱해지는 틴트는 채도를 세게 잡아야 갈색 원목 위에서 '초록'으로 읽힌다
    // (0x59ffb0 은 올리브로 뭉개져 잔디와 구분이 잘 안 됐다).
    // emissive 는 그늘진 면까지 색을 유지시켜 지면에서 떼어 놓는 역할.
    this.ghostMatValid = new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0x1cff7a,
      emissive: 0x0c6b38,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.ghostMatInvalid = new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0xff4234,
      emissive: 0x6b1008,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    // 붉은 틴트 + 중간 세기 emissive. emissive를 더 올리면 면 방향이 뭉개져
    // "빨간 덩어리"가 되고 무엇이 맞았는지 형태가 안 읽힌다 (실측 캡처 확인).
    this.hitMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0xd88878,
      emissive: 0xb02408,
    });
    // 묶음 여섯. castShadow 는 몸체 쪽 둘만 — action 을 섞으면 그림자 패스에서
    // 한 번 더 그려져 "타워당 캐스터 1개" 규약이 깨진다(towerbatch.ts 헤더).
    this.body = new TowerBatch(flatMat(), {
      name: 'towerBody',
      castShadow: true,
      receiveShadow: true,
      verts: 24576,
    });
    this.actFlat = new TowerBatch(flatMat(), {
      name: 'towerActionFlat',
      castShadow: false,
      receiveShadow: true,
      verts: 4096,
    });
    this.actGlow = new TowerBatch(glowMat(), {
      name: 'towerActionGlow',
      castShadow: false,
      receiveShadow: false,
      verts: 4096,
    });
    this.shell = new TowerBatch(additiveMat(), {
      name: 'towerFireShell',
      castShadow: false,
      receiveShadow: false,
      verts: 2048,
    });
    this.hitBody = new TowerBatch(this.hitMat, {
      name: 'towerHitBody',
      castShadow: true,
      receiveShadow: true,
      verts: 8192,
    });
    // 피격 중에는 glow 부속도 함께 빨개진다(예전 재질 스왑과 같다) — 그래서 flat/glow 를
    // 가르지 않고 한 묶음에 담는다. 0.07초짜리 연출이라 receiveShadow 차이는 안 읽힌다.
    this.hitAct = new TowerBatch(this.hitMat, {
      name: 'towerHitAction',
      castShadow: false,
      receiveShadow: true,
      verts: 4096,
    });
    this.batches = [this.body, this.actFlat, this.actGlow, this.shell, this.hitBody, this.hitAct];
    for (const b of this.batches) this.group.add(b.mesh);
  }

  /**
   * 리그(변환 노드)만 만들고 그리기는 묶음에 맡긴다.
   * `assembleTower` 와 **같은 계층**이어야 한다 — base 는 root, head 지오메트리는 head,
   * action 은 action 노드의 행렬을 받는다. (지금 8종은 base/head 중 하나만 갖는다.
   *  둘 다 가진 모델이 생기면 몸체 묶음이 그림자를 2장 굽는다 — towerbatch.test.ts 가 잡는다)
   */
  private makeEntry(defId: TowerId, tier: number): TowerEntry {
    const model = buildTower(defId, tier);
    const root = new THREE.Group();
    const head = new THREE.Group();
    head.position.y = model.headPivotY;
    root.add(head);
    const action = new THREE.Group();
    action.position.set(model.actionPivot[0], model.actionPivot[1], model.actionPivot[2]);
    head.add(action);
    let flash: THREE.Object3D | null = null;
    if (model.flash) {
      flash = new THREE.Object3D();
      flash.visible = false;
      action.add(flash);
    }
    // 첫 update 전 한 프레임이 원본 크기로 번쩍이지 않게 팝 시작값(0.6)까지 미리 반영
    root.scale.setScalar(towerTierScale(tier) * 0.6);
    const key = `${defId}:${tier}`;
    let actBatch: TowerBatch | null = null;
    let actInst = -1;
    if (model.action) {
      actBatch = model.actionMat === 'glow' ? this.actGlow : this.actFlat;
      actInst = actBatch.add(actBatch.geometry(`${key}:act`, model.action));
    }
    return {
      root,
      head,
      action,
      flash,
      model,
      key,
      baseInst: model.base ? this.body.add(this.body.geometry(`${key}:base`, model.base)) : -1,
      headInst: model.head ? this.body.add(this.body.geometry(`${key}:head`, model.head)) : -1,
      actInst,
      actBatch,
      shellInst: model.flash ? this.shell.add(this.shell.geometry(`${key}:act`, model.flash)) : -1,
      hitBase: -1,
      hitHead: -1,
      hitAct: -1,
      flashOn: false,
      defId,
      tier,
      tierScale: towerTierScale(tier),
      actionPos: new THREE.Vector3(model.actionPivot[0], model.actionPivot[1], model.actionPivot[2]),
      headPosY: model.headPivotY,
      yaw: 0,
      targetYaw: 0,
      fireT: 0,
      armVal: 0,
      headPunch: 0,
      spin: 0,
      spinVel: 0,
      sq: 1,
      sqVel: 0,
      phase: 0,
      recoilT: 0,
      popT: 1,
      hitT: 0,
      flashGap: 0,
      flashT: 0,
      baseX: 0,
      baseZ: 0,
    };
  }

  /**
   * 리그의 현재 자세를 묶음 인스턴스 행렬로 옮긴다 — **애니메이션과 그리기의 유일한 접점.**
   * 피격 중이면 같은 자세를 피격 묶음 쪽에 쓴다(보이는 쪽에만 쓴다).
   */
  private writeMatrices(e: TowerEntry): void {
    e.root.updateMatrixWorld(true);
    const on = e.flashOn;
    const bodyBatch = on ? this.hitBody : this.body;
    const bi = on ? e.hitBase : e.baseInst;
    const hi = on ? e.hitHead : e.headInst;
    if (bi >= 0) bodyBatch.matrix(bi, e.root.matrixWorld);
    if (hi >= 0) bodyBatch.matrix(hi, e.head.matrixWorld);
    const ab = on ? this.hitAct : e.actBatch;
    const ai = on ? e.hitAct : e.actInst;
    if (ab && ai >= 0) {
      ab.matrix(ai, e.action.matrixWorld);
      ab.visible(ai, e.action.visible); // ballista 재장전 중 볼트 숨김
    }
    // 애디티브 셸은 피격 재질 스왑 대상이 아니었다 — 지금도 그대로 자기 묶음에 남는다
    if (e.shellInst >= 0 && e.flash) {
      this.shell.matrix(e.shellInst, e.flash.matrixWorld);
      this.shell.visible(e.shellInst, e.flash.visible && e.action.visible);
    }
  }

  /** 보이는 인스턴스가 0인 묶음은 렌더 리스트에서 뺀다 */
  private sync(): void {
    for (const b of this.batches) b.sync();
  }

  /** 이 타워가 쓰는 인스턴스를 전부 반납한다 */
  private release(e: TowerEntry): void {
    if (e.baseInst >= 0) this.body.release(e.baseInst);
    if (e.headInst >= 0) this.body.release(e.headInst);
    if (e.actInst >= 0 && e.actBatch) e.actBatch.release(e.actInst);
    if (e.shellInst >= 0) this.shell.release(e.shellInst);
    if (e.hitBase >= 0) this.hitBody.release(e.hitBase);
    if (e.hitHead >= 0) this.hitBody.release(e.hitHead);
    if (e.hitAct >= 0) this.hitAct.release(e.hitAct);
    e.baseInst = -1;
    e.headInst = -1;
    e.actInst = -1;
    e.shellInst = -1;
    e.hitBase = -1;
    e.hitHead = -1;
    e.hitAct = -1;
  }

  add(id: number, defId: TowerId, tier: number, cellX: number, cellZ: number): void {
    this.remove(id);
    const entry = this.makeEntry(defId, tier);
    entry.phase = id * 1.37;
    const v = this.cellToWorld(cellX, cellZ);
    entry.root.position.set(v.x, 0.1, v.z); // 슬롯 패드 위
    entry.baseX = v.x;
    entry.baseZ = v.z;
    this.towers.set(id, entry);
    // 첫 프레임이 원점 자세로 한 번 그려지지 않게 지금 자세를 바로 실어 둔다
    this.writeMatrices(entry);
    this.sync();
  }

  upgrade(id: number, tier: number): void {
    const old = this.towers.get(id);
    if (!old || old.tier === tier) return;
    const entry = this.makeEntry(old.defId, tier);
    entry.root.position.copy(old.root.position);
    entry.baseX = old.baseX;
    entry.baseZ = old.baseZ;
    // 조준/회전 상태 유지
    entry.yaw = old.yaw;
    entry.targetYaw = old.targetYaw;
    entry.head.rotation.y = old.yaw;
    entry.spin = old.spin;
    entry.phase = old.phase;
    this.release(old);
    this.towers.set(id, entry); // popT=1 → 팝 애니 재생
    this.writeMatrices(entry);
    this.sync();
  }

  remove(id: number): void {
    const entry = this.towers.get(id);
    if (!entry) return;
    // 맞는 중에 부서져도 두 묶음 다 반납한다 (피격 쪽에 유령 인스턴스가 남지 않게)
    this.release(entry);
    this.towers.delete(id);
    this.sync();
  }

  /**
   * 적 부족에게 맞았다 — 붉은 플래시 + 흔들림.
   * 플래시는 **같은 `hitMat` 을 쓰는 두 번째 묶음으로 자리를 옮기는 것**이다.
   * 재질은 묶음 단위라 인스턴스 하나만 스왑할 수 없다 — 대신 원래 인스턴스를 숨기고
   * 피격 묶음 인스턴스를 켠다. 맞는 타워가 하나도 없는 프레임은 그 묶음이 통째로 빠진다.
   */
  hit(id: number): void {
    const e = this.towers.get(id);
    if (!e) return;
    // 흔들림은 매 타격 걸어 "난타당하는 중"이 보이게 하고,
    // 재질 스왑(형태를 지우는 연출)만 간격 제한을 둔다
    e.hitT = 1;
    if (e.flashGap > 0) return;
    e.flashGap = HIT_FLASH_MIN_GAP;
    e.flashT = HIT_FLASH_TIME;
    this.setFlash(e, true);
  }

  private setFlash(e: TowerEntry, on: boolean): void {
    if (e.flashOn === on) return;
    if (on && !this.hitReady(e)) return; // 자리를 못 잡으면 플래시 없이 흔들림만
    e.flashOn = on;
    if (e.baseInst >= 0) {
      this.body.visible(e.baseInst, !on);
      this.hitBody.visible(e.hitBase, on);
    }
    if (e.headInst >= 0) {
      this.body.visible(e.headInst, !on);
      this.hitBody.visible(e.hitHead, on);
    }
    if (e.actInst >= 0 && e.actBatch) {
      e.actBatch.visible(e.actInst, !on && e.action.visible);
      this.hitAct.visible(e.hitAct, on && e.action.visible);
    }
    this.writeMatrices(e); // 켜진 쪽에 지금 자세를 넣는다 (한 프레임도 원점에 있지 않게)
    this.sync();
  }

  /**
   * 피격 인스턴스를 **처음 맞는 순간에** 발급한다.
   * 미리 잡지 않는 이유: `BatchedMesh` 는 첫 지오메트리에서 정점 버퍼를 통째로 할당한다.
   * 한 번도 안 맞는 판에서는 피격 묶음이 버퍼를 1바이트도 안 잡는다.
   */
  private hitReady(e: TowerEntry): boolean {
    if (e.hitBase >= 0 || e.hitHead >= 0 || e.hitAct >= 0) return true;
    const m = e.model;
    if (m.base) e.hitBase = this.hitBody.add(this.hitBody.geometry(`${e.key}:base`, m.base));
    if (m.head) e.hitHead = this.hitBody.add(this.hitBody.geometry(`${e.key}:head`, m.head));
    if (m.action) e.hitAct = this.hitAct.add(this.hitAct.geometry(`${e.key}:act`, m.action));
    return e.hitBase >= 0 || e.hitHead >= 0 || e.hitAct >= 0;
  }

  /** 발사 애니 트리거 — 타입별로 분기 (fx가 towerFired마다 호출) */
  recoil(id: number): void {
    const e = this.towers.get(id);
    if (!e) return;
    e.recoilT = 1;
    e.fireT = FIRE_DUR[e.defId];
    switch (e.defId) {
      case 'frost':
        e.spinVel = 8 + e.tier * 1.6; // 회전 가속
        break;
      case 'drum':
        e.sqVel -= 6.5 + e.tier * 0.9; // 북면 타격 임펄스
        break;
      case 'ballista':
        e.headPunch = 1; // 활대 반동
        break;
      default:
        break;
    }
  }

  /**
   * 매 프레임 조준 갱신 — 방향성 무기의 헤드가 현재 타깃(보간 위치)을 향한다.
   * 타깃이 없으면 마지막 방향 유지.
   */
  aim(towers: readonly TowerState[], enemies: readonly EnemyState[], alpha: number): void {
    let built = false;
    for (const t of towers) {
      if (!AIMED.has(t.defId) || t.targetId < 0) continue;
      const entry = this.towers.get(t.id);
      if (!entry) continue;
      if (!built) {
        for (const en of enemies) if (en.alive) this.enemyById.set(en.id, en);
        built = true;
      }
      const en = this.enemyById.get(t.targetId);
      if (!en) continue;
      this.cellToWorld(lerp(en.prevX, en.x, alpha), lerp(en.prevZ, en.z, alpha), _v);
      const dx = _v.x - entry.root.position.x;
      const dz = _v.z - entry.root.position.z;
      // rotation.y = θ 는 +X축을 (cosθ, -sinθ) 방향으로 돌린다
      if (dx * dx + dz * dz > 1e-4) entry.targetYaw = Math.atan2(-dz, dx);
    }
    if (built) this.enemyById.clear(); // 상태 참조를 프레임 밖에 남기지 않는다
  }

  /** 타워 월드 위치 (파티클/이펙트 스폰용) */
  positionOf(id: number, out: THREE.Vector3): boolean {
    const entry = this.towers.get(id);
    if (!entry) return false;
    out.copy(entry.root.position);
    return true;
  }

  /** 배치 프리뷰 고스트 — 반투명 초록(가능)/빨강(불가). 배치되는 건 T1이라 T1 크기로 보여준다 */
  setGhost(defId: TowerId, cellX: number, cellZ: number, valid: boolean): void {
    this.clearGhost();
    const mat = valid ? this.ghostMatValid : this.ghostMatInvalid;
    const rig = assembleTower(buildTower(defId, 0), { flat: mat, glow: mat }, false);
    // 고스트는 배치 중 한 기뿐이라 묶지 않는다 — 이름만 붙여 예산 잣대가 갈라 셀 수 있게 한다
    rig.root.traverse((o) => {
      o.name = 'towerGhost';
    });
    const v = this.cellToWorld(cellX, cellZ);
    rig.root.position.set(v.x, 0.1, v.z);
    rig.root.scale.setScalar(GHOST_SCALE);
    this.group.add(rig.root);
    this.ghost = rig.root;
  }

  clearGhost(): void {
    if (this.ghost) {
      this.group.remove(this.ghost);
      this.ghost = null;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const e of this.towers.values()) {
      // 헤드 조준 — 지수 감쇠 (~8/s)
      if (AIMED.has(e.defId)) {
        e.yaw = lerpAngle(e.yaw, e.targetYaw, 1 - Math.exp(-AIM_LAMBDA * dt));
        e.head.rotation.y = e.yaw;
      }
      if (e.fireT > 0) e.fireT = Math.max(0, e.fireT - dt);
      this.animate(e, dt);

      // 루트 스케일: 티어 크기 × (팝 + 미세 반동 + drum 오라 펄스)
      let sx = e.tierScale;
      let sy = e.tierScale;
      if (e.recoilT > 0) {
        e.recoilT = Math.max(0, e.recoilT - dt / RECOIL_TIME);
        const k = e.recoilT * e.recoilT;
        sy *= 1 - 0.05 * k;
        sx *= 1 + 0.035 * k;
      }
      if (e.popT > 0) {
        e.popT = Math.max(0, e.popT - dt / POP_TIME);
        const t = 1 - e.popT;
        const pop = 0.6 + 0.4 * easeOutCubic(t);
        const over = 1 + Math.sin(t * Math.PI) * 0.12;
        sx *= pop * over;
        sy *= pop * over;
      }
      if (e.defId === 'drum') {
        const pulse = 1 + Math.sin(this.time * 3.4) * 0.035;
        sx *= pulse;
        sy *= 2 - pulse;
      }
      // 피격: 짧은 붉은 플래시 + 감쇠 진동(좌우 흔들림 + 눌림)
      if (e.flashGap > 0) e.flashGap -= dt;
      if (e.flashT > 0) {
        e.flashT -= dt;
        if (e.flashT <= 0) this.setFlash(e, false);
      }
      if (e.hitT > 0) {
        e.hitT = Math.max(0, e.hitT - dt / HIT_SHAKE_TIME);
        const k = e.hitT * e.hitT;
        const j = Math.sin(this.time * 62 + e.phase) * 0.055 * k;
        e.root.position.set(e.baseX + j, 0.1, e.baseZ + j * 0.6);
        sy *= 1 - 0.07 * k;
        sx *= 1 + 0.05 * k;
      } else if (e.root.position.x !== e.baseX || e.root.position.z !== e.baseZ) {
        e.root.position.set(e.baseX, 0.1, e.baseZ);
      }
      e.root.scale.set(sx, sy, sx);
      this.writeMatrices(e);
    }
    this.sync();
    if (this.ghost) {
      // 고스트 호흡 애니 — T1 크기 위에 곱한다
      const b = 1 + Math.sin(this.time * 6) * 0.03;
      this.ghost.scale.setScalar(GHOST_SCALE * b);
    }
  }

  /** 무기별 발사/유휴 애니 — k = fireT/FIRE_DUR (1→0) */
  private animate(e: TowerEntry, dt: number): void {
    const dur = FIRE_DUR[e.defId];
    const k = dur > 0 ? e.fireT / dur : 0;
    const ex = 1 + e.tier * 0.09; // 티어가 높을수록 과장
    const a = e.action;
    switch (e.defId) {
      case 'catapult': {
        // 장전 자세(0) → 발사 시 ~140ms 전방 스냅 → 쿨다운 동안 천천히 재장전
        const swing = clamp(1.55 * ex, 0, 1.9);
        if (e.fireT > 0) e.armVal = -swing * easeOutCubic(1 - k);
        else e.armVal = damp(e.armVal, 0, 1.4, dt);
        a.rotation.z = e.armVal;
        break;
      }
      case 'spear': {
        // 투창: 앞으로 빠르게 기울며 찌른 뒤 복귀
        const u = 1 - k;
        const r = e.fireT > 0 ? (u < 0.3 ? easeOutCubic(u / 0.3) : 1 - easeInOutQuad((u - 0.3) / 0.7)) : 0;
        a.rotation.z = -0.8 * ex * r;
        a.position.x = e.actionPos.x + 0.22 * r;
        break;
      }
      case 'ballista': {
        // 발사 직후 볼트 숨김 → 뒤에서 앞으로 재장전 슬라이드, 활대는 반동 압축
        a.visible = e.fireT <= FIRE_DUR.ballista - BOLT_HIDE;
        const reloadK = clamp01(e.fireT / (FIRE_DUR.ballista - BOLT_HIDE));
        a.position.x = e.actionPos.x - 0.5 * reloadK;
        // 받침이 head에 병합돼 있으므로(드로우콜 절감) 기체 전체가 조준축으로 압축된다 → 폭 축소
        e.headPunch = damp(e.headPunch, 0, 9, dt);
        e.head.scale.x = 1 - 0.09 * ex * e.headPunch;
        break;
      }
      case 'poison': {
        // 움츠림(1/3) → 뱉기 스냅 + 감쇠 복귀 — 헤드(턱잎+머리) 전체 스쿼시&스트레치
        let sx = 1;
        let sy = 1;
        let px = 0;
        if (e.fireT > 0) {
          const u = 1 - k;
          if (u < 0.32) {
            const c = easeOutCubic(u / 0.32);
            sx = 1 - 0.32 * c;
            sy = 1 + 0.16 * c;
            px = -0.12 * c;
          } else {
            const w = (1 - (u - 0.32) / 0.68) ** 2;
            sx = 1 + 0.6 * ex * w;
            sy = 1 - 0.3 * w;
            px = 0.2 * ex * w;
          }
        }
        // 스케일은 헤드 로컬 축(+X=전방), 런지는 요를 반영한 루트 공간 오프셋
        e.head.scale.set(sx, sy, 1 - (sx - 1) * 0.35);
        e.head.position.set(Math.cos(e.yaw) * px, e.headPosY, -Math.sin(e.yaw) * px);
        break;
      }
      case 'lightning': {
        // 크리스탈 번쩍: 스케일 펄스 + 짧은 진동 + 애디티브 플래시 셸, 유휴 부유/자전
        a.scale.setScalar(1 + 0.45 * ex * k * k);
        const j = 0.035 * k;
        a.position.set(
          e.actionPos.x + Math.sin(this.time * 70 + e.phase) * j,
          e.actionPos.y + Math.sin(this.time * 2 + e.phase) * 0.03,
          e.actionPos.z + Math.cos(this.time * 63 + e.phase) * j,
        );
        a.rotation.y += dt * 0.5;
        if (e.flash) {
          e.flash.visible = e.fireT > 0;
          if (e.fireT > 0) e.flash.scale.setScalar(1.05 + 0.6 * (1 - k) + 0.25 * k);
        }
        break;
      }
      case 'frost': {
        // 회전 가속 + 펄스 확대 후 복귀
        e.spinVel = damp(e.spinVel, 0, 2.5, dt);
        e.spin += (0.5 + e.spinVel) * dt;
        a.rotation.y = e.spin;
        a.scale.setScalar(1 + 0.26 * ex * k * k);
        break;
      }
      case 'brazier': {
        // 오라 틱 플레어 + 상시 플리커
        const flare = k * k * ex;
        const flick =
          1 + Math.sin(this.time * 11 + e.phase) * 0.05 + Math.sin(this.time * 23 + e.phase * 2) * 0.035;
        a.scale.set(1 + 0.3 * flare, flick * (1 + 0.55 * flare), 1 + 0.3 * flare);
        break;
      }
      case 'drum': {
        // 감쇠 스프링 스쿼시 — 리듬감 있는 바운스 복귀 (최대 스텝 제한으로 안정화)
        let rem = dt;
        while (rem > 1e-6) {
          const h = Math.min(rem, 1 / 60);
          rem -= h;
          e.sqVel += (-(e.sq - 1) * 130 - e.sqVel * 9) * h;
          e.sq += e.sqVel * h;
        }
        e.sq = clamp(e.sq, 0.45, 1.45);
        const b = 1 + (1 - e.sq) * 0.7;
        a.scale.set(b, e.sq, b);
        break;
      }
      default:
        break;
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const b of this.batches) b.dispose();
    this.towers.clear();
    this.enemyById.clear();
    this.ghost = null;
    this.ghostMatValid.dispose();
    this.ghostMatInvalid.dispose();
    this.hitMat.dispose();
  }
}
