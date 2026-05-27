export interface TicketWithUser {
  id: string
  updatedAt: string
  status: string
  user: { email: string; name?: string | null }
}

export interface DomainGroup<T extends TicketWithUser> {
  domain: string
  tickets: T[]
  openCount: number
  lastActivity: string
}

const ACTIVE_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'WAITING'])

export function buildDomainGroups<T extends TicketWithUser>(tickets: T[]): DomainGroup<T>[] {
  const map = new Map<string, T[]>()

  for (const ticket of tickets) {
    const domain = ticket.user.email.split('@')[1]?.toLowerCase() ?? 'unknown'
    const existing = map.get(domain)
    if (existing) { existing.push(ticket) } else { map.set(domain, [ticket]) }
  }

  const groups: DomainGroup<T>[] = []
  for (const [domain, domainTickets] of map) {
    const sorted = [...domainTickets].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    const openCount = sorted.filter((t) => ACTIVE_STATUSES.has(t.status)).length
    const lastActivity = sorted[0]!.updatedAt
    groups.push({ domain, tickets: sorted, openCount, lastActivity })
  }

  groups.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  return groups
}
