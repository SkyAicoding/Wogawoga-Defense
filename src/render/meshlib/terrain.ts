/**
 * 스테이지 지형 빌더.
 * layout 파싱 + paths 래스터라이즈 → 타일 상면/절벽 껍질/지면 장식/물을
 * 정적 병합 지오메트리 몇 개로 구성. 그리드 중심 = 월드 원점, 타일 상면 y=0.
 *
 * ── 이 파일이 한 번 갈아엎힌 이유 ────────────────────────────────────────
 * 예전 구조는 **셀 하나 = 박스 하나**였다. 상면도 박스(12삼각형), 절벽도 셀마다
 * 박스를 2~3개 쌓은 것(24~36삼각형)이었다. 결과는 두 가지로 나빴다.
 *  ① 그림: 절벽이 셀마다 따로 지터돼 **톱니 벽돌담**으로 보였고(자연 암벽이 아니라),
 *    상면 박스는 옆면 4장을 이웃에 가려진 채로 굽고 있었으며, 면 단위 명도 지터가
 *    타일 하나를 대각선으로 갈라 **접힌 종이**처럼 보이게 했다.
 *  ② 값: 그 낭비가 전부 **섀도 패스로 2배 청구**됐다(지형은 캐스터다).
 * 지금 구조는 "보이는 면만 굽는다"로 통일했다.
 *  · 상면 = 쿼드 1장(2삼각형). 이웃과 정확히 맞물리므로 옆면이 필요 없다.
 *    ⚠ 그래서 예전의 셀별 높이 지터(hJit)는 **없앴다** — 쿼드끼리 높이가 다르면
 *      이음매가 벌어져 그 사이로 배경이 비친다. 결은 높이가 아니라 색으로 낸다.
 *  · 절벽 = 섬 **윤곽선을 따라 한 겹으로 두른 껍질**. 격자 모서리마다 안쪽 방향과
 *    지터를 하나씩만 정해 두고 이웃 변이 그것을 공유하므로 이음매가 안 생기고,
 *    아래로 갈수록 안쪽으로 물려 들어가 **떠 있는 섬**의 실루엣이 된다.
 *    바닥 뚜껑은 굽지 않는다 — 껍질이 단조적으로 안쪽으로 물리므로 위에서
 *    내려다보는 이 카메라(피치 40~65°)에서는 섬 상면에 언제나 가려진다.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { StageDef, Vec2 } from '@/data/types';
import { buildableCells as sharedBuildable, rasterizePathCells } from '@/data/grid';
import { Rng, hashSeed } from '@/core/rng';
import { BIOMES, flatMat, type BiomePalette } from '../palette';
import { buildParts, type PartSpec } from './factory';

export type CellToWorld = (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3;

export interface TerrainBuild {
  group: THREE.Group;
  cellToWorld: CellToWorld;
  aabb: THREE.Box3;
  /** 경로로 마킹된 셀 (key = z*gridW + x) */
  pathCells: Set<number>;
  /** 건설 슬롯 셀 목록 */
  slotCells: Vec2[];
  /** 소품 산포 가능한 빈 지상 셀 */
  freeCells: Vec2[];
  /** 자유 배치 가능한 모든 셀 (지상, 경로 제외) */
  buildableCells: Vec2[];
  isGround(x: number, z: number): boolean;
  dispose(): void;
}

/** 물 표면 높이 — 절벽 껍질이 이 높이에서 잘려 보인다 */
export const WATER_Y = -1.7;

function charAt(stage: StageDef, x: number, z: number): string {
  if (x < 0 || x >= stage.gridW || z < 0 || z >= stage.gridH) return '~';
  const row = stage.layout[z];
  return row ? (row[x] ?? '~') : '~';
}

// --- 삼각형 수프 빌더 ------------------------------------------------------
/**
 * 프리미티브 조합(factory.buildParts)으로 만들 수 없는 것 — 임의의 쿼드/삼각형과
 * **정점별 색** — 을 직접 쌓는다. 절벽 껍질의 세로 그라데이션과 물의 수심 밴드가
 * 이걸 필요로 한다(프리미티브는 파트 하나에 색 하나뿐이다).
 * 비인덱스라 computeVertexNormals가 곧 면 노멀 = 플랫 셰이딩이고, 그러면서도
 * 정점 색은 삼각형 안에서 부드럽게 보간된다.
 */
type V3 = readonly [number, number, number];

class TriBuf {
  readonly pos: number[] = [];
  readonly col: number[] = [];

  tri(a: V3, b: V3, c: V3, ca: THREE.Color, cb: THREE.Color, cc: THREE.Color): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }

  /** a→b→c→d 순서가 앞면 기준 반시계 */
  quad(
    a: V3, b: V3, c: V3, d: V3,
    ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, cd: THREE.Color,
  ): void {
    this.tri(a, b, c, ca, cb, cc);
    this.tri(a, c, d, ca, cc, cd);
  }

  quadFlat(a: V3, b: V3, c: V3, d: V3, color: THREE.Color): void {
    this.quad(a, b, c, d, color, color, color, color);
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

// --- 섬 윤곽선 -------------------------------------------------------------
/** 물/공허와 맞닿은 지상 셀 변 하나 */
interface RimEdge {
  /** 시작/끝 격자 모서리 인덱스 (cz*(gridW+1)+cx) */
  a: number;
  b: number;
  /** 바깥 방향 (단위, y=0) */
  nx: number;
  nz: number;
}

const DIRS: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * 지상 셀의 물 접면을 모아 섬 윤곽선을 만든다.
 * 변의 방향은 "A→B 로 걸어가며 아래로 내리면 바깥면"이 되도록 정한다
 * (t = (-nz, 0, nx) — 유도는 t × (0,-1,0) = n).
 * 격자 안쪽 '~' 구멍(사막 협곡 등)의 테두리도 같은 규칙으로 잡힌다.
 */
function rimEdges(stage: StageDef): RimEdge[] {
  const out: RimEdge[] = [];
  const cw = stage.gridW + 1;
  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      if (charAt(stage, x, z) === '~') continue;
      for (const [dx, dz] of DIRS) {
        if (charAt(stage, x + dx, z + dz) !== '~') continue;
        // 변의 두 끝 격자 모서리 (셀 (x,z)의 네 모서리는 (x,z)~(x+1,z+1))
        const tx = -dz;
        const tz = dx;
        // 변의 중점 = 셀 중심 + 바깥방향*0.5, 거기서 ±t*0.5 가 두 끝점
        const mx = x + 0.5 + dx * 0.5;
        const mz = z + 0.5 + dz * 0.5;
        const ax = Math.round(mx - tx * 0.5);
        const az = Math.round(mz - tz * 0.5);
        const bx = Math.round(mx + tx * 0.5);
        const bz = Math.round(mz + tz * 0.5);
        out.push({ a: az * cw + ax, b: bz * cw + bx, nx: dx, nz: dz });
      }
    }
  }
  return out;
}

/**
 * 절벽 껍질의 층 프로파일. inset은 **안쪽으로 물리는 양**, jit은 모서리별 높이 흔들림.
 * 마지막 층이 물 표면(-1.7)보다 깊은 이유는 그 아래가 물에 가려 안 보이기 때문이다 —
 * 물에 잠기는 구간까지만 있으면 되고 바닥 뚜껑은 필요 없다.
 */
const CLIFF_RINGS: readonly { y: number; inset: number; jit: number }[] = [
  { y: 0.0, inset: 0.0, jit: 0.0 },
  { y: -0.22, inset: -0.06, jit: 0.03 },
  { y: -0.84, inset: 0.04, jit: 0.1 },
  { y: -1.62, inset: 0.24, jit: 0.16 },
  { y: -2.7, inset: 0.8, jit: 0.26 },
];

/**
 * 절벽 색 램프 — 위에서부터 [모래톱 립, 암벽 상단, 층리, 암벽 하단, 수면 아래].
 * ⚠ 램프는 **물 표면(-1.7) 위에서 다 써야 한다**. 처음엔 마지막 스톱(암벽 하단)을
 * 링4(-2.7)에 뒀는데 그 구간은 통째로 물에 잠겨 안 보이므로, 눈에 들어오는 절벽이
 * 모래톱~층리색 두 톤뿐인 밋밋한 벽이 됐다. 그래서 어두운 쪽을 링3(-1.62)까지 당겼다.
 */
function cliffColor(pal: BiomePalette, ring: number, out: THREE.Color): THREE.Color {
  const stops = [pal.shoreSand, pal.cliff[0], pal.cliffBand, pal.cliff[1], pal.cliff[1]];
  out.setHex(stops[ring] ?? pal.cliff[1]);
  if (ring >= 4) out.multiplyScalar(0.55); // 수면 아래로 더 가라앉는 톤
  return out;
}

// --- 지면 결 ---------------------------------------------------------------
/**
 * 타일 하나의 색. 램프 픽 + 저주파 띠(사구/눈두께) + 타일 단위 지터 + 액센트.
 * **면 단위가 아니라 타일 단위**인 것이 핵심이다 — 예전엔 buildParts의 faceJitter가
 * 삼각형마다 다른 밝기를 줘서 타일 하나가 대각선으로 갈라져 보였다.
 */
function tileColor(
  pal: BiomePalette,
  rng: Rng,
  isPath: boolean,
  wx: number,
  wz: number,
  out: THREE.Color,
): THREE.Color {
  const g = pal.grain;
  const ramp = isPath ? pal.path : pal.ground;
  let hex = ramp[rng.int(0, ramp.length - 1)] ?? ramp[0] ?? 0x808080;
  let accent = false;
  if (!isPath && rng.chance(g.accent)) {
    hex = g.accentColor;
    accent = true;
  }
  out.setHex(hex);
  // 저주파 띠 — 방향 벡터에 투영한 값의 사인. 경로는 평탄하게 둔다(길이 흔들리면 안 읽힌다)
  const band = isPath
    ? 0
    : Math.sin(((wx * Math.cos(g.bandAngle) + wz * Math.sin(g.bandAngle)) / g.bandLen) * Math.PI * 2) * g.band;
  const lj = (rng.next() - 0.5) * 2 * (isPath ? g.jitter * 0.5 : g.jitter);
  const hj = (rng.next() - 0.5) * 2 * g.hue;
  out.offsetHSL(hj, accent ? 0.04 : 0, band + lj);
  return out;
}

export function buildStage(stage: StageDef): TerrainBuild {
  const pal = BIOMES[stage.biome];
  const rng = new Rng(hashSeed(`terrain:${stage.id}`));
  const pathCells = rasterizePathCells(stage);
  const slotCells: Vec2[] = [];
  const freeCells: Vec2[] = [];
  const halfW = (stage.gridW - 1) / 2;
  const halfH = (stage.gridH - 1) / 2;

  const cellToWorld: CellToWorld = (x, z, out) => {
    const v = out ?? new THREE.Vector3();
    return v.set(x - halfW, 0, z - halfH);
  };
  /** 격자 모서리 인덱스 → 월드 좌표 (셀 (x,z)의 모서리 (x,z) = 셀 중심 - 0.5) */
  const cw = stage.gridW + 1;
  const cornerX = (i: number): number => (i % cw) - halfW - 0.5;
  const cornerZ = (i: number): number => Math.floor(i / cw) - halfH - 0.5;

  const surf = new TriBuf(); // 상면 + 절벽 껍질 (섀도 캐스터)
  const rocks: PartSpec[] = []; // '#' 바위 (섀도 캐스터)
  const cliffTop = pal.cliff[0];
  const cTmp = new THREE.Color();
  const cSand = new THREE.Color(pal.shoreSand);

  // --- 1) 타일 상면 -------------------------------------------------------
  const exposedCell = (x: number, z: number): boolean =>
    charAt(stage, x - 1, z) === '~' ||
    charAt(stage, x + 1, z) === '~' ||
    charAt(stage, x, z - 1) === '~' ||
    charAt(stage, x, z + 1) === '~';

  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      const ch = charAt(stage, x, z);
      if (ch === '~') continue; // 물/공허 = 구멍
      const wx = x - halfW;
      const wz = z - halfH;
      const isPath = pathCells.has(z * stage.gridW + x);
      tileColor(pal, rng, isPath, wx, wz, cTmp);
      // 물가 셀은 상면도 모래톱 쪽으로 살짝 당겨 둔다 — 썸네일의 "풀밭 가장자리 모래 립".
      // 0.3까지 당겨 본 판(캡처 b1)에서는 바깥 한 줄이 통째로 해변이 돼 판이 작아 보였다.
      if (exposedCell(x, z)) cTmp.lerp(cSand, isPath ? 0.08 : 0.14);
      surf.quadFlat(
        [wx - 0.5, 0, wz - 0.5],
        [wx - 0.5, 0, wz + 0.5],
        [wx + 0.5, 0, wz + 0.5],
        [wx + 0.5, 0, wz - 0.5],
        cTmp,
      );

      if (ch === 'o') {
        slotCells.push({ x, z }); // 데이터 호환용 — 자유 배치라 시각 패드는 없음
      } else if (ch === '#') {
        // 바위 장식 (건설 불가) — 타일 지오메트리에 병합
        const n = rng.int(1, 2);
        for (let i = 0; i < n; i++) {
          rocks.push({
            kind: 'ico',
            pos: [wx + rng.range(-0.22, 0.22), rng.range(0.1, 0.2), wz + rng.range(-0.22, 0.22)],
            rot: [rng.range(0, 3), rng.range(0, 3), 0],
            scale: rng.range(0.3, 0.55),
            color: cliffTop,
            hueJitter: 0.012,
          });
        }
      } else if (ch === '.' && !isPath) {
        freeCells.push({ x, z });
      }
    }
  }

  // --- 2) 절벽 껍질 -------------------------------------------------------
  const edges = rimEdges(stage);
  // 모서리별 바깥 방향(인접 변 노멀의 합) + 지터 두 개.
  // **이웃 변이 같은 값을 읽는다**는 것이 이음매가 안 생기는 이유다.
  const nAcc = new Map<number, [number, number]>();
  for (const e of edges) {
    for (const i of [e.a, e.b]) {
      const v = nAcc.get(i);
      if (v) {
        v[0] += e.nx;
        v[1] += e.nz;
      } else {
        nAcc.set(i, [e.nx, e.nz]);
      }
    }
  }
  const cornerDir = new Map<number, [number, number]>();
  const cornerJit = new Map<number, [number, number]>();
  const keys = [...nAcc.keys()].sort((p, q) => p - q); // 반복 순서 고정 = 결정론
  const crng = new Rng(hashSeed(`cliff:${stage.id}`));
  for (const i of keys) {
    const [ax, az] = nAcc.get(i) as [number, number];
    const len = Math.hypot(ax, az);
    // 길이가 0에 가까우면(변 넷이 만나는 잘록한 목) 수평 변위를 포기한다 —
    // 그래도 두 변이 같은 점을 쓰므로 껍질은 여전히 닫혀 있다.
    cornerDir.set(i, len < 0.1 ? [0, 0] : [ax / len, az / len]);
    cornerJit.set(i, [crng.next(), crng.next()]);
  }

  const ringPos = (i: number, ring: number, out: [number, number, number]): void => {
    const [dx, dz] = cornerDir.get(i) as [number, number];
    const [j0, j1] = cornerJit.get(i) as [number, number];
    const r = CLIFF_RINGS[ring] as { y: number; inset: number; jit: number };
    const inset = r.inset * (0.45 + 1.15 * j0);
    out[0] = cornerX(i) - dx * inset;
    out[1] = r.y - r.jit * j1;
    out[2] = cornerZ(i) - dz * inset;
  };

  const pa: [number, number, number] = [0, 0, 0];
  const pb: [number, number, number] = [0, 0, 0];
  const pc: [number, number, number] = [0, 0, 0];
  const pd: [number, number, number] = [0, 0, 0];
  const cU = new THREE.Color();
  const cL = new THREE.Color();
  for (const e of edges) {
    for (let ring = 0; ring < CLIFF_RINGS.length - 1; ring++) {
      ringPos(e.a, ring, pa);
      ringPos(e.b, ring, pb);
      ringPos(e.b, ring + 1, pc);
      ringPos(e.a, ring + 1, pd);
      cliffColor(pal, ring, cU);
      cliffColor(pal, ring + 1, cL);
      surf.quad(pa, pb, pc, pd, cU, cU, cL, cL);
    }
  }

  const group = new THREE.Group();
  group.name = 'terrain';
  // 병합 지오메트리 1: 상면 + 절벽 + '#' 바위 — 드로우콜 1, 섀도 캐스터
  const surfGeo = surf.geometry();
  const rockGeo = rocks.length > 0 ? buildParts(rocks, { seed: hashSeed(`rock:${stage.id}`), ao: 0.2 }) : null;
  const tileGeo = rockGeo ? (mergeGeometries([surfGeo, rockGeo], false) as THREE.BufferGeometry) : surfGeo;
  if (rockGeo) {
    surfGeo.dispose();
    rockGeo.dispose();
    tileGeo.computeBoundingSphere();
  }
  const tileMesh = new THREE.Mesh(tileGeo, flatMat());
  tileMesh.receiveShadow = true;
  tileMesh.castShadow = true;
  group.add(tileMesh);

  // 병합 지오메트리 2: 장식 — 섀도를 굽지 않으므로 삼각형이 프레임에서 1번만 청구된다
  const decoGeo = buildDeco(stage, pal, pathCells, edges, cornerX, cornerZ, halfW, halfH);
  const decoMesh = new THREE.Mesh(decoGeo, flatMat());
  decoMesh.receiveShadow = true;
  decoMesh.castShadow = false;
  group.add(decoMesh);

  // 프레이밍용 AABB — y를 얕게 잡아 카메라 fit이 지면 위주로 되게 한다
  const aabb = new THREE.Box3(
    new THREE.Vector3(-halfW - 0.5, -0.25, -halfH - 0.5),
    new THREE.Vector3(halfW + 0.5, 0.75, halfH + 0.5),
  );

  return {
    group,
    cellToWorld,
    aabb,
    pathCells,
    slotCells,
    freeCells,
    buildableCells: sharedBuildable(stage, pathCells),
    isGround: (x, z) => charAt(stage, x, z) !== '~',
    dispose: () => {
      tileGeo.dispose();
      decoGeo.dispose();
    },
  };
}

// --- 장식 지오메트리 -------------------------------------------------------
/**
 * 섀도를 굽지 않는 장식 묶음 (드로우콜 1 · 프레임 청구 ×1).
 *  ① 지면 무늬 — 화산의 용암 균열, 사막의 갈라진 땅, 늪의 웅덩이 등. 바닥에서
 *     1cm 띄운 납작한 쿼드라 **판정에 관여하지 않는다**. 자리는 경로·'#'·물가 셀로
 *     제한한다(빈 건설 칸에 얹으면 배치 하이라이트와 헷갈린다).
 *  ② 물가 바위 — 절벽 껍질에 매달리는 이코사. 물 표면 위(-0.3~-1.5) 구간에만
 *     둔다. 그보다 깊으면 물에 가려 안 보이므로 삼각형만 버리는 셈이다.
 *  ③ 섬 하부 실루엣 — 아주 얕게. 어차피 대부분 물 아래다.
 */
function buildDeco(
  stage: StageDef,
  pal: BiomePalette,
  pathCells: ReadonlySet<number>,
  edges: readonly RimEdge[],
  cornerX: (i: number) => number,
  cornerZ: (i: number) => number,
  halfW: number,
  halfH: number,
): THREE.BufferGeometry {
  const rng = new Rng(hashSeed(`deco:${stage.id}`));
  const buf = new TriBuf();
  const c = new THREE.Color();
  const cGround = new THREE.Color(pal.ground[0] ?? 0x808080);
  const parts: PartSpec[] = [];

  /*
   * ① 지면 무늬 ------------------------------------------------------------
   * 화산만 무늬가 **밝다** — 지각이 갈라져 아래 용암이 비치는 것이라 지면보다 뜨겁다.
   * 나머지 바이옴은 반대로 지면보다 살짝 어두운 자국(마른 흙·이끼·물 자국)이고,
   * 가늘고 긴 균열이 아니라 **넓적한 얼룩**이라야 자국으로 읽힌다(처음엔 전부
   * 폭 0.05짜리 띠로 뽑았더니 잔디밭에 나뭇가지를 흩뿌린 것처럼 보였다).
   */
  const isVolcano = stage.biome === 'volcano';
  const veinColor = isVolcano ? 0xff8a1e : pal.grain.accentColor;
  const veinLight = isVolcano ? 0xffd257 : (pal.path[0] ?? pal.grain.accentColor);
  const decoCells: Vec2[] = [];
  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      const ch = charAt(stage, x, z);
      if (ch === '~') continue;
      const rim =
        charAt(stage, x - 1, z) === '~' ||
        charAt(stage, x + 1, z) === '~' ||
        charAt(stage, x, z - 1) === '~' ||
        charAt(stage, x, z + 1) === '~';
      if (ch === '#' || rim || pathCells.has(z * stage.gridW + x)) decoCells.push({ x, z });
    }
  }
  const veinRate = isVolcano ? 0.5 : 0.3;
  for (const cell of decoCells) {
    if (!rng.chance(veinRate)) continue;
    const wx = cell.x - halfW;
    const wz = cell.z - halfH;
    // 셀 안을 가로지르는 가늘고 긴 쿼드 — 균열/사구결/이끼 자국
    const ang = rng.range(0, Math.PI);
    const len = rng.range(0.5, 0.92);
    const wid = isVolcano ? rng.range(0.05, 0.15) : rng.range(0.26, 0.62);
    const ux = Math.cos(ang) * len * 0.5;
    const uz = Math.sin(ang) * len * 0.5;
    const vx = -Math.sin(ang) * wid * 0.5;
    const vz = Math.cos(ang) * wid * 0.5;
    const ox = wx + rng.range(-0.2, 0.2);
    const oz = wz + rng.range(-0.2, 0.2);
    const y = 0.012;
    c.setHex(rng.chance(0.35) ? veinLight : veinColor).offsetHSL(0, 0, rng.range(-0.05, 0.05));
    if (!isVolcano) c.lerp(cGround, 0.45); // 지면 쪽으로 당겨 자국이 도드라지지 않게
    buf.quadFlat(
      [ox - ux - vx, y, oz - uz - vz],
      [ox - ux + vx, y, oz - uz + vz],
      [ox + ux + vx, y, oz + uz + vz],
      [ox + ux - vx, y, oz + uz - vz],
      c,
    );
  }

  // ② 물가 바위 -------------------------------------------------------------
  // 섬 윤곽선 위에서 고르게 뽑는다. 개수를 변 수에 비례시켜 큰 판일수록 더 붙는다.
  const nRim = Math.max(4, Math.round(edges.length * 0.16));
  for (let i = 0; i < nRim; i++) {
    const e = edges[Math.floor((i + 0.5) * (edges.length / nRim)) % edges.length] as RimEdge;
    const t = rng.range(0.25, 0.75);
    const ax = cornerX(e.a);
    const az = cornerZ(e.a);
    const bx = cornerX(e.b);
    const bz = cornerZ(e.b);
    const y = rng.range(-1.35, -0.35);
    // 바깥면을 따라 안쪽으로 물린 위치에 얹고 살짝 밖으로 튀어나오게 한다
    const inset = 0.1 + (-y) * 0.28;
    const s = rng.range(0.42, 0.78);
    parts.push({
      kind: 'ico',
      pos: [
        ax + (bx - ax) * t - e.nx * (inset - s * 0.22),
        y,
        az + (bz - az) * t - e.nz * (inset - s * 0.22),
      ],
      rot: [rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)],
      scale: [s, s * rng.range(0.7, 1.25), s],
      color: rng.chance(0.4) ? pal.cliffBand : pal.cliff[0],
      hueJitter: 0.02,
    });
  }

  // ③ 섬 하부 실루엣 — 물 표면 바로 위/아래 경계에 걸치는 뾰족 바위 몇 개만.
  //    (예전 underRocks는 y=-3 아래라 물 평면에 통째로 가려져 값만 냈다)
  const spikeN = 5;
  for (let i = 0; i < spikeN; i++) {
    const e = edges[Math.floor(rng.next() * edges.length)] as RimEdge;
    const t = rng.range(0.2, 0.8);
    const ax = cornerX(e.a);
    const az = cornerZ(e.a);
    const bx = cornerX(e.b);
    const bz = cornerZ(e.b);
    const s = rng.range(0.5, 0.95);
    parts.push({
      kind: 'cone',
      pos: [ax + (bx - ax) * t - e.nx * 0.55, -1.5, az + (bz - az) * t - e.nz * 0.55],
      rot: [Math.PI, rng.range(0, 3), 0],
      scale: [s, s * 2.6, s],
      color: pal.cliff[1],
      hueJitter: 0.015,
      seg: 5,
    });
  }

  const geo = buf.triangles > 0 ? buf.geometry() : null;
  const partGeo = parts.length > 0 ? buildParts(parts, { seed: hashSeed(`decop:${stage.id}`), ao: 0.3 }) : null;
  if (geo && partGeo) {
    const merged = mergeGeometries([geo, partGeo], false) as THREE.BufferGeometry;
    geo.dispose();
    partGeo.dispose();
    merged.computeBoundingSphere();
    return merged;
  }
  return (geo ?? partGeo) as THREE.BufferGeometry;
}

// --- 물 -------------------------------------------------------------------
export interface WaterBuild {
  geo: THREE.BufferGeometry;
  /** 물결 애니메이션 — 정점 색만 갱신한다(정점 위치는 고정) */
  animate(time: number): void;
}

/**
 * 물/용암 평면.
 *
 * 예전엔 PlaneGeometry(diag*6, 24×24) **단색** 한 장이었다. 화면의 60~70%를
 * 차지하면서 정보량이 0이었고, 진폭 0.09의 정점 흔들림은 이 카메라에서 보이지도
 * 않았다(그런데 매 프레임 625정점을 다시 썼다). 썸네일 6장은 예외 없이 물에
 * **얕은물 링 · 포말 · 물결선 · 수심 밴드**를 갖고 있다 — 그게 섬을 "떠 있게" 만든다.
 *
 * 그래서 같은 드로우콜 1개 안에서 삼각형을 **재분배**했다:
 *  · 격자는 섬 근처만 촘촘하고(셀 1칸) 멀어질수록 링 4겹으로 성기다. 총 삼각형은
 *    예전보다 오히려 적다.
 *  · 색은 **섬 윤곽선까지의 거리**로 칠한다 — 직사각형 근사가 아니라 실제 윤곽선이라
 *    화산의 계단형 판이나 사막 한복판의 구멍에도 포말이 정확히 붙는다.
 *  · 애니메이션은 정점 위치가 아니라 **물결선의 위상**을 민다. 보이지 않던 것을
 *    보이는 것으로 바꾼 셈이고, 갱신 비용도 더 싸다.
 */
export function buildWater(stage: StageDef, animated: boolean): WaterBuild {
  const pal = BIOMES[stage.biome];
  const halfW = (stage.gridW - 1) / 2;
  const halfH = (stage.gridH - 1) / 2;
  const diag = Math.hypot(stage.gridW, stage.gridH);
  const edges = rimEdges(stage);
  const cw = stage.gridW + 1;
  const ex = (i: number): number => (i % cw) - halfW - 0.5;
  const ez = (i: number): number => Math.floor(i / cw) - halfH - 0.5;
  // 윤곽선 세그먼트를 평면 배열로 (거리 계산 내부 루프용)
  const seg = new Float32Array(edges.length * 4);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as RimEdge;
    seg[i * 4] = ex(e.a);
    seg[i * 4 + 1] = ez(e.a);
    seg[i * 4 + 2] = ex(e.b);
    seg[i * 4 + 3] = ez(e.b);
  }
  /** 섬 윤곽선까지의 거리 (안팎 구분 없음 — 육지 안은 절벽에 가려 안 보인다) */
  const distToRim = (px: number, pz: number): number => {
    let best = Infinity;
    for (let i = 0; i < seg.length; i += 4) {
      const ax = seg[i] as number;
      const az = seg[i + 1] as number;
      const dx = (seg[i + 2] as number) - ax;
      const dz = (seg[i + 3] as number) - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - (ax + dx * t);
      const qz = pz - (az + dz * t);
      const d = qx * qx + qz * qz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const isLand = (px: number, pz: number): boolean =>
    charAt(stage, Math.round(px + halfW), Math.round(pz + halfH)) !== '~';

  // 격자선: 섬 셀 경계 + 바깥으로 두 겹, 그 밖은 링으로 잇는다
  const NEAR_OFF = [0.4, 1.1];
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = NEAR_OFF.length - 1; i >= 0; i--) xs.push(-halfW - 0.5 - (NEAR_OFF[i] as number));
  for (let x = 0; x <= stage.gridW; x++) xs.push(x - halfW - 0.5);
  for (const o of NEAR_OFF) xs.push(halfW + 0.5 + o);
  for (let i = NEAR_OFF.length - 1; i >= 0; i--) zs.push(-halfH - 0.5 - (NEAR_OFF[i] as number));
  for (let z = 0; z <= stage.gridH; z++) zs.push(z - halfH - 0.5);
  for (const o of NEAR_OFF) zs.push(halfH + 0.5 + o);

  // 정점 목록을 먼저 만들고(위치 + 거리), 색은 그 뒤에 한 번에 칠한다
  const px: number[] = [];
  const pz: number[] = [];
  const idx: number[] = []; // 삼각형 정점 인덱스 (비인덱스로 펼치기 전 단계)
  const vert = (x: number, z: number): number => {
    px.push(x);
    pz.push(z);
    return px.length - 1;
  };
  const quad = (a: number, b: number, cc: number, d: number): void => {
    idx.push(a, b, cc, a, cc, d);
  };

  // 근거리 격자
  const nx = xs.length;
  const nz = zs.length;
  const gid: number[] = new Array<number>(nx * nz).fill(-1);
  const need = (ix: number, iz: number): number => {
    const k = iz * nx + ix;
    let v = gid[k] as number;
    if (v < 0) {
      v = vert(xs[ix] as number, zs[iz] as number);
      gid[k] = v;
    }
    return v;
  };
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      // 셀 중심이 육지이고 윤곽선에서 1.2 이상 안쪽이면 굽지 않는다 — 섬에 완전히
      // 가려지는 자리다. **가장자리 한 겹은 남긴다**: 절벽이 아래로 물려 들어가면서
      // 물 표면(-1.7)을 뚫으므로, 물가 쿼드를 여기서 잘라 내면 그 틈으로 구멍이 보인다.
      const cx = ((xs[ix] as number) + (xs[ix + 1] as number)) * 0.5;
      const cz = ((zs[iz] as number) + (zs[iz + 1] as number)) * 0.5;
      if (isLand(cx, cz) && distToRim(cx, cz) > 1.2) continue;
      quad(need(ix, iz), need(ix, iz + 1), need(ix + 1, iz + 1), need(ix + 1, iz));
    }
  }

  // 원거리 링 — 근거리 격자 테두리에서 바깥으로. 안쪽 링만 테두리와 같은 해상도로
  // 맞추고(색이 아직 변하는 구간이다) 바깥 링은 절반으로 성기게 간다.
  const x0 = xs[0] as number;
  const x1 = xs[nx - 1] as number;
  const z0 = zs[0] as number;
  const z1 = zs[nz - 1] as number;
  const RING_OFF = [1.6, 4.5, 11, diag * 3.2];
  let curX = xs.slice();
  let curZ = zs.slice();
  /**
   * 테두리를 한 바퀴 도는 정점 인덱스 (모서리 중복 없이 닫힌 고리).
   * ⚠ 마지막에 뒤집는다 — (x,z) 평면에서 **시계 방향**이라야 면 노멀이 +y다
   * (x̂ × ẑ = -ŷ 이므로 평면도 기준 반시계는 아랫면이 된다). 타일 상면 쿼드도
   * 같은 규칙을 쓴다. 이걸 틀리면 위에서 볼 때 물이 통째로 백페이스 컬링된다.
   */
  const walk = (rx0: number, rz0: number, rx1: number, rz1: number, sx: number[], sz: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sx.length; i++) out.push(vert(sx[i] as number, rz0));
    for (let i = 1; i < sz.length; i++) out.push(vert(rx1, sz[i] as number));
    for (let i = sx.length - 2; i >= 0; i--) out.push(vert(sx[i] as number, rz1));
    for (let i = sz.length - 2; i >= 1; i--) out.push(vert(rx0, sz[i] as number));
    out.reverse();
    return out;
  };
  let prevRing = walk(x0, z0, x1, z1, curX, curZ);
  for (let r = 0; r < RING_OFF.length; r++) {
    const o = RING_OFF[r] as number;
    const ox0 = x0 - o;
    const oz0 = z0 - o;
    const ox1 = x1 + o;
    const oz1 = z1 + o;
    if (r >= 1) {
      // 두 번째 링부터는 둘레 해상도를 절반으로 (먼 바다는 색이 거의 평평하다)
      curX = curX.filter((_, i) => i % 2 === 0 || i === curX.length - 1);
      curZ = curZ.filter((_, i) => i % 2 === 0 || i === curZ.length - 1);
    }
    // 근거리 격자 상자를 바깥 상자로 선형 확대해 링의 둘레 정점을 만든다
    const kx = (ox1 - ox0) / (x1 - x0);
    const kz = (oz1 - oz0) / (z1 - z0);
    const sx = curX.map((v) => (v - (x0 + x1) / 2) * kx + (ox0 + ox1) / 2);
    const sz = curZ.map((v) => (v - (z0 + z1) / 2) * kz + (oz0 + oz1) / 2);
    const ring = walk(ox0, oz0, ox1, oz1, sx, sz);
    // 안팎 두 테두리를 잇는다. 정점 수가 다르면 비율로 대응시킨다(동일 평면이라
    // T-정션이 생겨도 구멍은 안 난다 — 색만 살짝 다를 수 있고 먼 바다라 안 보인다)
    const inN = prevRing.length;
    const outN = ring.length;
    const n = Math.max(inN, outN);
    for (let i = 0; i < n; i++) {
      const ia = prevRing[Math.floor((i * inN) / n) % inN] as number;
      const ib = prevRing[Math.floor(((i + 1) * inN) / n) % inN] as number;
      const oa = ring[Math.floor((i * outN) / n) % outN] as number;
      const ob = ring[Math.floor(((i + 1) * outN) / n) % outN] as number;
      if (ia !== ib) idx.push(ia, oa, ib);
      if (oa !== ob) idx.push(ib, oa, ob);
    }
    prevRing = ring;
  }

  // --- 정점 색 -----------------------------------------------------------
  const vn = px.length;
  const dist = new Float32Array(vn);
  const wob = new Float32Array(vn);
  for (let i = 0; i < vn; i++) {
    const x = px[i] as number;
    const z = pz[i] as number;
    // 포말/얕은물 경계를 흔들어 직선으로 안 보이게 한다
    wob[i] = Math.sin(x * 1.7 + z * 2.3) * 0.16 + Math.sin(x * 0.61 - z * 0.83) * 0.13;
    dist[i] = distToRim(x, z) + (wob[i] as number);
  }

  const cFoam = new THREE.Color(pal.foam);
  const cShore = new THREE.Color(pal.waterShore);
  const cMid = new THREE.Color(pal.water);
  const cDeep = new THREE.Color(pal.waterDeep);
  const tmp = new THREE.Color();
  const colBuf = new Float32Array(vn * 3);
  /** 거리 d와 시각 t로 정점 색 */
  const paint = (t: number): void => {
    for (let i = 0; i < vn; i++) {
      const d = dist[i] as number;
      /*
       * 수심 구간 — **좁게** 잡는 것이 중요하다. 처음엔 얕은물을 3칸, 중간을 9칸까지
       * 끌었는데 그러면 섬 둘레 한 판 넓이가 통째로 밝아져 "물"이 아니라 **후광**으로
       * 보였다. 썸네일의 얕은물 링은 섬 폭의 10%도 안 된다.
       */
      if (d < 0.26) tmp.copy(cFoam);
      else if (d < 0.62) tmp.copy(cFoam).lerp(cShore, (d - 0.26) / 0.36);
      else if (d < 1.5) tmp.copy(cShore).lerp(cMid, (d - 0.62) / 0.88);
      else if (d < 9) tmp.copy(cMid).lerp(cDeep, (d - 1.5) / 7.5);
      else tmp.copy(cDeep);
      // 물결선 — 섬에서 퍼져 나가는 동심 밴드. 위상을 밀면 파도가 나간다.
      if (d > 0.26) {
        const w = Math.sin(d * 1.9 - t * 1.15) * 0.5 + Math.sin(d * 4.3 + t * 0.7) * 0.5;
        const amp = 0.06 * Math.max(0, 1 - d / 11);
        const l = w * amp;
        tmp.setRGB(
          Math.min(1, Math.max(0, tmp.r + l)),
          Math.min(1, Math.max(0, tmp.g + l)),
          Math.min(1, Math.max(0, tmp.b + l)),
        );
      }
      colBuf[i * 3] = tmp.r;
      colBuf[i * 3 + 1] = tmp.g;
      colBuf[i * 3 + 2] = tmp.b;
    }
  };
  paint(0);

  // 비인덱스로 펼친다 — 평면이라 노멀은 전부 +y지만, factory 계열과 어트리뷰트
  // 구성을 맞춰 두면 나중에 병합/디버그가 쉽다.
  const triN = idx.length / 3;
  const posArr = new Float32Array(triN * 9);
  const colArr = new Float32Array(triN * 9);
  const norArr = new Float32Array(triN * 9);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i] as number;
    posArr[i * 3] = px[v] as number;
    posArr[i * 3 + 1] = 0;
    posArr[i * 3 + 2] = pz[v] as number;
    norArr[i * 3 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norArr, 3));
  const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
  const flush = (): void => {
    const a = colAttr.array as Float32Array;
    for (let i = 0; i < idx.length; i++) {
      const v = (idx[i] as number) * 3;
      a[i * 3] = colBuf[v] as number;
      a[i * 3 + 1] = colBuf[v + 1] as number;
      a[i * 3 + 2] = colBuf[v + 2] as number;
    }
    colAttr.needsUpdate = true;
  };
  flush();
  geo.computeBoundingSphere();

  return {
    geo,
    animate: animated
      ? (time: number): void => {
          paint(time);
          flush();
        }
      : (): void => {
          /* 저사양: 물결 위상 고정 */
        },
  };
}

/** 경로 폴리라인의 누적 호장 테이블 — 셰브런/랩 데모용 공용 헬퍼 */
export function pathArcTable(path: readonly Vec2[]): { pts: Vec2[]; cum: number[]; total: number } {
  const pts = path.slice();
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    total += Math.hypot(b.x - a.x, b.z - a.z);
    cum.push(total);
  }
  return { pts, cum, total };
}

/** 호장 거리 → 경로상 위치/방향 샘플 */
export function samplePath(
  table: { pts: Vec2[]; cum: number[]; total: number },
  dist: number,
  out: { x: number; z: number; heading: number },
): void {
  const { pts, cum, total } = table;
  const d = Math.max(0, Math.min(dist, total));
  let i = 1;
  while (i < cum.length - 1 && (cum[i] as number) < d) i++;
  const a = pts[i - 1] as Vec2;
  const b = pts[i] as Vec2;
  const c0 = cum[i - 1] as number;
  const c1 = cum[i] as number;
  const t = c1 > c0 ? (d - c0) / (c1 - c0) : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.heading = Math.atan2(b.z - a.z, b.x - a.x);
}
