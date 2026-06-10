import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

const MAX_REDIRECTS = 3
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  if (a === 0) return true // "this network"
  if (a === 10) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT shared address space
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local (incl. 169.254.169.254 cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true // unique local fc00::/7
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return isPrivateIPv4(mapped[1]!)
  return false
}

function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip)
}

/**
 * Validates a server-fetched URL is not pointed at an internal/private/loopback target.
 * Throws UnsafeUrlError if the URL is malformed, uses an unsupported scheme, or resolves
 * to a non-public address (DNS rebinding is covered because we resolve at call time).
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${raw}`)
  }

  const allowHttp = process.env['NODE_ENV'] !== 'production'
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new UnsafeUrlError(`Unsupported URL scheme: ${url.protocol}`)
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (hostname.toLowerCase() === 'localhost') {
    throw new UnsafeUrlError(`URL targets localhost: ${raw}`)
  }

  let addresses: string[]
  if (isIP(hostname)) {
    addresses = [hostname]
  } else {
    try {
      addresses = (await lookup(hostname, { all: true })).map((r) => r.address)
    } catch {
      throw new UnsafeUrlError(`Could not resolve host: ${hostname}`)
    }
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Could not resolve host: ${hostname}`)
  }
  for (const addr of addresses) {
    if (isPrivateAddress(addr)) {
      throw new UnsafeUrlError(`URL resolves to a non-public address (${addr}): ${raw}`)
    }
  }

  return url
}

/**
 * fetch() wrapper that re-validates the target (and every redirect hop) with
 * assertPublicUrl, and caps both the number of redirects followed and the
 * response body size — mitigating SSRF via redirect chains and oversized bodies.
 */
export async function fetchPublic(raw: string, init: RequestInit = {}): Promise<Response> {
  let current = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current)
    const res = await fetch(current, { ...init, redirect: 'manual' })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      current = new URL(location, current).toString()
      continue
    }

    const contentLength = res.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new UnsafeUrlError(`Response too large (${contentLength} bytes): ${current}`)
    }

    return res
  }
  throw new UnsafeUrlError(`Too many redirects fetching: ${raw}`)
}

export async function readBodyCapped(res: Response, maxBytes: number = MAX_RESPONSE_BYTES): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text()

  const decoder = new TextDecoder()
  let result = ''
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      throw new UnsafeUrlError(`Response body exceeded ${maxBytes} bytes`)
    }
    result += decoder.decode(value, { stream: true })
  }
  result += decoder.decode()
  return result
}
