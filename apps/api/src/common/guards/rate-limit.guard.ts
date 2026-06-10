import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

export const RATE_LIMIT_KEY = 'rateLimit'

interface RateLimitOptions {
  limit: number
  windowMs: number
}

/** Caps an endpoint to `limit` requests per `windowMs` per client IP. */
export const RateLimit = (limit: number, windowMs: number) => SetMetadata(RATE_LIMIT_KEY, { limit, windowMs })

interface WindowEntry {
  count: number
  resetAt: number
}

/**
 * Single-instance, in-memory fixed-window limiter keyed by client IP + route.
 * Good enough for a self-hosted, single-tenant deployment (see CLAUDE.md) — no
 * shared cache to coordinate across processes, and this app runs as one.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, WindowEntry>()

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const options = this.reflector.get<RateLimitOptions | undefined>(RATE_LIMIT_KEY, ctx.getHandler())
    if (!options) return true

    const request = ctx.switchToHttp().getRequest<Request>()
    const ip = request.ip ?? 'unknown'
    const key = `${ip}:${ctx.getClass().name}.${ctx.getHandler().name}`

    const now = Date.now()
    this.pruneExpired(now)

    const entry = this.windows.get(key)
    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + options.windowMs })
      return true
    }

    if (entry.count >= options.limit) {
      throw new HttpException('Too many requests — please try again later', HttpStatus.TOO_MANY_REQUESTS)
    }

    entry.count += 1
    return true
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.windows) {
      if (entry.resetAt <= now) this.windows.delete(key)
    }
  }
}
