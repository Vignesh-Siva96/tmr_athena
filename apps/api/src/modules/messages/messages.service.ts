import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { EmailService } from '../email/email.service'
import { QueueService } from '../queue/queue.service'
import { SseService } from '../events/sse.service'
import { BotService } from '../bot/bot.service'
import type { CreateMessageDto, UpdateMessageDto } from './messages.dto'
import type { MessageType, MessageSentVia, TicketStatus } from '@tmr/db'
import { applyReplyTransition } from '../tickets/util/apply-reply-transition'

interface CallerContext {
  id: string
  role: 'user' | 'agent'
}

const MESSAGE_EDIT_WINDOW_MS = 5 * 60 * 1000

@Injectable()
export class MessagesService {
  constructor(
    private readonly db: PrismaService,
    private readonly emailService: EmailService,
    private readonly queueService: QueueService,
    private readonly sse: SseService,
    private readonly botService: BotService,
  ) {}

  async create(
    ticketId: string,
    dto: CreateMessageDto,
    caller: CallerContext,
  ): Promise<{ message: unknown }> {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: { user: true },
    })
    if (!ticket) throw new NotFoundException('Ticket not found')

    if (caller.role === 'user') {
      if (ticket.userId !== caller.id) throw new ForbiddenException('Not authorized')
      if (dto.type === 'INTERNAL_NOTE')
        throw new ForbiddenException('Customers cannot create internal notes')
    }

    const isInternal = dto.type === 'INTERNAL_NOTE'

    // CC validation: only allowed on agent REPLY messages
    if (dto.cc?.length) {
      if (isInternal || caller.role === 'user' || dto.type !== 'REPLY') {
        throw new BadRequestException('CC is only allowed on agent replies')
      }
    }

    // Normalize: drop the primary customer's email from CC (case-insensitive)
    const customerEmail = ticket.user.email.toLowerCase()
    const ccInput = dto.cc !== undefined
      ? dto.cc.filter((e) => e.toLowerCase() !== customerEmail)
      : undefined

    // Check if this is a customer reply to a bot-answered ticket (scenario 9)
    let shouldAutoEscalate = false
    if (!isInternal && caller.role === 'user' && ticket.status === 'WAITING' && dto.type === 'REPLY') {
      const botInteraction = await this.db.botInteraction.findFirst({
        where: { ticketId, didAnswer: true },
      })
      shouldAutoEscalate = !!botInteraction
    }

    const message = await this.db.$transaction(async (tx) => {
      const newMessage = await tx.message.create({
        data: {
          ticketId,
          body: dto.body,
          type: dto.type as MessageType,
          isInternal,
          ...(ccInput !== undefined ? { cc: ccInput } : {}),
          ...(caller.role === 'agent'
            ? {
                authorAgentId: caller.id,
                sentVia: isInternal ? null : (dto.sendVia as MessageSentVia),
              }
            : { authorUserId: caller.id }),
        },
      })

      if (dto.attachmentIds?.length) {
        await tx.attachment.updateMany({
          where: {
            id: { in: dto.attachmentIds },
            // allow freshly-uploaded (ticketId: null) or already scoped to this ticket
            OR: [{ ticketId }, { ticketId: null }],
            messageId: null,  // don't steal from another message
          },
          data: { ticketId, messageId: newMessage.id },
        })
      }

      // Reconcile TicketParticipant from cc (only when dto.cc was explicitly provided — E13)
      if (ccInput !== undefined && caller.role === 'agent') {
        if (ccInput.length > 0) {
          // Remove participants no longer in the list
          await tx.ticketParticipant.deleteMany({
            where: { ticketId, email: { notIn: ccInput } },
          })
          // Add new ones (skip duplicates via unique constraint)
          await tx.ticketParticipant.createMany({
            data: ccInput.map((email) => ({
              ticketId,
              email,
              source: 'AGENT' as const,
              addedByAgentId: caller.id,
            })),
            skipDuplicates: true,
          })
        } else {
          // Explicit empty array — clear all participants
          await tx.ticketParticipant.deleteMany({ where: { ticketId } })
        }
      }

      if (!isInternal && !shouldAutoEscalate && ticket.isTicket) {
        await applyReplyTransition(
          tx,
          { id: ticketId, status: ticket.status as TicketStatus },
          caller.role === 'agent' ? 'agent' : 'customer',
        )
      }

      return tx.message.findUniqueOrThrow({
        where: { id: newMessage.id },
        include: {
          authorUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
          authorAgent: { select: { id: true, name: true, email: true, avatarUrl: true } },
          attachments: true,
        },
      })
    })

    // Auto-escalate to human when customer replies after bot answered (scenario 9)
    if (shouldAutoEscalate) {
      this.botService
        .escalateToHuman(ticketId, ticket, 'Customer replied after bot answer', { notifyCustomer: true })
        .catch((err: unknown) => console.error('Auto-escalation failed:', err))
    }

    // Send email: agent reply → email to customer; enqueue for retry on failure
    if (caller.role === 'agent' && !isInternal) {
      this.queueService
        .enqueueEmailSendReply({ ticketId, messageId: message.id })
        .catch((err: unknown) => console.error('Failed to enqueue reply email:', err))
    }

    // G1: Send "Received your response" ack to the customer so the email thread stays complete.
    if (caller.role === 'user' && !isInternal && dto.type === 'REPLY') {
      this.queueService
        .enqueueEmailSendReply({ ticketId, messageId: message.id, kind: 'portal-copy' })
        .catch((err: unknown) => console.error('Failed to enqueue portal reply copy:', err))
    }

    // Broadcast SSE event so the agent dashboard updates in real time
    this.sse.broadcast({ type: 'message-created', ticketId, messageId: message.id })

    // Enqueue AI sentiment analysis for customer replies on real tickets only
    if (!isInternal && caller.role === 'user' && dto.type === 'REPLY' && ticket.isTicket) {
      this.queueService.enqueueAnalyzeMessage({ messageId: message.id, ticketId }).catch(() => {})
    }

    return { message }
  }

  async update(
    ticketId: string,
    messageId: string,
    dto: UpdateMessageDto,
    agentId: string,
  ): Promise<{ message: unknown }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found')

    const message = await this.db.message.findFirst({
      where: { id: messageId, ticketId, deletedAt: null },
    })
    if (!message) throw new NotFoundException('Message not found')
    if (message.authorAgentId !== agentId) throw new ForbiddenException('Not your message')
    if (message.type === 'SYSTEM_EVENT') throw new BadRequestException('Cannot edit system events')

    const ageMs = Date.now() - message.createdAt.getTime()
    if (ageMs > MESSAGE_EDIT_WINDOW_MS)
      throw new BadRequestException('Messages can only be edited within 5 minutes of creation')

    const updated = await this.db.message.update({
      where: { id: messageId },
      data: { body: dto.body },
      include: {
        authorUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
        authorAgent: { select: { id: true, name: true, email: true, avatarUrl: true } },
        attachments: true,
      },
    })

    return { message: updated }
  }
}
