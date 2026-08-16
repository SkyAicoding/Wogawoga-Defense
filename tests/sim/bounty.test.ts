/**
 * 살점 값 (bounty chunks) — 지급 **단위**를 '개체'에서 '이번 웨이브의 사냥감 한 마리분
 * HP'로 바꾼 뒤에도 지켜져야 하는 것들.
 *
 * ── 무엇을 잠그는가 ────────────────────────────────────────────────────────────
 * 이 파일이 재는 것은 수치가 아니라 **산술 불변식**이다. 총 지급액이 bounty를 넘지도
 * 모자라지도 않는다는 성질 하나에 힐러 파밍·오버킬·방패·DoT가 전부 매달려 있다.
 *
 *  1) 총량 보존   Σ(bountyChunk.gold) + enemyDied.goldNow == bounty  (정확히)
 *  2) 힐러 파밍   주술사 힐 아래에서 무한히 때려도 총 지급 ≤ bounty
 *  3) 방패        무효화된 타격에는 지급이 없다 (hp를 안 깎았으므로)
 *  4) 오버킬      마지막 일격이 maxHp의 몇 배든 총 지급 == bounty
 *  5) 풀 재사용   재활용된 슬롯의 새 적이 남의 지급 이력을 물려받지 않는다
 *  6) DoT         화상·중독도 지급 경로에 **포함된다**
 *  7) 무한 모드   K는 HP 스케일(1.06^n)에 불변이다
 *
 * ⚠ **2번은 반드시 healAura를 실제로 도는 국면에서 재야 한다.** 실측 shaman 등장
 * 웨이브 수는 s1 **0** · s2 **0** · s3 6 · s4 3 · s5 5 · s6 4다 — 곧 스테이지1 봉투를
 * 아무리 돌려도 이 함정은 **한 번도 안 밟힌다**. 여기서는 목 정의로 힐러를 직접 세워
 * 그 국면을 강제로 만든다(스테이지 데이터에 의존하면 편성이 바뀔 때 조용히 헛돈다).
 */
import { describe, expect, it } from 'vitest';
import type { BattleSim, EnemyId, SimEvent, TowerId } from '@/data/types';
import {
  BOUNTY_CHUNK_LIVE_DEN,
  BOUNTY_CHUNK_LIVE_NUM,
  BOUNTY_CHUNK_MAX,
  BOUNTY_CHUNK_MIN_GOLD,
  bountyChunksFor,
} from '@/data/balance';
import { createBattle } from '@/sim/battle';
import { makeBotSim } from './botharness';
import { enemyDefs, eventsOf, options, runTicks, stageDef, tier, towerDefs, wave } from './fixtures';

/** 이 판에서 **전투로** 들어온 골드만 (웨이브 클리어·조기 호출·환불을 뺀 순수 지급) */
function combatGold(ev: SimEvent[]): number {
  let sum = 0;
  for (const e of ev) {
    if (e.type === 'bountyChunk') sum += e.gold;
    else if (e.type === 'enemyDied') sum += e.goldNow;
  }
  return sum;
}

/** 몫 지급 + 사망 잔액의 합 (개체 하나짜리 시나리오용) */
function paidFor(ev: SimEvent[], enemyId?: number): number {
  let sum = 0;
  for (const e of ev) {
    if (e.type === 'bountyChunk' && (enemyId === undefined || e.enemyId === enemyId)) sum += e.gold;
    else if (e.type === 'enemyDied' && (enemyId === undefined || e.enemyId === enemyId)) {
      sum += e.goldNow;
    }
  }
  return sum;
}

describe('살점 값 — 산술 불변식', () => {
  /**
   * 총량 보존이 이 설계의 **전부**다. 진행 지급이 아무리 잘게 쪼개져도 죽은 개체의
   * 평생 지급 합계가 bounty와 한 골드도 다르면 안 된다 — 내림의 나머지는 사망 잔액이
   * 통째로 흡수한다(`final`이 `owed = bounty`를 강제한다).
   */
  it('죽은 적의 총 지급은 정확히 bounty다 — 몫이 몇 개로 쪼개지든', () => {
    // hp 2400 · bounty 240 · 웨이브 중앙값도 2400(단일 그룹) → K = min(1, 60, 24) = 1
    // 을 피하려고 잡몹을 섞어 중앙값을 낮춘다: compy 9마리(hp 100) + spino 1마리(hp 2400)
    // → 마릿수 가중 중앙값 = 100 → spino K = min(24, 60, 24) = 24
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({
          compy: { hp: 100, bounty: 4, speed: 0.05 },
          spino: { hp: 2400, bounty: 240, speed: 0.05 },
        }),
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 40, range: 4, cooldownTicks: 3 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 500 }),
        waves: [
          wave([
            { enemyId: 'compy', count: 9, intervalTicks: 2 },
            { enemyId: 'spino', count: 1, delayTicks: 40 },
          ]),
        ],
      }),
    );
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 })).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 3000);
    const died = eventsOf(ev, 'enemyDied');
    expect(died.length, '10마리 전부 죽었어야 한다').toBe(10);

    // 개체별 전수 검사 — 하나라도 어긋나면 그 개체의 몫 산술이 깨진 것이다
    for (const d of died) {
      expect(paidFor(ev, d.enemyId), `적 ${d.enemyId}(${d.defId})`).toBe(d.bounty);
    }
    // 그리고 실제로 쪼개졌는지 — 안 쪼개졌으면 이 테스트는 아무것도 안 잡는다
    const chunks = eventsOf(ev, 'bountyChunk');
    expect(chunks.length, '살점 값이 실제로 발화했어야 한다').toBeGreaterThan(10);
    // compy(bounty 4 → K=1)는 몫을 한 번도 안 낸다 = 잡몹 무변경
    expect(chunks.every((c) => c.defId === 'spino')).toBe(true);
    // 모든 몫은 양수 정수다 (분수 골드가 새면 여기서 걸린다)
    for (const c of chunks) {
      expect(Number.isInteger(c.gold), `몫이 정수가 아니다: ${c.gold}`).toBe(true);
      expect(c.gold).toBeGreaterThan(0);
    }
    // 잔액(goldChanged)과 지급 이벤트의 합이 서로 어긋나지 않는다.
    // 수입원은 셋뿐이다: 전투 지급 · 웨이브 클리어 보상 · 조기 호출 보너스.
    // (이 항등식이 깨지면 어딘가에서 골드가 이벤트 없이 움직였다는 뜻이다)
    const goldUp = eventsOf(ev, 'goldChanged')
      .filter((g) => g.delta > 0)
      .reduce((s, g) => s + g.delta, 0);
    const waveBonus = eventsOf(ev, 'waveCleared').reduce((s, w) => s + w.goldReward, 0);
    const early = eventsOf(ev, 'earlyCallBonus').reduce((s, e) => s + e.gold, 0);
    expect(goldUp).toBe(combatGold(ev) + waveBonus + early);
  });

  /**
   * ⚠ **이 저장소 최초의 healAura 회귀 테스트다.**
   *
   * "가한 누적 피해량에 비례해 지급"하는 설계였다면 여기서 골드가 무한히 나온다 —
   * 주술사가 되살린 체력을 다시 깎는 것을 영원히 반복할 수 있기 때문이다.
   * 살점 값은 지급이 `floor(bounty × k / K) − bountyPaid`이고 `bountyPaid`가 단조
   * 증가라, **회복이 지급을 되살리지 못한다**. 총 지급 상한이 bounty로 산술적으로 닫힌다.
   *
   * 판별력: `settleBounty`를 누적 피해 기준으로 되돌리면 즉시 빨개져야 한다.
   */
  it('힐러(healAura) 아래에서 무한히 때려도 총 지급이 bounty를 못 넘는다', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({
          // 힐러 — 자기 자신은 안 고친다(status.processHealAuras가 j===i를 건너뛴다).
          // 사거리를 넓게, 회복량을 타워 DPS보다 크게 잡아 표적이 **절대 안 죽게** 한다.
          shaman: {
            hp: 100_000,
            bounty: 4,
            speed: 0,
            healAura: { radius: 30, hpPerStatusTick: 400 },
          },
          // 표적 — 큰 몸집 + 큰 bounty. 힐이 타워 화력을 앞서므로 영원히 살아 있다
          spino: { hp: 2400, bounty: 240, speed: 0 },
          compy: { hp: 100, bounty: 4, speed: 0 },
        }),
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 30, range: 6, cooldownTicks: 3 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 500 }),
        waves: [
          wave([
            { enemyId: 'compy', count: 9, intervalTicks: 1 },
            { enemyId: 'spino', count: 1 },
            { enemyId: 'shaman', count: 1 },
          ]),
        ],
      }),
    );
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 1, cellZ: 1 })).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    // 아주 길게 돌린다 — "시간이 지나면 새는" 설계였다면 여기서 드러난다
    const ev = runTicks(sim, 6000);

    // 검증이 헛돌지 않는지 먼저 — 힐이 실제로 돌고, 표적이 실제로 안 죽었어야 한다
    const spinoDied = eventsOf(ev, 'enemyDied').some((d) => d.defId === 'spino');
    expect(spinoDied, '표적이 죽으면 무한 파밍 국면이 아니다').toBe(false);
    const hits = eventsOf(ev, 'enemyDamaged').filter((h) => !h.shielded);
    expect(hits.length, '타워가 실제로 때렸어야 한다').toBeGreaterThan(200);
    const dmgTotal = hits.reduce((s, h) => s + h.amount, 0);
    // 누적 피해가 bounty보다 **훨씬** 커야 이 테스트가 뜻이 있다 (누적 비례였다면 그만큼 나왔을 것)
    expect(dmgTotal, '누적 피해가 표적 maxHp보다 커야 회복이 실제로 일어난 것이다').toBeGreaterThan(
      2400 * 3,
    );

    // ── 본체: 살아 있는 표적에게 나간 총 지급이 bounty를 못 넘는다 ──
    const paidToSpino = eventsOf(ev, 'bountyChunk')
      .filter((c) => c.defId === 'spino')
      .reduce((s, c) => s + c.gold, 0);
    expect(paidToSpino, `누적 피해 ${dmgTotal}인데 지급 ${paidToSpino}`).toBeLessThanOrEqual(240);
    // 살아 있으므로 마지막 몫은 아직 안 나갔다 — 상한은 (K−1)/K 몫이다
    expect(paidToSpino).toBeLessThan(240);
  });

  it('방패에 막힌 타격은 지급이 0이다 (hp를 안 깎았으므로)', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({
          spino: { hp: 2400, bounty: 240, shieldHits: 5, speed: 0.05 },
          compy: { hp: 100, bounty: 4, speed: 0.05 },
        }),
        // 쿨다운을 길게 — 방패 5장이 소진되기 전 구간을 이벤트 순서로 또렷이 본다
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 30, range: 4, cooldownTicks: 20 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 500 }),
        waves: [
          wave([
            { enemyId: 'compy', count: 9, intervalTicks: 1 },
            { enemyId: 'spino', count: 1 },
          ]),
        ],
      }),
    );
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 })).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 400);
    // spino에게 들어간 타격을 순서대로 훑으며 "방패 구간 동안 몫이 하나도 안 나갔는지" 본다
    const spinoIds = new Set(
      eventsOf(ev, 'enemySpawned')
        .filter((s) => s.defId === 'spino')
        .map((s) => s.enemyId),
    );
    let shieldedSeen = 0;
    let chunksDuringShield = 0;
    for (const e of ev) {
      if (e.type === 'enemyDamaged' && spinoIds.has(e.enemyId) && e.shielded) shieldedSeen++;
      if (e.type === 'bountyChunk' && spinoIds.has(e.enemyId) && shieldedSeen < 5) {
        chunksDuringShield++;
      }
    }
    expect(shieldedSeen, '방패가 실제로 막았어야 한다').toBe(5);
    expect(chunksDuringShield, '방패 구간에 지급이 있었다').toBe(0);
  });

  it('오버킬 — 마지막 일격이 maxHp의 몇 배여도 총 지급은 정확히 bounty다', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({
          spino: { hp: 2400, bounty: 240, armor: 0, speed: 0.05 },
          compy: { hp: 100, bounty: 4, speed: 0.05 },
        }),
        // dmg 100_000 = maxHp의 40배 이상. 한 방에 hp가 −97,600이 된다
        towerDefs: towerDefs({
          spear: { tiers: [tier({ dmg: 100_000, range: 4, cooldownTicks: 30 })] },
        }),
        stage: stageDef({ waveCount: 1, baseHp: 500 }),
        waves: [
          wave([
            { enemyId: 'compy', count: 9, intervalTicks: 1 },
            { enemyId: 'spino', count: 1, delayTicks: 60 },
          ]),
        ],
      }),
    );
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 })).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const died = eventsOf(ev, 'enemyDied').filter((d) => d.defId === 'spino');
    expect(died).toHaveLength(1);
    const id = (died[0] as { enemyId: number }).enemyId;
    // 첫 타격에 즉사했으므로 진행 지급이 아예 없고, 사망 잔액이 전액이어야 한다
    expect(eventsOf(ev, 'bountyChunk').filter((c) => c.enemyId === id)).toHaveLength(0);
    expect(died[0]?.goldNow).toBe(240);
    expect(paidFor(ev, id)).toBe(240);
    // 단건 goldChanged가 bounty를 넘지 않는다
    for (const g of eventsOf(ev, 'goldChanged')) expect(g.delta).toBeLessThanOrEqual(240);
  });

  /**
   * 풀 재사용 — `Pool.acquire`가 `resetEnemy`를 돌린다. `bountyPaid`를 안 지우면
   * 큰 적을 죽인 슬롯을 물려받은 작은 적이 "이미 다 받은 적"이 되어 **평생 0골드**다.
   * 그 감소량이 풀 재사용 순서를 타므로 시드마다 갈리고 곧 hash가 갈린다.
   *
   * 여기서는 **한 웨이브 안에서** 큰 적(bounty 240, K가 커서 bountyPaid가 크게 쌓인다)을
   * 먼저 전부 죽여 슬롯을 반납시키고, 한참 뒤에 작은 적들을 스폰해 그 슬롯을 물려받게
   * 한다. 물려받은 지급 이력이 안 지워졌다면 그 적들의 `floor(bounty × k/K) − bountyPaid`가
   * 영원히 음수라 **평생 0골드**가 되고, 여기서 즉시 걸린다.
   */
  it('풀 재사용 — 재활용된 슬롯의 새 적이 남의 지급 이력을 물려받지 않는다', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({
          spino: { hp: 600, bounty: 240, speed: 0.05 },
          compy: { hp: 60, bounty: 4, speed: 0.05 },
          raptor: { hp: 80, bounty: 8, speed: 0.05 },
        }),
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 60, range: 4, cooldownTicks: 3 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 500 }),
        waves: [
          wave([
            // 중앙값을 낮춰 spino의 K를 키운다 (= bountyPaid가 크게 쌓인다)
            { enemyId: 'compy', count: 9, intervalTicks: 1 },
            { enemyId: 'spino', count: 4, intervalTicks: 5 },
            // 앞의 것들이 다 죽어 풀에 반납된 뒤 스폰 — 그 슬롯을 물려받는다
            { enemyId: 'raptor', count: 12, intervalTicks: 3, delayTicks: 600 },
          ]),
        ],
      }),
    );
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 })).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 2500);
    expect(
      eventsOf(ev, 'enemyDied').filter((d) => d.defId === 'spino').length,
      '큰 적이 먼저 죽어 슬롯을 반납했어야 한다',
    ).toBe(4);
    const raptors = eventsOf(ev, 'enemyDied').filter((d) => d.defId === 'raptor');
    expect(raptors.length, '뒤이은 적이 실제로 죽었어야 한다').toBe(12);
    // 물려받았다면 goldNow가 0이 됐을 것이다
    for (const d of raptors) expect(paidFor(ev, d.enemyId), `적 ${d.enemyId}`).toBe(8);
  });

  it('DoT(화상·중독)도 지급 경로에 포함된다 — 같은 damageEnemy를 지나므로', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({
          spino: { hp: 2400, bounty: 240, speed: 0.05 },
          compy: { hp: 100, bounty: 4, speed: 0.05 },
        }),
        towerDefs: towerDefs({
          // dmg 1(거의 안 깎는다) + 강한 화상 → hp를 실제로 미는 것은 DoT다
          brazier: {
            tiers: [
              tier({
                dmg: 1,
                range: 4,
                cooldownTicks: 40,
                status: { kind: 'burn', magnitude: 60, durationTicks: 3000, chance: 1 },
              }),
            ],
          },
        }),
        deck: ['brazier'],
        stage: stageDef({ waveCount: 1, baseHp: 500 }),
        waves: [
          wave([
            { enemyId: 'compy', count: 9, intervalTicks: 1 },
            { enemyId: 'spino', count: 1 },
          ]),
        ],
      }),
    );
    expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: 4, cellZ: 1 })).toBe(true);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 3000);
    const burnHits = eventsOf(ev, 'enemyDamaged').filter((h) => h.source === 'burn');
    expect(burnHits.length, '화상이 실제로 들어갔어야 한다').toBeGreaterThan(10);
    const chunks = eventsOf(ev, 'bountyChunk').filter((c) => c.defId === 'spino');
    expect(chunks.length, 'DoT만으로도 몫이 나가야 한다').toBeGreaterThan(3);
    const died = eventsOf(ev, 'enemyDied').filter((d) => d.defId === 'spino');
    if (died.length > 0) expect(paidFor(ev, died[0]!.enemyId)).toBe(240);
  });
});

/**
 * K(몫 수) 자체의 성질 — 순수 산술이라 시뮬레이션 없이 잠근다.
 * 무한 모드는 `maxHp`와 `refHp`가 **같은** extraHpMul을 지므로 K가 불변이라는 것이
 * 이 설계가 1.06^n을 공짜로 따라가는 이유다.
 */
describe('살점 값 — 몫 수 K', () => {
  it('무한 모드(HP 1.06^n)에서 K가 불변이다 — 분자·분모가 같은 배율을 진다', () => {
    const cases: [number, number][] = [
      [37_998, 480], // s1 w50 trex
      [1_864, 240], // s1 w10 spino
      [1_004, 36], // s1 trike
      [87, 4], // compy
    ];
    for (const [hp, bounty] of cases) {
      const ref = 182; // s1 w50 기준 HP
      const base = bountyChunksFor(hp, bounty, ref);
      for (const n of [1, 10, 25, 50, 100]) {
        const mul = 1.06 ** n;
        const k = bountyChunksFor(Math.round(hp * mul), bounty, Math.round(ref * mul));
        // 반올림 오차 ±1 안에서 같아야 한다 (round가 양쪽에 걸린다)
        expect(Math.abs(k - base), `hp=${hp} n=${n}: ${k} vs ${base}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('두 상한이 실제로 듣는다 — 잡몹은 K=1로 접혀 오늘과 같은 경로를 탄다', () => {
    // 덩치 상한: 표준 사냥감과 같은 크기면 1
    expect(bountyChunksFor(100, 240, 100)).toBe(1);
    // 골드 상한: 한 몫이 BOUNTY_CHUNK_MIN_GOLD 밑으로 안 내려간다
    expect(bountyChunksFor(100_000, 8, 10)).toBe(Math.floor(8 / BOUNTY_CHUNK_MIN_GOLD));
    expect(bountyChunksFor(100_000, 4, 10)).toBe(1); // compy = 한 입이 곧 한 마리
    // 절대 상한
    expect(bountyChunksFor(10_000_000, 480, 1)).toBe(BOUNTY_CHUNK_MAX);
    // 하한 — 어떤 입력에도 0이나 음수가 안 나온다 (0이면 나눗셈이 터진다)
    for (const hp of [0, 1, 7]) {
      for (const b of [1, 4, 480]) expect(bountyChunksFor(hp, b, 10_000)).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * 분할 검산 — 모든 (bounty, K) 조합에서 `Σ몫 + 잔액 == bounty`이고 몫이 전부 양수다.
   * 내림의 나머지가 사망 잔액에 흡수된다는 성질을 산술로 못박는다.
   * **생전 지급 할인(BOUNTY_CHUNK_LIVE_*)을 포함한** 실제 식을 그대로 쓴다.
   * (실제 스테이지 데이터 전수 검산은 구현 시 별도 스크립트로 돌렸고 불일치 0건이었다 —
   *  s1~s6 전 웨이브 × 전 종. 여기서는 그보다 넓은 조합을 잠근다.)
   *
   * ⚠ 루프 안에서 `expect`를 부르지 않는다 — 12,000조합 × K회면 수십만 번이라
   * 전체 스위트와 CPU를 다투면 기본 타임아웃에 걸린다. 어긋난 조합만 모아 한 번에 낸다.
   */
  it('분할 합계 == bounty, 모든 몫은 양수 정수다', () => {
    const bad: string[] = [];
    for (let bounty = 1; bounty <= 500; bounty++) {
      for (let K = 1; K <= BOUNTY_CHUNK_MAX; K++) {
        let paid = 0;
        for (let k = 1; k <= K - 1; k++) {
          const owed = Math.floor(
            (bounty * BOUNTY_CHUNK_LIVE_NUM * k) / (BOUNTY_CHUNK_LIVE_DEN * K),
          );
          const due = owed - paid;
          if (due < 0) bad.push(`b=${bounty} K=${K} k=${k}: 음수 지급 ${due}`);
          else if (due > 0) {
            if (!Number.isInteger(due)) bad.push(`b=${bounty} K=${K} k=${k}: 비정수 ${due}`);
            paid = owed;
          }
        }
        const rest = bounty - paid; // 사망 잔액
        if (rest <= 0) bad.push(`b=${bounty} K=${K}: 잔액이 ${rest} — 처치가 결말이 아니게 된다`);
        if (paid + rest !== bounty) bad.push(`b=${bounty} K=${K}: 합계 ${paid + rest} ≠ ${bounty}`);
      }
    }
    expect(bad.slice(0, 5).join(' / ')).toBe('');
  });
});

/**
 * ── 봉투 5번의 짝 ────────────────────────────────────────────────────────────
 * "수입이 매끄러워지면 방치 플레이도 돈이 쌓인다 — 그래도 져야 한다."
 *
 * `autoplay.test.ts`의 방치 항목은 `phase === 'lost'`와 `waveIndex ≤ 5`만 본다. 그 팔에서
 * **골드는 완전히 불활성 변수**다(그 봇은 `callWave` 외에 어떤 커맨드도 안 낸다). 곧
 * 봉투는 "돈이 얼마나 쌓였는가"에 대해 아무 선언도 하지 않는다 — 그 구멍을 여기서 메운다.
 *
 * 왜 필요한가: 방치 봇은 타워가 0이라 "깎는 주체가 없으니 지급도 없다"고 넘기기 쉬운데
 * **그건 틀렸다 — 홈타운이 쏜다**(`battle.updateHometown`이 조건 없이 매 틱 돈다).
 * 곧 살점 값 이후 방치 플레이의 수입은 원리상 0이 아니다. 그 몫이 판을 뒤집을 만큼
 * 커지면 봉투 5번의 뜻이 죽으므로, 여기서 **상한을 걸어 둔다.**
 */
describe('방치해도 여전히 진다 (봉투 5번의 골드 축)', () => {
  /** 봉투 5번과 **같은 국면** — 실제 스테이지1 데이터, 시드 7, 타워 0 (autoplay.test.ts:556) */
  const STAGE1_DECK: TowerId[] = ['spear', 'catapult', 'frost'];

  function runIdle(): { sim: BattleSim; events: SimEvent[] } {
    const { sim } = makeBotSim(1, 7, STAGE1_DECK);
    const events: SimEvent[] = [];
    sim.applyCommand({ type: 'callWave' });
    for (let i = 0; i < 30 * 60 * 8 && sim.state.phase !== 'lost'; i++) {
      sim.tick();
      if (sim.state.phase === 'prep') sim.applyCommand({ type: 'callWave' });
      events.push(...sim.drainEvents());
    }
    return { sim, events };
  }

  it('타워 0이면 여전히 웨이브 5 안에 진다 — 수입이 매끄러워져도', () => {
    const { sim, events } = runIdle();
    // 검증이 헛돌지 않는지 — 마을이 **실제로 쏜다**(battle.updateHometown은 조건 없이 매 틱
    // 돈다). 곧 "타워가 0이니 깎는 주체가 없어 지급도 없다"는 틀린 전제이고, 이 팔에서도
    // 살점 값의 지급 경로가 실제로 열려 있다는 것을 먼저 못박는다.
    const baseHits = eventsOf(events, 'enemyDamaged').filter((h) => h.source === 'hometown');
    expect(baseHits.length, '마을이 실제로 쐈어야 이 팔이 뜻이 있다').toBeGreaterThan(0);
    // ── 본체: 그래도 진다 ──
    expect(sim.state.phase, '방치했는데 안 졌다').toBe('lost');
    expect(sim.state.waveIndex).toBeLessThanOrEqual(5);
  }, 30_000);

  /**
   * 그리고 그 수입이 **판을 살 만큼은 아니어야** 한다.
   *
   * 봉투 5번의 봇은 `callWave` 말고 어떤 커맨드도 안 내므로 그 팔에서 골드는 완전히
   * 불활성이다 — 곧 위 항목은 골드가 얼마가 쌓이든 통과한다. 그 사실에 기대면
   * "수입이 매끄러워졌다"가 아무 제약 없이 커질 수 있으므로, 잣대를 결과가 아니라
   * **금액**에 따로 건다.
   *
   * 문턱의 뜻: 방치 플레이가 전투로 버는 돈이 **가장 싼 타워 한 기 값(창움막 T1 100골드)**
   * 을 못 넘는다. 넘는 순간 "방치해도 한 기는 세울 수 있다"가 되어 봉투 5번의 전제가
   * 무너진다. 이건 문턱 완화가 아니라 그 항목에 **없던 축을 더하는 것**이다.
   */
  it('방치 전투 수입이 가장 싼 타워 한 기(100골드) 값을 못 넘는다', () => {
    const { events } = runIdle();
    const fromCombat = combatGold(events);
    const chunks = eventsOf(events, 'bountyChunk');
    const msg =
      `전투 수입 ${fromCombat} (몫 ${chunks.length}건 = ${chunks.reduce((s, c) => s + c.gold, 0)}골드 · ` +
      `처치 ${eventsOf(events, 'enemyDied').length}마리)`;
    expect(fromCombat, msg).toBeLessThan(100);
  }, 30_000);
});

/** 이 파일이 실제 데이터를 안 쓰는 대신, 상수의 뜻이 흔들리면 알아채게 한다 */
describe('살점 값 — 상수의 뜻', () => {
  it('compy의 bounty가 한 몫의 하한이다 (MIN_GOLD = 가장 싼 사냥감 한 마리 값)', () => {
    const ids: EnemyId[] = ['compy'];
    expect(ids).toHaveLength(1);
    expect(BOUNTY_CHUNK_MIN_GOLD).toBe(4);
    // 곧 bounty 4짜리는 절대 안 쪼개진다 — 어떤 덩치여도
    expect(bountyChunksFor(1e9, 4, 1)).toBe(1);
  });
});
