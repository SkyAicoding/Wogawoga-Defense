/**
 * E2E 스모크 — 실제 빌드에서 타이틀→로비→전투 플로우, 테스트 훅(?test=1)으로
 * 배치/웨이브 빨리감기, 콘솔 에러 0 + 드로우콜 예산(≤60) 어서션.
 */
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __wgd?: {
      sim: {
        state: {
          phase: string;
          waveIndex: number;
          gold: number;
          baseHp: number;
          hand: { towerId: string; cost: number }[];
          enemies: readonly unknown[];
          towers: readonly unknown[];
        };
        canPlaceAt(x: number, z: number): boolean;
      };
      ff(n: number): void;
      place(handIndex: number, x: number, z: number): boolean;
      callWave(): boolean;
      drawCalls(): number;
    };
  }
}

test('타이틀 → 로비 → 전투 → 웨이브 진행 (콘솔 에러 0, 드로우콜 예산)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await expect(page.getByText('탭하여 시작')).toBeVisible();

  // 타이틀 탭 → 로비
  await page.mouse.click(100, 300);
  await expect(page.getByRole('button', { name: /전투/ }).first()).toBeVisible();

  // 전투 시작
  await page.getByRole('button', { name: /전투/ }).first().click();
  await page.waitForFunction(() => window.__wgd !== undefined);

  // 슬롯에 타워 배치
  const placed = await page.evaluate(() => {
    const w = window.__wgd;
    if (!w) return false;
    for (let z = 0; z < 40; z++) {
      for (let x = 0; x < 40; x++) {
        if (w.sim.canPlaceAt(x, z)) return w.place(0, x, z);
      }
    }
    return false;
  });
  expect(placed).toBe(true);

  // 웨이브 시작 + 20초 빨리감기 → 전투가 실제로 굴러간다
  const after = await page.evaluate(() => {
    const w = window.__wgd;
    if (!w) return null;
    w.callWave();
    w.ff(600);
    return {
      wave: w.sim.state.waveIndex,
      towers: w.sim.state.towers.length,
      gold: w.sim.state.gold,
      phase: w.sim.state.phase,
    };
  });
  expect(after).not.toBeNull();
  expect(after?.towers).toBe(1);
  expect(['prep', 'wave']).toContain(after?.phase ?? '');

  // 렌더 한 프레임 이상 돈 뒤 드로우콜 예산 확인
  await page.waitForTimeout(500);
  const drawCalls = await page.evaluate(() => window.__wgd?.drawCalls() ?? -1);
  expect(drawCalls).toBeGreaterThan(0);
  expect(drawCalls).toBeLessThanOrEqual(60);

  expect(errors, `콘솔 에러: ${errors.join('\n')}`).toHaveLength(0);
});

test('저장 후 새로고침해도 진행 유지', async ({ page }) => {
  await page.goto('/?test=1', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.mouse.click(100, 300); // 로비
  // 설정 진입 → 음악 볼륨 변경 → 저장 유발
  await page.getByRole('button', { name: '설정' }).first().click();
  const slider = page.locator('input[type="range"]').first();
  await slider.fill('30'); // 0~100 스케일 → 0.3
  await page.reload({ waitUntil: 'networkidle' });
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('wogawoga.save');
    if (!raw) return null;
    const env = JSON.parse(raw) as { data: { profile: { settings: { music: number } } } };
    return env.data.profile.settings.music;
  });
  expect(saved).toBeCloseTo(0.3, 1);
});
