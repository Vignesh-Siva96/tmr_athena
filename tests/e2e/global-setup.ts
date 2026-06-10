/**
 * Playwright global setup — runs before any flow.
 *
 * 1. Boot a Postgres + MinIO via Testcontainers (separate ports from integration).
 * 2. Export DATABASE_URL / MINIO_* / EMAIL_CREDS_KEY env so the webServers (api,
 *    portal, bridge) booted by Playwright pick them up.
 * 3. Run `prisma db push` to schema-sync.
 * 4. Seed a known admin / agent / customer used by every flow.
 */

import { FullConfig } from '@playwright/test'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../..')
const STATE_FILE = resolve(REPO_ROOT, '.playwright-state.json')

export default async function globalSetup(_: FullConfig): Promise<void> {
  const pg = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('tmr_e2e')
    .withUsername('e2e')
    .withPassword('e2e')
    .start()

  const minio = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'e2ekey', MINIO_ROOT_PASSWORD: 'e2esecret' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forLogMessage(/API:/))
    .start()

  const databaseUrl = `postgresql://e2e:e2e@${pg.getHost()}:${pg.getMappedPort(5432)}/tmr_e2e`
  process.env.TEST_DATABASE_URL = databaseUrl
  process.env.DATABASE_URL = databaseUrl
  process.env.MINIO_ENDPOINT = minio.getHost()
  process.env.MINIO_PORT = String(minio.getMappedPort(9000))
  process.env.MINIO_USE_SSL = 'false'
  process.env.MINIO_ACCESS_KEY = 'e2ekey'
  process.env.MINIO_SECRET_KEY = 'e2esecret'
  process.env.MINIO_BUCKET = 'attachments-e2e'

  execSync('pnpm --filter @tmr/db exec prisma db push --skip-generate --accept-data-loss', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })

  // Persist container IDs so global-teardown can stop them.
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ pgId: pg.getId(), minioId: minio.getId(), databaseUrl }),
  )

  // Seed a known admin + agent + customer for all flows to use.
  // Implementation note: this would call the API once it's up, or run a Prisma
  // script directly. Keeping it as a marker for now — the API's seed script can
  // be wrapped here.
  execSync('pnpm --filter @tmr/db exec prisma db seed', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })
}
