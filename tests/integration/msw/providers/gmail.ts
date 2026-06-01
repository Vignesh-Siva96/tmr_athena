import { http, HttpResponse } from 'msw'

/**
 * Default Gmail handlers — return empty responses by default. Per-test overrides
 * via mswServer.use() inject canned threads / history responses.
 *
 * Endpoints we intercept:
 *   GET https://gmail.googleapis.com/gmail/v1/users/me/profile
 *   GET https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=...
 *   GET https://gmail.googleapis.com/gmail/v1/users/me/threads/:id
 *   GET https://gmail.googleapis.com/gmail/v1/users/me/threads?q=...
 *   GET https://gmail.googleapis.com/gmail/v1/users/me/messages/:id/attachments/:aid
 *   GET https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs
 */

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailHandlers = [
  http.get(`${BASE}/profile`, () =>
    HttpResponse.json({ emailAddress: 'support@test.local', historyId: '1000', threadsTotal: 0, messagesTotal: 0 }),
  ),

  http.get(`${BASE}/history`, () => HttpResponse.json({ history: [], historyId: '1000' })),

  http.get(`${BASE}/threads`, () => HttpResponse.json({ threads: [], nextPageToken: null, resultSizeEstimate: 0 })),

  http.get(`${BASE}/threads/:id`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      historyId: '1000',
      messages: [],
    }),
  ),

  http.get(`${BASE}/messages/:id/attachments/:aid`, () =>
    HttpResponse.json({ data: '', size: 0 }),
  ),

  http.get(`${BASE}/settings/sendAs`, () =>
    HttpResponse.json({ sendAs: [{ sendAsEmail: 'support@test.local', isPrimary: true, isDefault: true }] }),
  ),
]

/** Helper: build a single-message canned thread for use in test overrides. */
export function buildGmailThread(opts: {
  threadId: string
  messageId: string
  rfcMessageId: string
  inReplyTo?: string
  from: string
  to: string
  subject: string
  body: string
  date?: string
}): unknown {
  const internalDate = String(opts.date ? new Date(opts.date).getTime() : Date.now())
  const headers = [
    { name: 'From', value: opts.from },
    { name: 'To', value: opts.to },
    { name: 'Subject', value: opts.subject },
    { name: 'Message-ID', value: opts.rfcMessageId },
    ...(opts.inReplyTo ? [{ name: 'In-Reply-To', value: opts.inReplyTo }] : []),
    { name: 'Date', value: new Date(Number(internalDate)).toUTCString() },
  ]
  return {
    id: opts.threadId,
    historyId: '1001',
    messages: [
      {
        id: opts.messageId,
        threadId: opts.threadId,
        labelIds: ['INBOX', 'UNREAD'],
        internalDate,
        payload: {
          mimeType: 'text/plain',
          headers,
          body: { data: Buffer.from(opts.body).toString('base64url'), size: opts.body.length },
        },
      },
    ],
  }
}
