/**
 * 타워 8종 × 5티어 프로시저럴 모델 — 부위 분리 리그(베이스/헤드/액션/글로우).
 * buildTower(id, tier)는 키 캐시된 지오메트리 묶음(TowerModel)을 돌려주고,
 * assembleTower()가 이를 회전 가능한 Group 리그로 조립한다. t = 0~4.
 *
 * 좌표 규약: 방향성 무기(spear/catapult/poison/ballista)의 '전방'은 +X.
 * 뷰가 head 그룹을 yaw = atan2(-dz, dx) 로 돌려 타깃을 향하게 한다.
 * 드로우콜: 타워당 base(1) + head(≤1) + action(≤1) + glow(≤1) ≤ 3
 * (flash 셸은 발사 순간에만 visible — 평시 드로우콜에 포함되지 않음).
 */
import * as THREE from 'three';
import type { TowerId } from '@/data/types';
import { C, additiveMat } from '../palette';
import { buildParts, cachedGeo, type PartSpec } from './factory';

export interface TowerModel {
  /** 고정 하부 (flatMat) */
  base: THREE.BufferGeometry;
  /** 요 회전부 (flatMat) — headPivotY 기준, 없으면 null */
  head: THREE.BufferGeometry | null;
  /** 발사 애니 파트 — head 아래 actionPivot 기준, 없으면 null */
  action: THREE.BufferGeometry | null;
  /** 고정 발광부 (glowMat) — base에 부착 */
  glow: THREE.BufferGeometry | null;
  /** 발사 플래시 셸 (additiveMat, 평시 hidden) — action 지오메트리 재사용 */
  flash: THREE.BufferGeometry | null;
  /** action 파트 머티리얼 */
  actionMat: 'flat' | 'glow';
  /** head 그룹의 베이스 로컬 회전 피벗 높이 */
  headPivotY: number;
  /** action 그룹의 head 로컬 피벗 */
  actionPivot: [number, number, number];
}

type V3 = [number, number, number];

interface Parts {
  base: PartSpec[];
  head?: PartSpec[];
  action?: PartSpec[];
  glow?: PartSpec[];
  actionMat?: 'flat' | 'glow';
  headPivotY?: number;
  actionPivot?: V3;
  /** true면 action 지오메트리를 additive 플래시 셸로도 사용 */
  flash?: boolean;
}

// ---------------------------------------------------------------------------
// 빌더 — 파트 좌표는 각 슬롯의 피벗 로컬 기준
// ---------------------------------------------------------------------------

function spear(t: number): Parts {
  const base: PartSpec[] = [];
  const raised = t >= 2; // 티어3부터 망루화
  const deck = raised ? 0.42 + (t - 2) * 0.16 : 0;
  if (raised) {
    for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) {
      base.push({ kind: 'cyl', pos: [lx, deck / 2, lz], rot: [0, 0, lx * 0.12], scale: [0.09, deck, 0.09], color: C.woodDark, seg: 5 });
    }
    base.push({ kind: 'box', pos: [0, deck, 0], scale: [0.92, 0.08, 0.92], color: C.wood, hueJitter: 0.01 });
    base.push({ kind: 'box', pos: [0, deck + 0.12, 0.42], scale: [0.9, 0.18, 0.06], color: C.woodDark });
    base.push({ kind: 'box', pos: [0, deck + 0.12, -0.42], scale: [0.9, 0.18, 0.06], color: C.woodDark });
  }
  const hutY = deck + 0.04;
  base.push({ kind: 'cyl', pos: [0, hutY + 0.18, 0], scale: [0.52, 0.36, 0.52], color: C.hide, seg: 7, hueJitter: 0.015 });

  // 헤드: 지붕 + 꽂힌 창들 — 통째로 타깃을 향해 회전
  const pivotY = hutY + 0.4;
  const head: PartSpec[] = [
    { kind: 'cone', pos: [0, 0.12, 0], scale: [0.66 + t * 0.02, 0.4, 0.66 + t * 0.02], color: C.straw, seg: 7, hueJitter: 0.02 },
  ];
  const n = 1 + t;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.5;
    const x = Math.cos(a) * 0.34;
    const z = Math.sin(a) * 0.34;
    head.push(
      { kind: 'cyl', pos: [x, 0.22, z], rot: [z * 0.5, 0, -x * 0.5], scale: [0.035, 0.75, 0.035], color: C.wood, seg: 4 },
      { kind: 'cone', pos: [x * 1.18, 0.59, z * 1.18], rot: [z * 0.5, 0, -x * 0.5], scale: [0.09, 0.18, 0.09], color: C.stone, seg: 4 },
    );
  }
  if (t >= 4) {
    head.push(
      { kind: 'box', pos: [0, 0.55, 0], rot: [0, 0.4, 0], scale: [0.06, 0.5, 0.06], color: C.woodDark },
      { kind: 'box', pos: [0.14, 0.7, 0], rot: [0, 0.4, 0], scale: [0.3, 0.2, 0.02], color: C.banner },
    );
  }
  // 액션: 전방 투창 — 발사 순간 앞으로 찌른 뒤 복귀
  const action: PartSpec[] = [
    { kind: 'cyl', pos: [0.06, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.04, 0.66, 0.04], color: C.wood, seg: 4 },
    { kind: 'cone', pos: [0.44, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.1, 0.2, 0.1], color: C.stone, seg: 4 },
    { kind: 'box', pos: [-0.24, 0, 0], scale: [0.12, 0.06, 0.02], color: C.banner },
  ];
  return { base, head, action, headPivotY: pivotY, actionPivot: [0.3, 0.02, 0] };
}

function catapult(t: number): Parts {
  const boneAge = t >= 3; // 매머드뼈 투석기
  const frame = boneAge ? C.bone : C.wood;
  const s = 1 + t * 0.07;
  const base: PartSpec[] = [
    { kind: 'box', pos: [0, 0.08, 0], scale: [0.9 * s, 0.14, 0.7 * s], color: C.woodDark, hueJitter: 0.01 },
  ];
  if (t >= 4) base.push({ kind: 'sphere', pos: [-0.55, 0.2, 0.3], scale: 0.3, color: C.bone });

  // 헤드: 프레임 + 축 + 카운터웨이트 (플랫폼 위에서 요 회전)
  const hp = 0.15;
  const head: PartSpec[] = [
    { kind: 'box', pos: [0, 0.3 - hp, 0.26 * s], rot: [0.5, 0, 0], scale: [0.1, 0.62 * s, 0.1], color: frame },
    { kind: 'box', pos: [0, 0.3 - hp, -0.26 * s], rot: [-0.5, 0, 0], scale: [0.1, 0.62 * s, 0.1], color: frame },
    { kind: 'cyl', pos: [0, 0.42 * s - hp, 0], rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.6 * s, 0.07], color: boneAge ? C.boneDark : C.woodDark, seg: 5 },
    { kind: 'ico', pos: [0.3 * s, 0.34 * s - hp, 0], scale: 0.26 * s, color: C.stoneDark },
  ];
  if (boneAge) {
    head.push(
      { kind: 'cyl', pos: [0.34 * s, 0.4 - hp, 0.3 * s], rot: [0, 0, -0.8], scale: [0.07, 0.7, 0.07], color: C.bone, seg: 5 },
      { kind: 'cyl', pos: [0.34 * s, 0.4 - hp, -0.3 * s], rot: [0, 0, -0.8], scale: [0.07, 0.7, 0.07], color: C.bone, seg: 5 },
    );
  }
  // 액션: 투척 암 + 바가지 + 장전된 돌 — 축(actionPivot) 기준 스윙
  const action: PartSpec[] = [
    { kind: 'box', pos: [-0.18 * s, 0.1 * s, 0], rot: [0, 0, -0.7], scale: [0.8 * s, 0.09, 0.12], color: frame },
    { kind: 'cyl', pos: [-0.48 * s, 0.4 * s, 0], scale: [0.26 * s, 0.1, 0.26 * s], color: C.woodDark, seg: 6 },
    { kind: 'ico', pos: [-0.48 * s, 0.5 * s, 0], scale: 0.24 * s, color: C.stone, hueJitter: 0.02 },
  ];
  return { base, head, action, headPivotY: hp, actionPivot: [0, 0.42 * s - hp, 0] };
}

function lightning(t: number): Parts {
  const base: PartSpec[] = [];
  const segs = 2 + Math.min(t, 2);
  let y = 0;
  for (let i = 0; i < segs; i++) {
    const h = 0.3 - i * 0.03;
    const r = 0.3 - i * 0.045;
    base.push({ kind: 'cyl', pos: [0, y + h / 2, 0], scale: [r * 2, h, r * 2], color: i % 2 === 0 ? C.wood : C.boneDark, seg: 6, hueJitter: 0.015 });
    y += h + 0.02;
  }
  // 해골 장식
  base.push({ kind: 'sphere', pos: [0.26, y - 0.34, 0.12], scale: 0.17, color: C.bone });
  if (t >= 1) base.push({ kind: 'sphere', pos: [-0.24, y - 0.2, -0.14], scale: 0.15, color: C.bone });
  base.push({ kind: 'cone', pos: [0, y + 0.05, 0], scale: [0.24, 0.12, 0.24], color: C.black, seg: 6 });

  // 액션(발광): 정상 크리스탈 — 발사 시 펄스 + 진동 + 애디티브 플래시
  const cs = 0.2 + t * 0.05;
  const yc = y + cs * 0.9;
  const action: PartSpec[] = [
    { kind: 'ico', pos: [0, 0, 0], rot: [0.3, 0.5, 0.2], scale: [cs, cs * 1.9, cs], color: C.crystal },
  ];
  if (t >= 3) {
    action.push(
      { kind: 'ico', pos: [0.3, y + 0.3 - yc, 0.16], scale: 0.11, color: 0x9af2ff },
      { kind: 'ico', pos: [-0.28, y + 0.44 - yc, -0.1], scale: 0.09, color: 0x9af2ff },
    );
  }
  if (t >= 4) action.push({ kind: 'ico', pos: [0.05, y + 0.72 - yc, -0.22], scale: 0.12, color: 0xd2faff });
  return { base, action, actionMat: 'glow', actionPivot: [0, yc, 0], flash: true };
}

function brazier(t: number): Parts {
  const volcanic = t >= 3; // 화산석 화로
  const stone = volcanic ? 0x4c3733 : C.stone;
  const r = 0.34 + t * 0.03;
  const base: PartSpec[] = [];
  const glow: PartSpec[] = [];
  const ringN = 7;
  for (let i = 0; i < ringN; i++) {
    const a = (i / ringN) * Math.PI * 2;
    base.push({ kind: 'ico', pos: [Math.cos(a) * r, 0.12, Math.sin(a) * r], rot: [i, i * 1.7, 0], scale: 0.2 + (i % 2) * 0.04, color: stone, hueJitter: 0.012 });
  }
  base.push(
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
  // 액션(발광): 화염 원뿔 — 오라 틱마다 플레어, 상시 플리커
  const fs = 0.7 + t * 0.12;
  const action: PartSpec[] = [
    { kind: 'cone', pos: [0, 0.04 + 0.3 * fs, 0], scale: [0.42 * fs, 0.62 * fs, 0.42 * fs], color: C.fire, seg: 6 },
    { kind: 'cone', pos: [0.03, 0.02 + 0.22 * fs, 0.02], scale: [0.26 * fs, 0.44 * fs, 0.26 * fs], color: 0xffd24a, seg: 5 },
  ];
  if (t >= 2) action.push({ kind: 'cone', pos: [-0.12, 0.1, 0.1], rot: [0, 0, 0.3], scale: [0.14 * fs, 0.3 * fs, 0.14 * fs], color: C.ember, seg: 4 });
  return { base, glow, action, actionMat: 'glow', actionPivot: [0, 0.2, 0] };
}

function frost(t: number): Parts {
  const base: PartSpec[] = [
    { kind: 'sphere', pos: [0, 0.08, 0], scale: [0.9, 0.24, 0.9], color: C.snowCap },
  ];
  const glow: PartSpec[] = [];
  const h = 0.55 + t * 0.17; // t4 = 빙하 첨탑
  // 액션(발광): 중앙 첨탑 — 발사 시 회전 가속 + 펄스 (살짝 기울여 회전이 보이게)
  const action: PartSpec[] = [
    { kind: 'cone', pos: [0, h / 2, 0], rot: [0.05, 0, 0.03], scale: [0.34 + t * 0.02, h, 0.34 + t * 0.02], color: C.iceDeep, seg: 6 },
  ];
  if (t >= 3) action.push({ kind: 'ico', pos: [0.02, h + 0.14, 0], scale: 0.14, color: 0xe2faff });
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
  return { base, glow, action, actionMat: 'glow', actionPivot: [0, 0.1, 0] };
}

function poison(t: number): Parts {
  const base: PartSpec[] = [
    { kind: 'cyl', pos: [0, 0.06, 0], scale: [0.8, 0.12, 0.8], color: 0x4a6a2a, seg: 7, hueJitter: 0.02 },
  ];
  // 가시덩굴
  const n = 4 + t;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const rr = 0.32 + (i % 2) * 0.06;
    base.push({
      kind: 'cone',
      pos: [Math.cos(a) * rr, 0.2, Math.sin(a) * rr],
      rot: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6],
      scale: [0.09, 0.3 + (i % 3) * 0.08, 0.09],
      color: C.poisonDark,
      seg: 4,
    });
  }
  base.push({ kind: 'cyl', pos: [0, 0.2, 0], scale: [0.2, 0.3, 0.2], color: 0x3f7a24, seg: 5 });

  const bs = 0.24 + t * 0.05;
  const by = 0.2 + bs;
  const pivotY = 0.3;
  // 헤드: 벌린 턱잎(t3+) — 줄기 위에서 타깃을 향해 회전
  const head: PartSpec[] = [];
  if (t >= 3) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      head.push({
        kind: 'cone',
        pos: [Math.cos(a) * bs * 1.1, by + bs * 0.9 - pivotY, Math.sin(a) * bs * 1.1],
        rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9],
        scale: [0.16, 0.34, 0.06],
        color: 0xb8478a,
      });
    }
  }
  // 액션(발광): 식물 머리 — 움츠렸다 뱉는 스쿼시&스트레치
  const action: PartSpec[] = [
    { kind: 'sphere', pos: [0, 0, 0], scale: [bs * 2, bs * 1.7, bs * 2], color: C.poison },
  ];
  const glow: PartSpec[] = [];
  if (t >= 4) glow.push({ kind: 'sphere', pos: [0.3, 0.3, 0.24], scale: 0.18, color: 0xc0f24a });
  return { base, head, action, glow, actionMat: 'glow', headPivotY: pivotY, actionPivot: [0, by - pivotY, 0] };
}

function ballista(t: number): Parts {
  const twin = t >= 4; // 쌍상아
  const s = 1 + t * 0.06;
  const base: PartSpec[] = [
    { kind: 'cyl', pos: [0, 0.09, 0], scale: [0.8 * s, 0.18, 0.8 * s], color: C.woodDark, seg: 7, hueJitter: 0.01 },
  ];
  if (t >= 2) base.push({ kind: 'sphere', pos: [-0.3 * s, 0.28, 0.24 * s], scale: 0.2, color: C.bone });

  // 헤드: 레일 + 상아 활 (플랫폼 위에서 요 회전)
  const hp = 0.18;
  const head: PartSpec[] = [
    { kind: 'box', pos: [0, 0.3 - hp, 0], scale: [0.7 * s, 0.16, 0.24], color: C.wood },
    { kind: 'box', pos: [-0.1, 0.42 - hp, 0], scale: [0.5 * s, 0.07, 0.14], color: C.woodDark },
  ];
  const bows = twin ? [-0.1, 0.14] : [0];
  for (const dy of bows) {
    for (const side of [-1, 1]) {
      head.push(
        { kind: 'cyl', pos: [0.14, 0.42 + dy - hp, side * 0.26 * s], rot: [side * 0.5, 0, 0], scale: [0.07, 0.5 * s, 0.07], color: C.bone, seg: 5 },
        { kind: 'cone', pos: [0.2, 0.62 + dy - hp, side * 0.44 * s], rot: [side * 0.9, 0, 0], scale: [0.08, 0.3, 0.08], color: C.boneDark, seg: 5 },
      );
    }
  }
  // 액션: 장전된 볼트 — 발사 시 사라졌다 뒤에서 앞으로 재장전 슬라이드
  const action: PartSpec[] = [];
  for (const dy of bows) {
    action.push(
      { kind: 'cyl', pos: [0.16, dy, 0], rot: [0, 0, Math.PI / 2], scale: [0.045, 0.7 * s, 0.045], color: C.boneDark, seg: 4 },
      { kind: 'cone', pos: [0.54 * s, dy, 0], rot: [0, 0, -Math.PI / 2], scale: [0.09, 0.18, 0.09], color: C.bone, seg: 4 },
    );
  }
  return { base, head, action, headPivotY: hp, actionPivot: [0, 0.46 - hp, 0] };
}

function drum(t: number): Parts {
  const big = t >= 3;
  const r = (0.3 + t * 0.035) * 2;
  const h = 0.34 + t * 0.05;
  const base: PartSpec[] = [
    // 다리 3개
    { kind: 'cyl', pos: [0.2, 0.1, 0.14], rot: [0.2, 0, -0.2], scale: [0.07, 0.24, 0.07], color: C.woodDark, seg: 4 },
    { kind: 'cyl', pos: [-0.22, 0.1, 0.12], rot: [0.2, 0, 0.2], scale: [0.07, 0.24, 0.07], color: C.woodDark, seg: 4 },
    { kind: 'cyl', pos: [0, 0.1, -0.24], rot: [-0.25, 0, 0], scale: [0.07, 0.24, 0.07], color: C.woodDark, seg: 4 },
    // 몸통(가죽 측면)
    { kind: 'cyl', pos: [0, 0.2 + h / 2, 0], scale: [r, h, r], color: C.hideDark, seg: 8, hueJitter: 0.015 },
  ];
  // 테두리 문양
  const marks = 3 + t;
  for (let i = 0; i < marks; i++) {
    const a = (i / marks) * Math.PI * 2;
    base.push({ kind: 'box', pos: [Math.cos(a) * r * 0.5, 0.2 + h * 0.5, Math.sin(a) * r * 0.5], rot: [0, -a, 0], scale: [0.03, h * 0.6, 0.1], color: C.banner });
  }
  if (big) {
    base.push(
      { kind: 'box', pos: [-r * 0.55, 0.6, r * 0.5], rot: [0, 0.5, 0], scale: [0.05, 1.1, 0.05], color: C.woodDark },
      { kind: 'box', pos: [-r * 0.55 + 0.14, 1.0, r * 0.5], rot: [0, 0.5, 0], scale: [0.32, 0.22, 0.02], color: t >= 4 ? C.gold : C.banner },
    );
  }
  // 액션: 북면 + 북채 (+뼈 장식) — 스프링 스쿼시 바운스
  const action: PartSpec[] = [
    { kind: 'cyl', pos: [0, 0.015, 0], scale: [r * 0.94, 0.04, r * 0.94], color: 0xe0c898, seg: 8 },
    { kind: 'cyl', pos: [0.16, 0.22, 0.1], rot: [0, 0, -0.6], scale: [0.04, 0.4, 0.04], color: C.wood, seg: 4 },
    { kind: 'sphere', pos: [0.28, 0.36, 0.1], scale: 0.11, color: C.hide },
    { kind: 'cyl', pos: [-0.16, 0.22, -0.08], rot: [0, 0, 0.6], scale: [0.04, 0.4, 0.04], color: C.wood, seg: 4 },
    { kind: 'sphere', pos: [-0.28, 0.36, -0.08], scale: 0.11, color: C.hide },
  ];
  if (t >= 1) action.push({ kind: 'cone', pos: [r * 0.5, 0.12, -r * 0.4], rot: [0.2, 0, -0.15], scale: [0.06, 0.24, 0.06], color: 0xe8e2d0, seg: 4 });
  return { base, action, actionPivot: [0, 0.2 + h, 0] };
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
  const key = (part: string): string => `tw2:${id}:${t}:${part}`;
  const base = cachedGeo(key('base'), () => buildParts(p.base, { seed: 1000 + t, ao: 0.14 }));
  const headParts = p.head;
  const head =
    headParts && headParts.length > 0
      ? cachedGeo(key('head'), () => buildParts(headParts, { seed: 1100 + t, ao: 0.06 }))
      : null;
  const actionParts = p.action;
  const actionGlow = p.actionMat === 'glow';
  const action =
    actionParts && actionParts.length > 0
      ? cachedGeo(key('act'), () =>
          buildParts(actionParts, actionGlow ? { seed: 1200 + t, ao: 0, faceJitter: 0.02 } : { seed: 1200 + t, ao: 0 }),
        )
      : null;
  const glowParts = p.glow;
  const glow =
    glowParts && glowParts.length > 0
      ? cachedGeo(key('glow'), () => buildParts(glowParts, { seed: 2000 + t, ao: 0, faceJitter: 0.02 }))
      : null;
  return {
    base,
    head,
    action,
    glow,
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
  glow: THREE.Mesh | null;
  /** 애디티브 플래시 셸 (평시 visible=false) */
  flash: THREE.Mesh | null;
}

/**
 * TowerModel → Mesh 리그. head/action 그룹은 지오메트리가 없어도 항상 만들어
 * 뷰가 일관되게 yaw/애니를 적용할 수 있게 한다.
 */
export function assembleTower(
  model: TowerModel,
  mats: { flat: THREE.Material; glow: THREE.Material },
  shadows: boolean,
): TowerRig {
  const root = new THREE.Group();
  const baseMesh = new THREE.Mesh(model.base, mats.flat);
  baseMesh.castShadow = shadows;
  baseMesh.receiveShadow = shadows;
  root.add(baseMesh);

  const head = new THREE.Group();
  head.position.y = model.headPivotY;
  root.add(head);
  if (model.head) {
    const hm = new THREE.Mesh(model.head, mats.flat);
    hm.castShadow = shadows;
    hm.receiveShadow = shadows;
    head.add(hm);
  }

  const action = new THREE.Group();
  action.position.set(model.actionPivot[0], model.actionPivot[1], model.actionPivot[2]);
  head.add(action);
  let flash: THREE.Mesh | null = null;
  if (model.action) {
    const am = new THREE.Mesh(model.action, model.actionMat === 'glow' ? mats.glow : mats.flat);
    if (model.actionMat === 'flat') {
      am.castShadow = shadows;
      am.receiveShadow = shadows;
    }
    action.add(am);
    if (model.flash) {
      flash = new THREE.Mesh(model.flash, additiveMat());
      flash.visible = false;
      action.add(flash);
    }
  }

  let glow: THREE.Mesh | null = null;
  if (model.glow) {
    glow = new THREE.Mesh(model.glow, mats.glow);
    root.add(glow);
  }
  return { root, head, action, glow, flash };
}
