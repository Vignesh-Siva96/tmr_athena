import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QueueService } from '../queue/queue.service'
import { EMAIL_INGEST_THREAD_QUEUE } from '../queue/queue.module'
import type { IngestThreadJobData } from '../queue/queue.service'
import { AppConfigService } from '../config/config.service'
import { ProviderFactory } from './providers/provider-factory'
import { ThreadIngestionService } from './thread-ingestion.service'
import type PgBoss from 'pg-boss'

@Injectable()
export class IngestThreadWorker implements OnModuleInit {
  private readonly logger = new Logger(IngestThreadWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly appConfig: AppConfigService,
    private readonly providerFactory: ProviderFactory,
    private readonly ingestion: ThreadIngestionService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.ready()

    this.queue.getBoss().work<IngestThreadJobData>(
      EMAIL_INGEST_THREAD_QUEUE,
      async (job) => {
        const meta = job as unknown as PgBoss.JobWithMetadata<IngestThreadJobData>
        const { cfgId, threadId } = job.data
        this.logger.debug(
          `Ingesting thread ${threadId} for cfg ${cfgId} (attempt ${meta.retrycount + 1}/${meta.retrylimit + 1})`,
        )

        const cfgs = await this.appConfig.findActiveOauth()
        const cfg = cfgs.find(c => c.id === cfgId)
        if (!cfg) {
          this.logger.warn(`Config ${cfgId} not found or no longer active — skipping ingest for thread ${threadId}`)
          return
        }

        const provider = this.providerFactory.for(cfg)
        await this.ingestion.fetchAndUpsertThread(provider, threadId, { isBackfill: false })
      },
    )

    this.logger.log(`Worker registered for queue: ${EMAIL_INGEST_THREAD_QUEUE}`)
  }
}
