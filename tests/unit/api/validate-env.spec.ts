/**
 * validate-env.spec — unit tests for boot-time env validation (T1.3).
 *
 * Regression catalogue rows:
 *   R185 — validateEnv throws when BETTER_AUTH_SECRET is missing or too short
 */

import { describe, it, expect } from 'vitest'
import { validateEnv } from '../../../apps/api/src/common/config/validate-env'
import { MIN_JWT_SECRET_LENGTH } from '../../../apps/api/src/common/auth/jwt-secret'

// ─── R185 — validateEnv ───────────────────────────────────────────────────────

describe('R185 — validateEnv: BETTER_AUTH_SECRET presence and length', () => {
  it('throws when BETTER_AUTH_SECRET is absent', () => {
    expect(() => validateEnv({})).toThrow(/BETTER_AUTH_SECRET/)
  })

  it('throws when BETTER_AUTH_SECRET is too short', () => {
    const tooShort = 'a'.repeat(MIN_JWT_SECRET_LENGTH - 1)
    expect(() => validateEnv({ BETTER_AUTH_SECRET: tooShort })).toThrow(/BETTER_AUTH_SECRET/)
  })

  it('throws when BETTER_AUTH_SECRET is exactly one character below the minimum', () => {
    expect(() => validateEnv({ BETTER_AUTH_SECRET: 'x'.repeat(31) })).toThrow(/BETTER_AUTH_SECRET/)
  })

  it('accepts BETTER_AUTH_SECRET at exactly the minimum length', () => {
    const exact = 'a'.repeat(MIN_JWT_SECRET_LENGTH)
    const result = validateEnv({ BETTER_AUTH_SECRET: exact, OTHER_VAR: 'ignored' })
    expect(result.BETTER_AUTH_SECRET).toBe(exact)
    expect(result.OTHER_VAR).toBe('ignored')
  })

  it('accepts BETTER_AUTH_SECRET longer than the minimum', () => {
    const long = 'a'.repeat(MIN_JWT_SECRET_LENGTH * 2)
    expect(() => validateEnv({ BETTER_AUTH_SECRET: long })).not.toThrow()
  })

  it('throws when BETTER_AUTH_SECRET is a non-string (number)', () => {
    expect(() => validateEnv({ BETTER_AUTH_SECRET: 99999 })).toThrow(/BETTER_AUTH_SECRET/)
  })
})
