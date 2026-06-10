import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type PgBoss from 'pg-boss'
import { PrismaService } from '../../database/prisma.service'
import { EmailService } from '../email.service'
import { QueueService } from '../../queue/queue.service'
import { EMAIL_SEND_CONFIRMATION_QUEUE } from '../../queue/queue.module'
import type { EmailSendConfirmationJobData } from '../../queue/queue.service'

@Injectable()
export class SendConfirmationWorker implements OnModuleInit {
  private readonly logger = new Logger(SendConfirmationWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly email: EmailService,
    private readonly db: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.ready()

    this.queue.getBoss().work<EmailSendConfirmationJobData>(
      EMAIL_SEND_CONFIRMATION_QUEUE,
      async (job) => {
        const meta = job as unknown as PgBoss.JobWithMetadata<EmailSendConfirmationJobData>
        const { ticketId } = job.data
        this.logger.debug(`Sending confirmation email for ticket ${ticketId} (attempt ${meta.retrycount + 1}/${meta.retrylimit + 1})`)

        // Idempotency guard: skip if confirmation was already sent
        const alreadySent = await this.db.message.findFirst({
          where: { ticketId, type: 'SYSTEM_EVENT', body: { startsWith: 'confirmation_sent:' } },
          select: { id: true },
        })
        if (alreadySent) {
          this.logger.debug(`Confirmation already sent for ticket ${ticketId} — skipping`)
          return
        }

        const appConfig = await this.db.appConfig.findFirst()
        if (!appConfig) {
          this.logger.warn(`No AppConfig found — skipping confirmation email for ticket ${ticketId}`)
          return
        }

        const ticket = await this.db.ticket.findUnique({
          where: { id: ticketId },
          include: { user: true },
        })
        if (!ticket) {
          this.logger.warn(`Ticket ${ticketId} not found — skipping confirmation email`)
          return
        }

        try {
          await this.email.sendTicketConfirmation(ticket, appConfig)
          await this.db.message.create({
            data: {
              ticketId,
              type: 'SYSTEM_EVENT',
              body: `confirmation_sent:${ticket.user.email}`,
              isInternal: true,
            },
          })
          this.logger.log(`Confirmation email sent for ticket ${ticketId}`)
        } catch (err) {
          const isFinalAttempt = meta.retrycount >= meta.retrylimit
          if (isFinalAttempt) {
            try {
              await this.db.message.create({
                data: {
                  ticketId,
                  type: 'SYSTEM_EVENT',
                  body: `email_delivery_failed:Confirmation email for ticket ${ticketId} failed after ${meta.retrylimit + 1} attempts`,
                  isInternal: true,
                },
              })
            } catch (dbErr) {
              this.logger.error(`Failed to write confirmation failure event: ${String(dbErr)}`)
            }
            this.logger.error(`Confirmation email permanently failed for ticket ${ticketId}: ${String(err)}`)
          } else {
            this.logger.warn(`Confirmation email failed (attempt ${meta.retrycount + 1}), will retry: ${String(err)}`)
            throw err
          }
        }
      },
    )

    this.logger.log(`Worker registered for queue: ${EMAIL_SEND_CONFIRMATION_QUEUE}`)
  }
}
