/**
 * gemini-transient-retry.spec — unit tests for transient-vs-terminal Gemini
 * failure handling across every AI path (R266).
 *
 * Background: a momentary Gemini 503 ("model experiencing high demand") used to
 * permanently escalate a bot ticket to a human on the first failure, because
 * BotService swallowed the error and the queue's retryLimit never fired. The fix
 * routes all Gemini calls through `isTransientGeminiError`:
 *   - bot:   rethrow transient (→ pg-boss retries) until the final attempt, then escalate
 *   - sentiment / classify workers: rethrow transient (→ retry), swallow terminal (no wasted retries)
 *
 * These capture the pg-boss handler lambdas the same way worker-guards.spec does
 * — no real DB, queue, or network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isTransientGeminiError } from '../../../apps/api/src/common/ai/transient-error'

// The vitest *unit* config can't statically resolve node_modules packages from
// the repo root (workers are pulled in via dynamic import() below, like
// worker-guards.spec). Detection is structural (numeric `status`, else message),
// so we mimic the Gemini SDK's GoogleGenerativeAIFetchError shape with a plain
// Error carrying a `status` field instead of importing @google/generative-ai.
function fetchErr(message: string, status?: number): Error {
  return Object.assign(new Error(message), { status })
}

// pg-boss calls work() as either work(queue, handler) or work(queue, opts, handler).
// Capture the last function argument regardless of arity.
type HandlerFn = (job: {
  data: Record<string, unknown>
  retrycount?: number
  retrylimit?: number
}) => Promise<void>

function makeBoss() {
  let captured: HandlerFn | undefined
  return {
    work: vi.fn((..._args: unknown[]) => {
      captured = _args[_args.length - 1] as HandlerFn
    }),
    getHandler: () => captured!,
  }
}

const transient503 = () =>
  fetchErr(
    '[GoogleGenerativeAI Error]: [503 Service Unavailable] This model is currently experiencing high demand.',
    503,
  )
const terminal400 = () => fetchErr('[GoogleGenerativeAI Error]: [400 Bad Request]', 400)

// ─── R266a — isTransientGeminiError classification ────────────────────────────

describe('R266 — isTransientGeminiError: retryable upstream blips vs deterministic failures', () => {
  it('classifies overload / rate-limit / gateway 5xx + timeout statuses as transient', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isTransientGeminiError(fetchErr('x', status))).toBe(true)
    }
  })

  it('treats an aborted/timed-out request as transient', () => {
    expect(isTransientGeminiError(new Error('Request was aborted'))).toBe(true)
    expect(isTransientGeminiError(new Error('The operation timed out'))).toBe(true)
  })

  it('treats a fetch error with no HTTP status (network failure) as transient', () => {
    expect(isTransientGeminiError(new Error('fetch failed'))).toBe(true)
    expect(isTransientGeminiError(new TypeError('connect ECONNRESET 1.2.3.4:443'))).toBe(true)
  })

  it('classifies 4xx client errors (except 408/429) as terminal', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isTransientGeminiError(fetchErr('x', status))).toBe(false)
    }
  })

  it('classifies our own schema/parse failures as terminal', () => {
    // model drift failing zod, or invalid JSON — a retry fails identically
    expect(isTransientGeminiError(new Error('Invalid enum value'))).toBe(false)
    expect(isTransientGeminiError(new SyntaxError('Unexpected token < in JSON'))).toBe(false)
    expect(isTransientGeminiError('plain string')).toBe(false)
  })
})

// ─── R266b — bot worker derives isFinalAttempt from pg-boss retry metadata ────

describe('R266 — RespondToNewTicketWorker: isFinalAttempt threaded from retry metadata', () => {
  let respondTo: ReturnType<typeof vi.fn>
  let handler: HandlerFn

  beforeEach(async () => {
    respondTo = vi.fn().mockResolvedValue(undefined)
    const boss = makeBoss()
    const minimalQueue = {
      ready: vi.fn().mockResolvedValue(undefined),
      getBoss: vi.fn().mockReturnValue(boss),
    }
    const { RespondToNewTicketWorker } = await import(
      '../../../apps/api/src/modules/bot/workers/respond-to-new-ticket.worker'
    )
    const worker = new RespondToNewTicketWorker(minimalQueue as any, { respondTo } as any)
    await worker.onModuleInit()
    handler = boss.getHandler()
  })

  it('is false while retries remain (retrycount < retrylimit)', async () => {
    await handler({ data: { ticketId: 't1' }, retrycount: 0, retrylimit: 3 })
    expect(respondTo).toHaveBeenCalledWith('t1', { isFinalAttempt: false })
  })

  it('is true on the last attempt (retrycount === retrylimit)', async () => {
    await handler({ data: { ticketId: 't1' }, retrycount: 3, retrylimit: 3 })
    expect(respondTo).toHaveBeenCalledWith('t1', { isFinalAttempt: true })
  })
})

// ─── R266c — analysis workers rethrow transient, swallow terminal ─────────────

function makeAnalyzeWorkerCtx() {
  const boss = makeBoss()
  const queue = { ready: vi.fn().mockResolvedValue(undefined), getBoss: vi.fn().mockReturnValue(boss) }
  const db = {
    appConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    message: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'm1',
        body: 'help me',
        authorUserId: 'u1',
        analyzedAt: null,
        ticket: { id: 't1', isTicket: true, priority: 'NORMAL', ref: 1, title: 'T' },
      }),
    },
  }
  return { boss, queue, db }
}

describe('R266 — AnalyzeMessageWorker: retry transient, give up on terminal', () => {
  async function run(geminiError: unknown) {
    const { boss, queue, db } = makeAnalyzeWorkerCtx()
    const gemini = { analyzeMessage: vi.fn().mockRejectedValue(geminiError) }
    const { AnalyzeMessageWorker } = await import(
      '../../../apps/api/src/modules/ai/workers/analyze-message.worker'
    )
    const worker = new AnalyzeMessageWorker(queue as any, gemini as any, db as any)
    await worker.onModuleInit()
    return boss.getHandler()({ data: { messageId: 'm1', ticketId: 't1' } })
  }

  it('rethrows a transient 503 so pg-boss retries', async () => {
    await expect(run(transient503())).rejects.toThrow()
  })

  it('swallows a terminal error (no wasted retries)', async () => {
    await expect(run(terminal400())).resolves.toBeUndefined()
    await expect(run(new Error('Invalid enum value'))).resolves.toBeUndefined()
  })
})

function makeClassifyWorkerCtx() {
  const boss = makeBoss()
  const queue = { ready: vi.fn().mockResolvedValue(undefined), getBoss: vi.fn().mockReturnValue(boss) }
  const db = {
    appConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    ticket: {
      findUnique: vi.fn().mockResolvedValue({
        id: 't1',
        isTicket: true,
        topicId: null,
        title: 'T',
        messages: [{ body: 'help', authorUserId: 'u1', authorAgentId: null }],
      }),
    },
    topic: { findMany: vi.fn().mockResolvedValue([]) },
  }
  return { boss, queue, db }
}

describe('R266 — ClassifyTicketWorker: retry transient, give up on terminal', () => {
  async function run(geminiError: unknown) {
    const { boss, queue, db } = makeClassifyWorkerCtx()
    const gemini = { classifyAndScoreTicket: vi.fn().mockRejectedValue(geminiError) }
    const { ClassifyTicketWorker } = await import(
      '../../../apps/api/src/modules/ai/workers/classify-ticket.worker'
    )
    const worker = new ClassifyTicketWorker(queue as any, gemini as any, db as any)
    await worker.onModuleInit()
    return boss.getHandler()({ data: { ticketId: 't1' } })
  }

  it('rethrows a transient 503 so pg-boss retries', async () => {
    await expect(run(transient503())).rejects.toThrow()
  })

  it('swallows a terminal error (no wasted retries)', async () => {
    await expect(run(terminal400())).resolves.toBeUndefined()
    await expect(run(new SyntaxError('bad json'))).resolves.toBeUndefined()
  })
})
