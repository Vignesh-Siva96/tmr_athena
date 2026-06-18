/**
 * email-poller.spec — integration tests for LivePollerService orchestration.
 *
 * R112–R118: gate behaviour, happy path, RUNNING-config skip, no-checkpoint
 * skip, per-thread enqueue (dispatcher design), stale-checkpoint recovery, dedup.
 * R184: checkpoint always advances after dispatcher split — no longer held on failure.
 *
 * Architecture note (dispatcher/importer split):
 *   pollOne() is now a thin dispatcher. It calls pollChanges(), enqueues one
 *   pg-boss job per unique threadId via QueueService.enqueueIngestThread(), then
 *   advances the checkpoint. Actual ingestion (fetchAndUpsertThread) happens in
 *   IngestThreadWorker — a separate worker that retries on failure via pg-boss.
 *   Consequence: pollOne() ALWAYS advances the checkpoint regardless of
 *   per-thread ingestion failures (failures surface in the pg-boss dead-letter
 *   queue, not here).
 *
 * Approach: jest.spyOn(providerFactory, 'for') returns an in-memory stub that
 * implements IMailProvider. QueueService.enqueueIngestThread is spied on so we
 * verify job enqueueing without a live pg-boss worker.
 *
 * Single-tenant note: findActiveOauth() returns 0–1 rows (one AppConfig
 * singleton), so multi-config isolation is not a real scenario and is skipped.
 */

import { harness } from './harness'
import './setup'
import { LivePollerService } from '../../apps/api/src/modules/email-sync/live-poller.service'
import { ProviderFactory } from '../../apps/api/src/modules/email-sync/providers/provider-factory'
import { AppConfigService } from '../../apps/api/src/modules/config/config.service'
import { QueueService } from '../../apps/api/src/modules/queue/queue.service'
import type { IMailProvider, ParsedThread } from '../../apps/api/src/modules/email-sync/providers/mail-provider.interface'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedPollerConfig(overrides: Record<string, unknown> = {}) {
  return harness.prisma.appConfig.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      appName: 'TMR',
      emailDisplayName: 'TMR',
      oauthProvider: 'GOOGLE',
      oauthAccessTokenEnc: 'x',
      gmailHistoryId: '1000',
      ...overrides,
    } as Parameters<typeof harness.prisma.appConfig.upsert>[0]['create'],
    update: {
      oauthProvider: 'GOOGLE',
      oauthAccessTokenEnc: 'x',
      gmailHistoryId: '1000',
      ...overrides,
    } as Parameters<typeof harness.prisma.appConfig.upsert>[0]['update'],
  })
}

function makeStubProvider(overrides: Partial<IMailProvider> = {}): IMailProvider {
  return {
    kind: 'GMAIL',
    aliases: ['support@test.local'],
    fetchThread: async (_threadId: string): Promise<ParsedThread> => {
      throw new Error('fetchThread not configured in stub')
    },
    listThreadIdsSince: async () => ({ threadIds: [], nextPageToken: undefined }),
    listAllThreadIds: async () => ({ threadIds: [], nextPageToken: undefined }),
    pollChanges: async () => ({ changedThreadIds: [], newCheckpoint: '9999' }),
    isStaleCheckpointError: () => false,
    recoverFromStaleCheckpoint: async () => ({ changedThreadIds: [], newCheckpoint: '9999' }),
    ...overrides,
  }
}

function buildParsedThread(opts: {
  threadId: string
  messageId: string
  rfcMessageId: string
  from: string
  subject: string
  body: string
}): ParsedThread {
  return {
    id: opts.threadId,
    firstSubject: opts.subject,
    hasUnread: true,
    messages: [
      {
        id: opts.messageId,
        rfcMessageId: opts.rfcMessageId,
        fromEmail: opts.from,
        fromName: 'Test Sender',
        toEmails: ['support@test.local'],
        ccEmails: [],
        subject: opts.subject,
        bodyPlain: opts.body,
        sentAt: new Date(),
        isBulk: false,
      },
    ],
  }
}

// ─── R112 — Gate off ──────────────────────────────────────────────────────────

describe('R112 — gate off: EMAIL_SYNC_LIVE_POLL !== "1" → pollAll() does no work', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R112 — pollAll is a no-op when disabled (findActiveOauth and providerFactory.for not called)', async () => {
    await seedPollerConfig()
    const poller = harness.get<LivePollerService>(LivePollerService)
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const appConfigSvc = harness.get<AppConfigService>(AppConfigService)

    const findActiveSpy = jest.spyOn(appConfigSvc, 'findActiveOauth')
    const forSpy = jest.spyOn(factory, 'for')

    await poller.pollAll()

    expect(findActiveSpy).not.toHaveBeenCalled()
    expect(forSpy).not.toHaveBeenCalled()
    expect(await harness.prisma.ticket.findFirst()).toBeNull()
  })
})

// ─── R113 — Happy path ────────────────────────────────────────────────────────

describe('R113 — happy path: one changed thread → job enqueued + checkpoint advanced', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R113 — pollOne() enqueues ingest job and advances gmailHistoryId to newCheckpoint', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '1000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const queue = harness.get<QueueService>(QueueService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const stub = makeStubProvider({
      pollChanges: async () => ({ changedThreadIds: ['poller-r113-t1'], newCheckpoint: '1001' }),
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)
    const enqueueSpy = jest.spyOn(queue, 'enqueueIngestThread').mockResolvedValue()

    await poller.pollOne(cfg)

    // Dispatcher enqueues the job — ingestion happens in the worker, not here
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    expect(enqueueSpy).toHaveBeenCalledWith({ cfgId: cfg.id, threadId: 'poller-r113-t1' })

    // Checkpoint always advances after enqueue
    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('1001')
  })
})

// ─── R114 — archiveStatus=RUNNING skipped ────────────────────────────────────

describe('R114 — archiveStatus=RUNNING config is skipped by pollAll()', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R114 — RUNNING config is bypassed; providerFactory.for not called; no ticket created', async () => {
    await seedPollerConfig({ archiveStatus: 'RUNNING' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const poller = harness.get<LivePollerService>(LivePollerService)

    // Force the gate on so pollAll() proceeds past the enabled check
    ;(poller as unknown as { enabled: boolean }).enabled = true

    const forSpy = jest.spyOn(factory, 'for')

    await poller.pollAll()

    expect(forSpy).not.toHaveBeenCalled()
    expect(await harness.prisma.ticket.findFirst()).toBeNull()
  })
})

// ─── R115 — No checkpoint → warn + skip ──────────────────────────────────────

describe('R115 — no checkpoint (gmailHistoryId and graphDeltaLink both null) → skip poll', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R115 — pollOne() skips pollChanges and does not throw; checkpoint stays null', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: null })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const stub = makeStubProvider()
    jest.spyOn(factory, 'for').mockReturnValue(stub)
    const pollChangesSpy = jest.spyOn(stub, 'pollChanges')

    await expect(poller.pollOne(cfg)).resolves.toBeUndefined()

    // pollChanges never reached — skipped at the checkpoint guard
    expect(pollChangesSpy).not.toHaveBeenCalled()

    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBeNull()
    expect(updated!.graphDeltaLink).toBeNull()

    expect(await harness.prisma.ticket.findFirst()).toBeNull()
  })
})

// ─── R116 — Dispatcher enqueues all threads; checkpoint always advances ───────
// After the dispatcher/importer split, pollOne() is a thin dispatcher: it enqueues
// jobs for ALL changed thread IDs via pg-boss and then advances the checkpoint.
// Ingestion failures are handled in IngestThreadWorker with per-job retries.
// The checkpoint is NOT held when a thread fails — that was the old T2.1 behavior.

describe('R116 — dispatcher: all threads enqueued regardless of order; checkpoint always advances', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R116 — two thread IDs from pollChanges → both enqueued; checkpoint advances to newCheckpoint', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '2000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const queue = harness.get<QueueService>(QueueService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const stub = makeStubProvider({
      pollChanges: async () => ({ changedThreadIds: ['r116-t1', 'r116-t2'], newCheckpoint: '2001' }),
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)
    const enqueueSpy = jest.spyOn(queue, 'enqueueIngestThread').mockResolvedValue()

    await poller.pollOne(cfg)

    // Both threads enqueued — ingestion failures surface in worker retries, not here
    expect(enqueueSpy).toHaveBeenCalledTimes(2)
    expect(enqueueSpy).toHaveBeenCalledWith({ cfgId: cfg.id, threadId: 'r116-t1' })
    expect(enqueueSpy).toHaveBeenCalledWith({ cfgId: cfg.id, threadId: 'r116-t2' })

    // Checkpoint always advances after dispatching
    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('2001')
  })
})

// ─── R184 — checkpoint always advances after dispatcher split ─────────────────
// Old behavior (T2.1): checkpoint held when any thread failed.
// New behavior (dispatcher): checkpoint advances unconditionally after enqueue.
// Per-thread retry is now pg-boss's responsibility (IngestThreadWorker).

describe('R184 — dispatcher: checkpoint advances regardless of downstream ingest outcome', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R184 — multiple threads enqueued → checkpoint advances to newCheckpoint', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '5000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const queue = harness.get<QueueService>(QueueService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const stub = makeStubProvider({
      pollChanges: async () => ({ changedThreadIds: ['r184-t1', 'r184-t2'], newCheckpoint: '5001' }),
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)
    jest.spyOn(queue, 'enqueueIngestThread').mockResolvedValue()

    await poller.pollOne(cfg)

    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('5001')
  })

  it('R184 — checkpoint advances even when enqueue is called for a single thread', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '6000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const queue = harness.get<QueueService>(QueueService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const stub = makeStubProvider({
      pollChanges: async () => ({ changedThreadIds: ['r184-only-t1'], newCheckpoint: '6001' }),
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)
    const enqueueSpy = jest.spyOn(queue, 'enqueueIngestThread').mockResolvedValue()

    await poller.pollOne(cfg)

    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    expect(enqueueSpy).toHaveBeenCalledWith({ cfgId: cfg.id, threadId: 'r184-only-t1' })

    // Checkpoint advances — ingestion outcomes are decoupled from the poll loop
    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('6001')
  })
})

// ─── R117 — Stale checkpoint recovery ────────────────────────────────────────

describe('R117 — stale checkpoint: recoverFromStaleCheckpoint called and its checkpoint persisted', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R117 — stale error → recoverFromStaleCheckpoint({sinceDays:7}) called; recovery checkpoint persisted', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '3000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const queue = harness.get<QueueService>(QueueService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const staleError = new Error('stale checkpoint')
    const recoverSpy = jest.fn().mockResolvedValue({ changedThreadIds: [], newCheckpoint: '3999' })

    const stub = makeStubProvider({
      pollChanges: async () => { throw staleError },
      isStaleCheckpointError: (err: unknown) => err === staleError,
      recoverFromStaleCheckpoint: recoverSpy,
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)
    jest.spyOn(queue, 'enqueueIngestThread').mockResolvedValue()

    await poller.pollOne(cfg)

    expect(recoverSpy).toHaveBeenCalledTimes(1)
    expect(recoverSpy).toHaveBeenCalledWith({ sinceDays: 7 })

    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('3999')
  })
})

// ─── R118 — Dedup of duplicate thread IDs ────────────────────────────────────

describe('R118 — dedup: duplicate thread IDs in pollChanges → enqueue runs once per unique ID', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R118 — three IDs with one duplicate → enqueueIngestThread called exactly twice', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '4000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const queue = harness.get<QueueService>(QueueService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const stub = makeStubProvider({
      // 't1' appears twice — dedup must collapse to one enqueue call
      pollChanges: async () => ({ changedThreadIds: ['t1', 't1', 't2'], newCheckpoint: '4001' }),
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)
    const enqueueSpy = jest.spyOn(queue, 'enqueueIngestThread').mockResolvedValue()

    await poller.pollOne(cfg)

    // Exactly 2 enqueue calls despite 3 IDs (the duplicate 't1' is deduplicated)
    expect(enqueueSpy).toHaveBeenCalledTimes(2)
    const calledIds = enqueueSpy.mock.calls.map((call) => call[0].threadId)
    expect(calledIds).toContain('t1')
    expect(calledIds).toContain('t2')
    expect(calledIds.filter((id) => id === 't1')).toHaveLength(1)

    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('4001')
  })
})
