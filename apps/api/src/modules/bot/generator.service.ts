import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI, SchemaType, TaskType } from '@google/generative-ai'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../database/prisma.service'
import { EmbeddingService } from '../knowledge-base/embedding.service'
import { BOT_GENERATION_PROMPT } from './bot.prompts'

const CHAT_MODEL = 'gemini-2.5-flash-lite'

// Prices per 1M tokens (Gemini 2.5 Flash-Lite — verify against current Google pricing)
const PRICES = {
  inputPerMillion: 0.10,
  outputPerMillion: 0.40,
}

export interface GeneratedAnswer {
  answer: string
  citations: string[]
  confidence: number
  can_answer: boolean
  reasoning: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: Decimal
}

@Injectable()
export class GeneratorService {
  private readonly logger = new Logger(GeneratorService.name)

  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  private async getApiKey(): Promise<string> {
    const appConfig = await this.db.appConfig.findFirst({
      select: { botApiKeyEnc: true },
    })

    if (appConfig?.botApiKeyEnc) {
      return appConfig.botApiKeyEnc
    }

    const envKey = this.config.get<string>('GEMINI_API_KEY')
    if (!envKey) {
      throw new Error('No Gemini API key configured (botApiKeyEnc or GEMINI_API_KEY)')
    }
    return envKey
  }

  async embed(
    texts: string[],
    _opts?: { ticketId?: string; userId?: string },
  ): Promise<number[][]> {
    return this.embedding.embedChunks(texts, TaskType.RETRIEVAL_QUERY)
  }

  async generateAnswer(
    question: string,
    chunks: Array<{ text: string; deepUrl: string; headingPath: string[] }>,
    opts?: { ticketId?: string; userId?: string },
  ): Promise<GeneratedAnswer> {
    const apiKey = await this.getApiKey()
    const genAI = new GoogleGenerativeAI(apiKey)

    const prompt = BOT_GENERATION_PROMPT(question, chunks)
    const startMs = Date.now()
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0

    try {
      const model = genAI.getGenerativeModel({
        model: CHAT_MODEL,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              answer: { type: SchemaType.STRING },
              citations: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
              },
              confidence: { type: SchemaType.NUMBER },
              can_answer: { type: SchemaType.BOOLEAN },
              reasoning: { type: SchemaType.STRING },
            },
            required: ['answer', 'citations', 'confidence', 'can_answer', 'reasoning'],
          },
        },
      })

      const result = await model.generateContent(prompt)
      const response = result.response
      const usage = response.usageMetadata

      promptTokens = usage?.promptTokenCount ?? 0
      completionTokens = usage?.candidatesTokenCount ?? 0
      totalTokens = usage?.totalTokenCount ?? promptTokens + completionTokens

      const durationMs = Date.now() - startMs
      const costNum =
        (promptTokens / 1_000_000) * PRICES.inputPerMillion +
        (completionTokens / 1_000_000) * PRICES.outputPerMillion

      await this.db.aiUsage.create({
        data: {
          model: CHAT_MODEL,
          operation: 'ATHENA_GENERATE',
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCostUsd: new Decimal(costNum.toFixed(6)),
          durationMs,
          status: 'OK',
          ticketId: opts?.ticketId ?? null,
          userId: opts?.userId ?? null,
        },
      })

      const rawText = response.text().trim()
      const json = rawText
        .replace(/^```[a-z]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim()

      const parsed = JSON.parse(json) as {
        answer: string
        citations: string[]
        confidence: number
        can_answer: boolean
        reasoning: string
      }

      return {
        ...parsed,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: new Decimal(costNum.toFixed(6)),
      }
    } catch (err) {
      const durationMs = Date.now() - startMs
      const errorMessage = err instanceof Error ? err.message : String(err)

      await this.db.aiUsage
        .create({
          data: {
            model: CHAT_MODEL,
            operation: 'ATHENA_GENERATE',
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCostUsd: new Decimal('0'),
            durationMs,
            status: 'ERROR',
            errorMessage,
            ticketId: opts?.ticketId ?? null,
            userId: opts?.userId ?? null,
          },
        })
        .catch(() => {})

      this.logger.error(`generateAnswer failed: ${errorMessage}`)
      throw err
    }
  }
}
