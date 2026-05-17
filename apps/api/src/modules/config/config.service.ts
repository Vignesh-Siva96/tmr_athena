import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import type { AppConfig } from '@tmr/db'
import { z } from 'zod'

export const updateAppConfigSchema = z.object({
  appName: z.string().min(1).optional(),
  logoUrl: z.string().nullable().optional(), // accepts both URLs and base64 data URIs
  portalTagline: z.string().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  emailDisplayName: z.string().optional(),
  supportEmail: z.string().email().nullable().optional(),
})
export type UpdateAppConfigDto = z.infer<typeof updateAppConfigSchema>

@Injectable()
export class AppConfigService {
  constructor(private readonly db: PrismaService) {}

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

  async update(dto: UpdateAppConfigDto): Promise<AppConfig> {
    const config = await this.get()
    return this.db.appConfig.update({
      where: { id: config.id },
      data: dto,
    })
  }

  async updateLogo(logoUrl: string): Promise<AppConfig> {
    const config = await this.get()
    return this.db.appConfig.update({ where: { id: config.id }, data: { logoUrl } })
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

    // <meta name="theme-color" content="...">
    const themeColorA = /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(html)
    const themeColorB = /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i.exec(html)
    const themeColor = themeColorA ?? themeColorB
    if (themeColor?.[1]) add(themeColor[1], 'meta', 'Theme color')

    // <meta name="msapplication-TileColor" content="...">
    const tileA = /<meta[^>]+name=["']msapplication-TileColor["'][^>]+content=["']([^"']+)["']/i.exec(html)
    const tileB = /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']msapplication-TileColor["']/i.exec(html)
    const tile = tileA ?? tileB
    if (tile?.[1]) add(tile[1], 'meta', 'Tile color')

    // CSS custom properties commonly used for brand colors
    const cssVarPattern = /--(?:color-primary|primary(?:-color)?|brand(?:-color|-primary)?|accent(?:-color)?|color-brand|color-accent|ui-primary|theme-primary)[^:]*:\s*(#[0-9a-fA-F]{3,8})/g
    for (const match of html.matchAll(cssVarPattern)) {
      const varName = match[0].split(':')[0].trim().replace('--', '')
      add(match[1], 'css', varName)
    }

    // Inline background-color or color on elements likely to be branded (buttons, headers)
    const buttonColors = /(?:background(?:-color)?|color)\s*:\s*(#[0-9a-fA-F]{6})/g
    const bgMatches: string[] = []
    for (const match of html.matchAll(buttonColors)) {
      bgMatches.push(match[1])
    }
    // Pick the most frequent non-black/non-white color
    const freq: Record<string, number> = {}
    for (const hex of bgMatches) {
      const n = normalizeHex(hex)
      if (!n || isNeutral(n)) continue
      freq[n] = (freq[n] ?? 0) + 1
    }
    const topColors = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
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
  // Skip near-black, near-white, and very low-saturation grays
  return brightness < 20 || brightness > 230 || maxDiff < 20
}
