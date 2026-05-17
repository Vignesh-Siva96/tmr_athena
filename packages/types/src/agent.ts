import { z } from 'zod'

export const AgentRole = {
  ADMIN: 'ADMIN',
  AGENT: 'AGENT',
} as const
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole]

export const agentSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.nativeEnum(AgentRole),
  isActive: z.boolean(),
  lastActiveAt: z.string().or(z.date()).nullable(),
  inviteAccepted: z.boolean(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
})

export type Agent = z.infer<typeof agentSchema>
