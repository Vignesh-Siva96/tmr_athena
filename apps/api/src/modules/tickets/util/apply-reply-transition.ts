import type { Prisma, TicketStatus } from '@tmr/db'

const REOPENABLE_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED']

export interface ReplyTransitionResult {
  newStatus: TicketStatus | null
  reopened: boolean
}

/**
 * Apply the standard status-machine transition for a new reply on a ticket.
 * Call inside an open Prisma transaction. The ticket must be a real ticket
 * (`isTicket=true`); callers should guard on that before calling.
 *
 * Does NOT apply when `shouldAutoEscalate` is true (scenario-9 escalation
 * takes over) — callers must skip this when that flag is set.
 */
export async function applyReplyTransition(
  tx: Prisma.TransactionClient,
  ticket: { id: string; status: TicketStatus },
  authorRole: 'agent' | 'customer',
): Promise<ReplyTransitionResult> {
  let newStatus: TicketStatus | null = null
  let reopened = false

  if (authorRole === 'agent') {
    if (ticket.status === 'OPEN') newStatus = 'IN_PROGRESS'
    else if (ticket.status === 'IN_PROGRESS') newStatus = 'WAITING'
  } else {
    if (ticket.status === 'WAITING') {
      newStatus = 'IN_PROGRESS'
    } else if (REOPENABLE_STATUSES.includes(ticket.status as TicketStatus)) {
      newStatus = 'IN_PROGRESS'
      reopened = true
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { reopenCount: { increment: 1 }, reopenedAt: new Date() },
      })
    }
  }

  if (newStatus) {
    await tx.ticket.update({ where: { id: ticket.id }, data: { status: newStatus } })
    await tx.message.create({
      data: {
        ticketId: ticket.id,
        type: 'SYSTEM_EVENT',
        body: `status_changed:${ticket.status}:${newStatus}`,
      },
    })
  }

  return { newStatus, reopened }
}
