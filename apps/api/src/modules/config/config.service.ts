import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import type { AppConfig } from '@tmr/db'
import { z } from 'zod'

export const updateAppConfigSchema = z.object({
  appName: z.string().min(1).optional(),
  logoUrl: z.string().nullable().optional(),
  portalTagline: z.string().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  emailDisplayName: z.string().optional(),
  supportEmail: z.string().email().nullable().optional(),
  // Portal auth page layout
  portalAuthLayout: z.enum(['MINIMAL', 'BRANDED']).optional(),
  portalHeroHeadline: z.string().max(80).nullable().optional(),
  portalHeroSubheadline: z.string().max(200).nullable().optional(),
  portalFeatures: z.array(z.string()).max(5).optional(),
  // Bot configuration
  botProvider: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC']).nullable().optional(),
  botApiKeyEnc: z.string().nullable().optional(),
  botFallbackAgentId: z.string().nullable().optional(),
  // KB configuration
  kbRootUrl: z.string().url().nullable().optional(),
  // Timezone
  timezone: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.portalAuthLayout === 'BRANDED') {
    if (!data.portalHeroHeadline?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'portalHeroHeadline is required when portalAuthLayout is BRANDED', path: ['portalHeroHeadline'] })
    }
    const features = data.portalFeatures ?? []
    if (features.filter(f => f.trim()).length < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one feature is required when portalAuthLayout is BRANDED', path: ['portalFeatures'] })
    }
  }
})
export type UpdateAppConfigDto = z.infer<typeof updateAppConfigSchema>

@Injectable()
export class AppConfigService {
  constructor(
    private readonly db: PrismaService,
  ) {}

  async get(): Promise<AppConfig> {
    const config = await this.db.appConfig.findFirst()
    if (config) return config
    return this.db.appConfig.create({
      data: {
        appName: 'Support',
        primaryColor: '#2563EB',
        accentColor: '#0EA5E9',
        emailDisplayName: 'Support',
      },
    })
  }

  /** Returns config with OAuth tokens and bot API key redacted (never exposed via API) */
  async getSafe(): Promise<
    Omit<AppConfig, 'oauthAccessTokenEnc' | 'oauthRefreshTokenEnc' | 'botApiKeyEnc'> &
    { oauthConnected: boolean; botKeySet: boolean }
  > {
    const cfg = await this.get()
    const { oauthAccessTokenEnc, oauthRefreshTokenEnc, botApiKeyEnc, ...rest } = cfg
    return {
      ...rest,
      oauthConnected: !!(oauthAccessTokenEnc && oauthRefreshTokenEnc),
      botKeySet: botApiKeyEnc !== null && botApiKeyEnc !== undefined,
    }
  }

  async update(dto: UpdateAppConfigDto): Promise<AppConfig> {
    const config = await this.get()
    const updated = await this.db.appConfig.update({ where: { id: config.id }, data: dto })
    return updated
  }

  async updateLogo(logoUrl: string): Promise<AppConfig> {
    const config = await this.get()
    return this.db.appConfig.update({ where: { id: config.id }, data: { logoUrl } })
  }

  async findActiveOauth(): Promise<AppConfig[]> {
    return this.db.appConfig.findMany({
      where: { oauthAccessTokenEnc: { not: null } },
    })
  }

  async resumingArchive(): Promise<AppConfig | null> {
    return this.db.appConfig.findFirst({
      where: { archiveStatus: 'RUNNING' },
    })
  }

  async setCheckpoint(cfgId: string, checkpoint: string, provider: 'GMAIL' | 'GRAPH' = 'GMAIL'): Promise<void> {
    const data: Record<string, string> = {}
    if (provider === 'GMAIL') data.gmailHistoryId = checkpoint
    else data.graphDeltaLink = checkpoint
    await this.db.appConfig.update({ where: { id: cfgId }, data })
  }

  async extractBrand(url: string): Promise<{ colors: { hex: string; source: string; label: string }[] }> {
    let html: string
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TMRBrandBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      html = await res.text()
    } catch {
      return { colors: [] }
    }

    const colors: { hex: string; source: string; label: string }[] = []
    const seen = new Set<string>()

    const add = (hex: string, source: string, label: string) => {
      const normalized = normalizeHex(hex)
      if (!normalized || seen.has(normalized)) return
      seen.add(normalized)
      colors.push({ hex: normalized, source, label })
    }

    const themeColorA = /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(html)
    const themeColorB = /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i.exec(html)
    const themeColor = themeColorA ?? themeColorB
    if (themeColor?.[1]) add(themeColor[1], 'meta', 'Theme color')

    const tileA = /<meta[^>]+name=["']msapplication-TileColor["'][^>]+content=["']([^"']+)["']/i.exec(html)
    const tileB = /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']msapplication-TileColor["']/i.exec(html)
    const tile = tileA ?? tileB
    if (tile?.[1]) add(tile[1], 'meta', 'Tile color')

    const cssVarPattern = /--(?:color-primary|primary(?:-color)?|brand(?:-color|-primary)?|accent(?:-color)?|color-brand|color-accent|ui-primary|theme-primary)[^:]*:\s*(#[0-9a-fA-F]{3,8})/g
    for (const match of html.matchAll(cssVarPattern)) {
      const varName = match[0].split(':')[0].trim().replace('--', '')
      add(match[1], 'css', varName)
    }

    const buttonColors = /(?:background(?:-color)?|color)\s*:\s*(#[0-9a-fA-F]{6})/g
    const bgMatches: string[] = []
    for (const match of html.matchAll(buttonColors)) {
      bgMatches.push(match[1])
    }
    const freq: Record<string, number> = {}
    for (const hex of bgMatches) {
      const n = normalizeHex(hex)
      if (!n || isNeutral(n)) continue
      freq[n] = (freq[n] ?? 0) + 1
    }
    const topColors = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3)
    for (const [hex] of topColors) add(hex, 'inline-style', 'Common color')

    return { colors: colors.slice(0, 8) }
  }
}

function normalizeHex(input: string): string | null {
  const s = input.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const [, r, g, b] = s
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return null
}

function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b))
  const brightness = (r + g + b) / 3
  return brightness < 20 || brightness > 230 || maxDiff < 20
}
