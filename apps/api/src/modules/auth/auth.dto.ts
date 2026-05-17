import { z } from 'zod'

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
})
export type SignupDto = z.infer<typeof signupSchema>

export const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type SigninDto = z.infer<typeof signinSchema>

export const googleAuthSchema = z.object({
  code: z.string(),
  redirectUri: z.string().optional(),
})
export type GoogleAuthDto = z.infer<typeof googleAuthSchema>

export const guestSchema = z.object({
  email: z.string().email(),
})
export type GuestDto = z.infer<typeof guestSchema>

export const magicLinkSchema = z.object({
  email: z.string().email(),
  ticketId: z.string(),
})
export type MagicLinkDto = z.infer<typeof magicLinkSchema>

export const agentSigninSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type AgentSigninDto = z.infer<typeof agentSigninSchema>

export const agentGoogleSchema = z.object({
  code: z.string(),
})
export type AgentGoogleDto = z.infer<typeof agentGoogleSchema>
