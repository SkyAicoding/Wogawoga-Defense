/**
 * 아군 부족원 렌더 회귀 테스트 — **드로우콜 0 증가**가 이 파일의 전부다.
 *
 * 실측 최악 프레임이 정확히 60/60이라 여유가 0이다. 아군 전용 InstancedMesh를 만들면
 * 컬러+그림자로 +2콜이 되어 그 자리에서 예산이 깨진다. 그래서 아군은
 *  · 3D 모델: 적 습격대와 **같은 공유 지오메트리 · 같은 InstancedMesh** (변형 태그로 장비 선택)
 *  · 체력바: 적/타워 체력바와 **같은 오버레이 메시** (barKind 1 = 내 편 팔레트)
 * 를 쓴다. 아래 테스트가 그 구조를 잠근다 — 3단계가 전용 모델을 넣을 때 새 메시를
 * 만들면 여기서 깨진다.
 *
 * ── 실측 (합성 최대 메시 프레임, swiftshader, 900×1000) ──────────────────────
 * 만렙 T5 타워 12기 + 모든 종을 동시에 띄우고 전부 반피로 깎은(오버레이 ON) 정지 프레임에서
 * 아군 6명을 넣고 뺀 A/B. 세션을 따로 띄워 각각 첫 측정만 취했다.
 *   A) 습격대 4종 **포함**(16종 21마리): 아군 0명 79콜 → 6명 79콜   Δ = 0
 *   B) 습격대 **없음**(12종 17마리)   : 아군 0명 77콜 → 6명 79콜   Δ = +2
 * B의 +2는 아군이 꺼져 있던 습격대 메시를 켜는 값(컬러+그림자)인데, **켠 결과가 정확히
 * A와 같은 79콜**이다. 즉 아군은 천장을 올리지 못한다 — 아군 없이도 도달 가능한
 * "습격대가 화면에 있는 프레임"으로 수렴할 뿐이다. 이게 예산이 지켜지는 근거다.
 * 삼각형은 79콜 프레임에서 103,073 → 114,233 (6명 = +11,160, 1인당 약 1,860).
 * 실플레이 교전 프레임은 16콜 / 41,849 삼각형이었다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AllyId, AllyState, EnemyState, TowerState } from '@/data/types';
import { ALL_ALLY_IDS } from '@/data';
import { EnemyView } from '@/render/views/enemyview';
import { HealthBarView } from '@/render/views/healthbars';
import {
  RAIDER_GEO_KEY,
  allyGeoKey,
  allyVariant,
  buildEnemy,
  enemyGeoKey,
  enemyVariant,
} from '@/render/meshlib/enemies';
import { VARIANT_ATTR } from '@/render/meshlib/gait';

const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

function ally(o: Partial<AllyState> = {}): AllyState {
  return {
    id: 101,
    defId: 'clubber',
    hp: 100,
    maxHp: 100,
    dist: 8,
    pathIndex: 0,
    slot: 0,
    holdDist: 3,
    x: 8,
    z: 2,
    prevX: 8,
    prevZ: 2,
    heading: Math.PI,
    lifeLeft: 600,
    attackCdLeft: 0,
    targetId: -1,
    alive: true,
    ...o,
  };
}

function enemy(o: Partial<EnemyState> = {}): EnemyState {
  return {
    id: 1,
    defId: 'blade',
    hp: 10,
    maxHp: 10,
    shieldHitsLeft: 0,
    dist: 4,
    pathIndex: 0,
    attackCdLeft: 0,
    towerTargetId: -1,
    blockerAllyId: -1,
    flying: false,
    x: 4,
    z: 2,
    prevX: 4,
    prevZ: 2,
    heading: 0,
    statuses: [],
    bounty: 1,
    baseDamage: 1,
    radius: 0.26,
    alive: true,
    hpMul: 1,
    ...o,
  };
}

function tower(o: Partial<TowerState> = {}): TowerState {
  return {
    id: 1,
    defId: 'spear',
    tier: 0,
    hp: 260,
    maxHp: 260,
    silenceLeft: 0,
    cellX: 3,
    cellZ: 1,
    cooldownLeft: 0,
    targetId: -1,
    targeting: 'first',
    invested: 100,
    buffDmgPct: 0,
    buffRatePct: 0,
    ...o,
  };
}

function meshesOf(scene: THREE.Scene): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}

function viewMeshes(view: EnemyView): Map<string, THREE.InstancedMesh> {
  return (view as unknown as { meshes: Map<string, THREE.InstancedMesh> }).meshes;
}

describe('아군 유닛 렌더 — 드로우콜 0 증가', () => {
  it('아군은 적 습격대와 같은 지오메트리 키를 쓴다', () => {
    expect(allyGeoKey()).toBe(RAIDER_GEO_KEY);
    expect(allyGeoKey()).toBe(enemyGeoKey('blade'));
  });

  it('아군 3종의 변형 번호가 서로 다르고 공유 지오메트리에 실제로 구워져 있다', () => {
    const variants = ALL_ALLY_IDS.map(allyVariant);
    expect(new Set(variants).size).toBe(ALL_ALLY_IDS.length); // 겹치면 두 종이 같은 장비를 낀다
    const attr = buildEnemy('blade').getAttribute(VARIANT_ATTR);
    expect(attr).toBeTruthy();
    const baked = new Set<number>();
    for (let i = 0; i < attr!.count; i++) baked.add(Math.round(attr!.getX(i)));
    // 지금은 습격대 장비(1~4)를 빌려 쓴다 — 3단계가 전용 변형을 추가하면 이 집합만 커진다
    for (const v of variants) expect(baked.has(v), `variant ${v}`).toBe(true);
  });

  it('아군을 그려도 InstancedMesh가 하나도 늘지 않는다', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const before = meshesOf(scene).length;
    const beforeKeys = viewMeshes(view).size;

    view.update([], 1, cellToWorld, 0.016, [
      ally({ id: 101, defId: 'clubber' }),
      ally({ id: 102, defId: 'slinger', x: 7 }),
      ally({ id: 103, defId: 'guardian', x: 6 }),
    ]);

    expect(meshesOf(scene).length).toBe(before);
    expect(viewMeshes(view).size).toBe(beforeKeys);
    view.dispose();
  });

  it('아군 인스턴스가 습격대 메시에 들어간다 (적과 같은 메시, 뒤에 이어 붙는다)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const mesh = viewMeshes(view).get(RAIDER_GEO_KEY)!;
    expect(mesh).toBeTruthy();

    // 적 2 + 아군 3 = 인스턴스 5, 메시는 여전히 하나
    view.update(
      [enemy({ id: 1, defId: 'blade' }), enemy({ id: 2, defId: 'archer', x: 5 })],
      1,
      cellToWorld,
      0.016,
      [ally({ id: 101 }), ally({ id: 102, defId: 'slinger' }), ally({ id: 103, defId: 'guardian' })],
    );
    expect(mesh.count).toBe(5);
    expect(mesh.visible).toBe(true);

    // 아군 인스턴스는 적 뒤에 온다 — 변형 어트리뷰트로 확인
    const vsel = (view as unknown as { varAttrs: Map<string, THREE.BufferAttribute> }).varAttrs.get(
      RAIDER_GEO_KEY,
    )!;
    expect(vsel.getX(0)).toBe(enemyVariant('blade'));
    expect(vsel.getX(1)).toBe(enemyVariant('archer'));
    expect(vsel.getX(2)).toBe(allyVariant('clubber'));
    expect(vsel.getX(3)).toBe(allyVariant('slinger'));
    expect(vsel.getX(4)).toBe(allyVariant('guardian'));
    view.dispose();
  });

  it('아군이 없으면 인스턴스도 늘지 않는다 (평소 드로우콜 그대로)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const mesh = viewMeshes(view).get(RAIDER_GEO_KEY)!;
    view.update([enemy()], 1, cellToWorld, 0.016);
    expect(mesh.count).toBe(1);
    view.update([], 1, cellToWorld, 0.016);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false); // count 0이면 렌더 리스트에서 통째로 빠진다
    view.dispose();
  });

  it('죽은 아군은 그리지 않는다', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const mesh = viewMeshes(view).get(RAIDER_GEO_KEY)!;
    view.update([], 1, cellToWorld, 0.016, [ally({ id: 101 }), ally({ id: 102, alive: false })]);
    expect(mesh.count).toBe(1);
    view.dispose();
  });

  it('아군은 적과 다른 색조로 물든다 (instanceColor — 화면에서 즉시 갈린다)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const mesh = viewMeshes(view).get(RAIDER_GEO_KEY)!;
    view.update([enemy()], 1, cellToWorld, 0.016, [ally({ id: 101 })]);
    const foe = new THREE.Color();
    const own = new THREE.Color();
    mesh.getColorAt(0, foe);
    mesh.getColorAt(1, own);
    expect(foe.getHex()).not.toBe(own.getHex());
    expect(own.b).toBeGreaterThan(own.r); // 한랭 쪽으로 밀려 있다
    view.dispose();
  });

  it('역주행해도 보행 위상이 앞으로 돈다 (다리가 거꾸로 돌지 않는다)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const gaits = (view as unknown as { gaitAttrs: Map<string, THREE.BufferAttribute> }).gaitAttrs;
    const read = (): number => gaits.get(RAIDER_GEO_KEY)!.getX(0);

    // dist가 줄어드는 것이 곧 전진이다 (기지 → 적 방향)
    view.update([], 1, cellToWorld, 0.016, [ally({ id: 101, dist: 8, x: 8, prevX: 8 })]);
    const g0 = read();
    view.update([], 1, cellToWorld, 0.016, [ally({ id: 101, dist: 7.7, x: 7.7, prevX: 8 })]);
    const g1 = read();
    // wrapGait로 감기므로 큰 차이가 아니라 '증가'만 본다 (0.3타일 이동은 한 주기 미만)
    expect(g1).toBeGreaterThan(g0);
    view.dispose();
  });
});

describe('아군 체력바 — 오버레이 메시 공유', () => {
  it('아군 바가 적/타워와 같은 메시 하나에 실린다', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    expect(meshesOf(scene)).toHaveLength(1);
    const mesh = meshesOf(scene)[0]!;

    view.update([enemy({ hp: 5 })], [tower({ hp: 130 })], 1, cellToWorld, [], [ally({ hp: 60 })]);
    expect(meshesOf(scene)).toHaveLength(1); // 메시는 여전히 하나
    expect(mesh.count).toBe(3); // 적 1 + 타워 1 + 아군 1
    view.dispose();
  });

  it('아군 바는 내 편 팔레트(kind 1)를 쓴다 — 적 바와 의미가 반대이기 때문', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    view.update([enemy({ hp: 5 })], [], 1, cellToWorld, [], [ally({ hp: 60 })]);
    const kinds = mesh.geometry.getAttribute('barKind');
    expect(kinds.getX(0)).toBe(0); // 적
    expect(kinds.getX(1)).toBe(1); // 아군 = 타워와 같은 '내 편' 팔레트
    view.dispose();
  });

  /**
   * 만피 숨김 — 아군도 예외가 아니다. 상한(6명)을 채운 줄이 전부 바를 띄우면
   * 청록 슬래브가 길을 덮어 정작 교전이 안 보인다(실측 캡처로 확인).
   * 인원은 HUD '출동 n/6'이, 위치는 파랗게 물든 유닛이 이미 말해 준다.
   */
  it('만피 아군의 바는 숨는다 (적/타워와 같은 규칙)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    view.update([], [], 1, cellToWorld, [], [ally(), ally({ id: 102 })]);
    expect(mesh.count).toBe(0);
    view.update([], [], 1, cellToWorld, [], [ally({ hp: 99 }), ally({ id: 102 })]);
    expect(mesh.count).toBe(1);
    const fills = mesh.geometry.getAttribute('fill');
    expect(fills.getX(0)).toBeCloseTo(0.99, 5);
    view.dispose();
  });

  it('죽은 아군 바는 사라진다', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    view.update([], [], 1, cellToWorld, [], [ally({ hp: 40, alive: false })]);
    expect(mesh.count).toBe(0);
    view.dispose();
  });
});

/** 아군 종이 늘어나도 위 구조가 유지되는지 — 3단계가 종을 추가할 때의 안전망 */
describe('확장 안전망', () => {
  it('모든 아군 종이 공유 메시 하나에 들어간다', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const mesh = viewMeshes(view).get(RAIDER_GEO_KEY)!;
    const all: AllyState[] = ALL_ALLY_IDS.map((defId: AllyId, i) =>
      ally({ id: 200 + i, defId, x: 8 - i }),
    );
    view.update([], 1, cellToWorld, 0.016, all);
    expect(meshesOf(scene).length).toBe(viewMeshes(view).size);
    expect(mesh.count).toBe(all.length);
    view.dispose();
  });
});
