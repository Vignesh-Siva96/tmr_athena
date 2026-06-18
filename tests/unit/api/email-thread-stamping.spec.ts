/**
 * email-thread-stamping.spec — unit tests for Gmail thread-id capture (R217).
 *
 * The Gmail REST API only threads a sent message when the request body carries
 * the conversation's `threadId` — matching References/In-Reply-To headers alone
 * are not enough (unlike SMTP). Portal-originated tickets have no
 * `externalThreadId` until an inbound email arrives, so without capturing the
 * threadId Gmail returns on the FIRST outbound and stamping it on the ticket,
 * every confirmation + agent reply would start its own Gmail thread.
 *
 * Regression catalogue:
 *   R217 — Gmail API send returns threadId; EmailService stamps it onto the
 *          ticket (when externalThreadId is null) so subsequent sends thread.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type AnyFn = ReturnType<typeof vi.fn>

const GOOGLE_CONFIG = {
  oauthProvider: 'GOOGLE',
  oauthAccessTokenEnc: 'enc-token',
  oauthEmail: 'support@test.local',
  emailDisplayName: 'TMR',
  appName: 'TMR',
} as const

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tkt-1',
    ref: 'ABCDEFG',
    title: 'Need help',
    emailThreadId: 'et-1',
    externalThreadId: null,
    user: { email: 'customer@example.com', name: 'Customer' },
    ...overrides,
  }
}

async function makeService(db: Record<string, unknown>) {
  const { EmailService } = await import(
    '../../../apps/api/src/modules/email/email.service'
  )
  const config = { get: vi.fn().mockReturnValue(undefined) }
  const appConfigService = { get: vi.fn().mockResolvedValue(GOOGLE_CONFIG) }
  const tokenRefresher = { getValidAccessToken: vi.fn().mockResolvedValue('access-tok') }
  // mailCapture omitted (undefined) so send() takes the Gmail API path, not capture.
  return new EmailService(
    config as never,
    appConfigService as never,
    db as never,
    tokenRefresher as never,
  )
}

describe('R217 — Gmail thread-id capture and stamping', () => {
  let fetchMock: AnyFn

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'gmail-msg-1', threadId: 'gmail-thread-xyz' }),
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stamps the returned threadId onto a ticket that has none', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = {
      message: { findMany: vi.fn().mockResolvedValue([]) },
      ticket: { updateMany },
    }
    const service = await makeService(db)

    await service.sendAgentReply(makeTicket(), { body: 'hello' } as never, GOOGLE_CONFIG as never)

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'tkt-1', externalThreadId: null },
      data: { externalThreadId: 'gmail-thread-xyz' },
    })
    // First send on a thread-less ticket must NOT carry a threadId in the request.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.threadId).toBeUndefined()
    expect(body.raw).toBeTruthy()
  })

  it('passes the existing threadId to Gmail when the ticket already has one', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const db = {
      message: { findMany: vi.fn().mockResolvedValue([]) },
      ticket: { updateMany },
    }
    const service = await makeService(db)

    await service.sendAgentReply(
      makeTicket({ externalThreadId: 'existing-thread' }),
      { body: 'hello' } as never,
      GOOGLE_CONFIG as never,
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.threadId).toBe('existing-thread')
  })

  it('confirmation email also stamps the threadId (portal-originated tickets)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = {
      message: { findMany: vi.fn().mockResolvedValue([]) },
      ticket: { updateMany },
    }
    const service = await makeService(db)

    await service.sendTicketConfirmation(makeTicket() as never, GOOGLE_CONFIG as never)

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'tkt-1', externalThreadId: null },
      data: { externalThreadId: 'gmail-thread-xyz' },
    })
  })
})

describe('R218 — real Gmail-assigned Message-ID capture and References chaining', () => {
  let fetchMock: AnyFn
  const ASSIGNED_ID = '<CAM0uQc4g-RpXyZ@mail.gmail.com>'

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/messages/send')) {
        return {
          ok: true,
          json: async () => ({ id: 'gmail-msg-1', threadId: 'gmail-thread-xyz' }),
          text: async () => '',
        }
      }
      // Follow-up GET /messages/{id}?format=metadata&metadataHeaders=Message-ID
      return {
        ok: true,
        json: async () => ({ payload: { headers: [{ name: 'Message-ID', value: ASSIGNED_ID }] } }),
        text: async () => '',
      }
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the Gmail-assigned Message-ID for the confirmation, not the synthetic root', async () => {
    const db = {
      message: { findMany: vi.fn().mockResolvedValue([]) },
      ticket: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    const service = await makeService(db)

    const result = await service.sendTicketConfirmation(makeTicket() as never, GOOGLE_CONFIG as never)

    expect(result.messageId).toBe(ASSIGNED_ID)
  })

  it('builds References/In-Reply-To for an agent reply from the real stored confirmation id, not the synthetic one', async () => {
    const db = {
      message: {
        // The buildThreadHeaders query (where.messageId set) simulates the confirmation's
        // SYSTEM_EVENT row having already persisted the real id; the undelivered-history
        // query (where.customerEmailedAt set) returns no quotable messages.
        findMany: vi.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
          if (args?.where && 'customerEmailedAt' in args.where) return Promise.resolve([])
          return Promise.resolve([{ messageId: ASSIGNED_ID }])
        }),
      },
      ticket: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }
    const service = await makeService(db)

    const result = await service.sendAgentReply(
      makeTicket({ externalThreadId: 'gmail-thread-xyz' }),
      { body: 'hello' } as never,
      GOOGLE_CONFIG as never,
    )

    const sendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/messages/send'))!
    const body = JSON.parse((sendCall[1] as { body: string }).body)
    const mime = Buffer.from(body.raw as string, 'base64url').toString('utf-8')

    expect(mime).toContain(`In-Reply-To: ${ASSIGNED_ID}`)
    expect(mime).toContain(`References: ${ASSIGNED_ID}`)
    expect(mime).not.toContain('ticket-et-1@')
    // The reply's own returned id is also the Gmail-assigned one, not the synthetic generated id
    expect(result.messageId).toBe(ASSIGNED_ID)
  })
})
