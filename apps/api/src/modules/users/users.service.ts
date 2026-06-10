import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import type { CreateNoteDto, UpdateNoteDto, ListCustomersQuery, UpdateUserDto } from './users.dto'
import { formatRef } from '../tickets/util/generate-ref'

@Injectable()
export class UsersService {
  constructor(private readonly db: PrismaService) {}

  async listCustomers(query: ListCustomersQuery): Promise<unknown> {
    const { limit, offset, search, category } = query

    const searchClause = search
      ? `AND (u.email ILIKE $3 OR u.name ILIKE $3)`
      : ''
    // The count query only receives [searchParam] so must use $1, not $3
    const searchClauseForCount = search
      ? `AND (u.email ILIKE $1 OR u.name ILIKE $1)`
      : ''
    const categoryClause = category
      ? `AND u.category = '${category}'::\"UserCategory\"`
      : ''

    const whereBase = `WHERE u."isGuest" = false ${searchClause} ${categoryClause}`
    const whereBaseForCount = `WHERE u."isGuest" = false ${searchClauseForCount} ${categoryClause}`
    const searchParam = search ? `%${search}%` : undefined

    const params: unknown[] = [limit, offset]
    if (search) params.push(searchParam)

    // Page the users first (cheap — no join), THEN aggregate ticket counts for just
    // that page's user IDs. The previous version did LEFT JOIN "Ticket" + GROUP BY
    // over the *entire* filtered user set before applying LIMIT/OFFSET — Postgres has
    // to build and aggregate every group to satisfy ORDER BY before it can discard all
    // but one page, so the join+aggregation cost scaled with total customers, not page size.
    const pageRows = await this.db.$queryRawUnsafe<{
      id: string
      email: string
      name: string | null
      avatarUrl: string | null
      category: string
      domain: string
      lastActiveAt: Date | null
      createdAt: Date
    }[]>(
      `SELECT
        u.id,
        u.email,
        u.name,
        u."avatarUrl",
        u.category::text,
        split_part(u.email, '@', 2) AS domain,
        u."lastActiveAt",
        u."createdAt"
      FROM "User" u
      ${whereBase}
      ORDER BY u."createdAt" DESC
      LIMIT $1 OFFSET $2`,
      ...params,
    )

    const userIds = pageRows.map((r) => r.id)
    const countsByUser = new Map<string, { ticketCount: number; conversationCount: number; openCount: number }>()
    if (userIds.length > 0) {
      const countRows = await this.db.$queryRawUnsafe<{
        userId: string
        ticketCount: bigint
        conversationCount: bigint
        openCount: bigint
      }[]>(
        `SELECT
          t."userId",
          COUNT(CASE WHEN t."isTicket" = true AND t."deletedAt" IS NULL THEN 1 END) AS "ticketCount",
          COUNT(CASE WHEN t."isTicket" = false AND t."status" != 'DISMISSED' AND t."deletedAt" IS NULL THEN 1 END) AS "conversationCount",
          COUNT(CASE WHEN t."status" IN ('OPEN', 'IN_PROGRESS', 'WAITING') AND t."deletedAt" IS NULL THEN 1 END) AS "openCount"
        FROM "Ticket" t
        WHERE t."userId" = ANY($1::text[])
        GROUP BY t."userId"`,
        userIds,
      )
      for (const row of countRows) {
        countsByUser.set(row.userId, {
          ticketCount: Number(row.ticketCount),
          conversationCount: Number(row.conversationCount),
          openCount: Number(row.openCount),
        })
      }
    }

    const totalRows = await this.db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(DISTINCT u.id) AS count FROM "User" u ${whereBaseForCount}`,
      ...(search ? [searchParam] : []),
    )

    const total = Number(totalRows[0]?.count ?? 0)
    const zeroCounts = { ticketCount: 0, conversationCount: 0, openCount: 0 }

    return {
      data: pageRows.map((r) => ({
        ...r,
        ...(countsByUser.get(r.id) ?? zeroCounts),
      })),
      meta: { total, limit, offset },
    }
  }

  async updateCategory(userId: string, dto: UpdateUserDto): Promise<unknown> {
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')
    const updated = await this.db.user.update({
      where: { id: userId },
      data: { category: dto.category },
      select: { id: true, email: true, name: true, category: true },
    })
    return { user: updated }
  }

  async findById(userId: string): Promise<unknown> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isGuest: true,
        category: true,
        lastActiveAt: true,
        createdAt: true,
      },
    })
    if (!user) throw new NotFoundException('User not found')

    const [totalTickets, openTickets, recentTickets, notes] = await Promise.all([
      this.db.ticket.count({ where: { userId, deletedAt: null, isTicket: true } }),
      this.db.ticket.count({ where: { userId, deletedAt: null, isTicket: true, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] } } }),
      this.db.ticket.findMany({
        where: { userId, deletedAt: null, status: { not: 'DISMISSED' } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        include: {
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
        },
      }),
      this.db.customerNote.findMany({
        where: { userId },
        include: { agent: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const recentTicketsMapped = recentTickets.map((t) => ({
      ...t,
      displayId: formatRef(t.ref),
    }))

    return {
      user,
      stats: { totalTickets, openTickets },
      recentTickets: recentTicketsMapped,
      notes,
    }
  }

  async createNote(userId: string, agentId: string, dto: CreateNoteDto): Promise<{ note: unknown }> {
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')

    const note = await this.db.customerNote.create({
      data: { userId, agentId, body: dto.body },
      include: { agent: { select: { id: true, name: true, avatarUrl: true } } },
    })
    return { note }
  }

  async updateNote(userId: string, noteId: string, agentId: string, dto: UpdateNoteDto): Promise<{ note: unknown }> {
    // Scope by both the :id (user) path param and the authoring agent — a note
    // belongs to a specific user AND was written by a specific agent; ignoring
    // userId let `/users/<any-id>/notes/:noteId` edit notes outside that user's scope.
    const note = await this.db.customerNote.findFirst({ where: { id: noteId, userId, agentId } })
    if (!note) throw new NotFoundException('Note not found')

    const updated = await this.db.customerNote.update({
      where: { id: noteId },
      data: { body: dto.body },
      include: { agent: { select: { id: true, name: true, avatarUrl: true } } },
    })
    return { note: updated }
  }

  async deleteNote(userId: string, noteId: string, agentId: string): Promise<{ success: boolean }> {
    const note = await this.db.customerNote.findFirst({ where: { id: noteId, userId, agentId } })
    if (!note) throw new NotFoundException('Note not found')
    await this.db.customerNote.delete({ where: { id: noteId } })
    return { success: true }
  }
}
