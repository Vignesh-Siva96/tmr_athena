/**
 * email-delta-quote.spec — unit tests for outbound email content.
 *
 * Covers:
 *  - loadUndeliveredHistory delta query (confirmation path only — agent replies no longer quote)
 *  - renderQuotedHistory in the confirmation email ("Your message:" block)
 *  - agent/bot reply emails contain NO quoted history block
 *  - portal reply ack — "Received your response" email to the customer
 *  - markMessagesEmailed watermark
 */

import { describe, it, expect, vi } from 'vitest'
import { MailCaptureService } from '../../../apps/api/src/modules/test-utils/mail-capture.service'

const APP_CONFIG = {
  oauthProvider: null,
  oauthAccessTokenEnc: null,
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

/** Routes `db.message.findMany` based on which query it is: the undelivered-history
 *  delta query (where.customerEmailedAt set) vs. the thread-headers prior-ids query. */
function makeFindMany(undeliveredRows: unknown[], priorIdRows: unknown[] = []) {
  return vi.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
    if (args?.where && 'customerEmailedAt' in args.where) return Promise.resolve(undeliveredRows)
    return Promise.resolve(priorIdRows)
  })
}

async function makeService(db: Record<string, unknown>, mailCapture: MailCaptureService) {
  const { EmailService } = await import('../../../apps/api/src/modules/email/email.service')
  const config = { get: vi.fn().mockReturnValue(undefined) }
  const appConfigService = { get: vi.fn().mockResolvedValue(APP_CONFIG) }
  const tokenRefresher = { getValidAccessToken: vi.fn().mockResolvedValue('access-tok') }
  const dbObj = db as { attachment?: unknown }
  if (!dbObj.attachment) dbObj.attachment = { findMany: vi.fn().mockResolvedValue([]) }
  const files = { getAttachmentBuffer: vi.fn() }
  return new EmailService(
    config as never,
    appConfigService as never,
    db as never,
    tokenRefresher as never,
    files as never,
    mailCapture,
  )
}

describe('loadUndeliveredHistory — delta query (confirmation path)', () => {
  it('confirmation queries with delta filters, asc order, and no excludeMessageId', async () => {
    const findMany = makeFindMany([])
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    await service.sendTicketConfirmation(makeTicket() as never, APP_CONFIG as never)

    const call = findMany.mock.calls.find((c) => 'customerEmailedAt' in (c[0] as { where: Record<string, unknown> }).where)!
    const args = call[0] as { where: Record<string, unknown>; orderBy: unknown }
    expect(args.where).toMatchObject({
      ticketId: 'tkt-1',
      deletedAt: null,
      customerEmailedAt: null,
      isInternal: false,
      type: 'REPLY',
      OR: [{ sentVia: null }, { sentVia: { not: 'EMAIL' } }],
    })
    expect(args.where.id).toBeUndefined()
    expect(args.orderBy).toEqual({ createdAt: 'asc' })
  })
})

describe('renderQuotedHistory — confirmation email only', () => {
  it('quotes the customer description in the confirmation, prefixed with "> "', async () => {
    const rows = [
      {
        id: 'm1',
        body: 'Line one\nLine two',
        createdAt: new Date('2026-06-10T12:00:00Z'),
        authorBotName: null,
        authorUser: { name: 'Alice' },
        authorAgent: null,
      },
    ]
    const findMany = makeFindMany(rows)
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    const result = await service.sendTicketConfirmation(makeTicket() as never, APP_CONFIG as never)

    expect(result.quotedMessageIds).toEqual(['m1'])
    const text = mailCapture.list()[0].text!
    expect(text).toContain('Your message:')
    expect(text).toContain('On Jun 10, 2026, Alice wrote:')
    expect(text).toContain('> Line one')
    expect(text).toContain('> Line two')
  })

  it('returns an empty quoted block and omits the section when the delta is empty', async () => {
    const findMany = makeFindMany([])
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    const result = await service.sendTicketConfirmation(makeTicket() as never, APP_CONFIG as never)

    expect(result.quotedMessageIds).toEqual([])
    const text = mailCapture.list()[0].text!
    expect(text).not.toContain('Your message:')
    expect(text).not.toContain('---')
  })
})

describe('sendAgentReply — no quoted history', () => {
  it('agent reply contains no "--- Previous messages:" block even when prior messages exist', async () => {
    const rows = [
      {
        id: 'm-bot',
        body: 'Here is the answer',
        createdAt: new Date('2026-06-11T09:00:00Z'),
        authorBotName: 'Athena',
        authorUser: null,
        authorAgent: null,
      },
    ]
    const findMany = makeFindMany(rows)
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    const result = await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-triggering', body: 'Agent reply body', authorAgent: null } as never,
      APP_CONFIG as never,
    )

    expect(result.quotedMessageIds).toEqual([])
    const text = mailCapture.list()[0].text!
    expect(text).toContain('Agent reply body')
    expect(text).not.toContain('--- Previous messages:')
    expect(text).not.toContain('> Here is the answer')
  })

  it('agent reply contains no quoting even when there are prior undelivered agent messages', async () => {
    const rows = [
      {
        id: 'm-agent',
        body: 'Following up',
        createdAt: new Date('2026-06-12T09:00:00Z'),
        authorBotName: null,
        authorUser: null,
        authorAgent: { name: 'Bob' },
      },
    ]
    const findMany = makeFindMany(rows)
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    const result = await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-triggering', body: 'New reply', authorAgent: null } as never,
      APP_CONFIG as never,
    )

    expect(result.quotedMessageIds).toEqual([])
    const text = mailCapture.list()[0].text!
    expect(text).not.toContain('--- Previous messages:')
    expect(text).not.toContain('Bob wrote:')
    expect(text).toContain('New reply')
  })
})

describe('sendPortalReplyAck — "Received your response" email to customer', () => {
  it('sends to the customer (not support) with "Received your response" heading + message body', async () => {
    const findMany = makeFindMany([])
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    await service.sendPortalReplyAck(
      makeTicket() as never,
      { body: 'Here is my follow-up question.' },
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    // To: customer, not support
    const to = Array.isArray(sent.to) ? sent.to[0] : sent.to
    expect(to).toBe('customer@example.com')
    expect(sent.text).toContain('Received your response:')
    expect(sent.text).toContain('Here is my follow-up question.')
  })

  it('sets Reply-To to the support address', async () => {
    const findMany = makeFindMany([])
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    await service.sendPortalReplyAck(
      makeTicket() as never,
      { body: 'My message.' },
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    expect(sent.headers?.['Reply-To']).toBe('support@test.local')
  })

  it('includes the customer name in the greeting', async () => {
    const findMany = makeFindMany([])
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    await service.sendPortalReplyAck(
      makeTicket({ user: { email: 'c@example.com', name: 'Alice' } }) as never,
      { body: 'Question here.' },
      APP_CONFIG as never,
    )

    const text = mailCapture.list()[0].text!
    expect(text).toContain('Hi Alice,')
  })

  it('uses "there" when customer name is null', async () => {
    const findMany = makeFindMany([])
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    await service.sendPortalReplyAck(
      makeTicket({ user: { email: 'c@example.com', name: null } }) as never,
      { body: 'Question here.' },
      APP_CONFIG as never,
    )

    const text = mailCapture.list()[0].text!
    expect(text).toContain('Hi there,')
  })

  it('returns an RFC Message-ID string (dedup stamp)', async () => {
    const findMany = makeFindMany([])
    const db = { message: { findMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    const msgId = await service.sendPortalReplyAck(
      makeTicket() as never,
      { body: 'My message.' },
      APP_CONFIG as never,
    )

    expect(typeof msgId).toBe('string')
    expect(msgId.length).toBeGreaterThan(0)
  })
})

describe('markMessagesEmailed — idempotent watermark', () => {
  it('marks only un-marked rows for the given ids', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const db = { message: { findMany: makeFindMany([]), updateMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    await service.markMessagesEmailed(['m1', 'm2'])

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, customerEmailedAt: null },
      data: { customerEmailedAt: expect.any(Date) },
    })
  })

  it('does nothing for an empty id list', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const db = { message: { findMany: makeFindMany([]), updateMany } }
    const mailCapture = new MailCaptureService()
    const service = await makeService(db, mailCapture)

    await service.markMessagesEmailed([])

    expect(updateMany).not.toHaveBeenCalled()
  })
})
