import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { JwtPayload } from './auth.guard'

export const NO_GUESTS_KEY = 'noGuests'

/** Mark a route so guest tokens (isGuest: true) are rejected.
 *  Must be used alongside AuthGuard, which populates request.jwtPayload. */
export const NoGuests = () => SetMetadata(NO_GUESTS_KEY, true)

interface AuthRequest {
  jwtPayload?: JwtPayload
}

@Injectable()
export class NoGuestsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const noGuests = this.reflector.getAllAndOverride<boolean>(NO_GUESTS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!noGuests) return true

    const request = ctx.switchToHttp().getRequest<AuthRequest>()
    if (request.jwtPayload?.isGuest) {
      throw new ForbiddenException('Guest tokens may not access this endpoint')
    }
    return true
  }
}
