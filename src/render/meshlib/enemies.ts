/**
 * 적 12종 로우폴리 모델. 전방 = +x, 발바닥 y=0.
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
import type { EnemyId } from '@/data/types';
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

// --- 적 12종 ---------------------------------------------------------------

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
  mammoth,
  spino,
  trex,
  golem,
};

/** 보스 계열 (개별 메시 + 스케일/색 강조 + 넓은 체력바) */
export const BOSS_ENEMIES: ReadonlySet<EnemyId> = new Set(['spino', 'trex']);

interface EnemyAsset {
  geo: THREE.BufferGeometry;
  rig: EnemyRig;
}

/** 지오메트리와 사지 테이블은 같은 빌더 1회 실행에서 나오므로 함께 캐시한다 */
const assets = new Map<EnemyId, EnemyAsset>();

function asset(id: EnemyId): EnemyAsset {
  let a = assets.get(id);
  if (!a) {
    const builder = new RigBuilder();
    const parts = BUILDERS[id](builder);
    const geo = cachedGeo(`enemy:${id}`, () => buildParts(parts, { seed: 77, ao: 0.12 }));
    // 접지 보정 테이블은 실제 구운 버텍스에서 뽑는다 (발 모양을 손으로 재지 않게)
    a = { geo, rig: computeGroundLift(geo, builder.build()) };
    assets.set(id, a);
  }
  return a;
}

/** 캐시된 적 지오메트리. 전방 +x, 발 y=0 */
export function buildEnemy(id: EnemyId): THREE.BufferGeometry {
  return asset(id).geo;
}

/** 종별 보행 리그(사지 테이블). limbs.length === 0 이면 아직 태깅 안 한 종 */
export function enemyRig(id: EnemyId): EnemyRig {
  return asset(id).rig;
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
