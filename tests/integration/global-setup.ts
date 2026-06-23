/**
 * Global setup: runs once per `vitest run` invocation.
 *
 * Boots two Testcontainers:
 *   - Postgres 16 (Prisma migrate + pg-boss `pgboss` schema)
 *   - MinIO (attachment storage)
 *
 * Exposes connection details via env vars before any test file is imported:
 *   DATABASE_URL, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET
 *
 * Per-worker schema isolation is handled inside setup.ts via `?schema=test_w<id>`,
 * so a single Postgres container serves all Vitest workers in this run.
 */

import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

declare global {
  // eslint-disable-next-line no-var
  var __TEST_PG__: StartedPostgreSqlContainer | undefined
  // eslint-disable-next-line no-var
  var __TEST_MINIO__: StartedTestContainer | undefined
}

const REPO_ROOT = resolve(__dirname, '../..')

export async function setup(): Promise<void> {
  await bootContainers()
}

// Jest's globalSetup expects a default-exported function.
export default async function jestGlobalSetup(): Promise<void> {
  await bootContainers()
}

async function bootContainers(): Promise<void> {
  // ---------- Postgres ----------
  const pg = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('tmr_test')
    .withUsername('test')
    .withPassword('test')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw,noexec,nosuid,size=512m' })
    .start()

  globalThis.__TEST_PG__ = pg

  const baseUrl = `postgresql://test:test@${pg.getHost()}:${pg.getMappedPort(5432)}/tmr_test`
  process.env.DATABASE_URL = baseUrl

  // Enable pgvector extension before Prisma schema push (requires the extension binary).
  // The pgvector/pgvector:pg16 image ships the binary; we just need to CREATE EXTENSION.
  // Use node-postgres (pg) directly since psql may not be installed on the host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require('pg') as { Client: new (cfg: { connectionString: string }) => { connect(): Promise<void>; query(sql: string): Promise<void>; end(): Promise<void> } }
  const pgClient = new Client({ connectionString: baseUrl })
  await pgClient.connect()
  await pgClient.query('CREATE EXTENSION IF NOT EXISTS vector;')
  await pgClient.end()

  // Apply schema via `prisma db push` (not `migrate deploy`) because the project
  // has historically used `db push --accept-data-loss` for schema evolution, so
  // migration files may not reflect every column. `db push` makes the test DB
  // match the current schema.prisma exactly.
  execSync('pnpm --filter @tmr/db exec prisma db push --skip-generate --accept-data-loss', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: baseUrl },
    stdio: 'inherit',
  })

  // ---------- MinIO ----------
  const minio = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({
      MINIO_ROOT_USER: 'testkey',
      MINIO_ROOT_PASSWORD: 'testsecret',
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forLogMessage(/API:/))
    .start()

  globalThis.__TEST_MINIO__ = minio

  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
  process.env.S3_ENDPOINT = endpoint
  process.env.S3_ACCESS_KEY = 'testkey'
  process.env.S3_SECRET_KEY = 'testsecret'
  process.env.S3_BUCKET = 'attachments-test'

  // FilesService no longer auto-creates the bucket (prod uses a shared bucket
  // that must be provisioned ahead of time), so the test bucket is created here.
  const s3 = new S3Client({
    endpoint,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: { accessKeyId: 'testkey', secretAccessKey: 'testsecret' },
  })
  await s3.send(new CreateBucketCommand({ Bucket: 'attachments-test' }))
  s3.destroy()

  // ---------- Misc env that the API expects ----------
  process.env.EMAIL_CREDS_KEY = '0'.repeat(64) // 32-byte hex
  process.env.BETTER_AUTH_SECRET = 'test-jwt-secret-deterministic-0123'
  process.env.NODE_ENV = 'test'
  process.env.EMAIL_SYNC_LIVE_POLL = '0' // tests trigger polls manually
  process.env.PORTAL_URL = 'http://portal.test'
  process.env.BRIDGE_URL = 'http://bridge.test'
  process.env.OAUTH_CALLBACK_BASE = 'http://api.test'
  process.env.GEMINI_API_KEY = 'test-gemini-key' // MSW intercepts the actual call
}

export async function teardown(): Promise<void> {
  await globalThis.__TEST_PG__?.stop()
  await globalThis.__TEST_MINIO__?.stop()
}
