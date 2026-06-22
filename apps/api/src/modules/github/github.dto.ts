import { z } from 'zod'

export const connectGithubSchema = z.object({
  code: z.string(),
})
export type ConnectGithubDto = z.infer<typeof connectGithubSchema>

export const updateGithubConfigSchema = z.object({
  defaultRepo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in format owner/repo'),
})
export type UpdateGithubConfigDto = z.infer<typeof updateGithubConfigSchema>

export const createIssueSchema = z.object({
  repo: z.string().optional(),
})
export type CreateIssueDto = z.infer<typeof createIssueSchema>

export const linkIssueSchema = z.object({
  repo: z.string(),
  issueNumber: z.number().int().positive(),
})
export type LinkIssueDto = z.infer<typeof linkIssueSchema>
