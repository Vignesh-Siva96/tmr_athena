import { z } from 'zod'

export const createCannedResponseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  body: z.string().min(1),
})
export type CreateCannedResponseDto = z.infer<typeof createCannedResponseSchema>

export const updateCannedResponseSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  body: z.string().min(1).optional(),
})
export type UpdateCannedResponseDto = z.infer<typeof updateCannedResponseSchema>
