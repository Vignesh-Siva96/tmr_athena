/**
 * config.spec — integration tests for ConfigController + AppConfigService.
 *
 * Regression catalogue rows:
 *   R133 — GET /config (getSafe): omits secrets, exposes oauthConnected + botKeySet booleans
 *   R134 — PATCH /config admin: updates appName/colors/botEnabled
 *   R135 — PATCH /config non-admin / no token: 403 / 401
 *   R136 — get() when no config exists: creates default singleton
 *   R137 — GET /config/extract-brand?url=: returns colors from mocked HTML (no auth required)
 *   R138 — findActiveOauth(): returns rows where oauthAccessTokenEnc != null only
 *   R189 — PATCH /config with botApiKeyEnc stores encrypted value, not plaintext (T1.6)
 *   R190 — POST /config/logo uploads file to MinIO and stores URL (T2.4)
 *   R196 — PATCH /config: field1Label/field1Options/field2Label/field2Options round-trip
 */

// assertPublicUrl (the SSRF guard wrapping extractBrand's fetch) DNS-resolves the host
// before the MSW-intercepted fetch runs. Stub `lookup` so the fake `brand.example.com`
// host resolves to a public address instead of failing with NXDOMAIN.
const mockLookup = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
jest.mock('node:dns/promises', () => ({
  ...jest.requireActual('node:dns/promises'),
  lookup: (...args: unknown[]) => mockLookup(...args),
}))

import { http, HttpResponse } from 'msw'
import { harness } from './harness'
import { makeAgent, signJwt } from './factories'
import './setup'
import { mswServer } from './setup'
import { AppConfigService } from '../../apps/api/src/modules/config/config.service'

async function seedAppConfig(overrides: Record<string, unknown> = {}) {
  return harness.prisma.appConfig.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      appName: 'TMR',
      emailDisplayName: 'TMR',
      ...overrides,
    },
    update: {
      appName: 'TMR',
      emailDisplayName: 'TMR',
      ...overrides,
    },
  })
}

// ─── R133 — GET /config secret redaction ─────────────────────────────────────

describe('R133 — GET /config secret redaction', () => {
  it('omits token fields; exposes oauthConnected + botKeySet booleans', async () => {
    await seedAppConfig({
      oauthAccessTokenEnc: 'enc-access-token',
      oauthRefreshTokenEnc: 'enc-refresh-token',
      botApiKeyEnc: 'enc-bot-key',
    })

    const res = await harness.request().get('/api/v1/config')

    expect(res.status).toBe(200)
    const cfg = res.body.data as Record<string, unknown>
    expect(cfg.oauthAccessTokenEnc).toBeUndefined()
    expect(cfg.oauthRefreshTokenEnc).toBeUndefined()
    expect(cfg.botApiKeyEnc).toBeUndefined()
    expect(cfg.oauthConnected).toBe(true)
    expect(cfg.botKeySet).toBe(true)
  })

  it('oauthConnected=false and botKeySet=false when fields are null', async () => {
    await seedAppConfig({ oauthAccessTokenEnc: null, oauthRefreshTokenEnc: null, botApiKeyEnc: null })

    const res = await harness.request().get('/api/v1/config')

    expect(res.status).toBe(200)
    const cfg = res.body.data as Record<string, unknown>
    expect(cfg.oauthConnected).toBe(false)
    expect(cfg.botKeySet).toBe(false)
  })
})

// ─── R134 — PATCH /config admin ──────────────────────────────────────────────

describe('R134 — PATCH /config admin update', () => {
  it('updates appName and returns updated safe config', async () => {
    await seedAppConfig()
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .patch('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ appName: 'NewName', primaryColor: '#123456' })

    expect(res.status).toBe(200)
    const cfg = res.body.data as Record<string, unknown>
    expect(cfg.appName).toBe('NewName')
    expect(cfg.primaryColor).toBe('#123456')

    const row = await harness.prisma.appConfig.findFirst()
    expect(row!.appName).toBe('NewName')
  })
})

// ─── R135 — PATCH /config auth boundary ──────────────────────────────────────

describe('R135 — PATCH /config auth boundary', () => {
  it('non-admin agent returns 403', async () => {
    await seedAppConfig()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .patch('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ appName: 'Hacked' })

    expect(res.status).toBe(403)
  })

  it('no token returns 401', async () => {
    const res = await harness
      .request()
      .patch('/api/v1/config')
      .send({ appName: 'Hacked' })

    expect(res.status).toBe(401)
  })
})

// ─── R136 — get() creates default when no config exists ──────────────────────

describe('R136 — get() creates default singleton when none exists', () => {
  it('GET /config creates and returns default row', async () => {
    // Table is truncated before each test — no AppConfig exists
    const res = await harness.request().get('/api/v1/config')

    expect(res.status).toBe(200)
    const cfg = res.body.data as Record<string, unknown>
    expect(typeof cfg.appName).toBe('string')
    expect(cfg.oauthConnected).toBe(false)

    const row = await harness.prisma.appConfig.findFirst()
    expect(row).not.toBeNull()
  })
})

// ─── R137 — GET /config/extract-brand?url= ───────────────────────────────────

describe('R137 — GET /config/extract-brand', () => {
  it('returns colors from MSW-mocked HTML (no auth required)', async () => {
    mswServer.use(
      http.get('https://brand.example.com/', () =>
        HttpResponse.html(
          `<html><head><meta name="theme-color" content="#FF5722"></head><body></body></html>`,
        ),
      ),
    )

    const res = await harness
      .request()
      .get('/api/v1/config/extract-brand')
      .query({ url: 'https://brand.example.com/' })

    expect(res.status).toBe(200)
    const { colors } = res.body.data as { colors: { hex: string }[] }
    expect(colors.some((c) => c.hex === '#FF5722')).toBe(true)
  })
})

// ─── R138 — findActiveOauth() ─────────────────────────────────────────────────

describe('R138 — findActiveOauth()', () => {
  it('returns only rows where oauthAccessTokenEnc is not null', async () => {
    // Row 1: has tokens
    await harness.prisma.appConfig.create({
      data: {
        id: 'cfg-with-oauth',
        appName: 'With OAuth',
        oauthAccessTokenEnc: 'some-token',
      },
    })

    const svc = harness.get<AppConfigService>(AppConfigService)
    const results = await svc.findActiveOauth()

    expect(results.every((r) => r.oauthAccessTokenEnc !== null)).toBe(true)
    expect(results.some((r) => r.id === 'cfg-with-oauth')).toBe(true)
  })
})

// ─── R189 — botApiKey stored encrypted (T1.6) ────────────────────────────────

describe('R189 — PATCH /config: botApiKeyEnc stored encrypted, not plaintext', () => {
  it('raw key is never persisted — encrypted ciphertext stored instead', async () => {
    await seedAppConfig()
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const rawKey = 'my-plaintext-gemini-api-key-12345'

    const res = await harness
      .request()
      .patch('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ botApiKeyEnc: rawKey })

    expect(res.status).toBe(200)
    // getSafe() must show botKeySet=true but not expose the value
    expect(res.body.data.botKeySet).toBe(true)
    expect(res.body.data.botApiKeyEnc).toBeUndefined()

    // The raw value must not be stored in the DB
    const row = await harness.prisma.appConfig.findFirst()
    expect(row!.botApiKeyEnc).not.toBe(rawKey)
    expect(row!.botApiKeyEnc).not.toBeNull()
    // AES-256-GCM: encrypted as base64(iv || tag || ciphertext) — longer than the raw key
    expect((row!.botApiKeyEnc as string).length).toBeGreaterThan(rawKey.length)
  })

  it('setting botApiKeyEnc to null clears the key and sets botKeySet=false', async () => {
    await seedAppConfig({ botApiKeyEnc: 'some-encrypted-key' })
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .patch('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ botApiKeyEnc: null })

    expect(res.status).toBe(200)
    expect(res.body.data.botKeySet).toBe(false)

    const row = await harness.prisma.appConfig.findFirst()
    expect(row!.botApiKeyEnc).toBeNull()
  })
})

// ─── R190 — POST /config/logo uploads to MinIO (T2.4) ────────────────────────

describe('R190 — POST /config/logo: file uploaded to MinIO and URL persisted', () => {
  it('returns the MinIO URL and stores it in AppConfig.logoUrl', async () => {
    await seedAppConfig()
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post('/api/v1/config/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('logo', Buffer.from('fake-png-bytes'), { filename: 'logo.png', contentType: 'image/png' })

    expect(res.status).toBe(201)
    // updateLogo returns the full AppConfig which gets wrapped by TransformResponseInterceptor
    const cfg = res.body.data as Record<string, unknown>
    const url = cfg.logoUrl as string
    // URL must be non-empty and not a broken local /uploads/ path
    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
    expect(url).not.toMatch(/^\/uploads\//)

    // Persisted in DB
    const row = await harness.prisma.appConfig.findFirst()
    expect(row!.logoUrl).toBe(url)
  })

  it('returns 400 when no file is attached', async () => {
    await seedAppConfig()
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post('/api/v1/config/logo')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
  })

  it('non-admin gets 403', async () => {
    await seedAppConfig()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/config/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('logo', Buffer.from('fake-png-bytes'), { filename: 'logo.png', contentType: 'image/png' })

    expect(res.status).toBe(403)
  })
})

// ─── R196 — PATCH /config: dropdown fields round-trip ────────────────────────

describe('R196 — PATCH /config: field1/field2 dropdown fields stored and returned', () => {
  it('stores label + options array and returns them in GET /config', async () => {
    await seedAppConfig()
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const opts = [
      { value: 'opt-a', label: 'Option A' },
      { value: 'opt-b', label: 'Option B', icon: 'icon-key' },
    ]

    const patch = await harness
      .request()
      .patch('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ field1Label: 'Product', field1Options: opts, field2Label: 'Category', field2Options: [] })

    expect(patch.status).toBe(200)

    const get = await harness.request().get('/api/v1/config')
    const cfg = get.body.data as Record<string, unknown>
    expect(cfg.field1Label).toBe('Product')
    expect(cfg.field2Label).toBe('Category')
    expect(cfg.field1Options).toEqual(opts)
    expect(cfg.field2Options).toEqual([])
  })

  it('rejects invalid option shape (missing label)', async () => {
    await seedAppConfig()
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .patch('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ field1Options: [{ value: 'x' }] }) // label missing

    expect(res.status).toBe(400)
  })
})
