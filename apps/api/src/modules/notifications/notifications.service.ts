import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class NotificationsService {
  constructor(private readonly db: PrismaService) {}

  async list(agentId: string): Promise<unknown> {
    const notifications = await this.db.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        ticket: {
          select: { id: true, number: true, title: true, userId: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        reads: { where: { agentId }, select: { readAt: true } },
      },
    })

    return notifications.map((n) => ({
      ...n,
      isRead: n.reads.length > 0,
      readAt: n.reads[0]?.readAt ?? null,
      reads: undefined,
    }))
  }

  async unreadCount(agentId: string): Promise<number> {
    const total = await this.db.notification.count()
    const read = await this.db.notificationRead.count({ where: { agentId } })
    return Math.max(0, total - read)
  }

  async markRead(notificationId: string, agentId: string): Promise<void> {
    await this.db.notificationRead.upsert({
      where: { notificationId_agentId: { notificationId, agentId } },
      create: { notificationId, agentId },
      update: {},
    })
  }

  async markAllRead(agentId: string): Promise<void> {
    const notifications = await this.db.notification.findMany({ select: { id: true } })
    await this.db.notificationRead.createMany({
      data: notifications.map((n) => ({ notificationId: n.id, agentId })),
      skipDuplicates: true,
    })
  }
}
