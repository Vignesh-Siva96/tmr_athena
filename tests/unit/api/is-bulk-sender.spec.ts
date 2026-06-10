/**
 * Unit tests for the pure `isBulkSender` helper.
 *
 * Regression catalogue: R109
 *
 * Tests each of the 6 automated/bulk detection signals independently, then
 * verifies a clean human email returns false. No imports other than the module
 * under test — runs entirely in-memory with Vitest.
 */

import { describe, it, expect } from 'vitest'
import { isBulkSender } from '../../../apps/api/src/modules/email-sync/util/is-bulk-sender'

describe('isBulkSender — R109', () => {
  // ─── Signal 1: Auto-Submitted (RFC 3834) ─────────────────────────────────

  it('returns true when Auto-Submitted is not "no"', () => {
    expect(isBulkSender({ 'auto-submitted': 'auto-generated' }, 'sender@example.com')).toBe(true)
    expect(isBulkSender({ 'auto-submitted': 'auto-replied' }, 'sender@example.com')).toBe(true)
  })

  it('returns false when Auto-Submitted is "no"', () => {
    expect(isBulkSender({ 'auto-submitted': 'no' }, 'human@example.com')).toBe(false)
  })

  // ─── Signal 2: Precedence: bulk / list / junk ─────────────────────────────

  it('returns true for Precedence: bulk', () => {
    expect(isBulkSender({ precedence: 'bulk' }, 'sender@example.com')).toBe(true)
  })

  it('returns true for Precedence: list', () => {
    expect(isBulkSender({ precedence: 'list' }, 'sender@example.com')).toBe(true)
  })

  it('returns true for Precedence: junk', () => {
    expect(isBulkSender({ precedence: 'junk' }, 'sender@example.com')).toBe(true)
  })

  it('returns false for Precedence: normal (not a bulk indicator)', () => {
    expect(isBulkSender({ precedence: 'normal' }, 'human@example.com')).toBe(false)
  })

  // ─── Signal 3: List-Unsubscribe ───────────────────────────────────────────

  it('returns true when List-Unsubscribe header is present', () => {
    expect(isBulkSender({ 'list-unsubscribe': '<https://example.com/unsub>' }, 'news@example.com')).toBe(true)
  })

  // ─── Signal 4: List-Id ────────────────────────────────────────────────────

  it('returns true when List-Id header is present', () => {
    expect(isBulkSender({ 'list-id': '<mylist.example.com>' }, 'news@example.com')).toBe(true)
  })

  // ─── Signal 5: X-Auto-Response-Suppress ──────────────────────────────────

  it('returns true when X-Auto-Response-Suppress header is present', () => {
    expect(isBulkSender({ 'x-auto-response-suppress': 'DR, RN, NTN' }, 'noreply@corp.com')).toBe(true)
  })

  // ─── Signal 6: sender local-part pattern ─────────────────────────────────

  it('returns true for no-reply local-part', () => {
    expect(isBulkSender({}, 'no-reply@example.com')).toBe(true)
  })

  it('returns true for noreply local-part', () => {
    expect(isBulkSender({}, 'noreply@example.com')).toBe(true)
  })

  it('returns true for donotreply local-part', () => {
    expect(isBulkSender({}, 'donotreply@example.com')).toBe(true)
  })

  it('returns true for mailer-daemon local-part', () => {
    expect(isBulkSender({}, 'mailer-daemon@example.com')).toBe(true)
  })

  it('returns true for postmaster local-part', () => {
    expect(isBulkSender({}, 'postmaster@example.com')).toBe(true)
  })

  // ─── Clean human email → false ────────────────────────────────────────────

  it('returns false for a clean human sender with no bulk headers', () => {
    expect(isBulkSender({
      'content-type': 'text/plain',
      'subject': 'Question about my invoice',
    }, 'alice@customer.com')).toBe(false)
  })
})
