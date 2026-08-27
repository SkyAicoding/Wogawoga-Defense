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
import { ShakeBus } from './shakebus';
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

/**
 * 셰이크 규칙은 **`./shakebus` 에 있다** — 이 파일에서 떼어 낸 이유와 두 채널의 유도가
 * 전부 그 파일 머리말에 있다(요약: 큰 사건만 판을 흔든다. 착탄은 피해와 무관한 고정
 * 세기 한 톡이고 시계로 스로틀한다). 여기서는 **어떤 사건이 어느 채널인가**만 정한다.
 */
/**
 * 마을 피격이 **판을 흔드는** 문턱 — 한 배치에 잃은 HP 비율.
 * 0.15 = 25 HP 기준 3.75. 한 입(0.04)·두 입(0.08) 은 못 넘고, 문을 뚫고 들어간
 * 큰 놈의 잔액 한 방은 넘는다 (flushBaseHits 주석).
 */
const BASE_QUAKE_FRAC = 0.15;

/** 한 배치에서 허용하는 타워 피격 연출(파편+숫자) 수 — 부족 무리의 난타 스팸 방지 */
const TOWER_HIT_FX_MAX = 4;
/**
 * 한 배치에서 그릴 **문간 도착** 연출 수 상한 (src/sim/gate.ts).
 *
 * ⚠ 이 상한이 필요해진 것이 문간 설계의 가장 큰 연출상 변화다. gate-wip 에서 문 앞에
 *   서는 것은 **보스뿐**이라 동시 2마리였는데, 이번 설계는 종을 안 가리므로
 *   (규칙 1·9 — 사용자 요구 "모두 통일") 홍수 웨이브(s1 w31 = 57마리 · w44 = 60마리)에서
 *   초당 여섯 마리가 같은 자리에 도착한다. 도착마다 먼지를 피우면 파티클 풀(512)이
 *   **도착 연출 하나로** 마르고, 정작 봐야 할 타워 착탄과 사망 폭발이 사라진다.
 */
const GATE_ARRIVE_FX_MAX = 3;
/**
 * 마을 피격음의 최소 간격 (ms).
 *
 * 종전에 `baseDamaged` 는 **적이 도달할 때 한 번**이었다. 문간에서는 문 앞의 적
 * 하나하나가 1초에 한 번씩 물어(gate.ts 규칙 5) 같은 사건이 **초당 열몇 번**이 된다.
 * sfx.ts 가 이미 레시피당 100ms 창에 3회로 막지만 그건 초당 30회라 여전히 기관총이다.
 * 여기서 한 겹 더 막는 이유는 뜻이 있다 — **마을이 맞는 것은 마을의 사건이고 마을은
 * 하나다.** 무는 자가 몇이든 화면이 내는 소리는 한 목소리여야 한다.
 * 150ms = 초당 6~7회. 한 입 주기(1초)보다 짧아 단독 타격은 한 번도 안 삼킨다.
 */
const BASE_HIT_SFX_MS = 150;
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
/**
 * 한 배치에서 그릴 **살점 값(부분 지급)** 팝업 수 상한.
 *
 * sim 쪽이 이미 한 겹 걸러 준다 — 몫은 개체당 최대 23회이고, 제 무리와 함께 나오는
 * 잡몹은 덩치 상한(`round(maxHp/refHp)`)이 1이라 한 번도 안 낸다(실측 초당 약 1건).
 * (compy만 골드 상한으로도 K=1이 확정이고, raptor·blade·archer는 2·4·5다 —
 *  balance.bountyChunksFor). 그런데도 상한을 두는 이유: 투석기 한 방이 여러 큰 적의
 * 몫 경계를 **동시에** 넘길 수 있고, 4배속에서는 그런 틱이 한 배치에 몰려 들어온다.
 * 초과분은 **골드는 그대로 들어오고 팝업만 버린다** — HUD 잔액은 goldChanged를 보고
 * 매 프레임 다시 읽으므로 숫자가 어긋나지 않는다.
 */
const BOUNTY_CHUNK_FX_MAX = 4;
/**
 * 한 배치에서 그릴 **채집 연출** 수 상한 (gather-spec §7-2).
 *
 * 4로 두는 근거는 위 둘과 같다: 정원이 6이라 한 틱에 6건 이상이 나올 수 없지만
 * 4배속에서는 여러 틱이 한 배치에 몰려 들어온다. 특히 `gatherStarted`는
 * 전선 옆 칸(스테이지1 40칸 중 22칸)에서 맞았다 다시 캐기를 반복하는 구간이 있어
 * 배치가 뭉치면 먼지가 겹친다.
 * ⚠ **배달(gatherDelivered)은 이 상한을 안 탄다** — 판당 20~40건뿐이고 그게 이 기능의
 *   보상 순간이라, 솎이면 "돈이 언제 들어왔는지"가 화면에서 사라진다.
 */
const GATHER_FX_MAX = 4;

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
  // 2-c — 새 합성 레시피를 만들지 않고 결이 맞는 기존 소리를 빌린다
  // (ballista 가 spearThrow 를 빌리는 것과 같은 규약이다)
  hushtotem: 'drumBuff', // 가죽 씌운 기둥 — 소리를 죽이는 물건이라 둔탁한 북
  rattletrap: 'spearThrow', // 이빨이 튕기는 짧고 마른 소리
  shockstake: 'lightningZap', // 방전
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
  hushtotem: 0x6fe3d0, // 정화 배지와 같은 청록 — 같은 축이라 화면에서 짝지어 읽힌다
  rattletrap: 0xc9a35a, // 나무 이빨
  shockstake: 0xbfe9ff, // 방전 (번개 0x8be0ff 보다 희어 구분된다)
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
  },
  drum: BASE_STYLE,
  // 지원형이라 착탄 연출이 없다 (drum 과 같다)
  hushtotem: BASE_STYLE,
  // 작은 타격이 아주 잦다 — 기본보다 조금 더 작고 조용하게
  rattletrap: { ...BASE_STYLE, core: 0xe8d9b4, sizeMul: 0.7, flashMul: 0.7 },
  // 방전 — 밝은 섬광에 파편은 거의 없다
  shockstake: { ...BASE_STYLE, core: 0xdff4ff, flashMul: 1.4, sizeMul: 0.85, shockRadius: 0.7 },
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
  /** 화면 흔들림 2채널 (./shakebus) — 생성자에서 카메라에 연결한다 */
  private shakes!: ShakeBus;
  /** 오라 불티 스팸 방지 — 배치당 상한 */
  private auraFlecks = 0;
  /** 타워 피격 파편/숫자 스팸 방지 — 무리가 동시에 두들기면 금방 찬다 */
  private towerHits = 0;
  private allyShots = 0;
  private raidShots = 0;
  /** 살점 값 부분 지급 팝업 — 배치당 상한 (BOUNTY_CHUNK_FX_MAX) */
  private bountyChunks = 0;
  /** 채집 연출 — 배치당 상한 (GATHER_FX_MAX). 배달은 여기 안 센다 */
  private gathers = 0;
  /**
   * 재생 **불티** — 배치당 상한 (GATHER_FX_MAX).
   * **한 틱에 여러 칸이 동시에 자란다**(같은 틱에 캔 칸들은 같은 틱에 돌아온다 — E-R12).
   * 40칸이 한꺼번에 자라는 틱이 실제로 있고, 불티를 칸마다 뿌리면 그 프레임만 파티클
   * 풀이 마른다. 상한을 넘으면 **불티만 버리고 소품은 그대로 자란다** — 이 둘을 같은
   * 카운터에 두지 않는 것이 요점이다(gathered 케이스의 각주와 같은 논거).
   *
   * ⚠ **소리는 안 붙인다.** 이 파일의 규약대로다(gatherStarted:「잦은 사건에 소리를 붙이면
   *   배경음이 된다」). 그리고 뜻이 반대다 — 배달은 보상이라 소리를 받지만, 재생은
   *   플레이어의 건설 칸을 **도로 닫는** 사건이다. 보상음을 주면 화면이 거짓말을 한다.
   */
  private regrows = 0;
  /**
   * 살아 있는 적의 종 — 데미지 숫자 표기 규약이 armor를 알아야 해서 스폰 때 기억한다.
   * **연출 전용 표다.** 시뮬레이션은 이 표를 모르고, 여기 값이 틀려도 판정은 안 바뀐다.
   * 스폰에서 넣고 사망/누수에서 지우므로 크기는 항상 '지금 살아 있는 마릿수'다.
   */
  private readonly foeDef = new Map<number, EnemyId>();
  /**
   * 한 배치의 **문간 선을 넘은 연출** 수 (GATE_ARRIVE_FX_MAX 상한).
   * 도착(enemyAtGate)과 돌파(enemyLeaked)가 **예산을 나눠 쓴다** — 둘 다 "저 선을
   * 넘었다"는 같은 종류의 먼지이고, 홍수 웨이브에서는 같은 초에 둘이 겹친다.
   * 예산을 따로 주면 그 초에 먼지가 두 배로 나서 풀이 그만큼 빨리 마른다.
   */
  private gateArrivals = 0;
  /** 한 배치의 한 입 수 — 지붕 파편을 **한 번에 모아** 튀긴다 */
  private gateBites = 0;
  /**
   * 한 배치에 마을이 잃은 총 HP (한 입 + 뚫고 들어간 잔액).
   *
   * ⚠ **모아서 한 번에 그리는 것이 이 설계의 요구다.** 한 입이 마을 HP 정확히 1이라
   *   (gate.ts 규칙 5) 개체마다 그리면 화면에 "−1"이 초당 열몇 개 뜬다 — 숫자가
   *   많을수록 읽히는 것이 아니라 **하나도 안 읽힌다**. 한 배치를 합쳐 "−7" 하나로
   *   띄우면 그 초에 마을이 실제로 잃은 값이 그대로 읽히고, 뚫고 들어간 티라노의
   *   잔액 한 방(−12)도 같은 자리에 같은 모양으로 나온다.
   */
  private baseHitAmount = 0;
  /** 한 배치의 마을 피격 사건 수 (0 이면 플러시를 통째로 건너뛴다) */
  private baseHits = 0;
  /** 마지막 마을 피격음 시각 (ms) — BASE_HIT_SFX_MS 참조 */
  private baseHitSfxAt = -1e9;

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
    this.shakes = new ShakeBus((a) => camera.shake(a));
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

  /** 큰 사건 — 보스·타워 파괴·마을 돌파. 잦은 사건은 `tap()` 이다 (./shakebus) */
  private quake(amount: number): void {
    this.shakes.quake(amount);
  }

  /** 잦은 사건 — 착탄·지형 정리. **피해량을 안 받는 것이 요점이다** (./shakebus) */
  private tap(weight = 1): void {
    this.shakes.tap(weight);
  }

  handle(events: readonly SimEvent[]): void {
    const s3 = this.stage3d;
    this.shakes.beginBatch();
    this.auraFlecks = 0;
    this.towerHits = 0;
    this.allyShots = 0;
    this.raidShots = 0;
    this.bountyChunks = 0;
    this.gathers = 0;
    this.regrows = 0;
    this.gateArrivals = 0;
    this.gateBites = 0;
    this.baseHitAmount = 0;
    this.baseHits = 0;
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
        case 'enemyAtGate': {
          /*
           * **문 앞에 섰다** (src/sim/gate.ts). 종전에는 이 순간이 곧 적이 사라지는
           * 순간이라 연출이 아예 없었다 — 이제는 판에서 가장 긴 대치의 시작이다.
           *
           * ⚠ gate-wip 과 결정적으로 다른 점: 여기 오는 것이 **보스뿐이 아니다**.
           *   전 16종이 온다(규칙 1·9). 그래서 연출을 두 층으로 갈랐다.
           *    · 전 종 — 발을 디디는 흙먼지 한 줌. 반경에 비례해 크기가 갈리므로
           *      "큰 놈이 섰다"가 먼지만으로도 읽힌다. 배치당 GATE_ARRIVE_FX_MAX 로 막는다.
           *    · 보스만 — 포효 · 음악 격상 · 흔들림. 홍수 웨이브에서 이걸 종마다 주면
           *      포효가 배경음이 되고(이 파일의 규약: 잦은 사건에 소리를 붙이면 배경이 된다)
           *      화면이 쉬지 않고 흔들려 멀미가 난다.
           *
           * 체류 상한은 HUD 로 넘긴다 — 배너(showBossBanner)와 **같은 경로**다.
           * HUD 는 폴링이 원칙이지만 이 한 값만은 폴링으로 못 구한다(스테이지가
           * `holdMinTicks` 를 덮어쓸 수 있는데 UI 는 어느 스테이지인지 모른다).
           * 놓쳐도 돌파 게이지 한 칸이 접힐 뿐, 나머지는 전부 폴링이 정한다.
           */
          // ⚠ 문간 체류 상한 통지는 없앴다 — 그 값을 그리던 돌파 게이지가 사라졌다
          const def = ENEMY_DEFS[ev.defId];
          if (this.gateArrivals < GATE_ARRIVE_FX_MAX && s3.particles.load < 0.8) {
            this.gateArrivals++;
            const w = s3.cellToWorld(ev.x, ev.z, this.v);
            s3.particles.burst(
              w.x,
              0.3,
              w.z,
              0xc8b28a,
              Math.round(6 + 14 * def.radius),
              1.6 + 1.2 * def.radius,
              0.05 + 0.03 * def.radius,
              0.6,
              {
                gravity: 5,
                drag: 1.6,
                // 낮게 옆으로 퍼진다 — 착지가 아니라 '버티고 선' 그림이다
                upBias: 0.15,
                sizeVar: 0.55,
              },
            );
          }
          if (def.boss) {
            audio.play('bossRoar');
            audio.music.setIntensity(3);
            this.quake(0.28);
            this.buzz(45);
          }
          break;
        }
        case 'gateBite':
          /*
           * 한 입 — 지붕이 뜯긴다. **여기서는 세지만 하고 그리지 않는다**(아래 플러시).
           * 개체마다 그리면 문 앞에 열몇 마리가 선 순간 파편과 숫자가 화면을 덮는데,
           * 그것들이 말하는 사실은 전부 같다: "마을이 지금 깎이고 있다".
           * 사실이 하나면 그림도 하나여야 한다.
           *
           * 좌표를 안 쓰는 이유: 파편이 튀는 자리는 **무는 자**가 아니라 **맞는 것**이고,
           * 맞는 것은 언제나 마을 지붕 하나다. 마을 좌표는 렌더가 이미 안다
           * (baseUpgraded 가 같은 값을 쓴다 — 그래서 이벤트에 실을 필요가 없었다).
           */
          this.gateBites++;
          break;
        case 'bossSpawned':
          showBossBanner();
          audio.play('bossRoar');
          audio.music.setIntensity(3);
          this.quake(0.4);
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
              ev.shielded ? '⛨' : damageText(ev.amount, armor, ev.mitigated),
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
            this.quake(clamp(0.12 * s, 0.12, 0.42));
            /*
             * **문 앞에서 잡았다** — 햅틱을 한 겹 길게 준다.
             * `enemyDied.gateTicks` 는 문간에서 죽은 개체에만 실린다(types.ts:
             * 개체가 같은 틱에 풀로 회수되므로 이게 문간 체류의 유일한 확정 기록이다).
             * 곧 이 분기는 "마을 문 앞에서 버텨 이겼다"와 정확히 같은 뜻이고,
             * 문간이 만드는 가장 큰 사건이다 — 보스는 문 앞에서 죽거나 뚫고 들어가거나
             * 둘 중 하나로 끝난다. 그 갈림에서 이긴 쪽을 평범한 처치와 같은 한 번의
             * 진동으로 끝내면 판에서 가장 큰 사건이 가장 작은 신호로 지나간다.
             *
             * ⚠ 소리는 **일부러 안 판다.** 전용 자산이 없고(sfx.ts 에 함성이 없다),
             *   여기 있는 것으로 흉내 내면 다른 사건과 같은 소리가 되어 뜻이 안 갈린다.
             *   그리고 문 앞에서 죽는 것은 이제 **보스만이 아니다** — 종을 안 가리는
             *   설계라 잡졸까지 소리를 주면 홍수 웨이브에서 함성이 배경음이 된다.
             *   그래서 이 분기는 `def.boss` 안에만 있다.
             */
            this.buzz(ev.gateTicks !== undefined ? [40, 60, 90] : 40);
          }
          /*
           * ⚠ **잡졸 처치는 이제 안 흔든다** (종전: s > 1.6 이면 0.03·s).
           * 처치는 판에서 가장 잦은 사건이고 — 홍수 웨이브는 초당 수십 건이다 —
           * 큰 놈일수록 s 가 커져 후반에는 처치할 때마다 화면이 흔들렸다.
           * 사망 폭발(위 explosion)과 enemyDie 소리가 이미 같은 사실을 말하므로
           * 셰이크를 빼도 사라지는 정보가 없다. 보스는 위 분기가 그대로 흔든다.
           */
          const p = this.worldToScreen(ev.x, 1.3, ev.z);
          // **bounty가 아니라 goldNow다.** 살점 값이라 큰 적은 죽기 전에 일부를 이미 냈다
          // (K=24 trex는 여기 **174**, 나머지 **306**이 bountyChunk로 먼저 떴다 —
          //  생전 지급에 2/3 할인이 걸려 있다. balance.BOUNTY_CHUNK_LIVE_NUM/DEN).
          // `+bounty`를 그리면 화면에 뜬 숫자의 합이 실제 잔액보다 커진다 = 거짓말이다.
          // ⚠ 이 주석은 폐기된 1/1 설계의 "20 / 460"을 적고 있었다(실제와 8.7배 차이).
          if (p && ev.goldNow > 0) {
            spawnDamageNumber(p.sx, p.sy, `+${ev.goldNow}`, 'gold', clamp(s * 0.75, 0.9, 1.6));
          }
          audio.play('enemyDie');
          break;
        }
        case 'bountyChunk': {
          // 살점 값 — 큰 짐승 옆에서 작은 금색 숫자가 규칙적으로 튀는 그림이 곧
          // "살점을 떼고 있다"의 시각적 뜻이다. 사망 숫자(0.9~1.6)보다 **항상 작게**
          // 그려 "부분 지급"과 "처치"가 크기로 구분된다. 마지막 몫만 살짝 키워 결말을 예고한다.
          //
          // 파티클·화면 흔들림·진동·효과음은 **일부러 안 붙인다** — 그 넷은 처치의 몫이다.
          // 초당 1건이라도 코인 소리가 붙으면 그 순간 배경음이 된다.
          if (this.bountyChunks >= BOUNTY_CHUNK_FX_MAX) break;
          this.bountyChunks++;
          const p = this.worldToScreen(ev.x, 1.15, ev.z);
          if (p) {
            const last = ev.chunk >= ev.chunks - 1;
            spawnDamageNumber(p.sx, p.sy, `+${ev.gold}`, 'gold', last ? 0.8 : 0.55);
          }
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
            this.quake(0.14);
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
          this.quake(clamp(0.1 * s, 0.12, 0.3));
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
          // 지형 정리는 플레이어가 돈 내고 누른 사건이라 손맛을 남기되, 고정 세기다
          this.tap(2);
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
            /*
             * **착탄은 고정값 한 톡이다** — 이 한 줄이 "공격할 때마다 지진"의 진원이었다.
             * 종전 `clamp(0.055·s^1.45·shakeMul, 0.03, 0.3)` 은 피해량과 타워 종류를
             * 둘 다 곱해서, 투석기(shakeMul 1.35) 한 대가 후반 피해로 때리면 한 발에
             * 0.3(=예산의 60%)까지 갔다. 착탄은 매 프레임 들어오므로 그 값이 곧
             * 정상 상태가 되고, 화면은 쉬지 않고 흔들렸다.
             * 이제 세기는 피해·티어·타워를 안 본다. 흔들림은 "저기서 뭔가 터졌다"만
             * 말하면 되고, 얼마나 아팠는지는 파티클 크기·데미지 숫자·소리가 말한다.
             *
             * ⚠ 단일 착탄(비스플래시)은 **아예 안 흔든다.** 창잡이·발리스타는 초당
             *   여러 발이라 아무리 작아도 합치면 상시 떨림이 된다.
             */
            this.tap();
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
          // 체인 경유점은 안 흔든다 — 한 발이 여러 점을 만들어 잔떨림이 겹친다
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
        case 'allyHealed': {
          /*
           * **마법사가 고쳤다 🔷** — 회복은 화면에 안 보이는 능력이라, 이 연출이 없으면
           * 플레이어는 마법사가 일을 하는지 알 수가 없다(카드 값을 못 배운다).
           *
           * 색은 **하늘빛**(0x8fd8ef)이다 — 체력바의 '내 편' 청록 · 회복 배지 · 3D 지팡이
           * 결정 · 카드 아이콘과 같은 축이라 낱말 없이 "우리 편 회복"으로 읽힌다.
           * ⚠ 민트 계열은 **적 주술사의 힐 오라** 색과 겹쳐서 일부러 피한다 — 같은
           *   "회복"인데 편이 갈리므로 색이 갈려야 한다.
           *
           * ⚠ **숫자는 `ev.amount`(실제로 되돌아간 양)이다.** 만피 근처거나 마을 상한에
           *   걸리면 요청보다 작다 — 화면에 뜨는 "+N" 이 실제와 어긋나면 화면이 거짓말을
           *   하는 것이다(enemyDied 의 goldNow 가 bounty 가 아닌 것과 같은 논거).
           *
           * ⚠ 소리는 **안 붙인다.** 회복은 쿨다운마다 계속 나가는 잦은 사건이라 소리를
           *   주면 배경음이 된다(이 파일의 규약 — gatherStarted 각주와 같다).
           *   그리고 셰이크도 안 준다: 잦은 사건은 판을 안 흔든다(shakebus.ts).
           */
          const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
          const big = ev.targetKind === 'base';
          /*
           * 세 겹으로 쌓는다 (사용자 요구: "힐링 할때 효과 이펙트를 좀더 화려하게").
           * 각 겹이 **다른 사실**을 말하게 나눴다 — 같은 그림을 세 번 그리면 화려한
           * 것이 아니라 지저분한 것이다:
           *  ① 바닥 고리 — **어디가** 고쳐지는가. 건물 발치에 깔려 대상을 특정한다.
           *  ② 솟는 불티 — **무엇이** 오르는가. 중력을 음수로 줘서 위로 떠오른다.
           *    낙하하는 파편(피격·파괴)과 방향이 반대라 "좋은 일"로 읽힌다.
           *  ③ 반짝임 한 겹 — 흰빛에 가까운 하늘빛을 작고 빠르게. 하이라이트다.
           *
           * ⚠ 파티클 풀은 512 이고 회복은 쿨다운마다 나가는 **잦은 사건**이다.
           *   그래서 마을(big)에만 후하게 주고 타워는 절반 이하로 둔다 — 마을 회복은
           *   판당 상한이 있어 드물지만, 타워 회복은 계속 난다.
           */
          s3.particles.ring(w.x, w.z, 0x8fd8ef, big ? 0.9 : 0.62, big ? 12 : 8);
          s3.particles.burst(w.x, big ? 1.25 : 0.85, w.z, 0x8fd8ef, big ? 16 : 9, 1.15, 0.055, 0.75, {
            gravity: -2.6, // 위로 떠오른다 — 낙하하는 파편과 반대 방향이라 뜻이 갈린다
            drag: 2.0,
            upBias: 1,
            sizeVar: 0.5,
          });
          s3.particles.burst(w.x, big ? 1.5 : 1.05, w.z, 0xe8fbff, big ? 7 : 4, 1.5, 0.03, 0.4, {
            gravity: -1.2,
            drag: 3.2,
            upBias: 1,
            sizeVar: 0.7,
          });
          const p = this.worldToScreen(ev.cellX, big ? 1.9 : 1.3, ev.cellZ);
          if (p) spawnDamageNumber(p.sx, p.sy, `+${Math.round(ev.amount)}`, 'heal', big ? 1.15 : 0.95);
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
        // --- 채집 (docs/gather-spec.md §7-2) ---------------------------------
        case 'gatherStarted': {
          // 발밑 먼지 — allyTrained(:773)가 쓰는 레시피를 작게 줄인 것.
          // **소리를 안 붙인다**: 캐기 시작은 판당 수십 번이고 맞을 때마다 다시 나므로
          // 소리가 붙는 순간 배경음이 된다(:518의 bountyChunk가 적어 둔 판단 그대로다).
          if (this.gathers >= GATHER_FX_MAX) break;
          this.gathers++;
          const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
          s3.particles.burst(w.x, 0.22, w.z, 0xc9b48c, 5, 0.85, 0.05, 0.42, {
            gravity: 8,
            drag: 1.6,
            upBias: 0.85,
            sizeVar: 0.5,
          });
          break;
        }
        case 'gathered': {
          /*
           * **짐을 졌다 = 그 칸이 텄다.** 두 사실이 같은 이벤트라(types.ts) 소품을
           * 없애는 자리도 여기다 — 사용자가 두 번 말한 요구가 이 한 줄이다.
           *
           * ⚠ **연출 상한(GATHER_FX_MAX) 위에 둔다.** 아래 불티는 배치가 뭉치면 솎여도
           *   되지만 소품 제거는 **sim 상태를 화면에 옮기는 일**이라 한 건도 빠지면 안 된다.
           *   빠지면 그 칸은 판이 끝날 때까지 "sim 에는 없는데 화면에는 서 있는" 나무가
           *   되고, 거기에 타워가 서면 나무를 뚫고 선다. 4배속에서 배치가 뭉치는 것은
           *   드문 일이 아니므로 이건 이론이 아니라 실제로 나는 버그다.
           * ⚠ 재병합이 아니다(setSceneryTaken 헤더) — 판당 100회를 넘는 사건이다.
           */
          s3.setSceneryTaken(ev.cellX, ev.cellZ, true);
          // 여기서 코인을 띄우지 않는다. 지급은 배달뿐이고(D3),
          // 여기서 그리면 지고 오다 죽었을 때 화면이 거짓말한 것이 된다.
          // 화면에서 실제로 늘어나는 것은 머리 위 짐 칩(healthbars kind 6)이고,
          // 이 불티는 그 칩이 **언제** 늘었는지를 알리는 짧은 강조다.
          if (this.gathers >= GATHER_FX_MAX) break;
          this.gathers++;
          const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
          s3.particles.burst(w.x, 0.8, w.z, 0xffd06a, 8, 1.0, 0.055, 0.55, {
            gravity: 6,
            drag: 1.4,
            upBias: 1.0,
            sizeVar: 0.5,
            glow: true,
          });
          break;
        }
        case 'gatherRegrown': {
          /*
           * **다 캔 칸이 돌아왔다**(R2) — 소품이 밑동에서 솟아 0.85초에 걸쳐 제 크기가 된다
           * (props.PROP_REGROW_SECONDS / 되튐). 사용자가 요구한 "다시 자라는 로직"이
           * 화면에서 읽히는 자리가 여기다.
           *
           * ⚠ 이 칸은 **다시 건설 불가가 된다** — setSceneryTaken 이 배치 하이라이트도
           *   같이 끈다. 그래서 이 연출은 축하가 아니라 **경고**에 가깝다: 여기 지으려면
           *   지금 지어야 한다는 것을 0.85초 동안 눈에 보이게 말해 준다(R3).
           * ⚠ 상한 위에 둔다 — gathered 와 같은 이유로 상태 반영은 한 건도 못 빠진다.
           */
          s3.setSceneryTaken(ev.cellX, ev.cellZ, false);
          if (this.regrows >= GATHER_FX_MAX) break;
          this.regrows++;
          // 밑동에서 위로 솟는 연둣빛 티끌 — 채집 먼지(0xc9b48c, 아래로 가라앉음)와
          // **방향과 색이 둘 다 반대**라 같은 칸에서 두 사건이 헷갈리지 않는다.
          const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
          s3.particles.burst(w.x, 0.12, w.z, 0x8fd45a, 7, 1.1, 0.05, 0.7, {
            gravity: -1.6,
            drag: 1.9,
            upBias: 1.0,
            sizeVar: 0.55,
          });
          break;
        }
        case 'gatherDelivered': {
          // **채집이 코인을 내는 유일한 자리**(D3). 그래서 이 게임에서 다른 어떤 채집
          // 연출보다 크고, 유일하게 소리를 받는다 — 판당 20~40건이라 배경음이 되지 않는다.
          // 크기 0.95는 살점 값(0.55/0.8)보다 크고 처치 지급(0.9~1.6)의 아래쪽이다:
          // "부분 지급보다 큰 사건이지만 사냥 한 마리를 넘지는 않는다".
          // ⚠ GATHER_BASE_VALUE가 0인 동안에는 `+0`이 뜬다. 그게 지금의 사실이다 —
          //   T6이 값을 켜면 같은 자리에 그대로 실제 액수가 뜬다.
          const p = this.worldToScreen(ev.x, 1.15, ev.z);
          if (p) spawnDamageNumber(p.sx, p.sy, `+${ev.gold}`, 'gold', 0.95);
          const w = s3.cellToWorld(ev.x, ev.z, this.v);
          s3.particles.ring(w.x, w.z, 0xffd06a, 0.6, 10);
          audio.play('amberGain');
          break;
        }
        case 'gatherLost': {
          // 사유별로 **다르게 그린다** — 넷이 뜻하는 바가 전부 다르기 때문이다.
          if (ev.reason === 'hit') {
            // 맞아서 손이 멈췄다 = 발밑 게이지가 0으로 돌아간다(게이지 자체는 sim 상태를
            // 따라 저절로 깨진다). 여기서는 그 순간을 붉은 티끌로 짧게 찍기만 한다 —
            // 잦은 사건이라 팝업도 소리도 없다. 이 표시가 없으면 "왜 안 캐지지"의 답이
            // 화면 어디에도 없다(§4-4가 위험으로 적어 둔 자리다).
            if (this.gathers >= GATHER_FX_MAX) break;
            this.gathers++;
            const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
            s3.particles.burst(w.x, 0.3, w.z, 0xff6b52, 5, 1.0, 0.05, 0.35, {
              gravity: 7,
              drag: 1.5,
              upBias: 0.9,
              sizeVar: 0.5,
            });
            break;
          }
          if (ev.reason === 'died') {
            // 짐을 진 채 죽었다 — 짐이 땅에 흩어진다. allyDied(사람)와 같은 자리에서
            // 겹치므로 **다른 것을 말한다는 것**이 색과 높이로 갈려야 한다: 금색 파편,
            // 그리고 팝업은 0.4 위로 올려 사람의 연출과 포개지지 않게 한다.
            const w = s3.cellToWorld(ev.cellX, ev.cellZ, this.v);
            s3.particles.burst(w.x, 0.55, w.z, 0xd8a33f, 9, 1.4, 0.06, 0.75, {
              gravity: 11,
              drag: 1.2,
              upBias: 0.7,
              sizeVar: 0.6,
            });
            // 잃은 액수가 0이면 띄우지 않는다 — `−0`은 정보가 아니라 소음이다.
            // (배달의 `+0`은 다르다: 그건 **흐름이 여기까지 왔다**는 신호라 값이 0이어도 뜬다)
            if (ev.gold > 0) {
              const p = this.worldToScreen(ev.cellX, 1.55, ev.cellZ);
              // ⚠ 명세는 회색을 적었지만 회색 DamageKind가 없고, 새로 만들려면
              //   damagenumbers.ts의 유니온과 CSS를 함께 늘려야 한다(이 트랙 소유가 아니다).
              //   그래서 **색은 돈을 말하고 부호가 잃었음을 말한다** — 같은 금색에 `−`다.
              if (p) spawnDamageNumber(p.sx, p.sy, `-${ev.gold}`, 'gold', 0.8);
            }
            break;
          }
          // 'moved' / 'cleared' — 칸이 다시 살아 돌아왔다는 신호는 **배지 색**이 낸다
          // (healthbars kind 7이 매 프레임 sim 상태를 다시 읽는다). 별도 연출을 붙이면
          // 명령을 바꿀 때마다 화면이 번쩍여 "무언가 잘못됐다"로 읽힌다.
          break;
        }
        /*
         * ── 'allyRetired' 연출은 삭제됐다 (9단계) ──────────────────────────
         * 수명이 없어져 "돌아가는" 사건 자체가 없다. 부족원이 사라지는 길은 이제
         * allyDied 하나뿐이고, 그쪽은 이미 자기 연출을 갖고 있다.
         */
        case 'statusApplied': {
          const e = this.stage3d.enemies; // 히트 플래시로 대체 표시
          e.setHitFlash(ev.enemyId);
          void STATUS_COLOR[ev.kind];
          break;
        }
        /*
         * 정화가 상태이상을 벗겼다 — **회복(healAura)과 달리 반드시 보여야 한다.**
         * 안 보이면 "얼렸는데 왜 안 느려지지?"가 되고, 주술사를 먼저 잡아야 한다는
         * 답이 영영 학습되지 않는다. 이 축의 존재 이유가 가독성이다(types.ts statusPurged).
         * 연출은 statusApplied 와 **같은 플래시**를 쓰되 그쪽이 "걸렸다"를 말하는 자리라
         * 여기서는 벗겨진 상태의 색을 참조해 둔다 — 전용 파티클은 다음 단계 몫이다.
         */
        case 'statusPurged': {
          this.stage3d.enemies.setHitFlash(ev.enemyId);
          void STATUS_COLOR[ev.kind];
          break;
        }
        case 'enemyLeaked': {
          // 마을 안으로 들어가 사라진 적 — 사망(enemyDied)을 거치지 않으므로 여기서 지운다.
          // 안 지우면 표가 판 전체의 누적 스폰 수만큼 자란다.
          this.foeDef.delete(ev.enemyId);
          /*
           * **울타리를 넘어 들어간다.**
           * 문간이 들어온 뒤로 이 사건의 성격이 바뀌었다: 종전에는 언제나 마을 HP 가
           * 같이 깎여서(baseDamaged) 흔들림과 소리가 퇴장을 대신 말해 줬는데, 이제는
           * 문 앞에서 빚을 다 갚고 나가는 개체가 **대다수**다(baseDamage 1인 11종은
           * 3초 체류 중 첫 틱에 전액을 문다 — gate.ts 규칙 6·7). 그 개체들은
           * `baseDamage === 0` 으로 나가므로 `baseDamaged` 가 따라오지 않고,
           * 그대로 두면 3초를 버티고 선 적이 **소리도 그림도 없이 증발한다.**
           * 그래서 퇴장 자체에 먼지 한 줌을 붙인다. 자리는 마을 — 들어가는 곳이 거기다.
           */
          if (this.gateArrivals < GATE_ARRIVE_FX_MAX && s3.particles.load < 0.85) {
            this.gateArrivals++;
            const def = ENEMY_DEFS[ev.defId];
            const w = s3.basecamp.group.position;
            s3.particles.burst(
              w.x,
              0.5,
              w.z,
              0xb59a72,
              Math.round(5 + 10 * def.radius),
              1.5 + 1.5 * def.radius,
              0.05 + 0.03 * def.radius,
              0.5,
              { gravity: 4, drag: 1.7, upBias: 0.5, sizeVar: 0.6 },
            );
          }
          break;
        }
        case 'baseDamaged': {
          /*
           * 흔들림·소리·숫자는 **여기서 안 낸다** — 배치 끝의 flushBaseHits() 가 모아서
           * 한 번에 낸다. 종전에는 이 사건이 "적이 도달할 때 한 번"이라 그 자리에서
           * 내도 됐지만, 문간에서는 문 앞의 적 하나하나가 1초에 한 번씩 물어
           * **같은 사건이 초당 열몇 번**이 된다(gate.ts 규칙 5).
           *
           * 마을 피해 단계(지붕이 무너진 정도)만 그 자리에서 갱신한다 — 이건 상태이지
           * 사건이 아니고, 같은 값을 몇 번 써도 결과가 같다(멱등).
           */
          this.baseHits++;
          this.baseHitAmount += Math.max(0, ev.amount);
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
    this.flushBaseHits();
  }

  /**
   * **마을 피격 한 배치를 한 번에 그린다** — 문간 설계가 강제한 유일한 구조 변경이다.
   *
   * 왜 배치 단위인가: 문 앞에 선 적은 저마다 1초에 한 번 마을 HP 를 1 깎는다
   * (gate.ts 규칙 5). 홍수 웨이브에서는 문 앞이 열몇 마리라 `baseDamaged` 가
   * **초당 열몇 번**이고, 그때마다 흔들고 소리 내고 "−1"을 띄우면
   *  · 화면이 쉬지 않고 떨려 모바일에서 멀미가 나고(SHAKE_BUDGET 은 프레임 총량을
   *    막아 주지만 그건 상한이지 리듬이 아니다),
   *  · 같은 숫자가 겹쳐 떠서 **정작 그 초에 얼마를 잃었는지 못 읽는다.**
   * 한 배치를 합치면 화면이 말하는 것이 정확히 "이번에 마을이 −N" 하나가 된다.
   *
   * 세기는 **잃은 비율**로 낸다. 한 입(−1/25)은 툭 치는 정도이고, 12초를 버틴
   * 티라노가 잔액을 밀어 넣고 들어가는 순간(−12/25)은 종전의 한 방과 같은 세기다 —
   * 곧 오늘의 감각이 큰 사건에서 그대로 보존되고, 잡졸의 잔상만 줄어든다.
   */
  private flushBaseHits(): void {
    const s3 = this.stage3d;
    /*
     * 지붕 파편 — 한 입이 몇이든 **한 번**. towerDamaged 의 피격 연출을 글자 그대로
     * 재사용한다(같은 인스턴서·같은 낙하 계수): 새 메시도 새 색도 안 판다.
     * 드로우콜이 0 늘고, 무엇보다 같은 사건에 같은 그림이라야 플레이어가 두 번 배우지
     * 않는다 — 저것은 내 구조물이 갉히는 소리다.
     * 높이 1.7 은 지붕 용마루다. 1.05 로 잡았다가 올렸다: 문 앞의 큰 놈은 화면에서
     * 마을보다 커서 낮은 파편이 **몸통 뒤에 통째로 가려진다.**
     */
    if (this.gateBites > 0 && s3.particles.load < 0.85) {
      const w = s3.basecamp.group.position;
      const n = Math.min(16, 6 + this.gateBites * 2);
      s3.particles.burst(w.x, 1.7, w.z, 0xc8a06a, n, 2.4, 0.062, 0.55, {
        gravity: 9,
        drag: 1.4,
        upBias: 0.55,
        sizeVar: 0.6,
      });
    }
    if (this.baseHits === 0 || this.baseHitAmount <= 0) return;
    const frac = this.baseHitAmount / Math.max(1, this.baseHpMax);
    /*
     * 0.10 ~ 0.35. 상한 0.35 는 **종전의 한 방과 같은 값**이다 — 큰 사건의 감각을
     * 낮추지 않고, 작은 사건만 아래로 뺀다.
     *
     * ⚠ 여기에 문턱이 하나 더 붙었다(BASE_QUAKE_FRAC). 위 배치 합산은 "한 초에
     *   얼마를 잃었나"를 하나로 만들어 주지만, **포위전에서는 그 하나가 매 프레임
     *   나온다** — 문 앞에 여섯 마리가 서면 한 입(-1/25 = 0.04)이 끊임없이 들어오고,
     *   0.1 짜리 셰이크가 상시 떨림이 된다. 그건 큰 사건이 아니라 잦은 사건이다.
     *   그래서 한 프레임 손실이 마을 HP 의 15% 를 넘을 때만 판을 흔들고
     *   (= 티라노가 잔액을 밀어 넣고 들어가는 순간), 그 밑은 고정 톡으로 낸다.
     *   소리와 "−N" 숫자는 문턱과 무관하게 그대로 나가므로 정보는 안 잃는다.
     */
    if (frac >= BASE_QUAKE_FRAC) this.quake(clamp(0.1 + 0.9 * frac, 0.1, 0.35));
    else this.tap(1.5);
    // 소리는 한 목소리다 — 마을은 하나다(BASE_HIT_SFX_MS 주석)
    const now = performance.now();
    if (now - this.baseHitSfxAt >= BASE_HIT_SFX_MS) {
      this.baseHitSfxAt = now;
      audio.play('baseHit');
      this.buzz(frac > 0.15 ? 50 : 25);
    }
    /*
     * 마을이 잃은 HP — 판에서 가장 비싼 숫자다. 타워 피격과 같은 'tower' 색을 쓴다:
     * 적이 받는 흰 숫자와 **다른 종류**로 읽혀야 한다(towerDamaged 의 같은 자리 주석).
     * 배율 1.15 로 살짝 크게 띄운다.
     */
    // ⚠ worldToScreen 은 **셀 좌표**를 받는다(안에서 cellToWorld 를 부른다).
    //   위 파티클이 쓰는 basecamp.group.position 은 월드 좌표라 여기 넣으면 안 된다.
    const gp = this.worldToScreen(this.baseCell.x, 2.1, this.baseCell.z);
    if (gp) spawnDamageNumber(gp.sx, gp.sy, `-${Math.round(this.baseHitAmount)}`, 'tower', 1.15);
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
  /**
   * 마을 셀 좌표 (컨트롤러가 주입) — `baseHpMax` 와 같은 규약이다.
   * 마을이 잃은 HP 숫자를 마을 머리 위에 띄우는 데 쓴다. 사건에 안 싣는 이유는
   * `baseUpgraded` 가 좌표를 안 싣는 것과 같다 — **마을은 판에 하나뿐**이고
   * 게임 쪽이 이미 안다. 곧 sim 이벤트가 이 연출 때문에 넓어지지 않는다.
   */
  baseCell: { x: number; z: number } = { x: 0, z: 0 };

  private findTowerCell(towerId: number): { x: number; z: number } | null {
    // 타워 셀은 뷰가 알고 있음 — positionOf는 월드 좌표라 셀 역변환 대신 상태에서 찾기
    return this.towerCellLookup?.(towerId) ?? null;
  }

  /** 컨트롤러가 sim 상태 조회 함수 주입 */
  towerCellLookup: ((towerId: number) => { x: number; z: number } | null) | null = null;
}
