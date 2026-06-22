/**
 * email-agent-reply-attachments.spec — unit tests for file attachments in sendAgentReply.
 *
 * Regression guard for the "agent-uploaded files show in the portal but are never
 * attached to the outbound email" bug (R260): sendAgentReply must load the message's
 * non-link attachments from storage and add them as nodemailer attachment parts.
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

async function makeService(
  mailCapture: MailCaptureService,
  attachments: Array<{ id: string; filename: string; mimeType: string; url: string; isLink: boolean }>,
  getBuffer: (row: unknown) => Promise<Buffer>,
) {
  const { EmailService } = await import('../../../apps/api/src/modules/email/email.service')
  const config = { get: vi.fn().mockReturnValue(undefined) }
  const appConfigService = { get: vi.fn().mockResolvedValue(APP_CONFIG) }
  const tokenRefresher = { getValidAccessToken: vi.fn().mockResolvedValue('tok') }
  const db = {
    message: { findMany: vi.fn().mockResolvedValue([]) },
    attachment: { findMany: vi.fn().mockResolvedValue(attachments) },
  }
  const files = { getAttachmentBuffer: vi.fn(getBuffer) }
  return {
    service: new EmailService(config as never, appConfigService as never, db as never, tokenRefresher as never, files as never, mailCapture),
    db,
    files,
  }
}

describe('sendAgentReply — file attachments', () => {
  it('attaches the message\'s files to the outbound email', async () => {
    const mailCapture = new MailCaptureService()
    const rows = [{ id: 'att-1', filename: 'report.pdf', mimeType: 'application/pdf', url: 'http://minio/tmr-support/uuid.pdf', isLink: false }]
    const { service, db } = await makeService(mailCapture, rows, async () => Buffer.from('PDFBYTES'))

    await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-1', body: 'See attached.', authorAgent: null } as never,
      APP_CONFIG as never,
    )

    // Only non-link attachments for this message are queried.
    expect(db.attachment.findMany).toHaveBeenCalledWith({ where: { messageId: 'msg-1', isLink: false } })
    const sent = mailCapture.list()[0]
    expect(sent.attachments).toEqual(['report.pdf'])
  })

  it('sends no attachments when the message has none', async () => {
    const mailCapture = new MailCaptureService()
    const { service } = await makeService(mailCapture, [], async () => Buffer.from(''))

    await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-1', body: 'No files.', authorAgent: null } as never,
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    expect(sent.attachments).toEqual([])
  })

  it('drops a file that fails to fetch but still sends the reply', async () => {
    const mailCapture = new MailCaptureService()
    const rows = [
      { id: 'att-ok', filename: 'ok.png', mimeType: 'image/png', url: 'http://minio/tmr-support/ok.png', isLink: false },
      { id: 'att-bad', filename: 'bad.png', mimeType: 'image/png', url: 'http://minio/tmr-support/bad.png', isLink: false },
    ]
    const { service } = await makeService(mailCapture, rows, async (row) => {
      if ((row as { id: string }).id === 'att-bad') throw new Error('minio down')
      return Buffer.from('OK')
    })

    await service.sendAgentReply(
      makeTicket() as never,
      { id: 'msg-1', body: 'See attached.', authorAgent: null } as never,
      APP_CONFIG as never,
    )

    const sent = mailCapture.list()[0]
    // The reply still goes out; only the failed file is dropped.
    expect(sent.attachments).toEqual(['ok.png'])
    expect(sent.html).toContain('See attached.')
  })
})
