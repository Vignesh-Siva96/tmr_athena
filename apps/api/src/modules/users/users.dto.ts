import { z } from 'zod'

export const createNoteSchema = z.object({
  body: z.string().min(1),
})
export type CreateNoteDto = z.infer<typeof createNoteSchema>

export const updateNoteSchema = z.object({
  body: z.string().min(1),
})
export type UpdateNoteDto = z.infer<typeof updateNoteSchema>

const UserCategory = z.enum(['CUSTOMER', 'MARKETING', 'PROMOTIONAL'])

export const listCustomersSchema = z.object({
  search: z.string().optional(),
  category: UserCategory.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListCustomersQuery = z.infer<typeof listCustomersSchema>

export const updateUserSchema = z.object({
  category: UserCategory,
})
export type UpdateUserDto = z.infer<typeof updateUserSchema>
