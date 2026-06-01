import { Module } from '@nestjs/common'
import { ShiftsController } from './shifts.controller'
import { ShiftsService } from './shifts.service'
import { DatabaseModule } from '../database/database.module'

@Module({
  imports: [DatabaseModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
