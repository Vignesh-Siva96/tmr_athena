import { z } from 'zod'

export const updateBrandConfigSchema = z.object({
  orgName: z.string().min(1).optional(),
  logoUrl: z.string().url().optional(),
  portalTagline: z.string().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  emailDisplayName: z.string().optional(),
})
export type UpdateBrandConfigDto = z.infer<typeof updateBrandConfigSchema>

export const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  brandConfig: updateBrandConfigSchema.optional(),
})
export type UpdateOrgDto = z.infer<typeof updateOrgSchema>
