import { Controller, Get, UseGuards } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'

@Controller('analytics')
@UseGuards(AuthGuard, AgentGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  getOverview() {
    return this.analyticsService.getOverview()
  }
}
