/**
 * EnemyView 회귀 테스트 — 보행 위상/접지 보정이 렌더 파라미터로 옳게 나가는지.
 * WebGL 없이 THREE 오브젝트 상태만 검사한다(렌더러 불필요).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EnemyState } from '@/data/types';
import { EnemyView } from '@/render/views/enemyview';
import { enemyRig } from '@/render/meshlib/enemies';
import { groundLiftAt } from '@/render/meshlib/gait';

/** 셀 좌표 = 월드 좌표로 두면 이동거리(타일)와 화면 이동량을 바로 비교할 수 있다 */
const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

function enemy(o: Partial<EnemyState> = {}): EnemyState {
  return {
    id: 1,
    defId: 'raptor',
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
    radius: 0.3,
    alive: true,
    hpMul: 1,
    ...o,
  };
}

/** 인스턴스 0번의 보행 위상 */
function gaitOf(view: EnemyView, id: string): number {
  return (view as unknown as { gaitAttrs: Map<string, THREE.BufferAttribute> }).gaitAttrs
    .get(id)!
    .getX(0);
}

function meshOf(view: EnemyView, id: string): THREE.InstancedMesh {
  return (view as unknown as { meshes: Map<string, THREE.InstancedMesh> }).meshes.get(id)!;
}

function bossMesh(view: EnemyView, id: string): THREE.Mesh {
  return (view as unknown as { bossPool: Map<string, THREE.Mesh[]> }).bossPool.get(id)![0]!;
}

const view = new EnemyView(new THREE.Scene());
const STEP = 0.06; // 한 틱 이동거리(타일)

describe('EnemyView', () => {
  /**
   * 위치는 alpha 로 보간하면서 보행 위상만 틱 경계값(e.dist)을 쓰면,
   * 틱이 없는 렌더 프레임에서 다리가 멈춘 채 몸통만 나아가 디딤발이 밀렸다 되돌아온다.
   */
  it('보행 위상이 렌더 보간 alpha 를 따라간다', () => {
    const rig = enemyRig('raptor');
    const e = enemy({ x: 4, prevX: 4 - STEP, dist: 4 });
    const g: number[] = [];
    for (const alpha of [0, 0.5, 1]) {
      view.update([e], alpha, cellToWorld, 0.0333);
      g.push(gaitOf(view, 'raptor'));
    }
    const full = STEP * rig.gaitPerDist;
    expect(g[1]! - g[0]!).toBeCloseTo(full / 2, 6);
    expect(g[2]! - g[1]!).toBeCloseTo(full / 2, 6);
    // 몸통 이동량과 걸음 진행이 같은 비율이어야 한다
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const px: number[] = [];
    for (const alpha of [0, 0.5, 1]) {
      view.update([e], alpha, cellToWorld, 0.0333);
      meshOf(view, 'raptor').getMatrixAt(0, m);
      px.push(p.setFromMatrixPosition(m).x);
    }
    expect(px[1]! - px[0]!).toBeCloseTo(STEP / 2, 6);
    expect((g[1]! - g[0]!) / (px[1]! - px[0]!)).toBeCloseTo(rig.gaitPerDist, 4); // float32 저장
  });

  /**
   * 접지 보정 표는 **모델 단위**다. 메시 스케일(보스 1.15배·스폰 팝) 밖에서 더하면
   * 스케일 s 일 때 최저점이 (1−s)·lift 만큼 어긋나 보스 발이 지면을 파고든다.
   */
  it('접지 보정에 메시 스케일이 곱해진다 (보스 1.15배)', () => {
    const rig = enemyRig('trex');
    const e = enemy({ id: 7, defId: 'trex', dist: 4.2, x: 4.2, prevX: 4.2 - STEP });
    // 스폰 팝이 끝나도록 age 를 충분히 진행시킨다
    for (let i = 0; i < 20; i++) view.update([e], 1, cellToWorld, 0.05);
    const mesh = bossMesh(view, 'trex');
    expect(mesh.scale.x).toBeCloseTo(1.15, 6);
    const gait = (
      view as unknown as { bossGait: Map<THREE.Mesh, { setGait(g: number): void }> }
    ).bossGait.get(mesh);
    expect(gait).toBeTruthy();
    // 셰이더가 내리는 최저점은 모델 단위 lift 만큼 — 월드에서는 scale 배가 되어야 한다
    const t = Math.abs(Math.sin(gaitOfBoss(e, rig.gaitPerDist)));
    expect(mesh.position.y).toBeCloseTo(groundLiftAt(rig, t) * 1.15, 5);
  });

  it('개체 위상 오프셋이 연속 id 에서 등차수열이 아니다', () => {
    // 한 스폰 그룹은 간격이 일정해 Δdist 가 상수이고 id 도 1씩 는다.
    // 오프셋이 id 의 **선형 함수**면 이웃 간 위상차까지 상수가 되어
    // 흩어지는 대신 물결처럼 파도타기를 한다 — 위상차의 산포로 검사한다.
    const gs: number[] = [];
    for (let id = 40; id < 48; id++) {
      const e = enemy({ id, dist: 4 - 0.5 * (id - 40), x: 4, prevX: 4 });
      view.update([e], 1, cellToWorld, 0.0333);
      gs.push(gaitOf(view, 'raptor'));
    }
    const d: number[] = [];
    for (let i = 1; i < gs.length; i++) {
      let v = (gs[i]! - gs[i - 1]!) % (Math.PI * 2);
      if (v < 0) v += Math.PI * 2;
      d.push(v);
    }
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    expect(sd).toBeGreaterThan(1); // 선형 오프셋이면 정확히 0 이 나온다
  });

  it('빈 타입 메시는 숨겨 프로그램/유니폼 업로드를 타지 않는다', () => {
    view.update([enemy()], 1, cellToWorld, 0.0333);
    expect(meshOf(view, 'raptor').visible).toBe(true);
    expect(meshOf(view, 'raptor').count).toBe(1);
    expect(meshOf(view, 'compy').visible).toBe(false);
    expect(meshOf(view, 'compy').count).toBe(0);
  });

  it('일시정지(dt≈0) 프레임에서 스폰 팝이 기어가지 않는다', () => {
    const e = enemy({ id: 42, x: 4, prevX: 4 });
    view.update([e], 1, cellToWorld, 0.0001);
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    meshOf(view, 'raptor').getMatrixAt(0, m);
    const s0 = s.setFromMatrixScale(m).x;
    for (let i = 0; i < 30; i++) view.update([e], 1, cellToWorld, 0.0001);
    meshOf(view, 'raptor').getMatrixAt(0, m);
    expect(s.setFromMatrixScale(m).x).toBeCloseTo(s0, 9);
  });
});

/** 보스 위상 = 인스턴스와 같은 식 (테스트용 재현) */
function gaitOfBoss(e: EnemyState, gaitPerDist: number): number {
  let h = Math.imul(e.id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  const off = ((h >>> 0) / 4294967296) * Math.PI * 2;
  return e.dist * gaitPerDist + off; // alpha=1 이면 travel = dist
}
