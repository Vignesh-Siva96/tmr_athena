import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { CannedResponsesService } from './canned-responses.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { createCannedResponseSchema, updateCannedResponseSchema, type CreateCannedResponseDto, type UpdateCannedResponseDto } from './canned-responses.dto'

@Controller('canned-responses')
@UseGuards(AuthGuard, AgentGuard)
export class CannedResponsesController {
  constructor(private readonly cannedResponsesService: CannedResponsesService) {}

  @Get()
  list() {
    return this.cannedResponsesService.list()
  }

  @Post()
  create(@Body(new ZodValidationPipe(createCannedResponseSchema)) dto: CreateCannedResponseDto) {
    return this.cannedResponsesService.create(dto)
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCannedResponseSchema)) dto: UpdateCannedResponseDto,
  ) {
    return this.cannedResponsesService.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cannedResponsesService.remove(id)
  }
}
