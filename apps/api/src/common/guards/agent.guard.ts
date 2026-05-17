import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common'

interface AgentRequest {
  jwtPayload?: { role: string }
  agent?: { id: string }
}

@Injectable()
export class AgentGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<AgentRequest>()
    if (request.jwtPayload?.role !== 'agent') {
      throw new ForbiddenException('Agent access required')
    }
    return true
  }
}
