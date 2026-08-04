/**
 * WebAudio 컨텍스트 관리자 — 지연 생성 + iOS 언락 + 버스/볼륨.
 * 그래프: master(+컴프레서) → destination, musicBus/sfxBus → master.
 * 모든 API는 컨텍스트가 없거나 생성 실패해도 no-op으로 안전하다.
 */

/** 볼륨 변경 램프 시간(초) — 클릭 노이즈 방지 */
const RAMP = 0.03;

type UnlockListener = (ctx: AudioContext) => void;

export class AudioMgr {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicVol = 0.8;
  private sfxVol = 1;
  private muted = false;
  private watchdogArmed = false;
  private unlockListeners: UnlockListener[] = [];

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** 음악 트랙 출력 버스 (없으면 null) */
  get music(): GainNode | null {
    return this.musicBus;
  }

  /** SFX 출력 버스 (없으면 null) */
  get sfx(): GainNode | null {
    return this.sfxBus;
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** 컨텍스트 준비 콜백 — 이미 생성돼 있으면 즉시 호출 */
  onUnlock(fn: UnlockListener): void {
    if (this.ctx) fn(this.ctx);
    else this.unlockListeners.push(fn);
  }

  /**
   * 반드시 사용자 제스처 핸들러 안에서 호출할 것 (iOS 자동재생 정책).
   * resume + 무음 버퍼 재생으로 언락하고, 실패하면 pointerdown 워치독이 재시도한다.
   */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.buildGraph(this.ctx);
      this.watchVisibility();
      const listeners = this.unlockListeners;
      this.unlockListeners = [];
      for (const fn of listeners) fn(this.ctx);
    }
    void this.ctx.resume().catch(() => {});
    this.playSilent();
    if (this.ctx.state !== 'running') this.armWatchdog();
  }

  setMusicVolume(v: number): void {
    this.musicVol = Math.min(1, Math.max(0, v));
    this.ramp(this.musicBus, this.musicVol);
  }

  setSfxVolume(v: number): void {
    this.sfxVol = Math.min(1, Math.max(0, v));
    this.ramp(this.sfxBus, this.sfxVol);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.ramp(this.master, m ? 0 : 1);
  }

  getMusicVolume(): number {
    return this.musicVol;
  }

  getSfxVolume(): number {
    return this.sfxVol;
  }

  isMuted(): boolean {
    return this.muted;
  }

  // -------------------------------------------------------------------------

  private buildGraph(ctx: AudioContext): void {
    // 컴프레서로 다중 SFX 겹침 시 클리핑 방지
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(comp);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);
  }

  private ramp(g: GainNode | null, v: number): void {
    const ctx = this.ctx;
    if (!ctx || !g) return;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(v, t + RAMP);
  }

  /** iOS: resume만으로 부족한 경우가 있어 무음 버퍼를 실제로 재생한다 */
  private playSilent(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* 무시 */
    }
  }

  /** suspended로 남아 있으면 다음 pointerdown마다 재시도 */
  private armWatchdog(): void {
    if (this.watchdogArmed) return;
    this.watchdogArmed = true;
    const retry = (): void => {
      const ctx = this.ctx;
      if (!ctx || ctx.state === 'running') {
        window.removeEventListener('pointerdown', retry);
        this.watchdogArmed = false;
        return;
      }
      void ctx.resume().catch(() => {});
      this.playSilent();
    };
    window.addEventListener('pointerdown', retry);
  }

  /** 탭 백그라운드 시 suspend, 복귀 시 resume (배터리/CPU 절약) */
  private watchVisibility(): void {
    document.addEventListener('visibilitychange', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      if (document.visibilityState === 'hidden') void ctx.suspend().catch(() => {});
      else void ctx.resume().catch(() => {});
    });
  }
}

/** 앱 전역 싱글톤 */
export const audioMgr = new AudioMgr();
