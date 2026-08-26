import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
const OUT: string[] = [];
import * as THREE from 'three';
import { build } from '@/render/stage3d';
import { ALL_TOWER_IDS, STAGES } from '@/data';
import type { EnemyId, EnemyState, TowerId } from '@/data/types';
import { BASE_LEVEL_MAX } from '@/data/hometown';
import { forEachDrawn, drawables } from './drawcount';

const Q = { shadows: true, particles: 1, antialias: true, dpr: 2, groundDetail: 1 } as never;
const IDS = ALL_TOWER_IDS as readonly TowerId[];
const FOES: readonly EnemyId[] = ['raptor','compy','trike','ptera','ankylo','boar','warrior','shaman','blade','lancer','archer','hexer','mammoth','spino','trex','golem'] as never;

function foe(i: number): EnemyState {
  const d = FOES[i % FOES.length]!;
  return {
    id: 100 + i, defId: d, hp: 5, maxHp: 10, shieldHitsLeft: 0, dist: 4, pathIndex: 0,
    attackCdLeft: 0, towerTargetId: -1, siegeHoldLeft: 0, attackAnimLeft: 0, attackAnimTicks: 0,
    blockerAllyId: -1, gateTicks: 3, gateBiteCdLeft: 0, gateOwed: 1,
    flying: d === 'ptera', x: 6 + (i % 8) * 0.5, z: 9 + Math.floor(i / 8) * 0.5,
    prevX: 6 + (i % 8) * 0.5, prevZ: 9 + Math.floor(i / 8) * 0.5, heading: 0, statuses: [],
    bounty: 1, baseDamage: 1, radius: 0.3, alive: true, hpMul: 1,
  } as never;
}

function heavy(stageIdx: number, nTowers: number, nFoes: number) {
  const s3 = build(STAGES[stageIdx]!, Q);
  s3.setBaseLevel(BASE_LEVEL_MAX);
  let n = 0;
  for (let z = 1; z < 40 && n < nTowers; z++) {
    for (let x = 1; x < 40 && n < nTowers; x++) {
      s3.towers.add(n, IDS[n % IDS.length]!, 4, x, z);
      n++;
    }
  }
  const foes = Array.from({ length: nFoes }, (_, i) => foe(i));
  const cw = s3.cellToWorld.bind(s3);
  for (let i = 0; i < 4; i++) { s3.enemies.update(foes, 20, cw, 0.016, []); s3.update(0.016); }
  return s3;
}

function breakdown(s: THREE.Object3D): Map<string, { calls: number; tris: number; n: number }> {
  const m = new Map<string, { calls: number; tris: number; n: number }>();
  forEachDrawn(s, (mesh, t, shadow) => {
    const anc: string[] = [];
    let o: THREE.Object3D | null = mesh;
    while (o) { anc.push(o.name || `<${o.type}>`); o = o.parent; }
    const kind = (mesh as unknown as {isInstancedMesh?:boolean}).isInstancedMesh ? `INST×${(mesh as THREE.InstancedMesh).count}` : (mesh as unknown as {isBatchedMesh?:boolean}).isBatchedMesh ? 'BATCH' : 'MESH';
    const k = `${anc.slice(0,3).reverse().join('/')} ${kind}${shadow ? ' [SHADOW×2]' : ''}`;
    const e = m.get(k) ?? { calls: 0, tris: 0, n: 0 };
    e.calls += shadow ? 2 : 1; e.tris += shadow ? t * 2 : t; e.n++;
    m.set(k, e);
  });
  return m;
}

describe('zz probe', () => {
  it('worst frame breakdown', () => {
    for (const [name, idx, nT] of [['s3', 2, 12], ['s3', 2, 18], ['s1', 0, 12]] as const) {
      const s3 = heavy(idx, nT, 56);
      const d = drawables(s3.scene);
      OUT.push(`\n===== ${name} towers=${nT} foes=56 : ${d.calls}콜 / ${d.tris}삼각형 =====`);
      const rows = [...breakdown(s3.scene)].sort((a, b) => b[1].tris - a[1].tris);
      for (const [k, v] of rows) OUT.push(`  ${String(v.tris).padStart(8)}  ${String(v.calls).padStart(3)}콜  n=${v.n}  ${k}`);
      s3.dispose();
    }
    writeFileSync('/tmp/claude-0/-home-user/f4d1ce61-6230-58b9-8a9c-fa813cf20c21/scratchpad/zzprobe.txt', OUT.join('\n'));
    expect(1).toBe(1);
  });
});
