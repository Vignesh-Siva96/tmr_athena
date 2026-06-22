import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QueueService, FetchTmrMetadataJobData } from '../queue/queue.service'
import { FETCH_TMR_METADATA_QUEUE } from '../queue/queue.module'
import { TmrDataService } from './tmr-data.service'

@Injectable()
export class FetchTmrMetadataWorker implements OnModuleInit {
  private readonly logger = new Logger(FetchTmrMetadataWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly tmrData: TmrDataService,
  ) {}

  async onModuleInit() {
    await this.queue.ready()
    this.queue.getBoss().work<FetchTmrMetadataJobData>(FETCH_TMR_METADATA_QUEUE, async (job) => {
      const { userId } = job.data
      this.logger.debug(`Syncing TMR metadata for user ${userId}`)
      await this.tmrData.syncUser(userId)
    })
  }
}
