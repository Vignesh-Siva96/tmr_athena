import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import type { CreateTagDto, UpdateTagDto } from './tags.dto'

@Injectable()
export class TagsService {
  constructor(private readonly db: PrismaService) {}

  async list(): Promise<{ data: unknown[] }> {
    const tags = await this.db.tag.findMany({
      include: { _count: { select: { tickets: true } } },
      orderBy: { name: 'asc' },
    })
    return { data: tags }
  }

  async create(dto: CreateTagDto): Promise<{ tag: unknown }> {
    try {
      const tag = await this.db.tag.create({
        data: { name: dto.name, color: dto.color },
        include: { _count: { select: { tickets: true } } },
      })
      return { tag }
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException('Tag name already exists')
      throw err
    }
  }

  async update(tagId: string, dto: UpdateTagDto): Promise<{ tag: unknown }> {
    const existing = await this.db.tag.findUnique({ where: { id: tagId } })
    if (!existing) throw new NotFoundException('Tag not found')

    try {
      const tag = await this.db.tag.update({
        where: { id: tagId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.color !== undefined && { color: dto.color }),
        },
        include: { _count: { select: { tickets: true } } },
      })
      return { tag }
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException('Tag name already exists')
      throw err
    }
  }

  async remove(tagId: string): Promise<{ success: boolean }> {
    const existing = await this.db.tag.findUnique({ where: { id: tagId } })
    if (!existing) throw new NotFoundException('Tag not found')
    // Implicit join rows in _TagToTicket auto-clear due to cascade on the join table
    await this.db.tag.delete({ where: { id: tagId } })
    return { success: true }
  }
}
