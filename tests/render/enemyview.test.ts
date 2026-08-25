/**
 * EnemyView 회귀 테스트 — 보행 위상/접지 보정이 렌더 파라미터로 옳게 나가는지.
 * WebGL 없이 THREE 오브젝트 상태만 검사한다(렌더러 불필요).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EnemyState } from '@/data/types';
import { EnemyView } from '@/render/views/enemyview';
import { enemyGeoKey as enemyGeoKeyOf, enemyRig } from '@/render/meshlib/enemies';
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
    siegeHoldLeft: 0,
    attackAnimLeft: 0,
    attackAnimTicks: 0,
    blockerAllyId: -1,
    // 문간 (src/sim/gate.ts) — 목 객체라 언제나 '문간이 아니다'
    gateTicks: 0,
    gateBiteCdLeft: 0,
    gateOwed: 0,
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

/** 인스턴스 0번의 공격 채널 (진행도, 조준) */
function atkOf(view: EnemyView, id: string, idx = 0): { p: number; aim: number } {
  const a = (view as unknown as { atkAttrs: Map<string, THREE.BufferAttribute> }).atkAttrs.get(id)!;
  return { p: a.getX(idx), aim: a.getY(idx) };
}

/** 위상 차 — wrapGait 가 [0, 2π) 로 접으므로 되감김을 흡수해서 잰다 */
function phaseDelta(a: number, b: number): number {
  return (((b - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
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

  /*
   * ── 문간 (src/sim/gate.ts) ────────────────────────────────────────────────
   * 이 네 건이 **이번 변경의 그림 전부**다. 사용자 요구가 "적이 홈타운 앞에서 돌진하지
   * 말고 서서 공격한다"인데, 문 앞의 적은 `towerTargetId` 가 −1 이고(gate.ts 규칙 4 —
   * 문간의 적은 타워를 안 때린다) 이동도 0이라 **옛 코드 그대로면 대열이 통째로
   * 얼어붙는다.** 보행 위상을 이동거리에서 뽑기 때문이다(이 파일 헤더).
   * 곧 여기가 빨간 채로 배포되면 화면에는 "마을 앞에 선 채 굳은 공룡 줄"이 뜬다.
   */
  it('문 앞에 선 적은 걷지 않아도 팬다 (제자리 스윙)', () => {
    // 이동 0 · 타워 표적 없음 = 옛 규칙이면 위상이 한 톨도 안 움직이는 상태
    const e = enemy({ id: 31, defId: 'raptor', x: 9, prevX: 9, z: 11.5, prevZ: 11.5, dist: 12, gateTicks: 5 });
    view.update([e], 1, cellToWorld, 0.02);
    const g0 = gaitOf(view, 'raptor');
    view.update([e], 1, cellToWorld, 0.02);
    const g1 = gaitOf(view, 'raptor');
    // 시간으로 굴린 스윙이라 dt × ATTACK_SWING_RATE(9 rad/s) 만큼 나아간다
    expect(phaseDelta(g0, g1)).toBeCloseTo(0.02 * 9, 4);

    // 문간이 아니면 종전 그대로 얼어붙는다 — 회귀 방지(스윙이 상시로 새면 안 된다)
    const still = enemy({ id: 32, defId: 'raptor', x: 9, prevX: 9, dist: 12, gateTicks: 0 });
    view.update([still], 1, cellToWorld, 0.02);
    const s0 = gaitOf(view, 'raptor');
    view.update([still], 1, cellToWorld, 0.02);
    expect(phaseDelta(s0, gaitOf(view, 'raptor'))).toBeCloseTo(0, 6);
  });

  /**
   * 조준 자세(aim)는 `siegeHoldLeft` 만 보고 있었다. 문간의 적은 그 값이 0이라
   * (siege.ts 가 문간이면 endHold 로 조기 반환한다) 그대로 두면 걷다 만 자세로 선다.
   */
  it('문 앞에 서면 조준 자세가 오르고, 떠나면 내려온다', () => {
    const at = enemy({ id: 41, defId: 'blade', x: 9, prevX: 9, dist: 12, gateTicks: 3 });
    for (let i = 0; i < 12; i++) view.update([at], 1, cellToWorld, 0.033);
    expect(atkOf(view, enemyGeoKeyOf('blade')).aim).toBeGreaterThan(0.9);

    const gone = { ...at, gateTicks: 0 };
    for (let i = 0; i < 12; i++) view.update([gone], 1, cellToWorld, 0.033);
    expect(atkOf(view, enemyGeoKeyOf('blade')).aim).toBeLessThan(0.1);
  });

  /**
   * 문 앞에는 홍수 웨이브에서 열몇 마리가 **동시에** 선다(s1 w31 = 57마리).
   * 위상이 같으면 대열이 한 몸처럼 내려쳐 "무리"가 아니라 "한 덩어리"로 읽힌다.
   * 개체 위상은 시간이 아니라 **id 해시**가 정하므로 순회 순서에 안 기댄다.
   */
  it('문간 공격 위상이 개체마다 어긋난다 (연속 id 여도 뭉치지 않는다)', () => {
    const key = enemyGeoKeyOf('blade');
    const foes = [51, 52, 53, 54, 55, 56].map((id, i) =>
      enemy({ id, defId: 'blade', x: 9 + i * 0.4, prevX: 9 + i * 0.4, dist: 12, gateTicks: 4 }),
    );
    view.update(foes, 1, cellToWorld, 0.033);
    const ps = foes.map((_, i) => atkOf(view, key, i).p);
    // 한 주기(0..1)에 흩어져 있어야 대열이 한 몸처럼 안 내려친다.
    // ⚠ **두 마리만 비교하면 안 된다** — 해시는 이웃한 id 를 붙여 놓기도 한다
    //   (실측: id 51/52 는 0.012 차이). 무리로 재는 것이 이 성질의 뜻이다.
    expect(Math.max(...ps) - Math.min(...ps)).toBeGreaterThan(0.4);
    // 그리고 등차수열이 아니다 — `id × 상수` 로 흩뿌리면 파도타기가 된다(이 파일 위 선례)
    const d = ps.slice(1).map((v, i) => v - ps[i]!);
    expect(new Set(d.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
  });

  /**
   * 공중(ptera)도 같은 규칙이다 — 예외 없다(gate.ts 규칙 9, 사용자 요구 "모두 통일").
   * 렌더 쪽 값: 고도는 그대로 유지한 채 날갯짓 위상만 시간으로 돈다.
   * 곧 "하늘에 떠서 마을을 쪼는" 그림이 되고, 지상 대열과 메시가 겹치지 않는다.
   */
  it('공중 적도 문 앞에서 제자리 날갯짓을 한다 (고도는 유지)', () => {
    const e = enemy({ id: 61, defId: 'ptera', flying: true, x: 7.5, prevX: 7.5, z: 13, prevZ: 13, dist: 12, gateTicks: 6 });
    view.update([e], 1, cellToWorld, 0.02);
    const g0 = gaitOf(view, enemyGeoKeyOf('ptera'));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    meshOf(view, enemyGeoKeyOf('ptera')).getMatrixAt(0, m);
    const y0 = p.setFromMatrixPosition(m).y;
    view.update([e], 1, cellToWorld, 0.02);
    expect(phaseDelta(g0, gaitOf(view, enemyGeoKeyOf('ptera')))).toBeGreaterThan(0);
    meshOf(view, enemyGeoKeyOf('ptera')).getMatrixAt(0, m);
    // 날갯짓 보브(±0.085)는 있어도 지면으로 내려앉지는 않는다
    expect(p.setFromMatrixPosition(m).y).toBeGreaterThan(y0 - 0.2);
    expect(p.setFromMatrixPosition(m).y).toBeGreaterThan(1);
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
