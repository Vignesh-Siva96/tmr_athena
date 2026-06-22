import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import { PrismaService } from '../database/prisma.service'
import { EmailService } from '../email/email.service'
import { AppConfigService } from '../config/config.service'
import type { InviteAgentDto, UpdateAgentDto } from './agents.dto'
import type { AgentRole, Agent } from '@tmr/db'

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name)

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly appConfigService: AppConfigService,
  ) {}

  async list(): Promise<{ data: unknown[] }> {
    const agents = await this.db.agent.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        lastActiveAt: true,
        inviteAccepted: true,
      },
      orderBy: { name: 'asc' },
    })
    return { data: agents }
  }

  async invite(dto: InviteAgentDto): Promise<{ agent: unknown }> {
    const inviteToken = crypto.randomBytes(32).toString('hex')

    const agent = await this.db.agent.upsert({
      where: { email: dto.email },
      create: { email: dto.email, name: dto.name, role: dto.role as AgentRole, inviteToken },
      update: { name: dto.name, role: dto.role as AgentRole, inviteToken, isActive: true },
      select: { id: true, email: true, name: true, role: true, isActive: true, inviteAccepted: true, inviteToken: true },
    })

    // Send invite email fire-and-forget; never fail the endpoint if email fails
    const bridgeBase = this.config.get<string>('BRIDGE_URL') ?? 'http://localhost:3002'
    const inviteUrl = `${bridgeBase}/auth/accept-invite?token=${inviteToken}`
    this.appConfigService.get()
      .then((appConfig) =>
        this.emailService.sendAgentInvite(agent as unknown as Agent, appConfig, inviteUrl)
      )
      .catch((err: unknown) => {
        this.logger.warn(`invite: failed to send invite email to ${dto.email}: ${String(err)}`)
      })

    const { inviteToken: _t, ...safeAgent } = agent
    return { agent: safeAgent }
  }

  async update(agentId: string, dto: UpdateAgentDto): Promise<{ agent: unknown }> {
    const agent = await this.db.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new NotFoundException('Agent not found')

    const updated = await this.db.agent.update({
      where: { id: agentId },
      data: {
        ...(dto.role && { role: dto.role as AgentRole }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: { id: true, email: true, name: true, role: true, isActive: true, lastActiveAt: true, inviteAccepted: true },
    })
    return { agent: updated }
  }

  async remove(agentId: string): Promise<{ success: boolean }> {
    const agent = await this.db.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new NotFoundException('Agent not found')
    await this.db.agent.delete({ where: { id: agentId } })
    return { success: true }
  }
}
