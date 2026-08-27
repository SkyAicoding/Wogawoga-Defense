/**
 * **도감 액션 미리보기** — 타워가 어떻게 쏘고 무엇이 날아가 어떻게 터지는지를
 * 레벨별로 **플레이 전에** 보여 준다.
 *
 * 사용자 요구:
 *   > "도감 메뉴에서 각 레벨별로 액션 미리 볼수 있는 기능 만들어줘.
 *   >  게임 플레이 하기 전에 어떤 모양으로 던지고 터지는지 볼수 있는 메뉴 말이야"
 *
 * ── 왜 별도 캔버스인가 ───────────────────────────────────────────────────────
 * 도감은 로비 화면 위의 DOM 시트다. 전투 렌더러(`GameRenderer`)는 판·적·HUD 를 통째로
 * 들고 있어 여기 끌어오면 화면 하나를 더 만드는 일이 된다. 반대로 이 미리보기가 필요한
 * 것은 **타워 하나 · 투사체 하나 · 폭발 하나**뿐이라, 작은 씬을 따로 세우는 쪽이
 * 훨씬 싸고 서로를 안 건드린다(`?scene=meshlab` 이 같은 이유로 같은 구조다).
 *
 * ⚠ **뷰는 전부 실물을 그대로 쓴다** — `TowerView`·`ProjectileView`·`ParticleSystem`.
 *   미리보기용으로 다시 그리면 "도감에서 본 것과 판에서 나오는 것이 다른" 꼴이 되고,
 *   그건 이 저장소가 반복해서 당한 병이다. 티어 마스킹도 실물 경로(`aVarSel`)를 탄다.
 *
 * ⚠ WebGL 컨텍스트를 하나 더 연다. 그래서 시트가 닫힐 때 **반드시 `dispose()`** 한다 —
 *   브라우저 컨텍스트 상한(보통 8~16)에 걸리면 **가장 오래된 것이 강제로 죽는다**.
 *   그 희생자가 게임 본 캔버스일 수 있다.
 */
import * as THREE from 'three';
import type { ProjectileState, TowerDef, TowerId, TowerState } from '@/data/types';
import { TowerView } from '@/render/views/towerview';
import { ProjectileView } from '@/render/views/projectileview';
import { ParticleSystem } from '@/render/particles';
import { projectileTint } from '@/render/meshlib/projectiles';
import { h } from '../dom';

/** 미리보기 격자 = 월드 좌표 (타일 수가 곧 거리) */
const cellToWorld = (x: number, z: number, out?: THREE.Vector3): THREE.Vector3 =>
  (out ?? new THREE.Vector3()).set(x, 0, z);

/** 타워는 원점, 표적은 앞쪽 이만큼 (한 화면에 둘 다 들어오는 최대 거리) */
const TARGET_X = 2.4;
/** 한 발의 비행 시간 (초) — 실제 속도보다 느리다. 보라고 만든 화면이라 눈이 따라가야 한다 */
const FLIGHT = 0.75;
/** 발사 간격 (초) */
const CYCLE = 2.0;

/** 종별 폭발 색 — 투사체 색조와 **같은 출처**라 날아간 것과 터진 것이 짝지어 읽힌다 */
function impactColors(id: TowerId): { core: number; debris: number } {
  const t = projectileTint(id);
  const to255 = (v: number): number => Math.max(0, Math.min(255, Math.round((v / 1.6) * 255)));
  const hex = (to255(t[0]) << 16) | (to255(t[1]) << 8) | to255(t[2]);
  return { core: 0xfff3c4, debris: hex };
}

export interface TowerPreview {
  readonly el: HTMLElement;
  /** 이 타워를 이 티어(0-base)로 보여 준다. 반복 재생은 스스로 돈다 */
  show(def: TowerDef, tier: number): void;
  dispose(): void;
}

export function createTowerPreview(): TowerPreview {
  const canvas = h('canvas', { class: 'tp-canvas' }) as HTMLCanvasElement;
  const el = h('div', { class: 'tower-preview' }, canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
  sun.position.set(3, 8, 4);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x6a5a48, 1.2));

  // 바닥 — 잔디색 원반 하나. 판을 흉내 내지 않는다(여기서 재려는 것은 타워의 동작이다)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 32).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x6fae4a }),
  );
  ground.position.set(TARGET_X / 2, -0.01, 0);
  scene.add(ground);

  // 표적 — 밀짚 과녁. 적을 세우면 "적을 미리 보는 화면"으로 오해된다
  const target = new THREE.Group();
  target.add(new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.5, 5),
    new THREE.MeshLambertMaterial({ color: 0x8a6b3f }),
  ).translateY(0.25));
  target.add(new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.07, 5, 12),
    new THREE.MeshLambertMaterial({ color: 0xd9c8a0 }),
  ).translateY(0.62));
  target.position.set(TARGET_X, 0, 0);
  target.rotation.y = Math.PI / 2;
  scene.add(target);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  const towers = new TowerView(scene, cellToWorld);
  const projectiles = new ProjectileView(scene, cellToWorld);
  const particles = new ParticleSystem(scene, 384);

  const TOWER_ID = 1;
  let cur: TowerDef | null = null;
  let curTier = 0;
  let clock = 0;
  let fired = false;
  let raf = 0;
  let last = 0;
  let disposed = false;

  /** 지금 날아가는 것 하나 — sim 없이 손으로 채운다(연출 전용이라 판정 필드는 안 쓴다) */
  const shot: ProjectileState = {
    id: 1, kind: 'homing', towerDefId: 'spear', tier: 0,
    x: 0, y: 0.6, z: 0, prevX: 0, prevY: 0.6, prevZ: 0,
    targetId: -1, targetX: TARGET_X, targetZ: 0,
    flightTicks: 0, elapsedTicks: 0, startX: 0, startZ: 0,
    arcHeight: 0, speed: 8, dmg: 1, targetFlying: false, alive: false,
  };

  const towerState = (): TowerState => ({
    id: TOWER_ID, defId: cur!.id, tier: curTier, hp: 100, maxHp: 100, silenceLeft: 0,
    cellX: 0, cellZ: 0, cooldownLeft: 0, targetId: -1, targeting: 'first',
    invested: 0, buffDmgPct: 0, buffRatePct: 0,
  });

  const resize = (): void => {
    const w = el.clientWidth || 280;
    const hgt = el.clientHeight || 150;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    // 타워와 표적이 **둘 다** 들어오게 — 가로가 좁으면 뒤로 물러난다
    // ⚠ 실측으로 물러난 값이다 — 처음 잡은 거리에서는 만렙 타워 지붕이 위로 잘렸다
    const back = Math.max(4.6, 6.0 / Math.max(0.55, camera.aspect));
    camera.position.set(-back * 0.34 + TARGET_X / 2, back * 0.58, back * 0.74);
    camera.lookAt(TARGET_X / 2, 0.62, 0);
    camera.updateProjectionMatrix();
  };

  const impact = (): void => {
    if (!cur) return;
    const c = impactColors(cur.id);
    particles.explosion(TARGET_X, 0.5, 0, {
      // 티어가 오를수록 크게 — 판에서 쓰는 규칙과 같은 방향이다
      strength: 0.9 + curTier * 0.35,
      core: c.core,
      debris: c.debris,
      shock: c.debris,
    });
  };

  /** 한 주기: 0 → 발사 · FLIGHT 동안 비행 · 착탄 폭발 · 나머지는 쉼 */
  const step = (dt: number): void => {
    if (!cur) return;
    clock += dt;
    if (clock >= CYCLE) {
      clock = 0;
      fired = false;
    }
    const kind = cur.attackKind;
    if (!fired && clock >= 0.15) {
      fired = true;
      towers.recoil(TOWER_ID);
      if (kind === 'beam') {
        projectiles.addBeam([{ x: 0, z: 0 }, { x: TARGET_X, z: 0 }], 1.0, 1 + curTier * 0.4);
        impact();
      } else if (kind === 'aura' || kind === 'pulse') {
        // 오라형은 날아가는 것이 없다 — 타워에서 퍼지는 고리가 그 동작이다
        particles.ring(0, 0, impactColors(cur.id).debris, 0.6 + curTier * 0.16, 18);
      }
    }
    if (kind === 'homing' || kind === 'ballistic') {
      const t = (clock - 0.15) / FLIGHT;
      if (t >= 0 && t <= 1) {
        shot.alive = true;
        shot.prevX = shot.x;
        shot.prevZ = shot.z;
        shot.prevY = shot.y;
        shot.x = TARGET_X * t;
        shot.z = 0;
        shot.y = kind === 'ballistic' ? 0.6 + Math.sin(t * Math.PI) * 0.9 : 0.6;
      } else if (shot.alive && t > 1) {
        shot.alive = false;
        impact();
      }
    }
    towers.aim([towerState()], [], 1);
    towers.update(dt);
    projectiles.update(shot.alive ? [shot] : [], 1, dt);
    particles.update(dt);
  };

  const loop = (now: number): void => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = last === 0 ? 0.016 : Math.min(0.05, (now - last) / 1000);
    last = now;
    if (el.clientWidth > 0) {
      resize();
      step(dt);
      renderer.render(scene, camera);
    }
  };

  return {
    el,
    show(def, tier) {
      cur = def;
      curTier = tier;
      clock = 0;
      fired = false;
      shot.alive = false;
      shot.towerDefId = def.id;
      shot.tier = tier;
      shot.x = 0;
      shot.prevX = 0;
      towers.add(TOWER_ID, def.id, tier, 0, 0);
      resize();
      if (raf === 0) {
        last = 0;
        raf = requestAnimationFrame(loop);
      }
    },
    dispose() {
      disposed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      towers.dispose();
      projectiles.dispose();
      particles.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      target.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      // ⚠ 컨텍스트를 **명시적으로** 놓는다. `dispose()` 만으로는 컨텍스트가 안 풀려
      //   도감을 여러 번 여닫으면 상한에 걸린다(그때 죽는 것은 가장 오래된 캔버스 = 게임 본 화면).
      renderer.forceContextLoss();
    },
  };
}
