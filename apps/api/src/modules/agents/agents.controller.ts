import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { AgentsService } from './agents.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { inviteAgentSchema, updateAgentSchema, type InviteAgentDto, type UpdateAgentDto } from './agents.dto'

@Controller('agents')
@UseGuards(AuthGuard, AgentGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  list() {
    return this.agentsService.list()
  }

  @Post('invite')
  @UseGuards(AdminGuard)
  invite(
    @Body(new ZodValidationPipe(inviteAgentSchema)) dto: InviteAgentDto,
  ) {
    return this.agentsService.invite(dto)
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAgentSchema)) dto: UpdateAgentDto,
  ) {
    return this.agentsService.update(id, dto)
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.agentsService.remove(id)
  }
}
