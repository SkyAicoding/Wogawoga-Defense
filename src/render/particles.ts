/**
 * CPU 파티클 — 단일 InstancedMesh(용량 512, 저품질 256).
 * 중력/감쇠/수명 페이드 지원. 사망 별/먼지, 착탄, 번개 스파크, 화염 불티,
 * 바이옴 환경 파티클(눈/재/포자)을 하나의 시스템으로 처리한다.
 * 장식용 지터는 렌더 전용이므로 Math.random 허용 범위지만, 재현성 위해 Rng 사용.
 */
import * as THREE from 'three';
import type { BiomeId } from '@/data/types';
import { Rng } from '@/core/rng';
import { BIOMES } from './palette';

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _col = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

interface P {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  gravity: number;
  damping: number;
  spin: number;
  /** ambient 파티클은 수명 후 재스폰 */
  ambient: boolean;
}

export class ParticleSystem {
  private mesh: THREE.InstancedMesh;
  private pool: P[] = [];
  private cursor = 0;
  private rng = new Rng(0xfeed);
  private ambientBiome: BiomeId | null = null;
  private ambientArea = new THREE.Box3();
  private ambientBudget = 0;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    readonly capacity = 512,
  ) {
    // 살짝 납작한 큐브 — 회전하면 별/불티 어느 쪽으로도 읽힘
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0.1, r: 1, g: 1, b: 1,
        gravity: 0, damping: 0, spin: 0, ambient: false,
      });
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, _col.setRGB(1, 1, 1));
    }
    this.mesh.count = capacity;
    scene.add(this.mesh);
  }

  private spawn(): P {
    // 순환 커서 — 가득 차면 가장 오래된 것 재사용
    for (let i = 0; i < this.capacity; i++) {
      this.cursor = (this.cursor + 1) % this.capacity;
      const p = this.pool[this.cursor] as P;
      if (!p.alive) return p;
    }
    return this.pool[this.cursor] as P;
  }

  /** 방사형 버스트 (사망/착탄/업그레이드 등) */
  burst(
    x: number, y: number, z: number,
    color: number, count: number, speed: number, size: number, life: number,
    opts: { gravity?: number; upBias?: number } = {},
  ): void {
    _col.setHex(color);
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      const theta = this.rng.range(0, Math.PI * 2);
      const up = opts.upBias ?? 0.5;
      const phi = Math.acos(this.rng.range(-1 + up, 1));
      const spd = speed * this.rng.range(0.5, 1.15);
      p.alive = true;
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.sin(phi) * Math.cos(theta) * spd;
      p.vy = Math.cos(phi) * spd;
      p.vz = Math.sin(phi) * Math.sin(theta) * spd;
      p.maxLife = p.life = life * this.rng.range(0.7, 1.3);
      p.size = size * this.rng.range(0.7, 1.3);
      const lj = this.rng.range(0.85, 1.25);
      p.r = _col.r * lj; p.g = _col.g * lj; p.b = _col.b * lj;
      p.gravity = opts.gravity ?? 6;
      p.damping = 2.2;
      p.spin = this.rng.range(-6, 6);
      p.ambient = false;
    }
  }

  /** 궤적 트레일 한 점 (불덩이 꼬리 등) */
  trail(x: number, y: number, z: number, color: number, size = 0.07): void {
    const p = this.spawn();
    _col.setHex(color);
    p.alive = true;
    p.x = x + this.rng.range(-0.04, 0.04);
    p.y = y + this.rng.range(-0.04, 0.04);
    p.z = z + this.rng.range(-0.04, 0.04);
    p.vx = 0; p.vy = this.rng.range(0.2, 0.6); p.vz = 0;
    p.maxLife = p.life = this.rng.range(0.25, 0.45);
    p.size = size;
    p.r = _col.r; p.g = _col.g; p.b = _col.b;
    p.gravity = 0;
    p.damping = 1;
    p.spin = this.rng.range(-4, 4);
    p.ambient = false;
  }

  /** 지면 확장 링 (드럼 펄스/오라) */
  ring(x: number, z: number, color: number, radius: number, count = 14): void {
    _col.setHex(color);
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      const a = (i / count) * Math.PI * 2;
      p.alive = true;
      p.x = x + Math.cos(a) * 0.2;
      p.y = 0.12;
      p.z = z + Math.sin(a) * 0.2;
      const spd = radius * 2.2;
      p.vx = Math.cos(a) * spd;
      p.vy = 0.3;
      p.vz = Math.sin(a) * spd;
      p.maxLife = p.life = 0.45;
      p.size = 0.09;
      p.r = _col.r; p.g = _col.g; p.b = _col.b;
      p.gravity = 0;
      p.damping = 3.5;
      p.spin = 0;
      p.ambient = false;
    }
  }

  /** 바이옴 환경 파티클 (눈/화산재 등) — aabb 영역 내 순환 낙하 */
  setEnvironment(biome: BiomeId | null, area?: THREE.Box3): void {
    this.ambientBiome = biome && BIOMES[biome].ambient !== 0 ? biome : null;
    if (area) this.ambientArea.copy(area);
    this.ambientBudget = this.ambientBiome ? Math.min(48, this.capacity >> 3) : 0;
  }

  private spawnAmbient(): void {
    const biome = this.ambientBiome;
    if (!biome) return;
    const pal = BIOMES[biome];
    const p = this.spawn();
    const min = this.ambientArea.min;
    const max = this.ambientArea.max;
    _col.setHex(pal.ambient);
    p.alive = true;
    p.ambient = true;
    p.x = this.rng.range(min.x, max.x);
    p.y = this.rng.range(2.5, 5);
    p.z = this.rng.range(min.z, max.z);
    p.vx = this.rng.range(-0.25, 0.25);
    p.vy = biome === 'volcano' ? this.rng.range(-0.35, -0.15) : this.rng.range(-0.8, -0.5);
    p.vz = this.rng.range(-0.25, 0.25);
    p.maxLife = p.life = this.rng.range(5, 9);
    p.size = biome === 'snow' ? 0.05 : 0.04;
    p.r = _col.r; p.g = _col.g; p.b = _col.b;
    p.gravity = 0;
    p.damping = 0;
    p.spin = this.rng.range(-2, 2);
    p.ambient = true;
  }

  update(dt: number): void {
    this.time += dt;
    let ambientAlive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i] as P;
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0 || p.y < -1.5) {
        p.alive = false;
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      if (p.ambient) ambientAlive++;
      p.vy -= p.gravity * dt;
      const d = Math.max(0, 1 - p.damping * dt);
      p.vx *= d; p.vy = p.gravity > 0 ? p.vy : p.vy * d; p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.life / p.maxLife;
      const s = p.size * (p.ambient ? 1 : 0.3 + 0.7 * t);
      _quat.setFromEuler(_euler.set(p.spin * this.time, p.spin * 0.7 * this.time, 0));
      _mat4.compose(_pos.set(p.x, p.y, p.z), _quat, _scl.set(s, s, s));
      this.mesh.setMatrixAt(i, _mat4);
      this.mesh.setColorAt(i, _col.setRGB(p.r, p.g, p.b));
    }
    // 환경 파티클 보충 (프레임당 최대 2)
    for (let k = 0; k < 2 && ambientAlive + k < this.ambientBudget; k++) this.spawnAmbient();
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
