/**
 * CPU 파티클 — 2개의 InstancedMesh(불투명 본체 + 가산 발광)로 총 2 드로우콜.
 * 용량은 quality.particleMax를 두 레이어가 나눠 갖는다(합계가 상한).
 * 중력/감쇠/수명 페이드/성장/축별 스케일 지원. 사망 폭발, 착탄 폭발(코어 플래시 +
 * 파편 + 잔불/연기 + 지면 쇼크웨이브), 번개 스파크, 바이옴 환경 파티클을 모두 처리한다.
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
  /** 기준 y 회전 (쇼크웨이브 링 접선 정렬) */
  yaw: number;
  /** 초당 크기 증가량 (쇼크웨이브/연기 확산) */
  grow: number;
  /** 수명 끝 크기 비율 (1 = 줄어들지 않음) */
  taper: number;
  /** 가산 레이어 밝기 페이드 지수 (클수록 늦게 꺼짐) */
  fadePow: number;
  /** 축별 스케일 배수 (납작한 판/길쭉한 파편) */
  sxm: number;
  sym: number;
  szm: number;
  /** ambient 파티클은 수명 후 재스폰 */
  ambient: boolean;
}

function makeP(): P {
  return {
    alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    life: 0, maxLife: 1, size: 0.1, r: 1, g: 1, b: 1,
    gravity: 0, damping: 0, spin: 0, yaw: 0, grow: 0, taper: 0.3, fadePow: 1,
    sxm: 1, sym: 1, szm: 1, ambient: false,
  };
}

interface Layer {
  mesh: THREE.InstancedMesh;
  pool: P[];
  cursor: number;
  capacity: number;
  /** 직전 update 기준 생존 수 (예산 판단용) */
  live: number;
}

/** burst 옵션 — 잔해가 튀고 감속하며 떨어지는 질감을 조절한다 */
export interface BurstOpts {
  /** 중력 (기본 6). 음수면 위로 부유 */
  gravity?: number;
  /** 상방 편향 0~1 (기본 0.5) */
  upBias?: number;
  /** 공기 저항 (기본 2.2) */
  drag?: number;
  /** 회전 속도 배수 (기본 1) */
  spin?: number;
  /** 가산 발광 레이어 사용 */
  glow?: boolean;
  /** 크기 편차 ±비율 (기본 0.3 → 0.7~1.3배). 크게 줄수록 덩어리+잔불 대비가 커진다 */
  sizeVar?: number;
  /** 초당 크기 증가량 */
  grow?: number;
  /** 수명 끝 크기 비율 (기본 0.3) */
  taper?: number;
  /** 가산 페이드 지수 (기본 1) */
  fadePow?: number;
  /** 축별 스케일 배수 */
  scaleXYZ?: [number, number, number];
}

/** 폭발 프리셋 — 크기/개수/수명/쇼크웨이브가 전부 strength로 스케일된다 */
export interface ExplosionOpts {
  /** 연출 강도 0.6~3.2 (1 = 초반 기본 타워 1발) */
  strength: number;
  /** 코어 플래시 색 (가산) */
  core: number;
  /** 파편 색 */
  debris: number;
  /** 잔불/연기 색 (생략 시 파편색 유지) */
  smoke?: number;
  /** 지면 쇼크웨이브 색 (0이면 생략) */
  shock?: number;
  /** 쇼크웨이브 기준 반경 (타일, 기본 0.5). strength로 스케일된다 */
  shockRadius?: number;
  /** 쇼크웨이브 최종 반경을 직접 지정 (스플래시 반경에 링을 정확히 맞출 때) */
  shockRadiusAbs?: number;
  /** 파편 중력 (기본 9). 돌=강, 불티=약 */
  gravity?: number;
  /** 파편 개수 배수 */
  debrisMul?: number;
  /** 연기 개수 배수 */
  smokeMul?: number;
  /** 쇼크웨이브 개수 배수 */
  shockMul?: number;
  /** 전체 크기 배수 */
  sizeMul?: number;
  /** 코어 플래시 크기/수명 배수 */
  flashMul?: number;
  /** 파편 확산 속도 배수 */
  spreadMul?: number;
  /** 연기 수명 배수 (독=지속 연무) */
  smokeLifeMul?: number;
}

export class ParticleSystem {
  private main: Layer;
  private glow: Layer;
  private rng = new Rng(0xfeed);
  private ambientBiome: BiomeId | null = null;
  private ambientArea = new THREE.Box3();
  private ambientBudget = 0;
  private time = 0;
  /** 저사양에서는 개수만 줄이고 크기·수명·쇼크웨이브로 임팩트를 유지한다 */
  private qualityCount: number;

  constructor(
    scene: THREE.Scene,
    readonly capacity = 512,
  ) {
    // 가산 발광은 전체의 약 1/4 — 합계가 particleMax를 넘지 않는다
    const glowCap = Math.max(24, Math.round(capacity * 0.26));
    const mainCap = Math.max(32, capacity - glowCap);
    this.qualityCount = capacity >= 512 ? 1 : capacity >= 384 ? 0.78 : 0.5;

    const opaque = new THREE.MeshBasicMaterial({ toneMapped: false });
    const additive = new THREE.MeshBasicMaterial({
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.main = this.makeLayer(scene, opaque, mainCap, 0);
    this.glow = this.makeLayer(scene, additive, glowCap, 6);
  }

  private makeLayer(
    scene: THREE.Scene,
    mat: THREE.Material,
    capacity: number,
    renderOrder: number,
  ): Layer {
    // 살짝 납작한 큐브 — 회전하면 별/불티/잔해 어느 쪽으로도 읽힌다
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.renderOrder = renderOrder;
    const pool: P[] = [];
    for (let i = 0; i < capacity; i++) {
      pool.push(makeP());
      mesh.setMatrixAt(i, HIDDEN);
      mesh.setColorAt(i, _col.setRGB(1, 1, 1));
    }
    mesh.count = 0; // update()에서 생존 범위만큼 늘린다
    scene.add(mesh);
    return { mesh, pool, cursor: 0, capacity, live: 0 };
  }

  private spawn(glow: boolean): P {
    const layer = glow ? this.glow : this.main;
    // 순환 커서 — 가득 차면 가장 오래된 것 재사용
    for (let i = 0; i < layer.capacity; i++) {
      layer.cursor = (layer.cursor + 1) % layer.capacity;
      const p = layer.pool[layer.cursor] as P;
      if (!p.alive) return p;
    }
    return layer.pool[layer.cursor] as P;
  }

  /**
   * 이번 스폰이 쓸 개수 배수 — 품질 티어 + 현재 풀 점유율.
   * 동시 폭발이 몰리면 약한 폭발부터 개수를 줄여 큰 폭발을 지킨다(크기는 유지).
   */
  private budgetMul(strength: number): number {
    let m = this.qualityCount;
    const load = Math.max(
      this.main.live / this.main.capacity,
      this.glow.live / this.glow.capacity,
    );
    const big = strength >= 1.6;
    if (load > 0.62) m *= big ? 0.72 : 0.42;
    if (load > 0.85) m *= big ? 0.55 : 0.28;
    return m;
  }

  /** 현재 점유율 0~1 (두 레이어 중 높은 쪽 — 연출 예산 판단용) */
  get load(): number {
    return Math.max(this.main.live / this.main.capacity, this.glow.live / this.glow.capacity);
  }

  /** 방사형 버스트 (사망/착탄/업그레이드 등) */
  burst(
    x: number, y: number, z: number,
    color: number, count: number, speed: number, size: number, life: number,
    opts: BurstOpts = {},
  ): void {
    if (count <= 0) return;
    _col.setHex(color);
    const glow = opts.glow === true;
    const drag = opts.drag ?? 2.2;
    const grav = opts.gravity ?? 6;
    const spinMul = opts.spin ?? 1;
    const varr = opts.sizeVar ?? 0.3;
    const sc = opts.scaleXYZ;
    for (let i = 0; i < count; i++) {
      const p = this.spawn(glow);
      const theta = this.rng.range(0, Math.PI * 2);
      const up = opts.upBias ?? 0.5;
      const phi = Math.acos(this.rng.range(-1 + up, 1));
      const spd = speed * this.rng.range(0.45, 1.2);
      p.alive = true;
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.sin(phi) * Math.cos(theta) * spd;
      p.vy = Math.cos(phi) * spd;
      p.vz = Math.sin(phi) * Math.sin(theta) * spd;
      p.maxLife = p.life = life * this.rng.range(0.7, 1.3);
      // 크기 편차를 크게 주면 큰 덩어리와 잔불이 함께 보인다
      p.size = size * this.rng.range(Math.max(0.15, 1 - varr), 1 + varr);
      const lj = this.rng.range(0.85, 1.3);
      p.r = _col.r * lj; p.g = _col.g * lj; p.b = _col.b * lj;
      p.gravity = grav;
      p.damping = drag;
      p.spin = this.rng.range(-7, 7) * spinMul;
      p.yaw = this.rng.range(0, Math.PI * 2);
      p.grow = opts.grow ?? 0;
      p.taper = opts.taper ?? 0.3;
      p.fadePow = opts.fadePow ?? 1;
      p.sxm = sc ? sc[0] : 1;
      p.sym = sc ? sc[1] : 1;
      p.szm = sc ? sc[2] : 1;
      p.ambient = false;
    }
  }

  /** 궤적 트레일 한 점 (불덩이 꼬리 등) */
  trail(x: number, y: number, z: number, color: number, size = 0.07): void {
    const p = this.spawn(false);
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
    p.yaw = 0;
    p.grow = 0;
    p.taper = 0.3;
    p.fadePow = 1;
    p.sxm = p.sym = p.szm = 1;
    p.ambient = false;
  }

  /** 지면 확장 링 (드럼 펄스/배치 확인) — 불투명 잔점 */
  ring(x: number, z: number, color: number, radius: number, count = 14): void {
    _col.setHex(color);
    for (let i = 0; i < count; i++) {
      const p = this.spawn(false);
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
      p.yaw = 0;
      p.grow = 0;
      p.taper = 0.3;
      p.fadePow = 1;
      p.sxm = p.sym = p.szm = 1;
      p.ambient = false;
    }
  }

  /**
   * 지면에 퍼지는 쇼크웨이브 링 — 가산 레이어의 납작한 판들이 접선 정렬로
   * 바깥으로 달리며 커지고(스케일 확장) 어두워진다(페이드). 큰 폭발의 핵심.
   */
  shockwave(
    x: number,
    z: number,
    color: number,
    radius: number,
    life = 0.34,
    opts: { count?: number; y?: number; thickness?: number } = {},
  ): void {
    const count = Math.max(6, Math.round(opts.count ?? 18));
    const y = opts.y ?? 0.09;
    const thick = opts.thickness ?? 1;
    _col.setHex(color);
    const spd = (radius * 2.1) / Math.max(0.05, life);
    // 조각 하나가 덮는 호 길이 — 링이 통짜 원반으로 뭉치지 않도록 둘레에 맞춘다
    const arc = (Math.PI * 2 * radius) / count;
    for (let i = 0; i < count; i++) {
      const p = this.spawn(true);
      const a = ((i + this.rng.range(-0.25, 0.25)) / count) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      p.alive = true;
      p.x = x + ca * radius * 0.18;
      p.y = y;
      p.z = z + sa * radius * 0.18;
      p.vx = ca * spd;
      p.vy = 0;
      p.vz = sa * spd;
      p.maxLife = p.life = life * this.rng.range(0.9, 1.1);
      p.size = arc * 0.4;
      // 가산 링은 겹치면 순백으로 타버린다 — 밝기를 낮춰 무기 색이 남게 한다
      p.r = _col.r * 0.78; p.g = _col.g * 0.78; p.b = _col.b * 0.78;
      p.gravity = 0;
      p.damping = 2.4;
      p.spin = 0;
      // 링 접선 방향으로 눕힌 납작한 판. 퍼지는 만큼 조각도 커져 틈이 벌어지지 않는다
      p.yaw = -a;
      p.grow = arc * 0.95;
      p.taper = 1;
      p.fadePow = 1.4;
      p.sxm = 0.42 * thick;
      p.sym = 0.16 * thick;
      p.szm = 1.25;
      p.ambient = false;
    }
  }

  /**
   * 다층 폭발 — 코어 플래시(밝고 크고 짧음) + 파편(중간, 중력) +
   * 잔불/연기(작고 오래, 부유) + 지면 쇼크웨이브.
   * 개수·크기·수명·쇼크웨이브 반경이 전부 opts.strength로 스케일된다.
   */
  explosion(x: number, y: number, z: number, opts: ExplosionOpts): void {
    const s = Math.max(0.35, opts.strength);
    const m = this.budgetMul(s);
    const sizeMul = opts.sizeMul ?? 1;
    const flashMul = opts.flashMul ?? 1;
    const spread = opts.spreadMul ?? 1;

    // 1a) 코어 플래시 — 아주 짧게 번쩍이고 줄어들며 꺼진다.
    //     크게 키우고 taper를 1로 두면 가산 누적이 흰 안개로 뭉개진다.
    const coreN = Math.max(1, Math.round((1 + 1.3 * s) * m));
    this.burst(
      x, y, z, opts.core, coreN,
      0.55 * spread,
      0.112 * Math.pow(s, 0.75) * sizeMul * flashMul,
      (0.075 + 0.03 * s) * flashMul,
      {
        glow: true, gravity: 0, drag: 8, upBias: 0.5, sizeVar: 0.25,
        grow: 0.25 * s * flashMul, taper: 0.35, fadePow: 1.5, spin: 0.25,
      },
    );

    // 1b) 스파크 — 가늘고 길쭉한 조각이 빠르게 뻗는다 (작지만 강렬)
    const sparkN = Math.max(2, Math.round((4 + 7 * s) * flashMul * m));
    this.burst(
      x, y, z, opts.core, sparkN,
      (2.2 + 2.6 * s) * spread,
      0.045 * Math.pow(s, 0.5) * sizeMul,
      0.13 + 0.09 * s,
      {
        glow: true, gravity: 1.5, drag: 4.2, upBias: 0.6, sizeVar: 0.5,
        taper: 0.3, fadePow: 1.15, spin: 0.8, scaleXYZ: [0.5, 0.5, 2.6],
      },
    );

    // 2) 파편 — 중력 받고 튀며 감속, 크기 편차를 크게 (덩어리 + 잔부스러기)
    const debrisN = Math.max(2, Math.round((7 + 11 * s) * (opts.debrisMul ?? 1) * m));
    this.burst(
      x, y, z, opts.debris, debrisN,
      (2.5 + 1.9 * s) * spread,
      0.058 * Math.pow(s, 0.5) * sizeMul,
      0.34 + 0.24 * s,
      {
        gravity: opts.gravity ?? 9, drag: 2.0, upBias: 0.72,
        sizeVar: 0.8, spin: 1.5, taper: 0.22,
      },
    );

    // 3) 잔불/연기 — 작고 오래, 위로 부유하며 천천히 퍼진다.
    //    grow를 크게 주면 덩어리로 뭉쳐 화면이 탁해진다 — 개수로 볼륨을 낸다.
    const smokeN = Math.max(1, Math.round((5 + 7 * s) * (opts.smokeMul ?? 1) * m));
    this.burst(
      x, y + 0.08, z, opts.smoke ?? opts.debris, smokeN,
      (0.9 + 0.7 * s) * spread,
      0.044 * Math.pow(s, 0.4) * sizeMul,
      (0.55 + 0.35 * s) * (opts.smokeLifeMul ?? 1),
      {
        gravity: -1.0, drag: 1.5, upBias: 0.88,
        sizeVar: 0.55, spin: 0.5, grow: 0.03 * s, taper: 0.4,
      },
    );

    // 4) 지면 쇼크웨이브 — 강도에 따라 반경/두께가 커진다
    const shockColor = opts.shock ?? opts.core;
    const shockMul = opts.shockMul ?? 1;
    if (shockColor !== 0 && shockMul > 0) {
      const r = opts.shockRadiusAbs ?? (opts.shockRadius ?? 0.5) * (0.75 + 0.55 * s);
      this.shockwave(x, z, shockColor, r, 0.24 + 0.11 * s, {
        count: (14 + 7 * s) * shockMul * Math.max(0.45, m),
        thickness: 0.95 + 0.22 * s,
      });
    }
  }

  /** 바이옴 환경 파티클 (눈/화산재 등) — aabb 영역 내 순환 낙하 */
  setEnvironment(biome: BiomeId | null, area?: THREE.Box3): void {
    this.ambientBiome = biome && BIOMES[biome].ambient !== 0 ? biome : null;
    if (area) this.ambientArea.copy(area);
    this.ambientBudget = this.ambientBiome ? Math.min(48, this.main.capacity >> 3) : 0;
  }

  private spawnAmbient(): void {
    const biome = this.ambientBiome;
    if (!biome) return;
    const pal = BIOMES[biome];
    const p = this.spawn(false);
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
    p.yaw = 0;
    p.grow = 0;
    p.taper = 0.3;
    p.fadePow = 1;
    p.sxm = p.sym = p.szm = 1;
  }

  private updateLayer(layer: Layer, dt: number, additive: boolean): number {
    let ambientAlive = 0;
    let live = 0;
    let highest = -1;
    const mesh = layer.mesh;
    for (let i = 0; i < layer.capacity; i++) {
      const p = layer.pool[i] as P;
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0 || p.y < -1.5) {
        p.alive = false;
        mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      live++;
      highest = i;
      if (p.ambient) ambientAlive++;
      p.vy -= p.gravity * dt;
      const d = Math.max(0, 1 - p.damping * dt);
      p.vx *= d; p.vy = p.gravity > 0 ? p.vy : p.vy * d; p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.life / p.maxLife;
      const age = p.maxLife - p.life;
      let s = p.size + p.grow * age;
      if (!p.ambient) s *= p.taper + (1 - p.taper) * t;
      _quat.setFromEuler(_euler.set(p.spin * this.time, p.yaw + p.spin * 0.7 * this.time, 0));
      _mat4.compose(_pos.set(p.x, p.y, p.z), _quat, _scl.set(s * p.sxm, s * p.sym, s * p.szm));
      mesh.setMatrixAt(i, _mat4);
      // 가산 레이어는 밝기를 낮춰 사라진다 (크기는 유지/확장)
      const k = additive ? Math.pow(t, p.fadePow) : 1;
      mesh.setColorAt(i, _col.setRGB(p.r * k, p.g * k, p.b * k));
    }
    layer.live = live;
    // 살아있는 최대 인덱스까지만 그린다 — 파티클이 없으면 드로우콜 0
    mesh.count = highest + 1;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return ambientAlive;
  }

  update(dt: number): void {
    this.time += dt;
    const ambientAlive = this.updateLayer(this.main, dt, false);
    this.updateLayer(this.glow, dt, true);
    // 환경 파티클 보충 (프레임당 최대 2)
    for (let k = 0; k < 2 && ambientAlive + k < this.ambientBudget; k++) this.spawnAmbient();
  }

  dispose(): void {
    for (const layer of [this.main, this.glow]) {
      layer.mesh.parent?.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
      layer.mesh.dispose();
    }
  }
}
