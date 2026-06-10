/**
 * Captured-mail helpers for E2E flows.
 *
 * EmailService runs in capture mode (NODE_ENV=test) — all outbound mail is
 * stored in MailCaptureService and exposed at GET /__test/captured-mail.
 * Because the send-reply worker runs via pg-boss (50–200 ms pickup latency),
 * all assertions MUST use expectMailDelivered() rather than asserting immediately.
 */
import { expect, type APIRequestContext } from '@playwright/test'

const API = 'http://localhost:3001'

export interface CapturedMail {
  ts: string
  from?: string
  to: string | string[]
  subject?: string
  text?: string
  html?: string
  headers: Record<string, string>
  raw: string
}

export async function getCapturedMail(
  request: APIRequestContext,
  to?: string,
): Promise<CapturedMail[]> {
  const url = to
    ? `${API}/api/v1/__test/captured-mail?to=${encodeURIComponent(to)}`
    : `${API}/api/v1/__test/captured-mail`
  const res = await request.get(url)
  return (await res.json()) as CapturedMail[]
}

export async function resetCapturedMail(request: APIRequestContext): Promise<void> {
  await request.post(`${API}/api/v1/__test/captured-mail/reset`)
}

/**
 * Poll until at least `minCount` emails have been captured for `to`.
 * Returns the full list once the condition is satisfied.
 * Use this for every captured-mail assertion — pg-boss adds 50–200 ms latency.
 */
export async function expectMailDelivered(
  request: APIRequestContext,
  to: string,
  minCount = 1,
  opts?: { timeout?: number },
): Promise<CapturedMail[]> {
  await expect
    .poll(
      async () => {
        const mails = await getCapturedMail(request, to)
        return mails.length
      },
      { timeout: opts?.timeout ?? 15_000 },
    )
    .toBeGreaterThanOrEqual(minCount)
  return getCapturedMail(request, to)
}
