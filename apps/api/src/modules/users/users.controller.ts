import { Controller, Get, Post, Patch, Delete, HttpCode, Body, Param, Query, UseGuards } from '@nestjs/common'
import { UsersService } from './users.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import {
  createNoteSchema, updateNoteSchema, listCustomersSchema, updateUserSchema,
  type CreateNoteDto, type UpdateNoteDto, type ListCustomersQuery, type UpdateUserDto,
} from './users.dto'
import type { Agent } from '@tmr/db'

@Controller('users')
@UseGuards(AuthGuard, AgentGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listCustomers(@Query(new ZodValidationPipe(listCustomersSchema)) query: ListCustomersQuery) {
    return this.usersService.listCustomers(query)
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.usersService.findById(id)
  }

  @Patch(':id')
  updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.usersService.updateCategory(id, dto)
  }

  @Post(':id/notes')
  createNote(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createNoteSchema)) dto: CreateNoteDto,
  ) {
    return this.usersService.createNote(id, agent.id, dto)
  }

  @Patch(':id/notes/:noteId')
  updateNote(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body(new ZodValidationPipe(updateNoteSchema)) dto: UpdateNoteDto,
  ) {
    return this.usersService.updateNote(id, noteId, agent.id, dto)
  }

  @Delete(':id/notes/:noteId')
  deleteNote(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
  ) {
    return this.usersService.deleteNote(id, noteId, agent.id)
  }

  @Post(':id/tmr-metadata/refresh')
  @HttpCode(202)
  refreshTmrMetadata(@Param('id') id: string) {
    return this.usersService.enqueueTmrRefresh(id)
  }
}
