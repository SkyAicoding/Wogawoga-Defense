/**
 * 타워 그리기 예산 — **타워 수가 드로우콜에 실리지 않는다.**
 *
 * ── 이 파일이 지키는 주장 ──────────────────────────────────────────────────
 * 예전엔 타워 1기 = 정확히 +3콜(몸체 컬러 + 몸체 그림자 + action)이고 상한이 없었다.
 * 건설 가능 칸이 판당 124~152개라 예산 90콜이 **18기에서 깨졌고**, 안 깨지는 유일한
 * 이유가 골드였다. 지금은 (종,티어)가 몇 가지든 `BatchedMesh` 묶음 여섯이 전부라
 * **드로우콜에 구조적 상한**이 있다.
 *
 * ⚠ 이 잣대는 씬 그래프다(WebGL 없이 THREE 객체만 본다 — drawcount.ts 헤더).
 *   절대값은 실제 프레임보다 작다. 실제 렌더러 실측(크로미움 swiftshader 1280×800,
 *   `renderer.info.render`)은 전종섞기 기준:
 *     전  0기 10콜 · 4기 22 · 12기 46 · 24기 82 · 40기 130   (= 10 + 3n, 상한 없음)
 *     후  0기 10콜 · 4기 14 · 12기 14 · 24기 14 · 40기 14   (= 10 + 4, 상수)
 *   삼각형은 두 표가 **한 자리도 다르지 않다** — 묶기가 정점을 늘리지 않는다는 증거다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { build } from '@/render/stage3d';
import { ALL_TOWER_IDS, STAGES } from '@/data';
import type { TowerId } from '@/data/types';
import { buildTower } from '@/render/meshlib/towers';
import { drawables, forEachDrawn } from './drawcount';

const Q = { shadows: true, particles: 1, antialias: true, dpr: 2 } as never;
const IDS = ALL_TOWER_IDS as readonly TowerId[];

/** 겹치지 않게 흩어 놓을 셀 — 드로우콜은 좌표와 무관하므로 격자면 충분하다 */
function cellOf(i: number): { x: number; z: number } {
  return { x: 2 + (i % 9), z: 2 + Math.floor(i / 9) };
}

/** n기를 세우고 몇 프레임 돌린 씬 */
function scene(n: number, mode: 'same' | 'mixed' = 'mixed', frames = 3) {
  const s3 = build(STAGES[0]!, Q);
  for (let i = 0; i < n; i++) {
    const c = cellOf(i);
    const defId = mode === 'same' ? 'spear' : IDS[i % IDS.length]!;
    const tier = mode === 'same' ? 0 : Math.floor(i / IDS.length) % 5;
    s3.towers.add(i, defId, tier, c.x, c.z);
  }
  // 예열 슬롯을 끈 **전투 프레임**을 잰다 (warmup.test.ts 와 같은 전제)
  for (let i = 0; i < frames; i++) {
    s3.enemies.update([], 1, s3.cellToWorld.bind(s3), 0.016, []);
    s3.update(0.016);
  }
  return s3;
}

/** 이름이 접두사에 걸리는 메시가 이 프레임에 그리는 [콜, 삼각형] */
function byName(s: THREE.Object3D, name: string): { calls: number; tris: number } {
  let calls = 0;
  let tris = 0;
  forEachDrawn(s, (m, t, shadow) => {
    if (!m.name.startsWith(name)) return;
    calls += shadow ? 2 : 1;
    tris += shadow ? t * 2 : t;
  });
  return { calls, tris };
}

/**
 * **타워가 내는 몫만** 센다 (묶음 + 배치 고스트).
 * 한 씬 안에서 프레임 수를 달리해 비교할 때는 이쪽을 써야 한다 — 씬 전체를 세면
 * 기지 모닥불 연기가 0.111초에 켜지면서(stage3d.update) 파티클 메시가 +1콜로 끼어든다.
 */
function towerDraw(s: THREE.Object3D): { calls: number; tris: number } {
  return byName(s, 'tower');
}

/** 모델 하나가 프레임에 청구하는 삼각형 — 몸체는 그림자 패스에서 한 번 더 그려진다 */
function towerTris(id: TowerId, tier: number): number {
  const m = buildTower(id, tier);
  const t = (g: THREE.BufferGeometry | null): number =>
    g ? (g.getAttribute('position')?.count ?? 0) / 3 : 0;
  return (t(m.base) + t(m.head)) * 2 + t(m.action);
}

describe('타워 드로우콜 상한', () => {
  it('40기가 4기와 같은 콜 수다 (기당 증가 0)', () => {
    const a = drawables(scene(4).scene);
    const b = drawables(scene(40).scene);
    expect(b.calls, `4기 ${a.calls}콜 → 40기 ${b.calls}콜`).toBe(a.calls);
  });

  it('0기 대비 늘어나는 콜은 묶음 수(6) 이하다 — 몇 기를 세우든', () => {
    const base = drawables(scene(0).scene).calls;
    for (const n of [1, 4, 12, 24, 40]) {
      for (const mode of ['same', 'mixed'] as const) {
        const d = drawables(scene(n, mode).scene).calls;
        expect(d - base, `${mode} ${n}기: ${base} → ${d}콜`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('(종,티어) 40가지를 다 세워도 상한이 유지된다', () => {
    // 8종 × 5티어를 한 판에 전부 — 예전 구조에서 최악(=조합마다 메시가 갈리는) 경우다
    const s3 = build(STAGES[0]!, Q);
    let i = 0;
    for (const id of IDS) {
      for (let t = 0; t < 5; t++) {
        const c = cellOf(i);
        s3.towers.add(i++, id, t, c.x, c.z);
      }
    }
    for (let f = 0; f < 3; f++) {
      s3.enemies.update([], 1, s3.cellToWorld.bind(s3), 0.016, []);
      s3.update(0.016);
    }
    const base = drawables(scene(0).scene).calls;
    const d = drawables(s3.scene);
    expect(i).toBe(40);
    expect(d.calls - base, `40조합: ${base} → ${d.calls}콜`).toBeLessThanOrEqual(6);
  });

  it('삼각형은 기당 그대로 는다 — 묶기가 정점을 늘리지 않는다', () => {
    // 변형 마스킹(gait.ts)으로 티어를 한 지오메트리에 굽는 길도 있었지만, 타워는
    // 티어마다 색·부속이 통째로 달라 그 길에서 정점이 5배가 된다(한 종 5티어 합
    // 4,612~5,956삼각형 vs 한 티어 626~1,584). 여기서 그 회귀를 잡는다.
    const base = drawables(scene(0).scene).tris;
    const n = 24;
    let want = 0;
    for (let i = 0; i < n; i++) want += towerTris(IDS[i % IDS.length]!, Math.floor(i / IDS.length) % 5);
    const got = drawables(scene(n).scene).tris - base;
    expect(got, `24기 삼각형 실측 ${got} / 모델 합 ${want}`).toBe(Math.round(want));
  });
});

describe('그림자 규약 — 타워당 캐스터 1개', () => {
  it('몸체 묶음만 그림자를 드리운다', () => {
    const s3 = scene(16);
    const casters: string[] = [];
    forEachDrawn(s3.scene, (m, _t, shadow) => {
      if (shadow && m.name.startsWith('tower')) casters.push(m.name);
    });
    expect(casters).toEqual(['towerBody']);
  });

  it('모든 (종,티어) 모델이 base/head 중 정확히 하나만 갖는다', () => {
    // castShadow 는 묶음 단위다 — 한 타워가 base 와 head 를 둘 다 가지면 그 타워는
    // 그림자를 2장 굽는다(= 그 지오메트리가 프레임에서 2배로 청구된다).
    for (const id of IDS) {
      for (let t = 0; t < 5; t++) {
        const m = buildTower(id, t);
        const n = (m.base ? 1 : 0) + (m.head ? 1 : 0);
        expect(n, `${id} T${t + 1} 의 몸체 조각 ${n}개`).toBe(1);
      }
    }
  });
});

describe('피격 플래시', () => {
  it('빨간 몸체가 그려지고 원래 몸체는 그 자리에서 빠진다', () => {
    const s3 = scene(8);
    const before = byName(s3.scene, 'towerBody');
    expect(byName(s3.scene, 'towerHitBody').calls).toBe(0);

    s3.towers.hit(3);
    s3.update(0.016);
    const body = byName(s3.scene, 'towerBody');
    const hit = byName(s3.scene, 'towerHitBody');
    expect(hit.calls, '피격 묶음이 안 그려졌다').toBe(2); // 컬러 + 그림자
    // 맞은 한 기가 원래 묶음에서 빠졌다 — 안 빠지면 같은 타워가 두 번 그려진다
    expect(before.tris - body.tris, '맞은 타워가 원래 묶음에 그대로 남아 있다').toBe(hit.tris);
  });

  it('플래시가 끝나면 콜이 원래대로 돌아온다', () => {
    const s3 = scene(8);
    const before = towerDraw(s3.scene);
    s3.towers.hit(3);
    s3.update(0.016);
    const during = towerDraw(s3.scene);
    expect(during.calls - before.calls, '플래시 프레임').toBeLessThanOrEqual(3);
    expect(during.calls).toBeGreaterThan(before.calls);
    for (let i = 0; i < 10; i++) s3.update(0.016); // HIT_FLASH_TIME 0.07초 경과
    const after = towerDraw(s3.scene);
    expect(after.calls, '플래시가 끝났는데 묶음이 남아 있다').toBe(before.calls);
    expect(after.tris).toBe(before.tris);
  });
});

describe('인스턴스 수명', () => {
  it('짓고 부수기를 반복해도 인스턴스가 새지 않는다', () => {
    const s3 = build(STAGES[0]!, Q);
    for (let f = 0; f < 2; f++) {
      s3.enemies.update([], 1, s3.cellToWorld.bind(s3), 0.016, []);
      s3.update(0.016);
    }
    const empty = towerDraw(s3.scene);
    for (let round = 0; round < 20; round++) {
      for (let i = 0; i < 12; i++) {
        const c = cellOf(i);
        s3.towers.add(i, IDS[(i + round) % IDS.length]!, round % 5, c.x, c.z);
      }
      s3.towers.hit(2); // 피격 인스턴스까지 발급시킨 뒤 부순다
      s3.update(0.016);
      for (let i = 0; i < 12; i++) s3.towers.remove(i);
      s3.update(0.016);
    }
    const back = towerDraw(s3.scene);
    expect(back.calls, `빈 판 ${empty.calls}콜 → 240번 짓고 부순 뒤 ${back.calls}콜`).toBe(empty.calls);
    expect(back.tris).toBe(empty.tris);
  });

  it('업그레이드는 옛 티어를 남기지 않는다', () => {
    const s3 = build(STAGES[0]!, Q);
    s3.towers.add(1, 'catapult', 0, 4, 4);
    for (let f = 0; f < 2; f++) {
      s3.enemies.update([], 1, s3.cellToWorld.bind(s3), 0.016, []);
      s3.update(0.016);
    }
    const t1 = byName(s3.scene, 'towerBody').tris;
    s3.towers.upgrade(1, 4);
    s3.update(0.016);
    const t5 = byName(s3.scene, 'towerBody').tris;
    // T5 몸체 하나만 남아야 한다 — 옛 인스턴스가 남으면 둘의 합이 나온다
    expect(t5, `T1 ${t1} → T5 ${t5}`).toBe(towerTris('catapult', 4) - buildActionTris('catapult', 4));
  });
});

describe('연출이 살아 있다', () => {
  it('발리스타는 재장전 동안 볼트를 감춘다', () => {
    const s3 = build(STAGES[0]!, Q);
    s3.towers.add(1, 'ballista', 0, 4, 4);
    for (let f = 0; f < 2; f++) {
      s3.enemies.update([], 1, s3.cellToWorld.bind(s3), 0.016, []);
      s3.update(0.016);
    }
    const idle = byName(s3.scene, 'towerActionFlat').tris;
    expect(idle, '평시에 볼트가 안 그려진다').toBeGreaterThan(0);
    s3.towers.recoil(1);
    s3.update(0.016);
    expect(byName(s3.scene, 'towerActionFlat').tris, '발사 직후에도 볼트가 보인다').toBe(0);
    for (let i = 0; i < 12; i++) s3.update(0.016); // BOLT_HIDE 0.12초 경과
    expect(byName(s3.scene, 'towerActionFlat').tris, '볼트가 안 돌아왔다').toBe(idle);
  });

  it('배치 고스트는 배치 중에만 그려진다', () => {
    const s3 = scene(4);
    const before = towerDraw(s3.scene).calls;
    s3.towers.setGhost('ballista', 6, 6, true);
    s3.update(0.016);
    const withGhost = towerDraw(s3.scene).calls;
    expect(withGhost - before, '고스트가 안 그려졌다').toBe(2); // 몸체 + action, 그림자 없음
    s3.towers.clearGhost();
    s3.update(0.016);
    expect(towerDraw(s3.scene).calls, '고스트를 지웠는데 남아 있다').toBe(before);
  });
});

/** action 조각만의 삼각형 (towerTris 는 몸체 그림자까지 포함한다) */
function buildActionTris(id: TowerId, tier: number): number {
  const g = buildTower(id, tier).action;
  return g ? (g.getAttribute('position')?.count ?? 0) / 3 : 0;
}
