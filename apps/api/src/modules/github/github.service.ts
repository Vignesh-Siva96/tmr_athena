import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Octokit } from '@octokit/rest'
import * as crypto from 'crypto'
import type { Prisma } from '@tmr/db'
import { PrismaService } from '../database/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import type { ConnectGithubDto, UpdateGithubConfigDto, CreateIssueDto, LinkIssueDto } from './github.dto'
import { formatRef } from '../tickets/util/generate-ref'
import { isFeatureSuppressed } from '../config/feature-flags'

/** A GitHub label reduced to what the dashboard renders (name + hex colour). */
interface IssueLabel {
  name: string
  color: string
}

/** GitHub `issues` webhook actions we react to. */
const HANDLED_ACTIONS = ['labeled', 'unlabeled', 'opened', 'closed', 'reopened'] as const
type HandledAction = (typeof HANDLED_ACTIONS)[number]

interface IssuesWebhookEvent {
  action?: string
  label?: { name?: string }
  sender?: { login?: string }
  issue?: {
    number?: number
    title?: string
    html_url?: string
    state?: string
    labels?: Array<{ name?: string; color?: string } | string>
  }
  repository?: { full_name?: string }
}

/**
 * Normalise a GitHub issue's `labels[]` (objects or bare strings) to `{ name, color }[]`,
 * typed as a Prisma JSON value for storage on `GithubIssue.labels`.
 */
function normalizeLabels(labels: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(labels)) return []
  const out: IssueLabel[] = labels
    .map((l): IssueLabel => {
      if (typeof l === 'string') return { name: l, color: '8b949e' }
      const obj = (l ?? {}) as { name?: string; color?: string | null }
      return { name: obj.name ?? '', color: obj.color ?? '8b949e' }
    })
    .filter((l) => l.name)
  return out as unknown as Prisma.InputJsonValue
}

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
    private readonly notifications: NotificationsService,
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
    const appConfig = await this.db.appConfig.findFirst()
    if (appConfig && isFeatureSuppressed(appConfig, 'githubIssueCreation')) {
      throw new BadRequestException('GitHub issue creation is disabled (maintenance mode)')
    }

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
          data: { ticketId, issueNumber: ghIssue.number, repo, issueUrl: ghIssue.html_url, title: ghIssue.title, state: ghIssue.state, labels: normalizeLabels(ghIssue.labels) },
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
          data: { ticketId, issueNumber: ghIssue.number, repo: dto.repo, issueUrl: ghIssue.html_url, title: ghIssue.title, state: ghIssue.state, labels: normalizeLabels(ghIssue.labels) },
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
      },
    })
    return {
      hasSecret: !!config?.githubWebhookSecret,
      webhookVerifiedAt: config?.webhookVerifiedAt ?? null,
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

    const event = payload as IssuesWebhookEvent
    const action = event.action
    const issueNumber = event.issue?.number
    const repo = event.repository?.full_name

    // Only react to issue lifecycle / label changes on a tracked issue. GitHub fires many
    // other `issues` actions (assigned, milestoned, edited, …) — ignore them silently.
    if (!action || !HANDLED_ACTIONS.includes(action as HandledAction) || !issueNumber || !repo) {
      return
    }

    await this.handleIssueEvent(action as HandledAction, issueNumber, repo, event, config.id)
  }

  /**
   * A developer changed a label or the open/closed state of a linked issue. Sync the live
   * state onto the ticket, append a timeline event, raise the `githubUpdatePending` attention
   * flag (NOT the workflow status), and notify agents. The agent decides the real next step.
   */
  private async handleIssueEvent(
    action: HandledAction,
    issueNumber: number,
    repo: string,
    event: IssuesWebhookEvent,
    appConfigId: string,
  ): Promise<void> {
    const githubIssue = await this.db.githubIssue.findFirst({ where: { issueNumber, repo } })
    if (!githubIssue) {
      this.logger.warn(`Webhook: no linked ticket for ${repo}#${issueNumber} (${action})`)
      return
    }

    const actor = event.sender?.login ?? undefined
    const labelName = event.label?.name ?? undefined
    const newState = event.issue?.state ?? githubIssue.state
    const oldState = githubIssue.state
    const labels = normalizeLabels(event.issue?.labels)
    const issueTitle = event.issue?.title ?? githubIssue.title
    const summary = buildChangeSummary(action, { actor, labelName, oldState, newState })

    await this.db.$transaction([
      // 1. Sync the issue's current labels + state
      this.db.githubIssue.update({
        where: { id: githubIssue.id },
        data: { state: newState, labels, title: issueTitle, lastSyncedAt: new Date() },
      }),
      // 2. Append the change to the activity timeline
      this.db.githubIssueEvent.create({
        data: {
          githubIssueId: githubIssue.id,
          action,
          actorLogin: actor,
          labelName,
          oldState: oldState !== newState ? oldState : null,
          newState: oldState !== newState ? newState : null,
          summary,
          occurredAt: new Date(),
        },
      }),
      // 3. Raise the attention flag — the workflow `status` is deliberately untouched
      this.db.ticket.update({
        where: { id: githubIssue.ticketId },
        data: { githubUpdatePending: true, githubUpdatedAt: new Date() },
      }),
    ])

    // 4. Notify agents (persist + SSE broadcast) — only after the state is durable
    await this.notifications.createAndBroadcast({
      type: 'GITHUB_ISSUE_UPDATED',
      title: `${repo}#${issueNumber} updated`,
      body: summary,
      ticket: { connect: { id: githubIssue.ticketId } },
      githubIssueNumber: issueNumber,
      githubRepo: repo,
      githubIssueTitle: issueTitle,
      appConfig: { connect: { id: appConfigId } },
    })

    this.logger.log(`GitHub issue ${repo}#${issueNumber} ${action} → flagged ticket ${githubIssue.ticketId}`)
  }
}

/** Build the one-line "what changed" summary stored on the event + shown in the banner. */
function buildChangeSummary(
  action: HandledAction,
  ctx: { actor?: string; labelName?: string; oldState?: string; newState?: string },
): string {
  const who = ctx.actor ? `@${ctx.actor}` : 'A developer'
  switch (action) {
    case 'labeled':
      return `${who} added label "${ctx.labelName ?? ''}"`
    case 'unlabeled':
      return `${who} removed label "${ctx.labelName ?? ''}"`
    case 'closed':
      return `${who} closed the issue`
    case 'reopened':
      return `${who} reopened the issue`
    case 'opened':
      return `${who} opened the issue`
  }
}
