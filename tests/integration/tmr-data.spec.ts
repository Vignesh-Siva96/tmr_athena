/**
 * tmr-data.spec — integration tests for TmrDataService + Users API TMR endpoints.
 *
 * Regression catalogue rows:
 *   R223 — TmrDataService.syncUser happy path: persists OK + tmrUserId + summary
 *   R224 — TmrDataService.syncUser no-match: persists NOT_FOUND, does not throw
 *   R225 — TmrDataService.syncUser HTTP error: persists ERROR, does not rethrow
 *   R226 — TmrDataService.syncUser missing env: leaves PENDING, no-op (never throws)
 *   R227 — New portal ticket enqueues TMR metadata sync
 *   R228 — New live non-bulk email enqueues TMR metadata sync
 *   R229 — Bulk email does NOT enqueue TMR sync
 *   R230 — Backfill email does NOT enqueue TMR sync
 *   R231 — POST /users/:id/tmr-metadata/refresh → 202 + enqueues
 *   R232 — GET /users/:id returns tmrMetadata, tmrMetadataStatus, tmrMetadataAt fields
 */

import { http, HttpResponse } from 'msw'
import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, signJwt } from './factories'
import './setup'
import { mswServer } from './setup'
import { TmrDataService } from '../../apps/api/src/modules/tmr-data/tmr-data.service'
import { QueueService } from '../../apps/api/src/modules/queue/queue.service'
import { ThreadIngestionService } from '../../apps/api/src/modules/email-sync/thread-ingestion.service'
import type { IMailProvider, ParsedThread } from '../../apps/api/src/modules/email-sync/providers/mail-provider.interface'

function makeFakeProvider(thread: ParsedThread): IMailProvider {
  return {
    kind: 'GMAIL',
    matchesAlias: () => false,
    email: 'support@example.com',
    aliases: [],
    fetchThread: async () => thread,
    pollChanges: async () => ({ changedThreadIds: [], newCheckpoint: '' }),
  } as unknown as IMailProvider
}

const TMR_BASE = 'http://tmr-test.internal'

function mockTmrHandlers(email: string, userId = 'tmr-user-1') {
  mswServer.use(
    http.post(`${TMR_BASE}/back-office/getUsersByFuzzySearch`, () =>
      HttpResponse.json({
        status: 'success',
        data: [{ userId, fullName: 'Test User', emailId: email }],
      }),
    ),
    http.post(`${TMR_BASE}/back-office/getUserDetails`, () =>
      HttpResponse.json({
        status: 'success',
        data: {
          accounts: [
            {
              accountId: 'acc1',
              planName: 'Pro',
              planConfig: { coreDestination: 'Sheets', additionalDestinations: [] },
              billingFreq: 'monthly',
              subscription: { status: 'active' },
            },
          ],
          teams: [{ teamId: 'team1', name: 'Alpha' }],
          dataSources: [{ teamId: 'team1' }],
          queries: [],
          schedules: [],
        },
      }),
    ),
  )
}

function mockTmrNotFound(email: string) {
  mswServer.use(
    http.post(`${TMR_BASE}/back-office/getUsersByFuzzySearch`, () =>
      HttpResponse.json({
        status: 'success',
        data: [{ userId: 'u99', emailId: 'different@example.com' }], // different email — not a match
      }),
    ),
  )
  void email // suppress lint
}

function mockTmrHttpError() {
  mswServer.use(
    http.post(`${TMR_BASE}/back-office/getUsersByFuzzySearch`, () =>
      HttpResponse.json({ error: 'Internal server error' }, { status: 500 }),
    ),
  )
}

async function getTmrService(): Promise<TmrDataService> {
  const { app } = harness
  const mod = (app as unknown as { select: (m: unknown) => { get: (s: unknown) => unknown } })
  // Use harness.app to grab NestJS service from the DI container
  return harness.app.get(TmrDataService)
}

async function getQueueService(): Promise<QueueService> {
  return harness.app.get(QueueService)
}

// ─── R223 — syncUser happy path ───────────────────────────────────────────────

describe('R223 — TmrDataService.syncUser happy path', () => {
  it('persists OK status, tmrUserId, and metadata summary', async () => {
    const user = await makeUser()
    mockTmrHandlers(user.email)

    // Temporarily set the env vars
    process.env['TMR_DATA_SERVICE_BASE_URL'] = TMR_BASE
    process.env['TMR_DATA_SERVICE_API_KEY'] = 'test-key'
    try {
      const svc = await getTmrService()
      await svc.syncUser(user.id)
    } finally {
      delete process.env['TMR_DATA_SERVICE_BASE_URL']
      delete process.env['TMR_DATA_SERVICE_API_KEY']
    }

    const updated = await harness.prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.tmrMetadataStatus).toBe('OK')
    expect(updated?.tmrUserId).toBe('tmr-user-1')
    expect(updated?.tmrMetadata).toBeTruthy()
    const meta = updated?.tmrMetadata as { accounts: unknown[] }
    expect(meta.accounts).toHaveLength(1)
  })
})

// ─── R224 — syncUser no-match → NOT_FOUND ────────────────────────────────────

describe('R224 — TmrDataService.syncUser no email match', () => {
  it('persists NOT_FOUND and does not throw', async () => {
    const user = await makeUser()
    mockTmrNotFound(user.email)

    process.env['TMR_DATA_SERVICE_BASE_URL'] = TMR_BASE
    process.env['TMR_DATA_SERVICE_API_KEY'] = 'test-key'
    try {
      const svc = await getTmrService()
      await expect(svc.syncUser(user.id)).resolves.toBeUndefined()
    } finally {
      delete process.env['TMR_DATA_SERVICE_BASE_URL']
      delete process.env['TMR_DATA_SERVICE_API_KEY']
    }

    const updated = await harness.prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.tmrMetadataStatus).toBe('NOT_FOUND')
    expect(updated?.tmrUserId).toBeNull()
  })
})

// ─── R225 — syncUser HTTP error → ERROR (no rethrow) ────────────────────────

describe('R225 — TmrDataService.syncUser HTTP error', () => {
  it('persists ERROR status and does not rethrow', async () => {
    const user = await makeUser()
    mockTmrHttpError()

    process.env['TMR_DATA_SERVICE_BASE_URL'] = TMR_BASE
    process.env['TMR_DATA_SERVICE_API_KEY'] = 'test-key'
    try {
      const svc = await getTmrService()
      await expect(svc.syncUser(user.id)).resolves.toBeUndefined()
    } finally {
      delete process.env['TMR_DATA_SERVICE_BASE_URL']
      delete process.env['TMR_DATA_SERVICE_API_KEY']
    }

    const updated = await harness.prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.tmrMetadataStatus).toBe('ERROR')
  })
})

// ─── R226 — syncUser missing env → PENDING no-op ─────────────────────────────

describe('R226 — TmrDataService.syncUser missing env', () => {
  it('leaves status PENDING, makes no DB changes', async () => {
    const user = await makeUser()
    // env vars NOT set
    delete process.env['TMR_DATA_SERVICE_BASE_URL']
    delete process.env['TMR_DATA_SERVICE_API_KEY']

    const svc = await getTmrService()
    await expect(svc.syncUser(user.id)).resolves.toBeUndefined()

    const updated = await harness.prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.tmrMetadataStatus).toBe('PENDING')
    expect(updated?.tmrMetadataAt).toBeNull()
  })
})

// ─── R227 — portal ticket enqueues TMR sync ───────────────────────────────────

describe('R227 — Portal ticket creation enqueues TMR sync', () => {
  it('calls enqueueFetchTmrMetadata when a portal ticket is created', async () => {
    const user = await makeUser({ password: 'Pass123!' })
    const queue = await getQueueService()
    const spy = jest.spyOn(queue, 'enqueueFetchTmrMetadata').mockResolvedValue()

    const authRes = await harness.request()
      .post('/api/v1/auth/signin')
      .send({ email: user.email, password: 'Pass123!' })
    const token = (authRes.body as { data: { token: string } }).data.token

    await harness.prisma.appConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    })
    await harness.request()
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'TMR test ticket', category: 'QUESTION' })

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ userId: user.id }))
    spy.mockRestore()
  })
})

// ─── R228 — New live non-bulk email enqueues TMR sync ─────────────────────────

describe('R228 — New live non-bulk email enqueues TMR sync', () => {
  it('enqueues TMR sync for a new conversation', async () => {
    const queue = await getQueueService()
    const spy = jest.spyOn(queue, 'enqueueFetchTmrMetadata').mockResolvedValue()

    const ingestion = harness.app.get(ThreadIngestionService)

    const threadId = `thread-tmr-test-${Date.now()}`
    const thread: ParsedThread = {
      id: threadId,
      firstSubject: 'Test non-bulk',
      hasUnread: false,
      messages: [
        {
          id: `msg-tmr-${Date.now()}`,
          fromEmail: 'customer-tmr@example.com',
          fromName: 'Customer',
          toEmails: ['support@example.com'],
          ccEmails: [],
          subject: 'Test non-bulk',
          bodyPlain: 'Hello',
          sentAt: new Date(),
          isBulk: false,
        },
      ],
    }
    const provider = makeFakeProvider(thread)

    await ingestion.fetchAndUpsertThread(provider, threadId, { isBackfill: false })

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ─── R229 — Bulk email does NOT enqueue TMR sync ─────────────────────────────

describe('R229 — Bulk email does NOT enqueue TMR sync', () => {
  it('skips TMR enqueue for bulk email', async () => {
    const queue = await getQueueService()
    const spy = jest.spyOn(queue, 'enqueueFetchTmrMetadata').mockResolvedValue()

    const ingestion = harness.app.get(ThreadIngestionService)

    const threadId = `thread-tmr-bulk-${Date.now()}`
    const thread: ParsedThread = {
      id: threadId,
      firstSubject: 'Bulk newsletter',
      hasUnread: false,
      messages: [
        {
          id: `msg-tmr-bulk-${Date.now()}`,
          fromEmail: 'newsletter@bulk-sender.com',
          fromName: 'Newsletter',
          toEmails: ['support@example.com'],
          ccEmails: [],
          subject: 'Bulk newsletter',
          bodyPlain: 'Unsubscribe here',
          sentAt: new Date(),
          isBulk: true,
        },
      ],
    }
    const provider = makeFakeProvider(thread)

    await ingestion.fetchAndUpsertThread(provider, threadId, { isBackfill: false })

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ─── R230 — Backfill does NOT enqueue TMR sync ────────────────────────────────

describe('R230 — Backfill email does NOT enqueue TMR sync', () => {
  it('skips TMR enqueue when isBackfill=true', async () => {
    const queue = await getQueueService()
    const spy = jest.spyOn(queue, 'enqueueFetchTmrMetadata').mockResolvedValue()

    const ingestion = harness.app.get(ThreadIngestionService)

    const threadId = `thread-tmr-backfill-${Date.now()}`
    const thread: ParsedThread = {
      id: threadId,
      firstSubject: 'Backfill thread',
      hasUnread: false,
      messages: [
        {
          id: `msg-tmr-backfill-${Date.now()}`,
          fromEmail: 'user-backfill@example.com',
          fromName: 'User',
          toEmails: ['support@example.com'],
          ccEmails: [],
          subject: 'Backfill thread',
          bodyPlain: 'Old email',
          sentAt: new Date(),
          isBulk: false,
        },
      ],
    }
    const provider = makeFakeProvider(thread)

    await ingestion.fetchAndUpsertThread(provider, threadId, { isBackfill: true })

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ─── R231 — POST /users/:id/tmr-metadata/refresh ─────────────────────────────

describe('R231 — POST /users/:id/tmr-metadata/refresh → 202', () => {
  it('returns 202 and enqueues the refresh job', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt(agent)

    const queue = await getQueueService()
    const spy = jest.spyOn(queue, 'enqueueFetchTmrMetadata').mockResolvedValue()

    const res = await harness.request()
      .post(`/api/v1/users/${user.id}/tmr-metadata/refresh`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(202)
    expect(spy).toHaveBeenCalledWith({ userId: user.id })
    spy.mockRestore()
  })
})

// ─── R232 — GET /users/:id returns tmr fields ─────────────────────────────────

describe('R232 — GET /users/:id returns TMR fields', () => {
  it('includes tmrMetadataStatus and tmrMetadataAt in the user response', async () => {
    const user = await makeUser()
    // Manually set a known status
    await harness.prisma.user.update({
      where: { id: user.id },
      data: {
        tmrMetadataStatus: 'NOT_FOUND',
        tmrMetadataAt: new Date('2026-01-01'),
        tmrMetadata: null,
      },
    })

    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt(agent)

    const res = await harness.request()
      .get(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const u = (res.body as { data: { user: { tmrMetadataStatus: string; tmrMetadataAt: string; tmrMetadata: null } } }).data.user
    expect(u.tmrMetadataStatus).toBe('NOT_FOUND')
    expect(u.tmrMetadataAt).toBeTruthy()
    expect(u.tmrMetadata).toBeNull()
  })
})
