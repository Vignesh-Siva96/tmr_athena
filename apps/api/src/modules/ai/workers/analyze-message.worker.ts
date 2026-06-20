import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QueueService, AnalyzeMessageJobData } from '../../queue/queue.service'
import { AI_ANALYZE_MESSAGE_QUEUE } from '../../queue/queue.module'
import { GeminiService } from '../gemini.service'
import { PrismaService } from '../../database/prisma.service'
import { formatRef } from '../../tickets/util/generate-ref'
import type { Prisma } from '@tmr/db'
import { isFeatureSuppressed } from '../../config/feature-flags'

@Injectable()
export class AnalyzeMessageWorker implements OnModuleInit {
  private readonly logger = new Logger(AnalyzeMessageWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly gemini: GeminiService,
    private readonly db: PrismaService,
  ) {}

  async onModuleInit() {
    await this.queue.ready()
    this.queue.getBoss().work<AnalyzeMessageJobData>(AI_ANALYZE_MESSAGE_QUEUE, async (job) => {
      const { messageId, ticketId } = job.data

      const appConfig = await this.db.appConfig.findFirst()
      if (appConfig && isFeatureSuppressed(appConfig, 'aiAnalysis')) {
        this.logger.log(`AI analysis suppressed by feature flag for message ${messageId}`)
        return
      }

      const message = await this.db.message.findUnique({
        where: { id: messageId },
        include: { ticket: { select: { id: true, isTicket: true, priority: true, assigneeId: true, ref: true, title: true } } },
      })
      if (!message || message.analyzedAt || !message.authorUserId) return
      if (!message.ticket?.isTicket) return

      try {
        const result = await this.gemini.analyzeMessage(message.body, { ticketId, messageId })
        const ticket = message.ticket

        // Idempotency: `analyzedAt` is the guard that stops this job from reprocessing a
        // message (see the early-return above). Previously it was stamped *first*, before
        // the churn/advocacy side effects ran — so a failure partway through (signal create,
        // notification, priority bump) left the message permanently marked "analyzed" with
        // those side effects silently missing; a retry would short-circuit on the guard and
        // never create them. Collecting every write into one `$transaction` makes the whole
        // analysis atomic: either everything lands together (including the `analyzedAt`
        // stamp), or nothing does and a retry safely reprocesses from scratch.
        const ops: Prisma.PrismaPromise<unknown>[] = [
          this.db.message.update({
            where: { id: messageId },
            data: {
              sentimentScore: result.sentiment.score,
              sentimentLabel: result.sentiment.label,
              analyzedAt: new Date(),
            },
          }),
        ]

        // Handle churn risk signal (active)
        if (result.churnSignal?.detected) {
          const appConfig = await this.db.appConfig.findFirst({ select: { id: true } })

          ops.push(
            this.db.customerSignal.create({
              data: {
                type: 'CHURN_RISK',
                quote: result.churnSignal.quote,
                reason: result.churnSignal.reason,
                messageId,
                ticketId,
                userId: message.authorUserId,
              },
            }),
            this.db.notification.create({
              data: {
                type: 'CHURN_RISK_DETECTED',
                title: `Churn risk detected on ticket ${formatRef(ticket.ref)}`,
                body: `"${result.churnSignal.quote.slice(0, 120)}"`,
                ticketId,
                appConfigId: appConfig?.id ?? null,
              },
            }),
          )

          // Bump priority NORMAL → HIGH and append SYSTEM_EVENT message
          if (ticket.priority === 'NORMAL') {
            ops.push(
              this.db.ticket.update({
                where: { id: ticketId },
                data: { priority: 'HIGH' },
              }),
              this.db.message.create({
                data: {
                  ticketId,
                  type: 'SYSTEM_EVENT',
                  body: 'Priority raised to HIGH — churn risk detected in customer message.',
                  isInternal: true,
                },
              }),
            )
          }
        }

        // Handle advocacy signal (passive — insert only)
        if (result.advocacySignal?.detected) {
          ops.push(
            this.db.customerSignal.create({
              data: {
                type: 'ADVOCACY',
                quote: result.advocacySignal.quote,
                reason: result.advocacySignal.reason,
                messageId,
                ticketId,
                userId: message.authorUserId,
              },
            }),
          )
        }

        await this.db.$transaction(ops)
      } catch (err) {
        this.logger.error(`analyze-message failed for msg=${messageId}: ${String(err)}`)
        throw err
      }
    })
  }
}
