/**
 * 오디오 랩 — ?scene=audiolab
 * 언락 버튼, 전 SFX 버튼 보드, 음악 start/stop/바이옴/강도/스팅어, 볼륨 슬라이더.
 * Playwright 자동화용 훅: window.__audiolab
 */
import type { BiomeId } from '@/data/types';
import { audio, SFX_NAMES } from '@/audio';
import type { SfxName } from '@/audio';

const BIOMES: readonly BiomeId[] = ['grassland', 'jungle', 'desert', 'snow', 'swamp', 'volcano'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, style: string, text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.setAttribute('style', style);
  if (text) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el(
    'button',
    'padding:8px 10px;border:1px solid #7a5c3e;border-radius:8px;background:#3b2a1a;' +
      'color:#f2e2c8;font-size:13px;cursor:pointer;touch-action:manipulation;',
    label,
  );
  b.addEventListener('click', onClick);
  return b;
}

function slider(
  label: string, min: number, max: number, step: number, value: number,
  onInput: (v: number) => void,
): HTMLElement {
  const wrap = el('div', 'display:flex;align-items:center;gap:8px;');
  wrap.append(el('span', 'min-width:88px;font-size:13px;', label));
  const input = el('input', 'flex:1;');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const val = el('span', 'min-width:34px;font-size:13px;text-align:right;', String(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = String(v);
    onInput(v);
  });
  wrap.append(input, val);
  return wrap;
}

function section(title: string): HTMLElement {
  const s = el(
    'section',
    'background:#2a1d10;border:1px solid #55402a;border-radius:12px;padding:12px;' +
      'display:flex;flex-direction:column;gap:10px;',
  );
  s.append(el('h2', 'margin:0;font-size:15px;color:#ffb45e;', title));
  return s;
}

export function run(): void {
  document.getElementById('game-canvas')?.remove();
  const root = el(
    'div',
    'position:fixed;inset:0;overflow-y:auto;background:#1b120a;color:#f2e2c8;' +
      'font-family:system-ui,sans-serif;padding:14px;display:flex;flex-direction:column;gap:12px;',
  );
  root.append(el('h1', 'margin:0;font-size:18px;', '🥁 오디오 랩'));

  // --- 상태 + 언락 ---------------------------------------------------------
  const status = el('div', 'font-size:13px;color:#c9b28f;', 'context: (없음)');
  const unlockSec = section('컨텍스트');
  const unlockBtn = button('🔓 언락 (사용자 제스처)', () => audio.unlock());
  unlockSec.append(unlockBtn, status);
  root.append(unlockSec);
  setInterval(() => {
    status.textContent = `unlocked: ${audio.unlocked} · music: ${audio.music.isPlaying ? '재생 중' : '정지'}`;
  }, 400);

  // --- SFX 보드 -------------------------------------------------------------
  const sfxSec = section(`SFX (${SFX_NAMES.length}개)`);
  const board = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;');
  for (const name of SFX_NAMES) {
    board.append(
      button(name, () => {
        audio.unlock();
        audio.play(name);
        console.log(`[audiolab] play ${name}`);
      }),
    );
  }
  sfxSec.append(board);
  root.append(sfxSec);

  // --- 음악 ------------------------------------------------------------------
  const musicSec = section('음악');
  const row1 = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');
  row1.append(
    button('▶ start', () => {
      audio.unlock();
      audio.music.start();
    }),
    button('⏹ stop', () => audio.music.stop()),
    button('🏆 stinger: victory', () => {
      audio.unlock();
      audio.music.playStinger('victory');
    }),
    button('💀 stinger: defeat', () => {
      audio.unlock();
      audio.music.playStinger('defeat');
    }),
  );
  const biomeRow = el('div', 'display:flex;align-items:center;gap:8px;');
  biomeRow.append(el('span', 'min-width:88px;font-size:13px;', '바이옴'));
  const biomeSel = el('select', 'flex:1;padding:6px;background:#3b2a1a;color:#f2e2c8;border-radius:8px;');
  for (const b of BIOMES) {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    biomeSel.append(opt);
  }
  biomeSel.addEventListener('change', () => audio.music.setBiome(biomeSel.value as BiomeId));
  biomeRow.append(biomeSel);
  musicSec.append(
    row1,
    biomeRow,
    slider('강도 (0~3)', 0, 3, 1, 1, (v) => audio.music.setIntensity(v)),
  );
  root.append(musicSec);

  // --- 볼륨 ------------------------------------------------------------------
  const volSec = section('볼륨');
  const muteRow = el('label', 'display:flex;align-items:center;gap:8px;font-size:13px;');
  const mute = el('input', '');
  mute.type = 'checkbox';
  mute.addEventListener('change', () => audio.setMuted(mute.checked));
  muteRow.append(mute, document.createTextNode('음소거'));
  volSec.append(
    slider('음악', 0, 1, 0.05, audio.getMusicVolume(), (v) => audio.setMusicVolume(v)),
    slider('SFX', 0, 1, 0.05, audio.getSfxVolume(), (v) => audio.setSfxVolume(v)),
    muteRow,
  );
  root.append(volSec);

  document.body.append(root);

  // Playwright 훅
  (window as unknown as Record<string, unknown>).__audiolab = {
    names: SFX_NAMES,
    play: (n: string): void => audio.play(n as SfxName),
    unlock: (): void => audio.unlock(),
    musicStart: (): void => audio.music.start(),
    musicStop: (): void => audio.music.stop(),
    stinger: (k: 'victory' | 'defeat'): void => audio.music.playStinger(k),
    unlocked: (): boolean => audio.unlocked,
  };
  console.log('[audiolab] ready');
}
