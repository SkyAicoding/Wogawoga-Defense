/**
 * 적 12종 로우폴리 모델 (각 ≤600 tri). 전방 = +x, 발바닥 y=0.
 * 실루엣 가독성 우선: 타입별 뚜렷한 형태 + 밝은 배색 악센트.
 */
import type * as THREE from 'three';
import type { EnemyId } from '@/data/types';
import { C } from '../palette';
import { buildParts, cachedGeo, type PartSpec } from './factory';

function legs(y: number, dx: number, dz: number, s: number, color: number): PartSpec[] {
  return [
    { kind: 'box', pos: [dx, y / 2, dz], scale: [s, y, s], color },
    { kind: 'box', pos: [dx, y / 2, -dz], scale: [s, y, s], color },
  ];
}

function raptor(): PartSpec[] {
  const body = 0xe8763a;
  const belly = 0xf2d9a0;
  return [
    { kind: 'box', pos: [0.02, 0.42, 0], rot: [0, 0, -0.1], scale: [0.52, 0.26, 0.22], color: body, hueJitter: 0.01 },
    { kind: 'box', pos: [0.05, 0.32, 0], scale: [0.4, 0.12, 0.18], color: belly },
    { kind: 'cone', pos: [-0.42, 0.5, 0], rot: [0, 0, -1.75], scale: [0.16, 0.5, 0.12], color: body },
    { kind: 'box', pos: [0.3, 0.6, 0], rot: [0, 0, 0.5], scale: [0.12, 0.26, 0.1], color: body },
    { kind: 'box', pos: [0.44, 0.72, 0], scale: [0.26, 0.14, 0.13], color: body },
    { kind: 'box', pos: [0.56, 0.68, 0], scale: [0.12, 0.07, 0.1], color: belly },
    { kind: 'box', pos: [0.42, 0.68, 0], scale: [0.28, 0.04, 0.15], color: 0xb84a22 },
    ...legs(0.3, 0.02, 0.13, 0.09, body),
    { kind: 'box', pos: [0.12, 0.04, 0.13], scale: [0.16, 0.06, 0.08], color: 0xc9903e },
    { kind: 'box', pos: [0.12, 0.04, -0.13], scale: [0.16, 0.06, 0.08], color: 0xc9903e },
  ];
}

function compy(): PartSpec[] {
  const body = 0x7ac74a;
  return [
    { kind: 'box', pos: [0, 0.22, 0], rot: [0, 0, -0.15], scale: [0.26, 0.15, 0.13], color: body, hueJitter: 0.02 },
    { kind: 'cone', pos: [-0.22, 0.26, 0], rot: [0, 0, -1.72], scale: [0.09, 0.26, 0.07], color: body },
    { kind: 'box', pos: [0.14, 0.34, 0], scale: [0.1, 0.12, 0.08], color: body },
    { kind: 'box', pos: [0.24, 0.36, 0], scale: [0.12, 0.07, 0.06], color: 0x5aa838 },
    ...legs(0.15, 0.0, 0.07, 0.05, 0x5aa838),
  ];
}

function trike(): PartSpec[] {
  const body = 0x92a04c;
  return [
    { kind: 'box', pos: [-0.05, 0.42, 0], scale: [0.7, 0.4, 0.42], color: body, hueJitter: 0.012 },
    { kind: 'cone', pos: [-0.5, 0.44, 0], rot: [0, 0, -1.68], scale: [0.24, 0.4, 0.2], color: body },
    // 프릴 (세로 원판)
    { kind: 'cyl', pos: [0.34, 0.66, 0], rot: [0, 0, Math.PI / 2], scale: [0.56, 0.08, 0.56], color: 0xd9873a, seg: 8 },
    { kind: 'cyl', pos: [0.35, 0.66, 0], rot: [0, 0, Math.PI / 2], scale: [0.4, 0.09, 0.4], color: body, seg: 8 },
    { kind: 'box', pos: [0.5, 0.5, 0], scale: [0.34, 0.26, 0.26], color: body },
    { kind: 'cone', pos: [0.68, 0.44, 0], rot: [0, 0, -Math.PI / 2], scale: [0.12, 0.2, 0.12], color: 0x6f7a38, seg: 5 },
    // 뿔 3개
    { kind: 'cone', pos: [0.58, 0.72, 0.1], rot: [0, 0, -1.1], scale: [0.05, 0.3, 0.05], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [0.58, 0.72, -0.1], rot: [0, 0, -1.1], scale: [0.05, 0.3, 0.05], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [0.66, 0.58, 0], rot: [0, 0, -1.35], scale: [0.05, 0.18, 0.05], color: C.bone, seg: 4 },
    ...legs(0.24, 0.22, 0.2, 0.13, 0x6f7a38),
    ...legs(0.24, -0.28, 0.2, 0.13, 0x6f7a38),
  ];
}

function ptera(): PartSpec[] {
  // 공중 유닛 — 몸 중심 y≈0.35, 뷰가 고도 1.6을 더한다
  const body = 0xd98a5a;
  const wing = 0xc06a3e;
  return [
    { kind: 'box', pos: [0, 0.35, 0], scale: [0.42, 0.16, 0.16], color: body, hueJitter: 0.015 },
    { kind: 'box', pos: [0.3, 0.42, 0], scale: [0.2, 0.1, 0.1], color: body },
    { kind: 'cone', pos: [0.5, 0.4, 0], rot: [0, 0, -Math.PI / 2], scale: [0.07, 0.3, 0.07], color: 0xe8c060, seg: 4 },
    { kind: 'cone', pos: [0.24, 0.52, 0], rot: [0, 0, 2.4], scale: [0.07, 0.3, 0.07], color: 0xb84a2e, seg: 4 },
    // 날개 (좌우 평판, 살짝 처짐)
    { kind: 'box', pos: [-0.02, 0.4, 0.42], rot: [-0.16, 0, 0], scale: [0.34, 0.04, 0.7], color: wing, hueJitter: 0.015 },
    { kind: 'box', pos: [-0.02, 0.33, 0.86], rot: [-0.34, 0, 0], scale: [0.26, 0.035, 0.3], color: wing },
    { kind: 'box', pos: [-0.02, 0.4, -0.42], rot: [0.16, 0, 0], scale: [0.34, 0.04, 0.7], color: wing },
    { kind: 'box', pos: [-0.02, 0.33, -0.86], rot: [0.34, 0, 0], scale: [0.26, 0.035, 0.3], color: wing },
    { kind: 'cone', pos: [-0.28, 0.35, 0], rot: [0, 0, -1.65], scale: [0.08, 0.24, 0.06], color: body },
  ];
}

function ankylo(): PartSpec[] {
  const shell = 0x6a5a38;
  const body = 0x9a824a;
  return [
    { kind: 'box', pos: [0, 0.3, 0], scale: [0.72, 0.26, 0.46], color: body, hueJitter: 0.012 },
    { kind: 'sphere', pos: [-0.02, 0.46, 0], scale: [0.76, 0.34, 0.54], color: shell, hueJitter: 0.012 },
    { kind: 'box', pos: [0.42, 0.3, 0], scale: [0.24, 0.18, 0.2], color: body },
    // 등갑 스파이크
    { kind: 'cone', pos: [0.14, 0.66, 0.14], scale: [0.09, 0.16, 0.09], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [0.14, 0.66, -0.14], scale: [0.09, 0.16, 0.09], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [-0.14, 0.64, 0.16], scale: [0.09, 0.16, 0.09], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [-0.14, 0.64, -0.16], scale: [0.09, 0.16, 0.09], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [0, 0.7, 0], scale: [0.1, 0.18, 0.1], color: C.bone, seg: 4 },
    // 꼬리 곤봉
    { kind: 'cyl', pos: [-0.48, 0.3, 0], rot: [0, 0, Math.PI / 2], scale: [0.09, 0.3, 0.09], color: body, seg: 5 },
    { kind: 'sphere', pos: [-0.68, 0.32, 0], scale: 0.22, color: shell },
    ...legs(0.17, 0.24, 0.2, 0.11, 0x7a6a40),
    ...legs(0.17, -0.24, 0.2, 0.11, 0x7a6a40),
  ];
}

function boar(): PartSpec[] {
  const body = 0x8a5a3a;
  return [
    { kind: 'box', pos: [-0.02, 0.34, 0], scale: [0.56, 0.32, 0.3], color: body, hueJitter: 0.012 },
    { kind: 'box', pos: [-0.02, 0.52, 0], scale: [0.44, 0.1, 0.16], color: 0x4f3220 }, // 갈기
    { kind: 'box', pos: [0.3, 0.32, 0], scale: [0.26, 0.24, 0.22], color: body },
    { kind: 'box', pos: [0.44, 0.26, 0], scale: [0.12, 0.1, 0.12], color: 0xd9a06a }, // 코
    { kind: 'cone', pos: [0.4, 0.24, 0.12], rot: [0, 0, -0.9], scale: [0.05, 0.18, 0.05], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [0.4, 0.24, -0.12], rot: [0, 0, -0.9], scale: [0.05, 0.18, 0.05], color: C.bone, seg: 4 },
    ...legs(0.2, 0.18, 0.12, 0.08, 0x5f3d24),
    ...legs(0.2, -0.18, 0.12, 0.08, 0x5f3d24),
    { kind: 'cyl', pos: [-0.32, 0.42, 0], rot: [0, 0, 0.6], scale: [0.03, 0.14, 0.03], color: 0x4f3220, seg: 4 },
  ];
}

function warrior(): PartSpec[] {
  return [
    ...legs(0.26, 0, 0.09, 0.1, 0x8a4a2e),
    { kind: 'box', pos: [0, 0.44, 0], scale: [0.24, 0.14, 0.3], color: 0xb85c2e }, // 허리옷
    { kind: 'box', pos: [0, 0.62, 0], scale: [0.26, 0.26, 0.3], color: C.skin, hueJitter: 0.01 },
    { kind: 'sphere', pos: [0, 0.86, 0], scale: 0.24, color: C.skin },
    { kind: 'box', pos: [0, 0.94, 0], scale: [0.22, 0.1, 0.24], color: 0x3a2a1c }, // 머리칼
    { kind: 'cone', pos: [0.02, 1.0, 0], scale: [0.06, 0.16, 0.06], color: 0xe0512e, seg: 4 }, // 깃털
    // 방패 (전방)
    { kind: 'cyl', pos: [0.22, 0.6, 0.02], rot: [0, 0, Math.PI / 2], scale: [0.42, 0.06, 0.42], color: C.wood, seg: 7 },
    { kind: 'sphere', pos: [0.26, 0.6, 0.02], scale: 0.1, color: C.stoneDark },
    // 곤봉 (뒤쪽 어깨)
    { kind: 'cyl', pos: [-0.14, 0.72, -0.2], rot: [0.5, 0, 0.5], scale: [0.05, 0.34, 0.05], color: C.wood, seg: 4 },
    { kind: 'sphere', pos: [-0.24, 0.86, -0.28], scale: 0.13, color: C.stone },
  ];
}

function shaman(): PartSpec[] {
  const robe = 0x8a4a9e;
  return [
    { kind: 'cone', pos: [0, 0.36, 0], scale: [0.44, 0.72, 0.44], color: robe, seg: 6, hueJitter: 0.015 },
    { kind: 'sphere', pos: [0, 0.76, 0], scale: 0.22, color: C.skin },
    // 뼈 가면 뿔
    { kind: 'cone', pos: [0.05, 0.92, 0.1], rot: [0.5, 0, 0], scale: [0.05, 0.18, 0.05], color: C.bone, seg: 4 },
    { kind: 'cone', pos: [0.05, 0.92, -0.1], rot: [-0.5, 0, 0], scale: [0.05, 0.18, 0.05], color: C.bone, seg: 4 },
    { kind: 'box', pos: [0.12, 0.76, 0], scale: [0.1, 0.16, 0.2], color: C.bone },
    // 지팡이 + 해골
    { kind: 'cyl', pos: [0.26, 0.5, 0.12], rot: [0, 0, 0.1], scale: [0.04, 0.9, 0.04], color: C.woodDark, seg: 4 },
    { kind: 'sphere', pos: [0.28, 1.0, 0.12], scale: 0.15, color: 0x6ff2c8 },
    { kind: 'box', pos: [-0.1, 0.5, 0.2], scale: [0.14, 0.3, 0.05], color: 0x6a3a7a }, // 부적 천
  ];
}

function mammoth(): PartSpec[] {
  const fur = 0xa06a3a;
  const furDark = 0x7a4c28;
  return [
    { kind: 'box', pos: [-0.08, 0.72, 0], scale: [1.0, 0.66, 0.66], color: fur, hueJitter: 0.012 },
    { kind: 'box', pos: [-0.08, 1.06, 0], scale: [0.86, 0.14, 0.54], color: furDark }, // 등털
    { kind: 'box', pos: [0.52, 0.86, 0], scale: [0.42, 0.44, 0.44], color: fur },
    { kind: 'box', pos: [0.52, 1.1, 0], scale: [0.34, 0.1, 0.36], color: furDark },
    // 코 (3단 굽힘)
    { kind: 'cyl', pos: [0.76, 0.68, 0], rot: [0, 0, 0.3], scale: [0.14, 0.36, 0.14], color: fur, seg: 5 },
    { kind: 'cyl', pos: [0.82, 0.4, 0], rot: [0, 0, -0.2], scale: [0.11, 0.3, 0.11], color: fur, seg: 5 },
    { kind: 'cyl', pos: [0.78, 0.2, 0], rot: [0, 0, -0.5], scale: [0.09, 0.2, 0.09], color: furDark, seg: 5 },
    // 상아 (굽은 2단)
    { kind: 'cyl', pos: [0.62, 0.5, 0.2], rot: [0, 0, -0.7], scale: [0.06, 0.4, 0.06], color: C.bone, seg: 5 },
    { kind: 'cone', pos: [0.82, 0.62, 0.2], rot: [0, 0, -2.2], scale: [0.07, 0.3, 0.07], color: C.bone, seg: 5 },
    { kind: 'cyl', pos: [0.62, 0.5, -0.2], rot: [0, 0, -0.7], scale: [0.06, 0.4, 0.06], color: C.bone, seg: 5 },
    { kind: 'cone', pos: [0.82, 0.62, -0.2], rot: [0, 0, -2.2], scale: [0.07, 0.3, 0.07], color: C.bone, seg: 5 },
    // 귀
    { kind: 'box', pos: [0.4, 1.0, 0.26], rot: [0.3, 0, 0], scale: [0.2, 0.24, 0.06], color: furDark },
    { kind: 'box', pos: [0.4, 1.0, -0.26], rot: [-0.3, 0, 0], scale: [0.2, 0.24, 0.06], color: furDark },
    ...legs(0.4, 0.28, 0.24, 0.2, furDark),
    ...legs(0.4, -0.4, 0.24, 0.2, furDark),
  ];
}

function theropod(body: number, belly: number, scaleUp: number): PartSpec[] {
  // trex/spino 공용 몸통 베이스
  const s = scaleUp;
  return [
    { kind: 'box', pos: [-0.05 * s, 0.78 * s, 0], rot: [0, 0, -0.12], scale: [0.8 * s, 0.5 * s, 0.44 * s], color: body, hueJitter: 0.012 },
    { kind: 'box', pos: [-0.02 * s, 0.6 * s, 0], scale: [0.6 * s, 0.2 * s, 0.36 * s], color: belly },
    { kind: 'cone', pos: [-0.66 * s, 0.86 * s, 0], rot: [0, 0, -1.72], scale: [0.3 * s, 0.8 * s, 0.22 * s], color: body },
    { kind: 'box', pos: [0.34 * s, 1.04 * s, 0], rot: [0, 0, 0.45], scale: [0.2 * s, 0.34 * s, 0.24 * s], color: body },
    // 머리 + 벌린 턱
    { kind: 'box', pos: [0.56 * s, 1.22 * s, 0], scale: [0.44 * s, 0.26 * s, 0.28 * s], color: body },
    { kind: 'box', pos: [0.72 * s, 1.08 * s, 0], rot: [0, 0, 0.25], scale: [0.3 * s, 0.1 * s, 0.22 * s], color: belly },
    { kind: 'cone', pos: [0.72 * s, 1.14 * s, 0.08 * s], rot: [Math.PI, 0, 0], scale: [0.04 * s, 0.1 * s, 0.04 * s], color: C.white, seg: 4 },
    { kind: 'cone', pos: [0.72 * s, 1.14 * s, -0.08 * s], rot: [Math.PI, 0, 0], scale: [0.04 * s, 0.1 * s, 0.04 * s], color: C.white, seg: 4 },
    // 팔 (작음)
    { kind: 'box', pos: [0.3 * s, 0.84 * s, 0.2 * s], rot: [0, 0, -0.5], scale: [0.2 * s, 0.07 * s, 0.07 * s], color: body },
    { kind: 'box', pos: [0.3 * s, 0.84 * s, -0.2 * s], rot: [0, 0, -0.5], scale: [0.2 * s, 0.07 * s, 0.07 * s], color: body },
    // 다리 (두꺼움)
    { kind: 'box', pos: [-0.05 * s, 0.3 * s, 0.18 * s], scale: [0.24 * s, 0.6 * s, 0.16 * s], color: body },
    { kind: 'box', pos: [-0.05 * s, 0.3 * s, -0.18 * s], scale: [0.24 * s, 0.6 * s, 0.16 * s], color: body },
    { kind: 'box', pos: [0.05 * s, 0.04 * s, 0.18 * s], scale: [0.28 * s, 0.08 * s, 0.14 * s], color: belly },
    { kind: 'box', pos: [0.05 * s, 0.04 * s, -0.18 * s], scale: [0.28 * s, 0.08 * s, 0.14 * s], color: belly },
  ];
}

function spino(): PartSpec[] {
  const body = 0x4a8a9a;
  const parts = theropod(body, 0xa8c9b0, 1.05);
  // 등지느러미 돛
  for (let i = 0; i < 5; i++) {
    const x = 0.22 - i * 0.16;
    const h = 0.5 - Math.abs(i - 2) * 0.12;
    parts.push({ kind: 'box', pos: [x, 1.1 + h / 2, 0], scale: [0.12, h, 0.05], color: 0xe07a3a, hueJitter: 0.02 });
  }
  parts.push({ kind: 'box', pos: [0.72, 1.16, 0], scale: [0.3, 0.14, 0.18], color: body }); // 긴 주둥이
  return parts;
}

function trex(): PartSpec[] {
  const parts = theropod(0x7a4636, 0xd9b382, 1.25);
  // 등 골판 + 흉터 악센트
  for (let i = 0; i < 4; i++) {
    parts.push({ kind: 'cone', pos: [0.15 - i * 0.22, 1.34 - i * 0.05, 0], scale: [0.08, 0.14, 0.08], color: 0x4f2c20, seg: 4 });
  }
  parts.push({ kind: 'box', pos: [0.6, 1.34, 0.12], rot: [0, 0, 0.3], scale: [0.16, 0.04, 0.03], color: 0xd94a2e });
  return parts;
}

function golem(): PartSpec[] {
  const rockC = 0x4a3a36;
  const rockD = 0x382a26;
  return [
    { kind: 'ico', pos: [0, 0.62, 0], scale: [0.74, 0.7, 0.6], color: rockC, hueJitter: 0.01 },
    { kind: 'ico', pos: [0.1, 1.06, 0], scale: 0.36, color: rockD },
    // 용암 균열 (발광은 밝은 색으로 — 인스턴싱 단일 머티리얼)
    { kind: 'box', pos: [0.2, 0.7, 0.18], rot: [0.3, 0.2, 0.5], scale: [0.3, 0.06, 0.05], color: C.lava },
    { kind: 'box', pos: [-0.12, 0.5, 0.24], rot: [0, 0.4, -0.4], scale: [0.24, 0.05, 0.05], color: 0xffa042 },
    { kind: 'box', pos: [0.05, 0.85, -0.24], rot: [0.5, 0, 0.3], scale: [0.2, 0.05, 0.04], color: C.lava },
    { kind: 'sphere', pos: [0.32, 1.1, 0.09], scale: 0.08, color: 0xffd24a }, // 눈
    { kind: 'sphere', pos: [0.32, 1.1, -0.09], scale: 0.08, color: 0xffd24a },
    // 팔 (큰 바위 주먹)
    { kind: 'ico', pos: [0.14, 0.5, 0.44], rot: [0.5, 0, 0], scale: [0.3, 0.5, 0.3], color: rockD },
    { kind: 'ico', pos: [0.2, 0.22, 0.5], scale: 0.3, color: rockC },
    { kind: 'ico', pos: [0.14, 0.5, -0.44], rot: [-0.5, 0, 0], scale: [0.3, 0.5, 0.3], color: rockD },
    { kind: 'ico', pos: [0.2, 0.22, -0.5], scale: 0.3, color: rockC },
    ...legs(0.26, -0.06, 0.2, 0.22, rockD),
  ];
}

const BUILDERS: Record<EnemyId, () => PartSpec[]> = {
  raptor,
  compy,
  trike,
  ptera,
  ankylo,
  boar,
  warrior,
  shaman,
  mammoth,
  spino,
  trex,
  golem,
};

/** 보스 계열 (개별 메시 + 스케일/색 강조 + 넓은 체력바) */
export const BOSS_ENEMIES: ReadonlySet<EnemyId> = new Set(['spino', 'trex']);

/** 캐시된 적 지오메트리. 전방 +x, 발 y=0 */
export function buildEnemy(id: EnemyId): THREE.BufferGeometry {
  return cachedGeo(`enemy:${id}`, () => buildParts(BUILDERS[id](), { seed: 77, ao: 0.12 }));
}

export const ALL_ENEMY_IDS: readonly EnemyId[] = [
  'raptor',
  'compy',
  'trike',
  'ptera',
  'ankylo',
  'boar',
  'warrior',
  'shaman',
  'mammoth',
  'spino',
  'trex',
  'golem',
];
