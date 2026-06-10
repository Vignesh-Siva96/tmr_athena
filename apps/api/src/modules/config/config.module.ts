import { Module } from '@nestjs/common'
import { ConfigController } from './config.controller'
import { AppConfigService } from './config.service'
import { AiUsageController } from './ai-usage.controller'
import { DatabaseModule } from '../database/database.module'
import { FilesModule } from '../files/files.module'

@Module({
  imports: [DatabaseModule, FilesModule],
  controllers: [ConfigController, AiUsageController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
