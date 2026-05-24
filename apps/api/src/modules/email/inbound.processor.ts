import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { simpleParser } from 'mailparser'
import { PrismaService } from '../database/prisma.service'
import { AppConfigService } from '../config/config.service'
import { EmailRoutingService } from './routing.service'
import { ImapClientService } from './imap-client.service'
import { QueueService, type InboundEmailJobData } from '../queue/queue.service'
import { INBOUND_EMAIL_QUEUE } from '../queue/queue.module'

function stripQuotedText(body: string): string {
  const lines = body.split('\n')
  const cutoff = lines.findIndex(
    (line) => /^On .+ wrote:/.test(line) || /^>/.test(line.trim()) || /^From:/.test(line),
  )
  return (cutoff > 0 ? lines.slice(0, cutoff) : lines).join('\n').trim()
}

@Injectable()
export class InboundEmailProcessor implements OnModuleInit {
  private readonly logger = new Logger(InboundEmailProcessor.name)

  constructor(
    private readonly db: PrismaService,
    private readonly appConfigService: AppConfigService,
    private readonly routingService: EmailRoutingService,
    private readonly imapClientService: ImapClientService,
    private readonly queueService: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queueService.ready()
    const boss = this.queueService.getBoss()
    await boss.work<InboundEmailJobData>(INBOUND_EMAIL_QUEUE, async (job) => {
      await this.handle(job.data)
    })
    this.logger.log(`Worker registered for ${INBOUND_EMAIL_QUEUE}`)
  }

  private async handle(data: InboundEmailJobData): Promise<void> {
    const { uid, rawMime } = data
    this.logger.log(`Processing inbound email uid=${uid}`)

    const cfg = await this.appConfigService.get()

    const parsed = await simpleParser(rawMime)
    const msgId = parsed.messageId ?? null
    const fromAddress = parsed.from?.value[0]?.address ?? 'unknown@unknown'
    const subject = parsed.subject ?? null

    // Idempotency — Message.messageId is @unique. If we already persisted this
    // Message-ID, ack and exit.
    if (msgId) {
      const existing = await this.db.message.findFirst({ where: { messageId: msgId } })
      if (existing) {
        this.logger.log(`Skipping already-processed message ${msgId}`)
        await this.imapClientService.markSeen(uid)
        return
      }
    }

    const verpSecret = cfg.verpSecret ?? 'default-verp-secret'
    const routing = await this.routingService.route(parsed, verpSecret)

    if (routing.drop) {
      this.logger.log(`Dropping email from ${fromAddress}: ${routing.dropReason ?? 'autoresponder'}`)
      await this.imapClientService.markSeen(uid)
      return
    }

    const user = await this.resolveUser(fromAddress, parsed.from?.value[0]?.name)

    let ticketId = routing.ticketId
    if (routing.strategy === 'NEW') {
      const ticket = await this.db.ticket.create({
        data: {
          title: subject ?? 'Support request',
          category: 'OTHER',
          source: 'EMAIL',
          userId: user.id,
        },
      })
      ticketId = ticket.id
      this.logger.log(`Created new ticket ${ticket.id} from email`)
    }

    if (!ticketId) throw new Error('Routing returned no ticketId and no NEW strategy')

    const bodyRaw = parsed.text ?? ''
    const body = stripQuotedText(bodyRaw)

    await this.db.message.create({
      data: {
        ticketId,
        body: body || bodyRaw,
        bodyRaw,
        type: 'REPLY',
        authorUserId: user.id,
        sentVia: 'EMAIL',
        messageId: msgId,
        inReplyTo: parsed.inReplyTo ?? null,
      },
    })

    await this.imapClientService.markSeen(uid)

    this.logger.log(`Processed inbound email uid=${uid} → ticket ${ticketId} (${routing.strategy})`)
  }

  private async resolveUser(email: string, displayName?: string): Promise<{ id: string }> {
    const existing = await this.db.user.findUnique({ where: { email } })
    if (existing) return existing
    return this.db.user.create({
      data: {
        email,
        name: displayName || email.split('@')[0],
        source: 'EMAIL',
        isVerified: false,
      },
    })
  }
}
