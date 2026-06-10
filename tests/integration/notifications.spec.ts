/**
 * notifications.spec — integration tests for NotificationsController + NotificationsService.
 * SSE: service-level broadcast/observable only (live stream deferred to E2E).
 *
 * Regression catalogue rows:
 *   R139 — createAndBroadcast(): Notification row created; SseService.broadcast emits
 *   R140 — GET /notifications per agent: list with correct isRead per NotificationRead join
 *   R141 — GET /notifications/unread-count: total − this agent's reads
 *   R142 — PATCH /notifications/:id/read: NotificationRead upserted; count drops
 *   R143 — PATCH /notifications/read-all: all marked read for that agent
 *   R144 — auth boundary on notification routes: 401 without agent token
 */

import { harness } from './harness'
import { makeAgent, makeUser, makeTicket, signJwt } from './factories'
import './setup'
import { NotificationsService } from '../../apps/api/src/modules/notifications/notifications.service'
import { SseService } from '../../apps/api/src/modules/events/sse.service'

// ─── R139 — createAndBroadcast() ─────────────────────────────────────────────

describe('R139 — createAndBroadcast()', () => {
  it('creates Notification row and broadcasts SSE event', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    const svc = harness.get<NotificationsService>(NotificationsService)
    const sse = harness.get<SseService>(SseService)

    const emitted: unknown[] = []
    const sub = sse.asObservable().subscribe((e) => emitted.push(e))

    const notifId = await svc.createAndBroadcast({
      type: 'CHURN_RISK_DETECTED',
      title: 'Ticket assigned',
      body: 'Test notification',
      ticket: { connect: { id: ticket.id } },
    })

    sub.unsubscribe()

    const row = await harness.prisma.notification.findUniqueOrThrow({ where: { id: notifId } })
    expect(row.type).toBe('CHURN_RISK_DETECTED')

    expect(emitted.length).toBeGreaterThan(0)
    const parsed = JSON.parse((emitted[0] as { data: string }).data) as { type: string; notificationId: string }
    expect(parsed.type).toBe('notification-created')
    expect(parsed.notificationId).toBe(notifId)
  })
})

// ─── R140 — GET /notifications ────────────────────────────────────────────────

describe('R140 — GET /notifications per agent', () => {
  it('returns notifications with isRead per agent', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const ticket = await makeTicket({ userId: user.id })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const svc = harness.get<NotificationsService>(NotificationsService)
    const notifId = await svc.createAndBroadcast({
      type: 'CHURN_RISK_DETECTED',
      title: 'Test',
      body: 'Body',
      ticket: { connect: { id: ticket.id } },
    })

    const res = await harness.request().get('/api/v1/notifications').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const list = res.body.data as { id: string; isRead: boolean }[]
    const found = list.find((n) => n.id === notifId)
    expect(found).toBeDefined()
    expect(found!.isRead).toBe(false)
  })
})

// ─── R141 — GET /notifications/unread-count ───────────────────────────────────

describe('R141 — GET /notifications/unread-count', () => {
  it('returns total minus this agent reads', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const ticket = await makeTicket({ userId: user.id })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const svc = harness.get<NotificationsService>(NotificationsService)
    const id1 = await svc.createAndBroadcast({
      type: 'CHURN_RISK_DETECTED',
      title: 'N1',
      body: 'Body',
      ticket: { connect: { id: ticket.id } },
    })
    await svc.createAndBroadcast({
      type: 'CHURN_RISK_DETECTED',
      title: 'N2',
      body: 'Body',
      ticket: { connect: { id: ticket.id } },
    })

    // Mark one read
    await svc.markRead(id1, agent.id)

    const res = await harness
      .request()
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toBe(1)
  })
})

// ─── R142 — PATCH /notifications/:id/read ────────────────────────────────────

describe('R142 — PATCH /notifications/:id/read', () => {
  it('creates NotificationRead row; unread-count decreases', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const ticket = await makeTicket({ userId: user.id })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const svc = harness.get<NotificationsService>(NotificationsService)
    const notifId = await svc.createAndBroadcast({
      type: 'CHURN_RISK_DETECTED',
      title: 'Mark me read',
      body: 'Body',
      ticket: { connect: { id: ticket.id } },
    })

    const res = await harness
      .request()
      .patch(`/api/v1/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)

    const read = await harness.prisma.notificationRead.findFirst({
      where: { notificationId: notifId, agentId: agent.id },
    })
    expect(read).not.toBeNull()
  })
})

// ─── R143 — PATCH /notifications/read-all ────────────────────────────────────

describe('R143 — PATCH /notifications/read-all', () => {
  it('marks all notifications read for the agent (skipDuplicates)', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const ticket = await makeTicket({ userId: user.id })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const svc = harness.get<NotificationsService>(NotificationsService)
    await svc.createAndBroadcast({ type: 'CHURN_RISK_DETECTED', title: 'N1', body: 'B', ticket: { connect: { id: ticket.id } } })
    await svc.createAndBroadcast({ type: 'CHURN_RISK_DETECTED', title: 'N2', body: 'B', ticket: { connect: { id: ticket.id } } })

    const res = await harness
      .request()
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)

    const count = await harness.prisma.notificationRead.count({ where: { agentId: agent.id } })
    const total = await harness.prisma.notification.count()
    expect(count).toBe(total)
  })
})

// ─── R144 — auth boundary ────────────────────────────────────────────────────

describe('R144 — auth boundary on notification routes', () => {
  it('returns 401 without token', async () => {
    const [listRes, countRes] = await Promise.all([
      harness.request().get('/api/v1/notifications'),
      harness.request().get('/api/v1/notifications/unread-count'),
    ])
    expect(listRes.status).toBe(401)
    expect(countRes.status).toBe(401)
  })
})
