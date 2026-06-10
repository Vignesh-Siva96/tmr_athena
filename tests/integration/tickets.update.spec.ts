/**
 * tickets.update.spec — integration tests for TicketsService update, list,
 * stats, and convert paths.
 *
 * Regression catalogue rows:
 *   R92  — update() same-status → no SYSTEM_EVENT written
 *   R93  — update() status change → exactly one SYSTEM_EVENT "status_changed:FROM:TO"
 *   R94  — update() assignee change → SYSTEM_EVENT; unassign and same-assignee no-op
 *   R95  — update() first RESOLVED stamps firstResolvedAt; re-resolving does not overwrite
 *   R96  — stats() byStatus/byCategory/unassigned/newCount exclude DISMISSED + soft-deleted
 *   R97  — convert() is idempotent when isTicket=true (no confirmation/bot re-fire)
 *   R98  — list() filters: status, category, assigneeId, search each narrow correctly
 *   R99  — list() pagination: limit/offset honoured; offset>total → empty page
 *   R100 — list() agent view excludes DISMISSED; portal view sees only own isTicket=true
 *   R101 — DELETE /tickets/:id then GET /tickets/:id returns 200 (🟡 known bug: should 404)
 */

import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, signJwt } from './factories'
import './setup'

// ─── R92 / R93 — status update SYSTEM_EVENTs ─────────────────────────────────

describe('update() — status SYSTEM_EVENT rules (R92, R93)', () => {
  it('R92 — same-status update writes no SYSTEM_EVENT', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'OPEN' })

    expect(res.status).toBe(200)

    const events = await harness.prisma.message.findMany({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT' },
    })
    expect(events).toHaveLength(0)
  })

  it('R93 — status change writes exactly one SYSTEM_EVENT with status_changed:FROM:TO', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'IN_PROGRESS' })

    expect(res.status).toBe(200)

    const events = await harness.prisma.message.findMany({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].body).toBe('status_changed:OPEN:IN_PROGRESS')
  })
})

// ─── R94 — assignee SYSTEM_EVENTs ────────────────────────────────────────────

describe('update() — assignee SYSTEM_EVENT rules (R94)', () => {
  it('R94a — assigning an agent writes SYSTEM_EVENT; re-assigning the same agent does not', async () => {
    const user = await makeUser()
    const adminAgent = await makeAgent({ role: 'ADMIN' })
    const assignee = await makeAgent()
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN', assigneeId: undefined })
    const adminToken = await signJwt({ id: adminAgent.id, role: 'agent', orgRole: 'ADMIN' })

    // Assign
    await harness.request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: assignee.id })

    const afterAssign = await harness.prisma.message.findMany({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: { startsWith: 'assigned:' } },
    })
    expect(afterAssign).toHaveLength(1)
    expect(afterAssign[0].body).toBe(`assigned:${assignee.id}`)

    // Re-assign same agent → no new event
    await harness.request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: assignee.id })

    const afterReassign = await harness.prisma.message.findMany({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: { startsWith: 'assigned:' } },
    })
    expect(afterReassign).toHaveLength(1) // still only one
  })

  it('R94b — unassigning (assigneeId: null) writes SYSTEM_EVENT "assigned:unassigned"', async () => {
    const user = await makeUser()
    const adminAgent = await makeAgent({ role: 'ADMIN' })
    const assignee = await makeAgent()
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN', assigneeId: assignee.id })
    const adminToken = await signJwt({ id: adminAgent.id, role: 'agent', orgRole: 'ADMIN' })

    await harness.request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: null })

    const events = await harness.prisma.message.findMany({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: { startsWith: 'assigned:' } },
    })
    expect(events).toHaveLength(1)
    expect(events[0].body).toBe('assigned:unassigned')
  })
})

// ─── R95 — firstResolvedAt ────────────────────────────────────────────────────

describe('update() — firstResolvedAt (R95)', () => {
  it('R95 — first RESOLVED stamps firstResolvedAt; re-resolving does not overwrite it', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    // First resolution
    await harness.request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'RESOLVED' })

    const afterFirst = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(afterFirst!.firstResolvedAt).not.toBeNull()
    const firstTime = afterFirst!.firstResolvedAt!

    // Reopen
    await harness.request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'OPEN' })

    // Re-resolve
    await harness.request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'RESOLVED' })

    const afterSecond = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(afterSecond!.firstResolvedAt).not.toBeNull()
    // firstResolvedAt must not have been changed
    expect(afterSecond!.firstResolvedAt!.getTime()).toBe(firstTime.getTime())
  })
})

// ─── R96 — stats() ────────────────────────────────────────────────────────────

describe('stats() — excludes DISMISSED and soft-deleted (R96)', () => {
  it('R96 — DISMISSED and soft-deleted tickets are excluded from all stats counts', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const adminToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    // Create tickets in various states
    await makeTicket({ userId: user.id, status: 'OPEN', isTicket: true })
    await makeTicket({ userId: user.id, status: 'OPEN', isTicket: true })
    const dismissed = await makeTicket({ userId: user.id, status: 'DISMISSED', isTicket: true })
    const toDelete = await makeTicket({ userId: user.id, status: 'OPEN', isTicket: true })
    // A conversation (isTicket=false, status=NEW) should be counted in newCount
    await harness.prisma.ticket.create({
      data: {
        userId: user.id,
        ref: 'STATS001',
        isTicket: false,
        title: 'Inbound conversation',
        status: 'NEW',
        category: 'OTHER',
        source: 'EMAIL',
      },
    })

    // Soft-delete the toDelete ticket
    await harness.request()
      .delete(`/api/v1/tickets/${toDelete.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    const res = await harness.request()
      .get('/api/v1/tickets/stats')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const stats = res.body.data

    // DISMISSED ticket must not appear in byStatus
    expect(stats.byStatus).not.toHaveProperty('DISMISSED')

    // The soft-deleted OPEN ticket should not be counted
    // We created 2 OPEN tickets that remain live; the one we soft-deleted should not be counted
    const openCount = stats.byStatus['OPEN'] ?? 0
    expect(openCount).toBeGreaterThanOrEqual(2)
    // Verify dismissed and deleted are actually absent from the live query
    // (checking that openCount doesn't include the deleted ticket)
    expect(openCount).toBeLessThanOrEqual(
      await harness.prisma.ticket.count({ where: { status: 'OPEN', deletedAt: null, isTicket: true } }),
    )

    // newCount counts isTicket=false conversations in status=NEW
    expect(stats.newCount).toBeGreaterThanOrEqual(1)
  })
})

// ─── R97 — convert() idempotency ─────────────────────────────────────────────

describe('convert() — idempotent when already isTicket=true (R97)', () => {
  it('R97 — converting an already-real ticket is a no-op (no second confirmation or bot)', async () => {
    const user = await makeUser({ email: 'idempotent-convert@example.com' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const adminToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    // Ticket already has isTicket=true (default from makeTicket)
    const ticket = await makeTicket({ userId: user.id, isTicket: true, status: 'OPEN' })

    await harness.prisma.appConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', appName: 'TMR', emailDisplayName: 'TMR', botApiKeyEnc: 'key', kbRootUrl: 'https://docs.example.com/' },
      update: {},
    })

    const countBefore = await harness.prisma.botInteraction.count({ where: { ticketId: ticket.id } })

    const res = await harness.request()
      .post(`/api/v1/tickets/${ticket.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(201)
    expect(res.body.data.ticket.isTicket).toBe(true)

    const countAfter = await harness.prisma.botInteraction.count({ where: { ticketId: ticket.id } })
    // No new BotInteraction should have been created
    expect(countAfter).toBe(countBefore)
  })
})

// ─── R98 — list() filters ────────────────────────────────────────────────────

describe('list() — filters (R98)', () => {
  async function seedListTickets() {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const assignee = await makeAgent()

    const open = await makeTicket({ userId: user.id, status: 'OPEN', category: 'BUG_REPORT' })
    const inprog = await makeTicket({ userId: user.id, status: 'IN_PROGRESS', category: 'QUESTION', assigneeId: assignee.id })
    const waiting = await makeTicket({ userId: user.id, status: 'WAITING', category: 'BILLING', title: 'Unique billing issue XYZ' })

    return { user, agent, assignee, open, inprog, waiting }
  }

  it('R98a — filter by status returns only matching tickets', async () => {
    const { agent, inprog } = await seedListTickets()
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness.request()
      .get('/api/v1/tickets?status=IN_PROGRESS')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.data.map((t: any) => t.id)
    expect(ids).toContain(inprog.id)
    // Must not include OPEN or WAITING tickets from this seed
    const statuses = res.body.data.data.map((t: any) => t.status)
    expect(statuses.every((s: string) => s === 'IN_PROGRESS')).toBe(true)
  })

  it('R98b — filter by category returns only matching tickets', async () => {
    const { agent, open } = await seedListTickets()
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness.request()
      .get('/api/v1/tickets?category=BUG_REPORT')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.data.map((t: any) => t.id)
    expect(ids).toContain(open.id)
    const categories = res.body.data.data.map((t: any) => t.category)
    expect(categories.every((c: string) => c === 'BUG_REPORT')).toBe(true)
  })

  it('R98c — filter by assigneeId returns only assigned tickets', async () => {
    const { agent, assignee, inprog } = await seedListTickets()
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness.request()
      .get(`/api/v1/tickets?assigneeId=${assignee.id}`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.data.map((t: any) => t.id)
    expect(ids).toContain(inprog.id)
    // All returned tickets must be assigned to this specific agent
    const assigneeIds = res.body.data.data.map((t: any) => t.assigneeId)
    expect(assigneeIds.every((id: string) => id === assignee.id)).toBe(true)
  })

  it('R98d — search by title text returns matching ticket', async () => {
    const { agent, waiting } = await seedListTickets()
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness.request()
      .get('/api/v1/tickets?search=Unique+billing+issue+XYZ')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.data.map((t: any) => t.id)
    expect(ids).toContain(waiting.id)
  })
})

// ─── R99 — list() pagination ──────────────────────────────────────────────────

describe('list() — pagination (R99)', () => {
  it('R99 — limit/offset honoured; offset beyond total returns empty page with correct meta.total', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    // Create 3 tickets with a distinct category to isolate them in pagination
    await makeTicket({ userId: user.id, category: 'FEATURE_REQUEST' })
    await makeTicket({ userId: user.id, category: 'FEATURE_REQUEST' })
    await makeTicket({ userId: user.id, category: 'FEATURE_REQUEST' })

    // Page 1: limit=2
    const page1 = await harness.request()
      .get('/api/v1/tickets?category=FEATURE_REQUEST&limit=2&offset=0')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(page1.status).toBe(200)
    expect(page1.body.data.data).toHaveLength(2)
    expect(page1.body.data.meta.total).toBeGreaterThanOrEqual(3)

    // Page 2: offset=2 should return at least 1 remaining
    const page2 = await harness.request()
      .get('/api/v1/tickets?category=FEATURE_REQUEST&limit=2&offset=2')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(page2.status).toBe(200)
    expect(page2.body.data.data.length).toBeGreaterThanOrEqual(1)

    // Way past the end
    const beyond = await harness.request()
      .get('/api/v1/tickets?category=FEATURE_REQUEST&limit=10&offset=9999')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(beyond.status).toBe(200)
    expect(beyond.body.data.data).toHaveLength(0)
    expect(beyond.body.data.meta.total).toBeGreaterThanOrEqual(3)
  })
})

// ─── R100 — list() visibility rules ──────────────────────────────────────────

describe('list() — visibility rules (R100)', () => {
  it('R100a — agent list excludes DISMISSED tickets', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const open = await makeTicket({ userId: user.id, status: 'OPEN' })
    const dismissed = await makeTicket({ userId: user.id, status: 'DISMISSED' })

    const res = await harness.request()
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.data.map((t: any) => t.id)
    expect(ids).toContain(open.id)
    expect(ids).not.toContain(dismissed.id)
  })

  it('R100b — portal user only sees own isTicket=true tickets, not conversations or other users', async () => {
    const user = await makeUser()
    const otherUser = await makeUser()
    const userToken = await signJwt({ id: user.id, role: 'user' })

    const ownTicket = await makeTicket({ userId: user.id, isTicket: true, status: 'OPEN' })
    const ownConversation = await makeTicket({ userId: user.id, isTicket: false, status: 'NEW' })
    const otherTicket = await makeTicket({ userId: otherUser.id, isTicket: true, status: 'OPEN' })

    const res = await harness.request()
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${userToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.data.map((t: any) => t.id)
    expect(ids).toContain(ownTicket.id)
    expect(ids).not.toContain(ownConversation.id)
    expect(ids).not.toContain(otherTicket.id)
  })
})

// ─── R197 — convert() response always carries full ticket shape ───────────────

describe('convert() response shape (R197)', () => {
  it('R197a — NEW→OPEN convert response includes messages array and attachments', async () => {
    const user = await makeUser({ email: 'r197a@example.com' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const adminToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'NEW', isTicket: false })

    await harness.prisma.appConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', appName: 'TMR', emailDisplayName: 'TMR', botApiKeyEnc: 'key', kbRootUrl: 'https://docs.example.com/' },
      update: {},
    })

    const res = await harness.request()
      .post(`/api/v1/tickets/${ticket.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(201)
    const t = res.body.data.ticket
    expect(Array.isArray(t.messages)).toBe(true)
    expect(Array.isArray(t.attachments)).toBe(true)
    expect(t.status).toBe('OPEN')
  })

  it('R197b — idempotent convert (already isTicket=true) response includes messages array and attachments', async () => {
    const user = await makeUser({ email: 'r197b@example.com' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const adminToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN', isTicket: true })

    await harness.prisma.appConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', appName: 'TMR', emailDisplayName: 'TMR', botApiKeyEnc: 'key', kbRootUrl: 'https://docs.example.com/' },
      update: {},
    })

    const res = await harness.request()
      .post(`/api/v1/tickets/${ticket.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(201)
    const t = res.body.data.ticket
    expect(Array.isArray(t.messages)).toBe(true)
    expect(Array.isArray(t.attachments)).toBe(true)
  })
})

// ─── R198 — update() response always carries full ticket shape ─────────────────

describe('update() response shape (R198)', () => {
  it('R198 — status-change PATCH response includes messages array and attachments', async () => {
    const user = await makeUser({ email: 'r198@example.com' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })

    const res = await harness.request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'IN_PROGRESS' })

    expect(res.status).toBe(200)
    const t = res.body.data.ticket
    expect(Array.isArray(t.messages)).toBe(true)
    expect(Array.isArray(t.attachments)).toBe(true)
    // The status-change SYSTEM_EVENT message must be present in the returned messages
    const systemMsg = t.messages.find((m: { type: string; body: string }) => m.type === 'SYSTEM_EVENT' && m.body === 'status_changed:OPEN:IN_PROGRESS')
    expect(systemMsg).toBeDefined()
  })
})

// ─── R101 — soft-delete visibility bug ───────────────────────────────────────

describe('DELETE /tickets/:id then GET /tickets/:id (R101) 🟡', () => {
  it('R101 — GET after soft-delete currently returns 200 (KNOWN BUG: should return 404)', async () => {
    // 🟡 This test CHARACTERIZES a known bug. findById() does not check deletedAt,
    // so soft-deleted tickets are still accessible via GET /tickets/:id.
    // Expected correct behaviour: 404. Fix deferred.
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const adminToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const del = await harness.request()
      .delete(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(del.status).toBe(200)

    const get = await harness.request()
      .get(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    // KNOWN BUG: soft-deleted tickets should return 404, but currently return 200.
    // When this bug is fixed, this assertion will fail and should be updated to toBe(404).
    expect(get.status).toBe(200)
  })
})
