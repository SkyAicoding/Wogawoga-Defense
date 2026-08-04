/**
 * 타워 티어 크기 램프 회귀 테스트 — WebGL 없이 지오메트리 바운딩만 검사한다.
 *
 * 지키려는 것:
 *  1) Lv1 은 정확히 0.60배 (사용자 요청: 40% 축소)
 *  2) 램프는 단조 증가하고 단계 간격이 고르다
 *  3) **한 칸(월드 1.0)을 심하게 넘지 않는다** — 인접 만렙 타워가 한 덩어리로
 *     뭉쳐 몇 기인지 셀 수 없던 결함의 회귀 가드. 받침(groundRim) 반경을 다시
 *     티어와 함께 키우거나 램프 상한을 올리면 여기서 걸린다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTower, towerTierScale } from '@/render/meshlib/towers';
import { ALL_TOWER_IDS } from '@/data';
import type { TowerId } from '@/data/types';

/** 티어 t 모델의 (월드 단위) 최대 가로폭 / 높이 — 루트 티어 스케일 반영 */
function extent(id: TowerId, tier: number): { w: number; h: number } {
  const m = buildTower(id, tier);
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  for (const g of [m.base, m.head, m.action]) {
    if (!g) continue;
    g.computeBoundingBox();
    b.copy(g.boundingBox as THREE.Box3);
    box.union(b);
  }
  const s = towerTierScale(tier);
  return {
    w: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * s,
    h: box.max.y * s,
  };
}

describe('towerTierScale', () => {
  it('Lv1은 정확히 0.60배', () => {
    expect(towerTierScale(0)).toBeCloseTo(0.6, 6);
  });

  it('티어가 오를수록 단조 증가하고 단계 간격이 고르다', () => {
    const steps: number[] = [];
    for (let t = 1; t < 5; t++) {
      const d = towerTierScale(t) - towerTierScale(t - 1);
      expect(d, `T${t}→T${t + 1} 이 커지지 않음`).toBeGreaterThan(0);
      steps.push(d);
    }
    const min = Math.min(...steps);
    const max = Math.max(...steps);
    expect(max - min, `단계 간격 편차 ${max - min}`).toBeLessThan(0.02);
  });

  it('범위 밖 티어는 클램프된다', () => {
    expect(towerTierScale(-3)).toBe(towerTierScale(0));
    expect(towerTierScale(9)).toBe(towerTierScale(4));
  });
});

describe('타워 실루엣이 격자를 지킨다', () => {
  it('T1은 한 칸 안에 들어온다', () => {
    for (const id of ALL_TOWER_IDS) {
      const { w } = extent(id, 0);
      expect(w, `${id} T1 폭 ${w.toFixed(2)}셀`).toBeLessThanOrEqual(1.05);
    }
  });

  it('T5도 한 칸을 크게 넘지 않는다 (인접 만렙 타워가 뭉치지 않게)', () => {
    for (const id of ALL_TOWER_IDS) {
      const { w } = extent(id, 4);
      expect(w, `${id} T5 폭 ${w.toFixed(2)}셀`).toBeLessThanOrEqual(1.45);
    }
  });

  // 실루엣 폭 자체는 고티어에 붙는 장식(뼈대/상아/금테) 때문에 배율보다 더 자란다.
  // 여기서 묶는 건 '크기 배율' 쪽 — 배율 상한을 다시 올리면 T5 폭 가드가 먼저 깨진다.
  it('크기 배율 성장은 1.5배 이내', () => {
    expect(towerTierScale(4) / towerTierScale(0)).toBeLessThanOrEqual(1.5);
  });
});
