import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { EmailService } from '../email/email.service'
import type { ListTicketsQuery, CreateTicketDto, UpdateTicketDto } from './tickets.dto'
import type { Prisma, TicketStatus, TicketPriority, TicketCategory } from '@tmr/db'

interface CallerContext {
  id: string
  role: 'user' | 'agent'
}

export interface TicketListResult {
  data: unknown[]
  meta: { total: number; limit: number; offset: number }
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly db: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async stats(): Promise<unknown> {
    const [byStatus, byCategory, unassigned] = await Promise.all([
      this.db.ticket.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { id: true } }),
      this.db.ticket.groupBy({ by: ['category'], where: { deletedAt: null }, _count: { id: true } }),
      this.db.ticket.count({ where: { deletedAt: null, assigneeId: null } }),
    ])
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count.id])),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count.id])),
      unassigned,
    }
  }

  async list(query: ListTicketsQuery, caller: CallerContext): Promise<TicketListResult> {
    const where: Prisma.TicketWhereInput = {
      deletedAt: null,
      ...(query.status && { status: query.status as TicketStatus }),
      ...(query.category && { category: query.category as TicketCategory }),
      ...(query.assigneeId && { assigneeId: query.assigneeId }),
      ...(caller.role === 'user' && { userId: caller.id }),
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } },
          { user: { name: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } } },
          { user: { email: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } } },
          { connector: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } },
          { product: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } },
        ],
      }),
    }

    const [tickets, total] = await Promise.all([
      this.db.ticket.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
          messages: {
            where: { deletedAt: null, isInternal: false, type: 'REPLY' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true },
          },
        },
        orderBy: { [query.sortBy]: query.sortOrder },
        take: query.limit,
        skip: query.offset,
      }),
      this.db.ticket.count({ where }),
    ])

    return {
      data: tickets.map((t) => ({
        ...t,
        displayId: `TMR-${t.number}`,
        lastMessage: t.messages[0] ?? null,
        hasUnreadReply: false,
      })),
      meta: { total, limit: query.limit, offset: query.offset },
    }
  }

  async create(dto: CreateTicketDto, caller: CallerContext): Promise<{ ticket: unknown; displayId: string }> {
    const ticket = await this.db.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          title: dto.title,
          category: dto.category as TicketCategory,
          product: dto.product,
          connector: dto.connector,
          userId: caller.id,
          source: 'PORTAL',
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
        },
      })
      if (dto.description) {
        await tx.message.create({ data: { ticketId: t.id, body: dto.description, authorUserId: caller.id, type: 'REPLY' } })
      }
      if (dto.attachmentIds?.length) {
        await tx.attachment.updateMany({
          where: { id: { in: dto.attachmentIds } },
          data: { ticketId: t.id },
        })
      }
      return t
    })

    // Send confirmation email to customer (fire-and-forget)
    const appConfig = await this.db.appConfig.findFirst()
    if (appConfig) {
      const ticketWithUser = await this.db.ticket.findUnique({
        where: { id: ticket.id },
        include: { user: true },
      })
      if (ticketWithUser) {
        this.emailService
          .sendTicketConfirmation(
            ticketWithUser as Parameters<typeof this.emailService.sendTicketConfirmation>[0],
            appConfig,
          )
          .catch((err: unknown) => console.error('Confirmation email failed:', err))
      }
    }

    return { ticket, displayId: `TMR-${ticket.number}` }
  }

  async findById(ticketId: string, caller: CallerContext): Promise<unknown> {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        tags: true,
        githubIssue: true,
        messages: {
          where: { deletedAt: null, ...(caller.role === 'user' && { isInternal: false }) },
          orderBy: { createdAt: 'asc' },
          include: {
            authorUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
            authorAgent: { select: { id: true, name: true, email: true, avatarUrl: true } },
            attachments: true,
          },
        },
        attachments: true,
      },
    })

    if (!ticket) throw new NotFoundException('Ticket not found')
    if (caller.role === 'user' && ticket.userId !== caller.id) throw new ForbiddenException('Not authorized')

    return { ticket: { ...ticket, displayId: `TMR-${ticket.number}` } }
  }

  async update(ticketId: string, dto: UpdateTicketDto): Promise<{ ticket: unknown }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deletedAt) throw new NotFoundException('Ticket not found')

    const updated = await this.db.$transaction(async (tx) => {
      const result = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          ...(dto.title && { title: dto.title }),
          ...(dto.status && { status: dto.status as TicketStatus }),
          ...(dto.priority && { priority: dto.priority as TicketPriority }),
          ...(dto.category && { category: dto.category as TicketCategory }),
          ...(dto.product !== undefined && { product: dto.product }),
          ...(dto.connector !== undefined && { connector: dto.connector }),
          ...(dto.assigneeId !== undefined && { assigneeId: dto.assigneeId }),
          ...(dto.tagIds && { tags: { set: dto.tagIds.map((id) => ({ id })) } }),
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
        },
      })
      if (dto.status && dto.status !== ticket.status) {
        await tx.message.create({ data: { ticketId, type: 'SYSTEM_EVENT', body: `status_changed:${ticket.status}:${dto.status}` } })
      }
      if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
        await tx.message.create({ data: { ticketId, type: 'SYSTEM_EVENT', body: `assigned:${dto.assigneeId ?? 'unassigned'}` } })
      }
      return result
    })

    return { ticket: { ...updated, displayId: `TMR-${updated.number}` } }
  }

  async softDelete(ticketId: string): Promise<{ success: boolean }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deletedAt) throw new NotFoundException('Ticket not found')
    await this.db.ticket.update({ where: { id: ticketId }, data: { deletedAt: new Date() } })
    return { success: true }
  }
}
