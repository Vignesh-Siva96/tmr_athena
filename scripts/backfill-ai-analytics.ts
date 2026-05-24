/**
 * Backfill script — run manually against dev DB to populate AI analytics.
 *
 * WARNING: This makes real Gemini API calls and costs real money.
 * Cost estimate: ~$0.001 per ticket (2 calls × ~150 tokens each at Flash pricing).
 * 10 tickets + messages ≈ $0.02. Run --dry-run first to see counts.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-ai-analytics.ts
 *   pnpm tsx scripts/backfill-ai-analytics.ts --dry-run
 *   pnpm tsx scripts/backfill-ai-analytics.ts --limit=10
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { ANALYZE_MESSAGE_PROMPT, CLASSIFY_AND_SCORE_TICKET_PROMPT } from '../apps/api/src/modules/ai/gemini.prompts'

const db = new PrismaClient()
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : undefined

const MODEL_ID = 'gemini-2.0-flash'
const PRICES = { inputPerMillion: 0.075, outputPerMillion: 0.3 }

type AiOp = 'SENTIMENT' | 'TOPIC' | 'CSAT'

async function callGemini(
  model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
  prompt: string,
  operation: AiOp,
  opts: { ticketId?: string; messageId?: string },
): Promise<Record<string, unknown>> {
  const start = Date.now()
  let promptTokens = 0
  let completionTokens = 0

  try {
    const result = await model.generateContent(prompt)
    const response = result.response
    const usage = response.usageMetadata
    promptTokens = usage?.promptTokenCount ?? 0
    completionTokens = usage?.candidatesTokenCount ?? 0
    const totalTokens = usage?.totalTokenCount ?? promptTokens + completionTokens
    const durationMs = Date.now() - start
    const costUsd =
      (promptTokens / 1_000_000) * PRICES.inputPerMillion +
      (completionTokens / 1_000_000) * PRICES.outputPerMillion

    if (!DRY_RUN) {
      await db.aiUsage.create({
        data: {
          model: MODEL_ID,
          operation,
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCostUsd: costUsd.toFixed(6),
          durationMs,
          status: 'OK',
          ticketId: opts.ticketId ?? null,
          messageId: opts.messageId ?? null,
        },
      })
    }

    const text = response.text().trim()
    const json = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(json) as Record<string, unknown>
  } catch (err) {
    const durationMs = Date.now() - start
    if (!DRY_RUN) {
      await db.aiUsage
        .create({
          data: {
            model: MODEL_ID,
            operation,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCostUsd: '0',
            durationMs,
            status: 'ERROR',
            errorMessage: err instanceof Error ? err.message : String(err),
            ticketId: opts.ticketId ?? null,
            messageId: opts.messageId ?? null,
          },
        })
        .catch(() => {})
    }
    throw err
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set. Aborting.')
    process.exit(1)
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: MODEL_ID })

  // Gather data
  const tickets = await db.ticket.findMany({
    where: { deletedAt: null },
    include: {
      messages: {
        where: { type: 'REPLY', isInternal: false, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: { id: true, body: true, authorUserId: true, authorAgentId: true },
      },
    },
    orderBy: { createdAt: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  })

  const customerMessages = await db.message.findMany({
    where: {
      type: 'REPLY',
      isInternal: false,
      authorUserId: { not: null },
      analyzedAt: null,
      deletedAt: null,
    },
    select: { id: true, body: true, ticketId: true, authorUserId: true },
    ...(LIMIT ? { take: LIMIT * 5 } : {}),
  })

  console.log('\nBackfill plan:')
  console.log(`  Tickets to classify+rate: ${tickets.length}`)
  console.log(`  Messages to analyze: ${customerMessages.length}`)
  const estimatedCalls = tickets.length + customerMessages.length
  console.log(`  Estimated API calls: ${estimatedCalls}`)
  console.log(`  Estimated cost: ~$${(estimatedCalls * 0.001).toFixed(2)}`)

  if (DRY_RUN) {
    console.log('\nDry run — no API calls made.\n')
    return
  }

  // ── Step 1: Analyze each customer message (sentiment + churn + advocacy) ─────
  console.log('\n[1/2] Analyzing customer messages...')
  let msgDone = 0
  let churnFound = 0
  let advocacyFound = 0

  for (const msg of customerMessages) {
    const prompt = ANALYZE_MESSAGE_PROMPT(msg.body)

    try {
      const raw = await callGemini(model, prompt, 'SENTIMENT', {
        ticketId: msg.ticketId,
        messageId: msg.id,
      })

      const sentiment = raw.sentiment as { score: number; label: string }
      const churn = raw.churnSignal as { detected: boolean; quote: string; reason: string } | null
      const advocacy = raw.advocacySignal as {
        detected: boolean
        quote: string
        reason: string
      } | null

      await db.message.update({
        where: { id: msg.id },
        data: {
          sentimentScore: sentiment.score,
          sentimentLabel: sentiment.label as 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE',
          analyzedAt: new Date(),
        },
      })

      if (churn?.detected && msg.authorUserId) {
        await db.customerSignal.create({
          data: {
            type: 'CHURN_RISK',
            quote: churn.quote,
            reason: churn.reason,
            messageId: msg.id,
            ticketId: msg.ticketId,
            userId: msg.authorUserId,
          },
        })
        churnFound++
      }

      if (advocacy?.detected && msg.authorUserId) {
        await db.customerSignal.create({
          data: {
            type: 'ADVOCACY',
            quote: advocacy.quote,
            reason: advocacy.reason,
            messageId: msg.id,
            ticketId: msg.ticketId,
            userId: msg.authorUserId,
          },
        })
        advocacyFound++
      }

      msgDone++
      if (msgDone % 10 === 0) console.log(`  ${msgDone}/${customerMessages.length} messages done`)
    } catch (err) {
      console.error(`  Failed msg ${msg.id}: ${String(err)}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  console.log(`  ✓ ${msgDone} messages analyzed (${churnFound} churn, ${advocacyFound} advocacy)`)

  // ── Step 2: Classify each ticket (topic + CSAT + effort score) ────────────────
  console.log('\n[2/2] Classifying tickets...')
  let ticketsDone = 0

  for (const ticket of tickets) {
    const msgSummary = ticket.messages
      .map((m) => `[${m.authorAgentId ? 'Agent' : 'Customer'}]: ${m.body.slice(0, 200)}`)
      .join('\n')

    const existingTopics = await db.topic
      .findMany({ select: { name: true }, orderBy: { ticketCount: 'desc' }, take: 30 })
      .then((rows) => rows.map((r) => r.name))

    const prompt = CLASSIFY_AND_SCORE_TICKET_PROMPT(ticket.title, msgSummary, existingTopics)

    try {
      const raw = await callGemini(model, prompt, 'CSAT', { ticketId: ticket.id })

      const topicData = raw.topic as { name: string; isNewTopic: boolean }
      const csatData = raw.csat as { rating: number; reasoning: string }
      const effortData = raw.effort as { score: number }
      const summary = typeof raw.summary === 'string' ? raw.summary : null

      const topicRecord = await db.topic.upsert({
        where: { name: topicData.name },
        create: { name: topicData.name },
        update: {},
      })

      await db.$transaction([
        db.ticket.update({ where: { id: ticket.id }, data: { topicId: topicRecord.id } }),
        db.topic.update({
          where: { id: topicRecord.id },
          data: { ticketCount: { increment: 1 } },
        }),
        db.ticketRating.upsert({
          where: { ticketId: ticket.id },
          create: {
            ticketId: ticket.id,
            aiRating: csatData.rating,
            aiReasoning: csatData.reasoning,
            aiEffortScore: effortData.score,
            aiSummary: summary,
          },
          update: {
            aiRating: csatData.rating,
            aiReasoning: csatData.reasoning,
            aiEffortScore: effortData.score,
            aiSummary: summary,
          },
        }),
      ])

      ticketsDone++
      if (ticketsDone % 10 === 0) console.log(`  ${ticketsDone}/${tickets.length} tickets done`)
    } catch (err) {
      console.error(`  Failed ticket ${ticket.id}: ${String(err)}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  console.log(`  ✓ ${ticketsDone} tickets classified`)

  console.log('\nBackfill complete.\n')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
