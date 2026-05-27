import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import { PrismaService } from '../database/prisma.service'
import { AppEventsService } from '../../common/events/app-events.service'
import { encrypt } from '../../common/crypto/credentials-cipher'
import type { OAuthProvider } from '@tmr/db'

const HMAC_SECRET_KEY = 'oauth-state-hmac'
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

interface MicrosoftTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

interface GoogleUserInfo {
  email?: string
}

interface MicrosoftUserInfo {
  mail?: string
  userPrincipalName?: string
}

@Injectable()
export class EmailOAuthService {
  private readonly logger = new Logger(EmailOAuthService.name)

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly appEvents: AppEventsService,
  ) {}

  getAuthUrl(provider: OAuthProvider): string {
    const state = this.createState(provider)
    // OAUTH_CALLBACK_BASE is the external URL of the NestJS API — must match what's registered
    // with Google/Microsoft as an authorized redirect URI.
    const redirectBase = this.config.get<string>('OAUTH_CALLBACK_BASE') ?? 'http://localhost:3001'
    const redirectUri = `${redirectBase}/api/v1/config/email/oauth/${provider.toLowerCase()}/callback`

    if (provider === 'GOOGLE') {
      const clientId = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID') ?? ''
      if (!clientId) throw new BadRequestException('Google OAuth is not configured on this server')
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://mail.google.com/ email profile',
        access_type: 'offline',
        prompt: 'consent',
        state,
      })
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    }

    if (provider === 'MICROSOFT') {
      const clientId = this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID') ?? ''
      if (!clientId) throw new BadRequestException('Microsoft OAuth is not configured on this server')
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'Mail.ReadWrite Mail.Send offline_access email profile',
        state,
      })
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
    }

    throw new BadRequestException(`Unknown OAuth provider: ${String(provider)}`)
  }

  async exchangeCode(provider: OAuthProvider, code: string, state: string): Promise<void> {
    this.verifyState(state, provider)

    const redirectBase = this.config.get<string>('OAUTH_CALLBACK_BASE') ?? 'http://localhost:3001'
    const redirectUri = `${redirectBase}/api/v1/config/email/oauth/${provider.toLowerCase()}/callback`

    let accessToken: string
    let refreshToken: string
    let expiresIn: number
    let email: string

    if (provider === 'GOOGLE') {
      const tokenData = await this.exchangeGoogleCode(code, redirectUri)
      accessToken = tokenData.accessToken
      refreshToken = tokenData.refreshToken
      expiresIn = tokenData.expiresIn
      email = await this.getGoogleEmail(accessToken)
    } else if (provider === 'MICROSOFT') {
      const tokenData = await this.exchangeMicrosoftCode(code, redirectUri)
      accessToken = tokenData.accessToken
      refreshToken = tokenData.refreshToken
      expiresIn = tokenData.expiresIn
      email = await this.getMicrosoftEmail(accessToken)
    } else {
      throw new BadRequestException(`Unknown provider: ${String(provider)}`)
    }

    const cfg = await this.db.appConfig.findFirst()
    if (!cfg) throw new BadRequestException('AppConfig not found')

    const expiresAt = new Date(Date.now() + expiresIn * 1000)

    await this.db.appConfig.update({
      where: { id: cfg.id },
      data: {
        oauthProvider: provider,
        oauthEmail: email,
        oauthAccessTokenEnc: encrypt(accessToken),
        oauthRefreshTokenEnc: encrypt(refreshToken),
        oauthTokenExpiresAt: expiresAt,
        // Reset archive state on reconnect
        archiveStatus: 'IDLE',
        archiveTotalSeen: null,
        archiveTotalEstimate: null,
        archivePageToken: null,
        gmailHistoryId: null,
        graphDeltaLink: null,
      },
    })

    this.logger.log(`OAuth connected: provider=${provider} email=${email}`)
    this.appEvents.emitEmailConfigUpdated()
    this.appEvents.emitOAuthConnected(cfg.id)
  }

  async disconnectOAuth(): Promise<void> {
    const cfg = await this.db.appConfig.findFirst()
    if (!cfg) return

    await this.db.appConfig.update({
      where: { id: cfg.id },
      data: {
        oauthProvider: null,
        oauthEmail: null,
        oauthAccessTokenEnc: null,
        oauthRefreshTokenEnc: null,
        oauthTokenExpiresAt: null,
        oauthScopes: null,
        oauthAliases: [],
        archiveStatus: 'IDLE',
        archiveTotalSeen: null,
        archiveTotalEstimate: null,
        archivePageToken: null,
        gmailHistoryId: null,
        graphDeltaLink: null,
      },
    })

    this.appEvents.emitEmailConfigUpdated()
  }

  // ─── HMAC-signed state ─────────────────────────────────────────────────────

  private getHmacKey(): string {
    return (this.config.get<string>('EMAIL_CREDS_KEY') ?? '') + HMAC_SECRET_KEY
  }

  private createState(provider: OAuthProvider): string {
    const payload = `${provider}:${Date.now()}`
    const sig = crypto.createHmac('sha256', this.getHmacKey()).update(payload).digest('hex').slice(0, 16)
    return Buffer.from(`${payload}:${sig}`).toString('base64url')
  }

  private verifyState(state: string, provider: OAuthProvider): void {
    let decoded: string
    try {
      decoded = Buffer.from(state, 'base64url').toString()
    } catch {
      throw new BadRequestException('Invalid OAuth state')
    }

    const parts = decoded.split(':')
    if (parts.length !== 3) throw new BadRequestException('Malformed OAuth state')
    const [stateProvider, ts, sig] = parts as [string, string, string]

    if (stateProvider !== provider) throw new BadRequestException('OAuth state provider mismatch')

    const age = Date.now() - parseInt(ts, 10)
    if (age > STATE_TTL_MS) throw new BadRequestException('OAuth state expired')

    const expected = crypto.createHmac('sha256', this.getHmacKey())
      .update(`${stateProvider}:${ts}`).digest('hex').slice(0, 16)
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new BadRequestException('OAuth state signature invalid')
    }
  }

  // ─── Provider token exchanges ──────────────────────────────────────────────

  private async exchangeGoogleCode(code: string, redirectUri: string) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID') ?? '',
        client_secret: this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET') ?? '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as GoogleTokenResponse
    if (data.error || !data.access_token || !data.refresh_token) {
      throw new BadRequestException(data.error_description ?? data.error ?? 'Google code exchange failed')
    }
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in ?? 3600 }
  }

  private async getGoogleEmail(accessToken: string): Promise<string> {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as GoogleUserInfo
    if (!data.email) throw new BadRequestException('Could not retrieve Gmail address')
    return data.email
  }

  private async exchangeMicrosoftCode(code: string, redirectUri: string) {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID') ?? '',
        client_secret: this.config.get<string>('MICROSOFT_OAUTH_CLIENT_SECRET') ?? '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'Mail.ReadWrite Mail.Send offline_access email profile',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as MicrosoftTokenResponse
    if (data.error || !data.access_token || !data.refresh_token) {
      throw new BadRequestException(data.error_description ?? data.error ?? 'Microsoft code exchange failed')
    }
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in ?? 3600 }
  }

  private async getMicrosoftEmail(accessToken: string): Promise<string> {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as MicrosoftUserInfo
    const email = data.mail ?? data.userPrincipalName
    if (!email) throw new BadRequestException('Could not retrieve Microsoft email address')
    return email
  }
}
