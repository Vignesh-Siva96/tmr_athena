import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppConfigModule } from '../config/config.module'
import { EmailOAuthModule } from '../email-oauth/email-oauth.module'
import { AppEventsModule } from '../../common/events/app-events.module'
import { CustomerResolverService } from './customer-resolver.service'
import { ThreadIngestionService } from './thread-ingestion.service'
import { ProviderFactory } from './providers/provider-factory'
import { EmailSyncBackfillService } from './email-sync-backfill.service'
import { EmailSyncController } from './email-sync.controller'
import { LivePollerService } from './live-poller.service'

@Module({
  imports: [AppConfigModule, EmailOAuthModule, AppEventsModule, ScheduleModule.forRoot()],
  controllers: [EmailSyncController],
  providers: [
    CustomerResolverService,
    ThreadIngestionService,
    ProviderFactory,
    EmailSyncBackfillService,
    LivePollerService,
  ],
  exports: [
    CustomerResolverService,
    ThreadIngestionService,
    ProviderFactory,
    EmailSyncBackfillService,
    LivePollerService,
  ],
})
export class EmailSyncModule {}
