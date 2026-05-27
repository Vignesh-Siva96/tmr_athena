import { Controller, Get, Delete, Query, Param, Res, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common'
import type { Response } from 'express'
import { EmailOAuthService } from './email-oauth.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import type { Agent, OAuthProvider } from '@tmr/db'

const VALID_PROVIDERS: OAuthProvider[] = ['GOOGLE', 'MICROSOFT']

function toProvider(raw: string): OAuthProvider {
  const upper = raw.toUpperCase() as OAuthProvider
  if (!VALID_PROVIDERS.includes(upper)) {
    throw new BadRequestException(`Invalid OAuth provider: ${raw}`)
  }
  return upper
}

@Controller('config/email/oauth')
export class EmailOAuthController {
  constructor(private readonly oauthService: EmailOAuthService) {}

  /**
   * Returns the provider's OAuth authorization URL.
   * Bridge opens this URL to start the consent flow.
   */
  @Get(':provider/start')
  @UseGuards(AuthGuard, AgentGuard)
  getAuthUrl(
    @CurrentAgent() agent: Agent,
    @Param('provider') provider: string,
  ) {
    if (agent.role !== 'ADMIN') throw new ForbiddenException('Admin access required')
    const url = this.oauthService.getAuthUrl(toProvider(provider))
    return { url }
  }

  /**
   * OAuth redirect callback. Google / Microsoft redirect here with `code` + `state`.
   * Exchanges the code, stores encrypted tokens, and redirects to Bridge settings.
   * The EmailOAuthService emits 'oauth-connected' event; EmailSyncBackfillService
   * listens and triggers foreground backfill — no circular dep.
   */
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const bridgeBase = process.env['BRIDGE_URL'] ?? 'http://localhost:3002'

    if (error) {
      return res.redirect(`${bridgeBase}/settings/email?oauth_error=${encodeURIComponent(error)}`)
    }

    if (!code || !state) {
      return res.redirect(`${bridgeBase}/settings/email?oauth_error=missing_params`)
    }

    try {
      await this.oauthService.exchangeCode(toProvider(provider), code, state)
      return res.redirect(`${bridgeBase}/settings/email?connected=1`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error'
      return res.redirect(`${bridgeBase}/settings/email?oauth_error=${encodeURIComponent(msg)}`)
    }
  }

  @Delete('disconnect')
  @UseGuards(AuthGuard, AgentGuard)
  async disconnect(@CurrentAgent() agent: Agent) {
    if (agent.role !== 'ADMIN') throw new ForbiddenException('Admin access required')
    await this.oauthService.disconnectOAuth()
    return { ok: true }
  }
}
