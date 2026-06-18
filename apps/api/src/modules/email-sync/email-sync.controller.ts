import { Controller, Post, Get, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { EmailSyncBackfillService } from './email-sync-backfill.service'
import { LivePollerService } from './live-poller.service'
import { AppConfigService } from '../config/config.service'
import { PrismaService } from '../database/prisma.service'

@Controller('sync')
@UseGuards(AuthGuard, AgentGuard)
export class EmailSyncController {
  constructor(
    private readonly backfill: EmailSyncBackfillService,
    private readonly poller: LivePollerService,
    private readonly appConfig: AppConfigService,
    private readonly db: PrismaService,
  ) {}

  @Post('backfill/run')
  async runBackfill() {
    const cfg = await this.appConfig.get()
    void this.backfill.startForeground(cfg.id)
    return { started: true }
  }

  @Get('status')
  async getStatus() {
    const cfg = await this.appConfig.getSafe()
    const c = cfg as unknown as Record<string, unknown>
    return {
      archiveStatus: c.archiveStatus ?? 'IDLE',
      archiveTotalSeen: c.archiveTotalSeen ?? null,
      archiveTotalEstimate: c.archiveTotalEstimate ?? null,
      archivePageToken: c.archivePageToken ?? null,
    }
  }

  @Post('archive/cancel')
  async cancelArchive() {
    const cfg = await this.appConfig.get()
    await this.backfill.cancelArchive(cfg.id)
    return { cancelled: true }
  }

  @Post('archive/resume')
  async resumeArchive() {
    const cfg = await this.appConfig.get()
    await this.backfill.resumeArchive(cfg.id)
    return { resumed: true }
  }

  @Post('resync')
  async resync() {
    const cfg = await this.appConfig.get()
    void this.backfill.resync(cfg.id)
    return { started: true }
  }

  @Post('poll/now')
  async pollNow() {
    const cfgs = await this.appConfig.findActiveOauth()
    for (const cfg of cfgs) {
      await this.poller.pollOne(cfg)
    }
    return { polled: cfgs.length }
  }

  /** Returns the count of email:ingest-thread jobs in the pg-boss failed state. */
  @Get('health')
  async health() {
    try {
      const rows = await this.db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count
        FROM pgboss.job
        WHERE name = 'email:ingest-thread'
          AND state = 'failed'
      `
      return { failedIngestJobs: Number(rows[0]?.count ?? 0) }
    } catch {
      return { failedIngestJobs: 0 }
    }
  }
}
