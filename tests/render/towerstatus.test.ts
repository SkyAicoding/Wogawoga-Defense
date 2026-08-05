/**
 * 타워 지속 상태 표식 회귀 테스트 — **지속 신호**가 실제로 남는지 + 드로우콜 0 증가.
 *
 * 잠그는 것:
 *  · 파괴 잔해가 그 칸에 남고, 재건설/소품 제거로만 사라진다 (2초짜리 파티클과 다르다)
 *  · 침묵 중인 타워에만 룬이 뜬다 (걸리는 순간 한 프레임이 아니라 지속)
 *  · 표식이 **체력바와 같은 InstancedMesh 하나**에 실린다 (오버레이 계층 = 드로우콜 1)
 * WebGL 없이 THREE 오브젝트 상태만 본다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TowerState } from '@/data/types';
import { HealthBarView } from '@/render/views/healthbars';
import { MARK_RUBBLE, MARK_SILENCE, TowerMarksView } from '@/render/views/towerstatus';

const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

function tower(o: Partial<TowerState> = {}): TowerState {
  return {
    id: 1,
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

describe('TowerMarksView — 지속 상태 표식', () => {
  it('아무 일도 없으면 표식이 없다', () => {
    const v = new TowerMarksView();
    v.setTowers([tower()]);
    v.tick(0.1);
    expect(v.marks().length).toBe(0);
    v.dispose();
  });

  it('파괴된 칸에 잔해가 남고, 시간이 지나도 사라지지 않는다', () => {
    const v = new TowerMarksView();
    v.setTowers([]);
    v.markDestroyed(3, 4, 2);
    expect(v.marks().length).toBe(1);
    expect(v.marks()[0]!.kind).toBe(MARK_RUBBLE);
    expect(v.hasRubble(3, 4)).toBe(true);
    // 30초가 지나도 남아 있어야 한다 (파티클과 달리 '지속' 신호다)
    for (let i = 0; i < 300; i++) v.tick(0.1);
    expect(v.marks().length, '30초 뒤에도 잔해가 남는다').toBe(1);
    // 정착도는 1에서 멈춘다 (계속 커지면 셰이더 위상이 발산한다)
    expect(v.marks()[0]!.phase).toBe(1);
    v.dispose();
  });

  it('그 칸에 다시 지으면(또는 소품을 치우면) 잔해가 사라진다', () => {
    const v = new TowerMarksView();
    v.setTowers([]);
    v.markDestroyed(3, 4, 0);
    v.markDestroyed(7, 2, 1);
    expect(v.marks().length).toBe(2);
    v.clearCell(3, 4);
    expect(v.marks().length).toBe(1);
    expect(v.hasRubble(3, 4)).toBe(false);
    expect(v.hasRubble(7, 2)).toBe(true);
    v.dispose();
  });

  it('같은 칸이 두 번 부서져도 잔해는 하나다', () => {
    const v = new TowerMarksView();
    v.setTowers([]);
    v.markDestroyed(5, 5, 0);
    v.markDestroyed(5, 5, 3);
    expect(v.marks().length).toBe(1);
    v.dispose();
  });

  it('티어가 높을수록 잔해가 크다 (무엇을 잃었는지가 크기로도 읽힌다)', () => {
    const v = new TowerMarksView();
    v.setTowers([]);
    v.markDestroyed(1, 1, 0);
    v.markDestroyed(2, 2, 4);
    const [a, b] = v.marks();
    expect(b!.size).toBeGreaterThan(a!.size);
    v.dispose();
  });

  it('침묵 중인 타워에만 룬이 뜨고, 풀리면 사라진다', () => {
    const v = new TowerMarksView();
    const a = tower({ id: 1, cellX: 1, cellZ: 1, silenceLeft: 20 });
    const b = tower({ id: 2, cellX: 2, cellZ: 2, silenceLeft: 0 });
    v.setTowers([a, b]);
    expect(v.marks().length, '침묵 1기만').toBe(1);
    expect(v.marks()[0]!.kind).toBe(MARK_SILENCE);
    a.silenceLeft = 0;
    expect(v.marks().length, '침묵이 풀리면 사라진다').toBe(0);
    b.silenceLeft = 5;
    expect(v.marks().length).toBe(1);
    v.dispose();
  });

  it('표식은 체력바와 같은 메시에 실린다 (오버레이 계층 = 드로우콜 1)', () => {
    const scene = new THREE.Scene();
    const bars = new HealthBarView(scene);
    const meshes = scene.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length, '오버레이 메시는 하나여야 한다').toBe(1);
    const mesh = meshes[0] as THREE.InstancedMesh;

    const v = new TowerMarksView();
    const t = tower({ hp: 100, silenceLeft: 30 });
    v.setTowers([t]);
    v.markDestroyed(9, 9, 1);
    bars.update([], [t], 1, cellToWorld, v.marks());
    // 타워 체력바 1 + 잔해 1 + 룬 1 = 인스턴스 3, 메시는 여전히 1개
    expect(mesh.count).toBe(3);
    expect(scene.children.filter((c) => c instanceof THREE.InstancedMesh).length).toBe(1);
    const kind = mesh.geometry.getAttribute('barKind');
    expect([kind.getX(0), kind.getX(1), kind.getX(2)]).toEqual([1, MARK_RUBBLE, MARK_SILENCE]);
    v.dispose();
    bars.dispose();
  });

  it('표식이 없으면 인스턴스도 늘지 않는다 (평소 드로우콜 0)', () => {
    const scene = new THREE.Scene();
    const bars = new HealthBarView(scene);
    const mesh = scene.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const v = new TowerMarksView();
    v.setTowers([tower()]); // 만피 + 침묵 없음
    bars.update([], [tower()], 1, cellToWorld, v.marks());
    expect(mesh.count, 'InstancedMesh count 0 = draw call 0').toBe(0);
    v.dispose();
    bars.dispose();
  });

  it('용량을 넘겨도 안전하다', () => {
    const scene = new THREE.Scene();
    const bars = new HealthBarView(scene);
    const mesh = scene.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const v = new TowerMarksView();
    const towers: TowerState[] = [];
    for (let i = 0; i < 200; i++) {
      towers.push(tower({ id: i + 1, cellX: i % 20, cellZ: Math.floor(i / 20), hp: 1, silenceLeft: 10 }));
    }
    v.setTowers(towers);
    for (let i = 0; i < 200; i++) v.markDestroyed(i, i, 0);
    expect(() => bars.update([], towers, 1, cellToWorld, v.marks())).not.toThrow();
    expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
    v.dispose();
    bars.dispose();
  });
});
