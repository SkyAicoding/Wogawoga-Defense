/**
 * **투사체가 티어를 따라간다** — 사용자 지적으로 생긴 계약:
 *   > "Lv 이 올라가면 (강화) 탑은 커지고 좋아지는데 탑에서 날아가는 무기는 동일한거
 *   >  같아. 이 무기도 확실히 업그레이드를 시켜줘. 강화된 만큼 날아가는 무기도
 *   >  머 멋지고 화려하게"
 *
 * 잠그는 것 넷:
 *  ① **T1 은 옛 그림 그대로다** — 배수 1, 색 흰색. 강화 안 한 사람에게는 아무것도 안 바뀐다.
 *  ② 티어가 오르면 **길어지고 굵어진다**, 그리고 길이가 굵기보다 더 는다
 *     (같은 비율로 키우면 "큰 돌"이고, 앞으로 길어져야 "꿰뚫는 것"으로 읽힌다).
 *  ③ 티어가 오르면 **1을 넘어 밝아진다**(= 발광). `instanceColor` 는 정점색에 곱해지므로
 *     1보다 큰 값이 과노출이 되고 ACES 톤매핑이 그걸 빛으로 굴린다.
 *  ④ ⚠⚠ **드로우콜이 안 는다.** 티어별로 지오메트리를 나누면 메시가 5배가 되는데,
 *     이 저장소의 전투 예산은 90콜이고 그 천장을 만드는 것이 이미 타워 수다.
 *     그래서 변화는 전부 인스턴스별(행렬·색)이어야 하고, 이 항목이 그것을 못 박는다.
 *
 * ⚠ 값을 **되읽는다** — 상수를 베끼지 않고 실제 인스턴스 행렬·색 버퍼에서 꺼낸다.
 *   식을 베끼면 뷰만 고치는 회귀가 조용히 통과한다(gatepose.test.ts 와 같은 규약).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ProjectileView } from '@/render/views/projectileview';
import type { ProjectileState } from '@/data/types';

const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

function shot(tier: number): ProjectileState {
  return {
    id: 1,
    kind: 'homing',
    towerDefId: 'spear',
    tier,
    x: 3, y: 0.6, z: 3,
    prevX: 2, prevY: 0.6, prevZ: 3,
    targetId: 9,
    targetX: 6,
    targetZ: 3,
    flightTicks: 0,
    elapsedTicks: 0,
    startX: 2,
    startZ: 3,
    arcHeight: 0,
    speed: 13,
    dmg: 12,
    targetFlying: false,
    alive: true,
  };
}

/** 한 프레임 그리고 그 인스턴스의 스케일·색을 **버퍼에서 되읽는다** */
function draw(tier: number): { sx: number; sy: number; col: THREE.Color; draws: number } {
  const scene = new THREE.Scene();
  const view = new ProjectileView(scene, cellToWorld);
  view.update([shot(tier)], 0.5, 1 / 60);
  const inner = view as unknown as { meshes: Map<string, THREE.InstancedMesh> };
  const mesh = inner.meshes.get('spear')!;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(0, m);
  const scl = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scl);
  const col = new THREE.Color();
  mesh.getColorAt(0, col);
  // 그려지는 메시 수 = 드로우콜 수 (count > 0 인 것만 실제로 나간다)
  let draws = 0;
  for (const mm of inner.meshes.values()) if (mm.count > 0) draws++;
  view.dispose();
  return { sx: scl.x, sy: scl.y, col, draws };
}

describe('투사체 티어 연출', () => {
  it('① T1 은 옛 그림 그대로다 (배수 1 · 흰색)', () => {
    const t1 = draw(0);
    expect(t1.sx, 'T1 길이 배수').toBeCloseTo(1, 6);
    expect(t1.sy, 'T1 굵기 배수').toBeCloseTo(1, 6);
    expect(t1.col.r, 'T1 색 r').toBeCloseTo(1, 5);
    expect(t1.col.g, 'T1 색 g').toBeCloseTo(1, 5);
    expect(t1.col.b, 'T1 색 b').toBeCloseTo(1, 5);
  });

  it('② 티어가 오르면 길어지고 굵어진다 — 길이가 굵기보다 더 큰다', () => {
    const s = [0, 1, 2, 3, 4].map((t) => draw(t));
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.sx, `T${i + 1} 길이가 안 늘었다`).toBeGreaterThan(s[i - 1]!.sx);
      expect(s[i]!.sy, `T${i + 1} 굵기가 안 늘었다`).toBeGreaterThan(s[i - 1]!.sy);
    }
    // 만렙이 눈에 띄게 커야 한다 — "확실히 업그레이드" 가 요구였다
    expect(s[4]!.sx, `T5 길이 ${s[4]!.sx.toFixed(3)}`).toBeGreaterThan(1.5);
    // 그리고 **길쭉해진다**: 길이 증가분이 굵기 증가분보다 크다
    expect(s[4]!.sx - 1, '길이가 굵기보다 더 늘어야 꿰뚫는 것으로 읽힌다')
      .toBeGreaterThan((s[4]!.sy - 1) * 1.3);
  });

  it('③ 티어가 오르면 1을 넘어 밝아진다 (= 발광)', () => {
    const s = [0, 1, 2, 3, 4].map((t) => draw(t));
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.col.r, `T${i + 1} 밝기가 안 올랐다`).toBeGreaterThan(s[i - 1]!.col.r);
    }
    expect(s[4]!.col.r, `T5 r ${s[4]!.col.r.toFixed(3)}`).toBeGreaterThan(1.5);
    // 흰색으로만 밝히면 바래 보인다 — 따뜻한 쪽이 남아야 "달궈진 것"으로 읽힌다
    expect(s[4]!.col.r, 'T5 가 따뜻한 쪽으로 안 밀렸다').toBeGreaterThan(s[4]!.col.b);
  });

  it('④ 티어가 달라도 드로우콜은 그대로다 (지오메트리를 나누면 5배가 된다)', () => {
    for (const t of [0, 1, 2, 3, 4]) {
      expect(draw(t).draws, `T${t + 1} 드로우콜`).toBe(1);
    }
  });
});
