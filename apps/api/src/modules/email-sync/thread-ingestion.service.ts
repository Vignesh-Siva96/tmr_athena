import { Injectable, Logger, Optional } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../database/prisma.service'
import { QueueService } from '../queue/queue.service'
import type { IMailProvider } from './providers/mail-provider.interface'
import { CustomerResolverService } from './customer-resolver.service'
import { stripSubjectPrefixes } from './util/strip-subject'

@Injectable()
export class ThreadIngestionService {
  private readonly logger = new Logger(ThreadIngestionService.name)
  private sseService: { broadcast(event: Record<string, unknown>): void } | null = null

  constructor(
    private readonly db: PrismaService,
    private readonly customerResolver: CustomerResolverService,
    private readonly queue: QueueService,
  ) {}

  /** Called by EventsModule after initialization to avoid circular dependency */
  setSseService(sse: { broadcast(event: Record<string, unknown>): void }): void {
    this.sseService = sse
  }

  async fetchAndUpsertThread(
    provider: IMailProvider,
    threadId: string,
    options: { isBackfill: boolean },
  ): Promise<{ created: boolean; ticketId?: string }> {
    let parsed
    try {
      parsed = await provider.fetchThread(threadId)
    } catch (err) {
      this.logger.warn(`Failed to fetch thread ${threadId}: ${String(err)}`)
      return { created: false }
    }

    const customer = this.customerResolver.resolveCustomer(parsed, provider.aliases)
    if (!customer) {
      this.logger.debug(`Skipping alias-only thread ${threadId}`)
      return { created: false }
    }

    // Upsert user outside the transaction so it commits immediately. Catch P2002
    // (unique violation) from concurrent threads racing on the same email and
    // fall back to a plain findUnique — the winning thread already inserted it.
    let user
    try {
      user = await this.db.user.upsert({
        where: { email: customer.email },
        create: {
          email: customer.email,
          name: customer.name ?? null,
          source: 'EMAIL',
          isVerified: false,
        },
        update: {},
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.db.user.findUnique({ where: { email: customer.email } })
        if (!existing) throw err
        user = existing
      } else {
        throw err
      }
    }

    let ticketId: string | undefined
    let wasCreated = false
    let newMessageId: string | undefined

    // Derive ticket timestamps from actual message dates
    const sortedMessages = [...parsed.messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    const firstMessageAt = sortedMessages[0]?.sentAt ?? new Date()
    const lastMessageAt = sortedMessages[sortedMessages.length - 1]?.sentAt ?? new Date()

    await this.db.$transaction(async (tx) => {

      // Look up ticket by externalThreadId first (fast path for email-originated tickets)
      let existingTicket = await tx.ticket.findUnique({
        where: { externalThreadId: threadId },
        select: { id: true },
      })

      // Fallback: match by In-Reply-To headers (handles replies to portal-originated tickets
      // whose outbound message IDs we stored, but which have no externalThreadId yet)
      if (!existingTicket) {
        const inReplyToValues = parsed.messages
          .map(m => m.inReplyTo)
          .filter((v): v is string => !!v)

        if (inReplyToValues.length > 0) {
          // Check 1: agent reply messageIds stored on Message records
          const matchingMessage = await tx.message.findFirst({
            where: { messageId: { in: inReplyToValues } },
            select: { ticketId: true },
          })
          if (matchingMessage) {
            existingTicket = { id: matchingMessage.ticketId }
          }

          // Check 2: confirmation email uses synthetic <ticket-{emailThreadId}@domain> format
          // Parse the emailThreadId out of the inReplyTo header and look up the ticket directly
          if (!existingTicket) {
            const syntheticPattern = /^<ticket-([^@]+)@/
            for (const val of inReplyToValues) {
              const match = syntheticPattern.exec(val)
              if (match) {
                const emailThreadId = match[1]
                const ticketByEmailThread = await tx.ticket.findFirst({
                  where: { emailThreadId },
                  select: { id: true },
                })
                if (ticketByEmailThread) {
                  existingTicket = ticketByEmailThread
                  break
                }
              }
            }
          }

          // Stamp externalThreadId on the matched ticket for future fast-path lookups
          if (existingTicket) {
            await tx.ticket.update({
              where: { id: existingTicket.id },
              data: { externalThreadId: threadId, externalProvider: provider.kind },
            })
          }
        }
      }

      if (!existingTicket) {
        const ticket = await tx.ticket.create({
          data: {
            externalThreadId: threadId,
            externalProvider: provider.kind,
            title: stripSubjectPrefixes(parsed.firstSubject) || '(no subject)',
            category: 'OTHER',
            source: 'EMAIL',
            status: 'OPEN',
            userId: user.id,
            createdAt: firstMessageAt,
            updatedAt: lastMessageAt,
          },
        })
        ticketId = ticket.id
        wasCreated = true
      } else {
        ticketId = existingTicket.id
      }

      // Upsert each message, tracking the latest sentAt among new messages
      let latestNewMessageAt: Date | null = null

      for (const msg of parsed.messages) {
        const isFromAgent = customer.matchesAlias(msg.fromEmail)

        // Skip if already imported by externalMessageId (Gmail message ID)
        const existingMsg = await tx.message.findUnique({
          where: { externalMessageId: msg.id },
          select: { id: true },
        })
        if (existingMsg) continue

        // Skip if already imported by RFC messageId (same email, different Gmail ID — e.g. Sent copy)
        if (msg.rfcMessageId) {
          const existingByMsgId = await tx.message.findUnique({
            where: { messageId: msg.rfcMessageId },
            select: { id: true },
          })
          if (existingByMsgId) continue
        }

        // Find agent by email if message is from agent
        let authorAgentId: string | null = null
        if (isFromAgent) {
          const agent = await tx.agent.findFirst({
            where: { email: { equals: msg.fromEmail, mode: 'insensitive' } },
            select: { id: true },
          })
          authorAgentId = agent?.id ?? null
        }

        const created = await tx.message.create({
          data: {
            ticketId: ticketId!,
            externalMessageId: msg.id,
            messageId: msg.rfcMessageId ?? null,
            inReplyTo: msg.inReplyTo ?? null,
            type: 'REPLY',
            body: msg.bodyPlain || '(no content)',
            bodyHtml: msg.bodyHtml ?? null,
            bodyRaw: msg.bodyRaw ?? null,
            sentVia: 'EMAIL',
            authorUserId: isFromAgent ? null : user.id,
            authorAgentId: isFromAgent ? authorAgentId : null,
            createdAt: msg.sentAt,
          },
        })

        if (!isFromAgent) {
          newMessageId = created.id
        }

        if (!latestNewMessageAt || msg.sentAt > latestNewMessageAt) {
          latestNewMessageAt = msg.sentAt
        }
      }

      // For existing tickets receiving new messages, update updatedAt to the latest message time
      if (!wasCreated && latestNewMessageAt) {
        await tx.ticket.update({
          where: { id: ticketId },
          data: { updatedAt: latestNewMessageAt },
        })
      }
    })

    // Enqueue AI analysis for live mail only
    if (!options.isBackfill && ticketId && newMessageId) {
      await this.queue.enqueueAnalyzeMessage({ messageId: newMessageId, ticketId })
    }

    // Broadcast SSE events
    if (this.sseService && ticketId) {
      if (wasCreated) {
        this.sseService.broadcast({ type: 'ticket-created', ticketId, threadId })
      } else if (newMessageId) {
        this.sseService.broadcast({ type: 'message-created', ticketId, messageId: newMessageId })
      }
    }

    return { created: wasCreated, ticketId }
  }
}
