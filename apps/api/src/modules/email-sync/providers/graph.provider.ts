import { Logger } from '@nestjs/common'
import { withRetry } from '../util/with-retry'
import { isBulkSender } from '../util/is-bulk-sender'
import { htmlToText } from '../util/html-to-text'
import type { IMailProvider, ParsedThread, ParsedMessage, PollResult, RecoverResult } from './mail-provider.interface'

function graphUrl(path: string, params: Record<string, string> = {}): string {
  const base = `https://graph.microsoft.com/v1.0${path}`
  const qs = new URLSearchParams(params).toString()
  return qs ? `${base}?${qs}` : base
}

async function graphGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`Graph API ${res.status}: ${body}`) as Error & { status: number; body: string }
    err.status = res.status
    err.body = body
    throw err
  }
  return res.json() as Promise<T>
}

interface GraphMessage {
  id: string
  conversationId: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  toRecipients?: { emailAddress?: { address?: string } }[]
  ccRecipients?: { emailAddress?: { address?: string } }[]
  receivedDateTime?: string
  body?: { content?: string; contentType?: string }
  internetMessageId?: string
  internetMessageHeaders?: { name: string; value: string }[]
  isRead?: boolean
  hasAttachments?: boolean
}

interface GraphAttachment {
  id?: string
  name?: string
  contentType?: string
  size?: number
  '@odata.type'?: string
  contentBytes?: string
}

interface GraphMessageList {
  value?: GraphMessage[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

function parseGraphMessage(msg: GraphMessage, attachments: GraphAttachment[] = []): ParsedMessage {
  const headers: Record<string, string> = {}
  for (const h of (msg.internetMessageHeaders ?? [])) {
    headers[h.name.toLowerCase()] = h.value
  }

  const fromAddr = msg.from?.emailAddress?.address ?? ''
  const fromName = msg.from?.emailAddress?.name ?? undefined
  const toEmails = (msg.toRecipients ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean)
  const ccEmails = (msg.ccRecipients ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean)

  const isHtml = msg.body?.contentType?.toLowerCase() === 'html'
  const bodyContent = msg.body?.content ?? ''

  let bodyPlain: string
  let bodyHtml: string | undefined
  if (isHtml) {
    bodyHtml = bodyContent
    bodyPlain = htmlToText(bodyContent)
  } else {
    bodyPlain = bodyContent
  }

  const fromEmail = fromAddr.toLowerCase()

  // Map Graph attachment metadata into ParsedAttachment using providerMessageId/providerAttachmentId
  // stored in the gmailMessageId/gmailAttachmentId fields (provider-opaque in the interface).
  const parsedAttachments = attachments
    .filter(a => a['@odata.type'] !== '#microsoft.graph.referenceAttachment' && a.id)
    .map(a => ({
      filename: a.name ?? 'attachment',
      mimeType: a.contentType ?? 'application/octet-stream',
      size: a.size ?? 0,
      gmailMessageId: msg.id,     // Graph message id (provider-opaque field)
      gmailAttachmentId: a.id!,   // Graph attachment id (provider-opaque field)
    }))

  return {
    id: msg.id,
    rfcMessageId: msg.internetMessageId ?? headers['message-id'],
    inReplyTo: headers['in-reply-to'],
    fromEmail,
    fromName,
    toEmails,
    ccEmails,
    subject: msg.subject ?? '',
    bodyPlain: bodyPlain || '(no content)',
    bodyHtml,
    sentAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
    isBulk: isBulkSender(headers, fromEmail),
    attachments: parsedAttachments.length > 0 ? parsedAttachments : undefined,
  }
}

export class GraphProvider implements IMailProvider {
  readonly kind = 'GRAPH' as const
  private readonly logger = new Logger(GraphProvider.name)

  constructor(
    public readonly aliases: string[],
    private readonly getToken: () => Promise<string>,
  ) {}

  async listThreadIdsSince(since: Date, pageToken?: string): Promise<{ threadIds: string[]; nextPageToken?: string }> {
    const token = await this.getToken()
    const filter = `receivedDateTime ge ${since.toISOString()}`
    const url = pageToken ?? graphUrl('/me/messages', {
      '$filter': filter,
      '$select': 'id,conversationId',
      '$top': '100',
    })

    const data = await withRetry(() => graphGet<GraphMessageList>(token, url))
    const conversationIds = [...new Set((data.value ?? []).map(m => m.conversationId).filter(Boolean))]

    return {
      threadIds: conversationIds,
      nextPageToken: data['@odata.nextLink'],
    }
  }

  async listAllThreadIds(pageToken?: string): Promise<{ threadIds: string[]; nextPageToken?: string }> {
    const token = await this.getToken()
    const url = pageToken ?? graphUrl('/me/messages', {
      '$select': 'id,conversationId',
      '$top': '100',
    })

    const data = await withRetry(() => graphGet<GraphMessageList>(token, url))
    const conversationIds = [...new Set((data.value ?? []).map(m => m.conversationId).filter(Boolean))]

    return {
      threadIds: conversationIds,
      nextPageToken: data['@odata.nextLink'],
    }
  }

  async fetchThread(conversationId: string): Promise<ParsedThread> {
    const token = await this.getToken()
    const filter = `conversationId eq '${conversationId}'`
    const url = graphUrl('/me/messages', {
      '$filter': filter,
      '$select': 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,internetMessageId,internetMessageHeaders,isRead,hasAttachments',
      '$top': '100',
    })

    const data = await withRetry(() => graphGet<GraphMessageList>(token, url))
    const rawMessages = data.value ?? []

    // For messages with attachments, fetch the attachment metadata list
    const messages = await Promise.all(
      rawMessages.map(async (msg) => {
        let attachments: GraphAttachment[] = []
        if (msg.hasAttachments) {
          try {
            const attUrl = graphUrl(`/me/messages/${msg.id}/attachments`, {
              '$select': 'id,name,contentType,size,@odata.type',
            })
            const attData = await withRetry(() =>
              graphGet<{ value?: GraphAttachment[] }>(token, attUrl),
            )
            attachments = attData.value ?? []
          } catch (err) {
            this.logger.warn(`Failed to list attachments for message ${msg.id}: ${String(err)}`)
          }
        }
        return parseGraphMessage(msg, attachments)
      }),
    )

    const firstSubject = messages[0]?.subject ?? ''
    const hasUnread = rawMessages.some(m => !m.isRead)

    return { id: conversationId, messages, firstSubject, hasUnread }
  }

  async fetchAttachmentBytes(messageId: string, attachmentId: string): Promise<Buffer> {
    const token = await this.getToken()
    const url = graphUrl(`/me/messages/${messageId}/attachments/${attachmentId}`)
    const data = await withRetry(() => graphGet<GraphAttachment & { contentBytes?: string }>(token, url))
    if (!data.contentBytes) {
      throw new Error(`Graph attachment ${attachmentId} has no contentBytes`)
    }
    return Buffer.from(data.contentBytes, 'base64')
  }

  async pollChanges(checkpoint: string): Promise<PollResult> {
    const token = await this.getToken()
    // checkpoint is a deltaLink URL
    const allConversationIds = new Set<string>()
    let url = checkpoint
    let newDeltaLink = checkpoint

    while (url) {
      const data = await withRetry(() => graphGet<GraphMessageList>(token, url))
      for (const msg of (data.value ?? [])) {
        if (msg.conversationId) allConversationIds.add(msg.conversationId)
      }
      if (data['@odata.deltaLink']) {
        newDeltaLink = data['@odata.deltaLink']
        break
      }
      url = data['@odata.nextLink'] ?? ''
    }

    return {
      changedThreadIds: [...allConversationIds],
      newCheckpoint: newDeltaLink,
    }
  }

  isStaleCheckpointError(err: unknown): boolean {
    const e = err as { status?: number; body?: string }
    if (e?.status === 410) return true
    if (e?.body && typeof e.body === 'string' && e.body.includes('SyncStateNotFound')) return true
    return false
  }

  async recoverFromStaleCheckpoint(opts: { sinceDays: number }): Promise<RecoverResult> {
    const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000)
    const allConversationIds = new Set<string>()
    let pageToken: string | undefined

    do {
      const result = await this.listThreadIdsSince(since, pageToken)
      for (const id of result.threadIds) allConversationIds.add(id)
      pageToken = result.nextPageToken
    } while (pageToken)

    // Get a fresh delta link
    const token = await this.getToken()
    const deltaUrl = graphUrl('/me/messages/delta', { '$select': 'id,conversationId', '$top': '1' })
    let newDeltaLink = deltaUrl
    try {
      const data = await withRetry(() => graphGet<GraphMessageList>(token, deltaUrl))
      if (data['@odata.deltaLink']) newDeltaLink = data['@odata.deltaLink']
    } catch { /* ignore */ }

    return {
      changedThreadIds: [...allConversationIds],
      newCheckpoint: newDeltaLink,
    }
  }

  async fetchAliases(): Promise<string[]> {
    const token = await this.getToken()
    try {
      const data = await withRetry(() =>
        graphGet<{ mail?: string; userPrincipalName?: string }>(token, graphUrl('/me'))
      )
      const aliases: string[] = []
      if (data.mail) aliases.push(data.mail.toLowerCase())
      if (data.userPrincipalName) aliases.push(data.userPrincipalName.toLowerCase())
      return [...new Set(aliases)]
    } catch {
      return []
    }
  }
}
