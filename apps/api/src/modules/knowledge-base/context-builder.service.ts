import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai'
import * as cheerio from 'cheerio'
import { PrismaService } from '../database/prisma.service'
import { Decimal } from '@prisma/client/runtime/library'

const MODEL_ID = 'gemini-2.5-flash-lite'

// Prices per 1M tokens in USD (Gemini 2.5 Flash-Lite — verify against current Google pricing)
const PRICES = {
  inputPerMillion: 0.10,
  outputPerMillion: 0.40,
}

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name)
  private model: GenerativeModel | null = null

  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      this.model = genAI.getGenerativeModel({ model: MODEL_ID })
    } else {
      this.logger.warn('GEMINI_API_KEY not set — will resolve from DB config at runtime')
    }
  }

  private async resolveModel(): Promise<GenerativeModel | null> {
    if (this.model) return this.model
    const cfg = await this.db.appConfig.findFirst({ select: { botApiKeyEnc: true } })
    if (!cfg?.botApiKeyEnc) return null
    const genAI = new GoogleGenerativeAI(cfg.botApiKeyEnc)
    return genAI.getGenerativeModel({ model: MODEL_ID })
  }

  /**
   * Strips chrome (style, script, nav, footer, header) from HTML before summarising,
   * so the model sees actual content rather than CSS/navigation boilerplate.
   */
  private cleanHtml(html: string): string {
    const $ = cheerio.load(html)
    $('style, script, head, nav, footer, header, aside').remove()
    return $('body').text().replace(/\s+/g, ' ').trim()
  }

  async buildContextHeader(title: string | null, body: string): Promise<string> {
    const model = await this.resolveModel()
    if (!model) return ''

    const cleanBody = this.cleanHtml(body)
    const titlePart = title ? `Title: ${title}\n` : ''
    const prompt = `${titlePart}Content (truncated):\n${cleanBody.slice(0, 2000)}\n\nWrite a 1-2 sentence summary of what this doc covers for a retrieval system. 50 tokens max. Return only the summary text, no JSON.`

    const startMs = Date.now()
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0

    try {
      const result = await model.generateContent(prompt)
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
          operation: 'KB_CONTEXTUAL_SUMMARY',
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCostUsd: new Decimal(costUsd.toFixed(6)),
          durationMs,
          status: 'OK',
        },
      })

      return response.text().trim()
    } catch (err) {
      const durationMs = Date.now() - startMs
      const errorMessage = err instanceof Error ? err.message : String(err)

      this.logger.warn(`buildContextHeader failed (non-fatal): ${errorMessage}`)

      await this.db.aiUsage
        .create({
          data: {
            model: MODEL_ID,
            operation: 'KB_CONTEXTUAL_SUMMARY',
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCostUsd: new Decimal('0'),
            durationMs,
            status: 'ERROR',
            errorMessage,
          },
        })
        .catch(() => {})

      return ''
    }
  }
}
