/**
 * SimEvent → 연출 라우터: 파티클/히트플래시/셰이크/데미지숫자/사운드/진동/배너/음악 강도.
 * 매 프레임 drainEvents() 결과를 handle()로 넘긴다.
 */
import * as THREE from 'three';
import type { SimEvent, StatusKind, TowerId } from '@/data/types';
import { ENEMY_DEFS } from '@/data';
import { vibrate } from '@/core/device';
import { audio } from '@/audio';
import type { SfxName } from '@/audio';
import type { Stage3D } from '@/render/stage3d';
import type { DioramaCamera } from '@/render/camera';
import { showBossBanner, showWaveBanner } from '@/ui/screens/battlehud';
import { spawnDamageNumber } from '@/ui/widgets/damagenumbers';
import type { DamageKind } from '@/ui/widgets/damagenumbers';

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

  constructor(
    private stage3d: Stage3D,
    private camera: DioramaCamera,
    private canvas: HTMLCanvasElement,
    private getWaveCount: () => number,
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

  handle(events: readonly SimEvent[]): void {
    const s3 = this.stage3d;
    for (const ev of events) {
      switch (ev.type) {
        case 'waveStarted': {
          showWaveBanner(ev.wave, ev.wave === this.getWaveCount());
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
          this.camera.shake(0.4);
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
            spawnDamageNumber(p.sx, p.sy, ev.shielded ? '⛨' : String(ev.amount), kind);
          }
          if (!ev.shielded) audio.play('enemyHit');
          break;
        }
        case 'enemyDied': {
          this.kills++;
          const def = ENEMY_DEFS[ev.defId];
          if (def.boss) {
            this.bossKills++;
            this.camera.shake(0.3);
            this.buzz(40);
          }
          const w = s3.cellToWorld(ev.x, ev.z, this.v);
          s3.particles.burst(w.x, 0.5, w.z, 0xd9c8a0, def.boss ? 26 : 10, 3.2, 0.09, 0.5, {
            upBias: 0.75,
          });
          const p = this.worldToScreen(ev.x, 1.3, ev.z);
          if (p) spawnDamageNumber(p.sx, p.sy, `+${ev.bounty}`, 'gold');
          audio.play('enemyDie');
          break;
        }
        case 'towerPlaced': {
          s3.towers.add(ev.towerId, ev.defId, 0, ev.cellX, ev.cellZ);
          const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
          s3.particles.ring(w.x, w.z, 0xd9c8a0, 0.7);
          audio.play('towerPlace');
          this.buzz(12);
          break;
        }
        case 'towerUpgraded': {
          s3.towers.upgrade(ev.towerId, ev.tier);
          const t = this.findTowerCell(ev.towerId);
          if (t) {
            const w = s3.cellToWorld(t.x, t.z, this.v);
            s3.particles.burst(w.x, 0.8, w.z, TOWER_FX_COLOR[ev.defId], 14, 2.6, 0.08, 0.5, {
              upBias: 0.85,
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
          const color = TOWER_FX_COLOR[ev.towerDefId];
          if (ev.splash) {
            s3.particles.burst(w.x, 0.25, w.z, color, 16, 3.4, 0.1, 0.45, { upBias: 0.7 });
            s3.particles.ring(w.x, w.z, color, 0.9);
            audio.play('boulderImpact');
            this.camera.shake(0.08);
          } else {
            s3.particles.burst(w.x, 0.5, w.z, color, 5, 2.2, 0.06, 0.3);
          }
          break;
        }
        case 'beamFired':
          s3.projectiles.addBeam(ev.points);
          break;
        case 'statusApplied': {
          const e = this.stage3d.enemies; // 히트 플래시로 대체 표시
          e.setHitFlash(ev.enemyId);
          void STATUS_COLOR[ev.kind];
          break;
        }
        case 'baseDamaged': {
          this.camera.shake(0.35);
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

  /** baseDamaged 비율 계산용 (컨트롤러가 주입) */
  baseHpMax = 1;

  private findTowerCell(towerId: number): { x: number; z: number } | null {
    // 타워 셀은 뷰가 알고 있음 — positionOf는 월드 좌표라 셀 역변환 대신 상태에서 찾기
    return this.towerCellLookup?.(towerId) ?? null;
  }

  /** 컨트롤러가 sim 상태 조회 함수 주입 */
  towerCellLookup: ((towerId: number) => { x: number; z: number } | null) | null = null;
}
