/**
 * localStorage 세이브 — crc 체크섬 + 백업 슬롯 + 버전 마이그레이션.
 * 쓰기: 백업 먼저 갱신 후 본 키 (본 키 손상 시 백업 복구).
 */
import type { SaveFile } from '@/data/types';

const KEY = 'wogawoga.save';
const KEY_BAK = 'wogawoga.save.bak';
export const CURRENT_VERSION = 1;

interface Envelope {
  v: number;
  crc: number;
  data: unknown;
}

/** FNV-1a 문자열 해시 */
export function crc(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 구버전 → 신버전 순차 마이그레이션 레지스트리. 새 버전 추가 시 여기에 등록. */
const migrations: Record<number, (old: unknown) => unknown> = {
  // 2: (v1) => ({ ...v1as, version: 2, ... })
};

function migrate(data: unknown, from: number): SaveFile | null {
  let cur = data;
  for (let v = from; v < CURRENT_VERSION; v++) {
    const step = migrations[v + 1];
    if (!step) return null;
    cur = step(cur);
  }
  return cur as SaveFile;
}

function parseEnvelope(raw: string | null): SaveFile | null {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Envelope;
    const dataStr = JSON.stringify(env.data);
    if (crc(dataStr) !== env.crc) return null;
    const file = env.data as { version?: number };
    const version = file.version ?? env.v;
    if (version === CURRENT_VERSION) return env.data as SaveFile;
    return migrate(env.data, version);
  } catch {
    return null;
  }
}

export function loadSave(): SaveFile | null {
  try {
    return parseEnvelope(localStorage.getItem(KEY)) ?? parseEnvelope(localStorage.getItem(KEY_BAK));
  } catch {
    return null;
  }
}

export function writeSave(file: SaveFile): boolean {
  try {
    const dataStr = JSON.stringify(file);
    const env: Envelope = { v: file.version, crc: crc(dataStr), data: file };
    const envStr = JSON.stringify(env);
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(KEY_BAK, prev);
    localStorage.setItem(KEY, envStr);
    return true;
  } catch {
    return false; // 쿼터 초과/프라이빗 모드 — 게임은 계속
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_BAK);
  } catch {
    /* 무시 */
  }
}

/** 디바운스 저장 헬퍼: 마지막 요청 후 1초 뒤 저장, pagehide 시 즉시 플러시 */
export class SaveScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(private getFile: () => SaveFile) {
    if (typeof window !== 'undefined') {
      const flush = (): void => this.flush();
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush();
      });
    }
  }

  request(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeSave(this.getFile());
  }
}
