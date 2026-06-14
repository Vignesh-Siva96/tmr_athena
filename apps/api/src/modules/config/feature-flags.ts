import type { AppConfig } from '@tmr/db'

export type Feature =
  | 'confirmationEmail'
  | 'botReply'
  | 'aiAnalysis'
  | 'csatSurvey'
  | 'githubIssueCreation'

const FLAG: Record<Feature, keyof AppConfig> = {
  confirmationEmail: 'featConfirmationEmail',
  botReply: 'featBotReply',
  aiAnalysis: 'featAiAnalysis',
  csatSurvey: 'featCsatSurvey',
  githubIssueCreation: 'featGithubIssueCreation',
}

/** True when a feature must NOT run (master maintenance ON, or its own flag is off). */
export function isFeatureSuppressed(
  config: Pick<AppConfig, 'maintenanceMode'> & Partial<AppConfig>,
  feature: Feature,
): boolean {
  if (config.maintenanceMode) return true
  return config[FLAG[feature]] === false
}
