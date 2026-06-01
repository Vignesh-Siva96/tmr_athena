import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

export interface RetrievedChunk {
  id: string
  text: string
  deepUrl: string
  headingPath: string[]
  score: number
  denseScore: number
}

export interface RetrievalResult {
  chunks: RetrievedChunk[]
  maxDenseScore: number
}

interface RawDenseRow {
  id: string
  score: number
}

interface RawFtsRow {
  id: string
  rank: number
}

@Injectable()
export class RetrievalService implements OnModuleInit {
  private readonly logger = new Logger(RetrievalService.name)

  constructor(private readonly db: PrismaService) {}

  /**
   * Ensure the FTS `tsv` generated column + GIN index exist on every boot.
   * Generated columns aren't declared in the Prisma schema, so a `migrate reset`
   * or a migration applied with 0 steps can silently drop them — which previously
   * took the bot down (retrieval query referenced a non-existent `tsv` column).
   * This idempotent guard self-heals that case. See STATE.md (2026-06-01).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.db.$executeRawUnsafe(
        `ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED`,
      )
      await this.db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "KnowledgeChunk_tsv_gin" ON "KnowledgeChunk" USING GIN("tsv")`,
      )
    } catch (err) {
      this.logger.error(`Failed to ensure KnowledgeChunk.tsv FTS column: ${String(err)}`)
    }
  }

  async retrieve(
    queryEmbedding: number[],
    queryText: string,
    topK = 5,
  ): Promise<RetrievalResult> {
    const embeddingStr = '[' + queryEmbedding.join(',') + ']'

    // --- Dense retrieval via pgvector (cosine similarity on L2-normalised vectors) ---
    const denseRows = await this.db.$queryRawUnsafe<RawDenseRow[]>(
      `SELECT id, 1 - (embedding <=> CAST($1 AS vector)) AS score
       FROM "KnowledgeChunk"
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> CAST($1 AS vector) ASC
       LIMIT 50`,
      embeddingStr,
    )

    // --- Sparse retrieval via Postgres FTS (replaces pg_trgm to avoid trigram pollution) ---
    // Uses the stored tsv generated column + GIN index for performance (ensured in onModuleInit).
    // Resilient: if the FTS arm fails for any reason, degrade to dense-only rather than failing
    // the whole bot answer (a missing tsv column must not escalate every ticket).
    let ftsRows: RawFtsRow[] = []
    try {
      ftsRows = await this.db.$queryRawUnsafe<RawFtsRow[]>(
        `SELECT id,
                ts_rank_cd(tsv, websearch_to_tsquery('english', $1)) AS rank
         FROM "KnowledgeChunk"
         WHERE tsv @@ websearch_to_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT 50`,
        queryText,
      )
    } catch (err) {
      this.logger.warn(`FTS retrieval failed, falling back to dense-only: ${String(err)}`)
    }

    // Build rank maps: lower rank index = better
    const denseRank = new Map<string, number>()
    const denseScoreMap = new Map<string, number>()
    denseRows.forEach((row, i) => {
      denseRank.set(row.id, i + 1)
      denseScoreMap.set(row.id, Number(row.score))
    })

    const sparseRank = new Map<string, number>()
    ftsRows.forEach((row, i) => sparseRank.set(row.id, i + 1))

    // RRF fusion (k=60)
    const k = 60
    const allIds = new Set<string>([
      ...denseRank.keys(),
      ...sparseRank.keys(),
    ])

    const rrfScores = new Map<string, number>()
    for (const id of allIds) {
      const dRank = denseRank.get(id) ?? Infinity
      const sRank = sparseRank.get(id) ?? Infinity
      const score =
        (dRank < Infinity ? 1 / (k + dRank) : 0) +
        (sRank < Infinity ? 1 / (k + sRank) : 0)
      rrfScores.set(id, score)
    }

    // Sort by descending RRF score and take topK ids
    const sortedIds = [...rrfScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id]) => id)

    if (sortedIds.length === 0) {
      return { chunks: [], maxDenseScore: 0 }
    }

    // Fetch full chunk data for top ids
    const chunks = await this.db.knowledgeChunk.findMany({
      where: { id: { in: sortedIds } },
      select: {
        id: true,
        text: true,
        deepUrl: true,
        headingPath: true,
      },
    })

    // Re-order by RRF score, attach scores
    const chunkMap = new Map(chunks.map((c) => [c.id, c]))
    const result: RetrievedChunk[] = []

    for (const id of sortedIds) {
      const chunk = chunkMap.get(id)
      if (!chunk) continue
      result.push({
        id: chunk.id,
        text: chunk.text,
        deepUrl: chunk.deepUrl,
        headingPath: chunk.headingPath,
        score: rrfScores.get(id) ?? 0,
        denseScore: denseScoreMap.get(id) ?? 0,
      })
    }

    const maxDenseScore = result.length > 0
      ? Math.max(...result.map((c) => c.denseScore))
      : 0

    return { chunks: result, maxDenseScore }
  }
}
