import {
  Controller, Get, Patch, Body, UseGuards, ForbiddenException, Post,
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
import { CurrentAgent } from '../../common/decorators/current-agent.decorator'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { Agent } from '@tmr/db'

@Controller('config')
export class ConfigController {
  constructor(
    private readonly configService: AppConfigService,
  ) {}

  @Get()
  get() {
    return this.configService.getSafe()
  }

  @Get('extract-brand')
  async extractBrand(@Query('url') url: string) {
    if (!url) throw new BadRequestException('url query param required')
    try { new URL(url) } catch { throw new BadRequestException('Invalid URL') }
    return this.configService.extractBrand(url)
  }

  @Patch()
  @UseGuards(AuthGuard, AgentGuard)
  async update(
    @CurrentAgent() agent: Agent,
    @Body(new ZodValidationPipe(updateAppConfigSchema)) dto: UpdateAppConfigDto,
  ) {
    if (agent.role !== 'ADMIN') throw new ForbiddenException('Admin access required')
    await this.configService.update(dto)
    return this.configService.getSafe()
  }

  @Post('logo')
  @UseGuards(AuthGuard, AgentGuard)
  @UseInterceptors(FileInterceptor('logo', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadLogo(
    @CurrentAgent() agent: Agent,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (agent.role !== 'ADMIN') throw new ForbiddenException('Admin access required')
    const logoUrl = `/uploads/${file.originalname}`
    return this.configService.updateLogo(logoUrl)
  }
}
