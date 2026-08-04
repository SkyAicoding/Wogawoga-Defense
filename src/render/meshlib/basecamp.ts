/**
 * 기지(아군 원시부족 마을) — 큰 돌 화덕 모닥불을 중심으로 가죽 움막·짚 움막·
 * 가죽 차양, 뼈/나무 목책, 토템 기둥, 가죽 건조대, 항아리·바구니, 사냥 도구
 * 더미, 통나무 의자, 고기 굽는 꼬치대, 뼈 아치 입구가 둘러싼 디오라마.
 *
 * 피해 단계(0=온전 / 1=파손 / 2=반파)별 배리에이션을 미리 만들어 visible 토글.
 * 세 배리에이션 모두 상주하지만 그려지는 건 항상 1개(메시 2개 = 드로우콜 2).
 * 연기 강도 등 동적 연출은 파티클 훅(smokeLevel)으로 상위에서 처리.
 *
 * 좌표 규약: 모닥불이 로컬 원점, 마을 구조물은 -z(뒤편)에 배치.
 * fireOffset(0,0.5,0)은 파티클 스폰 위치이므로 화덕을 원점에서 옮기지 말 것.
 */
import * as THREE from 'three';
import { C, flatMat, glowMat } from '../palette';
import { buildParts, type PartSpec } from './factory';

export interface Basecamp {
  group: THREE.Group;
  /** 0=온전 / 1=파손 / 2=반파 */
  setDamageLevel(level: 0 | 1 | 2): void;
  /** 파티클 훅용: 현재 연기 강도 0~2 */
  readonly smokeLevel: () => number;
  /** 모닥불 월드 오프셋 (파티클 스폰 위치) */
  fireOffset: THREE.Vector3;
  dispose(): void;
}

type Lv = 0 | 1 | 2;

/** 색 명도 배율 — 같은 계열 안에서 면을 나눠 각진 결/그을음을 표현 */
function shade(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/** 피해 단계별 그을림 — 반파일수록 어둡고 탁하게 */
function soot(hex: number, lv: Lv): number {
  return lv === 0 ? hex : shade(hex, lv === 1 ? 0.84 : 0.66);
}

/** 뒤집힌 원뿔 = 밑동 플레어 / 항아리 목 / 갓 테두리 */
function flare(x: number, y: number, z: number, r: number, h: number, color: number, seg = 6): PartSpec {
  return { kind: 'cone', pos: [x, y, z], rot: [Math.PI, 0, 0], scale: [r, h, r], color, seg };
}

/** 세로 기둥 (말뚝/장대) */
function post(
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  color: number,
  seg = 5,
  rot: [number, number, number] = [0, 0, 0],
): PartSpec {
  return { kind: 'cyl', pos: [x, y, z], rot, scale: [r, h, r], color, seg };
}

// --- 화덕 -----------------------------------------------------------------

const HEARTH_R = 0.46;

/** 마을 전체가 올라앉는 다진 흙바닥 — 소품 더미가 아니라 '정착지'로 읽히게 한다 */
function ground(lv: Lv): PartSpec[] {
  // 겹친 원반 4장으로 원형이 아닌 불규칙 윤곽을 만든다 (타일 상면 y≈0 위로 살짝)
  const dirt = lv === 2 ? 0x827058 : 0x9c8259;
  return [
    { kind: 'cyl', pos: [0, 0.024, -0.15], scale: [2.2, 0.045, 2.2], color: dirt, seg: 12, hueJitter: 0.02 },
    { kind: 'cyl', pos: [0.52, 0.026, 0.52], scale: [1.3, 0.048, 1.3], color: shade(dirt, 1.07), seg: 9, hueJitter: 0.02 },
    { kind: 'cyl', pos: [-0.86, 0.026, 0.3], scale: [1.08, 0.048, 1.08], color: shade(dirt, 0.93), seg: 8, hueJitter: 0.02 },
    // 기지 셀은 맵 가장자리에서 1칸 안쪽이라 어느 방향이든 반경 1.45를 넘으면
    // 흙바닥이 허공으로 삐져나온다 (stage3은 -z가 낭떠러지) — 넘지 않게 유지할 것
    { kind: 'cyl', pos: [-0.15, 0.026, -0.95], scale: [0.95, 0.048, 0.95], color: shade(dirt, 1.03), seg: 8, hueJitter: 0.02 },
  ];
}

/** 돌 화덕 + 재 원반 + 장작 + 잉걸 */
function hearth(lv: Lv): PartSpec[] {
  const stone = lv === 2 ? 0x5a5450 : C.stone;
  const parts: PartSpec[] = [
    { kind: 'ico', pos: [0, 0.03, 0], rot: [0, 0.3, 0], scale: [1.05, 0.05, 1.05], color: 0x7d6742, hueJitter: 0.02 },
    { kind: 'cyl', pos: [0, 0.06, 0], scale: [0.62, 0.05, 0.62], color: lv === 2 ? 0x3a3430 : 0x4e463e, seg: 8 },
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    parts.push({
      kind: 'ico',
      pos: [Math.cos(a) * HEARTH_R, 0.09, Math.sin(a) * HEARTH_R],
      rot: [i * 0.7, i * 1.3, i * 0.4],
      scale: [0.21, 0.18, 0.19],
      color: i % 2 ? stone : shade(stone, 0.86),
      hueJitter: 0.012,
    });
  }
  const logColor = lv === 2 ? 0x2e2622 : C.woodDark;
  parts.push(
    post(0, 0.1, 0, 0.09, 0.52, logColor, 5, [0, 0.5, 1.35]),
    post(0, 0.12, 0, 0.09, 0.5, shade(logColor, 0.8), 5, [1.35, 0.9, 0]),
  );
  if (lv < 2) parts.push(post(0.02, 0.14, -0.02, 0.08, 0.46, shade(logColor, 1.15), 5, [0.7, 2.1, 0.9]));
  parts.push(
    { kind: 'ico', pos: [-0.12, 0.07, 0.1], scale: [0.14, 0.08, 0.13], color: lv === 2 ? 0x6a3a20 : C.ember },
    { kind: 'ico', pos: [0.13, 0.06, -0.09], scale: [0.11, 0.07, 0.1], color: lv === 2 ? 0x5a3018 : 0xff7a28 },
  );
  return parts;
}

/** 발광 불꽃 — 피해가 클수록 모닥불은 작아지고 잔해에 불길이 붙는다 */
function flames(lv: Lv): PartSpec[] {
  const s = lv === 0 ? 1 : lv === 1 ? 0.76 : 0.48;
  const parts: PartSpec[] = [
    { kind: 'cone', pos: [0, 0.32 * s + 0.1, 0], scale: [0.4 * s, 0.64 * s, 0.4 * s], color: C.fire, seg: 6 },
    { kind: 'cone', pos: [0.04, 0.26 * s + 0.1, 0.03], scale: [0.25 * s, 0.44 * s, 0.25 * s], color: 0xffd24a, seg: 5 },
  ];
  if (lv === 0) {
    parts.push(
      { kind: 'cone', pos: [-0.19, 0.26, 0.13], rot: [0, 0, 0.42], scale: [0.16, 0.36, 0.16], color: C.ember, seg: 4 },
      { kind: 'cone', pos: [0.2, 0.24, -0.14], rot: [0, 0, -0.4], scale: [0.14, 0.32, 0.14], color: 0xffb43a, seg: 4 },
    );
  }
  if (lv === 2) {
    // 무너진 움막 잔해에 붙은 불
    parts.push(
      { kind: 'cone', pos: [-0.86, 0.24, -0.46], scale: [0.19, 0.36, 0.19], color: C.ember, seg: 4 },
      { kind: 'cone', pos: [-1.04, 0.18, -0.62], scale: [0.13, 0.26, 0.13], color: C.fire, seg: 4 },
      { kind: 'cone', pos: [0.3, 0.16, -1.0], scale: [0.12, 0.24, 0.12], color: 0xffb43a, seg: 4 },
    );
  }
  return parts;
}

// --- 움막 -----------------------------------------------------------------

const HUT_A: [number, number] = [-0.84, -0.46];
const HUT_B: [number, number] = [0.26, -0.92];
const HUT_C: [number, number] = [0.98, -0.2];

/** 가죽 돔 움막 (마을에서 가장 큰 집) */
function hideHut(lv: Lv): PartSpec[] {
  const [x, z] = HUT_A;
  const hide = soot(C.hide, lv);
  const hideD = soot(C.hideDark, lv);
  const wood = soot(C.woodDark, lv);

  if (lv === 2) {
    // 붕괴 + 불타는 잔해
    return [
      { kind: 'ico', pos: [x, 0.09, z], rot: [0.3, 0.5, 0.1], scale: [0.9, 0.2, 0.86], color: 0x4a3a2c, hueJitter: 0.02 },
      { kind: 'ico', pos: [x - 0.22, 0.16, z + 0.18], rot: [0.9, 0.2, 0.6], scale: [0.42, 0.24, 0.38], color: 0x3a2c20 },
      { kind: 'ico', pos: [x + 0.24, 0.13, z - 0.2], rot: [0.4, 1.2, 0.3], scale: [0.36, 0.2, 0.34], color: 0x2e241c },
      { kind: 'cone', pos: [x + 0.3, 0.16, z + 0.26], rot: [1.35, 0.4, 0], scale: [0.56, 0.4, 0.56], color: shade(hideD, 0.7), seg: 7 },
      post(x - 0.34, 0.24, z - 0.1, 0.07, 0.52, wood, 4, [0.35, 0, 0.55]),
      post(x + 0.1, 0.2, z - 0.34, 0.065, 0.46, wood, 4, [-0.6, 0, 0.2]),
      post(x - 0.06, 0.28, z + 0.3, 0.06, 0.58, shade(wood, 0.75), 4, [0.9, 0.4, -0.3]),
      post(x + 0.36, 0.14, z - 0.02, 0.055, 0.4, wood, 4, [0, 0.3, 1.2]),
      { kind: 'box', pos: [x - 0.5, 0.05, z + 0.36], rot: [0, 0.6, 0.1], scale: [0.34, 0.07, 0.22], color: 0x2a2018 },
      { kind: 'box', pos: [x + 0.44, 0.04, z + 0.1], rot: [0, -0.4, 0], scale: [0.28, 0.06, 0.18], color: 0x241c16 },
      { kind: 'box', pos: [x - 0.1, 0.05, z - 0.5], rot: [0, 1.1, 0.08], scale: [0.3, 0.06, 0.2], color: 0x2a2018 },
      { kind: 'ico', pos: [x - 0.62, 0.03, z - 0.3], rot: [0.2, 0.4, 0], scale: [0.36, 0.06, 0.32], color: 0x584f48 },
    ];
  }

  const tilt = lv === 1 ? 0.16 : 0;
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [x, 0.2, z], scale: [0.94, 0.4, 0.94], color: hideD, seg: 8, hueJitter: 0.015 },
    { kind: 'cone', pos: [x, 0.66, z], rot: [tilt, 0.3, tilt * 0.6], scale: [1.04, 0.44, 1.04], color: shade(hide, 1.14), seg: 8, hueJitter: 0.02 },
    { kind: 'cone', pos: [x + tilt * 0.5, 0.92, z], rot: [tilt, 0.3, tilt * 0.6], scale: [0.54, 0.3, 0.54], color: shade(hide, 1.16), seg: 8 },
    { kind: 'cyl', pos: [x + tilt * 0.8, 1.05, z], scale: [0.19, 0.05, 0.19], color: wood, seg: 6 },
    // 꼭대기에서 교차하는 지지 장대 3개 (짧게 — 실루엣을 어지럽히지 않도록)
    { kind: 'cone', pos: [x + tilt * 0.9 - 0.03, 1.13, z + 0.02], rot: [0.16, 0, 0.12], scale: [0.038, 0.2, 0.038], color: wood, seg: 4 },
    { kind: 'cone', pos: [x + tilt * 0.9 + 0.04, 1.12, z - 0.03], rot: [-0.14, 0, -0.16], scale: [0.036, 0.18, 0.036], color: shade(wood, 1.2), seg: 4 },
  ];
  if (lv === 0) {
    parts.push(
      { kind: 'cyl', pos: [x, 0.43, z], scale: [0.98, 0.07, 0.98], color: shade(hide, 1.24), seg: 8 },
      // 부족 문양 띠 — 갈색 일변도를 깨는 색 포인트
      { kind: 'cyl', pos: [x, 0.29, z], scale: [0.96, 0.07, 0.96], color: 0xb4482e, seg: 8, hueJitter: 0.02 },
    );
  } else {
    // 찢어진 가죽 자국
    parts.push(
      { kind: 'box', pos: [x - 0.44, 0.3, z + 0.3], rot: [0, -0.7, 0.2], scale: [0.3, 0.26, 0.06], color: 0x3a2c1c },
      { kind: 'box', pos: [x + 0.4, 0.24, z + 0.26], rot: [0, 0.8, -0.15], scale: [0.24, 0.2, 0.06], color: 0x33261a },
      { kind: 'cyl', pos: [x, 0.29, z], scale: [0.96, 0.07, 0.96], color: shade(0xb4482e, 0.78), seg: 8 },
    );
  }
  // 출입구 (모닥불 쪽)
  parts.push(
    post(x + 0.32, 0.19, z + 0.44, 0.06, 0.38, wood, 5),
    post(x - 0.3, 0.19, z + 0.5, 0.06, 0.38, wood, 5),
    { kind: 'box', pos: [x + 0.01, 0.4, z + 0.47], rot: [0, -0.1, 0], scale: [0.68, 0.07, 0.09], color: shade(wood, 1.2) },
    { kind: 'box', pos: [x + 0.02, 0.19, z + 0.5], rot: [0, -0.1, 0.06], scale: [0.34, 0.36, 0.05], color: soot(0x3a2c1c, lv) },
    // 벽에 걸어 말리는 가죽/방패
    { kind: 'box', pos: [x - 0.62, 0.34, z + 0.18], rot: [0, -1.0, 0.1], scale: [0.3, 0.28, 0.05], color: soot(C.hide, lv) },
  );
  if (lv === 0) {
    parts.push({ kind: 'box', pos: [x + 0.66, 0.3, z + 0.1], rot: [0, 1.1, -0.08], scale: [0.26, 0.24, 0.05], color: C.boneDark });
  }
  // 지지목
  parts.push(post(x - 0.68, 0.26, z - 0.32, 0.055, 0.6, wood, 4, [0.2, 0, 0.5]));
  if (lv === 0) parts.push(post(x + 0.6, 0.28, z - 0.4, 0.055, 0.62, wood, 4, [-0.15, 0, -0.45]));
  else parts.push(post(x + 0.68, 0.05, z - 0.3, 0.055, 0.6, wood, 4, [0.2, 0.6, 1.5]));
  // 밑동 돌
  parts.push(
    { kind: 'ico', pos: [x - 0.52, 0.06, z + 0.4], rot: [0.4, 0.7, 0.2], scale: [0.2, 0.13, 0.18], color: soot(C.stone, lv) },
    { kind: 'ico', pos: [x + 0.5, 0.06, z + 0.42], rot: [1.1, 0.2, 0.6], scale: [0.18, 0.12, 0.17], color: soot(C.stoneDark, lv) },
    { kind: 'ico', pos: [x - 0.02, 0.05, z + 0.66], rot: [0.7, 1.3, 0.3], scale: [0.16, 0.1, 0.15], color: soot(C.stone, lv) },
  );
  return parts;
}

/** 짚 원뿔 움막 (겹겹이 인 이엉) */
function thatchHut(lv: Lv): PartSpec[] {
  const [x, z] = HUT_B;
  const straw = soot(C.straw, lv);
  const strawD = soot(shade(C.straw, 0.8), lv);
  const wood = soot(C.woodDark, lv);

  if (lv === 2) {
    // 지붕이 날아가고 뼈대만 남음
    const parts: PartSpec[] = [
      { kind: 'cyl', pos: [x, 0.13, z], scale: [0.74, 0.26, 0.74], color: shade(wood, 0.8), seg: 7 },
      { kind: 'ico', pos: [x, 0.06, z], rot: [0.2, 0.5, 0], scale: [0.8, 0.12, 0.78], color: 0x4a3c2a },
    ];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      parts.push(
        post(x + Math.cos(a) * 0.3, 0.34, z + Math.sin(a) * 0.3, 0.05, 0.62, wood, 4, [
          Math.sin(a) * 0.34,
          0,
          -Math.cos(a) * 0.34,
        ]),
      );
    }
    parts.push(
      { kind: 'ico', pos: [x - 0.5, 0.07, z + 0.3], rot: [0.3, 0.8, 0.2], scale: [0.36, 0.12, 0.32], color: strawD },
      { kind: 'ico', pos: [x + 0.48, 0.06, z - 0.24], rot: [0.9, 0.2, 0.5], scale: [0.3, 0.1, 0.28], color: shade(strawD, 0.8) },
      { kind: 'box', pos: [x + 0.2, 0.04, z + 0.5], rot: [0, 0.7, 0.05], scale: [0.34, 0.06, 0.22], color: 0x2e2418 },
    );
    return parts;
  }

  const tilt = lv === 1 ? 0.2 : 0;
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [x, 0.15, z], scale: [0.7, 0.3, 0.7], color: wood, seg: 7, hueJitter: 0.015 },
    { kind: 'cyl', pos: [x, 0.3, z], scale: [0.74, 0.05, 0.74], color: soot(C.rope, lv), seg: 7 },
    { kind: 'cone', pos: [x, 0.52, z], rot: [tilt, 0, tilt * 0.5], scale: [0.9, 0.46, 0.9], color: straw, seg: 8, hueJitter: 0.025 },
    { kind: 'cone', pos: [x + tilt * 0.4, 0.76, z], rot: [tilt, 0.4, tilt * 0.5], scale: [0.68, 0.38, 0.68], color: strawD, seg: 8, hueJitter: 0.025 },
  ];
  if (lv === 0) {
    parts.push(
      { kind: 'cone', pos: [x, 0.98, z], scale: [0.44, 0.32, 0.44], color: straw, seg: 7, hueJitter: 0.02 },
      { kind: 'cone', pos: [x, 1.14, z], scale: [0.2, 0.2, 0.2], color: wood, seg: 5 },
    );
  } else {
    // 꼭대기 이엉이 벗겨져 서까래가 드러남
    parts.push(
      post(x + 0.06, 0.94, z, 0.04, 0.36, wood, 4, [0.3, 0, 0.25]),
      post(x - 0.05, 0.92, z + 0.05, 0.04, 0.32, wood, 4, [-0.25, 0, -0.2]),
      { kind: 'ico', pos: [x - 0.62, 0.07, z + 0.22], rot: [0.4, 0.6, 0.2], scale: [0.3, 0.1, 0.26], color: strawD },
    );
  }
  parts.push(
    post(x + 0.24, 0.17, z + 0.44, 0.05, 0.34, wood, 4),
    post(x - 0.24, 0.17, z + 0.44, 0.05, 0.34, wood, 4),
    { kind: 'box', pos: [x, 0.17, z + 0.48], rot: [0, 0, 0.04], scale: [0.3, 0.32, 0.05], color: soot(0x3a2c1c, lv) },
  );
  // 처마 아래 삐져나온 짚뭉치
  for (let i = 0; i < 3; i++) {
    const a = 1.1 + i * 1.9;
    parts.push({
      kind: 'cone',
      pos: [x + Math.cos(a) * 0.46, 0.34, z + Math.sin(a) * 0.46],
      rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9],
      scale: [0.11, 0.2, 0.11],
      color: strawD,
      seg: 4,
    });
  }
  return parts;
}

/** 가죽 차양(오두막) — 도구·바구니 보관소 */
function leanTo(lv: Lv): PartSpec[] {
  const [x, z] = HUT_C;
  const wood = soot(C.wood, lv);
  const hide = soot(C.hide, lv);

  if (lv === 2) {
    return [
      post(x - 0.2, 0.16, z + 0.2, 0.05, 0.34, soot(C.woodDark, 2), 4, [0.3, 0, 0.25]),
      post(x + 0.24, 0.06, z - 0.1, 0.05, 0.5, soot(C.woodDark, 2), 4, [0, 0.5, 1.4]),
      { kind: 'box', pos: [x, 0.04, z], rot: [0, 0.4, 0.06], scale: [0.5, 0.05, 0.38], color: shade(hide, 0.6) },
      { kind: 'ico', pos: [x - 0.3, 0.06, z - 0.24], rot: [0.5, 0.3, 0.2], scale: [0.24, 0.1, 0.2], color: 0x3e3226 },
    ];
  }

  // 앞이 높고 뒤가 낮은 한쪽 경사 차양 — 기둥을 굵게 해 구조가 읽히게 한다
  const drop = lv === 1 ? 0.14 : 0;
  const parts: PartSpec[] = [
    post(x - 0.28, 0.28, z + 0.26, 0.08, 0.56, wood, 5),
    post(x + 0.28, 0.28, z + 0.26, 0.08, 0.56, wood, 5),
    post(x - 0.28, 0.14, z - 0.24, 0.07, 0.28, wood, 4),
    post(x + 0.28, 0.14, z - 0.24, 0.07, 0.28, wood, 4),
    { kind: 'cyl', pos: [x, 0.56, z + 0.26], rot: [0, 0, Math.PI / 2], scale: [0.05, 0.68, 0.05], color: shade(wood, 1.18), seg: 4 },
    { kind: 'cyl', pos: [x, 0.28, z - 0.24], rot: [0, 0, Math.PI / 2], scale: [0.045, 0.66, 0.045], color: shade(wood, 1.05), seg: 4 },
  ];
  // 지붕 = 널찍한 판 하나가 아니라 겹쳐 덮은 가죽 4장 (평평한 면이 도드라지지 않게)
  const strips: [number, number, number][] = [
    [-0.18, 0.31, 0.05],
    [-0.05, 0.39, -0.04],
    [0.08, 0.46, 0.03],
    [0.21, 0.53, -0.06],
  ];
  strips.forEach(([sz, sy, yaw], i) => {
    parts.push({
      kind: 'box',
      pos: [x, sy - drop * 0.5, z + sz],
      rot: [-0.5 + drop, yaw, 0],
      scale: [0.64, 0.05, 0.17],
      color: i % 2 ? shade(hide, 1.16) : shade(hide, 0.96),
      hueJitter: 0.02,
    });
  });
  if (lv === 0) {
    parts.push({ kind: 'box', pos: [x, 0.55, z + 0.24], rot: [-0.5, 0, 0], scale: [0.68, 0.04, 0.08], color: soot(C.rope, lv) });
  }
  parts.push(
    { kind: 'box', pos: [x + 0.32, 0.18, z + 0.01], rot: [0, 0.08, 0], scale: [0.05, 0.36, 0.46], color: soot(C.hideDark, lv) },
    { kind: 'cyl', pos: [x - 0.1, 0.11, z - 0.02], scale: [0.25, 0.22, 0.25], color: soot(C.rope, lv), seg: 6, hueJitter: 0.02 },
    flare(x - 0.1, 0.24, z - 0.02, 0.27, 0.08, soot(shade(C.rope, 0.8), lv)),
  );
  return parts;
}

// --- 방어/장식 -------------------------------------------------------------

/** 뼈·나무 목책 — 반원 배열. 피해가 클수록 말뚝이 부러지고 가름대가 사라진다 */
function palisade(lv: Lv): PartSpec[] {
  const parts: PartSpec[] = [];
  const n = 11;
  const r = 1.42;
  const wood = soot(C.wood, lv);
  const woodD = soot(C.woodDark, lv);
  for (let i = 0; i < n; i++) {
    if (lv === 1 && i % 3 === 1) continue;
    if (lv === 2 && i % 2 === 0 && i !== 6) continue;
    const a = Math.PI * 0.18 + (i / (n - 1)) * Math.PI * 0.64;
    const h = 0.5 + ((i * 7) % 3) * 0.06 - (lv === 2 ? 0.16 : 0);
    const px = Math.cos(a) * r;
    const pz = -Math.sin(a) * r;
    parts.push(
      post(px, h / 2, pz, 0.085, h, i % 2 === 0 ? wood : woodD, 5, [
        ((i * 13) % 5) * 0.025 - 0.06,
        0,
        ((i * 11) % 5) * 0.025 - 0.06,
      ]),
    );
    if (i % 2 === 0 && lv < 2) {
      parts.push({
        kind: 'cone',
        pos: [px, h + 0.07, pz],
        scale: [0.085, 0.17, 0.085],
        color: shade(wood, 1.15),
        seg: 4,
      });
    }
  }
  // 가로 가름대 (호를 4구간으로 근사)
  const railN = lv === 0 ? 4 : lv === 1 ? 2 : 0;
  for (let i = 0; i < railN; i++) {
    const a0 = Math.PI * 0.18 + (i / 4) * Math.PI * 0.64;
    const a1 = Math.PI * 0.18 + ((i + 1) / 4) * Math.PI * 0.64;
    const mx = (Math.cos(a0) + Math.cos(a1)) * 0.5 * r;
    const mz = -(Math.sin(a0) + Math.sin(a1)) * 0.5 * r;
    const len = Math.hypot(Math.cos(a1) - Math.cos(a0), Math.sin(a1) - Math.sin(a0)) * r;
    parts.push({
      kind: 'cyl',
      pos: [mx, 0.38, mz],
      rot: [0, -Math.atan2(-(Math.sin(a1) - Math.sin(a0)), Math.cos(a1) - Math.cos(a0)), Math.PI / 2],
      scale: [0.04, len * 1.06, 0.04],
      color: woodD,
      seg: 4,
    });
  }
  // 밧줄 결속
  const lashN = lv === 2 ? 1 : 3;
  for (let i = 0; i < lashN; i++) {
    const a = Math.PI * 0.26 + (i / 3) * Math.PI * 0.48;
    parts.push({
      kind: 'box',
      pos: [Math.cos(a) * r, 0.4, -Math.sin(a) * r],
      rot: [0, -a, 0],
      scale: [0.13, 0.07, 0.13],
      color: soot(C.rope, lv),
    });
  }
  // 겁주기용 두개골 말뚝
  parts.push({
    kind: 'ico',
    pos: [Math.cos(Math.PI * 0.5) * r, 0.66, -Math.sin(Math.PI * 0.5) * r],
    rot: [0.2, 0.4, 0],
    scale: [0.2, 0.18, 0.18],
    color: soot(C.bone, lv),
  });
  if (lv < 2) {
    parts.push({
      kind: 'ico',
      pos: [Math.cos(Math.PI * 0.24) * r, 0.62, -Math.sin(Math.PI * 0.24) * r],
      rot: [0.5, 1.1, 0.2],
      scale: [0.17, 0.15, 0.16],
      color: soot(C.boneDark, lv),
    });
  }
  if (lv === 2) {
    // 부러져 쓰러진 말뚝
    parts.push(
      post(0.5, 0.06, -1.16, 0.08, 0.46, woodD, 4, [0.4, 0.9, 1.5]),
      post(-0.72, 0.06, -1.0, 0.08, 0.42, wood, 4, [1.5, 0.3, 0.6]),
    );
  }
  return parts;
}

/** 뼈 아치 입구 (모닥불 앞쪽) */
function boneArch(lv: Lv): PartSpec[] {
  if (lv === 2) {
    return [
      post(-0.62, 0.05, 0.98, 0.06, 0.44, soot(C.woodDark, 2), 4, [0.3, 0.5, 1.4]),
      { kind: 'ico', pos: [-0.2, 0.06, 1.02], rot: [0.6, 0.3, 0.2], scale: [0.19, 0.11, 0.17], color: soot(C.boneDark, 2) },
      { kind: 'cone', pos: [0.24, 0.08, 0.96], rot: [1.4, 0.4, 0], scale: [0.1, 0.38, 0.1], color: soot(C.bone, 2), seg: 5 },
    ];
  }
  const bone = soot(C.bone, lv);
  const parts: PartSpec[] = [
    post(-0.54, 0.3, 0.94, 0.1, 0.6, soot(C.wood, lv), 5),
    post(0.54, 0.3, 0.94, 0.1, 0.6, soot(C.wood, lv), 5),
    // 안쪽으로 휘어 정수리에서 만나는 엄니 한 쌍 = 아치
    { kind: 'cone', pos: [-0.42, 0.72, 0.94], rot: [0, 0, -1.0], scale: [0.15, 0.5, 0.15], color: bone, seg: 5 },
    { kind: 'cone', pos: [0.42, 0.72, 0.94], rot: [0, 0, 1.0], scale: [0.15, 0.5, 0.15], color: bone, seg: 5 },
    { kind: 'ico', pos: [0, 0.86, 0.94], rot: [0.15, 0, 0], scale: [0.32, 0.28, 0.28], color: bone },
    { kind: 'cone', pos: [0, 0.72, 1.06], rot: [1.3, 0, 0], scale: [0.11, 0.2, 0.11], color: shade(bone, 0.92), seg: 5 },
    { kind: 'box', pos: [-0.4, 0.44, 0.94], rot: [0, 0, 0.15], scale: [0.06, 0.26, 0.06], color: soot(C.boneDark, lv) },
  ];
  if (lv === 0) {
    parts.push({ kind: 'box', pos: [0.4, 0.46, 0.94], rot: [0, 0, -0.12], scale: [0.06, 0.24, 0.06], color: soot(C.boneDark, lv) });
  }
  return parts;
}

/** 토템 기둥 — 조각 단 + 날개 + 두개골 + 깃털 */
function totemPole(lv: Lv): PartSpec[] {
  const tx = 0.9;
  const tz = 0.62;
  if (lv === 2) {
    // 부러져 쓰러진 토템
    return [
      { kind: 'cyl', pos: [tx, 0.07, tz], scale: [0.36, 0.14, 0.36], color: soot(C.stone, 2), seg: 7 },
      post(tx, 0.24, tz, 0.26, 0.28, soot(C.wood, 2), 7),
      { kind: 'cone', pos: [tx, 0.42, tz], scale: [0.26, 0.16, 0.26], color: 0x3a2c1c, seg: 6 },
      post(tx + 0.36, 0.13, tz + 0.3, 0.26, 0.4, soot(0xc9702e, 2), 7, [0.3, 0, 1.5]),
      { kind: 'ico', pos: [tx + 0.66, 0.1, tz + 0.46], rot: [0.6, 0.4, 0.2], scale: [0.2, 0.16, 0.2], color: soot(C.bone, 2) },
      { kind: 'ico', pos: [tx - 0.24, 0.06, tz + 0.2], rot: [0.3, 1.0, 0.4], scale: [0.22, 0.1, 0.2], color: 0x4a3a28 },
    ];
  }
  const lean = lv === 1 ? 0.1 : 0;
  const wood = soot(C.wood, lv);
  return [
    { kind: 'cyl', pos: [tx, 0.07, tz], scale: [0.38, 0.14, 0.38], color: soot(C.stone, lv), seg: 7 },
    post(tx, 0.28, tz, 0.26, 0.3, wood, 7, [0, 0, lean]),
    post(tx - lean * 0.3, 0.56, tz, 0.28, 0.28, soot(0xc9702e, lv), 7, [0, 0, lean]),
    post(tx - lean * 0.6, 0.84, tz, 0.25, 0.28, soot(0x3f8a4a, lv), 7, [0, 0, lean]),
    { kind: 'box', pos: [tx - 0.08, 0.6, tz + 0.24], scale: [0.09, 0.09, 0.06], color: C.white },
    { kind: 'box', pos: [tx + 0.1, 0.6, tz + 0.24], scale: [0.09, 0.09, 0.06], color: C.white },
    { kind: 'cone', pos: [tx, 0.5, tz + 0.26], rot: [1.5, 0, 0], scale: [0.11, 0.2, 0.11], color: soot(C.bone, lv), seg: 5 },
    { kind: 'box', pos: [tx - 0.32, 0.86, tz], rot: [0, 0, 0.3], scale: [0.3, 0.07, 0.12], color: soot(C.woodDark, lv) },
    { kind: 'box', pos: [tx + 0.32, 0.86, tz], rot: [0, 0, -0.3], scale: [0.3, 0.07, 0.12], color: soot(C.woodDark, lv) },
    { kind: 'ico', pos: [tx - lean, 1.06, tz], rot: [0.1, 0.3, 0], scale: [0.24, 0.22, 0.22], color: soot(C.bone, lv) },
    { kind: 'cone', pos: [tx - lean - 0.1, 1.24, tz - 0.04], rot: [0, 0, 0.4], scale: [0.06, 0.24, 0.06], color: soot(C.banner, lv), seg: 4 },
    { kind: 'cone', pos: [tx - lean + 0.02, 1.28, tz + 0.02], scale: [0.06, 0.26, 0.06], color: soot(C.gold, lv), seg: 4 },
    { kind: 'cone', pos: [tx - lean + 0.12, 1.23, tz - 0.02], rot: [0, 0, -0.42], scale: [0.06, 0.22, 0.06], color: soot(C.banner, lv), seg: 4 },
  ];
}

/** 가죽 건조대 */
function dryingRack(lv: Lv): PartSpec[] {
  const rx = -1.06;
  const rz = 0.42;
  const wood = soot(C.wood, lv);
  if (lv === 2) {
    return [
      post(rx, 0.05, rz + 0.1, 0.05, 0.56, soot(C.woodDark, 2), 4, [0.4, 0.3, 1.45]),
      post(rx + 0.1, 0.06, rz - 0.34, 0.05, 0.5, soot(C.woodDark, 2), 4, [1.4, 0.6, 0.2]),
      { kind: 'box', pos: [rx + 0.12, 0.04, rz - 0.06], rot: [0, 0.5, 0.05], scale: [0.4, 0.05, 0.3], color: shade(soot(C.hide, 2), 0.7) },
    ];
  }
  const parts: PartSpec[] = [
    post(rx, 0.36, rz + 0.34, 0.085, 0.72, wood, 5, [0, 0, lv === 1 ? 0.16 : 0]),
    post(rx, 0.36, rz - 0.38, 0.085, 0.72, wood, 5),
    { kind: 'cyl', pos: [rx, 0.7, rz - 0.02], rot: [Math.PI / 2, 0, 0], scale: [0.05, 0.78, 0.05], color: shade(wood, 1.18), seg: 4 },
    { kind: 'box', pos: [rx, 0.48, rz + 0.26], rot: [0, 0.06, 0], scale: [0.05, 0.38, 0.15], color: soot(shade(C.hide, 1.12), lv), hueJitter: 0.02 },
    { kind: 'box', pos: [rx, 0.5, rz - 0.28], rot: [0, -0.08, 0], scale: [0.05, 0.34, 0.14], color: soot(C.hideDark, lv), hueJitter: 0.02 },
  ];
  if (lv === 0) {
    parts.push(
      { kind: 'box', pos: [rx, 0.52, rz - 0.02], scale: [0.045, 0.3, 0.13], color: soot(C.hide, lv) },
      { kind: 'box', pos: [rx, 0.62, rz + 0.36], rot: [0, 0, 0.1], scale: [0.06, 0.18, 0.12], color: 0xb84a4a },
    );
  }
  return parts;
}

/** 항아리·바구니 */
function pottery(lv: Lv): PartSpec[] {
  const px = -0.5;
  const pz = -0.14;
  const clay = soot(0xa9663c, lv);
  if (lv === 2) {
    return [
      { kind: 'ico', pos: [px, 0.05, pz], rot: [0.4, 0.6, 0.3], scale: [0.24, 0.1, 0.22], color: clay },
      { kind: 'ico', pos: [px + 0.24, 0.04, pz - 0.16], rot: [1.1, 0.2, 0.5], scale: [0.18, 0.08, 0.16], color: shade(clay, 0.86) },
      { kind: 'ico', pos: [px - 0.18, 0.04, pz + 0.2], rot: [0.7, 1.2, 0.2], scale: [0.15, 0.07, 0.14], color: soot(C.rope, 2) },
    ];
  }
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [px, 0.14, pz], scale: [0.26, 0.28, 0.26], color: clay, seg: 6, hueJitter: 0.02 },
    flare(px, 0.32, pz, 0.2, 0.1, shade(clay, 1.12)),
    { kind: 'cyl', pos: [px + 0.34, 0.1, pz - 0.18], scale: [0.2, 0.2, 0.2], color: soot(C.rope, lv), seg: 6, hueJitter: 0.02 },
    flare(px + 0.34, 0.22, pz - 0.18, 0.22, 0.07, soot(shade(C.rope, 0.82), lv)),
  ];
  if (lv === 0) {
    parts.push(
      { kind: 'cyl', pos: [px - 0.2, 0.09, pz + 0.26], scale: [0.18, 0.18, 0.18], color: shade(clay, 0.86), seg: 6 },
      { kind: 'cone', pos: [px - 0.2, 0.21, pz + 0.26], scale: [0.16, 0.09, 0.16], color: soot(C.woodDark, lv), seg: 5 },
    );
  } else {
    parts.push({ kind: 'ico', pos: [px - 0.22, 0.04, pz + 0.28], rot: [0.5, 0.8, 0.3], scale: [0.19, 0.08, 0.17], color: shade(clay, 0.8) });
  }
  return parts;
}

/** 사냥 도구 더미 — 세워둔 창 3자루 + 돌도끼 + 가죽 뭉치 */
function toolPile(lv: Lv): PartSpec[] {
  const sx = 0.62;
  const sz = -0.52;
  const wood = soot(C.wood, lv);
  if (lv === 2) {
    return [
      post(sx, 0.04, sz, 0.035, 0.66, soot(C.woodDark, 2), 4, [0, 0.6, 1.52]),
      post(sx - 0.16, 0.04, sz + 0.22, 0.035, 0.6, soot(C.woodDark, 2), 4, [0.3, 1.5, 1.5]),
      { kind: 'cone', pos: [sx + 0.36, 0.04, sz - 0.1], rot: [0, 0.6, 1.5], scale: [0.07, 0.16, 0.07], color: soot(C.stone, 2), seg: 4 },
    ];
  }
  const parts: PartSpec[] = [];
  for (let i = 0; i < 3; i++) {
    const lean = 0.16 + i * 0.05;
    const a = 0.6 + i * 2.1;
    const dx = Math.cos(a) * 0.1;
    const dz = Math.sin(a) * 0.1;
    parts.push(
      post(sx + dx, 0.32, sz + dz, 0.032, 0.64, i % 2 ? wood : soot(C.woodDark, lv), 4, [
        Math.sin(a) * lean,
        0,
        -Math.cos(a) * lean,
      ]),
      {
        kind: 'cone',
        pos: [sx + dx * 2.1, 0.68, sz + dz * 2.1],
        rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
        scale: [0.062, 0.18, 0.062],
        color: soot(C.stone, lv),
        seg: 4,
      },
    );
  }
  parts.push(
    post(sx + 0.3, 0.1, sz + 0.2, 0.03, 0.4, wood, 4, [0, 0.4, 1.35]),
    { kind: 'box', pos: [sx + 0.48, 0.1, sz + 0.28], rot: [0, 0.4, 0.25], scale: [0.16, 0.09, 0.06], color: soot(C.stoneDark, lv) },
    { kind: 'ico', pos: [sx - 0.28, 0.08, sz - 0.16], rot: [0.4, 0.7, 0.2], scale: [0.22, 0.14, 0.2], color: soot(C.hideDark, lv) },
  );
  return parts;
}

/** 모닥불 둘레 통나무 의자 + 고기 굽는 꼬치대 */
function fireside(lv: Lv): PartSpec[] {
  const wood = soot(C.wood, lv);
  const woodD = soot(C.woodDark, lv);
  if (lv === 2) {
    return [
      { kind: 'cyl', pos: [0.74, 0.08, 0.16], rot: [0, 0.5, Math.PI / 2], scale: [0.14, 0.62, 0.14], color: 0x33291f, seg: 6 },
      { kind: 'ico', pos: [-0.7, 0.05, 0.3], rot: [0.5, 0.4, 0.2], scale: [0.26, 0.1, 0.22], color: 0x2e251c },
      post(-0.34, 0.04, 0.62, 0.035, 0.5, 0x33291f, 4, [0.2, 0.8, 1.5]),
    ];
  }
  const parts: PartSpec[] = [
    // 통나무 의자 2개
    { kind: 'cyl', pos: [0.76, 0.12, 0.2], rot: [0, 0.42, Math.PI / 2], scale: [0.16, 0.64, 0.16], color: wood, seg: 6, hueJitter: 0.02 },
    { kind: 'cyl', pos: [-0.72, 0.12, 0.34], rot: [0, -0.5, Math.PI / 2], scale: [0.15, 0.58, 0.15], color: woodD, seg: 6, hueJitter: 0.02 },
    // 고기 굽는 꼬치대 — 불꽃 실루엣을 가리지 않도록 화덕 뒤쪽 가장자리로 뺀다
    post(-0.34, 0.24, -0.5, 0.04, 0.48, woodD, 4, [0, 0, 0.16]),
    post(0.34, 0.24, -0.5, 0.04, 0.48, woodD, 4, [0, 0, -0.16]),
    { kind: 'cyl', pos: [0, 0.5, -0.5], rot: [0, 0, Math.PI / 2], scale: [0.03, 0.8, 0.03], color: shade(woodD, 1.2), seg: 4 },
  ];
  if (lv === 0) {
    parts.push(
      { kind: 'box', pos: [-0.14, 0.43, -0.5], rot: [0, 0.2, 0], scale: [0.16, 0.14, 0.11], color: 0x9c4a34 },
      { kind: 'box', pos: [0.16, 0.44, -0.5], rot: [0, -0.3, 0], scale: [0.14, 0.13, 0.1], color: 0x8a4030 },
    );
  } else {
    parts.push({ kind: 'box', pos: [0.02, 0.43, -0.5], rot: [0, 0.2, 0], scale: [0.14, 0.12, 0.1], color: 0x5c3626 });
  }
  return parts;
}

/** 바닥 잡동사니 — 돌·장작·나무 조각 (반파에선 그을린 잔해 추가) */
function scatter(lv: Lv): PartSpec[] {
  const parts: PartSpec[] = [
    { kind: 'ico', pos: [-1.24, 0.05, -0.02], rot: [0.4, 0.8, 0.2], scale: [0.24, 0.14, 0.22], color: soot(C.rock, lv), hueJitter: 0.015 },
    { kind: 'ico', pos: [1.16, 0.05, -0.6], rot: [1.1, 0.3, 0.6], scale: [0.2, 0.12, 0.19], color: soot(C.stoneDark, lv), hueJitter: 0.015 },
    { kind: 'ico', pos: [0.02, 0.04, -0.72], rot: [0.7, 1.2, 0.3], scale: [0.17, 0.1, 0.16], color: soot(C.rock, lv) },
    { kind: 'cyl', pos: [-0.5, 0.06, 0.72], rot: [0, 0.9, Math.PI / 2], scale: [0.07, 0.34, 0.07], color: soot(C.woodDark, lv), seg: 4 },
    { kind: 'box', pos: [0.44, 0.03, 0.5], rot: [0, 0.7, 0], scale: [0.16, 0.05, 0.1], color: soot(C.wood, lv) },
    { kind: 'box', pos: [-0.18, 0.03, -0.98], rot: [0, -0.5, 0], scale: [0.14, 0.05, 0.09], color: soot(C.woodDark, lv) },
  ];
  if (lv === 2) {
    parts.push(
      { kind: 'ico', pos: [-0.46, 0.03, -0.86], rot: [0.3, 0.6, 0.2], scale: [0.32, 0.06, 0.28], color: 0x3e3630 },
      { kind: 'ico', pos: [0.72, 0.03, -0.78], rot: [0.9, 0.2, 0.5], scale: [0.28, 0.05, 0.25], color: 0x342d28 },
      // 잿더미/뼈 — 어두운 잔해 속 밝은 대비점
      { kind: 'ico', pos: [1.0, 0.04, 0.44], rot: [0.5, 1.1, 0.3], scale: [0.3, 0.06, 0.27], color: 0xa9a49a },
      { kind: 'ico', pos: [-0.72, 0.05, 0.62], rot: [0.2, 0.7, 0.4], scale: [0.26, 0.07, 0.24], color: 0x9a958c },
      { kind: 'cone', pos: [0.5, 0.06, 0.8], rot: [1.45, 0.5, 0], scale: [0.09, 0.34, 0.09], color: shade(C.bone, 0.86), seg: 5 },
      { kind: 'ico', pos: [-0.16, 0.07, 0.86], rot: [0.4, 0.3, 0.2], scale: [0.2, 0.16, 0.18], color: shade(C.bone, 0.8) },
    );
  } else if (lv === 1) {
    parts.push({ kind: 'ico', pos: [-0.4, 0.03, -0.9], rot: [0.3, 0.6, 0.2], scale: [0.26, 0.05, 0.24], color: 0x4a4038 });
  }
  return parts;
}

export function createBasecamp(): Basecamp {
  const group = new THREE.Group();
  group.name = 'basecamp';
  const variants: THREE.Group[] = [];
  const geos: THREE.BufferGeometry[] = [];

  for (let i = 0; i <= 2; i++) {
    const level = i as Lv;
    const parts: PartSpec[] = [
      ...ground(level),
      ...hearth(level),
      ...fireside(level),
      ...hideHut(level),
      ...thatchHut(level),
      ...leanTo(level),
      ...palisade(level),
      ...boneArch(level),
      ...totemPole(level),
      ...dryingRack(level),
      ...pottery(level),
      ...toolPile(level),
      ...scatter(level),
    ];
    const g = new THREE.Group();
    const mainGeo = buildParts(parts, { seed: 42 + level, ao: 0.16 });
    const main = new THREE.Mesh(mainGeo, flatMat());
    main.castShadow = true;
    main.receiveShadow = true;
    const flameGeo = buildParts(flames(level), { seed: 5, ao: 0 });
    const flameMesh = new THREE.Mesh(flameGeo, glowMat());
    g.add(main, flameMesh);
    g.visible = level === 0;
    geos.push(mainGeo, flameGeo);
    variants.push(g);
    group.add(g);
  }

  let current = 0;
  return {
    group,
    setDamageLevel(level) {
      current = level;
      variants.forEach((v, i) => (v.visible = i === level));
    },
    smokeLevel: () => current,
    fireOffset: new THREE.Vector3(0, 0.5, 0),
    dispose: () => geos.forEach((g) => g.dispose()),
  };
}
