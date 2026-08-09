/**
 * 웨이브 생성기 — 순수·결정론적: 같은 (stage, wave) → 항상 deepEqual 결과.
 * 웨이브마다 fresh Rng(seed + wave)를 만들므로 호출 순서/횟수와 무관하다.
 *
 * 난이도 곡선: 예산 B = budgetBase × budgetGrowth^(wave-1), hpMul = hpBase × hpGrowth^(wave-1).
 * 템플릿(swarm/tank_escort/air_raid/mixed/elite)으로 그룹을 구성한 뒤, 웨이브 총 HP를
 * 목표 곡선(유효예산 × 평균 hp/cost × hpMul)에 정규화해 총 HP가 웨이브 단조 증가함을 보장한다.
 * 유효예산 = min(B, WAVE_MAX_SPAWNS × 평균 cost) — 스폰 캡이 물리는 후반 웨이브는
 * 성장이 hpGrowth로만 제한되어 트래시 웨이브가 보스 웨이브를 추월하지 않는다.
 *
 * 보스 규칙: bossOverrides[wave]가 있으면 우선. 오버라이드 그룹의 hpMul은 "웨이브 배율에
 * 대한 상대값"이며 여기서 웨이브 hpMul을 곱해 절대값으로 변환한다. waveCount(50) 초과의
 * endless 10배수 웨이브는 오버라이드가 없으므로 보스(spino/50배수는 trex)를 자동 주입한다.
 */
import { Rng } from '@/core/rng';
import type { EnemyId, SpawnGroup, StageDef, WaveDef, WavePlanParams } from './types';
import { BOUNTY_PER_COST, ENEMY_DEFS } from './enemies';
import {
  ELITE_HP_BONUS,
  GROUP_MAX_COUNT,
  HP_CORR_MAX,
  HP_CORR_MIN,
  WAVE_GOLD_BASE,
  WAVE_GOLD_PER_WAVE,
  WAVE_MAX_SPAWNS,
} from './balance';

type Template = 'swarm' | 'tank_escort' | 'air_raid' | 'mixed' | 'elite' | 'raid';

// 역할 풀 — allowedEnemies와 교집합해서 사용
const SWARMERS: readonly EnemyId[] = ['compy', 'raptor'];
const TANKS: readonly EnemyId[] = ['trike', 'ankylo', 'mammoth', 'golem'];
const MIDS: readonly EnemyId[] = ['raptor', 'boar', 'warrior', 'shaman'];
/**
 * 부족 습격대 — 'raid' 템플릿 전용 풀. 전위(근접)가 먼저 쏟아지고 후위(원거리)가 뒤따른다.
 * 다른 템플릿에도 섞여 나오긴 한다(genMixed는 allowed 전체에서 뽑는다) —
 * raid는 그중에서 **무리로 몰려오는 형태**를 보장하는 편성이다.
 */
const RAID_FRONT: readonly EnemyId[] = ['blade', 'lancer'];
const RAID_BACK: readonly EnemyId[] = ['archer', 'hexer'];
/** 습격대 편성이 처음 등장하는 웨이브 (그 전에는 타워가 아직 한두 기뿐이라 학살이 된다) */
const RAID_FROM_WAVE = 8;
/** 습격대 빈도가 2배가 되는 웨이브 — 후반의 주된 위협축이 된다 */
const RAID_FREQUENT_WAVE = 15;
/**
 * 습격대 **최소 인원** — 무리의 정체성을 데이터로 보장한다.
 *
 * 이게 없으면 예산이 작은 초반 raid 웨이브가 `floor(share/cost)` → 0 → 1 로 떨어져
 * "투창병 1명 + 투창병 1명"이 나온다. 그건 무리가 아니라 낙오병이고, 습격대 템플릿이
 * mixed 와 구분되지 않는다 (실측: 예전 스테이지2 w6 = blade×1 + blade×1).
 *
 * 예산이 모자랄 때 마릿수를 줄이는 대신 **개체를 약하게** 만든다 —
 * normalize() 가 웨이브 총 HP를 목표 곡선에 맞추므로(HP_CORR_MIN 0.25까지 흡수)
 * 초반 습격대는 "약한 부족민이 떼로 몰려온다"가 되고 총 HP는 곡선 위에 그대로 남는다.
 * 마릿수가 아니라 개체 HP 를 깎는 쪽이 습격대의 정체성을 지키는 유일한 방향이다.
 *
 * 단, 타워에 넣는 피해는 HP 곡선 밖의 축이라 인원수에 비례해 커진다 —
 * 그래서 등장 웨이브를 6 → 8 로 늦췄다(타워 3~4기가 서는 시점).
 *
 * **보상도 같이 눌러야 한다** — 마릿수만 늘리고 보상을 그대로 두면 총 HP는 그대로인데
 * 골드만 마릿수에 비례해 부푼다(실측: 스테이지1 w12에서 총 HP 503 동일에 보상 138 대 16).
 * 그 몫은 capBounty()가 걷어낸다. 두 장치는 한 쌍이다: min이 머릿수를 지키고,
 * capBounty가 "약해진 개체는 값도 싸다"를 강제한다.
 */
const RAID_MIN_FRONT = 3;
const RAID_MIN_BACK = 2;
/**
 * 한 그룹이 늘어질 수 있는 **최대 스폰폭** (틱).
 *
 * 왜 필요한가: 그룹의 스폰폭은 `interval × (count − 1)`인데 두 인자가 서로를 모른다.
 * genElite(interval 30~50)와 genTankEscort(탱크 50~80)가 GROUP_MAX_COUNT 25와 만나면
 * **한 그룹이 혼자 1,000틱(33초)을 쓴다**. 총 HP는 곡선 위에 그대로 있는데 시간축으로
 * 펴져서 밀도가 무너지고, 그러면 방어선이 한 마리씩 편하게 처리한다 —
 * "가장 센 웨이브가 가장 지루한 웨이브"가 되는 자리다.
 *
 * 실측(스테이지1, 도입 전): 기지에 피해를 준 웨이브의 밀도는 100틱당 16.9~18.5마리
 * (w43 18.0 / w47 17.0 / w48 18.2 / w49 16.9)인데, **총 HP 최상위 3개**인 w44·45·46은
 * 폭이 997/817/1118틱이라 밀도가 6.0/6.5/5.4 — 아픈 웨이브의 1/3이다.
 * 그 셋은 판당 42·37·45초씩 잡아먹으면서 기지 피해 0 · 타워 파괴 0이었다.
 * 420은 "밀도 ≥ 8마리/100틱"에서 유도했고(60마리 캡 기준 750틱이 8/100틱이지만
 * 실제 웨이브는 여러 그룹이 겹치므로 그룹 하나의 몫으로는 절반이 상한이다),
 * 경계 실측의 두 무리(16.9~18.5 대 5.4~6.5) 사이를 확실히 가른다.
 *
 * 총 HP 곡선은 **한 자리도 바뀌지 않는다** — normalize()는 마릿수와 hpMul만 보고
 * 간격은 보지 않는다. 바뀌는 것은 오직 "얼마나 몰려서 오는가"다.
 */
const GROUP_MAX_SPAN = 420;

function inter(pool: readonly EnemyId[], allowed: readonly EnemyId[]): EnemyId[] {
  return pool.filter((id) => allowed.includes(id));
}

/** hpMul은 3자리 반올림 — 세이브/로그 가독성용 (결정론에는 영향 없음) */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 예산 내 선택 가능(비용 ≤ maxCost) 우선, 전부 비싸면 풀에서 최저가 확정 선택 */
function pickAffordable(rng: Rng, pool: readonly EnemyId[], maxCost: number): EnemyId {
  const ok = pool.filter((id) => ENEMY_DEFS[id].cost <= maxCost);
  if (ok.length > 0) return rng.pick(ok);
  let best = pool[0] as EnemyId;
  for (const id of pool) if (ENEMY_DEFS[id].cost < ENEMY_DEFS[best].cost) best = id;
  return best;
}

interface Gen {
  rng: Rng;
  groups: SpawnGroup[];
  hpMul: number;
  groundLanes: number;
  airLanes: number;
  spawnsLeft: number;
  /**
   * 이 웨이브에 아직 넣을 수 있는 **비행 마릿수** (상한이 없으면 Infinity).
   * Infinity면 아래 클램프가 한 번도 물리지 않아 예전 편성과 바이트 단위로 같다.
   */
  airLeft: number;
}

/**
 * 예산 share만큼 해당 적 그룹 추가. count = floor(share / (cost × hpBonus)), min~캡 클램프.
 * min(기본 1)은 습격대처럼 **마릿수 자체가 정체성**인 편성이 예산 부족으로 흩어지지 않게 한다.
 *
 * 반환값 = **공중 상한이 거절한 예산**. 부르는 쪽이 그 몫을 다른 그룹에 넘긴다
 * (genAirRaid 주석). 상한이 없거나 물리지 않으면 언제나 0이므로 기존 호출부는
 * 반환값을 무시해도 동작이 한 자리도 바뀌지 않는다.
 */
function push(
  g: Gen,
  id: EnemyId,
  share: number,
  interval: number,
  delay: number,
  hpBonus: number,
  min = 1,
): number {
  const def = ENEMY_DEFS[id];
  let count = Math.floor(share / (def.cost * hpBonus));
  if (count < min) count = min;
  if (count > GROUP_MAX_COUNT) count = GROUP_MAX_COUNT;
  if (count > g.spawnsLeft) count = g.spawnsLeft;
  // 공중 상한 — 거절한 마릿수만큼의 예산을 반환해 지상으로 흘려보낸다.
  let rejected = 0;
  if (def.flying) {
    if (count > g.airLeft) {
      rejected = (count - g.airLeft) * def.cost * hpBonus;
      count = g.airLeft;
    }
    g.airLeft -= count;
  }
  if (count < 1) return rejected; // 스폰 캡 소진 (또는 공중 상한이 0)
  g.spawnsLeft -= count;
  // 스폰폭 클램프 — 마릿수가 확정된 **뒤에야** 간격의 상한을 알 수 있다 (GROUP_MAX_SPAN 주석).
  // 간격은 줄기만 하므로 다른 템플릿의 형태 판정을 침범하지 않는다: 마릿수 상한이 25라
  // 클램프의 하한이 ceil(420/24)=18틱이고, 습격대 무리의 표식인 5~9틱까지는 절대 내려오지 않는다.
  const span = count > 1 ? Math.min(interval, Math.ceil(GROUP_MAX_SPAN / (count - 1))) : interval;
  const lanes = def.flying ? g.airLanes : g.groundLanes;
  g.groups.push({
    enemyId: id,
    count,
    intervalTicks: span,
    delayTicks: delay,
    pathIndex: lanes > 1 ? g.rng.int(0, lanes - 1) : 0,
    hpMul: g.hpMul * hpBonus,
  });
  return rejected;
}

/**
 * 습격대가 **확정으로** 오기 시작하는 웨이브와 그 주기.
 *
 * 왜 필요한가: 추첨은 장기적으로만 공평하고, 한 스테이지는 짧은 표본이다. 실측
 * (스테이지1 · seed 1013): towerAttack 보유 종의 마릿수가 10웨이브 단위로
 * 16 → 29 → **24** → 48 → 269로, **w21~30이 w11~20보다 적다**. 타워 압박 축이 중반에서
 * 오히려 후퇴하는 것이다. 최장 가뭄은 **7웨이브 연속 0**(w28~34)이었고, 그 구간은
 * 16판 × 20웨이브 동안 기지 HP 손실 0 · 타워 파괴 0 — 스테이지가 통째로 죽어 있었다.
 *
 * chooseTemplate은 순수·결정론 계약이라 "최근에 몇 번 나왔나" 같은 상태를 둘 수 없다.
 * 그래서 **웨이브 번호만으로** 못 박는다 — 창 안에서 주기마다 한 번은 반드시 습격대다.
 *  · 보스(10배수)는 bossOverrides가 chooseTemplate보다 먼저 가로채므로 충돌하지 않는다.
 *  · 24 이전은 건드리지 않는다 — 온보딩(w1~20 완만)의 약속이 우선이고,
 *    실측에서도 w11~20의 습격대 마릿수(29)는 모자라지 않았다.
 *
 * ⚠ **창에 위쪽 끝이 있는 이유** — 도입할 때는 "후반은 이미 WAVE_MAX_SPAWNS 60에 붙어
 * 있으니 영향이 없다"고 보고 상한을 두지 않았다. **틀렸다.** 캡에 붙은 것은 마릿수지
 * 편성이 아니라서, 후반 웨이브가 raid로 바뀌면 그 60마리가 통째로 타워 공격자가 된다:
 * 실측 w41~50 습격대 마릿수 269 → **357**, 그 결과 기준선 봇이 5/20까지 무너지고
 * 웨이브 15+ 최소 타워 수가 4기(죽음의 나선 하한 7 위반)가 됐다. 후반은 원래 아프던
 * 구간이고(그 열 웨이브가 기지 손실 239 · 파괴 212를 이미 청구한다) 이 가드가 고치려는
 * 곳이 아니다. 그래서 **비어 있던 창에만** 건다 — 진단이 가리킨 곳이 정확히 거기다.
 *
 * ⚠⚠ **주기가 3이 아니라 6인 이유 — 이 축은 빈도가 아니라 간격이 값을 정한다** ⚠⚠
 * 실측(스테이지1 · 시드 20 · 기준선 봇 · 나머지 조건 동일. `승 / minT / 유닛 갈래 승`):
 *   창 없음(전 구간) 주기3 :  5 / [4] / –    ← w41~50 습격대 269 → 357. 죽음의 나선
 *   w24~40 주기3           : 14 / [6] / –    ← 봉투 3번(minT ≥ 7)이 여기서 빨개진다
 *   w24~40 주기4           : 14 /  8  / [10] ← 봉투 7번(유닛 갈래 ≥ 기준선 −3)이 깨진다
 *   w24~40 주기6           : 14 /  8  /  15  ← **채택**. 봉투 전 항목 통과
 *   가드 없음              : 15 /  8  /  15  (대신 중반 공백이 그대로 남는다)
 *
 * 왜 습격대를 촘촘히 넣으면 **유닛 갈래**가 먼저 죽는가: 아군은 마을 앞에서 붙잡는
 * 자원이고 타워 예비비 600을 떼어 두고 산다. 습격대가 연달아 오면 그 예비비만큼 얇은
 * 방어선이 재건설을 못 따라가고, 붙잡아 봐야 뒤에서 또 온다. 곧 이 가드를 세게 걸수록
 * "골드를 타워 밖에 쓰는 선택지"가 선택지가 아니게 된다 — 봉투 7번이 정확히 그걸 막는다.
 *
 * ⚠ **이 가드가 산 것은 크지 않다. 정직하게 남긴다.**
 *  · 창 안의 보장 웨이브는 w24·w30·w36인데 **w30은 보스 오버라이드가 먼저 가져간다.**
 *    실제로 도는 것은 w24·w36 둘뿐이라 seed 1013의 최장 가뭄(w28~34, 7웨이브)은
 *    **그대로 남는다**. 위상을 옮겨(`% 6 === 2` → w26·w32·w38, 10배수와 절대 안 겹친다)
 *    셋을 다 살리는 것을 시험했고 **봉투가 두 곳에서 깨졌다** — 기지 갈래 11/20(하한
 *    기준선 −3 = 12 위반) · 봉투 4번 minT합 역전. 그래서 위상 0으로 남긴다.
 *  · 산 것: 습격대 마릿수 10웨이브 단위가 (16, 29, [24], 48)에서 (16, 29, [32], 48)이 되어
 *    **"중반이 초반보다 한산한" 역전(24 < 29)이 사라진다.** wavePlan.seed를 옮기면 효과가
 *    더 크다 — 4099는 (43 → 49, 78 → 102), 8081은 (36 → 44, 103 → 113).
 *  · 최강 봇 기준 w21~40 타워 파괴는 22기 → 22기로 사실상 무변이다.
 *    **중반을 잘 두는 사람에게까지 아프게 만들려면 습격대 빈도가 아니라 다른 축이
 *    필요하다** — 봉투 7번이 빈도 축의 상한을 여기서 잠그고 있다 (남은 숙제).
 */
const RAID_GUARANTEE_FROM_WAVE = 24;
const RAID_GUARANTEE_TO_WAVE = 40;
const RAID_GUARANTEE_EVERY = 6;

/**
 * **하늘길 주기** — `wavePlan.airFromWave`부터 이 간격마다 한 번은 반드시 공중 편성이다.
 *
 * 왜 보장이 필요한가: 추첨(`c.push('air_raid')`)은 장기적으로만 공평한데 한 스테이지는
 * 50웨이브짜리 짧은 표본이다. 해금만 해 두면 "하늘이 열렸는데 정작 안 온다"가 실제로
 * 일어난다 — 습격대 쪽에서 이미 겪은 병이고(RAID_GUARANTEE_FROM_WAVE 주석의 7웨이브 가뭄)
 * 같은 처방을 쓴다. chooseTemplate은 순수·결정론 계약이라 **웨이브 번호만으로** 못 박는다.
 *
 * ⚠⚠ **주기를 고를 때 실제로 세어야 하는 것은 '살아남는 회차 수'다** ⚠⚠
 * 보스는 10의 배수 웨이브이고 bossOverrides가 chooseTemplate보다 **먼저** 가로챈다.
 * 곧 하늘길 웨이브가 10의 배수에 떨어지면 그 회차는 **통째로 사라진다**.
 * 스테이지1(airFromWave 22, w50까지)에서 예정 회차와 실제 회차:
 *   주기 4 → 22·26·[30]·34·38·42·46·[50]  → 예정 8, 보스에 2 먹힘, **실제 6**
 *   주기 5 → 22·27·32·37·42·47            → 예정 6, 충돌 0,      **실제 6**
 *   주기 6 → 22·28·34·[40]·46             → 예정 5, 보스에 1 먹힘, **실제 4**
 * 실측이 정확히 이 순서를 따라간다 (상한 2 · `하한 팔 20시드 / 최강 여유 / 중반 손실`):
 *   주기 4 → 14/20 · **41.4%** ·  77   ← 채택
 *   주기 5 → 15/20 ·   45.9%  ·  34
 *   주기 6 → 14/20 ·   51.1%  ·   9   ← 회차가 넷뿐이라 중반이 거의 안 살아난다
 * 곧 주기 6은 **의도한 것보다 20% 적게 투여된다** — 숫자만 보고 고르면 이 누수가 안 보인다.
 *
 * 주기 4와 5는 실제 회차가 여섯으로 같은데, 4 쪽이 중반(w21~40)에 22·26·34·38을 놓아
 * 예산이 큰 w34~38에 두 번 걸린다(5는 22·27·32·37). 그 차이가 중반 손실 77 대 34다.
 * 시드 교차(wavePlan.seed 1013/4099/8081)에서 하한 팔의 대조 대비 변화도 4 쪽이 낫다:
 *   주기 4 → 0 / −1 / +1      주기 5 → +1 / −2 / +1
 *
 * 습격대 보장(w24 · 30 · 36)과는 한 웨이브도 겹치지 않는다 — 둘 다 웨이브 번호의
 * 함수라 겹침 여부가 데이터에서 확정되고, 만에 하나 겹치면 습격대 보장이 먼저 이긴다.
 */
const AIR_GUARANTEE_EVERY = 4;

/**
 * 이 웨이브가 **하늘길 웨이브**인가 (게이트가 없으면 언제나 false).
 *
 * 게이트 스테이지에서 비행 종은 **이 웨이브에만** 편성 풀에 들어간다. 곧 하늘은
 * "해금된 뒤 아무 때나"가 아니라 **주기적으로만** 열린다. 그렇게 못 박는 이유가 실측에 있다:
 * 해금만 하고 추첨에 맡기면 genMixed가 allowed 전체에서 뽑으므로 w22~50의 절반 가까이가
 * 비행을 섞게 되고, 그러면 투여량이 설계의 2.3배가 된다
 * (실측: 최강 봇 w21~40 기지손실 255 대 목표 113, 하한 팔 7/20 대 하한 13).
 * 주기 편성은 플레이어 쪽에서도 낫다 — "여섯 웨이브마다 하늘을 본다"는 배울 수 있는
 * 규칙이지만 "가끔 섞여 나온다"는 대공 카드를 상비하라는 뜻이라 덱 선택을 죽인다.
 */
function isAirWave(wave: number, airFromWave: number | undefined): boolean {
  return (
    airFromWave !== undefined &&
    wave >= airFromWave &&
    (wave - airFromWave) % AIR_GUARANTEE_EVERY === 0
  );
}

function chooseTemplate(
  rng: Rng,
  wave: number,
  allowed: readonly EnemyId[],
  airFromWave?: number,
): Template {
  if (wave <= 2) return 'swarm'; // 초반 온보딩 — 약한 스웜만
  // 중반 가뭄 방지 (RAID_GUARANTEE_FROM_WAVE 주석). 습격대가 해금되지 않은 스테이지는
  // 전위 풀이 비어 raid 편성 자체가 성립하지 않으므로 같은 조건으로 막는다.
  if (
    wave >= RAID_GUARANTEE_FROM_WAVE &&
    wave <= RAID_GUARANTEE_TO_WAVE &&
    wave % RAID_GUARANTEE_EVERY === 0 &&
    inter(RAID_FRONT, allowed).length > 0
  ) {
    return 'raid';
  }
  // 하늘길 보장 (AIR_GUARANTEE_EVERY 주석). allowed는 이 웨이브의 풀이라
  // 하늘길 웨이브가 아니면 ptera가 없어 조건이 성립하지 않는다.
  if (isAirWave(wave, airFromWave) && allowed.includes('ptera')) return 'air_raid';
  const c: Template[] = ['mixed', 'mixed', 'swarm']; // mixed 가중 2배 (HP 분산 완화)
  if (wave >= 4 && inter(TANKS, allowed).length > 0) c.push('tank_escort');
  if (wave >= 5 && allowed.includes('ptera')) c.push('air_raid');
  if (wave >= 12) c.push('elite');
  if (wave >= RAID_FROM_WAVE && inter(RAID_FRONT, allowed).length > 0) {
    c.push('raid');
    if (wave >= RAID_FREQUENT_WAVE) c.push('raid');
  }
  return rng.pick(c);
}

function genSwarm(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const pool = inter(SWARMERS, allowed);
  const n = budget >= 60 ? 3 : 2;
  const gap = g.rng.int(40, 80);
  for (let i = 0; i < n; i++) {
    push(g, pickAffordable(g.rng, pool, budget / n), budget / n, g.rng.int(6, 12), i * gap, 1);
  }
}

function genTankEscort(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const tanks = inter(TANKS, allowed);
  push(g, pickAffordable(g.rng, tanks, budget * 0.55), budget * 0.55, g.rng.int(50, 80), g.rng.int(0, 30), 1);
  const escorts = inter([...SWARMERS, ...MIDS], allowed);
  for (let i = 0; i < 2; i++) {
    push(g, pickAffordable(g.rng, escorts, budget * 0.225), budget * 0.225, g.rng.int(12, 20), g.rng.int(60, 140), 1);
  }
}

/**
 * 공중 습격 — 익룡이 하늘길로 오고 지상 호위가 뒤따른다.
 *
 * ── 공중 상한이 거절한 예산은 **버리지 않는다** ─────────────────────────────
 * `wavePlan.airMaxCount`가 익룡 마릿수를 자르면 그 몫의 예산이 편성에서 사라지는데,
 * 그대로 두면 **공중을 넣을수록 그 웨이브가 헐거워진다** — 총 HP는 normalize()가
 * 곡선으로 되돌리지만 되돌리는 방식이 "남은 개체를 두껍게" 하는 것이라, 몸 수가 줄고
 * 밀도가 무너진다(GROUP_MAX_SPAN 주석이 다룬 것과 같은 병이다).
 * 그래서 잘린 예산은 지상 호위의 몫에 그대로 얹는다. 상한이 없는 스테이지에서는
 * 거절이 0이라 예전 편성과 **바이트 단위로 같다**.
 */
function genAirRaid(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const rejected = push(g, 'ptera', budget * 0.55, g.rng.int(14, 22), g.rng.int(0, 40), 1);
  const ground = inter([...SWARMERS, ...MIDS], allowed);
  const share = budget * 0.45 + rejected;
  push(g, pickAffordable(g.rng, ground, share), share, g.rng.int(12, 24), g.rng.int(60, 120), 1);
}

function genMixed(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const gap = g.rng.int(35, 70);
  for (let i = 0; i < 3; i++) {
    push(g, pickAffordable(g.rng, allowed, budget / 3), budget / 3, g.rng.int(10, 26), i * gap, 1);
  }
}

/**
 * 습격대 — 부족이 **무리지어** 타워를 부수러 온다.
 * 형태 규칙(다른 템플릿과 눈으로 구분되어야 한다):
 *  · 전위(칼·창) 2무리를 간격 5~9틱(0.17~0.3초)으로 쏟아붓는다 — 한 덩어리로 몰려 보인다.
 *    간격을 mixed(10~26)보다 확실히 좁힌 게 "무리"의 시각적 정체성이다.
 *  · 후위(궁수·주술사) 1무리는 70~110틱 늦게 출발해 전위 뒤를 따라온다.
 *    걸으면서 쏘는 종이라 뒤에서 갉고, 전위가 붙어서 두들긴다는 역할 분담이 보인다.
 *  · 후위 풀이 비어 있는(=아직 궁수/주술사가 해금되지 않은) 스테이지에서는
 *    예산 전부가 전위로 간다 — 초반 스테이지는 순수 돌격대가 된다.
 */
function genRaid(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const front = inter(RAID_FRONT, allowed);
  const back = inter(RAID_BACK, allowed);
  const frontShare = back.length > 0 ? 0.62 : 1;
  const lead = g.rng.int(20, 45);
  for (let i = 0; i < 2; i++) {
    const share = (budget * frontShare) / 2;
    push(g, pickAffordable(g.rng, front, share), share, g.rng.int(5, 9), i * lead, 1, RAID_MIN_FRONT);
  }
  if (back.length > 0) {
    const share = budget * (1 - frontShare);
    push(g, pickAffordable(g.rng, back, share), share, g.rng.int(8, 14), g.rng.int(70, 110), 1, RAID_MIN_BACK);
  }
}

function genElite(g: Gen, budget: number, allowed: readonly EnemyId[]): void {
  const pool = inter([...TANKS, ...MIDS], allowed);
  const gap = g.rng.int(50, 90);
  for (let i = 0; i < 2; i++) {
    const share = budget / 2;
    push(g, pickAffordable(g.rng, pool, share / ELITE_HP_BONUS), share, g.rng.int(30, 50), i * gap, ELITE_HP_BONUS);
  }
}

/**
 * allowedEnemies의 평균 hp/cost — 총 HP 목표 곡선의 계수.
 *
 * **타워를 때리는 종(towerAttack)은 평균에서 제외한다.** 이들의 cost에는 체력이 아니라
 * 타워 파괴력의 값이 들어 있어(enemies.ts 참조) hp/cost가 구조적으로 낮다.
 * 그대로 평균에 넣으면 습격대를 허용하는 것만으로 그 스테이지의 **모든 웨이브**
 * (습격대가 한 마리도 없는 웨이브까지) 목표 총 HP가 내려간다 —
 * 실측: 스테이지1에 blade+archer를 허용하면 계수가 6.79 → 5.73(-16%)로 떨어져,
 * 습격대 추가가 난이도를 '더하는' 대신 '맞바꾸는' 결과가 됐다.
 * 제외하면 습격대는 기존 HP 곡선 위에 타워 압박을 **순증**시킨다.
 *
 * 전원이 타워 공격자인 스테이지는 없지만, 그런 경우에는 전체 평균으로 폴백한다.
 */
function refHpPerCost(allowed: readonly EnemyId[]): number {
  const base = allowed.filter((id) => ENEMY_DEFS[id].towerAttack === undefined);
  const pool = base.length > 0 ? base : allowed;
  let sum = 0;
  for (const id of pool) {
    const d = ENEMY_DEFS[id];
    sum += d.hp / d.cost;
  }
  return pool.length > 0 ? sum / pool.length : 6;
}

/** allowedEnemies의 평균 cost — 스폰 캡으로 실제 소비 가능한 예산 상한 계산용 */
function avgCost(allowed: readonly EnemyId[]): number {
  let sum = 0;
  for (const id of allowed) sum += ENEMY_DEFS[id].cost;
  return allowed.length > 0 ? sum / allowed.length : 20;
}

/**
 * 웨이브 처치 보상 상한 — **예산이 산 것보다 많은 골드를 주지 않는다**.
 *
 * 이 게임의 경제 계약은 `bounty = round(cost × BOUNTY_PER_COST)` 하나이고,
 * 그룹 마릿수가 `floor(share / cost)` 인 한 웨이브 총 보상은 자동으로
 * `Σ 0.8 × cost × count ≤ 0.8 × Σ share = 0.8 × budget` 이하로 유지된다.
 * 즉 **정상 편성에서는 이 상한이 절대 물리지 않는다** (floor 때문에 항상 미만이다).
 *
 * 물리는 경우는 하나뿐 — `push(min=…)` 이 예산을 무시하고 마릿수를 올릴 때다.
 * 습격대(genRaid)는 "무리"가 정체성이라 예산이 모자라도 최소 인원을 채우는데,
 * 그러면 **총 HP는 normalize()가 곡선으로 되돌리는 반면 보상만 마릿수에 비례해 부푼다**.
 * 실측(스테이지1, 3단계 시점): w12는 습격대 유/무의 총 HP가 503으로 동일한데
 * 보상이 138 대 16(8.6배)이었고, w1~50 총계로도 총 HP +1.3%에 총수입 +18.7%였다.
 * 그 결과 습격대를 **넣으면 게임이 쉬워지는** 역전이 났다(봇 24시드 17승 대 15승).
 *
 * 그래서 상한만 건다(끌어올리지 않는다):
 *  · 정상 편성은 값이 1바이트도 바뀌지 않는다 — 회귀 위험이 없다.
 *  · 최소 인원으로 늘어난 개체는 normalize()가 HP를 깎은 만큼 값도 싸진다
 *    ("약한 부족민이 떼로" = 머릿수는 무리지만 한 명 한 명은 값이 헐하다).
 *  · 보스 오버라이드 웨이브는 이 경로를 타지 않는다(클라이맥스 보상은 수동 설계다).
 */
function capBounty(groups: SpawnGroup[], budget: number): void {
  let raw = 0;
  for (const sg of groups) raw += ENEMY_DEFS[sg.enemyId].bounty * sg.count;
  const target = budget * BOUNTY_PER_COST;
  if (raw <= target || raw <= 0) return;
  const mul = round3(target / raw);
  for (const sg of groups) sg.bountyMul = mul;
}

/** 웨이브 총 HP를 목표값으로 정규화 — 그룹 hpMul에 보정 배율(클램프) 적용 */
function normalize(groups: SpawnGroup[], targetHp: number): void {
  let raw = 0;
  for (const sg of groups) raw += ENEMY_DEFS[sg.enemyId].hp * sg.count * sg.hpMul;
  if (raw <= 0) return;
  let corr = targetHp / raw;
  if (corr < HP_CORR_MIN) corr = HP_CORR_MIN;
  if (corr > HP_CORR_MAX) corr = HP_CORR_MAX;
  for (const sg of groups) sg.hpMul = round3(sg.hpMul * corr);
}

/** 비행 종을 뺀 풀 (WavePlanParams.airFromWave 게이트가 쓰는 것과 같은 필터) */
function groundPoolOf(plan: WavePlanParams): EnemyId[] {
  return plan.allowedEnemies.filter((id) => !ENEMY_DEFS[id].flying);
}

/**
 * **곡선 계수를 재는 풀은 지상 풀로 고정한다** (게이트 스테이지에 한해).
 *
 * 왜: `ref`(평균 hp/cost)와 `maxSpend`(평균 cost × 스폰 캡)는 **전 웨이브의 목표 HP
 * 곡선**을 정하는 계수인데, allowedEnemies에 비행 종을 한 줄 더하는 것만으로 두 값이
 * 움직인다. 그러면 **공중이 한 마리도 없는 w1~21까지 곡선이 따라 내려간다** —
 * 곧 "공중을 더했는데 앞부분이 쉬워졌다"가 된다. refHpPerCost가 towerAttack 종을
 * 평균에서 빼는 것과 정확히 같은 사유이고, 처방도 같다.
 * 실측(스테이지1, ptera 추가 전후 w1~50 총 HP 합): 편차 **0.026%** — 이 차이는
 * normalize()의 round3 반올림뿐이고 곡선 자체는 움직이지 않는다.
 * (게이트가 없는 스테이지 2~6은 이 분기를 타지 않아 값이 한 자리도 안 바뀐다)
 */
function curvePoolOf(plan: WavePlanParams): readonly EnemyId[] {
  return plan.airFromWave === undefined ? plan.allowedEnemies : groundPoolOf(plan);
}

/**
 * 이 웨이브의 예산 = min(예산 곡선, 스폰 캡 소비 한계).
 *
 * **내보내는 이유**: 보상 상한 검증(tests/data/wavegen.test.ts)이 이 공식을 베껴 두고
 * 있었는데, 곡선 풀 규칙이 바뀌면 그 사본만 조용히 어긋난다(공식이 두 곳에 있으면
 * 언젠가 반드시 갈라진다). 한 곳에서만 유도하고 테스트는 그것을 부른다.
 */
export function waveBudgetFor(stage: StageDef, wave: number): number {
  const plan = stage.wavePlan;
  const maxSpend = WAVE_MAX_SPAWNS * avgCost(curvePoolOf(plan));
  return Math.min(plan.budgetBase * plan.budgetGrowth ** (wave - 1), maxSpend);
}

export function makeWaveFor(stage: StageDef): (wave: number) => WaveDef {
  const plan = stage.wavePlan;
  const groundLanes = stage.paths.length;
  // 공중 레인: airPaths가 없으면 sim이 paths[i] 직선화를 쓰므로 레인 수는 paths와 동일
  const airLanes = stage.airPaths && stage.airPaths.length > 0 ? stage.airPaths.length : groundLanes;
  /** 게이트 이전 웨이브가 쓰는 풀 — 비행 종을 통째로 뺀다 (WavePlanParams.airFromWave) */
  const groundPool = groundPoolOf(plan);
  const ref = refHpPerCost(curvePoolOf(plan));

  return (wave: number): WaveDef => {
    const hpMul = plan.hpBase * plan.hpGrowth ** (wave - 1);
    const goldReward = WAVE_GOLD_BASE + wave * WAVE_GOLD_PER_WAVE;

    const override = plan.bossOverrides[wave];
    if (override) {
      // 오버라이드 hpMul(상대값) × 웨이브 hpMul = 절대 배율
      return {
        groups: override.groups.map((sg) => ({ ...sg, hpMul: round3(sg.hpMul * hpMul) })),
        goldReward,
      };
    }

    const rng = new Rng((plan.seed + wave) >>> 0);
    // min(예산 곡선, 캡 소비 한계) — 두 단조 증가 곡선의 min이라 목표 HP도 단조 증가
    const budget = waveBudgetFor(stage, wave);
    const g: Gen = {
      rng,
      groups: [],
      hpMul,
      groundLanes,
      airLanes,
      spawnsLeft: WAVE_MAX_SPAWNS,
      airLeft: plan.airMaxCount ?? Infinity,
    };
    /**
     * 이 웨이브의 풀. 게이트 스테이지에서는 **하늘길 웨이브에서만** 비행 종이 들어간다
     * (isAirWave 주석). 추첨 풀에서도 빼야 한다 — genMixed는 allowed 전체에서 뽑으므로
     * air_raid 템플릿만 막아서는 익룡이 아무 mixed 웨이브에나 섞여 나온다.
     */
    const allowed =
      plan.airFromWave === undefined || isAirWave(wave, plan.airFromWave)
        ? plan.allowedEnemies
        : groundPool;
    const template = chooseTemplate(rng, wave, allowed, plan.airFromWave);
    if (template === 'swarm') genSwarm(g, budget, allowed);
    else if (template === 'tank_escort') genTankEscort(g, budget, allowed);
    else if (template === 'air_raid') genAirRaid(g, budget, allowed);
    else if (template === 'elite') genElite(g, budget, allowed);
    else if (template === 'raid') genRaid(g, budget, allowed);
    else genMixed(g, budget, allowed);

    // 안전망 — 어떤 경우에도 빈 웨이브 금지
    if (g.groups.length === 0) {
      const id = allowed.length > 0 ? (allowed[0] as EnemyId) : 'raptor';
      g.groups.push({ enemyId: id, count: 1, intervalTicks: 15, delayTicks: 0, pathIndex: 0, hpMul });
    }

    normalize(g.groups, budget * ref * hpMul);
    // 총 HP를 곡선에 맞춘 뒤 보상도 예산 상한 안으로 되돌린다 (순서 무관 — 서로 독립)
    capBounty(g.groups, budget);

    // endless(waveCount 초과) 10배수 웨이브 — 오버라이드가 없으므로 보스 자동 주입
    if (wave % 10 === 0) {
      g.groups.unshift({
        enemyId: wave % 50 === 0 ? 'trex' : 'spino',
        count: 1,
        intervalTicks: 90,
        delayTicks: 30,
        pathIndex: 0,
        hpMul: round3(hpMul),
      });
    }

    return { groups: g.groups, goldReward };
  };
}
