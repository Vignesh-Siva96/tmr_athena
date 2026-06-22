import { Module } from '@nestjs/common'
import { AgentsController } from './agents.controller'
import { AgentsService } from './agents.service'
import { EmailModule } from '../email/email.module'
import { AppConfigModule } from '../config/config.module'

@Module({
  imports: [EmailModule, AppConfigModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
