/**
 * 지형/물 지오메트리의 **예산·불변식 계약**.
 *
 * 이 파일이 생긴 이유는 하나다. 섬을 "썸네일처럼" 보이게 고치는 작업은 전부
 * 지오메트리를 더 얹고 싶어지는 압력인데, 이 프로젝트의 진짜 제약은 그림이 아니라
 * **삼각형 예산**(전체 프레임 150,000 / 드로우콜 90)이고, 지형과 소품은 그림자
 * 캐스터라 **프레임에서 두 번 청구된다**. 그래서 "예뻐 보이니 됐다"로 끝내면
 * 여섯 판 중 어딘가가 조용히 예산을 넘는다 (실제로 s3~s6이 그 상태였다).
 *
 * 여기서 잠그는 것은 네 가지다.
 *  ① 스테이지별 정적 지오메트리 삼각형 상한 — 아래 표는 **실측값 + 여유**다.
 *  ② 메시 개수(=드로우콜) — 지형 2 + 물 1 에서 늘어나면 안 된다.
 *  ③ 물 삼각형의 앞면 방향 — 한 번 뒤집혀서 물이 통째로 사라진 적이 있다.
 *  ④ 게임플레이 불변 — 렌더가 내놓는 셀 판정이 sim과 공유하는 grid 헬퍼와 같아야 한다.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStage, buildWater, WATER_Y } from '@/render/meshlib/terrain';
import { BIOMES } from '@/render/palette';
import { STAGES } from '@/data/stages';
import { buildableCells, rasterizePathCells, charAt } from '@/data/grid';
import type { StageDef } from '@/data/types';

function triCount(geo: THREE.BufferGeometry): number {
  return geo.getAttribute('position').count / 3;
}

/** group 아래 실제로 그려지는 메시들 */
function meshes(group: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

/**
 * 스테이지별 정적 지형 삼각형 상한.
 *
 * ⚠ 이 수를 **올리려면** 왜 올리는지와 함께 프레임 실측을 다시 붙여야 한다.
 * 지형(tile)은 섀도 캐스터라 프레임 청구가 ×2, 장식(deco)과 물은 캐스터가 아니라 ×1이다.
 * 곧 **프레임 몫 = 2×tile + deco + water**.
 *
 * 아래 상한은 개편 직후 실측에 25% 여유를 준 값이다. 실측(개편 전 → 개편 후):
 *   s1 tile 3,500→806 · deco 70→276 · water 1,152→658 · 프레임 8,222→2,546
 *   s2 3,548→784 · 70→278 · 1,152→696 · 8,318→2,542
 *   s3 4,052→988 · 70→298 · 1,152→726 · 9,326→3,000
 *   s4 3,548→816 · 70→280 · 1,152→730 · 8,318→2,642
 *   s5 3,880→924 · 70→324 · 1,152→840 · 8,982→3,012
 *   s6 4,144→1,050 · 70→368 · 1,152→820 · 9,510→3,288
 * (개편 전 지형은 셀마다 박스를 쌓았고 물은 24×24 단색 평면이었다. 브라우저
 *  renderInfo A/B와 이 표의 차이가 스테이지당 12~25삼각형 안에서 일치한다.)
 */
const TRI_CAP: Record<number, { tile: number; deco: number; water: number }> = {
  1: { tile: 1010, deco: 345, water: 825 },
  2: { tile: 980, deco: 350, water: 870 },
  3: { tile: 1235, deco: 375, water: 910 },
  4: { tile: 1020, deco: 350, water: 915 },
  5: { tile: 1155, deco: 405, water: 1050 },
  6: { tile: 1315, deco: 460, water: 1025 },
};

describe('지형 지오메트리 예산', () => {
  for (const stage of STAGES) {
    it(`s${stage.id}(${stage.biome}) — 삼각형 상한과 메시 개수`, () => {
      const t = buildStage(stage);
      const ms = meshes(t.group);
      // 지형은 **2메시 고정**: [상면+절벽+'#'바위](섀도 캐스터) / [장식](캐스터 아님).
      // 여기가 3이 되면 드로우콜이 늘어난 것이다.
      expect(ms).toHaveLength(2);
      const [tile, deco] = ms as [THREE.Mesh, THREE.Mesh];
      expect(tile.castShadow, '상면·절벽은 섬 그림자를 물 위에 드리운다').toBe(true);
      expect(deco.castShadow, '장식이 섀도를 구우면 삼각형이 2배로 청구된다').toBe(false);

      const cap = TRI_CAP[stage.id] as { tile: number; deco: number; water: number };
      const tileTris = triCount(tile.geometry);
      const decoTris = triCount(deco.geometry);
      const water = buildWater(stage, true);
      const waterTris = triCount(water.geo);
      const msg = `s${stage.id} tile=${tileTris} deco=${decoTris} water=${waterTris}`;
      expect(tileTris, msg).toBeLessThanOrEqual(cap.tile);
      expect(decoTris, msg).toBeLessThanOrEqual(cap.deco);
      expect(waterTris, msg).toBeLessThanOrEqual(cap.water);
      // 공허하지 않은지 — 개편 전 값(타일만 2,000~2,300)보다 한참 아래지만 0은 아니어야 한다
      expect(tileTris).toBeGreaterThan(300);
      expect(waterTris).toBeGreaterThan(200);

      water.geo.dispose();
      t.dispose();
    });
  }
});

describe('물 평면', () => {
  it('모든 삼각형이 위를 향한다 (감김이 뒤집히면 물이 통째로 백페이스 컬링된다)', () => {
    // 실제로 한 번 겪은 버그다: 링 둘레를 (x,z) 평면에서 반시계로 돌았더니
    // x̂ × ẑ = -ŷ 때문에 면 노멀이 아래를 향해, 섬 근처 격자만 남고 바다가 사라졌다.
    const stage = STAGES[5] as StageDef; // 화산 — 계단형이라 링 접합이 가장 까다롭다
    const { geo } = buildWater(stage, false);
    const pos = geo.getAttribute('position');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let down = 0;
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      b.sub(a);
      c.sub(a);
      if (b.cross(c).y < 0) down++;
    }
    expect(down, '아래를 향하는 삼각형').toBe(0);
    geo.dispose();
  });

  it('섬 윤곽선 안쪽까지 덮는다 — 절벽이 물을 뚫고 내려가므로 물가가 비면 구멍이 보인다', () => {
    const stage = STAGES[0] as StageDef;
    const { geo } = buildWater(stage, false);
    const pos = geo.getAttribute('position');
    const halfW = (stage.gridW - 1) / 2;
    const halfH = (stage.gridH - 1) / 2;
    // 섬 가장자리 셀 중심 바로 아래에 물 정점이 존재해야 한다
    let nearRim = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (Math.abs(x) <= halfW + 0.5 && Math.abs(z) <= halfH + 0.5) nearRim++;
    }
    expect(nearRim).toBeGreaterThan(0);
    // 물 높이는 지오메트리에서 0, 배치에서 WATER_Y — 절벽 프로파일이 이 값을 전제로 한다
    expect(WATER_Y).toBeLessThan(0);
    geo.dispose();
  });
});

describe('결정론과 게임플레이 불변', () => {
  it('같은 스테이지는 매번 같은 지오메트리를 만든다', () => {
    const stage = STAGES[2] as StageDef;
    const a = buildStage(stage);
    const b = buildStage(stage);
    const pa = meshes(a.group)[0]!.geometry.getAttribute('position').array as Float32Array;
    const pb = meshes(b.group)[0]!.geometry.getAttribute('position').array as Float32Array;
    expect(pa.length).toBe(pb.length);
    let diff = 0;
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) diff++;
    expect(diff, '위치가 다른 성분 수').toBe(0);
    a.dispose();
    b.dispose();
  });

  it('셀 판정은 sim과 공유하는 grid 헬퍼와 정확히 같다', () => {
    for (const stage of STAGES) {
      const t = buildStage(stage);
      const pathCells = rasterizePathCells(stage);
      expect([...t.pathCells].sort()).toEqual([...pathCells].sort());
      expect(t.buildableCells).toEqual(buildableCells(stage, pathCells));
      // freeCells 는 '.'이면서 경로가 아닌 칸 — 소품 산포 후보다
      for (const c of t.freeCells) {
        expect(charAt(stage, c.x, c.z)).toBe('.');
        expect(pathCells.has(c.z * stage.gridW + c.x)).toBe(false);
      }
      t.dispose();
    }
  });

  it('타일 상면은 전부 정확히 y=0 — 높이 지터를 되살리면 쿼드 사이가 벌어진다', () => {
    /*
     * 상면을 박스(12삼각형)에서 쿼드(2삼각형)로 바꾸면서 셀별 높이 지터(±0.02)를 없앴다.
     * 옆면이 없어졌으므로 이웃 쿼드의 높이가 다르면 그 틈으로 배경이 그대로 비친다.
     * "결"은 높이가 아니라 색으로 낸다 — 이 계약이 그 결정을 잠근다.
     */
    const stage = STAGES[4] as StageDef;
    const t = buildStage(stage);
    const pos = meshes(t.group)[0]!.geometry.getAttribute('position');
    let topVerts = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > -1e-6) {
        // y>=0 에 있는 것은 상면(정확히 0)과 '#' 바위(최대 0.2 + 반지름 0.275)뿐이다
        expect(Math.abs(y)).toBeLessThan(0.5);
        if (Math.abs(y) < 1e-6) topVerts++;
      }
    }
    expect(topVerts).toBeGreaterThan(100);
    t.dispose();
  });
});

describe('바이옴 팔레트', () => {
  it('여섯 바이옴이 물·빛·결 필드를 빠짐없이 갖는다', () => {
    for (const [id, p] of Object.entries(BIOMES)) {
      expect(p.ground.length, id).toBeGreaterThanOrEqual(3);
      expect(p.path.length, id).toBeGreaterThanOrEqual(3);
      for (const v of [p.water, p.waterDeep, p.waterShore, p.foam, p.shoreSand, p.cliffBand, p.sun]) {
        expect(v, id).toBeGreaterThanOrEqual(0);
        expect(v, id).toBeLessThanOrEqual(0xffffff);
      }
      expect(p.fogRange[0], id).toBeLessThan(p.fogRange[1]);
      expect(p.sunPower, id).toBeGreaterThan(0);
      expect(p.hemiPower, id).toBeGreaterThan(0);
      expect(p.grain.accent, id).toBeGreaterThanOrEqual(0);
      expect(p.grain.accent, id).toBeLessThan(0.5);
    }
  });

  it('섬이 배경에서 분리된다 — 지면과 물의 휘도차 (정글·늪이 여기서 깨져 있었다)', () => {
    /*
     * 개편 전 정글은 지면 0x3fa855(휘도 140)와 물 0x2fb39c(149)의 차이가 4%뿐이라
     * 섬이 바다에 녹아 있었다. 사람 눈이 윤곽을 잡으려면 최소 15% 안팎은 필요하다.
     * 여기서 재는 것은 **먼 바다(waterDeep)** 와 지면 대표색의 차다 — 얕은물 링은
     * 일부러 밝게 두므로(포말 쪽) 기준이 못 된다.
     */
    const lum = (hex: number): number =>
      0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255);
    for (const [id, p] of Object.entries(BIOMES)) {
      const g = lum(p.ground[0] as number);
      const w = lum(p.waterDeep);
      const rel = Math.abs(g - w) / Math.max(g, w, 1);
      expect(rel, `${id} 지면 ${g.toFixed(0)} vs 먼바다 ${w.toFixed(0)}`).toBeGreaterThan(0.15);
    }
  });
});
