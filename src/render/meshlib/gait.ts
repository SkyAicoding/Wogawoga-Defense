/**
 * 버텍스 셰이더 보행 리그 — 드로우콜/삼각형을 1도 늘리지 않고 사지를 움직인다.
 *
 * 원리:
 *  1) 지오메트리 빌드 시 버텍스마다 "어느 사지에 속하는가"를 aLimb(float) 어트리뷰트로 굽는다.
 *     0 = 고정(몸통), 1..N = 사지 그룹. (factory.ts 의 PartSpec.limb)
 *  2) 그룹별 (피벗/축/위상/진폭/들어올림)은 종마다 고정이므로 uniform 배열로 넘긴다.
 *  3) 인스턴스별 보행 위상은 aGait(InstancedBufferAttribute).
 *     보스는 개별 Mesh라 어트리뷰트가 없으므로 uGait 유니폼으로 폴백한다.
 *  4) 버텍스 셰이더가 피벗 기준 축 회전 + 스윙 구간 y 들어올림을 적용한다.
 *     · 노멀도 같은 회전을 먹여야 플랫 셰이딩 음영이 깨지지 않는다.
 *     · 그림자 패스(customDepthMaterial)에 같은 변형을 넣지 않으면 그림자만 다리가 굳는다.
 *
 * 접지(발이 미끄러지거나 지면을 뚫지 않게 하는 법):
 *  다리를 피벗(엉덩이) 기준 강체 진자로 보면 각도 θ 일 때 발끝은 y = L(1−cosθ) 만큼 뜬다.
 *  그래서 몸통을 정확히 그만큼 내려주면(enemyview 의 바운스) 디딤발이 지면에 붙는다.
 *  좌우 다리 위상이 정확히 π 차이면 |θ| 가 항상 같아 이 보정이 양발 모두에 유효하다.
 *  앞뒤 이동은 θ = A·sin(g) 라 한 주기 동안 발이 몸 기준 ±L·sin(A) 를 왕복하므로,
 *  보행 1주기 이동거리를 C = 4·L·sin(A) 로 잡으면 디딤발의 순 미끄러짐이 0이 된다.
 *  스윙(앞으로 나가는) 구간에서는 lift 로 발을 살짝 들어 스치는 느낌을 없앤다.
 */
import * as THREE from 'three';

export type V3 = [number, number, number];

/**
 * 셰이더 uniform 배열 크기 = 종당 사지 그룹 상한.
 * 이 값 × 3 vec4 가 모든 적 머티리얼에 상수로 올라가고(안 쓰는 칸도 매 프레임 업로드된다)
 * 버텍스 유니폼 슬롯도 그만큼 먹으므로, 실사용 최댓값(현재 boar/mammoth 7)에
 * 여유 1칸만 둔다. 넘기면 build() 에서 즉시 throw 하므로 조용히 깨지지 않는다.
 */
export const MAX_LIMBS = 8;

/** 인스턴스별 보행 위상 어트리뷰트 이름 */
export const GAIT_ATTR = 'aGait';

/** 버텍스별 사지 그룹 태그 어트리뷰트 이름 (factory.ts 가 굽는다) */
export const LIMB_ATTR = 'aLimb';

export interface LimbSpec {
  /** 회전 피벗 (모델 로컬 좌표) */
  pivot: V3;
  /** 회전축 (정규화됨) */
  axis: V3;
  /** 위상 오프셋 (rad) */
  phase: number;
  /** 1차 진폭 (rad) — sin(g+phase) */
  amp: number;
  /** 2차 진폭 (rad) — sin(2(g+phase)). 걸음당 1회인 꼬리 흔들림/머리 까딱임용 */
  amp2: number;
  /** 스윙 구간(cos(g+phase)>0) y 들어올림 (모델 단위) */
  lift: number;
  /** 지면에 닿는 그룹(다리) — 접지 보정 테이블 계산에 쓰인다 */
  ground: boolean;
}

/** 접지 보정 테이블 해상도 (|θ|/legAmp = 0..1) */
export const LIFT_SAMPLES = 33;

export interface EnemyRig {
  limbs: readonly LimbSpec[];
  /** 이동거리(타일=월드 단위) → 보행 위상 rad 배율 (= 2π / 보행 1주기 거리) */
  gaitPerDist: number;
  /**
   * 접지 보정 테이블. t = |sin(gait)| 로 참조하면 그 순간 몸통을 얼마나 들어올려야
   * 어떤 발도 지면을 뚫지 않는지가 나온다. 길이 0이면 보정 없음(비행/무각).
   */
  groundLift: Float32Array;
}

export interface LimbOpts {
  phase?: number;
  amp?: number;
  amp2?: number;
  lift?: number;
}

const EMPTY_RIG: EnemyRig = { limbs: [], gaitPerDist: 0, groundLift: new Float32Array(0) };

/**
 * 종별 사지 테이블 조립기. 적 모델 빌더가 파트를 만들면서 같이 채운다.
 * add/pair/leg 가 돌려주는 1-base id 를 PartSpec.limb 에 넣으면 태깅 완료.
 */
export class RigBuilder {
  private readonly limbs: LimbSpec[] = [];
  private cycle = 0;

  /** 사지 그룹 1개 등록 → 1-base id (0은 "고정" 예약값) */
  add(pivot: V3, axis: V3, o: LimbOpts = {}, ground = false): number {
    if (this.limbs.length >= MAX_LIMBS) {
      throw new Error(`사지 그룹이 상한 ${MAX_LIMBS}개를 넘었다`);
    }
    const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    this.limbs.push({
      pivot: [pivot[0], pivot[1], pivot[2]],
      axis: [axis[0] / len, axis[1] / len, axis[2] / len],
      phase: o.phase ?? 0,
      amp: o.amp ?? 0,
      amp2: o.amp2 ?? 0,
      lift: o.lift ?? 0,
      ground,
    });
    return this.limbs.length;
  }

  /**
   * z 대칭 사지 한 쌍 (좌 = +z, 우 = −z) → [좌 id, 우 id].
   * mirZ 는 z만 뒤집으므로 **회전축은 좌우 공통**이고 위상만 π 차이가 난다.
   * (축까지 뒤집으면 위상 π와 상쇄되어 양쪽이 같이 움직인다 — 가장 틀리기 쉬운 지점)
   */
  pair(pivot: V3, axis: V3, o: LimbOpts = {}, ground = false): [number, number] {
    const l = this.add(pivot, axis, o, ground);
    const r = this.add(
      [pivot[0], pivot[1], -pivot[2]],
      axis,
      { ...o, phase: (o.phase ?? 0) + Math.PI },
      ground,
    );
    return [l, r];
  }

  /**
   * 다리 한 쌍. 축은 +z 고정(앞뒤 스윙)이며 피벗 높이 L 과 진폭 A 로
   * 보행 1주기 이동거리 C = 4·L·sin(A) 를 역산한다 (디딤발 순 미끄러짐 0).
   * 여러 쌍을 등록하면 가장 긴 주기를 쓴다 — 앞/뒷다리는 같은 L·A 로 맞출 것.
   */
  leg(pivot: V3, o: LimbOpts = {}): [number, number] {
    const amp = o.amp ?? 0.5;
    const L = pivot[1];
    this.cycle = Math.max(this.cycle, 4 * L * Math.sin(amp));
    return this.pair(
      pivot,
      [0, 0, 1],
      { phase: o.phase ?? 0, amp, amp2: o.amp2 ?? 0, lift: o.lift ?? L * 0.13 },
      true,
    );
  }

  /** 다리가 없는 종(비행 등)의 보행 1주기 이동거리를 직접 지정 */
  setCycle(worldPerCycle: number): void {
    this.cycle = Math.max(this.cycle, worldPerCycle);
  }

  build(): EnemyRig {
    if (this.limbs.length === 0) return EMPTY_RIG;
    const cycle = this.cycle > 1e-4 ? this.cycle : 1;
    return {
      limbs: this.limbs,
      gaitPerDist: (Math.PI * 2) / cycle,
      groundLift: new Float32Array(0),
    };
  }
}

/**
 * 접지 보정 테이블을 **실제로 구운 지오메트리에서** 계산해 리그에 채운다.
 *
 * 다리 그룹의 버텍스 v 를 피벗 기준으로 a = pivotY − v.y (아래거리),
 * b = v.x − pivotX (앞뒤거리) 로 두면, 축(0,0,1) 둘레로 θ 회전한 뒤 높이는
 *   y(θ) = pivotY + b·sinθ − a·cosθ
 * 좌우 다리가 ±θ 이므로 가장 깊게 박히는 값은 max(a·cosθ + |b|·sinθ) 이고,
 * 몸통을 그만큼 들어올리면 **어떤 발도 지면을 뚫지 않으면서** 디딤발은 정확히 닿는다.
 *
 * 발 모양(발바닥 길이·발톱)을 손으로 재지 않아도 되는 게 핵심 —
 * 2단계 담당자는 다리를 태그만 하면 접지가 자동으로 맞는다.
 */
export function computeGroundLift(geo: THREE.BufferGeometry, rig: EnemyRig): EnemyRig {
  const limbAttr = geo.getAttribute(LIMB_ATTR);
  const pos = geo.getAttribute('position');
  if (!limbAttr || !pos) return rig;
  const n = rig.limbs.length;
  // 지면 그룹 id(1-base) → 수집 슬롯. -1 이면 지면 그룹이 아니다.
  const slot = new Int8Array(n + 1).fill(-1);
  let nGround = 0;
  for (let i = 0; i < n; i++) {
    if (rig.limbs[i]!.ground) slot[i + 1] = nGround++;
  }
  if (nGround === 0) return rig;

  // 1) 버텍스는 **한 번만** 순회한다 (그룹마다 전수 순회하면 종당 수 ms 가 그냥 날아간다).
  //    a = 피벗 아래로 얼마나 내려갔나, b = 앞뒤로 얼마나 벌어졌나(부호 무시).
  const aOf: number[][] = [];
  const bOf: number[][] = [];
  for (let g = 0; g < nGround; g++) {
    aOf.push([]);
    bOf.push([]);
  }
  for (let i = 0; i < pos.count; i++) {
    const id = Math.round(limbAttr.getX(i));
    if (id < 1 || id > n) continue;
    const g = slot[id]!;
    if (g < 0) continue;
    const spec = rig.limbs[id - 1]!;
    aOf[g]!.push(spec.pivot[1] - pos.getY(i));
    bOf[g]!.push(Math.abs(pos.getX(i) - spec.pivot[0]));
  }

  const table = new Float32Array(LIFT_SAMPLES);
  for (let gi = 0; gi < n; gi++) {
    const spec = rig.limbs[gi]!;
    const g = slot[gi + 1]!;
    if (g < 0) continue;
    const aRaw = aOf[g]!;
    const bRaw = bOf[g]!;
    if (aRaw.length === 0) continue;

    // (a, b) 후보. a·cosθ + b·sinθ (θ≥0) 의 최댓값만 필요하므로
    // 두 좌표 모두 남한테 밀리는 점(지배당하는 점)은 답이 될 수 없어 버린다.
    const ord = aRaw.map((_, i) => i).sort((p, q) => aRaw[q]! - aRaw[p]!); // a 내림차순
    const pa: number[] = [];
    const pb: number[] = [];
    const pr: number[] = []; // hypot(a,b) = 그 점이 낼 수 있는 최댓값
    const pt: number[] = []; // atan2(b,a) = 최댓값이 나오는 각도
    let maxB = -Infinity;
    for (const i of ord) {
      const b = bRaw[i]!;
      if (b <= maxB) continue;
      maxB = b;
      const a = aRaw[i]!;
      pa.push(a);
      pb.push(b);
      pr.push(Math.hypot(a, b));
      pt.push(Math.atan2(b, a));
    }
    // 기준점은 정지 자세(θ=0)의 최심점 — 모델이 원래 갖고 있던 미세한 파묻힘까지
    // 들어올리면 정지 높이가 바뀐다. 보정은 "정지 자세 대비" 로만 준다.
    const base = pa[0]! - spec.pivot[1]; // a 내림차순이라 첫 점이 최대

    // 런타임은 표를 선형보간해 읽는다. 곡선이 위로 볼록해 칸 값만 담으면 사이 구간에서
    // 값이 모자라 발이 살짝 박힌다 — 각 칸을 ±½칸 구간의 **정확한** 최댓값으로 채운다.
    // (구간 최댓값은 봉우리 각 pt 가 구간 안이면 pr, 아니면 양 끝값 중 큰 쪽 — 닫힌 해라
    //  서브샘플링 13회를 돌 필요가 없다.)
    const cell = 0.5 / (LIFT_SAMPLES - 1);
    for (let s = 0; s < LIFT_SAMPLES; s++) {
      const t0 = Math.max(0, s / (LIFT_SAMPLES - 1) - cell);
      const t1 = Math.min(1, s / (LIFT_SAMPLES - 1) + cell);
      const th0 = spec.amp * t0;
      const th1 = spec.amp * t1;
      const c0 = Math.cos(th0);
      const s0 = Math.sin(th0);
      const c1 = Math.cos(th1);
      const s1 = Math.sin(th1);
      let lift = -Infinity;
      for (let k = 0; k < pa.length; k++) {
        const a = pa[k]!;
        const b = pb[k]!;
        const peak = pt[k]!;
        const d =
          peak >= th0 && peak <= th1
            ? pr[k]!
            : Math.max(a * c0 + b * s0, a * c1 + b * s1);
        if (d > lift) lift = d;
      }
      const v = lift - spec.pivot[1] - base;
      if (v > table[s]!) table[s] = v;
    }
  }
  for (let s = 0; s < LIFT_SAMPLES; s++) table[s] = Math.max(0, table[s]!);
  return { ...rig, groundLift: table };
}

/** 접지 보정 조회 — t = |sin(gait)| (0..1) */
export function groundLiftAt(rig: EnemyRig, t: number): number {
  const n = rig.groundLift.length;
  if (n === 0) return 0;
  const f = Math.min(1, Math.max(0, t)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  return rig.groundLift[i]! * (1 - k) + rig.groundLift[i + 1]! * k;
}

// --- 셰이더 주입 -----------------------------------------------------------

/**
 * 공유 flatMat() 프로그램과 절대 섞이면 안 된다.
 * three 는 onBeforeCompile 로 바뀐 소스를 프로그램 캐시 키에 넣지 않기 때문에
 * 같은 파라미터의 다른 Lambert 머티리얼과 프로그램을 공유해버린다.
 */
const CACHE_KEY_COLOR = 'wgd-gait-color-1';
const CACHE_KEY_DEPTH = 'wgd-gait-depth-1';

const PARS = /* glsl */ `
uniform vec4 uLimbA[${MAX_LIMBS}]; // pivot.xyz, phase
uniform vec4 uLimbB[${MAX_LIMBS}]; // axis.xyz, amp
uniform vec4 uLimbC[${MAX_LIMBS}]; // lift, amp2, -, -
attribute float ${LIMB_ATTR};
#ifdef USE_INSTANCING
attribute float ${GAIT_ATTR};
#else
uniform float uGait;
#endif
vec3 wgdPivot;
vec3 wgdAxis;
float wgdCos;
float wgdSin;
float wgdLift;
float wgdOn;
vec3 wgdSpin(vec3 v) {
  return v * wgdCos + cross(wgdAxis, v) * wgdSin + wgdAxis * (dot(wgdAxis, v) * (1.0 - wgdCos));
}
void wgdSetup() {
  wgdOn = 0.0;
  int li = int(${LIMB_ATTR} + 0.5) - 1;
  if (li < 0) return;
  li = min(li, ${MAX_LIMBS - 1});
  vec4 a = uLimbA[li];
  vec4 b = uLimbB[li];
  vec4 c = uLimbC[li];
#ifdef USE_INSTANCING
  float ph = ${GAIT_ATTR} + a.w;
#else
  float ph = uGait + a.w;
#endif
  float ang = b.w * sin(ph) + c.y * sin(2.0 * ph);
  wgdPivot = a.xyz;
  wgdAxis = b.xyz;
  wgdCos = cos(ang);
  wgdSin = sin(ang);
  wgdLift = c.x * max(0.0, cos(ph));
  wgdOn = 1.0;
}
vec3 wgdPos(vec3 p) {
  if (wgdOn < 0.5) return p;
  return wgdPivot + wgdSpin(p - wgdPivot) + vec3(0.0, wgdLift, 0.0);
}
vec3 wgdNormal(vec3 n) {
  if (wgdOn < 0.5) return n;
  return wgdSpin(n);
}
`;

/** 컬러 패스: 노멀은 beginnormal_vertex(=defaultnormal_vertex 이전)에서 같이 돌려야 한다 */
const HOOK_NORMAL = '#include <beginnormal_vertex>';
const HOOK_POS = '#include <begin_vertex>';

/**
 * 셰이더 주입. 패스마다 셋업 위치가 다르다 —
 *  · 컬러(Lambert): beginnormal_vertex 가 begin_vertex **앞에** 무조건 실행되므로
 *    거기서 한 번만 wgdSetup() 하고 begin_vertex 는 결과(전역 변수)를 재사용한다.
 *    양쪽에서 부르면 동적 유니폼 인덱싱 + sin/cos 가 버텍스마다 통째로 두 번 돈다.
 *  · 그림자(Depth): three 의 depth_vert 는 beginnormal_vertex 를 `#ifdef USE_DISPLACEMENTMAP`
 *    안에 두기 때문에 그 자리는 컴파일에서 통째로 빠진다. 반드시 begin_vertex 에서 셋업해야
 *    하고, 노멀은 쓰지 않으므로 주입하지 않는다. (여기를 지우면 그림자만 다리가 굳는다)
 */
function inject(
  mat: THREE.Material,
  uniforms: Record<string, THREE.IUniform>,
  withNormal: boolean,
): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let v = shader.vertexShader.replace('#include <common>', `#include <common>\n${PARS}`);
    if (withNormal) {
      v = v
        .replace(
          HOOK_NORMAL,
          `${HOOK_NORMAL}\n\twgdSetup();\n\tobjectNormal = wgdNormal(objectNormal);`,
        )
        .replace(HOOK_POS, `${HOOK_POS}\n\ttransformed = wgdPos(transformed);`);
    } else {
      v = v.replace(HOOK_POS, `${HOOK_POS}\n\twgdSetup();\n\ttransformed = wgdPos(transformed);`);
    }
    shader.vertexShader = v;
  };
  mat.customProgramCacheKey = () => (withNormal ? CACHE_KEY_COLOR : CACHE_KEY_DEPTH);
}

export interface GaitMaterials {
  /** 색상 패스 — 적 전용 (공유 flatMat 을 건드리면 온 세상이 흔들린다) */
  color: THREE.MeshLambertMaterial;
  /** 그림자 패스 — mesh.customDepthMaterial 에 꽂아야 그림자 다리도 움직인다 */
  depth: THREE.MeshDepthMaterial;
  /** 보스(개별 Mesh) 폴백: 인스턴스 어트리뷰트가 없어 위상을 유니폼으로 넣는다 */
  setGait(g: number): void;
  dispose(): void;
}

/** 종별 사지 테이블을 uniform 으로 굳힌 적 전용 머티리얼 쌍 */
export function makeGaitMaterials(rig: EnemyRig): GaitMaterials {
  const a = new Float32Array(MAX_LIMBS * 4);
  const b = new Float32Array(MAX_LIMBS * 4);
  const c = new Float32Array(MAX_LIMBS * 4);
  for (let i = 0; i < rig.limbs.length && i < MAX_LIMBS; i++) {
    const s = rig.limbs[i]!;
    a.set([s.pivot[0], s.pivot[1], s.pivot[2], s.phase], i * 4);
    b.set([s.axis[0], s.axis[1], s.axis[2], s.amp], i * 4);
    c.set([s.lift, s.amp2, 0, 0], i * 4);
  }
  const gait: THREE.IUniform<number> = { value: 0 };
  const uniforms: Record<string, THREE.IUniform> = {
    uLimbA: { value: a },
    uLimbB: { value: b },
    uLimbC: { value: c },
    uGait: gait,
  };

  const color = new THREE.MeshLambertMaterial({ vertexColors: true });
  inject(color, uniforms, true);
  // 그림자 패스는 three 내부 _depthMaterial 과 같은 기본값(BasicDepthPacking)이어야 한다
  const depth = new THREE.MeshDepthMaterial();
  inject(depth, uniforms, false);

  return {
    color,
    depth,
    setGait: (g) => {
      gait.value = g;
    },
    dispose: () => {
      color.dispose();
      depth.dispose();
    },
  };
}

// --- 머티리얼 캐시 ---------------------------------------------------------
/**
 * 적 전용 머티리얼은 **전투를 나갔다 들어와도 살려둔다**.
 * three 의 GL 프로그램은 그 프로그램을 쓰는 머티리얼 수로 참조 계수를 세는데,
 * 적 gait 프로그램을 붙들고 있는 머티리얼은 이것들뿐이라 dispose 하면 참조가 0이 되어
 * 프로그램이 해제되고, 재진입 때 4개(컬러/그림자 × 인스턴스/보스)를 다시 링크한다.
 * 지오메트리(cachedGeo)와 같은 수명 정책 — 종 수만큼(≤14개) 유한하다.
 */
const matCache = new Map<string, GaitMaterials>();

/** 캐시된 gait 머티리얼. key 는 종 id (보스는 개체 슬롯까지 포함) */
export function cachedGaitMaterials(key: string, rig: EnemyRig): GaitMaterials {
  let gm = matCache.get(key);
  if (!gm) {
    gm = makeGaitMaterials(rig);
    matCache.set(key, gm);
  }
  return gm;
}

/** 콘텍스트 로스트 후 재구축 시 전체 폐기 (clearGeoCache 와 짝) */
export function clearGaitMaterials(): void {
  for (const gm of matCache.values()) gm.dispose();
  matCache.clear();
}

/** 위상을 [0, 2π) 로 접어 큰 이동거리에서도 float 정밀도를 유지 */
export function wrapGait(g: number): number {
  const tau = Math.PI * 2;
  const w = g % tau;
  return w < 0 ? w + tau : w;
}
