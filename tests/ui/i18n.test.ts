/** ko/en 키 셋 일치 — 새 기능이 한쪽 언어만 추가하고 끝나는 사고를 막는다 */
import { describe, expect, it } from 'vitest';
import { ko } from '@/ui/strings/ko';
import { en } from '@/ui/strings/en';
import { t } from '@/ui/i18n';
import { ALLY_BLOCK_CAPACITY, ALLY_DEFS, ALL_ALLY_IDS } from '@/data';

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

  it('홈타운 레벨업 문자열이 양쪽에 있다', () => {
    for (const k of [
      'battle.home.title',
      'battle.home.stats',
      'battle.home.desc',
      'battle.home.next',
      'battle.home.confirmDesc',
      'battle.home.maxed',
      'battle.lvOf',
    ]) {
      expect(ko[k], `ko.${k}`).toBeTruthy();
      expect(en[k], `en.${k}`).toBeTruthy();
    }
  });

  /**
   * 아군 설명은 **정의에 있는 키**가 실제 사전에 있어야 한다.
   * descKey는 오래 죽은 자산이었다 — ALLY_DEFS/ko/en 셋 다 값이 있는데 UI가
   * 한 번도 t()에 넘기지 않아 화면에는 이름과 가격만 떴다(5단계에서 출동 안내 패널로 연결).
   * 여기서는 **계약 쪽**(정의 → 사전)이 끊기지 않는지만 본다.
   */
  it('아군 4종의 nameKey/descKey가 양쪽 사전에 있다', () => {
    for (const id of ALL_ALLY_IDS) {
      const def = ALLY_DEFS[id];
      for (const k of [def.nameKey, def.descKey]) {
        expect(ko[k], `ko.${k}`).toBeTruthy();
        expect(en[k], `en.${k}`).toBeTruthy();
      }
    }
    // (6단계에서 '출동 안내 패널'이 마을 패널에 흡수돼 battle.ally.infoTitle은 사라졌다 —
    //  같은 정보는 마을 패널의 ally-info-row 세 줄이 그대로 띄운다)
    for (const k of ['battle.ally.title', 'battle.ally.rules']) {
      expect(ko[k], `ko.${k}`).toBeTruthy();
      expect(en[k], `en.${k}`).toBeTruthy();
    }
  });

  /**
   * 봉쇄 마릿수는 **문구에 박아 두지 않는다**. 4단계에서 규칙이 1마리 → 3마리로 바뀌었는데
   * 파수꾼 문구만 "한 놈"으로 남아 사실과 어긋난 적이 있다. 자리표시자로 두면 규칙이
   * 바뀔 때 문구가 자동으로 따라오고, 다시 숫자를 박으면 여기서 걸린다.
   */
  it('봉쇄 마릿수를 말하는 문구는 숫자를 박지 않고 {n}으로 받는다', () => {
    for (const dict of [ko, en]) {
      for (const id of ['clubber', 'guardian'] as const) {
        const s = dict[`ally.${id}.desc`] ?? '';
        expect(s, `${id} 설명에 {n} 자리표시자`).toContain('{n}');
        expect(/\b(one|two|three|1|2|3)\b|한 놈|두 놈|세 놈/.test(s), `${id} 설명에 박힌 숫자: ${s}`)
          .toBe(false);
      }
    }
    // 실제로 채워 넣으면 규칙 값이 그대로 나온다
    expect(t('ally.guardian.desc', { n: ALLY_BLOCK_CAPACITY })).toContain(String(ALLY_BLOCK_CAPACITY));
  });

  it("설정 '모든 스테이지 열기' 문자열이 양쪽에 있다", () => {
    for (const k of ['settings.unlockAll', 'settings.unlockAllDesc']) {
      expect(ko[k], `ko.${k}`).toBeTruthy();
      expect(en[k], `en.${k}`).toBeTruthy();
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
