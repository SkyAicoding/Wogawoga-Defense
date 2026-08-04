/** 스테이지 목록 — id 순 정렬 보장 (STAGES[i].id === i+1) */
import type { StageDef } from '../types';
import { stage01 } from './stage01';
import { stage02 } from './stage02';
import { stage03 } from './stage03';
import { stage04 } from './stage04';
import { stage05 } from './stage05';
import { stage06 } from './stage06';

export const STAGES: readonly StageDef[] = [stage01, stage02, stage03, stage04, stage05, stage06];

export function stageById(id: number): StageDef | undefined {
  return STAGES.find((s) => s.id === id);
}
