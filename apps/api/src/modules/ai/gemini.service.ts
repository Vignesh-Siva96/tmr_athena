import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai'
import { z } from 'zod'
import { PrismaService } from '../database/prisma.service'
import { ANALYZE_MESSAGE_PROMPT, CLASSIFY_AND_SCORE_TICKET_PROMPT } from './gemini.prompts'
import type { AiOperation } from '@tmr/db'
import { Decimal } from '@prisma/client/runtime/library'

const MODEL_ID = 'gemini-2.5-flash-lite'

// Prices per 1M tokens in USD (Gemini 2.5 Flash-Lite — verify against current Google pricing)
const PRICES = {
  inputPerMillion: 0.10,
  outputPerMillion: 0.40,
}

const signalSchema = z.object({ detected: z.literal(true), quote: z.string(), reason: z.string() }).nullable()

// The model is asked for `score` and `label` together (see ANALYZE_MESSAGE_PROMPT), but we
// only validate `score` here and derive `label` ourselves in analyzeMessage() — trusting the
// model's own label risks persisting a value outside the `SentimentLabel` Postgres enum
// (a hard Prisma error) or one that's simply inconsistent with its own score.
const analyzeMessageResultSchema = z.object({
  sentiment: z.object({ score: z.number().min(-1).max(1) }),
  churnSignal: signalSchema,
  advocacySignal: signalSchema,
})

const classifyAndScoreResultSchema = z.object({
  topic: z.object({ name: z.string().min(1), isNewTopic: z.boolean() }),
  csat: z.object({ rating: z.number().int().min(1).max(5), reasoning: z.string() }),
  effort: z.object({ score: z.number().int().min(1).max(5) }),
  summary: z.string(),
})

export interface AnalyzeMessageResult {
  sentiment: { score: number; label: 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE' }
  churnSignal: { detected: true; quote: string; reason: string } | null
  advocacySignal: { detected: true; quote: string; reason: string } | null
}

export type ClassifyAndScoreResult = z.infer<typeof classifyAndScoreResultSchema>

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name)
  private model!: GenerativeModel

  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
  ) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not set — AI features disabled')
      return
    }
    const genAI = new GoogleGenerativeAI(apiKey)
    this.model = genAI.getGenerativeModel({ model: MODEL_ID })
  }

  private async invoke<T>(
    operation: AiOperation,
    prompt: string,
    schema: z.ZodType<T>,
    opts?: { ticketId?: string; messageId?: string },
  ): Promise<T> {
    if (!this.model) throw new Error('GeminiService not initialized (GEMINI_API_KEY missing)')

    const startMs = Date.now()
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0

    try {
      const result = await this.model.generateContent(prompt)
      const response = result.response
      const usage = response.usageMetadata

      promptTokens = usage?.promptTokenCount ?? 0
      completionTokens = usage?.candidatesTokenCount ?? 0
      totalTokens = usage?.totalTokenCount ?? promptTokens + completionTokens

      const durationMs = Date.now() - startMs
      const costUsd =
        (promptTokens / 1_000_000) * PRICES.inputPerMillion +
        (completionTokens / 1_000_000) * PRICES.outputPerMillion

      await this.db.aiUsage.create({
        data: {
          model: MODEL_ID,
          operation,
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCostUsd: new Decimal(costUsd.toFixed(6)),
          durationMs,
          status: 'OK',
          ticketId: opts?.ticketId ?? null,
          messageId: opts?.messageId ?? null,
        },
      })

      const text = response.text().trim()
      const json = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
      // The model can drift from the prompt's contract — wrong shape, out-of-range
      // scores, or enum values that don't exist in our schema. `schema.parse` throws
      // on any of that, which the catch below records as an ERROR aiUsage row and
      // surfaces to the worker — better than persisting garbage analytics or crashing
      // later on a Prisma enum-constraint violation.
      return schema.parse(JSON.parse(json))
    } catch (err) {
      const durationMs = Date.now() - startMs
      const errorMessage = err instanceof Error ? err.message : String(err)

      await this.db.aiUsage
        .create({
          data: {
            model: MODEL_ID,
            operation,
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCostUsd: new Decimal('0'),
            durationMs,
            status: 'ERROR',
            errorMessage,
            ticketId: opts?.ticketId ?? null,
            messageId: opts?.messageId ?? null,
          },
        })
        .catch(() => {}) // don't mask the original error

      this.logger.error(`Gemini ${operation} failed: ${errorMessage}`)
      throw err
    }
  }

  async analyzeMessage(
    body: string,
    opts?: { ticketId?: string; messageId?: string },
  ): Promise<AnalyzeMessageResult> {
    const validated = await this.invoke(
      'SENTIMENT',
      ANALYZE_MESSAGE_PROMPT(body),
      analyzeMessageResultSchema,
      opts,
    )
    // Derive the label from the validated score using the same thresholds the prompt
    // gives the model (score < -0.2 → NEGATIVE; > 0.2 → POSITIVE; else NEUTRAL), so
    // label and score can never disagree and the value is always a valid enum member.
    const score = validated.sentiment.score
    const label = score < -0.2 ? 'NEGATIVE' : score > 0.2 ? 'POSITIVE' : 'NEUTRAL'
    return { ...validated, sentiment: { score, label } }
  }

  async classifyAndScoreTicket(
    title: string,
    messages: string,
    existingTopics: string[],
    opts?: { ticketId?: string },
  ): Promise<ClassifyAndScoreResult> {
    return this.invoke(
      'CSAT',
      CLASSIFY_AND_SCORE_TICKET_PROMPT(title, messages, existingTopics),
      classifyAndScoreResultSchema,
      opts,
    )
  }
}
