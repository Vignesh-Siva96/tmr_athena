import { describe, it, expect, vi } from 'vitest'
import { generateRefCandidate, generateUniqueRef } from '../../../apps/api/src/modules/tickets/util/generate-ref'

const VALID_ALPHABET = /^[0-9A-HJKMNP-TV-Z]{7}$/

describe('generateRefCandidate', () => {
  it('generates a 7-character string', () => {
    const ref = generateRefCandidate()
    expect(ref).toHaveLength(7)
  })

  it('uses only Crockford base32 characters (no I, L, O, U)', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateRefCandidate()).toMatch(VALID_ALPHABET)
    }
  })

  it('generates unique values across many calls', () => {
    const refs = new Set<string>()
    for (let i = 0; i < 1000; i++) refs.add(generateRefCandidate())
    // With 32^7 ≈ 34B space, 1000 should be essentially collision-free
    expect(refs.size).toBe(1000)
  })
})

describe('generateUniqueRef', () => {
  it('returns first candidate when no collision', async () => {
    const ref = await generateUniqueRef(async () => false)
    expect(ref).toMatch(VALID_ALPHABET)
  })

  it('retries on P2002 collision and succeeds on second attempt', async () => {
    let calls = 0
    const exists = vi.fn(async () => { calls++; return calls === 1 }) // first call = collision
    const ref = await generateUniqueRef(exists)
    expect(ref).toMatch(VALID_ALPHABET)
    expect(exists).toHaveBeenCalledTimes(2)
  })

  it('throws after 5 failed attempts', async () => {
    await expect(generateUniqueRef(async () => true)).rejects.toThrow('unique ticket ref')
  })
})
