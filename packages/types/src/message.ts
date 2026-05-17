import { z } from 'zod'

export const MessageType = {
  REPLY: 'REPLY',
  INTERNAL_NOTE: 'INTERNAL_NOTE',
  SYSTEM_EVENT: 'SYSTEM_EVENT',
} as const
export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export const MessageSentVia = {
  PORTAL: 'PORTAL',
  EMAIL: 'EMAIL',
  PORTAL_AND_EMAIL: 'PORTAL_AND_EMAIL',
} as const
export type MessageSentVia = (typeof MessageSentVia)[keyof typeof MessageSentVia]

export const messageSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  type: z.nativeEnum(MessageType),
  body: z.string(),
  bodyHtml: z.string().nullable(),
  authorUserId: z.string().nullable(),
  authorAgentId: z.string().nullable(),
  sentVia: z.nativeEnum(MessageSentVia).nullable(),
  isInternal: z.boolean(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
  deletedAt: z.string().or(z.date()).nullable(),
})

export const createMessageSchema = z.object({
  body: z.string().min(1),
  isInternal: z.boolean().default(false),
})

export type Message = z.infer<typeof messageSchema>
export type CreateMessageDto = z.infer<typeof createMessageSchema>
