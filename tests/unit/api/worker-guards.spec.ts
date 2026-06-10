/**
 * worker-guards.spec — unit tests for worker-level defense-in-depth guards (T2.2, T2.3).
 *
 * Workers register handlers as lambdas inside pg-boss `work()` calls so they
 * cannot be called directly through a service interface. This file captures those
 * lambdas by intercepting `queue.getBoss().work(queue, handler)` and invokes them
 * with synthetic job objects — no real DB, no real queue, no Docker required.
 *
 * Regression catalogue rows:
 *   R192 — SendReplyWorker refuses to email INTERNAL_NOTE (T2.2)
 *   R193 — RequestCsatWorker skips send when csat_requested SYSTEM_EVENT exists (T2.3)
 *   R194 — ClassifyTicketWorker only increments/decrements topicCount when topic changes (T2.3)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── helpers ──────────────────────────────────────────────────────────────────

type HandlerFn = (job: { data: Record<string, unknown> }) => Promise<void>

function makeBoss() {
  let captured: HandlerFn | undefined
  return {
    work: vi.fn((_queue: string, handler: HandlerFn) => { captured = handler }),
    getHandler: () => captured!,
  }
}

// ─── R192 — SendReplyWorker: INTERNAL_NOTE guard ──────────────────────────────

describe('R192 — SendReplyWorker: refuses to email INTERNAL_NOTE or non-REPLY messages', () => {
  let sendAgentReply: ReturnType<typeof vi.fn>
  let handler: HandlerFn

  beforeEach(async () => {
    sendAgentReply = vi.fn().mockResolvedValue('<msg-id@domain>')

    const boss = makeBoss()
    const mockQueue = {
      ready: vi.fn().mockResolvedValue(undefined),
      getBoss: vi.fn().mockReturnValue(boss),
    }
    const mockDb = {
      appConfig: { findFirst: vi.fn().mockResolvedValue({ appName: 'TMR' }) },
      ticket: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ticket-1',
          user: { email: 'customer@test.com', name: 'Customer' },
        }),
      },
      message: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
    }
    const mockEmail = { sendAgentReply }

    const { SendReplyWorker } = await import(
      '../../../apps/api/src/modules/email/workers/send-reply.worker'
    )
    const worker = new SendReplyWorker(mockQueue as any, mockEmail as any, mockDb as any)
    await worker.onModuleInit()
    handler = boss.getHandler()
    ;(mockDb.message.findUnique as ReturnType<typeof vi.fn>)
      .mockImplementation(({ where }: { where: { id: string } }) => {
        const messages: Record<string, unknown> = {
          'msg-internal': { id: 'msg-internal', type: 'INTERNAL_NOTE', isInternal: true, body: 'private note', authorAgent: null },
          'msg-reply-internal': { id: 'msg-reply-internal', type: 'REPLY', isInternal: true, body: 'also private', authorAgent: null },
          'msg-system': { id: 'msg-system', type: 'SYSTEM_EVENT', isInternal: true, body: 'status_changed:OPEN:RESOLVED', authorAgent: null },
          'msg-ok': { id: 'msg-ok', type: 'REPLY', isInternal: false, body: 'Hello customer!', authorAgent: { id: 'a1', name: 'Agent' } },
        }
        return Promise.resolve(messages[where.id] ?? null)
      })
    Object.assign(mockDb, mockDb)
  })

  it('does NOT call sendAgentReply for an INTERNAL_NOTE message', async () => {
    await handler({ data: { ticketId: 'ticket-1', messageId: 'msg-internal' } })
    expect(sendAgentReply).not.toHaveBeenCalled()
  })

  it('does NOT call sendAgentReply for a REPLY with isInternal=true', async () => {
    await handler({ data: { ticketId: 'ticket-1', messageId: 'msg-reply-internal' } })
    expect(sendAgentReply).not.toHaveBeenCalled()
  })

  it('does NOT call sendAgentReply for a SYSTEM_EVENT message', async () => {
    await handler({ data: { ticketId: 'ticket-1', messageId: 'msg-system' } })
    expect(sendAgentReply).not.toHaveBeenCalled()
  })

  it('DOES call sendAgentReply for a customer-facing REPLY', async () => {
    await handler({ data: { ticketId: 'ticket-1', messageId: 'msg-ok' } })
    expect(sendAgentReply).toHaveBeenCalledOnce()
  })
})

// ─── R193 — RequestCsatWorker: idempotency guard ─────────────────────────────

describe('R193 — RequestCsatWorker: skips send when csat_requested SYSTEM_EVENT already exists', () => {
  it('does NOT call sendRaw when csat_requested message exists (idempotent)', async () => {
    const sendRaw = vi.fn()

    const boss = makeBoss()
    const mockQueue = {
      ready: vi.fn().mockResolvedValue(undefined),
      getBoss: vi.fn().mockReturnValue(boss),
    }
    const mockDb = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue({
          id: 't1',
          user: { email: 'u@test.com', name: 'User' },
        }),
      },
      message: {
        // findFirst returns an existing csat_requested marker → should short-circuit
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-csat-marker' }),
        create: vi.fn(),
      },
      appConfig: { findFirst: vi.fn().mockResolvedValue({ appName: 'TMR' }) },
      ticketRating: { upsert: vi.fn().mockResolvedValue({ ratingToken: 'tok123' }) },
    }
    const mockConfig = { get: vi.fn().mockReturnValue('http://localhost:3000') }

    const { RequestCsatWorker } = await import(
      '../../../apps/api/src/modules/ai/workers/request-csat.worker'
    )
    const worker = new RequestCsatWorker(
      mockQueue as any,
      mockDb as any,
      { sendRaw } as any,
      mockConfig as any,
    )
    await worker.onModuleInit()
    const handler = boss.getHandler()

    await handler({ data: { ticketId: 't1' } })

    expect(sendRaw).not.toHaveBeenCalled()
    expect(mockDb.message.create).not.toHaveBeenCalled()
  })

  it('DOES call sendRaw when no csat_requested marker exists (first send)', async () => {
    const sendRaw = vi.fn().mockResolvedValue(undefined)

    const boss = makeBoss()
    const mockQueue = {
      ready: vi.fn().mockResolvedValue(undefined),
      getBoss: vi.fn().mockReturnValue(boss),
    }
    const mockDb = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue({
          id: 't2',
          ref: 'ABC1234',
          title: 'Help needed',
          user: { email: 'u2@test.com', name: 'User2' },
        }),
      },
      message: {
        findFirst: vi.fn().mockResolvedValue(null), // no marker yet
        create: vi.fn().mockResolvedValue({}),
      },
      appConfig: { findFirst: vi.fn().mockResolvedValue({ appName: 'TMR' }) },
      ticketRating: { upsert: vi.fn().mockResolvedValue({ ratingToken: 'tok456' }) },
    }
    const mockConfig = { get: vi.fn().mockReturnValue('http://localhost:3000') }

    const { RequestCsatWorker } = await import(
      '../../../apps/api/src/modules/ai/workers/request-csat.worker'
    )
    const worker = new RequestCsatWorker(
      mockQueue as any,
      mockDb as any,
      { sendRaw } as any,
      mockConfig as any,
    )
    await worker.onModuleInit()
    const handler = boss.getHandler()

    await handler({ data: { ticketId: 't2' } })

    expect(sendRaw).toHaveBeenCalledOnce()
    // Marker must be written after successful send
    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ body: 'csat_requested' }) }),
    )
  })
})

// ─── R194 — ClassifyTicketWorker: topic count atomicity ──────────────────────

describe('R194 — ClassifyTicketWorker: ticketCount only changes when topic assignment changes', () => {
  function makeClassifyWorker(topicId: string | null) {
    const $transaction = vi.fn().mockResolvedValue([])
    const ticketUpdate = vi.fn().mockReturnValue({ then: () => {} })
    const topicUpdate = vi.fn().mockReturnValue({ then: () => {} })
    const ratingUpsert = vi.fn().mockReturnValue({ then: () => {} })

    const boss = makeBoss()
    const mockQueue = {
      ready: vi.fn().mockResolvedValue(undefined),
      getBoss: vi.fn().mockReturnValue(boss),
    }
    const mockDb = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue({
          id: 't1',
          topicId,
          title: 'Test ticket',
          messages: [{ body: 'I need help', authorUserId: 'u1', authorAgentId: null }],
        }),
        update: ticketUpdate,
      },
      topic: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ id: 'topic-new', name: 'Technical Issue' }),
        update: topicUpdate,
      },
      ticketRating: { upsert: ratingUpsert },
      $transaction,
    }

    return { boss, mockDb, topicUpdate, $transaction }
  }

  it('increments new topic and decrements old topic when topic changes', async () => {
    const { boss, mockDb, $transaction } = makeClassifyWorker('topic-old')

    const mockGemini = {
      classifyAndScoreTicket: vi.fn().mockResolvedValue({
        topic: { name: 'Technical Issue', isNewTopic: false },
        csat: { rating: 4, reasoning: 'ok' },
        effort: { score: 2 },
        summary: 'Summary',
      }),
    }

    const { ClassifyTicketWorker } = await import(
      '../../../apps/api/src/modules/ai/workers/classify-ticket.worker'
    )
    const worker = new ClassifyTicketWorker(mockDb as any, mockGemini as any, mockDb as any)
    // ClassifyTicketWorker constructor takes (queue, gemini, db) but we skip queue here
    // via a minimal stub that just captures the handler
    const minimalQueue = {
      ready: vi.fn().mockResolvedValue(undefined),
      getBoss: vi.fn().mockReturnValue(boss),
    }
    const worker2 = new ClassifyTicketWorker(minimalQueue as any, mockGemini as any, mockDb as any)
    await worker2.onModuleInit()
    const handler = boss.getHandler()

    await handler({ data: { ticketId: 't1' } })

    const ops = ($transaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[]
    // Should have: ticketUpdate + topicIncrement + topicDecrement + ratingUpsert = 4 ops
    expect(ops).toHaveLength(4)
  })

  it('does NOT touch topic counts when ticket is reassigned to the same topic', async () => {
    const sameTopicId = 'topic-same'
    const { boss, mockDb, $transaction } = makeClassifyWorker(sameTopicId)
    // Make topic.upsert return the same id as the ticket already has
    ;(mockDb.topic.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: sameTopicId, name: 'Same Topic' })

    const mockGemini = {
      classifyAndScoreTicket: vi.fn().mockResolvedValue({
        topic: { name: 'Same Topic', isNewTopic: false },
        csat: { rating: 3, reasoning: 'ok' },
        effort: { score: 2 },
        summary: 'Summary',
      }),
    }

    const minimalQueue = {
      ready: vi.fn().mockResolvedValue(undefined),
      getBoss: vi.fn().mockReturnValue(boss),
    }

    const { ClassifyTicketWorker } = await import(
      '../../../apps/api/src/modules/ai/workers/classify-ticket.worker'
    )
    const worker = new ClassifyTicketWorker(minimalQueue as any, mockGemini as any, mockDb as any)
    await worker.onModuleInit()
    const handler = boss.getHandler()

    await handler({ data: { ticketId: 't1' } })

    const ops = ($transaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[]
    // Should have: ticketUpdate + ratingUpsert = 2 ops (no topic count changes)
    expect(ops).toHaveLength(2)
    expect(mockDb.topic.update).not.toHaveBeenCalled()
  })
})
