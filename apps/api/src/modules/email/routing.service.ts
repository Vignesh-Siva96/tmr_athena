import { Injectable, Logger } from '@nestjs/common'
import type { ParsedMail } from 'mailparser'
import { PrismaService } from '../database/prisma.service'
import { parseVerpAddress } from './verp.util'

export type RoutingStrategy = 'VERP' | 'HEADER' | 'SUBJECT' | 'NEW' | 'DROPPED'

export interface RoutingResult {
  strategy: RoutingStrategy
  ticketId: string | null
  drop: boolean
  dropReason?: string
}

const LOOP_GUARD_HEADERS = ['auto-submitted', 'x-autoreply', 'x-autorespond']
const LOOP_GUARD_PRECEDENCE = ['bulk', 'list', 'junk']
const LOOP_GUARD_SENDERS = /^(noreply|no-reply|mailer-daemon|postmaster|do-not-reply)@/i
const SUBJECT_TAG_RE = /\[TMR-(\d+)\]/i

@Injectable()
export class EmailRoutingService {
  private readonly logger = new Logger(EmailRoutingService.name)

  constructor(private readonly db: PrismaService) {}

  isAutoresponder(parsed: ParsedMail): { drop: boolean; reason?: string } {
    const headers = parsed.headers as Map<string, string | string[]>

    for (const h of LOOP_GUARD_HEADERS) {
      const val = headers.get(h)
      if (val) return { drop: true, reason: `${h}: ${String(val)}` }
    }

    const precedence = headers.get('precedence')
    if (precedence && LOOP_GUARD_PRECEDENCE.includes(String(precedence).toLowerCase())) {
      return { drop: true, reason: `precedence: ${String(precedence)}` }
    }

    const from = parsed.from?.value[0]?.address ?? ''
    if (LOOP_GUARD_SENDERS.test(from)) {
      return { drop: true, reason: `sender: ${from}` }
    }

    return { drop: false }
  }

  async route(parsed: ParsedMail, verpSecret: string): Promise<RoutingResult> {
    // 1. Loop guard
    const loopCheck = this.isAutoresponder(parsed)
    if (loopCheck.drop) {
      return { strategy: 'DROPPED', ticketId: null, drop: true, dropReason: loopCheck.reason }
    }

    const toAddresses = this.extractAddresses(parsed.to).concat(this.extractAddresses(parsed.cc))

    // 2. VERP — signed reply+ token
    for (const addr of toAddresses) {
      const emailThreadId = parseVerpAddress(addr, verpSecret)
      if (emailThreadId) {
        const ticket = await this.db.ticket.findUnique({ where: { emailThreadId } })
        if (ticket) {
          this.logger.log(`VERP routing → ticket ${ticket.id}`)
          return { strategy: 'VERP', ticketId: ticket.id, drop: false }
        }
      }
    }

    // 3. Header threading — In-Reply-To / References
    const inReplyTo = parsed.inReplyTo
    if (inReplyTo) {
      const msg = await this.db.message.findFirst({ where: { messageId: inReplyTo } })
      if (msg?.ticketId) {
        this.logger.log(`Header threading (In-Reply-To) → ticket ${msg.ticketId}`)
        return { strategy: 'HEADER', ticketId: msg.ticketId, drop: false }
      }
    }

    // Walk References newest-first
    const refs = parsed.references
    if (refs) {
      const refList = Array.isArray(refs) ? refs : [refs]
      for (const ref of [...refList].reverse()) {
        const msg = await this.db.message.findFirst({ where: { messageId: ref } })
        if (msg?.ticketId) {
          this.logger.log(`Header threading (References) → ticket ${msg.ticketId}`)
          return { strategy: 'HEADER', ticketId: msg.ticketId, drop: false }
        }
      }
    }

    // 4. Subject tag
    const subject = parsed.subject ?? ''
    const tagMatch = SUBJECT_TAG_RE.exec(subject)
    if (tagMatch) {
      const number = parseInt(tagMatch[1], 10)
      const ticket = await this.db.ticket.findUnique({ where: { number } })
      if (ticket) {
        this.logger.log(`Subject tag routing → ticket ${ticket.id}`)
        return { strategy: 'SUBJECT', ticketId: ticket.id, drop: false }
      }
    }

    // 5. New ticket fallback
    return { strategy: 'NEW', ticketId: null, drop: false }
  }

  private extractAddresses(field: ParsedMail['to']): string[] {
    if (!field) return []
    const objs = Array.isArray(field) ? field : [field]
    return objs.flatMap((o) => o.value.map((a) => a.address ?? '').filter(Boolean))
  }
}
