import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import { PrismaService } from '../database/prisma.service'
import type { InviteAgentDto, UpdateAgentDto } from './agents.dto'
import type { AgentRole } from '@tmr/db'

@Injectable()
export class AgentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
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
      select: { id: true, email: true, name: true, role: true, isActive: true, inviteAccepted: true },
    })

    return { agent }
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
