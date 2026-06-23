/**
 * E2E infrastructure lifecycle — `tsx tests/e2e/infra.ts up | down`.
 *
 * Why this exists: Playwright starts `webServer` processes BEFORE globalSetup runs
 * (createGlobalSetupTasks: plugin setup precedes globalSetups — verified in the
 * 1.60 runner source). So the test DB cannot be created inside globalSetup and
 * passed to the API via process.env: the API has already booted and fallen back
 * to .env (the dev database) by then. Infra must exist before `playwright test`.
 *
 * `up`:   boot pgvector Postgres + MinIO (Testcontainers, Ryuk disabled so the
 *         containers outlive this short process), enable the vector extension,
 *         `prisma db push`, seed, and write the connection env to
 *         tests/e2e/.env.e2e — which playwright.config.ts reads at load time.
 *         Idempotent: if infra from a previous `up` is still healthy, reuse it
 *         (fast `--ui` iteration); the seed is upsert-based and safe to re-run.
 * `down`: remove the containers and the env/state files.
 */

// Containers must outlive this process — we manage cleanup in `down` ourselves.
process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true'

import { GenericContainer, Wait } from 'testcontainers'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import { execSync } from 'node:child_process'
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../..')
const ENV_FILE = resolve(__dirname, '.env.e2e')
const STATE_FILE = resolve(REPO_ROOT, '.playwright-state.json')

function readState(): { pgId: string; minioId: string } | null {
  if (!existsSync(STATE_FILE)) return null
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { pgId: string; minioId: string }
  } catch {
    return null
  }
}

function containerRunning(id: string): boolean {
  try {
    return execSync(`docker inspect -f '{{.State.Running}}' ${id}`, { stdio: 'pipe' }).toString().trim() === 'true'
  } catch {
    return false
  }
}

async function up(): Promise<void> {
  const prev = readState()
  if (prev && containerRunning(prev.pgId) && containerRunning(prev.minioId) && existsSync(ENV_FILE)) {
    console.log('E2E infra already running — reusing (run `infra.ts down` for a fresh stack).')
    return
  }
  // Stale state from a crashed run — clear it before booting fresh.
  if (prev) await down()

  const pg = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('tmr_e2e')
    .withUsername('e2e')
    .withPassword('e2e')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw,noexec,nosuid,size=512m' })
    .start()

  const minio = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'e2ekey', MINIO_ROOT_PASSWORD: 'e2esecret' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forLogMessage(/API:/))
    .start()

  const databaseUrl = `postgresql://e2e:e2e@${pg.getHost()}:${pg.getMappedPort(5432)}/tmr_e2e`

  // Enable pgvector before the schema push (image ships the binary; `pg` npm
  // package isn't resolvable from the repo root, so use psql in the container).
  const ext = await pg.exec(['psql', '-U', 'e2e', '-d', 'tmr_e2e', '-c', 'CREATE EXTENSION IF NOT EXISTS vector;'])
  if (ext.exitCode !== 0) throw new Error(`CREATE EXTENSION vector failed: ${ext.output}`)

  execSync('pnpm --filter @tmr/db exec prisma db push --skip-generate --accept-data-loss', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })
  execSync('pnpm --filter @tmr/db exec prisma db seed', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })

  // Mark the mailbox as "connected" — Bridge's inbox renders an EmailNotConfiguredGate
  // (and hides the conversation list) unless GET /config reports oauthConnected, which
  // is derived from both token fields being set. Dummy values are safe: in test mode
  // EmailService short-circuits to MailCaptureService before touching OAuth tokens,
  // and the live poller is disabled.
  const markConnected = await pg.exec(['psql', '-U', 'e2e', '-d', 'tmr_e2e', '-c',
    `UPDATE "AppConfig" SET "oauthProvider"='GOOGLE', "oauthEmail"='support@e2e.test', "oauthAccessTokenEnc"='e2e-dummy', "oauthRefreshTokenEnc"='e2e-dummy';`])
  if (markConnected.exitCode !== 0) throw new Error(`AppConfig oauth update failed: ${markConnected.output}`)

  // FilesService no longer auto-creates the bucket (prod uses a shared bucket
  // provisioned ahead of time), so create the e2e bucket explicitly.
  const s3Endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
  const s3 = new S3Client({
    endpoint: s3Endpoint,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: { accessKeyId: 'e2ekey', secretAccessKey: 'e2esecret' },
  })
  await s3.send(new CreateBucketCommand({ Bucket: 'attachments-e2e' }))
  s3.destroy()

  const envLines = [
    `DATABASE_URL=${databaseUrl}`,
    `S3_ENDPOINT=${s3Endpoint}`,
    `S3_ACCESS_KEY=e2ekey`,
    `S3_SECRET_KEY=e2esecret`,
    `S3_BUCKET=attachments-e2e`,
  ]
  writeFileSync(ENV_FILE, envLines.join('\n') + '\n')
  writeFileSync(STATE_FILE, JSON.stringify({ pgId: pg.getId(), minioId: minio.getId(), databaseUrl }))
  console.log(`E2E infra up — DB ${databaseUrl}`)
}

async function down(): Promise<void> {
  const state = readState()
  if (state) {
    for (const id of [state.pgId, state.minioId]) {
      try { execSync(`docker rm -f ${id}`, { stdio: 'ignore' }) } catch { /* already gone */ }
    }
  }
  rmSync(STATE_FILE, { force: true })
  rmSync(ENV_FILE, { force: true })
  console.log('E2E infra down.')
}

const cmd = process.argv[2]
const run = cmd === 'up' ? up : cmd === 'down' ? down : null
if (!run) {
  console.error('Usage: tsx tests/e2e/infra.ts <up|down>')
  process.exit(1)
}
run().catch((err) => {
  console.error(err)
  process.exit(1)
})
