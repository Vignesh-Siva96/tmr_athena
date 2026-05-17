import { z } from 'zod'

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isGuest: z.boolean(),
  googleId: z.string().nullable(),
  lastActiveAt: z.string().or(z.date()).nullable(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
})

export type User = z.infer<typeof userSchema>
