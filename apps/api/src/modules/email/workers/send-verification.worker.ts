import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type PgBoss from 'pg-boss'
import { PrismaService } from '../../database/prisma.service'
import { EmailService } from '../email.service'
import { QueueService } from '../../queue/queue.service'
import { EMAIL_SEND_VERIFICATION_QUEUE } from '../../queue/queue.module'
import type { EmailSendVerificationJobData } from '../../queue/queue.service'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class SendVerificationWorker implements OnModuleInit {
  private readonly logger = new Logger(SendVerificationWorker.name)

  constructor(
    private readonly queue: QueueService,
    private readonly email: EmailService,
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.ready()

    this.queue.getBoss().work<EmailSendVerificationJobData>(
      EMAIL_SEND_VERIFICATION_QUEUE,
      async (job) => {
        const meta = job as unknown as PgBoss.JobWithMetadata<EmailSendVerificationJobData>
        const { userId, token } = job.data
        this.logger.debug(`Sending verification email for user ${userId} (attempt ${meta.retrycount + 1}/${meta.retrylimit + 1})`)

        const appConfig = await this.db.appConfig.findFirst()
        if (!appConfig) {
          this.logger.warn(`No AppConfig found — skipping verification email for user ${userId}`)
          return
        }

        const user = await this.db.user.findUnique({ where: { id: userId } })
        if (!user) {
          this.logger.warn(`User ${userId} not found — skipping verification email`)
          return
        }
        if (user.isVerified) {
          this.logger.debug(`User ${userId} already verified — skipping verification email`)
          return
        }

        const portalUrl = this.config.get<string>('PORTAL_URL') ?? 'http://localhost:3000'
        const verifyUrl = `${portalUrl}/verify-email?token=${token}`

        try {
          await this.email.sendEmailVerification(user, verifyUrl, appConfig)
          this.logger.log(`Verification email sent for user ${userId}`)
        } catch (err) {
          const isFinalAttempt = meta.retrycount >= meta.retrylimit
          if (isFinalAttempt) {
            this.logger.error(`Verification email permanently failed for user ${userId}: ${String(err)}`)
          } else {
            this.logger.warn(`Verification email failed (attempt ${meta.retrycount + 1}), will retry: ${String(err)}`)
            throw err
          }
        }
      },
    )

    this.logger.log(`Worker registered for queue: ${EMAIL_SEND_VERIFICATION_QUEUE}`)
  }
}
