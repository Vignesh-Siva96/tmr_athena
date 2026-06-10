import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI, EmbedContentRequest, TaskType } from '@google/generative-ai'
import { PrismaService } from '../database/prisma.service'
import { decrypt } from '../../common/crypto/credentials-cipher'
import { Decimal } from '@prisma/client/runtime/library'
import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBED_PRICE_PER_MILLION,
  l2normalize,
} from '../ai/embedding.constants'

const BATCH_SIZE = 20          // smaller batches = fewer tokens per request, easier on quota
const INTER_BATCH_DELAY_MS = 1000  // 1 s between batches (~20 RPM ceiling with 20-item batches)
const MAX_RETRIES = 5

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function is429(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('429') || msg.toLowerCase().includes('resource exhausted') || msg.toLowerCase().includes('too many requests')
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name)
  private genAI: GoogleGenerativeAI | null = null

  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
  ) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey)
    } else {
      this.logger.warn('GEMINI_API_KEY not set — will resolve from DB config at runtime')
    }
  }

  private async resolveGenAI(): Promise<GoogleGenerativeAI> {
    if (this.genAI) return this.genAI
    const cfg = await this.db.appConfig.findFirst({ select: { botApiKeyEnc: true } })
    if (!cfg?.botApiKeyEnc) {
      throw new Error('No Gemini API key configured. Set it in AI Assistant settings.')
    }
    return new GoogleGenerativeAI(decrypt(cfg.botApiKeyEnc))
  }

  /**
   * Embed a batch of texts.
   * @param texts    Texts to embed.
   * @param taskType RETRIEVAL_DOCUMENT (default) for stored knowledge chunks;
   *                 RETRIEVAL_QUERY for user query embeddings.
   *                 Asymmetric task types improve retrieval accuracy with gemini-embedding-001.
   */
  async embedChunks(
    texts: string[],
    taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT,
  ): Promise<number[][]> {
    const genAI = await this.resolveGenAI()
    if (texts.length === 0) return []

    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL })
    const allEmbeddings: number[][] = []

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)

      // Pause between batches (skip before the very first one)
      if (i > 0) await sleep(INTER_BATCH_DELAY_MS)

      const requests: EmbedContentRequest[] = batch.map((text) => ({
        content: { role: 'user', parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }))

      let lastErr: unknown
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const backoffMs = Math.min(2 ** attempt * 1000, 30_000) // 2s, 4s, 8s, 16s, 30s cap
          this.logger.warn(`embedChunks: 429 on batch ${i / BATCH_SIZE + 1}, retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms`)
          await sleep(backoffMs)
        }

        const startMs = Date.now()
        try {
          const result = await model.batchEmbedContents({ requests })
          const durationMs = Date.now() - startMs

          for (const embedding of result.embeddings) {
            allEmbeddings.push(l2normalize(embedding.values))
          }

          const totalTokens = batch.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0)
          const costUsd = (totalTokens / 1_000_000) * EMBED_PRICE_PER_MILLION
          await this.db.aiUsage.create({
            data: {
              model: EMBEDDING_MODEL,
              operation: 'ATHENA_EMBED',
              promptTokens: totalTokens,
              completionTokens: 0,
              totalTokens,
              estimatedCostUsd: new Decimal(costUsd.toFixed(6)),
              durationMs,
              status: 'OK',
            },
          })
          lastErr = undefined
          break // success
        } catch (err) {
          const durationMs = Date.now() - startMs
          lastErr = err

          if (is429(err) && attempt < MAX_RETRIES) continue // will retry

          // Non-retryable or retries exhausted
          const errorMessage = err instanceof Error ? err.message : String(err)
          await this.db.aiUsage
            .create({
              data: {
                model: EMBEDDING_MODEL,
                operation: 'ATHENA_EMBED',
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                estimatedCostUsd: new Decimal('0'),
                durationMs,
                status: 'ERROR',
                errorMessage,
              },
            })
            .catch(() => {})
          this.logger.error(`embedChunks batch ${i / BATCH_SIZE + 1} failed after ${attempt + 1} attempt(s): ${errorMessage}`)
          throw err
        }
      }
      if (lastErr) throw lastErr
    }

    return allEmbeddings
  }
}
