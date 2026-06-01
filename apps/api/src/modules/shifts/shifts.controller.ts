import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common'
import { ShiftsService, CreateShiftDto } from './shifts.service'

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  findAll() {
    return this.shiftsService.findAll()
  }

  @Post()
  create(@Body() body: CreateShiftDto) {
    return this.shiftsService.create(body)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { active?: boolean }) {
    return this.shiftsService.update(id, body)
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.shiftsService.delete(id)
  }
}
