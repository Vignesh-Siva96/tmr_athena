import { Module } from '@nestjs/common'
import { ConfigController } from './config.controller'
import { AppConfigService } from './config.service'
import { AiUsageController } from './ai-usage.controller'
import { AppEventsModule } from '../../common/events/app-events.module'
import { DatabaseModule } from '../database/database.module'

@Module({
  imports: [AppEventsModule, DatabaseModule],
  controllers: [ConfigController, AiUsageController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
