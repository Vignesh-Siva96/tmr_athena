import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common'
import { NotificationsService } from './notifications.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import type { Agent } from '@tmr/db'

@Controller('notifications')
@UseGuards(AuthGuard, AgentGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentAgent() agent: Agent) {
    return this.notificationsService.list(agent.id)
  }

  @Get('unread-count')
  unreadCount(@CurrentAgent() agent: Agent) {
    return this.notificationsService.unreadCount(agent.id)
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentAgent() agent: Agent) {
    return this.notificationsService.markRead(id, agent.id)
  }

  @Patch('read-all')
  markAllRead(@CurrentAgent() agent: Agent) {
    return this.notificationsService.markAllRead(agent.id)
  }
}
