/**
 * 자동플레이 봇 하네스 — 난이도 봉투 측정의 단일 구현체.
 * (autoplay.test.ts 가 봉투를 잠그고, 밸런스 스윕이 같은 봇으로 숫자를 낸다)
 *
 * ── 봇이 흉내내는 것 ───────────────────────────────────────────────────────
 * "평범한 사람의 상식적 플레이"다. 새로고침·판매·타게팅 변경은 쓰지 않는다
 * (사람은 이보다 잘한다 → 봇이 클리어하면 사람도 클리어한다는 하한선이 된다).
 * 대신 **게임이 명시적으로 가르치는 규칙**은 지킨다. 규칙을 모르는 봇이 지는 것은
 * 게임이 불공정하다는 증거가 아니기 때문이다. 부족 습격대(siege.ts) 도입으로
 * 새로 생긴 규칙이 둘이라 봇도 둘을 배웠다:
 *
 *  1) **배치 거리 = 위험도** (siege.ts 규칙 1).
 *     적은 경로를 벗어나지 않으므로 경로에서 SAFE_DIST 이상 떨어진 타워 앞에는
 *     **어떤 습격대도 멈춰 설 수 없다**(규칙 4-a). 경로에 딱 붙여 짓던 예전 봇은
 *     이 세계에서 그냥 서투른 것이고, 그 서투름으로 잰 난이도는 게임의 난이도가 아니다.
 *     → 기본 봇은 "사거리가 닿는 한 가장 안전한 칸"을 고른다. 공짜는 아니다 —
 *       멀어질수록 경로를 덮는 구간이 짧아져(현 d에서 커버 길이 2√(r²−d²)) 화력이 준다.
 *     비교군이 필요할 때는 hugPath:true 로 예전 봇(경로 밀착)을 그대로 재현한다.
 *     ⚠ **9단계(정지 사격 개편)가 이 항목의 근거를 무효로 만들었고 10단계가 고쳤다.**
 *       9단계에서는 정지선(2.1)이 이격 2칸까지 붙잡아 안전 봇과 밀착 봇이 똑같이
 *       정지 사격을 받았다(43.6% 대 43.1%) — 곧 거리가 아무것도 사지 않았다.
 *       10단계는 **봇이 아니라 정지선을 고쳤다**(2.1 → 1.7). 봇 쪽에서 바뀐 것은
 *       SAFE_DIST가 **상수에서 유도값이 된 것 하나뿐**이고, 그 값 2.0은 그대로다.
 *       유도로 바꾼 이유는 SAFE_DIST 선언부 주석에 있다.
 *
 *  2) **손상 중이면 조기 호출하지 않는다** — 다만 이건 "게임이 가르치는 규칙"이
 *     아니라 **보수적인 하한선**으로만 유지한다.
 *     prep 자동 수리(balance.TOWER_REPAIR_PER_STATUS_TICK)는 준비 시간이 흘러야 들어오고,
 *     조기 호출은 그걸 버리는 대신 남은틱×0.15 골드를 받는다. 도입 당시 이 선택이
 *     유의미하다고 적었지만 **데이터는 그렇지 않았다**: 스테이지1 시드 24개 실측에서
 *     항상 조기호출 16/24승·기지HP합 129 대 수리 대기(기본) 16/24승·126 — 무승부다.
 *     prep 90틱의 조기 보너스는 floor(90×0.15)=13골드뿐이라 애초에 판단할 거리가 아니다.
 *     기본값을 수리 대기로 두는 이유는 우월해서가 아니라 (a) 파괴가 근소하게 적어
 *     (8.4기 대 10.4기) 측정 분산이 작고 (b) 봇이 게임을 덜 짜내는 쪽이
 *     "봇이 이기면 사람도 이긴다"는 하한선의 취지에 맞기 때문이다.
 *     (alwaysRush:true 로 반대 행동 재현)
 *
 * ── 4단계: 전략별 봇 = 옵션 조합 (별도 클래스를 만들지 않는다) ──────────────
 * 골드 배분 A/B에 쓰는 "전략 봇"은 전부 이 한 구현체의 옵션 조합이다. 갈래마다 봇을
 * 따로 만들면 갈래 사이의 차이가 **정책 차이인지 구현 차이인지** 구분할 수 없기 때문이다.
 * 실측에 쓴 조합과 각 봇의 행동 규칙:
 *
 *  · **T 타워**   `{}`
 *    받는 골드 전부를 타워에 넣는다. 배치 상한(8)까지 채우고, 그 뒤로는 매 외곽 루프마다
 *    **가장 많이 투자된 타워**를 한 단계 올린다(소수 정예). 기준선.
 *
 *  · **U 유닛**   `{ towerReserve: 600, allies: { minNear: 3 } }`
 *    방어선이 다 선 뒤부터 잔고 600을 타워가 손대지 못하게 남기고, 0.5초마다
 *    "출격 한계선 앞 감시 창(= 한계선 + 6타일) 안에 지상 적이 밀도 3 이상"이면
 *    정원까지 출동시킨다. 문턱 3의 근거는 minNear 주석 — 문턱 1(매 웨이브 균일 출동)은
 *    골드의 20%를 태우고 승수를 6까지 떨어뜨린다.
 *    이 봇은 마을을 올리지 않으므로 한계선이 Lv1 6.0에 머물고, 창은 언제나 12다.
 *
 *  · **AB 부족(아군+마을)**  `{ towerReserve: 600, allies: { minNear: 3 }, base: { reserve: 200 } }`
 *    7단계에서 추가한 갈래. **"마을을 올리면 부족원이 더 멀리 나간다"를 아는 봇**이다
 *    (data/hometown.ts의 sortie 열). U와 H를 따로 재면 이 상호작용이 통째로 빠지는데,
 *    그게 6단계에서 추가한 상품의 값어치 그 자체다. 마을 예비비 200은 "유닛 몫을 남기고
 *    남는 돈으로만 올린다" — 실측에서 자연히 Lv3(한계선 10.0) 언저리에 자리 잡는다.
 *    실측(스테이지1 시드 40): 36/40승 · 여유 31.0% · 가동률 5.45% — 타워 몰빵
 *    (36/40 · 33.3%)과 **승수는 같고 여유는 아래**다. 곧 "견줄 만하되 지배하지 않는다".
 *
 *  · **H 기지**   `{ towerReserve: 600, base: {} }`
 *    같은 예비비를 마을 레벨업에 쓴다. 레벨업은 **웨이브 사이의 결정**이라 외곽 루프에
 *    두고(UI도 기지 탭 패널이다) 타워 배치 뒤·업그레이드 앞에 놓는다 —
 *    "방어선은 세우되 강화보다 먼저"다.
 *    예비비 없는 `{ base: {} }`("살 수 있으면 산다")도 함께 잰다 — 그쪽이 플레이어의
 *    자연스러운 행동이고, 4단계 봉투가 그 조합을 아예 재지 않아 지배 전략을 놓쳤다.
 *    비싼 레벨(Lv4·5)까지 보려면 `base.save` 를 켠다 (그 옵션 주석 참조).
 *
 *  · **S 지형**   `{ bulldoze: true }`
 *    더 좋은 등급의 칸을 소품 제거비를 내고 산다. 등급이 **더 나을 때만** 산다.
 *
 *  · **B 균형**   `{ towerReserve: 500, bulldoze: true, allies: { minNear: 3 }, base: { reserve: 400 } }`
 *    네 갈래를 동시에 쓴다. base.reserve 400은 "유닛 몫을 남기고 남는 돈으로만 마을을 올린다".
 *
 *  · **몰빵 대조군** `towerReserve: 2400` + 해당 정책
 *    타워를 굶겨 한 갈래에 몰아넣는다. 봉투 7번이 이 둘의 붕괴를 잠근다.
 *
 * ── 11단계: 봇이 **하한선만이 아니라 상한선도** 된다 ────────────────────────
 * 위의 모든 서술은 "봇이 이기면 사람도 이긴다"는 **하한선**을 만드는 이야기다. 그 하한선
 * 하나로 봉투를 잠그면 난이도가 잘 두는 사람 쪽에서 통째로 무주공산이 된다 — 실제로
 * 그랬다(기준선 160시드 75.6% 대 최강 정책 **100% · 여유 77.6%**). 그래서 같은 구현체에
 * 손잡이 셋(`placement` · `comp` · `refresh`)을 더해 **상한선 봇**(STRONG_BOT)을 만들고,
 * 봉투 1번을 두 팔로 쪼갰다(autoplay.test.ts).
 * 셋 다 **기본값에서는 기존 코드 경로와 한 자리도 다르지 않다** — 하한선 팔의 숫자가
 * 움직이면 두 팔을 비교할 수 없기 때문이다.
 *
 * 파괴 대응은 별도 로직이 필요 없다 — 배치 상한 미만이면 채우는 기존 루프가
 * 부서진 자리를 그대로 다시 짓는다(안전거리 규칙을 그대로 다시 적용하므로 재건설은
 * 자동으로 더 나은 자리를 고른다). 다만 그 골드는 업그레이드에서 빠져나가므로
 * 파괴는 "타워 한 기"가 아니라 "성장 정체"로 청구된다 — placed(총 배치 횟수)와
 * lostGold(파괴로 날아간 누적 투자)가 그 값을 계측한다.
 */
import { createBattle } from '@/sim/battle';
import { buildPath } from '@/sim/path';
import { ALLY_DEFS, BASE_LEVELS, ENEMY_DEFS, TOWER_DEFS, makeWaveFor, stageById } from '@/data';
import { ALLY_SORTIE_RANGE, SIEGE_ENGAGE_RANGE } from '@/data/balance';
import type {
  AllyDef,
  AllyId,
  BaseLevelDef,
  BattleSim,
  EnemyDef,
  EnemyId,
  SimEvent,
  StageDef,
  TowerDef,
  TowerId,
} from '@/data/types';

/**
 * 봇 배치 상한 — 지가 상승으로 8기 이후는 업그레이드가 우세.
 *
 * ⚠ **"상한"이라는 이름과 달리 이 값은 새는 문이다** (코드는 그대로 두고 주석만 정정한다).
 * 외곽 루프의 `else if (st.towers.length >= cap) tryPlace(1.5)` 가 "업그레이드를 살 수
 * 없으면 대신 타워를 하나 더 짓는다"라서, 업그레이드가 비싸지는 후반에는 상한을 넘어
 * 계속 늘어난다. 실측 궤적(스테이지1 · 시드 20 · 기본 봇 · 웨이브별 평균 타워 수):
 *   w11 7.7 / **w12~19 = 정확히 8.0** / w20 8.7 / w25 10.2 / w30 11.6 / w40 15.4 /
 *   w46 **18.9(피크)** / w50 16.1
 * 곧 이 상수가 실제로 상한인 구간은 w12~19뿐이다. 게임 규칙 쪽에는 상한이 아예 없다 —
 * 스테이지1의 배치 가능 칸은 **84칸**(슬롯 12 + 평지 72)이고 소품까지 치우면 **124칸**이라
 * 골드만 있으면 얼마든지 더 지을 수 있다. "8기"는 봇의 절약 정책이지 규칙이 아니다.
 */
export const PLACEMENT_CAP = 8;

/**
 * 봇이 목표로 삼는 경로 이격 거리 — **상수가 아니라 유도값이다.**
 *
 * ── 왜 유도값이어야 하는가 (9단계가 남긴 숙제) ─────────────────────────────
 * 이 값은 원래 "근접(칼 1.5 / 창 1.95)이 절대 닿지 못하는 거리"로 손수 매긴 2.0이었다.
 * 습격대가 전원 원거리(2.2~3.6)가 되자 그 유도는 통째로 무효가 됐는데 **숫자는 그대로
 * 남아** 봇이 "이제는 안전하지 않은 자리"를 안전하다고 믿는 상태가 됐다.
 * 상수로 두는 한 같은 사고가 반복되므로, 이제 **판정을 만드는 쪽 상수에서 직접
 * 유도한다** — 규칙이 바뀌면 값도 따라 바뀌고, 다시는 낡을 수 없다.
 *
 * ── 무엇으로부터 유도하는가 ────────────────────────────────────────────────
 * 지금 이 게임에서 거리가 사는 것은 딱 하나, **정지 사격을 당하지 않는 것**이다
 * (siege.ts 규칙 4-a: 정지 거리 = min(사거리, SIEGE_ENGAGE_RANGE, towerReach)).
 * 정지선 밖의 타워 앞에는 **어떤 종도 멈춰 설 수 없고**, 지나가며 쏘는 사격만 받는다.
 * "완전 무피격"(hexer 3.6 밖 = 4칸)은 유도 대상이 아니다 — 그 거리에서 경로를 덮는
 * 타워가 ballista(5.5) 하나뿐이라 나머지 일곱이 전부 '덮지 못함' 등급으로 떨어져
 * 봇이 도로 경로에 밀착하기 때문이다(= 안전 봇과 밀착 봇이 같아져 4번 항목이 공허해진다).
 *
 * floor+1 인 이유: 타워 좌표는 셀 정수라 실제로 고를 수 있는 이격은 정수 링이다.
 * 정지선 바로 **밖의 첫 정수 링**을 고르면 (a) 정지 사격을 확정으로 피하고
 * (b) 커버 길이(2√(r²−d²))를 최대한 남긴다. 정지선이 정수와 같아지는 경우에도
 * 부등호의 칼날(balance.SIEGE_ENGAGE_RANGE 옛 주석)을 피한다.
 * 지금 값: floor(1.7)+1 = **2.0** (정지선 2.1 시절이었다면 3.0이 됐을 값이다).
 *
 * 공짜가 아니다 — 멀어질수록 경로를 덮는 구간이 짧아져 화력이 준다.
 * 실측(스테이지1 · 시드 20 · spear 기준): 이격 1칸 4.80타일 → 2칸 3.32타일(−31%).
 * 그 대가를 치르고 사는 것이 "정지 사격 비율 42.4% → 1.2%"다.
 */
export const SAFE_DIST = Math.floor(SIEGE_ENGAGE_RANGE) + 1;
/** 사거리 r 타워가 경로를 '덮는다'고 볼 최소 여유 — 접점 하나만 스치는 배치 배제 */
const COVER_MARGIN = 0.3;
/** 경로 폴리라인 샘플 간격 (거리장 계산용) */
const PATH_SAMPLE_STEP = 0.05;

/**
 * 아군 출동 판정 주기 (틱). 외곽 루프(120틱 = 4초)로는 수명 20초짜리 소모품을 제때 못 낸다 —
 * 적이 마을 앞에 닿는 순간과 최대 4초가 어긋나면 이미 늦다. 0.5초마다 본다.
 */
const ALLY_DECIDE_INTERVAL = 15;
/**
 * 기본 출동 트리거의 **여유분** — 감시 창의 길이 = 지금의 출격 한계선 + 이 값.
 *
 * 근거: 아군이 한계선까지 걸어 나가는 동안 적도 다가온다. 적이 대체로 1.0타일/초이므로
 * 한계선보다 6타일 앞에서 뽑으면 적이 한계선에 닿기까지 6초이고, 그동안 아군은
 * clubber(1.15타일/초) 기준 6.9타일을 걷는다 — 둘이 거의 동시에 한계선에 닿는다.
 * 더 일찍 뽑으면 수명 20초 중 상당분을 걸어가는 데 쓰고, 더 늦게 뽑으면 마을 문턱에서 만난다.
 *
 * ── 7단계: 상수 12에서 **유도값**으로 바꿨다 (봇이 마을 투자를 쓸 줄 알게 한다) ──
 * 예전 값 12는 "한계선 6.0 + 여유 6"을 손으로 더해 박아 둔 값이었다. 한계선이 마을
 * 레벨의 함수가 된 지금(Lv1 6.0 → Lv5 12.0, data/hometown.ts) 그 상수를 그대로 두면
 * **마을을 만렙으로 올린 봇이 한계선(12.0)과 같은 거리에서 뽑는다** — 적이 이미 줄에
 * 닿아 있을 때 기지에서 출발하므로 아군은 내내 뒤를 따라가기만 하고, 마을이 사 준
 * 자리를 한 번도 못 쓴다.
 * Lv1에서는 6.0 + 6 = 12로 예전 값과 **정확히 같다** — 마을을 올리지 않는 봇
 * (봉투 7·8번의 유닛 갈래)의 행동은 한 틱도 바뀌지 않는다.
 */
const ALLY_TRIGGER_MARGIN = 6;
/**
 * minNear가 기준으로 삼는 **감시 창의 표준 길이** (타일). Lv1의 창(6.0 + 6)이다.
 *
 * 왜 이게 필요한가: minNear는 "창 안의 마릿수"인데, 창이 한계선과 함께 넓어지면
 * 같은 밀도의 웨이브가 더 많은 마릿수로 세어져 **문턱이 저절로 헐거워진다**.
 * 그러면 봇은 마을을 올릴수록 더 자주 뽑고, 늘어난 지출이 곡선의 효과를 덮어 버린다.
 * 실측(스테이지1 시드 40, AB 아군+마을 봇, 창만 넓히고 문턱은 3 고정):
 *   곡선 평탄6 → 31승·아군골드 7.7% / +1.5 → 29승·8.9% / +2.0 → 29승·8.3% /
 *   +3.0 → 28승·8.6%  — 마을을 올릴수록 나빠진다.
 * 문턱을 창 길이에 비례해 올려 **밀도를 보존**하면:
 *   평탄6 → 31승·7.7% / +1.5 → 32승·6.0% / +2.0 → 36승·6.3% / +3.0 → 34승·7.4%
 * 즉 minNear의 뜻을 "마릿수"에서 "12타일당 마릿수"로 바꾼 것이고, Lv1에서는
 * 비율이 정확히 1이라 예전 봇과 완전히 같다.
 *
 * ⚠ **위 두 표의 승수는 한 시드 표본(시작점 1000)의 값이다** — 8단계에서 시작점을 옮긴
 * 독립 표본 10벌(각 40시드)로 다시 재면 유도 창과 고정 창(12)의 승수 합은 308 대 309로
 * **사실상 같다**(개별 36/31/31/31/27/31/30/31/29/31 대 29/32/33/32/27/31/30/30/30/35).
 * 즉 유도 창이 고정 창보다 낫다는 근거는 승수에 없다. 그래도 유도로 두는 이유는
 * **정의**다 — "마을이 사 준 자리를 쓸 줄 아는 봇"이어야 sortie 열의 A/B가 성립하고,
 * 상수로 두면 만렙 봇이 한계선과 같은 거리에서 뽑아 그 자리를 한 번도 못 쓴다.
 * (밀도 보존 쪽은 다르다 — 그게 없으면 창만 넓어져 지출이 늘고, 그건 승수와 무관하게
 *  "곡선의 효과"와 "더 뽑은 효과"를 섞어 버리는 측정상의 오염이다)
 */
const ALLY_TRIGGER_REF = ALLY_SORTIE_RANGE + ALLY_TRIGGER_MARGIN;

/** 아군 출동 정책 — 어떤 종을 어떤 순서로 뽑는가 */
export type AllyPick = AllyId | 'rotate';

/**
 * 배치 정책 — **0등급(안전 + 커버) 안쪽의 순위만** 바꾼다.
 * 1·2등급(`1000+d` / `2000+d`)과 SAFE_DIST·COVER_MARGIN 규칙은 어느 값에서도 동일하다.
 * 곧 이 손잡이는 "어디에 지어도 되는 자리들 중 무엇을 먼저 고르는가"만 다루고,
 * "안전한가 / 경로를 덮는가"라는 판정 자체는 건드리지 않는다.
 *
 *  · `'near'` — 기본. 0등급 안에서 **경로에 가까울수록** 낫다 (지금까지의 봇 그대로).
 *  · `'cover'` — 그 칸이 **경로를 덮는 길이**가 길수록 낫다. near가 쓰는 이격 d는
 *    커버 길이의 대리 변수인데, 코너에서는 대리가 깨진다(가까워도 짧게 스치는 칸이 있다).
 *  · `'kill'` — 커버 길이에 **기존 커버와의 겹침**을 가중한다. 같은 구간을 여러 타워가
 *    함께 덮으면 그 구간이 킬존이 된다. 8기를 36타일 경로에 고르게 흩으면 어디에서도
 *    적이 죽지 않는다는 것이 이미 실측돼 있다(autoplay 4번 항목 주석의 '펴기' 실패).
 */
export type PlacementMode = 'near' | 'cover' | 'kill';

/** 한 번의 배치 판정에서 허용하는 최대 새로고침 횟수 */
const REFRESH_MAX_PER_DECISION = 6;

export interface BotOptions {
  /**
   * 배치 정책 (기본 `'near'` = 지금까지의 placementKey 그대로).
   * 기본값에서는 키 계산이 한 자리도 바뀌지 않는다.
   */
  placement?: PlacementMode;
  /**
   * **목표 구성** — 타워 종류별 목표 보유 수. 지정하면 배치 시 핸드에서
   * "할당량에 가장 모자란 카드"를 고른다(동점이면 낮은 핸드 인덱스).
   * 할당량을 모두 채운 뒤에는 기본 봇과 똑같이 **핸드 순서**로 되돌아간다 —
   * 그래야 상한을 넘어 짓는 후반 루프(`tryPlace(1.5)`)의 행동이 안 바뀐다.
   *
   * 지정하지 않으면 기본 봇 그대로: **핸드에 먼저 들어온 카드를 그냥 쓴다.**
   * 그게 봉투 헤더가 "핸드 드로우 운"이라 부른 25%의 패배가 나오는 자리다.
   */
  comp?: Partial<Record<TowerId, number>>;
  /**
   * **핸드 새로고침**. 지정하지 않으면 봇은 한 번도 새로고침하지 않는다(기본 봇 그대로).
   * 도는 조건은 넷을 전부 만족할 때뿐이다:
   *   (1) 아직 방어선을 짓는 중(`towers.length < cap`)  (2) `comp` 할당량이 모자란 카드가
   *   핸드에 하나도 없다  (3) 지금 새로고침 값이 `maxPaid` 이하  (4) 예비비를 깨지 않는다.
   * 한 배치 판정당 최대 REFRESH_MAX_PER_DECISION회.
   */
  refresh?: { maxPaid?: number };
  /** 골드로 소품을 치워 더 좋은 자리를 사는 '불도저' 봇 */
  bulldoze?: boolean;
  /** 경로 밀착 배치 — 습격대 이전 시대의 봇 (안전거리를 모른다) */
  hugPath?: boolean;
  /** 손상 타워가 있어도 웨이브를 즉시 호출 — 예전 봇 (수리를 버린다) */
  alwaysRush?: boolean;
  /** 배치 상한 (기본 PLACEMENT_CAP) */
  cap?: number;
  /** 외곽 루프 반복 상한 (1회 = 120틱) */
  maxIters?: number;
  /**
   * **타워 예비비** — 타워 배치/업그레이드가 잔고를 이 값 아래로 떨어뜨리지 않는다.
   *
   * 왜 이게 없으면 배분 측정이 불가능한가: 타워 업그레이드는 T5까지 끝없이 비싸지는
   * 무한 흡수구라, 예비비가 없으면 외곽 루프가 매 회 잔고를 0으로 훑어 간다.
   * 실측(스테이지1 시드 20, 덱 spear+catapult+frost): 타워 99.1% · 잔고 0.9%.
   * 그 상태에서 아군/기지 정책을 켜 봐야 **남는 돈이 없어서** 5% 언저리밖에 못 쓴다 —
   * 즉 "아군에 투자했더니 결과가 안 변하더라"가 아니라 애초에 투자가 안 된 것이다.
   * 예비비를 두면 그만큼이 확정적으로 다른 갈래로 흘러 A/B가 성립한다.
   *
   * **방어선이 다 선 뒤에만 적용된다** (towers.length >= cap). 초기 건설과 파괴 후
   * 재건설은 예비비를 무시한다. 스테이지1 시작 골드가 300이라 예비비를 처음부터
   * 물리면 첫 타워조차 못 짓고 웨이브 8~11에 전멸한다(실측 0/20) — 그건 배분 실험이
   * 아니라 그냥 방치 봇이다. 사람도 "줄부터 세우고 남는 수입을 나눈다".
   */
  towerReserve?: number;
  /**
   * 아군 부족원 출동 정책. 지정하지 않으면 봇은 부족원을 **한 명도** 뽑지 않는다
   * (= 1~3단계까지의 봇 그대로. 봉투의 기준선이 바뀌지 않게 기본값을 유지한다).
   */
  allies?: {
    /** 뽑을 종. 'rotate'는 clubber→slinger→guardian 순환 */
    pick?: AllyPick;
    /**
     * 감시 창의 길이를 **고정**한다 (타일). 지정하지 않으면 `출격 한계선 + 6`으로
     * 매 판정마다 유도한다 — 통제 실험에서 창을 못 박고 싶을 때만 쓴다.
     */
    trigger?: number;
    /**
     * **위급 판정 문턱** — 창 안의 지상 적이 이 수 이상일 때만 출동한다(기본 1).
     * 단위는 **12타일 창 기준 마릿수**다 — 창이 넓어지면 문턱도 비례로 올라간다
     * (ALLY_TRIGGER_REF 주석). 그래서 이 값은 "몇 마리"가 아니라 **밀도**를 뜻한다.
     *
     * 왜 필요한가: 아군은 수명 20초짜리 긴급 자원인데, 문턱이 1이면 봇은 방어선이
     * 멀쩡한 웨이브에도 매번 뽑아 50웨이브 내내 균일하게 골드를 태운다. 실측에서
     * 그렇게 쓴 골드 11%는 위약(효과 0) 대비 +3승어치 일을 했지만, 그 11%를 타워에서
     * 뺀 손해가 그보다 커서 순증은 −1승이었다. **효과가 없는 게 아니라 쓸 자리가
     * 아닌 곳에 썼다.** 문턱을 올리면 "타워가 감당 못 해 여러 마리가 마을 앞까지
     * 밀려온 웨이브"에만 지출이 몰린다.
     */
    minNear?: number;
    /** 이만큼의 골드는 타워 몫으로 남긴다 (기본 0 = 몰빵) */
    reserve?: number;
    /** 동시 유지 인원 상한 (기본 sim의 allyCap) */
    max?: number;
  };
  /**
   * 홈타운 레벨업 정책. 지정하지 않으면 봇은 **레벨업하지 않는다**(Lv1 고정).
   */
  base?: {
    /** 이 레벨까지만 올린다 (기본 최대 레벨) */
    upTo?: number;
    /** 이만큼의 골드는 타워 몫으로 남긴다 (기본 0 = 최우선) */
    reserve?: number;
    /**
     * **다음 레벨 값을 모은다** — 살 수 없으면 그만큼을 타워가 못 쓰게 잠근다.
     *
     * 왜 필요한가: 봇의 외곽 루프는 매 회 잔고를 타워 업그레이드로 훑어 간다.
     * 그래서 "지금 못 사는 것"은 **영원히** 못 산다 — 다음 루프에도 잔고는 그 루프의
     * 수입뿐이고, 그보다 싼 타워 업그레이드가 항상 먼저 그 돈을 가져가기 때문이다.
     * 이 플래그가 없으면 마을은 한 루프 수입(대략 100~300골드)으로 살 수 있는 레벨까지만
     * 올라가고(실측: upTo3·4·5가 전부 평균 Lv3.00으로 동일) 비용 곡선의 뒷부분이
     * **구조적으로 측정 불가**가 된다. 사람은 모아서 산다 — 봇도 그 선택지를 가져야
     * Lv4·5의 성능을 재는 A/B가 성립한다.
     */
    save?: boolean;
  };
  /**
   * **계측 훅** — 사건 하나와 그 사건이 난 웨이브 번호를 그대로 넘긴다.
   * `BotResult`는 판 하나를 한 줄로 압축하므로 "몇 번째 웨이브에서 맞았나"처럼
   * 구간별로 갈라 보는 질문에는 답할 수 없다. 결과 필드를 종류마다 늘리는 대신
   * 훅 하나를 둬서 부르는 쪽이 원하는 것만 세게 한다.
   * 지정하지 않으면 이 기능은 **한 줄도 돌지 않는다**(runBot의 행동·결과 무변).
   */
  onEvent?: (ev: SimEvent, wave: number) => void;
}

export interface BotResult {
  won: boolean;
  wave: number;
  /** 골드로 치운 소품 수 */
  clears: number;
  /** 소품 제거에 쓴 누적 골드 — 불도저 전략의 손익을 파괴 손실과 같은 단위로 잰다 */
  clearGold: number;
  /** 이 판에서 부서진 타워 수 */
  destroyed: number;
  /** 총 배치 횟수 (초기 건설 + 파괴 후 재건설) */
  placed: number;
  /** 파괴된 타워들의 tier 합 — '얼마나 키운 걸 잃었나' */
  lostTiers: number;
  /** 파괴로 날아간 누적 투자 골드 — 죽음의 나선 판정의 핵심 지표 */
  lostGold: number;
  /** 종료 시점 기지 체력 (이겼을 때의 여유 = 승패보다 해상도 높은 난이도 척도) */
  baseHpLeft: number;
  /**
   * 종료 시점 기지 **최대** 체력. 마을 레벨업이 분모를 바꾸므로, 갈래끼리 "여유"를
   * 비교할 때는 반드시 baseHpLeft/baseHpMax로 정규화해야 한다 — 절대값끼리 대면
   * "HP를 산 쪽이 당연히 많이 남는" 자명한 결과를 우위로 오독하게 된다.
   */
  baseHpMax: number;
  /** 종료 시점 홈타운 레벨 (레벨업 정책이 없으면 항상 1) */
  baseLevel: number;
  /** 출동시킨 부족원 누적 수 */
  alliesTrained: number;
  /**
   * 아군이 살아 있던 누적 "인원×틱". 골드가 실제로 **얼마나 오래** 전장에 있었는지.
   * 출동 횟수만으로는 6명이 20초 서 있는 것과 1명이 2분 서 있는 것을 구분할 수 없다.
   */
  allyTicks: number;
  /**
   * 그중 **적을 붙잡고 있던 아군 인원**×틱. allyTicks 대비 비율이 곧 가동률이다.
   * 아군의 존재 이유가 봉쇄(allies.ts 규칙 5)이므로, 이 비율이 낮으면
   * "수치가 약하다"가 아니라 **쓰이지 않는 자리에 서 있다**는 뜻이다.
   *
   * ⚠ 예전에는 이 자리에서 **봉쇄당한 적의 마릿수**를 셌다. ALLY_BLOCK_CAPACITY가 3이라
   * 아군 한 명이 한 틱에 최대 3을 올리므로 allyTicks의 부분집합이 아니었고(비율이 300%까지
   * 나올 수 있다) 라벨과 실제가 어긋났다. 실측 대조(스테이지1 시드 1000, minNear 1):
   * 아군틱 19,363 · 적 마릿수 기준 1,837(9.5%) · **아군 인원 기준 834(4.3%)** — 2.2배 차이다.
   * 적 쪽 수치가 필요하면 enemyBlockedTicks를 쓴다.
   */
  allyBlockTicks: number;
  /** 봉쇄당한 **적**의 마릿수×틱 (아군 한 명이 최대 ALLY_BLOCK_CAPACITY마리까지 올린다) */
  enemyBlockedTicks: number;
  /**
   * 봉쇄가 일어난 지점 중 **스폰에 가장 가까웠던 거리** (타일, 경로 호장. 봉쇄 0이면 Infinity).
   *
   * 왜 이 지표인가: 출격 한계선(allies.ts 규칙 2)이 막으려는 것은 단 하나,
   * **"아군이 적 스폰 지점까지 걸어가 웨이브를 입구에서 요격해 타워가 무의미해지는 것"**이다.
   * 한계선 값(타일)은 절대치인데 경로 길이는 스테이지마다 두 배 넘게 차이 나므로
   * (s4 17.59 ~ s1 36.19), 값만 봐서는 그 붕괴가 일어났는지 알 수 없다.
   * 이 지표는 결과 쪽에서 직접 잰다 — 작을수록 입구에 가깝다.
   */
  allyBlockMinDist: number;
  /** 홈타운이 쏜 화살 수 — "마을 방어 기능이 실제로 작동하는가"의 직접 지표 */
  baseShots: number;
  /** 홈타운 화살이 넣은 누적 피해 */
  baseDamage: number;
  /**
   * 홈타운 화살이 **마지막 한 대**가 된 처치 수.
   * 이 지표가 핵심인 이유: 기지 사거리 안의 적은 어차피 곧 누수되어 사라지므로,
   * **죽이지 못한 피해는 시뮬레이션에 아무 흔적을 남기지 않는다**(누수 피해는 적의
   * 남은 HP와 무관하다). 즉 기지 화력의 값어치는 baseDamage가 아니라 baseKills가 잰다.
   */
  baseKills: number;
  /**
   * 기지가 받은 누적 누수 피해. 승패보다 해상도가 높다 —
   * 스테이지1은 웨이브 47~50에서 잔여 HP 4~20으로 판가름 나므로,
   * 승수는 ±2가 노이즈이지만 누수 피해는 같은 시드에서 결정론적으로 재현된다.
   */
  leaked: number;
  /** 기지까지 흘러 들어간 적 마릿수 */
  leaks: number;
  // ── 골드 배분 계측 (네 갈래가 전부 살아 있는지 재는 단위) ──────────────────
  /** 타워에 넣은 누적 골드 (배치 + 업그레이드) */
  goldTowers: number;
  /** 부족원 출동에 쓴 누적 골드 */
  goldAllies: number;
  /** 홈타운 레벨업에 쓴 누적 골드 */
  goldBase: number;
  /** 소품 제거에 쓴 누적 골드 (= clearGold, 배분표에서 같은 단위로 읽으려고 둘 다 둔다) */
  goldScenery: number;
  /** 이 판에서 번 총 골드 = 지출 합 + 잔고 − 시작 골드 */
  goldEarned: number;
  /**
   * 방어선이 다 서고 난 뒤(웨이브 MIN_TOWERS_FROM_WAVE 이후) 관측된 최소 타워 수.
   * 죽음의 나선(부서진 만큼 다시 못 짓고 계속 줄어드는 상태)의 직접 지표다.
   */
  minTowers: number;
}

/**
 * minTowers 계측 시작 웨이브.
 *
 * 10 → 15로 올렸다. 10에서는 봇이 아직 방어선을 **짓는 중**이라(스테이지1 실측에서
 * 웨이브 10의 타워 수가 5~8) 계측값이 "붕괴의 깊이"가 아니라 "건설 진도"를 재게 된다.
 * 그 탓에 `minTowers >= 5` 가드가 구조적으로 무력했다 — 실제로 웨이브 47~49에
 * 18→10으로 무너지는 판에서도 minTowers는 6~8(=웨이브 10의 건설 진도)이었다.
 * 웨이브 15면 배치 상한 8기가 다 서 있어(전 시드 실측 8) 그 뒤의 하락은 전부
 * **파괴를 못 메운 몫**이다. 판별력 실측(습격대 towerAttack.dmg 배율 A/B, 시드 12):
 *   ×1 → 전 시드 8, ×3 → 5~7, ×6 → 0~4. 하한 7이면 ×1은 통과, ×3부터 걸린다.
 *
 * ⚠ **"웨이브 15면 8기가 다 서 있다"는 w12~19에서만 참이다.** PLACEMENT_CAP이 새는 문이라
 * (그 주석의 궤적 참조) w20부터 타워 수가 8을 넘어가고 w46에는 평균 19.1기가 된다.
 * 곧 이 가드의 판별력은 "창이 상한에 붙어 있는 구간"에서 나오는 것이므로, 창을 뒤로
 * 옮기면(예: 25) **하한 7이 조용히 무력해진다** — 그때는 이미 12~13기가 서 있어서
 * 파괴 대여섯 기를 먹어도 7 아래로 안 내려간다. 창을 옮길 거면 하한도 같이 다시 유도하라.
 */
export const MIN_TOWERS_FROM_WAVE = 15;

export function makeBotSim(
  stageId: number,
  seed: number,
  deck: TowerId[],
  stars = 0,
  endless = false,
): { sim: BattleSim; stage: StageDef } {
  const stage = stageById(stageId);
  if (!stage) throw new Error(`no stage ${stageId}`);
  return { sim: makeBotSimFor(stage, seed, deck, stars, endless), stage };
}

/**
 * 스테이지 객체를 직접 넘기는 형태 — A/B용 변형 스테이지에 쓴다.
 * baseLevels / allyDefTable을 넘기면 홈타운·부족원 수치를 갈아 끼워 잴 수 있다
 * (기본은 실제 데이터). `BattleOptions`가 둘 다 **주입 필수** 필드라 밸런스 A/B가
 * 모듈 상수를 건드리지 않고도 가능하다 — 4단계 튜닝은 전부 이 손잡이로 쟀다.
 */
export function makeBotSimFor(
  stage: StageDef,
  seed: number,
  deck: TowerId[],
  stars = 0,
  endless = false,
  baseLevelTable: readonly BaseLevelDef[] = BASE_LEVELS,
  allyDefTable: Readonly<Record<AllyId, AllyDef>> = ALLY_DEFS,
  /**
   * 적 정의 표. 위 둘과 같은 취지의 주입구다 — 한 종의 수치만 갈아 끼운 대조군을
   * 만들 때 쓴다. **`makeWaveFor`는 모듈 상수 ENEMY_DEFS를 쓰므로 편성은 안 바뀐다**:
   * hp·cost를 건드리지 않는 한 대조군과 실험군의 웨이브가 바이트 단위로 같다
   * (raidmeasure.test.ts가 정확히 이 성질 위에 서 있다).
   */
  enemyDefTable: Readonly<Record<EnemyId, EnemyDef>> = ENEMY_DEFS,
): BattleSim {
  const starMap: Partial<Record<TowerId, number>> = {};
  for (const id of deck) starMap[id] = stars;
  const sim = createBattle({
    stage,
    stars: starMap,
    deck,
    endless,
    seed,
    towerDefs: TOWER_DEFS,
    enemyDefs: enemyDefTable,
    allyDefs: allyDefTable,
    baseLevels: baseLevelTable,
    waveFor: makeWaveFor(stage),
  });
  return sim;
}

/**
 * 지상 경로 폴리라인의 등간격 샘플 (간격 PATH_SAMPLE_STEP).
 * 래스터 셀이 아니라 **실제 주행 폴리라인**(buildPath, 코너 라운딩 포함)이다 —
 * 안전거리 판정이 1.95 대 2.0 의 0.05 차이를 다투기 때문에 코너에서 안쪽으로 잘리는
 * 실제 경로를 그대로 재야 한다. 거리장(pathDistances)과 커버 길이 계산이 **같은 배열**을
 * 쓴다 — 둘이 다른 샘플을 보면 "가깝다"와 "덮는다"가 서로 어긋난다.
 */
function pathSamples(stage: StageDef): { xs: Float64Array; zs: Float64Array } {
  const xs: number[] = [];
  const zs: number[] = [];
  const p = { x: 0, z: 0, heading: 0 };
  for (const wp of stage.paths) {
    const path = buildPath(wp);
    for (let d = 0; d <= path.totalLength; d += PATH_SAMPLE_STEP) {
      path.sample(d, p);
      xs.push(p.x);
      zs.push(p.z);
    }
    path.sample(path.totalLength, p);
    xs.push(p.x);
    zs.push(p.z);
  }
  return { xs: Float64Array.from(xs), zs: Float64Array.from(zs) };
}

/** 셀 중심 → 지상 경로까지의 최단 거리 */
function pathDistances(stage: StageDef, s: { xs: Float64Array; zs: Float64Array }): Float64Array {
  const out = new Float64Array(stage.gridW * stage.gridH);
  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      let best = Infinity;
      for (let i = 0; i < s.xs.length; i++) {
        const dx = (s.xs[i] as number) - x;
        const dz = (s.zs[i] as number) - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      out[z * stage.gridW + x] = Math.sqrt(best);
    }
  }
  return out;
}

/** 이 타워는 경로를 덮어야 쓸모가 있는가 (drum 은 아니다 — 아군 버프 오라) */
function needsPathCoverage(def: TowerDef): boolean {
  return def.canTargetGround || def.canTargetAir;
}

/**
 * 배치 후보의 순위 키 (작을수록 좋다).
 * 0번대 = 경로를 덮으면서 근접 사거리 밖 / 1번대 = 덮지만 노출 / 2번대 = 못 덮음.
 * 같은 등급 안에서는 경로에 가까울수록(=커버 길이가 길수록) 낫다.
 *
 * `grade0`은 **0등급 안쪽의 순위만** 갈아 끼운다(BotOptions.placement). 넘기지 않으면
 * 예전과 완전히 같은 `d`다. 등급 경계(SAFE_DIST·COVER_MARGIN)와 1·2등급 키는 어느
 * 정책에서도 손대지 않는다 — 그쪽을 건드리면 봉투 4번(밀착 배치)이 재는 축이 달라진다.
 * 0등급 키는 음수가 되지만 1등급(1000+d)과 겹치지 않으므로 등급 순서는 그대로다.
 */
function placementKey(def: TowerDef, d: number, hugPath: boolean, grade0?: number): number {
  if (hugPath) return d; // 예전 봇 — 안전 개념 없음, 무조건 최근접
  if (!needsPathCoverage(def)) {
    // drum: 경로 커버가 무의미하다. 안전한 칸을 고르되 타워 무리와 떨어지지 않게
    // 경로에서 너무 멀어지지도 않는다(오라 반경 2.0 안에 아군이 있어야 한다).
    return (d >= SAFE_DIST ? 0 : 1000) + Math.abs(d - SAFE_DIST);
  }
  const r = def.tiers[0]?.range ?? 2.5;
  const covers = d <= r - COVER_MARGIN;
  if (covers && d >= SAFE_DIST) return grade0 ?? d;
  if (covers) return 1000 + d;
  return 2000 + d;
}

/**
 * 사람 실력의 **상한 대리**. 기준선 봇(runBot 기본값)이 "대충 두는 사람"이라면 이쪽은
 * "잘 두는 사람"이고, 봉투는 이제 둘 사이를 잠근다.
 *
 * 왜 이 셋인가 — 기준선 160시드 121/160(75.6%) · 여유 24.6~27.6%를 100% 완주로 올린
 * 것은 정확히 이 셋뿐이다(각각 단독 40시드): 킬존 배치 33/40 → 39/40(여유 27.6 → 66.9%),
 * 목표 구성 + 새로고침 33/40 → 40/40(판당 새로고침 0.8회 · 4골드). 둘을 겹치면 40/40.
 * 봇이 이미 알던 손잡이는 상한을 못 올린다 — cap 4~12 전 구간 무변(33~35/40),
 * 조기호출 −1승, 불도저 +2승, **아군 −11승 · 마을 −3승**(잘 두는 사람에게는 순손해다).
 *
 * `cap`·`allies`·`base`·`alwaysRush`·`bulldoze`를 일부러 넣지 않은 이유가 그것이다 —
 * 상한을 만들지 못하는 손잡이를 기준점에 섞으면 기준점이 흐려지기만 한다.
 *
 * ⚠ **12단계 정정: 위 "아군 −11승"은 11단계 이전 상태의 값이고, 지금은 참이 아니다.**
 * w50 클라이맥스 복원 뒤 최강 봇의 결과는 **오직 w50의 trex 한 마리**가 정한다 —
 * 40시드 전부가 40/40 승 · 종료 기지 HP 13으로 완전히 같은 값이다. 그 위에서 아군을
 * 켜고 다시 재면(예비비 600 · minNear 1, 40시드):
 *   최강           40/40 · 잔여합 520 · 아군골드 0
 *   최강 + 아군    40/40 · 잔여합 **520** · 아군골드 66,943 · 봉쇄 924틱
 * 곧 판당 1,674골드를 태우고 실제로 924틱을 붙잡는데 **결과가 한 자리도 안 바뀐다.**
 * 아군은 이제 최강 정책에게 손해도 이득도 아니다 — 그 골드가 사는 것(누수 방지)이
 * 이 봇에게는 이미 0이고, 태워도 남는 골드로 타워를 더 올릴 자리가 없기 때문이다.
 * (minNear 3에서는 아예 한 명도 안 뽑는다 — 마을 앞에 적이 셋 모이는 일이 없다)
 *
 * 구성이 `{catapult: 8}`(몰빵)이 아닌 이유: 스테이지1에 비행 적이 하나도 없어서 성립하는
 * 값이라 기준점으로 부적절하다. 2/5/1은 대공 2기(spear)를 남긴다.
 */
export const STRONG_BOT: BotOptions = {
  placement: 'kill',
  comp: { spear: 2, catapult: 5, frost: 1 },
  refresh: { maxPaid: 80 },
};

/**
 * 봇 1판 실행. 외곽 루프 1회 = 커맨드 한 묶음 + 120틱.
 * 파괴로 타워 수가 줄면 배치 루프가 자동으로 빈 자리를 채운다(= 재건설).
 */
export function runBot(sim: BattleSim, stage: StageDef, opts: BotOptions = {}): BotResult {
  const bulldoze = opts.bulldoze === true;
  const hugPath = opts.hugPath === true;
  const maxIters = opts.maxIters ?? 900;
  const cap = opts.cap ?? PLACEMENT_CAP;
  const samples = pathSamples(stage);
  const dist = pathDistances(stage, samples);
  const cells: [number, number][] = [];
  for (let z = 0; z < stage.gridH; z++) {
    for (let x = 0; x < stage.gridW; x++) {
      if (sim.canPlaceAt(x, z) || (bulldoze && sim.hasScenery(x, z))) cells.push([x, z]);
    }
  }
  const distOf = ([x, z]: [number, number]): number => dist[z * stage.gridW + x] as number;

  // ── 커버 계산 (placement 'cover'/'kill' 전용, 'near'에서는 한 번도 호출되지 않는다) ──
  const placeMode: PlacementMode = opts.placement ?? 'near';
  const nSamples = samples.xs.length;
  /** (셀, 사거리) → 그 원 안에 든 경로 샘플 인덱스. 셀×사거리 조합이 유한해 캐시 하나면 끝난다 */
  const coverCache = new Map<string, Int32Array>();
  const coveredBy = (cx: number, cz: number, r: number): Int32Array => {
    const key = `${cx},${cz},${r}`;
    const hit = coverCache.get(key);
    if (hit) return hit;
    const idx: number[] = [];
    const r2 = r * r;
    for (let i = 0; i < nSamples; i++) {
      const dx = (samples.xs[i] as number) - cx;
      const dz = (samples.zs[i] as number) - cz;
      if (dx * dx + dz * dz <= r2) idx.push(i);
    }
    const out = Int32Array.from(idx);
    coverCache.set(key, out);
    return out;
  };
  const rangeOf = (def: TowerDef): number => def.tiers[0]?.range ?? 2.5;
  /** 지금 서 있는 타워들이 각 경로 샘플을 몇 겹으로 덮고 있는가 (배치 판정 직전에 갱신) */
  const coverCount = new Int32Array(nSamples);
  const recountCover = (): void => {
    coverCount.fill(0);
    for (const t of sim.state.towers) {
      const d = TOWER_DEFS[t.defId];
      if (!needsPathCoverage(d)) continue;
      for (const i of coveredBy(t.cellX, t.cellZ, rangeOf(d))) coverCount[i] = (coverCount[i] as number) + 1;
    }
  };
  /**
   * 0등급 안쪽 순위. 'cover'는 커버 길이, 'kill'은 **겹침을 가중한** 커버 길이다
   * (그 샘플을 이미 덮는 타워 한 기당 +0.5배). 둘 다 클수록 좋으므로 부호를 뒤집는다.
   */
  const grade0Of = (def: TowerDef, cx: number, cz: number): number | undefined => {
    if (placeMode === 'near') return undefined;
    const idx = coveredBy(cx, cz, rangeOf(def));
    if (placeMode === 'cover') return -idx.length * PATH_SAMPLE_STEP;
    let w = 0;
    for (const i of idx) w += 1 + 0.5 * (coverCount[i] as number);
    return -w * PATH_SAMPLE_STEP;
  };
  const keyOf = (def: TowerDef, c: [number, number]): number =>
    placementKey(def, distOf(c), hugPath, grade0Of(def, c[0], c[1]));

  let clears = 0;
  let clearGold = 0;
  let destroyed = 0;
  let placed = 0;
  let lostTiers = 0;
  let lostGold = 0;
  let minTowers = Infinity;
  let goldTowers = 0;
  let goldAllies = 0;
  let goldBase = 0;
  let alliesTrained = 0;
  let allyTicks = 0;
  let allyBlockTicks = 0;
  let enemyBlockedTicks = 0;
  let allyBlockMinDist = Infinity;
  let baseShots = 0;
  let baseDamage = 0;
  let baseKills = 0;
  let leaked = 0;
  let leaks = 0;
  /** 적 id → 마지막으로 피해를 준 출처. enemyDied에 출처가 없어 여기서 귀속시킨다 */
  const lastHit = new Map<number, string>();
  /** 봉쇄 중인 아군 id 집계용 스크래치 (매 틱 재사용 — 할당 없음) */
  const engaged = new Set<number>();
  /** 틱 진행 직전 스냅샷 — 파괴 이벤트에는 invested가 없으므로 여기서 조회한다 */
  const investedById = new Map<number, number>();

  // ── 아군/기지 정책 준비 ────────────────────────────────────────────────────
  /** 경로별 총 길이 — 적의 '기지까지 남은 거리' = totalLength − enemy.dist */
  const pathLens = stage.paths.map((wp) => buildPath(wp).totalLength);
  const allyPolicy = opts.allies;
  /**
   * 지금의 출동 트리거 거리. 고정하지 않고 **매 판정마다 다시 읽는다** —
   * 한계선이 마을 레벨과 함께 자라므로(sim.allySortieRange) 여기도 같이 자라야
   * 봇이 마을에 낸 값을 실제로 쓴다 (ALLY_TRIGGER_MARGIN 주석).
   */
  const allyTriggerNow = (): number =>
    allyPolicy?.trigger ?? sim.allySortieRange() + ALLY_TRIGGER_MARGIN;
  const allyMinNear = Math.max(1, allyPolicy?.minNear ?? 1);
  /** 밀도 보존 — 창이 넓어지면 문턱도 같은 비율로 올린다 (ALLY_TRIGGER_REF 주석) */
  const allyMinNearNow = (trigger: number): number =>
    Math.max(1, Math.round((allyMinNear * trigger) / ALLY_TRIGGER_REF));
  const allyReserve = allyPolicy?.reserve ?? 0;
  const allyOrder: AllyId[] =
    allyPolicy === undefined || allyPolicy.pick === undefined || allyPolicy.pick === 'rotate'
      ? ['clubber', 'slinger', 'guardian']
      : [allyPolicy.pick];
  let allyTurn = 0;

  /**
   * 아군 출동 판정 — "마을 앞까지 온 지상 적이 있으면 뽑는다".
   * 전진 중인 적만이 아니라 **이미 봉쇄된 적도** 트리거로 센다: 앞줄이 붙잡고 있는
   * 동안 뒷사람을 채워 넣지 않으면 줄이 한 명씩 갈려 나가기만 한다.
   */
  const stepAllies = (): void => {
    if (!allyPolicy) return;
    const st = sim.state;
    if (st.phase !== 'wave') return;
    const max = allyPolicy.max ?? st.allyCap;
    if (st.allies.length >= max) return;
    const trigger = allyTriggerNow();
    let near = 0;
    for (const e of st.enemies) {
      if (e.flying) continue;
      const len = pathLens[e.pathIndex] ?? 0;
      if (len - e.dist <= trigger) near++;
    }
    if (near < allyMinNearNow(trigger)) return;
    const defId = allyOrder[allyTurn % allyOrder.length] as AllyId;
    const cost = sim.allyCost(defId);
    if (st.gold - cost < allyReserve) return;
    if (!sim.canTrainAlly(defId)) return;
    if (sim.applyCommand({ type: 'trainAlly', defId })) {
      goldAllies += cost;
      alliesTrained++;
      allyTurn++;
    }
  };

  /** 홈타운 레벨업 판정 — 예비비를 남기고 다음 한 칸을 산다 */
  const stepBase = (): void => {
    const p = opts.base;
    if (!p) return;
    const st = sim.state;
    if (st.baseLevel >= (p.upTo ?? st.baseLevelMax)) return;
    const cost = sim.baseUpgradeCost();
    if (cost === null || st.gold - cost < (p.reserve ?? 0)) return;
    if (!sim.canUpgradeBase()) return;
    if (sim.applyCommand({ type: 'upgradeBase' })) goldBase += cost;
  };

  /**
   * 이 카드로 지금 지을 최적의 빈 칸. 불도저 봇은 더 좋은 등급의 소품 칸을 만나면
   * (제거비 + 배치비)를 감당할 수 있는 한 골드를 내고 산다.
   */
  const pickCell = (towerId: TowerId, placeCost: number): [number, number] | undefined => {
    const def = TOWER_DEFS[towerId];
    let bestFree: [number, number] | undefined;
    let bestFreeKey = Infinity;
    let bestBuy: [number, number] | undefined;
    let bestBuyKey = Infinity;
    if (placeMode === 'kill') recountCover(); // 겹침 가중이 있는 정책에서만 필요하다
    for (const c of cells) {
      const key = keyOf(def, c);
      if (sim.canPlaceAt(c[0], c[1])) {
        if (key < bestFreeKey) {
          bestFreeKey = key;
          bestFree = c;
        }
      } else if (bulldoze && key < bestBuyKey) {
        const clear = sim.clearSceneryCost(c[0], c[1]);
        if (clear !== null && sim.state.gold >= clear + placeCost) {
          bestBuyKey = key;
          bestBuy = c;
        }
      }
    }
    // 소품을 치워서 얻는 자리가 **더 좋을 때만** 산다 (같거나 나쁘면 낭비)
    if (bestBuy && bestBuyKey < bestFreeKey) {
      const paid = sim.clearSceneryCost(bestBuy[0], bestBuy[1]) ?? 0;
      if (sim.applyCommand({ type: 'clearScenery', cellX: bestBuy[0], cellZ: bestBuy[1] })) {
        clears++;
        clearGold += paid;
        return bestBuy;
      }
    }
    return bestFree;
  };

  const rawReserve = opts.towerReserve ?? 0;
  /**
   * 방어선(cap기) 이 다 서기 전에는 예비비가 없다 — 위 towerReserve 주석의 근거.
   * base.save 가 켜져 있으면 **다음 마을 레벨 값**도 타워가 못 건드리게 얹는다.
   */
  const reserveNow = (): number => {
    if (sim.state.towers.length < cap) return 0;
    let r = rawReserve;
    const p = opts.base;
    if (p?.save === true && sim.state.baseLevel < (p.upTo ?? sim.state.baseLevelMax)) {
      r += sim.baseUpgradeCost() ?? 0;
    }
    return r;
  };

  // ── 목표 구성 / 핸드 새로고침 (둘 다 지정하지 않으면 기본 봇과 한 틱도 다르지 않다) ──
  const comp = opts.comp;
  const refreshMaxPaid = opts.refresh?.maxPaid;
  /** 이 종의 할당량에서 몇 기가 모자란가 (할당량이 없으면 0 이하) */
  const deficitOf = (id: TowerId): number => {
    const want = comp?.[id] ?? 0;
    let have = 0;
    for (const t of sim.state.towers) if (t.defId === id) have++;
    return want - have;
  };
  /**
   * 이번 배치 판정에서 카드를 볼 순서.
   * comp가 있고 모자란 카드가 있으면 **부족분이 큰 순서**(동점이면 핸드 인덱스 순),
   * 아니면 기본 봇 그대로 **핸드 인덱스 순**이다.
   */
  const handOrder = (): number[] => {
    const st = sim.state;
    const plain = st.hand.map((_, i) => i).filter((i) => st.hand[i]);
    if (!comp) return plain;
    const want = plain
      .map((i) => ({ i, d: deficitOf((st.hand[i] as { towerId: TowerId }).towerId) }))
      .filter((e) => e.d > 0)
      .sort((a, b) => b.d - a.d || a.i - b.i);
    return want.length > 0 ? want.map((e) => e.i) : plain;
  };
  /** 핸드에 '할당량이 모자란 카드'가 하나라도 있는가 (새로고침을 도는 유일한 반대 조건) */
  const handHasWanted = (): boolean => {
    const st = sim.state;
    if (!comp) return true;
    return st.hand.some((c) => c && deficitOf(c.towerId) > 0);
  };

  const tryPlace = (goldFactor: number): void => {
    const st = sim.state;
    // 새로고침 — 방어선을 짓는 중이고, 원하는 카드가 하나도 없고, 값이 싸고, 예비비를 안 깰 때만.
    // 판당 실측 0.8회 · 4골드짜리 행동인데 봉투 헤더가 "핸드 드로우 운"이라 부른 패배를 지운다.
    if (refreshMaxPaid !== undefined && st.towers.length < cap) {
      for (let n = 0; n < REFRESH_MAX_PER_DECISION && !handHasWanted(); n++) {
        const cost = st.refreshCost;
        if (cost > refreshMaxPaid) break;
        if (st.gold - cost < reserveNow()) break;
        if (!sim.applyCommand({ type: 'refreshHand' })) break;
        goldTowers += cost;
      }
    }
    for (const h of handOrder()) {
      const card = st.hand[h];
      if (!card) continue;
      if (st.gold < card.cost * goldFactor) continue;
      if (st.gold - card.cost < reserveNow()) continue;
      const cell = pickCell(card.towerId, card.cost);
      if (!cell) break;
      const paid = card.cost;
      if (sim.applyCommand({ type: 'placeTower', handIndex: h, cellX: cell[0], cellZ: cell[1] })) {
        placed++;
        goldTowers += paid;
      }
      break;
    }
  };

  /**
   * 사건 집계 — 외곽 루프 끝(기본)이든 매 틱(계측 훅)이든 **같은 함수**가 처리한다.
   * 두 자리에 같은 코드를 두면 훅을 켠 판과 끈 판의 결과가 갈라질 수 있다.
   */
  const handleEvent = (ev: SimEvent): void => {
    if (ev.type === 'towerDestroyed') {
      destroyed++;
      lostTiers += ev.tier;
      lostGold += investedById.get(ev.towerId) ?? 0;
    } else if (ev.type === 'baseDamaged') {
      leaked += ev.amount;
      leaks++;
    } else if (ev.type === 'baseFired') {
      baseShots++;
    } else if (ev.type === 'enemyDamaged') {
      if (ev.source === 'hometown') baseDamage += ev.amount;
      lastHit.set(ev.enemyId, ev.source);
    } else if (ev.type === 'enemyDied') {
      if (lastHit.get(ev.enemyId) === 'hometown') baseKills++;
      lastHit.delete(ev.enemyId);
    }
  };
  const onEvent = opts.onEvent;

  let guard = 0;
  while (sim.state.phase !== 'won' && sim.state.phase !== 'lost' && guard < maxIters) {
    guard++;
    const st = sim.state;
    if (st.towers.length < cap) tryPlace(1);
    // 홈타운 레벨업은 **웨이브 사이의 결정**이라 외곽 루프에 둔다 (UI도 기지 탭 패널이다).
    // 타워 배치 뒤·업그레이드 앞에 놓아 "방어선은 세우되 강화보다 먼저"가 되게 한다 —
    // 예비비(reserve)를 크게 주면 반대로 '남는 돈으로만' 사는 봇이 된다.
    stepBase();
    // 최다투자 타워 집중 업그레이드 (소수 정예)
    let best: { id: number; inv: number; cost: number } | null = null;
    for (const t of st.towers) {
      const c = sim.upgradeCost(t.id);
      if (c !== null && st.gold - c >= reserveNow() && (!best || t.invested > best.inv)) {
        best = { id: t.id, inv: t.invested, cost: c };
      }
    }
    if (best) {
      const paid = best.cost;
      if (sim.applyCommand({ type: 'upgradeTower', towerId: best.id })) goldTowers += paid;
    } else if (st.towers.length >= cap) tryPlace(1.5);
    // 조기 호출: 성한 타워만 있을 때만 (손상 중이면 준비 시간을 수리로 쓴다)
    if (st.phase === 'prep' && st.prepTicksLeft > 0) {
      const damaged = opts.alwaysRush !== true && st.towers.some((t) => t.hp < t.maxHp);
      if (!damaged) sim.applyCommand({ type: 'callWave' });
    }
    investedById.clear();
    for (const t of st.towers) investedById.set(t.id, t.invested);
    for (let i = 0; i < 120; i++) {
      sim.tick();
      const s = sim.state;
      if (s.phase === 'wave' && s.waveIndex >= MIN_TOWERS_FROM_WAVE && s.towers.length < minTowers) {
        minTowers = s.towers.length;
      }
      if (s.allies.length > 0) {
        allyTicks += s.allies.length;
        // 라벨대로 **교전 중인 아군 인원**을 센다 (한 명이 여러 마리를 묶어도 1)
        engaged.clear();
        for (const e of s.enemies) {
          if (e.blockerAllyId < 0) continue;
          enemyBlockedTicks++;
          engaged.add(e.blockerAllyId);
          // 입구 요격 감시 — 봉쇄 지점이 스폰(dist 0)에 얼마나 가까웠나
          if (e.dist < allyBlockMinDist) allyBlockMinDist = e.dist;
        }
        allyBlockTicks += engaged.size;
      }
      // 아군만 외곽 루프가 아니라 틱 루프 안에서 본다 — 수명 20초짜리 긴급 자원이라
      // 4초 늦으면 이미 늦다 (ALLY_DECIDE_INTERVAL 주석)
      if (allyPolicy && i % ALLY_DECIDE_INTERVAL === 0) stepAllies();
      // 계측 훅이 있을 때만 **매 틱** 비운다 — 웨이브 번호를 사건과 같은 틱에서 읽어야
      // "몇 번째 웨이브에서 맞았나"가 성립하기 때문이다. 훅이 없으면 한 줄도 안 돈다.
      if (onEvent) {
        for (const ev of sim.drainEvents()) {
          handleEvent(ev);
          onEvent(ev, sim.state.waveIndex);
        }
      }
    }
    for (const ev of sim.drainEvents()) handleEvent(ev);
  }
  const spent = goldTowers + goldAllies + goldBase + clearGold;
  return {
    won: sim.state.phase === 'won',
    wave: sim.state.waveIndex,
    clears,
    clearGold,
    destroyed,
    placed,
    lostTiers,
    lostGold,
    baseHpLeft: sim.state.baseHp,
    baseHpMax: sim.state.baseHpMax,
    baseLevel: sim.state.baseLevel,
    alliesTrained,
    allyTicks,
    allyBlockTicks,
    enemyBlockedTicks,
    allyBlockMinDist,
    baseShots,
    baseDamage,
    baseKills,
    leaked,
    leaks,
    goldTowers,
    goldAllies,
    goldBase,
    goldScenery: clearGold,
    goldEarned: spent + sim.state.gold - stage.startGold,
    minTowers: minTowers === Infinity ? 0 : minTowers,
  };
}
