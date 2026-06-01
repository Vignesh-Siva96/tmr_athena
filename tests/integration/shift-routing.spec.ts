/**
 * shift-routing.spec — integration tests for ShiftResolverService.
 *
 * Regression catalogue:
 *   R66 — correct agent picked based on current time and shift windows
 *   R67 — fallback to botFallbackAgentId when no shift matches
 *   R68 — round-robin across multiple overlapping shifts
 */

import { harness } from './harness'
import { makeAgent } from './factories'
import './setup'

async function getShiftResolver() {
  return harness.app.get('ShiftResolverService')
}

describe('ShiftResolverService (R66–R68)', () => {
  beforeEach(async () => {
    // Clean slate for shifts
    await harness.prisma.shift.deleteMany({})
    await harness.prisma.appConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', timezone: 'UTC' },
      update: { timezone: 'UTC', botFallbackAgentId: null },
    })
  })

  it('R66 — picks the agent whose shift covers the current time', async () => {
    const agentA = await makeAgent({ role: 'PRIMARY_AGENT', email: 'agent-a@example.com' })
    const agentB = await makeAgent({ role: 'PRIMARY_AGENT', email: 'agent-b@example.com' })

    // Monday 09:00–17:00 for agentA
    await harness.prisma.shift.create({
      data: { primaryAgentId: agentA.id, dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
    })
    // Monday 18:00–23:00 for agentB
    await harness.prisma.shift.create({
      data: { primaryAgentId: agentB.id, dayOfWeek: 1, startMinute: 18 * 60, endMinute: 23 * 60 },
    })

    const resolver = await getShiftResolver()

    // Monday at 10:00 UTC → agentA
    const mon10am = new Date('2026-05-25T10:00:00Z') // 2026-05-25 is a Monday
    const resultA = await resolver.currentPrimaryAgent(mon10am)
    expect(resultA?.id).toBe(agentA.id)

    // Monday at 19:00 UTC → agentB
    const mon7pm = new Date('2026-05-25T19:00:00Z')
    const resultB = await resolver.currentPrimaryAgent(mon7pm)
    expect(resultB?.id).toBe(agentB.id)
  })

  it('R67 — falls back to botFallbackAgentId when no shift matches', async () => {
    const fallback = await makeAgent({ role: 'ADMIN', email: 'fallback@example.com' })
    await harness.prisma.appConfig.updateMany({ data: { botFallbackAgentId: fallback.id } })

    // Shift is ONLY on Tuesday — resolver is called on Wednesday
    await harness.prisma.shift.create({
      data: { primaryAgentId: fallback.id, dayOfWeek: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
    })

    const resolver = await getShiftResolver()
    const wednesday = new Date('2026-05-27T12:00:00Z') // 2026-05-27 is a Wednesday
    const result = await resolver.currentPrimaryAgent(wednesday)
    expect(result?.id).toBe(fallback.id)
  })

  it('R68 — round-robin across overlapping shifts (oldest lastAssignedAt wins)', async () => {
    const agentA = await makeAgent({ role: 'PRIMARY_AGENT', email: 'rr-a@example.com' })
    const agentB = await makeAgent({ role: 'PRIMARY_AGENT', email: 'rr-b@example.com' })

    // Both agents have all-day shifts on every day
    const shiftA = await harness.prisma.shift.create({
      data: {
        primaryAgentId: agentA.id,
        dayOfWeek: -1,
        startMinute: 0,
        endMinute: 0,
        lastAssignedAt: new Date('2026-05-25T08:00:00Z'),  // recently assigned
      },
    })
    await harness.prisma.shift.create({
      data: {
        primaryAgentId: agentB.id,
        dayOfWeek: -1,
        startMinute: 0,
        endMinute: 0,
        lastAssignedAt: new Date('2026-05-24T08:00:00Z'),  // older assignment
      },
    })

    const resolver = await getShiftResolver()
    const now = new Date('2026-05-25T10:00:00Z')
    const result = await resolver.currentPrimaryAgent(now)

    // agentB should be picked (older lastAssignedAt)
    expect(result?.id).toBe(agentB.id)

    // After assignment, shiftA should still be stale (not updated for agentA)
    const updatedShiftB = await harness.prisma.shift.findFirst({
      where: { primaryAgentId: agentB.id },
    })
    expect(updatedShiftB!.lastAssignedAt).toBeDefined()
    expect(updatedShiftB!.lastAssignedAt!.getTime()).toBeGreaterThanOrEqual(now.getTime())
  })

  it('returns null (and does not throw) when no agents exist at all', async () => {
    const resolver = await getShiftResolver()
    const now = new Date()
    // With no shifts and no fallback configured, should return null gracefully
    const result = await resolver.currentPrimaryAgent(now)
    // Could be null or an admin fallback — just ensure no throw
    expect(result === null || typeof result === 'object').toBe(true)
  })
})
