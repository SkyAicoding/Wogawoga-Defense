/**
 * 프로시저럴 음악 — 룩어헤드 스텝 시퀀서 (setInterval 25ms, 120ms 선행 스케줄).
 * 신스 드럼킷(kick/tom/shaker/woodblock) + 마림바풍 펜타토닉 멜로디 + 저역 드론.
 * 16스텝 패턴을 시드로 생성, 4마디마다 변주. 패턴은 (바이옴, 프레이즈) 시드로 결정론적.
 */
import { Rng, hashSeed } from '@/core/rng';
import type { BiomeId } from '@/data/types';
import type { AudioMgr } from './audiomgr';
import { env, filt, tone } from './sfx';

const LOOKAHEAD = 0.12;
const TIMER_MS = 25;
/** 단조 펜타토닉 (반음 오프셋) */
const PENTA: readonly number[] = [0, 3, 5, 7, 10];

interface BiomeParams {
  /** 스케일 루트 (드론은 1옥타브 아래, 멜로디는 1~2옥타브 위) */
  root: number;
  bpm: number;
  /** 멜로디 로우패스 컷오프 — 바이옴 음색 차이 */
  cutoff: number;
}

const BIOMES: Record<BiomeId, BiomeParams> = {
  grassland: { root: 110.0, bpm: 96, cutoff: 1800 },
  jungle: { root: 130.81, bpm: 106, cutoff: 2200 },
  desert: { root: 98.0, bpm: 88, cutoff: 1500 },
  snow: { root: 82.41, bpm: 78, cutoff: 2600 },
  swamp: { root: 87.31, bpm: 84, cutoff: 1200 },
  volcano: { root: 116.54, bpm: 112, cutoff: 2000 },
};

interface MelodyNote {
  deg: number;
  oct: number;
  /** 재생 최소 강도 */
  lv: number;
}

interface Patterns {
  // 각 배열 값 = 해당 스텝이 재생되는 최소 강도 (9 = 사용 안 함)
  kick: number[];
  shaker: number[];
  wood: number[];
  tom: number[];
  melody: (MelodyNote | null)[];
}

export type StingerKind = 'victory' | 'defeat';

export class Music {
  private biome: BiomeId = 'grassland';
  private intensity = 1;
  private playing = false;
  private wantStart = false;
  private timer: number | null = null;
  private stepIdx = 0;
  private nextTime = 0;
  /** 페이드 인/아웃용 내부 출력 (musicBus 앞단) */
  private out: GainNode | null = null;
  private droneOsc: OscillatorNode[] = [];
  private pat: Patterns | null = null;
  private noiseBuf: AudioBuffer | null = null;
  // 장식용 지터 — 게임 로직 난수 아님
  private liveRng = new Rng(hashSeed('music-live') ^ (Date.now() & 0xffff));

  constructor(private mgr: AudioMgr) {
    mgr.onUnlock(() => {
      if (this.wantStart) this.begin();
    });
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** unlock 전에 불려도 안전 — 언락되는 순간 시작 */
  start(): void {
    this.wantStart = true;
    if (!this.playing && this.mgr.context) this.begin();
  }

  stop(): void {
    this.wantStart = false;
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const ctx = this.mgr.context;
    const out = this.out;
    this.out = null;
    const drones = this.droneOsc;
    this.droneOsc = [];
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + 0.4);
    for (const o of drones) {
      try {
        o.stop(t + 0.5);
      } catch {
        /* 이미 정지 */
      }
    }
    setTimeout(() => out.disconnect(), 600);
  }

  setBiome(biome: BiomeId): void {
    if (this.biome === biome) return;
    this.biome = biome;
    this.pat = null; // 다음 프레이즈 경계 전이라도 즉시 새 패턴
    const ctx = this.mgr.context;
    if (ctx && this.droneOsc.length > 0) {
      const t = ctx.currentTime;
      const base = this.params().root * 0.5;
      this.droneOsc.forEach((o, i) => {
        const f = base * (i === 0 ? 1 : 1.008);
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(o.frequency.value, t);
        o.frequency.linearRampToValueAtTime(f, t + 1.0);
      });
    }
  }

  /** 0 드론+셰이커 → 3 풀 드럼+멜로디+빠른 템포 */
  setIntensity(n: number): void {
    this.intensity = Math.max(0, Math.min(3, Math.round(n)));
  }

  /** 음악 정지 후 3초 스팅어 연주 (musicBus 직결 — 페이드 영향 없음) */
  playStinger(kind: StingerKind): void {
    const ctx = this.mgr.context;
    const bus = this.mgr.music;
    if (!ctx || !bus) return;
    this.stop();
    const t0 = ctx.currentTime + 0.08;
    const root = this.params().root * 2;
    const seq: [semi: number, dt: number, dur: number][] =
      kind === 'victory'
        ? [[0, 0, 0.3], [5, 0.22, 0.3], [7, 0.44, 0.3], [12, 0.8, 1.6]]
        : [[12, 0, 0.45], [7, 0.45, 0.45], [3, 0.95, 0.5], [0, 1.5, 1.3]];
    for (const [semi, dt, dur] of seq) {
      this.note(t0 + dt, root * 2 ** (semi / 12), dur, bus, 0.32, 2200);
    }
    if (kind === 'victory') {
      // 마지막 화음 보강 + 밝은 드론 스웰
      this.note(t0 + 0.8, root * 2 ** (7 / 12), 1.6, bus, 0.16, 2200);
      tone(ctx, env(ctx, bus, t0, 0.12, 0.5, 2.2), 'sawtooth', root * 0.5, t0, 2.6);
    } else {
      // 저역 스웰 + 마지막 둔탁한 쿵
      tone(ctx, env(ctx, bus, t0, 0.18, 0.6, 2.0), 'sine', root * 0.25, t0, 2.6);
      tone(ctx, env(ctx, bus, t0 + 1.5, 0.5, 0.005, 0.5), 'sine', 90, t0 + 1.5, 0.45, 45);
    }
  }

  // -------------------------------------------------------------------------

  private params(): BiomeParams {
    return BIOMES[this.biome];
  }

  private stepDur(): number {
    const bpm = this.params().bpm * (1 + 0.05 * this.intensity);
    return 60 / bpm / 4; // 16분음표
  }

  private begin(): void {
    const ctx = this.mgr.context;
    const bus = this.mgr.music;
    if (!ctx || !bus || this.playing) return;
    this.playing = true;
    this.stepIdx = 0;
    this.pat = null;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0, ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
    this.out.connect(bus);
    this.startDrone(ctx, this.out);
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(this.tickScheduler, TIMER_MS);
  }

  /** 저역 오실레이터 2개 디튠 드론 */
  private startDrone(ctx: AudioContext, out: GainNode): void {
    const g = ctx.createGain();
    g.gain.value = 0.1;
    const lp = filt(ctx, g, 'lowpass', 240);
    g.connect(out);
    const base = this.params().root * 0.5;
    for (const mul of [1, 1.008]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = base * mul;
      o.connect(lp);
      o.start();
      this.droneOsc.push(o);
    }
  }

  private tickScheduler = (): void => {
    const ctx = this.mgr.context;
    if (!ctx || !this.out) return;
    const now = ctx.currentTime;
    // suspend 복귀 등으로 뒤처지면 드리프트 복구
    if (this.nextTime < now - 0.05) this.nextTime = now + 0.02;
    while (this.nextTime < now + LOOKAHEAD) {
      this.scheduleStep(this.nextTime);
      this.nextTime += this.stepDur();
      this.stepIdx++;
    }
  };

  private scheduleStep(t: number): void {
    const out = this.out;
    if (!out) return;
    const s = this.stepIdx & 15;
    const bar = this.stepIdx >> 4;
    if (this.pat === null || (s === 0 && bar % 4 === 0)) this.regen(bar >> 2);
    const p = this.pat;
    if (!p) return;
    const inten = this.intensity;
    const { root, cutoff } = this.params();
    if ((p.kick[s] ?? 9) <= inten) this.kick(t, out);
    if ((p.shaker[s] ?? 9) <= inten) this.shaker(t, out, s % 4 === 0 ? 1 : 0.65);
    if ((p.wood[s] ?? 9) <= inten) this.wood(t, out);
    if (bar % 4 === 3 && (p.tom[s] ?? 9) <= inten) this.tom(t, out, root * (s >= 14 ? 1.5 : 2));
    const m = p.melody[s] ?? null;
    if (m && m.lv <= inten) {
      const freq = root * 2 ** ((PENTA[m.deg] ?? 0) / 12 + 1 + m.oct);
      this.note(t, freq, this.stepDur() * 2.2, out, 0.26, cutoff);
    }
  }

  /** (바이옴, 프레이즈) 시드 결정론 패턴 — 4마디마다 변주 */
  private regen(phrase: number): void {
    const rng = new Rng(hashSeed(`${this.biome}:${phrase}`));
    const kick = new Array<number>(16).fill(9);
    kick[0] = 1;
    kick[8] = 1;
    kick[12] = 2;
    if (rng.chance(0.5)) kick[4] = 2;
    if (rng.chance(0.5)) kick[10] = 3;
    const shaker = Array.from({ length: 16 }, (_, s) =>
      s % 2 === 0 ? 0 : rng.chance(0.5) ? 3 : 9,
    );
    const wood = new Array<number>(16).fill(9);
    wood[rng.int(2, 6)] = 1;
    wood[rng.int(9, 14)] = 2;
    const tom = new Array<number>(16).fill(9);
    for (let s = 12; s < 16; s++) if (rng.chance(0.6)) tom[s] = 2;
    if (rng.chance(0.4)) tom[6] = 3;
    let deg = rng.int(0, 4);
    const melody = Array.from({ length: 16 }, (_, s): MelodyNote | null => {
      if (s % 2 === 1) {
        if (!rng.chance(0.2)) return null;
        return { deg, oct: 0, lv: 3 }; // 오프비트는 풀 강도에서만
      }
      if (!rng.chance(0.6)) return null;
      const note = { deg, oct: rng.chance(0.25) ? 1 : 0, lv: rng.chance(0.35) ? 3 : 2 };
      deg = (deg + rng.int(-2, 2) + 5) % 5;
      return note;
    });
    this.pat = { kick, shaker, wood, tom, melody };
  }

  // --- 악기 ---------------------------------------------------------------

  /** 킥: 사인 피치 드랍 120→45Hz */
  private kick(t: number, out: AudioNode): void {
    const ctx = this.mgr.context;
    if (!ctx) return;
    tone(ctx, env(ctx, out, t, 0.85, 0.003, 0.16), 'sine', 120, t, 0.12, 45);
  }

  /** 탐: 삼각파 피치 드랍 + 노이즈 타격 */
  private tom(t: number, out: AudioNode, f: number): void {
    const ctx = this.mgr.context;
    if (!ctx) return;
    tone(ctx, env(ctx, out, t, 0.5, 0.004, 0.22), 'triangle', f, t, 0.2, f * 0.6);
    this.noiseHit(ctx, out, t, 0.05, 0.12, 1200, 'lowpass');
  }

  /** 셰이커: 하이패스 노이즈 짧은 감쇠 */
  private shaker(t: number, out: AudioNode, vel: number): void {
    const ctx = this.mgr.context;
    if (!ctx) return;
    this.noiseHit(ctx, out, t, 0.06, 0.13 * vel, 5500, 'highpass');
  }

  /** 우드블록: 삼각파 짧은 톡 */
  private wood(t: number, out: AudioNode): void {
    const ctx = this.mgr.context;
    if (!ctx) return;
    tone(ctx, env(ctx, out, t, 0.3, 0.003, 0.07), 'triangle', 1100, t, 0.06, 800);
  }

  /** 마림바풍 멜로디: 삼각파+옥타브 배음, 로우패스 */
  private note(t: number, freq: number, dur: number, dest: AudioNode, vol: number, cutoff: number): void {
    const ctx = this.mgr.context;
    if (!ctx) return;
    const lp = filt(ctx, env(ctx, dest, t, vol, 0.005, dur), 'lowpass', cutoff);
    tone(ctx, lp, 'triangle', freq, t, dur + 0.05);
    tone(ctx, env(ctx, dest, t, vol * 0.22, 0.005, dur * 0.6), 'sine', freq * 2, t, dur * 0.6 + 0.05);
  }

  /** 캐시된 노이즈 버퍼로 짧은 타격 노이즈 재생 */
  private noiseHit(
    ctx: AudioContext, dest: AudioNode, t: number, dur: number, peak: number,
    freq: number, type: BiquadFilterType,
  ): void {
    if (!this.noiseBuf) {
      const n = Math.ceil(ctx.sampleRate * 0.5);
      this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = this.liveRng.next() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = 0.5;
    src.connect(filt(ctx, env(ctx, dest, t, peak, 0.004, dur), type, freq));
    src.start(t, this.liveRng.range(0, 0.4));
    src.stop(t + dur + 0.05);
  }
}
