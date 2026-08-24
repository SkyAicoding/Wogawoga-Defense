/**
 * 아군 부족 유닛 — 마을에서 골드로 뽑아 판 위에 세우는 전력. 결정론 100%(rng 미사용).
 *
 * ══ 9단계 재정의 — 무엇이 바뀌었고 왜인가 ══════════════════════════════════
 * 8단계까지 이 파일의 뼈대는 셋이었다: **경로 역주행 · 출격 한계선 · 20초 수명**.
 * 사용자가 부족을 다시 정의하면서 셋 다 걷어냈다.
 *   ① "자동으로 죽는 로직은 없애줘. HP 떨어져서 공격 받아야 죽게" → 수명 삭제
 *   ② "처음 스폰 위치는 홈 타운 바로 앞"                        → 집결 지점 스폰
 *   ③ "부족을 선택해서 원하는 위치를 블럭을 찍으면 거기까지 이동" → 자유 이동
 *   ④ "반경 제한 없이 맵 어디든 찍을 수 있게"                    → 한계선 삭제
 *
 * 8단계 헤더는 자유 이동을 버린 이유를 셋 적어 뒀었다(규칙 대칭 · 읽히는 그림 ·
 * 공짜 정확도). 그 판단은 **틀리지 않았고 여전히 대가로 남는다** — 아군만 들판을
 * 가로지르므로 "왜 쟤들은 길로만 안 다니지"라는 비대칭이 생겼고, 어디서 붙을지도
 * 내보내기 전에 알 수 없다. 다만 그 대가로 **판 위의 자리 선택**을 샀다: 예전 아군은
 * 골드를 낼지 말지만 정하는 자원이었고 어디에 쓸지는 정할 수 없었다.
 *
 * ── 억제 장치가 자리를 옮겼다 (중요) ────────────────────────────────────────
 * 한계선이 하던 일은 "아군이 적 스폰까지 걸어가 입구에서 웨이브를 요격해 타워를
 * 무의미하게 만드는 것"을 막는 것이었다. 그 벽을 사용자 지시로 헐었으므로 억제를
 * 다른 데서 받아야 한다. **둘로 나눠 받는다:**
 *  · **죽는다.** 수명이 없어진 대신 이제 HP가 진짜 유일한 목숨이다. 스폰 앞에는
 *    타워 사거리도 홈타운 사거리도 닿지 않으므로, 거기 세운 부족원은 웨이브 전체를
 *    혼자 받아낸다. 앞에 세울수록 빨리 죽는다 — 이것이 자연스럽고 읽히는 벌칙이다.
 *  · **머릿수를 마을이 정한다.** 정원이 BaseLevelDef.allyCap으로 옮겨갔다(Lv1 2명 →
 *    Lv5 6명). 자리를 어디든 고를 수 있게 된 순간 **몇 명이냐**가 유일하게 남은
 *    손잡이라, 예전 한계선이 서 있던 마을 레벨 칸을 그대로 정원이 물려받았다.
 *
 * ── 행동 규칙 (확정) ───────────────────────────────────────────────────────
 * 1) **홈타운 앞에서 태어난다.**
 *    스폰 지점 = 기지 셀에서 경로를 따라 MUSTER_FORWARD만큼 **적이 오는 쪽으로** 나온
 *    지점 + 대열 오프셋. 방향을 경로에서 뽑는 이유는 그것이 이 판에서 "앞"이 무엇인지
 *    아는 유일한 값이기 때문이다(기지 셀만으로는 어느 쪽이 앞인지 알 수 없다).
 *    대열은 3열 × 2줄로 벌린다 — 유닛 충돌이 없어서 안 벌리면 여섯이 한 점에 겹친다.
 *
 * 2) **찍은 셀로 직선으로 간다. 제한 없음.**
 *    moveAlly 커맨드가 tgtX/tgtZ를 셀 중심으로 박고, 매 틱 speed × TICK_DT만큼
 *    그쪽으로 걷는다. 도착하면 선다. **경로도, 건설 가능 여부도, 거리도 보지 않는다** —
 *    적 스폰 지점도 찍을 수 있다(사용자 재정의 ④).
 *    막힌 칸 판정이 없는 이유: 이 게임에는 충돌도 길찾기도 없다(적끼리도 겹친다).
 *    하나 넣으면 그 하나가 나머지 전부를 요구한다.
 *    allyId -1이면 살아 있는 전원이 같은 목표를 받는다 — 6명을 한 명씩 찍게 하면
 *    급할 때 여섯 번을 눌러야 한다.
 *
 * 3) **수명은 없다. HP가 다하면 그때 죽는다.**
 *    8단계의 20초 수명은 "골드가 쌓일수록 무한 누적되는 것"을 막는 장치였다.
 *    그 일을 이제 **정원(allyCap)**이 대신한다 — 정원이 차면 골드가 남아도 못 뽑고,
 *    자리를 비우는 방법은 누가 죽는 것뿐이다. 수명이 없어졌으므로 귀환도 환급도 없다
 *    (allyRetired 이벤트와 ALLY_RETIRE_REFUND가 함께 삭제됐다).
 *
 * 4) **정원 = 마을 레벨. 비용은 지수.**
 *    상한은 allyCapFor(ctx) = BASE_LEVELS[레벨-1].allyCap. 비용은 **나가 있는 인원수**로
 *    오르는데(allyCostFor), 이제 인원이 영구라 그 웃돈도 영구다 — 소모품이 아니라
 *    **누적 투자**이므로 그게 맞다.
 *
 * 5) **충돌은 없다. 대신 "봉쇄"다.** (8단계에서 그대로)
 *    이 게임은 유닛 충돌이 없다(적끼리 겹친다). 아군에게만 충돌을 주면 규칙이 어긋나고,
 *    밀어내기 물리가 없는 상태에서 겹침 금지를 넣으면 좁은 코너에서 유닛이 낀다.
 *    그래서 위치는 그대로 겹치되 **상태**로 표현한다:
 *      · 근접 아군(blocks)이 사거리 안의 **지상** 적을 타깃으로 잡으면
 *        그 적의 blockerAllyId가 서고 → 적의 전진이 멈춘다.
 *      · 봉쇄된 적은 **타워도 때리지 않는다**(siege가 건너뛴다). 눈앞의 사람을 놔두고
 *        멀리 있는 움막을 두들기는 그림은 설명이 안 되고, 무엇보다 이게 아군 유닛의
 *        존재 이유다 — 골드를 내고 **타워의 수명을 산다**.
 *      · 봉쇄된 적은 자기를 막은 아군 중 **가장 낮은 id 하나**를 난투로 반격한다.
 *        전원에게 동시에 반격하게 하면 아군을 여럿 붙일수록 손해가 되어 상한이 무의미해진다.
 *    공중 적은 절대 봉쇄되지 않는다 — 날아서 지나간다. 그래서 아군은 대공 대책이 아니다.
 *
 * 6) **타게팅** — 사거리 내 최근접, 동점은 낮은 적 id. 유효한 동안 갈아타지 않는다
 *    (타워·습격대의 lockedTarget 규약과 동일). 근접형(canTargetAir=false)은 공중을 무시한다.
 *
 *    6-b) **한 아군은 이미 다른 아군이 붙잡은 적을 골라잡지 않는다** (근접형 한정).
 *    이 단서가 없으면 최근접 + 고정 타깃 규약이 정확히 반대로 작동한다: 맨 앞 아군이
 *    선두의 적을 세우면 그 적은 **그 자리에 멈추므로** 뒤에 선 아군 전원에게도 계속
 *    최근접이 되어 여섯이 한 마리에 달라붙고 나머지 웨이브는 그 옆을 그냥 지나간다.
 *
 *    4단계 실측(직선 경로·랩터 24마리, 봉쇄된 적틱/아군틱) — 6-b 도입 전 1인당 1마리:
 *      1명 0.63 · 2명 0.48 · 3명 0.38 · 4명 0.32 · 5명 0.28 · 6명 0.27
 *    6-b 적용 직후: 1명 0.63 · 2명 0.61 · 3명 0.56 · 4명 0.51 · 5명 0.46 · 6명 0.41.
 *    총 봉쇄틱은 6명에서 1,280 → 2,044(+60%), 누수는 3 → 0이 됐다.
 *
 *    처리 순서는 **아군 id 오름차순**이다(pickOrder). 풀은 swap-remove라 items 순서가
 *    섞이는데, 그 순서에 따라 누가 먼저 적을 고르는지가 갈리면 규칙을 말로 적을 수 없다.
 *
 *    (규칙 6 계속) 적 쪽 타게팅은 **바뀌지 않는다** — 기지로 직행하는 적은 여전히 직행하고,
 *    습격대는 여전히 타워를 노린다. 적이 아군을 '찾아다니는' 행동은 넣지 않았다:
 *    넣으면 아군 한 명으로 웨이브 전체를 낚아 세울 수 있어 그 순간 게임이 끝난다.
 *    적이 아군을 때리는 유일한 경로는 **자기가 봉쇄당했을 때의 반격**이다.
 *
 * 7) **아군에게는 상태이상이 없다.** 적에게 상태 부여 능력이 없으므로 받을 일이 없고,
 *    없는 쪽이 규칙이 하나 적다. 아군은 타워 스플래시/오라에도 맞지 않는다(아군 오사 없음).
 *
 * 8) **자동 행동 — 일꾼만 스스로 일하러 간다.** (사용자 항목 2·4)
 *    명령이 없는 **일꾼**(gatherPct ≥ ALLY_WORKER_GATHER_PCT = 채집꾼 하나)은 매 틱
 *    `updateAllyAuto`에서 **가장 가까운 안 텄고 미예약인 자원 칸**을 스스로 잡는다.
 *    짐이 차면 마을로 가 내려놓고 **같은 틱에 다시 다음 칸을 잡는다**("들어와 놓고 다시 나간다").
 *
 *    ⚠ **전투 3종에게는 자동 이동이 없다. 한 글자도 안 바뀐다.**
 *    "명령이 없으면 주변의 적과 교전한다"는 규칙 6이 **이미 하고 있는 일**이고,
 *    교전 반경은 이미 `def.range`다. 여기에 접근 리시를 더하지 않는 근거 넷:
 *      ① **적이 알아서 온다.** 이 게임의 적은 예외 없이 마을로 걷는다(규칙 6 마지막 문단이
 *         "적이 아군을 찾아다니는 행동"을 금지한 것과 대칭이다) — 찾아 나설 대상이
 *         구조적으로 없다. 서 있으면 전선이 자기 발밑으로 온다.
 *      ② **돌아올 자리를 저장할 데가 없다.** 앵커는 `tgtX/tgtZ`이거나 새 float 둘인데,
 *         자동이 tgt를 덮어쓰면 **화면의 목표 표식이 거짓말을 시작한다**(gather-spec E-11이
 *         자동 후퇴를 금지한 것과 같은 이유).
 *      ③ **리시 0이면 아군은 절대 스폰 쪽으로 걷지 않는다** — 봉투 [12]("입구 요격은
 *         봇이 명령해야만 일어난다")의 전제가 코드 수준에서 유지된다.
 *      ④ 자동 접근은 아군을 일방적으로 강화해 [7][10][13][12] 문턱을 전부 위험한 쪽으로
 *         민다. 문턱을 어느 방향으로도 못 내리는 이 저장소에서 그건 기능이 아니라 부채다.
 *    ⇒ 채집꾼도 자동으로 싸우러 가지 않는다(dmg 3 · blocks false — 전력이 아니다).
 *
 * 8-b) **수동 우선 + "여기 지켜".** 사람이 찍은 칸의 뜻이 자동의 온오프를 겸한다.
 *    ⚠ **판정은 명령의 *의도* 가 아니라 *결과* 다 (§D-1 개정).** 셋 중 하나면 자동을
 *    **켠 채로 둔다**(그 일이 끝나면 다음 일을 스스로 찾는다 = 사용자 항목 4):
 *      ① 채집 예약이 **실제로 붙었다** · ② **기지 셀**이다 ·
 *      ③ 캘 수 있는 자원 칸인데 **손이 차서만** 못 잡았다(배달하고 다시 나간다).
 *    그 밖이면 `autoHold = true` — 거기 서서 대기한다. **적이 선 칸과 남이 예약한 칸도
 *    여기로 온다**: 옛 규칙은 그 둘을 "일감"으로 보아 자동을 켠 채로 뒀고, 그래서 그
 *    사람이 도착하자마자 다른 칸을 잡고 떠나 **명령이 조용히 증발했다.** 빈 칸이
 *    "여기 지켜"를 표현하는 자리인 것은 그대로다. 다시 자동을 켜려면
 *    **기지 셀을 찍는다**("돌아와서 내려놓고 다시 일해" = 사용자 항목 4 그 문장이다).
 *    대가: "기지 셀에 세워 두고 지키기"는 표현할 수 없게 된다 — 그 칸은 홈타운이 스스로
 *    쏘고 집결 지점이 이미 그 앞이라, 잃는 것이 가장 작은 칸이라서 여기를 골랐다
 *    (마을 앞을 지키고 싶으면 **인접 칸**을 찍으면 된다 = 빈 칸 = HOLD).
 *
 * ── 교착(스톨) 안전성 ──────────────────────────────────────────────────────
 * 봉쇄는 웨이브 완료 조건(전원 스폰 + 생존 0)을 막을 수 있다. **수명이 사라져 근거가
 * 하나 바뀌었다** — 8단계에는 "아군의 수명은 유한하다"가 근거였다. 지금의 근거:
 *  · 난투 피해는 항상 1 이상이다(damageAlly의 최소 1 + enemyBrawlDmgFor의 최소 2).
 *    즉 봉쇄를 유지하는 아군은 **반드시 유한 시간에 죽는다**(hp가 단조 감소한다).
 *  · 아군은 회복 수단이 없다 — 이 파일에도, combat.ts에도 아군 hp를 올리는 코드가 없다.
 *  · 정원이 유한하고 비용이 지수라 무한 릴레이가 불가능하다.
 * 즉 최악의 경우에도 봉쇄는 hp/난투피해 틱 안에 반드시 풀린다.
 * ⚠ 이 성질은 아군 회복/부활을 넣는 순간 깨진다. 넣으려면 스톨 가드를 함께 넣어라.
 *
 * three/DOM 임포트 금지.
 */
import { TICK_DT } from '@/data/types';
import type { AllyDef, AllyId, ResourceCellState } from '@/data/types';
import {
  ALLY_BLOCK_CAPACITY,
  ALLY_MUSTER_COLS,
  ALLY_MUSTER_FORWARD,
  ALLY_MUSTER_SPACING,
  BRAWL_BRUSH_RANGE,
  BRAWL_COOLDOWN_TICKS,
  allyCostFor,
  enemyBrawlDmgFor,
} from '@/data/balance';
import { dist2 } from '@/core/mathx';
// ⚠ 도착 판정 상수는 **여기서 선언하지 않는다.** 예전에는 이 파일이 `ARRIVE_EPS2 = 1e-6`을
//   따로 들고 있었고 `data/resources.ts`의 `isGathering`이 같은 값을 또 들고 있었다 —
//   두 값이 우연히 같아서 아무도 안 잡는 형태였다. 도착을 두 곳에서 각자 판정하면
//   "가는 중"과 "캐는 중"이 한 틱 어긋나는 날이 온다. 이제 출처는 하나다.
import { ARRIVE_EPS2, isGathering, isWorkerDef } from '@/data/resources';
import { addGold, damageAlly, damageEnemy } from './combat';
import { fillAliveAllyIds, type AllySim, type EnemySim, type SimCtx } from './entities';
import { setGatherTarget } from './gather';
import { allyCapFor } from './hometown';
import { isStunned } from './status';

/** 지금 이 종을 한 명 더 뽑는 실비용 (나가 있는 인원 수에 따라 오른다) */
export function allyTrainCost(ctx: SimCtx, def: AllyDef): number {
  return allyCostFor(def.cost, ctx.world.allies.length);
}

/** 지금 출동이 가능한가 (정원 + 골드) — UI 비활성 표시와 커맨드 거부가 같은 판정을 쓴다 */
export function canTrainAlly(ctx: SimCtx, def: AllyDef): boolean {
  if (ctx.world.allies.length >= allyCapFor(ctx)) return false;
  return ctx.view.gold >= allyTrainCost(ctx, def);
}

/**
 * 규칙 1) 홈타운 "앞"이 어느 쪽인가 — 기지 셀에서 경로를 거슬러 한 걸음 물러난 방향.
 *
 * 경로를 쓰는 이유: 판에서 "앞"을 아는 값이 이것뿐이다. 기지 셀 좌표만으로는 어느 쪽이
 * 적이 오는 쪽인지 알 수 없고, 스테이지마다 다르다. 아군이 더 이상 경로를 걷지 않아도
 * **경로가 어디로 나 있는지는 여전히 이 판의 사실**이라 여기서만 읽는다.
 * 경로가 없거나 너무 짧으면 +x를 앞으로 본다(스톨 없이 정의되기만 하면 된다).
 */
const _fwd = { x: 0, z: 0, heading: 0 };

function musterFacing(ctx: SimCtx): { dx: number; dz: number } {
  const path = ctx.groundPaths[0];
  if (!path || path.totalLength <= 0) return { dx: 1, dz: 0 };
  const base = ctx.opts.stage.baseCell;
  // 경로 끝(=기지)에서 한 타일 뒤 지점 — 거기서 기지를 향하는 방향의 반대가 "앞"이다
  path.sample(Math.max(0, path.totalLength - 1), _fwd);
  const dx = _fwd.x - base.x;
  const dz = _fwd.z - base.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return { dx: 1, dz: 0 };
  return { dx: dx / d, dz: dz / d };
}

/**
 * 규칙 1) n번째로 뽑힌 부족원이 설 집결 지점 (연속 셀 좌표).
 * 3열 × 2줄. 유닛 충돌이 없어 안 벌리면 전원이 한 점에 겹쳐 한 명처럼 보인다.
 */
function musterPoint(ctx: SimCtx, n: number): { x: number; z: number } {
  const base = ctx.opts.stage.baseCell;
  const f = musterFacing(ctx);
  // 앞 방향의 왼쪽 (진행 방향을 +90° 돌린 것) — 대열을 가로로 벌리는 축
  const px = -f.dz;
  const pz = f.dx;
  const col = (n % ALLY_MUSTER_COLS) - (ALLY_MUSTER_COLS - 1) / 2;
  const row = Math.floor(n / ALLY_MUSTER_COLS);
  const forward = ALLY_MUSTER_FORWARD - row * ALLY_MUSTER_SPACING;
  return {
    x: base.x + f.dx * forward + px * col * ALLY_MUSTER_SPACING,
    z: base.z + f.dz * forward + pz * col * ALLY_MUSTER_SPACING,
  };
}

/**
 * 출동 커맨드 본체 — 성공하면 골드를 깎고 홈타운 앞 집결 지점에 세운다.
 * 거부 조건: 정의 없음 / 정원 도달 / 골드 부족.
 */
export function trainAlly(ctx: SimCtx, defId: AllyId): boolean {
  const def = ctx.opts.allyDefs[defId];
  if (!def) return false;
  if (!canTrainAlly(ctx, def)) return false;
  const cost = allyTrainCost(ctx, def);

  // 집결 자리는 **acquire 전에** 정한다 — 새 유닛은 이미 리스트에 들어가 있으므로
  // 나중에 세면 자기 자신을 세어 한 칸씩 밀린다 (8단계 freeSlot과 같은 함정)
  const spot = musterPoint(ctx, ctx.world.allies.length);

  addGold(ctx, -cost);
  const a = ctx.world.acquireAlly();
  a.defId = defId;
  a.def = def;
  a.hp = def.hp;
  a.maxHp = def.hp;
  a.x = spot.x;
  a.z = spot.z;
  a.prevX = spot.x;
  a.prevZ = spot.z;
  // 태어난 자리가 곧 목표다 — 명령을 받기 전까지는 그 자리를 지킨다
  a.tgtX = spot.x;
  a.tgtZ = spot.z;
  a.walked = 0;
  // 적이 오는 쪽을 본다
  const f = musterFacing(ctx);
  a.heading = Math.atan2(f.dz, f.dx);
  ctx.events.push({ type: 'allyTrained', allyId: a.id, defId, cost, x: a.x, z: a.z });
  return true;
}

/*
 * ── `enemyOnCell` 은 **삭제됐다** (§D-1) ────────────────────────────────────
 * 규칙 8-b 의 옛 판정("적이 선 칸은 일감이라 자동을 켠 채로 둔다")이 유일한 호출부였다.
 * 그 판정이 **명령을 증발시키던 장본인**이다: 적이 선 칸을 찍으면 `autoHold = false` 로
 * 남고, 도착하는 순간 자동이 다른 칸을 잡아 그 자리를 떠난다. 개정된 규칙은 자동 온오프를
 * **결과**(예약이 실제로 붙었나)로 정하므로 적의 위치를 볼 이유가 아예 없어졌다.
 * 부수 이득: 명령마다 돌던 O(적 수) 순회가 사라졌다. 자세한 유도는 `moveAlly` ④ 안의 주석.
 */

/**
 * 규칙 2) 이동 명령 — 찍은 셀 중심을 목표로 박는다.
 * 대상: allyId >= 0이면 그 한 명, 아니면 defId가 있으면 **그 종족 전원**, 없으면 전원.
 * 대상이 하나도 없으면 false(연출도 안 난다).
 *
 * 격자 밖 셀은 거부한다. 이건 "어디든 찍을 수 있다"(규칙 2)와 충돌하지 않는다 —
 * 판 밖은 자리가 아니라 **없는 칸**이고, 허용하면 아군이 화면 밖으로 걸어 나간다.
 *
 * ── 채집 (docs/gather-spec.md D7) ──────────────────────────────────────────
 * 찍은 칸에 **아직 안 턴 자원이 있으면** 대상은 그 칸으로 걸어가 도착 후 **캔다**.
 * 자원이 없거나 이미 텄으면 지금까지와 똑같이 그냥 가서 선다. 곧 이 커맨드의 의미는
 * 한 글자도 안 바뀌었고 **도착지에 뜻이 하나 붙었을 뿐**이다. 그래서 새 커맨드를
 * 만들지 않았다 — 커맨드 유니온이 안 늘어 determinism SCRIPT와 e2e 훅이 그대로다.
 *
 * ⚠ `gatherKey`를 0 이상으로 만드는 코드 경로는 **둘이다** — 여기와 `updateAllyAuto`
 *   (규칙 8). 계약 A("탭이 없으면 코인도 없다")는 규칙 8과 함께 **철회됐고**, 방치 수입
 *   0의 근거는 이제 **"사람이 없으면"** 이다: 두 통로 모두 살아 있는 아군을 순회하므로
 *   `trainAlly`를 한 번도 안 낸 판은 순회가 0번 돈다. `trainAlly`의 집결 이동이
 *   `a.tgtX/tgtZ`를 직접 대입해 이 통로를 안 타는 것은 그대로다.
 *
 * ── 자동 온오프 (규칙 8-b, §D-1 개정) ──────────────────────────────────────
 * **명령이 곧 자동의 온오프다.** 다만 판정은 "이 칸이 일감처럼 생겼나"가 아니라
 * **"이 사람에게 실제로 일이 붙었나"** 다 — 옛 판정이 명령을 증발시켰기 때문이다.
 * 유도 전문은 아래 ④ 루프 안의 주석에 있다.
 * 판정은 **명령 시점에 한 번만** 하고 표적을 저장하지 않는다 — 저장하면 sim이 매 틱
 * tgt를 적에게 다시 박아야 하고 그러면 화면의 목표 표식이 거짓말을 시작한다(E-11).
 * 누구를 치느냐는 규칙 6이 이미 정한다(그 칸에 도착하면 사거리 안의 적을 친다).
 */
export function moveAlly(
  ctx: SimCtx,
  allyId: number,
  cellX: number,
  cellZ: number,
  defId?: AllyId,
): boolean {
  const stage = ctx.opts.stage;
  if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) return false;
  if (cellX < 0 || cellZ < 0 || cellX > stage.gridW - 1 || cellZ > stage.gridH - 1) return false;

  // ── ① 자원 칸인가 — **정수 셀만** 자원 칸이 될 수 있다 ──────────────────────
  //  ⚠ moveAlly는 지금까지 정수를 요구하지 않았다(Number.isFinite + 범위뿐). 그런데
  //    key = cellZ * gridW + cellX 는 **소수쌍에서도 정수가 될 수 있다** —
  //    gridW = 11에서 (cellX 5.5, cellZ 1.5) → key = 22 = 셀 (0,2)다. 가드가 없으면
  //    "서 있는 자리"와 "캐는 자리"를 분리할 수 있고, 마을 반경 안에 서서 맵 반대편 칸을
  //    캐 왕복 0으로 배달할 수 있다 — **거리 경제(D3)가 통째로 무효화된다.**
  //    UI는 셀을 반올림해 보내지만 moveAlly는 공개 커맨드이고 봇 하네스·e2e 훅·
  //    determinism SCRIPT가 직접 쏜다. (`canPlaceAt`은 이미 정수를 강제한다 — 여기만 비어 있었다.)
  const onCell = Number.isInteger(cellX) && Number.isInteger(cellZ);
  const key = onCell ? cellZ * stage.gridW + cellX : -1;
  const cell = key >= 0 ? ctx.resources.at(key) : null;
  const isResource = cell !== null && !cell.taken;

  // ── ①-b 기지 셀인가 (규칙 8-b) — 자동을 다시 켜는 스위치다("돌아와서 내려놓고 다시 일해") ──
  //  ⚠ **자동 온오프 판정 자체는 여기가 아니라 ④ 루프 안에 있다** (§D-1 개정).
  //    예약이 실제로 붙었는지는 **사람마다 다르므로** 루프 밖에서 한 번에 정할 수 없다 —
  //    옛 코드가 루프 밖의 값 하나(`hold`)를 전원에게 발라서 명령이 증발했다.
  const base = stage.baseCell;
  const isBase = onCell && cellX === base.x && cellZ === base.z;

  // ── ② 대상 목록 — id 오름차순 (풀 순서 의존 금지, 계약 B) ───────────────────
  fillAliveAllyIds(ctx.world.allies.items, orderOrder);

  // ── ③ 자원 칸이고 종족 명령이면 **sim이 한 사람을 고른다** (D7) ─────────────
  //  왜 UI가 아니라 sim인가: 현재 선택 단위는 개체가 아니라 **종족**이고
  //  (`game/placement.ts`의 `selectedAllyDef: AllyId | null`, 언제나 `allyId: -1`),
  //  그 종족 단위 선택은 파일 주석이 **사용자 지시를 인용해** 못 박아 둔 규칙이라
  //  UI를 개체 선택으로 좁히는 것은 사용자 요구를 뒤집는 일이다.
  //  → D7의 취지("한 짐 = 한 사람")를 sim에서 지킨다. 규칙이 hash()와 sim 테스트 안으로
  //    들어오는 부수 이득도 있다(UI에 두면 어느 쪽도 못 잡는다).
  //  고르는 규칙은 **세 단(段)**이고, 위 단이 언제나 아래 단을 이긴다:
  //    1단) 이미 그 칸을 맡은 사람            (E-1: 진행분을 지킨다)
  //    2단) **놀고 있는 사람** (gatherKey < 0)  ← 여기가 핵심이다. 아래 ⚠ 참조
  //    3단) 다른 칸을 캐는 중이면 **진행분이 가장 적은 사람** (버리는 것이 가장 작다)
  //  같은 단 안에서는 gatherPct 내림차순 → id 오름차순. 전부 정수/열거 비교라 부동소수
  //  동점 문제가 없고, `orderOrder`가 id 오름차순이므로 "동점이면 낮은 id"가 순회 순서
  //  하나로 자동으로 나온다(`>` 비교라 앞사람이 이긴다).
  //
  //  ⚠ **2단이 없으면 둘째 채집꾼이 구조적으로 영영 안 나간다.** 실측으로 잡은 결함이다:
  //    채집꾼 2명 · 1번이 A칸을 캐는 중(진행 25틱) · 플레이어가 B칸을 찍는다
  //      → 2단이 없으면 후보가 `gatherPct` 동점이라 언제나 **낮은 id(1번)** 가 뽑히고,
  //        1번이 A를 버리고(진행분 25 → 0) B로 간다. 2번은 1번의 짐이 가득 찰 때까지
  //        **한 번도 안 움직인다.** 곧 채집꾼을 몇을 뽑든 실질 가동은 언제나 1명이다.
  //    이 상태로 T6이 짐값을 맞추면 그 숫자가 통째로 틀린다(정원을 세는 계산이 전부 거짓).
  //
  //  짐이 가득 찬 사람과 못 캐는 종(gatherPct 0)은 애초에 후보가 아니다 — 뽑아 봐야
  //  setGatherTarget이 예약을 안 붙여 헛걸음만 시킨다.
  //  (한 짐을 캐고 아직 정원이 남은 사람은 `gatherKey = -1`이라 2단에 들어온다 —
  //   gather.ts가 짐 확정 시 예약을 즉시 풀기 때문이다. 그게 옳다: 그 사람은 놀고 있다.)
  let only: AllySim | null = null;
  if (isResource && allyId < 0) {
    /** 낮을수록 먼저 — 1단 0 · 2단 1 · 3단 2 */
    const tierOf = (a: AllySim): number => (a.gatherKey === key ? 0 : a.gatherKey < 0 ? 1 : 2);
    let bestTier = 3;
    for (const a of orderOrder) {
      if (defId !== undefined && a.defId !== defId) continue;
      if ((a.def.gatherPct ?? 100) <= 0) continue;
      if (a.carryCount >= (a.def.carryCap ?? 1)) continue;
      const tier = tierOf(a);
      if (tier === 0) {
        only = a; // 1단은 더 볼 것이 없다
        break;
      }
      if (only === null || tier < bestTier) {
        only = a;
        bestTier = tier;
        continue;
      }
      if (tier > bestTier) continue;
      // 같은 단 안의 경합
      if (tier === 2 && a.gatherTicks !== only.gatherTicks) {
        // 3단: 버리는 진행분이 더 적은 쪽
        if (a.gatherTicks < only.gatherTicks) only = a;
        continue;
      }
      if ((a.def.gatherPct ?? 100) > (only.def.gatherPct ?? 100)) only = a;
    }
    // 아무도 자격이 없으면 only는 null → 아래 루프가 **평소대로 전원 이동**한다.
    // (자원 칸이지만 캘 사람이 없는 것뿐이므로 "거기로 가라"는 여전히 유효한 명령이다)
  }

  // ── ④ 기존 루프 ─────────────────────────────────────────────────────────────
  let count = 0;
  for (const a of orderOrder) {
    if (allyId >= 0) {
      if (a.id !== allyId) continue;
    } else if (only !== null) {
      if (a !== only) continue; // 자원 칸 = 한 사람만. 나머지는 **자리도 안 바꾼다**(E-9)
    } else if (defId !== undefined && a.defId !== defId) continue;
    a.tgtX = cellX;
    a.tgtZ = cellZ;
    // 채집 — 자원이 없거나 이미 텄거나 남이 예약했거나 짐이 가득 찼으면
    // 조용히 기존 명령만 푼다(E-2 ~ E-7). 바깥 계약은 안 바뀐다.
    setGatherTarget(ctx, a, key);
    // 규칙 8-b **개정 (§D-1)** — 자동 온오프는 명령의 *의도*가 아니라 **결과**로 정한다.
    // **명령을 받은 사람에게만 걸린다** — 자원 칸에서 `only`가 정해지면 나머지는 이 루프에
    // 들어오지 않으므로 그들의 자동 상태도 안 바뀐다(E-9).
    // ⚠ `setGatherTarget` **뒤**여야 한다: 예약이 실제로 붙었는지를 읽기 때문이다.
    //
    // ⚠⚠ **무엇이 잘못돼 있었나 — "시켰는데 안 한다"** (사용자가 지적한 그 불편):
    //   옛 판정은 `hold = !(isResource || isBase || enemyOnCell(...))` 이었다. `isResource` 는
    //   "그 칸에 자원이 있다"일 뿐 **"이 사람이 그것을 잡았다"가 아니다.** 그래서
    //   (a) 남이 이미 예약한 칸(E-9 거부) (b) 적이 선 칸 두 경우에 `autoHold = false` 로 남고,
    //   그 사람이 도착하는 순간 `updateAllyAuto` ①②③④를 전부 통과해 **다른 칸을 잡고 떠난다.**
    //   화면에는 `allyOrdered` 가 세운 목표 표식만 남는다 — 명령이 조용히 증발한다.
    //
    // 셋 중 하나면 자동을 **켠 채로 둔다**(= 그 일이 끝나면 다음 일을 스스로 찾는다):
    //  ① 채집 예약이 **실제로 붙었다**  (`a.gatherKey === key` — 의도가 아니라 결과다)
    //  ② 기지 셀이다                    ("돌아와서 내려놓고 다시 일해" = 자동 재개 스위치)
    //  ③ 캘 수 있는 자원 칸인데 **손이 차서만** 못 잡았다
    //     (자동 ⑤가 마을로 보내 배달시키고 다시 나간다 — 오늘의 가장 흔한 흐름을 지킨다)
    // 그 밖이면 `true` = "여기 지켜". **적이 선 칸과 남이 예약한 칸이 여기로 온다.**
    // ⇒ 명령은 더 이상 증발하지 않는다. 그 사람은 찍은 칸으로 가서 **선다.**
    //
    // 왜 "거부"도 "표식만 유지"도 아닌가:
    //  · 거부(moveAlly 가 false) — 사용자의 불편이 "안 한다"인데 거부는 **아무 일도 안 일어난다**를
    //    더한다. 그리고 바깥 계약("거기로 가라는 언제나 유효한 명령이다", E-5)을 깨서
    //    UI·봇 하네스·e2e 훅·determinism SCRIPT 가 한꺼번에 흔들린다.
    //  · 표식만 유지 — 표식이 참인데 사람이 딴 데 있는 상태를 **유지**하는 것이라 거짓말을 고정한다.
    //  · 대기 — 사람이 찍은 자리에 사람이 서 있다. 목표 표식·대기 말뚝·HUD 대기 인원 셋이
    //    **같은 사실**을 말한다. 규칙이 늘지 않고(기존 `autoHold` 재사용) 새 상태도 없다.
    //
    // 부수: `enemyOnCell` 이 이 판정에서 **빠졌다**(호출 자체를 지웠다 — O(적 수) 순회가
    //   매 명령마다 돌던 것이 사라진다). 전투 3종을 적 칸으로 보내면 이제 `autoHold = true`
    //   가 되는데, **전투 3종엔 자동이 없어 동작은 한 틱도 안 바뀐다**(§D-3이 그 표시를 끈다).
    // ⚠ `key >= 0` 가드가 **필수**다. 격자 밖·소수 셀이면 `key === -1` 인데 예약이 없는
    //   사람도 `gatherKey === -1` 이라 가드 없이는 두 값이 같아진다 — 곧 "빈 땅을 찍었다"가
    //   "예약이 붙었다"로 읽혀 **"여기 지켜"가 통째로 사라진다.** (실측으로 잡은 결함이다:
    //   소수 셀 명령 뒤 600틱이면 그 사람이 스스로 다른 칸을 캐고 있었다.)
    const cap = a.def.carryCap ?? 1;
    a.autoHold = !(
      (key >= 0 && a.gatherKey === key) ||
      isBase ||
      (isResource && (a.def.gatherPct ?? 100) > 0 && a.carryCount >= cap)
    );
    count++;
  }
  if (count === 0) return false;
  // ⚠ 자원 칸에서 `count`가 1이 되는 것은 **의도**다 — 화면의 목표 표식이 "한 사람이
  //   간다"를 그대로 말한다. fx는 count를 표식 개수로 쓰지 않으므로(위치 하나) 무변경이다.
  // ⚠ 채집 중이던 사람을 옮기면 이 호출 하나가 이벤트를 2건 낸다:
  //   `gatherLost{'moved'}` + `allyOrdered`.
  ctx.events.push({ type: 'allyOrdered', count, cellX, cellZ });
  return true;
}

/**
 * 규칙 6-b) 이 적은 **다른** 아군이 이미 붙잡았는가.
 * blockerAllyId는 매 틱 처음에 전부 -1로 지워지고 이 틱의 아군 루프가 순서대로 채우므로,
 * 여기서 읽히는 값은 "나보다 앞 순서(=낮은 id)의 아군이 이미 맡았다"는 뜻이다.
 */
function claimedByOther(a: AllySim, e: EnemySim): boolean {
  return e.blockerAllyId >= 0 && e.blockerAllyId !== a.id;
}

/** 규칙 6) 현재 고정 타깃이 여전히 유효하면 반환, 아니면 null (재조준 필요) */
function lockedEnemy(ctx: SimCtx, a: AllySim, r2: number): EnemySim | null {
  if (a.targetId < 0) return null;
  const e = ctx.world.findEnemy(a.targetId);
  if (!e || !e.alive) return null;
  if (!a.def.canTargetAir && e.flying) return null;
  // 규칙 6-b) 앞줄이 이미 맡은 적이면 고정을 풀고 다른 상대를 찾는다
  if (a.def.blocks && claimedByOther(a, e)) return null;
  return dist2(a.x, a.z, e.x, e.z) <= r2 ? e : null;
}

/**
 * 규칙 6 + 6-b) 사거리 내에서 고를 적.
 * 우선순위: (근접형만) **아무도 안 맡은 적** → 최근접 → 동점은 낮은 적 id.
 * 원거리형(blocks=false)은 봉쇄를 하지 않으므로 이 우선순위를 쓰지 않는다 —
 * 막지 못하는 유닛이 상대를 갈라 서면 화력만 흩어진다(집중사격이 낫다).
 */
function pickEnemy(ctx: SimCtx, a: AllySim, r2: number): EnemySim | null {
  const avoidClaimed = a.def.blocks;
  let best: EnemySim | null = null;
  let bestD2 = Infinity;
  let bestClaimed = true;
  for (const e of ctx.world.enemies.items) {
    if (!e.alive) continue;
    if (!a.def.canTargetAir && e.flying) continue;
    const d2 = dist2(a.x, a.z, e.x, e.z);
    if (d2 > r2) continue;
    const claimed = avoidClaimed && claimedByOther(a, e);
    if (best === null || (bestClaimed && !claimed)) {
      best = e;
      bestD2 = d2;
      bestClaimed = claimed;
    } else if (claimed === bestClaimed && (d2 < bestD2 || (d2 === bestD2 && e.id < best.id))) {
      best = e;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * 규칙 5-b) 봉쇄 지정 — 사거리 안의 **가까운 지상 적부터 최대 ALLY_BLOCK_CAPACITY마리**를
 * 이 아군에게 묶는다. 이미 다른 아군이 잡은 적은 건너뛴다(이중 봉쇄 없음).
 */
function claimBlockade(ctx: SimCtx, a: AllySim, r2: number): void {
  for (let k = 0; k < ALLY_BLOCK_CAPACITY; k++) {
    let best: EnemySim | null = null;
    let bestD2 = Infinity;
    for (const e of ctx.world.enemies.items) {
      if (!e.alive || e.flying || e.blockerAllyId >= 0) continue;
      const d2 = dist2(a.x, a.z, e.x, e.z);
      if (d2 > r2) continue;
      if (d2 < bestD2 || (d2 === bestD2 && best !== null && e.id < best.id)) {
        best = e;
        bestD2 = d2;
      }
    }
    if (!best) return;
    best.blockerAllyId = a.id;
  }
}

/**
 * 규칙 6-b) 아군을 **id 오름차순**으로 늘어놓는 스크래치 버퍼.
 * 풀(DenseList)은 swap-remove라 items 순서가 사망으로 섞인다. 그 순서대로 적을
 * 고르게 두면 결정론은 유지되지만(같은 시드면 같은 순서) 규칙을 말로 적을 수 없다.
 * 정렬 자체는 `entities.fillAliveAllyIds`가 한다(`updateGather`와 **같은 구현**을 쓰기 위해).
 *
 * ⚠ **버퍼는 넷이고 서로 공유하지 않는다** — 각 버퍼 위에 어느 함수 전용인지 박아 둔다.
 *   `moveAlly`는 루프 **안에서** `setGatherTarget`을 부르므로, `updateAllies`와 버퍼를
 *   빌려 쓰면 "루프 도중에 같은 버퍼를 다시 채우는" 재진입 지뢰가 선다. 지금은
 *   `applyCommand`가 `tick()` 밖에서 도는 덕에 충돌이 없지만 그 성질은 언제든 깨진다.
 *   (셋째는 `sim/gather.ts`의 `gatherOrder`다 — 그쪽은 **시체까지** 넣는다.)
 */
const pickOrder: AllySim[] = []; // updateAllies 전용
const orderOrder: AllySim[] = []; // moveAlly 전용
/** 규칙 8) 자동 행동 전용 — **넷째다.** 앞의 셋과 절대 공유하지 않는다 */
const autoOrder: AllySim[] = [];

/**
 * 매 틱 — 아군 조준/타격 + 봉쇄 지정 + 적의 난투 반격.
 *
 * **틱 순서에서 여기가 맨 앞인 이유** (battle.ts 참조):
 *  · 이동보다 앞 — 봉쇄(blockerAllyId)를 이동 단계가 읽어야 적이 멈춘다.
 *    적 습격대가 updateSiege를 이동보다 앞에 두는 것과 정확히 같은 이유다(siege.ts 규칙 4).
 *  · updateSiege보다 앞 — 봉쇄된 적은 타워를 때리지 않는다(규칙 5). 그 판정을 siege가
 *    읽으려면 봉쇄가 먼저 서 있어야 한다.
 * 즉 "봉쇄 확정 → 공성 → 이동"이 한 틱 안의 인과 순서다.
 */
export function updateAllies(ctx: SimCtx): void {
  const allies = ctx.world.allies.items;
  const enemies = ctx.world.enemies.items;
  // 봉쇄는 매 틱 새로 세운다 — 지난 틱의 값이 남으면 아군이 죽은 뒤에도 적이 굳는다
  for (const e of enemies) e.blockerAllyId = -1;

  // 1단계: 아군의 조준/타격 + 봉쇄 지정 — 규칙 6-b) id 오름차순(=대체로 먼저 뽑은 순)
  fillAliveAllyIds(allies, pickOrder);
  for (const a of pickOrder) {
    // ⚠ **쿨다운 감소는 조기 탈출 위다.** 안 그러면 attackCdLeft가 채집 내내 얼어붙어
    //   해시에 "안 흐르는 정수"가 남고, 채집을 마치자마자 즉시 한 대 치는 부작용이 생긴다.
    if (a.attackCdLeft > 0) a.attackCdLeft--;
    // 채집 (docs/gather-spec.md D5) — **캐는 중이거나 짐을 진 사람은 싸우지 않는다.**
    // claimBlockade 앞에서 빠져나가므로 봉쇄도 안 걸고 조준도 안 선다.
    // **맞기는 한다**: 적의 난투 2단계는 blockerAllyId < 0이므로 brushTarget(규칙 5-c,
    // BRAWL_BRUSH_RANGE 1.1) 경로로 들어와 정상적으로 때린다 — 기존 규칙이 그대로 일을
    // 하고 **새 피해 경로가 없다.**
    //
    // ⚠ **`가는 중`은 전투 불능이 아니다.** D5는 "캐는 중·지고 오는 중"만 말한다.
    //   빈손으로 걸어가는 동안은 지금까지의 moveAlly와 완전히 같다. 그 결과
    //   blocks:true인 몽둥이꾼·파수꾼은 **교전이 붙으면 자원 칸에 영영 못 간다**
    //   (moveAllies의 `if (a.def.blocks && a.targetId >= 0) continue`). 버그가 아니라
    //   규칙이다 — **싸움이 붙으면 일하러 못 간다.** 반대로 **짐을 지면 그 문장이 풀린다**
    //   (targetId가 −1로 고정되므로): 손이 멈추지 발은 안 멈춘다.
    //
    // ⚠ 대가를 이름 대서 적는다: 전선에서 봉쇄 중이던 몽둥이꾼에게 채집을 시키면 **그 순간
    //   봉쇄가 풀려** 붙잡고 있던 적 최대 ALLY_BLOCK_CAPACITY마리가 다시 걷는다.
    //   규칙 5("봉쇄 = 타워의 수명을 산다")를 정면으로 되돌리는 동작이라 대가가 크고,
    //   **그래서 이 기능은 채집꾼을 판다.**
    // ⚠ 부작용 하나 더: 자원 칸이 전선 옆일 때 채집꾼이 몽둥이꾼보다 적에게 가까우면
    //   brushTarget이 **맞는 사람을 채집꾼으로 바꾼다**(brushTarget은 blocks도 targetId도
    //   안 본다). 봉쇄가 없어 몽둥이꾼은 그 적을 세우지도 못하는데 피해만 옮겨 간다 —
    //   새 피해 경로는 아니지만 **새 사고 형태**이고, UI가 "전선 옆 칸"을 경고할 근거다.
    if (isGathering(a) || a.carryCount > 0) {
      a.targetId = -1;
      continue;
    }
    const def = a.def;
    const r2 = def.range * def.range;
    // 규칙 5-b) 몸으로 막는다 — 사거리 안의 가까운 적부터 ALLY_BLOCK_CAPACITY마리까지
    if (def.blocks) claimBlockade(ctx, a, r2);
    const target = lockedEnemy(ctx, a, r2) ?? pickEnemy(ctx, a, r2);
    a.targetId = target ? target.id : -1;
    if (!target) continue;
    if (a.attackCdLeft > 0) continue;
    ctx.events.push({
      type: 'allyAttacked',
      allyId: a.id,
      defId: a.defId,
      targetId: target.id,
      x: a.x,
      z: a.z,
      targetX: target.x,
      targetZ: target.z,
      ranged: !def.blocks,
    });
    damageEnemy(ctx, target, def.dmg, a.defId);
    a.attackCdLeft = Math.max(1, Math.round(def.cooldownTicks));
  }

  // 2단계: 적의 난투 — 봉쇄자에게 반격(규칙 5), 아니면 스치는 타격(규칙 5-c)
  for (const e of enemies) {
    if (!e.alive) continue;
    if (isStunned(e)) {
      // 스턴은 공성과 마찬가지로 완전 무력화 — 쿨다운도 흐르지 않는다 (siege.ts 규칙 5)
      continue;
    }
    const victim =
      e.blockerAllyId >= 0 ? (ctx.world.findAlly(e.blockerAllyId) ?? null) : brushTarget(ctx, e);
    if (!victim || !victim.alive) {
      e.brawlCdLeft = 0; // 아무도 없으면 다음 교전에서 즉시 한 대 친다
      continue;
    }
    if (e.brawlCdLeft > 0) {
      e.brawlCdLeft--;
      continue;
    }
    const spec = e.def.brawl;
    const dmg = spec ? spec.dmg : enemyBrawlDmgFor(e.def.cost);
    damageAlly(ctx, victim, dmg, e);
    e.brawlCdLeft = Math.max(1, Math.round(spec ? spec.cooldownTicks : BRAWL_COOLDOWN_TICKS));
  }
}

/**
 * 규칙 5-c) **스치는 타격** — 나를 붙잡지 않았어도 코앞(BRAWL_BRUSH_RANGE)에 서 있는
 * 아군은 지나가면서 한 대 친다. 사거리 안에서 가장 가까운 아군, 동점은 낮은 id.
 *
 * ── 왜 이 규칙이 생겼는가 (영구화가 연 구멍) ────────────────────────────────
 * 8단계까지 적이 아군을 때리는 경로는 **봉쇄 반격 하나뿐**이었고, 봉쇄는 근접형
 * (blocks:true)만 건다. 즉 원거리형 무릿매는 **어떤 적도 때릴 수 없는 유닛**이었다.
 * 수명 20초가 그걸 가리고 있었다 — 아무도 못 때려도 20초 뒤에 사라졌으니까.
 * 영구화로 그 뚜껑이 열렸다: 무릿매를 뽑아 어디든 세우면 **영원히 죽지 않는다**.
 * 골드로 산 불멸의 포탑이 정원만큼 쌓이면 그 순간 게임이 끝난다.
 *
 * ── 왜 "적이 아군을 찾아다니게" 하지 않았는가 ───────────────────────────────
 * 규칙 6의 마지막 문단이 그걸 금지한다 — 적이 아군을 쫓으면 **아군 한 명으로 웨이브
 * 전체를 낚아 세울 수 있다**. 그래서 이 규칙은 **탐색이 아니다**: 적은 멈추지도, 방향을
 * 바꾸지도 않는다(전진을 멈추는 것은 지금도 봉쇄뿐이다). 그냥 걸어가다가 팔이 닿는
 * 자리에 사람이 있으면 친다. 길에 세워 두면 맞고, 길에서 비켜 세우면 안 맞는다 —
 * **무릿매의 위치가 처음으로 판단이 된다.**
 *
 * ── 근접형에게는 아무 변화가 없다 ───────────────────────────────────────────
 * 봉쇄자가 있으면 그 봉쇄자만 맞는다(위 분기의 첫 항). 즉 8단계의 "봉쇄된 적은 자기를
 * 막은 아군 중 가장 낮은 id 하나만 친다"가 그대로 살아 있고, 스치는 타격은 **봉쇄가
 * 아예 없을 때만** 켜진다. 두 규칙이 같은 틱에 겹쳐 두 대를 맞는 일은 없다.
 */
function brushTarget(ctx: SimCtx, e: EnemySim): AllySim | null {
  // **지상 적만 스친다.** 규칙 5가 "공중 적은 날아서 지나간다 — 아군은 대공 대책이 아니다"
  // 라고 못박았고, 그 문장은 양방향이어야 한다. 공중에게도 팔이 닿게 두면 몽둥이꾼·파수꾼은
  // 애초에 공중을 때릴 수 없으므로(canTargetAir false) **반격 수단이 0인 채로 맞기만 한다** —
  // 규칙이 아니라 벌금이다. (검증에서 실측으로 잡혔다: 공중 랩터가 지나가며 2대를 때렸다)
  // 불멸 구멍은 지상 적만으로 충분히 막힌다 — 웨이브의 대부분이 지상이다.
  if (e.flying) return null;
  const r2 = BRAWL_BRUSH_RANGE * BRAWL_BRUSH_RANGE;
  let best: AllySim | null = null;
  let bestD2 = Infinity;
  for (const a of ctx.world.allies.items) {
    if (!a.alive) continue;
    const d2 = dist2(a.x, a.z, e.x, e.z);
    if (d2 > r2) continue;
    if (d2 < bestD2 || (d2 === bestD2 && best !== null && a.id < best.id)) {
      best = a;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * 매 틱 — 아군 이동(목표로 직선). moveEnemies **직후**에 돈다:
 * 교전 판정은 이미 updateAllies에서 끝났고, 여기서는 그 결과대로 걷거나 멈추기만 한다.
 * (적과 아군을 같은 틱 안에서 같은 스냅샷으로 움직여야 사거리 판정이 한쪽으로 기울지 않는다)
 */
export function moveAllies(ctx: SimCtx): void {
  for (const a of ctx.world.allies.items) {
    if (!a.alive) continue;
    a.prevX = a.x;
    a.prevZ = a.z;
    // 규칙 5) 근접형은 교전 중이면 그 자리에 선다 — 붙잡은 적을 놓고 가지 않는다.
    // 원거리형은 걸으며 쏜다. (이 판정이 목표 도달 판정보다 **먼저**다)
    if (a.def.blocks && a.targetId >= 0) continue;
    const dx = a.tgtX - a.x;
    const dz = a.tgtZ - a.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= ARRIVE_EPS2) continue; // 도착 — 명령이 새로 올 때까지 선다
    const d = Math.sqrt(d2);
    // 남은 거리보다 한 걸음이 크면 목표를 지나치지 않게 잘라 낸다(도착 진동 방지)
    const step = Math.min(d, a.def.speed * TICK_DT);
    a.x += (dx / d) * step;
    a.z += (dz / d) * step;
    a.walked += step;
    a.heading = Math.atan2(dz, dx);
  }
}

/** 사망한 아군 회수 — battle의 사망 처리 단계에서 역순으로 호출한다 */
export function sweepDeadAllies(ctx: SimCtx): void {
  const items = ctx.world.allies.items;
  for (let i = items.length - 1; i >= 0; i--) {
    if (!(items[i] as AllySim).alive) ctx.world.removeAllyAt(i);
  }
}

/**
 * 규칙 8) 이 종은 일꾼인가 — 판정선의 유도는 `balance.ALLY_WORKER_GATHER_PCT` 주석.
 * ⚠ **구현은 `@/data/resources` 의 `isWorkerDef` 하나다.** 렌더(대기 말뚝)와 UI(대기 인원)가
 *   같은 술어를 봐야 하는데 그쪽은 `@/sim` 을 임포트할 수 없어서 그 자리로 옮겼다(§D-3).
 *   여기 남긴 이름은 이 파일의 규칙 문장을 그대로 읽히게 하는 별칭일 뿐이다.
 */
function isWorker(def: AllyDef): boolean {
  return isWorkerDef(def);
}

/** 규칙 8) 살아 있는 **다른** 아군이 이 칸을 들고 있는가. 멤버십 검사뿐이라 순서 무관(계약 B) */
function claimedByAnother(ctx: SimCtx, a: AllySim, key: number): boolean {
  for (const o of ctx.world.allies.items) {
    if (o.alive && o !== a && o.gatherKey === key) return true;
  }
  return false;
}

/**
 * 규칙 8-a) **자동 목표 선택** — 안 텄고, 아무도 예약하지 않은, 가장 가까운 자원 칸.
 *
 * 전순서(부동소수 동점 없음):
 *   ① 아군이 선 셀(반올림)에서 **격자 거리 제곱**이 작은 것 — 좌표가 전부 정수라 **정수 비교**다
 *   ② 동점이면 **셀 키 오름차순** — `ResourceField.list`가 셀 키 오름차순으로 굳어 있고
 *      비교가 엄격 부등호(`>=` continue)라 동점에서는 언제나 먼저 만난 것(= 최소 키)이 이긴다
 *
 * ⚠ 거리를 **마을 기준이 아니라 아군 기준**으로 재는 이유: 사용자 항목 2가 "근처에서부터"다.
 *   마을 기준으로 재면 배달 뒤 다음 칸이 언제나 같은 순서로 정해져 여섯이 한 줄로 몰린다.
 * ⚠ `Math.round`는 셀 기준 반올림이고 `Math.hypot`을 안 쓴다 — 이 파일의 기존 규약 그대로다.
 * ⚠ **예약 검사는 거리 검사 뒤**에 둔다(멤버십 검사라 O(n)이다). 결과는 안 바뀌고 비용만 준다.
 */
function pickAutoCell(ctx: SimCtx, a: AllySim, gridW: number): ResourceCellState | null {
  const ax = Math.round(a.x);
  const az = Math.round(a.z);
  let best: ResourceCellState | null = null;
  let bestD2 = Infinity; // 센티널. 실제 비교에 들어오는 값은 전부 정수다
  for (const c of ctx.resources.list) {
    if (c.taken) continue;
    const dx = c.cellX - ax;
    const dz = c.cellZ - az;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD2) continue; // 동점이면 앞사람(= 작은 셀 키)이 이긴다
    if (claimedByAnother(ctx, a, c.cellZ * gridW + c.cellX)) continue;
    best = c;
    bestD2 = d2;
  }
  return best;
}

/**
 * 규칙 8) **자동 행동** — 명령이 없는 일꾼이 스스로 할 일을 찾는다 (사용자 항목 2·4).
 * 틱 순서 **8-c**: `updateGather`(8-b) 바로 뒤 · `sweepDeadAllies`(9) 앞.
 *
 * 왜 8-b 뒤인가: 같은 틱의 **배달**을 읽어야 "마을에 들어와 놓고 **다시 나간다**"(항목 4)가
 * 한 틱 지연 없이 일어난다. `updateGather` ③이 배달 직후 `tgt = 지금 위치`를 박으므로
 * 여기서는 "도착해 있고 빈손"으로 읽히고, 그 자리에서 다음 칸이 정해진다.
 *
 * ⚠ **이 함수는 이벤트를 한 건도 안 낸다.** ②가 `gatherKey < 0`을 이미 걸러 내므로
 *   `setGatherTarget`의 `cancelGather` 가지에 절대 안 들어가고, `allyOrdered`는
 *   커맨드의 이벤트지 자동의 이벤트가 아니다(내면 fx와 e2e가 초당 수십 건을 받는다).
 *
 * ── 무한 배회는 불가능하다 (종료 증명 — ⚠ **재생이 들어와 다시 썼다**) ────────
 * 후보 집합 = { 안 텄고 아무도 예약 안 한 자원 칸 }.
 *  1. ⚠ **`taken`은 더 이상 단조가 아니다** — 재생이 true → false 를 만든다(R2). 옛 증명은
 *     그 단조성에 서 있었으므로 여기서 무너진다. **단조인 것은 다른 값이다:**
 *     `regrowsLeft` 는 절대 안 늘어난다(`takeCell` 이 감소만 시키고 `burnRegrow` 는 0으로
 *     떨군다. 되돌리는 코드가 저장소 어디에도 없다 — R-d).
 *  2. 한 칸이 텄음이 될 수 있는 횟수 ≤ `1 + regrowsLeft@생성` 이고, 그 값은 판 시작에
 *     좌표만으로 굳는다(`REGROWABLE_KINDS` 는 상수, `resourceKindOf` 는 셀 단독 해시).
 *     ⇒ **판 전체의 수확 횟수 ≤ Σ (1 + regrowsLeft@생성) = 유한.** (s1 · R=1 이면 72)
 *  3. 자동이 목표를 잡으면 `gatherKey`가 붙고 ②가 다음 틱부터 재조준을 막는다. 그 예약이
 *     풀리는 길은 셋뿐이다: 짐 완성(수확 하나를 소비한다 — 2에 의해 유한) ·
 *     clearScenery(그 칸의 재생권을 태운다 = 후보에서 **영구** 제거) ·
 *     사망(그 사람이 사라진다 — 정원 유한, 부활 없음).
 *  4. ⇒ 자동 사이클 수 ≤ Σ (1 + regrowsLeft@생성) + 판 전체의 아군 사망 수. 각 사이클도
 *     유한하다(gatherTicksFor는 유한 — gatherPct 0은 애초에 일꾼이 아니다).
 *  5. 후보가 비면 ⑦이 **정지**시킨다(짐 있으면 마을 한 번, 없으면 제자리). 재생이 그 칸을
 *     되살리면 다시 잡으러 가는데, 그것도 4의 유한한 예산 안에서만 일어난다.
 * 스톨도 없다: 자동은 어떤 완료 조건도 막지 않는다(봉쇄를 안 걸고, 웨이브 완료는 적 쪽 조건이다).
 * ⚠ 이 증명은 `regrowsLeft` 를 **늘리는** 코드가 생기는 순간 깨진다. 넣으려면 상한을 함께 넣어라.
 */
export function updateAllyAuto(ctx: SimCtx): void {
  const stage = ctx.opts.stage;
  const base = stage.baseCell;
  fillAliveAllyIds(ctx.world.allies.items, autoOrder); // 시체 불필요 — 자동은 산 사람만
  for (const a of autoOrder) {
    // ① "여기 지켜" — 자동이 꺼져 있다 (규칙 8-b).
    //    ⚠ `!a.autoHold`가 아니라 `a.autoHold`로 쓴다: 초기화가 빠져 undefined가 와도
    //      **일을 안 하는 유닛**이 아니라 **일하는 유닛**이 되어 화면에서 즉시 보인다
    //      (`isGathering`이 안전한 쪽으로 닫은 것과 같은 이유).
    if (a.autoHold) continue;
    // ② 이미 예약이 있다 — 자동은 **살아 있는 명령을 절대 안 덮어쓴다**.
    //    수동이든 자동이든 예약이 붙은 순간 그 칸이 끝날 때까지 재조준하지 않는다
    //    (타워·습격대의 lockedTarget 규약과 같다). 이것이 "적이 가까울 때"의 답이기도 하다 —
    //    아래 ⑥ 주석 참조.
    if (a.gatherKey >= 0) continue;
    // ③ 일꾼이 아니면 자동으로 할 일이 없다. 전투 3종은 **제자리 교전**이다(규칙 6·8)
    if (!isWorker(a.def)) continue;
    // ④ 아직 걷는 중이면 목표를 덮어쓰지 않는다 — **도착해 있을 때만** 결정한다.
    //    이 가드가 없으면 매 틱 목표가 다시 정해져 유닛이 두 칸 사이에서 진동한다.
    const dx0 = a.x - a.tgtX;
    const dz0 = a.z - a.tgtZ;
    if (dx0 * dx0 + dz0 * dz0 > ARRIVE_EPS2) continue;
    // ⑤ 짐이 가득 찼다 → 마을로. (gather.ts D6이 이미 박아 두지만, 배달 반경 밖에서
    //    멈춰 선 뒤 다시 집으로 보내는 것은 여기다)
    const cap = a.def.carryCap ?? 1;
    if (a.carryCount >= cap) {
      a.tgtX = base.x;
      a.tgtZ = base.z;
      continue;
    }
    // ⑥ 가장 가까운 미예약·미채취 칸.
    //    ⚠ **적이 가까운 칸을 피하지 않는다.** 적은 매 틱 움직이므로 "적이 없는 칸"은
    //      한 틱짜리 사실이고, 그것을 선택에 넣으면 적이 지나갈 때마다 목표가 갈려
    //      진행분 폐기와 gatherLost{'moved'}가 초당 여러 건 뿜어진다. 위험한 칸의 벌금은
    //      **D5가 이미 물린다**(맞으면 손이 멈춘다 — s1 40칸 중 22칸이 그 사거리 안이다).
    //      곧 전선 옆 칸은 **느릴 뿐 금지가 아니고**, 그것이 이 게임이 이미 고른 규칙이다.
    const cell = pickAutoCell(ctx, a, stage.gridW);
    if (cell === null) {
      // ⑦ **자원이 전부 텄다 / 남은 칸을 남이 다 들고 있다** — 무한 배회 금지.
      //    짐이 있으면 마을로(E-18의 "짐 하나 들고 서 있기"를 자동이 대신 끝낸다),
      //    빈손이면 **그 자리에 선다.** 걸어다닐 이유가 없다.
      if (a.carryCount > 0) {
        a.tgtX = base.x;
        a.tgtZ = base.z;
      }
      continue;
    }
    // ⑧ 예약을 먼저 붙이고, **붙었을 때만** 목표를 바꾼다.
    //    순서가 반대면(목표 먼저) 예약이 거부된 틱에 유닛이 그 칸으로 걸어갔다가
    //    도착 → 다시 선택 → 또 거부의 진동 루프가 선다.
    const key = cell.cellZ * stage.gridW + cell.cellX;
    setGatherTarget(ctx, a, key);
    if (a.gatherKey !== key) continue; // 예약이 안 붙었다 → 목표도 안 바꾼다
    a.tgtX = cell.cellX;
    a.tgtZ = cell.cellZ;
  }
}
