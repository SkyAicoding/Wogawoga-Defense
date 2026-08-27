/**
 * **투사체가 티어를 따라간다** — 사용자 지적으로 생긴 계약:
 *   > "Lv 이 올라가면 (강화) 탑은 커지고 좋아지는데 탑에서 날아가는 무기는 동일한거
 *   >  같아. 이 무기도 확실히 업그레이드를 시켜줘. 강화된 만큼 날아가는 무기도
 *   >  머 멋지고 화려하게"
 *
 * 그리고 두 번째 요구가 뒤이어 왔다:
 *   > "종류마다 다른 색 줘 창은 붉게 얼음은 푸르게"
 * 그래서 축이 둘이다 — **종은 색조, 티어는 밝기**. 최종 색 = 종별 색조 × 티어 밝기.
 * 두 축을 한 값에 섞으면 얼음이 강화될수록 붉어진다(= 티어를 올릴수록 종을 못 알아본다).
 *
 * 잠그는 것 여섯:
 *  ① **T1 은 그 종의 색이다** — 배수 1, 색은 종별 색조. ⚠ 이 항목은 **뒤집혔다**:
 *     옛 판본은 "T1 은 흰색"이었고 그것이 위 두 번째 요구와 정면으로 어긋난다.
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
import {
  PROJECTILE_TOWERS,
  buildProjectile,
  projectileTint,
} from '@/render/meshlib/projectiles';
import { ALL_TOWER_IDS, TOWER_DEFS } from '@/data';
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
  it('① T1 은 크기가 안 변하고, 색은 그 종의 색조다', () => {
    const t1 = draw(0);
    expect(t1.sx, 'T1 길이 배수').toBeCloseTo(1, 6);
    expect(t1.sy, 'T1 굵기 배수').toBeCloseTo(1, 6);
    // 색은 원본에서 되읽는다 — 식을 베끼지 않는다
    const want = projectileTint('spear');
    expect(t1.col.r, 'T1 색조 r').toBeCloseTo(want[0], 5);
    expect(t1.col.g, 'T1 색조 g').toBeCloseTo(want[1], 5);
    expect(t1.col.b, 'T1 색조 b').toBeCloseTo(want[2], 5);
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

  it('③ 티어가 오르면 밝아지되 **색조는 안 변한다** (강화해도 종을 알아본다)', () => {
    const s = [0, 1, 2, 3, 4].map((t) => draw(t));
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.col.r, `T${i + 1} 밝기가 안 올랐다`).toBeGreaterThan(s[i - 1]!.col.r);
    }
    expect(s[4]!.col.r, `T5 r ${s[4]!.col.r.toFixed(3)}`).toBeGreaterThan(1.5);
    /*
     * ⚠ **채널 비율이 티어와 무관하게 같아야 한다.** 밝기와 색조를 한 값에 섞으면
     *   (옛 판본의 "따뜻한 쪽으로 민다") 얼음이 강화될수록 붉어져 종을 못 알아본다.
     *   비율로 재는 이유가 그것이다 — 곱셈이면 비율이 보존되고, 덧셈이면 안 된다.
     */
    const ratio = (c: THREE.Color): number => c.r / c.b;
    for (let i = 1; i < s.length; i++) {
      expect(ratio(s[i]!.col), `T${i + 1} 에서 색조가 틀어졌다`).toBeCloseTo(ratio(s[0]!.col), 5);
    }
  });

  /**
   * ⑤ **사용자가 이름 대서 지정한 둘** — 창은 붉게, 얼음은 푸르게.
   * 요구 원문을 그대로 계약으로 만든다: 창은 붉은 채널이 가장 크고, 얼음은 푸른 채널이
   * 가장 커야 한다. 값이 아니라 **부등식**으로 잠그는 이유는 색을 다듬을 여지를 남기되
   * "붉다/푸르다"라는 뜻은 못 바꾸게 하기 위해서다.
   */
  it('⑤ 창은 붉고 얼음은 푸르다 (사용자가 이름 대서 지정했다)', () => {
    const spear = projectileTint('spear');
    expect(spear[0], `창 ${spear.map((v) => v.toFixed(2)).join()}`).toBeGreaterThan(spear[1]!);
    expect(spear[0], '창이 붉지 않다').toBeGreaterThan(spear[2]!);
    const frost = projectileTint('frost');
    expect(frost[2], `얼음 ${frost.map((v) => v.toFixed(2)).join()}`).toBeGreaterThan(frost[0]!);
    expect(frost[2], '얼음이 푸르지 않다').toBeGreaterThan(frost[1]!);
  });

  /**
   * ⑥ **쏘는 종은 전부 메시가 있다.** 2026-08-27 에 `rattletrap`·`shockstake` 가
   * `BUILDERS` 에 없어서 **투사체가 화면에 아예 없었다**(sim 은 정상으로 쐈고 피해도
   * 들어갔다 — 그림만 없었다). `ProjectileView` 가 메시를 못 찾으면 조용히 건너뛰므로
   * 콘솔에도 아무것도 안 남는다. 그래서 여기서 못 박는다.
   */
  it('⑥ 투사체를 쏘는 종은 전부 그릴 메시가 있다 (조용히 안 보이던 결함)', () => {
    const firing = ALL_TOWER_IDS.filter((id) => {
      const k = TOWER_DEFS[id].attackKind;
      return k === 'homing' || k === 'ballistic';
    });
    for (const id of firing) {
      expect(buildProjectile(id), `${id} 투사체 메시가 없다 — 화면에서 사라진다`).not.toBeNull();
      expect(PROJECTILE_TOWERS, `${id} 가 뷰 준비 목록에 없다`).toContain(id);
    }
    /*
     * 공허성 가드 — 실측 **7종**이다(spear · catapult · frost · poison · ballista ·
     * rattletrap · shockstake). `brazier` 는 `PROJECTILE_TOWERS` 에 있지만 `attackKind`
     * 가 `aura` 라 이 목록에는 안 든다: 그 메시는 **습격대 투척물**이 빌려 쓴다
     * (`RAID_TINTED`). 곧 두 목록의 뜻이 다르고, 그래서 길이도 다르다.
     * ⚠ 이 자리에 걸렸던 적이 있다 — 8 로 적었다가 실측 7 에 부딪혔다.
     */
    expect(firing.length, '쏘는 종을 못 찾았다 — 이 계약이 공허하다').toBe(7);
    for (const id of ['rattletrap', 'shockstake'] as const) {
      expect(firing, `${id} 가 쏘는 종에서 빠졌다`).toContain(id);
    }
  });

  it('④ 티어가 달라도 드로우콜은 그대로다 (지오메트리를 나누면 5배가 된다)', () => {
    for (const t of [0, 1, 2, 3, 4]) {
      expect(draw(t).draws, `T${t + 1} 드로우콜`).toBe(1);
    }
  });
});
