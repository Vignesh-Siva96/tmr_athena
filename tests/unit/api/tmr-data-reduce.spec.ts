/**
 * Unit tests for reduceTmrDetails — pure TMR metadata reduction function.
 *
 * Regression catalogue:
 *   R220 — reduceTmrDetails: single in_trial account → correct status counts and team stats
 *   R221 — reduceTmrDetails: cancelled account + empty arrays → zero team counts, no throw
 *   R222 — TMR fuzzy search email match: exact case-insensitive match accepted; near-match rejected
 */

import { describe, it, expect } from 'vitest'
import { reduceTmrDetails } from '../../../apps/api/src/modules/tmr-data/tmr-data.types'
import type { GetUserDetailsData } from '../../../apps/api/src/modules/tmr-data/tmr-data.types'

// ─── Sample fixture 1: single in_trial account with teams ───────────────────

const FIXTURE_IN_TRIAL: GetUserDetailsData = {
  accounts: [
    {
      accountId: 'acc1',
      planName: 'Pro',
      planConfig: { coreDestination: 'Google Sheets', additionalDestinations: ['Looker'] },
      billingFreq: 'monthly',
      subscription: { status: 'in_trial' },
    },
  ],
  teams: [
    { teamId: 'team1', name: 'Alpha Team' },
    { teamId: 'team2', name: 'Beta Team' },
  ],
  dataSources: [
    { teamId: 'team1' },
    { teamId: 'team1' },
    { teamId: 'team2' },
  ],
  queries: [
    { teamId: 'team1' },
  ],
  schedules: [
    { teamId: 'team1' },
    { teamId: 'team2' },
  ],
}

// ─── Sample fixture 2: cancelled Pro + empty activity arrays ─────────────────

const FIXTURE_CANCELLED: GetUserDetailsData = {
  accounts: [
    {
      accountId: 'acc2',
      planName: 'Pro',
      subscription: { status: 'cancelled' },
    },
  ],
  teams: [{ teamId: 'teamX', name: 'Old Team' }],
  dataSources: [],
  queries: [],
  schedules: [],
}

// ─── R220 ────────────────────────────────────────────────────────────────────

describe('R220 — reduceTmrDetails: in_trial account', () => {
  it('maps account fields correctly', () => {
    const result = reduceTmrDetails(FIXTURE_IN_TRIAL)
    expect(result.accounts).toHaveLength(1)
    const acc = result.accounts[0]!
    expect(acc.accountId).toBe('acc1')
    expect(acc.planName).toBe('Pro')
    expect(acc.status).toBe('in_trial')
    expect(acc.coreDestination).toBe('Google Sheets')
    expect(acc.additionalDestinations).toEqual(['Looker'])
    expect(acc.billingFreq).toBe('monthly')
  })

  it('tallies accountStatusCounts correctly', () => {
    const result = reduceTmrDetails(FIXTURE_IN_TRIAL)
    expect(result.accountStatusCounts).toEqual({ in_trial: 1 })
  })

  it('counts per-team sources, queries, schedules correctly', () => {
    const result = reduceTmrDetails(FIXTURE_IN_TRIAL)
    const alpha = result.teams.find((t) => t.teamId === 'team1')!
    const beta = result.teams.find((t) => t.teamId === 'team2')!
    expect(alpha.dataSources).toBe(2)
    expect(alpha.queries).toBe(1)
    expect(alpha.schedules).toBe(1)
    expect(beta.dataSources).toBe(1)
    expect(beta.queries).toBe(0)
    expect(beta.schedules).toBe(1)
  })
})

// ─── R221 ────────────────────────────────────────────────────────────────────

describe('R221 — reduceTmrDetails: cancelled account + empty arrays', () => {
  it('does not throw with empty arrays', () => {
    expect(() => reduceTmrDetails(FIXTURE_CANCELLED)).not.toThrow()
  })

  it('sets status to cancelled', () => {
    const result = reduceTmrDetails(FIXTURE_CANCELLED)
    expect(result.accountStatusCounts).toEqual({ cancelled: 1 })
  })

  it('yields zero counts for all team metrics', () => {
    const result = reduceTmrDetails(FIXTURE_CANCELLED)
    const team = result.teams.find((t) => t.teamId === 'teamX')!
    expect(team.dataSources).toBe(0)
    expect(team.queries).toBe(0)
    expect(team.schedules).toBe(0)
  })

  it('handles fully empty input without throwing', () => {
    const result = reduceTmrDetails({})
    expect(result.accounts).toEqual([])
    expect(result.teams).toEqual([])
    expect(result.accountStatusCounts).toEqual({})
  })
})

// ─── R222 — email match logic ─────────────────────────────────────────────────

describe('R222 — TMR email match logic', () => {
  // Mirror the exact match logic from TmrDataService.syncUser
  function findExactMatch(items: Array<{ emailId?: string }>, targetEmail: string) {
    return items.find((u) => u.emailId?.toLowerCase() === targetEmail.toLowerCase()) ?? null
  }

  it('accepts an exact case-insensitive match', () => {
    const results = [
      { userId: 'u1', emailId: 'Alice@Example.COM' },
      { userId: 'u2', emailId: 'bob@other.com' },
    ]
    const match = findExactMatch(results, 'alice@example.com')
    expect(match?.userId).toBe('u1')
  })

  it('rejects a fuzzy near-match with a different email', () => {
    const results = [
      { userId: 'u3', emailId: 'alice_smith@example.com' },
    ]
    const match = findExactMatch(results, 'alice@example.com')
    expect(match).toBeNull()
  })

  it('returns null when data array is empty', () => {
    expect(findExactMatch([], 'anyone@example.com')).toBeNull()
  })
})
