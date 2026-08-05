/**
 * 오버레이 인스턴스 계층 — **적 체력바 / 내 타워 체력바 / 파괴 잔해 / 침묵 룬**을
 * 전부 하나의 InstancedMesh로 그린다 (드로우콜 1). barKind로 정점·프래그먼트를 가른다:
 *   0 = 적 체력바, 1 = 타워 체력바 (카메라 정렬 빌보드)
 *   2 = 파괴 잔해, 3 = 침묵 룬     (지면/지붕에 눕는 원형 표식, towerstatus.ts가 상태 소유)
 * 만피는 숨긴다 — 바가 보인다 = 지금 뭔가 깎이고 있다는 신호다.
 *
 * ── 왜 네 가지를 한 메시에 몰아넣는가 (드로우콜 예산) ────────────────────────
 * 표식용 메시를 따로 두면 그 자체로 +1 콜이고, 실측한 최대 메시 프레임
 * (스테이지6 w50 = 보스 개별 3 + 인스턴스 2 + 만렙 타워 12 + 체력바 12)이 이미
 * 60/60이라 예산을 넘겼다(61 실측). 체력바 메시는 무언가 깎이는 순간 어차피
 * 그려지므로, 여기에 얹으면 오버레이 계층 전체가 **항상 드로우콜 1개**다.
 * (InstancedMesh는 count가 0이면 draw 자체를 건너뛴다 — 평소에는 0콜이다)
 *
 * ── 적 바와 내 타워 바는 **반드시 달라 보여야 한다** ─────────────────────────
 * 예전에는 폭·높이만 조금 다르고 팔레트(초록→빨강)·테두리가 같아서, 난전 중에
 * 어느 바가 내 것인지 구분되지 않았다. 더 나쁜 건 **의미 반전**이다 —
 * 이 장르에서 빨간 바는 "적이 곧 죽는다"는 좋은 소식인데, 같은 팔레트를 쓰면
 * 무너지기 직전인 내 타워가 오히려 안심 신호로 읽힌다.
 *
 * 그래서 두 축을 동시에 갈랐다:
 *  · **팔레트** — 적은 초록→빨강(자연/생명), 타워는 청록→호박→적색(구조물/경보).
 *    만피 근처의 색이 아예 다르므로(초록 대 청록) 한 프레임만 봐도 갈린다.
 *  · **형태** — 타워 바는 밝은 돌색 테두리를 두르고 중앙에 눈금을 넣는다.
 *    기본 줌에서 유닛이 20px 남짓이라 색만으로는 부족하고, 테두리 명도 대비가
 *    "선이 하나 더 굵다"로 읽힌다. 높이도 0.13 → 0.22로 키웠다
 *    (실측: 데스크톱 기본 줌에서 채움 높이 1~2px → 4~5px).
 */
import * as THREE from 'three';
import type { EnemyState, TowerState } from '@/data/types';
import { lerp } from '@/core/mathx';
import { BOSS_ENEMIES } from '../meshlib/enemies';
import { towerTierScale } from '../meshlib/towers';
import type { CellToWorld } from '../meshlib/terrain';
import type { TowerMark } from './towerstatus';

const CAPACITY = 160;
/**
 * 타워 체력바 — 적보다 넓고 **확실히** 두껍게.
 * 0.13 → 0.22: 데스크톱 기본 줌(1셀 ≈ 20.5px)에서 0.13은 채움이 1~2px라
 * 읽히지 않았다. 0.22면 4~5px로 "바"의 형태가 생긴다.
 */
const TOWER_BAR_W = 0.9;
const TOWER_BAR_H = 0.22;
/** 티어 스케일에 곱하는 바 높이 — 지붕 바로 위 (towerTierScale 기준) */
const TOWER_BAR_HEIGHT = 1.45;
/** 지면 표식(잔해) 높이 — 지형 z-파이팅을 polygonOffset과 함께 피한다 */
const GROUND_Y = 0.045;
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
/** 지면 표식용 — 쿼드를 눕힌다 (빌보드 분기를 타지 않는다) */
const _flatQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _scl = new THREE.Vector3();
const _mat = new THREE.Matrix4();

export class HealthBarView {
  private mesh: THREE.InstancedMesh;
  private fillAttr: THREE.InstancedBufferAttribute;
  private kindAttr: THREE.InstancedBufferAttribute;
  private uniforms = { uTime: { value: 0 } };

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const fills = new Float32Array(CAPACITY);
    this.fillAttr = new THREE.InstancedBufferAttribute(fills, 1);
    this.fillAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('fill', this.fillAttr);
    // 0 = 적 바, 1 = 타워 바, 2 = 파괴 잔해, 3 = 침묵 룬
    const kinds = new Float32Array(CAPACITY);
    this.kindAttr = new THREE.InstancedBufferAttribute(kinds, 1);
    this.kindAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('barKind', this.kindAttr);

    // 지면 표식은 반투명이라 재질이 투명 패스로 간다. 체력바는 alpha=1이라
    // 블렌딩이 무연산이고, renderOrder 5로 투명 패스 안에서도 맨 뒤에 그려진다.
    const mat = new THREE.MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float fill;
attribute float barKind;
varying float vFill;
varying float vKind;
varying vec2 vBarUv;`,
        )
        .replace(
          '#include <project_vertex>',
          `vFill = fill;
vKind = barKind;
vBarUv = position.xy + 0.5;
vec4 mvPosition;
if (barKind < 1.5) {
  // 체력바: 빌보드 — 인스턴스 위치 + 카메라 우/상 벡터 * 로컬 좌표 * 인스턴스 스케일
  vec4 ipos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float bsx = length(vec3(instanceMatrix[0]));
  float bsy = length(vec3(instanceMatrix[1]));
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 bbWorld = ipos.xyz + camRight * position.x * bsx + camUp * position.y * bsy;
  mvPosition = viewMatrix * vec4(bbWorld, 1.0);
} else {
  // 지면/지붕 표식: 인스턴스 행렬을 그대로 쓴다 (이미 눕혀져 있다)
  mvPosition = viewMatrix * instanceMatrix * vec4(position, 1.0);
}
gl_Position = projectionMatrix * mvPosition;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
varying float vFill;
varying float vKind;
varying vec2 vBarUv;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if (vKind < 1.5) {
  // ── 체력바 ────────────────────────────────────────────────────────────
  // 적: 초록→빨강 (자연/생명). 테두리는 검정.
  vec3 foeCol = mix(vec3(0.85, 0.16, 0.1), vec3(0.28, 0.82, 0.2), smoothstep(0.25, 0.6, vFill));
  // 내 타워: 청록→호박→적색 (구조물/경보). 만피 근처 색이 적과 완전히 다르다.
  vec3 ownCol = mix(vec3(0.98, 0.22, 0.13), vec3(1.0, 0.72, 0.12), smoothstep(0.15, 0.45, vFill));
  ownCol = mix(ownCol, vec3(0.36, 0.86, 0.95), smoothstep(0.5, 0.8, vFill));
  vec3 hpCol = mix(foeCol, ownCol, vKind);
  vec3 barCol = vBarUv.x < vFill ? hpCol : mix(vec3(0.06, 0.05, 0.05), vec3(0.10, 0.09, 0.11), vKind);
  // 타워 바는 테두리를 두껍게 + 밝은 돌색으로 — 색이 안 보이는 크기에서도 갈린다
  float inset = mix(0.06, 0.17, vKind);
  float edge = step(inset, vBarUv.y) * step(vBarUv.y, 1.0 - inset)
             * step(inset * 0.35, vBarUv.x) * step(vBarUv.x, 1.0 - inset * 0.35);
  // 타워 바 중앙 눈금 — 반쯤 깎였는지가 한눈에 잡힌다
  float tick = vKind * step(abs(vBarUv.x - 0.5), 0.012) * step(0.25, vBarUv.y) * step(vBarUv.y, 0.75);
  vec3 frame = mix(vec3(0.04), vec3(0.93, 0.90, 0.82), vKind);
  diffuseColor.rgb = mix(frame, mix(barCol, vec3(0.16, 0.14, 0.13), tick), edge);
} else {
  // ── 지속 표식 (towerstatus.ts) ───────────────────────────────────────
  vec2 p = (vBarUv - 0.5) * 2.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  if (vKind < 2.5) {
    // 파괴 잔해: 그을음 원 + 무너진 기둥 자국 + 흩어진 파편
    float scorch = smoothstep(1.0, 0.15, r);
    float ringBand = smoothstep(0.62, 0.5, abs(r - 0.56)) * step(0.15, abs(sin(ang * 2.0 + 0.7)));
    float ring = smoothstep(0.10, 0.0, abs(r - 0.56)) * step(0.35, abs(sin(ang * 2.0 + 0.7)));
    // 파편 — 고정 각도에 놓인 밝은 점 (난수 대신 각도 함수라 프레임마다 안 흔들린다)
    float chips = step(0.90, sin(ang * 5.0 + 1.9) * 0.5 + 0.5) * smoothstep(0.95, 0.62, r) * step(0.62, r);
    vec3 soot = mix(vec3(0.035, 0.028, 0.024), vec3(0.10, 0.075, 0.058), scorch * 0.6);
    // 부러진 기둥/파편은 밝은 목재색 — 잔디 위 '그림자'로 오해되지 않게 명도 대비를 준다
    vec3 timber = vec3(0.66, 0.47, 0.27);
    diffuseColor.rgb = mix(soot, timber, clamp(ring + chips, 0.0, 1.0));
    // vFill = 0..1 정착도 (갓 부서졌을 땐 옅다가 진해진다)
    diffuseColor.a *= clamp((scorch * 0.9 + ring * 0.85 + chips * 0.95 + ringBand * 0.1)
                            * (0.5 + 0.5 * vFill), 0.0, 1.0);
  } else {
    // 침묵 룬: 도는 마젠타 고리 + 룬 눈금 (vFill = 개체별 위상 오프셋)
    float spin = uTime * 1.15 + vFill;
    float ring = smoothstep(0.16, 0.0, abs(r - 0.80));
    float ticks = step(0.55, abs(sin(ang * 3.0 + spin))) * smoothstep(0.32, 0.0, abs(r - 0.60));
    float inner = smoothstep(0.07, 0.0, abs(r - 0.34)) * 0.6;
    // 하한을 0.72로 올려 **꺼진 것처럼 보이는 순간이 없게** 한다 (지속 표식의 요건)
    float pulse = 0.86 + 0.14 * sin(uTime * 5.0 + vFill);
    diffuseColor.rgb = mix(vec3(0.86, 0.10, 0.95), vec3(1.0, 0.72, 1.0), ticks);
    diffuseColor.a *= clamp((ring + ticks * 0.95 + inner) * pulse, 0.0, 1.0);
  }
}`,
        );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /** 셰이더 시간 (침묵 룬 회전/맥동) — stage3d.update가 부른다 */
  tick(dt: number): void {
    this.uniforms.uTime.value += dt;
  }

  update(
    enemies: readonly EnemyState[],
    towers: readonly TowerState[],
    alpha: number,
    cellToWorld: CellToWorld,
    marks: readonly TowerMark[] = [],
  ): void {
    let n = 0;
    _quat.identity();
    for (const e of enemies) {
      if (!e.alive || e.hp >= e.maxHp || n >= CAPACITY) continue;
      const sx = lerp(e.prevX, e.x, alpha);
      const sz = lerp(e.prevZ, e.z, alpha);
      cellToWorld(sx, sz, _pos);
      const boss = BOSS_ENEMIES.has(e.defId);
      _pos.y = (e.flying ? 2.15 : 0.55) + e.radius * 1.6 + (boss ? 0.45 : 0);
      const w = (boss ? 1.3 : 0.55) * (0.8 + e.radius);
      _mat.compose(_pos, _quat, _scl.set(w, boss ? 0.17 : 0.11, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, Math.max(0, e.hp) / e.maxHp);
      this.kindAttr.setX(n, 0);
      n++;
    }
    // 타워 — 같은 인스턴스 버퍼에 이어 붙인다 (드로우콜 증가 0).
    // 셀 고정이라 보간이 필요 없고, 지붕 위 높이는 티어 스케일을 따라간다.
    for (const t of towers) {
      if (t.hp >= t.maxHp || n >= CAPACITY) continue;
      cellToWorld(t.cellX, t.cellZ, _pos);
      _pos.y = 0.1 + towerTierScale(t.tier) * TOWER_BAR_HEIGHT;
      _mat.compose(_pos, _quat, _scl.set(TOWER_BAR_W, TOWER_BAR_H, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, Math.max(0, t.hp) / Math.max(1, t.maxHp));
      this.kindAttr.setX(n, 1);
      n++;
    }
    // 지속 상태 표식 — 눕힌 쿼드라 빌보드 분기를 타지 않는다
    for (const m of marks) {
      if (n >= CAPACITY) break;
      cellToWorld(m.cellX, m.cellZ, _pos);
      // 룬은 지붕 위로 띄운다 (pitch 55°에서 고리로 읽힌다), 잔해는 지면에
      _pos.y = m.ground ? GROUND_Y : 0.12 + towerTierScale(m.tier) * 1.15;
      _mat.compose(_pos, _flatQuat, _scl.set(m.size, m.size, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, m.phase);
      this.kindAttr.setX(n, m.kind);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fillAttr.needsUpdate = true;
    this.kindAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
