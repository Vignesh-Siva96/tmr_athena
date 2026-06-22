/**
 * github.webhook.spec — integration tests for the GitHub `issues` webhook → ticket
 * attention-flag flow, and the agent acknowledge endpoint.
 *
 * A developer changing a label or the open/closed state of a LINKED issue must:
 *   - sync the issue's current labels + state onto the GithubIssue row
 *   - append a GithubIssueEvent to the activity timeline
 *   - raise Ticket.githubUpdatePending WITHOUT changing Ticket.status
 *   - create a GITHUB_ISSUE_UPDATED notification
 * Acknowledge (explicit endpoint or agent-open) clears the flag.
 *
 * Regression catalogue rows:
 *   R255 — issues webhook (labeled/closed/reopened/unlabeled): sync labels+state, append
 *          GithubIssueEvent, raise githubUpdatePending (status untouched), GITHUB_ISSUE_UPDATED notif
 *   R256 — webhook HMAC verify: bad signature / missing secret rejected; untracked issue no-ops
 *   R257 — acknowledge endpoint + agent-open clear githubUpdatePending; portal-open does not
 */

import * as crypto from 'crypto'
import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, signJwt } from './factories'
import './setup'

const SECRET = 'webhook_test_secret'
const REPO = 'test-agent/example-repo'

async function seedSecret(): Promise<string> {
  const cfg = await harness.prisma.appConfig.create({ data: { githubWebhookSecret: SECRET } })
  return cfg.id
}

async function linkIssue(ticketId: string, issueNumber: number, state = 'open') {
  return harness.prisma.githubIssue.create({
    data: {
      ticketId, issueNumber, repo: REPO, state,
      issueUrl: `https://github.com/${REPO}/issues/${issueNumber}`,
      title: 'Export job times out',
    },
  })
}

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex')
}

function postWebhook(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload)
  return harness
    .request()
    .post('/api/v1/github/webhook')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signature ?? sign(body))
    .send(body)
}

function labeledPayload(issueNumber: number, labelName: string, labels: { name: string; color: string }[]) {
  return {
    action: 'labeled',
    sender: { login: 'dev-rhea' },
    label: { name: labelName },
    issue: { number: issueNumber, title: 'Export job times out', html_url: `https://github.com/${REPO}/issues/${issueNumber}`, state: 'open', labels },
    repository: { full_name: REPO },
  }
}

// ─── R255 — webhook flow ──────────────────────────────────────────────────────

describe('R255 — issues webhook updates the linked ticket', () => {
  it('labeled → syncs labels+state, appends event, raises flag (status untouched), creates notification', async () => {
    await seedSecret()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'IN_PROGRESS' })
    const gh = await linkIssue(ticket.id, 88)

    const res = await postWebhook(labeledPayload(88, 'deployed-to-prod', [
      { name: 'deployed-to-prod', color: '0e8a16' },
      { name: 'bug', color: 'd73a4a' },
    ]))
    expect(res.status).toBe(200)

    const issue = await harness.prisma.githubIssue.findUniqueOrThrow({ where: { id: gh.id } })
    expect(issue.labels).toEqual([
      { name: 'deployed-to-prod', color: '0e8a16' },
      { name: 'bug', color: 'd73a4a' },
    ])
    expect(issue.lastSyncedAt).not.toBeNull()

    const events = await harness.prisma.githubIssueEvent.findMany({ where: { githubIssueId: gh.id } })
    expect(events).toHaveLength(1)
    expect(events[0]!.action).toBe('labeled')
    expect(events[0]!.labelName).toBe('deployed-to-prod')
    expect(events[0]!.actorLogin).toBe('dev-rhea')

    const updated = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updated.githubUpdatePending).toBe(true)
    expect(updated.githubUpdatedAt).not.toBeNull()
    // The workflow status MUST remain whatever the agent set — analytics/bot/kanban depend on it
    expect(updated.status).toBe('IN_PROGRESS')

    const notif = await harness.prisma.notification.findFirst({ where: { ticketId: ticket.id } })
    expect(notif).not.toBeNull()
    expect(notif!.type).toBe('GITHUB_ISSUE_UPDATED')
    expect(notif!.githubIssueNumber).toBe(88)
  })

  it('closed → syncs state to closed and records a state transition', async () => {
    await seedSecret()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, status: 'OPEN' })
    const gh = await linkIssue(ticket.id, 91, 'open')

    const res = await postWebhook({
      action: 'closed',
      sender: { login: 'dev-max' },
      issue: { number: 91, title: 'Export job times out', state: 'closed', labels: [] },
      repository: { full_name: REPO },
    })
    expect(res.status).toBe(200)

    const issue = await harness.prisma.githubIssue.findUniqueOrThrow({ where: { id: gh.id } })
    expect(issue.state).toBe('closed')

    const event = await harness.prisma.githubIssueEvent.findFirstOrThrow({ where: { githubIssueId: gh.id } })
    expect(event.action).toBe('closed')
    expect(event.oldState).toBe('open')
    expect(event.newState).toBe('closed')

    const updated = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updated.githubUpdatePending).toBe(true)
    expect(updated.status).toBe('OPEN')
  })

  it('ignores unhandled actions (e.g. assigned)', async () => {
    await seedSecret()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    const gh = await linkIssue(ticket.id, 92)

    const res = await postWebhook({
      action: 'assigned',
      issue: { number: 92, state: 'open', labels: [] },
      repository: { full_name: REPO },
    })
    expect(res.status).toBe(200)

    const events = await harness.prisma.githubIssueEvent.findMany({ where: { githubIssueId: gh.id } })
    expect(events).toHaveLength(0)
    const updated = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updated.githubUpdatePending).toBe(false)
  })
})

// ─── R256 — HMAC + untracked ──────────────────────────────────────────────────

describe('R256 — webhook security & robustness', () => {
  it('rejects a bad signature without mutating state', async () => {
    await seedSecret()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    const gh = await linkIssue(ticket.id, 88)

    const res = await postWebhook(labeledPayload(88, 'x', []), 'sha256=deadbeef')
    expect(res.status).toBe(200) // handler always 200s; verify no side effects

    const events = await harness.prisma.githubIssueEvent.findMany({ where: { githubIssueId: gh.id } })
    expect(events).toHaveLength(0)
    const updated = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updated.githubUpdatePending).toBe(false)
  })

  it('untracked issue → no rows created', async () => {
    await seedSecret()
    const res = await postWebhook(labeledPayload(999, 'x', []))
    expect(res.status).toBe(200)
    const events = await harness.prisma.githubIssueEvent.findMany()
    expect(events).toHaveLength(0)
    const notifs = await harness.prisma.notification.findMany()
    expect(notifs).toHaveLength(0)
  })
})

// ─── R257 — acknowledge ───────────────────────────────────────────────────────

describe('R257 — acknowledge clears the attention flag', () => {
  it('POST /tickets/:id/github/acknowledge clears githubUpdatePending', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.ticket.update({ where: { id: ticket.id }, data: { githubUpdatePending: true } })
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/github/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(201)

    const updated = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updated.githubUpdatePending).toBe(false)
  })

  it('agent GET /tickets/:id clears the flag; ticket detail includes githubIssue.events', async () => {
    await seedSecret()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    const gh = await linkIssue(ticket.id, 88)
    await harness.prisma.githubIssueEvent.create({
      data: { githubIssueId: gh.id, action: 'labeled', labelName: 'bug', summary: '@dev added label "bug"', occurredAt: new Date() },
    })
    await harness.prisma.ticket.update({ where: { id: ticket.id }, data: { githubUpdatePending: true } })

    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness.request().get(`/api/v1/tickets/${ticket.id}`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.ticket.githubIssue.events).toHaveLength(1)

    // Fire-and-forget clear — poll briefly
    await new Promise((r) => setTimeout(r, 150))
    const updated = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updated.githubUpdatePending).toBe(false)
  })

  it('portal GET does not clear the flag and does not leak labels/events', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    const gh = await linkIssue(ticket.id, 88)
    await harness.prisma.githubIssue.update({ where: { id: gh.id }, data: { labels: [{ name: 'bug', color: 'd73a4a' }] } })
    await harness.prisma.ticket.update({ where: { id: ticket.id }, data: { githubUpdatePending: true } })

    const token = await signJwt({ id: user.id, role: 'user' })
    const res = await harness.request().get(`/api/v1/tickets/${ticket.id}`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    // Portal sees a bare issue link, never internal label churn / activity / flag
    expect(res.body.data.ticket.githubIssue.labels).toBeUndefined()
    expect(res.body.data.ticket.githubIssue.events).toBeUndefined()
    expect(res.body.data.ticket.githubUpdatePending).toBeUndefined()

    const updated = await harness.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(updated.githubUpdatePending).toBe(true)
  })
})
