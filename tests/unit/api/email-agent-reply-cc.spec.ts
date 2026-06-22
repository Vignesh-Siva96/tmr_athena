/**
 * email-agent-reply-cc.spec — unit tests for CC in sendAgentReply.
 *
 * Covers:
 *  - sendAgentReply maps message.cc → SendMailOptions.cc
 *  - empty cc → no cc key on sent mail
 *  - capture transport records headers['Cc'] with the addresses
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

function makeFindMany() {
  return vi.fn().mockResolvedValue([])
}

async function makeService(mailCapture: MailCaptureService) {
  const { EmailService } = await import('../../../apps/api/src/modules/email/email.service')
  const config = { get: vi.fn().mockReturnValue(undefined) }
  const appConfigService = { get: vi.fn().mockResolvedValue(APP_CONFIG) }
  const tokenRefresher = { getValidAccessToken: vi.fn().mockResolvedValue('tok') }
  const db = { message: { findMany: makeFindMany() }, attachment: { findMany: vi.fn().mockResolvedValue([]) } }
  const files = { getAttachmentBuffer: vi.fn() }
  return new EmailService(config as never, appConfigService as never, db as never, tokenRefresher as never, files as never, mailCapture)
}

describe('sendAgentReply — CC', () => {
  it('maps message.cc to outbound Cc header', async () => {
    const mailCapture = new MailCaptureService()
    const service = await makeService(mailCapture)

    await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-1', body: 'Hello', authorAgent: null, cc: ['cc1@example.com', 'cc2@example.com'] } as never,
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    expect(sent.headers['Cc']).toBe('cc1@example.com, cc2@example.com')
    const ccArr = Array.isArray(sent.cc) ? sent.cc : [sent.cc]
    expect(ccArr).toContain('cc1@example.com')
    expect(ccArr).toContain('cc2@example.com')
  })

  it('omits Cc header when message.cc is empty', async () => {
    const mailCapture = new MailCaptureService()
    const service = await makeService(mailCapture)

    await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-1', body: 'Hello', authorAgent: null, cc: [] } as never,
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    expect(sent.headers['Cc']).toBeUndefined()
    expect(sent.cc).toBeUndefined()
  })

  it('omits Cc header when message.cc is absent', async () => {
    const mailCapture = new MailCaptureService()
    const service = await makeService(mailCapture)

    await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-1', body: 'Hello', authorAgent: null } as never,
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    expect(sent.headers['Cc']).toBeUndefined()
  })
})
