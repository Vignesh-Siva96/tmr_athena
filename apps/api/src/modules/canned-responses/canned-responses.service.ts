import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import type { CreateCannedResponseDto, UpdateCannedResponseDto } from './canned-responses.dto'

@Injectable()
export class CannedResponsesService {
  constructor(private readonly db: PrismaService) {}

  async list(): Promise<{ data: unknown[] }> {
    const responses = await this.db.cannedResponse.findMany({ orderBy: { name: 'asc' } })
    return { data: responses }
  }

  async create(dto: CreateCannedResponseDto): Promise<{ cannedResponse: unknown }> {
    const cannedResponse = await this.db.cannedResponse.create({ data: { name: dto.name, body: dto.body } })
    return { cannedResponse }
  }

  async update(id: string, dto: UpdateCannedResponseDto): Promise<{ cannedResponse: unknown }> {
    const existing = await this.db.cannedResponse.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Canned response not found')
    const cannedResponse = await this.db.cannedResponse.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.body !== undefined && { body: dto.body }),
      },
    })
    return { cannedResponse }
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const existing = await this.db.cannedResponse.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Canned response not found')
    await this.db.cannedResponse.delete({ where: { id } })
    return { success: true }
  }
}
