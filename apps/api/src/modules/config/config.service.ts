import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { AppEventsService } from '../../common/events/app-events.service'
import { encrypt, decrypt } from '../../common/crypto/credentials-cipher'
import type { AppConfig } from '@tmr/db'
import { z } from 'zod'
import * as nodemailer from 'nodemailer'

export const updateAppConfigSchema = z.object({
  appName: z.string().min(1).optional(),
  logoUrl: z.string().nullable().optional(),
  portalTagline: z.string().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  emailDisplayName: z.string().optional(),
  supportEmail: z.string().email().nullable().optional(),

  // IMAP
  imapHost: z.string().nullable().optional(),
  imapPort: z.number().int().optional(),
  imapUser: z.string().nullable().optional(),
  imapPassword: z.string().optional(), // plain — encrypted before write
  imapUseTls: z.boolean().optional(),
  imapFolder: z.string().optional(),

  // SMTP
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().optional(),
  smtpUser: z.string().nullable().optional(),
  smtpPassword: z.string().optional(), // plain — encrypted before write
  smtpFrom: z.string().nullable().optional(),

  // Inbound toggle
  inboundEnabled: z.boolean().optional(),
})
export type UpdateAppConfigDto = z.infer<typeof updateAppConfigSchema>

export const testEmailConnectionSchema = z.object({
  imapHost: z.string(),
  imapPort: z.number().int().default(993),
  imapUser: z.string(),
  imapPassword: z.string(),
  imapUseTls: z.boolean().default(true),
  smtpHost: z.string(),
  smtpPort: z.number().int().default(587),
  smtpUser: z.string(),
  smtpPassword: z.string(),
})
export type TestEmailConnectionDto = z.infer<typeof testEmailConnectionSchema>

@Injectable()
export class AppConfigService {
  constructor(
    private readonly db: PrismaService,
    private readonly appEvents: AppEventsService,
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

  /** Returns config with passwords redacted (never exposed via API) */
  async getSafe(): Promise<Omit<AppConfig, 'imapPasswordEnc' | 'smtpPasswordEnc'> & { imapPasswordSet: boolean; smtpPasswordSet: boolean }> {
    const cfg = await this.get()
    const { imapPasswordEnc, smtpPasswordEnc, ...rest } = cfg
    return {
      ...rest,
      imapPasswordSet: !!imapPasswordEnc,
      smtpPasswordSet: !!smtpPasswordEnc,
    }
  }

  async update(dto: UpdateAppConfigDto): Promise<AppConfig> {
    const config = await this.get()

    const { imapPassword, smtpPassword, ...fields } = dto

    const data: Record<string, unknown> = { ...fields }
    if (imapPassword) data.imapPasswordEnc = encrypt(imapPassword)
    if (smtpPassword) data.smtpPasswordEnc = encrypt(smtpPassword)

    const updated = await this.db.appConfig.update({ where: { id: config.id }, data })

    const hasEmailChanges = !!(
      dto.imapHost || dto.imapUser || imapPassword || dto.inboundEnabled !== undefined ||
      dto.smtpHost || dto.smtpUser || smtpPassword
    )
    if (hasEmailChanges) {
      this.appEvents.emitEmailConfigUpdated()
    }

    return updated
  }

  async updateLogo(logoUrl: string): Promise<AppConfig> {
    const config = await this.get()
    return this.db.appConfig.update({ where: { id: config.id }, data: { logoUrl } })
  }

  async updateInboundLastUid(uid: number): Promise<void> {
    const config = await this.get()
    await this.db.appConfig.update({ where: { id: config.id }, data: { inboundLastUid: uid } })
  }

  /**
   * Clear the email connection: turns off inbound, removes credentials, resets
   * the IMAP cursor. The IMAP supervisor will tear down its connection on the
   * `email-config-updated` event.
   */
  async disconnectEmail(): Promise<AppConfig> {
    const config = await this.get()
    const updated = await this.db.appConfig.update({
      where: { id: config.id },
      data: {
        inboundEnabled: false,
        imapUser: null,
        imapPasswordEnc: null,
        smtpUser: null,
        smtpPasswordEnc: null,
        smtpFrom: null,
        inboundLastUid: null,
      },
    })
    this.appEvents.emitEmailConfigUpdated()
    return updated
  }

  async testEmailConnection(dto: TestEmailConnectionDto): Promise<{
    imap: 'ok' | 'fail'
    smtp: 'ok' | 'fail'
    errors: string[]
  }> {
    const errors: string[] = []
    let imapResult: 'ok' | 'fail' = 'fail'
    let smtpResult: 'ok' | 'fail' = 'fail'

    // Test IMAP
    try {
      const { ImapFlow } = await import('imapflow')
      const client = new ImapFlow({
        host: dto.imapHost,
        port: dto.imapPort,
        secure: dto.imapUseTls,
        auth: { user: dto.imapUser, pass: dto.imapPassword },
        logger: false,
      })
      await Promise.race([
        client.connect().then(() => client.logout()),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('IMAP timeout')), 10_000)),
      ])
      imapResult = 'ok'
    } catch (err) {
      errors.push(`IMAP: ${String(err)}`)
    }

    // Test SMTP
    try {
      const transporter = nodemailer.createTransport({
        host: dto.smtpHost,
        port: dto.smtpPort,
        secure: dto.smtpPort === 465,
        auth: { user: dto.smtpUser, pass: dto.smtpPassword },
      })
      await Promise.race([
        transporter.verify(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), 10_000)),
      ])
      smtpResult = 'ok'
    } catch (err) {
      errors.push(`SMTP: ${String(err)}`)
    }

    return { imap: imapResult, smtp: smtpResult, errors }
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
