import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import type { Agent } from '@tmr/db'

@Injectable()
export class ShiftResolverService {
  private readonly logger = new Logger(ShiftResolverService.name)

  constructor(private readonly db: PrismaService) {}

  async currentPrimaryAgent(now: Date): Promise<Agent | null> {
    const config = await this.db.appConfig.findFirst({
      select: {
        timezone: true,
        botFallbackAgentId: true,
      },
    })

    const timezone = config?.timezone ?? 'UTC'

    // Convert now to org's local time
    const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    const dayOfWeek = localDate.getDay() // 0=Sun..6=Sat
    const minuteOfDay = localDate.getHours() * 60 + localDate.getMinutes()

    // Load all active shifts
    const shifts = await this.db.shift.findMany({
      where: { active: true },
      include: { primaryAgent: true },
    })

    // Filter shifts matching current day and time window
    const matchingShifts = shifts.filter((shift) => {
      const dayMatches = shift.dayOfWeek === -1 || shift.dayOfWeek === dayOfWeek

      if (!dayMatches) return false

      const { startMinute, endMinute } = shift
      if (endMinute >= startMinute) {
        // Normal window (e.g. 09:00–17:00)
        return minuteOfDay >= startMinute && minuteOfDay < endMinute
      } else {
        // Overnight wrap (e.g. 22:00–06:00)
        return minuteOfDay >= startMinute || minuteOfDay < endMinute
      }
    })

    if (matchingShifts.length > 0) {
      // Pick the shift whose agent was least recently assigned (oldest lastAssignedAt)
      matchingShifts.sort((a, b) => {
        const aTime = a.lastAssignedAt?.getTime() ?? 0
        const bTime = b.lastAssignedAt?.getTime() ?? 0
        return aTime - bTime
      })

      const chosen = matchingShifts[0]

      // Update lastAssignedAt to now for round-robin tracking
      await this.db.shift.update({
        where: { id: chosen.id },
        data: { lastAssignedAt: now },
      })

      return chosen.primaryAgent
    }

    // Gate 2: botFallbackAgentId from config
    if (config?.botFallbackAgentId) {
      const fallback = await this.db.agent.findUnique({
        where: { id: config.botFallbackAgentId },
      })
      if (fallback?.isActive) return fallback
    }

    // Gate 3: first active PRIMARY_AGENT
    const primaryAgent = await this.db.agent.findFirst({
      where: { role: 'PRIMARY_AGENT', isActive: true },
      orderBy: { createdAt: 'asc' },
    })
    if (primaryAgent) return primaryAgent

    // Gate 4: first active ADMIN
    const admin = await this.db.agent.findFirst({
      where: { role: 'ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
    })
    if (admin) return admin

    this.logger.error('ShiftResolver: no active agent found for escalation')
    return null
  }
}
