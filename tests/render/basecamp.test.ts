/**
 * 홈타운 마을 모델의 **레벨 성장 계약**.
 *
 * ── 2단계 계약에서 무엇이 바뀌었나 (의도적) ────────────────────────────────
 * 2단계의 setLevel 은 전체 스케일 램프(0.68 → 1.0)였고, 그래서 이 파일은
 * "레벨마다 반경이 커진다 / 만렙 반경은 종전 1.839 그대로"를 잠갔다.
 * 3단계는 **구조물이 쌓이는 성장**으로 갈아 끼우면서 두 가지를 뒤집었다.
 *
 * 1) 성장의 축이 반경에서 **밀도와 높이**로 옮겨졌다.
 *    기지 셀은 맵 가장자리에서 1칸 안쪽이라 마을이 넓어질 수 있는 여지가 사실상 없다
 *    (바닥판 한계 1.45). 그래서 커지는 방향을 바깥이 아니라 **안쪽(빈 슬롯 채우기)과
 *    위(망루·장옥·깃대)** 로 잡았다. 반경은 바닥판이 조금씩 넓어지는 만큼만 자라므로
 *    "레벨마다 반드시 더 커진다"는 더 이상 옳은 계약이 아니다 — 대신
 *    **비감소(줄지 않는다) + 삼각형/높이 증가**를 잠근다.
 *
 * 2) 만렙 반경 1.839 → 1.45 이하로 **줄였다**.
 *    종전 모델은 목책·건조대·뼈 아치가 흙바닥(1.45) 바깥으로 나가 잔디 위에 떠 있었다.
 *    3단계 재배치에서 구조물을 반경 1.0 슬롯 고리에 앉히면서 **전부 바닥판 안**으로
 *    들어왔다. 이 파일은 이제 그 상한을 절대값으로 잠근다 — 마을을 다시 키우려면
 *    여기 숫자를 의식적으로 고쳐야 하고, 그때는 6개 스테이지에서 섬 밖으로 나가는지
 *    직접 확인해야 한다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BASECAMP_LAYER_COUNT, BASECAMP_MAX_RADIUS, createBasecamp } from '@/render/meshlib/basecamp';
import { BASE_LEVEL_MAX } from '@/data/hometown';
import { STAGES } from '@/data/stages';

/**
 * ⚠ **3(전소 폐허)이 2026-08-28 에 늘었다.** 사용자 요구로 "완전히 불타서 망한 마을"이
 *   생겼고, 그 단계도 아래 계약(반경 1.45 · 드로우콜 2 · 무상태)을 **똑같이** 지켜야 한다.
 *   여기 3 을 안 넣으면 새 단계가 섬 밖으로 나가도 아무도 모른다.
 */
const DAMAGE_LEVELS = [0, 1, 2, 3] as const;

/** 지금 실제로 그려지는 메시들의 XZ 최대 반경 (그룹 스케일 반영) */
function visibleRadius(group: THREE.Group): number {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let r = 0;
  forEachDrawn(group, (o) => {
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      r = Math.max(r, Math.hypot(v.x, v.z));
    }
  });
  return r;
}

/**
 * **본체인가 불꽃인가** — 마을은 메시 둘로 그려진다(구조물 + 발광 불꽃).
 * 가르는 기준은 `castShadow` 다: 구조물은 그림자를 던지고 **불꽃은 안 던진다**
 * (`createBasecamp` 이 그렇게 세운다). 재질 타입으로 가르면 팔레트가 바뀔 때 낡는다.
 *
 * ⚠ 갈라야 하는 이유: 합쳐서 삼각형만 세면 "구조물이 무너져 줄었다"와 "불이 늘었다"가
 *   서로 상쇄돼 아무것도 못 잡는다.
 */
function isBody(o: THREE.Mesh): boolean {
  return o.castShadow === true;
}

/**
 * 불꽃(발광) 메시의 **총 삼각형 면적** = 마을이 타는 양.
 *
 * ⚠⚠ **개수를 세면 안 된다.** 단계 사이의 차이는 주로 **크기**(원뿔 배율)이지 파트 수가
 *   아니다 — 실제로 개수로 재는 판본을 만들었더니, 전소 불길을 반파와 같게 만드는
 *   사보타주가 **초록으로 통과했다**(파트 수는 그대로였기 때문이다).
 *   면적은 배율의 제곱으로 자라 "얼마나 크게 타는가"를 그대로 잡는다.
 */
function glowArea(group: THREE.Group): number {
  group.updateMatrixWorld(true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let sum = 0;
  forEachDrawn(group, (o) => {
    if (isBody(o)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i + 2).applyMatrix4(o.matrixWorld);
      sum += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    }
  });
  return sum;
}

/**
 * 불이 **퍼진 넓이** — 발광 정점의 XZ 바운딩 넓이(타일²).
 *
 * ⚠ 면적(`glowArea`)만으로는 "불이 커졌다"와 "불이 번졌다"가 안 갈린다 — 화덕 하나를
 *   키워도 면적은 자란다(실제로 그 사보타주가 통과했다). 번짐은 **자리의 흩어짐**이므로
 *   XZ 로 얼마나 넓게 퍼졌는지를 따로 잰다.
 */
function glowSpread(group: THREE.Group): number {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  forEachDrawn(group, (o) => {
    if (isBody(o)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.x < x0) x0 = v.x;
      if (v.x > x1) x1 = v.x;
      if (v.z < z0) z0 = v.z;
      if (v.z > z1) z1 = v.z;
    }
  });
  return x1 < x0 ? 0 : (x1 - x0) * (z1 - z0);
}

/** 구조물(본체)의 삼각형 수 — 잿더미가 실제로 얹혔는지 되읽는다 */
function bodyTris(group: THREE.Group): number {
  let n = 0;
  forEachDrawn(group, (o) => {
    if (isBody(o)) n += o.geometry.getAttribute('position').count / 3;
  });
  return n;
}

/** **구조물만**의 최고 높이 — 불기둥은 빼고 잰다 */
function bodyHeight(group: THREE.Group): number {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let h = 0;
  forEachDrawn(group, (o) => {
    if (!isBody(o)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      h = Math.max(h, v.y);
    }
  });
  return h;
}

/** 구조물 정점 색의 평균 밝기 — 그을음이 실제로 어두워졌는지 되읽는다 */
function bodyLuma(group: THREE.Group): number {
  let sum = 0;
  let n = 0;
  forEachDrawn(group, (o) => {
    if (!isBody(o)) return;
    const col = o.geometry.getAttribute('color');
    if (!col) return;
    for (let i = 0; i < col.count; i++) {
      sum += 0.2126 * col.getX(i) + 0.7152 * col.getY(i) + 0.0722 * col.getZ(i);
      n++;
    }
  });
  return n === 0 ? 0 : sum / n;
}

/** 그려지는 메시들의 최고 높이 */
function visibleHeight(group: THREE.Group): number {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let h = 0;
  forEachDrawn(group, (o) => {
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      h = Math.max(h, v.y);
    }
  });
  return h;
}

/** 그려지는 삼각형 수 = 마을에 실제로 서 있는 구조물의 양 */
function visibleTris(group: THREE.Group): number {
  let n = 0;
  forEachDrawn(group, (o) => {
    n += o.geometry.getAttribute('position').count / 3;
  });
  return n;
}

function visibleMeshes(group: THREE.Group): number {
  let n = 0;
  forEachDrawn(group, () => {
    n++;
  });
  return n;
}

function forEachDrawn(group: THREE.Group, fn: (m: THREE.Mesh) => void): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && isDrawn(o)) fn(o);
  });
}

/** 조상까지 전부 visible이어야 실제로 그려진다 */
function isDrawn(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

describe('홈타운 마을 모델', () => {
  it('레벨 표가 레이어 수와 맞는다 (Lv1=움막, 만렙=완성된 마을)', () => {
    expect(BASECAMP_LAYER_COUNT).toBe(BASE_LEVEL_MAX);
  });

  it('어떤 레벨·어떤 피해에서도 반경 1.45를 넘지 않는다 (섬 밖으로 나가지 않는다)', () => {
    const camp = createBasecamp();
    for (let lv = 1; lv <= BASECAMP_LAYER_COUNT; lv++) {
      for (const dmg of DAMAGE_LEVELS) {
        camp.setLevel(lv, BASECAMP_LAYER_COUNT);
        camp.setDamageLevel(dmg);
        const r = visibleRadius(camp.group);
        expect(r, `Lv${lv} 피해${dmg}: 반경 ${r.toFixed(3)}`).toBeLessThanOrEqual(BASECAMP_MAX_RADIUS);
      }
    }
    camp.dispose();
  });

  it('레벨이 오를수록 구조물이 쌓인다 — 삼각형은 늘고 반경은 줄지 않는다', () => {
    const camp = createBasecamp();
    camp.setDamageLevel(0);
    const tris: number[] = [];
    const radii: number[] = [];
    for (let lv = 1; lv <= BASECAMP_LAYER_COUNT; lv++) {
      camp.setLevel(lv, BASECAMP_LAYER_COUNT);
      tris.push(visibleTris(camp.group));
      radii.push(visibleRadius(camp.group));
    }
    for (let i = 1; i < tris.length; i++) {
      // 쌓이는 성장이므로 **엄격히** 늘어야 한다 (레벨 하나가 아무것도 안 더하면 실패)
      expect(tris[i] as number, `Lv${i + 1}이 Lv${i}보다 구조물이 많다`).toBeGreaterThan(
        tris[i - 1] as number,
      );
      // 반경은 바닥판이 넓어지는 만큼만 — 줄지만 않으면 된다
      expect(radii[i] as number, `Lv${i + 1} 반경이 Lv${i}보다 작지 않다`).toBeGreaterThanOrEqual(
        (radii[i - 1] as number) - 1e-9,
      );
    }
    // Lv1은 "움막 하나" — 완성된 마을의 1/3도 안 되는 양이어야 한다
    expect((tris[0] as number) / (tris[tris.length - 1] as number)).toBeLessThan(0.33);
    camp.dispose();
  });

  /*
   * ── 피해 연출 (2026-08-28) — 사용자 요구 ────────────────────────────────────
   *   > "홈타운이 공격을 받을수록 더 부서진 모습이나 불타는 모습이 있어야 하고 …
   *   >  완전히 불타서 마을이 망하는 모습을 더 추가해줘"
   *
   * ⚠ 잣대는 **발광 메시(불꽃)와 본체 메시를 갈라서** 잰다. 둘을 합쳐 삼각형만 세면
   *   "구조물이 무너져 삼각형이 줄었다"와 "불이 늘었다"가 상쇄돼 **아무것도 못 잡는다** —
   *   실제로 그렇게 재면 d2 와 d3 의 총합이 비슷하다.
   */
  it('피해가 커질수록 불이 **커지고 번진다** (발광 면적이 단조 증가)', () => {
    const camp = createBasecamp();
    camp.setLevel(BASECAMP_LAYER_COUNT, BASECAMP_LAYER_COUNT);
    const fire: number[] = [];
    for (const dmg of DAMAGE_LEVELS) {
      camp.setDamageLevel(dmg);
      fire.push(glowArea(camp.group));
    }
    /*
     * ⚠⚠ **2026-08-28 : 잣대가 "비율"에서 "단조 증가"로 바뀌었다 — 사용자가 축을 바꿨다.**
     *   > "게임 시작하자 말자 홈타운은 이미 불꽃이 타고 있어. 이건 아니잖아. … 그 불꽃이
     *   >  공격을 받기 시작하면 점점 많아 지거나 크기가 조금씩 커지는게 좋겠어"
     *
     *   옛 판본은 `d3/d2 > 5` 하나였고, 그 아래에 "0→1 은 **줄어든다**(지키던 불이
     *   사그라든다)"는 문장이 붙어 있었다. 그 설계가 화면에서 두 가지를 동시에 잘못
     *   말했다 — 시작 화덕이 커서 "이미 불타는 마을", 맞을수록 불이 작아져 "괜찮아지는 중".
     *   지금 잠그는 것은 **사용자가 말한 그것**이다: 맞을수록 불이 커진다.
     *
     * 실측(만렙 마을, 발광 총면적): d0 **0.669** / d1 **2.096** / d2 **6.224** / d3 **24.417**.
     * 배수는 3.13 · 2.97 · 3.92 — 세 걸음이 고르게 자란다.
     * 문턱 **1.5배**의 유도: 실측 최소 배수 2.97 의 절반쯤이라 여유가 넉넉하고, 화면에서
     * "커졌다"를 알아볼 수 있는 하한이다(1.2 면 부감 55°에서 구분이 안 된다).
     */
    for (let i = 1; i < fire.length; i++) {
      expect(fire[i] as number, `d${i} 불 ${(fire[i] as number).toFixed(2)} vs d${i - 1} ${(fire[i - 1] as number).toFixed(2)} — 맞았는데 불이 안 커졌다`)
        .toBeGreaterThan((fire[i - 1] as number) * 1.5);
    }
    // 그리고 시작(온전)은 **화덕 하나**여야 한다 — 전소의 1/10 밑이라야 "평화로운 시작"이다
    expect(fire[0] as number, `d0 불 ${(fire[0] as number).toFixed(2)} — 시작부터 마을이 탄다`)
      .toBeLessThan((fire[3] as number) * 0.1);
    /*
     * ── 그리고 **번진다** — 사용자가 말한 "점점 많아 지거나 … 많은 곳에 붙여주면" ──────
     * ⚠ 위 면적만으로는 이걸 못 잡는다: 화덕 **하나만** 키워도 면적은 자란다. 실제로
     *   "파손 단계에 불이 안 번지게" 하는 사보타주가 면적 계약을 **초록으로 통과했다**.
     *   그래서 자리의 흩어짐(XZ 바운딩 넓이)을 따로 잰다.
     * 실측: d0 **0.133** / d1 **1.505** / d2 **3.254** / d3 **4.362** 타일² (d1 이 d0 의 11.3배).
     * 문턱은 단조 비감소 + d1 이 d0 의 **3배 이상**(첫 번짐이 눈에 보여야 한다).
     */
    const spread: number[] = [];
    for (const dmg of DAMAGE_LEVELS) {
      camp.setDamageLevel(dmg);
      spread.push(glowSpread(camp.group));
    }
    for (let i = 1; i < spread.length; i++) {
      expect(spread[i] as number, `d${i} 번짐 ${(spread[i] as number).toFixed(2)} vs d${i - 1} ${(spread[i - 1] as number).toFixed(2)}`)
        .toBeGreaterThanOrEqual((spread[i - 1] as number) - 1e-9);
    }
    expect(spread[1] as number, `d1 번짐 ${(spread[1] as number).toFixed(2)} vs d0 ${(spread[0] as number).toFixed(2)} — 맞아도 불이 한 자리에만 있다`)
      .toBeGreaterThan((spread[0] as number) * 3);
    camp.dispose();
  });

  /**
   * **불이 살아 움직인다** — 사용자 지적으로 생긴 자리:
   *   > "거의 마지막 단계 불타는 모습이 좀 어색해, 이부분 좀더 잘 만들어봐"
   *
   * 옛 판본은 `flameMesh.scale` 을 흔들어 마을의 **모든 불을 한 몸처럼** 부풀렸다(풍선이지
   * 불이 아니다). 지금은 `flamemat.ts` 의 셰이더가 **혀마다 다른 위상**으로 정점을 민다.
   *
   * ⚠ 흔드는 일은 GPU 에서 일어나 정점 버퍼로는 못 잰다(유니폼도 `onBeforeCompile` 클로저
   *   안이다). 그래서 **관측 가능한 두 성질**로 잰다:
   *  ① `flicker()` 가 재질의 시간 유니폼을 실제로 민다 (배선이 끊기면 값이 안 변한다)
   *  ② 메시 스케일은 **1 로 고정**이다 — 통짜 맥동으로 되돌아가면 여기가 빨개진다.
   *    (스케일을 흔들면 반경 계약까지 같이 흔들려 섬 밖으로 나갈 수 있다)
   */
  it('불꽃은 재질 시간으로 움직인다 — 메시를 통째로 늘이지 않는다', () => {
    const camp = createBasecamp();
    camp.setLevel(BASECAMP_LAYER_COUNT, BASECAMP_LAYER_COUNT);
    camp.setDamageLevel(3);
    const glow = (): THREE.Mesh => {
      let m: THREE.Mesh | null = null;
      forEachDrawn(camp.group, (o) => {
        if (!isBody(o)) m = o;
      });
      expect(m, '발광 메시를 못 찾았다').not.toBeNull();
      return m as unknown as THREE.Mesh;
    };
    // ① 시간을 밀어도 메시 스케일은 그대로다
    camp.flicker(0);
    const s0 = glow().scale.clone();
    camp.flicker(1.7);
    const s1 = glow().scale.clone();
    expect(s1.x, '불꽃 메시 x 스케일이 변했다 — 통짜 맥동이 돌아왔다').toBeCloseTo(s0.x, 9);
    expect(s1.y, '불꽃 메시 y 스케일이 변했다 — 통짜 맥동이 돌아왔다').toBeCloseTo(s0.y, 9);
    expect(s0.y, '불꽃 메시 스케일이 1 이 아니다 — 반경 계약이 흔들린다').toBeCloseTo(1, 9);
    // ② 그리고 실제로 흔드는 코드가 붙어 있다 (셰이더 주입 = onBeforeCompile)
    const mat = glow().material as THREE.Material;
    expect(typeof mat.onBeforeCompile, '불꽃 재질에 셰이더 주입이 없다 — 불이 얼어붙는다')
      .toBe('function');
    expect(mat.customProgramCacheKey?.(), '캐시 키가 없다 — three 가 다른 재질의 프로그램을 재사용한다')
      .toBe('wgd-flame-1');
    camp.dispose();
  });

  it('전소(3)는 반파(2)보다 더 무너지고 더 검다', () => {
    const camp = createBasecamp();
    camp.setLevel(BASECAMP_LAYER_COUNT, BASECAMP_LAYER_COUNT);
    camp.setDamageLevel(2);
    const h2 = bodyHeight(camp.group);
    const l2 = bodyLuma(camp.group);
    camp.setDamageLevel(3);
    const h3 = bodyHeight(camp.group);
    const l3 = bodyLuma(camp.group);
    // ⚠ 높이는 `bodyHeight` 로 잰다 — 전소는 **불기둥이 높아서** 전체 높이가 오히려
    //   커진다. 합쳐 재면 "더 무너졌다"가 "더 높아졌다"로 뒤집혀 읽힌다.
    expect(h3, `전소 높이 ${h3.toFixed(3)} vs 반파 ${h2.toFixed(3)}`).toBeLessThanOrEqual(h2 + 1e-9);
    /*
     * 문턱 0.75 의 유도(실측 · 만렙 마을 구조물 정점색 평균):
     *  · 정상                       d3/d2 = **0.517**  (병합 뒤 0.55 곱)
     *  · 그을림 곱을 없앤 사보타주  = **0.940**  ← 이것이 빨개져야 한다
     * 0.75 는 둘 사이이고 양쪽에 여유가 있다.
     * ⚠ `l3 < l2` 만으로는 **안 잡힌다** — 잿더미(어두운 파트)가 얹히는 것만으로 평균이
     *   조금 내려가기 때문이다(0.940). 실제로 그 판본이 사보타주를 통과했다.
     */
    expect(l3 / l2, `전소/반파 밝기 비 ${(l3 / l2).toFixed(3)} — 숯이 더 어두워야 한다`)
      .toBeLessThan(0.75);
    /*
     * 그리고 **잿더미가 실제로 깔린다.** 전소는 반파와 붕괴 형상을 공유하므로(`wrecked`),
     * 구조물 삼각형이 늘어나는 유일한 출처가 `ashes()` 다 — 곧 이 한 줄이 그것을 잠근다.
     * (색만 재면 `soot` 하나로도 통과해서 잿더미를 지워도 안 잡힌다 — 실측으로 확인했다.)
     */
    camp.setDamageLevel(2);
    const t2 = bodyTris(camp.group);
    camp.setDamageLevel(3);
    const t3 = bodyTris(camp.group);
    expect(t3, `전소 구조물 삼각형 ${t3} vs 반파 ${t2} — 잿더미가 없다`).toBeGreaterThan(t2);
    camp.dispose();
  });

  it('망루가 올라가 마을이 높아진다 (Lv1 대비 만렙이 1.6배 이상 높다)', () => {
    const camp = createBasecamp();
    camp.setDamageLevel(0);
    camp.setLevel(1, BASECAMP_LAYER_COUNT);
    const low = visibleHeight(camp.group);
    camp.setLevel(BASECAMP_LAYER_COUNT, BASECAMP_LAYER_COUNT);
    const high = visibleHeight(camp.group);
    expect(high).toBeGreaterThan(low * 1.6);
    camp.dispose();
  });

  it('레벨이 몇이든 그려지는 메시는 2개다 (드로우콜 2 유지)', () => {
    const camp = createBasecamp();
    for (let lv = 1; lv <= BASECAMP_LAYER_COUNT; lv++) {
      camp.setLevel(lv, BASECAMP_LAYER_COUNT);
      for (const dmg of DAMAGE_LEVELS) {
        camp.setDamageLevel(dmg);
        expect(visibleMeshes(camp.group), `Lv${lv} 피해${dmg}`).toBe(2);
      }
    }
    camp.dispose();
  });

  it('모닥불 오프셋이 화덕 자리를 가리킨다 (연기가 망루에서 피지 않게)', () => {
    const camp = createBasecamp();
    // 원점에는 사수 발판이 서 있고 화덕은 슬롯 하나를 차지한다 —
    // group.position 만 쓰면 연기가 망루 한복판에서 올라온다
    expect(Math.hypot(camp.fireOffset.x, camp.fireOffset.z)).toBeGreaterThan(0.3);
    camp.setLevel(BASECAMP_LAYER_COUNT, BASECAMP_LAYER_COUNT);
    const full = camp.fireOffset.y;
    camp.setLevel(1, BASECAMP_LAYER_COUNT);
    // Lv1 화톳불은 정식 화덕보다 낮다 — 연기 스폰도 같이 내려와야 한다
    expect(camp.fireOffset.y).toBeLessThan(full);
    expect(camp.fireOffset.y).toBeGreaterThan(0);
    camp.dispose();
  });

  /**
   * **6개 스테이지 전부에서 만렙 마을이 섬 안에 있는가** — 3단계의 합격 조건 하나.
   *
   * 스크린샷 대신 기하로 잠근다. 지형은 layout 한 글자 = 1×1 타일이고 '~'는 구멍이라
   * (terrain.ts), 셀 (x,z)가 덮는 범위는 [x±0.5, z±0.5]다. 마을이 반경 R의 원반을
   * 차지하므로 **baseCell 중심에서 R 안의 모든 점이 단단한 타일 위**여야 한다.
   *
   * R = 1.45(BASECAMP_MAX_RADIUS)일 때 어디까지 닿는지:
   *  · 축 방향  x+1.45 → 셀 x+1 안(x+0.5 ~ x+1.5). 셀 x+2는 1.5부터라 안 닿는다.
   *  · 대각 방향 1.45/√2 ≈ 1.025 → 셀 (x+1, z+1) 안.
   * 즉 **3×3 이웃이 전부 지상이면 충분하고, 하나라도 '~'면 마을이 허공에 뜬다.**
   * 여유(1.5 − 1.45 = 0.05)까지 함께 보고해 다음 사람이 얼마나 남았는지 알게 한다.
   */
  it('만렙 마을이 6개 스테이지 어디서도 섬 밖으로 나가지 않는다', () => {
    const solid = (s: (typeof STAGES)[number], x: number, z: number): boolean => {
      if (x < 0 || x >= s.gridW || z < 0 || z >= s.gridH) return false;
      return (s.layout[z]?.[x] ?? '~') !== '~';
    };
    expect(STAGES).toHaveLength(6);
    for (const s of STAGES) {
      const { x, z } = s.baseCell;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(
            solid(s, x + dx, z + dz),
            `스테이지${s.id} 기지(${x},${z})의 이웃 (${x + dx},${z + dz})이 지상이 아니다 — 마을이 허공에 걸친다`,
          ).toBe(true);
        }
      }
      // 3×3이 지상이면 사방으로 최소 1.5까지 땅이 있다 = 마을 반경 상한과의 여유
      expect(1.5 - BASECAMP_MAX_RADIUS).toBeGreaterThan(0);
    }
  });

  it('레벨을 오르내려도 상태가 남지 않는다 (같은 레벨이면 같은 지오메트리)', () => {
    const camp = createBasecamp();
    camp.setDamageLevel(0);
    camp.setLevel(3, BASECAMP_LAYER_COUNT);
    const at3 = visibleTris(camp.group);
    camp.setLevel(5, BASECAMP_LAYER_COUNT);
    camp.setLevel(1, BASECAMP_LAYER_COUNT);
    camp.setLevel(3, BASECAMP_LAYER_COUNT);
    expect(visibleTris(camp.group)).toBe(at3);
    camp.dispose();
  });
});
