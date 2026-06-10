import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'

interface AdminRequest {
  agent?: { role: string }
}

/** Requires the authenticated agent to have role ADMIN. Must be used after AuthGuard + AgentGuard. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<AdminRequest>()
    if (request.agent?.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required')
    }
    return true
  }
}
