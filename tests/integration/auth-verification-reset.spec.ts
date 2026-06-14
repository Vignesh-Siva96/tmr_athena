/**
 * auth-verification-reset.spec — integration tests for email verification and
 * forgot/reset-password flows added on top of the existing auth module.
 *
 * Regression catalogue rows:
 *   R204 — POST /auth/signup creates an EMAIL_VERIFICATION MagicToken and enqueues email:send-verification
 *   R205 — POST /auth/verify-email flips isVerified and rejects expired/used/wrong-type tokens
 *   R206 — POST /auth/resend-verification re-issues a token for unverified users, no-ops if already verified
 *   R207 — POST /auth/forgot-password always returns 200 (no enumeration); only enqueues for real accounts with a password
 *   R208 — POST /auth/reset-password updates the password hash + sets isVerified, rejects invalid tokens
 *   R209 — googleAuth sets isVerified=true for newly created and newly linked Google users
 */

import { harness } from './harness'
import { makeUser, signJwt } from './factories'
import './setup'

async function jobCountForQueue(queueName: string): Promise<number> {
  const rows = await harness.prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) as count FROM pgboss.job WHERE name = $1`,
    queueName,
  )
  return Number(rows[0]?.count ?? 0)
}

// ─── R204 — signup issues verification token + enqueues email ────────────────

describe('R204 — POST /auth/signup issues an EMAIL_VERIFICATION token and enqueues email:send-verification', () => {
  it('creates a MagicToken row and enqueues the verification job', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/signup')
      .send({ email: 'verify-me@example.com', password: 'T3st!pass1' })

    expect(res.status).toBe(201)
    const { user } = res.body.data as { user: { id: string; isVerified: boolean } }
    expect(user.isVerified).toBe(false)

    const tokenRow = await harness.prisma.magicToken.findFirst({ where: { userId: user.id, type: 'EMAIL_VERIFICATION' } })
    expect(tokenRow).not.toBeNull()
    expect(tokenRow?.usedAt).toBeNull()

    expect(await jobCountForQueue('email:send-verification')).toBeGreaterThan(0)
  })
})

// ─── R205 — verify-email ──────────────────────────────────────────────────────

describe('R205 — POST /auth/verify-email', () => {
  it('flips isVerified to true for a valid token', async () => {
    const user = await makeUser({ email: 'r205-valid@example.com', isVerified: false })
    const token = 'r205-valid-token'
    await harness.prisma.magicToken.create({
      data: { userId: user.id, type: 'EMAIL_VERIFICATION', token, expiresAt: new Date(Date.now() + 60_000) },
    })

    const res = await harness
      .request()
      .post('/api/v1/auth/verify-email')
      .send({ token })

    expect(res.status).toBe(200)
    const { isVerified } = res.body.data as { isVerified: boolean }
    expect(isVerified).toBe(true)

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.isVerified).toBe(true)

    const tokenRow = await harness.prisma.magicToken.findUniqueOrThrow({ where: { token } })
    expect(tokenRow.usedAt).not.toBeNull()
  })

  it('rejects an expired token (401)', async () => {
    const user = await makeUser({ email: 'r205-expired@example.com', isVerified: false })
    const token = 'r205-expired-token'
    await harness.prisma.magicToken.create({
      data: { userId: user.id, type: 'EMAIL_VERIFICATION', token, expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await harness
      .request()
      .post('/api/v1/auth/verify-email')
      .send({ token })

    expect(res.status).toBe(401)
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.isVerified).toBe(false)
  })

  it('rejects an already-used token (401)', async () => {
    const user = await makeUser({ email: 'r205-used@example.com', isVerified: false })
    const token = 'r205-used-token'
    await harness.prisma.magicToken.create({
      data: { userId: user.id, type: 'EMAIL_VERIFICATION', token, expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() },
    })

    const res = await harness
      .request()
      .post('/api/v1/auth/verify-email')
      .send({ token })

    expect(res.status).toBe(401)
  })

  it('rejects a token of the wrong type (401)', async () => {
    const user = await makeUser({ email: 'r205-wrongtype@example.com', isVerified: false })
    const token = 'r205-wrongtype-token'
    await harness.prisma.magicToken.create({
      data: { userId: user.id, type: 'PASSWORD_RESET', token, expiresAt: new Date(Date.now() + 60_000) },
    })

    const res = await harness
      .request()
      .post('/api/v1/auth/verify-email')
      .send({ token })

    expect(res.status).toBe(401)
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.isVerified).toBe(false)
  })
})

// ─── R206 — resend-verification ───────────────────────────────────────────────

describe('R206 — POST /auth/resend-verification', () => {
  it('re-issues a token and enqueues email for an unverified user', async () => {
    const signupRes = await harness
      .request()
      .post('/api/v1/auth/signup')
      .send({ email: 'resend-me@example.com', password: 'T3st!pass1' })
    const { token: authToken, user } = signupRes.body.data as { token: string; user: { id: string } }

    const beforeCount = await harness.prisma.magicToken.count({ where: { userId: user.id, type: 'EMAIL_VERIFICATION' } })

    const res = await harness
      .request()
      .post('/api/v1/auth/resend-verification')
      .set('Authorization', `Bearer ${authToken}`)
      .send({})

    expect(res.status).toBe(200)
    expect((res.body.data as { sent: boolean }).sent).toBe(true)

    const afterCount = await harness.prisma.magicToken.count({ where: { userId: user.id, type: 'EMAIL_VERIFICATION' } })
    expect(afterCount).toBe(beforeCount + 1)
  })

  it('no-ops for an already-verified user', async () => {
    const user = await makeUser({ email: 'already-verified@example.com', password: 'whatever-pw', isVerified: true })
    const authToken = await signJwt({ id: user.id, role: 'user' })

    const beforeCount = await harness.prisma.magicToken.count({ where: { userId: user.id, type: 'EMAIL_VERIFICATION' } })

    const res = await harness
      .request()
      .post('/api/v1/auth/resend-verification')
      .set('Authorization', `Bearer ${authToken}`)
      .send({})

    expect(res.status).toBe(200)
    expect((res.body.data as { sent: boolean }).sent).toBe(false)

    const afterCount = await harness.prisma.magicToken.count({ where: { userId: user.id, type: 'EMAIL_VERIFICATION' } })
    expect(afterCount).toBe(beforeCount)
  })
})

// ─── R207 — forgot-password (no enumeration) ──────────────────────────────────

describe('R207 — POST /auth/forgot-password', () => {
  it('returns 200 for an unknown email and does not enqueue a job', async () => {
    const before = await jobCountForQueue('email:send-password-reset')

    const res = await harness
      .request()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'no-such-account@example.com' })

    expect(res.status).toBe(200)
    const after = await jobCountForQueue('email:send-password-reset')
    expect(after).toBe(before)
  })

  it('returns 200 for a real account and enqueues a PASSWORD_RESET token + email', async () => {
    const user = await makeUser({ email: 'reset-flow@example.com', password: 'OldPassw0rd!' })

    const res = await harness
      .request()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'reset-flow@example.com' })

    expect(res.status).toBe(200)

    const tokenRow = await harness.prisma.magicToken.findFirst({ where: { userId: user.id, type: 'PASSWORD_RESET' } })
    expect(tokenRow).not.toBeNull()
    expect(await jobCountForQueue('email:send-password-reset')).toBeGreaterThan(0)
  })
})

// ─── R208 — reset-password ─────────────────────────────────────────────────────

describe('R208 — POST /auth/reset-password', () => {
  it('updates the password hash, sets isVerified, and signin works with the new password', async () => {
    const user = await makeUser({ email: 'do-reset@example.com', password: 'OldPassw0rd!', isVerified: false })
    const token = 'r208-reset-token'
    await harness.prisma.magicToken.create({
      data: { userId: user.id, type: 'PASSWORD_RESET', token, expiresAt: new Date(Date.now() + 60_000) },
    })

    const res = await harness
      .request()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'NewPassw0rd!' })

    expect(res.status).toBe(200)

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.isVerified).toBe(true)
    expect(row.password).not.toBe(user.password)

    const signinRes = await harness
      .request()
      .post('/api/v1/auth/signin')
      .send({ email: 'do-reset@example.com', password: 'NewPassw0rd!' })
    expect(signinRes.status).toBe(200)
  })

  it('rejects an invalid token (401)', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/reset-password')
      .send({ token: 'does-not-exist', password: 'NewPassw0rd!' })

    expect(res.status).toBe(401)
  })

  it('rejects a token already consumed (single-use)', async () => {
    const user = await makeUser({ email: 'r208-single-use@example.com', password: 'OldPassw0rd!' })
    const token = 'r208-single-use-token'
    await harness.prisma.magicToken.create({
      data: { userId: user.id, type: 'PASSWORD_RESET', token, expiresAt: new Date(Date.now() + 60_000) },
    })

    const first = await harness
      .request()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'NewPassw0rd!' })
    expect(first.status).toBe(200)

    const second = await harness
      .request()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'AnotherPassw0rd!' })
    expect(second.status).toBe(401)
  })
})

// ─── R209 — googleAuth sets isVerified ─────────────────────────────────────────

describe('R209 — POST /auth/google sets isVerified=true', () => {
  it('a brand-new Google user is created with isVerified=true', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/google')
      .send({ code: 'good-code', redirectUri: 'http://localhost:3000/auth/callback' })

    expect(res.status).toBe(200)
    const { user } = res.body.data as { user: { isVerified: boolean; email: string } }
    expect(user.isVerified).toBe(true)

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { email: user.email } })
    expect(row.isVerified).toBe(true)
  })

  it('linking an existing unverified account to Google sets isVerified=true', async () => {
    await makeUser({ email: 'test.user@example.com', password: 'SomePassw0rd!', isVerified: false })

    const res = await harness
      .request()
      .post('/api/v1/auth/google')
      .send({ code: 'good-code', redirectUri: 'http://localhost:3000/auth/callback' })

    expect(res.status).toBe(200)
    const { user } = res.body.data as { user: { isVerified: boolean } }
    expect(user.isVerified).toBe(true)
  })
})
