import { z } from 'zod'

export const TAG_PALETTE = [
  '#71717A', '#3B82F6', '#22C55E', '#F59E0B',
  '#EF4444', '#A78BFA', '#EC4899', '#14B8A6',
] as const

const tagColor = z.enum(TAG_PALETTE)

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: tagColor,
})
export type CreateTagDto = z.infer<typeof createTagSchema>

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: tagColor.optional(),
})
export type UpdateTagDto = z.infer<typeof updateTagSchema>
