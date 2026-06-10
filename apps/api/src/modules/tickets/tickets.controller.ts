import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common'
import { TicketsService } from './tickets.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { NoGuests, NoGuestsGuard } from '../../common/guards/no-guests.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import {
  listTicketsSchema,
  createTicketSchema,
  updateTicketSchema,
  type ListTicketsQuery,
  type CreateTicketDto,
  type UpdateTicketDto,
} from './tickets.dto'
import type { Agent, User } from '@tmr/db'

@Controller('tickets')
@UseGuards(AuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  private getCaller(agent: Agent | undefined, user: User | undefined) {
    if (agent) return { id: agent.id, role: 'agent' as const }
    if (user) return { id: user.id, role: 'user' as const }
    throw new ForbiddenException('Authentication required')
  }

  @Get('stats')
  @UseGuards(AgentGuard)
  stats() {
    return this.ticketsService.stats()
  }

  @Get()
  @NoGuests()
  @UseGuards(NoGuestsGuard)
  list(
    @CurrentAgent() agent: Agent,
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(listTicketsSchema)) query: ListTicketsQuery,
  ) {
    return this.ticketsService.list(query, this.getCaller(agent, user))
  }

  @Post()
  create(
    @CurrentAgent() agent: Agent,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createTicketSchema)) dto: CreateTicketDto,
  ) {
    return this.ticketsService.create(dto, this.getCaller(agent, user))
  }

  @Get(':id')
  findById(
    @CurrentAgent() agent: Agent,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.ticketsService.findById(id, this.getCaller(agent, user))
  }

  @Patch(':id')
  @UseGuards(AgentGuard)
  update(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTicketSchema)) dto: UpdateTicketDto,
  ) {
    if (!agent) throw new ForbiddenException('Agent access required')
    return this.ticketsService.update(id, dto)
  }

  @Post(':id/convert')
  @UseGuards(AgentGuard)
  convert(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
  ) {
    if (!agent) throw new ForbiddenException('Agent access required')
    return this.ticketsService.convert(id)
  }

  @Post(':id/discard')
  @UseGuards(AgentGuard)
  discard(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
  ) {
    if (!agent) throw new ForbiddenException('Agent access required')
    return this.ticketsService.discard(id, agent.id)
  }

  @Delete(':id')
  @UseGuards(AgentGuard)
  softDelete(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
  ) {
    if (!agent || agent.role !== 'ADMIN') throw new ForbiddenException('Admin access required')
    return this.ticketsService.softDelete(id)
  }
}
