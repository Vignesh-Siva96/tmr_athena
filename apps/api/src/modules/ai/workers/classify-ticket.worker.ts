import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QueueService, ClassifyTicketJobData } from '../../queue/queue.service'
import { AI_CLASSIFY_TICKET_QUEUE } from '../../queue/queue.module'
import { GeminiService } from '../gemini.service'
import { PrismaService } from '../../database/prisma.service'
import type { Prisma } from '@tmr/db'
import { isFeatureSuppressed } from '../../config/feature-flags'

@Injectable()
export class ClassifyTicketWorker implements OnModuleInit {
  private readonly logger = new Logger(ClassifyTicketWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly gemini: GeminiService,
    private readonly db: PrismaService,
  ) {}

  async onModuleInit() {
    await this.queue.ready()
    this.queue.getBoss().work<ClassifyTicketJobData>(AI_CLASSIFY_TICKET_QUEUE, async (job) => {
      const { ticketId } = job.data

      const appConfig = await this.db.appConfig.findFirst()
      if (appConfig && isFeatureSuppressed(appConfig, 'aiAnalysis')) {
        this.logger.log(`AI analysis suppressed by feature flag for ticket ${ticketId}`)
        return
      }

      const ticket = await this.db.ticket.findUnique({
        where: { id: ticketId },
        include: {
          messages: {
            where: { type: 'REPLY', isInternal: false, deletedAt: null },
            orderBy: { createdAt: 'asc' },
            take: 10,
            select: { body: true, authorUserId: true, authorAgentId: true },
          },
        },
      })
      if (!ticket || !ticket.isTicket) return

      const msgSummary = ticket.messages
        .map((m) => `[${m.authorAgentId ? 'Agent' : 'Customer'}]: ${m.body.slice(0, 200)}`)
        .join('\n')

      try {
        // Fetch existing topic names so Gemini can reuse them
        const existingTopics = await this.db.topic
          .findMany({ select: { name: true }, orderBy: { ticketCount: 'desc' }, take: 30 })
          .then((rows) => rows.map((r) => r.name))

        const result = await this.gemini.classifyAndScoreTicket(
          ticket.title,
          msgSummary,
          existingTopics,
          { ticketId },
        )

        // Upsert the topic
        const topicRecord = await this.db.topic.upsert({
          where: { name: result.topic.name },
          create: { name: result.topic.name },
          update: {},
        })

        // Idempotency: classification can run more than once for the same ticket (job
        // retries, or another resolve→reopen→resolve cycle re-enqueues it). Blindly
        // incrementing `ticketCount` every run double/triple-counts; reassigning to a
        // different topic without decrementing the old one leaves both counts drifted.
        // Only touch counts when the topic assignment actually changes.
        const previousTopicId = ticket.topicId
        const topicChanged = previousTopicId !== topicRecord.id

        const ops: Prisma.PrismaPromise<unknown>[] = [
          this.db.ticket.update({
            where: { id: ticketId },
            data: { topicId: topicRecord.id },
          }),
        ]
        if (topicChanged) {
          ops.push(
            this.db.topic.update({
              where: { id: topicRecord.id },
              data: { ticketCount: { increment: 1 } },
            }),
          )
          if (previousTopicId) {
            ops.push(
              this.db.topic.update({
                where: { id: previousTopicId },
                data: { ticketCount: { decrement: 1 } },
              }),
            )
          }
        }
        ops.push(
          this.db.ticketRating.upsert({
            where: { ticketId },
            create: {
              ticketId,
              aiRating: result.csat.rating,
              aiReasoning: result.csat.reasoning,
              aiEffortScore: result.effort.score,
              aiSummary: result.summary,
            },
            update: {
              aiRating: result.csat.rating,
              aiReasoning: result.csat.reasoning,
              aiEffortScore: result.effort.score,
              aiSummary: result.summary,
            },
          }),
        )

        await this.db.$transaction(ops)
      } catch (err) {
        this.logger.error(`classify-ticket failed for ticket=${ticketId}: ${String(err)}`)
        throw err
      }
    })
  }
}
