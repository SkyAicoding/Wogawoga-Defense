/**
 * 습격대 대응 수단 검증 — "부족 습격에 답이 하나만 있으면 빌드가 죽는다"를 데이터로 잠근다.
 *
 * 전체 자동플레이(autoplay.test.ts)는 승패 하나로 압축되어 "얼음이 습격대에 쓸모가
 * 있는가" 같은 질문에 답하지 못한다. 여기서는 tests/sim/arena.ts 의 통제 실험장을 써서
 * (타워 종류 × 습격대 종류 × 경로 이격 거리)만 남기고 전부 고정한다. 예산은 항상 같다.
 *
 * 잠그는 명제는 넷이다:
 *  1) **안전선이 2칸 → 3칸으로 밀렸다** — 전원 원거리 개편의 부수 효과.
 *     전위(투창병 2.4 / 큰창잡이 2.8)가 이제 두 칸(2.0)에 닿으므로, 근접 시절의
 *     "두 칸이면 영구 무력화"가 사라지고 세 칸(3.0)이 새 경계가 됐다.
 *  2) 뒤열(궁수 3.2 / 저주사 3.6)은 세 칸으로도 안 풀린다 → 그래서 '대응'이 필요하다
 *  3) 완전 회피(네 칸)는 화력 포기라는 대가가 있다
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

/**
 * 타워를 때리는 **다섯 종 전부**. `range`로 갈리는 두 무리를 이름으로 못 박는다:
 *  · 전위(2.2~2.8)는 세 칸에 못 닿고, 뒤열(3.2~3.6)은 닿는다.
 * warrior는 습격대가 아니지만 towerAttack을 가진 종이라 같은 잣대로 잰다
 * (src/data/enemies.ts warrior 주석 — 이 표가 그 주석의 근거다).
 */
const SHORT: EnemyId[] = ['blade', 'lancer', 'warrior'];
const LONG: EnemyId[] = ['archer', 'hexer'];
const ALL_ATTACKERS: EnemyId[] = [...SHORT, ...LONG];

describe('습격대 대응 수단', () => {
  /**
   * 개편의 부수 효과를 정면으로 잠근다 — **두 칸은 더 이상 안전선이 아니다.**
   * 근접 시절(칼 1.5 / 창 1.95)에는 이격 2에서 전위의 타워 피해가 정확히 0이었다
   * (실측: blade 0 · lancer 0). 이제 2.4 / 2.8이라 두 칸(2.0)에 닿는다.
   * 이 명제가 깨지면 사용자의 "전원 원거리" 요구가 데이터에 반영되지 않은 것이다.
   */
  it('전위(투창병·큰창잡이)가 이제 이격 2칸의 타워에 닿는다', () => {
    for (const pack of [BLADES, LANCERS]) {
      const id = pack[0]!.id;
      expect(ENEMY_DEFS[id].towerAttack!.range, `${id} 사거리 > 2칸`).toBeGreaterThan(2);
      const near = runArena({ towers: ['spear'], pack, dist: 1, gold: GOLD });
      const far = runArena({ towers: ['spear'], pack, dist: 2, gold: GOLD });
      expect(near.towerDamage, `${id} 이격1`).toBeGreaterThan(0);
      expect(far.towerDamage, `${id} 이격2`).toBeGreaterThan(0);
    }
  });

  /**
   * 그리고 **세 칸이 새 안전선**이다 — 전위는 3.0에 못 닿는다.
   * 안전선이 존재하지 않으면 "얼마나 떨어뜨려 짓는가"라는 축이 통째로 사라진다.
   */
  it('전위는 이격 3칸에서 다시 완전히 막힌다 (새 안전선)', () => {
    for (const pack of [BLADES, LANCERS]) {
      const id = pack[0]!.id;
      expect(ENEMY_DEFS[id].towerAttack!.range, `${id} 사거리 < 3칸`).toBeLessThan(3);
      const r = runArena({ towers: ['spear'], pack, dist: 3, gold: GOLD });
      expect(r.towerDamage, `${id} 이격3`).toBe(0);
      expect(r.towersLost, `${id} 이격3`).toBe(0);
    }
  });

  /**
   * ── 12단계: **거리 축을 다섯 종 전부에 대해 잠근다** ───────────────────────
   *
   * 왜 필요했나: 봇의 사망 웨이브가 lancer·hexer의 첫 등장 웨이브보다 앞서서, 전
   * 스테이지 자동플레이 20시드 합계로 **lancer 사격 0회 · hexer 사격 0회**였다.
   * 실제로 s2~s6에서 습격대 5종 전원의 `towerAttack.range`를 0으로 만들어도 봇 결과가
   * 소수점까지 동일하다 — 곧 그 스테이지들에 문턱을 걸면 전부 공허한 초록이 된다.
   * 실험장은 반대다: 봇도 경제도 없고 (종 × 이격) 둘만 남으므로 **분산이 정확히 0**이고
   * 한 판에 0.2초다. 잴 수 없던 두 종이 여기서는 잴 수 있다.
   *
   * 두 문장을 잠근다. 실측(창던지기 4기 · 각 종 12명 · 예산 900):
   *  (a) **세 칸은 전위의 안전선이다** — 전위 셋은 피해 0, 뒤열 둘은 0이 아니다.
   *        blade 0 · lancer 0 · warrior 0 / archer 480 · hexer 240
   *  (b) **정지 사격은 1칸에서만 일어난다** (siege.ts 규칙 4-a의 약속 그 자체).
   *        이격 1 → blade 37.7% · archer 35.6% · lancer 35.5% · hexer 23.3% · warrior 21.9%
   *        이격 2 → **다섯 종 전부 정확히 0.0%**
   * 문턱은 1칸 >15%(실측 최저 21.9%에서 7%p 아래) · 2칸 ===0.
   *
   * 판별력 확인(실제로 되돌려 봤다): `balance.SIEGE_ENGAGE_RANGE`를 9단계 값 2.1로
   * 되돌리면 이격 2칸의 정지 사격 비율이 다섯 종 전부 0이 아니게 되어
   * (blade 31.2% · lancer 34.2% · archer 34.6% · hexer 23.2% · warrior 21.7%)
   * (b)가 다섯 종 모두에서 즉시 빨개진다 — 곧 이 항목은 "정지선이 1칸과 2칸을 가르는가"를
   * 다섯 종 전부에 대해 잠근다. (a)는 각 종의 `range`를 3 위로 올리면 빨개진다.
   */
  it('타워를 때리는 다섯 종: 세 칸이 전위의 안전선이고, 정지 사격은 한 칸에서만 난다', () => {
    for (const id of ALL_ATTACKERS) {
      const pack = [{ id, count: 12 }];
      const d1 = runArena({ towers: ['spear'], pack, dist: 1, gold: GOLD });
      const d2 = runArena({ towers: ['spear'], pack, dist: 2, gold: GOLD });
      const d3 = runArena({ towers: ['spear'], pack, dist: 3, gold: GOLD });
      const msg = `${id} d1 ${d1.towerDamage}/${(d1.holdRatio * 100).toFixed(1)}% · d2 ${d2.towerDamage}/${(d2.holdRatio * 100).toFixed(1)}% · d3 ${d3.towerDamage}`;
      // (a) 세 칸 — 사거리 3 미만인 종은 한 대도 못 때리고, 넘는 종은 때린다
      if (SHORT.includes(id)) {
        expect(ENEMY_DEFS[id].towerAttack!.range, `${id} 사거리 < 3`).toBeLessThan(3);
        expect(d3.towerDamage, msg).toBe(0);
      } else {
        expect(ENEMY_DEFS[id].towerAttack!.range, `${id} 사거리 > 3`).toBeGreaterThan(3);
        expect(d3.towerDamage, msg).toBeGreaterThan(0);
      }
      // (b) 정지 사격 — 한 칸에서는 확실히 멈춰 서고(연출이 살아 있다), 두 칸에서는 절대 안 선다
      expect(d1.holdRatio, `이격1 정지 사격 ${msg}`).toBeGreaterThan(0.15);
      expect(d2.holdRatio, `이격2 정지 사격 ${msg}`).toBe(0);
    }
  });

  /**
   * 뒤열(궁수 3.2 / 저주사 3.6)은 그 새 안전선도 넘는다 — 그래서 최소 구성에
   * 궁수가 함께 들어간다(stage01.allowedEnemies 주석). 이 명제가 깨지면
   * '습격이 오면 대응한다'가 '한 번 잘 두면 끝'으로 퇴화한다.
   */
  it('뒤열(궁수)은 이격 3칸으로도 풀리지 않는다', () => {
    const r2 = runArena({ towers: ['spear'], pack: ARCHERS, dist: 2, gold: GOLD });
    const r3 = runArena({ towers: ['spear'], pack: ARCHERS, dist: 3, gold: GOLD });
    expect(r2.towerDamage, '이격2').toBeGreaterThan(0);
    expect(r3.towerDamage, '이격3').toBeGreaterThan(0);
    // 궁수 사거리(3.2)가 실제로 세 칸을 넘는다
    expect(ENEMY_DEFS.archer.towerAttack!.range).toBeGreaterThan(3);
  });

  /**
   * 완전 회피의 대가 — spear(사거리 2.6)가 습격대 전원의 사거리 밖(4칸)으로 물러나면
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
   * 한 가지 정답 금지 — 이격 2에서 습격대를 처리할 수 있는 타워가 여럿이어야 한다.
   * (개편 후 이격 2는 전위도 닿는 자리다 — 그래서 '멀리 두기'가 아니라 '먼저 잡기'를 잰다)
   */
  it('이격 2에서 습격대를 정리하는 타워가 여럿이다', () => {
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
    // 같은 예산·같은 노출 배치에서 단일 대상 타워는 무리를 다 태우지 못해 **훨씬 많이 맞는다**.
    // (개편 전에는 이 자리에서 실제로 부서졌다 — 정지가 유한해진 지금은 '부서짐'이 아니라
    //  '더 두들겨 맞음'으로 나타난다. 재는 축을 파괴 수에서 피해량으로 옮긴 이유다)
    const spear = runArena({ towers: ['spear'], pack: BLADES, dist: 1, gold: GOLD });
    expect(spear.towerDamage, '이격1 창던지기 피해').toBeGreaterThan(exposed.towerDamage * 2);

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
