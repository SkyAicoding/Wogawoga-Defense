/**
 * audio 싱글톤 조립 + 재수출.
 * 사용법:
 *   audio.unlock()           — 첫 사용자 제스처 핸들러에서 1회 (이후 호출도 안전)
 *   audio.play('uiTap')      — SFX 재생 (컨텍스트 없으면 no-op)
 *   audio.music.start() / stop() / setBiome(b) / setIntensity(0~3) / playStinger(kind)
 *   audio.setMusicVolume / setSfxVolume / setMuted — Settings 값(0~1) 그대로 전달
 */
import { audioMgr } from './audiomgr';
import { Sfx, SFX_NAMES } from './sfx';
import type { SfxName } from './sfx';
import { Music } from './music';
import type { StingerKind } from './music';

const sfx = new Sfx(audioMgr);
const music = new Music(audioMgr);

// 언락되면 고빈도 SFX 사전 렌더
audioMgr.onUnlock(() => sfx.prewarm());

export const audio = {
  /** 사용자 제스처에서 호출 — AudioContext 생성/재개 (iOS 무음 버퍼 포함) */
  unlock(): void {
    audioMgr.unlock();
  },
  get unlocked(): boolean {
    return audioMgr.unlocked;
  },
  play(name: SfxName): void {
    sfx.play(name);
  },
  music,
  setMusicVolume(v: number): void {
    audioMgr.setMusicVolume(v);
  },
  setSfxVolume(v: number): void {
    audioMgr.setSfxVolume(v);
  },
  setMuted(m: boolean): void {
    audioMgr.setMuted(m);
  },
  getMusicVolume(): number {
    return audioMgr.getMusicVolume();
  },
  getSfxVolume(): number {
    return audioMgr.getSfxVolume();
  },
  isMuted(): boolean {
    return audioMgr.isMuted();
  },
};

export { SFX_NAMES };
export type { SfxName, StingerKind };
