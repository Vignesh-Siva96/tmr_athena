import { Injectable } from '@nestjs/common'

export interface CapturedMail {
  ts: string
  from?: string
  to: string | string[]
  cc?: string | string[]
  subject?: string
  text?: string
  html?: string
  /** Filenames of file attachments on the message (empty when none). */
  attachments?: string[]
  headers: Record<string, string>
  raw: string
}

/**
 * In-memory mail bucket. Populated by EmailService when NODE_ENV === 'test'.
 * Exposed by TestController at GET /__test/captured-mail for E2E flows to
 * assert on outbound email without hitting real SMTP.
 */
@Injectable()
export class MailCaptureService {
  private bucket: CapturedMail[] = []

  capture(entry: CapturedMail): void {
    this.bucket.push(entry)
  }

  list(filter?: { to?: string }): CapturedMail[] {
    if (!filter?.to) return [...this.bucket]
    const needle = filter.to.toLowerCase()
    return this.bucket.filter((m) => {
      const recipients = Array.isArray(m.to) ? m.to : [m.to]
      return recipients.some((r) => r.toLowerCase().includes(needle))
    })
  }

  reset(): void {
    this.bucket = []
  }
}
