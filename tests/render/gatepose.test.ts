/**
 * 문간 포즈 — **메시가 잣대다**.
 *
 * ── 이 파일이 생긴 이유 (같은 자리에서 두 번 틀렸다) ──────────────────────
 * 문간 정지선은 "몸 앞끝이 마을 바깥끝(`BASECAMP_MAX_RADIUS` 1.45)에 선다"로 정의된다
 * (src/sim/gate.ts 규칙 2). 그런데 그 앞끝을 재던 잣대가 두 번 틀렸다:
 *   ① `STRUCTURE_RING = 1.0` — 구조물이 **놓인 고리**(중심선)이지 바깥끝이 아니다.
 *   ② `e.radius` — **충돌 반지름**이고 메시가 앞으로 뻗는 길이가 아니다(비가 0.96~2.51배).
 * 두 번 다 **계약은 초록인데 그림이 틀렸다**. 잣대가 메시를 안 보고 있었기 때문이다.
 *
 * 그래서 이 파일은 sim/데이터가 들고 있는 숫자를 **메시에서 다시 만들어** 대조한다.
 * 손으로 베낀 숫자가 모델과 어긋나는 순간 여기가 먼저 빨개진다.
 *
 * ── 재는 것 셋 ────────────────────────────────────────────────────────────
 * §1 `EnemyDef.restReach` == `buildEnemy(id).boundingBox.max.x × 렌더 스케일` (16종)
 * §2 물기 포즈의 **코끝**
 *     ⓐ 안전 성질 (16종 전부) — 코끝 ≥ `GATE_STANDOFF_EDGE − GATE_BITE_DEPTH`
 *     ⓑ 균일 성질 (겹침폭에 닿을 수 있는 종) — 코끝 = 그 선에 **정확히**
 *     ⓒ 못 닿는 종 목록을 못 박는다 (메시가 바뀌면 목록이 바뀌고, 그러면 빨개진다)
 * §3 그 선이 마을 기하 안에서 **어디**인가 — 목책 안쪽 · 높은 구조물 대역 바깥쪽
 *
 * ⚠ 각(rad)은 이 파일 어디에도 상수로 안 적히고, 뷰의 식을 베껴 쓰지도 **않는다**.
 *   `EnemyView` 를 실제로 돌려 인스턴스 행렬에서 자세를 **되읽는다**(`maxForwardLeanFromView`).
 *   식을 베끼면 뷰가 `ATTACK_LEAN` 을 다시 겹치도록 바뀌어도 이 파일이 조용히 초록으로
 *   남는다 — 그게 이 저장소가 이미 두 번 당한 사고와 같은 모양이다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ENEMY_DEFS } from '@/data/enemies';
import { GATE_BITE_DEPTH, GATE_LEAN_MAX, GATE_STANDOFF_EDGE } from '@/data/balance';
import { BASECAMP_MAX_RADIUS, WALL_R, createBasecamp } from '@/render/meshlib/basecamp';
import {
  ALL_ENEMY_IDS,
  BOSS_ENEMIES,
  buildEnemy,
  enemyAttackLean,
  enemyGateLean,
  enemyGeoKey,
  enemyReachAt,
  enemyRenderScale,
} from '@/render/meshlib/enemies';
import { EnemyView } from '@/render/views/enemyview';
import type { EnemyId, EnemyState } from '@/data/types';

/** 물기 목표선 — 코끝이 여기보다 안쪽으로 들어가면 지붕을 뚫는다 */
const BITE_LINE = GATE_STANDOFF_EDGE - GATE_BITE_DEPTH;

/** 이 종의 문간 정지 중심거리 (gate.ts `standoffFor`) */
function standoff(id: EnemyId): number {
  return GATE_STANDOFF_EDGE + ENEMY_DEFS[id].restReach;
}

/** 셀 좌표 = 월드 좌표 (이동량 = 타일 수로 바로 읽힌다) */
const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

/** 문 앞에 선 개체 하나 — `heading = 0` 이라 **전방이 월드 +x** 다 */
function gatedEnemy(id: EnemyId): EnemyState {
  return {
    id: 1,
    defId: id,
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
    gateTicks: 30,
    gateBiteCdLeft: 0,
    gateOwed: 4,
    flying: ENEMY_DEFS[id].flying,
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    heading: 0,
    statuses: [],
    bounty: 1,
    baseDamage: ENEMY_DEFS[id].baseDamage,
    radius: ENEMY_DEFS[id].radius,
    alive: true,
    hpMul: 1,
  };
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * **뷰를 실제로 돌려** 문간 포즈의 최대 앞기울임을 읽는다 (rad).
 *
 * ⚠⚠ 각을 여기서 다시 계산하지 **않는다.** 그러면 뷰가 `ATTACK_LEAN` 을 다시 겹치거나
 *   `enemyGateLean` 을 안 쓰게 바뀌어도 이 파일이 조용히 초록으로 남는다 — 그건 이
 *   저장소가 이미 두 번 당한 사고("계약은 초록인데 그림이 틀렸다")와 같은 모양이다.
 *   그래서 인스턴스 행렬에서 자세를 **되읽는다**.
 *
 * `heading = 0` 이면 뷰의 회전은 `Ry(0) · Rz(pitch)` 라 전방 단위벡터가
 * `(cos pitch, sin pitch, 0)` 이다. 앞으로 숙이는 각은 `−pitch` 다(뷰 주석과 같은 규약).
 * 10초를 돌려 조준 자세(`anim.aim`)가 1 로 수렴한 뒤의 한 주기를 전부 본다.
 *
 * ⚠⚠ **하네스가 한 입 쿨다운을 굴린다** (2026-08-27). 옛 뷰는 문간 위상을 벽시계
 *   (`this.time`)로 자유 진동시켰으므로 정지 픽스처로도 한 주기가 돌았다. 그 자유 진동이
 *   사용자 지적으로 걷혔다 — 동작이 **실제 한 입과 박자가 어긋나** "때리는 것 같지도 않은데
 *   HP만 준다"로 보였기 때문이다(views/enemyview.ts `biteEnvelope` 주석).
 *   지금 위상의 출처는 sim 의 `gateBiteCdLeft` 하나뿐이라, 그 값을 안 굴리면 자세가
 *   0 에 굳어 이 파일이 **아무것도 못 잰다**(실측: 코끝이 정지값 1.45 로 나왔다).
 *   그래서 하네스가 sim 과 **같은 방식**으로 센다: 한 입 직후 주기 전체로 채우고 매 틱 1씩 준다.
 */
const HARNESS_BITE_TICKS = 60;
function maxForwardLeanFromView(id: EnemyId): number {
  const view = new EnemyView(new THREE.Scene());
  const e = gatedEnemy(id);
  const boss = BOSS_ENEMIES.has(id);
  let best = 0;
  for (let f = 0; f < 600; f++) {
    // sim/gate.ts 와 같은 규약 — 0 이 되는 틱이 곧 한 입이고, 그 자리에서 다시 채워진다
    e.gateBiteCdLeft = e.gateBiteCdLeft > 0 ? e.gateBiteCdLeft - 1 : HARNESS_BITE_TICKS;
    view.update([e], 1, cellToWorld, 1 / 60);
    if (f < 300) continue; // 앞의 5초는 aim 이 수렴하는 구간
    const inner = view as unknown as {
      meshes: Map<string, THREE.InstancedMesh>;
      bossPool: Map<EnemyId, THREE.Mesh[]>;
    };
    if (boss) {
      _q.copy((inner.bossPool.get(id) as THREE.Mesh[])[0]!.quaternion);
    } else {
      inner.meshes.get(enemyGeoKey(id))!.getMatrixAt(0, _m);
      _m.decompose(_v, _q, new THREE.Vector3());
    }
    _v.set(1, 0, 0).applyQuaternion(_q);
    const forward = -Math.atan2(_v.y, _v.x);
    if (forward > best) best = forward;
  }
  view.dispose();
  return best;
}

/** 종별 최대 앞기울임 (뷰에서 되읽은 값) — 16종을 한 번만 잰다 */
const VIEW_LEAN = new Map<EnemyId, number>(
  ALL_ENEMY_IDS.map((id) => [id, maxForwardLeanFromView(id)]),
);

/**
 * 한 주기 동안 코끝이 **가장 깊이** 들어가는 자리 (마을 중심에서의 거리).
 *
 * ⚠ 최대 각에서만 재면 안 된다. `reach(L)` 은 L 에 단조가 아니라서(납작한 종은 중간
 * 각에서 최댓값을 지난다 — ankylo 는 0.448 에서 최대이고 상한 0.56 에서는 더 얕다),
 * 자세가 0 → 최대 각을 오가는 동안의 **구간 전체**를 훑어야 실제 최심점이 나온다.
 */
function deepestNose(id: EnemyId): number {
  const lmax = VIEW_LEAN.get(id)!;
  let far = enemyReachAt(id, 0);
  for (let i = 0; i <= 720; i++) {
    const r = enemyReachAt(id, (i / 720) * lmax);
    if (r > far) far = r;
  }
  return standoff(id) - far;
}

/** 상한 각까지 몸을 숙여 벌 수 있는 **최대 겹침폭** (= 이 종의 도달 능력) */
function capacity(id: EnemyId): number {
  const rest = enemyReachAt(id, 0);
  let best = 0;
  for (let i = 0; i <= 720; i++) {
    const v = enemyReachAt(id, (i / 720) * GATE_LEAN_MAX) - rest;
    if (v > best) best = v;
  }
  return best;
}

describe('§1 정지 도달 — 데이터가 든 숫자가 메시와 같다', () => {
  for (const id of ALL_ENEMY_IDS) {
    it(`${id}: restReach == bbox.max.x × 렌더 스케일`, () => {
      const geo = buildEnemy(id);
      geo.computeBoundingBox();
      const box = geo.boundingBox as THREE.Box3;
      const measured = box.max.x * enemyRenderScale(id);
      // 데이터는 소수 4자리로 적는다 → 반올림 오차 ≤ 5e-5. 그보다 큰 어긋남은 전부
      // "메시를 고치고 데이터를 안 고쳤다"이거나 "숫자를 잘못 베꼈다"다.
      expect(ENEMY_DEFS[id].restReach, `${id} restReach`).toBeCloseTo(measured, 4);
      expect(Math.abs(ENEMY_DEFS[id].restReach - measured), `${id} 오차`).toBeLessThan(1e-4);
    });
  }

  it('정지 자세의 몸 앞끝이 마을 바깥끝에 정확히 선다 (16종)', () => {
    for (const id of ALL_ENEMY_IDS) {
      // 중심거리 − 앞끝 도달 = 1.45. 이 한 줄이 "서 있는 몸은 마을 밖"이다.
      expect(standoff(id) - enemyReachAt(id, 0), `${id} 정지 앞끝`).toBeCloseTo(
        BASECAMP_MAX_RADIUS,
        4,
      );
    }
  });

  it('restReach 는 radius 와 다른 것을 잰다 — "반경에 상수를 곱하면 된다"가 거짓이다', () => {
    // 두 값의 비가 **일정하지도 않다**: ptera 0.32 대 0.80(2.51배)인데
    // golem 0.50 대 0.48(0.96배)이다. 곧 어떤 상수를 곱해도 16종을 못 덮는다 —
    // 이것이 필드를 새로 만든 이유이고, `radius` 로 되돌리면 여기가 먼저 빨개진다.
    const ratios = ALL_ENEMY_IDS.map((id) => ENEMY_DEFS[id].restReach / ENEMY_DEFS[id].radius);
    expect(Math.min(...ratios), '가장 작은 비').toBeLessThan(1);
    expect(Math.max(...ratios), '가장 큰 비').toBeGreaterThan(2);
  });
});

describe('§2 물기 포즈의 코끝', () => {
  /**
   * ⓐ **안전 성질** — 종을 안 가린다. 이 한 줄이 "지붕 관통"을 닫는다.
   * 옛 구현(각 하나 0.56)에서는 trex 0.738 · spino 0.937 · golem 0.941 · shaman 0.954 로
   * 네 종이 이 선보다 0.3~0.7 더 깊이 들어갔다.
   */
  it(`아무도 ${BITE_LINE.toFixed(2)} 보다 깊이 안 들어간다 (16종)`, () => {
    for (const id of ALL_ENEMY_IDS) {
      // ⚠ 여유 1e-4 는 `EnemyDef.restReach` 가 **소수 4자리로 적힌 값**이기 때문이다
      //   (반올림 오차 ≤ 5e-5). 그보다 큰 침범은 전부 진짜 관통이다.
      expect(deepestNose(id), `${id} 물기 코끝`).toBeGreaterThanOrEqual(BITE_LINE - 1e-4);
    }
  });

  /**
   * ⓑ **균일 성질** — 각이 아니라 겹침폭을 고정했으므로, 닿을 수 있는 종은 전부
   * **같은 자리**에서 문다. 도달 능력(`capacity`)도 메시에서 다시 만들어 비교하므로
   * 모델을 고치면 조용히 통과하지 않고 여기가 움직인다.
   */
  it('코끝 = 1.45 − min(GATE_BITE_DEPTH, 종별 도달 능력) — 문간 각을 받는 11종', () => {
    // ⚠ 던지는 다섯은 문간 각을 안 받으므로 이 식의 대상이 아니다(아래 따로 잰다).
    for (const id of ALL_ENEMY_IDS.filter((x) => enemyAttackLean(x) === 0)) {
      const want = GATE_STANDOFF_EDGE - Math.min(GATE_BITE_DEPTH, capacity(id));
      expect(deepestNose(id), `${id} 물기 코끝`).toBeCloseTo(want, 3);
    }
  });

  /**
   * ⓒ 겹침폭에 **닿는** 종은 목표선에 정확히 선다. 목록을 못 박는 이유는
   * "몇 종이 균일한가"가 이 설계가 파는 물건 자체이기 때문이다 — 메시를 고쳐 그 수가
   * 변하면 조용히 넘어가면 안 된다.
   */
  it('목표 폭에 닿는 종은 코끝이 정확히 목표선이다 — 그 목록을 못 박는다', () => {
    const reaching = ALL_ENEMY_IDS.filter(
      (id) => enemyAttackLean(id) === 0 && capacity(id) >= GATE_BITE_DEPTH,
    );
    for (const id of reaching) {
      expect(deepestNose(id), `${id} 물기 코끝`).toBeCloseTo(BITE_LINE, 3);
    }
    expect(reaching.sort()).toEqual(
      ['golem', 'mammoth', 'raptor', 'shaman', 'spino', 'trex', 'trike'].sort(),
    );
  });

  /**
   * ⓓ **못 닿는 넷** — 낮고 납작한 종은 몸을 아무리 숙여도 코가 그만큼 안 나간다.
   * 이 넷은 각이 `GATE_LEAN_MAX` 에서 잘려 **옛 구현과 같은 포즈**로 남는다(회귀 0).
   * ⚠ "16종 전부 코끝 = 1.25"는 어떤 각으로도 불가능하다 — 그것을 실측으로 못 박는 줄이다.
   */
  it('못 닿는 넷(ankylo·ptera·boar·compy)은 상한 각에서 잘린다', () => {
    const short = ALL_ENEMY_IDS.filter(
      (id) => enemyAttackLean(id) === 0 && capacity(id) < GATE_BITE_DEPTH,
    );
    expect(short.sort()).toEqual(['ankylo', 'boar', 'compy', 'ptera'].sort());
    for (const id of short) {
      expect(enemyGateLean(id), `${id} 각`).toBeCloseTo(GATE_LEAN_MAX, 6);
      // 그리고 목표선보다 **얕게** 문다 — 안전 성질을 위반하지 않는 방향이다
      expect(deepestNose(id), `${id} 코끝`).toBeGreaterThan(BITE_LINE);
    }
  });

  it('던지는 다섯(습격대 4종 + warrior)은 문간 각을 안 받는다 — 손대지 않았다', () => {
    const throwers = ALL_ENEMY_IDS.filter((id) => enemyAttackLean(id) > 0);
    expect(throwers.sort()).toEqual(['archer', 'blade', 'hexer', 'lancer', 'warrior'].sort());
    for (const id of throwers) {
      // 던지기 각만으로도 이미 목표선보다 얕다 = 건드릴 이유가 없다
      expect(deepestNose(id), `${id} 코끝`).toBeGreaterThan(BITE_LINE);
    }
  });

  it('어떤 종도 상한 각을 넘지 않는다', () => {
    for (const id of ALL_ENEMY_IDS) {
      expect(enemyGateLean(id), `${id}`).toBeLessThanOrEqual(GATE_LEAN_MAX + 1e-12);
      expect(enemyGateLean(id), `${id}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('§3 물기 목표선이 마을 기하에서 어디인가', () => {
  /**
   * 마을을 만렙으로 세워 **반경별 최고 높이**를 잰다. 0.01타일 빈으로 훑으면
   *   r ≤ 1.15  최고 1.13~2.11  ← 움막·장옥·망루가 서 있는 대역
   *   r 1.15~1.28  0.82~1.05   ← 목책(WALL_R)과 바닥판뿐
   * 이라, "높은 것이 서 있는 가장 바깥 반경"이 물기 목표선의 **안쪽 한계**가 된다.
   */
  const TALL = 1.1; // 움막 지붕 마루 높이 — 이보다 높은 것은 장옥·망루·깃대다
  function outermostTallRadius(): number {
    const camp = createBasecamp();
    camp.setLevel(5, 5);
    camp.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let r = 0;
    camp.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
      const pos = o.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y >= TALL) r = Math.max(r, Math.hypot(v.x, v.z));
      }
    });
    camp.dispose();
    return r;
  }

  it('목표선은 목책 안쪽이다 — 안 그러면 화면에서 "문다"가 안 보인다', () => {
    expect(BITE_LINE).toBeLessThan(WALL_R);
  });

  it('목표선은 높은 구조물 대역 바깥이다 — 안 그러면 다시 지붕 관통이다', () => {
    const rTall = outermostTallRadius();
    expect(rTall, '마을이 갑자기 바깥까지 높아졌다').toBeLessThan(WALL_R);
    expect(BITE_LINE, `높은 구조물이 ${rTall.toFixed(3)} 까지 나와 있다`).toBeGreaterThan(rTall);
  });

  it('정지선은 마을 바깥끝 그대로다 (= 서 있는 몸은 한 톨도 안 들어온다)', () => {
    expect(GATE_STANDOFF_EDGE).toBe(BASECAMP_MAX_RADIUS);
  });
});
