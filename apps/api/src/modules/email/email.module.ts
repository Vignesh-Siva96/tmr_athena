import { Module } from '@nestjs/common'
import { EmailService } from './email.service'
import { AppConfigModule } from '../config/config.module'
import { EmailOAuthModule } from '../email-oauth/email-oauth.module'
import { DatabaseModule } from '../database/database.module'
import { SendReplyWorker } from './workers/send-reply.worker'

@Module({
  imports: [AppConfigModule, EmailOAuthModule, DatabaseModule],
  providers: [EmailService, SendReplyWorker],
  exports: [EmailService],
})
export class EmailModule {}
