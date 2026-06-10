import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import PgBoss from 'pg-boss'
import {
  AI_ANALYZE_MESSAGE_QUEUE,
  AI_CLASSIFY_TICKET_QUEUE,
  AI_REQUEST_CSAT_QUEUE,
  BOT_RESPOND_QUEUE,
  KB_CRAWL_QUEUE,
  KB_INDEX_PAGE_QUEUE,
  KB_SCAN_QUEUE,
  KB_EMBED_QUEUE,
  EMAIL_SEND_REPLY_QUEUE,
  EMAIL_SEND_CONFIRMATION_QUEUE,
} from './queue.module'

export interface AnalyzeMessageJobData {
  messageId: string
  ticketId: string
}

export interface ClassifyTicketJobData {
  ticketId: string
}

export interface RequestCsatJobData {
  ticketId: string
}

export interface BotRespondJobData {
  ticketId: string
}

export interface EmailSendReplyJobData {
  ticketId: string
  messageId: string
  /** 'portal-copy' indicates a self-addressed mirror of a customer portal reply (G1). */
  kind?: 'portal-copy'
}

export interface EmailSendConfirmationJobData {
  ticketId: string
}

export interface KbCrawlJobData {
  rootUrl: string
  mode?: 'full' | 'incremental'
}

export interface KbIndexPageJobData {
  sourceId: string
}

export interface KbScanJobData {
  rootUrl: string
}

// No data needed for embed job — worker reads all SCANNED chunks from DB
export type KbEmbedJobData = Record<string, never>

/**
 * Postgres-backed job queue via pg-boss.
 *
 * Replaces the previous BullMQ + Redis setup. The queue tables live in a
 * dedicated `pgboss` schema in the same Postgres database we already use,
 * so the entire app needs zero extra infrastructure.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name)
  private readonly boss: PgBoss
  private readyPromise: Promise<void>
  /**
   * Set just before we stop pg-boss. While shutting down, the open polling
   * connections receive expected disconnect errors (Postgres 57P01,
   * "terminating connection due to administrator command") as the DB goes
   * away — in tests when the container stops, in prod on a normal restart.
   * We downgrade those to debug so they don't drown the logs, while genuine
   * *runtime* pg-boss errors are still logged loudly.
   */
  private shuttingDown = false

  constructor(private readonly config: ConfigService) {
    const connectionString = this.config.get<string>('DATABASE_URL')
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for QueueService')
    }
    this.boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      // In test mode, poll for new jobs much more frequently so queue integration tests
      // don't need long sleeps waiting for pg-boss's default 2 s polling cycle.
      ...(process.env.NODE_ENV === 'test' ? { newJobCheckInterval: 100 } : {}),
    })
    this.boss.on('error', (err: Error) => {
      if (this.shuttingDown) {
        this.logger.debug(`pg-boss error during shutdown (expected): ${err.message}`)
        return
      }
      this.logger.error(`pg-boss error: ${err.message}`)
    })
    this.readyPromise = this.boss.start().then(() => {
      this.logger.log('pg-boss started')
    })
  }

  async onModuleInit(): Promise<void> {
    await this.readyPromise
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true
    try {
      await this.boss.stop({ graceful: true, timeout: 5000 })
    } catch (err) {
      this.logger.debug(`pg-boss stop error (expected during hard shutdown): ${String(err)}`)
    }
  }

  async ready(): Promise<void> {
    await this.readyPromise
  }

  getBoss(): PgBoss {
    return this.boss
  }

  async enqueueAnalyzeMessage(data: AnalyzeMessageJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(AI_ANALYZE_MESSAGE_QUEUE, data, {
      retryLimit: 3,
      retryDelay: 10,
      retryBackoff: true,
    })
  }

  async enqueueClassifyTicket(data: ClassifyTicketJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(AI_CLASSIFY_TICKET_QUEUE, data, {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    })
  }

  async enqueueRequestCsat(data: RequestCsatJobData, delaySec = 1800): Promise<void> {
    await this.readyPromise
    await this.boss.send(AI_REQUEST_CSAT_QUEUE, data, {
      startAfter: delaySec,
      retryLimit: 2,
    })
  }

  async enqueueBotRespond(data: BotRespondJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(BOT_RESPOND_QUEUE, data, {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    })
  }

  async enqueueKbCrawl(data: KbCrawlJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(KB_CRAWL_QUEUE, data, {
      retryLimit: 1,
    })
  }

  async enqueueKbIndexPage(data: KbIndexPageJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(KB_INDEX_PAGE_QUEUE, data, {
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
    })
  }

  async enqueueKbScan(data: KbScanJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(KB_SCAN_QUEUE, data, { retryLimit: 1 })
  }

  async enqueueKbEmbed(): Promise<void> {
    await this.readyPromise
    await this.boss.send(KB_EMBED_QUEUE, {}, { retryLimit: 1 })
  }

  async enqueueEmailSendReply(data: EmailSendReplyJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(EMAIL_SEND_REPLY_QUEUE, data, {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    })
  }

  async enqueueEmailConfirmation(data: EmailSendConfirmationJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(EMAIL_SEND_CONFIRMATION_QUEUE, data, {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    })
  }
}
