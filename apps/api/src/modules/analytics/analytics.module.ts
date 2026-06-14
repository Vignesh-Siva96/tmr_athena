import { Module } from '@nestjs/common'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'
import { CustomersController } from './customers.controller'
import { CustomersService } from './customers.service'
import { RatingController } from './rating.controller'
import { DatabaseModule } from '../database/database.module'
import { AppConfigModule } from '../config/config.module'

@Module({
  imports: [DatabaseModule, AppConfigModule],
  controllers: [AnalyticsController, CustomersController, RatingController],
  providers: [AnalyticsService, CustomersService],
})
export class AnalyticsModule {}
