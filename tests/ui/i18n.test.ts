/** ko/en 키 셋 일치 — 새 기능이 한쪽 언어만 추가하고 끝나는 사고를 막는다 */
import { describe, expect, it } from 'vitest';
import { ko } from '@/ui/strings/ko';
import { en } from '@/ui/strings/en';

describe('i18n 문자열', () => {
  it('ko와 en의 키 셋이 완전히 일치한다', () => {
    const koKeys = Object.keys(ko).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys.filter((k) => !(k in ko)), 'ko에 없는 en 키').toEqual([]);
    expect(koKeys.filter((k) => !(k in en)), 'en에 없는 ko 키').toEqual([]);
  });

  it('빈 문자열이 없다', () => {
    for (const [k, v] of Object.entries(ko)) expect(v.length, `ko.${k}`).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(en)) expect(v.length, `en.${k}`).toBeGreaterThan(0);
  });

  it('같은 키의 {자리표시자} 집합이 서로 같다', () => {
    const holders = (s: string): string[] =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
    for (const k of Object.keys(ko)) {
      expect(holders(en[k] ?? ''), `키 ${k}의 자리표시자`).toEqual(holders(ko[k] ?? ''));
    }
  });

  it('지형지물 제거 문자열이 양쪽에 있다', () => {
    for (const k of [
      'battle.scenery.title',
      'battle.scenery.desc',
      'battle.scenery.clear',
      'battle.scenery.needGold',
    ]) {
      expect(ko[k], `ko.${k}`).toBeTruthy();
      expect(en[k], `en.${k}`).toBeTruthy();
    }
  });
});
