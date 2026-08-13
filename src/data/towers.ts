/**
 * 타워 8종 × 5티어 정의.
 * 앵커: spear T1 dmg12/cd15/range2.6/cost100. 티어당 DPS(dmg/cd) ×1.55~1.75, cost ×1.9~2.1
 * (tests/data가 잠근다). drum은 공격 없음(버프 오라) — DPS 규칙 예외.
 * brazier는 aura.dmgPerStatusTick이 실제 피해원이며 dmg 필드는 이를 미러링(cd=15 고정).
 */
import type { TowerDef, TowerId } from './types';

/**
 * 별 업그레이드 비용 — 별 n(1~5)이 되기 위한 [조각, 호박]. 전 타워 공통 곡선.
 * 조각은 보스 드랍, 호박은 스테이지 보상으로 수급.
 */
const STAR_COSTS: [number, number][] = [
  [10, 60],
  [20, 120],
  [35, 220],
  [55, 380],
  [80, 600],
];

export const TOWER_DEFS: Record<TowerId, TowerDef> = {
  // 창던지기 움막 — 기본 단일 대상, 지상/공중. 만능 초반 코어.
  spear: {
    id: 'spear',
    nameKey: 'tower.spear.name',
    descKey: 'tower.spear.desc',
    attackKind: 'homing',
    canTargetGround: true,
    canTargetAir: true,
    // 통나무 움막 — 기준값
    toughness: 1.00,
    tiers: [
      { dmg: 12, cooldownTicks: 15, range: 2.6, cost: 100, projectileSpeed: 13 },
      { dmg: 18, cooldownTicks: 14, range: 2.9, cost: 200, projectileSpeed: 13 },
      { dmg: 28, cooldownTicks: 13, range: 3.2, cost: 400, projectileSpeed: 14 },
      { dmg: 43, cooldownTicks: 12, range: 3.6, cost: 800, projectileSpeed: 14 },
      { dmg: 65, cooldownTicks: 11, range: 4.0, cost: 1600, projectileSpeed: 15 },
    ],
    starBonus: { dmgPct: 0.08, ratePct: 0.04 },
    unlock: { type: 'start' },
    starCosts: STAR_COSTS,
  },
  // 돌 투석기 — 느린 광역 포격, 지상 전용. 스웜 카운터.
  catapult: {
    id: 'catapult',
    nameKey: 'tower.catapult.name',
    descKey: 'tower.catapult.desc',
    attackKind: 'ballistic',
    canTargetGround: true,
    canTargetAir: false,
    // 통나무 프레임 + 돌 추 — 가장 단단하다
    toughness: 1.25,
    tiers: [
      {
        dmg: 30, cooldownTicks: 45, range: 3.2, cost: 120, projectileSpeed: 7,
        splash: { radius: 1.2, falloff: 0.4 },
      },
      {
        dmg: 47, cooldownTicks: 44, range: 3.5, cost: 240, projectileSpeed: 7,
        splash: { radius: 1.35, falloff: 0.4 },
      },
      {
        dmg: 76, cooldownTicks: 43, range: 3.8, cost: 470, projectileSpeed: 7.5,
        splash: { radius: 1.5, falloff: 0.4 },
      },
      {
        dmg: 122, cooldownTicks: 42, range: 4.2, cost: 940, projectileSpeed: 7.5,
        splash: { radius: 1.65, falloff: 0.4 },
      },
      {
        dmg: 192, cooldownTicks: 40, range: 4.6, cost: 1880, projectileSpeed: 8,
        splash: { radius: 1.8, falloff: 0.4 },
      },
    ],
    starBonus: { dmgPct: 0.1, ratePct: 0.03 },
    unlock: { type: 'start' },
    starCosts: STAR_COSTS,
  },
  // 번개 주술 토템 — 3점프 체인(감쇠 0.7), 지상/공중. 줄지어 오는 무리에 강함.
  lightning: {
    id: 'lightning',
    nameKey: 'tower.lightning.name',
    descKey: 'tower.lightning.desc',
    attackKind: 'beam',
    canTargetGround: true,
    canTargetAir: true,
    // 토템에 박은 수정 — 충격에 약하다
    toughness: 0.90,
    tiers: [
      { dmg: 16, cooldownTicks: 30, range: 2.8, cost: 140, chain: { jumps: 3, decay: 0.7, jumpRange: 2.0 } },
      { dmg: 24, cooldownTicks: 28, range: 3.1, cost: 280, chain: { jumps: 3, decay: 0.7, jumpRange: 2.2 } },
      { dmg: 38, cooldownTicks: 27, range: 3.4, cost: 560, chain: { jumps: 3, decay: 0.7, jumpRange: 2.4 } },
      { dmg: 60, cooldownTicks: 26, range: 3.6, cost: 1120, chain: { jumps: 3, decay: 0.7, jumpRange: 2.7 } },
      { dmg: 91, cooldownTicks: 24, range: 3.9, cost: 2240, chain: { jumps: 3, decay: 0.7, jumpRange: 3.0 } },
    ],
    starBonus: { dmgPct: 0.08, ratePct: 0.05 },
    unlock: { type: 'stage', stage: 1 },
    starCosts: STAR_COSTS,
  },
  // 화염 모닥불 — 반경 오라, 0.5초마다 피해 + 화상(3스택). 지상 전용, 경로 밀집 지점용.
  brazier: {
    id: 'brazier',
    nameKey: 'tower.brazier.name',
    descKey: 'tower.brazier.desc',
    attackKind: 'aura',
    canTargetGround: true,
    canTargetAir: false,
    // 돌을 쌓은 화덕
    toughness: 1.05,
    tiers: [
      {
        dmg: 8, cooldownTicks: 15, range: 1.4, cost: 110,
        aura: {
          radius: 1.4, dmgPerStatusTick: 8,
          status: { kind: 'burn', magnitude: 3, durationTicks: 45, chance: 1 },
        },
      },
      {
        dmg: 13, cooldownTicks: 15, range: 1.65, cost: 220,
        aura: {
          radius: 1.65, dmgPerStatusTick: 13,
          status: { kind: 'burn', magnitude: 5, durationTicks: 45, chance: 1 },
        },
      },
      {
        dmg: 21, cooldownTicks: 15, range: 1.9, cost: 440,
        aura: {
          radius: 1.9, dmgPerStatusTick: 21,
          status: { kind: 'burn', magnitude: 8, durationTicks: 45, chance: 1 },
        },
      },
      {
        dmg: 34, cooldownTicks: 15, range: 2.2, cost: 880,
        aura: {
          radius: 2.2, dmgPerStatusTick: 34,
          status: { kind: 'burn', magnitude: 13, durationTicks: 45, chance: 1 },
        },
      },
      {
        dmg: 55, cooldownTicks: 15, range: 2.5, cost: 1760,
        aura: {
          radius: 2.5, dmgPerStatusTick: 55,
          status: { kind: 'burn', magnitude: 21, durationTicks: 45, chance: 1 },
        },
      },
    ],
    starBonus: { dmgPct: 0.09, ratePct: 0, rangePct: 0.03 },
    unlock: { type: 'amber', cost: 600 },
    starCosts: STAR_COSTS,
  },
  // 얼음 크리스탈 — 저피해 + 확정 감속(0.35→0.55), 지상/공중. 컨트롤 코어.
  frost: {
    id: 'frost',
    nameKey: 'tower.frost.name',
    descKey: 'tower.frost.desc',
    attackKind: 'homing',
    canTargetGround: true,
    canTargetAir: true,
    // 얼음 결정 — 가장 무르다
    toughness: 0.80,
    tiers: [
      {
        dmg: 7, cooldownTicks: 20, range: 2.4, cost: 90, projectileSpeed: 11,
        status: { kind: 'slow', magnitude: 0.35, durationTicks: 45, chance: 1 },
      },
      {
        dmg: 11, cooldownTicks: 19, range: 2.6, cost: 180, projectileSpeed: 11,
        status: { kind: 'slow', magnitude: 0.4, durationTicks: 45, chance: 1 },
      },
      {
        dmg: 18, cooldownTicks: 19, range: 2.8, cost: 360, projectileSpeed: 11,
        status: { kind: 'slow', magnitude: 0.45, durationTicks: 50, chance: 1 },
      },
      {
        dmg: 28, cooldownTicks: 18, range: 3.0, cost: 720, projectileSpeed: 12,
        status: { kind: 'slow', magnitude: 0.5, durationTicks: 50, chance: 1 },
      },
      {
        dmg: 44, cooldownTicks: 17, range: 3.3, cost: 1440, projectileSpeed: 12,
        status: { kind: 'slow', magnitude: 0.55, durationTicks: 55, chance: 1 },
      },
    ],
    starBonus: { dmgPct: 0.06, ratePct: 0.05, rangePct: 0.02 },
    unlock: { type: 'start' },
    starCosts: STAR_COSTS,
  },
  // 독가시 식물 — 직격은 약하지만 강력한 DoT(armor 무시, 3스택). 고장갑 카운터.
  poison: {
    id: 'poison',
    nameKey: 'tower.poison.name',
    descKey: 'tower.poison.desc',
    attackKind: 'homing',
    canTargetGround: true,
    canTargetAir: true,
    // 살아 있는 식물
    toughness: 0.85,
    tiers: [
      {
        dmg: 6, cooldownTicks: 24, range: 2.7, cost: 130, projectileSpeed: 12,
        status: { kind: 'poison', magnitude: 6, durationTicks: 90, chance: 1 },
      },
      {
        dmg: 10, cooldownTicks: 24, range: 2.9, cost: 260, projectileSpeed: 12,
        status: { kind: 'poison', magnitude: 10, durationTicks: 90, chance: 1 },
      },
      {
        dmg: 16, cooldownTicks: 23, range: 3.1, cost: 520, projectileSpeed: 12,
        status: { kind: 'poison', magnitude: 16, durationTicks: 90, chance: 1 },
      },
      {
        dmg: 26, cooldownTicks: 23, range: 3.25, cost: 1040, projectileSpeed: 13,
        status: { kind: 'poison', magnitude: 26, durationTicks: 90, chance: 1 },
      },
      {
        dmg: 42, cooldownTicks: 22, range: 3.4, cost: 2080, projectileSpeed: 13,
        status: { kind: 'poison', magnitude: 42, durationTicks: 90, chance: 1 },
      },
    ],
    starBonus: { dmgPct: 0.1, ratePct: 0.04 },
    unlock: { type: 'stage', stage: 2 },
    starCosts: STAR_COSTS,
  },
  // 상아 발리스타 — 초장거리 고데미지 저속, 대공 특화 저격.
  ballista: {
    id: 'ballista',
    nameKey: 'tower.ballista.name',
    descKey: 'tower.ballista.desc',
    attackKind: 'homing',
    canTargetGround: true,
    canTargetAir: true,
    // 상아·힘줄 기계
    toughness: 1.15,
    tiers: [
      { dmg: 55, cooldownTicks: 60, range: 5.5, cost: 150, projectileSpeed: 18 },
      { dmg: 88, cooldownTicks: 58, range: 5.9, cost: 300, projectileSpeed: 18 },
      { dmg: 140, cooldownTicks: 56, range: 6.3, cost: 600, projectileSpeed: 19 },
      { dmg: 224, cooldownTicks: 54, range: 6.7, cost: 1200, projectileSpeed: 19 },
      { dmg: 350, cooldownTicks: 52, range: 7.0, cost: 2400, projectileSpeed: 20 },
    ],
    starBonus: { dmgPct: 0.1, ratePct: 0.05 },
    unlock: { type: 'stage', stage: 3 },
    starCosts: STAR_COSTS,
  },
  // 전쟁북 — 공격 없음. 반경 내 타워 dmg/공속 버프(중첩 시 최대값만).
  drum: {
    id: 'drum',
    nameKey: 'tower.drum.name',
    descKey: 'tower.drum.desc',
    attackKind: 'aura',
    canTargetGround: false,
    canTargetAir: false,
    // 가죽 북 + 두꺼운 나무 틀
    toughness: 1.10,
    tiers: [
      { dmg: 0, cooldownTicks: 30, range: 1.6, cost: 130, aura: { radius: 1.6, dmgPct: 0.15, ratePct: 0.15 } },
      { dmg: 0, cooldownTicks: 30, range: 2.0, cost: 260, aura: { radius: 2.0, dmgPct: 0.21, ratePct: 0.21 } },
      { dmg: 0, cooldownTicks: 30, range: 2.4, cost: 520, aura: { radius: 2.4, dmgPct: 0.27, ratePct: 0.27 } },
      { dmg: 0, cooldownTicks: 30, range: 2.8, cost: 1040, aura: { radius: 2.8, dmgPct: 0.33, ratePct: 0.33 } },
      { dmg: 0, cooldownTicks: 30, range: 3.2, cost: 2080, aura: { radius: 3.2, dmgPct: 0.4, ratePct: 0.4 } },
    ],
    starBonus: { dmgPct: 0, ratePct: 0, rangePct: 0.04 },
    unlock: { type: 'amber', cost: 900 },
    starCosts: STAR_COSTS,
  },
};

export const ALL_TOWER_IDS = Object.keys(TOWER_DEFS) as TowerId[];
