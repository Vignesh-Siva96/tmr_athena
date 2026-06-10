import { Controller, Get, Post, Body, Query, HttpCode } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { MailCaptureService, CapturedMail } from './mail-capture.service'
import { ThreadIngestionService } from '../email-sync/thread-ingestion.service'
import { PrismaService } from '../database/prisma.service'
import type { IMailProvider, ParsedThread } from '../email-sync/providers/mail-provider.interface'

interface IngestEmailDto {
  from: string
  fromName?: string
  subject: string
  body: string
  /** Reuse the same threadId across calls to simulate follow-up messages on one thread. */
  threadId?: string
  messageId?: string
  inReplyTo?: string
  /** Pass arbitrary RFC headers (e.g. List-Unsubscribe) to simulate bulk/promo mail. */
  headers?: Record<string, string>
}

/**
 * Test-only controller — mounted only when NODE_ENV === 'test'.
 * Exposes hooks the E2E suite uses to assert on outbound side-effects.
 */
@Controller('__test')
export class TestController {
  constructor(
    private readonly mail: MailCaptureService,
    private readonly ingestion: ThreadIngestionService,
    private readonly db: PrismaService,
  ) {}

  @Get('captured-mail')
  capturedMail(@Query('to') to?: string): CapturedMail[] {
    return this.mail.list({ to })
  }

  @Post('captured-mail/reset')
  @HttpCode(200)
  reset(): { ok: true } {
    this.mail.reset()
    return { ok: true }
  }

  /**
   * Simulate an inbound email arriving at the support mailbox.
   * Builds a minimal ParsedThread and a fake IMailProvider backed by it, then calls
   * ThreadIngestionService.fetchAndUpsertThread() — all production code runs downstream
   * (customer resolution, bulk detection, dedup, G3 status transitions, SSE broadcast).
   *
   * Repeated calls with the same threadId simulate follow-up messages on the same thread
   * (each call should carry a fresh messageId so it is not deduplicated).
   */
  @Post('ingest-email')
  @HttpCode(201)
  async ingestEmail(@Body() dto: IngestEmailDto): Promise<{ created: boolean; ticketId?: string }> {
    const appConfig = await this.db.appConfig.findFirst()
    const supportAlias =
      appConfig?.oauthEmail ?? appConfig?.supportEmail ?? 'support@twominutereports.com'

    const threadId = dto.threadId ?? `e2e-thread-${randomUUID()}`
    const messageId = dto.messageId ?? randomUUID()
    const rfcMessageId = `<${messageId}@e2e.test>`

    const thread: ParsedThread = {
      id: threadId,
      firstSubject: dto.subject,
      hasUnread: true,
      messages: [
        {
          id: messageId,
          rfcMessageId,
          fromEmail: dto.from,
          fromName: dto.fromName,
          toEmails: [supportAlias],
          ccEmails: [],
          subject: dto.subject,
          bodyPlain: dto.body,
          sentAt: new Date(),
          isBulk: false,
          ...(dto.inReplyTo ? { inReplyTo: dto.inReplyTo } : {}),
        },
      ],
    }

    const provider: IMailProvider = {
      kind: 'GMAIL',
      aliases: [supportAlias],
      fetchThread: async () => thread,
      listThreadIdsSince: async () => ({ threadIds: [], nextPageToken: undefined }),
      listAllThreadIds: async () => ({ threadIds: [], nextPageToken: undefined }),
      pollChanges: async () => ({ changedThreadIds: [], newCheckpoint: '0' }),
      isStaleCheckpointError: () => false,
      recoverFromStaleCheckpoint: async () => ({ changedThreadIds: [], newCheckpoint: '0' }),
    }

    return this.ingestion.fetchAndUpsertThread(provider, threadId, { isBackfill: false })
  }
}
