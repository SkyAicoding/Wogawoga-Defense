/**
 * 데이터 트랙 공개 표면 — 게임/메타/UI는 여기서만 임포트한다.
 * (types.ts는 계약 파일이라 직접 임포트 허용)
 */
export * from './balance';
export { ENEMY_DEFS, ALL_ENEMY_IDS, BOUNTY_PER_COST } from './enemies';
export { ALLY_DEFS, ALL_ALLY_IDS } from './allies';
// 채집 자원 — sim과 render가 **같은 함수**를 봐야 같은 값을 뽑는다(data/resources.ts 헤더).
// ARRIVE_EPS2 · isGathering · gatherTicksFor 가 여기 섞여 있는 것은 의도다:
// 렌더는 @/sim 을 임포트할 수 없으므로 그 셋이 갈 수 있는 공용 자리가 data/ 뿐이다.
export {
  RESOURCE_DEFS,
  RESOURCE_WEIGHTS,
  LANDMARK_KINDS,
  LANDMARK_RATE,
  resourceKindOf,
  isLandmarkCell,
  ARRIVE_EPS2,
  isGathering,
  gatherTicksFor,
} from './resources';
export { BASE_LEVELS, BASE_LEVEL_MAX } from './hometown';
export { TOWER_DEFS, ALL_TOWER_IDS } from './towers';
export { makeWaveFor } from './wavegen';
export { STAGES, stageById } from './stages';
