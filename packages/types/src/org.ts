import { z } from 'zod'

export const appConfigSchema = z.object({
  id: z.string(),
  appName: z.string(),
  logoUrl: z.string().nullable(),
  portalTagline: z.string().nullable(),
  primaryColor: z.string(),
  accentColor: z.string(),
  emailDisplayName: z.string(),
  supportEmail: z.string().nullable(),
  customDomain: z.string().nullable(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
})

export type AppConfig = z.infer<typeof appConfigSchema>
