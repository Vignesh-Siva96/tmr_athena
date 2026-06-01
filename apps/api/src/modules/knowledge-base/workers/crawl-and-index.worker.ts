import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QueueService, KbCrawlJobData, KbIndexPageJobData, KbScanJobData } from '../../queue/queue.service'
import {
  KB_CRAWL_QUEUE,
  KB_INDEX_PAGE_QUEUE,
  KB_SCAN_QUEUE,
  KB_EMBED_QUEUE,
} from '../../queue/queue.module'
import { PrismaService } from '../../database/prisma.service'
import { CrawlerService } from '../crawler.service'
import { IndexerService } from '../indexer.service'
import { Decimal } from '@prisma/client/runtime/library'

@Injectable()
export class CrawlAndIndexWorker implements OnModuleInit {
  private readonly logger = new Logger(CrawlAndIndexWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly db: PrismaService,
    private readonly crawler: CrawlerService,
    private readonly indexer: IndexerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.ready()
    this.registerCrawlWorker()
    this.registerIndexPageWorker()
    this.registerScanWorker()
    this.registerEmbedWorker()
  }

  // ─── Legacy crawl + embed in one pass ────────────────────────────────────────

  private registerCrawlWorker(): void {
    this.queue.getBoss().work<KbCrawlJobData>(KB_CRAWL_QUEUE, async (job) => {
      const { rootUrl, mode } = job.data
      this.logger.log(`KB_CRAWL_QUEUE: start crawl of ${rootUrl} (mode=${mode ?? 'full'})`)

      const cfg = await this.getAppConfig()

      try {
        let seen = 0
        let indexed = 0
        let cancelled = false

        await this.crawler.crawl(rootUrl, {
          mode,
          onPage: async (page) => {
            const currentCfg = await this.db.appConfig.findUnique({ where: { id: cfg.id } })
            if (currentCfg?.kbCrawlStatus === 'CANCELLED') {
              cancelled = true
              this.logger.log(`KB_CRAWL_QUEUE: crawl cancelled after ${indexed} pages`)
              return
            }
            if (cancelled) return

            seen++
            await this.db.appConfig.update({
              where: { id: cfg.id },
              data: { kbCrawlPagesSeen: seen },
            })

            try {
              await this.indexer.indexPage(page.url)
              indexed++
              await this.db.appConfig.update({
                where: { id: cfg.id },
                data: { kbCrawlPagesIndexed: indexed },
              })
            } catch (pageErr) {
              this.logger.warn(`KB_CRAWL_QUEUE: failed to index ${page.url}: ${String(pageErr)}`)
            }
          },
        })

        if (cancelled) return

        await this.db.appConfig.update({
          where: { id: cfg.id },
          data: {
            kbCrawlStatus: 'DONE',
            kbCrawlFinishedAt: new Date(),
            kbLastRecrawledAt: new Date(),
            kbCrawlPagesIndexed: indexed,
          },
        })

        this.logger.log(`KB_CRAWL_QUEUE: crawl complete — ${indexed}/${seen} pages indexed`)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        this.logger.error(`KB_CRAWL_QUEUE: crawl failed: ${errorMessage}`)

        await this.db.appConfig
          .update({
            where: { id: cfg.id },
            data: {
              kbCrawlStatus: 'FAILED',
              kbCrawlFinishedAt: new Date(),
              kbCrawlError: errorMessage,
            },
          })
          .catch(() => {})

        throw err
      }
    })
  }

  private registerIndexPageWorker(): void {
    this.queue.getBoss().work<KbIndexPageJobData>(KB_INDEX_PAGE_QUEUE, async (job) => {
      const { sourceId } = job.data
      this.logger.log(`KB_INDEX_PAGE_QUEUE: reindex source ${sourceId}`)

      const source = await this.db.knowledgeSource.findUnique({ where: { id: sourceId } })
      if (!source) {
        this.logger.warn(`KB_INDEX_PAGE_QUEUE: source ${sourceId} not found — skipping`)
        return
      }

      await this.indexer.indexPage(source.url)
      this.logger.log(`KB_INDEX_PAGE_QUEUE: reindex complete for ${source.url}`)
    })
  }

  // ─── Phase A: Scan (no embedding) ─────────────────────────────────────────────

  private registerScanWorker(): void {
    this.queue.getBoss().work<KbScanJobData>(KB_SCAN_QUEUE, async (job) => {
      const { rootUrl } = job.data
      this.logger.log(`KB_SCAN_QUEUE: start scan of ${rootUrl}`)

      const cfg = await this.getAppConfig()

      try {
        let pagesSeen = 0
        let totalChunks = 0
        let cancelled = false

        await this.crawler.crawl(rootUrl, {
          onPage: async (page) => {
            const currentCfg = await this.db.appConfig.findUnique({ where: { id: cfg.id } })
            if (currentCfg?.kbPhase === 'CANCELLED') {
              cancelled = true
              this.logger.log(`KB_SCAN_QUEUE: scan cancelled after ${pagesSeen} pages`)
              return
            }
            if (cancelled) return

            pagesSeen++
            await this.db.appConfig.update({
              where: { id: cfg.id },
              data: { kbScanPagesSeen: pagesSeen },
            })

            try {
              const chunkCount = await this.indexer.scanPage(page.url)
              totalChunks += chunkCount
            } catch (pageErr) {
              this.logger.warn(`KB_SCAN_QUEUE: failed to scan ${page.url}: ${String(pageErr)}`)
            }
          },
        })

        if (cancelled) return

        // Compute cost estimate from pending SCANNED chunks
        const { chunkCount, tokenEstimate, costUsd } = await this.indexer.estimatePendingCost()

        await this.db.appConfig.update({
          where: { id: cfg.id },
          data: {
            kbPhase: 'AWAITING_CONFIRM',
            kbScanPagesSeen: pagesSeen,
            kbScanChunkCount: chunkCount,
            kbScanTokenEstimate: tokenEstimate,
            kbScanCostUsd: new Decimal(costUsd.toFixed(6)),
          },
        })

        this.logger.log(
          `KB_SCAN_QUEUE: scan complete — ${pagesSeen} pages, ${chunkCount} chunks, est $${costUsd.toFixed(4)}`,
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        this.logger.error(`KB_SCAN_QUEUE: scan failed: ${errorMessage}`)

        await this.db.appConfig
          .update({
            where: { id: cfg.id },
            data: { kbPhase: 'FAILED', kbError: errorMessage },
          })
          .catch(() => {})

        throw err
      }
    })
  }

  // ─── Phase B: Embed ────────────────────────────────────────────────────────────

  private registerEmbedWorker(): void {
    this.queue.getBoss().work(KB_EMBED_QUEUE, async () => {
      this.logger.log(`KB_EMBED_QUEUE: start embedding`)

      const cfg = await this.getAppConfig()

      try {
        const scannedSources = await this.db.knowledgeSource.findMany({
          where: { status: 'SCANNED' },
          select: { id: true },
        })

        if (scannedSources.length === 0) {
          await this.db.appConfig.update({
            where: { id: cfg.id },
            data: { kbPhase: 'DONE' },
          })
          return
        }

        let chunksDone = 0

        for (const source of scannedSources) {
          const currentCfg = await this.db.appConfig.findUnique({ where: { id: cfg.id } })
          if (currentCfg?.kbPhase === 'CANCELLED') {
            this.logger.log(`KB_EMBED_QUEUE: embed cancelled after ${chunksDone} chunks`)
            return
          }

          await this.indexer.embedSource(source.id, async () => {
            chunksDone++
            await this.db.appConfig.update({
              where: { id: cfg.id },
              data: { kbEmbedChunksDone: chunksDone },
            })
          })
        }

        await this.db.appConfig.update({
          where: { id: cfg.id },
          data: {
            kbPhase: 'DONE',
            kbLastRecrawledAt: new Date(),
            kbEmbedChunksDone: chunksDone,
          },
        })

        this.logger.log(`KB_EMBED_QUEUE: embed complete — ${chunksDone} chunks embedded`)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        this.logger.error(`KB_EMBED_QUEUE: embed failed: ${errorMessage}`)

        await this.db.appConfig
          .update({
            where: { id: cfg.id },
            data: { kbPhase: 'FAILED', kbError: errorMessage },
          })
          .catch(() => {})

        throw err
      }
    })
  }

  private async getAppConfig() {
    const cfg = await this.db.appConfig.findFirst()
    if (!cfg) {
      return this.db.appConfig.create({
        data: {
          appName: 'Support',
          primaryColor: '#2563EB',
          accentColor: '#0EA5E9',
          emailDisplayName: 'Support',
        },
      })
    }
    return cfg
  }
}
