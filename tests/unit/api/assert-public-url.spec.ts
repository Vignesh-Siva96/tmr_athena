/**
 * Unit tests for the SSRF guard `assertPublicUrl` (T1.2).
 *
 * DNS lookups are mocked so the suite doesn't depend on network access; IP-literal
 * hosts (169.254.169.254, 10.x, ::1) are validated without a lookup at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const lookupMock = vi.fn()
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}))

import { assertPublicUrl, UnsafeUrlError } from '../../../apps/api/src/common/net/assert-public-url'

describe('assertPublicUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset()
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it('rejects cloud metadata IP (169.254.169.254)', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(UnsafeUrlError)
  })

  it('rejects localhost', async () => {
    await expect(assertPublicUrl('http://localhost:3000')).rejects.toThrow(UnsafeUrlError)
  })

  it('rejects loopback IPv6 (::1)', async () => {
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow(UnsafeUrlError)
  })

  it('rejects non-http(s) schemes (file://)', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError)
  })

  it('rejects a private 10.x host', async () => {
    await expect(assertPublicUrl('http://10.0.0.5/internal')).rejects.toThrow(UnsafeUrlError)
  })

  it('rejects a hostname that resolves to a private address (DNS rebinding)', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.50', family: 4 }])
    await expect(assertPublicUrl('https://internal.example.com/')).rejects.toThrow(UnsafeUrlError)
  })

  it('accepts a normal https URL resolving to a public address', async () => {
    const url = await assertPublicUrl('https://docs.example.com/help')
    expect(url.href).toBe('https://docs.example.com/help')
    expect(lookupMock).toHaveBeenCalledWith('docs.example.com', { all: true })
  })

  it('accepts a public IP literal without DNS lookup', async () => {
    const url = await assertPublicUrl('https://93.184.216.34/')
    expect(url.hostname).toBe('93.184.216.34')
    expect(lookupMock).not.toHaveBeenCalled()
  })
})
