/** 임시 계측 하네스 — 폴리/포즈/접지 실측용. 작업 끝나면 지운다. */
import { describe, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
const OUT = '/tmp/claude-0/-home-user/f4d1ce61-6230-58b9-8a9c-fa813cf20c21/scratchpad/probe.txt';
const log = (s: string): void => { appendFileSync(OUT, s + '\n'); };
import * as THREE from 'three';
import { ALL_ALLY_IDS } from '@/data/allies';
import type { AllyId } from '@/data/types';
import {
  allyRig,
  allyVariant,
  buildAlly,
  buildAllySolo,
  buildEnemy,
  buildEnemySolo,
} from '@/render/meshlib/enemies';
import {
  ATK_RELEASE,
  ATK_ROLE_MAIN,
  LIMB_ATTR,
  attackEnvelope,
  groundLiftAt,
  type EnemyRig,
} from '@/render/meshlib/gait';

const tris = (g: THREE.BufferGeometry): number => g.getAttribute('position').count / 3;

function limbTop(id: AllyId, p: number, aim: number): number {
  const rig = allyRig();
  const geo = buildAlly();
  const pos = geo.getAttribute('position')!;
  const limb = geo.getAttribute(LIMB_ATTR)!;
  const vtag = geo.getAttribute('aVarTag')!;
  const variant = allyVariant(id);
  const { wb, fw } = attackEnvelope(p);
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (Math.round(vtag.getX(i)) !== variant) continue;
    const li = Math.round(limb.getX(i)) - 1;
    const s = rig.limbs[li];
    if (!s || s.role !== ATK_ROLE_MAIN) continue;
    if (s.throwAway && p > 0.47 && p < 0.85) continue;
    const o = (variant * 3 + s.role - 1) * 4;
    const back = Math.max(wb, aim * (1 - fw));
    const take = rig.attack[o + 2]! * Math.max(aim, wb + fw);
    const ang = (rig.attack[o]! * back + rig.attack[o + 1]! * fw) * take;
    const px = pos.getX(i) - s.pivot[0];
    const py = pos.getY(i) - s.pivot[1];
    const y = s.pivot[1] + px * Math.sin(ang) + py * Math.cos(ang);
    if (y > top) top = y;
  }
  return top;
}

/** 보행 한 주기 동안 이 변형의 최저점 (지면 관통 확인) */
function walkMin(id: AllyId): { under: number; rest: number } {
  const rig: EnemyRig = allyRig();
  const geo = buildAlly();
  const pos = geo.getAttribute('position')!;
  const limb = geo.getAttribute(LIMB_ATTR)!;
  const vtag = geo.getAttribute('aVarTag')!;
  const variant = allyVariant(id);
  const keep: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = Math.round(vtag.getX(i));
    if (v === 0 || v === variant) keep.push(i);
  }
  let rest = 0;
  for (const i of keep) rest = Math.min(rest, pos.getY(i));
  let under = 0;
  for (let s = 0; s < 64; s++) {
    const g = (s / 64) * Math.PI * 2;
    const body = groundLiftAt(rig, Math.abs(Math.sin(g)));
    let min = Infinity;
    for (const i of keep) {
      const li = Math.round(limb.getX(i)) - 1;
      const sp = rig.limbs[li];
      let y = pos.getY(i);
      if (sp) {
        const ph = g + sp.phase;
        const ang = sp.amp * Math.sin(ph) + sp.amp2 * Math.sin(2 * ph);
        const [ax, ay, az] = sp.axis;
        const px = pos.getX(i) - sp.pivot[0];
        const py = pos.getY(i) - sp.pivot[1];
        const pz = pos.getZ(i) - sp.pivot[2];
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const dot = ax * px + ay * py + az * pz;
        const cy = az * px - ax * pz;
        y = sp.pivot[1] + py * c + cy * sn + ay * dot * (1 - c) + sp.lift * Math.max(0, Math.cos(ph));
      }
      if (y + body < min) min = y + body;
    }
    under = Math.min(under, min);
  }
  return { under, rest };
}

/** 공격 한 주기 동안 이 변형 팔 파트의 최저점 (무기가 땅을 찍는지) */
function attackMin(id: AllyId): number {
  const rig = allyRig();
  const geo = buildAlly();
  const pos = geo.getAttribute('position')!;
  const limb = geo.getAttribute(LIMB_ATTR)!;
  const vtag = geo.getAttribute('aVarTag')!;
  const variant = allyVariant(id);
  let low = Infinity;
  for (let s = 0; s <= 40; s++) {
    const p = s / 40;
    const { wb, fw } = attackEnvelope(p);
    for (let i = 0; i < pos.count; i++) {
      const v = Math.round(vtag.getX(i));
      if (v !== 0 && v !== variant) continue;
      const li = Math.round(limb.getX(i)) - 1;
      const sp = rig.limbs[li];
      if (!sp || sp.role === 0) continue;
      const o = (variant * 3 + sp.role - 1) * 4;
      const back = Math.max(wb, 1 * (1 - fw));
      const take = rig.attack[o + 2]! * Math.max(1, wb + fw);
      const ang = (rig.attack[o]! * back + rig.attack[o + 1]! * fw) * take;
      const px = pos.getX(i) - sp.pivot[0];
      const py = pos.getY(i) - sp.pivot[1];
      const y = sp.pivot[1] + px * Math.sin(ang) + py * Math.cos(ang);
      if (y < low) low = y;
    }
  }
  return low;
}

describe('probe', () => {
  it('measure', () => {
    writeFileSync(OUT, '');
    let soloSum = 0;
    for (const id of ALL_ALLY_IDS) {
      const n = tris(buildAllySolo(id));
      soloSum += n;
      const g = buildAllySolo(id);
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      log(
        `solo ${id.padEnd(9)} tris=${n}  bbox y=[${bb.min.y.toFixed(3)},${bb.max.y.toFixed(3)}] x=[${bb.min.x.toFixed(2)},${bb.max.x.toFixed(2)}] z=[${bb.min.z.toFixed(2)},${bb.max.z.toFixed(2)}]`,
      );
    }
    const shared = tris(buildAlly());
    log(`ally shared=${shared} soloSum=${soloSum} ratio=${(shared / soloSum).toFixed(3)}`);
    log(`raider shared=${tris(buildEnemy('blade'))} hexer solo=${tris(buildEnemySolo('hexer'))}`);
    for (const id of ALL_ALLY_IDS) {
      const ready = limbTop(id, 0, 1);
      const rest = limbTop(id, 0, 0);
      const hit = limbTop(id, ATK_RELEASE, 1);
      const w = walkMin(id);
      log(
        `pose ${id.padEnd(9)} ready=${ready.toFixed(3)} rest=${rest.toFixed(3)} hit=${hit.toFixed(3)} drop=${(ready - hit).toFixed(3)} walkUnder=${w.under.toFixed(4)} rest0=${w.rest.toFixed(4)} atkMin=${attackMin(id).toFixed(3)}`,
      );
    }
  });
});
