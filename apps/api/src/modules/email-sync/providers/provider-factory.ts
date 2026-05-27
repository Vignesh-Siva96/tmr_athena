import { Injectable } from '@nestjs/common'
import { TokenRefresher } from '../../email-oauth/token-refresher'
import { GmailProvider } from './gmail.provider'
import { GraphProvider } from './graph.provider'
import type { IMailProvider } from './mail-provider.interface'
import type { AppConfig } from '@tmr/db'

@Injectable()
export class ProviderFactory {
  constructor(private readonly tokenRefresher: TokenRefresher) {}

  for(cfg: AppConfig): IMailProvider {
    const aliases = [
      cfg.oauthEmail ?? '',
      ...((cfg as unknown as { oauthAliases?: string[] }).oauthAliases ?? []),
    ].filter(Boolean).map((a: string) => a.toLowerCase())

    if (cfg.oauthProvider === 'GOOGLE') {
      return new GmailProvider(aliases, () => this.tokenRefresher.getValidAccessToken(cfg))
    }

    if (cfg.oauthProvider === 'MICROSOFT') {
      return new GraphProvider(aliases, () => this.tokenRefresher.getValidAccessToken(cfg))
    }

    throw new Error(`No provider for oauthProvider=${String(cfg.oauthProvider)}`)
  }
}
