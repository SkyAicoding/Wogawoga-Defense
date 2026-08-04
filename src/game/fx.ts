/**
 * SimEvent → 연출 라우터: 파티클/히트플래시/셰이크/데미지숫자/사운드/진동/배너/음악 강도.
 * 매 프레임 drainEvents() 결과를 handle()로 넘긴다.
 *
 * 폭발 강도 s = fxStrength(dmg, tier):
 *   s = clamp((dmg / REF_DMG)^DMG_EXP × (1 + tier × TIER_GAIN), 0.62, 3.2)
 * REF_DMG = 12 = spear T1 1발 피해 → 초반 창 착탄이 s≈1.0,
 * 후반 고티어 투석기/발리스타 착탄이 s≈3.0~3.2가 되도록 상수를 맞췄다.
 * 파티클 개수·크기·수명·쇼크웨이브 반경·카메라 셰이크·데미지 숫자 크기가 전부 s에 비례한다.
 */
import * as THREE from 'three';
import type { SimEvent, StatusKind, TowerId } from '@/data/types';
import { ENEMY_DEFS } from '@/data';
import { clamp } from '@/core/mathx';
import { vibrate } from '@/core/device';
import { audio } from '@/audio';
import type { SfxName } from '@/audio';
import type { Stage3D } from '@/render/stage3d';
import type { DioramaCamera } from '@/render/camera';
import { showBossBanner, showWaveBanner } from '@/ui/screens/battlehud';
import { spawnDamageNumber } from '@/ui/widgets/damagenumbers';
import type { DamageKind } from '@/ui/widgets/damagenumbers';

// --- 강도 곡선 상수 --------------------------------------------------------
/** 기준 피해 = spear T1 dmg (data/towers.ts) */
const REF_DMG = 12;
/** 피해 → 강도 지수 (cbrt(0.333)보다 완만 — 피해가 40배여도 강도는 3배 남짓) */
const DMG_EXP = 0.28;
/** 티어당 강도 가산 (T5 = +36%) */
const TIER_GAIN = 0.09;
const S_MIN = 0.62;
const S_MAX = 3.2;

/** 적 최대 체력 기준 사망 폭발 강도 (raptor 60 / ptera 90 근방이 s≈0.9) */
const REF_HP = 90;
const HP_EXP = 0.3;

/** 한 프레임(=한 handle 배치)에서 허용하는 총 셰이크 — 4배속 다중 착탄 멀미 방지 */
const SHAKE_BUDGET = 0.5;

export function fxStrength(dmg: number, tier: number): number {
  const d = Math.max(1, dmg);
  return clamp(Math.pow(d / REF_DMG, DMG_EXP) * (1 + tier * TIER_GAIN), S_MIN, S_MAX);
}

const FIRE_SFX: Record<TowerId, SfxName> = {
  spear: 'spearThrow',
  catapult: 'catapultLaunch',
  lightning: 'lightningZap',
  brazier: 'fireWhoosh',
  frost: 'frostCast',
  poison: 'poisonSpit',
  ballista: 'spearThrow',
  drum: 'drumBuff',
};

const TOWER_FX_COLOR: Record<TowerId, number> = {
  spear: 0xd9c8a0,
  catapult: 0x9a8b72,
  lightning: 0x8be0ff,
  brazier: 0xff8c42,
  frost: 0x9fdcf7,
  poison: 0x8fd14f,
  ballista: 0xf3e9d2,
  drum: 0xffd04a,
};

/**
 * 무기별 폭발 개성.
 * core=코어 플래시(가산), debris=파편, smoke=잔불/연기, shock=지면 쇼크웨이브.
 */
interface ImpactStyle {
  core: number;
  debris: number;
  smoke: number;
  shock: number;
  /** 파편 중력 — 돌은 무겁게, 불티/포자는 가볍게 */
  gravity: number;
  debrisMul: number;
  smokeMul: number;
  shockMul: number;
  sizeMul: number;
  flashMul: number;
  spreadMul: number;
  smokeLifeMul: number;
  /** 쇼크웨이브 기준 반경 (스플래시면 실제 반경으로 덮어씀) */
  shockRadius: number;
  /** 셰이크 배수 */
  shakeMul: number;
}

const BASE_STYLE: ImpactStyle = {
  core: 0xfff3d0,
  debris: 0xd9c8a0,
  smoke: 0xb8ab8c,
  shock: 0xfff0c8,
  gravity: 9,
  debrisMul: 1,
  smokeMul: 1,
  shockMul: 1,
  sizeMul: 1,
  flashMul: 1,
  spreadMul: 1,
  smokeLifeMul: 1,
  shockRadius: 0.5,
  shakeMul: 1,
};

const IMPACT_STYLE: Record<TowerId, ImpactStyle> = {
  // 돌먼지 + 파편 다수, 묵직한 지면 충격
  catapult: {
    ...BASE_STYLE,
    core: 0xffe0a8,
    debris: 0x8d7d63,
    // 파편보다 밝은 흙먼지 — 같은 톤이면 한 덩어리로 뭉쳐 탁해진다
    smoke: 0xd9cdb2,
    shock: 0xe8cf9e,
    gravity: 12,
    debrisMul: 1.55,
    smokeMul: 1.5,
    shockMul: 1.25,
    sizeMul: 1.15,
    smokeLifeMul: 1.3,
    shockRadius: 0.75,
    shakeMul: 1.35,
  },
  // 주황 불티 + 연기, 파편은 가볍게 떠오른다
  brazier: {
    ...BASE_STYLE,
    core: 0xffd07a,
    debris: 0xff8c42,
    smoke: 0x6b5a52,
    shock: 0xff9a3c,
    gravity: 3,
    debrisMul: 1.15,
    smokeMul: 1.6,
    sizeMul: 1.05,
    flashMul: 1.15,
    smokeLifeMul: 1.5,
    shockRadius: 0.6,
    shakeMul: 0.75,
  },
  // 창백한 파랑 얼음조각 + 서리 링 (넓고 낮게)
  frost: {
    ...BASE_STYLE,
    core: 0xe6faff,
    debris: 0x9fdcf7,
    smoke: 0xd6f0fb,
    shock: 0xbfeaff,
    gravity: 7,
    debrisMul: 1.2,
    smokeMul: 0.8,
    shockMul: 1.3,
    sizeMul: 0.95,
    smokeLifeMul: 1.15,
    shockRadius: 0.66,
    shakeMul: 0.6,
  },
  // 흰-하늘색 스파크, 짧고 날카로운 플래시
  lightning: {
    ...BASE_STYLE,
    core: 0xffffff,
    debris: 0x8be0ff,
    smoke: 0xbfeeff,
    shock: 0xaee8ff,
    gravity: 2,
    debrisMul: 1.1,
    smokeMul: 0.45,
    shockMul: 0.85,
    sizeMul: 0.8,
    flashMul: 1.45,
    spreadMul: 1.35,
    smokeLifeMul: 0.6,
    shockRadius: 0.45,
    shakeMul: 0.7,
  },
  // 녹색 방울 + 지속 연무
  poison: {
    ...BASE_STYLE,
    core: 0xd8ff9a,
    debris: 0x8fd14f,
    smoke: 0x5d8f3a,
    gravity: 5,
    shock: 0x9fe05a,
    debrisMul: 1.05,
    smokeMul: 1.75,
    shockMul: 0.9,
    sizeMul: 0.95,
    smokeLifeMul: 2.1,
    shockRadius: 0.55,
    shakeMul: 0.55,
  },
  // 날카로운 임팩트 스파크 — 작지만 강렬 (플래시 강조, 파편 소량)
  spear: {
    ...BASE_STYLE,
    core: 0xfff6de,
    debris: 0xd9c8a0,
    smoke: 0xc0b399,
    shock: 0xffeec6,
    gravity: 10,
    debrisMul: 0.85,
    smokeMul: 0.55,
    shockMul: 0.7,
    sizeMul: 0.82,
    flashMul: 1.3,
    spreadMul: 1.2,
    smokeLifeMul: 0.8,
    shockRadius: 0.4,
    shakeMul: 0.8,
  },
  ballista: {
    ...BASE_STYLE,
    core: 0xfffdf0,
    debris: 0xf3e9d2,
    smoke: 0xcabfa6,
    shock: 0xfff2cf,
    gravity: 10,
    debrisMul: 0.95,
    smokeMul: 0.6,
    shockMul: 0.8,
    sizeMul: 0.88,
    flashMul: 1.5,
    spreadMul: 1.3,
    smokeLifeMul: 0.85,
    shockRadius: 0.48,
    shakeMul: 1.1,
  },
  drum: BASE_STYLE,
};

const STATUS_COLOR: Record<StatusKind, number> = {
  slow: 0x9fdcf7,
  burn: 0xff8c42,
  poison: 0x8fd14f,
  stun: 0xffd04a,
};

const STATUS_KIND: Partial<Record<StatusKind, DamageKind>> = {
  burn: 'burn',
  poison: 'poison',
};

export class FxRouter {
  /** 이 전투의 처치 수 집계 (정산용) */
  kills = 0;
  bossKills = 0;

  private v = new THREE.Vector3();
  private vibrationOn: boolean;
  /** 한 배치 내 셰이크 누적 (SHAKE_BUDGET 상한) */
  private shakeSpent = 0;
  /** 오라 불티 스팸 방지 — 배치당 상한 */
  private auraFlecks = 0;

  constructor(
    private stage3d: Stage3D,
    private camera: DioramaCamera,
    private canvas: HTMLCanvasElement,
    private getWaveCount: () => number,
    /** 무한 모드에는 '마지막 웨이브'가 없다 — 배너 오표시 방지 */
    private endless: boolean,
    vibrationOn: boolean,
  ) {
    this.vibrationOn = vibrationOn;
  }

  private worldToScreen(x: number, y: number, z: number): { sx: number; sy: number } | null {
    this.stage3d.cellToWorld(x, z, this.v);
    this.v.y = y;
    this.v.project(this.camera.camera);
    if (this.v.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { sx: (this.v.x * 0.5 + 0.5) * rect.width, sy: (-this.v.y * 0.5 + 0.5) * rect.height };
  }

  private buzz(ms: number | number[]): void {
    if (this.vibrationOn) vibrate(ms);
  }

  /** 셰이크 — 배치당 총량을 제한해 다중 착탄에서 화면이 요동치지 않게 한다 */
  private shake(amount: number): void {
    if (amount <= 0.002) return;
    const left = SHAKE_BUDGET - this.shakeSpent;
    if (left <= 0) return;
    const a = Math.min(amount, left);
    this.shakeSpent += a;
    this.camera.shake(a);
  }

  handle(events: readonly SimEvent[]): void {
    const s3 = this.stage3d;
    this.shakeSpent = 0;
    this.auraFlecks = 0;
    for (const ev of events) {
      switch (ev.type) {
        case 'waveStarted': {
          showWaveBanner(ev.wave, !this.endless && ev.wave === this.getWaveCount());
          audio.play('waveStart');
          audio.music.setIntensity(ev.wave % 10 === 0 ? 3 : 2);
          s3.decals.pulseChevrons(2.0);
          break;
        }
        case 'waveCleared':
          audio.play('waveClear');
          audio.music.setIntensity(1);
          break;
        case 'bossSpawned':
          showBossBanner();
          audio.play('bossRoar');
          audio.music.setIntensity(3);
          this.shake(0.4);
          this.buzz(60);
          break;
        case 'enemyDamaged': {
          s3.enemies.setHitFlash(ev.enemyId);
          const p = this.worldToScreen(ev.x, 1.1, ev.z);
          if (p) {
            const kind: DamageKind =
              ev.source in STATUS_KIND
                ? (STATUS_KIND[ev.source as StatusKind] ?? 'normal')
                : 'normal';
            // 큰 피해일수록 숫자도 커진다 (0.85~1.7배)
            const ds = ev.shielded ? 1 : clamp(0.7 + fxStrength(ev.amount, 0) * 0.32, 0.85, 1.7);
            spawnDamageNumber(
              p.sx,
              p.sy,
              ev.shielded ? '⛨' : String(Math.max(1, Math.round(ev.amount))),
              kind,
              ds,
            );
          }
          if (!ev.shielded) {
            audio.play('enemyHit');
            this.auraFleck(ev.source, ev.amount, ev.x, ev.z);
          }
          break;
        }
        case 'enemyDied': {
          this.kills++;
          const def = ENEMY_DEFS[ev.defId];
          // 최대 체력(웨이브 스케일 포함) 기반 — 대형/후반 적일수록 크게 터진다
          const s = clamp(
            Math.pow(Math.max(1, ev.maxHp) / REF_HP, HP_EXP) * (def.boss ? 1.3 : 1),
            0.7,
            3.4,
          );
          const w = s3.cellToWorld(ev.x, ev.z, this.v);
          s3.particles.explosion(w.x, 0.45, w.z, {
            strength: s,
            core: def.boss ? 0xffe08a : 0xfff2cf,
            debris: def.boss ? 0xffb648 : 0xd9c8a0,
            smoke: def.boss ? 0x7a5f44 : 0xa89b7e,
            shock: def.boss ? 0xffc65a : 0xffeec2,
            gravity: 8,
            debrisMul: def.boss ? 1.5 : 1,
            smokeMul: def.boss ? 1.4 : 0.9,
            shockRadius: (def.radius + 0.25) * (def.boss ? 1.5 : 1),
            smokeLifeMul: 1.2,
          });
          if (def.boss) {
            this.bossKills++;
            this.shake(clamp(0.12 * s, 0.12, 0.42));
            this.buzz(40);
          } else if (s > 1.6) {
            this.shake(0.03 * s);
          }
          const p = this.worldToScreen(ev.x, 1.3, ev.z);
          if (p) spawnDamageNumber(p.sx, p.sy, `+${ev.bounty}`, 'gold', clamp(s * 0.75, 0.9, 1.6));
          audio.play('enemyDie');
          break;
        }
        case 'towerPlaced': {
          s3.towers.add(ev.towerId, ev.defId, 0, ev.cellX, ev.cellZ);
          const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
          s3.particles.ring(w.x, w.z, 0xd9c8a0, 0.7);
          s3.particles.shockwave(w.x, w.z, 0xffe6ad, 0.62, 0.3, { count: 16 });
          audio.play('towerPlace');
          this.buzz(12);
          break;
        }
        case 'towerUpgraded': {
          s3.towers.upgrade(ev.towerId, ev.tier);
          const t = this.findTowerCell(ev.towerId);
          if (t) {
            const w = s3.cellToWorld(t.x, t.z, this.v);
            const color = TOWER_FX_COLOR[ev.defId];
            // 티어가 오를수록 승급 연출도 커진다
            const s = 0.9 + ev.tier * 0.4;
            s3.particles.explosion(w.x, 0.75, w.z, {
              strength: s,
              core: 0xfff6d8,
              debris: color,
              smoke: color,
              shock: color,
              gravity: -2.5,
              debrisMul: 1.1,
              smokeMul: 1.2,
              shockRadius: 0.55,
              spreadMul: 0.8,
              smokeLifeMul: 1.4,
            });
          }
          audio.play('towerUpgrade');
          this.buzz(12);
          break;
        }
        case 'towerSold':
          s3.towers.remove(ev.towerId);
          audio.play('towerSell');
          break;
        case 'towerFired':
          s3.towers.recoil(ev.towerId);
          audio.play(FIRE_SFX[ev.defId]);
          break;
        case 'projectileHit': {
          const w = s3.cellToWorld(ev.x, ev.z, this.v);
          const st = IMPACT_STYLE[ev.towerDefId];
          const s = fxStrength(ev.dmg, ev.tier);
          s3.particles.explosion(w.x, ev.splash ? 0.22 : 0.42, w.z, {
            strength: s,
            core: st.core,
            debris: st.debris,
            smoke: st.smoke,
            shock: st.shock,
            gravity: st.gravity,
            debrisMul: st.debrisMul * (ev.splash ? 1.2 : 1),
            smokeMul: st.smokeMul * (ev.splash ? 1.15 : 1),
            shockMul: st.shockMul * (ev.splash ? 1.25 : 0.8),
            sizeMul: st.sizeMul,
            flashMul: st.flashMul,
            spreadMul: st.spreadMul,
            smokeLifeMul: st.smokeLifeMul,
            shockRadius: st.shockRadius,
            // 스플래시면 링이 실제 피해 반경을 그대로 그린다 (가독성 = 정보)
            ...(ev.splashRadius !== undefined ? { shockRadiusAbs: ev.splashRadius * 1.02 } : {}),
          });
          if (ev.splash) {
            audio.play('boulderImpact');
            this.shake(clamp(0.055 * Math.pow(s, 1.45) * st.shakeMul, 0.03, 0.3));
          } else if (s > 1.5) {
            this.shake(clamp(0.014 * s * st.shakeMul, 0, 0.09));
          }
          break;
        }
        case 'beamFired': {
          const s = fxStrength(ev.dmg, ev.tier);
          s3.projectiles.addBeam(ev.points, 1.1, s);
          const st = IMPACT_STYLE.lightning;
          // 체인 경유점마다 짧고 날카로운 스파크 (첫 점 = 타워, 제외)
          for (let i = 1; i < ev.points.length; i++) {
            const pt = ev.points[i];
            if (!pt) continue;
            const w = s3.cellToWorld(pt.x, pt.z, this.v);
            // 뒤쪽 점프일수록 피해가 줄어드니 연출도 감쇠
            const js = Math.max(0.55, s * Math.pow(0.78, i - 1));
            s3.particles.explosion(w.x, pt.flying ? 1.55 : 0.5, w.z, {
              strength: js,
              core: st.core,
              debris: st.debris,
              smoke: st.smoke,
              shock: pt.flying ? 0 : st.shock,
              gravity: st.gravity,
              debrisMul: st.debrisMul,
              smokeMul: st.smokeMul,
              shockMul: st.shockMul,
              sizeMul: st.sizeMul,
              flashMul: st.flashMul,
              spreadMul: st.spreadMul,
              smokeLifeMul: st.smokeLifeMul,
              shockRadius: st.shockRadius,
            });
          }
          if (s > 1.6) this.shake(clamp(0.02 * s, 0, 0.09));
          break;
        }
        case 'statusApplied': {
          const e = this.stage3d.enemies; // 히트 플래시로 대체 표시
          e.setHitFlash(ev.enemyId);
          void STATUS_COLOR[ev.kind];
          break;
        }
        case 'baseDamaged': {
          this.shake(0.35);
          audio.play('baseHit');
          this.buzz(50);
          const ratio = ev.hpLeft / Math.max(1, this.baseHpMax);
          s3.setBaseDamageLevel(ratio > 0.6 ? 0 : ratio > 0.3 ? 1 : 2);
          break;
        }
        case 'earlyCallBonus': {
          if (ev.gold > 0) audio.play('earlyCall');
          break;
        }
        case 'battleEnded':
          audio.music.playStinger(ev.won ? 'victory' : 'defeat');
          audio.play(ev.won ? 'victory' : 'defeat');
          this.buzz(ev.won ? [40, 60, 120] : 80);
          break;
        default:
          break;
      }
    }
  }

  /**
   * brazier 오라 펄스 / 화상·독 DoT의 불티. 별도 이벤트가 없으므로 피해 이벤트에
   * 편승하되, 배치당 개수를 제한해 4배속 다중 타격에서도 풀을 고갈시키지 않는다.
   */
  private auraFleck(source: TowerId | StatusKind, amount: number, x: number, z: number): void {
    if (source !== 'brazier' && source !== 'burn' && source !== 'poison') return;
    if (this.auraFlecks >= 5 || this.stage3d.particles.load > 0.72) return;
    this.auraFlecks++;
    // 오라 피해량이 곧 티어 → 티어가 오르면 펄스도 굵고 오래간다
    const s = fxStrength(amount, 0);
    const w = this.stage3d.cellToWorld(x, z, this.v);
    if (source === 'brazier') {
      // 오라 펄스는 별도 이벤트가 없다 — 피해를 입은 적 자리에서 작은 화염 폭발로 보여준다
      const st = IMPACT_STYLE.brazier;
      this.stage3d.particles.explosion(w.x, 0.3, w.z, {
        strength: s * 0.85,
        core: st.core,
        debris: st.debris,
        smoke: st.smoke,
        shock: st.shock,
        gravity: -1.4,
        debrisMul: 0.85,
        smokeMul: 1.25,
        shockMul: 0.6,
        sizeMul: 0.9,
        flashMul: 0.85,
        spreadMul: 0.85,
        smokeLifeMul: 1.5,
        shockRadius: 0.32,
      });
      return;
    }
    // 화상/독 DoT — 잔불·포자 몇 점만
    const fire = source === 'burn';
    this.stage3d.particles.burst(
      w.x,
      0.35,
      w.z,
      fire ? 0xff9d3c : 0x8fd14f,
      Math.round(2 + 3 * s),
      0.5 + 0.5 * s,
      0.05 * Math.pow(s, 0.5),
      0.45 + 0.35 * s,
      { gravity: fire ? -1.6 : -0.8, drag: 1.6, upBias: 0.9, sizeVar: 0.6, glow: fire, grow: 0.06 },
    );
  }

  /** baseDamaged 비율 계산용 (컨트롤러가 주입) */
  baseHpMax = 1;

  private findTowerCell(towerId: number): { x: number; z: number } | null {
    // 타워 셀은 뷰가 알고 있음 — positionOf는 월드 좌표라 셀 역변환 대신 상태에서 찾기
    return this.towerCellLookup?.(towerId) ?? null;
  }

  /** 컨트롤러가 sim 상태 조회 함수 주입 */
  towerCellLookup: ((towerId: number) => { x: number; z: number } | null) | null = null;
}
