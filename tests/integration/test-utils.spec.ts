/**
 * Verifies the TestUtilsModule is loaded under NODE_ENV=test and that the
 * mail-capture endpoint is reachable. E2E flows depend on both.
 */

import { harness } from './harness'
import { MailCaptureService } from '../../apps/api/src/modules/test-utils/mail-capture.service'
import './setup'

describe('TestUtilsModule (NODE_ENV=test only)', () => {
  it('GET /__test/captured-mail returns an empty array initially', async () => {
    const res = await harness.request().get('/api/v1/__test/captured-mail')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('captures programmatically and returns the message via the endpoint', async () => {
    const capture = harness.get<MailCaptureService>(MailCaptureService)
    capture.reset()

    capture.capture({
      ts: new Date().toISOString(),
      from: 'support@test.local',
      to: 'jordan@acmecorp.com',
      subject: 'Hello',
      text: 'A test body',
      headers: { 'Message-ID': '<abc@test.local>', To: 'jordan@acmecorp.com', From: 'support@test.local' },
      raw: '{}',
    })

    const res = await harness
      .request()
      .get('/api/v1/__test/captured-mail')
      .query({ to: 'jordan' })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].subject).toBe('Hello')
    expect(res.body.data[0].headers['Message-ID']).toBe('<abc@test.local>')
  })

  it('POST /__test/captured-mail/reset clears the bucket', async () => {
    const capture = harness.get<MailCaptureService>(MailCaptureService)
    capture.reset() // mail bucket persists across tests (in-memory singleton)
    capture.capture({
      ts: new Date().toISOString(),
      to: 'someone@test.local',
      headers: { To: 'someone@test.local' },
      raw: '{}',
    })
    expect(capture.list()).toHaveLength(1)

    const res = await harness.request().post('/api/v1/__test/captured-mail/reset')
    expect(res.status).toBe(201)
    expect(capture.list()).toHaveLength(0)
  })
})
