import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type PgBoss from 'pg-boss'
import { PrismaService } from '../../database/prisma.service'
import { EmailService } from '../email.service'
import { QueueService } from '../../queue/queue.service'
import { EMAIL_SEND_REPLY_QUEUE } from '../../queue/queue.module'
import type { EmailSendReplyJobData } from '../../queue/queue.service'

@Injectable()
export class SendReplyWorker implements OnModuleInit {
  private readonly logger = new Logger(SendReplyWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly email: EmailService,
    private readonly db: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.ready()

    this.queue.getBoss().work<EmailSendReplyJobData>(
      EMAIL_SEND_REPLY_QUEUE,
      async (job) => {
        const meta = job as unknown as PgBoss.JobWithMetadata<EmailSendReplyJobData>
        const { ticketId, messageId } = job.data
        this.logger.debug(`Sending reply email for message ${messageId} on ticket ${ticketId} (attempt ${meta.retrycount + 1}/${meta.retrylimit + 1})`)

        const appConfig = await this.db.appConfig.findFirst()
        if (!appConfig) {
          this.logger.warn(`No AppConfig found — skipping reply email for message ${messageId}`)
          return
        }

        const ticket = await this.db.ticket.findUnique({
          where: { id: ticketId },
          include: { user: true },
        })
        if (!ticket) {
          this.logger.warn(`Ticket ${ticketId} not found — skipping reply email`)
          return
        }

        const message = await this.db.message.findUnique({
          where: { id: messageId },
          include: { authorAgent: { select: { id: true, name: true } } },
        })
        if (!message) {
          this.logger.warn(`Message ${messageId} not found — skipping reply email`)
          return
        }

        try {
          const msgId = await this.email.sendAgentReply(ticket, message, appConfig)
          if (msgId) {
            await this.db.message.update({ where: { id: messageId }, data: { messageId: msgId } })
          }
        } catch (err) {
          const isFinalAttempt = meta.retrycount >= meta.retrylimit
          if (isFinalAttempt) {
            // Write a visible SYSTEM_EVENT so agents see the delivery failure in the thread
            try {
              await this.db.message.create({
                data: {
                  ticketId,
                  type: 'SYSTEM_EVENT',
                  body: `email_delivery_failed:Reply to message ${messageId} failed after ${meta.retrylimit + 1} attempts`,
                  isInternal: true,
                },
              })
            } catch (dbErr) {
              this.logger.error(`Failed to write email_delivery_failed event: ${String(dbErr)}`)
            }
            this.logger.error(`Reply email permanently failed for message ${messageId}: ${String(err)}`)
          } else {
            this.logger.warn(`Reply email failed (attempt ${meta.retrycount + 1}), will retry: ${String(err)}`)
            throw err
          }
        }
      },
    )

    this.logger.log(`Worker registered for queue: ${EMAIL_SEND_REPLY_QUEUE}`)
  }
}
