/**
 * 스테이지 데이터 검증 — 레이아웃/경로/슬롯의 기하학적 정합성.
 * 경로 래스터라이즈: 셀 연속 좌표에서 셀 = (round(x), round(z)), 선분을 0.25 간격 샘플.
 */
import { describe, expect, it } from 'vitest';
import type { EnemyId, StageDef, TowerId } from '@/data/types';
import { STAGES } from '@/data/stages';
import { TOWER_DEFS } from '@/data/towers';
import { ENEMY_DEFS } from '@/data/enemies';

const LEGAL_CHARS = new Set(['.', '~', 'o', '#']);
const BOSS_IDS: EnemyId[] = ['spino', 'trex'];

function cellKey(x: number, z: number): string {
  return `${x},${z}`;
}

/** 경로 선분들을 0.25 간격으로 샘플해 지나는 셀 집합을 만든다 */
function rasterize(stage: StageDef): Set<string> {
  const cells = new Set<string>();
  for (const path of stage.paths) {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const len = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / 0.25));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        cells.add(cellKey(Math.round(x), Math.round(z)));
      }
    }
  }
  return cells;
}

/** 웨이포인트 폴리라인의 길이 (코너 라운딩 없는 근사 — 여기서는 비교만 한다) */
function polyLength(path: readonly { x: number; z: number }[]): number {
  let n = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    n += Math.hypot(path[i + 1]!.x - path[i]!.x, path[i + 1]!.z - path[i]!.z);
  }
  return n;
}

function slotCells(stage: StageDef): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = 0; z < stage.gridH; z++) {
    const row = stage.layout[z]!;
    for (let x = 0; x < stage.gridW; x++) if (row[x] === 'o') out.push({ x, z });
  }
  return out;
}

describe('stages', () => {
  it('6개 스테이지, id 1..6 순서', () => {
    expect(STAGES.length).toBe(6);
    STAGES.forEach((s, i) => expect(s.id).toBe(i + 1));
  });

  for (const stage of STAGES) {
    describe(`stage ${stage.id} (${stage.biome})`, () => {
      it('레이아웃 크기와 문자 유효', () => {
        expect(stage.gridW).toBeGreaterThanOrEqual(11);
        expect(stage.gridW).toBeLessThanOrEqual(13);
        expect(stage.gridH).toBeGreaterThanOrEqual(15);
        expect(stage.gridH).toBeLessThanOrEqual(17);
        expect(stage.layout.length, '행 수 = gridH').toBe(stage.gridH);
        for (const row of stage.layout) {
          expect(row.length, '행 길이 = gridW').toBe(stage.gridW);
          for (const ch of row) expect(LEGAL_CHARS.has(ch), `문자 '${ch}'`).toBe(true);
        }
      });

      it('경로: 1~2개, 축 정렬, 가장자리 시작, 끝 = baseCell, 그리드 내부', () => {
        expect(stage.paths.length).toBeGreaterThanOrEqual(1);
        expect(stage.paths.length).toBeLessThanOrEqual(2);
        for (const path of stage.paths) {
          expect(path.length).toBeGreaterThanOrEqual(2);
          for (const wp of path) {
            expect(Number.isInteger(wp.x) && Number.isInteger(wp.z), '정수 웨이포인트').toBe(true);
            expect(wp.x).toBeGreaterThanOrEqual(0);
            expect(wp.x).toBeLessThan(stage.gridW);
            expect(wp.z).toBeGreaterThanOrEqual(0);
            expect(wp.z).toBeLessThan(stage.gridH);
          }
          const first = path[0]!;
          const onEdge =
            first.x === 0 || first.x === stage.gridW - 1 || first.z === 0 || first.z === stage.gridH - 1;
          expect(onEdge, '스폰은 가장자리').toBe(true);
          const last = path[path.length - 1]!;
          expect(last).toEqual(stage.baseCell);
          for (let i = 0; i + 1 < path.length; i++) {
            const a = path[i]!;
            const b = path[i + 1]!;
            expect(a.x === b.x || a.z === b.z, `축 정렬 (${a.x},${a.z})→(${b.x},${b.z})`).toBe(true);
            expect(a.x !== b.x || a.z !== b.z, '중복 웨이포인트 금지').toBe(true);
          }
        }
      });

      /**
       * **공중 레인**(있는 스테이지만) — 지상 경로와 같은 기하 계약을 지킨다.
       * 물(`~`)은 검사하지 않는다: 날아가는 길이라 지형을 밟지 않고, 실제로 그 위를
       * 지나는 것이 정상이다. 대신 **어디서 시작해 어디서 끝나는가**는 같아야 한다 —
       * 스폰이 가장자리가 아니면 화면 밖에서 튀어나오고, 끝이 화덕이 아니면 누수가
       * 영원히 안 난다. 그리고 하늘길은 지상보다 **짧아야** 의미가 있다(우회로이므로).
       */
      it('공중 레인: 가장자리에서 시작해 화덕에서 끝나고, 지상보다 짧다', () => {
        const air = stage.airPaths;
        if (!air) return;
        expect(air.length).toBeGreaterThanOrEqual(1);
        const groundLen = Math.min(...stage.paths.map(polyLength));
        for (const path of air) {
          expect(path.length).toBeGreaterThanOrEqual(2);
          for (const wp of path) {
            expect(Number.isInteger(wp.x) && Number.isInteger(wp.z), '정수 웨이포인트').toBe(true);
            expect(wp.x).toBeGreaterThanOrEqual(0);
            expect(wp.x).toBeLessThan(stage.gridW);
            expect(wp.z).toBeGreaterThanOrEqual(0);
            expect(wp.z).toBeLessThan(stage.gridH);
          }
          const first = path[0]!;
          const onEdge =
            first.x === 0 || first.x === stage.gridW - 1 || first.z === 0 || first.z === stage.gridH - 1;
          expect(onEdge, '공중 스폰은 가장자리').toBe(true);
          expect(path[path.length - 1]!).toEqual(stage.baseCell);
          const len = polyLength(path);
          expect(len, `공중 ${len.toFixed(2)} / 지상 ${groundLen.toFixed(2)}`).toBeLessThan(groundLen);
        }
      });

      it("경로가 '~'(물) 셀을 지나지 않음 (0.25 간격 래스터라이즈)", () => {
        for (const key of rasterize(stage)) {
          const [xs, zs] = key.split(',');
          const x = Number(xs);
          const z = Number(zs);
          expect(x >= 0 && x < stage.gridW && z >= 0 && z < stage.gridH, `경계 밖 ${key}`).toBe(true);
          expect(stage.layout[z]![x], `물 위 경로 ${key}`).not.toBe('~');
        }
      });

      it('슬롯 8~12개, 경로와 겹치지 않고 경로에 인접(체비셰프 ≤2)', () => {
        const slots = slotCells(stage);
        expect(slots.length).toBeGreaterThanOrEqual(8);
        expect(slots.length).toBeLessThanOrEqual(12);
        const pathSet = rasterize(stage);
        const pathList = [...pathSet].map((k) => {
          const [xs, zs] = k.split(',');
          return { x: Number(xs), z: Number(zs) };
        });
        for (const s of slots) {
          expect(pathSet.has(cellKey(s.x, s.z)), `슬롯 (${s.x},${s.z})이 경로 위`).toBe(false);
          const near = pathList.some((p) => Math.max(Math.abs(p.x - s.x), Math.abs(p.z - s.z)) <= 2);
          expect(near, `슬롯 (${s.x},${s.z})이 경로에서 너무 멂`).toBe(true);
        }
      });

      it('기지 셀이 물이 아님', () => {
        expect(stage.layout[stage.baseCell.z]![stage.baseCell.x]).not.toBe('~');
      });

      it('웨이브 플랜 파라미터 범위', () => {
        const p = stage.wavePlan;
        expect(stage.waveCount).toBe(50);
        // 스테이지1은 실측 플레이 튜닝으로 완만한 커브 허용 (초심자 클리어 보장)
        expect(p.budgetGrowth).toBeGreaterThanOrEqual(stage.id === 1 ? 1.08 : 1.11);
        expect(p.budgetGrowth).toBeLessThanOrEqual(1.15);
        expect(p.hpGrowth).toBeGreaterThanOrEqual(stage.id === 1 ? 1.015 : 1.045);
        expect(p.hpGrowth).toBeLessThanOrEqual(1.06);
        expect(stage.baseHp).toBe([25, 20, 25, 25, 30, 30][stage.id - 1]);
        expect(stage.startGold).toBeGreaterThanOrEqual(220);
        expect(stage.startGold).toBeLessThanOrEqual(300);
        expect(stage.perWaveAmber).toBeGreaterThanOrEqual(1);
        expect(stage.perWaveAmber).toBeLessThanOrEqual(3);
        // allowedEnemies에는 보스가 없어야 함 (보스는 오버라이드 전용)
        for (const id of p.allowedEnemies) expect(ENEMY_DEFS[id].boss, id).toBeFalsy();
      });

      it('보스 오버라이드: 10/20/30/40/50, 적/경로 인덱스 유효', () => {
        const p = stage.wavePlan;
        expect(Object.keys(p.bossOverrides).map(Number).sort((a, b) => a - b)).toEqual([
          10, 20, 30, 40, 50,
        ]);
        const airLanes = stage.airPaths?.length ?? stage.paths.length;
        for (const def of Object.values(p.bossOverrides)) {
          expect(def.groups.length).toBeGreaterThan(0);
          for (const sg of def.groups) {
            const ok = p.allowedEnemies.includes(sg.enemyId) || BOSS_IDS.includes(sg.enemyId);
            expect(ok, `오버라이드 적 ${sg.enemyId}`).toBe(true);
            const lanes = ENEMY_DEFS[sg.enemyId].flying ? airLanes : stage.paths.length;
            expect(sg.pathIndex).toBeGreaterThanOrEqual(0);
            expect(sg.pathIndex, 'pathIndex 범위').toBeLessThan(lanes);
            expect(sg.count).toBeGreaterThanOrEqual(1);
            expect(sg.hpMul).toBeGreaterThan(0);
          }
        }
      });
    });
  }

  it('예산/체력/호박 커브가 스테이지 순으로 상승', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const prev = STAGES[i - 1]!;
      const cur = STAGES[i]!;
      expect(cur.wavePlan.budgetBase).toBeGreaterThan(prev.wavePlan.budgetBase);
      expect(cur.wavePlan.hpBase).toBeGreaterThan(prev.wavePlan.hpBase);
      expect(cur.firstClearAmber).toBeGreaterThan(prev.firstClearAmber);
    }
    expect(STAGES[0]!.wavePlan.budgetBase).toBe(20);
    expect(STAGES[5]!.wavePlan.budgetBase).toBe(45);
    expect(STAGES[0]!.wavePlan.hpBase).toBe(1.0);
    expect(STAGES[5]!.wavePlan.hpBase).toBe(2.2);
  });

  /**
   * **적 해금 사다리는 역행하지 않는다** — 스테이지 n에서 나온 종은 n+1에도 나온다.
   *
   * 실제로 역행이 있었다: 습격대 4종이 stage3에서 완성됐는데 stage4에 hexer가 빠져
   * (3 → 4에서 사라졌다가 5에서 복귀) stage4의 습격대 비율이 11.3%로 다른 스테이지
   * (19~37%)의 절반 이하가 됐다. 스테이지 주석도 서로 다른 데뷔를 주장하고 있었다.
   */
  it('적 해금 사다리가 역행하지 않는다 (스테이지 n의 종은 n+1에도 있다)', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const prev = STAGES[i - 1]!;
      const cur = STAGES[i]!;
      const lost = prev.wavePlan.allowedEnemies.filter(
        (id) => !cur.wavePlan.allowedEnemies.includes(id),
      );
      expect(lost, `stage ${prev.id} → ${cur.id} 에서 사라진 적`).toEqual([]);
    }
  });

  it('unlockTowers가 타워 해금표와 일치', () => {
    const stageUnlocks = new Map<number, TowerId[]>();
    for (const stage of STAGES) {
      for (const tid of stage.unlockTowers ?? []) {
        expect(TOWER_DEFS[tid], `유효 타워 ${tid}`).toBeDefined();
        stageUnlocks.set(stage.id, [...(stageUnlocks.get(stage.id) ?? []), tid]);
      }
    }
    for (const [tid, def] of Object.entries(TOWER_DEFS)) {
      if (def.unlock.type === 'stage') {
        const list = stageUnlocks.get(def.unlock.stage) ?? [];
        expect(list.includes(tid as TowerId), `${tid}는 stage${def.unlock.stage}에서 해금`).toBe(true);
      }
    }
  });
});
