import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai'
import { PrismaService } from '../database/prisma.service'
import { ANALYZE_MESSAGE_PROMPT, CLASSIFY_AND_SCORE_TICKET_PROMPT } from './gemini.prompts'
import type { AiOperation } from '@tmr/db'
import { Decimal } from '@prisma/client/runtime/library'

const MODEL_ID = 'gemini-2.0-flash'

// Prices per 1M tokens in USD (Gemini 2.0 Flash)
const PRICES = {
  inputPerMillion: 0.075,
  outputPerMillion: 0.30,
}

export interface AnalyzeMessageResult {
  sentiment: { score: number; label: 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE' }
  churnSignal: { detected: true; quote: string; reason: string } | null
  advocacySignal: { detected: true; quote: string; reason: string } | null
}

export interface ClassifyAndScoreResult {
  topic: { name: string; isNewTopic: boolean }
  csat: { rating: number; reasoning: string }
  effort: { score: number }
  summary: string
}

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
      return JSON.parse(json) as T
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
    return this.invoke<AnalyzeMessageResult>('SENTIMENT', ANALYZE_MESSAGE_PROMPT(body), opts)
  }

  async classifyAndScoreTicket(
    title: string,
    messages: string,
    existingTopics: string[],
    opts?: { ticketId?: string },
  ): Promise<ClassifyAndScoreResult> {
    return this.invoke<ClassifyAndScoreResult>(
      'CSAT',
      CLASSIFY_AND_SCORE_TICKET_PROMPT(title, messages, existingTopics),
      opts,
    )
  }
}
