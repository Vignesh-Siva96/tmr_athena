import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { TagsService } from './tags.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { createTagSchema, updateTagSchema, type CreateTagDto, type UpdateTagDto } from './tags.dto'

@Controller('tags')
@UseGuards(AuthGuard, AgentGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  list() {
    return this.tagsService.list()
  }

  @Post()
  create(@Body(new ZodValidationPipe(createTagSchema)) dto: CreateTagDto) {
    return this.tagsService.create(dto)
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTagSchema)) dto: UpdateTagDto,
  ) {
    return this.tagsService.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tagsService.remove(id)
  }
}
