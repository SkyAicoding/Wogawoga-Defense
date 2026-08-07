/**
 * 아군 부족원 렌더 회귀 테스트 — **메시 예산과 구조**를 잠근다.
 *
 * ── 5단계 개정: "드로우콜 0 증가"에서 "삼각형이 먼저다"로 ────────────────────
 * 1~3단계는 아군을 습격대 InstancedMesh에 얹어 그렸다. 근거는 "실측 최악 프레임이
 * 정확히 60/60이라 여유가 0"이었는데 **그 전제가 실측으로 틀렸다**: 최악 프레임은
 * 60콜이 아니라 73~80콜이고, 그 천장을 만드는 것은 아군이 아니라 **타워 수**다
 * (타워 1기당 약 3콜, 상한 없음 — views/enemyview.ts 헤더에 실측 표).
 *
 * 진짜로 깨져 있던 것은 삼각형이었다. 변형 마스킹은 자기 것이 아닌 장비 정점을 원점으로
 * 접을 뿐이라 **인스턴스 하나가 장비 7벌 전부의 정점 비용을 매 프레임 낸다.**
 * 스테이지1 웨이브 49는 습격대만 56마리가 동시에 사는 편성이라 그 낭비가 프레임을
 * 지배했다 — 최악 프레임 170,341 삼각형(예산 150,000의 114%).
 *
 * 그래서 5단계에서 구조를 둘 바꿨다:
 *  1) **인스턴스 유닛은 그림자를 드리우지 않는다**(컬러+그림자 두 패스 → 한 패스).
 *  2) **아군 장비 3벌을 별도 지오메트리로 갈랐다**(인스턴스당 1,662 → 1,146).
 * 대가는 드로우콜 +1(아군과 습격대가 동시에 화면에 있을 때만)이고, 그 값으로
 * 삼각형 3만을 샀다. 아래 테스트는 그 새 구조를 잠근다:
 *  · 3D 모델: 아군은 **자기 InstancedMesh 하나**에 모인다(종마다 만들면 3개가 된다)
 *  · 몸통·보행 리그는 여전히 습격대와 같은 코드에서 나온다
 *  · 체력바: 적/타워 체력바와 **같은 오버레이 메시**(barKind 1 = 내 편 팔레트)
 *
 * ── 실측 (최악 프레임, swiftshader 900×1000) ────────────────────────────────
 * 만렙 T5 타워 12기 + 적 56 + 마을 Lv5 + 전부 반피(오버레이 ON) 정지 프레임:
 *   아군 0명 → 51콜 / 약 13.6만 삼각형   아군 6명 → 52콜 / 약 14.6만
 * 삼각형 예산 150,000 안이다. 자세한 표와 절차는 tests/e2e/smoke.spec.ts 의
 * '최악 프레임' 테스트에 있다.
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
  allyRig,
  allyVariant,
  buildAlly,
  enemyGeoKey,
  enemyRig,
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
    siegeHoldLeft: 0,
    attackAnimLeft: 0,
    attackAnimTicks: 0,
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

describe('아군 유닛 렌더 — 메시 하나로 모인다', () => {
  it('아군은 습격대와 다른 지오메트리를 쓰되 몸통(리그)은 같다', () => {
    expect(allyGeoKey()).not.toBe(RAIDER_GEO_KEY);
    expect(allyGeoKey()).not.toBe(enemyGeoKey('blade'));
    // 갈린 것은 구워지는 단위뿐 — 사지 구성/보폭은 같은 raiderBody 코드에서 나온다
    expect(allyRig().limbs.length).toBe(enemyRig('blade').limbs.length);
    expect(allyRig().gaitPerDist).toBeCloseTo(enemyRig('blade').gaitPerDist, 6);
  });

  it('아군 3종의 변형 번호가 서로 다르고 아군 지오메트리에 실제로 구워져 있다', () => {
    const variants = ALL_ALLY_IDS.map(allyVariant);
    expect(new Set(variants).size).toBe(ALL_ALLY_IDS.length); // 겹치면 두 종이 같은 장비를 낀다
    const attr = buildAlly().getAttribute(VARIANT_ATTR);
    expect(attr).toBeTruthy();
    const baked = new Set<number>();
    for (let i = 0; i < attr!.count; i++) baked.add(Math.round(attr!.getX(i)));
    for (const v of variants) expect(baked.has(v), `variant ${v}`).toBe(true);
  });

  it('아군 3종이 InstancedMesh 하나에만 모인다 (종마다 만들면 3개가 된다)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const before = meshesOf(scene).length;
    const beforeKeys = viewMeshes(view).size;

    view.update([], 1, cellToWorld, 0.016, [
      ally({ id: 101, defId: 'clubber' }),
      ally({ id: 102, defId: 'slinger', x: 7 }),
      ally({ id: 103, defId: 'guardian', x: 6 }),
    ]);

    // 메시는 생성 시점에 이미 다 만들어져 있고, 그릴 때 늘어나지 않는다
    expect(meshesOf(scene).length).toBe(before);
    expect(viewMeshes(view).size).toBe(beforeKeys);
    // 아군 몫으로 존재하는 메시는 정확히 1개
    expect(viewMeshes(view).has(allyGeoKey())).toBe(true);
    for (const id of ALL_ALLY_IDS) expect(viewMeshes(view).has(id), id).toBe(false);
    view.dispose();
  });

  it('아군은 아군 메시에, 적은 습격대 메시에 각각 쌓인다', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const foes = viewMeshes(view).get(RAIDER_GEO_KEY)!;
    const mesh = viewMeshes(view).get(allyGeoKey())!;
    expect(mesh).toBeTruthy();
    expect(mesh).not.toBe(foes);

    view.update(
      [enemy({ id: 1, defId: 'blade' }), enemy({ id: 2, defId: 'archer', x: 5 })],
      1,
      cellToWorld,
      0.016,
      [ally({ id: 101 }), ally({ id: 102, defId: 'slinger' }), ally({ id: 103, defId: 'guardian' })],
    );
    expect(foes.count).toBe(2);
    expect(mesh.count).toBe(3);
    expect(mesh.visible).toBe(true);

    const varAttrs = (view as unknown as { varAttrs: Map<string, THREE.BufferAttribute> }).varAttrs;
    const foeSel = varAttrs.get(RAIDER_GEO_KEY)!;
    expect(foeSel.getX(0)).toBe(enemyVariant('blade'));
    expect(foeSel.getX(1)).toBe(enemyVariant('archer'));
    const vsel = varAttrs.get(allyGeoKey())!;
    expect(vsel.getX(0)).toBe(allyVariant('clubber'));
    expect(vsel.getX(1)).toBe(allyVariant('slinger'));
    expect(vsel.getX(2)).toBe(allyVariant('guardian'));
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
    const mesh = viewMeshes(view).get(allyGeoKey())!;
    view.update([], 1, cellToWorld, 0.016, [ally({ id: 101 }), ally({ id: 102, alive: false })]);
    expect(mesh.count).toBe(1);
    view.dispose();
  });

  it('아군은 적과 다른 색조로 물든다 (instanceColor — 화면에서 즉시 갈린다)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const foes = viewMeshes(view).get(RAIDER_GEO_KEY)!;
    const mesh = viewMeshes(view).get(allyGeoKey())!;
    view.update([enemy()], 1, cellToWorld, 0.016, [ally({ id: 101 })]);
    const foe = new THREE.Color();
    const own = new THREE.Color();
    foes.getColorAt(0, foe);
    mesh.getColorAt(0, own);
    expect(foe.getHex()).not.toBe(own.getHex());
    expect(own.b).toBeGreaterThan(own.r); // 한랭 쪽으로 밀려 있다
    view.dispose();
  });

  it('역주행해도 보행 위상이 앞으로 돈다 (다리가 거꾸로 돌지 않는다)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const gaits = (view as unknown as { gaitAttrs: Map<string, THREE.BufferAttribute> }).gaitAttrs;
    const read = (): number => gaits.get(allyGeoKey())!.getX(0);

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
    const mesh = viewMeshes(view).get(allyGeoKey())!;
    const all: AllyState[] = ALL_ALLY_IDS.map((defId: AllyId, i) =>
      ally({ id: 200 + i, defId, x: 8 - i }),
    );
    view.update([], 1, cellToWorld, 0.016, all);
    expect(meshesOf(scene).length).toBe(viewMeshes(view).size);
    expect(mesh.count).toBe(all.length);
    view.dispose();
  });
});
