import { Module, Global } from '@nestjs/common'
import { AppEventsService } from './app-events.service'

@Global()
@Module({
  providers: [AppEventsService],
  exports: [AppEventsService],
})
export class AppEventsModule {}
