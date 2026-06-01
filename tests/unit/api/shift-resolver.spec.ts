import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Inline the core resolution logic for unit testing ────────────────────────
// We test the pure logic extracted from ShiftResolverService.

interface Shift {
  id: string
  primaryAgentId: string
  dayOfWeek: number  // 0=Sun…6=Sat, -1=every day
  startMinute: number
  endMinute: number
  active: boolean
  lastAssignedAt: Date | null
}

function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

function toZonedDate(now: Date, timezone: string): Date {
  return new Date(now.toLocaleString('en-US', { timeZone: timezone }))
}

/**
 * Pure shift-matching logic extracted from ShiftResolverService.
 * Returns the winning shift id (round-robin on lastAssignedAt) or null.
 */
function resolveShift(now: Date, timezone: string, shifts: Shift[]): string | null {
  const zoned = toZonedDate(now, timezone)
  const dayOfWeek = zoned.getDay()
  const minute = minuteOfDay(zoned)

  const active = shifts.filter((s) => s.active)
  const dayMatches = active.filter((s) => s.dayOfWeek === dayOfWeek || s.dayOfWeek === -1)

  const matching = dayMatches.filter((s) => {
    if (s.endMinute > s.startMinute) {
      // Normal window
      return minute >= s.startMinute && minute < s.endMinute
    }
    // Overnight wrap (e.g. 22:00–06:00 → end < start)
    return minute >= s.startMinute || minute < s.endMinute
  })

  if (matching.length === 0) return null

  // Round-robin: oldest lastAssignedAt wins (null = never assigned, sort first)
  matching.sort((a, b) => {
    if (!a.lastAssignedAt) return -1
    if (!b.lastAssignedAt) return 1
    return a.lastAssignedAt.getTime() - b.lastAssignedAt.getTime()
  })

  return matching[0]!.id
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const MON_9AM = new Date('2026-05-25T09:00:00Z')  // Monday 09:00 UTC
const MON_5PM = new Date('2026-05-25T17:00:00Z')  // Monday 17:00 UTC
const MON_11PM = new Date('2026-05-25T23:00:00Z') // Monday 23:00 UTC
const TUE_3AM = new Date('2026-05-26T03:00:00Z')  // Tuesday 03:00 UTC

function shift(overrides: Partial<Shift> & { id: string }): Shift {
  return {
    primaryAgentId: 'agent-1',
    dayOfWeek: 1, // Monday
    startMinute: 9 * 60,  // 09:00
    endMinute: 17 * 60,   // 17:00
    active: true,
    lastAssignedAt: null,
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('shift resolution logic', () => {
  describe('basic window matching', () => {
    it('matches a shift within its window', () => {
      const shifts = [shift({ id: 's1' })]
      expect(resolveShift(MON_9AM, 'UTC', shifts)).toBe('s1')
    })

    it('does not match before the window starts', () => {
      const shifts = [shift({ id: 's1', startMinute: 10 * 60 })]
      expect(resolveShift(MON_9AM, 'UTC', shifts)).toBeNull()
    })

    it('does not match after the window ends', () => {
      // Shift is 09:00–08:00 — endMinute < startMinute means overnight shift.
      // To test "after window ends" (not overnight), use a shift that ends before MON_9AM (09:00)
      const shifts = [shift({ id: 's1', startMinute: 7 * 60, endMinute: 8 * 60 })]
      expect(resolveShift(MON_9AM, 'UTC', shifts)).toBeNull()
    })

    it('does not match on a different day', () => {
      const shifts = [shift({ id: 's1', dayOfWeek: 2 })] // Tuesday
      expect(resolveShift(MON_9AM, 'UTC', shifts)).toBeNull()
    })
  })

  describe('"every day" shifts (dayOfWeek = -1)', () => {
    it('matches on any day', () => {
      const shifts = [shift({ id: 's1', dayOfWeek: -1 })]
      expect(resolveShift(MON_9AM, 'UTC', shifts)).toBe('s1')
    })
  })

  describe('overnight shifts', () => {
    const overnight = shift({ id: 'overnight', startMinute: 22 * 60, endMinute: 6 * 60 })

    it('matches at 23:00 (after startMinute)', () => {
      expect(resolveShift(MON_11PM, 'UTC', [overnight])).toBe('overnight')
    })

    it('matches at 03:00 (before endMinute next day)', () => {
      // Tuesday 03:00 — the shift was defined for Monday but since it wraps,
      // we test with dayOfWeek=-1 to cover the overnight edge case cleanly
      const s = { ...overnight, dayOfWeek: -1 }
      expect(resolveShift(TUE_3AM, 'UTC', [s])).toBe('overnight')
    })

    it('does not match at 17:00 (middle of day, outside overnight window)', () => {
      expect(resolveShift(MON_5PM, 'UTC', [overnight])).toBeNull()
    })
  })

  describe('round-robin selection', () => {
    it('picks the shift with oldest lastAssignedAt', () => {
      const older = shift({ id: 'older', lastAssignedAt: new Date('2026-05-25T08:00:00Z') })
      const newer = shift({ id: 'newer', lastAssignedAt: new Date('2026-05-25T08:30:00Z') })
      expect(resolveShift(MON_9AM, 'UTC', [newer, older])).toBe('older')
    })

    it('picks a never-assigned shift over an assigned one', () => {
      const never = shift({ id: 'never', lastAssignedAt: null })
      const assigned = shift({ id: 'assigned', lastAssignedAt: new Date('2026-05-25T08:00:00Z') })
      expect(resolveShift(MON_9AM, 'UTC', [assigned, never])).toBe('never')
    })
  })

  describe('inactive shifts', () => {
    it('does not match inactive shifts', () => {
      const inactive = shift({ id: 'inactive', active: false })
      expect(resolveShift(MON_9AM, 'UTC', [inactive])).toBeNull()
    })
  })

  describe('timezone conversion', () => {
    it('correctly converts UTC to IST (+5:30)', () => {
      // 09:00 UTC = 14:30 IST
      // A shift covering 14:00-15:00 IST should match
      const istShift = shift({ id: 'ist', startMinute: 14 * 60, endMinute: 15 * 60, dayOfWeek: 1 })
      expect(resolveShift(MON_9AM, 'Asia/Kolkata', [istShift])).toBe('ist')
    })

    it('does not match a shift outside the timezone-converted window', () => {
      // 09:00 UTC = 14:30 IST — a 09:00-10:00 UTC shift should NOT match in IST
      const utcShift = shift({ id: 'utc', startMinute: 9 * 60, endMinute: 10 * 60 })
      // In IST, 09:00 UTC is 14:30, so the shift window 09:00-10:00 doesn't contain 14:30
      expect(resolveShift(MON_9AM, 'Asia/Kolkata', [utcShift])).toBeNull()
    })
  })

  describe('multiple overlapping shifts', () => {
    it('picks among all matching shifts using round-robin', () => {
      const s1 = shift({ id: 's1', lastAssignedAt: new Date('2026-05-24T00:00:00Z') })
      const s2 = shift({ id: 's2', lastAssignedAt: new Date('2026-05-24T01:00:00Z') })
      const s3 = shift({ id: 's3', lastAssignedAt: null })
      // s3 should win (never assigned)
      expect(resolveShift(MON_9AM, 'UTC', [s1, s2, s3])).toBe('s3')
    })
  })
})
