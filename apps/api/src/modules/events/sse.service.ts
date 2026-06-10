import { Injectable } from '@nestjs/common'
import { Subject, Observable, interval, merge } from 'rxjs'
import { map } from 'rxjs/operators'
import * as crypto from 'crypto'
import type { SseEvent } from './event.types'

const SSE_HEARTBEAT_MS = 25_000

export interface SseMessageEvent {
  data: string
}

export interface SseTicketIdentity {
  sub: string
  role: 'user' | 'agent'
}

interface SseTicketEntry {
  identity: SseTicketIdentity
  expiresAt: number
}

/** EventSource cannot send an Authorization header, so the long-lived JWT must
 * never travel in the connection URL (it would land in logs/referrers/history).
 * Instead callers exchange their JWT for a short-lived, single-use ticket via an
 * authenticated endpoint, then open the SSE stream with that ticket instead. */
const TICKET_TTL_MS = 30_000

@Injectable()
export class SseService {
  private readonly subject = new Subject<SseEvent>()
  private readonly tickets = new Map<string, SseTicketEntry>()

  asObservable(): Observable<SseMessageEvent> {
    // Merge a 25s heartbeat into every SSE stream — proxies and load balancers
    // with aggressive idle-connection timeouts (AWS ALB defaults to 60s) will
    // silently close an SSE connection that sends no bytes during a quiet period,
    // causing clients to reconnect and miss events in the gap.
    const heartbeat$ = interval(SSE_HEARTBEAT_MS).pipe(
      map(() => ({ data: JSON.stringify({ type: 'heartbeat', ts: Date.now() }) })),
    )
    return merge(
      this.subject.pipe(map(e => ({ data: JSON.stringify(e) }))),
      heartbeat$,
    )
  }

  broadcast(event: SseEvent): void {
    this.subject.next(event)
  }

  issueTicket(identity: SseTicketIdentity): string {
    this.pruneExpiredTickets()
    const ticket = crypto.randomBytes(32).toString('hex')
    this.tickets.set(ticket, { identity, expiresAt: Date.now() + TICKET_TTL_MS })
    return ticket
  }

  /** One-time use: the ticket is removed whether or not it's valid. */
  consumeTicket(ticket: string): SseTicketIdentity | null {
    const entry = this.tickets.get(ticket)
    this.tickets.delete(ticket)
    if (!entry || entry.expiresAt < Date.now()) return null
    return entry.identity
  }

  private pruneExpiredTickets(): void {
    const now = Date.now()
    for (const [key, entry] of this.tickets) {
      if (entry.expiresAt < now) this.tickets.delete(key)
    }
  }
}
