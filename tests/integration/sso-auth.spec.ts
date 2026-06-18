/**
 * sso-auth.spec — integration tests for POST /auth/sso (SSO handoff flow).
 *
 * Mints real HS256 JWTs against the configured shared secret, exchanges them
 * via the API, and verifies the resulting session token grants portal access.
 *
 * Regression catalogue rows:
 *   R227 — POST /auth/sso end-to-end: valid token → session (T2.6)
 *   R228 — POST /auth/sso: expired token returns 401 (T2.7)
 *   R229 — POST /auth/sso: bad signature returns 401 (T2.8)
 *   R230 — POST /auth/sso: replayed token returns 401 (T2.9)
 *   R231 — POST /auth/sso: disabled SSO returns 401 (T2.10)
 */

import * as crypto from 'crypto'
import { harness } from './harness'
import './setup'
import { encrypt } from '../../apps/api/src/common/crypto/credentials-cipher'

// ─── helpers ──────────────────────────────────────────────────────────────────

const SSO_SECRET = 'integration-test-sso-secret-32!!'

function mintJwt(claims: Record<string, unknown>, secret = SSO_SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body   = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    email: `sso-${crypto.randomUUID()}@example.com`,
    name: 'SSO Test User',
    externalId: `ext-${crypto.randomUUID()}`,
    iat: now,
    exp: now + 120,
    jti: crypto.randomUUID(),
    ...overrides,
  }
}

async function seedSsoConfig(enabled: boolean, secret: string | null) {
  const ssoSecretEnc = secret ? encrypt(secret) : null
  await harness.prisma.appConfig.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      appName: 'TMR',
      emailDisplayName: 'Support',
      ssoEnabled: enabled,
      ssoSecretEnc,
    } as Parameters<typeof harness.prisma.appConfig.upsert>[0]['create'],
    update: { ssoEnabled: enabled, ssoSecretEnc },
  })
}

// ─── R227 — valid token → session ─────────────────────────────────────────────

describe('R227 — POST /auth/sso end-to-end', () => {
  it('exchanges a valid handoff token for a portal session', async () => {
    await seedSsoConfig(true, SSO_SECRET)
    const claims = validClaims()
    const token  = mintJwt(claims)

    const { body } = await harness.request()
      .post('/api/v1/auth/sso')
      .send({ token })
      .expect(200)

    expect(body.data.token).toBeTruthy()
    expect(body.data.user.email).toBe(claims['email'])
    expect(body.data.isNew).toBe(true)

    // The issued session token must allow GET /tickets
    await harness.request()
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${body.data.token}`)
      .expect(200)
  })
})

// ─── R228 — expired token → 401 ──────────────────────────────────────────────

describe('R228 — POST /auth/sso: expired token', () => {
  it('returns 401', async () => {
    await seedSsoConfig(true, SSO_SECRET)
    const now = Math.floor(Date.now() / 1000)
    const token = mintJwt(validClaims({ exp: now - 10 }))
    await harness.request().post('/api/v1/auth/sso').send({ token }).expect(401)
  })
})

// ─── R229 — bad signature → 401 ──────────────────────────────────────────────

describe('R229 — POST /auth/sso: bad signature', () => {
  it('returns 401 when signed with the wrong secret', async () => {
    await seedSsoConfig(true, SSO_SECRET)
    const token = mintJwt(validClaims(), 'wrong-secret-completely-different!!')
    await harness.request().post('/api/v1/auth/sso').send({ token }).expect(401)
  })
})

// ─── R230 — replayed token → 401 ─────────────────────────────────────────────

describe('R230 — POST /auth/sso: replayed token', () => {
  it('returns 401 on second use of the same jti', async () => {
    await seedSsoConfig(true, SSO_SECRET)
    const token = mintJwt(validClaims())

    // First exchange succeeds
    await harness.request().post('/api/v1/auth/sso').send({ token }).expect(200)

    // Second exchange must be rejected
    await harness.request().post('/api/v1/auth/sso').send({ token }).expect(401)
  })
})

// ─── R231 — SSO disabled → 401 ───────────────────────────────────────────────

describe('R231 — POST /auth/sso: SSO disabled', () => {
  it('returns 401 when ssoEnabled is false', async () => {
    await seedSsoConfig(false, SSO_SECRET)
    const token = mintJwt(validClaims())
    await harness.request().post('/api/v1/auth/sso').send({ token }).expect(401)
  })
})
