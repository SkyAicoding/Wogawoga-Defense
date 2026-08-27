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
   * ⚠⚠ **이 계약은 2026-08-27 에 출처가 바뀌었다** — 문턱을 푼 것이 아니라 **재는 것이
   *   강해졌다.** 옛 판본은 "개체 위상이 `id` 해시로 흩어진다"를 쟀다. 그 위상은
   *   벽시계 자유 진동이었고, 사용자가 바로 그것을 물렸다:
   *     > "공룡이 홈타운을 공격할때 애니메이션을 넣어줘. 지금은 가만 있잖아."
   *   자유 진동의 진짜 문제는 흩어짐이 아니라 **박자**였다: `GATE_SWING_PERIOD` 1초는
   *   옛 한 입 주기(30틱)에 맞춘 값인데 `GATE_BITE_TICKS` 가 60 이 되면서 동작이 한 입당
   *   **두 번** 돌았다. 곧 물어뜯는 시늉과 마을이 깎이는 순간이 영영 안 맞았다.
   *
   * 지금 위상의 출처는 sim 의 `gateBiteCdLeft` 하나다. 그래서 여기서 잠그는 것도 둘로 는다:
   *   ① **위상이 한 입 쿨다운을 따라간다** — 쿨다운이 줄면 위상이 단조 증가한다.
   *      이것이 옛 계약이 **재지도 못하던** 성질이고, 자유 진동으로 되돌리면 여기가 빨개진다.
   *   ② 흩어짐은 그대로 잠근다. 다만 출처가 id 해시가 아니라 **도착 틱**이다 —
   *      실제로도 개체의 한 입 시각은 문 앞에 선 틱이 정하므로 제각각이다(gate.ts).
   */
  it('문간 공격 위상이 한 입 쿨다운을 따라간다 (자유 진동이 아니다)', () => {
    const key = enemyGeoKeyOf('blade');
    const cd = 60;
    const e = enemy({ id: 51, defId: 'blade', x: 9, prevX: 9, dist: 12, gateTicks: 4 });
    // 첫 프레임이 주기를 관측한다(뷰는 상수를 import 하지 않는다 — 스테이지가 덮어쓸 수 있다)
    e.gateBiteCdLeft = cd;
    view.update([e], 1, cellToWorld, 0.033);
    const ps: number[] = [];
    for (let left = cd; left >= 0; left -= 6) {
      e.gateBiteCdLeft = left;
      view.update([e], 1, cellToWorld, 0.033);
      ps.push(atkOf(view, key, 0).p);
    }
    // 쿨다운이 줄수록 위상이 **오른다** — 한 입이 들어가는 틱(left 0)이 곧 동작의 끝이다
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!, `left ${cd - i * 6} 에서 위상이 안 늘었다: ${ps.map((v) => v.toFixed(3)).join(' ')}`)
        .toBeGreaterThan(ps[i - 1]!);
    }
    expect(ps[0]!, '시작 위상이 0 이 아니다').toBeLessThan(0.1);
    expect(ps[ps.length - 1]!, '한 입 틱에서 위상이 끝까지 안 갔다').toBeGreaterThan(0.9);
  });

  /**
   * **주민을 때릴 때도 몸을 쓴다** — 사용자 지적:
   *   > "공룡 옆에 우리 주민이 가까이 가면 그냥 죽어 버리는데 … 공격하는 애니매이션을
   *   >  하고 주민을 죽어야 해."
   *
   * 난투(`sim/allies.ts`)는 타워도 마을도 아닌 **사람**을 때리므로 `towerTargetId` 도
   * `gateTicks` 도 안 쓴다. 그래서 옛 뷰에서는 어떤 채널에도 안 걸려 공룡이 미동도
   * 없이 서 있었다. 지금은 sim 이 채워 주는 `attackAnimLeft` 가 그 자리를 잡는다.
   *
   * ⚠ **자세를 되읽는다**(인스턴스 행렬 → 전방 벡터). 식을 베끼면 뷰만 고치는 회귀가
   *   조용히 통과한다 — `gatepose.test.ts` 가 같은 이유로 같은 방식을 쓴다.
   */
  it('난투 중인 공룡은 앞으로 물어뜯는다 (가만 서 있지 않는다)', () => {
    const key = enemyGeoKeyOf('raptor');
    const idle = enemy({ id: 71, defId: 'raptor', x: 9, prevX: 9, dist: 12 });
    const forwardOf = (): number => {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      meshOf(view, key).getMatrixAt(0, m);
      m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      v.set(1, 0, 0).applyQuaternion(q);
      return -Math.atan2(v.y, v.x); // 앞으로 숙인 각(rad)
    };
    for (let i = 0; i < 20; i++) view.update([idle], 1, cellToWorld, 0.033);
    const still = forwardOf();

    /*
     * ⚠⚠ **대조군이 필요하다.** "가만 서 있는 것보다 숙인다"만 재면 이 계약이 물기를
     *   재는 것이 아니라 **제자리걸음**(`marking` → `ATTACK_LEAN`)을 재게 된다 —
     *   난투도 `marking` 을 켜므로 물기 자세를 통째로 지워도 초록이었다(실측: 사보타주 P3 통과).
     *   그래서 팔을 둘로 가른다. 둘 다 `marking` 이 켜져 있고 **난투 여부만 다르다**:
     *     대조 = 타워를 노려 멈춰 선 상태(`towerTargetId ≥ 0`) · 동작 카운터 0
     *     실험 = 같은 자세 + 난투 동작 재생 중
     *   두 팔의 최심 각 차이가 곧 **물기 한 동작이 화면에 더한 몫**이다.
     */
    const deepestOver = (brawling: boolean): number => {
      const e = enemy({ id: 71, defId: 'raptor', x: 9, prevX: 9, dist: 12, towerTargetId: 5 });
      e.attackAnimTicks = 18;
      let deep = -Infinity;
      for (let left = 18; left >= 0; left--) {
        e.attackAnimLeft = brawling ? left : 0;
        view.update([e], 1, cellToWorld, 0.033);
        deep = Math.max(deep, forwardOf());
      }
      return deep;
    };
    const control = deepestOver(false);
    const brawl = deepestOver(true);
    expect(control, '대조군이 제자리걸음조차 안 한다 — 이 계약이 공허하다')
      .toBeGreaterThan(still + 0.05);
    expect(brawl - control, `난투 ${brawl.toFixed(4)} · 대조 ${control.toFixed(4)} · 정지 ${still.toFixed(4)}`)
      .toBeGreaterThan(0.1);
  });

  /**
   * 문 앞에는 홍수 웨이브에서 열몇 마리가 **동시에** 선다(s1 w31 = 57마리).
   * 위상이 같으면 대열이 한 몸처럼 내려쳐 "무리"가 아니라 "한 덩어리"로 읽힌다.
   * 지금 그 흩어짐을 만드는 것은 **각자의 한 입 쿨다운**이다(도착 틱이 제각각이므로).
   */
  it('한 입 시각이 다른 개체는 동작 위상도 갈린다 (대열이 한 몸으로 안 움직인다)', () => {
    const key = enemyGeoKeyOf('blade');
    const foes = [51, 52, 53, 54, 55, 56].map((id, i) =>
      enemy({ id, defId: 'blade', x: 9 + i * 0.4, prevX: 9 + i * 0.4, dist: 12, gateTicks: 4 }),
    );
    // 첫 프레임에 주기를 관측시키고, 그 뒤 도착 틱이 다른 것처럼 쿨다운을 흩는다
    for (const f of foes) f.gateBiteCdLeft = 60;
    view.update(foes, 1, cellToWorld, 0.033);
    foes.forEach((f, i) => { f.gateBiteCdLeft = 60 - i * 10; });
    view.update(foes, 1, cellToWorld, 0.033);
    const ps = foes.map((_, i) => atkOf(view, key, i).p);
    expect(Math.max(...ps) - Math.min(...ps), `위상 ${ps.map((v) => v.toFixed(3)).join(' ')}`)
      .toBeGreaterThan(0.4);
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
