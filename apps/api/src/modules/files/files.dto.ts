import { z } from 'zod'

export const uploadLinkSchema = z.object({
  linkUrl: z.string().url(),
})
export type UploadLinkDto = z.infer<typeof uploadLinkSchema>
