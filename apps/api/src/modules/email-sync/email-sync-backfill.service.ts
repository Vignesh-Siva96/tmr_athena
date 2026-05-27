import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { AppConfigService } from '../config/config.service'
import { AppEventsService } from '../../common/events/app-events.service'
import { ProviderFactory } from './providers/provider-factory'
import { ThreadIngestionService } from './thread-ingestion.service'
import { GmailProvider } from './providers/gmail.provider'
import type { IMailProvider } from './providers/mail-provider.interface'
import { PrismaService } from '../database/prisma.service'

const BATCH_SIZE = 5
const BATCH_DELAY_MS = 2000

@Injectable()
export class EmailSyncBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailSyncBackfillService.name)
  private backgroundRunning = false
  private sseService: { broadcast(event: Record<string, unknown>): void } | null = null

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly appEvents: AppEventsService,
    private readonly providerFactory: ProviderFactory,
    private readonly ingestion: ThreadIngestionService,
    private readonly db: PrismaService,
  ) {
    // Listen for OAuth connect events to trigger foreground backfill
    this.appEvents.onOAuthConnected((cfgId: string) => {
      this.logger.log(`OAuth connected for cfg=${cfgId} — starting foreground backfill`)
      void this.startForeground(cfgId)
    })
  }

  /** Called by EventsModule after initialization to wire SSE without circular dep */
  setSseService(sse: { broadcast(event: Record<string, unknown>): void }): void {
    this.sseService = sse
  }

  async onApplicationBootstrap(): Promise<void> {
    // Auto-resume any archive that was RUNNING when the server last died
    // (CANCELLED is intentional — don't auto-resume those)
    const cfg = await this.appConfig.resumingArchive()
    if (cfg) {
      this.logger.log(`Resuming archive from pageToken=${cfg.archivePageToken ?? 'start'}`)
      void this.runBackgroundArchive(cfg.id)
    }
  }

  /** Called from OAuth callback after tokens are stored */
  async startForeground(cfgId: string): Promise<void> {
    const cfg = await this.db.appConfig.findUnique({ where: { id: cfgId } })
    if (!cfg) return

    const provider = this.providerFactory.for(cfg)

    // Fetch aliases and persist
    if (provider instanceof GmailProvider) {
      const aliases = await provider.fetchAliases()
      await this.db.appConfig.update({
        where: { id: cfgId },
        data: { oauthAliases: aliases },
      })
      provider.aliases.splice(0, provider.aliases.length, ...aliases)
    }

    // Try to get the real total thread count upfront for accurate X/Y display
    let totalEstimate: number | null = null
    if (provider instanceof GmailProvider) {
      totalEstimate = await provider.fetchTotalThreadCount()
    }

    await this.db.appConfig.update({
      where: { id: cfgId },
      data: {
        archiveStatus: 'RUNNING',
        archiveTotalSeen: 0,
        archivePageToken: null,
        archiveTotalEstimate: totalEstimate,
      },
    })

    // Capture historyId NOW (before processing) so the live poller catches any
    // emails that arrive during the archive once it finishes
    await this.setInitialCheckpoint(provider, cfgId)

    this.logger.log(`Starting full archive${totalEstimate ? ` (~${totalEstimate} threads)` : ''}`)

    // Run full archive immediately — no foreground cap
    void this.runBackgroundArchive(cfgId)
  }

  private async setInitialCheckpoint(provider: IMailProvider, cfgId: string): Promise<void> {
    if (!(provider instanceof GmailProvider)) return
    try {
      const historyId = await provider.fetchCurrentHistoryId()
      if (historyId) {
        await this.db.appConfig.update({ where: { id: cfgId }, data: { gmailHistoryId: historyId } })
      }
    } catch (err) {
      this.logger.warn(`Could not fetch initial historyId: ${String(err)}`)
    }
  }

  private async runBackgroundArchive(cfgId: string): Promise<void> {
    if (this.backgroundRunning) return
    this.backgroundRunning = true

    try {
      let cfg = await this.db.appConfig.findUnique({ where: { id: cfgId } })
      if (!cfg) return

      const provider = this.providerFactory.for(cfg)
      let pageToken: string | undefined = cfg.archivePageToken ?? undefined
      let totalSeen = cfg.archiveTotalSeen ?? 0
      const totalEstimate = (cfg as unknown as Record<string, unknown>).archiveTotalEstimate as number | null ?? null

      while (true) {
        // Re-read cfg to check for cancellation
        cfg = await this.db.appConfig.findUnique({ where: { id: cfgId } })
        if (!cfg || cfg.archiveStatus === 'CANCELLED' || cfg.archiveStatus === 'IDLE') {
          this.logger.log('Background archive stopped (cancelled or reset)')
          break
        }

        const result = await provider.listAllThreadIds(pageToken)

        if (result.threadIds.length === 0) {
          await this.db.appConfig.update({
            where: { id: cfgId },
            data: { archiveStatus: 'DONE', archivePageToken: null, archiveTotalSeen: totalSeen },
          })
          await this.setInitialCheckpoint(provider, cfgId)
          this.logger.log(`Archive complete. Total: ${totalSeen}`)
          this.sseService?.broadcast({ type: 'archive-progress', processed: totalSeen, total: totalEstimate ?? undefined, status: 'DONE' })
          break
        }

        await this.processBatch(provider, result.threadIds, cfgId, { isBackfill: true }, async (chunkSize) => {
          totalSeen += chunkSize
          await this.db.appConfig.update({
            where: { id: cfgId },
            data: { archiveTotalSeen: totalSeen },
          })
          this.sseService?.broadcast({ type: 'archive-progress', processed: totalSeen, total: totalEstimate ?? undefined, status: 'RUNNING' })
        })
        pageToken = result.nextPageToken

        await this.db.appConfig.update({
          where: { id: cfgId },
          data: {
            archivePageToken: pageToken ?? null,
            archiveTotalSeen: totalSeen,
            archiveStatus: 'RUNNING',
          },
        })

        if (!pageToken) {
          await this.db.appConfig.update({
            where: { id: cfgId },
            data: { archiveStatus: 'DONE', archivePageToken: null },
          })
          await this.setInitialCheckpoint(provider, cfgId)
          this.logger.log(`Archive complete. Total: ${totalSeen}`)
          this.sseService?.broadcast({ type: 'archive-progress', processed: totalSeen, total: totalEstimate ?? undefined, status: 'DONE' })
          break
        }

        await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
      }
    } catch (err) {
      this.logger.error(`Archive failed: ${String(err)}`)
      await this.db.appConfig.update({
        where: { id: cfgId },
        data: { archiveStatus: 'FAILED' },
      }).catch(() => {})
    } finally {
      this.backgroundRunning = false
    }
  }

  private async processBatch(
    provider: IMailProvider,
    threadIds: string[],
    _cfgId: string,
    opts: { isBackfill: boolean },
    onChunk?: (processed: number) => Promise<void> | void,
  ): Promise<void> {
    for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
      const batch = threadIds.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(id => this.ingestion.fetchAndUpsertThread(provider, id, opts)))
      if (onChunk) await onChunk(batch.length)
      if (i + BATCH_SIZE < threadIds.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
      }
    }
  }

  async cancelArchive(cfgId: string): Promise<void> {
    await this.db.appConfig.update({ where: { id: cfgId }, data: { archiveStatus: 'CANCELLED' } })
  }

  async resumeArchive(cfgId: string): Promise<void> {
    // Restore RUNNING status without resetting pageToken or totalSeen — picks up where it left off
    await this.db.appConfig.update({ where: { id: cfgId }, data: { archiveStatus: 'RUNNING' } })
    void this.runBackgroundArchive(cfgId)
  }

  async resync(cfgId: string): Promise<void> {
    await this.db.appConfig.update({
      where: { id: cfgId },
      data: { archiveStatus: 'IDLE', archivePageToken: null, archiveTotalSeen: 0, gmailHistoryId: null, graphDeltaLink: null },
    })
    await this.startForeground(cfgId)
  }
}
