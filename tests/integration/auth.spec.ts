/**
 * auth.spec — integration tests for AuthController + AuthService.
 *
 * Google idToken HTTP verify (googleAuth / agentGoogleAuth) is a hard seam —
 * those paths are deferred to a later E2E pass.
 *
 * Regression catalogue rows:
 *   R126 — POST /auth/signup: User row created, password hashed, JWT returned & verifiable
 *   R127 — POST /auth/signin correct password: JWT returned
 *   R128 — POST /auth/signin wrong password: 401, no token
 *   R129 — POST /auth/guest: guest User (isGuest=true), JWT
 *   R130 — POST /auth/magic-link: endpoint removed (404) — was dead code, never sent email
 *   R131 — POST /auth/agent/signin valid / invalid: agent JWT / 401
 *   R132 — Issued JWT works against a guarded route end-to-end
 *   R187 — signup / signin / guest responses never include password field (T1.6)
 *   R188 — POST /auth/guest with a real (non-guest) account email → 201 (A4 fix; previously 409)
 *   R195 — GET /tickets with guest token → 403 (NoGuestsGuard enforced)
 */

import * as crypto from 'crypto'
import { harness } from './harness'
import { makeUser, makeAgent, makeTicket } from './factories'
import './setup'

/** Hash a password using the same algorithm as AuthService.hashPassword (hex-string salt). */
async function hashForService(plain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex')
    crypto.scrypt(plain, salt, 64, (err, key) => {
      if (err) reject(err)
      else resolve(`${salt}:${(key as Buffer).toString('hex')}`)
    })
  })
}

function decodeJwt(token: string): Record<string, unknown> {
  const [, payload] = token.split('.')
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>
}

// ─── R126 — signup ────────────────────────────────────────────────────────────

describe('R126 — POST /auth/signup', () => {
  it('creates user row, hashes password, returns verifiable JWT', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/signup')
      .send({ email: 'new@example.com', password: 'T3st!pass1', name: 'New User' })

    expect(res.status).toBe(201)
    const { user, token } = res.body.data as { user: Record<string, unknown>; token: string }

    expect(user.email).toBe('new@example.com')
    expect(user.password).not.toBe('T3st!pass1')
    expect(typeof token).toBe('string')

    const payload = decodeJwt(token)
    expect(payload.role).toBe('user')
    expect(payload.sub).toBe(user.id)

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: user.id as string } })
    expect(row.password).not.toBe('T3st!pass1')
    expect(row.password).toContain(':')
  })
})

// ─── R127 — signin correct ────────────────────────────────────────────────────

describe('R127 — POST /auth/signin correct password', () => {
  it('returns user + JWT', async () => {
    // Create via signup so the password is hashed with the service's own algorithm
    const signupRes = await harness
      .request()
      .post('/api/v1/auth/signup')
      .send({ email: 'signin@example.com', password: 'C0rrect!pw', name: 'Signin User' })
    expect(signupRes.status).toBe(201)
    const user = signupRes.body.data.user as Record<string, unknown>

    const res = await harness
      .request()
      .post('/api/v1/auth/signin')
      .send({ email: 'signin@example.com', password: 'C0rrect!pw' })

    expect(res.status).toBe(200)
    const { token } = res.body.data as { token: string }
    expect(typeof token).toBe('string')

    const payload = decodeJwt(token)
    expect(payload.sub).toBe(user.id)
    expect(payload.role).toBe('user')
  })
})

// ─── R128 — signin wrong password ─────────────────────────────────────────────

describe('R128 — POST /auth/signin wrong password', () => {
  it('returns 401 with no token', async () => {
    await makeUser({ email: 'wrong@example.com', password: 'real-password' })

    const res = await harness
      .request()
      .post('/api/v1/auth/signin')
      .send({ email: 'wrong@example.com', password: 'wrong-password' })

    expect(res.status).toBe(401)
    expect(res.body.data?.token).toBeUndefined()
  })
})

// ─── R129 — guest session ─────────────────────────────────────────────────────

describe('R129 — POST /auth/guest', () => {
  it('creates/finds guest User (isGuest=true) and returns JWT', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/guest')
      .send({ email: 'guest@example.com' })

    expect(res.status).toBe(201)
    const { guestToken, email } = res.body.data as { guestToken: string; email: string }
    expect(email).toBe('guest@example.com')
    expect(typeof guestToken).toBe('string')

    const payload = decodeJwt(guestToken)
    expect(payload.isGuest).toBe(true)

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { email: 'guest@example.com' } })
    expect(row.isGuest).toBe(true)
  })
})

// ─── R130 — magic-link removed ───────────────────────────────────────────────
// The endpoint was dead code (never sent an email, no verify endpoint existed).
// It was removed in T2.4 remediation. The route now returns 404.

describe('R130 — POST /auth/magic-link endpoint removed', () => {
  it('returns 404 — endpoint was dead and has been removed', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/magic-link')
      .send({ email: 'any@example.com' })

    expect(res.status).toBe(404)
  })
})

// ─── R131 — agent/signin ──────────────────────────────────────────────────────

describe('R131 — POST /auth/agent/signin', () => {
  it('valid credentials return agent JWT', async () => {
    // Insert agent with a password hashed using the service's algorithm (hex-string salt)
    const hashedPw = await hashForService('agent-pw')
    const agent = await harness.prisma.agent.create({
      data: {
        email: 'agent@example.com',
        name: 'Test Agent',
        password: hashedPw,
        role: 'SECONDARY_AGENT',
        isActive: true,
        inviteAccepted: true,
      },
    })

    const res = await harness
      .request()
      .post('/api/v1/auth/agent/signin')
      .send({ email: 'agent@example.com', password: 'agent-pw' })

    expect(res.status).toBe(200)
    const { token } = res.body.data as { token: string }
    expect(typeof token).toBe('string')

    const payload = decodeJwt(token)
    expect(payload.sub).toBe(agent.id)
    expect(payload.role).toBe('agent')
  })

  it('wrong password returns 401', async () => {
    const hashedPw = await hashForService('agent-pw')
    await harness.prisma.agent.create({
      data: {
        email: 'badpw@example.com',
        name: 'Test Agent 2',
        password: hashedPw,
        role: 'SECONDARY_AGENT',
        isActive: true,
        inviteAccepted: true,
      },
    })

    const res = await harness
      .request()
      .post('/api/v1/auth/agent/signin')
      .send({ email: 'badpw@example.com', password: 'wrong' })

    expect(res.status).toBe(401)
    expect(res.body.data?.token).toBeUndefined()
  })
})

// ─── R132 — issued JWT works on guarded route ─────────────────────────────────

describe('R132 — issued JWT works on guarded route end-to-end', () => {
  it('signup token passes auth on /tickets (list)', async () => {
    const signupRes = await harness
      .request()
      .post('/api/v1/auth/signup')
      .send({ email: 'verified@example.com', password: 'T3st!pass1' })

    expect(signupRes.status).toBe(201)
    const { token } = signupRes.body.data as { token: string }

    const res = await harness
      .request()
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })
})

// ─── R187 — no password in auth responses (T1.6) ─────────────────────────────

describe('R187 — auth responses never include password hash', () => {
  it('POST /auth/signup response has no password field', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/signup')
      .send({ email: 'nopw-signup@example.com', password: 'S3cr3t!pw' })

    expect(res.status).toBe(201)
    const { user } = res.body.data as { user: Record<string, unknown> }
    expect(user.password).toBeUndefined()
  })

  it('POST /auth/signin response has no password field', async () => {
    await harness
      .request()
      .post('/api/v1/auth/signup')
      .send({ email: 'nopw-signin@example.com', password: 'S3cr3t!pw' })

    const res = await harness
      .request()
      .post('/api/v1/auth/signin')
      .send({ email: 'nopw-signin@example.com', password: 'S3cr3t!pw' })

    expect(res.status).toBe(200)
    const { user } = res.body.data as { user: Record<string, unknown> }
    expect(user.password).toBeUndefined()
  })

  it('POST /auth/guest response has no password field', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/guest')
      .send({ email: 'nopw-guest@example.com' })

    expect(res.status).toBe(201)
    // guest response shape: { guestToken, email } — no user object, no password
    expect(res.body.data.password).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('"password"')
  })

  it('POST /auth/agent/signin response has no password field', async () => {
    // Use the same hash approach as R131 (scrypt, hex-encoded salt) to ensure
    // the stored hash is compatible with AuthService.verifyPassword.
    const hashedPw = await hashForService('r187-agent-pw')
    await harness.prisma.agent.create({
      data: {
        email: 'r187agent@example.com',
        name: 'R187 Agent',
        password: hashedPw,
        role: 'SECONDARY_AGENT',
        isActive: true,
        inviteAccepted: true,
      },
    })

    const res = await harness
      .request()
      .post('/api/v1/auth/agent/signin')
      .send({ email: 'r187agent@example.com', password: 'r187-agent-pw' })

    expect(res.status).toBe(200)
    const { agent: responseAgent } = res.body.data as { agent: Record<string, unknown> }
    expect(responseAgent?.password).toBeUndefined()
  })
})

// ─── R188 — guest session: allows real user email (A4 fix) ──────────────────
// Previously returned 409; now binds a guest token to the existing user ID.
// The NoGuestsGuard on protected endpoints prevents misuse.

describe('R188 — POST /auth/guest with an existing real account (A4 regression)', () => {
  it('succeeds (201) and returns a guest token bound to the existing account', async () => {
    // Create a real password-based account first
    await harness
      .request()
      .post('/api/v1/auth/signup')
      .send({ email: 'real-user@example.com', password: 'T3st!pass1', name: 'Real User' })

    // Guest session for the same email must now succeed
    const res = await harness
      .request()
      .post('/api/v1/auth/guest')
      .send({ email: 'real-user@example.com' })

    expect(res.status).toBe(201)
    const { guestToken } = res.body.data as { guestToken: string }
    expect(typeof guestToken).toBe('string')

    // isGuest must be true in the token, and the user row must NOT be flipped
    const payload = decodeJwt(guestToken)
    expect(payload.isGuest).toBe(true)
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { email: 'real-user@example.com' } })
    expect(row.isGuest).toBe(false) // real account's isGuest flag is unchanged
  })

  it('guest session succeeds for an address that has no existing account', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/guest')
      .send({ email: 'brand-new-guest@example.com' })

    expect(res.status).toBe(201)
    expect(res.body.data.guestToken).toBeDefined()
  })

  it('guest session re-uses an existing guest record without error', async () => {
    // First call creates the guest
    await harness
      .request()
      .post('/api/v1/auth/guest')
      .send({ email: 'repeat-guest@example.com' })

    // Second call re-uses it (idempotent)
    const res = await harness
      .request()
      .post('/api/v1/auth/guest')
      .send({ email: 'repeat-guest@example.com' })

    expect(res.status).toBe(201)
    expect(res.body.data.guestToken).toBeDefined()

    // Should still be exactly one user row for this email
    const count = await harness.prisma.user.count({ where: { email: 'repeat-guest@example.com' } })
    expect(count).toBe(1)
  })
})

// ─── R195 — NoGuestsGuard: GET /tickets blocked for guest tokens ──────────────

describe('R195 — NoGuestsGuard: GET /tickets returns 403 for guest token', () => {
  it('guest token is denied access to the tickets list', async () => {
    const guestRes = await harness
      .request()
      .post('/api/v1/auth/guest')
      .send({ email: 'tickets-guard-guest@example.com' })

    expect(guestRes.status).toBe(201)
    const { guestToken } = guestRes.body.data as { guestToken: string }

    const ticketsRes = await harness
      .request()
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${guestToken}`)

    expect(ticketsRes.status).toBe(403)
  })
})
