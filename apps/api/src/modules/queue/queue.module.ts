import { Global, Module } from '@nestjs/common'
import { QueueService } from './queue.service'

export const AI_ANALYZE_MESSAGE_QUEUE = 'ai:analyze-message'
export const AI_CLASSIFY_TICKET_QUEUE = 'ai:classify-ticket'
export const AI_REQUEST_CSAT_QUEUE = 'ai:request-csat'

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
