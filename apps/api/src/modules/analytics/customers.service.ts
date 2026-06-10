import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { formatRef } from '../tickets/util/generate-ref'

@Injectable()
export class CustomersService {
  constructor(private readonly db: PrismaService) {}

  async getCustomerInsights() {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const [
      sentimentStats,
      csatUserStats,
      csatAiStats,
      reopenStats,
      topTopicsRaw,
      topicsLastWeek,
      topicsPrevWeek,
      frictionByField2,
      sentimentTrendRaw,
      categoryMixRaw,
      convoDepthRaw,
      usersWithTickets,
      churnCount30d,
      advocacyCount30d,
      recentChurnSignals,
      recentAdvocacySignals,
      effortStats,
      effortDistribution,
      effortScatterRaw,
      churnSignalsByUser90d,
      advocacySignalsByUser90d,
      sentimentByLabelRaw,
      topicTrendRaw,
    ] = await this.db.$transaction([
      // Avg sentiment last 30d
      this.db.message.aggregate({
        where: { sentimentScore: { not: null }, createdAt: { gte: thirtyDaysAgo }, deletedAt: null },
        _avg: { sentimentScore: true },
        _count: { sentimentScore: true },
      }),

      // CSAT user avg
      this.db.ticketRating.aggregate({
        where: { userRating: { not: null } },
        _avg: { userRating: true },
        _count: { userRating: true },
      }),

      // CSAT AI avg
      this.db.ticketRating.aggregate({
        where: { aiRating: { not: null } },
        _avg: { aiRating: true },
        _count: { aiRating: true },
      }),

      // Reopen stats
      this.db.ticket.aggregate({
        where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } },
        _count: { id: true },
        _sum: { reopenCount: true },
      }),

      // Top topics with avg sentiment computed in SQL — the previous version pulled
      // every ticket and every scored message for the top 10 topics into Node just to
      // average one number per topic; a single GROUP BY + AVG does it in the database.
      this.db.$queryRaw<{ id: string; name: string; ticketCount: number; avgSentiment: number | null }[]>`
        SELECT
          top.id,
          top.name,
          top."ticketCount",
          AVG(m."sentimentScore") AS "avgSentiment"
        FROM "Topic" top
        LEFT JOIN "Ticket" t ON t."topicId" = top.id AND t."deletedAt" IS NULL
        LEFT JOIN "Message" m ON m."ticketId" = t.id AND m."deletedAt" IS NULL AND m."sentimentScore" IS NOT NULL
        GROUP BY top.id, top.name, top."ticketCount"
        ORDER BY top."ticketCount" DESC
        LIMIT 10
      `,

      // Topic ticket count this week
      this.db.ticket.groupBy({
        by: ['topicId'],
        where: { deletedAt: null, topicId: { not: null }, createdAt: { gte: sevenDaysAgo } },
        _count: { id: true },
        orderBy: { topicId: 'asc' },
      }),

      // Topic ticket count previous week
      this.db.ticket.groupBy({
        by: ['topicId'],
        where: {
          deletedAt: null,
          topicId: { not: null },
          createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
        },
        _count: { id: true },
        orderBy: { topicId: 'asc' },
      }),

      // Friction by field2 (BUG_REPORT only)
      this.db.ticket.groupBy({
        by: ['field2'],
        where: { deletedAt: null, category: 'BUG_REPORT', field2: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 15,
      }),

      // Sentiment trend raw
      this.db.$queryRaw<{ date: Date; avgScore: number; msgCount: bigint }[]>`
        SELECT
          DATE_TRUNC('day', m."createdAt") as date,
          AVG(m."sentimentScore") as "avgScore",
          COUNT(*)::bigint as "msgCount"
        FROM "Message" m
        WHERE m."sentimentScore" IS NOT NULL
          AND m."deletedAt" IS NULL
          AND m."createdAt" >= ${thirtyDaysAgo}
        GROUP BY 1
        ORDER BY 1
      `,

      // Category mix over 90 days
      this.db.$queryRaw<{ date: Date; category: string; count: bigint }[]>`
        SELECT
          DATE_TRUNC('day', "createdAt") as date,
          category,
          COUNT(*)::bigint as count
        FROM "Ticket"
        WHERE "deletedAt" IS NULL
          AND "createdAt" >= ${ninetyDaysAgo}
        GROUP BY 1, 2
        ORDER BY 1
      `,

      // Avg conversation depth by category
      this.db.$queryRaw<{ category: string; avgDepth: number }[]>`
        SELECT
          t.category,
          AVG(msg_counts.cnt) as "avgDepth"
        FROM "Ticket" t
        JOIN (
          SELECT "ticketId", COUNT(*) as cnt
          FROM "Message"
          WHERE type = 'REPLY' AND "isInternal" = false AND "deletedAt" IS NULL
          GROUP BY "ticketId"
        ) msg_counts ON msg_counts."ticketId" = t.id
        WHERE t."deletedAt" IS NULL
        GROUP BY t.category
      `,

      // Users with tickets for health score
      this.db.user.findMany({
        where: { isGuest: false },
        select: {
          id: true,
          name: true,
          email: true,
          lastActiveAt: true,
          tickets: {
            where: { deletedAt: null },
            select: {
              id: true,
              status: true,
              priority: true,
              createdAt: true,
              reopenCount: true,
              messages: {
                where: { sentimentScore: { not: null }, authorUserId: { not: null }, deletedAt: null },
                select: { sentimentScore: true },
              },
            },
          },
        },
        take: 500,
      }),

      // Churn signal count 30d
      this.db.customerSignal.count({
        where: { type: 'CHURN_RISK', createdAt: { gte: thirtyDaysAgo } },
      }),

      // Advocacy signal count 30d
      this.db.customerSignal.count({
        where: { type: 'ADVOCACY', createdAt: { gte: thirtyDaysAgo } },
      }),

      // Recent churn signals (10) with user + ticket
      this.db.customerSignal.findMany({
        where: { type: 'CHURN_RISK' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          quote: true,
          reason: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          ticket: { select: { ref: true, title: true } },
        },
      }),

      // Recent advocacy signals (10) with user + ticket
      this.db.customerSignal.findMany({
        where: { type: 'ADVOCACY' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          quote: true,
          reason: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          ticket: { select: { ref: true, title: true } },
        },
      }),

      // Effort avg 30d
      this.db.ticketRating.aggregate({
        where: { aiEffortScore: { not: null }, createdAt: { gte: thirtyDaysAgo } },
        _avg: { aiEffortScore: true },
      }),

      // Effort distribution (group by score)
      this.db.ticketRating.groupBy({
        by: ['aiEffortScore'],
        where: { aiEffortScore: { not: null } },
        _count: { aiEffortScore: true },
        orderBy: { aiEffortScore: 'asc' },
      }),

      // Effort × CSAT scatter
      this.db.ticketRating.findMany({
        where: { aiEffortScore: { not: null }, aiRating: { not: null } },
        select: { ticketId: true, aiRating: true, aiEffortScore: true },
        take: 500,
      }),

      // Churn signal count per user 90d (for health score)
      this.db.customerSignal.groupBy({
        by: ['userId'],
        where: { type: 'CHURN_RISK', createdAt: { gte: ninetyDaysAgo } },
        _count: { id: true },
        orderBy: { userId: 'asc' },
      }),

      // Advocacy signal count per user 90d (for health score)
      this.db.customerSignal.groupBy({
        by: ['userId'],
        where: { type: 'ADVOCACY', createdAt: { gte: ninetyDaysAgo } },
        _count: { id: true },
        orderBy: { userId: 'asc' },
      }),

      // Sentiment label breakdown 30d
      this.db.message.groupBy({
        by: ['sentimentLabel'],
        where: { sentimentLabel: { not: null }, createdAt: { gte: thirtyDaysAgo }, deletedAt: null },
        _count: { sentimentLabel: true },
        orderBy: { sentimentLabel: 'asc' },
      }),

      // Per-topic daily ticket counts (top 8, last 30d)
      this.db.$queryRaw<{ topicId: string; topicName: string; date: Date; count: bigint }[]>`
        SELECT
          t."topicId",
          top.name AS "topicName",
          DATE_TRUNC('day', t."createdAt") AS date,
          COUNT(*)::bigint AS count
        FROM "Ticket" t
        JOIN "Topic" top ON top.id = t."topicId"
        WHERE t."deletedAt" IS NULL
          AND t."topicId" IS NOT NULL
          AND t."createdAt" >= ${thirtyDaysAgo}
        GROUP BY 1, 2, 3
        ORDER BY 3, 1
      `,
    ])

    // ── Reopen rate ──
    const totalTickets30d = reopenStats._count.id
    const totalReopened = reopenStats._sum.reopenCount ?? 0
    const reopenRatePct =
      totalTickets30d > 0 ? Math.round((Number(totalReopened) / totalTickets30d) * 100) : 0

    // ── Top topics with sentiment + WoW delta ──
    const thisWeekMap = new Map(
      topicsLastWeek.map((r) => [r.topicId, (r._count as Record<string, number>)['id'] ?? 0]),
    )
    const prevWeekMap = new Map(
      topicsPrevWeek.map((r) => [r.topicId, (r._count as Record<string, number>)['id'] ?? 0]),
    )

    const topTopics = topTopicsRaw.map((topic) => {
      const avgSentiment = topic.avgSentiment !== null ? Number(topic.avgSentiment) : null
      const thisWeek = thisWeekMap.get(topic.id) ?? 0
      const prevWeek = prevWeekMap.get(topic.id) ?? 0
      const deltaWoW =
        prevWeek === 0 ? null : Math.round(((thisWeek - prevWeek) / prevWeek) * 100)
      return {
        topicId: topic.id,
        name: topic.name,
        ticketCount: topic.ticketCount,
        avgSentiment: avgSentiment !== null ? Math.round(avgSentiment * 100) / 100 : null,
        deltaWoW,
      }
    })

    // ── Emerging topics ──
    const emergingTopics = topTopics
      .filter((t) => t.deltaWoW !== null && t.deltaWoW > 0)
      .sort((a, b) => (b.deltaWoW ?? 0) - (a.deltaWoW ?? 0))
      .slice(0, 5)

    // ── Sentiment trend (gap-fill 30 days) ──
    const sentimentMap = new Map<string, { avgScore: number; msgCount: number }>()
    for (const row of sentimentTrendRaw) {
      sentimentMap.set(row.date.toISOString().slice(0, 10), {
        avgScore: Math.round(Number(row.avgScore) * 100) / 100,
        msgCount: Number(row.msgCount),
      })
    }
    const sentimentTrend = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000)
      const dateStr = d.toISOString().slice(0, 10)
      const data = sentimentMap.get(dateStr)
      return { date: dateStr, avgScore: data?.avgScore ?? null, msgCount: data?.msgCount ?? 0 }
    })

    // ── Category mix (gap-fill 90 days) ──
    const categories = ['BUG_REPORT', 'FEATURE_REQUEST', 'QUESTION', 'BILLING', 'OTHER']
    const catMixMap = new Map<string, Record<string, number>>()
    for (const row of categoryMixRaw) {
      const dateStr = row.date.toISOString().slice(0, 10)
      if (!catMixMap.has(dateStr)) catMixMap.set(dateStr, {})
      catMixMap.get(dateStr)![row.category] = Number(row.count)
    }
    const categoryMixOverTime = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(now.getTime() - (89 - i) * 24 * 60 * 60 * 1000)
      const dateStr = d.toISOString().slice(0, 10)
      const cats = catMixMap.get(dateStr) ?? {}
      return {
        date: dateStr,
        ...Object.fromEntries(categories.map((c) => [c, cats[c] ?? 0])),
      }
    })

    // ── Build per-user signal maps for health score ──
    const churnByUser = new Map(
      churnSignalsByUser90d.map((r) => [
        r.userId,
        (r._count as Record<string, number>)['id'] ?? 0,
      ]),
    )
    const advocacyByUser = new Map(
      advocacySignalsByUser90d.map((r) => [
        r.userId,
        (r._count as Record<string, number>)['id'] ?? 0,
      ]),
    )

    // ── Health score calculation ──
    const healthScores = usersWithTickets
      .filter((u) => u.tickets.length > 0)
      .map((u) => {
        const scores = u.tickets.flatMap((t) => t.messages.map((m) => m.sentimentScore ?? 0))
        const avgSentiment = scores.length
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : null
        const urgentCount30d = u.tickets.filter(
          (t) => t.priority === 'URGENT' && new Date(t.createdAt) >= thirtyDaysAgo,
        ).length
        const openCount = u.tickets.filter((t) =>
          ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status),
        ).length
        const reopens = u.tickets.reduce((sum, t) => sum + t.reopenCount, 0)
        const resolvedCount = u.tickets.filter((t) =>
          ['RESOLVED', 'CLOSED'].includes(t.status),
        ).length

        // Use lastActiveAt if set; fall back to most recent ticket date for email-imported users
        const lastActive =
          u.lastActiveAt
            ? new Date(u.lastActiveAt)
            : u.tickets.reduce<Date | null>((latest, t) => {
                const d = new Date(t.createdAt)
                return latest === null || d > latest ? d : latest
              }, null)
        const daysSinceLast = lastActive
          ? (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24)
          : 90

        const churnSignalCount90d = churnByUser.get(u.id) ?? 0
        const advocacySignalCount90d = advocacyByUser.get(u.id) ?? 0

        const score =
          (avgSentiment ?? 0) * 40 -
          urgentCount30d * 15 -
          openCount * 10 -
          reopens * 5 +
          resolvedCount * 2 -
          daysSinceLast / 7 -
          churnSignalCount90d * 25 +
          advocacySignalCount90d * 10

        return {
          userId: u.id,
          name: u.name ?? u.email.split('@')[0],
          email: u.email,
          score: Math.round(score * 10) / 10,
          avgSentiment: avgSentiment !== null ? Math.round(avgSentiment * 100) / 100 : null,
          urgentCount: urgentCount30d,
          openCount,
          lastActiveAt: u.lastActiveAt,
          totalTickets: u.tickets.length,
          churnSignals90d: churnSignalCount90d,
        }
      })
      .sort((a, b) => a.score - b.score)

    const atRiskCount = healthScores.filter((h) => h.score < 0).length

    // ── Signals block ──
    const signals = {
      churnCount30d,
      advocacyCount30d,
      recentChurn: recentChurnSignals.map((s) => ({
        id: s.id,
        quote: s.quote,
        reason: s.reason,
        customerName: s.user.name ?? s.user.email.split('@')[0],
        customerEmail: s.user.email,
        ticketRef: formatRef(s.ticket.ref),
        ticketTitle: s.ticket.title,
        createdAt: s.createdAt,
      })),
      recentAdvocacy: recentAdvocacySignals.map((s) => ({
        id: s.id,
        quote: s.quote,
        reason: s.reason,
        customerName: s.user.name ?? s.user.email.split('@')[0],
        customerEmail: s.user.email,
        ticketRef: formatRef(s.ticket.ref),
        ticketTitle: s.ticket.title,
        createdAt: s.createdAt,
      })),
    }

    // ── Effort block ──
    const effort = {
      avgScore30d:
        effortStats._avg.aiEffortScore !== null
          ? Math.round((effortStats._avg.aiEffortScore ?? 0) * 10) / 10
          : null,
      distribution: effortDistribution
        .filter((r) => r.aiEffortScore !== null)
        .map((r) => ({
          score: r.aiEffortScore as number,
          count: (r._count as Record<string, number>)['aiEffortScore'] ?? 0,
        })),
      scatterVsCsat: effortScatterRaw.map((r) => ({
        ticketId: r.ticketId,
        csat: r.aiRating as number,
        effort: r.aiEffortScore as number,
      })),
    }

    // ── Sentiment by label breakdown ──
    const sentimentByLabel = (['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const).map((label) => {
      const row = sentimentByLabelRaw.find((r) => r.sentimentLabel === label)
      return { label, count: (row?._count as Record<string, number> | undefined)?.['sentimentLabel'] ?? 0 }
    })
    const totalAnalyzed = sentimentByLabel.reduce((s, r) => s + r.count, 0)

    // ── Topic trend (per-topic daily counts, top 8) ──
    const top8Topics = topTopicsRaw.slice(0, 8).map((t) => ({ id: t.id, name: t.name, ticketCount: t.ticketCount }))
    const top8Ids = top8Topics.map((t) => t.id)
    const topicDayMap = new Map<string, Map<string, number>>()
    for (const row of topicTrendRaw) {
      if (!top8Ids.includes(row.topicId)) continue
      if (!topicDayMap.has(row.topicId)) topicDayMap.set(row.topicId, new Map())
      topicDayMap.get(row.topicId)!.set(row.date.toISOString().slice(0, 10), Number(row.count))
    }
    const topicTrend = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000)
      const dateStr = d.toISOString().slice(0, 10)
      const row: Record<string, unknown> = { date: dateStr }
      for (const id of top8Ids) row[id] = topicDayMap.get(id)?.get(dateStr) ?? 0
      return row
    }) as ({ date: string } & Record<string, number>)[]

    return {
      kpis: {
        avgSentiment30d:
          sentimentStats._avg.sentimentScore !== null
            ? Math.round((sentimentStats._avg.sentimentScore ?? 0) * 100) / 100
            : null,
        csatUser:
          csatUserStats._avg.userRating !== null
            ? Math.round((csatUserStats._avg.userRating ?? 0) * 10) / 10
            : null,
        csatAI:
          csatAiStats._avg.aiRating !== null
            ? Math.round((csatAiStats._avg.aiRating ?? 0) * 10) / 10
            : null,
        atRiskCount,
        reopenRatePct,
        churnSignalsCount30d: churnCount30d,
      },
      sentimentTrend,
      sentimentByLabel,
      totalAnalyzed,
      topTopics,
      topicTrend,
      topicMeta: top8Topics,
      emergingTopics,
      signals,
      effort,
      frictionByField2: frictionByField2
        .filter((r) => r.field2)
        .map((r) => ({
          value: r.field2 as string,
          count: (r._count as Record<string, number>)['id'] ?? 0,
        })),
      categoryMixOverTime,
      convoDepthByCategory: convoDepthRaw.map((r) => ({
        category: r.category,
        avgDepth: Math.round(Number(r.avgDepth) * 10) / 10,
      })),
    }
  }
}
