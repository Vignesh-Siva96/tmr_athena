// Deprecated — replaced by ConfigController (single-tenant)
import { Controller } from '@nestjs/common'
import { OrgsService } from './orgs.service'

@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}
}
