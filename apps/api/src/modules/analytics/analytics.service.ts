import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: PrismaService) {}

  async getOverview() {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [
      totalTickets,
      openTickets,
      resolvedTickets,
      unassigned,
      newThisWeek,
      newLastWeek,
      byStatus,
      byCategory,
      byPriority,
      connectorGroups,
      resolutionMessages,
      topCustomersRaw,
      agents,
      volumeRaw,
    ] = await Promise.all([
      // Total non-deleted
      this.db.ticket.count({ where: { deletedAt: null } }),

      // Open (active)
      this.db.ticket.count({ where: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] } } }),

      // Resolved/closed
      this.db.ticket.count({ where: { deletedAt: null, status: { in: ['RESOLVED', 'CLOSED'] } } }),

      // Unassigned open
      this.db.ticket.count({ where: { deletedAt: null, assigneeId: null, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] } } }),

      // New this week
      this.db.ticket.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),

      // New last week
      this.db.ticket.count({ where: { deletedAt: null, createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),

      // By status
      this.db.ticket.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { id: true } }),

      // By category
      this.db.ticket.groupBy({ by: ['category'], where: { deletedAt: null }, _count: { id: true } }),

      // By priority
      this.db.ticket.groupBy({ by: ['priority'], where: { deletedAt: null }, _count: { id: true } }),

      // By connector (non-null)
      this.db.ticket.groupBy({ by: ['connector'], where: { deletedAt: null, connector: { not: null } }, _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10 }),

      // System event messages for resolution time
      this.db.message.findMany({
        where: { type: 'SYSTEM_EVENT', body: { contains: ':RESOLVED' }, deletedAt: null },
        select: { ticketId: true, createdAt: true },
      }),

      // Top customers by ticket count
      this.db.user.findMany({
        where: { isGuest: false },
        select: {
          id: true, name: true, email: true, createdAt: true,
          tickets: {
            where: { deletedAt: null },
            select: { id: true, status: true, createdAt: true },
          },
        },
        orderBy: { tickets: { _count: 'desc' } },
        take: 10,
      }),

      // Agent performance
      this.db.agent.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, email: true,
          assignedTickets: {
            where: { deletedAt: null },
            select: { id: true, status: true },
          },
        },
        orderBy: { assignedTickets: { _count: 'desc' } },
      }),

      // Daily volume — last 30 days (raw SQL for date_trunc)
      this.db.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT DATE_TRUNC('day', "createdAt") as date, COUNT(*)::bigint as count
        FROM "Ticket"
        WHERE "deletedAt" IS NULL
          AND "createdAt" >= ${thirtyDaysAgo}
        GROUP BY 1
        ORDER BY 1
      `,
    ])

    // ── Resolution time (avg hours, from ticket.createdAt to resolution event) ──
    const resolvedTicketIds = new Set(resolutionMessages.map((m) => m.ticketId))
    const resolvedTicketCreatedAt = await this.db.ticket.findMany({
      where: { id: { in: [...resolvedTicketIds] }, deletedAt: null },
      select: { id: true, createdAt: true },
    })

    const createdAtMap = new Map(resolvedTicketCreatedAt.map((t) => [t.id, t.createdAt]))
    const resolutionTimes: number[] = []
    for (const msg of resolutionMessages) {
      const created = createdAtMap.get(msg.ticketId)
      if (!created) continue
      const hours = (msg.createdAt.getTime() - created.getTime()) / (1000 * 60 * 60)
      if (hours >= 0) resolutionTimes.push(hours)
    }
    const avgResolutionHours = resolutionTimes.length
      ? Math.round((resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length) * 10) / 10
      : null

    // ── Volume by day — fill gaps so every day has a value ──
    const volumeMap = new Map<string, number>()
    for (const row of volumeRaw) {
      const dateStr = row.date.toISOString().slice(0, 10)
      volumeMap.set(dateStr, Number(row.count))
    }
    const volumeByDay: { date: string; count: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const dateStr = d.toISOString().slice(0, 10)
      volumeByDay.push({ date: dateStr, count: volumeMap.get(dateStr) ?? 0 })
    }

    // ── Top customers — with open + total counts ──
    const topCustomers = topCustomersRaw
      .filter((u) => u.tickets.length > 0)
      .map((u) => ({
        id: u.id,
        name: u.name ?? u.email.split('@')[0],
        email: u.email,
        total: u.tickets.length,
        open: u.tickets.filter((t) => ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status)).length,
        lastTicket: u.tickets.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdAt ?? null,
      }))

    // ── Agent performance ──
    const agentPerformance = agents.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      assigned: a.assignedTickets.length,
      resolved: a.assignedTickets.filter((t) => ['RESOLVED', 'CLOSED'].includes(t.status)).length,
      open: a.assignedTickets.filter((t) => ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status)).length,
    }))

    const weekOverWeekPct =
      newLastWeek === 0
        ? null
        : Math.round(((newThisWeek - newLastWeek) / newLastWeek) * 100)

    return {
      kpis: {
        totalTickets,
        openTickets,
        resolvedTickets,
        resolutionRate: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
        avgResolutionHours,
        newThisWeek,
        newLastWeek,
        weekOverWeekPct,
        unassigned,
      },
      volumeByDay,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count.id])) as Record<string, number>,
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count.id])) as Record<string, number>,
      byPriority: Object.fromEntries(byPriority.map((r) => [r.priority, r._count.id])) as Record<string, number>,
      byConnector: connectorGroups
        .filter((r) => r.connector)
        .map((r) => ({ connector: r.connector as string, count: r._count.id })),
      topCustomers,
      agentPerformance,
    }
  }
}
