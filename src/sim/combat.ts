/**
 * 데미지 파이프라인 — 방패 소진(피해 무효) → 흩어짐 비율 감산(폭발 한정) → armor 고정
 * 감산(최소 1) → 가죽 타격당 상한(최소 1) → hp 감소
 * → **살점 값**: 몫 경계를 넘을 때마다 bounty의 몫, 사망 시 잔액 (settleBounty).
 * 기지 누수는 baseDamaged로 이어진다 — 남은 몫은 몰수된다.
 * 누수의 **청구액은 `gateOwed`(잔액)** 다: 문 앞에서 이미 문 만큼은 빠진다 (src/sim/gate.ts).
 * 타워 피해(적 부족의 공격)도 여기 있다 — 감쇠/방어 없이 정수 피해가 그대로 들어간다.
 * 상태이상 부여는 attack/status 쪽에서 담당 (순환 임포트 방지).
 */
import type { AllyId, HometownSourceId, StatusKind, TowerId, TowerState } from '@/data/types';
import {
  BOUNTY_CHUNK_LIVE_DEN,
  BOUNTY_CHUNK_LIVE_NUM,
  MITIGATED_MIN_SHARE,
  hideCapFor,
} from '@/data/balance';
import type { AllySim, EnemySim, SimCtx } from './entities';

export function addGold(ctx: SimCtx, delta: number): void {
  ctx.view.gold += delta;
  ctx.events.push({ type: 'goldChanged', gold: ctx.view.gold, delta });
}

/**
 * 지금까지 **도달한 몫** k (0 ~ K−1). 살점 값의 유일한 진행 지표다.
 *
 * 상한이 K가 아니라 **K−1**인 이유: 마지막 한 몫은 죽여야만 나간다. 그래야
 *  (a) "처치"가 여전히 결말 노릇을 하고 — 99%를 깎아 놔도 마지막 몫은 안 준다,
 *  (b) 누수 개체의 부분 지급이 한 몫만큼 덜 샌다(총량 팽창 억제).
 * 두 목적이 이 한 줄에서 같이 나온다.
 *
 * hp가 음수(오버킬)면 bled > maxHp가 될 수 있지만 min이 K−1로 잘라 무해하다.
 */
function chunkReached(e: EnemySim): number {
  const bled = e.maxHp - e.hp;
  if (bled <= 0) return 0;
  return Math.min(e.bountyChunks - 1, Math.floor((bled * e.bountyChunks) / e.maxHp));
}

/**
 * 살점 값 정산 — 반환값 = **이번에 실제로 지급한 골드**(정수, 0이면 지급 없음).
 * `final`은 사망 정산이며 잔액 전부를 낸다.
 *
 * 세 성질이 이 몇 줄에서 **저절로** 나온다 — 규칙을 따로 안 적었다:
 *  · **총량 보존**: 죽으면 `owed = bounty`라 평생 지급 합계가 정확히 bounty다.
 *    내림에서 생긴 나머지는 사망 잔액이 통째로 흡수한다.
 *  · **오버킬 무해**: 마지막 일격이 maxHp의 100배여도 `owed`는 bounty가 상한이다.
 *  · **힐 무해**: 회복으로 hp가 오르면 k가 내려가 `due`가 음수 → 지급 0. `bountyPaid`는
 *    단조 증가라 되돌아가지 않으므로, 같은 구간을 다시 깎아도 0이다. 주술사
 *    (`status.processHealAuras`) 옆에서 무한히 때려도 총액 상한이 bounty로 닫혀 있다.
 *
 * 골드 산술은 전부 정수다 — 부동소수는 k를 floor하는 한 번에만 닿고 **누적되지 않는다**.
 * (`bountyPaid`에 float가 쌓이면 `hash()`의 `v.gold`가 흔들린다)
 *
 * 방패는 여기 못 온다: `damageEnemy`가 `e.hp`를 건드리기 **전에** return하므로
 * "무효화된 타격에는 지급이 없다"가 코드 배치로 보장된다. armor·가죽·흩어짐은
 * `dealt`를 줄여 hp를 덜 깎으므로 지급도 자동으로 덜 나간다 — 별도 분기가 필요 없다.
 */
function settleBounty(ctx: SimCtx, e: EnemySim, final: boolean): number {
  let owed: number;
  if (final) {
    owed = e.bounty;
  } else {
    if (e.bountyChunks <= 1) return 0; // 잡몹 — 오늘과 완전히 같은 경로
    // 생전 지급은 **할인된다**(BOUNTY_CHUNK_LIVE_* 주석에 실측 유도가 있다).
    // 정수 산술 그대로다: bounty ≤ 480 · NUM 2 · k ≤ 23 → 분자 최대 22,080.
    owed = Math.floor(
      (e.bounty * BOUNTY_CHUNK_LIVE_NUM * chunkReached(e)) /
        (BOUNTY_CHUNK_LIVE_DEN * e.bountyChunks),
    );
  }
  const due = owed - e.bountyPaid;
  if (due <= 0) return 0;
  e.bountyPaid = owed;
  addGold(ctx, due);
  return due;
}

/**
 * 급소가 열려 있는가 — **지금 이 적을 붙잡고 있는 아군이 `sunder`인가**.
 *
 * 붙잡힘(`blockerAllyId`)은 매 틱 `updateAllies`가 처음에 전부 지우고 다시 채우므로
 * 이 판정은 "이번 틱에 실제로 발이 묶여 있다"와 정확히 같다 — 곧 파수꾼이 죽거나
 * 수명이 다해 사라지면 같은 틱에 가죽이 다시 닫힌다. 상태를 새로 들고 있지 않으므로
 * `hash()`에 넣을 것도 없다(`blockerAllyId`는 이미 들어 있다).
 */
function isSundered(ctx: SimCtx, e: EnemySim): boolean {
  if (e.blockerAllyId < 0) return false;
  return ctx.world.findAlly(e.blockerAllyId)?.def.sunder === true;
}

/**
 * 피해 적용. 반환값 = 실제 피해량 (방패에 막히면 0).
 * ignoreArmor는 poison DoT 전용 (armor 무시).
 * splash는 **폭발 부가 피해 전용**(attack.applyArea 한 곳) — 흩어짐〽이 여기에만 걸린다.
 *
 * ── 세 감산의 순서와 그 이유 (docs/counter-plan.md 2단계) ────────────────────
 *  0. 방패 — 최우선. 아예 "맞지 않은" 것이라 뒤의 계산이 존재하지 않는다.
 *  1. 흩어짐 〽 — 폭발이면 먼저 비율로 깎는다. **감산 전**이라야 armor와 곱셈이 아니라
 *     덧셈으로 겹치지 않는다(둘 다 곱셈이면 작은 타격이 두 번 벌받아 0으로 눌린다).
 *  2. 장갑 🛡 — 고정 감산, 최소 1. **작은 타격**을 벌한다.
 *  3. 가죽 🟫 — 타격당 상한, 최소 1. **큰 한 방**을 벌한다. armor의 거울이라 마지막이다:
 *     상한은 "얼마가 들어오든 이 이상은 안 된다"이므로 모든 감산 뒤에 걸려야 뜻이 산다.
 *     단계 3부터 **파수꾼이 붙잡은 적에게는 이 상한이 없다**(isSundered) — 아군이 타워
 *     화력의 곱셈 인자가 되는 유일한 자리다.
 */
export function damageEnemy(
  ctx: SimCtx,
  e: EnemySim,
  amount: number,
  source: TowerId | StatusKind | AllyId | HometownSourceId,
  ignoreArmor = false,
  splash = false,
): number {
  if (!e.alive) return 0;
  if (e.shieldHitsLeft > 0) {
    e.shieldHitsLeft--;
    ctx.events.push({
      type: 'enemyDamaged',
      enemyId: e.id,
      amount: 0,
      x: e.x,
      z: e.z,
      source,
      shielded: true,
    });
    return 0;
  }
  const resist = splash ? (e.def.splashResist ?? 0) : 0;
  const raw = resist > 0 ? amount * (1 - resist) : amount;
  const afterArmor = ignoreArmor ? raw : Math.max(1, raw - e.def.armor);
  // 가죽 — 대상별 상한. maxHp 비율이라 티어를 올려도 최소 타격 횟수가 그대로다.
  // 급소 열기 🟫🔓 — 붙잡은 아군이 sunder면 그 적에게는 상한이 없다 (단계 3).
  const cap =
    e.def.hide !== undefined && !isSundered(ctx, e) ? hideCapFor(e.maxHp, e.def.hide) : Infinity;
  const dealt = Math.min(afterArmor, cap);
  // 축별로 못 넣은 몫. ignoreArmor면 afterArmor === raw라 lostArmor가 저절로 0이 된다
  const lostSplash = amount - raw;
  const lostArmor = raw - afterArmor;
  const lostHide = afterArmor - dealt;
  // 가장 크게 깎은 축 하나만 — 그리고 그 손실이 **눈에 띌 때만** 싣는다
  const worst = Math.max(lostHide, lostArmor, lostSplash);
  let mitigated: 'armor' | 'hide' | 'splash' | undefined;
  if (worst > 0 && worst / (dealt + worst) >= MITIGATED_MIN_SHARE) {
    mitigated =
      lostHide >= lostArmor && lostHide >= lostSplash
        ? 'hide'
        : lostArmor >= lostSplash
          ? 'armor'
          : 'splash';
  }
  e.hp -= dealt;
  ctx.events.push({
    type: 'enemyDamaged',
    enemyId: e.id,
    amount: dealt,
    x: e.x,
    z: e.z,
    source,
    shielded: false,
    ...(mitigated ? { mitigated } : {}),
  });
  // 살점 값 — **지급이 enemyDied/bountyChunk보다 먼저 push되는 순서를 지킨다.**
  // 계측 하네스가 "원인은 이벤트 스트림 바로 뒤에서 읽는다"는 규약 위에 서 있어서,
  // 순서를 뒤집으면 봉투 측정이 조용히 오귀속된다.
  if (e.hp <= 0) {
    e.alive = false;
    const paid = settleBounty(ctx, e, true); // 잔액 전부 — 총액이 정확히 bounty가 된다
    ctx.events.push({
      type: 'enemyDied',
      enemyId: e.id,
      defId: e.defId,
      x: e.x,
      z: e.z,
      bounty: e.bounty,
      goldNow: paid,
      maxHp: e.maxHp,
      // 문 앞에서 죽었다면 그 자리에서 버틴 틱 — 개체는 같은 틱에 풀로 회수되므로
      // 여기 안 실으면 계측이 다시 읽을 방법이 없다 (types.ts enemyDied.gateTicks)
      ...(e.gateTicks > 0 ? { gateTicks: e.gateTicks } : {}),
    });
  } else {
    const paid = settleBounty(ctx, e, false);
    if (paid > 0) {
      ctx.events.push({
        type: 'bountyChunk',
        enemyId: e.id,
        defId: e.defId,
        x: e.x,
        z: e.z,
        gold: paid,
        chunk: chunkReached(e),
        chunks: e.bountyChunks,
      });
    }
  }
  return dealt;
}

/**
 * 타워 피해 — 적 부족의 타격. 반환값 = 실제로 깎인 체력.
 * hp가 0 이하가 되면 towerDestroyed를 즉시 발행하지만 **리스트에서 빼지는 않는다**
 * (순회 중 제거 금지). 실제 회수는 같은 틱의 siege.sweepDestroyedTowers가 한다.
 * 감쇠·방어·확률이 없는 이유: 타워는 움직이지 않는 고정 표적이라 명중/회피 개념이 없고,
 * "몇 초 버티는가"가 곧 밸런스 손잡이여서 계산이 눈에 보여야 한다.
 */
export function damageTower(
  ctx: SimCtx,
  t: TowerState,
  amount: number,
  attacker: EnemySim,
  ranged: boolean,
): number {
  if (t.hp <= 0) return 0; // 이미 이번 틱에 부서짐 — 오버킬은 무시
  const dealt = Math.max(1, Math.round(amount));
  t.hp -= dealt;
  ctx.events.push({
    type: 'towerDamaged',
    towerId: t.id,
    defId: t.defId,
    cellX: t.cellX,
    cellZ: t.cellZ,
    amount: dealt,
    hpLeft: Math.max(0, t.hp),
    maxHp: t.maxHp,
    attackerId: attacker.id,
    attackerDefId: attacker.defId,
    attackerX: attacker.x,
    attackerZ: attacker.z,
    ranged,
  });
  if (t.hp <= 0) {
    t.hp = 0;
    ctx.events.push({
      type: 'towerDestroyed',
      towerId: t.id,
      defId: t.defId,
      cellX: t.cellX,
      cellZ: t.cellZ,
      tier: t.tier,
      killerId: attacker.id,
    });
  }
  return dealt;
}

/**
 * 아군 피해 — 발이 묶인 적의 난투 반격. 반환값 = 실제로 깎인 체력.
 * 적과 같은 armor 규칙(고정 감산, 최소 1)을 쓴다 — 두 진영의 계산이 다르면
 * 화면에 뜨는 숫자를 서로 비교할 수 없어진다.
 * 사망해도 **여기서 리스트에서 빼지 않는다**(순회 중 제거 금지) — 회수는 battle의 사망 처리.
 */
export function damageAlly(ctx: SimCtx, a: AllySim, amount: number, attacker: EnemySim): number {
  if (!a.alive) return 0;
  const dealt = Math.max(1, Math.round(amount) - a.def.armor);
  a.hp -= dealt;
  ctx.events.push({
    type: 'allyDamaged',
    allyId: a.id,
    defId: a.defId,
    amount: dealt,
    hpLeft: Math.max(0, a.hp),
    maxHp: a.maxHp,
    x: a.x,
    z: a.z,
    attackerId: attacker.id,
    attackerDefId: attacker.defId,
  });
  if (a.hp <= 0) {
    a.hp = 0;
    a.alive = false;
    ctx.events.push({ type: 'allyDied', allyId: a.id, defId: a.defId, x: a.x, z: a.z });
  }
  return dealt;
}

/**
 * 기지 도달 — 사망 이벤트 없이 제거 표시, 기지 피해. 패배 판정은 battle.checkEnd에서.
 *
 * **여기서는 정산하지 않는다.** 이미 넘은 몫은 이미 받았고, 남은 몫(`forfeited`)은
 * 몰수된다 — 부분 지급을 인정할지의 결정이 코드가 아니라 구조에서 나온다. 이 설계에서
 * 총량이 움직이는 **유일한** 자리라 계측 가능해야 해서 이벤트에 싣는다.
 */
export function leakEnemy(ctx: SimCtx, e: EnemySim): void {
  if (!e.alive) return;
  e.alive = false;
  // ⚠⚠ **청구액은 `baseDamage` 가 아니라 `gateOwed`(잔액)다** (11단계 · 문간 교전).
  // 스폰이 `gateOwed = baseDamage` 로 굳히고(waves.spawn) 문 앞의 한 입이 1씩 깎으므로
  //   Σ(한 입) + (여기서 청구하는 잔액) = baseDamage
  // 가 **자료구조로** 성립한다 — 밸런스가 근사가 아니라 정의상 보존된다.
  // 문간이 꺼진 판(StageDef.gate.enabled = false · 대조군)에서는 한 입이 0회라
  // 이 값이 `baseDamage` 그대로이고, 곧 **종전과 비트 단위로 같다.**
  //
  // ⚠ 여기에 문간 분기(enterGate)를 두지 **않는다**. `claude/gate-wip` 는 여기서 갈랐고
  //   그 대가가 `combat → gate → status → combat` 순환 참조였다. 갈림은 이동 단계
  //   한 곳(battle.moveEnemies)에만 있고, 이 함수는 **뚫고 들어가는 순간의 경로**로만 남는다.
  const owed = Math.max(0, e.gateOwed);
  ctx.events.push({
    type: 'enemyLeaked',
    enemyId: e.id,
    defId: e.defId,
    baseDamage: owed,
    forfeited: Math.max(0, e.bounty - e.bountyPaid),
  });
  e.gateOwed = 0;
  // 전액을 문 앞에서 이미 물고 들어온 개체는 여기서 **한 톨도 안 깎는다** — 그때
  // `baseDamaged` 를 0 으로 쏘면 연출이 "맞았다"를 거짓으로 그린다.
  if (owed <= 0) return;
  ctx.view.baseHp = Math.max(0, ctx.view.baseHp - owed);
  ctx.events.push({ type: 'baseDamaged', amount: owed, hpLeft: ctx.view.baseHp });
}
