import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { EmailService } from '../email/email.service'
import { QueueService } from '../queue/queue.service'
import { SseService } from '../events/sse.service'
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
    private readonly queueService: QueueService,
    private readonly sse: SseService,
  ) {}

  // ─── Shared activation (confirmation + bot) ───────────────────────────────

  private async activateTicket(ticketId: string): Promise<void> {
    const appConfig = await this.db.appConfig.findFirst()
    if (appConfig) {
      const fullTicket = await this.db.ticket.findUnique({
        where: { id: ticketId },
        include: { user: true },
      })
      if (fullTicket) {
        this.emailService
          .sendTicketConfirmation(
            fullTicket as Parameters<typeof this.emailService.sendTicketConfirmation>[0],
            appConfig,
          )
          .catch((err: unknown) => console.error('Confirmation email failed:', err))
      }
    }
    this.queueService.enqueueBotRespond({ ticketId }).catch(() => {})
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async stats(): Promise<unknown> {
    const excluded: TicketStatus[] = ['NEW', 'DISMISSED']
    const liveFilter = { deletedAt: null, status: { notIn: excluded } }
    const [byStatus, byCategory, unassigned, newCount] = await Promise.all([
      this.db.ticket.groupBy({ by: ['status'], where: liveFilter, _count: { _all: true } }),
      this.db.ticket.groupBy({ by: ['category'], where: liveFilter, _count: { _all: true } }),
      this.db.ticket.count({ where: { ...liveFilter, assigneeId: null } }),
      this.db.ticket.count({ where: { deletedAt: null, status: 'NEW' } }),
    ])
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count._all])),
      unassigned,
      newCount,
    }
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async list(query: ListTicketsQuery, caller: CallerContext): Promise<TicketListResult> {
    // Determine status scope from view + caller
    const excludedStatuses: TicketStatus[] = ['NEW', 'DISMISSED']
    let statusScope: Prisma.TicketWhereInput['status'] | undefined
    if (caller.role === 'user') {
      statusScope = { notIn: excludedStatuses }
    } else if (query.view === 'inbox') {
      statusScope = undefined
    } else {
      statusScope = { notIn: excludedStatuses }
    }

    const where: Prisma.TicketWhereInput = {
      deletedAt: null,
      ...(query.view === 'inbox' && caller.role === 'agent' && { source: 'EMAIL' }),
      ...(query.status ? { status: query.status as TicketStatus } : (statusScope ? { status: statusScope } : {})),
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
          dismissedBy: { select: { id: true, name: true } },
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

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(dto: CreateTicketDto, caller: CallerContext): Promise<{ ticket: unknown; displayId: string }> {
    const ticketResult = await this.db.$transaction(async (tx) => {
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
      let descriptionMessageId: string | null = null
      if (dto.description) {
        const msg = await tx.message.create({ data: { ticketId: t.id, body: dto.description, authorUserId: caller.id, type: 'REPLY' } })
        descriptionMessageId = msg.id
      }
      if (dto.attachmentIds?.length) {
        await tx.attachment.updateMany({
          where: { id: { in: dto.attachmentIds } },
          data: {
            ticketId: t.id,
            ...(descriptionMessageId ? { messageId: descriptionMessageId } : {}),
          },
        })
      }
      return { ticket: t, descriptionMessageId }
    })
    const { ticket, descriptionMessageId } = ticketResult

    // Portal ticket → activate immediately (confirmation + bot)
    await this.activateTicket(ticket.id)

    // Broadcast SSE event so the agent dashboard updates in real time
    this.sse.broadcast({ type: 'ticket-created', ticketId: ticket.id })

    // Enqueue AI sentiment analysis for the initial description message
    if (descriptionMessageId) {
      this.queueService.enqueueAnalyzeMessage({ messageId: descriptionMessageId, ticketId: ticket.id }).catch(() => {})
    }

    return { ticket, displayId: `TMR-${ticket.number}` }
  }

  // ─── Find by ID ───────────────────────────────────────────────────────────

  async findById(ticketId: string, caller: CallerContext): Promise<unknown> {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        tags: true,
        githubIssue: true,
        rating: { select: { aiRating: true, aiEffortScore: true, aiSummary: true } },
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

  // ─── Update ───────────────────────────────────────────────────────────────

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

        // Track first resolution time (immutable — only set once)
        if (dto.status === 'RESOLVED' && !ticket.firstResolvedAt) {
          await tx.ticket.update({ where: { id: ticketId }, data: { firstResolvedAt: new Date() } })
        }
      }
      if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
        await tx.message.create({ data: { ticketId, type: 'SYSTEM_EVENT', body: `assigned:${dto.assigneeId ?? 'unassigned'}` } })
      }
      return result
    })

    // Broadcast SSE event so the agent dashboard updates in real time
    this.sse.broadcast({ type: 'ticket-updated', ticketId })

    // Enqueue AI classify + CSAT request when ticket reaches RESOLVED
    if (dto.status === 'RESOLVED' && ticket.status !== 'RESOLVED') {
      this.queueService.enqueueClassifyTicket({ ticketId }).catch(() => {})
      this.queueService.enqueueRequestCsat({ ticketId }).catch(() => {})
    }

    return { ticket: { ...updated, displayId: `TMR-${updated.number}` } }
  }

  // ─── Convert (NEW → OPEN) ─────────────────────────────────────────────────

  async convert(ticketId: string): Promise<{ ticket: unknown }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deletedAt) throw new NotFoundException('Ticket not found')
    // Idempotent — already a real ticket, no-op
    if (ticket.status !== 'NEW' && ticket.status !== 'DISMISSED') {
      return { ticket: { ...ticket, displayId: `TMR-${ticket.number}` } }
    }

    const updated = await this.db.ticket.update({
      where: { id: ticketId },
      data: {
        status: 'OPEN',
        dismissedAt: null,
        dismissedById: null,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        tags: true,
      },
    })

    await this.activateTicket(ticketId)
    this.sse.broadcast({ type: 'ticket-updated', ticketId })

    return { ticket: { ...updated, displayId: `TMR-${updated.number}` } }
  }

  // ─── Discard (NEW → DISMISSED) ────────────────────────────────────────────

  async discard(ticketId: string, agentId: string): Promise<{ success: boolean }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deletedAt) throw new NotFoundException('Ticket not found')
    // Guard: only NEW tickets can be dismissed (idempotent on DISMISSED)
    if (ticket.status === 'DISMISSED') return { success: true }
    if (ticket.status !== 'NEW') throw new BadRequestException('Only NEW tickets can be dismissed')

    await this.db.ticket.update({
      where: { id: ticketId },
      data: { status: 'DISMISSED', dismissedAt: new Date(), dismissedById: agentId },
    })

    this.sse.broadcast({ type: 'ticket-updated', ticketId })
    return { success: true }
  }

  // ─── Soft delete ──────────────────────────────────────────────────────────

  async softDelete(ticketId: string): Promise<{ success: boolean }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deletedAt) throw new NotFoundException('Ticket not found')
    await this.db.ticket.update({ where: { id: ticketId }, data: { deletedAt: new Date() } })
    return { success: true }
  }
}
