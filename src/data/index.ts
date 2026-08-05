/**
 * 데이터 트랙 공개 표면 — 게임/메타/UI는 여기서만 임포트한다.
 * (types.ts는 계약 파일이라 직접 임포트 허용)
 */
export * from './balance';
export { ENEMY_DEFS, ALL_ENEMY_IDS, BOUNTY_PER_COST } from './enemies';
export { ALLY_DEFS, ALL_ALLY_IDS } from './allies';
export { BASE_LEVELS, BASE_LEVEL_MAX } from './hometown';
export { TOWER_DEFS, ALL_TOWER_IDS } from './towers';
export { makeWaveFor } from './wavegen';
export { STAGES, stageById } from './stages';
