/**
 * messages-dto-cc.spec — unit tests for cc field in createMessageSchema.
 */
import { describe, it, expect } from 'vitest'
import { createMessageSchema } from '../../../apps/api/src/modules/messages/messages.dto'

describe('createMessageSchema — cc field', () => {
  it('accepts a valid list of emails', () => {
    const result = createMessageSchema.parse({ body: 'Hi', cc: ['alice@example.com', 'bob@example.com'] })
    expect(result.cc).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('lowercases and trims emails', () => {
    const result = createMessageSchema.parse({ body: 'Hi', cc: ['  Alice@Example.COM  '] })
    expect(result.cc).toEqual(['alice@example.com'])
  })

  it('deduplicates after normalization', () => {
    const result = createMessageSchema.parse({ body: 'Hi', cc: ['alice@example.com', 'ALICE@EXAMPLE.COM'] })
    expect(result.cc).toEqual(['alice@example.com'])
  })

  it('rejects an invalid email format', () => {
    expect(() => createMessageSchema.parse({ body: 'Hi', cc: ['not-an-email'] })).toThrow()
  })

  it('rejects more than 20 entries', () => {
    const arr = Array.from({ length: 21 }, (_, i) => `u${i}@example.com`)
    expect(() => createMessageSchema.parse({ body: 'Hi', cc: arr })).toThrow()
  })

  it('accepts exactly 20 entries', () => {
    const arr = Array.from({ length: 20 }, (_, i) => `u${i}@example.com`)
    const result = createMessageSchema.parse({ body: 'Hi', cc: arr })
    expect(result.cc).toHaveLength(20)
  })

  it('cc is optional — absent → undefined', () => {
    const result = createMessageSchema.parse({ body: 'Hi' })
    expect(result.cc).toBeUndefined()
  })

  it('accepts an empty array', () => {
    const result = createMessageSchema.parse({ body: 'Hi', cc: [] })
    expect(result.cc).toEqual([])
  })
})
