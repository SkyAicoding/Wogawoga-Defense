/**
 * **비전투 씬의 보스 예열 예산** — 예열은 전투에서만 켜져 있어야 한다.
 *
 * ── 무엇이 새고 있었나 ────────────────────────────────────────────────────────
 * `EnemyView` 생성자는 보스 종당 `BOSS_WARM_SLOTS` 개 메시를 만들어
 * `visible=true · frustumCulled=false` 로 씬에 붙인다. 보스 등장 프레임의 GL 프로그램
 * 링크 스톨을 전투 시작 프레임으로 앞당기는 **의도된** 장치다(enemyview.ts
 * BOSS_WARM_FRAMES 주석). 그런데 그걸 **끄는 코드가 `EnemyView.update()` 안에만** 있다.
 * 타이틀·로비 뒤에서 도는 디오라마 배경(game/app.ts `buildBackdrop`)은 적을 한 마리도
 * 안 그리므로 `Stage3D.update()` 만 돌고 `EnemyView.update()` 를 **한 번도 안 부른다** →
 * 예열 슬롯이 영영 안 꺼져 매 프레임 그려졌다.
 *
 * 실측(이 파일의 잣대, s1 정지 프레임): 18콜 / 32,417삼각형 중 예열 4메시가
 * **8콜(컬러 4 + 그림자 4) / 10,824삼각형** — 드로우콜의 44% · 삼각형의 33%.
 *
 * ── 이 파일이 잠그는 것 셋 ────────────────────────────────────────────────────
 *  1. 비전투 씬(`build(..., { combat: false })`)에는 보스 메시가 **아예 없다**
 *  2. 전투 씬은 **예열이 그대로 산다** — 첫 프레임에 실제로 그려지고,
 *     `frustumCulled=false` 여서 그림자 카메라 밖에서도 depth 머티리얼이 컴파일된다
 *  3. 배경 프레임의 드로우콜 예산
 *
 * ⚠ 기대값을 상수로 베끼지 않는다 — 전투 씬에서 **예열 메시를 되읽어** 델타를 만든다.
 *   (이 저장소가 세 번 당한 병이 "잣대가 재려는 것과 다른 것을 잰다"였다: CLAUDE.md)
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { build } from '@/render/stage3d';
import { STAGES } from '@/data';
import { flagsFor } from '@/render/quality';
import { BOSS_ENEMIES } from '@/render/meshlib/enemies';
import { drawables, forEachDrawn } from './drawcount';

/** 배경도 전투와 같은 품질 플래그로 선다 (app.ts 는 qm.flags 를 그대로 넘긴다) */
const Q = flagsFor('high');

/** 'enemies' 그룹에 붙은 **개별 Mesh** = 보스 (나머지는 전부 InstancedMesh) */
function bossMeshes(scene: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh & { isMesh?: boolean; isInstancedMesh?: boolean };
    if (m.isMesh !== true || m.isInstancedMesh === true) return;
    if (m.parent?.name === 'enemies') out.push(m);
  });
  return out;
}

/** 그 프레임에 실제로 그려지는 보스 메시 (visible 사슬 + 인스턴스 count 를 함께 본다) */
function drawnBosses(scene: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  forEachDrawn(scene, (m) => {
    const im = m as THREE.Mesh & { isInstancedMesh?: boolean };
    if (im.isInstancedMesh !== true && m.parent?.name === 'enemies') out.push(m);
  });
  return out;
}

function triCount(m: THREE.Mesh): number {
  const idx = m.geometry.getIndex();
  return (idx ? idx.count : (m.geometry.getAttribute('position')?.count ?? 0)) / 3;
}

const noop = (x: number, _z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, _z);

describe('비전투 씬 보스 예열', () => {
  /**
   * 회수량 그 자체. 기대 델타는 **전투 씬의 예열 메시를 되읽어** 만든다 —
   * 8콜/10,824삼각형을 여기 베껴 두면 보스 모델이 바뀌는 날 이 테스트가 거짓이 된다.
   */
  it('디오라마 배경은 예열 메시를 그리지 않는다 (전투 씬 대비 정확히 예열분만큼 가볍다)', () => {
    const combat = build(STAGES[0]!, Q); // 기본값 = 예열 켬
    const diorama = build(STAGES[0]!, Q, { combat: false });

    const warm = bossMeshes(combat.scene);
    // 보스 종 × 슬롯. 예열 자체가 사라지면 여기서 먼저 빨개진다.
    expect(warm.length, '전투 씬에 예열 슬롯이 있다').toBeGreaterThanOrEqual(BOSS_ENEMIES.size);
    expect(bossMeshes(diorama.scene), '배경에는 보스 메시가 아예 없다').toHaveLength(0);

    const expectCalls = warm.reduce((s, m) => s + (m.castShadow ? 2 : 1), 0);
    const expectTris = warm.reduce((s, m) => s + triCount(m) * (m.castShadow ? 2 : 1), 0);
    const a = drawables(combat.scene);
    const b = drawables(diorama.scene);
    expect(a.calls - b.calls, `예열 ${warm.length}메시의 드로우콜`).toBe(expectCalls);
    expect(a.tris - b.tris, '예열 메시의 삼각형').toBe(Math.round(expectTris));

    combat.dispose();
    diorama.dispose();
  });

  /**
   * 배경 루프(app.ts tick)는 `Stage3D.update()` 만 부른다 — `EnemyView.update()` 를
   * 안 부른다. 예열을 "만들어 두고 update 에서 끄는" 방식으로 되돌리면 이 테스트가
   * 그 자리에서 빨개진다.
   */
  it('배경 루프를 아무리 돌려도 보스가 그려지지 않는다', () => {
    const diorama = build(STAGES[0]!, Q, { combat: false });
    for (let i = 0; i < 30; i++) diorama.update(0.016);
    expect(drawnBosses(diorama.scene)).toHaveLength(0);
    diorama.dispose();
  });

  /**
   * **예열은 전투에서 그대로 살아 있어야 한다.** 이 회수의 전제다 —
   * 없애 버리면 보스 등장 프레임에 셰이더 링크 스톨이 돌아온다
   * (실측: 예열을 끈 전투 씬에서 보스가 처음 뜨는 프레임에 `linkProgram` 2회).
   */
  it('전투 씬은 예열 슬롯을 첫 프레임에 실제로 그리고, 끝나면 끈다', () => {
    const s3 = build(STAGES[0]!, Q);
    const warm = bossMeshes(s3.scene);
    expect(warm.length).toBeGreaterThanOrEqual(BOSS_ENEMIES.size);
    for (const m of warm) {
      // 컬링을 끄지 않으면 그림자 카메라 밖이라 depth 머티리얼이 컴파일되지 않는다
      // (enemyview.ts 생성자 주석) — 예열의 절반이 조용히 빠지는 자리다
      expect(m.frustumCulled, '예열 중에는 절두체 컬링을 끈다').toBe(false);
      expect(m.castShadow, '보스는 그림자 캐스터 (UNIT_SHADOW 예외)').toBe(true);
    }
    // 첫 프레임: 예열 슬롯이 전부 렌더 리스트에 오른다
    s3.enemies.update([], 1, noop, 0.016, []);
    expect(drawnBosses(s3.scene), '예열 프레임에 실제로 그려진다').toHaveLength(warm.length);
    // 예열이 끝나면 전부 꺼지고 컬링이 복구된다
    for (let i = 0; i < 4; i++) s3.enemies.update([], 1, noop, 0.016, []);
    expect(drawnBosses(s3.scene), '예열이 끝나면 안 그린다').toHaveLength(0);
    for (const m of warm) expect(m.frustumCulled, '예열 끝 — 컬링 복구').toBe(true);
    s3.dispose();
  });

  /**
   * **배경 프레임 드로우콜 예산.**
   * 무엇을 재는 프레임인가: 타이틀·로비 뒤 디오라마 정지 프레임 — 적 0 · 타워 0 ·
   * 마을 기본 레벨, 곧 이 게임에서 **가장 가벼운 프레임**이다.
   * 실측(이 잣대): s1 10콜 · s2~s6 11콜 (예열 회수 전에는 18 · 19였다).
   * 문턱 14 = 실측 11 + 여유 3. 실측에 딱 붙이지 않는 이유는 소품/장식 병합이
   * 바이옴마다 메시를 한둘 더 낼 수 있어서다. 예열이 돌아오면 18~19라 그 자리에서 잡힌다.
   */
  it('여섯 판 전부 배경 정지 프레임이 14콜 이하다', () => {
    for (const stage of STAGES) {
      const s3 = build(stage, Q, { combat: false });
      for (let i = 0; i < 6; i++) s3.update(0.016);
      const d = drawables(s3.scene);
      expect(d.calls, `s${stage.id} ${stage.biome} 배경 ${d.calls}콜 / ${d.tris}삼각형`)
        .toBeLessThanOrEqual(14);
      s3.dispose();
    }
  });
});
