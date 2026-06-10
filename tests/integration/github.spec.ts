/**
 * github.spec — integration tests for GithubController + GithubService.
 * MSW intercepts all Octokit/GitHub REST calls.
 * Live webhook HMAC end-to-end deferred to E2E pass.
 *
 * Regression catalogue rows:
 *   R159 — POST /github/connect (admin, MSW token exchange): GithubConfig row stored
 *   R160 — GET /github/status: returns connected + username + defaultRepo
 *   R161 — PATCH /github/config: defaultRepo persisted
 *   R162 — POST /tickets/:id/github/issues (MSW create-issue): GithubIssue row + SYSTEM_EVENT
 *   R163 — POST /tickets/:id/github/link existing issue: link row created
 *   R164 — DELETE /tickets/:id/github/link: link removed
 *   R165 — GitHub admin routes non-admin / DELETE /github/connect: 403 / PAT cleared
 */

import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, signJwt } from './factories'
import './setup'

async function seedGithubConfig() {
  return harness.prisma.githubConfig.create({
    data: {
      accessToken: 'gh_test_token',
      githubUsername: 'test-agent',
      githubUserId: '12345',
      defaultRepo: 'test-agent/example-repo',
    },
  })
}

// ─── R159 — POST /github/connect ─────────────────────────────────────────────

describe('R159 — POST /github/connect (admin)', () => {
  it('MSW token exchange → GithubConfig row stored with accessToken + username', async () => {
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .post('/api/v1/github/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'mock-oauth-code' })

    expect(res.status).toBe(201)
    expect(res.body.data.connected).toBe(true)
    expect(res.body.data.username).toBe('test-agent')

    const cfg = await harness.prisma.githubConfig.findFirst()
    expect(cfg).not.toBeNull()
    expect(cfg!.accessToken).toBe('gh_test_token')
    expect(cfg!.githubUsername).toBe('test-agent')
  })
})

// ─── R160 — GET /github/status ───────────────────────────────────────────────

describe('R160 — GET /github/status', () => {
  it('returns connected + username + defaultRepo', async () => {
    await seedGithubConfig()
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness.request().get('/api/v1/github/status').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      connected: true,
      username: 'test-agent',
      defaultRepo: 'test-agent/example-repo',
    })
  })

  it('returns connected=false when no GithubConfig', async () => {
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness.request().get('/api/v1/github/status').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.connected).toBe(false)
  })
})

// ─── R161 — PATCH /github/config ─────────────────────────────────────────────

describe('R161 — PATCH /github/config', () => {
  it('persists defaultRepo', async () => {
    const cfg = await seedGithubConfig()
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .patch('/api/v1/github/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultRepo: 'test-agent/new-repo' })

    expect(res.status).toBe(200)

    const updated = await harness.prisma.githubConfig.findUniqueOrThrow({ where: { id: cfg.id } })
    expect(updated.defaultRepo).toBe('test-agent/new-repo')
  })
})

// ─── R162 — POST /tickets/:id/github/issues ──────────────────────────────────

describe('R162 — POST /tickets/:id/github/issues', () => {
  it('creates GithubIssue row and SYSTEM_EVENT message via MSW', async () => {
    await seedGithubConfig()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id, title: 'Bug report' })
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/github/issues`)
      .set('Authorization', `Bearer ${token}`)
      .send({ repo: 'test-agent/example-repo' })

    expect(res.status).toBe(201)

    const issue = await harness.prisma.githubIssue.findFirst({ where: { ticketId: ticket.id } })
    expect(issue).not.toBeNull()
    expect(issue!.issueNumber).toBe(42)

    const sysEvent = await harness.prisma.message.findFirst({
      where: { ticketId: ticket.id, type: 'SYSTEM_EVENT', body: { contains: 'github_linked' } },
    })
    expect(sysEvent).not.toBeNull()
  })
})

// ─── R163 — POST /tickets/:id/github/link ────────────────────────────────────

describe('R163 — POST /tickets/:id/github/link existing issue', () => {
  it('creates GithubIssue link row', async () => {
    await seedGithubConfig()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post(`/api/v1/tickets/${ticket.id}/github/link`)
      .set('Authorization', `Bearer ${token}`)
      .send({ repo: 'test-agent/example-repo', issueNumber: 7 })

    expect(res.status).toBe(201)

    const issue = await harness.prisma.githubIssue.findFirst({ where: { ticketId: ticket.id } })
    expect(issue).not.toBeNull()
    expect(issue!.issueNumber).toBe(7)
  })
})

// ─── R164 — DELETE /tickets/:id/github/link ──────────────────────────────────

describe('R164 — DELETE /tickets/:id/github/link', () => {
  it('removes the GithubIssue row', async () => {
    await seedGithubConfig()
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const agentToken = await signJwt({ id: agent.id, role: 'agent' })

    await harness.prisma.githubIssue.create({
      data: { ticketId: ticket.id, issueNumber: 10, repo: 'test-agent/example-repo', issueUrl: 'https://github.com/test-agent/example-repo/issues/10', title: 'Some issue', state: 'open' },
    })

    const res = await harness
      .request()
      .delete(`/api/v1/tickets/${ticket.id}/github/link`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)

    const issue = await harness.prisma.githubIssue.findFirst({ where: { ticketId: ticket.id } })
    expect(issue).toBeNull()
  })
})

// ─── R165 — Auth boundary ────────────────────────────────────────────────────

describe('R165 — GitHub admin routes non-admin', () => {
  it('non-admin agent on POST /github/connect returns 403', async () => {
    const agent = await makeAgent({ role: 'SECONDARY_AGENT' })
    const token = await signJwt({ id: agent.id, role: 'agent' })

    const res = await harness
      .request()
      .post('/api/v1/github/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'code' })

    expect(res.status).toBe(403)
  })

  it('DELETE /github/connect clears GithubConfig row', async () => {
    await seedGithubConfig()
    const admin = await makeAgent({ role: 'ADMIN' })
    const token = await signJwt({ id: admin.id, role: 'agent', orgRole: 'ADMIN' })

    const res = await harness
      .request()
      .delete('/api/v1/github/connect')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)

    const cfg = await harness.prisma.githubConfig.findFirst()
    expect(cfg).toBeNull()
  })
})
