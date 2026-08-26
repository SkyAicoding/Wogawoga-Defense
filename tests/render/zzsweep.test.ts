import { describe, it } from 'vitest';
import { build } from '@/render/stage3d';
import { STAGES } from '@/data';
import { buildTower } from '@/render/meshlib/towers';
import { drawables } from './drawcount';
import type { TowerId } from '@/data/types';

const Q = { shadows: true, particles: 1, antialias: true, dpr: 2 } as never;
const IDS: TowerId[] = ['spear', 'catapult', 'lightning', 'brazier', 'frost', 'poison', 'ballista', 'drum'];

function tris(g: { getIndex(): unknown; getAttribute(n: string): { count: number } | undefined } | null): number {
  if (!g) return 0;
  const a = g.getAttribute('position');
  return a ? a.count / 3 : 0;
}

describe('zz sweep', () => {
  it('tower geometry sizes', () => {
    let sum = 0;
    for (const id of IDS) {
      const row: string[] = [];
      let sp = 0;
      for (let t = 0; t < 5; t++) {
        const m = buildTower(id, t);
        const b = tris(m.base as never);
        const h = tris(m.head as never);
        const a = tris(m.action as never);
        row.push(`T${t + 1}: body=${b + h} act=${a}`);
        sp += b + h + a;
      }
      sum += sp;
      process.stdout.write('ZZ '+[`${id.padEnd(10)} ${row.join('  ')}  | 5티어합=${sp}`].join(' ')+'\n');
    }
    process.stdout.write('ZZ '+['전 종·티어 삼각형 총합', sum].join(' ')+'\n');
  });

  it('draw sweep same-kind', () => {
    for (const n of [0, 4, 8, 12, 16, 20, 24]) {
      const s3 = build(STAGES[0]!, Q);
      for (let i = 0; i < n; i++) s3.towers.add(i, 'spear', 0, 3 + (i % 8), 3 + Math.floor(i / 8));
      s3.update(0.033);
      const d = drawables(s3.scene);
      process.stdout.write('ZZ '+[`같은종 n=${n}: ${d.calls}콜 / ${d.tris}삼각형`].join(' ')+'\n');
      s3.dispose();
    }
  });

  it('draw sweep distinct-kind', () => {
    for (const n of [0, 4, 8, 12, 16, 20, 24, 40]) {
      const s3 = build(STAGES[0]!, Q);
      for (let i = 0; i < n; i++) {
        s3.towers.add(i, IDS[i % 8]!, Math.floor(i / 8) % 5, 3 + (i % 8), 3 + Math.floor(i / 8));
      }
      s3.update(0.033);
      const d = drawables(s3.scene);
      process.stdout.write('ZZ '+[`전종섞기 n=${n}: ${d.calls}콜 / ${d.tris}삼각형`].join(' ')+'\n');
      s3.dispose();
    }
  });
});
