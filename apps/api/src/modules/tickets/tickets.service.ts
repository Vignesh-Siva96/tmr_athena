import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { QueueService } from '../queue/queue.service'
import { SseService } from '../events/sse.service'
import type { ListTicketsQuery, CreateTicketDto, UpdateTicketDto } from './tickets.dto'
import type { Prisma, TicketStatus, TicketPriority, TicketCategory } from '@tmr/db'
import { generateUniqueRef, formatRef } from './util/generate-ref'

// Full agent-visibility shape returned by findById, convert, and update so the
// Bridge ticket page never receives a partial payload and crashes on .messages.
const TICKET_DETAIL_INCLUDE = {
  user: { select: { id: true, name: true, email: true, avatarUrl: true, category: true, emailStatus: true } },
  assignee: { select: { id: true, name: true, avatarUrl: true } },
  tags: true,
  githubIssue: true,
  rating: { select: { aiRating: true, aiEffortScore: true, aiSummary: true } },
  messages: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: {
      authorUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
      authorAgent: { select: { id: true, name: true, email: true, avatarUrl: true } },
      attachments: true,
    },
  },
  attachments: true,
} satisfies Prisma.TicketInclude

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
    private readonly queueService: QueueService,
    private readonly sse: SseService,
  ) {}

  // ─── Shared activation (confirmation + bot) ───────────────────────────────

  private async activateTicket(ticketId: string): Promise<void> {
    // Enqueue confirmation email with retry (G2: was fire-and-forget).
    this.queueService.enqueueEmailConfirmation({ ticketId }).catch(() => {})
    this.queueService.enqueueBotRespond({ ticketId }).catch(() => {})
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async stats(): Promise<unknown> {
    const excluded: TicketStatus[] = ['DISMISSED']
    const liveFilter = { deletedAt: null, isTicket: true, status: { notIn: excluded } }
    const [byStatus, byCategory, unassigned, newCount] = await Promise.all([
      this.db.ticket.groupBy({ by: ['status'], where: liveFilter, _count: { _all: true } }),
      this.db.ticket.groupBy({ by: ['category'], where: liveFilter, _count: { _all: true } }),
      this.db.ticket.count({ where: { ...liveFilter, assigneeId: null } }),
      // newCount = conversations awaiting triage (isTicket=false, status=NEW)
      this.db.ticket.count({ where: { deletedAt: null, isTicket: false, status: 'NEW' } }),
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
    const where: Prisma.TicketWhereInput = {
      deletedAt: null,
    }

    if (caller.role === 'user') {
      // Portal: only own real tickets
      where.isTicket = true
      where.userId = caller.id
      where.status = { notIn: ['DISMISSED'] as TicketStatus[] }
    } else {
      // Agent unified inbox: all non-deleted, non-dismissed (both conversations and tickets)
      where.status = { notIn: ['DISMISSED'] as TicketStatus[] }
      if (query.isTicket !== undefined) where.isTicket = query.isTicket
      if (query.status) where.status = query.status as TicketStatus
    }

    if (query.category) where.category = query.category as TicketCategory
    if (query.assigneeId) where.assigneeId = query.assigneeId
    if (query.tagIds?.length) where.tags = { some: { id: { in: query.tagIds } } }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } },
        { user: { name: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } } },
        { user: { email: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } } },
        { field2: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } },
        { field1: { contains: query.search, mode: 'insensitive' as Prisma.QueryMode } },
      ]
    }

    const [tickets, total] = await Promise.all([
      this.db.ticket.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, category: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          dismissedBy: { select: { id: true, name: true } },
          // Tags are agent-only — never expose to Portal callers
          ...(caller.role === 'agent' ? { tags: true } : {}),
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
        displayId: formatRef(t.ref),
        lastMessage: t.messages[0] ?? null,
        hasUnreadReply: false,
      })),
      meta: { total, limit: query.limit, offset: query.offset },
    }
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(dto: CreateTicketDto, caller: CallerContext): Promise<{ ticket: unknown; displayId: string }> {
    const ref = await generateUniqueRef((r) =>
      this.db.ticket.findUnique({ where: { ref: r } }).then((t) => t !== null),
    )

    const ticketResult = await this.db.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          ref,
          isTicket: true,
          title: dto.title,
          category: dto.category as TicketCategory,
          field1: dto.field1,
          field2: dto.field2,
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
        // IDOR guard: only claim attachments that are still unclaimed (freshly uploaded
        // by this caller, not yet attached to any ticket/message). Without `ticketId: null`
        // a caller could pass an arbitrary attachment id and steal another user's upload.
        await tx.attachment.updateMany({
          where: { id: { in: dto.attachmentIds }, ticketId: null, messageId: null },
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

    return { ticket, displayId: formatRef(ticket.ref) }
  }

  // ─── Find by ID ───────────────────────────────────────────────────────────

  async findById(ticketId: string, caller: CallerContext): Promise<unknown> {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId, deletedAt: null },
      include: {
        ...TICKET_DETAIL_INCLUDE,
        messages: {
          where: { deletedAt: null, ...(caller.role === 'user' && { isInternal: false }) },
          orderBy: { createdAt: 'asc' },
          include: {
            authorUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
            authorAgent: { select: { id: true, name: true, email: true, avatarUrl: true } },
            attachments: true,
          },
        },
      },
    })

    if (!ticket) throw new NotFoundException('Ticket not found')
    if (caller.role === 'user' && ticket.userId !== caller.id) throw new ForbiddenException('Not authorized')
    // Portal must not deep-link pre-triage conversation threads
    if (caller.role === 'user' && !ticket.isTicket) throw new NotFoundException('Ticket not found')

    // Strip agent-only fields for Portal callers
    const { tags: _tags, ...ticketForPortal } = ticket as typeof ticket & { tags?: unknown }
    const payload = caller.role === 'user' ? ticketForPortal : ticket
    return { ticket: { ...payload, displayId: formatRef(ticket.ref) } }
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(ticketId: string, dto: UpdateTicketDto): Promise<{ ticket: unknown }> {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      include: { tags: { select: { id: true } } },
    })
    if (!ticket || ticket.deletedAt) throw new NotFoundException('Ticket not found')

    await this.db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          ...(dto.title && { title: dto.title }),
          ...(dto.status && { status: dto.status as TicketStatus }),
          ...(dto.priority && { priority: dto.priority as TicketPriority }),
          ...(dto.category && { category: dto.category as TicketCategory }),
          ...(dto.field1 !== undefined && { field1: dto.field1 }),
          ...(dto.field2 !== undefined && { field2: dto.field2 }),
          ...(dto.assigneeId !== undefined && { assigneeId: dto.assigneeId }),
          ...(dto.tagIds && { tags: { set: dto.tagIds.map((id) => ({ id })) } }),
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
      if (dto.tagIds !== undefined) {
        const prevIds = new Set(ticket.tags.map((t) => t.id))
        const nextIds = new Set(dto.tagIds)
        const changed = prevIds.size !== nextIds.size || [...prevIds].some((id) => !nextIds.has(id))
        if (changed) {
          await tx.message.create({ data: { ticketId, type: 'SYSTEM_EVENT', isInternal: true, body: 'tags_changed' } })
        }
      }
    })

    // Broadcast SSE event so the agent dashboard updates in real time
    this.sse.broadcast({ type: 'ticket-updated', ticketId })

    // Enqueue AI classify + CSAT request when a real ticket reaches RESOLVED
    if (dto.status === 'RESOLVED' && ticket.status !== 'RESOLVED' && ticket.isTicket) {
      this.queueService.enqueueClassifyTicket({ ticketId }).catch(() => {})
      this.queueService.enqueueRequestCsat({ ticketId }).catch(() => {})
    }

    // Re-fetch with full detail include so response always contains messages + attachments
    const fullTicket = await this.db.ticket.findUnique({ where: { id: ticketId }, include: TICKET_DETAIL_INCLUDE })
    return { ticket: { ...fullTicket!, displayId: formatRef(fullTicket!.ref) } }
  }

  // ─── Convert (conversation → real ticket) ────────────────────────────────

  async convert(ticketId: string): Promise<{ ticket: unknown }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deletedAt) throw new NotFoundException('Ticket not found')

    if (!ticket.isTicket) {
      await this.db.ticket.update({
        where: { id: ticketId },
        data: { isTicket: true, status: 'OPEN', dismissedAt: null, dismissedById: null, convertedAt: new Date() },
      })
      await this.activateTicket(ticketId)
      this.sse.broadcast({ type: 'ticket-updated', ticketId })

      // Backfill sentiment for customer messages that arrived before conversion
      const priorMessages = await this.db.message.findMany({
        where: {
          ticketId,
          isInternal: false,
          deletedAt: null,
          authorUserId: { not: null },
          analyzedAt: null,
        },
        select: { id: true },
      })
      for (const msg of priorMessages) {
        this.queueService.enqueueAnalyzeMessage({ messageId: msg.id, ticketId }).catch(() => {})
      }
    }

    // Both branches return full shape so the Bridge page never receives a partial payload
    const fullTicket = await this.db.ticket.findUnique({ where: { id: ticketId }, include: TICKET_DETAIL_INCLUDE })
    return { ticket: { ...fullTicket!, displayId: formatRef(fullTicket!.ref) } }
  }

  // ─── Discard (NEW → DISMISSED) ────────────────────────────────────────────

  async discard(ticketId: string, agentId: string): Promise<{ success: boolean }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.deletedAt) throw new NotFoundException('Ticket not found')
    // Guard: only NEW conversations can be dismissed (idempotent on DISMISSED)
    if (ticket.status === 'DISMISSED') return { success: true }
    if (ticket.status !== 'NEW') throw new BadRequestException('Only NEW conversations can be dismissed')

    await this.db.ticket.update({
      where: { id: ticketId },
      data: { status: 'DISMISSED', dismissedAt: new Date(), dismissedById: agentId },
    })

    this.sse.broadcast({ type: 'ticket-updated', ticketId })
    return { success: true }
  }

}
