import { Module } from '@nestjs/common'
import { EmailService } from './email.service'
import { AppConfigModule } from '../config/config.module'
import { EmailOAuthModule } from '../email-oauth/email-oauth.module'
import { DatabaseModule } from '../database/database.module'
import { SendReplyWorker } from './workers/send-reply.worker'
import { SendConfirmationWorker } from './workers/send-confirmation.worker'
import { SendVerificationWorker } from './workers/send-verification.worker'
import { SendPasswordResetWorker } from './workers/send-password-reset.worker'

@Module({
  imports: [AppConfigModule, EmailOAuthModule, DatabaseModule],
  providers: [EmailService, SendReplyWorker, SendConfirmationWorker, SendVerificationWorker, SendPasswordResetWorker],
  exports: [EmailService],
})
export class EmailModule {}
