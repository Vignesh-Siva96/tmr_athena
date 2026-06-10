import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ShiftsService, CreateShiftDto } from './shifts.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { AdminGuard } from '../../common/guards/admin.guard'

@Controller('shifts')
@UseGuards(AuthGuard, AgentGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  findAll() {
    return this.shiftsService.findAll()
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() body: CreateShiftDto) {
    return this.shiftsService.create(body)
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() body: { active?: boolean }) {
    return this.shiftsService.update(id, body)
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  delete(@Param('id') id: string) {
    return this.shiftsService.delete(id)
  }
}
