import { Controller, Get, UseGuards } from '@nestjs/common'
import { CustomersService } from './customers.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'

@Controller('analytics/customers')
@UseGuards(AuthGuard, AgentGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  getCustomerInsights() {
    return this.customersService.getCustomerInsights()
  }
}
