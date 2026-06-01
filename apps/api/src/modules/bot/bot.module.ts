import { Global, Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { EmailModule } from '../email/email.module'
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module'
import { EventsModule } from '../events/events.module'
import { MarkdownService } from '../ai/markdown.service'
import { BotService } from './bot.service'
import { RetrievalService } from './retrieval.service'
import { GeneratorService } from './generator.service'
import { ShiftResolverService } from './shift-resolver.service'
import { RespondToNewTicketWorker } from './workers/respond-to-new-ticket.worker'

@Global()
@Module({
  imports: [DatabaseModule, EmailModule, KnowledgeBaseModule, EventsModule],
  providers: [
    MarkdownService,
    BotService,
    RetrievalService,
    GeneratorService,
    ShiftResolverService,
    RespondToNewTicketWorker,
  ],
  exports: [BotService],
})
export class BotModule {}
