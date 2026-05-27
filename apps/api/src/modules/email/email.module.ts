import { Module } from '@nestjs/common'
import { EmailService } from './email.service'
import { AppConfigModule } from '../config/config.module'
import { EmailOAuthModule } from '../email-oauth/email-oauth.module'

@Module({
  imports: [AppConfigModule, EmailOAuthModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
