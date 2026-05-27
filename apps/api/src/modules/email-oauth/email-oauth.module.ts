import { Module } from '@nestjs/common'
import { EmailOAuthController } from './email-oauth.controller'
import { EmailOAuthService } from './email-oauth.service'
import { TokenRefresher } from './token-refresher'
import { AppConfigModule } from '../config/config.module'
import { AppEventsModule } from '../../common/events/app-events.module'

/** Token used by AppModule to inject EmailSyncBackfillService into EmailOAuthModule without circular deps */
export const EMAIL_SYNC_BACKFILL_SERVICE_TOKEN = 'EMAIL_SYNC_BACKFILL_SERVICE'

@Module({
  imports: [AppConfigModule, AppEventsModule],
  controllers: [EmailOAuthController],
  providers: [EmailOAuthService, TokenRefresher],
  exports: [EmailOAuthService, TokenRefresher],
})
export class EmailOAuthModule {}
