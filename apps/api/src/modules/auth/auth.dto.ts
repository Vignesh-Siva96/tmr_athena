import { z } from 'zod'

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string()
    .min(8)
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
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

export const agentSigninSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type AgentSigninDto = z.infer<typeof agentSigninSchema>

export const agentGoogleSchema = z.object({
  code: z.string(),
})
export type AgentGoogleDto = z.infer<typeof agentGoogleSchema>

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
})
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
})
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string()
    .min(8)
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
})
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>

export const ssoSchema = z.object({
  token: z.string().min(1),
})
export type SsoDto = z.infer<typeof ssoSchema>
