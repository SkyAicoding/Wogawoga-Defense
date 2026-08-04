/**
 * 투사체 렌더 뷰 — 타입별 InstancedMesh + 진행방향 정렬.
 * ballistic은 포물선 y를 렌더에서 재계산(부드러운 호), beam은 지그재그
 * 번개 폴리라인 메시(수명 150ms) 풀링.
 */
import * as THREE from 'three';
import type { ProjectileState, TowerId } from '@/data/types';
import { clamp01, lerp, parabola } from '@/core/mathx';
import { additiveMat, flatMat, glowMat } from '../palette';
import { GLOW_PROJECTILES, PROJECTILE_TOWERS, buildProjectile } from '../meshlib/projectiles';
import type { CellToWorld } from '../meshlib/terrain';

const CAPACITY = 64;
const BEAM_LIFE = 0.15;
const BEAM_POOL = 8;

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
}

const _pos = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3(1, 1, 1);
const _mat4 = new THREE.Matrix4();
const FWD = new THREE.Vector3(1, 0, 0);

export class ProjectileView {
  private meshes = new Map<TowerId, THREE.InstancedMesh>();
  private beams: Beam[] = [];
  private group = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private cellToWorld: CellToWorld,
  ) {
    this.group.name = 'projectiles';
    for (const id of PROJECTILE_TOWERS) {
      const geo = buildProjectile(id);
      if (!geo) continue;
      const mat = GLOW_PROJECTILES.has(id) ? glowMat() : flatMat();
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.set(id, mesh);
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  update(projectiles: readonly ProjectileState[], alpha: number, dt: number): void {
    const counts = new Map<TowerId, number>();

    for (const p of projectiles) {
      if (!p.alive) continue;
      const mesh = this.meshes.get(p.towerDefId);
      if (!mesh) continue;
      const idx = counts.get(p.towerDefId) ?? 0;
      if (idx >= CAPACITY) continue;
      counts.set(p.towerDefId, idx + 1);

      const sx = lerp(p.prevX, p.x, alpha);
      const sz = lerp(p.prevZ, p.z, alpha);
      this.cellToWorld(sx, sz, _pos);

      if (p.kind === 'ballistic' && p.flightTicks > 0) {
        // 포물선: 진행률 기반 재계산 (틱 보간보다 부드러움)
        const t = clamp01((p.elapsedTicks + alpha) / p.flightTicks);
        _pos.y = 0.4 + parabola(t, p.arcHeight);
        // 방향 = 수평 진행 + 수직 미분
        const t2 = clamp01(t + 0.02);
        const dydt = (parabola(t2, p.arcHeight) - parabola(t, p.arcHeight)) / 0.02;
        this.cellToWorld(p.targetX, p.targetZ, _dir).sub(
          this.cellToWorld(p.startX, p.startZ, _prev),
        );
        const horiz = Math.max(_dir.length(), 1e-4);
        _dir.normalize().multiplyScalar(horiz);
        _dir.y = dydt;
        _dir.normalize();
      } else {
        _pos.y = lerp(p.prevY, p.y, alpha);
        // 방향 = 이번 틱 변위 (prev→cur)
        this.cellToWorld(p.prevX, p.prevZ, _prev);
        _prev.y = p.prevY;
        this.cellToWorld(p.x, p.z, _dir);
        _dir.y = p.y;
        _dir.sub(_prev);
        if (_dir.lengthSq() < 1e-8) {
          // 발사 직후 폴백: 타깃 방향
          this.cellToWorld(p.targetX, p.targetZ, _prev);
          _prev.y = _pos.y;
          _dir.subVectors(_prev, _pos);
          if (_dir.lengthSq() < 1e-8) _dir.set(1, 0, 0);
        }
        _dir.normalize();
      }

      _quat.setFromUnitVectors(FWD, _dir);
      _mat4.compose(_pos, _quat, _scl);
      mesh.setMatrixAt(idx, _mat4);
    }

    for (const [id, mesh] of this.meshes) {
      mesh.count = counts.get(id) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }

    // 빔 수명 감쇠
    for (const beam of this.beams) {
      if (beam.life <= 0) continue;
      beam.life -= dt;
      const k = clamp01(beam.life / BEAM_LIFE);
      beam.mat.opacity = k;
      beam.mesh.visible = beam.life > 0;
    }
  }

  /**
   * 지그재그 번개 빔 — points: 타워→적1→적2… (sim 좌표, y는 flying에 따름).
   * 세그먼트마다 수직 교차 리본 2장으로 볼륨감을 낸다.
   */
  addBeam(points: readonly { x: number; z: number; flying?: boolean }[], startY = 1.1): void {
    if (points.length < 2) return;
    const beam = this.acquireBeam();
    const verts: number[] = [];
    const cols: number[] = [];
    const w = 0.055;
    const cMain = new THREE.Color(0xaef2ff);
    const cCore = new THREE.Color(0xffffff);

    const world: THREE.Vector3[] = [];
    points.forEach((pt, i) => {
      const v = this.cellToWorld(pt.x, pt.z).clone();
      v.y = i === 0 ? startY : pt.flying ? 1.7 : 0.6;
      world.push(v);
    });

    // 각 구간을 4~6분할 지그재그
    for (let i = 0; i < world.length - 1; i++) {
      const a = world[i] as THREE.Vector3;
      const b = world[i + 1] as THREE.Vector3;
      const segs = 5;
      let prev = a;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const p = a.clone().lerp(b, t);
        if (s < segs) {
          p.x += (Math.random() - 0.5) * 0.28;
          p.y += (Math.random() - 0.5) * 0.24;
          p.z += (Math.random() - 0.5) * 0.28;
        }
        this.pushRibbon(verts, cols, prev, p, w, cMain);
        this.pushRibbon(verts, cols, prev, p, w * 0.4, cCore);
        prev = p;
      }
    }

    const geo = beam.mesh.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeBoundingSphere();
    beam.life = BEAM_LIFE;
    beam.mat.opacity = 1;
    beam.mesh.visible = true;
  }

  /** 두 점 사이 교차 리본(수평+수직) 삼각형 12개 푸시 */
  private pushRibbon(
    verts: number[],
    cols: number[],
    a: THREE.Vector3,
    b: THREE.Vector3,
    w: number,
    color: THREE.Color,
  ): void {
    _dir.subVectors(b, a).normalize();
    const ux = Math.abs(_dir.y) > 0.9 ? 1 : 0;
    _prev.set(ux, 1 - ux, 0).cross(_dir).normalize().multiplyScalar(w);
    const quads: [THREE.Vector3, THREE.Vector3][] = [
      [_prev.clone(), _prev.clone().negate()],
      [_prev.clone().cross(_dir).normalize().multiplyScalar(w), _prev.clone().cross(_dir).normalize().multiplyScalar(-w)],
    ];
    for (const [o1, o2] of quads) {
      const p1 = [a.x + o1.x, a.y + o1.y, a.z + o1.z];
      const p2 = [a.x + o2.x, a.y + o2.y, a.z + o2.z];
      const p3 = [b.x + o1.x, b.y + o1.y, b.z + o1.z];
      const p4 = [b.x + o2.x, b.y + o2.y, b.z + o2.z];
      verts.push(...p1, ...p2, ...p3, ...p2, ...p4, ...p3);
      for (let i = 0; i < 6; i++) cols.push(color.r, color.g, color.b);
    }
  }

  private acquireBeam(): Beam {
    let beam = this.beams.find((b) => b.life <= 0);
    if (!beam && this.beams.length < BEAM_POOL) {
      const mat = additiveMat().clone();
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      beam = { mesh, mat, life: 0 };
      this.beams.push(beam);
    }
    if (!beam) beam = this.beams[0] as Beam; // 풀 소진 시 가장 오래된 것 재사용
    return beam;
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const mesh of this.meshes.values()) mesh.dispose();
    for (const beam of this.beams) {
      beam.mesh.geometry.dispose();
      beam.mat.dispose();
    }
    this.meshes.clear();
    this.beams.length = 0;
  }
}
