/**
 * 프로필 해금 판정 — 설정의 '모든 스테이지 열기'(unlockAll)를 계약으로 잠근다.
 *
 * 지키려는 것 두 가지:
 *  1) unlockAll은 **판정만** 우회한다. 진행도(cleared/bestWave/endlessBest)는
 *     켜도 꺼도 그대로여야 한다 — 껐을 때 "다 잠겼는데 기록도 날아갔다"가 최악이다.
 *  2) 옛 세이브에는 이 필드가 없다. 로드하면 undefined가 아니라 **false**여야 한다
 *     (undefined면 `if (settings.unlockAll)`은 통과 못 하지만 스위치 aria-checked가
 *      "undefined" 문자열이 되고, JSON에 그대로 새어 나간다).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENDLESS_UNLOCK_STAGE, createProfile } from '@/meta/profile';
import { crc } from '@/core/save';
import type { ProfileData, SaveFile } from '@/data/types';

const KEY = 'wogawoga.save';

/** node 환경이라 localStorage가 없다 — 테스트가 직접 세이브를 심을 수 있게 최소 목을 깐다 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

/** save.ts의 봉투 규약(v/crc/data) 그대로 써 넣는다 — crc가 틀리면 loadSave가 통째로 버린다 */
function writeRaw(file: unknown): void {
  const dataStr = JSON.stringify(file);
  localStorage.setItem(KEY, JSON.stringify({ v: 1, crc: crc(dataStr), data: file }));
}

/** unlockAll 필드가 아예 없는 '옛 세이브'의 profile 조각 */
function oldProfile(): unknown {
  const towers: Record<string, unknown> = {};
  towers['spear'] = { unlocked: true, stars: 2, shards: 5 };
  return {
    amber: 777,
    towers,
    stages: {
      1: { bestWave: 30, cleared: true, endlessBest: 12 },
      2: { bestWave: 7, cleared: false, endlessBest: 0 },
    },
    milestones: [],
    // ← unlockAll 없음 (이게 이 테스트의 요점)
    settings: { lang: 'ko', music: 0.5, sfx: 0.4, vibration: false, quality: 'low' },
    stats: { kills: 10, wavesCleared: 3, playMs: 100, bossKills: 1 },
  };
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('스테이지 해금 판정', () => {
  it('unlockAll=false면 스테이지2는 잠겨 있고 1만 열린다', () => {
    const p = createProfile();
    expect(p.data.settings.unlockAll).toBe(false);
    expect(p.isStageUnlocked(1)).toBe(true);
    expect(p.isStageUnlocked(2)).toBe(false);
    expect(p.isStageUnlocked(6)).toBe(false);
  });

  it('unlockAll=true면 6개 스테이지가 전부 열린다', () => {
    const p = createProfile();
    p.updateSettings({ unlockAll: true });
    for (let id = 1; id <= 6; id++) expect(p.isStageUnlocked(id), `스테이지 ${id}`).toBe(true);
  });

  it('unlockAll=true면 무한 모드도 열린다 (해금 스테이지 미클리어라도)', () => {
    const p = createProfile();
    expect(p.stageProgress(ENDLESS_UNLOCK_STAGE).cleared).toBe(false);
    expect(p.isEndlessUnlocked()).toBe(false);
    p.updateSettings({ unlockAll: true });
    expect(p.isEndlessUnlocked()).toBe(true);
  });

  it('우회 경로는 stageProgress를 부르지 않아 빈 진행도를 만들지 않는다', () => {
    const p = createProfile();
    p.updateSettings({ unlockAll: true });
    p.isStageUnlocked(5);
    p.isEndlessUnlocked();
    // stageProgress()는 없는 항목을 만들어 넣는 부수효과가 있다 — 판정만으로는 안 불려야 한다
    expect(Object.keys(p.data.stages)).toEqual([]);
  });
});

describe('세이브 하위호환', () => {
  it('unlockAll이 없는 옛 세이브를 읽으면 false로 정규화된다', () => {
    writeRaw({ version: 1, createdAt: 1, updatedAt: 2, profile: oldProfile() });
    const p = createProfile();
    expect(p.data.settings.unlockAll).toBe(false);
    expect(p.data.settings.unlockAll).not.toBeUndefined();
    // 나머지 옛 설정은 그대로 살아 있어야 한다
    expect(p.data.settings.music).toBe(0.5);
    expect(p.data.settings.vibration).toBe(false);
    expect(p.data.settings.quality).toBe('low');
    // 판정도 옛 진행도 기준 그대로 (1 클리어 → 2 열림, 3은 잠김)
    expect(p.isStageUnlocked(2)).toBe(true);
    expect(p.isStageUnlocked(3)).toBe(false);
  });

  it('손상된 세이브가 unlockAll에 boolean이 아닌 값을 넣어도 false가 된다', () => {
    const prof = oldProfile() as { settings: Record<string, unknown> };
    prof.settings['unlockAll'] = 'yes';
    writeRaw({ version: 1, createdAt: 1, updatedAt: 2, profile: prof });
    const p = createProfile();
    expect(p.data.settings.unlockAll).toBe(false);
  });
});

describe('진행도 보존', () => {
  it('켰다 꺼도 cleared/bestWave/endlessBest가 손상되지 않는다', () => {
    writeRaw({ version: 1, createdAt: 1, updatedAt: 2, profile: oldProfile() });
    const p = createProfile();
    const before = structuredClone(p.data.stages);

    p.updateSettings({ unlockAll: true });
    expect(p.isStageUnlocked(6)).toBe(true);
    p.updateSettings({ unlockAll: false });

    expect(p.data.stages).toEqual(before);
    expect(p.stageProgress(1).cleared).toBe(true);
    expect(p.stageProgress(1).bestWave).toBe(30);
    expect(p.stageProgress(1).endlessBest).toBe(12);
    expect(p.stageProgress(2).cleared).toBe(false);
    expect(p.stageProgress(2).bestWave).toBe(7);
    // 껐으니 잠금도 원래대로 돌아온다
    expect(p.isStageUnlocked(3)).toBe(false);
    expect(p.isEndlessUnlocked()).toBe(false);
    expect(p.data.amber).toBe(777);
  });

  it('토글 값은 세이브에 실려 다음 로드에서 살아난다', () => {
    const p = createProfile();
    p.updateSettings({ unlockAll: true });
    p.save();

    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const env = JSON.parse(raw as string) as { data: SaveFile };
    expect(env.data.profile.settings.unlockAll).toBe(true);

    const p2 = createProfile();
    expect(p2.data.settings.unlockAll).toBe(true);
    expect(p2.isStageUnlocked(4)).toBe(true);
  });
});

describe('기본 프로필', () => {
  it('새 프로필의 settings에 unlockAll 키가 실제로 존재한다', () => {
    const p = createProfile();
    const s = p.data.settings as ProfileData['settings'];
    expect(Object.prototype.hasOwnProperty.call(s, 'unlockAll')).toBe(true);
    expect(s.unlockAll).toBe(false);
  });
});
