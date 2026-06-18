import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { AppConfigService } from '../config/config.service'
import { ProviderFactory } from './providers/provider-factory'
import { QueueService } from '../queue/queue.service'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '@tmr/db'

@Injectable()
export class LivePollerService {
  private readonly logger = new Logger(LivePollerService.name)
  private readonly enabled: boolean

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly providerFactory: ProviderFactory,
    private readonly queue: QueueService,
    private readonly config: ConfigService,
  ) {
    // Default-on: absent or any value other than '0' enables polling
    this.enabled = this.config.get<string>('EMAIL_SYNC_LIVE_POLL') !== '0'
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

    if (cfgs.length > 0 && !this.enabled) {
      this.logger.warn('Inbox is connected but EMAIL_SYNC_LIVE_POLL=0 — live sync is disabled. Set EMAIL_SYNC_LIVE_POLL to any value other than "0" to enable.')
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

  /**
   * Thin dispatcher: fetches changed thread IDs from the provider, enqueues one
   * `email:ingest-thread` job per thread (durable in Postgres), then advances the
   * checkpoint. Order matters — enqueue before advancing so a crash never loses a
   * thread. Per-thread retry + dead-lettering is handled by the IngestThreadWorker.
   */
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

    // Enqueue all threads as durable jobs BEFORE advancing the checkpoint.
    // If the process crashes after enqueueing but before the checkpoint write,
    // the same threads will be re-found on the next poll and deduplicated via singletonKey.
    for (const threadId of uniqueThreadIds) {
      await this.queue.enqueueIngestThread({ cfgId: cfg.id, threadId })
    }

    await this.appConfig.setCheckpoint(
      cfg.id,
      delta.newCheckpoint,
      cfg.oauthProvider === 'GOOGLE' ? 'GMAIL' : 'GRAPH',
    )
  }
}
