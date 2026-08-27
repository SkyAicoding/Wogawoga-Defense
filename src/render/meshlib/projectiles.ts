/**
 * 투사체 소형 지오메트리 — 진행방향 +x 기준으로 모델링.
 * homing/ballistic을 쓰는 타워만 매핑된다 (lightning=beam, brazier/drum=aura).
 */
import type * as THREE from 'three';
import type { TowerId } from '@/data/types';
import { C } from '../palette';
import { buildParts, cachedGeo, type PartSpec } from './factory';

/*
 * ══ 5단계 설계 — **강화는 덧붙는 것이다** ═══════════════════════════════════
 * 사용자 요구:
 *   > "창이 컬러만 바뀌거나 크기만 조금 커지는 그렇게 하지말고, 2~3개의 창이 묶음으로
 *   >  날아가거나, 창에 불이 붙어 날아가거나, 이렇게 5단계 업그레이드에 대해서 좀더
 *   >  창의적으로 만들어봐. 너무 단순해 지금은 컬러+크기 로는 구분이 안되"
 *
 * `variant` 는 여기서 **"이 파트가 처음 붙는 티어"** 다(1-base). 셰이더가 `태그 <= 티어`
 * 인 정점만 남긴다(meshlib/projmat.ts — 배타가 아니라 **누적**이다).
 * 태그 없음/0 = 언제나 보이는 뼈대.
 *
 * 그래서 설계 규칙이 하나로 선다: **T1 의 실루엣은 끝까지 남고, 티어는 거기에 얹는다.**
 *  · 갈아 끼우면 강화가 "다른 무기"가 되어 무엇이 세졌는지 안 읽힌다.
 *  · 얹으면 T1 을 아는 사람이 T5 를 보고 **무엇이 늘었는지** 바로 안다.
 *  · 그리고 정점 비용이 최소가 된다 — T1 인스턴스는 T1 파트만 진다.
 *
 * 층 다섯의 뜻을 종에 상관없이 같게 잡았다(배울 것이 하나면 된다):
 *   T2 **날붙이가 는다**(더 아프다) · T3 **수가 는다**(둘) · T4 **더 는다**(셋/미늘) ·
 *   T5 **원소가 붙는다**(불·냉기·독운·방전 — 발광색이라 한눈에 갈린다)
 */

function spearProj(): PartSpec[] {
  // 던지는 창: 긴 자루 + 돌촉 + 깃 — T1 실루엣은 끝까지 남는다
  const shaft = (z: number, v?: number): PartSpec[] => [
    { kind: 'cyl', pos: [0, 0, z], rot: [0, 0, Math.PI / 2], scale: [0.05, 0.62, 0.05], color: C.wood, seg: 4, variant: v },
    { kind: 'cone', pos: [0.36, 0, z], rot: [0, 0, -Math.PI / 2], scale: [0.09, 0.2, 0.09], color: C.stone, seg: 4, variant: v },
  ];
  return [
    ...shaft(0),
    { kind: 'box', pos: [-0.3, 0.02, 0], rot: [0, 0, 0.3], scale: [0.1, 0.08, 0.02], color: 0xe0512e },
    // T2 — 흑요석 덧날. 촉이 길어지고 검게 번뜩인다
    { kind: 'cone', pos: [0.47, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.07, 0.18, 0.03], color: 0x2b2733, seg: 4, variant: 2 },
    // T3·T4 — **묶음으로 날아간다** (사용자가 이름 대서 지정한 그림)
    ...shaft(0.13, 3),
    ...shaft(-0.13, 4),
    // T5 — **불이 붙는다**. 자루 뒤로 늘어진 불꽃 셋 + 흰 코어
    { kind: 'cone', pos: [-0.5, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.13, 0.42, 0.13], color: 0xff8c42, seg: 5, variant: 5 },
    { kind: 'cone', pos: [-0.46, 0, 0.13], rot: [0, 0, Math.PI / 2], scale: [0.1, 0.32, 0.1], color: 0xffc24a, seg: 4, variant: 5 },
    { kind: 'cone', pos: [-0.46, 0, -0.13], rot: [0, 0, Math.PI / 2], scale: [0.1, 0.32, 0.1], color: 0xffc24a, seg: 4, variant: 5 },
    { kind: 'ico', pos: [-0.36, 0, 0], scale: 0.09, color: 0xfff3c4, variant: 5 },
  ];
}

function rockProj(): PartSpec[] {
  // 투석기 바위 덩어리 → 쌍바위 → 가시바위 → **불타는 운석**
  return [
    { kind: 'ico', pos: [0, 0, 0], rot: [0.4, 0.7, 0.2], scale: 0.3, color: C.stone, hueJitter: 0.02 },
    { kind: 'ico', pos: [0.08, 0.08, 0.06], scale: 0.14, color: C.stoneDark },
    // T2 — 덩어리가 붙어 뭉치가 커진다
    { kind: 'ico', pos: [-0.1, -0.06, -0.08], rot: [0.9, 0.2, 0.5], scale: 0.17, color: C.stoneDark, variant: 2 },
    // T3 — **둘째 바위**
    { kind: 'ico', pos: [-0.02, 0.04, 0.26], rot: [1.1, 0.3, 0.8], scale: 0.24, color: C.stone, hueJitter: 0.02, variant: 3 },
    // T4 — 박힌 돌가시 셋
    { kind: 'cone', pos: [0.24, 0.1, 0], rot: [0, 0, -0.9], scale: [0.08, 0.24, 0.08], color: C.stoneDark, seg: 4, variant: 4 },
    { kind: 'cone', pos: [-0.04, 0.26, 0.1], rot: [0.4, 0, 0], scale: [0.07, 0.22, 0.07], color: C.stoneDark, seg: 4, variant: 4 },
    { kind: 'cone', pos: [-0.02, -0.02, 0.42], rot: [0, 0, 1.2], scale: [0.07, 0.2, 0.07], color: C.stoneDark, seg: 4, variant: 4 },
    // T5 — **불타는 운석**: 뒤로 끌리는 불꼬리 + 불티
    { kind: 'cone', pos: [-0.34, 0.02, 0.06], rot: [0, 0, Math.PI / 2], scale: [0.2, 0.5, 0.2], color: 0xff7a2e, seg: 5, variant: 5 },
    { kind: 'cone', pos: [-0.26, 0.02, 0.06], rot: [0, 0, Math.PI / 2], scale: [0.14, 0.3, 0.14], color: 0xffd24a, seg: 4, variant: 5 },
    { kind: 'ico', pos: [-0.52, 0.1, -0.06], scale: 0.07, color: 0xffe9a8, variant: 5 },
  ];
}

function fireballProj(): PartSpec[] {
  /*
   * 불덩이 (glowMat 렌더 전제 — 밝은 색).
   * ⚠ **티어 태그를 안 단다.** 이 메시는 모닥불(`aura`, 투사체를 안 쏜다)의 것이면서
   *   **습격대 투척물**이 빌려 쓴다(projectileview `updateRaidShots`). 습격대에는 티어가
   *   없으므로 태그를 달면 그 투척물이 통째로 사라진다.
   */
  return [
    { kind: 'sphere', pos: [0, 0, 0], scale: 0.24, color: C.fire },
    { kind: 'cone', pos: [-0.2, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.16, 0.3, 0.16], color: 0xffd24a, seg: 5 },
  ];
}

function iceProj(): PartSpec[] {
  // 얼음조각: 양끝 뾰족한 결정 → 위성 결정 → **얼음 창 + 냉기**
  const shard = (y: number, z: number, v: number): PartSpec => ({
    kind: 'cone', pos: [-0.02, y, z], rot: [0, 0, -Math.PI / 2], scale: [0.07, 0.2, 0.07],
    color: C.ice, seg: 4, variant: v,
  });
  return [
    { kind: 'cone', pos: [0.12, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.12, 0.3, 0.12], color: C.ice, seg: 5 },
    { kind: 'cone', pos: [-0.12, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.12, 0.3, 0.12], color: C.iceDeep, seg: 5 },
    { kind: 'ico', pos: [0.02, 0.08, 0.02], scale: 0.08, color: 0xe2faff },
    // T2 — 서리 결정이 엉겨 붙는다
    { kind: 'ico', pos: [-0.06, -0.08, 0.06], scale: 0.09, color: 0xcdf1ff, variant: 2 },
    // T3·T4 — **위성 결정 넷**이 본체를 둘러싼다
    shard(0.16, 0, 3), shard(-0.16, 0, 3),
    shard(0, 0.16, 4), shard(0, -0.16, 4),
    // T5 — **얼음 창**: 앞으로 길게 뻗은 창끝 + 뒤로 끌리는 냉기
    { kind: 'cone', pos: [0.4, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.13, 0.34, 0.13], color: 0xeafcff, seg: 5, variant: 5 },
    { kind: 'cone', pos: [-0.34, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.18, 0.44, 0.18], color: 0x8fdcff, seg: 5, variant: 5 },
  ];
}

function dartProj(): PartSpec[] {
  // 독침 → 산탄 → **독구름**
  const barb = (y: number, z: number, v: number): PartSpec => ({
    kind: 'cone', pos: [0.06, y, z], rot: [0, 0, -Math.PI / 2], scale: [0.06, 0.26, 0.06],
    color: C.poison, seg: 4, variant: v,
  });
  return [
    { kind: 'cone', pos: [0.1, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.08, 0.34, 0.08], color: C.poison, seg: 4 },
    { kind: 'sphere', pos: [-0.12, 0, 0], scale: 0.1, color: C.poisonDark },
    // T2 — 독액 방울이 맺힌다
    { kind: 'ico', pos: [0.2, -0.06, 0], scale: 0.07, color: 0xc6f56a, variant: 2 },
    // T3·T4 — **산탄**: 침이 셋으로
    barb(0.11, 0.06, 3),
    barb(-0.09, -0.09, 4),
    // T5 — **독구름**을 끌고 간다
    { kind: 'sphere', pos: [-0.3, 0.02, 0], scale: 0.3, color: 0x5f8c2a, variant: 5 },
    { kind: 'ico', pos: [-0.46, -0.04, 0.08], scale: 0.14, color: 0x7fbb3a, variant: 5 },
  ];
}

function boltProj(): PartSpec[] {
  // 상아 볼트 → 미늘 작살 → **불꽃 작살**
  return [
    { kind: 'cyl', pos: [0, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.07, 0.6, 0.07], color: C.boneDark, seg: 5 },
    { kind: 'cone', pos: [0.36, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.11, 0.22, 0.11], color: C.bone, seg: 5 },
    { kind: 'box', pos: [-0.26, 0, 0.04], rot: [0.4, 0, 0], scale: [0.12, 0.1, 0.02], color: C.hide },
    { kind: 'box', pos: [-0.26, 0, -0.04], rot: [-0.4, 0, 0], scale: [0.12, 0.1, 0.02], color: C.hide },
    // T2 — 촉 뒤에 가죽 감은 금속 띠
    { kind: 'cyl', pos: [0.2, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.1, 0.08, 0.1], color: 0x6f6a5c, seg: 6, variant: 2 },
    // T3 — **미늘 둘** (뒤로 향한 갈고리)
    { kind: 'cone', pos: [0.22, 0.09, 0], rot: [0, 0, 2.2], scale: [0.06, 0.2, 0.06], color: C.bone, seg: 4, variant: 3 },
    { kind: 'cone', pos: [0.22, -0.09, 0], rot: [0, 0, -2.2], scale: [0.06, 0.2, 0.06], color: C.bone, seg: 4, variant: 3 },
    // T4 — 촉이 **작살**로 커진다
    { kind: 'cone', pos: [0.54, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.15, 0.3, 0.15], color: 0xf6efdc, seg: 5, variant: 4 },
    // T5 — 대에 **불이 붙는다**
    { kind: 'cone', pos: [-0.44, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.15, 0.44, 0.15], color: 0xff9a3c, seg: 5, variant: 5 },
    { kind: 'ico', pos: [-0.3, 0, 0], scale: 0.09, color: 0xfff0c0, variant: 5 },
  ];
}

function toothProj(): PartSpec[] {
  // 연타 함정의 나무 이빨 — 짧고 굵다. 초당 3.3발이라 길면 화면이 막대로 덮인다
  const tooth = (y: number, z: number, v: number): PartSpec => ({
    kind: 'cone', pos: [0.06, y, z], rot: [0, 0, -Math.PI / 2], scale: [0.07, 0.2, 0.07],
    color: C.wood, seg: 4, variant: v,
  });
  return [
    { kind: 'cone', pos: [0.08, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.09, 0.26, 0.09], color: C.wood, seg: 4 },
    { kind: 'box', pos: [-0.1, 0, 0], scale: [0.12, 0.07, 0.07], color: C.woodDark },
    // T2 — 끝을 불에 그을려 단단하게 (검은 촉)
    { kind: 'cone', pos: [0.21, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.06, 0.12, 0.06], color: 0x3a2a1c, seg: 4, variant: 2 },
    // T3·T4 — **이빨이 는다** (부채꼴 산탄)
    tooth(0.1, 0.05, 3),
    tooth(-0.1, -0.05, 4),
    // T5 — 이빨에 **독을 먹인다** (붉은 끝 + 흩날리는 조각)
    { kind: 'cone', pos: [0.24, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [0.08, 0.16, 0.08], color: 0xd2483a, seg: 4, variant: 5 },
    { kind: 'ico', pos: [-0.22, 0.06, -0.06], scale: 0.06, color: 0xc9a35a, variant: 5 },
  ];
}

function sparkProj(): PartSpec[] {
  // 충격 말뚝의 방전 덩이 (glowMat 전제 — 밝은 색). 꼬리를 달아 진행 방향이 읽힌다
  const arc = (y: number, z: number, v: number): PartSpec => ({
    kind: 'box', pos: [0.02, y, z], rot: [0.6, 0, 0.5], scale: [0.22, 0.03, 0.03],
    color: 0xeafaff, variant: v,
  });
  return [
    { kind: 'ico', pos: [0, 0, 0], scale: 0.15, color: 0xd9f6ff },
    { kind: 'cone', pos: [-0.16, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.1, 0.26, 0.1], color: C.ice, seg: 4 },
    // T2 — 코어가 커진다
    { kind: 'ico', pos: [0.08, 0.02, 0], scale: 0.1, color: 0xffffff, variant: 2 },
    // T3·T4 — **아크가 뻗는다**
    arc(0.13, 0.05, 3),
    arc(-0.13, -0.05, 4),
    // T5 — **방전 고리**: 진행 방향을 감싸는 납작한 원반 + 바깥 스파크
    { kind: 'cyl', pos: [0.1, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.42, 0.03, 0.42], color: 0x9fe8ff, seg: 8, variant: 5 },
    { kind: 'ico', pos: [-0.3, 0, 0], scale: 0.09, color: 0xffffff, variant: 5 },
  ];
}

const BUILDERS: Partial<Record<TowerId, () => PartSpec[]>> = {
  spear: spearProj,
  catapult: rockProj,
  brazier: fireballProj,
  frost: iceProj,
  poison: dartProj,
  ballista: boltProj,
  rattletrap: toothProj,
  shockstake: sparkProj,
};

/**
 * ══ 종마다 다른 색 ═══════════════════════════════════════════════════════════
 * 사용자 요구: **"종류마다 다른 색 줘 창은 붉게 얼음은 푸르게"**
 *
 * 이 값은 `instanceColor` 로 **정점색에 곱해진다**(뷰가 티어 밝기와 함께 쓴다).
 * 그래서 여기 적는 것은 "칠할 색"이 아니라 **어느 쪽으로 밀 것인가**다.
 *
 * ⚠ `game/fx.ts` 의 `TOWER_FX_COLOR` 와 **일부러 다르다.** 그쪽은 착탄 폭발의 색이라
 *   큰 파티클 뭉치이고 차분해도 읽힌다. 투사체는 **작고 빠르다** — 한눈에 종을 가르려면
 *   더 진해야 한다. 특히 창은 그쪽이 베이지(0xd9c8a0)라 잔디 위에서 거의 안 보였고,
 *   그것이 사용자가 "창은 붉게" 라고 한 이유다.
 * ⚠ 팔레트를 하나로 합치지 않은 이유가 그것이다 — 두 자리의 **요구가 다르다**.
 *   합치면 한쪽을 맞출 때마다 다른 쪽이 어긋난다.
 */
const PROJECTILE_HUE: Partial<Record<TowerId, number>> = {
  spear: 0xff5a3c, // 붉게 (사용자 지정)
  catapult: 0x9a8b72, // 회색 돌 — 붉은 창과 확실히 갈린다
  brazier: 0xff8c42, // 주황 불덩이
  frost: 0x5ab6ff, // 푸르게 (사용자 지정). fx 쪽 0x9fdcf7 보다 진하다 — 작아서 흐리면 안 보인다
  poison: 0x8fd14f, // 초록 독침
  ballista: 0xffd24a, // 금빛 상아 볼트 — 흰 뼈색은 하늘·눈밭에 묻힌다
  rattletrap: 0xc9a35a, // 나무 이빨
  shockstake: 0xbfe9ff, // 창백한 방전 — 얼음보다 희어 구분된다
};

/**
 * 곱셈 색조로 바꾼다 — **평균이 1이 되게 정규화**한 뒤 흰색 쪽으로 되당긴다.
 *
 *  · 정규화: 그냥 hex 를 곱하면 전부 **어두워진다**(모든 채널 ≤ 1). 평균을 1 로 맞추면
 *    밝기는 그대로 두고 **색조만** 민다 — 그래서 T1 이 옛 그림만큼 밝게 남는다.
 *  · 되당김(`HUE_STRENGTH`): 정규화만 하면 창이 (1.89, 0.67, 0.44)로 너무 세다.
 *    0.65 로 섞으면 (1.58, 0.78, 0.64) — 붉지만 창의 나무·돌 결이 살아 있다.
 *    1 로 올리면 원색 덩어리가 되어 로우폴리 결이 통째로 사라진다.
 */
const HUE_STRENGTH = 0.65;
function tintOf(hex: number): readonly [number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const mean = Math.max(1e-3, (r + g + b) / 3);
  const mix = (v: number): number => 1 + (v / mean - 1) * HUE_STRENGTH;
  return [mix(r), mix(g), mix(b)];
}

/** 그 타워 투사체의 색조 배수 (없는 종은 흰색 = 안 민다) */
export function projectileTint(id: TowerId): readonly [number, number, number] {
  const hex = PROJECTILE_HUE[id];
  return hex === undefined ? [1, 1, 1] : tintOf(hex);
}

/** glowMat로 렌더할 투사체 (자체발광) */
export const GLOW_PROJECTILES: ReadonlySet<TowerId> = new Set([
  'brazier', 'frost', 'poison',
  'shockstake', // 방전 덩이 — 발광이라야 "전기"로 읽힌다 (연타 함정은 나무라 평면재질)
]);

/** 투사체를 쏘는 타워 목록 (뷰 인스턴스 준비용) */
export const PROJECTILE_TOWERS: readonly TowerId[] = [
  'spear',
  'catapult',
  'brazier',
  'frost',
  'poison',
  'ballista',
  'rattletrap',
  'shockstake',
];

/** 캐시된 투사체 지오메트리. 매핑 없는 타워(beam/aura)는 null */
export function buildProjectile(towerId: TowerId): THREE.BufferGeometry | null {
  const builder = BUILDERS[towerId];
  if (!builder) return null;
  return cachedGeo(`proj:${towerId}`, () => buildParts(builder(), { seed: 9, ao: 0, faceJitter: 0.03 }));
}
