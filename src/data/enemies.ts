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
 * ── 사거리·정지 규약 (siege.ts 규칙 4와 짝) ────────────────────────────────
 * **습격대 4종 + warrior는 전부 원거리이고, 전부 공격 가능 지점에서 멈춰 선다.**
 * 근접(옛 blade 1.5 / lancer 1.95)을 버린 이유는 밸런스가 아니라 기능 부재다 —
 * 아래 archer 주석의 실측("칼잡이 108명의 타워 피해 총합 0")이 근거다.
 *
 * 네 축으로 종을 가른다. 어느 하나도 두 종이 같지 않다:
 *   사거리   blade 2.4 < lancer 2.8 < archer 3.2 < hexer 3.6
 *   버티는 시간 lancer 90 > blade·archer 75 > hexer 60   (holdTicks)
 *   한 방 대 연사 lancer 6/36틱(무겁게 드물게) ↔ blade 3/20틱(가볍게 자주)
 *   특수      blade 발 빠름 1.20 / lancer 장갑 3 / archer 유리몸 65 / hexer 침묵
 *
 * 정지 거리는 종별 취향이 아니라 판의 기하가 정하는 공통값 SIEGE_ENGAGE_RANGE(1.7)이고
 * 거기에 towerReach 상한이 걸린다(규칙 4-a) — 그래서 사거리를 늘려도 "타워 사거리 밖에서
 * 일방적으로 두들기기"는 불가능하다. 사거리가 사는 것은 **정지 지점에 도달하기 전에
 * 걸으며 쏘는 구간의 길이**와 **닿는 타워의 범위**뿐이다.
 *
 * 한 방 피해가 옛 값의 1/3 수준으로 내려간 이유: 옛 수치는 "스쳐 지나가며 한두 대"를
 * 전제로 매겨졌는데, 이제는 정지 구간에서 쿨다운마다 꼬박꼬박 넣는다.
 * (blade 8→2 · lancer 15→5 · archer 11→4 · hexer 6→2 · warrior 10→3)
 *
 * ── 10단계(밸런스): blade 2→3 · lancer 5→6 · archer 4→5 ────────────────────
 * 9단계의 위 값들은 "정지선 2.1 = 이격 2칸 타워도 붙잡힌다"는 세계에서 매겨졌다.
 * 정지선을 1.7로 내려 **이격 2칸이 다시 안전해지자**(balance.SIEGE_ENGAGE_RANGE 주석)
 * 잘 둔 방어선이 받는 피해가 절반 아래로 떨어졌고(파괴 211→116기), 그만큼을
 * 되돌려 받은 것이 이 세 값이다. 셋 다 **거리 축을 되살린 뒤에** 잰 값이라
 * 9단계가 "어느 배율에서도 밀착 봇이 안 무너진다"고 적은 벽에 걸리지 않는다.
 * 종별 근거는 각 towerAttack 주석에 있다. hexer 2 / warrior 3은 그대로다 —
 * hexer는 침묵이 본체이고(직접 피해는 전 종 최저라는 자리 유지), warrior는
 * 습격대가 아니라 탱커라 습격대 하단(hexer 1.0 ~ lancer 5.0) 안에 있으면 된다.
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
    /**
     * 타워 공격 — **습격대는 아니지만 타워를 때리는 종**이라 개편 대상에 들어간다.
     * (사용자의 "남은 애들도 모두"를 *타워를 때리는 적 전부*로 읽었다. 근거는
     *  siege.ts 규칙 1 — 타워를 때리지 않는 공룡·짐승 11종에게 towerAttack을 새로
     *  주는 것은 요청에 없는 새 메커니즘이고, '경로 옆 타워만 위험'을 통째로 깬다)
     *
     * 다만 **습격대 등급은 주지 않는다**. warrior의 정체성은 방패로 버티며 기지로
     * 직행하는 탱커라, 사거리·정지 시간을 습격대만큼 주면 전선에서 멈춰 서느라
     * 기지에 못 간다. 사거리 2.2는 전 종 최단이고(습격대 하단 blade 2.4보다 짧다)
     * holdTicks 45도 전 종 최단이다 — 규칙 4는 물리되 가장 얕게 문다.
     * (9단계에는 이 값이 'SIEGE_ENGAGE_RANGE(2.1)를 겨우 넘긴 최소치'라고 적혀 있었다.
     *  정지선이 1.7이 된 지금은 2.2가 그 최소치가 아니지만, 값을 바꿀 이유도 없다 —
     *  사거리 서열의 맨 아래라는 자리가 이 종이 사는 것이기 때문이다)
     *
     * 개편은 오히려 warrior의 전진을 **덜** 막는다: 옛 규칙에서는 사거리 1.5 안의
     * 타워가 부서질 때까지 무한정 서 있었지만, 이제는 45틱이면 반드시 다시 걷는다.
     * 3 / 1초 = 3dps로 습격대 하단(hexer 1.0 ~ lancer 5.0) 안이다.
     */
    towerAttack: {
      dmg: 3,
      range: 2.2,
      cooldownTicks: 30,
      stopToAttack: true,
      holdTicks: 45,
      ranged: true,
    },
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
    // 습격대의 기준점 — 체력 보통, 발 빠름, 제일 먼저 도착해 제일 빨리 던진다.
    hp: 85,
    speed: 1.2,
    armor: 0,
    flying: false,
    bounty: 16,
    baseDamage: 1,
    radius: 0.26,
    /**
     * **투창병** — 짧은 창을 연달아 던진다. 습격대의 기준선이자 최단 사거리(2.4)다.
     * 3 / 0.667초 = 4.5 dps. 간격이 전 종 최소라, 정지 구간에서 holdTicks 75 동안
     * 4발을 넣는다(가장 자주 손이 움직이는 종 = 화면에서 제일 바쁘다).
     * 부수는 속도가 아니라 **붙는 속도**가 정체성이다(speed 1.20, 전 종 최속).
     *
     * ── 10단계: dmg 2 → 3 (정지선 1.7 위에서 다시 잰 값) ─────────────────
     * 이 종이 **거리 축의 판별자**다. 사거리가 2.4로 가장 짧아 이격 1칸과 2칸의
     * 노출 길이 차가 제일 크고(2·√(2.4²−1²)=4.36 대 2·√(2.4²−2²)=2.65, 1.65배),
     * 정지선이 1.7로 내려간 뒤에는 **1칸 타워만** 그 앞에 세운다.
     * 즉 blade의 dmg는 "밀착에 매기는 벌금"의 크기 그 자체다.
     * 실측(스테이지1 · 시드 20 · 덱 spear+catapult+frost · lancer 6 · archer 5 고정,
     * 안전 봇 승수 / 밀착 봇 승수 / 밀착 봇 '웨이브15+ 최소 타워 수' 합):
     *   dmg 2 → 18 / 3 / 160(=상한, 방어선이 안 무너진다)
     *   dmg 3 → 15 / 2 / 153 (최소 2기까지 떨어진다)   ← 채택
     *   dmg 4 →  8 / 1 / 155  (안전 봇까지 무너져 완주 하한 13을 깬다)
     *   dmg 5 →  6 / 1 / 140
     * 3이 "밀착 방어선은 무너지고 이격 방어선은 버틴다"가 처음 성립하는 값이다.
     * dps는 3 / 0.667초 = 4.5로 lancer(5.0) 다음이다 — 연사 담당이라는 자리는 그대로.
     */
    towerAttack: {
      dmg: 3,
      range: 2.4,
      cooldownTicks: 20,
      stopToAttack: true,
      holdTicks: 75,
      ranged: true,
    },
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
    /**
     * **큰창잡이** — 무거운 장창을 한 발씩 던진다. 습격대 최대 단발(6)이자 최장 정지(90).
     * 6 / 1.2초 = 5.0 dps로 dps도 최고지만, 그 값은 **버티는 시간**으로 산 것이다:
     * holdTicks 90은 전 종 최장이라 타워 사거리 안에 가장 오래 서 있는다(규칙 4-a).
     * 장갑 3까지 있어 그 시간을 버틸 수 있는 유일한 종이고, 반대로 다단히트 타워
     * (spear 12, poison)에게는 유독 약하다.
     * blade와 같은 '창'이지만 사거리 0.4가 더 길어 **blade가 못 닿는 자리**에 닿는다.
     */
    // 10단계: 5 → 6. 스테이지1에는 lancer가 없어(allowedEnemies) 여기서 직접 잴 수
    // 없다. **blade 2→3(dps 4.5)에 맞춰 "lancer가 dps 최고"라는 서열을 지키는**
    // 최소 조정이고, 그 이상 올리지 않았다 — 잴 수 없는 값은 흔들지 않는다.
    towerAttack: {
      dmg: 6,
      range: 2.8,
      cooldownTicks: 36,
      stopToAttack: true,
      holdTicks: 90,
      ranged: true,
    },
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
     * **궁수** — 활을 당겨 쏜다. 사거리 3.2로 습격대 상위이고 holdTicks 75.
     * 4 / 1.33초 = 3 dps.
     *
     * 이 종의 값은 여전히 **거리**에 있다. 정지 지점은 전 종 공통 1.7이지만,
     * 사거리 3.2 덕에 1.7까지 걸어 들어오는 동안 1.5타일을 걸으며 쏘고,
     * 무엇보다 **경로에서 3칸 떨어진 타워**에 닿는다 — 전위(blade 2.4 / lancer 2.8)가
     * 못 닿는 자리다. 이격만으로 궁수를 지우려면 4칸까지 물러나야 하고,
     * 그러면 대부분의 타워가 경로를 덮지 못한다(raiddefense.test.ts가 이 대가를 잠근다).
     *
     * ── 아래는 **개편 전 근접 시절의 실측**이다. 이번 개편의 근거이므로 보존한다 ──
     * 근접(칼 1.5 / 창 1.95)은 경로에서 두 칸 떨어뜨리는 것만으로 영구히 무력화된다 —
     * 타워 좌표가 셀 정수라 2.0이 확정 안전선이고, 대부분의 타워는 사거리 2.4~5.5라
     * 거기서도 경로를 덮는다. 3단계 실측에서 **칼잡이 108명의 타워 피해 총합이 0**이었다.
     * 즉 근접만으로는 "부수는 적"이라는 기능이 잘 두는 플레이어에게 존재하지 않는다.
     * 사거리 3.2는 그 안전선(2.0)을 넘으므로, 궁수는 **거리로 풀 수 없는 압박**이고
     * 해답이 배치가 아니라 **대응(먼저 잡기)** 이 된다.
     *
     * 개편 전 값은 dmg 11 / 사거리 3.2 / stopToAttack=false 였고, 아래 스윕으로 잡았다
     * (보상 상한 도입 이후 재측정, 스테이지1 시드 20개, 덱 spear+catapult+frost, 별 0):
     *   dmg  7 → 20/20승 · 기지HP합 197 · 판당 파괴 5.2기 · 손실골드 3,843
     *   dmg  9 → 18/20승 · 180 · 6.9기 · 5,144
     *   dmg 11 → 15/20승 · 171 · 8.8기 · 6,571   ← 당시 채택
     *   dmg 13 → 16/20승 · 133 · 11.9기 · 8,815
     * 이 스윕은 "걸으며 쏘느라 사거리 구간을 지나가는 동안만 쏜다"를 전제로 한 값이라
     * 정지 사격 개편 뒤에는 그대로 쓸 수 없다 — 같은 한 마리가 훨씬 많이 쏘기 때문이다.
     * 그래서 9단계가 4로 내렸고, 그 값을 **잠정치**라고 명시했다.
     *
     * ── 10단계: 4 → 5 (잠정치 해소. 정지선 1.7 위에서 다시 잰 값) ──────────
     * 재측정을 미룬 9단계의 이유("난이도 봉투가 함께 흔들려 원인을 분리할 수 없다")는
     * 정확했다 — 원인은 화력이 아니라 **정지선이 이격 2칸까지 붙잡고 있던 것**이었고,
     * 그걸 먼저 고치고 나서야 이 종의 화력을 단독으로 잴 수 있게 됐다.
     * archer만 움직인 스윕(스테이지1 · **시드 40** · 덱 spear+catapult+frost ·
     * blade 3 고정 · 안전 봇 / 밀착 봇):
     *   dmg  4 → 38/40 · 9/40   dmg  6 → 38/40 · 9/40   dmg  8 → 34/40 · 6/40
     *   dmg 10 → 25/40 · 6/40   dmg 12 → 16/40 · 4/40   dmg 14 →  6/40 · 4/40
     * 곡선이 8까지 거의 평평한 이유는 사거리에 있다: 3.2는 이격 1칸(커버 6.08타일)과
     * 2칸(5.00타일)의 노출 길이 차가 1.22배뿐이라 **거리로 갈리지 않는 화력**이다.
     * 그래서 이 종은 난이도 손잡이로 쓰지 않고, 아래 blade×archer 격자에서
     * "안전 봇이 옛 기준선(16/20)에 가장 가까운" 자리만 고른다 —
     * blade 3 기준 archer 4 → 16/20, **5 → 15/20**, 6 → 13/20(완주 하한과 동률).
     * 5가 옛 기준선에 가장 가까우면서 하한(13)에 여유 2를 남기는 값이다.
     * 5 / 1.33초 = 3.75 dps.
     */
    towerAttack: {
      dmg: 5,
      range: 3.2,
      cooldownTicks: 40,
      stopToAttack: true,
      holdTicks: 75,
      ranged: true,
    },
    // 22 → 26: 타워 피해가 +57% 오른 만큼 웨이브젠 예산 단가를 올린다.
    // (안 올리면 습격대 편성이 같은 예산으로 훨씬 강해져 난이도 곡선이 밀린다)
    // ⚠ cost는 난이도 손잡이가 아니다 — 웨이브젠이 총 HP를 정규화하므로 올리면
    //   머릿수가 준 만큼 개체가 튼튼해지고, avgCost를 통해 무관한 웨이브까지 흔든다.
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
     *    저주에 걸린 타워는 살아 있는데도 아무것도 못 하므로, 창잡이가 그 사이 두들긴다 —
     *    "먼저 주술사를 잡을 것인가, 던지는 투창병을 잡을 것인가"라는 표적 선택이 생긴다.
     *    화면에서도 즉시 읽힌다(타워가 조용해지고 보랏빛 룬이 돈다).
     *
     * 수치: 침묵 30틱(1초) / 쿨다운 60틱(2초) = **정확히 절반**.
     * 침묵 중에는 쿨다운도 얼어붙으므로(attack.ts) 잃는 화력이 곧 침묵 시간과 같다 —
     * "주술사 한 명이 붙으면 그 타워는 절반만 일한다"로 딱 떨어지고,
     * 쏘다-멈추다를 반복하므로 무슨 일이 일어나는지가 화면에서 보인다.
     * 중첩되지 않고 max 갱신이라(siege.applySilence) 여럿이 와도 영구 봉쇄는 없다 —
     * 대신 사거리 3.6 안에 계속 머물러야 하므로 결국 처리하면 풀린다.
     * 직접 피해 2/2초 = 1 dps로 습격대 최저 — 부수는 건 어디까지나 창이다.
     *
     * holdTicks 60은 **전 종 최단**이다(warrior 45 제외). 사거리가 제일 길어 가장 먼저
     * 정지 지점에 닿는 종인데 버티는 시간까지 길면 무리 뒤에서 안전하게 침묵만 돌리는
     * 그림이 된다 — 규칙 4-a가 "멈추면 반드시 맞는다"를 보장해도, 짧게 서고 자주
     * 걷게 해야 저주가 **따라다니며 거는 것**이지 눌러앉는 것이 아니게 된다.
     */
    towerAttack: {
      dmg: 2,
      range: 3.6,
      cooldownTicks: 60,
      stopToAttack: true,
      holdTicks: 60,
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
