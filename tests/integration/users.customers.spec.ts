/**
 * users.customers.spec — integration tests for GET /users and PATCH /users/:id
 *
 * Regression catalogue rows: R87, R88, R89
 */

import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, signJwt } from './factories'
import './setup'

describe('GET /users — listCustomers (R87)', () => {
  it('R87 — returns paginated list with aggregates; portal user gets 403', async () => {
    const user = await makeUser({ email: 'cust-list@example.com', name: 'List User' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    // Create some tickets for the user
    await makeTicket({ userId: user.id, status: 'OPEN', isTicket: true })
    await makeTicket({ userId: user.id, status: 'RESOLVED', isTicket: true })
    await makeTicket({ userId: user.id, status: 'NEW', isTicket: false })

    // Agent can list customers
    const res = await harness
      .request()
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const { data, meta } = res.body.data
    expect(meta.total).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(data)).toBe(true)

    const found = data.find((c: any) => c.id === user.id)
    expect(found).toBeDefined()
    expect(found.ticketCount).toBe(2)
    expect(found.conversationCount).toBe(1)
    expect(found.openCount).toBe(1)
    expect(found.domain).toBe('example.com')
    expect(found.category).toBeDefined()

    // Portal user gets 403
    const forbidden = await harness
      .request()
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${userToken}`)
    expect(forbidden.status).toBe(403)
  })

  it('R88 — search filter returns matching users', async () => {
    const user = await makeUser({ email: 'search-unique-xyz@domain.io', name: 'Search XYZ' })
    const agent = await makeAgent()
    const agentToken = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .get('/api/v1/users?search=search-unique-xyz')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const { data } = res.body.data
    expect(data.some((c: any) => c.id === user.id)).toBe(true)
  })
})

describe('PATCH /users/:id — updateCategory (R89)', () => {
  it('R89 — agent can update category to MARKETING; portal user gets 403', async () => {
    const user = await makeUser({ email: 'cat-update@example.com' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const userToken = await signJwt({ id: user.id, role: 'user' })

    // Agent updates category
    const res = await harness
      .request()
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ category: 'MARKETING' })

    expect(res.status).toBe(200)
    const updated = await harness.prisma.user.findUnique({ where: { id: user.id } })
    expect(updated!.category).toBe('MARKETING')

    // Can also set PROMOTIONAL
    await harness
      .request()
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ category: 'PROMOTIONAL' })
    const promo = await harness.prisma.user.findUnique({ where: { id: user.id } })
    expect(promo!.category).toBe('PROMOTIONAL')

    // Portal user cannot update category
    const forbidden = await harness
      .request()
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ category: 'MARKETING' })
    expect(forbidden.status).toBe(403)
  })
})
