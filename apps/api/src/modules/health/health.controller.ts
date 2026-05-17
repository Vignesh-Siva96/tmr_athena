import { Controller, Get } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; db: string; timestamp: string }> {
    try {
      await this.db.$queryRaw`SELECT 1`
      return { status: 'ok', db: 'ok', timestamp: new Date().toISOString() }
    } catch {
      return { status: 'ok', db: 'unavailable', timestamp: new Date().toISOString() }
    }
  }
}
