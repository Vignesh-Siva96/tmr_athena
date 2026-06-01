/**
 * kb-fts-tsv.spec — guards the KnowledgeChunk full-text (`tsv`) column.
 *
 * Regression catalogue:
 *   R71 — the `tsv` generated column + GIN index exist after boot (RetrievalService.onModuleInit
 *         self-heals them), and RetrievalService.retrieve() degrades to dense-only instead of
 *         throwing when the FTS arm fails. A missing `tsv` column once escalated every ticket
 *         (Postgres 42703) — see STATE.md 2026-06-01.
 */

import { harness } from './harness'
import './setup'
import { RetrievalService } from '../../apps/api/src/modules/bot/retrieval.service'

interface ColRow { is_generated: string }
interface IdxRow { indexname: string }

async function tsvColumnExists(): Promise<boolean> {
  const rows = await harness.prisma.$queryRawUnsafe<ColRow[]>(
    `SELECT is_generated FROM information_schema.columns
     WHERE table_name = 'KnowledgeChunk' AND column_name = 'tsv'`,
  )
  return rows.length > 0
}

async function ginIndexExists(): Promise<boolean> {
  const rows = await harness.prisma.$queryRawUnsafe<IdxRow[]>(
    `SELECT indexname FROM pg_indexes WHERE indexname = 'KnowledgeChunk_tsv_gin'`,
  )
  return rows.length > 0
}

async function ensureTsv(): Promise<void> {
  await harness.prisma.$executeRawUnsafe(
    `ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED`,
  )
  await harness.prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "KnowledgeChunk_tsv_gin" ON "KnowledgeChunk" USING GIN("tsv")`,
  )
}

describe('KnowledgeChunk FTS tsv column (R71)', () => {
  // Always leave the column in place for other specs in the run.
  afterAll(async () => {
    await ensureTsv()
  })

  it('R71: tsv generated column + GIN index exist after boot (onModuleInit guard)', async () => {
    expect(await tsvColumnExists()).toBe(true)
    expect(await ginIndexExists()).toBe(true)
  })

  it('R71: retrieve() degrades to dense-only (does not throw) when the FTS column is missing', async () => {
    const retrieval = harness.get<RetrievalService>(RetrievalService)

    // Simulate the outage: drop the generated column so the FTS arm errors with 42703.
    await harness.prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "KnowledgeChunk_tsv_gin"`)
    await harness.prisma.$executeRawUnsafe(`ALTER TABLE "KnowledgeChunk" DROP COLUMN IF EXISTS "tsv"`)
    expect(await tsvColumnExists()).toBe(false)

    // A 768-d query embedding; retrieve must resolve (dense-only) rather than throw.
    const embedding = Array(768).fill(0.1)
    await expect(retrieval.retrieve(embedding, 'how do I connect klaviyo', 5)).resolves.toBeDefined()

    // Restore for the rest of the suite.
    await ensureTsv()
    expect(await tsvColumnExists()).toBe(true)
  })
})
