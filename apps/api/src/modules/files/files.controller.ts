import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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

  /**
   * Mint a fresh, short-lived download URL for an attachment, on click. Authorizes first
   * (agents may read any attachment; a customer must own the ticket the attachment belongs to),
   * mirroring the upload IDOR guard above. For link attachments, returns the stored link as-is.
   */
  @Get(':id/sign')
  async sign(
    @CurrentAgent() agent: Agent | undefined,
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
  ): Promise<{ url: string }> {
    const attachment = await this.db.attachment.findUnique({
      where: { id },
      select: {
        ticketId: true,
        filename: true,
        url: true,
        objectKey: true,
        isLink: true,
        linkUrl: true,
      },
    })
    if (!attachment) throw new NotFoundException('Attachment not found')

    // Authorize: agents read any attachment; a customer only their own ticket's attachments.
    if (!agent) {
      if (!attachment.ticketId) throw new ForbiddenException('Not authorized for this attachment')
      const ticket = await this.db.ticket.findUnique({
        where: { id: attachment.ticketId },
        select: { userId: true },
      })
      if (!ticket || !user || ticket.userId !== user.id) {
        throw new ForbiddenException('Not authorized for this attachment')
      }
    }

    if (attachment.isLink) {
      return { url: attachment.linkUrl ?? attachment.url }
    }
    return { url: await this.filesService.presignReadUrl(attachment) }
  }
}
