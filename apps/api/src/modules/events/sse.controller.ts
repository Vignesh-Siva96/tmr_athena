import { Controller, Post, Query, Sse, UnauthorizedException, UseGuards } from '@nestjs/common'
import { merge, of, Observable } from 'rxjs'
import { SseService, type SseMessageEvent, type SseTicketIdentity } from './sse.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { Agent, User } from '@tmr/db'

@Controller()
export class SseController {
  constructor(private readonly sse: SseService) {}

  /** Authenticated callers exchange their JWT for a short-lived, single-use ticket
   * here (an authenticated `fetch` can set the Authorization header), then open
   * the EventSource below with `?ticket=...` — EventSource itself cannot send headers. */
  @Post('events/ticket')
  @UseGuards(AuthGuard)
  issueTicket(
    @CurrentAgent() agent: Agent | undefined,
    @CurrentUser() user: User | undefined,
  ): { ticket: string } {
    const identity: SseTicketIdentity | null = agent
      ? { sub: agent.id, role: 'agent' }
      : user
        ? { sub: user.id, role: 'user' }
        : null
    if (!identity) throw new UnauthorizedException('Authentication required')
    return { ticket: this.sse.issueTicket(identity) }
  }

  @Sse('events')
  events(@Query('ticket') ticket: string): Observable<SseMessageEvent> {
    const identity = this.sse.consumeTicket(ticket)
    if (!identity) throw new UnauthorizedException('Invalid or expired ticket')

    const hello = of({ data: JSON.stringify({ type: 'hello', ts: Date.now() }) })
    return merge(hello, this.sse.asObservable())
  }
}
