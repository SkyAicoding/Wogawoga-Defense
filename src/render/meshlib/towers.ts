/**
 * 타워 8종 × 5티어 프로시저럴 모델.
 * 티어가 오르면 크기/부속/발광부가 늘어난다. buildTower(id, tier)는 키 캐시된
 * { main(라이팅), glow(발광) } 지오메트리 쌍을 돌려준다. t = 0~4.
 */
import type * as THREE from 'three';
import type { TowerId } from '@/data/types';
import { C } from '../palette';
import { buildParts, cachedGeo, type PartSpec } from './factory';

export interface TowerModel {
  main: THREE.BufferGeometry;
  /** 발광부 (없으면 null) — glowMat로 렌더 */
  glow: THREE.BufferGeometry | null;
}

type Parts = { main: PartSpec[]; glow: PartSpec[] };

function spear(t: number): Parts {
  const main: PartSpec[] = [];
  const raised = t >= 2; // 티어3부터 망루화
  const deck = raised ? 0.42 + (t - 2) * 0.16 : 0;
  if (raised) {
    for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) {
      main.push({ kind: 'cyl', pos: [lx, deck / 2, lz], rot: [0, 0, lx * 0.12], scale: [0.09, deck, 0.09], color: C.woodDark, seg: 5 });
    }
    main.push({ kind: 'box', pos: [0, deck, 0], scale: [0.92, 0.08, 0.92], color: C.wood, hueJitter: 0.01 });
    main.push({ kind: 'box', pos: [0, deck + 0.12, 0.42], scale: [0.9, 0.18, 0.06], color: C.woodDark });
    main.push({ kind: 'box', pos: [0, deck + 0.12, -0.42], scale: [0.9, 0.18, 0.06], color: C.woodDark });
  }
  const hutY = deck + 0.04;
  main.push(
    { kind: 'cyl', pos: [0, hutY + 0.18, 0], scale: [0.52, 0.36, 0.52], color: C.hide, seg: 7, hueJitter: 0.015 },
    { kind: 'cone', pos: [0, hutY + 0.52, 0], scale: [0.66 + t * 0.02, 0.4, 0.66 + t * 0.02], color: C.straw, seg: 7, hueJitter: 0.02 },
  );
  // 꽂힌 창 1+t개
  const n = 1 + t;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.5;
    const x = Math.cos(a) * 0.34;
    const z = Math.sin(a) * 0.34;
    main.push(
      { kind: 'cyl', pos: [x, hutY + 0.62, z], rot: [z * 0.5, 0, -x * 0.5], scale: [0.035, 0.75, 0.035], color: C.wood, seg: 4 },
      { kind: 'cone', pos: [x * 1.18, hutY + 0.99, z * 1.18], rot: [z * 0.5, 0, -x * 0.5], scale: [0.09, 0.18, 0.09], color: C.stone, seg: 4 },
    );
  }
  if (t >= 4) main.push({ kind: 'box', pos: [0, hutY + 0.95, 0], rot: [0, 0.4, 0], scale: [0.06, 0.5, 0.06], color: C.woodDark }, { kind: 'box', pos: [0.14, hutY + 1.1, 0], rot: [0, 0.4, 0], scale: [0.3, 0.2, 0.02], color: C.banner });
  return { main, glow: [] };
}

function catapult(t: number): Parts {
  const boneAge = t >= 3; // 매머드뼈 투석기
  const frame = boneAge ? C.bone : C.wood;
  const s = 1 + t * 0.07;
  const main: PartSpec[] = [
    { kind: 'box', pos: [0, 0.08, 0], scale: [0.9 * s, 0.14, 0.7 * s], color: C.woodDark, hueJitter: 0.01 },
    { kind: 'box', pos: [0, 0.3, 0.26 * s], rot: [0.5, 0, 0], scale: [0.1, 0.62 * s, 0.1], color: frame },
    { kind: 'box', pos: [0, 0.3, -0.26 * s], rot: [-0.5, 0, 0], scale: [0.1, 0.62 * s, 0.1], color: frame },
    { kind: 'cyl', pos: [0, 0.42 * s, 0], rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.6 * s, 0.07], color: boneAge ? C.boneDark : C.woodDark, seg: 5 },
    // 투척 암 (뒤로 젖힘)
    { kind: 'box', pos: [-0.18 * s, 0.52 * s, 0], rot: [0, 0, -0.7], scale: [0.8 * s, 0.09, 0.12], color: frame },
    { kind: 'cyl', pos: [-0.48 * s, 0.82 * s, 0], scale: [0.26 * s, 0.1, 0.26 * s], color: C.woodDark, seg: 6 },
    { kind: 'ico', pos: [-0.48 * s, 0.92 * s, 0], scale: 0.24 * s, color: C.stone, hueJitter: 0.02 },
    // 카운터웨이트
    { kind: 'ico', pos: [0.3 * s, 0.34 * s, 0], scale: 0.26 * s, color: C.stoneDark },
  ];
  if (boneAge) {
    main.push(
      { kind: 'cyl', pos: [0.34 * s, 0.4, 0.3 * s], rot: [0, 0, -0.8], scale: [0.07, 0.7, 0.07], color: C.bone, seg: 5 },
      { kind: 'cyl', pos: [0.34 * s, 0.4, -0.3 * s], rot: [0, 0, -0.8], scale: [0.07, 0.7, 0.07], color: C.bone, seg: 5 },
    );
  }
  if (t >= 4) main.push({ kind: 'sphere', pos: [-0.55, 0.2, 0.3], scale: 0.3, color: C.bone });
  return { main, glow: [] };
}

function lightning(t: number): Parts {
  const main: PartSpec[] = [];
  const glow: PartSpec[] = [];
  const segs = 2 + Math.min(t, 2);
  let y = 0;
  for (let i = 0; i < segs; i++) {
    const h = 0.3 - i * 0.03;
    const r = 0.3 - i * 0.045;
    main.push({ kind: 'cyl', pos: [0, y + h / 2, 0], scale: [r * 2, h, r * 2], color: i % 2 === 0 ? C.wood : C.boneDark, seg: 6, hueJitter: 0.015 });
    y += h + 0.02;
  }
  // 해골 장식
  main.push({ kind: 'sphere', pos: [0.26, y - 0.34, 0.12], scale: 0.17, color: C.bone });
  if (t >= 1) main.push({ kind: 'sphere', pos: [-0.24, y - 0.2, -0.14], scale: 0.15, color: C.bone });
  // 정상 크리스탈 (발광) — 티어 오를수록 커지고 부유 크리스탈 추가
  const cs = 0.2 + t * 0.05;
  glow.push(
    { kind: 'ico', pos: [0, y + cs * 0.9, 0], rot: [0.3, 0.5, 0.2], scale: [cs, cs * 1.9, cs], color: C.crystal },
  );
  main.push({ kind: 'cone', pos: [0, y + 0.05, 0], scale: [0.24, 0.12, 0.24], color: C.black, seg: 6 });
  if (t >= 3) {
    glow.push(
      { kind: 'ico', pos: [0.3, y + 0.3, 0.16], scale: 0.11, color: 0x9af2ff },
      { kind: 'ico', pos: [-0.28, y + 0.44, -0.1], scale: 0.09, color: 0x9af2ff },
    );
  }
  if (t >= 4) glow.push({ kind: 'ico', pos: [0.05, y + 0.72, -0.22], scale: 0.12, color: 0xd2faff });
  return { main, glow };
}

function brazier(t: number): Parts {
  const volcanic = t >= 3; // 화산석 화로
  const stone = volcanic ? 0x4c3733 : C.stone;
  const r = 0.34 + t * 0.03;
  const main: PartSpec[] = [];
  const glow: PartSpec[] = [];
  const ringN = 7;
  for (let i = 0; i < ringN; i++) {
    const a = (i / ringN) * Math.PI * 2;
    main.push({ kind: 'ico', pos: [Math.cos(a) * r, 0.12, Math.sin(a) * r], rot: [i, i * 1.7, 0], scale: 0.2 + (i % 2) * 0.04, color: stone, hueJitter: 0.012 });
  }
  main.push(
    { kind: 'cyl', pos: [0, 0.1, 0], scale: [r * 1.7, 0.16, r * 1.7], color: volcanic ? 0x382622 : C.stoneDark, seg: 8 },
    { kind: 'cyl', pos: [0, 0.16, 0], rot: [0, 0.4, 1.3], scale: [0.08, 0.5, 0.08], color: C.woodDark, seg: 5 },
    { kind: 'cyl', pos: [0, 0.18, 0], rot: [1.3, 1.2, 0], scale: [0.08, 0.5, 0.08], color: 0x4a3018, seg: 5 },
  );
  if (volcanic) {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 0.4;
      glow.push({ kind: 'box', pos: [Math.cos(a) * r * 0.9, 0.1, Math.sin(a) * r * 0.9], rot: [0, a, 0], scale: [0.16, 0.04, 0.05], color: C.lava });
    }
  }
  const fs = 0.7 + t * 0.12;
  glow.push(
    { kind: 'cone', pos: [0, 0.24 + 0.3 * fs, 0], scale: [0.42 * fs, 0.62 * fs, 0.42 * fs], color: C.fire, seg: 6 },
    { kind: 'cone', pos: [0.03, 0.22 + 0.22 * fs, 0.02], scale: [0.26 * fs, 0.44 * fs, 0.26 * fs], color: 0xffd24a, seg: 5 },
  );
  if (t >= 2) glow.push({ kind: 'cone', pos: [-0.12, 0.3, 0.1], rot: [0, 0, 0.3], scale: [0.14 * fs, 0.3 * fs, 0.14 * fs], color: C.ember, seg: 4 });
  return { main, glow };
}

function frost(t: number): Parts {
  const main: PartSpec[] = [
    { kind: 'sphere', pos: [0, 0.08, 0], scale: [0.9, 0.24, 0.9], color: C.snowCap },
  ];
  const glow: PartSpec[] = [];
  const h = 0.55 + t * 0.17; // t4 = 빙하 첨탑
  glow.push({ kind: 'cone', pos: [0, h / 2 + 0.1, 0], scale: [0.34 + t * 0.02, h, 0.34 + t * 0.02], color: C.iceDeep, seg: 6 });
  const n = 2 + t;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.8;
    const rr = 0.3 + (i % 2) * 0.08;
    glow.push({
      kind: 'cone',
      pos: [Math.cos(a) * rr, 0.22, Math.sin(a) * rr],
      rot: [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45],
      scale: [0.14, 0.34 + (i % 3) * 0.1, 0.14],
      color: C.ice,
      seg: 5,
    });
  }
  if (t >= 3) glow.push({ kind: 'ico', pos: [0.02, h + 0.24, 0], scale: 0.14, color: 0xe2faff });
  return { main, glow };
}

function poison(t: number): Parts {
  const main: PartSpec[] = [
    { kind: 'cyl', pos: [0, 0.06, 0], scale: [0.8, 0.12, 0.8], color: 0x4a6a2a, seg: 7, hueJitter: 0.02 },
  ];
  const glow: PartSpec[] = [];
  // 가시덩굴
  const n = 4 + t;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const rr = 0.32 + (i % 2) * 0.06;
    main.push({
      kind: 'cone',
      pos: [Math.cos(a) * rr, 0.2, Math.sin(a) * rr],
      rot: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6],
      scale: [0.09, 0.3 + (i % 3) * 0.08, 0.09],
      color: C.poisonDark,
      seg: 4,
    });
  }
  const bs = 0.24 + t * 0.05;
  const by = 0.2 + bs;
  main.push({ kind: 'cyl', pos: [0, 0.2, 0], scale: [0.2, 0.3, 0.2], color: 0x3f7a24, seg: 5 });
  glow.push({ kind: 'sphere', pos: [0, by, 0], scale: [bs * 2, bs * 1.7, bs * 2], color: C.poison });
  if (t >= 3) {
    // 식충 거대화: 벌린 턱잎
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      main.push({
        kind: 'cone',
        pos: [Math.cos(a) * bs * 1.1, by + bs * 0.9, Math.sin(a) * bs * 1.1],
        rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9],
        scale: [0.16, 0.34, 0.06],
        color: 0xb8478a,
      });
    }
  }
  if (t >= 4) glow.push({ kind: 'sphere', pos: [0.3, 0.3, 0.24], scale: 0.18, color: 0xc0f24a });
  return { main, glow };
}

function ballista(t: number): Parts {
  const twin = t >= 4; // 쌍상아
  const s = 1 + t * 0.06;
  const main: PartSpec[] = [
    { kind: 'cyl', pos: [0, 0.09, 0], scale: [0.8 * s, 0.18, 0.8 * s], color: C.woodDark, seg: 7, hueJitter: 0.01 },
    { kind: 'box', pos: [0, 0.3, 0], scale: [0.7 * s, 0.16, 0.24], color: C.wood },
    { kind: 'box', pos: [-0.1, 0.42, 0], scale: [0.5 * s, 0.07, 0.14], color: C.woodDark },
  ];
  const bows = twin ? [-0.1, 0.14] : [0];
  for (const dy of bows) {
    // 상아 활 (좌우로 굽은 뿔)
    for (const side of [-1, 1]) {
      main.push(
        { kind: 'cyl', pos: [0.14, 0.42 + dy, side * 0.26 * s], rot: [side * 0.5, 0, 0], scale: [0.07, 0.5 * s, 0.07], color: C.bone, seg: 5 },
        { kind: 'cone', pos: [0.2, 0.62 + dy, side * 0.44 * s], rot: [side * 0.9, 0, 0], scale: [0.08, 0.3, 0.08], color: C.boneDark, seg: 5 },
      );
    }
    // 장전된 볼트
    main.push(
      { kind: 'cyl', pos: [0.16, 0.46 + dy, 0], rot: [0, 0, Math.PI / 2], scale: [0.045, 0.7 * s, 0.045], color: C.boneDark, seg: 4 },
      { kind: 'cone', pos: [0.54 * s, 0.46 + dy, 0], rot: [0, 0, -Math.PI / 2], scale: [0.09, 0.18, 0.09], color: C.bone, seg: 4 },
    );
  }
  if (t >= 2) main.push({ kind: 'sphere', pos: [-0.3 * s, 0.28, 0.24 * s], scale: 0.2, color: C.bone });
  return { main, glow: [] };
}

function drum(t: number): Parts {
  const big = t >= 3;
  const r = (0.3 + t * 0.035) * 2;
  const h = 0.34 + t * 0.05;
  const main: PartSpec[] = [
    // 다리 3개
    { kind: 'cyl', pos: [0.2, 0.1, 0.14], rot: [0.2, 0, -0.2], scale: [0.07, 0.24, 0.07], color: C.woodDark, seg: 4 },
    { kind: 'cyl', pos: [-0.22, 0.1, 0.12], rot: [0.2, 0, 0.2], scale: [0.07, 0.24, 0.07], color: C.woodDark, seg: 4 },
    { kind: 'cyl', pos: [0, 0.1, -0.24], rot: [-0.25, 0, 0], scale: [0.07, 0.24, 0.07], color: C.woodDark, seg: 4 },
    // 몸통(가죽 측면 + 상판)
    { kind: 'cyl', pos: [0, 0.2 + h / 2, 0], scale: [r, h, r], color: C.hideDark, seg: 8, hueJitter: 0.015 },
    { kind: 'cyl', pos: [0, 0.2 + h + 0.015, 0], scale: [r * 0.94, 0.04, r * 0.94], color: 0xe0c898, seg: 8 },
    // 북채 2개
    { kind: 'cyl', pos: [0.16, 0.2 + h + 0.22, 0.1], rot: [0, 0, -0.6], scale: [0.04, 0.4, 0.04], color: C.wood, seg: 4 },
    { kind: 'sphere', pos: [0.28, 0.2 + h + 0.36, 0.1], scale: 0.11, color: C.hide },
    { kind: 'cyl', pos: [-0.16, 0.2 + h + 0.22, -0.08], rot: [0, 0, 0.6], scale: [0.04, 0.4, 0.04], color: C.wood, seg: 4 },
    { kind: 'sphere', pos: [-0.28, 0.2 + h + 0.36, -0.08], scale: 0.11, color: C.hide },
  ];
  // 테두리 문양
  const marks = 3 + t;
  for (let i = 0; i < marks; i++) {
    const a = (i / marks) * Math.PI * 2;
    main.push({ kind: 'box', pos: [Math.cos(a) * r * 0.5, 0.2 + h * 0.5, Math.sin(a) * r * 0.5], rot: [0, -a, 0], scale: [0.03, h * 0.6, 0.1], color: C.banner });
  }
  if (t >= 1) main.push({ kind: 'cone', pos: [r * 0.5, 0.2 + h + 0.12, -r * 0.4], rot: [0.2, 0, -0.15], scale: [0.06, 0.24, 0.06], color: 0xe8e2d0, seg: 4 });
  if (big) {
    main.push(
      { kind: 'box', pos: [-r * 0.55, 0.6, r * 0.5], rot: [0, 0.5, 0], scale: [0.05, 1.1, 0.05], color: C.woodDark },
      { kind: 'box', pos: [-r * 0.55 + 0.14, 1.0, r * 0.5], rot: [0, 0.5, 0], scale: [0.32, 0.22, 0.02], color: t >= 4 ? C.gold : C.banner },
    );
  }
  return { main, glow: [] };
}

const BUILDERS: Record<TowerId, (t: number) => Parts> = {
  spear,
  catapult,
  lightning,
  brazier,
  frost,
  poison,
  ballista,
  drum,
};

/** 캐시된 타워 모델. tier = 0~4 */
export function buildTower(id: TowerId, tier: number): TowerModel {
  const t = Math.max(0, Math.min(4, Math.floor(tier)));
  const parts = BUILDERS[id](t);
  const main = cachedGeo(`tower:${id}:${t}:main`, () =>
    buildParts(parts.main, { seed: 1000 + t, ao: 0.14 }),
  );
  const glow =
    parts.glow.length > 0
      ? cachedGeo(`tower:${id}:${t}:glow`, () => buildParts(parts.glow, { seed: 2000 + t, ao: 0, faceJitter: 0.02 }))
      : null;
  return { main, glow };
}
