/**
 * 영구 진행 프로필 — ProfileApi 구현 (localStorage 세이브 위에서).
 * 설정 변경은 onSettingsChanged 콜백으로 앱에 통지 (오디오/품질/언어 반영).
 */
import { SaveScheduler, clearSave, loadSave } from '@/core/save';
import { ALL_TOWER_IDS, TOWER_DEFS } from '@/data';
import type {
  ProfileApi,
  ProfileData,
  SaveFile,
  Settings,
  StageProgress,
  TowerId,
} from '@/data/types';

export const ENDLESS_UNLOCK_STAGE = 3;

function defaultSettings(): Settings {
  return { lang: 'ko', music: 0.8, sfx: 0.9, vibration: true, quality: 'auto', unlockAll: false };
}

function defaultProfile(): ProfileData {
  const towers = {} as ProfileData['towers'];
  for (const id of ALL_TOWER_IDS) {
    towers[id] = { unlocked: TOWER_DEFS[id].unlock.type === 'start', stars: 0, shards: 0 };
  }
  return {
    amber: 0,
    towers,
    stages: {},
    milestones: [],
    settings: defaultSettings(),
    stats: { kills: 0, wavesCleared: 0, playMs: 0, bossKills: 0 },
  };
}

/** 구버전 세이브에 새 타워/필드가 없을 때 채워넣기 (버전 내 순방향 보정) */
function normalize(data: ProfileData): ProfileData {
  const def = defaultProfile();
  for (const id of ALL_TOWER_IDS) {
    if (!data.towers[id]) data.towers[id] = def.towers[id];
  }
  data.settings = { ...def.settings, ...data.settings };
  /*
   * unlockAll은 스프레드만으로는 부족하다. 세이브 버전을 올리지 않고 필드만 늘렸기 때문에
   * 옛 세이브(v1)가 그대로 들어오는데, 키가 없으면 스프레드가 기본값을 살려 주지만
   * 키가 **명시적 undefined/null/문자열**로 남아 있으면 그대로 덮어써 버린다
   * (localStorage를 손댄 세이브나 다른 도구가 만든 세이브에서 실제로 가능하다).
   * boolean으로 한 번 못박아 "undefined인 unlockAll"이 UI/판정으로 새지 않게 한다.
   */
  data.settings.unlockAll = data.settings.unlockAll === true;
  data.stats = { ...def.stats, ...data.stats };
  return data;
}

export interface Profile extends ProfileApi {
  /** 설정 패치 반영 통지 (앱이 등록) */
  onSettingsChanged: ((s: Settings) => void) | null;
}

export function createProfile(): Profile {
  const loaded = loadSave();
  const data = normalize(loaded ? loaded.profile : defaultProfile());
  const createdAt = loaded?.createdAt ?? Date.now();

  const toFile = (): SaveFile => ({
    version: 1,
    createdAt,
    updatedAt: Date.now(),
    profile: data,
  });
  const scheduler = new SaveScheduler(toFile);

  const stageProgress = (stageId: number): StageProgress => {
    let p = data.stages[stageId];
    if (!p) {
      p = { bestWave: 0, cleared: false, endlessBest: 0 };
      data.stages[stageId] = p;
    }
    return p;
  };

  const api: Profile = {
    data,
    onSettingsChanged: null,

    spendAmber(n) {
      if (data.amber < n) return false;
      data.amber -= n;
      scheduler.request();
      return true;
    },

    addAmber(n) {
      data.amber += n;
      scheduler.request();
    },

    starUp(towerId: TowerId) {
      const tp = data.towers[towerId];
      const def = TOWER_DEFS[towerId];
      if (!tp.unlocked || tp.stars >= 5) return false;
      const cost = def.starCosts[tp.stars];
      if (!cost) return false;
      const [shards, amber] = cost;
      if (tp.shards < shards || data.amber < amber) return false;
      tp.shards -= shards;
      data.amber -= amber;
      tp.stars++;
      scheduler.request();
      return true;
    },

    unlockTower(towerId: TowerId) {
      const tp = data.towers[towerId];
      const unlock = TOWER_DEFS[towerId].unlock;
      if (tp.unlocked || unlock.type !== 'amber') return false;
      if (data.amber < unlock.cost) return false;
      data.amber -= unlock.cost;
      tp.unlocked = true;
      scheduler.request();
      return true;
    },

    stageProgress,

    /*
     * unlockAll이 켜져 있으면 앞 스테이지를 보지 않고 바로 true. stageProgress()는
     * 없는 항목을 **만들어 넣는** 부수효과가 있어서, 우회 경로에서는 호출조차 하지 않는다
     * (설정만 켰다 껐다 해도 세이브에 빈 진행도가 쌓이지 않는다).
     */
    isStageUnlocked(stageId: number) {
      if (data.settings.unlockAll) return true;
      return stageId === 1 || stageProgress(stageId - 1).cleared;
    },

    isEndlessUnlocked() {
      if (data.settings.unlockAll) return true;
      return stageProgress(ENDLESS_UNLOCK_STAGE).cleared;
    },

    updateSettings(patch) {
      Object.assign(data.settings, patch);
      scheduler.request();
      api.onSettingsChanged?.(data.settings);
    },

    resetData() {
      clearSave();
      location.reload();
    },

    save() {
      scheduler.flush();
    },
  };
  return api;
}
