/**
 * 스테이지 정의 공용 헬퍼 — 웨이포인트/보스 오버라이드 표기를 짧게.
 * 보스 오버라이드의 goldReward는 웨이브젠이 30 + wave×6으로 대체하므로 0으로 둔다.
 * 오버라이드 그룹의 hpMul은 "웨이브 hpMul에 대한 상대값" (wavegen이 곱해서 절대화).
 */
import type { EnemyId, SpawnGroup, Vec2, WaveDef } from '../types';

/** 셀 좌표 웨이포인트 */
export function v(x: number, z: number): Vec2 {
  return { x, z };
}

/** 스폰 그룹 축약 생성자 */
export function g(
  enemyId: EnemyId,
  count: number,
  intervalTicks: number,
  delayTicks: number,
  hpMul = 1,
  pathIndex = 0,
): SpawnGroup {
  return { enemyId, count, intervalTicks, delayTicks, pathIndex, hpMul };
}

/** 보스 오버라이드 웨이브 (goldReward는 웨이브젠이 계산) */
export function bossWave(...groups: SpawnGroup[]): WaveDef {
  return { groups, goldReward: 0 };
}
