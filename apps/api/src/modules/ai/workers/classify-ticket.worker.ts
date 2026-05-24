import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QueueService, ClassifyTicketJobData } from '../../queue/queue.service'
import { AI_CLASSIFY_TICKET_QUEUE } from '../../queue/queue.module'
import { GeminiService } from '../gemini.service'
import { PrismaService } from '../../database/prisma.service'

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
      if (!ticket) return

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

        await this.db.$transaction([
          this.db.ticket.update({
            where: { id: ticketId },
            data: { topicId: topicRecord.id },
          }),
          this.db.topic.update({
            where: { id: topicRecord.id },
            data: { ticketCount: { increment: 1 } },
          }),
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
        ])
      } catch (err) {
        this.logger.error(`classify-ticket failed for ticket=${ticketId}: ${String(err)}`)
        throw err
      }
    })
  }
}
