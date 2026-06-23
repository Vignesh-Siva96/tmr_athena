import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QueueService } from '../../queue/queue.service'
import { BOT_RESPOND_QUEUE } from '../../queue/queue.module'
import { BotService } from '../bot.service'

@Injectable()
export class RespondToNewTicketWorker implements OnModuleInit {
  private readonly logger = new Logger(RespondToNewTicketWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly bot: BotService,
  ) {}

  async onModuleInit() {
    await this.queue.ready()

    this.queue.getBoss().work<{ ticketId: string }>(
      BOT_RESPOND_QUEUE,
      { includeMetadata: true },
      async (job) => {
        const { ticketId } = job.data
        // pg-boss increments retrycount on each retry; once it reaches retrylimit
        // there are no attempts left, so BotService escalates instead of rethrowing.
        const isFinalAttempt = job.retrycount >= job.retrylimit
        this.logger.debug(
          `Processing bot:respond-to-ticket job for ticket ${ticketId} (attempt ${job.retrycount + 1}/${job.retrylimit + 1})`,
        )
        await this.bot.respondTo(ticketId, { isFinalAttempt })
      },
    )

    this.logger.log(`Worker registered for queue: ${BOT_RESPOND_QUEUE}`)
  }
}
