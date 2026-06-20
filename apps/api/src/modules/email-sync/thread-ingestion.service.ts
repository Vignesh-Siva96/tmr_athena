import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { TicketStatus } from '@tmr/db'
import { PrismaService } from '../database/prisma.service'
import { QueueService } from '../queue/queue.service'
import { FilesService } from '../files/files.service'
import { EmailService } from '../email/email.service'
import { BotService } from '../bot/bot.service'
import type { IMailProvider, ParsedAttachment } from './providers/mail-provider.interface'
import { CustomerResolverService } from './customer-resolver.service'
import { stripSubjectPrefixes } from './util/strip-subject'
import { generateUniqueRef } from '../tickets/util/generate-ref'
import { applyReplyTransition } from '../tickets/util/apply-reply-transition'

const MAX_EMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024

type AttachmentFetcher = { fetchAttachmentBytes(gmailMessageId: string, gmailAttachmentId: string): Promise<Buffer> }

@Injectable()
export class ThreadIngestionService {
  private readonly logger = new Logger(ThreadIngestionService.name)
  private sseService: { broadcast(event: Record<string, unknown>): void } | null = null

  constructor(
    private readonly db: PrismaService,
    private readonly customerResolver: CustomerResolverService,
    private readonly queue: QueueService,
    private readonly filesService: FilesService,
    private readonly emailService: EmailService,
    private readonly botService: BotService,
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

    // G4: Bounce detection — common DSN/NDR senders indicate a delivery failure.
    // Includes mailer-daemon, postmaster, and common automated-reply local-parts.
    const BOUNCE_PATTERN = /^(mailer-daemon|postmaster|bounce|bounces|noreply|no-reply|no\.reply|donotreply|do-not-reply|auto-reply|autoreply)(@|$)/i
    const firstParsedMsg = [...parsed.messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())[0]
    const fromLocalPart = (firstParsedMsg?.fromEmail ?? '').split('@')[0] ?? ''
    if (BOUNCE_PATTERN.test(fromLocalPart + '@')) {
      try {
        await this.handleBouncedThread(parsed, options)
      } catch (err) {
        this.logger.warn(`Bounce handler failed for thread, falling through: ${String(err)}`)
      }
      return { created: false }
    }

    // Determine bulk status from the first message (used to set user category on first-ever email)
    const parsedSorted = [...parsed.messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    const firstMsgIsBulk = parsedSorted[0]?.isBulk ?? false

    // Upsert user outside the transaction so it commits immediately. Catch P2002
    // (unique violation) from concurrent threads racing on the same email and
    // fall back to a plain findUnique — the winning thread already inserted it.
    // On CREATE only: set category based on bulk flag. Never overwrite on updates.
    let user
    try {
      user = await this.db.user.upsert({
        where: { email: customer.email },
        create: {
          email: customer.email,
          name: customer.name ?? null,
          source: 'EMAIL',
          isVerified: false,
          category: firstMsgIsBulk ? 'PROMOTIONAL' : 'CUSTOMER',
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
    let ticketIsTicket = false
    let ticketStatus: string = 'NEW'
    const pendingAttachments: { messageId: string; ticketId: string; attachments: ParsedAttachment[] }[] = []

    // Derive ticket timestamps from actual message dates
    const sortedMessages = parsedSorted
    const firstMessageAt = sortedMessages[0]?.sentAt ?? new Date()
    const lastMessageAt = sortedMessages[sortedMessages.length - 1]?.sentAt ?? new Date()

    await this.db.$transaction(async (tx) => {

      // Look up ticket by externalThreadId first (fast path for email-originated tickets)
      let existingTicket = await tx.ticket.findUnique({
        where: { externalThreadId: threadId },
        select: { id: true, isTicket: true, status: true },
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
            const t = await tx.ticket.findUnique({
              where: { id: matchingMessage.ticketId },
              select: { id: true, isTicket: true, status: true },
            })
            if (t) existingTicket = t
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
                  select: { id: true, isTicket: true, status: true },
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
        const firstMsg = sortedMessages[0]
        const ref = await generateUniqueRef((r) =>
          tx.ticket.findUnique({ where: { ref: r } }).then((t) => t !== null),
        )
        const ticket = await tx.ticket.create({
          data: {
            ref,
            isTicket: false,
            externalThreadId: threadId,
            externalProvider: provider.kind,
            title: stripSubjectPrefixes(parsed.firstSubject) || '(no subject)',
            category: 'OTHER',
            source: 'EMAIL',
            status: 'NEW',
            isBulk: firstMsg?.isBulk ?? false,
            userId: user.id,
            createdAt: firstMessageAt,
            updatedAt: lastMessageAt,
          },
        })
        ticketId = ticket.id
        ticketIsTicket = false
        ticketStatus = 'NEW'
        wasCreated = true
      } else {
        ticketId = existingTicket.id
        ticketIsTicket = existingTicket.isTicket
        ticketStatus = existingTicket.status
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
            // Already in the customer's mailbox (this message WAS that email) — never quote it.
            customerEmailedAt: msg.sentAt,
          },
        })

        if (!isFromAgent) {
          newMessageId = created.id
        }

        // Apply status transitions for live, real-ticket messages (mirrors MessagesService).
        // Skip on backfill (historical import) and conversations (isTicket=false).
        // Scenario-9 escalation runs after the transaction and will override OPEN status itself.
        if (!options.isBackfill && ticketIsTicket) {
          const result = await applyReplyTransition(
            tx,
            { id: ticketId!, status: ticketStatus as TicketStatus },
            isFromAgent ? 'agent' : 'customer',
          )
          if (result.newStatus) ticketStatus = result.newStatus
        }

        if (!latestNewMessageAt || msg.sentAt > latestNewMessageAt) {
          latestNewMessageAt = msg.sentAt
        }

        if (msg.attachments?.length) {
          pendingAttachments.push({ messageId: created.id, ticketId: ticketId!, attachments: msg.attachments })
        }
      }

      // For existing tickets receiving new messages, update updatedAt to the latest message time.
      // Also resurface DISMISSED tickets when a customer (non-agent) sends a new reply.
      if (!wasCreated && latestNewMessageAt) {
        const currentStatus = await tx.ticket.findUnique({
          where: { id: ticketId! },
          select: { status: true },
        })
        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            updatedAt: latestNewMessageAt,
            ...(newMessageId && currentStatus?.status === 'DISMISSED' ? { status: 'NEW' } : {}),
          },
        })
      }
    })

    // Persist email attachments after transaction (HTTP calls must not run inside a DB transaction)
    if (pendingAttachments.length) {
      const isAttachmentFetcher = (p: unknown): p is AttachmentFetcher =>
        typeof p === 'object' && p !== null && 'fetchAttachmentBytes' in p && typeof (p as AttachmentFetcher).fetchAttachmentBytes === 'function'
      const fetcher = isAttachmentFetcher(provider) ? provider : null
      if (fetcher) {
        for (const pending of pendingAttachments) {
          for (const att of pending.attachments) {
            try {
              if (att.size > MAX_EMAIL_ATTACHMENT_BYTES) {
                this.logger.warn(`Skipping oversized attachment ${att.filename} (${att.size} bytes)`)
                continue
              }
              const bytes = await fetcher.fetchAttachmentBytes(att.gmailMessageId, att.gmailAttachmentId)
              await this.filesService.storeBuffer(bytes, {
                filename: att.filename,
                mimeType: att.mimeType,
                size: att.size,
                ticketId: pending.ticketId,
                messageId: pending.messageId,
              })
            } catch (err) {
              this.logger.error({ err, filename: att.filename }, 'Failed to ingest email attachment')
            }
          }
        }
      }
    }

    // Enqueue AI analysis for live mail only on real tickets (isTicket = true)
    if (!options.isBackfill && ticketId && newMessageId && ticketIsTicket) {
      await this.queue.enqueueAnalyzeMessage({ messageId: newMessageId, ticketId })
    }

    if (!options.isBackfill && ticketId) {
      if (!wasCreated && newMessageId) {
        // Scenario 9: customer email reply to existing ticket — check if bot had answered
        const botInteraction = await this.db.botInteraction.findFirst({
          where: { ticketId, didAnswer: true },
        })
        if (botInteraction) {
          const ticketForEscalate = await this.db.ticket.findUnique({
            where: { id: ticketId },
            include: { user: true },
          })
          if (ticketForEscalate) {
            this.botService
              .escalateToHuman(ticketId, ticketForEscalate, 'Customer replied via email after bot answer', { notifyCustomer: true })
              .catch((err: unknown) =>
                this.logger.error(`Auto-escalation failed for ticket ${ticketId}: ${String(err)}`),
              )
          }
        }
      }
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

  /**
   * G4: Handle a detected bounce (DSN/NDR) message.
   * Scans body/headers for a known outbound Message-ID or the synthetic
   * `<ticket-{emailThreadId}@…>` token. If a ticket is found, writes a
   * `email_delivery_failed:bounce` SYSTEM_EVENT and marks the user BOUNCING.
   */
  private async handleBouncedThread(
    parsed: { messages: { bodyPlain?: string; bodyRaw?: string | null; rfcMessageId?: string }[] },
    options: { isBackfill: boolean },
  ): Promise<void> {
    if (options.isBackfill) return

    // Collect candidate reference IDs from body text of all messages in the thread
    const allBodyText = parsed.messages
      .map(m => `${m.bodyPlain ?? ''} ${m.bodyRaw ?? ''}`)
      .join(' ')

    // Pattern 1: match a known outbound Message-ID stored in our Message.messageId column
    const msgIdPattern = /<([^@>]+@[^>]+)>/g
    const candidateIds: string[] = []
    let m: RegExpExecArray | null
    while ((m = msgIdPattern.exec(allBodyText)) !== null) {
      candidateIds.push(`<${m[1]}>`)
    }

    if (candidateIds.length > 0) {
      const matchingMsg = await this.db.message.findFirst({
        where: { messageId: { in: candidateIds } },
        select: { ticketId: true, ticket: { select: { userId: true } } },
      })
      if (matchingMsg) {
        await this.writeBounceEvent(matchingMsg.ticketId, matchingMsg.ticket?.userId ?? null)
        return
      }
    }

    // Pattern 2: synthetic <ticket-{emailThreadId}@…> token
    const syntheticPattern = /ticket-([a-z0-9][a-z0-9-]*)@/gi
    while ((m = syntheticPattern.exec(allBodyText)) !== null) {
      const emailThreadId = m[1]
      const ticket = await this.db.ticket.findFirst({
        where: { emailThreadId },
        select: { id: true, userId: true },
      })
      if (ticket) {
        await this.writeBounceEvent(ticket.id, ticket.userId)
        return
      }
    }

    this.logger.debug('Bounce message received but could not be matched to a ticket — falling through to normal ingest')
  }

  private async writeBounceEvent(ticketId: string, userId: string | null): Promise<void> {
    try {
      await this.db.message.create({
        data: {
          ticketId,
          type: 'SYSTEM_EVENT',
          body: `email_delivery_failed:bounce`,
          isInternal: true,
        },
      })
      if (userId) {
        await this.db.user.update({
          where: { id: userId },
          data: { emailStatus: 'BOUNCING' },
        })
      }
      this.logger.warn(`Bounce detected for ticket ${ticketId} — wrote SYSTEM_EVENT and set user emailStatus=BOUNCING`)
    } catch (err) {
      this.logger.error(`Failed to write bounce event for ticket ${ticketId}: ${String(err)}`)
    }
  }
}
