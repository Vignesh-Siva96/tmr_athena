import * as crypto from 'crypto'

// Crockford base32 — no I, L, O, U to avoid misreading
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const REF_LENGTH = 7

/** Human-facing display id, e.g. `TMR-K7Q2M9X`. The bare code is stored in `Ticket.ref`. */
export function formatRef(ref: string): string {
  return `TMR-${ref}`
}

export function generateRefCandidate(): string {
  const bytes = crypto.randomBytes(REF_LENGTH)
  let ref = ''
  for (let i = 0; i < REF_LENGTH; i++) {
    ref += ALPHABET[bytes[i]! % 32]
  }
  return ref
}

/**
 * Generate a unique ref with P2002 retry loop.
 * `exists` is called to check for collisions; must return true if the ref is taken.
 */
export async function generateUniqueRef(exists: (ref: string) => Promise<boolean>): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = generateRefCandidate()
    if (!(await exists(ref))) return ref
  }
  throw new Error('Failed to generate unique ticket ref after 5 attempts')
}
