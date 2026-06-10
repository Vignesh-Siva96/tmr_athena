import { Module } from '@nestjs/common'
import { TicketsController } from './tickets.controller'
import { TicketsService } from './tickets.service'
import { NoGuestsGuard } from '../../common/guards/no-guests.guard'

@Module({
  imports: [],
  controllers: [TicketsController],
  providers: [TicketsService, NoGuestsGuard],
  exports: [TicketsService],
})
export class TicketsModule {}
