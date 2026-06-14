import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const ROOT = resolve(__dirname, '..')

// Playwright boots webServers BEFORE globalSetup runs, so the test DB cannot be
// created in globalSetup and handed over via process.env. Instead, `tests/e2e/infra.ts up`
// boots Postgres (pgvector) + MinIO FIRST and writes their connection env to
// tests/e2e/.env.e2e; this config reads that file at load time and injects it into
// the API webServer env. `pnpm test:e2e` wraps the whole lifecycle; for `--ui` runs
// start infra once via `pnpm test:e2e:infra`.
const E2E_ENV_FILE = resolve(__dirname, 'e2e/.env.e2e')
if (!existsSync(E2E_ENV_FILE)) {
  throw new Error(
    `E2E infra is not running (${E2E_ENV_FILE} missing).\n` +
    `Run \`pnpm test:e2e\` (manages infra automatically) or start it manually with ` +
    `\`pnpm test:e2e:infra\` before using \`playwright test --ui\`.`,
  )
}
const e2eEnv: Record<string, string> = Object.fromEntries(
  readFileSync(E2E_ENV_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
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
      // Never reuse a running server: a dev API on :3001 points at the dev DB (no seeded
      // test accounts, no /__test routes) and produced silent 401s on first run. Failing
      // fast on an occupied port beats silently testing the wrong stack.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        // DATABASE_URL + MINIO_* from the infra script's env file (see header comment).
        ...e2eEnv,
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
      reuseExistingServer: false, // see API entry above

      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
      },
    },
    {
      command: 'pnpm --filter @tmr/bridge dev',
      cwd: ROOT,
      url: 'http://localhost:3002',
      reuseExistingServer: false, // see API entry above

      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
      },
    },
  ],
})
