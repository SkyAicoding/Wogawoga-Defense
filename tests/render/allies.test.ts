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
  allyAttackAnim,
  allyGeoKey,
  allyRig,
  allyVariant,
  buildAlly,
  enemyGeoKey,
  enemyRig,
  enemyVariant,
} from '@/render/meshlib/enemies';
import {
  ATK_RELEASE,
  ATK_ROLE_MAIN,
  LIMB_ATTR,
  VARIANT_ATTR,
  attackEnvelope,
  type EnemyRig,
} from '@/render/meshlib/gait';

const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

const TAU = Math.PI * 2;

/**
 * 두 보행 위상 사이에 **앞으로 돈 각도** (0 이상 2π 미만).
 * 위상은 wrapGait로 [0,2π)에 접혀 있어 단순 뺄셈이 주기 경계에서 음수로 튄다 —
 * 그대로 크기 비교를 하면 "거꾸로 돌았다"와 "한 바퀴 감겼다"를 구분하지 못한다.
 * 한 걸음이 반 주기(π) 미만인 동안은 이 값이 곧 전진량이고, π를 넘으면 후진이다.
 */
const advance = (from: number, to: number): number => (((to - from) % TAU) + TAU) % TAU;

/**
 * 위상 테스트가 쓰는 한 걸음 (타일).
 *
 * 실측: allyRig().gaitPerDist = 17.989 rad/타일, 즉 보행 **한 주기가 0.349타일**이다
 * (보폭이 짧다 — 로우폴리 부족원은 종종걸음으로 걷는다). 그래서 반 주기가 0.175타일뿐이라
 * 한 걸음을 그보다 크게 잡으면 "앞으로 0.2타일"과 "뒤로 0.15타일"이 접힌 위상에서
 * 구분되지 않아 잠금이 무의미해진다. 0.05타일은 그 절반 아래이면서(0.899 rad)
 * 실제 한 틱치 이동과도 맞다 — 곤봉잡이 1.15타일/초 ÷ 30틱 = 0.038타일/틱.
 */
const STEP = 0.05;

/**
 * 9단계) 경로 4필드(dist·pathIndex·slot·holdDist)와 수명(lifeLeft)이 AllyState에서
 * 통째로 사라지고 목표 좌표(tgtX/tgtZ)와 걸은 거리(walked)가 들어왔다.
 * 기본값은 "홈타운 앞 집결 지점에 막 태어나 아직 한 걸음도 안 뗀 부족원"이다 —
 * walked 0, 목표 = 지금 자리. 걷는 장면은 그것을 재는 테스트가 직접 흔든다.
 *
 * 11단계) 채집 4필드가 붙었다. 기본값은 **채집과 무관한 사람**이다 —
 * gatherKey −1(명령 없음, targetId 와 같은 센티널) · 진행분 0 · 빈손.
 * 이 파일이 재는 것은 메시와 공격 모션이라 여기서 그 값을 흔들 일은 없지만,
 * 필드가 필수라 기본값이 있어야 한다(data/types.ts AllyState).
 */
function ally(o: Partial<AllyState> = {}): AllyState {
  return {
    id: 101,
    defId: 'clubber',
    hp: 100,
    maxHp: 100,
    x: 8,
    z: 2,
    prevX: 8,
    prevZ: 2,
    tgtX: 8,
    tgtZ: 2,
    walked: 0,
    heading: Math.PI,
    attackCdLeft: 0,
    targetId: -1,
    gatherKey: -1,
    gatherTicks: 0,
    carryGold: 0,
    carryCount: 0,
    // 규칙 8) 자동 행동 — false = 자동 켜짐(기본). 참이면 머리 위에 대기 말뚝이 뜬다(kind 8)
    autoHold: false,
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

  it('아군 4종의 변형 번호가 서로 다르고 아군 지오메트리에 실제로 구워져 있다', () => {
    const variants = ALL_ALLY_IDS.map(allyVariant);
    expect(new Set(variants).size).toBe(ALL_ALLY_IDS.length); // 겹치면 두 종이 같은 장비를 낀다
    const attr = buildAlly().getAttribute(VARIANT_ATTR);
    expect(attr).toBeTruthy();
    const baked = new Set<number>();
    for (let i = 0; i < attr!.count; i++) baked.add(Math.round(attr!.getX(i)));
    for (const v of variants) expect(baked.has(v), `variant ${v}`).toBe(true);
  });

  it('아군 4종이 InstancedMesh 하나에만 모인다 (종마다 만들면 4개가 된다)', () => {
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

  /**
   * ── 9단계: 보행 위상의 출처가 경로 호장에서 **걸은 거리**로 옮겨졌다 ──────────
   * 8단계까지 아군은 경로를 거꾸로 걸었고(dist가 줄어든다) 뷰는 부호를 뒤집은 `-dist`를
   * 이동거리로 썼다. 그래서 이 자리의 회귀 잠금은 "dist 8 → 7.7이면 gait가 증가한다"였다.
   *
   * 자유 이동에는 그런 단조 진행량이 **아예 없다** — 아군이 앞뒤로 오가면 어떤 좌표를
   * 써도 늘었다 줄었다 하고, 위상을 좌표에서 뽑으면 되돌아오는 구간에서 다리가 거꾸로 돈다.
   * 그래서 sim이 태어나서 걸은 총 거리 AllyState.walked를 따로 누적하고
   * (src/sim/allies.ts moveAllies), 뷰는 그 값만 본다(src/render/views/enemyview.ts
   * updateAllies: `travel = a.walked − step × (1−alpha)`).
   *
   * 아래 둘이 그 계약을 나눠 잠근다:
   *  ① walked가 늘면 위상이 앞으로 돈다 (= 예전 dist 잠금이 옮겨 앉은 자리)
   *  ② **왕복해도 절대 거꾸로 돌지 않는다** — walked를 새로 도입한 이유가 정확히 이것이라,
   *     ①만으로는 좌표 기반 구현도 그대로 통과해 버린다.
   */
  it('walked가 늘면 보행 위상이 앞으로 돈다', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const gaits = (view as unknown as { gaitAttrs: Map<string, THREE.BufferAttribute> }).gaitAttrs;
    const read = (): number => gaits.get(allyGeoKey())!.getX(0);

    // alpha=1이라 보간분(step × (1−alpha))이 0이다 — 위상이 walked만의 함수가 된다
    view.update([], 1, cellToWorld, 0.016, [ally({ id: 101, x: 8, prevX: 8, walked: 0 })]);
    const g0 = read();
    view.update([], 1, cellToWorld, 0.016, [ally({ id: 101, x: 7.95, prevX: 8, walked: STEP })]);
    const g1 = read();
    // wrapGait로 [0,2π)에 접히므로 뺄셈이 아니라 '앞으로 돈 각도'로 본다
    expect(advance(g0, g1)).toBeGreaterThan(0);
    expect(advance(g0, g1)).toBeLessThan(Math.PI);
    view.dispose();
  });

  it('앞뒤로 오가도 보행 위상이 거꾸로 돌지 않는다 (walked를 도입한 이유)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const gaits = (view as unknown as { gaitAttrs: Map<string, THREE.BufferAttribute> }).gaitAttrs;
    const read = (): number => gaits.get(allyGeoKey())!.getX(0);

    // 명령을 두 번 받아 왔다 갔다 한 부족원: x가 8 → 7.95 → 8.0 → 7.95로 **제자리로 돌아온다**.
    // 좌표(또는 옛 dist)에서 위상을 뽑으면 되돌아오는 2번째 걸음(7.95 → 8.0)에서 부호가
    // 뒤집혀 다리가 거꾸로 돈다. walked는 방향과 무관하게 STEP씩 계속 쌓이므로
    // 세 걸음 모두 같은 방향으로 돌아야 한다.
    const walk: { x: number; walked: number }[] = [
      { x: 8.0, walked: 0 },
      { x: 7.95, walked: STEP },
      { x: 8.0, walked: STEP * 2 },
      { x: 7.95, walked: STEP * 3 },
    ];
    let prevX = 8;
    let prev = NaN;
    for (const [i, s] of walk.entries()) {
      view.update([], 1, cellToWorld, 0.016, [ally({ id: 101, x: s.x, prevX, walked: s.walked })]);
      const g = read();
      if (i > 0) {
        const label = `${i}번째 걸음 (x ${prevX} → ${s.x})`;
        expect(advance(prev, g), label).toBeGreaterThan(0);
        expect(advance(prev, g), label).toBeLessThan(Math.PI);
      }
      prev = g;
      prevX = s.x;
    }
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

  /**
   * 대기(HOLD) 말뚝 — **자동이 꺼진 일꾼만** 뜬다 (kind 8).
   *
   * 이 표식이 없으면 "빈 칸을 찍어 그 자리를 지키는 중"이 화면 어디에도 안 나온다:
   * 서 있는 사람과 명령 없이 서 있는 사람은 좌표가 같아 눈으로 구별할 방법이 없다.
   * 그리고 **만피여도 뜬다** — 이 파일의 대원칙("바가 보인다 = 뭔가 깎이고 있다")은
   * 손상 표시의 규칙이고, 이건 손상이 아니라 상태이기 때문이다.
   *
   * 메시가 안 느는 것까지 함께 잠근다: 드로우콜 여유가 15뿐이라 새 메시로 그렸다면
   * 이 기능 하나가 예산의 1/15를 먹는다.
   */
  it('대기(autoHold) 말뚝은 kind 8로 같은 메시에 얹힌다 — 자동이 켜져 있으면 안 뜬다', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    const kinds = mesh.geometry.getAttribute('barKind');

    // 자동이 켜진 만피 일꾼 → 아무것도 안 그린다 (체력바도 말뚝도 없다)
    view.update([], [], 1, cellToWorld, [], [ally({ defId: 'gatherer', hp: 100, autoHold: false })]);
    expect(mesh.count, '자동이 켜진 만피 부족원은 그릴 것이 없다').toBe(0);

    // 같은 사람이 "여기 지켜"를 받으면 말뚝 하나가 뜬다
    view.update([], [], 1, cellToWorld, [], [ally({ defId: 'gatherer', hp: 100, autoHold: true })]);
    expect(mesh.count, '대기 말뚝이 안 떴다').toBe(1);
    expect(kinds.getX(0), '대기 말뚝의 kind').toBe(8);
    expect(meshesOf(scene), '새 메시를 만들면 드로우콜이 는다').toHaveLength(1);

    // 죽은 사람의 말뚝은 남지 않는다
    view.update([], [], 1, cellToWorld, [], [ally({ defId: 'gatherer', hp: 0, autoHold: true, alive: false })]);
    expect(mesh.count, '시체에 말뚝이 남았다').toBe(0);
    view.dispose();
  });

  /**
   * §D-3 — **자동이 없는 종에는 대기 말뚝을 안 켠다.**
   *
   * 전투 3종(clubber·slinger·guardian)에게 `autoHold` 는 상태가 아니라 **상수**다:
   * 켜지든 꺼지든 그 사람의 행동이 한 틱도 안 달라진다(자동 행동 자체가 없다).
   * 그런 값에 표식을 붙이면 화면이 아무것도 안 말하면서 자리만 먹는다.
   *
   * ⚠ 이 테스트가 지키는 진짜 것은 §D-1 개정과의 맞물림이다. 그 개정으로 "적이 선 칸"과
   *   "남이 예약한 칸"을 찍으면 `autoHold = true` 가 되는데, 전투원은 그 두 칸으로
   *   보내지는 것이 **일상**이다. 이 거름망이 없으면 전투원 전원의 머리 위에 말뚝이
   *   상시로 뜬다 — 기능이 켜진 첫날 화면이 말뚝밭이 된다.
   */
  it('대기 말뚝은 자동이 있는 종(일꾼)에만 켜진다 — 전투 3종에는 안 뜬다 (§D-3)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;

    for (const defId of ['clubber', 'slinger', 'guardian'] as const) {
      view.update([], [], 1, cellToWorld, [], [ally({ defId, hp: 100, autoHold: true })]);
      expect(mesh.count, `${defId}: 자동이 없는 종에 대기 말뚝이 떴다`).toBe(0);
    }
    // 같은 조건의 일꾼은 뜬다 — 거름망이 종을 보고 있지 autoHold 를 죽인 게 아니다
    view.update([], [], 1, cellToWorld, [], [ally({ defId: 'gatherer', hp: 100, autoHold: true })]);
    expect(mesh.count, '일꾼의 말뚝까지 사라졌다').toBe(1);

    // 전투원이라도 **체력바**는 그대로다 — 이 개정이 끈 것은 말뚝 하나뿐이다
    view.update([], [], 1, cellToWorld, [], [ally({ defId: 'clubber', hp: 40, autoHold: true })]);
    expect(mesh.count, '전투원의 체력바까지 사라졌다').toBe(1);
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

/**
 * ── 11단계: 부족원의 **진짜 공격 동작** ────────────────────────────────────────
 *
 * 그 전까지 아군의 공격은 "멈춰서 적을 물면 보행 위상을 시간으로 9rad/s 굴린다"가
 * 전부였다. 사지가 전부 같은 aGait 하나를 보므로 팔을 빠르게 흔들려면 **다리도 같이
 * 빨라져** 제자리 뜀박질로 읽혔고, 무엇보다 위상이 자유 진동이라 **때리는 순간이
 * 피해가 들어가는 틱과 아무 상관이 없었다**.
 *
 * 지금은 습격대와 같은 공격 채널(gait.ts aAtk)을 쓴다. 아래 넷이 그 계약을 나눠 잠근다:
 *  ① 진행도가 sim 의 쿨다운 잔여 틱에서 나온다 (= 타격 틱에 물려 있다)
 *  ② 대기 중에는 0이다 (쿨다운 0에 눌러앉은 아군의 팔이 얼어붙지 않는다)
 *  ③ 다리는 공격에 관여하지 않는다 (제자리 뜀박질 회귀 방지)
 *  ④ 무기가 실제로 올라갔다 내려온다 (셰이더 식을 CPU 로 재현해 잰다)
 */
describe('아군 공격 동작 — 쿨다운 잔여 틱에 물린 한 번의 타격', () => {
  const atkOf = (view: EnemyView): THREE.BufferAttribute =>
    (view as unknown as { atkAttrs: Map<string, THREE.BufferAttribute> }).atkAttrs.get(
      allyGeoKey(),
    )!;

  /** 한 프레임 그리고 그 인스턴스의 공격 채널 (진행도, 조준) 을 읽는다 */
  function drawOne(view: EnemyView, a: AllyState, alpha = 0, dt = 0.016): [number, number] {
    view.update([], alpha, cellToWorld, dt, [a]);
    const attr = atkOf(view);
    return [attr.getX(0), attr.getY(0)];
  }

  it('① 진행도가 타격 틱에서 impact 이고 쿨다운을 따라 앞뒤로 이어진다', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const anim = allyAttackAnim('clubber');
    // sim(allies.ts)이 타격 순간 attackCdLeft 를 쿨다운 전체로 채운다 —
    // 그 프레임의 진행도가 곧 "피해가 들어가는 지점"이어야 한다.
    expect(drawOne(view, ally({ attackCdLeft: anim.cooldown, targetId: 7 }))[0]).toBeCloseTo(
      anim.impact,
      6,
    );
    // 내려친 뒤: 틱이 흐를수록 1을 향해 간다 (복귀 구간)
    const rec = anim.ticks * (1 - anim.impact);
    for (let k = 1; k < Math.floor(rec); k++) {
      expect(
        drawOne(view, ally({ attackCdLeft: anim.cooldown - k, targetId: 7 }))[0],
        `복귀 ${k}틱`,
      ).toBeCloseTo(anim.impact + k / anim.ticks, 6);
    }
    // 쿨다운 한가운데는 동작이 없다 — 동작 길이가 쿨다운보다 짧기 때문이다
    expect(drawOne(view, ally({ attackCdLeft: anim.cooldown - Math.ceil(rec), targetId: 7 }))[0]).toBe(0);
    // 다음 타격이 다가오면 **미리** 젖히기 시작한다 (impact 를 향해 올라간다)
    const wind = anim.ticks * anim.impact;
    for (let cd = Math.floor(wind); cd >= 1; cd--) {
      expect(drawOne(view, ally({ attackCdLeft: cd, targetId: 7 }))[0], `젖히기 cd=${cd}`).toBeCloseTo(
        anim.impact - cd / anim.ticks,
        6,
      );
    }
    view.dispose();
  });

  it('② 적이 없으면 0 — 쿨다운 0에 눌러앉아도 팔이 얼어붙지 않는다', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    // 대기 중인 아군은 attackCdLeft 가 0에서 멈춰 있다. 그 값을 그대로 "다음 타격까지 0틱"
    // 으로 읽으면 팔이 내려치기 직전 자세로 굳는다 — 교전(targetId) 을 조건으로 건 이유다.
    expect(drawOne(view, ally({ attackCdLeft: 0, targetId: -1 }))[0]).toBe(0);
    expect(drawOne(view, ally({ attackCdLeft: 3, targetId: -1 }))[0]).toBe(0);
    /**
     * 다만 **복귀 구간은 교전이 풀려도 끝까지 재생한다.** 마지막 한 대에 적이 죽으면
     * 그 틱에 targetId 가 −1이 되는데, 여기서 0으로 끊으면 치켜든 팔이 한 프레임 만에
     * 순간이동해 내려온다. 진행도가 1에 닿으면 포락선이 0이라 저절로 이어진다.
     */
    const anim = allyAttackAnim('clubber');
    expect(drawOne(view, ally({ attackCdLeft: anim.cooldown, targetId: -1 }))[0]).toBeCloseTo(
      anim.impact,
      6,
    );
    view.dispose();
  });

  it('③ 다리는 공격에 관여하지 않는다 (제자리 뜀박질 회귀)', () => {
    // 리그 쪽: 지면에 닿는 그룹은 공격 배역이 없어야 한다 —
    // 배역이 붙는 순간 포즈 표가 다리를 가져가 접지 보정(groundLift)이 통째로 어긋난다
    for (const l of allyRig().limbs) {
      if (l.ground) expect(l.role, '다리에 공격 배역이 붙었다').toBe(0);
    }
    // 뷰 쪽: 멈춰 서서 때리는 아군의 보행 위상은 **시간이 흘러도 변하지 않는다**.
    // (옛 구현은 여기에 this.time × 9rad/s 를 더해 다리를 굴렸다)
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    const gaits = (view as unknown as { gaitAttrs: Map<string, THREE.BufferAttribute> }).gaitAttrs;
    const fighting = ally({ attackCdLeft: 6, targetId: 7, walked: 3.2 });
    view.update([], 1, cellToWorld, 0.016, [fighting]);
    const g0 = gaits.get(allyGeoKey())!.getX(0);
    for (let i = 0; i < 30; i++) view.update([], 1, cellToWorld, 0.05, [fighting]);
    expect(gaits.get(allyGeoKey())!.getX(0), '멈춰 싸우는데 다리가 걷는다').toBeCloseTo(g0, 6);
    view.dispose();
  });

  it('③-b 조준 자세는 멈춰 서서 물었을 때만 든다 (걸으며 팔이 굳지 않는다)', () => {
    const scene = new THREE.Scene();
    const view = new EnemyView(scene);
    // dt 를 크게 주면 블렌드(AIM_RATE)가 한 프레임에 목표까지 간다
    const still = ally({ targetId: 7, attackCdLeft: 6, x: 8, prevX: 8 });
    for (let i = 0; i < 3; i++) view.update([], 1, cellToWorld, 0.5, [still]);
    expect(atkOf(view).getY(0), '멈춰서 물면 겨눈다').toBeGreaterThan(0.9);
    const walking = ally({ targetId: 7, attackCdLeft: 6, x: 7.9, prevX: 8, walked: 0.1 });
    for (let i = 0; i < 3; i++) view.update([], 1, cellToWorld, 0.5, [walking]);
    expect(atkOf(view).getY(0), '걸으면 보행 스윙으로 돌아온다').toBeLessThan(0.1);
    view.dispose();
  });

  /**
   * ④ 셰이더(gait.ts wgdSetup/wgdPos)의 사지 변형을 CPU 로 그대로 재현해
   * **무기 손(MAIN 배역) 정점이 실제로 올라갔다 내려오는지** 잰다.
   * 포즈 표에 각도만 적어 두고 배역·변형 번호를 잘못 물리면 화면에서는 아무 일도
   * 일어나지 않는데 테스트는 통과하는 사고가 나기 쉬워, 굽힌 정점을 직접 본다.
   */
  function limbTop(id: AllyId, p: number, aim: number): number {
    const rig: EnemyRig = allyRig();
    const geo = buildAlly();
    const pos = geo.getAttribute('position')!;
    const limb = geo.getAttribute(LIMB_ATTR)!;
    const vtag = geo.getAttribute(VARIANT_ATTR)!;
    const variant = allyVariant(id);
    const { wb, fw } = attackEnvelope(p);
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(vtag.getX(i)) !== variant) continue;
      const li = Math.round(limb.getX(i)) - 1;
      const s = rig.limbs[li];
      if (!s || s.role !== ATK_ROLE_MAIN) continue;
      // 던져 나간 물건(무릿매 돌)은 놓는 순간 접혀 사라지므로 높이 계산에서 뺀다
      if (s.throwAway && p > 0.47 && p < 0.85) continue;
      const o = (variant * 3 + s.role - 1) * 4;
      const back = Math.max(wb, aim * (1 - fw));
      const take = rig.attack[o + 2]! * Math.max(aim, wb + fw);
      const ang = (rig.attack[o]! * back + rig.attack[o + 1]! * fw) * take;
      // 아군 팔은 전부 +z 축 회전이라 2D 회전으로 충분하다 (축이 바뀌면 이 식을 고쳐라)
      expect(Math.abs(s.axis[2]), `${id} MAIN 축이 z 가 아니다`).toBeCloseTo(1, 6);
      const px = pos.getX(i) - s.pivot[0];
      const py = pos.getY(i) - s.pivot[1];
      const y = s.pivot[1] + px * Math.sin(ang) + py * Math.cos(ang);
      if (y > top) top = y;
    }
    return top;
  }

  it('④ 무기가 벼르는 자세에서 치켜들었다가 타격에 앞아래로 떨어진다', () => {
    for (const id of ALL_ALLY_IDS) {
      const ready = limbTop(id, 0, 1); // 적을 물고 벼르는 자세 (조준 유지)  ※ 채집꾼은 캐기
      const rest = limbTop(id, 0, 0); // 그냥 서 있는 자세 (보행 리그 그대로)
      const hit = limbTop(id, ATK_RELEASE, 1); // 무기가 가장 앞아래로 내려간 지점
      expect(ready, `${id} 벼르는 자세가 쉬는 자세와 같다`).not.toBeCloseTo(rest, 2);
      /**
       * 모델 키가 0.77 남짓(2.5등신)이므로 0.2는 **몸 높이의 1/4 이상** 떨어진다는 뜻이다.
       * 실측: 몽둥이꾼 0.750 → 0.374 (0.376) · 무릿매 0.899 → 0.436 (0.463) ·
       *       파수꾼 0.676 → 0.361 (0.315) · **채집꾼 0.636 → 0.349 (0.287)**.
       *
       * ⚠ 채집꾼이 이 어서션의 최저 여유(43%)를 쥔 종이다. 캐기 포즈는 각도가 얕고
       * (back 0.70 — 파수꾼 1.25의 절반) 뒤지개도 무기가 아니라 짧은 도구라, 낙차를
       * 벌 손잡이가 **지렛대 길이**밖에 없다. 뒤지개를 줄이면 여기가 먼저 빨개진다
       * (meshlib/enemies.ts kitGatherer: MAIN 최원거리 0.352, 하한은 파수꾼급 0.166).
       */
      expect(ready - hit, `${id} 무기가 내려오지 않는다`).toBeGreaterThan(0.2);
    }
  });

  /**
   * 습격대 회귀 — 아군 포즈 표를 얹어도 적의 표는 한 톨도 움직이지 않아야 한다.
   * 둘은 같은 셰이더·같은 몸통을 쓰지만 **지오메트리와 리그가 갈려 있다**(5단계).
   * 여기서 습격대 값을 못 박아 두면, 훗날 아군 포즈를 손보다 적을 건드린 실수가 걸린다.
   */
  it('아군 포즈 표를 얹어도 습격대 공격 포즈는 그대로다', () => {
    const foe = enemyRig('blade');
    const own = allyRig();
    expect(foe.attack).not.toBe(own.attack); // 표 자체가 다른 객체다
    expect(foe.attack.length).toBeGreaterThan(0);
    // 투창병(변형 1)의 무기 팔: 어깨 뒤로 −2.5rad 젖혔다 +1.75rad 로 뿌린다
    const o = (1 * 3 + ATK_ROLE_MAIN - 1) * 4;
    expect(foe.attack[o], 'blade MAIN back').toBeCloseTo(-2.5, 6);
    expect(foe.attack[o + 1], 'blade MAIN fwd').toBeCloseTo(1.75, 6);
    // 습격대는 아군과 다른 메시라 인스턴스 커서도 섞이지 않는다
    const scene = new THREE.Scene();
    const v = new EnemyView(scene);
    v.update([enemy({ id: 1, defId: 'blade' })], 1, cellToWorld, 0.016, [ally({ id: 101 })]);
    expect(viewMeshes(v).get(RAIDER_GEO_KEY)!.count).toBe(1);
    expect(viewMeshes(v).get(allyGeoKey())!.count).toBe(1);
    v.dispose();
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
