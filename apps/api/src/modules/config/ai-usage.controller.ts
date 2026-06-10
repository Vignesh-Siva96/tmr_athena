import { Controller, Get, UseGuards } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { AdminGuard } from '../../common/guards/admin.guard'

@Controller('settings/ai-usage')
@UseGuards(AuthGuard, AgentGuard, AdminGuard)
export class AiUsageController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async getAiUsage() {

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [todayStats, last30dStats, byOperation, recentErrors, dailyTrendRaw] =
      await this.db.$transaction([
        // Today
        this.db.aiUsage.aggregate({
          where: { createdAt: { gte: todayStart } },
          _count: { id: true },
          _sum: { totalTokens: true, estimatedCostUsd: true },
        }),

        // Last 30d
        this.db.aiUsage.aggregate({
          where: { createdAt: { gte: thirtyDaysAgo } },
          _count: { id: true },
          _sum: { totalTokens: true, estimatedCostUsd: true },
        }),

        // By operation
        this.db.aiUsage.groupBy({
          by: ['operation'],
          where: { createdAt: { gte: thirtyDaysAgo } },
          _count: { id: true },
          _sum: { totalTokens: true, estimatedCostUsd: true },
          orderBy: { operation: 'asc' },
        }),

        // Recent errors
        this.db.aiUsage.findMany({
          where: { status: 'ERROR' },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            createdAt: true,
            operation: true,
            errorMessage: true,
            ticketId: true,
            messageId: true,
          },
        }),

        // Daily trend (30 days, raw SQL)
        this.db.$queryRaw<{ date: Date; costUsd: string; calls: bigint }[]>`
          SELECT
            DATE_TRUNC('day', "createdAt") as date,
            SUM("estimatedCostUsd")::text as "costUsd",
            COUNT(*)::bigint as calls
          FROM "AiUsage"
          WHERE "createdAt" >= ${thirtyDaysAgo}
          GROUP BY 1
          ORDER BY 1
        `,
      ])

    // Error rate last 30d
    const totalCalls = last30dStats._count.id
    const errorCalls = await this.db.aiUsage.count({
      where: { createdAt: { gte: thirtyDaysAgo }, status: 'ERROR' },
    })
    const errorRate = totalCalls > 0 ? Math.round((errorCalls / totalCalls) * 100 * 10) / 10 : 0

    // Gap-fill daily trend
    const trendMap = new Map<string, { costUsd: number; calls: number }>()
    for (const row of dailyTrendRaw) {
      trendMap.set(row.date.toISOString().slice(0, 10), {
        costUsd: parseFloat(row.costUsd),
        calls: Number(row.calls),
      })
    }
    const dailyTrend = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000)
      const dateStr = d.toISOString().slice(0, 10)
      const data = trendMap.get(dateStr)
      return { day: dateStr, costUsd: data?.costUsd ?? 0, calls: data?.calls ?? 0 }
    })

    return {
      today: {
        calls: todayStats._count.id,
        totalTokens: todayStats._sum.totalTokens ?? 0,
        costUsd: Number(todayStats._sum.estimatedCostUsd ?? 0),
      },
      last30d: {
        calls: totalCalls,
        totalTokens: last30dStats._sum.totalTokens ?? 0,
        costUsd: Number(last30dStats._sum.estimatedCostUsd ?? 0),
        errorRate,
      },
      byOperation: byOperation.map(r => ({
        operation: r.operation,
        calls: (r._count as Record<string, number>)['id'] ?? 0,
        tokens: (r._sum as Record<string, unknown>)['totalTokens'] as number ?? 0,
        costUsd: Number((r._sum as Record<string, unknown>)['estimatedCostUsd'] ?? 0),
      })),
      dailyTrend,
      recentErrors,
    }
  }
}
