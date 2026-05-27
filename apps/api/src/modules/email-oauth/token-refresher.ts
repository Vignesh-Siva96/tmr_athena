import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../database/prisma.service'
import { encrypt, decrypt } from '../../common/crypto/credentials-cipher'
import type { AppConfig } from '@tmr/db'

const REFRESH_BUFFER_MS = 5 * 60 * 1000

@Injectable()
export class TokenRefresher {
  private readonly logger = new Logger(TokenRefresher.name)
  private readonly refreshLocks = new Map<string, Promise<string>>()

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Returns a valid access token for the given AppConfig.
   * Automatically refreshes if within 5 minutes of expiry.
   * Dedupes concurrent refresh requests per account.
   */
  async getValidAccessToken(cfg: AppConfig): Promise<string> {
    if (!cfg.oauthAccessTokenEnc || !cfg.oauthRefreshTokenEnc) {
      throw new Error('OAuth tokens not present in config')
    }

    const expiresAt = cfg.oauthTokenExpiresAt
    const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS

    if (!needsRefresh) {
      return decrypt(cfg.oauthAccessTokenEnc)
    }

    // Dedupe concurrent refresh requests for the same account
    const existing = this.refreshLocks.get(cfg.id)
    if (existing) return existing

    const promise = this.doRefresh(cfg).finally(() => {
      this.refreshLocks.delete(cfg.id)
    })
    this.refreshLocks.set(cfg.id, promise)
    return promise
  }

  private async doRefresh(cfg: AppConfig): Promise<string> {
    this.logger.log(`Refreshing OAuth token for ${cfg.id} (provider=${cfg.oauthProvider ?? 'unknown'})`)
    const refreshToken = decrypt(cfg.oauthRefreshTokenEnc!)

    let newToken: { accessToken: string; expiresIn: number }
    if (cfg.oauthProvider === 'GOOGLE') {
      newToken = await this.refreshGoogle(refreshToken)
    } else if (cfg.oauthProvider === 'MICROSOFT') {
      newToken = await this.refreshMicrosoft(refreshToken)
    } else {
      throw new Error(`Unknown OAuth provider: ${String(cfg.oauthProvider)}`)
    }

    const newExpiry = new Date(Date.now() + newToken.expiresIn * 1000)
    await this.db.appConfig.update({
      where: { id: cfg.id },
      data: {
        oauthAccessTokenEnc: encrypt(newToken.accessToken),
        oauthTokenExpiresAt: newExpiry,
      },
    })

    this.logger.log(`Token refreshed for ${cfg.id} — expires ${newExpiry.toISOString()}`)
    return newToken.accessToken
  }

  private async refreshGoogle(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const clientId = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID') ?? ''
    const clientSecret = this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET') ?? ''
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as { access_token?: string; expires_in?: number; error?: string }
    if (data.error || !data.access_token) {
      throw new Error(`Google refresh failed: ${data.error ?? 'no access_token'}`)
    }
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 }
  }

  private async refreshMicrosoft(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const clientId = this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID') ?? ''
    const clientSecret = this.config.get<string>('MICROSOFT_OAUTH_CLIENT_SECRET') ?? ''
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'Mail.ReadWrite Mail.Send offline_access email profile',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    if (data.error || !data.access_token) {
      throw new Error(`Microsoft refresh failed: ${data.error} — ${data.error_description ?? ''}`)
    }
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 }
  }
}
