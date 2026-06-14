import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'
import * as crypto from 'crypto'
import { AppConfigService } from '../config/config.service'
import { PrismaService } from '../database/prisma.service'
import { TokenRefresher } from '../email-oauth/token-refresher'
import { MailCaptureService } from '../test-utils/mail-capture.service'
import type { Ticket, Agent, Message, AppConfig, User } from '@tmr/db'
import { formatRef } from '../tickets/util/generate-ref'

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
    // Test-only: present only when TestUtilsModule is loaded (NODE_ENV === 'test').
    // E2E flows assert on captured mail via GET /__test/captured-mail.
    @Optional() private readonly mailCapture?: MailCaptureService,
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
   *
   * Test mode (NODE_ENV === 'test' and MailCaptureService is present): returns a
   * fake transporter that records every sendMail call into the in-memory bucket
   * exposed by GET /__test/captured-mail. No SMTP traffic leaves the process.
   */
  private async getTransporter(): Promise<nodemailer.Transporter> {
    if (this.mailCapture) {
      return this.makeCapturingTransport()
    }
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

  /**
   * Build a fake transporter whose sendMail records the message into
   * MailCaptureService instead of dispatching via SMTP. Returns nodemailer's
   * standard `info` shape so callers (e.g. `sendAgentReply`) can still read
   * `info.messageId` and `info.envelope`.
   */
  private makeCapturingTransport(): nodemailer.Transporter {
    const capture = this.mailCapture!
    const toHeadersRecord = (mail: nodemailer.SendMailOptions): Record<string, string> => {
      const h: Record<string, string> = {}
      if (mail.messageId) h['Message-ID'] = String(mail.messageId)
      if (mail.inReplyTo) h['In-Reply-To'] = String(mail.inReplyTo)
      if (mail.references) {
        h['References'] = Array.isArray(mail.references) ? mail.references.join(' ') : String(mail.references)
      }
      if (mail.subject) h['Subject'] = String(mail.subject)
      if (mail.from) h['From'] = String(mail.from)
      const to = Array.isArray(mail.to) ? mail.to.join(', ') : String(mail.to ?? '')
      h['To'] = to
      if (mail.replyTo) h['Reply-To'] = String(mail.replyTo)
      return h
    }

    const fake = {
      sendMail: async (mail: nodemailer.SendMailOptions) => {
        const headers = toHeadersRecord(mail)
        type AddrLike = string | { address: string }
        const addrStr = (v: AddrLike): string => typeof v === 'string' ? v : v.address
        const to = mail.to
          ? Array.isArray(mail.to)
            ? mail.to.map((r) => addrStr(r as AddrLike))
            : addrStr(mail.to as AddrLike)
          : ''
        capture.capture({
          ts: new Date().toISOString(),
          from: mail.from ? addrStr(mail.from as AddrLike) : undefined,
          to,
          subject: mail.subject ? String(mail.subject) : undefined,
          text: typeof mail.text === 'string' ? mail.text : undefined,
          html: typeof mail.html === 'string' ? mail.html : undefined,
          headers,
          raw: JSON.stringify({ ...mail, attachments: undefined }),
        })
        return {
          envelope: { from: headers['From'], to: Array.isArray(to) ? to : [to] },
          messageId: headers['Message-ID'] ?? '',
          accepted: Array.isArray(to) ? to : [to],
          rejected: [],
          pending: [],
          response: '250 Captured by MailCaptureService',
        }
      },
      verify: async () => true,
      close: () => undefined,
    } as unknown as nodemailer.Transporter
    return fake
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
    const displayId = formatRef(ticket.ref)
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
    const displayId = formatRef(ticket.ref)
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

  /**
   * Mirror a customer portal reply into the support mailbox as a self-addressed copy.
   * From: support, To: support inbox, Reply-To: customer, threaded with existing headers.
   * Gmail/Graph threads it under the existing conversation. The returned Message-ID
   * must be stored on the portal Message row so the poller deduplicates it on the next poll.
   */
  async sendPortalReplyCopy(
    ticket: TicketWithUser,
    message: { body: string },
    appConfig: AppConfig,
  ): Promise<string | null> {
    const displayId = formatRef(ticket.ref)
    const domain = this.getDomain(appConfig)
    const { inReplyTo, references } = await this.buildThreadHeaders(ticket, domain)
    const msgId = this.generateMessageId(domain)
    const supportAddr = appConfig.oauthEmail ?? this.config.get<string>('SMTP_FROM') ?? 'support@twominutereports.com'

    try {
      const transport = await this.getTransporter()
      await transport.sendMail({
        from: this.getFromAddress(appConfig),
        to: supportAddr,
        replyTo: ticket.user.email,
        subject: `Re: [${displayId}] ${ticket.title}`,
        messageId: msgId,
        inReplyTo,
        references,
        text: `[Portal reply from ${ticket.user.name ?? ticket.user.email} <${ticket.user.email}>]\n\n${message.body}`,
      })
      this.logger.log(`Sent portal reply copy for ticket ${ticket.id} msgId=${msgId}`)
      return msgId
    } catch (err) {
      this.logger.error(`Failed to send portal reply copy for ticket ${ticket.id}: ${String(err)}`)
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

  async sendEscalationNotification(ticket: TicketWithUser, appConfig: AppConfig): Promise<void> {
    const displayId = formatRef(ticket.ref)
    const portalUrl = this.config.get<string>('PORTAL_URL') ?? 'http://localhost:3000'
    try {
      const transport = await this.getTransporter()
      await transport.sendMail({
        from: this.getFromAddress(appConfig),
        to: ticket.user.email,
        subject: `Re: [${displayId}] ${ticket.title}`,
        replyTo: this.getReplyToAddress(ticket, appConfig),
        text: [
          `Hi ${ticket.user.name ?? 'there'},`,
          '',
          `Thanks for your message. Our team has picked up your ticket and a support specialist will follow up shortly.`,
          '',
          `Ticket: ${displayId}`,
          `View your ticket: ${portalUrl}/tickets/${ticket.id}`,
          '',
          `— ${appConfig.appName} Support Team`,
        ].join('\n'),
      })
      this.logger.log(`Sent escalation notification for ticket ${ticket.id}`)
    } catch (err) {
      this.logger.error(`Failed to send escalation notification for ticket ${ticket.id}: ${String(err)}`)
    }
  }

  async sendEmailVerification(user: User, verifyUrl: string, appConfig: AppConfig): Promise<void> {
    try {
      const transport = await this.getTransporter()
      await transport.sendMail({
        from: this.getFromAddress(appConfig),
        to: user.email,
        subject: `Verify your email for ${appConfig.appName}`,
        text: [
          `Hi ${user.name ?? 'there'},`,
          '',
          `Please confirm your email address by clicking the link below:`,
          '',
          verifyUrl,
          '',
          `This link expires in 24 hours.`,
          '',
          `— ${appConfig.appName} Support Team`,
        ].join('\n'),
      })
      this.logger.log(`Sent verification email to ${user.email}`)
    } catch (err) {
      this.logger.error(`Failed to send verification email to ${user.email}: ${String(err)}`)
    }
  }

  async sendPasswordReset(user: User, resetUrl: string, appConfig: AppConfig): Promise<void> {
    try {
      const transport = await this.getTransporter()
      await transport.sendMail({
        from: this.getFromAddress(appConfig),
        to: user.email,
        subject: `Reset your password for ${appConfig.appName}`,
        text: [
          `Hi ${user.name ?? 'there'},`,
          '',
          `We received a request to reset your password. Click the link below to choose a new one:`,
          '',
          resetUrl,
          '',
          `This link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
          '',
          `— ${appConfig.appName} Support Team`,
        ].join('\n'),
      })
      this.logger.log(`Sent password reset email to ${user.email}`)
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${user.email}: ${String(err)}`)
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
