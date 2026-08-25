import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { build } from '@/render/stage3d';
import { STAGES } from '@/data';
import type { EnemyState } from '@/data/types';

const Q = { shadows: true, particles: 1, antialias: true, dpr: 2 } as never;

function foe(o: Partial<EnemyState>): EnemyState {
  return {
    id: 1, defId: 'raptor', hp: 10, maxHp: 10, shieldHitsLeft: 0, dist: 12, pathIndex: 0,
    attackCdLeft: 0, towerTargetId: -1, siegeHoldLeft: 0, attackAnimLeft: 0, attackAnimTicks: 0,
    blockerAllyId: -1, gateTicks: 0, gateBiteCdLeft: 0, gateOwed: 0,
    flying: false, x: 9, z: 11.5, prevX: 9, prevZ: 11.5, heading: 0, statuses: [],
    bounty: 1, baseDamage: 1, radius: 0.3, alive: true, hpMul: 1, ...o,
  } as EnemyState;
}

/** three 가 실제로 그리는 것 = visible 한 Mesh 중 InstancedMesh 는 count>0 인 것 */
function drawables(scene: THREE.Object3D): { calls: number; tris: number; names: string[] } {
  let calls = 0, tris = 0; const names: string[] = [];
  scene.traverseVisible((o) => {
    const m = o as THREE.Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; count?: number };
    if (!m.isMesh) return;
    const inst = m.isInstancedMesh === true;
    const n = inst ? (m.count ?? 0) : 1;
    if (n <= 0) return;
    calls++;
    names.push(`${o.name || o.type}${inst ? `×${n}` : ''}`);
    const g = m.geometry as THREE.BufferGeometry;
    const idx = g.getIndex();
    const t = (idx ? idx.count : (g.getAttribute('position')?.count ?? 0)) / 3;
    tris += t * n;
    // 그림자 캐스터는 depth 패스에서 한 번 더 그려진다
    if (m.castShadow) { calls++; tris += t * n; }
  });
  return { calls, tris, names };
}

describe('문간 드로우콜 실측', () => {
  it('문 앞 대열이 서도 메시가 한 개도 안 는다', () => {
    const s3 = build(STAGES[0]!, Q);
    s3.setBaseLevel(1);
    const cw = s3.cellToWorld.bind(s3);
    const walking = Array.from({ length: 18 }, (_, i) =>
      foe({ id: 100 + i, defId: i % 3 === 0 ? 'blade' : i % 3 === 1 ? 'raptor' : 'ptera',
            flying: i % 3 === 2, x: 5 + i * 0.2, prevX: 5 + i * 0.2 - 0.05, dist: 6 }));
    s3.enemies.update(walking, 1, cw, 0.033, []);
    s3.update(0.033);
    const a = drawables(s3.scene);

    const atGate = walking.map((e, i) => ({ ...e, gateTicks: 5 + i, gateOwed: 1, dist: 12,
      x: 9 + ((i % 3) - 1) * 0.6, prevX: 9 + ((i % 3) - 1) * 0.6, z: 11.5, prevZ: 11.5 }));
    s3.enemies.update(atGate, 1, cw, 0.033, []);
    s3.update(0.033);
    const b = drawables(s3.scene);
    console.log('걷는 중  ', JSON.stringify({ calls: a.calls, tris: Math.round(a.tris) }));
    console.log('문 앞 대열', JSON.stringify({ calls: b.calls, tris: Math.round(b.tris) }));
    console.log('A메시', a.names.join(' · '));
    console.log('B메시', b.names.join(' · '));
    expect(b.calls).toBe(a.calls);
  });

  it('보스 두 마리가 문 앞에 서도 콜이 안 는다', () => {
    const s3 = build(STAGES[0]!, Q);
    s3.setBaseLevel(5);
    const cw = s3.cellToWorld.bind(s3);
    const mk = (gate: number) => [
      foe({ id: 1, defId: 'trex', radius: 0.8, dist: 12, x: 9, prevX: 9, gateTicks: gate, gateOwed: 12, baseDamage: 12 }),
      foe({ id: 2, defId: 'spino', radius: 0.7, dist: 12, x: 9.6, prevX: 9.6, gateTicks: gate, gateOwed: 5, baseDamage: 5 }),
    ];
    s3.enemies.update(mk(0), 1, cw, 0.033, []); s3.update(0.033);
    const a = drawables(s3.scene);
    s3.enemies.update(mk(40), 1, cw, 0.033, []); s3.update(0.033);
    const b = drawables(s3.scene);
    console.log('보스 걷는 중', JSON.stringify({ calls: a.calls, tris: Math.round(a.tris) }));
    console.log('보스 문 앞  ', JSON.stringify({ calls: b.calls, tris: Math.round(b.tris) }));
    expect(b.calls).toBe(a.calls);
  });
});
