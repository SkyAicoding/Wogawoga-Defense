/**
 * 체력바 회귀 테스트 — 적과 타워가 **같은 InstancedMesh 하나**를 공유하는지(드로우콜 1),
 * 만피는 숨기는지, 용량을 넘겨도 안전한지. WebGL 없이 THREE 오브젝트 상태만 본다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EnemyState, TowerState } from '@/data/types';
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
    blockerAllyId: -1,
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
});
