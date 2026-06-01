import { Controller, Get, Post, Query } from '@nestjs/common'
import { MailCaptureService, CapturedMail } from './mail-capture.service'

/**
 * Test-only controller — mounted only when NODE_ENV === 'test'.
 * Exposes hooks the E2E suite uses to assert on outbound side-effects.
 */
@Controller('__test')
export class TestController {
  constructor(private readonly mail: MailCaptureService) {}

  @Get('captured-mail')
  capturedMail(@Query('to') to?: string): CapturedMail[] {
    return this.mail.list({ to })
  }

  @Post('captured-mail/reset')
  reset(): { ok: true } {
    this.mail.reset()
    return { ok: true }
  }
}
