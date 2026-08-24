/**
 * 두 지오메트리에 나눠 탄 **부족 8종**(적 습격대 4 + 아군 마을 부족원 4)의
 * 드로우콜 묶음과 삼각형 예산 회귀 테스트.
 *
 * 종마다 InstancedMesh 를 두면 컬러+그림자로 드로우콜이 종당 +2 씩 붙어
 * 프레임 예산을 넘긴다. 그래서 지오메트리를 공유하고 장비만 정점 태그로
 * 골라 그린다 — 그 계약이 깨지면(예: 누가 아군 전용 메시를 만들면) 여기서 걸린다.
 *
 * 3단계에서 아군이 전용 장비(변형 5~7)를 받으면서 공유본 삼각형이 930 → 1512 로 늘었다.
 * 늘어난 582 삼각형은 **모든 인스턴스가 매 프레임 정점 셰이더에 태우는 비용**이라
 * (자기 변형이 아닌 정점은 원점으로 접혀 축퇴 삼각형이 된다 — 래스터라이즈는 0)
 * 상한을 여기서 잠근다. 실측 최악 프레임(적 습격대 4 + 아군 6 = 10 인스턴스)에서
 * 이 증가분은 약 5.8k 삼각형이고 예산 150,000 안이다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EnemyId, EnemyState } from '@/data/types';
import { ENEMY_DEFS } from '@/data/enemies';
import { EnemyView } from '@/render/views/enemyview';
import {
  ALL_ENEMY_IDS,
  RAIDER_GEO_KEY,
  allyGeoKey,
  allyRig,
  allyVariant,
  buildAlly,
  buildAllySolo,
  buildEnemy,
  buildEnemySolo,
  enemyGeoKey,
  enemyRig,
  enemyVariant,
} from '@/render/meshlib/enemies';
import { ALL_ALLY_IDS } from '@/data/allies';
import { VARIANT_ATTR, VARIANT_SEL_ATTR } from '@/render/meshlib/gait';

const RAIDERS: EnemyId[] = ['blade', 'lancer', 'archer', 'hexer'];

/** 비인덱스 지오메트리라 삼각형 = 정점/3 */
function tris(geo: THREE.BufferGeometry): number {
  return geo.getAttribute('position').count / 3;
}

const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

function enemy(id: EnemyId, o: Partial<EnemyState> = {}): EnemyState {
  return {
    id: 1,
    defId: id,
    hp: 10,
    maxHp: 10,
    shieldHitsLeft: 0,
    dist: 2,
    pathIndex: 0,
    attackCdLeft: 0,
    towerTargetId: -1,
    siegeHoldLeft: 0,
    attackAnimLeft: 0,
    attackAnimTicks: 0,
    blockerAllyId: -1,
    flying: false,
    x: 2,
    z: 2,
    prevX: 2,
    prevZ: 2,
    heading: 0,
    statuses: [],
    bounty: 1,
    baseDamage: 1,
    radius: ENEMY_DEFS[id].radius,
    alive: true,
    hpMul: 1,
    ...o,
  };
}

describe('부족 습격대 렌더', () => {
  it('4종이 지오메트리와 리그를 공유한다 (드로우콜 1묶음)', () => {
    const geo = buildEnemy('blade');
    const rig = enemyRig('blade');
    for (const id of RAIDERS) {
      expect(enemyGeoKey(id), id).toBe(RAIDER_GEO_KEY);
      expect(buildEnemy(id), id).toBe(geo); // 같은 객체여야 뷰가 한 메시로 묶는다
      expect(enemyRig(id), id).toBe(rig);
    }
    // 변형 번호는 1..4 로 서로 달라야 한다 (겹치면 두 종이 같은 장비를 낀다)
    expect(new Set(RAIDERS.map(enemyVariant))).toEqual(new Set([1, 2, 3, 4]));
    // 나머지 종은 공유 대상이 아니다
    for (const id of ALL_ENEMY_IDS) {
      if (!RAIDERS.includes(id)) expect(enemyVariant(id), id).toBe(0);
    }
  });

  it('공유 지오메트리에 변형 태그가 구워져 있고 4종 장비가 모두 들어 있다', () => {
    const attr = buildEnemy('blade').getAttribute(VARIANT_ATTR);
    expect(attr).toBeTruthy();
    const seen = new Set<number>();
    for (let i = 0; i < attr!.count; i++) seen.add(Math.round(attr!.getX(i)));
    // 0 = 공용 몸통 / 1~4 = 적 습격대. **아군(5~7)은 5단계에서 별도 지오메트리로 갈렸다**
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  /**
   * 5단계에서 아군을 **별도 지오메트리**로 갈랐다. 변형 마스킹은 자기 것이 아닌 정점을
   * 원점으로 접을 뿐이라 한 인스턴스가 장비 7벌의 정점 비용을 매 프레임 냈고,
   * 습격대 56마리가 동시에 사는 편성에서 그게 프레임을 지배했다(최악 170,341 삼각형).
   * 여기서 잠그는 것은 "**갈렸지만 몸통은 여전히 같다**"이다.
   *
   * 11단계) 채집꾼이 붙어 **4벌**이 됐다. 번호가 1~4인 것은 kit 배열 순서(ALLY_KITS)
   * 이지 ALL_ALLY_IDS 순서가 아니다 — 채집꾼은 값이 싸서 목록에서는 맨 앞이지만
   * 변형은 **맨 뒤인 4**다(공격 포즈 표와 짝이 밀리지 않게).
   */
  it('아군 4종은 별도 지오메트리를 쓰되 몸통(보행 리그)은 습격대와 같다', () => {
    const geo = buildEnemy('blade');
    expect(allyGeoKey()).not.toBe(RAIDER_GEO_KEY);
    expect(buildAlly()).not.toBe(geo);
    // 리그는 객체가 다르되 사지 구성은 완전히 같아야 한다 (같은 raiderBody 코드)
    const ar = allyRig();
    const er = enemyRig('blade');
    expect(ar.limbs.length).toBe(er.limbs.length);
    expect(ar.gaitPerDist).toBeCloseTo(er.gaitPerDist, 6);
    const allyVars = ALL_ALLY_IDS.map(allyVariant);
    expect(new Set(allyVars)).toEqual(new Set([1, 2, 3, 4])); // 서로 다르다
    // 아군 공유본에 아군 장비 4벌이 전부 구워져 있다 (0 = 몸통 + 공통 제복)
    const attr = buildAlly().getAttribute(VARIANT_ATTR);
    const seen = new Set<number>();
    for (let i = 0; i < attr!.count; i++) seen.add(Math.round(attr!.getX(i)));
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4]));
    // 아군 단품은 갤러리 전용이라 공유본과 **다른** 객체여야 한다(장비가 4벌 다 붙지 않게)
    for (const id of ALL_ALLY_IDS) expect(buildAllySolo(id), id).not.toBe(buildAlly());
  });

  it('EnemyView 가 4종을 메시 하나로 묶는다', () => {
    const view = new EnemyView(new THREE.Scene());
    const meshes = (view as unknown as { meshes: Map<string, THREE.InstancedMesh> }).meshes;
    // 습격대 몫으로 늘어난 메시는 정확히 1개다 (종마다 만들면 4개가 된다)
    expect(meshes.has(RAIDER_GEO_KEY)).toBe(true);
    for (const id of RAIDERS) expect(meshes.has(id), id).toBe(false);

    // 4종을 한 프레임에 함께 그려도 인스턴스가 한 메시에 쌓인다
    const list = RAIDERS.map((id, i) => enemy(id, { id: 10 + i, x: 2 + i }));
    view.update(list, 1, cellToWorld, 0.0333);
    const mesh = meshes.get(RAIDER_GEO_KEY)!;
    expect(mesh.count).toBe(4);
    expect(mesh.visible).toBe(true);
    // 인스턴스마다 자기 변형 번호가 실려야 장비가 갈린다
    const sel = (view as unknown as { varAttrs: Map<string, THREE.BufferAttribute> }).varAttrs.get(
      RAIDER_GEO_KEY,
    )!;
    expect(RAIDERS.map((_, i) => sel.getX(i))).toEqual(RAIDERS.map(enemyVariant));
    expect(mesh.geometry.getAttribute(VARIANT_SEL_ATTR)).toBe(sel);
    view.dispose();
  });

  it('삼각형 예산: 단품 400~700, 공유본은 그 종들 합의 절반 미만', () => {
    /**
     * 공유본이 단품 합의 몇 배 이내여야 하는가 — **변형 수가 많을수록 이득이 커진다**
     * (몸통 1벌만 굽고 장비만 더하므로). 그래서 상한도 종 수에 따라 다르다.
     * 실측(11단계): 습격대 4벌 1,146 / 단품 합 2,368 = 0.48 ·
     *               아군 4벌 **948** / 2,388 = **0.40**.
     * 아군 비율이 3벌(0.61)보다 **내려간** 것은 채집꾼을 얹으면서 공통 제복(166삼각형)을
     * 변형 0으로 내렸기 때문이다 — 종마다 복제하던 것이 1벌이 됐다(enemies.ts allyLivery).
     */
    const budget = (
      label: string,
      ids: readonly string[],
      solo: (id: never) => THREE.BufferGeometry,
      shared: THREE.BufferGeometry,
      ratio: number,
    ): number => {
      let soloSum = 0;
      for (const id of ids) {
        const n = tris(solo(id as never));
        expect(n, `${id} 단품 삼각형`).toBeGreaterThanOrEqual(400);
        expect(n, `${id} 단품 삼각형`).toBeLessThanOrEqual(700);
        soloSum += n;
      }
      const n = tris(shared);
      // 공유본은 몸통 1벌 + 장비 n벌이라 단품 합(몸통 n벌)보다 확실히 작아야 한다.
      // 이 여유가 곧 "인스턴스마다 축퇴 삼각형을 조금 더 그리는" 비용의 상한이다.
      expect(n, `${label} 공유본 / 단품 합`).toBeLessThan(soloSum * ratio);
      return n;
    };
    const raider = budget('습격대', RAIDERS, buildEnemySolo, buildEnemy('blade'), 0.55);
    const ally = budget('아군', ALL_ALLY_IDS, buildAllySolo, buildAlly(), 0.7);
    // 실측(11단계) — 단품 clubber 578 / slinger 610 / guardian 588 / gatherer 612,
    // 공유본 948. 아래 주석의 "제복을 변형 0으로 내렸다"가 되돌려지면 1,246으로 튄다.
    expect(ally, '아군 공유본이 제복 복제 시절(1,080+)로 되돌아갔다').toBeLessThan(1000);

    /**
     * 절대 상한 1700 → **1250** (5단계). 값이 내려간 것은 장비를 줄여서가 아니라
     * **아군 3벌을 별도 지오메트리로 갈랐기** 때문이다(1,662 → 습격대 1,146 / 아군 1,146).
     *
     * 왜 갈랐나: 변형 마스킹은 자기 것이 아닌 장비 정점을 원점으로 접을 뿐이라
     * **인스턴스 하나가 장비 7벌 전부의 정점 비용을 매 프레임 낸다.** 스테이지1
     * 웨이브 49는 습격대만 56마리가 동시에 사는 편성이라 그 낭비가 프레임을 지배했다.
     * 실측(swiftshader 900×1000, 적 56 + 아군 6 + 만렙 T5 타워 12 + 마을 Lv5 정지 프레임):
     *   7벌 한 몸 → 170,341 삼각형 (예산 150,000의 114%)
     *   4벌/3벌   → 약 14만, 드로우콜 +1 (아군과 습격대가 동시에 있을 때만)
     *
     * 상한을 유지하는 이유는 그대로다: "장비를 계속 얹다 보면 공유본이 소리 없이 부푼다"를
     * 막는 것. 1250은 지금 값(습격대 1,146)에 파트 여덟 개 남짓의 여유만 준다 — 또 넘긴다면
     * 그때도 최악 프레임을 실제로 만들어 재고 그 근거를 여기 남겨라.
     *
     * ⚠ 11단계) 아군에 채집꾼(넷째)이 붙었는데 공유본은 오히려 **1,080 → 948**로 줄었다.
     * 장비를 깎아서가 아니라 **공통 제복을 변형 0으로 내려** 3벌 복제를 1벌로 만든
     * 덕이다(−332). 부족기만 전투 3종의 kit 으로 내려가 3벌 남았고(+102), 채집꾼 장비가
     * +132다. 단품 셋(578/610/588)은 한 삼각형도 안 움직였다 — 화면은 그대로다.
     */
    expect(raider, '습격대 공유 지오메트리 삼각형').toBeLessThan(1250);
    expect(ally, '아군 공유 지오메트리 삼각형').toBeLessThan(1250);
  });

  it('작고 귀엽다: 키가 부족 전사의 3/4 미만이고 머리가 크다', () => {
    const geo = buildEnemySolo('blade');
    geo.computeBoundingBox();
    const h = geo.boundingBox!.max.y;
    const warrior = buildEnemy('warrior');
    warrior.computeBoundingBox();
    expect(h).toBeLessThan(warrior.boundingBox!.max.y * 0.75);
    // 발바닥은 정확히 y=0 (전 종 공통 규약)
    expect(geo.boundingBox!.min.y).toBeCloseTo(0, 2);
  });
});
