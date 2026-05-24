import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import PgBoss from 'pg-boss'
import {
  INBOUND_EMAIL_QUEUE,
  AI_ANALYZE_MESSAGE_QUEUE,
  AI_CLASSIFY_TICKET_QUEUE,
  AI_REQUEST_CSAT_QUEUE,
} from './queue.module'

export interface InboundEmailJobData {
  uid: number
  rawMime: string
  receivedAt: string
}

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

  constructor(private readonly config: ConfigService) {
    const connectionString = this.config.get<string>('DATABASE_URL')
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for QueueService')
    }
    this.boss = new PgBoss({ connectionString, schema: 'pgboss' })
    this.boss.on('error', (err: Error) => this.logger.error(`pg-boss error: ${err.message}`))
    this.readyPromise = this.boss.start().then(() => {
      this.logger.log('pg-boss started')
    })
  }

  async onModuleInit(): Promise<void> {
    await this.readyPromise
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.boss.stop({ graceful: true, timeout: 5000 })
    } catch {
      /* ignore */
    }
  }

  async ready(): Promise<void> {
    await this.readyPromise
  }

  getBoss(): PgBoss {
    return this.boss
  }

  async enqueueInbound(data: InboundEmailJobData): Promise<void> {
    await this.readyPromise
    await this.boss.send(INBOUND_EMAIL_QUEUE, data, {
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
      expireInHours: 24,
    })
    this.logger.debug(`Enqueued inbound email uid=${data.uid}`)
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
}
