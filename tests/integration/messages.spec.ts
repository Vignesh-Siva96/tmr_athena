/**
 * messages.spec — integration tests for MessagesController + MessagesService reply lifecycle.
 *
 * Regression catalogue rows:
 *   R119 — agent REPLY on OPEN ticket: message created, status→IN_PROGRESS, EMAIL_SEND_REPLY enqueued
 *   R120 — agent INTERNAL_NOTE: isInternal=true, no status change, no reply email enqueued
 *   R121 — customer REPLY on WAITING ticket: status→IN_PROGRESS
 *   R122 — customer REPLY on RESOLVED/CLOSED ticket: reopenCount++, reopenedAt set, status→IN_PROGRESS
 *   R123 — agent edits own message within 5-min window: body updated
 *   R124 — edit after 5-min window or by non-author: 400/403
 *   R125 — customer posts INTERNAL_NOTE or no token: 403 / 401
 */

import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, makeMessage, signJwt } from './factories'
import './setup'
import { QueueService } from '../../apps/api/src/modules/queue/queue.service'

// Regression catalogue rows R126–R134 added at the bottom of this file.

// ─── R119 — agent REPLY on OPEN ticket ───────────────────────────────────────

describe('R119 — agent REPLY on OPEN ticket', () => {
  it('creates message, transitions status to IN_PROGRESS, enqueues EMAIL_SEND_REPLY', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const queueSvc = harness.get<QueueService>(QueueService)
    const enqueueSpy = jest.spyOn(queueSvc, 'enqueueEmailSendReply').mockResolvedValue(undefined)

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Agent reply here', type: 'REPLY' })

    expect(res.status).toBe(201)
    expect(res.body.data.message).toMatchObject({ type: 'REPLY', isInternal: false })

    const updatedTicket = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updatedTicket.status).toBe('IN_PROGRESS')

    await new Promise((r) => setImmediate(r))
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: ticket.id }),
    )

    jest.restoreAllMocks()
  })
})

// ─── R120 — agent INTERNAL_NOTE ──────────────────────────────────────────────

describe('R120 — agent INTERNAL_NOTE', () => {
  it('isInternal=true, no status change, no reply email enqueued', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const queueSvc = harness.get<QueueService>(QueueService)
    const enqueueSpy = jest.spyOn(queueSvc, 'enqueueEmailSendReply').mockResolvedValue(undefined)

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Internal note body', type: 'INTERNAL_NOTE' })

    expect(res.status).toBe(201)
    expect(res.body.data.message).toMatchObject({ type: 'INTERNAL_NOTE', isInternal: true })

    const updatedTicket = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updatedTicket.status).toBe('OPEN')

    await new Promise((r) => setImmediate(r))
    expect(enqueueSpy).not.toHaveBeenCalled()

    jest.restoreAllMocks()
  })
})

// ─── R121 — customer REPLY on WAITING ticket ─────────────────────────────────

describe('R121 — customer REPLY on WAITING ticket', () => {
  it('transitions status to IN_PROGRESS', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'WAITING' })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ body: 'Customer reply', type: 'REPLY' })

    expect(res.status).toBe(201)

    const updatedTicket = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updatedTicket.status).toBe('IN_PROGRESS')
  })
})

// ─── R122 — customer REPLY on RESOLVED/CLOSED ticket ─────────────────────────

describe('R122 — customer REPLY on RESOLVED/CLOSED ticket', () => {
  it.each([['RESOLVED'], ['CLOSED']] as const)(
    'status %s → IN_PROGRESS, reopenCount++, reopenedAt set',
    async (initialStatus) => {
      const user = await makeUser()
      const ticket = await makeTicket({ userId: user.id, status: initialStatus })
      const userToken = await signJwt({ id: user.id, role: 'user' })

      const res = await harness
        .request()
        .post(`/api/v1/tickets/${ticket.id}/messages`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ body: 'I need more help', type: 'REPLY' })

      expect(res.status).toBe(201)

      const updatedTicket = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
      expect(updatedTicket.status).toBe('IN_PROGRESS')
      expect(updatedTicket.reopenCount).toBe(1)
      expect(updatedTicket.reopenedAt).not.toBeNull()
    },
  )
})

// ─── R123 — agent edits own message within 5-min window ──────────────────────

describe('R123 — agent edits own message within 5-min window', () => {
  it('body updated successfully', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const message = await makeMessage({ ticketId: ticket.id, authorAgentId: agent.id, type: 'REPLY' })

    const res = await harness
      .request()
      .patch(`/api/v1/tickets/${ticket.id}/messages/${message.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ body: 'Edited message body' })

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatchObject({ body: 'Edited message body' })

    const row = await harness.prisma.message.findUniqueOrThrow({ where: { id: message.id } })
    expect(row.body).toBe('Edited message body')
  })
})

// ─── R124 — edit after window / by non-author ────────────────────────────────

describe('R124 — edit after window or by non-author', () => {
  it('rejects edit after 5-min window with 400', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    // Back-date the message by 6 minutes
    const message = await makeMessage({ ticketId: ticket.id, authorAgentId: agent.id, type: 'REPLY' })
    await harness.prisma.message.update({
      where: { id: message.id },
      data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) },
    })

    const res = await harness
      .request()
      .patch(`/api/v1/tickets/${ticket.id}/messages/${message.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ body: 'Too late edit' })

    expect(res.status).toBe(400)
  })

  it('rejects edit by non-author agent with 403', async () => {
    const user = await makeUser()
    const authorAgent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const otherAgent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const otherToken = await signJwt({ id: otherAgent.id, role: 'agent', orgRole: 'ADMIN' })

    const message = await makeMessage({ ticketId: ticket.id, authorAgentId: authorAgent.id, type: 'REPLY' })

    const res = await harness
      .request()
      .patch(`/api/v1/tickets/${ticket.id}/messages/${message.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ body: 'Stealing the edit' })

    expect(res.status).toBe(403)
  })
})

// ─── R125 — auth boundary ────────────────────────────────────────────────────

describe('R125 — auth boundary', () => {
  it('customer posting INTERNAL_NOTE returns 403', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ body: 'Secret note', type: 'INTERNAL_NOTE' })

    expect(res.status).toBe(403)
  })

  it('no token on POST returns 401', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .send({ body: 'Anonymous message', type: 'REPLY' })

    expect(res.status).toBe(401)
  })

  it('no token on PATCH returns 401', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const message = await makeMessage({ ticketId: ticket.id, authorAgentId: agent.id, type: 'REPLY' })

    const res = await harness
      .request()
      .patch(`/api/v1/tickets/${ticket.id}/messages/${message.id}`)
      .send({ body: 'No auth' })

    expect(res.status).toBe(401)
  })
})

// ─── R126 — agent REPLY with CC persists message.cc + creates participant ─────

describe('R126 — agent REPLY with CC', () => {
  it('persists message.cc, creates TicketParticipant, still enqueues email', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const queueSvc = harness.get<QueueService>(QueueService)
    const enqueueSpy = jest.spyOn(queueSvc, 'enqueueEmailSendReply').mockResolvedValue(undefined)

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Reply with CC', type: 'REPLY', cc: ['cc1@example.com', 'cc2@example.com'] })

    expect(res.status).toBe(201)
    expect(res.body.data.message.cc).toEqual(expect.arrayContaining(['cc1@example.com', 'cc2@example.com']))

    const msgRow = await harness.prisma.message.findFirstOrThrow({ where: { ticketId: ticket.id, type: 'REPLY' } })
    expect(msgRow.cc).toEqual(expect.arrayContaining(['cc1@example.com', 'cc2@example.com']))

    const participants = await harness.prisma.ticketParticipant.findMany({ where: { ticketId: ticket.id } })
    expect(participants.map((p) => p.email)).toEqual(expect.arrayContaining(['cc1@example.com', 'cc2@example.com']))

    await new Promise((r) => setImmediate(r))
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({ ticketId: ticket.id }))

    jest.restoreAllMocks()
  })
})

// ─── R127 — sticky CC add / remove across replies ────────────────────────────

describe('R127 — sticky CC add/remove across replies', () => {
  it('second reply with reduced CC removes the dropped participant', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const queueSvc = harness.get<QueueService>(QueueService)
    jest.spyOn(queueSvc, 'enqueueEmailSendReply').mockResolvedValue(undefined)

    // First reply: add two CC
    await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'First', type: 'REPLY', cc: ['keep@example.com', 'drop@example.com'] })

    // Second reply: remove one
    const res2 = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Second', type: 'REPLY', cc: ['keep@example.com'] })

    expect(res2.status).toBe(201)

    const participants = await harness.prisma.ticketParticipant.findMany({ where: { ticketId: ticket.id } })
    expect(participants.map((p) => p.email)).toContain('keep@example.com')
    expect(participants.map((p) => p.email)).not.toContain('drop@example.com')

    jest.restoreAllMocks()
  })
})

// ─── R128 — CC == customer address is silently dropped ────────────────────────

describe('R128 — CC == customer address is dropped', () => {
  it('does not create a participant for the primary customer email', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const queueSvc = harness.get<QueueService>(QueueService)
    jest.spyOn(queueSvc, 'enqueueEmailSendReply').mockResolvedValue(undefined)

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Reply', type: 'REPLY', cc: [user.email.toLowerCase()] })

    expect(res.status).toBe(201)
    const msgRow = await harness.prisma.message.findFirstOrThrow({ where: { ticketId: ticket.id, type: 'REPLY' } })
    expect(msgRow.cc).toHaveLength(0)

    const participants = await harness.prisma.ticketParticipant.findMany({ where: { ticketId: ticket.id } })
    expect(participants).toHaveLength(0)

    jest.restoreAllMocks()
  })
})

// ─── R129 — CC on internal note → 400 ────────────────────────────────────────

describe('R129 — CC on internal note is rejected', () => {
  it('returns 400 when cc is set on INTERNAL_NOTE', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Note with CC', type: 'INTERNAL_NOTE', cc: ['cc@example.com'] })

    expect(res.status).toBe(400)
  })
})

// ─── R130 — customer sending cc → 400 ────────────────────────────────────────

describe('R130 — customer sending cc is rejected', () => {
  it('returns 400 when a user role sends cc', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ body: 'Portal reply with CC', type: 'REPLY', cc: ['cc@example.com'] })

    expect(res.status).toBe(400)
  })
})

// ─── R131 — cc > 20 entries → 422 ────────────────────────────────────────────

describe('R131 — cc cap at 20', () => {
  it('returns 422 when cc has 21 entries', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const cc = Array.from({ length: 21 }, (_, i) => `cc${i}@example.com`)
    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Too many CCs', type: 'REPLY', cc })

    expect(res.status).toBe(422)
  })
})
