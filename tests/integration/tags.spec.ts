/**
 * tags.spec — integration tests for TagsService and ticket tagIds filtering.
 *
 * Regression catalogue rows:
 *   R110 — tags CRUD: create, list, update, delete (happy path)
 *   R111 — create tag with duplicate name → 409 Conflict
 *   R112 — delete in-use tag unassigns it from tickets (cascade join row removal)
 *   R113 — ticket list filtered by tagIds narrows correctly
 *   R114 — portal caller (role=user) receives no tags in ticket list
 *   R115 — PATCH ticket with changed tagIds writes internal SYSTEM_EVENT 'tags_changed'
 *   R116 — PATCH ticket with same tagIds does NOT write SYSTEM_EVENT
 */

import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, signJwt } from './factories'
import './setup'

// helper: create a tag directly via Prisma (bypasses HTTP for setup speed)
async function makeTag(name: string, color = '#3B82F6') {
  return harness.prisma.tag.create({ data: { name, color } })
}

// ─── R110 — tags CRUD ─────────────────────────────────────────────────────────

describe('tags CRUD (R110)', () => {
  it('R110a — create tag via POST /tags, then list it', async () => {
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const create = await harness
      .request()
      .post('/api/v1/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'billing', color: '#3B82F6' })

    expect(create.status).toBe(201)
    expect(create.body.data.tag.name).toBe('billing')
    expect(create.body.data.tag._count.tickets).toBe(0)

    const list = await harness
      .request()
      .get('/api/v1/tags')
      .set('Authorization', `Bearer ${token}`)

    expect(list.status).toBe(200)
    const found = (list.body.data.data as Array<{ name: string }>).find((t) => t.name === 'billing')
    expect(found).toBeDefined()
  })

  it('R110b — update tag name + color via PATCH /tags/:id', async () => {
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const tag = await makeTag('old-name')

    const res = await harness
      .request()
      .patch(`/api/v1/tags/${tag.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'new-name', color: '#EF4444' })

    expect(res.status).toBe(200)
    expect(res.body.data.tag.name).toBe('new-name')
    expect(res.body.data.tag.color).toBe('#EF4444')
  })

  it('R110c — delete tag via DELETE /tags/:id', async () => {
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const tag = await makeTag('to-delete')

    const del = await harness
      .request()
      .delete(`/api/v1/tags/${tag.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(del.status).toBe(200)
    expect(del.body.data.success).toBe(true)

    const gone = await harness.prisma.tag.findUnique({ where: { id: tag.id } })
    expect(gone).toBeNull()
  })
})

// ─── R111 — duplicate name → 409 ──────────────────────────────────────────────

describe('tag name uniqueness (R111)', () => {
  it('R111 — creating a tag with a duplicate name returns 409', async () => {
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    await makeTag('dup-tag')

    const res = await harness
      .request()
      .post('/api/v1/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'dup-tag', color: '#3B82F6' })

    expect(res.status).toBe(409)
  })
})

// ─── R112 — delete in-use tag unassigns from tickets ─────────────────────────

describe('delete in-use tag (R112)', () => {
  it('R112 — deleting a tag removes it from assigned tickets', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id })
    const tag = await makeTag('in-use-tag')

    // Assign tag to ticket
    await harness.prisma.ticket.update({
      where: { id: ticket.id },
      data: { tags: { connect: { id: tag.id } } },
    })

    const del = await harness
      .request()
      .delete(`/api/v1/tags/${tag.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(del.status).toBe(200)

    // Join rows should be gone
    const ticketAfter = await harness.prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: { tags: true },
    })
    expect(ticketAfter!.tags).toHaveLength(0)
  })
})

// ─── R113 — tagIds filter in ticket list ─────────────────────────────────────

describe('ticket list tagIds filter (R113)', () => {
  it('R113 — ?tagIds= narrows ticket list to matching tickets only', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const tagA = await makeTag('filter-tag-a')
    const ticketWithTag = await makeTicket({ userId: user.id, title: 'tagged ticket' })
    const ticketWithout = await makeTicket({ userId: user.id, title: 'untagged ticket' })

    // Assign tagA to ticketWithTag only
    await harness.prisma.ticket.update({
      where: { id: ticketWithTag.id },
      data: { tags: { connect: { id: tagA.id } } },
    })

    const res = await harness
      .request()
      .get(`/api/v1/tickets?tagIds=${tagA.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data.data as Array<{ id: string }>).map((t) => t.id)
    expect(ids).toContain(ticketWithTag.id)
    expect(ids).not.toContain(ticketWithout.id)
  })
})

// ─── R114 — portal caller receives no tags ────────────────────────────────────

describe('Portal tag exclusion (R114)', () => {
  it('R114 — portal caller (role=user) receives no tags field in ticket list', async () => {
    const user = await makeUser()
    const userToken = await signJwt({ id: user.id, role: 'user' })
    const tag = await makeTag('portal-hidden-tag')
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.ticket.update({
      where: { id: ticket.id },
      data: { tags: { connect: { id: tag.id } } },
    })

    const res = await harness
      .request()
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${userToken}`)

    expect(res.status).toBe(200)
    const row = (res.body.data.data as Array<{ id: string; tags?: unknown }>).find(
      (t) => t.id === ticket.id,
    )
    expect(row).toBeDefined()
    expect(row!.tags).toBeUndefined()
  })
})

// ─── R115 / R116 — tags_changed SYSTEM_EVENT ─────────────────────────────────

describe('tags_changed SYSTEM_EVENT (R115, R116)', () => {
  it('R115 — patching tagIds with a changed set writes internal SYSTEM_EVENT tags_changed', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const ticket = await makeTicket({ userId: user.id })
    const tag = await makeTag('event-tag')

    const res = await harness
      .request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tagIds: [tag.id] })

    expect(res.status).toBe(200)

    const events = await harness.prisma.message.findMany({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: 'tags_changed' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.isInternal).toBe(true)
  })

  it('R116 — patching tagIds with the same set does NOT write SYSTEM_EVENT', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })
    const tag = await makeTag('no-event-tag')
    const ticket = await makeTicket({ userId: user.id })

    // Pre-assign the tag directly
    await harness.prisma.ticket.update({
      where: { id: ticket.id },
      data: { tags: { connect: { id: tag.id } } },
    })

    // PATCH with the same tag set
    const res = await harness
      .request()
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tagIds: [tag.id] })

    expect(res.status).toBe(200)

    const events = await harness.prisma.message.findMany({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: 'tags_changed' },
    })
    expect(events).toHaveLength(0)
  })
})
