import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

export interface CreateShiftDto {
  primaryAgentId: string
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

@Injectable()
export class ShiftsService {
  constructor(private readonly db: PrismaService) {}

  async findAll() {
    return this.db.shift.findMany({
      include: { primaryAgent: { select: { id: true, name: true, email: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    })
  }

  async create(dto: CreateShiftDto) {
    return this.db.shift.create({
      data: {
        primaryAgentId: dto.primaryAgentId,
        dayOfWeek: dto.dayOfWeek,
        startMinute: dto.startMinute,
        endMinute: dto.endMinute,
      },
      include: { primaryAgent: { select: { id: true, name: true, email: true } } },
    })
  }

  async update(id: string, data: Partial<{ active: boolean; lastAssignedAt: Date }>) {
    return this.db.shift.update({ where: { id }, data })
  }

  async delete(id: string) {
    return this.db.shift.delete({ where: { id } })
  }
}
