import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
    launchOptions: {
      // 로컬 컨테이너에선 PW_CHROMIUM으로 시스템 크로미움 지정 (CI는 playwright install 사용)
      executablePath: process.env['PW_CHROMIUM'] || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
    },
  },
  projects: [
    {
      name: 'mobile-portrait',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
