/**
 * 적 16종 로우폴리 모델. 전방 = +x, 발바닥 y=0.
 *
 * 스타일: 플랫 셰이딩 디오라마(각진 로우폴리). 폴리곤은 "매끈함"이 아니라
 * **실루엣·관절·종별 특징**에 쓴다 — 테이퍼 체인(tube)으로 몸통/목/꼬리를 마디로
 * 나누고, 다리는 관절 2단 + 발/발톱, 얼굴에는 눈·이빨·콧구멍을 넣는다.
 * 원주 분할은 4~7로 묶어 각진 느낌을 유지한다(8+는 매끈해져 스타일 이탈).
 *
 * 적은 타입별 InstancedMesh(드로우콜 1)라 삼각형 증가 비용이 사실상 없다.
 * 모델당 예산: 일반 800~1,200 / 보스급 1,200~1,700 삼각형.
 *
 * 조립 헬퍼는 전부 이 파일 안에 둔다.
 *
 * 보행 리그: 각 종 빌더는 RigBuilder 를 받아 사지 그룹을 등록하고, 그 id 를
 * PartSpec.limb 에 태그한다. 실제 변형은 버텍스 셰이더가 한다(gait.ts).
 * legQuad/legBiped 에 `{ rig }` 만 넘기면 피벗·위상·보폭이 자동 계산된다.
 */
import type * as THREE from 'three';
import type { AllyId, EnemyId } from '@/data/types';
import { ALLY_DEFS } from '@/data/allies';
import { GATE_BITE_DEPTH, GATE_LEAN_MAX } from '@/data/balance';
import { clamp } from '@/core/mathx';
import { C } from '../palette';
import { buildParts, cachedGeo, type PartSpec } from './factory';
import {
  ATK_LAUNCH,
  ATK_RELEASE,
  ATK_ROLE_HEAD,
  ATK_ROLE_MAIN,
  ATK_ROLE_OFF,
  RigBuilder,
  computeGroundLift,
  type AttackPose,
  type EnemyRig,
} from './gait';

type V3 = [number, number, number];

const HALF_PI = Math.PI / 2;

// --- 조립 헬퍼 -------------------------------------------------------------

/** 길이축이 +x 인 파트(box)를 dir 방향으로 눕히는 오일러 XYZ */
function eulerX(dx: number, dy: number, dz: number): V3 {
  const len = Math.hypot(dx, dy, dz) || 1;
  return [0, Math.atan2(-dz, dx), Math.asin(clamp(dy / len, -1, 1))];
}

/** 길이축이 +y 인 파트(cyl/cone)를 dir 방향으로 눕히는 오일러 XYZ */
function eulerY(dx: number, dy: number, dz: number): V3 {
  const len = Math.hypot(dx, dy, dz) || 1;
  return [0, Math.atan2(dz, -dx), Math.acos(clamp(dy / len, -1, 1))];
}

interface LinkOpts {
  kind?: 'box' | 'cyl' | 'cone';
  seg?: number;
  hueJitter?: number;
  /** 길이 여유 — 마디 이음매를 겹쳐 메운다 */
  pad?: number;
  /** 단면 세로/가로 비 (h = w * flat). 1보다 크면 높은 단면 */
  flat?: number;
}

/**
 * a→b 를 잇는 한 마디.
 * box: 길이축 +x, 단면은 h(세로) × w(가로).
 * cyl/cone: 길이축 +y, 단면 지름 w × h.
 */
function link(a: V3, b: V3, w: number, h: number, color: number, o: LinkOpts = {}): PartSpec {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) + (o.pad ?? 0);
  const pos: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  if ((o.kind ?? 'box') === 'box') {
    return { kind: 'box', pos, rot: eulerX(dx, dy, dz), scale: [len, h, w], color, hueJitter: o.hueJitter };
  }
  return {
    kind: o.kind === 'cone' ? 'cone' : 'cyl',
    pos,
    rot: eulerY(dx, dy, dz),
    scale: [w, len, h],
    color,
    seg: o.seg ?? 6,
    hueJitter: o.hueJitter,
  };
}

/** 2차 베지어 중심선 샘플 — 휘어진 목/꼬리/코/상아 */
function arc(p0: V3, p1: V3, p2: V3, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
      u * u * p0[2] + 2 * u * t * p1[2] + t * t * p2[2],
    ]);
  }
  return out;
}

/** 중심선 + 굵기 램프 → 끝으로 갈수록 가늘어지는 마디 체인 (실루엣 담당) */
function tube(pts: readonly V3[], w0: number, w1: number, color: number, o: LinkOpts = {}): PartSpec[] {
  const n = pts.length - 1;
  const ws: number[] = [];
  for (let i = 0; i <= n; i++) ws.push(w0 + (w1 - w0) * (i / n));
  return tubeW(pts, ws, color, o);
}

/** 노드별 굵기를 직접 지정하는 체인 — 어깨 볼륨 같은 부풀림 표현 */
function tubeW(pts: readonly V3[], widths: readonly number[], color: number, o: LinkOpts = {}): PartSpec[] {
  const out: PartSpec[] = [];
  const flat = o.flat ?? 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const w = ((widths[i] ?? 0) + (widths[i + 1] ?? 0)) / 2;
    out.push(link(pts[i]!, pts[i + 1]!, w, w * flat, color, { ...o, pad: o.pad ?? w * 0.55 }));
  }
  return out;
}

/** z 대칭 복제 (중심에서 벗어난 파트 전용 — z=0 파트에 쓰면 낭비) */
function mirZ(parts: readonly PartSpec[]): PartSpec[] {
  const out: PartSpec[] = [];
  for (const p of parts) {
    out.push(p);
    const [x, y, z] = p.pos ?? [0, 0, 0];
    const [rx, ry, rz] = p.rot ?? [0, 0, 0];
    out.push({ ...p, pos: [x, y, -z], rot: [-rx, -ry, rz] });
  }
  return out;
}

/**
 * mirZ + 좌우에 서로 다른 사지 그룹 태그 (원본 +z = idL, 복제 −z = idR).
 * 좌우 다리는 위상이 π 차이라 **반드시 다른 그룹 id** 를 받아야 한다.
 * 피벗의 z 부호 뒤집기는 RigBuilder.pair 가 처리한다.
 */
function mirLimb(parts: readonly PartSpec[], idL: number, idR: number): PartSpec[] {
  const out: PartSpec[] = [];
  for (const p of parts) {
    out.push({ ...p, limb: idL });
    const [x, y, z] = p.pos ?? [0, 0, 0];
    const [rx, ry, rz] = p.rot ?? [0, 0, 0];
    out.push({ ...p, pos: [x, y, -z], rot: [-rx, -ry, rz], limb: idR });
  }
  return out;
}

/** 파트 묶음에 사지 그룹 태그를 일괄 부여 (이미 태그된 파트는 그대로 둔다) */
function tag(id: number, parts: readonly PartSpec[]): PartSpec[] {
  return parts.map((p) => (p.limb === undefined ? { ...p, limb: id } : p));
}

/** 파트 묶음에 변형(variant) 태그를 일괄 부여 — 0이면 태그하지 않는다(단품 빌드) */
function tagVariant(v: number, parts: readonly PartSpec[]): PartSpec[] {
  return v > 0 ? parts.map((p) => ({ ...p, variant: v })) : [...parts];
}

/** 지정 z를 기준으로 대칭 복제 (몸 중심이 아닌 소품 — 지팡이 해골 눈 등) */
function pairZ(parts: readonly PartSpec[], about: number): PartSpec[] {
  const out: PartSpec[] = [];
  for (const p of parts) {
    out.push(p);
    const [x, y, z] = p.pos ?? [0, 0, 0];
    const [rx, ry, rz] = p.rot ?? [0, 0, 0];
    out.push({ ...p, pos: [x, y, 2 * about - z], rot: [-rx, -ry, rz] });
  }
  return out;
}

/** 눈 (흰자 + 눈동자) — 좌우 자동 */
function eyes(
  x: number,
  y: number,
  z: number,
  r: number,
  iris: number = C.black,
  white: number = C.white,
): PartSpec[] {
  return mirZ([
    { kind: 'box', pos: [x, y, z], scale: [r * 1.7, r * 1.7, r * 0.8], color: white },
    { kind: 'box', pos: [x + r * 0.35, y, z + r * 0.3], scale: [r * 0.9, r * 0.9, r * 0.7], color: iris },
  ]);
}

/** 이빨 줄 — x0부터 dx 간격 n개, down=true면 아래로 */
function fangs(
  x0: number,
  dx: number,
  y: number,
  z: number,
  n: number,
  len: number,
  down: boolean,
  color: number = C.white,
): PartSpec[] {
  const out: PartSpec[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      kind: 'cone',
      pos: [x0 + dx * i, y, z],
      rot: [down ? Math.PI : 0, 0, 0],
      scale: [len * 0.5, len, len * 0.5],
      color,
      seg: 4,
    });
  }
  return mirZ(out);
}

/** 앞을 향한 발톱 3개 (가운데 + 좌우 벌림) */
function toes(x: number, y: number, z: number, w: number, len: number, color: number): PartSpec[] {
  return [
    { kind: 'cone', pos: [x, y, z], rot: [0, 0, -HALF_PI], scale: [w, len, w], color, seg: 4 },
    { kind: 'cone', pos: [x - len * 0.16, y, z + w * 1.2], rot: [0, -0.55, -HALF_PI], scale: [w * 0.85, len * 0.8, w * 0.85], color, seg: 4 },
    { kind: 'cone', pos: [x - len * 0.16, y, z - w * 1.2], rot: [0, 0.55, -HALF_PI], scale: [w * 0.85, len * 0.8, w * 0.85], color, seg: 4 },
  ];
}

/**
 * 다리 보행 옵션 — legQuad/legBiped 마지막 인자.
 * 넘기지 않으면 태깅 없이 예전 그대로(고정 다리) 나온다.
 */
interface LegGait {
  rig: RigBuilder;
  /** 좌측(+z) 다리 위상. 우측은 자동 +π. 4족은 앞 0 / 뒤 π 로 주면 대각 보행(속보) */
  phase?: number;
  /** 스윙 진폭(rad). 보폭 = 2·L·sin(amp), 보행 주기 거리 = 4·L·sin(amp) */
  amp?: number;
  /** 스윙 발 들어올림(모델 단위). 기본 = 다리길이 × 0.13 */
  lift?: number;
}

/**
 * 다리 파트 묶음을 좌우로 복제 + (리그가 있으면) 사지 그룹 태깅.
 * extra 는 발톱처럼 다리에 딸려 움직여야 하는 추가 파트(+z 쪽 좌표로 준다).
 */
function legPair(
  parts: readonly PartSpec[],
  hip: V3,
  g: LegGait | undefined,
  extra: readonly PartSpec[],
): PartSpec[] {
  const all = [...parts, ...extra];
  if (!g) return mirZ(all);
  const [idL, idR] = g.rig.leg(hip, { phase: g.phase, amp: g.amp, lift: g.lift });
  return mirLimb(all, idL, idR);
}

/** 4족 다리 한 쌍 — 상박/하박 2단 관절 + 발굽 + 발가락 */
function legQuad(
  x: number,
  z: number,
  top: number,
  thick: number,
  color: number,
  foot: number,
  bend = 0.05,
  gait?: LegGait,
  extra: readonly PartSpec[] = [],
): PartSpec[] {
  const hip: V3 = [x, top, z];
  const knee: V3 = [x + bend, top * 0.5, z * 1.04];
  // 발목은 다리 굵기의 절반보다 위 — 굵고 짧은 다리(ankylo)도 지면을 파고들지 않게
  const ankle: V3 = [x - bend * 0.5, Math.max(top * 0.2, thick * 0.46), z * 1.06];
  const fz = z * 1.06;
  return legPair(
    [
      link(hip, knee, thick * 1.15, thick * 1.15, color, { kind: 'cyl', seg: 6, pad: thick * 0.7 }),
      link(knee, ankle, thick * 0.85, thick * 0.85, color, { kind: 'cyl', seg: 6, pad: thick * 0.5 }),
      { kind: 'cyl', pos: [x + 0.01, top * 0.06, fz], scale: [thick * 1.9, top * 0.12, thick * 1.9], color: foot, seg: 6 },
      { kind: 'box', pos: [x + thick * 0.6, top * 0.035, fz], scale: [thick * 1.1, top * 0.07, thick * 1.7], color: foot },
    ],
    hip,
    gait,
    extra,
  );
}

/** 2족(수각류) 다리 한 쌍 — 허벅지/정강이/중족골/발 + 발톱 */
function legBiped(
  x: number,
  z: number,
  hipY: number,
  thick: number,
  color: number,
  foot: number,
  claw: number = C.boneDark,
  gait?: LegGait,
  extra: readonly PartSpec[] = [],
): PartSpec[] {
  const hip: V3 = [x, hipY, z];
  const knee: V3 = [x + thick * 1.15, hipY * 0.55, z * 1.06];
  const ankle: V3 = [x - thick * 0.85, hipY * 0.21, z * 1.06];
  const ball: V3 = [x + thick * 1.0, hipY * 0.075, z * 1.06];
  return legPair(
    [
      link(hip, knee, thick * 1.5, thick * 1.2, color, { kind: 'cyl', seg: 6, pad: thick * 0.8 }),
      link(knee, ankle, thick * 0.95, thick * 0.85, color, { kind: 'cyl', seg: 6, pad: thick * 0.6 }),
      link(ankle, ball, thick * 0.72, thick * 0.72, color, { pad: thick * 0.4 }),
      { kind: 'box', pos: [ball[0] + thick * 0.35, hipY * 0.035, z * 1.06], scale: [thick * 1.5, hipY * 0.07, thick * 1.6], color: foot },
      ...toes(ball[0] + thick * 1.2, hipY * 0.065, z * 1.06, thick * 0.42, thick * 0.9, claw),
    ],
    hip,
    gait,
    extra,
  );
}

/** 등줄기 가시/깃털 — 중심선 위에 크기 곡선으로 늘어놓기 */
function spines(pts: readonly V3[], h0: number, h1: number, w: number, color: number, seg = 4, lean = 0): PartSpec[] {
  const out: PartSpec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const t = pts.length > 1 ? i / (pts.length - 1) : 0;
    const h = h0 + (h1 - h0) * t;
    out.push({ kind: 'cone', pos: [p[0], p[1] + h * 0.4, p[2]], rot: [0, 0, lean], scale: [w, h, w * 0.6], color, seg });
  }
  return out;
}

// --- 적 16종 ---------------------------------------------------------------

function raptor(rig: RigBuilder): PartSpec[] {
  const body = 0xe8763a;
  const belly = 0xf2d9a0;
  const dark = 0xb84a22;
  const torso: V3[] = [[-0.28, 0.44, 0], [-0.12, 0.48, 0], [0.04, 0.5, 0], [0.2, 0.48, 0]];
  const tailRoot: V3 = [-0.24, 0.45, 0];
  const neckRoot: V3 = [0.2, 0.49, 0];
  const tail = arc(tailRoot, [-0.5, 0.5, 0], [-0.8, 0.34, 0], 8);
  const neck = arc(neckRoot, [0.36, 0.6, 0], [0.42, 0.7, 0], 4);
  // 2차 모션: 걸음당 1회(2배 주파수) 꼬리 좌우 흔들림 + 머리 까딱임
  const tailId = rig.add(tailRoot, [0, 1, 0], { amp2: 0.11 });
  const headId = rig.add(neckRoot, [0, 0, 1], { phase: HALF_PI, amp2: 0.055 });
  return [
    ...tubeW(torso, [0.24, 0.3, 0.3, 0.25], body, { flat: 1.02, hueJitter: 0.014 }),
    ...tag(tailId, tube(tail, 0.19, 0.035, body, { kind: 'cyl', seg: 6, flat: 1.15, hueJitter: 0.012 })),
    ...tag(headId, [
      ...tube(neck, 0.17, 0.13, body, { kind: 'cyl', seg: 6 }),
      // 머리: 두개골 + 주둥이 + 아래턱
      { kind: 'box', pos: [0.46, 0.735, 0], scale: [0.2, 0.16, 0.16], color: body },
      { kind: 'box', pos: [0.59, 0.725, 0], scale: [0.16, 0.115, 0.13], color: body },
      { kind: 'box', pos: [0.685, 0.715, 0], scale: [0.07, 0.075, 0.095], color: dark },
      { kind: 'box', pos: [0.59, 0.655, 0], scale: [0.22, 0.055, 0.11], color: belly },
      { kind: 'box', pos: [0.4, 0.665, 0], scale: [0.1, 0.09, 0.14], color: dark },
      ...fangs(0.545, 0.055, 0.678, 0.048, 3, 0.05, true),
      ...fangs(0.555, 0.055, 0.632, 0.042, 3, 0.045, false),
      ...eyes(0.47, 0.775, 0.082, 0.042),
      ...mirZ([{ kind: 'box', pos: [0.47, 0.815, 0.078], scale: [0.11, 0.03, 0.05], color: dark }]),
      ...mirZ([{ kind: 'box', pos: [0.675, 0.74, 0.034], scale: [0.03, 0.025, 0.022], color: C.black }]),
      // 머리볏 (뒤로 눕는 깃털)
      ...spines([[0.42, 0.82, 0], [0.36, 0.82, 0], [0.3, 0.8, 0]], 0.16, 0.1, 0.05, dark, 4, -0.7),
    ]),
    // 밝은 배
    ...tube([[-0.2, 0.35, 0], [0.02, 0.34, 0], [0.2, 0.39, 0]], 0.2, 0.15, belly, { flat: 0.62 }),
    // 등 깃털 라인 (몸통 구간은 고정)
    ...spines([[0.1, 0.55, 0], [-0.02, 0.55, 0], [-0.14, 0.53, 0]], 0.1, 0.08, 0.035, dark, 4, -0.5),
    // 꼬리 깃털 라인 — 꼬리와 같이 흔들려야 한다
    ...tag(tailId, spines([[-0.3, 0.52, 0], [-0.46, 0.5, 0], [-0.62, 0.45, 0]], 0.07, 0.05, 0.035, dark, 4, -0.5)),
    // 팔 (2단 + 발톱 3개)
    ...mirZ([
      link([0.22, 0.48, 0.12], [0.36, 0.4, 0.17], 0.07, 0.07, body, { kind: 'cyl', seg: 5, pad: 0.03 }),
      link([0.36, 0.4, 0.17], [0.46, 0.33, 0.16], 0.055, 0.055, body, { kind: 'cyl', seg: 5, pad: 0.03 }),
    ]),
    ...mirZ(toes(0.49, 0.32, 0.16, 0.022, 0.09, C.boneDark)),
    // 다리 + 낫발톱 (발톱은 다리 그룹에 딸려 움직인다)
    ...legBiped(0.0, 0.13, 0.42, 0.088, body, dark, C.boneDark, { rig, amp: 0.5 }, [
      { kind: 'cone', pos: [0.12, 0.13, 0.138], rot: [0, 0, -2.5], scale: [0.035, 0.16, 0.03], color: C.bone, seg: 4 },
    ]),
  ];
}

function compy(rig: RigBuilder): PartSpec[] {
  const body = 0x7ac74a;
  const dark = 0x4f9130;
  const belly = 0xd8ef9a;
  const torso: V3[] = [[-0.14, 0.24, 0], [-0.03, 0.26, 0], [0.06, 0.27, 0], [0.14, 0.25, 0]];
  const tailRoot: V3 = [-0.11, 0.24, 0];
  const neckRoot: V3 = [0.13, 0.26, 0];
  const tail = arc(tailRoot, [-0.3, 0.28, 0], [-0.52, 0.19, 0], 7);
  // 작은 몸집 = 짧은 보폭 = 높은 걸음 빈도(종종걸음).
  // 2차 모션도 그만큼 빠르고 크게 — 꼬리를 탁탁 치고 머리를 쪼듯 까딱인다.
  const tailId = rig.add(tailRoot, [0, 1, 0], { amp2: 0.17 });
  const headId = rig.add(neckRoot, [0, 0, 1], { phase: HALF_PI, amp2: 0.085 });
  return [
    ...tubeW(torso, [0.13, 0.17, 0.17, 0.13], body, { flat: 1.0, hueJitter: 0.02 }),
    ...tag(tailId, tube(tail, 0.1, 0.02, body, { kind: 'cyl', seg: 5, flat: 1.15 })),
    ...tag(headId, [
      ...tube(arc(neckRoot, [0.2, 0.32, 0], [0.22, 0.37, 0], 3), 0.09, 0.075, body, { kind: 'cyl', seg: 5 }),
      // 머리
      { kind: 'box', pos: [0.25, 0.39, 0], scale: [0.11, 0.09, 0.09], color: body },
      { kind: 'box', pos: [0.33, 0.378, 0], scale: [0.09, 0.06, 0.065], color: body },
      { kind: 'box', pos: [0.33, 0.343, 0], scale: [0.1, 0.03, 0.055], color: belly },
      { kind: 'box', pos: [0.385, 0.372, 0], scale: [0.035, 0.04, 0.05], color: dark },
      ...eyes(0.26, 0.412, 0.046, 0.028, C.black, 0xf6c23a),
      ...fangs(0.31, 0.045, 0.355, 0.024, 2, 0.03, true),
      // 목주머니
      { kind: 'box', pos: [0.19, 0.31, 0], scale: [0.07, 0.06, 0.07], color: belly },
    ]),
    ...tube([[-0.11, 0.19, 0], [0.11, 0.19, 0]], 0.11, 0.09, belly, { flat: 0.6 }),
    // 등 볏 — 몸통 구간
    ...spines([[0.08, 0.3, 0], [0.0, 0.3, 0], [-0.08, 0.29, 0]], 0.07, 0.0525, 0.028, dark, 4, -0.5),
    // 꼬리 위 볏은 꼬리와 같은 그룹이어야 어긋나지 않는다
    ...tag(tailId, spines([[-0.17, 0.28, 0], [-0.26, 0.27, 0]], 0.04375, 0.035, 0.028, dark, 4, -0.5)),
    // 등 줄무늬 (무리 개체 식별용 악센트)
    ...mirZ([
      { kind: 'box', pos: [0.04, 0.28, 0.06], rot: [0, 0, 0.2], scale: [0.04, 0.06, 0.05], color: dark },
      { kind: 'box', pos: [-0.05, 0.28, 0.065], rot: [0, 0, 0.2], scale: [0.04, 0.06, 0.05], color: dark },
      { kind: 'box', pos: [-0.14, 0.27, 0.06], rot: [0, 0, 0.2], scale: [0.035, 0.055, 0.045], color: dark },
    ]),
    // 팔
    ...mirZ([
      link([0.13, 0.26, 0.07], [0.21, 0.2, 0.09], 0.04, 0.04, body, { kind: 'cyl', seg: 5, pad: 0.02 }),
      { kind: 'cone', pos: [0.25, 0.185, 0.09], rot: [0, 0, -HALF_PI], scale: [0.025, 0.06, 0.025], color: C.boneDark, seg: 4 },
    ]),
    ...legBiped(0.0, 0.07, 0.21, 0.05, body, dark, C.boneDark, { rig, amp: 0.5 }),
  ];
}

function trike(rig: RigBuilder): PartSpec[] {
  const body = 0x92a04c;
  const dark = 0x6f7a38;
  const frill = 0xd9873a;
  const belly = 0xc7cf86;
  const torso: V3[] = [[-0.46, 0.44, 0], [-0.24, 0.47, 0], [0.0, 0.5, 0], [0.2, 0.5, 0], [0.34, 0.47, 0]];
  const tailRoot: V3 = [-0.42, 0.44, 0];
  const neckRoot: V3 = [0.32, 0.48, 0];
  // 2차 모션: 무거운 꼬리는 느린 좌우 스윙(1배), 머리는 걸음마다 끄덕임(2배)
  const tailId = rig.add(tailRoot, [0, 1, 0], { amp: 0.09 });
  const headId = rig.add(neckRoot, [0, 0, 1], { phase: HALF_PI, amp2: 0.05 });
  const parts: PartSpec[] = [
    ...tubeW(torso, [0.32, 0.42, 0.46, 0.46, 0.4], body, { flat: 0.95, hueJitter: 0.014 }),
    ...tube([[-0.34, 0.28, 0], [0.0, 0.26, 0], [0.26, 0.3, 0]], 0.36, 0.3, belly, { flat: 0.5 }),
    // 꼬리
    ...tag(
      tailId,
      tube(arc(tailRoot, [-0.62, 0.42, 0], [-0.78, 0.28, 0], 6), 0.24, 0.045, body, {
        kind: 'cyl',
        seg: 6,
        flat: 1.1,
      }),
    ),
    ...tag(headId, [
      // 목 + 머리
      ...tube([neckRoot, [0.44, 0.5, 0]], 0.36, 0.32, body),
      { kind: 'box', pos: [0.54, 0.5, 0], scale: [0.24, 0.28, 0.28], color: body },
      { kind: 'box', pos: [0.68, 0.46, 0], scale: [0.14, 0.17, 0.19], color: body },
      // 부리
      { kind: 'cone', pos: [0.78, 0.44, 0], rot: [0, 0, -1.35], scale: [0.14, 0.17, 0.16], color: C.boneDark, seg: 5 },
      { kind: 'box', pos: [0.72, 0.39, 0], scale: [0.12, 0.05, 0.15], color: C.boneDark },
      ...eyes(0.57, 0.55, 0.145, 0.04),
      // 뿔 3개 (큰 눈썹뿔 2 + 코뿔 1)
      ...mirZ([
        link([0.58, 0.66, 0.115], [0.82, 0.8, 0.145], 0.075, 0.075, C.bone, { kind: 'cone', seg: 5, pad: 0.02 }),
        link([0.52, 0.6, 0.12], [0.6, 0.68, 0.115], 0.095, 0.095, C.bone, { kind: 'cyl', seg: 5 }),
      ]),
      { kind: 'cone', pos: [0.76, 0.56, 0], rot: [0, 0, -0.9], scale: [0.075, 0.2, 0.075], color: C.bone, seg: 5 },
      // 목주름 프릴 — 판을 부채꼴로 배치 + 테두리 혹
      { kind: 'cyl', pos: [0.36, 0.68, 0], rot: [0, 0, HALF_PI], scale: [0.64, 0.09, 0.64], color: frill, seg: 7, hueJitter: 0.02 },
      { kind: 'cyl', pos: [0.39, 0.68, 0], rot: [0, 0, HALF_PI], scale: [0.46, 0.1, 0.46], color: body, seg: 7 },
      { kind: 'cyl', pos: [0.33, 0.68, 0], rot: [0, 0, HALF_PI], scale: [0.52, 0.06, 0.52], color: dark, seg: 7 },
    ]),
    // 목주름 (프릴 아래 살주름 3겹) — 몸통 쪽이라 고정
    ...mirZ([
      { kind: 'box', pos: [0.42, 0.44, 0.16], rot: [0, 0, 0.2], scale: [0.1, 0.1, 0.12], color: dark },
      { kind: 'box', pos: [0.38, 0.36, 0.14], rot: [0, 0, 0.2], scale: [0.1, 0.09, 0.11], color: dark },
    ]),
    // 앞다리 / 뒷다리 — 위상 0 / π 로 대각 보행
    ...legQuad(0.22, 0.22, 0.3, 0.15, body, dark, 0.04, { rig, amp: 0.6, phase: 0 }),
    ...legQuad(-0.3, 0.22, 0.3, 0.16, body, dark, -0.04, { rig, amp: 0.6, phase: Math.PI }),
  ];
  // 프릴 가장자리 뿔 7개 (프릴과 함께 움직여야 하므로 머리 그룹)
  for (let i = 0; i < 7; i++) {
    const a = -1.15 + (i / 6) * 2.3;
    const r = 0.335;
    parts.push({
      kind: 'cone',
      pos: [0.36 + Math.sin(a) * 0.02, 0.68 + Math.cos(a) * r, Math.sin(a) * r],
      rot: [-a, 0, 0],
      scale: [0.06, 0.13, 0.06],
      color: C.boneDark,
      seg: 4,
      limb: headId,
    });
  }
  return parts;
}

function ptera(rig: RigBuilder): PartSpec[] {
  // 공중 유닛 — 몸 중심 y≈0.35, 뷰가 고도 1.6을 더한다
  const body = 0xd98a5a;
  const wing = 0xc06a3e;
  const wingDark = 0x9c5330;
  const crest = 0xe8c060;
  /** 한쪽 날개: 앞가장자리 뼈 + 이어붙인 막 + 손가락 살 */
  const halfWing = (s: number): PartSpec[] => {
    // 스팬 스테이션: z, 앞전 x, 뒷전 x, 처짐 y (바깥으로 갈수록 처지고 뒤로 젖혀짐)
    const st: Array<[number, number, number, number]> = [
      [0.08, 0.17, -0.16, 0.4],
      [0.34, 0.15, -0.26, 0.42],
      [0.6, 0.09, -0.26, 0.4],
      [0.85, 0.0, -0.2, 0.34],
      [1.06, -0.12, -0.14, 0.26],
    ];
    const out: PartSpec[] = [];
    for (let i = 0; i < st.length - 1; i++) {
      const [z0, l0, t0, y0] = st[i]!;
      const [z1, l1, t1, y1] = st[i + 1]!;
      const c0 = l0 - t0;
      const c1 = l1 - t1;
      const chord = (c0 + c1) / 2 + 0.04;
      out.push(
        link(
          [(l0 + t0) / 2, y0, z0 * s],
          [(l1 + t1) / 2, y1, z1 * s],
          chord,
          0.035,
          i >= 3 ? wingDark : wing,
          { pad: 0.05, hueJitter: 0.015 },
        ),
      );
      // 앞전 뼈
      out.push(link([l0, y0 + 0.018, z0 * s], [l1, y1 + 0.018, z1 * s], 0.06 - i * 0.009, 0.055 - i * 0.007, body, { pad: 0.03 }));
      // 손가락 살 (막을 가로지르는 뼈)
      out.push(link([l1, y1 + 0.022, z1 * s], [t1 + 0.02, y1 - 0.012, z1 * s * 0.95], 0.035, 0.03, wingDark, { pad: 0.02 }));
    }
    out.push({ kind: 'cone', pos: [0.15, 0.42, 0.34 * s], rot: [0, -0.6 * s, -HALF_PI], scale: [0.03, 0.1, 0.03], color: C.boneDark, seg: 4 });
    return out;
  };
  // 날갯짓: 어깨(+z/−z)를 피벗으로 x축 둘레 회전. 다리와 같은 pair 규칙(축 공통 + 위상 π)이라
  // 양 날개가 대칭으로 오르내린다. 0.42 tile 마다 한 번 — 몸통 보브는 enemyview 가 맞춘다.
  const [wingL, wingR] = rig.pair([0.02, 0.4, 0.06], [1, 0, 0], { amp: 0.42 });
  rig.setCycle(0.42);
  const tailId = rig.add([-0.2, 0.35, 0], [0, 1, 0], { amp2: 0.09 });
  return [
    // 몸통 + 목 + 꼬리
    ...tubeW([[-0.22, 0.34, 0], [-0.06, 0.36, 0], [0.08, 0.38, 0], [0.2, 0.38, 0]], [0.14, 0.2, 0.2, 0.15], body, {
      flat: 0.95,
      hueJitter: 0.015,
    }),
    ...tube([[-0.18, 0.31, 0], [0.08, 0.32, 0]], 0.15, 0.12, 0xf0c9a0, { flat: 0.55 }),
    ...tag(tailId, tube(arc([-0.2, 0.35, 0], [-0.38, 0.34, 0], [-0.54, 0.27, 0], 4), 0.1, 0.025, body, { kind: 'cyl', seg: 5 })),
    ...tube(arc([0.18, 0.39, 0], [0.3, 0.44, 0], [0.36, 0.47, 0], 3), 0.11, 0.09, body, { kind: 'cyl', seg: 5 }),
    // 머리 + 긴 부리
    { kind: 'box', pos: [0.42, 0.475, 0], scale: [0.14, 0.12, 0.115], color: body },
    ...tube([[0.47, 0.455, 0], [0.63, 0.425, 0], [0.79, 0.398, 0]], 0.085, 0.018, crest, { flat: 0.9 }),
    { kind: 'box', pos: [0.6, 0.398, 0], scale: [0.26, 0.026, 0.045], color: 0xb8863a },
    // 긴 뒤통수 볏 (얇은 판)
    ...tube([[0.4, 0.54, 0], [0.3, 0.66, 0], [0.18, 0.73, 0]], 0.1, 0.03, 0xb84a2e, { flat: 0.3 }),
    { kind: 'box', pos: [0.33, 0.63, 0], rot: [0, 0, 0.75], scale: [0.2, 0.12, 0.035], color: 0xb84a2e },
    ...eyes(0.43, 0.5, 0.057, 0.03, C.black, 0xf6d24a),
    // 꼬리 끝 방향타 + 몸통 줄무늬
    { kind: 'box', pos: [-0.52, 0.29, 0], rot: [0, 0, 0.35], scale: [0.14, 0.11, 0.03], color: 0xb84a2e, limb: tailId },
    ...mirZ([
      { kind: 'box', pos: [-0.06, 0.4, 0.07], scale: [0.05, 0.05, 0.05], color: wingDark },
      { kind: 'box', pos: [0.06, 0.41, 0.075], scale: [0.05, 0.05, 0.05], color: wingDark },
    ]),
    ...tag(wingL, halfWing(1)),
    ...tag(wingR, halfWing(-1)),
    // 다리 (접힌 채)
    ...mirZ([
      link([-0.08, 0.3, 0.08], [-0.17, 0.22, 0.1], 0.05, 0.05, body, { kind: 'cyl', seg: 5, pad: 0.02 }),
      link([-0.17, 0.22, 0.1], [-0.06, 0.16, 0.1], 0.04, 0.04, body, { kind: 'cyl', seg: 5, pad: 0.02 }),
      { kind: 'cone', pos: [-0.02, 0.16, 0.1], rot: [0, 0, -HALF_PI], scale: [0.026, 0.07, 0.026], color: C.boneDark, seg: 4 },
    ]),
  ];
}

function ankylo(rig: RigBuilder): PartSpec[] {
  const shell = 0x6a5a38;
  const shellL = 0x7d6c44;
  const body = 0x9a824a;
  const dark = 0x7a6a40;
  const tailRoot: V3 = [-0.38, 0.31, 0];
  const headRoot: V3 = [0.32, 0.29, 0];
  // 곤봉 꼬리는 무거워서 몸을 한 박자 늦게 따라온다(위상 지연) — y축 스윙이라
  // 높이 변화가 0이라 지면을 뚫을 위험도 없다.
  const tailId = rig.add(tailRoot, [0, 1, 0], { phase: -0.7, amp: 0.16 });
  const headId = rig.add(headRoot, [0, 1, 0], { amp: 0.1 });
  const parts: PartSpec[] = [
    ...tubeW([[-0.4, 0.3, 0], [-0.14, 0.32, 0], [0.12, 0.32, 0], [0.32, 0.3, 0]], [0.36, 0.46, 0.46, 0.36], body, {
      flat: 0.68,
      hueJitter: 0.014,
    }),
    // 머리 (넓적 + 볼 뿔) — 뒤뚱거림에 맞춰 좌우로 같이 돌아간다
    ...tag(headId, [
      { kind: 'box', pos: [0.44, 0.27, 0], scale: [0.24, 0.18, 0.28], color: body },
      { kind: 'box', pos: [0.58, 0.245, 0], scale: [0.1, 0.115, 0.21], color: C.boneDark },
      { kind: 'box', pos: [0.44, 0.37, 0], scale: [0.2, 0.06, 0.24], color: shellL },
      ...eyes(0.47, 0.32, 0.14, 0.033, C.black, 0xe8d29a),
      ...mirZ([
        { kind: 'cone', pos: [0.44, 0.28, 0.16], rot: [-1.1, 0, 0], scale: [0.07, 0.13, 0.07], color: C.bone, seg: 4 },
        { kind: 'cone', pos: [0.42, 0.42, 0.1], rot: [-0.4, 0, -0.3], scale: [0.06, 0.13, 0.06], color: C.bone, seg: 4 },
      ]),
    ]),
    // 짧고 굵은 다리 — 앞뒤를 같은 위상으로 묶으면 한쪽 옆구리가 통째로 나가는
    // 측대보(pace)가 되어 뒤뚱거린다 (대각보행인 trike/boar 와 확실히 구분된다)
    ...legQuad(0.24, 0.24, 0.2, 0.14, dark, 0x5f5232, 0.02, { rig, amp: 0.62, phase: 0 }),
    ...legQuad(-0.28, 0.24, 0.2, 0.15, dark, 0x5f5232, -0.02, { rig, amp: 0.62, phase: 0 }),
    // 꼬리 + 곤봉
    ...tag(tailId, [
      ...tube(arc(tailRoot, [-0.54, 0.33, 0], [-0.68, 0.31, 0], 4), 0.17, 0.1, body, { kind: 'cyl', seg: 6 }),
      { kind: 'ico', pos: [-0.76, 0.32, 0], scale: [0.3, 0.28, 0.28], color: shell },
      { kind: 'ico', pos: [-0.86, 0.31, 0], scale: 0.2, color: shellL },
      ...mirZ([{ kind: 'cone', pos: [-0.78, 0.33, 0.15], rot: [-HALF_PI, 0, 0], scale: [0.08, 0.14, 0.08], color: C.bone, seg: 4 }]),
      { kind: 'cone', pos: [-0.78, 0.46, 0], scale: [0.08, 0.14, 0.08], color: C.bone, seg: 4 },
    ]),
  ];
  // 등갑: 돔 형태로 판 4행 × 3열 + 중앙 스파이크 + 옆구리 스파이크
  for (let r = 0; r < 5; r++) {
    const t = r / 4;
    const x = 0.3 - r * 0.17;
    // 앞뒤 끝이 낮은 돔
    const domeY = 0.45 + Math.sin((1 - Math.abs(t - 0.42) * 1.9) * 1.2) * 0.06;
    const wide = 1 - Math.abs(t - 0.45) * 0.5;
    for (let c = -1; c <= 1; c++) {
      const z = c * 0.2 * wide;
      parts.push({
        kind: 'box',
        pos: [x, domeY - Math.abs(c) * 0.07, z],
        rot: [c * 0.5, 0, 0],
        scale: [0.17, 0.085, c === 0 ? 0.21 : 0.18],
        color: c === 0 ? shellL : shell,
        hueJitter: 0.016,
      });
    }
    parts.push({ kind: 'cone', pos: [x, domeY + 0.07, 0], scale: [0.09, 0.16, 0.09], color: C.bone, seg: 4 });
    parts.push(
      ...mirZ([
        { kind: 'cone', pos: [x, 0.34, 0.33 * wide], rot: [-1.5, 0, 0], scale: [0.085, 0.24, 0.085], color: C.bone, seg: 4 },
        { kind: 'box', pos: [x, 0.36, 0.26 * wide], rot: [-0.9, 0, 0], scale: [0.15, 0.06, 0.13], color: shell },
      ]),
    );
  }
  return parts;
}

function boar(rig: RigBuilder): PartSpec[] {
  const body = 0x8a5a3a;
  const bodyL = 0xa8734a;
  const dark = 0x5f3d24;
  const mane = 0x4f3220;
  const neckRoot: V3 = [0.24, 0.38, 0];
  const tailRoot: V3 = [-0.36, 0.38, 0];
  // 짧은 다리로 총총 — 걸음마다(2배 주파수) 머리가 까딱이고 갈기·꼬리가 튄다
  const headId = rig.add(neckRoot, [0, 0, 1], { phase: HALF_PI, amp2: 0.055 });
  const maneId = rig.add([0, 0.42, 0], [1, 0, 0], { amp2: 0.18 });
  const tailId = rig.add(tailRoot, [0, 1, 0], { amp2: 0.2 });
  const parts: PartSpec[] = [
    // 앞이 높고 뒤가 낮은 멧돼지 실루엣
    ...tubeW([[-0.34, 0.32, 0], [-0.14, 0.36, 0], [0.06, 0.4, 0], [0.22, 0.4, 0]], [0.24, 0.3, 0.34, 0.3], body, {
      flat: 1.0,
      hueJitter: 0.014,
    }),
    ...tube([[-0.28, 0.22, 0], [0.16, 0.24, 0]], 0.24, 0.24, bodyL, { flat: 0.55 }),
    ...tag(headId, [
      // 목 → 머리 (쐐기꼴로 좁아짐)
      ...tubeW([[0.24, 0.39, 0], [0.34, 0.35, 0], [0.44, 0.31, 0]], [0.28, 0.22, 0.17], body, { flat: 1.05 }),
      { kind: 'box', pos: [0.52, 0.29, 0], scale: [0.13, 0.14, 0.14], color: body },
      { kind: 'cyl', pos: [0.6, 0.28, 0], rot: [0, 0, HALF_PI], scale: [0.12, 0.06, 0.12], color: 0xd9a06a, seg: 6 },
      ...mirZ([{ kind: 'box', pos: [0.63, 0.29, 0.035], scale: [0.02, 0.03, 0.025], color: C.black }]),
      ...eyes(0.42, 0.37, 0.095, 0.032, C.black, 0xe8c08a),
      // 귀
      ...mirZ([{ kind: 'cone', pos: [0.34, 0.47, 0.1], rot: [0.45, 0, -0.25], scale: [0.09, 0.15, 0.05], color: dark }]),
      // 엄니 (아래에서 위로 휘는 2단)
      ...mirZ([
        link([0.54, 0.245, 0.075], [0.62, 0.31, 0.09], 0.045, 0.045, C.bone, { kind: 'cyl', seg: 5, pad: 0.01 }),
        link([0.62, 0.31, 0.09], [0.63, 0.41, 0.08], 0.04, 0.04, C.bone, { kind: 'cone', seg: 5 }),
      ]),
      // 목주름 (머리와 같이 움직여야 이음매가 안 벌어진다)
      ...mirZ([{ kind: 'box', pos: [0.34, 0.45, 0.07], rot: [0, 0, -0.3], scale: [0.05, 0.05, 0.05], color: 0x74492c }]),
    ]),
    // 다리 — 대각보행. 앞다리가 길어(0.26 vs 0.22) 뒷다리 진폭을 키워 보폭을 맞춘다.
    // 갈라진 발굽은 extra 로 넘겨야 다리와 같이 움직인다.
    ...legQuad(0.16, 0.14, 0.26, 0.09, dark, C.black, 0.03, { rig, amp: 0.55, phase: 0 }, [
      { kind: 'box', pos: [0.2, 0.012, 0.152], scale: [0.1, 0.024, 0.05], color: C.black },
    ]),
    ...legQuad(-0.24, 0.13, 0.22, 0.085, dark, C.black, -0.03, { rig, amp: 0.666, phase: Math.PI }, [
      { kind: 'box', pos: [-0.2, 0.012, 0.142], scale: [0.09, 0.024, 0.045], color: C.black },
    ]),
    // 옆구리 주름
    ...mirZ([
      { kind: 'box', pos: [-0.06, 0.3, 0.16], rot: [0, 0, 0.25], scale: [0.06, 0.16, 0.04], color: 0x74492c },
      { kind: 'box', pos: [-0.18, 0.3, 0.14], rot: [0, 0, 0.25], scale: [0.05, 0.14, 0.04], color: 0x74492c },
    ]),
    // 꼬리
    ...tag(tailId, [
      ...tube(arc(tailRoot, [-0.46, 0.4, 0], [-0.48, 0.28, 0], 3), 0.045, 0.025, mane, { kind: 'cyl', seg: 4 }),
      { kind: 'cone', pos: [-0.49, 0.24, 0], rot: [0, 0, Math.PI], scale: [0.06, 0.09, 0.05], color: mane, seg: 4 },
    ]),
  ];
  // 갈기: 목~등 능선의 뻣뻣한 털 — 등뼈 축으로 좌우로 털썩인다
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const x = 0.3 - t * 0.6;
    const yTop = 0.46 + (1 - t) * 0.1;
    const h = 0.2 - Math.abs(t - 0.2) * 0.13;
    parts.push({ kind: 'cone', pos: [x, yTop + h * 0.35, 0], rot: [0, 0, -0.3 - t * 0.35], scale: [0.05, h, 0.05], color: mane, seg: 4, limb: maneId });
    if (i % 2 === 0) {
      parts.push(
        ...tag(
          maneId,
          mirZ([{ kind: 'cone', pos: [x, yTop - 0.03, 0.08], rot: [0.35, 0, -0.5], scale: [0.04, h * 0.7, 0.04], color: mane, seg: 4 }]),
        ),
      );
    }
  }
  return parts;
}

function warrior(rig: RigBuilder): PartSpec[] {
  const skin = C.skin;
  const cloth = 0xb85c2e;
  const hide = 0x8a4a2e;
  const hair = 0x3a2a1c;
  const hip: V3 = [0, 0.42, 0.085];
  // 사람 걸음: 다리 교차 + **반대쪽 팔**. 방패 팔이 +z(좌), 곤봉 팔이 −z(우)라
  // 좌측 다리(위상 0)의 반대인 방패 팔에 위상 π를 준다.
  const [legL, legR] = rig.leg(hip, { amp: 0.4 });
  const shieldArm = rig.add([0, 0.76, 0.16], [0, 0, 1], {
    phase: Math.PI,
    amp: 0.24,
    role: ATK_ROLE_OFF,
  });
  // 곤봉은 어깨 뒤로 넘겨 든 무거운 돌덩이라 진폭을 줄인다
  const clubArm = rig.add([0, 0.76, -0.16], [0, 0, 1], { amp: 0.14, role: ATK_ROLE_MAIN });
  /**
   * 부족 전사의 공격 — **큰 돌을 던진다** (변형이 없는 종이라 포즈 슬롯 0).
   *
   * 데이터상 warrior 는 사거리 2.2 의 원거리다(data/enemies.ts). 정지 거리
   * SIEGE_ENGAGE_RANGE(1.7)에서 곤봉(닿는 길이 0.6 남짓)으로는 타워에 절대 못 닿으므로
   * 근접 내려치기로 그리면 **허공을 때리는 그림**이 된다 — 실제로 그것이 이번 요청의
   * 발단이었다. 그래서 곤봉 팔의 큰 호를 그대로 '던지는 팔'로 쓴다:
   *   back +0.6 → 곤봉이 등 뒤로 더 넘어가 몸이 감긴다
   *   fwd −2.0 → 곤봉이 머리 앞 위로 넘어오며 그 궤적 끝에서 돌이 나간다
   * 방패 팔은 앞으로 세워 몸을 가린다 — 던지는 반동을 받치는 자세이자,
   * 정지 사격 중 타워 반격 앞에 서 있는 이유를 만들어 준다.
   */
  rig.attack(0, [
    { role: ATK_ROLE_MAIN, back: 0.6, fwd: -2.0 },
    { role: ATK_ROLE_OFF, back: -0.28, fwd: 0.6, take: 0.95 },
  ]);
  const parts: PartSpec[] = [
    // 다리 2단 + 발
    ...mirLimb(
      [
        link([0, 0.42, 0.085], [0.01, 0.24, 0.09], 0.11, 0.11, hide, { kind: 'cyl', seg: 6, pad: 0.04 }),
        link([0.01, 0.24, 0.09], [0.0, 0.06, 0.09], 0.09, 0.09, skin, { kind: 'cyl', seg: 6, pad: 0.04 }),
        { kind: 'box', pos: [0.03, 0.03, 0.09], scale: [0.17, 0.06, 0.11], color: C.hideDark },
      ],
      legL,
      legR,
    ),
    // 허리옷 + 몸통 (가슴이 넓은 사다리꼴)
    { kind: 'cyl', pos: [0, 0.46, 0], scale: [0.3, 0.16, 0.32], color: cloth, seg: 7, hueJitter: 0.015 },
    ...tubeW([[0, 0.5, 0], [0, 0.62, 0], [0, 0.74, 0]], [0.24, 0.28, 0.3], skin, { flat: 0.9, hueJitter: 0.012 }),
    // 어깨 + 가죽 띠
    ...mirZ([{ kind: 'cyl', pos: [0, 0.75, 0.13], rot: [HALF_PI, 0, 0], scale: [0.15, 0.08, 0.15], color: skin, seg: 6 }]),
    { kind: 'box', pos: [-0.03, 0.68, 0], rot: [0, 0, 0.15], scale: [0.13, 0.22, 0.34], color: C.hide },
    { kind: 'box', pos: [0.0, 0.79, 0], scale: [0.2, 0.06, 0.36], color: C.hideDark },
    // 목 + 머리 (작게)
    { kind: 'cyl', pos: [0, 0.84, 0], scale: [0.1, 0.08, 0.1], color: skin, seg: 6 },
    { kind: 'box', pos: [0.005, 0.93, 0], scale: [0.17, 0.17, 0.18], color: skin, hueJitter: 0.01 },
    { kind: 'box', pos: [0.08, 0.915, 0], scale: [0.06, 0.07, 0.09], color: skin },
    { kind: 'box', pos: [0.072, 0.877, 0], scale: [0.05, 0.032, 0.11], color: 0x6a4028 },
    { kind: 'box', pos: [0.078, 0.886, 0], scale: [0.04, 0.012, 0.09], color: C.white },
    ...eyes(0.075, 0.955, 0.05, 0.028),
    { kind: 'box', pos: [0.075, 0.985, 0], scale: [0.05, 0.025, 0.17], color: hair },
    ...mirZ([{ kind: 'box', pos: [-0.02, 0.93, 0.095], scale: [0.13, 0.11, 0.03], color: hair }]),
    // 투구 (가죽 + 뼈 테 + 깃털)
    { kind: 'cyl', pos: [-0.01, 1.025, 0], scale: [0.21, 0.09, 0.22], color: hair, seg: 7 },
    { kind: 'cyl', pos: [-0.01, 1.06, 0], scale: [0.15, 0.06, 0.16], color: 0x4a3624, seg: 6 },
    ...mirZ([link([-0.02, 1.03, 0.1], [0.05, 1.13, 0.14], 0.04, 0.04, C.bone, { kind: 'cone', seg: 4, pad: 0.01 })]),
    { kind: 'cone', pos: [-0.05, 1.15, 0], rot: [0, 0, 0.35], scale: [0.05, 0.16, 0.03], color: 0xe0512e, seg: 4 },
    { kind: 'cone', pos: [-0.09, 1.13, 0.04], rot: [0.3, 0, 0.6], scale: [0.045, 0.13, 0.03], color: 0xf0b840, seg: 4 },
  ];
  // 방패 팔 (앞쪽) + 방패 — 방패까지 한 그룹이라야 팔에서 떨어져 나가지 않는다
  parts.push(
    ...tag(shieldArm, [
      link([0.04, 0.74, 0.16], [0.15, 0.62, 0.16], 0.09, 0.09, skin, { kind: 'cyl', seg: 6, pad: 0.03 }),
      link([0.15, 0.62, 0.16], [0.2, 0.54, 0.09], 0.075, 0.075, skin, { kind: 'cyl', seg: 6, pad: 0.03 }),
      // 방패: 나무판 → 테두리 → 돌 보스
      { kind: 'cyl', pos: [0.25, 0.58, 0.03], rot: [0, 0, HALF_PI], scale: [0.42, 0.05, 0.42], color: C.woodDark, seg: 7 },
      { kind: 'cyl', pos: [0.28, 0.58, 0.03], rot: [0, 0, HALF_PI], scale: [0.36, 0.055, 0.36], color: C.wood, seg: 7, hueJitter: 0.02 },
      { kind: 'cyl', pos: [0.31, 0.58, 0.03], rot: [0, 0, HALF_PI], scale: [0.14, 0.05, 0.14], color: C.stoneDark, seg: 6 },
      { kind: 'cone', pos: [0.35, 0.58, 0.03], rot: [0, 0, -HALF_PI], scale: [0.12, 0.1, 0.12], color: C.stone, seg: 5 },
    ]),
  );
  // 방패 문양 — 방사 4갈래 + 리벳 6
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push({
      kind: 'box',
      pos: [0.305, 0.58 + Math.cos(a) * 0.12, 0.03 + Math.sin(a) * 0.12],
      rot: [-a, 0, 0],
      scale: [0.025, 0.13, 0.05],
      color: C.banner,
      limb: shieldArm,
    });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    parts.push({
      kind: 'ico',
      pos: [0.295, 0.58 + Math.cos(a) * 0.185, 0.03 + Math.sin(a) * 0.185],
      scale: 0.05,
      color: C.boneDark,
      limb: shieldArm,
    });
  }
  // 곤봉 팔 (뒤쪽) — 어깨 뒤로 넘겨 든 돌곤봉
  parts.push(
    ...tag(clubArm, [
      link([-0.04, 0.75, -0.16], [-0.16, 0.66, -0.23], 0.09, 0.09, skin, { kind: 'cyl', seg: 6, pad: 0.03 }),
      link([-0.16, 0.66, -0.23], [-0.22, 0.74, -0.3], 0.075, 0.075, skin, { kind: 'cyl', seg: 6, pad: 0.03 }),
      link([-0.14, 0.6, -0.26], [-0.36, 0.9, -0.34], 0.055, 0.055, C.wood, { kind: 'cyl', seg: 5, pad: 0.02 }),
      { kind: 'ico', pos: [-0.4, 0.95, -0.36], scale: [0.22, 0.24, 0.22], color: C.stone },
    ]),
  );
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push({
      kind: 'cone',
      pos: [-0.4 + Math.cos(a) * 0.1, 0.95 + Math.sin(a) * 0.11, -0.36],
      rot: [0, 0, a - HALF_PI],
      scale: [0.055, 0.11, 0.055],
      color: C.boneDark,
      seg: 4,
      limb: clubArm,
    });
  }
  return parts;
}

function shaman(rig: RigBuilder): PartSpec[] {
  const robe = 0x8a4a9e;
  const robeDark = 0x6a3a7a;
  const staffX = 0.3;
  const staffZ = 0.32;
  const hand: V3 = [staffX, 0.6, staffZ];
  // 로브가 다리를 완전히 가리는 종 — 걸음은 **밑단 흔들림 + 지팡이 짚는 리듬**으로 낸다.
  // 밑단은 지면에 닿으므로 ground 그룹으로 등록한다: 접지 테이블이 자동으로
  // "밑단이 기울어진 만큼 몸을 든다" → 로브가 땅을 파고들지 않으면서 걸음 바운스가 생긴다.
  const hemId = rig.add([0, 0.62, 0], [0, 0, 1], { amp: 0.1 }, true);
  // 지팡이는 손을 피벗으로 걸음마다 한 번 짚는다(2배 주파수)
  const staffId = rig.add(hand, [0, 0, 1], { amp2: 0.075 });
  const armId = rig.add([0.02, 0.7, -0.14], [0, 0, 1], { amp: 0.15 });
  rig.setCycle(0.62); // 다리가 없으므로 1주기 이동거리를 직접 지정
  const parts: PartSpec[] = [
    // 로브 — 아래로 퍼지는 층 5단 (각진 원뿔대). 아래 3단이 흔들리는 밑단.
    { kind: 'cyl', pos: [0, 0.06, 0], scale: [0.5, 0.12, 0.5], color: robeDark, seg: 7, hueJitter: 0.018, limb: hemId },
    { kind: 'cyl', pos: [0, 0.2, 0], scale: [0.44, 0.18, 0.44], color: robe, seg: 7, hueJitter: 0.018, limb: hemId },
    { kind: 'cyl', pos: [0, 0.37, 0], scale: [0.36, 0.2, 0.36], color: robeDark, seg: 7, hueJitter: 0.018, limb: hemId },
    { kind: 'cyl', pos: [0, 0.53, 0], scale: [0.3, 0.18, 0.3], color: robe, seg: 7, hueJitter: 0.018 },
    { kind: 'cyl', pos: [0, 0.66, 0], scale: [0.26, 0.12, 0.26], color: robeDark, seg: 6 },
    // 어깨 깃털 목도리
    { kind: 'cyl', pos: [0, 0.72, 0], scale: [0.31, 0.06, 0.31], color: 0xe8d2a0, seg: 7 },
    // 머리 + 뼈 가면
    { kind: 'box', pos: [0, 0.83, 0], scale: [0.2, 0.2, 0.2], color: C.skin, hueJitter: 0.01 },
    { kind: 'box', pos: [0.085, 0.83, 0], scale: [0.08, 0.19, 0.2], color: C.bone },
    ...mirZ([{ kind: 'box', pos: [0.13, 0.86, 0.05], scale: [0.025, 0.045, 0.05], color: C.black }]),
    { kind: 'box', pos: [0.115, 0.755, 0], scale: [0.06, 0.05, 0.14], color: C.boneDark },
    // 가면 뿔 + 깃털관
    ...mirZ([link([0.03, 0.92, 0.09], [0.1, 1.06, 0.16], 0.05, 0.05, C.bone, { kind: 'cone', seg: 5, pad: 0.01 })]),
    { kind: 'box', pos: [-0.02, 0.94, 0], scale: [0.2, 0.06, 0.22], color: 0x4a2a56 },
    // 지팡이 (몸 옆으로 비켜 세운 2마디 + 해골) — 손을 피벗으로 통째로 짚는다
    ...tag(staffId, [
      link([staffX - 0.08, 0.02, staffZ - 0.02], [staffX, 0.52, staffZ], 0.045, 0.045, C.woodDark, { kind: 'cyl', seg: 5 }),
      link([staffX, 0.52, staffZ], [staffX + 0.02, 0.96, staffZ + 0.01], 0.04, 0.04, C.wood, { kind: 'cyl', seg: 5 }),
      { kind: 'box', pos: [staffX, 0.52, staffZ], scale: [0.07, 0.05, 0.07], color: C.rope },
      { kind: 'ico', pos: [staffX + 0.03, 1.04, staffZ + 0.01], scale: [0.18, 0.17, 0.16], color: 0x6ff2c8 },
      { kind: 'ico', pos: [staffX + 0.08, 0.98, staffZ + 0.01], scale: 0.1, color: 0x4fd0a8 },
      ...pairZ([{ kind: 'box', pos: [staffX + 0.1, 1.05, staffZ + 0.06], scale: [0.03, 0.035, 0.035], color: C.black }], staffZ + 0.01),
    ]),
  ];
  // 지팡이 깃털 다발
  for (let i = 0; i < 4; i++) {
    const a = -0.6 + i * 0.4;
    parts.push({
      kind: 'cone',
      pos: [staffX + Math.sin(a) * 0.05, 0.9 - i * 0.02, staffZ + Math.cos(a) * 0.08],
      rot: [a * 0.6, 0, 2.5 + i * 0.1],
      scale: [0.035, 0.16, 0.02],
      color: i % 2 === 0 ? 0xe0512e : 0xf0b840,
      seg: 4,
      limb: staffId,
    });
  }
  // 부적 (허리 구슬 목걸이)
  for (let i = 0; i < 7; i++) {
    const a = -1.2 + (i / 6) * 2.4;
    parts.push({
      kind: 'ico',
      pos: [Math.cos(a) * 0.21, 0.665 - Math.abs(i - 3) * 0.012, Math.sin(a) * 0.21],
      scale: 0.055,
      color: i % 2 === 0 ? C.bone : C.gold,
    });
  }
  // 로브 주름 — 아래로 흐르는 세로 판 + 밑단 술 (밑단 그룹과 함께 흔들린다)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.25;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    parts.push({
      kind: 'box',
      pos: [cs * 0.21, 0.24, sn * 0.21],
      rot: [0, -a, 0],
      scale: [0.055, 0.36, 0.14],
      color: i % 2 === 0 ? robe : robeDark,
      hueJitter: 0.02,
      limb: hemId,
    });
    parts.push({
      kind: 'cone',
      pos: [cs * 0.245, 0.05, sn * 0.245],
      rot: [0, -a, Math.PI],
      scale: [0.055, 0.09, 0.055],
      color: C.rope,
      seg: 4,
      limb: hemId,
    });
  }
  // 팔 (지팡이 쥔 손 + 반대쪽). 쥔 손은 지팡이 피벗이라 고정, 반대쪽만 흔든다.
  parts.push(
    link([0.04, 0.68, 0.15], [0.18, 0.62, 0.24], 0.07, 0.07, robe, { kind: 'cyl', seg: 5, pad: 0.02 }),
    link([0.18, 0.62, 0.24], hand, 0.06, 0.06, C.skin, { kind: 'cyl', seg: 5, pad: 0.02 }),
    ...tag(armId, [
      link([0.02, 0.68, -0.14], [0.11, 0.52, -0.21], 0.07, 0.07, robe, { kind: 'cyl', seg: 5, pad: 0.02 }),
      { kind: 'ico', pos: [0.13, 0.48, -0.22], scale: 0.075, color: C.skin },
    ]),
  );
  return parts;
}

// --- 부족 습격대 4종 (blade / lancer / archer / hexer) -----------------------
/**
 * 작고 귀여운 사람 무리. 공룡들 사이에서 **한눈에 "작은 사람"** 으로 읽혀야 해서
 * 키 0.68 (warrior 1.15, raptor 0.85 의 절반 남짓) · 2.5등신 (머리가 몸통보다 크다)로 잡았다.
 *
 * 4종은 **몸통·팔다리·머리를 공유**하고 (머리장식 / 무기 / 염료색)만 다르다.
 * 이유는 두 가지다.
 *  1) 성능: 종마다 InstancedMesh 를 두면 4종이 동시에 화면에 있을 때 컬러+그림자로
 *     드로우콜이 +8 이 되어 예산(60)을 넘긴다. 공유 지오메트리 + 변형 마스킹으로
 *     4종이 **한 메시 = +2 콜**로 끝난다 (factory.ts PartSpec.variant / gait.ts 참조).
 *  2) 연출: 이들은 개별 몬스터가 아니라 **한 부족의 습격대**다. 같은 체형에 무기와
 *     염료만 다른 편이 "같은 마을에서 몰려나온 무리"로 읽힌다.
 *
 * 구분은 전적으로 **머리 실루엣 + 무기 실루엣 + 염료색** 세 축이 맡는다:
 *   blade  머리띠 · 등에 멘 투창 다발 + 던지는 투창 · 붉은 염료
 *   lancer 투구   · 긴 창 + 둥근 방패 · 청록 염료
 *   archer 두건   · 활 + 등에 멘 화살통 · 이끼 초록
 *   hexer  뼈가면+뿔 · 발광 지팡이   · 남보라 + 마젠타 발광
 */
const RAIDER_SKIN = 0xe0a878;
const RAIDER_HIDE = 0xa8703f;
const RAIDER_HIDE_D = 0x7d5230;
const RAIDER_HAIR = 0x3a2a1c;

interface RaiderIds {
  armL: number;
  armR: number;
  head: number;
  /** 주무기 손에서 **던져 나가는** 물건 전용 그룹 (armR 과 같이 움직이다 놓는 순간 사라진다) */
  throwR: number;
  /** 보조 손에서 던져 나가는 물건 (궁수의 메긴 화살) */
  throwL: number;
}

/** 4종 공용 몸통 — 다리·팔·머리 리그를 여기서 전부 등록한다 */
function raiderBody(rig: RigBuilder): { parts: PartSpec[]; ids: RaiderIds } {
  const skin = RAIDER_SKIN;
  const hip: V3 = [0, 0.205, 0.072];
  // 짧고 굵은 다리 = 짧은 보폭(1주기 0.35타일) = 총총거리는 걸음.
  // 작고 귀여운 인상의 절반은 여기서 나온다 — 다리가 길면 곧바로 '작은 어른'이 된다.
  const [legL, legR] = rig.leg(hip, { amp: 0.44 });
  // 사람 걸음은 다리와 **반대쪽** 팔이 나간다. 좌측 다리가 위상 0 이므로 좌측 팔에 π 를 준다.
  // 공격 배역: −z(우)팔이 무기를 놓는 손(MAIN), +z(좌)팔이 보조(OFF).
  // 궁수만 반대로 쓰지만(활이 좌, 시위가 우) 배역은 **자리 이름**일 뿐이라 포즈 표에서
  // 값만 뒤집으면 된다 — 팔 정점이 4종 공통이라 정점 태그로는 갈 수 없기 때문이다.
  const [armL, armR] = rig.pair([0, 0.42, 0.105], [0, 0, 1], { phase: Math.PI, amp: 0.34 });
  rig.setRole(armL, ATK_ROLE_OFF);
  rig.setRole(armR, ATK_ROLE_MAIN);
  // 큰 머리가 걸음마다 까딱인다(2배 주파수) — 2.5등신에서 가장 눈에 띄는 2차 모션
  const head = rig.add([0, 0.45, 0], [0, 0, 1], { phase: HALF_PI, amp2: 0.06, role: ATK_ROLE_HEAD });
  /**
   * 던져 나가는 물건 전용 그룹 — 팔과 **완전히 같은 피벗·축·위상·진폭**이라
   * 걷는 동안에는 팔에 붙어 있는 것과 구별되지 않는다. 다른 것은 단 하나,
   * 놓는 순간 접혀 사라진다는 점이다(gait.ts throwAway). 손목이 없는 강체 팔에서
   * 던진 창이 뒤집히지 않게 하는 유일한 방법이고, 정점 비용은 0이다.
   * pair() 가 좌(+z) 위상 π · 우(−z) 위상 2π 를 주므로 그대로 맞춘다.
   */
  const throwR = rig.add([0, 0.42, -0.105], [0, 0, 1], {
    phase: Math.PI * 2,
    amp: 0.34,
    role: ATK_ROLE_MAIN,
    throwAway: true,
  });
  const throwL = rig.add([0, 0.42, 0.105], [0, 0, 1], {
    phase: Math.PI,
    amp: 0.34,
    role: ATK_ROLE_OFF,
    throwAway: true,
  });
  const parts: PartSpec[] = [
    // 다리 (허벅지 가죽 / 맨 정강이 / 가죽신) — 굵고 짧게
    ...mirLimb(
      [
        link([0, 0.205, 0.072], [0.006, 0.115, 0.078], 0.092, 0.092, RAIDER_HIDE, { kind: 'cyl', seg: 5, pad: 0.03 }),
        link([0.006, 0.115, 0.078], [0, 0.045, 0.078], 0.076, 0.076, skin, { kind: 'cyl', seg: 5, pad: 0.03 }),
        { kind: 'box', pos: [0.032, 0.023, 0.078], scale: [0.13, 0.046, 0.095], color: RAIDER_HIDE_D },
      ],
      legL,
      legR,
    ),
    // 허리 가죽
    { kind: 'cyl', pos: [0, 0.245, 0], scale: [0.225, 0.11, 0.235], color: RAIDER_HIDE, seg: 6, hueJitter: 0.015 },
    // 몸통 (작게 — 머리를 크게 보이게 하는 건 몸통을 줄이는 쪽이다).
    // 맨살로 두는 이유: 종별 kit 이 이 위에 자기 염료색 조끼를 덧입혀 색을 가져간다.
    ...tubeW([[0, 0.285, 0], [0, 0.36, 0], [0, 0.44, 0]], [0.195, 0.205, 0.18], skin, {
      flat: 0.95,
      hueJitter: 0.012,
    }),
    { kind: 'box', pos: [0, 0.458, 0], scale: [0.085, 0.05, 0.09], color: skin },
    // 머리 — 몸 전체의 1/3이 넘는 큰 두상 + 큰 눈
    ...tag(head, [
      { kind: 'box', pos: [0.008, 0.568, 0], scale: [0.245, 0.235, 0.235], color: skin, hueJitter: 0.01 },
      { kind: 'box', pos: [0.133, 0.552, 0], scale: [0.062, 0.058, 0.065], color: skin },
      { kind: 'box', pos: [0.125, 0.497, 0], scale: [0.052, 0.026, 0.095], color: 0x7a4530 },
      ...eyes(0.115, 0.607, 0.07, 0.047),
      { kind: 'box', pos: [-0.11, 0.578, 0], scale: [0.058, 0.21, 0.222], color: RAIDER_HAIR },
    ]),
    // 팔 (상박/하박/손) — 무기는 종별 kit 가 이 그룹에 얹는다
    ...mirLimb(
      [
        link([0, 0.42, 0.105], [0.03, 0.335, 0.122], 0.062, 0.062, skin, { kind: 'cyl', seg: 4, pad: 0.025 }),
        link([0.03, 0.335, 0.122], [0.08, 0.262, 0.118], 0.054, 0.054, skin, { kind: 'cyl', seg: 4, pad: 0.025 }),
        { kind: 'box', pos: [0.1, 0.244, 0.118], scale: [0.066, 0.06, 0.066], color: skin },
      ],
      armL,
      armR,
    ),
  ];
  return { parts, ids: { armL, armR, head, throwR, throwL } };
}

/**
 * 종별 염료 조끼 — 맨살 몸통 위에 덧입히는 한 겹.
 * 게임 줌에서는 유닛이 20px 남짓이라 무기 실루엣보다 **몸통 색 덩어리**가 먼저 읽힌다.
 * 4종을 색으로 갈라 주는 가장 싼 수단이고(파트 2개 = 24삼각형) 부족 특유의
 * "염료 들인 가죽옷" 톤도 여기서 나온다.
 */
function raiderVest(dye: number): PartSpec[] {
  return [
    ...tubeW([[0, 0.3, 0], [0, 0.4, 0]], [0.215, 0.205], dye, { flat: 0.96, hueJitter: 0.02 }),
    // 어깨선 — 위에서 내려다보는 카메라라 어깨 윗면이 색 면적을 가장 크게 벌어 준다
    { kind: 'box', pos: [-0.005, 0.437, 0], scale: [0.2, 0.045, 0.245], color: dye, hueJitter: 0.02 },
  ];
}

/**
 * 투창병 — 붉은 머리띠 + 등에 멘 투창 다발 + 던지는 손의 짧은 투창.
 *
 * 원래 돌칼잡이였다. 전원 원거리 개편으로 이 종이 **던지는 종**이 되었으므로
 * 모델도 그렇게 읽혀야 한다 ("칼을 든 놈이 원거리로 때린다"가 화면에서 어긋났다).
 * 두 축으로 갈아탔다:
 *  ① 등에 멘 다발 — 정지 상태에서도 "던질 것을 여러 개 갖고 다닌다"가 보인다.
 *    몸통 고정이라 팔과 따로 놀고, 부감 카메라에서 어깨 위로 창끝 3개가 삐져나온다.
 *  ② 손의 투창 — **어깨에 걸쳐 멘 자세**(2.6rad, 창끝이 뒤로 간다)로 눕혔다.
 *
 * ②의 각도는 눈대중이 아니라 캡처 세 번에서 나온 역산이다. 강체 팔은 어깨 한 축으로만
 * 돌고 손목이 없으니 **창의 방향 = 정지 방향 + 팔 각도**라는 제약이 전부를 정한다.
 *  · 앞으로 낮게 겨눈 자세(0.16rad) → 젖힌 순간 창끝이 뒤통수로 돌아갔다. 탈락.
 *  · 팔 축과 나란히(−1.055rad) → 한 주기 내내 앞선 끝이 바뀌지 않아 뒤집힘은 없앴지만,
 *    **가장 오래 보이는 자세**(쿨다운 내내 유지되는 조준 자세)에서 창이 몸 뒤에 숨어
 *    "겨누고 있다"가 화면에서 사라졌다. 탈락.
 *  · 채택: 2.6rad. 젖힌 자세(−2.5rad)에서 창이 **머리 옆을 지나 앞으로 수평**이 되어
 *    조준이 한눈에 읽히고, 걸을 때는 "창을 어깨에 메고 간다"가 된다. 대가인 뒤집힘은
 *    **던지는 순간 창을 접어 없애서**(gait.ts THROW_GONE, 0.40~0.47) 아예 안 보이게 했다 —
 *    어차피 던진 창은 손에 없어야 맞다.
 * 창 전체를 어깨 피벗에서 반경 0.42(= 어깨 높이) 안에 두어 보행·공격 어느 각도에서도
 * 지면을 찍지 않는다.
 */
function kitBlade(ids: RaiderIds): PartSpec[] {
  const dye = 0xd2492f;
  return [
    ...tag(ids.head, [
      // 머리띠 — y 0.658이면 윗면(0.6855)이 두상 윗면과 **정확히 같은 평면**이라
      // 카메라가 움직일 때마다 z-fighting 으로 반짝인다(사용자 피드백: "머리 윗부분이
      // 반짝거린다"). 0.636으로 내려 두상 안쪽에 두르는 띠로 만든다.
      { kind: 'box', pos: [0.008, 0.636, 0], scale: [0.258, 0.055, 0.25], color: dye, hueJitter: 0.02 },
      { kind: 'cone', pos: [-0.09, 0.74, 0.05], rot: [0.35, 0, 0.6], scale: [0.034, 0.15, 0.024], color: C.gold, seg: 4 },
      // 볼 전투 문양 — 좌우 대칭이라 어느 각도에서도 "칠한 얼굴"이 보인다
      ...mirZ([{ kind: 'box', pos: [0.128, 0.578, 0.088], rot: [0, 0, 0.45], scale: [0.022, 0.075, 0.05], color: dye }]),
    ]),
    ...raiderVest(dye),
    // 등에 멘 투창 다발 (몸통 고정) — 어깨 너머로 창끝이 솟아 '던지는 종'을 예고한다
    { kind: 'cyl', pos: [-0.128, 0.4, 0.055], rot: [0, 0, 0.26], scale: [0.06, 0.3, 0.06], color: RAIDER_HIDE_D, seg: 4 },
    ...mirZ([
      link([-0.16, 0.31, 0.085], [-0.098, 0.7, 0.115], 0.022, 0.022, C.wood, { kind: 'cyl', seg: 3 }),
      { kind: 'cone', pos: [-0.09, 0.735, 0.118], rot: [0, 0, 0.15], scale: [0.046, 0.085, 0.034], color: C.stone, seg: 4 },
    ]),
    // 던지는 손의 투창 — 손(0.1, 0.244, −0.118)을 지나 어깨 뒤 위로 걸쳐 멘다
    ...tag(ids.throwR, [
      link([0.22, 0.172, -0.132], [-0.26, 0.46, -0.132], 0.03, 0.03, C.wood, { kind: 'cyl', seg: 4 }),
      // 자루 감은 가죽 — 손 위치를 눈으로 짚어 준다
      { kind: 'box', pos: [0.1, 0.244, -0.132], rot: [0, 0, -0.54], scale: [0.075, 0.05, 0.05], color: C.rope },
      { kind: 'cone', pos: [-0.325, 0.499, -0.132], rot: [0, 0, 1.029], scale: [0.07, 0.17, 0.04], color: C.stone, seg: 4 },
      // 자루 끝 깃 — 던지기 전후로 손 앞쪽에 형태를 남긴다
      { kind: 'box', pos: [0.245, 0.157, -0.132], rot: [0, 0, -0.54], scale: [0.07, 0.05, 0.018], color: dye },
    ]),
  ];
}

/** 창잡이 — 투구 + 둥근 방패 + 긴 창 (한 걸음 뒤에서 찌른다) */
function kitLancer(ids: RaiderIds): PartSpec[] {
  const dye = 0x2f8a94;
  return [
    ...tag(ids.head, [
      { kind: 'cyl', pos: [0.008, 0.672, 0], scale: [0.245, 0.085, 0.245], color: dye, seg: 5, hueJitter: 0.02 },
      { kind: 'cone', pos: [0.008, 0.742, 0], scale: [0.1, 0.105, 0.1], color: C.boneDark, seg: 5 },
      { kind: 'box', pos: [0.126, 0.638, 0], scale: [0.07, 0.05, 0.215], color: C.bone },
    ]),
    ...raiderVest(dye),
    // 방패 (왼팔) — 나무판 + 염료 테 + 돌 보스
    ...tag(ids.armL, [
      { kind: 'cyl', pos: [0.148, 0.295, 0.158], rot: [0, 0, HALF_PI], scale: [0.32, 0.035, 0.32], color: C.woodDark, seg: 6 },
      { kind: 'cyl', pos: [0.167, 0.295, 0.158], rot: [0, 0, HALF_PI], scale: [0.235, 0.032, 0.235], color: dye, seg: 6, hueJitter: 0.02 },
      { kind: 'cone', pos: [0.188, 0.295, 0.158], rot: [0, 0, -HALF_PI], scale: [0.085, 0.065, 0.085], color: C.stone, seg: 5 },
    ]),
    /**
     * 큰창 (오른팔) — blade 의 투창과 **같은 걸침 각(2.6rad)** 에 눕히되 더 길고 굵고
     * 뼈촉이다. 각을 맞추는 이유는 미학이 아니라 역학이다(kitBlade 주석의 역산 참조).
     * 예전에는 수직으로 세워 들었는데 그 자세로 던지면 창끝이 지면을 찍고 지나갔다.
     * blade(0.56)와의 구분은 길이(0.68)·굵기·뼈촉이 맡고, 부감 실루엣에서는
     * 방패와 청록 염료가 먼저 읽힌다.
     */
    ...tag(ids.throwR, [
      link([0.254, 0.151, -0.138], [-0.329, 0.502, -0.138], 0.042, 0.042, C.wood, { kind: 'cyl', seg: 4 }),
      { kind: 'box', pos: [0.1, 0.244, -0.138], rot: [0, 0, -0.54], scale: [0.08, 0.055, 0.055], color: C.rope },
      { kind: 'cone', pos: [-0.406, 0.548, -0.138], rot: [0, 0, 1.029], scale: [0.075, 0.2, 0.05], color: C.bone, seg: 4 },
    ]),
  ];
}

/** 궁수 — 두건 + 등에 멘 화살통 + 앞으로 든 활 */
function kitArcher(ids: RaiderIds): PartSpec[] {
  const dye = 0x5f8f3a;
  return [
    ...tag(ids.head, [
      { kind: 'box', pos: [0.002, 0.672, 0], scale: [0.255, 0.07, 0.25], color: dye, hueJitter: 0.02 },
      { kind: 'box', pos: [-0.118, 0.6, 0], scale: [0.065, 0.17, 0.215], color: dye, hueJitter: 0.02 },
      ...mirZ([{ kind: 'cone', pos: [-0.06, 0.755, 0.048], rot: [0.4, 0, 0.7], scale: [0.03, 0.14, 0.022], color: C.bone, seg: 4 }]),
    ]),
    ...raiderVest(dye),
    // 등에 비스듬히 멘 화살통 (몸통 고정 — 팔과 따로 논다)
    { kind: 'cyl', pos: [-0.128, 0.375, -0.06], rot: [0, 0, 0.32], scale: [0.095, 0.24, 0.095], color: RAIDER_HIDE_D, seg: 5 },
    ...mirZ([{ kind: 'cone', pos: [-0.165, 0.515, -0.035], rot: [0.15, 0, 0.32], scale: [0.03, 0.11, 0.03], color: C.bone, seg: 4 }]),
    /**
     * 활 (왼팔) — 앞으로 볼록한 호 + 시위 + 메긴 화살.
     *
     * **비스듬히 뉜(cant) 자세**가 핵심이다. 활을 수직으로 세워 들면 호가 놓인 평면이
     * 카메라(내려다보는 55°)와 거의 나란해져 위에서는 호가 **직선 한 줄**로 붙어 버린다 —
     * 실측에서 창(lancer)·지팡이(hexer)와 실루엣이 구분되지 않았다.
     * 시위(A→B)를 z축으로 0.32 눕혀 약 39° 기울이면 호의 곡률이 위에서도 보이고,
     * 몸통 바깥(z 0.03~0.35)으로 빠져 있어 큰 머리에 가려지지도 않는다.
     * 화살은 활을 가로질러 +x(전방)로 뻗어 "쏘는 자세"를 한 번에 읽히게 한다.
     *
     * 최저점의 (x, y)는 예전 값(0.14, ~0.09)을 그대로 두거나 더 올렸다 —
     * 팔 스윙은 z축 회전이라 y가 (x, y)에만 의존하므로 접지 여유가 나빠지지 않는다
     * (tests/render/gait.test.ts 가 전 정점에 대해 잠근다).
     */
    ...tag(ids.armL, [
      ...tube(arc([0.14, 0.1, 0.03], [0.3, 0.3, 0.19], [0.14, 0.5, 0.35], 3), 0.032, 0.026, C.wood, { flat: 1 }),
      link([0.14, 0.1, 0.03], [0.14, 0.5, 0.35], 0.012, 0.012, C.bone, { kind: 'cyl', seg: 3 }),
    ]),
    // 메긴 화살만 **던져 나가는 그룹**에 둔다 — 활은 남고 화살만 시위를 떠난다.
    // (활 팔과 피벗·위상이 같으므로 겨누는 동안에는 활에 붙어 있는 것과 구별되지 않는다)
    ...tag(ids.throwL, [
      link([0.13, 0.3, 0.19], [0.35, 0.3, 0.19], 0.013, 0.013, C.wood, { kind: 'cyl', seg: 3 }),
      { kind: 'cone', pos: [0.383, 0.3, 0.19], rot: [0, 0, -HALF_PI], scale: [0.034, 0.07, 0.034], color: C.bone, seg: 3 },
    ]),
  ];
}

/** 주술사 — 뼈 가면 + 뿔 + 발광 지팡이 (저주를 거는 손) */
function kitHexer(ids: RaiderIds): PartSpec[] {
  /**
   * 염료색 0x5b3a8c → 0xa8228c.
   *
   * 게임 줌(유닛 20~40px)에서는 **색이 식별의 주역**이고 무기 실루엣은 보조다.
   * 예전 값(H≈264°)은 기존 shaman 로브 0x8a4a9e(H≈286°)와 색상환에서 22°밖에
   * 안 떨어져 둘 다 그냥 '보라'로 읽혔다 — 화면에서 주술사 둘을 구분할 수 없었다.
   * 0xa8228c는 H≈314°(마젠타 쪽)로 shaman과 28° 더 벌어지고, 무엇보다
   * **자기가 거는 저주의 색(glow / 침묵 룬 0xd94ad0·0xdb1af2)과 같은 계열**이라
   * "저 마젠타가 타워를 조용하게 만드는 놈"이라는 인과가 색으로 묶인다.
   */
  const dye = 0xa8228c;
  const glow = 0xd94ad0;
  return [
    ...tag(ids.head, [
      // 얼굴을 덮는 뼈 가면 — 눈이 가려져 다른 3종과 인상이 완전히 갈린다
      { kind: 'box', pos: [0.128, 0.572, 0], scale: [0.055, 0.225, 0.225], color: C.bone },
      { kind: 'box', pos: [0.16, 0.605, 0], scale: [0.022, 0.042, 0.145], color: C.black },
      ...mirZ([link([0.03, 0.665, 0.082], [0.11, 0.82, 0.12], 0.04, 0.04, C.bone, { kind: 'cone', seg: 4, pad: 0.01 })]),
    ]),
    ...raiderVest(dye),
    // 등에 드리운 자락 (어깨선은 조끼가 맡는다)
    { kind: 'box', pos: [-0.115, 0.315, 0], scale: [0.05, 0.235, 0.245], color: dye, hueJitter: 0.02 },
    // 지팡이 (오른팔) — 발광 구슬이 마젠타라 shaman(청록 해골 지팡이)과 섞이지 않는다
    ...tag(ids.armR, [
      // 지팡이 밑동은 y=0.055 위로 — 팔 스윙(±0.34rad)에 지팡이가 통째로 돌기 때문에
      // 너무 낮게 잡으면 흔들 때 지면을 찍는다 (tests/render/gait.test.ts 가 잠근다)
      link([0.06, 0.055, -0.145], [0.105, 0.665, -0.145], 0.036, 0.036, C.woodDark, { kind: 'cyl', seg: 4 }),
      { kind: 'box', pos: [0.095, 0.545, -0.145], scale: [0.048, 0.034, 0.055], color: C.rope },
      { kind: 'ico', pos: [0.112, 0.755, -0.145], scale: [0.13, 0.13, 0.12], color: glow },
      { kind: 'cone', pos: [0.109, 0.69, -0.145], scale: [0.065, 0.065, 0.06], color: 0xe8a0e8, seg: 4 },
      { kind: 'cone', pos: [0.055, 0.6, -0.16], rot: [0.5, 0, 2.6], scale: [0.028, 0.12, 0.02], color: C.gold, seg: 4 },
    ]),
  ];
}

/**
 * 습격대 4종의 **공격 포즈** (변형 번호 1~4 = RAIDER_KITS 순서).
 *
 * 팔 정점이 4종 공통이라(raiderBody) 종별 동작을 정점으로 가를 수 없다 — 그래서
 * 인스턴스별 변형 번호 × 배역으로 포즈를 고른다(gait.ts 공격 채널). 각도는 전부
 * 어깨 피벗 둘레의 **z축 회전**이라 보행과 같은 축을 재사용한다(추가 유니폼 0).
 *
 * 각도 감각 (오른팔 손은 정지 시 어깨 아래 (0.1, −0.176)):
 *   −2.5rad → 손이 어깨 뒤 위로 (던지려고 젖힌 자세)
 *   +1.75rad → 손이 머리 앞 위로 (놓는 순간)
 * back 은 **조준 유지 자세이기도 하다** — 멈춰 서 있는 동안 이 각으로 굳으므로
 * "겨누고 있다"가 쿨다운 내내 보인다.
 */
const RAIDER_ATTACKS: readonly (readonly AttackPose[])[] = [
  // 1) 투창병 — 짧은 투창을 어깨 너머로 젖혔다 앞으로 뿌린다. 가장 크고 빠른 동작.
  [
    { role: ATK_ROLE_MAIN, back: -2.5, fwd: 1.75 },
    { role: ATK_ROLE_OFF, back: 0.62, fwd: -0.2, take: 0.9 },
    { role: ATK_ROLE_HEAD, back: 0.12, fwd: -0.2 },
  ],
  // 2) 큰창잡이 — 같은 던지기지만 무겁다. 덜 젖히고 덜 뻗되 방패 팔을 앞으로 세워 버틴다.
  [
    { role: ATK_ROLE_MAIN, back: -2.1, fwd: 1.5 },
    { role: ATK_ROLE_OFF, back: 0.8, fwd: 0.55, take: 0.95 },
    { role: ATK_ROLE_HEAD, back: 0.16, fwd: -0.24 },
  ],
  // 3) 궁수 — 배역이 뒤집힌 유일한 종. MAIN(오른팔)이 **시위를 당겼다 놓고**,
  //    OFF(왼팔)가 활을 앞으로 들어 겨눈 채 유지한다(back≈fwd 라 놓는 순간에도 안 흔들린다).
  [
    { role: ATK_ROLE_MAIN, back: -1.75, fwd: -0.5 },
    { role: ATK_ROLE_OFF, back: 1.3, fwd: 1.24 },
    { role: ATK_ROLE_HEAD, back: 0.06, fwd: -0.12 },
  ],
  // 4) 주술 저주사 — 지팡이를 뒤로 젖혀 들었다가 **앞으로 내질러** 구슬을 타워로 겨눈다.
  //    지팡이 구슬이 어깨 위에 있어 z축 회전으로는 더 들 수 없다 — 젖힘이 곧 '들어올림'이다.
  [
    { role: ATK_ROLE_MAIN, back: 0.62, fwd: -1.15 },
    { role: ATK_ROLE_OFF, back: 0.3, fwd: 0.95, take: 0.9 },
    { role: ATK_ROLE_HEAD, back: 0.22, fwd: -0.28 },
  ],
];

// --- 아군 마을 부족원 4종 (clubber / slinger / guardian / gatherer) ----------
/**
 * 우리 편이라는 게 **한 프레임 안에** 읽혀야 한다. 게임 줌에서 유닛은 20~40px이고,
 * 적 습격대와 몸통·머리·팔다리를 통째로 공유하므로(드로우콜 예산) 구분은 전적으로
 * 장비 kit 이 져야 한다. 두 축을 이렇게 갈랐다:
 *
 * ① 형태 축 — **머리 위쪽을 통째로 가져간다** (장식을 하나 더 얹는 게 아니라)
 *    카메라가 55° 부감이라 유닛에서 화면 면적을 가장 많이 차지하는 면은
 *    **머리 윗면**이다(2.5등신이라 머리가 몸통보다 크다). 적 4종은 그 자리가
 *    전부 "맨 살결 + 머리에 딱 붙는 작은 머리장식"이다 — 즉 위에서 보면
 *    네 종 다 **살구색 덩어리**로 수렴한다.
 *    그래서 아군은 그 자리를 **흰 털 두건**으로 통째로 덮는다(크라운 + 뒤통수 +
 *    볼 덮개). 여기에 **어깨를 가로지르는 흰 털 목도리**(z반경 0.22 — 머리 반폭
 *    0.12의 1.8배)를 더하면 위에서 본 아군은 "흰 가로 막대 위에 얹힌 흰 덩어리"가
 *    되고, 적은 그대로 "살구색 덩어리"다. **머리 색 하나로 진영이 갈린다.**
 *
 *    ⚠ 처음 시도는 하늘빛 두건 슬래브 + 좁은 흰 목도리였다. 캡처에서
 *    (a) 머리 대부분이 여전히 맨 살결이라 위에서 적과 같은 색이었고
 *    (b) 목도리(z반경 0.16)가 머리 반폭보다 겨우 0.04 넓어 실루엣을 못 벌렸다.
 *    두 번째 시도에서 두건을 흰색으로 바꿔 머리를 덮고 목도리를 z로 늘렸다.
 *
 * ② 색 축 — **명도**로 가른다 (색상만으로는 이미 자리가 없다)
 *    적 염료는 붉은(0xd2492f)·청록(0x2f8a94)·이끼(0x5f8f3a)·마젠타(0xa8228c)로
 *    색상환을 네 방향에서 점유했고, 특히 lancer 의 청록은 "차가운 색 = 아군"을
 *    깨뜨린다. 남은 축은 명도다 — 적 염료는 L≈30~45%인 중·저명도인데
 *    아군은 뼈흰색 털(L≈89%) + 밝은 하늘빛(L≈61%)으로 **한 단계 위 명도대**에 산다.
 *    잔디/흙 위에서 밝은 덩어리는 어두운 덩어리보다 먼저 눈에 들어온다.
 *
 *    하늘빛은 **털에 밀려 2차 색**으로 물러난다 — 옷·이마띠·깃발 천에만 남는다.
 *    그래야 흰 털이 단일 주인공이 되고, 깃발이 "흰 머리 위의 유일한 파란 조각"이라
 *    멀리서도 깃발만 따로 읽힌다(처음엔 두건도 하늘빛이라 둘이 한 덩어리였다).
 *
 * 네 종의 구분(2차 판독)은 손에 든 것이 맡고, **HUD 출동 바 아이콘과 같은 물건**을 쥔다
 * (ui/widgets/card.ts: 몽둥이 / 무릿매 돌 / 뼈 갈래 지팡이 / 광주리).
 *
 * ⚠ guardian 이 파수꾼(방패)에서 **주술사(지팡이)** 로 바뀌었다 — `ALLY_ICON_SVG.guardian`
 * (ui/widgets/card.ts `allyGuardianSvg`)은 아직 **큰 나무 방패**를 그린다. 아이콘과 모델이
 * 다른 물건을 들면 "카드에서 고른 사람"과 "판에 선 사람"이 안 이어진다 — 아이콘도 갈래
 * 지팡이로 맞춰야 이 규약이 다시 참이 된다(이 파일 소관 밖이라 여기 적어 둔다).
 */
// 진영색은 palette.C 가 유일한 출처다 — 마을 깃발(basecamp.ts)이 같은 값을 읽는다
const ALLY_FUR = C.allyFur;
const ALLY_FUR_D = C.allyFurDark;
const ALLY_SKY = C.allySky;
const ALLY_SKY_D = C.allySkyDark;

/**
 * 아군 4종 공통 제복 — 흰 털 두건 + 어깨 목도리 + 하늘빛 옷. (부족기는 allyBanner 로
 * 떼어 **전투 3종의 kit** 이 든다 — 채집꾼의 광주리와 자리가 겹치기 때문이다.)
 *
 * ── 11단계) **변형 태그 0(공통)으로 내렸다** — 지오메트리에 1벌만 구워진다 ──────
 * 3단계에는 kit 세 개가 각자 이 함수를 불러 **3벌이 구워졌다**(166삼각형 × 3 = 498).
 * 근거로 적힌 이유는 "변형 태그가 정점 단위라 5·6·7 공통을 표현할 수단이 없다"였는데,
 * 그것은 아군이 **습격대와 한 지오메트리를 쓰던 시절**의 제약이다: 그때는 변형 0이
 * "적에게도 그려지는 몸통"이었으므로 제복을 거기 둘 수 없었다.
 * 5단계에 아군이 자기 지오메트리로 갈리면서(ALLY_GEO_KEY) 그 전제가 사라졌다 —
 * 이 지오메트리를 쓰는 인스턴스는 **전부 아군**이라 변형 0이 곧 "아군 공통"이다.
 * 주석만 남고 제약은 없어졌던 자리다.
 *
 * 실측 효과(부족기 분리까지 합쳐): 아군 공유본 1,080 → **948**. 화면은 한 픽셀도
 * 안 바뀐다 — 셰이더는 변형 0 정점을 언제나 그리고(gait.ts wgdHidden) 이 지오메트리의
 * 인스턴스는 전부 아군이다. 단품(갤러리)도 578/610/588 그대로다.
 * 이 여유가 없으면 채집꾼 4벌째는 애초에 못 들어간다 — §6-6 의 K 계산이 **제복 4벌째를
 * 빼먹었다**: 제복을 그대로 복제하면 1,080 + 166 = 1,246 이라 상한 1,250 앞에
 * 삼각형 4개만 남아, 광주리를 한 파트도 못 얹는다.
 *
 * ⚠ 그래서 **kit 은 이 함수를 부르지 않는다.** 공유본은 allyShared 가, 갤러리 단품은
 *   buildAllySolo 가 `common` 인자로 한 번씩만 얹는다.
 */
function allyLivery(ids: RaiderIds): PartSpec[] {
  return [
    // 하늘빛 짧은 옷 (적의 염료 조끼와 같은 자리 — 색만 명도대가 다르다)
    ...tubeW([[0, 0.3, 0], [0, 0.4, 0]], [0.215, 0.205], ALLY_SKY, { flat: 0.96, hueJitter: 0.02 }),
    /**
     * 흰 털 어깨 목도리 — 위에서 본 실루엣을 **가로로** 벌리는 주역.
     * z(좌우) 반경 0.22 = 머리 반폭(0.1225)의 1.8배, x(앞뒤) 반경은 0.15로 눌렀다.
     * 원형 접시로 만들면 부감에서 머리와 함께 '버섯'이 되지만, 좌우로만 긴 타원이면
     * **진행 방향과 직각인 밝은 막대**가 되어 적의 둥근 덩어리와 즉시 갈린다.
     * 윗면 0.464가 머리 밑면(0.4505)을 살짝 파고드는 건 의도다 — 목도리에 머리가
     * 파묻혀 보여야 '털옷을 껴입은 마을 사람'이 된다.
     */
    { kind: 'cyl', pos: [-0.006, 0.428, 0], scale: [0.3, 0.072, 0.44], color: ALLY_FUR, seg: 6, hueJitter: 0.02 },
    { kind: 'cyl', pos: [-0.012, 0.378, 0], scale: [0.255, 0.055, 0.365], color: ALLY_FUR_D, seg: 6, hueJitter: 0.02 },
    ...tag(ids.head, [
      // 털 두건 크라운 — 머리 윗면을 통째로 덮는다(머리보다 사방 0.014 크게).
      // **이 한 파트가 진영 구분의 8할**이다: 부감 카메라에 가장 크게 잡히는 면이 여기다.
      { kind: 'box', pos: [0.004, 0.65, 0], scale: [0.273, 0.104, 0.264], color: ALLY_FUR, hueJitter: 0.015 },
      // 뒤통수 털 — 몸통이 공유라 아군도 검은 머리카락(0x3a2a1c)이 그대로 있다.
      // 덮어 두지 않으면 뒤에서 본 아군의 뒤통수가 적과 완전히 같은 색이 된다.
      { kind: 'box', pos: [-0.113, 0.585, 0], scale: [0.076, 0.215, 0.252], color: ALLY_FUR_D, hueJitter: 0.015 },
      // 볼 덮개 — 얼굴을 좌우에서 감싸 정면에서도 '두건을 쓴 얼굴'로 읽힌다
      ...mirZ([{ kind: 'box', pos: [0.024, 0.556, 0.129], scale: [0.19, 0.152, 0.05], color: ALLY_FUR_D, hueJitter: 0.015 }]),
      // 하늘빛 이마띠 — 흰 두건 안에서 팀색이 얼굴 정면에 한 줄 남는다
      { kind: 'box', pos: [0.088, 0.611, 0], scale: [0.108, 0.05, 0.256], color: ALLY_SKY, hueJitter: 0.02 },
      /**
       * 머리띠가 정수리로 넘어가는 한 겹.
       * 이마띠만으로는 **부감 카메라에서 안 보인다** — 55°에서 얼굴 정면은 거의
       * 안 잡히고 화면에 오는 건 정수리다. 실전투 캡처에서 아군이 '파란 띠 두른
       * 마을 사람'이 아니라 **밋밋한 흰 상자**로 보인 원인이 이것이었다.
       * 흰 크라운 위에 팀색 한 줄이 지나가면 위에서도 두 톤으로 읽힌다.
       */
      { kind: 'box', pos: [0.052, 0.704, 0], scale: [0.092, 0.032, 0.268], color: ALLY_SKY, hueJitter: 0.02 },
    ]),
  ];
}

/**
 * 등에 멘 부족기 — **전투 3종만 든다.** 제복(변형 0)에서 떼어 kit 으로 내렸다.
 *
 * 왜 공통에서 뺐나: 깃대가 x −0.196~−0.243 · z 0.155 · y 0.78~0.93 을 지나는데
 * 채집꾼의 광주리가 **바로 그 자리**다(kitGatherer). 둘을 겹치면 등이 파란 천과
 * 마른 풀색으로 뒤엉켜 어느 쪽도 안 읽힌다. 짐을 진 사람이 깃발까지 들지 않는다는
 * 그림이 규칙과도 맞으므로, 깃발을 **전투 카드의 표식**으로 좁혔다.
 * 대가는 3벌(34 × 3 = 102삼각형)이고, 제복 본체 132가 1벌로 내려온 이득이 그보다 크다.
 *
 * 두 번 옮겼다. 처음엔 머리 바로 뒤(x −0.19, z 0)에 세웠더니 정면에서 **머리에 얹힌
 * 파란 슬래브**로 보였다. 뒤로 눕혀(x −0.30) 머리 위를 벗어나게 했더니 이번엔
 * 깃대가 머리에 완전히 가려 **막대 없이 뜬 간판**이 됐다.
 * 그래서 z를 0.155로 밀어 **한쪽 어깨 너머로 멘** 자세로 만들었다 — 머리 반폭이
 * 0.1225이므로 깃대가 머리 옆으로 빠져나와 "장대에 달린 천"이 성립한다.
 * 좌우 비대칭이라 유닛이 어느 쪽을 보는지도 함께 읽힌다.
 *
 * 기울기는 0.30 → 0.16으로 되돌렸다. 실전투 프레임(55° 부감)에서 아군은 카메라를
 * **등지고** 걸어가므로 뒤로 많이 눕힌 깃발은 화면상 몸통과 겹쳐 사라진다.
 * 세워 두면 머리 위 빈 하늘로 삐져나와 흰 두건 위의 파란 조각으로 남는다.
 */
function allyBanner(): PartSpec[] {
  return [
    link([-0.085, 0.4, 0.1], [-0.196, 0.93, 0.155], 0.028, 0.028, C.woodDark, { kind: 'cyl', seg: 4 }),
    { kind: 'box', pos: [-0.243, 0.9, 0.155], rot: [0, 0, 0.16], scale: [0.042, 0.2, 0.19], color: ALLY_SKY, hueJitter: 0.02 },
    { kind: 'cone', pos: [-0.223, 0.776, 0.155], rot: [Math.PI, 0, 0.16], scale: [0.17, 0.105, 0.042], color: ALLY_SKY_D, seg: 3 },
  ];
}

/** 몽둥이꾼 — 굵고 짧은 나무 몽둥이 (돌 박은 혹). blade 의 가늘고 긴 투창과 실루엣이 갈린다 */
function kitClubber(ids: RaiderIds): PartSpec[] {
  return [
    ...allyBanner(),
    ...tag(ids.armR, [
      link([0.1, 0.235, -0.132], [0.148, 0.47, -0.132], 0.05, 0.05, C.wood, { kind: 'cyl', seg: 5 }),
      { kind: 'ico', pos: [0.166, 0.556, -0.132], rot: [0.3, 0.5, 0.2], scale: [0.19, 0.2, 0.175], color: C.woodDark },
      { kind: 'cone', pos: [0.2, 0.63, -0.126], rot: [0, 0, -0.24], scale: [0.085, 0.1, 0.075], color: C.stone, seg: 4 },
      ...mirZ([{ kind: 'cone', pos: [0.176, 0.552, -0.05], rot: [1.5, 0, 0.4], scale: [0.05, 0.09, 0.05], color: C.stoneDark, seg: 4 }]),
    ]),
  ];
}

/**
 * 돌팔매꾼 — 머리 위로 돌리는 가죽 무릿매.
 * archer 의 활은 몸 **옆에서 세로로 선 호**인데, 무릿매는 **머리 위를 가로지르는 호**라
 * 위에서 내려다볼 때 겹치지 않는다(활은 세로선, 무릿매는 머리 위의 고리).
 */
function kitSlinger(ids: RaiderIds): PartSpec[] {
  return [
    ...allyBanner(),
    ...tag(ids.armR, [
      ...tube(arc([0.12, 0.28, -0.13], [0.36, 0.66, -0.1], [0.07, 0.84, 0.03], 3), 0.024, 0.019, C.rope, { flat: 1 }),
    ]),
    /**
     * 무릿매에 얹힌 돌만 **던져 나가는 그룹**(throwR)에 태운다 — 가죽끈은 손에 남는다.
     * throwR 은 오른팔과 피벗·축·위상·진폭이 완전히 같아서 걷는 동안에는 끈 끝에 매달린
     * 것과 구별되지 않고, 놓는 순간에만 접혀 사라졌다 복귀 구간에 돌아온다(gait.ts throwAway).
     * 던진 돌이 손에 남아 있으면 fx 의 날아가는 돌과 **같은 물건이 둘**이 되고,
     * 강체 팔이라 휘두르는 내내 돌이 끈을 뚫고 뒤집힌다. 습격대 투창과 같은 처방이다.
     */
    ...tag(ids.throwR, [
      { kind: 'ico', pos: [0.06, 0.86, 0.04], scale: [0.115, 0.115, 0.11], color: C.stone },
    ]),
    // 허리에 찬 돌주머니 (몸통 고정) — "던질 것을 들고 다닌다"가 읽힌다
    { kind: 'cyl', pos: [-0.06, 0.255, 0.2], rot: [0.2, 0, 0.3], scale: [0.16, 0.16, 0.15], color: RAIDER_HIDE_D, seg: 5 },
    { kind: 'ico', pos: [-0.05, 0.33, 0.21], scale: [0.085, 0.07, 0.08], color: C.stoneDark },
  ];
}

/**
 * 마을 주술사 — **뼈 갈래 지팡이**(위로 솟는 선) + 작은 뼈 방패.
 *
 * ⚠ `AllyId` 는 `guardian` 그대로다. 바뀐 것은 **역할과 모습**이다: 여전히 단단하고
 * (hp·armor) 적을 붙잡지만, 이제 타워와 마을을 되살린다. 그래서 손에 든 것이
 * 돌도끼에서 지팡이로 갈렸다. id 를 바꾸면 저장 데이터와 변형 번호가 통째로 어긋난다.
 *
 * ── 무엇을 남기고 무엇을 버렸나 ────────────────────────────────────────────
 * 버린 것: **몸을 통째로 가리던 큰 세로 방패**(0.5 × 0.38)와 짧은 돌도끼.
 * 남긴 것: **작은 방패**. 완전히 버리지 않은 이유는 셋이다.
 *  ① hp 560 · armor 3 · 적을 붙잡는 봉쇄자라는 **역할이 안 바뀌었다.** 회복은 화면에
 *     안 보이는 능력이라(수치가 올라갈 뿐이다) 정지 프레임에서 "이 사람이 맞아 주는
 *     사람"이라고 말해 주는 물건은 방패뿐이다. 지팡이만 들리면 20~40px 에서 이 카드는
 *     **뒤에 서는 원거리 딜러**로 읽힌다 — 실제 배치(앞줄)와 정반대다.
 *  ② 두 손이 다 차 있어야 hexer 와 갈린다(아래 참조). hexer 는 보조 손이 비어 있다.
 *  ③ 예산. 큰 방패 46 삼각형을 작은 방패 32 로 줄여 지팡이 76 의 절반을 여기서 벌었다.
 * 크기를 줄인 근거: 큰 방패는 몸통 앞을 다 덮어 **지팡이가 실루엣에서 밀린다.**
 * 이제 주역은 위로 솟는 선이고 방패는 "앞을 막고 선 자세"만 남긴다.
 *
 * ── ⚠ hexer(저주사)와 무엇으로 갈랐나 ─────────────────────────────────────
 * 이 저장소가 가장 경계하는 실패다: hexer 는 **아군과 몸통·머리·팔다리가 완전히 같은
 * 정점**을 쓰고(raiderBody) 오른손(MAIN)에 지팡이를 든다. 자리도 같은 −z 쪽이다.
 * 그래서 네 축으로 갈랐다 — 하나만 믿지 않는다:
 *  1) **색 덩어리**(게임 줌의 주역). hexer 는 마젠타 조끼(0xa8228c) + 마젠타 발광
 *     구슬(0xd94ad0)이고, 이쪽은 아군 제복(흰 털 두건·목도리 + 하늘빛 옷·부족기)에
 *     **하늘빛 결정**(C.ice)이다. 색상환에서 정반대(H≈314° ↔ H≈194°)이고 명도대도
 *     한 단계 위다. ⚠ 회복색으로 흔한 **민트(0x6ff2c8)를 쓰면 안 된다** — 그것은
 *     적 shaman 의 해골 지팡이 색이라, 지팡이 든 둘이 같은 색 끝을 갖게 된다.
 *  2) **끝 모양**. hexer 는 장대 끝에 **동그란 구슬 하나**(ico 0.13)다. 이쪽은
 *     **좌우(±z)로 벌어진 뼈 갈래 두 개가 작은 결정을 감싼** 형태다. 55° 부감에서
 *     구슬은 점이지만 갈래는 **가로 막대**로 잡힌다 — 아군 목도리가 쓰는 것과 같은
 *     처방이고(z 로 벌린다), 그 자리에서 두 종의 머리 위 실루엣이 갈린다.
 *  3) **밑동**. hexer 의 지팡이는 y 0.055 까지 내려와 **키 전체를 지나는 세로선**이다.
 *     이쪽은 y 0.222 에서 시작해 **허리 위에만 있는 짧은 선**이다 — 짚고 걷는 지팡이가
 *     아니라 들어 올린 주술구다. 부감에서 선의 길이가 눈에 띄게 다르다.
 *  4) **기울기와 반대 손**. hexer 의 지팡이는 수직이고 반대 손이 비어 있다. 이쪽은
 *     앞으로 19.6° 기운 선이고 반대 손에 방패가 있다.
 * 창을 멘 blade·lancer 와는 **기운 방향**이 갈린다: 저쪽은 어깨 너머 뒤로(창끝이
 * x −0.33 ~ −0.41), 이쪽은 앞으로(갈래 끝이 x +0.32) 기운다. 같은 대각선이 아니다.
 *
 * ── 원시시대 톤 ────────────────────────────────────────────────────────────
 * 뾰족 모자·별·룬은 없다. 재료는 이 게임의 나머지와 같은 것뿐이다 — 나무 자루,
 * **뼈 갈래**(C.bone, 가면 뿔·창촉과 같은 재료), 가죽 손잡이 감기(C.rope),
 * 매달린 **깃털 두 장**(C.gold, blade 머리띠 깃털과 같은 팔레트), 그리고 결정 하나.
 *
 * 삼각형 **142**(단품 622 · 공유본 982, 상한 700/1000 — tests/render/raiders.test.ts):
 *   부족기 34 · 방패 32(box 12 + box 12 + cone seg4 8) ·
 *   지팡이 76(자루 cyl seg4 16 + 손잡이 box 12 + 갈래 pairZ cone seg4 16 +
 *            결정 ico 20 + 깃털 pairZ cone seg3 12)
 * 옛 파수꾼은 108 이었다(+34). 늘어난 몫은 **전부 지팡이 머리**다 — 갈래·결정·깃털이
 * 곧 이 종을 hexer 와 가르는 세 축(2·1)이라 여기서 깎으면 갈라 놓은 것이 도로 붙는다.
 */
function kitGuardian(ids: RaiderIds): PartSpec[] {
  /**
   * 지팡이가 놓인 z. 손 상자는 z −0.151~−0.085 이므로 −0.146 은 **손 안쪽이되 바깥
   * 면**이다(hexer 가 −0.145 로 같은 자리를 쓴다 — 강체 팔에서 물건이 손을 뚫지 않는
   * 유일한 폭이다).
   */
  const sz = -0.146;
  return [
    ...allyBanner(),
    /**
     * 작은 뼈 방패 (보조 손) — 나무 판 + 뼈흰 가죽 면 + 하늘빛 보스.
     * 0.5 × 0.38 → **0.33 × 0.30**. 세로로 짧아진 만큼 몸통 앞이 열려 어깨 목도리와
     * 지팡이가 같은 프레임에 산다. 어두운 테 → 밝은 면 → 팀색 점의 3단 대비는
     * 제복과 같은 문법이라(흰 두건 + 하늘빛 띠) 방패만 따로 놀지 않는다.
     * 보스를 C.stone 에서 하늘빛으로 바꾼 것은 **돌이 이 카드의 재료가 아니게 됐기**
     * 때문이다 — 돌도끼가 빠진 자리에 돌 한 점만 남으면 근거 없는 회색이 된다.
     */
    ...tag(ids.armL, [
      { kind: 'box', pos: [0.148, 0.345, 0.172], rot: [0, 0, 0.05], scale: [0.048, 0.33, 0.3], color: C.woodDark },
      { kind: 'box', pos: [0.174, 0.345, 0.172], rot: [0, 0, 0.05], scale: [0.032, 0.26, 0.235], color: ALLY_FUR_D, hueJitter: 0.02 },
      { kind: 'cone', pos: [0.192, 0.345, 0.172], rot: [0, 0, -HALF_PI], scale: [0.08, 0.055, 0.08], color: ALLY_SKY, seg: 4 },
    ]),
    /**
     * 뼈 갈래 지팡이 (무기 손 = 공격 배역 MAIN).
     *
     * ⚠ **앞으로 19.6° 기울인 것이 아트가 아니라 계약이다.** `allies.test.ts ④` 는
     * 전 종에 `ready − hit > 0.2`(모델 키 0.77 의 1/4)를 요구한다. 이 낙차는 어깨
     * 피벗을 도는 z축 회전이라 정점 하나의 기여가 `R·[sin(back+φ) − sin(fwd+φ)]` 라는
     * 닫힌 형태다(R = 피벗까지 거리, φ = 피벗에서 본 각도) — 곧 **φ 가 90°(머리 바로
     * 위)에 가까울수록 0으로 죽는다.** 수직으로 세운 지팡이는 길어도 낙차를 못 번다.
     * 세 판을 실제로 구워 재 봤다(같은 갈래·같은 길이, 수치는 allies.test.ts ④ 의 식):
     *   세로 자루 + 옛 각도(back 1.25) → 낙차 **0.225** (문턱의 113%, 벼름 끝 x −0.498)
     *   세로 자루 + 새 각도(back 0.70) → 낙차 **0.438** (벼름 끝 x −0.255)
     *   **기운 자루 + 새 각도(채택)**   → 낙차 **0.703** (벼름 끝 x −0.102, y 1.043)
     * 채택본만 벼르는 자세에서 갈래가 **거의 수직으로 서고**(x −0.102, 머리 뒤끝이
     * −0.11 이다) 흰 두건(0.72) 위 하늘에 남는다. 앞 둘은 자루가 등 뒤로 넘어가는데,
     * 그것이 이 표 머리말에 몽둥이의 실패로 적힌 바로 그 자세다.
     * 그림도 같은 값을 가리켰다: 앞으로 기운 선은 blade·lancer 의 **뒤로 걸친** 창과
     * 반대 대각선이고, hexer 의 수직선과도 갈린다.
     *
     * 밑동을 y 0.222 에서 끊는 것도 두 몫을 한다 — hexer 의 "바닥까지 내려온 세로선"과
     * 갈리고(위 3번), 팔이 ±0.34rad 로 흔들려도 최저점이 y 0.203 이라 지면을 안 찍는다
     * (hexer 주석의 "밑동은 y=0.055 위로"와 같은 함정이다). 공격 한 주기 전체의
     * 실측 최저점도 y **0.163** 이다.
     */
    ...tag(ids.armR, [
      link([0.088, 0.222, sz], [0.298, 0.812, sz], 0.038, 0.038, C.wood, { kind: 'cyl', seg: 4 }),
      // 가죽 감은 손잡이 — 어디를 쥐고 있는지 눈으로 짚어 준다(습격대 창 자루와 같은 처방)
      link([0.079, 0.197, sz], [0.113, 0.293, sz], 0.062, 0.062, C.rope, { hueJitter: 0.02 }),
      /**
       * 뼈 갈래 두 개 — **±z 로 벌어진다.** `mirZ` 가 아니라 `pairZ(…, sz)` 인 것이
       * 요점이다: mirZ 는 몸 중심(z=0)에 대고 접는 헬퍼라 짝이 **반대쪽 어깨**로 날아간다.
       * 지팡이는 몸 중심이 아니라 자기 자루를 축으로 대칭이어야 한다.
       */
      ...pairZ([link([0.288, 0.772, sz], [0.322, 0.958, -0.04], 0.052, 0.052, C.bone, { kind: 'cone', seg: 4, pad: 0.01 })], sz),
      // 갈래가 감싸 든 하늘빛 결정 — hexer 의 구슬(0.13)보다 **작다**. 큰 구슬은 그 자체로
      // 실루엣이 되어 갈래를 먹어 버린다. 여기서는 갈래가 형태고 결정은 그 안의 빛이다.
      { kind: 'ico', pos: [0.312, 0.878, sz], scale: [0.11, 0.115, 0.1], color: C.ice },
      // 매달린 깃털 두 장 — 흔들리는 것이 아니라(강체 팔) 자루에 묶인 장식이다.
      // 이 두 장이 "주술구"와 "그냥 막대기"를 가른다.
      ...pairZ([{ kind: 'cone', pos: [0.235, 0.712, -0.1], rot: [-0.45, 0, 2.75], scale: [0.028, 0.135, 0.02], color: C.gold, seg: 3 }], sz),
    ]),
  ];
}

/**
 * 채집꾼 — **무기가 없는 사람.** 등에 큰 광주리를 지고 손에는 짧은 뒤지개만 있다.
 *
 * ── 실루엣이 어디서 갈리는가 ────────────────────────────────────────────────
 * 전투 3종은 부피가 전부 **손·머리 위**에 있다 (몽둥이는 어깨 위, 무릿매는 머리를
 * 가로지르는 고리, 방패는 몸 앞의 세로 슬래브). 55° 부감 카메라에서 위에서 본 덩어리가
 * 셋 중 어느 것과도 안 겹치는 자리는 **등** 하나뿐이고, 거기에 광주리를 얹으면
 * "손이 비어 있다 = 싸우지 않는 사람"이 같은 그림에서 한 번에 읽힌다.
 * 몸도 넷 중 가장 작다(radius 0.24 — allies.ts).
 *
 * ⚠ **부족기를 안 든다** — 이 kit 만 allyBanner() 를 부르지 않는다. 깃대가
 * x −0.196~−0.243 · z 0.155 · y 0.78~0.93 을 지나는데 광주리가 **같은 자리**라
 * 둘을 겹치면 등이 파란 천과 마른 풀색으로 뒤엉켜 어느 쪽도 안 읽힌다.
 * 짐을 진 사람이 깃발까지 들지 않는다는 그림이 규칙과도 맞는다.
 *
 * 색: 광주리만 마른 풀색(C.straw)이다. 아군 색조(ALLY_TINT 0.86/0.98/1.16)가 온몸을
 * 서늘하게 미는 위에서 **한 점만 따뜻하게** 남아 등짐이 먼저 눈에 들어온다.
 *
 * 삼각형 **132** (§6-6 예산 K ≤ 140):
 *   아가리 링 cyl seg6 24 · 몸통 cone seg6 12 · 짐 2알 ico 40 · 멜빵 2줄 24 ·
 *   이마 짐끈 12 · 뒤지개 자루 12 · 돌촉 cone seg4 8
 * ⚠ 원주 분할을 §6-6 의 8각이 아니라 **6각**으로 굽는다 — 이 파일의 스타일 규약이
 *   "원주 분할 4~7, 8+는 매끈해져 스타일 이탈"(헤더)이고, 6각이면 예산도 8각(148)에서
 *   132로 내려와 §6-6 이 적은 "약 132"에 정확히 앉는다.
 */
function kitGatherer(ids: RaiderIds): PartSpec[] {
  return [
    /**
     * 깃발을 지운 자리 = 등에 진 광주리. 위를 향해 벌어진 6각 테이퍼 + 아가리 링.
     * 아가리를 몸통보다 넓게 얹어 부감에서 **어두운 속**이 보이게 한다 — 위에서 본
     * 열린 통은 그 자체로 "담는 물건"이고, 그게 등짐의 판독 근거다.
     *
     * 단면이 **앞뒤로 얇고(0.25) 좌우로 넓다(0.42).** 두 이유가 같은 값을 가리켰다:
     *  ① 55° 부감에서 화면 면적을 버는 축은 z(좌우)다. 어깨 목도리가 이미 같은 처방을
     *     쓰고 있고(x 0.30 / z 0.44) 광주리가 그 바로 뒤에 겹쳐 앉아 한 덩어리로 읽힌다.
     *  ② 앞뒤로 두꺼우면 x −0.15 앞의 **뒤통수 털**(x −0.151~−0.075)을 파고들어
     *     흰 두건의 뒤가 마른 풀색 링에 잘린다. 지금 앞 끝이 −0.16이라 닿지 않는다.
     */
    { kind: 'cyl', pos: [-0.285, 0.578, 0], scale: [0.25, 0.072, 0.42], color: C.rope, seg: 6, hueJitter: 0.02 },
    link([-0.285, 0.565, 0], [-0.3, 0.285, 0], 0.225, 0.375, C.straw, { kind: 'cone', seg: 6, hueJitter: 0.025 }),
    // 광주리에 담긴 짐 — 아가리 위로 살짝 넘치게 둔다. 빈 광주리는 부감에서
    // 그냥 구멍이라 "일하고 있다"가 안 읽힌다.
    { kind: 'ico', pos: [-0.278, 0.622, 0.088], scale: [0.115, 0.1, 0.115], color: C.leafDark, hueJitter: 0.03 },
    { kind: 'ico', pos: [-0.302, 0.612, -0.082], scale: [0.1, 0.088, 0.1], color: C.hide, hueJitter: 0.03 },
    // 멜빵 2줄 — 광주리 위쪽에서 양 어깨를 넘어 가슴으로. 어깨 목도리(흰 털) 위를
    // 지나는 어두운 가죽 두 줄이라 부감에서 등짐과 몸이 실제로 이어져 보인다.
    ...mirZ([
      link([-0.242, 0.556, 0.108], [0.052, 0.342, 0.126], 0.032, 0.048, RAIDER_HIDE_D, { hueJitter: 0.02 }),
    ]),
    // 이마 짐끈(멜빵끈) — 하늘빛 이마띠보다 뒤·위에 한 줄 더. 큰 짐을 이마로 받치는
    // 자세는 이 한 줄로 성립하고, 머리 그룹이라 걸음마다 같이 까딱인다.
    ...tag(ids.head, [
      { kind: 'box', pos: [-0.006, 0.716, 0], scale: [0.078, 0.036, 0.276], color: RAIDER_HIDE_D, hueJitter: 0.02 },
    ]),
    /**
     * 뒤지개 — 유일하게 손에 있는 물건이고, **공격 배역 MAIN 의 지렛대**다.
     *
     * ⚠ 길이가 아트가 아니라 **계약**이다(§6-6). 채집 포즈는 back 0.70 / fwd −1.60 인데,
     * `allies.test.ts ④` 가 전 종에 `ready − hit > 0.2`(모델 키 0.77 의 1/4)를 요구한다.
     * 각도가 얕은 데다 캐는 자세라 손이 낮게 시작하므로 낙차는 **지렛대 길이**로만 벌 수
     * 있다 — 여기 돌촉 끝은 어깨 기준 **0.352**이고 실측 낙차가 0.287, 문턱의 143%다.
     * (넷 중 가장 얇은 여유다. 주술사 지팡이가 0.631/0.703, 몽둥이가 0.334/0.376이다.)
     * 짧고 굵은 뒤지개를 굽지 마라. 실측은 아래 ALLY_ATTACKS 4)번 주석에 있다.
     *
     * 손잡이 **뒤쪽(자루 끝)을 길게 빼지 않는 것**도 같은 이유다: 어깨 뒤로 넘어간
     * 정점은 내려칠 때 오히려 **올라와** 낙차를 그만큼 깎아 먹는다(시소).
     */
    ...tag(ids.armR, [
      link([0.086, 0.252, -0.146], [0.3, 0.376, -0.146], 0.042, 0.042, C.wood, { hueJitter: 0.02 }),
      link([0.292, 0.371, -0.146], [0.352, 0.406, -0.146], 0.072, 0.062, C.stoneDark, { kind: 'cone', seg: 4 }),
    ]),
  ];
}

/**
 * 아군 4종의 **공격 포즈** (변형 번호 1~4 = ALLY_KITS 순서).
 *
 * 11단계까지 아군의 "공격"은 보행 위상을 9rad/s로 굴리는 것 하나뿐이었다 —
 * 사지가 전부 같은 aGait 를 보므로 팔이 빨라지면 **다리도 같이 빨라져** 제자리
 * 뜀박질로 읽혔고, 무엇보다 **때리는 순간이 피해가 들어가는 틱과 아무 상관이 없었다**.
 * 습격대가 쓰는 공격 채널(gait.ts)은 그 둘을 정확히 고치는 물건이라 그대로 얹는다:
 * 팔·머리만 배역으로 인계되고 다리는 보행/정지 그대로 남으며, 진행도는 sim 의
 * 쿨다운 잔여 틱에서 나온다(views/enemyview.ts allyAttackProgress).
 *
 * 각도는 전부 어깨 피벗 둘레의 z축 회전이고 **+가 앞을 들어올리는 방향**이다.
 * 감각(오른팔 기준, 쉬는 자세에서 손은 어깨 아래 (0.1, −0.176) = −60°):
 *   몽둥이 머리는 어깨 기준 +39°/거리 0.215 → back +0.85 면 88°(머리 옆으로 곧게 치켜듦),
 *   fwd −1.35 면 −38°(앞으로 낮게 내려침). 곧 이 한 쌍이 **치켜들었다 내려치는 호**다.
 * back 은 **조준 유지 자세이기도 하다** — 사거리 안에 적을 두고 멈춰 선 동안 이 각으로
 * 굳으므로 "몽둥이를 들고 벼르는" 자세가 쿨다운 내내 보인다(gait.ts 의 aim).
 *
 * ⚠ back 을 더 크게(+1.15) 잡아 봤더니 몽둥이가 **머리 뒤로 넘어갔다** — 실측 캡처에서
 * 무기 끝이 어깨 기준 x −0.15로 가 55° 부감 카메라에서 머리에 통째로 가렸다. 무기를
 * 화면에 남기려면 "뒤로 젖히기"가 아니라 **세우기**여야 한다. 지금 값은 무기 끝이
 * x −0.05(거의 수직)라 흰 두건 위로 삐져나온다. 실측 높이는 아래 impact 절 참조.
 *
 * 근접 둘과 원거리 하나를 **다른 동작**으로 가른 것이 이 표의 요점이다:
 *  · 몽둥이꾼 = 내려치기. 치켜든 무기가 앞아래로 떨어지고 몸이 따라 숙인다.
 *  · 주술사 = **겨누기**. 지팡이를 하늘로 세웠다 앞으로 눕혀 결정을 목표에 겨눈다 —
 *    회복은 화면에 안 보이는 능력이라 "무엇을 향해 쓰는가"를 자세가 대신 말한다.
 *  · 무릿매 = 던지기. 머리 위 무릿매를 앞으로 후려 돌을 놓는다(놓는 순간 돌이 사라진다).
 *    사거리 2.8칸이라 화면에서 적과 뚝 떨어져 서 있고, 그 거리에서 근접과 같은 모션이면
 *    "허공을 때리는 사람"이 된다.
 *  · 채집꾼 = **캐기**. 내려치기도 던지기도 아니다 — 얕게 젖혔다 앞아래로 길게 훑는다.
 *
 * ⚠ 순서가 계약이다: allyShared 가 `ALLY_ATTACKS.forEach((p, i) => rig.attack(i + 1, p))`
 * 로 **인덱스+1 = 변형 번호**를 못 박는다. ALL_ALLY_IDS(싼 순: gatherer 가 첫째)와는
 * 순서가 다르므로, 새 종은 언제나 이 배열과 ALLY_KITS 의 **맨 뒤에** 붙인다.
 */
const ALLY_ATTACKS: readonly (readonly AttackPose[])[] = [
  // 1) 몽둥이꾼 — 가장 크고 느린 호. 돌 박은 혹이 무거워 보이도록 몸통 기울임도 최대(1.0).
  [
    { role: ATK_ROLE_MAIN, back: 0.85, fwd: -1.35 },
    { role: ATK_ROLE_OFF, back: 0.5, fwd: -0.55, take: 0.85 },
    { role: ATK_ROLE_HEAD, back: 0.14, fwd: -0.26 },
  ],
  // 2) 무릿매꾼 — 머리 위 끈을 앞으로 후린다. 놓는 지점(0.435)에서 돌이 이미 앞으로
  //    기울어 있어야 "뿌렸다"로 읽히므로 back 은 얕게, fwd 는 깊게 잡는다(−2.3).
  //    쉬는 자세에서 돌이 이미 머리 위 82°에 있어 조금만 젖혀도 장전으로 보인다.
  [
    { role: ATK_ROLE_MAIN, back: 0.45, fwd: -2.3 },
    { role: ATK_ROLE_OFF, back: -0.4, fwd: 0.7, take: 0.8 },
    { role: ATK_ROLE_HEAD, back: 0.1, fwd: -0.3 },
  ],
  /**
   * 3) 주술사 — **하늘로 치켜들었다 앞으로 겨눈다.** 방패 팔(OFF)은 젖힐 때도 놓을
   *    때도 앞으로 세운 채라 몸이 계속 가려진다(봉쇄자라는 역할은 안 바뀌었다).
   *
   * ⚠ `back` 을 **1.25 → 0.70 으로 내렸다.** 1.25 는 파수꾼 시절의 값이고, 그 근거는
   *   주석에 그대로 적혀 있었다 — "도끼가 손 바로 위라 지렛대가 짧아(어깨 기준 0.166)
   *   같은 각도로도 호가 작다". 지팡이의 갈래 끝은 **0.631**로 그 3.8배라 전제가 없어졌다.
   *   1.25 를 그대로 두면 긴 자루가 통째로 뒤로 넘어가 갈래 끝이 (x −0.322, y 0.905)
   *   로 가는데, 이는 이 표 머리말이 몽둥이에서 실패로 기록한 바로 그 자세다
   *   ("뒤로 젖히기가 아니라 **세우기**여야 한다"). 0.70 이면 갈래 끝이
   *   **(x −0.102, y 1.043)** — 수직에 가깝게 서서 흰 두건(0.72) 위 하늘에 남는다.
   *   실측(allies.test.ts ④ 의 식): 벼름 1.25 → 0.905 / **0.70 → 1.043**,
   *   타격은 둘 다 0.340 이므로 낙차 0.565 → **0.703**(문턱 0.2의 3.5배).
   *   놓는 자세(fwd −1.2)에서 자루는 거의 수평이 되어 결정이 목표를 겨눈다 —
   *   회복은 화면에 안 보이는 능력이라 **겨누는 자세가 유일한 연출**이다.
   */
  [
    { role: ATK_ROLE_MAIN, back: 0.7, fwd: -1.2 },
    { role: ATK_ROLE_OFF, back: 0.35, fwd: 0.5 },
    { role: ATK_ROLE_HEAD, back: 0.1, fwd: -0.2 },
  ],
  /**
   * 4) 채집꾼 — 캐기. 뒤지개를 얕게 세웠다 **앞아래로 길게** 훑어 내린다.
   *
   * ⚠ `back` 이 0.70인 것은 아트가 아니라 테스트다(§6-6). `allies.test.ts ④` 가
   * 전 종에 `ready − hit > 0.2`(모델 키 0.77의 1/4)를 요구하는데, 뒤지개는 파수꾼
   * 돌도끼급의 짧은 지렛대라 **0.35에서는 낙차가 0.190으로 모자란다**. 0.70이면
   * 실측 낙차가 0.2를 넘는다(kitGatherer 의 뒤지개 길이가 나머지 절반의 근거다).
   * 아트 의도인 "얕고 낮게"는 각도가 아니라 **몸통과 머리**가 낸다 — lean 0.6(파수꾼
   * 0.75보다 낮다)에 HEAD fwd −0.4로 크게 숙여 "쭈그려 훑는" 인상을 만든다.
   * 빈 손(OFF)은 무릎을 짚듯 같이 내려간다 — 무기를 안 든 팔이라 take 를 낮춰 호를 줄인다.
   *
   * ⚠⚠ **채집 자세는 이 포즈를 쿨다운으로 재생하지 않는다.** 캐는 동안에는
   * attackCdLeft 가 안 돌아 진행도가 얼어붙으므로, 뷰가 gatherTicks 로 위상을 직접
   * 만들어 attack(4, …) 를 구동한다(§6-6 · views/enemyview.ts — T5 소관).
   */
  [
    { role: ATK_ROLE_MAIN, back: 0.7, fwd: -1.6 },
    { role: ATK_ROLE_OFF, back: 0.2, fwd: -0.75, take: 0.7 },
    { role: ATK_ROLE_HEAD, back: 0.06, fwd: -0.4 },
  ],
];

/**
 * 아군 공격 동작의 **길이 · 타격 지점 · 몸통 기울임**.
 *
 * ── ticks (동작 길이) ──────────────────────────────────────────────────────
 * 습격대와 같은 12틱(0.4초)을 쓴다. 몸통도 리그도 같은 코드에서 나오는 사람들이라
 * 박자가 갈리면 같은 화면에서 두 부족이 다른 물리로 움직이는 것처럼 보인다.
 * 실제 길이는 **쿨다운으로 잘린다**(min) — 쿨다운보다 긴 동작은 다음 동작과 겹쳐
 * 팔이 두 자세를 오가며 떤다. 지금 값은 24/30틱이라 잘리지 않는다.
 *
 * ── impact (피해가 들어가는 틱이 놓이는 진행도) ────────────────────────────
 * 이 값 하나가 "때리는 순간 = 피해가 들어가는 순간"을 만든다. 렌더는 쿨다운
 * 잔여 틱에서 진행도를 역산하므로(enemyview) 여기서 고른 지점이 곧 sim 의 타격 틱이다.
 *  · 근접은 ATK_RELEASE(0.56) — fwd 가 1이 되는, 무기가 가장 앞아래로 내려간 지점이다.
 *    맞는 순간에 몽둥이가 제일 낮게 내려와 있어야 "맞았다"로 읽힌다.
 *  · 무릿매는 ATK_LAUNCH(0.435) — 손의 돌이 접혀 사라지는 그 프레임이다(THROW_GONE
 *    구간의 한가운데). 같은 틱에 fx 가 날아가는 돌을 띄우므로 **같은 물건이 이어진다**.
 *
 * 실측(셰이더 식을 CPU 로 재현해 잰 무기 손 최고점, 모델 단위 · 키 0.77 기준):
 *   몽둥이꾼 벼름 0.750 → 타격 0.374 (0.376 하강) · 무릿매 0.899 → 0.436 (0.463) ·
 *   **주술사 1.043 → 0.340 (0.703)** · 채집꾼 0.636 → 0.349 (0.287).
 * tests/render/allies.test.ts ④ 가 이 하강폭을 잠근다. 주술사가 넷 중 가장 큰 것은
 * 지팡이의 지렛대가 가장 길기 때문이다(0.631 — 옛 파수꾼 돌도끼는 0.166이었다).
 *
 * ── lean (몸통 기울임 배율) ────────────────────────────────────────────────
 * 사지는 셰이더가 돌리지만 몸통은 인스턴스 행렬 몫이라 뷰가 이 값을 읽어 간다.
 * 무거운 무기일수록 크고, 방패 뒤에서 버티는 주술사(0.75)와 쭈그려 훑는 채집꾼(0.6)이
 * 작다 — 주술사는 지팡이가 길어졌어도 **버티는 사람**이라 몸통은 그대로 덜 흔든다.
 */
export interface AllyAttackAnim {
  /** 동작 전체 길이 (틱). 쿨다운보다 길지 않다 */
  ticks: number;
  /**
   * sim 이 타격 뒤 채워 넣는 쿨다운 틱 수 = AllyState.attackCdLeft 의 분모.
   * 뷰는 이 값으로 "지난 타격 이후 흐른 틱"을 복원한다 — 그래서 여기 있어야
   * 뷰가 데이터 테이블(ALLY_DEFS)을 따로 읽지 않는다.
   */
  cooldown: number;
  /** 피해가 들어가는 틱이 놓이는 진행도 0..1 */
  impact: number;
  /** 몸통 기울임 배율 (0 = 고정) */
  lean: number;
}

/** 아군 공격 동작의 **최대** 길이 (틱). 실제 길이는 min(이 값, 쿨다운). */
const ALLY_ATTACK_ANIM_TICKS = 12;

function allyAnim(id: AllyId, impact: number, lean: number): AllyAttackAnim {
  // sim 이 쿨다운을 잡는 식과 **같은 반올림**을 써야 동작 창이 쿨다운을 삐져나가지 않는다
  // (sim/allies.ts: attackCdLeft = max(1, round(cooldownTicks)))
  const cd = Math.max(1, Math.round(ALLY_DEFS[id].cooldownTicks));
  return { ticks: Math.min(ALLY_ATTACK_ANIM_TICKS, cd), cooldown: cd, impact, lean };
}

const ALLY_ATTACK_ANIMS: Readonly<Record<AllyId, AllyAttackAnim>> = {
  clubber: allyAnim('clubber', ATK_RELEASE, 1),
  slinger: allyAnim('slinger', ATK_LAUNCH, 0.9),
  guardian: allyAnim('guardian', ATK_RELEASE, 0.75),
  // 채집꾼은 넷 중 몸통 기울임이 가장 작다(0.6). "얕고 낮게"를 팔 각도가 아니라
  // 여기서 낸다 — 팔의 호는 오히려 커야 낙차 계약(§6-6)이 선다.
  gatherer: allyAnim('gatherer', ATK_RELEASE, 0.6),
};

/** 그 아군의 공격 동작 파라미터 (뷰가 쿨다운 잔여 틱과 함께 읽는다) */
export function allyAttackAnim(id: AllyId): AllyAttackAnim {
  return ALLY_ATTACK_ANIMS[id];
}

/**
 * **회복 동작 파라미터** — 사용자 지적으로 생겼다:
 *   > "마법사가 hp 힐링 할때 애니메이션을 넣어줘. 지금은 가만 서 있어.
 *   >  뭔가 지팡일을 움직인다던지 액션이 필요해."
 *
 * 회복은 `targetId` 를 안 쓰므로 공격 채널이 0 으로 굳어 마법사만 정지 자세였다.
 * 같은 채널을 **회복 쿨다운**으로 굴리면 손이 움직인다 — 새 채널을 만들지 않은 이유가
 * 그것이다(팔·머리는 어차피 한 배역이고, 회복하는 사람은 싸우지 않으므로 겹칠 일이 없다).
 *
 * 공격과 다르게 잡은 값 둘:
 *  · `ticks` 가 훨씬 길다(공격 12틱 → 회복 최대 30틱). 지팡이를 **치켜들고 머무는**
 *    동작이라 내려치기처럼 짧으면 "떠는 것"으로 보인다.
 *  · `impact` 가 늦다(0.75). 회복이 들어가는 틱에 지팡이가 **가장 높이** 있어야
 *    빛나는 연출(fx.ts allyHealed)과 손이 같은 순간에 맞는다. 내려치기는 반대로
 *    타격 순간이 호의 아래쪽이다.
 *  · `lean` 이 **음수**다. 공격은 앞으로 숙이지만 회복은 **뒤로 젖혀** 하늘을 향한다 —
 *    같은 채널을 쓰면서도 두 동작이 화면에서 즉시 갈린다.
 */
const ALLY_HEAL_ANIM_TICKS = 30;
export function allyHealAnim(id: AllyId): AllyAttackAnim {
  const spec = ALLY_DEFS[id].heal;
  const cd = Math.max(1, Math.round(spec ? spec.cooldownTicks : ALLY_HEAL_ANIM_TICKS));
  return { ticks: Math.min(ALLY_HEAL_ANIM_TICKS, cd), cooldown: cd, impact: 0.75, lean: -0.9 };
}

/**
 * 장비 세트 — **적 습격대 4벌과 아군 3벌을 서로 다른 지오메트리에 굽는다.**
 *
 * ── 왜 5단계에서 갈랐는가 (한 지오메트리 → 둘) ─────────────────────────────
 * 3단계까지는 7벌이 한 배열에 살았다. 근거는 "아군 전용 메시를 만들면 컬러+그림자
 * +2콜이고 합성 최악 프레임이 이미 60/60이라 여유가 0"이었는데, 그 전제가 **실측으로
 * 틀렸다**(views/enemyview.ts 헤더의 UNIT_SHADOW 절 참조 — 최악 프레임은 60이 아니라
 * 73~80콜이고, 그 천장을 만드는 것은 아군이 아니라 타워 수다).
 *
 * 대신 진짜 문제는 **삼각형**이었다. 변형 마스킹은 자기 것이 아닌 정점을 원점으로 접어
 * 축퇴 삼각형으로 만들 뿐이라, 한 인스턴스가 **7벌 전부의 정점 비용을 매 프레임 낸다**.
 * 스테이지1 웨이브 49는 습격대만 56마리가 동시에 사는 편성이라 이 낭비가 그대로
 * 프레임을 지배했다:
 *   7벌 한 몸(1,662 삼각형/인스턴스) → 최악 프레임 170,341 (예산 150,000의 114%)
 *   4벌/3벌 분리(습격대 1,146 · 아군 1,146)  → 최악 프레임 **약 14만** · 콜 +1
 * 즉 **드로우콜 1개로 삼각형 3만을 산다**. 아군이 화면에 없으면 그 메시는 count=0이라
 * 0콜이므로(three 의 renderInstances 는 primcount 0 에서 즉시 반환) 실제 +1은
 * "아군과 습격대가 동시에 있는 프레임"에서만 든다.
 *
 * 몸통·팔다리·머리·보행 리그는 여전히 **완전히 같은 코드**(raiderBody)를 쓴다 —
 * 갈린 것은 구워지는 단위뿐이고, 아군이 적과 같은 체형이라는 아트 계약은 그대로다.
 */
const RAIDER_KITS: readonly ((ids: RaiderIds) => PartSpec[])[] = [
  kitBlade,
  kitLancer,
  kitArcher,
  kitHexer,
];

/**
 * 아군 마을 부족원 장비 4벌 — 같은 몸통, 다른 지오메트리 (변형 1~4).
 * ⚠ **맨 뒤에만 붙인다.** 이 배열의 인덱스+1이 곧 ALLY_VARIANTS 의 번호이고
 * ALLY_ATTACKS 의 짝이다(allyShared). ALL_ALLY_IDS 는 값이 싼 순서라 여기와 다르다.
 */
const ALLY_KITS: readonly ((ids: RaiderIds) => PartSpec[])[] = [
  kitClubber,
  kitSlinger,
  kitGuardian,
  kitGatherer,
];

/**
 * 장비 배열 하나를 몸통에 얹어 굽는 공통 경로 (변형 태그 1-base).
 * `common` 은 **변형 태그 없이**(=0) 얹는 벌이라 그 지오메트리의 모든 인스턴스가
 * 그린다 — 아군 제복처럼 "종이 달라도 똑같이 입는 것"의 자리다. 종마다 복제하면
 * 벌 수만큼 삼각형이 곱해지므로, 공통으로 내릴 수 있는 것은 반드시 여기로 내린다.
 */
function sharedWithKits(
  rig: RigBuilder,
  kits: readonly ((ids: RaiderIds) => PartSpec[])[],
  common?: (ids: RaiderIds) => PartSpec[],
): PartSpec[] {
  const { parts, ids } = raiderBody(rig);
  const out = [...parts, ...(common ? common(ids) : [])];
  kits.forEach((kit, i) => out.push(...tagVariant(i + 1, kit(ids))));
  return out;
}

/** 전투용 습격대 공유 지오메트리 — 몸통 1벌 + 장비 4벌(각각 variant 태그) */
function raiderShared(rig: RigBuilder): PartSpec[] {
  // 공격 포즈는 변형 번호와 **같은 순서**로 등록한다 (RAIDER_KITS ↔ RAIDER_ATTACKS)
  RAIDER_ATTACKS.forEach((poses, i) => rig.attack(i + 1, poses));
  return sharedWithKits(rig, RAIDER_KITS);
}

/** 전투용 아군 공유 지오메트리 — 같은 몸통 + 제복 1벌(변형 0) + 장비 4벌 */
function allyShared(rig: RigBuilder): PartSpec[] {
  // 공격 포즈는 변형 번호와 **같은 순서**로 등록한다 (ALLY_KITS ↔ ALLY_ATTACKS)
  ALLY_ATTACKS.forEach((poses, i) => rig.attack(i + 1, poses));
  return sharedWithKits(rig, ALLY_KITS, allyLivery);
}

/** 갤러리/단품용 — 그 종의 장비만 굽는다 (variant 태그 없음) */
function raiderSolo(
  rig: RigBuilder,
  variant: number,
  kits: readonly ((ids: RaiderIds) => PartSpec[])[] = RAIDER_KITS,
  common?: (ids: RaiderIds) => PartSpec[],
): PartSpec[] {
  const { parts, ids } = raiderBody(rig);
  const kit = kits[variant - 1];
  return kit ? [...parts, ...(common ? common(ids) : []), ...kit(ids)] : parts;
}

function mammoth(rig: RigBuilder): PartSpec[] {
  const fur = 0xa06a3a;
  const furDark = 0x7a4c28;
  const furLight = 0xb8804a;
  const headRoot: V3 = [0.44, 0.9, 0];
  const trunkRoot: V3 = [0.74, 0.8, 0];
  const tailRoot: V3 = [-0.62, 0.68, 0];
  // 육중한 종 — 다리 진폭을 키워 1주기 이동거리를 길게(느린 보폭) 잡는다.
  // 머리(상아 포함)는 걸음마다 끄덕이고, 늘어진 코는 두 걸음에 한 번 좌우로 크게 흔들린다.
  // 코는 아래로 늘어져 있어 x축(롤) 회전이라야 실제로 좌우로 움직인다.
  const headId = rig.add(headRoot, [0, 0, 1], { phase: HALF_PI, amp2: 0.045 });
  const trunkId = rig.add(trunkRoot, [1, 0, 0], { amp: 0.11 });
  const tailId = rig.add(tailRoot, [0, 1, 0], { amp: 0.12 });
  const parts: PartSpec[] = [
    // 몸통 (어깨 혹이 높은 등 곡선)
    ...tubeW(
      [[-0.58, 0.7, 0], [-0.28, 0.78, 0], [0.0, 0.88, 0], [0.26, 0.92, 0], [0.46, 0.86, 0]],
      [0.54, 0.66, 0.72, 0.7, 0.58],
      fur,
      { flat: 0.98, hueJitter: 0.014 },
    ),
    ...tube([[-0.46, 0.5, 0], [0.0, 0.48, 0], [0.38, 0.55, 0]], 0.56, 0.48, furDark, { flat: 0.68 }),
    ...tag(headId, [
      // 머리 (돔형 이마 + 볼)
      { kind: 'box', pos: [0.6, 0.84, 0], scale: [0.34, 0.4, 0.44], color: fur, hueJitter: 0.012 },
      // 돔형 이마 (머리보다 좁게 얹어 매끄럽게 이어짐)
      { kind: 'box', pos: [0.6, 1.02, 0], scale: [0.31, 0.16, 0.41], color: fur },
      { kind: 'box', pos: [0.575, 1.12, 0], scale: [0.25, 0.1, 0.33], color: furLight },
      ...eyes(0.72, 0.9, 0.19, 0.045, C.black, 0xd9b382),
      // 상아 (부드러운 곡선 6마디) — 머리에 붙어 있으니 같은 그룹이라야 뿌리가 안 벌어진다
      ...mirZ(tube(arc([0.72, 0.62, 0.2], [1.0, 0.36, 0.25], [1.04, 0.74, 0.23], 6), 0.095, 0.028, C.bone, { kind: 'cyl', seg: 5 })),
      // 귀
      ...mirZ([
        { kind: 'box', pos: [0.46, 0.96, 0.28], rot: [0.35, 0, 0.1], scale: [0.22, 0.28, 0.06], color: furDark },
        { kind: 'box', pos: [0.44, 0.82, 0.3], rot: [0.5, 0, 0.3], scale: [0.16, 0.17, 0.05], color: furDark },
      ]),
    ]),
    // 코 (7마디 테이퍼 — 앞으로 나왔다가 내려옴)
    ...tag(trunkId, [
      ...tube(arc(trunkRoot, [0.96, 0.5, 0], [0.84, 0.1, 0], 7), 0.22, 0.07, fur, { kind: 'cyl', seg: 6, hueJitter: 0.012 }),
      { kind: 'box', pos: [0.82, 0.07, 0], rot: [0, 0, 0.6], scale: [0.13, 0.07, 0.11], color: furDark },
    ]),
    // 다리 (굵고 짧음) — 대각보행
    ...legQuad(0.32, 0.27, 0.5, 0.22, furDark, 0x5f3d20, 0.03, { rig, amp: 0.4, phase: 0 }),
    ...legQuad(-0.44, 0.27, 0.5, 0.23, furDark, 0x5f3d20, -0.03, { rig, amp: 0.4, phase: Math.PI }),
    // 꼬리
    ...tag(tailId, [
      ...tube(arc(tailRoot, [-0.78, 0.58, 0], [-0.8, 0.4, 0], 4), 0.09, 0.04, fur, { kind: 'cyl', seg: 5 }),
      { kind: 'cone', pos: [-0.81, 0.34, 0], rot: [0, 0, Math.PI], scale: [0.09, 0.14, 0.07], color: furDark, seg: 4 },
    ]),
  ];
  // 털 결 — 등 능선 + 옆구리 늘어진 털
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const x = 0.34 - t * 0.92;
    const y = 1.2 - t * 0.16 - Math.max(0, t - 0.6) * 0.24;
    parts.push({ kind: 'box', pos: [x, y, 0], scale: [0.13, 0.13, 0.5], color: furLight, hueJitter: 0.02 });
    parts.push(
      ...mirZ([
        { kind: 'cone', pos: [x, 0.48, 0.35], rot: [0, 0, Math.PI], scale: [0.11, 0.36, 0.09], color: fur, hueJitter: 0.02 },
      ]),
    );
  }
  return parts;
}

interface TheroCfg {
  body: number;
  belly: number;
  dark: number;
  /** 전체 배율 */
  s: number;
  /** 꼬리를 넣을 사지 그룹 id — 종마다 흔드는 방식이 달라 밖에서 등록해 넘긴다 */
  tail: number;
  /** 다리 스윙 진폭 (보폭·주기·바운스가 전부 여기서 나온다) */
  legAmp: number;
}

/** trex/spino 공용 몸통 — 목/꼬리 테이퍼 + 2단 관절 다리. 머리는 종별로 붙인다 */
function theropod(rig: RigBuilder, c: TheroCfg): PartSpec[] {
  const { body, belly, dark, s } = c;
  const V = (x: number, y: number, z = 0): V3 => [x * s, y * s, z * s];
  return [
    // 몸통 (가슴이 굵고 허리가 잘록)
    ...tubeW(
      [V(-0.48, 0.8), V(-0.26, 0.86), V(-0.02, 0.9), V(0.18, 0.88), V(0.32, 0.84)],
      [0.4 * s, 0.5 * s, 0.52 * s, 0.46 * s, 0.38 * s],
      body,
      { flat: 0.92, hueJitter: 0.014 },
    ),
    // 배
    ...tube([V(-0.36, 0.62), V(0.0, 0.6), V(0.26, 0.66)], 0.4 * s, 0.3 * s, belly, { flat: 0.6 }),
    // 꼬리 (10마디, 끝으로 갈수록 가늘게 + 살짝 들림)
    ...tag(
      c.tail,
      tube(arc(V(-0.44, 0.82), V(-0.8, 0.9), V(-1.16, 0.58), 10), 0.4 * s, 0.045 * s, body, {
        kind: 'cyl',
        seg: 6,
        flat: 1.12,
        hueJitter: 0.012,
      }),
    ),
    // 목 (S자)
    ...tube(arc(V(0.3, 0.86), V(0.48, 1.06), V(0.54, 1.18), 5), 0.34 * s, 0.26 * s, body, { kind: 'cyl', seg: 6 }),
    // 다리 — 보스(개별 Mesh)도 유니폼 폴백으로 똑같이 걷는다
    ...legBiped(-0.04 * s, 0.19 * s, 0.72 * s, 0.13 * s, body, dark, C.boneDark, { rig, amp: c.legAmp }),
    // 허벅지 근육 덩어리
    ...mirZ([{ kind: 'ico', pos: V(-0.08, 0.62, 0.2), scale: [0.34 * s, 0.44 * s, 0.26 * s], color: body }]),
  ];
}

function spino(rig: RigBuilder): PartSpec[] {
  const body = 0x4a8a9a;
  const belly = 0xa8c9b0;
  const dark = 0x2f6a7a;
  const s = 1.05;
  const V = (x: number, y: number, z = 0): V3 => [x * s, y * s, z * s];
  // 등돛이 좌우로 흔들린다 = 등뼈 축(x) 둘레의 롤.
  // 돛 뒷부분이 꼬리 위를 지나가므로 **꼬리를 같은 그룹**에 넣어야 뒤쪽에서 어긋나지 않는다.
  // 피벗이 등마루라 꼬리는 살짝 반대로 기울며 따라온다(무게 이동처럼 보인다).
  const backId = rig.add(V(0, 0.88), [1, 0, 0], { amp: 0.11 });
  const headId = rig.add(V(0.5, 1.2), [0, 0, 1], { phase: HALF_PI, amp2: 0.04 });
  const parts = theropod(rig, { body, belly, dark, s, tail: backId, legAmp: 0.34 });
  // 악어형 긴 주둥이 (한 줄기로 이어지는 테이퍼)
  parts.push(
    ...tag(headId, [
      ...tubeW(
        [V(0.5, 1.2), V(0.66, 1.19), V(0.85, 1.17), V(1.04, 1.15)],
        [0.28 * s, 0.22 * s, 0.17 * s, 0.12 * s],
        body,
        { flat: 0.85 },
      ),
      { kind: 'box', pos: V(0.86, 1.055), scale: [0.44 * s, 0.04 * s, 0.14 * s], color: 0x1e3a42 },
      ...tube([V(0.62, 1.02), V(0.88, 1.01), V(1.06, 1.0)], 0.2 * s, 0.11 * s, 0x7fae9a, { flat: 0.42 }),
      { kind: 'cone', pos: V(1.12, 1.14), rot: [0, 0, -HALF_PI], scale: [0.12 * s, 0.12 * s, 0.1 * s], color: dark, seg: 5 },
      ...fangs(0.74 * s, 0.08 * s, 1.07 * s, 0.055 * s, 5, 0.05 * s, true),
      ...fangs(0.76 * s, 0.08 * s, 1.03 * s, 0.05 * s, 5, 0.045 * s, false),
      ...eyes(0.58 * s, 1.29 * s, 0.115 * s, 0.045 * s, C.black, 0xf0d24a),
      ...mirZ([{ kind: 'box', pos: V(0.58, 1.34, 0.105), scale: [0.14 * s, 0.035 * s, 0.06 * s], color: dark }]),
      ...mirZ([{ kind: 'box', pos: V(1.06, 1.2, 0.045), scale: [0.05 * s, 0.03 * s, 0.025 * s], color: C.black }]),
    ]),
    // 팔 (스피노는 크고 발톱이 큼)
    ...mirZ([
      link(V(0.26, 0.82, 0.24), V(0.46, 0.66, 0.28), 0.11 * s, 0.1 * s, body, { kind: 'cyl', seg: 5, pad: 0.04 }),
      link(V(0.46, 0.66, 0.28), V(0.6, 0.54, 0.26), 0.09 * s, 0.08 * s, body, { kind: 'cyl', seg: 5, pad: 0.04 }),
    ]),
    ...mirZ(toes(0.64 * s, 0.5 * s, 0.26 * s, 0.035 * s, 0.16 * s, C.bone)),
  );
  // 등지느러미 돛 — 척추 가시 10개 (가운데가 가장 높음) + 막
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const x = (0.34 - t * 1.06) * s;
    const h = (0.24 + Math.sin(t * Math.PI) * 0.4) * s;
    const y = (0.92 - Math.abs(t - 0.3) * 0.14) * s;
    parts.push(
      { kind: 'box', pos: [x, y + h * 0.5, 0], scale: [0.085 * s, h, 0.055 * s], color: 0xe07a3a, hueJitter: 0.025, limb: backId },
      { kind: 'cone', pos: [x, y + h + 0.035 * s, 0], scale: [0.075 * s, 0.09 * s, 0.05 * s], color: 0xf0a04a, seg: 4, limb: backId },
    );
    if (i < 9) {
      parts.push({
        kind: 'box',
        pos: [x - 0.058 * s, y + h * 0.42, 0],
        scale: [0.055 * s, h * 0.86, 0.03 * s],
        color: 0xc85a2e,
        hueJitter: 0.02,
        limb: backId,
      });
    }
  }
  return parts;
}

function trex(rig: RigBuilder): PartSpec[] {
  const body = 0x7a4636;
  const belly = 0xd9b382;
  const dark = 0x4f2c20;
  const s = 1.25;
  const V = (x: number, y: number, z = 0): V3 => [x * s, y * s, z * s];
  const tailRoot = V(-0.44, 0.82);
  // 무거운 꼬리가 몸통 반대편에서 좌우로 휘두르며 균형을 잡는다(카운터밸런스).
  // y축 스윙이라 높이 변화가 0 → 거대한 진폭을 줘도 지면을 뚫지 않는다.
  const tailId = rig.add(tailRoot, [0, 1, 0], { amp: 0.1 });
  // 거대한 머리는 걸음마다 묵직하게 끄덕인다
  const headId = rig.add(V(0.5, 1.2), [0, 0, 1], { phase: HALF_PI, amp2: 0.045 });
  const parts = theropod(rig, { body, belly, dark, s, tail: tailId, legAmp: 0.34 });
  parts.push(
    ...tag(headId, [
      // 거대한 두개골 (목→주둥이로 이어지는 테이퍼 체인, 입선은 수평 유지)
      ...tubeW(
        [V(0.5, 1.22), V(0.66, 1.21), V(0.82, 1.19), V(0.96, 1.17)],
        [0.34 * s, 0.34 * s, 0.28 * s, 0.2 * s],
        body,
        { flat: 0.95, hueJitter: 0.012 },
      ),
      { kind: 'box', pos: V(0.62, 1.32), scale: [0.34 * s, 0.2 * s, 0.34 * s], color: body },
      { kind: 'box', pos: V(1.02, 1.17), scale: [0.1 * s, 0.14 * s, 0.18 * s], color: dark },
      // 벌린 입 안쪽 (어두운 구강)
      { kind: 'box', pos: V(0.8, 1.01), scale: [0.4 * s, 0.07 * s, 0.22 * s], color: 0x2e1a12 },
      // 아래턱 (살짝 벌림) + 목살
      { kind: 'box', pos: V(0.78, 0.94), rot: [0, 0, 0.07], scale: [0.44 * s, 0.1 * s, 0.23 * s], color: 0xb08d63 },
      { kind: 'box', pos: V(0.6, 0.99), scale: [0.22 * s, 0.16 * s, 0.28 * s], color: body },
      ...tube([V(0.4, 0.94), V(0.56, 1.0)], 0.26 * s, 0.22 * s, belly, { flat: 0.55 }),
      // 이빨 (위/아래 맞물림)
      ...fangs(0.68 * s, 0.09 * s, 1.03 * s, 0.085 * s, 5, 0.085 * s, true),
      ...fangs(0.68 * s, 0.09 * s, 0.985 * s, 0.08 * s, 5, 0.075 * s, false),
      // 눈 + 눈두덩 뿔
      ...eyes(0.66 * s, 1.32 * s, 0.15 * s, 0.05 * s, C.black, 0xf0c23a),
      ...mirZ([
        { kind: 'box', pos: V(0.68, 1.38, 0.14), rot: [0, 0, 0.06], scale: [0.24 * s, 0.06 * s, 0.09 * s], color: dark },
        { kind: 'cone', pos: V(0.7, 1.4, 0.13), rot: [-0.3, 0, -0.4], scale: [0.09 * s, 0.14 * s, 0.08 * s], color: dark, seg: 4 },
      ]),
      ...mirZ([{ kind: 'box', pos: V(0.98, 1.22, 0.055), scale: [0.05 * s, 0.04 * s, 0.03 * s], color: C.black }]),
      // 두개골 흉터
      { kind: 'box', pos: V(0.56, 1.34, 0.17), rot: [0, 0, 0.4], scale: [0.16 * s, 0.035 * s, 0.03 * s], color: 0xd94a2e },
    ]),
    // 작은 앞발 (2발톱)
    ...mirZ([
      link(V(0.26, 0.84, 0.22), V(0.42, 0.72, 0.26), 0.1 * s, 0.09 * s, body, { kind: 'cyl', seg: 5, pad: 0.04 }),
      link(V(0.42, 0.72, 0.26), V(0.52, 0.64, 0.24), 0.08 * s, 0.07 * s, body, { kind: 'cyl', seg: 5, pad: 0.03 }),
      { kind: 'cone', pos: V(0.58, 0.63, 0.27), rot: [0, -0.3, -1.1], scale: [0.03 * s, 0.12 * s, 0.03 * s], color: C.bone, seg: 4 },
      { kind: 'cone', pos: V(0.58, 0.61, 0.21), rot: [0, 0.3, -1.1], scale: [0.03 * s, 0.12 * s, 0.03 * s], color: C.bone, seg: 4 },
    ]),
    // 옆구리 흉터
    { kind: 'box', pos: V(-0.02, 0.94, 0.22), rot: [0.2, 0, -0.3], scale: [0.22 * s, 0.04 * s, 0.03 * s], color: 0xd94a2e },
  );
  // 등~꼬리 골판 (뒤로 갈수록 작아짐) — 꼬리 위 구간은 꼬리 그룹에 넣어야 어긋나지 않는다
  const plates = spines(arc(V(0.26, 1.02), V(-0.3, 1.08), V(-0.96, 0.74), 10), 0.2 * s, 0.05 * s, 0.09 * s, dark, 4, -0.45);
  parts.push(...plates.map((p) => ((p.pos?.[0] ?? 0) < tailRoot[0] ? { ...p, limb: tailId } : p)));
  return parts;
}

function golem(rig: RigBuilder): PartSpec[] {
  const rockC = 0x584641;
  const rockD = 0x43332f;
  const rockL = 0x6b5750;
  // 쿵쿵 내딛는 느낌:
  //  · 짧고 무거운 보폭(진폭 0.3, 다리 길이 0.6 → 1주기 0.71타일)
  //  · lift 를 크게 줘 스윙 발을 높이 들었다 떨군다. lift 항은 max(0,cos) 클램프라
  //    ±π/2 에서 꺾이는 **각진** 곡선이라 부드러운 사인보다 발놀림이 딱딱해진다.
  const [legL, legR] = rig.leg([-0.05, 0.6, 0.21], { amp: 0.3, lift: 0.09 });
  // 바위 팔은 다리 반대 위상. 주먹이 지면에 거의 닿을 만큼 길어서 ground 그룹으로
  // 등록해야(접지 테이블 포함) 흔들 때 주먹이 땅을 파고들지 않는다.
  const [armL, armR] = rig.pair([0.05, 0.9, 0.44], [0, 0, 1], { phase: Math.PI, amp: 0.13 }, true);
  /** 겹쳐 쌓은 바위 팔 — 슬래브가 아니라 덩어리로 */
  const rockArm = (sz: number): PartSpec[] => [
    { kind: 'ico', pos: [0.08, 0.8, 0.42 * sz], rot: [0.3, 0.7 * sz, 0.2], scale: [0.34, 0.3, 0.32], color: rockL },
    { kind: 'ico', pos: [0.12, 0.62, 0.46 * sz], rot: [0.9, 0.2 * sz, 0.5], scale: [0.3, 0.32, 0.3], color: rockD },
    { kind: 'ico', pos: [0.16, 0.44, 0.49 * sz], rot: [0.2, 1.1 * sz, 0.9], scale: [0.28, 0.3, 0.28], color: rockC },
    { kind: 'ico', pos: [0.2, 0.26, 0.51 * sz], rot: [0.6, 0.4 * sz, 0.3], scale: [0.3, 0.28, 0.3], color: rockD },
    { kind: 'ico', pos: [0.24, 0.15, 0.53 * sz], rot: [0.1, 0.9 * sz, 0.6], scale: [0.38, 0.3, 0.36], color: rockL },
    { kind: 'ico', pos: [0.38, 0.14, 0.53 * sz], rot: [0, 0.6 * sz, 0], scale: 0.2, color: rockC },
  ];
  const parts: PartSpec[] = [
    // 몸통 — 바위 덩어리 겹침
    { kind: 'ico', pos: [0, 0.64, 0], scale: [0.8, 0.74, 0.64], color: rockC, hueJitter: 0.014 },
    { kind: 'ico', pos: [-0.14, 0.8, 0], rot: [0.4, 0.5, 0], scale: [0.54, 0.46, 0.52], color: rockD },
    { kind: 'ico', pos: [0.18, 0.5, 0], rot: [0.2, 1.1, 0.3], scale: [0.54, 0.48, 0.52], color: rockL },
    ...mirZ([
      { kind: 'ico', pos: [-0.04, 0.68, 0.3], rot: [0.6, 0, 0.2], scale: [0.36, 0.4, 0.32], color: rockD },
      { kind: 'ico', pos: [0.12, 0.34, 0.24], rot: [0, 0.5, 0.4], scale: 0.3, color: rockC },
      { kind: 'ico', pos: [-0.24, 0.5, 0.22], rot: [0.3, 0.8, 0.1], scale: [0.3, 0.34, 0.28], color: rockL },
    ]),
    // 머리 (턱 벌어진 바위 + 발광 눈)
    { kind: 'ico', pos: [0.08, 1.1, 0], rot: [0.3, 0.4, 0.1], scale: [0.42, 0.38, 0.4], color: rockD },
    { kind: 'ico', pos: [0.24, 1.02, 0], rot: [0, 0.8, 0.3], scale: [0.26, 0.2, 0.3], color: rockC },
    { kind: 'box', pos: [0.26, 1.07, 0], scale: [0.16, 0.05, 0.25], color: C.lava },
    ...mirZ([
      { kind: 'ico', pos: [0.3, 1.15, 0.1], scale: 0.1, color: 0xffd24a },
      { kind: 'box', pos: [0.32, 1.24, 0.1], rot: [0, 0, 0.3], scale: [0.11, 0.05, 0.09], color: rockD },
    ]),
    // 어깨 바위 뿔
    ...mirZ([
      { kind: 'cone', pos: [-0.1, 1.0, 0.28], rot: [-0.6, 0, -0.3], scale: [0.17, 0.3, 0.17], color: rockL, seg: 5 },
      { kind: 'cone', pos: [-0.3, 0.84, 0.18], rot: [-0.3, 0, -0.9], scale: [0.14, 0.24, 0.14], color: rockC, seg: 5 },
    ]),
    ...tag(armL, rockArm(1)),
    ...tag(armR, rockArm(-1)),
    // 다리 (짧고 굵음)
    ...mirLimb(
      [
        { kind: 'ico', pos: [-0.06, 0.4, 0.2], rot: [0.4, 0.3, 0.2], scale: [0.32, 0.34, 0.32], color: rockD },
        { kind: 'ico', pos: [-0.04, 0.2, 0.22], rot: [0.1, 0.9, 0.4], scale: [0.3, 0.3, 0.3], color: rockC },
        { kind: 'ico', pos: [0.0, 0.13, 0.22], scale: [0.44, 0.2, 0.36], color: rockL },
      ],
      legL,
      legR,
    ),
  ];
  // 용암 균열 — 몸통/팔/다리를 감는 발광 띠.
  // 팔/다리 위에 얹힌 균열은 그 사지 그룹에 넣어야 따로 놀지 않는다 (0 = 몸통 고정).
  const cracks: Array<[V3, V3, number, number]> = [
    [[0.24, 0.74, 0.2], [-0.06, 0.58, 0.32], 0.06, 0],
    [[-0.06, 0.58, 0.32], [-0.22, 0.44, 0.2], 0.05, 0],
    [[0.12, 0.92, 0.18], [0.28, 0.76, 0.06], 0.055, 0],
    [[0.02, 0.88, -0.26], [-0.16, 0.66, -0.32], 0.055, 0],
    [[0.2, 0.52, -0.28], [0.3, 0.36, -0.14], 0.045, 0],
    [[0.1, 0.72, 0.44], [0.14, 0.54, 0.5], 0.05, armL],
    [[0.1, 0.72, -0.44], [0.14, 0.54, -0.5], 0.05, armR],
    [[0.18, 0.4, 0.52], [0.22, 0.24, 0.55], 0.05, armL],
    [[0.18, 0.4, -0.52], [0.22, 0.24, -0.55], 0.05, armR],
    [[-0.06, 0.32, 0.26], [0.0, 0.16, 0.3], 0.05, legL],
    [[-0.06, 0.32, -0.26], [0.0, 0.16, -0.3], 0.05, legR],
    [[0.3, 0.6, 0.1], [0.34, 0.44, 0.02], 0.045, 0],
  ];
  for (let i = 0; i < cracks.length; i++) {
    const [a, b, w, li] = cracks[i]!;
    parts.push({ ...link(a, b, w, w, i % 2 === 0 ? C.lava : 0xffa042, { pad: 0.02 }), limb: li });
  }
  // 등에 박힌 발광 결정
  for (let i = 0; i < 3; i++) {
    const a = -0.7 + i * 0.7;
    parts.push({
      kind: 'cone',
      pos: [-0.36 + Math.sin(a) * 0.06, 0.88 - i * 0.14, Math.sin(a) * 0.24],
      rot: [-a * 0.6, 0, -2.4],
      scale: [0.1, 0.26, 0.1],
      color: i === 1 ? 0xffb44a : C.lava,
      seg: 4,
    });
  }
  return parts;
}

const BUILDERS: Record<EnemyId, (rig: RigBuilder) => PartSpec[]> = {
  raptor,
  compy,
  trike,
  ptera,
  ankylo,
  boar,
  warrior,
  shaman,
  blade: (rig) => raiderSolo(rig, 1),
  lancer: (rig) => raiderSolo(rig, 2),
  archer: (rig) => raiderSolo(rig, 3),
  hexer: (rig) => raiderSolo(rig, 4),
  mammoth,
  spino,
  trex,
  golem,
};

/** 보스 계열 (개별 메시 + 스케일/색 강조 + 넓은 체력바) */
export const BOSS_ENEMIES: ReadonlySet<EnemyId> = new Set(['spino', 'trex']);

/**
 * 공격 한 주기 동안 **몸통이 앞뒤로 기우는 폭** (rad). 사지는 셰이더가 돌리지만
 * 몸통 전체는 인스턴스 행렬이 맡으므로(추가 유니폼 0) 여기 값만 뷰가 읽어 간다.
 * 젖힐 때 뒤로, 놓을 때 앞으로 — 팔만 도는 것과 온몸으로 던지는 것의 차이가 이 값이다.
 * 무거운 무기일수록 크다. 활(archer)은 조준이 흔들리면 안 되므로 가장 작다.
 * 값이 없는 종은 0 = 몸통 고정.
 */
const ATTACK_LEANS: Readonly<Partial<Record<EnemyId, number>>> = {
  blade: 1,
  lancer: 1.25,
  archer: 0.4,
  hexer: 0.7,
  warrior: 1.15,
};

/** 그 종의 몸통 기울임 배율 (0 = 기울지 않는다) */
export function enemyAttackLean(id: EnemyId): number {
  return ATTACK_LEANS[id] ?? 0;
}

/**
 * 보스를 그리는 배율. `views/enemyview.ts` 가 `pop * (boss ? BOSS_RENDER_SCALE : 1)` 로 쓴다.
 *
 * ⚠ 여기 두는 이유: 문간 정지선(`EnemyDef.restReach`)과 물기 포즈(`enemyGateLean`)가
 *   **월드 타일 단위**라 이 배율을 먹여야 뜻이 맞는다. 뷰에 숫자로 박혀 있으면 잣대가
 *   둘이 되어 보스만 조용히 어긋난다(`tests/render/gatepose.test.ts` 가 같은 출처를 읽는다).
 */
export const BOSS_RENDER_SCALE = 1.15;

/** 이 종을 그리는 배율 (보스 1.15, 나머지 1) */
export function enemyRenderScale(id: EnemyId): number {
  return BOSS_ENEMIES.has(id) ? BOSS_RENDER_SCALE : 1;
}

/**
 * 앞기울임 `L`(rad)일 때 몸 **앞끝**이 개체 중심에서 앞으로 뻗는 거리 (월드 타일).
 *
 * 뷰는 앞으로 숙일 때 로컬 Z 축으로 `pitch = −L` 을 준다(enemyview.ts). 그 회전에서
 * 모델 정점 `(x, y)` 의 전방 성분은 `x·cos L + y·sin L` 이므로, 앞끝은 그 최댓값이다.
 * **모델이 높을수록 같은 각에서 더 나간다** — 각을 상수로 두면 물기 깊이가 종마다
 * 제각각이 되는 이유가 이것이고, `enemyGateLean` 이 거꾸로 푸는 이유이기도 하다.
 */
export function enemyReachAt(id: EnemyId, lean: number): number {
  const p = buildEnemy(id).getAttribute('position').array as ArrayLike<number>;
  const c = Math.cos(lean);
  const sn = Math.sin(lean);
  let m = 0;
  for (let i = 0; i < p.length; i += 3) {
    const v = p[i]! * c + p[i + 1]! * sn;
    if (v > m) m = v;
  }
  return m * enemyRenderScale(id);
}

/** 정지 자세(각 0)의 앞끝 도달 — `EnemyDef.restReach` 가 베껴 든 값의 **원본**이다 */
export function enemyRestReach(id: EnemyId): number {
  return enemyReachAt(id, 0);
}

const gateLeans = new Map<EnemyId, number>();

/**
 * 문간에서 마을을 **무는 순간의 앞기울임**(rad) — 메시에서 역산한다.
 *
 * 푸는 식은 한 줄이다: `reach(L) − restReach = GATE_BITE_DEPTH`.
 * 그러면 코끝이 `(edge + rest) − (rest + depth)` = **`edge − depth` 로 전 종 동일**해진다
 * (balance.ts `GATE_BITE_DEPTH`). 각이 아니라 폭을 고정하는 것이 이 함수의 존재 이유다.
 *
 * ── 닫힌 해 (수치 탐색이 아니다) ─────────────────────────────────────────
 * 정점 `(x, y)` 를 극좌표 `R = hypot(x, y)` · `φ = atan2(y, x)` 로 보면 전방 성분이
 * `R·cos(L − φ)` 다. 곧 그 정점이 목표 `T = rest + depth` 를 넘기는 각의 구간은
 * `|L − φ| ≤ acos(T/R)` 이고, 그 구간의 **왼쪽 끝**이 그 정점이 목표에 처음 닿는 각이다.
 * 전체 답은 정점별 왼쪽 끝의 **최솟값**이므로 정점 배열 한 번 훑기로 정확히 나온다
 * (이분법은 `reach` 가 단조라는 보장이 없어 첫 교차를 놓칠 수 있다 — 그래서 안 쓴다).
 *
 * ── ⚠⚠ 못 닿는 종이 있다. 잘라서 돌려준다 ────────────────────────────────
 * 낮고 납작한 종은 `R` 최댓값 자체가 `T` 보다 작아 **어떤 각으로도** 목표 폭에 못 닿는다
 * (실측 상한: ankylo 0.069 · ptera 0.100 · boar 0.136 · compy 0.159 < 0.20). 그때는
 * `GATE_LEAN_MAX` 를 그대로 돌려주는데, 그 값이 옛 구현의 최대 앞기울임과 같아
 * **오늘과 한 라디안도 다르지 않은 포즈**가 된다. 곧 이 함수가 자세를 바꾸는 종은
 * 목표보다 **더 깊이 물던 종뿐**이다.
 */
export function enemyGateLean(id: EnemyId): number {
  let v = gateLeans.get(id);
  if (v !== undefined) return v;
  const scale = enemyRenderScale(id);
  // 모델 단위로 푼다 — 월드 폭을 배율로 나눠 목표를 옮긴다
  const target = enemyRestReach(id) / scale + GATE_BITE_DEPTH / scale;
  const p = buildEnemy(id).getAttribute('position').array as ArrayLike<number>;
  let best = GATE_LEAN_MAX;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!;
    const y = p[i + 1]!;
    const r = Math.hypot(x, y);
    if (r < target) continue; // 이 정점은 어떤 각에서도 목표에 못 닿는다
    const lo = Math.atan2(y, x) - Math.acos(Math.min(1, target / r));
    if (lo < best) best = Math.max(0, lo);
  }
  v = Math.min(GATE_LEAN_MAX, best);
  gateLeans.set(id, v);
  return v;
}

/**
 * 지오메트리를 공유하는 종 → 변형 번호(1-base).
 * 같은 지오메트리 키를 쓰므로 EnemyView 가 **하나의 InstancedMesh** 로 묶어 그린다.
 */
const RAIDER_VARIANTS: Readonly<Partial<Record<EnemyId, number>>> = {
  blade: 1,
  lancer: 2,
  archer: 3,
  hexer: 4,
};

/** 공유 지오메트리 키 (EnemyId 와 겹치지 않는 이름) */
export const RAIDER_GEO_KEY = 'raider';

/** 이 종이 어떤 지오메트리를 쓰는가 — 뷰가 메시를 묶는 기준 키 */
export function enemyGeoKey(id: EnemyId): string {
  return RAIDER_VARIANTS[id] !== undefined ? RAIDER_GEO_KEY : id;
}

/** 공유 지오메트리 안에서 이 종이 쓰는 변형 번호 (0 = 전용 지오메트리) */
export function enemyVariant(id: EnemyId): number {
  return RAIDER_VARIANTS[id] ?? 0;
}

/**
 * 아군 부족원의 변형 번호 — **아군 전용 지오메트리(ALLY_GEO_KEY) 안에서의** 번호다.
 *
 * 3단계까지는 습격대와 한 지오메트리를 써서 5~7이었다. 5단계에서 갈라 1~3이 됐다 —
 * 근거는 RAIDER_KITS 주석(삼각형 3만을 드로우콜 1개로 산다). 몸통·리그는 그대로 공유한다.
 *
 * ⚠ **ALL_ALLY_IDS 순서와 다르다.** 채집꾼이 넷 중 가장 싸서 ALL_ALLY_IDS 에서는
 * 맨 앞이지만(data/allies.ts), 여기 번호는 ALLY_KITS/ALLY_ATTACKS 배열의 인덱스+1이라
 * **맨 뒤인 4**다. 앞에 끼워 넣으면 기존 셋의 장비와 공격 포즈가 통째로 한 칸씩 밀린다.
 */
const ALLY_VARIANTS: Readonly<Record<AllyId, number>> = {
  clubber: 1,
  slinger: 2,
  guardian: 3,
  gatherer: 4,
};

/** 아군 공유 지오메트리 키 (EnemyId 와도 RAIDER_GEO_KEY 와도 겹치지 않는 이름) */
export const ALLY_GEO_KEY = 'ally';

/**
 * 아군 인스턴스 색조 (instanceColor 곱). 적은 원색 그대로(1,1,1)다.
 *
 * 1단계의 [0.62, 0.9, 1.35]는 **모델이 임시 배선이던 시절의 값**이다. 그때는 아군이
 * 적 장비를 그대로 빌려 써서 색조만이 유일한 구분 수단이었고, 그래서 온몸을 파랗게
 * 물들일 수밖에 없었다(살결까지 파래져 "얼어붙은 적"처럼 보이는 대가를 치렀다).
 *
 * 이제 흰 털 두건·어깨 목도리·하늘빛 옷·부족기가 **구워져 있으므로** 색조는 그 위에
 * 얹는 보정으로 물러난다. 값을 여기까지 줄인 근거:
 *  · 강한 파랑을 그대로 두면 흰 털(0.97,0.94,0.87)이 B 채널만 크게 튀어 하늘색
 *    덩어리가 되고, 애써 만든 **명도 대비(밝은 흰색)** 가 색상 대비로 바뀌어
 *    lancer 의 청록과 다시 가까워진다.
 *  · 그래도 0을 주지 않는 이유는 팔다리·몸통·얼굴(살결/가죽)이 적과 **완전히 같은
 *    정점**이기 때문이다. 거기만 살짝 차갑게 밀어 두면 두건이 가려지는 각도에서도
 *    "따뜻한 적 / 서늘한 아군"이 남는다.
 */
export const ALLY_TINT: readonly [number, number, number] = [0.86, 0.98, 1.16];

/** 아군이 쓰는 지오메트리 키 — 습격대와 몸통은 같고 구워지는 단위만 다르다 */
export function allyGeoKey(): string {
  return ALLY_GEO_KEY;
}

/** 아군 공유 지오메트리 (전투용). 뷰가 전용 InstancedMesh 하나로 그린다 */
export function buildAlly(): THREE.BufferGeometry {
  return asset(ALLY_GEO_KEY, allyShared).geo;
}

/** 공유 지오메트리 안에서 이 아군이 쓰는 변형 번호 */
export function allyVariant(id: AllyId): number {
  return ALLY_VARIANTS[id];
}

/**
 * 그 아군만 담은 단품 지오메트리 (갤러리/도감용).
 * 전투 경로는 변형 마스킹 셰이더가 골라 그리지만 meshlab 은 공유 flatMat 을 쓰므로
 * 공유본을 그대로 주면 장비 7벌이 한 몸에 다 붙어 나온다.
 */
export function buildAllySolo(id: AllyId): THREE.BufferGeometry {
  return asset(`solo:ally:${id}`, (rig) =>
    raiderSolo(rig, ALLY_VARIANTS[id], ALLY_KITS, allyLivery),
  ).geo;
}

/**
 * 아군 보행 리그. 몸통 코드(raiderBody)가 같으므로 사지 구성도 습격대와 같지만,
 * **접지 보정 테이블은 실제로 구운 버텍스에서 뽑히므로** 아군 지오메트리 것을 써야 한다
 * (장비가 달라 발밑 최저점이 갈릴 수 있다 — asset()이 지오메트리별로 계산한다).
 */
export function allyRig(): EnemyRig {
  return asset(ALLY_GEO_KEY, allyShared).rig;
}

interface EnemyAsset {
  geo: THREE.BufferGeometry;
  rig: EnemyRig;
}

/** 지오메트리와 사지 테이블은 같은 빌더 1회 실행에서 나오므로 함께 캐시한다 */
const assets = new Map<string, EnemyAsset>();

function asset(key: string, build: (rig: RigBuilder) => PartSpec[]): EnemyAsset {
  let a = assets.get(key);
  if (!a) {
    const builder = new RigBuilder();
    const parts = build(builder);
    const geo = cachedGeo(`enemy:${key}`, () => buildParts(parts, { seed: 77, ao: 0.12 }));
    // 접지 보정 테이블은 실제 구운 버텍스에서 뽑는다 (발 모양을 손으로 재지 않게)
    a = { geo, rig: computeGroundLift(geo, builder.build()) };
    assets.set(key, a);
  }
  return a;
}

function assetOf(id: EnemyId): EnemyAsset {
  const key = enemyGeoKey(id);
  return asset(key, key === RAIDER_GEO_KEY ? raiderShared : BUILDERS[id]);
}

/**
 * 캐시된 적 지오메트리 (전방 +x, 발 y=0).
 * 부족 습격대 4종은 **같은 객체**를 돌려준다 — 장비는 variant 어트리뷰트로 골라 그린다.
 */
export function buildEnemy(id: EnemyId): THREE.BufferGeometry {
  return assetOf(id).geo;
}

/**
 * 그 종만 담은 단품 지오메트리 (갤러리/도감용).
 * 전투 경로는 변형 마스킹 셰이더가 있지만 meshlab 은 공유 flatMat 을 쓰므로
 * 공유 지오메트리를 그대로 주면 무기 4종이 한 몸에 다 붙어 나온다.
 */
export function buildEnemySolo(id: EnemyId): THREE.BufferGeometry {
  return enemyVariant(id) > 0 ? asset(`solo:${id}`, BUILDERS[id]).geo : buildEnemy(id);
}

/** 종별 보행 리그(사지 테이블). limbs.length === 0 이면 아직 태깅 안 한 종 */
export function enemyRig(id: EnemyId): EnemyRig {
  return assetOf(id).rig;
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
  'blade',
  'lancer',
  'archer',
  'hexer',
  'mammoth',
  'spino',
  'trex',
  'golem',
];
