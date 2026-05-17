import { z } from 'zod'

export const TicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING: 'WAITING',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus]

export const TicketPriority = {
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority]

export const TicketCategory = {
  BUG_REPORT: 'BUG_REPORT',
  FEATURE_REQUEST: 'FEATURE_REQUEST',
  QUESTION: 'QUESTION',
  BILLING: 'BILLING',
  OTHER: 'OTHER',
} as const
export type TicketCategory = (typeof TicketCategory)[keyof typeof TicketCategory]

export const TicketSource = {
  PORTAL: 'PORTAL',
  EMAIL: 'EMAIL',
} as const
export type TicketSource = (typeof TicketSource)[keyof typeof TicketSource]

export const ticketSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.nativeEnum(TicketStatus),
  priority: z.nativeEnum(TicketPriority),
  category: z.nativeEnum(TicketCategory),
  product: z.string().nullable(),
  connector: z.string().nullable(),
  source: z.nativeEnum(TicketSource),
  userId: z.string(),
  assigneeId: z.string().nullable(),
  emailThreadId: z.string(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
  deletedAt: z.string().or(z.date()).nullable(),
})

export const createTicketSchema = z.object({
  title: z.string().min(1).max(120),
  category: z.nativeEnum(TicketCategory),
  product: z.string().optional(),
  connector: z.string().optional(),
  description: z.string().optional(),
})

export const listTicketsSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
})

export type Ticket = z.infer<typeof ticketSchema>
export type CreateTicketDto = z.infer<typeof createTicketSchema>
export type ListTicketsQuery = z.infer<typeof listTicketsSchema>
