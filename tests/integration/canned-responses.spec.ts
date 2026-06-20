/**
 * canned-responses.spec — integration tests for CannedResponsesService CRUD.
 *
 * Regression catalogue rows:
 *   R117 — canned responses CRUD: create, list, update, delete (happy path)
 *   R118 — portal user cannot access canned responses (403)
 */

import { harness } from './harness'
import { makeUser, makeAgent, signJwt } from './factories'
import './setup'

// ─── R117 — canned responses CRUD ────────────────────────────────────────────

describe('canned responses CRUD (R117)', () => {
  it('R117a — create via POST /canned-responses, then list it', async () => {
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const create = await harness
      .request()
      .post('/api/v1/canned-responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'billing-faq', body: '<p>Here is our billing FAQ…</p>' })

    expect(create.status).toBe(201)
    expect(create.body.data.cannedResponse.name).toBe('billing-faq')
    expect(create.body.data.cannedResponse.body).toBe('<p>Here is our billing FAQ…</p>')

    const list = await harness
      .request()
      .get('/api/v1/canned-responses')
      .set('Authorization', `Bearer ${token}`)

    expect(list.status).toBe(200)
    const found = (list.body.data.data as Array<{ name: string }>).find(
      (r) => r.name === 'billing-faq',
    )
    expect(found).toBeDefined()
  })

  it('R117b — update name and body via PATCH /canned-responses/:id', async () => {
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const cr = await harness.prisma.cannedResponse.create({
      data: { name: 'old-name', body: '<p>old</p>' },
    })

    const res = await harness
      .request()
      .patch(`/api/v1/canned-responses/${cr.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'new-name', body: '<p>new content</p>' })

    expect(res.status).toBe(200)
    expect(res.body.data.cannedResponse.name).toBe('new-name')
    expect(res.body.data.cannedResponse.body).toBe('<p>new content</p>')
  })

  it('R117c — delete via DELETE /canned-responses/:id', async () => {
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const cr = await harness.prisma.cannedResponse.create({
      data: { name: 'to-delete', body: '<p>bye</p>' },
    })

    const del = await harness
      .request()
      .delete(`/api/v1/canned-responses/${cr.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(del.status).toBe(200)
    expect(del.body.data.success).toBe(true)

    const gone = await harness.prisma.cannedResponse.findUnique({ where: { id: cr.id } })
    expect(gone).toBeNull()
  })
})

// ─── R118 — portal user cannot access ────────────────────────────────────────

describe('canned responses portal guard (R118)', () => {
  it('R118 — portal user (role=user) gets 403 from GET /canned-responses', async () => {
    const user = await makeUser()
    const userToken = await signJwt({ id: user.id, role: 'user' })

    const res = await harness
      .request()
      .get('/api/v1/canned-responses')
      .set('Authorization', `Bearer ${userToken}`)

    expect(res.status).toBe(403)
  })
})
