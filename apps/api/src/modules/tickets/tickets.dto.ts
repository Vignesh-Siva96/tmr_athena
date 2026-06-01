import { z } from 'zod'

const TicketStatus = z.enum(['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'DISMISSED'])
const TicketPriority = z.enum(['NORMAL', 'HIGH', 'URGENT'])
const TicketCategory = z.enum(['BUG_REPORT', 'FEATURE_REQUEST', 'QUESTION', 'BILLING', 'OTHER'])

export const listTicketsSchema = z.object({
  status: TicketStatus.optional(),
  category: TicketCategory.optional(),
  assigneeId: z.string().optional(),
  search: z.string().optional(),
  view: z.enum(['inbox', 'tickets']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})
export type ListTicketsQuery = z.infer<typeof listTicketsSchema>

export const createTicketSchema = z.object({
  title: z.string().min(1).max(120),
  category: TicketCategory,
  product: z.string().optional(),
  connector: z.string().optional(),
  description: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
  linkUrl: z.string().url().optional(),
  guestEmail: z.string().email().optional(),
})
export type CreateTicketDto = z.infer<typeof createTicketSchema>

// Only the 5 lifecycle statuses are settable via PATCH — NEW/DISMISSED are set via convert/discard
const LifecycleStatus = z.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'])

export const updateTicketSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  status: LifecycleStatus.optional(),
  priority: TicketPriority.optional(),
  assigneeId: z.string().nullable().optional(),
  category: TicketCategory.optional(),
  product: z.string().optional(),
  connector: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
})
export type UpdateTicketDto = z.infer<typeof updateTicketSchema>
