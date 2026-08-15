/**
 * 품질 티어 — 기기 성능에 따른 렌더 옵션 게이트.
 * auto: 모바일=med, 데스크톱=high. 런타임 강등(degrade)은 renderer의 동적 해상도가
 * 바닥(0.7)에 닿아도 프레임이 안 나올 때 상위 레이어가 호출한다.
 */
import { isMobile } from '@/core/device';

export type QualityTier = 'low' | 'med' | 'high';

export interface QualityFlags {
  tier: QualityTier;
  /** 그림자 사용 여부 */
  shadows: boolean;
  /** 섀도맵 한 변 크기 */
  shadowMapSize: number;
  /** 파티클 인스턴스 상한 */
  particleMax: number;
  /** 물 버텍스 흔들림 애니메이션 */
  waterAnim: boolean;
  /** DPR 상한 (device.cappedDpr와 min 결합) */
  maxDpr: number;
  /** 환경 파티클(눈/재) 허용 */
  ambientParticles: boolean;
  /**
   * 맨 셀 바닥 결(meshlib/grounddetail) 밀도 배수. 1 = 설계 그대로.
   *
   * 왜 티어를 나누는가: 이 레이어는 **캐스터가 아니라** 프레임 청구가 ×1 이고
   * 스테이지당 2,000~3,600 삼각형뿐이라 삼각형만 보면 low 에서도 부담이 아니다.
   * 문제는 삼각형이 아니라 **오버드로우**다 — 지면 위 6mm 에 깔린 불투명 판이라
   * 판 면적만큼 픽셀을 두 번 칠한다. low 티어의 병목은 정확히 픽셀 채우기이고
   * (그래서 그림자·물 애니메이션·환경 파티클을 전부 끈다), 셀당 액센트를 절반으로
   * 줄이면 덮이는 면적이 그만큼 준다. 0 으로 끄지 않는 것은 "허전함"이 low 기기에서
   * 더 심해지면 안 되기 때문이다 — 셀마다 바닥 얼룩 1장 + 액센트 최소 1개는 남는다.
   */
  groundDetail: number;
}

const PRESETS: Record<QualityTier, QualityFlags> = {
  low: {
    tier: 'low',
    shadows: false,
    shadowMapSize: 512,
    particleMax: 256,
    waterAnim: false,
    maxDpr: 1.5,
    ambientParticles: false,
    groundDetail: 0.5,
  },
  med: {
    tier: 'med',
    shadows: true,
    shadowMapSize: 1024,
    particleMax: 384,
    waterAnim: false,
    maxDpr: 2,
    ambientParticles: true,
    groundDetail: 1,
  },
  high: {
    tier: 'high',
    shadows: true,
    shadowMapSize: 2048,
    particleMax: 512,
    waterAnim: true,
    maxDpr: 2,
    ambientParticles: true,
    groundDetail: 1,
  },
};

export function flagsFor(tier: QualityTier): QualityFlags {
  return PRESETS[tier];
}

export function autoTier(): QualityTier {
  return isMobile ? 'med' : 'high';
}

/** 현재 티어 보관 + 변경 통지. 강등은 high→med→low 단방향. */
export class QualityManager {
  private tier: QualityTier;
  private listeners = new Set<(flags: QualityFlags) => void>();

  constructor(initial: QualityTier | 'auto' = 'auto') {
    this.tier = initial === 'auto' ? autoTier() : initial;
  }

  get flags(): QualityFlags {
    return PRESETS[this.tier];
  }

  get current(): QualityTier {
    return this.tier;
  }

  set(tier: QualityTier): void {
    if (this.tier === tier) return;
    this.tier = tier;
    for (const fn of this.listeners) fn(this.flags);
  }

  /** 한 단계 강등. 이미 low면 false */
  degrade(): boolean {
    if (this.tier === 'high') {
      this.set('med');
      return true;
    }
    if (this.tier === 'med') {
      this.set('low');
      return true;
    }
    return false;
  }

  onChange(fn: (flags: QualityFlags) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
