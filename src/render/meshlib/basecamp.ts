/**
 * 기지(아군 원시부족 마을) — **레벨이 오를수록 구조물이 쌓이는** 디오라마.
 *
 * ── 성장 규칙: 쌓인다, 바뀌지 않는다 ──────────────────────────────────────
 * 타워 티어 언어와 같은 원칙이다. 레벨업은 있던 것을 치우고 새 것을 놓는 게 아니라
 * **더한다**. 그래서 Lv5 마을 안에는 Lv1 때 지은 그 움막이 그대로 서 있고,
 * 플레이어가 자기가 지은 것의 역사를 화면에서 읽을 수 있다.
 *
 *   Lv1 움막 하나 + 화톳불 + 사수 발판
 *   Lv2 + 모닥불(정식 화덕·꼬치대·통나무 의자) + 목책 + 짚 움막 + 가죽 건조대
 *   Lv3 + 망루(사수 발판이 2층으로 올라선다) + 토템 + 차양 작업장 + 사냥 도구
 *   Lv4 + 돌담(목책 밑동을 돌로 받친다) + 깃발 + 뼈 아치 입구 + 항아리
 *   Lv5 + 큰 장옥 + 망루 꼭대기층·깃발 + 두개골 말뚝
 *
 * ── 쏘는 지점 = 마을 한복판의 사수 발판 (구조를 강제하는 제약) ─────────────
 * sim이 쏘는 화살은 **기지 셀 중심의 y=0.6**에서 출발한다(sim/hometown.ts ARROW_Y).
 * 그 좌표는 이 모델의 로컬 원점이다. 그래서 원점에는 반드시 "사람이 올라서서 쏘는
 * 자리"가 있어야 하고, 그 발판 높이도 0.6에 맞춰야 화살이 난간 위에서 떠난다.
 * → WATCH_DECK_Y = 0.6. Lv3에서 망루가 올라서도 **아래 발판은 그 높이에 남고**
 *   위층이 얹힌다. 화살은 언제나 아래 발판에서 나간다.
 * 그 대가로 모닥불이 원점을 비켜 앉는다(HEARTH). fireOffset이 파티클 스폰을
 * 화덕 위치로 옮겨 주므로 연기는 그대로 화덕에서 피어오른다.
 *
 * ── 반경: 바닥판(ground) ≤ 1.45 ───────────────────────────────────────────
 * 기지 셀은 맵 가장자리에서 1칸 안쪽이라 어느 방향이든 1.5를 넘으면 흙바닥이
 * 허공으로 삐져나온다(stage3은 -z가 낭떠러지). 그래서 마을은 커질수록 **넓어지는 게
 * 아니라 빽빽해진다** — 구조물을 반경 1.0 고리에 슬롯으로 앉히고, 레벨이 오르면
 * 빈 슬롯을 채우고 있던 것 위에 층을 얹는다.
 * 2단계까지의 모델은 전체 반경이 1.839(반파 1.991)로 바닥판 밖까지 나가 있었다.
 * 이번 재배치로 **구조물도 전부 바닥판 안**에 들어온다(tests/render/basecamp.test.ts).
 *
 * ── 피해 단계(0=온전 / 1=파손 / 2=반파) ───────────────────────────────────
 * 레벨과 직교한다. 레벨 L·피해 d 조합은 5×3 = 15가지인데, 통째로 15벌을 구우면
 * 콜드 빌드가 24ms × 15 = 360ms다. 그래서 **레벨 레이어별로 굽고 병합**한다:
 *   layer(L, d) = 레벨 L에서 **새로 더해지는** 파트만 구운 지오메트리
 *   camp(L, d)  = merge(layer(1..L, d))        ← 프리미티브 재생성 없는 memcpy
 * 진입 때는 Lv1 레이어 3벌(≈15ms)만 굽고, 레벨업 때 그 레벨 레이어 3벌만 더 굽는다.
 * (AO는 조각마다 자기 높이로 정규화하면 층간 음영이 어긋나므로 aoRange로 고정한다)
 *
 * 그려지는 메시는 레벨·피해와 무관하게 **항상 2개**(본체 + 발광 불꽃) = 드로우콜 2.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { C, flatMat } from '../palette';
import { makeFlameMaterial } from './flamemat';
import { buildParts, type PartSpec } from './factory';

export interface Basecamp {
  group: THREE.Group;
  /** 0=온전 / 1=파손 / 2=반파 */
  setDamageLevel(level: Dmg): void;
  /**
   * 홈타운 레벨 반영 (level·maxLevel 모두 1-base).
   * 레벨 → 레이어를 비율로 사상하므로 BASE_LEVELS 길이가 바뀌어도 양끝이 맞는다.
   */
  setLevel(level: number, maxLevel: number): void;
  /** 파티클 훅용: 현재 연기 강도 0~3 */
  readonly smokeLevel: () => number;
  /**
   * 불길 맥동 — 발광 메시의 **스케일만** 시간으로 흔든다(지오메트리 재생성 0 · 드로우콜 0).
   * 불이 정지해 있으면 아무리 크게 그려도 "그려 넣은 삼각형"으로 읽힌다.
   */
  flicker(time: number): void;
  /**
   * 모닥불 월드 오프셋 (파티클 스폰 위치).
   * 화덕이 원점이 아니라 HEARTH 슬롯에 있으므로 x/z가 0이 아니다 —
   * 이 값을 쓰지 않고 group.position 만 쓰면 연기가 망루에서 피어오른다.
   */
  fireOffset: THREE.Vector3;
  dispose(): void;
}

/**
 * 피해 단계 — 0=온전 / 1=파손 / 2=반파 / **3=전소 폐허**
 *
 * ── 3 이 생긴 이유 (사용자 요구 원문) ────────────────────────────────────────
 *   > "우리 홈타운이 공격을 받을수록 더 부서진 모습이나 불타는 모습이 있어야 하고 …
 *   >  완전히 불타서 마을이 망하는 모습을 더 추가해줘"
 * 2 까지는 "무너지고 그을렸다"이고, 3 은 **다 타 버린 뒤**다: 남은 것이 숯기둥과
 * 잿더미뿐이고 불길이 마을 전체를 덮는다. 판이 끝나는 순간(패배)에 여기로 간다.
 */
export type Dmg = 0 | 1 | 2 | 3;

/**
 * **무너진 상태인가** — 2(반파)와 3(전소)이 같은 붕괴 형상을 쓴다.
 *
 * ⚠ 40곳의 `wrecked(d)` 를 이것으로 바꾼 이유: 3 을 따로 조각하면 같은 구조물의 붕괴가
 *   **두 벌**이 되고, 하나를 고칠 때 다른 하나가 낡는다(이 저장소가 반복해서 당한 꼴).
 *   3 은 붕괴 형상을 물려받고 **색(`soot`)과 불길(`flames`)로** 갈린다.
 */
function wrecked(d: Dmg): boolean {
  return d >= 2;
}

/** 화살이 떠나는 높이 = 아래 발판 높이 (sim/hometown.ts ARROW_Y와 같은 값) */
const WATCH_DECK_Y = 0.6;
/** Lv3 망루 위층 데크 높이 */
const WATCH_UPPER_Y = 1.14;
/**
 * 망루 난간 윗선 — Lv5 깃대가 여기서 시작한다 (둘이 어긋나면 깃발이 공중에 뜬다).
 *
 * ⚠ 망루에 **지붕을 씌우지 않은** 이유: 카메라가 55° 부감이라 데크 위에 지붕을 얹으면
 * 위에서 보이는 건 지붕뿐이고 난간·발판이 통째로 가려진다. 실제로 처음엔 4각뿔 지붕을
 * 얹었는데 캡처에서 망루가 아니라 **정자(亭子)** 로 읽혔다. 지금은 뒤편에만 가죽 차양을
 * 달아 비를 가리는 시늉을 하고 데크는 하늘로 열어 둔다 — 위에서 "사람이 서는 자리"가 보인다.
 */
const WATCH_RAIL_Y = WATCH_UPPER_Y + 0.3;

/**
 * AO 정규화 높이 구간 — 레벨 레이어를 따로 굽고 합치므로 전 레이어가 같은 자를 써야 한다.
 * 상한은 Lv5 망루 꼭대기(≈1.8)에 여유를 준 값.
 */
const AO_RANGE: [number, number] = [0, 2.2];
const AO_STRENGTH = 0.16;

// --- 구조물 슬롯 -----------------------------------------------------------
/**
 * 반경 1.0 고리 위의 8슬롯 + 중앙. 마을이 커져도 **바깥으로 번지지 않게** 하는 장치다.
 * 각 구조물의 자체 반경이 0.45를 넘지 않으므로 어느 슬롯도 1.45를 넘지 않는다.
 */
const HEARTH: [number, number] = [-0.54, 0.54]; // 135° 모닥불
const HUT_A: [number, number] = [-0.58, -0.54]; // 225° 가죽 움막 (Lv1)
const HUT_B: [number, number] = [0.02, -0.86]; // 270° 짚 움막
const LEANTO: [number, number] = [0.66, -0.6]; // 315° 차양 작업장
const HALL: [number, number] = [0.86, 0.04]; // 0°   큰 장옥
const TOTEM: [number, number] = [0.36, 0.68]; // 45°  토템 (입구 옆)
const RACK: [number, number] = [-0.9, -0.02]; // 180° 가죽 건조대
const ARCH_Z = 0.92; // 90°  뼈 아치 입구
/**
 * 목책 호의 반경 — 말뚝 머리까지 바닥판(1.45) 안에 들어오는 값.
 *
 * ⚠ 내보내는 이유: 문간 물기 포즈의 코끝선(`GATE_STANDOFF_EDGE − GATE_BITE_DEPTH`)이
 *   **이 호를 넘어야** 화면에서 "문다"로 읽힌다. `tests/render/gatepose.test.ts` §3 이
 *   그 관계를 잠그므로, 목책을 옮기면 물기 폭도 함께 다시 유도해야 한다.
 */
export const WALL_R = 1.28;
/** 마을 전체가 넘어서는 안 되는 반경 (tests/render/basecamp.test.ts가 잠근다) */
export const BASECAMP_MAX_RADIUS = 1.45;

/** 색 명도 배율 — 같은 계열 안에서 면을 나눠 각진 결/그을음을 표현 */
function shade(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/** 피해 단계별 그을림 — 반파일수록 어둡고 탁하게 */
function soot(hex: number, d: Dmg): number {
  // 3(전소)은 숯이다 — 0.40 밑으로 내리면 색이 죽어 실루엣이 배경과 안 갈린다(부감 55°)
  return d === 0 ? hex : shade(hex, d === 1 ? 0.84 : wrecked(d) ? 0.66 : 0.42);
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

/** 가로 들보 (x축 방향 통나무) */
function beam(x: number, y: number, z: number, len: number, r: number, color: number, yaw = 0): PartSpec {
  return {
    kind: 'cyl',
    pos: [x, y, z],
    rot: [0, yaw, Math.PI / 2],
    scale: [r, len, r],
    color,
    seg: 4,
  };
}

// --- Lv1: 흙바닥 · 움막 · 화톳불 · 사수 발판 --------------------------------

/**
 * 마을이 올라앉는 다진 흙바닥. 레벨마다 원반을 덧대 **넓어지는 게 보이게** 한다.
 * 어떤 레벨에서도 hypot(중심, 반경) ≤ 1.45 를 넘지 않는다 (헤더의 바닥판 제약).
 */
function groundL1(d: Dmg): PartSpec[] {
  const dirt = wrecked(d) ? 0x827058 : 0x9c8259;
  return [
    // Lv1은 움막·화톳불·발판만 덮는 작은 터 — 마을이 아니라 '자리를 잡은 집 한 채'
    { kind: 'cyl', pos: [-0.2, 0.024, -0.14], scale: [2.1, 0.045, 2.1], color: dirt, seg: 11, hueJitter: 0.02 },
    { kind: 'cyl', pos: [-0.34, 0.026, 0.44], scale: [1.0, 0.048, 1.0], color: shade(dirt, 1.06), seg: 8, hueJitter: 0.02 },
  ];
}

function groundL2(d: Dmg): PartSpec[] {
  const dirt = wrecked(d) ? 0x827058 : 0x9c8259;
  return [
    // 목책을 두르며 뒤편이 넓어진다
    { kind: 'cyl', pos: [0.0, 0.024, -0.42], scale: [1.96, 0.044, 1.96], color: shade(dirt, 0.96), seg: 10, hueJitter: 0.02 },
    { kind: 'cyl', pos: [-0.78, 0.026, 0.06], scale: [1.24, 0.047, 1.24], color: shade(dirt, 1.03), seg: 8, hueJitter: 0.02 },
  ];
}

function groundL3(d: Dmg): PartSpec[] {
  const dirt = wrecked(d) ? 0x827058 : 0x9c8259;
  return [
    { kind: 'cyl', pos: [0.56, 0.025, -0.3], scale: [1.6, 0.046, 1.6], color: shade(dirt, 1.05), seg: 9, hueJitter: 0.02 },
  ];
}

function groundL4(d: Dmg): PartSpec[] {
  const dirt = wrecked(d) ? 0x827058 : 0x9c8259;
  return [
    { kind: 'cyl', pos: [0.1, 0.026, 0.42], scale: [1.86, 0.048, 1.86], color: shade(dirt, 1.08), seg: 9, hueJitter: 0.02 },
    // 입구 진입로 — 아치 아래로 이어지는 밟아 다진 길
    { kind: 'box', pos: [0, 0.03, 0.92], rot: [0, 0.06, 0], scale: [0.62, 0.05, 0.86], color: shade(dirt, 1.12) },
  ];
}

function groundL5(d: Dmg): PartSpec[] {
  const dirt = wrecked(d) ? 0x827058 : 0x9c8259;
  return [
    { kind: 'cyl', pos: [0.66, 0.027, 0.04], scale: [1.54, 0.05, 1.54], color: shade(dirt, 1.02), seg: 8, hueJitter: 0.02 },
  ];
}

/**
 * Lv1 화톳불 — 돌 몇 개로 두른 작은 불자리.
 * Lv2 의 정식 화덕은 이걸 **치우지 않고 둘러싼다**(바깥 돌·장작·꼬치대를 더한다).
 */
function emberPit(d: Dmg): PartSpec[] {
  const [x, z] = HEARTH;
  const stone = wrecked(d) ? 0x5a5450 : C.stone;
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [x, 0.05, z], scale: [0.44, 0.05, 0.44], color: wrecked(d) ? 0x3a3430 : 0x4e463e, seg: 7 },
  ];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    parts.push({
      kind: 'ico',
      pos: [x + Math.cos(a) * 0.3, 0.075, z + Math.sin(a) * 0.3],
      rot: [i * 0.7, i * 1.3, i * 0.4],
      scale: [0.17, 0.15, 0.16],
      color: i % 2 ? stone : shade(stone, 0.86),
      hueJitter: 0.012,
    });
  }
  const logColor = wrecked(d) ? 0x2e2622 : C.woodDark;
  parts.push(
    post(x, 0.09, z, 0.075, 0.4, logColor, 5, [0, 0.5, 1.35]),
    { kind: 'ico', pos: [x - 0.08, 0.06, z + 0.07], scale: [0.12, 0.07, 0.11], color: wrecked(d) ? 0x6a3a20 : C.ember },
  );
  return parts;
}

/**
 * 사수 발판 (Lv1) — 마을 한복판, 로컬 원점.
 * 통나무 네 기둥 + 발판 + 활·화살 거치대. **화살은 이 발판 높이에서 떠난다.**
 * Lv3 망루는 이 발판을 그대로 두고 위로 층을 올린다.
 */
function watchDeck(d: Dmg): PartSpec[] {
  const wood = soot(C.wood, d);
  const woodD = soot(C.woodDark, d);
  const y = WATCH_DECK_Y;
  const s = 0.27; // 기둥 반칸
  const parts: PartSpec[] = [];
  // 네 기둥 — 반파에서는 한 짝이 부러져 발판이 기운다
  const legs: [number, number][] = [
    [s, s],
    [-s, s],
    [s, -s],
    [-s, -s],
  ];
  legs.forEach(([lx, lz], i) => {
    if (wrecked(d) && i === 3) {
      parts.push(post(lx - 0.16, 0.05, lz - 0.12, 0.075, y * 0.8, woodD, 4, [0.5, 0.8, 1.4]));
      return;
    }
    const tilt = d === 1 && i === 1 ? 0.09 : 0;
    // 굵고 어두운 통나무 다리 — 밝은 흙바닥 위에서 구조가 먼저 읽힌다
    parts.push(post(lx, y * 0.5, lz, 0.075, y, woodD, 4, [tilt, 0, tilt]));
  });
  // X 가새 — "망대"의 결정적 신호. 좌우 두 면에만 넣어 실루엣을 어지럽히지 않는다
  if (d < 2) {
    for (const sx of [s, -s]) {
      parts.push(
        { kind: 'box', pos: [sx, y * 0.5, 0], rot: [0.86, 0, 0], scale: [0.045, 0.045, y * 0.86], color: wood },
        { kind: 'box', pos: [sx, y * 0.5, 0], rot: [-0.86, 0, 0], scale: [0.045, 0.045, y * 0.86], color: shade(wood, 0.88) },
      );
    }
  }
  // 발판 (판자 3장) — 화살이 떠나는 면
  const deckY = wrecked(d) ? y - 0.1 : y;
  const deckTilt = wrecked(d) ? 0.16 : d === 1 ? 0.05 : 0;
  for (let i = 0; i < 3; i++) {
    parts.push({
      kind: 'box',
      pos: [0, deckY + 0.02 - i * 0.005, -0.22 + i * 0.22],
      rot: [deckTilt * 0.6, 0, deckTilt],
      scale: [0.66, 0.055, 0.19],
      color: i % 2 ? shade(wood, 1.12) : wood,
      hueJitter: 0.02,
    });
  }
  // 앞쪽 낮은 난간 — 사수가 몸을 기대는 자리
  if (d < 2) {
    parts.push(
      post(0.3, deckY + 0.16, 0.28, 0.045, 0.3, woodD, 4),
      post(-0.3, deckY + 0.16, 0.28, 0.045, 0.3, woodD, 4),
      beam(0, deckY + 0.29, 0.28, 0.66, 0.04, shade(wood, 1.15)),
    );
  }
  // 활·화살 거치대 (발판 뒤편에 세워 둔다 — 실루엣에서 '쏘는 자리'를 만드는 물건)
  const bone = soot(C.bone, d);
  parts.push(
    post(-0.24, deckY + 0.22, -0.28, 0.032, 0.42, woodD, 4, [0, 0, 0.12]),
    // 활 — 세로로 걸어 둔 활대 (호 3마디)
    { kind: 'cyl', pos: [-0.28, deckY + 0.34, -0.28], rot: [0, 0, 0.5], scale: [0.028, 0.3, 0.028], color: bone, seg: 4 },
    { kind: 'cyl', pos: [-0.2, deckY + 0.34, -0.28], rot: [0, 0, -0.5], scale: [0.028, 0.3, 0.028], color: bone, seg: 4 },
    { kind: 'cyl', pos: [-0.24, deckY + 0.45, -0.28], scale: [0.026, 0.16, 0.026], color: bone, seg: 4 },
  );
  if (d < 2) {
    // 화살통 — 발판 위에 꽂아 둔 화살 다발
    parts.push(
      { kind: 'cyl', pos: [0.24, deckY + 0.12, -0.24], scale: [0.13, 0.2, 0.13], color: soot(C.hideDark, d), seg: 5 },
      { kind: 'cone', pos: [0.22, deckY + 0.3, -0.26], rot: [0.1, 0, 0.1], scale: [0.026, 0.24, 0.026], color: bone, seg: 4 },
      { kind: 'cone', pos: [0.27, deckY + 0.29, -0.21], rot: [-0.12, 0, -0.08], scale: [0.026, 0.22, 0.026], color: shade(bone, 0.9), seg: 4 },
    );
  }
  // 오르는 사다리 (뒤쪽)
  parts.push(
    post(-0.12, deckY * 0.5, -0.4, 0.03, deckY + 0.1, wood, 4, [0.26, 0, 0]),
    post(0.12, deckY * 0.5, -0.4, 0.03, deckY + 0.1, wood, 4, [0.26, 0, 0]),
  );
  for (let i = 0; i < 3; i++) {
    parts.push(beam(0, 0.16 + i * 0.18, -0.44 + i * 0.045, 0.26, 0.022, woodD));
  }
  return parts;
}

/** 가죽 돔 움막 (Lv1 — 마을이 시작된 그 집) */
function hideHut(d: Dmg): PartSpec[] {
  const [x, z] = HUT_A;
  const hide = soot(C.hide, d);
  const hideD = soot(C.hideDark, d);
  const wood = soot(C.woodDark, d);

  if (wrecked(d)) {
    // 붕괴 + 불타는 잔해
    return [
      { kind: 'ico', pos: [x, 0.09, z], rot: [0.3, 0.5, 0.1], scale: [0.86, 0.2, 0.82], color: 0x4a3a2c, hueJitter: 0.02 },
      { kind: 'ico', pos: [x - 0.2, 0.16, z + 0.18], rot: [0.9, 0.2, 0.6], scale: [0.4, 0.24, 0.36], color: 0x3a2c20 },
      { kind: 'ico', pos: [x + 0.22, 0.13, z - 0.2], rot: [0.4, 1.2, 0.3], scale: [0.34, 0.2, 0.32], color: 0x2e241c },
      { kind: 'cone', pos: [x + 0.28, 0.16, z + 0.24], rot: [1.35, 0.4, 0], scale: [0.52, 0.38, 0.52], color: shade(hideD, 0.7), seg: 7 },
      post(x - 0.32, 0.24, z - 0.1, 0.07, 0.5, wood, 4, [0.35, 0, 0.55]),
      post(x + 0.1, 0.2, z - 0.32, 0.065, 0.44, wood, 4, [-0.6, 0, 0.2]),
      post(x - 0.06, 0.28, z + 0.28, 0.06, 0.56, shade(wood, 0.75), 4, [0.9, 0.4, -0.3]),
      { kind: 'box', pos: [x - 0.46, 0.05, z + 0.34], rot: [0, 0.6, 0.1], scale: [0.32, 0.07, 0.2], color: 0x2a2018 },
      { kind: 'box', pos: [x + 0.42, 0.04, z + 0.1], rot: [0, -0.4, 0], scale: [0.26, 0.06, 0.17], color: 0x241c16 },
      { kind: 'ico', pos: [x - 0.44, 0.03, z - 0.2], rot: [0.2, 0.4, 0], scale: [0.34, 0.06, 0.3], color: 0x584f48 },
    ];
  }

  const tilt = d === 1 ? 0.16 : 0;
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [x, 0.2, z], scale: [0.88, 0.4, 0.88], color: hideD, seg: 8, hueJitter: 0.015 },
    { kind: 'cone', pos: [x, 0.66, z], rot: [tilt, 0.3, tilt * 0.6], scale: [0.98, 0.44, 0.98], color: shade(hide, 1.14), seg: 8, hueJitter: 0.02 },
    { kind: 'cone', pos: [x + tilt * 0.5, 0.92, z], rot: [tilt, 0.3, tilt * 0.6], scale: [0.5, 0.3, 0.5], color: shade(hide, 1.16), seg: 8 },
    { kind: 'cyl', pos: [x + tilt * 0.8, 1.05, z], scale: [0.18, 0.05, 0.18], color: wood, seg: 6 },
    { kind: 'cone', pos: [x + tilt * 0.9 - 0.03, 1.13, z + 0.02], rot: [0.16, 0, 0.12], scale: [0.036, 0.2, 0.036], color: wood, seg: 4 },
    { kind: 'cone', pos: [x + tilt * 0.9 + 0.04, 1.12, z - 0.03], rot: [-0.14, 0, -0.16], scale: [0.034, 0.18, 0.034], color: shade(wood, 1.2), seg: 4 },
  ];
  if (d === 0) {
    parts.push(
      { kind: 'cyl', pos: [x, 0.43, z], scale: [0.92, 0.07, 0.92], color: shade(hide, 1.24), seg: 8 },
      // 부족 문양 띠 — 갈색 일변도를 깨는 색 포인트
      { kind: 'cyl', pos: [x, 0.29, z], scale: [0.9, 0.07, 0.9], color: 0xb4482e, seg: 8, hueJitter: 0.02 },
    );
  } else {
    parts.push(
      { kind: 'box', pos: [x - 0.4, 0.3, z + 0.28], rot: [0, -0.7, 0.2], scale: [0.28, 0.24, 0.06], color: 0x3a2c1c },
      { kind: 'box', pos: [x + 0.38, 0.24, z + 0.24], rot: [0, 0.8, -0.15], scale: [0.22, 0.18, 0.06], color: 0x33261a },
      { kind: 'cyl', pos: [x, 0.29, z], scale: [0.9, 0.07, 0.9], color: shade(0xb4482e, 0.78), seg: 8 },
    );
  }
  // 출입구 (마을 안쪽 = 망루 쪽)
  parts.push(
    post(x + 0.3, 0.19, z + 0.42, 0.055, 0.38, wood, 5),
    post(x - 0.28, 0.19, z + 0.46, 0.055, 0.38, wood, 5),
    { kind: 'box', pos: [x + 0.01, 0.4, z + 0.44], rot: [0, -0.1, 0], scale: [0.64, 0.07, 0.09], color: shade(wood, 1.2) },
    { kind: 'box', pos: [x + 0.02, 0.19, z + 0.47], rot: [0, -0.1, 0.06], scale: [0.32, 0.36, 0.05], color: soot(0x3a2c1c, d) },
    { kind: 'box', pos: [x - 0.58, 0.34, z + 0.16], rot: [0, -1.0, 0.1], scale: [0.28, 0.26, 0.05], color: soot(C.hide, d) },
    // 지지목은 바깥으로 뻗지 않게 기울기를 안쪽으로 준다 (반경 1.45 제약)
    post(x - 0.42, 0.26, z - 0.2, 0.05, 0.56, wood, 4, [0.2, 0, 0.3]),
    // 밑동 돌
    { kind: 'ico', pos: [x - 0.48, 0.06, z + 0.38], rot: [0.4, 0.7, 0.2], scale: [0.19, 0.13, 0.17], color: soot(C.stone, d) },
    { kind: 'ico', pos: [x + 0.46, 0.06, z + 0.4], rot: [1.1, 0.2, 0.6], scale: [0.17, 0.12, 0.16], color: soot(C.stoneDark, d) },
  );
  if (d === 0) parts.push(post(x + 0.52, 0.28, z - 0.32, 0.05, 0.58, wood, 4, [-0.15, 0, 0.4]));
  return parts;
}

/** Lv1 바닥 잡동사니 */
function scatterL1(d: Dmg): PartSpec[] {
  const parts: PartSpec[] = [
    { kind: 'ico', pos: [-0.94, 0.05, -0.26], rot: [0.4, 0.8, 0.2], scale: [0.22, 0.13, 0.2], color: soot(C.rock, d), hueJitter: 0.015 },
    { kind: 'cyl', pos: [-0.3, 0.06, 0.22], rot: [0, 0.9, Math.PI / 2], scale: [0.07, 0.32, 0.07], color: soot(C.woodDark, d), seg: 4 },
    { kind: 'ico', pos: [0.06, 0.04, -0.62], rot: [0.7, 1.2, 0.3], scale: [0.16, 0.1, 0.15], color: soot(C.rock, d) },
  ];
  if (wrecked(d)) {
    parts.push(
      { kind: 'ico', pos: [-0.42, 0.03, -0.8], rot: [0.3, 0.6, 0.2], scale: [0.3, 0.06, 0.26], color: 0x3e3630 },
      { kind: 'ico', pos: [-0.82, 0.05, 0.46], rot: [0.2, 0.7, 0.4], scale: [0.24, 0.07, 0.22], color: 0x9a958c },
    );
  }
  return parts;
}

// --- Lv2: 정식 모닥불 · 목책 · 짚 움막 · 건조대 -----------------------------

/** Lv2 화덕 — Lv1 화톳불을 **둘러싸는** 바깥 돌 + 큰 장작 + 재 원반 */
function hearthFull(d: Dmg): PartSpec[] {
  const [x, z] = HEARTH;
  const stone = wrecked(d) ? 0x5a5450 : C.stone;
  const parts: PartSpec[] = [
    { kind: 'ico', pos: [x, 0.03, z], rot: [0, 0.3, 0], scale: [0.98, 0.05, 0.98], color: 0x7d6742, hueJitter: 0.02 },
  ];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 - 0.15;
    parts.push({
      kind: 'ico',
      pos: [x + Math.cos(a) * 0.44, 0.085, z + Math.sin(a) * 0.44],
      rot: [i * 0.9, i * 1.1, i * 0.5],
      scale: [0.2, 0.17, 0.18],
      color: i % 2 ? shade(stone, 0.92) : stone,
      hueJitter: 0.012,
    });
  }
  const logColor = wrecked(d) ? 0x2e2622 : C.woodDark;
  parts.push(post(x + 0.02, 0.12, z - 0.02, 0.085, 0.48, shade(logColor, 0.85), 5, [1.35, 0.9, 0]));
  if (d < 2) parts.push(post(x - 0.02, 0.14, z + 0.02, 0.075, 0.44, shade(logColor, 1.15), 5, [0.7, 2.1, 0.9]));
  parts.push({ kind: 'ico', pos: [x + 0.12, 0.06, z - 0.08], scale: [0.11, 0.07, 0.1], color: wrecked(d) ? 0x5a3018 : 0xff7a28 });
  return parts;
}

/** 모닥불 둘레 통나무 의자 + 고기 굽는 꼬치대 (Lv2) */
function fireside(d: Dmg): PartSpec[] {
  const [x, z] = HEARTH;
  const wood = soot(C.wood, d);
  const woodD = soot(C.woodDark, d);
  if (wrecked(d)) {
    return [
      { kind: 'cyl', pos: [x + 0.6, 0.08, z - 0.16], rot: [0, 0.5, Math.PI / 2], scale: [0.13, 0.56, 0.13], color: 0x33291f, seg: 6 },
      { kind: 'ico', pos: [x - 0.42, 0.05, z + 0.16], rot: [0.5, 0.4, 0.2], scale: [0.24, 0.1, 0.2], color: 0x2e251c },
      post(x - 0.14, 0.04, z + 0.36, 0.035, 0.46, 0x33291f, 4, [0.2, 0.8, 1.5]),
    ];
  }
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [x + 0.62, 0.12, z - 0.14], rot: [0, 0.42, Math.PI / 2], scale: [0.15, 0.58, 0.15], color: wood, seg: 6, hueJitter: 0.02 },
    { kind: 'cyl', pos: [x - 0.36, 0.12, z + 0.2], rot: [0, -0.5, Math.PI / 2], scale: [0.14, 0.5, 0.14], color: woodD, seg: 6, hueJitter: 0.02 },
    // 꼬치대 — 불꽃 실루엣을 가리지 않도록 화덕 바깥쪽으로
    post(x - 0.3, 0.24, z - 0.3, 0.038, 0.48, woodD, 4, [0, 0, 0.16]),
    post(x + 0.3, 0.24, z - 0.3, 0.038, 0.48, woodD, 4, [0, 0, -0.16]),
    beam(x, 0.5, z - 0.3, 0.72, 0.028, shade(woodD, 1.2)),
  ];
  if (d === 0) {
    parts.push(
      { kind: 'box', pos: [x - 0.12, 0.43, z - 0.3], rot: [0, 0.2, 0], scale: [0.15, 0.13, 0.1], color: 0x9c4a34 },
      { kind: 'box', pos: [x + 0.14, 0.44, z - 0.3], rot: [0, -0.3, 0], scale: [0.13, 0.12, 0.1], color: 0x8a4030 },
    );
  } else {
    parts.push({ kind: 'box', pos: [x + 0.02, 0.43, z - 0.3], rot: [0, 0.2, 0], scale: [0.13, 0.11, 0.1], color: 0x5c3626 });
  }
  return parts;
}

/**
 * 뼈·나무 목책 (Lv2) — 뒤쪽 반원 배열.
 * 피해가 클수록 말뚝이 부러지고 가름대가 사라진다.
 */
function palisade(d: Dmg): PartSpec[] {
  const parts: PartSpec[] = [];
  const n = 13;
  const r = WALL_R;
  const wood = soot(C.wood, d);
  const woodD = soot(C.woodDark, d);
  // 뒤쪽(−z) 3/4 를 감싼다 — 앞(+z)은 입구
  const a0 = Math.PI * 0.1;
  const span = Math.PI * 0.8;
  for (let i = 0; i < n; i++) {
    if (d === 1 && i % 4 === 1) continue;
    if (wrecked(d) && i % 2 === 0 && i !== 6) continue;
    const a = a0 + (i / (n - 1)) * span;
    const h = 0.5 + ((i * 7) % 3) * 0.06 - (wrecked(d) ? 0.16 : 0);
    const px = Math.cos(a) * r;
    const pz = -Math.sin(a) * r;
    parts.push(
      post(px, h / 2, pz, 0.078, h, i % 2 === 0 ? wood : woodD, 5, [
        ((i * 13) % 5) * 0.025 - 0.06,
        0,
        ((i * 11) % 5) * 0.025 - 0.06,
      ]),
    );
    if (i % 2 === 0 && d < 2) {
      parts.push({ kind: 'cone', pos: [px, h + 0.07, pz], scale: [0.078, 0.16, 0.078], color: shade(wood, 1.15), seg: 4 });
    }
  }
  // 가로 가름대 (호를 4구간으로 근사)
  const railN = d === 0 ? 4 : d === 1 ? 2 : 0;
  for (let i = 0; i < railN; i++) {
    const b0 = a0 + (i / 4) * span;
    const b1 = a0 + ((i + 1) / 4) * span;
    const mx = (Math.cos(b0) + Math.cos(b1)) * 0.5 * r;
    const mz = -(Math.sin(b0) + Math.sin(b1)) * 0.5 * r;
    const len = Math.hypot(Math.cos(b1) - Math.cos(b0), Math.sin(b1) - Math.sin(b0)) * r;
    parts.push({
      kind: 'cyl',
      pos: [mx, 0.38, mz],
      rot: [0, -Math.atan2(-(Math.sin(b1) - Math.sin(b0)), Math.cos(b1) - Math.cos(b0)), Math.PI / 2],
      scale: [0.038, len * 1.06, 0.038],
      color: woodD,
      seg: 4,
    });
  }
  // 밧줄 결속
  const lashN = wrecked(d) ? 1 : 3;
  for (let i = 0; i < lashN; i++) {
    const a = a0 + 0.18 + (i / 3) * (span - 0.36);
    parts.push({
      kind: 'box',
      pos: [Math.cos(a) * r, 0.4, -Math.sin(a) * r],
      rot: [0, -a, 0],
      scale: [0.12, 0.07, 0.12],
      color: soot(C.rope, d),
    });
  }
  if (wrecked(d)) {
    parts.push(
      post(0.46, 0.06, -1.06, 0.075, 0.44, woodD, 4, [0.4, 0.9, 1.5]),
      post(-0.66, 0.06, -0.94, 0.075, 0.4, wood, 4, [1.5, 0.3, 0.6]),
    );
  }
  return parts;
}

/** 짚 원뿔 움막 (Lv2) */
function thatchHut(d: Dmg): PartSpec[] {
  const [x, z] = HUT_B;
  const straw = soot(C.straw, d);
  const strawD = soot(shade(C.straw, 0.8), d);
  const wood = soot(C.woodDark, d);

  if (wrecked(d)) {
    const parts: PartSpec[] = [
      { kind: 'cyl', pos: [x, 0.13, z], scale: [0.7, 0.26, 0.7], color: shade(wood, 0.8), seg: 7 },
      { kind: 'ico', pos: [x, 0.06, z], rot: [0.2, 0.5, 0], scale: [0.76, 0.12, 0.74], color: 0x4a3c2a },
    ];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      parts.push(
        post(x + Math.cos(a) * 0.28, 0.34, z + Math.sin(a) * 0.28, 0.048, 0.6, wood, 4, [
          Math.sin(a) * 0.34,
          0,
          -Math.cos(a) * 0.34,
        ]),
      );
    }
    parts.push(
      { kind: 'ico', pos: [x - 0.46, 0.07, z + 0.28], rot: [0.3, 0.8, 0.2], scale: [0.34, 0.12, 0.3], color: strawD },
      { kind: 'ico', pos: [x + 0.44, 0.06, z - 0.22], rot: [0.9, 0.2, 0.5], scale: [0.28, 0.1, 0.26], color: shade(strawD, 0.8) },
    );
    return parts;
  }

  const tilt = d === 1 ? 0.2 : 0;
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [x, 0.15, z], scale: [0.66, 0.3, 0.66], color: wood, seg: 7, hueJitter: 0.015 },
    { kind: 'cyl', pos: [x, 0.3, z], scale: [0.7, 0.05, 0.7], color: soot(C.rope, d), seg: 7 },
    { kind: 'cone', pos: [x, 0.52, z], rot: [tilt, 0, tilt * 0.5], scale: [0.86, 0.46, 0.86], color: straw, seg: 8, hueJitter: 0.025 },
    { kind: 'cone', pos: [x + tilt * 0.4, 0.76, z], rot: [tilt, 0.4, tilt * 0.5], scale: [0.64, 0.38, 0.64], color: strawD, seg: 8, hueJitter: 0.025 },
  ];
  if (d === 0) {
    parts.push(
      { kind: 'cone', pos: [x, 0.98, z], scale: [0.42, 0.32, 0.42], color: straw, seg: 7, hueJitter: 0.02 },
      { kind: 'cone', pos: [x, 1.14, z], scale: [0.19, 0.2, 0.19], color: wood, seg: 5 },
    );
  } else {
    parts.push(
      post(x + 0.06, 0.94, z, 0.038, 0.34, wood, 4, [0.3, 0, 0.25]),
      post(x - 0.05, 0.92, z + 0.05, 0.038, 0.3, wood, 4, [-0.25, 0, -0.2]),
    );
  }
  parts.push(
    post(x + 0.22, 0.17, z + 0.42, 0.048, 0.34, wood, 4),
    post(x - 0.22, 0.17, z + 0.42, 0.048, 0.34, wood, 4),
    { kind: 'box', pos: [x, 0.17, z + 0.45], rot: [0, 0, 0.04], scale: [0.28, 0.32, 0.05], color: soot(0x3a2c1c, d) },
  );
  // 처마 아래 삐져나온 짚뭉치
  for (let i = 0; i < 3; i++) {
    const a = 1.1 + i * 1.9;
    parts.push({
      kind: 'cone',
      pos: [x + Math.cos(a) * 0.44, 0.34, z + Math.sin(a) * 0.44],
      rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9],
      scale: [0.1, 0.19, 0.1],
      color: strawD,
      seg: 4,
    });
  }
  return parts;
}

/** 가죽 건조대 (Lv2) */
function dryingRack(d: Dmg): PartSpec[] {
  const [rx, rz] = RACK;
  const wood = soot(C.wood, d);
  if (wrecked(d)) {
    return [
      post(rx, 0.05, rz + 0.1, 0.048, 0.54, soot(C.woodDark, 2), 4, [0.4, 0.3, 1.45]),
      post(rx + 0.1, 0.06, rz - 0.34, 0.048, 0.48, soot(C.woodDark, 2), 4, [1.4, 0.6, 0.2]),
      { kind: 'box', pos: [rx + 0.12, 0.04, rz - 0.06], rot: [0, 0.5, 0.05], scale: [0.38, 0.05, 0.28], color: shade(soot(C.hide, 2), 0.7) },
    ];
  }
  const parts: PartSpec[] = [
    post(rx, 0.36, rz + 0.32, 0.08, 0.72, wood, 5, [0, 0, d === 1 ? 0.16 : 0]),
    post(rx, 0.36, rz - 0.36, 0.08, 0.72, wood, 5),
    { kind: 'cyl', pos: [rx, 0.7, rz - 0.02], rot: [Math.PI / 2, 0, 0], scale: [0.045, 0.74, 0.045], color: shade(wood, 1.18), seg: 4 },
    { kind: 'box', pos: [rx, 0.48, rz + 0.24], rot: [0, 0.06, 0], scale: [0.05, 0.36, 0.14], color: soot(shade(C.hide, 1.12), d), hueJitter: 0.02 },
    { kind: 'box', pos: [rx, 0.5, rz - 0.26], rot: [0, -0.08, 0], scale: [0.05, 0.32, 0.13], color: soot(C.hideDark, d), hueJitter: 0.02 },
  ];
  if (d === 0) {
    parts.push(
      { kind: 'box', pos: [rx, 0.52, rz - 0.02], scale: [0.045, 0.28, 0.12], color: soot(C.hide, d) },
      { kind: 'box', pos: [rx, 0.62, rz + 0.34], rot: [0, 0, 0.1], scale: [0.055, 0.17, 0.11], color: 0xb84a4a },
    );
  }
  return parts;
}

// --- Lv3: 망루 · 토템 · 차양 작업장 · 도구 ---------------------------------

/**
 * 망루 (Lv3) — Lv1 사수 발판 **위로** 올라선 2층.
 * 아래 발판(y=0.6)은 그대로 남고 기둥이 연장되어 위층 데크(y=1.16)와 가죽 지붕이 얹힌다.
 * 화살은 여전히 아래 발판에서 나가지만, 실루엣에서 "이 마을은 망을 본다"가 읽힌다.
 */
function watchTower(d: Dmg): PartSpec[] {
  const wood = soot(C.wood, d);
  const woodD = soot(C.woodDark, d);
  const hide = soot(C.hide, d);
  const s = 0.27;
  const upperY = WATCH_UPPER_Y;
  const parts: PartSpec[] = [];
  const legs: [number, number][] = [
    [s, s],
    [-s, s],
    [s, -s],
    [-s, -s],
  ];
  legs.forEach(([lx, lz], i) => {
    if (wrecked(d) && i === 3) return; // 반파: 한 기둥이 통째로 없다
    const lean = wrecked(d) ? 0.06 : d === 1 ? 0.03 : 0;
    parts.push(
      post(lx, (WATCH_DECK_Y + upperY) * 0.5, lz, 0.06, upperY - WATCH_DECK_Y + 0.06, woodD, 4, [lean, 0, lean]),
    );
  });
  if (d < 2) {
    // 위층에도 X 가새 — 아래층과 같은 언어로 "탑"이 이어진다
    const mid = (WATCH_DECK_Y + upperY) * 0.5;
    const h = upperY - WATCH_DECK_Y;
    for (const sx of [s, -s]) {
      parts.push(
        { kind: 'box', pos: [sx, mid, 0], rot: [0.86, 0, 0], scale: [0.04, 0.04, h * 0.88], color: wood },
        { kind: 'box', pos: [sx, mid, 0], rot: [-0.86, 0, 0], scale: [0.04, 0.04, h * 0.88], color: shade(wood, 0.88) },
      );
    }
  }
  if (wrecked(d)) {
    // 위층이 주저앉아 널판이 비스듬히 걸쳐 있다
    parts.push(
      { kind: 'box', pos: [-0.1, upperY - 0.12, 0.06], rot: [0.3, 0.4, 0.42], scale: [0.72, 0.06, 0.5], color: shade(woodD, 0.9) },
      { kind: 'cone', pos: [0.3, upperY + 0.1, -0.24], rot: [1.1, 0.5, 0.3], scale: [0.5, 0.34, 0.5], color: shade(hide, 0.72), seg: 6 },
      post(-0.34, 0.08, 0.5, 0.05, 0.6, woodD, 4, [0.3, 0.6, 1.42]),
    );
    return parts;
  }
  // 위층 데크
  const tilt = d === 1 ? 0.05 : 0;
  parts.push(
    { kind: 'box', pos: [0, upperY, 0], rot: [tilt * 0.5, 0, tilt], scale: [0.78, 0.06, 0.78], color: wood, hueJitter: 0.02 },
    { kind: 'box', pos: [0, upperY - 0.04, 0], scale: [0.86, 0.05, 0.86], color: shade(woodD, 0.95) },
  );
  // 난간 (네 귀퉁이 짧은 기둥 + 가름대)
  legs.forEach(([lx, lz], i) => {
    if (d === 1 && i === 2) return;
    parts.push(post(lx * 1.05, upperY + 0.15, lz * 1.05, 0.038, 0.28, woodD, 4));
  });
  const rails: [number, number, number, number][] = [
    [0, s * 1.05, 0.56, 0],
    [0, -s * 1.05, 0.56, 0],
    [s * 1.05, 0, 0.56, Math.PI / 2],
    [-s * 1.05, 0, 0.56, Math.PI / 2],
  ];
  rails.forEach(([rxp, rzp, len, yaw], i) => {
    if (d === 1 && i === 1) return;
    parts.push(beam(rxp, upperY + 0.26, rzp, len, 0.03, shade(wood, 1.14), yaw));
  });
  // 뒤편 바람막이 — 난간에 **붙여** 낮게 세운다. 데크 위에 지붕처럼 띄우면
  // 부감 카메라에서 발판을 가리고, 공중에 뜬 널판 하나로 보인다(캡처에서 확인).
  parts.push(
    { kind: 'box', pos: [0, upperY + 0.28, -s * 1.02], rot: [0.22, 0, 0], scale: [0.66, 0.36, 0.05], color: shade(hide, 1.12), hueJitter: 0.02 },
    { kind: 'box', pos: [0, upperY + 0.46, -s * 0.92], rot: [0.22, 0, 0], scale: [0.7, 0.06, 0.09], color: soot(C.rope, d) },
    { kind: 'box', pos: [-s * 1.02, upperY + 0.22, -s * 0.4], rot: [0, 0, 0], scale: [0.05, 0.3, 0.4], color: shade(hide, 0.94), hueJitter: 0.02 },
  );
  if (d === 0) {
    // 망 보는 사람의 물건 — 뿔나팔과 여분 화살 다발
    parts.push(
      { kind: 'cone', pos: [0.2, upperY + 0.18, 0.2], rot: [0.3, 0, -0.5], scale: [0.09, 0.26, 0.09], color: soot(C.bone, d), seg: 5 },
      { kind: 'cyl', pos: [-0.16, upperY + 0.14, -0.12], scale: [0.11, 0.2, 0.11], color: soot(C.hideDark, d), seg: 5 },
    );
  }
  return parts;
}

/** 토템 기둥 (Lv3) — 조각 단 + 날개 + 두개골 + 깃털 */
function totemPole(d: Dmg): PartSpec[] {
  const [tx, tz] = TOTEM;
  if (wrecked(d)) {
    return [
      { kind: 'cyl', pos: [tx, 0.07, tz], scale: [0.34, 0.14, 0.34], color: soot(C.stone, 2), seg: 7 },
      post(tx, 0.24, tz, 0.24, 0.28, soot(C.wood, 2), 7),
      { kind: 'cone', pos: [tx, 0.42, tz], scale: [0.24, 0.16, 0.24], color: 0x3a2c1c, seg: 6 },
      post(tx + 0.26, 0.13, tz + 0.2, 0.24, 0.38, soot(0xc9702e, 2), 7, [0.3, 0, 1.5]),
      { kind: 'ico', pos: [tx + 0.46, 0.1, tz + 0.28], rot: [0.6, 0.4, 0.2], scale: [0.19, 0.15, 0.19], color: soot(C.bone, 2) },
    ];
  }
  const lean = d === 1 ? 0.1 : 0;
  const wood = soot(C.wood, d);
  return [
    { kind: 'cyl', pos: [tx, 0.07, tz], scale: [0.35, 0.14, 0.35], color: soot(C.stone, d), seg: 7 },
    post(tx, 0.28, tz, 0.24, 0.3, wood, 7, [0, 0, lean]),
    post(tx - lean * 0.3, 0.56, tz, 0.26, 0.28, soot(0xc9702e, d), 7, [0, 0, lean]),
    post(tx - lean * 0.6, 0.84, tz, 0.23, 0.28, soot(0x3f8a4a, d), 7, [0, 0, lean]),
    { kind: 'box', pos: [tx - 0.08, 0.6, tz + 0.22], scale: [0.09, 0.09, 0.06], color: C.white },
    { kind: 'box', pos: [tx + 0.1, 0.6, tz + 0.22], scale: [0.09, 0.09, 0.06], color: C.white },
    { kind: 'cone', pos: [tx, 0.5, tz + 0.24], rot: [1.5, 0, 0], scale: [0.1, 0.19, 0.1], color: soot(C.bone, d), seg: 5 },
    { kind: 'box', pos: [tx - 0.3, 0.86, tz], rot: [0, 0, 0.3], scale: [0.28, 0.07, 0.11], color: soot(C.woodDark, d) },
    { kind: 'box', pos: [tx + 0.3, 0.86, tz], rot: [0, 0, -0.3], scale: [0.28, 0.07, 0.11], color: soot(C.woodDark, d) },
    { kind: 'ico', pos: [tx - lean, 1.06, tz], rot: [0.1, 0.3, 0], scale: [0.22, 0.21, 0.21], color: soot(C.bone, d) },
    { kind: 'cone', pos: [tx - lean - 0.1, 1.24, tz - 0.04], rot: [0, 0, 0.4], scale: [0.055, 0.23, 0.055], color: soot(C.banner, d), seg: 4 },
    { kind: 'cone', pos: [tx - lean + 0.02, 1.28, tz + 0.02], scale: [0.055, 0.25, 0.055], color: soot(C.gold, d), seg: 4 },
    { kind: 'cone', pos: [tx - lean + 0.12, 1.23, tz - 0.02], rot: [0, 0, -0.42], scale: [0.055, 0.21, 0.055], color: soot(C.banner, d), seg: 4 },
  ];
}

/** 가죽 차양 작업장 (Lv3) — 도구·바구니 보관소 */
function leanTo(d: Dmg): PartSpec[] {
  const [x, z] = LEANTO;
  const wood = soot(C.wood, d);
  const hide = soot(C.hide, d);

  if (wrecked(d)) {
    return [
      post(x - 0.2, 0.16, z + 0.2, 0.048, 0.32, soot(C.woodDark, 2), 4, [0.3, 0, 0.25]),
      post(x + 0.24, 0.06, z - 0.1, 0.048, 0.48, soot(C.woodDark, 2), 4, [0, 0.5, 1.4]),
      { kind: 'box', pos: [x, 0.04, z], rot: [0, 0.4, 0.06], scale: [0.48, 0.05, 0.36], color: shade(hide, 0.6) },
    ];
  }
  const drop = d === 1 ? 0.14 : 0;
  const parts: PartSpec[] = [
    post(x - 0.26, 0.28, z + 0.24, 0.075, 0.56, wood, 5),
    post(x + 0.26, 0.28, z + 0.24, 0.075, 0.56, wood, 5),
    post(x - 0.26, 0.14, z - 0.22, 0.065, 0.28, wood, 4),
    post(x + 0.26, 0.14, z - 0.22, 0.065, 0.28, wood, 4),
    beam(x, 0.56, z + 0.24, 0.64, 0.045, shade(wood, 1.18)),
    beam(x, 0.28, z - 0.22, 0.62, 0.04, shade(wood, 1.05)),
  ];
  const strips: [number, number, number][] = [
    [-0.16, 0.31, 0.05],
    [-0.04, 0.39, -0.04],
    [0.08, 0.46, 0.03],
    [0.2, 0.53, -0.06],
  ];
  strips.forEach(([sz, sy, yaw], i) => {
    parts.push({
      kind: 'box',
      pos: [x, sy - drop * 0.5, z + sz],
      rot: [-0.5 + drop, yaw, 0],
      scale: [0.6, 0.05, 0.16],
      color: i % 2 ? shade(hide, 1.16) : shade(hide, 0.96),
      hueJitter: 0.02,
    });
  });
  parts.push(
    { kind: 'box', pos: [x + 0.3, 0.18, z + 0.01], rot: [0, 0.08, 0], scale: [0.05, 0.34, 0.42], color: soot(C.hideDark, d) },
    { kind: 'cyl', pos: [x - 0.1, 0.11, z - 0.02], scale: [0.23, 0.22, 0.23], color: soot(C.rope, d), seg: 6, hueJitter: 0.02 },
    flare(x - 0.1, 0.24, z - 0.02, 0.25, 0.08, soot(shade(C.rope, 0.8), d)),
  );
  return parts;
}

/** 사냥 도구 더미 (Lv3) — 세워둔 창 3자루 + 돌도끼 */
function toolPile(d: Dmg): PartSpec[] {
  const sx = 0.34;
  const sz = -0.76;
  const wood = soot(C.wood, d);
  if (wrecked(d)) {
    return [
      post(sx, 0.04, sz, 0.033, 0.62, soot(C.woodDark, 2), 4, [0, 0.6, 1.52]),
      post(sx - 0.16, 0.04, sz + 0.2, 0.033, 0.56, soot(C.woodDark, 2), 4, [0.3, 1.5, 1.5]),
    ];
  }
  const parts: PartSpec[] = [];
  for (let i = 0; i < 3; i++) {
    const lean = 0.16 + i * 0.05;
    const a = 0.6 + i * 2.1;
    const dx = Math.cos(a) * 0.1;
    const dz = Math.sin(a) * 0.1;
    parts.push(
      post(sx + dx, 0.32, sz + dz, 0.03, 0.62, i % 2 ? wood : soot(C.woodDark, d), 4, [
        Math.sin(a) * lean,
        0,
        -Math.cos(a) * lean,
      ]),
      {
        kind: 'cone',
        pos: [sx + dx * 2.1, 0.66, sz + dz * 2.1],
        rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
        scale: [0.058, 0.17, 0.058],
        color: soot(C.stone, d),
        seg: 4,
      },
    );
  }
  parts.push(
    post(sx + 0.28, 0.1, sz + 0.18, 0.028, 0.38, wood, 4, [0, 0.4, 1.35]),
    { kind: 'box', pos: [sx + 0.44, 0.1, sz + 0.26], rot: [0, 0.4, 0.25], scale: [0.15, 0.09, 0.06], color: soot(C.stoneDark, d) },
  );
  return parts;
}

// --- Lv4: 돌담 · 깃발 · 뼈 아치 · 항아리 ------------------------------------

/**
 * 돌담 (Lv4) — 목책을 걷어내지 않고 **밑동을 돌로 받친다**.
 * 같은 호(WALL_R)에 돌 기단 + 큰 돌덩이를 얹어 "울타리가 성벽이 됐다"로 읽히게 한다.
 */
function stoneWall(d: Dmg): PartSpec[] {
  const parts: PartSpec[] = [];
  // 목책보다 한 뼘 안쪽 — 돌덩이가 말뚝 바깥으로 나가면 바닥판을 넘는다
  const r = WALL_R - 0.11;
  const a0 = Math.PI * 0.08;
  const span = Math.PI * 0.84;
  const n = 9;
  const stone = soot(C.stone, d);
  const stoneD = soot(C.stoneDark, d);
  for (let i = 0; i < n; i++) {
    if (wrecked(d) && i % 3 === 1) continue;
    const a = a0 + (i / (n - 1)) * span;
    const px = Math.cos(a) * r;
    const pz = -Math.sin(a) * r;
    const h = wrecked(d) ? 0.16 : 0.26 + ((i * 5) % 3) * 0.04;
    parts.push({
      kind: 'box',
      pos: [px, h * 0.5, pz],
      rot: [0, -a + ((i * 7) % 3) * 0.05, 0],
      scale: [0.3, h, 0.34],
      color: i % 2 ? stone : stoneD,
      hueJitter: 0.02,
    });
    if (d < 2 && i % 2 === 1) {
      parts.push({
        kind: 'ico',
        pos: [px, h + 0.08, pz],
        rot: [i * 0.4, i * 0.9, i * 0.3],
        scale: [0.24, 0.19, 0.22],
        color: i % 3 ? shade(stone, 1.08) : soot(C.rock, d),
        hueJitter: 0.02,
      });
    }
  }
  if (wrecked(d)) {
    parts.push(
      { kind: 'ico', pos: [0.86, 0.06, -0.86], rot: [0.4, 0.6, 0.2], scale: [0.3, 0.14, 0.28], color: stoneD },
      { kind: 'ico', pos: [-0.5, 0.05, -1.02], rot: [0.9, 0.2, 0.5], scale: [0.26, 0.12, 0.24], color: stone },
    );
  }
  return parts;
}

/**
 * 깃발 (Lv4) — 목책 양끝과 마을 안쪽에 세우는 **부족기**.
 *
 * 색은 출동하는 주민의 제복과 **같은 값**이어야 한다(C.allySky / C.allyFur).
 * 처음엔 C.banner(0xe0512e 주황빛 붉은색) · 0x3f8a4a(초록) · C.gold 세 색이었는데,
 * 그건 각각 blade 습격대의 염료(0xd2492f) · archer 의 이끼색(0x5f8f3a)과 사실상
 * 같은 색이다 — **우리 마을이 쳐들어오는 부족의 깃발을 걸고 있었다.**
 * 하늘빛으로 통일하면 "이 마을에서 저 하늘빛 주민들이 나온다"가 화면에서 이어진다.
 * 세 깃발의 명도만 갈라 단조로움을 막는다.
 */
function banners(d: Dmg): PartSpec[] {
  const wood = soot(C.woodDark, d);
  const parts: PartSpec[] = [];
  const spots: [number, number, number, number][] = [
    // [x, z, 깃발색, 높이]
    [Math.cos(Math.PI * 0.1) * WALL_R, -Math.sin(Math.PI * 0.1) * WALL_R, C.allySky, 0.92],
    [Math.cos(Math.PI * 0.9) * WALL_R, -Math.sin(Math.PI * 0.9) * WALL_R, C.allySkyDark, 0.86],
    [-0.9, 0.56, C.allyFur, 0.78],
  ];
  spots.forEach(([bx, bz, color, h], i) => {
    if (wrecked(d) && i === 1) {
      parts.push(post(bx + 0.2, 0.05, bz + 0.16, 0.035, h * 0.7, wood, 4, [0.4, 0.7, 1.44]));
      return;
    }
    const lean = d === 1 ? 0.08 : 0;
    parts.push(post(bx, h * 0.5, bz, 0.036, h, wood, 4, [0, 0, lean]));
    // 깃대에 매달린 천 — 위가 넓고 아래가 좁은 삼각기
    const fy = h * 0.78;
    parts.push(
      {
        kind: 'box',
        pos: [bx - lean * 0.5 + 0.02, fy, bz + 0.12],
        rot: [0, 0.18, lean],
        scale: [0.05, 0.3, 0.22],
        color: soot(color, d),
        hueJitter: 0.03,
      },
      {
        kind: 'cone',
        pos: [bx - lean * 0.5 + 0.02, fy - 0.22, bz + 0.1],
        rot: [Math.PI, 0.18, lean],
        scale: [0.18, 0.16, 0.05],
        color: soot(shade(color, 0.86), d),
        seg: 3,
      },
      { kind: 'cone', pos: [bx - lean * 0.9, h + 0.06, bz], scale: [0.05, 0.14, 0.05], color: soot(C.bone, d), seg: 4 },
    );
  });
  return parts;
}

/** 뼈 아치 입구 (Lv4) — 마을 정면 */
function boneArch(d: Dmg): PartSpec[] {
  const z = ARCH_Z;
  if (wrecked(d)) {
    return [
      post(-0.58, 0.05, z - 0.02, 0.055, 0.42, soot(C.woodDark, 2), 4, [0.3, 0.5, 1.4]),
      { kind: 'ico', pos: [-0.18, 0.06, z + 0.02], rot: [0.6, 0.3, 0.2], scale: [0.18, 0.11, 0.16], color: soot(C.boneDark, 2) },
      { kind: 'cone', pos: [0.22, 0.08, z - 0.04], rot: [1.4, 0.4, 0], scale: [0.09, 0.36, 0.09], color: soot(C.bone, 2), seg: 5 },
    ];
  }
  const bone = soot(C.bone, d);
  const parts: PartSpec[] = [
    post(-0.5, 0.3, z, 0.095, 0.6, soot(C.wood, d), 5),
    post(0.5, 0.3, z, 0.095, 0.6, soot(C.wood, d), 5),
    { kind: 'cone', pos: [-0.4, 0.72, z], rot: [0, 0, -1.0], scale: [0.14, 0.48, 0.14], color: bone, seg: 5 },
    { kind: 'cone', pos: [0.4, 0.72, z], rot: [0, 0, 1.0], scale: [0.14, 0.48, 0.14], color: bone, seg: 5 },
    { kind: 'ico', pos: [0, 0.86, z], rot: [0.15, 0, 0], scale: [0.3, 0.27, 0.27], color: bone },
    { kind: 'cone', pos: [0, 0.72, z + 0.11], rot: [1.3, 0, 0], scale: [0.1, 0.19, 0.1], color: shade(bone, 0.92), seg: 5 },
    { kind: 'box', pos: [-0.37, 0.44, z], rot: [0, 0, 0.15], scale: [0.055, 0.25, 0.055], color: soot(C.boneDark, d) },
  ];
  if (d === 0) {
    parts.push({ kind: 'box', pos: [0.37, 0.46, z], rot: [0, 0, -0.12], scale: [0.055, 0.23, 0.055], color: soot(C.boneDark, d) });
  }
  return parts;
}

/** 항아리·바구니 (Lv4) */
function pottery(d: Dmg): PartSpec[] {
  const px = -0.86;
  const pz = 0.24;
  const clay = soot(0xa9663c, d);
  if (wrecked(d)) {
    return [
      { kind: 'ico', pos: [px, 0.05, pz], rot: [0.4, 0.6, 0.3], scale: [0.22, 0.1, 0.2], color: clay },
      { kind: 'ico', pos: [px + 0.22, 0.04, pz - 0.16], rot: [1.1, 0.2, 0.5], scale: [0.17, 0.08, 0.15], color: shade(clay, 0.86) },
    ];
  }
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [px, 0.14, pz], scale: [0.24, 0.28, 0.24], color: clay, seg: 6, hueJitter: 0.02 },
    flare(px, 0.32, pz, 0.19, 0.1, shade(clay, 1.12)),
    { kind: 'cyl', pos: [px + 0.3, 0.1, pz - 0.18], scale: [0.19, 0.2, 0.19], color: soot(C.rope, d), seg: 6, hueJitter: 0.02 },
    flare(px + 0.3, 0.22, pz - 0.18, 0.21, 0.07, soot(shade(C.rope, 0.82), d)),
  ];
  if (d === 0) {
    parts.push(
      { kind: 'cyl', pos: [px - 0.16, 0.09, pz + 0.24], scale: [0.17, 0.18, 0.17], color: shade(clay, 0.86), seg: 6 },
      { kind: 'cone', pos: [px - 0.16, 0.21, pz + 0.24], scale: [0.15, 0.09, 0.15], color: soot(C.woodDark, d), seg: 5 },
    );
  }
  return parts;
}

// --- Lv5: 큰 장옥 · 망루 꼭대기 · 두개골 말뚝 -------------------------------

/**
 * 큰 장옥 (Lv5) — 마을에서 가장 큰 집. 지금까지의 원뿔/돔 움막과 **형태를 갈라**
 * 용마루가 있는 긴 박공지붕으로 세운다. 멀리서도 "저 마을에 큰 건물이 생겼다"가 읽힌다.
 */
function greatHall(d: Dmg): PartSpec[] {
  const [x, z] = HALL;
  const wood = soot(C.wood, d);
  const woodD = soot(C.woodDark, d);
  const hide = soot(C.hide, d);
  const straw = soot(C.straw, d);

  if (wrecked(d)) {
    return [
      { kind: 'box', pos: [x, 0.1, z], rot: [0, 0.06, 0.05], scale: [0.6, 0.2, 0.9], color: 0x4a3a2c, hueJitter: 0.02 },
      { kind: 'box', pos: [x - 0.16, 0.24, z + 0.3], rot: [0.4, 0.2, 0.5], scale: [0.5, 0.07, 0.42], color: shade(straw, 0.62) },
      { kind: 'box', pos: [x + 0.2, 0.16, z - 0.34], rot: [-0.5, 0.3, 0.2], scale: [0.44, 0.07, 0.38], color: shade(straw, 0.55) },
      post(x - 0.24, 0.3, z - 0.4, 0.07, 0.62, woodD, 4, [0.3, 0, 0.6]),
      post(x + 0.22, 0.24, z + 0.42, 0.065, 0.5, woodD, 4, [-0.5, 0.2, 0.3]),
      { kind: 'ico', pos: [x + 0.34, 0.06, z - 0.02], rot: [0.3, 0.7, 0.2], scale: [0.34, 0.1, 0.3], color: 0x584f48 },
    ];
  }

  const tilt = d === 1 ? 0.07 : 0;
  const parts: PartSpec[] = [
    // 돌 기단 — 큰 집만 갖는 요소
    { kind: 'box', pos: [x, 0.05, z], scale: [0.7, 0.1, 1.0], color: soot(C.stoneDark, d), hueJitter: 0.02 },
    // 통나무 벽 (가로결 4단) — 움막(높이 1.23)보다 확실히 큰 집이 되도록 벽을 높인다
    { kind: 'box', pos: [x, 0.2, z], rot: [0, 0, tilt * 0.4], scale: [0.62, 0.2, 0.92], color: wood, hueJitter: 0.02 },
    { kind: 'box', pos: [x, 0.4, z], rot: [0, 0, tilt * 0.4], scale: [0.62, 0.2, 0.9], color: shade(wood, 0.92), hueJitter: 0.02 },
    { kind: 'box', pos: [x, 0.6, z], rot: [0, 0, tilt * 0.4], scale: [0.6, 0.2, 0.88], color: shade(wood, 1.06), hueJitter: 0.02 },
    // 박공 삼각 벽 (앞/뒤)
    { kind: 'cone', pos: [x, 0.88, z + 0.44], rot: [Math.PI / 2, 0, 0], scale: [0.66, 0.14, 0.5], color: woodD, seg: 3 },
    { kind: 'cone', pos: [x, 0.88, z - 0.44], rot: [-Math.PI / 2, 0, 0], scale: [0.66, 0.14, 0.5], color: woodD, seg: 3 },
  ];
  // 박공 지붕 = 마주 기운 이엉 두 장 (용마루가 z축을 따라 길게 눕는다)
  parts.push(
    { kind: 'box', pos: [x - 0.2, 0.86 + tilt * 0.2, z], rot: [0, 0, 0.7 + tilt], scale: [0.62, 0.08, 1.02], color: straw, hueJitter: 0.03 },
    { kind: 'box', pos: [x + 0.2, 0.86 + tilt * 0.2, z], rot: [0, 0, -0.7 + tilt], scale: [0.62, 0.08, 1.02], color: shade(straw, 0.84), hueJitter: 0.03 },
    // 용마루 덮개 — 붉은 흙 이엉. 짚 움막(같은 straw)과 지붕을 색으로 갈라 준다
    { kind: 'box', pos: [x, 1.09 + tilt * 0.2, z], scale: [0.2, 0.07, 1.04], color: soot(0xb4482e, d), hueJitter: 0.02 },
    { kind: 'cyl', pos: [x, 1.14 + tilt * 0.2, z], rot: [Math.PI / 2, 0, 0], scale: [0.07, 1.06, 0.07], color: woodD, seg: 5 },
  );
  if (d === 0) {
    // 용마루 끝 뿔 장식 + 지붕 결속 밧줄
    parts.push(
      { kind: 'cone', pos: [x, 1.22, z + 0.5], rot: [0.5, 0, 0.35], scale: [0.07, 0.28, 0.07], color: soot(C.bone, d), seg: 4 },
      { kind: 'cone', pos: [x, 1.22, z - 0.5], rot: [-0.5, 0, -0.35], scale: [0.07, 0.28, 0.07], color: soot(C.bone, d), seg: 4 },
      { kind: 'box', pos: [x - 0.2, 0.86, z + 0.26], rot: [0, 0, 0.7], scale: [0.64, 0.03, 0.06], color: soot(C.rope, d) },
      { kind: 'box', pos: [x + 0.2, 0.86, z - 0.26], rot: [0, 0, -0.7], scale: [0.64, 0.03, 0.06], color: soot(C.rope, d) },
    );
  } else {
    parts.push({ kind: 'box', pos: [x - 0.32, 0.74, z + 0.3], rot: [0, 0.4, 0.7], scale: [0.3, 0.05, 0.24], color: shade(straw, 0.6) });
  }
  // 출입구 (마을 안쪽 = −x)
  parts.push(
    { kind: 'box', pos: [x - 0.32, 0.28, z], scale: [0.06, 0.5, 0.36], color: soot(0x3a2c1c, d) },
    post(x - 0.33, 0.3, z + 0.2, 0.05, 0.58, woodD, 4),
    post(x - 0.33, 0.3, z - 0.2, 0.05, 0.58, woodD, 4),
    { kind: 'box', pos: [x - 0.33, 0.6, z], scale: [0.07, 0.07, 0.48], color: shade(wood, 1.2) },
    // 벽에 건 가죽·방패
    { kind: 'box', pos: [x - 0.33, 0.42, z + 0.36], rot: [0, 0, 0.05], scale: [0.05, 0.26, 0.24], color: hide },
  );
  if (d === 0) {
    parts.push({ kind: 'box', pos: [x - 0.33, 0.4, z - 0.36], scale: [0.05, 0.24, 0.22], color: soot(C.boneDark, d) });
  }
  return parts;
}

/** 망루 꼭대기층 (Lv5) — 지붕 위 깃대와 뿔, 그리고 한 단 더 높은 전망 */
function watchTop(d: Dmg): PartSpec[] {
  const topY = WATCH_RAIL_Y;
  if (wrecked(d)) {
    return [
      { kind: 'cone', pos: [0.34, 0.08, 0.5], rot: [1.3, 0.4, 0.2], scale: [0.13, 0.4, 0.13], color: soot(C.woodDark, 2), seg: 4 },
      { kind: 'box', pos: [-0.4, 0.06, 0.42], rot: [0, 0.5, 0.08], scale: [0.24, 0.05, 0.18], color: soot(C.allySky, 2) },
    ];
  }
  const lean = d === 1 ? 0.12 : 0;
  // 깃대는 데크 **앞 귀퉁이**에 세운다 — 가운데면 뒤편 차양을 뚫고, 무엇보다
  // 마을에서 가장 높은 색 덩어리가 실루엣 가장자리에 서야 멀리서 눈에 걸린다
  const fx = 0.24;
  const fz = 0.24;
  return [
    post(fx, topY + 0.34, fz, 0.032, 0.62, soot(C.woodDark, d), 4, [0, 0, lean]),
    // 부족기 — 마을에서 가장 높은 색 덩어리
    {
      kind: 'box',
      pos: [fx - lean * 0.5 + 0.03, topY + 0.5, fz + 0.15],
      rot: [0, 0.2, lean],
      scale: [0.045, 0.27, 0.28],
      color: soot(C.allySky, d),
      hueJitter: 0.03,
    },
    {
      kind: 'cone',
      pos: [fx - lean * 0.5 + 0.03, topY + 0.3, fz + 0.13],
      rot: [Math.PI, 0.2, lean],
      scale: [0.24, 0.14, 0.045],
      color: soot(shade(C.allySky, 0.84), d),
      seg: 3,
    },
    { kind: 'ico', pos: [fx - lean * 0.9, topY + 0.62, fz], rot: [0.2, 0.4, 0], scale: [0.16, 0.15, 0.15], color: soot(C.bone, d) },
    // 난간 뒤 귀퉁이의 뿔 장식
    { kind: 'cone', pos: [-0.3, topY - 0.14, 0.3], rot: [0.4, 0, -0.4], scale: [0.06, 0.22, 0.06], color: soot(C.boneDark, d), seg: 4 },
    { kind: 'cone', pos: [-0.3, topY - 0.14, -0.3], rot: [-0.4, 0, 0.4], scale: [0.06, 0.22, 0.06], color: soot(C.boneDark, d), seg: 4 },
  ];
}

/** 두개골 말뚝 + 마무리 잡동사니 (Lv5) */
function skullPosts(d: Dmg): PartSpec[] {
  const parts: PartSpec[] = [];
  const spots: [number, number][] = [
    [Math.cos(Math.PI * 0.32) * (WALL_R - 0.02), -Math.sin(Math.PI * 0.32) * (WALL_R - 0.02)],
    [Math.cos(Math.PI * 0.68) * (WALL_R - 0.02), -Math.sin(Math.PI * 0.68) * (WALL_R - 0.02)],
  ];
  spots.forEach(([sx, sz], i) => {
    if (wrecked(d) && i === 0) {
      parts.push({ kind: 'ico', pos: [sx * 0.8, 0.06, sz * 0.8], rot: [0.6, 0.4, 0.2], scale: [0.19, 0.14, 0.18], color: soot(C.boneDark, 2) });
      return;
    }
    parts.push(
      post(sx, 0.34, sz, 0.045, 0.68, soot(C.woodDark, d), 4),
      { kind: 'ico', pos: [sx, 0.76, sz], rot: [0.2, i * 0.9, 0], scale: [0.2, 0.18, 0.18], color: soot(i ? C.bone : C.boneDark, d) },
    );
  });
  parts.push(
    { kind: 'cyl', pos: [-0.34, 0.06, 0.9], rot: [0, 0.9, Math.PI / 2], scale: [0.07, 0.3, 0.07], color: soot(C.woodDark, d), seg: 4 },
    { kind: 'ico', pos: [0.9, 0.05, 0.72], rot: [1.1, 0.3, 0.6], scale: [0.19, 0.12, 0.18], color: soot(C.stoneDark, d), hueJitter: 0.015 },
  );
  return parts;
}

// --- 발광 불꽃 -------------------------------------------------------------

/**
 * 모닥불 불꽃 — 레벨이 오르면 커지고, 피해가 크면 작아지는 대신 잔해에 불이 붙는다.
 * 레이어와 달리 **누적하지 않는다** (같은 자리의 불이 겹쳐 타면 안 되므로 통짜 교체).
 */

/**
 * 발광(glowMat) 메시의 파트 — 모닥불과 **마을 화재**를 한 벌로 만든다.
 *
 * ⚠⚠ 여기 넣는 것이 곧 드로우콜 0 증가다. 불꽃을 별도 메시로 빼면 마을이 3콜이 되고,
 *   전투 예산(e2e 기준 프레임 56콜)에 그대로 얹힌다. 그래서 **색이 다른 불도 같은 메시**에 둔다
 *   (glowMat 은 정점 색을 쓰므로 색을 나누는 데 재질이 더 필요 없다).
 */
/**
 * **불꽃 한 무더기** — 이 게임의 불을 그리는 유일한 함수. 어디에 피든 이걸 부른다.
 *
 * ── 왜 이렇게 생겼나 (사용자 지적) ───────────────────────────────────────────
 *   > "거의 마지막 단계 불타는 모습이 좀 어색해, 이부분 좀더 잘 만들어봐"
 * 옛 판본은 큰 원뿔 **하나**였다. 로우폴리에서 매끈한 원뿔 하나는 불이 아니라 **도형**으로
 * 읽힌다 — 실루엣이 좌우 대칭이고 색이 한 겹이라 "주황 삼각형"이다. 불로 읽히는 조건 셋:
 *  ① **여러 갈래** — 높이·굵기·기울기가 서로 다른 혀가 겹쳐야 윤곽이 불규칙해진다
 *  ② **색이 층진다** — 밑이 어둡고 붉고, 위로 갈수록 밝고 노랗다. 한 색이면 평면이다
 *  ③ **낮은 분할** — `seg: 4~5` 의 각진 실루엣이 오히려 불꽃 혀처럼 보인다(6은 원뿔)
 * 움직임은 지오메트리가 아니라 `flamemat.ts` 가 정점을 흔들어 만든다(혀마다 따로).
 *
 * @param x,z  밑동 위치 · @param s 크기 배율 · @param seed 갈래 배치를 흩는 정수
 */
function fireTuft(x: number, z: number, s: number, seed: number): PartSpec[] {
  // 결정론이 필요 없는 연출이지만(렌더 전용) 같은 자리에 같은 불이 서야 캐시가 뜻이 있다
  const r = (i: number): number => {
    const h = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return h - Math.floor(h);
  };
  /*
   * ⚠⚠ **비율이 이 함수의 전부다.** 처음 판본은 갈래를 폭의 5배까지 길게 뽑았는데,
   *   화면에서 불이 아니라 **노란 수정 조각**으로 읽혔다(뾰족하고 밖으로 뻗어 별처럼 보였다).
   *   불은 **물방울**이다 — 밑이 넓고 위로 갈수록 좁아지며, 전체 높이가 폭의 2배 남짓이다.
   *   그래서 세 가지를 묶어 둔다: 갈래 길이 ≤ 폭의 4배 · 기울기 0.16rad · 밖으로 벌어지는
   *   거리 ≤ 0.15s. 셋 중 하나만 늘려도 다시 별이 된다.
   */
  /*
   * ⚠⚠ **세로로 색이 층져야 불이다.** 처음 판본은 몸통(주황) 안에 심지를 **숨겨** 두어
   *   화면에서 온통 같은 주황이었고, 가까이서 보면 "주황 원뿔 밭"이었다. 불이 불로 읽히는
   *   것은 **아래가 붉고 위가 노랗다**는 세로 그라디언트다. 그래서 세 겹을 **높이로 겹친다**:
   *     밑동(암적) 0 ~ 0.30s → 몸통(주황) 0.10 ~ 0.72s → 심지(노랑) 0.34 ~ 1.02s
   *   심지가 몸통보다 **높아야** 노란 끝이 밖으로 나온다 — 안에 넣으면 안 보인다.
   */
  const parts: PartSpec[] = [
    // ① 밑동 — 넓고 낮고 가장 붉다. 장작에 붙은 부분
    { kind: 'cone', pos: [x, 0.14 * s, z], scale: [0.54 * s, 0.3 * s, 0.54 * s], color: 0xc42a08, seg: 5 },
    // ② 몸통 — 주황. 덩어리의 주인. 살짝 기울여 좌우 대칭을 깬다
    { kind: 'cone', pos: [x + 0.02 * s, 0.36 * s, z - 0.01 * s], rot: [0.05, 0, -0.07], scale: [0.38 * s, 0.58 * s, 0.38 * s], color: C.fire, seg: 5 },
    /*
     * ③ 심지 — 몸통 위로 **살짝만** 솟는다. 세로 그라디언트를 만드는 줄이지만,
     *   ⚠ 가늘고 길게 뽑으면(폭의 4배 넘게) 불이 아니라 **돛/지느러미**로 읽힌다.
     *   폭 대비 2.7배가 상한이고, 기울여 두면 그 상한 안에서도 곧지 않게 보인다.
     */
    { kind: 'cone', pos: [x - 0.02 * s, 0.6 * s, z + 0.03 * s], rot: [-0.08, 0, 0.13], scale: [0.2 * s, 0.54 * s, 0.2 * s], color: 0xffd257, seg: 4 },
  ];
  // ④ 곁불 둘 — 밑동 옆에 낮게. 윤곽을 깨되 위로는 안 넘어선다(넘으면 다시 별이 된다)
  for (let i = 0; i < 2; i++) {
    const a = r(i) * Math.PI * 2;
    const off = (0.16 + r(i + 9) * 0.1) * s;
    const wide = (0.1 + r(i + 6) * 0.05) * s;
    const tall = wide * (2.2 + r(i + 3) * 1.2);
    parts.push({
      kind: 'cone',
      pos: [x + Math.cos(a) * off, 0.09 * s + tall * 0.5, z + Math.sin(a) * off],
      rot: [Math.sin(a) * 0.26, 0, -Math.cos(a) * 0.26],
      scale: [wide, tall, wide],
      color: i === 0 ? 0xff7a18 : 0xffa32a,
      seg: 4,
    });
  }
  return parts;
}

/**
 * 마을에 **불이 붙은 자리** — 슬롯과 크기 배율. 레벨이 오를수록 탈 것이 늘어난다.
 *
 * ⚠ 좌표는 전부 구조물 슬롯(HEARTH/HUT_A/…)에서 유도한다. 숫자를 새로 박으면 구조물을
 *   옮길 때 불만 제자리에 남는다 — 실제로 그 꼴을 여러 번 본 저장소다.
 * ⚠ 반경: 슬롯이 1.0 고리 위이고 불꽃 반경이 ≤ 0.3 이라 어떤 자리도 `BASECAMP_MAX_RADIUS`
 *   1.45 를 안 넘는다. `tests/render/basecamp.test.ts` 가 전 레벨 × 전 피해로 잰다.
 */
const BURN_SITES: readonly (readonly [number, [number, number], number])[] = [
  // ⚠ 배율을 넓게 흩는다(0.55~1.15). 비슷한 크기가 늘어서면 불이 아니라 **원뿔 밭**으로
  //   읽힌다 — 실제로 균일하게 뒀더니 가까이서 그렇게 보였다.
  [1, HUT_A, 1.15],
  [2, HUT_B, 0.72],
  [2, [WALL_R * 0.72, -WALL_R * 0.5], 0.55],
  [3, [0.2, -0.1], 0.95],
  [3, TOTEM, 0.6],
  [4, [-WALL_R * 0.66, WALL_R * 0.42], 0.58],
  [5, HALL, 1.1],
  [5, LEANTO, 0.66],
];

/**
 * 발광(glowMat) 메시의 파트 — 모닥불과 **마을 화재**를 한 벌로 만든다.
 *
 * ⚠⚠ 여기 넣는 것이 곧 드로우콜 0 증가다. 불꽃을 별도 메시로 빼면 마을이 3콜이 되고,
 *   전투 예산(e2e 기준 프레임 56콜)에 그대로 얹힌다. 그래서 **색이 다른 불도 같은 메시**에 둔다
 *   (재질이 정점 색을 쓰므로 색을 나누는 데 재질이 더 필요 없다).
 */
function flames(level: number, d: Dmg): PartSpec[] {
  const [x, z] = HEARTH;
  // Lv1 화톳불은 작고, Lv2에서 정식 화덕이 되며 이후 완만히 커진다
  const grow = level <= 1 ? 0.62 : 0.86 + Math.min(3, level - 2) * 0.05;
  /*
   * ── 화덕 불의 크기 — **피해와 함께 자란다** (사용자 요구) ────────────────────
   *   > "게임 시작하자 말자 홈타운은 이미 불꽃이 타고 있어. 이건 아니잖아. … 차라리 맨 처음
   *   >  공격 받기 전에 불타고 있는 불꽃을 활용해서 그 불꽃이 공격을 받기 시작하면 점점
   *   >  많아 지거나 크기가 조금씩 커지는게 좋겠어"
   *
   * ⚠⚠ **옛 판본은 정확히 반대였다**: 1 → 0.76 → 0.48 로 **작아지다가** 전소에서만 커졌다
   *   ("지키던 불이 꺼져 간다"는 뜻이었다). 화면에서는 두 가지가 동시에 잘못 읽혔다 —
   *   시작 화덕이 커서 **"이미 불타는 마을"** 로 보이고, 맞을수록 불이 사그라들어
   *   **"괜찮아지는 중"** 으로 보였다. 지금은 단조 증가다: 시작이 가장 작고 전소가 가장 크다.
   *
   * 0.72 → 1.05 → 1.5 → 2.1. 시작을 종전의 0.72배로 낮춘 것이 "이건 아니잖아"의 답이고,
   * 나머지가 "점점 커진다"의 답이다.
   */
  const s = grow * (d === 0 ? 0.72 : d === 1 ? 1.05 : d === 2 ? 1.5 : 2.1);
  const parts: PartSpec[] = fireTuft(x, z, s, 11);
  /*
   * ── 번지는 불 — **피해가 클수록 더 많은 자리에, 더 크게** ────────────────────
   * 사용자가 말한 "점점 많아 지거나"가 이 표다. 자리 수와 크기를 **둘 다** 단계로 올린다:
   *  · 0 온전 — 없다. 마을에 불은 화덕 하나뿐이어야 "평화로운 시작"이다.
   *  · 1 파손 — 두 자리에 작게. 처음으로 "옮겨붙었다"가 보인다.
   *  · 2 반파 — 다섯 자리에 중간. 마을 절반이 탄다.
   *  · 3 전소 — 전부 + 큰 자리에 하나씩 겹쳐. 마을이 통째로 불덩이.
   * ⚠ 자리 수를 안 늘리고 크기만 키우면 "불 하나가 커졌다"이지 "번졌다"가 아니다.
   *   반대로 크기를 안 키우면 멀리서(부감 55°) 개수 차이가 안 읽힌다. 둘 다 필요하다.
   */
  const siteCount = d === 0 ? 0 : d === 1 ? 2 : d === 2 ? 5 : BURN_SITES.length;
  if (siteCount === 0) return parts;
  const burn = d === 1 ? 0.55 : d === 2 ? 0.9 : 1.3;
  let seed = 3;
  let used = 0;
  for (const [need, [bx, bz], mul] of BURN_SITES) {
    if (level < need) continue;
    if (used >= siteCount) break;
    used++;
    /*
     * ⚠ 불은 **슬롯보다 안쪽**에 세운다. 슬롯은 반경 1.0 고리 위이고 무더기가 갈래까지
     *   0.3 남짓 벌어지므로, 슬롯에 그대로 세우면 `BASECAMP_MAX_RADIUS`(1.45)를 넘는다 —
     *   실측으로 Lv2 전소가 **1.464** 로 섬 밖으로 나갔고 계약이 잡았다.
     */
    const ix = bx * 0.82;
    const iz = bz * 0.82;
    parts.push(...fireTuft(ix, iz, burn * mul, (seed += 7)));
    /*
     * 큰 자리에만 무더기를 하나 더 겹친다. ⚠ 전 자리에 겹치면 비슷한 불이 열여섯이 되어
     *   "불타는 마을"이 아니라 **원뿔 밭**으로 읽힌다 — 실제로 그렇게 보였다.
     */
    if (d === 3 && mul >= 0.9) {
      parts.push(...fireTuft(ix * 0.66, iz * 0.66, burn * mul * 0.62, (seed += 7)));
    }
  }
  if (d !== 3) return parts;
  /*
   * 전소 전용 — **불이 마을 위로 솟는다.** 부감 55° 카메라에서 바닥의 불만으로는
   * "마을이 탄다"가 안 읽힌다(위에서 보면 작은 삼각형 몇 개다). 중앙에 큰 무더기를
   * 세워 실루엣을 만든다. 반경은 중앙이라 1.45 제약과 무관하다.
   * ⚠ 크기 2.0 은 전체 높이가 **2.2타일**쯤 — 망루(≈1.8)를 넘어야 "삼켰다"로 읽힌다.
   *   사용자가 "마지막에 불타는 모습은 별로 실감이 안나"라고 한 자리라 1.55 에서 올렸다.
   */
  parts.push(...fireTuft(0, 0, 2.0, 91));
  return parts;
}

/**
 * 전소(3) 전용 **잿더미와 숯기둥** — 불이 꺼진 뒤에도 남는 것.
 * 레이어 1 에 얹으므로 어느 레벨에서도 나온다(마을이 작아도 폐허는 폐허다).
 * ⚠ 발광이 아니라 **본체 메시**다 — 잿더미가 빛나면 안 된다.
 */
function ashes(d: Dmg): PartSpec[] {
  if (d !== 3) return [];
  const ash = 0x4a4440;
  const ashPale = 0x6e6862;
  const char = 0x241f1c;
  const parts: PartSpec[] = [
    // 마을 바닥을 덮는 재 — 넓고 얇은 원반 둘을 겹쳐 얼룩지게
    { kind: 'cyl', pos: [0, 0.035, 0], scale: [1.18, 0.03, 1.18], color: ash, seg: 9, hueJitter: 0.03 },
    { kind: 'cyl', pos: [0.16, 0.05, -0.12], scale: [0.72, 0.025, 0.72], color: ashPale, seg: 8, hueJitter: 0.04 },
  ];
  // 숯기둥 — 무너진 구조물 자리마다 타다 만 기둥 밑동
  for (const [sx, sz] of [HUT_A, HUT_B, HALL, TOTEM, LEANTO, RACK] as const) {
    parts.push(
      { kind: 'cyl', pos: [sx * 0.92, 0.12, sz * 0.92], rot: [0.18, 0, 0.12], scale: [0.075, 0.24, 0.075], color: char, seg: 4 },
      { kind: 'ico', pos: [sx * 0.8, 0.045, sz * 0.8], rot: [0.4, 0.9, 0.2], scale: [0.26, 0.05, 0.24], color: shade(char, 1.5) },
    );
  }
  return parts;
}

// --- 레벨 레이어 ----------------------------------------------------------

/**
 * 레벨 L에서 **새로 더해지는** 파트들. 낮은 레벨의 것은 여기에 다시 넣지 않는다
 * (누적은 지오메트리 병합이 한다).
 */
const LAYERS: readonly ((d: Dmg) => PartSpec[])[][] = [
  // Lv1 — 움막 하나 · 화톳불 · 사수 발판
  [groundL1, hideHut, emberPit, watchDeck, scatterL1, ashes],
  // Lv2 — 모닥불 · 목책 · 짚 움막 · 건조대
  [groundL2, hearthFull, fireside, palisade, thatchHut, dryingRack],
  // Lv3 — 망루 · 토템 · 작업장 · 도구
  [groundL3, watchTower, totemPole, leanTo, toolPile],
  // Lv4 — 돌담 · 깃발 · 뼈 아치 · 항아리
  [groundL4, stoneWall, banners, boneArch, pottery],
  // Lv5 — 큰 장옥 · 망루 꼭대기 · 두개골 말뚝
  [groundL5, greatHall, watchTop, skullPosts],
];

export const BASECAMP_LAYER_COUNT = LAYERS.length;

/**
 * 마을 HP 비율 → **피해 단계**. 이 사상의 **유일한 출처**다.
 *
 * ⚠⚠ 종전에는 `fx.ts` 의 `baseDamaged` 와 `baseUpgraded` 두 곳에
 *   `ratio > 0.6 ? 0 : ratio > 0.3 ? 1 : 2` 가 **복제**돼 있었다. 단계가 셋일 때는
 *   눈에 안 띄었지만, 넷이 되면 한쪽만 고쳐 **레벨업 순간에 마을이 멀쩡해지는** 종류의
 *   버그가 생긴다(같은 값을 두 곳이 다르게 계산한다). 한 벌로 모은다.
 *
 * 문턱: 0.60 · 0.30 은 종전 값 그대로 두고, 전소(3)만 새로 잡았다.
 *  · **0.10** — 마지막 10% 다. 이 구간에 들어오면 화면이 "곧 진다"를 말해야 한다.
 *    더 높이면(예: 0.2) 아직 지킬 만한 판에서 마을이 불덩이가 되어 정보가 거짓이 되고,
 *    더 낮추면 한두 대 맞고 끝나 **볼 시간이 없다**.
 *  · 패배 확정 시에는 비율과 무관하게 3 을 쓴다(`fx.ts` battleEnded).
 */
export function baseDamageStage(hp: number, hpMax: number): Dmg {
  const r = hp / Math.max(1, hpMax);
  return r > 0.6 ? 0 : r > 0.3 ? 1 : r > 0.1 ? 2 : 3;
}

export function createBasecamp(): Basecamp {
  const group = new THREE.Group();
  group.name = 'basecamp';

  // 레이어 지오메트리 캐시 (키 = `${레벨}:${피해}`) — 콜드 빌드는 필요한 것만
  const layerGeos = new Map<string, THREE.BufferGeometry>();
  // 병합 결과 캐시 (키 = `${레벨}:${피해}`)
  const campGeos = new Map<string, THREE.BufferGeometry>();
  const flameGeos = new Map<string, THREE.BufferGeometry>();
  const owned: THREE.BufferGeometry[] = [];

  function layerGeo(level: number, d: Dmg): THREE.BufferGeometry | null {
    const key = `${level}:${d}`;
    const hit = layerGeos.get(key);
    if (hit) return hit;
    const specs = LAYERS[level - 1];
    if (!specs) return null;
    const parts = specs.flatMap((f) => f(d));
    if (parts.length === 0) return null;
    const geo = buildParts(parts, { seed: 42 + level * 3 + d, ao: AO_STRENGTH, aoRange: AO_RANGE });
    layerGeos.set(key, geo);
    owned.push(geo);
    return geo;
  }

  function campGeo(level: number, d: Dmg): THREE.BufferGeometry {
    const key = `${level}:${d}`;
    const hit = campGeos.get(key);
    if (hit) return hit;
    const parts: THREE.BufferGeometry[] = [];
    for (let l = 1; l <= level; l++) {
      const g = layerGeo(l, d);
      if (g) parts.push(g);
    }
    // 병합은 이미 구운 버퍼의 복사라 프리미티브 재생성이 없다 (헤더의 빌드 비용 근거)
    const merged = parts.length === 1 ? parts[0]!.clone() : mergeGeometries(parts, false);
    if (!merged) throw new Error('기지 레이어 병합 실패');
    /*
     * ⚠⚠ **전소(3)의 그을림은 여기서 한 번에 먹인다 — `soot()` 로는 안 된다.**
     *   붕괴 분기(`wrecked(d)`)의 파트들은 색을 **리터럴로** 적는다(`0x4a3a2c` …).
     *   곧 `soot()` 를 아무리 어둡게 해도 무너진 구조물에는 안 닿는다 — 실측으로
     *   확인했다: 그 값을 0.42 → 0.66 으로 되돌려도 d3 의 평균 밝기가 **비트 단위로
     *   같았다**(0.0698). 무너진 뒤의 색은 리터럴이 정하기 때문이다.
     *   병합된 정점 색을 곱하면 파트가 색을 어떻게 정했든 **전부** 숯이 된다.
     *   0.55: 더 내리면 실루엣이 배경 그림자와 안 갈리고, 더 올리면 "탔다"로 안 읽힌다.
     */
    if (d === 3) {
      const col = merged.getAttribute('color');
      if (col) {
        const arr = col.array as Float32Array;
        for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] as number) * 0.55;
        col.needsUpdate = true;
      }
    }
    campGeos.set(key, merged);
    owned.push(merged);
    return merged;
  }

  function flameGeo(level: number, d: Dmg): THREE.BufferGeometry {
    const key = `${level}:${d}`;
    const hit = flameGeos.get(key);
    if (hit) return hit;
    const geo = buildParts(flames(level, d), { seed: 5 + level, ao: 0 });
    flameGeos.set(key, geo);
    owned.push(geo);
    return geo;
  }

  const main = new THREE.Mesh(campGeo(LAYERS.length, 0), flatMat());
  main.castShadow = true;
  main.receiveShadow = true;
  /*
   * 불꽃은 **전용 재질**을 쓴다(`flamemat.ts`) — 공유 `glowMat` 이 아니다.
   * 정점을 흔드는 셰이더가 붙어 있어 다른 발광 메시(수정·빔)까지 흔들면 안 되기 때문이다.
   */
  const flame = makeFlameMaterial();
  const flameMesh = new THREE.Mesh(flameGeo(LAYERS.length, 0), flame.mat);
  group.add(main, flameMesh);

  let dmg: Dmg = 0;
  let layer = LAYERS.length;
  const fireOffset = new THREE.Vector3(HEARTH[0], 0.5, HEARTH[1]);

  function apply(): void {
    main.geometry = campGeo(layer, dmg);
    flameMesh.geometry = flameGeo(layer, dmg);
    // Lv1 화톳불은 낮다 — 연기 스폰도 같이 내려야 허공에서 피지 않는다
    fireOffset.set(HEARTH[0], layer <= 1 ? 0.34 : 0.5, HEARTH[1]);
  }

  const camp: Basecamp = {
    group,
    setDamageLevel(level) {
      if (dmg === level) return;
      dmg = level;
      apply();
    },
    setLevel(level, maxLevel) {
      // 레벨 → 레이어 비율 사상. BASE_LEVELS 길이가 레이어 수와 달라도 양끝이 맞는다.
      const span = Math.max(1, maxLevel - 1);
      const t = Math.min(1, Math.max(0, (level - 1) / span));
      const next = Math.min(LAYERS.length, Math.max(1, Math.round(t * (LAYERS.length - 1)) + 1));
      if (next === layer) return;
      layer = next;
      apply();
    },
    smokeLevel: () => dmg,
    flicker(time) {
      /*
       * ⚠⚠ **메시를 통째로 늘이지 않는다.** 옛 판본은 `flameMesh.scale` 을 흔들었는데,
       *   그러면 마을의 모든 불이 **한 몸처럼 같은 박자로 부푼다** — 풍선이지 불이 아니다.
       *   지금은 시간만 넘기고, 혀마다 다른 위상으로 흔드는 일은 셰이더가 한다
       *   (`flamemat.ts`). 스케일은 1 로 고정이므로 반경 계약도 안 흔들린다.
       */
      flame.setTime(time);
    },
    fireOffset,
    dispose: () => {
      owned.forEach((g) => g.dispose());
      // 전용 재질이라 주인이 여기다 — 공유 팔레트 재질과 달리 반드시 버려야 샌다
      flame.mat.dispose();
    },
  };
  return camp;
}

/** 테스트/감사 전용 — 구조물별 반경을 개별로 재기 위한 노출 (런타임 경로는 쓰지 않는다) */
export const __BASECAMP_AUDIT__: readonly [number, string, (d: Dmg) => PartSpec[]][] = [
  [1, 'groundL1', groundL1], [1, 'hideHut', hideHut], [1, 'emberPit', emberPit], [1, 'ashes', ashes],
  [1, 'watchDeck', watchDeck], [1, 'scatterL1', scatterL1],
  [2, 'groundL2', groundL2], [2, 'hearthFull', hearthFull], [2, 'fireside', fireside],
  [2, 'palisade', palisade], [2, 'thatchHut', thatchHut], [2, 'dryingRack', dryingRack],
  [3, 'groundL3', groundL3], [3, 'watchTower', watchTower], [3, 'totemPole', totemPole],
  [3, 'leanTo', leanTo], [3, 'toolPile', toolPile],
  [4, 'groundL4', groundL4], [4, 'stoneWall', stoneWall], [4, 'banners', banners],
  [4, 'boneArch', boneArch], [4, 'pottery', pottery],
  [5, 'groundL5', groundL5], [5, 'greatHall', greatHall], [5, 'watchTop', watchTop],
  [5, 'skullPosts', skullPosts],
];
