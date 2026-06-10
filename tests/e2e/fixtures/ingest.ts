/**
 * Ingest-email helper for E2E flows.
 *
 * Calls the test-only POST /__test/ingest-email endpoint which builds a
 * ParsedThread and runs it through the production ThreadIngestionService.
 * All downstream logic (customer resolution, dedup, G3 transitions, SSE) is
 * real production code — only the email provider is faked.
 */
import type { APIRequestContext } from '@playwright/test'

const API = 'http://localhost:3001'

export interface IngestEmailOpts {
  from: string
  fromName?: string
  subject: string
  body: string
  /** Reuse the same threadId across calls to simulate follow-up messages. */
  threadId?: string
  messageId?: string
  inReplyTo?: string
  headers?: Record<string, string>
}

export async function ingestEmail(
  request: APIRequestContext,
  opts: IngestEmailOpts,
): Promise<{ created: boolean; ticketId?: string }> {
  const res = await request.post(`${API}/api/v1/__test/ingest-email`, { data: opts })
  if (!res.ok()) {
    throw new Error(`ingest-email failed: ${res.status()} ${await res.text()}`)
  }
  const body = (await res.json()) as { data: { created: boolean; ticketId?: string } }
  return body.data
}
