import { Injectable, Logger } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../database/prisma.service'
import { EmailService } from '../email/email.service'
import { MarkdownService } from '../ai/markdown.service'
import { SseService } from '../events/sse.service'
import { RetrievalService } from './retrieval.service'
import { GeneratorService } from './generator.service'
import { ShiftResolverService } from './shift-resolver.service'
import { isFeatureSuppressed } from '../config/feature-flags'

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name)

  constructor(
    private readonly db: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly generator: GeneratorService,
    private readonly shiftResolver: ShiftResolverService,
    private readonly email: EmailService,
    private readonly markdown: MarkdownService,
    private readonly sse: SseService,
  ) {}

  // Dense cosine similarity gate (L2-normalised gemini-embedding-001 vectors).
  // Values below this floor mean the top retrieved chunk is not topically relevant —
  // escalate rather than risk fabricating an answer.
  private static readonly DENSE_THRESHOLD = 0.55
  private static readonly CONFIDENCE_THRESHOLD = 0.7
  private static readonly BOT_NAME = 'Athena'

  async respondTo(ticketId: string): Promise<void> {
    const startMs = Date.now()

    // 1. Load AppConfig
    const config = await this.db.appConfig.findFirst()

    if (!config || isFeatureSuppressed(config, 'botReply')) {
      this.logger.log(`Bot reply suppressed by feature flag for ticket ${ticketId}`)
      return
    }

    // 2. Idempotency: if a BotInteraction already exists for this ticket, skip
    const existing = await this.db.botInteraction.findFirst({
      where: { ticketId },
    })
    if (existing) {
      this.logger.debug(`BotInteraction already exists for ticket ${ticketId} — skipping`)
      return
    }

    // 3. Load ticket with first user-authored REPLY message and the user
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        user: true,
        messages: {
          where: {
            type: 'REPLY',
            authorUserId: { not: null },
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    })

    if (!ticket) {
      this.logger.warn(`respondTo: ticket ${ticketId} not found`)
      return
    }

    const firstMessage = ticket.messages[0] ?? null

    // 4. Build the question from title + first message body
    const question = firstMessage
      ? `${ticket.title}\n${firstMessage.body}`
      : ticket.title

    let retrievedChunkIds: string[] = []
    let retrievalTopScore: number | null = null
    let llmConfidence: number | null = null
    let didAnswer = false
    let escalatedToAgentId: string | null = null
    let reasoning: string | null = null
    let citations: string[] = []
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0
    let costUsd = new Decimal('0')
    let botMessageId: string | null = null

    try {
      // 5. Embed the question (RETRIEVAL_QUERY taskType via GeneratorService)
      const embeddings = await this.generator.embed([question], { ticketId, userId: ticket.userId })
      const queryEmbedding = embeddings[0]

      // 6. Retrieve chunks (FTS sparse + dense + RRF)
      const { chunks, maxDenseScore } = await this.retrieval.retrieve(queryEmbedding, question)
      retrievedChunkIds = chunks.map((c) => c.id)
      // Store the dense cosine score as the interpretable quality signal
      retrievalTopScore = maxDenseScore

      // 7. Gate 1: dense cosine threshold (replaces opaque RRF score)
      if (maxDenseScore < BotService.DENSE_THRESHOLD) {
        this.logger.log(
          `Bot dense score ${maxDenseScore.toFixed(3)} below threshold ${BotService.DENSE_THRESHOLD} for ticket ${ticketId} — escalating`,
        )
        await this.escalate(ticketId, ticket, 'Retrieval score too low — no relevant knowledge base articles found.')
        escalatedToAgentId = (await this.db.ticket.findUnique({ where: { id: ticketId }, select: { assigneeId: true } }))?.assigneeId ?? null
        reasoning = 'Dense retrieval score below threshold'

        // Broadcast so the bridge reflects the escalation system event immediately
        this.sse.broadcast({ type: 'ticket-updated', ticketId })
        return
      }

      // 8. Gate 2: generate answer and check quality
      const generated = await this.generator.generateAnswer(question, chunks, {
        ticketId,
        userId: ticket.userId,
      })

      promptTokens = generated.promptTokens
      completionTokens = generated.completionTokens
      totalTokens = generated.totalTokens
      costUsd = generated.costUsd
      llmConfidence = generated.confidence
      reasoning = generated.reasoning
      citations = generated.citations

      const kbRootUrl = config?.kbRootUrl ?? ''

      // Validate same-origin citations when kbRootUrl is configured
      let citationsValid = generated.citations.length > 0
      if (citationsValid && kbRootUrl) {
        try {
          const rootOrigin = new URL(kbRootUrl).origin
          citationsValid = generated.citations.every((url) => {
            try {
              return new URL(url).origin === rootOrigin
            } catch {
              return false
            }
          })
        } catch {
          // kbRootUrl is not a valid URL — skip origin check
        }
      }

      const allGatesPass =
        generated.can_answer &&
        generated.confidence >= BotService.CONFIDENCE_THRESHOLD &&
        citationsValid

      if (!allGatesPass) {
        const reason = !generated.can_answer
          ? 'Bot could not answer from knowledge base'
          : generated.confidence < BotService.CONFIDENCE_THRESHOLD
            ? `Confidence ${generated.confidence} below threshold ${BotService.CONFIDENCE_THRESHOLD}`
            : 'Citation URLs failed same-origin check'

        this.logger.log(`Bot gate failed for ticket ${ticketId}: ${reason} — escalating`)
        await this.escalate(ticketId, ticket, reason)
        escalatedToAgentId = (await this.db.ticket.findUnique({ where: { id: ticketId }, select: { assigneeId: true } }))?.assigneeId ?? null

        // Broadcast escalation update so bridge reflects it immediately
        this.sse.broadcast({ type: 'ticket-updated', ticketId })
        return
      }

      // 9. All gates pass — post the bot reply.
      // Append the KB source link deterministically (not via the LLM): flash-lite
      // reliably drops the inline link under structured-JSON output, so build it
      // from the validated citation matched back to a retrieved chunk.
      const finalAnswer = this.appendSource(generated.answer, citations, chunks)
      const botMessage = await this.db.message.create({
        data: {
          ticketId,
          type: 'REPLY',
          body: finalAnswer,
          bodyHtml: this.markdown.render(finalAnswer),
          authorBotName: BotService.BOT_NAME,
          sentVia: 'PORTAL_AND_EMAIL',
          isInternal: false,
        },
      })

      botMessageId = botMessage.id
      didAnswer = true

      // Broadcast immediately so the bridge shows the Athena reply without waiting for the 10s poll
      this.sse.broadcast({ type: 'message-created', ticketId, messageId: botMessage.id })

      // Update ticket status to WAITING (waiting for customer response)
      await this.db.ticket.update({
        where: { id: ticketId },
        data: { status: 'WAITING' },
      })

      // Send the email reply
      const fullTicket = await this.db.ticket.findUnique({
        where: { id: ticketId },
        include: { user: true },
      })

      if (fullTicket && config) {
        const result = await this.email.sendAgentReply(
          fullTicket,
          { ...botMessage, authorAgent: null },
          config,
        )
        // Mark the bot's reply + everything quoted in it as delivered, so a later
        // reply doesn't re-quote them.
        await this.email.markMessagesEmailed([botMessage.id, ...result.quotedMessageIds])
      }
    } catch (err) {
      this.logger.error(`BotService.respondTo failed for ticket ${ticketId}: ${String(err)}`)
      try {
        const ticketForEscalate = await this.db.ticket.findUnique({
          where: { id: ticketId },
          include: { user: true },
        })
        if (ticketForEscalate) {
          await this.escalate(ticketId, ticketForEscalate, 'Bot encountered an unexpected error')
          escalatedToAgentId = ticketForEscalate.assigneeId ?? null
          this.sse.broadcast({ type: 'ticket-updated', ticketId })
        }
      } catch (escalateErr) {
        this.logger.error(`Escalation also failed for ticket ${ticketId}: ${String(escalateErr)}`)
      }
    } finally {
      // 11. Always write BotInteraction audit row
      const latencyMs = Date.now() - startMs
      try {
        await this.db.botInteraction.create({
          data: {
            ticketId,
            userId: ticket?.userId ?? '',
            messageId: botMessageId,
            retrievedChunkIds,
            retrievalTopScore,
            llmConfidence,
            didAnswer,
            escalatedToAgentId,
            reasoning,
            citations,
            latencyMs,
            costUsd,
            totalTokens,
            promptTokens,
            completionTokens,
          },
        })
      } catch (auditErr) {
        this.logger.error(`Failed to write BotInteraction for ticket ${ticketId}: ${String(auditErr)}`)
      }
    }
  }

  /**
   * Append a single "Learn more:" KB link to the bot answer, built from the validated
   * citation matched back to a retrieved chunk for a readable heading label. Any
   * model-generated "Learn more" line is stripped first to avoid duplicates.
   */
  private appendSource(
    answer: string,
    citations: string[],
    chunks: Array<{ deepUrl: string; headingPath: string[] }>,
  ): string {
    const cleaned = answer
      .split('\n')
      .filter((l) => !/^\s*learn more\s*:/i.test(l))
      .join('\n')
      .trimEnd()

    const url = citations[0]
    if (!url) return cleaned

    const match = chunks.find((c) => c.deepUrl === url)
    const label = match?.headingPath?.length
      ? match.headingPath.join(' › ')
      : 'Read the full article'
    const href = match?.deepUrl ?? url

    return `${cleaned}\n\nLearn more: [${label}](${href})`
  }

  /** Shared escalation logic — assigns on-duty agent, writes SYSTEM_EVENT, notifies customer. */
  async escalateToHuman(
    ticketId: string,
    ticket: { id: string; title: string; ref: string; assigneeId: string | null; userId: string; user: { id: string; email: string; name: string | null } },
    reason: string,
    opts: { notifyCustomer?: boolean } = {},
  ): Promise<void> {
    const agent = await this.shiftResolver.currentPrimaryAgent(new Date())

    // The `ticket.assigneeId` the caller passed in can be stale by the time this
    // runs (it's invoked fire-and-forget from createMessage with a snapshot taken
    // before that message's own transaction). Two near-simultaneous escalations
    // (e.g. two rapid customer replies) would both pass a check on that snapshot,
    // both assign agents, and clobber each other. Re-check and act atomically
    // inside the transaction via a conditional updateMany instead.
    const escalated = await this.db.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({
        where: { id: ticketId, assigneeId: null },
        data: {
          status: 'OPEN',
          ...(agent ? { assigneeId: agent.id } : {}),
        },
      })
      if (count === 0) return false

      const sysMsg = await tx.message.create({
        data: {
          ticketId,
          type: 'SYSTEM_EVENT',
          body: agent
            ? `escalated:${agent.name} — ${reason}`
            : `escalated:(no agent available) — ${reason}`,
          isInternal: true,
        },
      })

      // Broadcast the SYSTEM_EVENT message so the bridge refreshes immediately
      this.sse.broadcast({ type: 'message-created', ticketId, messageId: sysMsg.id })
      return true
    })

    if (!escalated) {
      this.logger.debug(`Ticket ${ticketId} already assigned — skipping escalation`)
      return
    }

    if (agent) {
      this.logger.log(`Ticket ${ticketId} escalated to agent ${agent.id} (${agent.name}): ${reason}`)
    } else {
      this.logger.warn(`Ticket ${ticketId} escalated but no agent resolved: ${reason}`)
    }

    if (opts.notifyCustomer) {
      const config = await this.db.appConfig.findFirst()
      if (config) {
        const fullTicket = await this.db.ticket.findUnique({
          where: { id: ticketId },
          include: { user: true },
        })
        if (fullTicket) {
          await this.email.sendEscalationNotification(fullTicket, config)
        }
      }
    }
  }

  private async escalate(
    ticketId: string,
    ticket: { id: string; title: string; ref: string; assigneeId: string | null; userId: string; user: { id: string; email: string; name: string | null } },
    reason: string,
  ): Promise<void> {
    await this.escalateToHuman(ticketId, ticket, reason, { notifyCustomer: false })
  }
}
