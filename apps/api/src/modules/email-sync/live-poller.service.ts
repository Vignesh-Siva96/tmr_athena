import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { AppConfigService } from '../config/config.service'
import { ProviderFactory } from './providers/provider-factory'
import { ThreadIngestionService } from './thread-ingestion.service'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '@tmr/db'

@Injectable()
export class LivePollerService {
  private readonly logger = new Logger(LivePollerService.name)
  private readonly enabled: boolean

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly providerFactory: ProviderFactory,
    private readonly ingestion: ThreadIngestionService,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get<string>('EMAIL_SYNC_LIVE_POLL') === '1'
  }

  @Cron('*/30 * * * * *')
  async pollAll(): Promise<void> {
    if (!this.enabled) return

    let cfgs: AppConfig[]
    try {
      cfgs = await this.appConfig.findActiveOauth()
    } catch (err) {
      this.logger.error(`Failed to load configs for polling: ${String(err)}`)
      return
    }

    for (const cfg of cfgs) {
      const archiveStatus = (cfg as unknown as { archiveStatus?: string }).archiveStatus
      if (archiveStatus === 'RUNNING') continue
      try {
        await this.pollOne(cfg)
      } catch (err) {
        this.logger.warn(`Poll failed for config ${cfg.id}: ${String(err)}`)
      }
    }
  }

  async pollOne(cfg: AppConfig): Promise<void> {
    const provider = this.providerFactory.for(cfg)
    const checkpoint = (cfg as unknown as { gmailHistoryId?: string; graphDeltaLink?: string }).gmailHistoryId
      ?? (cfg as unknown as { graphDeltaLink?: string }).graphDeltaLink

    if (!checkpoint) {
      this.logger.warn(`No checkpoint for ${cfg.id}, skipping poll`)
      return
    }

    this.logger.log(`Polling from checkpoint=${checkpoint}`)

    let delta
    try {
      delta = await provider.pollChanges(checkpoint)
    } catch (err) {
      if (provider.isStaleCheckpointError(err)) {
        this.logger.warn(`Stale checkpoint for ${cfg.id} — falling back to last-7d re-list`)
        delta = await provider.recoverFromStaleCheckpoint({ sinceDays: 7 })
      } else {
        throw err
      }
    }

    const uniqueThreadIds = [...new Set(delta.changedThreadIds)]
    this.logger.log(`Poll result: ${uniqueThreadIds.length} changed threads, newCheckpoint=${delta.newCheckpoint}`)

    for (const threadId of uniqueThreadIds) {
      this.logger.log(`Processing thread ${threadId}`)
      try {
        await this.ingestion.fetchAndUpsertThread(provider, threadId, { isBackfill: false })
      } catch (err) {
        // Log and continue — a single bad thread must not block the checkpoint update
        this.logger.warn(`Failed to ingest thread ${threadId}: ${String(err)}`)
      }
    }

    // Always persist checkpoint so we don't retry the same threads on every poll
    await this.appConfig.setCheckpoint(
      cfg.id,
      delta.newCheckpoint,
      cfg.oauthProvider === 'GOOGLE' ? 'GMAIL' : 'GRAPH',
    )
  }
}
