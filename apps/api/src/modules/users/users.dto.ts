import { z } from 'zod'

export const createNoteSchema = z.object({
  body: z.string().min(1),
})
export type CreateNoteDto = z.infer<typeof createNoteSchema>

export const updateNoteSchema = z.object({
  body: z.string().min(1),
})
export type UpdateNoteDto = z.infer<typeof updateNoteSchema>
