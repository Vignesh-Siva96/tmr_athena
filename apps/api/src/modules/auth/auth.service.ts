import { Injectable, UnauthorizedException, InternalServerErrorException, ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import { PrismaService } from '../database/prisma.service'
import { getJwtSecret } from '../../common/auth/jwt-secret'
import { QueueService } from '../queue/queue.service'
import { MagicTokenType } from '@tmr/db'
import type { User, Agent } from '@tmr/db'
import type { SignupDto, SigninDto, GoogleAuthDto, GuestDto, AgentSigninDto, AgentGoogleDto } from './auth.dto'

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1h

interface JwtPayload {
  sub: string
  role: 'user' | 'agent'
  isGuest?: boolean
  iat: number
  exp: number
}

interface GoogleTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface GoogleUserInfo {
  sub: string
  email: string
  name?: string
  picture?: string
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/** Strips the password hash before a User/Agent is serialized into an API response. */
function omitPassword<T extends { password?: string | null }>(entity: T): Omit<T, 'password'> {
  const { password, ...rest } = entity
  return rest
}

const OAUTH_HTTP_TIMEOUT_MS = 10_000
const OAUTH_HTTP_MAX_BYTES = 1024 * 1024 // 1 MB — Google token/userinfo responses are tiny; cap against a misbehaving/malicious endpoint

async function readCappedJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new InternalServerErrorException(`OAuth request failed: HTTP ${res.status} — ${text.slice(0, 500)}`)
  }
  if (!res.body) return JSON.parse(await res.text()) as T

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > OAUTH_HTTP_MAX_BYTES) {
      await reader.cancel().catch(() => {})
      throw new InternalServerErrorException('OAuth response exceeded size limit')
    }
    chunks.push(value)
  }
  const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8')
  try {
    return JSON.parse(body) as T
  } catch {
    throw new InternalServerErrorException('OAuth response was not valid JSON')
  }
}

function oauthPost<T>(url: string, body: string, headers: Record<string, string>): Promise<T> {
  return fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
  }).then(readCappedJson<T>)
}

function oauthGet<T>(url: string, headers: Record<string, string>): Promise<T> {
  return fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
  }).then(readCappedJson<T>)
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly queue: QueueService,
  ) {}

  private get jwtSecret(): string {
    return getJwtSecret(this.config)
  }

  private hashPassword(password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString('hex')
      crypto.scrypt(password, salt, 64, (err, key) => {
        if (err) reject(err)
        else resolve(`${salt}:${key.toString('hex')}`)
      })
    })
  }

  private verifyPassword(password: string, hash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const [salt, storedKey] = hash.split(':') as [string, string]
      crypto.scrypt(password, salt, 64, (err, key) => {
        if (err) reject(err)
        else resolve(key.toString('hex') === storedKey)
      })
    })
  }

  /** Creates a single-use, time-limited token row for email verification or password reset. */
  private async createMagicToken(userId: string, type: MagicTokenType, ttlMs: number): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex')
    await this.db.magicToken.create({
      data: { userId, type, token, expiresAt: new Date(Date.now() + ttlMs) },
    })
    return token
  }

  /** Validates and single-use-consumes a magic token, returning the owning user. */
  private async consumeMagicToken(token: string, type: MagicTokenType): Promise<User> {
    const record = await this.db.magicToken.findUnique({ where: { token }, include: { user: true } })
    if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired token')
    }

    await this.db.magicToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
    return record.user
  }

  issueToken(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresIn = 60 * 60 * 24 * 7): string {
    const now = Math.floor(Date.now() / 1000)
    const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + expiresIn }
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = base64UrlEncode(JSON.stringify(fullPayload))
    const signingInput = `${header}.${body}`
    const sig = crypto.createHmac('sha256', this.jwtSecret).update(signingInput).digest('base64url')
    return `${signingInput}.${sig}`
  }

  async signup(dto: SignupDto): Promise<{ user: Omit<User, 'password'>; token: string }> {
    const existing = await this.db.user.findUnique({ where: { email: dto.email } })
    if (existing) throw new ConflictException('Email already exists')

    const hashedPassword = await this.hashPassword(dto.password)
    const user = await this.db.user.create({
      data: { email: dto.email, name: dto.name, password: hashedPassword },
    })

    const verificationToken = await this.createMagicToken(user.id, MagicTokenType.EMAIL_VERIFICATION, VERIFICATION_TOKEN_TTL_MS)
    await this.queue.enqueueEmailVerification({ userId: user.id, token: verificationToken })

    const token = this.issueToken({ sub: user.id, role: 'user' })
    return { user: omitPassword(user), token }
  }

  async signin(dto: SigninDto): Promise<{ user: Omit<User, 'password'>; token: string }> {
    const user = await this.db.user.findUnique({ where: { email: dto.email } })
    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials')

    const valid = await this.verifyPassword(dto.password, user.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    await this.db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
    const token = this.issueToken({ sub: user.id, role: 'user' })
    return { user: omitPassword(user), token }
  }

  async googleAuth(dto: GoogleAuthDto): Promise<{ user: Omit<User, 'password'>; token: string; isNew: boolean }> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID') ?? ''
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? ''
    const redirectUri = dto.redirectUri ?? `${this.config.get<string>('PORTAL_URL') ?? 'http://localhost:3000'}/auth/callback`

    const tokenBody = new URLSearchParams({
      code: dto.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString()

    const tokenData = await oauthPost<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      tokenBody,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    )
    if (!tokenData.access_token) {
      throw new InternalServerErrorException(`Google token exchange failed: ${tokenData.error ?? 'unknown'} — ${tokenData.error_description ?? ''}`)
    }

    const googleUser = await oauthGet<GoogleUserInfo>(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { Authorization: `Bearer ${tokenData.access_token}` },
    )
    if (!googleUser.sub || !googleUser.email) {
      throw new InternalServerErrorException('Google userinfo response missing required fields')
    }

    let isNew = false
    let user = await this.db.user.findUnique({ where: { googleId: googleUser.sub } })

    if (!user) {
      const byEmail = await this.db.user.findUnique({ where: { email: googleUser.email } })
      if (byEmail) {
        user = await this.db.user.update({
          where: { id: byEmail.id },
          data: { googleId: googleUser.sub, avatarUrl: googleUser.picture, isVerified: true, lastActiveAt: new Date() },
        })
      } else {
        isNew = true
        user = await this.db.user.create({
          data: {
            email: googleUser.email,
            name: googleUser.name,
            avatarUrl: googleUser.picture,
            googleId: googleUser.sub,
            isVerified: true,
            lastActiveAt: new Date(),
          },
        })
      }
    } else {
      await this.db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
    }

    const token = this.issueToken({ sub: user.id, role: 'user' })
    return { user: omitPassword(user), token, isNew }
  }

  async guestSession(dto: GuestDto): Promise<{ guestToken: string; email: string }> {
    const existing = await this.db.user.findUnique({ where: { email: dto.email } })

    // We bind the guest token to the existing user id when the email is already registered.
    // The token carries isGuest: true, which the AuthGuard propagates to JwtPayload. Any
    // endpoint decorated with @NoGuests() (e.g. GET /tickets list) will reject it, so the
    // guest can submit a ticket without gaining read access to the real account's history.
    // We deliberately do NOT flip user.isGuest to preserve the real account's state.
    const user = existing ?? await this.db.user.create({ data: { email: dto.email, isGuest: true } })
    const guestToken = this.issueToken({ sub: user.id, role: 'user', isGuest: true }, 3600)
    return { guestToken, email: dto.email }
  }

  async agentSignin(dto: AgentSigninDto): Promise<{ agent: Omit<Agent, 'password'>; token: string }> {
    const agent = await this.db.agent.findUnique({ where: { email: dto.email } })
    if (!agent || !agent.password) throw new UnauthorizedException('Invalid credentials')
    if (!agent.isActive) throw new UnauthorizedException('Account is deactivated')

    const valid = await this.verifyPassword(dto.password, agent.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    await this.db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } })
    const token = this.issueToken({ sub: agent.id, role: 'agent' })
    return { agent: omitPassword(agent), token }
  }

  async agentGoogleAuth(dto: AgentGoogleDto): Promise<{ agent: Omit<Agent, 'password'>; token: string }> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID') ?? ''
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? ''
    const redirectUri = `${this.config.get<string>('DASHBOARD_URL') ?? 'http://localhost:3002'}/auth/callback`

    const tokenBody = new URLSearchParams({
      code: dto.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString()

    const tokenData = await oauthPost<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      tokenBody,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    )
    if (!tokenData.access_token) {
      throw new InternalServerErrorException(`Google token exchange failed: ${tokenData.error ?? 'unknown'} — ${tokenData.error_description ?? ''}`)
    }

    const googleUser = await oauthGet<GoogleUserInfo>(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { Authorization: `Bearer ${tokenData.access_token}` },
    )
    if (!googleUser.sub || !googleUser.email) {
      throw new InternalServerErrorException('Google userinfo response missing required fields')
    }

    let agent = await this.db.agent.findUnique({ where: { googleId: googleUser.sub } })

    if (!agent) {
      const byEmail = await this.db.agent.findUnique({ where: { email: googleUser.email } })
      if (!byEmail) throw new UnauthorizedException('No agent account found for this Google account')

      agent = await this.db.agent.update({
        where: { id: byEmail.id },
        data: {
          googleId: googleUser.sub,
          avatarUrl: googleUser.picture ?? byEmail.avatarUrl,
          inviteAccepted: true,
          lastActiveAt: new Date(),
        },
      })
    } else {
      await this.db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } })
    }

    if (!agent.isActive) throw new UnauthorizedException('Account is deactivated')

    const token = this.issueToken({ sub: agent.id, role: 'agent' })
    return { agent: omitPassword(agent), token }
  }

  async verifyEmail(token: string): Promise<Omit<User, 'password'>> {
    const user = await this.consumeMagicToken(token, MagicTokenType.EMAIL_VERIFICATION)
    const updated = await this.db.user.update({ where: { id: user.id }, data: { isVerified: true } })
    return omitPassword(updated)
  }

  async resendVerification(userId: string): Promise<{ sent: boolean }> {
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user || user.isVerified) return { sent: false }

    const verificationToken = await this.createMagicToken(user.id, MagicTokenType.EMAIL_VERIFICATION, VERIFICATION_TOKEN_TTL_MS)
    await this.queue.enqueueEmailVerification({ userId: user.id, token: verificationToken })
    return { sent: true }
  }

  /** Always resolves successfully to avoid leaking which emails have accounts. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.db.user.findUnique({ where: { email } })
    if (!user || !user.password) return

    const resetToken = await this.createMagicToken(user.id, MagicTokenType.PASSWORD_RESET, PASSWORD_RESET_TOKEN_TTL_MS)
    await this.queue.enqueueEmailPasswordReset({ userId: user.id, token: resetToken })
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const user = await this.consumeMagicToken(token, MagicTokenType.PASSWORD_RESET)
    const hashedPassword = await this.hashPassword(password)
    await this.db.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, isVerified: true },
    })
  }
}
