import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { AppConfigService } from '../config/config.service'
import { QueueService } from '../queue/queue.service'
import { AppEventsService } from '../../common/events/app-events.service'
import { decrypt } from '../../common/crypto/credentials-cipher'

type ImapStatus = 'connected' | 'reconnecting' | 'disabled' | 'error'

/**
 * IMAP supervisor.
 *
 * Lifecycle: a single supervisor token (`connectionId`) gates all in-flight work.
 * When we tear down (config change, error, disconnect) we bump the token so any
 * still-running fetch/idle handlers exit without touching the new client. This
 * prevents the hot-loop where a dead client's error handler kept calling
 * processNewMessages on every iteration.
 */
@Injectable()
export class ImapClientService implements OnModuleDestroy {
  private readonly logger = new Logger(ImapClientService.name)

  private client: ImapFlow | null = null
  private connectionId = 0
  private reconnecting = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private destroyed = false
  private pendingUids: Set<number> = new Set()
  private lastUid = 0
  private folder = 'INBOX'
  private processing = false

  status: ImapStatus = 'disabled'
  lastMessageAt: Date | null = null
  messagesReceivedToday = 0

  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly queueService: QueueService,
    private readonly appEvents: AppEventsService,
    private readonly config: ConfigService,
  ) {
    this.appEvents.onEmailConfigUpdated(() => {
      this.logger.log('Email config updated — reconnecting IMAP')
      void this.reconnect()
    })
  }

  async start(): Promise<void> {
    const cfg = await this.appConfigService.get()
    if (!cfg.inboundEnabled) {
      this.logger.log('Inbound email disabled — IMAP client not started')
      this.status = 'disabled'
      return
    }
    await this.connect()
  }

  /**
   * Bring up a fresh client. Increments connectionId so any prior in-flight
   * handlers know to bail out. Does NOT await the long-lived IDLE loop — that
   * runs in the background.
   */
  private async connect(): Promise<void> {
    if (this.destroyed) return

    const cfg = await this.appConfigService.get()

    if (!cfg.inboundEnabled || !cfg.imapUser || !cfg.imapPasswordEnc) {
      this.logger.warn('IMAP not configured or disabled — skipping connect')
      this.status = 'disabled'
      return
    }

    let password: string
    try {
      password = decrypt(cfg.imapPasswordEnc)
    } catch {
      this.logger.error('Failed to decrypt IMAP password — aborting connect')
      this.status = 'error'
      return
    }

    // Tear down any existing client before creating a new one
    await this.teardown()

    const myId = ++this.connectionId
    // Host/port come from env (with Gmail defaults) — users only enter email + app password
    const host = this.config.get<string>('IMAP_HOST') ?? 'imap.gmail.com'
    const port = parseInt(this.config.get<string>('IMAP_PORT') ?? '993', 10)
    this.folder = 'INBOX'

    const client = new ImapFlow({
      host,
      port,
      secure: true,
      auth: { user: cfg.imapUser, pass: password },
      logger: false,
    })
    this.client = client

    // Event wiring — all handlers check connectionId to avoid acting on a stale client
    client.on('error', (err: Error) => {
      if (myId !== this.connectionId) return
      this.logger.error(`IMAP error: ${err.message}`)
      this.handleDisconnect(myId)
    })
    client.on('close', () => {
      if (myId !== this.connectionId) return
      this.logger.warn('IMAP connection closed')
      this.handleDisconnect(myId)
    })
    client.on('exists', () => {
      if (myId !== this.connectionId) return
      void this.drainNewMail(myId)
    })

    try {
      await client.connect()
      if (myId !== this.connectionId) {
        // We were superseded mid-connect — drop this client
        try { await client.logout() } catch { /* ignore */ }
        return
      }

      this.reconnectAttempt = 0
      this.status = 'connected'
      this.logger.log(`IMAP connected to ${host} as ${cfg.imapUser}`)

      // Open mailbox in persistent mode (no lock held — single-supervisor design)
      await client.mailboxOpen(this.folder)

      // Bootstrap cursor on first connect: park at current tip
      let startUid = cfg.inboundLastUid ?? 0
      if (startUid === 0) {
        const mailbox = client.mailbox
        const uidNext =
          mailbox && typeof mailbox === 'object' && 'uidNext' in mailbox
            ? (mailbox as { uidNext?: number }).uidNext
            : undefined
        startUid = Math.max(0, (uidNext ?? 1) - 1)
        await this.appConfigService.updateInboundLastUid(startUid)
        this.logger.log(`First connect — parking cursor at UID ${startUid} (will only ingest new mail)`)
      }
      this.lastUid = startUid

      // Drain any mail that arrived while we were offline
      await this.drainNewMail(myId)

      // Enter IDLE in the background — fire-and-forget, not awaited
      void this.runIdle(myId)
    } catch (err) {
      this.logger.error(`IMAP connect failed: ${String(err)}`)
      this.status = 'error'
      await this.scheduleReconnect()
    }
  }

  /**
   * Persistent IDLE loop for this connection. Runs until the connection dies or
   * is superseded. NOT awaited by connect().
   */
  private async runIdle(myId: number): Promise<void> {
    while (!this.destroyed && myId === this.connectionId && this.client) {
      try {
        await this.client.idle()
        // idle() resolves on EXISTS event (drainNewMail already runs via 'exists' listener)
        // or when the server breaks IDLE. Just loop and re-enter.
      } catch (err) {
        if (myId !== this.connectionId) return
        this.logger.warn(`IDLE ended: ${String(err)}`)
        this.handleDisconnect(myId)
        return
      }
    }
  }

  /**
   * Fetch and enqueue any new mail since this.lastUid. Guarded against
   * concurrent invocation (the 'exists' event can fire while a drain is in
   * progress).
   */
  private async drainNewMail(myId: number): Promise<void> {
    if (this.processing) return
    if (myId !== this.connectionId || !this.client) return

    this.processing = true
    try {
      const client = this.client
      const fromUid = this.lastUid > 0 ? this.lastUid + 1 : 1

      try {
        const messages = client.fetch({ uid: `${fromUid}:*` }, { uid: true, source: true })
        for await (const msg of messages) {
          if (myId !== this.connectionId || this.destroyed) return
          await this.enqueueMessage(msg)
          if (msg.uid > this.lastUid) this.lastUid = msg.uid
        }
        await this.appConfigService.updateInboundLastUid(this.lastUid).catch(() => undefined)
      } catch (err) {
        if (myId !== this.connectionId) return
        // Connection-level errors are fatal for this supervisor — let the close/error
        // handlers schedule reconnect. Don't loop here.
        this.logger.error(`Error fetching messages: ${String(err)}`)
      }
    } finally {
      this.processing = false
    }
  }

  private async enqueueMessage(msg: FetchMessageObject): Promise<void> {
    if (this.pendingUids.has(msg.uid)) return
    this.pendingUids.add(msg.uid)

    try {
      const rawMime = msg.source?.toString('utf8') ?? ''
      await this.queueService.enqueueInbound({
        uid: msg.uid,
        rawMime,
        receivedAt: new Date().toISOString(),
      })
      this.lastMessageAt = new Date()
      this.messagesReceivedToday++
      this.logger.log(`Enqueued inbound email uid=${msg.uid}`)
    } catch (err) {
      this.logger.error(`Failed to enqueue uid=${msg.uid}: ${String(err)}`)
      this.pendingUids.delete(msg.uid)
    }
  }

  /** Called by InboundEmailProcessor after successful job completion */
  async markSeen(uid: number): Promise<void> {
    if (!this.client || this.status !== 'connected') {
      this.pendingUids.delete(uid)
      return
    }
    try {
      await this.client.messageFlagsAdd({ uid: uid.toString() }, ['\\Seen'], { uid: true })
    } catch (err) {
      this.logger.warn(`Failed to mark uid=${uid} as Seen: ${String(err)}`)
    } finally {
      this.pendingUids.delete(uid)
    }
  }

  async reconnect(): Promise<void> {
    if (this.reconnecting) return
    this.reconnecting = true
    try {
      this.clearReconnectTimer()
      await this.connect()
    } finally {
      this.reconnecting = false
    }
  }

  /**
   * Called from error/close event handlers. Bumps the connection token (so any
   * still-running drain/idle handlers exit) and schedules a reconnect.
   */
  private handleDisconnect(myId: number): void {
    if (myId !== this.connectionId) return // already superseded
    this.status = 'error'
    void this.scheduleReconnect()
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.destroyed) return
    if (this.reconnectTimer) return // already scheduled
    this.status = 'reconnecting'
    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempt++), 60_000)
    this.logger.log(`Reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delayMs)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async teardown(): Promise<void> {
    // Bump the token so any in-flight handlers bail
    this.connectionId++
    this.processing = false
    if (this.client) {
      const old = this.client
      this.client = null
      try { await old.logout() } catch { /* ignore */ }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true
    this.clearReconnectTimer()
    await this.teardown()
  }
}
