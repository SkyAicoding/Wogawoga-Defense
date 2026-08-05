/**
 * 아군 부족 유닛 3종 — 마을에서 골드로 뽑아 경로로 내보내는 **소모품** 전력.
 * 행동 규칙 전문은 src/sim/allies.ts 헤더 주석. 여기는 수치와 역할 분리만 적는다.
 *
 * ── 왜 3종인가 ─────────────────────────────────────────────────────────────
 * 적 습격대 4종이 "근접 둘 · 원거리 둘"로 갈리듯, 아군도 **막는 쪽 둘 · 쏘는 쪽 하나**로
 * 나눈다. 한 종만 두면 출동 버튼이 곧 "골드를 체력으로 바꾸는 레버"라 판단이 없고,
 * 다섯 종을 두면 웨이브 도중에 고를 수 있는 폭을 넘어선다(긴급 자원은 1탭이어야 한다).
 *
 * 역할:
 *  · clubber  = 기준점. 싸고 빠르고 잘 때린다. 대신 오래 못 버틴다.
 *  · guardian = 시간을 사는 카드. 피해는 clubber의 절반인데 hp는 2.3배 —
 *               "죽이려고" 내보내는 게 아니라 **한 놈을 오래 세워 두려고** 내보낸다.
 *  · slinger  = 유일하게 공중을 치고, 유일하게 아무도 막지 못한다.
 *               막지 못하는 대신 앞의 근접 아군 뒤에서 안전하게 딜을 넣는다
 *               (적은 **자기를 막은 아군만** 반격한다 — allies.ts 규칙 5).
 *
 * ── 수치의 기준선 ──────────────────────────────────────────────────────────
 * 타워 T1 배치가 90~150골드다. clubber 40은 그 절반 이하 — 되돌아오지 않는 20초짜리이므로
 * 영구 구조물보다 싸야 한다. 6명을 다 채우면 398골드(ALLY_COST_GROWTH 1.20)로
 * 스테이지1 시작 골드의 1.3배 — "이번 웨이브를 넘길 것인가 다음을 준비할 것인가"가
 * 실제 선택이 되는 크기다.
 *
 * 수명 600틱(20초)은 웨이브 하나가 대체로 끝나는 길이다. 웨이브를 넘겨 살아남지
 * 않으므로 "쌓아 두는" 플레이가 원천적으로 불가능하다 — 이게 영구 유닛을 버린 이유다.
 *
 * ── 4단계 튜닝 (실측 기반) ─────────────────────────────────────────────────
 * 기본가를 27% 내렸다: 몽둥이꾼 55→40 · 무릿매 80→60 · 파수꾼 110→85.
 * 성능(hp/dmg/사거리/수명)은 **하나도 건드리지 않았다** — 무한 모드 A/B에서
 * dmg×2 · hp×2 · 사거리×1.6 · 수명×3을 각각 돌려도 도달 웨이브가 전부 노이즈 안이었다.
 * 아군의 병목은 세기가 아니라 **가동률**(이기는 판 1.1% · 지는 판 3.5% — 5단계 정정값,
 * 근거는 balance.ALLY_RETIRE_REFUND 주석)이라, 성능을 올리면
 * "안 쓰이는 시간이 더 비싸질" 뿐이고 값을 내려야 수지가 맞는다.
 * 나머지 두 손잡이는 balance.ts에 있다: ALLY_BLOCK_CAPACITY(정원 봉쇄)와
 * ALLY_RETIRE_REFUND(귀환 환급). 근거는 각 상수 주석.
 */
import type { AllyDef, AllyId } from './types';

export const ALLY_DEFS: Record<AllyId, AllyDef> = {
  clubber: {
    id: 'clubber',
    nameKey: 'ally.clubber.name',
    descKey: 'ally.clubber.desc',
    // hp 140 = 랩터(cost 10 → 난투 6/초)의 공격을 23초 버틴다 = 수명(20초)과 거의 같다.
    // 즉 잡졸 하나를 상대로는 수명이 먼저 다하고, 둘 이상에게 붙잡히면 죽는다.
    hp: 140,
    speed: 1.15,
    armor: 0,
    radius: 0.26,
    cost: 40,
    lifeTicks: 600,
    // 14 / 0.8초 = 17.5 dps. spear T1(12/0.5초 = 24dps)보다 낮게 둔다 —
    // 아군은 화력이 아니라 **위치**를 사는 카드여야 타워가 밀려나지 않는다.
    dmg: 14,
    cooldownTicks: 24,
    range: 1.0,
    canTargetAir: false,
    blocks: true,
  },
  guardian: {
    id: 'guardian',
    nameKey: 'ally.guardian.name',
    descKey: 'ally.guardian.desc',
    // armor 3 + hp 320. 잡졸 난투(2~6)를 armor가 절반 이상 깎아 "떼에는 강하고
    // 큰 놈에게는 약하다"가 성립한다 — trike(25)에게는 armor가 12%밖에 안 된다.
    // 4단계 정원 봉쇄(ALLY_BLOCK_CAPACITY 3)가 이 armor를 비로소 역할로 만든다:
    // 랩터 3마리를 동시에 붙잡으면 몽둥이꾼은 18dps를 맞아 7.8초에 쓰러지지만
    // 파수꾼은 armor가 마리당 3을 깎아 9dps라 수명 20초를 그대로 채운다.
    hp: 320,
    armor: 3,
    speed: 0.85,
    radius: 0.3,
    cost: 85,
    lifeTicks: 600,
    // 9 / 1초 = 9 dps. clubber의 절반 — 이 카드는 죽이는 게 아니라 세워 두는 카드다.
    dmg: 9,
    cooldownTicks: 30,
    range: 1.15,
    canTargetAir: false,
    blocks: true,
  },
  slinger: {
    id: 'slinger',
    nameKey: 'ally.slinger.name',
    descKey: 'ally.slinger.desc',
    // 유리대포 — 적 궁수(65)와 같은 자리. 붙잡히면 그냥 죽는다.
    hp: 80,
    speed: 1.05,
    armor: 0,
    radius: 0.24,
    cost: 60,
    lifeTicks: 600,
    // 11 / 1초 = 11 dps. 사거리 2.8은 근접 아군(1.0~1.15) 뒤에 서서 쏘기에 충분하고
    // 아군 출격 한계선(6.0) 안에서 길목 하나를 통째로 덮지는 못하는 폭이다.
    dmg: 11,
    cooldownTicks: 30,
    range: 2.8,
    canTargetAir: true,
    blocks: false,
  },
};

/** UI/렌더 순회용 고정 순서 (출동 바 버튼 순서이기도 하다 — 싼 것부터) */
export const ALL_ALLY_IDS: readonly AllyId[] = ['clubber', 'slinger', 'guardian'];
