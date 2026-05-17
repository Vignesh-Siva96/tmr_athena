import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Agent } from '@tmr/types'

export const CurrentAgent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Agent => {
    const request = ctx.switchToHttp().getRequest<{ agent: Agent }>()
    return request.agent
  },
)
