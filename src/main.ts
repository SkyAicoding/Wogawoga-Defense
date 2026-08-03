// 부트스트랩 플레이스홀더: 렌더 파이프라인 검증용 회전 섬 디오라마.
// P3 통합 단계에서 게임 앱 FSM으로 대체된다.
import * as THREE from 'three';
import './ui/style.css';
import { tryRunLab } from './debug/harness';

function bootPlaceholder(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog = new THREE.Fog(0x7ec8e3, 40, 90);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  camera.position.set(14, 20, 14);
  camera.lookAt(0, 0, 0);

  const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
  sun.position.set(12, 24, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x8a6b4d, 1.1));

  // 물
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0x3a9bc7 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.4;
  water.receiveShadow = true;
  scene.add(water);

  // 떠 있는 섬 (프로시저럴 플레이스홀더)
  const island = new THREE.Group();
  const rng = (() => {
    let s = 20260803;
    return () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      if (Math.abs(x) + Math.abs(z) > 6) continue;
      const h = 0.5 + rng() * 0.15;
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.98, h, 0.98),
        new THREE.MeshLambertMaterial({
          color: new THREE.Color().setHSL(0.29 + rng() * 0.04, 0.45, 0.38 + rng() * 0.06),
        }),
      );
      tile.position.set(x, -h / 2, z);
      tile.castShadow = true;
      tile.receiveShadow = true;
      island.add(tile);

      const cliff = new THREE.Mesh(
        new THREE.BoxGeometry(0.98, 1.2 + rng() * 0.8, 0.98),
        new THREE.MeshLambertMaterial({
          color: new THREE.Color().setHSL(0.07, 0.35, 0.32 + rng() * 0.05),
        }),
      );
      cliff.position.set(x, -h - 0.7, z);
      island.add(cliff);
    }
  }

  // 모닥불(기지) 표시
  const fire = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.7, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8c42 }),
  );
  fire.position.set(0, 0.4, 0);
  island.add(fire);

  // 나무 몇 그루
  for (let i = 0; i < 6; i++) {
    const tx = Math.round((rng() - 0.5) * 7);
    const tz = Math.round((rng() - 0.5) * 7);
    if (Math.abs(tx) + Math.abs(tz) > 5 || (tx === 0 && tz === 0)) continue;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.5, 5),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
    );
    trunk.position.set(tx, 0.25, tz);
    trunk.castShadow = true;
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 0),
      new THREE.MeshLambertMaterial({ color: 0x3f7d33 }),
    );
    crown.position.set(tx, 0.75, tz);
    crown.castShadow = true;
    island.add(trunk, crown);
  }

  scene.add(island);

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    island.rotation.y = t * 0.25;
    fire.scale.setScalar(1 + Math.sin(t * 8) * 0.08);
    renderer.render(scene, camera);
  });
}

if (!tryRunLab()) {
  bootPlaceholder();
}
