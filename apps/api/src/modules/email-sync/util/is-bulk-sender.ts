const BULK_LOCAL_PARTS = /^(no-?reply|donotreply|mailer-daemon|postmaster)(@|$)/i

/**
 * Detect automated / bulk email senders using RFC-standard headers.
 * `headers` must be a lowercased key→value map.
 */
export function isBulkSender(headers: Record<string, string>, fromEmail: string): boolean {
  // RFC 3834 — auto-submitted (anything other than "no" means automated)
  const autoSubmitted = headers['auto-submitted']
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return true

  // Precedence: bulk / list / junk
  const precedence = headers['precedence']?.toLowerCase()
  if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') return true

  // List-* headers indicate mailing-list / newsletter
  if (headers['list-unsubscribe'] !== undefined) return true
  if (headers['list-id'] !== undefined) return true

  // Exchange / Outlook suppression header
  if (headers['x-auto-response-suppress'] !== undefined) return true

  // Sender local-part pattern (no-reply, donotreply, mailer-daemon, postmaster)
  const localPart = fromEmail.split('@')[0] ?? ''
  if (BULK_LOCAL_PARTS.test(localPart + '@')) return true

  return false
}
