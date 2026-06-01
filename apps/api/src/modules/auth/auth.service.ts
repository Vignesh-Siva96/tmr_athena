import { Injectable, UnauthorizedException, ConflictException, NotFoundException, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import * as https from 'https'
import { PrismaService } from '../database/prisma.service'
import type { User, Agent } from '@tmr/db'
import type { SignupDto, SigninDto, GoogleAuthDto, GuestDto, AgentSigninDto, AgentGoogleDto } from './auth.dto'

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

function httpsPost(url: string, data: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) },
    }
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function httpsGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
    }
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.end()
  })
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get jwtSecret(): string {
    return this.config.get<string>('BETTER_AUTH_SECRET') ?? 'dev-secret'
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

  issueToken(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresIn = 60 * 60 * 24 * 7): string {
    const now = Math.floor(Date.now() / 1000)
    const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + expiresIn }
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = base64UrlEncode(JSON.stringify(fullPayload))
    const signingInput = `${header}.${body}`
    const sig = crypto.createHmac('sha256', this.jwtSecret).update(signingInput).digest('base64url')
    return `${signingInput}.${sig}`
  }

  async signup(dto: SignupDto): Promise<{ user: User; token: string }> {
    const existing = await this.db.user.findUnique({ where: { email: dto.email } })
    if (existing) throw new ConflictException('Email already exists')

    const hashedPassword = await this.hashPassword(dto.password)
    const user = await this.db.user.create({
      data: { email: dto.email, name: dto.name, password: hashedPassword },
    })

    const token = this.issueToken({ sub: user.id, role: 'user' })
    return { user, token }
  }

  async signin(dto: SigninDto): Promise<{ user: User; token: string }> {
    const user = await this.db.user.findUnique({ where: { email: dto.email } })
    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials')

    const valid = await this.verifyPassword(dto.password, user.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    await this.db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
    const token = this.issueToken({ sub: user.id, role: 'user' })
    return { user, token }
  }

  async googleAuth(dto: GoogleAuthDto): Promise<{ user: User; token: string; isNew: boolean }> {
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

    const tokenRaw = await httpsPost(
      'https://oauth2.googleapis.com/token',
      tokenBody,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    )
    const tokenData = JSON.parse(tokenRaw) as GoogleTokenResponse
    if (!tokenData.access_token) {
      throw new InternalServerErrorException(`Google token exchange failed: ${tokenData.error ?? 'unknown'} — ${tokenData.error_description ?? ''}`)
    }

    const userInfoRaw = await httpsGet(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { Authorization: `Bearer ${tokenData.access_token}` },
    )
    const googleUser = JSON.parse(userInfoRaw) as GoogleUserInfo
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
          data: { googleId: googleUser.sub, avatarUrl: googleUser.picture, lastActiveAt: new Date() },
        })
      } else {
        isNew = true
        user = await this.db.user.create({
          data: {
            email: googleUser.email,
            name: googleUser.name,
            avatarUrl: googleUser.picture,
            googleId: googleUser.sub,
            lastActiveAt: new Date(),
          },
        })
      }
    } else {
      await this.db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
    }

    const token = this.issueToken({ sub: user.id, role: 'user' })
    return { user, token, isNew }
  }

  async guestSession(dto: GuestDto): Promise<{ guestToken: string; email: string }> {
    let user = await this.db.user.findUnique({ where: { email: dto.email } })
    if (!user) {
      user = await this.db.user.create({ data: { email: dto.email, isGuest: true } })
    }
    const guestToken = this.issueToken({ sub: user.id, role: 'user', isGuest: true }, 3600)
    return { guestToken, email: dto.email }
  }

  async sendMagicLink(email: string, ticketId: string): Promise<{ sent: boolean }> {
    const user = await this.db.user.findUnique({ where: { email } })
    if (!user) throw new NotFoundException('User not found')

    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found')

    const token = crypto.randomBytes(32).toString('hex')
    await this.db.magicToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
    })
    return { sent: true }
  }

  async agentSignin(dto: AgentSigninDto): Promise<{ agent: Agent; token: string }> {
    const agent = await this.db.agent.findUnique({ where: { email: dto.email } })
    if (!agent || !agent.password) throw new UnauthorizedException('Invalid credentials')
    if (!agent.isActive) throw new UnauthorizedException('Account is deactivated')

    const valid = await this.verifyPassword(dto.password, agent.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    await this.db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } })
    const token = this.issueToken({ sub: agent.id, role: 'agent' })
    return { agent, token }
  }

  async agentGoogleAuth(dto: AgentGoogleDto): Promise<{ agent: Agent; token: string }> {
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

    const tokenRaw = await httpsPost(
      'https://oauth2.googleapis.com/token',
      tokenBody,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    )
    const tokenData = JSON.parse(tokenRaw) as GoogleTokenResponse
    if (!tokenData.access_token) {
      throw new InternalServerErrorException(`Google token exchange failed: ${tokenData.error ?? 'unknown'} — ${tokenData.error_description ?? ''}`)
    }

    const userInfoRaw = await httpsGet(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { Authorization: `Bearer ${tokenData.access_token}` },
    )
    const googleUser = JSON.parse(userInfoRaw) as GoogleUserInfo
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
    return { agent, token }
  }
}
