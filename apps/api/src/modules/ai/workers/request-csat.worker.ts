import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { QueueService, RequestCsatJobData } from '../../queue/queue.service'
import { AI_REQUEST_CSAT_QUEUE } from '../../queue/queue.module'
import { PrismaService } from '../../database/prisma.service'
import { EmailService } from '../../email/email.service'
import { formatRef } from '../../tickets/util/generate-ref'

@Injectable()
export class RequestCsatWorker implements OnModuleInit {
  private readonly logger = new Logger(RequestCsatWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly db: PrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.queue.ready()
    this.queue.getBoss().work<RequestCsatJobData>(
      AI_REQUEST_CSAT_QUEUE,
      async (job) => {
        const { ticketId } = job.data
        const ticket = await this.db.ticket.findUnique({
          where: { id: ticketId },
          include: { user: true },
        })
        if (!ticket) return

        // Idempotency guard: a `csat_requested` SYSTEM_EVENT marks that the email already
        // went out for this ticket. Without it, every retry (or every resolve→reopen→resolve
        // cycle, each of which enqueues its own delayed job) re-sends the survey — annoying
        // the customer with duplicate emails. `requestedAt` on TicketRating can't be used for
        // this: classify-ticket.worker upserts the same row first and stamps it on creation,
        // long before any email is actually sent.
        const alreadySent = await this.db.message.findFirst({
          where: { ticketId, type: 'SYSTEM_EVENT', body: 'csat_requested' },
          select: { id: true },
        })
        if (alreadySent) {
          this.logger.debug(`CSAT email already sent for ticket ${ticketId} — skipping`)
          return
        }

        const appConfig = await this.db.appConfig.findFirst()
        if (!appConfig) return

        // Ensure a TicketRating row exists and get the token
        const rating = await this.db.ticketRating.upsert({
          where: { ticketId },
          create: { ticketId },
          update: {},
        })

        const apiUrl = this.config.get<string>('PORTAL_URL') ?? 'http://localhost:3000'
        const rateUrl = `${apiUrl}/rate/${rating.ratingToken}`
        const customerName = ticket.user.name ?? 'there'
        const appName = appConfig.appName

        await this.emailService.sendRaw({
          to: ticket.user.email,
          subject: `How did we do? [${formatRef(ticket.ref)}]`,
          text: [
            `Hi ${customerName},`,
            '',
            `Your support request "${ticket.title}" has been resolved.`,
            '',
            `We'd love to hear how we did. Please rate your experience (takes 10 seconds):`,
            '',
            `⭐ Rate your experience: ${rateUrl}`,
            '',
            `Thank you for using ${appName}!`,
            '',
            `— ${appName} Support Team`,
          ].join('\n'),
        })

        // Record the send so retries / future resolve cycles don't duplicate it
        await this.db.message.create({
          data: { ticketId, type: 'SYSTEM_EVENT', body: 'csat_requested', isInternal: true },
        })

        this.logger.log(`Sent CSAT email for ticket ${ticketId}`)
      },
    )
  }
}
