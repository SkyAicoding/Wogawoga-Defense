/**
 * 프로시저럴 메시 조합 DSL.
 * 프리미티브(box/cyl/cone/ico/sphere)를 배치 스펙으로 나열 → 비인덱스 병합 +
 * 버텍스 컬러 페인팅(면 단위 지터) + 바닥 AO + 노멀 재계산(플랫 셰이딩).
 * 빌드 비용이 크므로 키 캐싱 필수 (cachedGeo).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '@/core/rng';
import { clamp01 } from '@/core/mathx';
import { LIMB_ATTR } from './gait';

export interface PartSpec {
  kind: 'box' | 'cyl' | 'cone' | 'ico' | 'sphere';
  /** 파트 중심 위치 */
  pos?: [number, number, number];
  /** 오일러 XYZ 라디안 */
  rot?: [number, number, number];
  /** 단일 숫자 = 균일 스케일. 프리미티브는 전부 1단위 크기 기준 */
  scale?: [number, number, number] | number;
  color: number;
  /** 면 단위 색상(hue) 지터 폭 (기본 0) */
  hueJitter?: number;
  /** cyl/cone 원주 분할 수 (기본 6) */
  seg?: number;
  /**
   * 버텍스 셰이더 보행 리그의 사지 그룹 id (1-base, gait.ts RigBuilder 가 발급).
   * 미지정/0 = 고정(몸통). 한 파트라도 지정되면 병합 지오메트리에 aLimb 어트리뷰트가 생긴다.
   * 태그가 하나도 없으면 어트리뷰트를 아예 만들지 않아 기존 동작과 동일하다.
   */
  limb?: number;
}

export interface BuildOpts {
  /** 면 지터 시드 (기본 1) */
  seed?: number;
  /** 바닥 AO 강도 — y 최저점에서 이만큼 어두움 (기본 0.15) */
  ao?: number;
  /** 면 단위 명도 지터 폭 (기본 0.045) */
  faceJitter?: number;
}

function primitive(kind: PartSpec['kind'], seg: number): THREE.BufferGeometry {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'cyl':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, seg);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, seg);
    case 'ico':
      return new THREE.IcosahedronGeometry(0.5, 0);
    case 'sphere':
      // 로우폴리 구 = 1회 세분 이코사
      return new THREE.IcosahedronGeometry(0.5, 1);
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** 파트 목록 → 병합된 비인덱스 지오메트리 (position/color/normal) */
export function buildParts(parts: readonly PartSpec[], opts: BuildOpts = {}): THREE.BufferGeometry {
  const rng = new Rng(opts.seed ?? 1);
  const ao = opts.ao ?? 0.15;
  const faceJitter = opts.faceJitter ?? 0.045;
  const geos: THREE.BufferGeometry[] = [];
  // 사지 태그가 하나라도 있으면 병합 뒤에 aLimb 을 한 번에 깐다.
  // (파트마다 어트리뷰트를 달아 mergeGeometries 로 합치면 작은 배열 수십 개 할당 +
  //  병합 복사가 그대로 콜드 빌드 비용이 된다 — 파트별 버텍스 수만 기억했다 나중에 채운다)
  const useLimb = parts.some((p) => (p.limb ?? 0) > 0);
  const limbRuns: number[] = []; // [버텍스 수, limb id, ...]

  for (const part of parts) {
    const base = primitive(part.kind, part.seg ?? 6);
    const geo = base.index ? base.toNonIndexed() : base;
    if (geo !== base) base.dispose();

    const [px, py, pz] = part.pos ?? [0, 0, 0];
    const [rx, ry, rz] = part.rot ?? [0, 0, 0];
    const sc = part.scale ?? 1;
    const [sx, sy, sz] = typeof sc === 'number' ? [sc, sc, sc] : sc;
    _q.setFromEuler(_e.set(rx, ry, rz, 'XYZ'));
    _m.compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
    geo.applyMatrix4(_m);

    // 면 단위 색 페인팅: 3버텍스(삼각형)마다 같은 지터
    const count = geo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const hueJ = part.hueJitter ?? 0;
    for (let i = 0; i < count; i += 3) {
      _c.setHex(part.color);
      const lj = (rng.next() - 0.5) * 2 * faceJitter;
      const hj = (rng.next() - 0.5) * 2 * hueJ;
      _c.offsetHSL(hj, 0, lj);
      for (let v = 0; v < 3; v++) {
        const o = (i + v) * 3;
        colors[o] = _c.r;
        colors[o + 1] = _c.g;
        colors[o + 2] = _c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (useLimb) limbRuns.push(count, part.limb ?? 0);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geos.push(geo);
  }

  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('mergeGeometries 실패');

  // 사지 태그: 병합 결과는 파트 순서대로 이어붙인 것이므로 구간을 그대로 칠하면 된다
  if (useLimb) {
    const total = merged.getAttribute('position').count;
    const limbs = new Float32Array(total);
    let o = 0;
    for (let i = 0; i < limbRuns.length; i += 2) {
      const n = limbRuns[i]!;
      const id = limbRuns[i + 1]!;
      if (id > 0) limbs.fill(id, o, o + n);
      o += n;
    }
    if (o !== total) throw new Error('aLimb 구간 합이 병합 버텍스 수와 다르다');
    merged.setAttribute(LIMB_ATTR, new THREE.BufferAttribute(limbs, 1));
  }

  // 바닥 AO: y가 낮을수록 최대 ao만큼 어둡게
  if (ao > 0) applyHeightAo(merged, ao);

  merged.computeVertexNormals(); // 비인덱스 → 면 노멀 = 플랫 셰이딩
  merged.computeBoundingSphere();
  return merged;
}

/** y 높이 기반 페이크 AO — 병합 후 색 감쇠 */
export function applyHeightAo(geo: THREE.BufferGeometry, strength: number): void {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color');
  if (!col) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxY - minY, 1e-5);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp01((pos.getY(i) - minY) / span);
    const f = 1 - strength * (1 - t);
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
}

/** 파트 배열 평행이동/회전(yaw)/스케일 헬퍼 — 소품 등 그룹 배치용 */
export function geoTransform(
  geo: THREE.BufferGeometry,
  dx: number,
  dy: number,
  dz: number,
  yaw = 0,
  scale = 1,
): THREE.BufferGeometry {
  _q.setFromEuler(_e.set(0, yaw, 0, 'XYZ'));
  _m.compose(_p.set(dx, dy, dz), _q, _s.set(scale, scale, scale));
  geo.applyMatrix4(_m);
  return geo;
}

/** 지오메트리 색 전체 밝기 배율 (클론 배리에이션용) */
export function tintGeo(geo: THREE.BufferGeometry, mul: number): THREE.BufferGeometry {
  const col = geo.getAttribute('color');
  if (col) {
    for (let i = 0; i < col.count; i++) {
      col.setXYZ(i, col.getX(i) * mul, col.getY(i) * mul, col.getZ(i) * mul);
    }
  }
  return geo;
}

// --- 키 캐싱 ---------------------------------------------------------------
const cache = new Map<string, THREE.BufferGeometry>();

export function cachedGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = cache.get(key);
  if (!geo) {
    geo = build();
    cache.set(key, geo);
  }
  return geo;
}

/** 콘텍스트 로스트 후 재구축 시 전체 폐기 */
export function clearGeoCache(): void {
  for (const geo of cache.values()) geo.dispose();
  cache.clear();
}
