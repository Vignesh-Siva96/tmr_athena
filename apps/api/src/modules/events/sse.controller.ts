import { Controller, Get, Query, Sse, UnauthorizedException } from '@nestjs/common'
import { merge, of, Observable } from 'rxjs'
import { SseService, type SseMessageEvent } from './sse.service'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

function verifyJwtForSse(token: string, secret: string): void {
  const parts = token.split('.')
  if (parts.length !== 3) throw new UnauthorizedException('Invalid token format')

  const [header, payload, signature] = parts as [string, string, string]
  const signingInput = `${header}.${payload}`
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url')

  if (expectedSig !== signature) throw new UnauthorizedException('Invalid token signature')

  const decoded = JSON.parse(base64UrlDecode(payload)) as { exp: number }
  if (decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException('Token expired')
  }
}

@Controller()
export class SseController {
  constructor(
    private readonly sse: SseService,
    private readonly config: ConfigService,
  ) {}

  @Sse('events')
  events(@Query('token') token: string): Observable<SseMessageEvent> {
    const secret = this.config.get<string>('BETTER_AUTH_SECRET') ?? ''
    try {
      verifyJwtForSse(token, secret)
    } catch {
      throw new UnauthorizedException('Invalid or missing token')
    }

    const hello = of({ data: JSON.stringify({ type: 'hello', ts: Date.now() }) })
    return merge(hello, this.sse.asObservable())
  }
}
