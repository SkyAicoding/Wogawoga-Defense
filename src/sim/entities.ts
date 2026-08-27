/**
 * 엔티티 저장소 — DenseList + Pool 기반 풀 관리, id 발급.
 * EnemySim은 EnemyState에 def 참조/스턴 면역 등 내부 필드를 더한 확장이며
 * BattleStateView에는 EnemyState로 그대로 노출된다 (매 틱 새 객체 생성 금지).
 */
import { DenseList, Pool } from '@/core/pool';
import type { Rng } from '@/core/rng';
import type {
  AllyDef,
  AllyState,
  BattleOptions,
  BattleStateView,
  EnemyDef,
  EnemyState,
  ProjectileState,
  SimEvent,
  TowerState,
} from '@/data/types';
import type { BattlePath } from './path';
import type { HometownSim } from './hometown';
import type { ResourceField } from './gather';

export interface EnemySim extends EnemyState {
  def: EnemyDef;
  /** 보스 스턴 종료 후 면역이 끝나는 틱 */
  stunImmuneUntil: number;
  /**
   * 난투(아군 반격) 쿨다운 잔여 틱. **towerAttack의 attackCdLeft와 일부러 분리한다** —
   * 하나로 합치면 "타워를 때리다 아군에게 붙잡히면 반격이 한 박자 빨라지거나 늦어지는"
   * 숨은 결합이 생기고, 두 행동은 서로 배타(봉쇄되면 타워를 안 때린다)라 공유할 이유도 없다.
   */
  brawlCdLeft: number;
  /**
   * 규칙 4-b의 **전진 의무** 잔여 틱. 0보다 크면 어떤 타워 앞에서도 멈추지 못한다.
   * 한 번 멈춘 뒤 SIEGE_ADVANCE_TICKS로 채워지고, **실제로 전진한 틱에만** 준다
   * (봉쇄·스턴으로 못 걷는 틱에는 줄지 않는다 — 의무는 시간이 아니라 전진이다).
   *
   * **공개 상태가 아니다.** siegeHoldLeft가 "지금 서 있는가"를 이미 말해 주므로
   * 렌더가 볼 이유가 없고, 노출하면 "왜 사거리 안인데 안 멈추지"를 연출이 흉내 내려
   * 들 수 있다. 그 판단은 시뮬레이션 혼자 한다.
   */
  siegeWalkLeft: number;
  /**
   * 공성 피해 배율 — **무한 모드 초과분(1.06^n)만** 반영한다. 6개 스테이지의
   * 정규 웨이브(wave <= waveCount)에서는 항상 정확히 1이라 밸런스가 바뀌지 않는다.
   *
   * 왜 필요한가: towerAttack.dmg는 상수인데 적 HP는 무한 모드에서 1.06^n으로 커진다.
   * w100이면 archer 실HP가 24,740인데 타워에 넣는 피해는 여전히 11이라
   * 만렙 T5(1,316)를 혼자 부수는 데 159.5초가 걸린다 — 즉 무한 모드에서는
   * "타워를 부수는 적"이라는 기능이 사실상 사라진다(실측: 도달 웨이브 차이 0.3%).
   * 웨이브 곡선 hpMul까지 곱하면 정규 스테이지가 통째로 흔들리므로
   * (stage6은 hpBase만 2.2다) **초과분에만** 건다.
   */
  siegeMul: number;
  /**
   * 살점 값의 **몫 수 K** — 이 개체가 이번 웨이브의 표준 사냥감 몇 마리분인가.
   * 스폰 시 `balance.bountyChunksFor`로 굳는다. **1이면 오늘과 완전히 같다**(사망 시 한 번).
   *
   * 공개 `EnemyState`에 안 올린다: 렌더가 알아야 할 것은 "방금 얼마 들어왔나"뿐이고
   * 그건 `bountyChunk` 이벤트가 말한다. 여기 두면 UI가 몫 게이지를 그리려 들고,
   * 그 순간 연출이 지급 판정을 흉내 내기 시작한다 (`siegeWalkLeft`와 같은 논거).
   */
  bountyChunks: number;
  /**
   * 이 개체에게 **이미 지급한** 골드 누계(정수). 사망 지급은 `bounty − 이 값`이다.
   *
   * ⚠ **이 한 필드가 정확성의 뿌리다.** 지급은 언제나
   * `floor(bounty × k / K) − bountyPaid`이고 **양수일 때만** 나가므로 이 값은 절대 안 줄고,
   * 곧 "그 개체가 **도달한 최저 HP**"를 골드 단위로 기록한 것과 같다:
   *  · 주술사(`status.processHealAuras`)가 hp를 되돌리면 k가 내려가 지급이 음수 → 0.
   *    같은 구간을 다시 깎아도 0. **더 아래로** 내려가야 비로소 다음 몫이 나온다.
   *    곧 "회복시킨 적을 반복해 때려 골드 무한 파밍"이 **자료구조로** 불가능하다.
   *  · 오버킬로 hp가 −99,999가 되어도 총 지급은 bounty를 못 넘는다(k ≤ K).
   * 되돌림 방어를 규칙으로 따로 적지 않은 이유가 이것이다 — 규칙은 잊히지만 표현은
   * 안 잊힌다. 별도의 `lowHp` 필드를 두지 **않은** 이유이기도 하다: 두 필드가 동시에
   * 정확해야 안전한 설계는 리셋 누락 하나가 곧 골드 누수다.
   *
   * **정수다.** 분수 골드를 float로 누적하면 `hash()`의 `v.gold`가 흔들린다 —
   * 스폰의 `bounty` 자체를 정수로 굳혀 둔 것(`waves.spawn`)과 같은 이유다.
   */
  bountyPaid: number;
  /**
   * **재충전형 방패**(`EnemyDef.shieldRecharge`)의 남은 틱수. 0이면 안 돌고 있다.
   *
   * 공개 `EnemyState`에 안 올린다: 렌더가 `shieldHitsLeft`조차 안 읽는다(src/render 0건).
   * `siegeWalkLeft`·`bountyChunks`가 세운 "판정 전용 상태는 공개 안 한다" 규약과 같은
   * 자리다 — 여기 두면 UI가 재충전 게이지를 그리려 들고, 그 순간 연출이 판정을 흉내 낸다.
   */
  shieldRechargeLeft: number;
}

/**
 * 투사체 내부 확장 — 상태이상 소스별 스택을 위해 발사 타워 id를,
 * 착탄 연출 강도 산정을 위해 발사 시점의 타워 티어를 들고 다닌다.
 * (공개 ProjectileState에는 노출하지 않는다)
 */
export interface ProjectileSim extends ProjectileState {
  sourceTowerId: number;
  /** 발사 타워의 0-base 티어 (0~4) */
  tier: number;
}

function makeEnemy(): EnemySim {
  return {
    id: 0,
    defId: 'raptor',
    hp: 1,
    maxHp: 1,
    shieldHitsLeft: 0,
    dist: 0,
    pathIndex: 0,
    flying: false,
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    heading: 0,
    statuses: [],
    bounty: 0,
    baseDamage: 0,
    radius: 0.3,
    alive: true,
    hpMul: 1,
    attackCdLeft: 0,
    towerTargetId: -1,
    siegeHoldLeft: 0,
    attackAnimLeft: 0,
    attackAnimTicks: 0,
    blockerAllyId: -1,
    gateTicks: 0,
    gateBiteCdLeft: 0,
    gateOwed: 0,
    def: null as unknown as EnemyDef, // 스폰 시 반드시 채워짐
    stunImmuneUntil: -1,
    siegeMul: 1,
    brawlCdLeft: 0,
    siegeWalkLeft: 0,
    bountyChunks: 1,
    bountyPaid: 0,
    shieldRechargeLeft: 0,
  };
}

function resetEnemy(e: EnemySim): void {
  e.statuses.length = 0;
  e.alive = true;
  e.stunImmuneUntil = -1;
  e.dist = 0;
  e.shieldHitsLeft = 0;
  // ⚠ 재충전 타이머도 반드시 여기서 0으로 못 박는다 — 안 그러면 풀 재사용 때 이전
  //   개체의 타이머를 물려받아 "스폰 첫 틱에 방패가 되돌아오는" 개체가 생기고, 시드마다
  //   결과가 갈린다. tsc 가 **절대 못 잡는 자리**이고 이 저장소가 gateOwed·bountyPaid 로
  //   두 번 당한 사고와 정확히 같은 모양이다.
  e.shieldRechargeLeft = 0;
  // 풀 재사용 시 이전 개체의 공성 상태가 새어 나가면 결정론이 깨진다
  e.attackCdLeft = 0;
  e.towerTargetId = -1;
  e.siegeHoldLeft = 0;
  e.siegeWalkLeft = 0;
  e.attackAnimLeft = 0;
  e.attackAnimTicks = 0;
  e.siegeMul = 1;
  e.blockerAllyId = -1;
  e.brawlCdLeft = 0;
  // **문간 상태 셋 — 리셋 누락이 곧 결정론 파괴다** (gate.ts).
  // gateTicks 가 남아 있으면 새로 스폰된 개체가 태어나자마자 "문 앞에 서 있는 것"이 되어
  // moveEnemies 가 첫 틱부터 그 개체를 붙잡고(두 번 다시 안 걷는다) updateGate 가
  // 스폰 지점에서 마을을 물기 시작한다. gateOwed 가 남아 있으면 반대로 **누수 피해가
  // 통째로 사라진다** — 앞사람이 다 물고 간 0 을 물려받은 trex 가 마을에 0 을 넣는다.
  // 어느 쪽이든 그 차이가 풀 재사용 순서를 타므로 시드마다 갈리고, 곧 hash() 가 갈린다 —
  // bountyPaid 가 당한 것과 **정확히 같은 모양**의 사고다(아래 주석).
  //
  // ⚠ gateOwed 의 기본값이 0 인 것은 **안전한 쪽으로 고장 난다**: 스폰 전의 개체는
  //   아무것도 청구하지 않는다. waves.spawn 이 그 뒤에 baseDamage 를 넣는다
  //   (bountyChunks 와 같은 논거 — resetEnemy 는 maxHp·baseDamage 를 읽으면 안 된다).
  e.gateTicks = 0;
  e.gateBiteCdLeft = 0;
  e.gateOwed = 0;
  // 살점 값의 **지급 이력**도 같다 — 안 지우면 trex(bountyPaid 480)를 죽인 슬롯을
  // 물려받은 compy가 "이미 480을 받은 적"으로 취급돼 평생 한 푼도 못 받는다.
  // 그 감소량이 풀 재사용 순서를 타므로 시드마다 갈리고, 곧 hash()가 갈린다.
  //
  // 기본값 1/0 은 **안전한 쪽으로 고장 난다**: bountyChunks 가 1이면 combat 의
  // 진행 지급 분기가 통째로 꺼져 오늘과 똑같이 "사망 시 한 번"이 된다.
  // (0 이면 나눗셈이 Infinity 로 터지고, 이전 개체의 큰 값이 남으면 첫 타격에
  //  여러 몫이 한꺼번에 나간다 — 둘 다 조용히 골드를 새게 하는 방향이다.)
  //
  // ⚠ 여기서 `e.maxHp` 를 읽어 감시값을 만들면 안 된다. resetEnemy 는 Pool.acquire
  // 시점에 돌아 **그 시점의 maxHp 는 아직 이전 개체 것**이고, waves.spawn 이 그 뒤에
  // 새 값을 넣는다. 상수 1/0 은 그 순서에 의존하지 않는다.
  e.bountyChunks = 1;
  e.bountyPaid = 0;
}

/** 아군 유닛 내부 확장 — 정의 참조 + 채집 중단 판정용 hp 마크 (상태이상이 없어 EnemySim보다 얇다) */
export interface AllySim extends AllyState {
  def: AllyDef;
  /**
   * **캐기 시도를 시작한 시점의 hp.** 맞았는지 판정하는 데만 쓴다 (gather-spec D5).
   *
   * 왜 이 방식인가: 대안은 `damageAlly`(combat.ts)가 캐기를 끊어 주는 것인데, 그러면
   * `combat.ts → gather.ts` 임포트가 생기고 `gather.ts → combat.ts`(addGold)와 **값 순환**이
   * 된다. hp를 기억해 두고 비교하면 **`combat.ts`를 한 줄도 안 고친다.**
   * 중단해서 다시 시작하면 그 자리가 새 시도의 시작이므로 **다시 마크한다**(gather.ts §4-6).
   * 아군을 회복시키는 코드는 이 저장소에 없으므로(healAura는 적 전용) hp는 단조 감소다 —
   * 곧 `a.hp < a.gatherHpMark`는 "이 시도 중에 맞았다"와 정확히 같다.
   *
   * ⚠ **공개 `AllyState`가 아니라 여기 있다.** 이 값은 순수 내부 판정값이고 렌더가 읽을
   *   일이 0이다 — 위 `siegeWalkLeft`·`bountyChunks`가 두 번 선언한 논거("공개 상태에
   *   안 올린다. 노출하면 연출이 판정을 흉내 내기 시작한다")에 정확히 걸린다.
   *   `hash()`는 이 필드를 접으므로(battle.ts) 결정론에는 영향이 없다.
   *
   * ⚠ **0은 "이번 예약에서 아직 캐기를 시작 안 함"이라는 센티널**이기도 하다 —
   *   `gatherStarted` 이벤트가 예약당 한 번만 나가게 하는 장치다(types.ts SimEvent 주석).
   */
  gatherHpMark: number;
  /**
   * **회복 대상 키** (`AllyDef.heal` 이 있는 종만 쓴다. -1 = 없음).
   * 타워면 그 타워의 `id`, 홈타운이면 `HEAL_KEY_BASE`(-2). sim/heal.ts 가 소유한다.
   *
   * 왜 매 틱 다시 고르지 않고 기억하는가: 회복은 대상의 hp 를 **올리므로**, "가장 위태로운
   * 대상"을 매 틱 새로 뽑으면 한 번 고칠 때마다 순위가 뒤집혀 마법사가 **두 대상 사이를
   * 왕복**한다(걷는 데 시간을 다 쓰고 아무것도 못 고친다). 지금 대상이 아직 다쳐 있으면
   * 그대로 붙잡는 이력(hysteresis)이 그것을 막는다.
   *
   * ⚠ `hash()` 가 접는다 — 이 값은 x/z/tgt 에서 유도되지 않는다(다음 틱에 이 사람이
   *   무엇을 할지 자체다). ⚠ `resetAlly` 가 지운다 — 안 지우면 풀 재사용으로 새 부족원이
   *   앞사람의 대상을 물려받아 **명령 없이 태어나자마자 그리로 걸어간다.**
   */
  healKey: number;
  /** 회복 쿨다운 잔여 틱 (sim/heal.ts). hash 접기·resetAlly 초기화 필수 — 위와 같은 논거 */
  healCdLeft: number;
}

function makeAlly(): AllySim {
  return {
    id: 0,
    defId: 'clubber',
    hp: 1,
    maxHp: 1,
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    tgtX: 0,
    tgtZ: 0,
    walked: 0,
    heading: 0,
    attackCdLeft: 0,
    targetId: -1,
    alive: true,
    def: null as unknown as AllyDef, // 출동 시 반드시 채워짐
    // ── 채집 다섯 (gather-spec §3-4) — 넷은 공개 AllyState, gatherHpMark만 여기 것이다
    gatherKey: -1,
    gatherTicks: 0,
    carryGold: 0,
    carryCount: 0,
    gatherHpMark: 0,
    // ── 자동 행동 하나 (규칙 8) — false = 자동 켜짐
    autoHold: false,
    // ── 회복 둘 (sim/heal.ts) — 실제 초기화는 resetAlly 가 한다
    healKey: -1,
    healCdLeft: 0,
  };
}

function resetAlly(a: AllySim): void {
  a.alive = true;
  a.attackCdLeft = 0;
  a.targetId = -1;
  // 걸은 거리는 **반드시** 0으로 되돌린다 — 풀 재사용이라 안 지우면 새 부족원이
  // 앞사람의 보행 위상을 물려받아 태어나자마자 다리가 엉뚱한 각도에서 시작한다
  a.walked = 0;
  // ── 채집 상태 다섯 — 안 지우면 "탭이 없으면 코인도 없다"가 그 자리에서 깨진다 ─────
  // gatherKey/gatherTicks: 앞사람이 캐던 칸을 물려받은 새 부족원은 집결 지점이 곧 자기
  //   tgt라 "도착해 있는" 상태다. 그 칸이 우연히 집결 지점이면 **명령을 한 번도 안 받았는데**
  //   gatherTicks를 이어 채운다 — 곧 탭 없이 짐이 생긴다.
  // carryGold/carryCount: 더 나쁘다 — 새로 뽑은 사람이 마을 코앞(집결 지점)에 서므로
  //   그 짐이 다음 틱에 지급된다. **`trainAlly`가 곧 `addGold`가 되는 것**이고,
  //   그 골드가 풀 재사용 순서를 타므로 시드마다 갈려 hash()도 함께 갈라진다.
  //   (위 resetEnemy의 bountyPaid와 정확히 같은 사고다)
  //   ⚠ GATHER_DELIVER_RANGE를 0.7로 내려 집결 자리를 반경 밖으로 뺐지만(balance.ts),
  //     그건 **둘째 방어선**이다. 첫째는 언제나 이 다섯 줄이다.
  // gatherHpMark: 앞사람의 높은 hp가 남으면 새 사람이 **맞지도 않았는데 중단**되고,
  //   "0이면 아직 시작 안 함"이라는 gatherStarted 스로틀 센티널도 함께 거짓말을 한다.
  a.gatherKey = -1;
  a.gatherTicks = 0;
  a.carryGold = 0;
  a.carryCount = 0;
  a.gatherHpMark = 0;
  // ── 자동 행동 (규칙 8) — **false 가 기본이다.** 앞사람이 "여기 지켜"를 받은 채 죽으면
  //   그 비트가 풀에 남고, 새로 뽑은 부족원이 태어나자마자 자동이 꺼진 채로 선다.
  //   화면에서는 "왜 얘만 안 움직이지"이고, 코드에서는 풀 재사용 순서가 곧 시드라
  //   같은 시드가 아니면 hash()가 갈린다 — 위 carryGold 문단과 같은 사고다.
  a.autoHold = false;
  // ── 회복 상태 둘 (sim/heal.ts) — 위 다섯 줄과 정확히 같은 사고를 막는다.
  //   healKey 가 남으면 새 부족원이 앞사람의 회복 대상으로 **명령 없이** 걸어가고,
  //   healCdLeft 가 남으면 태어나자마자 회복하거나 반대로 한참을 못 한다. 둘 다
  //   풀 재사용 순서를 타므로 시드가 같지 않으면 hash() 가 갈린다.
  a.healKey = -1;
  a.healCdLeft = 0;
}

/**
 * 아군을 **id 오름차순**으로 늘어놓는 공용 순회 헬퍼 — 살아 있는 사람만 / 시체까지 전부.
 *
 * 풀(DenseList)은 swap-remove라 `items` 순서가 사망으로 섞인다. 그 순서대로 규칙을 돌리면
 * 결정론은 유지되지만(같은 시드면 같은 순서) **규칙을 말로 적을 수 없다.**
 * 정원이 한 자리 수라 삽입 정렬이면 충분하고, 호출부가 버퍼를 재사용해 매 틱 할당이 없다.
 *
 * ⚠ **이름에 생사를 박아 둘로 갈랐다.** 하나로는 세 호출부를 만족시킬 수 없다:
 *  · `updateAllies` 1단계 — 시체 불필요 (죽은 아군은 조준도 봉쇄도 안 한다)
 *  · `moveAlly`        — 시체 불필요 (시체를 count에 세면 "대상이 하나도 없으면 거부한다"가 무너진다)
 *  · `updateGather`    — **시체 필요** (시체가 진 짐을 정산해야 gatherLost{'died'}가 나간다)
 */
function fillAllyIdsInto(items: readonly AllySim[], out: AllySim[], aliveOnly: boolean): void {
  out.length = 0;
  for (const a of items) {
    if (aliveOnly && !a.alive) continue;
    let i = out.length;
    out.push(a);
    for (; i > 0 && (out[i - 1] as AllySim).id > a.id; i--) {
      out[i] = out[i - 1] as AllySim;
    }
    out[i] = a;
  }
}

/** 살아 있는 아군만, id 오름차순. `updateAllies` · `moveAlly` 전용 */
export function fillAliveAllyIds(items: readonly AllySim[], out: AllySim[]): void {
  fillAllyIdsInto(items, out, true);
}

/**
 * 죽은 아군까지 전부, id 오름차순. **`updateGather` 전용** — 시체의 짐을 정산해야 한다.
 * 여기서 시체를 거르면 `gatherLost{'died'}`가 영영 안 나가고 "운반 중 사망 = 전액 소멸"이
 * **도달 불가 코드**가 된다(사망은 2단계, 회수는 9단계, 채집은 그 사이 8-b다).
 */
export function fillAllAllyIds(items: readonly AllySim[], out: AllySim[]): void {
  fillAllyIdsInto(items, out, false);
}

function makeProjectile(): ProjectileSim {
  return {
    id: 0,
    kind: 'homing',
    towerDefId: 'spear',
    sourceTowerId: -1,
    tier: 0,
    x: 0,
    y: 0,
    z: 0,
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    targetId: -1,
    targetX: 0,
    targetZ: 0,
    flightTicks: 0,
    elapsedTicks: 0,
    startX: 0,
    startZ: 0,
    arcHeight: 0,
    speed: 0,
    dmg: 0,
    targetFlying: false,
    fromBase: false,
    alive: true,
  };
}

function resetProjectile(p: ProjectileSim): void {
  p.alive = true;
  p.targetId = -1;
  p.sourceTowerId = -1;
  p.tier = 0;
  p.flightTicks = 0;
  p.elapsedTicks = 0;
  p.splash = undefined;
  p.status = undefined;
  // 풀 재사용 시 이전 화살의 출처가 새어 나가면 타워 피해가 'hometown'으로 집계된다
  p.fromBase = false;
}

export class World {
  readonly enemies = new DenseList<EnemySim>();
  readonly towers = new DenseList<TowerState>();
  readonly projectiles = new DenseList<ProjectileSim>();
  readonly allies = new DenseList<AllySim>();
  private readonly enemyById = new Map<number, EnemySim>();
  private readonly allyById = new Map<number, AllySim>();
  private nextId = 1;
  private readonly enemyPool = new Pool<EnemySim>(makeEnemy, resetEnemy, 32);
  private readonly projPool = new Pool<ProjectileSim>(makeProjectile, resetProjectile, 32);
  // 동시 상한(ALLY_MAX_ACTIVE)이 한 자리 수라 프리웜도 그만큼만
  private readonly allyPool = new Pool<AllySim>(makeAlly, resetAlly, 8);

  newId(): number {
    return this.nextId++;
  }

  acquireEnemy(): EnemySim {
    const e = this.enemyPool.acquire();
    e.id = this.newId();
    this.enemies.add(e);
    this.enemyById.set(e.id, e);
    return e;
  }

  removeEnemyAt(index: number): void {
    const e = this.enemies.removeAt(index);
    this.enemyById.delete(e.id);
    this.enemyPool.release(e);
  }

  findEnemy(id: number): EnemySim | undefined {
    return this.enemyById.get(id);
  }

  acquireProjectile(): ProjectileSim {
    const p = this.projPool.acquire();
    p.id = this.newId();
    this.projectiles.add(p);
    return p;
  }

  removeProjectileAt(index: number): void {
    this.projPool.release(this.projectiles.removeAt(index));
  }

  acquireAlly(): AllySim {
    const a = this.allyPool.acquire();
    a.id = this.newId();
    this.allies.add(a);
    this.allyById.set(a.id, a);
    return a;
  }

  removeAllyAt(index: number): void {
    const a = this.allies.removeAt(index);
    this.allyById.delete(a.id);
    this.allyPool.release(a);
  }

  findAlly(id: number): AllySim | undefined {
    return this.allyById.get(id);
  }

  findTower(id: number): TowerState | undefined {
    for (const t of this.towers.items) if (t.id === id) return t;
    return undefined;
  }
}

/** 모듈 간 공유되는 시뮬레이션 컨텍스트 (battle.ts가 소유) */
export interface SimCtx {
  readonly opts: BattleOptions;
  readonly rng: Rng;
  readonly world: World;
  readonly events: SimEvent[];
  readonly view: BattleStateView;
  readonly groundPaths: readonly BattlePath[];
  readonly airPaths: readonly BattlePath[];
  /**
   * 홈타운의 비공개 상태(발사 쿨다운·고정 타깃). 레벨은 공개 상태(view.baseLevel)가
   * 갖는다 — 한 값을 두 곳에 두지 않기 위해 소유를 이렇게 갈랐다.
   */
  readonly hometown: HometownSim;
  /**
   * 자원 칸 밭 (gather-spec §4). 공개 목록(`view.resources`)과 **같은 객체 배열**을 들고 있고,
   * 조회 색인(Map)은 여기만 안다 — **순회는 언제나 배열**이다(계약 B: 자료구조의 순회
   * 순서에 결정론을 걸지 않는다). `hometown`과 정확히 같은 소유 패턴이다.
   */
  readonly resources: ResourceField;
}

/** 적이 따라가는 경로 (공중이면 airPaths, 인덱스 초과 시 0번 폴백) */
export function pathFor(ctx: SimCtx, e: EnemySim): BattlePath {
  const list = e.flying ? ctx.airPaths : ctx.groundPaths;
  return (list[e.pathIndex] ?? list[0]) as BattlePath;
}
