import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { EmailService } from '../email/email.service'
import type { CreateMessageDto, UpdateMessageDto } from './messages.dto'
import type { MessageType, MessageSentVia, TicketStatus } from '@tmr/db'

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

    const message = await this.db.$transaction(async (tx) => {
      const newMessage = await tx.message.create({
        data: {
          ticketId,
          body: dto.body,
          type: dto.type as MessageType,
          isInternal,
          ...(caller.role === 'agent'
            ? {
                authorAgentId: caller.id,
                sentVia: isInternal ? null : (dto.sendVia as MessageSentVia),
              }
            : { authorUserId: caller.id }),
        },
        include: {
          authorUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
          authorAgent: { select: { id: true, name: true, email: true, avatarUrl: true } },
          attachments: true,
        },
      })

      let newStatus: TicketStatus | null = null
      if (!isInternal) {
        if (caller.role === 'agent' && ticket.status === 'OPEN') newStatus = 'IN_PROGRESS'
        else if (caller.role === 'agent' && ticket.status === 'IN_PROGRESS') newStatus = 'WAITING'
        else if (caller.role === 'user' && ticket.status === 'WAITING') newStatus = 'IN_PROGRESS'
      }

      if (newStatus) {
        await tx.ticket.update({ where: { id: ticketId }, data: { status: newStatus } })
        await tx.message.create({
          data: { ticketId, type: 'SYSTEM_EVENT', body: `status_changed:${ticket.status}:${newStatus}` },
        })
      }

      return newMessage
    })

    // Send email: agent reply → email to customer
    if (caller.role === 'agent' && !isInternal) {
      const appConfig = await this.db.appConfig.findFirst()
      if (appConfig) {
        this.emailService
          .sendAgentReply(
            ticket as Parameters<typeof this.emailService.sendAgentReply>[0],
            message as Parameters<typeof this.emailService.sendAgentReply>[1],
            appConfig,
          )
          .catch((err: unknown) => console.error('Email send failed:', err))
      }
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
