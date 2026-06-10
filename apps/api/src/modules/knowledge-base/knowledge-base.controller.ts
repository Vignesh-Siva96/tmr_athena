import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
  Logger,
} from '@nestjs/common'
import { QueueService, KbCrawlJobData, KbIndexPageJobData } from '../queue/queue.service'
import { PrismaService } from '../database/prisma.service'
import { IndexerService } from './indexer.service'
import { Decimal } from '@prisma/client/runtime/library'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { AdminGuard } from '../../common/guards/admin.guard'

interface StartCrawlDto {
  mode?: 'full' | 'incremental'
}

interface ManualIndexDto {
  url: string
}

interface ListSourcesQuery {
  status?: string
  search?: string
  limit?: string
  offset?: string
}

@Controller('kb')
@UseGuards(AuthGuard, AgentGuard)
export class KnowledgeBaseController {
  private readonly logger = new Logger(KnowledgeBaseController.name)

  constructor(
    private readonly queue: QueueService,
    private readonly db: PrismaService,
    private readonly indexer: IndexerService,
  ) {}

  // ─── Legacy crawl (fused scan+embed) ────────────────────────────────────────

  /** POST /kb/crawl/start — enqueue a full or incremental crawl */
  @Post('crawl/start')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async startCrawl(@Body() body: StartCrawlDto) {
    const appConfig = await this.getAppConfig()
    if (!appConfig.kbRootUrl) {
      return { ok: false, error: 'kbRootUrl is not configured in AppConfig' }
    }

    await this.db.appConfig.update({
      where: { id: appConfig.id },
      data: {
        kbCrawlStatus: 'RUNNING',
        kbCrawlStartedAt: new Date(),
        kbCrawlFinishedAt: null,
        kbCrawlPagesSeen: 0,
        kbCrawlPagesIndexed: 0,
        kbCrawlError: null,
      },
    })

    const jobData: KbCrawlJobData = {
      rootUrl: appConfig.kbRootUrl,
      mode: body.mode,
    }
    await this.queue.enqueueKbCrawl(jobData)

    return { ok: true, mode: body.mode ?? 'full', rootUrl: appConfig.kbRootUrl }
  }

  /** POST /kb/crawl/cancel — cancel the running crawl */
  @Post('crawl/cancel')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async cancelCrawl() {
    const appConfig = await this.getAppConfig()
    await this.db.appConfig.update({
      where: { id: appConfig.id },
      data: { kbCrawlStatus: 'CANCELLED' },
    })
    return { ok: true }
  }

  // ─── Two-phase scan → confirm → embed ────────────────────────────────────────

  /** POST /kb/scan/start — Phase A: crawl and chunk without embedding */
  @Post('scan/start')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async startScan() {
    const appConfig = await this.getAppConfig()
    if (!appConfig.kbRootUrl) {
      return { ok: false, error: 'kbRootUrl is not configured in AppConfig' }
    }

    await this.db.appConfig.update({
      where: { id: appConfig.id },
      data: {
        kbPhase: 'SCANNING',
        kbScanPagesSeen: 0,
        kbScanChunkCount: 0,
        kbScanTokenEstimate: 0,
        kbScanCostUsd: null,
        kbEmbedChunksDone: 0,
        kbEmbedChunksTotal: 0,
        kbError: null,
      },
    })

    await this.queue.enqueueKbScan({ rootUrl: appConfig.kbRootUrl })
    return { ok: true, rootUrl: appConfig.kbRootUrl }
  }

  /** POST /kb/scan/cancel — discard SCANNED sources and reset to IDLE */
  @Post('scan/cancel')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async cancelScan() {
    const appConfig = await this.getAppConfig()

    // Discard sources that were only scanned (not yet embedded)
    await this.db.knowledgeSource.deleteMany({ where: { status: 'SCANNED' } })

    await this.db.appConfig.update({
      where: { id: appConfig.id },
      data: {
        kbPhase: 'CANCELLED',
        kbScanPagesSeen: 0,
        kbScanChunkCount: 0,
        kbScanTokenEstimate: 0,
        kbScanCostUsd: null,
      },
    })

    return { ok: true }
  }

  /** POST /kb/embed/confirm — Phase B: embed all pending SCANNED chunks */
  @Post('embed/confirm')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async confirmEmbed() {
    const appConfig = await this.getAppConfig()

    const pendingChunks = await this.db.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM "KnowledgeChunk" kc
      JOIN "KnowledgeSource" ks ON kc."sourceId" = ks.id
      WHERE ks.status = 'SCANNED' AND kc.embedding IS NULL
    `
    const total = Number(pendingChunks[0]?.total ?? 0)

    await this.db.appConfig.update({
      where: { id: appConfig.id },
      data: {
        kbPhase: 'EMBEDDING',
        kbEmbedChunksTotal: total,
        kbEmbedChunksDone: 0,
      },
    })

    await this.queue.enqueueKbEmbed()
    return { ok: true, totalChunks: total }
  }

  /** GET /kb/status — return combined scan + embed phase state */
  @Get('status')
  async getStatus() {
    const cfg = await this.getAppConfig()
    return {
      // Legacy crawl fields (still used by old crawl path)
      kbCrawlStatus: cfg.kbCrawlStatus,
      kbCrawlStartedAt: cfg.kbCrawlStartedAt,
      kbCrawlFinishedAt: cfg.kbCrawlFinishedAt,
      kbCrawlPagesSeen: cfg.kbCrawlPagesSeen,
      kbCrawlPagesIndexed: cfg.kbCrawlPagesIndexed,
      kbCrawlError: cfg.kbCrawlError,
      kbLastRecrawledAt: cfg.kbLastRecrawledAt,
      // Two-phase fields
      kbPhase: cfg.kbPhase,
      kbScanPagesSeen: cfg.kbScanPagesSeen,
      kbScanChunkCount: cfg.kbScanChunkCount,
      kbScanTokenEstimate: cfg.kbScanTokenEstimate,
      kbScanCostUsd: cfg.kbScanCostUsd,
      kbEmbedChunksDone: cfg.kbEmbedChunksDone,
      kbEmbedChunksTotal: cfg.kbEmbedChunksTotal,
      kbError: cfg.kbError,
    }
  }

  // ─── Sources management ───────────────────────────────────────────────────────

  /** GET /kb/sources — paginated list of knowledge sources */
  @Get('sources')
  async listSources(@Query() query: ListSourcesQuery) {
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200)
    const offset = parseInt(query.offset ?? '0', 10)

    const where: Record<string, unknown> = {}
    if (query.status) {
      where['status'] = query.status
    }
    if (query.search) {
      where['OR'] = [
        { url: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
      ]
    }

    const [total, items] = await Promise.all([
      this.db.knowledgeSource.count({ where }),
      this.db.knowledgeSource.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { _count: { select: { chunks: true } } },
      }),
    ])

    return {
      total,
      limit,
      offset,
      items: items.map((s) => ({
        ...s,
        chunkCount: s._count.chunks,
        _count: undefined,
      })),
    }
  }

  /** POST /kb/sources/manual — scan a single URL into the pending SCANNED set */
  @Post('sources/manual')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async manualIndex(@Body() body: ManualIndexDto) {
    if (!body.url) {
      return { ok: false, error: 'url is required' }
    }

    // Run scan in background and update the cost estimate when done
    this.runManualScan(body.url).catch((err: unknown) => {
      this.logger.error(`manualIndex scan failed for ${body.url}: ${String(err)}`)
    })

    return { ok: true, url: body.url }
  }

  private async runManualScan(url: string): Promise<void> {
    await this.indexer.scanPage(url)

    // Refresh cost estimate in AppConfig
    const cfg = await this.getAppConfig()
    const { chunkCount, tokenEstimate, costUsd } = await this.indexer.estimatePendingCost()

    // Only update if we're in a state where it's relevant
    if (cfg.kbPhase === 'IDLE' || cfg.kbPhase === 'AWAITING_CONFIRM' || cfg.kbPhase === 'DONE') {
      await this.db.appConfig.update({
        where: { id: cfg.id },
        data: {
          kbPhase: 'AWAITING_CONFIRM',
          kbScanChunkCount: chunkCount,
          kbScanTokenEstimate: tokenEstimate,
          kbScanCostUsd: new Decimal(costUsd.toFixed(6)),
        },
      })
    }
  }

  /** POST /kb/sources/:id/reindex — enqueue reindex of a single source */
  @Post('sources/:id/reindex')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async reindexSource(@Param('id') id: string) {
    const source = await this.db.knowledgeSource.findUnique({ where: { id } })
    if (!source) throw new NotFoundException(`KnowledgeSource ${id} not found`)

    const jobData: KbIndexPageJobData = { sourceId: id }
    await this.queue.enqueueKbIndexPage(jobData)

    return { ok: true, sourceId: id }
  }

  /** DELETE /kb/sources/:id — delete a single source (cascades to chunks) */
  @Delete('sources/:id')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async deleteSource(@Param('id') id: string) {
    const source = await this.db.knowledgeSource.findUnique({ where: { id } })
    if (!source) throw new NotFoundException(`KnowledgeSource ${id} not found`)

    await this.db.knowledgeSource.delete({ where: { id } })
    return { ok: true, deleted: id }
  }

  /** DELETE /kb/index — wipe the entire knowledge base index */
  @Delete('index')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async wipeIndex() {
    const { count: chunksDeleted } = await this.db.knowledgeChunk.deleteMany({})
    const { count: sourcesDeleted } = await this.db.knowledgeSource.deleteMany({})

    const cfg = await this.getAppConfig()
    await this.db.appConfig.update({
      where: { id: cfg.id },
      data: {
        kbCrawlStatus: 'IDLE',
        kbCrawlStartedAt: null,
        kbCrawlFinishedAt: null,
        kbCrawlPagesSeen: 0,
        kbCrawlPagesIndexed: 0,
        kbCrawlError: null,
        kbLastRecrawledAt: null,
        kbPhase: 'IDLE',
        kbScanPagesSeen: 0,
        kbScanChunkCount: 0,
        kbScanTokenEstimate: 0,
        kbScanCostUsd: null,
        kbEmbedChunksDone: 0,
        kbEmbedChunksTotal: 0,
        kbError: null,
      },
    })

    return { ok: true, chunksDeleted, sourcesDeleted }
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
