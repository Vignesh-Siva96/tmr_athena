import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import { PrismaService } from '../../modules/database/prisma.service'

export interface JwtPayload {
  sub: string
  role: 'user' | 'agent'
  isGuest?: boolean
  iat: number
  exp: number
}

interface AuthRequest {
  headers: Record<string, string | undefined>
  jwtPayload?: JwtPayload
  user?: unknown
  agent?: unknown
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.')
  if (parts.length !== 3) throw new UnauthorizedException('Invalid token format')

  const [header, payload, signature] = parts as [string, string, string]
  const signingInput = `${header}.${payload}`
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url')

  if (expectedSig !== signature) throw new UnauthorizedException('Invalid token signature')

  const decoded = JSON.parse(base64UrlDecode(payload)) as JwtPayload
  if (decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException('Token expired')
  }
  return decoded
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<AuthRequest>()
    const authHeader = request.headers['authorization']

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header')
    }

    const token = authHeader.slice(7)
    const secret = this.config.get<string>('BETTER_AUTH_SECRET') ?? ''

    const payload = verifyJwt(token, secret)
    request.jwtPayload = payload

    if (payload.role === 'agent') {
      const agent = await this.db.agent.findUnique({ where: { id: payload.sub } })
      if (!agent || !agent.isActive) throw new UnauthorizedException('Agent not found or inactive')
      request.agent = agent
    } else {
      const user = await this.db.user.findUnique({ where: { id: payload.sub } })
      if (!user) throw new UnauthorizedException('User not found')
      request.user = user
    }

    return true
  }
}
