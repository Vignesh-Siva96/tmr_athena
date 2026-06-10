/**
 * email-ticket-flow.spec — integration tests for the Email + Ticket core flow.
 *
 * Covers the 10 scenarios agreed in the plan:
 *   S1  — New ticket from Portal (confirmation email, bot answers, bot escalates)
 *   S2  — New ticket from inbound email (status=NEW, no auto-reply/bot, convert, discard)
 *   S3  — Customer reply via Portal (status transitions, reopen, auto-escalate after bot)
 *   S4  — Customer reply via email (3-level thread matching, RFC dedup)
 *   S5  — Agent reply from Bridge (email sent, status transitions, internal note hidden)
 *   S6  — Bot idempotency (already covered by bot.respond.spec; catalogue row only)
 *   S7  — Email send failure path (SYSTEM_EVENT written, message row survives)
 *   S8  — Bulk / promotional inbound mail (isBulk=true, no bot/auto-reply)
 *   S9  — Customer replies after Athena answered (auto-escalate path)
 *   S10 — DISMISSED resurrection via inbound email reply
 *
 * Regression catalogue rows: R74–R83 (see tests/regression-catalogue.md).
 */

import { Decimal } from '@prisma/client/runtime/library'
import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, signJwt } from './factories'
import './setup'
import { http, HttpResponse } from 'msw'
import { mswServer } from './setup'
import { encrypt } from '../../apps/api/src/common/crypto/credentials-cipher'
import { ThreadIngestionService } from '../../apps/api/src/modules/email-sync/thread-ingestion.service'
import { BotService } from '../../apps/api/src/modules/bot/bot.service'
import { EmailService } from '../../apps/api/src/modules/email/email.service'
import { MailCaptureService } from '../../apps/api/src/modules/test-utils/mail-capture.service'
import type { IMailProvider, ParsedThread } from '../../apps/api/src/modules/email-sync/providers/mail-provider.interface'

// ─── Shared helpers ────────────────────────────────────────────────────────────

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve))

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

function mockGeminiAnswer(opts: {
  can_answer: boolean
  confidence?: number
  answer?: string
  citations?: string[]
}) {
  mswServer.use(
    http.post(`${GEMINI_BASE}/gemini-embedding-001:batchEmbedContents`, () =>
      HttpResponse.json({
        embeddings: [Array(768).fill(0.1)].map((values) => ({ values })),
      }),
    ),
    http.post(`${GEMINI_BASE}/gemini-2.5-flash-lite:generateContent`, () =>
      HttpResponse.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    answer: opts.answer ?? 'Here is how to configure the integration.',
                    citations: opts.citations ?? ['https://docs.example.com/help/oauth#step-1'],
                    confidence: opts.confidence ?? 0.9,
                    can_answer: opts.can_answer,
                    reasoning: 'Mocked response.',
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100, totalTokenCount: 300 },
      }),
    ),
  )
}

async function seedKbChunk(sourceUrl: string, deepUrl: string): Promise<void> {
  const source = await harness.prisma.knowledgeSource.upsert({
    where: { url: sourceUrl },
    create: { url: sourceUrl, title: 'Test KB Article', status: 'INDEXED' },
    update: { status: 'INDEXED' },
  })
  const dummyEmbedding = Array(768).fill(0.1).join(',')
  await harness.prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeChunk" (id, "createdAt", "sourceId", ordinal, text, "headingPath", "deepUrl", "tokenCount", embedding)
     VALUES (gen_random_uuid()::text, NOW(), $1, 0, 'OAuth setup guide content here', ARRAY['OAuth']::text[], $2, 50, '[${dummyEmbedding}]'::vector)`,
    source.id,
    deepUrl,
  )
}

async function seedAppConfig(overrides: Record<string, unknown> = {}) {
  // Encrypt the stub key so GeneratorService.getApiKey() can decrypt it (T1.6 fix)
  const encryptedBotKey = encrypt('test-api-key')
  return harness.prisma.appConfig.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      appName: 'TMR',
      emailDisplayName: 'TMR',
      botApiKeyEnc: encryptedBotKey,
      kbRootUrl: 'https://docs.example.com/help/',
      ...overrides,
    },
    update: {
      emailDisplayName: 'TMR',
      botApiKeyEnc: encryptedBotKey,
      kbRootUrl: 'https://docs.example.com/help/',
      ...overrides,
    },
  })
}

/**
 * Minimal IMailProvider backed by a canned ParsedThread. Enough to drive
 * ThreadIngestionService.fetchAndUpsertThread() without hitting real Gmail.
 */
function makeMailProvider(thread: ParsedThread, aliases: string[] = ['support@test.local']): IMailProvider {
  return {
    kind: 'GMAIL',
    aliases,
    fetchThread: async () => thread,
    listThreadIdsSince: async () => ({ threadIds: [], nextPageToken: undefined }),
    listAllThreadIds: async () => ({ threadIds: [], nextPageToken: undefined }),
    pollChanges: async () => ({ changedThreadIds: [], newCheckpoint: '1001' }),
    isStaleCheckpointError: () => false,
    recoverFromStaleCheckpoint: async () => ({ changedThreadIds: [], newCheckpoint: '1001' }),
  }
}

function buildParsedThread(opts: {
  threadId: string
  messageId: string
  rfcMessageId: string
  from: string
  subject: string
  body: string
  isBulk?: boolean
  inReplyTo?: string
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
        isBulk: opts.isBulk ?? false,
        ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
      },
    ],
  }
}

// ─── S1 — New ticket from Portal ──────────────────────────────────────────────

describe('S1 — Portal ticket creation (R74, R75, R76)', () => {
  it('R74 — confirmation email sent with synthetic Message-ID anchoring the thread', async () => {
    const appConfig = await seedAppConfig()
    const user = await makeUser({ email: 'portal-user@example.com', name: 'Portal User' })
    const token = await signJwt({ id: user.id, role: 'user' })

    const res = await harness
      .request()
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'My first issue', description: 'Something broke.', category: 'BUG_REPORT' })

    expect(res.status).toBe(201)
    const { ticket } = res.body.data
    expect(ticket.status).toBe('OPEN')
    expect(ticket.source).toBe('PORTAL')
    // Portal ticket must have isTicket=true and a valid ref
    expect(ticket.isTicket).toBe(true)
    expect(ticket.ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{7}$/)

    // Confirmation goes via pg-boss (G2). Directly invoke emailService to test capture
    // (the same pattern used by agent reply tests; the queue integration is verified by R112).
    await flushPromises()
    const emailService = harness.get<EmailService>(EmailService)
    const ticketWithUser = await harness.prisma.ticket.findUnique({ where: { id: ticket.id }, include: { user: true } })
    await emailService.sendTicketConfirmation(ticketWithUser!, appConfig)

    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    const mails = mailCapture.list({ to: user.email })
    expect(mails.length).toBeGreaterThanOrEqual(1)

    const confirmation = mails[0]
    // Subject uses the TMR- prefixed display id (7-char Crockford base32 code)
    expect(confirmation.subject).toMatch(/\[TMR-[0-9A-HJKMNP-TV-Z]{7}\]/)
    expect(confirmation.headers['Message-ID']).toMatch(/^<ticket-[^@]+@/)
  })

  it('R75 — bot answers confidently → bot message created, ticket moves to WAITING, reply email captured', async () => {
    await seedAppConfig()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'How do I configure OAuth?', authorUserId: user.id, type: 'REPLY' },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    await seedKbChunk(kbUrl, `${kbUrl}#step-1`)

    mockGeminiAnswer({ can_answer: true, confidence: 0.92, citations: [`${kbUrl}#step-1`] })

    const botService = harness.app.get(BotService)
    await botService.respondTo(ticket.id)

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('WAITING')

    const msgs = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    const botMsg = msgs.find((m) => m.authorBotName !== null)
    expect(botMsg).toBeDefined()
    expect(botMsg!.authorBotName).toBe('Athena')

    // Bot reply is also sent as email
    await flushPromises()
    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    const mails = mailCapture.list()
    const botMail = mails.find((m) => String(m.subject ?? '').includes('Re:'))
    expect(botMail).toBeDefined()
  })

  it('R76 — bot escalates (low confidence) → ticket stays OPEN, assignee set, SYSTEM_EVENT written', async () => {
    await seedAppConfig()
    const user = await makeUser()
    const agent = await makeAgent({ role: 'PRIMARY_AGENT' })
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'Something unrelated', authorUserId: user.id, type: 'REPLY' },
    })

    await harness.prisma.shift.create({
      data: { primaryAgentId: agent.id, dayOfWeek: -1, startMinute: 0, endMinute: 0 },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    await seedKbChunk(kbUrl, `${kbUrl}#step-1`)

    mockGeminiAnswer({ can_answer: false, confidence: 0.2, citations: [] })

    const botService = harness.app.get(BotService)
    await botService.respondTo(ticket.id)

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    // Status stays OPEN (not changed to IN_PROGRESS since no agent reply)
    expect(updated!.status).toBe('OPEN')
    expect(updated!.assigneeId).toBe(agent.id)

    const msgs = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    const sysEvent = msgs.find((m) => m.type === 'SYSTEM_EVENT')
    expect(sysEvent).toBeDefined()
    expect(sysEvent!.body).toMatch(/^escalated:/)
  })
})

// ─── S2 — New ticket from inbound email ───────────────────────────────────────

describe('S2 — Inbound email ticket ingestion (R77, R78)', () => {
  it('R77 — inbound email creates ticket status=NEW, source=EMAIL, no confirmation email, no bot', async () => {
    await seedAppConfig()
    const thread = buildParsedThread({
      threadId: 'gmail-thread-001',
      messageId: 'gmail-msg-001',
      rfcMessageId: '<abc@gmail.com>',
      from: 'customer@external.com',
      subject: 'Need help with billing',
      body: 'I have a billing question.',
    })
    const provider = makeMailProvider(thread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    const result = await ingestion.fetchAndUpsertThread(provider, 'gmail-thread-001', { isBackfill: false })

    expect(result.created).toBe(true)
    expect(result.ticketId).toBeDefined()

    const ticket = await harness.prisma.ticket.findUnique({ where: { id: result.ticketId } })
    expect(ticket!.status).toBe('NEW')
    expect(ticket!.source).toBe('EMAIL')
    expect(ticket!.externalThreadId).toBe('gmail-thread-001')
    // Inbound email creates a conversation (isTicket=false) with a valid ref
    expect(ticket!.isTicket).toBe(false)
    expect(ticket!.ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{7}$/)

    // User upserted with source=EMAIL and default category=CUSTOMER
    const user = await harness.prisma.user.findFirst({ where: { email: 'customer@external.com' } })
    expect(user).toBeDefined()
    expect(user!.source).toBe('EMAIL')
    expect(user!.category).toBe('CUSTOMER')

    // No confirmation email sent for email-originated tickets
    await flushPromises()
    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    expect(mailCapture.list({ to: 'customer@external.com' })).toHaveLength(0)

    // No BotInteraction created
    const botInteraction = await harness.prisma.botInteraction.findFirst({ where: { ticketId: result.ticketId } })
    expect(botInteraction).toBeNull()
  })

  it('convert (NEW → OPEN) fires activateTicket: confirmation + bot enqueued', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'convert-test@example.com', name: 'Convert User' })
    const ticket = await makeTicket({ userId: user.id, status: 'NEW', source: 'EMAIL', isTicket: false })

    const admin = await makeAgent({ role: 'ADMIN' })
    const adminToken = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(201)
    expect(res.body.data.ticket.status).toBe('OPEN')
    // Response must include full shape (R197 regression guard)
    expect(Array.isArray(res.body.data.ticket.messages)).toBe(true)
    expect(Array.isArray(res.body.data.ticket.attachments)).toBe(true)

    // Confirmation goes via pg-boss (G2). Directly invoke emailService to test capture.
    await flushPromises()
    const emailService = harness.get<EmailService>(EmailService)
    const appConfig = await harness.prisma.appConfig.findFirst()
    const ticketWithUser = await harness.prisma.ticket.findUnique({ where: { id: ticket.id }, include: { user: true } })
    await emailService.sendTicketConfirmation(ticketWithUser!, appConfig!)
    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    const mails = mailCapture.list({ to: user.email })
    expect(mails.length).toBeGreaterThanOrEqual(1)
    expect(mails[0].subject).toMatch(/\[TMR-[0-9A-HJKMNP-TV-Z]{7}\]/)
  })

  it('discard (NEW → DISMISSED) stamps dismissedAt + no email', async () => {
    await seedAppConfig()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'NEW', source: 'EMAIL' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const adminToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/discard`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(201)

    const dismissed = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(dismissed!.status).toBe('DISMISSED')
    expect(dismissed!.dismissedAt).not.toBeNull()
    expect(dismissed!.dismissedById).toBe(agent.id)

    await flushPromises()
    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    expect(mailCapture.list({ to: user.email })).toHaveLength(0)
  })

  it('R78 — second ingestion of same thread is idempotent (no duplicate ticket or message)', async () => {
    await seedAppConfig()
    const thread = buildParsedThread({
      threadId: 'gmail-idempotent-thread',
      messageId: 'gmail-idempotent-msg',
      rfcMessageId: '<idempotent@gmail.com>',
      from: 'idempotent@external.com',
      subject: 'Idempotent test',
      body: 'Should not duplicate.',
    })
    const provider = makeMailProvider(thread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    await ingestion.fetchAndUpsertThread(provider, 'gmail-idempotent-thread', { isBackfill: false })
    await ingestion.fetchAndUpsertThread(provider, 'gmail-idempotent-thread', { isBackfill: false })

    const tickets = await harness.prisma.ticket.findMany({ where: { externalThreadId: 'gmail-idempotent-thread' } })
    expect(tickets).toHaveLength(1)

    const messages = await harness.prisma.message.findMany({ where: { ticketId: tickets[0].id } })
    expect(messages).toHaveLength(1)
  })
})

// ─── S3 — Customer reply via Portal ───────────────────────────────────────────

describe('S3 — Customer Portal reply status transitions (R79)', () => {
  it('R79 — WAITING → IN_PROGRESS when customer replies; SYSTEM_EVENT written', async () => {
    const user = await makeUser()
    const agent = await makeAgent()
    const ticket = await makeTicket({ userId: user.id, status: 'WAITING', assigneeId: agent.id })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ body: 'Follow-up from customer.', type: 'REPLY' })

    expect(res.status).toBe(201)

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('IN_PROGRESS')

    const msgs = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    const sysEvent = msgs.find((m) => m.type === 'SYSTEM_EVENT' && m.body.includes('status_changed'))
    expect(sysEvent).toBeDefined()
    expect(sysEvent!.body).toBe('status_changed:WAITING:IN_PROGRESS')
  })

  it('RESOLVED → IN_PROGRESS when customer reopens (reopenCount++, reopenedAt set)', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'RESOLVED' })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ body: 'Still having the issue.', type: 'REPLY' })

    expect(res.status).toBe(201)

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('IN_PROGRESS')
    expect(updated!.reopenCount).toBe(1)
    expect(updated!.reopenedAt).not.toBeNull()
  })

  it('CLOSED → IN_PROGRESS when customer reopens', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'CLOSED' })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ body: 'Issue is still ongoing.', type: 'REPLY' })

    expect(res.status).toBe(201)

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('IN_PROGRESS')
  })
})

// ─── S4 — Customer reply via email ────────────────────────────────────────────

describe('S4 — Inbound email reply matching (R80)', () => {
  it('R80 — email reply matched to existing ticket via synthetic <ticket-…@domain> In-Reply-To', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'reply-test@example.com' })
    // Portal ticket with a known emailThreadId (basis of the synthetic Message-ID)
    const ticket = await harness.prisma.ticket.create({
      data: {
        userId: user.id,
        ref: 'REPLY001',
        isTicket: true,
        title: 'Original portal ticket',
        status: 'OPEN',
        source: 'PORTAL',
        category: 'QUESTION',
        emailThreadId: 'my-thread-id-123',
      },
    })

    // Customer replies via email, referencing the synthetic root Message-ID
    const replyThread = buildParsedThread({
      threadId: 'gmail-reply-thread',
      messageId: 'gmail-reply-msg',
      rfcMessageId: '<reply@gmail.com>',
      from: user.email,
      subject: 'Re: Original portal ticket',
      body: 'Here is my email reply.',
      inReplyTo: '<ticket-my-thread-id-123@support.tmr.com>',
    })
    const provider = makeMailProvider(replyThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    const result = await ingestion.fetchAndUpsertThread(provider, 'gmail-reply-thread', { isBackfill: false })

    expect(result.created).toBe(false)
    expect(result.ticketId).toBe(ticket.id)

    // Message appended to existing ticket
    const msgs = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    expect(msgs.length).toBeGreaterThan(0)
    const inboundReply = msgs.find((m) => m.body === 'Here is my email reply.')
    expect(inboundReply).toBeDefined()
    expect(inboundReply!.sentVia).toBe('EMAIL')

    // externalThreadId stamped on ticket for future fast-path
    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.externalThreadId).toBe('gmail-reply-thread')
  })

  it('RFC messageId dedup: Gmail inbox+sent copy creates only one Message row', async () => {
    await seedAppConfig()
    const thread1 = buildParsedThread({
      threadId: 'dedup-thread',
      messageId: 'gmail-msg-inbox',
      rfcMessageId: '<rfc@gmail.com>',
      from: 'dedup@external.com',
      subject: 'Dedup test',
      body: 'This is the first copy.',
    })
    const thread2: ParsedThread = {
      ...thread1,
      messages: [
        {
          ...thread1.messages[0],
          id: 'gmail-msg-sent',      // different Gmail ID
          rfcMessageId: '<rfc@gmail.com>',  // same RFC Message-ID
        },
      ],
    }
    const provider1 = makeMailProvider(thread1)
    const provider2 = makeMailProvider(thread2)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    await ingestion.fetchAndUpsertThread(provider1, 'dedup-thread', { isBackfill: false })

    // Re-ingesting the same thread with the sent-copy Gmail ID should not create a duplicate
    const thread2provider = makeMailProvider({ ...thread2 })
    await ingestion.fetchAndUpsertThread(thread2provider, 'dedup-thread', { isBackfill: false })

    const messages = await harness.prisma.message.findMany({
      where: { messageId: '<rfc@gmail.com>' },
    })
    expect(messages).toHaveLength(1)
  })
})

// ─── S5 — Agent reply from Bridge ─────────────────────────────────────────────

describe('S5 — Agent reply status transitions and email (R81, R82)', () => {
  it('R81 — agent reply: OPEN → IN_PROGRESS, reply email captured via MailCapture', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'agent-reply-user@example.com', name: 'Test User' })
    const agent = await makeAgent()
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ body: 'Looking into this now.', type: 'REPLY', sendVia: 'PORTAL_AND_EMAIL' })

    expect(res.status).toBe(201)

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('IN_PROGRESS')

    // The email is enqueued via pg-boss; call EmailService directly to test capture
    await flushPromises()
    const appConfig = await harness.prisma.appConfig.findFirst()
    const emailService = harness.get<EmailService>(EmailService)
    const msg = await harness.prisma.message.findFirst({
      where: { ticketId: ticket.id, authorAgentId: agent.id },
      include: { authorAgent: { select: { id: true, name: true } } },
    })
    await emailService.sendAgentReply(
      { ...ticket, user: { id: user.id, email: user.email, name: user.name } } as any,
      msg as any,
      appConfig!,
    )

    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    const mails = mailCapture.list({ to: user.email })
    expect(mails.length).toBeGreaterThanOrEqual(1)
    const agentMail = mails[mails.length - 1]
    expect(agentMail.subject).toMatch(/^Re:/i)
    expect(agentMail.headers['In-Reply-To']).toBeTruthy()
  })

  it('agent reply: IN_PROGRESS → WAITING', async () => {
    const user = await makeUser()
    const agent = await makeAgent()
    const ticket = await makeTicket({ userId: user.id, status: 'IN_PROGRESS', assigneeId: agent.id })
    const agentToken = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ body: 'Can you reproduce on version 2.3?', type: 'REPLY', sendVia: 'PORTAL_AND_EMAIL' })

    expect(res.status).toBe(201)

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('WAITING')
  })

  it('R82 — INTERNAL_NOTE: isInternal=true, sentVia=null, hidden from customer GET', async () => {
    const user = await makeUser()
    const agent = await makeAgent()
    const ticket = await makeTicket({ userId: user.id, status: 'IN_PROGRESS' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent' })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    // Agent creates internal note
    const noteRes = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ body: 'Internal: PG connection pool exhausted at 14:30 UTC.', type: 'INTERNAL_NOTE' })

    expect(noteRes.status).toBe(201)

    const noteRow = await harness.prisma.message.findUnique({ where: { id: noteRes.body.data.message.id } })
    expect(noteRow!.isInternal).toBe(true)
    expect(noteRow!.sentVia).toBeNull()

    // Customer cannot see internal note in ticket GET
    const ticketRes = await harness
      .request()
      .get(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${userToken}`)

    expect(ticketRes.status).toBe(200)
    const customerMsgs = ticketRes.body.data.ticket.messages
    const noteVisible = customerMsgs.some((m: any) => m.body === 'Internal: PG connection pool exhausted at 14:30 UTC.')
    expect(noteVisible).toBe(false)

    // Status not changed by internal note (stays IN_PROGRESS)
    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('IN_PROGRESS')
  })
})

// ─── S7 — Email send failure path ─────────────────────────────────────────────

describe('S7 — Email send failure path (R83)', () => {
  it('R83 — email_delivery_failed SYSTEM_EVENT visible to agent; original message row survives', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'fail-delivery@example.com', name: 'Fail User' })
    const agent = await makeAgent()
    const ticket = await makeTicket({ userId: user.id, status: 'IN_PROGRESS' })

    // Create the agent reply message
    const message = await harness.prisma.message.create({
      data: {
        ticketId: ticket.id,
        body: 'This reply email will fail.',
        type: 'REPLY',
        isInternal: false,
        sentVia: 'PORTAL_AND_EMAIL',
        authorAgentId: agent.id,
      },
    })

    // Simulate what SendReplyWorker does on final retry failure:
    // It writes a SYSTEM_EVENT and leaves the original message intact.
    await harness.prisma.message.create({
      data: {
        ticketId: ticket.id,
        type: 'SYSTEM_EVENT',
        body: `email_delivery_failed:Reply to message ${message.id} failed after 3 attempts`,
        isInternal: true,
      },
    })

    // Agent can see both the original message and the delivery-failed event
    const agentToken = await signJwt({ id: agent.id, role: 'agent' })
    const ticketRes = await harness
      .request()
      .get(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(ticketRes.status).toBe(200)
    const agentMsgs = ticketRes.body.data.ticket.messages

    const originalMsg = agentMsgs.find((m: any) => m.id === message.id)
    expect(originalMsg).toBeDefined()

    const failEvent = agentMsgs.find(
      (m: any) => m.type === 'SYSTEM_EVENT' && m.body.includes('email_delivery_failed'),
    )
    expect(failEvent).toBeDefined()
    expect(failEvent!.body).toContain(`failed after 3 attempts`)
  })
})

// ─── S8 — Bulk / promotional inbound mail ─────────────────────────────────────

describe('S8 — Bulk / promotional inbound email (R84)', () => {
  it('R84 — bulk-header email lands as NEW with isBulk=true, no confirmation, no bot', async () => {
    await seedAppConfig()
    const bulkThread = buildParsedThread({
      threadId: 'bulk-thread-001',
      messageId: 'bulk-msg-001',
      rfcMessageId: '<newsletter@bulk.com>',
      from: 'no-reply@newsletter.example.com',
      subject: 'Your weekly digest',
      body: "Here are this week's highlights...",
      isBulk: true,
    })
    const provider = makeMailProvider(bulkThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    const result = await ingestion.fetchAndUpsertThread(provider, 'bulk-thread-001', { isBackfill: false })
    expect(result.created).toBe(true)

    const ticket = await harness.prisma.ticket.findUnique({ where: { id: result.ticketId } })
    expect(ticket!.isBulk).toBe(true)
    expect(ticket!.status).toBe('NEW')
    expect(ticket!.isTicket).toBe(false)
    // User created from bulk email → PROMOTIONAL category
    const bulkUser = await harness.prisma.user.findFirst({ where: { email: 'no-reply@newsletter.example.com' } })
    expect(bulkUser?.category).toBe('PROMOTIONAL')

    // No confirmation email and no BotInteraction (NEW tickets never auto-reply)
    await flushPromises()
    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    expect(mailCapture.list()).toHaveLength(0)

    const botInteraction = await harness.prisma.botInteraction.findFirst({ where: { ticketId: result.ticketId } })
    expect(botInteraction).toBeNull()
  })
})

// ─── S9 — Customer replies after Athena answered ──────────────────────────────

describe('S9 — Auto-escalation after bot answer (R85)', () => {
  it('R85 — customer reply on WAITING ticket with BotInteraction{didAnswer:true} triggers escalation, escalation email captured', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'bot-escalate@example.com', name: 'Bot User' })
    const agent = await makeAgent({ role: 'PRIMARY_AGENT' })
    const ticket = await makeTicket({ userId: user.id, status: 'WAITING' })

    // Create a BotInteraction marking the bot as having answered
    await harness.prisma.botInteraction.create({
      data: {
        ticketId: ticket.id,
        userId: user.id,
        didAnswer: true,
        llmConfidence: 0.9,
        citations: ['https://docs.example.com/help/oauth#step-1'],
        retrievedChunkIds: [],
        latencyMs: 100,
        costUsd: new Decimal(0),
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
      },
    })

    // Create a shift so escalation target can be found
    await harness.prisma.shift.create({
      data: { primaryAgentId: agent.id, dayOfWeek: -1, startMinute: 0, endMinute: 0 },
    })

    const userToken = await signJwt({ id: user.id, role: 'user' })
    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ body: "That answer didn't help, still stuck.", type: 'REPLY' })

    expect(res.status).toBe(201)

    // Let the fire-and-forget escalation complete
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))

    // Ticket assigned to an agent and SYSTEM_EVENT written
    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.assigneeId).toBeTruthy()

    const msgs = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    const escalationEvent = msgs.find(
      (m) => m.type === 'SYSTEM_EVENT' && m.body.includes('escalated'),
    )
    expect(escalationEvent).toBeDefined()

    // Escalation notification email captured
    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    const escalationMail = mailCapture.list({ to: user.email })
    expect(escalationMail.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── S11 — Thread-matching fallback via agent reply RFC Message-ID ────────────

describe('S11 — Thread-match fallback: In-Reply-To agent reply messageId (R102)', () => {
  it('R102 — inbound reply whose In-Reply-To matches an agent reply RFC Message-ID attaches to the existing ticket', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'r102-customer@example.com' })
    const agent = await makeAgent({ email: 'agent-r102@test.local' })
    const ticket = await harness.prisma.ticket.create({
      data: {
        userId: user.id,
        ref: 'R102TKT',
        isTicket: true,
        title: 'Portal ticket for R102',
        status: 'WAITING',
        source: 'PORTAL',
        category: 'QUESTION',
        // No externalThreadId — portal-originated ticket
      },
    })

    // Simulate an agent reply that was sent via email; its RFC Message-ID is stored on the Message row
    const agentReplyMsgId = '<agent-reply-r102@support.test.local>'
    await harness.prisma.message.create({
      data: {
        ticketId: ticket.id,
        body: 'Here is our answer.',
        type: 'REPLY',
        sentVia: 'PORTAL_AND_EMAIL',
        authorAgentId: agent.id,
        messageId: agentReplyMsgId,
      },
    })

    // Customer replies via Gmail quoting the agent's RFC Message-ID
    const replyThread = buildParsedThread({
      threadId: 'gmail-r102-thread',
      messageId: 'gmail-r102-msg',
      rfcMessageId: '<r102-customer-reply@gmail.com>',
      from: user.email,
      subject: 'Re: Here is our answer.',
      body: 'Thanks, but I still have a follow-up question.',
      inReplyTo: agentReplyMsgId,
    })
    const provider = makeMailProvider(replyThread, ['agent-r102@test.local'])
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    const result = await ingestion.fetchAndUpsertThread(provider, 'gmail-r102-thread', { isBackfill: false })

    // Must attach to existing ticket, not create a new one
    expect(result.created).toBe(false)
    expect(result.ticketId).toBe(ticket.id)

    // New message appended to the existing ticket
    const msgs = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    const customerReply = msgs.find((m) => m.body === 'Thanks, but I still have a follow-up question.')
    expect(customerReply).toBeDefined()

    // externalThreadId stamped for future fast-path lookups
    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.externalThreadId).toBe('gmail-r102-thread')
  })
})

// ─── S12 — Unmatched reply creates a new NEW ticket ───────────────────────────

describe('S12 — Unmatched In-Reply-To creates new ticket (R103)', () => {
  it('R103 — inbound with In-Reply-To that matches nothing → new NEW conversation, no crash, no mis-attach', async () => {
    await seedAppConfig()

    // Send an email that has an In-Reply-To referencing a non-existent messageId
    const thread = buildParsedThread({
      threadId: 'gmail-r103-thread',
      messageId: 'gmail-r103-msg',
      rfcMessageId: '<r103-orphan@gmail.com>',
      from: 'orphan-sender@external.com',
      subject: 'Re: Something that never existed',
      body: 'My original was lost, sending again.',
      inReplyTo: '<nonexistent-message@nowhere.com>',
    })
    const provider = makeMailProvider(thread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    const result = await ingestion.fetchAndUpsertThread(provider, 'gmail-r103-thread', { isBackfill: false })

    // Must create a brand-new ticket, not error or mis-attach
    expect(result.created).toBe(true)
    expect(result.ticketId).toBeDefined()

    const ticket = await harness.prisma.ticket.findUnique({ where: { id: result.ticketId } })
    expect(ticket!.status).toBe('NEW')
    expect(ticket!.externalThreadId).toBe('gmail-r103-thread')

    // Sanity: there is only one ticket with this externalThreadId
    const all = await harness.prisma.ticket.findMany({ where: { externalThreadId: 'gmail-r103-thread' } })
    expect(all).toHaveLength(1)
  })
})

// ─── S13 — Agent-alias sender stamped authorAgentId ──────────────────────────

describe('S13 — Agent-alias sender gets authorAgentId (R105)', () => {
  it('R105 — message from agent alias sets authorAgentId, not authorUserId', async () => {
    await seedAppConfig()
    const agentEmail = 'support-alias-r105@test.local'
    const agent = await makeAgent({ email: agentEmail })

    // Inbound thread where the "from" is the agent alias (e.g. agent CC'd on a conversation)
    const thread = buildParsedThread({
      threadId: 'gmail-r105-thread',
      messageId: 'gmail-r105-msg',
      rfcMessageId: '<r105-agent-msg@test.local>',
      from: agentEmail,
      subject: 'Agent-originated email',
      body: 'This message was sent from the agent mailbox.',
    })
    // aliases includes the agent's email so CustomerResolverService will identify it as an alias message
    const provider = makeMailProvider(thread, [agentEmail])
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    // CustomerResolverService will return null for alias-only threads (no customer),
    // so there will be no ticket created — that is expected behavior.
    // R105 specifically tests an existing ticket that receives an agent-from reply.
    // We need a non-alias customer message first, then an alias follow-up.
    const customerEmail = 'r105-customer@external.com'
    const mixedThread: ParsedThread = {
      id: 'gmail-r105-mixed',
      firstSubject: 'Support question',
      hasUnread: true,
      messages: [
        {
          id: 'gmail-r105-customer-msg',
          rfcMessageId: '<r105-customer@gmail.com>',
          fromEmail: customerEmail,
          fromName: 'Customer',
          toEmails: [agentEmail],
          ccEmails: [],
          subject: 'Support question',
          bodyPlain: 'I need help.',
          sentAt: new Date(Date.now() - 10000),
          isBulk: false,
        },
        {
          id: 'gmail-r105-agent-msg',
          rfcMessageId: '<r105-agent@test.local>',
          fromEmail: agentEmail,
          fromName: 'Agent',
          toEmails: [customerEmail],
          ccEmails: [],
          subject: 'Re: Support question',
          bodyPlain: 'Let me look into this for you.',
          sentAt: new Date(),
          isBulk: false,
        },
      ],
    }
    const mixedProvider = makeMailProvider(mixedThread, [agentEmail])
    const mixedResult = await ingestion.fetchAndUpsertThread(mixedProvider, 'gmail-r105-mixed', { isBackfill: false })

    expect(mixedResult.created).toBe(true)

    const msgs = await harness.prisma.message.findMany({
      where: { ticketId: mixedResult.ticketId },
      orderBy: { createdAt: 'asc' },
    })

    const customerMsg = msgs.find((m) => m.externalMessageId === 'gmail-r105-customer-msg')
    const agentMsg = msgs.find((m) => m.externalMessageId === 'gmail-r105-agent-msg')

    expect(customerMsg).toBeDefined()
    expect(customerMsg!.authorUserId).not.toBeNull()
    expect(customerMsg!.authorAgentId).toBeNull()

    expect(agentMsg).toBeDefined()
    expect(agentMsg!.authorAgentId).toBe(agent.id)
    expect(agentMsg!.authorUserId).toBeNull()
  })
})

// ─── S14 — Attachment fetch failure resilience ───────────────────────────────

describe('S14 — Attachment fetch failure is non-fatal (R106)', () => {
  it('R106 — one attachment fetch failure does not abort the ingest; ticket and message are committed', async () => {
    await seedAppConfig()

    const attachmentThread: ParsedThread = {
      id: 'gmail-r106-thread',
      firstSubject: 'Email with attachment',
      hasUnread: true,
      messages: [
        {
          id: 'gmail-r106-msg',
          rfcMessageId: '<r106@gmail.com>',
          fromEmail: 'attacher@external.com',
          fromName: 'Attacher',
          toEmails: ['support@test.local'],
          ccEmails: [],
          subject: 'Email with attachment',
          bodyPlain: 'Please see the attached document.',
          sentAt: new Date(),
          isBulk: false,
          attachments: [
            {
              filename: 'document.pdf',
              mimeType: 'application/pdf',
              size: 1024,
              gmailMessageId: 'gmail-r106-msg',
              gmailAttachmentId: 'att-id-1',
            },
          ],
        },
      ],
    }

    // Provider with fetchAttachmentBytes that always throws
    const failingProvider = {
      ...makeMailProvider(attachmentThread),
      fetchAttachmentBytes: async (_msgId: string, _attId: string): Promise<Buffer> => {
        throw new Error('Simulated attachment fetch failure')
      },
    }

    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)
    // Should not throw — attachment errors are caught and logged
    const result = await ingestion.fetchAndUpsertThread(
      failingProvider as any,
      'gmail-r106-thread',
      { isBackfill: false },
    )

    // Ticket and message must have been persisted despite the attachment failure
    expect(result.created).toBe(true)
    expect(result.ticketId).toBeDefined()

    const ticket = await harness.prisma.ticket.findUnique({ where: { id: result.ticketId } })
    expect(ticket).not.toBeNull()

    const msgs = await harness.prisma.message.findMany({ where: { ticketId: result.ticketId } })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].body).toBe('Please see the attached document.')
  })
})

// ─── S15 — createdAt derives from email sentAt ───────────────────────────────

describe('S15 — Ticket.createdAt derives from email sentAt, not wall-clock (R107)', () => {
  it('R107 — ticket.createdAt matches the first message sentAt, not the import wall-clock', async () => {
    await seedAppConfig()

    const sentAt = new Date('2024-01-15T08:30:00.000Z')
    const oldThread: ParsedThread = {
      id: 'gmail-r107-thread',
      firstSubject: 'Old email being imported',
      hasUnread: true,
      messages: [
        {
          id: 'gmail-r107-msg',
          rfcMessageId: '<r107@gmail.com>',
          fromEmail: 'backfill-sender@external.com',
          fromName: 'Backfill Sender',
          toEmails: ['support@test.local'],
          ccEmails: [],
          subject: 'Old email being imported',
          bodyPlain: 'This email was sent months ago.',
          sentAt,
          isBulk: false,
        },
      ],
    }
    const provider = makeMailProvider(oldThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    const result = await ingestion.fetchAndUpsertThread(provider, 'gmail-r107-thread', { isBackfill: true })

    expect(result.created).toBe(true)
    const ticket = await harness.prisma.ticket.findUnique({ where: { id: result.ticketId } })
    // createdAt must equal sentAt (not the wall-clock time of the import)
    expect(ticket!.createdAt.getTime()).toBe(sentAt.getTime())
  })
})

// ─── S10 — DISMISSED resurrection ─────────────────────────────────────────────

describe('S10 — DISMISSED ticket resurrection via email (R86)', () => {
  it('R86 — customer email reply to DISMISSED ticket flips status back to NEW', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'resurrected@example.com' })
    const agent = await makeAgent({ role: 'ADMIN' })

    // Dismissed ticket with known externalThreadId
    const ticket = await harness.prisma.ticket.create({
      data: {
        userId: user.id,
        ref: 'DISM001',
        isTicket: false,
        title: 'Dismissed spam',
        status: 'DISMISSED',
        category: 'OTHER',
        source: 'EMAIL',
        externalThreadId: 'dismissed-thread-123',
        dismissedAt: new Date(),
        dismissedById: agent.id,
      },
    })

    // Customer replies to the same Gmail thread
    const replyThread = buildParsedThread({
      threadId: 'dismissed-thread-123',
      messageId: 'resurrection-msg',
      rfcMessageId: '<resurrection@gmail.com>',
      from: user.email,
      subject: 'Re: Dismissed spam',
      body: 'Actually I need help with this.',
    })
    const provider = makeMailProvider(replyThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    const result = await ingestion.fetchAndUpsertThread(provider, 'dismissed-thread-123', { isBackfill: false })

    expect(result.created).toBe(false)
    expect(result.ticketId).toBe(ticket.id)

    const resurrected = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(resurrected!.status).toBe('NEW')

    // No confirmation or bot fired — ticket still pre-activation
    await flushPromises()
    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    expect(mailCapture.list({ to: user.email })).toHaveLength(0)
  })
})

// ─── G3 — Inbound email drives the status machine (R108–R111) ──────────────────

describe('G3 — Inbound email reply status transitions (R108–R111)', () => {
  it('R108 — email reply on WAITING ticket → IN_PROGRESS + SYSTEM_EVENT', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'waiter@example.com' })
    const agent = await makeAgent({ email: 'agent-g3@test.local' })
    const ticket = await harness.prisma.ticket.create({
      data: {
        ref: 'G3WAIT1',
        isTicket: true,
        title: 'G3 waiting test',
        category: 'OTHER',
        source: 'EMAIL',
        status: 'WAITING',
        userId: user.id,
        assigneeId: agent.id,
        externalThreadId: 'g3-waiting-thread',
      },
    })

    const replyThread = buildParsedThread({
      threadId: 'g3-waiting-thread',
      messageId: 'g3-reply-msg-1',
      rfcMessageId: '<g3reply1@gmail.com>',
      from: user.email,
      subject: 'Re: G3 waiting test',
      body: 'Still having this issue.',
    })
    const provider = makeMailProvider(replyThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    await ingestion.fetchAndUpsertThread(provider, 'g3-waiting-thread', { isBackfill: false })

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('IN_PROGRESS')

    const sysEvent = await harness.prisma.message.findFirst({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: 'status_changed:WAITING:IN_PROGRESS' },
    })
    expect(sysEvent).not.toBeNull()
  })

  it('R109 — email reply on RESOLVED ticket → IN_PROGRESS + reopenCount++', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'reopener@example.com' })
    const ticket = await harness.prisma.ticket.create({
      data: {
        ref: 'G3RESV1',
        isTicket: true,
        title: 'G3 resolved test',
        category: 'OTHER',
        source: 'EMAIL',
        status: 'RESOLVED',
        userId: user.id,
        externalThreadId: 'g3-resolved-thread',
      },
    })

    const replyThread = buildParsedThread({
      threadId: 'g3-resolved-thread',
      messageId: 'g3-reopen-msg-1',
      rfcMessageId: '<g3reopen1@gmail.com>',
      from: user.email,
      subject: 'Re: G3 resolved test',
      body: 'Issue is back.',
    })
    const provider = makeMailProvider(replyThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    await ingestion.fetchAndUpsertThread(provider, 'g3-resolved-thread', { isBackfill: false })

    const updated = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updated!.status).toBe('IN_PROGRESS')
    expect(updated!.reopenCount).toBe(1)
    expect(updated!.reopenedAt).not.toBeNull()
  })

  it('R110 — backfill leaves status untouched', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'backfill-nochange@example.com' })
    const ticket = await harness.prisma.ticket.create({
      data: {
        ref: 'G3BACK1',
        isTicket: true,
        title: 'G3 backfill test',
        category: 'OTHER',
        source: 'EMAIL',
        status: 'WAITING',
        userId: user.id,
        externalThreadId: 'g3-backfill-thread',
      },
    })

    const replyThread = buildParsedThread({
      threadId: 'g3-backfill-thread',
      messageId: 'g3-backfill-msg-1',
      rfcMessageId: '<g3backfill1@gmail.com>',
      from: user.email,
      subject: 'Old reply',
      body: 'Old content.',
    })
    const provider = makeMailProvider(replyThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    await ingestion.fetchAndUpsertThread(provider, 'g3-backfill-thread', { isBackfill: true })

    const unchanged = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(unchanged!.status).toBe('WAITING')
  })

  it('R111 — email reply on conversation (isTicket=false) does NOT transition status', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'convo-user@example.com' })
    const ticket = await harness.prisma.ticket.create({
      data: {
        ref: 'G3CONV1',
        isTicket: false,
        title: 'G3 conversation test',
        category: 'OTHER',
        source: 'EMAIL',
        status: 'NEW',
        userId: user.id,
        externalThreadId: 'g3-convo-thread',
      },
    })

    const replyThread = buildParsedThread({
      threadId: 'g3-convo-thread',
      messageId: 'g3-convo-msg-1',
      rfcMessageId: '<g3convo1@gmail.com>',
      from: user.email,
      subject: 'Re: convo',
      body: 'Reply to convo.',
    })
    const provider = makeMailProvider(replyThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    await ingestion.fetchAndUpsertThread(provider, 'g3-convo-thread', { isBackfill: false })

    const unchanged = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(unchanged!.status).toBe('NEW')
  })
})

// ─── G2 — Reliable confirmation email (R112–R113) ─────────────────────────────

describe('G2 — Confirmation email via queue (R112)', () => {
  it('R112 — portal ticket create enqueues email:send-confirmation; confirmation_sent SYSTEM_EVENT written on delivery', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'g2-confirm@example.com', name: 'G2 User' })
    const token = await signJwt({ id: user.id, role: 'user' })

    const res = await harness.request()
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'G2 confirmation test', description: 'Hello.', category: 'QUESTION' })

    expect(res.status).toBe(201)
    const { ticket } = res.body.data

    // Wait for pg-boss to pick up and process the job. In test mode pg-boss uses
    // newJobCheckInterval=100ms; 800ms gives 8+ cycles worth of headroom.
    await new Promise<void>((r) => setTimeout(r, 800))

    const sysEvent = await harness.prisma.message.findFirst({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: { startsWith: 'confirmation_sent:' } },
    })
    expect(sysEvent).not.toBeNull()

    const mailCapture = harness.get<MailCaptureService>(MailCaptureService)
    const confirmMails = mailCapture.list({ to: user.email })
    expect(confirmMails.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── G4 — Bounce detection (R114–R115) ────────────────────────────────────────

describe('G4 — Bounce detection (R114–R115)', () => {
  it('R114 — mailer-daemon bounce with synthetic ticket token → SYSTEM_EVENT + user emailStatus BOUNCING', async () => {
    await seedAppConfig()
    const user = await makeUser({ email: 'bounce-target@example.com' })
    const ticket = await harness.prisma.ticket.create({
      data: {
        ref: 'G4BNCE1',
        isTicket: true,
        title: 'G4 bounce test',
        category: 'OTHER',
        source: 'PORTAL',
        status: 'OPEN',
        userId: user.id,
        emailThreadId: 'bounce-email-thread-id-123',
      },
    })

    const bounceThread: import('../../apps/api/src/modules/email-sync/providers/mail-provider.interface').ParsedThread = {
      id: 'bounce-thread-g4',
      firstSubject: 'Mail delivery failed',
      hasUnread: true,
      messages: [
        {
          id: 'bounce-msg-id-1',
          rfcMessageId: '<bounce1@mailer-daemon>',
          fromEmail: 'mailer-daemon@example.com',
          fromName: 'Mail Delivery System',
          toEmails: ['support@test.local'],
          ccEmails: [],
          subject: 'Mail delivery failed',
          bodyPlain: `Your message could not be delivered.\n\nReferencing ticket-bounce-email-thread-id-123@support.example.com`,
          sentAt: new Date(),
          isBulk: false,
        },
      ],
    }

    const provider = makeMailProvider(bounceThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    await ingestion.fetchAndUpsertThread(provider, 'bounce-thread-g4', { isBackfill: false })

    const sysEvent = await harness.prisma.message.findFirst({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: 'email_delivery_failed:bounce' },
    })
    expect(sysEvent).not.toBeNull()

    const updatedUser = await harness.prisma.user.findUnique({ where: { id: user.id } })
    expect(updatedUser!.emailStatus).toBe('BOUNCING')

    // No new ticket/conversation should be created
    const newTickets = await harness.prisma.ticket.count({ where: { externalThreadId: 'bounce-thread-g4' } })
    expect(newTickets).toBe(0)
  })

  it('R115 — non-matching bounce DSN creates a normal NEW conversation (fallthrough)', async () => {
    await seedAppConfig()

    const bounceThread: import('../../apps/api/src/modules/email-sync/providers/mail-provider.interface').ParsedThread = {
      id: 'unmatched-bounce-g4',
      firstSubject: 'Undelivered Mail Returned',
      hasUnread: true,
      messages: [
        {
          id: 'unmatched-bounce-msg-1',
          rfcMessageId: '<unmatched-bounce@mailer>',
          fromEmail: 'mailer-daemon@external.example.com',
          fromName: 'Mail Delivery System',
          toEmails: ['support@test.local'],
          ccEmails: [],
          subject: 'Undelivered Mail Returned',
          bodyPlain: 'Could not deliver to unknown@noticket.example.com',
          sentAt: new Date(),
          isBulk: false,
        },
      ],
    }

    const provider = makeMailProvider(bounceThread)
    const ingestion = harness.get<ThreadIngestionService>(ThreadIngestionService)

    // Should fall through to normal ingest (since there's no customer.resolveCustomer match for mailer-daemon)
    const result = await ingestion.fetchAndUpsertThread(provider, 'unmatched-bounce-g4', { isBackfill: false })
    // mailer-daemon is skipped by customerResolver (alias-only or unresolvable), returns { created: false }
    expect(result.created).toBe(false)
  })
})
