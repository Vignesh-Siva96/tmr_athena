import { Module } from '@nestjs/common'
import { ConfigController } from './config.controller'
import { AppConfigService } from './config.service'

@Module({
  controllers: [ConfigController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
