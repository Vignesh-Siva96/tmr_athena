import { Logger } from '@nestjs/common'
import { withRetry } from '../util/with-retry'
import type { IMailProvider, ParsedThread, ParsedMessage, PollResult, RecoverResult } from './mail-provider.interface'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ParseGmailApi } = require('gmail-api-parse-message-ts') as { ParseGmailApi: new () => { parseMessage(raw: unknown): Record<string, unknown> } }
const parser = new ParseGmailApi()

function gmailUrl(path: string, params: Record<string, string> = {}): string {
  const base = `https://gmail.googleapis.com/gmail/v1${path}`
  const qs = new URLSearchParams(params).toString()
  return qs ? `${base}?${qs}` : base
}

async function gmailGet<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(gmailUrl(path, params), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`Gmail API ${res.status}: ${body}`) as Error & { status: number; body: string }
    err.status = res.status
    err.body = body
    throw err
  }
  return res.json() as Promise<T>
}

interface GmailThread { id: string; messages?: unknown[] }
interface GmailThreadList { threads?: { id: string }[]; nextPageToken?: string }
interface GmailHistoryMessage { id: string; threadId: string }
interface GmailHistoryEntry {
  messages?: GmailHistoryMessage[]
  messagesAdded?: { message: GmailHistoryMessage }[]
}
interface GmailHistoryList { history?: GmailHistoryEntry[]; historyId?: string; nextPageToken?: string }

function parseGmailMessage(raw: Record<string, unknown>): ParsedMessage {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = parser.parseMessage(raw) as Record<string, unknown>
  } catch {
    // ignore parse errors; fall through to header-based extraction
  }

  const headers: Record<string, string> = {}
  const payload = raw.payload as { headers?: { name: string; value: string }[] } | undefined
  for (const h of (payload?.headers ?? [])) {
    headers[h.name.toLowerCase()] = h.value
  }

  const bodyPlain = (parsed.textPlain as string | undefined) ?? ''
  const bodyHtml = (parsed.textHtml as string | undefined) ?? undefined

  return {
    id: raw.id as string,
    rfcMessageId: headers['message-id'],
    inReplyTo: headers['in-reply-to'],
    fromEmail: extractEmail(headers['from'] ?? ''),
    fromName: extractName(headers['from'] ?? ''),
    toEmails: parseEmailList(headers['to'] ?? ''),
    ccEmails: parseEmailList(headers['cc'] ?? ''),
    subject: headers['subject'] ?? '',
    bodyPlain: bodyPlain || '(no content)',
    bodyHtml,
    sentAt: new Date(parseInt(raw.internalDate as string ?? '0', 10)),
  }
}

function extractEmail(addr: string): string {
  const m = /<([^>]+)>/.exec(addr)
  return (m?.[1] ?? addr).trim().toLowerCase()
}

function extractName(addr: string): string | undefined {
  const m = /^([^<]+)</.exec(addr)
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined
}

function parseEmailList(s: string): string[] {
  if (!s) return []
  return s.split(',').map(a => extractEmail(a.trim())).filter(Boolean)
}

export class GmailProvider implements IMailProvider {
  readonly kind = 'GMAIL' as const
  private readonly logger = new Logger(GmailProvider.name)

  constructor(
    public readonly aliases: string[],
    private readonly getToken: () => Promise<string>,
  ) {}

  async listThreadIdsSince(since: Date, pageToken?: string): Promise<{ threadIds: string[]; nextPageToken?: string }> {
    const token = await this.getToken()
    const y = since.getFullYear()
    const m = String(since.getMonth() + 1).padStart(2, '0')
    const d = String(since.getDate()).padStart(2, '0')
    const params: Record<string, string> = { q: `after:${y}/${m}/${d}`, maxResults: '100' }
    if (pageToken) params.pageToken = pageToken

    const data = await withRetry(() => gmailGet<GmailThreadList>(token, '/users/me/threads', params))
    return {
      threadIds: (data.threads ?? []).map(t => t.id),
      nextPageToken: data.nextPageToken,
    }
  }

  async listAllThreadIds(pageToken?: string): Promise<{ threadIds: string[]; nextPageToken?: string }> {
    const token = await this.getToken()
    const params: Record<string, string> = { maxResults: '100' }
    if (pageToken) params.pageToken = pageToken

    const data = await withRetry(() => gmailGet<GmailThreadList>(token, '/users/me/threads', params))
    return {
      threadIds: (data.threads ?? []).map(t => t.id),
      nextPageToken: data.nextPageToken,
    }
  }

  async fetchThread(threadId: string): Promise<ParsedThread> {
    const token = await this.getToken()
    const data = await withRetry(() =>
      gmailGet<GmailThread>(token, `/users/me/threads/${threadId}`, { format: 'full' })
    )

    const rawMessages = (data.messages ?? []) as Record<string, unknown>[]
    const messages = rawMessages.map(parseGmailMessage)
    const firstSubject = messages[0]?.subject ?? ''
    const hasUnread = rawMessages.some(m => {
      const labelIds = m.labelIds as string[] | undefined
      return (labelIds ?? []).includes('UNREAD')
    })

    return { id: threadId, messages, firstSubject, hasUnread }
  }

  async pollChanges(checkpoint: string): Promise<PollResult> {
    const token = await this.getToken()
    // checkpoint is a historyId
    const allThreadIds = new Set<string>()
    let pageToken: string | undefined
    let latestHistoryId = checkpoint

    do {
      const params: Record<string, string> = { startHistoryId: checkpoint, maxResults: '500' }
      if (pageToken) params.pageToken = pageToken

      const data = await withRetry(() => gmailGet<GmailHistoryList>(token, '/users/me/history', params))

      if (data.historyId) latestHistoryId = data.historyId
      for (const entry of (data.history ?? [])) {
        // Primary: messagesAdded (most reliable for new inbound messages)
        for (const added of (entry.messagesAdded ?? [])) {
          if (added.message?.threadId) allThreadIds.add(added.message.threadId)
        }
        // Fallback: messages summary field (older API format)
        for (const msg of (entry.messages ?? [])) {
          if (msg.threadId) allThreadIds.add(msg.threadId)
        }
      }
      pageToken = data.nextPageToken
    } while (pageToken)

    // Get the current historyId if we got nothing (no changes)
    if (!latestHistoryId || latestHistoryId === checkpoint) {
      const profile = await withRetry(() =>
        gmailGet<{ historyId: string }>(token, '/users/me/profile')
      )
      latestHistoryId = profile.historyId ?? checkpoint
    }

    return {
      changedThreadIds: [...allThreadIds],
      newCheckpoint: latestHistoryId,
    }
  }

  isStaleCheckpointError(err: unknown): boolean {
    const e = err as { status?: number; body?: string }
    if (e?.status === 404) return true
    if (e?.body && typeof e.body === 'string' && e.body.includes('historyId')) return true
    return false
  }

  async recoverFromStaleCheckpoint(opts: { sinceDays: number }): Promise<RecoverResult> {
    const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000)
    const allThreadIds = new Set<string>()
    let pageToken: string | undefined

    do {
      const result = await this.listThreadIdsSince(since, pageToken)
      for (const id of result.threadIds) allThreadIds.add(id)
      pageToken = result.nextPageToken
    } while (pageToken)

    // Get a fresh historyId for new checkpoint
    const token = await this.getToken()
    const profile = await withRetry(() => gmailGet<{ historyId: string }>(token, '/users/me/profile'))

    return {
      changedThreadIds: [...allThreadIds],
      newCheckpoint: profile.historyId ?? '',
    }
  }

  async fetchAliases(): Promise<string[]> {
    const token = await this.getToken()
    try {
      const data = await withRetry(() =>
        gmailGet<{ sendAs?: { sendAsEmail: string }[] }>(token, '/users/me/settings/sendAs')
      )
      return (data.sendAs ?? []).map(a => a.sendAsEmail.toLowerCase())
    } catch {
      return []
    }
  }

  async fetchTotalThreadCount(): Promise<number | null> {
    try {
      const token = await this.getToken()
      const profile = await withRetry(() =>
        gmailGet<{ threadsTotal?: number }>(token, '/users/me/profile')
      )
      return profile.threadsTotal ?? null
    } catch {
      return null
    }
  }

  async fetchCurrentHistoryId(): Promise<string | null> {
    try {
      const token = await this.getToken()
      const profile = await withRetry(() =>
        gmailGet<{ historyId?: string }>(token, '/users/me/profile')
      )
      return profile.historyId ?? null
    } catch {
      return null
    }
  }
}
