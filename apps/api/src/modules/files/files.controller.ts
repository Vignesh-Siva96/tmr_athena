import {
  Controller,
  Post,
  Body,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Query,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { FilesService } from './files.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { uploadLinkSchema, type UploadLinkDto } from './files.dto'

@Controller('files')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(uploadLinkSchema.optional())) dto: UploadLinkDto | undefined,
    @Query('ticketId') ticketId: string | undefined,
  ) {
    if (file) {
      return this.filesService.uploadFile(file, ticketId)
    }
    if (dto?.linkUrl) {
      return this.filesService.uploadLink(dto.linkUrl, ticketId)
    }
    throw new BadRequestException('Provide either a file or a linkUrl')
  }
}
