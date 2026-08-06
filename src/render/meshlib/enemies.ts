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
import { clamp } from '@/core/mathx';
import { C } from '../palette';
import { buildParts, cachedGeo, type PartSpec } from './factory';
import { RigBuilder, computeGroundLift, type EnemyRig } from './gait';

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
  const shieldArm = rig.add([0, 0.76, 0.16], [0, 0, 1], { phase: Math.PI, amp: 0.24 });
  // 곤봉은 어깨 뒤로 넘겨 든 무거운 돌덩이라 진폭을 줄인다
  const clubArm = rig.add([0, 0.76, -0.16], [0, 0, 1], { amp: 0.14 });
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
 *   blade  머리띠 · 세워 든 돌칼   · 붉은 염료
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
}

/** 4종 공용 몸통 — 다리·팔·머리 리그를 여기서 전부 등록한다 */
function raiderBody(rig: RigBuilder): { parts: PartSpec[]; ids: RaiderIds } {
  const skin = RAIDER_SKIN;
  const hip: V3 = [0, 0.205, 0.072];
  // 짧고 굵은 다리 = 짧은 보폭(1주기 0.35타일) = 총총거리는 걸음.
  // 작고 귀여운 인상의 절반은 여기서 나온다 — 다리가 길면 곧바로 '작은 어른'이 된다.
  const [legL, legR] = rig.leg(hip, { amp: 0.44 });
  // 사람 걸음은 다리와 **반대쪽** 팔이 나간다. 좌측 다리가 위상 0 이므로 좌측 팔에 π 를 준다.
  const [armL, armR] = rig.pair([0, 0.42, 0.105], [0, 0, 1], { phase: Math.PI, amp: 0.34 });
  // 큰 머리가 걸음마다 까딱인다(2배 주파수) — 2.5등신에서 가장 눈에 띄는 2차 모션
  const head = rig.add([0, 0.45, 0], [0, 0, 1], { phase: HALF_PI, amp2: 0.06 });
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
  return { parts, ids: { armL, armR, head } };
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

/** 칼잡이 — 붉은 머리띠 + 세워 든 돌칼 */
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
    // 돌칼 — 세워 들되 앞으로 살짝 기울인다. 날 끝이 머리보다 위로 올라와야
    // 위에서 내려다보는 카메라에서 '칼을 든 실루엣'으로 읽힌다.
    ...tag(ids.armR, [
      link([0.1, 0.225, -0.132], [0.114, 0.305, -0.132], 0.042, 0.042, C.wood, { kind: 'cyl', seg: 4 }),
      { kind: 'box', pos: [0.116, 0.322, -0.132], scale: [0.062, 0.028, 0.15], color: C.boneDark },
      { kind: 'box', pos: [0.142, 0.472, -0.132], rot: [0, 0, -0.18], scale: [0.072, 0.3, 0.036], color: 0xd9d4c6 },
      { kind: 'cone', pos: [0.172, 0.638, -0.132], rot: [0, 0, -0.18], scale: [0.072, 0.085, 0.036], color: 0xd9d4c6, seg: 4 },
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
    // 창 (오른팔) — 앞으로 기울여 세운다. 실루엣에서 blade 와 즉시 갈린다.
    ...tag(ids.armR, [
      link([0.045, 0.075, -0.138], [0.21, 0.64, -0.138], 0.036, 0.036, C.wood, { kind: 'cyl', seg: 4 }),
      { kind: 'box', pos: [0.163, 0.49, -0.138], scale: [0.05, 0.034, 0.055], color: C.rope },
      { kind: 'cone', pos: [0.238, 0.725, -0.138], rot: [0, 0, -0.28], scale: [0.06, 0.18, 0.05], color: C.bone, seg: 4 },
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

// --- 아군 마을 부족원 3종 (clubber / slinger / guardian) ---------------------
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
 * 세 종의 구분(2차 판독)은 무기가 맡고, **HUD 출동 바 아이콘과 같은 물건**을 쥔다
 * (ui/widgets/card.ts: 몽둥이 / 무릿매 돌 / 큰 방패).
 */
// 진영색은 palette.C 가 유일한 출처다 — 마을 깃발(basecamp.ts)이 같은 값을 읽는다
const ALLY_FUR = C.allyFur;
const ALLY_FUR_D = C.allyFurDark;
const ALLY_SKY = C.allySky;
const ALLY_SKY_D = C.allySkyDark;

/**
 * 아군 3종 공통 제복 — 흰 털 두건 + 어깨 목도리 + 하늘빛 옷 + 등에 세운 부족기.
 * 세 kit 이 똑같이 부르므로 지오메트리에 3벌이 구워진다(변형 태그가 정점 단위라
 * "5·6·7 공통"을 표현할 수단이 없다). 파트 11개 × 3벌 ≈ 400삼각형 — 공유 지오메트리가
 * 그만큼 무거워지지만 인스턴스당 1,860→1,960 수준이라 삼각형 예산(150k)에 여유가 있다.
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
    /**
     * 등에 멘 부족기 (몸통 고정 — 팔과 따로 논다). 적에게 없는 유일한 '위로 솟은 등짐'.
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
    link([-0.085, 0.4, 0.1], [-0.196, 0.93, 0.155], 0.028, 0.028, C.woodDark, { kind: 'cyl', seg: 4 }),
    { kind: 'box', pos: [-0.243, 0.9, 0.155], rot: [0, 0, 0.16], scale: [0.042, 0.2, 0.19], color: ALLY_SKY, hueJitter: 0.02 },
    { kind: 'cone', pos: [-0.223, 0.776, 0.155], rot: [Math.PI, 0, 0.16], scale: [0.17, 0.105, 0.042], color: ALLY_SKY_D, seg: 3 },
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

/** 몽둥이꾼 — 굵고 짧은 나무 몽둥이 (돌 박은 혹). blade 의 얇고 긴 돌칼과 실루엣이 갈린다 */
function kitClubber(ids: RaiderIds): PartSpec[] {
  return [
    ...allyLivery(ids),
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
    ...allyLivery(ids),
    ...tag(ids.armR, [
      ...tube(arc([0.12, 0.28, -0.13], [0.36, 0.66, -0.1], [0.07, 0.84, 0.03], 3), 0.024, 0.019, C.rope, { flat: 1 }),
      { kind: 'ico', pos: [0.06, 0.86, 0.04], scale: [0.115, 0.115, 0.11], color: C.stone },
    ]),
    // 허리에 찬 돌주머니 (몸통 고정) — "던질 것을 들고 다닌다"가 읽힌다
    { kind: 'cyl', pos: [-0.06, 0.255, 0.2], rot: [0.2, 0, 0.3], scale: [0.16, 0.16, 0.15], color: RAIDER_HIDE_D, seg: 5 },
    { kind: 'ico', pos: [-0.05, 0.33, 0.21], scale: [0.085, 0.07, 0.08], color: C.stoneDark },
  ];
}

/**
 * 방패 파수꾼 — 몸을 통째로 가리는 **큰 세로 방패** + 짧은 돌도끼.
 * lancer 도 방패를 들지만 그건 작은 원형이고 무기가 머리 위로 길게 솟는다.
 * guardian 은 정반대다: 방패가 크고 세로로 길며, **위로 솟는 선이 없다**.
 */
function kitGuardian(ids: RaiderIds): PartSpec[] {
  return [
    ...allyLivery(ids),
    ...tag(ids.armL, [
      { kind: 'box', pos: [0.15, 0.36, 0.168], rot: [0, 0, 0.05], scale: [0.05, 0.5, 0.38], color: C.woodDark },
      { kind: 'box', pos: [0.178, 0.36, 0.168], rot: [0, 0, 0.05], scale: [0.035, 0.42, 0.3], color: ALLY_FUR_D, hueJitter: 0.02 },
      { kind: 'box', pos: [0.196, 0.36, 0.168], scale: [0.03, 0.38, 0.07], color: ALLY_SKY },
      { kind: 'cone', pos: [0.212, 0.36, 0.168], rot: [0, 0, -HALF_PI], scale: [0.095, 0.06, 0.095], color: C.stone, seg: 5 },
    ]),
    ...tag(ids.armR, [
      link([0.1, 0.238, -0.132], [0.128, 0.4, -0.132], 0.042, 0.042, C.wood, { kind: 'cyl', seg: 4 }),
      { kind: 'box', pos: [0.164, 0.442, -0.132], rot: [0, 0, -0.34], scale: [0.17, 0.085, 0.052], color: C.stoneDark },
    ]),
  ];
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

/** 아군 마을 부족원 장비 3벌 — 같은 몸통, 다른 지오메트리 (변형 1~3) */
const ALLY_KITS: readonly ((ids: RaiderIds) => PartSpec[])[] = [
  kitClubber,
  kitSlinger,
  kitGuardian,
];

/** 장비 배열 하나를 몸통에 얹어 굽는 공통 경로 (변형 태그 1-base) */
function sharedWithKits(
  rig: RigBuilder,
  kits: readonly ((ids: RaiderIds) => PartSpec[])[],
): PartSpec[] {
  const { parts, ids } = raiderBody(rig);
  const out = [...parts];
  kits.forEach((kit, i) => out.push(...tagVariant(i + 1, kit(ids))));
  return out;
}

/** 전투용 습격대 공유 지오메트리 — 몸통 1벌 + 장비 4벌(각각 variant 태그) */
function raiderShared(rig: RigBuilder): PartSpec[] {
  return sharedWithKits(rig, RAIDER_KITS);
}

/** 전투용 아군 공유 지오메트리 — 같은 몸통 + 장비 3벌 */
function allyShared(rig: RigBuilder): PartSpec[] {
  return sharedWithKits(rig, ALLY_KITS);
}

/** 갤러리/단품용 — 그 종의 장비만 굽는다 (variant 태그 없음) */
function raiderSolo(
  rig: RigBuilder,
  variant: number,
  kits: readonly ((ids: RaiderIds) => PartSpec[])[] = RAIDER_KITS,
): PartSpec[] {
  const { parts, ids } = raiderBody(rig);
  const kit = kits[variant - 1];
  return kit ? [...parts, ...kit(ids)] : parts;
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
 */
const ALLY_VARIANTS: Readonly<Record<AllyId, number>> = {
  clubber: 1,
  slinger: 2,
  guardian: 3,
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
  return asset(`solo:ally:${id}`, (rig) => raiderSolo(rig, ALLY_VARIANTS[id], ALLY_KITS)).geo;
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
