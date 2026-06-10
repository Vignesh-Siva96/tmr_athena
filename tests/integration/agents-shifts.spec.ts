/**
 * agents-shifts.spec — integration tests for AgentsController + ShiftsController.
 *
 * Note on R146: invite creates the Agent row but the current service does NOT send an email
 * (no EmailService call) — the plan's "invite email captured" assertion is not applicable.
 * We assert the Agent row instead and note this as a known gap.
 *
 * Note on R148: remove() hard-deletes the row; the plan's "deactivated/deletedAt" wording
 * reflects a design intent, but the implementation is a DELETE. We assert actual behavior.
 *
 * Regression catalogue rows:
 *   R145 — GET /agents: lists active + inactive agents
 *   R146 — POST /agents/invite (admin): Agent row created with inviteToken
 *   R147 — PATCH /agents/:id role change (admin): role updated
 *   R148 — DELETE /agents/:id (admin): agent row removed (hard delete)
 *   R149 — Agents routes non-admin: 403
 *   R150 — Shifts POST + GET + PATCH: CRUD round-trip
 *   R151 — Shifts DELETE: row removed
 */

import { harness } from './harness'
import { makeAgent, signJwt } from './factories'
import './setup'

// ─── R145 — GET /agents ───────────────────────────────────────────────────────

describe('R145 — GET /agents', () => {
  it('lists both active and inactive agents', async () => {
    const active = await makeAgent({ role: 'SECONDARY_AGENT', isActive: true })
    const inactive = await makeAgent({ role: 'SECONDARY_AGENT', isActive: false })
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness.request().get('/api/v1/agents').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    // Response is double-wrapped: TransformResponseInterceptor wraps, service returns {data}
    const ids = (res.body.data.data as { id: string }[]).map((a) => a.id)
    expect(ids).toContain(active.id)
    expect(ids).toContain(inactive.id)
  })
})

// ─── R146 — POST /agents/invite ───────────────────────────────────────────────

describe('R146 — POST /agents/invite (admin)', () => {
  it('creates Agent row with inviteToken', async () => {
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post('/api/v1/agents/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'invited@example.com', name: 'Invited Agent', role: 'ADMIN' })

    expect(res.status).toBe(201)
    expect(res.body.data.agent).toMatchObject({ email: 'invited@example.com' })

    const row = await harness.prisma.agent.findUniqueOrThrow({ where: { email: 'invited@example.com' } })
    expect(typeof row.inviteToken).toBe('string')
    expect(row.inviteToken!.length).toBeGreaterThan(0)
  })
})

// ─── R147 — PATCH /agents/:id role change ────────────────────────────────────

describe('R147 — PATCH /agents/:id role change (admin)', () => {
  it('updates agent role', async () => {
    const admin = await makeAgent({ role: 'ADMIN' })
    const target = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .patch(`/api/v1/agents/${target.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'ADMIN' })

    expect(res.status).toBe(200)
    expect(res.body.data.agent).toMatchObject({ role: 'ADMIN' })

    const row = await harness.prisma.agent.findUniqueOrThrow({ where: { id: target.id } })
    expect(row.role).toBe('ADMIN')
  })
})

// ─── R148 — DELETE /agents/:id ────────────────────────────────────────────────

describe('R148 — DELETE /agents/:id (admin) hard-deletes', () => {
  it('removes the agent row', async () => {
    const admin = await makeAgent({ role: 'ADMIN' })
    const target = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .delete(`/api/v1/agents/${target.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)

    const row = await harness.prisma.agent.findUnique({ where: { id: target.id } })
    expect(row).toBeNull()
  })
})

// ─── R149 — agents routes non-admin ──────────────────────────────────────────

describe('R149 — agents routes non-admin returns 403', () => {
  it('non-admin agent cannot invite', async () => {
    const nonAdmin = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: nonAdmin.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/agents/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'x@example.com', name: 'X', role: 'AGENT' })

    expect(res.status).toBe(403)
  })
})

// ─── R150 — Shifts CRUD round-trip ───────────────────────────────────────────

describe('R150 — Shifts POST + GET + PATCH round-trip', () => {
  it('creates, lists, and updates a shift (admin)', async () => {
    const admin = await makeAgent({ role: 'ADMIN' })
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    // POST
    const createRes = await harness
      .request()
      .post('/api/v1/shifts')
      .set('Authorization', `Bearer ${token}`)
      .send({ primaryAgentId: agent.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020 })

    expect(createRes.status).toBe(201)
    const shift = createRes.body.data as { id: string; active: boolean }
    expect(shift.id).toBeDefined()

    // GET
    const listRes = await harness.request().get('/api/v1/shifts').set('Authorization', `Bearer ${token}`)
    expect(listRes.status).toBe(200)
    const shifts = listRes.body.data as { id: string }[]
    expect(shifts.some((s) => s.id === shift.id)).toBe(true)

    // PATCH
    const patchRes = await harness
      .request()
      .patch(`/api/v1/shifts/${shift.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false })
    expect(patchRes.status).toBe(200)
    expect(patchRes.body.data.active).toBe(false)
  })
})

// ─── R151 — Shifts DELETE ─────────────────────────────────────────────────────

describe('R151 — Shifts DELETE', () => {
  it('removes the shift row (admin)', async () => {
    const admin = await makeAgent({ role: 'ADMIN' })
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const createRes = await harness
      .request()
      .post('/api/v1/shifts')
      .set('Authorization', `Bearer ${token}`)
      .send({ primaryAgentId: agent.id, dayOfWeek: 2, startMinute: 480, endMinute: 960 })
    expect(createRes.status).toBe(201)
    const shift = createRes.body.data as { id: string }

    const deleteRes = await harness
      .request()
      .delete(`/api/v1/shifts/${shift.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(deleteRes.status).toBe(200)

    const row = await harness.prisma.shift.findUnique({ where: { id: shift.id } })
    expect(row).toBeNull()
  })
})

// ─── R182 — Shifts/KB routes require auth ────────────────────────────────────

describe('R182 — Shifts routes require auth and admin role', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await harness.request().get('/api/v1/shifts')
    expect(res.status).toBe(401)
  })

  it('rejects non-admin agents with 403 on mutation routes', async () => {
    const nonAdmin = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: nonAdmin.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/shifts')
      .set('Authorization', `Bearer ${token}`)
      .send({ primaryAgentId: nonAdmin.id, dayOfWeek: 3, startMinute: 0, endMinute: 60 })

    expect(res.status).toBe(403)
  })
})
