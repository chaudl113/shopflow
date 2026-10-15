import { defineConfig } from '@playwright/test';

// Runs against the dev servers (started here if not already running) on a freshly seeded database.
// Traces, videos and failure screenshots are off on purpose to keep test-results small.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5201',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
  webServer: [
    { command: 'npm run dev:api', url: 'http://localhost:3201/api/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev:web', url: 'http://localhost:5201', reuseExistingServer: true, timeout: 60_000 },
  ],
  projects: [
    { name: 'e2e', testMatch: /flow\.spec\.ts/ },
    { name: 'screenshots', testMatch: /screenshots\.spec\.ts/ },
  ],
});
