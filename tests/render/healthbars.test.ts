/**
 * 체력바 회귀 테스트 — 적과 타워가 **같은 InstancedMesh 하나**를 공유하는지(드로우콜 1),
 * 만피는 숨기는지, 용량을 넘겨도 안전한지. WebGL 없이 THREE 오브젝트 상태만 본다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AllyState, EnemyState, ResourceCellState, TowerState } from '@/data/types';
import { HealthBarView } from '@/render/views/healthbars';

const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

function enemy(o: Partial<EnemyState> = {}): EnemyState {
  return {
    id: 1,
    defId: 'raptor',
    hp: 10,
    maxHp: 10,
    shieldHitsLeft: 0,
    dist: 0,
    pathIndex: 0,
    attackCdLeft: 0,
    towerTargetId: -1,
    siegeHoldLeft: 0,
    attackAnimLeft: 0,
    attackAnimTicks: 0,
    blockerAllyId: -1,
    // 문간 (src/sim/gate.ts) — 목 객체라 언제나 '문간이 아니다'
    gateTicks: 0,
    gateBiteCdLeft: 0,
    gateOwed: 0,
    flying: false,
    x: 1,
    z: 1,
    prevX: 1,
    prevZ: 1,
    heading: 0,
    statuses: [],
    bounty: 1,
    baseDamage: 1,
    radius: 0.3,
    alive: true,
    hpMul: 1,
    ...o,
  };
}

function tower(o: Partial<TowerState> = {}): TowerState {
  return {
    id: 100,
    defId: 'spear',
    tier: 0,
    hp: 260,
    maxHp: 260,
    silenceLeft: 0,
    cellX: 3,
    cellZ: 4,
    cooldownLeft: 0,
    targetId: -1,
    targeting: 'first',
    invested: 100,
    buffDmgPct: 0,
    buffRatePct: 0,
    ...o,
  };
}

/**
 * 격자 폭. `AllyState.gatherKey = cellZ * gridW + cellX` 라, 예약을 흉내 내려면
 * 뷰에 넘기는 `gridW` 와 키를 만드는 식이 **같은 값**을 써야 한다 (그래서 상수 하나다).
 */
const GRID_W = 16;
const keyOf = (c: { cellX: number; cellZ: number }): number => c.cellZ * GRID_W + c.cellX;

function cell(o: Partial<ResourceCellState> = {}): ResourceCellState {
  return { cellX: 5, cellZ: 2, kind: 'berry', value: 10, taken: false, regrowAt: 0, regrowsLeft: 0, ...o };
}

/**
 * 목 부족원. 기본값이 **사람에 붙는 표시를 전부 끈 상태**다 — 이 아래 채집 테스트가
 * 세려는 것은 자원 배지(kind 7)뿐이라, 다른 인스턴스가 하나라도 섞이면 개수가
 * 무엇을 뜻하는지 흐려진다:
 *   만피         → 아군 체력바 없음
 *   carryCount 0 → 짐 칩(6) 없음
 *   autoHold     → 대기 말뚝(8) 없음
 *   (x,z) ≠ (tgtX,tgtZ) → `isGathering` false = 발밑 게이지(5) 없음.
 *     이것이 곧 **"캐러 가는 중"** 이라 예약 배지를 시험하기에도 맞는 자세다.
 */
function ally(o: Partial<AllyState> = {}): AllyState {
  return {
    id: 7,
    defId: 'gatherer',
    hp: 40,
    maxHp: 40,
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    tgtX: 9,
    tgtZ: 9,
    walked: 0,
    heading: 0,
    attackCdLeft: 0,
    targetId: -1,
    autoHold: false,
    gatherKey: -1,
    gatherTicks: 0,
    carryGold: 0,
    carryCount: 0,
    alive: true,
    ...o,
  };
}

/** 씬에 붙은 InstancedMesh들 (드로우콜 프록시) */
function meshesOf(scene: THREE.Scene): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}

describe('HealthBarView', () => {
  it('적과 타워 체력바가 같은 메시 하나에 실린다 (드로우콜 1)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const meshes = meshesOf(scene);
    expect(meshes).toHaveLength(1);

    view.update([enemy({ hp: 5 })], [tower({ hp: 130 })], 1, cellToWorld);
    // 인스턴스 2개(적 1 + 타워 1)가 같은 메시에 들어간다 — 메시 개수는 그대로 1
    expect(meshesOf(scene)).toHaveLength(1);
    expect(meshes[0]!.count).toBe(2);
    view.dispose();
  });

  it('만피는 숨긴다 (적/타워 모두)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;

    view.update([enemy()], [tower()], 1, cellToWorld);
    expect(mesh.count).toBe(0);

    view.update([enemy({ hp: 9 })], [tower()], 1, cellToWorld);
    expect(mesh.count).toBe(1);

    view.update([enemy()], [tower({ hp: 259 })], 1, cellToWorld);
    expect(mesh.count).toBe(1);
    view.dispose();
  });

  it('죽은 적은 빼고, 타워 체력바 채움 비율이 hp/maxHp와 같다', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    view.update(
      [enemy({ hp: 5, alive: false })],
      [tower({ hp: 65, maxHp: 260 })],
      1,
      cellToWorld,
    );
    expect(mesh.count).toBe(1);
    const fill = mesh.geometry.getAttribute('fill');
    expect(fill.getX(0)).toBeCloseTo(0.25, 5);
    view.dispose();
  });

  it('티어가 높을수록 바가 위로 올라간다 (지붕 위 유지)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    const yOf = (tier: number): number => {
      view.update([], [tower({ tier, hp: 1 })], 1, cellToWorld);
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(0, m);
      return new THREE.Vector3().setFromMatrixPosition(m).y;
    };
    expect(yOf(4)).toBeGreaterThan(yOf(0));
    view.dispose();
  });

  /**
   * **적 바와 타워 바는 시각적으로 갈려야 한다.**
   * 예전에는 폭/높이만 조금 다르고 팔레트·테두리가 같아 난전에서 구분되지 않았고,
   * 빨간 바가 "적이 곧 죽는다"(좋은 소식)와 "내 타워가 무너진다"(나쁜 소식) 양쪽을
   * 뜻해 의미가 반전됐다. 프래그먼트 분기의 근거인 barKind 속성을 잠근다.
   */
  it('barKind로 적(0)과 타워(1)를 가르고, 타워 바가 확실히 두껍다', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    view.update([enemy({ hp: 5 })], [tower({ hp: 100 })], 1, cellToWorld);
    const kind = mesh.geometry.getAttribute('barKind');
    expect(kind, 'barKind 인스턴스 속성').toBeTruthy();
    expect(kind.getX(0), '적 = 0').toBe(0);
    expect(kind.getX(1), '타워 = 1').toBe(1);
    // 높이(스케일 y) — 타워 바가 적 바보다 확실히 두껍다 (기본 줌 1~2px → 4~5px)
    const m = new THREE.Matrix4();
    const scl = new THREE.Vector3();
    mesh.getMatrixAt(0, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scl);
    const foeH = scl.y;
    mesh.getMatrixAt(1, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scl);
    expect(scl.y).toBeGreaterThan(foeH * 1.5);
    view.dispose();
  });

  /**
   * **기지 바 — 패배 조건이라 타워 바와 같은 규칙을 따르되 자리가 다르다.**
   * HUD 둘째 줄(하트 + 체력바)을 걷어내면서 이 바가 그 역할을 물려받았다.
   * 셋을 잠근다:
   *  (1) 만피면 안 그린다 — 이 파일의 대원칙이고 사용자 요구("공격받으면 나온다")다
   *  (2) 마을 레벨이 오르면 바가 위로 간다 — BASE_ROOF_Y 표가 basecamp.ts 의 모델
   *      높이를 손으로 베껴 온 값이라, 마을을 더 높이면 이 테스트가 먼저 걸려야 한다
   *  (3) barKind 4 — 셰이더가 `min(vKind, 1.0)`으로 내 편 팔레트에 태우므로 타워(1)와
   *      같은 색이지만, 값이 갈려 있어야 나중에 기지만 따로 칠할 수 있다
   */
  it('기지 바: 만피면 숨기고, 마을 레벨이 오르면 위로 간다 (barKind 4)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    const base = (hp: number, level: number) => ({ cellX: 3, cellZ: 4, hp, maxHp: 25, level });

    // (1) 만피 — 아무것도 안 그린다
    view.update([], [], 1, cellToWorld, [], [], base(25, 1));
    expect(mesh.count, '만피 기지는 바가 없다').toBe(0);

    // (2) 레벨이 오르면 지붕이 높아지므로 바도 올라간다
    const yAt = (level: number): number => {
      view.update([], [], 1, cellToWorld, [], [], base(10, level));
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(0, m);
      return new THREE.Vector3().setFromMatrixPosition(m).y;
    };
    expect(yAt(5), 'Lv5 장옥이 Lv1 움막보다 높다').toBeGreaterThan(yAt(1));

    // (3) barKind 4 + 채움 비율
    view.update([], [], 1, cellToWorld, [], [], base(10, 1));
    expect(mesh.geometry.getAttribute('barKind').getX(0), '기지 = 4').toBe(4);
    expect(mesh.geometry.getAttribute('fill').getX(0), '10/25').toBeCloseTo(0.4, 5);
    view.dispose();
  });

  /**
   * ── 채집 배지: **텄음(taken) 칸은 아무것도 안 그린다** ──────────────────────
   *
   * 사용자가 지적한 것: *"일꾼들이 채집하고 나서 남은 흔적이 보이는 4각형"* —
   * 다 캔 칸마다 회색 마름모가 남아 판이 진행될수록 수십 개가 지형을 덮었다.
   * 고침은 `healthbars.ts` 의 한 줄(`if (c.taken) continue;`)이고, **그 한 줄을
   * 지워도 아무 테스트가 안 빨개지는 상태**였다. 그래서 이 셋을 잠근다.
   *
   * 왜 taken 검사가 claimed 검사보다 **먼저** 와야 하나: 예약 배지는 selecting 과
   * 무관하게 항상 뜨는 표시라(GatherViewInfo.selecting 주석), 순서가 뒤집히면
   * "방금 다 캔 칸을 아직 그 사람이 물고 있는" 한 틱에 회색 칩이 그대로 살아난다.
   * (2)번 줄이 그 순서를 재는 자리다.
   *
   * 판별력 증명 — `if (c.taken) continue;` 를 지우고 돌리면:
   *   × 텄음 칸은 배지를 하나도 안 만든다 → (1) selecting=true 에서 `expected 1 to be +0`
   *     (2)도 **따로 재서** 같은 `expected 1 to be +0` — (1)이 먼저 끊어 두 번째 줄까지
   *     안 가므로, (1)을 잠깐 지우고 (2) 혼자 빨개지는 것을 확인했다
   *   × 같은 메시 하나 → `expected 4 to be 3`
   *   ○ 반대편 가드는 초록 그대로 — 이 줄과 무관한 국면만 재기 때문이다
   * 되돌리면 전부 초록. (selecting=false + 예약 없음 조합만은 뒤 줄이 어차피
   * 걸러 내므로 판별력이 없다 — 그래서 (2)에 **예약을 일부러 걸었다**.)
   */
  it('텄음(taken) 칸은 배지를 하나도 안 만든다 (selecting 양쪽 다)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    const done = cell({ taken: true, regrowAt: 900, regrowsLeft: 1 });

    // (1) 부족을 고르는 중 — 금색 배지가 뜨는 국면인데도, 텄으면 안 뜬다
    view.update([], [], 1, cellToWorld, [], [], null, {
      cells: [done],
      gridW: GRID_W,
      selecting: true,
    });
    expect(mesh.count, '텄음 + 고르는 중').toBe(0);

    // (2) 안 고르는 중 + **예약이 걸린** 텄음 칸 (다 캤는데 아직 그 사람이 물고 있다)
    const walker = ally({ gatherKey: keyOf(done) });
    view.update([], [], 1, cellToWorld, [], [walker], null, {
      cells: [done],
      gridW: GRID_W,
      selecting: false,
    });
    expect(mesh.count, '텄음 + 예약 — taken 검사가 claimed 검사보다 먼저다').toBe(0);

    // (3) 둘 다 참이어도 그대로 0
    view.update([], [], 1, cellToWorld, [], [walker], null, {
      cells: [done],
      gridW: GRID_W,
      selecting: true,
    });
    expect(mesh.count, '텄음 + 예약 + 고르는 중').toBe(0);
    view.dispose();
  });

  /**
   * **반대편 가드 — 배지 기능을 죽인 게 아님을 보인다.**
   * 위 계약만 있으면 `if (true) continue;` 로도 초록이다. 살아 있어야 하는 두 국면:
   *  · 예약된 칸(누가 캐러 가는 중)은 selecting 과 무관하게 뜬다 — "저기는 이미 사람이
   *    간다"는 고르는 중이 아니어도 알아야 하는 정보다
   *  · 안 텄고 예약도 없는 칸은 **고르는 중일 때만** 뜬다 — 상시로 띄우면 판에
   *    배지 40개가 깔려 정작 골랐을 때의 신호가 죽는다
   * fill 로 세 상태가 갈리는 것(예약 0.5 · 안 텄음 1)까지 같이 잠근다.
   */
  it('반대편 가드: 예약은 항상 뜨고, 안 턴 칸은 고르는 중에만 뜬다', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    const live = cell({ taken: false });
    const fill = (): number => mesh.geometry.getAttribute('fill').getX(0);

    // 예약 — 고르는 중이 아니어도 뜬다
    view.update([], [], 1, cellToWorld, [], [ally({ gatherKey: keyOf(live) })], null, {
      cells: [live],
      gridW: GRID_W,
      selecting: false,
    });
    expect(mesh.count, '예약된 칸은 selecting 과 무관하게 뜬다').toBe(1);
    expect(mesh.geometry.getAttribute('barKind').getX(0), '자원 배지 = 7').toBe(7);
    expect(fill(), '예약 = 0.5 (한랭색)').toBeCloseTo(0.5, 5);

    // 예약 없음 — selecting 이 가른다
    view.update([], [], 1, cellToWorld, [], [], null, {
      cells: [live],
      gridW: GRID_W,
      selecting: false,
    });
    expect(mesh.count, '평소에는 배지밭을 안 깐다').toBe(0);

    view.update([], [], 1, cellToWorld, [], [], null, {
      cells: [live],
      gridW: GRID_W,
      selecting: true,
    });
    expect(mesh.count, '고르는 중이면 뜬다').toBe(1);
    expect(fill(), '안 텄고 예약 없음 = 1 (금색)').toBeCloseTo(1, 5);
    view.dispose();
  });

  /**
   * 배지가 **체력바와 같은 메시 하나**에 실린다 (드로우콜 1) — 이 파일의 대원칙이자
   * 채집 표시를 여기 얹은 이유 그 자체다(healthbars.ts 헤더: 드로우콜 Δ 0).
   * 쌓는 순서(체력바 → 배지)도 같이 잠근다: CAPACITY 를 넘길 때 잘리는 것이
   * 언제나 배지여야 하고, 체력바는 한 개도 잘리면 안 된다.
   */
  it('자원 배지도 체력바와 같은 InstancedMesh 하나에 실린다 (맨 뒤에)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    view.update([enemy({ hp: 5 })], [tower({ hp: 100 })], 1, cellToWorld, [], [], null, {
      cells: [cell({ taken: false }), cell({ cellX: 6, taken: true })],
      gridW: GRID_W,
      selecting: true,
    });
    expect(meshesOf(scene), '메시는 여전히 하나').toHaveLength(1);
    // 적 1 + 타워 1 + 안 텄음 배지 1 — **텄음 칸은 안 세어진다**
    expect(mesh.count, '적1 + 타워1 + 배지1').toBe(3);
    const kind = mesh.geometry.getAttribute('barKind');
    expect(kind.getX(0), '적 = 0').toBe(0);
    expect(kind.getX(1), '타워 = 1').toBe(1);
    expect(kind.getX(2), '배지는 맨 뒤 = 7').toBe(7);
    view.dispose();
  });

  it('용량(CAPACITY)을 넘겨도 터지지 않는다', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    const enemies = Array.from({ length: 200 }, (_, i) => enemy({ id: i + 1, hp: 1 }));
    const towers = Array.from({ length: 20 }, (_, i) => tower({ id: 500 + i, hp: 1 }));
    expect(() => view.update(enemies, towers, 1, cellToWorld)).not.toThrow();
    // 상한은 인스턴스 버퍼 크기 자체로 잰다 (표식까지 한 메시에 실리면서 늘어났다)
    expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
    view.dispose();
  });

  /**
   * **콕 집은 자원 칸 하나만 켠다** (사용자 지적: "1개의 자원을 선택하면 그 자원만
   * 선택된 마름모 표지가 나와야 하는데, 모든 자원들에 마름모 표지가 표시된다").
   *
   * `selecting`("어디로 보낼까" — 전부 켠다)과 `focus`("이 칸이 뭐지" — 하나만)의
   * 뜻이 다르다는 것이 이 항목의 본문이다. 종전에는 둘이 한 불리언이라 뒤쪽에서도
   * 판 전체가 켜졌다.
   */
  it('자원 칸 하나를 고르면 **그 칸만** 배지가 뜬다 (전부 켜지지 않는다)', () => {
    const scene = new THREE.Scene();
    const view = new HealthBarView(scene);
    const mesh = meshesOf(scene)[0]!;
    const cells = [
      cell({ cellX: 1, cellZ: 1 }),
      cell({ cellX: 2, cellZ: 1 }),
      cell({ cellX: 3, cellZ: 1 }),
    ];
    const draw = (focus: { x: number; z: number } | null, selecting: boolean): void => {
      view.update([], [], 1, cellToWorld, [], [], null, { cells, gridW: GRID_W, selecting, focus });
    };
    // ① 하나를 콕 집었다 → 딱 하나. `selecting` 이 켜져 있어도 **집은 쪽이 이긴다**
    draw({ x: 2, z: 1 }, true);
    expect(mesh.count, '집은 칸 하나만 떠야 한다').toBe(1);
    // ② 아무것도 안 집고 부족을 고르는 중 → 전부 (종전 동작이 여기서 산다)
    draw(null, true);
    expect(mesh.count, '부족을 고르는 중이면 갈 수 있는 칸이 전부').toBe(3);
    // ③ 둘 다 아님 → 하나도 안 뜬다 (배지밭 방지)
    draw(null, false);
    expect(mesh.count).toBe(0);
  });
});
