/**
 * email-poller.spec — integration tests for LivePollerService orchestration.
 *
 * R112–R118: gate behaviour, happy path, RUNNING-config skip, no-checkpoint
 * skip, per-thread error isolation, stale-checkpoint recovery, and dedup.
 * R184: T2.1 — checkpoint NOT advanced when any thread fails to ingest.
 *
 * Approach: jest.spyOn(providerFactory, 'for') returns an in-memory stub that
 * implements IMailProvider. Real ThreadIngestionService + real DB run so we
 * assert true DB side-effects (tickets created, checkpoint advanced).
 *
 * Single-tenant note: findActiveOauth() returns 0–1 rows (one AppConfig
 * singleton), so multi-config isolation is not a real scenario and is skipped.
 */

import { harness } from './harness'
import './setup'
import { LivePollerService } from '../../apps/api/src/modules/email-sync/live-poller.service'
import { ProviderFactory } from '../../apps/api/src/modules/email-sync/providers/provider-factory'
import { AppConfigService } from '../../apps/api/src/modules/config/config.service'
import { ThreadIngestionService } from '../../apps/api/src/modules/email-sync/thread-ingestion.service'
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

describe('R113 — happy path: one changed thread → ticket ingested + checkpoint advanced', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R113 — pollOne() ingests thread and advances gmailHistoryId to newCheckpoint', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '1000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const thread = buildParsedThread({
      threadId: 'poller-r113-t1',
      messageId: 'poller-r113-m1',
      rfcMessageId: '<r113@gmail.com>',
      from: 'r113-customer@example.com',
      subject: 'Help with setup',
      body: 'I need help with the setup.',
    })

    const stub = makeStubProvider({
      pollChanges: async () => ({ changedThreadIds: ['poller-r113-t1'], newCheckpoint: '1001' }),
      fetchThread: async () => thread,
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)

    await poller.pollOne(cfg)

    const ticket = await harness.prisma.ticket.findFirst({ where: { externalThreadId: 'poller-r113-t1' } })
    expect(ticket).not.toBeNull()
    expect(ticket!.source).toBe('EMAIL')

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

// ─── R116 — Per-thread error isolation ────────────────────────────────────────
// T2.1 changed the behavior: when ANY thread fails, the checkpoint is held
// (not advanced) so the next poll retries the failed thread from the same
// cursor position. The second (successful) thread is still ingested — the
// per-thread loop continues — but the batch as a whole is considered failed.

describe('R116 — per-thread error isolation: failed thread holds checkpoint', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R116 — first fetchAndUpsertThread throws → second thread ingested; checkpoint held at original', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '2000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const goodThread = buildParsedThread({
      threadId: 'r116-t2',
      messageId: 'r116-m2',
      rfcMessageId: '<r116-t2@gmail.com>',
      from: 'r116-customer@example.com',
      subject: 'Second thread',
      body: 'This one should be ingested.',
    })

    const stub = makeStubProvider({
      pollChanges: async () => ({ changedThreadIds: ['r116-t1', 'r116-t2'], newCheckpoint: '2001' }),
      fetchThread: async (threadId: string) => {
        if (threadId === 'r116-t1') throw new Error('should not reach fetchThread for t1')
        return goodThread
      },
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)

    // Make fetchAndUpsertThread throw for t1, fall back to real impl for t2.
    const realImpl = ingestion.fetchAndUpsertThread.bind(ingestion)
    const ingestSpy = jest.spyOn(ingestion, 'fetchAndUpsertThread')
      .mockRejectedValueOnce(new Error('simulated ingestion failure for t1'))
      .mockImplementation(realImpl)

    await poller.pollOne(cfg)

    // Both thread IDs were attempted
    expect(ingestSpy).toHaveBeenCalledTimes(2)
    expect(ingestSpy).toHaveBeenCalledWith(stub, 'r116-t1', { isBackfill: false })
    expect(ingestSpy).toHaveBeenCalledWith(stub, 'r116-t2', { isBackfill: false })

    // Second thread was ingested despite the first failing
    const ticket = await harness.prisma.ticket.findFirst({ where: { externalThreadId: 'r116-t2' } })
    expect(ticket).not.toBeNull()

    // !! KEY BEHAVIOR AFTER T2.1 FIX !!
    // Checkpoint must NOT advance when any thread failed — stays at '2000' so
    // the next poll retries t1 from the same Gmail historyId cursor.
    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('2000')
  })
})

// ─── R184 — T2.1: checkpoint only advances when all threads succeed ───────────

describe('R184 — T2.1: checkpoint only advances when ALL threads in the batch succeed', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R184 — all threads succeed → checkpoint advances to newCheckpoint', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '5000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const t1 = buildParsedThread({ threadId: 'r184-t1', messageId: 'r184-m1', rfcMessageId: '<r184-t1@gmail.com>', from: 'r184a@example.com', subject: 'Thread 1', body: 'First' })
    const t2 = buildParsedThread({ threadId: 'r184-t2', messageId: 'r184-m2', rfcMessageId: '<r184-t2@gmail.com>', from: 'r184b@example.com', subject: 'Thread 2', body: 'Second' })

    const stub = makeStubProvider({
      pollChanges: async () => ({ changedThreadIds: ['r184-t1', 'r184-t2'], newCheckpoint: '5001' }),
      fetchThread: async (id: string) => id === 'r184-t1' ? t1 : t2,
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)

    await poller.pollOne(cfg)

    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('5001')
  })

  it('R184 — any single thread failure → checkpoint stays at original value', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '6000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const stub = makeStubProvider({
      pollChanges: async () => ({ changedThreadIds: ['r184-fail-t1'], newCheckpoint: '6001' }),
      fetchThread: async () => { throw new Error('simulated fetch failure') },
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)
    jest.spyOn(ingestion, 'fetchAndUpsertThread')
      .mockRejectedValue(new Error('simulated ingest failure'))

    await poller.pollOne(cfg)

    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    // Must remain at '6000', not '6001'
    expect(updated!.gmailHistoryId).toBe('6000')
  })
})

// ─── R117 — Stale checkpoint recovery ────────────────────────────────────────

describe('R117 — stale checkpoint: recoverFromStaleCheckpoint called and its checkpoint persisted', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R117 — stale error → recoverFromStaleCheckpoint({sinceDays:7}) called; recovery checkpoint persisted', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '3000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const staleError = new Error('stale checkpoint')
    const recoverSpy = jest.fn().mockResolvedValue({ changedThreadIds: [], newCheckpoint: '3999' })

    const stub = makeStubProvider({
      pollChanges: async () => { throw staleError },
      isStaleCheckpointError: (err: unknown) => err === staleError,
      recoverFromStaleCheckpoint: recoverSpy,
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)

    await poller.pollOne(cfg)

    expect(recoverSpy).toHaveBeenCalledTimes(1)
    expect(recoverSpy).toHaveBeenCalledWith({ sinceDays: 7 })

    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('3999')
  })
})

// ─── R118 — Dedup of duplicate thread IDs ────────────────────────────────────

describe('R118 — dedup: duplicate thread IDs in pollChanges → ingestion runs once per unique ID', () => {
  afterEach(() => jest.restoreAllMocks())

  it('R118 — three IDs with one duplicate → fetchAndUpsertThread called exactly twice', async () => {
    const cfg = await seedPollerConfig({ gmailHistoryId: '4000' })
    const factory = harness.get<ProviderFactory>(ProviderFactory)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)
    const poller = harness.get<LivePollerService>(LivePollerService)

    const threads: Record<string, ParsedThread> = {
      't1': buildParsedThread({ threadId: 't1', messageId: 'm1', rfcMessageId: '<r118-t1@gmail.com>', from: 'r118a@example.com', subject: 'First', body: 'First thread' }),
      't2': buildParsedThread({ threadId: 't2', messageId: 'm2', rfcMessageId: '<r118-t2@gmail.com>', from: 'r118b@example.com', subject: 'Second', body: 'Second thread' }),
    }

    const stub = makeStubProvider({
      // 't1' appears twice — dedup must collapse to one call
      pollChanges: async () => ({ changedThreadIds: ['t1', 't1', 't2'], newCheckpoint: '4001' }),
      fetchThread: async (threadId: string) => threads[threadId],
    })
    jest.spyOn(factory, 'for').mockReturnValue(stub)

    const realImpl = ingestion.fetchAndUpsertThread.bind(ingestion)
    const ingestSpy = jest.spyOn(ingestion, 'fetchAndUpsertThread').mockImplementation(realImpl)

    await poller.pollOne(cfg)

    // Exactly 2 calls despite 3 IDs (the duplicate 't1' is deduplicated)
    expect(ingestSpy).toHaveBeenCalledTimes(2)
    const calledIds = ingestSpy.mock.calls.map((call) => call[1])
    expect(calledIds).toContain('t1')
    expect(calledIds).toContain('t2')
    expect(calledIds.filter((id) => id === 't1')).toHaveLength(1)

    const updated = await harness.prisma.appConfig.findUnique({ where: { id: cfg.id } })
    expect(updated!.gmailHistoryId).toBe('4001')
  })
})
