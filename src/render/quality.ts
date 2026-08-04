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
  },
  med: {
    tier: 'med',
    shadows: true,
    shadowMapSize: 1024,
    particleMax: 384,
    waterAnim: false,
    maxDpr: 2,
    ambientParticles: true,
  },
  high: {
    tier: 'high',
    shadows: true,
    shadowMapSize: 2048,
    particleMax: 512,
    waterAnim: true,
    maxDpr: 2,
    ambientParticles: true,
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
