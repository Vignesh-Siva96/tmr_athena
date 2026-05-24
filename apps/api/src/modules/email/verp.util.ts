import * as crypto from 'crypto'

// reply+<emailThreadId>.<hmac8>@<domain>
// hmac8 = first 8 chars of HMAC-SHA256(emailThreadId, verpSecret)

export function signVerpToken(emailThreadId: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(emailThreadId).digest('hex')
  return `${emailThreadId}.${hmac.slice(0, 8)}`
}

export function verifyVerpToken(token: string, secret: string): string | null {
  const lastDot = token.lastIndexOf('.')
  if (lastDot === -1) return null
  const emailThreadId = token.slice(0, lastDot)
  const sig = token.slice(lastDot + 1)
  const expected = crypto.createHmac('sha256', secret).update(emailThreadId).digest('hex').slice(0, 8)
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  return emailThreadId
}

/**
 * Parse a VERP token out of a recipient address.
 * Accepts any local part — `<anything>+<token>@<domain>` — because we now use
 * plus-addressing on the actual support mailbox (e.g. support+<token>@gmail.com)
 * so replies route back to the same inbox the agent reads via IMAP.
 */
export function parseVerpAddress(address: string, secret: string): string | null {
  const match = /^[^@+]+\+([^@]+)@/.exec(address)
  if (!match?.[1]) return null
  return verifyVerpToken(match[1], secret)
}
