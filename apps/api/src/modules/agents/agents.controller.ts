import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ForbiddenException } from '@nestjs/common'
import { AgentsService } from './agents.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { inviteAgentSchema, updateAgentSchema, type InviteAgentDto, type UpdateAgentDto } from './agents.dto'
import type { Agent } from '@tmr/db'

@Controller('agents')
@UseGuards(AuthGuard, AgentGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  list() {
    return this.agentsService.list()
  }

  @Post('invite')
  invite(
    @CurrentAgent() agent: Agent,
    @Body(new ZodValidationPipe(inviteAgentSchema)) dto: InviteAgentDto,
  ) {
    if (agent.role !== 'ADMIN') throw new ForbiddenException('Admin access required')
    return this.agentsService.invite(dto)
  }

  @Patch(':id')
  update(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAgentSchema)) dto: UpdateAgentDto,
  ) {
    if (agent.role !== 'ADMIN') throw new ForbiddenException('Admin access required')
    return this.agentsService.update(id, dto)
  }

  @Delete(':id')
  remove(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
  ) {
    if (agent.role !== 'ADMIN') throw new ForbiddenException('Admin access required')
    return this.agentsService.remove(id)
  }
}
