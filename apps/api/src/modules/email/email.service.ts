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

interface GmailSendResponse { id: string; threadId: string; rfcMessageId?: string }

type TicketWithUser = Ticket & {
  user: { id: string; email: string; name: string | null }
}

type MessageWithAgent = Message & {
  authorAgent: { id: string; name: string } | null
}

/** A message not yet delivered to the customer's email — input to `renderQuotedHistory`. */
interface QuotableMessage {
  id: string
  body: string
  createdAt: Date
  authorBotName: string | null
  authorUser: { name: string | null } | null
  authorAgent: { name: string } | null
}

interface SendResult {
  /** RFC Message-ID of the email actually sent (Gmail-assigned where available). */
  messageId: string
  /** Ids of prior messages whose content was quoted in this send — mark `customerEmailedAt` on success. */
  quotedMessageIds: string[]
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
   * Gmail rewrites the sender-supplied Message-ID on send, discarding our
   * synthetic ids. Every send path captures the Gmail-assigned id afterwards
   * (see `gmailApiSend`'s follow-up `messages.get`) and persists it to
   * `Message.messageId` — including the confirmation's `SYSTEM_EVENT` row, which
   * acts as the thread root. We build `References` as the full ordered chain of
   * those real Message-IDs, and `In-Reply-To` as the most recent one. Internal
   * notes are naturally excluded since they're never emailed and carry no
   * `messageId`.
   *
   * If no real ids are stored yet (first-ever send on a portal-originated
   * ticket), fall back to the synthetic `<ticket-<id>@domain>` root.
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

    // Gmail OAuth accounts now send via the Gmail REST API — no SMTP transporter needed.
    // Microsoft OAuth and plain-SMTP fallback still use Nodemailer.
    if (cfg.oauthProvider === 'GOOGLE' && cfg.oauthAccessTokenEnc) {
      this.logger.log(`Gmail account connected — outbound mail will use Gmail API (not SMTP)`)
      return
    }

    const host = this.config.get<string>('SMTP_HOST') ?? 'smtp.gmail.com'
    const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10)
    const user = cfg.oauthEmail ?? this.config.get<string>('SMTP_USER') ?? ''

    if (cfg.oauthAccessTokenEnc) {
      // Microsoft OAuth: still uses SMTP XOAUTH2
      this.transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { type: 'OAuth2', user } })
      this.logger.log(`Email transporter initialized (OAuth2/SMTP, ${host}:${port} as ${user})`)
      return
    }

    // No OAuth — fall back to env SMTP credentials (dev/seed flow)
    const pass = this.config.get<string>('SMTP_PASS') ?? ''
    this.transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    this.logger.log(`Email transporter initialized (${host}:${port} as ${user})`)
  }

  /**
   * Returns a nodemailer transporter for non-Gmail sends (Microsoft OAuth XOAUTH2 or
   * plain SMTP). Gmail OAuth sends bypass this and use `gmailApiSend` instead.
   */
  private async getSmtpTransporter(): Promise<nodemailer.Transporter> {
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
   * Build a raw RFC 2822 MIME buffer from nodemailer mail options without dispatching
   * it over SMTP. Used to hand the encoded message to the Gmail REST API.
   */
  private buildMimeBuffer(opts: nodemailer.SendMailOptions): Promise<Buffer> {
    const transport = nodemailer.createTransport({ streamTransport: true, newline: 'unix' })
    return new Promise<Buffer>((resolve, reject) => {
      transport.sendMail(opts, (err, info) => {
        if (err) return reject(err)
        const stream = info.message as NodeJS.EventEmitter & { on(event: 'data', cb: (chunk: unknown) => void): unknown; on(event: 'end', cb: () => void): unknown; on(event: 'error', cb: (e: Error) => void): unknown }
        const chunks: Buffer[] = []
        stream.on('data', (chunk: unknown) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        })
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', (e) => reject(e))
      })
    })
  }

  /**
   * Send a pre-composed message via the Gmail REST API.
   * Throws on any non-2xx response so the queue worker can retry.
   */
  private async gmailApiSend(
    token: string,
    opts: nodemailer.SendMailOptions,
    gmailThreadId?: string | null,
  ): Promise<GmailSendResponse> {
    const mimeBuffer = await this.buildMimeBuffer(opts)
    const body: Record<string, string> = { raw: mimeBuffer.toString('base64url') }
    if (gmailThreadId) body.threadId = gmailThreadId

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Gmail API send failed (${res.status}): ${errBody}`)
    }
    const result = await res.json() as GmailSendResponse
    this.logger.log(`Sent via Gmail API gmailMsgId=${result.id} threadId=${result.threadId}`)

    // Gmail rewrites the sender-supplied Message-ID header on send (e.g. our
    // <ticket-...@gmail.com> becomes <CAM...@mail.gmail.com>). The synthetic id is
    // useless for recipient-side threading — fetch the id Gmail actually assigned
    // so callers can persist it and chain References from it.
    try {
      const metaRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${result.id}?format=metadata&metadataHeaders=Message-ID`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        },
      )
      if (metaRes.ok) {
        const meta = await metaRes.json() as { payload?: { headers?: { name: string; value: string }[] } }
        const header = meta.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')
        if (header?.value) result.rfcMessageId = header.value
      } else {
        this.logger.warn(`Failed to fetch assigned Message-ID for gmailMsgId=${result.id}: ${metaRes.status}`)
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch assigned Message-ID for gmailMsgId=${result.id}: ${String(err)}`)
    }

    return result
  }

  /**
   * Unified send: routes to Gmail API (Google OAuth), capturing transport (test),
   * or plain SMTP. Callers must NOT wrap this in try/catch — errors propagate so
   * the queue worker can retry and eventually write email_delivery_failed.
   */
  private async send(
    opts: nodemailer.SendMailOptions,
    appConfig: AppConfig,
    gmailThreadId?: string | null,
  ): Promise<GmailSendResponse | null> {
    if (this.mailCapture) {
      const transport = this.makeCapturingTransport()
      await transport.sendMail(opts)
      return null
    }

    if (appConfig.oauthProvider === 'GOOGLE' && appConfig.oauthAccessTokenEnc) {
      const token = await this.tokenRefresher.getValidAccessToken(appConfig)
      return this.gmailApiSend(token, opts, gmailThreadId)
    }

    const transport = await this.getSmtpTransporter()
    await transport.sendMail(opts)
    return null
  }

  /**
   * Persist the Gmail thread id onto the ticket the first time we learn it.
   *
   * Gmail's REST API only threads a sent message when the request carries the
   * thread's `threadId` — unlike SMTP, matching References/In-Reply-To headers
   * alone are not enough. Portal-originated tickets have no `externalThreadId`
   * until an inbound email arrives, so the first outbound (the confirmation)
   * would otherwise start a fresh Gmail thread, and every agent reply after it
   * would too. Capturing the threadId Gmail returns and stamping it on the
   * ticket means all subsequent sends reuse the same thread.
   */
  private async stampGmailThreadId(ticketId: string, result: GmailSendResponse | null): Promise<void> {
    if (!result?.threadId) return
    // Only set it if still empty — never clobber a thread id from inbound ingestion.
    await this.db.ticket.updateMany({
      where: { id: ticketId, externalThreadId: null },
      data: { externalThreadId: result.threadId },
    })
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
      if (mail.cc) h['Cc'] = Array.isArray(mail.cc) ? mail.cc.join(', ') : String(mail.cc)
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
        const cc = mail.cc
          ? Array.isArray(mail.cc)
            ? mail.cc.map((r) => addrStr(r as AddrLike))
            : addrStr(mail.cc as AddrLike)
          : undefined
        capture.capture({
          ts: new Date().toISOString(),
          from: mail.from ? addrStr(mail.from as AddrLike) : undefined,
          to,
          ...(cc !== undefined ? { cc } : {}),
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

  /**
   * Messages whose content the customer has not yet received via email — the "delta"
   * for quote rendering. Excludes internal notes, system events, and anything already
   * sent via (or pre-marked as received via) email.
   *
   * `excludeMessageId` is used by `sendAgentReply` to omit the triggering message,
   * which is sent as the primary body rather than quoted. `sendTicketConfirmation`
   * omits it so the customer's own portal-submitted description is included.
   */
  private async loadUndeliveredHistory(ticketId: string, excludeMessageId?: string): Promise<QuotableMessage[]> {
    return this.db.message.findMany({
      where: {
        ticketId,
        deletedAt: null,
        customerEmailedAt: null,
        isInternal: false,
        type: 'REPLY',
        // `sentVia: { not: 'EMAIL' }` would exclude NULL rows too (SQL three-valued
        // logic) — portal-originated messages have sentVia: null, so they must be
        // included explicitly.
        OR: [{ sentVia: null }, { sentVia: { not: 'EMAIL' } }],
        ...(excludeMessageId ? { id: { not: excludeMessageId } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        body: true,
        createdAt: true,
        authorBotName: true,
        authorUser: { select: { name: true } },
        authorAgent: { select: { name: true } },
      },
    })
  }

  /** Renders prior undelivered messages oldest-first, each `> `-quoted with an attribution line. */
  private renderQuotedHistory(messages: QuotableMessage[]): string {
    if (messages.length === 0) return ''
    const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return messages
      .map((m) => {
        const author = m.authorUser?.name ?? m.authorAgent?.name ?? m.authorBotName ?? 'Support'
        const who = m.authorBotName ? `${author} (bot)` : author
        const quoted = m.body.split('\n').map((line) => `> ${line}`).join('\n')
        return `On ${dateFmt.format(m.createdAt)}, ${who} wrote:\n${quoted}`
      })
      .join('\n\n')
  }

  /** Marks messages as delivered to the customer's email. Idempotent — only un-marked rows are touched. */
  async markMessagesEmailed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return
    await this.db.message.updateMany({
      where: { id: { in: messageIds }, customerEmailedAt: null },
      data: { customerEmailedAt: new Date() },
    })
  }

  async sendTicketConfirmation(ticket: TicketWithUser, appConfig: AppConfig): Promise<SendResult> {
    const displayId = formatRef(ticket.ref)
    const domain = this.getDomain(appConfig)
    const threadRoot = this.getThreadRootMessageId(ticket, domain)
    const gmailThreadId = (ticket as unknown as { externalThreadId?: string | null }).externalThreadId ?? null

    const undelivered = await this.loadUndeliveredHistory(ticket.id)
    const quotedHistory = this.renderQuotedHistory(undelivered)

    const bodyLines = [
      `Hi ${ticket.user.name ?? 'there'},`,
      '',
      `We've received your support ticket and will get back to you shortly.`,
      '',
      `Ticket: ${displayId}`,
      `Subject: ${ticket.title}`,
    ]
    if (quotedHistory) {
      bodyLines.push('', '---', 'Your message:', '', quotedHistory)
    }
    bodyLines.push('', `— ${appConfig.appName} Support Team`)

    const result = await this.send(
      {
        from: this.getFromAddress(appConfig),
        to: ticket.user.email,
        subject: `[${displayId}] ${ticket.title}`,
        replyTo: this.getReplyToAddress(ticket, appConfig),
        messageId: threadRoot,
        text: bodyLines.join('\n'),
      },
      appConfig,
      gmailThreadId,
    )
    await this.stampGmailThreadId(ticket.id, result)

    const realId = result?.rfcMessageId ?? threadRoot
    this.logger.log(`Sent confirmation for ticket ${ticket.id} (${realId})`)
    return { messageId: realId, quotedMessageIds: undelivered.map((m) => m.id) }
  }

  async sendAgentReply(
    ticket: TicketWithUser,
    message: MessageWithAgent,
    appConfig: AppConfig,
  ): Promise<SendResult> {
    const displayId = formatRef(ticket.ref)
    const domain = this.getDomain(appConfig)
    const { inReplyTo, references } = await this.buildThreadHeaders(ticket, domain)
    const msgId = this.generateMessageId(domain)
    const gmailThreadId = (ticket as unknown as { externalThreadId?: string | null }).externalThreadId ?? null

    const bodyLines = [
      message.body,
      '',
      `— ${appConfig.appName} Support Team`,
    ]

    const msgCc = (message as MessageWithAgent & { cc?: string[] }).cc
    const result = await this.send(
      {
        from: this.getFromAddress(appConfig),
        to: ticket.user.email,
        subject: `Re: [${displayId}] ${ticket.title}`,
        replyTo: this.getReplyToAddress(ticket, appConfig),
        messageId: msgId,
        inReplyTo,
        references,
        text: bodyLines.join('\n'),
        ...(msgCc?.length ? { cc: msgCc } : {}),
      },
      appConfig,
      gmailThreadId,
    )
    await this.stampGmailThreadId(ticket.id, result)

    const realId = result?.rfcMessageId ?? msgId
    this.logger.log(`Sent agent reply email for ticket ${ticket.id} msgId=${realId}`)
    return { messageId: realId, quotedMessageIds: [] }
  }

  /**
   * Send a "Received your response" acknowledgement to the customer when they reply
   * from the portal. Threaded into the existing email conversation so both sides
   * (customer inbox + support Sent) have a record of the portal message.
   * The returned Message-ID must be stored on the portal Message row so the poller
   * deduplicates it on the next poll and never re-ingests it as a new message.
   */
  async sendPortalReplyAck(
    ticket: TicketWithUser,
    message: { body: string },
    appConfig: AppConfig,
  ): Promise<string> {
    const displayId = formatRef(ticket.ref)
    const domain = this.getDomain(appConfig)
    const { inReplyTo, references } = await this.buildThreadHeaders(ticket, domain)
    const msgId = this.generateMessageId(domain)
    const gmailThreadId = (ticket as unknown as { externalThreadId?: string | null }).externalThreadId ?? null

    const bodyLines = [
      `Hi ${ticket.user.name ?? 'there'},`,
      '',
      `Received your response:`,
      '',
      message.body,
      '',
      `— ${appConfig.appName} Support Team`,
    ]

    const result = await this.send(
      {
        from: this.getFromAddress(appConfig),
        to: ticket.user.email,
        replyTo: this.getReplyToAddress(ticket, appConfig),
        subject: `Re: [${displayId}] ${ticket.title}`,
        messageId: msgId,
        inReplyTo,
        references,
        text: bodyLines.join('\n'),
      },
      appConfig,
      gmailThreadId,
    )
    await this.stampGmailThreadId(ticket.id, result)
    const realId = result?.rfcMessageId ?? msgId
    this.logger.log(`Sent portal reply ack for ticket ${ticket.id} msgId=${realId}`)
    return realId
  }

  async sendAgentInvite(agent: Agent, appConfig: AppConfig, inviteUrl: string): Promise<void> {
    try {
      await this.send(
        {
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
        },
        appConfig,
      )
      this.logger.log(`Sent invite to agent ${agent.email}`)
    } catch (err) {
      this.logger.error(`Failed to send invite to ${agent.email}: ${String(err)}`)
    }
  }

  async sendEscalationNotification(ticket: TicketWithUser, appConfig: AppConfig): Promise<void> {
    const displayId = formatRef(ticket.ref)
    try {
      await this.send(
        {
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
            '',
            `— ${appConfig.appName} Support Team`,
          ].join('\n'),
        },
        appConfig,
      )
      this.logger.log(`Sent escalation notification for ticket ${ticket.id}`)
    } catch (err) {
      this.logger.error(`Failed to send escalation notification for ticket ${ticket.id}: ${String(err)}`)
    }
  }

  async sendEmailVerification(user: User, verifyUrl: string, appConfig: AppConfig): Promise<void> {
    try {
      await this.send(
        {
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
        },
        appConfig,
      )
      this.logger.log(`Sent verification email to ${user.email}`)
    } catch (err) {
      this.logger.error(`Failed to send verification email to ${user.email}: ${String(err)}`)
    }
  }

  async sendPasswordReset(user: User, resetUrl: string, appConfig: AppConfig): Promise<void> {
    try {
      await this.send(
        {
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
        },
        appConfig,
      )
      this.logger.log(`Sent password reset email to ${user.email}`)
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${user.email}: ${String(err)}`)
    }
  }

  async sendRaw(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
    const appConfig = await this.appConfigService.get()
    const from = this.getFromAddress(appConfig)
    try {
      await this.send({ from, ...opts }, appConfig)
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
