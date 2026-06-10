import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

// Per the framework plan: three projects — portal, bridge, cross-app — sharing one
// Testcontainers-backed Postgres + MinIO via globalSetup. Each web server is booted
// against the test DB; MSW is wired into the API process when NODE_ENV=test.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // SSE + DB state mean tests should run serially per worker
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: '../coverage/playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: '../coverage/playwright-report', open: 'never' }]],

  globalSetup: require.resolve('./e2e/global-setup'),
  globalTeardown: require.resolve('./e2e/global-teardown'),

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'portal',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3000' },
      testMatch: /e2e\/flows\/.*portal.*\.spec\.ts/,
    },
    {
      name: 'bridge',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3002' },
      testMatch: /e2e\/flows\/.*bridge.*\.spec\.ts/,
    },
    {
      name: 'cross-app',
      use: { ...devices['Desktop Chrome'] },
      // Cross-app flows (F1–F3 plus most regression flows) drive both browser contexts.
      testMatch: /e2e\/flows\/F\d+\.spec\.ts/,
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @tmr/api dev',
      cwd: ROOT,
      url: 'http://localhost:3001/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        // DATABASE_URL, MINIO_*, etc. come from globalSetup mutating process.env
        // before the webServer is spawned. We intentionally do NOT hardcode them
        // here — a hardcoded value would override the dynamic Testcontainers URL.
        EMAIL_CREDS_KEY: '0'.repeat(64),
        BETTER_AUTH_SECRET: 'test-secret-for-playwright-0123456',
        EMAIL_SYNC_LIVE_POLL: '0', // Tests drive the poller manually via /sync/poll/now
        GEMINI_API_KEY: '', // already-set env wins over .env — keeps the real key out of E2E (bot/AI disabled, bot escalates)
      },
    },
    {
      command: 'pnpm --filter @tmr/portal dev',
      cwd: ROOT,
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
      },
    },
    {
      command: 'pnpm --filter @tmr/bridge dev',
      cwd: ROOT,
      url: 'http://localhost:3002',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
      },
    },
  ],
})
