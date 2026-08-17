// Production-mode E2E config: runs the full suite against the PRODUCTION
// BUILD (dist/ — publishable key baked, no localhost refs, no source files)
// served on port 3100, instead of the repo root on 3000.
// Usage: PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/prod-results.json npx playwright test --config=playwright.prod.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ['json', { outputFile: 'test-results/prod-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
  ],
  webServer: {
    command: 'node scripts/serve-e2e.mjs 3100 dist',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
  },
});
