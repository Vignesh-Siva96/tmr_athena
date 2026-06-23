/**
 * files-sync.spec — integration tests for FilesController + EmailSyncController.
 * Poller orchestration is already covered (R112–R118); this covers the HTTP control surface.
 *
 * Regression catalogue rows:
 *   R166 — POST /files/upload multipart: MinIO object + Attachment row (no ticket)
 *   R167 — POST /files/upload link/JSON: Attachment link row
 *   R168 — GET /sync/status: returns archiveStatus/totals from AppConfig
 *   R169 — POST /sync/archive/cancel: archiveStatus → CANCELLED
 *   R170 — POST /sync/archive/resume: archiveStatus → RUNNING (state transition)
 *   R171 — POST /sync/poll/now: invokes pollOne without waiting on cron (returns polled count)
 *   R172 — Sync routes auth boundary: agent guard (401 without token)
 *   R173 — POST /files/upload: persists objectKey on the row (durable handle)
 *   R174 — POST /files/upload: rejects blocked extensions (.exe)
 *   R175 — GET /files/:id/sign: mints a fresh URL; agent any, customer only own ticket (IDOR)
 */

import { harness } from './harness'
import { makeAgent, makeUser, makeTicket, signJwt } from './factories'
import './setup'

async function seedAppConfig(overrides: Record<string, unknown> = {}) {
  return harness.prisma.appConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', appName: 'TMR', emailDisplayName: 'TMR', ...overrides },
    update: { ...overrides },
  })
}

// ─── R166 — POST /files/upload multipart ─────────────────────────────────────

describe('R166 — POST /files/upload multipart', () => {
  it('uploads file to MinIO and creates Attachment row', async () => {
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('hello world'), { filename: 'test.txt', contentType: 'text/plain' })

    expect(res.status).toBe(201)
    expect(res.body.data.attachment).toMatchObject({ isLink: false, mimeType: 'text/plain' })

    const attachment = await harness.prisma.attachment.findFirst({
      orderBy: { createdAt: 'desc' },
    })
    expect(attachment).not.toBeNull()
    expect(attachment!.isLink).toBe(false)
    expect(attachment!.ticketId).toBeNull()
  })
})

// ─── R167 — POST /files/upload link ──────────────────────────────────────────

describe('R167 — POST /files/upload link/JSON', () => {
  it('creates Attachment link row with type LINK', async () => {
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ linkUrl: 'https://example.com/doc.pdf' })

    expect(res.status).toBe(201)
    expect(res.body.data.attachment).toMatchObject({ isLink: true, url: 'https://example.com/doc.pdf' })

    const attachment = await harness.prisma.attachment.findFirst({
      where: { url: 'https://example.com/doc.pdf' },
    })
    expect(attachment).not.toBeNull()
  })
})

// ─── R173 — upload persists objectKey ────────────────────────────────────────

describe('R173 — POST /files/upload persists objectKey', () => {
  it('stores the durable object key on the Attachment row', async () => {
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' })

    expect(res.status).toBe(201)
    const id = res.body.data.attachment.id as string
    const row = await harness.prisma.attachment.findUniqueOrThrow({ where: { id } })
    expect(row.objectKey).toBeTruthy()
    // key = <uuid>.txt, mirrors storeBuffer naming
    expect(row.objectKey).toMatch(/\.txt$/)
  })
})

// ─── R174 — upload rejects blocked extensions ────────────────────────────────

describe('R174 — POST /files/upload rejects .exe', () => {
  it('returns 400 for a blocked extension', async () => {
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('MZ'), { filename: 'malware.exe', contentType: 'application/octet-stream' })

    expect(res.status).toBe(400)
  })
})

// ─── R175 — GET /files/:id/sign (fresh URL + IDOR) ───────────────────────────

describe('R175 — GET /files/:id/sign', () => {
  async function uploadAsAgent(): Promise<string> {
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })
    const res = await harness
      .request()
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('data'), { filename: 'doc.pdf', contentType: 'application/pdf' })
    return res.body.data.attachment.id as string
  }

  it('mints a fresh presigned URL for an agent (any attachment)', async () => {
    const id = await uploadAsAgent()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness.request().get(`/api/v1/files/${id}/sign`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.url).toMatch(/^https?:\/\//)
    // signed URLs carry an expiry signature — confirms it's a fresh presign, not the stored value
    expect(res.body.data.url).toContain('X-Amz-')
  })

  it('lets the owning customer sign, but blocks a different customer (IDOR)', async () => {
    const owner = await makeUser()
    const ticket = await makeTicket({ userId: owner.id })
    // claim an uploaded attachment onto the owner's ticket
    const id = await uploadAsAgent()
    await harness.prisma.attachment.update({ where: { id }, data: { ticketId: ticket.id } })

    const ownerToken = await signJwt({ id: owner.id, role: 'user' })
    const ok = await harness.request().get(`/api/v1/files/${id}/sign`).set('Authorization', `Bearer ${ownerToken}`)
    expect(ok.status).toBe(200)

    const intruder = await makeUser()
    const intruderToken = await signJwt({ id: intruder.id, role: 'user' })
    const denied = await harness.request().get(`/api/v1/files/${id}/sign`).set('Authorization', `Bearer ${intruderToken}`)
    expect(denied.status).toBe(403)
  })

  it('returns 401 without a token', async () => {
    const id = await uploadAsAgent()
    const res = await harness.request().get(`/api/v1/files/${id}/sign`)
    expect(res.status).toBe(401)
  })
})

// ─── R168 — GET /sync/status ─────────────────────────────────────────────────

describe('R168 — GET /sync/status', () => {
  it('returns archiveStatus and totals from AppConfig', async () => {
    await seedAppConfig({ archiveStatus: 'IDLE', archiveTotalSeen: 42, archiveTotalEstimate: 100 })
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness.request().get('/api/v1/sync/status').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.archiveStatus).toBe('IDLE')
    expect(res.body.data.archiveTotalSeen).toBe(42)
  })
})

// ─── R169 — POST /sync/archive/cancel ────────────────────────────────────────

describe('R169 — POST /sync/archive/cancel', () => {
  it('sets archiveStatus to CANCELLED', async () => {
    const cfg = await seedAppConfig({ archiveStatus: 'RUNNING' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post('/api/v1/sync/archive/cancel')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(201)
    expect(res.body.data.cancelled).toBe(true)

    const updated = await harness.prisma.appConfig.findUniqueOrThrow({ where: { id: cfg.id } })
    expect(updated.archiveStatus).toBe('CANCELLED')
  })
})

// ─── R170 — POST /sync/archive/resume ────────────────────────────────────────

describe('R170 — POST /sync/archive/resume', () => {
  it('transitions archiveStatus to RUNNING', async () => {
    const cfg = await seedAppConfig({ archiveStatus: 'CANCELLED' })
    const agent = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: agent.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post('/api/v1/sync/archive/resume')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(201)
    expect(res.body.data.resumed).toBe(true)

    const updated = await harness.prisma.appConfig.findUniqueOrThrow({ where: { id: cfg.id } })
    expect(updated.archiveStatus).toBe('RUNNING')
  })
})

// ─── R171 — POST /sync/poll/now ──────────────────────────────────────────────

describe('R171 — POST /sync/poll/now', () => {
  it('returns polled count (0 when no active OAuth config)', async () => {
    await seedAppConfig({ oauthAccessTokenEnc: null })
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/sync/poll/now')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(201)
    expect(res.body.data.polled).toBe(0)
  })
})

// ─── R172 — Sync routes auth boundary ────────────────────────────────────────

describe('R172 — Sync routes auth boundary', () => {
  it('returns 401 on GET /sync/status without token', async () => {
    const res = await harness.request().get('/api/v1/sync/status')
    expect(res.status).toBe(401)
  })

  it('returns 401 on POST /sync/poll/now without token', async () => {
    const res = await harness.request().post('/api/v1/sync/poll/now')
    expect(res.status).toBe(401)
  })
})
