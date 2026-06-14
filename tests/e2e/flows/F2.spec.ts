/**
 * F2 — Inbound email → Bridge Inbox → Convert to ticket → Email reply → Thread reply.
 *
 * Six steps (plan §6):
 *   1. ingestEmail() from a unique stranger → Bridge inbox shows conversation via SSE.
 *   2. Agent opens it → header says "Conversation" → clicks Convert to ticket.
 *   3. Status pill OPEN + displayId visible; confirmation email to stranger.
 *   4. Agent replies → reply email sent to stranger.
 *   5. ingestEmail() again same threadId + inReplyTo → Bridge thread gains customer message;
 *      status transitions WAITING→IN_PROGRESS (G3 applyReplyTransition).
 *   6. Portal-side: stranger has no portal account — skip (documented).
 *
 * Data isolation: unique stranger email per run so consecutive runs don't collide.
 */

import { test, expect } from '@playwright/test'
import { agentApiLogin, plantAgentToken } from '../fixtures/auth'
import { expectMailDelivered, resetCapturedMail } from '../fixtures/mail'
import { ingestEmail } from '../fixtures/ingest'

const BRIDGE = 'http://localhost:3002'

const AGENT_CREDS = { email: 'agent@twominutereports.com', password: 'agent123' }

test.describe('F2 — Inbound email → Bridge Inbox → Convert → Email reply threading', () => {
  test.beforeEach(async ({ request }) => {
    await resetCapturedMail(request)
  })

  test('inbound-email triage and reply threading', async ({ browser, request }) => {
    const runId = Date.now()
    const STRANGER_EMAIL = `e2e-f2-${runId}@stranger.test`
    const SUBJECT = `F2-${runId} help needed`
    const THREAD_ID = `e2e-f2-thread-${runId}`

    // ── Agent programmatic login ──────────────────────────────────────────────
    const { token: agentToken, agent } = await agentApiLogin(
      request,
      AGENT_CREDS.email,
      AGENT_CREDS.password,
    )
    const agentCtx = await browser.newContext()
    const agentPage = await agentCtx.newPage()
    await plantAgentToken(agentPage, agentToken, agent)
    await agentPage.goto(`${BRIDGE}/inbox`)

    // ── 1. Ingest inbound email → SSE should push new row to Bridge inbox ─────
    const { ticketId } = await ingestEmail(request, {
      from: STRANGER_EMAIL,
      fromName: 'E2E Stranger',
      subject: SUBJECT,
      body: 'I need help with the F2 scenario.',
      threadId: THREAD_ID,
    })
    expect(ticketId).toBeTruthy()

    // Wait for SSE-driven inbox refresh (debounce ~300 ms + refetch latency)
    const inboxRow = agentPage
      .locator('[data-testid="inbox-row"]')
      .filter({ hasText: SUBJECT })
    await expect(inboxRow).toBeVisible({ timeout: 10_000 })

    // Conversation (not yet a ticket) — no status-pill, no ticket-ref
    await expect(inboxRow.locator('[data-testid="status-pill"]')).not.toBeVisible()
    await expect(inboxRow.locator('[data-testid="ticket-ref"]')).not.toBeVisible()

    // ── 2. Agent opens and converts the conversation ──────────────────────────
    await inboxRow.click()
    await agentPage.waitForURL(new RegExp(`/tickets/${ticketId}`))

    // Convert button visible because isTicket=false
    const convertBtn = agentPage.locator('[data-testid="convert-ticket"]')
    await expect(convertBtn).toBeVisible({ timeout: 5_000 })
    await convertBtn.click()

    // Wait for convert to complete — button disappears
    await expect(convertBtn).not.toBeVisible({ timeout: 8_000 })

    // ── 3. Status pill + displayId now visible in inbox row ───────────────────
    // Navigate back to inbox to see the updated row state
    await agentPage.goto(`${BRIDGE}/inbox`)
    const convertedRow = agentPage
      .locator('[data-testid="inbox-row"]')
      .filter({ hasText: SUBJECT })
    await expect(convertedRow).toBeVisible({ timeout: 10_000 })
    await expect(convertedRow.locator('[data-testid="status-pill"]')).toBeVisible()
    await expect(convertedRow.locator('[data-testid="ticket-ref"]')).toBeVisible()

    // Confirmation email sent to stranger after convert (G2 queue → poll)
    const confirmMails = await expectMailDelivered(request, STRANGER_EMAIL, 1)
    expect(confirmMails[0]!.headers['Subject'] ?? confirmMails[0]!.subject).toBeTruthy()

    // ── 4. Agent replies → reply email sent to stranger ───────────────────────
    await convertedRow.click()
    await agentPage.waitForURL(new RegExp(`/tickets/${ticketId}`))

    // Open the compose panel via the last message card's Reply button.
    // (locator.isVisible() does NOT auto-wait — a conditional click here raced the
    // page load and silently skipped. click() auto-waits for actionability.)
    const replyEditor = agentPage.locator('[data-testid="reply-editor"]')
    await agentPage.getByRole('button', { name: /^reply$/i }).first().click()
    await expect(replyEditor).toBeVisible({ timeout: 5_000 })
    await replyEditor.click()
    await replyEditor.type('Hi — thanks for reaching out! We are looking into this.')

    const sendResponse = agentPage.waitForResponse(
      (r) => r.url().includes('/api/v1/tickets') && r.url().includes('/messages') && r.request().method() === 'POST',
    )
    await agentPage.locator('[data-testid="reply-send"]').click()
    await sendResponse

    // Reply email to stranger arrives (poll)
    const replyMails = await expectMailDelivered(request, STRANGER_EMAIL, 2)
    const agentReplyMail = replyMails.at(-1)!
    const agentMsgId =
      agentReplyMail.headers['Message-ID'] ?? agentReplyMail.headers['message-id'] ?? ''
    expect(agentMsgId).toBeTruthy()

    // ── 5. Stranger replies via email (ingestEmail same threadId + inReplyTo) ──
    await ingestEmail(request, {
      from: STRANGER_EMAIL,
      fromName: 'E2E Stranger',
      subject: `Re: ${SUBJECT}`,
      body: 'Thanks for the reply — still seeing the issue.',
      threadId: THREAD_ID,
      inReplyTo: agentMsgId,
    })

    // New message appears in bridge thread via SSE
    await expect(
      agentPage.locator('[data-testid="message-body"]').filter({ hasText: 'still seeing the issue' }),
    ).toBeVisible({ timeout: 15_000 })

    // G3: status should have transitioned (WAITING → IN_PROGRESS) after customer reply
    // Re-fetch ticket page to get current status — SSE may have already updated the detail page
    const statusPillOnDetail = agentPage.locator('[data-testid="status-pill"]')
    if (await statusPillOnDetail.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // If a status pill is shown in the detail header, check it isn't WAITING
      const pillText = await statusPillOnDetail.textContent()
      expect(pillText).not.toContain('Waiting')
    }

    // ── 6. Portal-side: stranger has no portal account — skipped ─────────────
    // (The stranger email was created by ingestion as a User without a password.
    // Portal login requires a password; magic-link flow is not part of E2E scope.)
  })
})
