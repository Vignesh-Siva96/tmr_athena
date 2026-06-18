import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppConfigModule } from '../config/config.module'
import { EmailModule } from '../email/email.module'
import { EmailOAuthModule } from '../email-oauth/email-oauth.module'
import { AppEventsModule } from '../../common/events/app-events.module'
import { FilesModule } from '../files/files.module'
import { CustomerResolverService } from './customer-resolver.service'
import { ThreadIngestionService } from './thread-ingestion.service'
import { ProviderFactory } from './providers/provider-factory'
import { EmailSyncBackfillService } from './email-sync-backfill.service'
import { EmailSyncController } from './email-sync.controller'
import { LivePollerService } from './live-poller.service'
import { IngestThreadWorker } from './ingest-thread.worker'

@Module({
  imports: [AppConfigModule, EmailModule, EmailOAuthModule, AppEventsModule, FilesModule, ScheduleModule.forRoot()],
  controllers: [EmailSyncController],
  providers: [
    CustomerResolverService,
    ThreadIngestionService,
    ProviderFactory,
    EmailSyncBackfillService,
    LivePollerService,
    IngestThreadWorker,
  ],
  exports: [
    CustomerResolverService,
    ThreadIngestionService,
    ProviderFactory,
    EmailSyncBackfillService,
    LivePollerService,
    IngestThreadWorker,
  ],
})
export class EmailSyncModule {}
