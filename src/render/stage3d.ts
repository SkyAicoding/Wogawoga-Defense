/**
 * 스테이지 3D 조립 — 지형/소품/기지/뷰/파티클/라이팅/물/안개를 하나로.
 * sim 임포트 없이 StageDef + 상태 배열(EnemyState 등)만으로 동작한다.
 */
import * as THREE from 'three';
import type { StageDef } from '@/data/types';
import { Rng, hashSeed } from '@/core/rng';
import { cellKey, sceneryCells } from '@/data/grid';
import { BIOMES, flatMat } from './palette';
import { buildParts, type PartSpec } from './meshlib/factory';
import { buildStage as buildTerrain, type CellToWorld } from './meshlib/terrain';
import { buildProps } from './meshlib/props';
import { createBasecamp, type Basecamp } from './meshlib/basecamp';
import { EnemyView } from './views/enemyview';
import { TowerView } from './views/towerview';
import { ProjectileView } from './views/projectileview';
import { HealthBarView } from './views/healthbars';
import { Decals } from './views/decals';
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
  particles: ParticleSystem;
  basecamp: Basecamp;
  /** 기지 피해 외형 0=온전/1=파손/2=반파 */
  setBaseDamageLevel(level: 0 | 1 | 2): void;
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

/** 부유섬 하부 뾰족 바위 파트 */
function underRocks(stage: StageDef, seed: number): PartSpec[] {
  const rng = new Rng(seed);
  const parts: PartSpec[] = [];
  const halfW = stage.gridW / 2;
  const halfH = stage.gridH / 2;
  const pal = BIOMES[stage.biome];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = rng.range(-halfW * 0.7, halfW * 0.7);
    const z = rng.range(-halfH * 0.7, halfH * 0.7);
    const s = rng.range(1.6, 3.0);
    parts.push({
      kind: 'cone',
      pos: [x, -2.1 - s * 0.6, z],
      rot: [Math.PI, rng.range(0, 3), 0],
      scale: [s * 0.8, s * 2.4, s * 0.8],
      color: pal.cliff[1],
      hueJitter: 0.012,
      seg: 5,
    });
  }
  return parts;
}

export function build(stage: StageDef, quality?: QualityFlags): Stage3D {
  const q = quality ?? flagsFor('high');
  const pal = BIOMES[stage.biome];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pal.sky);
  const diag = Math.hypot(stage.gridW, stage.gridH);
  scene.fog = new THREE.Fog(pal.fog, diag * 2.2, diag * 5);

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
  const basecamp = createBasecamp();
  const baseV = terrain.cellToWorld(stage.baseCell.x, stage.baseCell.z);
  basecamp.group.position.set(baseV.x, 0, baseV.z);
  root.add(basecamp.group);

  // 부유섬 하부 바위
  const underGeo = buildParts(underRocks(stage, hashSeed(`under:${stage.id}`)), {
    seed: 3,
    ao: 0.35,
  });
  const underMesh = new THREE.Mesh(underGeo, flatMat());
  root.add(underMesh);

  // --- 물 평면 (버텍스 흔들림은 quality 게이트) ---
  const waterSize = diag * 6;
  const waterGeo = q.waterAnim
    ? new THREE.PlaneGeometry(waterSize, waterSize, 24, 24)
    : new THREE.PlaneGeometry(waterSize, waterSize, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshLambertMaterial({ color: pal.water });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -1.7;
  water.receiveShadow = q.shadows;
  scene.add(water);
  const waterBase = q.waterAnim
    ? Float32Array.from(waterGeo.getAttribute('position').array as Float32Array)
    : null;

  // --- 라이팅: 태양 (타이트 섀도) + 헤미스피어 ---
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
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
  scene.add(new THREE.HemisphereLight(pal.sky, pal.hemiGround, 1.15));
  if (stage.biome === 'volcano') {
    // 용암 바닥광
    const lavaGlow = new THREE.PointLight(0xff5a1a, 60, diag * 2);
    lavaGlow.position.set(0, -3, 0);
    scene.add(lavaGlow);
  }

  // --- 뷰 계층 ---
  const enemies = new EnemyView(scene);
  const towers = new TowerView(scene, terrain.cellToWorld);
  const projectiles = new ProjectileView(scene, terrain.cellToWorld);
  const healthbars = new HealthBarView(scene);
  const decals = new Decals(scene, terrain.cellToWorld);
  // 자유 배치: 배치 모드 하이라이트는 건설 가능한 셀(소품 제외)에
  decals.init(
    terrain.buildableCells.filter((c) => !scenery.has(cellKey(stage, c.x, c.z))),
    stage.paths,
  );
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
    particles,
    basecamp,
    setBaseDamageLevel: (level) => basecamp.setDamageLevel(level),
    clearScenery(cellX: number, cellZ: number): boolean {
      if (!props.removeCell(cellX, cellZ)) return false;
      decals.addSlotCell(cellX, cellZ);
      return true;
    },
    sceneryOffset: (cellX: number, cellZ: number) => props.offsetOf(cellX, cellZ),
    update(dt: number): void {
      time += dt;
      towers.update(dt);
      decals.update(dt);
      particles.update(dt);
      // 기지 모닥불 연기/불티 (피해 클수록 검은 연기)
      const lvl = basecamp.smokeLevel();
      if (Math.floor(time * 9) !== Math.floor((time - dt) * 9)) {
        firePos.copy(basecamp.fireOffset).add(basecamp.group.position);
        const smokeColor = lvl === 0 ? 0xffb02e : lvl === 1 ? 0x8a8078 : 0x4a4644;
        particles.trail(firePos.x, firePos.y, firePos.z, smokeColor, lvl === 0 ? 0.06 : 0.1);
      }
      // 물 버텍스 흔들림
      if (waterBase) {
        const attr = waterGeo.getAttribute('position');
        const arr = attr.array as Float32Array;
        for (let i = 0; i < attr.count; i++) {
          const x = waterBase[i * 3] as number;
          const z = waterBase[i * 3 + 2] as number;
          arr[i * 3 + 1] = Math.sin(time * 1.4 + x * 0.35 + z * 0.5) * 0.09;
        }
        attr.needsUpdate = true;
      }
    },
    dispose(): void {
      enemies.dispose();
      towers.dispose();
      projectiles.dispose();
      healthbars.dispose();
      decals.dispose();
      particles.dispose();
      terrain.dispose();
      props.dispose();
      basecamp.dispose();
      underGeo.dispose();
      waterGeo.dispose();
      waterMat.dispose();
      // 그림자 맵(렌더 타깃)은 씬을 버려도 GPU에 남는다 — 전투를 반복하면
      // 진입마다 텍스처가 쌓이므로 여기서 명시적으로 반납한다 (DirectionalLight.dispose가
      // shadow.map/mapPass를 함께 버린다)
      sun.dispose();
    },
  };
}
