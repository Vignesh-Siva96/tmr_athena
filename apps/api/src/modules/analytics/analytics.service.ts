import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { AppConfigService } from '../config/config.service'
import { isFeatureSuppressed } from '../config/feature-flags'

// Scopes every operational metric to real tickets only
const REAL = { deletedAt: null, isTicket: true } as const

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const idx = Math.ceil(sorted.length * p) - 1
  return Math.round((sorted[Math.max(0, idx)] ?? 0) * 10) / 10
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async getOverview() {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const appConfig = await this.config.get()
    const slaHours = appConfig.slaFirstResponseHours
    const botEnabled = !isFeatureSuppressed(appConfig, 'botReply')

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
      field1Groups,
      field2Groups,
      resolvedForTime,
      agents,
      createdRaw,
      resolvedRaw,
      newBacklogCount,
      oldestNew,
      timeToTriageRaw,
      botStats,
      reopenCount,
    ] = await Promise.all([
      // Total real tickets
      this.db.ticket.count({ where: REAL }),

      // Open real tickets
      this.db.ticket.count({ where: { ...REAL, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] } } }),

      // Resolved/closed real tickets
      this.db.ticket.count({ where: { ...REAL, status: { in: ['RESOLVED', 'CLOSED'] } } }),

      // Unassigned open real tickets
      this.db.ticket.count({ where: { ...REAL, assigneeId: null, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] } } }),

      // New real tickets this week
      this.db.ticket.count({ where: { ...REAL, createdAt: { gte: weekAgo } } }),

      // New real tickets last week
      this.db.ticket.count({ where: { ...REAL, createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),

      // By status (real tickets)
      this.db.ticket.groupBy({ by: ['status'], where: REAL, _count: { id: true } }),

      // By category (real tickets)
      this.db.ticket.groupBy({ by: ['category'], where: REAL, _count: { id: true } }),

      // By priority (real tickets)
      this.db.ticket.groupBy({ by: ['priority'], where: REAL, _count: { id: true } }),

      // By field1 (real tickets)
      this.db.ticket.groupBy({ by: ['field1'], where: { ...REAL, field1: { not: null } }, _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10 }),

      // By field2 (real tickets)
      this.db.ticket.groupBy({ by: ['field2'], where: { ...REAL, field2: { not: null } }, _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10 }),

      // Resolved real tickets with firstResolvedAt — for resolution time
      this.db.ticket.findMany({
        where: { ...REAL, firstResolvedAt: { not: null } },
        select: { createdAt: true, firstResolvedAt: true },
      }),

      // Agent performance (real tickets)
      this.db.agent.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, email: true,
          assignedTickets: {
            where: REAL,
            select: { id: true, status: true },
          },
        },
        orderBy: { assignedTickets: { _count: 'desc' } },
      }),

      // Daily created — last 30 days (real tickets)
      this.db.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT DATE_TRUNC('day', "createdAt") as date, COUNT(*)::bigint as count
        FROM "Ticket"
        WHERE "deletedAt" IS NULL
          AND "isTicket" = true
          AND "createdAt" >= ${thirtyDaysAgo}
        GROUP BY 1
        ORDER BY 1
      `,

      // Daily resolved — last 30 days (real tickets, by firstResolvedAt)
      this.db.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT DATE_TRUNC('day', "firstResolvedAt") as date, COUNT(*)::bigint as count
        FROM "Ticket"
        WHERE "deletedAt" IS NULL
          AND "isTicket" = true
          AND "firstResolvedAt" >= ${thirtyDaysAgo}
        GROUP BY 1
        ORDER BY 1
      `,

      // Triage backlog — NEW conversations (not yet converted)
      this.db.ticket.count({ where: { deletedAt: null, isTicket: false, status: 'NEW' } }),

      // Oldest NEW conversation
      this.db.ticket.findFirst({
        where: { deletedAt: null, isTicket: false, status: 'NEW' },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),

      // Time to triage — convertedAt - createdAt for real tickets converted in last 30d
      this.db.ticket.findMany({
        where: { ...REAL, convertedAt: { not: null, gte: thirtyDaysAgo } },
        select: { createdAt: true, convertedAt: true },
      }),

      // Bot stats — last 30 days
      this.db.botInteraction.groupBy({
        by: ['didAnswer'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: { id: true },
      }),

      // Reopen count (real tickets that were reopened at least once)
      this.db.ticket.count({ where: { ...REAL, reopenCount: { gt: 0 } } }),
    ])

    // ── Agent FRT (P50/P90) + SLA compliance ──────────────────────────────────
    // Raw SQL: clock start = escalation time if bot escalated, else ticket.createdAt
    // First qualifying agent reply = REPLY, not internal, agent-authored, not bot
    const frtRaw = await this.db.$queryRaw<{ ticket_id: string; frt_hours: number }[]>`
      WITH first_reply AS (
        SELECT m."ticketId" as ticket_id,
               MIN(m."createdAt") as replied_at
        FROM "Message" m
        WHERE m.type = 'REPLY'
          AND m."isInternal" = false
          AND m."authorAgentId" IS NOT NULL
          AND m."authorBotName" IS NULL
          AND m."deletedAt" IS NULL
        GROUP BY m."ticketId"
      ),
      escalations AS (
        SELECT b."ticketId" as ticket_id,
               MIN(b."createdAt") as escalated_at
        FROM "BotInteraction" b
        WHERE b."didAnswer" = false
        GROUP BY b."ticketId"
      )
      SELECT t.id as ticket_id,
             EXTRACT(EPOCH FROM (fr.replied_at - COALESCE(e.escalated_at, t."createdAt"))) / 3600.0 as frt_hours
      FROM "Ticket" t
      JOIN first_reply fr ON fr.ticket_id = t.id
      LEFT JOIN escalations e ON e.ticket_id = t.id
      WHERE t."deletedAt" IS NULL
        AND t."isTicket" = true
        AND t."createdAt" >= ${thirtyDaysAgo}
        AND fr.replied_at > COALESCE(e.escalated_at, t."createdAt")
    `

    const frtValues = frtRaw
      .map((r) => Number(r.frt_hours))
      .filter((h) => h >= 0)
      .sort((a, b) => a - b)

    const frtP50 = percentile(frtValues, 0.5)
    const frtP90 = percentile(frtValues, 0.9)
    const slaCompliantCount = frtValues.filter((h) => h <= slaHours).length
    const slaCompliancePct = frtValues.length > 0
      ? Math.round((slaCompliantCount / frtValues.length) * 100)
      : null

    // ── Resolution time (P50 / P90) from firstResolvedAt ─────────────────────
    const resTimes = resolvedForTime
      .map((t) => (t.firstResolvedAt!.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60))
      .filter((h) => h >= 0)
      .sort((a, b) => a - b)

    const resP50 = percentile(resTimes, 0.5)
    const resP90 = percentile(resTimes, 0.9)

    // ── Triage metrics ────────────────────────────────────────────────────────
    const oldestNewAgeHours = oldestNew
      ? Math.round((now.getTime() - oldestNew.createdAt.getTime()) / (1000 * 60 * 60) * 10) / 10
      : null

    const triageTimes = timeToTriageRaw
      .filter((t) => t.convertedAt)
      .map((t) => (t.convertedAt!.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60))
      .filter((h) => h >= 0)
      .sort((a, b) => a - b)

    const timeToTriageMedianHours = percentile(triageTimes, 0.5)

    // ── Bot deflection ────────────────────────────────────────────────────────
    const botAnswered = botStats.find((r) => r.didAnswer)?._count.id ?? 0
    const botEscalated = botStats.find((r) => !r.didAnswer)?._count.id ?? 0
    const botInteractions = botAnswered + botEscalated
    const deflectionRate = botInteractions > 0
      ? Math.round((botAnswered / botInteractions) * 100)
      : null

    // ── Reopen rate ───────────────────────────────────────────────────────────
    const reopenRate = resolvedTickets > 0
      ? Math.round((reopenCount / resolvedTickets) * 100)
      : 0

    // ── Created vs Resolved (30d, gap-filled) ─────────────────────────────────
    const createdMap = new Map<string, number>()
    for (const row of createdRaw) {
      createdMap.set(row.date.toISOString().slice(0, 10), Number(row.count))
    }
    const resolvedMap = new Map<string, number>()
    for (const row of resolvedRaw) {
      resolvedMap.set(row.date.toISOString().slice(0, 10), Number(row.count))
    }
    const createdVsResolved: { date: string; created: number; resolved: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const dateStr = d.toISOString().slice(0, 10)
      createdVsResolved.push({
        date: dateStr,
        created: createdMap.get(dateStr) ?? 0,
        resolved: resolvedMap.get(dateStr) ?? 0,
      })
    }

    // ── Agent performance ─────────────────────────────────────────────────────
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
        resolutionTimeP50: resP50,
        resolutionTimeP90: resP90,
        frtP50,
        frtP90,
        slaCompliancePct,
        newThisWeek,
        newLastWeek,
        weekOverWeekPct,
        unassigned,
        reopenRate,
      },
      triage: {
        newBacklog: newBacklogCount,
        oldestNewAgeHours,
        timeToTriageMedianHours,
      },
      bot: {
        enabled: botEnabled,
        deflectionRate,
        escalated: botEscalated,
        interactions: botInteractions,
      },
      createdVsResolved,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count.id])) as Record<string, number>,
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count.id])) as Record<string, number>,
      byPriority: Object.fromEntries(byPriority.map((r) => [r.priority, r._count.id])) as Record<string, number>,
      byField1: field1Groups
        .filter((r) => r.field1)
        .map((r) => ({ value: r.field1 as string, count: r._count.id })),
      byField2: field2Groups
        .filter((r) => r.field2)
        .map((r) => ({ value: r.field2 as string, count: r._count.id })),
      agentPerformance,
    }
  }
}
