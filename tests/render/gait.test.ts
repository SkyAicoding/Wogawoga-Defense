/**
 * 보행 리그 회귀 테스트.
 * 셰이더가 하는 정점 변형을 CPU에서 그대로 재현해 **발이 지면을 뚫지 않는지** 검사한다.
 * 2단계에서 나머지 종에 리그를 붙일 때 피벗/위상을 잘못 잡으면 여기서 걸린다.
 */
import { describe, expect, it } from 'vitest';
import { ALL_ENEMY_IDS, buildEnemy, enemyRig } from '@/render/meshlib/enemies';
import { LIMB_ATTR, groundLiftAt, type EnemyRig } from '@/render/meshlib/gait';

/** 셰이더 wgdPos 와 동일한 로드리게스 회전 + 스윙 들어올림 */
function limbY(rig: EnemyRig, li: number, x: number, y: number, z: number, gait: number): number {
  const s = rig.limbs[li];
  if (!s) return y;
  const ph = gait + s.phase;
  const ang = s.amp * Math.sin(ph) + s.amp2 * Math.sin(2 * ph);
  const [ax, ay, az] = s.axis;
  const px = x - s.pivot[0];
  const py = y - s.pivot[1];
  const pz = z - s.pivot[2];
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const dot = ax * px + ay * py + az * pz;
  const cy = az * px - ax * pz;
  return s.pivot[1] + py * c + cy * sn + ay * dot * (1 - c) + s.lift * Math.max(0, Math.cos(ph));
}

describe('보행 리그', () => {
  it('12종 전부 리그가 붙어 있다', () => {
    for (const id of ALL_ENEMY_IDS) {
      const rig = enemyRig(id);
      expect(rig.limbs.length, id).toBeGreaterThan(0);
      expect(rig.gaitPerDist, id).toBeGreaterThan(0);
      expect(buildEnemy(id).getAttribute(LIMB_ATTR), id).toBeTruthy();
    }
  });

  /**
   * 접지 테이블(groundLift)은 t = |sin(gait)| 로 조회되고, 테이블은 각도를 amp·t 로 보고 굽는다.
   * 따라서 ground 그룹의 실제 각도가 항상 ±amp·sin(gait) 여야 표가 유효하다 —
   * 위상이 π의 배수가 아니거나 2차 진폭(amp2)이 섞이면 표가 과소평가되어 발이 파묻힌다.
   */
  it('지면에 닿는 그룹은 위상이 π의 배수이고 2차 모션이 없다', () => {
    for (const id of ALL_ENEMY_IDS) {
      for (const l of enemyRig(id).limbs) {
        if (!l.ground) continue;
        const k = l.phase / Math.PI;
        expect(Math.abs(k - Math.round(k)), `${id} ground 그룹 위상`).toBeLessThan(1e-6);
        expect(l.amp2, `${id} ground 그룹 amp2`).toBe(0);
      }
    }
  });

  it('좌우 다리는 서로 다른 그룹이고 위상이 π 차이다', () => {
    const rig = enemyRig('raptor');
    const legs = rig.limbs.filter((l) => l.ground);
    expect(legs.length % 2).toBe(0);
    for (let i = 0; i < legs.length; i += 2) {
      const l = legs[i]!;
      const r = legs[i + 1]!;
      expect(Math.abs(((r.phase - l.phase) % (Math.PI * 2)) - Math.PI)).toBeLessThan(1e-6);
      expect(r.pivot[2]).toBeCloseTo(-l.pivot[2], 6); // mirZ 와 짝이 맞아야 한다
    }
  });

  it('보행 한 주기 내내 발이 지면을 뚫지 않고 디딤발은 지면에 닿는다', () => {
    for (const id of ALL_ENEMY_IDS) {
      const rig = enemyRig(id);
      if (rig.groundLift.length === 0) continue; // 지상 다리 없는 종(비행/미태깅)
      const geo = buildEnemy(id);
      const limb = geo.getAttribute(LIMB_ATTR)!;
      const pos = geo.getAttribute('position')!;
      // 모델이 정지 자세에서 이미 갖고 있는 파묻힘은 리그 책임이 아니다
      let rest = 0;
      for (let i = 0; i < pos.count; i++) rest = Math.min(rest, pos.getY(i));

      let under = 0;
      let touch = Infinity;
      for (let s = 0; s < 64; s++) {
        const g = (s / 64) * Math.PI * 2;
        const body = groundLiftAt(rig, Math.abs(Math.sin(g)));
        let min = Infinity;
        for (let i = 0; i < pos.count; i++) {
          const li = Math.round(limb.getX(i)) - 1;
          const y =
            li < 0 ? pos.getY(i) : limbY(rig, li, pos.getX(i), pos.getY(i), pos.getZ(i), g);
          if (y + body < min) min = y + body;
        }
        under = Math.min(under, min);
        touch = Math.min(touch, Math.abs(min - rest));
      }
      expect(under, `${id} 발이 지면을 뚫음`).toBeGreaterThan(rest - 0.0015);
      expect(touch, `${id} 발이 공중에 뜸`).toBeLessThan(0.02);
    }
  });
});
