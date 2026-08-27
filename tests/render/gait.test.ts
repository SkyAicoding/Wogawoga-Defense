/**
 * 보행 리그 회귀 테스트.
 * 셰이더가 하는 정점 변형을 CPU에서 그대로 재현해 **발이 지면을 뚫지 않는지** 검사한다.
 * 종을 추가할 때 피벗/위상을 잘못 잡으면 여기서 걸린다.
 * 부족 습격대 4종은 지오메트리를 공유하므로 무기(팔에 매달린 파트)의 지면 충돌까지 함께 검사된다.
 * **아군 4종은 5단계에서 지오메트리가 갈렸으므로 따로 돈다** — 아래 마지막 it 참조.
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import {
  ALL_ENEMY_IDS,
  allyRig,
  allyVariant,
  buildAlly,
  buildAllySolo,
  buildEnemy,
  enemyRig,
} from '@/render/meshlib/enemies';
import { ALL_ALLY_IDS } from '@/data/allies';
import { LIMB_ATTR, VARIANT_ATTR, groundLiftAt, type EnemyRig } from '@/render/meshlib/gait';

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
  it('16종 전부 리그가 붙어 있다', () => {
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

  /**
   * 아군 3종도 걷는다.
   *
   * ⚠ 예전 주석은 "위의 지면 관통 검사가 아군 장비까지 함께 본다"고 적혀 있었는데,
   * 그것은 아군 변형이 습격대 지오메트리에 5~7로 구워지던 **3단계의 사실**이다.
   * 5단계에서 갈린 뒤로는 거짓이라 아군 접지를 보는 it 을 따로 뒀다(이 파일 마지막).
   * 여기서 잠그는 건 그게 아니라 **단품 굽기 경로**다 —
   * buildAllySolo는 갤러리용 별도 빌드라, 새 아군 종을 리그 없이 추가해도 위 검사는
   * 통과해 버린다. 사지 그룹이 실제로 칠해졌는지를 종마다 확인한다.
   */
  it('아군 3종에도 보행 리그가 붙어 있다 (미끄러지며 이동하지 않는다)', () => {
    expect(ALL_ALLY_IDS.length).toBeGreaterThan(0);
    for (const id of ALL_ALLY_IDS) {
      const limb = buildAllySolo(id).getAttribute(LIMB_ATTR);
      expect(limb, `${id} 사지 어트리뷰트`).toBeTruthy();
      const groups = new Set<number>();
      for (let i = 0; i < limb!.count; i++) groups.add(Math.round(limb!.getX(i)));
      groups.delete(0); // 0 = 몸통(고정)
      // 다리 2 + 팔 2 + 머리 = 최소 5그룹
      expect(groups.size, `${id} 리그 그룹 수`).toBeGreaterThanOrEqual(5);
    }
    /**
     * 5단계에서 아군을 별도 지오메트리로 갈랐으므로 리그도 **다른 객체**다.
     * 하지만 몸통 코드(raiderBody)가 같으니 사지 구성·보폭은 완전히 같아야 한다 —
     * 여기가 갈리면 아군만 다른 보폭으로 걸어 미끄러진다.
     * (접지 보정 표는 실제 구운 버텍스에서 뽑히므로 장비 차이만큼 달라질 수 있어 제외)
     */
    const ar = allyRig();
    const er = enemyRig('blade');
    expect(ar.gaitPerDist).toBeCloseTo(er.gaitPerDist, 6);
    expect(ar.limbs.length).toBe(er.limbs.length);
    for (let i = 0; i < ar.limbs.length; i++) {
      expect(ar.limbs[i], `limb ${i}`).toEqual(er.limbs[i]);
    }
  });

  /** 한 지오메트리의 보행 한 주기를 훑어 (최저점, 디딤 접지) 를 낸다 */
  function walkExtent(
    rig: EnemyRig,
    geo: THREE.BufferGeometry,
  ): { under: number; touch: number; rest: number } {
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
        const y = li < 0 ? pos.getY(i) : limbY(rig, li, pos.getX(i), pos.getY(i), pos.getZ(i), g);
        if (y + body < min) min = y + body;
      }
      under = Math.min(under, min);
      touch = Math.min(touch, Math.abs(min - rest));
    }
    return { under, touch, rest };
  }

  it('보행 한 주기 내내 발이 지면을 뚫지 않고 디딤발은 지면에 닿는다', () => {
    for (const id of ALL_ENEMY_IDS) {
      const rig = enemyRig(id);
      if (rig.groundLift.length === 0) continue; // 지상 다리 없는 종(비행/미태깅)
      const { under, touch, rest } = walkExtent(rig, buildEnemy(id));
      expect(under, `${id} 발이 지면을 뚫음`).toBeGreaterThan(rest - 0.0015);
      expect(touch, `${id} 발이 공중에 뜸`).toBeLessThan(0.02);
    }
  });

  /**
   * **아군 장비도 발바닥 아래로 내려가지 않는다.**
   *
   * ⚠ 이 it 이 왜 따로 있는가 — 위 루프는 `buildEnemy` 만 돈다. 3단계에는 아군 장비가
   * 습격대 지오메트리에 변형 5~7로 **함께 구워져** 있어서 위 루프가 아군 무기까지
   * 같이 검사했지만, 5단계에서 아군이 자기 지오메트리(ALLY_GEO_KEY)로 갈리면서
   * **그 커버리지가 조용히 사라졌다.** 그 뒤로 아군 손에 무엇을 쥐여 주든 이 파일은
   * 아무 말도 하지 않았다.
   *
   * ⚠⚠ **잣대가 위 루프와 다르다** — 그리고 그 차이가 이 it 의 전부다.
   * 위 루프는 그 지오메트리 **자신의** 최저점(rest)을 기준선으로 쓴다("정지 자세에서
   * 이미 파묻힌 것은 리그 책임이 아니다"). 팔에 매달린 물건에 그 잣대를 그대로 쓰면
   * **아무것도 못 잡는다**: 무기를 낮출수록 rest 도 같이 내려가 문턱이 따라 내려간다.
   * 실측으로 확인했다 — 지팡이 밑동을 y 0.222 → 0.0 으로 내려도 rest −0.0048 /
   * 최저 −0.0041 이라 rest 기준으로는 **초록**이다. 그래서 기준선을 **몸통(변형 0)의
   * 최저점 = 발바닥**으로 고정한다. 이 잣대에서는 같은 개악이 −0.0041 < −0.0015 로
   * 곧장 **빨개진다**(실제로 그렇게 돌려 확인했다).
   *
   * 뜻: "무기가 발보다 아래로 내려가면 지면을 뚫은 것이다." 어깨 피벗이 y 0.42 이고
   * 보행 스윙이 ±0.34rad 이므로, 팔에 다는 물건이 **어깨 아래로 0.42 이상** 내려오면
   * 여기서 걸린다(주술사 지팡이 밑동은 0.198, hexer 는 0.365 — 둘 다 그 안이다).
   *
   * ⚠ 단품(buildAllySolo)이 아니라 **공유본**(buildAlly)을 돈다. 전투에서 실제로
   * 그려지는 것이 공유본이고, 접지 보정 표(groundLift)도 그 지오메트리에서 뽑힌다.
   */
  it('아군 4종의 장비가 보행 한 주기 내내 발바닥 아래로 내려가지 않는다', () => {
    const rig = allyRig();
    expect(rig.groundLift.length, '아군 접지 표가 비었다').toBeGreaterThan(0);
    const geo = buildAlly();
    const vtag = geo.getAttribute(VARIANT_ATTR)!;
    const pos = geo.getAttribute('position')!;
    const limb = geo.getAttribute(LIMB_ATTR)!;
    // 기준선 = 몸통(변형 0)의 정지 최저점. 전 종 공통 규약대로 발바닥 y=0 이다.
    let sole = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(vtag.getX(i)) === 0) sole = Math.min(sole, pos.getY(i));
    }
    expect(sole, '아군 몸통 발바닥이 y=0 규약을 벗어났다').toBeCloseTo(0, 3);

    for (const id of ALL_ALLY_IDS) {
      // 그 종이 실제로 쓰는 정점만 남긴다 — 다른 종의 장비는 셰이더가 접어 없앤다
      const v = allyVariant(id);
      const keep: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        const t = Math.round(vtag.getX(i));
        if (t === 0 || t === v) keep.push(i);
      }
      let under = 0;
      for (let s = 0; s < 64; s++) {
        const g = (s / 64) * Math.PI * 2;
        const body = groundLiftAt(rig, Math.abs(Math.sin(g)));
        for (const i of keep) {
          const li = Math.round(limb.getX(i)) - 1;
          const y = li < 0 ? pos.getY(i) : limbY(rig, li, pos.getX(i), pos.getY(i), pos.getZ(i), g);
          under = Math.min(under, y + body);
        }
      }
      expect(under, `${id} 장비가 발바닥 아래로 내려간다`).toBeGreaterThan(sole - 0.0015);
    }
  });
});
