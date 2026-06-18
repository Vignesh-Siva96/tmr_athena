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
        const { ticketId, messageId, kind } = job.data
        this.logger.debug(
          `Sending ${kind === 'portal-copy' ? 'portal ack' : 'reply'} email for message ${messageId} on ticket ${ticketId} (attempt ${meta.retrycount + 1}/${meta.retrylimit + 1})`,
        )

        const appConfig = await this.db.appConfig.findFirst()
        if (!appConfig) {
          this.logger.warn(`No AppConfig found — skipping reply email for message ${messageId}`)
          return
        }

        // G1: portal-copy is only sent when the AppConfig toggle is enabled
        if (kind === 'portal-copy' && !appConfig.mirrorPortalRepliesToEmail) {
          this.logger.debug(`mirrorPortalRepliesToEmail disabled — skipping portal copy for message ${messageId}`)
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

        // Defense in depth: the enqueue site (messages.service.ts) already filters to
        // agent-authored, non-internal `REPLY` messages, but the worker is the thing that
        // actually puts the content on the wire to the customer — it must not blindly trust
        // the queue. A bad enqueue (future call site, retry/replay tooling, bug) sending an
        // INTERNAL_NOTE here would leak internal triage discussion straight to the customer.
        if (message.type !== 'REPLY' || message.isInternal) {
          this.logger.warn(
            `Message ${messageId} is not a customer-facing reply (type=${message.type}, isInternal=${message.isInternal}) — refusing to email it`,
          )
          return
        }

        try {
          let msgId: string
          if (kind === 'portal-copy') {
            // G1: "Received your response" ack — From/To=customer, Reply-To=support, threaded
            msgId = await this.email.sendPortalReplyAck(ticket, message, appConfig)
          } else {
            const result = await this.email.sendAgentReply(ticket, message, appConfig)
            msgId = result.messageId
            // Mark the agent message + everything quoted in it as delivered, so a later
            // reply doesn't re-quote them.
            await this.email.markMessagesEmailed([messageId, ...result.quotedMessageIds])
          }
          // Store the returned Message-ID on the Message row so the poller deduplicates the copy
          await this.db.message.update({ where: { id: messageId }, data: { messageId: msgId } })
        } catch (err) {
          const isFinalAttempt = meta.retrycount >= meta.retrylimit
          if (isFinalAttempt) {
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
