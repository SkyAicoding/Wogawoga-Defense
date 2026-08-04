/**
 * 적 렌더 뷰 — 타입별 InstancedMesh (보스 2종은 개별 Mesh).
 * prev→cur 보간, 걷기 바운스, 히트 플래시(instanceColor), 스폰 팝을 처리한다.
 * sim 상태는 EnemyState 배열로만 받는다 (sim 모듈 임포트 금지).
 */
import * as THREE from 'three';
import type { EnemyId, EnemyState } from '@/data/types';
import { easeOutBack, lerp, lerpAngle } from '@/core/mathx';
import { flatMat } from '../palette';
import { ALL_ENEMY_IDS, BOSS_ENEMIES, buildEnemy } from '../meshlib/enemies';
import type { CellToWorld } from '../meshlib/terrain';

const CAPACITY = 100;
const FLY_ALTITUDE = 1.6;

interface Anim {
  age: number;
  flash: number;
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

export class EnemyView {
  private meshes = new Map<EnemyId, THREE.InstancedMesh>();
  private bossPool = new Map<EnemyId, THREE.Mesh[]>();
  private anims = new Map<number, Anim>();
  private group = new THREE.Group();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'enemies';
    for (const id of ALL_ENEMY_IDS) {
      if (BOSS_ENEMIES.has(id)) {
        this.bossPool.set(id, []);
        continue;
      }
      const mesh = new THREE.InstancedMesh(buildEnemy(id), flatMat(), CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // instanceColor 초기화 (히트 플래시용)
      for (let i = 0; i < CAPACITY; i++) mesh.setColorAt(i, _col.setRGB(1, 1, 1));
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.meshes.set(id, mesh);
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  /** 피격 순간 호출 — 흰색 플래시 후 원색 복귀 */
  setHitFlash(enemyId: number): void {
    const a = this.anims.get(enemyId);
    if (a) a.flash = 1;
  }

  update(enemies: readonly EnemyState[], alpha: number, cellToWorld: CellToWorld, dt: number): void {
    this.time += dt;
    const counts = new Map<EnemyId, number>();
    const bossUsed = new Map<EnemyId, number>();
    const seen = new Set<number>();

    for (const e of enemies) {
      if (!e.alive) continue;
      seen.add(e.id);
      let anim = this.anims.get(e.id);
      if (!anim) {
        anim = { age: 0, flash: 0 };
        this.anims.set(e.id, anim);
      }
      anim.age += dt;
      anim.flash = Math.max(0, anim.flash - dt * 5);

      // 보간 위치 (셀 연속 좌표 → 월드)
      const sx = lerp(e.prevX, e.x, alpha);
      const sz = lerp(e.prevZ, e.z, alpha);
      cellToWorld(sx, sz, _pos);

      // 걷기 바운스: 진행거리 기반 sin — 높이 + 앞뒤 기울기
      const stride = Math.max(0.5, e.radius * 3.2);
      const phase = ((e.dist + e.id * 0.37) / stride) * Math.PI * 2;
      let pitch = 0;
      let roll = 0;
      if (e.flying) {
        _pos.y = FLY_ALTITUDE + Math.sin(this.time * 5 + e.id) * 0.12;
        roll = Math.sin(this.time * 9 + e.id * 2) * 0.16; // 날갯짓 롤
      } else {
        _pos.y = Math.abs(Math.sin(phase)) * Math.min(0.09, e.radius * 0.22);
        pitch = Math.sin(phase * 2) * 0.05;
      }

      // 스폰 팝 스케일
      const pop = anim.age < 0.28 ? easeOutBack(anim.age / 0.28) : 1;
      const boss = BOSS_ENEMIES.has(e.defId);
      const scale = pop * (boss ? 1.15 : 1);

      _quat.setFromAxisAngle(AXIS_Y, -e.heading);
      _quat2.setFromAxisAngle(AXIS_Z, pitch);
      _quat.multiply(_quat2);
      if (roll !== 0) {
        _quat2.setFromAxisAngle(AXIS_X, roll);
        _quat.multiply(_quat2);
      }

      if (boss) {
        this.updateBoss(e, bossUsed, scale, anim);
        continue;
      }

      const mesh = this.meshes.get(e.defId);
      if (!mesh) continue;
      const idx = counts.get(e.defId) ?? 0;
      if (idx >= CAPACITY) continue;
      counts.set(e.defId, idx + 1);
      _mat.compose(_pos, _quat, _scl.setScalar(scale));
      mesh.setMatrixAt(idx, _mat);
      // 플래시: 값을 크게 줘 톤매핑 후 흰색 포화
      const f = 1 + anim.flash * anim.flash * 7;
      mesh.setColorAt(idx, _col.setRGB(f, f, f));
    }

    for (const [id, mesh] of this.meshes) {
      mesh.count = counts.get(id) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // 사라진 적의 애니 상태/보스 메시 정리
    for (const key of this.anims.keys()) {
      if (!seen.has(key)) this.anims.delete(key);
    }
    for (const [id, pool] of this.bossPool) {
      const used = bossUsed.get(id) ?? 0;
      pool.forEach((m, i) => (m.visible = i < used));
    }
  }

  /** 보스는 개별 Mesh (동시 ≤2 전제) — 이미 계산된 _pos/_quat 사용 */
  private updateBoss(
    e: EnemyState,
    bossUsed: Map<EnemyId, number>,
    scale: number,
    anim: Anim,
  ): void {
    const pool = this.bossPool.get(e.defId);
    if (!pool) return;
    const idx = bossUsed.get(e.defId) ?? 0;
    bossUsed.set(e.defId, idx + 1);
    let mesh = pool[idx];
    if (!mesh) {
      // 보스 전용: 머티리얼 클론(플래시를 emissive로)
      const mat = flatMat().clone();
      mesh = new THREE.Mesh(buildEnemy(e.defId), mat);
      mesh.castShadow = true;
      pool.push(mesh);
      this.group.add(mesh);
    }
    mesh.visible = true;
    mesh.position.copy(_pos);
    mesh.quaternion.copy(_quat);
    mesh.scale.setScalar(scale);
    const mat = mesh.material as THREE.MeshLambertMaterial;
    mat.emissive.setScalar(anim.flash * 0.9);
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const mesh of this.meshes.values()) mesh.dispose();
    for (const pool of this.bossPool.values()) {
      for (const m of pool) (m.material as THREE.Material).dispose();
    }
    this.meshes.clear();
    this.bossPool.clear();
    this.anims.clear();
  }
}
