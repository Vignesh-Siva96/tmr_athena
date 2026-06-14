import { describe, it, expect } from 'vitest'
import { isFeatureSuppressed } from '../../../apps/api/src/modules/config/feature-flags'
import type { AppConfig } from '@tmr/db'

// Minimal AppConfig with all flags at their defaults (all on, maintenance off)
const BASE: Pick<AppConfig, 'maintenanceMode' | 'featConfirmationEmail' | 'featBotReply' | 'featAiAnalysis' | 'featCsatSurvey' | 'featGithubIssueCreation'> = {
  maintenanceMode: false,
  featConfirmationEmail: true,
  featBotReply: true,
  featAiAnalysis: true,
  featCsatSurvey: true,
  featGithubIssueCreation: true,
}

describe('isFeatureSuppressed', () => {
  describe('defaults (maintenance OFF, all flags ON)', () => {
    it('does not suppress confirmationEmail', () => {
      expect(isFeatureSuppressed(BASE, 'confirmationEmail')).toBe(false)
    })
    it('does not suppress botReply', () => {
      expect(isFeatureSuppressed(BASE, 'botReply')).toBe(false)
    })
    it('does not suppress aiAnalysis', () => {
      expect(isFeatureSuppressed(BASE, 'aiAnalysis')).toBe(false)
    })
    it('does not suppress csatSurvey', () => {
      expect(isFeatureSuppressed(BASE, 'csatSurvey')).toBe(false)
    })
    it('does not suppress githubIssueCreation', () => {
      expect(isFeatureSuppressed(BASE, 'githubIssueCreation')).toBe(false)
    })
  })

  describe('master maintenanceMode ON overrides all individual flags', () => {
    const ON = { ...BASE, maintenanceMode: true }

    it('suppresses confirmationEmail', () => expect(isFeatureSuppressed(ON, 'confirmationEmail')).toBe(true))
    it('suppresses botReply', () => expect(isFeatureSuppressed(ON, 'botReply')).toBe(true))
    it('suppresses aiAnalysis', () => expect(isFeatureSuppressed(ON, 'aiAnalysis')).toBe(true))
    it('suppresses csatSurvey', () => expect(isFeatureSuppressed(ON, 'csatSurvey')).toBe(true))
    it('suppresses githubIssueCreation', () => expect(isFeatureSuppressed(ON, 'githubIssueCreation')).toBe(true))
  })

  describe('master OFF — individual flag false suppresses only that feature', () => {
    it('suppresses confirmationEmail when its flag is false', () => {
      expect(isFeatureSuppressed({ ...BASE, featConfirmationEmail: false }, 'confirmationEmail')).toBe(true)
    })
    it('does not suppress botReply when only confirmationEmail is false', () => {
      expect(isFeatureSuppressed({ ...BASE, featConfirmationEmail: false }, 'botReply')).toBe(false)
    })
    it('suppresses botReply when its flag is false', () => {
      expect(isFeatureSuppressed({ ...BASE, featBotReply: false }, 'botReply')).toBe(true)
    })
    it('suppresses aiAnalysis when its flag is false', () => {
      expect(isFeatureSuppressed({ ...BASE, featAiAnalysis: false }, 'aiAnalysis')).toBe(true)
    })
    it('suppresses csatSurvey when its flag is false', () => {
      expect(isFeatureSuppressed({ ...BASE, featCsatSurvey: false }, 'csatSurvey')).toBe(true)
    })
    it('suppresses githubIssueCreation when its flag is false', () => {
      expect(isFeatureSuppressed({ ...BASE, featGithubIssueCreation: false }, 'githubIssueCreation')).toBe(true)
    })
  })

  describe('master ON with individual flag false — master still wins', () => {
    it('suppresses even when individual flag is also false', () => {
      expect(isFeatureSuppressed({ ...BASE, maintenanceMode: true, featBotReply: false }, 'botReply')).toBe(true)
    })
  })
})
