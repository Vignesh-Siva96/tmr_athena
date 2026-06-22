/**
 * email-html-body.spec — unit tests for HTML rendering in outbound replies.
 *
 * Regression guard for the "emails arrive as literal HTML tags" bug: agent and
 * bot replies must be sent as `html` (so formatting renders) with a stripped
 * plain-text fallback in `text`.
 */
import { describe, it, expect, vi } from 'vitest'
import { MailCaptureService } from '../../../apps/api/src/modules/test-utils/mail-capture.service'

const APP_CONFIG = {
  oauthProvider: null,
  oauthAccessTokenEnc: null,
  oauthEmail: 'support@test.local',
  emailDisplayName: 'TMR',
  appName: 'TMR',
} as const

function makeTicket() {
  return {
    id: 'tkt-1',
    ref: 'ABCDEFG',
    title: 'Help needed',
    emailThreadId: 'et-1',
    externalThreadId: null,
    user: { email: 'customer@example.com', name: 'Customer' },
  }
}

async function makeService(mailCapture: MailCaptureService) {
  const { EmailService } = await import('../../../apps/api/src/modules/email/email.service')
  const config = { get: vi.fn().mockReturnValue(undefined) }
  const appConfigService = { get: vi.fn().mockResolvedValue(APP_CONFIG) }
  const tokenRefresher = { getValidAccessToken: vi.fn().mockResolvedValue('tok') }
  const db = { message: { findMany: vi.fn().mockResolvedValue([]) }, attachment: { findMany: vi.fn().mockResolvedValue([]) } }
  const files = { getAttachmentBuffer: vi.fn() }
  return new EmailService(config as never, appConfigService as never, db as never, tokenRefresher as never, files as never, mailCapture)
}

describe('sendAgentReply — HTML body', () => {
  it('sends an agent HTML body as html, not as literal text', async () => {
    const mailCapture = new MailCaptureService()
    const service = await makeService(mailCapture)

    await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-1', body: '<ul><li><b><i>Greetings</i></b></li></ul>', authorAgent: null } as never,
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    // The HTML part carries the real markup + signature.
    expect(sent.html).toContain('<ul><li><b><i>Greetings</i></b></li></ul>')
    expect(sent.html).toContain('— TMR Support Team')
    // The plain-text fallback is tag-free.
    expect(sent.text).toBeDefined()
    expect(sent.text).not.toContain('<ul>')
    expect(sent.text).not.toContain('<li>')
    expect(sent.text).toContain('Greetings')
  })

  it('prefers bodyHtml (rendered markdown) and keeps link URL in the text fallback', async () => {
    const mailCapture = new MailCaptureService()
    const service = await makeService(mailCapture)

    await service.sendAgentReply(
      makeTicket() as never,
      {
        id: 'msg-bot',
        body: 'Connect your account.\n\nLearn more: [Prerequisites](https://example.com/help#prereq)',
        bodyHtml: '<p>Connect your account.</p>\n<p>Learn more: <a href="https://example.com/help#prereq" target="_blank" rel="noreferrer noopener">Prerequisites</a></p>',
        authorAgent: null,
      } as never,
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    // html comes from bodyHtml (anchor tag, not raw markdown).
    expect(sent.html).toContain('<a href="https://example.com/help#prereq"')
    expect(sent.html).not.toContain('[Prerequisites]')
    // text fallback strips tags but preserves the link target.
    expect(sent.text).toContain('Prerequisites (https://example.com/help#prereq)')
    expect(sent.text).not.toContain('<a ')
  })
})
