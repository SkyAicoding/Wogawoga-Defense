/**
 * 습격대 대응 수단 검증 — "부족 습격에 답이 하나만 있으면 빌드가 죽는다"를 데이터로 잠근다.
 *
 * 전체 자동플레이(autoplay.test.ts)는 승패 하나로 압축되어 "얼음이 습격대에 쓸모가
 * 있는가" 같은 질문에 답하지 못한다. 여기서는 tests/sim/arena.ts 의 통제 실험장을 써서
 * (타워 종류 × 습격대 종류 × 경로 이격 거리)만 남기고 전부 고정한다. 예산은 항상 같다.
 *
 * 잠그는 명제는 넷이다:
 *  1) 경로 이격이 근접에 대한 완전한 해답이다 (siege.ts 규칙 1이 데이터로 성립하는가)
 *  2) 원거리(궁수)는 이격으로 풀리지 않는다 → 그래서 '대응'이 필요하다
 *  3) 완전 회피(더 멀리)는 화력 포기라는 대가가 있다
 *  4) 안전선·노출선 각각에 **서로 다른** 답이 여럿 있다 (한 가지 정답 금지)
 */
import { describe, expect, it } from 'vitest';
import { runArena } from './arena';
import { ENEMY_DEFS } from '@/data/enemies';
import type { EnemyId, TowerId } from '@/data/types';

const GOLD = 900;
const BLADES: { id: EnemyId; count: number }[] = [{ id: 'blade', count: 12 }];
const LANCERS: { id: EnemyId; count: number }[] = [{ id: 'lancer', count: 10 }];
const ARCHERS: { id: EnemyId; count: number }[] = [{ id: 'archer', count: 12 }];

describe('습격대 대응 수단', () => {
  /**
   * siege.ts 규칙 1의 데이터 증명 — 적은 경로를 벗어나지 않으므로 근접(칼 1.5 / 창 1.95)은
   * 경로에서 2칸 떨어진 타워에 **영원히** 닿지 못한다. 타워 좌표가 셀 정수라 2.0이 확정선이다.
   */
  it('근접 습격대는 경로 이격 2칸으로 완전히 막힌다', () => {
    for (const pack of [BLADES, LANCERS]) {
      const near = runArena({ towers: ['spear'], pack, dist: 1, gold: GOLD });
      const far = runArena({ towers: ['spear'], pack, dist: 2, gold: GOLD });
      expect(near.towerDamage, `${pack[0]!.id} 이격1`).toBeGreaterThan(0);
      expect(near.towersLost, `${pack[0]!.id} 이격1`).toBeGreaterThan(0);
      expect(far.towerDamage, `${pack[0]!.id} 이격2`).toBe(0);
      expect(far.towersLost, `${pack[0]!.id} 이격2`).toBe(0);
    }
  });

  /**
   * 근접만 있으면 배치 한 번으로 습격대가 영구 무력화된다 — 그래서 궁수(사거리 3.2)가
   * 최소 구성에 함께 들어간다(stage01.allowedEnemies 주석). 이 명제가 깨지면
   * '습격이 오면 대응한다'가 '한 번 잘 두면 끝'으로 퇴화한다.
   */
  it('원거리 습격대(궁수)는 이격으로 풀리지 않는다', () => {
    const r2 = runArena({ towers: ['spear'], pack: ARCHERS, dist: 2, gold: GOLD });
    const r3 = runArena({ towers: ['spear'], pack: ARCHERS, dist: 3, gold: GOLD });
    expect(r2.towerDamage, '이격2').toBeGreaterThan(0);
    expect(r3.towerDamage, '이격3').toBeGreaterThan(0);
    // 궁수 사거리(3.2)를 실제로 넘어야 비로소 안전해진다
    expect(ENEMY_DEFS.archer.towerAttack!.range).toBeGreaterThan(3);
  });

  /**
   * 완전 회피의 대가 — spear(사거리 2.6)가 궁수 사거리 밖(4칸)으로 물러나면
   * 맞지는 않지만 경로에 닿지도 못해 **아무도 못 잡는다**.
   * 이 대가가 없으면 "무조건 멀리"가 지배 전략이 된다.
   */
  it('사거리를 버리고 물러나면 안 맞지만 아무것도 못 잡는다', () => {
    const r = runArena({ towers: ['spear'], pack: ARCHERS, dist: 4, gold: GOLD });
    expect(r.towerDamage, '이격4 피해').toBe(0);
    expect(r.killed, '이격4 처치').toBe(0);
  });

  /**
   * 다만 사거리가 아주 긴 타워(ballista 5.5)에게는 '물러나기'가 진짜 전략이 된다 —
   * 습격대 전원의 사거리(최대 hexer 3.6) 밖에 서면서도 경로를 덮는 유일한 종.
   * 이게 성립해야 "타워마다 습격대에 대한 답이 다르다"가 성립한다.
   */
  it('발리스타는 사거리로 습격대 전체의 밖에 설 수 있다', () => {
    const r = runArena({ towers: ['ballista'], pack: ARCHERS, dist: 4, gold: GOLD });
    expect(r.towerDamage, '이격4에서 무피해').toBe(0);
    expect(r.killed, '이격4에서도 사냥한다').toBeGreaterThan(0);
    // 습격대 최장 사거리보다 멀리 있다는 사실 자체를 잠근다
    const maxRaiderRange = Math.max(
      ...(['blade', 'lancer', 'archer', 'hexer'] as EnemyId[]).map(
        (id) => ENEMY_DEFS[id].towerAttack!.range,
      ),
    );
    expect(maxRaiderRange).toBeLessThan(4);
  });

  /**
   * 한 가지 정답 금지 — 안전선(이격 2)에서 습격대를 처리할 수 있는 타워가 여럿이어야 한다.
   * 실측(예산 900, 칼잡이 12): catapult 12 / ballista 10 / lightning 9 / poison 7 / spear 5.
   */
  it('안전선에서 습격대를 정리하는 타워가 여럿이다', () => {
    const candidates: TowerId[] = ['spear', 'catapult', 'lightning', 'poison', 'ballista'];
    const ok = candidates.filter(
      (t) => runArena({ towers: [t], pack: BLADES, dist: 2, gold: GOLD }).killed >= 6,
    );
    expect(ok.length, `절반 이상 처치한 타워: ${ok.join(',')}`).toBeGreaterThanOrEqual(3);
  });

  /**
   * 노출선(이격 1)에는 **다른** 답이 있다 — 화염은 사거리 1.8이라 안전선에서는 아무 일도
   * 못 하지만, 붙어 있으면 '멈춰 서서 때리는' 근접을 통째로 태운다.
   * 안전 배치의 최적해와 노출 배치의 최적해가 다르다는 것이 빌드 다양성의 근거다.
   */
  it('화염은 노출 배치 전용 답이다 (안전선에서는 무용, 노출선에서는 최상급)', () => {
    const safe = runArena({ towers: ['brazier'], pack: BLADES, dist: 2, gold: GOLD });
    const exposed = runArena({ towers: ['brazier'], pack: BLADES, dist: 1, gold: GOLD });
    expect(safe.killed, '이격2 화염').toBe(0);
    expect(exposed.killed, '이격1 화염').toBe(exposed.total);
    expect(exposed.towersLost, '이격1 화염은 부서지지 않고 버틴다').toBe(0);
    // 같은 예산·같은 노출 배치에서 단일 대상 타워는 무리에 갈려 나간다 (역할이 갈린다)
    const spear = runArena({ towers: ['spear'], pack: BLADES, dist: 1, gold: GOLD });
    expect(spear.towersLost, '이격1 창던지기').toBeGreaterThan(0);
  });

  /**
   * 얼음의 자리(siege.ts 규칙 9) — 감속은 타워가 받는 **한 대의 위력**을 깎는다.
   * 정답이 되지는 않지만(적용 빈도가 병목) 습격대 앞에서 죽은 카드가 되지도 않는다.
   */
  it('얼음은 습격대의 한 방 위력을 깎는다', () => {
    const base = ENEMY_DEFS.blade.towerAttack!.dmg;
    const plain = runArena({ towers: ['spear'], pack: BLADES, dist: 1, gold: GOLD, spacing: 2 });
    const iced = runArena({
      towers: ['frost', 'spear', 'spear', 'spear'],
      pack: BLADES,
      dist: 1,
      gold: GOLD,
      spacing: 2,
    });
    // 얼음이 없으면 모든 타격이 정확히 정가(定價)다
    expect(plain.minHit, '얼음 없음').toBe(base);
    expect(plain.maxHit, '얼음 없음').toBe(base);
    // 얼음이 있으면 얼어붙은 개체의 타격이 정가보다 약하다
    expect(iced.minHit, '얼음 있음').toBeLessThan(base);
    expect(iced.minHit).toBeGreaterThan(0);
  });
});
