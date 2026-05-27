import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'
import * as crypto from 'crypto'
import { AppConfigService } from '../config/config.service'
import { PrismaService } from '../database/prisma.service'
import { TokenRefresher } from '../email-oauth/token-refresher'
import type { Ticket, Agent, Message, AppConfig } from '@tmr/db'

type TicketWithUser = Ticket & {
  user: { id: string; email: string; name: string | null }
}

type MessageWithAgent = Message & {
  authorAgent: { id: string; name: string } | null
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name)
  private transporter!: nodemailer.Transporter

  constructor(
    private readonly config: ConfigService,
    private readonly appConfigService: AppConfigService,
    private readonly db: PrismaService,
    private readonly tokenRefresher: TokenRefresher,
  ) {}

  /**
   * Build RFC 5322 threading headers anchored to messages the customer's mail
   * client has actually seen.
   *
   * - Portal-originated ticket: the confirmation email used `<ticket-<id>@domain>`
   *   as its Message-ID, so referencing that ID threads correctly in the
   *   customer's inbox.
   * - Email-originated ticket: no confirmation email was sent. The customer's
   *   first email carried their own Message-ID (e.g. `<abc@gmail.com>`), which
   *   we persisted to `Message.messageId`. Referencing that anchors the thread
   *   in their mail client.
   *
   * We build `References` as the full ordered chain of prior real Message-IDs,
   * and `In-Reply-To` as the most recent one.
   */
  private async buildThreadHeaders(
    ticket: Ticket,
    domain: string,
  ): Promise<{ inReplyTo: string; references: string }> {
    const syntheticRoot = `<ticket-${ticket.emailThreadId}@${domain}>`

    const priorIds = await this.db.message
      .findMany({
        where: {
          ticketId: ticket.id,
          deletedAt: null,
          type: 'REPLY',
          isInternal: false,
          messageId: { not: null },
        },
        orderBy: { createdAt: 'asc' },
        select: { messageId: true },
      })
      .then((rows) => rows.map((r) => r.messageId).filter((x): x is string => !!x))

    if (priorIds.length === 0) {
      // No real Message-IDs stored — fall back to synthetic root (portal flow without inbound replies yet)
      return { inReplyTo: syntheticRoot, references: syntheticRoot }
    }

    const inReplyTo = priorIds[priorIds.length - 1]
    const references = priorIds.join(' ')
    return { inReplyTo, references }
  }

  onModuleInit(): void {
    void this.initTransporter()
  }

  async initTransporter(appConfig?: AppConfig): Promise<void> {
    const cfg = appConfig ?? (await this.appConfigService.get())

    // Host/port from env (with Gmail defaults). User/password come from the
    // admin's saved settings (email + app password); falls back to env so the
    // dev seed flow still works before anyone configures via Settings.
    const host = this.config.get<string>('SMTP_HOST') ?? 'smtp.gmail.com'
    const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10)
    const user = cfg.oauthEmail ?? this.config.get<string>('SMTP_USER') ?? ''

    if (cfg.oauthAccessTokenEnc) {
      // OAuth account: build a static transporter; getTransporter() refreshes per-send
      this.transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { type: 'OAuth2', user } })
      this.logger.log(`Email transporter initialized (OAuth2, ${host}:${port} as ${user})`)
      return
    }

    // No OAuth configured — fall back to env SMTP credentials (dev/seed flow)
    const pass = this.config.get<string>('SMTP_PASS') ?? ''
    this.transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    this.logger.log(`Email transporter initialized (${host}:${port} as ${user})`)
  }

  /**
   * Returns a transporter ready to send. For OAuth connections, injects a fresh
   * access token per send so we don't use a stale token from `initTransporter`.
   */
  private async getTransporter(): Promise<nodemailer.Transporter> {
    const cfg = await this.appConfigService.get()

    if (cfg.oauthAccessTokenEnc) {
      const host = this.config.get<string>('SMTP_HOST') ?? 'smtp.gmail.com'
      const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10)
      const user = cfg.oauthEmail ?? this.config.get<string>('SMTP_USER') ?? ''
      const accessToken = await this.tokenRefresher.getValidAccessToken(cfg)
      return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { type: 'OAuth2', user, accessToken },
      })
    }

    return this.transporter
  }

  private getFromAddress(appConfig: AppConfig): string {
    const name = appConfig.emailDisplayName
    const addr = appConfig.oauthEmail ?? this.config.get<string>('SMTP_FROM') ?? 'support@twominutereports.com'
    return `"${name} Support" <${addr}>`
  }

  private getReplyToAddress(ticket: Ticket, appConfig: AppConfig): string {
    // With REST-based inbound, replies are detected by polling — no VERP routing needed.
    // Return the support email directly so customers can reply naturally.
    const fromAddr = appConfig.oauthEmail
      ?? this.config.get<string>('SMTP_FROM')
      ?? 'support@twominutereports.com'
    void ticket // used for future threading if needed
    return fromAddr
  }

  /** Generates a unique RFC 5322 Message-ID for an outbound message */
  private generateMessageId(domain: string): string {
    return `<${crypto.randomUUID()}@${domain}>`
  }

  private getDomain(appConfig: AppConfig): string {
    const fromAddr = appConfig.oauthEmail ?? this.config.get<string>('SMTP_FROM') ?? 'support@twominutereports.com'
    return fromAddr.split('@')[1] ?? 'support.tmr.com'
  }

  /** Returns the thread root Message-ID for In-Reply-To / References headers */
  private getThreadRootMessageId(ticket: Ticket, domain: string): string {
    return `<ticket-${ticket.emailThreadId}@${domain}>`
  }

  async sendTicketConfirmation(ticket: TicketWithUser, appConfig: AppConfig): Promise<void> {
    const displayId = `TMR-${ticket.number}`
    const portalUrl = this.config.get<string>('PORTAL_URL') ?? 'http://localhost:3000'
    const domain = this.getDomain(appConfig)
    const messageId = this.generateMessageId(domain)
    const threadRoot = this.getThreadRootMessageId(ticket, domain)

    try {
      const transport = await this.getTransporter()
      await transport.sendMail({
        from: this.getFromAddress(appConfig),
        to: ticket.user.email,
        subject: `[${displayId}] ${ticket.title}`,
        replyTo: this.getReplyToAddress(ticket, appConfig),
        messageId: threadRoot,
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

      // Store Message-ID on a system event message if one exists, or just log
      this.logger.log(`Sent confirmation for ticket ${ticket.id} (${messageId})`)
    } catch (err) {
      this.logger.error(`Failed to send confirmation for ticket ${ticket.id}: ${String(err)}`)
    }
  }

  async sendAgentReply(
    ticket: TicketWithUser,
    message: MessageWithAgent,
    appConfig: AppConfig,
  ): Promise<string | null> {
    const displayId = `TMR-${ticket.number}`
    const portalUrl = this.config.get<string>('PORTAL_URL') ?? 'http://localhost:3000'
    const domain = this.getDomain(appConfig)
    const { inReplyTo, references } = await this.buildThreadHeaders(ticket, domain)
    const msgId = this.generateMessageId(domain)

    try {
      const transport = await this.getTransporter()
      await transport.sendMail({
        from: this.getFromAddress(appConfig),
        to: ticket.user.email,
        subject: `Re: [${displayId}] ${ticket.title}`,
        replyTo: this.getReplyToAddress(ticket, appConfig),
        messageId: msgId,
        inReplyTo,
        references,
        text: [
          message.body,
          '',
          `View full thread: ${portalUrl}/tickets/${ticket.id}`,
          '',
          `— ${appConfig.appName} Support Team`,
        ].join('\n'),
      })

      this.logger.log(`Sent agent reply email for ticket ${ticket.id} msgId=${msgId}`)
      return msgId
    } catch (err) {
      this.logger.error(`Failed to send reply email for ticket ${ticket.id}: ${String(err)}`)
      return null
    }
  }

  async sendAgentInvite(agent: Agent, appConfig: AppConfig, inviteUrl: string): Promise<void> {
    try {
      const transport = await this.getTransporter()
      await transport.sendMail({
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

  async sendRaw(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
    const appConfig = await this.appConfigService.get()
    const from = this.getFromAddress(appConfig)
    try {
      const transport = await this.getTransporter()
      await transport.sendMail({ from, ...opts })
    } catch (err) {
      this.logger.error(`Failed to send raw email to ${opts.to}: ${String(err)}`)
    }
  }

  /**
   * Send an email via Microsoft Graph REST API (for Microsoft OAuth accounts).
   * Used instead of SMTP XOAUTH2 for Graph-connected mailboxes.
   */
  async sendViaGraph(
    appConfig: AppConfig,
    to: string,
    subject: string,
    body: string,
    _replyToMsgId?: string,
  ): Promise<void> {
    const token = await this.tokenRefresher.getValidAccessToken(appConfig)
    const message: Record<string, unknown> = {
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    }
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok && res.status !== 202) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Graph sendMail failed (${res.status}): ${errBody}`)
    }
    this.logger.log(`Sent email via Graph to ${to}`)
  }
}
