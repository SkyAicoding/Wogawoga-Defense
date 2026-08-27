/**
 * **빌드 표식** — 첫 화면의 `v1.0.1 · 2026-08-27 14:32 · 회사노트북` 한 줄.
 *
 * 왜 계약이 필요한가: 이 줄은 **사용자가 배포를 확인하는 유일한 수단**이다
 * ("언제 업데이트 되었는지 알 수 있게", "어디서 한건지도 표시해줘"). 조용히 깨지면
 * 사용자는 옛 배포를 새 것으로 착각한다 — 그건 화면이 거짓말을 하는 경우다.
 *
 * 특히 잠그는 것: **깨진 시각을 `Invalid Date` 로 그리지 않는다.** 정보가 없는 것과
 * 거짓 정보는 다르고, 후자가 더 나쁘다.
 */
import { describe, expect, it } from 'vitest';
import { APP_VERSION, BUILD_ORIGIN, buildStamp, formatBuildTime } from '@/game/buildinfo';

describe('빌드 표식', () => {
  it('버전이 semver 세 자리다 (배포마다 올린다)', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('빌드 기기가 사용자가 쓰는 세 자리 중 하나다', () => {
    expect(['회사노트북', '집노트북', '아이폰']).toContain(BUILD_ORIGIN);
  });

  it('시각을 **KST 고정**으로 적는다 — 보는 기기의 시간대를 안 탄다', () => {
    // 2026-08-27T05:32:00Z = KST 14:32 (UTC+9)
    expect(formatBuildTime('2026-08-27T05:32:00Z')).toBe('2026-08-27 14:32');
    // 날짜 경계 — UTC 로는 26일인데 KST 로는 27일이다
    expect(formatBuildTime('2026-08-26T15:00:00Z')).toBe('2026-08-27 00:00');
  });

  it('⚠ 깨진 값에 `Invalid Date` 를 그리지 않는다 — 시각만 빠지고 나머지는 남는다', () => {
    expect(formatBuildTime('')).toBe('');
    expect(formatBuildTime('이건 시각이 아니다')).toBe('');
    for (const bad of ['', '이건 시각이 아니다']) {
      expect(formatBuildTime(bad)).not.toMatch(/Invalid|NaN/);
    }
  });

  it('한 줄에 버전 · 시각 · 기기가 이 순서로 들어간다', () => {
    const s = buildStamp();
    expect(s).toContain(`v${APP_VERSION}`);
    expect(s).toContain(BUILD_ORIGIN);
    expect(s.indexOf(`v${APP_VERSION}`)).toBeLessThan(s.indexOf(BUILD_ORIGIN));
    // 빌드 시각이 실제로 주입됐다면(정상 빌드) 시각 조각도 있어야 한다
    const when = formatBuildTime();
    if (when) {
      expect(s).toContain(when);
      expect(s.indexOf(when)).toBeLessThan(s.indexOf(BUILD_ORIGIN));
    }
  });
});
