import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QueueService, AnalyzeMessageJobData } from '../../queue/queue.service'
import { AI_ANALYZE_MESSAGE_QUEUE } from '../../queue/queue.module'
import { GeminiService } from '../gemini.service'
import { PrismaService } from '../../database/prisma.service'

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

      const message = await this.db.message.findUnique({
        where: { id: messageId },
        include: { ticket: { select: { id: true, priority: true, assigneeId: true, number: true, title: true } } },
      })
      if (!message || message.analyzedAt || !message.authorUserId) return

      try {
        const result = await this.gemini.analyzeMessage(message.body, { ticketId, messageId })

        // Write sentiment back to the message
        await this.db.message.update({
          where: { id: messageId },
          data: {
            sentimentScore: result.sentiment.score,
            sentimentLabel: result.sentiment.label,
            analyzedAt: new Date(),
          },
        })

        const ticket = message.ticket

        // Handle churn risk signal (active)
        if (result.churnSignal?.detected) {
          await this.db.customerSignal.create({
            data: {
              type: 'CHURN_RISK',
              quote: result.churnSignal.quote,
              reason: result.churnSignal.reason,
              messageId,
              ticketId,
              userId: message.authorUserId,
            },
          })

          // Notify the assignee (or add a general notification if unassigned)
          const appConfig = await this.db.appConfig.findFirst({ select: { id: true } })
          await this.db.notification.create({
            data: {
              type: 'CHURN_RISK_DETECTED',
              title: `Churn risk detected on ticket #${ticket.number}`,
              body: `"${result.churnSignal.quote.slice(0, 120)}"`,
              ticketId,
              appConfigId: appConfig?.id ?? null,
            },
          })

          // Bump priority NORMAL → HIGH and append SYSTEM_EVENT message
          if (ticket.priority === 'NORMAL') {
            await this.db.$transaction([
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
            ])
          }
        }

        // Handle advocacy signal (passive — insert only)
        if (result.advocacySignal?.detected) {
          await this.db.customerSignal.create({
            data: {
              type: 'ADVOCACY',
              quote: result.advocacySignal.quote,
              reason: result.advocacySignal.reason,
              messageId,
              ticketId,
              userId: message.authorUserId,
            },
          })
        }
      } catch (err) {
        this.logger.error(`analyze-message failed for msg=${messageId}: ${String(err)}`)
        throw err
      }
    })
  }
}
