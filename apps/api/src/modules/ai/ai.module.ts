import { Global, Module } from '@nestjs/common'
import { GeminiService } from './gemini.service'
import { DatabaseModule } from '../database/database.module'
import { AnalyzeMessageWorker } from './workers/analyze-message.worker'
import { ClassifyTicketWorker } from './workers/classify-ticket.worker'
import { RequestCsatWorker } from './workers/request-csat.worker'
import { EmailModule } from '../email/email.module'

@Global()
@Module({
  imports: [DatabaseModule, EmailModule],
  providers: [GeminiService, AnalyzeMessageWorker, ClassifyTicketWorker, RequestCsatWorker],
  exports: [GeminiService],
})
export class AiModule {}
