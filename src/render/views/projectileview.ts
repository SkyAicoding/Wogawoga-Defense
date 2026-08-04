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
/** 번개 구간당 분할 수 — 가늘어진 만큼 꺾임을 늘려야 번개로 읽힌다 */
const BOLT_SEGS = 9;

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
   * 번개 빔 — points: 타워→적1→적2… (sim 좌표, y는 flying에 따름).
   *
   * 굵은 한 줄이 아니라 **가는 여러 가닥 + 분기**로 그린다:
   * 1) 지터를 등방이 아니라 진행방향의 수직 평면에서만 준다. 등방 노이즈는 선이
   *    뭉개지고, 수직 지터라야 번개 특유의 각진 꺾임이 나온다.
   * 2) 오프셋은 분할점마다 독립 난수가 아니라 랜덤워크로 누적하고 sin(pi·t)
   *    포락선을 곱한다 — 끊긴 노이즈가 아니라 이어진 경로로 보이고, 양 끝이
   *    정확히 포탑/목표에 물린다(boltPath).
   * 3) 본줄 중간에서 짧은 분기가 갈라져 허공에서 끝난다. 이게 있어야 "지그재그
   *    선"이 아니라 번개로 읽힌다.
   *
   * 애디티브 머티리얼이라 가닥이 겹치는 곳이 저절로 밝아진다.
   * @param intensity 연출 강도 배수 (1 = 기본). 굵기/지그재그 진폭이 함께 커진다.
   */
  addBeam(
    points: readonly { x: number; z: number; flying?: boolean }[],
    startY = 1.1,
    intensity = 1,
  ): void {
    if (points.length < 2) return;
    const beam = this.acquireBeam();
    const verts: number[] = [];
    const cols: number[] = [];
    const k = Math.max(0.5, Math.min(3.4, intensity));
    // 기존 0.055*(0.85+0.55k)의 절반 남짓. 가닥 수가 늘어 총 밝기는 유지된다.
    // 더 얇게 하면 애디티브 위로 잔디 초록이 비쳐 번개가 초록빛으로 보인다 —
    // 흰 코어(cHot)를 두껍게 유지하는 게 색을 지키는 핵심이다.
    const wBase = 0.03 * (0.8 + 0.5 * k);
    const jBase = 0.3 * (0.7 + 0.45 * k);
    const cHot = new THREE.Color(0xffffff);
    const cMain = new THREE.Color(0xd8f7ff);
    const cCool = new THREE.Color(0x8fdcff);
    // 굵기·지터를 달리 준 세 가닥이 서로 엇갈린다
    const strands: readonly { w: number; j: number; c: THREE.Color }[] = [
      { w: wBase, j: jBase, c: cMain },
      { w: wBase * 0.72, j: jBase * 1.45, c: cCool },
      { w: wBase * 0.6, j: jBase * 0.55, c: cCool },
    ];

    const world: THREE.Vector3[] = [];
    points.forEach((pt, i) => {
      const v = this.cellToWorld(pt.x, pt.z).clone();
      v.y = i === 0 ? startY : pt.flying ? 1.7 : 0.6;
      world.push(v);
    });

    for (let i = 0; i < world.length - 1; i++) {
      const a = world[i] as THREE.Vector3;
      const b = world[i + 1] as THREE.Vector3;
      const span = a.distanceTo(b) || 1;
      // 진행방향에 수직인 정규직교 기저 (u, v)
      const dir = b.clone().sub(a).normalize();
      const u = new THREE.Vector3(-dir.z, 0, dir.x);
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
      u.normalize();
      const v = new THREE.Vector3().crossVectors(dir, u).normalize();

      for (let si = 0; si < strands.length; si++) {
        const st = strands[si] as { w: number; j: number; c: THREE.Color };
        const pts = this.boltPath(a, b, u, v, st.j * span * 0.42, BOLT_SEGS);
        for (let s = 0; s < pts.length - 1; s++) {
          this.pushRibbon(verts, cols, pts[s] as THREE.Vector3, pts[s + 1] as THREE.Vector3, st.w, st.c);
          // 가장 굵은 가닥에만 흰 코어 — 중심이 하얗게 타는 느낌
          if (si === 0) {
            this.pushRibbon(verts, cols, pts[s] as THREE.Vector3, pts[s + 1] as THREE.Vector3, st.w * 0.62, cHot);
          }
        }
        // 본줄에서 갈라져 허공에서 끝나는 짧은 분기
        if (si !== 0) continue;
        const forks = 1 + Math.floor(Math.random() * 2 + k * 0.4);
        for (let f = 0; f < forks; f++) {
          const root = pts[1 + Math.floor(Math.random() * (pts.length - 3))];
          if (!root) continue;
          const len = span * (0.16 + Math.random() * 0.2);
          const off = u
            .clone()
            .multiplyScalar((Math.random() - 0.5) * 2)
            .addScaledVector(v, (Math.random() - 0.5) * 2)
            .normalize();
          const tip = root.clone().addScaledVector(dir, len * 0.55).addScaledVector(off, len * 0.85);
          const fp = this.boltPath(root, tip, u, v, jBase * len * 0.5, 4);
          for (let s = 0; s < fp.length - 1; s++) {
            const taper = 1 - s / (fp.length - 1); // 끝으로 갈수록 가늘게
            this.pushRibbon(
              verts,
              cols,
              fp[s] as THREE.Vector3,
              fp[s + 1] as THREE.Vector3,
              wBase * 0.55 * (0.35 + 0.65 * taper),
              cCool,
            );
          }
        }
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

  /**
   * a→b 를 잇는 지그재그 경로. 오프셋을 수직 평면(u,v)에서 랜덤워크로 누적하고
   * sin(pi·t) 포락선을 곱해 양 끝이 정확히 a/b 에 붙게 한다.
   */
  private boltPath(
    a: THREE.Vector3,
    b: THREE.Vector3,
    u: THREE.Vector3,
    v: THREE.Vector3,
    amp: number,
    segs: number,
  ): THREE.Vector3[] {
    const out: THREE.Vector3[] = [a.clone()];
    let ou = 0;
    let ov = 0;
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      // 랜덤워크 + 중심 복귀 — 한쪽으로 계속 흘러가지 않게
      ou = ou * 0.55 + (Math.random() - 0.5) * 2;
      ov = ov * 0.55 + (Math.random() - 0.5) * 2;
      const env = Math.sin(Math.PI * t); // 끝점에서 0
      const p = a.clone().lerp(b, t);
      p.addScaledVector(u, ou * amp * env);
      p.addScaledVector(v, ov * amp * env);
      out.push(p);
    }
    out.push(b.clone());
    return out;
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
