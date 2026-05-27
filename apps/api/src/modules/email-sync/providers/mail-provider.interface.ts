export interface ParsedMessage {
  id: string               // externalMessageId (Gmail messageId or Graph message id)
  rfcMessageId?: string    // RFC 5322 Message-ID header
  inReplyTo?: string
  fromEmail: string
  fromName?: string
  toEmails: string[]
  ccEmails: string[]
  subject: string
  bodyPlain: string
  bodyHtml?: string
  bodyRaw?: string
  sentAt: Date
}

export interface ParsedThread {
  id: string               // externalThreadId
  messages: ParsedMessage[]
  firstSubject: string
  hasUnread: boolean
}

export interface PollResult {
  changedThreadIds: string[]
  newCheckpoint: string
}

export interface RecoverResult {
  changedThreadIds: string[]
  newCheckpoint: string
}

export type ProviderKind = 'GMAIL' | 'GRAPH'

export interface IMailProvider {
  kind: ProviderKind
  aliases: string[]  // connected mailbox + send-as addresses

  // List thread IDs updated since a date (for backfill)
  listThreadIdsSince(since: Date, pageToken?: string): Promise<{ threadIds: string[]; nextPageToken?: string }>
  // Fetch all thread IDs (for full archive) with pagination
  listAllThreadIds(pageToken?: string): Promise<{ threadIds: string[]; nextPageToken?: string }>
  // Fetch a single thread with all its messages
  fetchThread(threadId: string): Promise<ParsedThread>
  // Poll for changes since last checkpoint
  pollChanges(checkpoint: string): Promise<PollResult>
  // Check if error is a stale checkpoint error
  isStaleCheckpointError(err: unknown): boolean
  // Recover from stale checkpoint by re-listing last N days
  recoverFromStaleCheckpoint(opts: { sinceDays: number }): Promise<RecoverResult>
}
