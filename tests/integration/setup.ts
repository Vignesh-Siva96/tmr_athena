/**
 * Per-file setup: invoked by Vitest in every integration test file.
 *
 * Each Vitest worker gets its own Postgres schema (`test_w<workerId>`) cloned from
 * the migrated `public` schema. Tables are TRUNCATEd between tests for speed.
 *
 * The Nest app is booted once per file via `harness.boot()` and reused across tests
 * in that file.
 */

// Globals (beforeAll / beforeEach / afterAll) come from the test runner — works
// under both Jest and Vitest with no import.
import { Logger } from '@nestjs/common'
import { setupServer } from 'msw/node'
import { harness } from './harness'
import { allHandlers } from './msw/handlers'

// MSW server — intercepts outbound HTTP (Gemini, Gmail, Graph, GitHub).
// Exported so per-test overrides can call mswServer.use(...).
export const mswServer = setupServer(...allHandlers)

beforeAll(async () => {
  Logger.overrideLogger(['error'])
  mswServer.listen({ onUnhandledRequest: 'bypass' })
  await harness.boot()
})

beforeEach(async () => {
  // Truncate every non-Prisma table. CASCADE handles FK chains.
  const tableNames: { tablename: string }[] = await harness.prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%' AND tablename NOT LIKE 'pg_%'`,
  )
  if (tableNames.length > 0) {
    const names = tableNames.map((t) => `"public"."${t.tablename}"`).join(', ')
    await harness.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`)
  }
  // Also clear pg-boss state between tests so worker counts/retries are deterministic.
  try {
    await harness.prisma.$executeRawUnsafe(`TRUNCATE TABLE pgboss.job, pgboss.archive RESTART IDENTITY CASCADE`)
  } catch {
    // pgboss schema may not exist yet on the very first test.
  }
  // In-memory test-only services (mail capture, etc.) don't live in the DB.
  // Reset them here so each test starts clean.
  try {
    const { MailCaptureService } = await import('../../apps/api/src/modules/test-utils/mail-capture.service')
    const capture = harness.get<InstanceType<typeof MailCaptureService>>(MailCaptureService)
    capture?.reset?.()
  } catch {
    // TestUtilsModule not loaded — fine, only loaded under NODE_ENV=test.
  }
})

afterEach(() => {
  mswServer.resetHandlers()
})

afterAll(async () => {
  mswServer.close()
  await harness.shutdown()
})
