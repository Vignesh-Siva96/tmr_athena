import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Octokit } from '@octokit/rest'
import * as crypto from 'crypto'
import { PrismaService } from '../database/prisma.service'
import type { ConnectGithubDto, UpdateGithubConfigDto, CreateIssueDto, LinkIssueDto } from './github.dto'
import { formatRef } from '../tickets/util/generate-ref'

interface GitHubOAuthResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
}

interface GitHubUser {
  id: number
  login: string
}

const GITHUB_TIMEOUT = 10_000 // 10 seconds

async function githubFetch<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(GITHUB_TIMEOUT),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`GitHub API error (status ${res.status}): ${text.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`GitHub API returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`)
  }
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name)

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(): Promise<{ connected: boolean; username?: string; defaultRepo?: string }> {
    const cfg = await this.db.githubConfig.findFirst()
    if (!cfg) return { connected: false }
    return { connected: true, username: cfg.githubUsername, defaultRepo: cfg.defaultRepo ?? undefined }
  }

  async connect(dto: ConnectGithubDto): Promise<{ connected: boolean; username: string }> {
    // Support both env var names — NEXT_PUBLIC_ prefix is needed by the dashboard but the
    // same value is readable by the API under either name
    const clientId =
      this.config.get<string>('GITHUB_APP_CLIENT_ID') ??
      this.config.get<string>('NEXT_PUBLIC_GITHUB_CLIENT_ID') ??
      ''
    const clientSecret = this.config.get<string>('GITHUB_APP_CLIENT_SECRET') ?? ''

    if (!clientId || !clientSecret) {
      this.logger.error(`GitHub OAuth env vars missing — clientId=${!!clientId} clientSecret=${!!clientSecret}`)
      throw new BadRequestException('GitHub OAuth credentials are not configured on the server')
    }

    const tokenData = await githubFetch<GitHubOAuthResponse>(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: dto.code }),
      },
    )

    if (tokenData.error) {
      this.logger.error(`GitHub token exchange error: ${tokenData.error} — ${tokenData.error_description ?? ''}`)
      throw new BadRequestException(tokenData.error_description ?? tokenData.error)
    }

    if (!tokenData.access_token) {
      this.logger.error(`GitHub token exchange returned no access_token: ${JSON.stringify(tokenData)}`)
      throw new BadRequestException('Failed to exchange GitHub code — no access token returned')
    }

    const ghUser = await githubFetch<GitHubUser>(
      'https://api.github.com/user',
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'TMR-Support',
        },
      },
    )

    const existing = await this.db.githubConfig.findFirst()
    if (existing) {
      await this.db.githubConfig.update({ where: { id: existing.id }, data: { accessToken: tokenData.access_token, githubUsername: ghUser.login, githubUserId: String(ghUser.id) } })
    } else {
      await this.db.githubConfig.create({ data: { accessToken: tokenData.access_token, githubUsername: ghUser.login, githubUserId: String(ghUser.id) } })
    }

    return { connected: true, username: ghUser.login }
  }

  async listRepos(): Promise<{ repos: { fullName: string; private: boolean; description: string | null }[] }> {
    const cfg = await this.db.githubConfig.findFirst()
    if (!cfg) throw new NotFoundException('GitHub not connected')

    interface GHRepo { full_name: string; private: boolean; description: string | null }
    let page = 1
    const all: GHRepo[] = []

    // Fetch up to 5 pages (500 repos) — enough for any real org
    while (page <= 5) {
      const data = await githubFetch<GHRepo[]>(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        { headers: { Authorization: `Bearer ${cfg.accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TMR-Support' } },
      )
      if (!Array.isArray(data) || data.length === 0) break
      all.push(...data)
      if (data.length < 100) break
      page++
    }

    return {
      repos: all.map((r) => ({ fullName: r.full_name, private: r.private, description: r.description })),
    }
  }

  async disconnect(): Promise<{ success: boolean }> {
    await this.db.githubConfig.deleteMany()
    return { success: true }
  }

  async updateConfig(dto: UpdateGithubConfigDto): Promise<{ config: unknown }> {
    const cfg = await this.db.githubConfig.findFirst()
    if (!cfg) throw new NotFoundException('GitHub not connected')

    const updated = await this.db.githubConfig.update({ where: { id: cfg.id }, data: { defaultRepo: dto.defaultRepo } })
    return { config: updated }
  }

  async createIssue(ticketId: string, dto: CreateIssueDto): Promise<{ issue: unknown }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found')

    const cfg = await this.db.githubConfig.findFirst()
    if (!cfg) throw new BadRequestException('GitHub not connected')

    const repo = dto.repo ?? cfg.defaultRepo
    if (!repo) throw new BadRequestException('No repo specified and no default repo configured')

    const [owner, repoName] = repo.split('/') as [string, string]
    const displayId = formatRef(ticket.ref)

    const octokit = new Octokit({ auth: cfg.accessToken })
    const { data: ghIssue } = await octokit.issues.create({
      owner,
      repo: repoName,
      title: `[${displayId}] ${ticket.title}`,
      body: `Support ticket: ${displayId}\n\nCreated from TMR Support Platform.`,
      labels: ['support'],
    })

    let issue: unknown
    try {
      issue = await this.db.$transaction(async (tx) => {
        const created = await tx.githubIssue.create({
          data: { ticketId, issueNumber: ghIssue.number, repo, issueUrl: ghIssue.html_url, title: ghIssue.title, state: ghIssue.state },
        })
        await tx.message.create({ data: { ticketId, type: 'SYSTEM_EVENT', body: `github_linked:${repo}:#${ghIssue.number}` } })
        return created
      })
    } catch (err) {
      // The GitHub issue already exists on GitHub's side at this point — there is no
      // distributed transaction across our DB and their API. If our write fails, the
      // issue becomes an orphan (exists on GitHub, untracked here). Log everything
      // needed to find and reconcile it by hand: ticket, repo, issue number and URL.
      this.logger.error(
        `Orphaned GitHub issue: DB write failed after creating ${ghIssue.html_url} (#${ghIssue.number}) for ticket ${ticketId} in ${repo} — ${String(err)}`,
      )
      throw err
    }

    return { issue }
  }

  async linkIssue(ticketId: string, dto: LinkIssueDto): Promise<{ issue: unknown }> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found')

    const cfg = await this.db.githubConfig.findFirst()
    if (!cfg) throw new BadRequestException('GitHub not connected')

    const [owner, repoName] = dto.repo.split('/') as [string, string]
    const octokit = new Octokit({ auth: cfg.accessToken })
    const { data: ghIssue } = await octokit.issues.get({ owner, repo: repoName, issue_number: dto.issueNumber })

    let issue: unknown
    try {
      issue = await this.db.$transaction(async (tx) => {
        const created = await tx.githubIssue.create({
          data: { ticketId, issueNumber: ghIssue.number, repo: dto.repo, issueUrl: ghIssue.html_url, title: ghIssue.title, state: ghIssue.state },
        })
        await tx.message.create({ data: { ticketId, type: 'SYSTEM_EVENT', body: `github_linked:${dto.repo}:#${ghIssue.number}` } })
        return created
      })
    } catch (err) {
      // linkIssue references a *pre-existing* GitHub issue rather than creating one,
      // so there's no orphan-creation risk — but the link itself silently fails to
      // persist. Log it the same way so the failed link attempt is discoverable.
      this.logger.error(
        `Failed to persist GitHub issue link: ${ghIssue.html_url} (#${ghIssue.number}) for ticket ${ticketId} in ${dto.repo} — ${String(err)}`,
      )
      throw err
    }

    return { issue }
  }

  async unlinkIssue(ticketId: string): Promise<{ success: boolean }> {
    await this.db.githubIssue.deleteMany({ where: { ticketId } })
    return { success: true }
  }

  // Webhook secret management
  async generateWebhookSecret(): Promise<{ secret: string }> {
    const secret = crypto.randomBytes(32).toString('hex')
    const config = await this.db.appConfig.findFirst()
    if (config) {
      await this.db.appConfig.update({
        where: { id: config.id },
        data: { githubWebhookSecret: secret },
      })
    } else {
      await this.db.appConfig.create({ data: { githubWebhookSecret: secret } })
    }
    return { secret }
  }

  async getWebhookConfig(): Promise<unknown> {
    const config = await this.db.appConfig.findFirst({
      select: {
        githubWebhookSecret: true,
        webhookVerifiedAt: true,
        fixDeployedLabel: true,
        pendingConfirmationLabel: true,
      },
    })
    return {
      hasSecret: !!config?.githubWebhookSecret,
      webhookVerifiedAt: config?.webhookVerifiedAt ?? null,
      fixDeployedLabel: config?.fixDeployedLabel ?? 'fix-deployed',
      pendingConfirmationLabel: config?.pendingConfirmationLabel ?? 'pending-customer-confirmation',
    }
  }

  async updateWebhookConfig(dto: { fixDeployedLabel?: string; pendingConfirmationLabel?: string }): Promise<unknown> {
    const config = await this.db.appConfig.findFirst()
    if (!config) throw new NotFoundException('AppConfig not found')
    const updated = await this.db.appConfig.update({
      where: { id: config.id },
      data: {
        ...(dto.fixDeployedLabel && { fixDeployedLabel: dto.fixDeployedLabel }),
        ...(dto.pendingConfirmationLabel && { pendingConfirmationLabel: dto.pendingConfirmationLabel }),
      },
    })
    return {
      fixDeployedLabel: updated.fixDeployedLabel,
      pendingConfirmationLabel: updated.pendingConfirmationLabel,
    }
  }

  async handleWebhook(signature: string | undefined, rawBody: Buffer): Promise<void> {
    const config = await this.db.appConfig.findFirst()
    if (!config?.githubWebhookSecret) {
      this.logger.warn('Webhook received but no secret configured')
      return
    }

    // Verify HMAC-SHA256 signature (constant-time — `!==` would leak timing info that
    // lets an attacker recover a valid signature byte-by-byte and forge webhook deliveries)
    const expected = 'sha256=' + crypto.createHmac('sha256', config.githubWebhookSecret).update(rawBody).digest('hex')
    const expectedBuf = Buffer.from(expected)
    const actualBuf = Buffer.from(signature ?? '')
    const signatureValid =
      expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf)
    if (!signatureValid) {
      this.logger.warn('Webhook signature mismatch — rejected')
      return
    }

    // Mark webhook as verified (first successful delivery)
    if (!config.webhookVerifiedAt) {
      await this.db.appConfig.update({ where: { id: config.id }, data: { webhookVerifiedAt: new Date() } })
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody.toString()) as Record<string, unknown>
    } catch {
      this.logger.warn('Webhook: failed to parse JSON body')
      return
    }

    const event = payload as { action?: string; label?: { name?: string }; issue?: { number?: number; title?: string; html_url?: string }; repository?: { full_name?: string } }

    // Only handle label events
    if (event.action !== 'labeled' || !event.label?.name || !event.issue?.number || !event.repository?.full_name) {
      return
    }

    const labelName = event.label.name
    const issueNumber = event.issue.number
    const repo = event.repository.full_name
    const issueTitle = event.issue.title ?? ''

    if (labelName === config.fixDeployedLabel) {
      await this.handleFixDeployedLabel(issueNumber, repo, issueTitle, config.id)
    }
  }

  private async handleFixDeployedLabel(issueNumber: number, repo: string, issueTitle: string, appConfigId: string): Promise<void> {
    const githubIssue = await this.db.githubIssue.findFirst({
      where: { issueNumber, repo },
      include: { ticket: { include: { user: true } } },
    })

    if (!githubIssue) {
      this.logger.warn(`Webhook: no linked ticket for ${repo}#${issueNumber}`)
      return
    }

    await this.db.notification.create({
      data: {
        type: 'GITHUB_FIX_DEPLOYED',
        title: `Fix deployed: ${repo}#${issueNumber}`,
        body: issueTitle,
        ticketId: githubIssue.ticketId,
        githubIssueNumber: issueNumber,
        githubRepo: repo,
        githubIssueTitle: issueTitle,
        appConfigId,
      },
    })

    this.logger.log(`Created GITHUB_FIX_DEPLOYED notification for ${repo}#${issueNumber}`)
  }

  async markIssuePending(ticketId: string): Promise<{ success: boolean }> {
    const issue = await this.db.githubIssue.findUnique({ where: { ticketId } })
    if (!issue) throw new NotFoundException('No GitHub issue linked to this ticket')

    const cfg = await this.db.githubConfig.findFirst()
    if (!cfg) throw new BadRequestException('GitHub not connected')

    const appConfig = await this.db.appConfig.findFirst()
    if (!appConfig) throw new BadRequestException('AppConfig not found')

    const [owner, repoName] = issue.repo.split('/') as [string, string]
    const octokit = new Octokit({ auth: cfg.accessToken })

    // Add pending-customer-confirmation label
    await octokit.issues.addLabels({
      owner, repo: repoName,
      issue_number: issue.issueNumber,
      labels: [appConfig.pendingConfirmationLabel],
    })

    // Remove fix-deployed label (best-effort)
    try {
      await octokit.issues.removeLabel({
        owner, repo: repoName,
        issue_number: issue.issueNumber,
        name: appConfig.fixDeployedLabel,
      })
    } catch { /* label may not exist */ }

    return { success: true }
  }
}
