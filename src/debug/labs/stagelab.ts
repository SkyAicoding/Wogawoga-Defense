/**
 * 스테이지 랩 — ?scene=stagelab
 * 목 StageDef(12×16 S자 경로, 슬롯 10, grassland) → stage3d.build.
 * 가짜 적 8마리 경로 순환(EnemyState 직접 구성), 투사체/빔/파티클 데모,
 * fitToPlayfield 리사이즈 대응 확인. ?biome=desert 등으로 바이옴 교체 가능.
 */
import * as THREE from 'three';
import type { BiomeId, EnemyId, EnemyState, ProjectileState, StageDef } from '@/data/types';
import { TICK_DT } from '@/data/types';
import { FixedStepLoop } from '@/core/time';
import { Rng } from '@/core/rng';
import { GameRenderer } from '@/render/renderer';
import { DioramaCamera } from '@/render/camera';
import { build } from '@/render/stage3d';
import { pathArcTable, samplePath } from '@/render/meshlib/terrain';
import { flagsFor } from '@/render/quality';

function mockStage(biome: BiomeId): StageDef {
  // 12×16, S자 경로, 슬롯 10개
  const layout = [
    '~~..........',
    '~........o.~',
    '....o......~',
    '.......o....',
    '..o.........',
    '...........~',
    '~...o...o...',
    '............',
    '....~~......',
    '.o..~~...o..',
    '............',
    '......o.....',
    '~..........~',
    '...o........',
    '~..........~',
    '~~.......~~~',
  ];
  return {
    id: 999,
    nameKey: 'stage.mock',
    biome,
    gridW: 12,
    gridH: 16,
    layout,
    paths: [
      [
        { x: 1, z: 0 },
        { x: 1, z: 4 },
        { x: 9, z: 4 },
        { x: 9, z: 8 },
        { x: 2, z: 8 },
        { x: 2, z: 12 },
        { x: 7, z: 12 },
        { x: 7, z: 14 },
      ],
    ],
    baseCell: { x: 7, z: 14 },
    baseHp: 100,
    startGold: 100,
    waveCount: 10,
    wavePlan: {
      budgetBase: 10,
      budgetGrowth: 1.14,
      hpBase: 1,
      hpGrowth: 1.1,
      seed: 1,
      allowedEnemies: ['raptor'],
      bossOverrides: {},
    },
    firstClearAmber: 10,
    perWaveAmber: 1,
  };
}

const DEMO_ENEMIES: readonly { defId: EnemyId; speed: number; flying: boolean; radius: number }[] = [
  { defId: 'raptor', speed: 2.2, flying: false, radius: 0.3 },
  { defId: 'compy', speed: 2.6, flying: false, radius: 0.18 },
  { defId: 'trike', speed: 1.1, flying: false, radius: 0.42 },
  { defId: 'ptera', speed: 1.8, flying: true, radius: 0.34 },
  { defId: 'ankylo', speed: 0.9, flying: false, radius: 0.4 },
  { defId: 'warrior', speed: 1.4, flying: false, radius: 0.26 },
  // 부족 습격대 4종 — 지오메트리를 공유하므로 네 마리가 **한 메시**로 그려진다.
  // 변형 마스킹(무기/염료)이 인스턴스마다 제대로 갈리는지 눈으로 확인하는 자리다.
  { defId: 'blade', speed: 1.6, flying: false, radius: 0.26 },
  { defId: 'lancer', speed: 1.6, flying: false, radius: 0.28 },
  { defId: 'archer', speed: 1.6, flying: false, radius: 0.24 },
  { defId: 'hexer', speed: 1.6, flying: false, radius: 0.26 },
  { defId: 'mammoth', speed: 0.75, flying: false, radius: 0.55 },
  { defId: 'trex', speed: 0.8, flying: false, radius: 0.6 },
];

export function run(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  const biome = (params.get('biome') ?? 'grassland') as BiomeId;
  const stage = mockStage(biome);

  const quality = flagsFor('high');
  const renderer = new GameRenderer(canvas, quality);
  const cam = new DioramaCamera();
  const stage3d = build(stage, quality);
  const rng = new Rng(20260803);

  // --- 가짜 적: 경로 호장 순환 ---
  const table = pathArcTable(stage.paths[0] ?? []);
  const sample = { x: 0, z: 0, heading: 0 };
  const enemies: EnemyState[] = DEMO_ENEMIES.map((d, i) => {
    samplePath(table, (i / DEMO_ENEMIES.length) * table.total, sample);
    return {
      id: i + 1,
      defId: d.defId,
      hp: 60,
      maxHp: 100,
      shieldHitsLeft: 0,
      dist: (i / DEMO_ENEMIES.length) * table.total,
      pathIndex: 0,
      attackCdLeft: 0,
      towerTargetId: -1,
      siegeHoldLeft: 0,
      attackAnimLeft: 0,
      attackAnimTicks: 0,
      blockerAllyId: -1,
      flying: d.flying,
      x: sample.x,
      z: sample.z,
      prevX: sample.x,
      prevZ: sample.z,
      heading: sample.heading,
      statuses: [],
      bounty: 5,
      baseDamage: 1,
      radius: d.radius,
      alive: true,
      hpMul: 1,
    };
  });

  // --- 가짜 투사체 (ballistic 데모) ---
  const projectiles: ProjectileState[] = [];
  let nextProjId = 1;
  function launchRock(): void {
    const target = enemies[rng.int(0, enemies.length - 1)];
    if (!target) return;
    const startX = 4;
    const startZ = 8; // 슬롯 부근에서 발사
    const flightTicks = 24;
    projectiles.push({
      id: nextProjId++,
      kind: 'ballistic',
      towerDefId: rng.chance(0.5) ? 'catapult' : 'brazier',
      x: startX, y: 0.5, z: startZ,
      prevX: startX, prevY: 0.5, prevZ: startZ,
      targetId: target.id,
      targetX: target.x, targetZ: target.z,
      flightTicks, elapsedTicks: 0,
      startX, startZ,
      arcHeight: 2.2,
      speed: 6,
      dmg: 10,
      targetFlying: false,
      alive: true,
    });
  }

  // --- 30Hz 고정 틱 (렌더 보간 검증) ---
  const loop = new FixedStepLoop(TICK_DT);
  let tickCount = 0;
  function tick(): void {
    tickCount++;
    for (const e of enemies) {
      const d = DEMO_ENEMIES[e.id - 1];
      if (!d) continue;
      e.prevX = e.x;
      e.prevZ = e.z;
      e.dist = (e.dist + d.speed * TICK_DT) % table.total;
      samplePath(table, e.dist, sample);
      e.x = sample.x;
      e.z = sample.z;
      e.heading = sample.heading;
      // 체력 오르내림 (체력바 데모)
      e.hp = 20 + (Math.sin(tickCount * 0.02 + e.id) * 0.5 + 0.5) * 75;
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (!p) continue;
      p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
      p.elapsedTicks++;
      const t = p.elapsedTicks / p.flightTicks;
      p.x = p.startX + (p.targetX - p.startX) * t;
      p.z = p.startZ + (p.targetZ - p.startZ) * t;
      if (p.elapsedTicks >= p.flightTicks) {
        // 착탄 먼지 버스트
        const v = stage3d.cellToWorld(p.x, p.z);
        const dust = p.towerDefId === 'brazier' ? 0xff8a2e : 0xc9b491;
        stage3d.particles.burst(v.x, 0.25, v.z, dust, 14, 2.8, 0.1, 0.55, { upBias: 0.8 });
        projectiles.splice(i, 1);
      }
    }
    // 주기 이벤트: 투사체/빔/플래시/파티클
    if (tickCount % 36 === 0) launchRock();
    if (tickCount % 75 === 0) {
      const a = enemies[rng.int(0, enemies.length - 1)];
      if (a) {
        stage3d.projectiles.addBeam([
          { x: 4, z: 8 },
          { x: a.x, z: a.z, flying: a.flying },
        ]);
        stage3d.enemies.setHitFlash(a.id);
      }
    }
    if (tickCount % 50 === 0) {
      const a = enemies[rng.int(0, enemies.length - 1)];
      if (a) {
        const v = stage3d.cellToWorld(a.x, a.z);
        stage3d.particles.burst(v.x, 0.4, v.z, 0xffd24a, 10, 2.4, 0.08, 0.5);
        stage3d.enemies.setHitFlash(a.id);
      }
    }
    if (tickCount % 240 === 0) stage3d.decals.pulseChevrons();
    if (tickCount % 300 === 0) {
      stage3d.setBaseDamageLevel(((tickCount / 300) % 3) as 0 | 1 | 2);
    }
  }

  // --- 데모 타워 배치 + 데칼 ---
  const slots = [
    { id: 1, defId: 'spear' as const, cell: { x: 4, z: 2 }, tier: 0 },
    { id: 2, defId: 'catapult' as const, cell: { x: 2, z: 4 }, tier: 2 },
    { id: 3, defId: 'lightning' as const, cell: { x: 4, z: 6 }, tier: 4 },
    { id: 4, defId: 'frost' as const, cell: { x: 8, z: 6 }, tier: 1 },
    { id: 5, defId: 'drum' as const, cell: { x: 9, z: 9 }, tier: 3 },
    { id: 6, defId: 'brazier' as const, cell: { x: 1, z: 9 }, tier: 4 },
  ];
  for (const s of slots) stage3d.towers.add(s.id, s.defId, s.tier, s.cell.x, s.cell.z);
  stage3d.decals.showRange(4, 6, 2.5);
  stage3d.decals.setSlotsVisible(true);
  stage3d.towers.setGhost('ballista', 6, 11, true);

  // --- 카메라 fit: 하단 30%는 카드 핸드 영역으로 가정. ?fit=0.5 로 줌 검사 ---
  const fitScale = Math.max(0.2, Math.min(1, Number(params.get('fit') ?? '1') || 1));
  function refit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    const handH = Math.min(h * 0.3, 240);
    const aabb = stage3d.aabb.clone();
    if (fitScale < 1) {
      const c = aabb.getCenter(new THREE.Vector3());
      const s = aabb.getSize(new THREE.Vector3()).multiplyScalar(fitScale * 0.5);
      aabb.setFromCenterAndSize(c, s.multiplyScalar(2));
    }
    cam.fitToPlayfield(aabb, { x: 0, y: 0, w, h: h - handH }, w, h);
  }
  window.addEventListener('resize', refit);
  refit();

  let last = -1;
  let recoilTimer = 0;
  renderer.gl.setAnimationLoop((timeMs: number) => {
    const now = timeMs / 1000;
    const dt = last < 0 ? 1 / 60 : Math.min(now - last, 0.1);
    last = now;
    const { ticks, alpha } = loop.update(now);
    for (let i = 0; i < ticks; i++) tick();

    recoilTimer += dt;
    if (recoilTimer > 1.1) {
      recoilTimer = 0;
      const s = slots[Math.floor(now) % slots.length];
      if (s) stage3d.towers.recoil(s.id);
    }

    stage3d.enemies.update(enemies, alpha, stage3d.cellToWorld, dt);
    stage3d.healthbars.update(enemies, [], alpha, stage3d.cellToWorld);
    stage3d.projectiles.update(projectiles, alpha, dt);
    stage3d.update(dt);
    cam.update(dt);
    renderer.render(stage3d.scene, cam.camera);
  });

  console.log('[stagelab] 시작 — biome:', biome);
  // 디버그 훅 (Playwright 검사용)
  Object.assign(window as unknown as Record<string, unknown>, {
    __stagelab: { stage3d, renderer, cam, enemies },
  });
}
