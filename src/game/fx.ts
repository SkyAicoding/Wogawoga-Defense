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
import type { AllyId, EnemyId, HometownSourceId, SimEvent, StatusKind, TowerId } from '@/data/types';
import { TICK_DT } from '@/data/types';
import { ENEMY_DEFS } from '@/data';
import { clamp } from '@/core/mathx';
import { vibrate } from '@/core/device';
import { audio } from '@/audio';
import type { SfxName } from '@/audio';
import type { Stage3D } from '@/render/stage3d';
import { towerTierScale } from '@/render/meshlib/towers';
import { ATK_LAUNCH } from '@/render/meshlib/gait';
import type { RaidShotOpts } from '@/render/views/projectileview';
import type { DioramaCamera } from '@/render/camera';
import { showBossBanner, showWaveBanner } from '@/ui/screens/battlehud';
import { damageText, spawnDamageNumber } from '@/ui/widgets/damagenumbers';
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

/** 한 배치에서 허용하는 타워 피격 연출(파편+숫자) 수 — 부족 무리의 난타 스팸 방지 */
const TOWER_HIT_FX_MAX = 4;
/**
 * 한 배치에서 궤적을 그릴 아군 원거리 타격 수 상한.
 * 아군은 최대 6명이지만 4배속에서는 한 배치에 여러 틱이 몰려 들어와,
 * 상한이 없으면 돌팔매 궤적만으로 파티클 예산을 먹고 적 피격 연출이 사라진다.
 */
const ALLY_SHOT_FX_MAX = 3;
/**
 * 한 배치에서 궤적을 그릴 **습격대 투척** 수 상한 (raidAttack).
 * 타워 피격 상한(TOWER_HIT_FX_MAX 4)보다 넉넉한 이유는 이 궤적이 "무리가 지금
 * 어디서 던지고 있는가"를 읽는 유일한 단서라서다 — 착탄 연출은 솎여도 되지만
 * 발사가 통째로 사라지면 무리 절반이 팔만 흔드는 그림이 된다.
 */
const RAID_SHOT_FX_MAX = 6;

export function fxStrength(dmg: number, tier: number): number {
  const d = Math.max(1, dmg);
  return clamp(Math.pow(d / REF_DMG, DMG_EXP) * (1 + tier * TIER_GAIN), S_MIN, S_MAX);
}

/**
 * 적 부족의 타워 타격 연출 사양 — 무기별로 소리와 파편이 달라야 "누가 때리는지"가 들린다.
 * 기존 SFX/파티클 자산만 조합한다(새 레시피 없음).
 * **전원 원거리 개편 이후 trail은 전부 true다** — 타워를 때리는 종은 모두 무언가를
 * 던지거나 쏘므로, 궤적이 없으면 피해가 어디서 왔는지 화면에서 읽히지 않는다.
 * 궤적은 towerDamaged(착탄)가 아니라 raidAttack(발사) 사건이 그린다.
 *  · 투창/장창: 나무·돌 파편이 튀는 둔탁한 명중.
 *  · 화살: 뼈색 파편.
 *  · 저주(주술): 마젠타 룬이 타워를 감싸며 올라온다.
 */
interface RaidHitStyle {
  sfx: SfxName;
  /** 파편 색 */
  chip: number;
  /** 파편 수 배율 */
  chips: number;
  /** 날아오는 궤적을 그릴 것인가 (원거리 전용) */
  trail: boolean;
  /**
   * 실제로 날아가는 물건. **타워 투사체 메시의 뒷자리를 빌린다** —
   * 전용 메시를 만들면 무조건 드로우콜 +1 인데, 이미 만들어 둔 메시는 그 타워를
   * 쓰는 플레이어에겐 +0 이고 안 쓰는 플레이어에게만 켜지므로 어떤 경우에도
   * 나쁘지 않다 (근거 전문은 render/views/projectileview.ts RaidShot 주석).
   * 없으면 파티클 궤적만 남는다.
   */
  shot?: RaidShotOpts;
}
const RAID_HIT_DEFAULT: RaidHitStyle = { sfx: 'enemyHit', chip: 0xc8b189, chips: 1, trail: false };
const RAID_HIT: Partial<Record<string, RaidHitStyle>> = {
  // 짧은 창 연투 — 가볍고 빠르다
  blade: {
    sfx: 'spearThrow',
    chip: 0xd9c8a0,
    chips: 1,
    trail: true,
    shot: { borrow: 'spear', scale: 0.8, speed: 9 },
  },
  // 장창 투척 — 한 방이 무거워 파편이 크게 튄다. 같은 창을 크고 느리게 던진다
  lancer: {
    sfx: 'boulderImpact',
    chip: 0xc8b189,
    chips: 1.5,
    trail: true,
    shot: { borrow: 'spear', scale: 1.2, speed: 6 },
  },
  // 부족 전사 — 곤봉의 큰 호 끝에서 **돌덩이**가 나간다 (사거리 2.2라 곤봉은 닿지 않는다)
  warrior: {
    sfx: 'spearThrow',
    chip: 0xc8b189,
    chips: 0.9,
    trail: true,
    shot: { borrow: 'catapult', scale: 0.6, speed: 6.5 },
  },
  // 화살 — 발리스타 볼트를 작게. 가장 빠르고 가늘다
  archer: {
    sfx: 'spearThrow',
    chip: 0xece0c4,
    chips: 0.8,
    trail: true,
    shot: { borrow: 'ballista', scale: 0.55, speed: 12 },
  },
  // 저주 — 화로 구체를 마젠타로 물들인다. hexer 염료·침묵 룬과 같은 계열
  hexer: {
    sfx: 'poisonSpit',
    chip: 0xd94ad0,
    chips: 0.6,
    trail: true,
    shot: { borrow: 'brazier', scale: 0.8, speed: 5.5, tint: 0xd94ad0 },
  },
};

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
  /** 타워 피격 파편/숫자 스팸 방지 — 무리가 동시에 두들기면 금방 찬다 */
  private towerHits = 0;
  private allyShots = 0;
  private raidShots = 0;
  /**
   * 살아 있는 적의 종 — 데미지 숫자 표기 규약이 armor를 알아야 해서 스폰 때 기억한다.
   * **연출 전용 표다.** 시뮬레이션은 이 표를 모르고, 여기 값이 틀려도 판정은 안 바뀐다.
   * 스폰에서 넣고 사망/누수에서 지우므로 크기는 항상 '지금 살아 있는 마릿수'다.
   */
  private readonly foeDef = new Map<number, EnemyId>();

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
    this.towerHits = 0;
    this.allyShots = 0;
    this.raidShots = 0;
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
        case 'enemySpawned':
          // 표기 규약(괄호/느낌표)이 이 적의 armor를 알아야 한다. enemyDamaged는 종을
          // 싣고 다니지 않고, 맞는 순간에는 이미 죽어 상태 목록에서 빠졌을 수 있다 —
          // 그래서 스폰에서 종을 기억해 둔다 (연출 전용 표. sim은 이 표를 모른다).
          this.foeDef.set(ev.enemyId, ev.defId);
          break;
        case 'enemyDamaged': {
          s3.enemies.setHitFlash(ev.enemyId);
          const p = this.worldToScreen(ev.x, 1.1, ev.z);
          if (p) {
            const isDot = ev.source in STATUS_KIND;
            const kind: DamageKind = isDot
              ? (STATUS_KIND[ev.source as StatusKind] ?? 'normal')
              : 'normal';
            /*
             * armor 감산이 실제로 적용된 경로에서만 부호를 붙인다.
             * 지속 피해(burn/poison)는 뺀다 — 독은 armor를 무시하고(combat.damageEnemy
             * ignoreArmor), 화상은 틱이 작아 **언제나** 괄호가 된다. 매 틱 켜져 있는
             * 부호는 정보가 아니라 배경이다.
             * ⚠ 'poison'은 TowerId이면서 StatusKind라(계약의 I-5 위반이 이미 있다)
             *   직격과 DoT를 이 자리에서 구분할 수 없다 — 그래서 통째로 뺀다.
             */
            const armor = isDot ? 0 : (ENEMY_DEFS[this.foeDef.get(ev.enemyId) ?? 'raptor']?.armor ?? 0);
            // 큰 피해일수록 숫자도 커진다 (0.85~1.7배)
            const ds = ev.shielded ? 1 : clamp(0.7 + fxStrength(ev.amount, 0) * 0.32, 0.85, 1.7);
            spawnDamageNumber(
              p.sx,
              p.sy,
              ev.shielded ? '⛨' : damageText(ev.amount, armor),
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
          this.foeDef.delete(ev.enemyId);
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
          s3.towerStatus.clearCell(ev.cellX, ev.cellZ); // 재건설 = 잔해 정리
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
            const color = TOWER_FX_COLOR[ev.defId];
            // 티어가 오를수록 승급 연출도 커진다
            const s = 0.9 + ev.tier * 0.4;
            // 폭발 높이는 티어 스케일을 따라간다 — 고정값(0.75)이면 0.6배인 저티어
            // 승급에서 지붕보다 한참 위 허공에서 터진다 (실측 캡처 확인)
            const y = 0.1 + towerTierScale(ev.tier) * 0.95;
            s3.particles.explosion(w.x, y, w.z, {
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
        case 'towerDamaged': {
          s3.towers.hit(ev.towerId);
          // 타격 지점에 나무/돌 파편 몇 점 — 무리가 두들기면 배치당 상한에 걸린다
          if (this.towerHits < TOWER_HIT_FX_MAX) {
            this.towerHits++;
            const st = RAID_HIT[ev.attackerDefId] ?? RAID_HIT_DEFAULT;
            const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
            s3.particles.burst(w.x, 0.55, w.z, st.chip, Math.round(4 * st.chips), 1.5, 0.055, 0.4, {
              gravity: 9,
              drag: 1.4,
              upBias: 0.7,
              sizeVar: 0.6,
            });
            const p = this.worldToScreen(ev.cellX, 1.35, ev.cellZ);
            // "-14" — 적 피해(흰색)와 **다른 종류**로 띄운다. 부호만으로는 숫자가
            // 겹쳤을 때 판독이 안 됐다 (적의 '12'와 타워의 '-15'가 포개진다)
            if (p) spawnDamageNumber(p.sx, p.sy, `-${Math.round(ev.amount)}`, 'tower', 1);
            audio.play(st.sfx);
          }
          // 체력이 1/3 밑으로 떨어지는 순간에만 한 번 흔든다 (매 타격 셰이크는 멀미)
          if (ev.hpLeft > 0 && ev.hpLeft < ev.maxHp / 3 && ev.hpLeft + ev.amount >= ev.maxHp / 3) {
            this.shake(0.14);
            this.buzz(25);
          }
          break;
        }
        case 'raidAttack': {
          /**
           * 습격대가 무기를 놓은 순간 — **공격자 쪽** 사건이라 towerDamaged의
           * TOWER_HIT_FX_MAX(피격 연출 상한)와 예산을 공유하지 않는다.
           * 궤적을 여기로 옮긴 이유가 그것이다: 착탄 연출이 솎여 나가도 "누가 어디서
           * 던졌는가"는 남아야 무리 전체의 동작이 화면에서 읽힌다.
           * 발사 위치(ev.x/z)를 쓰므로 착탄 시점의 위치를 쓰던 예전보다 궤적이 정확하다.
           *
           * 공격 동작(팔·무기) 자체는 EnemyState.attackAnimLeft를 읽는 **렌더 쪽** 몫이다 —
           * 이벤트는 놓칠 수 있지만 per-frame 상태는 못 놓치기 때문이다.
           */
          const st = RAID_HIT[ev.attackerDefId] ?? RAID_HIT_DEFAULT;
          if (st.trail && ev.ranged && this.raidShots < RAID_SHOT_FX_MAX) {
            this.raidShots++;
            /**
             * 무기가 **손을 떠나는 순간**에 맞춰 늦춘다. raidAttack 은 던지기가
             * 시작되는 틱에 나가므로(피해는 이미 확정) 그대로 쏘면 젖히는 팔에서
             * 물건이 먼저 튀어나간다 — 애써 만든 동작이 거짓말이 된다.
             * ATK_LAUNCH 는 셰이더가 쓰는 릴리스 지점과 **같은 상수**다.
             */
            const delay = ev.animTicks * ATK_LAUNCH * TICK_DT;
            const flew =
              st.shot !== undefined &&
              s3.projectiles.addRaidShot(ev.x, ev.z, ev.cellX, ev.cellZ, {
                ...st.shot,
                delay,
              });
            // 던질 물건이 없거나 예산이 찼을 때만 파티클 궤적으로 대신한다
            if (!flew) this.raidShot(ev.x, ev.z, ev.cellX, ev.cellZ, st.chip);
          }
          break;
        }
        case 'towerSilenced': {
          // 저주는 "타워가 조용해진다"는 **부재**로 표현되는 상태라 그것만으로는 안 보인다.
          // 걸리는 순간 마젠타 룬이 타워를 감싸 올라가게 해 원인을 눈에 보이게 만든다.
          // (저주는 주술사가 재타격할 때마다 갱신되므로 이 연출이 주기적으로 반복된다)
          if (this.towerHits < TOWER_HIT_FX_MAX) {
            const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
            s3.particles.ring(w.x, w.z, 0xd94ad0, 0.5, 10);
            s3.particles.burst(w.x, 0.75, w.z, 0xe86ad0, 6, 0.9, 0.07, 0.75, {
              gravity: -1.2,
              drag: 1.5,
              upBias: 1,
              sizeVar: 0.5,
              glow: true,
            });
            audio.play('frostCast'); // 기존 자산 — 짧고 차가운 '주문 걸림' 소리
          }
          break;
        }
        case 'towerDestroyed': {
          s3.towers.remove(ev.towerId);
          // 지속 신호 — 그 칸에 잔해가 남는다(다시 지을 때까지). 파티클은 2초면
          // 사라지므로, 시선을 뗀 사이에 잃으면 무엇이 없어졌는지 되짚을 수 없었다.
          s3.towerStatus.markDestroyed(ev.cellX, ev.cellZ, ev.tier);
          const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
          // 티어가 높을수록 큰 잔해 — 목재 파편 + 흙먼지.
          // 구조물이 무너지는 사건이라 소품 제거(1.5)보다 크게 잡는다
          const s = 2.0 + ev.tier * 0.4;
          s3.particles.explosion(w.x, 0.45 * towerTierScale(ev.tier) + 0.2, w.z, {
            strength: s,
            core: 0xffe0a8,
            debris: 0x8d6b46,
            smoke: 0x9a8f7a,
            shock: 0xd8c096,
            gravity: 13,
            debrisMul: 2.2,
            smokeMul: 1.7,
            shockMul: 1.25,
            sizeMul: 1.35,
            flashMul: 1.2,
            spreadMul: 1.3,
            smokeLifeMul: 1.7,
            shockRadius: 0.72,
          });
          s3.particles.ring(w.x, w.z, 0xb08a5a, 0.7);
          // 파괴 전용 소리 — boulderImpact는 창잡이의 평타와 투석기 착탄에도 쓰여
          // "타워를 잃었다"에 고유한 청각 신호가 없었다
          audio.play('towerFall');
          this.shake(clamp(0.1 * s, 0.12, 0.3));
          this.buzz([30, 40, 60]);
          break;
        }
        case 'sceneryCleared': {
          // 소품 메시를 먼저 지우고(재병합) 그 자리에 먼지+파편을 터뜨린다.
          // 렌더가 스스로 판단하지 않고 sim 이벤트에만 반응한다 (진실의 원천 = sim)
          s3.clearScenery(ev.cellX, ev.cellZ);
          const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
          s3.particles.explosion(w.x, 0.4, w.z, {
            strength: 1.5,
            core: 0xfff0cf,
            debris: 0x8d7d63,
            smoke: 0xd9cdb2,
            shock: 0xe8cf9e,
            gravity: 12,
            debrisMul: 1.7,
            smokeMul: 1.6,
            shockMul: 1.15,
            sizeMul: 1.1,
            spreadMul: 1.15,
            smokeLifeMul: 1.5,
            shockRadius: 0.62,
          });
          s3.particles.ring(w.x, w.z, 0xd9c8a0, 0.62);
          audio.play('boulderImpact');
          this.shake(0.08);
          this.buzz(18);
          break;
        }
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
        // --- 아군 부족원 -----------------------------------------------------
        case 'allyTrained': {
          // 마을에서 사람이 튀어나온다 — 흙먼지 고리 + 발자국 먼지.
          // 기지가 화면 구석에 있을 수 있어 **소리로도** 나갔다는 걸 알린다
          const w = s3.cellToWorld(ev.x, ev.z, this.v);
          s3.particles.ring(w.x, w.z, 0xd8c7a4, 0.55, 9);
          s3.particles.burst(w.x, 0.35, w.z, 0xc9b48c, 7, 1.1, 0.06, 0.5, {
            gravity: 7,
            drag: 1.5,
            upBias: 0.9,
            sizeVar: 0.5,
          });
          audio.play('towerPlace');
          break;
        }
        case 'allyAttacked': {
          // 원거리(돌팔매)만 궤적을 그린다 — 근접은 enemyDamaged의 피격 연출로 충분하고,
          // 여기서 또 터뜨리면 난전에서 파티클 예산이 적 피격 연출을 밀어낸다
          if (ev.ranged) this.allyShots++;
          if (ev.ranged && this.allyShots <= ALLY_SHOT_FX_MAX) {
            this.raidShot(ev.x, ev.z, ev.targetX, ev.targetZ, 0x9fd8ff);
          }
          break;
        }
        case 'allyDamaged': {
          // 내 편이 깎이는 숫자는 타워와 같은 종류('tower')로 띄운다 —
          // 적 피해(흰색)와 색이 갈려야 난전에서 "누가 맞고 있는가"가 읽힌다
          const p = this.worldToScreen(ev.x, 1.15, ev.z);
          if (p) spawnDamageNumber(p.sx, p.sy, `-${Math.round(ev.amount)}`, 'tower', 0.9);
          break;
        }
        case 'allyDied': {
          const w = s3.cellToWorld(ev.x, ev.z, this.v);
          s3.particles.burst(w.x, 0.5, w.z, 0x9fd8ff, 10, 1.6, 0.06, 0.7, {
            gravity: 9,
            drag: 1.3,
            upBias: 0.8,
            sizeVar: 0.6,
          });
          audio.play('enemyDie');
          break;
        }
        case 'allyRetired': {
          // 죽은 게 아니라 **돌아간** 것 — 폭발이 아니라 위로 흩어지는 먼지 한 줌으로
          // 구분한다. 소리를 주지 않는 이유도 같다(손실이 아니므로 경보가 아니다)
          const w = s3.cellToWorld(ev.x, ev.z, this.v);
          s3.particles.burst(w.x, 0.45, w.z, 0xd8c7a4, 5, 0.7, 0.05, 0.8, {
            gravity: -0.8,
            drag: 1.8,
            upBias: 1,
            sizeVar: 0.4,
          });
          break;
        }
        case 'statusApplied': {
          const e = this.stage3d.enemies; // 히트 플래시로 대체 표시
          e.setHitFlash(ev.enemyId);
          void STATUS_COLOR[ev.kind];
          break;
        }
        case 'enemyLeaked':
          // 기지에 닿아 사라진 적 — 사망(enemyDied)을 거치지 않으므로 여기서 지운다.
          // 안 지우면 표가 판 전체의 누적 스폰 수만큼 자란다.
          this.foeDef.delete(ev.enemyId);
          break;
        case 'baseDamaged': {
          this.shake(0.35);
          audio.play('baseHit');
          this.buzz(50);
          const ratio = ev.hpLeft / Math.max(1, this.baseHpMax);
          s3.setBaseDamageLevel(ratio > 0.6 ? 0 : ratio > 0.3 ? 1 : 2);
          break;
        }
        case 'baseFired': {
          // 전용 발사음 자산이 없어 발리스타/창의 투척음을 빌린다 (화살 지오메트리도 같은 출처).
          // 화살 자체는 투사체 뷰가 그리므로 여기서는 소리와 시위 먼지 한 줌만.
          audio.play('spearThrow');
          const w = s3.cellToWorld(ev.x, ev.z, this.v);
          s3.particles.burst(w.x, 0.75, w.z, 0xece0c4, 2, 0.9, 0.04, 0.22, {
            gravity: 2,
            drag: 2,
            upBias: 0.5,
            sizeVar: 0.4,
          });
          break;
        }
        case 'baseUpgraded': {
          /**
           * 마을이 한 단계 커졌다. setBaseLevel 이 그 레벨의 구조물 레이어를 실제로
           * 얹으므로(움막 → 목책·모닥불 → 망루·토템 → 돌담·깃발 → 큰 장옥) 연출의 몫은
           * **그 순간에 눈을 마을로 끌어오는 것**이다. 세 겹으로 준다:
           *  · 흙먼지 — 땅을 파고 기둥을 세웠다는 인과
           *  · 금빛 고리 2겹(넓게 한 번, 좁고 밝게 한 번) — 새 구조물이 솟는 '빛'
           *  · towerUpgrade 사운드 + 햅틱 — 타워 업그레이드와 같은 언어(전용 자산 없음)
           */
          this.baseHpMax = ev.hpMax;
          s3.setBaseLevel(ev.level);
          const ratio = ev.hp / Math.max(1, ev.hpMax);
          s3.setBaseDamageLevel(ratio > 0.6 ? 0 : ratio > 0.3 ? 1 : 2);
          audio.play('towerUpgrade');
          this.buzz(30);
          // 기지 좌표는 이벤트에 싣지 않았다 — 마을은 판에 하나뿐이고 렌더가 이미 안다
          const w = s3.basecamp.group.position;
          s3.particles.burst(w.x, 0.4, w.z, 0xd8c7a4, 16, 1.4, 0.09, 0.9, {
            gravity: 3,
            drag: 1.4,
            upBias: 0.9,
            sizeVar: 0.7,
          });
          s3.particles.ring(w.x, w.z, 0xffd8a0, 1.1);
          // 안쪽에 한 겹 더 — 바깥 고리보다 좁고 밝아 "마을이 부풀어 오른다"로 읽힌다
          s3.particles.ring(w.x, w.z, 0xfff2c8, 0.6, 10);
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
  private auraFleck(
    source: TowerId | StatusKind | AllyId | HometownSourceId,
    amount: number,
    x: number,
    z: number,
  ): void {
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

  /**
   * 부족 원거리 타격의 날아온 궤적 — 실제 투사체를 만들지 않고 점선으로만 그린다.
   * (sim에는 이 투사체가 없다. 피해는 이미 적용된 뒤라 궤적은 순수 사후 연출이고,
   *  투사체 풀·명중 판정을 늘리지 않으면서 "어디서 날아왔는지"만 전달한다)
   */
  private raidShot(fromX: number, fromZ: number, toX: number, toZ: number, color: number): void {
    const s3 = this.stage3d;
    if (s3.particles.load > 0.8) return; // 파티클 예산 포화 시 궤적부터 포기
    const a = s3.cellToWorld(fromX, fromZ, this.v);
    const ax = a.x;
    const az = a.z;
    const b = s3.cellToWorld(toX, toZ, this.v);
    const N = 5;
    for (let i = 1; i <= N; i++) {
      const t = i / (N + 1);
      // 살짝 포물선 — 직선이면 지면 데칼처럼 보인다
      const y = 0.45 + Math.sin(t * Math.PI) * 0.28;
      s3.particles.trail(ax + (b.x - ax) * t, y, az + (b.z - az) * t, color, 0.055);
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
