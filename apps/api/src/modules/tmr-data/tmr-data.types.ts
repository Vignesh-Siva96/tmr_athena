export interface TmrAccountSummary {
  accountId: string
  planName: string
  status: string
  coreDestination: string | null
  additionalDestinations: string[]
  billingFreq: string | null
}

export interface TmrTeamSummary {
  teamId: string
  name: string
  dataSources: number
  queries: number
  schedules: number
}

export interface TmrMetadata {
  accounts: TmrAccountSummary[]
  accountStatusCounts: Record<string, number>
  teams: TmrTeamSummary[]
}

// Raw shapes from the back-office API (only the fields we use)
interface RawAccount {
  accountId: string
  planName?: string
  planConfig?: {
    coreDestination?: string
    additionalDestinations?: string[]
  }
  billingFreq?: string
  subscription?: { status?: string }
}

interface RawTeam {
  teamId: string
  name?: string
}

interface RawItem {
  teamId?: string
}

export interface GetUserDetailsData {
  accounts?: RawAccount[]
  teams?: RawTeam[]
  dataSources?: RawItem[]
  queries?: RawItem[]
  schedules?: RawItem[]
}

export function reduceTmrDetails(data: GetUserDetailsData): TmrMetadata {
  const accounts: TmrAccountSummary[] = (data.accounts ?? []).map((a) => ({
    accountId: a.accountId,
    planName: a.planName ?? '',
    status: a.subscription?.status ?? '',
    coreDestination: a.planConfig?.coreDestination ?? null,
    additionalDestinations: a.planConfig?.additionalDestinations ?? [],
    billingFreq: a.billingFreq ?? null,
  }))

  const accountStatusCounts: Record<string, number> = {}
  for (const acc of accounts) {
    if (acc.status) {
      accountStatusCounts[acc.status] = (accountStatusCounts[acc.status] ?? 0) + 1
    }
  }

  const teamMap = new Map<string, { name: string; dataSources: number; queries: number; schedules: number }>()
  for (const t of data.teams ?? []) {
    teamMap.set(t.teamId, { name: t.name ?? t.teamId, dataSources: 0, queries: 0, schedules: 0 })
  }

  const countByTeam = (items: RawItem[], field: 'dataSources' | 'queries' | 'schedules') => {
    for (const item of items) {
      if (item.teamId) {
        const entry = teamMap.get(item.teamId)
        if (entry) entry[field]++
      }
    }
  }
  countByTeam(data.dataSources ?? [], 'dataSources')
  countByTeam(data.queries ?? [], 'queries')
  countByTeam(data.schedules ?? [], 'schedules')

  const teams: TmrTeamSummary[] = Array.from(teamMap.entries()).map(([teamId, v]) => ({
    teamId,
    name: v.name,
    dataSources: v.dataSources,
    queries: v.queries,
    schedules: v.schedules,
  }))

  return { accounts, accountStatusCounts, teams }
}
