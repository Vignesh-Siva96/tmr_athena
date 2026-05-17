import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name)

  constructor(private readonly config: ConfigService) {}
}
