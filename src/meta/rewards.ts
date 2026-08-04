/**
 * 전투 정산 — 호박/조각/진행도/해금을 프로필에 반영하고 ResultSummary를 만든다.
 * 조각 분배: 클리어한 보스 웨이브 수만큼, 해금된 타워에 순환 지급 (스테이지별 회전).
 */
import type { ProfileApi, ResultSummary, StageDef, TowerId } from '@/data/types';
import { ALL_TOWER_IDS, TOWER_DEFS } from '@/data';

const SHARDS_PER_BOSS_BASE = 3;
const REPEAT_CLEAR_AMBER_RATIO = 0.25;

export interface BattleOutcome {
  won: boolean;
  /** 마지막 진행 웨이브 (패배 시 그 웨이브에서 죽음) */
  wave: number;
  endless: boolean;
  /** sim이 집계한 웨이브 클리어 호박 */
  amberEarned: number;
  kills: number;
  bossKills: number;
}

export function settleBattle(
  profile: ProfileApi,
  stage: StageDef,
  outcome: BattleOutcome,
): ResultSummary {
  const p = profile.stageProgress(stage.id);
  const clearedWaves = outcome.won ? stage.waveCount : Math.max(0, outcome.wave - 1);
  const firstClear = outcome.won && !outcome.endless && !p.cleared;

  // 호박: sim 집계 + 클리어 보너스 (최초 전액, 반복 25%)
  let amber = outcome.amberEarned;
  if (outcome.won && !outcome.endless) {
    amber += firstClear
      ? stage.firstClearAmber
      : Math.round(stage.firstClearAmber * REPEAT_CLEAR_AMBER_RATIO);
  }

  // 조각: 보스 웨이브(10단위) 클리어당 (3 + 스테이지id)개, 해금 타워에 회전 지급
  const bossCount = Math.floor(clearedWaves / 10);
  const unlockedIds = ALL_TOWER_IDS.filter((id) => profile.data.towers[id].unlocked);
  const shardsEarned: Partial<Record<TowerId, number>> = {};
  for (let i = 0; i < bossCount; i++) {
    const id = unlockedIds[(stage.id * 5 + i) % Math.max(1, unlockedIds.length)];
    if (!id) break;
    const n = SHARDS_PER_BOSS_BASE + stage.id;
    shardsEarned[id] = (shardsEarned[id] ?? 0) + n;
  }

  // --- 프로필 반영 ---
  profile.addAmber(amber);
  for (const [id, n] of Object.entries(shardsEarned) as [TowerId, number][]) {
    profile.data.towers[id].shards += n;
  }
  if (outcome.endless) {
    p.endlessBest = Math.max(p.endlessBest, clearedWaves);
  } else {
    p.bestWave = Math.max(p.bestWave, clearedWaves);
    if (outcome.won) {
      p.cleared = true;
      // 스테이지 클리어 해금 타워
      for (const id of stage.unlockTowers ?? []) {
        if (TOWER_DEFS[id].unlock.type === 'stage') profile.data.towers[id].unlocked = true;
      }
    }
  }
  const stats = profile.data.stats;
  stats.kills += outcome.kills;
  stats.wavesCleared += clearedWaves;
  stats.bossKills += outcome.bossKills;
  profile.save();

  return {
    won: outcome.won,
    stageId: stage.id,
    wave: outcome.won && !outcome.endless ? stage.waveCount : outcome.wave,
    waveCount: stage.waveCount,
    amberEarned: amber,
    shardsEarned,
    firstClear,
    endless: outcome.endless,
    kills: outcome.kills,
  };
}
