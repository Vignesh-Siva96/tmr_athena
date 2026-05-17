import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { UsersService } from './users.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { createNoteSchema, updateNoteSchema, type CreateNoteDto, type UpdateNoteDto } from './users.dto'
import type { Agent } from '@tmr/db'

@Controller('users')
@UseGuards(AuthGuard, AgentGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.usersService.findById(id)
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
    @Param('noteId') noteId: string,
    @Body(new ZodValidationPipe(updateNoteSchema)) dto: UpdateNoteDto,
  ) {
    return this.usersService.updateNote(noteId, agent.id, dto)
  }

  @Delete(':id/notes/:noteId')
  deleteNote(
    @CurrentAgent() agent: Agent,
    @Param('noteId') noteId: string,
  ) {
    return this.usersService.deleteNote(noteId, agent.id)
  }
}
