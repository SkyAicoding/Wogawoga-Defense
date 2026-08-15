/**
 * 스테이지 3D 조립 — 지형/소품/기지/뷰/파티클/라이팅/물/안개를 하나로.
 * sim 임포트 없이 StageDef + 상태 배열(EnemyState 등)만으로 동작한다.
 */
import * as THREE from 'three';
import type { StageDef } from '@/data/types';
import { cellKey, sceneryCells } from '@/data/grid';
import { BASE_LEVEL_MAX } from '@/data/hometown';
import { BIOMES, flatMat } from './palette';
import {
  buildStage as buildTerrain,
  buildWater,
  WATER_Y,
  type CellToWorld,
} from './meshlib/terrain';
import { buildProps } from './meshlib/props';
import { buildGroundDetail } from './meshlib/grounddetail';
import { createBasecamp, type Basecamp } from './meshlib/basecamp';
import { EnemyView } from './views/enemyview';
import { TowerView } from './views/towerview';
import { ProjectileView } from './views/projectileview';
import { HealthBarView } from './views/healthbars';
import { Decals } from './views/decals';
import { TowerMarksView } from './views/towerstatus';
import { ParticleSystem } from './particles';
import { flagsFor, type QualityFlags } from './quality';

export interface Stage3D {
  scene: THREE.Scene;
  /** 지형+소품+기지 루트 그룹 */
  root: THREE.Group;
  cellToWorld: CellToWorld;
  aabb: THREE.Box3;
  enemies: EnemyView;
  towers: TowerView;
  projectiles: ProjectileView;
  healthbars: HealthBarView;
  decals: Decals;
  /** 파괴 잔해 + 침묵 룬 지속 표식 (그리기는 healthbars 메시가 맡는다 — 드로우콜 1) */
  towerStatus: TowerMarksView;
  particles: ParticleSystem;
  basecamp: Basecamp;
  /** 기지 피해 외형 0=온전/1=파손/2=반파 */
  setBaseDamageLevel(level: 0 | 1 | 2): void;
  /**
   * 홈타운 레벨 외형 (1-base). 지금은 마을 스케일만 커진다 —
   * 실제 구조물 성장은 3단계가 meshlib/basecamp.ts 안에서 만든다.
   */
  setBaseLevel(level: number): void;
  /**
   * 소품 제거 반영 — 그 셀의 소품을 지우고 남은 소품을 재병합(드로우콜 유지),
   * 배치 하이라이트 슬롯에 셀을 편입한다. sim의 sceneryCleared 이벤트에만 반응한다.
   */
  clearScenery(cellX: number, cellZ: number): boolean;
  /**
   * 그 셀 소품의 셀 중심 대비 산포 오프셋 (소품이 없으면 null).
   * 선택 링을 실제 밑동에 맞추는 데 쓴다.
   */
  sceneryOffset(cellX: number, cellZ: number): { dx: number; dz: number } | null;
  /** 매 프레임: 뷰 애니/물결/파티클 갱신 */
  update(dt: number): void;
  dispose(): void;
}

export function build(stage: StageDef, quality?: QualityFlags): Stage3D {
  const q = quality ?? flagsFor('high');
  const pal = BIOMES[stage.biome];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pal.sky);
  const diag = Math.hypot(stage.gridW, stage.gridH);
  // 안개 구간은 바이옴마다 다르다 — 사막은 멀리까지 트여 있고(6.0) 늪·화산은
  // 섬 둘레부터 삼킨다(3.2/3.4). 늪의 "보라 안개 배경"과 화산의 "어둠 속 용암"이
  // 사실상 이 두 숫자에서 나온다.
  scene.fog = new THREE.Fog(pal.fog, diag * pal.fogRange[0], diag * pal.fogRange[1]);

  const root = new THREE.Group();
  root.name = 'stageRoot';
  scene.add(root);

  // --- 지형 + 소품 + 기지 ---
  const terrain = buildTerrain(stage);
  root.add(terrain.group);
  const scenery = sceneryCells(stage, terrain.pathCells);
  const sceneryList = [...scenery].map((k) => ({ x: k % stage.gridW, z: Math.floor(k / stage.gridW) }));
  const props = buildProps(stage.biome, sceneryList, terrain.cellToWorld, stage.id);
  root.add(props.group);
  /*
   * 소품이 없는 건설 가능 셀 = **맨 셀**. 건설 가능 셀의 70%가 여기이고, 개편 전에는
   * 그 칸이 쿼드 한 장 + 타일색 하나뿐이라 화면 절반이 단색 체커보드였다.
   * ⚠ 이 배열은 아래 decals.init 과 **같은 것을 쓴다**(따로 계산하지 않는다).
   *   두 곳이 갈리면 "장식은 있는데 배치 하이라이트가 없는 칸"이 생긴다.
   */
  const bareCells = terrain.buildableCells.filter((c) => !scenery.has(cellKey(stage, c.x, c.z)));
  const groundDetail = buildGroundDetail(
    stage,
    terrain.pathCells,
    bareCells,
    terrain.cellToWorld,
    q.groundDetail,
  );
  root.add(groundDetail.group);
  const basecamp = createBasecamp();
  const baseV = terrain.cellToWorld(stage.baseCell.x, stage.baseCell.z);
  basecamp.group.position.set(baseV.x, 0, baseV.z);
  root.add(basecamp.group);

  // --- 물/용암 (수심 밴드 + 포말은 terrain 쪽에서 굽는다) ---
  const waterBuild = buildWater(stage, q.waterAnim);
  const water = new THREE.Mesh(waterBuild.geo, flatMat());
  water.position.y = WATER_Y;
  water.receiveShadow = q.shadows;
  scene.add(water);

  // --- 라이팅: 태양 (타이트 섀도) + 헤미스피어 ---
  // 빛도 바이옴 자산이다 — 사막은 희고 뜨겁게(2.9), 늪은 흐리게(1.75),
  // 화산은 낮춰서(1.9) 용암이 화면의 유일한 광원처럼 읽히게 한다.
  const sun = new THREE.DirectionalLight(pal.sun, pal.sunPower);
  sun.position.set(diag * 0.7, diag * 1.1, diag * 0.4);
  sun.castShadow = q.shadows;
  if (q.shadows) {
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const r = diag * 0.62;
    sun.shadow.camera.left = -r;
    sun.shadow.camera.right = r;
    sun.shadow.camera.top = r;
    sun.shadow.camera.bottom = -r;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = diag * 3;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
  }
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(pal.sky, pal.hemiGround, pal.hemiPower));
  if (stage.biome === 'volcano') {
    // 용암 바닥광 — 태양을 낮춘 만큼 이쪽을 올려 절벽 하단이 아래에서 달아오르게 한다
    const lavaGlow = new THREE.PointLight(0xff5a1a, 120, diag * 2.2);
    lavaGlow.position.set(0, -2.4, 0);
    scene.add(lavaGlow);
  }

  // --- 뷰 계층 ---
  const enemies = new EnemyView(scene);
  const towers = new TowerView(scene, terrain.cellToWorld);
  const projectiles = new ProjectileView(scene, terrain.cellToWorld);
  const healthbars = new HealthBarView(scene);
  const decals = new Decals(scene, terrain.cellToWorld);
  const towerStatus = new TowerMarksView();
  // 자유 배치: 배치 모드 하이라이트는 건설 가능한 셀(소품 제외) — 바닥 결과 같은 목록
  decals.init(bareCells, stage.paths);
  const particles = new ParticleSystem(scene, q.particleMax);
  if (q.ambientParticles) particles.setEnvironment(stage.biome, terrain.aabb);

  let time = 0;
  const firePos = new THREE.Vector3();

  return {
    scene,
    root,
    cellToWorld: terrain.cellToWorld,
    aabb: terrain.aabb,
    enemies,
    towers,
    projectiles,
    healthbars,
    decals,
    towerStatus,
    particles,
    basecamp,
    setBaseDamageLevel: (level) => basecamp.setDamageLevel(level),
    setBaseLevel: (level) => basecamp.setLevel(level, BASE_LEVEL_MAX),
    clearScenery(cellX: number, cellZ: number): boolean {
      if (!props.removeCell(cellX, cellZ)) return false;
      // 치운 자리도 이제 맨 셀이다 — 결을 얹지 않으면 그 칸만 대머리로 남아
      // "치운 자리"가 아니라 렌더 버그로 보인다
      groundDetail.addCell(cellX, cellZ);
      decals.addSlotCell(cellX, cellZ);
      towerStatus.clearCell(cellX, cellZ);
      return true;
    },
    sceneryOffset: (cellX: number, cellZ: number) => props.offsetOf(cellX, cellZ),
    update(dt: number): void {
      time += dt;
      towers.update(dt);
      towerStatus.tick(dt);
      healthbars.tick(dt);
      decals.update(dt);
      particles.update(dt);
      // 기지 모닥불 연기/불티 (피해 클수록 검은 연기)
      const lvl = basecamp.smokeLevel();
      if (Math.floor(time * 9) !== Math.floor((time - dt) * 9)) {
        firePos.copy(basecamp.fireOffset).add(basecamp.group.position);
        const smokeColor = lvl === 0 ? 0xffb02e : lvl === 1 ? 0x8a8078 : 0x4a4644;
        particles.trail(firePos.x, firePos.y, firePos.z, smokeColor, lvl === 0 ? 0.06 : 0.1);
      }
      // 물결 — 정점 위치가 아니라 **물결선의 위상**을 민다.
      // (예전의 진폭 0.09 세로 흔들림은 이 카메라에서 한 픽셀도 안 움직였다)
      waterBuild.animate(time);
    },
    dispose(): void {
      enemies.dispose();
      towers.dispose();
      projectiles.dispose();
      healthbars.dispose();
      decals.dispose();
      towerStatus.dispose();
      particles.dispose();
      terrain.dispose();
      props.dispose();
      groundDetail.dispose();
      basecamp.dispose();
      waterBuild.geo.dispose();
      // 그림자 맵(렌더 타깃)은 씬을 버려도 GPU에 남는다 — 전투를 반복하면
      // 진입마다 텍스처가 쌓이므로 여기서 명시적으로 반납한다 (DirectionalLight.dispose가
      // shadow.map/mapPass를 함께 버린다)
      sun.dispose();
    },
  };
}
