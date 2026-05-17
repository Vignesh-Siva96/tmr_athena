import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import type { CreateNoteDto, UpdateNoteDto } from './users.dto'

@Injectable()
export class UsersService {
  constructor(private readonly db: PrismaService) {}

  async findById(userId: string): Promise<unknown> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isGuest: true,
        lastActiveAt: true,
        createdAt: true,
      },
    })
    if (!user) throw new NotFoundException('User not found')

    const [totalTickets, openTickets, recentTickets, notes] = await Promise.all([
      this.db.ticket.count({ where: { userId, deletedAt: null } }),
      this.db.ticket.count({ where: { userId, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] } } }),
      this.db.ticket.findMany({
        where: { userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 12,
        include: {
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
        },
      }),
      this.db.customerNote.findMany({
        where: { userId },
        include: { agent: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const recentTicketsMapped = recentTickets.map((t) => ({
      ...t,
      displayId: `TMR-${t.number}`,
    }))

    return {
      user,
      stats: { totalTickets, openTickets },
      recentTickets: recentTicketsMapped,
      notes,
    }
  }

  async createNote(userId: string, agentId: string, dto: CreateNoteDto): Promise<{ note: unknown }> {
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')

    const note = await this.db.customerNote.create({
      data: { userId, agentId, body: dto.body },
      include: { agent: { select: { id: true, name: true, avatarUrl: true } } },
    })
    return { note }
  }

  async updateNote(noteId: string, agentId: string, dto: UpdateNoteDto): Promise<{ note: unknown }> {
    const note = await this.db.customerNote.findFirst({ where: { id: noteId, agentId } })
    if (!note) throw new NotFoundException('Note not found')

    const updated = await this.db.customerNote.update({
      where: { id: noteId },
      data: { body: dto.body },
      include: { agent: { select: { id: true, name: true, avatarUrl: true } } },
    })
    return { note: updated }
  }

  async deleteNote(noteId: string, agentId: string): Promise<{ success: boolean }> {
    const note = await this.db.customerNote.findFirst({ where: { id: noteId, agentId } })
    if (!note) throw new NotFoundException('Note not found')
    await this.db.customerNote.delete({ where: { id: noteId } })
    return { success: true }
  }
}
