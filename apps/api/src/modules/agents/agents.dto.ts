import { z } from 'zod'

export const inviteAgentSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['ADMIN', 'AGENT']).default('AGENT'),
})
export type InviteAgentDto = z.infer<typeof inviteAgentSchema>

export const updateAgentSchema = z.object({
  role: z.enum(['ADMIN', 'AGENT']).optional(),
  isActive: z.boolean().optional(),
})
export type UpdateAgentDto = z.infer<typeof updateAgentSchema>
