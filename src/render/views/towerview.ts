/**
 * 타워 렌더 뷰 — 부위 리그(base + head(action)) 관리.
 * 헤드 타깃 조준(지수 감쇠 요 회전), 무기별 발사 애니메이션, 업그레이드 팝,
 * 배치 고스트 프리뷰(초록/빨강)를 처리한다.
 */
import * as THREE from 'three';
import type { EnemyState, TowerId, TowerState } from '@/data/types';
import { clamp, clamp01, damp, easeInOutQuad, easeOutCubic, lerp, lerpAngle } from '@/core/mathx';
import { flatMat, glowMat } from '../palette';
import { assembleTower, buildTower, towerTierScale } from '../meshlib/towers';
import type { CellToWorld } from '../meshlib/terrain';

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
};

/** 조준 지수 감쇠 속도 (rad 수렴 ~8/s) */
const AIM_LAMBDA = 8;
const RECOIL_TIME = 0.22;
const POP_TIME = 0.3;
/** ballista: 발사 직후 볼트 숨김 시간 */
const BOLT_HIDE = 0.12;
/** 배치 고스트 크기 — 실제로 놓이는 건 T1이므로 T1 크기와 같아야 한다 */
const GHOST_SCALE = towerTierScale(0);

interface TowerEntry {
  root: THREE.Group;
  head: THREE.Group;
  action: THREE.Group;
  flash: THREE.Mesh | null;
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
}

const _v = new THREE.Vector3();

export class TowerView {
  private group = new THREE.Group();
  private towers = new Map<number, TowerEntry>();
  private ghost: THREE.Group | null = null;
  private ghostMatValid: THREE.MeshLambertMaterial;
  private ghostMatInvalid: THREE.MeshLambertMaterial;
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
  }

  private makeEntry(defId: TowerId, tier: number): TowerEntry {
    const model = buildTower(defId, tier);
    const rig = assembleTower(model, { flat: flatMat(), glow: glowMat() }, true);
    // 첫 update 전 한 프레임이 원본 크기로 번쩍이지 않게 팝 시작값(0.6)까지 미리 반영
    rig.root.scale.setScalar(towerTierScale(tier) * 0.6);
    return {
      root: rig.root,
      head: rig.head,
      action: rig.action,
      flash: rig.flash,
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
    };
  }

  add(id: number, defId: TowerId, tier: number, cellX: number, cellZ: number): void {
    this.remove(id);
    const entry = this.makeEntry(defId, tier);
    entry.phase = id * 1.37;
    const v = this.cellToWorld(cellX, cellZ);
    entry.root.position.set(v.x, 0.1, v.z); // 슬롯 패드 위
    this.group.add(entry.root);
    this.towers.set(id, entry);
  }

  upgrade(id: number, tier: number): void {
    const old = this.towers.get(id);
    if (!old || old.tier === tier) return;
    const entry = this.makeEntry(old.defId, tier);
    entry.root.position.copy(old.root.position);
    // 조준/회전 상태 유지
    entry.yaw = old.yaw;
    entry.targetYaw = old.targetYaw;
    entry.head.rotation.y = old.yaw;
    entry.spin = old.spin;
    entry.phase = old.phase;
    this.group.remove(old.root);
    this.group.add(entry.root);
    this.towers.set(id, entry); // popT=1 → 팝 애니 재생
  }

  remove(id: number): void {
    const entry = this.towers.get(id);
    if (!entry) return;
    this.group.remove(entry.root);
    this.towers.delete(id);
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
      e.root.scale.set(sx, sy, sx);
    }
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
    this.towers.clear();
    this.enemyById.clear();
    this.ghost = null;
    this.ghostMatValid.dispose();
    this.ghostMatInvalid.dispose();
  }
}
