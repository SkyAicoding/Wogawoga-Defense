/**
 * 타워 8종 × 5티어 프로시저럴 모델 — 원시 공예감 로우폴리 + 드로우콜 최소 리그.
 *
 * ── 드로우콜 설계 (타워 1기 = 컬러 2 + 그림자 1 = 3콜) ──────────────────────
 *  1. 발광 장식(용암 균열/얼음 가시/포자)은 별도 glow 메시를 두지 않고 **밝은
 *     버텍스 컬러로 base에 병합**한다. 진짜 발광이 필요한 부위(불꽃, 크리스탈,
 *     얼음 첨탑, 식물 머리)만 action 슬롯에서 glowMat으로 그린다.
 *  2. 요 회전이 필요한 타워(spear/catapult/ballista)는 base를 head에 **병합**하고
 *     받침을 회전 대칭(원형 흙둔덕 + 돌 테두리)으로 만들어 회전이 보이지 않게 한다.
 *     → headPivotY = 0 이므로 head 로컬 좌표 = 루트 좌표.
 *  3. 그림자 캐스터는 타워당 정확히 1개(base 또는 head). action/장식은 그림자 미참여 —
 *     실루엣 그림자는 몸체 하나면 충분하고 그림자 패스 드로우콜이 절반이 된다.
 *
 * ── 좌표 규약 ──────────────────────────────────────────────────────────────
 * 방향성 무기(spear/catapult/poison/ballista)의 '전방'은 +X.
 * 뷰가 head 그룹을 yaw = atan2(-dz, dx) 로 돌려 타깃을 향하게 한다.
 *
 * ── 폴리 예산 ──────────────────────────────────────────────────────────────
 * T1 ≈ 700 / T5 ≈ 1500 삼각형. 각진 로우폴리 유지를 위해 seg는 4~8만 쓴다.
 * (프리미티브 삼각형 수: box 12 / ico 20 / sphere 80 / cyl 4·seg / cone 2·seg)
 */
import * as THREE from 'three';
import type { TowerId } from '@/data/types';
import { C, additiveMat } from '../palette';
import { buildParts, cachedGeo, type PartSpec } from './factory';

export interface TowerModel {
  /** 고정 하부 (flatMat) — head에 병합된 타워는 null */
  base: THREE.BufferGeometry | null;
  /** 요 회전부 (flatMat) — headPivotY 기준, 없으면 null */
  head: THREE.BufferGeometry | null;
  /** 발사 애니 파트 — head 아래 actionPivot 기준, 없으면 null */
  action: THREE.BufferGeometry | null;
  /** 발사 플래시 셸 (additiveMat, 평시 hidden) — action 지오메트리 재사용 */
  flash: THREE.BufferGeometry | null;
  /** action 파트 머티리얼 */
  actionMat: 'flat' | 'glow';
  /** head 그룹의 루트 로컬 회전 피벗 높이 */
  headPivotY: number;
  /** action 그룹의 head 로컬 피벗 */
  actionPivot: [number, number, number];
}

type V3 = [number, number, number];

interface Parts {
  base?: PartSpec[];
  head?: PartSpec[];
  action?: PartSpec[];
  actionMat?: 'flat' | 'glow';
  headPivotY?: number;
  actionPivot?: V3;
  /** true면 action 지오메트리를 additive 플래시 셸로도 사용 */
  flash?: boolean;
}

// ---------------------------------------------------------------------------
// 공예 디테일 헬퍼 (이 파일 소유 — factory.ts는 읽기 전용)
// ---------------------------------------------------------------------------

/** 구조용 밧줄 — 팔레트 C.rope(소품용)는 타워 표면에서 너무 튀어 한 톤 죽인 색을 쓴다 */
const ROPE = 0xa8823f;
const ROPE_D = 0x7a5c2c;

/** 원주 n등분 반복 — 회전 대칭 장식 배치의 기본기 */
function around(n: number, phase: number, fn: (a: number, i: number) => void): void {
  for (let i = 0; i < n; i++) fn((i / n) * Math.PI * 2 + phase, i);
}

/**
 * 지형에 앉는 흙 둔덕 + 돌 테두리. 회전 대칭이라 head에 병합돼 돌아가도 티가 안 난다.
 * tris = 32 + n·20
 */
function groundRim(
  out: PartSpec[],
  r: number,
  n: number,
  dirt: number,
  stoneA: number,
  stoneB: number,
  y = 0,
): void {
  out.push({
    kind: 'cyl',
    pos: [0, y + 0.05, 0],
    scale: [r * 1.94, 0.1, r * 1.94],
    color: dirt,
    seg: 8,
    hueJitter: 0.03,
  });
  around(n, 0.4, (a, i) => {
    const s = 0.155 + (i % 3) * 0.032;
    out.push({
      kind: 'ico',
      pos: [Math.cos(a) * r, y + 0.05 + (i % 2) * 0.014, Math.sin(a) * r],
      rot: [i * 1.13, i * 0.71, i * 0.37],
      scale: [s * 1.25, s * 0.86, s * 1.25],
      color: i % 2 === 0 ? stoneA : stoneB,
      hueJitter: 0.022,
    });
  });
}

/** 통나무 기둥 — 몸통 + 어두운 결 밴드 2줄. tris = 20 + 40 */
function logPost(
  out: PartSpec[],
  x: number,
  z: number,
  y0: number,
  h: number,
  r: number,
  color: number,
  dark: number,
  lean = 0,
): void {
  const a = Math.atan2(z, x);
  const rot: V3 = [Math.sin(a) * lean, 0, -Math.cos(a) * lean];
  out.push({ kind: 'cyl', pos: [x, y0 + h / 2, z], rot, scale: [r * 2, h, r * 2], color, hueJitter: 0.025, seg: 5 });
  out.push({ kind: 'cyl', pos: [x, y0 + h * 0.24, z], rot, scale: [r * 2.2, h * 0.08, r * 2.2], color: dark, seg: 5 });
  out.push({ kind: 'cyl', pos: [x, y0 + h * 0.71, z], rot, scale: [r * 2.15, h * 0.07, r * 2.15], color: dark, seg: 5 });
}

/** 밧줄 감김 — 축 둘레 접선 박스 링 (살짝 나선). tris = n·12 */
function ropeRing(
  out: PartSpec[],
  cx: number,
  cy: number,
  cz: number,
  r: number,
  n: number,
  thick: number,
  color: number,
): void {
  const arc = ((Math.PI * 2 * r) / n) * 1.3;
  around(n, 0.2, (a, i) => {
    out.push({
      kind: 'box',
      pos: [cx + Math.cos(a) * r, cy + (i / n - 0.5) * thick * 1.1, cz + Math.sin(a) * r],
      rot: [0, -a, 0],
      scale: [thick, thick, arc],
      color,
      hueJitter: 0.03,
    });
  });
}

/** 널판 결 — 원형 상면에 파인 홈. tris = n·12 */
function plankGrain(out: PartSpec[], y: number, r: number, n: number, color: number): void {
  for (let i = 0; i < n; i++) {
    const u = ((i + 0.5) / n - 0.5) * 2 * r;
    const half = Math.sqrt(Math.max(r * r - u * u, 0.004));
    out.push({ kind: 'box', pos: [0, y, u], scale: [half * 1.94, 0.024, 0.03], color });
  }
}

/** 가죽 봉제선 — 원통 옆면 세로 이음매 돌기. tris = n·12 */
function hideSeams(out: PartSpec[], y: number, h: number, r: number, n: number, color: number): void {
  around(n, 0.35, (a) => {
    out.push({
      kind: 'box',
      pos: [Math.cos(a) * r, y, Math.sin(a) * r],
      rot: [0, -a, 0],
      scale: [0.055, h, 0.042],
      color,
      hueJitter: 0.02,
    });
  });
}

/** 매달린 뼈/이빨 장식 — 끈 + 이빨. tris = 12 + 2·seg */
function boneCharm(out: PartSpec[], x: number, y: number, z: number, s: number, tilt = 0): void {
  out.push(
    { kind: 'box', pos: [x, y + s * 0.9, z], scale: [0.02, s * 0.8, 0.02], color: ROPE_D },
    { kind: 'cone', pos: [x, y, z], rot: [tilt, 0, Math.PI], scale: [s * 0.5, s * 1.2, s * 0.5], color: C.bone, seg: 4 },
  );
}

/** 벽에 새긴 문양 띠 — 접선 방향 짧은 박스 두 줄. tris = n·24 */
function carvedBand(out: PartSpec[], y: number, r: number, n: number, h: number, color: number): void {
  around(n, 0.15, (a, i) => {
    out.push(
      { kind: 'box', pos: [Math.cos(a) * r, y, Math.sin(a) * r], rot: [0, -a, 0], scale: [0.05, h, 0.07], color },
      {
        kind: 'box',
        pos: [Math.cos(a) * r, y + h * (i % 2 === 0 ? 0.85 : -0.85), Math.sin(a) * r],
        rot: [0, -a, 0],
        scale: [0.045, h * 0.6, 0.05],
        color,
      },
    );
  });
}

// ---------------------------------------------------------------------------
// 빌더 — 파트 좌표는 각 슬롯의 피벗 로컬 기준
// ---------------------------------------------------------------------------

/**
 * 창 망루. base를 head에 병합(회전 대칭 받침) → 컬러 2콜.
 * t3부터 통나무 망루로 올라간다.
 */
function spear(t: number): Parts {
  const head: PartSpec[] = [];
  const raised = t >= 2;
  const deck = raised ? 0.5 + (t - 2) * 0.14 : 0;

  groundRim(head, 0.62, 6 + t, C.bark, C.stone, C.stoneDark);

  if (raised) {
    // 통나무 다리 6개 + 밧줄 결속 + 대각 버팀목
    around(6, 0.26, (a) => {
      logPost(head, Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0.06, deck - 0.02, 0.052, C.woodDark, C.bark, 0.1);
    });
    ropeRing(head, 0, deck * 0.42, 0, 0.38, 7, 0.042, ROPE);
    around(3, 0.9, (a) => {
      // 다리 사이 대각 버팀목
      head.push({
        kind: 'box',
        pos: [Math.cos(a) * 0.19, deck * 0.55, Math.sin(a) * 0.19],
        rot: [0, -a, 0.62],
        scale: [0.045, deck * 0.92, 0.05],
        color: C.bark,
      });
    });
    // 데크 + 널판 결
    head.push({
      kind: 'cyl',
      pos: [0, deck + 0.05, 0],
      scale: [1.0, 0.1, 1.0],
      color: C.wood,
      seg: 8,
      hueJitter: 0.018,
    });
    plankGrain(head, deck + 0.101, 0.44, 3 + t, C.woodDark);
    // 난간 기둥 + 밧줄 손잡이
    around(6, 0.52, (a) => {
      head.push({
        kind: 'cyl',
        pos: [Math.cos(a) * 0.44, deck + 0.24, Math.sin(a) * 0.44],
        scale: [0.06, 0.28, 0.06],
        color: C.woodDark,
        seg: 4,
      });
    });
    ropeRing(head, 0, deck + 0.35, 0, 0.45, 8, 0.036, ROPE);
  }

  // 가죽 초소 — 봉제선 + 하단 밧줄 띠 + 입구 (데크보다 좁아야 난간이 읽힌다)
  const hutY = deck + (raised ? 0.1 : 0.09);
  const hutR = 0.4;
  head.push({
    kind: 'cyl',
    pos: [0, hutY + 0.19, 0],
    scale: [hutR * 2, 0.38, hutR * 2],
    color: C.hide,
    seg: 8,
    hueJitter: 0.025,
  });
  hideSeams(head, hutY + 0.19, 0.36, hutR * 0.99, 5, C.hideDark);
  ropeRing(head, 0, hutY + 0.05, 0, hutR * 1.04, 7, 0.032, ROPE_D);
  head.push({ kind: 'box', pos: [hutR * 0.94, hutY + 0.15, 0], scale: [0.07, 0.25, 0.22], color: C.black });

  // 이엉 지붕 — 3단 원뿔 + 처마에 삐져나온 짚단
  const roofY = hutY + 0.38;
  const rr = 0.66 + t * 0.02;
  head.push(
    { kind: 'cone', pos: [0, roofY + 0.03, 0], scale: [rr, 0.18, rr], color: C.straw, seg: 8, hueJitter: 0.035 },
    {
      kind: 'cone',
      pos: [0, roofY + 0.17, 0],
      scale: [rr * 0.76, 0.24, rr * 0.76],
      color: 0xc9a355,
      seg: 8,
      hueJitter: 0.035,
    },
    {
      kind: 'cone',
      pos: [0, roofY + 0.32, 0],
      scale: [rr * 0.42, 0.22, rr * 0.42],
      color: C.straw,
      seg: 7,
      hueJitter: 0.03,
    },
  );
  // 처마 짚단 — 지붕 경사에 눕혀 붙인 다발
  around(7, 0.28, (a) => {
    head.push({
      kind: 'box',
      pos: [Math.cos(a) * rr * 0.42, roofY + 0.02, Math.sin(a) * rr * 0.42],
      rot: [0, -a, 1.15],
      scale: [0.07, 0.26, 0.11],
      color: 0xc9a355,
      hueJitter: 0.03,
    });
  });
  around(5, 0.8, (a) => {
    head.push({
      kind: 'box',
      pos: [Math.cos(a) * rr * 0.3, roofY + 0.18, Math.sin(a) * rr * 0.3],
      rot: [0, -a, 1.05],
      scale: [0.06, 0.22, 0.1],
      color: C.straw,
      hueJitter: 0.03,
    });
  });
  // 용마루 밧줄 결속
  ropeRing(head, 0, roofY + 0.4, 0, 0.12, 5, 0.038, ROPE_D);

  // 꽂힌 창 (티어마다 +1) — 자루/촉/밧줄 결속
  const n = 1 + t;
  around(n, 0.5, (a) => {
    const x = Math.cos(a) * 0.34;
    const z = Math.sin(a) * 0.34;
    const rot: V3 = [Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2];
    head.push(
      { kind: 'cyl', pos: [x, roofY + 0.12, z], rot, scale: [0.048, 0.84, 0.048], color: C.wood, seg: 5 },
      {
        kind: 'cone',
        pos: [x * 1.2, roofY + 0.58, z * 1.2],
        rot,
        scale: [0.1, 0.24, 0.1],
        color: C.stone,
        seg: 5,
      },
      { kind: 'box', pos: [x * 1.1, roofY + 0.44, z * 1.1], rot, scale: [0.08, 0.05, 0.08], color: ROPE },
    );
  });
  if (t >= 3) {
    boneCharm(head, 0.26, hutY + 0.2, 0.26, 0.11);
    boneCharm(head, -0.28, hutY + 0.24, 0.18, 0.09, 0.3);
  }
  if (t >= 4) {
    head.push(
      { kind: 'cyl', pos: [0, roofY + 0.66, 0], scale: [0.05, 0.56, 0.05], color: C.woodDark, seg: 4 },
      { kind: 'box', pos: [0.16, roofY + 0.85, 0], rot: [0, 0.35, 0], scale: [0.34, 0.22, 0.02], color: C.banner },
      { kind: 'box', pos: [0.16, roofY + 0.7, 0], rot: [0, 0.35, 0], scale: [0.26, 0.08, 0.02], color: C.gold },
    );
  }

  // 액션: 전방 투창 — 발사 시 앞으로 찌른 뒤 복귀
  const action: PartSpec[] = [
    { kind: 'cyl', pos: [0.05, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.05, 0.74, 0.05], color: C.wood, seg: 5 },
    { kind: 'cone', pos: [0.47, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.11, 0.22, 0.11], color: C.stone, seg: 5 },
    { kind: 'box', pos: [0.33, 0, 0], scale: [0.05, 0.075, 0.075], color: ROPE },
    { kind: 'box', pos: [0.27, 0, 0], scale: [0.04, 0.068, 0.068], color: ROPE },
    { kind: 'box', pos: [-0.23, 0, 0], scale: [0.15, 0.075, 0.02], color: C.banner },
    { kind: 'box', pos: [-0.23, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.15, 0.075, 0.02], color: C.banner },
    { kind: 'ico', pos: [-0.33, 0, 0], scale: 0.07, color: C.bone },
  ];
  return { head, action, headPivotY: 0, actionPivot: [0.32, hutY + 0.22, 0] };
}

/** 매머드 투석기. base를 head에 병합 → 원형 회전판 위에서 통째로 조준. */
function catapult(t: number): Parts {
  const boneAge = t >= 3; // 매머드뼈 프레임
  const frame = boneAge ? C.bone : C.wood;
  const frameDark = boneAge ? C.boneDark : C.woodDark;
  const s = 1 + t * 0.06;
  const head: PartSpec[] = [];

  groundRim(head, 0.64, 6 + t, C.bark, C.stone, C.stoneDark);

  // 회전판 + 널판 + 테두리 밧줄
  const deckY = 0.14;
  head.push({
    kind: 'cyl',
    pos: [0, deckY, 0],
    scale: [1.06 * s, 0.11, 1.06 * s],
    color: C.woodDark,
    seg: 8,
    hueJitter: 0.02,
  });
  plankGrain(head, deckY + 0.056, 0.46 * s, 3 + t, C.bark);
  ropeRing(head, 0, deckY + 0.01, 0, 0.5 * s, 9, 0.04, ROPE);

  // A 프레임 (앞뒤 기둥 + 마루대) + 축
  const axleY = deckY + 0.42 * s;
  for (const sz of [1, -1] as const) {
    head.push(
      {
        kind: 'box',
        pos: [0, deckY + 0.22 * s, sz * 0.26 * s],
        rot: [sz * 0.46, 0, 0],
        scale: [0.11, 0.58 * s, 0.11],
        color: frame,
        hueJitter: 0.02,
      },
      {
        kind: 'box',
        pos: [0, deckY + 0.06, sz * 0.36 * s],
        rot: [sz * 0.46, 0, 0],
        scale: [0.15, 0.12, 0.14],
        color: frameDark,
      },
    );
  }
  head.push({
    kind: 'cyl',
    pos: [0, axleY, 0],
    rot: [Math.PI / 2, 0, 0],
    scale: [0.08, 0.66 * s, 0.08],
    color: frameDark,
    seg: 6,
  });
  for (const sz of [1, -1] as const) {
    head.push({
      kind: 'cyl',
      pos: [0, axleY, sz * 0.3 * s],
      rot: [Math.PI / 2, 0, 0],
      scale: [0.14, 0.07, 0.14],
      color: frame,
      seg: 5,
    });
  }
  ropeRing(head, 0, axleY - 0.02, 0, 0.13, 6, 0.038, ROPE);

  // 카운터웨이트 돌 + 그물
  head.push(
    { kind: 'ico', pos: [0.32 * s, axleY - 0.06, 0], rot: [0.4, 0.7, 0.2], scale: 0.27 * s, color: C.stoneDark },
    { kind: 'ico', pos: [0.4 * s, axleY - 0.16, 0.1], rot: [1.1, 0.2, 0.5], scale: 0.15, color: C.stone },
  );
  around(4, 0.4, (a) => {
    head.push({
      kind: 'box',
      pos: [0.32 * s + Math.cos(a) * 0.14, axleY - 0.04, Math.sin(a) * 0.14],
      rot: [0, -a, 0.3],
      scale: [0.03, 0.3, 0.03],
      color: ROPE,
    });
  });

  // 권양기(윈치) + 장전 밧줄
  head.push(
    {
      kind: 'cyl',
      pos: [-0.42 * s, deckY + 0.14, 0],
      rot: [Math.PI / 2, 0, 0],
      scale: [0.17, 0.42, 0.17],
      color: C.bark,
      seg: 6,
    },
    { kind: 'box', pos: [-0.42 * s, deckY + 0.14, 0.26], rot: [0, 0, 0.5], scale: [0.05, 0.22, 0.05], color: C.wood },
  );
  ropeRing(head, -0.42 * s, deckY + 0.14, 0, 0.1, 5, 0.045, ROPE);

  // 탄약 돌무더기
  const ammo = 2 + Math.min(t, 3);
  around(ammo, 1.1, (a, i) => {
    head.push({
      kind: 'ico',
      pos: [-0.24 * s + Math.cos(a) * 0.18, deckY + 0.13 + (i % 2) * 0.1, 0.36 * s + Math.sin(a) * 0.12],
      rot: [i * 1.3, i * 0.9, i * 0.5],
      scale: 0.13 + (i % 2) * 0.03,
      color: C.stone,
      hueJitter: 0.02,
    });
  });

  if (boneAge) {
    // 매머드 상아 버팀 + 두개골 장식
    for (const sz of [1, -1] as const) {
      head.push(
        {
          kind: 'cyl',
          pos: [0.3 * s, deckY + 0.34, sz * 0.34 * s],
          rot: [0, 0, -0.85],
          scale: [0.08, 0.72, 0.08],
          color: C.bone,
          seg: 5,
        },
        {
          kind: 'cone',
          pos: [0.56 * s, deckY + 0.58, sz * 0.34 * s],
          rot: [0, 0, -0.85],
          scale: [0.09, 0.24, 0.09],
          color: C.boneDark,
          seg: 5,
        },
      );
    }
  }
  if (t >= 4) {
    head.push(
      { kind: 'sphere', pos: [-0.5 * s, deckY + 0.2, -0.32], scale: 0.28, color: C.bone },
      { kind: 'box', pos: [-0.58 * s, deckY + 0.12, -0.32], scale: [0.16, 0.09, 0.2], color: C.boneDark },
    );
    boneCharm(head, 0.5 * s, deckY + 0.3, 0.4, 0.12);
  }

  // 액션: 투척 암 + 밧줄 결속 + 바가지 + 장전된 돌
  const action: PartSpec[] = [
    { kind: 'box', pos: [-0.16 * s, 0.09 * s, 0], rot: [0, 0, -0.7], scale: [0.86 * s, 0.1, 0.13], color: frame },
    { kind: 'box', pos: [-0.16 * s, 0.09 * s, 0], rot: [0, 0, -0.7], scale: [0.5 * s, 0.13, 0.09], color: frameDark },
    { kind: 'box', pos: [0.2 * s, -0.19 * s, 0], rot: [0, 0, -0.7], scale: [0.12, 0.15, 0.16], color: ROPE },
    { kind: 'cyl', pos: [-0.47 * s, 0.39 * s, 0], scale: [0.3 * s, 0.11, 0.3 * s], color: C.bark, seg: 7 },
    { kind: 'ico', pos: [-0.47 * s, 0.5 * s, 0], rot: [0.5, 0.3, 0.2], scale: 0.25 * s, color: C.stone, hueJitter: 0.03 },
    { kind: 'ico', pos: [-0.36 * s, 0.46 * s, 0.1], rot: [1.2, 0.6, 0.9], scale: 0.11, color: C.stoneDark },
  ];
  ropeRing(action, -0.47 * s, 0.44 * s, 0, 0.16 * s, 6, 0.04, ROPE);
  around(3, 0.6, (a) => {
    action.push({
      kind: 'box',
      pos: [-0.47 * s + Math.cos(a) * 0.12, 0.3 * s, Math.sin(a) * 0.12],
      rot: [0, -a, 0.25],
      scale: [0.03, 0.24, 0.03],
      color: ROPE,
    });
  });

  return { head, action, headPivotY: 0, actionPivot: [0, axleY, 0] };
}

/** 번개 토템 — 발광 크리스탈만 glow, 나머지 전부 base 병합. */
function lightning(t: number): Parts {
  const base: PartSpec[] = [];
  groundRim(base, 0.5, 6 + t, 0x4a3a30, C.stoneDark, C.stone);

  // 쌓아 올린 토템 단 — 통나무/뼈 교차, 티어마다 한 단 추가
  const segs = 3 + Math.min(t, 2);
  let y = 0.1;
  for (let i = 0; i < segs; i++) {
    const h = 0.29 - i * 0.025;
    const r = 0.32 - i * 0.038;
    const wood = i % 2 === 0;
    base.push({
      kind: 'cyl',
      pos: [0, y + h / 2, 0],
      scale: [r * 2, h, r * 2],
      color: wood ? C.wood : C.boneDark,
      seg: 7,
      hueJitter: 0.02,
    });
    if (wood) carvedBand(base, y + h * 0.5, r * 1.01, 5, h * 0.24, C.bark);
    else ropeRing(base, 0, y + h * 0.5, 0, r * 1.05, 6, 0.036, ROPE);
    base.push({
      kind: 'cyl',
      pos: [0, y + h + 0.012, 0],
      scale: [r * 2.28, 0.045, r * 2.28],
      color: wood ? C.bark : C.bone,
      seg: 7,
    });
    y += h + 0.03;
  }

  // 해골 + 깃털 장식
  base.push({ kind: 'sphere', pos: [0.24, y - 0.36, 0.14], scale: 0.18, color: C.bone });
  base.push({ kind: 'box', pos: [0.3, y - 0.43, 0.17], scale: [0.1, 0.07, 0.12], color: C.boneDark });
  if (t >= 1) {
    base.push({ kind: 'sphere', pos: [-0.23, y - 0.22, -0.16], scale: 0.15, color: C.bone });
    base.push({ kind: 'box', pos: [-0.28, y - 0.28, -0.19], scale: [0.09, 0.06, 0.1], color: C.boneDark });
  }
  around(2 + Math.min(t, 3), 0.7, (a, i) => {
    boneCharm(base, Math.cos(a) * 0.34, y - 0.5 + (i % 2) * 0.08, Math.sin(a) * 0.34, 0.1, i * 0.3);
  });

  // 상단 뿔 받침 + 돌 발톱
  base.push({ kind: 'cone', pos: [0, y + 0.06, 0], scale: [0.26, 0.14, 0.26], color: C.black, seg: 7 });
  around(3 + Math.min(t, 2), 0.3, (a) => {
    base.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.16, y + 0.14, Math.sin(a) * 0.16],
      rot: [Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55],
      scale: [0.07, 0.28, 0.07],
      color: C.boneDark,
      seg: 4,
    });
  });
  // 발광 균열 (base 병합 — 밝은 버텍스 컬러)
  around(4, 0.9, (a) => {
    base.push({
      kind: 'box',
      pos: [Math.cos(a) * 0.24, y - 0.2, Math.sin(a) * 0.24],
      rot: [0, -a, 0.35],
      scale: [0.035, 0.3, 0.05],
      color: 0x8fe6ff,
    });
  });

  // 액션(발광): 정상 크리스탈 — 펄스 + 진동 + 애디티브 플래시
  const cs = 0.2 + t * 0.045;
  const yc = y + 0.16 + cs * 0.95;
  const action: PartSpec[] = [
    { kind: 'ico', pos: [0, -cs * 0.35, 0], rot: [0.3, 0.5, 0.2], scale: [cs * 1.15, cs * 1.3, cs * 1.15], color: C.crystal },
    { kind: 'ico', pos: [0, cs * 0.6, 0], rot: [0.1, 1.1, 0.3], scale: [cs * 0.8, cs * 1.5, cs * 0.8], color: 0x9af2ff },
    { kind: 'cone', pos: [0, cs * 1.5, 0], rot: [0.05, 0.4, 0.06], scale: [cs * 0.7, cs * 0.9, cs * 0.7], color: 0xd2faff, seg: 5 },
  ];
  // 본체에 물린 파편 결정 (띄우면 분리돼 보인다)
  around(2 + Math.min(t, 3), 0.4, (a, i) => {
    action.push({
      kind: 'ico',
      pos: [Math.cos(a) * cs * (0.62 + (i % 2) * 0.16), -cs * 0.5 + (i % 3) * cs * 0.5, Math.sin(a) * cs * (0.62 + (i % 2) * 0.16)],
      rot: [i * 0.9, i * 1.3, i * 0.4],
      scale: [cs * 0.34, cs * (0.7 + (i % 2) * 0.3), cs * 0.34],
      color: i % 2 === 0 ? 0x9af2ff : C.crystal,
    });
  });
  if (t >= 3) {
    action.push({ kind: 'ico', pos: [0.05, cs * 2.1, -0.02], scale: 0.11, color: 0xd2faff });
  }
  return { base, action, actionMat: 'glow', actionPivot: [0, yc, 0], flash: true };
}

/**
 * 화산석 화로 — 통나무 삼각대 위에 올린 돌 사발.
 * 용암 균열은 base에 밝은 컬러로 병합, 불꽃만 glow.
 */
function brazier(t: number): Parts {
  const volcanic = t >= 3; // 화산석 화로
  const stoneA = volcanic ? 0x7d5a50 : C.stone;
  const stoneB = volcanic ? 0x54403a : C.stoneDark;
  const r = 0.38 + t * 0.022;
  const base: PartSpec[] = [];

  groundRim(base, 0.6, 6 + t, volcanic ? 0x4a3a34 : C.bark, stoneA, stoneB);

  // 삼각대 다리 — 사발을 지면에서 띄워 실루엣을 세운다
  const bowlY = 0.44 + t * 0.02;
  around(3, 0.5, (a) => {
    logPost(base, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.06, bowlY - 0.06, 0.06, C.woodDark, C.bark, 0.32);
  });
  ropeRing(base, 0, bowlY * 0.52, 0, 0.3, 7, 0.04, ROPE_D);

  // 돌 사발 — 아래로 좁아지는 두 단 + 벌어진 테두리
  base.push(
    { kind: 'cyl', pos: [0, bowlY - 0.02, 0], scale: [r * 1.3, 0.14, r * 1.3], color: stoneB, seg: 8, hueJitter: 0.025 },
    { kind: 'cyl', pos: [0, bowlY + 0.12, 0], scale: [r * 1.85, 0.16, r * 1.85], color: stoneA, seg: 8, hueJitter: 0.03 },
  );
  // 테두리 돌쌓기
  around(7 + Math.min(t, 2), 0.25, (a, i) => {
    const s = 0.16 + (i % 3) * 0.03;
    base.push({
      kind: 'ico',
      pos: [Math.cos(a) * r * 0.92, bowlY + 0.21, Math.sin(a) * r * 0.92],
      rot: [i * 1.2, i * 0.8, i * 0.4],
      scale: [s * 1.2, s * 0.95, s * 1.2],
      color: i % 2 === 0 ? stoneA : stoneB,
      hueJitter: 0.025,
    });
  });
  // 사발 안쪽 재/숯
  base.push({ kind: 'cyl', pos: [0, bowlY + 0.19, 0], scale: [r * 1.5, 0.05, r * 1.5], color: 0x3a2e2b, seg: 8 });
  around(4, 0.6, (a, i) => {
    base.push({
      kind: 'ico',
      pos: [Math.cos(a) * r * 0.4, bowlY + 0.22, Math.sin(a) * r * 0.4],
      rot: [i * 1.5, i, i * 0.6],
      scale: 0.1 + (i % 2) * 0.03,
      color: 0x2a2320,
    });
  });
  // 장작
  base.push(
    { kind: 'cyl', pos: [0, bowlY + 0.26, 0], rot: [0, 0.4, 1.35], scale: [0.09, 0.5, 0.09], color: C.bark, seg: 5 },
    { kind: 'cyl', pos: [0, bowlY + 0.29, 0], rot: [1.35, 1.2, 0], scale: [0.085, 0.48, 0.085], color: 0x5a3c1e, seg: 5 },
    { kind: 'cyl', pos: [0.04, bowlY + 0.32, -0.04], rot: [0.4, 2.2, 1.2], scale: [0.075, 0.4, 0.075], color: C.woodDark, seg: 5 },
  );
  // 용암 균열 (병합 발광 — 밝은 컬러, 사발 옆면)
  around(4 + Math.min(t, 3), 0.35, (a, i) => {
    base.push({
      kind: 'box',
      pos: [Math.cos(a) * r * 0.9, bowlY + 0.11, Math.sin(a) * r * 0.9],
      rot: [0, -a, 0.18 + (i % 2) * 0.22],
      scale: [0.05, 0.17, 0.06],
      color: volcanic ? 0xff9a3a : 0xffb45a,
    });
  });
  if (volcanic) {
    around(3, 1.2, (a) => {
      base.push({
        kind: 'box',
        pos: [Math.cos(a) * r * 0.66, bowlY + 0.215, Math.sin(a) * r * 0.66],
        rot: [0, -a, 0],
        scale: [0.15, 0.04, 0.05],
        color: 0xff7626,
      });
    });
  }
  // 뼈 토템 기둥 + 매단 장식 (티어 성장)
  if (t >= 2) {
    for (const sx of [1, -1] as const) {
      base.push(
        { kind: 'cyl', pos: [sx * 0.56, 0.4, -0.16], scale: [0.09, 0.78, 0.09], color: C.bark, seg: 5, hueJitter: 0.02 },
        { kind: 'cyl', pos: [sx * 0.56, 0.62, -0.16], scale: [0.11, 0.05, 0.11], color: C.woodDark, seg: 5 },
        { kind: 'sphere', pos: [sx * 0.56, 0.86, -0.16], scale: 0.2, color: C.bone },
        { kind: 'box', pos: [sx * 0.56, 0.79, -0.24], scale: [0.11, 0.07, 0.1], color: C.boneDark },
      );
      boneCharm(base, sx * 0.56, 0.5, -0.06, 0.11);
    }
  }
  if (t >= 4) {
    // 사발 테두리에서 솟은 흑요석 가시
    around(5, 0.9, (a, i) => {
      base.push({
        kind: 'cone',
        pos: [Math.cos(a) * r * 0.86, bowlY + 0.3, Math.sin(a) * r * 0.86],
        rot: [Math.sin(a) * 0.36, 0, -Math.cos(a) * 0.36],
        scale: [0.1, 0.3 + (i % 2) * 0.1, 0.1],
        color: 0x241a1c,
        seg: 4,
      });
    });
  }

  // 액션(발광): 화염 — 오라 틱마다 플레어, 상시 플리커
  const fs = 0.72 + t * 0.11;
  const action: PartSpec[] = [
    { kind: 'cone', pos: [0, 0.3 * fs, 0], scale: [0.46 * fs, 0.66 * fs, 0.46 * fs], color: C.fire, seg: 7 },
    { kind: 'cone', pos: [0.02, 0.24 * fs, 0.02], scale: [0.3 * fs, 0.5 * fs, 0.3 * fs], color: 0xffd24a, seg: 6 },
    { kind: 'cone', pos: [0, 0.16 * fs, 0], scale: [0.18 * fs, 0.3 * fs, 0.18 * fs], color: 0xfff2b0, seg: 5 },
  ];
  around(3 + Math.min(t, 2), 0.4, (a, i) => {
    action.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.19 * fs, (0.24 + (i % 3) * 0.12) * fs, Math.sin(a) * 0.19 * fs],
      rot: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4],
      scale: [0.12 * fs, (0.3 + (i % 2) * 0.14) * fs, 0.12 * fs],
      color: i % 2 === 0 ? C.ember : C.fire,
      seg: 4,
    });
  });
  return { base, action, actionMat: 'glow', actionPivot: [0, bowlY + 0.2, 0] };
}

/** 서리 제단 — 얼음 가시는 base에 밝은 컬러로 병합, 중앙 첨탑만 glow 회전. */
function frost(t: number): Parts {
  const base: PartSpec[] = [];
  groundRim(base, 0.6, 6 + t, 0x9db4c8, C.stone, C.stoneDark);

  // 눈 둔덕 + 계단식 얼음 제단
  base.push(
    { kind: 'cyl', pos: [0, 0.13, 0], scale: [1.06, 0.12, 1.06], color: C.snowCap, seg: 8, hueJitter: 0.012 },
    { kind: 'cyl', pos: [0, 0.22, 0], scale: [0.78, 0.1, 0.78], color: 0xdceef8, seg: 8, hueJitter: 0.015 },
  );
  // 룬 문양 (제단 상면)
  around(4 + Math.min(t, 2), 0.3, (a) => {
    base.push({
      kind: 'box',
      pos: [Math.cos(a) * 0.3, 0.272, Math.sin(a) * 0.3],
      rot: [0, -a, 0],
      scale: [0.16, 0.02, 0.045],
      color: 0x8fcfe8,
    });
  });
  // 제단 둘레의 선돌 — 눈 모자를 씌워 밝게, 제단에 붙여 실루엣을 만든다
  around(4 + Math.min(t, 2), 0.78, (a, i) => {
    const px = Math.cos(a) * 0.52;
    const pz = Math.sin(a) * 0.52;
    const ph = 0.26 + (i % 2) * 0.12;
    base.push(
      {
        kind: 'cyl',
        pos: [px, 0.13 + ph / 2, pz],
        rot: [Math.sin(a) * 0.1, -a, -Math.cos(a) * 0.1],
        scale: [0.19, ph, 0.15],
        color: C.stone,
        seg: 5,
        hueJitter: 0.025,
      },
      {
        kind: 'cyl',
        pos: [px, 0.15 + ph, pz],
        scale: [0.21, 0.06, 0.17],
        color: C.snowCap,
        seg: 5,
      },
      {
        kind: 'box',
        pos: [px * 1.06, 0.13 + ph * 0.55, pz * 1.06],
        rot: [0, -a, 0],
        scale: [0.04, ph * 0.5, 0.06],
        color: 0x8fcfe8,
      },
    );
  });
  // 얼음 가시 링 (병합 발광 — 밝은 얼음색)
  const n = 3 + t;
  around(n, 0.8, (a, i) => {
    const rr = 0.42 + (i % 2) * 0.1;
    base.push(
      {
        kind: 'cone',
        pos: [Math.cos(a) * rr, 0.3, Math.sin(a) * rr],
        rot: [Math.sin(a) * 0.42, 0, -Math.cos(a) * 0.42],
        scale: [0.15, 0.4 + (i % 3) * 0.12, 0.15],
        color: 0xbcefff,
        seg: 5,
      },
      {
        kind: 'cone',
        pos: [Math.cos(a) * (rr + 0.12), 0.22, Math.sin(a) * (rr + 0.12)],
        rot: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6],
        scale: [0.09, 0.24, 0.09],
        color: C.ice,
        seg: 4,
      },
    );
  });
  // 제단 바깥에 낀 성에 덩어리
  around(4 + Math.min(t, 3), 0.2, (a, i) => {
    base.push({
      kind: 'ico',
      pos: [Math.cos(a) * 0.78, 0.11, Math.sin(a) * 0.78],
      rot: [i * 1.4, i * 0.9, i * 0.6],
      scale: [0.19, 0.13, 0.19],
      color: i % 2 === 0 ? 0xd6f6ff : C.snowCap,
      hueJitter: 0.015,
    });
  });
  // 제단 상단 서릿발
  if (t >= 2) {
    around(5, 0.45, (a, i) => {
      base.push({
        kind: 'cone',
        pos: [Math.cos(a) * 0.2, 0.29, Math.sin(a) * 0.2],
        rot: [Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22],
        scale: [0.07, 0.2 + (i % 3) * 0.08, 0.07],
        color: 0xd6f6ff,
        seg: 4,
      });
    });
  }
  if (t >= 4) {
    // 떠 있는 서리 결정 대신 선돌 위에 얹힌 얼음 왕관
    around(4, 0.15, (a, i) => {
      base.push({
        kind: 'ico',
        pos: [Math.cos(a) * 0.52, 0.52 + (i % 2) * 0.08, Math.sin(a) * 0.52],
        rot: [i * 1.1, i * 0.8, i * 0.5],
        scale: [0.12, 0.17, 0.12],
        color: 0xe2faff,
      });
    });
  }

  // 액션(발광): 중앙 빙하 첨탑 — 발사 시 회전 가속 + 펄스
  const h = 0.62 + t * 0.16;
  const rw = 0.34 + t * 0.02;
  const action: PartSpec[] = [
    { kind: 'cone', pos: [0, h * 0.5, 0], rot: [0.05, 0, 0.03], scale: [rw, h, rw], color: C.iceDeep, seg: 6 },
    { kind: 'cone', pos: [0, h * 0.28, 0], rot: [0.05, 0.5, 0.03], scale: [rw * 1.18, h * 0.5, rw * 1.18], color: 0x7fd8f6, seg: 6 },
  ];
  around(3 + Math.min(t, 2), 0.55, (a, i) => {
    action.push({
      kind: 'cone',
      pos: [Math.cos(a) * rw * 0.72, h * (0.18 + (i % 2) * 0.14), Math.sin(a) * rw * 0.72],
      rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5],
      scale: [0.1, h * (0.34 + (i % 3) * 0.1), 0.1],
      color: i % 2 === 0 ? C.ice : 0x8fe0f8,
      seg: 4,
    });
  });
  // 첨탑에 박힌 결정 (띄우지 않고 본체에 물린다)
  if (t >= 2) action.push({ kind: 'ico', pos: [0.01, h * 0.82, 0], rot: [0.4, 0.6, 0.2], scale: 0.15, color: 0xe2faff });
  if (t >= 3) action.push({ kind: 'ico', pos: [-0.06, h * 0.6, 0.05], rot: [1.1, 0.2, 0.7], scale: 0.11, color: 0xf2ffff });
  return { base, action, actionMat: 'glow', actionPivot: [0, 0.3, 0] };
}

/** 독 식충화 — 포자는 base 병합, 식물 머리만 glow(헤드 스쿼시 대상). */
function poison(t: number): Parts {
  const base: PartSpec[] = [];
  groundRim(base, 0.58, 6 + t, 0x4a3a22, 0x6f7a4a, 0x55613a);

  // 이끼 둔덕 + 뿌리
  base.push({ kind: 'cyl', pos: [0, 0.14, 0], scale: [0.94, 0.12, 0.94], color: 0x4a6a2a, seg: 8, hueJitter: 0.03 });
  around(5, 0.25, (a) => {
    base.push({
      kind: 'box',
      pos: [Math.cos(a) * 0.36, 0.13, Math.sin(a) * 0.36],
      rot: [0, -a, 0.25],
      scale: [0.07, 0.36, 0.09],
      color: 0x3c5a22,
    });
  });
  // 가시덩굴
  const n = 4 + t;
  around(n, 0.3, (a, i) => {
    const rr = 0.34 + (i % 2) * 0.07;
    base.push(
      {
        kind: 'cone',
        pos: [Math.cos(a) * rr, 0.26, Math.sin(a) * rr],
        rot: [Math.sin(a) * 0.62, 0, -Math.cos(a) * 0.62],
        scale: [0.1, 0.34 + (i % 3) * 0.1, 0.1],
        color: C.poisonDark,
        seg: 4,
      },
      {
        kind: 'cone',
        pos: [Math.cos(a) * (rr + 0.14), 0.19, Math.sin(a) * (rr + 0.14)],
        rot: [Math.sin(a) * 0.85, 0, -Math.cos(a) * 0.85],
        scale: [0.06, 0.2, 0.06],
        color: 0x3f7a24,
        seg: 4,
      },
    );
  });
  // 줄기 — 마디 3단 + 덩굴 감김 (머리를 띄워 식물 실루엣을 만든다)
  const stalkTop = 0.52 + t * 0.05;
  for (let i = 0; i < 3; i++) {
    const sy = 0.2 + ((stalkTop - 0.2) / 3) * i;
    const sh = (stalkTop - 0.2) / 3 + 0.03;
    base.push({
      kind: 'cyl',
      pos: [0, sy + sh / 2, 0],
      scale: [0.26 - i * 0.03, sh, 0.26 - i * 0.03],
      color: i % 2 === 0 ? 0x3f7a24 : 0x4a8a28,
      seg: 6,
      hueJitter: 0.025,
    });
    ropeRing(base, 0, sy + sh * 0.9, 0, 0.13 - i * 0.015, 6, 0.035, 0x2f5e1a);
  }
  // 잎
  around(4, 0.9, (a, i) => {
    base.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.24, 0.3 + (i % 2) * 0.1, Math.sin(a) * 0.24],
      rot: [Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25],
      scale: [0.24, 0.34, 0.05],
      color: i % 2 === 0 ? C.leaf : C.leafDark,
      seg: 4,
    });
  });
  // 줄기 중단 잎 — 머리와 둔덕 사이를 채운다
  around(3, 1.7, (a, i) => {
    base.push({
      kind: 'cone',
      pos: [Math.cos(a) * 0.17, stalkTop * (0.62 + (i % 2) * 0.14), Math.sin(a) * 0.17],
      rot: [Math.sin(a) * 1.05, 0, -Math.cos(a) * 1.05],
      scale: [0.19, 0.28, 0.045],
      color: i % 2 === 0 ? C.leaf : 0x5aa832,
      seg: 4,
    });
  });
  // 포자 주머니 (병합 발광 — 밝은 연두)
  if (t >= 2) {
    around(2 + Math.min(t - 2, 2), 0.4, (a, i) => {
      base.push({
        kind: 'ico',
        pos: [Math.cos(a) * 0.4, 0.26 + (i % 2) * 0.1, Math.sin(a) * 0.4],
        rot: [i * 1.1, i * 0.6, i * 0.3],
        scale: 0.13,
        color: 0xc0f24a,
      });
    });
  }
  if (t >= 4) {
    base.push({ kind: 'sphere', pos: [0.36, 0.3, 0.3], scale: 0.2, color: 0xd2f86a });
    base.push({ kind: 'cyl', pos: [0.24, 0.24, 0.2], rot: [0.5, 0.9, -0.7], scale: [0.05, 0.3, 0.05], color: 0x3f7a24, seg: 4 });
  }

  const bs = 0.23 + t * 0.04;
  const pivotY = stalkTop;
  const by = stalkTop + bs * 0.9;

  // 액션(발광): 식물 머리 — 헤드 요 회전 + 스쿼시&스트레치를 함께 받는다
  const action: PartSpec[] = [
    { kind: 'sphere', pos: [0, 0, 0], scale: [bs * 2, bs * 1.7, bs * 2], color: C.poison },
    { kind: 'cyl', pos: [0, -bs * 0.85, 0], scale: [bs * 1.2, bs * 0.5, bs * 1.2], color: 0x6fb824, seg: 6 },
  ];
  // 벌린 턱잎
  const petals = t >= 3 ? 5 : 4;
  around(petals, 0.2, (a, i) => {
    action.push({
      kind: 'cone',
      pos: [Math.cos(a) * bs * 1.05, bs * 0.85, Math.sin(a) * bs * 1.05],
      rot: [Math.sin(a) * 0.95, 0, -Math.cos(a) * 0.95],
      scale: [0.17, 0.36 + (i % 2) * 0.08, 0.06],
      color: i % 2 === 0 ? 0xb8478a : 0xc85a9e,
      seg: 4,
    });
  });
  // 이빨
  around(6, 0.5, (a) => {
    action.push({
      kind: 'cone',
      pos: [Math.cos(a) * bs * 0.78, bs * 0.72, Math.sin(a) * bs * 0.78],
      rot: [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25],
      scale: [0.05, 0.15, 0.05],
      color: 0xf2f0d8,
      seg: 4,
    });
  });
  // 반점
  around(4, 1.0, (a, i) => {
    action.push({
      kind: 'ico',
      pos: [Math.cos(a) * bs * 0.94, -bs * 0.2 + (i % 2) * 0.1, Math.sin(a) * bs * 0.94],
      rot: [i, i * 0.7, i * 0.4],
      scale: 0.075,
      color: C.poisonDark,
    });
  });
  if (t >= 3) {
    action.push({ kind: 'cyl', pos: [0.02, bs * 0.4, 0], rot: [0, 0, -0.4], scale: [0.07, 0.3, 0.07], color: 0xd8f070, seg: 4 });
  }
  return { base, action, actionMat: 'glow', headPivotY: pivotY, actionPivot: [0, by - pivotY, 0] };
}

/** 상아 발리스타. base를 head에 병합 → 원형 회전판 위에서 통째로 조준. */
function ballista(t: number): Parts {
  const twin = t >= 4;
  const s = 1 + t * 0.055;
  const head: PartSpec[] = [];

  groundRim(head, 0.62, 6 + t, C.bark, C.stone, C.stoneDark);

  // 회전판 + 널판 + 밧줄 테두리
  const deckY = 0.15;
  head.push({
    kind: 'cyl',
    pos: [0, deckY, 0],
    scale: [1.0 * s, 0.12, 1.0 * s],
    color: C.woodDark,
    seg: 8,
    hueJitter: 0.02,
  });
  plankGrain(head, deckY + 0.061, 0.44 * s, 3 + t, C.bark);
  ropeRing(head, 0, deckY + 0.02, 0, 0.47 * s, 9, 0.038, ROPE);

  // 총가(스톡) — 몸통 + 홈 + 결
  const railY = deckY + 0.24;
  head.push(
    { kind: 'box', pos: [0, railY, 0], scale: [0.78 * s, 0.16, 0.26], color: C.wood, hueJitter: 0.02 },
    { kind: 'box', pos: [-0.06, railY + 0.11, 0], scale: [0.62 * s, 0.07, 0.15], color: C.woodDark },
    { kind: 'box', pos: [0, railY + 0.09, 0.11], scale: [0.72 * s, 0.05, 0.035], color: C.bark },
    { kind: 'box', pos: [0, railY + 0.09, -0.11], scale: [0.72 * s, 0.05, 0.035], color: C.bark },
    { kind: 'box', pos: [-0.4 * s, railY + 0.02, 0], rot: [0, 0, 0.28], scale: [0.22, 0.2, 0.2], color: C.woodDark },
  );
  // 받침 기둥
  head.push({ kind: 'cyl', pos: [0, deckY + 0.12, 0], scale: [0.26, 0.16, 0.26], color: C.bark, seg: 6 });

  // 비틀림 다발(밧줄 뭉치) + 상아 활대
  const bows: number[] = twin ? [-0.09, 0.15] : [0.02];
  for (const dy of bows) {
    for (const side of [-1, 1] as const) {
      const bz = side * 0.22 * s;
      head.push({
        kind: 'cyl',
        pos: [0.1, railY + 0.12 + dy, bz],
        rot: [Math.PI / 2, 0, 0],
        scale: [0.15, 0.14, 0.15],
        color: ROPE,
        seg: 6,
      });
      head.push(
        {
          kind: 'cyl',
          pos: [0.16, railY + 0.16 + dy, side * 0.36 * s],
          rot: [side * 0.5, 0, 0.1],
          scale: [0.075, 0.46 * s, 0.075],
          color: C.bone,
          seg: 5,
          hueJitter: 0.015,
        },
        {
          kind: 'cone',
          pos: [0.22, railY + 0.34 + dy, side * 0.52 * s],
          rot: [side * 0.92, 0, 0.1],
          scale: [0.085, 0.32, 0.085],
          color: C.boneDark,
          seg: 5,
        },
        { kind: 'box', pos: [0.16, railY + 0.1 + dy, side * 0.29 * s], rot: [side * 0.5, 0, 0], scale: [0.09, 0.06, 0.09], color: ROPE },
      );
    }
    // 시위 — 활대 끝에서 끝까지만, 가늘고 어둡게
    head.push({
      kind: 'box',
      pos: [-0.1, railY + 0.24 + dy, 0],
      scale: [0.016, 0.016, 0.74 * s],
      color: 0x5e4622,
    });
  }

  // 방아쇠 + 권양 손잡이
  head.push(
    { kind: 'box', pos: [-0.3 * s, railY - 0.06, 0], scale: [0.08, 0.16, 0.08], color: C.boneDark },
    { kind: 'cyl', pos: [-0.34 * s, railY + 0.1, 0], rot: [Math.PI / 2, 0, 0], scale: [0.13, 0.3, 0.13], color: C.bark, seg: 6 },
    { kind: 'box', pos: [-0.34 * s, railY + 0.1, 0.2], rot: [0, 0, 0.5], scale: [0.045, 0.18, 0.045], color: C.wood },
  );

  // 뼈 장식 / 탄약 통
  if (t >= 1) {
    head.push(
      { kind: 'cyl', pos: [-0.34 * s, deckY + 0.2, 0.36 * s], scale: [0.2, 0.28, 0.2], color: C.hideDark, seg: 6 },
      { kind: 'cyl', pos: [-0.34 * s, deckY + 0.34, 0.36 * s], scale: [0.22, 0.04, 0.22], color: C.hide, seg: 6 },
    );
    around(2 + Math.min(t, 2), 0.4, (a, i) => {
      head.push({
        kind: 'cyl',
        pos: [-0.34 * s + Math.cos(a) * 0.07, deckY + 0.46 + (i % 2) * 0.05, 0.36 * s + Math.sin(a) * 0.07],
        rot: [0.12, 0, 0.1],
        scale: [0.03, 0.3, 0.03],
        color: C.boneDark,
        seg: 4,
      });
    });
  }
  if (t >= 2) head.push({ kind: 'sphere', pos: [-0.3 * s, deckY + 0.2, -0.36 * s], scale: 0.22, color: C.bone });
  if (t >= 3) {
    boneCharm(head, 0.34 * s, railY - 0.02, 0.2, 0.1);
    boneCharm(head, 0.34 * s, railY - 0.02, -0.2, 0.1, 0.3);
  }

  // 액션: 장전된 볼트 — 발사 후 뒤에서 앞으로 재장전 슬라이드
  const action: PartSpec[] = [];
  for (const dy of bows) {
    action.push(
      { kind: 'cyl', pos: [0.14, dy, 0], rot: [0, 0, Math.PI / 2], scale: [0.05, 0.74 * s, 0.05], color: C.boneDark, seg: 5 },
      { kind: 'cone', pos: [0.56 * s, dy, 0], rot: [0, 0, -Math.PI / 2], scale: [0.1, 0.2, 0.1], color: C.bone, seg: 5 },
      { kind: 'box', pos: [0.42 * s, dy, 0], scale: [0.045, 0.07, 0.07], color: ROPE },
      { kind: 'box', pos: [-0.18, dy, 0], scale: [0.13, 0.07, 0.018], color: C.banner },
      { kind: 'box', pos: [-0.18, dy, 0], rot: [Math.PI / 2, 0, 0], scale: [0.13, 0.07, 0.018], color: C.banner },
    );
  }
  return { head, action, headPivotY: 0, actionPivot: [0, railY + 0.11, 0] };
}

/** 전쟁북 — 몸통은 base, 북면+북채는 action(스프링 스쿼시). */
function drum(t: number): Parts {
  const big = t >= 3;
  const r = (0.32 + t * 0.032) * 2;
  const h = 0.36 + t * 0.05;
  const base: PartSpec[] = [];

  groundRim(base, 0.62, 6 + t, C.bark, C.stone, C.stoneDark);

  // 다리 3개 (통나무 + 결) — 몸통을 띄워 다리가 읽히게
  around(3, 0.4, (a) => {
    logPost(base, Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.08, 0.32, 0.06, C.woodDark, C.bark, 0.3);
  });
  // 몸통(가죽 측면) + 상하 테 + 봉제선
  const bodyY = 0.36;
  base.push(
    { kind: 'cyl', pos: [0, bodyY + h / 2, 0], scale: [r, h, r], color: C.hideDark, seg: 8, hueJitter: 0.02 },
    { kind: 'cyl', pos: [0, bodyY + 0.03, 0], scale: [r * 1.06, 0.07, r * 1.06], color: C.bark, seg: 8 },
    { kind: 'cyl', pos: [0, bodyY + h - 0.03, 0], scale: [r * 1.07, 0.07, r * 1.07], color: C.bark, seg: 8 },
  );
  hideSeams(base, bodyY + h / 2, h * 0.86, r * 0.5, 6, C.hide);
  // 가죽 끈 지그재그 결속 (몸통 안에 머물도록 짧게)
  around(6, 0.25, (a, i) => {
    base.push({
      kind: 'box',
      pos: [Math.cos(a) * r * 0.51, bodyY + h * 0.5, Math.sin(a) * r * 0.51],
      rot: [0, -a, i % 2 === 0 ? 0.34 : -0.34],
      scale: [0.03, h * 0.78, 0.03],
      color: ROPE_D,
    });
  });
  // 테두리 문양
  const marks = 3 + t;
  around(marks, 0, (a) => {
    base.push({
      kind: 'box',
      pos: [Math.cos(a) * r * 0.51, bodyY + h * 0.5, Math.sin(a) * r * 0.51],
      rot: [0, -a, 0],
      scale: [0.035, h * 0.6, 0.11],
      color: C.banner,
    });
  });
  if (big) {
    base.push(
      { kind: 'cyl', pos: [-r * 0.5, 0.86, r * 0.46], rot: [0, 0.5, 0.06], scale: [0.06, 1.3, 0.06], color: C.woodDark, seg: 5 },
      { kind: 'box', pos: [-r * 0.5 + 0.16, 1.28, r * 0.46], rot: [0, 0.5, 0], scale: [0.34, 0.24, 0.02], color: t >= 4 ? C.gold : C.banner },
      { kind: 'box', pos: [-r * 0.5 + 0.14, 1.1, r * 0.46], rot: [0, 0.5, 0], scale: [0.26, 0.1, 0.02], color: C.banner },
    );
    boneCharm(base, -r * 0.5, 1.42, r * 0.46, 0.12);
  }
  if (t >= 1) {
    around(2 + Math.min(t, 2), 0.9, (a, i) => {
      base.push({
        kind: 'cone',
        pos: [Math.cos(a) * r * 0.62, bodyY + 0.14 + (i % 2) * 0.08, Math.sin(a) * r * 0.62],
        rot: [Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2],
        scale: [0.07, 0.26, 0.07],
        color: 0xe8e2d0,
        seg: 4,
      });
    });
  }

  // 액션: 북면 + 테 + 북채 — 스프링 스쿼시 바운스
  const action: PartSpec[] = [
    { kind: 'cyl', pos: [0, 0.02, 0], scale: [r * 0.95, 0.05, r * 0.95], color: 0xe0c898, seg: 8, hueJitter: 0.012 },
    { kind: 'cyl', pos: [0, 0.055, 0], scale: [r * 0.62, 0.03, r * 0.62], color: 0xf0dcb4, seg: 8 },
  ];
  ropeRing(action, 0, 0.02, 0, r * 0.5, 9, 0.045, C.bark);
  // 북면 문양
  around(4, 0.4, (a) => {
    action.push({
      kind: 'box',
      pos: [Math.cos(a) * r * 0.3, 0.06, Math.sin(a) * r * 0.3],
      rot: [0, -a, 0],
      scale: [0.16, 0.018, 0.05],
      color: 0xb2703c,
    });
  });
  // 북채 2개
  for (const sx of [1, -1] as const) {
    action.push(
      { kind: 'cyl', pos: [sx * 0.17, 0.24, sx * 0.1], rot: [0, 0, sx * -0.6], scale: [0.045, 0.42, 0.045], color: C.wood, seg: 5 },
      { kind: 'sphere', pos: [sx * 0.3, 0.38, sx * 0.1], scale: 0.12, color: C.hide },
      { kind: 'box', pos: [sx * 0.26, 0.33, sx * 0.1], rot: [0, 0, sx * -0.6], scale: [0.06, 0.06, 0.06], color: ROPE },
    );
  }
  return { base, action, actionPivot: [0, 0.36 + h, 0] };
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
  const p = BUILDERS[id](t);
  const key = (part: string): string => `tw3:${id}:${t}:${part}`;
  const baseParts = p.base;
  const base =
    baseParts && baseParts.length > 0
      ? cachedGeo(key('base'), () => buildParts(baseParts, { seed: 1000 + t, ao: 0.16 }))
      : null;
  const headParts = p.head;
  const head =
    headParts && headParts.length > 0
      ? cachedGeo(key('head'), () => buildParts(headParts, { seed: 1100 + t, ao: base ? 0.06 : 0.16 }))
      : null;
  const actionParts = p.action;
  const actionGlow = p.actionMat === 'glow';
  const action =
    actionParts && actionParts.length > 0
      ? cachedGeo(key('act'), () =>
          buildParts(actionParts, actionGlow ? { seed: 1200 + t, ao: 0, faceJitter: 0.02 } : { seed: 1200 + t, ao: 0.04 }),
        )
      : null;
  return {
    base,
    head,
    action,
    flash: p.flash && action ? action : null,
    actionMat: p.actionMat ?? 'flat',
    headPivotY: p.headPivotY ?? 0,
    actionPivot: p.actionPivot ?? [0, 0, 0],
  };
}

// ---------------------------------------------------------------------------
// 리그 조립
// ---------------------------------------------------------------------------

export interface TowerRig {
  root: THREE.Group;
  /** 요 회전 그룹 (headPivotY 위치, action 포함) */
  head: THREE.Group;
  /** 발사 애니 그룹 (actionPivot 위치) */
  action: THREE.Group;
  /** 애디티브 플래시 셸 (평시 visible=false) */
  flash: THREE.Mesh | null;
}

/**
 * TowerModel → Mesh 리그. head/action 그룹은 지오메트리가 없어도 항상 만들어
 * 뷰가 일관되게 yaw/애니를 적용할 수 있게 한다.
 * 그림자 캐스터는 몸체(base 우선, 없으면 head) 하나뿐 — 그림자 패스 드로우콜 최소화.
 */
export function assembleTower(
  model: TowerModel,
  mats: { flat: THREE.Material; glow: THREE.Material },
  shadows: boolean,
): TowerRig {
  const root = new THREE.Group();

  let body: THREE.Mesh | null = null;
  if (model.base) {
    body = new THREE.Mesh(model.base, mats.flat);
    body.receiveShadow = shadows;
    root.add(body);
  }

  const head = new THREE.Group();
  head.position.y = model.headPivotY;
  root.add(head);
  if (model.head) {
    const hm = new THREE.Mesh(model.head, mats.flat);
    hm.receiveShadow = shadows;
    head.add(hm);
    body ??= hm;
  }
  if (body) body.castShadow = shadows;

  const action = new THREE.Group();
  action.position.set(model.actionPivot[0], model.actionPivot[1], model.actionPivot[2]);
  head.add(action);
  let flash: THREE.Mesh | null = null;
  if (model.action) {
    const am = new THREE.Mesh(model.action, model.actionMat === 'glow' ? mats.glow : mats.flat);
    if (model.actionMat === 'flat') am.receiveShadow = shadows;
    action.add(am);
    if (model.flash) {
      flash = new THREE.Mesh(model.flash, additiveMat());
      flash.visible = false;
      action.add(flash);
    }
  }

  return { root, head, action, flash };
}
