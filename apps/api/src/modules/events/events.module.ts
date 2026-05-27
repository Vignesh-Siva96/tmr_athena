import { Global, Module } from '@nestjs/common'
import { SseService } from './sse.service'
import { SseController } from './sse.controller'
import { EmailSyncModule } from '../email-sync/email-sync.module'

@Global()
@Module({
  imports: [],
  controllers: [SseController],
  providers: [SseService],
  exports: [SseService],
})
export class EventsModule {}
