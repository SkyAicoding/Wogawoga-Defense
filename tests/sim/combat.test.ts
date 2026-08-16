/** 데미지 파이프라인 — armor 최소1, shield 소진, 처치 골드, 기지 누수/패배 */
import { describe, expect, it } from 'vitest';
import type { BattleSim } from '@/data/types';
import { createBattle } from '@/sim/battle';
import { enemyDefs, eventsOf, options, runTicks, stageDef, tier, towerDefs, wave } from './fixtures';

function place(sim: BattleSim, x: number, z: number): void {
  expect(sim.applyCommand({ type: 'placeTower', handIndex: 0, cellX: x, cellZ: z })).toBe(true);
}

describe('combat', () => {
  it('armor 고정 감산 — 최소 1 데미지 보장', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { armor: 999, hp: 3 } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1); // 경로(z=2) 인접, 사거리 3
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const hits = eventsOf(ev, 'enemyDamaged').filter((e) => !e.shielded);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (const h of hits) expect(h.amount).toBe(1); // dmg 5 - armor 999 → 최소 1
    expect(eventsOf(ev, 'enemyDied')).toHaveLength(1);
  });

  /**
   * ── 살점 값 이후의 재유도 (문턱 완화가 아니라 **강화**다) ────────────────────
   * 예전 단언은 `goldChanged.delta === 5`인 **단건 존재**였다. 목 fixture의 bounty가 5라
   * `bountyChunksFor(10, 5, 10)` = min(덩치 1, 골드 1, 24) = **1**이 되어 지금도 그대로
   * 통과한다 — 곧 이 항목은 **접힌 채로 아무것도 안 잡는 상태**가 됐다.
   * 그래서 잣대를 "단건이 있다"에서 **"전투로 들어온 총액이 정확히 bounty다"**로 옮긴다.
   * 단건 존재보다 강한 선언이고, 나중에 누가 BOUNTY_CHUNK_MIN_GOLD를 만져 이 적이
   * 쪼개지기 시작하면 그때는 총액으로 계속 검사한다(살점 값의 총량 보존이 곧 이 항목이다).
   */
  it('처치 시 bounty 골드 지급 — 총액이 정확히 bounty다', () => {
    const sim = createBattle(
      options({
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const died = eventsOf(ev, 'enemyDied');
    expect(died).toHaveLength(1);
    expect(died[0]?.bounty).toBe(5);
    // 이 적에게 전투로 들어온 총액 = 진행 지급(몫) 합계 + 사망 잔액. 정확히 bounty여야 한다.
    const id = died[0]?.enemyId;
    const chunks = eventsOf(ev, 'bountyChunk').filter((c) => c.enemyId === id);
    const total = chunks.reduce((s, c) => s + c.gold, 0) + (died[0]?.goldNow ?? 0);
    expect(total).toBe(5);
    // 이 fixture는 K=1이라 아직 안 쪼개진다 — 그 사실도 함께 못박는다
    expect(chunks).toHaveLength(0);
    expect(died[0]?.goldNow).toBe(5);
  });

  it('shield — 피해 무효 2회(shielded 이벤트) 후 실피해', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ warrior: { shieldHits: 2, hp: 10 } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ enemyId: 'warrior', count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const hits = eventsOf(ev, 'enemyDamaged');
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits[0]?.shielded).toBe(true);
    expect(hits[0]?.amount).toBe(0);
    expect(hits[1]?.shielded).toBe(true);
    expect(hits[2]?.shielded).toBe(false);
    expect(hits[2]?.amount).toBe(5); // armor 0 → 원래 데미지
    expect(eventsOf(ev, 'enemyDied')).toHaveLength(1);
  });

  it('기지 누수 — baseDamaged 누적, 0 이하면 패배', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { speed: 3 } }),
        stage: stageDef({ waveCount: 1, baseHp: 3 }),
        waves: [wave([{ count: 3, intervalTicks: 10 }])],
      }),
    );
    sim.applyCommand({ type: 'callWave' }); // 타워 없음 → 전부 누수
    const ev = runTicks(sim, 300);
    const leaks = eventsOf(ev, 'enemyLeaked');
    expect(leaks).toHaveLength(3);
    const base = eventsOf(ev, 'baseDamaged');
    expect(base.map((b) => b.hpLeft)).toEqual([2, 1, 0]);
    const ended = eventsOf(ev, 'battleEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.won).toBe(false);
    expect(sim.state.phase).toBe('lost');
  });
});

/**
 * 거울 규칙 — 가죽🟫과 흩어짐〽 (docs/counter-plan.md 2단계).
 * 여기서 잠그는 것은 **규칙의 모양**이지 수치가 아니다(수치는 enemies.ts 주석의 실측이
 * 근거이고, 봉투가 따로 잰다). 규칙이 흔들리면 그 실측 전부가 의미를 잃는다.
 */
describe('가죽 · 흩어짐', () => {
  it('가죽은 타격당 상한이다 — 한 방이 아무리 커도 round(maxHp × hide)를 못 넘는다', () => {
    const sim = createBattle(
      options({
        // hp 100 · hide 0.2 → 상한 20. 창 dmg를 999로 키워도 20씩만 들어간다
        enemyDefs: enemyDefs({ raptor: { hp: 100, hide: 0.2, armor: 0 } }),
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 999, range: 3 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const hits = eventsOf(ev, 'enemyDamaged').filter((e) => !e.shielded);
    // 죽이는 데 정확히 5대 — 곧 "최소 타격 횟수 = 1/hide"가 약속대로 성립한다
    expect(hits).toHaveLength(5);
    for (const h of hits) expect(h.amount).toBe(20);
    expect(eventsOf(ev, 'enemyDied')).toHaveLength(1);
  });

  it('가죽 상한은 **최대 HP** 기준이라 체력이 닳아도 그대로다 (= 최소 타격 횟수가 상수)', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { hp: 100, hide: 0.25, armor: 0 } }),
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 999, range: 3 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const hits = eventsOf(ev, 'enemyDamaged').filter((e) => !e.shielded);
    expect(hits).toHaveLength(4); // 25씩 네 번. 남은 체력에 비례했다면 무한히 안 죽는다
    for (const h of hits) expect(h.amount).toBe(25);
  });

  it('가죽에 안 걸리는 작은 타격은 한 자리도 안 변한다 (연사 타워 무손실)', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { hp: 100, hide: 0.2, armor: 0 } }), // 상한 20
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 12, range: 3 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const ev = runTicks(sim, 600);
    const hits = eventsOf(ev, 'enemyDamaged').filter((e) => !e.shielded);
    for (const h of hits) {
      expect(h.amount).toBe(12);
      expect(h.mitigated).toBeUndefined(); // 안 깎였으면 부호도 안 붙는다
    }
  });

  it('흩어짐은 **폭발에만** 걸린다 — 직격(창)은 면제다', () => {
    const mk = (splashResist?: number): BattleSim =>
      createBattle(
        options({
          enemyDefs: enemyDefs({
            raptor: { hp: 10_000, armor: 0, ...(splashResist !== undefined ? { splashResist } : {}) },
          }),
          towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 100, range: 3 })] } }),
          stage: stageDef({ waveCount: 1, baseHp: 50 }),
          waves: [wave([{ count: 1 }])],
        }),
      );
    for (const r of [undefined, 0.5]) {
      const sim = mk(r);
      place(sim, 4, 1);
      sim.applyCommand({ type: 'callWave' });
      const hits = eventsOf(runTicks(sim, 200), 'enemyDamaged').filter((e) => !e.shielded);
      expect(hits.length).toBeGreaterThan(0);
      // 창은 homing 직격이라 splash 플래그가 안 붙는다 → 저항이 있어도 100 그대로
      for (const h of hits) expect(h.amount, `splashResist=${String(r)}`).toBe(100);
    }
  });

  it('흩어짐은 폭발 피해를 비율로 깎는다 (투석기 = 유일한 ballistic+splash)', () => {
    const mk = (splashResist?: number): BattleSim =>
      createBattle(
        options({
          enemyDefs: enemyDefs({
            raptor: { hp: 10_000, armor: 0, ...(splashResist !== undefined ? { splashResist } : {}) },
          }),
          towerDefs: towerDefs({
            catapult: {
              attackKind: 'ballistic',
              canTargetAir: false,
              tiers: [tier({ dmg: 100, range: 3, projectileSpeed: 20, splash: { radius: 1.5, falloff: 0.4 } })],
            },
          }),
          deck: ['catapult'],
          stage: stageDef({ waveCount: 1, baseHp: 50 }),
          waves: [wave([{ count: 1 }])],
        }),
      );
    const amountOf = (r?: number): number => {
      const sim = mk(r);
      place(sim, 4, 1);
      sim.applyCommand({ type: 'callWave' });
      const hits = eventsOf(runTicks(sim, 300), 'enemyDamaged').filter((e) => !e.shielded);
      expect(hits.length, `splashResist=${String(r)}`).toBeGreaterThan(0);
      return hits[0]!.amount;
    };
    const full = amountOf(undefined);
    const cut = amountOf(0.5);
    expect(cut / full).toBeCloseTo(0.5, 6);
  });

  it('mitigated는 가장 크게 깎은 축 하나만 싣는다 (배지 하나 규칙과 같은 잣대)', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { hp: 1000, hide: 0.02, armor: 0 } }), // 상한 20
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 200, range: 3 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const hits = eventsOf(runTicks(sim, 300), 'enemyDamaged').filter((e) => !e.shielded);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.amount).toBe(20);
      expect(h.mitigated).toBe('hide'); // 200 → 20, 90%를 가죽이 먹었다
    }
  });

  it('필드가 없으면 새 분기는 no-op이다 (되돌리기가 데이터 2줄이라는 계약)', () => {
    const sim = createBattle(
      options({
        enemyDefs: enemyDefs({ raptor: { hp: 500, armor: 3 } }), // hide/splashResist 둘 다 없음
        towerDefs: towerDefs({ spear: { tiers: [tier({ dmg: 50, range: 3 })] } }),
        stage: stageDef({ waveCount: 1, baseHp: 50 }),
        waves: [wave([{ count: 1 }])],
      }),
    );
    place(sim, 4, 1);
    sim.applyCommand({ type: 'callWave' });
    const hits = eventsOf(runTicks(sim, 300), 'enemyDamaged').filter((e) => !e.shielded);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.amount).toBe(47); // 50 − armor 3, 그 이상도 이하도 아니다
  });
});
