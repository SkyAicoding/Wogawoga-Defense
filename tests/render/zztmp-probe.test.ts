/* 임시 계측 — 판정 후 삭제한다 */
import { describe, it } from 'vitest';
import fs from 'node:fs';
const LOG: string[] = [];
const log = (...a: unknown[]): void => { LOG.push(a.join(' ')); };
import * as THREE from 'three';
import { ENEMY_DEFS } from '@/data/enemies';
import { GATE_STANDOFF_EDGE } from '@/data/balance';
import { createBasecamp } from '@/render/meshlib/basecamp';
import { ALL_ENEMY_IDS, BOSS_ENEMIES, buildEnemy, enemyGeoKey } from '@/render/meshlib/enemies';
import { EnemyView } from '@/render/views/enemyview';
import type { EnemyId, EnemyState } from '@/data/types';

const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

function gated(id: EnemyId, stand: number): EnemyState {
  return {
    id: 1, defId: id, hp: 10, maxHp: 10, shieldHitsLeft: 0, dist: 4, pathIndex: 0,
    attackCdLeft: 0, towerTargetId: -1, siegeHoldLeft: 0, attackAnimLeft: 0, attackAnimTicks: 0,
    blockerAllyId: -1, gateTicks: 30, gateBiteCdLeft: 0, gateOwed: 4,
    flying: ENEMY_DEFS[id].flying, x: -stand, z: 0, prevX: -stand, prevZ: 0, heading: 0,
    statuses: [], bounty: 1, baseDamage: ENEMY_DEFS[id].baseDamage, radius: ENEMY_DEFS[id].radius,
    alive: true, hpMul: 1,
  } as EnemyState;
}

/** 마을 만렙 삼각형 (월드) */
function villageTris(): Float32Array {
  const camp = createBasecamp();
  camp.setLevel(5, 5);
  camp.setDamageLevel(0);
  camp.group.updateMatrixWorld(true);
  const out: number[] = [];
  const v = new THREE.Vector3();
  camp.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      const k = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  camp.dispose();
  return new Float32Array(out);
}

/** 수직 광선 패리티 — 점이 닫힌 볼륨 안인가 */
function insideCount(pts: Float32Array, tris: Float32Array): { n: number; deepest: number[] | null } {
  let n = 0;
  let deepest: number[] | null = null;
  let bestR = 99;
  for (let p = 0; p < pts.length; p += 3) {
    const px = pts[p]!, py = pts[p + 1]!, pz = pts[p + 2]!;
    let cross = 0;
    let below = 0;
    for (let t = 0; t < tris.length; t += 9) {
      const ax = tris[t]!, ay = tris[t + 1]!, az = tris[t + 2]!;
      const bx = tris[t + 3]!, by = tris[t + 4]!, bz = tris[t + 5]!;
      const cx = tris[t + 6]!, cy = tris[t + 7]!, cz = tris[t + 8]!;
      // xz 평면에서 점이 삼각형 안인가 (무게중심)
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
      const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      if (y > py) cross++; else below++;
    }
    if (cross % 2 === 1 && below % 2 === 1) {
      n++;
      const r = Math.hypot(px, pz);
      if (r < bestR) { bestR = r; deepest = [px, py, pz, r]; }
    }
  }
  return { n, deepest };
}

describe('probe', () => {
  it('측정', () => {
    const tris = villageTris();
    log('village tris', tris.length / 9);
    // 마을 반경대별 높이 (전 방위)
    const bins = new Map<number, { hi: number; lo: number }>();
    for (let t = 0; t < tris.length; t += 3) {
      const r = Math.hypot(tris[t]!, tris[t + 2]!);
      const k = Math.round(r * 100);
      const b = bins.get(k) ?? { hi: -9, lo: 9 };
      b.hi = Math.max(b.hi, tris[t + 1]!);
      b.lo = Math.min(b.lo, tris[t + 1]!);
      bins.set(k, b);
    }
    const rows: string[] = [];
    for (const k of [...bins.keys()].sort((a, b) => a - b)) {
      if (k < 110) continue;
      const b = bins.get(k)!;
      rows.push(`${(k / 100).toFixed(2)}: ${b.lo.toFixed(3)}~${b.hi.toFixed(3)}`);
    }
    log('반경별 높이(1.10~):', rows.join(' | '));

    const _m = new THREE.Matrix4();
    const _v = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    for (const id of ALL_ENEMY_IDS) {
      const stand = GATE_STANDOFF_EDGE + ENEMY_DEFS[id].restReach;
      const view = new EnemyView(new THREE.Scene());
      const e = gated(id, stand);
      const boss = BOSS_ENEMIES.has(id);
      const geo = buildEnemy(id);
      const pos = geo.getAttribute('position');
      let best: { r: number; y: number; m: THREE.Matrix4 } | null = null;
      for (let f = 0; f < 400; f++) {
        view.update([e], 1, cellToWorld, 1 / 60);
        if (f < 300) continue;
        const inner = view as unknown as {
          meshes: Map<string, THREE.InstancedMesh>;
          bossPool: Map<EnemyId, THREE.Mesh[]>;
        };
        if (boss) {
          const mm = (inner.bossPool.get(id) as THREE.Mesh[])[0]!;
          mm.updateMatrix();
          _m.copy(mm.matrix);
        } else {
          inner.meshes.get(enemyGeoKey(id))!.getMatrixAt(0, _m);
        }
        // 이 자세의 가장 앞선 정점 (마을 중심 = 원점 기준 최소 반경)
        let mr = 99; let my = 0;
        for (let i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
          const r = Math.hypot(_v.x, _v.z);
          if (r < mr) { mr = r; my = _v.y; }
        }
        if (!best || mr < best.r) best = { r: mr, y: my, m: _m.clone() };
      }
      // 정지 자세 (aim 0) — 첫 프레임
      const view2 = new EnemyView(new THREE.Scene());
      const e2 = gated(id, stand);
      e2.gateTicks = 0;
      for (let f = 0; f < 60; f++) view2.update([e2], 1, cellToWorld, 1 / 60);
      const inner2 = view2 as unknown as {
        meshes: Map<string, THREE.InstancedMesh>;
        bossPool: Map<EnemyId, THREE.Mesh[]>;
      };
      const m2 = new THREE.Matrix4();
      if (boss) { const mm = (inner2.bossPool.get(id) as THREE.Mesh[])[0]!; mm.updateMatrix(); m2.copy(mm.matrix); }
      else inner2.meshes.get(enemyGeoKey(id))!.getMatrixAt(0, m2);
      let rr = 99; let ry = 0;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(m2);
        const r = Math.hypot(_v.x, _v.z);
        if (r < rr) { rr = r; ry = _v.y; }
      }
      // 물기 자세 전 정점을 월드로
      const pts = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(best!.m);
        pts[i * 3] = _v.x; pts[i * 3 + 1] = _v.y; pts[i * 3 + 2] = _v.z;
      }
      // 접근 방위 24 방향 — 마을 메시는 회전 대칭이 아니고(목책 문 · 망루) 스테이지마다
      // 적이 오는 쪽이 다르다. 로컬 자세는 방위와 무관하므로 점구름만 Y로 돌린다.
      let worst = { n: 0, deep: 1e9, y: 0, azDeg: 0 };
      const near = new Float32Array(pts.length);
      let nn = 0;
      for (let i = 0; i < pts.length; i += 3) {
        if (Math.hypot(pts[i]!, pts[i + 2]!) < 1.55) {
          near[nn] = pts[i]!; near[nn + 1] = pts[i + 1]!; near[nn + 2] = pts[i + 2]!; nn += 3;
        }
      }
      const sub = near.subarray(0, nn);
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const da = a - Math.PI;
        const ca = Math.cos(da), sa = Math.sin(da);
        const rot = new Float32Array(nn);
        for (let i = 0; i < nn; i += 3) {
          const x = sub[i]!, z = sub[i + 2]!;
          rot[i] = x * ca + z * sa; rot[i + 1] = sub[i + 1]!; rot[i + 2] = -x * sa + z * ca;
        }
        const r2 = insideCount(rot, tris);
        if (r2.n > worst.n || (r2.n === worst.n && r2.n > 0 && r2.deepest![3]! < worst.deep)) {
          worst = { n: r2.n, deep: r2.deepest ? r2.deepest[3]! : 1e9, y: r2.deepest ? r2.deepest[1]! : 0, azDeg: Math.round((a * 180) / Math.PI) };
        }
      }
      log(
        `${id.padEnd(8)} stand ${stand.toFixed(3)} | 정지 앞끝 r=${rr.toFixed(3)} y=${ry.toFixed(3)}` +
        ` | 물기 코끝 r=${best!.r.toFixed(3)} y=${best!.y.toFixed(3)}` +
        ` | 최악방위 ${String(worst.azDeg).padStart(3)}° 마을 안 정점 ${worst.n}` +
        (worst.n ? ` (최심 r=${worst.deep.toFixed(3)} y=${worst.y.toFixed(3)})` : ''),
      );
      view.dispose(); view2.dispose();
    }
    fs.writeFileSync('/tmp/claude-0/-home-user/f4d1ce61-6230-58b9-8a9c-fa813cf20c21/scratchpad/probe.txt', LOG.join('\n'));
  }, 600000);
});
