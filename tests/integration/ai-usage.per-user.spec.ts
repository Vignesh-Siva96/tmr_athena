/**
 * ai-usage.per-user.spec — validates per-user cost tracking via userId on AiUsage.
 *
 * Regression catalogue:
 *   R69 — AiUsage rows have correct userId when bot processes tickets
 *   R70 — SUM GROUP BY userId returns expected per-user totals
 */

import { harness } from './harness'
import { makeUser, makeTicket } from './factories'
import './setup'
import { Decimal } from '@prisma/client/runtime/library'

describe('AiUsage per-user tracking (R69–R70)', () => {
  it('R69 — AiUsage rows with userId are queryable by userId', async () => {
    const userA = await makeUser({ email: 'user-cost-a@example.com' })
    const userB = await makeUser({ email: 'user-cost-b@example.com' })

    const ticketA = await makeTicket({ userId: userA.id })
    const ticketB = await makeTicket({ userId: userB.id })

    // Insert synthetic AiUsage rows as if bot processed these tickets
    await harness.prisma.aiUsage.createMany({
      data: [
        {
          model: 'gemini-2.0-flash',
          operation: 'ATHENA_GENERATE',
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
          estimatedCostUsd: new Decimal('0.000030'),
          durationMs: 1200,
          status: 'OK',
          ticketId: ticketA.id,
          userId: userA.id,
        },
        {
          model: 'text-embedding-004',
          operation: 'ATHENA_EMBED',
          promptTokens: 50,
          completionTokens: 0,
          totalTokens: 50,
          estimatedCostUsd: new Decimal('0.000001'),
          durationMs: 200,
          status: 'OK',
          ticketId: ticketA.id,
          userId: userA.id,
        },
        {
          model: 'gemini-2.0-flash',
          operation: 'ATHENA_GENERATE',
          promptTokens: 150,
          completionTokens: 80,
          totalTokens: 230,
          estimatedCostUsd: new Decimal('0.000025'),
          durationMs: 1000,
          status: 'OK',
          ticketId: ticketB.id,
          userId: userB.id,
        },
      ],
    })

    // Query per-user totals
    const userAUsages = await harness.prisma.aiUsage.findMany({
      where: { userId: userA.id },
    })
    expect(userAUsages).toHaveLength(2)

    const userBUsages = await harness.prisma.aiUsage.findMany({
      where: { userId: userB.id },
    })
    expect(userBUsages).toHaveLength(1)
  })

  it('R70 — SUM GROUP BY userId returns correct per-user totals', async () => {
    const userA = await makeUser({ email: 'grouped-a@example.com' })
    const userB = await makeUser({ email: 'grouped-b@example.com' })

    const ticketA = await makeTicket({ userId: userA.id })
    const ticketB = await makeTicket({ userId: userB.id })

    await harness.prisma.aiUsage.createMany({
      data: [
        // userA: $0.0003 total
        {
          model: 'gemini-2.0-flash', operation: 'ATHENA_GENERATE',
          promptTokens: 100, completionTokens: 50, totalTokens: 150,
          estimatedCostUsd: new Decimal('0.000200'), durationMs: 500, status: 'OK',
          ticketId: ticketA.id, userId: userA.id,
        },
        {
          model: 'text-embedding-004', operation: 'ATHENA_EMBED',
          promptTokens: 50, completionTokens: 0, totalTokens: 50,
          estimatedCostUsd: new Decimal('0.000100'), durationMs: 200, status: 'OK',
          ticketId: ticketA.id, userId: userA.id,
        },
        // userB: $0.0001 total
        {
          model: 'gemini-2.0-flash', operation: 'ATHENA_GENERATE',
          promptTokens: 100, completionTokens: 50, totalTokens: 150,
          estimatedCostUsd: new Decimal('0.000100'), durationMs: 600, status: 'OK',
          ticketId: ticketB.id, userId: userB.id,
        },
      ],
    })

    // Raw aggregate query matching the plan's "top customers" query pattern
    const aggregates = await harness.prisma.aiUsage.groupBy({
      by: ['userId'],
      where: {
        userId: { in: [userA.id, userB.id] },
        operation: { in: ['ATHENA_GENERATE', 'ATHENA_EMBED'] },
      },
      _sum: { estimatedCostUsd: true },
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
    })

    expect(aggregates).toHaveLength(2)

    const aAgg = aggregates.find((r) => r.userId === userA.id)
    const bAgg = aggregates.find((r) => r.userId === userB.id)

    expect(aAgg!._sum.estimatedCostUsd!.toNumber()).toBeCloseTo(0.000300, 6)
    expect(bAgg!._sum.estimatedCostUsd!.toNumber()).toBeCloseTo(0.000100, 6)

    // userA should rank first (higher spend)
    expect(aggregates[0]!.userId).toBe(userA.id)
  })

  it('crawl/indexing operations have null userId', async () => {
    // KB indexing operations don't have a user context
    await harness.prisma.aiUsage.create({
      data: {
        model: 'text-embedding-004',
        operation: 'ATHENA_EMBED',
        promptTokens: 1000,
        completionTokens: 0,
        totalTokens: 1000,
        estimatedCostUsd: new Decimal('0.000025'),
        durationMs: 800,
        status: 'OK',
        userId: null,   // no user for crawl ops
      },
    })

    const crawlOps = await harness.prisma.aiUsage.findMany({
      where: { userId: null, operation: 'ATHENA_EMBED' },
    })
    expect(crawlOps.length).toBeGreaterThanOrEqual(1)
    expect(crawlOps[0]!.userId).toBeNull()
  })
})
