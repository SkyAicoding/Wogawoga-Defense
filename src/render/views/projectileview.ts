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

/**
 * 동시에 살아 있는 **습격대 투척물** 상한.
 * 타워 투사체와 인스턴스 칸(64)을 나눠 쓰므로, 무리가 한꺼번에 던져도
 * 플레이어의 타워 투사체가 밀려 사라지지 않게 뒤쪽 24칸으로 예산을 묶는다.
 */
const RAID_SHOT_MAX = 24;
/** 손을 떠나는 높이 → 타워에 꽂히는 높이 (월드 단위) */
const RAID_Y0 = 0.52;
const RAID_Y1 = 0.62;
/** 비행 포물선 최고점 — 직선으로 날면 지면 데칼처럼 보인다 */
const RAID_ARC = 0.13;
const RAID_DUR_MIN = 0.1;
const RAID_DUR_MAX = 0.5;

/**
 * instanceColor 를 켜 둘 투사체 메시.
 * 주술 저주는 마젠타여야 하는데(hexer 의 염료·침묵 룬과 같은 계열) 빌려 쓰는
 * brazier 불덩이는 주황이다. 색조를 인스턴스별로 주는 수단이 instanceColor 뿐이라
 * **이 메시만** 켠다 — 켜는 순간 그 메시는 항상 instanceColor 프로그램을 쓰므로
 * 프로그램 수는 그대로 1개다(도중에 켜지지 않아 링크 스톨도 없다).
 */
const RAID_TINTED: ReadonlySet<TowerId> = new Set<TowerId>(['brazier']);

/**
 * 습격대 투척물 — **드로우콜 증가 0** 으로 무언가가 날아가게 하는 방법.
 *
 * 전용 InstancedMesh 를 만들면 무조건 +1콜이다. 대신 이미 만들어 둔 타워 투사체
 * 메시의 **뒷자리 인스턴스**를 빌린다. 성립하는 이유:
 *  · 이 뷰는 플레이어가 그 타워를 갖고 있든 없든 6종 메시를 전부 만들어 둔다.
 *    count = 0 이면 three 가 즉시 반환하므로(primcount 0) 그 메시는 0콜이다.
 *  · 그 타워를 쓰는 플레이어에게는 이미 그려지고 있는 메시라 **+0콜**이고,
 *    안 쓰는 플레이어에게만 그 메시가 켜진다 — 즉 전용 메시(+1콜)보다
 *    **어떤 경우에도 나쁘지 않다**.
 * 물건도 맞아떨어진다: 투창=spear / 큰창=spear 를 크고 느리게 / 화살=ballista 볼트를
 * 작게 / 저주=brazier 구체를 마젠타로 / 전사의 돌=catapult 바위를 작게.
 *
 * 이 투척물은 **sim 에 없다**. 피해는 raidAttack 과 같은 틱에 이미 확정됐고(siege.ts)
 * 여기서 나는 것은 순수 연출이라 명중 판정도, 결정론도 건드리지 않는다.
 */
interface RaidShot {
  borrow: TowerId;
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  /** 손을 떠날 때까지 남은 지연 (초). 그 전에는 그리지 않는다 */
  delay: number;
  /** 비행 진행 0..1 */
  t: number;
  dur: number;
  scale: number;
  tint: number;
}

export interface RaidShotOpts {
  /** 빌려 쓸 타워 투사체 메시 */
  borrow: TowerId;
  scale?: number;
  /** 비행 속도 (타일/초) */
  speed?: number;
  /** instanceColor 색조 (RAID_TINTED 에 든 메시에만 유효) */
  tint?: number;
  /** 무기가 손을 떠날 때까지의 지연 (초) */
  delay?: number;
}

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
/** 투척물 전용 스케일 — 공용 _scl 을 건드리면 타워 투사체까지 같이 커진다 */
const _sclRaid = new THREE.Vector3(1, 1, 1);
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _tint = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const FWD = new THREE.Vector3(1, 0, 0);

export class ProjectileView {
  private meshes = new Map<TowerId, THREE.InstancedMesh>();
  private beams: Beam[] = [];
  private raidShots: RaidShot[] = [];
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
      // 색조가 필요한 메시만 instanceColor 를 켠다 — 켜 두면 three 가 배열을 0(검정)으로
      // 잡으므로 전 칸을 흰색으로 초기화해야 타워 투사체가 까맣게 나오지 않는다
      if (RAID_TINTED.has(id)) {
        for (let i = 0; i < CAPACITY; i++) mesh.setColorAt(i, WHITE);
      }
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
      // 색조를 켠 메시(brazier)는 투척물이 지나간 칸이 물들어 있을 수 있다 — 되돌린다
      if (mesh.instanceColor) mesh.setColorAt(idx, WHITE);
    }

    // 습격대 투척물은 **타워 투사체 뒤에** 붙는다 — 칸이 모자라면 밀리는 쪽이 연출이다
    this.updateRaidShots(counts, dt);

    for (const [id, mesh] of this.meshes) {
      mesh.count = counts.get(id) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
   * 습격대가 던진 것 하나 — 순수 연출 (피해는 이미 확정됐다).
   * 예산이 찼으면 false 를 돌려준다: 호출부는 그때 파티클 궤적으로 대신한다.
   */
  addRaidShot(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    o: RaidShotOpts,
  ): boolean {
    if (this.raidShots.length >= RAID_SHOT_MAX) return false;
    if (!this.meshes.has(o.borrow)) return false;
    const d = Math.hypot(toX - fromX, toZ - fromZ);
    const speed = o.speed ?? 7;
    this.raidShots.push({
      borrow: o.borrow,
      fx: fromX,
      fz: fromZ,
      tx: toX,
      tz: toZ,
      delay: o.delay ?? 0,
      t: 0,
      dur: Math.min(RAID_DUR_MAX, Math.max(RAID_DUR_MIN, d / speed)),
      scale: o.scale ?? 1,
      tint: o.tint ?? 0xffffff,
    });
    return true;
  }

  /**
   * 투척물 비행 — 타워 투사체가 채우고 남은 칸에 이어 그린다.
   * 진행률로 위치를 재계산하고(틱이 없는 연출이라 보간할 prev 가 없다) 진행 방향
   * 접선으로 자세를 잡는다 — 창이 옆으로 날면 그 순간 나무 막대로 보인다.
   */
  private updateRaidShots(counts: Map<TowerId, number>, dt: number): void {
    for (let i = this.raidShots.length - 1; i >= 0; i--) {
      const s = this.raidShots[i] as RaidShot;
      if (s.delay > 0) {
        s.delay -= dt;
        continue; // 아직 손에 있다 — 던지는 동작이 끝나야 나간다
      }
      s.t += dt / s.dur;
      if (s.t >= 1) {
        this.raidShots.splice(i, 1);
        continue;
      }
      const mesh = this.meshes.get(s.borrow);
      if (!mesh) {
        this.raidShots.splice(i, 1);
        continue;
      }
      const idx = counts.get(s.borrow) ?? 0;
      if (idx >= CAPACITY) continue; // 타워 투사체가 칸을 다 썼다 — 이번 프레임은 건너뛴다
      counts.set(s.borrow, idx + 1);

      const t = s.t;
      this.cellToWorld(s.fx, s.fz, _from);
      this.cellToWorld(s.tx, s.tz, _to);
      _pos.lerpVectors(_from, _to, t);
      _pos.y = lerp(RAID_Y0, RAID_Y1, t) + parabola(t, RAID_ARC);
      // 접선 = 수평 변위 + 높이 미분 (포물선이라 해석적으로 낸다)
      _dir.subVectors(_to, _from);
      _dir.y = RAID_Y1 - RAID_Y0 + RAID_ARC * 4 * (1 - 2 * t);
      if (_dir.lengthSq() < 1e-8) _dir.set(1, 0, 0);
      _dir.normalize();
      _quat.setFromUnitVectors(FWD, _dir);
      _mat4.compose(_pos, _quat, _sclRaid.setScalar(s.scale));
      mesh.setMatrixAt(idx, _mat4);
      if (mesh.instanceColor) mesh.setColorAt(idx, _tint.setHex(s.tint));
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
    this.raidShots.length = 0;
  }
}
