import { Module, OnModuleInit } from '@nestjs/common'
import { EmailService } from './email.service'
import { ImapClientService } from './imap-client.service'
import { InboundEmailProcessor } from './inbound.processor'
import { EmailRoutingService } from './routing.service'
import { AppConfigModule } from '../config/config.module'
import { AppEventsModule } from '../../common/events/app-events.module'

@Module({
  imports: [AppConfigModule, AppEventsModule],
  providers: [EmailService, ImapClientService, InboundEmailProcessor, EmailRoutingService],
  exports: [EmailService, ImapClientService],
})
export class EmailModule implements OnModuleInit {
  constructor(private readonly imapClientService: ImapClientService) {}

  onModuleInit(): void {
    void this.imapClientService.start()
  }
}
