import {
  Controller,
  Post,
  Body,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Query,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { FilesService } from './files.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { PrismaService } from '../database/prisma.service'
import { uploadLinkSchema } from './files.dto'
import type { Agent, User } from '@tmr/db'

@Controller('files')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly db: PrismaService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async upload(
    @CurrentAgent() agent: Agent | undefined,
    @CurrentUser() user: User | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() rawBody: Record<string, unknown>,
    @Query('ticketId') ticketId: string | undefined,
  ) {
    // IDOR guard: a customer must own the ticket they're attaching to — otherwise
    // an arbitrary `ticketId` query param would let anyone attach files to (and
    // thus read/leak into) someone else's ticket. Agents may attach to any ticket.
    if (ticketId && !agent) {
      const ticket = await this.db.ticket.findUnique({ where: { id: ticketId }, select: { userId: true } })
      if (!ticket) throw new NotFoundException('Ticket not found')
      if (!user || ticket.userId !== user.id) throw new ForbiddenException('Not authorized for this ticket')
    }

    if (file) {
      return this.filesService.uploadFile(file, ticketId)
    }
    // Link upload: validate linkUrl only when no file is present
    const parsed = uploadLinkSchema.safeParse(rawBody)
    if (parsed.success) {
      return this.filesService.uploadLink(parsed.data.linkUrl, ticketId)
    }
    throw new BadRequestException('Provide either a file or a linkUrl')
  }
}
