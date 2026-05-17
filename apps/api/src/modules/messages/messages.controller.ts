import { Controller, Post, Patch, Body, Param, UseGuards, ForbiddenException } from '@nestjs/common'
import { MessagesService } from './messages.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { createMessageSchema, updateMessageSchema, type CreateMessageDto, type UpdateMessageDto } from './messages.dto'
import type { Agent, User } from '@tmr/db'

@Controller('tickets/:ticketId/messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  create(
    @CurrentAgent() agent: Agent | undefined,
    @CurrentUser() user: User | undefined,
    @Param('ticketId') ticketId: string,
    @Body(new ZodValidationPipe(createMessageSchema)) dto: CreateMessageDto,
  ) {
    const caller = agent
      ? { id: agent.id, role: 'agent' as const }
      : user
        ? { id: user.id, role: 'user' as const }
        : null
    if (!caller) throw new ForbiddenException('Authentication required')
    return this.messagesService.create(ticketId, dto, caller)
  }

  @Patch(':messageId')
  update(
    @CurrentAgent() agent: Agent | undefined,
    @Param('ticketId') ticketId: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(updateMessageSchema)) dto: UpdateMessageDto,
  ) {
    if (!agent) throw new ForbiddenException('Agent access required')
    return this.messagesService.update(ticketId, messageId, dto, agent.id)
  }
}
