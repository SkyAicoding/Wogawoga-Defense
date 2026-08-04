/**
 * 레시피 기반 SFX 합성 — 외부 오디오 파일 0개.
 * 자주 쓰는 12개는 unlock 시 OfflineAudioContext로 사전 렌더 → 버퍼 재생(±5% 피치 지터).
 * 나머지는 호출 시 라이브 합성. 레시피당 100ms 내 최대 3회 스로틀.
 */
import { Rng, hashSeed } from '@/core/rng';
import type { AudioMgr } from './audiomgr';

export type SfxName =
  | 'uiTap' | 'cardSelect' | 'cardRefresh'
  | 'towerPlace' | 'towerUpgrade' | 'towerSell'
  | 'spearThrow' | 'catapultLaunch' | 'boulderImpact' | 'lightningZap'
  | 'fireWhoosh' | 'frostCast' | 'poisonSpit' | 'drumBuff'
  | 'enemyHit' | 'enemyDie' | 'bossRoar' | 'baseHit'
  | 'waveStart' | 'waveClear' | 'earlyCall'
  | 'victory' | 'defeat' | 'starUp' | 'amberGain';

type Build = (ctx: BaseAudioContext, dest: AudioNode, t0: number, rng: Rng) => void;

interface Recipe {
  /** 오프라인 렌더 길이(초) */
  dur: number;
  build: Build;
}

// ---------------------------------------------------------------------------
// 공용 신스 헬퍼 (music.ts에서도 재사용)
// ---------------------------------------------------------------------------

/** 어택(linear)-감쇠(exp) 엔벨로프 게인. 소스는 반환 노드에 연결한다 */
export function env(
  ctx: BaseAudioContext, dest: AudioNode, t0: number, peak: number, a: number, d: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + a + d);
  g.connect(dest);
  return g;
}

/** 주파수 지수 스윕 (f1 생략 시 고정음) */
export function sweep(p: AudioParam, t0: number, f0: number, f1: number, dur: number): void {
  p.setValueAtTime(f0, t0);
  p.exponentialRampToValueAtTime(Math.max(0.01, f1), t0 + dur);
}

export function tone(
  ctx: BaseAudioContext, dest: AudioNode, type: OscillatorType,
  f0: number, t0: number, dur: number, f1?: number,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  if (f1 !== undefined) sweep(o.frequency, t0, f0, f1, dur);
  else o.frequency.setValueAtTime(f0, t0);
  o.connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
  return o;
}

export function filt(
  ctx: BaseAudioContext, dest: AudioNode, type: BiquadFilterType, freq: number, q = 1,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

/** 노이즈 원샷 (brown = 백색 적분 → 저역 우세) */
export function noiseSrc(
  ctx: BaseAudioContext, dest: AudioNode, t0: number, dur: number, rng: Rng, brown = false,
): AudioBufferSourceNode {
  const n = Math.max(64, Math.ceil(dur * ctx.sampleRate));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    } else data[i] = w;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(dest);
  src.start(t0);
  return src;
}

/** tanh 소프트클립 커브 (디스토션) */
function distCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 256;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1));
  return c;
}

/** ±3% 주파수 지터 (라이브 합성 변주용) */
function j(rng: Rng): number {
  return 1 + rng.range(-0.03, 0.03);
}

// ---------------------------------------------------------------------------
// 레시피 정의 — 주석에 의도한 음색을 명시한다
// ---------------------------------------------------------------------------

const RECIPES: Record<SfxName, Recipe> = {
  // 짧은 삼각파 블립 880→660Hz — 가벼운 나무 탭
  uiTap: {
    dur: 0.1,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.25, 0.005, 0.07), 'triangle', 880 * j(rng), t0, 0.08, 660);
    },
  },
  // 나무 틱 2연타 (720 → 1080Hz) — 카드 집는 딸깍
  cardSelect: {
    dur: 0.22,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.3, 0.004, 0.07), 'triangle', 720 * j(rng), t0, 0.06);
      tone(ctx, env(ctx, dest, t0 + 0.07, 0.3, 0.004, 0.1), 'triangle', 1080, t0 + 0.07, 0.09);
    },
  },
  // 밴드패스 노이즈 상승 스윕 500→2600Hz — 카드 섞는 휙
  cardRefresh: {
    dur: 0.3,
    build(ctx, dest, t0, rng) {
      const f = filt(ctx, env(ctx, dest, t0, 0.35, 0.02, 0.23), 'bandpass', 500, 2);
      sweep(f.frequency, t0, 500, 2600, 0.22);
      noiseSrc(ctx, f, t0, 0.26, rng);
    },
  },
  // 저역 쿵(150→55Hz) + 나무 틱 — 말뚝 박는 소리
  towerPlace: {
    dur: 0.34,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.7, 0.005, 0.28), 'sine', 150 * j(rng), t0, 0.25, 55);
      tone(ctx, env(ctx, dest, t0 + 0.02, 0.25, 0.003, 0.06), 'triangle', 1300, t0 + 0.02, 0.05, 900);
    },
  },
  // 펜타토닉 3음 상행 마림바 (440/528/660Hz)
  towerUpgrade: {
    dur: 0.55,
    build(ctx, dest, t0, rng) {
      [440, 528, 660].forEach((f, i) => {
        const t = t0 + i * 0.11;
        tone(ctx, env(ctx, dest, t, 0.3, 0.005, 0.32), 'triangle', f * j(rng), t, 0.34);
      });
    },
  },
  // 하행 2음 (784→523Hz) + 고역 셰이커 틱 — 되팔기
  towerSell: {
    dur: 0.4,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.3, 0.004, 0.12), 'triangle', 784, t0, 0.11);
      tone(ctx, env(ctx, dest, t0 + 0.1, 0.3, 0.004, 0.22), 'triangle', 523, t0 + 0.1, 0.2);
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0, 0.12, 0.003, 0.05), 'highpass', 6000), t0, 0.05, rng);
    },
  },
  // 밴드패스 노이즈 700→2600Hz 빠른 스윕 — 창 바람가르기
  spearThrow: {
    dur: 0.22,
    build(ctx, dest, t0, rng) {
      const f = filt(ctx, env(ctx, dest, t0, 0.4, 0.01, 0.17), 'bandpass', 700, 1.5);
      sweep(f.frequency, t0, 700 * j(rng), 2600, 0.15);
      noiseSrc(ctx, f, t0, 0.19, rng);
    },
  },
  // 삐걱(saw 95→70) + 텅(sine 110→55) + 휙(노이즈) — 투석기 발사
  catapultLaunch: {
    dur: 0.45,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.22, 0.01, 0.13), 'sawtooth', 95 * j(rng), t0, 0.12, 70);
      tone(ctx, env(ctx, dest, t0 + 0.05, 0.6, 0.005, 0.22), 'sine', 110, t0 + 0.05, 0.2, 55);
      const f = filt(ctx, env(ctx, dest, t0 + 0.08, 0.3, 0.02, 0.27), 'bandpass', 400, 1.2);
      sweep(f.frequency, t0 + 0.08, 400, 1800, 0.25);
      noiseSrc(ctx, f, t0 + 0.08, 0.3, rng);
    },
  },
  // 60Hz대 사인 드랍(90→42Hz) + 브라운 노이즈 — 바위 착탄 (스펙 지정)
  boulderImpact: {
    dur: 0.55,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 1.0, 0.004, 0.45), 'sine', 90 * j(rng), t0, 0.4, 42);
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0, 0.5, 0.004, 0.3), 'lowpass', 260), t0, 0.3, rng, true);
    },
  },
  // 소우투스 1500→160Hz 급강하 + 화이트노이즈 크래클 2발 (스펙 지정)
  lightningZap: {
    dur: 0.42,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.45, 0.002, 0.28), 'sawtooth', 1500 * j(rng), t0, 0.25, 160);
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0, 0.3, 0.002, 0.12), 'highpass', 2500), t0, 0.12, rng);
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0 + 0.04, 0.2, 0.002, 0.1), 'highpass', 3200), t0 + 0.04, 0.1, rng);
    },
  },
  // 브라운 노이즈 밴드패스 250→1400Hz 느린 스윕 — 화염 분사
  fireWhoosh: {
    dur: 0.55,
    build(ctx, dest, t0, rng) {
      const f = filt(ctx, env(ctx, dest, t0, 0.55, 0.08, 0.42), 'bandpass', 250, 0.8);
      sweep(f.frequency, t0, 250 * j(rng), 1400, 0.4);
      noiseSrc(ctx, f, t0, 0.5, rng, true);
    },
  },
  // 고역 벨: 사인 파셜 2개(1568 + 2349Hz) 긴 감쇠 + 반짝임 노이즈
  frostCast: {
    dur: 0.72,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.3, 0.005, 0.6), 'sine', 1568 * j(rng), t0, 0.62);
      tone(ctx, env(ctx, dest, t0, 0.18, 0.005, 0.5), 'sine', 2349, t0, 0.52);
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0 + 0.02, 0.1, 0.01, 0.3), 'highpass', 6000), t0 + 0.02, 0.3, rng);
    },
  },
  // 꾸룩 하강 블립 2개 + 젖은 저역 노이즈 — 독 뱉기
  poisonSpit: {
    dur: 0.38,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.4, 0.01, 0.24), 'sine', 300 * j(rng), t0, 0.22, 130);
      tone(ctx, env(ctx, dest, t0 + 0.06, 0.3, 0.01, 0.15), 'sine', 240, t0 + 0.06, 0.13, 110);
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0, 0.25, 0.01, 0.2), 'lowpass', 500), t0, 0.22, rng, true);
    },
  },
  // 팀파니: 사인 115→78Hz 중간 감쇠 + 저역 노이즈 타격감 (스펙 지정)
  drumBuff: {
    dur: 0.6,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.8, 0.005, 0.5), 'sine', 115 * j(rng), t0, 0.45, 78);
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0, 0.3, 0.002, 0.06), 'lowpass', 900), t0, 0.07, rng);
    },
  },
  // 아주 짧은 삼각파 톡 (520→400Hz, 60ms)
  enemyHit: {
    dur: 0.09,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.22, 0.003, 0.06), 'triangle', 520 * j(rng), t0, 0.06, 400);
    },
  },
  // 사각파 하강 470→130Hz — 픽 쓰러지는 톤
  enemyDie: {
    dur: 0.34,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.3, 0.005, 0.27), 'square', 470 * j(rng), t0, 0.26, 130);
    },
  },
  // 저역 FM(캐리어 75→55Hz, 모듈레이터 28Hz) + tanh 디스토션 + 그르렁 노이즈 (스펙 지정)
  bossRoar: {
    dur: 1.35,
    build(ctx, dest, t0, rng) {
      const lp = filt(ctx, env(ctx, dest, t0, 0.85, 0.06, 1.1), 'lowpass', 480);
      const ws = ctx.createWaveShaper();
      ws.curve = distCurve(4);
      ws.connect(lp);
      const car = tone(ctx, ws, 'sine', 75 * j(rng), t0, 1.15, 55);
      const mod = ctx.createOscillator();
      mod.frequency.value = 28;
      const mg = ctx.createGain();
      mg.gain.value = 45;
      mod.connect(mg).connect(car.frequency);
      mod.start(t0);
      mod.stop(t0 + 1.2);
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0, 0.35, 0.1, 0.9), 'lowpass', 300), t0, 1.0, rng, true);
    },
  },
  // 둔탁한 쿵(120→50Hz) + 경보 2연 비프(740Hz) — 기지 피격
  baseHit: {
    dur: 0.7,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.8, 0.005, 0.35), 'sine', 120 * j(rng), t0, 0.3, 50);
      for (const dt of [0.18, 0.42]) {
        const lp = filt(ctx, env(ctx, dest, t0 + dt, 0.18, 0.01, 0.14), 'lowpass', 2200);
        tone(ctx, lp, 'square', 740, t0 + dt, 0.12);
      }
    },
  },
  // 뿔피리: 디튠 소우투스 2개 196Hz + 비브라토 + 로우패스 — 웨이브 시작 팡파르
  waveStart: {
    dur: 1.0,
    build(ctx, dest, t0, rng) {
      const lp = filt(ctx, env(ctx, dest, t0, 0.45, 0.1, 0.75), 'lowpass', 950);
      const o1 = tone(ctx, lp, 'sawtooth', 196 * j(rng), t0, 0.85);
      const o2 = tone(ctx, lp, 'sawtooth', 197.6, t0, 0.85);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = 5;
      lfo.connect(lg);
      lg.connect(o1.frequency);
      lg.connect(o2.frequency);
      lfo.start(t0);
      lfo.stop(t0 + 0.9);
    },
  },
  // 상승 3음 마림바 C5/E5/G5 — 웨이브 클리어
  waveClear: {
    dur: 0.75,
    build(ctx, dest, t0, rng) {
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const t = t0 + i * 0.12;
        tone(ctx, env(ctx, dest, t, 0.32, 0.005, 0.42), 'triangle', f * j(rng), t, 0.44);
      });
    },
  },
  // 짧은 뿔 2연 블립 상행 (330→415Hz) — 조기 호출 보너스
  earlyCall: {
    dur: 0.48,
    build(ctx, dest, t0, rng) {
      const lp = filt(ctx, dest, 'lowpass', 1200);
      tone(ctx, env(ctx, lp, t0, 0.35, 0.02, 0.12), 'sawtooth', 330 * j(rng), t0, 0.1);
      tone(ctx, env(ctx, lp, t0 + 0.13, 0.35, 0.02, 0.24), 'sawtooth', 415, t0 + 0.13, 0.22);
    },
  },
  // 팡파레 4음 상행 G4/C5/E5/G5, 마지막 음은 화음으로 길게 — 승리 (스펙 지정)
  victory: {
    dur: 1.9,
    build(ctx, dest, t0, rng) {
      const lp = filt(ctx, dest, 'lowpass', 2200);
      const notes: [number, number, number][] = [
        [392, 0, 0.22], [523.25, 0.18, 0.22], [659.25, 0.36, 0.22], [783.99, 0.58, 1.1],
      ];
      for (const [f, dt, d] of notes) {
        tone(ctx, env(ctx, lp, t0 + dt, 0.32, 0.01, d), 'sawtooth', f * j(rng), t0 + dt, d + 0.02);
      }
      // 마지막 음에 3화음 보강
      tone(ctx, env(ctx, lp, t0 + 0.58, 0.16, 0.01, 1.1), 'sawtooth', 523.25, t0 + 0.58, 1.12);
      tone(ctx, env(ctx, lp, t0 + 0.58, 0.16, 0.01, 1.1), 'sawtooth', 659.25, t0 + 0.58, 1.12);
    },
  },
  // 하강 단조 4음 A4→F4→D4→A3 + 저역 드론 — 패배 (스펙 지정)
  defeat: {
    dur: 2.0,
    build(ctx, dest, t0, rng) {
      const notes: [number, number, number][] = [
        [440, 0, 0.35], [349.23, 0.3, 0.35], [293.66, 0.6, 0.4], [220, 0.95, 0.9],
      ];
      for (const [f, dt, d] of notes) {
        tone(ctx, env(ctx, dest, t0 + dt, 0.3, 0.02, d), 'triangle', f * j(rng), t0 + dt, d + 0.02);
      }
      tone(ctx, env(ctx, dest, t0, 0.2, 0.3, 1.5), 'sine', 110, t0, 1.8);
    },
  },
  // 고역 펜타 아르페지오 4음 급상행 + 고역 노이즈 반짝임 — 별 획득
  starUp: {
    dur: 0.75,
    build(ctx, dest, t0, rng) {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
        const t = t0 + i * 0.07;
        tone(ctx, env(ctx, dest, t, 0.25, 0.004, 0.32), 'sine', f * j(rng), t, 0.34);
      });
      noiseSrc(ctx, filt(ctx, env(ctx, dest, t0 + 0.1, 0.08, 0.02, 0.4), 'highpass', 7000), t0 + 0.1, 0.4, rng);
    },
  },
  // 따뜻한 코인 2음 (988→1319Hz) — 호박 획득
  amberGain: {
    dur: 0.3,
    build(ctx, dest, t0, rng) {
      tone(ctx, env(ctx, dest, t0, 0.28, 0.004, 0.11), 'sine', 988 * j(rng), t0, 0.1);
      tone(ctx, env(ctx, dest, t0 + 0.07, 0.28, 0.004, 0.2), 'sine', 1319, t0 + 0.07, 0.18);
    },
  },
};

export const SFX_NAMES = Object.keys(RECIPES) as readonly SfxName[];

/** 전투 중 고빈도 재생 → unlock 시 사전 렌더할 12개 */
const PRERENDER: readonly SfxName[] = [
  'uiTap', 'cardSelect', 'towerPlace', 'spearThrow', 'catapultLaunch', 'boulderImpact',
  'lightningZap', 'fireWhoosh', 'frostCast', 'poisonSpit', 'enemyHit', 'enemyDie',
];

const THROTTLE_WINDOW_MS = 100;
const THROTTLE_MAX = 3;

export class Sfx {
  private buffers = new Map<SfxName, AudioBuffer>();
  private stamps = new Map<SfxName, number[]>();
  // 장식용 지터 — 게임 로직 난수 아님 (결정론 무관)
  private rng = new Rng(hashSeed('sfx-live') ^ (Date.now() & 0xffff));

  constructor(private mgr: AudioMgr) {}

  /** unlock 직후 호출: 고빈도 레시피를 오프라인 렌더해 캐시 */
  prewarm(): void {
    const ctx = this.mgr.context;
    if (!ctx || typeof OfflineAudioContext === 'undefined') return;
    for (const name of PRERENDER) void this.renderOne(name, ctx.sampleRate);
  }

  private async renderOne(name: SfxName, sampleRate: number): Promise<void> {
    if (this.buffers.has(name)) return;
    const recipe = RECIPES[name];
    try {
      const off = new OfflineAudioContext(1, Math.ceil(recipe.dur * sampleRate) + 64, sampleRate);
      // 렌더는 고정 시드 → 항상 같은 버퍼, 변주는 재생 시 피치 지터로
      recipe.build(off, off.destination, 0, new Rng(hashSeed(name)));
      this.buffers.set(name, await off.startRendering());
    } catch {
      /* 오프라인 미지원 → 라이브 합성으로 폴백 */
    }
  }

  /** 단일 진입점. 컨텍스트 없으면 no-op */
  play(name: SfxName): void {
    const ctx = this.mgr.context;
    const bus = this.mgr.sfx;
    if (!ctx || !bus) return;
    if (!this.allow(name)) return;
    const t0 = ctx.currentTime;
    const buf = this.buffers.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 + this.rng.range(-0.05, 0.05);
      src.connect(bus);
      src.start(t0);
    } else {
      RECIPES[name].build(ctx, bus, t0, this.rng);
    }
  }

  /** 레시피당 100ms 윈도 내 최대 3회 */
  private allow(name: SfxName): boolean {
    const now = performance.now();
    const recent = (this.stamps.get(name) ?? []).filter((t) => now - t < THROTTLE_WINDOW_MS);
    if (recent.length >= THROTTLE_MAX) {
      this.stamps.set(name, recent);
      return false;
    }
    recent.push(now);
    this.stamps.set(name, recent);
    return true;
  }
}
