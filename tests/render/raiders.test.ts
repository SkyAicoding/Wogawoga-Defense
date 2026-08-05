/**
 * 한 지오메트리에 올라탄 **부족 7종**(적 습격대 4 + 아군 마을 부족원 3)의
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
    // 0 = 공용 몸통 / 1~4 = 적 습격대 / 5~7 = 아군 마을 부족원
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it('아군 3종도 같은 지오메트리에 올라타고 변형 번호가 적과 겹치지 않는다', () => {
    const geo = buildEnemy('blade');
    expect(allyGeoKey()).toBe(RAIDER_GEO_KEY);
    expect(allyRig()).toBe(enemyRig('blade'));
    const allyVars = ALL_ALLY_IDS.map(allyVariant);
    expect(new Set(allyVars)).toEqual(new Set([5, 6, 7])); // 서로 다르다
    const enemyVars = new Set(RAIDERS.map(enemyVariant));
    for (const v of allyVars) expect(enemyVars.has(v), `변형 ${v} 가 적과 겹친다`).toBe(false);
    // 아군 단품은 갤러리 전용이라 공유본과 **다른** 객체여야 한다(장비가 7벌 다 붙지 않게)
    for (const id of ALL_ALLY_IDS) expect(buildAllySolo(id), id).not.toBe(geo);
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

  it('삼각형 예산: 단품 400~700, 공유본은 7종 합의 절반 미만', () => {
    let soloSum = 0;
    for (const id of RAIDERS) {
      const n = tris(buildEnemySolo(id));
      expect(n, `${id} 단품 삼각형`).toBeGreaterThanOrEqual(400);
      expect(n, `${id} 단품 삼각형`).toBeLessThanOrEqual(700);
      soloSum += n;
    }
    for (const id of ALL_ALLY_IDS) {
      const n = tris(buildAllySolo(id));
      expect(n, `${id} 단품 삼각형`).toBeGreaterThanOrEqual(400);
      expect(n, `${id} 단품 삼각형`).toBeLessThanOrEqual(700);
      soloSum += n;
    }
    const shared = tris(buildEnemy('blade'));
    // 공유본은 몸통 1벌 + 장비 7벌이라 단품 7개 합(몸통 7벌)의 절반도 안 돼야 한다.
    // 이 여유가 곧 "인스턴스마다 축퇴 삼각형을 조금 더 그리는" 비용의 상한이다.
    expect(shared).toBeLessThan(soloSum * 0.5);
    expect(shared, '공유 지오메트리 삼각형').toBeLessThan(1650);
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
