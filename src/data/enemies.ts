/**
 * 적 16종 정의 — hp는 스테이지1 웨이브1 기준(웨이브젠이 hpMul 적용).
 * bounty = round(cost × 0.8) 규칙 고정 (tests/data가 잠근다).
 * cost는 웨이브젠 예산 소비 단위이자 전투력 지표.
 *
 * ── 부족 습격대 4종 (blade/lancer/archer/hexer) ────────────────────────────
 * 공룡·짐승과 달리 **기지가 아니라 우리 타워를 노리는 무리**다. 역할 분리:
 *  · warrior(기존) = 방패로 버티며 기지로 직행하는 탱커, shaman(기존) = 힐러.
 *    둘은 "웨이브를 끝까지 살아서 통과시키는" 쪽이고,
 *  · 습격대 4종은 "지나가며 방어선을 허무는" 쪽이다 — 그래서 hp/cost 효율이
 *    일부러 나쁘다(2.5~4.8, 공룡은 5~9.3). 이들의 전투력은 체력이 아니라
 *    타워에 넣는 피해에 들어 있고, cost가 그만큼을 대신 지불한다.
 *
 * 사거리 규약(siege.ts 규칙 4와 짝):
 *  · 근접(blade 1.5 / lancer 1.95)은 stopToAttack=true — 경로 옆 한 칸에만 닿는다.
 *    lancer가 0.45 더 긴 건 "한 걸음 뒤에서 찌른다"를 화면에서 읽히게 하되
 *    2.0(두 칸)은 넘지 않아 '경로에 붙여 지은 타워만 위험' 규칙을 깨지 않는다.
 *  · 원거리(archer 3.2 / hexer 3.6)는 걸으면서 쏜다 — 멈추면 전선이 정체된다.
 */
import type { EnemyDef, EnemyId } from './types';

/** bounty 규칙 상수 — 웨이브젠 예산 대비 골드 환류율 */
export const BOUNTY_PER_COST = 0.8;

export const ENEMY_DEFS: Record<EnemyId, EnemyDef> = {
  raptor: {
    id: 'raptor',
    nameKey: 'enemy.raptor',
    hp: 60,
    speed: 1.6,
    armor: 0,
    flying: false,
    bounty: 8,
    baseDamage: 1,
    radius: 0.3,
    cost: 10,
  },
  compy: {
    id: 'compy',
    nameKey: 'enemy.compy',
    hp: 25,
    speed: 1.9,
    armor: 0,
    flying: false,
    bounty: 4,
    baseDamage: 1,
    radius: 0.22,
    cost: 5,
  },
  trike: {
    id: 'trike',
    nameKey: 'enemy.trike',
    hp: 420,
    speed: 0.7,
    armor: 4,
    flying: false,
    bounty: 36,
    baseDamage: 2,
    radius: 0.52,
    cost: 45,
  },
  ptera: {
    id: 'ptera',
    nameKey: 'enemy.ptera',
    hp: 90,
    speed: 1.4,
    armor: 0,
    flying: true,
    bounty: 14,
    baseDamage: 1,
    radius: 0.32,
    cost: 18,
  },
  ankylo: {
    id: 'ankylo',
    nameKey: 'enemy.ankylo',
    hp: 300,
    speed: 0.6,
    armor: 10,
    flying: false,
    bounty: 32,
    baseDamage: 2,
    radius: 0.48,
    cost: 40,
  },
  boar: {
    id: 'boar',
    nameKey: 'enemy.boar',
    hp: 150,
    speed: 1.1,
    armor: 0,
    flying: false,
    bounty: 18,
    baseDamage: 1,
    radius: 0.38,
    // 저체력 격노 — 40% 이하에서 1.8배 가속
    enrage: { hpPct: 0.4, speedMul: 1.8 },
    cost: 22,
  },
  warrior: {
    id: 'warrior',
    nameKey: 'enemy.warrior',
    hp: 120,
    speed: 1.0,
    armor: 0,
    // 방패 — 첫 3회 피격 무시
    shieldHits: 3,
    flying: false,
    bounty: 24,
    baseDamage: 1,
    radius: 0.34,
    // 타워 공격 — 사거리 1.5는 "경로 바로 옆 8방향 한 칸"에 정확히 닿는 값이다
    // (대각 1.414 < 1.5, 두 칸 2.0 > 1.5). dmg 10 / 1초 = 혼자서는 T1(260) 하나에 26초.
    towerAttack: { dmg: 10, range: 1.5, cooldownTicks: 30, stopToAttack: true, ranged: false },
    // 25 → 30: 1단계에서 공짜로 얻은 towerAttack(10dps) 값을 웨이브젠 예산에 반영한다.
    // 방패 3회 + 타워 파괴력을 함께 가진 유닛이 blade(20)보다 싸면 예산 곡선이 밀린다.
    cost: 30,
  },
  shaman: {
    id: 'shaman',
    nameKey: 'enemy.shaman',
    hp: 100,
    speed: 0.9,
    armor: 0,
    flying: false,
    bounty: 24,
    baseDamage: 1,
    radius: 0.34,
    // 주변 힐 — 반경 2, 0.5초마다 hpPerStatusTick × 시전자 hpMul 회복 (자신 제외).
    // hpMul 스케일 덕에 중후반 웨이브에서도 힐러 메커니크가 유효하다 (sim/status.ts).
    healAura: { radius: 2, hpPerStatusTick: 8 },
    cost: 30,
  },
  // --- 부족 습격대 ---------------------------------------------------------
  blade: {
    id: 'blade',
    nameKey: 'enemy.blade',
    // 습격대의 기준점 — 체력 보통, 발 빠름, 붙으면 제일 빨리 두들긴다.
    hp: 85,
    speed: 1.2,
    armor: 0,
    flying: false,
    bounty: 16,
    baseDamage: 1,
    radius: 0.26,
    // 8 / 0.667초 = 12 dps. warrior(10)보다 빠른 손놀림이지만 한 대는 더 약하다 —
    // 부수는 속도가 아니라 "붙는 속도"가 이 종의 정체성이다(speed 1.2).
    // 6명이 붙으면 T1(260)이 3.6초 — 한 명은 위협이 아니고 무리여야 위협이 된다.
    towerAttack: { dmg: 8, range: 1.5, cooldownTicks: 20, stopToAttack: true, ranged: false },
    cost: 20,
  },
  lancer: {
    id: 'lancer',
    nameKey: 'enemy.lancer',
    // 방어형 = 장갑 3. 방패(shieldHits)는 warrior의 정체성이라 겹치지 않게 armor로 준다.
    // 저티어 다단히트 타워(spear 12, poison)가 유독 힘겨워지는 상성이 생긴다.
    hp: 135,
    speed: 0.95,
    armor: 3,
    flying: false,
    bounty: 22,
    baseDamage: 1,
    radius: 0.28,
    // 15 / 1.2초 = 12.5 dps. blade와 dps는 비슷하지만 사거리가 0.45 길어
    // **blade가 못 닿는 자리의 타워**에 닿는다 — 무리에 섞이면 방어선이 한 칸 밀린다.
    towerAttack: { dmg: 15, range: 1.95, cooldownTicks: 36, stopToAttack: true, ranged: false },
    cost: 28,
  },
  archer: {
    id: 'archer',
    nameKey: 'enemy.archer',
    // 유리대포 — 습격대 중 가장 무르다. 스플래시/둔화 한 방에 무리째 정리된다.
    hp: 65,
    speed: 1.05,
    armor: 0,
    flying: false,
    bounty: 21,
    baseDamage: 1,
    radius: 0.24,
    /**
     * 습격대에서 **유일하게 잘 지은 타워에 닿는 종**이라 화력을 여기 몰아줬다.
     *
     * 근접(칼 1.5 / 창 1.95)은 경로에서 두 칸 떨어뜨리는 것만으로 영구히 무력화된다 —
     * 타워 좌표가 셀 정수라 2.0이 확정 안전선이고, 대부분의 타워는 사거리 2.4~5.5라
     * 거기서도 경로를 덮는다. 3단계 실측에서 **칼잡이 108명의 타워 피해 총합이 0**이었다.
     * 즉 근접만으로는 "부수는 적"이라는 기능이 잘 두는 플레이어에게 존재하지 않는다.
     * 사거리 3.2는 그 안전선(2.0)을 넘으므로, 궁수는 **거리로 풀 수 없는 압박**이고
     * 해답이 배치가 아니라 **대응(먼저 잡기)** 이 된다.
     *
     * 11 / 1.33초 = 8.25 dps. 근접(12~12.5)보다는 낮게 유지해 "부수는 건 칼과 창"이라는
     * 서열은 지킨다 — 궁수의 값은 한 방이 아니라 **멈추지 않는다**는 데 있다.
     * 경로를 지나가는 내내 사거리 안의 타워를 갉으므로 한 명이 한 판에 넣는 피해는
     * 근접보다 크다.
     *
     * 값은 실측으로 잡았다. 아래는 **보상 상한(wavegen.capBounty) 도입 이후** 재측정한
     * 스테이지1 스윕이다(시드 20개, 덱 spear+catapult+frost, 별 0):
     *   dmg  7 → 20/20승 · 기지HP합 197 · 판당 파괴 5.2기 · 손실골드 3,843
     *   dmg  9 → 18/20승 · 180 · 6.9기 · 5,144
     *   dmg 11 → 15/20승 · 171 · 8.8기 · 6,571   ← 채택
     *   dmg 13 → 16/20승 · 133 · 11.9기 · 8,815
     * 7은 "있으나 마나"(파괴 5기는 궁수 없이도 나오는 수준)이고, 13은 승수는 비슷한데
     * 여유(기지HP)와 골드만 22~34% 더 태운다 — 난이도가 아니라 마모만 늘린다.
     * 11이 "확실히 아프지만 초심자 스테이지는 여전히 대체로 완주 가능"의 경계다.
     */
    towerAttack: { dmg: 11, range: 3.2, cooldownTicks: 40, stopToAttack: false, ranged: true },
    // 22 → 26: 타워 피해가 +57% 오른 만큼 웨이브젠 예산 단가를 올린다.
    // (안 올리면 습격대 편성이 같은 예산으로 훨씬 강해져 난이도 곡선이 밀린다)
    cost: 26,
  },
  hexer: {
    id: 'hexer',
    nameKey: 'enemy.hexer',
    hp: 85,
    speed: 0.85,
    armor: 0,
    flying: false,
    bounty: 27,
    baseDamage: 1,
    radius: 0.26,
    /**
     * 역할 = **침묵(저주)**. 단순 딜러가 아니라 습격대의 열쇠다.
     *
     * 왜 침묵인가 (다른 후보를 버린 이유):
     *  · '주변 아군 강화'는 shaman(힐 오라)과 같은 서포터 축이라 역할이 겹친다.
     *  · '광역 피해'는 결국 숫자만 큰 딜러다 — 플레이어가 할 일이 안 바뀐다.
     *  · 침묵은 이 게임의 유일한 자원인 **타워의 발사 시간**을 직접 빼앗는다.
     *    저주에 걸린 타워는 살아 있는데도 아무것도 못 하므로, 근접이 그 사이 두들긴다 —
     *    "먼저 주술사를 잡을 것인가, 두들기는 칼잡이를 잡을 것인가"라는 표적 선택이 생긴다.
     *    화면에서도 즉시 읽힌다(타워가 조용해지고 보랏빛 룬이 돈다).
     *
     * 수치: 침묵 30틱(1초) / 쿨다운 60틱(2초) = **정확히 절반**.
     * 침묵 중에는 쿨다운도 얼어붙으므로(attack.ts) 잃는 화력이 곧 침묵 시간과 같다 —
     * "주술사 한 명이 붙으면 그 타워는 절반만 일한다"로 딱 떨어지고,
     * 쏘다-멈추다를 반복하므로 무슨 일이 일어나는지가 화면에서 보인다.
     * 중첩되지 않고 max 갱신이라(siege.applySilence) 여럿이 와도 영구 봉쇄는 없다 —
     * 대신 사거리 3.6 안에 계속 머물러야 하므로 결국 처리하면 풀린다.
     * 직접 피해 6/2초 = 3 dps로 습격대 최저 — 부수는 건 어디까지나 칼과 창이다.
     */
    towerAttack: {
      dmg: 6,
      range: 3.6,
      cooldownTicks: 60,
      stopToAttack: false,
      ranged: true,
      silenceTicks: 30,
    },
    cost: 34,
  },
  mammoth: {
    id: 'mammoth',
    nameKey: 'enemy.mammoth',
    hp: 900,
    speed: 0.5,
    armor: 6,
    flying: false,
    bounty: 72,
    baseDamage: 3,
    radius: 0.62,
    cost: 90,
  },
  spino: {
    id: 'spino',
    nameKey: 'enemy.spino',
    hp: 2600,
    // 미니보스는 느리고 장갑은 온건하게 — T1~T2 타워로도 집중 사격하면 잡히도록
    speed: 0.5,
    armor: 4,
    flying: false,
    boss: true,
    bounty: 240,
    baseDamage: 5,
    radius: 0.7,
    cost: 300,
  },
  trex: {
    id: 'trex',
    nameKey: 'enemy.trex',
    hp: 6000,
    speed: 0.45,
    armor: 8,
    flying: false,
    boss: true,
    bounty: 480,
    baseDamage: 10,
    radius: 0.8,
    cost: 600,
  },
  golem: {
    id: 'golem',
    nameKey: 'enemy.golem',
    hp: 800,
    speed: 0.55,
    armor: 12,
    flying: false,
    bounty: 88,
    baseDamage: 2,
    radius: 0.5,
    cost: 110,
  },
};

export const ALL_ENEMY_IDS = Object.keys(ENEMY_DEFS) as EnemyId[];
