import { Injectable } from '@nestjs/common'
import type { ParsedThread } from './providers/mail-provider.interface'

export interface ResolvedCustomer {
  email: string
  name?: string
  matchesAlias(email: string): boolean
}

@Injectable()
export class CustomerResolverService {
  resolveCustomer(thread: ParsedThread, aliases: string[]): ResolvedCustomer | null {
    const aliasSet = new Set(aliases.map(a => a.toLowerCase()))

    // Collect all from-addresses across messages
    const fromCounts = new Map<string, { email: string; name?: string; count: number }>()
    for (const msg of thread.messages) {
      const lower = msg.fromEmail.toLowerCase()
      if (aliasSet.has(lower)) continue
      const existing = fromCounts.get(lower)
      if (existing) {
        existing.count++
      } else {
        fromCounts.set(lower, { email: msg.fromEmail, name: msg.fromName, count: 1 })
      }
    }

    if (fromCounts.size === 0) return null

    // Pick the most frequent non-alias sender
    let best: { email: string; name?: string; count: number } | null = null
    for (const candidate of fromCounts.values()) {
      if (!best || candidate.count > best.count) best = candidate
    }

    if (!best) return null

    const resolvedEmail = best.email
    return {
      email: resolvedEmail,
      name: best.name,
      matchesAlias: (e: string) => aliasSet.has(e.toLowerCase()),
    }
  }
}
