/**
 * 타워 지속 상태 표식 — **파괴 잔해**와 **침묵 룬**의 상태 보관소.
 *
 * 왜 필요한가 (두 결함이 같은 원인이다 — "상태가 부재로만 표현된다"):
 *  1) 파괴는 1~2초짜리 파티클이 전부라, 시선을 뗀 사이에 타워를 잃으면 그 칸이
 *     다른 빈 잔디 칸과 구별되지 않았다. 무엇을 잃었는지 되짚을 방법이 화면에 없다.
 *  2) 침묵(hexer의 저주)은 "타워가 조용해진 것"이라 눈에 띄지 않는다. 걸리는 순간의
 *     룬 버스트 한 프레임 말고는, 최대 30틱의 완전 무력화를 읽을 방법이 없었다.
 *
 * ── 왜 자기 메시를 갖지 않는가 (드로우콜 예산) ──────────────────────────────
 * 표식용 InstancedMesh를 따로 두면 그 자체로 **+1 드로우콜**인데, 실측한 최대 메시
 * 프레임(스테이지6 w50 = 보스 개별 3 + 인스턴스 2 + 만렙 타워 12 + 체력바 12)이
 * 이미 60/60이라 그대로 예산을 넘겼다(61 실측). 그래서 표식은 **체력바와 같은
 * InstancedMesh에 얹는다**(healthbars.ts, barKind 2=잔해 / 3=룬). 체력바 메시는
 * 무언가 깎이는 순간 어차피 그려지므로, 오버레이 계층 전체가 드로우콜 **1개**로 끝난다.
 *
 * ── 실측 정정 (5단계): 최대 프레임은 60콜이 아니다 ─────────────────────────
 * 위 "60/60" 은 **최악 프레임이 아닌 장면에서 잰 값**이었다. 실제 최악 프레임
 * (swiftshader 900×1000, 만렙 T5 타워 12~15기 + 적 56 + 아군 6 + 마을 Lv5 정지 프레임)은
 * **73~81콜**이고, 그 천장을 만드는 것은 오버레이도 아군도 아니라 **타워 수**다
 * (타워 1기당 약 3콜 · 상한 없음 — 0기 11콜 / 4기 23 / 8기 36 / 12기 47 / 15기 56).
 * 즉 "여유가 0이라 메시를 못 늘린다"는 전제 자체가 틀렸다.
 *
 * ── 실측 재정정: 타워는 이제 **드로우콜에 실리지 않는다** ────────────────────
 * 위 "1기당 3콜 · 상한 없음" 은 타워가 개별 Mesh 이던 시절 값이다. 지금은 전 타워가
 * `BatchedMesh` 묶음 여섯으로 그려진다(views/towerbatch.ts). 실제 렌더러 실측
 * (크로미움 swiftshader 1280×800, 8종×티어 섞기):
 *   전  0기 10콜 · 4기 22 · 12기 46 · 24기 82 · 40기 130
 *   후  0기 10콜 · 4기 14 · 12기 14 · 24기 14 · 40기 14  (맞는 중이면 +3, 배치 중이면 +2)
 * 그래서 최악 프레임의 천장을 만드는 것은 더 이상 타워 수가 아니다.
 *
 * 그래도 **이 구조는 그대로 둔다**: 오버레이를 한 메시로 묶는 판단은 여유가 0이어서가
 * 아니라 "무언가 깎이는 순간 어차피 그려지는 메시에 얹으면 공짜"이기 때문이고,
 * 그 논리는 실측이 어떻든 유효하다. 예산 관계의 최신 실측 표는
 * views/enemyview.ts 헤더와 tests/e2e/smoke.spec.ts 의 '최악 프레임' 테스트에 있다.
 *
 * 잔해는 **그 칸에 다시 지을 때까지** 남는다 — 소품 제거로 열린 칸과 헷갈리지 않게
 * 그을음(어두운 원)에 무너진 기둥 자국(밝은 호)을 얹어 "여기 뭔가 서 있었다"를 만든다.
 */
import type { TowerState } from '@/data/types';

/** 표식 종류 — healthbars.ts의 barKind 값과 같은 축이다 (0 적바 / 1 타워바) */
export const MARK_RUBBLE = 2;
export const MARK_SILENCE = 3;

/** 동시에 남길 수 있는 잔해 수 (배치 상한보다 넉넉히) */
const RUBBLE_MAX = 24;
/** 잔해 표식 지름(셀) — 타워 발판보다 살짝 넓게 */
const RUBBLE_SIZE = 1.12;
/** 침묵 룬 지름(셀) */
const RUNE_SIZE = 1.35;
/** 잔해가 완전히 진해지기까지의 시간(초) — 먼지가 가라앉는 연출 */
const SETTLE_SEC = 0.9;

interface Rubble {
  cellX: number;
  cellZ: number;
  tier: number;
  age: number;
}

/** 표식 하나 — healthbars가 인스턴스로 굽는다 */
export interface TowerMark {
  cellX: number;
  cellZ: number;
  /** 타워 티어 (룬 높이 계산용) */
  tier: number;
  kind: number;
  /** 셀 단위 지름 */
  size: number;
  /** 셰이더 위상값 — 잔해는 정착도(0~1), 룬은 개체별 위상 오프셋 */
  phase: number;
  /** 지면(잔해)인가 — false면 타워 지붕 위(룬) */
  ground: boolean;
}

export class TowerMarksView {
  private rubble: Rubble[] = [];
  private towers: readonly TowerState[] = [];
  private out: TowerMark[] = [];

  /** 타워가 부서졌다 — 그 칸에 잔해를 남긴다 (다시 지을 때까지 유지) */
  markDestroyed(cellX: number, cellZ: number, tier: number): void {
    this.clearCell(cellX, cellZ);
    if (this.rubble.length >= RUBBLE_MAX) this.rubble.shift();
    this.rubble.push({ cellX, cellZ, tier, age: 0 });
  }

  /** 그 칸이 다시 쓰이면(재건설/소품 제거) 잔해를 치운다 */
  clearCell(cellX: number, cellZ: number): void {
    const i = this.rubble.findIndex((r) => r.cellX === cellX && r.cellZ === cellZ);
    if (i >= 0) this.rubble.splice(i, 1);
  }

  hasRubble(cellX: number, cellZ: number): boolean {
    return this.rubble.some((r) => r.cellX === cellX && r.cellZ === cellZ);
  }

  /** sim 타워 배열 연결 — DenseList.items는 참조가 고정이라 한 번만 넘기면 된다 */
  setTowers(towers: readonly TowerState[]): void {
    this.towers = towers;
  }

  /** 시간 진행 (잔해 정착) — stage3d.update가 부른다 */
  tick(dt: number): void {
    for (const r of this.rubble) r.age = Math.min(SETTLE_SEC, r.age + dt);
  }

  /** 이번 프레임에 그릴 표식 목록 (배열은 재사용된다 — 프레임 밖으로 들고 나가지 말 것) */
  marks(): readonly TowerMark[] {
    const out = this.out;
    out.length = 0;
    for (const r of this.rubble) {
      out.push({
        cellX: r.cellX,
        cellZ: r.cellZ,
        tier: r.tier,
        kind: MARK_RUBBLE,
        // 큰 타워일수록 잔해도 크다 — 무엇을 잃었는지가 크기로도 읽힌다
        size: RUBBLE_SIZE * (0.86 + r.tier * 0.09),
        phase: r.age / SETTLE_SEC,
        ground: true,
      });
    }
    for (const t of this.towers) {
      if (t.silenceLeft <= 0) continue;
      out.push({
        cellX: t.cellX,
        cellZ: t.cellZ,
        tier: t.tier,
        kind: MARK_SILENCE,
        size: RUNE_SIZE,
        // 타워마다 위상을 어긋내 여러 개가 한 몸처럼 깜빡이지 않게
        phase: (t.id % 7) * 0.9,
        ground: false,
      });
    }
    return out;
  }

  dispose(): void {
    this.rubble.length = 0;
    this.out.length = 0;
    this.towers = [];
  }
}
