/**
 * 초경량 i18n — ko 기본, en 폴백(반대 방향도 폴백).
 * 누락 키는 dev 콘솔 경고 1회 + 키 문자열 그대로 노출해 눈에 띄게 한다.
 * 파라미터는 "{name}" 자리표시자 치환.
 */
import { ko } from './strings/ko';
import { en } from './strings/en';

export type Lang = 'ko' | 'en';

const dicts: Record<Lang, Record<string, string>> = { ko, en };
let current: Lang = 'ko';
const warned = new Set<string>();

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const raw = dicts[current][key] ?? dicts.en[key] ?? dicts.ko[key];
  if (raw === undefined) {
    if (import.meta.env.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] 누락 키: ${key}`);
    }
    return key;
  }
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}
