import { Controller, Get, Post, Delete, Patch, Body, Param, UseGuards, Headers, Req, HttpCode } from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { GithubService } from './github.service'
import { AuthGuard } from '../../common/guards/auth.guard'
import { AgentGuard } from '../../common/guards/agent.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import {
  connectGithubSchema,
  updateGithubConfigSchema,
  createIssueSchema,
  linkIssueSchema,
  type ConnectGithubDto,
  type UpdateGithubConfigDto,
  type CreateIssueDto,
  type LinkIssueDto,
} from './github.dto'

@Controller()
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  // --- Webhook routes (no auth guard — GitHub cannot authenticate) ---

  @Post('github/webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    await this.githubService.handleWebhook(signature, req.rawBody ?? Buffer.alloc(0))
    return { received: true }
  }

  // --- Authenticated routes ---

  @Get('github/status')
  @UseGuards(AuthGuard, AgentGuard)
  getStatus() {
    return this.githubService.getStatus()
  }

  @Get('github/repos')
  @UseGuards(AuthGuard, AgentGuard)
  listRepos() {
    return this.githubService.listRepos()
  }

  @Post('github/connect')
  @UseGuards(AuthGuard, AgentGuard, AdminGuard)
  connect(
    @Body(new ZodValidationPipe(connectGithubSchema)) dto: ConnectGithubDto,
  ) {
    return this.githubService.connect(dto)
  }

  @Delete('github/connect')
  @UseGuards(AuthGuard, AgentGuard, AdminGuard)
  disconnect() {
    return this.githubService.disconnect()
  }

  @Patch('github/config')
  @UseGuards(AuthGuard, AgentGuard, AdminGuard)
  updateConfig(
    @Body(new ZodValidationPipe(updateGithubConfigSchema)) dto: UpdateGithubConfigDto,
  ) {
    return this.githubService.updateConfig(dto)
  }

  // --- Webhook config routes (admin only) ---

  @Get('github/webhook-config')
  @UseGuards(AuthGuard, AgentGuard)
  getWebhookConfig() {
    return this.githubService.getWebhookConfig()
  }

  @Post('github/webhook-secret')
  @UseGuards(AuthGuard, AgentGuard, AdminGuard)
  regenWebhookSecret() {
    return this.githubService.generateWebhookSecret()
  }

  @Patch('github/webhook-config')
  @UseGuards(AuthGuard, AgentGuard, AdminGuard)
  updateWebhookConfig(
    @Body() dto: { fixDeployedLabel?: string; pendingConfirmationLabel?: string },
  ) {
    return this.githubService.updateWebhookConfig(dto)
  }

  // --- Ticket GitHub routes ---

  @Post('tickets/:id/github/issues')
  @UseGuards(AuthGuard, AgentGuard)
  createIssue(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createIssueSchema)) dto: CreateIssueDto,
  ) {
    return this.githubService.createIssue(id, dto)
  }

  @Post('tickets/:id/github/link')
  @UseGuards(AuthGuard, AgentGuard)
  linkIssue(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(linkIssueSchema)) dto: LinkIssueDto,
  ) {
    return this.githubService.linkIssue(id, dto)
  }

  @Delete('tickets/:id/github/link')
  @UseGuards(AuthGuard, AgentGuard)
  unlinkIssue(@Param('id') id: string) {
    return this.githubService.unlinkIssue(id)
  }

  // --- Mark issue as pending-customer-confirmation ---

  @Post('tickets/:id/github/pending')
  @UseGuards(AuthGuard, AgentGuard)
  markIssuePending(@Param('id') id: string) {
    return this.githubService.markIssuePending(id)
  }
}
