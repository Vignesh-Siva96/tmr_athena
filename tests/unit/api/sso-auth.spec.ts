/**
 * sso-auth.spec — unit tests for AuthService.ssoAuth() and the private
 * verifyExternalJwt() logic it delegates to.
 *
 * No DB, no HTTP, no Docker — dependencies are mocked inline.
 *
 * Regression catalogue rows:
 *   R221 — ssoAuth: valid token issues a session (T1.1)
 *   R222 — ssoAuth: expired token rejected (T1.2)
 *   R223 — ssoAuth: bad signature rejected (T1.3)
 *   R224 — ssoAuth: replayed jti rejected (T1.4)
 *   R225 — ssoAuth: SSO disabled → 401 (T1.5)
 *   R226 — ssoAuth: upsert by externalId, by email, create-new (T1.6)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as crypto from 'crypto'
import { UnauthorizedException } from '@nestjs/common'

// Set env vars before module loads
process.env['EMAIL_CREDS_KEY'] = Buffer.alloc(32, 0xab).toString('hex')
process.env['BETTER_AUTH_SECRET'] = 'test-jwt-secret-that-is-long-enough-123456'

import { AuthService } from '../../../apps/api/src/modules/auth/auth.service'
import { encrypt } from '../../../apps/api/src/common/crypto/credentials-cipher'

// ─── helpers ──────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-sso-shared-secret-32-bytes!!'

function mintJwt(claims: Record<string, unknown>, secret = TEST_SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body   = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    email: 'test@example.com',
    name: 'Test User',
    externalId: 'host-uid-1',
    iat: now,
    exp: now + 120,
    jti: crypto.randomUUID(),
    ...overrides,
  }
}

const BASE_USER = {
  id: 'user-id-1',
  email: 'test@example.com',
  name: 'Test User',
  externalId: 'host-uid-1',
  source: 'SSO',
  category: 'CUSTOMER',
  isVerified: true,
  emailStatus: 'ACTIVE',
  isGuest: false,
  googleId: null,
  avatarUrl: null,
  password: null,
  lastActiveAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ─── factory ──────────────────────────────────────────────────────────────────

function makeService({
  ssoEnabled = true,
  rawSecret = TEST_SECRET as string | null,
  existingByExternalId = null as typeof BASE_USER | null,
  existingByEmail = null as typeof BASE_USER | null,
  replayError = false,
} = {}) {
  const encryptedSecret = rawSecret !== null ? encrypt(rawSecret) : null

  const mockAppConfig = {
    get: vi.fn().mockResolvedValue({ ssoEnabled, ssoSecretEnc: encryptedSecret }),
  }

  const mockDb = {
    ssoUsedToken: {
      create: replayError
        ? vi.fn().mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
        : vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if ('externalId' in where) return Promise.resolve(existingByExternalId)
        if ('email' in where) return Promise.resolve(existingByEmail)
        return Promise.resolve(null)
      }),
      create: vi.fn().mockResolvedValue({ ...BASE_USER }),
      update: vi.fn().mockResolvedValue({ ...BASE_USER }),
    },
  }

  const mockNestConfig = {
    get: vi.fn().mockReturnValue(process.env['BETTER_AUTH_SECRET']),
  }

  const mockQueue = {
    enqueueEmailVerification: vi.fn(),
    enqueueEmailPasswordReset: vi.fn(),
  }

  // Bypass NestJS DI — pass mocks positionally matching the constructor signature:
  // (db, config, queue, appConfigService)
  const service = new (AuthService as unknown as new (...a: unknown[]) => AuthService)(
    mockDb, mockNestConfig, mockQueue, mockAppConfig,
  )

  return { service, mockDb, mockAppConfig }
}

// ─── R221 — valid token issues a session ──────────────────────────────────────

describe('R221 — ssoAuth: valid token issues a session', () => {
  it('returns user, token, isNew=true for a new user', async () => {
    const { service } = makeService()
    const result = await service.ssoAuth({ token: mintJwt(validClaims()) })
    expect(result.token).toBeTruthy()
    expect(result.isNew).toBe(true)
    expect(result.user.email).toBe('test@example.com')
    expect((result.user as Record<string, unknown>)['password']).toBeUndefined()
  })
})

// ─── R222 — expired token rejected ───────────────────────────────────────────

describe('R222 — ssoAuth: expired token rejected', () => {
  it('throws UnauthorizedException for an expired token', async () => {
    const { service } = makeService()
    const now = Math.floor(Date.now() / 1000)
    await expect(
      service.ssoAuth({ token: mintJwt(validClaims({ exp: now - 5 })) }),
    ).rejects.toThrow(UnauthorizedException)
  })
})

// ─── R223 — bad signature rejected ───────────────────────────────────────────

describe('R223 — ssoAuth: bad signature rejected', () => {
  it('throws UnauthorizedException for wrong secret', async () => {
    const { service } = makeService()
    await expect(
      service.ssoAuth({ token: mintJwt(validClaims(), 'completely-wrong-secret-here!!') }),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException for tampered body', async () => {
    const { service } = makeService()
    const token = mintJwt(validClaims())
    const [h, body, sig] = token.split('.')
    const tampered = body!.slice(0, -1) + (body!.slice(-1) === 'A' ? 'B' : 'A')
    await expect(
      service.ssoAuth({ token: `${h}.${tampered}.${sig}` }),
    ).rejects.toThrow(UnauthorizedException)
  })
})

// ─── R224 — replayed jti rejected ────────────────────────────────────────────

describe('R224 — ssoAuth: replayed jti rejected', () => {
  it('throws UnauthorizedException on P2002 (duplicate jti)', async () => {
    const { service } = makeService({ replayError: true })
    await expect(
      service.ssoAuth({ token: mintJwt(validClaims()) }),
    ).rejects.toThrow(UnauthorizedException)
  })
})

// ─── R225 — SSO disabled → 401 ───────────────────────────────────────────────

describe('R225 — ssoAuth: SSO disabled → 401', () => {
  it('throws when ssoEnabled is false', async () => {
    const { service } = makeService({ ssoEnabled: false })
    await expect(
      service.ssoAuth({ token: mintJwt(validClaims()) }),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('throws when ssoSecretEnc is null (not configured)', async () => {
    const { service } = makeService({ rawSecret: null })
    await expect(
      service.ssoAuth({ token: mintJwt(validClaims()) }),
    ).rejects.toThrow(UnauthorizedException)
  })
})

// ─── R226 — upsert logic ──────────────────────────────────────────────────────

describe('R226 — ssoAuth: upsert by externalId, by email, create-new', () => {
  it('finds existing user by externalId → isNew=false', async () => {
    const { service } = makeService({ existingByExternalId: BASE_USER })
    const result = await service.ssoAuth({ token: mintJwt(validClaims()) })
    expect(result.isNew).toBe(false)
  })

  it('falls back to email and backfills externalId when externalId not set → isNew=false', async () => {
    const emailUser = { ...BASE_USER, id: 'email-id', externalId: null }
    const { service, mockDb } = makeService({
      existingByExternalId: null,
      existingByEmail: emailUser as typeof BASE_USER,
    })
    const result = await service.ssoAuth({ token: mintJwt(validClaims()) })
    expect(result.isNew).toBe(false)
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'email-id' },
        data: expect.objectContaining({ externalId: 'host-uid-1' }),
      }),
    )
  })

  it('creates new user when no match found → isNew=true', async () => {
    const { service, mockDb } = makeService({ existingByExternalId: null, existingByEmail: null })
    const result = await service.ssoAuth({ token: mintJwt(validClaims()) })
    expect(result.isNew).toBe(true)
    expect(mockDb.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'SSO', isVerified: true, externalId: 'host-uid-1' }),
      }),
    )
  })
})
