import { Global, Module } from '@nestjs/common'
import { QueueService } from './queue.service'

export const AI_ANALYZE_MESSAGE_QUEUE = 'ai:analyze-message'
export const AI_CLASSIFY_TICKET_QUEUE = 'ai:classify-ticket'
export const AI_REQUEST_CSAT_QUEUE = 'ai:request-csat'
export const BOT_RESPOND_QUEUE = 'bot:respond-to-ticket'
export const KB_CRAWL_QUEUE = 'kb:crawl-and-index'
export const KB_INDEX_PAGE_QUEUE = 'kb:index-page'
export const KB_SCAN_QUEUE = 'kb:scan'
export const KB_EMBED_QUEUE = 'kb:embed'
export const EMAIL_SEND_REPLY_QUEUE = 'email:send-reply'
export const EMAIL_SEND_CONFIRMATION_QUEUE = 'email:send-confirmation'

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
