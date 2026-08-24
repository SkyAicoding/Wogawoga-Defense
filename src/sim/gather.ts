/**
 * 채집 — 부족원을 자원 칸에 붙여 캐게 하고, **마을까지 지고 오면** 코인을 준다.
 * **결정론 100% (rng 미사용).** 규칙 전문은 docs/gather-spec.md §4, 자원 표는 data/resources.ts.
 *
 * three/DOM 임포트 금지 — `@/data/*` + `./{combat,entities}` 만 쓴다.
 * (`isGathering`·`gatherTicksFor`·`ARRIVE_EPS2`는 **여기 없다** — 렌더가 같은 함수를 써야
 *  하므로 `@/data/resources`에 있다. 렌더는 `@/sim`을 임포트할 수 없다.)
 *
 * ── 상태 흐름 (D4: 자동 이웃 이동은 없다) ───────────────────────────────────
 *   가는 중 → 캐는 중 → **지고 오는 중** → 마을 배달
 * 셋 중 어느 것도 열거값으로 저장하지 않는다. 넷(+1)의 필드에서 전부 유도된다:
 *   가는 중   = gatherKey >= 0 && 목표에 아직 도착 안 함
 *   캐는 중   = gatherKey >= 0 && 목표에 도착함        ← isGathering(a)
 *   짐을 졌다 = carryCount > 0                        ← 운반 중이든 서 있든 같은 값
 *   전투 불능 = 캐는 중 || carryCount > 0             (D5, allies.ts updateAllies)
 *
 * ── 이 파일이 지키는 계약 셋 ────────────────────────────────────────────────
 *  A) **탭이 없으면 코인도 없다.** `gatherKey`를 0 이상으로 만드는 코드는 `setGatherTarget`
 *     하나뿐이고 그것을 부르는 곳은 `allies.ts moveAlly` 한 곳뿐이다. `trainAlly`의 집결
 *     이동은 `a.tgtX/tgtZ`를 직접 대입하므로 이 통로를 **안 탄다**.
 *  B) **자료구조의 순회 순서에 결정론을 걸지 않는다.** `ResourceField.list`는 생성 시
 *     셀 키 오름차순으로 굳고 그 뒤로 재정렬도 삭제도 추가도 없다(텄어도 taken=true로
 *     남는다). 아군 순회는 언제나 id 오름차순(`fillAllAllyIds`)이다.
 *  C) **`combat.ts`를 한 줄도 안 고친다.** 맞았는지는 `AllySim.gatherHpMark` 비교로 안다 —
 *     `damageAlly`가 채집을 끊어 주게 만들면 `combat ↔ gather` 값 순환이 생긴다.
 *
 * ── 다 캐도 칸은 열리지 않는다 (D1) ─────────────────────────────────────────
 * 이 파일은 `battle.ts`의 `scenery` Set에 **한 글자도 안 닿는다.** 다 캔 칸은 그루터기로
 * 남아 계속 건설 불가이고, 유료 제거 지수(`clearedScenery`)도 채집이 한 톨도 안 올린다.
 */
import { GATHER_BASE_VALUE, GATHER_DELIVER_RANGE, gatherValueFor } from '@/data/balance';
import { RESOURCE_DEFS, gatherTicksFor, isGathering, resourceKindOf } from '@/data/resources';
import type { ResourceCellState, StageDef } from '@/data/types';
import { addGold } from './combat';
import { fillAllAllyIds, type AllySim, type SimCtx } from './entities';

/**
 * 자원 칸 밭 — 판이 시작될 때 목록이 굳고 **`taken`만 변한다**. `SimCtx`가 소유한다.
 *
 * 목록과 색인을 함께 드는 이유: 조회는 키 하나로 끝나야 하고(`at`), 순회는 **언제나
 * 배열**이어야 한다(계약 B). Map을 순회하면 그날부터 결정론이 자료구조 구현에 의존한다.
 */
export class ResourceField {
  /** 순회는 **언제나 이것**. 셀 키 오름차순 고정, 원소가 빠지는 일이 없다 */
  readonly list: readonly ResourceCellState[];
  /** 조회 전용. **절대 순회하지 않는다** */
  private readonly index = new Map<number, ResourceCellState>();

  /**
   * @param scenery `battle.ts`가 들고 있는 소품 셀 집합. **읽기만 한다** — 채집은
   *   이 집합을 절대 안 바꾼다(D1).
   * @param baseValue 짐값의 기준 크기. 기본값이 `GATHER_BASE_VALUE` 하나라 "되돌리는
   *   손잡이는 하나"(D9)가 그대로 지켜진다.
   *   ⚠ **그래도 옵션이어야 한다**: 주입구가 없으면 봉투가 짐값 축을 A/B할 수 없어
   *   대조군 `gather-x4`를 못 만들고, 그러면 채집 다리들이 전부 UNPROVEN으로 태어난다
   *   (`tests/sim/controls.ts`가 `SCENERY_CLEAR_BASE_COST`에 대해 겪은 그대로다).
   *   게임 코드에서 이 인자를 넘기는 곳은 **한 군데도 없다.**
   */
  constructor(
    stage: StageDef,
    scenery: ReadonlySet<number>,
    { baseValue = GATHER_BASE_VALUE }: { baseValue?: number } = {},
  ) {
    // ⚠ Set 순회 순서에 안 기댄다 — 정렬해서 목록의 신원을 셀 키가 정하게 한다(계약 B)
    const keys = [...scenery].sort((p, q) => p - q);
    const out: ResourceCellState[] = [];
    for (const key of keys) {
      const cellX = key % stage.gridW;
      const cellZ = Math.floor(key / stage.gridW);
      const kind = resourceKindOf(stage, key); // 셀 단독 해시, 시드 무관
      const dx = cellX - stage.baseCell.x;
      const dz = cellZ - stage.baseCell.z;
      // ⚠ Math.hypot 금지 — 정밀도가 구현 정의라 **골드를 만드는 식**에는 안 쓴다(balance.ts)
      const dist = Math.sqrt(dx * dx + dz * dz);
      const cell: ResourceCellState = {
        cellX,
        cellZ,
        kind,
        value: gatherValueFor(baseValue, RESOURCE_DEFS[kind].kindMul, dist),
        taken: false,
      };
      out.push(cell);
      this.index.set(key, cell);
    }
    this.list = out;
  }

  /** 조회 — 그 셀에 소품이 없으면 null. **순회하지 않는다** */
  at(key: number): ResourceCellState | null {
    return this.index.get(key) ?? null;
  }
}

/**
 * 채집 목표를 박는다 — **`sim/allies.ts moveAlly()`만** 호출한다 (계약 A의 유일한 통로).
 *
 * 자원이 없거나 이미 텄거나 남이 예약했거나 짐이 가득 찼으면 **조용히 기존 명령만 푼다** —
 * 곧 `moveAlly`의 바깥 계약(반환값·이벤트)은 한 글자도 안 바뀐다. "거기로 가라"는 언제나
 * 유효한 명령이고, 헛걸음을 막는 것은 sim이 아니라 UI의 몫이다(E-5).
 */
export function setGatherTarget(ctx: SimCtx, a: AllySim, key: number): void {
  if (key < 0) {
    // 정수 셀이 아니거나 격자 밖 — 채집이 아닌 평범한 이동이다. 앞 예약은 푼다.
    if (a.gatherKey >= 0) cancelGather(ctx, a, 'moved');
    return;
  }
  // E-1) 같은 칸 재명령 = 진행분 **유지**. 연타가 진행을 0으로 만들면 "빨리 캐려고 연타"가
  //      손해가 된다 — 손가락이 게임을 벌하면 안 된다.
  if (a.gatherKey === key) return;
  // E-2/E-3) 앞 예약을 푼다. 진행분은 폐기되고 **짐은 그대로 진다**.
  if (a.gatherKey >= 0) cancelGather(ctx, a, 'moved');

  const cell = ctx.resources.at(key);
  if (!cell || cell.taken) return; // E-6) 자원 없음 / 이미 텀 → 그냥 이동
  // E-7) 못 캐는 종. ⚠ **이 한 줄이 gatherTicksFor의 Infinity를 막는 방벽이다** —
  //      gatherPct 0이면 실제 틱이 Infinity라 updateGather가 영원히 안 끝나는 캐기를 돈다.
  //      "못 캔다"는 판정을 호출부가 **먼저** 거른다(위약 아군이 정확히 그 값이다).
  if ((a.def.gatherPct ?? 100) <= 0) return;
  if (a.carryCount >= (a.def.carryCap ?? 1)) return; // E-5) 짐이 가득 → 그냥 이동
  // E-9) 예약은 **배타적**이다 — 한 칸에 한 짐이므로(D2) 둘을 보내면 한 명은 반드시
  //      헛걸음한다. 살아 있는 누군가가 이미 이 칸을 들고 있으면 안 붙인다.
  //      멤버십 검사뿐이라 items 순회 순서에 결과가 안 걸린다(계약 B).
  for (const o of ctx.world.allies.items) {
    if (o.alive && o !== a && o.gatherKey === key) return;
  }
  a.gatherKey = key;
  a.gatherTicks = 0;
  a.gatherHpMark = 0; // "이번 예약에서 아직 시작 안 함" 센티널
}

/**
 * 채집 명령을 푼다 (진행분 폐기 + `gatherLost`). **짐은 안 건드린다** —
 * 등에 진 것은 명령을 바꿔도 사라지지 않는다(D3). 그래서 비상 소집이 공짜다(E-4).
 */
export function cancelGather(ctx: SimCtx, a: AllySim, reason: 'moved' | 'cleared'): void {
  if (a.gatherKey < 0) return;
  const cell = ctx.resources.at(a.gatherKey);
  ctx.events.push({
    type: 'gatherLost',
    allyId: a.id,
    defId: a.defId,
    cellX: cell ? cell.cellX : -1,
    cellZ: cell ? cell.cellZ : -1,
    reason,
    gold: 0,
  });
  a.gatherKey = -1;
  a.gatherTicks = 0;
  a.gatherHpMark = 0;
}

/**
 * 그 칸을 예약한 사람의 명령을 푼다 — `battle.cmdClearScenery`가 부른다(E-14).
 * 치운 사람이 그 짐을 버린 것이고, 그것이 D1이 만든 `clearScenery`의 기회비용이다.
 */
export function cancelGatherersOf(ctx: SimCtx, key: number): void {
  // 예약이 배타적이라 최대 한 명이다. **그 불변식을 코드로 표현한다** — break가 없으면
  // 이벤트 순서가 items(풀 swap-remove) 순서를 타고, 그건 이 파일의 다른 모든 순회가
  // 지키는 id 오름차순 규약에서 이것 하나만 빠지는 형태다.
  for (const a of ctx.world.allies.items) {
    if (a.alive && a.gatherKey === key) {
      cancelGather(ctx, a, 'cleared');
      break;
    }
  }
}

/**
 * 전용 스크래치 버퍼 — `allies.ts`의 `pickOrder`·`orderOrder`와 **공유하지 않는다.**
 * 지금은 `applyCommand`가 `tick()` 밖에서 도는 덕에 충돌이 없지만, 그 성질은 언제든
 * 한 줄로 깨진다. 버퍼를 빌려 쓰면 "루프 도중에 같은 버퍼를 다시 채우는" 재진입 지뢰가 선다.
 */
const gatherOrder: AllySim[] = [];

/**
 * 매 틱 — 사망 정산 → 캐기 진행 → 짐 확정 → 자동 귀환 → 배달 (아군 id 오름차순).
 *
 * **틱 안의 자리는 8-b(`sweepDeadAllies` 바로 앞)다.** 한 자리가 네 조건을 동시에 만족한다:
 *  · 4) `moveAllies` 뒤  → **같은 틱의 도착**과 **같은 틱의 배달 진입**을 읽는다(한 틱 지연 없음)
 *  · 2) `updateAllies` 뒤 → 난투는 아군 피해의 **유일한** 발생지다. **이 틱의 피해**로
 *       중단 판정(D5)이 선다. 앞에 두면 언제나 한 틱 늦게 끊긴다
 *  · 9) `sweepDeadAllies` 앞 → **죽은 사람의 짐**을 흘릴 수 있다(E-10). 뒤로 가면 시체가
 *       이미 회수돼 `gatherLost{'died'}`가 영영 안 나간다
 *  · 10) `checkEnd` 앞 → **승패를 선언하는 틱에도 마을에 닿아 있으면 지급된다**(E-12)
 */
export function updateGather(ctx: SimCtx): void {
  const base = ctx.opts.stage.baseCell;
  const range2 = GATHER_DELIVER_RANGE * GATHER_DELIVER_RANGE;
  // ⚠ **`fillAllAllyIds`다 — 죽은 아군까지 넣는다.** 아래 ①이 시체의 짐을 정산해야 하고,
  //   `fillAliveAllyIds`(updateAllies·moveAlly용)를 쓰면 E-10이 도달 불가 코드가 된다.
  fillAllAllyIds(ctx.world.allies.items, gatherOrder);

  for (const a of gatherOrder) {
    // ── ① 죽었다 (E-10) ─────────────────────────────────────────────────────
    // `sweepDeadAllies`(9단계)는 이 아래에 있으므로 시체가 아직 배열에 있다.
    // 짐은 **전액 소멸한다** — 지고 오는 길이 위험하다는 것이 이 설계의 값이다.
    // 이 가드가 없으면 시체가 마을에 닿아 ③에서 지급받는다.
    if (!a.alive) {
      if (a.carryCount > 0) {
        ctx.events.push({
          type: 'gatherLost',
          allyId: a.id,
          defId: a.defId,
          cellX: Math.round(a.x),
          cellZ: Math.round(a.z),
          reason: 'died',
          gold: a.carryGold,
        });
      }
      a.carryGold = 0;
      a.carryCount = 0;
      a.gatherKey = -1; // 예약을 즉시 푼다 — 남이 그 칸을 다시 찍을 수 있어야 한다
      a.gatherTicks = 0;
      a.gatherHpMark = 0;
      continue;
    }

    // ── ② 캐기 ──────────────────────────────────────────────────────────────
    if (a.gatherKey >= 0) {
      const cell = ctx.resources.at(a.gatherKey);
      if (!cell || cell.taken) {
        // 골드로 치워졌거나(cmdClearScenery가 이미 cancelGatherersOf를 부르므로 여기까지
        // 오는 경우는 방어선이다) 어쩌다 무효해졌다 → 예약만 푼다.
        // **계속 걸어가 그 자리에 선다**(tgt 유지) — 명령의 절반("거기로 가라")은 여전히 유효하다.
        a.gatherKey = -1;
        a.gatherTicks = 0;
        a.gatherHpMark = 0;
      } else if (isGathering(a)) {
        // 도착해 있다 = **캐는 중**
        const need = gatherTicksFor(a.def, cell.kind);
        if (a.gatherHpMark === 0) {
          // 이번 **예약**의 첫 도착 — hp를 마크하고 화면에 게이지를 켠다.
          // ⚠ 조건이 `gatherTicks === 0`이 **아니다**: 맞아서 0으로 되돌아갈 때마다
          //   gatherStarted가 다시 나가면 전선 옆 칸(s1 40칸 중 22칸)에서 난투 쿨다운
          //   간격으로 `gatherLost{'hit'}` + `gatherStarted`가 쌍으로 뿜어진다.
          a.gatherHpMark = a.hp;
          ctx.events.push({
            type: 'gatherStarted',
            allyId: a.id,
            defId: a.defId,
            cellX: cell.cellX,
            cellZ: cell.cellZ,
            kind: cell.kind,
            value: cell.value,
            ticks: need,
          });
        } else if (a.hp < a.gatherHpMark) {
          // D5) 맞으면 **손이 멈춘다.** 진행분이 0으로 돌아간다.
          // 예약도 짐도 안 건드린다 — 적이 지나가면 그 자리에서 처음부터 다시 캔다.
          // 이벤트는 진행분이 있었을 때만 낸다(초당 여러 건을 뿜지 않게).
          if (a.gatherTicks > 0) {
            ctx.events.push({
              type: 'gatherLost',
              allyId: a.id,
              defId: a.defId,
              cellX: cell.cellX,
              cellZ: cell.cellZ,
              reason: 'hit',
              gold: 0,
            });
          }
          a.gatherTicks = 0;
          a.gatherHpMark = a.hp; // 새 시도의 시작 (0이 아니므로 gatherStarted는 다시 안 나간다)
          // 이 틱은 진행 없음 — 아래 ++를 건너뛴다.
          // ⚠ 배달 판정(③)도 함께 건너뛴다. 배달 반경 0.7 안에는 자원 칸이 하나도 없으므로
          //   (E-13) "캐는 중이면서 마을 안"인 상태가 **구조적으로 존재하지 않는다.**
          continue;
        }
        a.gatherTicks++;
        if (a.gatherTicks >= need) {
          // 짐 하나 완성 = **이 순간 칸이 텄다** (한 칸 한 짐, D2)
          cell.taken = true;
          a.carryGold += cell.value; // 값이 여기서 굳는다 — 칸을 다시 조회하지 않는다
          a.carryCount++;
          a.gatherKey = -1;
          a.gatherTicks = 0;
          a.gatherHpMark = 0; // 다음 예약을 위한 센티널 복구
          const cap = a.def.carryCap ?? 1;
          ctx.events.push({
            type: 'gathered',
            allyId: a.id,
            defId: a.defId,
            cellX: cell.cellX,
            cellZ: cell.cellZ,
            kind: cell.kind,
            value: cell.value,
            carried: a.carryCount,
            carryCap: cap,
          });
          if (a.carryCount >= cap) {
            // 가득 찼다 → **자동 귀환**(D6). 자동으로 다음 칸을 캐지는 않는다(D4).
            // 목표는 집결 지점이 아니라 **기지 셀 자체**다 — 집결 지점은 배달 반경 0.7
            // 밖이라(ALLY_MUSTER_FORWARD 1.4) 거기 서면 영영 지급이 안 된다.
            a.tgtX = base.x;
            a.tgtZ = base.z;
          }
          // 가득 안 찼으면 **그 자리에 선다** — 다음 칸은 플레이어가 찍는다(D4).
        }
      }
      // 도착 전이면 아무것도 안 한다 (걷는 중)
    }

    // ── ③ 배달 (D3) — **상태가 아니라 위치 판정이다** ────────────────────────
    // 짐을 진 채 마을 반경에 들어오면 **어디로 가던 중이든** 지급된다. 그래서 비상
    // 소집이 공짜다(E-4): 짐 진 사람을 불러도 돈이 사라지지 않고 늦어질 뿐이다.
    if (a.carryCount > 0) {
      const dx = a.x - base.x;
      const dz = a.z - base.z;
      if (dx * dx + dz * dz <= range2) {
        // ⚠ 채집이 골드를 내는 **유일한** 자리다. 수입 addGold 호출부는 이것으로 넷이 된다
        //   (combat.leakEnemy 경로 · battle.checkEnd 웨이브 보상 · battle 조기 호출 · 여기).
        addGold(ctx, a.carryGold);
        ctx.events.push({
          type: 'gatherDelivered',
          allyId: a.id,
          defId: a.defId,
          gold: a.carryGold,
          loads: a.carryCount,
          x: a.x,
          z: a.z,
        });
        a.carryGold = 0;
        a.carryCount = 0;
        // **그 자리에 선다**(D4) — 자동 반복이 코드에 존재하지 않는다.
        // tgt를 지금 위치로 박아 마을 안으로 더 걸어 들어가지 않게 한다.
        a.tgtX = a.x;
        a.tgtZ = a.z;
      }
    }
  }
}
