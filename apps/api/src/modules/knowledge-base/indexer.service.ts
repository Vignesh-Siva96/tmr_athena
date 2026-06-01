import { Injectable, Logger } from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../database/prisma.service'
import { CrawlerService } from './crawler.service'
import { ChunkerService } from './chunker.service'
import { ContextBuilderService } from './context-builder.service'
import { EmbeddingService } from './embedding.service'
import { TaskType } from '@google/generative-ai'
import { EMBED_PRICE_PER_MILLION } from '../ai/embedding.constants'

// gemini-2.0-flash pricing used by ContextBuilderService
const SUMMARY_INPUT_PER_MILLION = 0.075
const SUMMARY_OUTPUT_PER_MILLION = 0.30
// Estimated input tokens per page summary call (title + 2000-char body truncation ≈ 600 tokens)
const SUMMARY_INPUT_TOKENS_PER_PAGE = 600
// Max output for a 50-token summary
const SUMMARY_OUTPUT_TOKENS_PER_PAGE = 50
// Extra tokens prepended to each chunk text after context header is added
const CONTEXT_HEADER_TOKENS_PER_CHUNK = 50

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name)

  constructor(
    private readonly db: PrismaService,
    private readonly crawler: CrawlerService,
    private readonly chunker: ChunkerService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Phase A: fetch → chunk → persist with embedding=NULL.
   * No Gemini calls — no cost incurred. Context header is deferred to embedSource (Phase B).
   * Returns chunk count for the source (0 if skipped/failed).
   */
  async scanPage(url: string): Promise<number> {
    this.logger.log(`scanPage: start ${url}`)

    const source = await this.db.knowledgeSource.upsert({
      where: { url },
      create: { url, status: 'PENDING' },
      update: { status: 'PENDING', errorMessage: null },
    })

    const page = await this.crawler.fetchPage(url)
    if (!page) {
      this.logger.warn(`scanPage: fetchPage returned null for ${url} — marking SKIPPED`)
      await this.db.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'SKIPPED' },
      })
      return 0
    }

    const contentHash = createHash('sha256').update(page.html).digest('hex')

    // Skip if already indexed and content unchanged — no need to re-scan
    if (source.contentHash === contentHash && source.status === 'INDEXED') {
      this.logger.log(`scanPage: ${url} unchanged — skipping`)
      return 0
    }

    await this.db.knowledgeSource.update({
      where: { id: source.id },
      data: { title: page.title, contentHash, status: 'FETCHED', fetchedAt: new Date() },
    })

    const chunks = this.chunker.chunk(page.html, url)
    if (chunks.length === 0) {
      this.logger.warn(`scanPage: no chunks for ${url} — marking SKIPPED`)
      await this.db.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'SKIPPED' },
      })
      return 0
    }

    // Persist chunks with embedding=NULL (SCANNED state).
    // Context header generation is deferred to embedSource so scanPage makes no Gemini calls.
    await this.db.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { sourceId: source.id } })

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]

        await tx.$executeRawUnsafe(
          `INSERT INTO "KnowledgeChunk" (id, "createdAt", "sourceId", ordinal, text, "contextHeader", "headingPath", anchor, "deepUrl", "tokenCount")
           VALUES (gen_random_uuid()::text, NOW(), $1, $2, $3, $4, $5::text[], $6, $7, $8)`,
          source.id,
          c.ordinal,
          c.text,
          null, // contextHeader populated in Phase B
          c.headingPath,
          c.anchor,
          c.deepUrl,
          c.tokenCount,
        )
      }

      await tx.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'SCANNED' },
      })
    })

    this.logger.log(`scanPage: scanned ${url} — ${chunks.length} chunks`)
    return chunks.length
  }

  /**
   * Phase B: build context header, prepend to each chunk, embed, then mark INDEXED.
   * One Gemini summary call per source (context header) + embedding calls per chunk batch.
   * Called by the embed worker which iterates all SCANNED sources.
   */
  async embedSource(sourceId: string, onChunkDone?: () => void): Promise<void> {
    const source = await this.db.knowledgeSource.findUnique({
      where: { id: sourceId },
      select: { id: true, url: true, title: true },
    })

    const rawChunks = await this.db.$queryRawUnsafe<
      { id: string; text: string }[]
    >(
      `SELECT id, text FROM "KnowledgeChunk" WHERE "sourceId" = $1 AND embedding IS NULL`,
      sourceId,
    )

    if (rawChunks.length === 0) {
      await this.db.knowledgeSource.update({
        where: { id: sourceId },
        data: { status: 'INDEXED', indexedAt: new Date() },
      })
      return
    }

    // Build context header once per source (one Gemini flash call) using first chunk as body
    let contextHeader = ''
    if (source) {
      const bodyForContext = rawChunks.map((c) => c.text).join('\n\n')
      contextHeader = await this.contextBuilder.buildContextHeader(source.title, bodyForContext)
    }

    // Prepend context header to each chunk text before embedding
    const textsToEmbed = rawChunks.map((c) =>
      contextHeader ? `[CONTEXT: ${contextHeader}]\n${c.text}` : c.text,
    )

    const embeddings = await this.embedding.embedChunks(textsToEmbed, TaskType.RETRIEVAL_DOCUMENT)

    for (let i = 0; i < rawChunks.length; i++) {
      const vectorLiteral = `[${embeddings[i].join(',')}]`
      await this.db.$executeRawUnsafe(
        `UPDATE "KnowledgeChunk" SET embedding = $1::vector, "contextHeader" = $2, text = $3 WHERE id = $4`,
        vectorLiteral,
        contextHeader || null,
        textsToEmbed[i],
        rawChunks[i].id,
      )
      onChunkDone?.()
    }

    await this.db.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'INDEXED', indexedAt: new Date() },
    })

    this.logger.log(`embedSource: embedded ${rawChunks.length} chunks for source ${sourceId}`)
  }

  /**
   * Estimate total cost for all pending SCANNED chunks.
   * Includes: embedding cost + context-header summary call cost (deferred to Phase B).
   * Returns a single combined estimate so the confirm screen shows one honest total.
   */
  async estimatePendingCost(): Promise<{
    chunkCount: number
    tokenEstimate: number
    costUsd: number
  }> {
    const chunkResult = await this.db.$queryRaw<{ chunk_count: bigint; token_estimate: bigint }[]>`
      SELECT COUNT(*) AS chunk_count, COALESCE(SUM(kc."tokenCount"), 0) AS token_estimate
      FROM "KnowledgeChunk" kc
      JOIN "KnowledgeSource" ks ON kc."sourceId" = ks.id
      WHERE ks.status = 'SCANNED' AND kc.embedding IS NULL
    `
    const pageResult = await this.db.$queryRaw<{ page_count: bigint }[]>`
      SELECT COUNT(*) AS page_count
      FROM "KnowledgeSource"
      WHERE status = 'SCANNED'
    `

    const row = chunkResult[0]
    const chunkCount = Number(row?.chunk_count ?? 0)
    const tokenEstimate = Number(row?.token_estimate ?? 0)
    const pageCount = Number(pageResult[0]?.page_count ?? 0)

    // Embedding cost: chunk tokens + context header overhead per chunk (~50 tokens prepended)
    const embedTokens = tokenEstimate + chunkCount * CONTEXT_HEADER_TOKENS_PER_CHUNK
    const embedCost = (embedTokens / 1_000_000) * EMBED_PRICE_PER_MILLION

    // Summary cost: one gemini-2.0-flash call per page (input ≈ 600 tokens, output ≈ 50 tokens)
    const summaryInputCost = (pageCount * SUMMARY_INPUT_TOKENS_PER_PAGE / 1_000_000) * SUMMARY_INPUT_PER_MILLION
    const summaryOutputCost = (pageCount * SUMMARY_OUTPUT_TOKENS_PER_PAGE / 1_000_000) * SUMMARY_OUTPUT_PER_MILLION
    const summaryCost = summaryInputCost + summaryOutputCost

    const costUsd = embedCost + summaryCost

    return { chunkCount, tokenEstimate, costUsd }
  }

  /** Legacy: fetch + chunk + embed in one step (used by reindex-single-source path). */
  async indexPage(url: string): Promise<void> {
    this.logger.log(`indexPage: start ${url}`)

    const source = await this.db.knowledgeSource.upsert({
      where: { url },
      create: { url, status: 'PENDING' },
      update: { status: 'PENDING', errorMessage: null },
    })

    const page = await this.crawler.fetchPage(url)
    if (!page) {
      this.logger.warn(`indexPage: fetchPage returned null for ${url} — marking SKIPPED`)
      await this.db.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'SKIPPED' },
      })
      return
    }

    const contentHash = createHash('sha256').update(page.html).digest('hex')

    if (source.contentHash === contentHash && source.status === 'INDEXED') {
      this.logger.log(`indexPage: ${url} unchanged — skipping`)
      return
    }

    await this.db.knowledgeSource.update({
      where: { id: source.id },
      data: { title: page.title, contentHash, status: 'FETCHED', fetchedAt: new Date() },
    })

    const chunks = this.chunker.chunk(page.html, url)
    if (chunks.length === 0) {
      this.logger.warn(`indexPage: no chunks for ${url} — marking SKIPPED`)
      await this.db.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'SKIPPED' },
      })
      return
    }

    const contextHeader = await this.contextBuilder.buildContextHeader(page.title, page.html)

    const textsToEmbed = chunks.map((c) =>
      contextHeader ? `[CONTEXT: ${contextHeader}]\n${c.text}` : c.text,
    )
    const embeddings = await this.embedding.embedChunks(textsToEmbed, TaskType.RETRIEVAL_DOCUMENT)

    await this.db.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { sourceId: source.id } })

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        const vectorLiteral = `[${embeddings[i].join(',')}]`

        await tx.$executeRawUnsafe(
          `INSERT INTO "KnowledgeChunk" (id, "createdAt", "sourceId", ordinal, text, "contextHeader", "headingPath", anchor, "deepUrl", "tokenCount", embedding)
           VALUES (gen_random_uuid()::text, NOW(), $1, $2, $3, $4, $5::text[], $6, $7, $8, $9::vector)`,
          source.id,
          c.ordinal,
          textsToEmbed[i],
          contextHeader || null,
          c.headingPath,
          c.anchor,
          c.deepUrl,
          c.tokenCount,
          vectorLiteral,
        )
      }

      await tx.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'INDEXED', indexedAt: new Date() },
      })
    })

    this.logger.log(`indexPage: indexed ${url} with ${chunks.length} chunks`)
  }
}
