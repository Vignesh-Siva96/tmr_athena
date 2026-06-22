import {
  Controller, Get, Patch, Body, UseGuards, Post,
  UploadedFile, UseInterceptors, Query, BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import {
  AppConfigService,
  updateAppConfigSchema,
  type UpdateAppConfigDto,
} from './config.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { FilesService } from '../files/files.service'

@Controller('config')
export class ConfigController {
  constructor(
    private readonly configService: AppConfigService,
    private readonly filesService: FilesService,
  ) {}

  @Get()
  get() {
    return this.configService.getSafe()
  }

  @Get('field-usage')
  @UseGuards(AuthGuard, AgentGuard, AdminGuard)
  fieldUsage() {
    return this.configService.fieldUsage()
  }

  @Get('extract-brand')
  async extractBrand(@Query('url') url: string) {
    if (!url) throw new BadRequestException('url query param required')
    try { new URL(url) } catch { throw new BadRequestException('Invalid URL') }
    return this.configService.extractBrand(url)
  }

  @Patch()
  @UseGuards(AuthGuard, AgentGuard, AdminGuard)
  async update(
    @Body(new ZodValidationPipe(updateAppConfigSchema)) dto: UpdateAppConfigDto,
  ) {
    await this.configService.update(dto)
    return this.configService.getSafe()
  }

  @Post('logo')
  @UseGuards(AuthGuard, AgentGuard, AdminGuard)
  @UseInterceptors(FileInterceptor('logo', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('logo file is required')

    // Was building a path to nowhere — `memoryStorage` holds the bytes only in
    // memory and nothing ever wrote them anywhere, so `/uploads/${originalname}`
    // 404'd on every request. Persist to MinIO (same object store every other
    // upload in the app uses) and store the URL it actually returns.
    const stored = await this.filesService.storeBuffer(file.buffer, {
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    })
    return this.configService.updateLogo(stored.url)
  }
}
