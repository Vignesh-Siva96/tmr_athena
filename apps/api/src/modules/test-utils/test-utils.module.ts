import { Global, Module } from '@nestjs/common'
import { MailCaptureService } from './mail-capture.service'
import { TestController } from './test.controller'

/**
 * Loaded only when NODE_ENV === 'test'. Provides the in-memory mail bucket
 * + the /__test/* controller used by E2E flows. The module is wired into
 * AppModule via a conditional `imports` entry.
 */
@Global()
@Module({
  providers: [MailCaptureService],
  controllers: [TestController],
  exports: [MailCaptureService],
})
export class TestUtilsModule {}
