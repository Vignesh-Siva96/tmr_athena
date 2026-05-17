import { z } from 'zod'

export const createMessageSchema = z.object({
  body: z.string().min(1),
  type: z.enum(['REPLY', 'INTERNAL_NOTE']).default('REPLY'),
  attachmentIds: z.array(z.string()).optional(),
  sendVia: z.enum(['PORTAL', 'EMAIL', 'PORTAL_AND_EMAIL']).default('PORTAL_AND_EMAIL'),
})
export type CreateMessageDto = z.infer<typeof createMessageSchema>

export const updateMessageSchema = z.object({
  body: z.string().min(1),
})
export type UpdateMessageDto = z.infer<typeof updateMessageSchema>
