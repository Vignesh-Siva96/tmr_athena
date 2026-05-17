import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'
import { SMTPServer } from 'smtp-server'
import { simpleParser, ParsedMail, AddressObject } from 'mailparser'
import { PrismaService } from '../database/prisma.service'
import type { Ticket, Agent, Message, AppConfig } from '@tmr/db'

type TicketWithUser = Ticket & {
  user: { id: string; email: string; name: string | null }
}

type MessageWithAgent = Message & {
  authorAgent: { id: string; name: string } | null
}

@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name)
  private transporter!: nodemailer.Transporter
  private smtpServer!: SMTPServer

  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
  ) {}

  onModuleInit(): void {
    this.initTransporter()
    this.startInboundServer()
  }

  onModuleDestroy(): Promise<void> {
    return new Promise((resolve) => {
      if (this.smtpServer) {
        this.smtpServer.close(() => resolve())
      } else {
        resolve()
      }
    })
  }

  private initTransporter(): void {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST') ?? 'smtp.gmail.com',
      port: parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10),
      secure: false,
      auth: {
        user: this.config.get<string>('SMTP_USER') ?? '',
        pass: this.config.get<string>('SMTP_PASS') ?? '',
      },
    })
    this.logger.log('Email transporter initialized')
  }

  private startInboundServer(): void {
    const port = parseInt(this.config.get<string>('INBOUND_SMTP_PORT') ?? '2525', 10)

    this.smtpServer = new SMTPServer({
      authOptional: true,
      onData: (stream, _session, callback) => {
        simpleParser(stream)
          .then((parsed) => {
            this.processInboundEmail(parsed).catch((err: unknown) => {
              this.logger.error('Error processing inbound email', String(err))
            })
            callback()
          })
          .catch((err: unknown) => {
            this.logger.error('Error parsing email', String(err))
            callback()
          })
      },
    })

    this.smtpServer.listen(port, () => {
      this.logger.log(`Inbound SMTP server listening on port ${port}`)
    })

    this.smtpServer.on('error', (err) => {
      this.logger.error('SMTP server error', err.message)
    })
  }

  private extractAddresses(to: ParsedMail['to']): string[] {
    if (!to) return []
    const objs: AddressObject[] = Array.isArray(to) ? to : [to]
    return objs.flatMap((obj) => obj.value.map((addr) => addr.address ?? '').filter(Boolean))
  }

  private async processInboundEmail(parsed: ParsedMail): Promise<void> {
    const toAddresses = this.extractAddresses(parsed.to)

    let emailThreadId: string | null = null
    for (const addr of toAddresses) {
      const match = /reply\+([^@]+)@/.exec(addr)
      if (match?.[1]) {
        emailThreadId = match[1]
        break
      }
    }

    if (!emailThreadId) {
      this.logger.warn('Inbound email: no emailThreadId found in To addresses')
      return
    }

    const ticket = await this.db.ticket.findUnique({
      where: { emailThreadId },
      include: { user: true },
    })

    if (!ticket) {
      this.logger.warn(`Inbound email: no ticket found for emailThreadId ${emailThreadId}`)
      return
    }

    const body = parsed.text ?? (typeof parsed.html === 'string' ? parsed.html : '') ?? ''
    const strippedBody = this.stripQuotedText(body)

    await this.db.message.create({
      data: {
        ticketId: ticket.id,
        body: strippedBody,
        type: 'REPLY',
        authorUserId: ticket.userId,
        sentVia: 'EMAIL',
      },
    })

    this.logger.log(`Inbound email created message on ticket ${ticket.id}`)
  }

  private stripQuotedText(body: string): string {
    const lines = body.split('\n')
    const cutoff = lines.findIndex((line) => /^On .+ wrote:/.test(line) || /^>/.test(line.trim()))
    return (cutoff > 0 ? lines.slice(0, cutoff) : lines).join('\n').trim()
  }

  private getFromAddress(appConfig: AppConfig): string {
    const fromName = appConfig.emailDisplayName
    return `"${fromName} Support" <${this.config.get<string>('SMTP_FROM') ?? 'support@twominutereports.com'}>`
  }

  private getReplyToAddress(ticket: Ticket): string {
    const domain = this.config.get<string>('SMTP_FROM')?.split('@')[1] ?? 'support.tmr.com'
    return `reply+${ticket.emailThreadId}@${domain}`
  }

  private getThreadMessageId(ticket: Ticket): string {
    const domain = this.config.get<string>('SMTP_FROM')?.split('@')[1] ?? 'support.tmr.com'
    return `<ticket-${ticket.emailThreadId}@${domain}>`
  }

  async sendTicketConfirmation(ticket: TicketWithUser, appConfig: AppConfig): Promise<void> {
    const displayId = `TMR-${ticket.number}`
    const portalUrl = this.config.get<string>('PORTAL_URL') ?? 'http://localhost:3000'

    try {
      await this.transporter.sendMail({
        from: this.getFromAddress(appConfig),
        to: ticket.user.email,
        subject: `[${displayId}] ${ticket.title}`,
        replyTo: this.getReplyToAddress(ticket),
        messageId: this.getThreadMessageId(ticket),
        text: [
          `Hi ${ticket.user.name ?? 'there'},`,
          '',
          `We've received your support ticket and will get back to you shortly.`,
          '',
          `Ticket: ${displayId}`,
          `Subject: ${ticket.title}`,
          '',
          `View your ticket: ${portalUrl}/tickets/${ticket.id}`,
          '',
          `— ${appConfig.appName} Support Team`,
        ].join('\n'),
      })
      this.logger.log(`Sent confirmation for ticket ${ticket.id}`)
    } catch (err) {
      this.logger.error(`Failed to send confirmation for ticket ${ticket.id}: ${String(err)}`)
    }
  }

  async sendAgentReply(ticket: TicketWithUser, message: MessageWithAgent, appConfig: AppConfig): Promise<void> {
    const displayId = `TMR-${ticket.number}`
    const portalUrl = this.config.get<string>('PORTAL_URL') ?? 'http://localhost:3000'
    const threadMessageId = this.getThreadMessageId(ticket)

    try {
      await this.transporter.sendMail({
        from: this.getFromAddress(appConfig),
        to: ticket.user.email,
        subject: `Re: [${displayId}] ${ticket.title}`,
        replyTo: this.getReplyToAddress(ticket),
        inReplyTo: threadMessageId,
        references: threadMessageId,
        text: [
          message.body,
          '',
          `View full thread: ${portalUrl}/tickets/${ticket.id}`,
          '',
          `— ${appConfig.appName} Support Team`,
        ].join('\n'),
      })
      this.logger.log(`Sent agent reply email for ticket ${ticket.id}`)
    } catch (err) {
      this.logger.error(`Failed to send reply email for ticket ${ticket.id}: ${String(err)}`)
    }
  }

  async sendAgentInvite(agent: Agent, appConfig: AppConfig, inviteUrl: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.getFromAddress(appConfig),
        to: agent.email,
        subject: `You're invited to join ${appConfig.appName} Support`,
        text: [
          `Hi ${agent.name},`,
          '',
          `You've been invited to join the ${appConfig.appName} support team.`,
          '',
          `Accept your invitation: ${inviteUrl}`,
          '',
          `This link expires in 7 days.`,
        ].join('\n'),
      })
      this.logger.log(`Sent invite to agent ${agent.email}`)
    } catch (err) {
      this.logger.error(`Failed to send invite to ${agent.email}: ${String(err)}`)
    }
  }
}
